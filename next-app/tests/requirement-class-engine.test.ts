import { describe, it, expect } from 'vitest';
import { buildMeetingPlan, type EngineInput, type EngineMbReqRow, type EngineRankReqRow } from '../src/lib/meeting-suggest/engine';
import { suggestionsData, settingItems, OTHER_SETTING } from '../src/lib/build-plan-suggest';
import { searchRequirements } from '../src/lib/meeting-focus-db';
import { adminClient } from './helpers/admin-client';

/**
 * The planner reads requirement class tags (Plans/Requirement-Classification.md step 3): a meeting suggests what it
 * holds (a tag M, or untagged), lists the rest under Needs another setting by tag, and never offers L-only items. The
 * tags never stop a leader adding a requirement by hand. Pure; no database.
 */
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 }
];
const rankReq = (id: number, code: string, classCodes: string[] = []): EngineRankReqRow => ({
  id, rank_id: 'tenderfoot', parent_id: null, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, class_codes: classCodes, skill_id: null
});
const mbReq = (id: number, code: string, parent: number | null, classCodes: string[] = []): EngineMbReqRow => ({
  id, mb_id: 'swimming', parent_id: parent, code, label: `Swimming ${code}`, complete_rule: 'all', complete_n: null, sort_order: id, class_codes: classCodes
});
const scout = (id: string, personId: number, rank: string | null): EngineInput['scouts'][number] => ({
  id, display_name: `Scout ${id}`, patrol: null, current_rank: rank, person_id: personId, graduation_year: 2030, junior_leader_override: null
});

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    meetingDate: '2026-10-25',
    title: 'Test meeting',
    generatedAt: '2026-10-22T00:00:00.000Z',
    scouts: [scout('a', 1, 'scout')],
    ranks,
    rankReqs: [rankReq(1, '3a')],
    mbs: [{ id: 'swimming', name: 'Swimming', eagle: true }],
    mbReqs: [],
    mbProgress: [],
    rankReqLedger: [],
    mbReqLedger: [],
    skills: [],
    adults: [],
    teachingSkills: [],
    counselors: [],
    requirementClasses: [
      { code: 'M', name: 'Troop meeting' },
      { code: 'C', name: 'Campout' },
      { code: 'O', name: 'Outdoor event' },
      { code: 'A', name: 'Aquatics' },
      { code: 'E', name: 'Expert / external visit' },
      { code: 'L', name: 'Leadership / administrative' }
    ],
    ...over
  } as EngineInput;
}
const suggested = (plan: ReturnType<typeof buildMeetingPlan>) => plan.byScout.flatMap((r) => r.suggestions.map((s) => s.key));

/** An older scout with Swimming in progress (nothing signed yet). */
const swimmer = (mbReqs: EngineMbReqRow[]): Partial<EngineInput> => ({
  scouts: [scout('c', 3, 'first-class')],
  rankReqs: [],
  mbReqs,
  mbProgress: [{ mb_id: 'swimming', scout_id: 'c', awarded: false, has_any_req: true }]
});

describe('the planner reads class tags', () => {
  it('Suggest_ListsARequirement_TaggedMeetingAndExpert', () => {
    expect(suggested(buildMeetingPlan(input({ rankReqs: [rankReq(1, '3a', ['M', 'E'])] })))).toEqual(['tenderfoot-3a']);
  });

  it('Suggest_LeavesOutARankRequirement_TaggedOnlyAquatics', () => {
    expect(suggested(buildMeetingPlan(input({ rankReqs: [rankReq(1, '6a', ['A'])] })))).toEqual([]);
  });

  it('Suggest_LeavesOutLeadershipItems_AndDoesNotListThemElsewhere', () => {
    const plan = buildMeetingPlan(input({ rankReqs: [rankReq(1, '9', ['L'])] }));
    expect([suggested(plan), plan.byScout[0].needsOuting]).toEqual([[], []]);
  });

  it('Suggest_LeavesOutAMeritBadgeRequirement_TaggedOnlyAquatics', () => {
    const plan = buildMeetingPlan(input(swimmer([mbReq(20, '1', null, ['A']), mbReq(21, '2', null)])));
    expect(suggested(plan)).toEqual(['swimming-2']);
  });

  it('MeritBadgeSubRequirement_InheritsItsParentsTags', () => {
    // 1 is Aquatics and its part 1a is untagged: 1a needs water too, so 2 is the suggestion.
    const plan = buildMeetingPlan(input(swimmer([mbReq(20, '1', null, ['A']), mbReq(22, '1a', 20), mbReq(21, '2', null)])));
    expect(suggested(plan)).toEqual(['swimming-2']);
  });

  it('MeritBadgeSubRequirement_TaggedMeeting_IsSuggestedUnderAnAquaticsParent', () => {
    const plan = buildMeetingPlan(input(swimmer([mbReq(20, '1', null, ['A']), mbReq(22, '1a', 20, ['M']), mbReq(21, '2', null)])));
    expect(suggested(plan)).toEqual(['swimming-1']);
  });
});

describe('Needs another setting', () => {
  it('NeedsAnotherSetting_ItemCarriesEveryTagTheMeetingLacks', () => {
    const plan = buildMeetingPlan(input({ rankReqs: [rankReq(1, '1b', ['C', 'O'])] }));
    expect(plan.byScout[0].needsOuting.map((o) => o.classes)).toEqual([['C', 'O']]);
  });

  it('NeedsAnotherSetting_GroupsItemsByTag_AnItemWithTwoUnderBoth', () => {
    const data = suggestionsData(buildMeetingPlan(input({ rankReqs: [rankReq(1, '1b', ['C', 'O']), rankReq(2, '6a', ['A'])] })), ranks);
    expect(['C', 'O', 'A'].map((c) => settingItems(data.campout, c).map((i) => i.codeLabel))).toEqual([['TF 1b'], ['TF 1b'], ['TF 6a']]);
  });

  it('NeedsAnotherSetting_HeadingsAreTheClassNames_ThenOneForOlderPlans', () => {
    const data = suggestionsData(buildMeetingPlan(input()), ranks);
    expect(data.settings.map((s) => s.name).slice(-2)).toEqual(['Leadership / administrative', OTHER_SETTING.name]);
  });

  it('OlderPlan_WithNoTags_GoesUnderOneCampoutOrOutingHeading', () => {
    expect(settingItems([{ classes: [] }, { classes: ['C'] }], OTHER_SETTING.code)).toEqual([{ classes: [] }]);
  });
});

describe('adding by hand is never filtered by tags', () => {
  it('Leader_CanAddAnyRequirementByHand_WhateverItsTags', async () => {
    // + Requirement and focus sets search the whole catalog: Tenderfoot 1b (Camp in a tent) is tagged Campout.
    const { rows } = await searchRequirements(adminClient(), { text: 'tent', kind: 'rank', source: 'tenderfoot', offset: 0 });
    expect(rows.map((r) => r.key)).toContain('tenderfoot-1b');
  });
});
