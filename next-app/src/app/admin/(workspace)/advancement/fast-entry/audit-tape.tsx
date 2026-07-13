/**
 * Today's Audit Tape — server-rendered card showing every ledger row entered
 * today (server's local day). Updates automatically when the Server Actions
 * revalidate `/admin/advancement/fast-entry`.
 */
import Link from 'next/link';
import { InfoCell } from '../ledger/info-cell';
import styles from './fast-entry.module.css';
import type { LedgerKind } from '@/lib/supabase/types';

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

function shortDate(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

export function AuditTape({ tape }: { tape: TapeRow[] }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  return (
    <div className={styles.tape}>
      <div className={styles.tapeHeader}>
        <h3>Today&rsquo;s Audit Tape · {today}</h3>
        <span className={styles.tapeMeta}>
          {tape.length} {tape.length === 1 ? 'entry' : 'entries'} so far
          {tape.length > 0 && (
            <>
              {' · '}
              <Link
                href="/admin/advancement/ledger"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
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
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {tape.map((r) => (
                <tr key={r.id}>
                  <td className={styles.nowrap}>{shortDate(r.date)}</td>
                  <td className={styles.nowrap}>
                    <Link
                      href={`/scouts/${r.scoutId}`}
                      style={{ color: 'var(--admin-navy)', fontWeight: 600 }}
                    >
                      {r.scoutName}
                    </Link>
                  </td>
                  <td className={styles.nowrap}>
                    <span className={styles.kindPill}>{KIND_LABEL[r.kind]}</span>
                  </td>
                  <td
                    className={styles.nowrap}
                    style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: 11.5 }}
                  >
                    {r.code}
                  </td>
                  <td>
                    <InfoCell short={r.shortLabel} full={r.label} />
                  </td>
                  <td className={styles.nowrap}>{r.by ?? ''}</td>
                  <td style={{ textAlign: 'right' }}>{r.qty}</td>
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
