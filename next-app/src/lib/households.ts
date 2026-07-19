/**
 * Household derivation for the family signup flow.
 *
 * There is no households table: `scout_parents` rows hang off a single scout,
 * so two siblings each carry their own copy of the same parent. A "household"
 * is therefore DERIVED — scouts are linked when they share a normalized parent
 * email, and each connected group becomes one household.
 *
 * Why email and not surname or address: checked against the real roster
 * (2026-07-18) — every parent row has an email, and exactly the four genuine
 * sibling pairs share one. Surnames break on blended families and coincidental
 * matches; addresses are frequently blank. Email is the signal the data
 * actually supports.
 *
 * A scout with no parent rows still forms a household of one, so nobody is
 * unreachable in the picker.
 */

import { createAdminClient } from '@/lib/supabase/server';

export interface HouseholdAdult {
  /** scout_parents.id of one representative row (identity for signup_entries). */
  id: number;
  name: string;
  relationship: string | null;
}

export interface HouseholdScout {
  id: string;
  displayName: string;
}

export interface Household {
  /** Stable key: the lowest scout id in the group. */
  key: string;
  /** Surname-ish label for display, e.g. "Kowalski". */
  label: string;
  scouts: HouseholdScout[];
  adults: HouseholdAdult[];
}

interface ParentRow {
  id: number;
  scout_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
}

interface ScoutRow {
  id: string;
  display_name: string;
  last_name: string;
}

const normEmail = (e: string | null): string | null => {
  const t = (e ?? '').trim().toLowerCase();
  return t.length > 0 ? t : null;
};

/**
 * Union-find over scouts, joined by shared parent email. Iterative and tiny —
 * the troop is ~30 scouts, so clarity beats cleverness here.
 */
function groupScouts(scouts: ScoutRow[], parents: ParentRow[]): Map<string, string[]> {
  const parentOf = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parentOf.get(root) && parentOf.get(root) !== root) root = parentOf.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parentOf.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  for (const s of scouts) parentOf.set(s.id, s.id);

  const byEmail = new Map<string, string[]>();
  for (const p of parents) {
    const email = normEmail(p.email);
    if (!email) continue;
    if (!parentOf.has(p.scout_id)) continue; // parent of an inactive scout
    byEmail.set(email, [...(byEmail.get(email) ?? []), p.scout_id]);
  }
  for (const ids of byEmail.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  const groups = new Map<string, string[]>();
  for (const s of scouts) {
    const root = find(s.id);
    groups.set(root, [...(groups.get(root) ?? []), s.id]);
  }
  return groups;
}

export async function loadHouseholds(): Promise<Household[]> {
  const supabase = createAdminClient();
  const [{ data: scoutData }, { data: parentData }] = await Promise.all([
    supabase
      .from('scouts')
      .select('id, display_name, last_name')
      .eq('active', true)
      .order('last_name', { ascending: true }),
    supabase.from('scout_parents').select('id, scout_id, name, relationship, email')
  ]);

  const scouts = (scoutData ?? []) as unknown as ScoutRow[];
  const parents = (parentData ?? []) as unknown as ParentRow[];
  const scoutById = new Map(scouts.map((s) => [s.id, s]));
  const groups = groupScouts(scouts, parents);

  const households: Household[] = [];
  for (const [root, memberIds] of groups) {
    const members = memberIds.map((id) => scoutById.get(id)!).filter(Boolean);
    if (members.length === 0) continue;

    // Adults: every parent of any member, de-duplicated by email (siblings each
    // carry their own row for the same person) and falling back to name.
    const seen = new Set<string>();
    const adults: HouseholdAdult[] = [];
    for (const p of parents) {
      if (!memberIds.includes(p.scout_id)) continue;
      const key = normEmail(p.email) ?? p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      adults.push({ id: p.id, name: p.name.trim(), relationship: p.relationship });
    }

    const surnames = [...new Set(members.map((m) => m.last_name).filter(Boolean))];
    households.push({
      key: root,
      label: surnames.length > 0 ? surnames.join(' / ') : members[0].display_name,
      scouts: members
        .map((m) => ({ id: m.id, displayName: m.display_name }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      adults
    });
  }

  return households.sort((a, b) => a.label.localeCompare(b.label));
}

/** The household containing a given scout, or null. */
export async function loadHouseholdForScout(scoutId: string): Promise<Household | null> {
  const all = await loadHouseholds();
  return all.find((h) => h.scouts.some((s) => s.id === scoutId)) ?? null;
}
