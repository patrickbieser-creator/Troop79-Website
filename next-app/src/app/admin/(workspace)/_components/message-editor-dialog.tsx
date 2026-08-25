'use client';

/**
 * The shared message editor (Plans/Signup-Confirmation-Email.md): subject,
 * merge-field insert buttons for the template KIND, body, and a live preview
 * rendered from real event logistics + sample people. One dialog serves the
 * template library (Lookups & Admin) and the signup builder's "Customize for
 * this event…" — the newsletter is the obvious next consumer.
 *
 * Save follows the standard (useDraftSnapshot → SaveButton / DiscardButton);
 * Cancel closes, and closing is discarding. Specimen: /admin/styleguide/admin
 * → Dialogs → Message Editor.
 */
import { forwardRef, useId, useRef, useState, useTransition } from 'react';
import { templateKind } from '@/lib/email-templates';
import { renderMessage, type ConfirmationContext } from '@/lib/signup-confirmation';
import { Dialog, DialogActions, DialogBody, DialogHeader } from './dialog';
import { Notice } from './notice';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from './save-state';
import { Button } from '../../_components/button';
import styles from './message-editor-dialog.module.css';

export interface MessageEditorProps {
  kind: string;
  title?: string;
  initial: { subject: string; body: string; name?: string };
  /** Adds a Name field above the subject — the library's create/rename. */
  nameField?: boolean;
  previewCtx: ConfirmationContext;
  onSave: (subject: string, body: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export const MessageEditorDialog = forwardRef<HTMLDialogElement, MessageEditorProps>(function MessageEditorDialog(
  { kind, title = 'Edit message', initial, nameField = false, previewCtx, onSave, onClose },
  ref
) {
  const def = templateKind(kind);
  const [name, setName] = useState(initial.name ?? '');
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ids = { name: useId(), subject: useId(), body: useId() };

  const draft = { name, subject, body };
  const snap = useDraftSnapshot(draft);
  const blocked = !subject.trim() || !body.trim() || (nameField && !name.trim());

  function insert(token: string) {
    const el = bodyRef.current;
    const text = `[${token}]`;
    if (!el) {
      setBody((b) => b + text);
      return;
    }
    const from = el.selectionStart ?? body.length;
    const to = el.selectionEnd ?? from;
    const next = body.slice(0, from) + text + body.slice(to);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from + text.length, from + text.length);
    });
  }

  function discard() {
    setName(snap.saved.name);
    setSubject(snap.saved.subject);
    setBody(snap.saved.body);
    setError(null);
  }

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await onSave(subject.trim(), body.trim(), name.trim());
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Could not save the message.');
        return;
      }
      snap.markSaved();
      feedback.doneThen(onClose);
    });
  }

  const preview = renderMessage({ subject, body }, previewCtx, def?.audience ?? 'family');

  return (
    <Dialog ref={ref} onClose={onClose} className={styles.wide}>
      <DialogHeader title={title} sub={def ? `${def.label} · fields in [brackets] fill in when the email is sent` : undefined} />
      <DialogBody>
        <div className={styles.split}>
          <div className={styles.editor}>
            {nameField && (
              <label className={styles.field} htmlFor={ids.name}>
                <span className={`adminLabel ${styles.label}`}>Name</span>
                <input id={ids.name} type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label className={styles.field} htmlFor={ids.subject}>
              <span className={`adminLabel ${styles.label}`}>Subject</span>
              <input id={ids.subject} type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <div className={styles.tokens} role="group" aria-label="Insert a merge field">
              {(def?.fields ?? []).map((f) => (
                <Button key={f.token} variant="quiet" size="sm" title={f.label} onClick={() => insert(f.token)}>
                  [{f.token}]
                </Button>
              ))}
            </div>
            <label className={styles.field} htmlFor={ids.body}>
              <span className={`adminLabel ${styles.label}`}>Message</span>
              <textarea id={ids.body} ref={bodyRef} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
          </div>
          <aside className={styles.preview} aria-label="Preview">
            <span className={`adminLabel ${styles.label}`}>Preview</span>
            <div className={styles.previewCard}>
              <strong className={styles.previewSubject}>{preview.subject || '(no subject)'}</strong>
              {preview.body.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {preview.summaryLines.length > 0 && (
                <ul className={styles.previewList}>
                  {preview.summaryLines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
            <p className={styles.previewHint}>Sample family, this event&rsquo;s real dates and place.</p>
          </aside>
        </div>
        {error && <Notice>{error}</Notice>}
      </DialogBody>
      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <DiscardButton dirty={snap.dirty} pending={pending} onClick={discard} />
        <SaveButton
          dirty={snap.dirty}
          pending={pending}
          dirtyLabel="Save message"
          blocked={blocked}
          blockedReason={nameField && !name.trim() ? 'Give the template a name' : 'Subject and message are both required'}
          onClick={save}
        />
      </DialogActions>
      <SaveFeedback phase={feedback.phase} doneLabel="Message saved." />
    </Dialog>
  );
});
