/**
 * /admin/advancement/dashboard/logins — full Recent Logins history, "View
 * all" from the Leader Dashboard's Recent Logins card
 * (Plans/Recent-Logins-Dashboard.md). Paginated successful-login list, plus
 * a distinct Recent Failed Attempts section (Patrick, 2026-08-17: repeated
 * failures on one person is the actually security-relevant signal here —
 * kept out of the main list rather than mixed in as routine noise).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadAllLogins, loadRecentFailedLogins, type LoginMethod } from '@/lib/login-events';
import styles from '../dashboard.module.css';
import { PageTitle } from '../../../_components/page-title';
import { Button } from '../../../../_components/button';

import { fmtDateTime } from '@/lib/format-date';
const PAGE_SIZE = 50;

const METHOD_LABEL: Record<LoginMethod, string> = {
  link: 'Email link',
  code: 'Code',
  passkey: 'Passkey'
};

const fullDateTime = (iso: string): string => fmtDateTime(iso);

export const metadata = {
  title: 'Recent Logins — Troop 79'
};

export default async function AllLoginsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireCapability('advancement.write');
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = createAdminClient();
  const [{ events, total }, failed] = await Promise.all([
    loadAllLogins(supabase, { limit: PAGE_SIZE, offset }),
    loadRecentFailedLogins(supabase, 15)
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageTitle
        back={{ label: 'Dashboard', href: '/admin/advancement/dashboard' }}
        title="Recent Logins"
        sub="Every successful sign-in, family and leader alike — same flow since the identity unification."
      >
      </PageTitle>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3>
            Logins ({total} total{page > 1 || totalPages > 1 ? `, page ${page} of ${totalPages}` : ''})
          </h3>
        </div>
        {events.length === 0 ? (
          <div className={styles.empty}>No logins recorded yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Role</th>
                <th>Method</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className={styles.dateCell}>{fullDateTime(e.createdAt)}</td>
                  <td className={styles.scoutCell}>
                    {e.personName ?? 'Unknown'}
                    {e.isFirstLogin && <span className={styles.kindPill}>First login</span>}
                  </td>
                  <td>{e.roleSnapshot === 'leader' ? 'Leader' : 'Family'}</td>
                  <td>
                    <span className={styles.kindPill}>{METHOD_LABEL[e.method]}</span>
                  </td>
                  <td>{e.deviceLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div className={`${styles.actions} ${styles.actionsEnd}`}>
            {page > 1 && (
              <Button href={`/admin/advancement/dashboard/logins?page=${page - 1}`}>← Newer</Button>
            )}
            {page < totalPages && (
              <Button href={`/admin/advancement/dashboard/logins?page=${page + 1}`}>Older →</Button>
            )}
          </div>
        )}
      </div>

      <div className={`${styles.card} ${styles.cardSpaced}`}>
        <div className={styles.cardHeader}>
          <h3>Recent Failed Attempts</h3>
        </div>
        {failed.length === 0 ? (
          <div className={styles.empty}>No failed attempts recorded.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Method</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((e) => (
                <tr key={e.id}>
                  <td className={styles.dateCell}>{fullDateTime(e.createdAt)}</td>
                  <td className={styles.scoutCell}>{e.personName ?? 'Unresolved contact'}</td>
                  <td>
                    <span className={styles.kindPill}>{METHOD_LABEL[e.method]}</span>
                  </td>
                  <td>{e.failureReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
