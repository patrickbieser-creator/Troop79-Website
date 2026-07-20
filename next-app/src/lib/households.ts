/**
 * Households for the family signup flow.
 *
 * Membership is a STORED fact (`scouts.household_id` → `households`), not an
 * inference. It used to be derived at runtime by linking scouts that shared a
 * parent email; that matched today's data but broke the moment a parent gave a
 * work address on one form and a personal one on the next — two siblings would
 * silently split into separate households and each would see a partial family.
 *
 * The email derivation still exists, but only as a bootstrap (run once by
 * migration 20260719010000) and as a SUGGESTION for a newly added scout. It is
 * never the source of truth at read time.
 *
 * WHO CAN BE FOUND HERE — the signup universe is every real person in the
 * troop, not only families with a currently-active scout. Three sources feed it:
 *
 *   1. Active scouts, bucketed by household, with their parents attached.
 *   2. Households whose scouts have all aged out or gone inactive. The scout is
 *      no longer someone to sign up, but the ADULTS stay reachable — an aged-out
 *      scout's parent is still on the committee, still drives, still comes to
 *      the banquet. Filtering the query on scouts.active dropped the whole
 *      household and took those adults with it.
 *   3. Adults on the `leaders` roster with no parent row at all — committee
 *      members, merit badge counselors, ASMs whose own children were never in
 *      the troop. Each becomes a household of one keyed `leader:<code>`.
 *
 * A scout whose household_id is null still works: they become a household of
 * one, so nobody is unreachable in the picker.
 *
 * DE-DUPLICATION: `leaders` and `scout_parents` have no foreign key between
 * them, so one human can legitimately hold a row in both — a committee member
 * who is also a parent. Match on email, then name, and keep the PARENT row: it
 * carries household context the leader row doesn't. Without this the picker
 * lists them twice and they can sign up twice for one event, which the
 * per-column unique indexes on signup_entries cannot catch (each one only sees
 * its own identity column).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { isAdultPerson, type LeaderLite } from '@/lib/authorized-adults';

export interface HouseholdAdult {
  /** Stable identity for form state and React keys: `p<parentId>` or `l<code>`.
   *  Adults come from two tables now, so a bare numeric id is no longer unique
   *  across the set. */
  key: string;
  /** scout_parents.id — set when this adult came from a parent row. */
  scoutParentId: number | null;
  /** leaders.code — set when this adult came from the adult roster. */
  leaderCode: string | null;
  name: string;
  relationship: string | null;
  /** Primary contact address, when one is recorded. */
  email: string | null;
}

export interface HouseholdScout {
  id: string;
  displayName: string;
}

export interface Household {
  /** `<households.id>`, `scout:<id>` for an unassigned scout, or
   *  `leader:<code>` for an adult with no scout in the troop. */
  key: string;
  label: string;
  /** ACTIVE scouts only. An inactive scout's household still surfaces for the
   *  sake of its adults, but the scout is not offered as someone to sign up. */
  scouts: HouseholdScout[];
  adults: HouseholdAdult[];
}

interface ScoutRow {
  id: string;
  display_name: string;
  last_name: string | null;
  household_id: number | null;
  active: boolean;
}
interface ParentRow {
  id: number;
  scout_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
}
interface LeaderRow extends LeaderLite {
  email: string | null;
}

/** Collapses the duplicate parent rows siblings each carry for the same person.
 *  Both rows come from scout_parents, so email presence is consistent between
 *  them and preferring email is safe here. */
function personKey(name: string, email: string | null): string {
  return (email ?? '').trim().toLowerCase() || name.trim().toLowerCase();
}

function normalizeEmail(email: string | null): string | null {
  return (email ?? '').trim().toLowerCase() || null;
}

export async function loadHouseholds(): Promise<Household[]> {
  const supabase = createAdminClient();
  const [{ data: householdData }, { data: scoutData }, { data: parentData }, { data: leaderData }] =
    await Promise.all([
      supabase.from('households').select('id, label'),
      // Deliberately NOT filtered to active — see source 2 in the header note.
      supabase.from('scouts').select('id, display_name, last_name, household_id, active'),
      supabase.from('scout_parents').select('id, scout_id, name, relationship, email'),
      supabase
        .from('leaders')
        .select('code, name, is_person, scout_id, can_login, login_name, email')
    ]);

  const labels = new Map(
    ((householdData ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label])
  );
  const scouts = (scoutData ?? []) as unknown as ScoutRow[];
  const parents = (parentData ?? []) as unknown as ParentRow[];
  const leaders = (leaderData ?? []) as unknown as LeaderRow[];
  const activeScoutIds = new Set(scouts.filter((s) => s.active).map((s) => s.id));

  // Bucket every scout by stored household; unassigned scouts stand alone.
  const buckets = new Map<string, ScoutRow[]>();
  for (const s of scouts) {
    const key = s.household_id != null ? String(s.household_id) : `scout:${s.id}`;
    buckets.set(key, [...(buckets.get(key) ?? []), s]);
  }

  const households: Household[] = [];
  /* Everyone already reachable through a parent row, so the leader pass below
     doesn't surface the same human a second time.

     Tracked as TWO sets rather than one preferred key, because the two tables
     populate email differently: every leaders row in production has a null
     email while most scout_parents rows have one. A single "email else name"
     key therefore compares a leader's NAME against a parent's EMAIL and never
     matches — which silently listed eight real people (the Scoutmaster among
     them) twice, once per source table, and let them sign up twice for one
     event. The per-column unique indexes on signup_entries can't catch that:
     each only sees its own identity column. Match on either axis. */
  const claimedEmails = new Set<string>();
  const claimedNames = new Set<string>();

  for (const [key, members] of buckets) {
    const memberIds = new Set(members.map((m) => m.id));

    // One adult per real person: siblings each carry their own parent row for
    // the same person, so de-duplicate on email, then name.
    const seen = new Set<string>();
    const adults: HouseholdAdult[] = [];
    for (const p of parents) {
      if (!memberIds.has(p.scout_id)) continue;
      // Claim BEFORE the dedupe check: siblings' rows for the same adult can
      // spell the name differently ("JamieLynn" vs "Jamie Lynn"). Claiming only
      // the surviving row leaves the other spelling unclaimed, so a leaders row
      // carrying THAT spelling slips past the pass below and the same human
      // appears twice — once in her household, once "signing up on your own".
      if (p.email?.trim()) claimedEmails.add(p.email.trim().toLowerCase());
      claimedNames.add(p.name.trim().toLowerCase());
      const dedupeKey = personKey(p.name, p.email);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      adults.push({
        key: `p${p.id}`,
        scoutParentId: p.id,
        leaderCode: null,
        name: p.name.trim(),
        relationship: p.relationship,
        email: normalizeEmail(p.email)
      });
    }

    const activeMembers = members.filter((m) => m.active);
    // Every scout gone AND nobody left to contact — that household really is
    // finished, and listing it would just add noise to the picker.
    if (activeMembers.length === 0 && adults.length === 0) continue;

    const stored = key.startsWith('scout:') ? null : labels.get(Number(key));
    // Label off the active scouts when there are any, so a household isn't
    // named for the sibling who aged out.
    const forLabel = activeMembers.length > 0 ? activeMembers : members;
    const surnames = [...new Set(forLabel.map((m) => m.last_name).filter(Boolean))];
    households.push({
      key,
      label: stored ?? (surnames.length > 0 ? surnames.join(' / ') : forLabel[0].display_name),
      scouts: activeMembers
        .map((m) => ({ id: m.id, displayName: m.display_name }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      adults
    });
  }

  // Source 3: real adults with no parent row anywhere. isAdultPerson() is the
  // same rule the login pool and Meeting Plan engine use — a real person who
  // isn't a currently-active scout's youth-leader initials — so an aged-out
  // youth leader correctly graduates into the adult picker here.
  for (const l of leaders) {
    if (!isAdultPerson(l, activeScoutIds)) continue;
    const email = normalizeEmail(l.email);
    const name = l.name.trim().toLowerCase();
    // Already reachable as a parent — leave them in their household, where
    // they have the rest of the family with them.
    if ((email && claimedEmails.has(email)) || claimedNames.has(name)) continue;
    if (email) claimedEmails.add(email);
    claimedNames.add(name);
    households.push({
      key: `leader:${l.code}`,
      label: l.name.trim(),
      scouts: [],
      adults: [
        {
          key: `l${l.code}`,
          scoutParentId: null,
          leaderCode: l.code,
          name: l.name.trim(),
          relationship: null,
          email: normalizeEmail(l.email)
        }
      ]
    });
  }

  return households.sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadHouseholdByKey(key: string): Promise<Household | null> {
  const all = await loadHouseholds();
  return all.find((h) => h.key === key) ?? null;
}

/** `households.id` when the key refers to a stored household, else null.
 *  `scout:<id>` and `leader:<code>` parties have no stored household row, and
 *  the signup RPCs take null for those. Centralised so callers can't reinvent
 *  a `Number(key)` parse that yields NaN for the sentinel forms. */
export function storedHouseholdId(key: string | null | undefined): number | null {
  if (!key || !/^\d+$/.test(key)) return null;
  return Number(key);
}
