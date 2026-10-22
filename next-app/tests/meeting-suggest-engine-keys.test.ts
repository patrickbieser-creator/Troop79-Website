import { describe, it, expect } from 'vitest';
import { buildMeetingPlan, type EngineInput, type EngineMbReqRow, type EngineRankReqRow } from '../src/lib/meeting-suggest/engine';

/**
 * Build a Plan B0 (Plans/Build-A-Plan.md): a suggestion carries the planner board's topic key, so Build can Add it
 * as a meeting_topics row. A merit badge suggestion is one requirement, never the whole badge (Meeting Planner II,
 * Decision 10). Pure; no database.
 */
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 }
];
const rankReq = (id: number, code: string): EngineRankReqRow => ({
  id, rank_id: 'tenderfoot', parent_id: null, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, venue: 'meeting', skill_id: null
});
const mbReq = (id: number, code: string, parent: number | null): EngineMbReqRow => ({
  id, mb_id: 'first-aid', parent_id: parent, code, label: `First Aid ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, venue: 'meeting'
});
const scout = (id: string, personId: number, rank: string | null): EngineInput['scouts'][number] => ({
  id, display_name: `Scout ${id}`, patrol: null, current_rank: rank, person_id: personId, graduation_year: 2030, junior_leader_override: null
});

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    meetingDate: '2026-10-25',
    title: 'Test meeting',
    generatedAt: '2026-10-22T00:00:00.000Z',
    scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout')],
    ranks,
    rankReqs: [rankReq(1, '3a')],
    mbs: [{ id: 'first-aid', name: 'First Aid', eagle: true }],
    // First Aid 1 has two parts; 2 is a single requirement.
    mbReqs: [mbReq(10, '1', null), mbReq(11, '1a', 10), mbReq(12, '1b', 10), mbReq(13, '2', null)],
    mbProgress: [],
    rankReqLedger: [],
    mbReqLedger: [],
    skills: [],
    adults: [],
    teachingSkills: [],
    counselors: [],
    ...over
  } as EngineInput;
}

/** Two scouts working toward Star with First Aid in progress: 1a done, 1b and 2 not. */
const olderScouts = (): Partial<EngineInput> => ({
  scouts: [scout('c', 3, 'first-class'), scout('d', 4, 'first-class')],
  mbProgress: [
    { mb_id: 'first-aid', scout_id: 'c', awarded: false, has_any_req: true },
    { mb_id: 'first-aid', scout_id: 'd', awarded: false, has_any_req: true }
  ],
  mbReqLedger: [
    { scout_id: 'c', code: 'first-aid-1a' },
    { scout_id: 'd', code: 'first-aid-1a' }
  ]
});

describe('suggestion engine: board keys (Build a Plan B0)', () => {
  it('Engine_Suggestion_CarriesBoardKey', () => {
    const plan = buildMeetingPlan(input());
    expect(plan.sessions.map((s) => s.key)).toEqual(['tenderfoot-3a']);
  });

  it('Engine_ScoutSuggestion_CarriesTheSameBoardKeyAsItsSession', () => {
    const plan = buildMeetingPlan(input());
    expect(plan.byScout.flatMap((r) => r.suggestions.map((s) => s.key))).toEqual(['tenderfoot-3a', 'tenderfoot-3a']);
  });

  it('Engine_MeritBadge_SuggestsRequirementKeyNotWholeBadge', () => {
    const plan = buildMeetingPlan(input(olderScouts()));
    expect(plan.sessions.filter((s) => s.kind === 'mb').map((s) => s.key)).toEqual(['first-aid-1']);
  });

  it('Engine_MeritBadge_SkipsATopLevelRequirementAlreadyDone', () => {
    const done = olderScouts();
    done.mbReqLedger = [...done.mbReqLedger!, { scout_id: 'c', code: 'first-aid-1b' }, { scout_id: 'd', code: 'first-aid-1b' }];
    const plan = buildMeetingPlan(input(done));
    expect(plan.sessions.filter((s) => s.kind === 'mb').map((s) => s.key)).toEqual(['first-aid-2']);
  });

  it('Engine_MeritBadgeSession_ReadsAsTheRequirement', () => {
    const plan = buildMeetingPlan(input(olderScouts()));
    const mb = plan.sessions.find((s) => s.kind === 'mb')!;
    expect([mb.codeLabel, mb.title]).toEqual(['First Aid 1', 'First Aid 1']);
  });
});
