'use client';

/**
 * Shared text tab strip with optional "(n)" counts (calm restyle R5; Phase A,
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
import type { MouseEvent } from 'react';
import Link from 'next/link';
import styles from './tab-strip.module.css';

export interface TabStripItem {
  key: string;
  label: string;
  /** Renders the count pill only when provided. */
  count?: number;
  /** The tab holds a field that needs fixing (2026-10-05): a red mark, so a failed save on another tab points here. */
  alert?: boolean;
  /** Link mode — tab state lives in the URL. */
  href?: string;
  /** Button mode — tab state is client state. Ignored when href is set. */
  onSelect?: () => void;
}

export function TabStrip({
  items,
  activeKey,
  ariaLabel,
  className,
  onNavigate
}: {
  items: TabStripItem[];
  activeKey: string;
  ariaLabel: string;
  /** Parent-supplied layout class (e.g. calendar's margin-right:auto). */
  className?: string;
  /**
   * Link mode only: a plain left click calls this instead of following the link (modifier clicks still open a new tab).
   * The section tabs use it to route through the dirty-form guard (useGuardedNav); the href stays a real link.
   */
  onNavigate?: (href: string) => void;
}) {
  return (
    <div className={`${styles.tabs}${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey;
        const cls = `${styles.tab}${active ? ` ${styles.tabOn}` : ''}`;
        const inner = (
          <>
            {item.label}
            {item.count !== undefined && <span className={styles.tabCount}> ({item.count})</span>}
            {item.alert && (
              <span className={styles.tabAlert} role="img" aria-label="needs fixing">
                !
              </span>
            )}
          </>
        );
        return item.href ? (
          <Link
            key={item.key}
            href={item.href}
            role="tab"
            aria-selected={active}
            className={cls}
            onClick={
              onNavigate
                ? (e: MouseEvent<HTMLAnchorElement>) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onNavigate(item.href!);
                  }
                : undefined
            }
          >
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
