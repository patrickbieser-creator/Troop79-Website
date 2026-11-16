'use client';

/**
 * AdminDrawer — a right-side sheet over a full-width admin list (first used by Health Forms,
 * Plans/Admin-Health-Forms.md). The list stays mounted underneath, so ticks and scroll survive. 480px wide; the full
 * screen below 768px. The header (title, sub, actions such as Prev / Next / ⋯, Close) and the footer stay put; only
 * the body scrolls.
 *
 * Behaviour (modal <dialog>, Esc and a click on the dimmed page close it, focus returns to the opener, the page is
 * scroll-locked) is lib/use-drawer-dialog, shared with the public Drawer. This file is only markup and admin tokens.
 */
import { useId, type ReactNode } from 'react';
import { useDrawerDialog } from '@/lib/use-drawer-dialog';
import s from './admin-drawer.module.css';

export function AdminDrawer({
  title,
  sub,
  actions,
  onClose,
  children,
  footer
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Controls beside Close: Prev / Next, a ⋯ menu. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const uid = useId();
  const dialogProps = useDrawerDialog(onClose);
  return (
    <dialog {...dialogProps} className={s.drawer} aria-labelledby={`${uid}-t`}>
      <div className={s.panel}>
        <header className={s.head}>
          <div className={s.headText}>
            <h2 id={`${uid}-t`} className={s.title} tabIndex={-1}>
              {title}
            </h2>
            {sub ? <p className={s.sub}>{sub}</p> : null}
          </div>
          {actions ? <div className={s.actions}>{actions}</div> : null}
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
