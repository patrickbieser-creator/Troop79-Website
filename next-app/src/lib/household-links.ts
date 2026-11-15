/**
 * How an adult being added to a household relates to each scout already in it. Plain module (client + server).
 *
 * A shared household grants nothing (lib/household-scope): only a parent_of or guardian_of link lets a parent manage
 * a child's records. The roster's Add adult dialog used to create the membership with no link, so the parent
 * could not see their own child's health forms (Kevin Greene, 2026-11-14). Every scout in the chosen household now
 * needs an answer, and "neither" is a real answer (a grandparent, a step-parent who isn't a guardian).
 */
export const HOUSEHOLD_LINK_OPTIONS = [
  { value: 'parent_of', label: 'Parent' },
  { value: 'guardian_of', label: 'Guardian' },
  { value: 'none', label: 'Neither' }
] as const;

export type HouseholdLinkType = 'parent_of' | 'guardian_of';
export interface HouseholdScout {
  personId: number;
  name: string;
}

export const linkField = (personId: number) => `relation_${personId}`;

export type HouseholdLinksResult = { ok: true; links: { personId: number; type: HouseholdLinkType }[] } | { ok: false; error: string };

export function readHouseholdLinks(get: (key: string) => unknown, scouts: HouseholdScout[]): HouseholdLinksResult {
  const links: { personId: number; type: HouseholdLinkType }[] = [];
  for (const s of scouts) {
    const v = get(linkField(s.personId));
    if (v === 'parent_of' || v === 'guardian_of') links.push({ personId: s.personId, type: v });
    else if (v !== 'none') return { ok: false, error: `Say how this person is related to ${s.name}.` };
  }
  return { ok: true, links };
}
