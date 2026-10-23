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

const RANK_CODE = /^(Scout|Tenderfoot|Second Class|First Class|Star|Life|Eagle) (\d\S*)$/;

/**
 * A plan offering the short way (Invite's Review, Patrick 2026-10-22): 'Tenderfoot 3a' + 'Square Knot use' →
 * 'Ten 3a · Square Knot use'. A merit badge keeps its name ('First Aid 9 · Rescues'); no code leaves the title alone.
 */
export function shortRequirement(codeLabel: string, title: string): string {
  const m = RANK_CODE.exec(codeLabel.trim());
  const code = m ? `${rankAbbrev(m[1])} ${m[2]}` : codeLabel.trim();
  return [code, title].filter(Boolean).join(' · ');
}
