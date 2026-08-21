'use client';

/**
 * Shared green "+ Add X" button (Phase A, Plans/Admin-Design-System.md) —
 * the D-159 standard: the primary Add action is always visible, far right
 * of any tab strip, never buried in Actions ▾. Replaces the 4 byte-identical
 * per-screen .addBtn copies. Canonical rendering: /admin/styleguide/admin.
 *
 * Dual-mode like the legacy usages: `href` renders a Link (articles' "+ Add
 * News" navigates to the editor), otherwise a button firing `onClick`
 * (calendar/albums open an add dialog in place).
 */
import Link from 'next/link';
import styles from './add-button.module.css';

export function AddButton({
  href,
  onClick,
  disabled,
  children
}: {
  href?: string;
  onClick?: () => void;
  /** Button mode only — a Link has no disabled state. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return href ? (
    <Link href={href} className={styles.addBtn}>
      {children}
    </Link>
  ) : (
    <button type="button" className={styles.addBtn} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
