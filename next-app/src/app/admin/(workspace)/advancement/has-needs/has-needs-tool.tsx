'use client';

/**
 * Client half of the Has/Needs Tool. Pure client-side computation — no
 * server round-trip on check/uncheck, since the whole active roster (~30
 * scouts) and the four lower rank trees are small enough to ship down
 * whole. Only LEAF requirements are checkable (per ux-lead review: letting
 * parent/group rows carry their own implicit all/any semantics would layer
 * a second completion rule on top of the all/any toggle — the "simplify,
 * don't layer" call already made elsewhere in this codebase).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { optionalityLabel } from '@/lib/mb-helpers';
import styles from './has-needs.module.css';

export interface PickerTreeNode {
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  children: PickerTreeNode[];
}

export interface PickerRank {
  id: string;
  displayName: string;
  tree: PickerTreeNode[];
}

export interface ResultScout {
  id: string;
  firstName: string;
  displayName: string;
  currentRank: string | null;
  rankSortOrder: number;
  heldCodes: string[];
}

const RANK_LABEL: Record<string, string> = {
  scout: 'Scout',
  tenderfoot: 'Tenderfoot',
  'second-class': 'Second Class',
  'first-class': 'First Class',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

interface FlatRow {
  key: string;
  code: string;
  label: string;
  depth: number;
  isLeaf: boolean;
  optionality: string;
}

function flattenRank(rankId: string, tree: PickerTreeNode[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (node: PickerTreeNode, depth: number) => {
    const isLeaf = node.children.length === 0;
    out.push({
      key: `${rankId}-${node.code}`,
      code: node.code,
      label: node.label,
      depth,
      isLeaf,
      optionality: isLeaf ? '' : optionalityLabel(node)
    });
    node.children.forEach((c) => walk(c, depth + 1));
  };
  tree.forEach((n) => walk(n, 0));
  return out;
}

export function HasNeedsTool({ ranks, scouts }: { ranks: PickerRank[]; scouts: ResultScout[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const codesByScout = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of scouts) map.set(s.id, new Set(s.heldCodes));
    return map;
  }, [scouts]);

  function toggleKey(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Has = completed every checked requirement. Needs = completed none of
  // them. A scout with some-but-not-all checked requirements done (only
  // possible with 2+ boxes checked) shows at the bottom of the Needs column,
  // set apart as partial rather than folded into either bucket.
  const { hasList, needsList, partialList } = useMemo(() => {
    if (checked.size === 0) return { hasList: [], needsList: [], partialList: [] };
    const has: ResultScout[] = [];
    const needs: ResultScout[] = [];
    const partial: ResultScout[] = [];
    for (const s of scouts) {
      const held = codesByScout.get(s.id) ?? new Set<string>();
      let heldCount = 0;
      for (const key of checked) if (held.has(key)) heldCount++;
      if (heldCount === checked.size) has.push(s);
      else if (heldCount === 0) needs.push(s);
      else partial.push(s);
    }
    const byRankThenName = (a: ResultScout, b: ResultScout) =>
      a.rankSortOrder - b.rankSortOrder || a.firstName.localeCompare(b.firstName);
    has.sort(byRankThenName);
    needs.sort(byRankThenName);
    partial.sort(byRankThenName);
    return { hasList: has, needsList: needs, partialList: partial };
  }, [checked, scouts, codesByScout]);

  return (
    <div className={styles.layout}>
      <div className={styles.picker}>
        <div className={styles.pickerHeader}>
          <span className={styles.pickerHeaderLabel}>Requirements</span>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => setChecked(new Set())}
            disabled={checked.size === 0}
          >
            Clear all
          </button>
        </div>
        {ranks.map((rank) => {
          const rows = flattenRank(rank.id, rank.tree);
          return (
            <details key={rank.id} className={styles.rankSection}>
              <summary className={styles.rankSummary}>{rank.displayName}</summary>
              <div className={styles.rankRows}>
                {rows.map((row) =>
                  row.isLeaf ? (
                    <div key={row.key} className={styles.reqRow} style={{ paddingLeft: row.depth * 14 }}>
                      <input
                        type="checkbox"
                        id={row.key}
                        className={styles.checkbox}
                        checked={checked.has(row.key)}
                        onChange={() => toggleKey(row.key)}
                      />
                      <label htmlFor={row.key} className={styles.reqLabelText}>
                        <span className={styles.reqCode}>{row.code}</span> {row.label}
                      </label>
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      className={styles.groupRow}
                      style={{ paddingLeft: row.depth * 14 }}
                    >
                      <span className={styles.reqCode}>{row.code}</span> {row.label}
                      {row.optionality && <span className={styles.optionality}>{row.optionality}</span>}
                    </div>
                  )
                )}
              </div>
            </details>
          );
        })}
      </div>

      <div className={styles.results}>
        {checked.size === 0 ? (
          <div className={styles.emptyState}>
            Check one or more requirements to see who has and needs them.
          </div>
        ) : (
          <div className={styles.resultCols}>
            <div className={styles.resultCol} aria-live="polite">
              <h2 className={styles.resultHeading}>
                Has <span className={styles.resultCount}>({hasList.length})</span>
              </h2>
              <ScoutList scouts={hasList} />
            </div>
            <div className={styles.resultCol} aria-live="polite">
              <h2 className={styles.resultHeading}>
                Needs <span className={styles.resultCount}>({needsList.length})</span>
              </h2>
              <ScoutList scouts={needsList} />
              {partialList.length > 0 && (
                <>
                  <div className={styles.partialSpacer} aria-hidden="true" />
                  <ScoutList scouts={partialList} partial />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoutList({ scouts, partial }: { scouts: ResultScout[]; partial?: boolean }) {
  if (scouts.length === 0) {
    return <p className={styles.resultEmpty}>None.</p>;
  }
  return (
    <ul className={styles.resultList}>
      {scouts.map((s) => (
        <li
          key={s.id}
          className={`${styles.resultItem} ${partial ? styles.resultItemPartial : ''}`.trim()}
        >
          <Link href={`/scouts/${s.id}`} className={styles.resultLink}>
            {s.displayName}
            {partial && ' (Partially Complete)'}
          </Link>
          {s.currentRank && (
            <span className={styles.resultRank}>{RANK_LABEL[s.currentRank] ?? s.currentRank}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
