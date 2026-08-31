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
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
  approveResource,
  approveSubmission,
  createResource,
  declineResource,
  returnSubmission
} from '@/lib/library-data';
import { detectHost, type LibraryTargetKind, type ResourceKind } from '@/lib/library';
import { DOCUMENT_UPLOAD_TYPES, checkUpload } from '@/lib/upload-limits';
import { uploadToBunny } from '@/lib/bunny-storage';
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
  const session = await requireCapability('library.moderate');
  return session.label;
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
  const id = Number(formData.get('id'));
  const title = String(formData.get('title') ?? '').trim();
  await recordAudit({ area: 'library', action: 'update', entityType: 'resource', entityId: id, summary: `Updated "${title}"` });
  refresh(tab, groupOf(formData));
}

export async function approveResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const err = await saveResourceFields(formData);
  if (err) fail('queue', err);
  const id = Number(formData.get('id'));
  const approveErr = await approveResource(createAdminClient(), id, reviewer);
  if (approveErr) fail('queue', approveErr);
  const title = String(formData.get('title') ?? '').trim();
  await recordAudit({ area: 'library', action: 'approve', entityType: 'resource', entityId: id, summary: `Approved "${title}"` });
  refresh('queue');
}

export async function declineResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('queue', 'Invalid resource id');
  const reason = String(formData.get('reason') ?? '').trim();
  const err = await declineResource(createAdminClient(), id, reviewer, reason);
  if (err) fail('queue', err);
  await recordAudit({
    area: 'library',
    action: 'decline',
    entityType: 'resource',
    entityId: id,
    summary: reason ? `Declined resource #${id}: ${reason}` : `Declined resource #${id}`
  });
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
  await recordAudit({ area: 'library', action: 'archive', entityType: 'resource', entityId: id, summary: `Archived resource #${id}` });
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
  await recordAudit({ area: 'library', action: 'restore', entityType: 'resource', entityId: id, summary: `Restored resource #${id} to the queue` });
  refresh('queue');
}

// ── Proof-of-completion submissions (Phase 2) ───────────────────────────────

/** Writes the ledger row (same dup-blocked path Fast Entry uses, D-041) and
 *  marks the submission approved. Blocked, not silent, if the scout already
 *  has this exact requirement — the error surfaces on the Proof Queue tab so
 *  the leader can Return it instead. */
export async function approveSubmissionAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('proof', 'Invalid submission id');
  const { error } = await approveSubmission(createAdminClient(), id, reviewer);
  if (error) fail('proof', error);
  await recordAudit({ area: 'library', action: 'approve', entityType: 'submission', entityId: id, summary: `Approved submission #${id}` });
  revalidatePath(ADMIN_PATH);
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/dashboard');
  redirect(`${ADMIN_PATH}?tab=proof`);
}

/** Returns a submission with feedback for the household — the ledger is
 *  never touched. */
export async function returnSubmissionAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) fail('proof', 'Invalid submission id');
  const feedback = String(formData.get('feedback_md') ?? '').trim();
  const err = await returnSubmission(createAdminClient(), id, reviewer, feedback);
  if (err) fail('proof', err);
  await recordAudit({
    area: 'library',
    action: 'return',
    entityType: 'submission',
    entityId: id,
    summary: feedback ? `Returned submission #${id} with feedback` : `Returned submission #${id}`
  });
  refresh('proof');
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
  await recordAudit({
    area: 'library',
    action: 'place',
    entityType: 'placement',
    entityId: resourceId,
    summary: `Placed resource #${resourceId} on ${kind}:${key}`
  });
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
  await recordAudit({ area: 'library', action: 'unplace', entityType: 'placement', entityId: id, summary: `Removed placement #${id}` });
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
  await recordAudit({
    area: 'library',
    action: pinned ? 'unpin' : 'pin',
    entityType: 'placement',
    entityId: id,
    summary: pinned ? `Unpinned placement #${id}` : `Pinned placement #${id}`
  });
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
  const { data: created, error } = await supabase
    .from('library_topics')
    .insert({
      slug: slugify(title),
      title,
      icon,
      blurb_md: blurb,
      sort_order: sortOrder
    })
    .select('id')
    .single();
  if (error) fail('topics', error.message);
  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'topic',
    entityId: created?.id ?? null,
    summary: `Created topic "${title}"`
  });
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
  await recordAudit({ area: 'library', action: 'update', entityType: 'topic', entityId: id, summary: `Updated topic "${title}"` });
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
  await recordAudit({
    area: 'library',
    action: retired ? 'restore' : 'archive',
    entityType: 'topic',
    entityId: id,
    summary: retired ? `Un-retired topic #${id}` : `Retired topic #${id}`
  });
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
    await recordAudit({ area: 'library', action: 'delete', entityType: 'narrative', entityId: target, summary: `Removed narrative for ${target}` });
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
    await recordAudit({ area: 'library', action: 'update', entityType: 'narrative', entityId: target, summary: `Updated narrative for ${target}` });
  }
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?tab=narratives&target=${encodeURIComponent(target)}&saved=1`);
}

// ── Admin resource entry (Plans/Library-Admin-Resource-Entry.md) ───────────
//
// Until this landed, a library_resources row could only be born on the PUBLIC
// submit form or the sparkler import script, so stocking the library meant
// submitting as a family and approving your own submission — and post,
// document and image kinds were unreachable entirely.

/** Parses the repeated `placement` fields ('kind:key') the entry form sends. */
function readPlacements(formData: FormData): { targetKind: LibraryTargetKind; targetKey: string }[] {
  const out: { targetKind: LibraryTargetKind; targetKey: string }[] = [];
  const seen = new Set<string>();
  for (const raw of formData.getAll('placement')) {
    const value = String(raw).trim();
    const sep = value.indexOf(':');
    if (sep <= 0) continue;
    const kind = value.slice(0, sep);
    const key = value.slice(sep + 1);
    if (!TARGET_KINDS.has(kind) || !key) continue;
    // The unique index on (resource_id, target_kind, target_key) would reject
    // the whole insert on a repeat; dedupe here so picking the same shelf
    // twice is a no-op rather than an error.
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ targetKind: kind as LibraryTargetKind, targetKey: key });
  }
  return out;
}

/**
 * Creates a resource from the Add Resource form. Publishes immediately unless
 * the draft button was used (Patrick, 2026-08-12) — the queue is for reviewing
 * what families send in, not for the webmaster to approve their own entry.
 */
export async function createResourceAction(formData: FormData): Promise<void> {
  const reviewer = await guard();
  const kindRaw = String(formData.get('kind') ?? 'link');
  const kind: ResourceKind = RESOURCE_KINDS.has(kindRaw) ? (kindRaw as ResourceKind) : 'link';
  const publish = String(formData.get('intent') ?? 'publish') !== 'draft';
  const visibilityRaw = String(formData.get('visibility') ?? 'public');
  const visibility = visibilityRaw === 'leaders' ? 'leaders' : 'public';

  const title = String(formData.get('title') ?? '').trim();
  const { error, id } = await createResource(
    createAdminClient(),
    {
      title,
      kind,
      url: String(formData.get('url') ?? '') || null,
      bodyMd: String(formData.get('body_md') ?? '') || null,
      blurb: String(formData.get('blurb') ?? '') || null,
      thumbnailUrl: String(formData.get('thumbnail_url') ?? '') || null,
      attributionLabel: String(formData.get('attribution_label') ?? '') || null,
      visibility,
      publish,
      placements: readPlacements(formData)
    },
    reviewer
  );
  if (error) fail('add', error);

  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'resource',
    entityId: id ?? null,
    summary: publish ? `Created and published "${title}"` : `Saved draft "${title}"`
  });

  // Land on the tab where the new row now lives, so it's visible straight away.
  refresh(publish ? 'published' : 'queue');
}

/**
 * Uploads a PDF for a document resource and returns its CDN URL for the form
 * to place in the url field.
 *
 * No `media` row on purpose: a PDF there would surface in the image picker
 * News, photo albums and hero selection share, where every row is assumed to
 * be a displayable image. The library resource IS this file's index record.
 */
export async function uploadResourceDocument(
  formData: FormData
): Promise<{ ok: boolean; error?: string; url?: string; filename?: string }> {
  await guard();
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file provided.' };
  const problem = checkUpload(file, DOCUMENT_UPLOAD_TYPES);
  if (problem) return { ok: false, error: problem };

  const uploaded = await uploadToBunny(file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  await recordAudit({
    area: 'library',
    action: 'upload',
    entityType: 'resource_document',
    entityId: null,
    summary: `Uploaded document "${file.name}"`
  });
  return { ok: true, url: uploaded.cdnUrl, filename: file.name };
}
