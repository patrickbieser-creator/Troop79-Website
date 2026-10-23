import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md), the screen: a viewer sees the plan with no controls; a seed holder's ⋯ on
 * a row scouts picked offers Remove greyed, with the reason. The server actions are mocked; their rules are tested
 * in build-plan-db.test.ts.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const SUGGEST = { mode: 'suggestions' as const, planHref: '/p' };
const add = vi.hoisted(() => vi.fn());
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: add,
  plannerRemoveOfferingAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, LikelyFeed, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');

const row = (key: string, o: Partial<PlanRow> = {}): PlanRow => ({
  key,
  codeLabel: key,
  title: `Title ${key}`,
  origin: 'planner',
  seeded: true,
  teachers: [],
  scouts: 0,
  canTeach: 2,
  state: 'needs-teacher',
  ...o
});
const ROWS = [row('tenderfoot-4a'), row('scout-1a', { origin: 'scouts', seeded: false, scouts: 3, teachers: ['Dan K'], state: 'ready' })];

afterEach(() => {
  cleanup();
  nav.refresh.mockReset();
  add.mockReset();
});

describe('BuildPlanView', () => {
  it('BuildPlan_Viewer_SeesNoControls', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} stamp="s" heading={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('BuildPlan_ScoutPickedRow_CannotBeRemoved', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Title scout-1a' }));
    const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect([remove.disabled, screen.getByText('Scouts picked this, so it stays on the plan.') != null]).toEqual([true, true]);
  });

  it('BuildPlan_Write_RefreshesOnlyWhenSomeoneElseChangedTheBoard', async () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} {...SUGGEST} feed={<SuggestionsFeed data={DATA} />} />);
    // First Add: the board was as the page saw it (prior s0): keep s1, no refresh.
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Scout 2 Flag' })).toBeNull());
    const quiet = nav.refresh.mock.calls.length;
    cleanup();
    // Second render: someone else changed the board since load (prior s9, not s0): refresh.
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} {...SUGGEST} feed={<SuggestionsFeed data={DATA} />} />);
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: {}, prior: 's9', stamp: 's10' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect([quiet, nav.refresh.mock.calls.length]).toEqual([0, 1]);
  });

  it('BuildPlan_Refresh_KeepsOpenDialogAndTakesFreshRows', () => {
    const { rerender } = render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Title tenderfoot-4a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    rerender(<BuildPlanView entryId={1} rows={[...ROWS, row('second-class-2a')]} canSeed stamp="s1" heading={null} />);
    expect([screen.queryByRole('heading', { name: 'Remove tenderfoot-4a?' }) != null, screen.queryByText('Title second-class-2a') != null]).toEqual([true, true]);
  });

  it('BuildPlan_AddedRow_ShowsTeacherFromSkillOffer', async () => {
    const { rerender } = render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} {...SUGGEST} feed={<SuggestionsFeed data={DATA} />} />);
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: { 'scout-2': ['Maria L'] }, prior: 's0', stamp: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    // The same view showing the plan (the rows it holds): the added row carries its teacher.
    rerender(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} />);
    expect(await screen.findByText('Maria L')).toBeTruthy();
  });

  it('BuildPlan_RemoveDialogCancel_ReturnsFocusToRowMenu', async () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} />);
    const trigger = screen.getByRole('button', { name: 'More for Title tenderfoot-4a' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

/** Patrick, 2026-10-22: the adds by the heading, likely scouts on each row, only the exceptional origins tagged. */
describe('BuildPlanView layout (2026-10-22)', () => {
  const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

  it('BuildPlan_AddActions_SitInTheBuildBar', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} />);
    const bar = screen.getByRole('navigation', { name: 'Build a Plan' });
    expect(within(bar).getAllByRole('link', { name: /^\+ / }).map((b) => b.textContent)).toEqual(['+ Requirement', '+ Focus set', '+ New mix']);
  });

  it('BuildPlan_AddedRow_ShowsNoJustAdded', async () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s0" heading={null} {...SUGGEST} feed={<SuggestionsFeed data={DATA} />} />);
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    await waitFor(() => expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes('Flag'))).toBe(true));
    expect(screen.queryByText('Just added')).toBeNull();
  });

  it('BuildPlan_RowWithoutScouts_ListsLikelyScoutsAndHowManyMore', async () => {
    const likely = { 'tenderfoot-4a': ['Anjali S', 'Finn P', 'Leo K', 'Max B', 'Nia R', 'Omar T', 'Pia W'] };
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} feed={<LikelyFeed byKey={likely} />} />);
    expect(await screen.findByText('Likely: Anjali S, Finn P, Leo K +4')).toBeTruthy();
  });

  it('BuildPlan_RowWithNoScoutsAndNoLikely_HasNoScoutLine', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} feed={<LikelyFeed byKey={{ 'tenderfoot-4a': [] }} />} />);
    expect(within(rowOf('Title tenderfoot-4a')).queryByText(/signed up|Likely|No scouts|No likely/)).toBeNull();
  });

  it('BuildPlan_PlannerRow_HasNoOriginTag', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} />);
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('BuildPlan_ScoutPickedRow_StillSaysScoutsAsked', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} />);
    expect(within(rowOf('Title scout-1a')).getByText('Scouts asked')).toBeTruthy();
  });

  it('BuildPlan_StateLabel_SharesOneLineWithTheRowButtons', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed canEdit stamp="s" heading={null} />);
    const state = within(rowOf('Title tenderfoot-4a')).getByText('Needs a teacher');
    expect(state.parentElement?.contains(screen.getByRole('button', { name: 'Edit Title tenderfoot-4a' }))).toBe(true);
  });
});
