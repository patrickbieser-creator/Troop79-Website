'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
const MAX_CHIPS = 4;

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
  onMonthChange,
  search
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
  /** The browsing position, already encoded — travels into every chip's link
   *  so an event page can offer a way back to this exact month and filter. */
  search: string;
}) {
  const todayIso = useMemo(() => toISO(new Date()), []);
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const urlMonthApplied = useRef(false);
  const [focusedIso, setFocusedIso] = useState(todayIso);
  const gridRef = useRef<HTMLDivElement>(null);

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

  /*
   * THE DAY POPOVER IS GONE (2026-08-15, Patrick — see
   * Plans/Calendar-Detail-And-Signup-Split.md).
   *
   * It existed because nothing in this grid linked anywhere, so clicking a day
   * was the only way to learn what an event was. The chips are links to the
   * event's own page now, which is a better answer to the same question, and
   * the popover's only remaining job would have been overflow for days with
   * more chips than fit. That has never happened: of 121 populated days, 118
   * hold one event and 3 hold two, against a MAX_CHIPS that is now 4.
   *
   * Removed with it: anchor positioning and edge-clamping, reposition-on-
   * scroll, click-outside and Escape handling, the selected-day state, and the
   * "Nothing scheduled this day" panel that appeared when you clicked an empty
   * cell. An empty cell now does nothing at all, which is the whole point.
   */

  /**
   * Arrow-key traversal of the grid, kept.
   *
   * The cells no longer DO anything when activated, but they still carry the
   * date and event count in their aria-label, so being able to walk the month
   * is worth having — and the chips inside them are ordinary links that Tab
   * reaches. The Enter/Space branch that used to open the popover is gone.
   */
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

  return (
    <div className={styles.monthCard}>
      <div className={styles.monthHeader}>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.monthNavBtn}
            aria-label="Previous month"
            onClick={() => setMonthCursor((c) => addMonths(c, -1))}
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.monthNavBtn}
            aria-label="Next month"
            onClick={() => setMonthCursor((c) => addMonths(c, 1))}
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
            </svg>
          </button>
        </div>
        <h2 className={styles.monthHeaderTitle} id="monthHeaderTitle">
          {formatMonthYear(monthCursor)}
        </h2>
        <button type="button" className={styles.todayBtn} onClick={() => {
            const t = new Date();
            setMonthCursor(new Date(t.getFullYear(), t.getMonth(), 1));
            setFocusedIso(todayIso);
          }}>
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
                        isToday ? styles.isToday : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`${formatFullDate(day.iso)}${
                        !day.inMonth ? ' (' + MONTH_NAMES[day.date.getMonth()] + ')' : ''
                      } — ${total === 0 ? 'no events' : total + ' event' + (total > 1 ? 's' : '')}`}
                      /* No onClick — an empty cell does nothing (Patrick,
                         2026-08-15). The chips below are the interactive part. */
                      onKeyDown={(e) => handleCellKeyDown(e, day.iso)}
                    >
                      <div className={styles.dayNumRow}>
                        <span className={styles.dayNum}>{day.date.getDate()}</span>
                      </div>
                      <div className={styles.chipList}>
                        {singleDay.slice(0, MAX_CHIPS).map((e) => {
                          const color = colorFor(colors, e.category);
                          return (
                            <Link
                              key={e.id}
                              href={`/events/${e.id}${search ? `?${search}` : ''}`}
                              className={styles.chip}
                              style={{ borderLeftColor: color, background: hexToRgba(color, 0.14) }}
                              aria-label={`${e.title}${e.start_time ? ` at ${formatTimeOfDay(e.start_time)}` : ''} — ${e.category}`}
                            >
                              <span className={styles.chipDot} style={{ background: color }} />
                              <span className={styles.chipTitle}>{e.title}</span>
                            </Link>
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
                /*
                 * No longer aria-hidden. A multi-day event appears ONLY as a
                 * span bar — never as a chip — so hiding this layer meant a
                 * campout was invisible to a screen reader entirely. As inert
                 * buttons that was merely bad; as links it would be a whole
                 * class of event unreachable without a mouse.
                 *
                 * A bar that continues into the next week renders once per
                 * week, so the same event can appear twice in a month. The
                 * chevrons say which end is a continuation; the aria-label
                 * carries the full date range so the repeat reads as one event
                 * spanning weeks rather than two separate ones.
                 */
                <div className={styles.spansLayer}>
                  {placed.map((p) => {
                    const color = colorFor(colors, p.entry.category);
                    return (
                      <Link
                        key={p.entry.id}
                        href={`/events/${p.entry.id}${search ? `?${search}` : ''}`}
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
                      >
                        {!p.isTrueStart && <span className={styles.spanChevron} aria-hidden="true">‹</span>}
                        <span className={styles.spanTitle}>{p.entry.title}</span>
                        {!p.isTrueEnd && <span className={styles.spanChevron} aria-hidden="true">›</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
