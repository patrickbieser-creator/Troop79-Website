/**
 * Has/Needs picker (Build a Plan B7, Plans/Build-A-Plan.md): the requirement trees the planner's Has/Needs tab ticks
 * from, and the pure pieces around them. Client-safe. The split itself (Has / Needs / Partial) is lib/has-needs.
 *
 *   - The trees are slimmed for the wire: code, label, the optionality note of a group ("Complete any one"), children.
 *     Only LEAVES are tickable; a group is shown, never ticked (one completion rule, lib/has-needs).
 *   - The selection lives in the URL as `?pick=<key>,<key>`, keys in tick order, exactly lib/has-needs's namespaced keys
 *     (`rank:tenderfoot-4a`, `mb:first-aid-9b`). Their characters (letters, digits, `:`, `-`, `.`) need no escaping.
 *   - The add hook: a ticked leaf's OFFERING is its top-level requirement (`tenderfoot-4a` for `tenderfoot-4a.1`,
 *     `first-aid-9` for `first-aid-9b`), the board key Build a Plan seeds (meeting_seed_many takes top-level only).
 */
import { optionalityLabel } from '@/lib/mb-helpers';
import { mbBadgeKey, mbKey, rankKey } from '@/lib/has-needs';
import { rankAbbrev } from '@/lib/rank-abbrev';

export interface PickerNode {
  code: string;
  label: string;
  /** A group's rule in words ('Complete any one'); '' for a leaf or an all-of group. */
  optionality: string;
  children: PickerNode[];
}

export interface PickerRank {
  id: string;
  name: string;
  tree: PickerNode[];
}

export interface PickerBadge {
  id: string;
  name: string;
  eagle: boolean;
  tree: PickerNode[];
}

/** A catalog tree node (buildReqTree's), as much of it as the picker reads. */
interface SourceNode {
  code: string;
  label: string;
  complete_rule?: string;
  complete_n?: number | null;
  children: SourceNode[];
}

/** A catalog tree, slimmed for the client. */
export function toPickerTree(nodes: readonly SourceNode[]): PickerNode[] {
  return nodes.map((n) => ({
    code: n.code,
    label: n.label,
    optionality: n.children.length ? optionalityLabel(n) : '',
    children: toPickerTree(n.children)
  }));
}

export interface PickerRow {
  key: string;
  code: string;
  label: string;
  depth: number;
  isLeaf: boolean;
  optionality: string;
}

/** A tree as rows in reading order, each with its namespaced key. */
export function flattenTree(tree: readonly PickerNode[], keyFor: (code: string) => string): PickerRow[] {
  const out: PickerRow[] = [];
  const walk = (node: PickerNode, depth: number) => {
    out.push({ key: keyFor(node.code), code: node.code, label: node.label, depth, isLeaf: node.children.length === 0, optionality: node.optionality });
    node.children.forEach((c) => walk(c, depth + 1));
  };
  tree.forEach((n) => walk(n, 0));
  return out;
}

/** Every leaf key, mapped to its short label ('Tenderfoot 4a', 'First Aid 9b'). */
export function leafLabels(ranks: readonly PickerRank[], badges: readonly PickerBadge[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of ranks) for (const row of flattenTree(r.tree, (c) => rankKey(r.id, c))) if (row.isLeaf) out.set(row.key, `${r.name} ${row.code}`);
  for (const b of badges) {
    out.set(mbBadgeKey(b.id), `${b.name} · earned`);
    for (const row of flattenTree(b.tree, (c) => mbKey(b.id, c))) if (row.isLeaf) out.set(row.key, `${b.name} ${row.code}`);
  }
  return out;
}

/** Opening a badge (Patrick, 2026-10-29): with nothing of it ticked yet, the whole badge is ticked, so the results
 *  show who earned it at once. */
export function openBadge(checked: readonly string[], badge: PickerBadge): string[] {
  const leaves = new Set(flattenTree(badge.tree, (c) => mbKey(badge.id, c)).map((r) => r.key));
  if (checked.some((k) => k === mbBadgeKey(badge.id) || leaves.has(k)) || checked.length >= PICK_MAX) return [...checked];
  return [...checked, mbBadgeKey(badge.id)];
}

/** Ticking one of a badge's requirements refines "earned": the whole-badge tick gives way to the requirement. */
export function refineBadge(checked: readonly string[], key: string, badge: PickerBadge | null): string[] {
  return badge && key.startsWith(`mb:${badge.id}-`) ? checked.filter((k) => k !== mbBadgeKey(badge.id)) : [...checked];
}

/** The most keys the URL carries (a guard on a hand-edited link, far past any real selection). */
export const PICK_MAX = 60;

/** "You can check up to 60." (qa-lead, B7): shown in place when a tick would pass PICK_MAX. */
export const PICK_CAP_TEXT = `You can check up to ${PICK_MAX}. Untick one to add another.`;

/** Tick or untick one key. A tick past PICK_MAX changes nothing and says so (capped). */
export function togglePick(checked: readonly string[], key: string): { next: string[]; capped: boolean } {
  if (checked.includes(key)) return { next: checked.filter((k) => k !== key), capped: false };
  if (checked.length >= PICK_MAX) return { next: [...checked], capped: true };
  return { next: [...checked, key], capped: false };
}

/** `?pick=` as the selection: known leaf keys only, in order, once each. */
export function parsePick(value: string | null | undefined, known: ReadonlySet<string>): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((k) => k.trim()))].filter((k) => known.has(k)).slice(0, PICK_MAX);
}

/** The page's URL for a selection: `?pick=a,b`, or the bare path when nothing is ticked. */
export function pickHref(pathname: string, keys: readonly string[]): string {
  return keys.length ? `${pathname}?pick=${keys.join(',')}` : pathname;
}

const contains = (node: PickerNode, code: string): boolean => node.code === code || node.children.some((c) => contains(c, code));

export interface Offering {
  /** Build a Plan's board key ('tenderfoot-4a'). */
  key: string;
  /** 'Tenderfoot 4a', 'First Aid 9'. */
  label: string;
  /** The visible short form (Patrick, 2026-10-22): 'Ten 4a · First aid'; a merit badge keeps its name. */
  short: string;
  /** The spoken form: 'Tenderfoot 4a First aid'. */
  full: string;
}

/** The top-level requirement a ticked leaf belongs to, as Build a Plan's board key and its labels. Null if unknown. */
export function offeringOf(key: string, ranks: readonly PickerRank[], badges: readonly PickerBadge[]): Offering | null {
  const find = (src: { id: string; name: string; tree: PickerNode[] }[], rest: string, rank: boolean): Offering | null => {
    // Ids carry dashes ('second-class', 'first-aid'): the longest id the key starts with.
    const owner = src.filter((x) => rest.startsWith(`${x.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
    if (!owner) return null;
    const code = rest.slice(owner.id.length + 1);
    const top = owner.tree.find((t) => contains(t, code));
    if (!top) return null;
    const label = `${owner.name} ${top.code}`;
    const lead = `${rank ? rankAbbrev(owner.id) : owner.name} ${top.code}`;
    return { key: `${owner.id}-${top.code}`, label, short: top.label ? `${lead} · ${top.label}` : lead, full: top.label ? `${label} ${top.label}` : label };
  };
  if (key.startsWith('rank:')) return find(ranks as PickerRank[], key.slice(5), true);
  if (key.startsWith('mb:')) return find(badges as PickerBadge[], key.slice(3), false);
  return null;
}
