'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { recordAudit } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveArticleSlug, resolveByline } from '@/lib/article-slug';
import { slugify } from '@/lib/slugify';
import { publishedAtFromDate, resolveAuthorRole } from '@/lib/article-publish';
import type { Article, ArticleStatus, AuthorRole } from '@/lib/supabase/types';

function revalidateNews() {
  revalidatePath('/admin/news/articles');
  revalidatePath('/');
  revalidatePath('/news');
  revalidatePath('/events');
}

interface ArticleFields {
  title: string;
  excerpt: string;
  /** Homepage curation — applied only when the session is a leader. */
  featured: boolean;
  body: string;
  heroMediaId: number | null;
  autoArchiveAt: string | null;
  /** Explicit URL slug; blank means "derive it" (lib/article-slug rules). */
  slug: string;
  /** Explicit byline; blank means "leave the existing author alone". */
  authorName: string;
  /** Category labels from the ONE taxonomy (calendar_categories). */
  categories: string[];
  /** "Published on" picker, 'YYYY-MM-DD'; blank means "leave it alone". */
  publishedOn: string;
  /** Byline role; '' means "keep the current one". */
  authorRole: string;
}

function parseFields(formData: FormData): ArticleFields {
  const heroMediaIdRaw = formData.get('heroMediaId');
  let categories: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get('categories') ?? '[]'));
    if (Array.isArray(parsed)) categories = parsed.map((c) => String(c).trim()).filter(Boolean);
  } catch {
    categories = [];
  }
  return {
    title: String(formData.get('title') ?? '').trim(),
    excerpt: String(formData.get('excerpt') ?? '').trim(),
    body: String(formData.get('body') ?? ''),
    heroMediaId: heroMediaIdRaw ? Number(heroMediaIdRaw) : null,
    autoArchiveAt: String(formData.get('autoArchiveAt') ?? '').trim() || null,
    featured: String(formData.get('featured') ?? '') === '1',
    slug: String(formData.get('slug') ?? '').trim(),
    authorName: String(formData.get('authorName') ?? '').trim(),
    categories,
    publishedOn: String(formData.get('publishedOn') ?? '').trim(),
    authorRole: String(formData.get('authorRole') ?? '').trim()
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

/** Replace the article's categories (ONE taxonomy, 2026-08-21). Unknown
 *  labels are refused by the FK, which is the right failure: the list is
 *  governed under Lookups & Admin, not here. */
async function setCategories(
  supabase: ReturnType<typeof createAdminClient>,
  articleId: number,
  labels: string[]
): Promise<string | null> {
  await supabase.from('article_categories').delete().eq('article_id', articleId);
  if (labels.length > 0) {
    const { error } = await supabase
      .from('article_categories')
      .insert([...new Set(labels)].map((category_label) => ({ article_id: articleId, category_label })));
    if (error) return error.message;
  }
  return null;
}

interface ActionResult {
  ok: boolean;
  error?: string;
  id?: number;
}

/** Creates a draft. Any logged-in session (scout or leader) may author one. */
export async function createArticle(formData: FormData): Promise<ActionResult> {
  const session = await requireCapability('news.write');
  const fields = parseFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const slug = await uniqueSlug(supabase, fields.title);

  const { data, error } = await supabase
    .from('articles')
    .insert({
      slug,
      title: fields.title,
      // The editor no longer has a Type select (2026-08-09) — every new post
      // is news; tags carry the sorting.
      type: 'news',
      excerpt: fields.excerpt || null,
      body: fields.body,
      hero_media_id: fields.heroMediaId,
      featured: fields.featured,
      status: 'draft',
      author_name: resolveByline(fields.authorName, session.label),
      author_role: resolveAuthorRole(fields.authorRole, 'leader'),
      // A backdated draft keeps its date through Publish (publishArticle only
      // stamps now() when nothing is set).
      published_at: publishedAtFromDate(fields.publishedOn, null),
      auto_archive_at: fields.autoArchiveAt
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  await setCategories(supabase, data.id, fields.categories);
  await recordAudit({
    area: 'news',
    action: 'create',
    entityType: 'article',
    entityId: data.id,
    summary: `Created draft "${fields.title}"`
  });
  revalidateNews();
  return { ok: true, id: data.id };
}

/**
 * Copies a post, prefixing its title with "(Clone) ".
 *
 * The Calendar's Clone is the primary way entries get created there, and News
 * had no equivalent — starting a similar post meant retyping it. Same idea,
 * smaller job: a post has one layer (its body) plus tags, and no dates hanging
 * off it to shift.
 *
 * What deliberately does NOT come across:
 *   * `status` — the copy is a DRAFT. Cloning a published post and having the
 *     copy go live under a near-identical title is the one genuinely bad
 *     outcome here.
 *   * `featured` / `featured_order` — homepage curation is a decision about one
 *     post, not a property to duplicate.
 *   * `published_at`, `archived_at`, `archived_by` — history belongs to the
 *     original.
 *   * `slug` — regenerated from the new title, and uniqueness-checked, because
 *     it is the public URL.
 *
 * Authorship goes to whoever made the copy, matching the Calendar's clone.
 */
export async function cloneArticle(id: number): Promise<ActionResult> {
  const session = await requireCapability('news.write');
  const supabase = createAdminClient();

  const { data: source, error: fetchError } = await supabase
    .from('articles')
    .select('*, article_categories(category_label)')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!source) return { ok: false, error: 'That post no longer exists.' };

  const src = source as Article & { article_categories: { category_label: string }[] };

  const title = `(Clone) ${src.title}`;
  const slug = await uniqueSlug(supabase, title);

  const { data: created, error } = await supabase
    .from('articles')
    .insert({
      slug,
      title,
      type: src.type,
      excerpt: src.excerpt,
      body: src.body,
      hero_media_id: src.hero_media_id,
      auto_archive_at: src.auto_archive_at,
      status: 'draft',
      featured: false,
      author_name: session.label,
      author_role: 'leader'
    })
    .select('id')
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? 'Copy failed.' };

  await setCategories(
    supabase,
    created.id,
    (src.article_categories ?? []).map((c) => c.category_label)
  );
  await recordAudit({
    area: 'news',
    action: 'clone',
    entityType: 'article',
    entityId: created.id,
    summary: `Cloned "${src.title}" as "${title}"`
  });
  revalidateNews();
  return { ok: true, id: created.id };
}

/**
 * Updates an article's content. Scouts may only update their OWN articles,
 * and this action never touches `status` — publishing is a separate,
 * leader-only action (see publishArticle).
 */
export async function updateArticle(id: number, formData: FormData): Promise<ActionResult> {
  await requireCapability('news.write');
  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from('articles')
    .select('author_name, author_role, slug, status, published_at')
    .eq('id', id)
    .single();
  if (fetchError || !existing) return { ok: false, error: 'Article not found.' };
  const current = existing as {
    author_name: string;
    author_role: AuthorRole;
    slug: string;
    status: ArticleStatus;
    published_at: string | null;
  };
  const fields = parseFields(formData);
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  /*
   * The slug no longer follows the title once a post is live (2026-08-22).
   * It used to, on every save — so fixing a headline typo silently moved the
   * public URL and 404'd every link already shared. Rules in lib/article-slug.
   */
  const desiredSlug = resolveArticleSlug({
    title: fields.title,
    manualSlug: fields.slug,
    currentSlug: current.slug,
    status: current.status
  });
  const slug =
    desiredSlug === current.slug ? current.slug : await uniqueSlug(supabase, desiredSlug, id);

  const { error } = await supabase
    .from('articles')
    .update({
      slug,
      title: fields.title,
      excerpt: fields.excerpt || null,
      body: fields.body,
      hero_media_id: fields.heroMediaId,
      auto_archive_at: fields.autoArchiveAt,
      featured: fields.featured,
      // Editable byline: a post written by a scout or another leader gets
      // credited to them. Blank means "leave it alone", never anonymous.
      author_name: resolveByline(fields.authorName, current.author_name),
      author_role: resolveAuthorRole(fields.authorRole, current.author_role),
      // Backdating (2026-08-24): the picker can move a post's date; blank or
      // the same day leaves the stored instant exactly as it was.
      published_at: publishedAtFromDate(fields.publishedOn, current.published_at) ?? current.published_at,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await setCategories(supabase, id, fields.categories);
  await recordAudit({
    area: 'news',
    action: 'update',
    entityType: 'article',
    entityId: id,
    summary: `Updated article "${fields.title}"`
  });
  revalidateNews();
  revalidatePath(`/news/${slug}`);
  // A deliberate slug change leaves the old path cached — flush it so the
  // stale copy stops serving under a URL that no longer belongs to it.
  if (slug !== current.slug) revalidatePath(`/news/${current.slug}`);
  return { ok: true, id };
}

/** Leader-only: publishes a draft. Sets published_at on first publish. */
export async function publishArticle(id: number): Promise<ActionResult> {
  await requireCapability('news.write');
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
  await recordAudit({
    area: 'news',
    action: 'publish',
    entityType: 'article',
    entityId: id,
    summary: `Published article #${id}`
  });
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
  const session = await requireCapability('news.write');
  const result = await setArchived(id, session.label);
  if (result.ok) {
    await recordAudit({
      area: 'news',
      action: 'archive',
      entityType: 'article',
      entityId: id,
      summary: `Archived article #${id}`
    });
  }
  return result;
}

export async function unarchiveArticle(id: number): Promise<ActionResult> {
  await requireCapability('news.write');
  const result = await setArchived(id, null);
  if (result.ok) {
    await recordAudit({
      area: 'news',
      action: 'unarchive',
      entityType: 'article',
      entityId: id,
      summary: `Unarchived article #${id}`
    });
  }
  return result;
}

export async function deleteArticle(id: number): Promise<ActionResult> {
  await requireCapability('news.write');
  const supabase = createAdminClient();
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'news',
    action: 'delete',
    entityType: 'article',
    entityId: id,
    summary: `Deleted article #${id}`
  });
  revalidateNews();
  return { ok: true };
}

/** Leader-only: pin/unpin an article and set its manual order among pinned articles. */
export async function setFeatured(id: number, featured: boolean, order: number | null): Promise<ActionResult> {
  await requireCapability('news.write');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('articles')
    .update({ featured, featured_order: featured ? order : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'news',
    action: 'feature',
    entityType: 'article',
    entityId: id,
    summary: featured ? `Featured article #${id}` : `Unfeatured article #${id}`
  });
  revalidateNews();
  return { ok: true };
}

export interface ArticleWithTags extends Article {
  /** Category labels (ONE taxonomy) — kept under the old name so the list
   *  page's types don't churn. */
  tags: { id: number; name: string }[];
}

/**
 * FRONT-PAGE ORDER (Patrick, 2026-08-21: "We clearly need a way to change the
 * display order of news on the home page… drag and drop… ideal"). The list is
 * the featured set — articles AND promoted calendar entries — in display
 * order. Everything listed becomes featured with featured_order = position;
 * anything previously featured but not listed is un-featured. The home page
 * reads this through feed-logic orderFrontPage.
 */
export async function saveFrontPageOrder(
  items: { kind: 'article' | 'event'; id: number }[]
): Promise<ActionResult> {
  await requireCapability('news.write');
  const supabase = createAdminClient();
  const articleIds = items.filter((i) => i.kind === 'article').map((i) => i.id);
  const entryIds = items.filter((i) => i.kind === 'event').map((i) => i.id);

  // Un-feature what dropped out of the list.
  const clearA = supabase
    .from('articles')
    .update({ featured: false, featured_order: null })
    .eq('featured', true);
  const clearE = supabase
    .from('calendar_entries')
    .update({ featured: false, featured_order: null })
    .eq('featured', true);
  const [ra, re] = await Promise.all([
    articleIds.length ? clearA.not('id', 'in', `(${articleIds.join(',')})`) : clearA,
    entryIds.length ? clearE.not('id', 'in', `(${entryIds.join(',')})`) : clearE
  ]);
  if (ra.error) return { ok: false, error: ra.error.message };
  if (re.error) return { ok: false, error: re.error.message };

  // Write positions (1-based, across both kinds).
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const table = it.kind === 'article' ? 'articles' : 'calendar_entries';
    const { error } = await supabase
      .from(table)
      .update({ featured: true, featured_order: i + 1 })
      .eq('id', it.id);
    if (error) return { ok: false, error: error.message };
  }
  await recordAudit({
    area: 'news',
    action: 'reorder',
    entityType: 'article',
    entityId: null,
    summary: `Reordered front page (${items.length} item${items.length === 1 ? '' : 's'})`
  });
  revalidateNews();
  revalidatePath('/');
  return { ok: true };
}
