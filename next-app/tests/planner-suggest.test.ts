import { describe, it, expect } from 'vitest';
import {
  campoutShown,
  itemShown,
  noSuggestionText,
  onPlanOf,
  scoutItemsShown,
  scoutRowShown,
  sessionGroups,
  soloNeeds,
  suggestionsData,
  teacherKeysShown,
  teacherTarget,
  type PlanState,
  type SuggestFilter
} from '../src/lib/planner-suggest';
import type { MeetingPlanPayload, PlanByScout, PlanSession } from '../src/lib/meeting-plan-types';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Planner III Suggestions (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"), the pure half: the engine's
 * payload shaped for Group sessions (by III group), By scout and Teaching, the footers, and the filters (group, this
 * week's focus, what's on the plan). Adapted from Build a Plan B5/B9's tests. No database.
 */
const RANKS = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 },
  { id: 'life', display_name: 'Life', sort_order: 6 }
];
const ref = (id: string, rankId: string | null) => ({ id, name: `${id.toUpperCase()} Lastname`, patrol: null, rankId, rankLabel: rankId ?? 'New scout' });
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
const scoutRow = (r: ReturnType<typeof ref>, suggestions: PlanByScout['suggestions'], needsOuting: PlanByScout['needsOuting'] = [], o: Partial<PlanByScout> = {}): PlanByScout => ({
  scout: r,
  tier: 'new',
  suggestions,
  needsOuting,
  ...o
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
const NONE: SuggestFilter = { group: null, focusOnly: false, showOnPlan: true };
const PLAN = (onPlan: string[] = [], focus: string[] = []): PlanState => ({ onPlan, focus });

describe('suggestionsData', () => {
  it('MergesASplitCohort_IntoOneCardPerKey_WithEveryScout', () => {
    const d = suggestionsData(payload({ sessions: [session(1, 'tenderfoot-4a', [ref('a', 'scout'), ref('b', 'scout')], { groupPart: 'A' }), session(2, 'tenderfoot-4a', [ref('c', 'scout')], { groupPart: 'B' })] }), RANKS);
    expect(d.cards.map((c) => [c.key, c.need, c.scouts.map((s) => s.name)])).toEqual([['tenderfoot-4a', 3, ['A L', 'B L', 'C L']]]);
  });

  it('CardGroup_IsTheRequirementsRank_OrMeritBadge', () => {
    const d = suggestionsData(
      payload({ sessions: [session(1, 'second-class-2a', [ref('a', 'tenderfoot')]), session(2, 'first-aid-2', [ref('b', 'star')], { kind: 'mb', codeLabel: 'First Aid 2' })] }),
      RANKS,
      { 'first-aid-2': 'first-aid' }
    );
    expect(d.cards.map((c) => [c.key, c.group, c.mbId])).toEqual([
      ['second-class-2a', 'second-class', null],
      ['first-aid-2', 'mb', 'first-aid']
    ]);
  });

  it('CardScouts_CarryTheRankTheyHold_ForTheirChipColour', () => {
    const d = suggestionsData(payload({ sessions: [session(1, 'tenderfoot-4a', [ref('a', 'scout'), ref('b', null)])] }), RANKS);
    expect(d.cards[0].scouts.map((s) => [s.name, s.rankId])).toEqual([
      ['A L', 'scout'],
      ['B L', null]
    ]);
  });

  it('BestTeacher_IsAnAdultFirst_ThenCounselor_ThenScout', () => {
    const s = session(1, 'tenderfoot-4a', [ref('a', 'scout')], { adultTeachers: [{ code: '7', name: 'Dan Kowalski' }], scoutTeachers: [{ id: 'z', name: 'Finn Peters', rankLabel: 'Star' }] });
    const card = suggestionsData(payload({ sessions: [s] }), RANKS).cards[0];
    expect([card.best, card.others]).toEqual([{ name: 'Dan K', note: null }, [{ name: 'Finn P', note: 'Star scout' }]]);
  });

  it('ScoutItem_ReadsTheLongRankCode', () => {
    const d = suggestionsData(payload({ byScout: [scoutRow(ref('a', 'scout'), [{ key: 'tenderfoot-4a', kind: 'rank', codeLabel: 'TF 4a', label: 'First aid', eagle: false, sessionId: null }])] }), RANKS);
    expect(d.scouts[0].items.map((i) => [i.key, i.codeLabel, i.group])).toEqual([['tenderfoot-4a', 'Tenderfoot 4a', 'tenderfoot']]);
  });

  it('Scout_WorkingGroup_IsTheirNextRank_OrMeritBadgeFromFirstClass', () => {
    const d = suggestionsData(payload({ byScout: [scoutRow(ref('a', null), []), scoutRow(ref('b', 'tenderfoot'), []), scoutRow(ref('c', 'first-class'), []), scoutRow(ref('d', 'star'), [])] }), RANKS);
    expect(d.scouts.map((s) => s.group)).toEqual(['scout', 'second-class', 'mb', 'mb']);
  });

  it('Teacher_KeysTheirLargestSessionFirst', () => {
    const d = suggestionsData(
      payload({
        sessions: [session(1, 'scout-1a', [ref('a', null), ref('b', null)]), session(2, 'scout-2', [ref('a', null), ref('b', null), ref('c', null)])],
        rosterAdults: [{ code: '7', name: 'Dan Kowalski', role: 'ASM', skills: ['Knots'], sessionIds: [1, 2] }]
      }),
      RANKS
    );
    expect(d.teachers.map((t) => [t.name, t.personId, t.meta, t.skills, t.keys])).toEqual([['Dan K', 7, 'ASM', ['Knots'], ['scout-2', 'scout-1a']]]);
  });

  it('Campout_GathersTheScoutsWhoNeedEachItem', () => {
    const outing = [{ codeLabel: 'TF 1b', label: 'Campout', classes: ['C'] }];
    const d = suggestionsData(payload({ byScout: [scoutRow(ref('a', 'scout'), [], outing), scoutRow(ref('b', 'scout'), [], outing)] }), RANKS);
    expect(d.campout.map((c) => [c.codeLabel, c.scouts, c.groups, c.classes])).toEqual([['TF 1b', ['A L', 'B L'], ['tenderfoot'], ['C']]]);
  });

  it('NoSuggestion_NotPlannable_NamesTheSettingsLeft', () => {
    const d = suggestionsData(
      payload({
        requirementClasses: [
          { code: 'C', name: 'Campout' },
          { code: 'A', name: 'Pool' }
        ],
        byScout: [scoutRow(ref('a', 'scout'), [], [{ codeLabel: 'TF 1b', label: 'Camp', classes: ['C'] }, { codeLabel: 'SC 5a', label: 'Swim', classes: ['A'] }], { reason: 'not-plannable', reasonRankId: 'tenderfoot' })]
      }),
      RANKS
    );
    expect(d.scouts[0].reason).toBe('Everything left needs another setting: Campout, Pool');
  });

  it('SurvivesAJsonRoundTrip', () => {
    // Cached (unstable_cache: JSON values only) and streamed to the client: no Map, Set, Date or undefined in it.
    const d = suggestionsData(
      payload({
        sessions: [session(1, 'tenderfoot-4a', [ref('a', 'scout'), ref('b', 'scout')], { adultTeachers: [{ code: '7', name: 'Dan Kowalski' }], skillName: 'First aid' })],
        byScout: [scoutRow(ref('a', 'scout'), [{ key: 'tenderfoot-4a', kind: 'rank', codeLabel: 'TF 4a', label: 'First aid', eagle: false, sessionId: 1 }], [{ codeLabel: 'TF 1b', label: 'Campout' }])],
        rosterAdults: [{ code: '7', name: 'Dan Kowalski', role: 'ASM', skills: ['First aid'], sessionIds: [1] }]
      }),
      RANKS
    );
    expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  });
});

describe('noSuggestionText', () => {
  it('WordsEveryCode', () => {
    expect((['bor-next', 'no-mb', 'smc-waiting', 'not-plannable', 'finished'] as const).map((c) => noSuggestionText(c, 'First Class', []))).toEqual([
      'Ready for the First Class board of review',
      'No merit badge in progress or with a counselor',
      'Nothing to plan: Scoutmaster conference waits for 95% of First Class',
      'Only time-based or Scout spirit items left',
      'Nothing left to suggest at a meeting'
    ]);
  });
});

describe('filters', () => {
  it('OnPlan_IsAPlanTopic_OrInThisWeeksFocus', () => {
    const plan = PLAN(['tenderfoot-3a'], ['tenderfoot-4a']);
    expect(['tenderfoot-3a', 'tenderfoot-4a', 'tenderfoot-5'].map((k) => onPlanOf(k, plan))).toEqual([true, true, false]);
  });

  it('ItemShown_FollowsGroupFocusAndOnPlan', () => {
    const tf = { key: 'tenderfoot-4a', kind: 'rank' as const, group: 'tenderfoot' };
    const mb = { key: 'first-aid-2', kind: 'mb' as const, group: 'mb' };
    const plan = PLAN([], ['tenderfoot-4a']);
    expect([
      itemShown(tf, PLAN(), NONE),
      itemShown(tf, PLAN(), { ...NONE, group: 'scout' }),
      itemShown(mb, PLAN(), { ...NONE, group: 'mb' }),
      itemShown(mb, plan, { ...NONE, focusOnly: true }),
      itemShown(tf, plan, { ...NONE, focusOnly: true }),
      itemShown(tf, plan, { ...NONE, showOnPlan: false })
    ]).toEqual([true, false, true, false, true, false]);
  });

  it('ScoutItemsShown_KeepsOnlyMatchingItems', () => {
    const items = DATA.scouts[0].items;
    expect(scoutItemsShown(items, PLAN(['tenderfoot-3a']), { ...NONE, showOnPlan: false }).map((i) => i.key)).toEqual(['tenderfoot-4a', 'tenderfoot-5']);
  });

  it('ScoutRowShown_NoItems_FollowsTheGroupFilterByWorkingGroup', () => {
    const sc = { items: [], group: 'tenderfoot' };
    expect([scoutRowShown(sc, 0, NONE), scoutRowShown(sc, 0, { ...NONE, group: 'tenderfoot' }), scoutRowShown(sc, 0, { ...NONE, group: 'scout' }), scoutRowShown(sc, 0, { ...NONE, focusOnly: true })]).toEqual([
      true,
      true,
      false,
      false
    ]);
  });

  it('TeacherKeysShown_FiltersTheirSessions', () => {
    const byKey = new Map([
      ['scout-1a', { key: 'scout-1a', kind: 'rank' as const, group: 'scout' }],
      ['first-aid-2', { key: 'first-aid-2', kind: 'mb' as const, group: 'mb' }]
    ]);
    expect(teacherKeysShown(['scout-1a', 'first-aid-2'], byKey, PLAN(), { ...NONE, group: 'mb' })).toEqual(['first-aid-2']);
  });

  it('CampoutShown_FollowsTheGroupFilter', () => {
    expect([campoutShown({ groups: ['scout'] }, NONE), campoutShown({ groups: ['scout'] }, { ...NONE, group: 'mb' })]).toEqual([true, false]);
  });
});

describe('Group sessions and solo needs', () => {
  it('SessionGroups_AreTheIIIGroupsInOrder_MostNeededFirst_TwoOrMoreOnly', () => {
    const groups = sessionGroups(DATA, PLAN(), NONE);
    expect(groups.map((g) => [g.id, g.label, g.cards.map((c) => c.key)])).toEqual([
      ['scout', 'Scout group', ['scout-2']],
      ['tenderfoot', 'Tenderfoot group', ['tenderfoot-4a']],
      ['mb', 'Merit badge group', ['first-aid-2']]
    ]);
  });

  it('SoloNeeds_ListsWhatOnlyOneScoutNeeds', () => {
    // The fixture's one scout has 4a (a card), 3a and 5 (no card); the one-scout card first-aid-1 is solo too.
    expect(soloNeeds(DATA).map((n) => [n.item.key, n.scout.name])).toEqual([
      ['first-aid-1', 'Veronica K'],
      ['tenderfoot-3a', 'Anjali S'],
      ['tenderfoot-5', 'Anjali S']
    ]);
  });
});

describe('teacherTarget', () => {
  it('InFocus_IsItsGroupsSlot_OnThePlan_IsItsOwn_ElseItNeedsAdding', () => {
    const tf = { key: 'tenderfoot-4a', kind: 'rank' as const, group: 'tenderfoot', mbId: null };
    const mb = { key: 'first-aid-2', kind: 'mb' as const, group: 'mb', mbId: 'first-aid' };
    expect([
      teacherTarget(tf, PLAN([], ['tenderfoot-4a'])),
      teacherTarget(mb, PLAN([], ['first-aid-2'])),
      teacherTarget(tf, PLAN(['tenderfoot-4a'])),
      teacherTarget(tf, PLAN())
    ]).toEqual([
      { key: 'fr:tenderfoot', add: false },
      { key: 'fr:mb:first-aid', add: false },
      { key: 'tenderfoot-4a', add: false },
      { key: 'tenderfoot-4a', add: true }
    ]);
  });
});
