'use client';

/**
 * Shared public Drawer: a side panel over a dimmed page (Meeting Planner's person drawer, prototypes/meeting-plan-II/
 * README.md "Screen 2"). A native modal <dialog>, like the Menu Monster dialogs, so focus stays inside and Esc closes.
 * 440px from the right on a wide screen, the full screen at 480px and under.
 *
 * The header (eyebrow, title, subtitle, Close) and the footer stay put; only the body scrolls. Clicking the dimmed
 * page closes it. Focus goes back to whatever opened it, and the page behind doesn't scroll while it's open.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
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
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={s.drawer}
      aria-labelledby={`${uid}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dialog box itself (outside the panel) is a click on the dimmed page.
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
