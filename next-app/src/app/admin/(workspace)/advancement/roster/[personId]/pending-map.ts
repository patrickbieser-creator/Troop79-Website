/**
 * Which section of the person record a family's proposed field belongs to,
 * and what the record currently holds for it (Plans/Person-Editor-Rethink.md
 * Phase 5). Pure — no server or client imports — so the loader, the banner
 * and the tests all read one table.
 *
 * The keys are the change-request field names (lib/change-requests): an
 * 'adult' request uses people column names; a 'scout' request uses the
 * scout-side names, where `phone` / `email` are people.primary_phone /
 * primary_email via the scout's person link and school / graduation_year /
 * swim_class live on `scouts` (SCOUT_FIELD_TABLE). A key that maps to no
 * section (none today — every allowlisted field has a home) is simply not
 * shown, but still counts toward "all N changes" because approval applies it.
 */
import { SCOUT_FIELD_PEOPLE_COLUMN, type FieldValue } from '@/lib/change-requests';
import { gradeFromGradYear, gradeLabel, SWIM_CLASS_LABEL } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import type { PendingChangeRequest, PersonRecord } from './record-types';

export type SectionKey = 'identity' | 'details' | 'contact' | 'family';

export const SECTION_TITLE: Record<SectionKey, string> = {
  identity: 'Identity',
  details: 'Details',
  contact: 'Contact & sign-in',
  family: 'Household & family'
};

const CONTACT_ADULT = ['primary_email', 'primary_phone', 'address_line1', 'address_line2', 'city', 'state', 'zip'] as const;
const CONTACT_SCOUT = ['email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip'] as const;

const SECTION_FIELDS: Record<PendingChangeRequest['entityType'], Record<SectionKey, readonly string[]>> = {
  adult: {
    identity: [],
    details: ['first_name', 'last_name', 'birthdate'],
    contact: CONTACT_ADULT,
    family: []
  },
  scout: {
    identity: [],
    details: ['birthdate', 'school', 'graduation_year', 'swim_class', 'things_we_should_know'],
    contact: CONTACT_SCOUT,
    family: []
  }
};

/** The section a proposed field renders in, or null if none shows it. */
export function sectionOfField(entityType: PendingChangeRequest['entityType'], field: string): SectionKey | null {
  for (const key of Object.keys(SECTION_FIELDS[entityType]) as SectionKey[]) {
    if (SECTION_FIELDS[entityType][key].includes(field)) return key;
  }
  return null;
}

/** The request's proposed keys that belong to `section`, in the section's
 *  own field order. */
export function fieldsInSection(request: PendingChangeRequest, section: SectionKey): string[] {
  return SECTION_FIELDS[request.entityType][section].filter((k) => k in request.proposed);
}

/** The OTHER sections the request also touches — for the "Approve all N
 *  changes" copy, in page order. */
export function otherSectionsTouched(request: PendingChangeRequest, section: SectionKey): string[] {
  const seen = new Set<SectionKey>();
  for (const key of Object.keys(request.proposed)) {
    const s = sectionOfField(request.entityType, key);
    if (s && s !== section) seen.add(s);
  }
  return (Object.keys(SECTION_TITLE) as SectionKey[]).filter((k) => seen.has(k)).map((k) => SECTION_TITLE[k]);
}

/** The record's current values keyed by the REQUEST's field names, so the
 *  Field / Current / Proposed table compares like with like. */
export function currentValuesFor(record: Pick<PersonRecord, 'detail' | 'scout'>, entityType: PendingChangeRequest['entityType']): Record<string, FieldValue> {
  const f = record.detail.fields;
  if (entityType === 'adult') return { ...f };
  const scout = record.scout;
  const out: Record<string, FieldValue> = {};
  for (const [field, column] of Object.entries(SCOUT_FIELD_PEOPLE_COLUMN)) {
    if (column) out[field] = f[column] ?? null;
  }
  for (const key of ['address_line1', 'address_line2', 'city', 'state', 'zip', 'birthdate', 'things_we_should_know']) {
    out[key] = f[key] ?? null;
  }
  out.school = scout?.school ?? null;
  out.graduation_year = scout?.graduation_year ?? null;
  out.swim_class = scout?.swim_class ?? null;
  return out;
}

/** A value as the section's read row would show it: dates through fmtDate,
 *  a swim class by its label, a graduation year as the grade it means today. */
export function shownValue(field: string, value: FieldValue | undefined, today: string): string {
  if (value == null || value === '') return '—';
  if (field === 'birthdate' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return fmtDate(String(value));
  if (field === 'swim_class') return SWIM_CLASS_LABEL[String(value)] ?? String(value);
  if (field === 'graduation_year') {
    const n = Number(value);
    return Number.isFinite(n) ? `${gradeLabel(gradeFromGradYear(n, today))} (class of ${n})` : String(value);
  }
  return String(value);
}
