/**
 * Shared public content shell (wide 1180px / narrow 800px). Pairs with
 * PageHeader. Canonical rendering: /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './page-shell.module.css';

export function PageShell({
  width = 'wide',
  as: Tag = 'main',
  className,
  children
}: {
  width?: 'wide' | 'narrow';
  as?: 'main' | 'div' | 'section';
  className?: string;
  children: ReactNode;
}) {
  const cls = [s.main, width === 'narrow' ? s.narrow : null, className].filter(Boolean).join(' ');
  return <Tag className={cls}>{children}</Tag>;
}
