/**
 * /admin/reports — every report the leader can open, grouped by subject the same way as the rail's Reports menu, from
 * the feature registry (Plans/Completed/Admin-Portal-Nav.md decision 4): a report registered with kind 'report' appears here, in
 * the menu and on Home's shelf with nothing else to maintain. Each report still guards itself.
 */
import Link from 'next/link';
import { resolveAdminActor } from '@/lib/admin-actor';
import { PageTitle } from '../_components/page-title';
import { visibleFeaturesFor } from '../_components/nav-visibility';
import { areaMenu } from '../_components/area-menu';
import styles from './reports.module.css';

export const metadata = {
  title: 'Reports — Troop 79'
};

export default async function ReportsPage() {
  const actor = await resolveAdminActor();
  const menu = actor ? areaMenu(await visibleFeaturesFor(actor), 'reports', { wreathOpen: true }) : null;
  const columns = menu?.columns ?? [];
  return (
    <>
      <PageTitle back={null} title="Reports" sub="Every report you can open, by subject." />
      {columns.length === 0 ? (
        <p className={styles.empty}>No reports are open to you yet. Ask a troop admin for access.</p>
      ) : (
        <div className={styles.groups}>
          {columns.map((c) => (
            <section key={c.title} className={styles.group} aria-labelledby={`reports-${c.title}`}>
              <h2 id={`reports-${c.title}`} className={styles.heading}>
                {c.title}
              </h2>
              <ul className={styles.list}>
                {c.items.map((i) => (
                  <li key={i.key}>
                    <Link href={i.href} className={styles.item}>
                      <span className={styles.label}>{i.label}</span>
                      {i.description ? <span className={styles.desc}>{i.description}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
