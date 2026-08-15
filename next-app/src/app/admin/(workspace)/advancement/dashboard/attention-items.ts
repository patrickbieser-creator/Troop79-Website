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
import { fieldLabel, type ChangeEntityType, type ChangeRequestRow } from '@/lib/change-requests';

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

/**
 * Family-submitted profile updates awaiting review
 * (Plans/Scout-Self-Service-Demographics.md).
 *
 * Covers ADULT requests as well as scout ones — /profile edits the whole
 * household now, and an adult update that only ever produced an email would
 * have sat unreviewed forever. Each deep-links into the Roster tab that
 * actually holds the record.
 */
async function loadPendingProfileUpdates(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const { data: requests } = await supabase
    .from('change_requests')
    .select('id, entity_type, entity_id, submitted_at, proposed_changes')
    .in('entity_type', ['scout', 'adult'])
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  const rows = (requests ?? []) as Pick<
    ChangeRequestRow,
    'id' | 'entity_type' | 'entity_id' | 'submitted_at' | 'proposed_changes'
  >[];

  const scoutIds = [...new Set(rows.filter((r) => r.entity_type === 'scout').map((r) => r.entity_id))];
  const personIds = [
    ...new Set(rows.filter((r) => r.entity_type === 'adult').map((r) => Number(r.entity_id)))
  ];

  const [{ data: scouts }, { data: people }] = await Promise.all([
    scoutIds.length > 0
      ? supabase.from('scouts').select('id, display_name, active').in('id', scoutIds)
      : Promise.resolve({ data: [] }),
    personIds.length > 0
      ? supabase.from('person_directory').select('person_id, display_name, tab').in('person_id', personIds)
      : Promise.resolve({ data: [] })
  ]);

  const scoutById = new Map(
    ((scouts ?? []) as { id: string; display_name: string; active: boolean }[]).map((s) => [s.id, s])
  );
  const personById = new Map(
    ((people ?? []) as { person_id: number; display_name: string; tab: string }[]).map((p) => [
      String(p.person_id),
      p
    ])
  );

  const items: AttentionItem[] = rows.map((r) => {
    const type = r.entity_type as ChangeEntityType;
    const fieldLabels = Object.keys(r.proposed_changes)
      .map((f) => fieldLabel(type, f))
      .join(', ');

    if (type === 'adult') {
      const person = personById.get(r.entity_id);
      // Leaders and Adults are separate roster tabs; open the one the person
      // is actually on, same idea as the scout branch below.
      const tab = person?.tab === 'leader' ? 'leader' : 'adult';
      return {
        label: person?.display_name ?? `Person ${r.entity_id}`,
        meta: `${fieldLabels} · submitted ${shortDate(r.submitted_at)}`,
        href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
      };
    }

    const scout = scoutById.get(r.entity_id);
    // Deep-links into the Roster's scout editor (Active or Inactive tab,
    // whichever the scout is actually on) — see scouts-table.tsx's
    // openScoutId prop.
    const tab = scout?.active === false ? 'inactive_scout' : 'active_scout';
    return {
      label: scout?.display_name ?? r.entity_id,
      meta: `${fieldLabels} · submitted ${shortDate(r.submitted_at)}`,
      href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
    };
  });

  return { key: 'profile-updates', label: 'Profile updates awaiting review', items };
}

/** Resource Library submissions waiting for webmaster review
 *  (Plans/Resource-Library.md — everything queues, including leaders'). */
async function loadPendingLibrarySubmissions(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('library_resources')
    .select('id, title, submitted_by_label, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const items: AttentionItem[] = (
    (data ?? []) as { id: number; title: string; submitted_by_label: string | null; created_at: string }[]
  ).map((r) => ({
    label: r.title,
    meta: `${r.submitted_by_label ? `from ${r.submitted_by_label} · ` : ''}submitted ${shortDate(r.created_at)}`,
    href: '/admin/library?tab=queue'
  }));

  return { key: 'library-submissions', label: 'Library submissions awaiting review', items };
}

/** Proof-of-completion submissions awaiting review
 *  (Plans/Resource-Library.md Phase 2). */
async function loadPendingProofSubmissions(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('requirement_submissions')
    .select('id, scout_id, target_key, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const rows = (data ?? []) as { id: number; scout_id: string; target_key: string; created_at: string }[];
  const scoutIds = [...new Set(rows.map((r) => r.scout_id))];
  const { data: scouts } =
    scoutIds.length > 0
      ? await supabase.from('scouts').select('id, display_name').in('id', scoutIds)
      : { data: [] as { id: string; display_name: string }[] };
  const scoutById = new Map(((scouts ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s]));

  const items: AttentionItem[] = rows.map((r) => ({
    label: scoutById.get(r.scout_id)?.display_name ?? r.scout_id,
    meta: `${r.target_key} · submitted ${shortDate(r.created_at)}`,
    href: '/admin/library?tab=proof'
  }));

  return { key: 'proof-submissions', label: 'Proof submissions awaiting review', items };
}

export async function loadAttentionCategories(): Promise<AttentionCategory[]> {
  const categories = await Promise.all([
    loadPendingProfileUpdates(),
    loadPendingLibrarySubmissions(),
    loadPendingProofSubmissions()
  ]);
  // A category with nothing in it is noise, not signal — drop it rather than
  // showing an empty "0 items" heading.
  return categories.filter((c) => c.items.length > 0);
}
