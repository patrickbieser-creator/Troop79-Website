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
import type { MeritBadge, MbProgressRow } from '@/lib/supabase/types';

interface CatalogCard {
  mb: MeritBadge;
  completed: number;
  partial: number;
  notStarted: number;
  hasProgress: boolean;
}

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
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 0' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 36,
            fontWeight: 700,
            color: 'var(--text-head)',
            letterSpacing: '-.01em',
            marginBottom: 6
          }}
        >
          Merit Badge Progress
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            color: 'var(--text-body)',
            lineHeight: 1.6,
            maxWidth: 760,
            marginBottom: 20
          }}
        >
          Live progress across every merit badge in the Troop 79 program — how many
          scouts have earned each one, how many are in the middle, requirement by
          requirement. Tap any badge to see the details.
        </p>
        <div style={{ height: 2, background: 'var(--border-mid)' }} />
      </div>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 60px' }}>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            color: 'var(--text-meta)',
            marginBottom: 18
          }}
        >
          {cards.length} {cards.length === 1 ? 'badge' : 'badges'} · {totalActive} active
          scouts
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 14
          }}
        >
          {cards.map((card) => (
            <CatalogCardEl key={card.mb.id} card={card} />
          ))}
        </div>
      </main>
    </>
  );
}

function CatalogCardEl({ card }: { card: CatalogCard }) {
  const { mb, completed, partial, notStarted, hasProgress } = card;
  return (
    <Link
      href={`/merit-badges/${mb.id}`}
      style={{
        background: 'var(--warm-white)',
        border: '1px solid var(--border-light)',
        borderLeft: hasProgress ? '4px solid var(--forest-light)' : '1px solid var(--border-light)',
        boxShadow: 'var(--shadow-card)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--navy)',
            lineHeight: 1.25
          }}
        >
          {mb.name}
        </div>
        {mb.eagle && <EagleTag />}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 14,
          paddingTop: 8,
          borderTop: '1px dashed var(--border-light)'
        }}
      >
        <Count label="Earned" n={completed} color="var(--forest)" />
        <Count label="In Progress" n={partial} color="var(--navy)" />
        <Count label="Not Started" n={notStarted} color="var(--border-mid)" />
      </div>
    </Link>
  );
}

function EagleTag() {
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--bark)',
        background: '#f6e7c4',
        padding: '2px 7px',
        borderRadius: 999,
        flexShrink: 0
      }}
    >
      Eagle
    </span>
  );
}

function Count({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', fontFamily: 'var(--font-ui)' }}>
      <strong
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1,
          color
        }}
      >
        {n}
      </strong>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--text-meta)',
          marginTop: 4
        }}
      >
        {label}
      </span>
    </div>
  );
}
