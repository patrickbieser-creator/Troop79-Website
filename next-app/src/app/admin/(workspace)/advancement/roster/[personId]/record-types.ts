/**
 * The person record's shared vocabulary — types and the tab labels — with
 * NO server imports, so the client shell (person-record.tsx, status-card.tsx)
 * can read them without dragging lib/supabase/server (next/headers) into the
 * browser bundle. load-person-record.ts re-exports everything here for the
 * server side.
 */

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
  rankLabel: string | null;
  household: { id: number; label: string; members: HouseholdMember[] } | null;
  /** Which row the Status card acts on: the scout's for a scout tab, the
   *  person's otherwise. */
  status: PersonStatus;
  /** A family's change request is waiting for review (Phase 5 renders it). */
  pendingUpdate: boolean;
  today: string;
}
