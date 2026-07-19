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

import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarEntry } from '@/lib/supabase/types';

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
}

export interface EventDetail {
  entry: CalendarEntry;
  resources: EventResource[];
  /** Null when signup isn't enabled on this event — the page is content-only. */
  signup: EventSignup | null;
  prices: EventPrice[];
  slots: SignupSlot[];
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
  scout_id: string | null;
  scout_parent_id: number | null;
  adult_name: string | null;
  status: 'yes' | 'no' | 'waitlist' | 'cancelled';
  participation: 'full' | 'driver_only' | 'contributor';
  price_id: number | null;
  days: number | null;
  guest_count: number;
  guest_note: string | null;
  notes: string | null;
  permission_slip_received: boolean;
  payment_received: boolean;
  /** slot ids this entry currently holds. */
  claims: number[];
}

/**
 * One household's live entries for an event. GATE-ONLY — this returns names
 * and must never be rendered without a passing family/leader check.
 */
export async function loadHouseholdSignup(
  eventSignupId: number,
  householdScoutId: string
): Promise<HouseholdEntry[]> {
  const supabase = createAdminClient();
  const { data: entries } = await supabase
    .from('signup_entries')
    .select(
      'id, person_kind, scout_id, scout_parent_id, adult_name, status, participation, ' +
        'price_id, days, guest_count, guest_note, notes, permission_slip_received, payment_received'
    )
    .eq('event_signup_id', eventSignupId)
    .eq('household_scout_id', householdScoutId)
    .neq('status', 'cancelled');

  const rows = (entries ?? []) as unknown as Omit<HouseholdEntry, 'claims'>[];
  if (rows.length === 0) return [];

  const { data: claims } = await supabase
    .from('signup_slot_claims')
    .select('slot_id, signup_entry_id')
    .in(
      'signup_entry_id',
      rows.map((r) => r.id)
    );

  const byEntry = new Map<number, number[]>();
  for (const c of (claims ?? []) as { slot_id: number; signup_entry_id: number }[]) {
    byEntry.set(c.signup_entry_id, [...(byEntry.get(c.signup_entry_id) ?? []), c.slot_id]);
  }
  return rows.map((r) => ({ ...r, claims: byEntry.get(r.id) ?? [] }));
}

export async function loadEventDetail(entryId: number): Promise<EventDetail | null> {
  const supabase = createAdminClient();

  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();
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
        'notes_prompt, guest_prompt'
    )
    .eq('calendar_entry_id', entryId)
    .maybeSingle();

  const base: EventDetail = {
    entry: entry as CalendarEntry,
    resources: (resources ?? []) as EventResource[],
    signup: (signup ?? null) as EventSignup | null,
    prices: [],
    slots: [],
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
        'id, kind, label, slot_date, starts_at, ends_at, attendance_required, eligibility, needed, sort'
      )
      .eq('event_signup_id', sig.id)
      .order('slot_date', { ascending: true })
      .order('sort', { ascending: true }),
    supabase.rpc('event_signup_headcount', { p_event_signup_id: sig.id })
  ]);

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
    headcount: typeof headcount === 'number' ? headcount : 0
  };
}
