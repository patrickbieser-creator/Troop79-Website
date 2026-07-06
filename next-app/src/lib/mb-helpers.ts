/**
 * Helpers for shaping merit-badge requirement trees and progress data into
 * the views the catalog/detail pages render. Mirrors the prototype's
 * client-side helpers so visual + behavioral parity is direct.
 */

import type { MeritBadgeRequirement } from './supabase/types';

/** Shape every requirement-tree row needs, regardless of table (merit badge
 *  or rank requirements share this exact column set). */
interface TreeRow {
  id: number;
  parent_id: number | null;
  sort_order: number;
}

export type ReqNode<T extends TreeRow = MeritBadgeRequirement> = T & {
  children: ReqNode<T>[];
};

/** Build a top-level array of nested ReqNodes from a flat row list. Generic
 *  over any row shape with id/parent_id/sort_order — used for both merit
 *  badge and rank requirement trees, which share that column set. */
export function buildReqTree<T extends TreeRow>(rows: T[]): ReqNode<T>[] {
  const byId = new Map<number, ReqNode<T>>();
  const roots: ReqNode<T>[] = [];
  // First pass: clone each row into a ReqNode with empty children.
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  // Second pass: link to parents.
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id == null) {
      roots.push(node);
    } else {
      const parent = byId.get(row.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan: treat as root rather than dropping
    }
  }
  // Sort everything by sort_order at every level.
  const sort = (nodes: ReqNode<T>[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    nodes.forEach((n) => sort(n.children as ReqNode<T>[]));
  };
  sort(roots);
  return roots;
}

/** All/any/n-of business rule, shared by every requirement-tree consumer
 *  (Fast Entry's picker duplicates this against its own selection state;
 *  this version is decoupled from any UI state so read-only views like the
 *  Clipboard can reuse the exact same rule). */
export function isGroupSatisfied(
  rule: 'all' | 'any' | 'n-of',
  completeN: number | null,
  satisfiedCount: number,
  totalCount: number
): boolean {
  switch (rule) {
    case 'any':
      return satisfiedCount >= 1;
    case 'n-of':
      return satisfiedCount >= (completeN ?? totalCount);
    case 'all':
    default:
      return satisfiedCount >= totalCount;
  }
}

/** Flatten a tree to leaf nodes (no children) in display order. */
export function flattenLeaves(nodes: ReqNode[]): ReqNode[] {
  const out: ReqNode[] = [];
  const walk = (n: ReqNode) => {
    if (!n.children.length) out.push(n);
    else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Find the top-level code that contains a given leaf code, for column grouping. */
export function topLevelCodeOf(roots: ReqNode[], leafCode: string): string | null {
  const check = (node: ReqNode, top: string): string | null => {
    if (node.code === leafCode) return top;
    for (const c of node.children) {
      const r = check(c, top);
      if (r) return r;
    }
    return null;
  };
  for (const top of roots) {
    const r = check(top, top.code);
    if (r) return r;
  }
  return null;
}

/** Short optionality phrasing for compact pills. */
export function optionalityLabel(node: { complete_rule?: string; complete_n?: number | null }): string {
  if (!node.complete_rule || node.complete_rule === 'all') return '';
  if (node.complete_rule === 'any') return 'Complete any one';
  if (node.complete_rule === 'n-of') return `Complete any ${node.complete_n ?? 1}`;
  return '';
}

/** Full instructional phrasing for the requirements-list note callout. */
export function optionalityNote(node: { complete_rule?: string; complete_n?: number | null }): string {
  if (!node.complete_rule || node.complete_rule === 'all') return '';
  if (node.complete_rule === 'any') return 'Do any one of the following';
  if (node.complete_rule === 'n-of') return `Do any ${node.complete_n ?? 1} of the following`;
  return '';
}

/** Convention-derived BSA page and workbook URLs. Catalog can override either. */
export function bsaPageUrl(mb: { id: string; bsa_page_url: string | null }): string {
  return mb.bsa_page_url ?? `https://www.scouting.org/merit-badges/${encodeURIComponent(mb.id)}/`;
}
export function workbookUrl(mb: { name: string; workbook_url: string | null }): string {
  if (mb.workbook_url) return mb.workbook_url;
  const slug = mb.name.replace(/&/g, 'and').replace(/[^A-Za-z]/g, '');
  return `https://usscouts.org/usscouts/mb/worksheets/${slug}.pdf`;
}
