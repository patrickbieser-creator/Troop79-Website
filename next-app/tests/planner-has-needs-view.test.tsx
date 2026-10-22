import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { HasNeedsScout } from '../src/lib/has-needs';
import { PICK_MAX, togglePick, type PickerBadge, type PickerRank } from '../src/lib/has-needs-picker';

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

const TAB_CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '_components', 'tab-strip.module.css'), 'utf8');
/** One rule's declarations, found by its exact selector (comments stripped, whitespace normalised). */
function cssDeclarations(css: string, selector: string): Record<string, string> {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
  const body = rules.map((r) => r.split('{')).find(([sel]) => sel.trim().replace(/\s+/g, ' ') === selector)?.[1] ?? '';
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.split(':').map((x) => x.trim()))
      .filter(([k, v]) => k && v)
      .map(([k, ...v]) => [k, v.join(':')])
  );
}

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

  it('PlannerTabs_UseTheScrollingStrip', () => {
    render(<PlannerTabs active="hasneeds" />);
    expect(screen.getByRole('tablist').className.split(' ').some((c) => /scroll/.test(c))).toBe(true);
  });

  it('PlannerTabs_ScrollingStrip_KeepsTheFocusOutlineInside', () => {
    // A scroller clips at its padding box (qa-lead, B7): the focus outline must sit inside the tab. A browser
    // tab-through is still the real check; this pins the rule.
    expect(cssDeclarations(TAB_CSS, '.scroll .tab:focus-visible')['outline-offset']).toMatch(/^-\d/);
  });

  it('PlannerTabs_ScrollingStrip_StaysOnOneLine', () => {
    expect([cssDeclarations(TAB_CSS, '.scroll')['flex-wrap'], cssDeclarations(TAB_CSS, '.scroll')['overflow-x']]).toEqual(['nowrap', 'auto']);
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

  it('HasNeeds_Viewer_CanSee', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab({ canSeed: false });
    expect(screen.getByRole('heading', { level: 2, name: 'Has (2)' })).toBeTruthy();
  });

  it('HasNeeds_Viewer_HasNoAdd', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab({ canSeed: false });
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
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

  it('HasNeeds_AddFails_SaysWhyInPlace', async () => {
    m.add.mockResolvedValue({ ok: false, error: 'That meeting has passed.' });
    at('?pick=rank:tenderfoot-4a');
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add Tenderfoot 4a to Oct 25 plan' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That meeting has passed.'));
  });

  it('HasNeeds_AddFails_DoesNotSayOnPlan', async () => {
    m.add.mockResolvedValue({ ok: false, error: 'That meeting has passed.' });
    at('?pick=rank:tenderfoot-4a');
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add Tenderfoot 4a to Oct 25 plan' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('On plan')).toBeNull();
  });

  it('HasNeeds_ColumnHeadings_AreNotLiveRegions', () => {
    at('?pick=rank:tenderfoot-4a');
    renderTab();
    expect(screen.getAllByRole('heading', { level: 2 }).filter((h) => h.hasAttribute('aria-live'))).toEqual([]);
  });

  it('HasNeeds_OneLiveSummary_CountsTheSplit', () => {
    at('?pick=rank:tenderfoot-4a,rank:tenderfoot-4b');
    renderTab();
    const live = within(screen.getByRole('region', { name: 'Results' })).getAllByText((_, el) => el?.getAttribute('aria-live') === 'polite');
    expect(live.map((el) => el.textContent)).toEqual(['1 have · 1 need · 1 partial']);
  });
});

describe('the pick cap (B7 qa)', () => {
  const full = Array.from({ length: PICK_MAX }, (_, i) => `rank:x-${i}`);

  it('TogglePick_AtTheCap_AddsNothing', () => {
    expect(togglePick(full, 'rank:extra').next).toEqual(full);
  });

  it('TogglePick_AtTheCap_SaysCapped', () => {
    expect(togglePick(full, 'rank:extra').capped).toBe(true);
  });

  it('TogglePick_AtTheCap_StillUnticks', () => {
    expect(togglePick(full, full[0]).next.length).toBe(PICK_MAX - 1);
  });
});
