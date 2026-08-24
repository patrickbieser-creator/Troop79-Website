import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import {
  SaveButton,
  SaveFeedback,
  useSavedSnapshot,
  useFormDirty,
  useDraftSnapshot,
  DiscardButton,
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

describe('useSavePhase.doneThen — dialogs flash Done, then close', () => {
  function DlgHarness({ onClose }: { onClose: () => void }) {
    const phase = useSavePhase();
    return (
      <>
        <button type="button" onClick={() => phase.doneThen(onClose)}>save</button>
        <SaveFeedback phase={phase.phase} />
      </>
    );
  }
  it('ShowsDone_ThenRunsTheCallback', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<DlgHarness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(screen.getByRole('status').textContent).toMatch(/Done/);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('useFormDirty — uncontrolled forms snapshot their FormData', () => {
  function FormHarness() {
    const ref = useRef<HTMLFormElement>(null);
    const { dirty, markSaved } = useFormDirty(ref);
    return (
      <form ref={ref}>
        <input aria-label="Where" name="where" defaultValue="Church hall" />
        <SaveButton dirty={dirty} pending={false} onClick={markSaved} />
      </form>
    );
  }
  it('CleanOnMount_DirtyAfterTyping_CleanAgainAfterMarkSaved', async () => {
    const user = userEvent.setup();
    render(<FormHarness />);
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Where'), '!');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('TypingBackToTheOriginal_IsCleanAgain', async () => {
    const user = userEvent.setup();
    render(<FormHarness />);
    await user.type(screen.getByLabelText('Where'), '!');
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
  });
});

describe('DiscardButton + useDraftSnapshot — abandon changes, back to what is saved', () => {
  function DraftHarness() {
    const [title, setTitle] = useState('Campout');
    const { dirty, markSaved, saved } = useDraftSnapshot({ title });
    return (
      <form>
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <SaveButton dirty={dirty} pending={false} onClick={markSaved} />
        <DiscardButton dirty={dirty} onClick={() => setTitle(saved.title)} />
      </form>
    );
  }
  it('DisabledWhenClean_WithAReason', () => {
    render(<DraftHarness />);
    const btn = screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Nothing to discard');
  });
  it('RevertsToTheLastSavedValue_NotTheOriginal', () => {
    render(<DraftHarness />);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Camporee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.change(input, { target: { value: 'Jamboree' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(input.value).toBe('Camporee');
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('useFormDirty.reset — uncontrolled forms go back to what is saved', () => {
  function ResetHarness() {
    const ref = useRef<HTMLFormElement>(null);
    const { dirty, markSaved, reset } = useFormDirty(ref);
    return (
      <form ref={ref}>
        <input aria-label="Where" name="where" defaultValue="Church hall" />
        <SaveButton dirty={dirty} pending={false} onClick={markSaved} />
        <DiscardButton dirty={dirty} onClick={reset} />
      </form>
    );
  }
  it('ResetAfterASave_ReturnsToTheSavedValue', () => {
    render(<ResetHarness />);
    const input = screen.getByLabelText('Where') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Park pavilion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.input(input, { target: { value: 'Somewhere else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(input.value).toBe('Park pavilion');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
  });
});
