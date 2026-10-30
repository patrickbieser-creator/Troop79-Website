import { describe, it, expect } from 'vitest';
import { buildMeetingPlan, type EngineInput, type EngineRankReqRow } from '../src/lib/meeting-suggest/engine';
import { suggestionsData } from '../src/lib/planner-suggest';

/**
 * Planner III Suggestions: the engine reports every active scout, one with no suggestion carrying a reason code, and
 * By scout lists them all, worded (ported from Build a Plan B9's tests when the screen came back). No database.
 */
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 }
];
const tf = (id: number, code: string): EngineRankReqRow => ({
  id, rank_id: 'tenderfoot', parent_id: null, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, class_codes: [], skill_id: null
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
    rankReqs: [tf(1, '3a'), { ...tf(2, '9'), class_codes: ['L'] }, tf(3, '10')],
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

describe('By scout', () => {
  const plan = buildMeetingPlan(input([scout('a', 'scout'), scout('e', 'scout'), scout('f', 'first-class')], signed('e', 'tenderfoot-3a')));
  const data = suggestionsData(plan, ranks);

  it('ByScout_ListsEveryActiveScout', () => {
    expect(data.scouts.map((s) => s.id).sort()).toEqual(['a', 'e', 'f']);
  });

  it('ByScout_Reason_IsWordedWithTheRank', () => {
    expect(data.scouts.find((s) => s.id === 'e')?.reason).toBe('Nothing to plan: Scoutmaster conference waits for 95% of Tenderfoot');
  });
});

describe('B9 qa follow-ups', () => {
  const rq = (rank: string, id: number, code: string): EngineRankReqRow => ({ ...tf(id, code), rank_id: rank });
  const withStar = (scouts: EngineInput['scouts'], ledger: { scout_id: string; code: string }[], o: Partial<EngineInput> = {}): EngineInput => {
    const base = input(scouts, ledger);
    // Star: 1 (time-based, never planned) and 7 (the Scoutmaster conference).
    return { ...base, rankReqs: [...base.rankReqs, { ...rq('star', 11, '1'), class_codes: ['L'] }, rq('star', 12, '7')], ...o };
  };
  it('Engine_OnlyTimeBasedLeft_ReasonIsNotPlannable', () => {
    expect(reasonOf(input([scout('e', 'scout')], signed('e', 'tenderfoot-3a', 'tenderfoot-10')), 'e')).toEqual({ reason: 'not-plannable', rankId: 'tenderfoot' });
  });

  it('Engine_StarAndUp_NoMbWinsOverSmcWaiting', () => {
    // Star 7 waits for 95% (Star 1 is open), and there is no badge to work on: no-mb is said first.
    expect(reasonOf(withStar([scout('f', 'first-class')], []), 'f')).toEqual({ reason: 'no-mb', rankId: null });
  });

  it('Engine_EagleScout_NoBadge_ReasonIsFinished', () => {
    // Star is the last rank here, so a Star scout's next rank is null (an Eagle scout's, in the real catalog).
    expect(reasonOf(withStar([scout('g', 'star')], []), 'g')).toEqual({ reason: 'finished', rankId: null });
  });

});
