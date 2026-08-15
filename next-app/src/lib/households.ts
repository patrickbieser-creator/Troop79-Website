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
  /** people.id — the only identity a signup entry records (D-066). */
  personId: number;
  /** leaders.code — set when this adult also holds an adult-roster row. Kept
   *  because the leader roster is a real record with its own login, not a
   *  legacy pointer like scout_parents.id was. */
  leaderCode: string | null;
  name: string;
  /** The family word — "Mom", "Dad". From relationships.role_label since
   *  scout_parents was retired. */
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

/** At 18 a scout is no longer a scout — they are an adult, and belong in the
 *  picker as one. An explicit aged_out reason counts on its own, because most
 *  historic records carry no birthdate. */
function noLongerYouth(scout: ScoutRow): boolean {
  if ((scout.inactive_reason ?? '').trim() === 'aged_out') return true;
  if (!scout.birthdate) return false;
  const eighteenth = new Date(`${scout.birthdate}T12:00:00Z`);
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18);
  return eighteenth <= new Date();
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
  inactive_reason: string | null;
  birthdate: string | null;
}
/** A parent_of edge, for the family word it carries. Replaced ParentRow when
 *  scout_parents was retired — the word moved to relationships.role_label. */
interface RelationRow {
  id: number;
  person_id: number;
  role_label: string | null;
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
    // Inactive adults stay on record — attached to ledger history, past events
    // and relationships — but are no longer OFFERED. Without this the picker
    // accumulates everyone who has ever been on the roster.
    supabase
      .from('people')
      .select('id, display_name, primary_email')
      .is('merged_into_person_id', null)
      .eq('active', true),
    supabase
      .from('scouts')
      .select('id, display_name, last_name, household_id, active, person_id, inactive_reason, birthdate'),
    supabase
      .from('relationships')
      .select('id, person_id, role_label')
      .in('type', ['parent_of', 'guardian_of']),
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
  const relations = (parentData ?? []) as RelationRow[];
  const leaders = (leaderData ?? []) as LeaderRow[];
  const activeScoutIds = new Set(scouts.filter((s) => s.active).map((s) => s.id));

  const scoutByPerson = new Map<number, ScoutRow>();
  for (const s of scouts) if (s.person_id != null) scoutByPerson.set(s.person_id, s);

  // person_id → the family word to show beside their name. An adult with
  // several children holds one edge per child; lowest id wins so the choice is
  // stable between page loads, which is the rule the scout_parents version
  // used for exactly the same reason.
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

  /**
   * An adult is anyone on record who is not a currently-enrolled youth.
   *
   * This used to additionally require a scout_parents or leaders row, which
   * quietly excluded the 42 people the roster import created — they held a
   * person record and nothing else, so no matter what a leader did to them
   * (including assigning the household the Roster told them to assign) they
   * never appeared here. signup_entries has always carried an `adult_name`
   * fallback for exactly this case, so there was never a reason to require a
   * legacy row to list someone.
   *
   * Still excluded: currently-enrolled scouts (they are listed as scouts) and
   * youth who left without ageing out — a scout who dropped out at 14 is not
   * an adult to be offered at signup.
   */
  function asAdult(personId: number): HouseholdAdult | null {
    const person = people.get(personId);
    if (!person) return null;

    const scout = scoutByPerson.get(personId);
    if (scout && scout.active) return null; // listed as a scout instead
    if (scout && !scout.active && !noLongerYouth(scout)) return null; // youth who left

    const relation = relationByPerson.get(personId);
    const leader = leaderByPerson.get(personId);
    const leaderIsAdult = leader ? isAdultPerson(leader, activeScoutIds) : false;

    return {
      key: `pe${personId}`,
      personId,
      leaderCode: leaderIsAdult ? (leader?.code ?? null) : null,
      name: person.display_name,
      relationship: relation?.role_label ?? null,
      // scout_parents.email used to sit between these two. It is gone with the
      // table and nothing is lost: every address it held is already on
      // people.primary_email (verified against production before the drop).
      email: person.primary_email ?? leader?.email ?? null
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

/** Which household (by key) a given person_id belongs to, scout or adult —
 *  reuses loadHouseholds() rather than a bespoke query so household
 *  membership stays defined in exactly one place (Plans/Family-Identity-Auth.md
 *  Phase 1 — the reverse lookup a verified sign-in needs). Null for a person
 *  with no household row at all, or one loadHouseholds() excludes (merged
 *  away, inactive). */
/** Same rule as resolveHouseholdKeyForPerson, against a roster the caller
 *  already holds — the event page has every household in scope and would
 *  otherwise load them all a second time just to place one person.
 *
 *  A person appears in exactly one household: loadHouseholds() tracks a
 *  `placed` set, so nobody is both a member of a stored household and their
 *  own household-of-one. That's what makes the first match the only match. */
export function householdKeyForPerson(households: Household[], personId: number): string | null {
  return (
    households.find(
      (h) =>
        h.scouts.some((s) => s.personId === personId) ||
        h.adults.some((a) => a.personId === personId)
    )?.key ?? null
  );
}

export async function resolveHouseholdKeyForPerson(personId: number): Promise<string | null> {
  const all = await loadHouseholds();
  for (const h of all) {
    if (h.scouts.some((s) => s.personId === personId)) return h.key;
    if (h.adults.some((a) => a.personId === personId)) return h.key;
  }
  return null;
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
