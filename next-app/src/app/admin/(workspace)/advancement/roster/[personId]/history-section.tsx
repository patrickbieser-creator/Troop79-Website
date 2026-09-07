'use client';

/**
 * History — the card above the Danger zone (Plans/Person-Editor-Rethink.md,
 * Phase 4; Direction C's one addition to Direction A). One line per change
 * with who did it: date · actor — summary, and a chip carrying the
 * field-level old → new both as a hover tooltip (one "Field: old → new" per
 * line) and as a click that opens the Field / Was / Now dialog. Latest four
 * here; "Full log" opens every entry. The rows are shared with the full-log
 * dialog (HistoryRows), so both read identically.
 *
 * Data is the audit_log filtered to this person — rendered straight from
 * the server's props, so every action's router.refresh() re-reads it.
 */
import { useState } from 'react';
import { fmtDateTime } from '@/lib/format-date';
import { Button } from '../../../../_components/button';
import type { PersonHistoryEntry, PersonHistorySummary } from './record-types';
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

export function HistorySection({
  history,
  onOpenLog,
  onOpenDetail
}: {
  history: PersonHistorySummary;
  onOpenLog: () => void;
  onOpenDetail: (entry: PersonHistoryEntry) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const shown = history.latest.length;
  return (
    <section className={styles.card} aria-label="History">
      <div className={styles.cardHead}>
        <h2>History</h2>
        <span className={styles.histMeta}>
          {history.total === 0
            ? 'nothing recorded yet'
            : `latest ${shown} of ${history.total} · hover or click a chip for old → new`}
        </span>
        <Button size="sm" onClick={onOpenLog}>
          Full log
        </Button>
      </div>
      <div className={styles.cardBody}>
        <HistoryRows entries={history.latest} onOpenDetail={onOpenDetail} />
        <div>
          <button type="button" className={styles.disc} aria-expanded={helpOpen} onClick={() => setHelpOpen((h) => !h)}>
            How this works
          </button>
          {helpOpen && (
            <div className={styles.discBody}>
              <p>
                One line per change with who did it; the chip carries the field-level detail (old → new) as a tooltip
                and opens it in a dialog. Family proposals appear when they are reviewed. This is the site&rsquo;s audit
                log filtered to this person, with the row diff stored per entry — changes made before the log started
                keeping field detail show their summary only.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
