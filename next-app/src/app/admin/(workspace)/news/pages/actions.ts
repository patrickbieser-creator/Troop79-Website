'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { recordAudit } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/slugify';
import { childPath, isReservedTopLevelSlug, siblingSwap } from '@/lib/site-pages-tree';
import { diffSitePage, type PageEditFields } from '@/lib/site-pages-diff';

/**
 * Pages admin (Plans/Content-Managed-Pages.md). Gate: `news.write` — anyone who can write news can edit pages
 * (Patrick, 2026-10-11: no new capability). Writes are service-role (the table has RLS on and no policies).
 *
 * Cache: the public pages read through `unstable_cache` under the `site-pages` tag, so every write that can
 * change what a visitor sees expires the TAG (the data read) and the page's own PATH (the rendered ISR page) —
 * the lookups/actions.ts pattern. A published page's Save goes live; `status` only gates NEW pages.
 */

export interface PageResult {
  ok: boolean;
  error?: string;
  id?: number;
}

const ADMIN_LIST = '/admin/news/pages';

function expire(path: string) {
  updateTag('site-pages');
  revalidatePath(path);
  revalidatePath(ADMIN_LIST);
}

/** A new page: a draft under `parentId` (null = top level), its address made from the title. */
export async function createPage(input: { title: string; parentId: number | null }): Promise<PageResult> {
  const session = await requireCapability('news.write');
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'A title is required.' };

  const supabase = createAdminClient();
  let parentPath: string | null = null;
  if (input.parentId !== null) {
    const { data: parent } = await supabase.from('site_pages').select('path').eq('id', input.parentId).maybeSingle();
    if (!parent) return { ok: false, error: 'That parent page no longer exists.' };
    parentPath = parent.path;
  }

  const base = slugify(title);
  if (parentPath === null && isReservedTopLevelSlug(base)) {
    return { ok: false, error: `"${base}" is already an address on the site — pick a different title or put the page under another page.` };
  }

  // Unique address: the title's slug, bumped (-2, -3…) when a sibling already has it.
  let slug = base;
  for (let n = 2; ; n += 1) {
    const { data: clash } = await supabase.from('site_pages').select('id').eq('path', childPath(parentPath, slug)).maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }
  if (parentPath === null && isReservedTopLevelSlug(slug)) return { ok: false, error: `"${slug}" is already an address on the site.` };

  // Last among its siblings.
  let sib = supabase.from('site_pages').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  sib = input.parentId === null ? sib.is('parent_id', null) : sib.eq('parent_id', input.parentId);
  const { data: last } = await sib.maybeSingle();

  const path = childPath(parentPath, slug);
  const { data, error } = await supabase
    .from('site_pages')
    .insert({
      parent_id: input.parentId,
      slug,
      path,
      title,
      status: 'draft',
      sort_order: (last?.sort_order ?? 0) + 10,
      updated_by: session.label
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create the page.' };

  await recordAudit({
    area: 'pages',
    action: 'create',
    entityType: 'site_page',
    entityId: data.id,
    summary: `Created draft page "${title}" at ${path}`
  });
  revalidatePath(ADMIN_LIST);
  return { ok: true, id: data.id };
}

/** Saves the editor's draft. A published page goes live with it; the address (slug/path) never changes here. */
export async function savePage(id: number, fields: PageEditFields): Promise<PageResult> {
  const session = await requireCapability('news.write');
  const title = fields.title.trim();
  if (!title) return { ok: false, error: 'A title is required.' };

  const supabase = createAdminClient();
  const { data: was } = await supabase
    .from('site_pages')
    .select('path, title, headline, lede, body_md, sidebar_md, meta_description')
    .eq('id', id)
    .maybeSingle();
  if (!was) return { ok: false, error: 'That page no longer exists.' };

  const next: PageEditFields = { ...fields, title };
  const { error } = await supabase
    .from('site_pages')
    .update({
      title,
      headline: next.headline,
      lede: next.lede,
      body_md: next.bodyMd,
      sidebar_md: next.sidebarMd,
      meta_description: next.metaDescription,
      updated_at: new Date().toISOString(),
      updated_by: session.label
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  const details = diffSitePage(was, next);
  await recordAudit({
    area: 'pages',
    action: 'update',
    entityType: 'site_page',
    entityId: id,
    summary: `Updated page "${title}" (${was.path}) — ${details.map((d) => d.field).join(', ') || 'no field changed'}`,
    details
  });
  expire(was.path);
  return { ok: true, id };
}

async function setStatus(id: number, status: 'draft' | 'published'): Promise<PageResult> {
  const session = await requireCapability('news.write');
  const supabase = createAdminClient();
  const { data: row } = await supabase.from('site_pages').select('path, title, status').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: 'That page no longer exists.' };
  if (row.status === status) return { ok: true, id };

  const { error } = await supabase
    .from('site_pages')
    .update({ status, updated_at: new Date().toISOString(), updated_by: session.label })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    area: 'pages',
    action: status === 'published' ? 'publish' : 'unpublish',
    entityType: 'site_page',
    entityId: id,
    summary: `${status === 'published' ? 'Published' : 'Took offline'} page "${row.title}" (${row.path})`,
    details: [{ field: 'Status', from: row.status, to: status }]
  });
  expire(row.path);
  return { ok: true, id };
}

export async function publishPage(id: number): Promise<PageResult> {
  return setStatus(id, 'published');
}

/** Back to draft: the page 404s for the public (leaders still preview it). */
export async function setPageStatus(id: number, status: 'draft' | 'published'): Promise<PageResult> {
  return setStatus(id, status);
}

/** Up/down among the SAME parent's children. At the end of the list it is a quiet no-op. */
export async function movePage(id: number, direction: 'up' | 'down'): Promise<PageResult> {
  const session = await requireCapability('news.write');
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase.from('site_pages').select('id, parent_id, sort_order, title');
  if (error || !rows) return { ok: false, error: error?.message ?? 'Could not read the pages.' };

  const swap = siblingSwap(rows, id, direction);
  if (!swap) return { ok: true, id };
  for (const w of swap) {
    const { error: e } = await supabase
      .from('site_pages')
      .update({ sort_order: w.sort_order, updated_at: new Date().toISOString(), updated_by: session.label })
      .eq('id', w.id);
    if (e) return { ok: false, error: e.message };
  }
  const me = rows.find((r) => r.id === id);
  await recordAudit({
    area: 'pages',
    action: 'reorder',
    entityType: 'site_page',
    entityId: id,
    summary: `Moved page "${me?.title ?? id}" ${direction}`
  });
  // Order is for the admin tree now and the phase-3 nav later; no public page changes, so the tag alone is enough.
  updateTag('site-pages');
  revalidatePath(ADMIN_LIST);
  return { ok: true, id };
}
