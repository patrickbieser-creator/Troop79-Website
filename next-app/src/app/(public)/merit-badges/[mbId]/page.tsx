/**
 * /merit-badges/[mbId] — Drill-in detail for one merit badge.
 *
 * Server Component. Loads the badge, its hierarchical requirements, the
 * scouts who have any progress, and renders the same scout × leaf-requirement
 * grid the prototype showed — plus the full requirement list with
 * optionality callouts beneath.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { TrackedExternalLink } from '../../_components/tracked-external-link';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { SectionDivider } from '@/app/_components/section-divider';
import { EmptyState } from '@/app/_components/empty-state';
import {
  buildReqTree,
  flattenLeaves,
  topLevelCodeOf,
  optionalityLabel,
  optionalityNote,
  bsaPageUrl,
  workbookUrl,
  type ReqNode
} from '@/lib/mb-helpers';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { publicScoutName } from '@/lib/scout-name';
import type {
  MeritBadge,
  MeritBadgeRequirement,
  Scout
} from '@/lib/supabase/types';
import s from '../merit-badges.module.css';

const RANK_LABELS: Record<string, string> = {
  scout: 'Scout',
  tenderfoot: 'Tenderfoot',
  'second-class': 'Second Class',
  'first-class': 'First Class',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

interface DetailData {
  mb: MeritBadge;
  reqTree: ReqNode[];
  leaves: ReqNode[];
  startedScouts: Scout[];
  byScout: Map<string, { awarded: boolean; codes: Set<string> }>;
  totalActive: number;
}

async function loadDetail(mbId: string): Promise<DetailData | null> {
  const supabase = createAdminClient();

  const [{ data: mb }, { data: reqRows }, ledgerRows, { data: scoutRows }, { count: totalActive }] =
    await Promise.all([
      supabase.from('merit_badges').select('*').eq('id', mbId).maybeSingle(),
      supabase.from('merit_badge_requirements').select('*').eq('mb_id', mbId),
      // Unbounded past the ~1000-row PostgREST cap once a badge accumulates
      // enough history across every scout — paginate (lib/supabase/paginate.ts).
      fetchAllRows<{ scout_id: string; kind: string; code: string }>((from, to) =>
        supabase
          .from('ledger_entries')
          .select('scout_id, kind, code')
          .or(`code.like.${mbId}-%,code.eq.MB:${mbId}`)
          .is('archived_at', null)
          .is('deleted_at', null)
          .range(from, to)
      ),
      supabase.from('scouts').select('*').eq('active', true).order('display_name'),
      supabase.from('scouts').select('id', { count: 'exact', head: true }).eq('active', true)
    ]);

  if (!mb) return null;

  const reqTree = buildReqTree((reqRows ?? []) as MeritBadgeRequirement[]);
  const leaves = flattenLeaves(reqTree);

  const byScout = new Map<string, { awarded: boolean; codes: Set<string> }>();
  for (const e of ledgerRows) {
    const slot = byScout.get(e.scout_id) ?? { awarded: false, codes: new Set<string>() };
    if (e.kind === 'merit_badge_award' && e.code === `MB:${mbId}`) {
      slot.awarded = true;
    } else if (e.code.startsWith(`${mbId}-`)) {
      slot.codes.add(e.code.slice(mbId.length + 1));
    }
    byScout.set(e.scout_id, slot);
  }

  const allScouts = (scoutRows ?? []) as Scout[];
  const startedScouts = allScouts.filter((s2) => byScout.has(s2.id));

  return {
    mb: mb as MeritBadge,
    reqTree,
    leaves,
    startedScouts,
    byScout,
    totalActive: totalActive ?? 0
  };
}

export default async function MeritBadgeDetailPage({
  params
}: {
  params: Promise<{ mbId: string }>;
}) {
  const { mbId } = await params;
  const data = await loadDetail(mbId);
  if (!data) notFound();

  const { mb, reqTree, leaves, startedScouts, byScout, totalActive } = data;
  const completedCount = startedScouts.filter((sc) => byScout.get(sc.id)!.awarded).length;
  const partialCount = startedScouts.length - completedCount;
  const notStarted = Math.max(totalActive - startedScouts.length, 0);

  // Pre-compute group boundaries for the two-row table header + visual separators.
  const groups: { topCode: string; topNode: ReqNode; spans: number }[] = [];
  for (const top of reqTree) {
    const groupLeaves = leaves.filter((l) => topLevelCodeOf(reqTree, l.code) === top.code);
    if (groupLeaves.length > 0) groups.push({ topCode: top.code, topNode: top, spans: groupLeaves.length });
  }
  const groupStartCodes = new Set(groups.map((g) => leaves.find((l) => topLevelCodeOf(reqTree, l.code) === g.topCode)!.code));

  return (
    <>
      <PageHeader
        kicker={<Link href="/merit-badges">← All Merit Badges</Link>}
        title={
          <>
            {mb.name}
            {mb.eagle && <span className={s.eagleTagLarge}>Eagle</span>}
          </>
        }
        lede={
          <>
            {mb.eagle ? 'Eagle-required' : 'Elective'} merit badge — completed and
            in-progress work shown below, scout-by-scout, requirement-by-requirement.
            <span className={s.actionRow}>
              <ExternLink href={bsaPageUrl(mb)} mbId={mb.id} linkType="official">
                Official BSA page ↗
              </ExternLink>
              <ExternLink href={workbookUrl(mb)} mbId={mb.id} linkType="workbook">
                Workbook (PDF) ↗
              </ExternLink>
              <Link href={`/library/mb/${mbId}`} className={`${s.actionLink} ${s.actionLinkForest}`}>
                Troop Library resources
              </Link>
            </span>
          </>
        }
      />

      <PageShell>
        {/* Stats strip */}
        <div className={s.statStrip}>
          <Stat label="Earned" n={completedCount} tone={s.statForest} />
          <Stat label="In Progress" n={partialCount} tone={s.statNavy} />
          <Stat label="Not Started" n={notStarted} tone={s.statMeta} />
          <Stat label="Active Scouts" n={totalActive} tone={s.statNavy} />
        </div>

        <SectionDivider label="Scout Progress" />

        {startedScouts.length === 0 ? (
          <EmptyState>No scouts have started this merit badge yet.</EmptyState>
        ) : (
          <div className={s.gridScroller}>
            <table className={s.grid}>
              <thead>
                <tr>
                  <th rowSpan={2} className={s.scoutHead}>Scout</th>
                  <th className={s.awardHead} title="Full merit badge earned">AWARD</th>
                  {groups.map((g) => (
                    <th
                      key={g.topCode}
                      colSpan={g.spans}
                      title={`Req ${g.topCode} — ${g.topNode.label}`}
                      className={s.groupHead}
                    >
                      Req {g.topCode}
                      {optionalityLabel(g.topNode) && (
                        <span className={s.groupRule}>{optionalityLabel(g.topNode)}</span>
                      )}
                    </th>
                  ))}
                </tr>
                <tr>
                  {/* Award's row-2 band — same padding/font as .leafHead so its
                      combined height with the row above matches the Req-group
                      columns exactly, instead of a rowSpan={2} cell leaving
                      mismatched blank space against the gold fill. */}
                  <th className={s.awardSubHead} aria-hidden="true" />
                  {leaves.map((l) => (
                    <th
                      key={l.code}
                      title={`${l.code} — ${l.label}`}
                      className={
                        groupStartCodes.has(l.code) ? `${s.leafHead} ${s.groupStart}` : s.leafHead
                      }
                    >
                      {l.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {startedScouts.map((sc) => {
                  const slot = byScout.get(sc.id)!;
                  const name = publicScoutName(sc);
                  return (
                    <tr key={sc.id}>
                      <td className={s.scoutCell}>
                        <Link href={`/advancement/${sc.id}`}>{name}</Link>
                        <span className={s.rankPill}>
                          {RANK_LABELS[sc.current_rank ?? ''] ?? sc.current_rank}
                        </span>
                      </td>
                      <td
                        title={`${name} — ${slot.awarded ? 'badge earned' : 'not yet awarded'}`}
                        className={slot.awarded ? `${s.awardCell} ${s.awardCellDone}` : s.awardCell}
                      >
                        {slot.awarded ? '★' : '☆'}
                      </td>
                      {leaves.map((l) => {
                        const done = slot.codes.has(l.code);
                        const cls = [s.cell, done ? s.cellDone : null, groupStartCodes.has(l.code) ? s.groupStart : null]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <td key={l.code} title={`${name} — ${l.code} — ${l.label}`} className={cls}>
                            {done ? '■' : '□'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <SectionDivider label="Requirements" />

        <div className={s.reqCard}>
          <p className={s.reqDisclaimer}>
            From the official BSA merit badge pamphlet — wording is paraphrased in this
            prototype. Confirm against the current pamphlet for sign-off.
          </p>
          <RequirementsTree nodes={reqTree} depth={0} />
        </div>
      </PageShell>
    </>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────

function ExternLink({
  href,
  mbId,
  linkType,
  children
}: {
  href: string;
  mbId: string;
  linkType: 'official' | 'workbook';
  children: React.ReactNode;
}) {
  return (
    <TrackedExternalLink
      href={href}
      event="outbound_bsa_click"
      params={{ mb_id: mbId, link_type: linkType }}
      className={s.actionLink}
    >
      {children}
    </TrackedExternalLink>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className={s.stat}>
      <div className={`${s.statNum} ${tone}`}>{n}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function RequirementsTree({ nodes, depth }: { nodes: ReqNode[]; depth: number }) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const note = optionalityNote(node);
        // Top-level reqs always render as parent-style headings even when childless.
        if (!hasChildren && depth > 0) {
          return (
            <div
              key={node.id}
              className={s.reqLeaf}
              style={{ marginLeft: depth * 20 }} /* dynamic: indent computed from tree depth */
            >
              <span className={s.reqTag}>{node.code}</span> {node.label}
            </div>
          );
        }
        return (
          <div
            key={node.id}
            className={depth === 0 ? `${s.reqParent} ${s.reqParentTop}` : s.reqParent}
            style={{ marginLeft: depth * 20 }} /* dynamic: indent computed from tree depth */
          >
            <div className={s.reqParentHead}>
              <span className={`${s.reqTag} ${s.reqTagLarge}`}>{node.code}</span>
              {node.label}
            </div>
            {note && (
              <div className={s.reqNote}>
                <span className={s.reqNoteLabel}>Note:</span>
                {note}
              </div>
            )}
            {hasChildren && (
              <div className={s.reqChildren}>
                <RequirementsTree nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
