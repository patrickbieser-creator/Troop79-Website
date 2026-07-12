/**
 * Public-facing scout name format — first name + last initial (e.g. "Alex M.")
 * instead of the full legal name shown in the admin workspace. Applies
 * everywhere a scout's name renders on a `(public)` page; admin views keep
 * `display_name` (full name) unchanged.
 */
export function publicScoutName(scout: { first_name: string; last_name: string }): string {
  const lastInitial = scout.last_name.trim().charAt(0);
  return lastInitial ? `${scout.first_name} ${lastInitial}.` : scout.first_name;
}
