import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { RosterTable } from './roster-table';
import { EmailPanel } from './email-panel';
import { emailConfigured } from '@/lib/email';
import styles from '../../events/events-admin.module.css';

export const metadata = { title: 'Event Roster — Troop 79' };

/*
 * Leader roster for one event.
 *
 * Troop-wide totals, no patrol grouping: this troop shops and plans as a
 * troop, and patrols are frequently combined for events (Patrick, 2026-07-18).
 *
 * Amount owed is DERIVED here exactly as the family form derives it —
 * Σ tier × (per-day ? days : 1) — so the two can never disagree.
 */

export interface RosterRow {
  id: number;
  name: string;
  kind: 'scout' | 'adult';
  status: string;
  participation: string;
  tierLabel: string | null;
  owed: number;
  days: number | null;
  guests: number;
  guestNote: string | null;
  drivesOut: boolean;
  drivesBack: boolean;
  seatsOut: number | null;
  seatsBack: number | null;
  slipReceived: boolean;
  paymentReceived: boolean;
  notes: string | null;
  household: string;
  claims: string[];
  answers: string[];
}

async function load(signupId: number) {
  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { data: signup } = await supabase
    .from('event_signups')
    .select('*')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return null;
  const sig = signup as unknown as {
    id: number;
    calendar_entry_id: number;
    capacity: number | null;
    needs_permission_slip: boolean;
  };

  const [{ data: entry }, { data: entries }, { data: prices }, { data: slots }, { data: claims },
         { data: answerRows }, { data: questionRows },
         { data: scouts }, { data: parents }, { data: households },
         { data: leaders }, { data: people }] = await Promise.all([
    supabase.from('calendar_entries').select('id, title, entry_date, category')
      .eq('id', sig.calendar_entry_id).maybeSingle(),
    supabase.from('signup_entries').select('*').eq('event_signup_id', sig.id),
    supabase.from('event_prices').select('*').eq('event_signup_id', sig.id),
    supabase.from('signup_slots').select('*').eq('event_signup_id', sig.id).order('sort'),
    supabase.from('signup_slot_claims').select('slot_id, signup_entry_id'),
    supabase.from('signup_answers').select('signup_entry_id, question_id, value'),
    supabase.from('signup_questions').select('id, prompt').eq('event_signup_id', sig.id),
    supabase.from('scouts').select('id, display_name, active, household_id'),
    supabase.from('scout_parents').select('id, name'),
    supabase.from('households').select('id, label'),
    // Legacy fallback only — every signup_entries row has a person_id now.
    supabase.from('leaders').select('code, name'),
    supabase.from('people').select('id, display_name')
  ]);

  const priceById = new Map(
    ((prices ?? []) as { id: number; label: string; amount: number; per: string }[]).map((p) => [p.id, p])
  );
  const scoutById = new Map(
    ((scouts ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name])
  );
  const parentById = new Map(
    ((parents ?? []) as { id: number; name: string }[]).map((p) => [p.id, p.name])
  );
  const leaderByCode = new Map(
    ((leaders ?? []) as { code: string; name: string }[]).map((l) => [l.code, l.name])
  );
  const peopleById = new Map(
    ((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name])
  );
  const hhById = new Map(((households ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label]));
  const slotById = new Map(((slots ?? []) as { id: number; label: string }[]).map((s) => [s.id, s.label]));
  const claimsByEntry = new Map<number, string[]>();
  for (const c of (claims ?? []) as { slot_id: number; signup_entry_id: number }[]) {
    const label = slotById.get(c.slot_id);
    if (!label) continue;
    claimsByEntry.set(c.signup_entry_id, [...(claimsByEntry.get(c.signup_entry_id) ?? []), label]);
  }

  const qLabel = new Map(
    ((questionRows ?? []) as { id: number; prompt: string }[]).map((q) => [q.id, q.prompt])
  );
  const ansByEntry = new Map<number, string[]>();
  for (const a of (answerRows ?? []) as {
    signup_entry_id: number;
    question_id: number;
    value: string;
  }[]) {
    const label = qLabel.get(a.question_id);
    if (!label) continue;
    ansByEntry.set(a.signup_entry_id, [
      ...(ansByEntry.get(a.signup_entry_id) ?? []),
      `${label}: ${a.value}`
    ]);
  }

  const rows: RosterRow[] = ((entries ?? []) as Record<string, unknown>[]).map((e) => {
    const tier = e.price_id ? priceById.get(Number(e.price_id)) : undefined;
    const days = e.days ? Number(e.days) : null;
    const owed = tier ? Number(tier.amount) * (tier.per === 'day' ? (days ?? 1) : 1) : 0;
    const name =
      (e.person_id ? peopleById.get(Number(e.person_id)) : null) ??
      (e.scout_id ? scoutById.get(String(e.scout_id)) : null) ??
      (e.scout_parent_id ? parentById.get(Number(e.scout_parent_id)) : null) ??
      (e.leader_code ? leaderByCode.get(String(e.leader_code)) : null) ??
      String(e.adult_name ?? 'Unknown');
    return {
      id: Number(e.id),
      name,
      kind: e.person_kind as 'scout' | 'adult',
      status: String(e.status),
      participation: String(e.participation),
      tierLabel: tier?.label ?? null,
      owed,
      days,
      guests: Number(e.guest_count ?? 0),
      guestNote: (e.guest_note as string) ?? null,
      drivesOut: e.drives_out === true,
      drivesBack: e.drives_back === true,
      seatsOut: e.seats_offered_out ? Number(e.seats_offered_out) : null,
      seatsBack: e.seats_offered_back ? Number(e.seats_offered_back) : null,
      slipReceived: e.permission_slip_received === true,
      paymentReceived: e.payment_received === true,
      notes: (e.notes as string) ?? null,
      household: e.household_id ? (hhById.get(Number(e.household_id)) ?? '—') : '—',
      claims: claimsByEntry.get(Number(e.id)) ?? [],
      answers: ansByEntry.get(Number(e.id)) ?? []
    };
  });

  const liveRows = rows.filter((r) => r.status !== 'cancelled');
  const removedRows = rows.filter((r) => r.status === 'cancelled');

  // Non-responders: active scouts with no entry at all. Silence is not a "no",
  // and this list is what turns it into one.
  const responded = new Set(liveRows.filter((r) => r.kind === 'scout').map((r) => r.name));
  const nonResponders = ((scouts ?? []) as { display_name: string; active: boolean }[])
    .filter((s) => s.active && !responded.has(s.display_name))
    .map((s) => s.display_name)
    .sort();

  const slotCoverage = ((slots ?? []) as { id: number; label: string; needed: number | null }[]).map(
    (sl) => {
      const filled = liveRows.filter((r) => r.status === 'yes' && r.claims.includes(sl.label)).length;
      return { label: sl.label, filled, needed: sl.needed };
    }
  );

  return {
    signup: sig,
    entry: entry as Record<string, unknown> | null,
    rows: liveRows,
    removedRows,
    nonResponders,
    slotCoverage
  };
}

export default async function EventRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const data = await load(signupId);
  if (!data || !data.entry) notFound();

  const { rows, removedRows, nonResponders, slotCoverage, signup } = data;
  const going = rows.filter((r) => r.status === 'yes' && r.participation === 'full');
  const scoutsGoing = going.filter((r) => r.kind === 'scout');
  const adultsGoing = going.filter((r) => r.kind === 'adult');
  const driverOnly = rows.filter((r) => r.participation === 'driver_only');
  const contributors = rows.filter((r) => r.participation === 'contributor');
  const waitlisted = rows.filter((r) => r.status === 'waitlist');
  const guests = going.reduce((n, r) => n + r.guests, 0);
  const headcount = going.length + guests;
  const seatsOut = rows.reduce((n, r) => n + (r.drivesOut ? (r.seatsOut ?? 0) : 0), 0);
  const seatsBack = rows.reduce((n, r) => n + (r.drivesBack ? (r.seatsBack ?? 0) : 0), 0);
  const owedTotal = rows.reduce((n, r) => n + r.owed, 0);
  const paidTotal = rows.filter((r) => r.paymentReceived).reduce((n, r) => n + r.owed, 0);
  // Two-deep: registered adults actually attending. driver_only doesn't count.
  const twoDeep = adultsGoing.length >= 2;

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>{String(data.entry.title)} — Roster</h1>
        <p className={styles.sub}>
          <Link href="/admin/events" className={styles.actionLinkMuted}>
            All signups
          </Link>{' '}
          ·{' '}
          <Link href={`/admin/events/${signupId}`} className={styles.actionLink}>
            Builder
          </Link>{' '}
          ·{' '}
          <Link href={`/events/${String(data.entry.id)}`} className={styles.actionLinkMuted}>
            Public page
          </Link>
        </p>
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Scouts going</div>
          <div className={styles.tileValue}>{scoutsGoing.length}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Adults going</div>
          <div className={styles.tileValue}>{adultsGoing.length}</div>
          <div className={styles.tileSub}>{driverOnly.length} driver-only</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Total headcount</div>
          <div className={styles.tileValue}>
            {headcount}
            {signup.capacity ? <span className={styles.tileOf}> of {signup.capacity}</span> : null}
          </div>
          <div className={styles.tileSub}>{guests} guests included</div>
        </div>
        <div className={styles.tile + ' ' + (twoDeep ? styles.tileOk : styles.tileWarn)}>
          <div className={styles.tileLabel}>Two-deep leadership</div>
          <div className={styles.tileValue}>{twoDeep ? '✓' : '!'}</div>
          <div className={styles.tileSub}>{adultsGoing.length} attending (need ≥2)</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Driver seats</div>
          <div className={styles.tileValue}>
            {seatsOut} / {seatsBack}
          </div>
          <div className={styles.tileSub}>there / back, besides the driver</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Payments</div>
          <div className={styles.tileValue}>${paidTotal}</div>
          <div className={styles.tileSub}>of ${owedTotal} owed</div>
        </div>
      </div>

      {slotCoverage.length > 0 && (
        <section className={styles.panel}>
          <h2>Job coverage</h2>
          <ul className={styles.coverList}>
            {slotCoverage.map((c) => (
              <li key={c.label}>
                <span>{c.label}</span>
                <span className={c.needed != null && c.filled >= c.needed ? styles.covFull : styles.covShort}>
                  {c.needed == null
                    ? `${c.filled} signed up`
                    : c.filled >= c.needed
                      ? `Full (${c.needed}/${c.needed})`
                      : `${c.filled} of ${c.needed} — ${c.needed - c.filled} more needed`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RosterTable
        rows={rows}
        removedRows={removedRows}
        signupId={signupId}
        calendarEntryId={Number(data.entry.id)}
        showSlip={signup.needs_permission_slip}
      />

      {waitlisted.length > 0 && (
        <section className={styles.panel}>
          <h2>Waitlist</h2>
          <p className={styles.panelHint}>{waitlisted.map((r) => r.name).join(', ')}</p>
        </section>
      )}

      {contributors.length > 0 && (
        <section className={styles.panel}>
          <h2>Donating (not attending)</h2>
          <ul className={styles.coverList}>
            {contributors.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span>{r.claims.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EmailPanel signupId={signupId} configured={emailConfigured()} />

      <section className={styles.panel}>
        <h2>No response yet ({nonResponders.length})</h2>
        <p className={styles.panelHint}>
          Active scouts with no entry at all. Silence isn’t a “no” — this is the chase list.
        </p>
        <p className={styles.nrList}>{nonResponders.join(' · ') || 'Everyone has responded.'}</p>
      </section>
    </>
  );
}
