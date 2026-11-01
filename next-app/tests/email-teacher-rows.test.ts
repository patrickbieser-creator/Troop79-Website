import { describe, it, expect } from 'vitest';
import { askablePeople } from '../src/lib/meeting-email-screen';
import type { TwGroup, TwTeacher } from '../src/lib/this-week';

/** The Emails screen's Teachers tab (Patrick, 2026-10-31: "invites me to teach Scout Group 1; I'm on Tenderfoot"): a
 *  group that has a teacher lists only its teachers; one without lists the qualified adults who teach nothing else
 *  tonight; anyone already asked stays (their answer and status show). */
const t = (personId: number, name: string): TwTeacher => ({ personId, name, kind: 'adult', intent: null, note: null, formal: name });
const g = (key: string, teachers: TwTeacher[], candidates: TwTeacher[]) => ({ key, teachers, candidates }) as unknown as TwGroup;
const [patrick, dan, mindy, maya] = [t(82, 'Patrick B'), t(2, 'Dan B'), t(80, 'Mindy S'), t(5, 'Maya S')];
const groups = [g('fr:scout', [mindy], [patrick, dan, mindy]), g('fr:scout~2', [], [patrick, dan, maya]), g('fr:tenderfoot', [patrick], [patrick, dan])];

describe('askablePeople', () => {
  it('AGroupWithATeacher_ListsOnlyItsTeachers', () => {
    expect(askablePeople(groups[0], groups, []).map((p) => p.name)).toEqual(['Mindy S']);
  });

  it('AGroupWithout_LeavesOutWhoTeachesSomethingElse', () => {
    expect(askablePeople(groups[1], groups, []).map((p) => p.name)).toEqual(['Dan B', 'Maya S']);
  });

  it('SomeoneAlreadyAsked_StaysListed', () => {
    expect(askablePeople(groups[1], groups, [82]).map((p) => p.name)).toEqual(['Patrick B', 'Dan B', 'Maya S']);
  });
});
