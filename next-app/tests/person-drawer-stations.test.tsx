import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PersonDrawer } from '../src/lib/meeting-planner-drawer';

/**
 * Station rotations step 4 (Plans/Planner-Station-Rotations.md): the person drawer's Tonight for a scout on a station
 * night: Move to Group N goes through twRotationMoveAction, Back to the draft clears the move, an ordinary group still
 * goes through twSetRoleAction, and Also tonight ticks twSetAlsoAction. The actions are mocked; nothing is saved.
 */
const m = vi.hoisted(() => ({
  open: vi.fn(),
  move: vi.fn(async () => ({ ok: true as const, stamp: 's' })),
  role: vi.fn(async () => ({ ok: true as const, stamp: 's' })),
  also: vi.fn(async () => ({ ok: true as const, stamp: 's' }))
}));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ entryId: 9, canEdit: true, sync: { serial: (_id: number, fn: () => unknown) => fn(), run: (fn: () => unknown) => fn() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
vi.mock('../src/app/(public)/planner/actions', () => ({
  plannerOpenPersonAction: m.open,
  plannerSetAnswerAction: vi.fn(),
  plannerTeacherAnswerAction: vi.fn(),
  plannerTogglePickAction: vi.fn(),
  plannerToggleTeachAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twRotationMoveAction: m.move, twSetRoleAction: m.role, twSetAlsoAction: m.also }));
const { PersonDrawerView } = await import('../src/app/(public)/planner/person-drawer');

const drawer = (hand: boolean, alsoOn = false): PersonDrawer =>
  ({
    kind: 'scout',
    name: 'Ava M',
    sub: 'New scout',
    intent: 'coming',
    shown: 'coming',
    picked: 0,
    max: 5,
    options: [],
    place: {
      now: 'Group 1 · Stations',
      options: [
        { id: 'rot:1', label: 'Group 1 · Stations', role: { role: 'rotate', group: 1 }, current: true },
        { id: 'rot:2', label: 'Group 2 · Stations', role: { role: 'rotate', group: 2 }, current: false },
        { id: 'fr:mb:citizenship-community', label: 'Citizenship in the Community merit badge', role: { role: 'group', key: 'fr:mb:citizenship-community' }, current: false }
      ],
      canUnassign: hand,
      unassignRole: { role: 'rotate', group: null },
      also: [{ key: 'star-5', label: 'Scoutmaster conference', on: alsoOn }]
    }
  }) as unknown as PersonDrawer;

const open = async (d: PersonDrawer) => {
  m.open.mockResolvedValue({ ok: true, drawer: d });
  render(<PersonDrawerView personId={7} onClose={vi.fn()} />);
  await screen.findByText('Group 1 · Stations', { selector: 'p' });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the drawer on a station night', () => {
  it('MoveToGroupTwo_UsesTheRotationMove', async () => {
    await open(drawer(false));
    fireEvent.click(screen.getByRole('radio', { name: 'Group 2 · Stations' }));
    await waitFor(() => expect(m.move).toHaveBeenCalledWith({ entryId: 9, personId: 7, group: 2 }));
  });

  it('MoveToAnOrdinaryGroup_UsesTheRole', async () => {
    await open(drawer(false));
    fireEvent.click(screen.getByRole('radio', { name: 'Citizenship in the Community merit badge' }));
    await waitFor(() => expect(m.role).toHaveBeenCalledWith({ entryId: 9, personId: 7, role: 'group', key: 'fr:mb:citizenship-community' }));
  });

  it('HandMoved_OffersBackToTheDraft', async () => {
    await open(drawer(true));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the draft' }));
    await waitFor(() => expect(m.move).toHaveBeenCalledWith({ entryId: 9, personId: 7, group: null }));
  });

  it('NotHandMoved_HasNoBackToTheDraft', async () => {
    await open(drawer(false));
    expect(screen.queryByRole('button', { name: 'Back to the draft' })).toBeNull();
  });

  it('AlsoTonight_TicksTheAlso', async () => {
    await open(drawer(false));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Scoutmaster conference' }));
    await waitFor(() => expect(m.also).toHaveBeenCalledWith({ entryId: 9, personId: 7, key: 'star-5', on: true }));
  });

  it('AlsoTonight_UntickTakesItOff', async () => {
    await open(drawer(false, true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Scoutmaster conference' }));
    await waitFor(() => expect(m.also).toHaveBeenCalledWith({ entryId: 9, personId: 7, key: 'star-5', on: false }));
  });

  it('CurrentGroup_IsTicked', async () => {
    await open(drawer(false));
    expect(screen.getByRole('radio', { name: 'Group 1 · Stations' }).getAttribute('aria-checked')).toBe('true');
  });
});
