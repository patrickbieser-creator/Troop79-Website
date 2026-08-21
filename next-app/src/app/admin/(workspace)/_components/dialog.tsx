'use client';

/**
 * Shared admin <dialog> implementing THE approved spec (Patrick,
 * 2026-08-21 — see dialog.module.css and /admin/styleguide). Phase A of
 * Plans/Admin-Design-System.md replaced the four legacy per-screen
 * .dialog copies (calendar, meetings, albums, media-manager) with this.
 *
 * The component owns the chrome and the two behaviors every legacy copy
 * re-implemented by hand:
 *   - close on backdrop click (a click whose target is the <dialog>
 *     element itself can only land on the backdrop — the banded
 *     header/body/actions zones cover the whole box)
 *   - the close event (Esc, backdrop, or .close()) funnels to `onClose`,
 *     so callers keep one state-reset path
 *
 * Call sites keep their imperative ref usage (showModal()/close()), same
 * as the legacy pattern. Compose the zones as children:
 *
 *   <Dialog ref={ref} onClose={reset}>
 *     <DialogHeader title="Edit calendar entry" sub="Changes apply…" />
 *     <DialogBody>fields…</DialogBody>
 *     <DialogActions>buttons…</DialogActions>
 *   </Dialog>
 *
 * `danger` switches the header band to the destructive treatment; pair it
 * with a solid danger confirm button (the one place solid danger is
 * allowed — in-context destructive buttons stay outlined, per the Phase A
 * danger-button decision).
 */
import { forwardRef } from 'react';
import styles from './dialog.module.css';

type DialogProps = {
  danger?: boolean;
  /** Fired on every close path: Esc, backdrop click, or a .close() call. */
  onClose?: () => void;
  children: React.ReactNode;
} & Omit<React.DialogHTMLAttributes<HTMLDialogElement>, 'className' | 'onClose'>;

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { danger, onClose, children, ...rest },
  ref
) {
  return (
    <dialog
      ref={ref}
      className={danger ? `${styles.dialog} ${styles.danger}` : styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      {...rest}
    >
      {children}
    </dialog>
  );
});

export function DialogHeader({ title, sub }: { title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={styles.header}>
      <h3 className={styles.title}>{title}</h3>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </div>
  );
}

export function DialogBody({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={className ? `${styles.body} ${className}` : styles.body}>{children}</div>;
}

export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
