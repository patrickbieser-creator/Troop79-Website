import { describe, it, expect } from 'vitest';
import {
  SEO_DEFAULTS,
  SEO_KEYS,
  DEFAULT_ROBOTS_TXT,
  resolveSeo,
  seoFlagOn,
  buildRobotsTxt,
  parseSameAs,
  absoluteUrl,
  organizationJsonLd,
  websiteJsonLd,
  eventJsonLd,
  articleJsonLd,
  breadcrumbJsonLd,
  STATIC_SITEMAP_PATHS,
  NEVER_SITEMAPPED,
  buildSitemap,
  type SitemapInput
} from '../src/lib/seo';

/**
 * SEO surface (Patrick, 2026-08-22: "implement and make available editing of
 * the robots.txt and the generation of a sitemap.xml, and JSON-LD").
 *
 * Everything here is PURE — the shapes that go into /robots.txt, /sitemap.xml
 * and the <script type="application/ld+json"> blocks are computed by these
 * helpers so they can be asserted without a browser, a crawler, or the DB.
 * The route handlers are thin: load rows, call these, serialize.
 *
 * The load-bearing test in this file is the PII one. A sitemap is an ACTIVE
 * invitation to index, which is a different act from a page merely being
 * reachable — so individual-scout surfaces stay out of it by default even
 * though they are public today.
 */

const ORIGIN = 'https://www.troop-79.com';

describe('seo — settings resolution (pure)', () => {
  it('ResolveSeo_UsesStoredValue_OrDefaultWhenBlankOrMissing', () => {
    expect(resolveSeo(new Map([['seo.org_locality', 'Shorewood']]), 'seo.org_locality')).toBe('Shorewood');
    expect(resolveSeo(new Map([['seo.org_locality', '   ']]), 'seo.org_locality')).toBe(
      SEO_DEFAULTS['seo.org_locality']
    );
    expect(resolveSeo(new Map(), 'seo.org_locality')).toBe(SEO_DEFAULTS['seo.org_locality']);
  });

  it('EverySeoKey_HasADefault_AndAnEditorDefinition', () => {
    for (const def of SEO_KEYS) {
      expect(SEO_DEFAULTS[def.key], `${def.key} needs a default`).toBeTypeOf('string');
      expect(def.label.length).toBeGreaterThan(0);
    }
    // No orphan defaults — every default is reachable from the editor.
    for (const key of Object.keys(SEO_DEFAULTS)) {
      expect(SEO_KEYS.some((d) => d.key === key), `${key} is not editable`).toBe(true);
    }
  });

  it('SeoFlagOn_ReadsOnlyExplicitTruthyStrings', () => {
    expect(seoFlagOn('on')).toBe(true);
    expect(seoFlagOn('true')).toBe(true);
    expect(seoFlagOn('yes')).toBe(true);
    expect(seoFlagOn('1')).toBe(true);
    expect(seoFlagOn('off')).toBe(false);
    expect(seoFlagOn('')).toBe(false);
    expect(seoFlagOn(undefined)).toBe(false);
  });
});

describe('seo — robots.txt (pure)', () => {
  it('BuildRobotsTxt_AppendsTheSitemapLine_WhenTheBodyOmitsIt', () => {
    const out = buildRobotsTxt('User-agent: *\nAllow: /', `${ORIGIN}/sitemap.xml`);
    expect(out).toContain('User-agent: *');
    expect(out.trimEnd().endsWith(`Sitemap: ${ORIGIN}/sitemap.xml`)).toBe(true);
  });

  it('BuildRobotsTxt_DoesNotDuplicateASitemapLine_TheEditorAlreadyWrote', () => {
    const body = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml`;
    const out = buildRobotsTxt(body, `${ORIGIN}/sitemap.xml`);
    expect(out.match(/^Sitemap:/gim)?.length).toBe(1);
  });

  it('BuildRobotsTxt_KeepsACustomSitemapLine_EvenWhenItPointsElsewhere', () => {
    const body = 'User-agent: *\nSitemap: https://example.org/other.xml';
    const out = buildRobotsTxt(body, `${ORIGIN}/sitemap.xml`);
    expect(out).toContain('https://example.org/other.xml');
    expect(out.match(/^Sitemap:/gim)?.length).toBe(1);
  });

  it('BuildRobotsTxt_FallsBackToTheBuiltInBody_WhenTheStoredValueIsBlank', () => {
    const out = buildRobotsTxt('   ', `${ORIGIN}/sitemap.xml`);
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Disallow: /admin');
  });

  it('DefaultRobotsTxt_DisallowsEveryPrivateSurface', () => {
    for (const path of ['/admin', '/member', '/profile', '/signin', '/api']) {
      expect(DEFAULT_ROBOTS_TXT, `${path} must be disallowed by default`).toContain(`Disallow: ${path}`);
    }
  });

  it('BuildRobotsTxt_NormalizesLineEndings_SoAWindowsPasteDoesNotShipCRLF', () => {
    const out = buildRobotsTxt('User-agent: *\r\nAllow: /\r\n', `${ORIGIN}/sitemap.xml`);
    expect(out).not.toContain('\r');
  });
});

describe('seo — sameAs + absolute urls (pure)', () => {
  it('ParseSameAs_TakesOneUrlPerLine_TrimmingBlanksAndJunk', () => {
    const raw = '  https://facebook.com/troop79 \n\n not-a-url \nhttps://beascout.scouting.org/x\n';
    expect(parseSameAs(raw)).toEqual(['https://facebook.com/troop79', 'https://beascout.scouting.org/x']);
  });

  it('ParseSameAs_ReturnsEmpty_ForBlankInput', () => {
    expect(parseSameAs('')).toEqual([]);
    expect(parseSameAs('   \n  ')).toEqual([]);
  });

  it('AbsoluteUrl_JoinsWithoutDoubleSlashes_AndLeavesAbsoluteInputAlone', () => {
    expect(absoluteUrl(ORIGIN, '/news')).toBe(`${ORIGIN}/news`);
    expect(absoluteUrl(`${ORIGIN}/`, 'news')).toBe(`${ORIGIN}/news`);
    expect(absoluteUrl(ORIGIN, '/')).toBe(`${ORIGIN}/`);
    expect(absoluteUrl(ORIGIN, 'https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });
});

describe('seo — JSON-LD shapes (pure)', () => {
  const stored = new Map<string, string>();

  it('OrganizationJsonLd_NamesTheTroop_ItsPlace_AndItsParentOrganization', () => {
    const ld = organizationJsonLd(stored, ORIGIN) as Record<string, unknown>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Organization');
    expect(ld.name).toContain('Troop 79');
    expect(ld.url).toBe(`${ORIGIN}/`);
    const address = ld.address as Record<string, string>;
    expect(address['@type']).toBe('PostalAddress');
    expect(address.addressLocality).toBe('Milwaukee');
    expect(address.addressRegion).toBe('WI');
    expect(JSON.stringify(ld.memberOf)).toContain('Scouting America');
  });

  it('OrganizationJsonLd_OmitsSameAs_WhenNoProfilesAreConfigured', () => {
    const ld = organizationJsonLd(new Map(), ORIGIN) as Record<string, unknown>;
    expect(ld.sameAs).toBeUndefined();
  });

  it('OrganizationJsonLd_IncludesSameAs_OnceProfilesAreConfigured', () => {
    const ld = organizationJsonLd(
      new Map([['seo.same_as', 'https://facebook.com/troop79\nhttps://g.page/troop79']]),
      ORIGIN
    ) as Record<string, unknown>;
    expect(ld.sameAs).toEqual(['https://facebook.com/troop79', 'https://g.page/troop79']);
  });

  it('WebsiteJsonLd_CarriesTheSiteName_AndItsOrigin', () => {
    const ld = websiteJsonLd(ORIGIN) as Record<string, unknown>;
    expect(ld['@type']).toBe('WebSite');
    expect(ld.url).toBe(`${ORIGIN}/`);
  });

  it('EventJsonLd_CarriesName_StartDate_Url_AndOrganizer', () => {
    const ld = eventJsonLd(
      {
        id: 'e1',
        title: 'Fall Campout',
        entry_date: '2026-10-02',
        end_date: '2026-10-04',
        location: 'Camp Whitcomb',
        summary: 'Two nights at Camp Whitcomb.'
      },
      stored,
      ORIGIN
    ) as Record<string, unknown>;
    expect(ld['@type']).toBe('Event');
    expect(ld.name).toBe('Fall Campout');
    expect(ld.startDate).toBe('2026-10-02');
    expect(ld.endDate).toBe('2026-10-04');
    expect(ld.url).toBe(`${ORIGIN}/events/e1`);
    expect(JSON.stringify(ld.organizer)).toContain('Troop 79');
    expect(ld.location).toEqual({ '@type': 'Place', name: 'Camp Whitcomb' });
  });

  it('EventJsonLd_NeverStampsTheTroopsCityOntoTheVenue', () => {
    // A campout is not in Milwaukee. Inheriting the troop's own locality onto
    // the event Place publishes a wrong address, which is worse than none.
    const ld = eventJsonLd(
      { id: 'e3', title: 'Winter Camp', entry_date: '2027-01-08', end_date: null, location: 'Camp Long Lake', summary: null },
      new Map([['seo.org_locality', 'Milwaukee']]),
      ORIGIN
    ) as Record<string, unknown>;
    expect(JSON.stringify(ld.location)).not.toContain('Milwaukee');
  });

  it('EventJsonLd_OmitsEndDate_WhenTheEntryIsSingleDay', () => {
    const ld = eventJsonLd(
      { id: 'e2', title: 'Troop Meeting', entry_date: '2026-10-06', end_date: null, location: null, summary: null },
      stored,
      ORIGIN
    ) as Record<string, unknown>;
    expect(ld.endDate).toBeUndefined();
    // A missing location must not emit a half-built Place node.
    expect(ld.location).toBeUndefined();
  });

  it('ArticleJsonLd_CarriesHeadline_DatePublished_AndAuthor', () => {
    const ld = articleJsonLd(
      {
        slug: 'summer-camp-recap',
        title: 'Summer Camp Recap',
        excerpt: 'A week at Makajawan.',
        published_at: '2026-07-30T12:00:00Z',
        author_name: 'Patrick Bieser',
        image_url: 'https://cdn.example/hero.jpg'
      },
      stored,
      ORIGIN
    ) as Record<string, unknown>;
    expect(ld['@type']).toBe('Article');
    expect(ld.headline).toBe('Summer Camp Recap');
    expect(ld.datePublished).toBe('2026-07-30T12:00:00Z');
    expect(ld.mainEntityOfPage).toBe(`${ORIGIN}/news/summer-camp-recap`);
    expect(JSON.stringify(ld.author)).toContain('Patrick Bieser');
    expect(ld.image).toBe('https://cdn.example/hero.jpg');
  });

  it('BreadcrumbJsonLd_NumbersEveryCrumb_FromOne', () => {
    const ld = breadcrumbJsonLd(
      [
        { name: 'Home', path: '/' },
        { name: 'News', path: '/news' },
        { name: 'Summer Camp Recap', path: '/news/summer-camp-recap' }
      ],
      ORIGIN
    ) as { itemListElement: { position: number; name: string; item: string }[] };
    expect(ld.itemListElement.map((c) => c.position)).toEqual([1, 2, 3]);
    expect(ld.itemListElement[2].item).toBe(`${ORIGIN}/news/summer-camp-recap`);
  });
});

describe('seo — sitemap (pure)', () => {
  const input: SitemapInput = {
    origin: ORIGIN,
    articles: [{ slug: 'a-story', updated_at: '2026-08-01T00:00:00Z' }],
    events: [{ id: 'e1', updated_at: '2026-08-02T00:00:00Z' }],
    categories: [{ slug: 'campouts' }],
    meritBadges: [{ id: 'camping' }],
    libraryRanks: [{ path: '/library/rank/tenderfoot' }],
    indexScoutPages: false,
    scouts: [{ id: 's1' }]
  };

  it('BuildSitemap_IncludesEveryStaticMarketingPath', () => {
    const urls = buildSitemap(input).map((e) => e.url);
    for (const p of STATIC_SITEMAP_PATHS) {
      expect(urls, `${p} missing from sitemap`).toContain(absoluteUrl(ORIGIN, p));
    }
  });

  it('BuildSitemap_IncludesEveryPublishedArticle_EventCategoryAndMeritBadge', () => {
    const urls = buildSitemap(input).map((e) => e.url);
    expect(urls).toContain(`${ORIGIN}/news/a-story`);
    expect(urls).toContain(`${ORIGIN}/events/e1`);
    expect(urls).toContain(`${ORIGIN}/category/campouts`);
    expect(urls).toContain(`${ORIGIN}/merit-badges/camping`);
    expect(urls).toContain(`${ORIGIN}/library/rank/tenderfoot`);
  });

  it('BuildSitemap_NeverIncludesAGatedOrPrivateSurface', () => {
    const urls = buildSitemap(input).map((e) => e.url);
    for (const path of NEVER_SITEMAPPED) {
      expect(
        urls.some((u) => u.startsWith(absoluteUrl(ORIGIN, path))),
        `${path} must never be advertised to crawlers`
      ).toBe(false);
    }
  });

  it('BuildSitemap_LeavesIndividualScoutPagesOut_ByDefault', () => {
    // A sitemap is an ACTIVE invitation to index. Individual-scout surfaces are
    // reachable today, but submitting ~30 of them to Google is a separate
    // decision — so it is a setting, and the setting is off.
    const urls = buildSitemap(input).map((e) => e.url);
    expect(urls.some((u) => u.includes('/scouts/'))).toBe(false);
  });

  it('BuildSitemap_IncludesScoutPages_OnlyWhenTheSettingIsExplicitlyOn', () => {
    const urls = buildSitemap({ ...input, indexScoutPages: true }).map((e) => e.url);
    expect(urls).toContain(`${ORIGIN}/scouts/s1`);
  });

  it('BuildSitemap_CarriesLastModified_FromTheRowItCameFrom', () => {
    const entry = buildSitemap(input).find((e) => e.url === `${ORIGIN}/news/a-story`);
    expect(entry?.lastModified).toBe('2026-08-01T00:00:00Z');
  });

  it('BuildSitemap_EmitsNoDuplicateUrls', () => {
    const urls = buildSitemap(input).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('BuildSitemap_SurvivesEmptyContent_WithTheStaticPathsIntact', () => {
    const urls = buildSitemap({
      origin: ORIGIN,
      articles: [],
      events: [],
      categories: [],
      meritBadges: [],
      libraryRanks: [],
      indexScoutPages: false,
      scouts: []
    }).map((e) => e.url);
    expect(urls.length).toBe(STATIC_SITEMAP_PATHS.length);
  });
});
