/**
 * The rank-requirement completion calculus, shared by the Meeting Plan engine and the meeting board's pick list
 * (Plans/Meeting-Requests-And-Teaching-Offers.md, specialist review: "one completion calculus, don't add a third").
 * Moved here verbatim from meeting-plan/engine.ts so the public /member/meeting loader can use it without reaching
 * into the admin workspace. Pure: no I/O, no framework imports.
 */
import { isGroupSatisfied, type ReqNode } from '@/lib/mb-helpers';

/** The columns the walk reads. Rank and merit badge requirement rows both have them. */
export interface CalcRow {
  id: number;
  parent_id: number | null;
  sort_order: number;
  code: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
}

// Tenure, Scout Spirit, POR, MB-count rollups, and the Eagle project can't be "worked on" in a planned meeting block.
// Scoutmaster conferences stay — they genuinely happen at meetings. Keyed `${rankId}-${code}`.
export const NOT_PLANNABLE: ReadonlySet<string> = new Set([
  'scout-1b',
  'tenderfoot-9',
  'second-class-10',
  'first-class-11',
  'star-1', 'star-2', 'star-3', 'star-5',
  'life-1', 'life-2', 'life-3', 'life-5', 'life-6',
  'eagle-1', 'eagle-2', 'eagle-3', 'eagle-4', 'eagle-5'
]);

// Scoutmaster conferences cap a rank — suggest them only when the scout has completed ≥95% of that rank's
// requirement leaves (user rule, 2026-07-11). Suggesting one earlier wastes a slot on something that can't happen yet.
export const SM_CONFERENCE_CODES: ReadonlySet<string> = new Set(['tenderfoot-10', 'second-class-11', 'first-class-12']);
export const SM_CONFERENCE_THRESHOLD = 0.95;

/** A rank requirement node is satisfied when its leaves are on the ledger (code "tenderfoot-3a"), rolled up by its
 *  all / any / n-of rule. */
export function rankNodeSatisfied<T extends CalcRow>(node: ReqNode<T>, rankId: string, codes: Set<string>): boolean {
  if (node.children.length === 0) return codes.has(`${rankId}-${node.code}`);
  const sat = node.children.filter((c) => rankNodeSatisfied(c, rankId, codes)).length;
  return isGroupSatisfied(node.complete_rule, node.complete_n, sat, node.children.length);
}

/** Fraction of a rank's requirement leaves on the ledger, excluding one top-level code (the SM conference being gated). */
export function rankLeafCompletion<T extends CalcRow>(
  tree: ReqNode<T>[],
  rankId: string,
  codes: Set<string>,
  excludeTopCode: string
): number {
  let total = 0;
  let done = 0;
  const walk = (n: ReqNode<T>) => {
    if (n.children.length === 0) {
      total++;
      if (codes.has(`${rankId}-${n.code}`)) done++;
      return;
    }
    n.children.forEach(walk);
  };
  for (const top of tree) {
    if (top.code === excludeTopCode) continue;
    walk(top);
  }
  return total === 0 ? 0 : done / total;
}

/** Is this top-level requirement something a scout could work on at a meeting, as far as the rank rules go? False for
 *  the non-plannable ones, and for a Scoutmaster conference before 95% of the rank is done. (Venue is the caller's.) */
export function rankTopPlannable<T extends CalcRow>(tree: ReqNode<T>[], rankId: string, top: ReqNode<T>, codes: Set<string>): boolean {
  const key = `${rankId}-${top.code}`;
  if (NOT_PLANNABLE.has(key)) return false;
  if (SM_CONFERENCE_CODES.has(key) && rankLeafCompletion(tree, rankId, codes, top.code) < SM_CONFERENCE_THRESHOLD) return false;
  return true;
}
