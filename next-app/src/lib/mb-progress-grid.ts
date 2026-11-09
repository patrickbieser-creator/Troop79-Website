/**
 * The merit badge page's Scout progress grid, Concept A2 (Plans/MB-Scout-Progress-Grid.md): one column per leaf
 * requirement, a bracket over each choice, done / still to do / not needed cells, and earned scouts last.
 *
 * RULES COME FROM THE CATALOG TREE, not prose. Each parent carries complete_rule (all | any | n-of) and complete_n,
 * applied to its children. The plan's two compound kinds are nested parents in the data:
 *   some required plus a choice — Camping 9 = all of {9a, 9b (any 2 of six), 9c}
 *   all of one set or another   — Archery 5 = any of {5a (all of its parts), 5b}
 * so one recursive evaluator covers every kind. A rule on a requirement with NO children is ignored: that is a
 * single pass/fail the counselor judges (Emergency Preparedness 1b's "10 of 21", Patrick 2026-11-08).
 *
 * EARNED ROWS. A badge earned outside the troop arrives as an award with no detail, and that is fine (Patrick,
 * 2026-11-08). An earned row keeps its boxes only when its records add up to the whole badge; otherwise it is one
 * "All requirements complete" bar. Derived, never stored — no schema flag.
 *
 * Pure: no I/O, no JSX. The meeting planner may reuse it.
 */

import type { MbScoutLike, MbScoutSlot } from '@/lib/mb-scout-progress';

export interface RuleNode {
  code: string;
  label: string;
  complete_rule?: 'all' | 'any' | 'n-of';
  complete_n?: number | null;
  children: RuleNode[];
}

export interface RequirementResult {
  met: boolean;
  /** Children met (a leaf counts itself). */
  doneCount: number;
  /** Children the rule asks for. */
  needed: number;
}

/** How many children a parent's rule asks for; null = all of them. */
function pickCount(n: RuleNode): number | null {
  if (n.complete_rule === 'any') return 1;
  if (n.complete_rule === 'n-of') return Math.max(1, n.complete_n ?? 1);
  return null;
}

export function evaluateRequirement(node: RuleNode, done: ReadonlySet<string>): RequirementResult {
  if (!node.children.length) {
    const d = done.has(node.code);
    return { met: d, doneCount: d ? 1 : 0, needed: 1 };
  }
  const doneCount = node.children.filter((c) => evaluateRequirement(c, done).met).length;
  const needed = Math.min(pickCount(node) ?? node.children.length, node.children.length);
  // A parent signed off as a whole (an import, a counselor) is met whatever its children say.
  return { met: done.has(node.code) || doneCount >= needed, doneCount, needed };
}

/** "all of 5a" / "any 2 of 9b" — a nested parent named by its own code. */
function nestedPart(n: RuleNode): string {
  const pick = pickCount(n);
  return pick === null ? `all of ${n.code}` : `any ${pick} of ${n.code}`;
}

/** The bracket's words. A single requirement has none. */
export function bracketLabel(node: RuleNode): string | null {
  const kids = node.children;
  if (!kids.length) return null;
  const pick = pickCount(node);
  if (kids.every((c) => !c.children.length)) return pick === null ? 'all' : `any ${pick}`;
  if (pick === null) {
    const required = kids.filter((c) => !c.children.length).map((c) => c.code);
    const nested = kids.filter((c) => c.children.length).map(nestedPart);
    return [...(required.length ? [required.join(', ')] : []), ...nested].join(' + ');
  }
  const options = kids.map((c) => (c.children.length ? nestedPart(c) : c.code));
  return pick === 1 ? options.join(' or ') : `any ${pick} of ${options.join(', ')}`;
}

export type CellState = 'done' | 'open' | 'notNeeded';

export interface GridBracket {
  code: string;
  label: string | null;
  /** Leaf columns under this parent requirement. */
  span: number;
}

export interface GridColumn {
  code: string;
  label: string;
  /** First code of its parent requirement: the grid leaves a gap before it. */
  groupStart: boolean;
  /** Header's accessible name: "1a, any 1 of 1a–1d". */
  ariaName: string;
}

export interface GridRow<S extends MbScoutLike> {
  scout: S;
  /** One per column, in column order. */
  cells: CellState[];
  /** Parent requirements met, of `total`. */
  met: number;
  total: number;
  earned: boolean;
  /** Earned and the records on file add up to the whole badge. */
  requirementsRecorded: boolean;
}

export interface ProgressGrid<S extends MbScoutLike> {
  brackets: GridBracket[];
  columns: GridColumn[];
  /** Most parent requirements met first; ties keep the caller's (name) order. */
  inProgress: GridRow<S>[];
  /** Recorded first, then counselor-only, each in the caller's order. */
  earned: GridRow<S>[];
}

function leavesOf(n: RuleNode): RuleNode[] {
  return n.children.length ? n.children.flatMap(leavesOf) : [n];
}

/** Each leaf's state: done when signed off; otherwise not needed when any requirement above it is already met. */
function cellsFor(tree: RuleNode[], done: ReadonlySet<string>): CellState[] {
  const out: CellState[] = [];
  const walk = (n: RuleNode, settled: boolean) => {
    if (!n.children.length) {
      out.push(done.has(n.code) ? 'done' : settled ? 'notNeeded' : 'open');
      return;
    }
    const met = settled || evaluateRequirement(n, done).met;
    n.children.forEach((c) => walk(c, met));
  };
  tree.forEach((t) => walk(t, false));
  return out;
}

/**
 * The grid for one badge. `scouts` arrive in display order; only those with a slot in `byScout` (any progress or
 * an award) get a row — not-started scouts stay out.
 */
export function buildProgressGrid<S extends MbScoutLike>(
  tree: RuleNode[],
  scouts: readonly S[],
  byScout: ReadonlyMap<string, MbScoutSlot>
): ProgressGrid<S> {
  const brackets: GridBracket[] = [];
  const columns: GridColumn[] = [];
  for (const top of tree) {
    const leaves = leavesOf(top);
    const label = bracketLabel(top);
    brackets.push({ code: top.code, label, span: leaves.length });
    const range = leaves.length > 1 ? `${leaves[0].code}–${leaves[leaves.length - 1].code}` : leaves[0].code;
    leaves.forEach((l, i) =>
      columns.push({
        code: l.code,
        label: l.label,
        groupStart: i === 0,
        ariaName: label ? `${l.code}, ${label} of ${range}` : l.code
      })
    );
  }

  const rows: GridRow<S>[] = [];
  for (const scout of scouts) {
    const slot = byScout.get(scout.id);
    if (!slot) continue;
    const met = tree.filter((t) => evaluateRequirement(t, slot.codes).met).length;
    rows.push({
      scout,
      cells: cellsFor(tree, slot.codes),
      met,
      total: tree.length,
      earned: slot.awarded,
      requirementsRecorded: slot.awarded && tree.length > 0 && met === tree.length
    });
  }
  // Array.prototype.sort is stable, so ties keep the caller's order.
  const inProgress = rows.filter((r) => !r.earned).sort((a, b) => b.met - a.met);
  const earned = rows.filter((r) => r.earned).sort((a, b) => Number(b.requirementsRecorded) - Number(a.requirementsRecorded));
  return { brackets, columns, inProgress, earned };
}
