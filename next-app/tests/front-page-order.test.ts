import { describe, it, expect } from 'vitest';
import {
  orderFrontPage,
  pickHero,
  articleCategoryLabel,
  type PromotedEntryBase,
  type FeedArticleBase
} from '../src/lib/feed-logic';

/**
 * Front-page ordering (Patrick, 2026-08-21: "We clearly need a way to change
 * the display order of news on the home page… drag and drop… #1"). The
 * curated order is the FEATURED set — articles and promoted events together —
 * ordered by featured_order; the first is the hero; everything not featured
 * follows by date, newest first. Pure; the admin panel writes the orders,
 * home-feed.ts reads them.
 */
const TODAY = new Date(2026, 7, 15);

function entry(over: Partial<PromotedEntryBase> & Record<string, unknown> = {}): PromotedEntryBase & Record<string, unknown> {
  return {
    id: 1,
    entry_date: '2026-08-29',
    end_date: null,
    description: null,
    show_on_homepage: true,
    featured: false,
    featured_order: null,
    promo_start: null,
    promo_end: null,
    excerpt: null,
    auto_archive_at: null,
    created_at: '2026-08-01T12:00:00Z',
    ...over
  };
}
function article(over: Partial<FeedArticleBase> & Record<string, unknown> = {}): FeedArticleBase & Record<string, unknown> {
  return {
    id: 10,
    published_at: '2026-08-10T12:00:00Z',
    created_at: '2026-08-10T12:00:00Z',
    featured: false,
    featured_order: null,
    ...over
  };
}

describe('orderFrontPage (pure)', () => {
  it('OrderFrontPage_PutsFeaturedItemsFirst_InFeaturedOrder_AcrossArticlesAndEvents', () => {
    const out = orderFrontPage(
      [article({ id: 10, featured: true, featured_order: 2 }), article({ id: 11, featured: false })],
      [entry({ id: 1, featured: true, featured_order: 1 }), entry({ id: 2, featured: false })],
      TODAY
    );
    expect(out.slice(0, 2).map((i) => (i.kind === 'event' ? `e${i.entry.id}` : `a${i.article.id}`))).toEqual(['e1', 'a10']);
  });

  it('OrderFrontPage_UnfeaturedItems_FollowByDateNewestFirst', () => {
    const out = orderFrontPage(
      [article({ id: 10, published_at: '2026-08-01T00:00:00Z' }), article({ id: 11, published_at: '2026-08-12T00:00:00Z' })],
      [entry({ id: 1, created_at: '2026-08-05T00:00:00Z' })],
      TODAY
    );
    expect(out.map((i) => (i.kind === 'event' ? `e${i.entry.id}` : `a${i.article.id}`))).toEqual(['a11', 'e1', 'a10']);
  });

  it('OrderFrontPage_FeaturedWithoutAnOrder_SortsAfterOrderedFeatured_ThenByDate', () => {
    const out = orderFrontPage(
      [article({ id: 10, featured: true, featured_order: null, published_at: '2026-08-12T00:00:00Z' })],
      [entry({ id: 1, featured: true, featured_order: 3 })],
      TODAY
    );
    expect(out.map((i) => (i.kind === 'event' ? `e${i.entry.id}` : `a${i.article.id}`))).toEqual(['e1', 'a10']);
  });

  it('OrderFrontPage_IgnoresAnEventFeaturedFlag_OutsideItsPromoWindow', () => {
    // A featured event whose promo window has closed is just a dated card.
    const out = orderFrontPage(
      [article({ id: 10, published_at: '2026-08-14T00:00:00Z' })],
      [entry({ id: 1, featured: true, featured_order: 1, promo_end: '2026-08-10', created_at: '2026-08-01T00:00:00Z' })],
      TODAY
    );
    expect(out[0].kind).toBe('article');
  });
});

describe('pickHero — first of the curated order', () => {
  it('PickHero_IsTheFirstOrderedFeaturedItem_EventOrArticle', () => {
    const items = orderFrontPage(
      [article({ id: 10, featured: true, featured_order: 1 })],
      [entry({ id: 1, featured: true, featured_order: 2 })],
      TODAY
    );
    const hero = pickHero(items);
    expect(hero?.kind).toBe('article');
  });

  it('PickHero_IsTheNewestCard_WhenNothingIsFeatured_AndNullOnlyWhenEmpty', () => {
    // No curation → the newest card leads, same as before; an empty feed has no hero.
    const items = orderFrontPage(
      [article({ id: 10, published_at: '2026-08-01T00:00:00Z' }), article({ id: 11, published_at: '2026-08-12T00:00:00Z' })],
      [],
      TODAY
    );
    const hero = pickHero(items);
    expect(hero?.kind === 'article' && hero.article.id).toBe(11);
    expect(pickHero([])).toBeNull();
  });
});

describe('articleCategoryLabel (pure)', () => {
  it('ArticleCategoryLabel_IsTheFirstCategory_OrNewsWhenUncategorized', () => {
    const cats = [{ label: 'Fundraiser', slug: 'fundraiser', color: '#8b6914' }];
    expect(articleCategoryLabel(cats)).toBe('Fundraiser');
    expect(articleCategoryLabel([])).toBe('News');
  });
});
