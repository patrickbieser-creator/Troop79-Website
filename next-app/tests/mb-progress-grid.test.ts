import { describe, it, expect } from 'vitest';
import { evaluateRequirement, bracketLabel, buildProgressGrid, type RuleNode } from '../src/lib/mb-progress-grid';
import type { MbScoutLike, MbScoutSlot } from '../src/lib/mb-scout-progress';

/** The merit badge page's Scout progress grid, Concept A2 (Plans/MB-Scout-Progress-Grid.md). Rules come from the
 *  catalog tree: a parent's complete_rule (all / any / n-of) applies to its children, and the two compound shapes
 *  (some required plus a choice, all of one set or another) are nested parents. A rule on a requirement with no
 *  children is the counselor's business, never evaluated (Emergency Preparedness 1b, Patrick 2026-11-08). */

type Rule = 'all' | 'any' | 'n-of';
const node = (code: string, children: RuleNode[] = [], complete_rule: Rule = 'all', complete_n: number | null = null): RuleNode => ({
  code,
  label: `Req ${code}`,
  complete_rule,
  complete_n,
  children
});
const leaves = (...codes: string[]) => codes.map((c) => node(c));
const done = (...codes: string[]) => new Set(codes);

// Communication: 1 (any 1 of a–d), 2 (any 1 of a–b), 3–6, 7 (any 1 of a–c), 8, 9.
const COMMUNICATION: RuleNode[] = [
  node('1', leaves('1a', '1b', '1c', '1d'), 'any'),
  node('2', leaves('2a', '2b'), 'any'),
  node('3'),
  node('4'),
  node('5'),
  node('6'),
  node('7', leaves('7a', '7b', '7c'), 'any'),
  node('8'),
  node('9')
];
// Camping 9: 9a and 9c required, plus any 2 of 9b's six.
const CAMPING_9 = node('9', [node('9a'), node('9b', leaves('9b(1)', '9b(2)', '9b(3)', '9b(4)', '9b(5)', '9b(6)'), 'n-of', 2), node('9c')]);
// Archery 5: all of option A (5a's parts) or option B (5b).
const ARCHERY_5 = node('5', [node('5a', leaves('5a-a', '5a-b', '5a-c')), node('5b')], 'any');

describe('evaluateRequirement', () => {
  it('Pick_IsMet_WhenDoneChildrenReachTheCount', () => {
    expect(evaluateRequirement(node('1', leaves('1a', '1b', '1c'), 'n-of', 2), done('1a', '1c')).met).toBe(true);
  });

  it('Pick_IsNotMet_BelowTheCount', () => {
    expect(evaluateRequirement(node('1', leaves('1a', '1b', '1c'), 'n-of', 2), done('1a'))).toEqual({ met: false, doneCount: 1, needed: 2 });
  });

  it('Any_NeedsOne', () => {
    expect(evaluateRequirement(COMMUNICATION[0], done('1d'))).toEqual({ met: true, doneCount: 1, needed: 1 });
  });

  it('All_IsNotMet_UntilEveryChildIsDone', () => {
    expect(evaluateRequirement(node('5', leaves('5a', '5b', '5c')), done('5a', '5b'))).toEqual({ met: false, doneCount: 2, needed: 3 });
  });

  it('RequiredPlusPick_IsNotMet_WhenOnlyThePickIsDone', () => {
    expect(evaluateRequirement(CAMPING_9, done('9b(1)', '9b(2)')).met).toBe(false);
  });

  it('RequiredPlusPick_IsMet_WhenRequiredAndPickAreDone', () => {
    expect(evaluateRequirement(CAMPING_9, done('9a', '9c', '9b(1)', '9b(4)')).met).toBe(true);
  });

  it('AnySet_IsMet_WhenOneWholeSetIsDone', () => {
    expect(evaluateRequirement(ARCHERY_5, done('5a-a', '5a-b', '5a-c')).met).toBe(true);
  });

  it('AnySet_IsNotMet_WithHalfOfASet', () => {
    expect(evaluateRequirement(ARCHERY_5, done('5a-a', '5a-b')).met).toBe(false);
  });

  it('Single_IsMet_WhenItsCodeIsDone', () => {
    expect(evaluateRequirement(node('3'), done('3'))).toEqual({ met: true, doneCount: 1, needed: 1 });
  });

  it('Single_IgnoresARuleOnALeaf_CounselorDecides', () => {
    expect(evaluateRequirement(node('1b', [], 'n-of', 10), done('1b')).met).toBe(true);
  });

  it('Parent_IsMet_WhenItsOwnCodeWasSignedOff', () => {
    expect(evaluateRequirement(node('5', leaves('5a', '5b')), done('5')).met).toBe(true);
  });
});

describe('bracketLabel', () => {
  it('Single_HasNoBracket', () => {
    expect(bracketLabel(node('3'))).toBeNull();
  });

  it('Any_ReadsAnyOne', () => {
    expect(bracketLabel(COMMUNICATION[0])).toBe('any 1');
  });

  it('NOf_ReadsAnyN', () => {
    expect(bracketLabel(node('4', leaves('4a', '4b', '4c'), 'n-of', 2))).toBe('any 2');
  });

  it('All_ReadsAll', () => {
    expect(bracketLabel(node('5', leaves('5a', '5b')))).toBe('all');
  });

  it('RequiredPlusPick_NamesRequiredThenThePick', () => {
    expect(bracketLabel(CAMPING_9)).toBe('9a, 9c + any 2 of 9b');
  });

  it('AnySet_NamesEachOption', () => {
    expect(bracketLabel(ARCHERY_5)).toBe('all of 5a or 5b');
  });
});

let n = 0;
function scout(first: string, last: string): MbScoutLike {
  n++;
  return { id: `S${n}`, first_name: first, last_name: last, current_rank: 'first-class' };
}
const slot = (codes: string[], awarded = false): MbScoutSlot => ({ awarded, codes: new Set(codes), dates: new Map() });

// The plan's acceptance table, in display_name order (the page's query order).
const anjali = scout('Anjali', 'Smith');
const finn = scout('Finn', 'Park');
const hazel = scout('Hazel', 'Stone');
const jack = scout('Jack', 'Pratt');
const kevin = scout('Kevin', 'Price');
const oliverK = scout('Oliver', 'King');
const oliverV = scout('Oliver', 'Vance');
const veronica = scout('Veronica', 'Kent');
const violet = scout('Violet', 'Bell');
const SCOUTS = [anjali, finn, hazel, jack, kevin, oliverK, oliverV, veronica, violet];
const BY_SCOUT = new Map<string, MbScoutSlot>([
  [anjali.id, slot(['1d', '2b', '3', '8'])],
  [finn.id, slot(['1d'])],
  [hazel.id, slot(['1d', '2b', '8'])],
  [jack.id, slot(['1d', '2b', '8'])],
  [kevin.id, slot([], true)],
  [oliverK.id, slot(['1d', '8'])],
  [oliverV.id, slot(['1d', '2b', '3', '4', '5', '6', '7a', '8', '9'], true)],
  [veronica.id, slot(['1d', '2b', '3', '4', '5', '6', '7c', '8', '9'], true)],
  [violet.id, slot(['1d', '8'])]
]);
const grid = () => buildProgressGrid(COMMUNICATION, SCOUTS, BY_SCOUT);
const rowOf = (s: MbScoutLike) => [...grid().inProgress, ...grid().earned].find((r) => r.scout.id === s.id)!;
const cellOf = (s: MbScoutLike, code: string) => rowOf(s).cells[grid().columns.findIndex((c) => c.code === code)];

describe('buildProgressGrid', () => {
  it('Columns_AreEveryLeafInCatalogOrder', () => {
    expect(grid().columns.map((c) => c.code)).toEqual(['1a', '1b', '1c', '1d', '2a', '2b', '3', '4', '5', '6', '7a', '7b', '7c', '8', '9']);
  });

  it('Columns_MarkTheFirstCodeOfEachParent', () => {
    expect(grid().columns.filter((c) => c.groupStart).map((c) => c.code)).toEqual(['1a', '2a', '3', '4', '5', '6', '7a', '8', '9']);
  });

  it('Brackets_SpanTheirLeaves', () => {
    expect(grid().brackets.map((b) => [b.code, b.span, b.label])).toEqual([
      ['1', 4, 'any 1'],
      ['2', 2, 'any 1'],
      ['3', 1, null],
      ['4', 1, null],
      ['5', 1, null],
      ['6', 1, null],
      ['7', 3, 'any 1'],
      ['8', 1, null],
      ['9', 1, null]
    ]);
  });

  it('Columns_AccessibleNameCarriesTheBracket', () => {
    expect(grid().columns[0].ariaName).toBe('1a, any 1 of 1a–1d');
  });

  it('InProgress_SortsByMetThenQueryOrder', () => {
    expect(grid().inProgress.map((r) => r.scout.first_name + ' ' + r.scout.last_name[0])).toEqual([
      'Anjali S',
      'Hazel S',
      'Jack P',
      'Oliver K',
      'Violet B',
      'Finn P'
    ]);
  });

  it('Earned_RecordedFirst_ThenCounselorOnly', () => {
    expect(grid().earned.map((r) => r.scout.first_name)).toEqual(['Oliver', 'Veronica', 'Kevin']);
  });

  it('Progress_CountsParentRequirementsMet', () => {
    expect([rowOf(anjali).met, rowOf(anjali).total]).toEqual([4, 9]);
  });

  it('Cell_OtherOptionsAreNotNeeded_WhenTheChoiceIsMet', () => {
    expect(['1a', '1b', '1c', '2a'].map((c) => cellOf(anjali, c))).toEqual(['notNeeded', 'notNeeded', 'notNeeded', 'notNeeded']);
  });

  it('Cell_IsOpen_WhenTheChoiceIsNotMet', () => {
    expect([cellOf(oliverK, '2a'), cellOf(oliverK, '2b')]).toEqual(['open', 'open']);
  });

  it('Cell_IsDone_WhenSignedOff', () => {
    expect(cellOf(anjali, '1d')).toBe('done');
  });

  it('Earned_WithFullRecords_KeepsItsBoxes', () => {
    expect(rowOf(oliverV).requirementsRecorded).toBe(true);
  });

  it('Earned_WithFullRecords_ShowsUnusedOptionsAsNotNeeded', () => {
    expect([cellOf(oliverV, '7b'), cellOf(oliverV, '7c')]).toEqual(['notNeeded', 'notNeeded']);
  });

  it('Earned_WithNoRecords_IsCounselorOnly', () => {
    expect(rowOf(kevin).requirementsRecorded).toBe(false);
  });

  it('Earned_WithPartialRecords_IsCounselorOnly', () => {
    // Started here, finished with an outside counselor: the record on file doesn't add up to the badge.
    const s = scout('Pat', 'Outside');
    const g = buildProgressGrid(COMMUNICATION, [s], new Map([[s.id, slot(['1d', '8'], true)]]));
    expect(g.earned[0].requirementsRecorded).toBe(false);
  });

  it('Scouts_WithNoProgress_StayOut', () => {
    const s = scout('Nobody', 'Yet');
    expect(buildProgressGrid(COMMUNICATION, [s], new Map()).inProgress).toEqual([]);
  });

  it('Nested_RequiredPlusPick_OtherPicksNotNeeded_OnceTwoAreDone', () => {
    const s = scout('Cam', 'Per');
    const g = buildProgressGrid([CAMPING_9], [s], new Map([[s.id, slot(['9b(1)', '9b(2)'])]]));
    const states = Object.fromEntries(g.columns.map((c, i) => [c.code, g.inProgress[0].cells[i]]));
    expect([states['9a'], states['9b(3)'], states['9c']]).toEqual(['open', 'notNeeded', 'open']);
  });
});
