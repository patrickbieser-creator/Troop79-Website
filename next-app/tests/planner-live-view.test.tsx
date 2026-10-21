import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import type { LiveView } from '../src/lib/meeting-live-shared';

/**
 * The read-only Meeting Live view (Plans/Meeting-Planner-II.md, P4a; prototypes/meeting-plan-II/phone/live.html):
 * rotation columns on desktop, one rotation at a time with a switcher on a phone, conflict lines, the retake star, and
 * a single "Start Meeting Live" for editors before anyone has started it.
 */
const mocks = vi.hoisted(() => ({ start: vi.fn(), refresh: vi.fn() }));
vi.mock('../src/app/(public)/planner/live-actions', () => ({ plannerLiveStartAction: mocks.start }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { LiveBoard } from '../src/app/(public)/planner/live/live-board';

const card = (o: Partial<LiveView['cards'][number]> & Pick<LiveView['cards'][number], 'id'>): LiveView['cards'][number] => ({
  topicKey: 'tenderfoot-4a',
  rotation: 1,
  title: 'First aid basics',
  codeLabel: 'Tenderfoot 4a',
  kind: 'rank',
  teacher: { personId: 10, name: 'Dan V' },
  members: [],
  repeats: [],
  conflicts: [],
  ...o
});

const VIEW: LiveView = {
  started: false,
  rotations: [
    { number: 1, location: 'Main hall' },
    { number: 2, location: null }
  ],
  cards: [
    card({ id: 's:a', members: [{ personId: 1, name: 'Finn P', retake: false }, { personId: 2, name: 'Lily P', retake: true }], repeats: [2], conflicts: ['Finn P also in the Rotation 2 repeat of this class'] }),
    card({ id: 's:b', rotation: 2, teacher: { personId: 11, name: 'Rachel D' }, members: [{ personId: 1, name: 'Finn P', retake: false }], repeats: [1], conflicts: ['Finn P also in the Rotation 1 repeat of this class'] }),
    card({ id: 's:c', rotation: null, topicKey: 'scout-1a', title: 'Oath, Law, motto, slogan', codeLabel: 'Scout 1a', teacher: null })
  ],
  pool: [{ personId: 4, name: 'Simon P' }],
  overlaps: 1
};

afterEach(() => {
  cleanup();
  mocks.start.mockReset();
});

describe('LiveBoard', () => {
  it('Viewer_SeesEveryRotation_AndNoControls', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const cols = ['Not scheduled', 'Rotation 1', 'Rotation 2'].map((name) => screen.getByRole('region', { name }));
    expect([cols.length, screen.queryByRole('button', { name: /Start Meeting Live/ })]).toEqual([3, null]);
  });

  it('Card_ShowsTeacherScoutsRepeatAndConflict', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const r1 = screen.getByRole('region', { name: 'Rotation 1' });
    expect([
      within(r1).getByText('Dan V') != null,
      within(r1).getByText('Repeat · also R2') != null,
      within(r1).getByText('Finn P also in the Rotation 2 repeat of this class') != null
    ]).toEqual([true, true, true]);
  });

  it('RetakeScout_GetsTheStar', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect([screen.getByLabelText('Lily P, retake: already completed this') != null, screen.queryByLabelText('Finn P, retake: already completed this')]).toEqual([true, null]);
  });

  it('Header_CountsOverlaps', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect(screen.getByText('1 overlap')).toBeTruthy();
  });

  it('NotScheduled_HoldsThePool_AndUnscheduledCards', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const u = screen.getByRole('region', { name: 'Not scheduled' });
    expect([within(u).getByText('Simon P') != null, within(u).getByText('Oath, Law, motto, slogan') != null, within(u).getByText('No teacher yet') != null]).toEqual([true, true, true]);
  });

  it('RotationLocation_ShowsUnderItsHeading', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect(within(screen.getByRole('region', { name: 'Rotation 1' })).getByText('Main hall')).toBeTruthy();
  });

  it('Phone_SwitcherSelectsOneRotation', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    fireEvent.click(screen.getByRole('tab', { name: /Rotation 2/ }));
    expect([
      screen.getByRole('tab', { name: /Rotation 2/ }).getAttribute('aria-selected'),
      screen.getByRole('tab', { name: /Rotation 1/ }).getAttribute('aria-selected'),
      screen.getByRole('region', { name: 'Rotation 2' }).dataset.phone,
      screen.getByRole('region', { name: 'Rotation 1' }).dataset.phone
    ]).toEqual(['true', 'false', 'shown', 'hidden']);
  });

  it('Editor_SeesStartMeetingLive_BeforeStart', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    expect(screen.getByRole('button', { name: 'Start Meeting Live' })).toBeTruthy();
  });

  it('Editor_SeesNoStart_OnceStarted', () => {
    render(<LiveBoard view={{ ...VIEW, started: true }} canEdit entryId={5} />);
    expect(screen.queryByRole('button', { name: 'Start Meeting Live' })).toBeNull();
  });

  it('Start_CallsTheAction_AndRefreshes', async () => {
    mocks.start.mockResolvedValue({ ok: true, stamp: 'x' });
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Meeting Live' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.start).toHaveBeenCalledWith({ entryId: 5 });
  });

  it('Start_SaysWhyWhenRefused', async () => {
    mocks.start.mockResolvedValue({ ok: false, error: 'That meeting has passed.' });
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Meeting Live' }));
    expect(await screen.findByText('That meeting has passed.')).toBeTruthy();
  });
});
