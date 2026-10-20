/**
 * Public-facing scout name format — first name + last initial (e.g. "Alex M.")
 * instead of the full legal name shown in the admin workspace. Applies
 * everywhere a scout's name renders on a `(public)` page; admin views keep
 * `display_name` (full name) unchanged.
 *
 * The first name is the one the scout goes by (2026-10-20): the nickname when
 * the caller has it, else the display name's first part (display_name is
 * nickname-or-first + last since the nickname trigger), else first_name.
 */
export function publicScoutName(scout: {
  first_name: string;
  last_name: string;
  nickname?: string | null;
  display_name?: string | null;
}): string {
  const last = scout.last_name.trim();
  const display = scout.display_name?.trim() ?? '';
  const fromDisplay = last && display.endsWith(` ${last}`) ? display.slice(0, -last.length - 1).trim() : '';
  const first = scout.nickname?.trim() || fromDisplay || scout.first_name;
  const lastInitial = last.charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}
