'use client';

/**
 * The per-section edit shell of the person record page (Plans/Person-
 * Editor-Rethink.md, Phase 2 — Direction A, Stripe-style): every section is
 * read-only until its ONE Edit; Edit turns that section into a form with a
 * dirty-gated Save ("Save changes" / "Saved", greyed with a reason when a
 * required name is blank) and a Cancel that restores the LAST SAVED values —
 * not what the page loaded with. Saving…→Done via the shared save-state
 * pieces, then back to the read row with a "Saved just now" stamp and the
 * same short flash the Status card uses.
 *
 * ONE SECTION EDITABLE AT A TIME. `SectionEditProvider` owns which section
 * is open and whether it is dirty; opening another section's Edit while the
 * open one is dirty asks "Discard unsaved changes?" through the shared Dialog
 * (the prototype's guardDirty). Each section registers with `useSectionForm`;
 * outside the provider (a section rendered alone in a test) the hook keeps
 * its own open/closed flag, so nothing needs the provider to work.
 *
 * Nothing here knows a field name — a section passes its draft type, the
 * action that saves it, and the read/edit markup.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import { useRegisterDirty } from '../../../_components/dirty-guard';
import { SaveButton, SaveFeedback, useSavePhase, type SavePhase } from '../../../_components/save-state';
import styles from './person-record.module.css';

const FLASH_MS = 1400;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

interface Coordinator {
  editingKey: string | null;
  /** Ask to open `key`. Resolves true once the section may open (immediately
   *  when nothing else is dirty; after "Discard changes" otherwise). */
  requestEdit: (key: string, title: string) => Promise<boolean>;
  close: (key: string) => void;
  reportDirty: (key: string, dirty: boolean) => void;
}

const Ctx = createContext<Coordinator | null>(null);

interface PendingEdit {
  key: string;
  title: string;
  resolve: (ok: boolean) => void;
}

export function SectionEditProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState<{ key: string; title: string } | null>(null);
  // Mirrors of the state for the stable callbacks — read in handlers only.
  const editingRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const pendingRef = useRef<PendingEdit | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (pending && dlg && !dlg.open) dlg.showModal();
  }, [pending]);

  const open = useCallback((key: string, title: string) => {
    editingRef.current = key;
    dirtyRef.current = false;
    setEditing({ key, title });
  }, []);

  const requestEdit = useCallback(
    (key: string, title: string) => {
      if (editingRef.current === key) return Promise.resolve(true);
      if (editingRef.current == null || !dirtyRef.current) {
        open(key, title);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const p = { key, title, resolve };
        pendingRef.current = p;
        setPending(p);
      });
    },
    [open]
  );

  const close = useCallback((key: string) => {
    if (editingRef.current !== key) return;
    editingRef.current = null;
    dirtyRef.current = false;
    setEditing(null);
  }, []);

  const reportDirty = useCallback((key: string, dirty: boolean) => {
    if (editingRef.current === key) dirtyRef.current = dirty;
  }, []);

  // Keep editing: every close path (Esc, backdrop, the button) lands here.
  function keepEditing() {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(false);
  }

  function discard() {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!p) return;
    open(p.key, p.title);
    p.resolve(true);
  }

  const editingKey = editing?.key ?? null;
  const value = useMemo<Coordinator>(
    () => ({ editingKey, requestEdit, close, reportDirty }),
    [editingKey, requestEdit, close, reportDirty]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {pending && (
        <Dialog ref={dialogRef} danger aria-labelledby={titleId} onClose={keepEditing}>
          <DialogHeader title={<span id={titleId}>Discard unsaved changes?</span>} />
          <DialogBody>
            <p className={styles.panelCopy}>
              You have edits in <strong>{editing?.title}</strong> that have not been saved.
            </p>
          </DialogBody>
          <DialogActions>
            <Button variant="secondary" size="sm" onClick={() => dialogRef.current?.close()}>
              Keep editing
            </Button>
            <Button variant="dangerSolid" size="sm" onClick={discard}>
              Discard changes
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Ctx.Provider>
  );
}

export interface SectionFormOptions<T extends Record<string, string>> {
  /** Unique within the page — the coordinator's handle for this section. */
  key: string;
  /** Named in the Discard prompt ("You have edits in Details…"). */
  title: string;
  /** What is saved, as of mount. The hook keeps its own copy from then on. */
  saved: T;
  save: (draft: T, saved: T) => Promise<ActionResult>;
  /** A required-field gate: the reason Save is off even though the draft is dirty. */
  blockedReason?: (draft: T) => string | null;
  onSaved?: (next: T, prev: T) => void;
}

export interface SectionForm<T extends Record<string, string>> {
  editing: boolean;
  draft: T;
  saved: T;
  dirty: boolean;
  blockedReason: string | null;
  busy: boolean;
  error: string | null;
  stamped: boolean;
  flash: boolean;
  phase: SavePhase;
  startEdit: () => void;
  cancel: () => void;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  submit: () => void;
  /** Move the saved baseline without a form round-trip (the household Undo). */
  replaceSaved: (next: T) => void;
}

export function useSectionForm<T extends Record<string, string>>(o: SectionFormOptions<T>): SectionForm<T> {
  const ctx = useContext(Ctx);
  const [savedValue, setSavedValue] = useState<T>(o.saved);
  const [draft, setDraft] = useState<T>(o.saved);
  const [localEditing, setLocalEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [flash, setFlash] = useState(false);
  const feedback = useSavePhase();

  const editing = ctx ? ctx.editingKey === o.key : localEditing;
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(savedValue);
  const blockedReason = editing ? (o.blockedReason?.(draft) ?? null) : null;

  // BackNav's Discard-changes prompt, and the coordinator's own guard.
  useRegisterDirty(dirty);
  useEffect(() => {
    ctx?.reportDirty(o.key, dirty);
  }, [ctx, o.key, dirty]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const { key, title, save, onSaved } = o;

  const startEdit = useCallback(() => {
    const go = () => {
      setDraft(savedValue);
      setError(null);
      setStamped(false);
      if (!ctx) setLocalEditing(true);
    };
    if (!ctx) {
      go();
      return;
    }
    void ctx.requestEdit(key, title).then((ok) => {
      if (ok) go();
    });
  }, [ctx, key, title, savedValue]);

  const finish = useCallback(() => {
    if (ctx) ctx.close(key);
    else setLocalEditing(false);
  }, [ctx, key]);

  const cancel = useCallback(() => {
    setDraft(savedValue);
    setError(null);
    finish();
  }, [savedValue, finish]);

  const setField = useCallback(<K extends keyof T>(k: K, value: T[K]) => {
    setDraft((d) => ({ ...d, [k]: value }));
  }, []);

  const submit = useCallback(() => {
    if (!dirty || blockedReason || busy) return;
    setBusy(true);
    setError(null);
    feedback.start();
    void (async () => {
      try {
        const res = await save(draft, savedValue);
        if (!res.ok) {
          feedback.fail();
          setError(res.error ?? 'Something went wrong.');
          return;
        }
        const prev = savedValue;
        setSavedValue(draft);
        setStamped(true);
        setFlash(true);
        feedback.done();
        finish();
        onSaved?.(draft, prev);
      } catch (e) {
        feedback.fail();
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    })();
  }, [dirty, blockedReason, busy, feedback, save, draft, savedValue, finish, onSaved]);

  const replaceSaved = useCallback((next: T) => {
    setSavedValue(next);
    setDraft(next);
    setStamped(true);
    setFlash(true);
  }, []);

  return {
    editing,
    draft,
    saved: savedValue,
    dirty,
    blockedReason,
    busy,
    error,
    stamped,
    flash,
    phase: feedback.phase,
    startEdit,
    cancel,
    setField,
    submit,
    replaceSaved
  };
}

/**
 * The card chrome: heading, "Saved just now" stamp, the one Edit (hidden
 * while editing — the form's Cancel is the way out), the body, and at most
 * one "How this works" disclosure (D-070).
 */
export function SectionCard({
  title,
  form,
  help,
  children
}: {
  title: string;
  form: Pick<SectionForm<Record<string, string>>, 'editing' | 'stamped' | 'flash' | 'startEdit' | 'error'>;
  help?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const cls = [styles.card, form.editing ? styles.cardEditing : null, form.flash ? styles.cardFlash : null]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={cls} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId}>{title}</h2>
        {form.stamped && <span className={styles.stamp}>Saved just now</span>}
        {!form.editing && (
          <Button size="sm" onClick={form.startEdit}>
            Edit
          </Button>
        )}
      </div>
      <div className={styles.cardBody}>
        {form.error && <Notice>{form.error}</Notice>}
        {children}
        {help && (
          <div>
            <button type="button" className={styles.disc} aria-expanded={helpOpen} onClick={() => setHelpOpen((h) => !h)}>
              How this works
            </button>
            {helpOpen && (
              <div className={styles.discBody}>
                <p>{help}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Cancel + the dirty-gated Save, and the Saving…→Done feedback. */
export function SectionFormActions({
  form,
  doneLabel = 'Your changes are saved.'
}: {
  form: Pick<SectionForm<Record<string, string>>, 'dirty' | 'blockedReason' | 'busy' | 'phase' | 'cancel' | 'submit'>;
  doneLabel?: string;
}) {
  return (
    <>
      <div className={styles.actions}>
        <Button onClick={form.cancel} disabled={form.busy}>
          Cancel
        </Button>
        <SaveButton
          dirty={form.dirty}
          pending={form.busy}
          blocked={form.blockedReason != null}
          blockedReason={form.blockedReason ?? undefined}
          onClick={form.submit}
        />
      </div>
      <SaveFeedback phase={form.phase} savingLabel="Saving…" doneLabel={doneLabel} />
    </>
  );
}

/** The two-column field grid every section form uses. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

/** One labelled field. Wraps the control in its <label>, so the label text
 *  is the control's accessible name. */
export function Field({
  label,
  required = false,
  full = false,
  error,
  children
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  /** Inline validation line under the control (a blank required name). */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={full ? `${styles.field} ${styles.full}` : styles.field}>
      <span>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? <span className={styles.err}>{error}</span> : null}
    </label>
  );
}

/** A value shown inside the form that cannot be edited here (internal id, derived rank). */
export function ReadOnlyField({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <div className={mono ? `${styles.ro} ${styles.mono}` : styles.ro}>{children}</div>
    </div>
  );
}

export function ReadRows({ children }: { children: ReactNode }) {
  return <dl className={styles.dl}>{children}</dl>;
}

export function ReadRow({ label, derived = false, children }: { label: string; derived?: boolean; children: ReactNode }) {
  const empty = children == null || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <>
      <dt>
        {label}
        {derived ? <span className={styles.derived}> · derived</span> : null}
      </dt>
      <dd>{empty ? <span className={styles.empty}>—</span> : children}</dd>
    </>
  );
}
