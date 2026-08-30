/**
 * Has/Needs Tool — pure split/credit logic, extracted from the client
 * component for the merit-badge expansion (Jenna's review + Patrick's
 * calls, 2026-08-30). Three rules live here, pinned by
 * tests/has-needs-split.test.ts:
 *
 * 1. KEY NAMESPACE — checked requirements from ranks and merit badges share
 *    one Set, so keys are prefixed `rank:`/`mb:`; the old bare
 *    `${id}-${code}` concatenation had no separation between a rank id and
 *    a badge id. Ledger composite codes (`eagle-1`, `archery-1a`) are
 *    already `${id}-${code}`, so a ledger row's key is simply the prefix +
 *    its code.
 * 2. TRI-BUCKET SPLIT — Has = holds every checked key, Needs = none,
 *    Partial = some, with each Partial row naming WHICH checked keys are
 *    missing so a mixed rank+badge selection stays legible.
 * 3. AWARD IMPLIES LEAVES — a scout whose merit badge is awarded holds
 *    every leaf of that badge even when no individual requirement was
 *    logged (fast-entry's blue-card "clean slate bypass"); folded silently
 *    into Has per Patrick, matching mb_progress semantics elsewhere.
 */

export interface HasNeedsScout {
  id: string;
  firstName: string;
  displayName: string;
  currentRank: string | null;
  rankSortOrder: number;
  /** Namespaced keys (rankKey/mbKey) for every requirement this scout holds. */
  heldKeys: string[];
}

export const rankKey = (rankId: string, code: string): string => `rank:${rankId}-${code}`;
export const mbKey = (mbId: string, code: string): string => `mb:${mbId}-${code}`;

export interface PartialEntry<S extends HasNeedsScout> {
  scout: S;
  /** The checked keys this scout does NOT hold, in checked order. */
  missingKeys: string[];
}

export interface SplitResult<S extends HasNeedsScout> {
  has: S[];
  needs: S[];
  partial: PartialEntry<S>[];
}

const byRankThenName = (a: HasNeedsScout, b: HasNeedsScout) =>
  a.rankSortOrder - b.rankSortOrder || a.firstName.localeCompare(b.firstName);

export function splitScouts<S extends HasNeedsScout>(
  checkedKeys: readonly string[],
  scouts: readonly S[]
): SplitResult<S> {
  if (checkedKeys.length === 0) return { has: [], needs: [], partial: [] };
  const has: S[] = [];
  const needs: S[] = [];
  const partial: PartialEntry<S>[] = [];
  for (const s of scouts) {
    const held = new Set(s.heldKeys);
    const missing = checkedKeys.filter((k) => !held.has(k));
    if (missing.length === 0) has.push(s);
    else if (missing.length === checkedKeys.length) needs.push(s);
    else partial.push({ scout: s, missingKeys: missing });
  }
  has.sort(byRankThenName);
  needs.sort(byRankThenName);
  partial.sort((a, b) => byRankThenName(a.scout, b.scout));
  return { has, needs, partial };
}

/**
 * Union a scout's ledger-held keys with every leaf key of each badge they
 * have been AWARDED — `leafCodesByMb` maps mb_id to that badge's bare leaf
 * codes. An awarded badge with no loaded requirement tree contributes
 * nothing (harmless: no leaf of it is checkable either).
 */
export function withAwardedBadgeLeaves(
  heldKeys: Iterable<string>,
  awardedMbIds: Iterable<string>,
  leafCodesByMb: ReadonlyMap<string, readonly string[]>
): Set<string> {
  const out = new Set(heldKeys);
  for (const mbId of awardedMbIds) {
    for (const code of leafCodesByMb.get(mbId) ?? []) out.add(mbKey(mbId, code));
  }
  return out;
}
