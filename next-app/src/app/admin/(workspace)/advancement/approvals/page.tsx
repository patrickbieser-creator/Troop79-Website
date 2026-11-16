/**
 * /admin/advancement/approvals — proof submissions approved in the past two months (Patrick, 2026-11-15).
 *
 * Read-only. An approved submission leaves the Library's Proof Queue, so without this an approval looked like the
 * submission had vanished. Each row opens the full record (approvals/[id]). Loader: lib/proof-approvals.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadRecentApprovals } from '@/lib/proof-approvals';
import { fmtDate, fmtDateTime } from '@/lib/format-date';
import { PageTitle } from '../../_components/page-title';
import styles from './approvals.module.css';

export const metadata = {
  title: 'Approvals — Troop 79 Admin'
};

export default async function ApprovalsPage() {
  await requireCapability('advancement.write');
  const rows = await loadRecentApprovals(createAdminClient());

  return (
    <>
      <PageTitle
        back={null}
        title="Approvals"
        sub="Proof submissions from the Library approved in the past two months, newest first. Open one to see everything it holds."
      />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Approved</th>
              <th>Scout</th>
              <th>Requirement</th>
              <th>Approved by</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No approvals in the past two months.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={styles.rowLink}>
                  <td className={styles.nowrap}>{fmtDateTime(r.reviewedAt)}</td>
                  <td className={styles.nowrap}>
                    <Link href={`/admin/advancement/approvals/${r.id}`}>{r.scoutName}</Link>
                  </td>
                  <td>{r.requirement}</td>
                  <td className={styles.nowrap}>{r.reviewedBy ?? '—'}</td>
                  <td className={`${styles.nowrap} ${styles.muted}`}>{fmtDate(r.submittedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
