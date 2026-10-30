import { describe, it, expect } from 'vitest';
import type { ThisWeek, TwGroup, TwRow } from '../src/lib/this-week';
import { placeChoices } from '../src/lib/planner-place';

/**
 * The person drawer's "Tonight" (Patrick, 2026-10-29): for a scout on This week, where they are, the places they can
 * move to, Help teach, and Unassign (back to the planner) when someone put them there by hand. Pure.
 */
const group = (key: string, name: string, kind: 'rank' | 'badge' = 'rank'): TwGroup => ({ key, name, kind } as unknown as TwGroup);
const row = (o: Partial<TwRow>): TwRow =>
  ({ personId: 7, name: 'Anjali S', groupKey: null, status: 'nothing', gap: true, hand: false, requestKey: null, note: '', ...o } as unknown as TwRow);
const week = (r: TwRow, extras: ThisWeek['extras'] = []): ThisWeek =>
  ({
    groups: [group('fr:tenderfoot', 'Tenderfoot'), group('fr:second-class', 'Second Class'), group('mb:first-aid', 'First Aid', 'badge')],
    sections: [{ key: 's', kind: 'rank', name: 'x', columns: [], rows: [r], gaps: 0 }],
    extras
  } as unknown as ThisWeek);

describe('placeChoices', () => {
  it('Helper_ReadsHelpingTeachTheGroup_AndCanBeUnassigned', () => {
    const c = placeChoices(week(row({ groupKey: 'fr:second-class', status: 'teach', gap: false, hand: true })), 7)!;
    expect([c.now, c.canUnassign]).toEqual(['Helping teach the Second Class group', true]);
  });

  it('Moves_ListEveryOtherGroup_AndMarkTheCurrentOne', () => {
    const c = placeChoices(week(row({ groupKey: 'fr:second-class', status: 'rank-work', gap: false })), 7)!;
    expect(c.options.map((o) => [o.label, o.current])).toEqual([
      ['Tenderfoot group', false],
      ['Second Class group', true],
      ['First Aid merit badge', false],
      ['Help teach', false]
    ]);
  });

  it('ClassesFromRequests_AreChoicesToo', () => {
    const c = placeChoices(week(row({}), [{ key: 'mb:cooking-1', title: 'Cooking 1' } as ThisWeek['extras'][number]]), 7)!;
    expect(c.options.some((o) => o.label === 'Cooking 1' && o.role.role === 'request')).toBe(true);
  });

  it('AutoPlaced_HasNothingToUnassign', () => {
    expect(placeChoices(week(row({ groupKey: 'fr:tenderfoot', status: 'rank-work', gap: false })), 7)!.canUnassign).toBe(false);
  });

  it('Gap_ReadsNothingAssignedYet', () => {
    expect(placeChoices(week(row({})), 7)!.now).toBe('Nothing assigned yet');
  });

  it('SomeoneNotOnThisWeek_HasNoChoices', () => {
    expect(placeChoices(week(row({})), 99)).toBeNull();
  });
});
