/**
 * The record page's History (Plans/Person-Editor-Rethink.md, Phase 4): the
 * audit_log filtered to ONE person, newest first. No new table — every
 * roster action already writes a row; this is the read side.
 *
 * "About this person" means any of:
 *   - keyed on their people row            (entity_type person / role /
 *     relationship / household_membership / person_email, entity_id = id —
 *     what the roster actions write for a person and their related rows)
 *   - keyed on their scouts row by scout id (setScoutActive, the scout
 *     section saves, promote)
 *   - keyed on their leaders row by code    (nothing writes this today;
 *     included so a future leader-keyed action is found without a change here)
 *   - listing them in `details.people`      (AuditEntry.subjects — a
 *     relationship names both people, a change request names the person it
 *     edits; jsonb containment finds those from every side)
 *
 * Two queries, merged and de-duplicated in memory: PostgREST's `or=` syntax
 * cannot carry a jsonb literal cleanly, and a person's own history is small.
 * The entity_id match is scoped by entity_type on purpose — a change_request
 * or household row keyed on its own numeric id must not collide with a person
 * of the same number.
 *
 * Server-only by use (createAdminClient); not marked with the `server-only`
 * package so tests/person-history.test.ts can run it against local Supabase.
 */

import { auditDetailsOf } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/server';
import type { PersonHistoryEntry, PersonHistorySummary } from './record-types';

const COLUMNS = 'id, occurred_at, actor_label, actor_person_id, action, summary, details';

/** Rows keyed on a people.id under these entity types are about that person. */
const PERSON_KEYED_TYPES = ['person', 'role', 'relationship', 'household_membership', 'person_email'];

/** Bound on what one person's log can grow to before the Full log truncates. */
const MAX_ROWS = 500;

interface RawRow {
  id: number;
  occurred_at: string;
  actor_label: string;
  actor_person_id: number | null;
  action: string;
  summary: string;
  details: unknown;
}

export interface PersonHistoryOptions {
  limit?: number;
}

export async function getPersonHistory(
  personId: number,
  options: PersonHistoryOptions = {}
): Promise<PersonHistoryEntry[]> {
  const supabase = createAdminClient();
  const limit = Math.max(1, Math.min(options.limit ?? MAX_ROWS, MAX_ROWS));

  const [{ data: scoutRow }, { data: leaderRow }] = await Promise.all([
    supabase.from('scouts').select('id').eq('person_id', personId).maybeSingle(),
    supabase.from('leaders').select('code').eq('person_id', personId).limit(1).maybeSingle()
  ]);
  const scoutId = (scoutRow as { id: string } | null)?.id ?? null;
  const leaderCode = (leaderRow as { code: string } | null)?.code ?? null;

  const keyed = [`and(entity_type.in.(${PERSON_KEYED_TYPES.join(',')}),entity_id.eq.${personId})`];
  if (scoutId) keyed.push(`and(entity_type.eq.scout,entity_id.eq.${quote(scoutId)})`);
  if (leaderCode) keyed.push(`and(entity_type.eq.leader,entity_id.eq.${quote(leaderCode)})`);

  const [byEntity, bySubject] = await Promise.all([
    supabase
      .from('audit_log')
      .select(COLUMNS)
      .eq('area', 'roster')
      .or(keyed.join(','))
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
    supabase
      .from('audit_log')
      .select(COLUMNS)
      .eq('area', 'roster')
      .contains('details', { people: [personId] })
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
  ]);
  if (byEntity.error) throw new Error(byEntity.error.message);
  if (bySubject.error) throw new Error(bySubject.error.message);

  const seen = new Set<number>();
  const rows: RawRow[] = [];
  for (const r of [...((byEntity.data ?? []) as RawRow[]), ...((bySubject.data ?? []) as RawRow[])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  rows.sort((a, b) => (a.occurred_at === b.occurred_at ? b.id - a.id : a.occurred_at < b.occurred_at ? 1 : -1));

  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actorLabel: r.actor_label,
    actorPersonId: r.actor_person_id,
    action: r.action,
    summary: r.summary,
    details: auditDetailsOf(r.details)
  }));
}

/** What the page loads up front: the latest `latestCount` plus the counts. */
export async function getPersonHistorySummary(personId: number, latestCount = 4): Promise<PersonHistorySummary> {
  const all = await getPersonHistory(personId);
  return {
    latest: all.slice(0, latestCount),
    total: all.length,
    withDetails: all.filter((e) => e.details && e.details.length > 0).length
  };
}

/** A scout id / leader code inside PostgREST's `or=` filter: quoted, with
 *  anything that could break the grammar stripped (ids are [A-Za-z0-9]). */
function quote(value: string): string {
  return `"${value.replace(/[^A-Za-z0-9_-]/g, '')}"`;
}
