/**
 * /admin/advancement/scoutbook-export — generates the pipe-delimited
 * bulk-upload file Scoutbook's admin advancement import accepts, for every
 * merit badge and rank award recorded in a date range.
 *
 * LEADER-ONLY (same gate as Roster). Query-param date range (?from=&to=) so
 * the preview and the actual download (./download/route.ts) agree on
 * exactly the same window without any client-side state.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadScoutbookExport } from '@/lib/scoutbook-export';
import styles from './scoutbook-export.module.css';

export const metadata = {
  title: 'Scoutbook Export — Troop 79'
};

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

function daysAgo(n: number, today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function ScoutbookExportPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') {
    return <div className={styles.gate}>The Scoutbook export is available to adult leaders only.</div>;
  }

  const today = centralToday();
  const { from: fromParam, to: toParam } = await searchParams;
  const from = fromParam || daysAgo(30, today);
  const to = toParam || today;

  const supabase = createAdminClient();
  const { rows, excluded } = await loadScoutbookExport(supabase, from, to);
  const mbCount = rows.filter((r) => r.advancementType === 'meritbadge').length;
  const rankCount = rows.filter((r) => r.advancementType === 'rank').length;

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Scoutbook Export</h1>
        <p>
          Every merit badge and rank award recorded in the date range below, formatted for Scoutbook&rsquo;s
          bulk advancement upload. Review the preview and the flagged rows before downloading — this uploads
          directly into each scout&rsquo;s official BSA record.
        </p>
      </div>

      <form className={styles.form} method="get">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From</span>
          <input type="date" name="from" defaultValue={from} className={styles.fieldInput} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <input type="date" name="to" defaultValue={to} className={styles.fieldInput} />
        </label>
        <button type="submit" className={styles.updateBtn}>
          Update
        </button>
        <a
          href={`/admin/advancement/scoutbook-export/download?from=${from}&to=${to}`}
          className={`${styles.downloadBtn} ${rows.length === 0 ? styles.downloadBtnDisabled : ''}`}
        >
          Download .txt ({rows.length})
        </a>
      </form>

      <p className={styles.summary}>
        {fmtDate(from)} &ndash; {fmtDate(to)}: <strong>{rows.length}</strong> ready to export ({mbCount} merit
        badge{mbCount === 1 ? '' : 's'}, {rankCount} rank{rankCount === 1 ? '' : 's'})
        {excluded.length > 0 && (
          <>
            {' '}
            &middot; <strong>{excluded.length}</strong> flagged below
          </>
        )}
        .
      </p>

      {excluded.length > 0 && (
        <div className={styles.callout}>
          <strong>{excluded.length} award{excluded.length === 1 ? '' : 's'} excluded</strong> — fix these
          and re-run the export to include them.
          <table className={styles.table} style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Scout</th>
                <th>What</th>
                <th>Date</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {excluded.map((e, i) => (
                <tr key={i}>
                  <td>{e.scoutName}</td>
                  <td>{e.what}</td>
                  <td>{fmtDate(e.date)}</td>
                  <td>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>Ready to Export ({rows.length})</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Scout</th>
              <th>Type</th>
              <th>Advancement</th>
              <th>Date</th>
              <th>Member ID</th>
              <th>Scoutbook ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  No merit badge or rank awards in this date range.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.scoutName}</td>
                  <td>
                    <span className={`${styles.badge} ${r.advancementType === 'rank' ? styles.badgeRank : styles.badgeMb}`}>
                      {r.advancementType === 'rank' ? 'Rank' : 'MB'}
                    </span>
                  </td>
                  <td>{r.advancementLabel}</td>
                  <td>{fmtDate(r.dateCompleted)}</td>
                  <td className={styles.mono}>{r.memberId}</td>
                  <td className={styles.mono}>{r.advancementId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={styles.muted} style={{ fontSize: 12 }}>
        Need a wider or narrower window? <Link href="/admin/advancement/scoutbook-export">Reset to the last 30 days</Link>.
      </p>
    </>
  );
}
