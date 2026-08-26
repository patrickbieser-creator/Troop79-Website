'use client';

/**
 * Shared admin <dialog> implementing THE approved spec (Patrick,
 * 2026-08-21 — see dialog.module.css and /admin/styleguide/admin). Phase A of
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
import { forwardRef, useRef } from 'react';
import styles from './dialog.module.css';

/** True when the point is outside the dialog box — i.e. on the backdrop.
 *  A zero-size rect (not laid out, e.g. jsdom) can't be judged: treat the
 *  <dialog>-targeted click as the backdrop, the pre-2026-08-25 rule. */
function onBackdrop(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return true;
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

type DialogProps = {
  danger?: boolean;
  /** Fired on every close path: Esc, backdrop click, or a .close() call. */
  onClose?: () => void;
  /** Default true. Pass false when the CONSUMER owns the close decision —
   *  e.g. fast-entry's MB focus modal guards unsaved ticks — so a backdrop
   *  click never silently closes. Esc still fires the native `cancel`
   *  event, which the consumer intercepts via onCancel + preventDefault
   *  (that path has always been consumer-interceptable and stays so). */
  closeOnBackdrop?: boolean;
  /** With closeOnBackdrop={false}: fired when a backdrop click is refused,
   *  so the consumer can route it through its own guarded close attempt. */
  onBackdropAttempt?: () => void;
  /** Width/size override only (e.g. a per-screen `.wide` class capping at
   *  900px) — the spec chrome itself is not overridable. */
  className?: string;
  children: React.ReactNode;
} & Omit<React.DialogHTMLAttributes<HTMLDialogElement>, 'className' | 'onClose'>;

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { danger, onClose, closeOnBackdrop = true, onBackdropAttempt, className, children, ...rest },
  ref
) {
  const cls = [styles.dialog, danger ? styles.danger : null, className]
    .filter(Boolean)
    .join(' ');
  // A backdrop click is a press AND a release both outside the box. A click
  // whose target is the <dialog> element is not proof of that (2026-08-25,
  // the message editor "closing on mouse movement"): the dialog's own
  // scrollbar is the element itself, and a drag that starts in a field and
  // releases elsewhere fires `click` on the common ancestor.
  const pressedOnBackdrop = useRef(false);
  return (
    <dialog
      ref={ref}
      className={cls}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget && onBackdrop(e.currentTarget, e.clientX, e.clientY);
      }}
      onClick={(e) => {
        const pressed = pressedOnBackdrop.current;
        pressedOnBackdrop.current = false;
        if (e.target !== e.currentTarget) return;
        if (!pressed || !onBackdrop(e.currentTarget, e.clientX, e.clientY)) return;
        if (closeOnBackdrop) e.currentTarget.close();
        else onBackdropAttempt?.();
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
