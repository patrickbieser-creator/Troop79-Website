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
 * First and last initial ("KP"). If taken (ignoring case), three letters the
 * way the troop already writes them: a second letter of the last name ("MBa",
 * Mike Babby) or of the first name ("KrP", Kristin Paltzer). Only then a
 * number ("KP2").
 * Falls back to `fallback` (e.g. the scout id) when the name has no letters.
 */
export function suggestInitials(
  first: string | null | undefined,
  last: string | null | undefined,
  taken: Iterable<string>,
  fallback = ''
): string {
  const letters = (v: string | null | undefined) => (v ?? '').replace(/[^A-Za-z]/g, '');
  const f = letters(first);
  const l = letters(last);
  const base = (f.slice(0, 1) + l.slice(0, 1)).toUpperCase() || fallback.toUpperCase();
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  const free = (c: string) => c.length > 0 && !used.has(c.toLowerCase());
  const three = [
    l.length > 1 ? base + l[1].toLowerCase() : '',
    f.length > 1 && l ? f[0].toUpperCase() + f[1].toLowerCase() + l[0].toUpperCase() : ''
  ];
  for (const c of [base, ...three]) if (free(c)) return c;
  let candidate = `${base}2`;
  for (let n = 3; !free(candidate); n++) candidate = `${base}${n}`;
  return candidate;
}

/** The first day a retired code may go to someone else: 5 years after its newest entry. 'YYYY-MM-DD' in, out. */
export function reuseDate(newestEntry: string): string {
  const [y, m, d] = newestEntry.split('-').map(Number);
  // Feb 29 + 5 years lands on Feb 28, as Postgres's date + interval '5 years' does.
  const day = m === 2 && d === 29 ? 28 : d;
  return `${String(y + 5).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
