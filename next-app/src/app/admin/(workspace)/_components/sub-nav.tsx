'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IS_DEV_DB } from '@/lib/dev-db';
import type { Capability } from '@/lib/capabilities';
import { SECTIONS, visibleNavSections, activeMatchPathFor, railSections } from './nav-data';
import styles from '../admin.module.css';

// The nav data and its pure helpers live in ./nav-data (a plain module, so server components can read them).
// This file is only the rail's rendering.

export function SubNav({
  fullAdmin,
  capabilities
}: {
  fullAdmin: boolean;
  capabilities: Capability[];
}) {
  const pathname = usePathname();
  const visibleSections = railSections(
    visibleNavSections(SECTIONS, {
      fullAdmin,
      capabilities: new Set(capabilities)
    })
  );

  const activeMatchPath = activeMatchPathFor(visibleSections, pathname);

  return (
    <nav
      className={`${styles.subNav} ${IS_DEV_DB ? styles.subNavDevDb : ''}`}
      aria-label="Leader Workspace navigation"
    >
      {visibleSections.map((section) => (
        <div key={section.title} className={styles.subNavGroup}>
          <div className={styles.subNavSection}>{section.title}</div>
          {section.items.map((item) =>
            item.disabled ? (
              <button
                key={item.label}
                type="button"
                className={`${styles.subNavBtn} ${styles.subNavBtnDisabled}`}
                disabled
              >
                {item.label}
                <span className={styles.soonTag}>Soon</span>
              </button>
            ) : (
              <Link
                key={item.label}
                href={item.href!}
                className={`${styles.subNavBtn} ${item.matchPath === activeMatchPath ? styles.subNavBtnActive : ''}`}
              >
                {item.label}
              </Link>
            )
          )}
        </div>
      ))}
    </nav>
  );
}
