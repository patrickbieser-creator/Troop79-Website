'use server';

import { isParticipantClass, personKindFor, GUEST_CLASSES, type ParticipantClass } from '@/lib/participant-class';
import { guestModePresetFor } from '@/lib/guest-mode';
import { isGuestMode, loadHouseholdGuests, type HouseholdGuest } from '@/lib/event-signup';
import { revalidatePath } from 'next/cache';
import { eventRevalidatePaths } from '@/lib/event-signup-shared';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { isRideStatus } from '@/lib/transport';
import { isValidJobCode, normalizeJobCode, JOB_CODE_MAX } from '@/lib/job-codes';
import { normalizeGroupName, normalizeSetLabel, validateNewSet } from '@/lib/group-sets';
import { sendEmail, renderEmail } from '@/lib/email';
import { recipientsForScouts } from '@/lib/email-recipients';
import { siteUrl } from '@/lib/site-url';
import { loadSiteText, reminderEmailCopy, paymentReminderEmailCopy } from '@/lib/site-text';
import { fmtDateTime } from '@/lib/format-date';
import {
  backfillEventPrices,
  slotClaimants,
  questionAnswers,
  type BackfillPricesResult,
  type SlotClaimant,
  type QuestionAnswerRow, signupEntryInsertRow,
  permanentDeleteGuard
} from '@/lib/event-signup-admin';

/*
 * Event Signup builder actions. House pattern throughout:
 *   'use server' → requireCapability('calendar.write') → createAdminClient() → revalidate.
 *
 * Every export must be async — this is a 'use server' module.
 */

type Result = { ok: boolean; error?: string };

function revalidateEvent(calendarEntryId: number, signupId?: number) {
  // The list lives in lib/event-signup so it can be tested — it silently
  // omitted the public signup form until 2026-08-22.
  for (const p of eventRevalidatePaths(calendarEntryId, signupId)) revalidatePath(p);
}

/**
 * Category presets — the defaults a leader gets when enabling signup, never a
 * lock. Slots-carrying types default attendance OFF because claiming a job IS
 * the signup for them; a separate RSVP alongside would be duplicate entry.
 */
const PRESETS: Record<
  string,
  { attendance: boolean; drivers: boolean; slip: boolean; ahmrC: boolean }
> = {
  'Campout / Overnight': { attendance: true, drivers: true, slip: true, ahmrC: false },
  'Day Activity / Outing': { attendance: true, drivers: true, slip: true, ahmrC: false },
  'High Adventure': { attendance: true, drivers: true, slip: true, ahmrC: true },
  'Summer Camp': { attendance: true, drivers: true, slip: true, ahmrC: true },
  'Service Project': { attendance: false, drivers: true, slip: true, ahmrC: false },
  Fundraiser: { attendance: false, drivers: false, slip: false, ahmrC: false },
  'Advancement Event': { attendance: true, drivers: true, slip: false, ahmrC: false },
  Training: { attendance: true, drivers: false, slip: false, ahmrC: false },
  'Ceremony / Recognition': { attendance: true, drivers: false, slip: false, ahmrC: false },
  'Leadership / Planning': { attendance: true, drivers: false, slip: false, ahmrC: false },
  'Recruiting / Outreach': { attendance: false, drivers: false, slip: false, ahmrC: false },
  'Social Event': { attendance: false, drivers: false, slip: false, ahmrC: false }
};
// Guest mode (none / count / named) is its own preset table —
// lib/guest-mode guestModePresetFor — so it can be tested without this
// 'use server' module (Plans/Guests-As-People.md).

/** Enable signup on a calendar entry, seeded from its category preset. */
export async function enableSignup(calendarEntryId: number): Promise<Result> {
  await requireCapability('calendar.write');
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
    ahmrC: false
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
    // allow_guests follows by trigger (one release); guest_mode is the truth.
    guest_mode: guestModePresetFor(e.category)
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
  await requireCapability('calendar.write');
  if ('guest_mode' in fields && !isGuestMode(fields.guest_mode)) {
    return { ok: false, error: 'Guest mode must be none, count or named.' };
  }
  if ('guest_prompt' in fields && fields.guest_prompt != null) {
    const prompt = String(fields.guest_prompt).trim();
    if (prompt.length > 200) return { ok: false, error: 'Keep the guest prompt under 200 characters.' };
    fields = { ...fields, guest_prompt: prompt || null };
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('event_signups')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Human-readable summary of a backfill pass, or null if there's nothing
 *  worth telling the leader (no un-priced entries existed at all). */
function backfillNote(r: BackfillPricesResult): string | undefined {
  const skipped = r.skippedAmbiguous + r.skippedPerDay;
  if (r.applied === 0 && skipped === 0) return undefined;
  const parts = [`Priced ${r.applied} existing ${r.applied === 1 ? 'entry' : 'entries'} automatically.`];
  if (skipped > 0) {
    parts.push(
      `${skipped} ${skipped === 1 ? 'entry needs' : 'entries need'} a tier assigned by hand ` +
        `(${r.skippedAmbiguous > 0 ? 'more than one tier could apply' : ''}` +
        `${r.skippedAmbiguous > 0 && r.skippedPerDay > 0 ? '; ' : ''}` +
        `${r.skippedPerDay > 0 ? 'per-day pricing has no stored day count for them' : ''}).`
    );
  }
  return parts.join(' ');
}

export async function addPrice(
  signupId: number,
  calendarEntryId: number,
  label: string,
  amount: number,
  per: 'event' | 'day',
  appliesTo: 'scouts' | 'adults' | 'both'
): Promise<Result & { note?: string }> {
  await requireCapability('calendar.write');
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
  // Retroactively price any existing un-priced entry wherever the choice is
  // unambiguous — a tier added after families already signed up shouldn't
  // require every one of them to reopen the form just to get priced.
  const backfill = await backfillEventPrices(supabase, signupId);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, note: backfillNote(backfill) };
}

/** Tier deletion stays a hard block when any entry has already chosen it —
 *  deliberately NOT loosened to warn-then-allow. Unlike slots/questions,
 *  removing a tier a family is relying on erases what they agreed to pay,
 *  silently reverting their "owed" to $0. Editing (updatePrice below) is the
 *  supported way to change a tier that's in use — it's non-destructive since
 *  every entry's amount is derived live from the tier row, never stored. */
export async function deletePrice(
  priceId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
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

/** Manual one-time trigger for the Builder's "Apply to existing entries"
 *  button — the same backfill addPrice/updatePrice run automatically, but
 *  callable directly for a tier that already existed before this logic
 *  shipped (or after a leader fixes an ambiguous/per-day case by hand and
 *  wants to re-check the rest). */
export async function backfillPrices(
  signupId: number,
  calendarEntryId: number
): Promise<Result & { note?: string }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const backfill = await backfillEventPrices(supabase, signupId);
  revalidateEvent(calendarEntryId, signupId);
  return {
    ok: true,
    note: backfillNote(backfill) ?? 'Nothing to backfill — every entry already has a tier, or none apply.'
  };
}

export async function addSlot(
  signupId: number,
  calendarEntryId: number,
  slot: {
    kind: 'shift' | 'task';
    label: string;
    description: string | null;
    slot_date: string | null;
    starts_at: string | null;
    ends_at: string | null;
    eligibility: 'scouts' | 'adults' | 'both';
    needed: number | null;
    attendance_required: boolean;
    /** Roster column code (1–5 letters/digits, unique per event); blank →
     *  derived from the label at display time (src/lib/job-codes.ts). */
    code?: string | null;
  }
): Promise<Result> {
  await requireCapability('calendar.write');
  if (!slot.label.trim()) return { ok: false, error: 'Give the job a name.' };
  if (slot.kind === 'shift' && (!slot.starts_at || !slot.ends_at)) {
    return { ok: false, error: 'A shift needs both a start and an end time.' };
  }
  const code = normalizeJobCode(slot.code);
  if (code && !isValidJobCode(code)) return { ok: false, error: jobCodeRule() };
  const supabase = createAdminClient();
  const { error } = await supabase.from('signup_slots').insert({
    event_signup_id: signupId,
    kind: slot.kind,
    label: slot.label.trim(),
    code,
    description: slot.description?.trim() || null,
    slot_date: slot.slot_date || null,
    starts_at: slot.kind === 'shift' ? slot.starts_at : null,
    ends_at: slot.kind === 'shift' ? slot.ends_at : null,
    eligibility: slot.eligibility,
    needed: slot.needed,
    // Shifts always require attendance (DB CHECK enforces it too).
    attendance_required: slot.kind === 'shift' ? true : slot.attendance_required
  });
  if (error) return { ok: false, error: jobCodeError(error, code) ?? error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** The code rule in words, for both slot actions. */
function jobCodeRule(): string {
  return `A job code is 1–${JOB_CODE_MAX} letters or digits (e.g. SET, CASH, TRK).`;
}

/** signup_slots_code_uniq (unique per event, case-insensitive) → a sentence;
 *  anything else → null so the caller falls back to the raw message. */
function jobCodeError(error: { code?: string; message: string }, code: string | null): string | null {
  if (error.code === '23505' && code && /signup_slots_code_uniq/.test(error.message)) {
    return `Another job on this event already uses the code ${code}. Pick a different one.`;
  }
  return null;
}

/** Deleting a claimed slot cascades away every claim on it (signup_slot_claims
 *  ON DELETE CASCADE). Editing a job (updateSlot) is the normal, expected way
 *  to change one and needs no warning; deleting it is destructive to anyone
 *  who's already claimed it, so a first call with confirm=false reports
 *  exactly who's affected instead of deleting outright — the leader decides
 *  whether to proceed and go tell them. Skips the warning entirely when
 *  nobody's claimed it, since nothing would be lost. */
export async function deleteSlot(
  slotId: number,
  signupId: number,
  calendarEntryId: number,
  confirm = false
): Promise<Result & { needsConfirm?: boolean; claimants?: SlotClaimant[] }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();

  if (!confirm) {
    const claimants = await slotClaimants(supabase, slotId);
    if (claimants.length > 0) {
      return {
        ok: false,
        needsConfirm: true,
        claimants,
        error: `${claimants.length} ${claimants.length === 1 ? 'person has' : 'people have'} claimed this job. Removing it drops their claim — let them know a change was made.`
      };
    }
  }

  const { error } = await supabase.from('signup_slots').delete().eq('id', slotId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Leader-managed ticks on the roster. (payment_received is gone — payments
 *  are transactions and "paid" is derived; Plans/Event-Logistics.md §C.) */
export async function setEntryFlag(
  entryId: number,
  field: 'permission_slip_received',
  value: boolean,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({ [field]: value, updated_by: session.label, updated_at: new Date().toISOString() })
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
    /** Leader-managed roster column (Plans/Event-Logistics.md §D): never on
     *  the family form, never required of a family. */
    leader_only?: boolean;
    /** Free-text leader columns print on the snapshot/CSV only when true. */
    print_allowed?: boolean;
  }
): Promise<Result> {
  await requireCapability('calendar.write');
  if (!q.prompt.trim()) return { ok: false, error: 'Give the question a prompt.' };
  if (q.input_type === 'choice' && q.choices.length === 0) {
    return { ok: false, error: 'A choice question needs at least one option.' };
  }
  const supabase = createAdminClient();
  const leaderOnly = q.leader_only === true;
  const { error } = await supabase.from('signup_questions').insert({
    event_signup_id: signupId,
    prompt: q.prompt.trim(),
    input_type: q.input_type,
    // The DB CHECK requires choices exactly when the type is 'choice'.
    choices: q.input_type === 'choice' ? q.choices : null,
    applies_to: q.applies_to,
    required: leaderOnly ? false : q.required,
    leader_only: leaderOnly,
    print_allowed: leaderOnly && q.input_type === 'text' ? q.print_allowed === true : true
  });
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Flip whether a free-text leader column prints (snapshot / CSV). */
export async function setQuestionPrintAllowed(
  questionId: number,
  printAllowed: boolean,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_questions')
    .update({ print_allowed: printAllowed })
    .eq('id', questionId)
    .eq('event_signup_id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** A leader fills (or clears) a leader-only column for one person — the
 *  roster's editable cells. Family questions are NOT writable here; the
 *  family form owns those. */
export async function setLeaderAnswer(
  entryId: number,
  questionId: number,
  value: string | null,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: q } = await supabase
    .from('signup_questions')
    .select('id, leader_only, input_type, choices')
    .eq('id', questionId)
    .eq('event_signup_id', signupId)
    .maybeSingle();
  const question = q as { id: number; leader_only: boolean; input_type: string; choices: string[] | null } | null;
  if (!question) return { ok: false, error: 'That column is not on this signup.' };
  if (!question.leader_only) return { ok: false, error: 'Only leader-only columns are edited here.' };
  const v = value?.trim() ?? '';
  if (!v) {
    const { error } = await supabase.from('signup_answers').delete().eq('signup_entry_id', entryId).eq('question_id', questionId);
    if (error) return { ok: false, error: error.message };
  } else {
    if (question.input_type === 'choice' && !(question.choices ?? []).includes(v)) {
      return { ok: false, error: 'That is not one of the column’s options.' };
    }
    if (question.input_type === 'number' && !/^-?[0-9]+(\.[0-9]+)?$/.test(v)) {
      return { ok: false, error: 'That column expects a number.' };
    }
    const { error } = await supabase
      .from('signup_answers')
      .upsert({ signup_entry_id: entryId, question_id: questionId, value: v.slice(0, 300) }, { onConflict: 'signup_entry_id,question_id' });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/snapshot/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Deleting a question cascades away every recorded answer to it
 *  (signup_answers ON DELETE CASCADE). Same pattern as deleteSlot: a first
 *  call with confirm=false reports the actual data that would be destroyed
 *  (who answered, and what) rather than guessing a count is enough — a
 *  leader deciding whether "10.5" or "Vegetarian" is worth losing needs to
 *  see it, not just a number. Skips the warning when nobody's answered yet. */
export async function deleteQuestion(
  questionId: number,
  signupId: number,
  calendarEntryId: number,
  confirm = false
): Promise<Result & { needsConfirm?: boolean; answers?: QuestionAnswerRow[] }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();

  if (!confirm) {
    const answers = await questionAnswers(supabase, questionId);
    if (answers.length > 0) {
      return {
        ok: false,
        needsConfirm: true,
        answers,
        error: `${answers.length} ${answers.length === 1 ? 'answer has' : 'answers have'} already been submitted for this question. Removing it deletes them — this can't be undone.`
      };
    }
  }

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
  await requireCapability('calendar.write');
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
  // Central, said so: the server clock is UTC and the reader may be anywhere.
  const deadline = fmtDateTime(sig.deadline, { zone: true });

  // Copy is editable in Lookups & Admin → "Event reminder email"
  // (lib/site-text; blank = the built-in default). {title}/{deadline} are
  // filled here.
  const copy = reminderEmailCopy(await loadSiteText(supabase), { title, deadline });
  const { html, text } = renderEmail({
    heading: copy.heading,
    intro: copy.intro,
    bullets: [copy.bullet],
    actionUrl: `${siteUrl()}/events/${sig.calendar_entry_id}`,
    actionLabel: copy.actionLabel,
    outro: copy.outro
  });

  const res = await sendEmail({
    to: recipients.map((r) => r.email),
    subject: copy.subject,
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
    description: string | null;
    slot_date: string | null;
    starts_at: string | null;
    ends_at: string | null;
    eligibility: 'scouts' | 'adults' | 'both';
    needed: number | null;
    attendance_required: boolean;
    code?: string | null;
  }
): Promise<Result> {
  await requireCapability('calendar.write');
  if (!slot.label.trim()) return { ok: false, error: 'Give the job a name.' };
  const code = normalizeJobCode(slot.code);
  if (code && !isValidJobCode(code)) return { ok: false, error: jobCodeRule() };

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
      code,
      description: slot.description?.trim() || null,
      slot_date: slot.slot_date || null,
      starts_at: kind === 'shift' ? slot.starts_at : null,
      ends_at: kind === 'shift' ? slot.ends_at : null,
      eligibility: slot.eligibility,
      needed: slot.needed,
      attendance_required: kind === 'shift' ? true : slot.attendance_required
    })
    .eq('id', slotId);
  if (error) return { ok: false, error: jobCodeError(error, code) ?? error.message };

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
): Promise<Result & { note?: string }> {
  await requireCapability('calendar.write');
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
  // An applies_to change can newly make a kind's tier choice unambiguous
  // (e.g. widening "Scouts" to "Everyone") — re-check the same way addPrice
  // does. Amount/per/label-only edits are non-destructive on their own since
  // owed is always derived live; this backfill only ever fills gaps, never
  // overwrites an entry that already has a price_id.
  const backfill = await backfillEventPrices(supabase, signupId);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, note: backfillNote(backfill) };
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
  const session = await requireCapability('calendar.write');
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('signup_entries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_by: session.label,
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
  const session = await requireCapability('calendar.write');
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
      updated_by: session.label,
      updated_at: new Date().toISOString()
    })
    .eq('id', entryId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Permanently delete a roster row that is already Removed (Patrick,
 * 2026-08-23: "so the record is permanently removed from the database").
 * Remove stays the soft, undoable step; this is the hard one behind it, for a
 * duplicate or a mistaken signup that should leave no trace. Guarded: only
 * status 'cancelled', and never while a ledger row points at it (the FK has
 * no ON DELETE — the database would refuse; the guard says why in words).
 * Claims, answers, group memberships and hosted guest rows cascade.
 */
export async function deleteEntryPermanently(
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();

  const { data: entry } = await supabase
    .from('signup_entries')
    .select('id, status, event_signup_id')
    .eq('id', entryId)
    .maybeSingle();
  const row = entry as { id: number; status: string; event_signup_id: number } | null;
  if (!row || row.event_signup_id !== signupId) return { ok: false, error: 'Entry not found.' };

  const [{ count: ledgerRows }, { count: hostedGuests }, { count: carsDriven }] = await Promise.all([
    supabase.from('financial_transactions').select('id', { count: 'exact', head: true }).eq('signup_entry_id', entryId),
    supabase.from('signup_entries').select('id', { count: 'exact', head: true }).eq('host_entry_id', entryId),
    supabase.from('signup_groups').select('id', { count: 'exact', head: true }).eq('driver_entry_id', entryId)
  ]);
  const guard = permanentDeleteGuard({
    status: row.status,
    ledgerRows: ledgerRows ?? 0,
    hostedGuests: hostedGuests ?? 0,
    carsDriven: carsDriven ?? 0
  });
  if (!guard.ok) return guard;

  const { error } = await supabase.from('signup_entries').delete().eq('id', entryId);
  if (error) {
    return {
      ok: false,
      error: error.code === '23503' ? 'Something else still references this row, so it cannot be deleted. Leave it as Removed.' : error.message
    };
  }

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
  await requireCapability('calendar.write');
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

/**
 * Add a person to a signup by hand.
 *
 * The gap this closes: `cancelEntry` above could REMOVE someone, but nothing
 * could add them. Signups do not all arrive through the website — plenty come
 * verbally or by email, and some people simply turn up — so a leader could
 * correct a roster downward and never upward.
 *
 * Deliberately NOT routed through `submit_household_signup`: that RPC is the
 * family-facing path and enforces household membership, payment and capacity
 * rules appropriate to self-service. A leader adding a known attendee after the
 * fact is a different act, so this writes the entry directly and then runs the
 * same waitlist promotion the cancel path does, keeping capacity honest.
 */
export async function addSignupEntry(
  signupId: number,
  calendarEntryId: number,
  personId: number,
  participation: 'full' | 'driver_only' | 'contributor' = 'full'
): Promise<Result> {
  const session = await requireCapability('calendar.write');
  const supabase = createAdminClient();

  const { data: person } = await supabase
    .from('people')
    .select('id, display_name')
    .eq('id', personId)
    .maybeSingle();
  if (!person) return { ok: false, error: 'That person is not in the directory.' };

  /*
   * person_kind and scout_id are still read by screens that have not migrated
   * to person_id — pricing eligibility (`applies_to`), rosters, headcounts. An
   * earlier draft hardcoded 'adult' for everyone, which would have silently
   * mispriced and miscounted any scout a leader added by hand. Resolve it from
   * the spine instead of guessing.
   */
  const { data: scout } = await supabase
    .from('scouts')
    .select('id')
    .eq('person_id', personId)
    .maybeSingle();
  const isScout = scout != null;

  /*
   * Capacity is enforced the same way restoreEntry enforces it. A leader adding
   * someone by hand is still adding a body to a capped event; skipping the
   * check would let the manual path overfill an event the family-facing path
   * protects.
   */
  const { data: sig } = await supabase
    .from('event_signups')
    .select('capacity, waitlist_enabled')
    .eq('id', signupId)
    .maybeSingle();
  const cap = sig as unknown as { capacity: number | null; waitlist_enabled: boolean } | null;

  let status = 'yes';
  if (cap?.capacity != null) {
    const { data: used } = await supabase.rpc('event_signup_headcount', {
      p_event_signup_id: signupId
    });
    const head = typeof used === 'number' ? used : 0;
    if (head >= cap.capacity) {
      if (!cap.waitlist_enabled) {
        return { ok: false, error: 'The event is full and has no waitlist.' };
      }
      status = 'waitlist';
    }
  }

  // Someone previously removed is REINSTATED rather than duplicated — a person
  // must never hold two entries for one event (the D-048 dual-identity lesson).
  const { data: existing } = await supabase
    .from('signup_entries')
    .select('id, status')
    .eq('event_signup_id', signupId)
    .eq('person_id', personId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'yes') return { ok: false, error: 'They are already on this roster.' };
    const { error } = await supabase
      .from('signup_entries')
      .update({
        status,
        cancelled_at: null,
        participation,
        updated_by: session.label,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    // Payload is a tested pure builder (lib/event-signup-admin) — the
    // scout_id/adult_name columns this used to write were dropped 2026-08-15
    // and every Add failed on the schema cache until 2026-08-21.
    const { error } = await supabase.from('signup_entries').insert(
      signupEntryInsertRow({
        signupId,
        personId,
        isScout,
        status: status as 'yes' | 'waitlist',
        participation,
        updatedBy: session.label
      })
    );
    if (error) return { ok: false, error: error.message };
  }

  const { error: promoteErr } = await supabase.rpc('promote_waitlist', {
    p_event_signup_id: signupId
  });
  if (promoteErr) return { ok: false, error: promoteErr.message };

  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Claim a job for someone else — the verbal "I'll bring a table" that never
 * reached the website. Same reasoning as addSignupEntry: leaders could unclaim
 * but not claim.
 */
export async function claimSlotFor(
  slotId: number,
  entryId: number,
  signupId: number,
  calendarEntryId: number,
  comment: string | null
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('signup_slot_claims')
    .upsert(
      { slot_id: slotId, signup_entry_id: entryId, comment: comment?.trim() || null },
      { onConflict: 'slot_id,signup_entry_id' }
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Release a job claim on someone's behalf — the other half of claimSlotFor,
 * for the roster's per-row Edit (Patrick, 2026-08-21: "jobs and commitments
 * often fluctuate widely between when people sign up and the day of need").
 */
export async function unclaimSlotFor(
  slotId: number,
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_slot_claims')
    .delete()
    .eq('slot_id', slotId)
    .eq('signup_entry_id', entryId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Per-event class override on one entry (Plans/Participant-Classification.md):
 * the default came from the roster person at sign-up; a leader corrects it
 * here from the roster's Edit dialog. person_kind follows the class so the
 * readers that haven't migrated (slips, two-deep, pricing audience) agree.
 */
export async function setEntryClass(
  entryId: number,
  participantClass: string,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  if (!isParticipantClass(participantClass)) return { ok: false, error: 'Unknown participant class.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({ participant_class: participantClass, person_kind: personKindFor(participantClass) })
    .eq('id', entryId)
    .eq('event_signup_id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * Leader adds a NAMED guest (Webelos / Cub Scout / Youth Guest / Adult Guest)
 * under a roster entry that brought them — the admin half of decision 4
 * (families add theirs on the public form). Cascade-deletes with the host.
 */
/** The host household a guest attaches to: the host entry's household_id,
 *  else the household the host person belongs to. null ⇒ nothing to attach
 *  a guest to (an unassigned scout / standalone adult). */
async function hostHouseholdId(
  supabase: ReturnType<typeof createAdminClient>,
  host: { household_id: number | null; person_id: number | null }
): Promise<number | null> {
  if (host.household_id != null) return host.household_id;
  if (host.person_id == null) return null;
  const { data } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('person_id', host.person_id)
    .order('household_id')
    .limit(1)
    .maybeSingle();
  return (data as { household_id: number } | null)?.household_id ?? null;
}

/** The known guests of the household a roster entry belongs to — the Add a
 *  guest dialog's "add again" picks (Plans/Guests-As-People.md). Leader-only. */
export async function loadGuestsForHost(hostEntryId: number, signupId: number): Promise<HouseholdGuest[]> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: host } = await supabase
    .from('signup_entries')
    .select('id, household_id, person_id')
    .eq('id', hostEntryId)
    .eq('event_signup_id', signupId)
    .maybeSingle();
  if (!host) return [];
  const hh = await hostHouseholdId(supabase, host as { household_id: number | null; person_id: number | null });
  return loadHouseholdGuests(hh);
}

function friendlyGuestError(message: string): string {
  if (message.includes('GUEST_HOUSEHOLD_CAP'))
    return 'This household already has 25 guests on record — forget some from People → Guests first.';
  if (message.includes('GUEST_NAME_TOO_LONG')) return 'Keep the guest’s name under 80 characters.';
  if (message.includes('GUEST_NAME_REQUIRED')) return 'Give the guest a name.';
  if (message.includes('GUEST_CLASS')) return 'Pick a guest class.';
  return message;
}

/**
 * Leader adds a NAMED guest to a roster (Plans/Guests-As-People.md): the guest
 * is a `people` row flagged as a guest of the host's household — a re-pick of
 * one the household already brought (personId), or a new person created under
 * the 25-per-household cap — and gets its own entry hosted by `hostEntryId`.
 * A cancelled row for that person on this event is REVIVED, never twinned.
 */
export async function addGuestEntry(
  signupId: number,
  calendarEntryId: number,
  hostEntryId: number,
  guest: { personId?: number | null; name?: string; cls: string; phone?: string | null }
): Promise<Result> {
  const session = await requireCapability('calendar.write');
  if (!(GUEST_CLASSES as readonly string[]).includes(guest.cls)) {
    return { ok: false, error: 'Pick a guest class.' };
  }
  const cls = guest.cls as ParticipantClass;
  const name = (guest.name ?? '').trim();
  const phone = cls === 'adult_guest' ? (guest.phone ?? '').trim() || null : null;
  if (guest.personId == null && !name) return { ok: false, error: 'Give the guest a name.' };

  const supabase = createAdminClient();
  const { data: host } = await supabase
    .from('signup_entries')
    .select('id, household_id, person_id, host_entry_id')
    .eq('id', hostEntryId)
    .eq('event_signup_id', signupId)
    .maybeSingle();
  if (!host) return { ok: false, error: 'That host is not on this roster.' };
  const h = host as { id: number; household_id: number | null; person_id: number | null; host_entry_id: number | null };
  if (h.host_entry_id != null) return { ok: false, error: 'A guest can’t host another guest — pick a household member.' };
  const householdId = await hostHouseholdId(supabase, h);
  if (householdId == null) return { ok: false, error: 'This host has no household to attach a guest to.' };

  let personId: number;
  if (guest.personId != null) {
    const { data: person } = await supabase
      .from('people')
      .select('id, guest_host_household_id, merged_into_person_id')
      .eq('id', guest.personId)
      .maybeSingle();
    const p = person as { id: number; guest_host_household_id: number | null; merged_into_person_id: number | null } | null;
    if (!p || p.merged_into_person_id != null || p.guest_host_household_id !== householdId) {
      return { ok: false, error: 'That person is not one of this household’s guests.' };
    }
    personId = p.id;
    if (phone) {
      await supabase.from('people').update({ primary_phone: phone, updated_at: new Date().toISOString() }).eq('id', personId);
    }
  } else {
    const { data: created, error: createErr } = await supabase.rpc('ensure_guest_person', {
      p_household_id: householdId,
      p_name: name,
      p_phone: phone,
      p_actor: session.label
    });
    if (createErr) return { ok: false, error: friendlyGuestError(createErr.message) };
    personId = Number(created);
  }

  const common = {
    host_entry_id: hostEntryId,
    // A guest belongs to the household that brought them — same as the
    // public form writes — so the roster's Household column reads right.
    household_id: householdId,
    participant_class: cls,
    person_kind: personKindFor(cls),
    status: 'yes',
    participation: 'full',
    updated_by: session.label,
    updated_at: new Date().toISOString()
  };
  const { data: existing } = await supabase
    .from('signup_entries')
    .select('id, status')
    .eq('event_signup_id', signupId)
    .eq('person_id', personId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    if ((existing as { status: string }).status === 'yes') return { ok: false, error: 'They are already on this roster.' };
    const { error } = await supabase
      .from('signup_entries')
      .update({ ...common, cancelled_at: null })
      .eq('id', (existing as { id: number }).id);
    if (error) return { ok: false, error: friendlyGuestError(error.message) };
  } else {
    const { error } = await supabase.from('signup_entries').insert({
      event_signup_id: signupId,
      person_id: personId,
      ...common,
      entered_by: session.label
    });
    if (error) return { ok: false, error: friendlyGuestError(error.message) };
  }
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/* ── Transportation & assignments (Plans/Event-Logistics.md §A/§B) ───────── */

/**
 * Leader sets one person's transport: which legs they drive (with seats
 * INCLUDING the driver) and the ride status for legs they don't. The DB
 * normalizer nulls a ride status on a driven leg (and seats on one not
 * driven); sync_car_groups creates/resizes/retires the car.
 */
export async function setEntryTransport(
  entryId: number,
  transport: {
    drivesOut: boolean;
    drivesBack: boolean;
    vehicleSeatsOut: number | null;
    vehicleSeatsBack: number | null;
    rideOut: string | null;
    rideBack: string | null;
  },
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireCapability('calendar.write');
  for (const r of [transport.rideOut, transport.rideBack]) {
    if (r != null && !isRideStatus(r)) return { ok: false, error: 'Unknown ride status.' };
  }
  if (transport.drivesOut && !(transport.vehicleSeatsOut && transport.vehicleSeatsOut >= 1))
    return { ok: false, error: 'A driver needs a seat count (including themselves).' };
  if (transport.drivesBack && !(transport.vehicleSeatsBack && transport.vehicleSeatsBack >= 1))
    return { ok: false, error: 'A driver needs a seat count (including themselves).' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({
      drives_out: transport.drivesOut,
      drives_back: transport.drivesBack,
      vehicle_seats_out: transport.drivesOut ? transport.vehicleSeatsOut : null,
      vehicle_seats_back: transport.drivesBack ? transport.vehicleSeatsBack : null,
      ride_out: transport.drivesOut ? null : (transport.rideOut ?? 'needs_ride'),
      ride_back: transport.drivesBack ? null : (transport.rideBack ?? 'needs_ride'),
      updated_by: session.label,
      updated_at: new Date().toISOString()
    })
    .eq('id', entryId)
    .eq('event_signup_id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Ride status for one leg only — the board's quick "meeting there" change. */
export async function setRideStatus(
  entryId: number,
  leg: 'out' | 'back',
  status: string,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  const session = await requireCapability('calendar.write');
  if (!isRideStatus(status)) return { ok: false, error: 'Unknown ride status.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({
      [leg === 'out' ? 'ride_out' : 'ride_back']: status,
      updated_by: session.label,
      updated_at: new Date().toISOString()
    })
    .eq('id', entryId)
    .eq('event_signup_id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export type PlaceOutcome = 'placed' | 'moved' | 'already' | 'full' | 'gone';

/**
 * Put someone in a group (car, tent, patrol…). The RPC locks the group row
 * before counting, so two leaders dragging into the last seat cannot both win;
 * 'full' and 'gone' come back as outcomes, not errors, because the board
 * handles them as ordinary states.
 */
export async function placeInGroup(
  groupId: number,
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result & { outcome?: PlaceOutcome }> {
  const session = await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('place_in_group', {
    p_group_id: groupId,
    p_entry_id: entryId,
    p_actor: session.label
  });
  if (error) return { ok: false, error: friendlyPlaceError(error.message) };
  const outcome = data as PlaceOutcome;
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  if (outcome === 'full') return { ok: false, outcome, error: 'That group is full.' };
  if (outcome === 'gone') return { ok: false, outcome, error: 'That group no longer exists — the page will refresh.' };
  return { ok: true, outcome };
}

export async function unplaceFromGroup(
  groupId: number,
  entryId: number,
  signupId: number,
  calendarEntryId: number
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('unplace_from_group', { p_group_id: groupId, p_entry_id: entryId });
  if (error) return { ok: false, error: friendlyPlaceError(error.message) };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

function friendlyPlaceError(message: string): string {
  if (message.includes('DRIVER_STAYS_WITH_CAR'))
    return 'A driver stays with their car — change their driving on the roster instead.';
  if (message.includes('ENTRY_CANCELLED')) return 'That person was removed from the signup.';
  if (message.includes('ENTRY_NOT_IN_THIS_EVENT')) return 'That person is not signed up for this event.';
  if (message.includes('CAR_GROUPS_ARE_SYSTEM_MANAGED'))
    return 'Cars come from the signup — set who drives on the roster.';
  return message;
}

/* ── Group sets & groups (Plans/Event-Logistics.md §B) ────────────────────── */

/**
 * Add a set (Patrols, Tents, Crews, Teams, or any label) to a signup. Cars
 * are refused here — they come from the Drivers block. A patrol set with
 * seed_from_roster seeds itself (DB trigger) from scouts.patrol.
 */
export async function addGroupSet(
  signupId: number,
  calendarEntryId: number,
  input: {
    kind: string;
    label: string;
    seedFromRoster?: boolean;
    selfSelect?: boolean;
    familyVisible?: boolean;
    defaultCapacity?: number | null;
  }
): Promise<Result & { setId?: number }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('signup_group_sets')
    .select('label')
    .eq('event_signup_id', signupId);
  const problem = validateNewSet(input, ((existing ?? []) as { label: string }[]).map((s) => s.label));
  if (problem) return { ok: false, error: problem };
  const cap = input.defaultCapacity != null && input.defaultCapacity > 0 ? Math.floor(input.defaultCapacity) : null;
  const { data, error } = await supabase
    .from('signup_group_sets')
    .insert({
      event_signup_id: signupId,
      kind: input.kind,
      label: normalizeSetLabel(input.label),
      seed_from_roster: input.kind === 'patrol' && (input.seedFromRoster ?? true),
      self_select: input.selfSelect ?? false,
      family_visible: input.familyVisible ?? true,
      default_capacity: cap
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/calendar/${calendarEntryId}`);
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, setId: (data as { id: number }).id };
}

export async function updateGroupSet(
  setId: number,
  signupId: number,
  calendarEntryId: number,
  fields: { label?: string; selfSelect?: boolean; familyVisible?: boolean; defaultCapacity?: number | null; seedFromRoster?: boolean }
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (fields.label !== undefined) {
    const label = normalizeSetLabel(fields.label);
    if (!label) return { ok: false, error: 'Give the set a label.' };
    patch.label = label;
  }
  if (fields.selfSelect !== undefined) patch.self_select = fields.selfSelect;
  if (fields.familyVisible !== undefined) patch.family_visible = fields.familyVisible;
  if (fields.seedFromRoster !== undefined) patch.seed_from_roster = fields.seedFromRoster;
  if (fields.defaultCapacity !== undefined)
    patch.default_capacity = fields.defaultCapacity != null && fields.defaultCapacity > 0 ? Math.floor(fields.defaultCapacity) : null;
  const { error } = await supabase
    .from('signup_group_sets')
    .update(patch)
    .eq('id', setId)
    .eq('event_signup_id', signupId)
    .neq('kind', 'car');
  if (error) return { ok: false, error: error.message.includes('duplicate') ? 'A set with that label already exists.' : error.message };
  revalidatePath(`/admin/calendar/${calendarEntryId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Removing a set takes its groups and placements with it — so it asks first
 *  once anyone is placed, and reports how many. Car sets cannot be removed
 *  here (turn off Drivers). */
export async function deleteGroupSet(
  setId: number,
  signupId: number,
  calendarEntryId: number,
  confirm: boolean
): Promise<Result & { needsConfirm?: boolean; memberCount?: number }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: set } = await supabase
    .from('signup_group_sets')
    .select('id, kind, label')
    .eq('id', setId)
    .eq('event_signup_id', signupId)
    .maybeSingle();
  if (!set) return { ok: false, error: 'That set is not on this signup.' };
  if ((set as { kind: string }).kind === 'car') {
    return { ok: false, error: 'Cars come from the Drivers block — turn Drivers off to remove them.' };
  }
  const { count } = await supabase
    .from('signup_group_members')
    .select('*', { count: 'exact', head: true })
    .eq('set_id', setId);
  const memberCount = count ?? 0;
  if (memberCount > 0 && !confirm) {
    return {
      ok: false,
      needsConfirm: true,
      memberCount,
      error: `${memberCount} ${memberCount === 1 ? 'person is' : 'people are'} placed in "${(set as { label: string }).label}". Removing the set un-places them — this can't be undone.`
    };
  }
  const { error } = await supabase.from('signup_group_sets').delete().eq('id', setId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/calendar/${calendarEntryId}`);
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, memberCount };
}

/** Add a group (a tent, a patrol, a team) to a non-car set. */
export async function addGroup(
  setId: number,
  signupId: number,
  calendarEntryId: number,
  input: { name: string; capacity?: number | null; notes?: string | null }
): Promise<Result & { groupId?: number }> {
  await requireCapability('calendar.write');
  const name = normalizeGroupName(input.name);
  if (!name) return { ok: false, error: 'Give the group a name.' };
  const supabase = createAdminClient();
  const { data: set } = await supabase
    .from('signup_group_sets')
    .select('id, kind, default_capacity')
    .eq('id', setId)
    .eq('event_signup_id', signupId)
    .maybeSingle();
  if (!set) return { ok: false, error: 'That set is not on this signup.' };
  const s = set as { kind: string; default_capacity: number | null };
  if (s.kind === 'car') return { ok: false, error: 'Cars come from the signup — set who drives on the roster.' };
  const capacity =
    input.capacity === undefined ? s.default_capacity : input.capacity != null && input.capacity > 0 ? Math.floor(input.capacity) : null;
  const { data, error } = await supabase
    .from('signup_groups')
    .insert({ set_id: setId, name, capacity, notes: input.notes?.trim() || null })
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message.includes('duplicate') ? `"${name}" already exists in this set.` : error.message };
  }
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true, groupId: (data as { id: number }).id };
}

/** Rename / resize / annotate a non-car group. (Car capacity lives on the
 *  driver's entry; only `notes` is editable on a car here.) */
export async function updateGroup(
  groupId: number,
  signupId: number,
  calendarEntryId: number,
  fields: { name?: string; capacity?: number | null; notes?: string | null }
): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: group } = await supabase
    .from('signup_groups')
    .select('id, set_id, signup_group_sets!inner(kind, event_signup_id)')
    .eq('id', groupId)
    .maybeSingle();
  const g = group as unknown as { id: number; signup_group_sets: { kind: string; event_signup_id: number } } | null;
  if (!g || g.signup_group_sets.event_signup_id !== signupId) return { ok: false, error: 'That group is not on this signup.' };
  const patch: Record<string, unknown> = {};
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null;
  if (g.signup_group_sets.kind !== 'car') {
    if (fields.name !== undefined) {
      const name = normalizeGroupName(fields.name);
      if (!name) return { ok: false, error: 'Give the group a name.' };
      patch.name = name;
    }
    if (fields.capacity !== undefined) {
      patch.capacity = fields.capacity != null && fields.capacity > 0 ? Math.floor(fields.capacity) : null;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('signup_groups').update(patch).eq('id', groupId);
  if (error) {
    return { ok: false, error: error.message.includes('duplicate') ? 'A group with that name already exists in this set.' : error.message };
  }
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/** Remove a non-car group. Refused while anyone is in it — move them first,
 *  so a leader can't un-place a tent of scouts by accident. */
export async function deleteGroup(groupId: number, signupId: number, calendarEntryId: number): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: group } = await supabase
    .from('signup_groups')
    .select('id, signup_group_sets!inner(kind, event_signup_id)')
    .eq('id', groupId)
    .maybeSingle();
  const g = group as unknown as { id: number; signup_group_sets: { kind: string; event_signup_id: number } } | null;
  if (!g || g.signup_group_sets.event_signup_id !== signupId) return { ok: false, error: 'That group is not on this signup.' };
  if (g.signup_group_sets.kind === 'car') return { ok: false, error: 'Cars retire when their driver stops driving — change that on the roster.' };
  const { count } = await supabase.from('signup_group_members').select('*', { count: 'exact', head: true }).eq('group_id', groupId);
  if ((count ?? 0) > 0) return { ok: false, error: `Move the ${count} ${count === 1 ? 'person' : 'people'} out first, then remove the group.` };
  const { error } = await supabase.from('signup_groups').delete().eq('id', groupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}`);
  revalidatePath(`/admin/rosters/${signupId}/assignments`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/* ── Milestones: deposit schedules & deadlines (Plans/Event-Logistics.md §C) ── */

export async function addMilestone(
  signupId: number,
  calendarEntryId: number,
  input: { kind: string; label: string; dueOn: string; amount: number | null; appliesTo: 'scouts' | 'adults' | 'both' }
): Promise<Result> {
  await requireCapability('calendar.write');
  if (!['payment', 'registration', 'form', 'other'].includes(input.kind)) return { ok: false, error: 'Pick a kind of milestone.' };
  const label = input.label.trim();
  if (!label) return { ok: false, error: 'Give the milestone a label.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, error: 'Pick a due date.' };
  if (input.kind === 'payment' && !(input.amount != null && input.amount > 0)) {
    return { ok: false, error: 'A payment milestone needs an amount.' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('event_milestones').insert({
    event_signup_id: signupId,
    kind: input.kind,
    label,
    due_on: input.dueOn,
    amount: input.kind === 'payment' ? input.amount : null,
    applies_to: input.appliesTo
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}/money`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

export async function deleteMilestone(milestoneId: number, signupId: number, calendarEntryId: number): Promise<Result> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { error } = await supabase.from('event_milestones').delete().eq('id', milestoneId).eq('event_signup_id', signupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/rosters/${signupId}/money`);
  revalidateEvent(calendarEntryId, signupId);
  return { ok: true };
}

/**
 * "Email those behind" — the deposit-schedule chase. Same plumbing and the
 * same two-step confirm as emailNonResponders; copy is editable in Lookups &
 * Admin (payment_reminder.*). Recipients are resolved per BEHIND person:
 * a scout's guardians (recipientsForScouts) or the adult themselves.
 */
export async function emailPaymentReminders(
  signupId: number,
  behind: { entryId: number; short: number; due: number }[],
  confirm: boolean
): Promise<{ ok: boolean; error?: string; status?: string; to?: string[] }> {
  await requireCapability('calendar.write');
  if (behind.length === 0) return { ok: false, error: 'Nobody is behind on the schedule.' };
  const supabase = createAdminClient();

  const { data: signup } = await supabase
    .from('event_signups')
    .select('id, calendar_entry_id, calendar_entries!inner(title)')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return { ok: false, error: 'Signup not found.' };
  const sig = signup as unknown as { calendar_entry_id: number; calendar_entries: { title: string } };

  const { data: entries } = await supabase
    .from('signup_entries')
    .select('id, person_id, person_kind')
    .in('id', behind.map((b) => b.entryId))
    .eq('event_signup_id', signupId);
  const rows = (entries ?? []) as { id: number; person_id: number | null; person_kind: string }[];
  const scoutPersonIds = rows.filter((r) => r.person_kind === 'scout' && r.person_id != null).map((r) => r.person_id as number);
  const adultPersonIds = rows.filter((r) => r.person_kind === 'adult' && r.person_id != null).map((r) => r.person_id as number);

  const to = new Set<string>();
  if (scoutPersonIds.length > 0) {
    const { data: scouts } = await supabase.from('scouts').select('id').in('person_id', scoutPersonIds);
    const recipients = await recipientsForScouts(((scouts ?? []) as { id: string }[]).map((s) => s.id));
    for (const r of recipients) to.add(r.email);
  }
  if (adultPersonIds.length > 0) {
    const { data: adults } = await supabase.from('people').select('primary_email').in('id', adultPersonIds);
    for (const a of (adults ?? []) as { primary_email: string | null }[]) if (a.primary_email) to.add(a.primary_email.trim().toLowerCase());
  }
  if (to.size === 0) return { ok: false, error: 'No email addresses on file for the people who are behind.' };

  // One email, one amount: the copy quotes the LARGEST shortfall in the set
  // so the message is never wrong by being too small. A per-family figure
  // would mean one send per household; this is the chase, not the statement.
  const short = Math.max(...behind.map((b) => b.short));
  const due = Math.max(...behind.map((b) => b.due));
  const fmt = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const copy = paymentReminderEmailCopy(await loadSiteText(supabase), {
    title: sig.calendar_entries.title,
    short: fmt(short),
    due: fmt(due)
  });
  const { html, text } = renderEmail({
    heading: copy.heading,
    intro: copy.intro,
    bullets: [copy.bullet],
    actionUrl: `${siteUrl()}/events/${sig.calendar_entry_id}`,
    actionLabel: copy.actionLabel,
    outro: copy.outro
  });
  const res = await sendEmail({ to: [...to], subject: copy.subject, html, text, confirm });
  return { ok: res.status !== 'error', error: res.detail, status: res.status, to: res.to };
}
