/**
 * The Sent log's words (Patrick, 2026-11-01: "the To and About make no sense"; one line per email is the goal). Pure:
 * lib/meeting-email-screen builds each line with these, the Emails screen shows them.
 *
 *   When · initials | To (the rest on hover) | what the email was | how it landed | what they've answered since
 */
import type { Intent } from '@/lib/meeting-board-shared';
import type { PlanState } from '@/lib/plan-states';
import type { EmailKind } from '@/lib/meeting-emails';

const NO_ANSWER = 'No answer yet';
const listOf = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What the email was: 'Fiona K and Jameson K’s plan', 'Ask to teach First Class group', 'Planned to teach Scout Group 2:
 *  confirm', 'Coming Sunday? reminder'. A teacher email reads by the plan as it stands now. */
export function emailWords(l: { kind: EmailKind; scoutNames: readonly string[]; groupTitle: string | null; planned: boolean }): string {
  if (l.kind === 'reminder') return 'Coming Sunday? reminder';
  if (l.kind === 'plan') return `${listOf(l.scoutNames)}’s plan`;
  if (!l.groupTitle) return 'Ask to teach a group no longer on the plan';
  return l.planned ? `Planned to teach ${l.groupTitle}: confirm` : `Ask to teach ${l.groupTitle}`;
}

/** The To name's hover: who they are to the email, the address, and any copies. */
export function toHint(l: { sentTo: string; recipientIsScout: boolean; scoutNames: readonly string[]; cc: readonly string[] }): string {
  const who = !l.scoutNames.length ? null : l.recipientIsScout ? `${listOf(l.scoutNames)}’s own address` : `Parent of ${listOf(l.scoutNames)}`;
  return [who, l.sentTo, l.cc.length ? `copies ${l.cc.join(', ')}` : null].filter(Boolean).join(' · ');
}

/** 'Patrick Bieser' → 'PB': the first and last words' first letters. */
export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return w.length ? (w.length === 1 ? w[0][0] : `${w[0][0]}${w[w.length - 1][0]}`).toUpperCase() : '';
}

/** A scout's answer as the family gave it: their yes to the plan, a change, or Coming / Not sure / Not this week. */
export function scoutAnswerWord(state: PlanState | undefined, intent: Intent | null | undefined): string {
  if (intent !== 'not_coming' && state === 'confirmed') return 'Plan looks good ✓';
  if (intent !== 'not_coming' && state === 'changed') return 'Changed plan';
  return intent === 'coming' ? 'Coming' : intent === 'undecided' ? 'Not sure' : intent === 'not_coming' ? 'Not this week' : NO_ANSWER;
}

/** A teacher's answer about the group: their yes, a change, or Not this week (to the card, or to the whole night). */
/** `by`: the initials of a planner who entered the answer for them ('I’ll teach ✓ · PB'). */
export function teacherAnswerWord(t: { state: PlanState | undefined; saidNo: boolean; intent: Intent | null | undefined; by?: string | null }): string {
  const word = t.saidNo || t.intent === 'not_coming' ? 'Not this week' : t.state === 'confirmed' ? 'I’ll teach ✓' : t.state === 'changed' ? 'Changed plan' : NO_ANSWER;
  return t.by && word !== NO_ANSWER ? `${word} · ${t.by}` : word;
}

/** One line's answer from each person it covers: one word when they agree, else each by name. */
export function answerOf(each: readonly { name: string; word: string }[]): { word: string; answered: boolean } {
  const answered = each.some((e) => e.word !== NO_ANSWER);
  if (!each.length) return { word: NO_ANSWER, answered: false };
  if (each.every((e) => e.word === each[0].word)) return { word: each[0].word, answered };
  return { word: each.map((e) => `${e.name}: ${e.word}`).join(' · '), answered };
}

export type AnswerTone = 'yes' | 'no' | 'mixed' | 'other';

/** How an answer looks on the Sent log (Patrick, 2026-11-01): a yes green, mixed answers yellow, Not this week grey,
 *  anything else outlined; no answer stays plain text (null). */
export function answerTone(word: string): AnswerTone | null {
  if (word === NO_ANSWER) return null;
  if (word.includes(': ')) return 'mixed';
  // An answer a planner entered reads as the answer ('I’ll teach ✓ · PB').
  const base = word.split(' · ')[0];
  if (base === 'Plan looks good ✓' || base === 'I’ll teach ✓' || base === 'Coming') return 'yes';
  if (base === 'Not this week') return 'no';
  return 'other';
}
