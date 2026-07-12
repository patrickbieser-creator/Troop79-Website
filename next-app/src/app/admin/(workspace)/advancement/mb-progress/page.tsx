/**
 * /admin/advancement/mb-progress — Admin catalog of all merit badges with
 * per-badge progress counters. Same data the public /merit-badges page
 * shows, in admin chrome; cards link to the admin drill-in where leaders
 * can click cells to sign off.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { MeritBadge, MbProgressRow } from '@/lib/supabase/types';
import styles from './mb-progress.module.css';

export const metadata = {
  title: 'MB Progress — Troop 79 Admin'
};

interface CatalogCard {
  mb: MeritBadge;
  completed: number;
  partial: number;
  notStarted: number;
  hasProgress: boolean;
}

async function loadCatalog() {
  const supabase = createAdminClient();
  const [badgesRes, progress, activeCountRes] = await Promise.all([
    supabase.from('merit_badges').select('*').order('name'),
    // Unbounded past the ~1000-row PostgREST cap as more scouts start more
    // badges — paginate (lib/supabase/paginate.ts).
    fetchAllRows<MbProgressRow>((from, to) =>
      supabase.from('mb_progress').select('*').range(from, to)
    ),
    supabase.from('scouts').select('id', { count: 'exact', head: true }).eq('active', true)
  ]);
  const byMb = new Map<string, MbProgressRow[]>();
  for (const row of progress) {
    const list = byMb.get(row.mb_id) ?? [];
    list.push(row);
    byMb.set(row.mb_id, list);
  }
  const totalActive = activeCountRes.count ?? 0;
  const cards: CatalogCard[] = ((badgesRes.data ?? []) as MeritBadge[]).map((mb) => {
    const rows = byMb.get(mb.id) ?? [];
    const completed = rows.filter((r) => r.awarded).length;
    const partial = rows.length - completed;
    const notStarted = Math.max(totalActive - rows.length, 0);
    return { mb, completed, partial, notStarted, hasProgress: rows.length > 0 };
  });
  return { cards, totalActive };
}

export default async function MbProgressCatalogPage() {
  const { cards, totalActive } = await loadCatalog();
  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Merit Badge Progress</h1>
        <p>
          Live progress on every merit badge in the Troop 79 program. Click a
          card to drill in and sign off requirements per scout. Cards with a
          green stripe have at least one scout in progress.
        </p>
      </div>
      <div className={styles.meta}>
        {cards.length} badges · {totalActive} active scouts
      </div>
      <div className={styles.cardGrid}>
        {cards.map((card) => (
          <Link
            key={card.mb.id}
            href={`/admin/advancement/mb-progress/${card.mb.id}`}
            className={`${styles.card} ${card.hasProgress ? styles.cardHasProgress : ''}`}
          >
            <div className={styles.cardHeader}>
              <div className={styles.cardName}>{card.mb.name}</div>
              {card.mb.eagle && <span className={styles.eagleTag}>Eagle</span>}
            </div>
            <div className={styles.counts}>
              <span className={styles.count}>
                <span className={`${styles.countNum} ${styles.countNumEarned}`}>
                  {card.completed}
                </span>
                <span className={styles.countLabel}>Earned</span>
              </span>
              <span className={styles.count}>
                <span className={`${styles.countNum} ${styles.countNumPartial}`}>
                  {card.partial}
                </span>
                <span className={styles.countLabel}>In progress</span>
              </span>
              <span className={styles.count}>
                <span className={`${styles.countNum} ${styles.countNumNotStarted}`}>
                  {card.notStarted}
                </span>
                <span className={styles.countLabel}>Not started</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
