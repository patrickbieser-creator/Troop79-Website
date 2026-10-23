'use client';

/**
 * Meeting Live's page-level menu and confirm (Build a Plan B8, Plans/Build-A-Plan.md; D-429).
 *
 *   - LiveMoreActions: "More actions…", a quiet disclosure in the bar. Rotations L3: "Suggest an arrangement" (the
 *     matcher, once) and "Reset to match picks" (was Discard). Both replace the arrangement, so both are danger items
 *     that open a danger Dialog (the edit-screen standard: a destructive menu item names its consequence).
 *   - ConfirmDialog: a native modal <dialog> with Cancel and one confirm, as Build a Plan's Remove dialog. The confirm
 *     may return a problem to show in place (red, role=alert); the dialog closes when it returns nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import { useDisclosure } from '@/app/_components/use-disclosure';
import styles from './live.module.css';

export function LiveMoreActions({ onSuggest, onReset }: { onSuggest: () => void; onReset: () => void }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();
  return (
    <div className={styles.moreWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={styles.moreBtn} aria-expanded={open} onClick={toggle}>
        More actions…
      </button>
      {open ? (
        <div className={styles.morePop}>
          <button
            type="button"
            className={styles.moreDanger}
            onClick={() => {
              close();
              onSuggest();
            }}
          >
            Suggest an arrangement
          </button>
          <button
            type="button"
            className={styles.moreDanger}
            onClick={() => {
              close();
              onReset();
            }}
          >
            Reset to match picks
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ConfirmDialog({
  title,
  confirm,
  busyLabel,
  danger = false,
  onConfirm,
  onClose,
  children
}: {
  title: string;
  confirm: string;
  busyLabel?: string;
  danger?: boolean;
  /** A problem to show, or nothing when it worked (the dialog then closes, unless the caller already closed it). */
  onConfirm: () => Promise<string | null | void> | void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg?.setAttribute('open', '');
  }, []);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setProblem(err);
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      className={styles.confirm}
      aria-labelledby="live-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="live-confirm-title" className={styles.confirmTitle}>
        {title}
      </h2>
      {children}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={styles.confirmActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={go} disabled={busy}>
          {busy && busyLabel ? busyLabel : confirm}
        </Button>
      </div>
    </dialog>
  );
}
