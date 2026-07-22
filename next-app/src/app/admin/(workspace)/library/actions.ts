'use server';

/**
 * /admin/library — webmaster workstation write paths.
 *
 * Same conventions as the other admin actions: leader session required,
 * service-role client, Result-shaped returns for form errors, redirect+
 * revalidate on success. Nothing here hard-deletes a resource — decline and
 * retire are archival states so history survives (Plans/Resource-Library.md).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { approveResource, declineResource } from '@/lib/library-data';
import { detectHost, type LibraryTargetKind, type ResourceKind } from '@/lib/library';
import { slugify } from '@/lib/slugify';

const ADMIN_PATH = '/admin/library';
const RESOURCE_KINDS: ReadonlySet<string> = new Set(['link', 'video', 'document', 'image', 'post']);
const TARGET_KINDS: ReadonlySet<string> = new Set(['rank_req', 'mb', 'mb_req', 'topic']);
const NOTE_KINDS: ReadonlySet<string> = new Set(['rank_req', 'mb', 'mb_req']);

function refresh(tab: string, group?: string): never {
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?tab=${tab}${group ? `&group=${encodeURIComponent(group)}` : ''}`);
}

/** Published-tab rows carry the drill group so a save lands back inside it. */
function groupOf(formData: FormData): string | undefined {
  const group = String(formData.get('group') ?? '');
  return group || undefined;
}

function fail(tab: string, message: string): never {
  redirect(`${ADMIN_PATH}?tab=${tab}&err=${encodeURIComponent(message)}`);
}

async function guard(): Promise<string> {
  const session = await requireRole(['leader']);
  return session.leader;
}

/** Shared field-save for both the queue and published editors. Returns an
 *  error message or null. */
async function saveResourceFields(formData: FormData): Promise<string | null> {
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return 'Invalid resource id';
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return 'Title is required';
  const kindRaw = String(formData.get('kind') ?? 'link');
  const kind: ResourceKind = RESOURCE_KINDS.has(kindRaw) ? (kindRaw as ResourceKind) : 'link';
  const url = String(formData.get('url') ?? '').trim() || null;
  const blurb = String(formData.get('blurb') ?? '').trim() || null;
  const bodyMd = String(formData.get('body_md') ?? '').trim() || null;
  const attribution = String(formData.get('attribution_label') ?? '').trim() || null;

  if (kind !== 'post' && !url) return 'Non-post resources need a link';
  // Stored URLs render as public hrefs — never persist a non-http(s) scheme
  // (javascript:, data:) even from a trusted leader session.
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Links must start with http:// or https://';
      }
    } catch {
      return 'That link is not a valid URL';
    }
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_resources')
    .update({
      title,
      kind,
      url,
      blurb,
      body_md: bodyMd,
      attribution_label: attribution,
      host: detectHost(url),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  return error ? error.message : null;
}

export async function saveResourceAction(formData: FormData): Promise<void> {
  await guard();
  const tab = String(formData.get('tab') ?? 'queue');
  const err = await saveResourceFields(formData);
  if (err) fail(tab, err);
  refresh(tab, groupOf(formData));
}

export async function approveResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const err = await saveResourceFields(formData);
  if (err) fail('queue', err);
  const id = Number(formData.get('id'));
  const approveErr = await approveResource(createAdminClient(), id, reviewer);
  if (approveErr) fail('queue', approveErr);
  refresh('queue');
}

export async function declineResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('queue', 'Invalid resource id');
  const reason = String(formData.get('reason') ?? '').trim();
  const err = await declineResource(createAdminClient(), id, reviewer, reason);
  if (err) fail('queue', err);
  refresh('queue');
}

export async function archiveResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('published', 'Invalid resource id');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_resources')
    .update({
      status: 'archived',
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) fail('published', error.message);
  refresh('published', groupOf(formData));
}

/** Archived → pending: back into the queue for another look (used for both
 *  declined submissions and retired published items). */
export async function restoreResourceAction(formData: FormData): Promise<void> {
  await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('archived', 'Invalid resource id');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_resources')
    .update({ status: 'pending', decline_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) fail('archived', error.message);
  refresh('queue');
}

// ── Placements ─────────────────────────────────────────────────────────────

export async function addPlacementAction(formData: FormData): Promise<void> {
  await guard();
  const tab = String(formData.get('tab') ?? 'queue');
  const resourceId = Number(formData.get('resource_id'));
  const target = String(formData.get('target') ?? '');
  const sep = target.indexOf(':');
  const kind = sep > 0 ? target.slice(0, sep) : '';
  const key = sep > 0 ? target.slice(sep + 1) : '';
  if (!Number.isFinite(resourceId) || resourceId <= 0 || !TARGET_KINDS.has(kind) || !key) {
    fail(tab, 'Pick a shelf or requirement to place this on');
  }
  const supabase = createAdminClient();
  // Idempotent — re-adding an existing placement is a no-op, not an error.
  const { error } = await supabase
    .from('library_placements')
    .upsert(
      { resource_id: resourceId, target_kind: kind as LibraryTargetKind, target_key: key },
      { onConflict: 'resource_id,target_kind,target_key', ignoreDuplicates: true }
    );
  if (error) fail(tab, error.message);
  refresh(tab, groupOf(formData));
}

export async function removePlacementAction(formData: FormData): Promise<void> {
  await guard();
  const tab = String(formData.get('tab') ?? 'queue');
  const id = Number(formData.get('placement_id'));
  if (!Number.isFinite(id) || id <= 0) fail(tab, 'Invalid placement');
  const supabase = createAdminClient();
  const { error } = await supabase.from('library_placements').delete().eq('id', id);
  if (error) fail(tab, error.message);
  refresh(tab, groupOf(formData));
}

export async function togglePinAction(formData: FormData): Promise<void> {
  await guard();
  const tab = String(formData.get('tab') ?? 'published');
  const id = Number(formData.get('placement_id'));
  const pinned = String(formData.get('pinned')) === 'true';
  if (!Number.isFinite(id) || id <= 0) fail(tab, 'Invalid placement');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_placements')
    .update({ pinned: !pinned })
    .eq('id', id);
  if (error) fail(tab, error.message);
  refresh(tab, groupOf(formData));
}

// ── Topics ─────────────────────────────────────────────────────────────────

export async function createTopicAction(formData: FormData): Promise<void> {
  await guard();
  const title = String(formData.get('title') ?? '').trim();
  if (!title) fail('topics', 'Topic title is required');
  const icon = String(formData.get('icon') ?? '').trim() || null;
  const blurb = String(formData.get('blurb') ?? '').trim() || null;
  const sortOrder = Number(formData.get('sort_order')) || 0;
  const supabase = createAdminClient();
  const { error } = await supabase.from('library_topics').insert({
    slug: slugify(title),
    title,
    icon,
    blurb_md: blurb,
    sort_order: sortOrder
  });
  if (error) fail('topics', error.message);
  refresh('topics');
}

/** Renames title/blurb/icon/sort — deliberately NOT the slug: placements key
 *  on the slug, and stable URLs beat pretty ones for a shelf people bookmark. */
export async function updateTopicAction(formData: FormData): Promise<void> {
  await guard();
  const id = Number(formData.get('id'));
  const title = String(formData.get('title') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0 || !title) fail('topics', 'Topic title is required');
  const icon = String(formData.get('icon') ?? '').trim() || null;
  const blurb = String(formData.get('blurb') ?? '').trim() || null;
  const sortOrder = Number(formData.get('sort_order')) || 0;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_topics')
    .update({ title, icon, blurb_md: blurb, sort_order: sortOrder })
    .eq('id', id);
  if (error) fail('topics', error.message);
  refresh('topics');
}

export async function toggleTopicRetiredAction(formData: FormData): Promise<void> {
  await guard();
  const id = Number(formData.get('id'));
  const retired = String(formData.get('retired')) === 'true';
  if (!Number.isFinite(id) || id <= 0) fail('topics', 'Invalid topic');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('library_topics')
    .update({ retired_at: retired ? null : new Date().toISOString() })
    .eq('id', id);
  if (error) fail('topics', error.message);
  refresh('topics');
}

// ── Narratives ─────────────────────────────────────────────────────────────

export async function saveNarrativeAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const target = String(formData.get('target') ?? '');
  const sep = target.indexOf(':');
  const kind = sep > 0 ? target.slice(0, sep) : '';
  const key = sep > 0 ? target.slice(sep + 1) : '';
  if (!NOTE_KINDS.has(kind) || !key) fail('narratives', 'Pick a requirement or badge first');
  const narrative = String(formData.get('narrative_md') ?? '').trim();

  const supabase = createAdminClient();
  if (!narrative) {
    // Empty save = remove the narrative; the page simply shows none.
    const { error } = await supabase
      .from('requirement_notes')
      .delete()
      .eq('target_kind', kind)
      .eq('target_key', key);
    if (error) fail('narratives', error.message);
  } else {
    const { error } = await supabase.from('requirement_notes').upsert(
      {
        target_kind: kind,
        target_key: key,
        narrative_md: narrative,
        updated_by: reviewer,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'target_kind,target_key' }
    );
    if (error) fail('narratives', error.message);
  }
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?tab=narratives&target=${encodeURIComponent(target)}&saved=1`);
}
