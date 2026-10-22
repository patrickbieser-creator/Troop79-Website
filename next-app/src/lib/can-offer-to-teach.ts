/**
 * Who among the scouts may offer to teach (Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 11 / Q-D, Patrick
 * 2026-10-18: "rather err on the side of over-ambitious"): any First Class+ scout, always — no override can block it —
 * or a Junior Leader, which is the participant-class rule (grade 9–12 as of the meeting date, the roster override
 * winning). Adults still decide who actually teaches. Replaces the meeting engine's old Star+ gate.
 */

import { defaultClassFor, type JuniorLeaderOverride } from '@/lib/participant-class';

export function canOfferToTeach(s: {
  /** ranks.sort_order of the scout's current rank; null = unranked. */
  rankSortOrder: number | null;
  /** ranks.sort_order of First Class. */
  firstClassSortOrder: number;
  graduationYear: number | null;
  override: JuniorLeaderOverride;
  /** The meeting date ('YYYY-MM-DD'): grade is evaluated as of then. */
  onDate: string;
}): boolean {
  if (s.rankSortOrder != null && s.rankSortOrder >= s.firstClassSortOrder) return true;
  return defaultClassFor({ isScout: true, graduationYear: s.graduationYear, override: s.override, onDate: s.onDate }) === 'junior_leader';
}

/**
 * The one "can't teach" message, true for every app path that asks loadTeacherPeople (Meeting Live's teacher, the
 * member teach page): an adult, or a scout canOfferToTeach admits. Lives here, beside the rule it states.
 */
export const NOT_A_TEACHER = 'Only adults, Junior Leaders, and scouts at First Class or above can teach.';
