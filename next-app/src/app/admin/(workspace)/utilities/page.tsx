/**
 * /admin/utilities — one-off maintenance tools that don't belong under a
 * specific domain section (Advancement, News & Events, etc.). New utilities
 * get their own card here rather than their own top-level nav entry.
 */
import { BunnySyncCard } from './bunny-sync-card';
import { PageTitle } from '../_components/page-title';
import styles from './utilities.module.css';

export const metadata = {
  title: 'Utilities — Troop 79'
};

export default function UtilitiesPage() {
  return (
    <>
      <PageTitle title="Utilities" sub="One-off maintenance tools. Safe to run any time." />

      <div className={styles.grid}>
        <BunnySyncCard />
        <div className={styles.card}>
          <div className={styles.cardSoon}>More utilities coming soon</div>
        </div>
      </div>
    </>
  );
}
