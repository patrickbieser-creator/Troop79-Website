/**
 * Meeting Planner III Emails (E3): the Emails screen's data, and the queue request it sends back. Server-only,
 * service role; the CALLER gates (an adult holding meeting_planner.edit) and passes the meeting.
 *
 * Tabs (prototypes/meeting-plan-III/Emails.dc.html):
 *   - Scouts and families: one row per active scout (test scouts never), the plan email to their parents (and the
 *     scout from 13), the recipients picked by the reminders' rule (scoutRecipientsMany).
 *   - Teachers: every group, no-teacher groups first; a row per qualified candidate plus anyone already asked.
 *   - Coming? reminders: scouts with no answer (their household) and adults who could teach and haven't answered.
 *   - Sent log: one line per email, newest first.
 * Each row's status reads from the newest log row that covers it. "Plan changed since sent" compares the plan as
 * emailed with the plan now, both before a family's own changes.
 *
 * buildQueue re-decides everything the client sent: every recipient must still be one the rule allows for every scout
 * on the email; the address and the plan as emailed come from here, never from the client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardScouts, type BoardMeeting } from '@/lib/meeting-board';
import { adultRecipients, loadScoutFamilies, scoutRecipientsMany, type MailRecipient } from '@/lib/meeting-invites-db';
import { loadFamilyWeek } from '@/lib/family-week';
import type { PeopleLists } from '@/lib/people-lists';
import { buildThisWeek, type ThisWeek } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { planChanged, planSentOf, type PlanSent } from '@/lib/meeting-email-build';
import { EMAIL_SEND_CAP, unfinishedSends, type EmailKind, type EmailStatus, type QueueEmail, type UnfinishedSend } from '@/lib/meeting-emails';
import { DEFAULT_INVITE_DIGEST, DEFAULT_PLAN_PUBLISHED, DEFAULT_REMINDER, INVITE_DIGEST_KIND, PLAN_PUBLISHED_KIND, REMINDER_KIND, type InviteTemplate } from '@/lib/meeting-invite-email';
import { templateFor } from '@/lib/meeting-email-prepare';

export interface ScreenRecipient {
  personId: number;
  name: string;
  email: string;
  isScout: boolean;
}

export type RowState = 'new' | EmailStatus;

export interface ScreenRow {
  /** 'plan:<scout>' · 'teacher:<group>:<person>' · 'reminder:<person>'. */
  id: string;
  kind: EmailKind;
  /** The scout (plan, a scout's reminder) or the adult (teacher, an adult's reminder). */
  personId: number;
  name: string;
  rank: string | null;
  isScout: boolean;
  about: string;
  group: string | null;
  recipients: ScreenRecipient[];
  blocked: string | null;
  state: RowState;
  /** 'Sent Wed 7:05 pm · not opened', 'Opened …', 'Failed · bounced'. */
  sentAt: string | null;
  openedAt: string | null;
  delivery: string | null;
  failure: string | null;
  answer: string | null;
  changed: boolean;
}

export interface LogLine {
  id: number;
  kind: EmailKind;
  at: string;
  to: string;
  toName: string;
  about: string;
  by: string;
  status: EmailStatus;
  failure: string | null;
  sentAt: string | null;
  delivery: string | null;
  openedAt: string | null;
  /** People it covers (for a row's History). */
  people: number[];
}

export interface EmailScreen {
  entryId: number;
  focus: string;
  scouts: ScreenRow[];
  teachers: ScreenRow[];
  reminders: ScreenRow[];
  log: LogLine[];
  unfinished: UnfinishedSend[];
  /** Each scout's plan now (for the preview). */
  plans: PlanSent;
  templates: { plan: InviteTemplate; reminder: InviteTemplate; teacher: InviteTemplate };
  /** First names, by person id (the preview's greeting). */
  firstNames: Record<number, string>;
  /** The groups' words for a teacher preview: name and requirement codes. */
  groupWords: Record<string, { name: string; codes: string }>;
  cap: number;
}

interface LogDb {
  id: number;
  kind: EmailKind;
  recipient_person_id: number | null;
  sent_to: string;
  about: { scouts?: number[]; group?: string };
  plan_sent: PlanSent | null;
  status: EmailStatus;
  failure: string | null;
  queued_at: string;
  sent_at: string | null;
  delivery_status: string | null;
  opened_at: string | null;
  queued_by_person_id: number | null;
}

const NO_PARENT = 'no parent email on file';

async function names(sb: SupabaseClient, ids: readonly number[]): Promise<Map<number, { name: string; first: string }>> {
  if (!ids.length) return new Map();
  const { data } = await sb.from('people').select('id, display_name, nickname, first_name').in('id', [...new Set(ids)]);
  return new Map(((data ?? []) as { id: number; display_name: string; nickname: string | null; first_name: string | null }[]).map((p) => [p.id, { name: p.display_name, first: p.nickname || p.first_name || p.display_name }]));
}

export async function loadEmailScreen(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, lists: Pick<PeopleLists, 'pool'>, catalog: AdvancementCatalog): Promise<EmailScreen> {
  const data = await loadThisWeekData(sb, meeting, lists, catalog);
  const view = buildThisWeek(data.input);
  const board = (await loadBoardScouts(sb)).filter((s) => !s.isTest);
  const scoutIds = board.map((s) => s.personId);
  const [week, family, logRows, invites, unfinished, templates] = await Promise.all([
    loadFamilyWeek(sb, meeting, scoutIds, catalog, null, { lists }),
    loadScoutFamilies(sb, scoutIds),
    sb.from('meeting_emails').select('*').eq('calendar_entry_id', meeting.entryId).order('queued_at', { ascending: false }),
    sb.from('meeting_invites').select('topic_key, invitee_person_id, response').eq('calendar_entry_id', meeting.entryId).eq('kind', 'teach'),
    unfinishedSends(sb, meeting.entryId),
    Promise.all([templateFor(sb, PLAN_PUBLISHED_KIND, DEFAULT_PLAN_PUBLISHED), templateFor(sb, REMINDER_KIND, DEFAULT_REMINDER), templateFor(sb, INVITE_DIGEST_KIND, DEFAULT_INVITE_DIGEST)])
  ]);
  const recipients = await scoutRecipientsMany(sb, family, scoutIds, meeting.date);
  const log = (logRows.data ?? []) as LogDb[];
  const plans = planSentOf(week);
  const intents = data.input.intents;

  // Teachers: every group's candidates and anyone already asked.
  const asked = (invites.data ?? []) as { topic_key: string; invitee_person_id: number; response: string | null }[];
  const groups = [...view.groups].sort((a, b) => Number(a.teachers.length > 0) - Number(b.teachers.length > 0));
  const teacherIds = [...new Set([...groups.flatMap((g) => [...g.candidates, ...g.teachers].filter((t) => t.kind === 'adult').map((t) => t.personId)), ...asked.map((a) => a.invitee_person_id), ...view.adultsNoAnswer.map((a) => a.personId)])];
  const adults = await adultRecipients(sb, teacherIds);
  const allIds = [...scoutIds, ...[...recipients.values()].flat().map((r) => r.recipientId), ...teacherIds, ...log.flatMap((l) => (l.queued_by_person_id ? [l.queued_by_person_id] : []))];
  const who = await names(sb, allIds);
  const nameOf = (id: number) => who.get(id)?.name ?? 'Someone';
  const toScreen = (list: readonly MailRecipient[]): ScreenRecipient[] => list.map((r) => ({ personId: r.recipientId, name: nameOf(r.recipientId), email: r.sentTo, isScout: r.isScout }));

  const newest = (match: (l: LogDb) => boolean) => log.find(match) ?? null;
  const statusOf = (l: LogDb | null) => ({
    state: (l?.status ?? 'new') as RowState,
    sentAt: l?.sent_at ?? null,
    openedAt: l?.opened_at ?? null,
    delivery: l?.delivery_status ?? null,
    failure: l?.failure ?? null
  });
  const intentWord = (id: number) => {
    const i = intents.get(id);
    return i === 'coming' ? 'Answered yes' : i === 'not_coming' ? 'Said not this week' : i === 'undecided' ? 'Not sure yet' : null;
  };

  const scoutRow = (s: (typeof board)[number], kind: 'plan' | 'reminder'): ScreenRow => {
    const fam = week.scouts.find((x) => x.personId === s.personId);
    const list = recipients.get(s.personId) ?? [];
    const last = newest((l) => l.kind === kind && (l.about.scouts ?? []).includes(s.personId));
    const about =
      kind === 'reminder'
        ? 'Coming Sunday? · no answer yet'
        : fam?.kind === 'rank'
          ? `${fam.group?.name} group · ${fam.items.filter((i) => i.on).map((i) => i.code).join(', ')}`
          : fam?.kind === 'mb'
            ? fam.group
              ? `${fam.group.name} merit badge`
              : 'Merit badge group'
            : 'Finished everything on offer';
    return {
      id: `${kind}:${s.personId}`,
      kind,
      personId: s.personId,
      name: s.name,
      rank: s.currentRank,
      isScout: true,
      about,
      group: fam?.group?.key ?? null,
      recipients: toScreen(list),
      blocked: list.some((r) => !r.isScout) ? null : NO_PARENT,
      ...statusOf(last),
      answer: intentWord(s.personId),
      changed: kind === 'plan' && !!last?.plan_sent && planChanged(last.plan_sent[String(s.personId)], plans[String(s.personId)])
    };
  };

  const teachers: ScreenRow[] = groups.flatMap((g) => {
    const people = [...new Map([...g.candidates.filter((t) => t.kind === 'adult'), ...g.teachers.filter((t) => t.kind === 'adult')].map((t) => [t.personId, t])).values()];
    for (const a of asked.filter((x) => x.topic_key === g.key)) if (!people.some((p) => p.personId === a.invitee_person_id)) people.push({ personId: a.invitee_person_id, name: nameOf(a.invitee_person_id), kind: 'adult', intent: null, note: null, formal: nameOf(a.invitee_person_id) });
    return people.map((t): ScreenRow => {
      const to = adults.to.get(t.personId);
      const last = newest((l) => l.kind === 'teacher' && l.about.group === g.key && l.recipient_person_id === t.personId);
      const inv = asked.find((a) => a.topic_key === g.key && a.invitee_person_id === t.personId);
      const teaching = g.teachers.some((x) => x.personId === t.personId);
      return {
        id: `teacher:${g.key}:${t.personId}`,
        kind: 'teacher',
        personId: t.personId,
        name: t.name,
        rank: null,
        isScout: false,
        about: `Teach ${g.name}${g.kind === 'rank' ? ' group' : ''} · ${g.columns.map((c) => c.code).join(', ')}${g.teachers.length ? '' : ' · No teacher yet'}`,
        group: g.key,
        recipients: to ? [{ personId: to.recipientId, name: to.name, email: to.sentTo, isScout: false }] : [],
        blocked: to ? (teaching ? 'already teaching it' : null) : (adults.why.get(t.personId) ?? 'no email on file'),
        ...statusOf(last),
        answer: inv?.response === 'accepted' ? 'Answered yes' : inv?.response === 'declined' ? 'Said not this week' : null,
        changed: false
      };
    });
  });

  const reminders: ScreenRow[] = [
    ...board.filter((s) => !intents.has(s.personId)).map((s) => scoutRow(s, 'reminder')),
    ...view.adultsNoAnswer.map((a): ScreenRow => {
      const to = adults.to.get(a.personId);
      const last = newest((l) => l.kind === 'reminder' && !(l.about.scouts ?? []).length && l.recipient_person_id === a.personId);
      return {
        id: `reminder:${a.personId}`,
        kind: 'reminder',
        personId: a.personId,
        name: a.name,
        rank: null,
        isScout: false,
        about: 'Coming Sunday? · no answer yet',
        group: null,
        recipients: to ? [{ personId: to.recipientId, name: to.name, email: to.sentTo, isScout: false }] : [],
        blocked: to ? null : (adults.why.get(a.personId) ?? 'no email on file'),
        ...statusOf(last),
        answer: null,
        changed: false
      };
    })
  ];

  return {
    entryId: meeting.entryId,
    focus: view.focus.map((f) => f.name).join(' + '),
    scouts: board.map((s) => scoutRow(s, 'plan')),
    teachers,
    reminders,
    log: log.map((l) => ({
      id: l.id,
      kind: l.kind,
      at: l.sent_at ?? l.queued_at,
      to: l.sent_to,
      toName: l.recipient_person_id ? nameOf(l.recipient_person_id) : l.sent_to,
      about: l.kind === 'teacher' ? `Teach ${view.groups.find((g) => g.key === l.about.group)?.name ?? 'a group'}` : (l.about.scouts ?? []).map((id) => nameOf(id)).join(', ') || 'Coming Sunday?',
      by: l.queued_by_person_id ? nameOf(l.queued_by_person_id) : '',
      status: l.status,
      failure: l.failure,
      sentAt: l.sent_at,
      delivery: l.delivery_status,
      openedAt: l.opened_at,
      people: [...(l.about.scouts ?? []), ...(l.recipient_person_id ? [l.recipient_person_id] : [])]
    })),
    unfinished,
    plans,
    templates: { plan: templates[0], reminder: templates[1], teacher: templates[2] },
    firstNames: Object.fromEntries([...who].map(([id, n]) => [id, n.first])),
    groupWords: Object.fromEntries(view.groups.map((g) => [g.key, { name: g.name, codes: g.columns.map((c) => c.code).join(', ') }])),
    cap: EMAIL_SEND_CAP
  };
}

/** One email the screen asks to send: who it goes to and what it's about. */
export interface QueueRequest {
  kind: EmailKind;
  recipientId: number;
  /** plan / a scout's reminder: the scouts this email covers. */
  scoutIds?: number[];
  /** teacher: the group. */
  group?: string;
  override?: string | null;
}

export type BuildQueueResult = { ok: true; emails: QueueEmail[]; refused: string[] } | { ok: false; error: string };

/** The client's selection, re-decided: recipients, addresses and plans from the server. A request it can't honor is
 *  refused with a reason, never sent to someone else. */
export async function buildQueue(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, view: ThisWeek, lists: Pick<PeopleLists, 'pool'>, catalog: AdvancementCatalog, reqs: readonly QueueRequest[]): Promise<BuildQueueResult> {
  if (!Array.isArray(reqs) || reqs.length > EMAIL_SEND_CAP * 2) return { ok: false, error: 'Malformed request' };
  const board = (await loadBoardScouts(sb)).filter((s) => !s.isTest);
  const active = new Set(board.map((s) => s.personId));
  const scoutIds = [...new Set(reqs.flatMap((r) => r.scoutIds ?? []))].filter((id) => active.has(id));
  const family = await loadScoutFamilies(sb, scoutIds);
  const recipients = await scoutRecipientsMany(sb, family, scoutIds, meeting.date);
  const adultIds = reqs.filter((r) => !(r.scoutIds ?? []).length).map((r) => r.recipientId);
  const adults = await adultRecipients(sb, adultIds);
  const plans = scoutIds.length ? planSentOf(await loadFamilyWeek(sb, meeting, scoutIds, catalog, null, { lists })) : {};
  const groups = new Set(view.groups.map((g) => g.key));
  const emails: QueueEmail[] = [];
  const refused: string[] = [];
  const clean = (s: string | null | undefined) => (typeof s === 'string' && s.trim() ? s.slice(0, 8000) : null);

  for (const r of reqs) {
    if (!r || !['plan', 'teacher', 'reminder'].includes(r.kind) || !Number.isInteger(r.recipientId)) return { ok: false, error: 'Malformed request' };
    const scouts: number[] = (r.scoutIds ?? []).filter((id: number) => Number.isInteger(id));
    if (r.kind === 'teacher') {
      const to = adults.to.get(r.recipientId);
      if (!to || !r.group || !groups.has(r.group)) {
        refused.push('a teacher who can’t be asked');
        continue;
      }
      emails.push({ kind: 'teacher', recipientPersonId: to.recipientId, sentTo: to.sentTo, about: { group: r.group }, bodyMdOverride: clean(r.override) });
      continue;
    }
    if (!scouts.length) {
      const to = adults.to.get(r.recipientId);
      if (r.kind !== 'reminder' || !to) {
        refused.push('someone with no address');
        continue;
      }
      emails.push({ kind: 'reminder', recipientPersonId: to.recipientId, sentTo: to.sentTo, about: { scouts: [] }, bodyMdOverride: clean(r.override) });
      continue;
    }
    const allowed = scouts.every((id) => active.has(id) && (recipients.get(id) ?? []).some((m) => m.recipientId === r.recipientId));
    const to = recipients.get(scouts[0])?.find((m) => m.recipientId === r.recipientId);
    if (!allowed || !to) {
      refused.push('a recipient who can’t answer for those scouts');
      continue;
    }
    emails.push({
      kind: r.kind,
      recipientPersonId: to.recipientId,
      sentTo: to.sentTo,
      about: { scouts },
      planSent: Object.fromEntries(scouts.flatMap((id) => (plans[String(id)] ? [[String(id), plans[String(id)]] as const] : []))),
      bodyMdOverride: clean(r.override)
    });
  }
  return { ok: true, emails, refused };
}
