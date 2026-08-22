import { describe, it, expect } from 'vitest';
import { resolveArticleSlug, isSlugFrozen, resolveByline } from '../src/lib/article-slug';

/**
 * Article slug and byline rules (Patrick, 2026-08-22).
 *
 * THE BUG THIS FIXES: updateArticle regenerated the slug from the title on
 * EVERY save. Editing the title of a published post silently changed its
 * public URL — any link already shared in the Bugle or a text message started
 * 404ing, and since v1.74.0 the sitemap actively advertises those URLs to
 * Google. Nobody was warned, because nothing in the UI mentioned slugs.
 *
 * The rule now: a draft's slug follows its title (nothing is linked yet), and
 * publishing FREEZES it. Changing a live URL becomes a deliberate act via the
 * slug field rather than a side effect of fixing a typo in a headline.
 */

describe('article slug — freezing on publish (pure)', () => {
  it('IsSlugFrozen_IsFalseForADraft_AndTrueOncePublished', () => {
    expect(isSlugFrozen('draft')).toBe(false);
    expect(isSlugFrozen('pending')).toBe(false);
    expect(isSlugFrozen('published')).toBe(true);
  });

  it('ResolveArticleSlug_FollowsTheTitle_WhileTheArticleIsADraft', () => {
    expect(
      resolveArticleSlug({ title: 'Summer Camp Recap', manualSlug: '', currentSlug: 'old-title', status: 'draft' })
    ).toBe('summer-camp-recap');
  });

  it('ResolveArticleSlug_KeepsTheLiveUrl_WhenAPublishedTitleIsEdited', () => {
    // The whole point: fixing a headline typo must not move the page.
    expect(
      resolveArticleSlug({
        title: 'Summer Camp Recap (corrected)',
        manualSlug: '',
        currentSlug: 'summer-camp-recap',
        status: 'published'
      })
    ).toBe('summer-camp-recap');
  });

  it('ResolveArticleSlug_HonoursAnExplicitSlug_EvenWhenPublished', () => {
    // Changing a live URL stays possible — it just has to be asked for.
    expect(
      resolveArticleSlug({
        title: 'Summer Camp Recap',
        manualSlug: 'camp-2026',
        currentSlug: 'summer-camp-recap',
        status: 'published'
      })
    ).toBe('camp-2026');
  });

  it('ResolveArticleSlug_NormalizesAnExplicitSlug_RatherThanTrustingIt', () => {
    // A leader typing "Camp 2026!" into a URL field means camp-2026.
    expect(
      resolveArticleSlug({ title: 'x', manualSlug: '  Camp 2026! ', currentSlug: 'a', status: 'published' })
    ).toBe('camp-2026');
  });

  it('ResolveArticleSlug_FallsBackToTheTitle_WhenThereIsNoCurrentSlugYet', () => {
    expect(
      resolveArticleSlug({ title: 'Brand New Post', manualSlug: '', currentSlug: '', status: 'published' })
    ).toBe('brand-new-post');
  });

  it('ResolveArticleSlug_IgnoresABlankManualSlug_RatherThanEmptyingTheUrl', () => {
    expect(
      resolveArticleSlug({ title: 'A Title', manualSlug: '   ', currentSlug: 'kept', status: 'published' })
    ).toBe('kept');
  });

  it('ResolveArticleSlug_NeverReturnsAnEmptyString', () => {
    // slugify() floors at 'item'; an empty slug would be an unroutable page.
    expect(
      resolveArticleSlug({ title: '!!!', manualSlug: '', currentSlug: '', status: 'draft' }).length
    ).toBeGreaterThan(0);
  });
});

describe('article byline — editable author (pure)', () => {
  it('ResolveByline_UsesTheTypedName_WhenOneIsGiven', () => {
    // Patrick, 2026-08-22: a post written by a scout or another leader should
    // be credited to them, not to whoever clicked New.
    expect(resolveByline('Ben Kowalski', 'Patrick Bieser')).toBe('Ben Kowalski');
  });

  it('ResolveByline_KeepsTheExistingAuthor_WhenTheFieldIsCleared', () => {
    // Blanking the field must not publish an anonymous post.
    expect(resolveByline('', 'Patrick Bieser')).toBe('Patrick Bieser');
    expect(resolveByline('   ', 'Patrick Bieser')).toBe('Patrick Bieser');
  });

  it('ResolveByline_TrimsWhatItStores', () => {
    expect(resolveByline('  Mindy Stollenwerk  ', 'x')).toBe('Mindy Stollenwerk');
  });

  it('ResolveByline_CapsRunawayInput', () => {
    expect(resolveByline('n'.repeat(300), 'x').length).toBe(120);
  });
});
