/**
 * The merit badge tracker's data fold — who has done what on one badge.
 *
 * EXTRACTED 2026-08-22, when Patrick folded the public merit badge tracker
 * into the Resource Library ("so that the library is the one place where you
 * go for merit badges, not two different places") and retired /merit-badges.
 *
 * This exact fold existed BYTE-FOR-BYTE in two files — the public tracker
 * page and the admin MB Progress drill-in. The public copy is deleted with its
 * route; this module is what the Library now uses, and it is deliberately
 * neutral (no server client, no JSX, no tokens) so the ADMIN side can adopt it
 * in its follow-up without a cross-import. The admin↔public firewall forbids
 * sharing through either app tree; a lib module is the sanctioned mechanism,
 * exactly as lib/mb-helpers.ts already is for the requirement tree.
 *
 * THE COMPOSITE CODE CONVENTION is the load-bearing part:
 *   award       kind='merit_badge_award', code='MB:{mbId}'
 *   requirement code='{mbId}-{code}'
 * Badge ids contain hyphens ('citizenship-in-society'), so the prefix is
 * sliced by LENGTH, never by splitting on '-'. Getting that wrong shows every
 * scout as having done nothing while the data is perfect — which is why it has
 * its own test.
 */

import type { ReqNode } from '@/lib/mb-helpers';
import { topLevelCodeOf } from '@/lib/mb-helpers';

/** The three ledger columns this fold needs. */
export interface MbLedgerRow {
  scout_id: string;
  kind: string;
  code: string;
}

/** The scout fields the grid needs — structural, so both a full `Scout` row
 *  and a trimmed select satisfy it. */
export interface MbScoutLike {
  id: string;
  first_name: string;
  last_name: string;
  current_rank: string | null;
}

export interface MbScoutSlot {
  awarded: boolean;
  /** Leaf requirement codes, badge prefix already stripped ("1a", not "archery-1a"). */
  codes: Set<string>;
}

/**
 * scout_id → what they have done on this badge.
 *
 * Callers pass rows already filtered to this badge by the query
 * (`code.like.{mbId}-%,code.eq.MB:{mbId}`), but the fold re-checks anyway: the
 * `like` is a prefix match, and a future badge id that prefixes another would
 * otherwise leak rows across badges silently.
 */
export function foldLedger(rows: MbLedgerRow[], mbId: string): Map<string, MbScoutSlot> {
  const byScout = new Map<string, MbScoutSlot>();
  const awardCode = `MB:${mbId}`;
  const reqPrefix = `${mbId}-`;
  for (const row of rows) {
    const slot = byScout.get(row.scout_id) ?? { awarded: false, codes: new Set<string>() };
    if (row.kind === 'merit_badge_award' && row.code === awardCode) {
      slot.awarded = true;
    } else if (row.code.startsWith(reqPrefix)) {
      slot.codes.add(row.code.slice(reqPrefix.length));
    }
    byScout.set(row.scout_id, slot);
  }
  return byScout;
}

/** Active scouts who have any progress on this badge, in the order given
 *  (the query orders by display_name). */
export function startedScouts<T extends MbScoutLike>(
  allScouts: T[],
  byScout: ReadonlyMap<string, MbScoutSlot>
): T[] {
  return allScouts.filter((s) => byScout.has(s.id));
}

export interface MbStats {
  earned: number;
  inProgress: number;
  notStarted: number;
  totalActive: number;
}

/** The stat strip. `notStarted` is clamped at zero: an inactive scout with
 *  history can push started past the active count, and "-3 not started" is
 *  worse than a floor. */
export function mbStats(
  started: MbScoutLike[],
  byScout: ReadonlyMap<string, MbScoutSlot>,
  totalActive: number
): MbStats {
  const earned = started.filter((s) => byScout.get(s.id)?.awarded).length;
  return {
    earned,
    inProgress: started.length - earned,
    notStarted: Math.max(totalActive - started.length, 0),
    totalActive
  };
}

export interface MbGridGroup {
  topCode: string;
  topNode: ReqNode;
  /** How many leaf columns this top-level requirement spans. */
  spans: number;
}

export interface MbGridGroups {
  groups: MbGridGroup[];
  /** The first leaf code of each group — where the separator rule is drawn. */
  groupStartCodes: Set<string>;
}

/**
 * The grid's two-row header: one banded column group per top-level
 * requirement, spanning its leaves.
 *
 * A group with zero leaves is dropped rather than emitted with `colSpan={0}`,
 * which browsers treat as "span the rest of the row" and would shear the
 * header off its columns.
 */
export function gridGroups(reqTree: ReqNode[], leaves: ReqNode[]): MbGridGroups {
  const groups: MbGridGroup[] = [];
  const groupStartCodes = new Set<string>();
  for (const top of reqTree) {
    const groupLeaves = leaves.filter((l) => topLevelCodeOf(reqTree, l.code) === top.code);
    if (groupLeaves.length === 0) continue;
    groups.push({ topCode: top.code, topNode: top, spans: groupLeaves.length });
    groupStartCodes.add(groupLeaves[0].code);
  }
  return { groups, groupStartCodes };
}

const RANK_LABELS: Record<string, string> = {
  scout: 'Scout',
  tenderfoot: 'Tenderfoot',
  'second-class': 'Second Class',
  'first-class': 'First Class',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

/** Display name for a rank id; the raw value for anything unmapped, so a new
 *  rank shows as itself rather than vanishing. */
export function rankLabel(rank: string | null): string | null {
  if (!rank) return null;
  return RANK_LABELS[rank] ?? rank;
}

// ── The library catalog's Resources / Progress toggle ───────────────────────

/**
 * What the single number on a merit badge tile counts (Patrick, 2026-08-22).
 *
 * The retired /merit-badges catalog put Earned / In-progress / Not-started on
 * every tile. Against the live data that is mostly noise: across 69 badges,
 * Earned is non-zero on 63, In-progress on only 13, and Not-started is purely
 * derived (`activeScouts − started`). Three numbers × 69 tiles is ~207 figures
 * with roughly 120 zeros.
 *
 * So the tile keeps ONE number and the reader chooses which noun it counts.
 * The full triple still appears on the badge page's stat strip — nothing is
 * lost, it is just not all on the catalog at once.
 */
export const MB_GRID_MODES = ['resources', 'progress'] as const;
export type MbGridMode = (typeof MB_GRID_MODES)[number];

/** Today's behaviour stays the default — the toggle adds a view, it does not
 *  change what an unaware visitor sees. */
export const DEFAULT_MB_GRID_MODE: MbGridMode = 'resources';

export const MB_GRID_MODE_LABELS: Record<MbGridMode, string> = {
  resources: 'Resources',
  progress: 'Progress'
};

/** Narrow an untrusted string (a URL param, a localStorage value). */
export function isMbGridMode(v: string | null | undefined): v is MbGridMode {
  return !!v && (MB_GRID_MODES as readonly string[]).includes(v);
}

/** A bare integer on a tile is ambiguous once it can mean two things, so the
 *  grid always says which noun is on screen. */
export function mbGridCaption(mode: MbGridMode): string {
  return mode === 'progress'
    ? 'Showing how many scouts have earned each badge.'
    : 'Showing how many resources are shelved for each badge.';
}

/**
 * mbId → how many ACTIVE scouts have earned it, for the grid's Progress mode.
 *
 * ACTIVE-ONLY is the whole point. Found in dev 2026-08-22: counting every
 * `mb_progress` row with `awarded` made the grid say Archery 12 while the badge
 * page one click away said 6 earned. Both were arithmetically right and they
 * counted different nouns — every award ever recorded, versus scouts currently
 * in the troop. The badge page's reading is the honest one for a catalog
 * ("how many scouts have earned this"), and the two must agree or the toggle
 * becomes a way to notice the site contradicting itself.
 *
 * A badge only aged-out scouts ever earned is absent from the map, not zero —
 * the caller's `?? 0` renders it the same and the map stays a record of what
 * is actually true now.
 */
export function earnedByBadge(
  awardedRows: { mb_id: string; scout_id: string }[],
  activeScoutIds: ReadonlySet<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of awardedRows) {
    if (!activeScoutIds.has(row.scout_id)) continue;
    counts.set(row.mb_id, (counts.get(row.mb_id) ?? 0) + 1);
  }
  return counts;
}
