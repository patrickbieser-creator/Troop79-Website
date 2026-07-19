'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { CalendarCategory } from '@/lib/supabase/types';
import type { CalendarEntryWithSlug } from '@/lib/calendar';
import { categoryColor, formatTimeOfDay } from '@/lib/calendar-shared';
import styles from './events.module.css';

/*
 * Traditional month-grid alternative to the flat list view — ported from
 * the verified prototype at prototypes/calendar-month-view/. Interaction
 * logic (popover edge-clamping, auto-select-today, adjacent-month
 * navigation, roving-tabindex keyboard nav) matches that prototype's
 * calendar-month.js line for line; see its judgment-call notes for the
 * reasoning behind each decision. The one deliberate departure: the
 * multi-day span overlay grid here shares the exact box geometry (no
 * container padding) with the day-cell grid beneath it, so the two
 * independently-computed `repeat(7, 1fr)` tracks land on identical column
 * boundaries — the prototype's `.spansLayer { padding: 0 2px }` caused a
 * few-pixel misalignment between span bars and the day columns they span,
 * which this fixes by moving that inset onto `.spanBar`'s own margin instead
 * of the container's padding.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 2;

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local-time Date construction from a "YYYY-MM-DD" string — safe here because this component only ever runs client-side (in the browser's own local time), unlike the server-safe string-only helpers in calendar-shared.ts. */
function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function formatMonthYear(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatFullDate(iso: string): string {
  const d = parseLocal(iso);
  return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function formatMonthDay(iso: string): string {
  const d = parseLocal(iso);
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function formatDateRange(entry: CalendarEntryWithSlug): string {
  if (!entry.end_date || entry.end_date === entry.entry_date) return formatMonthDay(entry.entry_date);
  const s = parseLocal(entry.entry_date);
  const e = parseLocal(entry.end_date);
  const sm = MONTH_NAMES[s.getMonth()].slice(0, 3);
  const em = MONTH_NAMES[e.getMonth()].slice(0, 3);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${sm} ${s.getDate()}–${e.getDate()}`;
  return `${sm} ${s.getDate()} – ${em} ${e.getDate()}${e.getFullYear() !== s.getFullYear() ? ', ' + e.getFullYear() : ''}`;
}

function isMultiDay(e: CalendarEntryWithSlug): boolean {
  return !!e.end_date && e.end_date !== e.entry_date;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface DayCellData {
  date: Date;
  iso: string;
  inMonth: boolean;
}

/** Always-6-week (42-day) grid so navigating months never reflows page height. */
function buildMonthGrid(year: number, month: number): DayCellData[][] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const weeks: DayCellData[][] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: DayCellData[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: new Date(cursor), iso: toISO(cursor), inMonth: cursor.getMonth() === month });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

interface SpanPlacement {
  entry: CalendarEntryWithSlug;
  startCol: number;
  endCol: number;
  lane: number;
  isTrueStart: boolean;
  isTrueEnd: boolean;
}

/** Lane assignment for multi-day bars touching this week (greedy interval scheduling). `multiDayEntries` is already filter-aware. */
function computeWeekSpans(
  week: DayCellData[],
  multiDayEntries: CalendarEntryWithSlug[]
): { placed: SpanPlacement[]; laneCount: number } {
  const weekStartIso = week[0].iso;
  const weekEndIso = week[6].iso;
  const spanning = multiDayEntries
    .filter((e) => e.end_date! >= weekStartIso && e.entry_date <= weekEndIso)
    .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
  const laneEndCols: number[] = [];
  const placed: SpanPlacement[] = [];
  spanning.forEach((e) => {
    const isTrueStart = e.entry_date >= weekStartIso;
    const isTrueEnd = e.end_date! <= weekEndIso;
    const startCol = isTrueStart ? week.findIndex((d) => d.iso === e.entry_date) : 0;
    const endCol = isTrueEnd ? week.findIndex((d) => d.iso === e.end_date) : 6;
    let lane = laneEndCols.findIndex((endCol2) => endCol2 < startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(endCol);
    } else {
      laneEndCols[lane] = endCol;
    }
    placed.push({ entry: e, startCol, endCol, lane, isTrueStart, isTrueEnd });
  });
  return { placed, laneCount: laneEndCols.length };
}

interface PopoverPos {
  left: number;
  top: number;
  caretX: number;
  flipped: boolean;
}

export function MonthGrid({
  entries,
  activeCategories,
  isActive
}: {
  entries: CalendarEntryWithSlug[];
  activeCategories: Set<CalendarCategory>;
  isActive: boolean;
}) {
  const todayIso = useMemo(() => toISO(new Date()), []);
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [focusedIso, setFocusedIso] = useState(todayIso);
  const [popoverPos, setPopoverPos] = useState<PopoverPos | null>(null);
  const autoSelectDone = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function matchesFilter(e: CalendarEntryWithSlug) {
    return activeCategories.size === 0 || activeCategories.has(e.category);
  }

  function eventsOnDate(iso: string): CalendarEntryWithSlug[] {
    return entries
      .filter((e) => e.entry_date <= iso && (e.end_date ?? e.entry_date) >= iso)
      .sort((a, b) => {
        if (!a.start_time && !b.start_time) return 0;
        if (!a.start_time) return -1;
        if (!b.start_time) return 1;
        return a.start_time < b.start_time ? -1 : 1;
      });
  }

  function visibleEventsOnDate(iso: string): CalendarEntryWithSlug[] {
    return eventsOnDate(iso).filter(matchesFilter);
  }

  const weeks = useMemo(
    () => buildMonthGrid(monthCursor.getFullYear(), monthCursor.getMonth()),
    [monthCursor]
  );
  const flatIsos = useMemo(() => weeks.flat().map((d) => d.iso), [weeks]);
  const multiDayVisible = useMemo(
    () => entries.filter(isMultiDay).filter(matchesFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, activeCategories]
  );

  function positionPopover(cell: HTMLElement) {
    const pop = popoverRef.current;
    if (!pop) return;
    const margin = 12;
    const gap = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const popRect = pop.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    let left = cellRect.left;
    if (left + popRect.width > vw - margin) left = vw - margin - popRect.width;
    if (left < margin) left = margin;

    let top = cellRect.bottom + gap;
    let flipped = false;
    if (top + popRect.height > vh - margin) {
      const aboveTop = cellRect.top - gap - popRect.height;
      if (aboveTop >= margin) {
        top = aboveTop;
        flipped = true;
      } else {
        top = margin;
      }
    }
    const cellCenter = cellRect.left + cellRect.width / 2;
    const caretX = Math.min(Math.max(cellCenter - left, 16), Math.max(popRect.width - 16, 16));
    setPopoverPos({ left: Math.round(left), top: Math.round(top), caretX: Math.round(caretX), flipped });
  }

  function showPopoverFor(iso: string) {
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-iso="${iso}"]`);
    if (!cell) return;
    cell.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => positionPopover(cell));
  }

  function selectDate(iso: string, eventId?: number) {
    setSelectedIso(iso);
    setHighlightId(eventId ?? null);
    setFocusedIso(iso);
    const d = parseLocal(iso);
    const needsNav = d.getFullYear() !== monthCursor.getFullYear() || d.getMonth() !== monthCursor.getMonth();
    if (needsNav) {
      setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
      return; // the effect below re-anchors once the new grid renders
    }
    showPopoverFor(iso);
  }

  function deselect() {
    setSelectedIso(null);
    setHighlightId(null);
    setPopoverPos(null);
  }

  // Re-anchor whenever the grid rebuilds under an existing selection (month nav via selectDate, filter changes).
  useEffect(() => {
    if (!selectedIso) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-iso="${selectedIso}"]`);
    if (cell) showPopoverFor(selectedIso);
    else setPopoverPos(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, selectedIso]);

  // Auto-select today the first time this view is actually shown.
  useEffect(() => {
    if (!isActive || autoSelectDone.current) return;
    autoSelectDone.current = true;
    const t = new Date();
    if (t.getFullYear() === monthCursor.getFullYear() && t.getMonth() === monthCursor.getMonth()) {
      requestAnimationFrame(() => selectDate(todayIso));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // Popover follows its anchor on scroll/resize; closes if the anchor scrolls fully off-screen.
  useEffect(() => {
    if (!selectedIso) return;
    let scheduled = false;
    function onScrollOrResize() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const cell = gridRef.current?.querySelector<HTMLElement>(`[data-iso="${selectedIso}"]`);
        if (!cell) {
          deselect();
          return;
        }
        const r = cell.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
          deselect();
          return;
        }
        positionPopover(cell);
      });
    }
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [selectedIso]);

  // Click-outside (capture phase — a bubble-phase listener would fire after
  // whatever click OPENED the popover, e.g. the Today button, immediately
  // closing it again) + Escape close.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverPos) return;
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest(`.${styles.dayCell}, .${styles.chip}, .${styles.spanBar}`)) return;
      deselect();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && popoverPos) deselect();
    }
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [popoverPos]);

  function handleCellKeyDown(e: React.KeyboardEvent, iso: string) {
    const idx = flatIsos.indexOf(iso);
    let nextIdx: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
        nextIdx = idx + 1;
        break;
      case 'ArrowLeft':
        nextIdx = idx - 1;
        break;
      case 'ArrowDown':
        nextIdx = idx + 7;
        break;
      case 'ArrowUp':
        nextIdx = idx - 7;
        break;
      case 'Home':
        nextIdx = idx - (idx % 7);
        break;
      case 'End':
        nextIdx = idx - (idx % 7) + 6;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectDate(iso);
        return;
      default:
        return;
    }
    if (nextIdx !== null && nextIdx >= 0 && nextIdx < flatIsos.length) {
      e.preventDefault();
      const targetIso = flatIsos[nextIdx];
      setFocusedIso(targetIso);
      requestAnimationFrame(() => {
        gridRef.current?.querySelector<HTMLElement>(`[data-iso="${targetIso}"]`)?.focus();
      });
    }
  }

  const selectedDayEvents = selectedIso ? visibleEventsOnDate(selectedIso) : [];
  const selectedHiddenByFilter =
    !!selectedIso &&
    activeCategories.size > 0 &&
    eventsOnDate(selectedIso).length > 0 &&
    selectedDayEvents.length === 0;

  return (
    <div className={styles.monthCard}>
      <div className={styles.monthHeader}>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.monthNavBtn}
            aria-label="Previous month"
            onClick={() => {
              deselect();
              setMonthCursor((c) => addMonths(c, -1));
            }}
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.monthNavBtn}
            aria-label="Next month"
            onClick={() => {
              deselect();
              setMonthCursor((c) => addMonths(c, 1));
            }}
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
            </svg>
          </button>
        </div>
        <h2 className={styles.monthHeaderTitle} id="monthHeaderTitle">
          {formatMonthYear(monthCursor)}
        </h2>
        <button type="button" className={styles.todayBtn} onClick={() => selectDate(todayIso)}>
          Today
        </button>
      </div>

      <div className={styles.weekdayRow} aria-hidden="true">
        {WEEKDAY_ABBR.map((w) => (
          <span key={w} className={styles.weekdayCell}>
            {w}
          </span>
        ))}
      </div>

      <div className={styles.monthGridWrap} role="grid" aria-labelledby="monthHeaderTitle" ref={gridRef}>
        {weeks.map((week, wi) => {
          const { placed, laneCount } = computeWeekSpans(week, multiDayVisible);
          return (
            <div
              key={wi}
              className={styles.weekRow}
              role="row"
              style={{ '--lane-count': laneCount } as React.CSSProperties}
            >
              <div className={styles.cellsGrid}>
                {week.map((day) => {
                  const dayEvents = visibleEventsOnDate(day.iso);
                  const singleDay = dayEvents.filter((e) => !isMultiDay(e));
                  const isToday = day.iso === todayIso;
                  const isSelected = day.iso === selectedIso;
                  const total = dayEvents.length;
                  return (
                    <div
                      key={day.iso}
                      data-iso={day.iso}
                      role="gridcell"
                      tabIndex={day.iso === focusedIso ? 0 : -1}
                      className={[
                        styles.dayCell,
                        !day.inMonth ? styles.isOutside : '',
                        isToday ? styles.isToday : '',
                        isSelected ? styles.isSelected : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-selected={isSelected}
                      aria-label={`${formatFullDate(day.iso)}${
                        !day.inMonth ? ' (' + MONTH_NAMES[day.date.getMonth()] + ')' : ''
                      } — ${total === 0 ? 'no events' : total + ' event' + (total > 1 ? 's' : '')}`}
                      onClick={() => selectDate(day.iso)}
                      onKeyDown={(e) => handleCellKeyDown(e, day.iso)}
                    >
                      <div className={styles.dayNumRow}>
                        <span className={styles.dayNum}>{day.date.getDate()}</span>
                      </div>
                      <div className={styles.chipList}>
                        {singleDay.slice(0, MAX_CHIPS).map((e) => {
                          const color = categoryColor(e.category);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              className={styles.chip}
                              style={{ borderLeftColor: color, background: hexToRgba(color, 0.14) }}
                              aria-label={`${e.title}${e.start_time ? ` at ${formatTimeOfDay(e.start_time)}` : ''} — ${e.category}`}
                              onClick={(evt) => {
                                evt.stopPropagation();
                                selectDate(e.entry_date, e.id);
                              }}
                            >
                              <span className={styles.chipDot} style={{ background: color }} />
                              <span className={styles.chipTitle}>{e.title}</span>
                            </button>
                          );
                        })}
                        {singleDay.length > MAX_CHIPS && (
                          <span className={styles.chipMore}>+{singleDay.length - MAX_CHIPS} more</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {laneCount > 0 && (
                <div className={styles.spansLayer} aria-hidden="true">
                  {placed.map((p) => {
                    const color = categoryColor(p.entry.category);
                    return (
                      <button
                        key={p.entry.id}
                        type="button"
                        className={[styles.spanBar, p.isTrueStart ? styles.capStart : '', p.isTrueEnd ? styles.capEnd : '']
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          gridColumn: `${p.startCol + 1} / ${p.endCol + 2}`,
                          gridRow: p.lane + 1,
                          background: hexToRgba(color, 0.2),
                          borderColor: color
                        }}
                        aria-label={`${p.entry.title}, ${formatDateRange(p.entry)} — ${p.entry.category}`}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          selectDate(p.entry.entry_date, p.entry.id);
                        }}
                      >
                        {!p.isTrueStart && <span className={styles.spanChevron}>‹</span>}
                        <span className={styles.spanTitle}>{p.entry.title}</span>
                        {!p.isTrueEnd && <span className={styles.spanChevron}>›</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedIso && (
        <div
          ref={popoverRef}
          className={`${styles.dayPopover} ${popoverPos?.flipped ? styles.isFlipped : ''}`}
          role="dialog"
          aria-modal="false"
          aria-live="polite"
          style={
            popoverPos
              ? { left: popoverPos.left, top: popoverPos.top, visibility: 'visible' }
              // Rendered-but-unmeasured on the very first paint after selection —
              // positionPopover() needs this element mounted (via popoverRef) to
              // read its size before it can compute real coordinates, so it can't
              // be gated on popoverPos itself without a chicken-and-egg deadlock.
              : { left: 0, top: 0, visibility: 'hidden' }
          }
        >
          <div className={styles.dayPopoverCaret} style={{ left: popoverPos?.caretX ?? 0 }} />
          <div className={styles.dayPopoverHeader}>
            <h2 className={styles.dayPopoverDate}>{formatFullDate(selectedIso)}</h2>
            <button
              type="button"
              className={styles.dayPopoverClose}
              aria-label="Close"
              onClick={() => {
                const cell = gridRef.current?.querySelector<HTMLElement>(`[data-iso="${selectedIso}"]`);
                deselect();
                cell?.focus();
              }}
            >
              &times;
            </button>
          </div>
          {selectedDayEvents.length === 0 ? (
            <p className={styles.dayPopoverEmpty}>
              {selectedHiddenByFilter ? 'No events match the current filter this day.' : 'Nothing scheduled this day.'}
            </p>
          ) : (
            <div className={styles.dayEventList}>
              {selectedDayEvents.map((e) => {
                const color = categoryColor(e.category);
                return (
                  <div
                    key={e.id}
                    className={`${styles.dayEventCard} ${highlightId === e.id ? styles.isHighlighted : ''}`}
                    style={{ borderLeftColor: color }}
                  >
                    <p className={styles.dayEventCardTitle}>
                      {e.articleSlug ? <Link href={`/news/${e.articleSlug}`}>{e.title}</Link> : e.title}
                      {e.day_note && <span className={styles.dayNote}>{e.day_note}</span>}
                    </p>
                    <p className={styles.dayEventCardCat} style={{ color }}>
                      {e.category}
                      {isMultiDay(e) ? ` · ${formatDateRange(e)}` : ''}
                    </p>
                    <div className={styles.dayEventCardMeta}>
                      {e.start_time ? (
                        <span>
                          {formatTimeOfDay(e.start_time)}
                          {e.end_time && <> – {formatTimeOfDay(e.end_time)}</>}
                        </span>
                      ) : (
                        <span>All day</span>
                      )}
                      {e.location && <span>{e.location}</span>}
                    </div>
                    {e.description && <p className={styles.dayEventCardDesc}>{e.description}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
