import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { formatCalendarDateParts } from '@/lib/calendar-shared';
import { loadCalendarCategories } from '@/lib/calendar';
import { categoryColorMap, colorFor, labelsForBehavior } from '@/lib/calendar-categories';
import { EnableSignupButton } from './enable-button';
import styles from './events-admin.module.css';

export const metadata = { title: 'Event Signups — Troop 79' };

/*
 * Event Signups — the leader landing page for the whole feature.
 *
 * Signups hang off calendar_entries, so this lists upcoming calendar events
 * and shows which have signup enabled. Each row is the entry point to that
 * event's builder and roster; events without signup get a one-click enable
 * seeded from their category preset.
 */

interface Row {
  id: number;
  title: string;
  entry_date: string;
  category: string;
  signup: {
    id: number;
    status: string;
    deadline: string;
    capacity: number | null;
    attendance_enabled: boolean;
  } | null;
  headcount: number;
  slotCount: number;
}

/**
 * PostgREST `in` list literal: `("Label One","Label Two")`. Category labels are
 * user-entered and routinely contain the reserved `,` `.` `(` `)` characters
 * ("Campout / Overnight" today; anything tomorrow), so every value is quoted
 * and any embedded quote escaped.
 */
function pgInList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',')})`;
}

async function loadRows(noMeetingLabels: string[]): Promise<Row[]> {
  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // A cancelled-meeting week can't take a signup. Excluded by the category's
  // BEHAVIOR flag, not its name — labels are renamable now (D-082) — and only
  // when such a category exists, since an empty PostgREST in-list is invalid.
  let entriesQuery = supabase
    .from('calendar_entries')
    .select('id, title, entry_date, category')
    .gte('entry_date', today);
  if (noMeetingLabels.length > 0) {
    entriesQuery = entriesQuery.not('category', 'in', pgInList(noMeetingLabels));
  }

  const [{ data: entries }, { data: signups }, { data: slots }] = await Promise.all([
    entriesQuery.order('entry_date', { ascending: true }).limit(60),
    supabase
      .from('event_signups')
      .select('id, calendar_entry_id, status, deadline, capacity, attendance_enabled'),
    supabase.from('signup_slots').select('id, event_signup_id')
  ]);

  const byEntry = new Map(
    ((signups ?? []) as { calendar_entry_id: number }[]).map((s) => [s.calendar_entry_id, s])
  );
  const slotCounts = new Map<number, number>();
  for (const s of (slots ?? []) as { event_signup_id: number }[]) {
    slotCounts.set(s.event_signup_id, (slotCounts.get(s.event_signup_id) ?? 0) + 1);
  }

  // Headcounts, one RPC per enabled signup — the list is small and bounded.
  const rows: Row[] = [];
  for (const e of (entries ?? []) as unknown as Row[]) {
    const s = byEntry.get(e.id) as Row['signup'] | undefined;
    let headcount = 0;
    if (s) {
      const { data } = await supabase.rpc('event_signup_headcount', { p_event_signup_id: s.id });
      headcount = typeof data === 'number' ? data : 0;
    }
    rows.push({
      ...e,
      signup: s ?? null,
      headcount,
      slotCount: s ? (slotCounts.get(s.id) ?? 0) : 0
    });
  }
  return rows;
}

export default async function EventSignupsAdminPage() {
  const categories = await loadCalendarCategories();
  const rows = await loadRows(labelsForBehavior(categories, 'no_meeting'));
  const colors = categoryColorMap(categories);
  const enabled = rows.filter((r) => r.signup);

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Event Signups</h1>
        <p className={styles.sub}>
          Signups hang off the calendar. Enable one on any upcoming event, then compose it from
          blocks — attendance, pricing, jobs, capacity, drivers, guests.
        </p>
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Signups open</div>
          <div className={styles.tileValue}>
            {enabled.filter((r) => r.signup!.status === 'open').length}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>People signed up</div>
          <div className={styles.tileValue}>{enabled.reduce((n, r) => n + r.headcount, 0)}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Upcoming events</div>
          <div className={styles.tileValue}>{rows.length}</div>
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Date</th>
            <th scope="col">Signup</th>
            <th scope="col">Going</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const parts = formatCalendarDateParts(r.entry_date);
            return (
              <tr key={r.id}>
                <td>
                  <span className={styles.evTitle}>{r.title}</span>
                  <span className={styles.evCat} style={{ color: colorFor(colors, r.category) }}>
                    {r.category}
                  </span>
                </td>
                <td className={styles.nowrap}>
                  {parts.month} {parts.day}
                </td>
                <td>
                  {r.signup ? (
                    <span className={styles.badgeOn}>
                      {r.signup.status === 'open' ? 'Open' : 'Closed'}
                      {!r.signup.attendance_enabled && ' · job-first'}
                      {r.slotCount > 0 && ` · ${r.slotCount} jobs`}
                    </span>
                  ) : (
                    <span className={styles.badgeOff}>—</span>
                  )}
                </td>
                <td className={styles.nowrap}>
                  {r.signup ? (
                    <>
                      {r.headcount}
                      {r.signup.capacity ? ` / ${r.signup.capacity}` : ''}
                    </>
                  ) : (
                    ''
                  )}
                </td>
                <td className={styles.actions}>
                  {r.signup ? (
                    <>
                      <Link href={`/admin/events/${r.signup.id}`} className={styles.actionLink}>
                        Builder
                      </Link>
                      <Link
                        href={`/admin/rosters/${r.signup.id}`}
                        className={styles.actionLink}
                      >
                        Roster
                      </Link>
                      <Link href={`/events/${r.id}`} className={styles.actionLinkMuted}>
                        View
                      </Link>
                    </>
                  ) : (
                    <EnableSignupButton calendarEntryId={r.id} />
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                No upcoming calendar entries. Add events under News &amp; Events → Calendar first.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
