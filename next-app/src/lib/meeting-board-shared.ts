/**
 * The meeting board (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md): the rules both sides share, pure and
 * client-safe (no directive, no server imports), so /member/meeting, the planner and their tests read
 * one definition.
 *
 *   - Closed: a calendar entry that isn't a Troop Meeting, or a "No Troop Meeting" week. The calendar alone decides
 *     (Decision 10 of Plans/Meeting-Planner-II.md: a merit badge night is just a meeting; there is no stored mode).
 *   - Names on every board surface: first name + last initial, no period ("Finn P", Patrick 2026-10-18).
 *   - Intent: explicit answer wins; otherwise a pick for this meeting (not a "later" one) means Coming. Implied coming
 *     is computed here, never stored.
 *   - Carry-forward: a scout's picks from their last board come along until they change something on the new one;
 *     finished ones drop off, "later" is cleared, first-asked dates are kept.
 *   - The 5:30 pm Sunday soft close is display-only.
 */
import { centralToInstant } from '@/lib/dates';

export type Intent = 'coming' | 'undecided' | 'not_coming';

export const INTENTS: readonly Intent[] = ['coming', 'undecided', 'not_coming'];
export const INTENT_LABEL: Record<Intent, string> = {
  coming: 'Coming',
  undecided: 'Not sure yet',
  not_coming: 'Can’t make it'
};

/** Picks per scout per meeting, "later" picks included (they carry forward as ordinary picks). The RPC enforces it. */
export const MAX_PICKS = 5;
/** Sunday 5:30 pm, Central: after it the page says the plan is set. Nothing refuses a later write. */
export const SOFT_CLOSE_TIME = '17:30';

/** No sign-ups: the entry's category doesn't behave as a meeting, or its title says "No Troop Meeting". */
export function isMeetingClosed(input: { categoryBehavior: string | null; title: string }): boolean {
  return input.categoryBehavior !== 'meeting' || /^\s*no\s+troop\s+meeting/i.test(input.title);
}

/** "Finn Parker" → "Finn P". A one-word name stays as it is. */
export function boardName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}`;
}

export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/** "Finn P, Anjali S +4": the first two names, then how many more. */
export function othersLabel(names: readonly string[], shown = 2): string {
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} +${names.length - shown}`;
}

export interface BoardPick {
  /** topic_key: 'tenderfoot-4a', 'mb:first-aid'. */
  key: string;
  priority: number | null;
  later: boolean;
  note: string | null;
  /** 'YYYY-MM-DD'; survives carry-forward (the matcher's fairness tie-break). */
  firstAskedOn: string;
  enteredByPersonId: number | null;
  /** The earlier meeting's date ('YYYY-MM-DD') when this pick was carried, not yet saved on this board. */
  carriedFrom: string | null;
}

/** A pick for THIS meeting (not a "later" wish) or an explicit Coming means Coming; no answer and no pick = unknown. */
export function effectiveIntent(explicit: Intent | null, picks: readonly Pick<BoardPick, 'later'>[]): Intent | null {
  if (explicit) return explicit;
  return picks.some((p) => !p.later) ? 'coming' : null;
}

export function isPastSoftClose(meetingDate: string, now: Date = new Date()): boolean {
  const close = centralToInstant(meetingDate, SOFT_CLOSE_TIME);
  return close !== '' && now.getTime() >= Date.parse(close);
}

/** Ranked picks first, by number; then unranked ones in catalog order (Decision 8). */
export function orderPicks<T extends Pick<BoardPick, 'key' | 'priority'>>(picks: readonly T[], orderOf: (key: string) => number): T[] {
  return [...picks].sort(
    (a, b) =>
      Number(a.priority == null) - Number(b.priority == null) ||
      (a.priority ?? 0) - (b.priority ?? 0) ||
      orderOf(a.key) - orderOf(b.key) ||
      a.key.localeCompare(b.key)
  );
}

/** The picks a scout brings from their last board: unfinished ones only, "later" cleared, first-asked kept, the order
 *  renumbered without gaps (an unranked list stays unranked). Never more than MAX_PICKS. */
export function carryForward(prev: readonly BoardPick[], prevDate: string, isFinished: (key: string) => boolean): BoardPick[] {
  const kept = prev.filter((p) => !isFinished(p.key));
  const ranked = [...kept].filter((p) => p.priority != null).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const renumber = new Map(ranked.map((p, i) => [p.key, i + 1]));
  return kept.slice(0, MAX_PICKS).map((p) => ({
    ...p,
    priority: renumber.get(p.key) ?? null,
    later: false,
    carriedFrom: prevDate
  }));
}

export interface BoardScoutState {
  personId: number;
  intent: Intent | null;
  picks: readonly BoardPick[];
}

export interface BoardCounts {
  coming: number;
  undecided: number;
  notComing: number;
  noAnswer: number;
  /** Picks counted toward this meeting (Can't-make-it scouts and "later" picks left out). */
  picks: number;
  /** Picks kept for a later meeting: "later" picks, and every pick of a scout who can't make it. */
  held: number;
}

/**
 * The demand view: who wants what for THIS meeting. A scout who can't make it is left out of the counts (their picks
 * are kept for next week), and so is a "later" pick. Intent counts use the effective intent, so a pick counts as
 * Coming.
 */
export function summarizeBoard(scouts: readonly BoardScoutState[]): { counts: BoardCounts; demand: Map<string, number[]> } {
  const counts: BoardCounts = { coming: 0, undecided: 0, notComing: 0, noAnswer: 0, picks: 0, held: 0 };
  const demand = new Map<string, number[]>();
  for (const s of scouts) {
    const it = effectiveIntent(s.intent, s.picks);
    if (it === 'coming') counts.coming++;
    else if (it === 'undecided') counts.undecided++;
    else if (it === 'not_coming') counts.notComing++;
    else counts.noAnswer++;
    for (const p of s.picks) {
      if (p.later || it === 'not_coming') {
        counts.held++;
        continue;
      }
      counts.picks++;
      demand.set(p.key, [...(demand.get(p.key) ?? []), s.personId]);
    }
  }
  return { counts, demand };
}

/**
 * Who may write a scout's picks or answer (Decision 3): the scout themself; an adult in the scout's household; or a
 * leader entering on someone's behalf (the capability is checked by the caller). The RPC re-checks the household half.
 */
export function decideActFor(input: {
  actorPersonId: number;
  actorIsScout: boolean;
  targetPersonId: number;
  householdScoutPersonIds: readonly number[];
  leader: boolean;
}): boolean {
  if (input.leader) return true;
  if (input.actorPersonId === input.targetPersonId) return true;
  return !input.actorIsScout && input.householdScoutPersonIds.includes(input.targetPersonId);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line of live state for a scout on the next meeting: "Coming · 3 picks" (the /member card, the switcher). */
export function scoutLine(explicit: Intent | null, picks: readonly Pick<BoardPick, 'later'>[]): string {
  const it = effectiveIntent(explicit, picks);
  if (it === 'not_coming') return INTENT_LABEL.not_coming;
  if (!it) return picks.length ? plural(picks.length, 'pick') : 'No answer yet';
  return `${INTENT_LABEL[it]}${picks.length ? ` · ${plural(picks.length, 'pick')}` : ''}`;
}

/**
 * A leader opening /member/meeting?for=…: 'edit' with their own verified sign-in; 'read-only' on a password-only
 * leader session (every write needs a person to record as entered_by, so the page says to sign in instead of letting
 * each tap fail); 'none' when they may not enter for others at all.
 */
export function onBehalfAccess(input: { holdsMeetingPlan: boolean; actorIsScout: boolean; hasVerifiedSignIn: boolean }): 'edit' | 'read-only' | 'none' {
  if (!input.holdsMeetingPlan || input.actorIsScout) return 'none';
  return input.hasVerifiedSignIn ? 'edit' : 'read-only';
}

/** Teachers' names as a phrase: 'Mr. Vest', 'Mr. Vest and Ms. Ruiz', 'A, B and C'; '' for none. */
export function joinNames(names: readonly string[]): string {
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
