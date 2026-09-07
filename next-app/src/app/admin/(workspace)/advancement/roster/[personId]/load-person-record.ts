/**
 * Server loader for the person record page (Plans/Person-Editor-Rethink.md
 * Phase 1) — one shape for a scout, a leader or an adult, so the page and
 * every card render from the same object. Reuses the roster editor's own
 * reads (`getPersonDetail`, `getPersonEmails`) rather than re-deriving them;
 * adds the scout row, the household's members and the pending-update flag.
 *
 * Server-only by use: imported by page.tsx (a Server Component) and
 * roster/page.tsx (the ?open= redirect). Not marked with the `server-only`
 * package so the db test project can exercise it against local Supabase
 * with the request-scoped glue mocked (tests/person-record-load.test.ts).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { getPersonDetail, getPersonEmails } from '../person-actions';

export * from './record-types';
import {
  isRosterTab,
  kindOfTab as kindOf,
  type PersonRecord,
  type PersonStatus,
  type RosterTab,
  type ScoutRecordRow
} from './record-types';

export type LoadPersonRecordResult =
  | { kind: 'found'; record: PersonRecord }
  | { kind: 'merged'; survivorId: number }
  | { kind: 'missing' };

const SCOUT_RECORD_COLS =
  'id, patrol, current_rank, school, graduation_year, swim_class, active, inactive_reason, junior_leader_override';

export async function loadPersonRecord(personId: number): Promise<LoadPersonRecordResult> {
  const supabase = createAdminClient();
  const { data: person } = await supabase
    .from('people')
    .select('id, display_name, merged_into_person_id, guest_host_household_id')
    .eq('id', personId)
    .maybeSingle();
  const row = person as {
    id: number;
    display_name: string;
    merged_into_person_id: number | null;
    guest_host_household_id: number | null;
  } | null;
  if (!row) return { kind: 'missing' };

  if (row.merged_into_person_id != null) {
    // Follow a chain of merges to whoever survived (bounded — a cycle would
    // be a data bug, not something to spin on).
    let survivor = row.merged_into_person_id;
    for (let hop = 0; hop < 5; hop++) {
      const { data: next } = await supabase
        .from('people')
        .select('merged_into_person_id')
        .eq('id', survivor)
        .maybeSingle();
      const into = (next as { merged_into_person_id: number | null } | null)?.merged_into_person_id;
      if (into == null) break;
      survivor = into;
    }
    return { kind: 'merged', survivorId: survivor };
  }
  // Guests (Plans/Guests-As-People.md) are not in person_directory and have
  // no record page yet — the Guests tab keeps its own row editor.
  if (row.guest_host_household_id != null) return { kind: 'missing' };

  const [detail, emails, scoutRes, genderRes, householdsRes] = await Promise.all([
    getPersonDetail(personId),
    getPersonEmails(personId),
    supabase.from('scouts').select(SCOUT_RECORD_COLS).eq('person_id', personId).maybeSingle(),
    supabase.from('people').select('gender').eq('id', personId).maybeSingle(),
    supabase.from('households').select('id, label').order('label')
  ]);
  const scout = (scoutRes.data as ScoutRecordRow | null) ?? null;
  const gender = (genderRes.data as { gender: string | null } | null)?.gender ?? null;
  const households = ((householdsRes.data ?? []) as { id: number; label: string }[]).map((h) => ({
    id: h.id,
    label: h.label
  }));
  const tab: RosterTab = isRosterTab(detail.tab) ? detail.tab : 'adult';
  const kind = kindOf(tab);

  const [rankLabel, household, pendingUpdate] = await Promise.all([
    loadRankLabel(supabase, scout?.current_rank ?? null),
    loadHousehold(supabase, detail.householdId),
    loadPendingFlag(supabase, kind === 'scout' && scout ? { type: 'scout', id: scout.id } : { type: 'adult', id: String(personId) })
  ]);

  const status: PersonStatus =
    kind === 'scout' && scout
      ? { active: scout.active, reason: scout.active ? null : scout.inactive_reason }
      : { active: detail.active, reason: detail.active ? null : detail.inactiveReason };

  return {
    kind: 'found',
    record: {
      personId,
      displayName: row.display_name,
      kind,
      tab,
      detail,
      emails,
      scout,
      gender,
      rankLabel,
      household,
      households,
      status,
      pendingUpdate,
      today: centralToday()
    }
  };
}

type Db = ReturnType<typeof createAdminClient>;

async function loadRankLabel(supabase: Db, rankId: string | null): Promise<string | null> {
  if (!rankId) return null;
  const { data } = await supabase.from('ranks').select('display_name').eq('id', rankId).maybeSingle();
  return (data as { display_name: string } | null)?.display_name ?? rankId;
}

async function loadHousehold(
  supabase: Db,
  householdId: number | null
): Promise<PersonRecord['household']> {
  if (householdId == null) return null;
  const [{ data: hh }, { data: members }] = await Promise.all([
    supabase.from('households').select('id, label').eq('id', householdId).maybeSingle(),
    supabase.from('household_members').select('person_id').eq('household_id', householdId)
  ]);
  const label = (hh as { id: number; label: string } | null)?.label;
  if (!label) return null;
  const ids = ((members ?? []) as { person_id: number }[]).map((m) => m.person_id);
  let rows: { person_id: number; display_name: string; tab: string; active: boolean }[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('person_directory')
      .select('person_id, display_name, tab, active')
      .in('person_id', ids)
      .order('display_name');
    rows = (data ?? []) as typeof rows;
  }
  return {
    id: householdId,
    label,
    members: rows.map((r) => ({
      personId: r.person_id,
      name: r.display_name,
      kind: kindOf(isRosterTab(r.tab) ? r.tab : 'adult'),
      active: r.active
    }))
  };
}

async function loadPendingFlag(supabase: Db, entity: { type: 'scout' | 'adult'; id: string }): Promise<boolean> {
  const { count } = await supabase
    .from('change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', entity.type)
    .eq('entity_id', entity.id)
    .eq('status', 'pending');
  return (count ?? 0) > 0;
}

/**
 * The roster's `?open=ID` → a people.id for the record page redirect. Scout
 * tabs (and the dashboard's attention links for scouts) carry a scout code
 * like 'F07'; people tabs carry people.id. Null when nothing matches, so
 * the caller can fall back to the old open-on-mount behaviour.
 */
export async function resolveRosterOpenParam(open: string, tab: string): Promise<number | null> {
  const value = open.trim();
  if (!value) return null;
  const supabase = createAdminClient();
  const numeric = /^\d+$/.test(value);
  const scoutTab = tab === 'active_scout' || tab === 'inactive_scout';
  if (scoutTab || !numeric) {
    const { data } = await supabase.from('scouts').select('person_id').eq('id', value).maybeSingle();
    const personId = (data as { person_id: number | null } | null)?.person_id;
    if (personId != null) return personId;
    if (!numeric) return null;
  }
  const { data: person } = await supabase.from('people').select('id').eq('id', Number(value)).maybeSingle();
  return (person as { id: number } | null)?.id ?? null;
}
