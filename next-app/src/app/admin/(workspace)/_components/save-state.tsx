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

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './save-state.module.css';

export function useSavedSnapshot(draftKey: string): { dirty: boolean; markSaved: () => void } {
  const [savedKey, setSavedKey] = useState(() => draftKey);
  const markSaved = useCallback(() => setSavedKey(draftKey), [draftKey]);
  return { dirty: draftKey !== savedKey, markSaved };
}

export type SavePhase = 'idle' | 'saving' | 'done' | 'failed';

/** Drives SaveFeedback. `done()` shows the flash and clears it after `ms`. */
export function useSavePhase(ms = 1800): {
  phase: SavePhase;
  start: () => void;
  done: () => void;
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
  return (
    <button
      type={type}
      className={`${styles.saveBtn}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      {label}
    </button>
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
