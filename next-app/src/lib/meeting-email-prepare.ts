/**
 * Meeting Planner III Emails (E3): build one queued email at the moment it sends (lib/meeting-emails' `prepare`).
 * Server-only, service role. It renders from the log row alone (who, which scouts, their plan as emailed, any one-off
 * wording), so the log is the record of what went.
 *
 *   - 'plan' / 'reminder' to a household: a NEW family link (/i/plan/<token>) for the row's scouts, the answer buttons
 *     as ?a= links on it. Kept only once the email went: then it supersedes the recipient's older links for this
 *     meeting; otherwise it is deleted. The link also carries the recipient's own teacher card (as_teacher, F5) when
 *     they may teach on the meeting date (loadTeacherPeople: an adult, or a Junior Leader at their own address).
 *   - 'reminder' to an adult (no scouts): a teacher-only link (no scouts, as_teacher), kept the same way; someone who
 *     may not teach gets the member meeting page, no token.
 *   - 'teacher': one group of the night (Plans/Planner-Teacher-Email-To-Family-Card.md): a teacher-only family link
 *     (no scouts, as_teacher) opening their teacher card, where a planned teacher confirms or changes and an asked one
 *     takes the group or says not this week. Only to someone who may teach on the date; kept the same way.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { fmtDateFull } from '@/lib/format-date';
import {
  DEFAULT_PLAN_PUBLISHED,
  DEFAULT_REMINDER,
  DEFAULT_TEACHER_ASK,
  DEFAULT_TEACHER_PLANNED,
  PLAN_PUBLISHED_KIND,
  REMINDER_KIND,
  TEACHER_ASK_KIND,
  TEACHER_EMAIL_BUTTON,
  TEACHER_PLANNED_KIND,
  renderTeacherEmail,
  type InviteTemplate
} from '@/lib/meeting-invite-email';
import { INVITE_SENDER_NAME, inviteExpiresAt } from '@/lib/meeting-invites';
import { deletePlanPage, mintPlanPage, supersedeOlderPlanPages } from '@/lib/plan-pages';
import { siteUrl } from '@/lib/site-url';
import { loadTeacherPeople } from '@/lib/meeting-board-supply';
import { loadAdvancementCatalog, type CatalogRank } from '@/lib/advancement-catalog';
import { isGroupKey } from '@/lib/focus-plan';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadThisWeekData } from '@/lib/this-week-db';
import { buildThisWeek } from '@/lib/this-week';
import { teacherCardOf, type TeacherCard } from '@/lib/teacher-email-card';
import { peopleWords, planButtons, renderHouseholdEmail, TRACKING_LINE, type ScoutPlanSent } from '@/lib/meeting-email-build';
import type { EmailRow, Prepared } from '@/lib/meeting-emails';

export interface PrepareContext {
  meeting: { entryId: number; date: string };
  /** The meeting's focus, for the email's [focus]. */
  focus: string;
}

export async function templateFor(sb: SupabaseClient, kind: string, fallback: InviteTemplate): Promise<InviteTemplate> {
  const { data } = await sb.from('email_templates').select('subject, body').eq('kind', kind).is('retired_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as InviteTemplate | null) ?? fallback;
}

async function recipientOf(sb: SupabaseClient, id: number | null): Promise<{ id: number; first: string; epoch: number } | null> {
  if (id == null) return null;
  const { data } = await sb.from('people').select('id, nickname, first_name, display_name, session_epoch, active').eq('id', id).maybeSingle();
  const p = data as { id: number; nickname: string | null; first_name: string | null; display_name: string; session_epoch: number | null; active: boolean } | null;
  if (!p?.active || p.session_epoch == null) return null;
  return { id: p.id, first: p.nickname || p.first_name || p.display_name, epoch: p.session_epoch };
}

/** The scouts this email is about, as emailed, in the row's order. */
export function scoutsOf(row: Pick<EmailRow, 'about' | 'plan_sent'>): ScoutPlanSent[] {
  const plan = row.plan_sent ?? {};
  return (row.about.scouts ?? []).flatMap((id) => (plan[String(id)] ? [plan[String(id)]] : []));
}

/** A teacher email's group as This week has it now (null for a key that isn't a group of the night). */
async function teacherCardFor(sb: SupabaseClient, meeting: { entryId: number; date: string }, key: string): Promise<TeacherCard | null> {
  if (!isGroupKey(key)) return null;
  const catalog = await loadAdvancementCatalog();
  const data = await loadThisWeekData(sb, meeting, await loadPlannerLists(), catalog);
  return teacherCardOf(buildThisWeek(data.input), data.input, key, catalog);
}

export async function prepareEmail(sb: SupabaseClient, row: EmailRow, ctx: PrepareContext): Promise<Prepared> {
  const day = fmtDateFull(ctx.meeting.date);
  const who = await recipientOf(sb, row.recipient_person_id);
  if (!who) throw new Error('The recipient is no longer active.');

  if (row.kind === 'teacher') {
    const key = row.about.group;
    if (!key) throw new Error('No group on this email.');
    // A group of the night says which group, its requirements and its scouts (lib/teacher-email-card).
    const card = await teacherCardFor(sb, ctx.meeting, key);
    if (!card) throw new Error('That group isn’t on the plan any more.');
    // The link opens their teacher card; someone who may not teach on the date would find nothing to answer.
    if (!(await mayTeach(sb, who.id, ctx.meeting.date))) throw new Error('They can’t teach on this meeting.');
    // Youth Protection (Patrick, 2026-11-01): a scout is never emailed one-on-one; buildQueue puts their parents on cc.
    if (!row.about.cc?.length) {
      const { data: scout } = await sb.from('scouts').select('person_id').eq('person_id', who.id).eq('active', true).maybeSingle();
      if (scout) throw new Error('A scout’s teacher email copies a parent, and none is on it.');
    }
    // A planned teacher is asked to confirm (Confirmations C-D1), in their own wording.
    const planned = card.teacherIds.includes(who.id);
    const template = planned ? await templateFor(sb, TEACHER_PLANNED_KIND, DEFAULT_TEACHER_PLANNED) : await templateFor(sb, TEACHER_ASK_KIND, DEFAULT_TEACHER_ASK);
    const { subject, md } = renderTeacherEmail(override(template, row.body_md_override), { name: who.first, day }, card, { planned });
    // A teacher-only family link: it never closes the recipient's family link (supersedeOlderPlanPages covers scope).
    const page = await mintPlanPage(sb, { entryId: ctx.meeting.entryId, recipientId: who.id, epoch: who.epoch, scoutIds: [], expiresAt: inviteExpiresAt(ctx.meeting.date), asTeacher: true });
    let html: string;
    let text: string;
    try {
      ({ html, text } = renderMarkdownEmail({ md, actions: [{ url: `${siteUrl()}/i/plan/${page.token}`, label: TEACHER_EMAIL_BUTTON }], postscript: TRACKING_LINE }));
    } catch (e) {
      await deletePlanPage(sb, page.id);
      throw e;
    }
    return {
      subject,
      html,
      text,
      fromName: INVITE_SENDER_NAME,
      onSent: () => supersedeOlderPlanPages(sb, { id: page.id, entryId: ctx.meeting.entryId, recipientId: who.id, scoutIds: [], asTeacher: true, queuedAt: row.queued_at ?? null }),
      undo: () => deletePlanPage(sb, page.id)
    };
  }

  const scouts = scoutsOf(row);
  const reminder = row.kind === 'reminder';
  const template = reminder ? await templateFor(sb, REMINDER_KIND, DEFAULT_REMINDER) : await templateFor(sb, PLAN_PUBLISHED_KIND, DEFAULT_PLAN_PUBLISHED);
  const toScout = scouts.length === 1 && row.about.scouts?.[0] === who.id;
  const { subject, md } = renderHouseholdEmail(template, { name: who.first, people: scouts.length ? peopleWords(scouts, toScout) : 'you', day, focus: ctx.focus || 'still being planned' }, scouts, row.body_md_override, { reminder });

  const asTeacher = await mayTeach(sb, who.id, ctx.meeting.date);
  // An adult's own "Coming?" reminder who may not teach: the member meeting page, nothing minted.
  if (!scouts.length && !asTeacher) {
    const { html, text } = renderMarkdownEmail({ md, actionUrl: `${siteUrl()}/member/meeting`, actionLabel: 'Answer now', postscript: TRACKING_LINE });
    return { subject, html, text, fromName: INVITE_SENDER_NAME };
  }

  // A reminder with no scouts carries none, even if the row named some.
  const scoutIds = scouts.length ? (row.about.scouts ?? []) : [];
  const page = await mintPlanPage(sb, { entryId: ctx.meeting.entryId, recipientId: who.id, epoch: who.epoch, scoutIds, expiresAt: inviteExpiresAt(ctx.meeting.date), asTeacher });
  let html: string;
  let text: string;
  try {
    const base = `${siteUrl()}/i/plan/${page.token}`;
    const actions = reminder ? [{ url: base, label: 'Answer now' }] : planButtons(scouts).map((b) => ({ url: b.answer ? `${base}?a=${b.answer}` : base, label: b.label }));
    ({ html, text } = renderMarkdownEmail({ md, actions, postscript: TRACKING_LINE }));
  } catch (e) {
    await deletePlanPage(sb, page.id);
    throw e;
  }
  return {
    subject,
    html,
    text,
    fromName: INVITE_SENDER_NAME,
    onSent: () => supersedeOlderPlanPages(sb, { id: page.id, entryId: ctx.meeting.entryId, recipientId: who.id, scoutIds, asTeacher, queuedAt: row.queued_at ?? null }),
    undo: () => deletePlanPage(sb, page.id)
  };
}

/** Whether the recipient may teach on the meeting date (an adult, or a Junior Leader): the link's teacher card. */
/** The ranks, read once per client (one send's batch), not once per email (qa-lead 2026-10-30). */
const ranksBy = new WeakMap<SupabaseClient, Promise<CatalogRank[]>>();
function ranksOf(sb: SupabaseClient): Promise<CatalogRank[]> {
  let p = ranksBy.get(sb);
  if (!p) {
    p = Promise.resolve(sb.from('ranks').select('id, display_name, sort_order')).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return (data ?? []) as CatalogRank[];
    });
    ranksBy.set(sb, p);
  }
  return p;
}

async function mayTeach(sb: SupabaseClient, personId: number, date: string): Promise<boolean> {
  return (await loadTeacherPeople(sb, [personId], date, { ranks: await ranksOf(sb) })).has(personId);
}

/** "Edit this email": the one-off wording replaces the template's body; the subject stays. */
function override(t: InviteTemplate, body: string | null): InviteTemplate {
  return body?.trim() ? { ...t, body } : t;
}
