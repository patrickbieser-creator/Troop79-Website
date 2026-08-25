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
import { isRideStatus, legTiles, type Leg, type RideStatus, type TransportCar } from '@/lib/transport';
import type { LeaderQuestion } from '@/lib/leader-columns';
import { RosterTable } from './roster-table';
import { isGuestMode } from '@/lib/event-signup';
import { AddPerson, type AddCandidate } from './add-person';
import { EmailPanel } from './email-panel';
import { emailConfigured } from '@/lib/email';
import styles from '../../events/events-admin.module.css';
import { PageTitle } from '../../_components/page-title';
import { EventNav } from './event-nav';
import { loadEventNav } from './event-nav-data';

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
  /** Seats INCLUDING the driver (Plans/Event-Logistics.md §A). */
  vehicleSeatsOut: number | null;
  vehicleSeatsBack: number | null;
  /** Ride status for legs not driven; null on a driven leg. */
  rideOut: RideStatus | null;
  rideBack: RideStatus | null;
  /** Driver's name when placed in a car for that leg. */
  carOut: string | null;
  carBack: string | null;
  /** set id → group name for every non-car set they're placed in; the grid
   *  shows one column per set (Plans/Roster-Status-Tab.md item 6). */
  groupBySet: Record<number, string>;
  slipReceived: boolean;
  /** Derived money (signup_entry_balances): owed honours the per-person
   *  override; paid nets every linked payment and refund. */
  paid: number;
  balance: number;
  settled: boolean;
  notes: string | null;
  household: string;
  /** Pure job labels — the coverage tally matches against these. */
  claims: string[];
  /** Job labels with each claim's note appended. Display and CSV only. */
  claimsDisplay: string[];
  /** Slot ids + notes — what the per-row jobs editor edits (2026-08-21). */
  claimDetails: { slotId: number; comment: string | null }[];
  /** Family answers, "prompt: value". */
  answers: string[];
  /** Leader-only columns (Plans/Event-Logistics.md §D): question id → value. */
  leaderAnswers: Record<number, string>;
  /** people.health_form_date — a date, for the health-form column hint only. */
  healthFormDate: string | null;
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
    /** none | count | named (Plans/Guests-As-People.md) — the grid shows the
     *  "+N guests" column only in count mode. */
    guest_mode: string | null;
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
    supabase
      .from('signup_questions')
      .select('id, prompt, input_type, choices, applies_to, leader_only, print_allowed, sort')
      .eq('event_signup_id', sig.id)
      .order('sort')
      .order('id'),
    supabase.from('scouts').select('id, display_name, active, household_id'),
    supabase.from('households').select('id, label'),

    // health_form_date is a DATE only — the hint beside the "Health form in
    // hand" leader column (Plans/Event-Logistics.md §D); never the form.
    supabase.from('people').select('id, display_name, health_form_date')
  ]);

  // Money (Plans/Event-Logistics.md §C): the derived per-entry balance.
  const { data: balanceRows } = await supabase
    .from('signup_entry_balances')
    .select('entry_id, owed, paid, balance, settled')
    .eq('event_signup_id', sig.id);
  const balanceByEntry = new Map(
    ((balanceRows ?? []) as { entry_id: number; owed: number; paid: number; balance: number; settled: boolean }[]).map((b) => [
      b.entry_id,
      b
    ])
  );

  // Group sets (Plans/Event-Logistics.md §A/§B): cars are the trigger-owned
  // kind='car' sets (each entry's car per leg = the driver's name); every
  // other set (patrols, tents, crews, teams) becomes a "Label: Group" tag.
  const { data: allSets } = await supabase
    .from('signup_group_sets')
    .select('id, kind, label, leg, sort')
    .eq('event_signup_id', sig.id)
    .order('sort')
    .order('id');
  const setRows = (allSets ?? []) as { id: number; kind: string; label: string; leg: Leg | null }[];
  const carSetIds = setRows.filter((s) => s.kind === 'car').map((s) => s.id);
  const legBySet = new Map(setRows.filter((s) => s.kind === 'car').map((s) => [s.id, s.leg as Leg]));
  const setById = new Map(setRows.map((s) => [s.id, s]));
  const allSetIds = setRows.map((s) => s.id);
  const { data: allGroups } = allSetIds.length
    ? await supabase.from('signup_groups').select('id, set_id, name, driver_entry_id, capacity').in('set_id', allSetIds)
    : { data: [] as unknown[] };
  const { data: allMembers } = allSetIds.length
    ? await supabase.from('signup_group_members').select('group_id, entry_id, set_id').in('set_id', allSetIds)
    : { data: [] as unknown[] };
  const groupRows = (allGroups ?? []) as {
    id: number;
    set_id: number;
    name: string;
    driver_entry_id: number | null;
    capacity: number | null;
  }[];
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const membersByGroup = new Map<number, number[]>();
  const groupBySetByEntry = new Map<number, Record<number, string>>();
  for (const m of (allMembers ?? []) as { group_id: number; entry_id: number; set_id: number }[]) {
    membersByGroup.set(m.group_id, [...(membersByGroup.get(m.group_id) ?? []), m.entry_id]);
    const set = setById.get(m.set_id);
    const group = groupById.get(m.group_id);
    if (set && group && set.kind !== 'car') {
      groupBySetByEntry.set(m.entry_id, { ...(groupBySetByEntry.get(m.entry_id) ?? {}), [set.id]: group.name });
    }
  }
  // One grid column per non-car set, in the builder's order (item 6).
  const groupSets = setRows.filter((s) => s.kind !== 'car').map((s) => ({ id: s.id, label: s.label }));
  // The event tab row: one tab per set (sort order puts Patrols / Tents ahead of
  // Cars there / Cars back), Money only when the event has money.
  const nav = await loadEventNav(supabase, sig.id, sig.calendar_entry_id);
  const cars: TransportCar[] = groupRows
    .filter((g) => carSetIds.includes(g.set_id) && g.driver_entry_id != null)
    .map((g) => ({
      id: g.id,
      leg: legBySet.get(g.set_id) ?? 'out',
      driverEntryId: g.driver_entry_id as number,
      capacity: g.capacity ?? 1,
      memberEntryIds: membersByGroup.get(g.id) ?? []
    }));
  // entry id → driver entry id, per leg
  const carDriverByEntry: Record<Leg, Map<number, number>> = { out: new Map(), back: new Map() };
  for (const c of cars) for (const m of c.memberEntryIds) carDriverByEntry[c.leg].set(m, c.driverEntryId);

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

  // Family questions flatten to "label: value" strings for the Answers column;
  // LEADER-ONLY questions (Plans/Event-Logistics.md §D) are editable cells,
  // so their answers stay structured (question id → value).
  type QuestionRow = {
    id: number;
    prompt: string;
    input_type: 'text' | 'number' | 'choice';
    choices: string[] | null;
    applies_to: 'scouts' | 'adults' | 'both';
    leader_only: boolean;
    print_allowed: boolean;
  };
  const questionList = (questionRows ?? []) as QuestionRow[];
  const qById = new Map(questionList.map((q) => [q.id, q]));
  const leaderQuestions: LeaderQuestion[] = questionList
    .filter((q) => q.leader_only)
    .map((q) => ({
      id: q.id,
      prompt: q.prompt,
      inputType: q.input_type,
      choices: q.choices,
      appliesTo: q.applies_to,
      printAllowed: q.print_allowed
    }));
  const ansByEntry = new Map<number, string[]>();
  const leaderAnsByEntry = new Map<number, Record<number, string>>();
  for (const a of (answerRows ?? []) as {
    signup_entry_id: number;
    question_id: number;
    value: string;
  }[]) {
    const q = qById.get(a.question_id);
    if (!q) continue;
    if (q.leader_only) {
      leaderAnsByEntry.set(a.signup_entry_id, { ...(leaderAnsByEntry.get(a.signup_entry_id) ?? {}), [q.id]: a.value });
      continue;
    }
    ansByEntry.set(a.signup_entry_id, [
      ...(ansByEntry.get(a.signup_entry_id) ?? []),
      `${q.prompt}: ${a.value}`
    ]);
  }
  const healthFormDateByPerson = new Map(
    ((people ?? []) as { id: number; health_form_date: string | null }[]).map((p) => [p.id, p.health_form_date])
  );

  const entryNameById = new Map<number, string>();
  for (const e of (entries ?? []) as Record<string, unknown>[]) {
    entryNameById.set(
      Number(e.id),
      (e.person_id ? peopleById.get(Number(e.person_id)) : null) ?? 'Unknown'
    );
  }
  const carNameFor = (entryId: number, leg: Leg) => {
    const driver = carDriverByEntry[leg].get(entryId);
    return driver != null ? (entryNameById.get(driver) ?? 'Driver') : null;
  };

  const rows: RosterRow[] = ((entries ?? []) as Record<string, unknown>[]).map((e) => {
    const tier = e.price_id ? priceById.get(Number(e.price_id)) : undefined;
    const days = e.days ? Number(e.days) : null;
    // owed comes from the balances view (tier × days, or the per-person
    // override) so the roster and the Money tab can never disagree.
    const bal = balanceByEntry.get(Number(e.id));
    const owed = bal ? Number(bal.owed) : tier ? Number(tier.amount) * (tier.per === 'day' ? (days ?? 1) : 1) : 0;
    // person_id is NOT NULL and every row has one, so the legacy name
    // fallbacks went with their columns (D-066). 'Unknown' stays as the
    // last resort for a person row that was deleted out from under an entry.
    const name = (e.person_id ? peopleById.get(Number(e.person_id)) : null) ?? 'Unknown';
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
      vehicleSeatsOut: e.vehicle_seats_out ? Number(e.vehicle_seats_out) : null,
      vehicleSeatsBack: e.vehicle_seats_back ? Number(e.vehicle_seats_back) : null,
      rideOut: isRideStatus(e.ride_out) ? e.ride_out : null,
      rideBack: isRideStatus(e.ride_back) ? e.ride_back : null,
      carOut: e.drives_out === true ? null : carNameFor(Number(e.id), 'out'),
      carBack: e.drives_back === true ? null : carNameFor(Number(e.id), 'back'),
      groupBySet: groupBySetByEntry.get(Number(e.id)) ?? {},
      slipReceived: e.permission_slip_received === true,
      paid: bal ? Number(bal.paid) : 0,
      balance: bal ? Number(bal.balance) : owed,
      settled: bal?.settled === true,
      notes: (e.notes as string) ?? null,
      household: e.household_id ? (hhById.get(Number(e.household_id)) ?? '—') : '—',
      claims: claimsByEntry.get(Number(e.id)) ?? [],
      claimsDisplay: claimsDisplayByEntry.get(Number(e.id)) ?? [],
      claimDetails: claimDetailsByEntry.get(Number(e.id)) ?? [],
      answers: ansByEntry.get(Number(e.id)) ?? [],
      leaderAnswers: leaderAnsByEntry.get(Number(e.id)) ?? {},
      healthFormDate: e.person_id ? (healthFormDateByPerson.get(Number(e.person_id)) ?? null) : null
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

  // The sheet's Need / Avail / Short-Over block, per leg.
  const transportEntries = rows.map((r) => ({
    id: r.id,
    status: r.status,
    participation: r.participation,
    drivesOut: r.drivesOut,
    drivesBack: r.drivesBack,
    vehicleSeatsOut: r.vehicleSeatsOut,
    vehicleSeatsBack: r.vehicleSeatsBack,
    rideOut: r.rideOut,
    rideBack: r.rideBack
  }));
  const ridesOut = legTiles(transportEntries, cars, 'out');
  const ridesBack = legTiles(transportEntries, cars, 'back');

  return {
    signup: sig,
    entry: entry as Record<string, unknown> | null,
    rows: liveRows,
    removedRows,
    nonResponders,
    slotCoverage,
    addCandidates,
    ridesOut,
    ridesBack,
    hasCarSets: carSetIds.length > 0,
    leaderQuestions,
    groupSets,
    nav,
    // Feature columns exist only when the event uses the feature (item 7):
    // the family-question count decides the Answers column.
    familyQuestionCount: questionList.filter((q) => !q.leader_only).length,
    // The Edit dialog's job list carries when / how many / what (Patrick,
    // 2026-08-22: "need more detail so the editor can choose correctly").
    slots: ((slots ?? []) as { id: number; label: string; code: string | null; slot_date: string | null; starts_at: string | null; ends_at: string | null; description: string | null; needed: number | null }[]).map((sl) => ({
      id: sl.id,
      label: sl.label,
      code: sl.code,
      slotDate: sl.slot_date,
      startsAt: sl.starts_at,
      endsAt: sl.ends_at,
      description: sl.description,
      needed: sl.needed,
      filled: ((claims ?? []) as { slot_id: number }[]).filter((c) => c.slot_id === sl.id).length
    }))
  };
}

export default async function EventRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const data = await load(signupId);
  if (!data || !data.entry) notFound();

  const { rows, removedRows, nonResponders, slotCoverage, signup, ridesOut, ridesBack, hasCarSets } = data;
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
  const guests = going.reduce((n, r) => n + r.guests, 0);
  const headcount = going.length + guests;
  const owedTotal = rows.reduce((n, r) => n + r.owed, 0);
  const paidTotal = Math.round(rows.reduce((n, r) => n + r.paid, 0) * 100) / 100;
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
            <Link href={`/events/${String(data.entry.id)}`} className={styles.actionLinkMuted}>
              Public page
            </Link>
          </>
        }
      />
      <EventNav signupId={signupId} entryId={data.nav.entryId} active="roster" sets={data.nav.sets} hasMoney={data.nav.hasMoney} />

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
        {hasCarSets &&
          (
            [
              ['Rides there', ridesOut],
              ['Rides back', ridesBack]
            ] as const
          ).map(([label, t]) => (
            <div
              key={label}
              className={styles.tile + ' ' + (t.shortOver < 0 || t.unplaced > 0 ? styles.tileWarn : styles.tileOk)}
            >
              <div className={styles.tileLabel}>{label}</div>
              <div className={styles.tileValue}>
                {t.room}
                <span className={styles.tileOf}> seats for {t.riders}</span>
              </div>
              <div className={styles.tileSub}>
                {t.drivers} {t.drivers === 1 ? 'driver' : 'drivers'} · {t.unplaced} unplaced
                {t.shortOver < 0 ? ` · ${-t.shortOver} short` : ''}
                {t.self + t.meetingThere > 0 ? ` · ${t.self + t.meetingThere} on their own` : ''}
              </div>
            </div>
          ))}
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
        leaderQuestions={data.leaderQuestions}
        eventDate={String(data.entry.entry_date ?? '')}
        groupSets={data.groupSets}
        familyQuestionCount={data.familyQuestionCount}
        hasCarSets={hasCarSets}
        guestMode={isGuestMode(signup.guest_mode) ? signup.guest_mode : 'none'}
      />

      <AddPerson
        candidates={data.addCandidates}
        signupId={signupId}
        calendarEntryId={Number(data.entry.id)}
      />

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
