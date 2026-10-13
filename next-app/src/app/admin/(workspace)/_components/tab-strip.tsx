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
 *
 * An `inactive` item (Patrick, 2026-10-13, calendar workbench) is a feature the
 * current record doesn't use: it stays in the bar, muted, so the leader learns
 * it exists — greyed, not hidden. It is aria-disabled (NOT `disabled`, so
 * keyboard and screen-reader users can still land on it), titled, and a click
 * or Enter shows a small "Not active for this event" note anchored to the tab
 * instead of navigating. The note goes away on Escape, an outside click, blur,
 * scroll, or after a few seconds (all document-level, none of it depends on
 * blur, which Safari never fires for a clicked button). `scroll` keeps a long bar on one line and
 * scrolls it sideways (phones) instead of wrapping.
 */
import { useEffect, useId, useState, type MouseEvent } from 'react';
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
  /** Greyed out: the record doesn't use this feature. Never selects or navigates; explains itself on click. */
  inactive?: boolean;
  /** What the inactive tab says when clicked. Defaults to "Not active for this event". */
  inactiveReason?: string;
}

export const DEFAULT_INACTIVE_REASON = 'Not active for this event';
const REASON_MS = 4000;

/** Where the reason note sits: just under the clicked tab, kept on screen. */
interface Note {
  key: string;
  text: string;
  top: number;
  left: number;
}

export function TabStrip({
  items,
  activeKey,
  ariaLabel,
  className,
  onNavigate,
  scroll = false
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
  /** Long bars: stay on one line and scroll sideways rather than wrap. */
  scroll?: boolean;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const noteId = useId();

  useEffect(() => {
    if (!note) return;
    const close = () => setNote(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-inactive-tab]')) close();
    };
    const timer = window.setTimeout(close, REASON_MS);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', close, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', close, true);
    };
  }, [note]);

  return (
    <div
      className={`${styles.tabs}${scroll ? ` ${styles.tabsScroll}` : ''}${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={ariaLabel}
    >
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
        if (item.inactive) {
          const reason = item.inactiveReason ?? DEFAULT_INACTIVE_REASON;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={false}
              aria-disabled="true"
              aria-describedby={note?.key === item.key ? noteId : undefined}
              data-inactive-tab=""
              title={reason}
              className={`${styles.tab} ${styles.tabInactive}`}
              onBlur={() => setNote((n) => (n?.key === item.key ? null : n))}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setNote({
                  key: item.key,
                  text: reason,
                  top: r.bottom + 6,
                  left: Math.max(8, Math.min(r.left, window.innerWidth - 200))
                });
              }}
            >
              {inner}
            </button>
          );
        }
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
      {/* A polite live region that is always mounted, so the reason is announced when it appears. */}
      <span id={noteId} role="status" aria-live="polite">
        {note && (
          <span
            className={styles.note}
            // dynamic: fixed-position under the clicked tab, so a scrolling bar can't clip it
            ref={(el) => {
              if (el) {
                el.style.top = `${note.top}px`;
                el.style.left = `${note.left}px`;
              }
            }}
          >
            {note.text}
          </span>
        )}
      </span>
    </div>
  );
}
