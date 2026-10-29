/**
 * Meeting Planner III Emails (Plans/Meeting-Planner-III-Emails.md, Technical Approach 5-6 and tech-lead #1): the
 * email log and the one-at-a-time sender behind the Emails screen. Server-only, service role; the CALLER decides who
 * may queue and send (an adult holding meeting_planner.edit) and builds each email's recipients.
 *
 *   1. queueEmails: a Send writes every email as 'queued' under one batch id, one row per recipient per kind (siblings
 *      who share a parent ride one email), and refuses past EMAIL_SEND_CAP: the rest come back as overflow, never
 *      dropped silently.
 *   2. sendNextEmail: the open page calls this in a loop, one email per call, so no call nears the route's 60 s
 *      maxDuration. It claims the batch's next row (meeting_email_claim: skip locked, so two tabs never send the same
 *      row), builds it (the caller's prepare: render + mint the email's link), sends it with the row as Resend's
 *      Idempotency-Key, and records the result. The completion write only lands on the claim it made.
 *      - Resend refused, or it couldn't be built: 'failed' with the reason, and the minted link is removed.
 *      - Timed out, or the send threw: 'unknown'. Resend may still deliver it, so the link stays and nothing re-sends
 *        it on its own (only a person, with Send again). A claim that goes stale (the page died mid-send) turns 'unknown' the same way.
 *   3. unfinishedSends: batches that still hold queued emails nobody is sending (the page closed partway). The screen
 *      shows "N emails didn't finish sending · Send them now"; there is no timer, so nothing sends without a person.
 *   4. requeueEmails: "Send again" for failed or unknown rows: new rows in a new batch; the old rows stay as the record.
 *      A new row is a new Idempotency-Key, so sending an 'unknown' one again CAN deliver twice: the screen says "Check
 *      before sending again". The key only guards retries of the same row.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOneEmail, type SendOneResult } from '@/lib/email';
import type { PlanSent } from '@/lib/meeting-email-build';

/** At most this many emails per Send. Shown on the confirmation and in "How this works". */
export const EMAIL_SEND_CAP = 150;
/** One email that hasn't answered by now counts as unknown, so a call stays well inside maxDuration. */
export const EMAIL_SEND_TIMEOUT_MS = 15_000;
/** A 'sending' claim older than this turns 'unknown'. Must stay above the send route's maxDuration (60 s). */
export const EMAIL_CLAIM_STALE_SECONDS = 120;

export type EmailKind = 'plan' | 'teacher' | 'reminder';
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'unknown';

export interface EmailAbout {
  scouts?: number[];
  group?: string;
}

export interface QueueEmail {
  kind: EmailKind;
  recipientPersonId: number | null;
  sentTo: string;
  about: EmailAbout;
  /** Each scout's plan as emailed, by person id (lib/meeting-email-build). */
  planSent?: PlanSent | null;
  subject?: string | null;
  bodyMdOverride?: string | null;
}

export interface EmailRow {
  id: number;
  calendar_entry_id: number;
  kind: EmailKind;
  batch_id: string;
  recipient_person_id: number | null;
  sent_to: string;
  about: EmailAbout;
  plan_sent: QueueEmail['planSent'];
  subject: string | null;
  body_md_override: string | null;
  status: EmailStatus;
  failure: string | null;
}

export type QueueResult = { ok: true; batchId: string; queued: number; overflow: QueueEmail[] } | { ok: false; error: string };

/** One row per recipient per kind: a second email to the same address and kind merges its scouts into the first. */
function merged(emails: readonly QueueEmail[]): QueueEmail[] {
  const byKey = new Map<string, QueueEmail>();
  for (const e of emails) {
    const sentTo = e.sentTo.trim().toLowerCase();
    if (!sentTo) continue;
    const key = `${e.kind}|${sentTo}|${e.about.group ?? ''}`;
    const was = byKey.get(key);
    if (!was) {
      byKey.set(key, { ...e, sentTo, about: { ...e.about, scouts: e.about.scouts ? [...e.about.scouts] : undefined } });
      continue;
    }
    if (e.about.scouts) was.about.scouts = [...new Set([...(was.about.scouts ?? []), ...e.about.scouts])];
    if (e.planSent) was.planSent = { ...(was.planSent ?? {}), ...e.planSent };
  }
  return [...byKey.values()];
}

export async function queueEmails(sb: SupabaseClient, input: { entryId: number; actorPersonId: number; emails: readonly QueueEmail[] }): Promise<QueueResult> {
  const all = merged(input.emails);
  const take = all.slice(0, EMAIL_SEND_CAP);
  const overflow = all.slice(EMAIL_SEND_CAP);
  const batchId = randomUUID();
  if (!take.length) return { ok: true, batchId, queued: 0, overflow };
  const { error } = await sb.from('meeting_emails').insert(
    take.map((e) => ({
      calendar_entry_id: input.entryId,
      kind: e.kind,
      batch_id: batchId,
      recipient_person_id: e.recipientPersonId,
      sent_to: e.sentTo,
      about: e.about,
      plan_sent: e.planSent ?? null,
      subject: e.subject ?? null,
      body_md_override: e.bodyMdOverride ?? null,
      queued_by_person_id: input.actorPersonId
    }))
  );
  if (error) return { ok: false, error: 'Couldn’t queue the emails. Nothing was sent. Try again.' };
  return { ok: true, batchId, queued: take.length, overflow };
}

export interface Prepared {
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  /** After a definite send: e.g. supersede the recipient's older links. */
  onSent?: () => Promise<void>;
  /** After a definite failure: remove whatever prepare minted. */
  undo?: () => Promise<void>;
}

export type SendFn = (opts: { to: string; subject: string; html: string; text: string; fromName?: string; idempotencyKey: string; tags: { name: string; value: string }[] }) => Promise<SendOneResult | 'timeout'>;

export interface SendDeps {
  prepare: (row: EmailRow) => Promise<Prepared>;
  send?: SendFn;
}

/** sendOneEmail, or 'timeout' once EMAIL_SEND_TIMEOUT_MS passes (the late send may still land). */
export const sendWithin: SendFn = (opts) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), EMAIL_SEND_TIMEOUT_MS);
  });
  return Promise.race([sendOneEmail(opts), timeout]).finally(() => clearTimeout(timer));
};

export type SendStep = { done: true } | { done: false; id: number; status: EmailStatus; failure: string | null };

const UNKNOWN_TEXT = 'The send didn’t report back. Check before sending again.';

export async function sendNextEmail(sb: SupabaseClient, input: { entryId: number; batchId: string }, deps: SendDeps): Promise<SendStep> {
  const send = deps.send ?? sendWithin;
  const { data: claim, error: claimErr } = await sb.rpc('meeting_email_claim', { p_batch: input.batchId, p_entry: input.entryId, p_stale_seconds: EMAIL_CLAIM_STALE_SECONDS });
  if (claimErr) throw new Error('Couldn’t pick the next email. Try again.');
  const c = ((claim ?? []) as { email_id: number; claimed_at: string }[])[0];
  if (!c) return { done: true };
  const { data: rowData, error: rowErr } = await sb.from('meeting_emails').select('*').eq('id', c.email_id).maybeSingle();
  if (rowErr || !rowData) throw new Error('Couldn’t read the next email. Try again.');
  const row = rowData as EmailRow;

  // The completion write lands only on this claim: a row that went stale and was re-decided meanwhile stays as it is.
  const finish = async (patch: Record<string, unknown>): Promise<SendStep> => {
    const { data: hit, error } = await sb.from('meeting_emails').update(patch).eq('id', row.id).eq('status', 'sending').eq('claimed_at', c.claimed_at).select('id');
    // No row: the claim went stale and was re-decided meanwhile (or the write failed). Said in the log, never hidden.
    if (error || !hit?.length) console.error(`meeting email ${row.id}: the ${String(patch.status)} result didn’t land on its claim`, error?.message ?? '');
    return { done: false, id: row.id, status: patch.status as EmailStatus, failure: (patch.failure as string | undefined) ?? null };
  };

  let prepared: Prepared;
  try {
    prepared = await deps.prepare(row);
  } catch {
    return finish({ status: 'failed', failure: 'Couldn’t build this email.' });
  }
  const res = await send({
    to: row.sent_to,
    subject: prepared.subject,
    html: prepared.html,
    text: prepared.text,
    fromName: prepared.fromName,
    idempotencyKey: `meeting-email-${row.id}`,
    tags: [{ name: 'meeting_email_id', value: String(row.id) }]
  });
  if (res === 'timeout' || res.status === 'unknown') return finish({ status: 'unknown', failure: UNKNOWN_TEXT, subject: prepared.subject });
  if (res.status === 'sent') {
    await prepared.onSent?.().catch(() => undefined);
    return finish({ status: 'sent', failure: null, subject: prepared.subject, resend_id: res.id, delivered_to: res.deliveredTo, sent_at: new Date().toISOString() });
  }
  await prepared.undo?.().catch(() => undefined);
  return finish({ status: 'failed', failure: res.detail.slice(0, 500), subject: prepared.subject });
}

export interface UnfinishedSend {
  batchId: string;
  queued: number;
}

/** Batches with queued emails and no sign of a live sender: nothing claimed (or queued) within the stale window. */
export async function unfinishedSends(sb: SupabaseClient, entryId: number, now: number = Date.now()): Promise<UnfinishedSend[]> {
  const { data } = await sb.from('meeting_emails').select('batch_id, status, queued_at, claimed_at').eq('calendar_entry_id', entryId).in('status', ['queued', 'sending', 'sent', 'failed', 'unknown']);
  const cutoff = now - EMAIL_CLAIM_STALE_SECONDS * 1000;
  const byBatch = new Map<string, { queued: number; last: number }>();
  for (const r of (data ?? []) as { batch_id: string; status: EmailStatus; queued_at: string; claimed_at: string | null }[]) {
    const b = byBatch.get(r.batch_id) ?? { queued: 0, last: 0 };
    if (r.status === 'queued') b.queued++;
    b.last = Math.max(b.last, Date.parse(r.queued_at), r.claimed_at ? Date.parse(r.claimed_at) : 0);
    byBatch.set(r.batch_id, b);
  }
  return [...byBatch.entries()].filter(([, b]) => b.queued > 0 && b.last < cutoff).map(([batchId, b]) => ({ batchId, queued: b.queued }));
}

/** "Send again": copies of failed or unknown rows, queued in a new batch. The old rows stay as they were. */
export async function requeueEmails(sb: SupabaseClient, input: { entryId: number; actorPersonId: number; ids: readonly number[] }): Promise<QueueResult> {
  const { data, error } = await sb.from('meeting_emails').select('*').eq('calendar_entry_id', input.entryId).in('id', [...input.ids]).in('status', ['failed', 'unknown']);
  if (error) return { ok: false, error: 'Couldn’t read those emails. Try again.' };
  const rows = (data ?? []) as EmailRow[];
  return queueEmails(sb, {
    entryId: input.entryId,
    actorPersonId: input.actorPersonId,
    emails: rows.map((r) => ({ kind: r.kind, recipientPersonId: r.recipient_person_id, sentTo: r.sent_to, about: r.about, planSent: r.plan_sent, subject: r.subject, bodyMdOverride: r.body_md_override }))
  });
}
