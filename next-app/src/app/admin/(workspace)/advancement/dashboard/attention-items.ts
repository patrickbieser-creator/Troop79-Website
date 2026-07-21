/**
 * "Needs Attention" — leader-facing inbox of things submitted by someone else
 * that are waiting on a decision. First thing on the Dashboard (Patrick,
 * 2026-07-21): a leader shouldn't have to already know which scout has a
 * pending profile update to find it.
 *
 * Deliberately a growing LIST OF CATEGORIES, not just today's one item type —
 * this is where submitted news articles and submitted website-improvement
 * suggestions will land too, once those exist. Add a new `load*()` function
 * below and register it in loadAttentionCategories(); nothing else about the
 * panel needs to change.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { FIELD_LABEL, type ChangeRequestRow, type EditableScoutField } from '@/lib/change-requests';

export interface AttentionItem {
  label: string;
  meta: string;
  href: string;
}

export interface AttentionCategory {
  key: string;
  label: string;
  items: AttentionItem[];
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Family-submitted profile updates awaiting review (Plans/Scout-Self-Service-Demographics.md). */
async function loadPendingProfileUpdates(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const { data: requests } = await supabase
    .from('change_requests')
    .select('id, entity_id, submitted_at, proposed_changes')
    .eq('entity_type', 'scout')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  const rows = (requests ?? []) as Pick<
    ChangeRequestRow,
    'id' | 'entity_id' | 'submitted_at' | 'proposed_changes'
  >[];

  const scoutIds = [...new Set(rows.map((r) => r.entity_id))];
  const { data: scouts } =
    scoutIds.length > 0
      ? await supabase.from('scouts').select('id, display_name, active').in('id', scoutIds)
      : { data: [] as { id: string; display_name: string; active: boolean }[] };
  const scoutById = new Map(
    ((scouts ?? []) as { id: string; display_name: string; active: boolean }[]).map((s) => [s.id, s])
  );

  const items: AttentionItem[] = rows.map((r) => {
    const scout = scoutById.get(r.entity_id);
    // Deep-links into the Roster's scout editor (Active or Inactive tab,
    // whichever the scout is actually on) — see scouts-table.tsx's
    // openScoutId prop.
    const tab = scout?.active === false ? 'inactive_scout' : 'active_scout';
    const fieldLabels = Object.keys(r.proposed_changes)
      .map((f) => FIELD_LABEL[f as EditableScoutField] ?? f)
      .join(', ');
    return {
      label: scout?.display_name ?? r.entity_id,
      meta: `${fieldLabels} · submitted ${shortDate(r.submitted_at)}`,
      href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
    };
  });

  return { key: 'profile-updates', label: 'Profile updates awaiting review', items };
}

export async function loadAttentionCategories(): Promise<AttentionCategory[]> {
  const categories = await Promise.all([loadPendingProfileUpdates()]);
  // A category with nothing in it is noise, not signal — drop it rather than
  // showing an empty "0 items" heading.
  return categories.filter((c) => c.items.length > 0);
}
