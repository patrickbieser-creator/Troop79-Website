'use client';

/**
 * EditBar — the one save bar on every admin edit screen (Plans/Shared-Save-Bar.md, 2026-11-15;
 * AGENTS.md "Controls on an edit screen" rule 2).
 *
 * Sticky at the top of the screen: Save + Discard changes on the left, a status line that ALWAYS
 * says whether anything is unsaved, the screen's own actions ("More actions…") on the right. The
 * border turns navy while there are unsaved changes.
 *
 * It also owns the leave-without-saving protection, so a screen on it cannot lose a draft
 * silently: while dirty it registers with the dirty guard (Back, the sidebar and guarded tabs ask
 * "Discard changes?") and adds the browser's own prompt on tab close / reload. Built after a
 * leader reassigned a page of scouts on Patrols, never saw the Save at the bottom of the table,
 * and walked away — nothing asked.
 *
 * Status, most specific wins: `status` (the caller's whole line — the person record names each
 * change) → while dirty, "N unsaved change(s) — Save to keep them" from `changes` → `cleanStatus`
 * → "All changes saved".
 */
import { useEffect, type ReactNode } from 'react';
import { DiscardButton, SaveButton } from './save-state';
import { useRegisterDirty } from './dirty-guard';
import styles from './edit-bar.module.css';

export function unsavedLine(changes: number): string {
  return `${changes} unsaved change${changes === 1 ? '' : 's'} — Save to keep them`;
}

export function EditBar({
  dirty,
  pending,
  onSave,
  onDiscard,
  blocked,
  onBlocked,
  saveLabel,
  changes,
  status,
  cleanStatus,
  right,
  ariaLabel = 'Save changes',
  specimen = false
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** The standard blocked shape: Save stays enabled and a click calls onBlocked (see SaveButton). */
  blocked?: boolean;
  onBlocked?: () => void;
  /** Save's label while dirty; defaults to "Save changes". */
  saveLabel?: string;
  /** How many things are unsaved, for the default dirty line. */
  changes?: number;
  /** Replaces the whole status line (dirty and clean). */
  status?: ReactNode;
  /** What the line says when nothing is unsaved. */
  cleanStatus?: ReactNode;
  /** Screen actions on the right: More actions…, Send sign-in link. */
  right?: ReactNode;
  ariaLabel?: string;
  /** Styleguide only: draw the bar without guarding the page it sits on. */
  specimen?: boolean;
}) {
  const guarding = dirty && !specimen;
  useRegisterDirty(guarding);
  useEffect(() => {
    if (!guarding) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guarding]);

  const line =
    status ??
    (dirty ? (
      <strong>{changes != null ? unsavedLine(changes) : 'Unsaved changes — Save to keep them'}</strong>
    ) : (
      (cleanStatus ?? 'All changes saved')
    ));

  return (
    <div className={[styles.bar, dirty ? styles.barDirty : ''].join(' ')} role="region" aria-label={ariaLabel}>
      <SaveButton
        dirty={dirty}
        pending={pending}
        blocked={blocked}
        onBlocked={onBlocked}
        dirtyLabel={saveLabel}
        onClick={onSave}
      />
      <DiscardButton dirty={dirty} pending={pending} onClick={onDiscard} />
      <span className={styles.status} aria-live="polite">
        {line}
      </span>
      {right && <span className={styles.right}>{right}</span>}
    </div>
  );
}
