'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';

/*
 * Event Signup builder actions. House pattern throughout:
 *   'use server' → requireRole(['leader']) → createAdminClient() → revalidate.
 *
 * Every export must be async — this is a 'use server' module.
 */

type Result = { ok: boolean; error?: string };

function revalidateEvent(calendarEntryId: number, signupId?: number) {
  revalidatePath('/admin/events');
  if (signupId) revalidatePath(`/admin/events/${signupId}`);
  revalidatePath(`/events/${calendarEntryId}`);
  revalidatePath('/events');
}

/**
 * Category presets — the defaults a leader gets when enabling signup, never a
 * lock. Slots-carrying types default attendance OFF because claiming a job IS
 * the signup for them; a separate RSVP alongside would be duplicate entry.
 */
const PRESETS: Record<
  string,
  { attendance: boolean; drivers: boolean; slip: boolean; ahmrC: boolean; guests: boolean }
> = {
  'Campout / Overnight': { attendance: true, drivers: true, slip: true, ahmrC: false, guests: false },
  'Day Activity / Outing': { attendance: true, drivers: true, slip: true, ahmrC: false, guests: false },
  'High Adventure': { attendance: true, drivers: true, slip: true, ahmrC: true, guests: false },
  'Summer Camp': { attendance: true, drivers: true, slip: true, ahmrC: true, guests: false },
  'Service Project': { attendance: false, drivers: true, slip: true, ahmrC: false, guests: true },
  Fundraiser: { attendance: false, drivers: false, slip: false, ahmrC: false, guests: true },
  'Advancement Event': { attendance: true, drivers: true, slip: false, ahmrC: false, guests: false },
  Training: { attendance: true, drivers: false, slip: false, ahmrC: false, guests: false },
  'Ceremony / Recognition': { attendance: true, drivers: false, slip: false, ahmrC: false, guests: true },
  'Leadership / Planning': { attendance: true, drivers: false, slip: false, ahmrC: false, guests: false },
  'Recruiting / Outreach': { attendance: false, drivers: false, slip: false, ahmrC: false, guests: true },
  'Social Event': { attendance: false, drivers: false, slip: false, ahmrC: false, guests: true }
};

/** Enable signup on a calendar entry, seeded from its category preset. */
export async function enableSignup(calendarEntryId: number): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('id, category, entry_date')
    .eq('id', calendarEntryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: 'Event not found.' };

  const e = entry as unknown as { category: string; entry_date: string };
  const preset = PRESETS[e.category] ?? {
    attendance: true,
    drivers: false,
    slip: false,
    ahmrC: false,
    guests: false
  };

  // Default deadline: 5 days before the event starts.
  const start = new Date(`${e.entry_date}T21:00:00`);
  start.setDate(start.getDate() - 5);

  const { error } = await supabase.from('event_signups').insert({
    calendar_entry_id: calendarEntryId,
    deadline: start.toISOString(),
    attendance_enabled: preset.attendance,
    drivers_needed: preset.drivers,
    needs_permission_slip: preset.slip,
    needs_ahmr_c: preset.ahmrC,
    allow_guests: preset.guests
  });
  if (error) return { ok: false, error: error.message };

  revalidateEvent(calendarEntryId);
  return { ok: true };
}

export async function updateSignup(
  signupId: number,
  calendarEntryId: number,
  fields: Record<string, unknown>
): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('event_signups')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function addPrice(
  signupId: number,
  calendarEntryId: number,
  label: string,
  amount: number,
  per: 'event' | 'day',
  appliesTo: 'scouts' | 'adults' | 'both'
): Promise<Result> {
  await requireRole(['leader']);
  if (!label.trim()) return { ok: false, error: 'Give the tier a label.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('event_prices')
    .insert({ event_signup_id: signupId, label: label.trim(), amount, per, applies_to: appliesTo });
  if (error) {
    return {
      ok: false,
      error: error.message.includes('duplicate')
        ? 'A tier with that label already exists on this event.'
        : error.message
    };
  }
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Blocked by ON DELETE RESTRICT when households already picked the tier —
 *  surfaced as a clear message rather than a raw FK error. */
export async function deletePrice(
  priceId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('event_prices').delete().eq('id', priceId);
  if (error) {
    return {
      ok: false,
      error:
        'Some families have already chosen this tier, so it can’t be removed. Edit its label or amount instead.'
    };
  }
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function addSlot(
  signupId: number,
  calendarEntryId: number,
  slot: {
    kind: 'shift' | 'task';
    label: string;
    slot_date: string | null;
    starts_at: string | null;
    ends_at: string | null;
    eligibility: 'scouts' | 'adults' | 'both';
    needed: number | null;
    attendance_required: boolean;
  }
): Promise<Result> {
  await requireRole(['leader']);
  if (!slot.label.trim()) return { ok: false, error: 'Give the job a name.' };
  if (slot.kind === 'shift' && (!slot.starts_at || !slot.ends_at)) {
    return { ok: false, error: 'A shift needs both a start and an end time.' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('signup_slots').insert({
    event_signup_id: signupId,
    kind: slot.kind,
    label: slot.label.trim(),
    slot_date: slot.slot_date || null,
    starts_at: slot.kind === 'shift' ? slot.starts_at : null,
    ends_at: slot.kind === 'shift' ? slot.ends_at : null,
    eligibility: slot.eligibility,
    needed: slot.needed,
    // Shifts always require attendance (DB CHECK enforces it too).
    attendance_required: slot.kind === 'shift' ? true : slot.attendance_required
  });
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function deleteSlot(
  slotId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('signup_slots').delete().eq('id', slotId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Leader-managed ticks on the roster. */
export async function setEntryFlag(
  entryId: number,
  field: 'permission_slip_received' | 'payment_received',
  value: boolean,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({ [field]: value, updated_by: session.leader, updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/events/${signupId}/roster`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}
