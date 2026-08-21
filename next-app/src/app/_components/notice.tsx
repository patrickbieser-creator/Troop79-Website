/**
 * Shared public Notice — error/success/warning/info box on the status
 * tokens. Mirrors the admin Notice's API and a11y contract: tone="error"
 * renders role="alert", everything else role="status". Canonical rendering:
 * /admin/styleguide/public.
 */
import type { ReactNode } from 'react';
import s from './notice.module.css';

export type NoticeTone = 'error' | 'success' | 'warning' | 'info';

export function Notice({
  tone,
  className,
  children
}: {
  tone: NoticeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={[s.notice, s[tone], className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
