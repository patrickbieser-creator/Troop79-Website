/**
 * Meeting Plan snapshot payload — the JSON stored in `meeting_plans.payload`
 * and rendered by both the admin preview and the public /meeting-plan page.
 *
 * Kept in lib/ (not under the admin route) because the public page imports
 * these types too. The payload is self-contained on purpose: once published,
 * the public page renders the snapshot without re-deriving anything from the
 * ledger.
 */

export type TierId = 'new' | 'experienced' | 'older';

export const TIER_LABEL: Record<TierId, string> = {
  new: 'New Scouts',
  experienced: 'Experienced Scouts',
  older: 'Older Scouts'
};

export const TIER_NOTE: Record<TierId, string> = {
  new: 'working toward Scout & Tenderfoot — skills-instruction track 1',
  experienced: 'working toward Second & First Class — track 2',
  older: 'Star & above — leadership, teaching, merit badges'
};

export interface PlanScoutRef {
  id: string;
  /** Full display name — the PUBLIC page formats first name + last initial. */
  name: string;
  patrol: string | null;
  rankId: string | null;
  rankLabel: string;
}

export interface PlanTeacher {
  code: string;
  name: string;
}

export interface PlanScoutTeacher {
  id: string;
  name: string;
  rankLabel: string;
}

export interface PlanSession {
  /** 1-based session number, stable within a snapshot. */
  id: number;
  tier: TierId;
  kind: 'rank' | 'mb';
  /** Display code, e.g. "Tenderfoot 3a" or "Personal Management 2a". */
  codeLabel: string;
  /** Requirement (or badge) label. */
  title: string;
  /** Eagle-required badge marker (mb sessions only). */
  eagle: boolean;
  skillId: string | null;
  skillName: string | null;
  /** Skill is flagged and youth-teachable → "Older scout may teach" tag. */
  youthTeachable: boolean;
  /** Skill is flagged adult-instruction → "Adults only" tag. */
  adultOnly: boolean;
  /** 'A' / 'B' / ... when a >8-scout cohort was split by patrol. */
  groupPart: string | null;
  scouts: PlanScoutRef[];
  adultTeachers: PlanTeacher[];
  /** MB counselors (mb sessions) — shown in the Counselor slot. */
  counselors: PlanTeacher[];
  scoutTeachers: PlanScoutTeacher[];
}

export interface ScoutSuggestion {
  kind: 'rank' | 'mb';
  /** Short display code, e.g. "TF 3a" or "MB Personal Mgmt 2a". */
  codeLabel: string;
  label: string;
  eagle: boolean;
  /** Session this suggestion is grouped into, when shared. */
  sessionId: number | null;
}

export interface OutingItem {
  codeLabel: string;
  label: string;
}

export interface PlanByScout {
  scout: PlanScoutRef;
  tier: TierId;
  suggestions: ScoutSuggestion[];
  /** Campout-only outstanding items — kept visible, never suggested. */
  needsOuting: OutingItem[];
}

export interface RosterAdult {
  code: string;
  name: string;
  role: string | null;
  skills: string[];
  sessionIds: number[];
}

export interface RosterScoutInstructor {
  id: string;
  name: string;
  rankLabel: string;
  skills: string[];
  sessionIds: number[];
}

export interface PlanStats {
  scoutsWithSuggestions: number;
  sessions: number;
  adultsMatched: number;
  scoutInstructors: number;
  outingItems: number;
}

export interface MeetingPlanPayload {
  version: 1;
  meetingDate: string;
  title: string;
  generatedAt: string;
  stats: PlanStats;
  sessions: PlanSession[];
  byScout: PlanByScout[];
  rosterAdults: RosterAdult[];
  rosterScoutInstructors: RosterScoutInstructor[];
}

/** Public-page name treatment: "Mason Turner" → "Mason T." */
export function publicName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
