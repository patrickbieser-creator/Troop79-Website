/**
 * The teacher invite email (Plans/Matcher-Tune-Up.md T-5, P1). The copy is an editable template of kind
 * 'meeting.invite.teacher' (Admin › Lookups › Email templates); with none saved, DEFAULT_TEACH_INVITE goes out. The
 * link is never a merge field: it rides as the email's button, so a template can't drop or rewrite it.
 */
import { fillTokens } from '@/lib/signup-confirmation';

export interface InviteTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_TEACH_INVITE: InviteTemplate = {
  subject: 'Can you teach [topic] on [day]?',
  body: `Hi [name],

Scouts have asked to work on **[topic]** ([code]) at the troop meeting on [day], and nobody is teaching it yet. It usually takes [minutes].

[parts]

Could you teach it? Use the button below to say yes or not this week. You don't need to sign in.

Thank you!`
};

export const PICK_INVITE_KIND = 'meeting.invite.scout';

/** P2: a scout's invite, to their parents (always) and to the scout from 13. The answer links ride below the body. */
export const DEFAULT_PICK_INVITE: InviteTemplate = {
  subject: '[topic] is on for [day]',
  body: `Hi [name],

We're offering **[topic]** ([code]) at the troop meeting on [day], and [scouts] can work on it there.

[parts]

Answer with the link below. Yes makes it the first pick and marks them coming. You can also pick something else, or say not this week. You don't need to sign in to say yes.

Questions? Reply to a leader, not to this email.`
};

export interface PickInviteValues {
  name: string;
  /** 'Anjali S' or 'Anjali S and Finn S'. */
  scouts: string;
  topic: string;
  code: string;
  parts: string[];
  day: string;
}

/** The scout invite, with one answer link per scout appended (never a template field, so no template can drop it). */
export function renderPickInvite(t: InviteTemplate, v: PickInviteValues, links: { scoutName: string; url: string }[], toScout: boolean): { subject: string; md: string } {
  const vals: Record<string, string> = {
    name: v.name,
    scouts: v.scouts,
    topic: v.topic,
    code: v.code,
    parts: v.parts.length ? `What it covers:\n\n${v.parts.map((p) => `- ${p}`).join('\n')}` : '',
    day: v.day
  };
  const answer = toScout
    ? `**[Answer the invite](${links[0]?.url ?? ''})**`
    : links.map((l) => `**[Answer for ${l.scoutName}](${l.url})**`).join('\n\n');
  const md = `${fillTokens(t.body, vals)}\n\n${answer}`.replace(/\n{3,}/g, '\n\n').trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}

export interface TeachInviteValues {
  name: string;
  topic: string;
  code: string;
  minutes: string;
  /** Its sub-requirements as the Clipboard lists them ('4a.1 Simple cuts'); empty for none. */
  parts: string[];
  day: string;
}

export function renderTeachInvite(t: InviteTemplate, v: TeachInviteValues): { subject: string; md: string } {
  const vals: Record<string, string> = {
    name: v.name,
    topic: v.topic,
    code: v.code,
    minutes: v.minutes || 'a little while',
    parts: v.parts.length ? `What it covers:\n\n${v.parts.map((p) => `- ${p}`).join('\n')}` : '',
    day: v.day
  };
  const md = fillTokens(t.body, vals)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}

export const REMINDER_KIND = 'meeting.reminder';

/** P5b: to someone who hasn't answered "Coming Sunday?" (a scout's parents, the scout from 13, or an adult). The link
 *  to the family link (/i/plan/<token>, a teacher-only one for an adult; /member/meeting for someone who may not teach)
 *  is the email's button, never a field. */
export const DEFAULT_REMINDER: InviteTemplate = {
  subject: 'Troop meeting on [day]: coming?',
  body: `Hi [name],

We haven't had an answer for [people] for the troop meeting on [day]. Coming, not sure, or can't make it: any answer helps us plan who teaches what.

Use the button below to answer.`
};

export interface ReminderValues {
  name: string;
  /** 'you', or 'Anjali S and Finn S'. */
  people: string;
  day: string;
}

export function renderReminder(t: InviteTemplate, v: ReminderValues): { subject: string; md: string } {
  const vals: Record<string, string> = { name: v.name, people: v.people, day: v.day };
  const md = fillTokens(t.body, vals)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}

/** Where a teacher email's questions go (Patrick, 2026-10-31). */
export const TROOP_REPLY_TO = 'bsatroop79bg@gmail.com';

/**
 * The Emails screen's teacher emails (Plans/Planner-Teacher-Email-To-Family-Card.md): one group of the night per email,
 * its one button the family link's teacher card (/i/plan/<token>). Two templates: asking someone who may teach a group
 * with no teacher yet, and asking a planned teacher to confirm (Confirmations C-D1). The group's lines and the button ride
 * below the body, never fields, so no template can drop or rewrite the link. The stored kind of the ask stays
 * 'meeting.invite_digest' (its older name) so a saved copy keeps working.
 */
export const TEACHER_ASK_KIND = 'meeting.invite_digest';
export const DEFAULT_TEACHER_ASK: InviteTemplate = {
  subject: 'Troop meeting on [day]: can you teach?',
  body: `Hi [name],

We're planning the troop meeting on [day] and the class below still needs a teacher. Could you teach it? Use the button below to say yes or not this week. You don't need to sign in.

Questions? Reply to ${TROOP_REPLY_TO}.`
};

/** Confirmations C-D1: the email to a teacher planned on a card. Everything on the plan is a proposal until they say yes. */
export const TEACHER_PLANNED_KIND = 'meeting.teacher_planned';
export const DEFAULT_TEACHER_PLANNED: InviteTemplate = {
  subject: 'Troop meeting on [day]: can you teach?',
  body: `Hi [name],

We're planning the troop meeting on [day] and have you down to teach the class below. Nothing is final until you say so. Use the button below to tell us whether it works, change it, or let us know you can't make it. You don't need to sign in.

Questions? Reply to ${TROOP_REPLY_TO}.`
};

/** The one button under either teacher email (Patrick, 2026-11-01): the email's action, never a link in the body. */
export const TEACHER_EMAIL_BUTTON = 'See my plan and answer';

/** A group of the night as a teacher email names it (lib/teacher-email-card). */
export interface TeacherEmailGroup {
  /** 'Scout Group 2'. */
  title: string;
  /** Its requirements: '4a, 4b, 5'. */
  codes: string;
  /** 'about 60 min'; '' when unknown. */
  minutes: string;
  /** The scouts placed in it, full names (a private email). */
  scouts: readonly string[];
}

/**
 * The teacher email: the body, then "You're planned to teach:" or "Can you teach?", the group's line
 * ("- **Scout Group 2**: 4a, 4b (about 60 min)"), and "Scouts:" with one full name a line. The button
 * (TEACHER_EMAIL_BUTTON) is the email's action, added by the sender.
 */
export function renderTeacherEmail(t: InviteTemplate, v: { name: string; day: string }, g: TeacherEmailGroup, o: { planned: boolean }): { subject: string; md: string } {
  // [people] is the older ask template's token: a saved copy of it still reads "you" (qa-lead 2026-11-01).
  const vals: Record<string, string> = { name: v.name, day: v.day, people: 'you' };
  const block = [
    o.planned ? '**You’re planned to teach:**' : '**Can you teach?**',
    `- **${g.title}**: ${g.codes}${g.minutes ? ` (${g.minutes})` : ''}`,
    `**Scouts:**\n\n${g.scouts.length ? g.scouts.map((n) => `- ${n}`).join('\n') : 'None placed in this group yet.'}`
  ].join('\n\n');
  const md = `${fillTokens(t.body, vals)}\n\n${block}`.replace(/\n{3,}/g, '\n\n').trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}

export const PLAN_PUBLISHED_KIND = 'meeting.plan_published';

/** Meeting Planner III (Decision 5): the published plan, one email per family. The options ride below the body. Since
 *  Emails E2 the plan is already set: families accept it or change it on the page, they don't pick. */
export const DEFAULT_PLAN_PUBLISHED: InviteTemplate = {
  subject: 'Troop meeting on [day]: [focus]',
  body: `Hi [name],

Here's the plan for the troop meeting on [day]. The focus is [focus].

The plan for [people] is already set. Use the button below to see it and tell us whether it works: one tap per scout. You can also change the plan or suggest something else. You don't need to sign in.`
};

/** The button under the published plan. */
export const PLAN_PAGE_BUTTON = 'See the plan and answer →';

export interface PlanEmailValues {
  name: string;
  people: string;
  day: string;
  focus: string;
}

export interface PlanEmailOption {
  title: string;
  sub: string;
  /** First names of this family's scouts it's suggested for. */
  suggestedFor: string[];
}

export function renderPlanPublished(t: InviteTemplate, v: PlanEmailValues, options: readonly PlanEmailOption[]): { subject: string; md: string } {
  const vals: Record<string, string> = { name: v.name, people: v.people, day: v.day, focus: v.focus };
  const line = (o: PlanEmailOption) => `- **${o.title}**${o.sub ? ` (${o.sub})` : ''}${o.suggestedFor.length ? `: suggested for ${o.suggestedFor.join(' and ')}` : ''}`;
  const list = options.length ? `**This week's options**\n\n${options.map(line).join('\n')}` : '';
  const md = `${fillTokens(t.body, vals)}\n\n${list}`.replace(/\n{3,}/g, '\n\n').trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}
