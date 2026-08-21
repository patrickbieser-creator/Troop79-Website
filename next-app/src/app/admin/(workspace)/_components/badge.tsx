/**
 * Shared status badge (Phase A, Plans/Admin-Design-System.md) — the one
 * "small colored status label" for the whole Leader Workspace, replacing
 * the per-screen .badge / .statusPill / .pill / .tag copies. Canonical
 * rendering and the variant palette: /admin/styleguide.
 *
 * Scope rule: STATUS pills convert to this (Draft/Published/Active/
 * Inactive/Weak match/…); CATEGORICAL tags with their own meaning
 * (meeting-plan's Eagle/Adults-only, lookups' rank/MB source tags,
 * scoutbook-export's type tags) deliberately keep their per-screen
 * classes — mapping categories onto status colors would erase a real
 * distinction. library.module.css is shared with ~20 public routes and
 * is likewise untouched (D-160).
 *
 * Server-component friendly: no 'use client' — it renders a plain <span>.
 */
import styles from './badge.module.css';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export function Badge({
  variant = 'neutral',
  title,
  children
}: {
  variant?: BadgeVariant;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`} title={title}>
      {children}
    </span>
  );
}
