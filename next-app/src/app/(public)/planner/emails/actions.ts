'use server';

/**
 * The Emails screen (Plans/Meeting-Planner-III-Emails.md, E3): queue, send one, send again. Adults holding
 * meeting_planner.edit only (Q9): a scout editor, the SPL included, is refused before anything is read or written; the
 * gate is planner rights, never leader rights. Every action re-checks the right and the meeting (one of the next
 * PLANNER_WEEKS open meetings); a send only ever drains a batch of THIS meeting. Recipients, addresses and plans are
 * re-decided on the server (lib/meeting-email-screen buildQueue).
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { recordAudit } from '@/lib/audit';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { loadPlannerLists } from '@/lib/people-lists';
import { buildThisWeek, PLANNER_WEEKS } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { claimRetry, queueEmails, sendNextEmail, type SendStep } from '@/lib/meeting-emails';
import { prepareEmail } from '@/lib/meeting-email-prepare';
import { buildQueue, type QueueRequest } from '@/lib/meeting-email-screen';

const ADULTS_ONLY = 'Only adults who can edit the Meeting Planner send email.';

async function gate(entryId: unknown) {
  if (!plannerAccess(await resolveAdminActor()).canEmail) return { ok: false as const, error: ADULTS_ONLY };
  return plannerSeeder(entryId, { within: PLANNER_WEEKS, right: 'edit' });
}

export type QueueActionResult = { ok: true; batchId: string; queued: number; overflow: number; refused: string[] } | { ok: false; error: string };

export async function emailsQueueAction(input: { entryId: number; emails: QueueRequest[] }): Promise<QueueActionResult> {
  const s = await gate(input?.entryId);
  if (!s.ok) return s;
  try {
    const lists = await loadPlannerLists();
    const catalog = await loadAdvancementCatalog();
    const data = await loadThisWeekData(s.sb, s.meeting, lists, catalog);
    const built = await buildQueue(s.sb, s.meeting, buildThisWeek(data.input), lists, catalog, input.emails);
    if (!built.ok) return built;
    if (!built.emails.length) return { ok: false, error: 'None of those can be sent.' };
    const q = await queueEmails(s.sb, { entryId: s.meeting.entryId, actorPersonId: s.actorPersonId, emails: built.emails });
    if (!q.ok) return q;
    await recordAudit({ area: 'meeting', action: 'emails.queue', entityType: 'calendar_entry', entityId: s.meeting.entryId, summary: `Queued ${q.queued} email${q.queued === 1 ? '' : 's'}` }).catch(() => undefined);
    return { ok: true, batchId: q.batchId, queued: q.queued, overflow: q.overflow.length, refused: built.refused };
  } catch (e) {
    console.error('emails queue failed:', e);
    return { ok: false, error: 'Couldn’t queue the emails. Nothing was sent. Try again.' };
  }
}

export type SendNextResult = ({ ok: true } & SendStep) | { ok: false; error: string };

/** One email of the batch: the page calls this until it says done. */
export async function emailsSendNextAction(input: { entryId: number; batchId: string }): Promise<SendNextResult> {
  if (typeof input?.batchId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.batchId)) return { ok: false, error: 'Malformed request' };
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  try {
    const { data: focusRows } = await s.sb.from('meeting_topics').select('title').eq('calendar_entry_id', s.meeting.entryId).eq('kind', 'focus_group').not('seeded_at', 'is', null).order('seeded_at');
    const focus = ((focusRows ?? []) as { title: string }[]).map((r) => r.title).join(' + ');
    const step = await sendNextEmail(s.sb, { entryId: s.meeting.entryId, batchId: input.batchId }, { prepare: (row) => prepareEmail(s.sb, row, { meeting: s.meeting, focus }) });
    if (step.done) revalidatePath('/planner/emails');
    return { ok: true, ...step };
  } catch (e) {
    console.error('emails send failed:', e);
    return { ok: false, error: 'That email didn’t go out. Try again.' };
  }
}

/** "Send again" for failed or unknown emails: each claimed once ('retried'), then re-decided like a new Send
 *  (recipients, address, plan: qa-lead E3 #3) and sent the same way. */
export async function emailsRequeueAction(input: { entryId: number; ids: number[] }): Promise<QueueActionResult> {
  if (!Array.isArray(input?.ids) || !input.ids.every((n) => Number.isInteger(n)) || input.ids.length > 300) return { ok: false, error: 'Malformed request' };
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  try {
    const rows = await claimRetry(s.sb, { entryId: s.meeting.entryId, ids: input.ids });
    if (!rows.length) return { ok: false, error: 'Those were already sent again, or went through.' };
    const lists = await loadPlannerLists();
    const catalog = await loadAdvancementCatalog();
    const data = await loadThisWeekData(s.sb, s.meeting, lists, catalog);
    const reqs: QueueRequest[] = rows.flatMap((r) =>
      r.recipient_person_id == null ? [] : [{ kind: r.kind, recipientId: r.recipient_person_id, scoutIds: r.about.scouts, group: r.about.group, override: r.body_md_override, resend: true }]
    );
    const built = await buildQueue(s.sb, s.meeting, buildThisWeek(data.input), lists, catalog, reqs);
    if (!built.ok) return built;
    if (!built.emails.length) return { ok: false, error: `None of those can be sent again: ${built.refused.join('; ')}.` };
    const q = await queueEmails(s.sb, { entryId: s.meeting.entryId, actorPersonId: s.actorPersonId, emails: built.emails });
    if (!q.ok) return q;
    return { ok: true, batchId: q.batchId, queued: q.queued, overflow: q.overflow.length, refused: built.refused };
  } catch (e) {
    console.error('emails send again failed:', e);
    return { ok: false, error: 'Couldn’t send those again. Try again.' };
  }
}
