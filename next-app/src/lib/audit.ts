/**
 * Content audit trail (Patrick, 2026-08-30): every CRUD change to website
 * CONTENT — news, calendar, roster, resource library — dumps one row into
 * `audit_log` with a date and person tag. Advancement and finance are
 * deliberately excluded: both already have ledgers of record. The signup
 * workbench (events/actions.ts) is also out of scope for now — family
 * logistics and payments, not website content.
 *
 * App-level, not DB triggers: every write goes through the service role, so
 * a trigger would see one anonymous superuser — the acting PERSON exists
 * only in the app session (resolveAdminActor).
 *
 * THE ONE INVARIANT: auditing must never break a save. Both entry points
 * swallow every failure (logged to the server console) — a lost audit row
 * is strictly better than a leader's edit erroring after the write landed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveAdminActor } from '@/lib/admin-actor';

export const AUDIT_AREAS = ['news', 'calendar', 'roster', 'library'] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

/**
 * One field-level change (Plans/Person-Editor-Rethink.md, History). The
 * summary line names people and FIELD NAMES only (D-257); the values — what
 * it was, what it became — go here, so the record page's History section
 * can show "Status: Active → Inactive" without the summary ever carrying a
 * value. Display strings, not raw codes: '—' for blank.
 */
export interface AuditDetail {
  field: string;
  from: string;
  to: string;
}

export interface AuditEntry {
  area: AuditArea;
  /** Verb, lowercase: 'create' | 'update' | 'delete' | 'publish' | 'approve' | … */
  action: string;
  /** What kind of thing changed: 'article', 'calendar_entry', 'person', 'resource', … */
  entityType: string;
  entityId?: string | number | null;
  /** One human-readable line — the "basic info". */
  summary: string;
  details?: Record<string, unknown> | AuditDetail[] | null;
  /**
   * people.ids this row is ABOUT beyond `entityId` — a relationship is about
   * two people, a change request about the person it edits. Stored inside
   * `details` as `{ changes, people }` so the record page's History
   * (roster/[personId]/get-person-history.ts) finds the row from every side
   * with one jsonb containment filter; `auditDetailsOf` reads either shape.
   */
  subjects?: number[];
}

/** The two shapes `audit_log.details` takes: the plain diff, or the diff
 *  wrapped with the people it concerns (see AuditEntry.subjects). */
export type StoredAuditDetails = AuditDetail[] | { changes: AuditDetail[]; people: number[] };

/** The field-level diff of a stored row, whichever shape it was written in;
 *  null when the row predates the History cutover or carried none. */
export function auditDetailsOf(raw: unknown): AuditDetail[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { changes?: unknown }).changes)
      ? (raw as { changes: unknown[] }).changes
      : null;
  if (!list) return null;
  const out: AuditDetail[] = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const { field, from, to } = d as Record<string, unknown>;
    if (typeof field !== 'string') continue;
    out.push({ field, from: from == null ? '—' : String(from), to: to == null ? '—' : String(to) });
  }
  return out;
}

export interface AuditActor {
  personId: number | null;
  label: string;
}

/**
 * The db-testable half: write one audit row as a known actor. Never throws.
 */
export async function recordAuditAs(
  supabase: SupabaseClient,
  actor: AuditActor | null,
  entry: AuditEntry
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_log').insert({
      actor_person_id: actor?.personId ?? null,
      actor_label: actor?.label ?? 'system',
      area: entry.area,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary,
      details: entry.subjects?.length
        ? { changes: Array.isArray(entry.details) ? entry.details : [], people: entry.subjects }
        : (entry.details ?? null)
    });
    if (error) console.error('audit_log write failed:', error.message, entry);
  } catch (e) {
    console.error('audit_log write failed:', e, entry);
  }
}

/**
 * The one-liner for server actions: resolves the acting person from the
 * request session (cache()d — free when the action already called
 * requireCapability) and records the entry. Never throws.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  let actor: AuditActor | null = null;
  try {
    const resolved = await resolveAdminActor();
    if (resolved) actor = { personId: resolved.personId, label: resolved.label };
  } catch {
    // Outside a request context (or no session) — record as 'system'.
  }
  await recordAuditAs(createAdminClient(), actor, entry);
}
