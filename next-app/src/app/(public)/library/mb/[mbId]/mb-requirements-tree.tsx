import type { ReactNode } from 'react';
import Link from 'next/link';
import { flattenLeaves, optionalityNote, type ReqNode } from '@/lib/mb-helpers';
import type { LibraryViewer } from '@/lib/library-viewer';
import type { MbPageResources, MbRequirementNote, PlacedResource } from '@/lib/library-data';
import { detectHost, resourceThumbnail, RESOURCE_KIND_ICON, RESOURCE_KIND_LABEL } from '@/lib/library';
import { fmtDate } from '@/lib/format-date';
import { centralToday } from '@/lib/dates';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { TrackedExternalLink } from '../../../_components/tracked-external-link';
import { ResourceCard } from '../../_components/resource-card';
import { MbRequirementRows, type MbRow } from './mb-requirement-rows';
import { MbLegend } from './mb-legend';
import styles from '../../library.module.css';
import s from './mb-tracker.module.css';

/**
 * THE consolidated Requirements section of /library/mb/[mbId]
 * (Plans/Library-MB-Consolidation.md, Phase 2 — prototype rev 4 approved by
 * Patrick 2026-09-07). Until then the page stacked FOUR things after the
 * grid — this tree (read-only), a "Whole-badge resources" divider, one
 * divider per top-level requirement with resources, and an "I did this"
 * radio picker listing every leaf again — so one leaf's code and label
 * rendered three times and "suggest" and "claim" hung off the same leaf
 * from two distant scroll positions. Patrick: "There's no reason for the
 * redundancy."
 *
 * SERVER COMPONENT that SHAPES; MbRequirementRows (client) only toggles.
 * Every row's resources and counselor note are rendered HERE — so
 * ResourceCard / TrackedExternalLink / ArticleBody stay server-rendered and
 * the client bundle carries no data loaders — and handed across as
 * ReactNodes. The client half receives strings, hrefs and nodes; nothing it
 * gets needs serialising beyond what React already does.
 *
 * ROW GRAMMAR at rest (Patrick, "reduce the noise"): code · label · a small
 * dated Done/Pending pill for the ONE selected scout · up to three icons at
 * the right edge. "For the whole badge" is the first row of the same list
 * (ghost MB tag) — whole-badge placements are the one thing that was NOT
 * redundant with a leaf and must not be folded under requirement 1 (that
 * misattributes scope).
 *
 * WHOSE PROGRESS: `viewer` (lib/library-viewer.ts, ?viewScout=) names the
 * one scout; `doneDates` is that scout's fold from the ledger and
 * `pendingByLeaf` their proofs still in the queue. A visitor gets no pills,
 * no claim icons and a legend without "I did this".
 */
export function MbRequirementsTree({
  mbId,
  nodes,
  viewer,
  pendingByLeaf,
  resources,
  notes,
  doneDates,
  canClaim,
  scoutBlocked = false,
  anchorId = 'i-did-this'
}: {
  mbId: string;
  nodes: ReqNode[];
  viewer?: LibraryViewer;
  /** leaf code → scout ids with a proof still pending (the viewer's own scouts only). */
  pendingByLeaf?: ReadonlyMap<string, ReadonlySet<string>>;
  resources: MbPageResources;
  /** Per-requirement counselor notes, by code. */
  notes: ReadonlyMap<string, MbRequirementNote>;
  /** The selected scout's code → completion date ('YYYY-MM-DD'). */
  doneDates?: ReadonlyMap<string, string>;
  /** The viewer may submit proof (verified adult or verified scout, or a leader proxying as this scout — lib/library.ts canClaimProof). */
  canClaim: boolean;
  /** The OLD shared scout login — can never submit proof; say so once at the top. */
  scoutBlocked?: boolean;
  anchorId?: string;
}) {
  const scoutId = viewer?.kind === 'scout' ? viewer.scoutId : null;
  const scoutName = viewer?.kind === 'scout' ? viewer.scoutName : null;
  const thisYear = centralToday().slice(0, 4);

  const pillFor = (code: string): MbRow['pill'] => {
    if (!scoutId || !scoutName) return null;
    const done = doneDates?.get(code);
    if (done) {
      return {
        state: 'done',
        text: `Done · ${fmtDate(done, { year: done.slice(0, 4) !== thisYear })}`,
        title: `${scoutName} — done ${fmtDate(done)}`
      };
    }
    if (pendingByLeaf?.get(code)?.has(scoutId)) {
      return { state: 'pending', text: 'Pending', title: `${scoutName} — proof waiting for a leader` };
    }
    return null;
  };

  const suggestHref = (code: string) =>
    `/library/submit?target=${encodeURIComponent(`mb_req:${mbId}-${code}`)}`;
  const proofHref = (code: string) =>
    `/library/submit-proof?target=${encodeURIComponent(`mb_req:${mbId}-${code}`)}&scout=${encodeURIComponent(scoutId ?? '')}`;

  const rowFor = (node: ReqNode, top: boolean): MbRow => {
    const hasKids = node.children.length > 0;
    const placed = resources.byLeafCode.get(node.code) ?? [];
    const note = notes.get(node.code) ?? null;
    const detail = renderDetail(placed, note);
    const pill = hasKids ? null : pillFor(node.code);
    // A parent has no ledger row of its own — same rule as ranks — so no
    // claim; a leaf gets one only while the selected scout still needs it.
    const claim = !hasKids && canClaim && scoutId && pill === null;

    let frac: string | undefined;
    if (hasKids && scoutId && doneDates) {
      const leaves = flattenLeaves(node.children);
      const k = leaves.filter((l) => doneDates.has(l.code)).length;
      if (k > 0) frac = `${k}/${leaves.length}`;
    }

    return {
      key: String(node.id),
      code: node.code,
      label: node.label,
      top,
      note: optionalityNote(node) || undefined,
      frac,
      pill,
      what: node.code,
      count: detail.count,
      detail: detail.first,
      more: detail.rest,
      moreCount: detail.restCount,
      proofHref: claim ? proofHref(node.code) : null,
      suggestHref: suggestHref(node.code),
      children: node.children.map((c) => rowFor(c, false))
    };
  };

  const whole = renderDetail(resources.wholeBadge, null);
  const wholeRow: MbRow = {
    key: 'mb',
    code: 'MB',
    ghost: true,
    label: 'For the whole badge',
    top: true,
    pill: null,
    what: 'whole badge',
    count: whole.count,
    detail: whole.first,
    more: whole.rest,
    moreCount: whole.restCount,
    proofHref: null,
    suggestHref: `/library/submit?target=${encodeURIComponent(`mb:${mbId}`)}`,
    children: []
  };

  const rows = [wholeRow, ...nodes.map((n) => rowFor(n, true))];

  const intro = (
    <>
      <p className={s.reqDisclaimer}>
        From the official BSA merit badge pamphlet — wording is paraphrased here. Confirm
        against the current pamphlet for sign-off.
      </p>
      <MbLegend showClaim={canClaim} />
      {scoutBlocked && (
        <p className={s.reqHint}>
          Scouts: proof can&rsquo;t be submitted from this login yet — ask a parent to send it
          in, or show a leader in person.
        </p>
      )}
      {!scoutBlocked && !scoutId && (
        <p className={s.reqHint}>
          <Link href={`/signin?next=${encodeURIComponent(`/library/mb/${mbId}`)}`}>Sign in</Link>{' '}
          to see your scout&rsquo;s progress on each requirement and to send in proof when one
          is done.
        </p>
      )}
    </>
  );

  return <MbRequirementRows rows={rows} anchorId={anchorId} intro={intro} />;
}

const INLINE_CAP = 3;

/**
 * The opened row: one quiet line per resource (pinned first — the loader
 * already sorted them — with a ★ before the title), then the counselor note.
 * The count on the View-resources icon is resources + 1 for a note, so a row
 * with only a note still has something to open. Past three resources the
 * rest hide behind "+N more" (Jenna's cap; expands in place).
 */
function renderDetail(
  placed: PlacedResource[],
  note: MbRequirementNote | null
): { count: number; first: ReactNode; rest: ReactNode; restCount: number } {
  const count = placed.length + (note ? 1 : 0);
  if (count === 0) return { count: 0, first: null, rest: null, restCount: 0 };
  const head = placed.slice(0, INLINE_CAP);
  const tail = placed.slice(INLINE_CAP);
  return {
    count,
    first: (
      <>
        {head.map((r) => (
          <ResourceLine key={r.placement.id} resource={r} />
        ))}
        {note && (
          <div className={s.note}>
            <ArticleBody body={note.narrative_md} />
            {note.updated_by && <span className={s.noteBy}>— {note.updated_by}</span>}
          </div>
        )}
      </>
    ),
    rest:
      tail.length > 0 ? (
        <>
          {tail.map((r) => (
            <ResourceLine key={r.placement.id} resource={r} />
          ))}
        </>
      ) : null,
    restCount: tail.length
  };
}

/**
 * Compact one-liner: kind glyph (or the YouTube still — a static <img> that
 * LINKS OUT, never an embed, same as ResourceCard) · ★ if pinned · title ·
 * muted host. A troop-written post has no address to link to, so it keeps
 * the full ResourceCard and renders its body inline.
 */
function ResourceLine({ resource }: { resource: PlacedResource }) {
  const pinned = resource.placement.pinned;
  if (resource.kind === 'post') {
    return (
      <ul className={styles.resourceList}>
        <ResourceCard resource={resource} pinned={pinned} />
      </ul>
    );
  }
  const host = resource.host ?? detectHost(resource.url) ?? RESOURCE_KIND_LABEL[resource.kind];
  // Render-side guard on top of the write-path check (same as ResourceCard):
  // only http(s) URLs become clickable.
  const safeUrl = resource.url && /^https?:\/\//i.test(resource.url) ? resource.url : null;
  const thumb = resourceThumbnail(resource);
  const title = (
    <>
      {pinned && (
        <span className={s.resStar} aria-hidden="true">
          ★
        </span>
      )}
      {resource.title}
    </>
  );
  return (
    <div className={s.res}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.resThumb} src={thumb} alt="" aria-hidden="true" loading="lazy" />
      ) : (
        <span className={s.resIco} aria-hidden="true">
          {RESOURCE_KIND_ICON[resource.kind]}
        </span>
      )}
      <span className={s.resLine}>
        <span className={s.srOnly}>
          {RESOURCE_KIND_LABEL[resource.kind]}
          {pinned ? ', pinned' : ''}:{' '}
        </span>
        {safeUrl ? (
          <TrackedExternalLink
            className={s.resTitle}
            href={safeUrl}
            event="library_resource_click"
            params={{ resource_id: resource.id, resource_kind: resource.kind }}
          >
            {title} ↗
          </TrackedExternalLink>
        ) : (
          <span className={s.resTitle}>{title}</span>
        )}
        <span className={s.resHost}>{host}</span>
      </span>
    </div>
  );
}
