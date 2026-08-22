/**
 * Leader-only roster columns (Plans/Event-Logistics.md §D) — the campout
 * sheet's "Health Forms" and "Registered?" ticks. A leader-only
 * signup_question is never a family prompt; it is a cell the leader fills.
 *
 * Rendering rule for the roster and the snapshot:
 *   - choice with exactly one option  → a checkbox (value = that option)
 *   - choice with several             → a select
 *   - text / number                   → an input
 * Printing rule: checkbox and number columns always print; free text only
 * when print_allowed (the snapshot goes to scouts).
 */

export interface LeaderPreset {
  prompt: string;
  appliesTo: 'scouts' | 'adults' | 'both';
  /** Pre-suggest from a roster fact (a hint beside the cell, never auto-written). */
  hint?: 'health_form_date';
}

export const LEADER_PRESETS: readonly LeaderPreset[] = [
  { prompt: 'Health form in hand', appliesTo: 'both', hint: 'health_form_date' },
  { prompt: 'Registered with council', appliesTo: 'both' }
];

export interface LeaderQuestion {
  id: number;
  prompt: string;
  inputType: 'text' | 'number' | 'choice';
  choices: string[] | null;
  appliesTo: 'scouts' | 'adults' | 'both';
  printAllowed: boolean;
}

export function isCheckboxColumn(q: Pick<LeaderQuestion, 'inputType' | 'choices'>): boolean {
  return q.inputType === 'choice' && (q.choices?.length ?? 0) === 1;
}

/** The health-form hint: true when the person's AHMR date is within 12
 *  months of the event date (so "in hand" is likely) — a nudge for the
 *  leader's tick, never the tick itself. */
export function healthFormLikelyCurrent(healthFormDate: string | null | undefined, eventDate: string): boolean {
  if (!healthFormDate) return false;
  const hf = new Date(`${healthFormDate}T00:00:00Z`).getTime();
  const ev = new Date(`${eventDate}T00:00:00Z`).getTime();
  if (Number.isNaN(hf) || Number.isNaN(ev)) return false;
  const twelveMonths = 366 * 24 * 60 * 60 * 1000;
  return hf <= ev && ev - hf <= twelveMonths;
}

/** Which leader columns go to the CSV / snapshot. */
export function printableLeaderQuestions<T extends Pick<LeaderQuestion, 'inputType' | 'printAllowed'>>(qs: readonly T[]): T[] {
  return qs.filter((q) => q.inputType !== 'text' || q.printAllowed);
}
