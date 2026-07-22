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
import type { MeritBadge, Rank } from '@/lib/supabase/types';
import {
  loadTopics,
  publishedCountsByTarget,
  searchPublishedResources,
  type SearchHit
} from '@/lib/library-data';
import { rankReqKey, splitRankReqKey } from '@/lib/library';
import { ResourceCard, type AlsoOnLink } from './_components/resource-card';
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
}

async function loadHome(): Promise<HomeData> {
  const supabase = createAdminClient();
  const [ranksRes, reqsRes, mbsRes, topics, counts] = await Promise.all([
    supabase.from('ranks').select('*').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label, parent_id, sort_order')
      .is('parent_id', null)
      .order('sort_order'),
    supabase.from('merit_badges').select('*').order('name'),
    loadTopics(supabase),
    publishedCountsByTarget(supabase)
  ]);

  const reqsByRank = new Map<string, TopReq[]>();
  for (const r of (reqsRes.data ?? []) as { rank_id: string; code: string; label: string }[]) {
    const list = reqsByRank.get(r.rank_id) ?? [];
    list.push({ code: r.code, label: r.label });
    reqsByRank.set(r.rank_id, list);
  }

  return {
    ranks: (ranksRes.data ?? []) as Rank[],
    reqsByRank,
    mbs: (mbsRes.data ?? []) as MeritBadge[],
    topics,
    counts
  };
}

export default async function LibraryHomePage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const data = await loadHome();
  const query = (q ?? '').trim();
  const hits = query ? await searchPublishedResources(createAdminClient(), query) : null;

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>Scout Troop 79 · Resource Library</p>
        <h1 className={styles.pageTitle}>The Resource Library</h1>
        <p className={styles.pageLede}>
          Videos, guides, links, and troop know-how — organized by the same ranks and merit
          badges we track, plus shelves for everything else worth keeping. Found something
          great? Share it, and the webmaster will add it to the shelf.
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={styles.main}>
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
            <MbGrid data={data} />
            <TopicShelves data={data} />
            <ContributeBand />
          </>
        )}
      </main>
    </>
  );
}

function SectionDivider({ label, link }: { label: string; link?: AlsoOnLink }) {
  return (
    <div className={styles.sectionDivider}>
      <span className={styles.divLabel}>{label}</span>
      <span className={styles.divRule} aria-hidden="true" />
      {link && (
        <Link className={styles.divLink} href={link.href}>
          {link.label}
        </Link>
      )}
    </div>
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
        <Link href="/library" style={{ color: 'var(--navy)', fontWeight: 700 }}>
          clear to browse
        </Link>
      </p>
      {hits.length === 0 ? (
        <div className={styles.emptyState}>
          Nothing on the shelves for that yet.{' '}
          <Link href="/library/submit">Suggest the resource that should be here →</Link>
        </div>
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
        link={{ href: '/advancement', label: 'Advancement Tracker →' }}
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
                  const n = data.counts.get(`rank_req:${rankReqKey(rank.id, req.code)}`) ?? 0;
                  return (
                    <Link
                      key={req.code}
                      className={`${styles.reqRow} ${n > 0 ? styles.reqRowHasStuff : ''}`}
                      href={`/library/rank/${rank.id}/${encodeURIComponent(req.code)}`}
                    >
                      <span className={`${styles.reqTag} ${styles.reqTagGhost}`}>{req.code}</span>
                      <span className={styles.reqLabel}>{req.label}</span>
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

function MbGrid({ data }: { data: HomeData }) {
  return (
    <>
      <SectionDivider
        label="Browse by Merit Badge"
        link={{ href: '/merit-badges', label: 'Full catalog →' }}
      />
      <div className={styles.mbGrid}>
        {data.mbs.map((mb) => {
          let n = data.counts.get(`mb:${mb.id}`) ?? 0;
          for (const [key, count] of data.counts) {
            if (key.startsWith(`mb_req:${mb.id}-`)) n += count;
          }
          return (
            <Link key={mb.id} className={styles.mbTile} href={`/library/mb/${mb.id}`}>
              <span className={styles.mbName}>
                {mb.name}
                {mb.eagle && <span className={styles.eagleDot}> ★ EAGLE</span>}
              </span>
              <span className={`${styles.mbCount} ${n === 0 ? styles.mbCountZero : ''}`}>
                {n === 0 ? '—' : n}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
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
      <Link className={styles.btnPrimary} href="/library/submit">
        Suggest a Resource
      </Link>
    </div>
  );
}
