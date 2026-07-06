'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/slugify';
import type { Article, ArticleType } from '@/lib/supabase/types';

function revalidateNews() {
  revalidatePath('/admin/news/articles');
  revalidatePath('/');
  revalidatePath('/events');
}

interface ArticleFields {
  title: string;
  type: ArticleType;
  excerpt: string;
  body: string;
  heroMediaId: number | null;
  eventStart: string | null;
  eventEnd: string | null;
  eventLocation: string | null;
  eventRegistrationUrl: string | null;
  tagIds: number[];
}

function parseFields(formData: FormData): ArticleFields {
  const type = (String(formData.get('type') ?? 'news') as ArticleType) || 'news';
  const heroMediaIdRaw = formData.get('heroMediaId');
  const tagIdsRaw = String(formData.get('tagIds') ?? '');
  return {
    title: String(formData.get('title') ?? '').trim(),
    type,
    excerpt: String(formData.get('excerpt') ?? '').trim(),
    body: String(formData.get('body') ?? ''),
    heroMediaId: heroMediaIdRaw ? Number(heroMediaIdRaw) : null,
    eventStart: type === 'event' ? String(formData.get('eventStart') ?? '').trim() || null : null,
    eventEnd: type === 'event' ? String(formData.get('eventEnd') ?? '').trim() || null : null,
    eventLocation: type === 'event' ? String(formData.get('eventLocation') ?? '').trim() || null : null,
    eventRegistrationUrl:
      type === 'event' ? String(formData.get('eventRegistrationUrl') ?? '').trim() || null : null,
    tagIds: tagIdsRaw
      ? tagIdsRaw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n))
      : []
  };
}

async function uniqueSlug(supabase: ReturnType<typeof createAdminClient>, title: string, excludeId?: number) {
  const base = slugify(title);
  let candidate = base;
  let n = 1;
  for (;;) {
    let q = supabase.from('articles').select('id').eq('slug', candidate);
    if (excludeId) q = q.neq('id', excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

async function setTags(supabase: ReturnType<typeof createAdminClient>, articleId: number, tagIds: number[]) {
  await supabase.from('article_tags').delete().eq('article_id', articleId);
  if (tagIds.length > 0) {
    await supabase.from('article_tags').insert(tagIds.map((tag_id) => ({ article_id: articleId, tag_id })));
  }
}

interface ActionResult {
  ok: boolean;
  error?: string;
  id?: number;
}

/** Creates a draft. Any logged-in session (scout or leader) may author one. */
export async function createArticle(formData: FormData): Promise<ActionResult> {
  const session = await requireRole(['leader', 'scout']);
  const fields = parseFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const slug = await uniqueSlug(supabase, fields.title);

  const { data, error } = await supabase
    .from('articles')
    .insert({
      slug,
      title: fields.title,
      type: fields.type,
      excerpt: fields.excerpt || null,
      body: fields.body,
      hero_media_id: fields.heroMediaId,
      status: 'draft',
      author_name: session.leader,
      author_role: session.role,
      event_start: fields.eventStart,
      event_end: fields.eventEnd,
      event_location: fields.eventLocation,
      event_registration_url: fields.eventRegistrationUrl
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  await setTags(supabase, data.id, fields.tagIds);
  revalidateNews();
  return { ok: true, id: data.id };
}

/**
 * Updates an article's content. Scouts may only update their OWN articles,
 * and this action never touches `status` — publishing is a separate,
 * leader-only action (see publishArticle).
 */
export async function updateArticle(id: number, formData: FormData): Promise<ActionResult> {
  const session = await requireRole(['leader', 'scout']);
  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from('articles')
    .select('author_name')
    .eq('id', id)
    .single();
  if (fetchError || !existing) return { ok: false, error: 'Article not found.' };
  if (session.role === 'scout' && existing.author_name !== session.leader) {
    return { ok: false, error: 'You can only edit your own drafts.' };
  }

  const fields = parseFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };
  const slug = await uniqueSlug(supabase, fields.title, id);

  const { error } = await supabase
    .from('articles')
    .update({
      slug,
      title: fields.title,
      type: fields.type,
      excerpt: fields.excerpt || null,
      body: fields.body,
      hero_media_id: fields.heroMediaId,
      event_start: fields.eventStart,
      event_end: fields.eventEnd,
      event_location: fields.eventLocation,
      event_registration_url: fields.eventRegistrationUrl,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await setTags(supabase, id, fields.tagIds);
  revalidateNews();
  revalidatePath(`/news/${slug}`);
  return { ok: true, id };
}

/** Leader-only: publishes a draft. Sets published_at on first publish. */
export async function publishArticle(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: existing } = await supabase.from('articles').select('published_at').eq('id', id).single();
  const { error } = await supabase
    .from('articles')
    .update({
      status: 'published',
      published_at: existing?.published_at ?? new Date().toISOString()
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateNews();
  return { ok: true };
}

async function setArchived(id: number, archivedBy: string | null): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('articles')
    .update({ archived_at: archivedBy ? new Date().toISOString() : null, archived_by: archivedBy })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateNews();
  return { ok: true };
}

export async function archiveArticle(id: number): Promise<ActionResult> {
  const session = await requireRole(['leader']);
  return setArchived(id, session.leader);
}

export async function unarchiveArticle(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  return setArchived(id, null);
}

export async function deleteArticle(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateNews();
  return { ok: true };
}

/** Leader-only: pin/unpin an article and set its manual order among pinned articles. */
export async function setFeatured(id: number, featured: boolean, order: number | null): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('articles')
    .update({ featured, featured_order: featured ? order : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateNews();
  return { ok: true };
}

export interface ArticleWithTags extends Article {
  tags: { id: number; name: string }[];
}
