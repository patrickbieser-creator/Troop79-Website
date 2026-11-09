/**
 * Public-facing scout name format — first name + last initial (e.g. "Alex M.")
 * instead of the full legal name shown in the admin workspace. Applies
 * everywhere a scout's name renders on a `(public)` page for a VISITOR; admin
 * views keep `display_name` (full name) unchanged.
 *
 * Signed-in troop members (any troop sign-in: family password, a verified
 * household, a scout, a leader) see the last name too — troopScoutName()
 * (Patrick, 2026-11-09: "useful for the families").
 *
 * The first name is the one the scout goes by (2026-10-20): the nickname when
 * the caller has it, else the display name's first part (display_name is
 * nickname-or-first + last since the nickname trigger), else first_name.
 */
type NameParts = {
  first_name: string;
  last_name: string;
  nickname?: string | null;
  display_name?: string | null;
};

function goesBy(scout: NameParts): string {
  const last = scout.last_name.trim();
  const display = scout.display_name?.trim() ?? '';
  const fromDisplay = last && display.endsWith(` ${last}`) ? display.slice(0, -last.length - 1).trim() : '';
  return scout.nickname?.trim() || fromDisplay || scout.first_name;
}

export function publicScoutName(scout: NameParts): string {
  const first = goesBy(scout);
  const lastInitial = scout.last_name.trim().charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/** The name for a public page: full for a signed-in troop member, "First L." for a visitor. */
export function troopScoutName(scout: NameParts, signedIn: boolean): string {
  if (!signedIn) return publicScoutName(scout);
  const last = scout.last_name.trim();
  const first = goesBy(scout);
  return last ? `${first} ${last}` : first;
}
