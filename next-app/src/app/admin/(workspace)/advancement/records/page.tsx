/**
 * /admin/advancement/records — Submit & Present.
 *
 * Every rank, merit badge, and special award actually earned (kind in
 * rank_award | merit_badge_award | award), most-recent-first, with two
 * independent human confirmations per row: submitted to Scoutbook, and
 * presented to the scout (a regular meeting or a Court of Honor — the troop
 * does both, so this isn't tied to any specific event record). Same
 * underlying ledger_entries rows and mutations as the Universal Ledger —
 * this is a filtered, purpose-built read of the same source of truth, not a
 * separate store.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import type { LedgerEntry, LedgerKind, Scout } from '@/lib/supabase/types';
import { RecordsTable } from './records-table';
import styles from './records.module.css';

export const metadata = {
  title: 'Submit & Present — Troop 79 Admin'
};

const PAGE_SIZE = 50;
const RECORD_KINDS: LedgerKind[] = ['rank_award', 'merit_badge_award', 'award'];

interface SearchParams {
  type?: string;
  outstanding?: string;
  page?: string;
}

interface RecordRow extends LedgerEntry {
  scoutName: string;
  awardLabel: string;
}

function parseSearch(sp: SearchParams) {
  const type = RECORD_KINDS.includes(sp.type as LedgerKind) ? (sp.type as LedgerKind) : '';
  const outstanding = sp.outstanding === '1';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  return { type, outstanding, page };
}

async function loadRecords(parsed: ReturnType<typeof parseSearch>) {
  const supabase = createAdminClient();

  const [scoutsRes, ranksRes, mbsRes] = await Promise.all([
    supabase.from('scouts').select('id, display_name').order('display_name'),
    supabase.from('ranks').select('id, display_name'),
    supabase.from('merit_badges').select('id, name')
  ]);
  const scoutList = (scoutsRes.data ?? []) as Pick<Scout, 'id' | 'display_name'>[];
  const scoutMap = new Map(scoutList.map((s) => [s.id, s.display_name]));
  const rankNameMap = new Map(
    ((ranksRes.data ?? []) as { id: string; display_name: string }[]).map((r) => [r.id, r.display_name])
  );
  const mbNameMap = new Map(
    ((mbsRes.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name])
  );

  let q = supabase.from('ledger_active').select('*', { count: 'exact' }).in('kind', RECORD_KINDS);
  if (parsed.type) q = q.eq('kind', parsed.type);
  if (parsed.outstanding) {
    q = q.or('scoutbook_submitted_at.is.null,presented_at.is.null');
  }
  q = q.order('date', { ascending: false }).order('entered_at', { ascending: false });

  const from = (parsed.page - 1) * PAGE_SIZE;
  q = q.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await q;
  if (error) return { rows: [] as RecordRow[], total: 0 };

  const rows: RecordRow[] = ((data ?? []) as LedgerEntry[]).map((r) => ({
    ...r,
    scoutName: scoutMap.get(r.scout_id) ?? r.scout_id,
    awardLabel: awardLabelFor(r, rankNameMap, mbNameMap)
  }));
  return { rows, total: count ?? 0 };
}

function awardLabelFor(
  row: LedgerEntry,
  rankNameMap: Map<string, string>,
  mbNameMap: Map<string, string>
): string {
  if (row.kind === 'rank_award') return rankNameMap.get(row.code) ?? row.code;
  if (row.kind === 'merit_badge_award') {
    const mbId = row.code.startsWith('MB:') ? row.code.slice(3) : row.code;
    return mbNameMap.get(mbId) ?? row.label ?? mbId;
  }
  return row.label ?? row.code;
}

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/advancement/records${qs ? `?${qs}` : ''}`;
}

export default async function RecordsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(['leader']);
  const raw = await searchParams;
  const parsed = parseSearch(raw);
  const { rows, total } = await loadRecords(parsed);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (parsed.page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(parsed.page * PAGE_SIZE, total);

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Submit &amp; Present</h1>
        <p>
          Every rank, merit badge, and special award earned — most recent first. Check off
          <strong> Submitted</strong> once the Scoutbook upload is confirmed, and
          <strong> Presented</strong> once the scout has actually received it at a meeting or Court of
          Honor. Archived and deleted rows are excluded.
        </p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.typeTabs} role="tablist" aria-label="Filter by type">
          {(
            [
              ['', 'All'],
              ['rank_award', 'Ranks'],
              ['merit_badge_award', 'Merit Badges'],
              ['award', 'Special Awards']
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={urlWith(raw, { type: value || undefined, page: undefined })}
              role="tab"
              aria-selected={parsed.type === value}
              className={`${styles.typeTab} ${parsed.type === value ? styles.typeTabActive : ''}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <Link
          href={urlWith(raw, { outstanding: parsed.outstanding ? undefined : '1', page: undefined })}
          className={`${styles.outstandingToggle} ${parsed.outstanding ? styles.outstandingToggleActive : ''}`}
        >
          {parsed.outstanding ? '✓ ' : ''}Only outstanding
        </Link>
      </div>

      <RecordsTable rows={rows} />

      <div className={styles.pager}>
        <Link
          href={urlWith(raw, { page: String(parsed.page - 1) })}
          className={`${styles.pagerBtn} ${parsed.page <= 1 ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={parsed.page <= 1}
        >
          ← Previous
        </Link>
        <Link
          href={urlWith(raw, { page: String(parsed.page + 1) })}
          className={`${styles.pagerBtn} ${parsed.page >= totalPages ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={parsed.page >= totalPages}
        >
          Next →
        </Link>
        <span>
          Showing {pageStart}–{pageEnd} of {total} · page {parsed.page} / {totalPages}
        </span>
      </div>
    </>
  );
}
