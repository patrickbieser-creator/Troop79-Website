import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';
import type { SuggestionsData } from '../src/lib/build-plan-suggest';
import type { OrphansData } from '../src/lib/build-plan-orphans';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan B9 (Plans/Build-A-Plan.md, "B9: Finding orphans"), the screen: By Scout lists every active scout (a
 * reason line for one with nothing), Group Sessions' Solo needs footer with the shared Add, and the rail's "N scouts
 * have nothing on this plan" with its Drawer list, recounting after an Add. Server actions are the mock boundary.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const add = vi.hoisted(() => vi.fn());
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: add,
  plannerRemoveOfferingAction: vi.fn(),
  plannerTeachingChipAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, OrphansFeed, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');

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

/** DATA plus a scout with nothing to plan. */
const WITH_REASON: SuggestionsData = {
  ...DATA,
  scouts: [...DATA.scouts, { id: 'z', name: 'Zed Q', patrol: null, rankLabel: 'Tenderfoot', nextRankId: 'second-class', items: [], reason: 'Finished everything plannable' }]
};
const item = (key: string, title: string) => ({ key, codeLabel: key, title, kind: 'rank' as const, eagle: false, ranks: ['tenderfoot'] });
/** Finn is covered by 4a; Leo is covered by 3a (not on the plan yet); Zed has nothing to add. */
const ORPHANS: OrphansData = {
  scouts: [
    { scoutId: 'f', name: 'Finn P', rankLabel: 'Scout', items: [], reason: null, covers: ['tenderfoot-4a'] },
    { scoutId: 'l', name: 'Leo K', rankLabel: 'Scout', items: [item('tenderfoot-3a', 'Knots')], reason: null, covers: ['tenderfoot-3a'] },
    { scoutId: 'z', name: 'Zed Q', rankLabel: 'Tenderfoot', items: [], reason: 'Finished everything plannable', covers: [] }
  ]
};

const suggestions = (data: SuggestionsData = WITH_REASON, rows: PlanRow[] = []) =>
  render(<BuildPlanView entryId={1} rows={rows} canSeed canEdit stamp="s0" heading={null} mode="suggestions" planHref="/p" feed={<SuggestionsFeed data={data} />} />);
const plan = (o: { canSeed?: boolean; orphans?: OrphansData; rows?: PlanRow[] } = {}) =>
  render(<BuildPlanView entryId={1} rows={o.rows ?? [row('tenderfoot-4a')]} canSeed={o.canSeed ?? true} canEdit={o.canSeed ?? true} stamp="s0" heading={null} feed={<OrphansFeed data={o.orphans ?? ORPHANS} />} />);
const lens = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const workspace = () => screen.getByRole('region', { name: 'Suggestions' });

afterEach(() => {
  cleanup();
  add.mockReset();
});

describe('B9 By Scout', () => {
  it('ByScout_ListsEveryActiveScout', async () => {
    suggestions();
    await within(workspace()).findByText('Flag');
    lens('By Scout');
    expect([within(workspace()).queryAllByText('Anjali S').length > 0, within(workspace()).queryAllByText('Zed Q').length > 0]).toEqual([true, true]);
  });

  it('ByScout_NoSuggestion_ShowsReason', async () => {
    suggestions();
    await within(workspace()).findByText('Flag');
    lens('By Scout');
    const zed = within(workspace()).getByText('Zed Q', { selector: 'p *, p' }).closest('li') as HTMLElement;
    expect(within(zed).getByText('Finished everything plannable') != null).toBe(true);
  });
});

describe('B9 Solo needs', () => {
  const solo = async () => {
    suggestions();
    const summary = await screen.findByText('Solo needs (2)');
    return summary.closest('details') as HTMLElement;
  };

  it('GroupSessions_SoloNeeds_ListsSingleScoutRequirement', async () => {
    const details = await solo();
    const knots = within(details).getByText('Knots').closest('li') as HTMLElement;
    expect(within(knots).getByText('Anjali S') != null).toBe(true);
  });

  it('SoloNeed_Add_UsesSharedAddAction', async () => {
    const details = await solo();
    add.mockResolvedValueOnce({ ok: true, added: ['tenderfoot-3a'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(within(details).getByRole('button', { name: 'Add Tenderfoot 3a Knots' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls).toEqual([[{ entryId: 1, keys: ['tenderfoot-3a'] }]]);
  });

  it('SoloNeed_OnPlan_ReadsOnPlan', async () => {
    suggestions(WITH_REASON, [row('tenderfoot-3a')]);
    const details = (await screen.findByText('Solo needs (2)')).closest('details') as HTMLElement;
    const knots = within(details).getByText('Knots').closest('li') as HTMLElement;
    expect(within(knots).getByText('On plan') != null).toBe(true);
  });
});

describe('B9 orphans on the rail', () => {
  it('Orphans_ShowsTheCount', async () => {
    plan();
    expect(await screen.findByRole('button', { name: '2 scouts have nothing on this plan' })).toBeTruthy();
  });

  it('Orphans_ZeroShowsNothing', async () => {
    plan({ orphans: { scouts: [ORPHANS.scouts[0]] } });
    await waitFor(() => expect(screen.getByText(/signed up/)).toBeTruthy());
    expect(screen.queryByText(/nothing on this plan/)).toBeNull();
  });

  it('Orphans_ListShowsLikelyItemsAndReasons', async () => {
    plan();
    fireEvent.click(await screen.findByRole('button', { name: '2 scouts have nothing on this plan' }));
    const dlg = screen.getByRole('dialog');
    expect([within(dlg).getByText('Knots') != null, within(dlg).getByText('Finished everything plannable') != null, within(dlg).queryByText('Finn P')]).toEqual([true, true, null]);
  });

  it('Orphans_AddRecounts', async () => {
    plan();
    fireEvent.click(await screen.findByRole('button', { name: '2 scouts have nothing on this plan' }));
    add.mockResolvedValueOnce({ ok: true, added: ['tenderfoot-3a'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add tenderfoot-3a Knots' }));
    expect(await screen.findByRole('button', { name: '1 scout has nothing on this plan' })).toBeTruthy();
  });

  it('Orphans_Add_DoesNotReload', async () => {
    plan();
    fireEvent.click(await screen.findByRole('button', { name: '2 scouts have nothing on this plan' }));
    add.mockResolvedValueOnce({ ok: true, added: ['tenderfoot-3a'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add tenderfoot-3a Knots' }));
    await screen.findByRole('button', { name: '1 scout has nothing on this plan' });
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('Orphans_NoOfferings_ShowsNoCount', async () => {
    plan({ rows: [] });
    await waitFor(() => expect(screen.getByText(/signed up/)).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/nothing on this plan/)).toBeNull();
  });

  it('Orphans_Count_IsInAPoliteLiveRegion', async () => {
    plan();
    const count = await screen.findByRole('button', { name: '2 scouts have nothing on this plan' });
    expect(count.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('Orphans_Viewer_NoAdd', async () => {
    plan({ canSeed: false });
    fireEvent.click(await screen.findByRole('button', { name: '2 scouts have nothing on this plan' }));
    const dlg = screen.getByRole('dialog');
    expect([within(dlg).getByText('Knots') != null, within(dlg).queryByRole('button', { name: /^Add / })]).toEqual([true, null]);
  });
});
