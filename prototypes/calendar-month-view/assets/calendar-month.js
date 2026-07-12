/* ════════════════════════════════════════════════════════════════════
   CALENDAR MONTH-VIEW PROTOTYPE — app logic (vanilla JS, no build step)

   This is a design-exploration prototype, not production code. It stands
   up its OWN List view (ported from events.module.css / calendar-browser.tsx)
   purely so the List⇄Month segmented toggle has something real to switch
   between — the production List view + filter chips already exist at
   next-app/src/app/(public)/events/calendar-browser.tsx and are not being
   changed here. The filter-chip markup/behavior below is ported to match
   that file exactly (same classes, same multi-select + "Clear filter"
   semantics) so this prototype and production read as the same component.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Category taxonomy — must stay byte-for-byte in sync with
     next-app/src/lib/calendar-shared.ts (CATEGORIES / CATEGORY_COLORS). ── */
  const CATEGORIES = [
    'Troop Meeting', 'Campout', 'High Adventure', 'Summer Camp', 'Service Project',
    'Outing', 'Fundraiser', 'Court of Honor', 'Committee Meeting', 'Ceremony', 'No Meeting'
  ];
  const CATEGORY_COLORS = {
    'Troop Meeting': '#1e3a4a',
    'Campout': '#3d5a3e',
    'High Adventure': '#2d6a4f',
    'Summer Camp': '#527554',
    'Service Project': '#6a5d3a',
    'Outing': '#4a6741',
    'Fundraiser': '#8b6914',
    'Court of Honor': '#5a3d6a',
    'Committee Meeting': '#4c5c6a',
    'Ceremony': '#a04a3d',
    'No Meeting': '#a0978a'
  };

  // Fixed reference date so the demo (Upcoming/Past split, "Today" marker,
  // auto-selection on load) reads sensibly no matter when a stakeholder
  // actually opens this file — deliberately NOT `new Date()`. See the
  // judgment-call notes near </body>.
  const DEMO_TODAY_ISO = '2026-07-11';

  const EVENTS = window.CALENDAR_EVENTS || [];

  /* ── Date helpers — all string math on "YYYY-MM-DD", or local-time Date
     construction via (y, m, d) args, to sidestep any UTC/timezone shift
     (same reasoning as calendar-shared.ts's formatCalendarDateParts). ── */
  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function formatMonthYear(date) { return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`; }
  function formatFullDate(iso) {
    const d = parseISO(iso);
    return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  }
  function formatMonthDay(iso) {
    const d = parseISO(iso);
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  }
  function formatTime12(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const period = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
  }
  function formatDateRange(entry) {
    if (!entry.end_date || entry.end_date === entry.entry_date) return formatMonthDay(entry.entry_date);
    const s = parseISO(entry.entry_date), e = parseISO(entry.end_date);
    const sm = MONTH_NAMES[s.getMonth()].slice(0, 3), em = MONTH_NAMES[e.getMonth()].slice(0, 3);
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${sm} ${s.getDate()}–${e.getDate()}`;
    return `${sm} ${s.getDate()} – ${em} ${e.getDate()}${e.getFullYear() !== s.getFullYear() ? ', ' + e.getFullYear() : ''}`;
  }
  function isMultiDay(e) { return !!e.end_date && e.end_date !== e.entry_date; }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /** All events touching a given day, all-day/undated-time entries first, then by start_time. Unfiltered — see visibleEventsOnDate() for the filter-aware version used by all rendering. */
  function eventsOnDate(iso) {
    return EVENTS.filter((e) => e.entry_date <= iso && (e.end_date || e.entry_date) >= iso).sort((a, b) => {
      if (!a.start_time && !b.start_time) return 0;
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });
  }

  /** True if `e` should be shown given the current category filter (empty selection = show everything, matching calendar-browser.tsx's `active.size === 0 ? list : list.filter(...)`). */
  function matchesFilter(e) {
    return state.activeCategories.size === 0 || state.activeCategories.has(e.category);
  }
  function visibleEventsOnDate(iso) {
    return eventsOnDate(iso).filter(matchesFilter);
  }

  function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }

  /** Always-6-week (42-day) grid so navigating months never reflows page height. */
  function buildMonthGrid(year, month) {
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    const weeks = [];
    const cursor = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        week.push({ date: new Date(cursor), iso: toISO(cursor), inMonth: cursor.getMonth() === month });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  /** Lane assignment for multi-day bars touching this week (greedy interval scheduling, recomputed per week — see judgment-call notes for the one known edge case this simplifies away). Filter-aware: a span hidden by the active category filter doesn't reserve a lane. */
  function computeWeekSpans(week) {
    const weekStartIso = week[0].iso, weekEndIso = week[6].iso;
    const spanning = EVENTS.filter(isMultiDay).filter(matchesFilter).filter((e) => e.end_date >= weekStartIso && e.entry_date <= weekEndIso);
    spanning.sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const laneEndCols = [];
    const placed = [];
    spanning.forEach((e) => {
      const isTrueStart = e.entry_date >= weekStartIso;
      const isTrueEnd = e.end_date <= weekEndIso;
      const startCol = isTrueStart ? week.findIndex((d) => d.iso === e.entry_date) : 0;
      const endCol = isTrueEnd ? week.findIndex((d) => d.iso === e.end_date) : 6;
      let lane = laneEndCols.findIndex((endCol2) => endCol2 < startCol);
      if (lane === -1) { lane = laneEndCols.length; laneEndCols.push(endCol); }
      else laneEndCols[lane] = endCol;
      placed.push({ event: e, startCol, endCol, lane, isTrueStart, isTrueEnd });
    });
    return { placed, laneCount: laneEndCols.length };
  }

  /* ══════════════════════════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════════════════════════ */
  const state = {
    view: 'list',
    monthCursor: new Date(2026, 6, 1), // July 2026 — contains DEMO_TODAY_ISO
    selectedDateIso: null,
    highlightEventId: null,
    focusedIso: DEMO_TODAY_ISO,
    activeCategories: new Set(), // shared by List AND Month — empty = no filter
    todayAutoSelectPending: true // consumed the first time Month view becomes visible
  };

  /* ══════════════════════════════════════════════════════════════════
     DOM refs
     ══════════════════════════════════════════════════════════════════ */
  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.tabList = document.getElementById('tabList');
    els.tabMonth = document.getElementById('tabMonth');
    els.listView = document.getElementById('listView');
    els.monthView = document.getElementById('monthView');
    els.monthHeaderTitle = document.getElementById('monthHeaderTitle');
    els.monthGridBody = document.getElementById('monthGridBody');
    els.prevBtn = document.getElementById('prevMonthBtn');
    els.nextBtn = document.getElementById('nextMonthBtn');
    els.todayBtn = document.getElementById('todayBtn');
    els.dayPopover = document.getElementById('dayPopover');
    els.dayPopoverDate = document.getElementById('dayPopoverDate');
    els.dayPopoverBody = document.getElementById('dayPopoverBody');
    els.dayPopoverClose = document.getElementById('dayPopoverClose');
    els.dayPopoverCaret = document.getElementById('dayPopoverCaret');
    els.filterBar = document.getElementById('filterBar');
    els.listUpcoming = document.getElementById('listUpcoming');
    els.listPast = document.getElementById('listPast');
    els.listPastSection = document.getElementById('listPastSection');

    renderFilterBar();
    renderList();
    renderMonth();
    wireControls();
  }

  function wireControls() {
    els.tabList.addEventListener('click', () => setView('list'));
    els.tabMonth.addEventListener('click', () => setView('month'));
    // Tabs pattern: arrow keys move between tabs without a separate Tab stop.
    // Segmented control convention: arrow keys move AND activate immediately
    // (unlike an editor-tabs pattern where arrow keys only move focus) —
    // matches how OS-level segmented controls (iOS, macOS) behave.
    [els.tabList, els.tabMonth].forEach((btn, i, arr) => {
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = arr[(i + (e.key === 'ArrowRight' ? 1 : arr.length - 1)) % arr.length];
          next.focus();
          setView(next === els.tabList ? 'list' : 'month');
        }
      });
    });

    els.prevBtn.addEventListener('click', () => {
      deselectDay();
      state.monthCursor = addMonths(state.monthCursor, -1);
      renderMonth();
    });
    els.nextBtn.addEventListener('click', () => {
      deselectDay();
      state.monthCursor = addMonths(state.monthCursor, 1);
      renderMonth();
    });
    els.todayBtn.addEventListener('click', () => selectDate(DEMO_TODAY_ISO));

    els.dayPopoverClose.addEventListener('click', () => {
      const prevIso = state.selectedDateIso;
      deselectDay();
      focusCellIfPresent(prevIso);
    });

    // Non-modal popover conventions: Escape closes it and returns focus to
    // the day that opened it; a click anywhere else on the page closes it
    // too (chips/spans/cells are excluded since they have their own
    // click handlers that re-open/re-anchor the popover instead).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.dayPopover.hidden) {
        const prevIso = state.selectedDateIso;
        deselectDay();
        focusCellIfPresent(prevIso);
      }
    });
    // Capture phase, deliberately: a bubble-phase listener here would fire
    // AFTER whatever button was clicked has already run its own handler —
    // which breaks any click that legitimately OPENS the popover as a side
    // effect (the Month tab on first visit, the Today button), since by the
    // time the click bubbles back up to document the popover would already
    // be open and this listener would immediately close it again. Capture
    // phase runs before the target's own handler, so it only ever acts on
    // whatever was open from the PREVIOUS interaction.
    document.addEventListener('click', (e) => {
      if (els.dayPopover.hidden) return;
      if (els.dayPopover.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.dayCell, .chip, .spanBar')) return;
      deselectDay();
    }, true);

    // The popover is position:fixed and anchored to a specific day cell's
    // on-screen rect, so it has to follow that cell on scroll/resize rather
    // than staying pinned to a now-stale coordinate. Throttled via rAF.
    let repositionScheduled = false;
    function scheduleReposition() {
      if (repositionScheduled) return;
      repositionScheduled = true;
      requestAnimationFrame(() => {
        repositionScheduled = false;
        if (els.dayPopover.hidden || !state.selectedDateIso) return;
        const cell = els.monthGridBody.querySelector(`[data-iso="${state.selectedDateIso}"]`);
        if (!cell) { deselectDay(); return; }
        const r = cell.getBoundingClientRect();
        // If its anchor has scrolled entirely out of the viewport, closing
        // is simpler and more predictable than trying to preserve-and-later
        //-restore the popover — a known simplification, see judgment notes.
        if (r.bottom < 0 || r.top > window.innerHeight) { deselectDay(); return; }
        positionPopoverAt(cell);
      });
    }
    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.addEventListener('resize', scheduleReposition);
  }

  function focusCellIfPresent(iso) {
    if (!iso) return;
    const cell = els.monthGridBody.querySelector(`[data-iso="${iso}"]`);
    if (cell) cell.focus();
  }

  function setView(view) {
    state.view = view;
    const isList = view === 'list';
    els.listView.hidden = !isList;
    els.monthView.hidden = isList;
    els.tabList.classList.toggle('isActive', isList);
    els.tabMonth.classList.toggle('isActive', !isList);
    els.tabList.setAttribute('aria-selected', String(isList));
    els.tabMonth.setAttribute('aria-selected', String(!isList));
    els.tabList.tabIndex = isList ? 0 : -1;
    els.tabMonth.tabIndex = isList ? -1 : 0;

    if (isList) {
      // Soft-hide only — position:fixed would otherwise float the popover
      // over the List view. Selection state is kept so it reappears if the
      // user switches back to Month (deliberately NOT deselectDay() here).
      hidePopover();
      return;
    }

    if (state.todayAutoSelectPending) {
      state.todayAutoSelectPending = false;
      const t = parseISO(DEMO_TODAY_ISO);
      if (t.getFullYear() === state.monthCursor.getFullYear() && t.getMonth() === state.monthCursor.getMonth()) {
        selectDate(DEMO_TODAY_ISO);
        return;
      }
    }
    if (state.selectedDateIso) {
      const cell = els.monthGridBody.querySelector(`[data-iso="${state.selectedDateIso}"]`);
      if (cell) showPopover(cell);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     FILTER BAR — ported verbatim (classes + multi-select + Clear button)
     from next-app/src/app/(public)/events/calendar-browser.tsx, so this
     prototype and production behave identically. Shared by both views:
     toggling a chip re-renders whichever view(s) are built, and the
     selection is NOT reset when the List/Month toggle is used.
     ══════════════════════════════════════════════════════════════════ */
  function renderFilterBar() {
    const chips = CATEGORIES.map((c) => {
      const isActive = state.activeCategories.has(c);
      const color = CATEGORY_COLORS[c];
      return `
        <button type="button" class="filterChip${isActive ? ' filterChipActive' : ''}" data-cat="${c}"
          ${isActive ? `style="background:${color};border-color:${color}"` : ''} aria-pressed="${isActive}">
          <span class="filterPip" style="background:${isActive ? '#fff' : color}"></span>${c}
        </button>`;
    }).join('');
    const clear = state.activeCategories.size > 0
      ? '<button type="button" class="filterClear" id="filterClearBtn">Clear filter</button>'
      : '';
    els.filterBar.innerHTML = chips + clear;

    els.filterBar.querySelectorAll('.filterChip').forEach((btn) => {
      btn.addEventListener('click', () => toggleCategory(btn.dataset.cat));
    });
    const clearBtn = document.getElementById('filterClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearFilter);
  }

  function toggleCategory(cat) {
    if (state.activeCategories.has(cat)) state.activeCategories.delete(cat);
    else state.activeCategories.add(cat);
    applyFilter();
  }
  function clearFilter() {
    state.activeCategories.clear();
    applyFilter();
  }
  function applyFilter() {
    renderFilterBar();
    renderList();
    renderMonth();
  }

  /* ══════════════════════════════════════════════════════════════════
     LIST VIEW (ported layout, for toggle parity — see file header note)
     ══════════════════════════════════════════════════════════════════ */
  function renderList() {
    const all = EVENTS.filter(matchesFilter).sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const upcoming = all.filter((e) => (e.end_date || e.entry_date) >= DEMO_TODAY_ISO);
    const past = all.filter((e) => (e.end_date || e.entry_date) < DEMO_TODAY_ISO).reverse();

    els.listUpcoming.innerHTML = upcoming.length
      ? upcoming.map((e) => listRow(e, false)).join('')
      : `<p class="empty">${state.activeCategories.size > 0 ? 'No upcoming entries match that filter.' : 'Nothing on the calendar yet.'}</p>`;

    if (past.length) {
      els.listPastSection.hidden = false;
      els.listPast.innerHTML = past.map((e) => listRow(e, true)).join('');
    } else {
      els.listPastSection.hidden = true;
    }
  }

  function listRow(e, isPast) {
    const color = CATEGORY_COLORS[e.category];
    const month = formatMonthDay(e.entry_date).split(' ')[0].toUpperCase();
    const day = String(parseISO(e.entry_date).getDate());
    return `
      <li class="item ${isPast ? 'pastItem' : ''}">
        <div class="dateBlock" ${isPast ? '' : `style="background:${color}"`}>
          <div class="eMonth">${month}</div>
          <div class="eDay">${day}</div>
        </div>
        <div class="itemBody">
          <p class="itemTitle">${escapeHtml(e.title)}${e.day_note ? `<span class="dayNote">${escapeHtml(e.day_note)}</span>` : ''}</p>
          <p class="itemCategory" style="color:${color}">${e.category}${isMultiDay(e) ? ` &middot; ${formatDateRange(e)}` : ''}</p>
          ${e.start_time ? `<p class="itemMeta">${formatTime12(e.start_time)}${e.end_time ? ` &ndash; ${formatTime12(e.end_time)}` : ''}</p>` : ''}
          ${e.location ? `<p class="itemMeta">${escapeHtml(e.location)}</p>` : ''}
          ${e.description ? `<p class="itemDesc">${escapeHtml(e.description)}</p>` : ''}
        </div>
      </li>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ══════════════════════════════════════════════════════════════════
     MONTH VIEW
     ══════════════════════════════════════════════════════════════════ */
  function renderMonth() {
    const year = state.monthCursor.getFullYear(), month = state.monthCursor.getMonth();
    els.monthHeaderTitle.textContent = formatMonthYear(state.monthCursor);
    const weeks = buildMonthGrid(year, month);

    els.monthGridBody.innerHTML = '';
    weeks.forEach((week) => {
      const { placed, laneCount } = computeWeekSpans(week);

      // Each week is a position:relative wrapper containing (1) a 7-column
      // CSS grid of real, focusable day cells and (2) an absolutely
      // positioned overlay grid for multi-day span bars. Using div/ARIA
      // roles here (rather than a literal <table>) is what lets the span
      // overlay sit on top of the cells without fighting <table> column
      // layout — a <td> forced to position:absolute stops participating in
      // the table's column count, which silently breaks column widths.
      const weekRow = document.createElement('div');
      weekRow.className = 'weekRow';
      weekRow.setAttribute('role', 'row');
      weekRow.style.setProperty('--lane-count', String(laneCount));

      const cellsGrid = document.createElement('div');
      cellsGrid.className = 'cellsGrid';
      week.forEach((day) => cellsGrid.appendChild(buildDayCell(day)));
      weekRow.appendChild(cellsGrid);

      if (laneCount > 0) {
        const spansLayer = document.createElement('div');
        spansLayer.className = 'spansLayer';
        spansLayer.setAttribute('aria-hidden', 'true');
        placed.forEach((p) => spansLayer.appendChild(buildSpanBar(p)));
        weekRow.appendChild(spansLayer);
      }

      els.monthGridBody.appendChild(weekRow);
    });

    syncRovingTabindex();

    // Popover follow-up: this covers every path that rebuilds the whole
    // grid out from under an existing selection — any selectDate() call
    // whose iso lands outside the previously-displayed month (a grayed
    // day cell, a chip, or a span bar on one; also the Today button) — by
    // re-anchoring to the newly-rendered cell for the same iso. Plain
    // Prev/Next navigation always calls deselectDay() first (see
    // wireControls()), so there's normally nothing to re-anchor there.
    if (state.selectedDateIso) {
      const cell = els.monthGridBody.querySelector(`[data-iso="${state.selectedDateIso}"]`);
      if (cell && state.view === 'month') showPopover(cell);
      else if (!cell) hidePopover();
    }
  }

  function buildDayCell(day) {
    // A gridcell needs to be a plain, focusable <div> rather than a <button>:
    // it contains its OWN nested interactive chips/span-bar <button>s, and
    // HTML forbids interactive content inside a <button> (browsers will
    // silently mis-parse a button-in-a-button, breaking both). The div gets
    // the same click/keydown wiring a button would via role="gridcell" +
    // tabindex + explicit Enter/Space handling.
    const dayEvents = visibleEventsOnDate(day.iso);
    const singleDay = dayEvents.filter((e) => !isMultiDay(e));
    const isToday = day.iso === DEMO_TODAY_ISO;
    const isSelected = day.iso === state.selectedDateIso;

    const cell = document.createElement('div');
    cell.setAttribute('role', 'gridcell');
    cell.className = `dayCell${day.inMonth ? '' : ' isOutside'}${isToday ? ' isToday' : ''}${isSelected ? ' isSelected' : ''}`;
    cell.dataset.iso = day.iso;
    cell.tabIndex = day.iso === state.focusedIso ? 0 : -1;

    const total = dayEvents.length;
    cell.setAttribute('aria-label', `${formatFullDate(day.iso)}${day.inMonth ? '' : ' (' + MONTH_NAMES[day.date.getMonth()] + ')'} — ${total === 0 ? 'no events' : total + ' event' + (total > 1 ? 's' : '')}`);
    cell.setAttribute('aria-selected', String(isSelected));

    const numRow = document.createElement('div');
    numRow.className = 'dayNumRow';
    const num = document.createElement('span');
    num.className = 'dayNum';
    num.textContent = String(day.date.getDate());
    numRow.appendChild(num);
    cell.appendChild(numRow);

    const chipList = document.createElement('div');
    chipList.className = 'chipList';
    const MAX_CHIPS = 2;
    singleDay.slice(0, MAX_CHIPS).forEach((e) => {
      chipList.appendChild(buildChip(e));
    });
    if (singleDay.length > MAX_CHIPS) {
      const more = document.createElement('span');
      more.className = 'chipMore';
      more.textContent = `+${singleDay.length - MAX_CHIPS} more`;
      chipList.appendChild(more);
    }
    cell.appendChild(chipList);

    cell.addEventListener('click', () => selectDate(day.iso));
    cell.addEventListener('keydown', (e) => handleCellKeydown(e, day));

    return cell;
  }

  function buildChip(e) {
    const color = CATEGORY_COLORS[e.category];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.style.borderLeftColor = color;
    chip.style.background = hexToRgba(color, 0.14);
    chip.dataset.eventId = e.id;
    const timeLabel = e.start_time ? ` at ${formatTime12(e.start_time)}` : '';
    chip.setAttribute('aria-label', `${e.title}${timeLabel} — ${e.category}`);
    chip.innerHTML = `<span class="chipDot" style="background:${color}"></span><span class="chipTitle">${escapeHtml(e.title)}</span>`;
    chip.addEventListener('click', (evt) => {
      evt.stopPropagation();
      selectDate(e.entry_date, e.id);
    });
    return chip;
  }

  function buildSpanBar(p) {
    const color = CATEGORY_COLORS[p.event.category];
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = `spanBar${p.isTrueStart ? ' capStart' : ''}${p.isTrueEnd ? ' capEnd' : ''}`;
    bar.style.gridColumn = `${p.startCol + 1} / ${p.endCol + 2}`;
    bar.style.gridRow = `${p.lane + 1}`;
    bar.style.background = hexToRgba(color, 0.2);
    bar.style.borderColor = color;
    bar.style.color = 'var(--text-head)';
    bar.dataset.eventId = p.event.id;
    bar.setAttribute('aria-label', `${p.event.title}, ${formatDateRange(p.event)} — ${p.event.category}`);
    bar.innerHTML = `${!p.isTrueStart ? '<span class="spanChevron">‹</span>' : ''}<span class="spanTitle">${escapeHtml(p.event.title)}</span>${!p.isTrueEnd ? '<span class="spanChevron">›</span>' : ''}`;
    bar.addEventListener('click', (evt) => {
      evt.stopPropagation();
      // Select whichever day of the visible week this bar's cap represents,
      // preferring the true start date so the popover opens on the day the
      // event actually begins.
      selectDate(p.event.entry_date, p.event.id);
    });
    return bar;
  }

  /**
   * Select (and show a popover for) a day. Whether this needs to navigate
   * the grid to a different month is derived from `iso` itself — NOT passed
   * in by the caller — because a click can land on a day outside the
   * currently-displayed month through more than one path: clicking a
   * grayed leading/trailing day cell directly, but ALSO clicking a
   * multi-day span bar's continuation segment rendered on one of those
   * grayed cells (e.g. a campout that starts next month, shown trailing
   * into this month's last row) or a chip on one. Deriving it here instead
   * of threading a flag through every caller is what makes all of those
   * paths behave consistently — an earlier version only forced month nav
   * from the day-cell's own click handler, so clicking a span bar's
   * continuation on a grayed day showed the right popover content but left
   * the header on the wrong month. Caught during browser verification.
   */
  function selectDate(iso, eventId) {
    state.selectedDateIso = iso;
    state.highlightEventId = eventId || null;
    state.focusedIso = iso;

    const d = parseISO(iso);
    const needsMonthNav = d.getFullYear() !== state.monthCursor.getFullYear() || d.getMonth() !== state.monthCursor.getMonth();
    if (needsMonthNav) {
      state.monthCursor = new Date(d.getFullYear(), d.getMonth(), 1);
      renderMonth(); // full rebuild; its trailing logic re-anchors the popover
      return;
    }

    updateSelectedCellClasses();
    const cell = els.monthGridBody.querySelector(`[data-iso="${iso}"]`);
    if (cell) showPopover(cell);
  }

  function updateSelectedCellClasses() {
    els.monthGridBody.querySelectorAll('.dayCell').forEach((c) => {
      const sel = c.dataset.iso === state.selectedDateIso;
      c.classList.toggle('isSelected', sel);
      c.setAttribute('aria-selected', String(sel));
    });
  }

  /** Hard close: clears the selection entirely (used by Prev/Next, the close button, Escape, and click-outside). */
  function deselectDay() {
    state.selectedDateIso = null;
    state.highlightEventId = null;
    updateSelectedCellClasses();
    hidePopover();
  }

  /* ── Roving tabindex (WAI-ARIA APG grid pattern, simplified) ────────── */
  function syncRovingTabindex() {
    const cells = els.monthGridBody.querySelectorAll('.dayCell');
    cells.forEach((c) => { c.tabIndex = c.dataset.iso === state.focusedIso ? 0 : -1; });
  }

  function handleCellKeydown(e, day) {
    const cells = Array.from(els.monthGridBody.querySelectorAll('.dayCell'));
    const idx = cells.findIndex((c) => c.dataset.iso === day.iso);
    let nextIdx = null;
    switch (e.key) {
      case 'ArrowRight': nextIdx = idx + 1; break;
      case 'ArrowLeft': nextIdx = idx - 1; break;
      case 'ArrowDown': nextIdx = idx + 7; break;
      case 'ArrowUp': nextIdx = idx - 7; break;
      case 'Home': nextIdx = idx - (idx % 7); break;
      case 'End': nextIdx = idx - (idx % 7) + 6; break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectDate(day.iso);
        return;
      default: return;
    }
    if (nextIdx !== null && nextIdx >= 0 && nextIdx < cells.length) {
      e.preventDefault();
      const target = cells[nextIdx];
      state.focusedIso = target.dataset.iso;
      cells.forEach((c) => { c.tabIndex = -1; });
      target.tabIndex = 0;
      target.focus();
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DAY POPOVER — anchored to the clicked/selected day cell, with
     edge-aware clamping so it never renders off-screen (see the
     positionPopoverAt() flip/clamp math and the judgment-call notes).
     ══════════════════════════════════════════════════════════════════ */
  function showPopover(cell) {
    // Guarantee the anchor cell is actually on-screen before measuring its
    // rect. Without this, an auto-selected or programmatically-selected day
    // (auto-select-today, the Today button, adjacent-month navigation) that
    // happens to land in a grid row below the current scroll position would
    // get positioned/clamped against an off-screen cell rect — producing a
    // popover that floats disconnected from (and doesn't fully clamp
    // against) anything actually visible. `behavior: 'auto'` (not
    // 'smooth') so the scroll completes synchronously and the rect read
    // immediately after reflects the final, on-screen position. Caught
    // during browser verification with a short/cramped viewport.
    cell.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });

    const iso = cell.dataset.iso;
    els.dayPopoverDate.textContent = formatFullDate(iso);
    const dayEvents = visibleEventsOnDate(iso);
    if (!dayEvents.length) {
      // Distinguish "genuinely nothing scheduled" from "something's
      // scheduled but the active filter is hiding it" rather than always
      // blaming the filter.
      const hiddenByFilter = state.activeCategories.size > 0 && eventsOnDate(iso).length > 0;
      els.dayPopoverBody.innerHTML = hiddenByFilter
        ? '<p class="dayPopoverEmpty">No events match the current filter this day.</p>'
        : '<p class="dayPopoverEmpty">Nothing scheduled this day.</p>';
    } else {
      els.dayPopoverBody.innerHTML = `<div class="dayEventList">${dayEvents.map((e) => dayEventCard(e)).join('')}</div>`;
      if (state.highlightEventId) {
        const el = els.dayPopoverBody.querySelector(`[data-card-id="${state.highlightEventId}"]`);
        if (el) el.classList.add('isHighlighted');
      }
    }
    els.dayPopover.hidden = false;
    positionPopoverAt(cell);
    els.dayPopoverClose.focus();
  }

  function hidePopover() {
    els.dayPopover.hidden = true;
  }

  /** Edge-aware anchor: prefers directly below the cell's left edge; clamps
   *  horizontally to stay on-screen; flips above the cell if there isn't
   *  room below (and clamps again if there isn't room above either, relying
   *  on the popover's own max-height + internal scroll as a last resort). */
  function positionPopoverAt(cell) {
    const pop = els.dayPopover;
    const margin = 12, gap = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Measure with visibility:hidden (not display:none) so it still has
    // real layout dimensions to measure against.
    pop.style.visibility = 'hidden';
    pop.style.left = '0px';
    pop.style.top = '0px';
    const popRect = pop.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    let left = cellRect.left;
    if (left + popRect.width > vw - margin) left = vw - margin - popRect.width;
    if (left < margin) left = margin;

    let top = cellRect.bottom + gap;
    let flipped = false;
    if (top + popRect.height > vh - margin) {
      const aboveTop = cellRect.top - gap - popRect.height;
      if (aboveTop >= margin) { top = aboveTop; flipped = true; }
      else { top = margin; } // pinned to the top; internal scroll (max-height + overflow-y) covers the rest
    }

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.visibility = 'visible';
    pop.classList.toggle('isFlipped', flipped);

    // Caret points at the cell's horizontal center, clamped so it never
    // renders outside the popover's own (possibly-shifted) bounds.
    const cellCenter = cellRect.left + cellRect.width / 2;
    const caretX = Math.min(Math.max(cellCenter - left, 16), Math.max(popRect.width - 16, 16));
    els.dayPopoverCaret.style.left = `${Math.round(caretX)}px`;
  }

  function dayEventCard(e) {
    const color = CATEGORY_COLORS[e.category];
    return `
      <div class="dayEventCard" data-card-id="${e.id}" style="border-left-color:${color}">
        <p class="dayEventCardTitle">${escapeHtml(e.title)}${e.day_note ? `<span class="dayNote">${escapeHtml(e.day_note)}</span>` : ''}</p>
        <p class="dayEventCardCat" style="color:${color}">${e.category}${isMultiDay(e) ? ` &middot; ${formatDateRange(e)}` : ''}</p>
        <div class="dayEventCardMeta">
          ${e.start_time ? `<span>${formatTime12(e.start_time)}${e.end_time ? ` – ${formatTime12(e.end_time)}` : ''}</span>` : '<span>All day</span>'}
          ${e.location ? `<span>${escapeHtml(e.location)}</span>` : ''}
        </div>
        ${e.description ? `<p class="dayEventCardDesc">${escapeHtml(e.description)}</p>` : ''}
      </div>`;
  }
})();
