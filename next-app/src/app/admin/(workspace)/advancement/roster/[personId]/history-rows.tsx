'use client';

/**
 * History rows (date · actor — summary + a chip with the field-level old → new) shared by
 * the full-log dialog. Kept from the retired History section.
 */
import { fmtDateTime } from '@/lib/format-date';
import type { PersonHistoryEntry } from './record-types';
import styles from './person-record.module.css';

export const NO_DETAIL_TEXT = 'No field-level detail recorded for this entry';

/** The tooltip: one "Field: old → new" per line. */
export function detailTooltip(entry: PersonHistoryEntry): string {
  if (!entry.details || entry.details.length === 0) return NO_DETAIL_TEXT;
  return entry.details.map((d) => `${d.field}: ${d.from} → ${d.to}`).join('\n');
}

export function HistoryChip({ entry, onOpen }: { entry: PersonHistoryEntry; onOpen: (entry: PersonHistoryEntry) => void }) {
  const n = entry.details?.length ?? 0;
  const cls = n ? styles.chip : `${styles.chip} ${styles.chipMuted}`;
  return (
    <button type="button" className={cls} title={detailTooltip(entry)} onClick={() => onOpen(entry)}>
      {n ? `${n} field${n === 1 ? '' : 's'} changed ▸` : 'summary only'}
    </button>
  );
}

export function HistoryRows({
  entries,
  onOpenDetail
}: {
  entries: PersonHistoryEntry[];
  onOpenDetail: (entry: PersonHistoryEntry) => void;
}) {
  if (entries.length === 0) {
    return <p className={styles.empty}>No changes recorded.</p>;
  }
  return (
    <ul className={styles.histList}>
      {entries.map((e) => (
        <li key={e.id} className={styles.histRow}>
          <span className={styles.histWhen}>{fmtDateTime(e.occurredAt)}</span>
          <span className={styles.histWhat}>
            <span className={styles.histWho}>{e.actorLabel}</span> — {e.summary} <HistoryChip entry={e} onOpen={onOpenDetail} />
          </span>
        </li>
      ))}
    </ul>
  );
}

