/**
 * Today's Audit Tape — server-rendered card showing every ledger row entered
 * today (server's local day). Updates automatically when the Server Actions
 * revalidate `/admin/advancement/fast-entry`.
 */
import Link from 'next/link';
import { InfoCell } from '../ledger/info-cell';
import styles from './fast-entry.module.css';
import type { LedgerKind } from '@/lib/supabase/types';
import { centralToday } from '@/lib/dates';
import { fmtDate, fmtDateFull } from '@/lib/format-date';

export interface TapeRow {
  id: number;
  date: string | null;
  enteredAt: string | null;
  scoutId: string;
  scoutName: string;
  kind: LedgerKind;
  code: string;
  label: string | null;
  by: string | null;
  qty: number;
  unit: string;
  shortLabel: string;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  rank_requirement: 'Rank req',
  rank_award: 'Rank',
  merit_badge_requirement: 'MB req',
  merit_badge_award: 'MB',
  service_hours: 'Service',
  camping_nights: 'Campout',
  hiking_miles: 'Hike',
  day_outing: 'Day Outing',
  fundraiser: 'Fundraiser',
  leadership: 'Leader',
  award: 'Award',
  meeting_attendance: 'Meeting'
};

export function AuditTape({ tape }: { tape: TapeRow[] }) {
  const today = fmtDateFull(centralToday());
  return (
    <div className={styles.tape}>
      <div className={styles.tapeHeader}>
        <h3>Today&rsquo;s Audit Tape · {today}</h3>
        <span className={styles.tapeMeta}>
          {tape.length} {tape.length === 1 ? 'entry' : 'entries'} so far
          {tape.length > 0 && (
            <>
              {' · '}
              <Link href="/admin/advancement/ledger" className={styles.inlineLink}>
                full ledger →
              </Link>
            </>
          )}
        </span>
      </div>
      <div className={styles.tapeTableWrap}>
        {tape.length === 0 ? (
          <div className={styles.tapeEmpty}>
            Nothing has been entered today yet. Use the cards above to add the
            first entry.
          </div>
        ) : (
          <table className={styles.tapeTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Scout</th>
                <th>Type</th>
                <th>Code</th>
                <th>Description</th>
                <th>By</th>
                <th className={styles.cellRight}>Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {tape.map((r) => (
                <tr key={r.id}>
                  <td className={styles.nowrap}>{fmtDate(r.date)}</td>
                  <td className={styles.nowrap}>
                    <Link href={`/scouts/${r.scoutId}`} className={styles.scoutLink}>
                      {r.scoutName}
                    </Link>
                  </td>
                  <td className={styles.nowrap}>
                    <span className={styles.kindPill}>{KIND_LABEL[r.kind]}</span>
                  </td>
                  <td
                    className={`${styles.nowrap} ${styles.codeCell}`}
                  >
                    {r.code}
                  </td>
                  <td>
                    <InfoCell short={r.shortLabel} full={r.label} />
                  </td>
                  <td className={styles.nowrap}>{r.by ?? ''}</td>
                  <td className={styles.cellRight}>{r.qty}</td>
                  <td className={styles.nowrap}>{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
