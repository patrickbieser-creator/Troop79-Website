/**
 * Build a Plan B9 (Plans/Build-A-Plan.md, "B9: Finding orphans"), the pure half: which scouts have nothing on a
 * meeting's plan. PURE and client-safe; the page streams OrphansData in once, and every Add or Remove after that
 * recounts here, on the client, against the plan's keys (no reload).
 *
 * Who counts: every active scout who hasn't said "Can't make it" (scoutCandidatesMany's `eligible`), for whom no
 * offering on the plan is a likely fit (the one likely rule, lib/build-plan likelyFit, as scoutCandidatesMany applies
 * it: rank requirements, focus groups and merit badge requirements alike) and who picked nothing on it.
 *
 * Each scout carries the keys they are covered by, out of a bounded universe: the plan's keys plus every key the engine
 * suggested to anyone (orphanUniverse). An Add of one of those recounts exactly; a key outside it (a searched
 * requirement, a focus set) recounts on the next refresh.
 */
import type { SuggestItem, SuggestionsData } from '@/lib/build-plan-suggest';

export interface OrphanScout {
  scoutId: string;
  name: string;
  /** Their current rank's label ('Scout'). */
  rankLabel: string;
  /** Their likely next items (the engine's suggestions for them), each addable. */
  items: SuggestItem[];
  /** Why the engine has nothing for them, worded; null when it has items. */
  reason: string | null;
  /** The keys (of the universe) they are likely for, or picked. */
  covers: string[];
}

export interface OrphansData {
  /** Every eligible scout, covered or not, by name. */
  scouts: OrphanScout[];
}

/** The keys worth knowing coverage for: the plan's, then every suggestion's (cards first), each once. */
export function orphanUniverse(planKeys: readonly string[], d: Pick<SuggestionsData, 'cards' | 'scouts'>): string[] {
  return [...new Set([...planKeys, ...d.cards.map((c) => c.key), ...d.scouts.flatMap((s) => s.items.map((i) => i.key))])];
}

/** One candidate as the orphan rule reads it: likely, or already picked it (`ticked` false). */
type Cand = { personId: number; likely?: boolean; ticked: boolean };

/**
 * OrphansData from what is already loaded: scoutCandidatesMany over the universe (byKey + eligible) and the cached
 * engine read (its By Scout rows give each scout's items and reason).
 */
export function orphansData(
  eligible: readonly { personId: number; scoutId: string; name: string; picked: readonly string[] }[],
  byKey: ReadonlyMap<string, readonly Cand[]>,
  suggestions: Pick<SuggestionsData, 'scouts'>
): OrphansData {
  const covers = new Map<number, Set<string>>();
  for (const [key, cands] of byKey) {
    for (const c of cands) {
      if (!(c.likely || !c.ticked)) continue;
      const set = covers.get(c.personId) ?? new Set<string>();
      set.add(key);
      covers.set(c.personId, set);
    }
  }
  const engine = new Map(suggestions.scouts.map((s) => [s.id, s]));
  const scouts = eligible
    .map((e): OrphanScout => {
      const row = engine.get(e.scoutId);
      return {
        scoutId: e.scoutId,
        name: row?.name ?? e.name,
        rankLabel: row?.rankLabel ?? '',
        items: row?.items ?? [],
        reason: row?.reason ?? null,
        covers: [...new Set([...(covers.get(e.personId) ?? []), ...e.picked])]
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { scouts };
}

/** The scouts with nothing on the plan: no key they are covered by is on it. */
export function orphanScouts(d: OrphansData, planKeys: ReadonlySet<string>): OrphanScout[] {
  return d.scouts.filter((s) => !s.covers.some((k) => planKeys.has(k)));
}

/** The rail's words: "3 scouts have nothing on this plan"; nothing at all for 0. */
export function orphansLabel(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? '1 scout has nothing on this plan' : `${n} scouts have nothing on this plan`;
}
