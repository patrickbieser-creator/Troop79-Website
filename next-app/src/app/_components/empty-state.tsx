/**
 * Shared public EmptyState — the italic dashed-border empty message, with an
 * optional action (link or Button). Canonical rendering:
 * /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './empty-state.module.css';

export function EmptyState({
  action,
  className,
  children
}: {
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={[s.emptyState, className].filter(Boolean).join(' ')}>
      {children}
      {action != null && <div className={s.action}>{action}</div>}
    </div>
  );
}
