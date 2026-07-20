/**
 * Households for the family signup flow.
 *
 * IDENTITY IS NOW DECLARED, NOT INFERRED.
 *
 * This module used to reconstruct each human at read time by normalizing names
 * and emails across `scouts`, `leaders` and `scout_parents` — three tables with
 * no link between them, where one person legitimately holds rows in two. That
 * matching failed twice in production in one week, each time listing a real
 * person twice in the picker and letting them sign up twice for one event:
 * once when siblings' records spelled a parent's name two ways ("JamieLynn" /
 * "Jamie Lynn"), and once for adults recorded by nickname on one record and
 * formal name on the other ("Dan" / "Daniel").
 *
 * Every one of those tables now carries `person_id` into a `people` spine, so
 * "the same human" is a join, not a guess. The `claimedEmails` / `claimedNames`
 * sets this file used to carry are gone, and with them the entire class of bug.
 *
 * MEMBERSHIP is a stored row in `household_members`, seeded once and correctable
 * by a leader — never re-derived here. Adults get their own membership row, so
 * an adult with no scout in the troop can belong to a household, which the old
 * shape (membership implied through a child) could not express.
 *
 * WHO CAN BE FOUND HERE — every real person in the troop, not only families
 * with a currently-active scout:
 *
 *   1. Active scouts, with the adults of their household attached.
 *   2. Households whose scouts have all aged out. The scout is no longer someone
 *      to sign up, but the ADULTS stay reachable — an aged-out scout's parent is
 *      still on the committee, still drives, still comes to the banquet.
 *   3. Adults with no household at all — committee members, merit badge
 *      counselors, ASMs whose children were never in the troop. Each becomes a
 *      household of one.
 *
 * KEY CONTRACT — unchanged, and load-bearing. `<households.id>` for a stored
 * household; `scout:<id>`, `leader:<code>` or `person:<id>` for a party with no
 * stored household row. Callers parse it (`storedHouseholdId`, and a `/^\d+$/`
 * test in person-first-form) and it travels in the `?household=` URL, so the
 * shapes must stay stable even though what produces them changed completely.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { isAdultPerson, type LeaderLite } from '@/lib/authorized-adults';

export interface HouseholdAdult {
  /** Stable identity for form state and React keys. */
  key: string;
  /** people.id — the real identity. Everything below is a legacy pointer kept
   *  because signup_entries still records a participant as one of three
   *  nullable columns rather than a person. */
  personId: number;
  /** scout_parents.id — set when this adult also holds a parent row. */
  scoutParentId: number | null;
  /** leaders.code — set when this adult also holds an adult-roster row. */
  leaderCode: string | null;
  name: string;
  relationship: string | null;
  email: string | null;
}

export interface HouseholdScout {
  id: string;
  displayName: string;
  personId: number | null;
}

export interface Household {
  key: string;
  label: string;
  /** ACTIVE scouts only. An inactive scout's household still surfaces for the
   *  sake of its adults, but the scout is not offered as someone to sign up. */
  scouts: HouseholdScout[];
  adults: HouseholdAdult[];
}

interface PersonRow {
  id: number;
  display_name: string;
  primary_email: string | null;
}
interface MemberRow {
  household_id: number;
  person_id: number;
}
interface ScoutRow {
  id: string;
  display_name: string;
  last_name: string | null;
  household_id: number | null;
  active: boolean;
  person_id: number | null;
}
interface ParentRow {
  id: number;
  person_id: number | null;
  relationship: string | null;
  email: string | null;
}
interface LeaderRow extends LeaderLite {
  email: string | null;
  person_id: number | null;
}

export async function loadHouseholds(): Promise<Household[]> {
  const supabase = createAdminClient();
  const [
    { data: householdData },
    { data: memberData },
    { data: peopleData },
    { data: scoutData },
    { data: parentData },
    { data: leaderData }
  ] = await Promise.all([
    supabase.from('households').select('id, label'),
    supabase.from('household_members').select('household_id, person_id'),
    // Merged-away records are excluded here rather than everywhere downstream:
    // a person merged into another must never appear as a second option.
    supabase
      .from('people')
      .select('id, display_name, primary_email')
      .is('merged_into_person_id', null),
    supabase.from('scouts').select('id, display_name, last_name, household_id, active, person_id'),
    supabase.from('scout_parents').select('id, person_id, relationship, email'),
    supabase
      .from('leaders')
      .select('code, name, is_person, scout_id, can_login, login_name, email, person_id')
  ]);

  const labels = new Map(
    ((householdData ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label])
  );
  const members = (memberData ?? []) as MemberRow[];
  const people = new Map(((peopleData ?? []) as PersonRow[]).map((p) => [p.id, p]));
  const scouts = (scoutData ?? []) as ScoutRow[];
  const parents = (parentData ?? []) as ParentRow[];
  const leaders = (leaderData ?? []) as LeaderRow[];
  const activeScoutIds = new Set(scouts.filter((s) => s.active).map((s) => s.id));

  // person_id → the legacy pointers signup_entries still needs. A person may
  // hold both; the parent row is preferred because it carries the relationship
  // wording families recognise ("Mom", "Dad").
  const scoutByPerson = new Map<number, ScoutRow>();
  for (const s of scouts) if (s.person_id != null) scoutByPerson.set(s.person_id, s);

  const parentByPerson = new Map<number, ParentRow>();
  for (const p of parents) {
    if (p.person_id == null) continue;
    const existing = parentByPerson.get(p.person_id);
    // Siblings each carry a row for the same adult; lowest id wins so the
    // choice is stable between page loads.
    if (!existing || p.id < existing.id) parentByPerson.set(p.person_id, p);
  }

  const leaderByPerson = new Map<number, LeaderRow>();
  for (const l of leaders) {
    if (l.person_id == null || !l.is_person) continue;
    if (!leaderByPerson.has(l.person_id)) leaderByPerson.set(l.person_id, l);
  }

  /** An adult is anyone who is not a currently-active scout AND holds some
   *  adult identity — a parent row, or an adult-roster row that isn't a current
   *  scout's youth-leader code. An aged-out scout with neither is simply not
   *  listed, exactly as before. */
  function asAdult(personId: number): HouseholdAdult | null {
    const person = people.get(personId);
    if (!person) return null;

    const scout = scoutByPerson.get(personId);
    if (scout && scout.active) return null; // listed as a scout instead

    const parent = parentByPerson.get(personId);
    const leader = leaderByPerson.get(personId);
    const leaderIsAdult = leader ? isAdultPerson(leader, activeScoutIds) : false;
    if (!parent && !leaderIsAdult) return null;

    return {
      key: `pe${personId}`,
      personId,
      scoutParentId: parent?.id ?? null,
      leaderCode: leaderIsAdult ? (leader?.code ?? null) : null,
      name: person.display_name,
      relationship: parent?.relationship ?? null,
      email: person.primary_email ?? parent?.email ?? leader?.email ?? null
    };
  }

  const households: Household[] = [];
  const placed = new Set<number>();

  // ── Stored households ────────────────────────────────────────────────────
  const byHousehold = new Map<number, number[]>();
  for (const m of members) {
    if (!people.has(m.person_id)) continue; // merged away
    byHousehold.set(m.household_id, [...(byHousehold.get(m.household_id) ?? []), m.person_id]);
  }

  for (const [householdId, personIds] of byHousehold) {
    const householdScouts: HouseholdScout[] = [];
    const adults: HouseholdAdult[] = [];

    for (const personId of personIds) {
      const scout = scoutByPerson.get(personId);
      if (scout && scout.active) {
        householdScouts.push({ id: scout.id, displayName: scout.display_name, personId });
        continue;
      }
      const adult = asAdult(personId);
      if (adult) adults.push(adult);
    }

    // Every scout gone AND nobody left to contact — that household really is
    // finished, and listing it would just add noise to the picker.
    if (householdScouts.length === 0 && adults.length === 0) continue;

    personIds.forEach((id) => placed.add(id));

    // Label off the ACTIVE scouts when there are any, so a household isn't
    // named for the sibling who aged out.
    const memberScouts = personIds.map((id) => scoutByPerson.get(id)).filter(Boolean) as ScoutRow[];
    const forLabel = memberScouts.filter((s) => s.active);
    const surnames = [...new Set((forLabel.length > 0 ? forLabel : memberScouts).map((s) => s.last_name).filter(Boolean))];

    households.push({
      key: String(householdId),
      label:
        labels.get(householdId) ??
        (surnames.length > 0
          ? surnames.join(' / ')
          : (people.get(personIds[0])?.display_name ?? `Household ${householdId}`)),
      scouts: householdScouts.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      adults
    });
  }

  // ── Anyone with no household row ─────────────────────────────────────────
  // A scout not yet assigned, and every adult who belongs to no household —
  // committee members, counselors, and the adults the roster import added who
  // have not been placed in a family yet. Each becomes a household of one so
  // nobody is unreachable in the picker.
  for (const scout of scouts) {
    if (!scout.active || scout.person_id == null || placed.has(scout.person_id)) continue;
    placed.add(scout.person_id);
    households.push({
      key: `scout:${scout.id}`,
      label: scout.last_name || scout.display_name,
      scouts: [{ id: scout.id, displayName: scout.display_name, personId: scout.person_id }],
      adults: []
    });
  }

  for (const personId of people.keys()) {
    if (placed.has(personId)) continue;
    const adult = asAdult(personId);
    if (!adult) continue;
    placed.add(personId);
    households.push({
      // leader:<code> preserved for adults on the roster so links already in
      // circulation keep resolving; person:<id> for everyone else.
      key: adult.leaderCode ? `leader:${adult.leaderCode}` : `person:${personId}`,
      label: adult.name,
      scouts: [],
      adults: [adult]
    });
  }

  return households.sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadHouseholdByKey(key: string): Promise<Household | null> {
  const all = await loadHouseholds();
  return all.find((h) => h.key === key) ?? null;
}

/** `households.id` when the key refers to a stored household, else null.
 *  `scout:<id>`, `leader:<code>` and `person:<id>` parties have no stored
 *  household row, and the signup RPCs take null for those. Centralised so
 *  callers can't reinvent a `Number(key)` parse that yields NaN for the
 *  sentinel forms. */
export function storedHouseholdId(key: string | null | undefined): number | null {
  if (!key || !/^\d+$/.test(key)) return null;
  return Number(key);
}
