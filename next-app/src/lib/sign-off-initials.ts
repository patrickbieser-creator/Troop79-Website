/**
 * Sign-off initials rules (Plans/Sign-Off-Initials.md). Pure — the database
 * RPCs enforce the same rules; these feed the form (suggestion, shape check,
 * reuse date) so a leader sees the answer before pressing Save.
 */

/** 2–5 letters, optionally one digit 2–9 ("KP2" when KP is taken). Mirrors _initials_check_shape. */
export const INITIALS_SHAPE = /^[A-Za-z]{2,5}[2-9]?$/;

export const INITIALS_SHAPE_MESSAGE = 'Initials are 2–5 letters, like PB or KrP.';

export function initialsShapeProblem(code: string): string | null {
  return INITIALS_SHAPE.test(code.trim()) ? null : INITIALS_SHAPE_MESSAGE;
}

/**
 * First and last initial, upper-cased, plus 2, 3… if taken (ignoring case).
 * Falls back to `fallback` (e.g. the scout id) when the name has no letters.
 */
export function suggestInitials(
  first: string | null | undefined,
  last: string | null | undefined,
  taken: Iterable<string>,
  fallback = ''
): string {
  const letter = (s: string | null | undefined) => (s ?? '').match(/[A-Za-z]/)?.[0] ?? '';
  const base = (letter(first) + letter(last)).toUpperCase() || fallback.toUpperCase();
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}${n}`;
  return candidate;
}

/** The first day a retired code may go to someone else: 5 years after its newest entry. 'YYYY-MM-DD' in, out. */
export function reuseDate(newestEntry: string): string {
  const [y, m, d] = newestEntry.split('-').map(Number);
  // Feb 29 + 5 years lands on Feb 28, as Postgres's date + interval '5 years' does.
  const day = m === 2 && d === 29 ? 28 : d;
  return `${String(y + 5).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
