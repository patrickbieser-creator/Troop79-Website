/**
 * /admin/advancement/meetings/report — per-scout meeting attendance
 * percentage over a date range.
 *
 * Denominator = meetings in range with at least one scout attendance row
 * (i.e. meetings where roll call was actually taken), so untracked meetings
 * never drag everyone's percentage down.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireRole } from '@/lib/require-role';
import styles from '../meetings.module.css';

export const metadata = {
  title: 'Attendance Report — Troop 79'
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SortKey = 'pct' | 'name' | 'attended';

interface ReportRow {
  scoutId: string;
  name: string;
  patrol: string | null;
  attended: number;
  pct: number;
}

export default async function AttendanceReportPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string }>;
}) {
  await requireRole(['leader']);
  const sp = await searchParams;
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : '';
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : '';
  const sort: SortKey = sp.sort === 'name' || sp.sort === 'attended' ? sp.sort : 'pct';

  const supabase = createAdminClient();
  const [{ data: scouts }, attendanceRows] = await Promise.all([
    supabase
      .from('scouts')
      .select('id, display_name, patrol')
      .eq('active', true)
      .order('display_name'),
    fetchAllRows<{ scout_id: string; date: string }>((fromIdx, toIdx) => {
      let query = supabase
        .from('ledger_active')
        .select('scout_id, date')
        .eq('kind', 'meeting_attendance');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query.order('date').range(fromIdx, toIdx);
    })
  ]);

  const meetingDates = new Set(attendanceRows.map((r) => r.date));
  const held = meetingDates.size;

  const perScout = new Map<string, Set<string>>();
  for (const r of attendanceRows) {
    if (!perScout.has(r.scout_id)) perScout.set(r.scout_id, new Set());
    perScout.get(r.scout_id)!.add(r.date);
  }

  const rows: ReportRow[] = ((scouts ?? []) as { id: string; display_name: string; patrol: string | null }[]).map(
    (s) => {
      const attended = perScout.get(s.id)?.size ?? 0;
      return {
        scoutId: s.id,
        name: s.display_name,
        patrol: s.patrol,
        attended,
        pct: held > 0 ? attended / held : 0
      };
    }
  );

  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'attended') return b.attended - a.attended || a.name.localeCompare(b.name);
    return b.pct - a.pct || a.name.localeCompare(b.name);
  });

  const rangeQs = (extra: string) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (extra) p.set('sort', extra);
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  };

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Attendance Report</h1>
        <p>
          Meeting attendance per scout — {held} meeting{held === 1 ? '' : 's'} with roll call
          {from || to ? ' in the selected range' : ' on record'}. Percentages are out of meetings
          where attendance was actually taken.
        </p>
      </div>

      <form method="get" className={styles.toolbar} style={{ justifyContent: 'flex-start' }}>
        <Link href="/admin/advancement/meetings" className={styles.editBtn}>
          ← All meetings
        </Link>
        <span style={{ flex: 1 }} />
        <label className={styles.muted} style={{ fontStyle: 'normal', fontSize: 11.5 }} htmlFor="from">
          From
        </label>
        <input type="date" id="from" name="from" defaultValue={from} className={styles.dateInput} />
        <label className={styles.muted} style={{ fontStyle: 'normal', fontSize: 11.5 }} htmlFor="to">
          To
        </label>
        <input type="date" id="to" name="to" defaultValue={to} className={styles.dateInput} />
        {sort !== 'pct' && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className={styles.addBtn}>
          Apply
        </button>
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <Link href={`/admin/advancement/meetings/report${rangeQs('name')}`}>Scout</Link>
            </th>
            <th>Patrol</th>
            <th>
              <Link href={`/admin/advancement/meetings/report${rangeQs('attended')}`}>Attended</Link>
            </th>
            <th>
              <Link href={`/admin/advancement/meetings/report${rangeQs('')}`}>Percent</Link>
            </th>
          </tr>
        </thead>
        <tbody>
          {held === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                No meeting attendance on record{from || to ? ' in this range' : ''} yet — take roll
                call from the Meetings list, or import history.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.scoutId}>
                <td>
                  <Link href={`/scouts/${r.scoutId}`}>{r.name}</Link>
                </td>
                <td className={styles.muted} style={{ fontStyle: 'normal' }}>
                  {r.patrol ?? '—'}
                </td>
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
