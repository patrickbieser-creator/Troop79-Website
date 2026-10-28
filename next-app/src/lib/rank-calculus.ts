/**
 * The rank-requirement completion calculus, shared by the Meeting Plan engine and the meeting board's pick list
 * (Plans/Meeting-Requests-And-Teaching-Offers.md, specialist review: "one completion calculus, don't add a third").
 * Moved here verbatim from the suggestion engine (now lib/meeting-suggest/engine.ts) so the public /member/meeting loader can use it without reaching
 * into the admin workspace. Pure: no I/O, no framework imports.
 */
import { isGroupSatisfied, type ReqNode } from '@/lib/mb-helpers';
import { planningState, topClasses } from '@/lib/requirement-class';

/** The columns the walk reads. Rank and merit badge requirement rows both have them. */
export interface CalcRow {
  id: number;
  parent_id: number | null;
  sort_order: number;
  code: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  /** Requirement class tags (lib/requirement-class); absent or empty = untagged = M. */
  class_codes?: readonly string[] | null;
}

// Tenure, Scout Spirit, POR, MB-count rollups and the Eagle project can't be "worked on" in a planned meeting block:
// since Plans/Requirement-Classification.md they are DATA, tagged L (only), not a list here. Scoutmaster conferences
// are M — they genuinely happen at meetings, behind the 95% gate below.

// Scoutmaster conferences cap a rank — suggest them only when the scout has completed ≥95% of that rank's
// requirement leaves (user rule, 2026-07-11). Suggesting one earlier wastes a slot on something that can't happen yet.
// Every rank has one (Scout, Star, Life and Eagle were missing until 2026-10-21).
export const SM_CONFERENCE_CODES: ReadonlySet<string> = new Set([
  'scout-7',
  'tenderfoot-10',
  'second-class-11',
  'first-class-12',
  'star-7',
  'life-7',
  'eagle-6'
]);
export const SM_CONFERENCE_THRESHOLD = 0.95;

/** A board of review's code: the ledger records one as '<rankId>-BoR'. There is no catalog row (removed 2026-08-19). */
export const BOR_CODE = 'BoR';
const isBorCode = (code: string) => code.toLowerCase() === 'bor';

/** '<rankId>-BoR', the pick key of a rank's board of review. */
export function borKey(rankId: string): string {
  return `${rankId}-${BOR_CODE}`;
}

/** Does this key name a board of review ('tenderfoot-BoR')? */
export function isBorKey(key: string): boolean {
  return /-bor$/i.test(key);
}

/**
 * May a scout pick this rank's board of review (Patrick, 2026-10-21: "The board of review can't be offered unless all
 * other requirements are completed for a rank")? Every top-level requirement of the rank is satisfied on the ledger,
 * the never-planned ones (tenure, Scout spirit, position of responsibility) included, and the board of review itself
 * isn't on the ledger yet. The Scoutmaster conference is the one exception: it may still be open, because the
 * conference and the board are often the same evening (Patrick, 2026-10-21). Scout rank has none. One rule for the pick list,
 * pickableKeys, likely fits and the nudge list.
 */
export function rankBorPickable<T extends CalcRow>(tree: ReqNode<T>[], rankId: string, codes: ReadonlySet<string>): boolean {
  if (rankId === 'scout' || codes.has(borKey(rankId))) return false;
  const tops = tree.filter((t) => !isBorCode(t.code) && !SM_CONFERENCE_CODES.has(`${rankId}-${t.code}`));
  return tops.length > 0 && tops.every((t) => rankNodeSatisfied(t, rankId, codes as Set<string>));
}

/** A rank requirement node is satisfied when its leaves are on the ledger (code "tenderfoot-3a"), rolled up by its
 *  all / any / n-of rule. */
export function rankNodeSatisfied<T extends CalcRow>(node: ReqNode<T>, rankId: string, codes: Set<string>): boolean {
  if (node.children.length === 0) return codes.has(`${rankId}-${node.code}`);
  const sat = node.children.filter((c) => rankNodeSatisfied(c, rankId, codes)).length;
  return isGroupSatisfied(node.complete_rule, node.complete_n, sat, node.children.length);
}

/** A merit badge requirement node is satisfied when its leaves are on the ledger (code "first-aid-1a"), rolled up by its
 *  all / any / n-of rule. Moved here verbatim from the suggestion engine (now lib/meeting-suggest/engine.ts) (Phase 3b of
 *  Plans/Meeting-Requests-And-Teaching-Offers.md: a merit badge night skips the stations a scout has finished), so the
 *  engine and the rotation draft read one calculus. */
export function mbNodeSatisfied<T extends CalcRow>(node: ReqNode<T>, mbId: string, codes: ReadonlySet<string>): boolean {
  if (node.children.length === 0) return codes.has(`${mbId}-${node.code}`);
  const sat = node.children.filter((c) => mbNodeSatisfied(c, mbId, codes)).length;
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
    // The conference itself, and a board of review, are never part of the 95%.
    if (top.code === excludeTopCode || isBorCode(top.code)) continue;
    walk(top);
  }
  return total === 0 ? 0 : done / total;
}

/** Is this top-level requirement something a scout could work on, as far as the rank rules go? False for one tagged
 *  only L, and for a Scoutmaster conference before 95% of the rank is done. (Which gathering is the caller's.) */
export function rankTopPlannable<T extends CalcRow>(tree: ReqNode<T>[], rankId: string, top: ReqNode<T>, codes: Set<string>): boolean {
  const key = `${rankId}-${top.code}`;
  if (planningState(topClasses(top), 'meeting') === 'never') return false;
  if (SM_CONFERENCE_CODES.has(key) && rankLeafCompletion(tree, rankId, codes, top.code) < SM_CONFERENCE_THRESHOLD) return false;
  return true;
}

/**
 * The Meeting Plan engine's pass 1, rank half: a rank's top-level requirements a scout still has to do and could work
 * on, in catalog order, split into ones a meeting holds (a tag of theirs is M, or untagged) and ones that need another
 * setting. The engine suggests from `meeting`; the meeting board's matcher places a "Not sure yet" scout from the same
 * list (Phase 3a), so both read one rule. A rank requirement's own tags decide: the top-level row is the unit.
 */
export function openRankTops<T extends CalcRow>(
  tree: ReqNode<T>[],
  rankId: string,
  codes: Set<string>
): { meeting: ReqNode<T>[]; outing: ReqNode<T>[] } {
  const meeting: ReqNode<T>[] = [];
  const outing: ReqNode<T>[] = [];
  for (const top of tree) {
    if (rankNodeSatisfied(top, rankId, codes)) continue;
    if (!rankTopPlannable(tree, rankId, top, codes)) continue;
    (planningState(topClasses(top), 'meeting') === 'fits' ? meeting : outing).push(top);
  }
  return { meeting, outing };
}
