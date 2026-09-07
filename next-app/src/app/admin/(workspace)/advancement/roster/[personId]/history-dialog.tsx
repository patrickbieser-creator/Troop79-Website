'use client';

/**
 * The History dialog (Phase 4) — the shared Dialog in two modes:
 *
 *   log     every audit_log row about this person, newest first, fetched on
 *           open through loadFullHistory (the page carries only the latest
 *           four); the same rows and chips as the section.
 *   detail  one entry as a Field / Was / Now table, or the fallback line
 *           when the row predates field-level detail.
 *
 * A chip inside the log opens the detail IN PLACE and "Back to log" returns
 * to the loaded rows (kept in state — no refetch). Mounted only while open,
 * showModal() once it exists, every close path lands on onClose — the same
 * lifecycle as ConfirmDialog.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/format-date';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import { loadFullHistory } from './history-actions';
import { HistoryRows, NO_DETAIL_TEXT } from './history-section';
import type { PersonHistoryEntry } from './record-types';
import styles from './person-record.module.css';

export type HistoryView = { mode: 'log' } | { mode: 'detail'; entry: PersonHistoryEntry; fromLog: boolean };

export function HistoryDialog({
  personId,
  name,
  view,
  onView,
  onClose
}: {
  personId: number;
  name: string;
  view: HistoryView;
  onView: (next: HistoryView) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [entries, setEntries] = useState<PersonHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wantsLog = view.mode === 'log' || view.fromLog;

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  // Fetch once, the first time the log is shown; a detail opened from the
  // page and then closed never fetches.
  useEffect(() => {
    if (!wantsLog || entries !== null) return;
    let cancelled = false;
    loadFullHistory(personId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the log.');
      });
    return () => {
      cancelled = true;
    };
  }, [wantsLog, entries, personId]);

  const title = view.mode === 'log' ? `History — ${name}` : view.entry.summary;

  return (
    <Dialog ref={ref} className={styles.histDialog} aria-labelledby={titleId} onClose={onClose}>
      <DialogHeader title={<span id={titleId}>{title}</span>} />
      <DialogBody className={styles.histBody}>
        {view.mode === 'log' ? (
          <>
            {error && <Notice>{error}</Notice>}
            {entries === null ? (
              !error && <p className={styles.muted}>Loading…</p>
            ) : (
              <>
                <p className={styles.histIntro}>
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, newest first. Hover a chip for the old →
                  new values, or click it.
                </p>
                <HistoryRows entries={entries} onOpenDetail={(entry) => onView({ mode: 'detail', entry, fromLog: true })} />
              </>
            )}
          </>
        ) : (
          <EntryDetail entry={view.entry} />
        )}
      </DialogBody>
      <DialogActions>
        {view.mode === 'detail' && view.fromLog && (
          <Button variant="secondary" onClick={() => onView({ mode: 'log' })}>
            Back to log
          </Button>
        )}
        <Button onClick={() => ref.current?.close()}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function EntryDetail({ entry }: { entry: PersonHistoryEntry }) {
  const rows = entry.details ?? [];
  return (
    <>
      <p className={styles.histIntro}>
        {fmtDateTime(entry.occurredAt)} · {entry.actorLabel}
      </p>
      <table className={styles.diff}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Was</th>
            <th scope="col">Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className={styles.muted}>
                {NO_DETAIL_TEXT}.
              </td>
            </tr>
          ) : (
            rows.map((d, i) => (
              <tr key={`${d.field}-${i}`}>
                <td>{d.field}</td>
                <td className={styles.muted}>{d.from}</td>
                <td>
                  <strong>{d.to}</strong>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
