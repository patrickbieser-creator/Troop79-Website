'use client';

/**
 * Shared public Drawer: a side panel over a dimmed page (Meeting Planner's person drawer, prototypes/meeting-plan-II/
 * README.md "Screen 2"). A native modal <dialog>, like the Menu Monster dialogs, so focus stays inside and Esc closes.
 * 440px from the right on a wide screen, the full screen at 480px and under.
 *
 * The header (eyebrow, title, subtitle, Close) and the footer stay put; only the body scrolls. Clicking the dimmed
 * page closes it. Focus goes back to whatever opened it, and the page behind doesn't scroll while it's open.
 */
import { useId, type ReactNode } from 'react';
import { useDrawerDialog } from '@/lib/use-drawer-dialog';
import s from './drawer.module.css';

export function Drawer({
  eyebrow,
  title,
  sub,
  onClose,
  children,
  footer
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The primary action and a footer line; stays visible while the body scrolls. */
  footer?: ReactNode;
}) {
  const uid = useId();
  // Open as a modal, lock the page, return focus on close: shared with the admin twin (lib/use-drawer-dialog).
  const dialogProps = useDrawerDialog(onClose);

  return (
    <dialog {...dialogProps} className={s.drawer} aria-labelledby={`${uid}-t`}>
      <div className={s.panel}>
        <header className={s.head}>
          <div className={s.headText}>
            {eyebrow ? <p className={s.eyebrow}>{eyebrow}</p> : null}
            <h2 id={`${uid}-t`} className={s.title}>
              {title}
            </h2>
            {sub ? <p className={s.sub}>{sub}</p> : null}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={s.body}>{children}</div>
        {footer ? <footer className={s.foot}>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
