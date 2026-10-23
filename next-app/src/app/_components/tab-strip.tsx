/**
 * Shared public TabStrip — text tabs with optional "(n)" counts (calm
 * restyle R1, 2026-10-03; was a joined segmented row). API mirrors the admin
 * TabStrip (items / activeKey / ariaLabel; items take href OR onSelect),
 * implemented on the public tokens. Canonical rendering: /admin/styleguide/public.
 *
 * An item with BOTH href and onSelect is a real link (open in a new tab, copy the
 * address) whose plain click runs onSelect instead of navigating — Build a Plan's
 * bar switches its sub-views in place and keeps the URL itself (2026-10-22).
 */
'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import s from './tab-strip.module.css';

export type TabItem = {
  key: string;
  label: string;
  count?: number;
  href?: string;
  onSelect?: () => void;
};

/** A click the page may take over: the main button, no modifier (those open a new tab or window). */
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function TabStrip({
  items,
  activeKey,
  ariaLabel,
  scroll = false
}: {
  items: TabItem[];
  activeKey: string;
  ariaLabel: string;
  /** One line that scrolls sideways instead of wrapping (the Meeting Planner's six tabs on a phone). */
  scroll?: boolean;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={scroll ? `${s.strip} ${s.scroll}` : s.strip}>
      {items.map((item) => {
        const active = item.key === activeKey;
        const cls = active ? `${s.tab} ${s.active}` : s.tab;
        const count = item.count != null ? <span className={s.count}> ({item.count})</span> : null;
        if (item.href != null) {
          const onSelect = item.onSelect;
          return (
            <Link
              key={item.key}
              role="tab"
              aria-selected={active}
              href={item.href}
              className={cls}
              onClick={
                onSelect
                  ? (e) => {
                      if (!plainClick(e)) return;
                      e.preventDefault();
                      onSelect();
                    }
                  : undefined
              }
            >
              {item.label}
              {count}
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={cls}
            onClick={item.onSelect}
          >
            {item.label}
            {count}
          </button>
        );
      })}
    </div>
  );
}
