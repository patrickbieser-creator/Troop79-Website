import { describe, it, expect } from 'vitest';
import { FEATURES, visibleFeatures } from '../src/app/admin/(workspace)/_components/feature-registry';
import { shortcuts, reportsShelf, uncollectedTotals, SHORTCUT_LIMIT, SHELF_LIMIT } from '../src/app/admin/(workspace)/_home/home-data';
import { rankOpens } from '../src/app/admin/(workspace)/_components/nav-events';
import { missingBsaIds, type PersonIn, type ScoutIn, type LeaderIn } from '../src/lib/missing-bsa-ids';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';
import nextConfig from '../next.config';

/** Home's pure pieces (Plans/Completed/Admin-Portal-Nav.md phase 4). */

const ALL = visibleFeatures(FEATURES, { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true });

describe('shortcuts', () => {
  it('Shortcuts_PinsFirst_ThenMostOpened', () => {
    const s = shortcuts(ALL, ['money.ledger', 'people.roster'], [
      { key: 'content.calendar', count: 9 },
      { key: 'money.ledger', count: 3 }
    ]);
    expect(s.map((x) => [x.key, x.pinned])).toEqual([
      ['money.ledger', true],
      ['people.roster', true],
      ['content.calendar', false]
    ]);
  });

  it('Shortcuts_UpToSix', () => {
    const opened = ALL.slice(1, 20).map((f, i) => ({ key: f.key, count: 20 - i }));
    expect(shortcuts(ALL, [], opened).length).toBe(SHORTCUT_LIMIT);
  });

  it('Shortcuts_SkipWhatThePersonCannotOpen', () => {
    const adv = visibleFeatures(FEATURES, { fullAdmin: false, capabilities: new Set<Capability>(['advancement.write']) });
    expect(shortcuts(adv, ['money.ledger'], [{ key: 'money.reconcile', count: 5 }])).toEqual([]);
  });

  it('RankOpens_MostFirst_TiesByMostRecent', () => {
    const rows = [
      { feature_key: 'money.ledger', at: '2026-11-10T10:00:00Z' },
      { feature_key: 'content.calendar', at: '2026-11-12T10:00:00Z' },
      { feature_key: 'money.ledger', at: '2026-11-11T10:00:00Z' },
      { feature_key: 'people.roster', at: '2026-11-15T10:00:00Z' },
      { feature_key: 'gone.feature', at: '2026-11-16T10:00:00Z' }
    ];
    expect(rankOpens(rows).map((r) => r.key)).toEqual(['money.ledger', 'people.roster', 'content.calendar']);
  });
});

describe('reports shelf', () => {
  it('Shelf_UpToEight_CountsThemAll', () => {
    const shelf = reportsShelf(ALL);
    expect([shelf.items.length, shelf.total]).toEqual([SHELF_LIMIT, ALL.filter((f) => f.kind === 'report').length]);
  });
});

describe('uncollected funds', () => {
  it('UncollectedFunds_SumsWreathAndEventFees_InCents', () => {
    expect(uncollectedTotals([{ total: '25.10' }, { total: 30.2 }], [{ balance: '10.05' }, { balance: 0.1 }])).toEqual({
      wreaths: 55.3,
      events: 10.15,
      total: 65.45
    });
  });

  it('UncollectedFunds_IgnoresCredits', () => {
    expect(uncollectedTotals([], [{ balance: -5 }, { balance: 5 }]).events).toBe(5);
  });
});

describe('missing BSA IDs', () => {
  const person = (id: number, o: Partial<PersonIn> = {}): PersonIn => ({
    id,
    display_name: `P${id}`,
    active: true,
    bsa_member_id: null,
    is_test: false,
    merged_into_person_id: null,
    ...o
  });
  const scout = (person_id: number, o: Partial<ScoutIn> = {}): ScoutIn => ({ person_id, active: true, is_webelos: false, current_rank: null, ...o });
  const people = [person(1), person(2, { bsa_member_id: '123' }), person(3), person(4), person(5), person(6, { active: false }), person(7, { is_test: true }), person(8)];
  const scouts = [scout(1), scout(2), scout(3, { active: false }), scout(8, { is_webelos: true })];
  const leaders: LeaderIn[] = [
    { person_id: 4, role: 'Scoutmaster' },
    { person_id: 5, role: null }, // sign-off initials only: a parent, not a leader
    { person_id: 6, role: 'Committee Chair' }, // inactive
    { person_id: 1, role: 'SPL' } // a scout: counted as a scout, not a leader
  ];

  it('MissingBsaIds_CountsActiveScoutsAndAdultLeadersOnly', () => {
    const m = missingBsaIds(people, scouts, leaders);
    expect([m.scouts.map((p) => p.personId), m.leaders.map((p) => p.personId)]).toEqual([[1], [4]]);
  });

  it('MissingBsaIds_AnAgedOutScoutWhoLeads_CountsAsALeader', () => {
    const m = missingBsaIds([person(1)], [scout(1, { active: false })], [{ person_id: 1, role: 'ASM' }]);
    expect(m.leaders.map((p) => p.personId)).toEqual([1]);
  });

  it('MissingBsaIds_ActiveScoutCount_LeavesOutTestPeopleAndWebelos', () => {
    expect(missingBsaIds(people, scouts, leaders).activeScouts).toBe(2);
  });

  it('MissingBsaIds_BlankCountsAsMissing', () => {
    const m = missingBsaIds([person(1, { bsa_member_id: '  ' })], [scout(1)], []);
    expect(m.scouts.length).toBe(1);
  });
});

describe('retired dashboard', () => {
  it('OldDashboardUrl_RedirectsToHome', async () => {
    const r = await nextConfig.redirects!();
    const to = (src: string) => r.find((x) => x.source === src)?.destination;
    expect([
      to('/admin/advancement/dashboard'),
      to('/admin/advancement/dashboard/logins'),
      to('/admin/advancement/dashboard/analytics')
    ]).toEqual(['/admin', '/admin/reports/sign-ins', '/admin/reports/analytics']);
  });
});

describe('this week', () => {
  it('ThisWeek_SkipsANoTroopMeetingEntry', async () => {
    const { loadThisWeek } = await import('../src/app/admin/(workspace)/_home/home-data');
    const meeting = { start_time: null, location: null, category: 'Troop Meeting', calendar_categories: { behavior: 'meeting' } };
    const rows = [
      { id: 1, entry_date: '2026-11-22', title: 'No Troop Meeting - Deliver Wreaths!', ...meeting },
      { id: 2, entry_date: '2026-11-29', title: 'Troop Meeting', ...meeting }
    ];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'in']) q[m] = () => q;
    q.limit = async () => ({ data: rows, error: null });
    const sb = {
      from: (t: string) => (t === 'calendar_categories' ? { select: () => ({ eq: async () => ({ data: [{ label: 'Troop Meeting' }], error: null }) }) } : q)
    };
    const week = await loadThisWeek(sb as never, '2026-11-16');
    expect([week.meeting?.entryId, week.comingUp.map((c) => c.id)]).toEqual([2, [1]]);
  });
});
