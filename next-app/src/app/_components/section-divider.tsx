/**
 * Shared public SectionDivider — uppercase label, hairline rule, optional
 * trailing link. Canonical rendering: /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './section-divider.module.css';

export function SectionDivider({
  label,
  link,
  className
}: {
  label: ReactNode;
  link?: ReactNode;
  className?: string;
}) {
  return (
    <div className={[s.divider, className].filter(Boolean).join(' ')}>
      <span className={s.label}>{label}</span>
      <div className={s.rule} />
      {link != null && <span className={s.link}>{link}</span>}
    </div>
  );
}
