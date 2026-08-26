import { createAdminClient } from '@/lib/supabase/server';
import { emailsForPeople } from '@/lib/person-emails';

/**
 * Who should receive troop mail for a given set of scouts.
 *
 * Parent resolution goes through the people/relationships spine —
 * `relationships` (type='parent_of') rather than joining scout_parents on
 * scout_id directly — so this keeps working for a parent recorded ONLY as a
 * relationship (the roster-import / scout-relations path), not just one who
 * also happens to hold a scout_parents row.
 *
 * ADDRESSES COME FROM `person_emails` (Plans/Retire-Roster-Contact-Columns.md
 * Phase 2), not the legacy scout_parent_emails — EVERY deliverable (non-
 * bounced, non-unsubscribed) row of every parent, not just their primary. A
 * parent who has added a work address alongside home gets troop mail at
 * both; that is the point of the widening, not an accident of it. A parent
 * with no person_emails rows at all (a relationship-only parent from before
 * this table existed) falls back to people.primary_email.
 *
 * DEDUPED BY ADDRESS, ACROSS PEOPLE — not by parent. Two parents who share
 * one inbox collapse to a single Recipient whose parentName names both
 * ("Dana Ruiz & Alex Ruiz") and whose scoutIds is the union, so a shared
 * household address is never mailed twice for the same event.
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

  const [{ data: people }, emailsByPerson] = await Promise.all([
    supabase.from('people').select('id, display_name, primary_email').in('id', parentPersonIds),
    emailsForPeople(supabase, parentPersonIds)
  ]);
  const peopleRows = (people ?? []) as { id: number; display_name: string; primary_email: string | null }[];

  const out = new Map<string, Recipient>();
  for (const person of peopleRows) {
    const rows = emailsByPerson.get(person.id) ?? [];
    const deliverable = rows.filter((e) => !e.bouncedAt && !e.unsubscribedAt).map((e) => e.email);
    // A relationship-only parent with no person_emails rows yet falls back to
    // people.primary_email — the same fallback this module has always had.
    const targets = deliverable.length > 0 ? deliverable : person.primary_email ? [person.primary_email.trim().toLowerCase()] : [];
    if (targets.length === 0) continue;

    const scoutIdsForParent = scoutIdsByParentPerson.get(person.id) ?? [];
    for (const email of targets) {
      const existing = out.get(email);
      if (existing) {
        if (!existing.parentName.includes(person.display_name)) {
          existing.parentName = `${existing.parentName} & ${person.display_name}`;
        }
        for (const sid of scoutIdsForParent) if (!existing.scoutIds.includes(sid)) existing.scoutIds.push(sid);
      } else {
        out.set(email, { email, parentName: person.display_name, scoutIds: [...scoutIdsForParent] });
      }
    }
  }
  return [...out.values()];
}
