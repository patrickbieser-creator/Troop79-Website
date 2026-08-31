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

export interface AuditEntry {
  area: AuditArea;
  /** Verb, lowercase: 'create' | 'update' | 'delete' | 'publish' | 'approve' | … */
  action: string;
  /** What kind of thing changed: 'article', 'calendar_entry', 'person', 'resource', … */
  entityType: string;
  entityId?: string | number | null;
  /** One human-readable line — the "basic info". */
  summary: string;
  details?: Record<string, unknown> | null;
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
      details: entry.details ?? null
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
