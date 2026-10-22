import { describe, it, expect } from 'vitest';
import { teacherChoices, withTeachers, type PlanRow } from '../src/lib/build-plan';
import { rankTrees } from '../src/lib/meeting-board-picklist';
import type { CatalogRankRequirement } from '../src/lib/advancement-catalog';
import type { TeacherPerson } from '../src/lib/meeting-board-teach';

/**
 * Build a Plan B2 (Plans/Build-A-Plan.md), the teacher picker, pure: who qualifies comes first with a one-line reason,
 * counselors are labelled, someone the database would refuse isn't listed, whoever teaches it now is on top.
 */
const ranks = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 }
];
const req = (id: number, code: string, skill: string | null): CatalogRankRequirement => ({
  id,
  rank_id: 'tenderfoot',
  parent_id: null,
  code,
  label: `Req ${code}`,
  complete_rule: 'all',
  complete_n: null,
  sort_order: id,
  venue: 'meeting' as CatalogRankRequirement['venue'],
  skill_id: skill
});
const rankReqs = [req(1, '4a', 'first-aid'), req(2, '3a', 'knots-adult')];
const ctx = { ranks, rankReqs, trees: rankTrees(rankReqs), youthTeachable: new Map([['first-aid', true], ['knots-adult', false]]) };
const person = (personId: number, name: string, o: Partial<TeacherPerson> = {}): TeacherPerson => ({
  personId,
  kind: 'adult',
  displayName: name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1] ?? null,
  gender: null,
  skills: new Set(),
  counselorFor: new Set(),
  currentRank: null,
  rankCodes: new Set(),
  ...o
});
const base = {
  ctx,
  members: [] as string[],
  skillNames: new Map([['first-aid', 'First aid'], ['knots-adult', 'Knots']]),
  badges: [{ id: 'first-aid', name: 'First Aid' }, { id: 'camping', name: 'Camping' }],
  teaching: new Set<number>()
};
const PEOPLE = [
  person(1, 'Adam Ames'),
  person(2, 'Beth Bell', { skills: new Set(['first-aid']) }),
  person(3, 'Carl Cole', { kind: 'junior', currentRank: 'first-class', skills: new Set(['knots-adult']) }),
  person(4, 'Dana Dunn', { counselorFor: new Set(['camping']) }),
  person(5, 'Eve East', { skills: new Set(['knots-adult']) })
];

describe('Build a Plan B2: teacher choices', () => {
  it('SetTeacher_ListsQualifiedFirst', () => {
    const list = teacherChoices({ ...base, people: PEOPLE, key: 'tenderfoot-4a' });
    expect(list.map((c) => [c.name, c.qualified, c.reason])).toEqual([
      ['Beth B', true, 'Teaches First aid'],
      ['Adam A', false, 'not in their skills'],
      ['Dana D', false, 'not in their skills'],
      ['Eve E', false, 'not in their skills']
    ]);
  });

  it('SetTeacher_LabelsCounselors_ForMeritBadgeRequirement', () => {
    const list = teacherChoices({ ...base, people: PEOPLE, key: 'camping-4' });
    expect(list.filter((c) => c.qualified).map((c) => [c.name, c.counselor, c.reason])).toEqual([['Dana D', true, 'Counselor for Camping']]);
  });

  it('SetTeacher_RefusedJuniorLeftOut_CurrentTeacherOnTop', () => {
    const list = teacherChoices({ ...base, people: PEOPLE, key: 'tenderfoot-3a', teaching: new Set([1]) });
    expect(list.map((c) => [c.name, c.teaching, c.qualified])).toEqual([
      ['Adam A', true, false],
      ['Eve E', false, true],
      ['Beth B', false, false],
      ['Dana D', false, false]
    ]);
  });

  it('SetTeacher_JuniorCounselor_IsNotQualifiedForAWholeBadge', () => {
    // qa-lead B2 #6: a whole badge (mb:) is adults only (assessTeacher), counselor or not.
    const junior = person(6, 'Finn Ford', { kind: 'junior', currentRank: 'first-class', counselorFor: new Set(['camping']) });
    const list = teacherChoices({ ...base, people: [...PEOPLE, junior], key: 'mb:camping' });
    expect(list.filter((c) => c.qualified).map((c) => c.name)).toEqual(['Dana D']);
  });

  it('SetTeacher_MixCountsAnyPart', () => {
    const list = teacherChoices({ ...base, people: PEOPLE, key: 'fg:7', members: ['tenderfoot-4a', 'camping-4'] });
    expect(list.filter((c) => c.qualified).map((c) => [c.name, c.reason])).toEqual([
      ['Dana D', 'Counselor for Camping'],
      ['Beth B', 'Teaches First aid']
    ]);
  });

  it('WithTeachers_StateFollowsAndUnheldRowGoes', () => {
    const row: PlanRow = { key: 'k', codeLabel: 'K', title: 'T', origin: 'planner', seeded: true, teachers: [], scouts: 2, canTeach: 0, state: 'needs-teacher' };
    expect([withTeachers(row, ['Beth B'], true)?.state, withTeachers({ ...row, scouts: 0 }, ['Beth B'], true)?.state, withTeachers(row, [], false)]).toEqual(['ready', 'needs-scouts', null]);
  });
});
