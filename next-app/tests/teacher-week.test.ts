import { describe, it, expect } from 'vitest';
import { buildTeacherWeek } from '../src/lib/teacher-week';
import type { TwGroup } from '../src/lib/this-week';
import type { AdvancementCatalog } from '../src/lib/advancement-catalog';

/** One teacher's view of Sunday's classes (Plans/Meeting-Planner-III-Family.md, D6–D8, D11). Pure. */
const catalog = { ranks: [], rankRequirements: [], meritBadges: [], meritBadgeRequirements: [], skills: [] } as unknown as AdvancementCatalog;
const group = (key: string, o: Partial<TwGroup> = {}): TwGroup => ({
  key,
  kind: 'rank',
  refId: key.slice(3),
  name: key.slice(3),
  title: `${key.slice(3)} group`,
  base: key,
  section: 1,
  sections: 1,
  fromDone: 0,
  merged: false,
  offer: null,
  stored: null,
  subtitle: '',
  summary: '',
  columns: [{ key: `${key.slice(3)}-1`, code: '1', label: 'One', need: 1, subs: [] }],
  members: [],
  teachers: [],
  candidates: [],
  declineNotes: [],
  saidNo: [],
  ...o
});
const teacher = (personId: number) => ({ personId, name: `P${personId}`, kind: 'adult' as const, intent: null, note: null, formal: `Mr. ${personId}` });
const me = { personId: 9, name: 'Dan Vest', junior: false, intent: null };
const build = (groups: TwGroup[], rows: { key: string; personId: number; enteredByPersonId: number | null }[], merged?: ReadonlySet<string>) =>
  buildTeacherWeek({ groups }, { topicTeachers: rows, skillOffers: [] }, me, catalog, 1, () => null, merged);

describe('a teacher’s Sunday', () => {
  it('Teacher_FirstSignedUp_Teaches_LaterHelps', () => {
    const w = build([group('fr:a', { teachers: [teacher(5), teacher(9)] })], [{ key: 'fr:a', personId: 5, enteredByPersonId: 5 }, { key: 'fr:a', personId: 9, enteredByPersonId: 9 }]);
    expect(w.mine.map((m) => m.role)).toEqual(['help']);
  });

  it('Teacher_RowEnteredByAPlanner_IsPreassigned', () => {
    const w = build([group('fr:a', { teachers: [teacher(9)] })], [{ key: 'fr:a', personId: 9, enteredByPersonId: 80 }]);
    expect(w.mine[0].preassigned).toBe(true);
  });

  it('Teacher_OpenClasses_SplitByWhetherTheyHaveATeacher', () => {
    const w = build([group('fr:a'), group('fr:b', { teachers: [teacher(5)] })], [{ key: 'fr:b', personId: 5, enteredByPersonId: 5 }]);
    expect([w.needs.map((c) => c.key), w.taught.map((c) => c.key)]).toEqual([['fr:a'], ['fr:b']]);
  });

  it('Teacher_MeritBadgeClass_IsAdultsOnly', () => {
    const w = build([group('fr:mb:first-aid', { kind: 'badge' })], []);
    expect(w.needs[0].adultsOnly).toBe(true);
  });

  it('Teacher_Load_CountsClassesAndMinutes', () => {
    const w = build([group('fr:a', { teachers: [teacher(9)] })], [{ key: 'fr:a', personId: 9, enteredByPersonId: 9 }]);
    expect(w.load).toEqual({ classes: 1, minutes: 15 });
  });

  it('Teacher_LongClass_CountsOneMeetingAtMost', () => {
    const columns = Array.from({ length: 6 }, (_, i) => ({ key: `a-${i}`, code: `${i}`, label: `${i}`, need: 1, subs: [] }));
    const w = build([group('fr:a', { columns })], []);
    expect(w.needs[0].min).toBe(60);
  });

  it('TeacherOfAMergedGroup2_StillTeachesTheOneGroup', () => {
    const w = build([group('fr:a')], [{ key: 'fr:a~2', personId: 9, enteredByPersonId: 9 }], new Set(['fr:a']));
    expect(w.mine.map((m) => [m.key, m.role])).toEqual([['fr:a', 'teach']]);
  });

  it('SplitGroup_IsLabelledAsOnThePlan', () => {
    const w = build([group('fr:a~2', { title: 'A Group 2' })], [{ key: 'fr:a~2', personId: 9, enteredByPersonId: 9 }]);
    expect(w.mine[0].label).toBe('A Group 2');
  });
});

/** "We asked about" (Plans/Planner-Teacher-Email-To-Family-Card.md): the groups a teacher email asked this person to
 *  teach, read from the sent emails, never from a stored copy on the link. */
describe('what a teacher was asked about', () => {
  const ask = (group: string, at = '2085-03-01T12:00:00Z') => ({ personId: 9, group, at });
  const no = (key: string, answeredAt = '2085-03-02T12:00:00Z', note: string | null = null) => ({ personId: 9, key, answer: 'no' as const, answeredAt, plan: null, note });
  const buildAsked = (groups: TwGroup[], rows: { key: string; personId: number; enteredByPersonId: number | null }[], asks: ReturnType<typeof ask>[], answers: ReturnType<typeof no>[] = [], merged?: ReadonlySet<string>) =>
    buildTeacherWeek({ groups }, { topicTeachers: rows, skillOffers: [] }, me, catalog, 1, () => null, merged, { asks, answers });

  it('Asked_ListsTheEmailedGroup_AndTakesItOutOfNeeds', () => {
    const w = buildAsked([group('fr:a'), group('fr:b')], [], [ask('fr:a')]);
    expect([w.asked.map((c) => c.key), w.needs.map((c) => c.key)]).toEqual([['fr:a'], ['fr:b']]);
  });

  it('Asked_KeepsAGroupSomeoneElseHasTakenSince', () => {
    const w = buildAsked([group('fr:a', { teachers: [teacher(5)] })], [{ key: 'fr:a', personId: 5, enteredByPersonId: 5 }], [ask('fr:a')]);
    expect([w.asked.map((c) => c.key), w.taught.length]).toEqual([['fr:a'], 0]);
  });

  it('Asked_LeavesOutAGroupTheyNowTeach', () => {
    const w = buildAsked([group('fr:a', { teachers: [teacher(9)] })], [{ key: 'fr:a', personId: 9, enteredByPersonId: 9 }], [ask('fr:a')]);
    expect(w.asked).toEqual([]);
  });

  it('Asked_LeavesOutAGroupNoLongerOnThePlan', () => {
    const w = buildAsked([group('fr:b')], [], [ask('fr:a')]);
    expect(w.asked).toEqual([]);
  });

  it('Asked_ReadsAMergedSplitAsTheOneGroup', () => {
    const w = buildAsked([group('fr:a')], [], [ask('fr:a~2')], [], new Set(['fr:a']));
    expect(w.asked.map((c) => c.key)).toEqual(['fr:a']);
  });

  it('Asked_OnlyThisPersonsAsks', () => {
    const w = buildAsked([group('fr:a')], [], [{ personId: 5, group: 'fr:a', at: '2085-03-01T12:00:00Z' }]);
    expect(w.asked).toEqual([]);
  });

  it('Asked_SaysNo_WhenTheyAnsweredNoAfterTheAsk', () => {
    const w = buildAsked([group('fr:a')], [], [ask('fr:a')], [no('fr:a', '2085-03-02T12:00:00Z', 'Out of town')]);
    expect([w.asked[0].saidNo, w.asked[0].note]).toEqual([true, 'Out of town']);
  });

  it('Asked_AskedAgainAfterANo_IsOpenAgain', () => {
    const w = buildAsked([group('fr:a')], [], [ask('fr:a', '2085-03-03T12:00:00Z')], [no('fr:a', '2085-03-02T12:00:00Z')]);
    expect(w.asked[0].saidNo).toBe(false);
  });

  it('NoAsks_LeavesTheCardAsItWas', () => {
    const w = build([group('fr:a')], []);
    expect([w.asked, w.needs.map((c) => c.key)]).toEqual([[], ['fr:a']]);
  });
});

// Station rotations step 5: a station's teacher sees it as their class, at the station's time goal.
describe('a station teacher', () => {
  const station = group('fg:27', { kind: 'station', name: 'Climbing MB - Safety', title: 'Climbing MB - Safety', minutes: 20 });
  const me = { personId: 5, name: 'Paul R', junior: false, intent: null };
  const week = () => buildTeacherWeek({ groups: [station] }, { topicTeachers: [{ key: 'fg:27', personId: 5, enteredByPersonId: 9 }], skillOffers: [] }, me, catalog, 1, () => null);

  it('StationTeacher_SeesTheStationAsTheirClass', () => {
    expect(week().mine.map((m) => m.key)).toEqual(['fg:27']);
  });

  it('StationTeacher_LoadIsTheStationsTimeGoal', () => {
    expect(week().load.minutes).toBe(20);
  });
});
