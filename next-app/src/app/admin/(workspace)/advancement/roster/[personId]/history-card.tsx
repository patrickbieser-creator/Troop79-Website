'use client';

/**
 * The History entry in the fact strip (Phase 4): "<last change> · <who>" as
 * a button that opens the full log, with "N changes · M with field detail"
 * under it. Counts come from the loader, so they follow every
 * router.refresh() after an action on the page.
 */
import { fmtDateTime } from '@/lib/format-date';
import type { PersonHistorySummary } from './record-types';
import styles from './person-record.module.css';

export function HistoryFact({ history, onOpen }: { history: PersonHistorySummary; onOpen: () => void }) {
  const last = history.latest[0];
  if (!last) return <span className={styles.empty}>—</span>;
  const n = history.total;
  return (
    <>
      <button type="button" className={styles.linkBtn} title="Open the change log" onClick={onOpen}>
        {fmtDateTime(last.occurredAt)} · {last.actorLabel}
      </button>
      <span className={styles.sub}>
        {n} change{n === 1 ? '' : 's'} · {history.withDetails} with field detail
      </span>
    </>
  );
}
