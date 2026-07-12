/* ════════════════════════════════════════════════════════════════════
   CALENDAR MONTH-VIEW PROTOTYPE — app logic (vanilla JS, no build step)

   This is a design-exploration prototype, not production code. It stands
   up its OWN List view (ported from events.module.css) purely so the
   List⇄Month segmented toggle has something real to switch between —
   the production List view already exists at
   next-app/src/app/(public)/events/page.tsx and is not being changed here.
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

  // Fixed reference date so the demo (Upcoming/Past split, "Today" marker)
  // reads sensibly no matter when a stakeholder actually opens this file —
  // deliberately NOT `new Date()`. See the judgment-call notes near </body>.
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

  /** All events touching a given day, all-day/undated-time entries first, then by start_time. */
  function eventsOnDate(iso) {
    return EVENTS.filter((e) => e.entry_date <= iso && (e.end_date || e.entry_date) >= iso).sort((a, b) => {
      if (!a.start_time && !b.start_time) return 0;
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });
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

  /** Lane assignment for multi-day bars touching this week (greedy interval scheduling, recomputed per week — see judgment-call notes for the one known edge case this simplifies away). */
  function computeWeekSpans(week) {
    const weekStartIso = week[0].iso, weekEndIso = week[6].iso;
    const spanning = EVENTS.filter(isMultiDay).filter((e) => e.end_date >= weekStartIso && e.entry_date <= weekEndIso);
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
    focusedIso: DEMO_TODAY_ISO
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
    els.dayPanel = document.getElementById('dayPanel');
    els.dayPanelDate = document.getElementById('dayPanelDate');
    els.dayPanelBody = document.getElementById('dayPanelBody');
    els.dayPanelClose = document.getElementById('dayPanelClose');
    els.legend = document.getElementById('legend');
    els.listUpcoming = document.getElementById('listUpcoming');
    els.listPast = document.getElementById('listPast');
    els.listPastSection = document.getElementById('listPastSection');

    renderLegend();
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

    els.prevBtn.addEventListener('click', () => { state.monthCursor = addMonths(state.monthCursor, -1); renderMonth(); });
    els.nextBtn.addEventListener('click', () => { state.monthCursor = addMonths(state.monthCursor, 1); renderMonth(); });
    els.todayBtn.addEventListener('click', () => {
      state.monthCursor = new Date(parseISO(DEMO_TODAY_ISO).getFullYear(), parseISO(DEMO_TODAY_ISO).getMonth(), 1);
      selectDate(DEMO_TODAY_ISO);
      renderMonth();
    });
    els.dayPanelClose.addEventListener('click', () => { state.selectedDateIso = null; state.highlightEventId = null; renderDayPanel(); });
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
  }

  /* ══════════════════════════════════════════════════════════════════
     LEGEND (existing production element — static, unchanged behavior)
     ══════════════════════════════════════════════════════════════════ */
  function renderLegend() {
    els.legend.innerHTML = CATEGORIES.map((c) => `
      <span class="legendItem"><span class="legendPip" style="background:${CATEGORY_COLORS[c]}"></span>${c}</span>
    `).join('');
  }

  /* ══════════════════════════════════════════════════════════════════
     LIST VIEW (ported layout, for toggle parity — see file header note)
     ══════════════════════════════════════════════════════════════════ */
  function renderList() {
    const all = [...EVENTS].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const upcoming = all.filter((e) => (e.end_date || e.entry_date) >= DEMO_TODAY_ISO);
    const past = all.filter((e) => (e.end_date || e.entry_date) < DEMO_TODAY_ISO).reverse();

    els.listUpcoming.innerHTML = upcoming.length
      ? upcoming.map((e) => listRow(e, false)).join('')
      : '<p class="empty">Nothing on the calendar yet.</p>';

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
    renderDayPanel();
  }

  function buildDayCell(day) {
    // A gridcell needs to be a plain, focusable <div> rather than a <button>:
    // it contains its OWN nested interactive chips/span-bar <button>s, and
    // HTML forbids interactive content inside a <button> (browsers will
    // silently mis-parse a button-in-a-button, breaking both). The div gets
    // the same click/keydown wiring a button would via role="gridcell" +
    // tabindex + explicit Enter/Space handling.
    const dayEvents = eventsOnDate(day.iso);
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

    cell.addEventListener('click', () => selectDate(day.iso, null, !day.inMonth));
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
      // preferring the true start date so the panel opens on the day the
      // event actually begins.
      selectDate(p.event.entry_date, p.event.id);
    });
    return bar;
  }

  function selectDate(iso, eventId, isAdjacentMonth) {
    if (isAdjacentMonth) {
      const d = parseISO(iso);
      state.monthCursor = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    state.selectedDateIso = iso;
    state.highlightEventId = eventId || null;
    state.focusedIso = iso;
    renderMonth();
    els.dayPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        selectDate(day.iso, null, !day.inMonth);
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
     SELECTED DAY PANEL
     ══════════════════════════════════════════════════════════════════ */
  function renderDayPanel() {
    if (!state.selectedDateIso) {
      els.dayPanelDate.textContent = 'No day selected';
      els.dayPanelBody.innerHTML = '<p class="dayPanelIdle">Select a day on the calendar to see what’s happening.</p>';
      els.dayPanelClose.hidden = true;
      return;
    }
    els.dayPanelClose.hidden = false;
    els.dayPanelDate.textContent = formatFullDate(state.selectedDateIso);
    const dayEvents = eventsOnDate(state.selectedDateIso);
    if (!dayEvents.length) {
      els.dayPanelBody.innerHTML = '<p class="dayPanelEmpty">Nothing scheduled this day.</p>';
      return;
    }
    els.dayPanelBody.innerHTML = `<div class="dayEventList">${dayEvents.map((e) => dayEventCard(e)).join('')}</div>`;
    if (state.highlightEventId) {
      const el = els.dayPanelBody.querySelector(`[data-card-id="${state.highlightEventId}"]`);
      if (el) el.classList.add('isHighlighted');
    }
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
