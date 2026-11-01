/**
 * Planned, asked, confirmed (Plans/Meeting-Planner-III-Confirmations.md, C1). Everything This week shows is a
 * PROPOSAL until the person answers: a teacher on a card is planned, a scout in a group suggested. One state per
 * teacher slot and per scout plan, for the cards, the Adults card, Live and the Emails screen. Pure; client-safe.
 *
 *   planned    on the plan, not yet emailed (or emailed before they were put there)
 *   asked      emailed about it since, no answer yet (stays asked until they answer, C-D7)
 *   confirmed  said yes, and the card is still what they said yes to
 *   changed    said yes, and the card changed since (C-D4: the yes stays; the Emails screen offers a new email)
 *   said_no    said no: off the card, which shows Needs a teacher (C-D2); a scout's Can't make it
 *   hidden     an adult's "Can't make it" for the whole meeting: their cards are hidden, it isn't a No (review item 8)
 */
import { canonicalGroupKey } from '@/lib/focus-plan';
import { planChanged, type ScoutPlanSent } from '@/lib/meeting-email-build';
import type { Intent } from '@/lib/meeting-board-shared';

export type PlanState = 'planned' | 'asked' | 'confirmed' | 'changed' | 'said_no' | 'hidden';

/** What a teacher said yes to: the card (canonical key) and its requirements. The title is for display only. */
export interface TeacherSnap {
  group: string;
  itemKeys: string[];
  title: string;
}

export interface TeacherAnswer {
  answer: 'yes' | 'no';
  answeredAt: string;
  /** The card at the yes; null for a no. */
  plan: TeacherSnap | null;
  note: string | null;
}

export function teacherSnapOf(g: { key: string; title: string; columns: readonly { key: string }[] }, merged?: ReadonlySet<string>): TeacherSnap {
  return { group: canonicalGroupKey(g.key, merged), itemKeys: [...new Set(g.columns.map((c) => c.key))].sort(), title: g.title };
}

/** The card moved to another group or teaches other requirements since the yes. A rename never counts. */
export function teacherChanged(at: TeacherSnap | null, now: TeacherSnap): boolean {
  if (!at) return false;
  return at.group !== now.group || at.itemKeys.join('|') !== now.itemKeys.join('|');
}

const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);

export function teacherState(a: {
  /** A slot row puts them on this card now. */
  onCard: boolean;
  /** They said they can't make the meeting at all. */
  hiddenByIntent: boolean;
  answer: TeacherAnswer | null;
  /** The newest teacher email or invite about this card (askedAtOf). */
  askedAt: string | null;
  /** When they were put on the card (the slot row's created_at). */
  slotSince: string | null;
  now: TeacherSnap;
}): PlanState {
  if (a.hiddenByIntent) return 'hidden';
  if (!a.onCard) return a.answer?.answer === 'no' ? 'said_no' : 'planned';
  // An answer from before they were (re)placed on this card is about an earlier plan.
  const answer = a.answer && (!a.slotSince || a.answer.answeredAt >= a.slotSince) ? a.answer : null;
  const asked = a.askedAt && a.askedAt > (later(a.slotSince, answer?.answeredAt) ?? '') ? a.askedAt : null;
  if (asked) return 'asked';
  if (answer?.answer === 'yes') return teacherChanged(answer.plan, a.now) ? 'changed' : 'confirmed';
  return 'planned';
}

/** The newest email or invite asking this person about this card, merged split keys read as one. */
export function askedAtOf(sent: readonly { personId: number; group: string; at: string }[], p: { personId: number; groupKey: string; merged?: ReadonlySet<string> }): string | null {
  const key = canonicalGroupKey(p.groupKey, p.merged);
  let at: string | null = null;
  for (const s of sent) if (s.personId === p.personId && canonicalGroupKey(s.group, p.merged) === key) at = later(at, s.at);
  return at;
}

export interface ScoutAnswer {
  answeredAt: string;
  /** The scout's plan at "This plan looks good" (ScoutPlanSent, the emails' shape). */
  plan: ScoutPlanSent;
}

/** A scout's plan: Can't make it is a no; "This plan looks good" confirms it until the plan changes (C-D5). */
export function scoutState(a: { intent: Intent | null; answer: ScoutAnswer | null; askedAt: string | null; now: ScoutPlanSent | undefined }): PlanState {
  if (a.intent === 'not_coming') return 'said_no';
  if (a.answer) return a.askedAt && a.askedAt > a.answer.answeredAt ? 'asked' : planChanged(a.answer.plan, a.now) ? 'changed' : 'confirmed';
  return a.askedAt ? 'asked' : 'planned';
}
