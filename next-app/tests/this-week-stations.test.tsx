import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import type { TwRotation } from '../src/lib/this-week-rotation';
import type { ThisWeek } from '../src/lib/this-week';

/** Station rotations step 3 (Plans/Planner-Station-Rotations.md): This week's Stations section and its switch. */
const m = vi.hoisted(() => ({
  setStations: vi.fn(async () => ({ ok: true as const, stamp: 's' })),
  order: vi.fn(async () => ({ ok: true as const, stamp: 's' })),
  canEdit: true
}));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twSetStationsAction: m.setStations, twOrderStationsAction: m.order }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: m.canEdit, openPerson: vi.fn(), sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
const { StationsSection, StationsSwitch } = await import('../src/app/(public)/planner/this-week-stations');

const station = (n: number, title: string, cells: string[], goalMinutes: number | null = 25) => ({
  key: `fg:${n}`,
  title,
  goalMinutes,
  cells: cells.map((c) => ({ key: `climbing-${c}`, code: c, label: `Req ${c}` })),
  teachers: n === 1 ? [{ personId: 9, name: 'Paul R' }] : []
});
const member = (personId: number, name: string, done: string[] = [], helperAt: string[] = []) => ({ personId, name, rank: 'scout', rankName: 'Scout', done, helperAt });
const rotation: TwRotation = {
  on: true,
  problem: null,
  badgeId: 'climbing',
  badgeName: 'Climbing',
  stations: [station(1, 'Safety', ['1a', '1b']), station(2, 'Terms', ['4a']), station(3, 'Ropes', ['6a'])],
  groups: [
    { number: 1, name: 'Group 1', seededFrom: 'Scout', members: [member(1, 'Ava M')] },
    { number: 2, name: 'Group 2', seededFrom: 'Tenderfoot', members: [member(2, 'Ezra L', ['climbing-4a'], ['fg:2'])] },
    { number: 3, name: 'Group 3', seededFrom: 'Second Class + First Class', members: [member(3, 'Ada P')] }
  ],
  rounds: [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1]
  ],
  roundMinutes: 25,
  totalMinutes: 75
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.canEdit = true;
});

describe('the Stations section', () => {
  it('Section_ShowsTheTotal', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect(screen.getByText('75 min total')).toBeTruthy();
  });

  it('Grid_ShowsGroupTwoAtTermsInRoundOne', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    const round1 = screen.getAllByRole('row').find((r) => within(r).queryByRole('rowheader', { name: /Round 1/ }))!;
    expect(within(round1).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1Safety', '2Terms', '3Ropes']);
  });

  it('Groups_AreNamedByNumberWithTheirRanksAsSubtitle', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect(screen.getByRole('heading', { name: 'Group 3' }).parentElement!.textContent).toContain('Second Class + First Class');
  });

  it('Checklist_MarksADoneCell', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect(screen.getAllByRole('img', { name: '4a: already done' }).length).toBe(1);
  });

  it('Checklist_FlagsAPossibleHelper', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect(screen.getByText('Could help · Terms')).toBeTruthy();
  });

  it('StationOrder_NamesTheTeacher_AndSaysWhenThereIsNone', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect([screen.getAllByText('Paul R').length, screen.getAllByText('No teacher yet').length]).toEqual([1, 2]);
  });

  it('MovingAStationDown_SavesTheNewOrder', async () => {
    render(<StationsSection entryId={7} rotation={rotation} canSeed />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Safety down' }));
    await Promise.resolve();
    expect(m.order).toHaveBeenCalledWith({ entryId: 7, keys: ['fg:2', 'fg:1', 'fg:3'] });
  });

  it('FirstStation_CantMoveUp', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed />);
    expect((screen.getByRole('button', { name: 'Move Safety up' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('NotOnTheTeam_SeesNoMoveButtons', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed={false} />);
    expect(screen.queryByRole('button', { name: /Move Safety/ })).toBeNull();
  });

  it('NoGoals_SaysSo_WithoutBlocking', () => {
    render(<StationsSection entryId={1} rotation={{ ...rotation, roundMinutes: null, totalMinutes: null }} canSeed />);
    expect(screen.getAllByText('No time goal yet').length).toBeGreaterThan(0);
  });

  it('MixedBadges_ExplainsWhy', () => {
    render(<StationsSection entryId={1} rotation={{ ...rotation, problem: 'mixed', groups: [], rounds: [] }} canSeed />);
    expect(screen.getByRole('status').textContent).toMatch(/one merit badge/);
  });

  it('Off_ShowsNothing', () => {
    const { container } = render(<StationsSection entryId={1} rotation={{ ...rotation, on: false }} canSeed />);
    expect(container.textContent).toBe('');
  });
});

describe('the switch', () => {
  const view = { focus: [{ key: 'fg:1', setId: 1, name: 'Safety' }], rotation: { ...rotation, on: false } } as unknown as ThisWeek;

  it('Switch_TurnsStationsOn', async () => {
    render(<StationsSwitch entryId={4} view={view} canSeed />);
    fireEvent.click(screen.getByRole('radio', { name: 'Stations' }));
    await Promise.resolve();
    expect(m.setStations).toHaveBeenCalledWith({ entryId: 4, on: true });
  });

  it('Switch_HiddenWithoutTheSeedRight', () => {
    render(<StationsSwitch entryId={4} view={view} canSeed={false} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('Switch_HiddenWithNoFocusYet', () => {
    render(<StationsSwitch entryId={4} view={{ focus: [], rotation: null } as unknown as ThisWeek} canSeed />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('step 4: hand moves, also, double-assigned', () => {
  const withNotes: TwRotation = {
    ...rotation,
    groups: [{ number: 1, name: 'Group 1', seededFrom: 'Scout', members: [{ ...member(1, 'Ava M'), hand: true, also: ['Scoutmaster conference'] }] }, ...rotation.groups.slice(1)]
  };

  it('HandMove_WearsByHand', () => {
    render(<StationsSection entryId={1} rotation={withNotes} canSeed />);
    expect(screen.getByText('By hand')).toBeTruthy();
  });

  it('Also_ReadsAlsoIn', () => {
    render(<StationsSection entryId={1} rotation={withNotes} canSeed />);
    expect(screen.getByText('Also in: Scoutmaster conference')).toBeTruthy();
  });

  it('Doubles_ShowACount_AndListWhoAndWhere', () => {
    render(<StationsSection entryId={1} rotation={withNotes} canSeed doubles={[{ personId: 1, name: 'Ava M', primary: 'Group 1', also: ['Scoutmaster conference'], keys: ['star-5'] }]} />);
    expect([screen.getByText('1 double-assigned').tagName, screen.getByText('Group 1 + Scoutmaster conference').textContent]).toEqual(['SUMMARY', 'Group 1 + Scoutmaster conference']);
  });

  it('NoDoubles_NoCallout', () => {
    render(<StationsSection entryId={1} rotation={rotation} canSeed doubles={[]} />);
    expect(screen.queryByText(/double-assigned/)).toBeNull();
  });
});
