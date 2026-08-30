'use client';

/**
 * Client half of the Has/Needs Tool. Pure client-side computation — no
 * server round-trip on check/uncheck, since the whole active roster (~30
 * scouts) and the requirement trees are small enough to ship down whole
 * (fast-entry ships the same catalog payload). Only LEAF requirements are
 * checkable (per ux-lead review: letting parent/group rows carry their own
 * implicit all/any semantics would layer a second completion rule on top of
 * the tri-bucket split — the "simplify, don't layer" call already made
 * elsewhere in this codebase).
 *
 * Merit badges (Jenna's review + Patrick's calls, 2026-08-30) get their own
 * picker mode rather than 60+ more disclosure sections: a SearchField-
 * filtered chip grid → click a badge → its tree inline with a back link,
 * the same drill-in shape fast-entry's picker established. Checks persist
 * across badge switches and across the rank sections, so the common case
 * (one badge) is two clicks while a mixed rank+badge selection still works.
 * The split/credit rules live in lib/has-needs (tested); this file renders.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { optionalityLabel } from '@/lib/mb-helpers';
import { splitScouts, rankKey, mbKey, type HasNeedsScout, type PartialEntry } from '@/lib/has-needs';
import { Button } from '../../../_components/button';
import { SearchField, useTableSearch } from '../../_components/search-field';
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

export interface PickerBadge {
  id: string;
  name: string;
  eagle: boolean;
  tree: PickerTreeNode[];
}

export type ResultScout = HasNeedsScout;

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

function flattenTree(tree: PickerTreeNode[], keyFor: (code: string) => string): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (node: PickerTreeNode, depth: number) => {
    const isLeaf = node.children.length === 0;
    out.push({
      key: keyFor(node.code),
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

/** The checkbox/group rows for one requirement tree — shared by the rank
 *  sections and the badge drill-in so the two can't drift. */
function ReqRows({
  rows,
  checked,
  onToggle
}: {
  rows: FlatRow[];
  checked: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className={styles.rankRows}>
      {rows.map((row) =>
        row.isLeaf ? (
          <div
            key={row.key}
            className={styles.reqRow}
            // inline: dynamic — indent depth comes from the requirement tree
            style={{ paddingLeft: row.depth * 14 }}
          >
            <input
              type="checkbox"
              id={row.key}
              className={styles.checkbox}
              checked={checked.has(row.key)}
              onChange={() => onToggle(row.key)}
            />
            <label htmlFor={row.key} className={styles.reqLabelText}>
              <span className={styles.reqCode}>{row.code}</span> {row.label}
            </label>
          </div>
        ) : (
          <div
            key={row.key}
            className={styles.groupRow}
            // inline: dynamic — indent depth comes from the requirement tree
            style={{ paddingLeft: row.depth * 14 }}
          >
            <span className={styles.reqCode}>{row.code}</span> {row.label}
            {row.optionality && <span className={styles.optionality}>{row.optionality}</span>}
          </div>
        )
      )}
    </div>
  );
}

export function HasNeedsTool({
  ranks,
  badges,
  scouts
}: {
  ranks: PickerRank[];
  badges: PickerBadge[];
  scouts: ResultScout[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [activeMbId, setActiveMbId] = useState<string | null>(null);
  const { q, setQ, visible: visibleBadges } = useTableSearch(badges, (b) => [b.name]);

  function toggleKey(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // "Cooking (2)" on a chip when that badge holds checked boxes — the mixed
  // case's breadcrumb, so a selection spread over three badges stays
  // findable after drilling back out.
  const checkedCountByMb = useMemo(() => {
    const map = new Map<string, number>();
    for (const key of checked) {
      if (!key.startsWith('mb:')) continue;
      for (const b of badges) {
        if (key.startsWith(`mb:${b.id}-`)) {
          map.set(b.id, (map.get(b.id) ?? 0) + 1);
          break;
        }
      }
    }
    return map;
  }, [checked, badges]);

  /** key → "Tenderfoot 4a" / "Cooking 2" for the partial breakdown. */
  const shortLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const rank of ranks) {
      for (const row of flattenTree(rank.tree, (code) => rankKey(rank.id, code))) {
        map.set(row.key, `${rank.displayName} ${row.code}`);
      }
    }
    for (const mb of badges) {
      for (const row of flattenTree(mb.tree, (code) => mbKey(mb.id, code))) {
        map.set(row.key, `${mb.name} ${row.code}`);
      }
    }
    return map;
  }, [ranks, badges]);

  const { has, needs, partial } = useMemo(
    () => splitScouts(Array.from(checked), scouts),
    [checked, scouts]
  );

  const activeBadge = activeMbId ? badges.find((b) => b.id === activeMbId) ?? null : null;

  return (
    <div className={styles.layout}>
      <div className={styles.picker}>
        <div className={styles.pickerHeader}>
          <span className="adminLabel">Requirements</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setChecked(new Set())}
            disabled={checked.size === 0}
          >
            Clear all
          </Button>
        </div>

        {ranks.map((rank) => (
          <details key={rank.id} className={styles.rankSection}>
            <summary className={styles.rankSummary}>{rank.displayName}</summary>
            <ReqRows
              rows={flattenTree(rank.tree, (code) => rankKey(rank.id, code))}
              checked={checked}
              onToggle={toggleKey}
            />
          </details>
        ))}

        {badges.length > 0 && (
          <div className={styles.mbSection}>
            {activeBadge === null ? (
              <>
                <div className={styles.mbHeader}>Merit Badges</div>
                <div className={styles.mbSearch}>
                  <SearchField
                    value={q}
                    onChange={setQ}
                    label="Filter merit badges"
                    placeholder="Filter badges…"
                    resultCount={visibleBadges.length}
                    totalCount={badges.length}
                  />
                </div>
                {visibleBadges.length === 0 ? (
                  <p className={styles.resultEmpty}>No badge matches &ldquo;{q}&rdquo;.</p>
                ) : (
                  <div className={styles.mbGrid}>
                    {visibleBadges.map((mb) => {
                      const count = checkedCountByMb.get(mb.id) ?? 0;
                      return (
                        <button
                          key={mb.id}
                          type="button"
                          className={styles.mbChip}
                          onClick={() => setActiveMbId(mb.id)}
                        >
                          <span>{mb.name}</span>
                          {count > 0 && <span className={styles.mbChipCount}>{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.mbDetailHead}>
                  <Button variant="quiet" size="sm" onClick={() => setActiveMbId(null)}>
                    ← All Merit Badges
                  </Button>
                </div>
                <div className={styles.mbDetailName}>
                  {activeBadge.name}
                  {activeBadge.eagle && <span className={styles.optionality}>Eagle-required</span>}
                </div>
                <ReqRows
                  rows={flattenTree(activeBadge.tree, (code) => mbKey(activeBadge.id, code))}
                  checked={checked}
                  onToggle={toggleKey}
                />
              </>
            )}
          </div>
        )}
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
                Has <span className={styles.resultCount}>({has.length})</span>
              </h2>
              <ScoutList scouts={has} />
            </div>
            <div className={styles.resultCol} aria-live="polite">
              <h2 className={styles.resultHeading}>
                Needs <span className={styles.resultCount}>({needs.length})</span>
              </h2>
              <ScoutList scouts={needs} />
              {partial.length > 0 && (
                <>
                  <div className={styles.partialSpacer} aria-hidden="true" />
                  <PartialScoutList entries={partial} shortLabelByKey={shortLabelByKey} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoutRow({ scout, children }: { scout: ResultScout; children?: React.ReactNode }) {
  return (
    <li className={styles.resultItem}>
      <div className={styles.resultMain}>
        <Link href={`/scouts/${scout.id}`} className={styles.resultLink}>
          {scout.displayName}
        </Link>
        {children}
      </div>
      {scout.currentRank && (
        <span className={styles.resultRank}>
          {RANK_LABEL[scout.currentRank] ?? scout.currentRank}
        </span>
      )}
    </li>
  );
}

function ScoutList({ scouts }: { scouts: ResultScout[] }) {
  if (scouts.length === 0) {
    return <p className={styles.resultEmpty}>None.</p>;
  }
  return (
    <ul className={styles.resultList}>
      {scouts.map((s) => (
        <ScoutRow key={s.id} scout={s} />
      ))}
    </ul>
  );
}

/** Partial rows name what's missing (Patrick, 2026-08-30: "do partial
 *  now") — with a mixed rank+badge selection, "(Partially Complete)" alone
 *  gave no clue which checked item a scout still lacked. */
function PartialScoutList({
  entries,
  shortLabelByKey
}: {
  entries: PartialEntry<ResultScout>[];
  shortLabelByKey: Map<string, string>;
}) {
  return (
    <ul className={styles.resultList}>
      {entries.map(({ scout, missingKeys }) => (
        <ScoutRow key={scout.id} scout={scout}>
          <span className={styles.missingNote}>
            Partially complete — needs{' '}
            {missingKeys.map((k) => shortLabelByKey.get(k) ?? k).join(', ')}
          </span>
        </ScoutRow>
      ))}
    </ul>
  );
}
