/**
 * The teacher invite email (Plans/Matcher-Tune-Up.md T-5, P1). The copy is an editable template of kind
 * 'meeting.invite.teacher' (Admin › Lookups › Email templates); with none saved, DEFAULT_TEACH_INVITE goes out. The
 * link is never a merge field: it rides as the email's button, so a template can't drop or rewrite it.
 */
import { fillTokens } from '@/lib/signup-confirmation';
import { scoutsHelpedText, type ScoutsHelped } from '@/lib/meeting-invite-digest';
import { shortCode } from '@/lib/rank-abbrev';

export const TEACH_INVITE_KIND = 'meeting.invite.teacher';

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
 *  to /member/meeting is the email's button, never a field. */
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

export const INVITE_DIGEST_KIND = 'meeting.invite_digest';

/**
 * Build a Plan B3 (Plans/Build-A-Plan.md Decision 2): ONE email per recipient for a meeting, listing every invite for
 * them (teach asks and scout offers). Each scout offer keeps its own answer link; a teacher's asks share ONE button to
 * their answer page (B10b). The list rides below the body (never a template field), so no template can drop or rewrite
 * a link.
 */
export const DEFAULT_INVITE_DIGEST: InviteTemplate = {
  subject: 'Troop meeting on [day]: invites for [people]',
  body: `Hi [name],

We're planning the troop meeting on [day] and would like to ask [people] about the classes below. Answer with the links under them. Yes on a class to work on makes it the first pick and marks them coming. You don't need to sign in.

Questions? Reply to a leader, not to this email.`
};

/** B10b: the one button under a digest's teach lines. */
export const TEACH_PAGE_BUTTON = 'Choose what you’ll teach →';

export interface DigestValues {
  name: string;
  /** 'you', 'Anjali S', 'you and Anjali S'. */
  people: string;
  day: string;
}

export interface DigestItem {
  kind: 'teach' | 'pick';
  /** The scout a pick is for ('Anjali S'); the teacher's own name for a teach ask. */
  inviteeName: string;
  /** True when the invite is about the recipient themself (a teach ask, or a scout's own address). */
  aboutRecipient: boolean;
  code: string;
  topic: string;
  /** 'about 20 minutes' for a teach ask; '' when unknown. */
  minutes: string;
  url: string;
  /** B10a, a teach ask: the scouts it would help (scoutsHelped), snapshotted at send time. None = "no scouts yet". */
  helped?: ScoutsHelped;
}

/**
 * The digest, with the invites listed under the body: teach asks first, then each scout's offers. A teach line (B10a)
 * reads "**Ten 3a** Square Knot use (about 20 min): 3 scouts (Finn P, Anjali S, Leo K)" with no link of its own; one
 * "Choose what you'll teach →" button follows the teach lines (B10b, the url of the teach items). The scout and
 * parent lines are unchanged.
 */
export function renderInviteDigest(t: InviteTemplate, v: DigestValues, items: readonly DigestItem[]): { subject: string; md: string } {
  const vals: Record<string, string> = { name: v.name, people: v.people, day: v.day };
  const line = (i: DigestItem, label: string) => `- **${i.code}** ${i.topic}${i.minutes ? ` (${i.minutes})` : ''}: **[${label}](${i.url})**`;
  // B10b: teach lines carry no link of their own; ONE button opens the page where every class is answered.
  const teachLine = (i: DigestItem) =>
    `- **${shortCode(i.code)}** ${i.topic}${i.minutes ? ` (${i.minutes})` : ''}: ${scoutsHelpedText(i.helped ?? { count: 0, names: [], more: 0 })}`;
  const blocks: string[] = [];
  const teach = items.filter((i) => i.kind === 'teach');
  if (teach.length) blocks.push(`**Can you teach?**\n\n${teach.map(teachLine).join('\n')}\n\n**[${TEACH_PAGE_BUTTON}](${teach[0].url})**`);
  const scouts = [...new Set(items.filter((i) => i.kind === 'pick').map((i) => i.inviteeName))];
  for (const who of scouts) {
    const mine = items.filter((i) => i.kind === 'pick' && i.inviteeName === who);
    const own = mine[0]?.aboutRecipient;
    blocks.push(`**${own ? 'For you' : `For ${who}`}**\n\n${mine.map((i) => line(i, own ? 'Answer' : `Answer for ${who}`)).join('\n')}`);
  }
  const md = `${fillTokens(t.body, vals)}\n\n${blocks.join('\n\n')}`.replace(/\n{3,}/g, '\n\n').trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}
