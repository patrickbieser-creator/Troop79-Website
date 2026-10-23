/**
 * Short rank names for tight labels (Has/Needs' "Add Ten 3a · Square Knot use", Patrick 2026-10-22). Takes a rank id
 * ('second-class') or its name ('Second Class'); anything else comes back as given. Client-safe.
 */
const ABBREV: Readonly<Record<string, string>> = {
  scout: 'Scout',
  tenderfoot: 'Ten',
  'second-class': 'Sec',
  'first-class': 'Fir',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

export function rankAbbrev(idOrName: string): string {
  return ABBREV[idOrName.trim().toLowerCase().replace(/\s+/g, '-')] ?? idOrName;
}
