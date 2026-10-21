/**
 * The teacher invite email (Plans/Matcher-Tune-Up.md T-5, P1). The copy is an editable template of kind
 * 'meeting.invite.teacher' (Admin › Lookups › Email templates); with none saved, DEFAULT_TEACH_INVITE goes out. The
 * link is never a merge field: it rides as the email's button, so a template can't drop or rewrite it.
 */
import { fillTokens } from '@/lib/signup-confirmation';

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
