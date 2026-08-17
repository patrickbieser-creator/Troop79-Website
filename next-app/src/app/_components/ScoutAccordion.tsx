'use client';

/**
 * The scout-centric accordion view of a Weekly Advancement Report
 * (Decision 8, Plans/Weekly-Advancement-Report.md). Shared between the
 * admin preview (editable — Remove buttons) and the public report/archive
 * pages (read-only) — one component, one rendering of the rules, so the
 * two surfaces can't drift apart on how a line reads.
 *
 * Deliberately a plain button + hidden <div> toggle, NOT <details>/<summary>
 * — this codebase has a real production incident from that mechanism
 * (D-070, 2026-07-19: a closed <details>'s content was silently
 * un-overridable by CSS, shipped broken twice). Multiple scouts can be open
 * at once (not a single-open FAQ accordion) — validated in the prototype as
 * fitting "check on two siblings" better.
 */
import { useMemo, useState } from 'react';
import {
  cmpCode,
  datesOutOfRange,
  entriesForScoutSlot,
  isDateOutOfRange,
  formatMonthDayYear,
  type ScoutViewRecord,
  type ReportRange,
  type ReqLine,
  type RemoveScoutSection
} from '@/lib/advancement-report';
import styles from './scout-accordion.module.css';

function DateNote({ line, scoutIdx, range }: { line: ReqLine; scoutIdx: number; range: ReportRange }) {
  const out = datesOutOfRange(entriesForScoutSlot(line, scoutIdx), range);
  if (!out.length) return null;
  return <span className={styles.entryDate}>earned {out.map(formatMonthDayYear).join(', ')}</span>;
}

function SingleDateNote({ date, range }: { date: string; range: ReportRange }) {
  if (!isDateOutOfRange(date, range)) return null;
  return <span className={styles.entryDate}>earned {formatMonthDayYear(date)}</span>;
}

export interface RemoveTarget {
  scoutId: string;
  section: RemoveScoutSection;
  groupKey: string;
  lineKey?: string;
}

export function ScoutAccordion({
  scoutView,
  range,
  editable,
  onRemove,
  expandScout
}: {
  scoutView: ScoutViewRecord[];
  range: ReportRange;
  editable?: boolean;
  onRemove?: (target: RemoveTarget) => void;
  /** Auto-open one card and scroll to it — the shareable per-scout deep
   *  link (?view=scout&scout=Name) validated in the prototype. */
  expandScout?: string | null;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() =>
    expandScout ? new Set(scoutView.filter((r) => r.scoutName === expandScout).map((r) => r.scoutId)) : new Set()
  );
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scoutView;
    return scoutView.filter((r) => r.scoutName.toLowerCase().includes(q));
  }, [scoutView, filter]);

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    setOpenIds(new Set(filtered.map((r) => r.scoutId)));
  }
  function collapseAll() {
    setOpenIds(new Set());
  }

  if (scoutView.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No advancement to report this week.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <input
          className={styles.filterInput}
          type="search"
          placeholder="Find a scout…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Find a scout"
        />
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.toolbarBtn} onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className={styles.toolbarBtn} onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.noMatch}>No scout matches &ldquo;{filter}&rdquo;.</p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((rec) => {
            const isOpen = openIds.has(rec.scoutId);
            return (
              <div key={rec.scoutId} className={styles.card}>
                <button
                  type="button"
                  className={styles.cardHead}
                  aria-expanded={isOpen}
                  onClick={() => toggle(rec.scoutId)}
                >
                  <span className={styles.cardName}>{rec.scoutName}</span>
                  <span className={styles.cardCount}>
                    {rec.itemCount} item{rec.itemCount === 1 ? '' : 's'}
                  </span>
                  <span className={styles.cardCaret} aria-hidden="true">
                    ▼
                  </span>
                </button>
                {isOpen && (
                  <div className={styles.cardBody}>
                    {rec.ranksEarned.map((a) => (
                      <div key={`rank-${a.name}`} className={styles.row}>
                        <strong>{a.name} — Rank Earned</strong>
                        <SingleDateNote date={a.entry.date} range={range} />
                        {editable && (
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => onRemove?.({ scoutId: rec.scoutId, section: 'ranksEarned', groupKey: a.name })}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {rec.badgesEarned.map((a) => (
                      <div key={`badge-${a.name}`} className={styles.row}>
                        <strong>{a.name} — Merit Badge Earned</strong>
                        {a.eagle && <span className={styles.eagleDot}>★ EAGLE</span>}
                        <SingleDateNote date={a.entry.date} range={range} />
                        {editable && (
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => onRemove?.({ scoutId: rec.scoutId, section: 'badgesEarned', groupKey: a.name })}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {rec.rankReqsByRank.map((bucket) => (
                      <div key={bucket.rank}>
                        <div className={styles.subhead}>{bucket.rankLabel}</div>
                        {bucket.items
                          .slice()
                          .sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]))
                          .map(({ line, scoutIdx }) => (
                            <div key={line.codes.join(',')} className={styles.row}>
                              {line.codes.map((c) => (
                                <span key={c} className={styles.reqTag}>
                                  {c}
                                </span>
                              ))}
                              <span>{line.labels.join(', ')}</span>
                              <DateNote line={line} scoutIdx={scoutIdx} range={range} />
                              {editable && (
                                <button
                                  type="button"
                                  className={styles.removeBtn}
                                  onClick={() =>
                                    onRemove?.({
                                      scoutId: rec.scoutId,
                                      section: 'rankReqs',
                                      groupKey: bucket.rank,
                                      lineKey: line.codes.join(',')
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    ))}
                    {rec.badgeReqsByBadge.map((bucket) => (
                      <div key={bucket.badge}>
                        <div className={styles.subhead}>
                          {bucket.badgeLabel}
                          {bucket.eagle && <span className={styles.eagleDot}>★ EAGLE</span>}
                        </div>
                        {bucket.items
                          .slice()
                          .sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]))
                          .map(({ line, scoutIdx }) => (
                            <div key={line.codes.join(',')} className={styles.row}>
                              {line.codes.map((c) => (
                                <span key={c} className={styles.reqTag}>
                                  {c}
                                </span>
                              ))}
                              <span>{line.labels.join(', ')}</span>
                              <DateNote line={line} scoutIdx={scoutIdx} range={range} />
                              {editable && (
                                <button
                                  type="button"
                                  className={styles.removeBtn}
                                  onClick={() =>
                                    onRemove?.({
                                      scoutId: rec.scoutId,
                                      section: 'badgeReqs',
                                      groupKey: bucket.badge,
                                      lineKey: line.codes.join(',')
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    ))}
                    {rec.leadership.length > 0 && (
                      <div>
                        <div className={styles.subhead}>Leadership</div>
                        {rec.leadership.map((a) => (
                          <div key={`ldr-${a.name}`} className={styles.row}>
                            <strong>{a.name}</strong>
                            <SingleDateNote date={a.entry.date} range={range} />
                            {editable && (
                              <button
                                type="button"
                                className={styles.removeBtn}
                                onClick={() => onRemove?.({ scoutId: rec.scoutId, section: 'leadership', groupKey: a.name })}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {rec.otherAwards.length > 0 && (
                      <div>
                        <div className={styles.subhead}>Other</div>
                        {rec.otherAwards.map((a) => (
                          <div key={`oth-${a.name}`} className={styles.row}>
                            <strong>{a.name}</strong>
                            <SingleDateNote date={a.entry.date} range={range} />
                            {editable && (
                              <button
                                type="button"
                                className={styles.removeBtn}
                                onClick={() => onRemove?.({ scoutId: rec.scoutId, section: 'otherAwards', groupKey: a.name })}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
