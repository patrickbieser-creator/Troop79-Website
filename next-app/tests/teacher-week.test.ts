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
  subtitle: '',
  columns: [{ key: `${key.slice(3)}-1`, code: '1', label: 'One', need: 1, subs: [] }],
  members: [],
  teachers: [],
  candidates: [],
  declineNotes: [],
  ...o
});
const teacher = (personId: number) => ({ personId, name: `P${personId}`, kind: 'adult' as const, intent: null, note: null, formal: `Mr. ${personId}` });
const me = { personId: 9, name: 'Dan Vest', junior: false, intent: null };
const build = (groups: TwGroup[], rows: { key: string; personId: number; enteredByPersonId: number | null }[]) =>
  buildTeacherWeek({ groups }, { topicTeachers: rows, skillOffers: [] }, me, catalog, 1, () => null);

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
});
