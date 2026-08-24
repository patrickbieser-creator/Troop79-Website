/**
 * /admin/advancement/meetings/report — per-person meeting attendance
 * percentage over a date range, in two tabs (Patrick, 2026-08-24: "the
 * attendance report under roll call should have a tab for scouts and adults").
 *
 * Scouts read `ledger_active` rows of kind `meeting_attendance` — the credit
 * Roll Call grants, and where imported history lives. Adults have no ledger;
 * they read `event_attendance` on entries whose category grants meeting
 * credit (Troop Meeting), which is what Roll Call writes for everyone present.
 *
 * Denominator, both tabs = dates in range where roll call was actually taken
 * (at least one presence row of that tab's kind), so untracked meetings never
 * drag everyone's percentage down. Tab state lives in the URL (`?who=adults`)
 * like the range and sort — the page is a Server Component.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireCapability } from '@/lib/require-capability';
import {
  buildAttendanceReport,
  sortReportRows,
  type ReportPerson,
  type ReportSortKey
} from '@/lib/attendance-report';
import { DateParamField } from '../../../_components/date-param-field';
import { TabStrip } from '../../../_components/tab-strip';
import styles from '../meetings.module.css';
import { PageTitle } from '../../../_components/page-title';

export const metadata = {
  title: 'Attendance Report — Troop 79'
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Who = 'scouts' | 'adults';

async function loadScouts(from: string, to: string) {
  const supabase = createAdminClient();
  const [{ data: scouts }, attendanceRows] = await Promise.all([
    supabase.from('scouts').select('id, display_name, patrol').eq('active', true).order('display_name'),
    fetchAllRows<{ scout_id: string; date: string }>((fromIdx, toIdx) => {
      let query = supabase.from('ledger_active').select('scout_id, date').eq('kind', 'meeting_attendance');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query.order('date').range(fromIdx, toIdx);
    })
  ]);
  const roster: ReportPerson[] = ((scouts ?? []) as { id: string; display_name: string; patrol: string | null }[]).map(
    (s) => ({ id: s.id, name: s.display_name, group: s.patrol })
  );
  const pairs = attendanceRows.map((r) => ({ id: r.scout_id, date: r.date }));
  return buildAttendanceReport(roster, pairs, new Set(pairs.map((p) => p.date)));
}

async function loadAdults(from: string, to: string) {
  const supabase = createAdminClient();
  const { data: categories } = await supabase
    .from('calendar_categories')
    .select('label')
    .eq('credit_kind', 'meeting_attendance');
  const meetingLabels = ((categories ?? []) as { label: string }[]).map((c) => c.label);

  const [{ data: people }, presence] = await Promise.all([
    supabase
      .from('person_directory')
      .select('person_id, display_name, tab')
      .eq('active', true)
      .in('tab', ['leader', 'adult'])
      .order('display_name'),
    // PAGINATED — event_attendance passed 1,000 rows the day the backfill landed.
    // The embed is typed as an array by the generated client even though the
    // FK makes it one row; `embeddedEntry` below accepts either shape.
    fetchAllRows<{ person_id: number; calendar_entries: unknown }>((fromIdx, toIdx) => {
      let query = supabase
        .from('event_attendance')
        .select('person_id, calendar_entries!inner(entry_date, category)')
        .in('calendar_entries.category', meetingLabels);
      if (from) query = query.gte('calendar_entries.entry_date', from);
      if (to) query = query.lte('calendar_entries.entry_date', to);
      return query.order('id').range(fromIdx, toIdx);
    })
  ]);

  const roster: ReportPerson[] = ((people ?? []) as { person_id: number; display_name: string; tab: string }[]).map(
    (p) => ({ id: String(p.person_id), name: p.display_name, group: p.tab === 'leader' ? 'Leader' : 'Adult' })
  );
  const pairs: { id: string; date: string }[] = [];
  for (const r of presence) {
    const entry = embeddedEntry(r.calendar_entries);
    if (entry) pairs.push({ id: String(r.person_id), date: entry.entry_date });
  }
  return buildAttendanceReport(roster, pairs, new Set(pairs.map((p) => p.date)));
}

function embeddedEntry(value: unknown): { entry_date: string } | null {
  const one = Array.isArray(value) ? value[0] : value;
  if (one && typeof one === 'object' && typeof (one as { entry_date?: unknown }).entry_date === 'string') {
    return one as { entry_date: string };
  }
  return null;
}

export default async function AttendanceReportPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string; who?: string }>;
}) {
  await requireCapability('advancement.write');
  const sp = await searchParams;
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : '';
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : '';
  const sort: ReportSortKey = sp.sort === 'name' || sp.sort === 'attended' ? sp.sort : 'pct';
  const who: Who = sp.who === 'adults' ? 'adults' : 'scouts';

  const report = who === 'adults' ? await loadAdults(from, to) : await loadScouts(from, to);
  const { held } = report;
  const rows = sortReportRows(report.rows, sort);

  const qs = (over: { sort?: ReportSortKey; who?: Who }) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const s = over.sort ?? sort;
    if (s !== 'pct') p.set('sort', s);
    const w = over.who ?? who;
    if (w !== 'scouts') p.set('who', w);
    const str = p.toString();
    return str ? `?${str}` : '';
  };
  const href = (over: { sort?: ReportSortKey; who?: Who }) => `/admin/advancement/meetings/report${qs(over)}`;
  const noun = who === 'adults' ? 'adult' : 'scout';

  return (
    <>
      <PageTitle
        title="Attendance Report"
        sub={
          <>
            Meeting attendance per {noun} — {held} meeting{held === 1 ? '' : 's'} with roll call
            {from || to ? ' in the selected range' : ' on record'}. Percentages are out of meetings
            where {noun} attendance was actually taken.
          </>
        }
      />

      <TabStrip
        ariaLabel="Scouts or adults"
        activeKey={who}
        items={[
          { key: 'scouts', label: 'Scouts', href: href({ who: 'scouts' }) },
          { key: 'adults', label: 'Adults', href: href({ who: 'adults' }) }
        ]}
      />

      <form method="get" className={`${styles.toolbar} ${styles.toolbarStart}`}>
        <Link href="/admin/advancement/meetings" className={styles.editBtn}>
          ← Roll Call
        </Link>
        <span className={styles.spacer} />
        <label className={`${styles.muted} ${styles.filterLabel}`} htmlFor="from">
          From
        </label>
        <DateParamField id="from" name="from" defaultValue={from} />
        <label className={`${styles.muted} ${styles.filterLabel}`} htmlFor="to">
          To
        </label>
        <DateParamField id="to" name="to" defaultValue={to} />
        {sort !== 'pct' && <input type="hidden" name="sort" value={sort} />}
        {who !== 'scouts' && <input type="hidden" name="who" value={who} />}
        {/* Navy: this is a form submit, not an Add — the Phase A primary-button
            decision (2026-08-21) reserves green for create actions. */}
        <button type="submit" className={styles.editSaveBtn}>
          Apply
        </button>
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <Link href={href({ sort: 'name' })}>{who === 'adults' ? 'Adult' : 'Scout'}</Link>
            </th>
            <th>{who === 'adults' ? 'Role' : 'Patrol'}</th>
            <th>
              <Link href={href({ sort: 'attended' })}>Attended</Link>
            </th>
            <th>
              <Link href={href({ sort: 'pct' })}>Percent</Link>
            </th>
          </tr>
        </thead>
        <tbody>
          {held === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                No {noun} meeting attendance on record{from || to ? ' in this range' : ''} yet — take
                roll call from the Roll Call list{who === 'scouts' ? ', or import history' : ''}.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {/* Scouts have a public profile; adults have no page of their own yet. */}
                  {who === 'scouts' ? <Link href={`/scouts/${r.id}`}>{r.name}</Link> : r.name}
                </td>
                <td className={`${styles.muted} ${styles.mutedUpright}`}>{r.group ?? '—'}</td>
                <td className={styles.dateCell}>
                  {r.attended} of {held}
                </td>
                <td className={styles.dateCell}>{Math.round(r.pct * 100)}%</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
