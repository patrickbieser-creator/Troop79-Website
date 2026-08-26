/**
 * Signup confirmation — the server half (Plans/Signup-Confirmation-Email.md).
 * Lives in lib/ because BOTH sides call it — the public signup form (submit /
 * cancel) and the admin roster (Resend) — and the design-system firewall
 * forbids public code importing from src/app/admin.
 *
 *   loadHouseholdSnapshot   — the household's rows BEFORE a write (for the
 *                             update diff and the cancel receipt)
 *   buildConfirmation       — everything the merge fields need, from the DB
 *   dispatchConfirmations   — decides audiences + recipients, renders, sends,
 *                             logs. Pure over its inputs; the transport and the
 *                             log writer are injected so tests need no network.
 *   sendSignupConfirmations — the one call the public actions make: load,
 *                             build, dispatch, never throw.
 *
 * The pure merge-field / recipient / diff logic is lib/signup-confirmation.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { emailConfigured, sendEmail, troopEmail, type SendResult } from '@/lib/email';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { siteUrl } from '@/lib/site-url';
import { GUEST_CLASSES } from '@/lib/participant-class';
import type { Household } from '@/lib/households';
import {
  applyBlocks,
  blocksFromSignup,
  describeChanges,
  fullMessageMd,
  renderMessage,
  resolveMessage,
  resolveRecipients,
  type Audience,
  type Change,
  type ConfirmationContext,
  type FamilyMember,
  type MessageTemplate,
  type SignupSnapshotRow
} from '@/lib/signup-confirmation';

const ADULT_CLASSES = new Set(['adult', 'adult_guest']);
const isAdultClass = (c: string) => ADULT_CLASSES.has(c);

/** The block's configuration on the signup row. */
export interface ConfirmationConfig {
  familyEnabled: boolean;
  familyTemplate: MessageTemplate | null;
  familyOverride: { subject: string | null; body: string | null };
  leaderEnabled: boolean;
  leaderTemplate: MessageTemplate | null;
  leaderOverride: { subject: string | null; body: string | null };
  leaderUseFamily: boolean;
  leaderRecipients: string[];
}

export interface LogRow {
  eventSignupId: number;
  householdId: number | null;
  audience: Audience;
  change: Change;
  recipients: string[];
  status: 'sent' | 'skipped' | 'failed';
  detail: string | null;
}

export interface DispatchDeps {
  configured: () => boolean;
  send: (opts: { to: string[]; subject: string; html: string; text: string; replyTo?: string }) => Promise<SendResult>;
  log: (row: LogRow) => Promise<void>;
}

const liveDeps: DispatchDeps = {
  configured: emailConfigured,
  send: (o) => sendEmail({ ...o, confirm: true }),
  log: async (row) => {
    const supabase = createAdminClient();
    await supabase.from('signup_confirmation_log').insert({
      event_signup_id: row.eventSignupId,
      household_id: row.householdId,
      audience: row.audience,
      change: row.change,
      recipients: row.recipients,
      status: row.status,
      detail: row.detail
    });
  }
};

/* ── snapshot (before a write) ───────────────────────────────────────────── */

interface EntryRow {
  id: number;
  person_id: number | null;
  participant_class: string | null;
  status: string;
  participation: string;
  days: number | null;
  price_id: number | null;
  drives_out: boolean | null;
  drives_back: boolean | null;
  vehicle_seats_out: number | null;
  vehicle_seats_back: number | null;
  ride_out: string | null;
  ride_back: string | null;
  guest_count: number | null;
  guest_name: string | null;
  guest_note: string | null;
  volunteer_note: string | null;
  household_id: number | null;
}

async function loadHouseholdRows(supabase: SupabaseClient, signupId: number, personIds: number[], householdId: number | null) {
  let q = supabase.from('signup_entries').select('*').eq('event_signup_id', signupId);
  if (householdId) q = q.or(`household_id.eq.${householdId},person_id.in.(${personIds.length ? personIds.join(',') : '0'})`);
  else q = q.in('person_id', personIds.length ? personIds : [0]);
  const { data } = await q;
  return ((data ?? []) as EntryRow[]).filter((r) => r.status !== 'cancelled');
}

async function loadNames(supabase: SupabaseClient, personIds: number[]) {
  if (!personIds.length) return new Map<number, { display_name: string; primary_email: string | null; primary_phone: string | null }>();
  const { data } = await supabase.from('people').select('id, display_name, primary_email, primary_phone').in('id', personIds);
  return new Map(
    ((data ?? []) as { id: number; display_name: string; primary_email: string | null; primary_phone: string | null }[]).map((p) => [p.id, p])
  );
}

async function loadJobsByEntry(supabase: SupabaseClient, signupId: number, entryIds: number[]) {
  const jobs = new Map<number, string[]>();
  if (!entryIds.length) return jobs;
  const [{ data: slots }, { data: claims }] = await Promise.all([
    supabase.from('signup_slots').select('id, label, slot_date').eq('event_signup_id', signupId),
    supabase.from('signup_slot_claims').select('slot_id, signup_entry_id').in('signup_entry_id', entryIds)
  ]);
  const slotById = new Map(((slots ?? []) as { id: number; label: string; slot_date: string | null }[]).map((s) => [s.id, s]));
  for (const c of (claims ?? []) as { slot_id: number; signup_entry_id: number }[]) {
    const s = slotById.get(c.slot_id);
    if (!s) continue;
    jobs.set(c.signup_entry_id, [...(jobs.get(c.signup_entry_id) ?? []), s.label]);
  }
  return jobs;
}

export interface HouseholdSnapshot {
  rows: SignupSnapshotRow[];
  entries: EntryRow[];
  names: Map<number, { display_name: string; primary_email: string | null; primary_phone: string | null }>;
  jobsByEntry: Map<number, string[]>;
}

/** The household's current rows on this signup, in the diff's shape. */
export async function loadHouseholdSnapshot(
  supabase: SupabaseClient,
  signupId: number,
  party: Household | null,
  householdId: number | null
): Promise<HouseholdSnapshot> {
  const personIds = partyPersonIds(party);
  const entries = await loadHouseholdRows(supabase, signupId, personIds, householdId);
  const [names, jobsByEntry] = await Promise.all([
    loadNames(supabase, entries.map((e) => e.person_id).filter((v): v is number => v != null)),
    loadJobsByEntry(supabase, signupId, entries.map((e) => e.id))
  ]);
  const rows: SignupSnapshotRow[] = entries.map((e) => ({
    name: e.guest_name ?? names.get(e.person_id ?? -1)?.display_name ?? 'Someone',
    status: e.status,
    jobs: jobsByEntry.get(e.id) ?? [],
    drivesOut: e.drives_out === true,
    drivesBack: e.drives_back === true,
    seatsOut: e.vehicle_seats_out,
    seatsBack: e.vehicle_seats_back
  }));
  return { rows, entries, names, jobsByEntry };
}

function partyPersonIds(party: Household | null): number[] {
  return [
    ...(party?.scouts.map((s) => s.personId).filter((v): v is number => v != null) ?? []),
    ...(party?.adults.map((a) => a.personId) ?? [])
  ];
}

/* ── config + context ────────────────────────────────────────────────────── */

async function loadTemplate(supabase: SupabaseClient, id: number | null): Promise<MessageTemplate | null> {
  if (!id) return null;
  const { data } = await supabase.from('email_templates').select('subject, body').eq('id', id).maybeSingle();
  return data ? { subject: data.subject as string, body: data.body as string } : null;
}

export async function loadConfirmationConfig(supabase: SupabaseClient, signupId: number) {
  const { data: s } = await supabase.from('event_signups').select('*').eq('id', signupId).maybeSingle();
  if (!s) return null;
  const sig = s as Record<string, unknown>;
  const [familyTemplate, leaderTemplate] = await Promise.all([
    loadTemplate(supabase, (sig.confirm_family_template_id as number | null) ?? null),
    loadTemplate(supabase, (sig.confirm_leader_template_id as number | null) ?? null)
  ]);
  const config: ConfirmationConfig = {
    familyEnabled: sig.confirm_family_enabled === true,
    familyTemplate,
    familyOverride: { subject: (sig.confirm_family_subject as string | null) ?? null, body: (sig.confirm_family_body as string | null) ?? null },
    leaderEnabled: sig.confirm_leader_enabled === true,
    leaderTemplate,
    leaderOverride: { subject: (sig.confirm_leader_subject as string | null) ?? null, body: (sig.confirm_leader_body as string | null) ?? null },
    leaderUseFamily: sig.confirm_leader_use_family === true,
    leaderRecipients: (sig.confirm_recipients as string[] | null) ?? []
  };
  return { config, signup: sig };
}

/**
 * Everything the merge fields need for THIS household on THIS signup. For a
 * cancel, pass the pre-cancel snapshot so the receipt says what was dropped.
 */
export async function buildConfirmation(
  supabase: SupabaseClient,
  signup: Record<string, unknown>,
  party: Household | null,
  householdId: number | null,
  submitterPersonId: number | null,
  change: Change,
  before: HouseholdSnapshot | null,
  after: HouseholdSnapshot
): Promise<{ ctx: ConfirmationContext; members: FamilyMember[] }> {
  const signupId = signup.id as number;
  const entryId = signup.calendar_entry_id as number;
  const snap = change === 'cancel' && before ? before : after;

  const [{ data: entry }, { data: prices }, { data: balances }, { count: goingCount }, { data: questions }, { count: slotCount }] = await Promise.all([
    supabase.from('calendar_entries').select('id, title, entry_date, end_date, start_time, end_time, location').eq('id', entryId).maybeSingle(),
    supabase.from('event_prices').select('id, label, amount, per').eq('event_signup_id', signupId),
    snap.entries.length
      ? supabase.from('signup_entry_balances').select('entry_id, owed, paid').in('entry_id', snap.entries.map((e) => e.id))
      : Promise.resolve({ data: [] as { entry_id: number; owed: number; paid: number }[] }),
    supabase.from('signup_entries').select('id', { count: 'exact', head: true }).eq('event_signup_id', signupId).eq('status', 'yes').eq('participation', 'full'),
    supabase.from('signup_questions').select('id, prompt').eq('event_signup_id', signupId).order('sort'),
    supabase.from('signup_slots').select('id', { count: 'exact', head: true }).eq('event_signup_id', signupId)
  ]);
  const { data: answers } = snap.entries.length
    ? await supabase.from('signup_answers').select('signup_entry_id, question_id, value').in('signup_entry_id', snap.entries.map((e) => e.id))
    : { data: [] as { signup_entry_id: number; question_id: number; value: string }[] };

  const e = (entry ?? {}) as { title?: string; entry_date?: string; end_date?: string | null; start_time?: string | null; end_time?: string | null; location?: string | null };
  const priceById = new Map(((prices ?? []) as { id: number; label: string; amount: number }[]).map((p) => [p.id, p]));
  const promptById = new Map(((questions ?? []) as { id: number; prompt: string }[]).map((q) => [q.id, q.prompt]));

  const nameOf = (row: EntryRow) => row.guest_name ?? snap.names.get(row.person_id ?? -1)?.display_name ?? 'Someone';
  const isGuestRow = (row: EntryRow) => (GUEST_CLASSES as readonly string[]).includes(row.participant_class ?? '');
  const people = snap.entries
    .filter((r) => !isGuestRow(r) && r.participation !== 'driver_only' && r.participation !== 'contributor')
    .map((r) => ({ name: nameOf(r), isAdult: isAdultClass(r.participant_class ?? ''), status: r.status }));
  const guests = snap.entries.flatMap((r) => {
    const out: string[] = [];
    if (isGuestRow(r)) out.push(nameOf(r));
    if (r.guest_count && r.guest_count > 0) out.push(`+${r.guest_count} guest${r.guest_count === 1 ? '' : 's'} with ${nameOf(r)}`);
    return out;
  });
  const days = snap.entries.filter((r) => r.days).map((r) => `${nameOf(r)}: ${r.days} day${r.days === 1 ? '' : 's'}`);
  const jobs = snap.entries.flatMap((r) => (snap.jobsByEntry.get(r.id) ?? []).map((j) => `${j} (${nameOf(r)})`));
  const rides = snap.entries.flatMap((r) => {
    const out: string[] = [];
    if (r.drives_out) out.push(`${nameOf(r)} driving out${r.vehicle_seats_out ? ` with ${r.vehicle_seats_out} seats` : ''}`);
    if (r.drives_back) out.push(`${nameOf(r)} driving back${r.vehicle_seats_back ? ` with ${r.vehicle_seats_back} seats` : ''}`);
    if (r.ride_out === 'needs_ride') out.push(`${nameOf(r)} needs a ride out`);
    if (r.ride_back === 'needs_ride') out.push(`${nameOf(r)} needs a ride back`);
    return out;
  });
  const answerLines = ((answers ?? []) as { signup_entry_id: number; question_id: number; value: string }[])
    .filter((a) => (a.value ?? '').trim())
    .map((a) => `${promptById.get(a.question_id) ?? 'Answer'}: ${a.value}`);
  const notes = snap.entries.flatMap((r) => [r.volunteer_note, r.guest_note].filter((n): n is string => !!n && n.trim() !== ''));
  const slip: string[] = [];
  if (signup.needs_permission_slip === true) slip.push('Permission slip required');
  if (signup.needs_ahmr_c === true) slip.push('AHMR part C required');
  const priceLines = snap.entries
    .filter((r) => r.price_id && priceById.has(r.price_id))
    .map((r) => `${nameOf(r)} — ${priceById.get(r.price_id!)!.label} $${Number(priceById.get(r.price_id!)!.amount).toFixed(2)}`);
  const bal = (balances ?? []) as { entry_id: number; owed: number; paid: number }[];
  const owed = bal.reduce((n, b) => n + Number(b.owed), 0);
  const paid = bal.reduce((n, b) => n + Number(b.paid), 0);

  const submitter =
    (submitterPersonId ? snap.names.get(submitterPersonId) : undefined) ??
    (party?.adults[0] ? snap.names.get(party.adults[0].personId) : undefined) ??
    null;
  const capacity = signup.capacity as number | null;

  const rawCtx: ConfirmationContext = {
    event: {
      title: e.title ?? 'the event',
      entryDate: e.entry_date ?? '',
      endDate: e.end_date ?? null,
      startTime: e.start_time ?? null,
      endTime: e.end_time ?? null,
      location: e.location ?? null,
      deadline: signup.deadline ? String(signup.deadline).slice(0, 10) : null,
      publicUrl: `${siteUrl()}/events/${entryId}`,
      rosterUrl: `${siteUrl()}/admin/calendar/${entryId}?tab=signup&view=roster`,
      headcount: goingCount == null ? null : `${goingCount} going${capacity ? ` of ${capacity}` : ''}`
    },
    household: {
      label: party?.label ?? submitter?.display_name ?? 'A family',
      submitterName: submitter?.display_name ?? party?.label ?? 'there',
      submitterEmail: submitter?.primary_email ?? null,
      submitterPhone: submitter?.primary_phone ?? null,
      people,
      guests,
      days,
      jobs,
      rides,
      answers: answerLines,
      notes,
      slip,
      prices: priceLines,
      amountDue: Math.max(0, Math.round((owed - paid) * 100) / 100),
      paid: Math.round(paid * 100) / 100,
      payment: (signup.payment_instructions as string | null) ?? null
    },
    change,
    changes:
      change === 'update'
        ? describeChanges(before?.rows ?? [], after.rows)
        : change === 'cancel'
          ? `Your signup for ${e.title ?? 'the event'} was cancelled.`
          : null
  };
  // Only the blocks this signup offered speak in the receipt (2026-08-25).
  const ctx = applyBlocks(
    rawCtx,
    blocksFromSignup(signup, {
      prices: (prices ?? []) as { per?: unknown }[],
      slots: Array.from({ length: slotCount ?? 0 }),
      questions: questions ?? []
    })
  );

  // Every household member with their email — signed up or not — so the
  // recipient rule (every signed-up member + cc all parents when only scouts
  // signed up) can be applied purely.
  const allIds = partyPersonIds(party);
  const allNames = allIds.length ? await loadNames(supabase, allIds) : new Map();
  const signedUpIds = new Set(snap.entries.filter((r) => r.status !== 'cancelled').map((r) => r.person_id));
  const members: FamilyMember[] = allIds.map((id) => ({
    email: allNames.get(id)?.primary_email ?? null,
    isAdult: (party?.adults ?? []).some((a) => a.personId === id),
    signedUp: signedUpIds.has(id)
  }));
  return { ctx, members };
}

/* ── dispatch ────────────────────────────────────────────────────────────── */

function toEmail(rendered: ReturnType<typeof renderMessage>, action: { url: string; label: string }, appendSummary: boolean) {
  // Markdown → inline-styled HTML + a plain-text twin (lib/email-markdown).
  return renderMarkdownEmail({ md: `# ${rendered.subject}\n\n${fullMessageMd(rendered, appendSummary)}`, actionUrl: action.url, actionLabel: action.label });
}

/**
 * Both audiences, each individually, one dedup across the two lists, one log
 * row per audience. Never throws — a failure is a log row + the returned
 * error string (the caller writes it to confirm_last_error).
 */
export async function dispatchConfirmations(
  input: {
    signupId: number;
    householdId: number | null;
    config: ConfirmationConfig;
    ctx: ConfirmationContext;
    members: FamilyMember[];
    submitterEmail: string | null;
  },
  deps: DispatchDeps = liveDeps
): Promise<{ error: string | null }> {
  const { signupId, householdId, config, ctx, members } = input;
  if (!config.familyEnabled && !config.leaderEnabled) return { error: null };
  const change = ctx.change;
  const errors: string[] = [];

  const { family, leaders } = resolveRecipients({
    members,
    submitterEmail: input.submitterEmail,
    leaders: config.leaderEnabled ? config.leaderRecipients : []
  });
  const replyTo = config.leaderRecipients[0] || troopEmail();

  if (!deps.configured()) {
    for (const audience of ['family', 'leader'] as const) {
      const on = audience === 'family' ? config.familyEnabled : config.leaderEnabled;
      if (on) await deps.log({ eventSignupId: signupId, householdId, audience, change, recipients: [], status: 'skipped', detail: 'Email is not configured on this server.' });
    }
    return { error: null };
  }

  const sendTo = async (audience: Audience, to: string[], template: MessageTemplate, renderAs: Audience) => {
    if (!to.length) {
      await deps.log({ eventSignupId: signupId, householdId, audience, change, recipients: [], status: 'skipped', detail: 'No deliverable addresses.' });
      return;
    }
    const rendered = renderMessage(template, ctx, renderAs);
    const action = audience === 'leader' ? { url: ctx.event.rosterUrl, label: 'Open roster' } : { url: ctx.event.publicUrl, label: 'Open event' };
    // A family receipt always carries the echo-back; a leader note only when its template asks.
    const { html, text } = toEmail(rendered, action, renderAs === 'family');
    try {
      const res = await deps.send({ to, subject: rendered.subject, html, text, replyTo });
      const failed = res.status === 'error';
      await deps.log({
        eventSignupId: signupId,
        householdId,
        audience,
        change,
        recipients: res.to ?? to,
        status: failed ? 'failed' : res.status === 'skipped' ? 'skipped' : 'sent',
        detail: res.detail ?? null
      });
      if (failed) errors.push(`${audience}: ${res.detail ?? res.status}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await deps.log({ eventSignupId: signupId, householdId, audience, change, recipients: to, status: 'failed', detail });
      errors.push(`${audience}: ${detail}`);
    }
  };

  const familyMessage = resolveMessage('family', config.familyOverride, config.familyTemplate);
  if (config.familyEnabled) await sendTo('family', family, familyMessage, 'family');
  if (config.leaderEnabled) {
    if (config.leaderUseFamily) await sendTo('leader', leaders, familyMessage, 'family');
    else await sendTo('leader', leaders, resolveMessage('leader', config.leaderOverride, config.leaderTemplate), 'leader');
  }
  return { error: errors.length ? errors.join(' · ') : null };
}

/* ── the one call the public actions make ────────────────────────────────── */

export async function sendSignupConfirmations(input: {
  signupId: number;
  party: Household | null;
  householdId: number | null;
  submitterPersonId: number | null;
  change: Change;
  before: HouseholdSnapshot | null;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    const loaded = await loadConfirmationConfig(supabase, input.signupId);
    if (!loaded) return;
    const { config, signup } = loaded;
    if (!config.familyEnabled && !config.leaderEnabled) return;
    const after = await loadHouseholdSnapshot(supabase, input.signupId, input.party, input.householdId);
    const { ctx, members } = await buildConfirmation(supabase, signup, input.party, input.householdId, input.submitterPersonId, input.change, input.before, after);
    const { error } = await dispatchConfirmations({
      signupId: input.signupId,
      householdId: input.householdId,
      config,
      ctx,
      members,
      submitterEmail: ctx.household.submitterEmail
    });
    await supabase.from('event_signups').update({ confirm_last_error: error }).eq('id', input.signupId);
  } catch (err) {
    // A receipt must never break a signup. Leave a trace and move on.
    try {
      const supabase = createAdminClient();
      await supabase
        .from('event_signups')
        .update({ confirm_last_error: err instanceof Error ? err.message : String(err) })
        .eq('id', input.signupId);
    } catch {
      /* nothing left to do */
    }
  }
}

/** Is a snapshot "something already there" — decides new vs update. */
export function changeFor(before: HouseholdSnapshot | null): Change {
  return before && before.rows.some((r) => r.status !== 'cancelled') ? 'update' : 'new';
}
