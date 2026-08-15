'use client';

import { useState, useTransition } from 'react';
import type { WithdrawableEntityType } from '@/lib/change-requests';
import styles from './profile.module.css';

/**
 * The button row shared by both /profile editors, and the three states a form
 * can be in once it shows pending values rather than live ones:
 *
 *   clean, nothing pending    submit disabled, nothing to say
 *   clean, something pending  submit disabled, "Undo pending update" offered
 *   edited                    submit live, "Discard edits" offered
 *
 * SUBMIT IS DISABLED RATHER THAN REJECTED. The form already displays whatever
 * is in the queue, so a submit that changes nothing is not a mistake worth an
 * error message — it is a button that should not have invited the click. The
 * server still refuses an empty diff (actions.ts) for anything that bypasses
 * this; the disabled state is the courtesy, not the guard.
 *
 * UNDO IS TWO-STEP, not a confirm() dialog — a browser modal blocks the page
 * and reads as a browser error rather than a choice, and this one is cheap to
 * get wrong by reflex.
 */
export function EditorActions({
  entityType,
  entityId,
  hasPending,
  dirty,
  isSubmitting,
  onSubmit,
  onDiscard,
  withdrawAction
}: {
  entityType: WithdrawableEntityType;
  entityId: string;
  hasPending: boolean;
  dirty: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  onDiscard: () => void;
  withdrawAction: (formData: FormData) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isWithdrawing, startWithdraw] = useTransition();
  const busy = isSubmitting || isWithdrawing;

  function withdraw() {
    const fd = new FormData();
    fd.set('entityType', entityType);
    fd.set('entityId', entityId);
    startWithdraw(() => withdrawAction(fd));
  }

  if (confirming) {
    return (
      <div className={styles.editActions}>
        <span className={styles.actionsHint}>
          Remove your pending update? {entityType === 'scout' ? 'This scout' : 'This person'}&rsquo;s
          record keeps the information it has now.
        </span>
        <button
          type="button"
          className={styles.editCancelBtn}
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep it
        </button>
        <button type="button" className={styles.editDangerBtn} disabled={busy} onClick={withdraw}>
          {isWithdrawing ? 'Removing…' : 'Yes, remove it'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.editActions}>
      {!dirty && hasPending && (
        <span className={styles.actionsHint}>
          These changes are in the queue. Edit any field to replace them.
        </span>
      )}
      {!dirty && !hasPending && (
        <span className={styles.actionsHint}>No changes to submit.</span>
      )}
      {hasPending && (
        <button
          type="button"
          className={styles.editCancelBtn}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Undo pending update
        </button>
      )}
      {dirty && (
        <button type="button" className={styles.editCancelBtn} disabled={busy} onClick={onDiscard}>
          Discard edits
        </button>
      )}
      <button
        type="button"
        className={styles.editSaveBtn}
        disabled={busy || !dirty}
        onClick={onSubmit}
      >
        {isSubmitting ? 'Submitting…' : hasPending ? 'Replace pending update' : 'Submit update'}
      </button>
    </div>
  );
}
