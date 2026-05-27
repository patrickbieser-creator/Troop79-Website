/**
 * /admin/advancement/ledger — Universal Ledger.
 *
 * Server Component. All filter/sort/page state lives in the URL so
 * everything is bookmarkable / sharable.
 *
 * Query params:
 *   q        — search text across code, label, by, scout_id
 *   kind     — filter by ledger_kind enum value
 *   hidden=1 — include archived + deleted rows (queries ledger_entries
 *              instead of the ledger_active view)
 *   sort     — column key (date|scout|kind|code|qty|enteredAt)
 *   dir      — asc|desc
 *   page     — 1-based page number (50 rows per page)
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { LedgerEntry, LedgerKind, Scout } from '@/lib/supabase/types';
import { LedgerToolbar } from './ledger-toolbar';
import { RowActions } from './row-actions';
import { InfoCell } from './info-cell';
import styles from './ledger.module.css';

const PAGE_SIZE = 50;

type SortKey = 'date' | 'scout' | 'kind' | 'code' | 'qty' | 'entered';

interface LedgerRow extends LedgerEntry {
  scoutName: string;
  shortLabel: string;
}

interface SearchParams {
  q?: string;
  kind?: string;
  hidden?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  rank_requirement: 'Rank req',
  rank_award: 'Rank award',
  merit_badge_requirement: 'MB req',
  merit_badge_award: 'MB award',
  attendance: 'Attendance',
  service_hours: 'Service',
  camping_nights: 'Camping',
  hiking_miles: 'Hiking',
  leadership: 'Leadership',
  award: 'Award'
};
const KIND_CLASS: Record<LedgerKind, string> = {
  rank_requirement: styles.kindRankReq,
  rank_award: styles.kindRankReq,
  merit_badge_requirement: styles.kindMbReq,
  merit_badge_award: styles.kindMbAward,
  attendance: styles.kindAttendance,
  service_hours: styles.kindService,
  camping_nights: styles.kindCamping,
  hiking_miles: styles.kindHiking,
  leadership: styles.kindLeadership,
  award: styles.kindMbAward
};

const SORT_TO_COLUMN: Record<SortKey, string> = {
  date: 'date',
  scout: 'scout_id',
  kind: 'kind',
  code: 'code',
  qty: 'qty',
  entered: 'entered_at'
};

function parseSearch(sp: SearchParams) {
  const sortRaw = (sp.sort ?? 'date') as SortKey;
  const sort: SortKey = (Object.keys(SORT_TO_COLUMN) as SortKey[]).includes(sortRaw)
    ? sortRaw
    : 'date';
  const dir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  return {
    q: (sp.q ?? '').trim(),
    kind: (sp.kind ?? '').trim() as LedgerKind | '',
    hidden: sp.hidden === '1',
    sort,
    dir,
    page
  };
}

async function loadLedger(parsed: ReturnType<typeof parseSearch>) {
  const supabase = await createClient();

  // Fetch reference catalogs once: scouts (for name + name-search), rank
  // requirements (for the short-label lookup matching the Clipboard), ranks
  // (for BoR rank-award labels), merit badges (for MB award labels), and
  // leaders (for the Edit dialog's signoff dropdown).
  const [scoutsRes, rankReqsRes, ranksRes, mbsRes, leadersRes] = await Promise.all([
    supabase.from('scouts').select('id, display_name').order('display_name'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label')
      .is('parent_id', null),
    supabase.from('ranks').select('id, display_name'),
    supabase.from('merit_badges').select('id, name'),
    supabase.from('leaders').select('code, name').order('code')
  ]);
  const leaderList = (leadersRes.data ?? []) as { code: string; name: string }[];
  const scoutList = (scoutsRes.data ?? []) as Pick<Scout, 'id' | 'display_name'>[];
  const scoutMap = new Map<string, string>();
  for (const s of scoutList) scoutMap.set(s.id, s.display_name);
  const rankReqMap = new Map<string, string>(); // `${rank_id}-${code}` → short label
  for (const r of (rankReqsRes.data ?? []) as Array<{ rank_id: string; code: string; label: string }>) {
    rankReqMap.set(`${r.rank_id}-${r.code}`, r.label);
  }
  const rankNameMap = new Map<string, string>();
  for (const r of (ranksRes.data ?? []) as Array<{ id: string; display_name: string }>) {
    rankNameMap.set(r.id, r.display_name);
  }
  const mbNameMap = new Map<string, string>();
  for (const m of (mbsRes.data ?? []) as Array<{ id: string; name: string }>) {
    mbNameMap.set(m.id, m.name);
  }

  // ledger_entries.scout_id holds slug-style IDs (A01, B07, …), not names.
  // For free-text search to match "maya" → A01 we first resolve which scouts
  // match the query, then OR their IDs into the ledger filter alongside the
  // text-column matches.
  const matchingScoutIds = parsed.q
    ? scoutList
        .filter((s) => s.display_name.toLowerCase().includes(parsed.q.toLowerCase()))
        .map((s) => s.id)
    : [];

  const source = parsed.hidden ? 'ledger_entries' : 'ledger_active';
  let q = supabase.from(source).select('*', { count: 'exact' });
  if (parsed.kind) q = q.eq('kind', parsed.kind);
  if (parsed.q) {
    const pat = `%${parsed.q}%`;
    const orParts = [
      `code.ilike.${pat}`,
      `label.ilike.${pat}`,
      `by.ilike.${pat}`,
      `scout_id.ilike.${pat}`
    ];
    if (matchingScoutIds.length > 0) {
      orParts.push(`scout_id.in.(${matchingScoutIds.join(',')})`);
    }
    q = q.or(orParts.join(','));
  }
  q = q.order(SORT_TO_COLUMN[parsed.sort], { ascending: parsed.dir === 'asc' });

  const from = (parsed.page - 1) * PAGE_SIZE;
  q = q.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await q;
  if (error)
    return {
      rows: [] as LedgerRow[],
      total: 0,
      scouts: scoutList,
      leaders: leaderList
    };

  const rows: LedgerRow[] = ((data ?? []) as LedgerEntry[]).map((r) => ({
    ...r,
    scoutName: scoutMap.get(r.scout_id) ?? r.scout_id,
    shortLabel: shortLabelFor(r, rankReqMap, rankNameMap, mbNameMap)
  }));
  return {
    rows,
    total: count ?? 0,
    scouts: scoutList,
    leaders: leaderList
  };
}

function shortLabelFor(
  row: LedgerEntry,
  rankReqMap: Map<string, string>,
  rankNameMap: Map<string, string>,
  mbNameMap: Map<string, string>
): string {
  switch (row.kind) {
    case 'rank_requirement': {
      // Code shape: `<rank_id>-<reqCode>` (e.g. "tenderfoot-2c").
      const short = rankReqMap.get(row.code);
      if (short) return short;
      return row.label ?? row.code;
    }
    case 'rank_award': {
      // Code is the rank slug. The catalog's BoR row holds the short label.
      const short = rankReqMap.get(`${row.code}-BoR`);
      if (short) return short;
      const rankName = rankNameMap.get(row.code) ?? row.code;
      return `Board of Review - ${rankName}`;
    }
    case 'merit_badge_award': {
      // Code shape: `MB:<mb_id>`.
      const colon = row.code.indexOf(':');
      const mbId = colon >= 0 ? row.code.slice(colon + 1) : row.code;
      return mbNameMap.get(mbId) ?? row.label ?? row.code;
    }
    default:
      // Activities, service, leadership, awards — labels are already concise.
      return row.label ?? row.code;
  }
}

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/advancement/ledger${qs ? `?${qs}` : ''}`;
}

export default async function LedgerPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = parseSearch(raw);
  const { rows, total, scouts, leaders } = await loadLedger(parsed);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (parsed.page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(parsed.page * PAGE_SIZE, total);

  const sortLink = (key: SortKey, label: string) => {
    const isActive = parsed.sort === key;
    const nextDir = isActive && parsed.dir === 'desc' ? 'asc' : 'desc';
    const cls = isActive
      ? parsed.dir === 'asc'
        ? styles.sortAsc
        : styles.sortDesc
      : '';
    return (
      <th key={key} className={cls}>
        <Link href={urlWith(raw, { sort: key, dir: nextDir, page: '1' })}>
          {label}
        </Link>
      </th>
    );
  };

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Universal Ledger</h1>
          <p>
            Sole source of truth. Every advancement, attendance, service hour,
            and recognition starts here. <strong>Archive</strong> hides
            lifecycle entries (e.g. scout aged-out). <strong>Delete</strong>{' '}
            removes erroneous entries with a recorded reason. Both are
            soft &mdash; recoverable from the &ldquo;Show hidden rows&rdquo;
            toggle.
          </p>
        </div>
      </div>

      <LedgerToolbar
        q={parsed.q}
        kind={parsed.kind}
        hidden={parsed.hidden}
        sort={parsed.sort}
        dir={parsed.dir}
      />

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {sortLink('date', 'Date')}
              {sortLink('scout', 'Scout')}
              {sortLink('kind', 'Type')}
              {sortLink('code', 'Code')}
              <th>Description</th>
              <th>Signed Off</th>
              {sortLink('qty', 'Qty')}
              <th>Unit</th>
              {sortLink('entered', 'Entered')}
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className={styles.empty}>
                  {parsed.q || parsed.kind
                    ? 'No rows match the current filters.'
                    : 'No ledger entries yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isArchived = !!r.archived_at;
                const isDeleted = !!r.deleted_at;
                const rowCls = isDeleted
                  ? styles.deletedRow
                  : isArchived
                    ? styles.archivedRow
                    : '';
                const hiddenNote = isDeleted
                  ? `deleted: ${r.deleted_reason ?? ''}`
                  : isArchived
                    ? `archived: ${r.archived_reason ?? ''}`
                    : null;
                return (
                  <tr key={r.id} className={rowCls}>
                    <td className={styles.nowrap}>{r.date ?? '—'}</td>
                    <td className={styles.nowrap}>{r.scoutName}</td>
                    <td className={styles.nowrap}>
                      <span className={`${styles.kindPill} ${KIND_CLASS[r.kind]}`}>
                        {KIND_LABEL[r.kind]}
                      </span>
                    </td>
                    <td className={`${styles.codeCell} ${styles.nowrap}`}>{r.code}</td>
                    <td>
                      <InfoCell short={r.shortLabel} full={r.label} notes={hiddenNote} />
                    </td>
                    <td className={styles.nowrap}>{r.by ?? ''}</td>
                    <td className={styles.numCell}>{r.qty}</td>
                    <td className={styles.nowrap}>{r.unit}</td>
                    <td className={styles.nowrap}>
                      {r.entered_at ? r.entered_at.slice(0, 10) : ''}
                    </td>
                    <td className={styles.actionsCell}>
                      <RowActions
                        row={r}
                        scouts={scouts}
                        leaders={leaders}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
