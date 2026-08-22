/**
 * Event Signup loaders (Plans/Event-Signup.md, Phase 1).
 *
 * Everything reads through createAdminClient() — the anon key has no select
 * policy on any signup table (see the Phase 1 migration), so these loaders are
 * the only way in, and every caller is responsible for gating what it renders.
 *
 * Public vs. gated split, enforced by the CALLER not the loader:
 *   * loadEventDetail()  — event content, price tiers, slot definitions and
 *     aggregate coverage counts. No names. Safe to render un-gated.
 *   * (Phase 1 step 4) entry-level loaders return names and are gate-only.
 */

import { GUEST_CLASSES, type GuestClass, type ParticipantClass } from '@/lib/participant-class';
import { createAdminClient } from '@/lib/supabase/server';
import { mustMaybe } from '@/lib/db';
import type { CalendarEntry } from '@/lib/supabase/types';
import type { Leg, PlacementRow, RideStatus } from '@/lib/transport';

export interface EventPrice {
  id: number;
  label: string;
  amount: number;
  per: 'event' | 'day';
  applies_to: 'scouts' | 'adults' | 'both';
  sort: number;
}

export interface EventResource {
  id: number;
  label: string;
  url: string;
  sort: number;
}

export interface SignupSlot {
  id: number;
  kind: 'shift' | 'task';
  label: string;
  /** Optional per-job detail, shown under the job name. Replaces the retired
   *  signup-wide slots_intro — the detail leaders need to give varies job by
   *  job, not once for the whole list. */
  description: string | null;
  slot_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  attendance_required: boolean;
  eligibility: 'scouts' | 'adults' | 'both';
  needed: number | null;
  sort: number;
  /** Live claims held by entries with status='yes'. Aggregate only — never names. */
  filled: number;
}

export interface EventSignup {
  id: number;
  status: 'open' | 'closed';
  deadline: string;
  capacity: number | null;
  waitlist_enabled: boolean;
  attendance_enabled: boolean;
  drivers_needed: boolean;
  allow_guests: boolean;
  audience: 'scouts' | 'adults' | 'both';
  payment_instructions: string | null;
  needs_permission_slip: boolean;
  needs_ahmr_c: boolean;
  notes_prompt: string | null;
  guest_prompt: string | null;
  slots_title: string | null;
}

export interface SignupQuestion {
  id: number;
  prompt: string;
  input_type: 'text' | 'number' | 'choice';
  choices: string[] | null;
  applies_to: 'scouts' | 'adults' | 'both';
  required: boolean;
  sort: number;
}

export interface EventDetail {
  entry: CalendarEntry;
  resources: EventResource[];
  /** Null when signup isn't enabled on this event — the page is content-only. */
  signup: EventSignup | null;
  prices: EventPrice[];
  slots: SignupSlot[];
  questions: SignupQuestion[];
  /** status='yes' + participation='full' headcount, including guests. */
  headcount: number;
}

/**
 * True when the family form should be organized by JOB rather than by person
 * — fundraisers where claiming a slot IS the signup (Plans/Event-Signup.md,
 * "slot-first"). Mirrors the prototype's rule exactly.
 */
export function isSlotFirst(signup: EventSignup | null, slots: SignupSlot[]): boolean {
  return !!signup && !signup.attendance_enabled && slots.length > 0;
}

/** Signup is past its deadline or explicitly closed. */
export function signupLocked(signup: EventSignup): boolean {
  return signup.status === 'closed' || new Date(signup.deadline).getTime() < Date.now();
}

export interface HouseholdEntry {
  id: number;
  person_kind: 'scout' | 'adult';
  /** null ONLY for named guest rows (Plans/Participant-Classification.md). */
  person_id: number | null;
  participant_class: ParticipantClass;
  guest_name: string | null;
  host_entry_id: number | null;
  status: 'yes' | 'no' | 'waitlist' | 'cancelled';
  participation: 'full' | 'driver_only' | 'contributor';
  price_id: number | null;
  days: number | null;
  guest_count: number;
  guest_note: string | null;
  notes: string | null;
  permission_slip_received: boolean;
  payment_received: boolean;
  /** Transportation (Plans/Event-Logistics.md §A): per-leg driving with seats
   *  INCLUDING the driver, and a ride status for legs not driven. Prefills the
   *  family form so an edit shows what was offered last time. */
  drives_out: boolean;
  drives_back: boolean;
  vehicle_seats_out: number | null;
  vehicle_seats_back: number | null;
  ride_out: RideStatus | null;
  ride_back: RideStatus | null;
  /** slot ids this entry currently holds. */
  claims: number[];
  /** slot id -> the note written about doing that job, for the claims above.
   *  Kept beside `claims` rather than folded into it so the many callers that
   *  only care which slots are held stay unchanged. */
  claimComments: Record<number, string>;
  answers: { question_id: number; value: string }[];
}

/** The people a signup party is allowed to see entries for. Needed because two
 *  of the three party shapes — an unassigned scout, and an adult with no scout
 *  in the troop — have no `households` row, so their entries carry a null
 *  household_id and can't be found by the household filter.
 *
 *  person ids are the whole filter. The scoutIds / scoutParentIds /
 *  leaderCodes arrays that used to ride along were already dead weight — the
 *  filter below never read them — and their columns are gone with D-066. */
export interface PartyIdentities {
  personIds: number[];
}

const ENTRY_COLUMNS =
  'id, person_kind, person_id, participant_class, guest_name, host_entry_id, status, participation, ' +
  'price_id, days, guest_count, guest_note, notes, permission_slip_received, payment_received, ' +
  'drives_out, drives_back, vehicle_seats_out, vehicle_seats_back, ride_out, ride_back';

/**
 * One signup party's live entries for an event. GATE-ONLY — this returns names
 * and must never be rendered without a passing family/leader check.
 *
 * A party with a stored household takes the indexed household_id path. A party
 * without one (unassigned scout, standalone adult) is resolved by identity
 * instead: fetch the event's entries and keep the ones belonging to this party.
 * Filtering in memory rather than composing a PostgREST `.or()` avoids building
 * a filter string out of ids, and an event's entry count is bounded by troop
 * size, so the read stays small.
 */
export async function loadPartySignup(
  eventSignupId: number,
  householdId: number | null,
  identities: PartyIdentities
): Promise<HouseholdEntry[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from('signup_entries')
    .select(ENTRY_COLUMNS)
    .eq('event_signup_id', eventSignupId)
    .neq('status', 'cancelled');
  if (householdId != null) query = query.eq('household_id', householdId);
  const { data: entries } = await query;

  const all = (entries ?? []) as unknown as Omit<HouseholdEntry, 'claims' | 'answers'>[];
  // Household path already filtered in SQL; identity path narrows here.
  // person_id-only: it's been NOT NULL since 20260720210000, and as of the
  // submit_household_signup party-membership check (2026-07-25) every future
  // write is validated to belong to this party too — no live or future row
  // can match this party by legacy column without also matching by person_id.
  const personIds = new Set(identities.personIds);
  // Guest rows have no person_id; they belong to the party when their host
  // entry does (household path already carried them via household_id).
  let rows: typeof all;
  if (householdId != null) {
    rows = all;
  } else {
    const own = all.filter((r) => r.person_id != null && personIds.has(r.person_id));
    const ownIds = new Set(own.map((r) => r.id));
    rows = [...own, ...all.filter((r) => r.host_entry_id != null && ownIds.has(r.host_entry_id))];
  }
  if (rows.length === 0) return [];

  const { data: claims } = await supabase
    .from('signup_slot_claims')
    .select('slot_id, signup_entry_id, comment')
    .in(
      'signup_entry_id',
      rows.map((r) => r.id)
    );

  const { data: answerRows } = await supabase
    .from('signup_answers')
    .select('signup_entry_id, question_id, value')
    .in('signup_entry_id', rows.map((r) => r.id));

  const byEntry = new Map<number, number[]>();
  const notesByEntry = new Map<number, Record<number, string>>();
  for (const c of (claims ?? []) as {
    slot_id: number;
    signup_entry_id: number;
    comment: string | null;
  }[]) {
    byEntry.set(c.signup_entry_id, [...(byEntry.get(c.signup_entry_id) ?? []), c.slot_id]);
    if (c.comment) {
      notesByEntry.set(c.signup_entry_id, {
        ...(notesByEntry.get(c.signup_entry_id) ?? {}),
        [c.slot_id]: c.comment
      });
    }
  }
  const ansByEntry = new Map<number, { question_id: number; value: string }[]>();
  for (const a of (answerRows ?? []) as {
    signup_entry_id: number;
    question_id: number;
    value: string;
  }[]) {
    ansByEntry.set(a.signup_entry_id, [
      ...(ansByEntry.get(a.signup_entry_id) ?? []),
      { question_id: a.question_id, value: a.value }
    ]);
  }
  return rows.map((r) => ({
    ...r,
    claims: byEntry.get(r.id) ?? [],
    claimComments: notesByEntry.get(r.id) ?? {},
    answers: ansByEntry.get(r.id) ?? []
  }));
}

/**
 * A party's own placements — which car, tent, patrol — for the event page's
 * "You're signed up" line (Plans/Event-Logistics.md §A/§B). GATE-ONLY, and
 * scoped to the entry ids the caller already resolved as this party's, so the
 * loader cannot widen what loadPartySignup narrowed. Family-visible sets only.
 *
 * For cars the only identity exposed is the driver's FAMILY NAME (people
 * .last_name, falling back to the last word of display_name): never a phone,
 * an email, an address, or the other riders (qa-lead; Patrick accepted the
 * Tier 1 gate for this on 2026-08-22).
 */
export async function loadPartyPlacements(eventSignupId: number, entryIds: number[]): Promise<PlacementRow[]> {
  if (entryIds.length === 0) return [];
  const supabase = createAdminClient();
  const { data: sets } = await supabase
    .from('signup_group_sets')
    .select('id, label, kind, leg, family_visible, sort')
    .eq('event_signup_id', eventSignupId)
    .eq('family_visible', true)
    .order('sort');
  const setList = (sets ?? []) as { id: number; label: string; kind: string; leg: Leg | null; sort: number }[];
  if (setList.length === 0) return [];
  const setById = new Map(setList.map((s) => [s.id, s]));

  const { data: members } = await supabase
    .from('signup_group_members')
    .select('entry_id, group_id, set_id')
    .in('entry_id', entryIds)
    .in('set_id', setList.map((s) => s.id));
  const memberRows = (members ?? []) as { entry_id: number; group_id: number; set_id: number }[];
  if (memberRows.length === 0) return [];

  const { data: groups } = await supabase
    .from('signup_groups')
    .select('id, name, driver_entry_id')
    .in('id', [...new Set(memberRows.map((m) => m.group_id))]);
  const groupById = new Map(
    ((groups ?? []) as { id: number; name: string; driver_entry_id: number | null }[]).map((g) => [g.id, g])
  );

  // Names: the party's own people (for "Maya —") and the drivers' family names.
  const driverEntryIds = [...groupById.values()].map((g) => g.driver_entry_id).filter((v): v is number => v != null);
  const { data: entryPeople } = await supabase
    .from('signup_entries')
    .select('id, person_id, guest_name')
    .in('id', [...new Set([...entryIds, ...driverEntryIds])]);
  const personIdByEntry = new Map<number, number | null>();
  const guestNameByEntry = new Map<number, string | null>();
  for (const e of (entryPeople ?? []) as { id: number; person_id: number | null; guest_name: string | null }[]) {
    personIdByEntry.set(e.id, e.person_id);
    guestNameByEntry.set(e.id, e.guest_name);
  }
  const personIds = [...personIdByEntry.values()].filter((v): v is number => v != null);
  const { data: people } = personIds.length
    ? await supabase.from('people').select('id, display_name, last_name').in('id', personIds)
    : { data: [] as unknown[] };
  const personById = new Map(
    ((people ?? []) as { id: number; display_name: string; last_name: string | null }[]).map((p) => [p.id, p])
  );
  const nameOf = (entryId: number) => {
    const pid = personIdByEntry.get(entryId);
    return (pid != null ? personById.get(pid)?.display_name : null) ?? guestNameByEntry.get(entryId) ?? 'Someone';
  };
  const familyNameOf = (entryId: number | null) => {
    if (entryId == null) return null;
    const pid = personIdByEntry.get(entryId);
    const p = pid != null ? personById.get(pid) : null;
    if (!p) return null;
    const last = p.last_name?.trim() || p.display_name.trim().split(/\s+/).pop() || '';
    return last || null;
  };

  const rows: PlacementRow[] = [];
  for (const m of memberRows) {
    const set = setById.get(m.set_id);
    const group = groupById.get(m.group_id);
    if (!set || !group) continue;
    rows.push({
      entryId: m.entry_id,
      personName: nameOf(m.entry_id),
      setLabel: set.label,
      kind: set.kind,
      leg: set.leg,
      groupName: group.name,
      driverFamilyName: set.kind === 'car' ? familyNameOf(group.driver_entry_id) : null,
      isDriver: set.kind === 'car' && group.driver_entry_id === m.entry_id
    });
  }
  const setOrder = new Map(setList.map((s, i) => [s.id, i]));
  rows.sort((a, b) => {
    const sa = setOrder.get(setList.find((s) => s.label === a.setLabel)?.id ?? 0) ?? 0;
    const sb = setOrder.get(setList.find((s) => s.label === b.setLabel)?.id ?? 0) ?? 0;
    return a.entryId - b.entryId || sa - sb;
  });
  return rows;
}

export async function loadEventDetail(entryId: number): Promise<EventDetail | null> {
  const supabase = createAdminClient();

  const entryRes = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('id', entryId)
    // A draft's permalink must 404 rather than render — every entry has had a
    // guessable /events/[id] URL since D-108.
    .eq('status', 'published')
    .maybeSingle();
  // mustMaybe, not mustList: "no such event" is an ordinary answer that should
  // 404, while "the query broke" must not masquerade as one. `const { data }`
  // collapsed those two into the same null, which is how a schema mismatch
  // turned every event page into a not-found on 2026-08-16.
  const entry = mustMaybe(entryRes, `event ${entryId}: detail`);
  if (!entry) return null;

  const { data: resources } = await supabase
    .from('event_resources')
    .select('id, label, url, sort')
    .eq('calendar_entry_id', entryId)
    .order('sort', { ascending: true });

  const { data: signup } = await supabase
    .from('event_signups')
    .select(
      'id, status, deadline, capacity, waitlist_enabled, attendance_enabled, drivers_needed, ' +
        'allow_guests, audience, payment_instructions, needs_permission_slip, needs_ahmr_c, ' +
        // slots_intro is intentionally no longer selected: per-job
        // `signup_slots.description` replaced it (migration 20260808120000).
        // The column still exists and still holds text on live signups.
        'notes_prompt, guest_prompt, slots_title'
    )
    .eq('calendar_entry_id', entryId)
    .maybeSingle();

  const base: EventDetail = {
    entry: entry as CalendarEntry,
    resources: (resources ?? []) as EventResource[],
    signup: (signup ?? null) as EventSignup | null,
    prices: [],
    slots: [],
    questions: [],
    headcount: 0
  };
  if (!signup) return base;
  // The Supabase client is untyped here, so `signup` widens to a union that
  // includes an error shape. Narrow once rather than casting at every use.
  const sig = signup as unknown as EventSignup;

  const [{ data: prices }, { data: slots }, { data: headcount }] = await Promise.all([
    supabase
      .from('event_prices')
      .select('id, label, amount, per, applies_to, sort')
      .eq('event_signup_id', sig.id)
      .order('sort', { ascending: true }),
    supabase
      .from('signup_slots')
      .select(
        'id, kind, label, description, slot_date, starts_at, ends_at, attendance_required, eligibility, needed, sort'
      )
      .eq('event_signup_id', sig.id)
      // slot_date/sort first so an explicit ordering (when one is ever set)
      // wins; starts_at then makes each day read as a schedule regardless of
      // the order the leader happened to enter jobs in. `id` last is not
      // cosmetic — every row currently holds the schema default sort=0, and
      // without a unique tiebreaker Postgres is free to return tied rows in
      // any order, so editing one job could silently reshuffle the list a
      // family sees.
      .order('slot_date', { ascending: true })
      .order('sort', { ascending: true })
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true }),
    supabase.rpc('event_signup_headcount', { p_event_signup_id: sig.id })
  ]);
  const { data: questions } = await supabase
    .from('signup_questions')
    .select('id, prompt, input_type, choices, applies_to, required, sort')
    .eq('event_signup_id', sig.id)
    .order('sort')
    .order('id');

  // Coverage counts, aggregate only. Filtered to status='yes' so a cancelled
  // entry releases its spot — the same rule the claim RPC enforces.
  const slotRows = (slots ?? []) as unknown as Omit<SignupSlot, 'filled'>[];
  const counts = new Map<number, number>();
  if (slotRows.length > 0) {
    const { data: claims } = await supabase
      .from('signup_slot_claims')
      .select('slot_id, signup_entries!inner(status)')
      .in(
        'slot_id',
        slotRows.map((s) => s.id)
      )
      .eq('signup_entries.status', 'yes');
    for (const c of (claims ?? []) as { slot_id: number }[]) {
      counts.set(c.slot_id, (counts.get(c.slot_id) ?? 0) + 1);
    }
  }

  return {
    ...base,
    prices: ((prices ?? []) as unknown as EventPrice[]).map((p) => ({
      ...p,
      amount: Number(p.amount)
    })),
    slots: slotRows.map((s) => ({ ...s, filled: counts.get(s.id) ?? 0 })),
    questions: (questions ?? []) as unknown as SignupQuestion[],
    headcount: typeof headcount === 'number' ? headcount : 0
  };
}

/* ── Named guest rows from the public form (Plans/Participant-Classification.md) ── */

export interface GuestRow {
  name: string;
  cls: GuestClass;
}

/** Bound on guests per submission — a family bringing a whole den is fine,
 *  an unbounded list from a crafted POST is not. */
export const MAX_GUEST_ROWS = 20;

/**
 * Normalize the form's `guests` JSON (never trusted): parse, trim and cap
 * names, keep only the four guest classes, drop blanks, collapse duplicates
 * (case-insensitive name + class), bound the count. Pure.
 */
export function normalizeGuestRows(raw: string | null | undefined): GuestRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GuestRow[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as { name?: unknown }).name ?? '').trim().slice(0, 80);
    const cls = String((item as { cls?: unknown }).cls ?? '');
    if (!name || !(GUEST_CLASSES as readonly string[]).includes(cls)) continue;
    const key = `${name.toLowerCase()}|${cls}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, cls: cls as GuestClass });
    if (out.length >= MAX_GUEST_ROWS) break;
  }
  return out;
}
