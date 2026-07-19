import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { formatCalendarDateParts, categoryColor } from '@/lib/calendar-shared';
import styles from '../events/events-admin.module.css';

export const metadata = { title: 'Event Rosters — Troop 79' };

/*
 * Event Rosters — the OPERATIONAL view, distinct from Event Signups.
 *
 *   Event Signups (News & Events) = setup. Every upcoming calendar entry,
 *     including ones with no signup, so a leader can enable and build one.
 *   Event Rosters (Entry)         = running the event. Only events that
 *     actually have a signup, with the numbers you chase in the days before:
 *     who's coming, whose slip is missing, who still owes, who hasn't replied.
 *
 * Same underlying data, different question. This page never offers "enable
 * signup" and never links to the builder as the primary action.
 */

interface RosterSummary {
  signupId: number;
  entryId: number;
  title: string;
  category: string;
  entryDate: string;
  deadline: string;
  status: string;
  capacity: number | null;
  needsSlip: boolean;
  going: number;
  guests: number;
  waitlisted: number;
  slipsOutstanding: number;
  owed: number;
  paid: number;
  nonResponders: number;
}

async function load(): Promise<RosterSummary[]> {
  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: signups }, { data: activeScouts }] = await Promise.all([
    supabase.from('event_signups').select('*'),
    supabase.from('scouts').select('id').eq('active', true)
  ]);
  const sigs = (signups ?? []) as Record<string, unknown>[];
  if (sigs.length === 0) return [];

  const activeCount = (activeScouts ?? []).length;

  const [{ data: entries }, { data: prices }, { data: cal }] = await Promise.all([
    supabase.from('signup_entries').select('*').neq('status', 'cancelled'),
    supabase.from('event_prices').select('id, amount, per'),
    supabase
      .from('calendar_entries')
      .select('id, title, category, entry_date')
      .in(
        'id',
        sigs.map((s) => Number(s.calendar_entry_id))
      )
  ]);

  const priceById = new Map(
    ((prices ?? []) as { id: number; amount: number; per: string }[]).map((p) => [p.id, p])
  );
  const calById = new Map(
    ((cal ?? []) as { id: number; title: string; category: string; entry_date: string }[]).map(
      (c) => [c.id, c]
    )
  );
  const allEntries = (entries ?? []) as Record<string, unknown>[];

  const out: RosterSummary[] = [];
  for (const s of sigs) {
    const sid = Number(s.id);
    const c = calById.get(Number(s.calendar_entry_id));
    if (!c) continue;
    // Past events drop off — this page is about what's coming.
    if (c.entry_date < today) continue;

    const mine = allEntries.filter((e) => Number(e.event_signup_id) === sid);
    const going = mine.filter((e) => e.status === 'yes' && e.participation === 'full');
    const respondedScouts = new Set(mine.map((e) => e.scout_id).filter(Boolean));

    let owed = 0;
    let paid = 0;
    for (const e of mine) {
      const t = e.price_id ? priceById.get(Number(e.price_id)) : undefined;
      if (!t) continue;
      const amt = Number(t.amount) * (t.per === 'day' ? Number(e.days ?? 1) : 1);
      owed += amt;
      if (e.payment_received === true) paid += amt;
    }

    out.push({
      signupId: sid,
      entryId: c.id,
      title: c.title,
      category: c.category,
      entryDate: c.entry_date,
      deadline: String(s.deadline),
      status: String(s.status),
      capacity: s.capacity == null ? null : Number(s.capacity),
      needsSlip: s.needs_permission_slip === true,
      going: going.length,
      guests: going.reduce((n, e) => n + Number(e.guest_count ?? 0), 0),
      waitlisted: mine.filter((e) => e.status === 'waitlist').length,
      slipsOutstanding:
        s.needs_permission_slip === true
          ? going.filter((e) => e.person_kind === 'scout' && e.permission_slip_received !== true)
              .length
          : 0,
      owed,
      paid,
      nonResponders: Math.max(0, activeCount - respondedScouts.size)
    });
  }

  return out.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

export default async function EventRostersPage() {
  const rows = await load();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Event Rosters</h1>
        <p className={styles.sub}>
          Who&rsquo;s coming to what, and what still needs chasing. To create or configure a signup,
          use{' '}
          <Link href="/admin/events" className={styles.actionLink}>
            Event Signups
          </Link>
          .
        </p>
      </div>

      {rows.length === 0 ? (
        <section className={styles.panel}>
          <p className={styles.panelHint}>
            No upcoming events have a signup yet. Enable one under{' '}
            <Link href="/admin/events" className={styles.actionLink}>
              Event Signups
            </Link>
            .
          </p>
        </section>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Date</th>
              <th scope="col">Going</th>
              <th scope="col">Waitlist</th>
              <th scope="col">Slips out</th>
              <th scope="col">Unpaid</th>
              <th scope="col">No reply</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = formatCalendarDateParts(r.entryDate);
              const unpaid = r.owed - r.paid;
              return (
                <tr key={r.signupId}>
                  <td>
                    <span className={styles.evTitle}>{r.title}</span>
                    <span className={styles.evCat} style={{ color: categoryColor(r.category) }}>
                      {r.category}
                      {r.status === 'closed' && ' · closed'}
                    </span>
                  </td>
                  <td className={styles.nowrap}>
                    {d.month} {d.day}
                  </td>
                  <td className={styles.nowrap}>
                    {r.going}
                    {r.capacity ? ` / ${r.capacity}` : ''}
                    {r.guests > 0 && <span className={styles.evCat}>+{r.guests} guests</span>}
                  </td>
                  <td className={styles.nowrap}>{r.waitlisted || '—'}</td>
                  <td className={styles.nowrap}>
                    {r.needsSlip ? (
                      r.slipsOutstanding > 0 ? (
                        <strong className={styles.covShort}>{r.slipsOutstanding}</strong>
                      ) : (
                        '✓'
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.nowrap}>
                    {r.owed === 0 ? '—' : unpaid > 0 ? (
                      <strong className={styles.covShort}>${unpaid}</strong>
                    ) : (
                      '✓'
                    )}
                  </td>
                  <td className={styles.nowrap}>
                    {r.nonResponders > 0 ? r.nonResponders : '✓'}
                  </td>
                  <td className={styles.actions}>
                    <Link href={`/admin/rosters/${r.signupId}`} className={styles.actionLink}>
                      Open roster
                    </Link>
                    <Link href={`/events/${r.entryId}`} className={styles.actionLinkMuted}>
                      Public page
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
