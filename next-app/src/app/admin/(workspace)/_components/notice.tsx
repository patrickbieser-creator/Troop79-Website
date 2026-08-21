/**
 * Shared inline notice (Phase B, Plans/Admin-Design-System.md) — the one
 * error/success/info box, replacing the per-screen .rowError / .editError /
 * .fieldError / .notice copies. Canonical rendering: /admin/styleguide.
 *
 * Defaults to the error variant because ~90% of the legacy call sites were
 * error boxes. `role` comes with it: errors announce as alerts, everything
 * else as polite status — the legacy divs had no semantics at all.
 *
 * Server-component friendly: no 'use client' — it renders a plain <div>.
 */
import styles from './notice.module.css';

export type NoticeVariant = 'error' | 'success' | 'warning' | 'info';

export function Notice({
  variant = 'error',
  className,
  children
}: {
  variant?: NoticeVariant;
  /** Layout-only adjustments from the call site (a margin override); colors
   *  and box chrome always come from the variant. */
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `${styles.notice} ${styles[variant]}${className ? ` ${className}` : ''}`;
  return (
    <div className={cls} role={variant === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
