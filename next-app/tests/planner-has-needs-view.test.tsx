import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { HasNeedsScout } from '../src/lib/has-needs';
import type { PickerBadge, PickerRank } from '../src/lib/has-needs-picker';

/**
 * Build a Plan B7 (Plans/Build-A-Plan.md "B7: Has/Needs as a planner tab"), the screen: the tab's place, the three
 * result columns, Partial naming what's missing, the selection in the URL, and the add hook (one requirement, seed
 * holders only, through Build's own plannerAddOfferingAction). The split itself is pinned in has-needs-split.test.ts.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/planner/has-needs',
  useSearchParams: () => new URLSearchParams(window.location.search)
}));
const m = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({ plannerAddOfferingAction: m.add }));

const { HasNeedsView } = await import('../src/app/(public)/planner/has-needs/has-needs-client');
const { PlannerTabs } = await import('../src/app/(public)/planner/planner-tabs');

const node = (code: string, label: string, children: PickerRank['tree'] = [], optionality = '') => ({ code, label, optionality, children });
const RANKS: PickerRank[] = [
  {
    id: 'tenderfoot',
    name: 'Tenderfoot',
    tree: [node('4a', 'First aid'), node('4b', 'Bites'), node('6', 'Fitness', [node('6a', 'Push-ups'), node('6b', 'Run')], 'Complete any one')]
  }
];
const BADGES: PickerBadge[] = [{ id: 'first-aid', name: 'First Aid', eagle: true, tree: [node('9', 'Rescues', [node('9a', 'Carry'), node('9b', 'Drag')])] }];
const scout = (id: string, firstName: string, heldKeys: string[]): HasNeedsScout => ({ id, firstName, displayName: `${firstName} S`, currentRank: 'scout', rankSortOrder: 1, heldKeys });
const SCOUTS = [scout('a', 'Ann', ['rank:tenderfoot-4a', 'rank:tenderfoot-4b']), scout('b', 'Ben', ['rank:tenderfoot-4a']), scout('c', 'Cal', [])];
const ALL_RANKS = [
  { id: 'scout', name: 'Scout' },
  { id: 'tenderfoot', name: 'Tenderfoot' }
];
const MEETINGS = [
  { entryId: 1, label: 'Oct 25' },
  { entryId: 2, label: 'Nov 1' }
];

function at(search: string) {
  window.history.replaceState(null, '', `/planner/has-needs${search}`);
}
function renderTab(o: Partial<Parameters<typeof HasNeedsView>[0]> = {}) {
  return render(<HasNeedsView ranks={RANKS} badges={BADGES} scouts={SCOUTS} allRanks={ALL_RANKS} meetings={MEETINGS} onPlan={{}} canSeed {...o} />);
}

beforeEach(() => at(''));
afterEach(() => {
  cleanup();
  m.add.mockReset();
});

describe('the Has/Needs tab (B7)', () => {
  it('HasNeedsTab_IsLastTab', () => {
    render(<PlannerTabs active="hasneeds" />);
    const tabs = screen.getAllByRole('tab');
    expect([tabs.length, tabs[tabs.length - 1].textContent, tabs[tabs.length - 1].getAttribute('href')]).toEqual([6, 'Has/Needs', '/planner/has-needs']);
  });

  it('PlannerTabs_ScrollOnPhone', () => {
    render(<PlannerTabs active="hasneeds" />);
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '_components', 'tab-strip.module.css'), 'utf8');
    const rule = /\.scroll\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect([/scroll/.test(screen.getByRole('tablist').className), /overflow-x:\s*auto/.test(rule), /flex-wrap:\s*nowrap/.test(rule)]).toEqual([true, true, true]);
  });

  it('HasNeeds_ShowsHasNeedsPartialColumns', () => {
    at('?pick=rank:tenderfoot-4a,rank:tenderfoot-4b');
    renderTab();
    expect(within(screen.getByRole('region', { name: 'Results' })).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Has (1)', 'Needs (1)', 'Partial (1)']);
  });

  it('HasNeeds_Partial_NamesWhatsMissing', () => {
    at('?pick=rank:tenderfoot-4a,rank:tenderfoot-4b');
    renderTab();
    const partial = screen.getByRole('region', { name: 'Partial' });
    expect(within(partial).getByText(/Ben S/).closest('li')?.textContent).toMatch(/needs Tenderfoot 4b/);
  });

  it('HasNeeds_SelectionLivesInUrl', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab();
    const restored = (screen.getByRole('checkbox', { name: /4a First aid/ }) as HTMLInputElement).checked;
    fireEvent.click(screen.getByRole('checkbox', { name: /4b Bites/ }));
    expect([restored, window.location.search]).toEqual([true, '?pick=rank:tenderfoot-4a,rank:tenderfoot-4b']);
  });

  it('HasNeeds_Viewer_CanSee_NoAdd', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab({ canSeed: false });
    expect([screen.getByRole('heading', { level: 2, name: 'Has (2)' }) != null, screen.queryByRole('button', { name: /^Add / })]).toEqual([true, null]);
  });

  it('HasNeeds_SingleRequirement_OffersAddForSeeder', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab();
    expect(screen.getByRole('button', { name: 'Add Tenderfoot 4a to Oct 25 plan' })).toBeTruthy();
  });

  it('HasNeeds_MultiSelection_HasNoAdd', () => {
    at('?pick=rank:tenderfoot-4a,rank:tenderfoot-4b');
    renderTab();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('HasNeeds_Add_UsesSharedAddAction', async () => {
    m.add.mockResolvedValue({ ok: true, added: ['first-aid-9'], teachers: {}, prior: 's', stamp: 's2' });
    at('?pick=mb:first-aid-9b');
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add First Aid 9 to Oct 25 plan' }));
    await waitFor(() => expect(screen.getByText('On plan')).toBeTruthy());
    expect(m.add.mock.calls).toEqual([[{ entryId: 1, keys: ['first-aid-9'] }]]);
  });
});
