import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import type { ThisWeek, TwPerson } from '../src/lib/this-week';

/** Live at the meeting (Plans/Completed/Meeting-Planner-III.md, Decision 10): the plan as session cards; tap to check in
 *  on the meeting day only; can't-come scouts aren't listed; Helping teach has no teacher slot. */
const m = vi.hoisted(() => ({ present: vi.fn(async () => ({ ok: true as const, stamp: 's' })), canEdit: true }));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twSetPresentAction: m.present }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: m.canEdit, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
const { LiveView } = await import('../src/app/(public)/planner/this-week-live');

const p = (personId: number, name: string, intent: TwPerson['intent'] = 'coming'): TwPerson => ({ personId, name, rank: 'scout', rankName: 'Scout', intent });
const view: ThisWeek = {
  focus: [{ key: 'fg:1', setId: 1, name: 'Citizenship' }],
  badges: [],
  groups: [
    {
      key: 'fr:tenderfoot',
      kind: 'rank',
      refId: 'tenderfoot',
      name: 'Tenderfoot',
      title: 'Tenderfoot group',
      base: 'fr:tenderfoot',
      section: 1,
      sections: 1,
      fromDone: 0,
      merged: false,
      offer: null,
      stored: null,
      subtitle: 'Working on Tenderfoot',
      summary: 'Citizenship',
      columns: [{ key: 'tenderfoot-7a', code: '7a', label: 'Flag', need: 2, subs: [] }],
      members: [p(1, 'Adi A'), p(2, 'Ben B', 'not_coming')],
      teachers: [],
      candidates: [],
      declineNotes: [],
      saidNo: []
    }
  ],
  sections: [],
  older: [],
  extras: [],
  helpers: [p(3, 'Finn P')],
  coverage: { counted: 2, rankWork: 2, nothing: 0, pct: 100, groupsWithoutTeacher: 1 },
  answers: { scouts: { coming: 2, undecided: 0, notComing: 1, none: 0 }, adults: { coming: 0, undecided: 0, notComing: 0, none: 0 } },
  adultsNoAnswer: [],
  responses: { coming: { scouts: [], adults: [] }, undecided: { scouts: [], adults: [] }, not_coming: { scouts: [], adults: [] } },
  unplaced: [],
  everyone: [],
  rotation: null,
  doubles: []
};

afterEach(() => {
  cleanup();
  m.present.mockClear();
});

describe('Live at the meeting', () => {
  it('Live_ShowsOneCardPerGroup_AndHelpingTeach', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Tenderfoot group', 'Helping teach']);
  });

  it('Live_CardCorner_SaysWhatIsTaught_NotACount', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Tenderfoot group' }).closest('section')!;
    expect([within(card).queryByText('Citizenship') !== null, within(card).queryByText(/here$/) === null]).toEqual([true, true]);
  });

  it('Live_SplitGroups_AreNamedAsOnThePlan', () => {
    const split = { ...view, groups: [{ ...view.groups[0], key: 'fr:tenderfoot~2', title: 'Tenderfoot Group 2', section: 2, sections: 2 }] };
    render(<LiveView entryId={1} view={split} isToday present={[]} />);
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toBe('Tenderfoot Group 2');
  });

  it('Live_LeavesOutScoutsWhoCantCome', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    expect(screen.queryByRole('button', { name: /Ben B/ })).toBeNull();
  });

  it('Live_HelpingTeach_HasNoTeacherSlot', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Helping teach' }).closest('section')!;
    expect(within(card).queryByText('No teachers yet')).toBeNull();
  });

  it('Live_TapOnTheMeetingDay_ChecksTheScoutIn', async () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    screen.getByRole('button', { name: 'Adi A' }).click();
    await vi.waitFor(() => expect(m.present).toHaveBeenCalledWith({ entryId: 1, personId: 1, present: true }));
  });

  it('Live_BeforeTheMeetingDay_NamesAreNotTappable', () => {
    render(<LiveView entryId={1} view={view} isToday={false} present={[]} />);
    expect((screen.getByRole('button', { name: 'Adi A' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Station rotations: at the meeting, each rotation group is a card with its route, and the stations' teachers check in
// on one card. A station isn't a session of its own (every group visits it).
describe('Live on a station night', () => {
  const t = (personId: number, name: string) => ({ personId, name, formal: name, kind: 'adult' as const }) as unknown as ThisWeek['everyone'][number];
  const mem = (personId: number, name: string, intent: TwPerson['intent'] = 'coming') => ({ personId, name, rank: 'scout', rankName: 'Scout', intent, done: [], helperAt: [] });
  const rot: ThisWeek['rotation'] = {
    on: true,
    problem: null,
    badgeId: 'climbing',
    badgeName: 'Climbing',
    stations: [
      { key: 'fg:1', title: 'Safety', goalMinutes: 20, cells: [], teachers: [t(50, 'Paul R')] },
      { key: 'fg:2', title: 'Terms', goalMinutes: 20, cells: [], teachers: [] }
    ],
    groups: [
      { number: 1, name: 'Group 1', seededFrom: 'Scout', members: [mem(11, 'Ava M'), mem(12, 'Ben B', 'not_coming')] },
      { number: 2, name: 'Group 2', seededFrom: 'Tenderfoot', members: [mem(21, 'Ezra L')] }
    ],
    rounds: [
      [0, 1],
      [1, 0]
    ],
    roundMinutes: 20,
    totalMinutes: 40
  };
  const night = { ...view, rotation: rot };

  it('LiveStations_EachRotationGroupIsACard_WithItsRoute', () => {
    render(<LiveView entryId={1} view={night} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Group 2 · Stations' }).closest('section')!;
    expect(within(card).getByText('Terms → Safety · 20 min each')).toBeTruthy();
  });

  it('LiveStations_GroupCardLeavesOutScoutsWhoCantCome', () => {
    render(<LiveView entryId={1} view={night} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Group 1 · Stations' }).closest('section')!;
    expect(within(card).queryByRole('button', { name: /Ben B/ })).toBeNull();
  });

  it('LiveStations_StationTeachersCheckInOnOneCard', () => {
    render(<LiveView entryId={1} view={night} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Station teachers' }).closest('section')!;
    expect([within(card).getByRole('button', { name: 'Paul R' }) !== null, within(card).getByText('No teacher yet') !== null]).toEqual([true, true]);
  });

  it('LiveStations_RotationGroupsComeFirst', () => {
    render(<LiveView entryId={1} view={night} isToday present={[]} />);
    expect(screen.getAllByRole('heading', { level: 2 }).slice(0, 3).map((h) => h.textContent)).toEqual(['Station teachers', 'Group 1 · Stations', 'Group 2 · Stations']);
  });

  it('LiveStations_TappingAGroupMember_ChecksThemIn', async () => {
    render(<LiveView entryId={1} view={night} isToday present={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ezra L' }));
    await waitFor(() => expect(m.present).toHaveBeenCalledWith({ entryId: 1, personId: 21, present: true }));
  });

  it('LiveStations_Off_NoStationCards', () => {
    render(<LiveView entryId={1} view={{ ...night, rotation: { ...rot, on: false } }} isToday present={[]} />);
    expect(screen.queryByRole('heading', { name: 'Station teachers' })).toBeNull();
  });
});
