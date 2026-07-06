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
import { createClient } from '@/lib/supabase/server';
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
import type {
  MeritBadge,
  MeritBadgeRequirement,
  Scout
} from '@/lib/supabase/types';

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
  const supabase = await createClient();

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
  const startedScouts = allScouts.filter((s) => byScout.has(s.id));

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
  const completedCount = startedScouts.filter((s) => byScout.get(s.id)!.awarded).length;
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
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 0' }}>
        <Link
          href="/merit-badges"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--navy)',
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            display: 'inline-block',
            marginBottom: 8
          }}
        >
          ← All Merit Badges
        </Link>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 36,
            fontWeight: 700,
            color: 'var(--text-head)',
            letterSpacing: '-.01em',
            marginBottom: 6
          }}
        >
          {mb.name}
          {mb.eagle && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--bark)',
                background: '#f6e7c4',
                padding: '4px 10px',
                borderRadius: 999,
                marginLeft: 12,
                verticalAlign: 6
              }}
            >
              Eagle
            </span>
          )}
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            color: 'var(--text-body)',
            lineHeight: 1.6,
            maxWidth: 760
          }}
        >
          {mb.eagle ? 'Eagle-required' : 'Elective'} merit badge — completed and
          in-progress work shown below, scout-by-scout, requirement-by-requirement.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
          <ExternLink href={bsaPageUrl(mb)}>Official BSA page ↗</ExternLink>
          <ExternLink href={workbookUrl(mb)}>Workbook (PDF) ↗</ExternLink>
        </div>
        <div style={{ height: 2, background: 'var(--border-mid)', marginTop: 20 }} />
      </div>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 60px' }}>
        {/* Stats strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            background: 'var(--warm-white)',
            border: '1px solid var(--border-light)',
            boxShadow: 'var(--shadow-card)',
            marginBottom: 22
          }}
        >
          <Stat label="Earned" n={completedCount} color="var(--forest)" />
          <Stat label="In Progress" n={partialCount} color="var(--navy)" />
          <Stat label="Not Started" n={notStarted} color="var(--text-meta)" />
          <Stat label="Active Scouts" n={totalActive} color="var(--navy)" />
        </div>

        <SectionDivider label="Scout Progress" />

        {startedScouts.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-meta)',
              fontStyle: 'italic',
              background: 'var(--warm-white)',
              border: '1px solid var(--border-light)'
            }}
          >
            No scouts have started this merit badge yet.
          </div>
        ) : (
          <div
            style={{
              overflow: 'auto',
              maxHeight: '70vh',
              border: '1px solid var(--border-light)',
              background: 'var(--warm-white)',
              boxShadow: 'var(--shadow-card)'
            }}
          >
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--font-ui)', fontSize: 12, width: 'max-content' }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={stickyScoutHeadStyle}>Scout</th>
                  <th style={awardHeadStyle} title="Full merit badge earned">AWARD</th>
                  {groups.map((g) => (
                    <th
                      key={g.topCode}
                      colSpan={g.spans}
                      title={`Req ${g.topCode} — ${g.topNode.label}`}
                      style={groupHeadStyle}
                    >
                      Req {g.topCode}
                      {optionalityLabel(g.topNode) && <GroupRule rule={optionalityLabel(g.topNode)} />}
                    </th>
                  ))}
                </tr>
                <tr>
                  {/* Award's row-2 band — same padding/font as leafHeadStyle so
                      its combined height with the row above matches the
                      Req-group columns exactly, instead of a rowSpan={2} cell
                      leaving mismatched blank space against the gold fill. */}
                  <th style={awardSubHeadStyle} aria-hidden="true" />
                  {leaves.map((l) => (
                    <th
                      key={l.code}
                      title={`${l.code} — ${l.label}`}
                      style={leafHeadStyle(groupStartCodes.has(l.code))}
                    >
                      {l.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {startedScouts.map((s) => {
                  const slot = byScout.get(s.id)!;
                  return (
                    <tr key={s.id}>
                      <td style={stickyScoutCellStyle}>
                        <Link
                          href={`/advancement/${s.id}`}
                          style={{ color: 'var(--text-head)', fontWeight: 600 }}
                        >
                          {s.display_name}
                        </Link>
                        <span style={rankPillStyle}>{RANK_LABELS[s.current_rank ?? ''] ?? s.current_rank}</span>
                      </td>
                      <td
                        title={`${s.display_name} — ${slot.awarded ? 'badge earned' : 'not yet awarded'}`}
                        style={awardCellStyle(slot.awarded)}
                      >
                        {slot.awarded ? '★' : '☆'}
                      </td>
                      {leaves.map((l) => {
                        const done = slot.codes.has(l.code);
                        return (
                          <td
                            key={l.code}
                            title={`${s.display_name} — ${l.code} — ${l.label}`}
                            style={cellStyle(done, groupStartCodes.has(l.code))}
                          >
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

        <div
          style={{
            background: 'var(--warm-white)',
            border: '1px solid var(--border-light)',
            boxShadow: 'var(--shadow-card)',
            padding: '20px 22px'
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--text-meta)',
              paddingBottom: 12,
              marginBottom: 14,
              borderBottom: '1px dashed var(--border-light)'
            }}
          >
            From the official BSA merit badge pamphlet — wording is paraphrased in this
            prototype. Confirm against the current pamphlet for sign-off.
          </p>
          <RequirementsTree nodes={reqTree} depth={0} />
        </div>
      </main>
    </>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────

function ExternLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        color: 'var(--navy)',
        padding: '8px 16px',
        border: '1px solid var(--navy)',
        borderRadius: 2,
        transition: 'background .18s ease, color .18s ease'
      }}
    >
      {children}
    </a>
  );
}

function Stat({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ padding: '18px 20px', textAlign: 'center', borderRight: '1px solid var(--border-light)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{n}</div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--text-meta)',
          marginTop: 6
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 12px' }}>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color: 'var(--text-meta)'
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--border-mid)' }} aria-hidden />
    </div>
  );
}

function GroupRule({ rule }: { rule: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 8,
        fontFamily: 'var(--font-ui)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--bark)',
        background: '#f6e7c4',
        padding: '2px 8px',
        borderRadius: 999,
        verticalAlign: 1
      }}
    >
      {rule}
    </span>
  );
}

function RequirementsTree({ nodes, depth }: { nodes: ReqNode[]; depth: number }) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const note = optionalityNote(node);
        const indent = depth * 20;
        // Top-level reqs always render as parent-style headings even when childless.
        if (!hasChildren && depth > 0) {
          return (
            <div
              key={node.id}
              style={{
                marginLeft: indent,
                padding: '3px 0 3px 12px',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                color: 'var(--text-body)',
                lineHeight: 1.5
              }}
            >
              <ReqTag>{node.code}</ReqTag> {node.label}
            </div>
          );
        }
        return (
          <div
            key={node.id}
            style={{
              marginLeft: indent,
              padding: '12px 0',
              borderBottom: depth === 0 ? '1px solid var(--border-light)' : 'none'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--navy)',
                marginBottom: 6
              }}
            >
              <ReqTag large>{node.code}</ReqTag>
              {node.label}
            </div>
            {note && (
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontStyle: 'italic',
                  fontWeight: 600,
                  color: 'var(--bark)',
                  background: '#f6e7c4',
                  borderLeft: '3px solid #c79a2e',
                  padding: '8px 14px',
                  margin: '8px 0 4px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  borderRadius: '0 2px 2px 0'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontStyle: 'normal',
                    fontWeight: 700,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    fontSize: 10,
                    marginRight: 6,
                    verticalAlign: 2
                  }}
                >
                  Note:
                </span>
                {note}
              </div>
            )}
            {hasChildren && (
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                <RequirementsTree nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ReqTag({ children, large }: { children: React.ReactNode; large?: boolean }) {
  return (
    <span
      style={{
        fontFamily: 'ui-monospace, monospace',
        background: 'var(--navy)',
        color: 'var(--warm-white)',
        padding: large ? '3px 10px' : '2px 8px',
        borderRadius: 999,
        fontSize: large ? 12 : 11,
        fontWeight: 700,
        marginRight: 8
      }}
    >
      {children}
    </span>
  );
}

// ── Inline styles for the grid (kept here to keep the page self-contained) ─

const stickyScoutHeadStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  top: 0,
  background: 'var(--cream)',
  zIndex: 4,
  minWidth: 200,
  padding: '8px 10px',
  borderRight: '2px solid var(--border-mid)',
  borderBottom: '2px solid var(--navy)',
  textAlign: 'left',
  fontSize: 11,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--text-meta)'
};

const groupHeadStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: 'var(--cream)',
  color: 'var(--navy)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.02em',
  padding: '10px 8px',
  textAlign: 'center',
  borderBottom: '2px solid var(--navy)',
  borderRight: '1px solid var(--border-light)'
};

function leafHeadStyle(groupStart: boolean): React.CSSProperties {
  return {
    position: 'sticky',
    top: 0,
    zIndex: 3,
    minWidth: 46,
    padding: '8px 4px',
    textAlign: 'center',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
    fontWeight: 700,
    background: 'var(--newsprint)',
    color: 'var(--navy)',
    borderLeft: groupStart ? '2px solid var(--navy)' : '1px solid var(--border-light)',
    borderRight: '1px solid var(--border-light)'
  };
}

// Sticky immediately right of the Scout column (same left-anchored group, so
// it stays visible alongside the scout name while the requirement columns
// scroll underneath) — matches Scout's minWidth for the offset.
const awardHeadStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  left: 200,
  zIndex: 4,
  minWidth: 60,
  padding: '10px 8px',
  background: '#f6e7c4',
  color: 'var(--bark)',
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '.04em',
  borderRight: '2px solid var(--bark)',
  borderBottom: '2px solid var(--navy)'
};

// Row-2 band under AWARD — same padding/font as leafHeadStyle (no border of
// its own, matching how the leaf-code row has none either) so the two
// stacked cells' combined height equals a Req-group column's height exactly.
const awardSubHeadStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  left: 200,
  zIndex: 4,
  minWidth: 60,
  padding: '8px 4px',
  background: '#f6e7c4',
  borderRight: '2px solid var(--bark)'
};

const stickyScoutCellStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: 'var(--warm-white)',
  zIndex: 2,
  padding: '6px 10px',
  minWidth: 200,
  borderRight: '2px solid var(--border-mid)',
  borderBottom: '1px solid var(--border-light)',
  fontFamily: 'var(--font-body)',
  fontSize: 13
};

const rankPillStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 9,
  letterSpacing: '.04em',
  color: 'var(--text-meta)',
  padding: '1px 6px',
  background: 'var(--newsprint)',
  borderRadius: 999,
  marginLeft: 8,
  fontWeight: 700,
  textTransform: 'uppercase'
};

function cellStyle(done: boolean, groupStart: boolean): React.CSSProperties {
  return {
    width: 46,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 700,
    padding: '6px 8px',
    color: done ? 'var(--forest)' : 'var(--border-mid)',
    background: done ? '#e8f4ec' : 'transparent',
    borderLeft: groupStart ? '2px solid var(--navy)' : '1px solid var(--border-light)',
    borderBottom: '1px solid var(--border-light)'
  };
}

function awardCellStyle(awarded: boolean): React.CSSProperties {
  return {
    position: 'sticky',
    left: 200,
    zIndex: 2,
    width: 60,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 700,
    padding: '6px 8px',
    color: awarded ? '#5a3a00' : 'var(--bark)',
    // Sticky cells need an opaque background — "transparent" would let
    // scrolled-under requirement cells show through.
    background: awarded ? '#f5d76a' : 'var(--warm-white)',
    borderRight: '2px solid var(--bark)',
    borderBottom: '1px solid var(--border-light)'
  };
}
