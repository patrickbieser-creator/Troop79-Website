'use client';

/**
 * The admin twin of the public sign-up form's Save standard — next-app/AGENTS.md
 * "Save buttons: dirty-gated, labelled, and loud about what they did"
 * (Patrick, 2026-08-23; audit of 65 admin controls + rollout 2026-08-24, after
 * "I've noticed it right now on the calendar function where that behavior is
 * missing. I would love to standardize this save behavior so it works with
 * the better UX everywhere").
 *
 * Three pieces, used together by every edit form on an already-saved thing:
 *
 *   useSavedSnapshot(draftKey)  — dirty = draft differs from what is saved.
 *       The snapshot is taken on mount with useState(() => key) — never a ref
 *       read during render — and MOVED by markSaved() after an in-page save,
 *       because admin forms mostly stay open after saving (no reload, unlike
 *       the public forms that redirect with ?saved=1).
 *   SaveButton                  — "Save changes" when dirty, "Saved" (disabled,
 *       title="No changes to save yet") when clean, the caller's own verb for
 *       a first-ever save. Greyed, never hidden. Takes the SCREEN's button
 *       class so it looks like that screen's primary — this file owns the
 *       behaviour, not the paint.
 *   useSavePhase + SaveFeedback — "Saving changes…" the moment the save starts,
 *       a brief "Done" when it lands, both role="status" so a screen reader
 *       hears them; the Done clears itself. Public forms do the same with
 *       events/[id]/save-feedback.tsx; the admin↔public firewall forbids
 *       importing across, so this is the admin-token copy.
 *
 * Canonical rendering: /admin/styleguide/admin → "Save buttons".
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useRegisterDirty } from './dirty-guard';
import styles from './save-state.module.css';
import { Button } from '../../_components/button';

export function useSavedSnapshot(draftKey: string): { dirty: boolean; markSaved: () => void } {
  const [savedKey, setSavedKey] = useState(() => draftKey);
  const markSaved = useCallback(() => setSavedKey(draftKey), [draftKey]);
  const dirty = draftKey !== savedKey;
  // Every dirty form takes part in BackNav's Discard-changes prompt (2026-08-25).
  useRegisterDirty(dirty);
  return { dirty, markSaved };
}

/**
 * The same gate, keeping the saved DRAFT itself (not just its key) so the form
 * can put it back — Patrick, 2026-08-24: "a cancel option, which abandons all
 * changes and reverts the form to its previous saved state". `saved` is the
 * object as of mount / the last markSaved(); a discard handler applies it to
 * the form's setters.
 */
export function useDraftSnapshot<T>(draft: T): { dirty: boolean; markSaved: () => void; saved: T } {
  const [saved, setSaved] = useState(() => ({ key: JSON.stringify(draft), value: draft }));
  const draftKey = JSON.stringify(draft);
  const markSaved = useCallback(() => setSaved({ key: draftKey, value: draft }), [draftKey, draft]);
  const dirty = draftKey !== saved.key;
  useRegisterDirty(dirty);
  return { dirty, markSaved, saved: saved.value };
}

/**
 * The same gate for an UNCONTROLLED form (one read via `new FormData(form)` on
 * submit): the form's entries are snapshotted on mount, re-read on every
 * input/change event, and compared. The saved snapshot lives in a ref that is
 * only touched in effects and event handlers — never read during render.
 */
export function useFormDirty(ref: RefObject<HTMLFormElement | null>): {
  dirty: boolean;
  markSaved: () => void;
  /** Discard: back to what was last saved (form.reset() against re-synced defaults). */
  reset: () => void;
} {
  const saved = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useRegisterDirty(dirty);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    saved.current = serializeForm(form);
    const check = () => setDirty(serializeForm(form) !== saved.current);
    form.addEventListener('input', check);
    form.addEventListener('change', check);
    return () => {
      form.removeEventListener('input', check);
      form.removeEventListener('change', check);
    };
  }, [ref]);
  const markSaved = useCallback(() => {
    const form = ref.current;
    if (form) saved.current = serializeForm(form);
    setDirty(false);
  }, [ref]);
  // Not form.reset(): that restores DEFAULTS, which React re-syncs from the
  // defaultValue props on every render — so Discard would fall back to what the
  // page loaded with, not to the last save. Write the saved entries back instead.
  const reset = useCallback(() => {
    const form = ref.current;
    if (form && saved.current) restoreForm(form, saved.current);
    setDirty(false);
  }, [ref]);
  return { dirty, markSaved, reset };
}

function restoreForm(form: HTMLFormElement, serialized: string) {
  const byName = new Map<string, string[]>();
  for (const [k, v] of JSON.parse(serialized) as [string, string][]) {
    byName.set(k, [...(byName.get(k) ?? []), v]);
  }
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    if (!el.name) continue;
    const vals = byName.get(el.name) ?? [];
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = vals.includes(el.value);
    } else if (el instanceof HTMLInputElement && el.type === 'file') {
      continue;
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.options)) o.selected = vals.includes(o.value);
    } else {
      el.value = vals[0] ?? '';
    }
  }
}

/**
 * The Discard half of the standard (Patrick, 2026-08-24: "a cancel option,
 * which abandons all changes and reverts the form to its previous saved
 * state"). Greyed — never hidden — when there is nothing to discard. The
 * caller's onClick puts the saved draft back (useDraftSnapshot().saved) or
 * calls useFormDirty().reset(). Dialogs and inline row editors keep their
 * Cancel: closing IS discarding there.
 */
export function DiscardButton({
  dirty,
  pending = false,
  label = 'Discard changes',
  className,
  onClick
}: {
  dirty: boolean;
  pending?: boolean;
  label?: string;
  className?: string;
  onClick: () => void;
}) {
  const disabled = !dirty || pending;
  // The shared Button paints it (2026-08-24); a screen may still stack a class.
  return (
    <Button
      variant="secondary"
      className={className}
      disabled={disabled}
      title={!dirty ? 'Nothing to discard' : undefined}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function serializeForm(form: HTMLFormElement): string {
  const out: [string, string][] = [];
  new FormData(form).forEach((v, k) => out.push([k, typeof v === 'string' ? v : v.name]));
  return JSON.stringify(out);
}

export type SavePhase = 'idle' | 'saving' | 'done' | 'failed';

/** Drives SaveFeedback. `done()` shows the flash and clears it after `ms`;
 *  `doneThen(cb)` shows it briefly and THEN runs `cb` — for dialogs that
 *  close on save, so the Done is seen before the dialog goes. */
export function useSavePhase(ms = 1800): {
  phase: SavePhase;
  start: () => void;
  done: () => void;
  doneThen: (cb: () => void, holdMs?: number) => void;
  fail: () => void;
} {
  const [phase, setPhase] = useState<SavePhase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    phase,
    start: useCallback(() => {
      clear();
      setPhase('saving');
    }, []),
    done: useCallback(() => {
      clear();
      setPhase('done');
      timer.current = setTimeout(() => setPhase('idle'), ms);
    }, [ms]),
    doneThen: useCallback((cb: () => void, holdMs = 700) => {
      clear();
      setPhase('done');
      timer.current = setTimeout(() => {
        setPhase('idle');
        cb();
      }, holdMs);
    }, []),
    fail: useCallback(() => {
      clear();
      setPhase('failed');
    }, [])
  };
}

export function SaveButton({
  dirty,
  pending,
  isNew = false,
  newLabel = 'Save',
  dirtyLabel = 'Save changes',
  savedLabel = 'Saved',
  pendingLabel = 'Saving…',
  /** Extra reason the button is off even when dirty (a required field blank). */
  blocked = false,
  blockedReason,
  className,
  onClick,
  type = 'button'
}: {
  dirty: boolean;
  pending: boolean;
  isNew?: boolean;
  newLabel?: string;
  dirtyLabel?: string;
  savedLabel?: string;
  pendingLabel?: string;
  blocked?: boolean;
  blockedReason?: string;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const clean = !isNew && !dirty;
  const disabled = pending || clean || blocked;
  const label = pending ? pendingLabel : isNew ? newLabel : dirty ? dirtyLabel : savedLabel;
  const title = clean ? 'No changes to save yet' : blocked ? blockedReason : undefined;
  // Navy primary from the shared Button (2026-08-24) — every Save looks the
  // same without each screen lending its own class. `className` still stacks.
  return (
    <Button
      variant="primary"
      type={type}
      className={className}
      disabled={disabled}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function SaveFeedback({
  phase,
  savingLabel = 'Saving changes…',
  doneLabel = 'Your changes are saved.'
}: {
  phase: SavePhase;
  savingLabel?: string;
  doneLabel?: string;
}) {
  if (phase === 'saving') {
    return (
      <div className={styles.overlay} role="status" aria-live="assertive">
        <div className={styles.dialog}>
          <span className={styles.spinner} aria-hidden="true" />
          <strong>{savingLabel}</strong>
        </div>
      </div>
    );
  }
  if (phase === 'done') {
    return (
      <div className={styles.overlay} role="status" aria-live="polite">
        <div className={`${styles.dialog} ${styles.done}`}>
          <span className={styles.check} aria-hidden="true">✓</span>
          <strong>Done</strong>
          <span>{doneLabel}</span>
        </div>
      </div>
    );
  }
  return null;
}
