'use client';

/**
 * Shared pill tab strip with optional count badges (Phase A,
 * Plans/Admin-Design-System.md) — replaces the 4 byte-identical per-screen
 * copies found by the 2026-08-21 audit. Canonical rendering lives at
 * /admin/styleguide/admin.
 *
 * Dual-mode items, matching how the legacy copies were used: an item with
 * `href` renders a Link (articles' archive tabs — tab state lives in the
 * URL), otherwise a button firing `onSelect` (calendar/roster/roster-import
 * — tab state is client state). Exactly one item, matched by `activeKey`,
 * carries aria-selected and the active style; the legacy .tabOn/.tabActive
 * naming split is normalized away inside.
 */
import Link from 'next/link';
import styles from './tab-strip.module.css';

export interface TabStripItem {
  key: string;
  label: string;
  /** Renders the count pill only when provided. */
  count?: number;
  /** Link mode — tab state lives in the URL. */
  href?: string;
  /** Button mode — tab state is client state. Ignored when href is set. */
  onSelect?: () => void;
}

export function TabStrip({
  items,
  activeKey,
  ariaLabel,
  className
}: {
  items: TabStripItem[];
  activeKey: string;
  ariaLabel: string;
  /** Parent-supplied layout class (e.g. calendar's margin-right:auto). */
  className?: string;
}) {
  return (
    <div className={`${styles.tabs}${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey;
        const cls = `${styles.tab}${active ? ` ${styles.tabOn}` : ''}`;
        const inner = (
          <>
            {item.label}
            {item.count !== undefined && <span className={styles.tabCount}>{item.count}</span>}
          </>
        );
        return item.href ? (
          <Link key={item.key} href={item.href} role="tab" aria-selected={active} className={cls}>
            {inner}
          </Link>
        ) : (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={cls}
            onClick={item.onSelect}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
