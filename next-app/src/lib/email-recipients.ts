import { createAdminClient } from '@/lib/supabase/server';

/**
 * Who should receive troop mail for a given set of scouts.
 *
 * Parent resolution goes through the people/relationships spine —
 * `relationships` (type='parent_of') rather than joining scout_parents on
 * scout_id directly — so this keeps working for a parent recorded ONLY as a
 * relationship (the roster-import / scout-relations path), not just one who
 * also happens to hold a scout_parents row.
 *
 * Bounce/unsubscribe tracking (scout_parent_emails) is keyed directly on
 * person_id (2026-07-25 re-key) — no scout_parents join needed for
 * deliverability status. A parent with a legacy scout_parents.email but no
 * scout_parent_emails row yet falls back to that, then to
 * people.primary_email.
 */

export interface Recipient {
  email: string;
  parentName: string;
  scoutIds: string[];
}

/** Shared deliverability rule — a bounced or unsubscribed address must never
 *  be mailed again, whether the caller is this module's scout->parent fan-out
 *  or lib/identity-challenge.ts's reverse email->person sign-in lookup
 *  (Plans/Family-Identity-Auth.md Phase 1, extracted 2026-08-06 so both
 *  callers share one rule instead of two copies that can drift). */
export function isDeliverable(addr: { bounced_at: string | null; unsubscribed_at: string | null }): boolean {
  return !addr.bounced_at && !addr.unsubscribed_at;
}

export async function recipientsForScouts(scoutIds: string[]): Promise<Recipient[]> {
  if (scoutIds.length === 0) return [];
  const supabase = createAdminClient();

  const { data: scouts } = await supabase
    .from('scouts')
    .select('id, person_id')
    .in('id', scoutIds);
  const scoutRows = (scouts ?? []) as { id: string; person_id: number | null }[];
  const scoutPersonIds = scoutRows.map((s) => s.person_id).filter((v): v is number => v != null);
  if (scoutPersonIds.length === 0) return [];

  const { data: rels } = await supabase
    .from('relationships')
    .select('person_id, related_person_id')
    .eq('type', 'parent_of')
    .in('related_person_id', scoutPersonIds);
  const relRows = (rels ?? []) as { person_id: number; related_person_id: number }[];
  if (relRows.length === 0) return [];

  const scoutIdByPerson = new Map(scoutRows.map((s) => [s.person_id, s.id]));
  const scoutIdsByParentPerson = new Map<number, string[]>();
  for (const r of relRows) {
    const scoutId = scoutIdByPerson.get(r.related_person_id);
    if (!scoutId) continue;
    scoutIdsByParentPerson.set(r.person_id, [...(scoutIdsByParentPerson.get(r.person_id) ?? []), scoutId]);
  }
  const parentPersonIds = [...scoutIdsByParentPerson.keys()];

  // The scout_parents.email safety net that used to sit between the tracked
  // address and people.primary_email is gone with the table (D-066). It cost
  // nothing to remove: every address it held was already on
  // people.primary_email, checked against production before the drop, and that
  // is still the last fallback below.
  const [{ data: people }, { data: addresses }] = await Promise.all([
    supabase.from('people').select('id, display_name, primary_email').in('id', parentPersonIds),
    supabase
      .from('scout_parent_emails')
      .select('person_id, email, is_primary, bounced_at, unsubscribed_at')
      .in('person_id', parentPersonIds)
  ]);
  const peopleRows = (people ?? []) as { id: number; display_name: string; primary_email: string | null }[];
  const addressRows = (addresses ?? []) as {
    person_id: number;
    email: string;
    is_primary: boolean;
    bounced_at: string | null;
    unsubscribed_at: string | null;
  }[];
  const byPersonId = new Map<number, typeof addressRows>();
  for (const a of addressRows) {
    byPersonId.set(a.person_id, [...(byPersonId.get(a.person_id) ?? []), a]);
  }

  const out = new Map<string, Recipient>();
  for (const person of peopleRows) {
    const addrs = (byPersonId.get(person.id) ?? []).filter(isDeliverable);
    // Prefer a live, tracked address; fall back to people.primary_email for a
    // relationship-only parent who has none.
    const chosen =
      addrs.find((a) => a.is_primary)?.email ??
      addrs[0]?.email ??
      (person.primary_email ? person.primary_email.trim().toLowerCase() : null);
    if (!chosen) continue;

    const scoutIdsForParent = scoutIdsByParentPerson.get(person.id) ?? [];
    const existing = out.get(chosen);
    if (existing) {
      for (const sid of scoutIdsForParent) if (!existing.scoutIds.includes(sid)) existing.scoutIds.push(sid);
    } else {
      out.set(chosen, { email: chosen, parentName: person.display_name, scoutIds: [...scoutIdsForParent] });
    }
  }
  return [...out.values()];
}
