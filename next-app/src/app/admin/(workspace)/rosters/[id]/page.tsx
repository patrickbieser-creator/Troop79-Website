import Link from 'next/link';
import { addCandidatesFor } from '@/lib/event-signup-admin';
import {
  isParticipantClass,
  isYouthClass,
  PARTICIPANT_CLASSES,
  PARTICIPANT_CLASS_LABEL,
  type ParticipantClass
} from '@/lib/participant-class';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { RosterTable } from './roster-table';
import { AddPerson, type AddCandidate } from './add-person';
import { EmailPanel } from './email-panel';
import { emailConfigured } from '@/lib/email';
import styles from '../../events/events-admin.module.css';
import { PageTitle } from '../../_components/page-title';

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
  /** Participant class (Plans/Participant-Classification.md) — the planning
   *  truth; `kind` is the legacy person_kind kept in step with it. */
  participantClass: ParticipantClass;
  /** Named guest rows (no person): who they are and which entry brought them. */
  guestName: string | null;
  hostEntryId: number | null;
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
  /** Pure job labels — the coverage tally matches against these. */
  claims: string[];
  /** Job labels with each claim's note appended. Display and CSV only. */
  claimsDisplay: string[];
  /** Slot ids + notes — what the per-row jobs editor edits (2026-08-21). */
  claimDetails: { slotId: number; comment: string | null }[];
  answers: string[];
}

async function load(signupId: number) {
  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireCapability('calendar.write');
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
         { data: scouts }, { data: households },
         { data: people }] = await Promise.all([
    supabase.from('calendar_entries').select('id, title, entry_date, category')
      .eq('id', sig.calendar_entry_id).maybeSingle(),
    supabase.from('signup_entries').select('*').eq('event_signup_id', sig.id),
    supabase.from('event_prices').select('*').eq('event_signup_id', sig.id),
    supabase.from('signup_slots').select('*').eq('event_signup_id', sig.id).order('sort'),
    supabase.from('signup_slot_claims').select('slot_id, signup_entry_id, comment'),
    supabase.from('signup_answers').select('signup_entry_id, question_id, value'),
    supabase.from('signup_questions').select('id, prompt').eq('event_signup_id', sig.id),
    supabase.from('scouts').select('id, display_name, active, household_id'),
    supabase.from('households').select('id, label'),

    supabase.from('people').select('id, display_name')
  ]);

  const priceById = new Map(
    ((prices ?? []) as { id: number; label: string; amount: number; per: string }[]).map((p) => [p.id, p])
  );
  const peopleById = new Map(
    ((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name])
  );
  const hhById = new Map(((households ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label]));
  const slotById = new Map(((slots ?? []) as { id: number; label: string }[]).map((s) => [s.id, s.label]));
  // Two maps on purpose. `claimsByEntry` stays PURE job labels because the
  // coverage count below matches them exactly (`r.claims.includes(sl.label)`)
  // — folding the note into the label there would silently zero out every
  // "covered" figure on the page. `claimsDisplayByEntry` is the one rendered.
  const claimsByEntry = new Map<number, string[]>();
  const claimsDisplayByEntry = new Map<number, string[]>();
  const claimDetailsByEntry = new Map<number, { slotId: number; comment: string | null }[]>();
  for (const c of (claims ?? []) as {
    slot_id: number;
    signup_entry_id: number;
    comment: string | null;
  }[]) {
    const label = slotById.get(c.slot_id);
    if (!label) continue;
    claimsByEntry.set(c.signup_entry_id, [...(claimsByEntry.get(c.signup_entry_id) ?? []), label]);
    claimsDisplayByEntry.set(c.signup_entry_id, [
      ...(claimsDisplayByEntry.get(c.signup_entry_id) ?? []),
      c.comment ? `${label} — ${c.comment}` : label
    ]);
    claimDetailsByEntry.set(c.signup_entry_id, [
      ...(claimDetailsByEntry.get(c.signup_entry_id) ?? []),
      { slotId: c.slot_id, comment: c.comment }
    ]);
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
    // person_id is NOT NULL and every row has one, so the legacy name
    // fallbacks went with their columns (D-066). 'Unknown' stays as the
    // last resort for a person row that was deleted out from under an entry.
    const name =
      (e.person_id ? peopleById.get(Number(e.person_id)) : null) ??
      (e.guest_name ? String(e.guest_name) : null) ??
      'Unknown';
    const participantClass: ParticipantClass = isParticipantClass(String(e.participant_class))
      ? (String(e.participant_class) as ParticipantClass)
      : e.person_kind === 'scout'
        ? 'scout'
        : 'adult';
    return {
      id: Number(e.id),
      name,
      kind: e.person_kind as 'scout' | 'adult',
      participantClass,
      guestName: (e.guest_name as string | null) ?? null,
      hostEntryId: e.host_entry_id != null ? Number(e.host_entry_id) : null,
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
      claimsDisplay: claimsDisplayByEntry.get(Number(e.id)) ?? [],
      claimDetails: claimDetailsByEntry.get(Number(e.id)) ?? [],
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

  // Who a leader could still add by hand — everyone active without a LIVE
  // entry; people Removed earlier are offered too, flagged, and Add
  // reinstates their original entry (lib/event-signup-admin addCandidatesFor).
  const { data: directory } = await supabase
    .from('person_directory')
    .select('person_id, display_name, scout_id, active')
    .eq('active', true)
    .order('display_name');

  const addCandidates: AddCandidate[] = addCandidatesFor(
    (directory ?? []) as { person_id: number; display_name: string; scout_id: string | null }[],
    (entries ?? []) as { person_id: number | null; status: string }[]
  ).map((c) => ({
    ...c,
    // Household is not resolved here: the roster's own household lookup is
    // built per-ENTRY. Scout/Adult is enough to tell two similar names apart.
    household: null
  }));

  return {
    signup: sig,
    entry: entry as Record<string, unknown> | null,
    rows: liveRows,
    removedRows,
    nonResponders,
    slotCoverage,
    addCandidates,
    slots: ((slots ?? []) as { id: number; label: string }[]).map((sl) => ({ id: sl.id, label: sl.label }))
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
  // By CLASS (Plans/Participant-Classification.md): youth = scout, junior
  // leader, webelos, cub scout, youth guest; adults = adult, adult guest.
  // Named guest rows are attendees in their own right; legacy guest_count
  // (pre-2026-08-21 sign-ups) still adds to the headcount below.
  const youthGoing = going.filter((r) => isYouthClass(r.participantClass));
  const adultsGoing = going.filter((r) => !isYouthClass(r.participantClass));
  const classBreakdown = (rowsIn: RosterRow[], youth: boolean) =>
    PARTICIPANT_CLASSES.filter((c) => isYouthClass(c) === youth)
      .map((c) => [c, rowsIn.filter((r) => r.participantClass === c).length] as const)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => `${n} ${PARTICIPANT_CLASS_LABEL[c]}`)
      .join(' · ') || '—';
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
      <PageTitle
        title={`${String(data.entry.title)} — Roster`}
        sub={
          <>
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
          </>
        }
      />

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Youth going</div>
          <div className={styles.tileValue}>{youthGoing.length}</div>
          <div className={styles.tileSub}>{classBreakdown(going, true)}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Adults going</div>
          <div className={styles.tileValue}>{adultsGoing.length}</div>
          <div className={styles.tileSub}>
            {classBreakdown(going, false)} · {driverOnly.length} driver-only
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Total headcount</div>
          <div className={styles.tileValue}>
            {headcount}
            {signup.capacity ? <span className={styles.tileOf}> of {signup.capacity}</span> : null}
          </div>
          <div className={styles.tileSub}>
            {guests > 0 ? `${guests} unnamed guests included` : 'named guests counted as rows'}
          </div>
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
        slots={data.slots}
        rows={rows}
        removedRows={removedRows}
        signupId={signupId}
        calendarEntryId={Number(data.entry.id)}
        showSlip={signup.needs_permission_slip}
      />

      <AddPerson
        candidates={data.addCandidates}
        signupId={signupId}
        calendarEntryId={Number(data.entry.id)}
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
