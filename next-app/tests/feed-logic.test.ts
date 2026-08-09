import { describe, it, expect } from 'vitest';
import {
  isAutoArchivedOn,
  isPromoActive,
  mergeFeed,
  pickHero,
  eventCardExcerpt,
  type PromotedEntryBase,
  type FeedArticleBase
} from '../src/lib/feed-logic';

/**
 * Event→News promotion (Plans/Event-News-Promotion.md — port of OMG D-011).
 * Pure feed logic; no DB. Test names ported from the OMG suite, adapted to
 * Troop 79's shapes (entry_date not specific_date; no active/is_recurring;
 * hero rule is EVENT-WINS-WHILE-IN-WINDOW per Patrick, not OMG's recency).
 */

const TODAY = new Date(2026, 7, 15); // Aug 15 2026, local

function entry(over: Partial<PromotedEntryBase> & Record<string, unknown> = {}): PromotedEntryBase & Record<string, unknown> {
  return {
    id: 1,
    entry_date: '2026-08-29',
    end_date: null,
    category: 'Fundraiser',
    title: 'Rummage Sale',
    description: null,
    show_on_homepage: true,
    featured: false,
    promo_start: null,
    promo_end: null,
    excerpt: null,
    hero_media_id: null,
    hero_media: null,
    auto_archive_at: null,
    created_at: '2026-08-01T12:00:00Z',
    ...over
  };
}

function article(over: Partial<FeedArticleBase> & Record<string, unknown> = {}): FeedArticleBase & Record<string, unknown> {
  return {
    id: 10,
    slug: 'a-story',
    title: 'A Story',
    published_at: '2026-08-10T12:00:00Z',
    created_at: '2026-08-09T12:00:00Z',
    ...over
  };
}

describe('promo window', () => {
  it('Visitor_SeesPromotedEvent_WhenTodayInsidePromoWindow', () => {
    expect(isPromoActive(entry({ promo_start: '2026-08-10', promo_end: '2026-08-29' }), TODAY)).toBe(true);
  });

  it('Visitor_DoesNotSeePromotedEvent_BeforePromoStart', () => {
    expect(isPromoActive(entry({ promo_start: '2026-08-20' }), TODAY)).toBe(false);
  });

  it('Visitor_DoesNotSeePromotedEvent_AfterEventDate_WhenPromoEndNull', () => {
    expect(isPromoActive(entry({ entry_date: '2026-08-09' }), TODAY)).toBe(false);
  });

  it('Visitor_SeesPromotedEvent_ThroughEndDate_OnMultiDayEvents', () => {
    expect(isPromoActive(entry({ entry_date: '2026-08-14', end_date: '2026-08-16' }), TODAY)).toBe(true);
  });

  it('Visitor_DoesNotSeeEvent_WhenNotOptedIn', () => {
    expect(isPromoActive(entry({ show_on_homepage: false }), TODAY)).toBe(false);
  });

  it('Visitor_DoesNotSeeEvent_WhenAutoArchiveDatePassed', () => {
    expect(isPromoActive(entry({ auto_archive_at: '2026-08-15' }), TODAY)).toBe(false);
  });
});

describe('auto-archive date', () => {
  it('IsAutoArchived_OnTheDateItself', () => {
    expect(isAutoArchivedOn('2026-08-15', TODAY)).toBe(true);
  });
  it('IsNotAutoArchived_TheDayBefore', () => {
    expect(isAutoArchivedOn('2026-08-16', TODAY)).toBe(false);
  });
  it('NullDate_NeverAutoArchives', () => {
    expect(isAutoArchivedOn(null, TODAY)).toBe(false);
  });
});

describe('feed merge', () => {
  it('Feed_SortsArticlesAndEvents_ByDateDescending', () => {
    const items = mergeFeed(
      [article({ id: 10, published_at: '2026-08-12T12:00:00Z' })],
      [entry({ id: 1, promo_start: '2026-08-14' }), entry({ id: 2, promo_start: '2026-08-01' })]
    );
    expect(items.map((i) => (i.kind === 'article' ? `a${i.article.id}` : `e${i.entry.id}`))).toEqual([
      'e1',
      'a10',
      'e2'
    ]);
  });
});

describe('hero pick (event wins while in window)', () => {
  it('Hero_IsTheFeaturedPromotedEvent_WhileInWindow', () => {
    const hero = pickHero(article(), [entry({ featured: true })], TODAY);
    expect(hero?.kind).toBe('event');
  });

  it('Hero_FallsBackToFeaturedArticle_WhenNoEventIsFeatured', () => {
    const hero = pickHero(article(), [entry({ featured: false })], TODAY);
    expect(hero?.kind).toBe('article');
  });

  it('Hero_FallsBackToFeaturedArticle_WhenFeaturedEventOutOfWindow', () => {
    const hero = pickHero(article(), [entry({ featured: true, promo_start: '2026-09-01' })], TODAY);
    expect(hero?.kind).toBe('article');
  });

  it('Hero_IsNull_WhenNothingQualifies', () => {
    expect(pickHero(null, [], TODAY)).toBeNull();
  });

  it('Hero_PicksNewestFeaturedEvent_WhenSeveralAreInWindow', () => {
    const hero = pickHero(
      null,
      [
        entry({ id: 1, featured: true, promo_start: '2026-08-01' }),
        entry({ id: 2, featured: true, promo_start: '2026-08-14' })
      ],
      TODAY
    );
    expect(hero?.kind === 'event' && hero.entry.id).toBe(2);
  });
});

describe('event card excerpt', () => {
  it('Excerpt_UsesExplicitExcerpt_WhenSet', () => {
    expect(eventCardExcerpt(entry({ excerpt: ' Bring tables. ', description: 'ignored' }))).toBe(
      'Bring tables.'
    );
  });

  it('Excerpt_FallsBackToTruncatedDescription_WhenEmpty', () => {
    const long = 'word '.repeat(60).trim();
    const out = eventCardExcerpt(entry({ description: long }));
    expect(out!.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(out!.endsWith('…')).toBe(true);
  });

  it('Excerpt_IsNull_WhenNothingToSay', () => {
    expect(eventCardExcerpt(entry({ excerpt: '  ', description: null }))).toBeNull();
  });

  it('Excerpt_StripsMarkdown_FromDescriptions', () => {
    expect(eventCardExcerpt(entry({ description: '# Big\n**sale** [link](http://x)' }))).toBe(
      'Big sale link'
    );
  });
});
