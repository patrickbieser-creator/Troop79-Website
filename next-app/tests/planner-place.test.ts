import { describe, it, expect } from 'vitest';
import type { ThisWeek, TwGroup, TwRow } from '../src/lib/this-week';
import { placeChoices } from '../src/lib/planner-place';

/**
 * The person drawer's "Tonight" (Patrick, 2026-10-29): for a scout on This week, where they are, the places they can
 * move to, Help teach, and Unassign (back to the planner) when someone put them there by hand. Pure.
 */
const group = (key: string, name: string, kind: 'rank' | 'badge' = 'rank', title = kind === 'badge' ? `${name} merit badge` : `${name} group`): TwGroup =>
  ({ key, name, kind, title } as unknown as TwGroup);
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
      ['Help teach', false],
      ['Unassigned', false]
    ]);
  });

  it('ClassesFromRequests_AreChoicesToo', () => {
    const c = placeChoices(week(row({}), [{ key: 'mb:cooking-1', title: 'Cooking 1' } as ThisWeek['extras'][number]]), 7)!;
    expect(c.options.some((o) => o.label === 'Cooking 1' && o.role.role === 'request')).toBe(true);
  });

  it('SplitGroups_ReadScoutGroup1AndScoutGroup2', () => {
    const r = row({ groupKey: 'fr:scout~2', status: 'rank-work', gap: false });
    const v = { ...week(r), groups: [group('fr:scout', 'Scout', 'rank', 'Scout Group 1'), group('fr:scout~2', 'Scout', 'rank', 'Scout Group 2')] } as ThisWeek;
    const c = placeChoices(v, 7)!;
    expect([c.now, c.options.slice(0, 2).map((o) => [o.label, o.current])]).toEqual([
      'Scout Group 2',
      [
        ['Scout Group 1', false],
        ['Scout Group 2', true]
      ]
    ]);
  });

  it('AutoPlaced_HasNothingToUnassign', () => {
    expect(placeChoices(week(row({ groupKey: 'fr:tenderfoot', status: 'rank-work', gap: false })), 7)!.canUnassign).toBe(false);
  });

  it('Unassigned_IsAChoice_MarkedWhenChosen', () => {
    const c = placeChoices(week(row({ status: 'unassigned', gap: false, hand: true })), 7)!;
    expect([c.now, c.options.find((o) => o.id === 'none')?.current, c.options.find((o) => o.id === 'none')?.role]).toEqual(['Unassigned', true, { role: 'none' }]);
  });

  it('Gap_ReadsNothingAssignedYet', () => {
    expect(placeChoices(week(row({})), 7)!.now).toBe('Nothing assigned yet');
  });

  it('SomeoneNotOnThisWeek_HasNoChoices', () => {
    expect(placeChoices(week(row({})), 99)).toBeNull();
  });
});

// Station rotations step 4 (Plans/Planner-Station-Rotations.md): a scout in a rotation group, and "also" choices.
describe('placeChoices on a Stations night', () => {
  const rotation = (members: { personId: number; hand?: boolean }[][]) =>
    ({
      on: true,
      problem: null,
      groups: members.map((ms, i) => ({ number: i + 1, name: `Group ${i + 1}`, seededFrom: 'Scout', members: ms.map((m) => ({ name: 'Ava M', rank: null, rankName: 'New scout', done: [], helperAt: [], ...m })) }))
    }) as unknown as ThisWeek['rotation'];
  const stationsWeek = (r: TwRow | null, rot: ThisWeek['rotation'], doubles: ThisWeek['doubles'] = []): ThisWeek =>
    ({ ...week(r ?? row({ personId: 99 })), rotation: rot, doubles } as ThisWeek);

  it('RotationScout_ReadsTheirGroup', () => {
    const c = placeChoices(stationsWeek(null, rotation([[{ personId: 7 }], []])), 7)!;
    expect(c.now).toBe('Group 1 · Stations');
  });

  it('RotationScout_CanMoveToAnotherRotationGroup', () => {
    const c = placeChoices(stationsWeek(null, rotation([[{ personId: 7 }], []])), 7)!;
    expect(c.options.slice(0, 2).map((o) => [o.label, o.current, o.role])).toEqual([
      ['Group 1 · Stations', true, { role: 'rotate', group: 1 }],
      ['Group 2 · Stations', false, { role: 'rotate', group: 2 }]
    ]);
  });

  it('RotationScout_CanMoveToAnOrdinaryGroup', () => {
    const c = placeChoices(stationsWeek(null, rotation([[{ personId: 7 }]])), 7)!;
    expect(c.options.some((o) => o.label === 'First Aid merit badge' && o.role.role === 'group')).toBe(true);
  });

  it('HandMovedRotationScout_CanGoBackToTheDraft', () => {
    const c = placeChoices(stationsWeek(null, rotation([[{ personId: 7, hand: true }]])), 7)!;
    expect([c.canUnassign, c.unassignRole]).toEqual([true, { role: 'rotate', group: null }]);
  });

  it('SectionScout_CanJoinTheRotation', () => {
    const c = placeChoices(stationsWeek(row({ groupKey: 'mb:first-aid', status: 'badge', gap: false }), rotation([[{ personId: 1 }]])), 7)!;
    expect(c.options[0]).toEqual({ id: 'rot:1', label: 'Group 1 · Stations', role: { role: 'rotate', group: 1 }, current: false });
  });

  it('Also_OffersEveryGroupAndClass_ButNotTheCurrentOne', () => {
    const c = placeChoices(stationsWeek(row({ groupKey: 'fr:tenderfoot', status: 'rank-work', gap: false }), rotation([[{ personId: 1 }]]), [], ), 7)!;
    expect(c.also.map((a) => a.key)).toEqual(['fr:second-class', 'mb:first-aid']);
  });

  it('Also_MarksWhatTheyreAlreadyIn', () => {
    const c = placeChoices(stationsWeek(null, rotation([[{ personId: 7 }]]), [{ personId: 7, name: 'Ava M', primary: 'Group 1', also: ['First Aid merit badge'], keys: ['mb:first-aid'] }]), 7)!;
    expect(c.also.find((a) => a.key === 'mb:first-aid')?.on).toBe(true);
  });

  it('NoRotation_StillOffersAlso', () => {
    expect(placeChoices(week(row({ groupKey: 'fr:tenderfoot', status: 'rank-work', gap: false })), 7)!.also.map((a) => a.key)).toEqual(['fr:second-class', 'mb:first-aid']);
  });
});
