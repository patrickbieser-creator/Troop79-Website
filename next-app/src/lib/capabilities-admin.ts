/**
 * Loader for the Access & Permissions screen
 * (Plans/Unified-Identity-And-Capabilities.md Phase A).
 *
 * Separate from lib/capabilities.ts so the vocabulary stays free of admin-only
 * queries — capabilities.ts is on the hot path of every privileged action and
 * should not grow a roster join.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPABILITIES, isCapability, type Capability } from '@/lib/capabilities';

export interface GrantRow {
  personId: number;
  name: string;
  /** Leader code when this person has one — helps disambiguate two Mikes. */
  leaderCode: string | null;
  /** True when they are an active scout. Youth CAN hold grants
   *  (meeting_plan.use for an SPL); the screen just says so plainly. */
  isActiveScout: boolean;
  capabilities: Capability[];
  grantedBy: Record<string, string | null>;
  grantedAt: Record<string, string>;
}

/** Shape a raw join into rows. Pure — exported for testing. */
export function buildGrantRows(
  people: { id: number; display_name: string }[],
  leaders: { code: string; person_id: number | null }[],
  activeScoutPersonIds: Set<number>,
  grants: { person_id: number; capability: string; granted_at: string; granted_by: number | null }[],
  nameById: Map<number, string>
): GrantRow[] {
  const leaderCodeByPerson = new Map<number, string>();
  for (const l of leaders) {
    if (l.person_id != null && !leaderCodeByPerson.has(l.person_id)) {
      leaderCodeByPerson.set(l.person_id, l.code);
    }
  }

  const byPerson = new Map<number, GrantRow>();
  for (const p of people) {
    byPerson.set(p.id, {
      personId: p.id,
      name: p.display_name,
      leaderCode: leaderCodeByPerson.get(p.id) ?? null,
      isActiveScout: activeScoutPersonIds.has(p.id),
      capabilities: [],
      grantedBy: {},
      grantedAt: {}
    });
  }

  for (const g of grants) {
    const row = byPerson.get(g.person_id);
    if (!row || !isCapability(g.capability)) continue;
    row.capabilities.push(g.capability);
    row.grantedAt[g.capability] = g.granted_at;
    row.grantedBy[g.capability] = g.granted_by != null ? (nameById.get(g.granted_by) ?? null) : null;
  }

  for (const row of byPerson.values()) {
    row.capabilities.sort(
      (a, b) => CAPABILITIES.indexOf(a) - CAPABILITIES.indexOf(b)
    );
  }

  // Anyone holding a grant first (most grants first), then the rest by name —
  // the screen's job is "who can do what", so people with access lead.
  return [...byPerson.values()].sort((a, b) => {
    if (a.capabilities.length !== b.capabilities.length) {
      return b.capabilities.length - a.capabilities.length;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface AccessScreenData {
  /** People who hold a grant, or are eligible adults. */
  rows: GrantRow[];
  /** Everyone else active, for the "grant access to someone new" picker. */
  addable: { personId: number; name: string; isActiveScout: boolean }[];
}

export async function loadAccessScreen(supabase: SupabaseClient): Promise<AccessScreenData> {
  const [peopleRes, leadersRes, scoutsRes, grantsRes] = await Promise.all([
    supabase.from('people').select('id, display_name').eq('active', true).order('display_name'),
    supabase.from('leaders').select('code, person_id, is_person, can_login'),
    supabase.from('scouts').select('person_id').eq('active', true),
    supabase.from('person_capabilities').select('person_id, capability, granted_at, granted_by')
  ]);

  const people = (peopleRes.data ?? []) as { id: number; display_name: string }[];
  const leaders = (leadersRes.data ?? []) as {
    code: string;
    person_id: number | null;
    is_person: boolean;
    can_login: boolean;
  }[];
  const activeScoutPersonIds = new Set(
    ((scoutsRes.data ?? []) as { person_id: number | null }[])
      .map((s) => s.person_id)
      .filter((id): id is number => typeof id === 'number')
  );
  const grants = (grantsRes.data ?? []) as {
    person_id: number;
    capability: string;
    granted_at: string;
    granted_by: number | null;
  }[];

  const nameById = new Map(people.map((p) => [p.id, p.display_name] as const));
  const holders = new Set(grants.map((g) => g.person_id));

  // Eligible adults = the isAdultPerson() rule from lib/authorized-adults.ts,
  // the same filter the seed migration used. Kept in sync deliberately: this
  // screen and that seed must agree on who counts as an adult, or the screen
  // will look like it lost people.
  const eligibleAdults = new Set(
    leaders
      .filter((l) => l.is_person && l.person_id != null && !activeScoutPersonIds.has(l.person_id))
      .map((l) => l.person_id as number)
  );

  const shown = people.filter((p) => holders.has(p.id) || eligibleAdults.has(p.id));
  const rows = buildGrantRows(shown, leaders, activeScoutPersonIds, grants, nameById);

  const shownIds = new Set(shown.map((p) => p.id));
  const addable = people
    .filter((p) => !shownIds.has(p.id))
    .map((p) => ({
      personId: p.id,
      name: p.display_name,
      isActiveScout: activeScoutPersonIds.has(p.id)
    }));

  return { rows, addable };
}
