/**
 * Shared public Notice — error/success/warning/info box on the status
 * tokens. Mirrors the admin Notice's API and a11y contract: tone="error"
 * renders role="alert", everything else role="status". Canonical rendering:
 * /admin/styleguide/public.
 */
import type { ReactNode, Ref } from 'react';
import s from './notice.module.css';

export type NoticeTone = 'error' | 'success' | 'warning' | 'info';

export function Notice({
  tone,
  className,
  children,
  role,
  tabIndex,
  ref
}: {
  tone: NoticeTone;
  className?: string;
  children: ReactNode;
  /** Override the tone's default role — a warning that must interrupt (a blocked action) is an alert. */
  role?: 'alert' | 'status';
  /** -1 lets a script move focus to the notice. */
  tabIndex?: number;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      tabIndex={tabIndex}
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
      className={[s.notice, s[tone], className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
