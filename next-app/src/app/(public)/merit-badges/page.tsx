/**
 * /merit-badges — Public catalog of all 32 merit badges with current
 * troop-wide progress per badge (completed / in-progress / not-started).
 *
 * Server Component: data is fetched at request time directly from Supabase,
 * no client-side waterfall. RLS allows anonymous reads on the relevant
 * tables (see the initial schema migration).
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import card from '@/app/_components/card.module.css';
import type { MeritBadge, MbProgressRow } from '@/lib/supabase/types';
import s from './merit-badges.module.css';

interface CatalogCard {
  mb: MeritBadge;
  completed: number;
  partial: number;
  notStarted: number;
  hasProgress: boolean;
}

// No Dynamic API (cookies/headers/searchParams) is used here, so Next
// silently prerendered this page as static HTML at build time despite the
// file's own "fetched at request time" intent — it can't reflect a database
// change (like tonight's mb_progress fix) until the next deploy rebuilds it.
// Force it dynamic so "live progress" is actually live.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Merit Badge Progress — Scout Troop 79',
  description:
    'Live progress on every merit badge in the Troop 79 program — earned, in progress, and not yet started.'
};

async function loadCatalog(): Promise<{ cards: CatalogCard[]; totalActive: number }> {
  const supabase = createAdminClient();
  const [{ data: badges }, progress, { count: totalActive }] = await Promise.all([
    supabase.from('merit_badges').select('*').order('name'),
    // Unbounded past the ~1000-row PostgREST cap as more scouts start more
    // badges — paginate (lib/supabase/paginate.ts).
    fetchAllRows<MbProgressRow>((from, to) =>
      supabase.from('mb_progress').select('*').range(from, to)
    ),
    supabase
      .from('scouts')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
  ]);

  const byMb = new Map<string, MbProgressRow[]>();
  for (const row of progress) {
    const list = byMb.get(row.mb_id) ?? [];
    list.push(row);
    byMb.set(row.mb_id, list);
  }

  const cards: CatalogCard[] = ((badges ?? []) as MeritBadge[]).map((mb) => {
    const rows = byMb.get(mb.id) ?? [];
    const completed = rows.filter((r) => r.awarded).length;
    const partial = rows.length - completed;
    const notStarted = Math.max((totalActive ?? 0) - rows.length, 0);
    return { mb, completed, partial, notStarted, hasProgress: rows.length > 0 };
  });

  return { cards, totalActive: totalActive ?? 0 };
}

export default async function MeritBadgesCatalogPage() {
  const { cards, totalActive } = await loadCatalog();

  return (
    <>
      <PageHeader
        title="Merit Badge Progress"
        lede="Live progress across every merit badge in the Troop 79 program — how many scouts have earned each one, how many are in the middle, requirement by requirement. Tap any badge to see the details."
      />

      <PageShell>
        <p className={s.countLine}>
          {cards.length} {cards.length === 1 ? 'badge' : 'badges'} · {totalActive} active
          scouts
        </p>

        <div className={s.catalogGrid}>
          {cards.map((c) => (
            <CatalogCardEl key={c.mb.id} card={c} />
          ))}
        </div>
      </PageShell>
    </>
  );
}

function CatalogCardEl({ card: c }: { card: CatalogCard }) {
  const { mb, completed, partial, notStarted, hasProgress } = c;
  const cls = [card.card, card.cardHover, s.catalogCard, hasProgress ? s.catalogCardStarted : null]
    .filter(Boolean)
    .join(' ');
  return (
    <Link href={`/merit-badges/${mb.id}`} className={cls}>
      <div className={s.catalogCardHead}>
        <div className={s.catalogCardName}>{mb.name}</div>
        {mb.eagle && <span className={s.eagleTag}>Eagle</span>}
      </div>
      <div className={s.countRow}>
        <Count label="Earned" n={completed} tone={s.countEarned} />
        <Count label="In Progress" n={partial} tone={s.countPartial} />
        <Count label="Not Started" n={notStarted} tone={s.countNot} />
      </div>
    </Link>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className={s.count}>
      <strong className={`${s.countNum} ${tone}`}>{n}</strong>
      <span className={s.countLabel}>{label}</span>
    </div>
  );
}
