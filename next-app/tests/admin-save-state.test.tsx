import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  SaveButton,
  SaveFeedback,
  useSavedSnapshot,
  useSavePhase
} from '../src/app/admin/(workspace)/_components/save-state';

/**
 * The admin twin of the public sign-up form's Save standard (next-app/AGENTS.md
 * "Save buttons", Patrick 2026-08-23; audit + rollout 2026-08-24):
 *   1. disabled until the draft differs from what is saved,
 *   2. the label says the state — "Save changes" / "Saved" (a first save keeps its verb),
 *   3. "Saving changes…" while it works, a brief "Done" when it lands,
 *   4. greyed, never hidden.
 */

function Harness({ isNew = false }: { isNew?: boolean }) {
  const [title, setTitle] = useState('Campout');
  const { dirty, markSaved } = useSavedSnapshot(JSON.stringify({ title }));
  const phase = useSavePhase();
  return (
    <form>
      <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <SaveButton
        dirty={dirty}
        pending={phase.phase === 'saving'}
        isNew={isNew}
        newLabel="Add entry"
        onClick={() => {
          phase.start();
          markSaved();
          phase.done();
        }}
      />
      <SaveFeedback phase={phase.phase} />
    </form>
  );
}

afterEach(() => vi.useRealTimers());

describe('SaveButton + useSavedSnapshot — dirty-gated, labelled', () => {
  it('CleanOnMount_ReadsSaved_AndIsDisabledWithAReason', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Saved' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('No changes to save yet');
  });

  it('EditingTheDraft_EnablesIt_AndReadsSaveChanges', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Title'), '!');
    const btn = screen.getByRole('button', { name: 'Save changes' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.getAttribute('title')).toBeNull();
  });

  it('AfterSaving_TheSnapshotMoves_SoItReadsSavedAgain', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('AFirstEverSave_KeepsItsOwnVerb_AndIsNotDirtyGated', () => {
    render(<Harness isNew />);
    const btn = screen.getByRole('button', { name: 'Add entry' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SaveFeedback — Saving… then a brief Done', () => {
  it('ShowsDone_ThenClearsItself', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Campout!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('status').textContent).toMatch(/Done/);
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('SavingPhase_AnnouncesSavingChanges', () => {
    render(<SaveFeedback phase="saving" />);
    expect(screen.getByRole('status').textContent).toMatch(/Saving changes/);
  });
});
