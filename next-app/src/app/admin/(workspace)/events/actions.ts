'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { sendEmail, renderEmail } from '@/lib/email';
import { recipientsForScouts } from '@/lib/email-recipients';
import { siteUrl } from '@/lib/site-url';

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
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function addQuestion(
  signupId: number,
  calendarEntryId: number,
  q: {
    prompt: string;
    input_type: 'text' | 'number' | 'choice';
    choices: string[];
    applies_to: 'scouts' | 'adults' | 'both';
    required: boolean;
  }
): Promise<Result> {
  await requireRole(['leader']);
  if (!q.prompt.trim()) return { ok: false, error: 'Give the question a prompt.' };
  if (q.input_type === 'choice' && q.choices.length === 0) {
    return { ok: false, error: 'A choice question needs at least one option.' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('signup_questions').insert({
    event_signup_id: signupId,
    prompt: q.prompt.trim(),
    input_type: q.input_type,
    // The DB CHECK requires choices exactly when the type is 'choice'.
    choices: q.input_type === 'choice' ? q.choices : null,
    applies_to: q.applies_to,
    required: q.required
  });
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function deleteQuestion(
  questionId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('signup_questions').delete().eq('id', questionId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Email the families who haven't responded yet.
 *
 * Deliberately leader-triggered and DRY-RUN by default: `confirm` must be
 * true to actually dispatch. Nothing in this feature ever mails a family
 * automatically — a signup form that quietly emails 25 households the first
 * time it's exercised is not something you can take back.
 */
export async function emailNonResponders(
  signupId: number,
  confirm: boolean
): Promise<{ ok: boolean; error?: string; status?: string; to?: string[] }> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: signup } = await supabase
    .from('event_signups')
    .select('id, calendar_entry_id, deadline')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return { ok: false, error: 'Signup not found.' };
  const sig = signup as unknown as { calendar_entry_id: number; deadline: string };

  const [{ data: entry }, { data: entries }, { data: scouts }] = await Promise.all([
    supabase.from('calendar_entries').select('id, title').eq('id', sig.calendar_entry_id).maybeSingle(),
    supabase.from('signup_entries').select('scout_id').eq('event_signup_id', signupId).neq('status', 'cancelled'),
    supabase.from('scouts').select('id').eq('active', true)
  ]);

  const responded = new Set(
    ((entries ?? []) as { scout_id: string | null }[]).map((e) => e.scout_id).filter(Boolean) as string[]
  );
  const missing = ((scouts ?? []) as { id: string }[]).map((s) => s.id).filter((id) => !responded.has(id));

  const recipients = await recipientsForScouts(missing);
  const title = String((entry as { title?: string } | null)?.title ?? 'an upcoming event');
  const deadline = new Date(sig.deadline).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const { html, text } = renderEmail({
    heading: `We haven't heard from you about ${title}`,
    intro:
      `We're finalising numbers for ${title} and don't have an answer from your family yet. ` +
      `Even a "can't make it" helps — it tells the planners who not to wait for.`,
    bullets: [`Signups close ${deadline}.`],
    actionUrl: `${siteUrl()}/events/${sig.calendar_entry_id}`,
    actionLabel: 'Sign up or decline',
    outro: 'If you have already replied, thank you — please ignore this.'
  });

  const res = await sendEmail({
    to: recipients.map((r) => r.email),
    subject: `Troop 79 — are you coming to ${title}?`,
    html,
    text,
    confirm
  });

  return { ok: res.status !== 'error', error: res.detail, status: res.status, to: res.to };
}

/** Edit an existing job in place. Keeps the row identity, so any claims
 *  families have already made on it survive a rename or a time change —
 *  delete-and-recreate would silently drop them. */
export async function updateSlot(
  slotId: number,
  signupId: number,
  calendarEntryId: number,
  slot: {
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

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('signup_slots')
    .select('kind')
    .eq('id', slotId)
    .maybeSingle();
  const kind = (existing as { kind?: string } | null)?.kind;
  if (!kind) return { ok: false, error: 'Job not found.' };

  if (kind === 'shift' && (!slot.starts_at || !slot.ends_at)) {
    return { ok: false, error: 'A shift needs both a start and an end time.' };
  }

  // Don't let a job shrink below what people have already claimed — the
  // coverage numbers would read as over-full and someone would get bumped.
  if (slot.needed != null) {
    const { data: claimed } = await supabase
      .from('signup_slot_claims')
      .select('signup_entry_id, signup_entries!inner(status)')
      .eq('slot_id', slotId)
      .eq('signup_entries.status', 'yes');
    const taken = (claimed ?? []).length;
    if (slot.needed < taken) {
      return {
        ok: false,
        error: `${taken} ${taken === 1 ? 'person has' : 'people have'} already claimed this job, so it can't be set below ${taken}.`
      };
    }
  }

  const { error } = await supabase
    .from('signup_slots')
    .update({
      label: slot.label.trim(),
      slot_date: slot.slot_date || null,
      starts_at: kind === 'shift' ? slot.starts_at : null,
      ends_at: kind === 'shift' ? slot.ends_at : null,
      eligibility: slot.eligibility,
      needed: slot.needed,
      attendance_required: kind === 'shift' ? true : slot.attendance_required
    })
    .eq('id', slotId);
  if (error) return { ok: false, error: error.message };

  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Edit a price tier in place — same reasoning as updateSlot: entries point at
 *  price_id, so recreating the tier would orphan the owed math. */
export async function updatePrice(
  priceId: number,
  signupId: number,
  calendarEntryId: number,
  fields: { label: string; amount: number; per: 'event' | 'day'; applies_to: 'scouts' | 'adults' | 'both' }
): Promise<Result> {
  await requireRole(['leader']);
  if (!fields.label.trim()) return { ok: false, error: 'Give the tier a label.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('event_prices')
    .update({ ...fields, label: fields.label.trim() })
    .eq('id', priceId);
  if (error) {
    return {
      ok: false,
      error: error.message.includes('duplicate')
        ? 'Another tier on this event already uses that label.'
        : error.message
    };
  }
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Remove one person from an event on their behalf.
 *
 * Families call or email to cancel and won't always go back to the form, so a
 * leader needs to be able to do it for them.
 *
 * Soft-cancel, not delete: status='cancelled' keeps the audit trail (who
 * removed whom, and when) and is what every coverage count already filters
 * on, so their slot claims and seat release immediately without destroying
 * the record. It also means an accidental removal can be undone.
 *
 * Frees a seat, so the waitlist gets a chance to move in the same breath.
 */
export async function cancelEntry(
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireRole(['leader']);
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('signup_entries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_by: session.leader,
      updated_at: new Date().toISOString()
    })
    .eq('id', entryId);
  if (error) return { ok: false, error: error.message };

  const { error: promoteErr } = await supabase.rpc('promote_waitlist', {
    p_event_signup_id: signupId
  });
  if (promoteErr) return { ok: false, error: promoteErr.message };

  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Undo a removal — puts the person back, subject to capacity (they may land
 *  on the waitlist if the seat has since been taken). */
export async function restoreEntry(
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: sig } = await supabase
    .from('event_signups')
    .select('capacity, waitlist_enabled')
    .eq('id', signupId)
    .maybeSingle();
  const s = sig as unknown as { capacity: number | null; waitlist_enabled: boolean } | null;

  let status = 'yes';
  if (s?.capacity != null) {
    const { data: used } = await supabase.rpc('event_signup_headcount', {
      p_event_signup_id: signupId
    });
    const head = typeof used === 'number' ? used : 0;
    if (head >= s.capacity) {
      if (!s.waitlist_enabled) {
        return { ok: false, error: 'The event is full and has no waitlist, so they can’t be added back.' };
      }
      status = 'waitlist';
    }
  }

  const { error } = await supabase
    .from('signup_entries')
    .update({
      status,
      cancelled_at: null,
      updated_by: session.leader,
      updated_at: new Date().toISOString()
    })
    .eq('id', entryId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Turn signup off for an event entirely — for one enabled by mistake, or on a
 * planning entry that never needed one.
 *
 * DESTRUCTIVE: removes the signup and everything hanging off it (jobs, price
 * tiers, questions, and any entries families already submitted). Requires
 * `confirm` once anyone has signed up, and reports the count so the leader
 * finds out BEFORE agreeing rather than after.
 *
 * Deletes in explicit order rather than leaning on the cascade: signup_entries
 * references event_prices with ON DELETE RESTRICT, so removing the parent can
 * try to drop a price while an entry still points at it and fail with a raw FK
 * error. Clearing entries first makes the rest a clean cascade.
 */
export async function disableSignup(
  signupId: number,
  calendarEntryId: number,
  confirm: boolean
): Promise<Result & { entryCount?: number; needsConfirm?: boolean }> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: entries } = await supabase
    .from('signup_entries')
    .select('id')
    .eq('event_signup_id', signupId)
    .neq('status', 'cancelled');
  const entryCount = (entries ?? []).length;

  if (entryCount > 0 && !confirm) {
    return {
      ok: false,
      needsConfirm: true,
      entryCount,
      error: `${entryCount} ${entryCount === 1 ? 'person has' : 'people have'} already signed up. Removing the signup deletes their entries too — this can't be undone.`
    };
  }

  // Entries first (takes their claims and answers with them), then the parent.
  const { error: entryErr } = await supabase
    .from('signup_entries')
    .delete()
    .eq('event_signup_id', signupId);
  if (entryErr) return { ok: false, error: entryErr.message };

  const { error } = await supabase.from('event_signups').delete().eq('id', signupId);
  if (error) return { ok: false, error: error.message };

  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, entryCount };
}
