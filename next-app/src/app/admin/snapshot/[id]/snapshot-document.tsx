/**
 * The event snapshot DOCUMENT — the campout sheet's one tab as a printable
 * page (Plans/Event-Logistics.md §E): roster, cars, other assignments,
 * contacts, money. Rendered by two routes (Patrick, 2026-08-22 — "the
 * snapshot should be consistent with the rest of the tabs; one final step
 * would be to print"):
 *   - /admin/rosters/[id]/snapshot — inside the workspace (sidebar, event
 *     tabs), where leaders read it and pick the print order;
 *   - /admin/snapshot/[id] — the bare print view, opened by that page's Print
 *     button (no chrome; the page IS the paper).
 * Access is decided here (loadSnapshot → requireCapability), so both routes
 * are gated the same way.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { isParticipantClass, isYouthClass, PARTICIPANT_CLASS_LABEL, PARTICIPANT_CLASS_SHORT, type ParticipantClass } from '@/lib/participant-class';
import { gradeFromGradYear } from '@/lib/demographics';
import { isRideStatus, LEG_LABEL, type Leg } from '@/lib/transport';
import { money, summarizeEventMoney } from '@/lib/event-money';
import {
  buildCarManifests,
  buildContacts,
  buildCounts,
  buildJobSections,
  buildMoneyLines,
  buildOtherSets,
  buildRosterSections,
  printableQuestions,
  rosterSetColumns,
  type SnapshotInput,
  type SnapshotJob,
  type SnapshotPerson,
  type SnapshotQuestion,
  type SnapshotSet
} from '@/lib/event-snapshot';
import { isCheckboxColumn, leaderColumnHeader } from '@/lib/leader-columns';
import type { RosterOrder } from '@/lib/event-snapshot';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import { SnapshotToolbar } from './snapshot-toolbar';
import { centralToday } from '@/lib/dates';
import { fmtDate, fmtDateLong, fmtDay } from '@/lib/format-date';
import styles from './snapshot.module.css';


/*
 * The event snapshot (Plans/Event-Logistics.md §E) — the campout sheet's one
 * tab as a printable document: headcount, roster by patrol, car manifests,
 * other assignments, contacts, money, expenses & P&L, milestones, notes.
 * "Shared by everyone with access and printed out for the SPL" (Patrick).
 * Section per page; browser Save-as-PDF. No medical content — the builders
 * in lib/event-snapshot.ts are asserted against it.
 */
export async function loadSnapshot(signupId: number): Promise<{ input: SnapshotInput; calendarEntryId: number } | null> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: sig } = await supabase
    .from('event_signups')
    .select('id, calendar_entry_id, needs_permission_slip')
    .eq('id', signupId)
    .maybeSingle();
  if (!sig) return null;
  const s = sig as { id: number; calendar_entry_id: number; needs_permission_slip: boolean };

  const [{ data: entry }, { data: entries }, { data: balances }, { data: sets }, { data: questions }, { data: answers }, { data: people }, { data: scouts }, { data: households }, { data: householdMembers }, { data: relations }, tx, { data: reqs }, { data: ms }, { data: slotRows }] =
    await Promise.all([
      supabase.from('calendar_entries').select('id, title, entry_date, end_date, start_time, end_time, location').eq('id', s.calendar_entry_id).maybeSingle(),
      supabase
        .from('signup_entries')
        .select('id, person_id, participant_class, person_kind, status, participation, drives_out, drives_back, vehicle_seats_out, vehicle_seats_back, ride_out, ride_back, permission_slip_received, notes, household_id, guest_count')
        .eq('event_signup_id', s.id)
        .neq('status', 'cancelled'),
      supabase.from('signup_entry_balances').select('entry_id, owed, paid, balance').eq('event_signup_id', s.id),
      supabase.from('signup_group_sets').select('id, label, kind, leg, sort').eq('event_signup_id', s.id).order('sort').order('id'),
      supabase.from('signup_questions').select('id, prompt, input_type, choices, leader_only, print_allowed, sort').eq('event_signup_id', s.id).order('sort').order('id'),
      supabase.from('signup_answers').select('signup_entry_id, question_id, value'),
      supabase.from('people').select('id, display_name, primary_phone, primary_email'),
      supabase.from('scouts').select('id, person_id, graduation_year'),
      supabase.from('households').select('id, label'),
      supabase.from('household_members').select('household_id, person_id'),
      supabase.from('relationships').select('person_id, related_person_id, type').in('type', ['parent_of', 'guardian_of']),
      fetchAllRows<{ id: number; occurred_on: string; amount: number; kind: string; method: string | null; memo: string | null; signup_entry_id: number | null; voided_at: string | null }>((from, to) =>
        supabase
          .from('financial_transactions')
          .select('id, occurred_on, amount, kind, method, memo, signup_entry_id, voided_at')
          .eq('calendar_entry_id', s.calendar_entry_id)
          .order('occurred_on')
          .range(from, to)
      ),
      supabase.from('reimbursement_requests').select('id, requester_person_id, amount, description, status').eq('calendar_entry_id', s.calendar_entry_id),
      supabase.from('event_milestones').select('id, kind, label, due_on, amount').eq('event_signup_id', s.id).order('due_on'),
      supabase.from('signup_slots').select('id, label, code, slot_date, starts_at, ends_at, needed, description, sort').eq('event_signup_id', s.id).order('sort').order('id')
    ]);
  if (!entry) return null;
  const cal = entry as { id: number; title: string; entry_date: string; end_date: string | null; start_time: string | null; end_time: string | null; location: string | null };

  const personById = new Map(((people ?? []) as { id: number; display_name: string; primary_phone: string | null; primary_email: string | null }[]).map((p) => [p.id, p]));
  const scoutByPerson = new Map(((scouts ?? []) as { id: string; person_id: number | null; graduation_year: number | null }[]).filter((x) => x.person_id != null).map((x) => [x.person_id as number, x]));
  const hhLabel = new Map(((households ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label]));
  // scouts.household_id retired (Plans/Retire-Roster-Contact-Columns.md) —
  // household_members is the join for a scout's household now, same as
  // every other reader.
  const householdByPerson = new Map(
    ((householdMembers ?? []) as { household_id: number; person_id: number }[]).map((m) => [m.person_id, m.household_id])
  );
  // Guardian phones for youth: every parent_of/guardian_of relation's phone.
  const guardiansOf = new Map<number, number[]>();
  for (const r of (relations ?? []) as { person_id: number; related_person_id: number }[]) {
    guardiansOf.set(r.related_person_id, [...(guardiansOf.get(r.related_person_id) ?? []), r.person_id]);
  }
  const balById = new Map(((balances ?? []) as { entry_id: number; owed: number; paid: number; balance: number }[]).map((b) => [b.entry_id, b]));
  const qRows = (questions ?? []) as { id: number; prompt: string; input_type: 'text' | 'number' | 'choice'; choices: string[] | null; leader_only: boolean; print_allowed: boolean }[];
  const leaderIds = new Set(qRows.filter((q) => q.leader_only).map((q) => q.id));
  const ansByEntry = new Map<number, Record<number, string>>();
  const leaderAnsByEntry = new Map<number, Record<number, string>>();
  for (const a of (answers ?? []) as { signup_entry_id: number; question_id: number; value: string }[]) {
    const target = leaderIds.has(a.question_id) ? leaderAnsByEntry : ansByEntry;
    target.set(a.signup_entry_id, { ...(target.get(a.signup_entry_id) ?? {}), [a.question_id]: a.value });
  }

  const peopleRows: SnapshotPerson[] = ((entries ?? []) as Record<string, unknown>[]).map((e) => {
    const id = Number(e.id);
    const pid = e.person_id != null ? Number(e.person_id) : null;
    const person = pid != null ? personById.get(pid) : null;
    const scout = pid != null ? scoutByPerson.get(pid) : null;
    const cls: ParticipantClass = isParticipantClass(String(e.participant_class)) ? (String(e.participant_class) as ParticipantClass) : e.person_kind === 'scout' ? 'scout' : 'adult';
    const youth = isYouthClass(cls);
    const guardianPhones = pid != null ? (guardiansOf.get(pid) ?? []).map((g) => personById.get(g)?.primary_phone).filter((p): p is string => !!p) : [];
    const bal = balById.get(id);
    // Bare grade number (Patrick, 2026-08-22: "get rid of the word grade") — K / Grad at the ends.
    const gradeNum = scout?.graduation_year ? gradeFromGradYear(scout.graduation_year, cal.entry_date) : null;
    const grade = gradeNum == null ? null : gradeNum <= 0 ? 'K' : gradeNum > 12 ? 'Grad' : String(gradeNum);
    return {
      entryId: id,
      name: person?.display_name ?? 'Unknown',
      classLabel: PARTICIPANT_CLASS_LABEL[cls],
      classShort: PARTICIPANT_CLASS_SHORT[cls],
      isYouth: youth,
      status: String(e.status),
      participation: String(e.participation),
      grade,
      phone: youth ? (guardianPhones.join(' / ') || null) : (person?.primary_phone ?? null),
      email: youth ? null : (person?.primary_email ?? null),
      household: e.household_id
        ? (hhLabel.get(Number(e.household_id)) ?? null)
        : pid != null && householdByPerson.has(pid)
          ? (hhLabel.get(householdByPerson.get(pid)!) ?? null)
          : null,
      drivesOut: e.drives_out === true,
      drivesBack: e.drives_back === true,
      vehicleSeatsOut: e.vehicle_seats_out ? Number(e.vehicle_seats_out) : null,
      vehicleSeatsBack: e.vehicle_seats_back ? Number(e.vehicle_seats_back) : null,
      rideOut: isRideStatus(e.ride_out) ? e.ride_out : null,
      rideBack: isRideStatus(e.ride_back) ? e.ride_back : null,
      slipReceived: e.permission_slip_received === true,
      owed: Number(bal?.owed ?? 0),
      paid: Number(bal?.paid ?? 0),
      balance: Number(bal?.balance ?? 0),
      notes: (e.notes as string | null) ?? null,
      guestCount: Number(e.guest_count ?? 0),
      leaderAnswers: leaderAnsByEntry.get(id) ?? {},
      answers: ansByEntry.get(id) ?? {}
    };
  });

  const setRows = (sets ?? []) as { id: number; label: string; kind: string; leg: Leg | null }[];
  const setIds = setRows.map((x) => x.id);
  const [{ data: groups }, { data: members }] = setIds.length
    ? await Promise.all([
        supabase.from('signup_groups').select('id, set_id, name, capacity, driver_entry_id, notes, sort').in('set_id', setIds).order('sort').order('name'),
        supabase.from('signup_group_members').select('group_id, entry_id').in('set_id', setIds)
      ])
    : [{ data: [] as unknown[] }, { data: [] as unknown[] }];
  const membersByGroup = new Map<number, number[]>();
  for (const m of (members ?? []) as { group_id: number; entry_id: number }[]) membersByGroup.set(m.group_id, [...(membersByGroup.get(m.group_id) ?? []), m.entry_id]);
  const snapshotSets: SnapshotSet[] = setRows.map((x) => ({
    id: x.id,
    label: x.label,
    kind: x.kind,
    leg: x.leg,
    groups: ((groups ?? []) as { id: number; set_id: number; name: string; capacity: number | null; driver_entry_id: number | null; notes: string | null }[])
      .filter((g) => g.set_id === x.id)
      .map((g) => ({ id: g.id, name: g.name, capacity: g.capacity, driverEntryId: g.driver_entry_id, notes: g.notes, memberEntryIds: membersByGroup.get(g.id) ?? [] }))
  }));

  // Jobs + claims (the Jobs section — the readable assignment list for
  // job-heavy events; Plans/Roster-Status-Tab.md). Claims by cancelled
  // entries fall away in buildJobSections (not in `people`).
  const slotList = (slotRows ?? []) as { id: number; label: string; code: string | null; slot_date: string | null; starts_at: string | null; ends_at: string | null; needed: number | null; description: string | null }[];
  const { data: claimRows } = slotList.length
    ? await supabase.from('signup_slot_claims').select('slot_id, signup_entry_id, comment').in('slot_id', slotList.map((x) => x.id))
    : { data: [] as unknown[] };
  const claimsBySlot = new Map<number, { entryId: number; comment: string | null }[]>();
  for (const c of (claimRows ?? []) as { slot_id: number; signup_entry_id: number; comment: string | null }[]) {
    claimsBySlot.set(c.slot_id, [...(claimsBySlot.get(c.slot_id) ?? []), { entryId: c.signup_entry_id, comment: c.comment }]);
  }
  const jobs: SnapshotJob[] = slotList.map((x) => ({
    id: x.id,
    label: x.label,
    code: x.code,
    slotDate: x.slot_date,
    startsAt: x.starts_at,
    endsAt: x.ends_at,
    needed: x.needed,
    description: x.description,
    claims: claimsBySlot.get(x.id) ?? []
  }));

  const reimb = ((reqs ?? []) as { id: number; requester_person_id: number; amount: number; description: string; status: string }[]).map((r) => ({
    requesterName: personById.get(r.requester_person_id)?.display_name ?? `#${r.requester_person_id}`,
    amount: Number(r.amount),
    status: r.status,
    description: r.description
  }));
  const totals = summarizeEventMoney(
    peopleRows.map((p) => ({ entryId: p.entryId, owed: p.owed, paid: p.paid, balance: p.balance })),
    tx.map((t) => ({ id: t.id, occurredOn: t.occurred_on, amount: Number(t.amount), kind: t.kind, method: t.method, memo: t.memo, voidedAt: t.voided_at, signupEntryId: t.signup_entry_id, personId: null })),
    reimb.filter((r) => r.status === 'submitted' || r.status === 'approved')
  );

  const longDay = (iso: string) => fmtDay(iso, { year: true });
  const dateLabel =
    (cal.end_date && cal.end_date !== cal.entry_date ? `${longDay(cal.entry_date)} – ${longDay(cal.end_date)}` : longDay(cal.entry_date)) +
    (cal.start_time ? ` · ${formatTimeOfDay(cal.start_time)}${cal.end_time ? ` – ${formatTimeOfDay(cal.end_time)}` : ''}` : '');
  const input: SnapshotInput = {
    title: cal.title,
    dateLabel,
    location: cal.location,
    people: peopleRows,
    questions: qRows.map<SnapshotQuestion>((q) => ({ id: q.id, prompt: q.prompt, inputType: q.input_type, leaderOnly: q.leader_only, printAllowed: q.print_allowed })),
    sets: snapshotSets,
    jobs,
    expenses: tx.filter((t) => t.signup_entry_id == null && !t.voided_at).map((t) => ({ occurredOn: t.occurred_on, amount: Number(t.amount), memo: t.memo, method: t.method })),
    reimbursements: reimb,
    milestones: ((ms ?? []) as { id: number; kind: string; label: string; due_on: string; amount: number | null }[]).map((m) => ({ label: m.label, dueOn: m.due_on, amount: m.amount != null ? Number(m.amount) : null, kind: m.kind })),
    incomeByMethod: totals.incomeByMethod,
    totals: { owed: totals.owed, paid: totals.paid, due: totals.due, income: totals.income, expenses: totals.expenses, reimbursementsPending: totals.reimbursementsPending, net: totals.net }
  };
  return { input, calendarEntryId: s.calendar_entry_id };
}

export async function SnapshotDocument({
  signupId,
  order,
  printView
}: {
  signupId: number;
  /** Roster print order: by patrol (the sheet) or A–Z by last name. */
  order: RosterOrder;
  /** true on /admin/snapshot/[id]: the screen-only toolbar + footer links. */
  printView: boolean;
}) {
  const loaded = await loadSnapshot(signupId);
  if (!loaded) notFound();
  const { input } = loaded;

  const counts = buildCounts(input);
  const sections = buildRosterSections(input, order);
  // The roster table carries FAMILY questions only — leader admin columns
  // (Health form, Registered) and money are not what the SPL's copy is for
  // (Patrick, 2026-08-22); leader free-text still obeys print_allowed.
  const rosterQuestions = printableQuestions(input.questions).filter((q) => !q.leaderOnly);
  // Patrol / Tent / Crew columns (Patrick, 2026-08-22) — every non-car set except
  // the one the roster is sectioned by.
  const setColumns = rosterSetColumns(input, order);
  const showStatus = input.people.some((p) => p.status === 'waitlist');
  const cars = buildCarManifests(input);
  const other = buildOtherSets(input);
  const jobSections = buildJobSections(input);
  const contacts = buildContacts(input);
  const moneyLines = buildMoneyLines(input);
  const qCell = (p: SnapshotPerson, q: SnapshotQuestion) => {
    const v = (q.leaderOnly ? p.leaderAnswers : p.answers)[q.id];
    if (q.leaderOnly && q.inputType === 'choice' && isCheckboxColumn({ inputType: q.inputType, choices: [v ?? 'Yes'] }) && v) return '✓';
    return v ?? '';
  };
  const printedOn = fmtDateLong(centralToday());

  return (
    <div className={styles.doc}>
      {printView && <SnapshotToolbar signupId={signupId} order={order} />}

      <header className={styles.cover}>
        <h1 className={styles.coverTitle}>{input.title}</h1>
        <p className={styles.coverSub}>
          {input.dateLabel}
          {input.location ? ` · ${input.location}` : ''} · Troop 79 · printed {printedOn}
        </p>
        <div className={styles.tiles}>
          {counts.map((c) => (
            <span key={c.label}>
              <strong>{c.value}</strong> {c.label}
            </span>
          ))}
        </div>
      </header>
      <p className={styles.confidential}>
        For Troop 79 leaders and the SPL. Lists phone numbers and who is riding with whom — do not post or forward
        outside the troop. Print a fresh copy rather than correcting this one; rides and payments change.
      </p>

      {/* 1. Roster by patrol */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Roster</h2>
        {sections.map((sec) => (
          <div key={sec.heading} className={styles.block}>
            <h3 className={styles.sub}>
              {sec.heading} <span className={styles.muted}>({sec.rows.length})</span>
            </h3>
            <table className={`${styles.table} ${styles.rosterTable}`}>
              {/* One shared column layout for every section — A/J/S and Grade sit
                  tight to the left, Notes gets everything that is left. */}
              <colgroup>
                <col className={styles.colName} />
                <col className={styles.colCode} />
                <col className={styles.colGrade} />
                {setColumns.map((c) => (
                  <col key={c.id} className={styles.colSet} />
                ))}
                {showStatus && <col className={styles.colStatus} />}
                {rosterQuestions.map((q) => (
                  <col key={q.id} className={styles.colQ} />
                ))}
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th title="A adult · J junior leader · S scout (Cub / W Webelos / G guest)">A/J/S</th>
                  <th>Grade</th>
                  {setColumns.map((c) => (
                    <th key={c.id}>{c.label}</th>
                  ))}
                  {showStatus && <th>Status</th>}
                  {rosterQuestions.map((q) => (
                    <th key={q.id} title={q.prompt}>
                      {q.leaderOnly ? leaderColumnHeader(q.prompt) : q.prompt}
                    </th>
                  ))}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((p) => (
                  <tr key={p.entryId}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.participation !== 'full' && <span className={styles.muted}> · {p.participation.replace('_', ' ')}</span>}
                    </td>
                    <td title={p.classLabel}>{p.classShort ?? p.classLabel}</td>
                    <td>{p.grade ?? ''}</td>
                    {setColumns.map((c) => (
                      <td key={c.id}>{c.groupNameFor(p.entryId)}</td>
                    ))}
                    {showStatus && <td>{p.status}</td>}
                    {rosterQuestions.map((q) => (
                      <td key={q.id}>{qCell(p, q)}</td>
                    ))}
                    <td>{p.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {/* 2. Cars */}
      {cars.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Cars</h2>
          {cars.map((leg) => (
            <div key={leg.leg}>
              <h3 className={styles.sub}>
                {LEG_LABEL[leg.leg]} <span className={styles.muted}>({leg.cars.length} cars)</span>
              </h3>
              <div className={styles.cars}>
                {leg.cars.map((c) => (
                  <div key={c.driverName} className={styles.car}>
                    <div className={styles.carHead}>
                      <span>{c.driverName}</span>
                      <span className={styles.carMeta}>
                        {c.riders.length + 1}
                        {c.capacity != null ? ` of ${c.capacity}` : ''} seats
                      </span>
                    </div>
                    {/* No phone here — Contacts already lists it (Patrick, 2026-08-22). */}
                    {c.notes && (
                      <div className={styles.carMeta}>{c.notes}</div>
                    )}
                    <ul className={styles.plainList}>
                      {c.riders.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                      {c.capacity != null &&
                        Array.from({ length: Math.max(0, c.capacity - 1 - c.riders.length) }).map((_, i) => (
                          <li key={`blank-${i}`}>
                            <span className={styles.blank} />
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
              {leg.unplaced.length > 0 && (
                <p>
                  <strong>Still need a seat:</strong> {leg.unplaced.join(', ')}
                </p>
              )}
              {leg.onTheirOwn.length > 0 && (
                <p className={styles.muted}>On their own: {leg.onTheirOwn.map((o) => `${o.name} (${o.how.toLowerCase()})`).join(', ')}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 3. Other assignments */}
      {other.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Assignments</h2>
          <div className={styles.cols}>
            {other.map((set) => (
              <div key={set.label} className={styles.block}>
                <h3 className={styles.sub}>{set.label}</h3>
                {set.groups.map((g) => (
                  <div key={g.name} className={styles.block}>
                    <p>
                      <strong>{g.name}</strong>
                      {g.capacity != null && <span className={styles.muted}> · {g.members.length} of {g.capacity}</span>}
                    </p>
                    <ul className={styles.plainList}>
                      {g.members.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3b. Jobs — every job with who claimed it and their notes, by day.
          The printed sheet is the readable assignment list; the roster
          grid's code columns are for scanning (Plans/Roster-Status-Tab.md). */}
      {jobSections.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Jobs</h2>
          {jobSections.map((band) => (
            <div key={band.label} className={styles.block}>
              {jobSections.length > 1 && <h3 className={styles.sub}>{band.label}</h3>}
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Job</th>
                    <th>When</th>
                    <th>Who</th>
                    <th>Filled</th>
                  </tr>
                </thead>
                <tbody>
                  {band.jobs.map((j) => (
                    <tr key={j.code}>
                      <td className={styles.muted}>{j.code}</td>
                      <td>
                        {j.label}
                        {j.description && <span className={styles.muted}> · {j.description}</span>}
                      </td>
                      <td>{j.when}</td>
                      <td>{j.claimants.length > 0 ? j.claimants.map((c) => (c.note ? `${c.name} (${c.note})` : c.name)).join(', ') : <span className={styles.blank} />}</td>
                      <td className={styles.muted}>{j.coverage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {/* 4. Contacts */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Contacts</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Who</th>
              <th>Phone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className={styles.muted}>{c.role}</td>
                <td>{c.phone ?? ''}</td>
                <td>{c.email ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 5. Money */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Money</h2>
        <div className={styles.cols}>
          <div className={styles.block}>
            <h3 className={styles.sub}>Still owe</h3>
            {moneyLines.stillOwe.length === 0 ? (
              <p className={styles.muted}>Everyone is paid up.</p>
            ) : (
              <table className={styles.table}>
                <tbody>
                  {moneyLines.stillOwe.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td className={styles.num}>{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {input.milestones.length > 0 && (
              <>
                <h3 className={styles.sub}>Schedule &amp; deadlines</h3>
                <ul className={styles.plainList}>
                  {input.milestones.map((m) => (
                    <li key={`${m.label}-${m.dueOn}`}>
                      {fmtDate(m.dueOn)} — {m.label}
                      {m.amount != null ? ` ${money(m.amount)}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className={styles.block}>
            <h3 className={styles.sub}>Income &amp; expenses</h3>
            <ul className={styles.plainList}>
              {moneyLines.incomeLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {input.expenses.length > 0 && (
              <table className={styles.table}>
                <tbody>
                  {input.expenses.map((e, i) => (
                    <tr key={i}>
                      <td>{fmtDate(e.occurredOn)}</td>
                      <td>{e.memo ?? ''}</td>
                      <td className={styles.num}>{money(Math.abs(e.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {input.reimbursements.length > 0 && (
              <ul className={styles.plainList}>
                {input.reimbursements.map((r, i) => (
                  <li key={i}>
                    Reimburse {r.requesterName} {money(r.amount)} — {r.description} ({r.status})
                  </li>
                ))}
              </ul>
            )}
            <ul className={styles.plainList}>
              {moneyLines.pl.map((l) => (
                <li key={l}>
                  <strong>{l}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {printView && (
        <p className={styles.confidential}>
          <Link href={`/admin/rosters/${signupId}/snapshot`}>Back to the snapshot page</Link> · <Link href={`/admin/rosters/${signupId}`}>Roster</Link> ·{' '}
          <Link href={`/admin/rosters/${signupId}/money`}>Money</Link>
        </p>
      )}
    </div>
  );
}
