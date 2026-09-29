/**
 * /admin/utilities — one-off maintenance tools that don't belong under a
 * specific domain section (Advancement, News & Events, etc.). New utilities
 * get their own card here rather than their own top-level nav entry.
 *
 * Each card shows only to the capability its tool requires (the tool's own
 * action is still the security boundary): Bunny sync is news.write, the
 * Ledger Audit finance.manage / finance.view.
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { BunnySyncCard } from './bunny-sync-card';
import { PageTitle } from '../_components/page-title';
import { Button } from '../../_components/button';
import styles from './utilities.module.css';

export const metadata = {
  title: 'Utilities — Troop 79'
};

export default async function UtilitiesPage() {
  const actor = await resolveAdminActor();
  const caps = actor?.capabilities ?? new Set();
  const canBunny = caps.has('news.write');
  const canAudit = caps.has('finance.manage') || caps.has('finance.view');

  return (
    <>
      <PageTitle back={null} title="Utilities" sub="One-off maintenance tools. Safe to run any time." />

      <div className={styles.grid}>
        {canBunny && <BunnySyncCard />}
        {canAudit && (
          <div className={styles.card}>
            <h3>Ledger Audit</h3>
            <p className={styles.cardSub}>
              Finds where the ledger and the Landmark accounts disagree: compare a bank CSV export row by row, and
              check the ledger for balancing adjustments, one-sided transfers, duplicates and misbooked rows.
              Read-only.
            </p>
            <Button variant="primary" href="/admin/utilities/ledger-audit">
              Open Ledger Audit
            </Button>
          </div>
        )}
        <div className={styles.card}>
          <div className={styles.cardSoon}>More utilities coming soon</div>
        </div>
      </div>
    </>
  );
}
