'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEntryPublic } from '@/lib/calendar';
import { colorFor, type CategoryColorMap } from '@/lib/calendar-categories';
import { formatTimeOfDay } from '@/lib/calendar-shared';
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

function formatDateRange(entry: CalendarEntryPublic): string {
  if (!entry.end_date || entry.end_date === entry.entry_date) return formatMonthDay(entry.entry_date);
  const s = parseLocal(entry.entry_date);
  const e = parseLocal(entry.end_date);
  const sm = MONTH_NAMES[s.getMonth()].slice(0, 3);
  const em = MONTH_NAMES[e.getMonth()].slice(0, 3);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${sm} ${s.getDate()}–${e.getDate()}`;
  return `${sm} ${s.getDate()} – ${em} ${e.getDate()}${e.getFullYear() !== s.getFullYear() ? ', ' + e.getFullYear() : ''}`;
}

function isMultiDay(e: CalendarEntryPublic): boolean {
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
  entry: CalendarEntryPublic;
  startCol: number;
  endCol: number;
  lane: number;
  isTrueStart: boolean;
  isTrueEnd: boolean;
}

/** Lane assignment for multi-day bars touching this week (greedy interval scheduling). `multiDayEntries` is already filter-aware. */
function computeWeekSpans(
  week: DayCellData[],
  multiDayEntries: CalendarEntryPublic[]
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

/** 'YYYY-MM' → the first of that month, or null if it isn't one. Rejects a
 *  hand-edited ?m= rather than letting `new Date(NaN)` reach the grid. */
function parseMonthParam(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const d = new Date(year, monthIndex, 1);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMonthParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function MonthGrid({
  entries,
  activeCategories,
  colors,
  initialMonth,
  onMonthChange
}: {
  entries: CalendarEntryPublic[];
  activeCategories: Set<string>;
  /** Category → accent color, from the calendar_categories lookup (D-082). */
  colors: CategoryColorMap;
  /* `isActive` used to live here. Its only job was telling the grid when it
     first became visible so it could auto-select today — behaviour removed
     2026-08-15, and the prop with it. */
  /** 'YYYY-MM' from the URL, applied ONCE after mount (see the effect below).
   *  Deliberately not a controlled value, so paging the month doesn't
   *  round-trip through a parent and back. */
  initialMonth?: string | null;
  /** Reports the visible month up so the URL can carry it. */
  onMonthChange?: (month: string) => void;
}) {
  const todayIso = useMemo(() => toISO(new Date()), []);
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const urlMonthApplied = useRef(false);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [focusedIso, setFocusedIso] = useState(todayIso);
  const [popoverPos, setPopoverPos] = useState<PopoverPos | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function matchesFilter(e: CalendarEntryPublic) {
    return activeCategories.size === 0 || activeCategories.has(e.category);
  }

  function eventsOnDate(iso: string): CalendarEntryPublic[] {
    return entries
      .filter((e) => e.entry_date <= iso && (e.end_date ?? e.entry_date) >= iso)
      .sort((a, b) => {
        if (!a.start_time && !b.start_time) return 0;
        if (!a.start_time) return -1;
        if (!b.start_time) return 1;
        return a.start_time < b.start_time ? -1 : 1;
      });
  }

  function visibleEventsOnDate(iso: string): CalendarEntryPublic[] {
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

  /*
   * Span lanes, resolved for the WHOLE MONTH before any row renders.
   *
   * Each week still gets its own lane count — that's what offsets its chips
   * below its own span bars. But every row is sized by the month's MAXIMUM,
   * so the grid keeps square rows instead of the week containing a campout
   * standing 22px taller than the five around it (reported 2026-08-15 as the
   * month view "breaking the symmetry of the boxes"; measured at 118px vs
   * 96px in October 2026).
   *
   * The two numbers are deliberately separate: sizing with the max and
   * offsetting with the max would push every week's chips down to clear span
   * bars that week doesn't have.
   */
  const weekSpans = useMemo(
    () => weeks.map((week) => computeWeekSpans(week, multiDayVisible)),
    [weeks, multiDayVisible]
  );
  const monthLaneCount = useMemo(
    () => weekSpans.reduce((max, w) => Math.max(max, w.laneCount), 0),
    [weekSpans]
  );

  /*
   * Apply the URL's month once, after mount.
   *
   * It cannot seed useState: the server has no URL, so the two renders would
   * disagree and React would discard the tree (hydration mismatch, hit for
   * real on 2026-08-15). The parent reads the query string in its own mount
   * effect and passes the value down, so this fires on the render after that
   * — the same one-frame delay category and query already have.
   *
   * Guarded by a ref rather than a dependency check because it must not fight
   * the user: once they page to another month, a re-render carrying the
   * original ?m= must not yank them back.
   */
  useEffect(() => {
    if (urlMonthApplied.current) return;
    const fromUrl = parseMonthParam(initialMonth);
    if (!fromUrl) return;
    urlMonthApplied.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthCursor(fromUrl);
  }, [initialMonth]);

  // Publish the visible month so the URL can carry it. One-way: this never
  // reads back down, which is what keeps paging from looping through the
  // parent's state.
  useEffect(() => {
    onMonthChange?.(toMonthParam(monthCursor));
  }, [monthCursor, onMonthChange]);

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

  /*
   * Today is NOT auto-selected (removed 2026-08-15, Patrick).
   *
   * Switching to the month view used to open today's popover on its own, so
   * the first thing a visitor saw was a floating panel over the grid they had
   * just asked for — and on a day with nothing on it, that panel read "Nothing
   * scheduled this day", which is a strange thing to volunteer.
   *
   * Today is marked in the grid itself instead (.isToday), which is what a
   * calendar is expected to do. The popover is now only ever opened by a
   * deliberate click.
   */

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

      <div
        className={styles.monthGridWrap}
        role="grid"
        aria-labelledby="monthHeaderTitle"
        ref={gridRef}
        style={{ '--month-lanes': monthLaneCount } as React.CSSProperties}
      >
        {weeks.map((week, wi) => {
          const { placed, laneCount } = weekSpans[wi];
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
                          const color = colorFor(colors, e.category);
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
                    const color = colorFor(colors, p.entry.category);
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
                const color = colorFor(colors, e.category);
                return (
                  <div
                    key={e.id}
                    className={`${styles.dayEventCard} ${highlightId === e.id ? styles.isHighlighted : ''}`}
                    style={{ borderLeftColor: color }}
                  >
                    <p className={styles.dayEventCardTitle}>
                      {e.title}
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
