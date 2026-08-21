/**
 * Shared page header (Phase B, Plans/Admin-Design-System.md) — replaces the
 * per-screen .pageTitle blocks. Canonical rendering: /admin/styleguide.
 *
 *   <PageTitle title="Calendar" sub="Everything that happens on a date…">
 *     <AddButton …/>            // optional right-side actions
 *   </PageTitle>
 *
 * Server-component friendly: no 'use client' — pass client components as
 * children when the actions need interactivity.
 */
import styles from './page-title.module.css';

export function PageTitle({
  title,
  sub,
  children
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.pageTitle}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}
