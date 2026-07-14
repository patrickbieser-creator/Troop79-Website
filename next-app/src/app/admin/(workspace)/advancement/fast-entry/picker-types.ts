import type { LedgerKind } from '@/lib/supabase/types';

export type CompleteRule = 'all' | 'any' | 'n-of';

/** One node in a rank's or MB's requirement tree. */
export interface ReqTreeNode {
  code: string;
  label: string;
  complete_rule: CompleteRule;
  complete_n: number | null;
  children: ReqTreeNode[];
}

/** Shared catalog used by both Fast Entry cards' pickers. */
export interface CatalogPayload {
  ranks: {
    id: string;
    display_name: string;
    requirements: ReqTreeNode[];
  }[];
  mbs: {
    id: string;
    name: string;
    eagle: boolean;
    requirements: ReqTreeNode[];
  }[];
  /** Name lookups for the free-form tab pull-downs. Events carry a stored
   *  default_kind classification (Campout/Hike/Day Outing/Fundraiser) so the
   *  Events tab can resolve the ledger kind automatically for a recurring
   *  event instead of asking the leader to re-pick a Type every time. */
  events: { id: number; name: string; default_kind: LedgerKind | null; start_date: string | null }[];
  serviceProjects: { id: number; name: string }[];
  leadershipPositions: { id: number; name: string }[];
}

/** A single selectable item. Stable `key` identifies it across renders. */
export interface PickerItem {
  key: string;
  kind: LedgerKind;
  code: string;
  label: string;
  unit: string;
  /** Optional override for the ledger row's qty. When omitted, the Server
   *  Action falls back to its kind-based default (1 / 2). */
  qty?: number;
}

/** Completion overlay for the picker: an item is "completed" when its key
 *  is in this map. The Completion gives the on-ledger date + signer. */
export interface Completion {
  entryId: number;
  date: string | null;
  by: string | null;
  code: string;
}

export type CompletionMap = Map<string, Completion>;

/**
 * Item-key helpers. Same shape on both sides (catalog → picker; ledger →
 * completion overlay), so the picker can match earned items by key.
 */
export const itemKey = {
  rankReq: (rankId: string, code: string) => `rank-req:${rankId}:${code}`,
  rankAward: (rankId: string) => `rank-award:${rankId}`,
  mbReq: (mbId: string, code: string) => `mb-req:${mbId}:${code}`,
  mbAward: (mbId: string) => `mb-award:${mbId}`
};

/** Build a PickerItem for a rank requirement (catalog row). */
export function rankReqItem(
  rankId: string,
  rankName: string,
  code: string,
  label: string
): PickerItem {
  return {
    key: itemKey.rankReq(rankId, code),
    kind: 'rank_requirement',
    code: `${rankId}-${code}`,
    label,
    unit: 'complete'
  };
}

export function rankAwardItem(rankId: string, rankName: string): PickerItem {
  return {
    key: itemKey.rankAward(rankId),
    kind: 'rank_award',
    code: rankId,
    label: `Board of Review - ${rankName}`,
    unit: 'award'
  };
}

export function mbReqItem(
  mbId: string,
  mbName: string,
  code: string,
  label: string
): PickerItem {
  return {
    key: itemKey.mbReq(mbId, code),
    kind: 'merit_badge_requirement',
    code: `${mbId}-${code}`,
    label,
    unit: 'complete'
  };
}

export function mbAwardItem(
  mbId: string,
  mbName: string,
  eagle: boolean
): PickerItem {
  return {
    key: itemKey.mbAward(mbId),
    kind: 'merit_badge_award',
    code: `MB:${mbId}`,
    label: `${mbName} — Merit Badge Earned${eagle ? ' ★' : ''}`,
    unit: 'award'
  };
}

/** Resolve a ledger row's PickerItem key, given catalog context. */
export function keyForLedgerRow(args: {
  kind: LedgerKind;
  code: string;
}): string | null {
  const { kind, code } = args;
  if (kind === 'rank_requirement') {
    // code shape: "<rank>-<reqCode>"; split on first dash but two-word ranks
    // contain dashes (second-class, first-class). Match against known prefixes.
    const prefixes = [
      'second-class-',
      'first-class-',
      'tenderfoot-',
      'scout-',
      'star-',
      'life-',
      'eagle-'
    ];
    for (const p of prefixes) {
      if (code.startsWith(p)) {
        const rankId = p.slice(0, -1);
        const reqCode = code.slice(p.length);
        return itemKey.rankReq(rankId, reqCode);
      }
    }
    return null;
  }
  if (kind === 'rank_award') {
    return itemKey.rankAward(code);
  }
  if (kind === 'merit_badge_award') {
    const colon = code.indexOf(':');
    const id = colon >= 0 ? code.slice(colon + 1) : code;
    return itemKey.mbAward(id);
  }
  if (kind === 'merit_badge_requirement') {
    const dash = code.indexOf('-');
    if (dash < 0) return null;
    const id = code.slice(0, dash);
    const reqCode = code.slice(dash + 1);
    return itemKey.mbReq(id, reqCode);
  }
  return null;
}
