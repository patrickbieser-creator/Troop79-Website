import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadArticleBySlug } from '../src/lib/news-feed';

/**
 * "Show hero image at top of article" (Plans/Article-Image-Flexibility.md,
 * 2026-09-21). The hero keeps feeding the card thumbnail, og:image and JSON-LD
 * whether or not it is shown on the page — so the flag is a column beside
 * hero_media_id, not a reason to clear it. `articles_public` is a `select *`
 * view: Postgres freezes `*` at creation, so the migration has to recreate
 * the view or the loader never sees the column. That is what this guards.
 *
 * The Server Action that writes the flag needs a cookie this suite cannot
 * mock (D-049's boundary); the editor round-trip is browser-verified.
 */
describe('articles.show_hero', () => {
  let ids: number[] = [];

  afterEach(async () => {
    if (ids.length > 0) await adminClient().from('articles').delete().in('id', ids);
    ids = [];
  });

  async function makeArticle(extra: Record<string, unknown>) {
    const slug = `test-show-hero-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await adminClient()
      .from('articles')
      .insert({
        slug,
        title: '[TEST] Show Hero Probe',
        type: 'news',
        body: 'probe',
        status: 'published',
        published_at: new Date().toISOString(),
        featured: false,
        author_name: '[TEST] Probe Author',
        author_role: 'leader',
        ...extra
      })
      .select('id')
      .single();
    if (error) throw error;
    ids.push(data.id);
    return slug;
  }

  it('Loader_ReturnsShowHeroFalse_ThroughArticlesPublicView', async () => {
    const slug = await makeArticle({ show_hero: false });
    const article = await loadArticleBySlug(slug);
    expect(article?.show_hero).toBe(false);
  });

  it('Loader_DefaultsShowHeroTrue_ForArticlesThatNeverSetIt', async () => {
    const slug = await makeArticle({});
    const article = await loadArticleBySlug(slug);
    expect(article?.show_hero).toBe(true);
  });
});
