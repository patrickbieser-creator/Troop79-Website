/**
 * The one DB read behind the home roster. Kept out of lib/roster-print.ts on
 * purpose: that module is pure so its shapes can be tested without a database,
 * and importing the server client there would drag the whole Supabase server
 * runtime into the test.
 *
 * Follows loadHouseholds()'s joins (lib/households.ts) — same identity spine,
 * same merged/inactive rules — but reaches for the CONTACT columns that the
 * signup picker has no use for: phone, address, and the leaders row's role.
 *
 * people.* is the only source for a scout's or adult's contact details
 * (Plans/Retire-Roster-Contact-Columns.md) — the old leaders and scouts
 * fallback is gone; every contact fact, scout or adult, is read off the
 * linked person row.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { centralToday } from '@/lib/dates';
import type { RosterPrintAdult, RosterPrintInput, RosterPrintScout } from '@/lib/roster-print';

interface PersonRow {
  id: number;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}
interface MemberRow {
  household_id: number;
  person_id: number;
}
interface RelationRow {
  id: number;
  person_id: number;
  role_label: string | null;
}
interface LeaderRow {
  code: string;
  name: string;
  role: string | null;
  is_person: boolean;
  person_id: number | null;
}

/** `scouts` columns that stay on the table — contact fields come from the
 *  linked person row instead. */
const SCOUT_COLS = 'id, first_name, last_name, display_name, patrol, current_rank, graduation_year, active, person_id';

interface ScoutCoreRow {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  graduation_year: number | null;
  active: boolean;
  person_id: number | null;
}

export async function loadRosterPrintData(): Promise<RosterPrintInput> {
  const supabase = createAdminClient();

  const [households, members, people, scoutCoreRows, relations, leaders, ranks] = await Promise.all([
    fetchAllRows<{ id: number; label: string }>((f, t) =>
      supabase.from('households').select('id, label').range(f, t)
    ),
    fetchAllRows<MemberRow>((f, t) =>
      supabase.from('household_members').select('household_id, person_id').range(f, t)
    ),
    fetchAllRows<PersonRow>((f, t) =>
      supabase
        .from('people')
        .select('id, display_name, primary_email, primary_phone, address_line1, address_line2, city, state, zip')
        .is('merged_into_person_id', null)
        .is('guest_host_household_id', null)
        .eq('active', true)
        .range(f, t)
    ),
    fetchAllRows<ScoutCoreRow>((f, t) => supabase.from('scouts').select(SCOUT_COLS).range(f, t)),
    fetchAllRows<RelationRow>((f, t) =>
      supabase
        .from('relationships')
        .select('id, person_id, role_label')
        .in('type', ['parent_of', 'guardian_of'])
        .range(f, t)
    ),
    fetchAllRows<LeaderRow>((f, t) =>
      supabase.from('leaders').select('code, name, role, is_person, person_id').range(f, t)
    ),
    fetchAllRows<{ id: string; display_name: string }>((f, t) =>
      supabase.from('ranks').select('id, display_name').range(f, t)
    )
  ]);

  // people is already filtered to active/non-merged/non-guest adults; a
  // scout's own contact fields come from the same table but must not be
  // dropped just because a scout happens to fail one of those adult filters
  // (an inactive scout's own person row, say) — a plain lookup by the
  // scouts' own person_ids, independent of the adults query above.
  const scoutPersonIds = scoutCoreRows.map((s) => s.person_id).filter((id): id is number => id != null);
  const { data: scoutPersonRows } = scoutPersonIds.length
    ? await supabase
        .from('people')
        .select('id, primary_phone, primary_email, address_line1, address_line2, city, state, zip')
        .in('id', scoutPersonIds)
    : { data: [] as (PersonRow & { id: number })[] };
  const scoutPersonById = new Map(
    ((scoutPersonRows ?? []) as PersonRow[]).map((p) => [p.id, p])
  );

  const householdByPerson = new Map(members.map((m) => [m.person_id, m.household_id]));

  const scouts: RosterPrintScout[] = scoutCoreRows.map((s) => {
    const person = s.person_id != null ? scoutPersonById.get(s.person_id) : undefined;
    return {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      display_name: s.display_name,
      household_id: s.person_id != null ? (householdByPerson.get(s.person_id) ?? null) : null,
      patrol: s.patrol,
      current_rank: s.current_rank,
      graduation_year: s.graduation_year,
      phone: person?.primary_phone ?? null,
      email: person?.primary_email ?? null,
      address_line1: person?.address_line1 ?? null,
      address_line2: person?.address_line2 ?? null,
      city: person?.city ?? null,
      state: person?.state ?? null,
      zip: person?.zip ?? null,
      active: s.active
    };
  });

  // Which people ARE currently-enrolled scouts — they are listed as scouts,
  // never as adult contacts. Same rule loadHouseholds() applies.
  const youthPersonIds = new Set<number>();
  for (const s of scoutCoreRows) {
    if (s.person_id != null && s.active) youthPersonIds.add(s.person_id);
  }

  // Lowest-id edge wins, so an adult with several children shows one stable
  // family word between page loads (the rule households.ts settled on).
  const relationByPerson = new Map<number, RelationRow>();
  for (const r of relations) {
    if (!r.role_label) continue;
    const existing = relationByPerson.get(r.person_id);
    if (!existing || r.id < existing.id) relationByPerson.set(r.person_id, r);
  }

  const leaderByPerson = new Map<number, LeaderRow>();
  for (const l of leaders) {
    if (l.person_id == null || !l.is_person) continue;
    if (!leaderByPerson.has(l.person_id)) leaderByPerson.set(l.person_id, l);
  }

  const peopleById = new Map(people.map((p) => [p.id, p]));

  const adults: RosterPrintAdult[] = [];
  for (const m of members) {
    const person = peopleById.get(m.person_id);
    if (!person) continue;
    const leader = leaderByPerson.get(m.person_id) ?? null;

    adults.push({
      personId: m.person_id,
      householdId: m.household_id,
      name: person.display_name,
      relationship: relationByPerson.get(m.person_id)?.role_label ?? null,
      phone: person.primary_phone,
      email: person.primary_email,
      leaderCode: leader?.code ?? null,
      role: leader?.role ?? null,
      // A leaders row whose person_id matches an ACTIVE scout is a youth
      // leader — a scout holding a position, not an adult contact.
      isYouth: youthPersonIds.has(m.person_id),
      address_line1: person.address_line1,
      address_line2: person.address_line2,
      city: person.city,
      state: person.state,
      zip: person.zip
    });
  }

  return {
    households,
    scouts,
    adults,
    ranks,
    generatedOn: centralToday()
  };
}
