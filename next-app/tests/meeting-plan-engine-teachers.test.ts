import { describe, it, expect } from 'vitest';
import { buildMeetingPlan, type EngineInput, type EngineRankReqRow } from '../src/lib/meeting-suggest/engine';

/**
 * The meeting engine's teacher matching, keyed to people (Plans/Meeting-Requests-And-Teaching-Offers.md, Phase 0a):
 * one teaching_skills table for adults and scouts, counselors by person, parents with no leader code count, and the
 * scout-teacher gate is canOfferToTeach (First Class+ or Junior Leader), no longer Star+. Pure; no database.
 */
const MEETING = '2026-10-25';
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 }
];
const req = (id: number, code: string, skill: string | null): EngineRankReqRow => ({
  id, rank_id: 'tenderfoot', parent_id: null, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, venue: 'meeting', skill_id: skill
});
const scout = (id: string, personId: number, rank: string | null, over: Partial<EngineInput['scouts'][number]> = {}): EngineInput['scouts'][number] => ({
  id, display_name: `Scout ${id}`, patrol: null, current_rank: rank, person_id: personId, graduation_year: 2033, junior_leader_override: null, ...over
});

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    meetingDate: MEETING,
    title: 'Test meeting',
    generatedAt: '2026-10-18T00:00:00.000Z',
    // Two new scouts needing Tenderfoot 3 (knots) and 4 (first aid) make the group sessions.
    scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout')],
    ranks,
    rankReqs: [req(1, '3', 'knots'), req(2, '4', 'first-aid')],
    mbs: [],
    mbReqs: [],
    mbProgress: [],
    rankReqLedger: [],
    mbReqLedger: [],
    skills: [
      { id: 'knots', name: 'Knots & Lashings', youth_teachable: true, sort_order: 1 },
      { id: 'first-aid', name: 'First Aid', youth_teachable: false, sort_order: 2 }
    ],
    adults: [],
    teachingSkills: [],
    counselors: [],
    ...over
  } as EngineInput;
}
const session = (plan: ReturnType<typeof buildMeetingPlan>, skill: string) => plan.sessions.find((s) => s.skillId === skill)!;

describe('meeting engine teachers', () => {
  it('Engine_ParentWithoutLeaderCode_TeachesTheirSkill', () => {
    const plan = buildMeetingPlan(input({ adults: [{ personId: 500, name: 'Dana Parent', role: null }], teachingSkills: [{ person_id: 500, skill_id: 'knots' }] }));
    expect(session(plan, 'knots').adultTeachers.map((t) => t.name)).toEqual(['Dana Parent']);
  });

  it('Engine_FirstClassScout_TeachesAYouthTeachableSkill', () => {
    const plan = buildMeetingPlan(input({ scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout'), scout('c', 3, 'first-class')], teachingSkills: [{ person_id: 3, skill_id: 'knots' }] }));
    expect(session(plan, 'knots').scoutTeachers.map((t) => t.id)).toEqual(['c']);
  });

  it('Engine_YoungerScoutWithTheSkill_IsNotOffered_UnlessJuniorLeader', () => {
    const young = scout('c', 3, 'second-class');
    const jl = scout('c', 3, 'second-class', { junior_leader_override: 'yes' });
    const skills = [{ person_id: 3, skill_id: 'knots' }];
    expect(session(buildMeetingPlan(input({ scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout'), young], teachingSkills: skills })), 'knots').scoutTeachers).toEqual([]);
    expect(session(buildMeetingPlan(input({ scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout'), jl], teachingSkills: skills })), 'knots').scoutTeachers.map((t) => t.id)).toEqual(['c']);
  });

  it('Engine_ScoutWithAnAdultOnlySkillRow_IsNeverOfferedForIt', () => {
    const plan = buildMeetingPlan(input({ scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout'), scout('c', 3, 'star')], teachingSkills: [{ person_id: 3, skill_id: 'first-aid' }] }));
    const s = session(plan, 'first-aid');
    expect([s.adultTeachers, s.scoutTeachers]).toEqual([[], []]);
  });

  it('Engine_RosterAdults_ListsEveryAdultWithSkills_KeyedByPerson', () => {
    const plan = buildMeetingPlan(input({ adults: [{ personId: 500, name: 'Dana Parent', role: null }], teachingSkills: [{ person_id: 500, skill_id: 'knots' }] }));
    expect(plan.rosterAdults.map((a) => [a.code, a.name, a.skills])).toEqual([['500', 'Dana Parent', ['Knots & Lashings']]]);
  });

  it('Engine_SummerCampSource_FillsTheCounselorSlot', () => {
    // Two Star scouts with Art in progress get an MB session; Summer Camp (council camp staff) is its counselor.
    const plan = buildMeetingPlan(
      input({
        scouts: [scout('e', 5, 'star'), scout('f', 6, 'star')],
        ranks: [...ranks, { id: 'life', display_name: 'Life', sort_order: 6 }],
        rankReqs: [],
        mbs: [{ id: 'art', name: 'Art', eagle: false }],
        mbReqs: [{ id: 9, mb_id: 'art', parent_id: null, code: '1', label: 'Art 1', complete_rule: 'all', complete_n: null, sort_order: 1, venue: 'meeting' } as EngineInput['mbReqs'][number]],
        mbProgress: ['e', 'f'].map((id) => ({ mb_id: 'art', scout_id: id, awarded: false, has_any_req: true })),
        counselors: [{ mb_id: 'art', person_id: null, leader_code: 'Camp' }],
        counselorSources: [{ code: 'Camp', name: 'Summer Camp' }]
      })
    );
    expect(plan.sessions.find((s) => s.kind === 'mb')?.counselors).toEqual([{ code: 'Camp', name: 'Summer Camp' }]);
  });

  it('Engine_RosterScoutInstructors_UsesCanOfferToTeach', () => {
    const plan = buildMeetingPlan(input({ scouts: [scout('a', 1, 'scout'), scout('b', 2, 'scout'), scout('c', 3, 'first-class'), scout('d', 4, 'tenderfoot')], teachingSkills: [{ person_id: 3, skill_id: 'knots' }, { person_id: 4, skill_id: 'knots' }] }));
    expect(plan.rosterScoutInstructors.map((s) => s.id)).toEqual(['c']);
  });
});
