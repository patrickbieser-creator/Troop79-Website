/**
 * /admin/library — the webmaster workstation (Plans/Resource-Library.md).
 *
 * Four tabs: Queue (pending submissions — everything queues, including
 * leaders'), Published (curation: placements, pins, archive), Topics
 * (shelf management), Narratives (the free-form intro paragraph on any
 * requirement/badge page). Archived items keep a fifth tab for restore.
 *
 * All-server-component: every interaction is a plain <form> posting a
 * Server Action — no client JS. Leader-only: absent from proxy.ts's scout
 * allowlist (edge) + requireRole here (page) per D-037's two-layer rule.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import type {
  LibraryPlacement,
  LibraryResource,
  LibraryTopic,
  MeritBadge,
  Rank,
  RequirementNote
} from '@/lib/supabase/types';
import {
  rankReqKey,
  resourceThumbnail,
  splitRankReqKey,
  RESOURCE_KIND_ICON,
  type ResourceKind
} from '@/lib/library';
import {
  addPlacementAction,
  approveResourceAction,
  archiveResourceAction,
  createTopicAction,
  declineResourceAction,
  removePlacementAction,
  restoreResourceAction,
  saveNarrativeAction,
  saveResourceAction,
  togglePinAction,
  toggleTopicRetiredAction,
  updateTopicAction
} from './actions';
import styles from './library.module.css';

export const metadata = {
  title: 'Resource Library — Troop 79 Admin'
};

type Tab = 'queue' | 'published' | 'archived' | 'topics' | 'narratives';
const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'published', label: 'Published' },
  { key: 'archived', label: 'Archived' },
  { key: 'topics', label: 'Topics & Shelves' },
  { key: 'narratives', label: 'Narratives' }
];

interface Catalog {
  topics: LibraryTopic[];
  ranks: Rank[];
  rankReqs: Map<string, { code: string; label: string }[]>;
  mbs: MeritBadge[];
}

interface WorkstationData {
  catalog: Catalog;
  resources: LibraryResource[];
  placementsByResource: Map<number, LibraryPlacement[]>;
  narratives: RequirementNote[];
}

async function loadWorkstation(): Promise<WorkstationData> {
  const supabase = createAdminClient();
  const [topicsRes, ranksRes, reqsRes, mbsRes, resourcesRes, placementsRes, narrativesRes] =
    await Promise.all([
      supabase.from('library_topics').select('*').order('sort_order'),
      supabase.from('ranks').select('*').order('sort_order'),
      supabase
        .from('rank_requirements')
        .select('rank_id, code, label')
        .is('parent_id', null)
        .order('sort_order'),
      supabase.from('merit_badges').select('*').order('name'),
      supabase.from('library_resources').select('*').order('created_at', { ascending: false }),
      supabase.from('library_placements').select('*'),
      supabase.from('requirement_notes').select('*').order('updated_at', { ascending: false })
    ]);

  const rankReqs = new Map<string, { code: string; label: string }[]>();
  for (const r of (reqsRes.data ?? []) as { rank_id: string; code: string; label: string }[]) {
    const list = rankReqs.get(r.rank_id) ?? [];
    list.push({ code: r.code, label: r.label });
    rankReqs.set(r.rank_id, list);
  }

  const placementsByResource = new Map<number, LibraryPlacement[]>();
  for (const p of (placementsRes.data ?? []) as LibraryPlacement[]) {
    const list = placementsByResource.get(p.resource_id) ?? [];
    list.push(p);
    placementsByResource.set(p.resource_id, list);
  }

  return {
    catalog: {
      topics: (topicsRes.data ?? []) as LibraryTopic[],
      ranks: (ranksRes.data ?? []) as Rank[],
      rankReqs,
      mbs: (mbsRes.data ?? []) as MeritBadge[]
    },
    resources: (resourcesRes.data ?? []) as LibraryResource[],
    placementsByResource,
    narratives: (narrativesRes.data ?? []) as RequirementNote[]
  };
}

function targetLabel(catalog: Catalog, kind: string, key: string): string {
  if (kind === 'topic') {
    return catalog.topics.find((t) => t.slug === key)?.title ?? `Topic: ${key}`;
  }
  if (kind === 'mb') {
    return catalog.mbs.find((m) => m.id === key)?.name ?? `MB: ${key}`;
  }
  if (kind === 'mb_req') {
    const mb = catalog.mbs.find((m) => key.startsWith(`${m.id}-`));
    return mb ? `${mb.name} ${key.slice(mb.id.length + 1)}` : `MB req: ${key}`;
  }
  const split = splitRankReqKey(key, catalog.ranks.map((r) => r.id));
  if (split) {
    const rank = catalog.ranks.find((r) => r.id === split.rankId);
    return `${rank?.display_name ?? split.rankId} ${split.code}`;
  }
  return `${kind}: ${key}`;
}

function targetHref(catalog: Catalog, kind: string, key: string): string | null {
  if (kind === 'topic') return `/library/topic/${key}`;
  if (kind === 'mb') return `/library/mb/${key}`;
  if (kind === 'mb_req') {
    const mb = catalog.mbs.find((m) => key.startsWith(`${m.id}-`));
    return mb ? `/library/mb/${mb.id}` : null;
  }
  const split = splitRankReqKey(key, catalog.ranks.map((r) => r.id));
  return split ? `/library/rank/${split.rankId}/${encodeURIComponent(split.code)}` : null;
}

/** Published-tab drill groups — same high-level categories as the public
 *  site (topic shelf / rank / merit badge), so hundreds of published items
 *  never render as one flat list of editor forms. */
function resourceInGroup(
  res: LibraryResource,
  placements: LibraryPlacement[],
  group: string
): boolean {
  if (group === 'unplaced') return placements.length === 0;
  const sep = group.indexOf(':');
  const kind = sep > 0 ? group.slice(0, sep) : '';
  const key = sep > 0 ? group.slice(sep + 1) : '';
  if (!key) return false;
  return placements.some((p) => {
    if (kind === 'topic') return p.target_kind === 'topic' && p.target_key === key;
    if (kind === 'rank') return p.target_kind === 'rank_req' && p.target_key.startsWith(`${key}-`);
    if (kind === 'mb') {
      return (
        (p.target_kind === 'mb' && p.target_key === key) ||
        (p.target_kind === 'mb_req' && p.target_key.startsWith(`${key}-`))
      );
    }
    return false;
  });
}

export default async function AdminLibraryPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; err?: string; target?: string; saved?: string; group?: string }>;
}) {
  await requireRole(['leader']);
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? 'queue') as Tab;
  const data = await loadWorkstation();

  const pending = data.resources.filter((r) => r.status === 'pending');
  const published = data.resources.filter((r) => r.status === 'published');
  const archived = data.resources.filter((r) => r.status === 'archived');

  return (
    <div className={styles.wrap}>
      <h1 className={styles.pageTitle}>Resource Library</h1>
      <p className={styles.pageLede}>
        Everything submitted queues here first — nothing publishes until you approve it.
        Placements put one resource on many pages; pins float it to the top of a page.{' '}
        <Link href="/library" style={{ color: 'var(--navy)', fontWeight: 700 }}>
          View the public library →
        </Link>
      </p>

      {sp.err && <p className={styles.errBanner}>{sp.err}</p>}
      {sp.saved && <p className={styles.savedBanner}>Saved.</p>}

      <nav className={styles.tabs} aria-label="Library workstation sections">
        {TABS.map((t) => {
          const badge =
            t.key === 'queue' ? pending.length : t.key === 'archived' ? archived.length : 0;
          return (
            <Link
              key={t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabOn : ''}`}
              href={`/admin/library?tab=${t.key}`}
            >
              {t.label}
              {badge > 0 && <span className={styles.tabBadge}>{badge}</span>}
            </Link>
          );
        })}
      </nav>

      {tab === 'queue' &&
        (pending.length === 0 ? (
          <p className={styles.emptyTab}>The queue is empty — all caught up.</p>
        ) : (
          pending.map((res) => (
            <ResourceRow key={res.id} res={res} data={data} tab="queue" />
          ))
        ))}

      {tab === 'published' &&
        (published.length === 0 ? (
          <p className={styles.emptyTab}>Nothing published yet — approve something from the queue.</p>
        ) : sp.group ? (
          <>
            <Link className={styles.groupBack} href="/admin/library?tab=published">
              ← All groups
            </Link>
            {published
              .filter((res) =>
                resourceInGroup(res, data.placementsByResource.get(res.id) ?? [], sp.group!)
              )
              .map((res) => (
                <ResourceRow key={res.id} res={res} data={data} tab="published" group={sp.group} />
              ))}
          </>
        ) : (
          <PublishedGroups data={data} published={published} />
        ))}

      {tab === 'archived' &&
        (archived.length === 0 ? (
          <p className={styles.emptyTab}>Nothing archived.</p>
        ) : (
          archived.map((res) => (
            <ResourceRow key={res.id} res={res} data={data} tab="archived" />
          ))
        ))}

      {tab === 'topics' && <TopicsTab topics={data.catalog.topics} />}

      {tab === 'narratives' && (
        <NarrativesTab data={data} target={sp.target} />
      )}
    </div>
  );
}

// ── Published groups (initial view of the Published tab) ───────────────────

function PublishedGroups({
  data,
  published
}: {
  data: WorkstationData;
  published: LibraryResource[];
}) {
  const countFor = (group: string) =>
    published.filter((r) =>
      resourceInGroup(r, data.placementsByResource.get(r.id) ?? [], group)
    ).length;

  const topicGroups = data.catalog.topics
    .map((t) => ({
      group: `topic:${t.slug}`,
      label: `${t.icon ? `${t.icon} ` : ''}${t.title}${t.retired_at ? ' (retired)' : ''}`,
      n: countFor(`topic:${t.slug}`)
    }))
    .filter((g) => g.n > 0);
  const rankGroups = data.catalog.ranks
    .map((r) => ({ group: `rank:${r.id}`, label: r.display_name, n: countFor(`rank:${r.id}`) }))
    .filter((g) => g.n > 0);
  const mbGroups = data.catalog.mbs
    .map((m) => ({ group: `mb:${m.id}`, label: m.name, n: countFor(`mb:${m.id}`) }))
    .filter((g) => g.n > 0);
  const unplaced = countFor('unplaced');

  const section = (label: string, groups: { group: string; label: string; n: number }[]) =>
    groups.length > 0 && (
      <>
        <p className={styles.groupSectionLabel}>{label}</p>
        <div className={styles.groupGrid}>
          {groups.map((g) => (
            <Link
              key={g.group}
              className={styles.groupCard}
              href={`/admin/library?tab=published&group=${encodeURIComponent(g.group)}`}
            >
              <span className={styles.groupName}>{g.label}</span>
              <span className={styles.groupCount}>{g.n}</span>
            </Link>
          ))}
        </div>
      </>
    );

  return (
    <>
      <p className={styles.pageLede}>
        Published resources grouped the same way the public site is organized — pick a group
        to edit its items. One resource placed on several pages appears in each of its groups.
      </p>
      {section('Topic Shelves', topicGroups)}
      {section('Ranks', rankGroups)}
      {section('Merit Badges', mbGroups)}
      {unplaced > 0 &&
        section('Needs a Home', [
          { group: 'unplaced', label: 'Published but placed nowhere', n: unplaced }
        ])}
    </>
  );
}

// ── Resource row (queue / published / archived) ────────────────────────────

function ResourceRow({
  res,
  data,
  tab,
  group
}: {
  res: LibraryResource;
  data: WorkstationData;
  tab: 'queue' | 'published' | 'archived';
  group?: string;
}) {
  const placements = data.placementsByResource.get(res.id) ?? [];
  const pillClass =
    res.status === 'pending'
      ? styles.pillPending
      : res.status === 'published'
        ? styles.pillPublished
        : styles.pillArchived;

  const thumb = resourceThumbnail(res);

  return (
    <div className={styles.queueRow}>
      <div className={styles.rowHead}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.rowThumb} src={thumb} alt="" aria-hidden="true" loading="lazy" />
        ) : (
          <span aria-hidden="true">{RESOURCE_KIND_ICON[res.kind as ResourceKind]}</span>
        )}
        <span className={styles.rowTitle}>{res.title}</span>
        <span className={styles.rowMeta}>
          {res.url && /^https?:\/\//i.test(res.url) && (
            <>
              <a href={res.url} target="_blank" rel="noopener noreferrer">
                open link ↗
              </a>{' '}
              ·{' '}
            </>
          )}
          {res.submitted_by_label && (
            <>
              from <strong>{res.submitted_by_label}</strong> ·{' '}
            </>
          )}
          {new Date(res.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}
        </span>
        <span className={`${styles.statusPill} ${pillClass}`}>{res.status}</span>
      </div>

      {res.submitter_note && res.submitter_note !== res.blurb && (
        <p className={styles.rowMeta} style={{ marginBottom: 8 }}>
          Submitter&rsquo;s note: <em>&ldquo;{res.submitter_note}&rdquo;</em>
        </p>
      )}
      {res.decline_reason && (
        <p className={styles.declineReason}>Declined: {res.decline_reason}</p>
      )}

      {tab !== 'archived' ? (
        <form>
          <input type="hidden" name="id" value={res.id} />
          <input type="hidden" name="tab" value={tab} />
          {group && <input type="hidden" name="group" value={group} />}
          <div className={styles.fieldGrid}>
            <div className={styles.fieldFull}>
              <label className={styles.fieldLabel} htmlFor={`title-${res.id}`}>
                Title
              </label>
              <input
                className={styles.textInput}
                id={`title-${res.id}`}
                name="title"
                defaultValue={res.title}
              />
            </div>
            <div>
              <label className={styles.fieldLabel} htmlFor={`url-${res.id}`}>
                Link
              </label>
              <input
                className={styles.textInput}
                id={`url-${res.id}`}
                name="url"
                defaultValue={res.url ?? ''}
              />
            </div>
            <div>
              <label className={styles.fieldLabel} htmlFor={`kind-${res.id}`}>
                Kind
              </label>
              <select
                className={styles.selectInput}
                id={`kind-${res.id}`}
                name="kind"
                defaultValue={res.kind}
              >
                <option value="link">Link</option>
                <option value="video">Video</option>
                <option value="document">Document</option>
                <option value="image">Image</option>
                <option value="post">Troop Post</option>
              </select>
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.fieldLabel} htmlFor={`blurb-${res.id}`}>
                Blurb (public)
              </label>
              <input
                className={styles.textInput}
                id={`blurb-${res.id}`}
                name="blurb"
                defaultValue={res.blurb ?? ''}
              />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.fieldLabel} htmlFor={`body-${res.id}`}>
                Body markdown (posts only)
              </label>
              <textarea
                className={styles.textArea}
                id={`body-${res.id}`}
                name="body_md"
                defaultValue={res.body_md ?? ''}
              />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.fieldLabel} htmlFor={`attr-${res.id}`}>
                Public credit (blank = &ldquo;Shared by {res.submitted_by_label ?? '…'}&rdquo; at publish)
              </label>
              <input
                className={styles.textInput}
                id={`attr-${res.id}`}
                name="attribution_label"
                defaultValue={res.attribution_label ?? ''}
              />
            </div>
          </div>
          <div className={styles.actionsRow}>
            <button className={styles.btnSecondary} formAction={saveResourceAction}>
              Save
            </button>
            {tab === 'queue' && (
              <button className={styles.btnPrimary} formAction={approveResourceAction}>
                Approve &amp; Publish
              </button>
            )}
            {tab === 'published' && (
              <button className={styles.btnDanger} formAction={archiveResourceAction}>
                Archive
              </button>
            )}
          </div>
        </form>
      ) : (
        <form className={styles.actionsRow}>
          <input type="hidden" name="id" value={res.id} />
          <button className={styles.btnSecondary} formAction={restoreResourceAction}>
            Restore to Queue
          </button>
        </form>
      )}

      {tab !== 'archived' && (
        <div className={styles.placementsBlock}>
          <span className={styles.fieldLabel}>Placements</span>
          <div className={styles.placementChips}>
            {placements.length === 0 && (
              <span className={styles.rowMeta}>None yet — it won&rsquo;t appear anywhere until placed.</span>
            )}
            {placements.map((p) => {
              const href = targetHref(data.catalog, p.target_kind, p.target_key);
              const label = targetLabel(data.catalog, p.target_kind, p.target_key);
              return (
                <span key={p.id} className={styles.placementChip}>
                  {href ? <Link href={href}>{label}</Link> : label}
                  <form style={{ display: 'inline-flex', gap: 4 }}>
                    <input type="hidden" name="placement_id" value={p.id} />
                    <input type="hidden" name="pinned" value={String(p.pinned)} />
                    <input type="hidden" name="tab" value={tab} />
                    {group && <input type="hidden" name="group" value={group} />}
                    <button
                      className={`${styles.chipBtn} ${p.pinned ? styles.chipPinned : ''}`}
                      formAction={togglePinAction}
                      title={p.pinned ? 'Unpin' : 'Pin to top of its page'}
                    >
                      ★
                    </button>
                    <button
                      className={styles.chipBtn}
                      formAction={removePlacementAction}
                      title="Remove placement"
                    >
                      ×
                    </button>
                  </form>
                </span>
              );
            })}
          </div>
          <form className={styles.addPlacementForm} action={addPlacementAction}>
            <input type="hidden" name="resource_id" value={res.id} />
            <input type="hidden" name="tab" value={tab} />
            {group && <input type="hidden" name="group" value={group} />}
            <TargetSelect catalog={data.catalog} name="target" includeMbReq={false} />
            <button className={styles.btnSecondary} type="submit">
              + Place
            </button>
          </form>
        </div>
      )}

      {tab === 'queue' && (
        <form className={styles.declineForm} action={declineResourceAction}>
          <input type="hidden" name="id" value={res.id} />
          <input
            className={styles.textInput}
            name="reason"
            placeholder="Decline note (kept on the archived record)"
          />
          <button className={styles.btnDanger} type="submit">
            Decline
          </button>
        </form>
      )}
    </div>
  );
}

// ── Target select (shared: placements + narratives) ────────────────────────

function TargetSelect({
  catalog,
  name,
  defaultValue,
  includeMbReq,
  topicsAllowed = true
}: {
  catalog: Catalog;
  name: string;
  defaultValue?: string;
  includeMbReq: boolean;
  topicsAllowed?: boolean;
}) {
  return (
    <select className={styles.selectInput} name={name} defaultValue={defaultValue ?? ''}>
      <option value="">— pick a shelf or requirement —</option>
      {topicsAllowed && (
        <optgroup label="Topic shelves">
          {catalog.topics
            .filter((t) => !t.retired_at)
            .map((t) => (
              <option key={t.slug} value={`topic:${t.slug}`}>
                {t.title}
              </option>
            ))}
        </optgroup>
      )}
      {catalog.ranks.map((rank) => (
        <optgroup key={rank.id} label={`${rank.display_name} requirements`}>
          {(catalog.rankReqs.get(rank.id) ?? []).map((req) => (
            <option key={req.code} value={`rank_req:${rankReqKey(rank.id, req.code)}`}>
              {rank.display_name} {req.code} — {req.label.slice(0, 50)}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Merit badges (whole badge)">
        {catalog.mbs.map((mb) => (
          <option key={mb.id} value={`mb:${mb.id}`}>
            {mb.name}
          </option>
        ))}
      </optgroup>
      {includeMbReq && (
        <optgroup label="Merit badge requirement (type the code)">
          <option value="" disabled>
            Use “mb_req:{'{badge}'}-{'{code}'}” via placements on the badge page
          </option>
        </optgroup>
      )}
    </select>
  );
}

// ── Topics tab ─────────────────────────────────────────────────────────────

function TopicsTab({ topics }: { topics: LibraryTopic[] }) {
  return (
    <>
      {topics.map((t) => (
        <form
          key={t.id}
          className={`${styles.topicRow} ${t.retired_at ? styles.topicRetired : ''}`}
        >
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="retired" value={String(!!t.retired_at)} />
          <input
            className={styles.textInput}
            name="icon"
            defaultValue={t.icon ?? ''}
            aria-label="Icon"
            placeholder="✨"
          />
          <input
            className={styles.textInput}
            name="title"
            defaultValue={t.title}
            aria-label="Title"
          />
          <input
            className={styles.textInput}
            name="blurb"
            defaultValue={t.blurb_md ?? ''}
            aria-label="Blurb"
            placeholder="One-line shelf description"
          />
          <input
            className={styles.textInput}
            name="sort_order"
            type="number"
            defaultValue={t.sort_order}
            aria-label="Sort order"
          />
          <span className={styles.actionsRow} style={{ marginTop: 0 }}>
            <button className={styles.btnSecondary} formAction={updateTopicAction}>
              Save
            </button>
            <button className={styles.btnDanger} formAction={toggleTopicRetiredAction}>
              {t.retired_at ? 'Restore' : 'Retire'}
            </button>
          </span>
        </form>
      ))}

      <form className={styles.topicRow} action={createTopicAction} style={{ marginTop: 16 }}>
        <input className={styles.textInput} name="icon" placeholder="Icon" aria-label="Icon" />
        <input
          className={styles.textInput}
          name="title"
          placeholder="New shelf title"
          aria-label="New shelf title"
          required
        />
        <input
          className={styles.textInput}
          name="blurb"
          placeholder="One-line description"
          aria-label="Blurb"
        />
        <input
          className={styles.textInput}
          name="sort_order"
          type="number"
          defaultValue={99}
          aria-label="Sort order"
        />
        <button className={styles.btnPrimary} type="submit">
          + New Shelf
        </button>
      </form>
      <p className={styles.pageLede} style={{ marginTop: 10 }}>
        Renaming a shelf is safe — placements key on the slug, which never changes, so the
        URL and every placement survive. Retired shelves disappear from the public library
        but keep their placements for if they come back.
      </p>
    </>
  );
}

// ── Narratives tab ─────────────────────────────────────────────────────────

function NarrativesTab({
  data,
  target
}: {
  data: WorkstationData;
  target?: string;
}) {
  let existing: RequirementNote | null = null;
  if (target) {
    const sep = target.indexOf(':');
    const kind = sep > 0 ? target.slice(0, sep) : '';
    const key = sep > 0 ? target.slice(sep + 1) : '';
    existing =
      data.narratives.find((n) => n.target_kind === kind && n.target_key === key) ?? null;
  }

  return (
    <div className={styles.narrCard}>
      <p className={styles.pageLede}>
        The narrative is the free-form intro paragraph at the top of a requirement or badge
        page — what it&rsquo;s about, what&rsquo;s here, how the troop usually approaches it.
        Markdown. Pick a target, write, save. Saving empty removes it.
      </p>

      {/* Picking a target is a GET so the textarea below can prefill. */}
      <form method="get" action="/admin/library" className={styles.actionsRow}>
        <input type="hidden" name="tab" value="narratives" />
        <TargetSelect
          catalog={data.catalog}
          name="target"
          defaultValue={target}
          includeMbReq={false}
          topicsAllowed={false}
        />
        <button className={styles.btnSecondary} type="submit">
          Load
        </button>
      </form>

      {target && (
        <form action={saveNarrativeAction} style={{ marginTop: 14 }}>
          <input type="hidden" name="target" value={target} />
          <label className={styles.fieldLabel} htmlFor="narrative_md">
            Narrative for {(() => {
              const sep = target.indexOf(':');
              return targetLabel(data.catalog, target.slice(0, sep), target.slice(sep + 1));
            })()}
          </label>
          <textarea
            className={`${styles.textArea} ${styles.narrArea}`}
            id="narrative_md"
            name="narrative_md"
            defaultValue={existing?.narrative_md ?? ''}
            placeholder="This is the requirement scouts put off the longest — and the one they end up telling stories about…"
          />
          <div className={styles.actionsRow}>
            <button className={styles.btnPrimary} type="submit">
              Save Narrative
            </button>
            {existing && (
              <span className={styles.rowMeta}>
                Last saved by {existing.updated_by ?? 'unknown'} ·{' '}
                {new Date(existing.updated_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            )}
          </div>
        </form>
      )}

      {data.narratives.length > 0 && (
        <div className={styles.narrList}>
          <span className={styles.fieldLabel}>Existing narratives</span>
          {data.narratives.map((n) => (
            <div key={n.id}>
              <Link
                href={`/admin/library?tab=narratives&target=${encodeURIComponent(
                  `${n.target_kind}:${n.target_key}`
                )}`}
              >
                {targetLabel(data.catalog, n.target_kind, n.target_key)}
              </Link>{' '}
              — {n.narrative_md.slice(0, 70)}
              {n.narrative_md.length > 70 ? '…' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
