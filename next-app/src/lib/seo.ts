/**
 * SEO surface: robots.txt, sitemap.xml and JSON-LD (Patrick, 2026-08-22 —
 * "implement and make available editing of the robots.txt and the generation
 * of a sitemap.xml, and JSON-LD").
 *
 * WHY THIS FILE IS PURE. Everything a crawler sees is computed here from
 * plain data, so the shapes are asserted in tests/seo.test.ts without a
 * browser, a crawler or the DB. The three routes that consume it
 * (app/robots.txt/route.ts, app/sitemap.ts, the <JsonLd> component) are
 * deliberately thin: load rows, call a function here, serialize.
 *
 * EDITABLE, NOT HARD-CODED. The troop's address, phone, social profiles and
 * the robots.txt body itself live in `site_settings` under `seo.*` keys and
 * are edited in Lookups & Admin, the same contract the reminder-email copy
 * uses (lib/site-text.ts): a blank or missing row means the built-in default
 * below. Nothing here requires a deploy to change.
 *
 * THE PII RULE. A sitemap is an ACTIVE invitation to index — a different act
 * from a page merely being reachable. Individual-scout surfaces (/scouts/[id],
 * a scout's advancement report) are public today, but they are NOT advertised
 * to crawlers unless a leader explicitly turns that on. See NEVER_SITEMAPPED
 * (never, at all) and `indexScoutPages` (off by default).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Editable settings ───────────────────────────────────────────────────────

export type SeoSettingKey =
  | 'seo.robots_txt'
  | 'seo.org_street'
  | 'seo.org_locality'
  | 'seo.org_region'
  | 'seo.org_postal'
  | 'seo.org_phone'
  | 'seo.org_email'
  | 'seo.meeting_place'
  | 'seo.same_as'
  | 'seo.default_og_image'
  | 'seo.index_scout_pages';

export interface SeoSettingDef {
  key: SeoSettingKey;
  label: string;
  hint: string;
  /** Rendered as a textarea rather than a single-line input. */
  multiline: boolean;
  /** Rendered as an on/off control rather than free text. */
  flag?: boolean;
  /** Rows for a multiline field. */
  rows?: number;
}

/**
 * The built-in robots.txt. Allows the marketing site, closes every private
 * surface. `/api` is disallowed rather than merely uninteresting: some of it
 * is authenticated, and a crawler following a stray link there wastes budget
 * at best. The Sitemap: line is appended by buildRobotsTxt() so it always
 * points at the live origin even if this body is edited.
 */
export const DEFAULT_ROBOTS_TXT = `User-agent: *
Allow: /

# Private surfaces — leader workspace, member area, and sign-in.
Disallow: /admin
Disallow: /member
Disallow: /profile
Disallow: /signin
Disallow: /api`;

export const SEO_DEFAULTS: Record<SeoSettingKey, string> = {
  'seo.robots_txt': DEFAULT_ROBOTS_TXT,
  'seo.org_street': '',
  'seo.org_locality': 'Milwaukee',
  'seo.org_region': 'WI',
  'seo.org_postal': '',
  'seo.org_phone': '',
  'seo.org_email': '',
  'seo.meeting_place': '',
  'seo.same_as': '',
  'seo.default_og_image': '',
  'seo.index_scout_pages': 'off'
};

export const SEO_KEYS: readonly SeoSettingDef[] = [
  {
    key: 'seo.robots_txt',
    label: 'robots.txt',
    hint:
      'Served at /robots.txt. Leave blank for the built-in file (allows the public site, blocks /admin, /member, /profile, /signin and /api). The Sitemap: line is added automatically unless you write your own.',
    multiline: true,
    rows: 12
  },
  {
    key: 'seo.meeting_place',
    label: 'Meeting location',
    hint: 'Where the troop meets, in plain words — e.g. "Immanuel Lutheran Church, 1100 N Astor St". Used in the Organization listing search engines and AI assistants read.',
    multiline: false
  },
  { key: 'seo.org_street', label: 'Street address', hint: 'Optional. Left blank, only the city and state are published.', multiline: false },
  { key: 'seo.org_locality', label: 'City', hint: 'Published in the Organization listing.', multiline: false },
  { key: 'seo.org_region', label: 'State', hint: 'Two-letter abbreviation.', multiline: false },
  { key: 'seo.org_postal', label: 'ZIP', hint: 'Optional.', multiline: false },
  { key: 'seo.org_phone', label: 'Public phone', hint: 'Optional, and PUBLIC — leave blank unless it is a number the troop wants listed.', multiline: false },
  { key: 'seo.org_email', label: 'Public email', hint: 'Optional, and PUBLIC — a shared troop address, never a personal one.', multiline: false },
  {
    key: 'seo.same_as',
    label: 'Other profiles (one URL per line)',
    hint: 'Facebook, the BeAScout unit pin, the Google Business Profile, the council directory. These are the strongest signal that the site and the real troop are the same organization.',
    multiline: true,
    rows: 4
  },
  {
    key: 'seo.default_og_image',
    label: 'Default share image',
    hint: 'Full URL to the image shown when a link to the site is shared and the page has no image of its own. 1200×630 works best.',
    multiline: false
  },
  {
    key: 'seo.index_scout_pages',
    label: 'List individual scout pages in the sitemap',
    hint:
      'OFF by default. These pages are already reachable; turning this on actively invites Google to index each scout. Leave it off unless the troop has decided otherwise.',
    multiline: false,
    flag: true
  }
];

/** Stored value if non-blank, else the built-in default. */
export function resolveSeo(stored: ReadonlyMap<string, string>, key: SeoSettingKey): string {
  const v = stored.get(key);
  return v && v.trim() ? v : SEO_DEFAULTS[key];
}

/** Explicit opt-in only — anything unrecognized reads as off. */
export function seoFlagOn(value: string | undefined): boolean {
  if (!value) return false;
  return ['on', 'true', 'yes', '1'].includes(value.trim().toLowerCase());
}

/** All stored `seo.*`/site settings. Never throws — a read failure degrades
 *  to the defaults, which is what an empty map means. */
export async function loadSeoSettings(admin: SupabaseClient): Promise<Map<string, string>> {
  try {
    const { data } = await admin.from('site_settings').select('key, value');
    return new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}

// ── robots.txt ──────────────────────────────────────────────────────────────

/**
 * The served robots.txt: the edited (or default) body, with a Sitemap: line
 * appended only when the body does not already declare one. A leader who
 * writes their own Sitemap: line keeps it — including one pointing somewhere
 * else, which is a legitimate thing to want and not ours to overrule.
 */
export function buildRobotsTxt(body: string, sitemapUrl: string): string {
  const text = (body && body.trim() ? body : DEFAULT_ROBOTS_TXT).replace(/\r\n?/g, '\n').trimEnd();
  if (/^\s*sitemap:/im.test(text)) return `${text}\n`;
  return `${text}\n\nSitemap: ${sitemapUrl}\n`;
}

// ── Small shared helpers ────────────────────────────────────────────────────

/** One http(s) URL per line; anything else on a line is dropped. */
export function parseSameAs(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/\S+$/.test(s));
}

/** Join an origin and a path without producing a double slash. Input that is
 *  already absolute passes through untouched (CDN image URLs). */
export function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = origin.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

/** Drop undefined/empty members so a partly-configured troop never emits a
 *  half-built node (Google treats `"addressLocality": ""` as a defect). */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

export const ORG_NAME = 'Scout Troop 79';
export const ORG_ALT_NAME = 'Troop 79 Milwaukee';

/**
 * The troop itself. Emitted on every public page — this is the node that
 * tells Google and any AI assistant that troop-79.com and the real Troop 79
 * in Milwaukee are one organization, and `memberOf` connects it upward to
 * Scouting America.
 */
export function organizationJsonLd(stored: ReadonlyMap<string, string>, origin: string): object {
  const sameAs = parseSameAs(resolveSeo(stored, 'seo.same_as'));
  const logo = resolveSeo(stored, 'seo.default_og_image');
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ORG_NAME,
    alternateName: ORG_ALT_NAME,
    url: absoluteUrl(origin, '/'),
    logo: logo || undefined,
    description:
      'Scouts BSA Troop 79 in Milwaukee, Wisconsin — a scout-led troop for boys and girls ages 11–17, with weekly meetings, monthly campouts, and a full outdoor program.',
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: resolveSeo(stored, 'seo.org_street') || undefined,
      addressLocality: resolveSeo(stored, 'seo.org_locality'),
      addressRegion: resolveSeo(stored, 'seo.org_region'),
      postalCode: resolveSeo(stored, 'seo.org_postal') || undefined,
      addressCountry: 'US'
    }),
    location: resolveSeo(stored, 'seo.meeting_place')
      ? compact({ '@type': 'Place', name: resolveSeo(stored, 'seo.meeting_place') })
      : undefined,
    telephone: resolveSeo(stored, 'seo.org_phone') || undefined,
    email: resolveSeo(stored, 'seo.org_email') || undefined,
    memberOf: [
      { '@type': 'Organization', name: 'Scouting America' },
      { '@type': 'Organization', name: 'Scouts BSA' }
    ],
    sameAs: sameAs.length ? sameAs : undefined
  });
}

export function websiteJsonLd(origin: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: ORG_NAME,
    alternateName: ORG_ALT_NAME,
    url: absoluteUrl(origin, '/')
  };
}

export interface EventLdInput {
  id: string | number;
  title: string;
  entry_date: string;
  end_date: string | null;
  location: string | null;
  summary: string | null;
}

/**
 * One calendar entry. Events are what Google actually surfaces as a rich
 * result for a local youth organization, so this is the highest-value node
 * on the site after Organization.
 */
export function eventJsonLd(
  entry: EventLdInput,
  stored: ReadonlyMap<string, string>,
  origin: string
): object {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: entry.title,
    startDate: entry.entry_date,
    endDate: entry.end_date ?? undefined,
    description: entry.summary ?? undefined,
    url: absoluteUrl(origin, `/events/${entry.id}`),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    /* Name only, deliberately. The obvious move is to inherit the troop's own
       city onto the venue, but a campout is at Camp Whitcomb and a service
       project was at "Northwoods: 1572 E Capitol, Shorewood, WI" — stamping
       "Milwaukee" on those publishes a wrong address, which is worse for a
       crawler than an unspecified one. The location column is free text and
       usually already contains the address a human needs. */
    location: entry.location ? { '@type': 'Place', name: entry.location } : undefined,
    organizer: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: absoluteUrl(origin, '/')
    }
  });
}

export interface ArticleLdInput {
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  author_name: string | null;
  image_url: string | null;
}

export function articleJsonLd(
  article: ArticleLdInput,
  stored: ReadonlyMap<string, string>,
  origin: string
): object {
  const fallbackImage = resolveSeo(stored, 'seo.default_og_image');
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt ?? undefined,
    datePublished: article.published_at ?? undefined,
    mainEntityOfPage: absoluteUrl(origin, `/news/${article.slug}`),
    image: article.image_url ?? (fallbackImage || undefined),
    author: article.author_name
      ? { '@type': 'Person', name: article.author_name }
      : { '@type': 'Organization', name: ORG_NAME },
    publisher: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: absoluteUrl(origin, '/')
    }
  });
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(trail: Crumb[], origin: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(origin, c.path)
    }))
  };
}

// ── Sitemap ─────────────────────────────────────────────────────────────────

/**
 * The public marketing surface — every path a stranger looking for a scout
 * troop in Milwaukee should be able to land on. Ordered roughly by how much
 * we want them found.
 */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
  '/',
  '/join',
  '/about',
  '/news',
  '/events',
  '/photos',
  '/library',
  '/advancement'
];

/**
 * Never advertised to crawlers under any setting: authenticated surfaces,
 * write forms, and anything that exists to serve one family rather than the
 * public. This is asserted in tests — adding a gated route to
 * STATIC_SITEMAP_PATHS will fail the suite rather than leak quietly.
 */
export const NEVER_SITEMAPPED: readonly string[] = [
  '/admin',
  '/member',
  '/profile',
  '/signin',
  '/api',
  '/news/submit',
  '/library/submit',
  '/library/submit-proof',
  '/meeting-plan',
  '/advancement/report'
];

export interface SitemapInput {
  origin: string;
  articles: { slug: string; updated_at?: string | null }[];
  events: { id: string | number; updated_at?: string | null }[];
  categories: { slug: string }[];
  meritBadges: { id: string }[];
  libraryRanks: { path: string }[];
  /** Off unless a leader turned it on in Lookups — see the PII rule up top. */
  indexScoutPages: boolean;
  scouts: { id: string | number }[];
}

export interface SitemapEntry {
  url: string;
  lastModified?: string;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

/** Guard: nothing under a NEVER_SITEMAPPED prefix reaches the output, whatever
 *  the caller passed in. Belt and braces against a future edit to the lists. */
function allowed(path: string): boolean {
  return !NEVER_SITEMAPPED.some((p) => path === p || path.startsWith(`${p}/`));
}

export function buildSitemap(input: SitemapInput): SitemapEntry[] {
  const { origin } = input;
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();

  const push = (path: string, entry: Omit<SitemapEntry, 'url'> = {}) => {
    if (!allowed(path)) return;
    const url = absoluteUrl(origin, path);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, ...entry });
  };

  for (const path of STATIC_SITEMAP_PATHS) {
    push(path, {
      changeFrequency: path === '/' || path === '/news' || path === '/events' ? 'daily' : 'weekly',
      priority: path === '/' ? 1 : path === '/join' ? 0.9 : 0.7
    });
  }

  for (const a of input.articles) {
    push(`/news/${a.slug}`, { lastModified: a.updated_at ?? undefined, changeFrequency: 'monthly', priority: 0.6 });
  }
  for (const e of input.events) {
    push(`/events/${e.id}`, { lastModified: e.updated_at ?? undefined, changeFrequency: 'weekly', priority: 0.6 });
  }
  for (const c of input.categories) {
    push(`/category/${c.slug}`, { changeFrequency: 'weekly', priority: 0.5 });
  }
  for (const mb of input.meritBadges) {
    // /merit-badges retired 2026-08-22 — a badge's page is its Library page
    // now. No redirects (Patrick: the URLs were hours old), so the sitemap
    // must stop advertising the old ones or it points crawlers at 404s.
    push(`/library/mb/${mb.id}`, { changeFrequency: 'monthly', priority: 0.5 });
  }
  for (const r of input.libraryRanks) {
    push(r.path, { changeFrequency: 'monthly', priority: 0.4 });
  }
  if (input.indexScoutPages) {
    for (const s of input.scouts) push(`/scouts/${s.id}`, { changeFrequency: 'weekly', priority: 0.3 });
  }

  return out;
}
