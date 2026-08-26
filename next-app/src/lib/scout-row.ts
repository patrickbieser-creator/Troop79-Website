import type { SupabaseClient } from '@supabase/supabase-js';
import type { InactiveReason } from './supabase/types';
import type { ScoutRow } from '@/app/admin/(workspace)/advancement/roster/scout-form';

/**
 * The scout↔people join, in one place (Plans/Retire-Roster-Contact-Columns.md).
 *
 * `scouts` keeps patrol/rank/school-shaped facts — the things that are true
 * only because this person is currently a scout. Contact and demographic
 * facts (address, phone, email, birthdate, gender, BSA member id, health
 * form date, things-we-should-know) moved to `people`, read by the
 * `scouts.person_id` link. The Roster's scout form and table still show one
 * flat `ScoutRow` — this module is the seam that merges the two tables back
 * into that shape, so callers don't each reinvent the join.
 */

/** Columns that stay on `scouts`. */
export const SCOUT_CORE_COLS =
  'id, first_name, last_name, display_name, patrol, current_rank, active, inactive_reason, ' +
  'school, graduation_year, swim_class, junior_leader_override, person_id';

export interface ScoutCoreRow {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  active: boolean;
  inactive_reason: InactiveReason | null;
  school: string | null;
  graduation_year: number | null;
  swim_class: 'swimmer' | 'beginner' | 'nonswimmer' | null;
  junior_leader_override: 'yes' | 'no' | null;
  person_id: number | null;
}

/** Contact/demographic columns on `people` a scout's own row carries — the
 *  scout's own facts, joined by person_id, never a parent's. */
export const SCOUT_PERSON_CONTACT_COLS =
  'id, address_line1, address_line2, city, state, zip, primary_phone, primary_email, ' +
  'birthdate, gender, bsa_member_id, health_form_date, things_we_should_know';

export interface ScoutPersonContactRow {
  id: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  birthdate: string | null;
  gender: string | null;
  bsa_member_id: string | null;
  health_form_date: string | null;
  things_we_should_know: string | null;
}

/** Merge one `scouts` row with its linked `people` row into the shape the
 *  Roster form/table expect. `person` is undefined for a scout with no
 *  linked person (should not happen once every scout is created through
 *  createScout, but stays defensive for older/odd data). */
export function mergeScoutRow(s: ScoutCoreRow, person: ScoutPersonContactRow | undefined): ScoutRow {
  return {
    person_id: s.person_id,
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    display_name: s.display_name,
    patrol: s.patrol,
    current_rank: s.current_rank,
    bsa_member_id: person?.bsa_member_id ?? null,
    birthdate: person?.birthdate ?? null,
    gender: (person?.gender as 'M' | 'F' | null) ?? null,
    school: s.school,
    graduation_year: s.graduation_year,
    swim_class: s.swim_class,
    junior_leader_override: s.junior_leader_override,
    active: s.active,
    inactive_reason: s.inactive_reason,
    address_line1: person?.address_line1 ?? null,
    address_line2: person?.address_line2 ?? null,
    city: person?.city ?? null,
    state: person?.state ?? null,
    zip: person?.zip ?? null,
    phone: person?.primary_phone ?? null,
    email: person?.primary_email ?? null,
    health_form_date: person?.health_form_date ?? null,
    things_we_should_know: person?.things_we_should_know ?? null
  };
}

/** Every scout, merged with its linked person's contact fields — the one
 *  fetch the Roster page and Lookups' scout picker both used to duplicate. */
export async function loadScoutRows(
  supabase: SupabaseClient,
  opts?: { activeOnly?: boolean }
): Promise<ScoutRow[]> {
  let q = supabase.from('scouts').select(SCOUT_CORE_COLS).order('display_name');
  if (opts?.activeOnly) q = q.eq('active', true);
  const { data: scoutRows } = await q;
  const scouts = (scoutRows ?? []) as unknown as ScoutCoreRow[];

  const personIds = scouts.map((s) => s.person_id).filter((id): id is number => id != null);
  const { data: personRows } = personIds.length
    ? await supabase.from('people').select(SCOUT_PERSON_CONTACT_COLS).in('id', personIds)
    : { data: [] as ScoutPersonContactRow[] };
  const personById = new Map(
    ((personRows ?? []) as unknown as ScoutPersonContactRow[]).map((p) => [p.id, p])
  );

  return scouts.map((s) => mergeScoutRow(s, s.person_id != null ? personById.get(s.person_id) : undefined));
}
