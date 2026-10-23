import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import type { LiveView } from '../src/lib/meeting-live-shared';

/**
 * Rotations L1 on the Live screen (Plans/Build-A-Plan.md, "Rotations", Decision 2): a scout placed automatically from a
 * late pick says New on their chip until a planner marks it seen, one at a time from the scout's sheet or all at once
 * from the bar. Viewers see the tag but no controls. Server actions are mocked.
 */
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), dismissNew: vi.fn() }));
vi.mock('../src/app/(public)/planner/live-actions', () => ({
  plannerLiveSuggestAction: vi.fn(),
  plannerLiveMoveScoutAction: vi.fn(),
  plannerLiveSetTeacherAction: vi.fn(),
  plannerLiveMoveClassAction: vi.fn(),
  plannerLiveRepeatClassAction: vi.fn(),
  plannerLiveRemoveClassAction: vi.fn(),
  plannerLiveAddRotationAction: vi.fn(),
  plannerLiveDropRotationAction: vi.fn(),
  plannerLiveSetLocationAction: vi.fn(),
  plannerLiveAddClassAction: vi.fn(),
  plannerLiveSetPresentAction: vi.fn(),
  plannerLiveAddVisitorAction: vi.fn(),
  plannerLiveResetAction: vi.fn(),
  plannerLiveMakeClassAction: vi.fn(),
  plannerLiveUseClassTeacherAction: vi.fn(),
  plannerLiveDismissNewAction: mocks.dismissNew
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { LiveBoard, TEACHER_IS_PLANS, TEACHER_REPEAT_ONLY } from '../src/app/(public)/planner/rotations/live-board';

const member = (personId: number, name: string, isNew = false) => ({ personId, name, retake: false, present: false, visitor: false, isNew });
const VIEW: LiveView = {
  started: true,
  rotations: [
    { number: 1, location: null },
    { number: 2, location: null }
  ],
  cards: [
    {
      id: 'c:1',
      topicKey: 'star-6',
      rotation: 1,
      title: 'Cyber Chip',
      codeLabel: 'Star 6',
      kind: 'rank',
      teacher: { personId: 10, name: 'Pat B', present: false },
      members: [member(1, 'Finn P'), member(4, 'Anjali S', true)],
      repeats: [],
      conflicts: [],
      version: 2
    }
  ],
  pool: [],
  overlaps: 0,
  drift: []
};
const ok = { ok: true, stamp: 's' };
const chipText = (card: HTMLElement, name: string) => within(card).getAllByRole('listitem').find((li) => li.textContent?.startsWith(name))?.textContent ?? '';

afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockReset();
});

describe('Rotations L1: New on the Live screen', () => {
  it('Chip_PlacedAutomatically_SaysNew', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={133} />);
    const card = screen.getByRole('article', { name: 'Cyber Chip' });
    expect(chipText(card, 'Anjali S')).toContain('New');
  });

  it('Chip_PlacedByHand_HasNoNew', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={133} />);
    const card = screen.getByRole('article', { name: 'Cyber Chip' });
    expect(chipText(card, 'Finn P')).not.toContain('New');
  });

  it('Bar_Editor_MarkAllSeen_DismissesEveryNew', async () => {
    mocks.dismissNew.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => expect(mocks.dismissNew).toHaveBeenCalledWith({ entryId: 133, classId: null, personId: null }));
  });

  it('Bar_Editor_SaysHowManyAreNew', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={133} />);
    expect(screen.getByText('1 placed from a late pick')).toBeTruthy();
  });

  it('Bar_Viewer_HasNoMarkAllSeen', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={133} />);
    expect(screen.queryByRole('button', { name: 'Mark all seen' })).toBeNull();
  });

  it('ScoutSheet_New_MarkSeen_DismissesThatChip', async () => {
    mocks.dismissNew.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: /^Anjali S, new/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Mark seen/ }));
    await waitFor(() => expect(mocks.dismissNew).toHaveBeenCalledWith({ entryId: 133, classId: 'c:1', personId: 4 }));
  });

  it('ScoutSheet_RemoveFromClass_SaysTheyStayOut', async () => {
    render(<LiveBoard view={VIEW} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: /^Anjali S, new/ }));
    expect((await screen.findByRole('button', { name: /^Remove from this class/ })).textContent).toContain('won’t be put back automatically');
  });
});

describe('Rotations L2: one teacher on the Live screen', () => {
  it('TeacherSheet_SingleClass_SaysItIsThePlansTeacher', async () => {
    render(<LiveBoard view={VIEW} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: /^Teacher: Pat B/ }));
    expect(await screen.findByText(`Rotation 1 · ${TEACHER_IS_PLANS}`)).toBeTruthy();
  });

  it('TeacherSheet_Repeat_SaysThisRepeatOnly', async () => {
    const repeated: LiveView = { ...VIEW, cards: [{ ...VIEW.cards[0], repeats: [2] }] };
    render(<LiveBoard view={repeated} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: /^Teacher: Pat B/ }));
    expect(await screen.findByText(`Rotation 1 · ${TEACHER_REPEAT_ONLY}`)).toBeTruthy();
  });
});
