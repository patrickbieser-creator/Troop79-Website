/**
 * The person record's shared vocabulary — types and the tab labels — with
 * NO server imports, so the client shell (person-record.tsx, status-card.tsx)
 * can read them without dragging lib/supabase/server (next/headers) into the
 * browser bundle. load-person-record.ts re-exports everything here for the
 * server side.
 */

import type { AuditDetail } from '@/lib/audit';
import type { PersonEmailRow } from '@/lib/person-emails';
import type { InactiveReason } from '@/lib/supabase/types';
import type { PersonDetail } from '../person-actions';

export type RosterTab = 'active_scout' | 'inactive_scout' | 'leader' | 'adult';
export type PersonKind = 'scout' | 'leader' | 'adult';

export const ROSTER_TABS: readonly RosterTab[] = ['active_scout', 'inactive_scout', 'leader', 'adult'];

export const TAB_LABEL: Record<RosterTab, string> = {
  active_scout: 'Active Scouts',
  inactive_scout: 'Inactive Scouts',
  leader: 'Leaders',
  adult: 'Adults'
};

export function isRosterTab(v: string | undefined | null): v is RosterTab {
  return !!v && (ROSTER_TABS as readonly string[]).includes(v);
}

export function kindOfTab(tab: RosterTab): PersonKind {
  if (tab === 'active_scout' || tab === 'inactive_scout') return 'scout';
  return tab;
}

/** Display names for person_roles.role. The roster editor keeps a private
 *  copy until Phase 6 retires it. */
export const ROLE_LABEL: Record<string, string> = {
  adult_leader: 'Adult leader',
  committee_member: 'Committee member',
  chartered_org_rep: 'Chartered org rep',
  merit_badge_counselor: 'Merit badge counselor',
  external_contact: 'External contact',
  youth_member: 'Youth member'
};

/** The roles that put an adult on the Leaders tab (person_directory's
 *  holds_troop_role). Ending the last of them moves them to Adults. */
export const LEADER_ROLES: ReadonlySet<string> = new Set(['adult_leader', 'committee_member', 'chartered_org_rep']);

/** Roles a leader may grant, in the order the Grant row lists them. */
export const GRANTABLE_ROLES = [
  'adult_leader',
  'committee_member',
  'chartered_org_rep',
  'merit_badge_counselor',
  'external_contact'
] as const;

/** The scout's own record — what stays on `scouts` (never contact details). */
export interface ScoutRecordRow {
  id: string;
  patrol: string | null;
  current_rank: string | null;
  school: string | null;
  graduation_year: number | null;
  swim_class: 'swimmer' | 'beginner' | 'nonswimmer' | null;
  active: boolean;
  inactive_reason: InactiveReason | null;
  junior_leader_override: 'yes' | 'no' | null;
}

export interface HouseholdMember {
  personId: number;
  name: string;
  kind: PersonKind;
  active: boolean;
}

export interface PersonStatus {
  active: boolean;
  /** Scout: an InactiveReason code. Adult: free text. Null when active. */
  reason: string | null;
}

/** One row of the Family section's household picker. */
export interface HouseholdChoice {
  id: number;
  label: string;
}

/** One audit_log row about this person (Phase 4, History). `details` is the
 *  field-level old -> new diff; null for a row logged before the cutover, which
 *  shows summary only. */
export interface PersonHistoryEntry {
  id: number;
  /** timestamptz - an instant; render with fmtDateTime. */
  occurredAt: string;
  actorLabel: string;
  actorPersonId: number | null;
  action: string;
  summary: string;
  details: AuditDetail[] | null;
}

/** What the page loads up front: the latest few rows plus the counts the
 *  fact-strip card shows; the Full log fetches the rest on demand. */
export interface PersonHistorySummary {
  latest: PersonHistoryEntry[];
  total: number;
  withDetails: number;
}

export interface PersonRecord {
  personId: number;
  displayName: string;
  kind: PersonKind;
  tab: RosterTab;
  detail: PersonDetail;
  emails: PersonEmailRow[];
  /** Present when a scouts row is linked — even for an aged-out scout now
   *  listed as an adult; the page reads it only when `kind === 'scout'`. */
  scout: ScoutRecordRow | null;
  /** people.gender ('M' | 'F' | null) — outside LEADER_PERSON_FIELDS, so it
   *  rides here rather than in detail.fields. Edited on a scout's Details. */
  gender: string | null;
  /** The linked leaders row, when one exists: sign-off code and the
   *  Access & Permissions flag (leaders.can_login — a separate switch from
   *  "can sign in", which is derived from the addresses). Also one of the
   *  records deletePerson refuses to orphan. */
  leader: { code: string; canLogin: boolean } | null;
  rankLabel: string | null;
  household: { id: number; label: string; members: HouseholdMember[] } | null;
  /** Every household, for the Family section's draft picker. */
  households: HouseholdChoice[];
  /** Which row the Status card acts on: the scout's for a scout tab, the
   *  person's otherwise. */
  status: PersonStatus;
  /** A family's change request is waiting for review (Phase 5 renders it). */
  pendingUpdate: boolean;
  today: string;
  /** The audit_log filtered to this person (Phase 4). The loader always
   *  fills it; optional only so a section rendered from an older fixture
   *  still type-checks - the shell treats a missing value as empty. */
  history?: PersonHistorySummary;
}
