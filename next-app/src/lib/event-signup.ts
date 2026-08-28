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

import { cache } from 'react';
import { GUEST_CLASSES, type GuestClass, type ParticipantClass } from '@/lib/participant-class';
import type { GuestMode } from '@/lib/guest-mode';
import type { HouseholdGuest } from '@/lib/guest-payload';
// Client-safe guest helpers live in their own modules (no server client);
// re-exported here so server callers and tests keep one import.
export { GUEST_MODES, isGuestMode, type GuestMode } from '@/lib/guest-mode';
export { MAX_GUEST_ROWS, normalizeGuestRows, guestEntriesFor, guestHostKey, type GuestRow, type HouseholdGuest } from '@/lib/guest-payload';
import { createAdminClient } from '@/lib/supabase/server';
import { mustList, mustMaybe } from '@/lib/db';
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
  /** none · count (the host's entry carries "+N guests") · named (every guest
   *  is a people row with its own entry). The only guest switch since Phase 3. */
  guest_mode: GuestMode;
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

/** A family-pickable set, public-safe: labels, names, capacities and
 *  counts — never who is in a group (Plans/Event-Logistics.md §B). */
export interface PublicGroupSet {
  id: number;
  label: string;
  kind: string;
  groups: { id: number; name: string; capacity: number | null; filled: number }[];
}

export interface EventDetail {
  entry: CalendarEntry;
  resources: EventResource[];
  /** Null when signup isn't enabled on this event — the page is content-only. */
  signup: EventSignup | null;
  prices: EventPrice[];
  slots: SignupSlot[];
  questions: SignupQuestion[];
  /** Sets families may pick a group in (self_select), with room counts. */
  groupSets: PublicGroupSet[];
  /** Deposit schedule and deadlines (Plans/Event-Logistics.md §C), upcoming first. */
  milestones: PublicMilestone[];
  /** status='yes' + participation='full' headcount, including guests. */
  headcount: number;
}

export interface PublicMilestone {
  id: number;
  kind: 'payment' | 'registration' | 'form' | 'other';
  label: string;
  due_on: string;
  amount: number | null;
  applies_to: 'scouts' | 'adults' | 'both';
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
  /** Every row carries one — a named guest is a `people` row too (NOT NULL
   *  since Phase 3, 2026-08-23). The type stays nullable only because the
   *  loaders are typed loosely; treat null as a data error. */
  person_id: number | null;
  participant_class: ParticipantClass;
  /** DERIVED, not a column: a guest row's display name from its people row
   *  (loadPartySignup fills it). null for a household member (their name
   *  comes from the household). */
  guest_name: string | null;
  /** Non-null ⇒ this row is a GUEST brought by that member's entry. */
  host_entry_id: number | null;
  status: 'yes' | 'no' | 'waitlist' | 'cancelled';
  participation: 'full' | 'driver_only' | 'contributor';
  price_id: number | null;
  days: number | null;
  guest_count: number;
  guest_note: string | null;
  notes: string | null;
  permission_slip_received: boolean;
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
  'id, person_kind, person_id, participant_class, host_entry_id, status, participation, ' +
  'price_id, days, guest_count, guest_note, notes, permission_slip_received, ' +
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

  const all = ((entries ?? []) as unknown as Omit<HouseholdEntry, 'claims' | 'answers' | 'guest_name'>[]).map((r) => ({
    ...r,
    guest_name: null as string | null
  }));
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

  // A guest row's name lives on its people row (Guests as People).
  const guestPersonIds = rows
    .filter((r) => r.host_entry_id != null && r.person_id != null)
    .map((r) => r.person_id as number);
  if (guestPersonIds.length > 0) {
    const { data: guestPeople } = await supabase
      .from('people')
      .select('id, display_name')
      .in('id', guestPersonIds);
    const nameById = new Map(((guestPeople ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
    for (const r of rows) {
      if (r.host_entry_id != null && r.person_id != null) {
        r.guest_name = nameById.get(r.person_id) ?? null;
      }
    }
  }

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
  const ctx = `party placements (signup ${eventSignupId})`;
  const setList = mustList<{ id: number; label: string; kind: string; leg: Leg | null; sort: number }>(
    await supabase
      .from('signup_group_sets')
      .select('id, label, kind, leg, family_visible, sort')
      .eq('event_signup_id', eventSignupId)
      .eq('family_visible', true)
      .order('sort'),
    `${ctx}: sets`
  );
  if (setList.length === 0) return [];
  const setById = new Map(setList.map((s) => [s.id, s]));

  const memberRows = mustList<{ entry_id: number; group_id: number; set_id: number }>(
    await supabase
      .from('signup_group_members')
      .select('entry_id, group_id, set_id')
      .in('entry_id', entryIds)
      .in('set_id', setList.map((s) => s.id)),
    `${ctx}: members`
  );
  if (memberRows.length === 0) return [];

  const groups = mustList<{ id: number; name: string; driver_entry_id: number | null }>(
    await supabase
      .from('signup_groups')
      .select('id, name, driver_entry_id')
      .in('id', [...new Set(memberRows.map((m) => m.group_id))]),
    `${ctx}: groups`
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // Names: the party's own people (for "Maya —") and the drivers' family names.
  const driverEntryIds = [...groupById.values()].map((g) => g.driver_entry_id).filter((v): v is number => v != null);
  const entryPeople = mustList<{ id: number; person_id: number | null }>(
    await supabase
      .from('signup_entries')
      .select('id, person_id')
      .in('id', [...new Set([...entryIds, ...driverEntryIds])]),
    `${ctx}: entries`
  );
  const personIdByEntry = new Map<number, number | null>();
  for (const e of entryPeople) personIdByEntry.set(e.id, e.person_id);
  const personIds = [...personIdByEntry.values()].filter((v): v is number => v != null);
  const people = personIds.length
    ? mustList<{ id: number; display_name: string; last_name: string | null }>(
        await supabase.from('people').select('id, display_name, last_name').in('id', personIds),
        `${ctx}: people`
      )
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));
  const nameOf = (entryId: number) => {
    const pid = personIdByEntry.get(entryId);
    return (pid != null ? personById.get(pid)?.display_name : null) ?? 'Someone';
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

export const loadEventDetail = cache(async function loadEventDetail(entryId: number): Promise<EventDetail | null> {
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
        'guest_mode, audience, payment_instructions, needs_permission_slip, needs_ahmr_c, ' +
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
    groupSets: [],
    milestones: [],
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
    // Leader-only columns are never a family prompt (Plans/Event-Logistics.md §D).
    .eq('leader_only', false)
    .order('sort')
    .order('id');

  // Family-pickable sets: labels/names/capacity/fill only — no names of
  // members. Cars are never self-select (they come from the signup).
  const selfSetRows = mustList<{ id: number; label: string; kind: string }>(
    await supabase
      .from('signup_group_sets')
      .select('id, label, kind, sort')
      .eq('event_signup_id', sig.id)
      .eq('self_select', true)
      .neq('kind', 'car')
      .order('sort')
      .order('id'),
    `event ${entryId}: self-select sets`
  );
  const milestones = mustList<PublicMilestone>(
    await supabase
      .from('event_milestones')
      .select('id, kind, label, due_on, amount, applies_to')
      .eq('event_signup_id', sig.id)
      .order('due_on')
      .order('sort')
      .order('id'),
    `event ${entryId}: milestones`
  ).map((m) => ({ ...m, amount: m.amount != null ? Number(m.amount) : null }));
  let groupSets: PublicGroupSet[] = [];
  if (selfSetRows.length > 0) {
    const setIds = selfSetRows.map((s) => s.id);
    const [groupsRes, membersRes] = await Promise.all([
      supabase.from('signup_groups').select('id, set_id, name, capacity, sort').in('set_id', setIds).order('sort').order('name'),
      supabase.from('signup_group_members').select('group_id').in('set_id', setIds)
    ]);
    const groups = mustList<{ id: number; set_id: number; name: string; capacity: number | null }>(groupsRes, `event ${entryId}: groups`);
    const members = mustList<{ group_id: number }>(membersRes, `event ${entryId}: group members`);
    const filled = new Map<number, number>();
    for (const m of members) filled.set(m.group_id, (filled.get(m.group_id) ?? 0) + 1);
    groupSets = selfSetRows.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      groups: groups
        .filter((g) => g.set_id === s.id)
        .map((g) => ({ id: g.id, name: g.name, capacity: g.capacity, filled: filled.get(g.id) ?? 0 }))
    }));
  }

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
    groupSets,
    milestones,
    headcount: typeof headcount === 'number' ? headcount : 0
  };
});

export interface PartyMembership {
  entryId: number;
  setId: number;
  groupId: number;
}

/** The party's raw placements (set → group) for the form's pickers to
 *  prefill. GATE-ONLY and scoped to entry ids the caller already resolved. */
export async function loadPartyMemberships(entryIds: number[]): Promise<PartyMembership[]> {
  if (entryIds.length === 0) return [];
  const supabase = createAdminClient();
  const rows = mustList<{ entry_id: number; set_id: number; group_id: number }>(
    await supabase.from('signup_group_members').select('entry_id, set_id, group_id').in('entry_id', entryIds),
    'party memberships'
  );
  return rows.map((m) => ({ entryId: m.entry_id, setId: m.set_id, groupId: m.group_id }));
}

/* ── Named guest rows from the public form (Plans/Participant-Classification.md) ── */

/**
 * A household's guests on record. GATE-ONLY — names. Active, un-merged guest
 * people rows of the household; class defaults to the latest entry's
 * participant_class (else youth_guest).
 */
export async function loadHouseholdGuests(householdId: number | null): Promise<HouseholdGuest[]> {
  if (householdId == null) return [];
  const supabase = createAdminClient();
  const { data: people } = await supabase
    .from('people')
    .select('id, display_name, primary_phone')
    .eq('guest_host_household_id', householdId)
    .is('merged_into_person_id', null)
    .eq('active', true)
    .order('display_name');
  const rows = (people ?? []) as { id: number; display_name: string; primary_phone: string | null }[];
  if (rows.length === 0) return [];
  const { data: entries } = await supabase
    .from('signup_entries')
    .select('person_id, participant_class, id')
    .in('person_id', rows.map((r) => r.id))
    .order('id', { ascending: false });
  const lastClass = new Map<number, GuestClass>();
  for (const e of (entries ?? []) as { person_id: number; participant_class: string }[]) {
    if (!lastClass.has(e.person_id) && (GUEST_CLASSES as readonly string[]).includes(e.participant_class)) {
      lastClass.set(e.person_id, e.participant_class as GuestClass);
    }
  }
  return rows.map((r) => ({
    personId: r.id,
    name: r.display_name,
    cls: lastClass.get(r.id) ?? 'youth_guest',
    phone: r.primary_phone
  }));
}

/** Claims the party holds that the form no longer asks for — the ones to
 *  delete after a submit. `wanted` is `"<entryId>:<slotId>"` for every claim
 *  the submit carried. Pure: the slot-first form's "remove Patrick" bug
 *  (2026-08-23) was exactly this set never being computed — a removed person
 *  was simply absent from the payload, so their entry and claim survived. */
export function staleClaims(
  current: readonly { entryId: number; slotId: number }[],
  wanted: ReadonlySet<string>
): { entryId: number; slotId: number }[] {
  return current.filter((c) => !wanted.has(`${c.entryId}:${c.slotId}`));
}

/** Groups stale claims by entry so the caller can delete each entry's stale
 *  slots in one `.in('slot_id', …)` call instead of a round trip per claim
 *  (Plans/Performance-Review-2026-08-27.md #12) — a family dropping five jobs
 *  used to cost five deletes; now it costs one per person still on the party. */
export function groupStaleClaimsByEntry(
  stale: readonly { entryId: number; slotId: number }[]
): { entryId: number; slotIds: number[] }[] {
  const byEntry = new Map<number, number[]>();
  for (const c of stale) {
    const slotIds = byEntry.get(c.entryId);
    if (slotIds) slotIds.push(c.slotId);
    else byEntry.set(c.entryId, [c.slotId]);
  }
  return Array.from(byEntry.entries(), ([entryId, slotIds]) => ({ entryId, slotIds }));
}
