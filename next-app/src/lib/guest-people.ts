import { GUEST_CLASSES, type GuestClass } from '@/lib/participant-class';

/**
 * People → Guests tab (Plans/Guests-As-People.md Phase 2) — the pure half.
 *
 * A guest is a `people` row with guest_host_household_id set: brought by a
 * household, hidden from the directory and every picker, and kept only so
 * Grandma is the same person across events. This module shapes the tab's
 * rows from raw table reads and decides the retention nudge; the page does
 * the reads, guest-actions.ts does the writes.
 */

export interface GuestPersonRow {
  id: number;
  display_name: string;
  primary_phone: string | null;
  guest_host_household_id: number;
  created_at: string;
}

export interface GuestEntryRow {
  id: number;
  person_id: number;
  participant_class: string;
  event_signup_id: number;
}

export interface GuestSignupRow {
  id: number;
  calendar_entry_id: number;
}

export interface GuestEventRow {
  id: number;
  title: string;
  entry_date: string;
}

export interface GuestTabRow {
  personId: number;
  name: string;
  hostHouseholdId: number;
  hostLabel: string;
  /** Their class on the most recent sign-up, null if they never signed up. */
  lastClass: GuestClass | null;
  lastEventTitle: string | null;
  lastEventDate: string | null;
  /** Adult guests only — a youth guest never shows contact info (qa-lead). */
  phone: string | null;
  /** "No sign-up in 12 months — forget?" A prompt, never an automatic delete. */
  forgetNudge: boolean;
}

/** Months between two yyyy-mm-dd dates, floored; negative when b < a. */
function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  let months = (by - ay) * 12 + (bm - am);
  if (bd < ad) months -= 1;
  return months;
}

/**
 * The retention nudge (qa-lead, 2026-08-23): a guest with no sign-up in the
 * last 12 months — counting from their last event date, or from the day they
 * were added if they never signed up — is flagged "forget?". A nudge only.
 */
export function guestNeedsForgetNudge(
  lastEventDate: string | null,
  createdOn: string,
  today: string
): boolean {
  const since = lastEventDate ?? createdOn;
  return monthsBetween(since, today) >= 12;
}

/**
 * Shape the Guests tab rows: one per guest person, joined to their most
 * recent entry's class and event (entries are expected newest-first by id),
 * the host household's label, and the nudge. Pure.
 */
export function buildGuestTabRows(input: {
  people: readonly GuestPersonRow[];
  entries: readonly GuestEntryRow[];
  signups: readonly GuestSignupRow[];
  events: readonly GuestEventRow[];
  householdLabels: ReadonlyMap<number, string>;
  today: string;
}): GuestTabRow[] {
  const signupById = new Map(input.signups.map((s) => [s.id, s]));
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  // Newest entry per person: highest signup_entries.id wins.
  const latest = new Map<number, GuestEntryRow>();
  for (const e of input.entries) {
    const cur = latest.get(e.person_id);
    if (!cur || e.id > cur.id) latest.set(e.person_id, e);
  }
  // Most recent EVENT DATE per person (the newest row is not always the
  // latest-dated event — a leader can add someone to last month's roster).
  const lastDate = new Map<number, { date: string; title: string }>();
  for (const e of input.entries) {
    const ev = eventById.get(signupById.get(e.event_signup_id)?.calendar_entry_id ?? -1);
    if (!ev) continue;
    const cur = lastDate.get(e.person_id);
    if (!cur || ev.entry_date > cur.date) lastDate.set(e.person_id, { date: ev.entry_date, title: ev.title });
  }
  return input.people.map((p) => {
    const last = latest.get(p.id);
    const cls =
      last && (GUEST_CLASSES as readonly string[]).includes(last.participant_class)
        ? (last.participant_class as GuestClass)
        : null;
    const ev = lastDate.get(p.id) ?? null;
    return {
      personId: p.id,
      name: p.display_name,
      hostHouseholdId: p.guest_host_household_id,
      hostLabel: input.householdLabels.get(p.guest_host_household_id) ?? '—',
      lastClass: cls,
      lastEventTitle: ev?.title ?? null,
      lastEventDate: ev?.date ?? null,
      phone: cls === 'adult_guest' ? p.primary_phone : null,
      forgetNudge: guestNeedsForgetNudge(ev?.date ?? null, p.created_at.slice(0, 10), input.today)
    };
  });
}
