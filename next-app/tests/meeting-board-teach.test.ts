import { describe, it, expect } from 'vitest';
import {
  assessTeacher,
  canTeachFocusGroup,
  commitmentCounts,
  formalName,
  freeformKey,
  matchSupply,
  teacherIntent,
  teacherLine,
  teacherName,
  teachersFor,
  topicSkill,
  weeksAsked,
  type SupplyInput,
  type TeachContext,
  type TeacherPerson
} from '../src/lib/meeting-board-teach';
import { buildPickList, rankTrees } from '../src/lib/meeting-board-picklist';
import type { CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/** Meeting board, Phase 2: the teacher side's pure rules (qualification, names, the skill-offer expansion, supply). */

const RANKS: CatalogRank[] = [
  { id: 'scout', display_name: 'Scout', sort_order: 0 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 1 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 2 },
  { id: 'first-class', display_name: 'First Class', sort_order: 3 }
];
let rid = 0;
const req = (rank_id: string, code: string, label: string, o: Partial<CatalogRankRequirement> = {}): CatalogRankRequirement => ({
  id: ++rid,
  rank_id,
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: rid,
  venue: 'either',
  skill_id: null,
  ...o
});
const REQS: CatalogRankRequirement[] = [
  req('tenderfoot', '4a', 'First aid', { skill_id: 'first-aid' }),
  req('tenderfoot', '3a', 'Knots', { skill_id: 'knots' }),
  req('tenderfoot', '3b', 'Lashings', { skill_id: 'knots' }),
  req('second-class', '2a', 'Map and compass', { skill_id: 'navigation' }),
  req('second-class', '5a', 'Swimming', { skill_id: 'aquatics' }),
  req('tenderfoot', '7a', 'Flag ceremony')
];
const CTX: TeachContext = {
  ranks: RANKS,
  rankReqs: REQS,
  trees: rankTrees(REQS),
  youthTeachable: new Map([
    ['first-aid', false],
    ['knots', true],
    ['navigation', true],
    ['aquatics', false]
  ])
};
const adult = (personId: number, o: Partial<TeacherPerson> = {}): TeacherPerson => ({
  personId,
  kind: 'adult',
  displayName: 'Dan Vest',
  firstName: 'Dan',
  lastName: 'Vest',
  gender: 'M',
  skills: new Set(),
  counselorFor: new Set(),
  currentRank: null,
  rankCodes: new Set(),
  ...o
});
const junior = (personId: number, o: Partial<TeacherPerson> = {}): TeacherPerson =>
  adult(personId, { kind: 'junior', displayName: 'Maya Sankpal', firstName: 'Maya', lastName: 'Sankpal', gender: 'F', currentRank: 'tenderfoot', ...o });

describe('names', () => {
  it('Scout_SeesAdultTeacherFormally', () => {
    expect([formalName(adult(1)), formalName(adult(2, { gender: 'F', lastName: 'Ortiz' }))]).toEqual(['Mr. Vest', 'Ms. Ortiz']);
  });
  it('Scout_SeesAdultWithNoGender_AsFirstNameLastInitial', () => {
    expect(formalName(adult(1, { gender: null }))).toBe('Dan V');
  });
  it('Scout_SeesJuniorLeader_AsFirstNameLastInitial', () => {
    expect(teacherName(junior(1), 'scout')).toBe('Maya S');
  });
  it('Admin_SeesAdults_AsFirstNameLastInitial', () => {
    expect(teacherName(adult(1), 'admin')).toBe('Dan V');
  });
  it('Freeform_KeyIsTrimmedCollapsedLowercase', () => {
    expect([freeformKey('  Knife   Sharpening '), freeformKey('   ')]).toEqual(['ff:knife sharpening', '']);
  });
});

describe('qualification', () => {
  it('Topic_SkillIsTheTopLevelRequirementsSkill', () => {
    expect([topicSkill('tenderfoot-4a', RANKS, REQS), topicSkill('second-class-2a', RANKS, REQS), topicSkill('mb:cooking', RANKS, REQS)]).toEqual(['first-aid', 'navigation', null]);
  });
  it('Adult_WithTheSkill_IsQualified', () => {
    expect(assessTeacher(adult(1, { skills: new Set(['knots']) }), 'tenderfoot-3a', CTX)).toEqual({ qualified: true, flags: [], refused: false });
  });
  it('Adult_WithoutTheSkill_MayTeach_Flagged', () => {
    expect(assessTeacher(adult(1), 'tenderfoot-3a', CTX)).toEqual({ qualified: false, flags: ['not_in_skills'], refused: false });
  });
  it('Adult_TopicWithNoSkill_IsQualified', () => {
    expect(assessTeacher(adult(1), 'tenderfoot-7a', CTX).qualified).toBe(true);
  });
  it('Matcher_FlagsCounselorNeeded_WhenMbTeacherNotCounselor', () => {
    expect([assessTeacher(adult(1), 'mb:cooking', CTX).flags, assessTeacher(adult(1, { counselorFor: new Set(['cooking']) }), 'mb:cooking', CTX).flags]).toEqual([['needs_counselor'], []]);
  });
  it('JuniorLeader_AdultOnlySkill_IsRefused', () => {
    expect(assessTeacher(junior(1, { skills: new Set(['first-aid']) }), 'tenderfoot-4a', CTX).refused).toBe(true);
  });
  it('JuniorLeader_MustHaveFinishedIt', () => {
    const notYet = assessTeacher(junior(1, { skills: new Set(['navigation']) }), 'second-class-2a', CTX);
    const done = assessTeacher(junior(1, { skills: new Set(['navigation']), currentRank: 'second-class' }), 'second-class-2a', CTX);
    expect([notYet.flags, done.qualified]).toEqual([['not_finished'], true]);
  });
  it('Adult_SelfAddedSkill_CountsForMatchingImmediately', () => {
    const p = adult(1);
    const before = assessTeacher(p, 'tenderfoot-3a', CTX).qualified;
    const after = assessTeacher({ ...p, skills: new Set(['knots']) }, 'tenderfoot-3a', CTX).qualified;
    expect([before, after]).toEqual([false, true]);
  });
});

describe('who can teach a focus group', () => {
  const parts = ['tenderfoot-3a', 'tenderfoot-7a', 'cooking-4'];
  it('Adult_WithASkillCoveringOnePart_CanTeachTheGroup', () => {
    expect(canTeachFocusGroup(adult(1, { skills: new Set(['knots']) }), parts, CTX)).toBe(true);
  });
  it('Adult_WithNoSkillCoveringAPart_CannotTeachTheGroup', () => {
    expect(canTeachFocusGroup(adult(1, { skills: new Set(['navigation']) }), parts, CTX)).toBe(false);
  });
  it('JuniorLeader_WithOnlyAnAdultsOnlySkill_CannotTeachTheGroup', () => {
    expect(canTeachFocusGroup(junior(1, { skills: new Set(['first-aid']) }), ['tenderfoot-4a'], CTX)).toBe(false);
  });
  it('Counselor_ForAPartsBadge_CanTeachTheGroup', () => {
    expect(canTeachFocusGroup(adult(1, { counselorFor: new Set(['cooking']) }), parts, CTX)).toBe(true);
  });
});

describe('supply', () => {
  const people = new Map([
    [1, adult(1, { skills: new Set(['knots']) })],
    [2, junior(2, { skills: new Set(['navigation']) })],
    [3, adult(3)]
  ]);
  const base = (o: Partial<SupplyInput> = {}): SupplyInput => ({ topicTeachers: [], skillOffers: [], people, notComing: new Set(), ctx: CTX, ...o });

  it('Matcher_SkillOfferCatchesRequirementPicks_WhenSkillMatches', () => {
    const s = base({ skillOffers: [{ personId: 1, skillId: 'knots', note: null }] });
    expect([teachersFor('tenderfoot-3a', s), teachersFor('tenderfoot-3b', s), teachersFor('second-class-2a', s)]).toEqual([
      [{ personId: 1, via: 'offer' }],
      [{ personId: 1, via: 'offer' }],
      []
    ]);
  });
  it('JuniorSkillOffer_SkipsRequirementsTheyHaventFinished', () => {
    expect(teachersFor('second-class-2a', base({ skillOffers: [{ personId: 2, skillId: 'navigation', note: null }] }))).toEqual([]);
  });
  it('Teacher_WhoCantMakeIt_IsLeftOutOfTheSupply', () => {
    const s = base({ topicTeachers: [{ key: 'tenderfoot-3a', personId: 3, note: null }], notComing: new Set([3]) });
    expect(teachersFor('tenderfoot-3a', s)).toEqual([]);
  });
  it('SkillOffer_CountsAsOneCommitment', () => {
    const s = base({ topicTeachers: [{ key: 'tenderfoot-3a', personId: 1, note: null }], skillOffers: [{ personId: 1, skillId: 'knots', note: null }] });
    expect(commitmentCounts(s).get(1)).toBe(2);
  });
  it('Matcher_ListsWantedNoTeacher_AndOfferedNoTakers', () => {
    const demand = new Map([
      ['tenderfoot-3a', [10, 11]],
      ['tenderfoot-4a', [12]]
    ]);
    const r = matchSupply(demand, base({ topicTeachers: [{ key: 'tenderfoot-3a', personId: 3, note: null }, { key: 'ff:knife sharpening', personId: 3, note: null }], skillOffers: [{ personId: 1, skillId: 'navigation', note: null }] }));
    expect([r.wanted, r.offered, r.idleOffers.map((o) => o.skillId)]).toEqual([['tenderfoot-4a'], ['ff:knife sharpening'], ['navigation']]);
  });
  it('Adult_CommitmentImpliesComing_WhenNoAnswer', () => {
    expect([teacherIntent(null, 1), teacherIntent(null, 0), teacherIntent('not_coming', 1)]).toEqual(['coming', null, 'not_coming']);
  });
  it('MemberCard_TeacherLine_SaysAnswerAndCount', () => {
    expect([teacherLine(null, 0), teacherLine(null, 1), teacherLine('undecided', 0), teacherLine('not_coming', 2)]).toEqual([
      'No answer yet',
      'Coming · teaching 1',
      'Not sure yet',
      'Can’t make it'
    ]);
  });
  it('WeeksAsked_CountsFromTheEarliestAsk', () => {
    expect([weeksAsked(['2026-10-28'], '2026-11-01'), weeksAsked(['2026-10-25', '2026-10-11'], '2026-11-01')]).toEqual([1, 3]);
  });
});

describe('pick list', () => {
  it('Scout_SeesTeacherComingTag_OnATopicWithATeacher', () => {
    const view = buildPickList({
      currentRank: 'scout',
      ranks: RANKS,
      rankReqs: REQS,
      mbs: [],
      mbProgress: [],
      rankCodes: new Set(),
      teacherByKey: new Map([['tenderfoot-3a', 'Mr. Vest']])
    });
    const rows = view.groups.flatMap((g) => g.rows);
    expect([rows.find((r) => r.key === 'tenderfoot-3a')!.teacher, rows.find((r) => r.key === 'tenderfoot-3b')!.teacher]).toEqual(['Mr. Vest', null]);
  });
  it('Scout_SeesFreeformOffers_InAlsoOfferedThisWeek', () => {
    const view = buildPickList({
      currentRank: 'scout',
      ranks: RANKS,
      rankReqs: REQS,
      mbs: [],
      mbProgress: [],
      rankCodes: new Set(),
      freeform: [{ key: 'ff:knife sharpening', title: 'Knife sharpening' }],
      teacherByKey: new Map([['ff:knife sharpening', 'Mr. Vest']])
    });
    expect(view.offered.map((r) => [r.key, r.label, r.teacher])).toEqual([['ff:knife sharpening', 'Knife sharpening', 'Mr. Vest']]);
  });
});
