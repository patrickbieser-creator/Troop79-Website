/**
 * /library — Resource Library home: search, advancement drill, topic shelves.
 *
 * Server Component. The drill reads rank_requirements / merit_badges live —
 * the library has no taxonomy of its own to drift (Plans/Resource-Library.md).
 * The rank accordion is native <details>/<summary>: no client JS.
 *
 * Search is a plain GET form (?q=) handled server-side — FTS + ilike via
 * lib/library-data.ts searchPublishedResources().
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { earnedByBadge } from '@/lib/mb-scout-progress';
import type { MeritBadge, Rank } from '@/lib/supabase/types';
import {
  loadTopics,
  publishedCountsByTarget,
  searchPublishedResources,
  loadScoutRankProgress,
  loadScoutMbAwardMap,
  type SearchHit
} from '@/lib/library-data';
import { rankReqKey, splitRankReqKey, withViewScout } from '@/lib/library';
import { resolveLibraryViewer, viewerIsLeader, type LibraryViewer } from '@/lib/library-viewer';
import { ResourceCard, type AlsoOnLink } from './_components/resource-card';
import { MbGrid, type MbTile } from './mb-grid';
import { ScoutSwitcher } from './_components/scout-switcher';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { SectionDivider } from '@/app/_components/section-divider';
import { EmptyState } from '@/app/_components/empty-state';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import styles from './library.module.css';

// New public pages must opt out of static prerendering or they freeze at
// build time (D-040) — nothing here uses a Dynamic API by default.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Resource Library — Scout Troop 79',
  description:
    'Videos, guides, links, and troop know-how — organized by rank and merit badge requirement, plus shelves for everything else worth keeping.'
};

interface TopReq {
  code: string;
  label: string;
}

interface HomeData {
  ranks: Rank[];
  reqsByRank: Map<string, TopReq[]>;
  mbs: MeritBadge[];
  topics: Awaited<ReturnType<typeof loadTopics>>;
  counts: Map<string, number>;
  /** mbId -> active scouts who have earned it. Feeds the grid's Progress
   *  mode; the read moved here off the retired /merit-badges catalog. */
  earnedByMb: Map<string, number>;
  /** Personalization (Patrick, 2026-08-07) — null unless resolveLibraryViewer()
   *  resolved a scout to show. rankProgress is keyed by the SAME rankReqKey
   *  composite used everywhere else; mbAwards is keyed by bare mbId. */
  progress: { rankProgress: Map<string, string>; mbAwards: Map<string, string> } | null;
  /** Carried into every drill-down Link so the personalized view survives
   *  navigation (lib/library.ts withViewScout()). Undefined = nothing to carry. */
  viewScoutId: string | undefined;
}

async function loadHome(viewer: LibraryViewer): Promise<HomeData> {
  const supabase = createAdminClient();
  const [ranksRes, reqsRes, mbsRes, topics, counts, awardedRows, activeRes] = await Promise.all([
    supabase.from('ranks').select('*').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label, parent_id, sort_order')
      .is('parent_id', null)
      .order('sort_order'),
    supabase.from('merit_badges').select('*').order('name'),
    loadTopics(supabase),
    publishedCountsByTarget(supabase, await viewerIsLeader()),
    /* Feeds the grid's Progress mode. Paginated because mb_progress is
       unbounded past the ~1000-row PostgREST cap as more scouts start more
       badges — it is already at 528 rows. This is the SAME read the retired
       /merit-badges catalog ran, moved rather than added. */
    fetchAllRows<{ mb_id: string; scout_id: string }>((from, to) =>
      supabase.from('mb_progress').select('mb_id, scout_id').eq('awarded', true).range(from, to)
    ),
    /* Active scout ids — the grid counts ACTIVE scouts only, so its numbers
       agree with the badge page one click away. Without this the grid said
       Archery 12 (every award ever) against the badge page's 6 (scouts in the
       troop now); see earnedByBadge(). */
    supabase.from('scouts').select('id').eq('active', true)
  ]);

  const activeIds = new Set(((activeRes.data ?? []) as { id: string }[]).map((r) => r.id));
  const earnedByMb = earnedByBadge(awardedRows, activeIds);

  const reqsByRank = new Map<string, TopReq[]>();
  for (const r of (reqsRes.data ?? []) as { rank_id: string; code: string; label: string }[]) {
    const list = reqsByRank.get(r.rank_id) ?? [];
    list.push({ code: r.code, label: r.label });
    reqsByRank.set(r.rank_id, list);
  }

  let progress: HomeData['progress'] = null;
  if (viewer.kind === 'scout') {
    const [rankProgress, mbAwards] = await Promise.all([
      loadScoutRankProgress(supabase, viewer.scoutId),
      loadScoutMbAwardMap(supabase, viewer.scoutId)
    ]);
    progress = { rankProgress, mbAwards };
  }

  return {
    ranks: (ranksRes.data ?? []) as Rank[],
    reqsByRank,
    mbs: (mbsRes.data ?? []) as MeritBadge[],
    topics,
    counts,
    earnedByMb,
    progress,
    viewScoutId: viewer.kind === 'scout' ? viewer.scoutId : undefined
  };
}

export default async function LibraryHomePage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; viewScout?: string }>;
}) {
  const { q, viewScout } = await searchParams;
  const viewer = await resolveLibraryViewer(createAdminClient(), viewScout);
  const data = await loadHome(viewer);
  const query = (q ?? '').trim();
  const hits = query
    ? await searchPublishedResources(createAdminClient(), query, await viewerIsLeader())
    : null;

  return (
    <>
      <PageHeader
        kicker="Scout Troop 79 · Resource Library"
        title="The Resource Library"
        lede="Videos, guides, links, and troop know-how — organized by the same ranks and merit
          badges we track, plus shelves for everything else worth keeping. Found something
          great? Share it, and the webmaster will add it to the shelf."
      />

      <PageShell>
        <ScoutSwitcher viewer={viewer} />

        <form className={styles.searchForm} action="/library" method="get" role="search">
          <input
            className={styles.searchInput}
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search everything… try “knots”, “first aid”, or “cot”"
            aria-label="Search the resource library"
          />
          <button className={styles.searchBtn} type="submit">
            Search
          </button>
        </form>

        {hits ? (
          <SearchResults query={query} hits={hits} data={data} />
        ) : (
          <>
            <RankDrill data={data} />
            <MbGridSection data={data} />
            <TopicShelves data={data} />
            <ContributeBand />
          </>
        )}
      </PageShell>
    </>
  );
}

function SearchResults({
  query,
  hits,
  data
}: {
  query: string;
  hits: SearchHit[];
  data: HomeData;
}) {
  const rankIds = data.ranks.map((r) => r.id);
  const mbNames = new Map(data.mbs.map((m) => [m.id, m.name]));
  const rankNames = new Map(data.ranks.map((r) => [r.id, r.display_name]));
  const topicTitles = new Map(data.topics.map((t) => [t.slug, t.title]));

  const alsoOnFor = (hit: SearchHit): AlsoOnLink[] =>
    hit.placements
      .map((p): AlsoOnLink | null => {
        if (p.target_kind === 'topic') {
          return {
            href: `/library/topic/${p.target_key}`,
            label: topicTitles.get(p.target_key) ?? p.target_key
          };
        }
        if (p.target_kind === 'mb') {
          return {
            href: `/library/mb/${p.target_key}`,
            label: mbNames.get(p.target_key) ?? p.target_key
          };
        }
        if (p.target_kind === 'mb_req') {
          const mbId = data.mbs.find((m) => p.target_key.startsWith(`${m.id}-`))?.id;
          if (!mbId) return null;
          return {
            href: `/library/mb/${mbId}`,
            label: `${mbNames.get(mbId)} ${p.target_key.slice(mbId.length + 1)}`
          };
        }
        const split = splitRankReqKey(p.target_key, rankIds);
        if (!split) return null;
        return {
          href: `/library/rank/${split.rankId}/${split.code}`,
          label: `${rankNames.get(split.rankId)} ${split.code}`
        };
      })
      .filter((l): l is AlsoOnLink => l !== null);

  return (
    <>
      <p className={styles.searchCount}>
        <strong>{hits.length}</strong> result{hits.length === 1 ? '' : 's'} for
        &ldquo;{query}&rdquo; —{' '}
        <Link href="/library" className={styles.inlineLink}>
          clear to browse
        </Link>
      </p>
      {hits.length === 0 ? (
        <EmptyState>
          Nothing on the shelves for that yet.{' '}
          <Link href="/library/submit">Suggest the resource that should be here →</Link>
        </EmptyState>
      ) : (
        <ul className={styles.resourceList}>
          {hits.map((hit) => (
            <ResourceCard key={hit.id} resource={hit} alsoOn={alsoOnFor(hit)} />
          ))}
        </ul>
      )}
    </>
  );
}

function RankDrill({ data }: { data: HomeData }) {
  return (
    <>
      <SectionDivider
        label="Browse by Rank"
        link={<Link href="/advancement">Advancement Tracker →</Link>}
      />
      <div className={styles.rankAccordion}>
        {data.ranks.map((rank) => {
          const reqs = data.reqsByRank.get(rank.id) ?? [];
          const total = reqs.reduce(
            (sum, req) =>
              sum + (data.counts.get(`rank_req:${rankReqKey(rank.id, req.code)}`) ?? 0),
            0
          );
          return (
            <details key={rank.id} className={styles.rankItem}>
              <summary className={styles.rankHead}>
                <span className={styles.rankName}>{rank.display_name}</span>
                <span
                  className={`${styles.rankCount} ${total === 0 ? styles.rankCountZero : ''}`}
                >
                  {total} resource{total === 1 ? '' : 's'}
                </span>
                <span className={styles.rankCaret} aria-hidden="true">
                  ▼
                </span>
              </summary>
              <div className={styles.reqRows}>
                {reqs.map((req) => {
                  const key = rankReqKey(rank.id, req.code);
                  const n = data.counts.get(`rank_req:${key}`) ?? 0;
                  const doneDate = data.progress?.rankProgress.get(key) ?? null;
                  return (
                    <Link
                      key={req.code}
                      className={`${styles.reqRow} ${n > 0 ? styles.reqRowHasStuff : ''}`}
                      href={withViewScout(
                        `/library/rank/${rank.id}/${encodeURIComponent(req.code)}`,
                        data.viewScoutId
                      )}
                    >
                      <span className={`${styles.reqTag} ${styles.reqTagGhost}`}>{req.code}</span>
                      <span className={styles.reqLabel}>{req.label}</span>
                      {doneDate && (
                        <Badge tone="accent" caps={false}>
                          ✓{' '}
                          {new Date(doneDate).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric'
                          })}
                        </Badge>
                      )}
                      {n > 0 ? (
                        <span className={styles.reqResCount}>
                          {n} resource{n === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className={`${styles.reqResCount} ${styles.reqResCountZero}`}>—</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}

/**
 * Server-side adapter for the merit badge grid. Computes both numbers each
 * tile can show — resources shelved, and scouts who have earned it — and
 * hands plain data to the client component that owns the toggle.
 *
 * Both are computed unconditionally rather than on demand: the earned counts
 * are one paginated read that the retired /merit-badges catalog already ran,
 * so this is net-neutral for the site, and gating it behind the toggle would
 * buy nothing but a loading state on every flip.
 */
function MbGridSection({ data }: { data: HomeData }) {
  const tiles: MbTile[] = data.mbs.map((mb) => {
    let resources = data.counts.get(`mb:${mb.id}`) ?? 0;
    for (const [key, count] of data.counts) {
      if (key.startsWith(`mb_req:${mb.id}-`)) resources += count;
    }
    return {
      id: mb.id,
      name: mb.name,
      eagle: mb.eagle,
      resources,
      earned: data.earnedByMb.get(mb.id) ?? 0,
      awardDate: data.progress?.mbAwards.get(mb.id) ?? null,
      href: withViewScout(`/library/mb/${mb.id}`, data.viewScoutId)
    };
  });
  return <MbGrid tiles={tiles} />;
}

function TopicShelves({ data }: { data: HomeData }) {
  return (
    <>
      <SectionDivider label="Topic Shelves" />
      <div className={styles.shelfGrid}>
        {data.topics.map((topic) => {
          const n = data.counts.get(`topic:${topic.slug}`) ?? 0;
          return (
            <Link key={topic.slug} className={styles.shelfCard} href={`/library/topic/${topic.slug}`}>
              {topic.icon && (
                <span className={styles.shelfIcon} aria-hidden="true">
                  {topic.icon}
                </span>
              )}
              <h3 className={styles.shelfTitle}>{topic.title}</h3>
              {topic.blurb_md && <p className={styles.shelfBlurb}>{topic.blurb_md}</p>}
              <span className={styles.shelfMeta}>
                {n === 0 ? 'Nothing shelved yet' : `${n} resource${n === 1 ? '' : 's'}`}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function ContributeBand() {
  return (
    <div className={styles.ctaBand}>
      <div className={styles.ctaBandText}>
        <h2 className={styles.ctaBandTitle}>Found something worth keeping?</h2>
        <p className={styles.ctaBandLede}>
          Leaders, scouts, and parents can all suggest resources. Everything goes to the
          webmaster&rsquo;s review queue first — nothing publishes until it&rsquo;s approved, so
          send it in even if you&rsquo;re not sure where it belongs.
        </p>
      </div>
      <Button variant="primary" href="/library/submit">
        Suggest a Resource
      </Button>
    </div>
  );
}
