import { describe, it, expect, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageEditorDialog } from '../src/app/admin/(workspace)/_components/message-editor-dialog';
import { samplePreviewContext } from '../src/lib/signup-confirmation-preview';

/**
 * The shared message editor (Plans/Signup-Confirmation-Email.md): merge-field
 * buttons insert `[token]` at the caret, the preview re-renders as you type,
 * and Save is dirty-gated per the Save standard.
 */
/** Opens the dialog the way every call site does: ref.showModal() once mounted. */
function Host({ onSave, onClose }: { onSave: (s: string, b: string, n: string) => Promise<{ ok: boolean }>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <MessageEditorDialog
      ref={ref}
      kind="signup.family"
      initial={{ subject: 'Signed up: [event]', body: 'Hi [name].' }}
      previewCtx={samplePreviewContext()}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

function renderEditor(onSave = vi.fn(async () => ({ ok: true }))) {
  const onClose = vi.fn();
  render(<Host onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

describe('MessageEditorDialog', () => {
  it('MessageEditor_InsertsTokenAtCursor_AndPreviewUpdatesLive', async () => {
    const user = userEvent.setup();
    renderEditor();
    const body = screen.getByLabelText('Message') as HTMLTextAreaElement;
    const preview = screen.getByRole('complementary', { name: 'Preview' });
    expect(preview.textContent).toContain('Hi Dana Bieser.');

    body.focus();
    body.setSelectionRange(3, 3); // after "Hi "
    await user.click(within(screen.getByRole('group', { name: /insert a merge field/i })).getByRole('button', { name: '[scouts]' }));
    expect(body.value).toBe('Hi [scouts][name].');
    expect(preview.textContent).toContain('Hi Avery ScoutDana Bieser.');
  });

  it('MessageEditor_SaveIsDirtyGated_DiscardRestoresLastSaved', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const subject = screen.getByLabelText('Subject') as HTMLInputElement;
    await user.type(subject, '!');
    const dirtySave = screen.getByRole('button', { name: 'Save message' }) as HTMLButtonElement;
    expect(dirtySave.disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(subject.value).toBe('Signed up: [event]');
    expect(onSave).not.toHaveBeenCalled();
    await user.type(subject, '!!');
    await user.click(screen.getByRole('button', { name: 'Save message' }));
    expect(onSave).toHaveBeenCalledWith('Signed up: [event]!!', 'Hi [name].', '');
  });
});
