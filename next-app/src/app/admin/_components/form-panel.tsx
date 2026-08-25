/**
 * Shared admin form surfaces (2026-08-24, the FormPanel/FormSection backlog
 * item — Patrick 2026-08-21: "add it to the backlog").
 *
 * The admin design system centralised tokens and several components, but the
 * CONTAINERS that hold form fields stayed per-screen (`.panel`, `.formPanel`,
 * `.editSectionCard`, `.editGrid` ×5 …), each reading the tokens on its own —
 * which is why flipping the form-surface tint (v1.71.1) touched ~11
 * stylesheets for a one-line token change. These two make the next such
 * decision one file.
 *
 *   FormPanel   — the tinted surface (--admin-form-bg, gray-200 border, radius,
 *                 shadow-sm) with an optional uppercase head + actions slot.
 *                 Fields inside read white-on-tint, which is the whole point.
 *   FormSection — the numbered section card promoted from the scout editor
 *                 (navy left rule, circled number, uppercase title, actions).
 *
 * Lives beside Button in admin/_components so the print pages can reach it.
 * Canonical rendering: /admin/styleguide/admin → Form Surfaces.
 */
import type { ComponentProps, ReactNode } from 'react';
import s from './form-panel.module.css';

export function FormPanel({
  title,
  actions,
  note,
  className,
  children,
  ...rest
}: {
  /** Uppercase panel head, e.g. "Logistics". Omit for a bare surface. */
  title?: ReactNode;
  /** Right-aligned controls in the head — Save / Discard / feedback. */
  actions?: ReactNode;
  /** Small explanatory line under the head. */
  note?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'section'>, 'className' | 'children' | 'title'>) {
  return (
    <section className={[s.panel, className].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <div className={s.head}>
          {title && <h2 className={s.title}>{title}</h2>}
          {actions && <div className={s.actions}>{actions}</div>}
        </div>
      )}
      {note && <p className={s.note}>{note}</p>}
      {children}
    </section>
  );
}

export function FormSection({
  num,
  title,
  actions,
  sectionRef,
  className,
  children
}: {
  num: number;
  title: string;
  actions?: ReactNode;
  /** The scout editor's scroll-spy hooks each section by ref. */
  sectionRef?: (el: HTMLDivElement | null) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={[s.section, className].filter(Boolean).join(' ')} ref={sectionRef} data-section={num - 1}>
      <div className={s.sectionHead}>
        <span className={s.num}>{num}</span>
        <h4 className={s.sectionTitle}>{title}</h4>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}
