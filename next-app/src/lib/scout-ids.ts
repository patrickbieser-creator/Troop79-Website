/**
 * Troop scout IDs (scouts.id) are joining cohorts: a letter per cohort
 * (A ≈ 2020 … E = 2025–26) and a two-digit number, typed by a leader.
 * Pure and client-safe.
 */

interface IdRow {
  id: string;
  active: boolean;
  is_webelos?: boolean;
}

const COHORT_ID = /^([A-Z])(\d+)$/;

/**
 * The ID to suggest for a new Webelos (Patrick, 2026-11-12): Webelos join as
 * the NEXT cohort and keep the ID through crossover. While any Webelos exist,
 * new ones continue their letter; otherwise the letter after the newest
 * ACTIVE cohort (an inactive one-off like the test scout T01 is not a cohort).
 * The number is one past the highest already used under that letter by
 * anyone, so a crossed-over F01 is never handed out again.
 */
export function nextWebelosId(scouts: readonly IdRow[]): string {
  const parsed = scouts
    .map((s) => ({ s, m: COHORT_ID.exec(s.id) }))
    .filter((x): x is { s: IdRow; m: RegExpExecArray } => x.m != null);
  const maxLetter = (rows: typeof parsed) =>
    rows.reduce<string | null>((max, x) => (max == null || x.m[1] > max ? x.m[1] : max), null);

  const webelosLetter = maxLetter(parsed.filter((x) => x.s.is_webelos));
  const activeLetter = maxLetter(parsed.filter((x) => x.s.active && !x.s.is_webelos));
  const letter =
    webelosLetter ?? (activeLetter == null ? 'A' : String.fromCharCode(Math.min(activeLetter.charCodeAt(0) + 1, 90)));

  const used = parsed.filter((x) => x.m[1] === letter).map((x) => Number(x.m[2]));
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `${letter}${String(next).padStart(2, '0')}`;
}
