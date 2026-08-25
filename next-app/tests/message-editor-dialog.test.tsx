import { describe, it, expect, vi } from 'vitest';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageEditorDialog, type MessageEditorProps } from '../src/app/admin/(workspace)/_components/message-editor-dialog';
import { samplePreviewContext } from '../src/lib/signup-confirmation-preview';
import type { ConfirmationContext } from '../src/lib/signup-confirmation';

/**
 * The shared message editor (Plans/Signup-Confirmation-Email.md, markdown +
 * real-email preview 2026-08-25): merge-field buttons insert `[token]` inline
 * at the caret, the preview is lib/email-markdown's HTML re-rendered as you
 * type, "Preview as" swaps in a real household, and Save is dirty-gated.
 */
interface Handle {
  insertAtCursor(t: string): void;
  insertInline(t: string): void;
  replaceRange(s: number, e: number, t: string): void;
  focus(): void;
}
// MarkdownSource is the news editor's client surface; stand in with a plain
// textarea that honours the imperative handle the dialog drives.
vi.mock('../src/app/admin/(workspace)/_components/markdown-split-pane', () => ({
  MarkdownSource: ({
    value,
    onChange,
    ariaLabel,
    toolbar,
    ref
  }: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel: string;
    toolbar?: React.ReactNode;
    ref?: Ref<Handle>;
  }) => {
    const area = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({
      insertInline(t) {
        const at = area.current?.selectionStart ?? value.length;
        onChange(value.slice(0, at) + t + value.slice(at));
      },
      insertAtCursor(t) {
        onChange(`${value}\n\n${t}`);
      },
      replaceRange() {},
      focus() {}
    }));
    return (
      <div>
        {toolbar}
        <textarea ref={area} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
}));

/** Opens the dialog the way every call site does: ref.showModal() once mounted. */
function Host(props: Partial<MessageEditorProps> & { onSave: MessageEditorProps['onSave']; onClose: () => void }) {
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
      {...props}
    />
  );
}

function renderEditor(onSave = vi.fn(async () => ({ ok: true })), extra: Partial<MessageEditorProps> = {}) {
  const onClose = vi.fn();
  render(<Host onSave={onSave} onClose={onClose} {...extra} />);
  return { onSave, onClose };
}

const previewHtml = () => screen.getByRole('complementary', { name: 'Preview' }).innerHTML;

describe('MessageEditorDialog', () => {
  it('MessageEditor_InsertsTokenInlineAtCursor_AndPreviewUpdatesLive', async () => {
    const user = userEvent.setup();
    renderEditor();
    const body = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(previewHtml()).toContain('Hi Dana Bieser.');

    body.focus();
    body.setSelectionRange(3, 3); // after "Hi "
    await user.click(within(screen.getByRole('group', { name: /insert a merge field/i })).getByRole('button', { name: '[event]' }));
    expect(body.value).toBe('Hi [event][name].');
    expect(previewHtml()).toContain('Hi Fall CampoutDana Bieser.');
  });

  it('MessageEditor_PreviewIsTheRealEmail_MarkdownBoldAndSummaryCaptions', async () => {
    const user = userEvent.setup();
    renderEditor();
    const body = screen.getByLabelText('Message');
    await user.clear(body);
    await user.type(body, 'Pack **warm** clothes.');
    const html = previewHtml();
    expect(html).toContain('<strong>warm</strong>');
    // A family receipt always carries the summary block — its "Going" caption is real markdown.
    expect(html).toContain('<strong>Going</strong>');
    expect(html).toContain('Avery Scout');
    await user.click(screen.getByRole('button', { name: 'Plain-text' }));
    expect(screen.getByRole('complementary', { name: 'Preview' }).textContent).toContain('Pack warm clothes.');
  });

  it('MessageEditor_ShowTheSummaryLayout_InsertsTheEditableBlock', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Show the summary layout' }));
    const body = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(body.value).toContain('**Going**\n[going]');
  });

  it('MessageEditor_PreviewAsHousehold_LoadsThatContext', async () => {
    const user = userEvent.setup();
    const real: ConfirmationContext = {
      ...samplePreviewContext(),
      household: { ...samplePreviewContext().household, submitterName: 'Jordan Real', label: 'The Real family' }
    };
    const loadContext = vi.fn(async (id: number) => (id === 7 ? real : null));
    renderEditor(undefined, { loadHouseholds: async () => [{ id: 7, label: 'The Real family' }], loadContext });
    const select = (await screen.findByLabelText(/preview as/i)) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'The Real family' })).toBeTruthy());
    await act(async () => {
      await user.selectOptions(select, '7');
    });
    await waitFor(() => expect(previewHtml()).toContain('Hi Jordan Real.'));
    expect(loadContext).toHaveBeenCalledWith(7);
    expect(previewHtml()).not.toContain('Hi Dana Bieser.');
  });

  it('MessageEditor_SubjectIsSingleLine', async () => {
    const user = userEvent.setup();
    renderEditor();
    const subject = screen.getByLabelText('Subject') as HTMLInputElement;
    await user.clear(subject);
    await user.paste('Line one\nLine two');
    expect(subject.value).not.toContain('\n');
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
