'use client';

/**
 * AdminDrawer — a right-side sheet over a full-width admin list (first used by Health Forms,
 * Plans/Admin-Health-Forms.md). The list stays mounted underneath, so ticks and scroll survive. 480px wide; the full
 * screen below 768px. `wide` is a centred 860px dialog instead, for a record that needs two panes (the health record
 * sheet, Plans/Admin-Health-Record-Sheet-Redesign.md). The header (title, sub, actions such as a ⋯, Close) and the
 * footer stay put; only the body scrolls.
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
  footer,
  wide = false
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Controls beside Close, such as a ⋯ menu. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** A centred 860px dialog rather than a right-edge sheet. */
  wide?: boolean;
}) {
  const uid = useId();
  const dialogProps = useDrawerDialog(onClose);
  return (
    <dialog {...dialogProps} className={wide ? `${s.drawer} ${s.wide}` : s.drawer} aria-labelledby={`${uid}-t`}>
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
