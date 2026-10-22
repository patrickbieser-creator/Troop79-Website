/**
 * Sending meeting invites (Plans/Matcher-Tune-Up.md T-5; Plans/Meeting-Planner-II.md P2b): the bodies of Admin's
 * "Invite teachers…" and "Offer to scouts…", moved here unchanged so the public Meeting Planner sends through the same
 * path. Server-only. The CALLER decides who may send (Admin: an adult holding meeting_plan.use; the planner: an adult
 * holding meeting_planner.edit) and revalidates its own pages; everything about who may be invited is re-decided in
 * createTeachInvites / createPickInvites / createReminders. P5b adds reminders (sendReminders).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBoardScouts, loadMeetingById, loadScoutBoard } from '@/lib/meeting-board';
import { boardName, INTENT_LABEL } from '@/lib/meeting-board-shared';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { recordAudit } from '@/lib/audit';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { sendEmail } from '@/lib/email';
import { fmtDateFull } from '@/lib/format-date';
import { minutesText, pickableKeys, topicWords } from '@/lib/meeting-board-picklist';
import {
  DEFAULT_PICK_INVITE,
  DEFAULT_REMINDER,
  DEFAULT_TEACH_INVITE,
  PICK_INVITE_KIND,
  REMINDER_KIND,
  renderPickInvite,
  renderReminder,
  renderTeachInvite,
  TEACH_INVITE_KIND,
  type InviteTemplate
} from '@/lib/meeting-invite-email';
import { INVITE_SENDER_NAME } from '@/lib/meeting-invites';
import { createPickInvites, createReminders, createTeachInvites, deleteInvites } from '@/lib/meeting-invites-db';
import { siteUrl } from '@/lib/site-url';

export type SendInvitesResult =
  | { ok: true; sent: string[]; skipped: { name: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * Meeting invites, P1 (Plans/Matcher-Tune-Up.md T-5): the Troop 79 Bugler asks the ticked adults to teach one topic
 * at this meeting. Everything about who may be invited is re-decided in createTeachInvites (qa-lead M3); an invite
 * whose email doesn't go out is deleted so the board never counts it.
 */
export async function sendTeachInvites(sb: SupabaseClient, input: { entryId: number; topicKey: string; personIds: number[]; sentBy: number | null }): Promise<SendInvitesResult> {
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string' || !Array.isArray(input.personIds)) {
    return { ok: false, error: 'Malformed request' };
  }
  const catalog = await loadAdvancementCatalog();
  const words = topicWords(input.topicKey, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, undefined, { mbReqs: catalog.meritBadgeRequirements });
  // Freeform topics carry their title on the board, not in the catalog; P1 invites cover catalog topics only.
  if (!words) return { ok: false, error: 'That topic can’t be invited for yet.' };
  const made = await createTeachInvites(sb, { entryId: input.entryId, topicKey: input.topicKey, personIds: input.personIds, sentBy: input.sentBy });
  if (!made.ok) return made;
  const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
  const { data: saved } = await sb
    .from('email_templates')
    .select('subject, body')
    .eq('kind', TEACH_INVITE_KIND)
    .is('retired_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = (saved as InviteTemplate | null) ?? DEFAULT_TEACH_INVITE;
  const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.invites.map((i) => i.personId));
  const firstName = new Map(
    ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
  );

  const sent: string[] = [];
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.invites.map((i) => i.inviteId));
  try {
    for (const inv of made.invites) {
      const { subject, md } = renderTeachInvite(template, {
        name: firstName.get(inv.personId) ?? inv.name,
        topic: words.label,
        code: words.codeLabel,
        minutes: minutesText(words.minutes),
        parts: words.parts.map((p) => `${p.code} ${p.label}`),
        day: entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday'
      });
      const { html, text } = renderMarkdownEmail({ md, actionUrl: `${siteUrl()}/i/${inv.token}`, actionLabel: 'Answer the invite' });
      const res = await sendEmail({ to: [inv.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res.status === 'sent') {
        sent.push(inv.name);
        unsent.delete(inv.inviteId);
      } else {
        skipped.push({ name: inv.name, reason: res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
      }
    }
  } catch {
    const told = new Set(skipped.map((s) => s.name));
    for (const inv of made.invites) if (unsent.has(inv.inviteId) && !told.has(inv.name)) skipped.push({ name: inv.name, reason: 'the email didn’t go out' });
  } finally {
    // An invite whose email never went out must not count as invited, or hold a live link nobody has.
    await deleteInvites(sb, [...unsent]);
  }
  if (sent.length) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.teach',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Invited ${sent.length} to teach ${words.codeLabel}: ${sent.join(', ')}`
    });
  }
  return { ok: true, sent, skipped };
}

export interface ScoutCandidate {
  personId: number;
  name: string;
  /** 'coming', 'not sure yet', 'no answer'; '· picked it' when it's already on their list. */
  note: string;
  /** Proposed: hasn't picked it yet. The leader decides. */
  ticked: boolean;
}

export type ScoutCandidatesResult = { ok: true; scouts: ScoutCandidate[] } | { ok: false; error: string };

/**
 * Meeting invites, P2: who a requirement could be offered to. Every active scout who can pick it for this meeting
 * (not done, in reach) and hasn't said they can't make it; ticked when it isn't on their list yet. A proposal only:
 * sendPickInvites re-decides everything.
 */
export async function scoutCandidates(sb: SupabaseClient, input: { entryId: number; topicKey: string }): Promise<ScoutCandidatesResult> {
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string') return { ok: false, error: 'Malformed request' };
  const meeting = await loadMeetingById(sb, input.entryId);
  if (!meeting || meeting.closed) return { ok: false, error: 'This meeting has no picks.' };
  const catalog = await loadAdvancementCatalog();
  const scouts: ScoutCandidate[] = [];
  for (const scout of await loadBoardScouts(sb)) {
    const board = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId: null });
    const intent = board.view.intent;
    if (intent === 'not_coming' || !pickableKeys(board.pickList).has(input.topicKey)) continue;
    const picked = board.picks.some((p) => p.key === input.topicKey);
    scouts.push({ personId: scout.personId, name: boardName(scout.name), note: `${intent ? INTENT_LABEL[intent] : 'no answer'}${picked ? ' · picked it' : ''}`, ticked: !picked });
  }
  return { ok: true, scouts: scouts.sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.name.localeCompare(b.name)) };
}

/**
 * Meeting invites, P2 (Plans/Matcher-Tune-Up.md T-5): the Troop 79 Bugler offers one requirement to the ticked
 * scouts. One email per recipient (a parent with two invited scouts gets one email with a link for each); parents are
 * always copied, the scout too from 13. An email that doesn't go out takes its invites with it.
 */
export async function sendPickInvites(sb: SupabaseClient, input: { entryId: number; topicKey: string; scoutIds: number[]; sentBy: number | null }): Promise<SendInvitesResult> {
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string' || !Array.isArray(input.scoutIds)) {
    return { ok: false, error: 'Malformed request' };
  }
  const catalog = await loadAdvancementCatalog();
  const words = topicWords(input.topicKey, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, undefined, { mbReqs: catalog.meritBadgeRequirements });
  if (!words) return { ok: false, error: 'That topic can’t be offered yet.' };
  const made = await createPickInvites(sb, { entryId: input.entryId, topicKey: input.topicKey, scoutIds: input.scoutIds, sentBy: input.sentBy });
  if (!made.ok) return made;

  const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
  const { data: saved } = await sb
    .from('email_templates')
    .select('subject, body')
    .eq('kind', PICK_INVITE_KIND)
    .is('retired_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = (saved as InviteTemplate | null) ?? DEFAULT_PICK_INVITE;
  const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.recipients.map((r) => r.recipientId));
  const firstName = new Map(
    ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
  );
  const day = entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday';

  const sentTo: string[] = [];
  const offered = new Set<string>();
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.recipients.flatMap((r) => r.scouts.map((s) => s.inviteId)));
  try {
    for (const r of made.recipients) {
      const scoutNames = r.scouts.map((s) => boardName(s.scoutName));
      const { subject, md } = renderPickInvite(
        template,
        {
          name: firstName.get(r.recipientId) ?? r.name,
          scouts: r.isScout ? 'you' : scoutNames.join(' and '),
          topic: words.label,
          code: words.codeLabel,
          parts: words.parts.map((p) => `${p.code} ${p.label}`),
          day
        },
        r.scouts.map((s) => ({ scoutName: boardName(s.scoutName), url: `${siteUrl()}/i/${s.token}` })),
        r.isScout
      );
      const { html, text } = renderMarkdownEmail({ md });
      const res = await sendEmail({ to: [r.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res.status === 'sent') {
        sentTo.push(r.name);
        for (const s of r.scouts) {
          unsent.delete(s.inviteId);
          offered.add(boardName(s.scoutName));
        }
      } else {
        skipped.push({ name: r.name, reason: res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
      }
    }
  } catch {
    // Whoever wasn't reached is reported below; their invites go with the finally.
  } finally {
    await deleteInvites(sb, [...unsent]);
  }
  if (sentTo.length) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.pick',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Offered ${words.codeLabel} to ${[...offered].join(', ')} (${sentTo.length} emails)`
    });
  }
  return { ok: true, sent: [...offered], skipped };
}

/** The template saved for a kind (the newest live one), else the default. */
async function templateFor(sb: SupabaseClient, kind: string, fallback: InviteTemplate): Promise<InviteTemplate> {
  const { data } = await sb.from('email_templates').select('subject, body').eq('kind', kind).is('retired_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as InviteTemplate | null) ?? fallback;
}

/**
 * Meeting Planner P5b (Plans/Meeting-Planner-II.md Decision 11): the Troop 79 Bugler reminds the chosen people who
 * haven't answered. One email per recipient naming everyone it covers (a parent with two unanswered scouts gets one);
 * the button is the plain meeting page, no token. A reminder whose email doesn't go out is deleted, so the 24-hour
 * dedupe never holds back someone who was never reached.
 */
export type SendRemindersResult = { ok: true; sent: string[]; reminded: number[]; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

export async function sendReminders(sb: SupabaseClient, input: { entryId: number; personIds: number[]; sentBy: number | null }): Promise<SendRemindersResult> {
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.personIds)) return { ok: false, error: 'Malformed request' };
  const made = await createReminders(sb, { entryId: input.entryId, personIds: input.personIds, sentBy: input.sentBy });
  if (!made.ok) return made;

  const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
  const template = await templateFor(sb, REMINDER_KIND, DEFAULT_REMINDER);
  const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.recipients.map((r) => r.recipientId));
  const firstName = new Map(
    ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
  );
  const day = entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday';
  const url = `${siteUrl()}/member/meeting`;

  const reminded = new Set<string>();
  const remindedIds = new Set<number>();
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.recipients.flatMap((r) => r.people.map((p) => p.inviteId)));
  let emails = 0;
  try {
    for (const r of made.recipients) {
      const self = r.people.length === 1 && r.people[0].personId === r.recipientId;
      const { subject, md } = renderReminder(template, {
        name: firstName.get(r.recipientId) ?? r.name,
        people: r.isScout || self ? 'you' : r.people.map((p) => boardName(p.name)).join(' and '),
        day
      });
      const { html, text } = renderMarkdownEmail({ md, actionUrl: url, actionLabel: 'Answer on the meeting page' });
      const res = await sendEmail({ to: [r.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res.status === 'sent') {
        emails++;
        for (const p of r.people) {
          unsent.delete(p.inviteId);
          reminded.add(boardName(p.name));
          remindedIds.add(p.personId);
        }
      } else {
        skipped.push({ name: r.name, reason: res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
      }
    }
  } catch {
    // Whoever wasn't reached keeps no reminder row; the finally deletes them.
  } finally {
    await deleteInvites(sb, [...unsent]);
  }
  if (emails) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.remind',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Reminded ${[...reminded].join(', ')} (${emails} emails)`
    });
  }
  return { ok: true, sent: [...reminded], reminded: [...remindedIds], skipped };
}
