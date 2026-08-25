/**
 * Shared page header (Phase B, Plans/Admin-Design-System.md) — replaces the
 * per-screen .pageTitle blocks. Canonical rendering: /admin/styleguide/admin.
 *
 *   <PageTitle back={null} title="Calendar" sub="Everything that happens on a date…">
 *     <AddButton …/>            // optional right-side actions
 *   </PageTitle>
 *
 * `back` is REQUIRED (Patrick, 2026-08-25): the way back lives in one fixed
 * slot above the h1 on every screen, so a page has to say what it is —
 *   back={null}                              a list / root (remembers its URL for children)
 *   back={{ label: 'News', href: '/admin/news/articles' }}         depth 2 → "← Back to News"
 *   back={{ crumbs: [{…}, {…}], current: 'Money' }}                 depth ≥3 → breadcrumbs
 * Never put a back link in `children` or `sub` again — BackNav is the slot.
 *
 * Server-component friendly: no 'use client' — pass client components as
 * children when the actions need interactivity.
 */
import { Suspense } from 'react';
import { BackNav, type BackTarget } from './back-nav';
import { RememberList } from './remember-list';
import styles from './page-title.module.css';

export type { BackTarget, Crumb } from './back-nav';

export function PageTitle({
  back,
  title,
  sub,
  children
}: {
  back: BackTarget | null;
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.pageTitle}>
      <div className={styles.text}>
        {back ? (
          <BackNav back={back} current={typeof title === 'string' ? title : undefined} />
        ) : (
          <Suspense fallback={null}>
            <RememberList />
          </Suspense>
        )}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}
