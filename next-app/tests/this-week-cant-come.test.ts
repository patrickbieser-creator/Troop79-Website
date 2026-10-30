import { describe, it, expect } from 'vitest';
import { checklistKeeps, withoutCantCome } from '../src/lib/this-week-shown';
import type { ThisWeek, TwPerson, TwRow } from '../src/lib/this-week';

/**
 * This week leaves out a scout who can't come (Patrick, 2026-10-30): off every card and the checklist's views, listed
 * only under the checklist's "Can't come" pill, so a planner can open them and undo it.
 */
const p = (personId: number, intent: TwPerson['intent']): TwPerson => ({ personId, name: `S${personId}`, rank: 'scout', rankName: 'Scout', intent });
const view = {
  groups: [{ key: 'fr:scout', members: [p(1, 'coming'), p(2, 'not_coming'), p(3, null)] }],
  older: [{ ...p(4, 'not_coming'), role: 'badge', badgeKey: null }],
  helpers: [p(5, 'not_coming'), p(6, 'undecided')],
  extras: [{ key: 'ff:1', scouts: [p(7, 'not_coming')] }]
} as unknown as ThisWeek;
const row = (intent: TwRow['intent'], gap = false) => ({ intent, gap }) as TwRow;

describe("can't come", () => {
  it('Cards_LeaveOutScoutsWhoCantCome', () => {
    const v = withoutCantCome(view);
    expect([v.groups[0].members.map((m) => m.personId), v.older.length, v.helpers.map((m) => m.personId), v.extras[0].scouts.length]).toEqual([[1, 3], 0, [6], 0]);
  });

  it('Checklist_Everyone_LeavesOutCantCome', () => {
    expect([checklistKeeps('all', row('coming')), checklistKeeps('all', row('not_coming'))]).toEqual([true, false]);
  });

  it('Checklist_NothingAssigned_LeavesOutCantCome', () => {
    expect([checklistKeeps('gaps', row('coming', true)), checklistKeeps('gaps', row('not_coming', true))]).toEqual([true, false]);
  });

  it('Checklist_CantComePill_ListsOnlyThem', () => {
    expect([checklistKeeps('cant', row('not_coming')), checklistKeeps('cant', row('coming')), checklistKeeps('cant', row(null))]).toEqual([true, false, false]);
  });

  it('Checklist_NoAnswer_IsUnchanged', () => {
    expect([checklistKeeps('noanswer', row(null)), checklistKeeps('noanswer', row('undecided'))]).toEqual([true, false]);
  });
});
