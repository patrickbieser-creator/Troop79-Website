/**
 * Participant classification for event sign-ups
 * (Plans/Participant-Classification.md, Patrick 2026-08-21).
 *
 * Seven fixed classes — Adult, Scout, Junior Leader (a scout in high school,
 * a subset of Scouts), Webelos, Cub Scout, Youth Guest, Adult Guest — stored
 * per sign-up ENTRY (`signup_entries.participant_class`), defaulted from the
 * roster person at sign-up time and editable per event by a leader. A fixed
 * vocabulary in code + a CHECK constraint (the TRANSACTION_METHODS pattern),
 * not a lookup table: Patrick named the list; it is not family-extensible.
 *
 * Junior Leader derives from grade 9–12 AS OF THE EVENT DATE (graduation
 * year, June 15 rollover — lib/demographics) unless the scout's roster record
 * carries an override (`scouts.junior_leader_override`: 'yes' | 'no' | null
 * = auto). Every call site — the family form, the leader's Add a person, the
 * SQL backfill — must agree with `defaultClassFor` below.
 */

import { gradeFromGradYear } from '@/lib/demographics';

export const PARTICIPANT_CLASSES = [
  'adult',
  'scout',
  'junior_leader',
  'webelos',
  'cub_scout',
  'youth_guest',
  'adult_guest'
] as const;
export type ParticipantClass = (typeof PARTICIPANT_CLASSES)[number];

export const PARTICIPANT_CLASS_LABEL: Record<ParticipantClass, string> = {
  adult: 'Adult',
  scout: 'Scout',
  junior_leader: 'Junior Leader',
  webelos: 'Webelos',
  cub_scout: 'Cub Scout',
  youth_guest: 'Youth Guest',
  adult_guest: 'Adult Guest'
};

/** Grid / snapshot shorthand (Patrick, 2026-08-22 — "S, A, JL, Cub, W, G"):
 *  the full label rides along in the cell's title. Both guest classes are
 *  "G"; the youth/adult split is visible from the row's other cells. */
export const PARTICIPANT_CLASS_SHORT: Record<ParticipantClass, string> = {
  adult: 'A',
  scout: 'S',
  junior_leader: 'JL',
  webelos: 'W',
  cub_scout: 'Cub',
  youth_guest: 'G',
  adult_guest: 'G'
};

/** The classes a family (or leader) can add BY NAME as a guest row — people
 *  who are not on the troop roster. */
export const GUEST_CLASSES = ['webelos', 'cub_scout', 'youth_guest', 'adult_guest'] as const;
export type GuestClass = (typeof GUEST_CLASSES)[number];

const YOUTH: ReadonlySet<ParticipantClass> = new Set(['scout', 'junior_leader', 'webelos', 'cub_scout', 'youth_guest']);

export function isParticipantClass(value: string): value is ParticipantClass {
  return (PARTICIPANT_CLASSES as readonly string[]).includes(value);
}

export function isYouthClass(cls: ParticipantClass): boolean {
  return YOUTH.has(cls);
}

/** Pricing audience (event_prices.applies_to): youth classes price as scouts,
 *  adult classes as adults (Patrick, 2026-08-21 — no per-class tiers now). */
export function tierAudienceFor(cls: ParticipantClass): 'scouts' | 'adults' {
  return isYouthClass(cls) ? 'scouts' : 'adults';
}

/** The legacy `person_kind` column, kept in step with the class so every
 *  reader that hasn't migrated (headcounts, two-deep, slips) stays right. */
export function personKindFor(cls: ParticipantClass): 'scout' | 'adult' {
  return isYouthClass(cls) ? 'scout' : 'adult';
}

export type JuniorLeaderOverride = 'yes' | 'no' | null;

/**
 * The class a ROSTER person defaults to on a given event date. Guests never
 * come through here — their class is chosen when the row is added.
 */
export function defaultClassFor(input: {
  isScout: boolean;
  graduationYear: number | null;
  override: JuniorLeaderOverride;
  /** The event date ('YYYY-MM-DD') — grade is evaluated as of then. */
  onDate: string;
}): ParticipantClass {
  if (!input.isScout) return 'adult';
  if (input.override === 'yes') return 'junior_leader';
  if (input.override === 'no') return 'scout';
  const grade = gradeFromGradYear(input.graduationYear, input.onDate);
  return grade !== null && grade >= 9 && grade <= 12 ? 'junior_leader' : 'scout';
}
