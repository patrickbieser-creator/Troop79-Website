/**
 * The one DB read behind the home roster. Kept out of lib/roster-print.ts on
 * purpose: that module is pure so its shapes can be tested without a database,
 * and importing the server client there would drag the whole Supabase server
 * runtime into the test.
 *
 * Follows loadHouseholds()'s joins (lib/households.ts) — same identity spine,
 * same merged/inactive rules — but reaches for the CONTACT columns that the
 * signup picker has no use for: phone, address, and the leaders row's role.
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
  scout_id: string | null;
  person_id: number | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const SCOUT_COLS =
  'id, first_name, last_name, display_name, household_id, patrol, current_rank, graduation_year, phone, email, address_line1, address_line2, city, state, zip, active, person_id';

export async function loadRosterPrintData(): Promise<RosterPrintInput> {
  const supabase = createAdminClient();

  const [households, members, people, scouts, relations, leaders, ranks] = await Promise.all([
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
    fetchAllRows<RosterPrintScout & { person_id: number | null }>((f, t) =>
      supabase.from('scouts').select(SCOUT_COLS).range(f, t)
    ),
    fetchAllRows<RelationRow>((f, t) =>
      supabase
        .from('relationships')
        .select('id, person_id, role_label')
        .in('type', ['parent_of', 'guardian_of'])
        .range(f, t)
    ),
    fetchAllRows<LeaderRow>((f, t) =>
      supabase
        .from('leaders')
        .select(
          'code, name, role, is_person, scout_id, person_id, phone, email, address_line1, address_line2, city, state, zip'
        )
        .range(f, t)
    ),
    fetchAllRows<{ id: string; display_name: string }>((f, t) =>
      supabase.from('ranks').select('id, display_name').range(f, t)
    )
  ]);

  const activeScoutIds = new Set(scouts.filter((s) => s.active).map((s) => s.id));

  // Which people ARE currently-enrolled scouts — they are listed as scouts,
  // never as adult contacts. Same rule loadHouseholds() applies.
  const youthPersonIds = new Set<number>();
  for (const s of scouts) {
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
    // A leaders row whose scout_id points at an ACTIVE scout is a youth
    // leader — a scout holding a position, not an adult contact.
    const isYouth =
      youthPersonIds.has(m.person_id) || (!!leader?.scout_id && activeScoutIds.has(leader.scout_id));

    adults.push({
      personId: m.person_id,
      householdId: m.household_id,
      name: person.display_name,
      relationship: relationByPerson.get(m.person_id)?.role_label ?? null,
      // people.* is the truth for adult contact details — the leader edit
      // form was retired 2026-08-17 and nothing writes leaders.* any more
      // (people-model audit 2026-08-26). leaders.* survives only as a
      // fallback for a row the spine never got a value for.
      phone: person.primary_phone ?? leader?.phone ?? null,
      email: person.primary_email ?? leader?.email ?? null,
      leaderCode: leader?.code ?? null,
      role: leader?.role ?? null,
      isYouth,
      address_line1: person.address_line1 ?? leader?.address_line1 ?? null,
      address_line2: person.address_line2 ?? leader?.address_line2 ?? null,
      city: person.city ?? leader?.city ?? null,
      state: person.state ?? leader?.state ?? null,
      zip: person.zip ?? leader?.zip ?? null
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
