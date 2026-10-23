import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan B5 (Plans/Build-A-Plan.md, "B5: Suggestions mode"), the screen: "Suggestions" leads the heading bar;
 * the mode turns the plan into a slim rail and the main area into three lenses over one engine read, with Add, ticks
 * that survive lens switches, On plan + Remove, and a read-only view for viewers. Server actions are the mock boundary
 * (their rules: build-plan-db.test.ts); the read: build-plan-suggest-db.test.ts.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const add = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const teachChip = vi.hoisted(() => vi.fn());
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: add,
  plannerRemoveOfferingAction: remove,
  plannerTeachingChipAction: teachChip,
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');

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
const ROWS = [row('tenderfoot-4a', { codeLabel: 'Tenderfoot 4a', title: 'First aid' }), row('scout-1a', { origin: 'scouts', seeded: false, scouts: 3, state: 'ready' })];

const mode = (canSeed = true, rows = ROWS, canEdit = canSeed) =>
  render(<BuildPlanView entryId={1} rows={rows} canSeed={canSeed} canEdit={canEdit} stamp="s0" heading={null} mode="suggestions" planHref="/planner/build?meeting=1" feed={<SuggestionsFeed data={DATA} />} />);
const lens = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const workspace = () => screen.getByRole('region', { name: 'Suggestions' });

afterEach(() => {
  cleanup();
  nav.refresh.mockReset();
  nav.push.mockReset();
  add.mockReset();
  remove.mockReset();
  teachChip.mockReset();
});

describe('Suggestions mode', () => {
  it('Suggestions_IsInTheBuildBar', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} suggestionsHref="/planner/build?meeting=1&view=suggestions" />);
    expect(screen.getByRole('tab', { name: 'Suggestions' }).getAttribute('href')).toBe('/planner/build?meeting=1&view=suggestions');
  });

  it('SuggestionsMode_ShowsPlanRail_AndHidesSuggestedColumn', () => {
    mode();
    const rail = screen.getByRole('complementary', { name: /The plan/ });
    expect([within(rail).getAllByRole('listitem').length, rail.textContent?.includes('(2)'), screen.queryByRole('heading', { name: 'Suggested' })]).toEqual([2, true, null]);
  });

  it('GroupSessions_ShowsGroupNamesAndTeacher', async () => {
    mode();
    const cardEl = (await within(workspace()).findByText('Flag')).closest('li') as HTMLElement;
    expect([cardEl.textContent?.includes('Leo K, Max B, Nia R, Omar T'), cardEl.textContent?.includes('4 need it'), cardEl.textContent?.includes('Best teacher: Dan K · also Finn P (Star scout)')]).toEqual([
      true,
      true,
      true
    ]);
  });

  it('ByScout_ListsUpToThreePerScout', async () => {
    mode(true, []);
    await within(workspace()).findByText('Flag');
    lens('By Scout');
    const scout = screen.getAllByText('Anjali S', { selector: 'p' })[0].closest('li') as HTMLElement;
    expect(within(scout).getAllByRole('button', { name: /^Add / }).length).toBe(3);
  });

  it('Teaching_ListsWhoCanTeachWhat', async () => {
    mode(true, []);
    await within(workspace()).findByText('Flag');
    lens('Teaching');
    const t = screen.getByText('Dan K', { selector: 'p' }).closest('li') as HTMLElement;
    expect([t.textContent?.includes('Knots · First aid'), t.textContent?.includes('Scout 2'), within(t).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' }) != null]).toEqual([true, true, true]);
  });

  it('NeedsCampout_HasNoAdd', async () => {
    mode();
    const summary = await screen.findByText('Needs a campout (1)');
    const details = summary.closest('details') as HTMLElement;
    expect([within(details).getByText('Spend a night camping') != null, within(details).queryAllByRole('button').length, within(details).queryAllByRole('checkbox').length]).toEqual([true, 0, 0]);
  });

  it('MultiSelect_AddsNToThePlan_InOneAction', async () => {
    mode(true, []);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Scout 2 Flag' }));
    lens('By Scout');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tenderfoot 3a Knots' }));
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2', 'tenderfoot-3a'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to the plan' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls).toEqual([[{ entryId: 1, keys: ['scout-2', 'tenderfoot-3a'] }]]);
  });

  it('OnPlanItems_ShowOnPlan_WithRemove', async () => {
    mode();
    const cardEl = (await within(workspace()).findByText('First aid')).closest('li') as HTMLElement;
    expect([within(cardEl).getByText('On plan') != null, within(cardEl).getByRole('button', { name: 'Remove Tenderfoot 4a First aid' }) != null, within(cardEl).queryByRole('button', { name: /^Add / })]).toEqual([
      true,
      true,
      null
    ]);
  });

  it('Viewer_SeesLenses_WithoutAdd', async () => {
    mode(false);
    await within(workspace()).findByText('Flag');
    expect([screen.getAllByRole('radio').length, screen.queryAllByRole('button', { name: /^(Add|Remove)/ }).length, within(workspace()).queryAllByRole('checkbox', { name: /^Select/ }).length]).toEqual([3, 0, 0]);
  });
});

describe('Suggestions mode, more', () => {
  it('SuggestionsMode_LensSwitchAndFilters_CallNoAction', async () => {
    mode();
    await within(workspace()).findByText('Flag');
    lens('By Scout');
    lens('Teaching');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rank' }), { target: { value: 'scout' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'MB only' }));
    expect([add.mock.calls.length, remove.mock.calls.length, nav.refresh.mock.calls.length, nav.push.mock.calls.length]).toEqual([0, 0, 0, 0]);
  });

  it('SuggestionsMode_HidingOnPlan_DropsItsCard', async () => {
    mode();
    await within(workspace()).findByText('Flag');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show what’s already on the plan' }));
    expect(within(workspace()).queryByText('First aid')).toBeNull();
  });

  it('SuggestionsMode_Esc_GoesBackToThePlan', () => {
    mode();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(nav.push.mock.calls).toEqual([['/planner/build?meeting=1']]);
  });

  it('SuggestionsMode_AddedItem_ShowsInTheRailAtOnce', async () => {
    mode(true, []);
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    const rail = screen.getByRole('complementary', { name: /The plan/ });
    await waitFor(() => expect(within(rail).getByText('Flag')).toBeTruthy());
  });

  it('SuggestionsMode_FailedAdd_ShowsTheErrorInPlace', async () => {
    mode(true, []);
    add.mockResolvedValueOnce({ ok: false, error: 'Only the planning team can change the plan.' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Scout 2 Flag' }));
    const cardEl = screen.getByText('Flag').closest('li') as HTMLElement;
    expect((await within(cardEl).findByRole('alert')).textContent).toBe('Only the planning team can change the plan.');
  });

  it('SuggestionsMode_PlanDrawerClose_ReturnsFocusToItsButton', async () => {
    mode();
    const open = screen.getByRole('button', { name: 'Plan (2)' });
    open.focus();
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it('SuggestionsMode_AddsOverTheCap_InChunksOfTwenty', async () => {
    const many = { ...DATA, cards: Array.from({ length: 25 }, (_, i) => ({ ...DATA.cards[0], key: `scout-${i + 10}`, codeLabel: `Scout ${i + 10}`, title: `T${i}` })) };
    render(<BuildPlanView entryId={1} rows={[]} canSeed stamp="s0" heading={null} mode="suggestions" planHref="/p" feed={<SuggestionsFeed data={many} />} />);
    for (const c of many.cards) fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${c.codeLabel} ${c.title}` }));
    add.mockResolvedValueOnce({ ok: true, added: [], teachers: {}, prior: 's0', stamp: 's1' }).mockResolvedValueOnce({ ok: true, added: [], teachers: {}, prior: 's1', stamp: 's2' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 25 to the plan' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls.map((c) => c[0].keys.length)).toEqual([20, 5]);
  });
});

/**
 * Suggestions › Teaching (Patrick, 2026-10-22): each requirement chip in a leader's row is the control, labelled with
 * the code and the requirement's short title ("Scout 2 · Flag"); a small "on plan" marker when it is on the plan
 * without them, a quiet "teaching" with no click when they teach it. Its accessible name keeps the action. A click
 * opens a confirm Dialog; nothing is written until its primary is pressed. Rows have no tick and no row-level Add, so
 * one leader's choice never lights up another's.
 */
describe('Suggestions › Teaching chips', () => {
  const danRow = () => screen.getByText('Dan K', { selector: 'p' }).closest('li') as HTMLElement;
  const teaching = async (rows: PlanRow[] = [], canSeed = true, canEdit = canSeed) => {
    mode(canSeed, rows, canEdit);
    await within(workspace()).findByText('Flag');
    lens('Teaching');
  };
  const ok = (o: object = {}) => ({ ok: true, key: 'scout-2', added: true, teachers: ['Dan K'], onBoard: true, prior: 's0', stamp: 's1', ...o });
  const ON_PLAN = [row('tenderfoot-4a', { codeLabel: 'Tenderfoot 4a', title: 'First aid' })];
  const confirmDlg = () => screen.getByRole('dialog');

  it('TeachingChip_ShowsCodeAndTitle', async () => {
    await teaching();
    const chip = within(danRow()).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' });
    expect(chip.textContent).toBe('Scout 2 · Flag');
  });

  it('TeachingChip_AccessibleName_KeepsTheAction', async () => {
    await teaching(ON_PLAN);
    expect([
      within(danRow()).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' }) != null,
      within(danRow()).getByRole('button', { name: 'Assign Dan K to Tenderfoot 4a First aid' }) != null
    ]).toEqual([true, true]);
  });

  it('TeachingChip_OnPlan_ShowsAnOnPlanMarker', async () => {
    await teaching(ON_PLAN);
    const chip = within(danRow()).getByRole('button', { name: 'Assign Dan K to Tenderfoot 4a First aid' });
    expect(chip.textContent).toBe('Tenderfoot 4a · First aid on plan');
  });

  it('TeachingChip_Click_OpensConfirm_WithoutWriting', async () => {
    await teaching();
    fireEvent.click(within(danRow()).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' }));
    expect([within(confirmDlg()).getByText('Add Scout 2 · Flag to the plan, with Dan K teaching?') != null, teachChip.mock.calls.length]).toEqual([true, 0]);
  });

  it('TeachingChip_Confirm_AddsWithThatTeacher', async () => {
    await teaching();
    teachChip.mockResolvedValueOnce(ok());
    fireEvent.click(within(danRow()).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' }));
    fireEvent.click(within(confirmDlg()).getByRole('button', { name: 'Add to plan' }));
    await waitFor(() => expect(within(danRow()).getByText('teaching')).toBeTruthy());
    expect([teachChip.mock.calls, add.mock.calls.length]).toEqual([[[{ entryId: 1, key: 'scout-2', personId: 7 }]], 0]);
  });

  it('TeachingChip_Cancel_WritesNothing', async () => {
    await teaching();
    const chip = within(danRow()).getByRole('button', { name: 'Add Scout 2 Flag with Dan K teaching' });
    fireEvent.click(chip);
    fireEvent.click(within(confirmDlg()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(chip));
    expect([screen.queryByRole('dialog'), teachChip.mock.calls.length]).toEqual([null, 0]);
  });

  it('TeachingChip_AssignsOnExistingOffering_AfterConfirm', async () => {
    await teaching(ON_PLAN);
    teachChip.mockResolvedValueOnce(ok({ key: 'tenderfoot-4a', added: false }));
    fireEvent.click(within(danRow()).getByRole('button', { name: 'Assign Dan K to Tenderfoot 4a First aid' }));
    expect(within(confirmDlg()).getByText('Make Dan K the teacher for Tenderfoot 4a · First aid?')).toBeTruthy();
    fireEvent.click(within(confirmDlg()).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(teachChip).toHaveBeenCalled());
    expect(teachChip.mock.calls).toEqual([[{ entryId: 1, key: 'tenderfoot-4a', personId: 7 }]]);
  });

  it('TeachingChip_Assign_FocusNeverDropsToBody', async () => {
    // The chip turns into a "teaching" span on Assign: focus moves to the row's other chip or its heading, never body.
    await teaching(ON_PLAN);
    teachChip.mockResolvedValueOnce(ok({ key: 'tenderfoot-4a', added: false }));
    fireEvent.click(within(danRow()).getByRole('button', { name: 'Assign Dan K to Tenderfoot 4a First aid' }));
    fireEvent.click(within(confirmDlg()).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(within(danRow()).getByText('teaching')).toBeTruthy());
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect([document.activeElement === document.body, danRow().contains(document.activeElement)]).toEqual([false, true]);
  });

  it('TeachingChip_TeachingAlready_ReadsTeaching_WithNoClick', async () => {
    await teaching([row('tenderfoot-4a', { codeLabel: 'Tenderfoot 4a', title: 'First aid', teachers: ['Dan K'], teacherIds: [7] })]);
    expect([within(danRow()).getByText('teaching') != null, within(danRow()).queryByRole('button', { name: /Tenderfoot 4a/ })]).toEqual([true, null]);
  });

  it('TeachingRows_HaveNoTicks_SoNoCrossRowLighting', async () => {
    mode(true, []);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Scout 2 Flag' }));
    lens('Teaching');
    expect([within(danRow()).queryAllByRole('checkbox').length, within(danRow()).queryByRole('button', { name: /^Add Scout 2 Flag$/ })]).toEqual([0, null]);
  });

  it('TeachingChip_WithoutEditRight_ShowsNoDeadButton', async () => {
    await teaching([], true, false);
    expect(within(danRow()).queryAllByRole('button').length).toBe(0);
  });
});
