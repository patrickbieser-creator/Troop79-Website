/**
 * Shared public TabStrip — segmented joined tabs with optional counts.
 * API mirrors the admin TabStrip (items / activeKey / ariaLabel; items take
 * href OR onSelect), implemented on the public tokens with the report
 * screen's joined-rectangle look rather than admin's pills. Canonical
 * rendering: /admin/styleguide/public.
 */
'use client';

import Link from 'next/link';
import s from './tab-strip.module.css';

export type TabItem = {
  key: string;
  label: string;
  count?: number;
  href?: string;
  onSelect?: () => void;
};

export function TabStrip({
  items,
  activeKey,
  ariaLabel
}: {
  items: TabItem[];
  activeKey: string;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={s.strip}>
      {items.map((item) => {
        const active = item.key === activeKey;
        const cls = active ? `${s.tab} ${s.active}` : s.tab;
        const count = item.count != null ? <span className={s.count}>{item.count}</span> : null;
        if (item.href != null) {
          return (
            <Link
              key={item.key}
              role="tab"
              aria-selected={active}
              href={item.href}
              className={cls}
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
