/**
 * Search (Ctrl K) over the feature registry, as data (Plans/Completed/Admin-Portal-Nav.md decision 8, phase 5). The layout hands
 * the client the features this person can open (searchEntries); this filters them by label, aliases, group and
 * description, and groups the hits Do · Screens · Reports · Setup, at most six per group. Plain module: shared by the
 * client dialog and the tests.
 */
import type { Feature, FeatureKind } from './feature-registry';
import { AREA_LABELS } from './area-menu';

export interface SearchEntry {
  key: string;
  label: string;
  href: string;
  kind: FeatureKind;
  /** The group's name: "Money". Searched, and shown beside each hit. */
  area: string;
  description?: string;
  aliases: string[];
}

export interface SearchGroup {
  title: string;
  entries: SearchEntry[];
}

export const PER_GROUP = 6;

const GROUPS: [FeatureKind, string][] = [
  ['action', 'Do'],
  ['screen', 'Screens'],
  ['report', 'Reports'],
  ['setup', 'Setup']
];

/** The visible features, ready for the client. Home is left out: it is the rail's first entry. */
export function searchEntries(visible: readonly Feature[]): SearchEntry[] {
  return visible
    .filter((f) => f.key !== 'home')
    .map((f) => ({
      key: f.key,
      label: f.label,
      href: f.href,
      kind: f.kind,
      area: AREA_LABELS[f.area],
      ...(f.description ? { description: f.description } : {}),
      aliases: f.aliases ?? []
    }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Lower is better; null is no match. Every word of the query must match somewhere. */
function score(e: SearchEntry, q: string): number | null {
  const label = norm(e.label);
  const words = q.split(' ').filter(Boolean);
  const hay = [label, ...e.aliases.map(norm), norm(e.area), norm(e.description ?? '')].join(' | ');
  if (!words.every((w) => hay.includes(w))) return null;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.split(' ').some((w) => w.startsWith(q))) return 2;
  if (label.includes(q)) return 3;
  if (e.aliases.some((a) => norm(a).startsWith(q))) return 4;
  if (e.aliases.some((a) => norm(a).includes(q))) return 5;
  return 6;
}

/** The hits for a query, grouped Do · Screens · Reports · Setup, best first, at most PER_GROUP each. */
export function searchFeatures(entries: readonly SearchEntry[], query: string): SearchGroup[] {
  const q = norm(query);
  if (!q) return [];
  const scored = entries.flatMap((e) => {
    const s = score(e, q);
    return s == null ? [] : [{ e, s }];
  });
  return GROUPS.map(([kind, title]) => ({
    title,
    entries: scored
      .filter((x) => x.e.kind === kind)
      .sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label))
      .slice(0, PER_GROUP)
      .map((x) => x.e)
  })).filter((g) => g.entries.length > 0);
}
