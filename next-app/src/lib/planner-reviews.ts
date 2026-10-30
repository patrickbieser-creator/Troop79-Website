/**
 * Suggestions' lead list (Patrick, 2026-10-29): scouts with only the Scoutmaster conference and/or the board of review
 * left for their next rank, and who may sit each one. Pure; client-safe.
 *
 * Eligible: every other top-level requirement of the next rank is satisfied (the shared rule, lib/rank-calculus
 * rankBorPickable's: "any one of" groups counted properly), and the conference or the board is still open. Scout rank
 * has a conference and no board; an Eagle board is the district's, never planned here.
 *
 * Who sits it (Patrick's rule):
 *   Scoutmaster conference          the Scoutmaster.
 *   Scout or Tenderfoot board       two scouts, Second Class or above.
 *   Second Class board              two scouts, First Class or above.
 *   First Class board               an adult and a scout First Class or above.
 *   Star or Life board              two adults.
 * The scout being reviewed never sits their own.
 */
import { BOR_CODE, borKey, rankNodeSatisfied, SM_CONFERENCE_CODES } from '@/lib/rank-calculus';

export type ReviewKind = 'smc' | 'bor';

export interface ReviewRank {
  id: string;
  display_name: string;
  sort_order: number;
}

export interface ReviewScout {
  personId: number;
  name: string;
  currentRank: string | null;
  /** Rank requirement codes on the ledger ('tenderfoot-4a', 'tenderfoot-BoR'). */
  codes: ReadonlySet<string>;
}

export interface ReviewNeed {
  kind: ReviewKind;
  /** The plan key: the conference's catalog key ('tenderfoot-10') or the board's ('tenderfoot-BoR'). */
  key: string;
  label: string;
}

export interface ReviewCandidate {
  personId: number;
  name: string;
  rankId: string;
  rankName: string;
  needs: ReviewNeed[];
}

/** A rank requirement tree node (lib/mb-helpers buildReqTree's shape, as far as the rules read it). */
type Node = { code: string; complete_rule: string; complete_n: number | null; children: Node[] };

const isBor = (code: string) => code.toLowerCase() === BOR_CODE.toLowerCase();

export function reviewCandidates(scouts: readonly ReviewScout[], ranks: readonly ReviewRank[], treeOf: (rankId: string) => Node[]): ReviewCandidate[] {
  const sorted = [...ranks].sort((a, b) => a.sort_order - b.sort_order);
  const out: ReviewCandidate[] = [];
  for (const s of scouts) {
    const i = s.currentRank ? sorted.findIndex((r) => r.id === s.currentRank) : -1;
    const rank = s.currentRank ? (i >= 0 ? sorted[i + 1] : undefined) : sorted[0];
    if (!rank || rank.id === 'eagle') continue;
    const tree = treeOf(rank.id);
    const smc = tree.find((t) => SM_CONFERENCE_CODES.has(`${rank.id}-${t.code}`));
    const rest = tree.filter((t) => t !== smc && !isBor(t.code));
    const codes = s.codes as Set<string>;
    if (!rest.length || !rest.every((t) => rankNodeSatisfied(t as never, rank.id, codes))) continue;
    const needs: ReviewNeed[] = [];
    if (smc && !rankNodeSatisfied(smc as never, rank.id, codes)) needs.push({ kind: 'smc', key: `${rank.id}-${smc.code}`, label: 'Scoutmaster conference' });
    if (rank.id !== 'scout' && !codes.has(borKey(rank.id))) needs.push({ kind: 'bor', key: borKey(rank.id), label: 'Board of review' });
    if (needs.length) out.push({ personId: s.personId, name: s.name, rankId: rank.id, rankName: rank.display_name, needs });
  }
  return out.sort((a, b) => b.needs.length - a.needs.length || a.name.localeCompare(b.name));
}

export interface ReviewRule {
  adults: number;
  scouts: number;
  /** The lowest rank (its sort order) a scout reviewer may hold; null when no scouts sit it. */
  scoutMinOrder: number | null;
  /** The conference: the Scoutmaster, no one else. */
  scoutmaster?: true;
}

export function reviewRule(kind: ReviewKind, rankId: string, ranks: readonly ReviewRank[]): ReviewRule | null {
  const order = (id: string) => ranks.find((r) => r.id === id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  if (kind === 'smc') return { adults: 1, scouts: 0, scoutMinOrder: null, scoutmaster: true };
  if (rankId === 'scout' || rankId === 'tenderfoot') return { adults: 0, scouts: 2, scoutMinOrder: order('second-class') };
  if (rankId === 'second-class') return { adults: 0, scouts: 2, scoutMinOrder: order('first-class') };
  if (rankId === 'first-class') return { adults: 1, scouts: 1, scoutMinOrder: order('first-class') };
  if (rankId === 'star' || rankId === 'life') return { adults: 2, scouts: 0, scoutMinOrder: null };
  return null;
}

export interface Reviewer {
  personId: number;
  name: string;
  kind: 'adult' | 'scout';
  /** A scout's current rank, as its sort order. */
  rankOrder?: number;
  scoutmaster?: boolean;
}

/** Who may sit it, adults and scouts apart, the reviewed scout left out. */
export function reviewerOptions(rule: ReviewRule, pool: readonly Reviewer[], selfId: number): { adults: Reviewer[]; scouts: Reviewer[] } {
  const others = pool.filter((p) => p.personId !== selfId);
  const adults = rule.adults ? others.filter((p) => p.kind === 'adult' && (!rule.scoutmaster || p.scoutmaster)) : [];
  const scouts = rule.scouts && rule.scoutMinOrder != null ? others.filter((p) => p.kind === 'scout' && (p.rankOrder ?? 0) >= rule.scoutMinOrder!) : [];
  return { adults, scouts };
}

/** The first who fit, adults then scouts: what the row starts with. */
export function defaultReviewers(rule: ReviewRule, opts: { adults: Reviewer[]; scouts: Reviewer[] }): number[] {
  return [...opts.adults.slice(0, rule.adults), ...opts.scouts.slice(0, rule.scouts)].map((r) => r.personId);
}

/** Null when the chosen people fit the rule exactly; otherwise why not. The server's check. */
export function checkReviewers(rule: ReviewRule, chosen: readonly number[], pool: readonly Reviewer[], selfId: number): string | null {
  if (new Set(chosen).size !== chosen.length) return 'Choose different people.';
  const opts = reviewerOptions(rule, pool, selfId);
  const adults = chosen.filter((id) => opts.adults.some((r) => r.personId === id)).length;
  const scouts = chosen.filter((id) => opts.scouts.some((r) => r.personId === id)).length;
  if (adults !== rule.adults || scouts !== rule.scouts || adults + scouts !== chosen.length) return reviewRuleText(rule);
  return null;
}

export function reviewRuleText(rule: ReviewRule): string {
  if (rule.scoutmaster) return 'The Scoutmaster holds the conference.';
  const parts = [rule.adults ? `${rule.adults === 1 ? 'an adult' : `${rule.adults} adults`}` : '', rule.scouts ? `${rule.scouts === 1 ? 'a scout' : `${rule.scouts} scouts`} of the right rank` : ''].filter(Boolean);
  return `This one needs ${parts.join(' and ')}.`;
}
