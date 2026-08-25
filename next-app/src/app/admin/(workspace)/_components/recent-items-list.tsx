import type { ReactNode } from 'react';
import styles from './recent-items-list.module.css';

/**
 * RecentItemsList — the "Recent reports" / "Recent ceremonies" sidebar list
 * (Data Tables consolidation, Wave 1, 2026-08-25). Extracted from the two
 * byte-identical `.reportList` copies in report.module.css and
 * court-of-honor.module.css. Each item is a clickable card on the card canon
 * (Patrick, 2026-08-21: "it used to be a button, now it's just text
 * floating"); the active item gets the navy border + bold and aria-current.
 */
export type RecentItem = {
  key: string | number;
  href: string;
  label: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
};

export function RecentItemsList({
  items,
  activeKey,
  ariaLabel
}: {
  items: RecentItem[];
  activeKey?: string | number | null;
  ariaLabel: string;
}) {
  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <li key={String(item.key)}>
            <a
              href={item.href}
              className={active ? styles.linkActive : styles.link}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.label}>{item.label}</span>
              {item.meta !== undefined && <span className={styles.meta}>{item.meta}</span>}
              {item.badge}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
