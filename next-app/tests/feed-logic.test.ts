import { describe, it, expect } from 'vitest';
import {
  isAutoArchivedOn,
  isPromoActive,
  mergeFeed,
  pickHero,
  orderFrontPage,
  eventCardExcerpt,
  plainSummary,
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
    featured_order: null,
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
    featured: false,
    featured_order: null,
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

describe('hero pick (first card of the front-page order — 2026-08-21)', () => {
  // The EVENT-WINS-WHILE-IN-WINDOW rule (2026-08-08) is superseded by the
  // explicit front-page order (Patrick, 2026-08-21): featured items in their
  // arranged order lead, and the hero is simply the first card. An event's
  // featured flag still counts only inside its promo window.
  it('Hero_IsTheFeaturedPromotedEvent_WhileInWindow_WhenItLeadsTheOrder', () => {
    const items = orderFrontPage(
      [article({ featured: true, featured_order: 2 })],
      [entry({ featured: true, featured_order: 1 })],
      TODAY
    );
    expect(pickHero(items)?.kind).toBe('event');
  });

  it('Hero_IsTheFeaturedArticle_WhenNoEventIsFeatured', () => {
    const items = orderFrontPage([article({ featured: true, featured_order: 1 })], [entry({ featured: false })], TODAY);
    expect(pickHero(items)?.kind).toBe('article');
  });

  it('Hero_IsTheFeaturedArticle_WhenTheFeaturedEventIsOutOfWindow', () => {
    const items = orderFrontPage(
      [article({ featured: true, featured_order: 2 })],
      [entry({ featured: true, featured_order: 1, promo_start: '2026-09-01' })],
      TODAY
    );
    expect(pickHero(items)?.kind).toBe('article');
  });

  it('Hero_IsNull_WhenTheFeedIsEmpty', () => {
    expect(pickHero(orderFrontPage([], [], TODAY))).toBeNull();
  });

  it('Hero_FollowsTheArrangedOrder_NotRecency_WhenSeveralEventsAreFeatured', () => {
    const items = orderFrontPage(
      [],
      [
        entry({ id: 1, featured: true, featured_order: 1, promo_start: '2026-08-01' }),
        entry({ id: 2, featured: true, featured_order: 2, promo_start: '2026-08-14' })
      ],
      TODAY
    );
    const hero = pickHero(items);
    expect(hero?.kind === 'event' && hero.entry.id).toBe(1);
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

/**
 * The admin description field became a textarea on 2026-08-15, so a
 * description can now be several paragraphs. Every single-line surface — the
 * homepage card, the page's meta description — leans on this collapsing
 * newlines rather than on the input being short.
 */
describe('plainSummary — one line out of many', () => {
  it('Summary_CollapsesNewlines_WhenTheDescriptionHasParagraphs', () => {
    expect(plainSummary('First line.\n\nSecond line.\nThird.')).toBe(
      'First line. Second line. Third.'
    );
  });

  it('Summary_CollapsesWindowsLineEndings_WhichIsWhatAPastedDescriptionCarries', () => {
    expect(plainSummary('One.\r\nTwo.')).toBe('One. Two.');
  });

  it('Summary_CutsAtAWordBoundary_WhenLongerThanTheLimit', () => {
    const out = plainSummary('alpha bravo charlie delta echo', 12);
    // Never mid-word, and never longer than the limit plus the ellipsis.
    expect(out).toBe('alpha bravo…');
  });

  it('Summary_KeepsShortTextWhole_WithoutAnEllipsis', () => {
    expect(plainSummary('Bring a mess kit.')).toBe('Bring a mess kit.');
  });

  it('Summary_IsNull_WhenTheTextIsAbsentOrOnlyWhitespace', () => {
    expect(plainSummary(null)).toBeNull();
    expect(plainSummary('   \n\n  ')).toBeNull();
  });

  it('Summary_IsNull_WhenMarkupStripsAwayToNothing', () => {
    // An image-only description leaves no words behind — better no summary
    // than an empty string rendered as a blank line on the card.
    expect(plainSummary('![photo](http://x/y.jpg)')).toBeNull();
  });
});
