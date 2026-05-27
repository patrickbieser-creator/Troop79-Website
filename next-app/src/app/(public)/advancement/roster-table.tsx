'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import styles from './advancement.module.css';

export interface RosterRow {
  id: string;
  displayName: string;
  patrol: string | null;
  currentRank: string | null;
  currentRankLabel: string;
  mbCount: number;
  eagleMbCount: number;
  campingNights: number;
  serviceHours: number;
  lastActivity: string | null;
  rankSortIndex: number;
}

const RANK_CLASS: Record<string, string> = {
  scout: styles.rankScout,
  tenderfoot: styles.rankTenderfoot,
  'second-class': styles.rankSecondClass,
  'first-class': styles.rankFirstClass,
  star: styles.rankStar,
  life: styles.rankLife,
  eagle: styles.rankEagle
};

type SortKey = 'name' | 'rank' | 'mb' | 'nights' | 'service';
type SortDir = 'asc' | 'desc';

const COL_DEFS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Scout' },
  { key: 'rank', label: 'Current Rank' },
  { key: 'mb', label: 'Merit Badges', num: true },
  { key: 'nights', label: 'Nights', num: true },
  { key: 'service', label: 'Svc Hrs', num: true }
];

interface Props {
  rows: RosterRow[];
  rankOptions: { id: string; label: string }[];
  patrols: string[];
}

export function RosterTable({ rows, rankOptions, patrols }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [rankFilter, setRankFilter] = useState('');
  const [patrolFilter, setPatrolFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filteredSorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (rankFilter && r.currentRank !== rankFilter) return false;
      if (patrolFilter && r.patrol !== patrolFilter) return false;
      if (f) {
        const hay = `${r.displayName} ${r.patrol ?? ''}`.toLowerCase();
        if (!hay.includes(f)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case 'name':
          va = a.displayName.toLowerCase();
          vb = b.displayName.toLowerCase();
          break;
        case 'rank':
          va = a.rankSortIndex;
          vb = b.rankSortIndex;
          break;
        case 'mb':
          va = a.mbCount;
          vb = b.mbCount;
          break;
        case 'nights':
          va = a.campingNights;
          vb = b.campingNights;
          break;
        case 'service':
          va = a.serviceHours;
          vb = b.serviceHours;
          break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rows, filter, rankFilter, patrolFilter, sortKey, sortDir]);

  const onSortClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const onRowClick = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).tagName === 'A') return;
    router.push(`/scouts/${id}`);
  };

  const meta =
    filteredSorted.length === rows.length
      ? `${rows.length} ${rows.length === 1 ? 'scout' : 'scouts'}`
      : `${filteredSorted.length} of ${rows.length} scouts`;

  return (
    <>
      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Filter by name or patrol…"
          aria-label="Filter scouts"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="Filter by rank"
          value={rankFilter}
          onChange={(e) => setRankFilter(e.target.value)}
        >
          <option value="">All ranks</option>
          {rankOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by patrol"
          value={patrolFilter}
          onChange={(e) => setPatrolFilter(e.target.value)}
        >
          <option value="">All patrols</option>
          {patrols.map((p) => (
            <option key={p} value={p}>
              {p} Patrol
            </option>
          ))}
        </select>
        <span className={styles.toolbarSpacer} />
        <span className={styles.toolbarMeta}>{meta}</span>
      </div>

      <div className={styles.rosterWrap}>
        <table className={styles.roster}>
          <thead>
            <tr>
              {COL_DEFS.map((c) => {
                const isSorted = sortKey === c.key;
                const sortCls = isSorted
                  ? sortDir === 'asc'
                    ? styles.sortAsc
                    : styles.sortDesc
                  : '';
                return (
                  <th
                    key={c.key}
                    className={`${c.num ? styles.numCell : ''} ${sortCls}`.trim()}
                    onClick={() => onSortClick(c.key)}
                  >
                    {c.label}
                  </th>
                );
              })}
              <th>Last Activity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={7}>No scouts match the current filters.</td>
              </tr>
            ) : (
              filteredSorted.map((r) => (
                <tr key={r.id} onClick={(e) => onRowClick(e, r.id)}>
                  <td>
                    <div className={styles.scoutName}>
                      <Link href={`/scouts/${r.id}`}>{r.displayName}</Link>
                    </div>
                    <div className={styles.scoutPatrol}>
                      {r.patrol ? `${r.patrol} Patrol` : ''}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`${styles.rankPill} ${r.currentRank ? RANK_CLASS[r.currentRank] ?? '' : ''}`}
                    >
                      {r.currentRankLabel}
                    </span>
                  </td>
                  <td className={styles.numCell}>
                    {r.mbCount}
                    {r.eagleMbCount > 0 && (
                      <span style={{ color: 'var(--text-meta)', fontSize: 11 }}>
                        {' '}
                        ({r.eagleMbCount}&#9733;)
                      </span>
                    )}
                  </td>
                  <td className={styles.numCell}>{r.campingNights}</td>
                  <td className={styles.numCell}>{r.serviceHours}</td>
                  <td className={styles.lastActivity}>{r.lastActivity ?? '—'}</td>
                  <td>
                    <Link href={`/scouts/${r.id}`} className={styles.drillLink}>
                      View Clipboard &rarr;
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
