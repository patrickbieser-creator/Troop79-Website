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
 *   - 'teacher': one teach ask (createInviteDigest, the Ask by email path) for the row's group, answered on the
 *     teacher's /i/teach/<token> page. Kept only once the email went, as above.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { fmtDateFull } from '@/lib/format-date';
import { DEFAULT_INVITE_DIGEST, DEFAULT_PLAN_PUBLISHED, DEFAULT_REMINDER, INVITE_DIGEST_KIND, PLAN_PUBLISHED_KIND, REMINDER_KIND, renderInviteDigest, type InviteTemplate } from '@/lib/meeting-invite-email';
import { INVITE_SENDER_NAME, inviteExpiresAt } from '@/lib/meeting-invites';
import { deleteInvites } from '@/lib/meeting-invites-db';
import { inviteWords } from '@/lib/meeting-invites-send';
import { createInviteDigest } from '@/lib/meeting-invite-digest-db';
import { deleteTeachPages, supersedeOlderTeachPages } from '@/lib/meeting-teach-pages';
import { minutesText } from '@/lib/meeting-board-picklist';
import { deletePlanPage, mintPlanPage, supersedeOlderPlanPages } from '@/lib/plan-pages';
import { siteUrl } from '@/lib/site-url';
import { loadTeacherPeople } from '@/lib/meeting-board-supply';
import type { CatalogRank } from '@/lib/advancement-catalog';
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

export async function prepareEmail(sb: SupabaseClient, row: EmailRow, ctx: PrepareContext): Promise<Prepared> {
  const day = fmtDateFull(ctx.meeting.date);
  const who = await recipientOf(sb, row.recipient_person_id);
  if (!who) throw new Error('The recipient is no longer active.');

  if (row.kind === 'teacher') {
    const key = row.about.group;
    if (!key) throw new Error('No group on this email.');
    const words = await inviteWords(sb, ctx.meeting.entryId, key);
    if (!words) throw new Error('That group can’t be invited for.');
    const made = await createInviteDigest(sb, { entryId: ctx.meeting.entryId, teach: [{ key, personIds: [who.id] }], pick: [], sentBy: row.queued_by_person_id ?? null }, { words: new Map([[key, words]]) });
    if (!made.ok) throw new Error(made.error);
    const r = made.recipients[0];
    const minted = { pages: made.recipients.flatMap((x) => (x.page ? [x.page.pageId] : [])), invites: made.recipients.flatMap((x) => x.invites.map((i) => i.inviteId)) };
    const undoTeach = async () => {
      await deleteTeachPages(sb, minted.pages);
      await deleteInvites(sb, minted.invites);
    };
    if (!r?.page) {
      await undoTeach();
      throw new Error(made.skipped[0]?.reason ?? 'They can’t be asked to teach this.');
    }
    let base: { subject: string; md: string };
    let html: string;
    let text: string;
    try {
      const template = await templateFor(sb, INVITE_DIGEST_KIND, DEFAULT_INVITE_DIGEST);
      const url = `${siteUrl()}/i/teach/${r.page.token}`;
      const items = r.invites.map((i) => ({ kind: 'teach' as const, inviteeName: i.inviteeName, aboutRecipient: true, code: words.codeLabel, topic: words.label, minutes: minutesText(words.minutes), url, helped: made.helped?.[i.key] }));
      base = renderInviteDigest(override(template, row.body_md_override), { name: who.first, people: 'you', day }, items);
      ({ html, text } = renderMarkdownEmail({ md: base.md, postscript: TRACKING_LINE }));
    } catch (e) {
      // Whatever was minted for an email that can't be built goes, like any email that didn't go out.
      await undoTeach();
      throw e;
    }
    const pageId = r.page.pageId;
    return {
      subject: base.subject,
      html,
      text,
      fromName: INVITE_SENDER_NAME,
      onSent: async () => void (await supersedeOlderTeachPages(sb, pageId)),
      undo: undoTeach
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

  const page = await mintPlanPage(sb, {
    entryId: ctx.meeting.entryId,
    recipientId: who.id,
    epoch: who.epoch,
    // A reminder with no scouts carries none, even if the row named some.
    scoutIds: scouts.length ? (row.about.scouts ?? []) : [],
    expiresAt: inviteExpiresAt(ctx.meeting.date),
    asTeacher
  });
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
    onSent: () => supersedeOlderPlanPages(sb, { id: page.id, entryId: ctx.meeting.entryId, recipientId: who.id }),
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
