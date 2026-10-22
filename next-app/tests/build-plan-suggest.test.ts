import { describe, it, expect } from 'vitest';
import { addChunks, campoutShown, cardShown, scoutItemsShown, suggestionsData, teacherKeysShown, type SuggestFilter } from '../src/lib/build-plan-suggest';
import type { MeetingPlanPayload, PlanByScout, PlanSession } from '../src/lib/meeting-plan-types';

/**
 * Build a Plan B5 (Plans/Build-A-Plan.md, Suggestions mode), the pure half: the engine's payload shaped for the three
 * lenses (Group Sessions, By Scout, Teaching) and the campout footer, and the filters. No database.
 */
const RANKS = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 },
  { id: 'life', display_name: 'Life', sort_order: 6 }
];
const ref = (id: string, rankId: string | null) => ({ id, name: `${id.toUpperCase()} Lastname`, patrol: null, rankId, rankLabel: rankId ?? '—' });
const session = (id: number, key: string, scouts: ReturnType<typeof ref>[], extra: Partial<PlanSession> = {}): PlanSession => ({
  id,
  key,
  tier: 'new',
  kind: 'rank',
  codeLabel: key,
  title: `Title ${key}`,
  eagle: false,
  skillId: null,
  skillName: null,
  youthTeachable: false,
  adultOnly: false,
  groupPart: null,
  scouts,
  adultTeachers: [],
  counselors: [],
  scoutTeachers: [],
  ...extra
});
const scoutRow = (r: ReturnType<typeof ref>, suggestions: PlanByScout['suggestions'], needsOuting: PlanByScout['needsOuting'] = []): PlanByScout => ({
  scout: r,
  tier: 'new',
  suggestions,
  needsOuting
});
const payload = (p: Partial<MeetingPlanPayload>): MeetingPlanPayload => ({
  version: 1,
  meetingDate: '2086-03-01',
  title: 'Troop Meeting',
  generatedAt: '',
  stats: { scoutsWithSuggestions: 0, sessions: 0, adultsMatched: 0, scoutInstructors: 0, outingItems: 0 },
  sessions: [],
  byScout: [],
  rosterAdults: [],
  rosterScoutInstructors: [],
  ...p
});
const NONE: SuggestFilter = { rank: null, mbOnly: false, showOnPlan: true };

describe('Suggestions mode (pure)', () => {
  it('SuggestionsData_MergesASplitCohort_IntoOneCardPerKey', () => {
    const a = [ref('a', 'scout'), ref('b', 'scout')];
    const b = [ref('c', 'scout'), ref('d', 'scout')];
    const d = suggestionsData(payload({ sessions: [session(1, 'tenderfoot-4a', a, { groupPart: 'A' }), session(2, 'tenderfoot-4a', b, { groupPart: 'B' })] }), RANKS);
    expect(d.cards.map((c) => [c.key, c.need, c.groups.map((g) => [g.part, g.scouts])])).toEqual([
      ['tenderfoot-4a', 4, [['A', ['A L', 'B L']], ['B', ['C L', 'D L']]]]
    ]);
  });

  it('SuggestionsData_CardRank_IsTheRequirementsRank', () => {
    const d = suggestionsData(payload({ sessions: [session(1, 'second-class-2a', [ref('a', 'tenderfoot')]), session(2, 'scout-1a', [ref('b', null)])] }), RANKS);
    expect(d.cards.map((c) => [c.key, c.rankId, c.codeLabel])).toEqual([
      ['second-class-2a', 'second-class', 'second-class-2a'],
      ['scout-1a', 'scout', 'scout-1a']
    ]);
  });

  it('SuggestionsData_BestTeacher_IsAnAdultFirst_ThenCounselor_ThenScout', () => {
    const s = session(1, 'tenderfoot-4a', [ref('a', 'scout')], {
      adultTeachers: [{ code: '7', name: 'Dan Kowalski' }],
      scoutTeachers: [{ id: 'z', name: 'Finn Peters', rankLabel: 'Star' }]
    });
    const card = suggestionsData(payload({ sessions: [s] }), RANKS).cards[0];
    expect([card.best, card.others]).toEqual([{ name: 'Dan K', note: null }, [{ name: 'Finn P', note: 'Star scout' }]]);
  });

  it('SuggestionsData_MeritBadgeCard_FiltersByItsScoutsNextRank', () => {
    const s = session(1, 'first-aid-2', [ref('a', 'first-class'), ref('b', 'star')], { kind: 'mb', tier: 'older', codeLabel: 'First Aid 2' });
    expect(suggestionsData(payload({ sessions: [s] }), RANKS).cards[0].ranks).toEqual(['star', 'life']);
  });

  it('SuggestionsData_ScoutItem_ReadsTheLongRankCode', () => {
    const d = suggestionsData(
      payload({ byScout: [scoutRow(ref('a', 'scout'), [{ key: 'tenderfoot-4a', kind: 'rank', codeLabel: 'TF 4a', label: 'First aid', eagle: false, sessionId: null }])] }),
      RANKS
    );
    expect(d.scouts[0].items.map((i) => [i.key, i.codeLabel, i.ranks])).toEqual([['tenderfoot-4a', 'Tenderfoot 4a', ['tenderfoot']]]);
  });

  it('SuggestionsData_Teacher_KeysTheirLargestSessionFirst', () => {
    const d = suggestionsData(
      payload({
        sessions: [session(1, 'scout-1a', [ref('a', null), ref('b', null)]), session(2, 'scout-2', [ref('a', null), ref('b', null), ref('c', null)])],
        rosterAdults: [{ code: '7', name: 'Dan Kowalski', role: 'ASM', skills: ['Knots'], sessionIds: [1, 2] }]
      }),
      RANKS
    );
    expect(d.teachers.map((t) => [t.name, t.meta, t.skills, t.keys])).toEqual([['Dan K', 'ASM', ['Knots'], ['scout-2', 'scout-1a']]]);
  });

  it('SuggestionsData_Campout_GathersTheScoutsWhoNeedEachItem', () => {
    const outing = [{ codeLabel: 'TF 1b', label: 'Campout' }];
    const d = suggestionsData(payload({ byScout: [scoutRow(ref('a', 'scout'), [], outing), scoutRow(ref('b', 'scout'), [], outing)] }), RANKS);
    expect(d.campout.map((c) => [c.codeLabel, c.scouts, c.ranks])).toEqual([['TF 1b', ['A L', 'B L'], ['tenderfoot']]]);
  });

  it('SuggestionsData_Ranks_ListOnlyTheRanksInPlay_InOrder', () => {
    const d = suggestionsData(payload({ sessions: [session(1, 'second-class-2a', [ref('a', 'tenderfoot')]), session(2, 'scout-1a', [ref('b', null)])] }), RANKS);
    expect(d.ranks).toEqual([
      { id: 'scout', label: 'Scout' },
      { id: 'second-class', label: 'Second Class' }
    ]);
  });

  it('CardShown_FollowsRankMbOnlyAndOnPlan', () => {
    const rank = { kind: 'rank' as const, ranks: ['tenderfoot'] };
    const mb = { kind: 'mb' as const, ranks: ['star'] };
    expect([
      cardShown(rank, false, NONE),
      cardShown(rank, false, { ...NONE, rank: 'scout' }),
      cardShown(rank, false, { ...NONE, mbOnly: true }),
      cardShown(mb, false, { ...NONE, mbOnly: true, rank: 'star' }),
      cardShown(rank, true, { ...NONE, showOnPlan: false })
    ]).toEqual([true, false, false, true, false]);
  });

  it('ScoutItemsShown_KeepsOnlyMatchingItems', () => {
    const items = [
      { key: 'a', codeLabel: 'A', title: 'A', kind: 'rank' as const, eagle: false, ranks: ['star'] },
      { key: 'b', codeLabel: 'B', title: 'B', kind: 'mb' as const, eagle: false, ranks: ['star'] }
    ];
    expect(scoutItemsShown(items, new Set(['b']), { ...NONE, mbOnly: true, showOnPlan: false }).map((i) => i.key)).toEqual([]);
  });

  it('TeacherKeysShown_FiltersTheirSessions', () => {
    const byKey = new Map([
      ['scout-1a', { kind: 'rank' as const, ranks: ['scout'] }],
      ['first-aid-2', { kind: 'mb' as const, ranks: ['star'] }]
    ]);
    expect(teacherKeysShown(['scout-1a', 'first-aid-2'], byKey, new Set(), { ...NONE, mbOnly: true })).toEqual(['first-aid-2']);
  });

  it('CampoutShown_HidesUnderMbOnly', () => {
    expect([campoutShown({ ranks: ['scout'] }, NONE), campoutShown({ ranks: ['scout'] }, { ...NONE, mbOnly: true })]).toEqual([true, false]);
  });

  it('SuggestionsData_SurvivesAJsonRoundTrip', () => {
    // It is cached (unstable_cache: JSON values only) and streamed to the client: no Map, Set, Date or undefined in it.
    const d = suggestionsData(
      payload({
        sessions: [
          session(1, 'tenderfoot-4a', [ref('a', 'scout'), ref('b', 'scout')], { groupPart: 'A', adultTeachers: [{ code: '7', name: 'Dan Kowalski' }], skillName: 'First aid' }),
          session(2, 'first-aid-2', [ref('c', 'first-class'), ref('d', 'star')], { kind: 'mb', tier: 'older', codeLabel: 'First Aid 2', scoutTeachers: [{ id: 'z', name: 'Finn Peters', rankLabel: 'Star' }] })
        ],
        byScout: [scoutRow(ref('a', 'scout'), [{ key: 'tenderfoot-4a', kind: 'rank', codeLabel: 'TF 4a', label: 'First aid', eagle: false, sessionId: 1 }], [{ codeLabel: 'TF 1b', label: 'Campout' }])],
        rosterAdults: [{ code: '7', name: 'Dan Kowalski', role: 'ASM', skills: ['First aid'], sessionIds: [1] }]
      }),
      RANKS
    );
    expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  });

  it('AddChunks_SplitAtTheActionsCap', () => {
    expect(addChunks(Array.from({ length: 45 }, (_, i) => i)).map((c) => c.length)).toEqual([20, 20, 5]);
  });
});
