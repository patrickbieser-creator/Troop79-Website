/**
 * Meeting Planner III, "Publish snapshot" (Plans/Meeting-Planner-III.md, Decision 5). Server-only; the caller gates
 * (an adult holding meeting_planner.edit, on one of the next meetings).
 *
 *   1. Today's plan (lib/this-week) → the families-visible payload and its hash. A republish with nothing changed is
 *      refused, and two publishes at once can't both land: snapshot n+1 is a primary key.
 *   2. Who to email: every active scout's family the first time; after that only scouts whose options or suggestions
 *      changed, unless "Email everyone". Recipients follow the reminders' rule (lib/meeting-invites-db
 *      scoutRecipientsMany: parents who may act for the scout; the scout too from 13 with a verified address), one
 *      email per recipient naming all their scouts.
 *   3. Each recipient gets a NEW family link (lib/plan-pages) in their email; once it has gone out, their older links
 *      for this meeting are superseded; a link whose email didn't go out is deleted.
 *   Send safety (like reminders): PUBLISH_BATCH at a time, no new batch after PUBLISH_TIME_BUDGET_MS, each email capped
 *   at PUBLISH_EMAIL_TIMEOUT_MS; whoever wasn't reached is reported. Publishing again with nothing changed sends the
 *   same snapshot to the families with no link for it yet (qa-lead 2026-10-28), and to nobody else.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { fmtDateFull } from '@/lib/format-date';
import type { BoardMeeting } from '@/lib/meeting-board';
import { INVITE_SENDER_NAME, inviteExpiresAt } from '@/lib/meeting-invites';
import { loadScoutFamilies, scoutRecipientsMany } from '@/lib/meeting-invites-db';
import { DEFAULT_PLAN_PUBLISHED, PLAN_PAGE_BUTTON, PLAN_PUBLISHED_KIND, renderPlanPublished, type InviteTemplate } from '@/lib/meeting-invite-email';
import { EMAIL_TIMED_OUT, sendEmailWithin } from '@/lib/meeting-invites-send';
import { boardName, firstNameOf } from '@/lib/meeting-board-shared';
import { siteUrl } from '@/lib/site-url';
import { changedScouts, snapshotPayload, type SnapshotPayload } from '@/lib/plan-snapshot';
import { loadLatestSnapshot, payloadHash } from '@/lib/plan-snapshot-db';
import { deletePlanPage, mintPlanPage, supersedeOlderPlanPages } from '@/lib/plan-pages';
import type { ThisWeek } from '@/lib/this-week';

export const PUBLISH_BATCH = 5;
export const PUBLISH_TIME_BUDGET_MS = 40_000;
export const PUBLISH_EMAIL_TIMEOUT_MS = 15_000;

export type PublishOutcome =
  | { ok: true; n: number; emailed: number; families: number; skipped: { name: string; reason: string }[] }
  | { ok: false; error: string };

async function templateFor(sb: SupabaseClient, kind: string, fallback: InviteTemplate): Promise<InviteTemplate> {
  const { data } = await sb.from('email_templates').select('subject, body').eq('kind', kind).is('retired_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as InviteTemplate | null) ?? fallback;
}

interface Family {
  recipientId: number;
  sentTo: string;
  epoch: number;
  isScout: boolean;
  scouts: { personId: number; name: string }[];
}

export async function publishPlan(
  sb: SupabaseClient,
  input: { meeting: Pick<BoardMeeting, 'entryId' | 'date'>; view: ThisWeek; scouts: readonly { personId: number; name: string; isTest?: boolean }[]; actorPersonId: number; everyone: boolean },
  deps: { clock?: () => number; send?: typeof sendEmailWithin } = {}
): Promise<PublishOutcome> {
  const clock = deps.clock ?? Date.now;
  const send = deps.send ?? sendEmailWithin;
  const started = clock();
  const payload: SnapshotPayload = snapshotPayload(input.view);
  const hash = payloadHash(payload);
  const latest = await loadLatestSnapshot(sb, input.meeting.entryId);
  // Nothing changed: send the latest snapshot to the families it hasn't reached yet (a failed or timed-out send).
  const resend = latest != null && latest.hash === hash && !input.everyone;
  const n = resend ? latest.n : (latest?.n ?? 0) + 1;
  let reached = new Set<number>();
  if (resend) {
    const { data, error } = await sb.from('meeting_plan_pages').select('recipient_person_id').eq('calendar_entry_id', input.meeting.entryId).eq('snapshot_n', n).is('revoked_at', null);
    if (error) return { ok: false, error: 'Couldn’t read who has it. Try again.' };
    reached = new Set(((data ?? []) as { recipient_person_id: number }[]).map((r) => r.recipient_person_id));
  } else {
    const { error: snapErr } = await sb.from('meeting_plan_snapshots').insert({
      calendar_entry_id: input.meeting.entryId,
      n,
      payload,
      payload_hash: hash,
      published_by_person_id: input.actorPersonId
    });
    if (snapErr) return { ok: false, error: snapErr.code === '23505' ? 'Someone else just published. Reload to see it.' : 'Couldn’t save the snapshot. Try again.' };
  }

  // Who to email.
  // Test scouts (people.is_test) are never named in an email (qa-lead B10a #1).
  const ids = input.scouts.filter((s) => !s.isTest).map((s) => s.personId);
  const targets = new Set(input.everyone || resend ? ids : changedScouts(latest?.payload ?? null, payload, ids));
  const scouts = input.scouts.filter((s) => targets.has(s.personId));
  const family = await loadScoutFamilies(sb, scouts.map((s) => s.personId));
  const recipients = await scoutRecipientsMany(sb, family, scouts.map((s) => s.personId), input.meeting.date);
  const skipped: { name: string; reason: string }[] = [];
  const byRecipient = new Map<number, Family>();
  for (const s of scouts) {
    const mine = recipients.get(s.personId) ?? [];
    if (!mine.some((m) => !m.isScout)) skipped.push({ name: boardName(s.name), reason: 'no parent with an email in their household' });
    for (const m of mine) {
      const f = byRecipient.get(m.recipientId) ?? { recipientId: m.recipientId, sentTo: m.sentTo, epoch: m.epoch, isScout: m.isScout, scouts: [] };
      f.scouts.push({ personId: s.personId, name: s.name });
      byRecipient.set(m.recipientId, f);
    }
  }
  const families = [...byRecipient.values()].filter((f) => !reached.has(f.recipientId));
  if (resend && !families.length) return { ok: false, error: 'Nothing changed, and every family has this snapshot.' };

  const template = await templateFor(sb, PLAN_PUBLISHED_KIND, DEFAULT_PLAN_PUBLISHED);
  const { data: names } = families.length ? await sb.from('people').select('id, nickname, first_name, display_name').in('id', families.map((f) => f.recipientId)) : { data: [] };
  const firstName = new Map(((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name]));
  const day = fmtDateFull(input.meeting.date);
  const focus = payload.focus.join(' + ') || 'still being planned';
  const expiresAt = inviteExpiresAt(input.meeting.date);
  let emailed = 0;

  const sendOne = async (f: Family): Promise<void> => {
    let page: { id: number; token: string } | null = null;
    try {
      page = await mintPlanPage(sb, { entryId: input.meeting.entryId, recipientId: f.recipientId, epoch: f.epoch, scoutIds: f.scouts.map((s) => s.personId), snapshotN: n, expiresAt });
      const firsts = new Map(f.scouts.map((s) => [s.personId, firstNameOf(s.name)]));
      const people = f.isScout ? 'you' : f.scouts.map((s) => firsts.get(s.personId)!).join(' and ');
      const options = payload.options.map((o) => ({
        title: o.title,
        sub: o.sub,
        suggestedFor: f.scouts.filter((s) => (payload.suggested[String(s.personId)] ?? []).includes(o.key)).map((s) => (f.isScout ? 'you' : firsts.get(s.personId)!))
      }));
      const { subject, md } = renderPlanPublished(template, { name: firstName.get(f.recipientId) ?? '', people, day, focus }, options);
      const { html, text } = renderMarkdownEmail({ md, actionUrl: `${siteUrl()}/i/plan/${page.token}`, actionLabel: PLAN_PAGE_BUTTON });
      const res = await send(PUBLISH_EMAIL_TIMEOUT_MS, { to: [f.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res !== EMAIL_TIMED_OUT && res.status === 'sent') {
        emailed++;
        await supersedeOlderPlanPages(sb, { id: page.id, entryId: input.meeting.entryId, recipientId: f.recipientId });
        return;
      }
      skipped.push({ name: firstName.get(f.recipientId) ?? 'a family', reason: res !== EMAIL_TIMED_OUT && res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
    } catch {
      skipped.push({ name: firstName.get(f.recipientId) ?? 'a family', reason: 'the email didn’t go out' });
    }
    if (page) await deletePlanPage(sb, page.id).catch(() => undefined);
  };

  for (let i = 0; i < families.length; i += PUBLISH_BATCH) {
    if (clock() - started > PUBLISH_TIME_BUDGET_MS) {
      for (const f of families.slice(i)) skipped.push({ name: firstName.get(f.recipientId) ?? 'a family', reason: 'out of time on this send; publish again' });
      break;
    }
    await Promise.all(families.slice(i, i + PUBLISH_BATCH).map(sendOne));
  }
  const { data: was } = await sb.from('meeting_plan_snapshots').select('emailed, meant').eq('calendar_entry_id', input.meeting.entryId).eq('n', n).single();
  const prior = (was as { emailed: number; meant: number } | null) ?? { emailed: 0, meant: 0 };
  await sb
    .from('meeting_plan_snapshots')
    .update(resend ? { emailed: prior.emailed + emailed } : { emailed, meant: families.length })
    .eq('calendar_entry_id', input.meeting.entryId)
    .eq('n', n);
  await recordAudit({
    area: 'meeting',
    action: 'plan.publish',
    entityType: 'calendar_entry',
    entityId: input.meeting.entryId,
    summary: `Published snapshot ${n}: ${focus} (${emailed} email${emailed === 1 ? '' : 's'})`
  }).catch(() => undefined);
  return { ok: true, n, emailed, families: families.length, skipped };
}
