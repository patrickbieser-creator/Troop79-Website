import { describe, it, expect } from 'vitest';
import { buildMeetingPlan, type EngineInput, type EngineRankReqRow } from '../src/lib/meeting-suggest/engine';
import { noSuggestionText, scoutRowShown, soloNeeds, suggestionsData, type SuggestFilter } from '../src/lib/build-plan-suggest';
import { orphanScouts, orphansData, orphansLabel, orphanUniverse } from '../src/lib/build-plan-orphans';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan B9 (Plans/Build-A-Plan.md, "B9: Finding orphans"), the pure half: the engine reports every active scout
 * (one with no suggestion carries a reason code), By Scout lists them all, Group Sessions' Solo needs, and the orphan
 * count's rule. No database (the count's read and its round trips: build-plan-b9-orphans-db.test.ts).
 */
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 }
];
const tf = (id: number, code: string): EngineRankReqRow => ({
  id, rank_id: 'tenderfoot', parent_id: null, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, venue: 'meeting', skill_id: null
});
const scout = (id: string, rank: string | null): EngineInput['scouts'][number] => ({
  id, display_name: `Scout ${id}`, patrol: null, current_rank: rank, person_id: id.charCodeAt(0), graduation_year: 2030, junior_leader_override: null
});
const signed = (id: string, ...codes: string[]) => codes.map((code) => ({ scout_id: id, code }));

/** Tenderfoot: 3a (a meeting requirement), 9 (Scout spirit: never planned), 10 (the Scoutmaster conference). */
function input(scouts: EngineInput['scouts'], ledger: { scout_id: string; code: string }[]): EngineInput {
  return {
    meetingDate: '2026-10-25',
    title: 'Test meeting',
    generatedAt: '2026-10-22T00:00:00.000Z',
    scouts,
    ranks,
    rankReqs: [tf(1, '3a'), tf(2, '9'), tf(3, '10')],
    mbs: [],
    mbReqs: [],
    mbProgress: [],
    rankReqLedger: ledger,
    mbReqLedger: [],
    skills: [],
    adults: [],
    teachingSkills: [],
    counselors: []
  };
}
const reasonOf = (inp: EngineInput, id: string) => {
  const row = buildMeetingPlan(inp).byScout.find((r) => r.scout.id === id);
  return row ? { reason: row.reason, rankId: row.reasonRankId } : 'skipped';
};
const NONE: SuggestFilter = { rank: null, mbOnly: false, showOnPlan: true };

describe('B9 engine: every scout, with a reason', () => {
  it('Engine_ReportsScoutWithNoSuggestion_WithReason', () => {
    // 3a done; 9 can't be planned, so the conference waits for 95% of Tenderfoot.
    expect(reasonOf(input([scout('e', 'scout')], signed('e', 'tenderfoot-3a')), 'e')).toEqual({ reason: 'smc-waiting', rankId: 'tenderfoot' });
  });

  it('Engine_EverythingButTheBoardDone_ReasonIsBorNext', () => {
    expect(reasonOf(input([scout('e', 'scout')], signed('e', 'tenderfoot-3a', 'tenderfoot-9', 'tenderfoot-10')), 'e')).toEqual({ reason: 'bor-next', rankId: 'tenderfoot' });
  });

  it('Engine_StarAndUp_NoBadgeToWorkOn_ReasonIsNoMb', () => {
    expect(reasonOf(input([scout('f', 'first-class')], []), 'f')).toEqual({ reason: 'no-mb', rankId: null });
  });

  it('Engine_RankAllSignedOff_ReasonIsFinished', () => {
    expect(reasonOf(input([scout('e', 'scout')], signed('e', 'tenderfoot-3a', 'tenderfoot-9', 'tenderfoot-10', 'tenderfoot-BoR')), 'e')).toEqual({ reason: 'finished', rankId: null });
  });

  it('Engine_ScoutWithASuggestion_HasNoReason', () => {
    expect(reasonOf(input([scout('e', 'scout')], []), 'e')).toEqual({ reason: null, rankId: null });
  });

  it('Engine_StillCountsOnlyScoutsWithSuggestions_InItsStats', () => {
    expect(buildMeetingPlan(input([scout('a', 'scout'), scout('e', 'scout')], signed('e', 'tenderfoot-3a'))).stats.scoutsWithSuggestions).toBe(1);
  });
});

describe('B9 By Scout', () => {
  const plan = buildMeetingPlan(input([scout('a', 'scout'), scout('e', 'scout'), scout('f', 'first-class')], signed('e', 'tenderfoot-3a')));
  const data = suggestionsData(plan, ranks);

  it('ByScout_ListsEveryActiveScout', () => {
    expect(data.scouts.map((s) => s.id).sort()).toEqual(['a', 'e', 'f']);
  });

  it('ByScout_Reason_IsWordedWithTheRank', () => {
    expect(data.scouts.find((s) => s.id === 'e')?.reason).toBe('Nothing to plan: Scoutmaster conference waits for 95% of Tenderfoot');
  });

  it('NoSuggestionText_WordsEveryCode', () => {
    expect((['bor-next', 'no-mb', 'smc-waiting', 'not-plannable', 'finished'] as const).map((c) => noSuggestionText(c, 'First Class'))).toEqual([
      'Ready for the First Class board of review',
      'No merit badge in progress',
      'Nothing to plan: Scoutmaster conference waits for 95% of First Class',
      'Only time-based, Scout spirit or campout items left',
      'Finished everything plannable'
    ]);
  });

  it('ScoutRowShown_NoItems_FollowsTheRankFilterByNextRank', () => {
    const sc = { items: [], nextRankId: 'tenderfoot' };
    expect([scoutRowShown(sc, 0, NONE), scoutRowShown(sc, 0, { ...NONE, rank: 'tenderfoot' }), scoutRowShown(sc, 0, { ...NONE, rank: 'scout' }), scoutRowShown(sc, 0, { ...NONE, mbOnly: true })]).toEqual([
      true,
      true,
      false,
      false
    ]);
  });
});

describe('B9 Solo needs', () => {
  it('SoloNeeds_ListsSelectionsWithNoSessionCard', () => {
    // The fixture's one scout has 4a (a card), 3a and 5 (no card).
    expect(soloNeeds(DATA).map((n) => [n.item.key, n.scout])).toEqual([
      ['tenderfoot-3a', 'Anjali S'],
      ['tenderfoot-5', 'Anjali S']
    ]);
  });
});

describe('B9 orphans', () => {
  const eligible = [
    { personId: 1, scoutId: 'a', name: 'Ann A', picked: [] },
    { personId: 2, scoutId: 'b', name: 'Ben B', picked: ['ff:9'] },
    { personId: 3, scoutId: 'c', name: 'Cal C', picked: [] }
  ];
  const byKey = new Map([
    ['tenderfoot-4a', [{ personId: 1, likely: true, ticked: true }, { personId: 3, likely: false, ticked: true }]],
    ['tenderfoot-3a', [{ personId: 3, likely: true, ticked: true }]]
  ]);
  const data = orphansData(eligible, byKey, { scouts: [] });

  it('Orphans_CountsScoutsWithNoLikelyOffering', () => {
    // On the plan: 4a (Ann is likely; Cal is only eligible) and Ben's own pick.
    expect(orphanScouts(data, new Set(['tenderfoot-4a', 'ff:9'])).map((s) => s.name)).toEqual(['Cal C']);
  });

  it('Orphans_AddOfAUniverseKey_RecountsExactly', () => {
    expect(orphanScouts(data, new Set(['tenderfoot-4a', 'ff:9', 'tenderfoot-3a'])).length).toBe(0);
  });

  it('OrphansLabel_ZeroIsNothing', () => {
    expect([orphansLabel(0), orphansLabel(1), orphansLabel(3)]).toEqual([null, '1 scout has nothing on this plan', '3 scouts have nothing on this plan']);
  });

  it('OrphanUniverse_IsThePlanThenEverySuggestion_Once', () => {
    expect(orphanUniverse(['fg:1', 'tenderfoot-4a'], DATA)).toEqual(['fg:1', 'tenderfoot-4a', 'scout-2', 'tenderfoot-3a', 'tenderfoot-5']);
  });
});
