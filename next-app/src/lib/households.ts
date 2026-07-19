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
 * A scout whose household_id is null still works: they become a household of
 * one, so nobody is unreachable in the picker.
 */

import { createAdminClient } from '@/lib/supabase/server';

export interface HouseholdAdult {
  /** scout_parents.id — the identity written to signup_entries. */
  id: number;
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
  /** households.id as a string, or `scout:<id>` for an unassigned scout. */
  key: string;
  label: string;
  scouts: HouseholdScout[];
  adults: HouseholdAdult[];
}

interface ScoutRow {
  id: string;
  display_name: string;
  last_name: string | null;
  household_id: number | null;
}
interface ParentRow {
  id: number;
  scout_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
}

export async function loadHouseholds(): Promise<Household[]> {
  const supabase = createAdminClient();
  const [{ data: householdData }, { data: scoutData }, { data: parentData }] = await Promise.all([
    supabase.from('households').select('id, label'),
    supabase
      .from('scouts')
      .select('id, display_name, last_name, household_id')
      .eq('active', true),
    supabase.from('scout_parents').select('id, scout_id, name, relationship, email')
  ]);

  const labels = new Map(
    ((householdData ?? []) as { id: number; label: string }[]).map((h) => [h.id, h.label])
  );
  const scouts = (scoutData ?? []) as unknown as ScoutRow[];
  const parents = (parentData ?? []) as unknown as ParentRow[];

  // Bucket scouts by stored household; unassigned scouts stand alone.
  const buckets = new Map<string, ScoutRow[]>();
  for (const s of scouts) {
    const key = s.household_id != null ? String(s.household_id) : `scout:${s.id}`;
    buckets.set(key, [...(buckets.get(key) ?? []), s]);
  }

  const households: Household[] = [];
  for (const [key, members] of buckets) {
    const memberIds = new Set(members.map((m) => m.id));

    // One adult per real person: siblings each carry their own parent row for
    // the same person, so de-duplicate on email, then name.
    const seen = new Set<string>();
    const adults: HouseholdAdult[] = [];
    for (const p of parents) {
      if (!memberIds.has(p.scout_id)) continue;
      const email = (p.email ?? '').trim().toLowerCase();
      const dedupeKey = email || p.name.trim().toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      adults.push({
        id: p.id,
        name: p.name.trim(),
        relationship: p.relationship,
        email: email || null
      });
    }

    const stored = key.startsWith('scout:') ? null : labels.get(Number(key));
    const surnames = [...new Set(members.map((m) => m.last_name).filter(Boolean))];
    households.push({
      key,
      label: stored ?? (surnames.length > 0 ? surnames.join(' / ') : members[0].display_name),
      scouts: members
        .map((m) => ({ id: m.id, displayName: m.display_name }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      adults
    });
  }

  return households.sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadHouseholdByKey(key: string): Promise<Household | null> {
  const all = await loadHouseholds();
  return all.find((h) => h.key === key) ?? null;
}
