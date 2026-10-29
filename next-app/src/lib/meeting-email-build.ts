/**
 * Meeting Planner III Emails (Plans/Meeting-Planner-III-Emails.md, E3): what a household's plan email or "Coming?"
 * reminder says, built from each scout's plan AS EMAILED (planSent, stored on the email's log row). Pure: the Emails
 * screen's preview and the sender render with the same functions, so the log shows exactly what went.
 *
 *   - The template's wording (Admin › Lookups › Email templates, or the default) or the one-off "Edit this email"
 *     wording, then one block per scout: their group and teacher, then the planned requirements.
 *   - The answer buttons sit outside the template and can't be edited away. Each maps to exactly one choice on the
 *     family page (N5): Yes, coming / Pick something else / Not this week; for a Merit badge group household,
 *     Yes, merit badge / I'd like to teach / Not this week.
 *   - Every email's footer says the troop can see when it's opened.
 */
import type { FamilyChoice } from '@/lib/family-week-shared';
import type { FamilyScoutKind, FamilyWeek } from '@/lib/family-week';
import { fillTokens } from '@/lib/signup-confirmation';
import type { InviteTemplate } from '@/lib/meeting-invite-email';

export const TRACKING_LINE = 'Troop 79 can see when this email is opened.';

export interface ScoutPlanSent {
  name: string;
  kind: FamilyScoutKind;
  group: string | null;
  groupName: string | null;
  teachers: string[];
  /** The plan BEFORE a family's unticks; `on: false` = the family took it off (not listed in the email). */
  items: { key: string; code: string; label: string; on?: boolean }[];
  /** A Merit badge group scout: the group they could help teach. */
  helpName: string | null;
}

/** By person id (a JSON object key). */
export type PlanSent = Record<string, ScoutPlanSent>;

export function planSentOf(week: Pick<FamilyWeek, 'scouts'>): PlanSent {
  const out: PlanSent = {};
  for (const s of week.scouts) {
    out[String(s.personId)] = {
      name: s.firstName,
      kind: s.kind,
      group: s.group?.key ?? null,
      groupName: s.group?.name ?? null,
      teachers: s.group?.teachers ?? [],
      items: s.items.map((i) => ({ key: i.key, code: i.code, label: i.label, on: i.on })),
      helpName: s.helpGroup?.name ?? null
    };
  }
  return out;
}

/** "Plan changed since sent": the group or the planned requirements differ. The family's own unticks never count,
 *  because both sides are the plan BEFORE a family's changes (tech-lead #5). */
export function planChanged(sent: ScoutPlanSent | undefined, now: ScoutPlanSent | undefined): boolean {
  if (!sent || !now) return false;
  const keys = (p: ScoutPlanSent) => p.items.map((i) => i.key).sort().join('|');
  return sent.group !== now.group || keys(sent) !== keys(now);
}

export interface EmailButton {
  label: string;
  /** The family page's choice the button opens with (?a=), null for a plain link. */
  answer: FamilyChoice | null;
}

export function planButtons(scouts: readonly ScoutPlanSent[]): EmailButton[] {
  if (scouts.length && scouts.every((s) => s.kind === 'mb')) {
    return [
      { label: scouts.some((s) => s.group) ? 'Yes, merit badge' : 'Yes, coming', answer: 'mb' },
      ...(scouts.some((s) => s.helpName) ? [{ label: 'I’d like to teach', answer: 'help' as const }] : []),
      { label: 'Not this week', answer: 'out' }
    ];
  }
  return [
    { label: 'Yes, coming', answer: 'ok' },
    { label: 'Pick something else', answer: 'change' },
    { label: 'Not this week', answer: 'out' }
  ];
}

/** One scout's lines under the email's wording. */
export function scoutBlock(s: ScoutPlanSent): string {
  const head = `**${s.name}**`;
  if (s.kind === 'rank') {
    const teacher = s.teachers.length ? ` with ${s.teachers.join(' and ')}` : '';
    return [`${head}: the ${s.groupName} group${teacher}`, ...s.items.filter((i) => i.on !== false).map((i) => `- ${i.code} · ${i.label}`)].join('\n');
  }
  if (s.kind === 'done') return `${head} has finished everything on offer this week. A leader can pick something good, or you can suggest something.`;
  const parts = [s.groupName ? `the ${s.groupName} merit badge` : null, s.helpName ? `help teach the ${s.helpName} group` : null].filter(Boolean);
  return `${head}: ${parts.length ? parts.join(', or ') : 'a leader will find something for Sunday'}`;
}

export interface HouseholdValues {
  /** The recipient's first name. */
  name: string;
  /** 'you', 'Lily', 'Lily and Simon'. */
  people: string;
  day: string;
  focus: string;
}

/** The email's subject and markdown body (the buttons and the footer are added by the sender). */
export function renderHouseholdEmail(t: InviteTemplate, v: HouseholdValues, scouts: readonly ScoutPlanSent[], override: string | null, opts: { reminder?: boolean } = {}): { subject: string; md: string } {
  const vals: Record<string, string> = { name: v.name, people: v.people, day: v.day, focus: v.focus };
  const wording = fillTokens(override?.trim() ? override : t.body, vals);
  const blocks = opts.reminder ? '' : scouts.map(scoutBlock).join('\n\n');
  const md = `${wording}\n\n${blocks}`.replace(/\n{3,}/g, '\n\n').trim();
  return { subject: fillTokens(t.subject, vals).replace(/\s+/g, ' ').trim(), md };
}

/** 'you' for a scout's own address; else the first names: 'Lily', 'Lily and Simon', 'Ann, Lily and Simon'. */
export function peopleWords(scouts: readonly ScoutPlanSent[], toScout: boolean): string {
  if (toScout) return 'you';
  const n = scouts.map((s) => s.name);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
