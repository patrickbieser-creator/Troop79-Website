/**
 * /admin/advancement/scoutbook-export — generates the pipe-delimited
 * bulk-upload file Scoutbook's admin advancement import accepts, for every
 * merit badge and rank award recorded in a date range.
 *
 * Query-param date range (?from=&to=) so the preview and the actual download
 * (./download/route.ts) agree on exactly the same window without any
 * client-side state.
 *
 * Was still gated on the legacy verifySession()/LEADER_COOKIE check straight
 * from lib/leader-session.ts — never converted during the Phase B2 sweep (the
 * 129-call-site conversion looked for requireRole() call sites; this page
 * called the session primitives directly instead, so it didn't match).
 * LEADER_PASSWORD is fully retired (Phase E), so nobody could reach this page
 * through Access & Permissions capability grants at all — reported by
 * Patrick 2026-08-19. Converted to requireCapability('advancement.write'),
 * matching every sibling advancement page (Audits, Court of Honor, Weekly
 * Report). The error boundary (../../error.tsx) renders the refusal.
 */

import Link from 'next/link';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadScoutbookExport } from '@/lib/scoutbook-export';
import { DateParamField } from '../../_components/date-param-field';
import { ScoutbookActions } from './scoutbook-actions';
import styles from './scoutbook-export.module.css';
import { PageTitle } from '../../_components/page-title';

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
  await requireCapability('advancement.write');

  const today = centralToday();
  const { from: fromParam, to: toParam } = await searchParams;
  const from = fromParam || daysAgo(30, today);
  const to = toParam || today;

  const supabase = createAdminClient();
  const { rows, excluded } = await loadScoutbookExport(supabase, from, to);
  const mbCount = rows.filter((r) => r.advancementType === 'meritbadge').length;
  const rankCount = rows.filter((r) => r.advancementType === 'rank').length;
  const unsubmittedIds = rows.filter((r) => !r.submittedAt).map((r) => r.id);

  return (
    <>
      <PageTitle
        title="Scoutbook Export"
        sub={
          <>
            Every merit badge and rank award recorded in the date range below, formatted for
            Scoutbook&rsquo;s bulk advancement upload. Review the preview and the flagged rows
            before downloading — this uploads directly into each scout&rsquo;s official BSA
            record.
          </>
        }
      />

      <form className={styles.form} method="get">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From</span>
          <DateParamField name="from" defaultValue={from} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <DateParamField name="to" defaultValue={to} />
        </label>
        <button type="submit" className={styles.updateBtn}>
          Update
        </button>
      </form>

      <ScoutbookActions
        downloadHref={`/admin/advancement/scoutbook-export/download?from=${from}&to=${to}`}
        downloadCount={rows.length}
        unsubmittedIds={unsubmittedIds}
      />

      <p className={styles.muted} style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
        Only mark rows as submitted after the downloaded file has been uploaded to Scoutbook and the
        upload confirmed successful — this is a record-keeping flag, not part of the upload itself.
      </p>

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
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.muted}>
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
                  <td>{r.submittedAt ? `✓ ${fmtDate(r.submittedAt.slice(0, 10))}` : <span className={styles.muted}>—</span>}</td>
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
