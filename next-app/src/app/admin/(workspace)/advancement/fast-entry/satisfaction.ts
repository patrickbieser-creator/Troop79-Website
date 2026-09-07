/**
 * Satisfaction logic for rank + MB requirement trees, used by:
 *   - the picker's parent satisfaction indicators (completed only)
 *   - the cards' Award gating (completed + pending counted together)
 */

import {
  itemKey,
  type CatalogPayload,
  type CompletionMap,
  type PickerItem,
  type ReqTreeNode
} from './picker-types';

/** True iff this node is satisfied with the given set of completed + pending
 *  leaf keys. Recursive. */
export function nodeSatisfied(
  node: ReqTreeNode,
  keyFor: (code: string) => string,
  hasKey: (key: string) => boolean
): boolean {
  if (node.children.length === 0) {
    return hasKey(keyFor(node.code));
  }
  const sat = node.children.filter((c) => nodeSatisfied(c, keyFor, hasKey)).length;
  switch (node.complete_rule) {
    case 'all':
      return sat === node.children.length;
    case 'any':
      return sat >= 1;
    case 'n-of':
      return sat >= (node.complete_n ?? 0);
    default:
      return sat === node.children.length;
  }
}

/**
 * True iff this scout has NO individual requirement activity for the badge —
 * zero completed leaf rows and zero pending leaf ticks. On a clean slate a
 * merit badge award stands on its own (v1.50.2, Patrick 2026-08-19: a blue
 * card signed by a counselor is one fact, not N requirement rows). Mirrors
 * `hasAnyLeafActivity` in actions.ts's validateAwardRows — the server is the
 * authority; this keeps the client from rejecting what the server accepts
 * (B-005, 2026-09-06: the bypass shipped server-only and Scout-First still
 * blocked the click).
 */
export function mbCleanSlate(
  mbId: string,
  completion: CompletionMap,
  pendingKeys: ReadonlySet<string>
): boolean {
  const prefix = itemKey.mbReq(mbId, '');
  for (const k of completion.keys()) if (k.startsWith(prefix)) return false;
  for (const k of pendingKeys) if (k.startsWith(prefix)) return false;
  return true;
}

export interface AwardGateError {
  awardKey: string;
  awardLabel: string;
  parentCode: string;
  parentLabel: string;
  satisfied: number;
  required: number;
}

/** Returns one error per top-level unsatisfied parent for each award row in
 *  selections. Empty array = good to save. */
export function validateAwards(
  selections: PickerItem[],
  catalog: CatalogPayload,
  completion: CompletionMap
): AwardGateError[] {
  const errors: AwardGateError[] = [];
  const pendingKeys = new Set(selections.map((s) => s.key));
  // Helper: hasKey(k) = key is completed OR pending
  const hasKey = (k: string) => completion.has(k) || pendingKeys.has(k);

  for (const sel of selections) {
    if (sel.kind === 'merit_badge_award') {
      const mbId = sel.code.startsWith('MB:') ? sel.code.slice(3) : sel.code;
      const mb = catalog.mbs.find((m) => m.id === mbId);
      if (!mb) continue;
      // Clean slate — trust the explicit award check (see mbCleanSlate).
      // Partial progress falls through to the full leaf gate, as before.
      if (mbCleanSlate(mbId, completion, pendingKeys)) continue;
      const keyFor = (code: string) => itemKey.mbReq(mbId, code);
      for (const top of mb.requirements) {
        if (!nodeSatisfied(top, keyFor, hasKey)) {
          errors.push({
            awardKey: sel.key,
            awardLabel: `${mb.name} merit badge`,
            parentCode: top.code,
            parentLabel: top.label,
            satisfied: countSat(top, keyFor, hasKey),
            required: targetN(top)
          });
        }
      }
    } else if (sel.kind === 'rank_award') {
      const rankId = sel.code;
      const rank = catalog.ranks.find((r) => r.id === rankId);
      if (!rank) continue;
      const keyFor = (code: string) => itemKey.rankReq(rankId, code);
      for (const top of rank.requirements) {
        if (!nodeSatisfied(top, keyFor, hasKey)) {
          errors.push({
            awardKey: sel.key,
            awardLabel: `${rank.display_name} rank`,
            parentCode: top.code,
            parentLabel: top.label,
            satisfied: countSat(top, keyFor, hasKey),
            required: targetN(top)
          });
        }
      }
    }
  }
  return errors;
}

function countSat(
  node: ReqTreeNode,
  keyFor: (code: string) => string,
  hasKey: (k: string) => boolean
): number {
  if (node.children.length === 0) return hasKey(keyFor(node.code)) ? 1 : 0;
  return node.children.filter((c) => nodeSatisfied(c, keyFor, hasKey)).length;
}

function targetN(node: ReqTreeNode): number {
  if (node.children.length === 0) return 1;
  if (node.complete_rule === 'any') return 1;
  if (node.complete_rule === 'n-of') return node.complete_n ?? node.children.length;
  return node.children.length;
}
