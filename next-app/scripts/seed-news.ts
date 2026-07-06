/**
 * Seeds sample News CMS data (articles only — tags are seeded by the
 * migration itself) for local dev: one article of each type (news, event,
 * recognition) with varied body content, so the admin table view and public
 * pages have something to render.
 *
 * Run:  npm run seed-news
 *
 * Requires local Supabase running (`supabase start` from next-app/) OR a
 * cloud project URL + service role key in .env.local. Uses the SERVICE ROLE
 * key (bypasses RLS) — only run server-side.
 *
 * Safe to re-run: upserts by slug.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY env var is required.\n' +
      '  - Local dev:  run `supabase start`, then copy the service_role key from its output.\n' +
      '  - Cloud:      grab it from Project Settings → API in the Supabase dashboard.\n' +
      '  Add it to next-app/.env.local'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const NEWS_BODY = `## Fall Camporee Wrap-Up

Twenty-two scouts spent the weekend at Camp Long Lake for the fall Camporee,
competing in orienteering, knot-tying, and the always-competitive Dutch oven
cook-off.

{{gallerylink: https://photos.app.goo.gl/example-camporee | Full weekend photo album}}

| Event | 1st Place Patrol |
| --- | --- |
| Orienteering | Wolf Patrol |
| Fire Building | Hawk Patrol |
| Cook-off | Wolf Patrol |

Great weekend all around — thanks to every family who helped drive and cook!`;

const EVENT_BODY = `## Join Us for the Winter Court of Honor

Come celebrate this quarter's rank advancements and merit badge earners.
Light refreshments provided; families welcome.

{{video: https://www.youtube.com/watch?v=example}}

Questions? Reach out to your patrol leader.`;

const RECOGNITION_BODY = `## Congratulations to Our Newest Eagle Scout

The troop gathered Saturday to honor this quarter's advancements, including
one brand-new Eagle Scout.

{{gallerylink: https://photos.app.goo.gl/example-coh | Ceremony photo album}}

Well done to everyone recognized this quarter!`;

interface ArticleSeedRow {
  slug: string;
  title: string;
  type: 'news' | 'event' | 'recognition';
  excerpt: string;
  body: string;
  status: 'draft' | 'published';
  author_name: string;
  author_role: 'leader' | 'scout';
  published_at: string;
  featured: boolean;
  featured_order: number | null;
  event_start?: string;
  event_end?: string;
  event_location?: string;
  event_registration_url?: string | null;
}

const ARTICLES: ArticleSeedRow[] = [
  {
    slug: 'fall-camporee-wrap-up',
    title: 'Fall Camporee Wrap-Up',
    type: 'news' as const,
    excerpt:
      'Twenty-two scouts competed in orienteering, knot-tying, and the Dutch oven cook-off at this fall’s Camporee.',
    body: NEWS_BODY,
    status: 'published' as const,
    author_name: 'Alex M.',
    author_role: 'scout' as const,
    published_at: '2026-06-20T12:00:00Z',
    featured: true,
    featured_order: 1
  },
  {
    slug: 'winter-court-of-honor',
    title: 'Winter Court of Honor',
    type: 'event' as const,
    excerpt: 'Join us as we celebrate this quarter’s rank advancements and merit badge earners.',
    body: EVENT_BODY,
    status: 'published' as const,
    author_name: 'Pat B.',
    author_role: 'leader' as const,
    published_at: '2026-07-01T12:00:00Z',
    featured: false,
    featured_order: null,
    event_start: '2026-08-15T18:30:00Z',
    event_end: '2026-08-15T20:00:00Z',
    event_location: 'Brookfield East High School',
    event_registration_url: null
  },
  {
    slug: 'congratulations-newest-eagle-scout',
    title: 'Congratulations to Our Newest Eagle Scout',
    type: 'recognition' as const,
    excerpt: 'The troop gathered to honor this quarter’s advancements, including one brand-new Eagle Scout.',
    body: RECOGNITION_BODY,
    status: 'published' as const,
    author_name: 'Pat B.',
    author_role: 'leader' as const,
    published_at: '2026-06-28T12:00:00Z',
    featured: false,
    featured_order: null
  }
];

async function main() {
  console.log(`Seeding sample News CMS articles …\n  Supabase: ${SUPABASE_URL}\n`);

  for (const article of ARTICLES) {
    const { error } = await supabase
      .from('articles')
      .upsert(article, { onConflict: 'slug' });
    if (error) throw new Error(`article ${article.slug}: ${error.message}`);
    console.log(`  · ${article.slug}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
