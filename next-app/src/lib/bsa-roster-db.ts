/**
 * Reads and the one writer behind the BSA Roster check (lib/bsa-roster.ts)
 * and the member Registration page.
 *
 * The five people.bsa_* columns are written ONLY by saveRegistrations, from a
 * roster a leader uploaded and chose to save.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { RegistrationUpdate, RosterPerson } from '@/lib/bsa-roster';
import { expirePeopleLists } from '@/lib/people-lists';

interface PersonRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  gender: string | null;
  primary_phone: string | null;
  bsa_member_id: string | null;
  ypt_completed: string | null;
  active: boolean;
  inactive_reason: string | null;
}

/** Everyone the roster could be about: merged, guest and test people left out. */
export async function loadRosterPeople(sb: SupabaseClient): Promise<RosterPerson[]> {
  const [people, emails, scouts, leaders] = await Promise.all([
    fetchAllRows<PersonRow>((from, to) =>
      sb
        .from('people')
        .select('id, first_name, last_name, display_name, gender, primary_phone, bsa_member_id, ypt_completed, active, inactive_reason')
        .is('merged_into_person_id', null)
        .is('guest_host_household_id', null)
        .eq('is_test', false)
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<{ person_id: number; email: string; is_primary: boolean }>((from, to) =>
      sb.from('person_emails').select('person_id, email, is_primary').order('id').range(from, to)
    ),
    fetchAllRows<{ person_id: number | null; active: boolean; inactive_reason: string | null }>((from, to) =>
      sb.from('scouts').select('person_id, active, inactive_reason').order('id').range(from, to)
    ),
    fetchAllRows<{ person_id: number | null; role: string | null }>((from, to) =>
      sb.from('leaders').select('person_id, role').order('code').range(from, to)
    )
  ]);

  const emailsOf = new Map<number, string[]>();
  for (const e of emails) {
    const list = emailsOf.get(e.person_id) ?? [];
    // Primary first, so a reported difference shows the address we use.
    if (e.is_primary) list.unshift(e.email);
    else list.push(e.email);
    emailsOf.set(e.person_id, list);
  }
  const scoutOf = new Map(scouts.filter((s) => s.person_id != null).map((s) => [s.person_id!, s]));
  const rolesOf = new Map<number, string[]>();
  for (const l of leaders) {
    if (l.person_id == null || !l.role) continue;
    rolesOf.set(l.person_id, [...(rolesOf.get(l.person_id) ?? []), l.role]);
  }

  return people.map((p) => {
    const s = scoutOf.get(p.id);
    return {
      id: p.id,
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      displayName: p.display_name,
      gender: p.gender,
      phone: p.primary_phone,
      emails: emailsOf.get(p.id) ?? [],
      bsaMemberId: p.bsa_member_id,
      yptCompleted: p.ypt_completed,
      active: p.active,
      inactiveReason: p.inactive_reason,
      scout: s ? { active: s.active, inactiveReason: s.inactive_reason } : null,
      leaderRoles: rolesOf.get(p.id) ?? []
    };
  });
}

/** Write each matched member's registration. Returns how many people were updated. */
export async function saveRegistrations(sb: SupabaseClient, updates: RegistrationUpdate[]): Promise<number> {
  // The planner caches the roster and teacher pool (lib/people-lists); expired when this action ends.
  expirePeopleLists();
  let saved = 0;
  for (const u of updates) {
    const { error } = await sb
      .from('people')
      .update({
        bsa_registration_expires: u.expires,
        bsa_registration_status: u.status,
        bsa_positions: u.positions,
        bsa_auto_renew_opted_out: u.autoRenewOptedOut,
        bsa_roster_as_of: u.asOf
      })
      .eq('id', u.personId);
    if (error) throw new Error(`Saving registration for person ${u.personId}: ${error.message}`);
    saved++;
  }
  return saved;
}

export interface StoredRegistration {
  personId: number;
  name: string;
  expires: string | null;
  status: string | null;
  positions: string[];
  autoRenewOptedOut: boolean | null;
  asOf: string | null;
}

const STORED_COLS =
  'id, display_name, bsa_registration_expires, bsa_registration_status, bsa_positions, bsa_auto_renew_opted_out, bsa_roster_as_of';

interface StoredRow {
  id: number;
  display_name: string;
  bsa_registration_expires: string | null;
  bsa_registration_status: string | null;
  bsa_positions: string[] | null;
  bsa_auto_renew_opted_out: boolean | null;
  bsa_roster_as_of: string | null;
}

const toStored = (r: StoredRow): StoredRegistration => ({
  personId: r.id,
  name: r.display_name,
  expires: r.bsa_registration_expires,
  status: r.bsa_registration_status,
  positions: r.bsa_positions ?? [],
  autoRenewOptedOut: r.bsa_auto_renew_opted_out,
  asOf: r.bsa_roster_as_of
});

/** Everyone with a saved registration, soonest expiry first. */
export async function loadAllRegistrations(sb: SupabaseClient): Promise<StoredRegistration[]> {
  const rows = await fetchAllRows<StoredRow>((from, to) =>
    sb
      .from('people')
      .select(STORED_COLS)
      .not('bsa_registration_expires', 'is', null)
      .is('merged_into_person_id', null)
      .order('bsa_registration_expires')
      .order('id')
      .range(from, to)
  );
  return rows.map(toStored);
}

/** These people's registrations, in the order the ids were given; a person with
 *  none saved still comes back, with null fields. */
export async function loadRegistrationsFor(sb: SupabaseClient, personIds: number[]): Promise<StoredRegistration[]> {
  if (!personIds.length) return [];
  const { data, error } = await sb.from('people').select(STORED_COLS).in('id', personIds);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as StoredRow[]).map((r) => [r.id, toStored(r)]));
  return personIds.map((id) => byId.get(id)).filter((r): r is StoredRegistration => r != null);
}

/** The newest roster date saved so far, or null. Save refuses an older roster so it can't undo a newer one. */
export async function latestRosterAsOf(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb
    .from('people')
    .select('bsa_roster_as_of')
    .not('bsa_roster_as_of', 'is', null)
    .order('bsa_roster_as_of', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as { bsa_roster_as_of: string } | undefined)?.bsa_roster_as_of ?? null;
}
