/**
 * Everything A–Z's list, as data (plain module: the page, the client index and the tests share it).
 */
import type { Feature, FeatureKind } from '../_components/feature-registry';

export interface AzEntry {
  key: string;
  label: string;
  href: string;
  kind: FeatureKind;
  aliases: string[];
}

export interface AzGroup {
  letter: string;
  entries: AzEntry[];
}

/** Features that never appear in A–Z: Home is the rail's first entry, and the retired Advancement dashboard. */
const NOT_LISTED: ReadonlySet<string> = new Set(['home', 'advancement.dashboard']);

export function azEntries(visible: readonly Feature[]): AzEntry[] {
  return visible
    .filter((f) => !NOT_LISTED.has(f.key))
    .map((f) => ({ key: f.key, label: f.label, href: f.href, kind: f.kind, aliases: f.aliases ?? [] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

/** Grouped by first letter, filtered by kind and by a name or alias substring. */
export function azGroups(entries: readonly AzEntry[], opts: { kind: FeatureKind | null; q: string }): AzGroup[] {
  const term = opts.q.trim().toLowerCase();
  const out = new Map<string, AzEntry[]>();
  for (const e of entries) {
    if (opts.kind && e.kind !== opts.kind) continue;
    if (term && !e.label.toLowerCase().includes(term) && !e.aliases.some((a) => a.toLowerCase().includes(term))) continue;
    const first = e.label.charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    out.set(letter, [...(out.get(letter) ?? []), e]);
  }
  return [...out.entries()].map(([letter, list]) => ({ letter, entries: list }));
}
