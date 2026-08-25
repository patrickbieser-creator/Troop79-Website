'use client';

/**
 * The shared message editor (Plans/Signup-Confirmation-Email.md): subject,
 * merge-field insert buttons for the template KIND, a markdown body on the
 * news editor's MarkdownSource (cheat sheet, toolbar slot), and a preview
 * that is the REAL email — lib/email-markdown's inline-styled HTML, framed
 * the way a mail client shows it, with a plain-text toggle for the twin that
 * goes out alongside it (Patrick, 2026-08-25: "full markdown style support,
 * with a robust preview, the same as is offered in news").
 *
 * The preview context is the event's real logistics plus a sample family; a
 * caller with real signups (the builder) passes `loadHouseholds` /
 * `loadContext` and the leader can preview as any household that signed up.
 *
 * Save follows the standard (useDraftSnapshot → SaveButton / DiscardButton);
 * Cancel closes, and closing is discarding. Specimen: /admin/styleguide/admin
 * → Dialogs → Message Editor.
 */
import { forwardRef, useEffect, useId, useRef, useState, useTransition } from 'react';
import { templateKind } from '@/lib/email-templates';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { DEFAULT_SUMMARY_MD, fullMessageMd, renderMessage, type ConfirmationContext } from '@/lib/signup-confirmation';
import { Dialog, DialogActions, DialogBody, DialogHeader } from './dialog';
import { MarkdownSource, type MarkdownEditorHandle } from './markdown-split-pane';
import { Notice } from './notice';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from './save-state';
import { Button } from '../../_components/button';
import styles from './message-editor-dialog.module.css';

export interface PreviewHousehold {
  id: number;
  label: string;
}

export interface MessageEditorProps {
  kind: string;
  title?: string;
  initial: { subject: string; body: string; name?: string };
  /** Adds a Name field above the subject — the library's create/rename. */
  nameField?: boolean;
  /** The sample-family context — always the default "Preview as". */
  previewCtx: ConfirmationContext;
  /** With `loadContext`: lets the leader preview as a real household on this signup. */
  loadHouseholds?: () => Promise<PreviewHousehold[]>;
  loadContext?: (householdId: number) => Promise<ConfirmationContext | null>;
  onSave: (subject: string, body: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

const SAMPLE = 'sample';

export const MessageEditorDialog = forwardRef<HTMLDialogElement, MessageEditorProps>(function MessageEditorDialog(
  { kind, title = 'Edit message', initial, nameField = false, previewCtx, loadHouseholds, loadContext, onSave, onClose },
  ref
) {
  const def = templateKind(kind);
  const audience = def?.audience ?? 'family';
  const [name, setName] = useState(initial.name ?? '');
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const ids = { name: useId(), subject: useId(), body: useId(), as: useId() };

  // Preview-as: the sample family, or a real household loaded on demand.
  const canPickHousehold = !!loadHouseholds && !!loadContext;
  const [households, setHouseholds] = useState<PreviewHousehold[] | null>(null);
  const [previewAs, setPreviewAs] = useState<string>(SAMPLE);
  const [householdCtx, setHouseholdCtx] = useState<{ id: number; ctx: ConfirmationContext } | null>(null);
  const [loading, startLoad] = useTransition();
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!loadHouseholds) return;
    let live = true;
    loadHouseholds().then((list) => {
      if (live) setHouseholds(list);
    });
    return () => {
      live = false;
    };
  }, [loadHouseholds]);

  function chooseHousehold(value: string) {
    setPreviewAs(value);
    if (value === SAMPLE || !loadContext) return;
    const id = Number(value);
    startLoad(async () => {
      const ctx = await loadContext(id);
      if (ctx) setHouseholdCtx({ id, ctx });
      else {
        setHouseholdCtx(null);
        setPreviewAs(SAMPLE);
      }
    });
  }

  const draft = { name, subject, body };
  const snap = useDraftSnapshot(draft);
  const blocked = !subject.trim() || !body.trim() || (nameField && !name.trim());

  function insert(token: string) {
    const text = `[${token}]`;
    if (editorRef.current) editorRef.current.insertInline(text);
    else setBody((b) => b + text);
  }

  function insertSummaryLayout() {
    if (editorRef.current) editorRef.current.insertAtCursor(DEFAULT_SUMMARY_MD);
    else setBody((b) => `${b}\n\n${DEFAULT_SUMMARY_MD}`);
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

  // The preview IS the email: same markdown → HTML/text pipeline as the sender
  // (lib/signup-confirmation-send), same action button, same footer.
  const ctx = previewAs !== SAMPLE && householdCtx && String(householdCtx.id) === previewAs ? householdCtx.ctx : previewCtx;
  const rendered = renderMessage({ subject, body }, ctx, audience);
  const action = audience === 'leader' ? { url: ctx.event.rosterUrl, label: 'Open roster' } : { url: ctx.event.publicUrl, label: 'Open event' };
  const email = renderMarkdownEmail({
    md: `# ${rendered.subject || '(no subject)'}\n\n${fullMessageMd(rendered, audience === 'family')}`,
    actionUrl: action.url,
    actionLabel: action.label
  });

  const toolbar = (
    <div className={styles.tokens} role="group" aria-label="Insert a merge field">
      {(def?.fields ?? []).map((f) => (
        <Button key={f.token} variant="quiet" size="sm" title={f.label} onClick={() => insert(f.token)}>
          [{f.token}]
        </Button>
      ))}
    </div>
  );

  return (
    <Dialog ref={ref} onClose={onClose} className={styles.wide}>
      <DialogHeader title={title} sub={def ? `${def.label} · markdown · fields in [brackets] fill in when the email is sent` : undefined} />
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
              <input id={ids.subject} type="text" value={subject} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]+/g, ' '))} />
            </label>
            <div className={styles.field}>
              <label className={`adminLabel ${styles.label}`} htmlFor={ids.body}>
                Message
              </label>
              <MarkdownSource
                id={ids.body}
                ref={editorRef}
                ariaLabel="Message"
                value={body}
                onChange={setBody}
                rows={12}
                cheatSheet
                toolbar={toolbar}
                textareaClassName={styles.source}
                placeholder="Markdown — **bold**, *italic*, [links](https://…), - lists, ## headings"
              />
              <div className={styles.summaryHelper}>
                <Button variant="quiet" size="sm" onClick={insertSummaryLayout}>
                  Show the summary layout
                </Button>
                <span className={styles.hint}>
                  Inserts the Going / Guests / Days… block so you can edit its captions and order. Sections left empty
                  disappear.
                </span>
              </div>
            </div>
          </div>
          <aside className={styles.preview} aria-label="Preview">
            <div className={styles.previewHead}>
              <span className={`adminLabel ${styles.label}`}>Preview</span>
              <button type="button" className={styles.textToggle} aria-pressed={showText} onClick={() => setShowText((v) => !v)}>
                {showText ? 'Show HTML' : 'Plain-text'}
              </button>
            </div>
            {canPickHousehold && (
              <label className={styles.previewAs} htmlFor={ids.as}>
                <span className={styles.hint}>Preview as</span>
                <select id={ids.as} value={previewAs} onChange={(e) => chooseHousehold(e.target.value)}>
                  <option value={SAMPLE}>Sample family</option>
                  {(households ?? []).map((h) => (
                    <option key={h.id} value={String(h.id)}>
                      {h.label}
                    </option>
                  ))}
                </select>
                {loading && <span className={styles.hint}>Loading…</span>}
              </label>
            )}
            <div className={styles.emailFrame} aria-live="polite">
              {showText ? (
                <pre className={styles.emailText}>{email.text}</pre>
              ) : (
                <div className={styles.emailHtml} dangerouslySetInnerHTML={{ __html: email.html }} />
              )}
            </div>
            <p className={styles.previewHint}>
              {ctx === previewCtx ? 'Sample family, this event’s real dates and place.' : `${ctx.household.label}’s real signup.`}
            </p>
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
