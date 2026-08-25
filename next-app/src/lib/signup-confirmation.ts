/**
 * Signup confirmation — the pure half (Plans/Signup-Confirmation-Email.md).
 *
 * Everything here takes plain data and returns plain data, so it is tested
 * without a database or a mail provider:
 *   * renderMessage      — merge fields → subject + body + summary lines
 *   * resolveRecipients  — who gets the family receipt, who gets the leader
 *                          one, with the cc-every-parent rule and ONE dedup
 *                          pass across both lists (Patrick: "Check for
 *                          duplicate / multi-use email address")
 *   * validateLeaderRecipients — the builder's ≤ 5 valid, distinct addresses
 *   * describeChanges    — the plain-language diff for an update
 *   * resolveMessage     — event override → template → seeded default
 *
 * The server half (context builder, sending, logging) is
 * app/admin/(workspace)/events/confirmation.ts.
 */

import { fmtDateLong, fmtDay, fmtRange } from '@/lib/format-date';
import { formatTimeOfDay } from '@/lib/calendar-shared';

export type Audience = 'family' | 'leader';
export type Change = 'new' | 'update' | 'cancel' | 'resend';

export interface ConfirmationPerson {
  name: string;
  isAdult: boolean;
  /** 'yes' | 'waitlist' | … — anything but 'yes' is noted. */
  status: string;
}

export interface ConfirmationContext {
  event: {
    title: string;
    entryDate: string;
    endDate: string | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    deadline: string | null;
    publicUrl: string;
    rosterUrl: string;
    /** "31 going of 40" — the event's running total after this write. */
    headcount: string | null;
  };
  household: {
    label: string;
    submitterName: string;
    submitterEmail: string | null;
    submitterPhone: string | null;
    people: ConfirmationPerson[];
    guests: string[];
    days: string[];
    jobs: string[];
    rides: string[];
    answers: string[];
    notes: string[];
    slip: string[];
    prices: string[];
    amountDue: number;
    paid: number;
    payment: string | null;
  };
  change: Change;
  /** The plain-language diff for an update / the cancel line; null for new. */
  changes: string | null;
}

export interface MessageTemplate {
  subject: string;
  body: string;
}

export interface RenderedMessage {
  subject: string;
  /** MARKDOWN — the body with tokens replaced, `[summary]` expanded in place
   *  (Patrick, 2026-08-25: full markdown, rendered by lib/email-markdown). */
  body: string;
  /** The echo-back block (markdown); appended by the sender when the template lacked `[summary]`. */
  summaryMd: string;
  /** The same facts as plain lines, for callers that want them. */
  summaryLines: string[];
  hadSummary: boolean;
}

/**
 * The default summary layout — a markdown block of captions + section tokens.
 * It IS a template (Patrick: "the ability to edit the Going: section"): a
 * message that places `[summary]` gets this; a message can instead place the
 * section tokens itself with its own captions. Blank sections vanish.
 */
export const DEFAULT_SUMMARY_MD = [
  '**Going**',
  '[going]',
  '',
  '**Guests**',
  '[guests]',
  '',
  '**Days**',
  '[days]',
  '',
  '**Jobs**',
  '[jobs]',
  '',
  '**Rides**',
  '[rides]',
  '',
  '**Prices**',
  '[prices]',
  '',
  '**Amount due:** [amount_due] [paid_note]',
  '',
  '[slip]',
  '',
  '**Your answers**',
  '[answers]',
  '',
  '**Notes**',
  '[notes]'
].join('\n');

const CHANGED_LABEL: Record<Change, string> = {
  new: 'New signup',
  update: 'Updated signup',
  cancel: 'Cancelled signup',
  resend: 'Signup confirmation'
};
const SUBJECT_PREFIX: Partial<Record<Change, string>> = { update: 'Updated: ', cancel: 'Cancelled: ' };

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Avery" / "Avery and Blake" / "Avery, Blake and Casey". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Google Maps search for whatever the leader typed as the location. */
export function mapUrl(location: string | null): string {
  const q = (location ?? '').trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
}

/** `[map]` renders as a markdown link (Patrick: "with map link"). */
export function mapLink(location: string | null): string {
  const url = mapUrl(location);
  return url ? `[Open in Google Maps](${url})` : '';
}

/** A markdown bullet list, or blank. */
const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

function personLine(p: ConfirmationPerson): string {
  return p.status === 'yes' ? p.name : `${p.name} — ${p.status}`;
}

/** The echo-back, one line per non-blank fact, in a fixed order. */
export function summaryLines(ctx: ConfirmationContext): string[] {
  const h = ctx.household;
  const going = h.people.filter((p) => p.status === 'yes');
  const lines: string[] = [];
  if (h.people.length) {
    lines.push(`Going: ${h.people.map(personLine).join(', ')}`);
  }
  if (h.guests.length) lines.push(`Guests: ${h.guests.join(', ')}`);
  if (h.days.length) lines.push(`Days: ${h.days.join('; ')}`);
  if (h.jobs.length) lines.push(`Jobs: ${h.jobs.join('; ')}`);
  if (h.rides.length) lines.push(`Rides: ${h.rides.join('; ')}`);
  if (h.prices.length) lines.push(`Prices: ${h.prices.join('; ')}`);
  if (h.amountDue > 0 || h.paid > 0) lines.push(`Amount due: ${money(h.amountDue)}${h.paid > 0 ? ` (paid ${money(h.paid)})` : ''}`);
  if (h.slip.length) lines.push(h.slip.join('; '));
  for (const a of h.answers) lines.push(a);
  if (h.notes.length) lines.push(`Notes: ${h.notes.join('; ')}`);
  if (!going.length && h.people.length) lines.push('Nobody from this household is currently marked as going.');
  return lines;
}

function values(ctx: ConfirmationContext, audience: Audience): Record<string, string> {
  const e = ctx.event;
  const h = ctx.household;
  const scouts = h.people.filter((p) => !p.isAdult && p.status === 'yes').map((p) => p.name);
  const adults = h.people.filter((p) => p.isAdult && p.status === 'yes').map((p) => p.name);
  const wait = h.people.filter((p) => p.status !== 'yes').map(personLine);
  const goingCount = scouts.length + adults.length;
  const going =
    goingCount === 0
      ? wait.length
        ? wait.join(', ')
        : '0 going'
      : `${goingCount} going (${[
          scouts.length ? `${scouts.length} scout${scouts.length === 1 ? '' : 's'}` : null,
          adults.length ? `${adults.length} adult${adults.length === 1 ? '' : 's'}` : null
        ]
          .filter(Boolean)
          .join(', ')})${wait.length ? `; ${wait.join(', ')}` : ''}`;
  const time = e.startTime
    ? e.endTime
      ? `${formatTimeOfDay(e.startTime)} – ${formatTimeOfDay(e.endTime)}`
      : formatTimeOfDay(e.startTime)
    : '';

  const shared: Record<string, string> = {
    event: e.title,
    date: e.endDate && e.endDate !== e.entryDate ? fmtRange(e.entryDate, e.endDate) : fmtDateLong(e.entryDate),
    time,
    location: e.location ?? '',
    map: mapLink(e.location),
    deadline: e.deadline ? fmtDay(e.deadline) : '',
    link: e.publicUrl,
    name: h.submitterName,
    scouts: joinNames(scouts),
    adults: joinNames(adults),
    // Section tokens are markdown lists (2026-08-25): place them under your
    // own captions, or let [summary] lay them out with the defaults.
    going: list(h.people.map(personLine)),
    going_count: going,
    guests: list(h.guests),
    days: list(h.days),
    jobs: list(h.jobs),
    rides: list(h.rides),
    answers: list(h.answers),
    notes: list(h.notes),
    slip: h.slip.join('; '),
    prices: list(h.prices),
    amount_due: money(h.amountDue),
    paid: h.paid > 0 ? money(h.paid) : '',
    paid_note: h.paid > 0 ? `(paid ${money(h.paid)})` : '',
    payment: h.payment ?? '',
    changed: CHANGED_LABEL[ctx.change],
    changes: ctx.changes ?? '',
    summary: '' // filled below — it is itself a template
  };
  // The privacy line: a family template can never print contact details.
  const leaderOnly: Record<string, string> =
    audience === 'leader'
      ? {
          household: h.label,
          email: h.submitterEmail ?? '',
          phone: h.submitterPhone ?? '',
          roster_link: e.rosterUrl,
          headcount: e.headcount ?? ''
        }
      : { household: '', email: '', phone: '', roster_link: '', headcount: '' };
  return { ...shared, ...leaderOnly };
}

const TOKEN_RE = /\[([a-z_]+)\]/g;

/** Replace known tokens; leave `[unknown]` exactly as typed. */
export function fillTokens(text: string, vals: Record<string, string>): string {
  return text.replace(TOKEN_RE, (m, key: string) => (key in vals ? vals[key] : m));
}

/** Collapse the blank spots a blank token leaves behind ("at , " → "at "),
 *  and drop a caption whose section came out empty ("**Guests**" over nothing). */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([,.;])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^(\*\*[^*\n]+\*\*)\s*\n(?=\s*\n|\s*$)/gm, '')
    .replace(/^\*\*[^*\n]+:\*\* *\n/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The summary block for this household — the default layout, filled. */
export function renderSummaryMd(ctx: ConfirmationContext, audience: Audience, layout: string = DEFAULT_SUMMARY_MD): string {
  return tidy(fillTokens(layout, values(ctx, audience)));
}

export function renderMessage(template: MessageTemplate, ctx: ConfirmationContext, audience: Audience): RenderedMessage {
  const vals = values(ctx, audience);
  const summaryMd = renderSummaryMd(ctx, audience);
  vals.summary = summaryMd;
  const hadSummary = /\[summary\]/.test(template.body);
  let subject = tidy(fillTokens(template.subject, vals)).replace(/\n+/g, ' ');
  const prefix = SUBJECT_PREFIX[ctx.change];
  if (prefix && !/\[changed\]/.test(template.subject) && !subject.startsWith(prefix)) subject = prefix + subject;
  let body = fillTokens(template.body, vals);
  // An update / cancel says so up front when the template did not place [changes].
  if (ctx.changes && !/\[changes\]/.test(template.body)) body = `${ctx.changes}\n\n${body}`;
  return { subject, body: tidy(body), summaryMd, summaryLines: summaryLines(ctx), hadSummary };
}

/** The complete markdown that goes out: the body, plus the summary when the
 *  template did not place it (family receipts always carry the echo-back). */
export function fullMessageMd(r: RenderedMessage, appendSummary: boolean): string {
  return r.hadSummary || !appendSummary || !r.summaryMd ? r.body : `${r.body}\n\n${r.summaryMd}`;
}

/* ── recipients ──────────────────────────────────────────────────────────── */

export interface FamilyMember {
  email: string | null;
  isAdult: boolean;
  /** On the written rows for this signup. */
  signedUp: boolean;
}

export function normaliseEmail(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(e: string): boolean {
  return EMAIL_RE.test(e);
}

/**
 * Family: every signed-up member with an email, plus the submitter — and, when
 * only scouts signed up, every adult in the household (Patrick: "if it's only
 * a scout signing up, all parents get a cc"). Leaders: the cc list. Then ONE
 * dedup across both: an address on both sides gets the family receipt only.
 */
export function resolveRecipients(input: {
  members: FamilyMember[];
  submitterEmail: string | null;
  leaders: string[];
}): { family: string[]; leaders: string[] } {
  const signedUp = input.members.filter((m) => m.signedUp);
  const onlyScouts = signedUp.length > 0 && signedUp.every((m) => !m.isAdult);
  const familyRaw = [
    input.submitterEmail,
    ...signedUp.map((m) => m.email),
    ...(onlyScouts ? input.members.filter((m) => m.isAdult).map((m) => m.email) : [])
  ];
  const seen = new Set<string>();
  const family: string[] = [];
  for (const raw of familyRaw) {
    const e = normaliseEmail(raw);
    if (!e || !isEmail(e) || seen.has(e)) continue;
    seen.add(e);
    family.push(e);
  }
  const leaders: string[] = [];
  for (const raw of input.leaders) {
    const e = normaliseEmail(raw);
    if (!e || !isEmail(e) || seen.has(e)) continue;
    seen.add(e);
    leaders.push(e);
  }
  return { family, leaders };
}

export const MAX_LEADER_RECIPIENTS = 5;

/** The builder's rule: up to five valid, distinct addresses. Blanks are dropped. */
export function validateLeaderRecipients(list: string[]): { ok: boolean; recipients: string[]; errors: string[] } {
  const errors: string[] = [];
  const out: string[] = [];
  for (const raw of list) {
    const e = normaliseEmail(raw);
    if (!e) continue;
    if (!isEmail(e)) {
      errors.push(`"${raw.trim()}" is not an email address.`);
      continue;
    }
    if (out.includes(e)) {
      errors.push(`${e} is listed twice.`);
      continue;
    }
    out.push(e);
  }
  if (out.length > MAX_LEADER_RECIPIENTS) errors.push(`Up to ${MAX_LEADER_RECIPIENTS} addresses — you have ${out.length}.`);
  return { ok: errors.length === 0, recipients: out.slice(0, MAX_LEADER_RECIPIENTS), errors };
}

/* ── the update diff ─────────────────────────────────────────────────────── */

export interface SignupSnapshotRow {
  name: string;
  status: string;
  jobs: string[];
  drivesOut: boolean;
  drivesBack: boolean;
  seatsOut: number | null;
  seatsBack: number | null;
}

/** "Added Blake; dropped the Friday setup job; now driving out with 3 seats" —
 *  or the generic line when nothing simple explains the edit. */
export function describeChanges(before: SignupSnapshotRow[], after: SignupSnapshotRow[]): string {
  const by = (rows: SignupSnapshotRow[]) => new Map(rows.map((r) => [r.name, r]));
  const b = by(before);
  const a = by(after);
  const parts: string[] = [];
  const added = after.filter((r) => !b.has(r.name) && r.status === 'yes').map((r) => r.name);
  const removed = before.filter((r) => r.status === 'yes' && (!a.has(r.name) || a.get(r.name)!.status !== 'yes')).map((r) => r.name);
  if (added.length) parts.push(`Added ${joinNames(added)}`);
  if (removed.length) parts.push(`${joinNames(removed)} no longer going`);
  const jobsBefore = new Set(before.flatMap((r) => r.jobs));
  const jobsAfter = new Set(after.flatMap((r) => r.jobs));
  const newJobs = [...jobsAfter].filter((j) => !jobsBefore.has(j));
  const droppedJobs = [...jobsBefore].filter((j) => !jobsAfter.has(j));
  if (newJobs.length) parts.push(`took ${joinNames(newJobs)}`);
  if (droppedJobs.length) parts.push(`dropped ${joinNames(droppedJobs)}`);
  for (const r of after) {
    const prev = b.get(r.name);
    if (!prev) continue;
    if (r.drivesOut && !prev.drivesOut) parts.push(`${r.name} now driving out${r.seatsOut ? ` with ${r.seatsOut} seats` : ''}`);
    if (r.drivesBack && !prev.drivesBack) parts.push(`${r.name} now driving back${r.seatsBack ? ` with ${r.seatsBack} seats` : ''}`);
    if (!r.drivesOut && prev.drivesOut) parts.push(`${r.name} no longer driving out`);
    if (!r.drivesBack && prev.drivesBack) parts.push(`${r.name} no longer driving back`);
  }
  if (!parts.length) return 'Your signup was updated.';
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/* ── which copy to send ──────────────────────────────────────────────────── */

export const DEFAULT_TEMPLATES: Record<Audience, MessageTemplate> = {
  family: {
    subject: 'Signed up: [event]',
    body: [
      "Hi [name] — you're signed up for **[event]** on [date].",
      '',
      "We'll be at [location]. [map]",
      '',
      '**Amount due:** [amount_due]. [payment]',
      '',
      'Reply to this email if anything changes before [deadline].',
      '',
      '[summary]'
    ].join('\n')
  },
  leader: {
    subject: '[changed]: [household] — [event]',
    body: [
      '**[household]** ([email], [phone]) — [changed]. [headcount].',
      '',
      '[changes]',
      '',
      '[summary]'
    ].join('\n')
  }
};

/** Event override → chosen template → the audience's seeded default. */
export function resolveMessage(
  audience: Audience,
  override: { subject: string | null; body: string | null },
  template: MessageTemplate | null
): MessageTemplate {
  if (override.subject && override.body) return { subject: override.subject, body: override.body };
  if (template) return template;
  return DEFAULT_TEMPLATES[audience];
}
