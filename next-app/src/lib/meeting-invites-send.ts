/**
 * Sending meeting invites (Plans/Matcher-Tune-Up.md T-5; Plans/Meeting-Planner-II.md P2b): the bodies of Admin's
 * "Invite teachers…" and "Offer to scouts…", moved here unchanged so the public Meeting Planner sends through the same
 * path. Server-only. The CALLER decides who may send (Admin: an adult holding meeting_plan.use; the planner: an adult
 * holding meeting_planner.edit) and revalidates its own pages; everything about who may be invited is re-decided in
 * createTeachInvites / createPickInvites / createReminders. P5b adds reminders (sendReminders).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBoardScouts, loadEffectivePicks, loadIntents, loadMeetingById, loadScoutProgress } from '@/lib/meeting-board';
import { boardName, INTENT_LABEL } from '@/lib/meeting-board-shared';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { recordAudit } from '@/lib/audit';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { sendEmail } from '@/lib/email';
import { fmtDateFull } from '@/lib/format-date';
import { buildPickList, minutesText, pickableKeys, rankOfKey, rankTrees, topicWords } from '@/lib/meeting-board-picklist';
import { badgeName, likelyFit, unfinishedMembers } from '@/lib/build-plan';
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
import { focusPicks, loadFocusTopics, loadTopicWordsFor } from '@/lib/meeting-focus-db';
import { createPickInvites, createReminders, createTeachInvites, deleteInvites, type ReminderRecipient } from '@/lib/meeting-invites-db';
import { siteUrl } from '@/lib/site-url';
import { parentPs, personIdsWithEmail, scoutFirstNames } from '@/lib/parent-email';

/** An invite's words: catalog keys from the catalog, a focus group or freeform topic from its row on this meeting. */
export async function inviteWords(sb: SupabaseClient, entryId: number, key: string) {
  const [catalog, own] = await Promise.all([loadAdvancementCatalog(), loadTopicWordsFor(sb, entryId, key)]);
  return topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, own.titles, { mbReqs: catalog.meritBadgeRequirements, members: own.members });
}

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
  const words = await inviteWords(sb, input.entryId, input.topicKey);
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
  /** Their current rank ('scout'), for "Working on Tenderfoot" (Build a Plan B3's sheet). */
  currentRank?: string | null;
  /** B6: the likely rule (lib/build-plan likelyFit), decided here where the scout's progress is at hand. */
  likely?: boolean;
  /** B6: a mix's parts that make it likely ('4a', '5c'), for the reason line. */
  covers?: string[];
  /** B6: an MB requirement's badge, when it is in progress ('First Aid'), for the reason line. */
  badge?: string | null;
}

export type ScoutCandidatesResult = { ok: true; scouts: ScoutCandidate[] } | { ok: false; error: string };

/**
 * Meeting invites, P2: who a requirement could be offered to. Every active scout who can pick it for this meeting
 * (not done, in reach) and hasn't said they can't make it; ticked when it isn't on their list yet. A proposal only:
 * sendPickInvites re-decides everything. One key: scoutCandidatesMany with one key.
 */
export async function scoutCandidates(
  sb: SupabaseClient,
  input: { entryId: number; topicKey: string },
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<ScoutCandidatesResult> {
  if (!input || typeof input.topicKey !== 'string') return { ok: false, error: 'Malformed request' };
  const res = await scoutCandidatesMany(sb, { entryId: input.entryId, keys: [input.topicKey] }, deps);
  return res.ok ? { ok: true, scouts: res.byKey.get(input.topicKey) ?? [] } : res;
}

/** B9: an active scout who hasn't said they can't make it, with what they picked (the orphan count's population). */
export interface EligibleScout {
  personId: number;
  scoutId: string;
  name: string;
  currentRank: string | null;
  /** Their effective picks for this meeting, by key. */
  picked: string[];
}

export type ScoutCandidatesManyResult = { ok: true; byKey: Map<string, ScoutCandidate[]>; eligible: EligibleScout[] } | { ok: false; error: string };

/**
 * Build a Plan B0 (Plans/Build-A-Plan.md): scoutCandidates for many keys over ONE board load. The board is read once
 * for every active scout (progress, seeded focus, effective picks, answers), each scout's pick list is built once,
 * and every key is answered from those lists, so the round trips don't grow with scouts or keys (v1 loaded a whole
 * scout board per scout). Agrees with v1's per-scout loadScoutBoard path key for key (pinned in a test).
 */
export async function scoutCandidatesMany(
  sb: SupabaseClient,
  input: { entryId: number; keys: readonly string[] },
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<ScoutCandidatesManyResult> {
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.keys) || !input.keys.every((k) => typeof k === 'string')) {
    return { ok: false, error: 'Malformed request' };
  }
  const meeting = await loadMeetingById(sb, input.entryId);
  if (!meeting || meeting.closed) return { ok: false, error: 'This meeting has no picks.' };
  const [catalog, scouts, topics, intents] = await Promise.all([
    (deps.loadCatalog ?? loadAdvancementCatalog)(),
    loadBoardScouts(sb),
    loadFocusTopics(sb, meeting.entryId),
    loadIntents(sb, meeting.entryId)
  ]);
  const progress = await loadScoutProgress(sb, scouts.map((s) => s.scoutId));
  const picks = await loadEffectivePicks(sb, meeting, scouts, catalog, progress);
  const focus = focusPicks(topics, catalog);
  // B6: the likely rule's facts (a mix's members, each scout's open badges), from what is already loaded.
  const members = new Map(topics.map((t) => [t.key, t.members]));
  const badges = catalog.meritBadges.map((m) => ({ id: m.id, name: m.name }));
  const trees = rankTrees(catalog.rankRequirements);

  const byKey = new Map<string, ScoutCandidate[]>(input.keys.map((k) => [k, []]));
  const eligible: EligibleScout[] = [];
  for (const scout of scouts) {
    const intent = intents.get(scout.personId) ?? null;
    if (intent === 'not_coming') continue;
    const p = progress.get(scout.scoutId) ?? { rankCodes: new Set<string>(), mbProgress: [] };
    eligible.push({ personId: scout.personId, scoutId: scout.scoutId, name: boardName(scout.name), currentRank: scout.currentRank, picked: (picks.get(scout.personId)?.picks ?? []).map((x) => x.key) });
    // The pick list as loadScoutBoard builds it for a candidate check (no others, teachers or freeform).
    const pickable = pickableKeys(
      buildPickList({
        currentRank: scout.currentRank,
        ranks: catalog.ranks,
        rankReqs: catalog.rankRequirements,
        mbs: catalog.meritBadges,
        mbProgress: p.mbProgress,
        rankCodes: p.rankCodes,
        focus
      })
    );
    const mine = picks.get(scout.personId)?.picks ?? [];
    const awardedMbs = new Set(p.mbProgress.filter((m) => m.awarded).map((m) => m.mb_id));
    const badgesInProgress = new Set(p.mbProgress.filter((m) => !m.awarded && m.has_any_req).map((m) => m.mb_id));
    for (const [key, list] of byKey) {
      if (!pickable.has(key)) continue;
      const picked = mine.some((x) => x.key === key);
      const unfinished = key.startsWith('fg:') ? unfinishedMembers(members.get(key) ?? [], { currentRank: scout.currentRank, ranks: catalog.ranks, trees, rankCodes: p.rankCodes, awardedMbs, badges }) : undefined;
      const fit = likelyFit({ currentRank: scout.currentRank, unfinished, badgesInProgress }, key, catalog.ranks, badges);
      const badge = !key.startsWith('fg:') && fit.likely && !rankOfKey(key, catalog.ranks) ? (badgeName(key, badges) ?? null) : null;
      list.push({
        personId: scout.personId,
        name: boardName(scout.name),
        note: `${intent ? INTENT_LABEL[intent] : 'no answer'}${picked ? ' · picked it' : ''}`,
        ticked: !picked,
        currentRank: scout.currentRank,
        likely: fit.likely,
        covers: fit.covers,
        badge
      });
    }
  }
  for (const list of byKey.values()) list.sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.name.localeCompare(b.name));
  return { ok: true, byKey, eligible };
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
  const words = await inviteWords(sb, input.entryId, input.topicKey);
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
  const pickWithEmail = await personIdsWithEmail(sb, made.recipients.flatMap((r) => (r.isScout ? [] : r.scouts.map((s) => s.scoutId))));

  const sentTo: string[] = [];
  const offered = new Set<string>();
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.recipients.flatMap((r) => r.scouts.map((s) => s.inviteId)));
  try {
    for (const r of made.recipients) {
      // A parent's email names their own scouts by first name (lib/parent-email).
      const first = scoutFirstNames(r.scouts.map((s) => ({ personId: s.scoutId, name: s.scoutName })));
      const nameIn = (s: (typeof r.scouts)[number]) => first.get(s.scoutId) ?? boardName(s.scoutName);
      const scoutNames = r.scouts.map(nameIn);
      const postscript = r.isScout ? null : parentPs(r.scouts.map((s) => ({ personId: s.scoutId, name: nameIn(s) })), pickWithEmail, siteUrl());
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
        r.scouts.map((s) => ({ scoutName: nameIn(s), url: `${siteUrl()}/i/${s.token}` })),
        r.isScout
      );
      const { html, text } = renderMarkdownEmail({ md, postscript });
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
 *
 * Send safety (qa-lead, 2026-10-22): emails go out REMINDER_BATCH at a time; each recipient's rows are deleted the
 * moment their email fails or throws (not only in a final sweep a timeout could skip); and once REMINDER_TIME_BUDGET_MS
 * has passed no new batch starts: the rest are deleted and reported, well inside the planner page's maxDuration.
 */
export type SendRemindersResult = { ok: true; sent: string[]; reminded: number[]; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

/** Emails in flight at once. */
export const REMINDER_BATCH = 5;
/** No new batch starts after this; the planner page's maxDuration is 60 s. */
export const REMINDER_TIME_BUDGET_MS = 40_000;
/** One email that hasn't answered by now counts as not sent, so the last batch still ends inside maxDuration. */
export const REMINDER_EMAIL_TIMEOUT_MS = 15_000;

export const EMAIL_TIMED_OUT = Symbol('timed out');
/** sendEmail, or EMAIL_TIMED_OUT once the timeout passes (the late send may still land; its row is gone by then). */
export function sendEmailWithin(ms: number, opts: Parameters<typeof sendEmail>[0]): Promise<Awaited<ReturnType<typeof sendEmail>> | typeof EMAIL_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof EMAIL_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(EMAIL_TIMED_OUT), ms);
  });
  return Promise.race([sendEmail(opts), timeout]).finally(() => clearTimeout(timer));
}

/** A parent's own scouts in a reminder, by first name (lib/parent-email); none for a scout's own copy. */
function reminderScouts(r: ReminderRecipient): { personId: number; name: string }[] {
  if (r.isScout) return [];
  const others = r.people.filter((p) => p.personId !== r.recipientId);
  const first = scoutFirstNames(others);
  return others.map((p) => ({ personId: p.personId, name: first.get(p.personId) ?? boardName(p.name) }));
}

/** 'you', 'Anjali and Finn', or 'you and Finn' when the recipient is among the people they're reminded about. */
function reminderPeople(r: ReminderRecipient): string {
  if (r.isScout) return 'you';
  const self = r.people.some((p) => p.personId === r.recipientId);
  return [...(self ? ['you'] : []), ...reminderScouts(r).map((p) => p.name)].join(' and ');
}

export async function sendReminders(
  sb: SupabaseClient,
  input: { entryId: number; personIds: number[]; sentBy: number | null },
  deps: { clock?: () => number } = {}
): Promise<SendRemindersResult> {
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.personIds)) return { ok: false, error: 'Malformed request' };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const made = await createReminders(sb, { entryId: input.entryId, personIds: input.personIds, sentBy: input.sentBy });
  if (!made.ok) return made;

  const reminded = new Set<string>();
  const remindedIds = new Set<number>();
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  // Every minted row is unsent until its email goes out; the finally below deletes whatever is left, setup failures included.
  const unsent = new Set(made.recipients.flatMap((r) => r.people.map((p) => p.inviteId)));
  let emails = 0;

  try {
    const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
    const template = await templateFor(sb, REMINDER_KIND, DEFAULT_REMINDER);
    const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.recipients.map((r) => r.recipientId));
    const firstName = new Map(
      ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
    );
    const day = entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday';
    const url = `${siteUrl()}/member/meeting`;
    const withEmail = await personIdsWithEmail(sb, made.recipients.flatMap((r) => reminderScouts(r).map((p) => p.personId)));

    /** One recipient: sent, or their rows are gone (or back in the final sweep) before this returns. Never throws. */
    const remindOne = async (r: ReminderRecipient): Promise<void> => {
      let reason = 'the email didn’t go out';
      try {
        const { subject, md } = renderReminder(template, { name: firstName.get(r.recipientId) ?? r.name, people: reminderPeople(r), day });
        const postscript = parentPs(reminderScouts(r), withEmail, siteUrl());
        const { html, text } = renderMarkdownEmail({ md, actionUrl: url, actionLabel: 'Answer on the meeting page', postscript });
        const res = await sendEmailWithin(REMINDER_EMAIL_TIMEOUT_MS, { to: [r.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
        if (res !== EMAIL_TIMED_OUT && res.status === 'sent') {
          emails++;
          for (const p of r.people) {
            unsent.delete(p.inviteId);
            reminded.add(boardName(p.name));
            remindedIds.add(p.personId);
          }
          return;
        }
        if (res !== EMAIL_TIMED_OUT && res.status === 'skipped') reason = 'email isn’t set up on this server';
      } catch {
        // Reported and deleted below, like any email that didn't go out.
      }
      skipped.push({ name: r.name, reason });
      const ids = r.people.map((p) => p.inviteId);
      for (const id of ids) unsent.delete(id);
      const gone = await deleteInvites(sb, ids).catch(() => false);
      if (!gone) for (const id of ids) unsent.add(id); // the final sweep tries again
    };

    for (let i = 0; i < made.recipients.length; i += REMINDER_BATCH) {
      if (clock() - started > REMINDER_TIME_BUDGET_MS) {
        for (const r of made.recipients.slice(i)) skipped.push({ name: r.name, reason: 'out of time on this send; send again' });
        break;
      }
      await Promise.all(made.recipients.slice(i, i + REMINDER_BATCH).map(remindOne));
    }
  } finally {
    // Whoever wasn't reached keeps no reminder row.
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
