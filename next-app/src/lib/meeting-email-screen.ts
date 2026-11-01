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
import { boardName } from '@/lib/meeting-board-shared';
import { adultRecipients, loadScoutFamilies, scoutMayBeMailed, scoutRecipientsMany, type MailRecipient } from '@/lib/meeting-invites-db';
import { loadFamilyWeek } from '@/lib/family-week';
import type { PeopleLists } from '@/lib/people-lists';
import { buildThisWeek, type ThisWeek, type TwGroup, type TwTeacher } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { planChanged, planSentOf, type PlanSent } from '@/lib/meeting-email-build';
import { EMAIL_SEND_CAP, unfinishedSends, type EmailKind, type EmailStatus, type QueueEmail, type UnfinishedSend } from '@/lib/meeting-emails';
import { teacherCardOf, type TeacherCard } from '@/lib/teacher-email-card';
import { canonicalGroupKey } from '@/lib/focus-plan';
import { answerOf, emailWords, initialsOf, scoutAnswerWord, teacherAnswerWord, toHint } from '@/lib/meeting-email-log';
import {
  DEFAULT_PLAN_PUBLISHED,
  DEFAULT_REMINDER,
  DEFAULT_TEACHER_ASK,
  DEFAULT_TEACHER_PLANNED,
  PLAN_PUBLISHED_KIND,
  REMINDER_KIND,
  TEACHER_ASK_KIND,
  TEACHER_PLANNED_KIND,
  type InviteTemplate
} from '@/lib/meeting-invite-email';
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
  /** A teacher row for someone planned on the card (Confirmations C-D1): the email asks them to confirm it. */
  planned?: boolean;
  /** Copied on the email, not a choice: a scout teacher's parents (Youth Protection). */
  copies?: ScreenRecipient[];
}

export interface LogLine {
  id: number;
  kind: EmailKind;
  at: string;
  to: string;
  toName: string;
  /** The To name's hover: 'Parent of Solomon R · melissa@…', copies (lib/meeting-email-log). */
  toHint: string;
  /** What the email was: 'Solomon R’s plan', 'Ask to teach First Class group'. */
  email: string;
  by: string;
  byInitials: string;
  status: EmailStatus;
  failure: string | null;
  sentAt: string | null;
  delivery: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  /** What they've answered: 'Coming', 'Plan looks good ✓', 'Not this week', 'No answer yet'. */
  answer: string;
  answered: boolean;
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
  templates: { plan: InviteTemplate; reminder: InviteTemplate; teacher: InviteTemplate; teacherPlanned: InviteTemplate };
  /** First names, by person id (the preview's greeting). */
  firstNames: Record<number, string>;
  /** The groups' words for a teacher preview (lib/teacher-email-card): title, requirements, minutes, scouts. */
  groupWords: Record<string, TeacherCard>;
  cap: number;
}

interface LogDb {
  id: number;
  kind: EmailKind;
  recipient_person_id: number | null;
  sent_to: string;
  about: { scouts?: number[]; group?: string; cc?: string[] };
  plan_sent: PlanSent | null;
  status: EmailStatus;
  failure: string | null;
  queued_at: string;
  sent_at: string | null;
  delivery_status: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  queued_by_person_id: number | null;
}

const NO_PARENT = 'no parent email on file';

async function names(sb: SupabaseClient, ids: readonly number[]): Promise<Map<number, { name: string; first: string }>> {
  if (!ids.length) return new Map();
  const { data } = await sb.from('people').select('id, display_name, nickname, first_name').in('id', [...new Set(ids)]);
  return new Map(((data ?? []) as { id: number; display_name: string; nickname: string | null; first_name: string | null }[]).map((p) => [p.id, { name: p.display_name, first: p.nickname || p.first_name || p.display_name }]));
}

/**
 * Who the Teachers tab lists for a group (Patrick, 2026-10-31): a group that has a teacher, only its teachers; one that
 * hasn't, the qualified adults who teach nothing else tonight. Anyone already asked about this group stays (their answer
 * and status show), whatever else holds.
 */
export function askablePeople(g: Pick<TwGroup, 'key' | 'teachers' | 'candidates'>, all: readonly Pick<TwGroup, 'key' | 'teachers'>[], askedIds: readonly number[]): TwTeacher[] {
  const adults = (xs: readonly TwTeacher[]) => xs.filter((t) => t.kind === 'adult');
  const asked = new Set(askedIds);
  // Whoever is planned on the card, an older scout included (Patrick, 2026-11-01: Oliver V on First Class).
  if (g.teachers.length) return [...g.teachers];
  const busy = new Set(all.filter((o) => o.key !== g.key).flatMap((o) => o.teachers.map((t) => t.personId)));
  return [...new Map(adults(g.candidates).filter((t) => asked.has(t.personId) || !busy.has(t.personId)).map((t) => [t.personId, t])).values()];
}

/**
 * A scout teacher's own address, by person id; `why` says what's missing when there's none. Their own roster address,
 * verified or not, at 13 and up (Patrick, 2026-11-01: a Catch-22 otherwise; a scout may not sign in until a teach email
 * asks, and they already get the troop's Bugle there). Family emails keep the verified-address rule
 * (scoutRecipientsMany).
 *
 * `cc` is who the email copies: the parents the family email would go to (scoutRecipientsMany's parents). Youth
 * Protection (Patrick, 2026-11-01): no one-on-one email with a youth, so a scout with no parent address to copy isn't
 * emailed either.
 */
const ccOf = (to: MailRecipient & { cc?: MailRecipient[] }): MailRecipient[] => to.cc ?? [];
export const NO_PARENT_TO_COPY = 'no parent’s email to copy (Youth Protection)';
async function juniorAddresses(sb: SupabaseClient, ids: readonly number[], date: string): Promise<Map<number, MailRecipient & { name: string; cc: MailRecipient[] }> & { why: Map<number, string> }> {
  const out = Object.assign(new Map<number, MailRecipient & { name: string; cc: MailRecipient[] }>(), { why: new Map<number, string>() });
  if (!ids.length) return out;
  const family = await loadScoutFamilies(sb, ids);
  const families = await scoutRecipientsMany(sb, family, ids, date);
  for (const id of ids) {
    const self = family.person.get(id);
    const own = self?.primary_email?.trim();
    const cc = (families.get(id) ?? []).filter((r) => !r.isScout);
    if (self?.active && own && scoutMayBeMailed(self.birthdate, date) && cc.length) out.set(id, { recipientId: id, sentTo: own, epoch: self.session_epoch, isScout: true, name: '', cc });
    else out.why.set(id, !own ? 'no email of their own on file' : !self?.birthdate ? 'no birthdate on file' : !scoutMayBeMailed(self.birthdate, date) ? 'under 13: too young for an email of their own' : NO_PARENT_TO_COPY);
  }
  return out;
}

export async function loadEmailScreen(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, lists: Pick<PeopleLists, 'pool'>, catalog: AdvancementCatalog): Promise<EmailScreen> {
  const data = await loadThisWeekData(sb, meeting, lists, catalog);
  const view = buildThisWeek(data.input);
  const board = (await loadBoardScouts(sb)).filter((s) => !s.isTest);
  const scoutIds = board.map((s) => s.personId);
  const [week, family, logRows, unfinished, templates] = await Promise.all([
    loadFamilyWeek(sb, meeting, scoutIds, catalog, null, { lists }),
    loadScoutFamilies(sb, scoutIds),
    sb.from('meeting_emails').select('*').eq('calendar_entry_id', meeting.entryId).order('queued_at', { ascending: false }),
    unfinishedSends(sb, meeting.entryId),
    Promise.all([templateFor(sb, PLAN_PUBLISHED_KIND, DEFAULT_PLAN_PUBLISHED), templateFor(sb, REMINDER_KIND, DEFAULT_REMINDER), templateFor(sb, TEACHER_ASK_KIND, DEFAULT_TEACHER_ASK), templateFor(sb, TEACHER_PLANNED_KIND, DEFAULT_TEACHER_PLANNED)])
  ]);
  const recipients = await scoutRecipientsMany(sb, family, scoutIds, meeting.date);
  const log = (logRows.data ?? []) as LogDb[];
  const plans = planSentOf(week);
  const intents = data.input.intents;

  // Teachers: every group's candidates and anyone a sent teacher email already asked (merged split keys read as one).
  const asked = log
    .filter((l) => l.kind === 'teacher' && l.status === 'sent' && l.about.group && l.recipient_person_id != null)
    .map((l) => ({ topic_key: canonicalGroupKey(l.about.group!, data.input.mergedBases), invitee_person_id: l.recipient_person_id! }));
  const groups = [...view.groups].sort((a, b) => Number(a.teachers.length > 0) - Number(b.teachers.length > 0));
  const teacherIds = [...new Set([...groups.flatMap((g) => [...g.candidates, ...g.teachers].filter((t) => t.kind === 'adult').map((t) => t.personId)), ...asked.map((a) => a.invitee_person_id), ...view.adultsNoAnswer.map((a) => a.personId)])];
  const adults = await adultRecipients(sb, teacherIds);
  // A scout planned on a card (a Junior Leader) is emailed at their own address.
  const juniors = await juniorAddresses(sb, groups.flatMap((g) => g.teachers.filter((t) => t.kind === 'junior').map((t) => t.personId)), meeting.date);
  const allIds = [...scoutIds, ...[...recipients.values()].flat().map((r) => r.recipientId), ...teacherIds, ...[...juniors.values()].flatMap((j) => j.cc.map((c) => c.recipientId)), ...log.flatMap((l) => [l.queued_by_person_id, l.recipient_person_id, ...(l.about.scouts ?? [])].filter((id): id is number => id != null))];
  const who = await names(sb, allIds);
  const nameOf = (id: number) => (who.get(id) ? boardName(who.get(id)!.name) : 'Someone');
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

  const planStateOf = new Map(view.sections.flatMap((sec) => sec.rows).map((r) => [r.personId, r.state]));
  const scoutRow = (s: (typeof board)[number], kind: 'plan' | 'reminder'): ScreenRow => {
    const fam = week.scouts.find((x) => x.personId === s.personId);
    const list = recipients.get(s.personId) ?? [];
    const last = newest((l) => l.kind === kind && (l.about.scouts ?? []).includes(s.personId));
    const about =
      kind === 'reminder'
        ? 'Coming Sunday? · no answer yet'
        : fam?.kind === 'rank'
          ? `${fam.group?.title} · ${fam.items.filter((i) => i.on).map((i) => i.code).join(', ')}`
          : fam?.kind === 'mb'
            ? fam.group
              ? `${fam.group.name} merit badge`
              : 'Merit badge group'
            : 'Finished everything on offer';
    return {
      id: `${kind}:${s.personId}`,
      kind,
      personId: s.personId,
      name: boardName(s.name),
      rank: s.currentRank,
      isScout: true,
      about,
      group: fam?.group?.key ?? null,
      recipients: toScreen(list),
      blocked: list.some((r) => !r.isScout) ? null : NO_PARENT,
      ...statusOf(last),
      // Confirmations C-D5: the family's yes to the plan, or a plan that changed since.
      answer: kind === 'plan' && planStateOf.get(s.personId) === 'changed' ? 'Changed since yes' : kind === 'plan' && planStateOf.get(s.personId) === 'confirmed' ? 'Answered yes' : intentWord(s.personId),
      changed: kind === 'plan' && !!last?.plan_sent && planChanged(last.plan_sent[String(s.personId)], plans[String(s.personId)])
    };
  };

  const teachers: ScreenRow[] = groups.flatMap((g) => {
    const askedHere = asked.filter((x) => x.topic_key === g.key).map((x) => x.invitee_person_id);
    const people = askablePeople(g, groups, askedHere);
    for (const id of askedHere) if (!people.some((p) => p.personId === id)) people.push({ personId: id, name: nameOf(id), kind: 'adult', intent: null, note: null, formal: nameOf(id) });
    return people.map((t): ScreenRow => {
      const to = adults.to.get(t.personId) ?? juniors.get(t.personId);
      const last = newest((l) => l.kind === 'teacher' && l.about.group === g.key && l.recipient_person_id === t.personId);
      const teaching = g.teachers.some((x) => x.personId === t.personId);
      return {
        id: `teacher:${g.key}:${t.personId}`,
        kind: 'teacher',
        personId: t.personId,
        name: t.name,
        rank: null,
        isScout: false,
        about: `${teaching ? 'Planned to teach' : 'Teach'} ${g.title} · ${g.columns.map((c) => c.code).join(', ')}${g.teachers.length ? '' : ' · No teacher yet'}`,
        group: g.key,
        recipients: to ? [{ personId: to.recipientId, name: to.name || t.name, email: to.sentTo, isScout: t.kind === 'junior' }] : [],
        ...(to && ccOf(to).length ? { copies: ccOf(to).map((c) => ({ personId: c.recipientId, name: nameOf(c.recipientId), email: c.sentTo, isScout: false })) } : {}),
        // Everything on the plan is a proposal (Confirmations): a planned teacher is who gets the email, never blocked.
        blocked: to ? null : (adults.why.get(t.personId) ?? juniors.why.get(t.personId) ?? 'no email on file'),
        ...statusOf(last),
        answer:
          t.state === 'confirmed'
            ? 'Answered yes'
            : t.state === 'changed'
              ? 'Changed since yes'
              : t.state === 'planned'
                ? null
                : g.saidNo.some((n) => n.personId === t.personId)
                  ? 'Said not this week'
                  : null,
        changed: false,
        planned: teaching
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
    log: log
      .map((l): LogLine => {
        const scouts = l.about.scouts ?? [];
        const scoutNames = scouts.map((id) => nameOf(id));
        const group = l.about.group ? view.groups.find((g) => g.key === canonicalGroupKey(l.about.group!, data.input.mergedBases)) : undefined;
        const me = l.recipient_person_id;
        const asTeacher = group?.teachers.find((t) => t.personId === me);
        const no = group?.saidNo.find((n) => n.personId === me);
        const enteredBy = no ? no.enteredBy : asTeacher?.enteredBy;
        const answer =
          l.kind === 'teacher'
            ? answerOf([{ name: '', word: teacherAnswerWord({ state: asTeacher?.state, saidNo: !!no, intent: me ? intents.get(me) : null, by: enteredBy ? initialsOf(enteredBy) : null }) }])
            : scouts.length
              ? answerOf(scouts.map((id) => ({ name: nameOf(id), word: scoutAnswerWord(planStateOf.get(id), intents.get(id)) })))
              : answerOf([{ name: '', word: scoutAnswerWord(undefined, me ? intents.get(me) : null) }]);
        const by = l.queued_by_person_id ? nameOf(l.queued_by_person_id) : '';
        return {
          id: l.id,
          kind: l.kind,
          at: l.sent_at ?? l.queued_at,
          to: l.sent_to,
          toName: me ? nameOf(me) : l.sent_to,
          toHint: toHint({ sentTo: l.sent_to, recipientIsScout: me != null && scouts.includes(me), scoutNames, cc: l.about.cc ?? [] }),
          email: emailWords({ kind: l.kind, scoutNames, groupTitle: group?.title ?? null, planned: !!asTeacher }),
          by,
          byInitials: l.queued_by_person_id && who.get(l.queued_by_person_id) ? initialsOf(who.get(l.queued_by_person_id)!.name) : '',
          status: l.status,
          failure: l.failure,
          sentAt: l.sent_at,
          delivery: l.delivery_status,
          deliveredAt: l.delivered_at,
          openedAt: l.opened_at,
          answer: answer.word,
          answered: answer.answered,
          people: [...scouts, ...(me ? [me] : [])]
        };
      })
      // Newest first by when it went (a batch's lines interleave by queue time otherwise).
      .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id),
    unfinished,
    plans,
    templates: { plan: templates[0], reminder: templates[1], teacher: templates[2], teacherPlanned: templates[3] },
    firstNames: Object.fromEntries([...who].map(([id, n]) => [id, n.first])),
    groupWords: Object.fromEntries(view.groups.flatMap((g) => {
      const card = teacherCardOf(view, data.input, g.key, catalog);
      return card ? [[g.key, card]] : [];
    })),
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
  /** A deliberate second email (a row already sent, or Send again). Without it, anyone already emailed is refused. */
  resend?: boolean;
}

export type BuildQueueResult = { ok: true; emails: QueueEmail[]; refused: string[] } | { ok: false; error: string };

/** The client's selection, re-decided: recipients, addresses and plans from the server. A request it can't honor is
 *  refused with a reason, never sent to someone else. */
export async function buildQueue(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, view: ThisWeek, lists: Pick<PeopleLists, 'pool'>, catalog: AdvancementCatalog, reqs: readonly QueueRequest[]): Promise<BuildQueueResult> {
  if (!Array.isArray(reqs) || reqs.length > EMAIL_SEND_CAP * 2) return { ok: false, error: 'Malformed request' };
  if (!reqs.every((r) => r && Number.isInteger(r.recipientId) && (r.scoutIds == null || (Array.isArray(r.scoutIds) && r.scoutIds.every((n: unknown) => Number.isInteger(n)))))) return { ok: false, error: 'Malformed request' };
  // Already emailed (qa-lead E3 #2): a stale page or a second tab doesn't send families the same email again.
  const { data: prior } = await sb.from('meeting_emails').select('kind, recipient_person_id, about').eq('calendar_entry_id', meeting.entryId).in('status', ['queued', 'sending', 'sent', 'unknown']);
  const priorRows = (prior ?? []) as { kind: EmailKind; recipient_person_id: number | null; about: { scouts?: number[]; group?: string } }[];
  const already = (r: QueueRequest) =>
    priorRows.some(
      (p) =>
        p.kind === r.kind &&
        p.recipient_person_id === r.recipientId &&
        (r.kind === 'teacher' ? p.about.group === r.group : (r.scoutIds ?? []).length ? (r.scoutIds ?? []).some((id) => (p.about.scouts ?? []).includes(id)) : !(p.about.scouts ?? []).length)
    );
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
    if (!r.resend && already(r)) {
      refused.push('someone already emailed (tick the row again to resend)');
      continue;
    }
    if (r.kind === 'teacher') {
      const planned = view.groups.find((g) => g.key === r.group)?.teachers.some((t) => t.kind === 'junior' && t.personId === r.recipientId);
      const to = adults.to.get(r.recipientId) ?? (planned ? (await juniorAddresses(sb, [r.recipientId], meeting.date)).get(r.recipientId) : undefined);
      if (!to || !r.group || !groups.has(r.group)) {
        refused.push('a teacher who can’t be asked');
        continue;
      }
      const cc = ccOf(to).map((c) => c.sentTo);
      emails.push({ kind: 'teacher', recipientPersonId: to.recipientId, sentTo: to.sentTo, about: { group: r.group, ...(cc.length ? { cc } : {}) }, bodyMdOverride: clean(r.override) });
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
