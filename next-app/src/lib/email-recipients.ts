import { createAdminClient } from '@/lib/supabase/server';

/**
 * Who should receive troop mail for a given set of scouts.
 *
 * Parent resolution now goes through the people/relationships spine —
 * `relationships` (type='parent_of') rather than joining scout_parents on
 * scout_id directly — so this keeps working for a parent recorded ONLY as a
 * relationship (the roster-import / scout-relations path), not just one who
 * also happens to hold a scout_parents row.
 *
 * Bounce/unsubscribe tracking (scout_parent_emails) is still keyed on
 * scout_parent_id, not person_id — re-keying that table is its own future
 * migration (sequenced alongside the eventual scout_parents drop), so this
 * still joins through scout_parents for deliverability status. A parent with
 * no scout_parents row at all (relationship-only) has no address-status
 * history yet and falls back to people.primary_email directly.
 */

export interface Recipient {
  email: string;
  parentName: string;
  scoutIds: string[];
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

  const [{ data: people }, { data: parents }] = await Promise.all([
    supabase.from('people').select('id, display_name, primary_email').in('id', parentPersonIds),
    supabase.from('scout_parents').select('id, person_id, email').in('person_id', parentPersonIds)
  ]);
  const peopleRows = (people ?? []) as { id: number; display_name: string; primary_email: string | null }[];
  const parentRows = (parents ?? []) as { id: number; person_id: number | null; email: string | null }[];

  const scoutParentIdByPerson = new Map<number, number>();
  for (const p of parentRows) if (p.person_id != null && !scoutParentIdByPerson.has(p.person_id)) {
    scoutParentIdByPerson.set(p.person_id, p.id);
  }

  const { data: addresses } = await supabase
    .from('scout_parent_emails')
    .select('scout_parent_id, email, is_primary, bounced_at, unsubscribed_at')
    .in('scout_parent_id', [...scoutParentIdByPerson.values()]);
  const addressRows = (addresses ?? []) as {
    scout_parent_id: number;
    email: string;
    is_primary: boolean;
    bounced_at: string | null;
    unsubscribed_at: string | null;
  }[];
  const byScoutParentId = new Map<number, typeof addressRows>();
  for (const a of addressRows) {
    byScoutParentId.set(a.scout_parent_id, [...(byScoutParentId.get(a.scout_parent_id) ?? []), a]);
  }

  const out = new Map<string, Recipient>();
  for (const person of peopleRows) {
    const scoutParentId = scoutParentIdByPerson.get(person.id);
    const addrs = (scoutParentId != null ? (byScoutParentId.get(scoutParentId) ?? []) : []).filter(
      (a) => !a.bounced_at && !a.unsubscribed_at
    );
    // Prefer a live, tracked address; fall back to the parent row's own email,
    // then people.primary_email for a relationship-only parent with neither.
    const legacyEmail = scoutParentId != null ? parentRows.find((p) => p.id === scoutParentId)?.email : null;
    const chosen =
      addrs.find((a) => a.is_primary)?.email ??
      addrs[0]?.email ??
      (legacyEmail ? legacyEmail.trim().toLowerCase() : null) ??
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
