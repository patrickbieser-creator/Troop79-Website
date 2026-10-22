import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RotationEditorData } from '../src/app/admin/(workspace)/advancement/meeting-plan/rotations-editor';

/**
 * Meeting board, Phase 3b, v1's merit badge night in Admin: the leader's rotations editor (dirty-gated; moves, helpers,
 * adding a scout who didn't answer, "Start over from the draft"). Since P5a (Decision 10 of Plans/Meeting-Planner-II.md)
 * the member page and the meeting editor's tray treat a merit badge night as an ordinary meeting; this editor goes in
 * P5c. Server actions are the mock boundary.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const calls = vi.hoisted(() => ({ teach: vi.fn(), unteach: vi.fn(), saveRotations: vi.fn(), intent: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/advancement-catalog', () => ({ loadAdvancementCatalog: async () => ({}) }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({
  boardStampAction: vi.fn(),
  setMeetingBoardAction: vi.fn(),
  setMeetingStationsAction: vi.fn(),
  saveRotationsAction: calls.saveRotations
}));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: vi.fn(),
  meetingRemovePickAction: vi.fn(),
  meetingSetOrderAction: vi.fn(),
  meetingSetNoteAction: vi.fn(),
  meetingSetIntentAction: calls.intent
}));
vi.mock('../src/app/(public)/member/meeting/teach-actions', () => ({
  meetingTeachAction: calls.teach,
  meetingUnteachAction: calls.unteach,
  meetingWithdrawOfferAction: vi.fn(),
  meetingTeacherIntentAction: vi.fn(),
  meetingPostOfferAction: vi.fn()
}));

const { RotationsEditor } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/rotations-editor');

beforeEach(() => {
  for (const f of [...Object.values(calls), nav.refresh]) f.mockReset();
});

const EDITOR: RotationEditorData = {
  entryId: 5,
  stations: [
    { index: 0, topicId: 70, title: 'Fire safety', location: null },
    { index: 1, topicId: 71, title: 'Nutrition', location: null }
  ],
  schedules: [
    [0, 1],
    [1, 0]
  ],
  groups: [
    [
      { personId: 1, name: 'Anjali S', patrol: 'Hawks', skips: [], isNew: false, undecided: false },
      { personId: 2, name: 'Finn P', patrol: 'Hawks', skips: [1], isNew: false, undecided: false }
    ],
    [{ personId: 3, name: 'Leo M', patrol: 'Owls', skips: [], isNew: false, undecided: true }]
  ],
  holders: [{ personId: 4, name: 'Maya C', patrol: 'Foxes', undecided: false, placement: null }],
  noAnswer: [{ personId: 5, name: 'Theo P', patrol: 'Owls', awarded: false, skips: [] }],
  arranged: false
};

describe('the rotations editor', () => {
  it('Leader_SeesGroupsByRotation_WithFinishedStations', () => {
    render(<RotationsEditor data={EDITOR} />);
    const a = screen.getByRole('region', { name: 'Group A' });
    expect([within(a).getAllByRole('listitem').map((l) => l.textContent).slice(0, 2), within(a).getByText(/done: Nutrition/) != null]).toEqual([['Fire safety', 'Nutrition'], true]);
  });

  it('RotationsEditor_SaveIsGreyed_UntilSomethingMoves', () => {
    render(<RotationsEditor data={EDITOR} />);
    expect([screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled'), screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')]).toEqual([true, true]);
  });

  it('Leader_MovesAScoutToAnotherGroup_AndSaves_PinningEveryoneShown', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move Finn P to' }), '1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Place Maya C' }), 'st:70');
    await userEvent.click(screen.getByRole('button', { name: 'Save rotations' }));
    expect(calls.saveRotations).toHaveBeenCalledWith({
      entryId: 5,
      placements: [
        { personId: 1, placement: { kind: 'group', group: 0 } },
        { personId: 2, placement: { kind: 'group', group: 1 } },
        { personId: 3, placement: { kind: 'group', group: 1 } },
        { personId: 4, placement: { kind: 'helper', topicId: 70 } }
      ]
    });
  });

  it('Leader_AddsAScoutWhoDidntAnswer_ToAGroup', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add Theo P' }), '0');
    expect([within(screen.getByRole('region', { name: 'Group A' })).getByText('Theo P') != null, screen.getByText(/added by you/) != null, screen.queryByRole('combobox', { name: 'Add Theo P' })]).toEqual([true, true, null]);
  });

  it('Leader_DiscardsMoves_BackToTheSavedGroups', async () => {
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move Finn P to' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(within(screen.getByRole('region', { name: 'Group A' })).getByText('Finn P')).toBeTruthy();
  });

  it('RotationsEditor_FlagsAGroupOverEight_ButStillSaves', async () => {
    const big = { ...EDITOR, groups: [Array.from({ length: 9 }, (_, i) => ({ personId: 10 + i, name: `Scout ${i}`, patrol: null, skips: [], isNew: false, undecided: false })), []] };
    render(<RotationsEditor data={big} />);
    expect([screen.getByText('9 is over the 8 cap. Move someone.') != null, screen.getByText(/You can still save/) != null]).toEqual([true, true]);
  });

  it('Leader_StartsOverFromTheDraft_AfterConfirming', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={{ ...EDITOR, arranged: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start over from the draft' }));
    expect(calls.saveRotations).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(calls.saveRotations).toHaveBeenCalledWith({ entryId: 5, placements: [] });
  });

  it('RotationsEditor_StartOver_IsGreyed_WhenTheseAreTheDraft', () => {
    render(<RotationsEditor data={EDITOR} />);
    expect(screen.getByRole('button', { name: 'Start over from the draft' }).hasAttribute('disabled')).toBe(true);
  });

  it('RotationsEditor_SaysToSetStationsFirst', () => {
    render(<RotationsEditor data={{ ...EDITOR, stations: [], groups: [], schedules: [] }} />);
    expect(screen.getByText(/Set the stations above first/)).toBeTruthy();
  });
});

describe('the rotations editor for a youth leader', () => {
  it('YouthLeader_SeesTheGroups_ReadOnly', () => {
    render(<RotationsEditor data={EDITOR} readOnly />);
    expect([screen.queryByRole('button', { name: 'Saved' }), screen.getByRole('combobox', { name: 'Move Finn P to' }).hasAttribute('disabled'), screen.queryByRole('button', { name: 'Start over from the draft' })]).toEqual([null, true, null]);
  });
});
