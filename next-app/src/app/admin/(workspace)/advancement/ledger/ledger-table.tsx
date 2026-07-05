'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LedgerEntry, LedgerKind } from '@/lib/supabase/types';
import { RowActions } from './row-actions';
import { InfoCell } from './info-cell';
import { BulkEditModal } from './bulk-edit-modal';
import { bulkArchiveLedgerEntries, bulkDeleteLedgerEntries } from './actions';
import styles from './ledger.module.css';

type SortKey = 'date' | 'scout' | 'kind' | 'code' | 'qty' | 'entered';

interface SearchParams {
  q?: string;
  kind?: string;
  hidden?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export interface LedgerRowVM extends LedgerEntry {
  scoutName: string;
  shortLabel: string;
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

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/advancement/ledger${qs ? `?${qs}` : ''}`;
}

interface Props {
  rows: LedgerRowVM[];
  scouts: { id: string; display_name: string }[];
  leaders: { code: string; name: string }[];
  sp: SearchParams;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

export function LedgerTable({ rows, scouts, leaders, sp, sort, dir }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Only active (non-archived, non-deleted) rows are selectable for bulk ops.
  const activeIds = rows
    .filter((r) => !r.archived_at && !r.deleted_at)
    .map((r) => r.id);
  const allActiveSelected =
    activeIds.length > 0 && activeIds.every((id) => selected.has(id));
  const selectedRows = rows.filter((r) => selected.has(r.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (activeIds.every((id) => prev.has(id))) return new Set();
      return new Set(activeIds);
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function onBulkArchive() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const reason = window.prompt(
      `Archive ${ids.length} selected row${ids.length === 1 ? '' : 's'}? (optional reason)`
    );
    if (reason === null) return;
    const fd = new FormData();
    fd.set('ids', JSON.stringify(ids));
    fd.set('reason', reason);
    startTransition(async () => {
      const res = await bulkArchiveLedgerEntries(fd);
      if (!res.ok) {
        window.alert(res.error ?? 'Archive failed');
        return;
      }
      clearSelection();
      router.refresh();
    });
  }

  function onBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const reason = window.prompt(
      `Delete ${ids.length} selected row${ids.length === 1 ? '' : 's'}? Reason required (e.g. "duplicate import").`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('A reason is required to delete.');
      return;
    }
    const fd = new FormData();
    fd.set('ids', JSON.stringify(ids));
    fd.set('reason', reason);
    startTransition(async () => {
      const res = await bulkDeleteLedgerEntries(fd);
      if (!res.ok) {
        window.alert(res.error ?? 'Delete failed');
        return;
      }
      clearSelection();
      router.refresh();
    });
  }

  const sortLink = (key: SortKey, label: string) => {
    const isActive = sort === key;
    const nextDir = isActive && dir === 'desc' ? 'asc' : 'desc';
    const cls = isActive ? (dir === 'asc' ? styles.sortAsc : styles.sortDesc) : '';
    return (
      <th key={key} className={cls}>
        <Link href={urlWith(sp, { sort: key, dir: nextDir, page: '1' })}>{label}</Link>
      </th>
    );
  };

  return (
    <>
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkBarCount}>
            <strong>{selected.size}</strong> selected
          </span>
          <button
            type="button"
            className={styles.bulkBarBtn}
            onClick={() => setBulkOpen(true)}
            disabled={isPending}
          >
            Bulk edit
          </button>
          <button
            type="button"
            className={styles.bulkBarBtn}
            onClick={onBulkArchive}
            disabled={isPending}
          >
            Archive
          </button>
          <button
            type="button"
            className={`${styles.bulkBarBtn} ${styles.bulkBarBtnDanger}`}
            onClick={onBulkDelete}
            disabled={isPending}
          >
            Delete
          </button>
          <span className={styles.bulkBarSpacer} />
          <button
            type="button"
            className={styles.bulkBarBtn}
            onClick={clearSelection}
            disabled={isPending}
          >
            Clear
          </button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkboxCol}>
                <input
                  type="checkbox"
                  checked={allActiveSelected}
                  onChange={toggleAll}
                  disabled={activeIds.length === 0}
                  aria-label="Select all rows on this page"
                  title="Select all rows on this page"
                />
              </th>
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
                <td colSpan={11} className={styles.empty}>
                  {sp.q || sp.kind
                    ? 'No rows match the current filters.'
                    : 'No ledger entries yet.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isArchived = !!r.archived_at;
                const isDeleted = !!r.deleted_at;
                const selectable = !isArchived && !isDeleted;
                const isSelected = selected.has(r.id);
                const rowCls = [
                  isDeleted ? styles.deletedRow : isArchived ? styles.archivedRow : '',
                  isSelected ? styles.selectedRow : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                const hiddenNote = isDeleted
                  ? `deleted: ${r.deleted_reason ?? ''}`
                  : isArchived
                    ? `archived: ${r.archived_reason ?? ''}`
                    : null;
                return (
                  <tr key={r.id} className={rowCls}>
                    <td className={styles.checkboxCol}>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.id)}
                          aria-label={`Select ${r.scoutName} — ${r.shortLabel}`}
                        />
                      )}
                    </td>
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
                      <RowActions row={r} scouts={scouts} leaders={leaders} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {bulkOpen && (
        <BulkEditModal
          rows={selectedRows}
          scouts={scouts}
          leaders={leaders}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            clearSelection();
            router.refresh();
          }}
        />
      )}
    </>
  );
}
