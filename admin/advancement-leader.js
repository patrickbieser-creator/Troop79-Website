/* ─── ADVANCEMENT LEADER WORKSPACE ─────────────────────────
   Single-page leader workspace with sub-screens:
   Dashboard · Fast Entry · Event Roster · Ledger · COH · Export · Admin
   Reads from ../data/advancement.json.
   Mutations (new entries, deletions, COH inclusions) are local-only —
   they live in memory and are surfaced via a toast.
   ──────────────────────────────────────────────────────────── */

(function() {
  'use strict';

  // ── State ────────────────────────────────────────────────
  const RANK_LABELS = {
    'scout':'Scout','tenderfoot':'Tenderfoot','second-class':'Second Class',
    'first-class':'First Class','star':'Star','life':'Life','eagle':'Eagle'
  };
  const RANK_ORDER = ['scout','tenderfoot','second-class','first-class','star','life','eagle'];

  let DATA = null;
  let ledger = [];          // working copy of data.ledgerRecent
  let cohSelections = {};   // map of (scoutId+award+date) → boolean override

  // Ledger view state (sort, page, archive toggle)
  const ledgerView = {
    sortKey: 'date',
    sortDir: 'desc',          // 'asc' | 'desc' | null
    page: 1,
    perPage: 100,
    showArchived: false
  };

  // Cached derived rows for the current view — recomputed when filter/sort change.
  let ledgerFiltered = [];

  // Monotonic ID for new ledger entries (synthesized seed data uses 100000+ range)
  let _ledgerId = 9000;

  // ── Boot ─────────────────────────────────────────────────
  if (typeof initLoginGate === 'function') {
    initLoginGate(onAuthenticated);
  } else {
    onAuthenticated();
  }

  const signOutBtn = document.getElementById('btnSignOut');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      if (typeof signOut === 'function') signOut();
    });
  }

  function onAuthenticated() {
    document.getElementById('workspace').style.display = 'grid';
    loadData();
    setupNav();
  }

  function setupNav() {
    const buttons = document.querySelectorAll('.ws-nav-btn');
    const screens = document.querySelectorAll('.screen');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.screen;
        buttons.forEach(b => b.classList.remove('active'));
        screens.forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        const screen = document.getElementById(target);
        if (screen) screen.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // jump buttons inside dashboard/etc
    document.querySelectorAll('[data-jump]').forEach(b => {
      b.addEventListener('click', () => {
        const target = b.dataset.jump;
        const navBtn = document.querySelector(`.ws-nav-btn[data-screen="${target}"]`);
        if (navBtn) navBtn.click();
      });
    });
  }

  function loadData() {
    fetch('../data/advancement.json')
      .then(r => r.json())
      .then(data => {
        DATA = data;
        ledger = data.ledgerRecent.slice();
        // PROTOTYPE SEED — synthesize entries so the table demonstrates
        // pagination/sort/archive at realistic scale. Remove this line
        // (and generateSeedLedger below) when wiring real data.
        ledger = ledger.concat(generateSeedLedger(5000));
        renderAll();
      })
      .catch(err => {
        console.error('Failed to load advancement.json', err);
        toast('Could not load advancement data', 'danger');
      });
  }

  // ── PROTOTYPE SEED DATA ──────────────────────────────────
  // Deterministic synthesized ledger for prototype scale testing.
  // Seeded LCG so reloads produce the same data.
  function generateSeedLedger(count) {
    if (!DATA) return [];
    let seed = 79;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const rint = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

    const activeScouts = DATA.scouts.filter(s => s.active).map(s => s.id);
    if (!activeScouts.length) return [];

    const leaderCodes = DATA.leaders
      .filter(l => l.code.length <= 4 && !['Lead','Project','Event','Outing','Camp','Clinic','Prior','Turner','T61','T118'].includes(l.code))
      .map(l => l.code);
    const reqCodes = (DATA.lookups.internalRequirementCodes || []).map(c => c.code).filter(Boolean);
    const reqLabels = Object.fromEntries((DATA.lookups.internalRequirementCodes || []).map(c => [c.code, c.label]));
    const mbNames = (DATA.meritBadgeCatalog || []).map(b => b.name);

    const typeBuckets = [
      { weight: 45, build: () => {
          const code = pick(reqCodes) || '1a';
          return { type: 'rank_requirement', code, label: reqLabels[code] || code, unit: 'complete', qty: 1 };
      }},
      { weight: 15, build: () => {
          const mb = pick(mbNames) || 'Camping';
          return { type: 'merit_badge_requirement', code: `MB-${mb}/${rint(1,9)}${pick(['a','b','c',''])}`, label: `${mb} requirement`, unit: 'complete', qty: 1 };
      }},
      { weight: 12, build: () => ({ type: 'attendance', code: 'Meeting', label: 'Troop meeting', unit: 'event', qty: 1 }) },
      { weight: 8,  build: () => ({ type: 'service_hours', code: 'Service', label: pick(['Park cleanup','Food drive','Pinewood derby setup','Eagle project assist']), unit: 'hours', qty: rint(1,6) }) },
      { weight: 8,  build: () => ({ type: 'camping_nights', code: 'Nights', label: pick(['Summer camp','Winter campout','Backpacking trip','Klondike']), unit: 'nights', qty: rint(1,3) }) },
      { weight: 6,  build: () => ({ type: 'hiking_miles', code: 'Miles', label: pick(['Ice Age Trail','Lapham Peak','Kettle Moraine','State park hike']), unit: 'miles', qty: rint(2,12) }) },
      { weight: 4,  build: () => {
          const mb = pick(mbNames) || 'Camping';
          return { type: 'merit_badge_award', code: `MB-${mb}`, label: `${mb} merit badge`, unit: 'badge', qty: 1 };
      }},
      { weight: 2,  build: () => ({ type: 'leadership', code: 'Lead', label: pick(['Patrol Leader','Senior Patrol Leader','Scribe','Quartermaster','Den Chief']), unit: 'months', qty: 6 }) }
    ];
    const totalWeight = typeBuckets.reduce((s, b) => s + b.weight, 0);
    const pickType = () => {
      let r = rand() * totalWeight;
      for (const b of typeBuckets) { if ((r -= b.weight) <= 0) return b.build(); }
      return typeBuckets[0].build();
    };

    // Date window: ~5 years back to today
    const now = Date.now();
    const fiveYearsMs = 5 * 365 * 24 * 3600 * 1000;
    const isoDate = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    };

    let nextId = 100000;
    const out = [];
    for (let i = 0; i < count; i++) {
      const ts = now - rand() * fiveYearsMs;
      const date = isoDate(ts);
      const enteredAt = isoDate(ts + rint(0, 14) * 24 * 3600 * 1000);
      const by = pick(leaderCodes) || 'PB';
      const t = pickType();
      out.push({
        id: ++nextId,
        date,
        scoutId: pick(activeScouts),
        type: t.type,
        code: t.code,
        label: t.label,
        by,
        qty: t.qty,
        unit: t.unit,
        enteredBy: by,
        enteredAt,
        seed: true
      });
    }
    // Keep _ledgerId above the synthesized range so new entries don't collide
    _ledgerId = Math.max(_ledgerId, nextId);
    return out;
  }

  function renderAll() {
    renderDashboard();
    renderFastEntry();
    renderEventRoster();
    renderLedger();
    renderCoh();
    renderExport();
    renderAdmin();
  }

  // ── Utility ──────────────────────────────────────────────
  function scoutById(id) { return DATA.scouts.find(s => s.id === id); }
  function scoutName(id) { const s = scoutById(id); return s ? s.displayName : id; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }
  function fmtDate(s) {
    if (!s) return '';
    const [y,m,d] = s.split('-').map(Number);
    const dt = new Date(y, m-1, d);
    return (dt.getMonth()+1) + '/' + dt.getDate() + '/' + String(dt.getFullYear()).slice(2);
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function toast(msg, kind) {
    const el = document.getElementById('wsToast');
    el.textContent = msg;
    el.className = 'ws-toast show' + (kind === 'success' ? ' success' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.classList.remove('show'); }, 2400);
  }

  function leaderOptions(selected) {
    return DATA.leaders
      .filter(l => l.code.length <= 4 && !['Lead','Project','Event','Outing','Camp','Clinic','Prior','Turner','T61','T118'].includes(l.code))
      .map(l => `<option value="${esc(l.code)}"${l.code === selected ? ' selected' : ''}>${esc(l.code)} · ${esc(l.name)}</option>`)
      .join('');
  }

  // ── DASHBOARD ────────────────────────────────────────────
  function renderDashboard() {
    const scoutCount = DATA.scouts.filter(s => s.active).length;
    const activeLedger = ledger.filter(l => !l.archivedAt && !l.deletedAt);
    document.getElementById('dashScouts').textContent  = scoutCount;
    document.getElementById('dashLedger').textContent  = activeLedger.length.toLocaleString();
    document.getElementById('dashCoh').textContent     =
      DATA.cohCandidates.items.filter(c => c.include !== false).length;
    document.getElementById('dashMissing').textContent =
      DATA.scouts.filter(s => s.active && !s.bsaMemberId).length;

    // Recent activity table (top 5, excluding archived)
    const recent = activeLedger.slice().sort((a,b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);
    document.getElementById('dashLedgerBody').innerHTML = recent.map(l => `
      <tr>
        <td>${fmtDate(l.date)}</td>
        <td>${esc(scoutName(l.scoutId))}</td>
        <td>${esc(l.label)} <span style="color:var(--admin-gray-500);font-size:11px;">${esc(l.code)}</span></td>
        <td>${esc(l.by)}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" style="color:var(--admin-gray-500);text-align:center;padding:20px;">No recent activity</td></tr>';

    // Likely ready (heuristic: scouts not at top rank get a suggestion)
    const likely = DATA.scouts.filter(s => s.active && s.currentRank !== 'eagle')
      .slice(0, 5)
      .map(s => {
        const idx = RANK_ORDER.indexOf(s.currentRank);
        const next = RANK_ORDER[idx + 1];
        const adv = DATA.advancement[s.id];
        const recent = adv && adv.ranks && adv.ranks[next] && adv.ranks[next].length;
        return {
          scout: s,
          likely: next,
          suggestion: recent ? 'Schedule SM Conference + BoR' : 'Likely needs more time at rank'
        };
      });
    document.getElementById('dashLikelyBody').innerHTML = likely.map(l => `
      <tr>
        <td>${esc(l.scout.displayName)}</td>
        <td><span class="tag blue">${RANK_LABELS[l.likely]}</span></td>
        <td>${esc(l.suggestion)}</td>
      </tr>
    `).join('');

    // Sidebar badge — active (non-archived) entries
    document.getElementById('ledgerCount').textContent = activeLedger.length.toLocaleString();
  }

  // ── FAST ENTRY ───────────────────────────────────────────
  let reqFirstSelected = new Set(['maya','alex','sam']);

  function renderFastEntry() {
    // Scout-first scout dropdown
    const scoutSel = document.getElementById('scoutFirstSel');
    scoutSel.innerHTML = DATA.scouts.filter(s => s.active)
      .map(s => `<option value="${s.id}">${esc(s.displayName)} · ${RANK_LABELS[s.currentRank]}</option>`)
      .join('');

    // Leader signoff selects
    const leaderOpts = leaderOptions('PB');
    document.getElementById('scoutFirstBy').innerHTML = leaderOpts;
    document.getElementById('reqFirstBy').innerHTML = leaderOpts;

    // Default dates
    document.getElementById('scoutFirstDate').value = todayISO();
    document.getElementById('reqFirstDate').value = todayISO();

    // Scout checkbox grid
    const grid = document.getElementById('reqFirstScoutGrid');
    grid.innerHTML = DATA.scouts.filter(s => s.active).map(s => `
      <label class="scout-check">
        <input type="checkbox" value="${s.id}" ${reqFirstSelected.has(s.id) ? 'checked' : ''} />
        <span class="name">${esc(s.displayName)}</span>
        <span class="rk">${RANK_LABELS[s.currentRank].split(' ').map(w => w[0]).join('')}</span>
      </label>
    `).join('');
    grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) reqFirstSelected.add(cb.value); else reqFirstSelected.delete(cb.value);
        updateReqFirstCount();
      });
    });
    updateReqFirstCount();

    // Buttons
    document.getElementById('reqFirstSelectAll').onclick = () => {
      const allSelected = reqFirstSelected.size >= DATA.scouts.filter(s => s.active).length;
      DATA.scouts.filter(s => s.active).forEach(s => {
        if (allSelected) reqFirstSelected.delete(s.id); else reqFirstSelected.add(s.id);
      });
      renderFastEntry();
    };
    document.getElementById('reqFirstClear').onclick = () => {
      document.getElementById('reqFirstCode').value = '';
      document.getElementById('reqFirstNotes').value = '';
      reqFirstSelected.clear();
      renderFastEntry();
    };
    document.getElementById('reqFirstSave').onclick = saveRequirementFirst;
    document.getElementById('scoutFirstClear').onclick = () => {
      document.getElementById('scoutFirstReqs').value = '';
      document.getElementById('scoutFirstNotes').value = '';
    };
    document.getElementById('scoutFirstSave').onclick = saveScoutFirst;
  }

  function updateReqFirstCount() {
    document.getElementById('reqFirstSelCount').textContent = `(${reqFirstSelected.size} selected)`;
    document.getElementById('reqFirstBtnCount').textContent = reqFirstSelected.size;
  }

  function saveScoutFirst() {
    const scoutId = document.getElementById('scoutFirstSel').value;
    const date    = document.getElementById('scoutFirstDate').value;
    const by      = document.getElementById('scoutFirstBy').value;
    const codes   = document.getElementById('scoutFirstReqs').value.split(',').map(s => s.trim()).filter(Boolean);
    const notes   = document.getElementById('scoutFirstNotes').value.trim();

    if (!codes.length) { toast('Add at least one requirement code', 'danger'); return; }

    codes.forEach(code => {
      ledger.unshift(makeLedgerEntry({ scoutId, date, by, code, label: code, notes }));
    });
    document.getElementById('scoutFirstReqs').value = '';
    document.getElementById('scoutFirstNotes').value = '';
    renderDashboard();
    renderLedger();
    toast(`Saved ${codes.length} entr${codes.length === 1 ? 'y' : 'ies'} for ${scoutName(scoutId)}`, 'success');
  }

  function saveRequirementFirst() {
    const code  = document.getElementById('reqFirstCode').value.trim();
    const date  = document.getElementById('reqFirstDate').value;
    const by    = document.getElementById('reqFirstBy').value;
    const notes = document.getElementById('reqFirstNotes').value.trim();

    if (!code) { toast('Enter a requirement code', 'danger'); return; }
    if (reqFirstSelected.size === 0) { toast('Select at least one scout', 'danger'); return; }

    reqFirstSelected.forEach(scoutId => {
      ledger.unshift(makeLedgerEntry({ scoutId, date, by, code, label: lookupLabel(code) || code, notes }));
    });
    const n = reqFirstSelected.size;
    reqFirstSelected = new Set();
    renderFastEntry();
    renderDashboard();
    renderLedger();
    toast(`Created ${n} ledger entr${n === 1 ? 'y' : 'ies'} for ${code}`, 'success');
  }

  function lookupLabel(code) {
    const lk = (DATA.lookups.internalRequirementCodes || []).find(c => c.code === code);
    return lk ? lk.label : null;
  }

  function makeLedgerEntry({ scoutId, date, by, code, label, notes }) {
    return {
      id: ++_ledgerId,
      date,
      scoutId,
      type: code.startsWith('MB-') ? 'merit_badge_award'
            : /^(Camp|Event|Meeting|Service)/i.test(code) ? 'attendance'
            : 'rank_requirement',
      code,
      label,
      by,
      qty: 1,
      unit: 'complete',
      enteredBy: by,
      enteredAt: todayISO(),
      notes
    };
  }

  // ── EVENT ROSTER ─────────────────────────────────────────
  function renderEventRoster() {
    const tbody = document.getElementById('rosterBody');
    const filterInput = document.getElementById('rosterFilter');
    const draw = () => {
      const filter = filterInput.value.trim().toLowerCase();
      const rows = DATA.scouts.filter(s => s.active && (!filter ||
        (s.displayName + ' ' + s.patrol).toLowerCase().includes(filter)));
      tbody.innerHTML = rows.map((s, i) => `
        <tr data-id="${s.id}">
          <td style="text-align:center;"><input type="checkbox" class="roster-attend" ${i < 3 ? 'checked' : ''} /></td>
          <td>${esc(s.displayName)}</td>
          <td>${esc(s.patrol || '')}</td>
          <td><span class="tag gray">${RANK_LABELS[s.currentRank]}</span></td>
          <td class="num"><input type="number" class="narrow-num roster-nights" value="${i < 3 ? '2' : '0'}" min="0" /></td>
          <td class="num"><input type="number" class="narrow-num roster-miles"  value="0" min="0" /></td>
          <td class="num"><input type="number" class="narrow-num roster-hours"  value="0" min="0" /></td>
          <td><input type="text" class="roster-reqs" placeholder="Codes separated by commas" /></td>
        </tr>
      `).join('');
      updateRosterCount();
      tbody.querySelectorAll('.roster-attend').forEach(cb =>
        cb.addEventListener('change', updateRosterCount));
    };
    draw();
    filterInput.oninput = draw;

    document.getElementById('rosterCheckAll').onclick =
      () => tbody.querySelectorAll('.roster-attend').forEach(cb => { cb.checked = true; updateRosterCount(); });
    document.getElementById('rosterUncheckAll').onclick =
      () => tbody.querySelectorAll('.roster-attend').forEach(cb => { cb.checked = false; updateRosterCount(); });
    document.getElementById('rosterApplyDefaults').onclick = () => {
      const n = +document.getElementById('rosterNights').value || 0;
      const m = +document.getElementById('rosterMiles').value || 0;
      const h = +document.getElementById('rosterHours').value || 0;
      tbody.querySelectorAll('tr').forEach(tr => {
        if (!tr.querySelector('.roster-attend').checked) return;
        tr.querySelector('.roster-nights').value = n;
        tr.querySelector('.roster-miles').value  = m;
        tr.querySelector('.roster-hours').value  = h;
      });
      toast('Applied defaults to attending scouts');
    };
    document.getElementById('rosterSave').onclick = () => {
      const activity = document.getElementById('rosterActivity').selectedOptions[0].text;
      const date = todayISO();
      let count = 0;
      tbody.querySelectorAll('tr').forEach(tr => {
        if (!tr.querySelector('.roster-attend').checked) return;
        const id = tr.dataset.id;
        const nights = +tr.querySelector('.roster-nights').value || 0;
        const miles  = +tr.querySelector('.roster-miles').value  || 0;
        const hours  = +tr.querySelector('.roster-hours').value  || 0;
        const reqs   = tr.querySelector('.roster-reqs').value.split(',').map(s => s.trim()).filter(Boolean);
        ledger.unshift({
          id: ++_ledgerId, date, scoutId: id, type: 'attendance',
          code: 'Activity', label: activity, by: 'PB',
          qty: 1, unit: 'event', enteredBy: 'PB', enteredAt: date
        });
        count++;
        if (nights > 0) {
          ledger.unshift({ id: ++_ledgerId, date, scoutId: id, type: 'camping_nights',
            code: 'Nights', label: activity + ' — camping', by: 'PB',
            qty: nights, unit: 'nights', enteredBy: 'PB', enteredAt: date });
          count++;
        }
        if (miles > 0) {
          ledger.unshift({ id: ++_ledgerId, date, scoutId: id, type: 'hiking_miles',
            code: 'Miles', label: activity + ' — hiking', by: 'PB',
            qty: miles, unit: 'miles', enteredBy: 'PB', enteredAt: date });
          count++;
        }
        if (hours > 0) {
          ledger.unshift({ id: ++_ledgerId, date, scoutId: id, type: 'service_hours',
            code: 'Service', label: activity + ' — service', by: 'PB',
            qty: hours, unit: 'hours', enteredBy: 'PB', enteredAt: date });
          count++;
        }
        reqs.forEach(code => {
          ledger.unshift(makeLedgerEntry({ scoutId: id, date, by: 'PB', code, label: lookupLabel(code) || code }));
          count++;
        });
      });
      renderDashboard();
      renderLedger();
      toast(`Created ${count} ledger entries from "${activity}"`, 'success');
    };
  }

  function updateRosterCount() {
    const n = document.querySelectorAll('#rosterBody .roster-attend:checked').length;
    document.getElementById('rosterAttCount').textContent =
      `${n} attending`;
  }

  // ── LEDGER ───────────────────────────────────────────────
  // Render pipeline: filter → sort → slice(page) → DOM.
  // Only the visible page (default 100 rows) is rendered, so the
  // table stays snappy with tens of thousands of entries.
  function renderLedger() {
    rebuildLedgerView();      // refresh ledgerFiltered (filter + sort)
    renderLedgerPage();       // render current page of rows
    renderLedgerPager();      // pager bar
    updateLedgerHeaderArrows();
  }

  function rebuildLedgerView() {
    const filter = (document.getElementById('ledgerFilter').value || '').trim().toLowerCase();
    const typeFilter = document.getElementById('ledgerTypeFilter').value;
    const showArchived = ledgerView.showArchived;

    // Filter — hidden rows (archived OR deleted) excluded unless toggle is on
    const rows = ledger.filter(l => {
      if (!showArchived && (l.archivedAt || l.deletedAt)) return false;
      if (typeFilter && l.type !== typeFilter) return false;
      if (filter) {
        const hay = [l.code, l.label, scoutName(l.scoutId), l.by, l.deletedReason || ''].join(' ').toLowerCase();
        if (!hay.includes(filter)) return false;
      }
      return true;
    });

    // Sort
    const { sortKey, sortDir } = ledgerView;
    if (sortKey && sortDir) {
      const dir = sortDir === 'asc' ? 1 : -1;
      const cmp = ledgerComparator(sortKey);
      rows.sort((a, b) => dir * cmp(a, b));
    }

    ledgerFiltered = rows;

    // Clamp page if filter shrank the result set
    const maxPage = Math.max(1, Math.ceil(rows.length / ledgerView.perPage));
    if (ledgerView.page > maxPage) ledgerView.page = maxPage;
    if (ledgerView.page < 1) ledgerView.page = 1;
  }

  function ledgerComparator(key) {
    // Comparators that handle the field's natural type
    switch (key) {
      case 'date':
      case 'enteredAt':
        return (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
      case 'scout':
        return (a, b) => scoutName(a.scoutId).localeCompare(scoutName(b.scoutId));
      case 'qty':
        return (a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0);
      case 'type':
      case 'code':
      case 'label':
      case 'by':
      case 'unit':
        return (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
      default:
        return () => 0;
    }
  }

  function renderLedgerPage() {
    const tbody = document.getElementById('ledgerBody');
    const total = ledgerFiltered.length;
    const start = (ledgerView.page - 1) * ledgerView.perPage;
    const end = Math.min(start + ledgerView.perPage, total);
    const pageRows = ledgerFiltered.slice(start, end);

    tbody.innerHTML = total === 0
      ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--admin-gray-500);">No entries match the current filters.</td></tr>'
      : pageRows.map(l => {
          const archived = !!l.archivedAt;
          const deleted = !!l.deletedAt;
          const rowClass = deleted ? 'deleted' : (archived ? 'archived' : '');
          let scoutTag = '';
          if (deleted) {
            const reason = l.deletedReason ? ` — ${l.deletedReason}` : '';
            scoutTag = ` <span class="archive-tag delete-tag" title="Deleted ${esc(l.deletedAt)} by ${esc(l.deletedBy || '')}${esc(reason)}">Deleted</span>`;
          } else if (archived) {
            scoutTag = ` <span class="archive-tag" title="Archived ${esc(l.archivedAt)} by ${esc(l.archivedBy || '')}">Archived</span>`;
          }
          let actions;
          if (deleted) {
            actions = `<button class="ws-btn small" type="button" data-restore-delete="${l.id}">Restore</button>`;
          } else if (archived) {
            actions = `<button class="ws-btn small" type="button" data-restore="${l.id}">Restore</button>`;
          } else {
            actions = `<button class="ws-btn small" type="button" data-edit="${l.id}">Edit</button>
                       <button class="ws-btn small" type="button" data-archive="${l.id}">Archive</button>
                       <button class="ws-btn small danger" type="button" data-delete="${l.id}">Delete</button>`;
          }
          return `
          <tr data-id="${l.id}" class="${rowClass}">
            <td>${fmtDate(l.date)}</td>
            <td>${esc(scoutName(l.scoutId))}${scoutTag}</td>
            <td><span class="tag ${ledgerTypeClass(l.type)}">${l.type.replace(/_/g, ' ')}</span></td>
            <td class="mono">${esc(l.code)}</td>
            <td>${esc(l.label)}</td>
            <td>${esc(l.by)}</td>
            <td class="num">${l.qty}</td>
            <td>${esc(l.unit)}</td>
            <td style="color:var(--admin-gray-500);font-size:11px;">${esc(l.enteredBy)} · ${fmtDate(l.enteredAt)}</td>
            <td class="actions">${actions}</td>
          </tr>
        `;}).join('');

    // Meta: count + archived/deleted footnotes
    const archivedTotal = ledger.reduce((n, l) => n + (l.archivedAt ? 1 : 0), 0);
    const deletedTotal  = ledger.reduce((n, l) => n + (l.deletedAt ? 1 : 0), 0);
    const totalCount = ledger.length;
    const meta = total === totalCount
      ? `${totalCount.toLocaleString()} entries`
      : `${total.toLocaleString()} of ${totalCount.toLocaleString()} entries`;
    const notes = [];
    if (archivedTotal > 0) notes.push(`${archivedTotal.toLocaleString()} archived`);
    if (deletedTotal  > 0) notes.push(`${deletedTotal.toLocaleString()} deleted`);
    const hiddenNote = notes.length
      ? ` · ${notes.join(', ')} ${ledgerView.showArchived ? '(shown)' : '(hidden)'}`
      : '';
    document.getElementById('ledgerMeta').textContent = meta + hiddenNote;

    // Wire row actions
    tbody.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => toast('Edit form is a prototype-only — wiring deferred to the leader-edit pass');
    });
    tbody.querySelectorAll('[data-archive]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.archive;
        const entry = ledger.find(l => l.id === id);
        if (!entry) return;
        if (!confirm(`Archive ledger entry "${entry.label}" for ${scoutName(entry.scoutId)}?\n\nIt will be hidden from the default view but restorable from the Archive toggle.`)) return;
        entry.archivedAt = todayISO();
        entry.archivedBy = 'PB';
        renderDashboard();
        renderLedger();
        toast('Entry archived (toggle "Show archived" to view)', 'success');
      };
    });
    tbody.querySelectorAll('[data-restore]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.restore;
        const entry = ledger.find(l => l.id === id);
        if (!entry) return;
        delete entry.archivedAt;
        delete entry.archivedBy;
        delete entry.archivedReason;
        renderDashboard();
        renderLedger();
        toast('Entry restored', 'success');
      };
    });
    tbody.querySelectorAll('[data-delete]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.delete;
        const entry = ledger.find(l => l.id === id);
        if (!entry) return;
        const reason = prompt(`Delete ledger entry "${entry.label}" for ${scoutName(entry.scoutId)}?\n\nWhy is this entry being deleted? (e.g. duplicate, wrong scout, typo)\n\nThis entry will be hidden from the default view but recoverable via "Show hidden rows".`, '');
        if (reason === null) return;          // cancelled
        const r = reason.trim();
        if (!r) { toast('Delete cancelled — a reason is required', 'danger'); return; }
        entry.deletedAt = todayISO();
        entry.deletedBy = 'PB';
        entry.deletedReason = r;
        renderDashboard();
        renderLedger();
        toast('Entry deleted (recoverable from Show hidden rows)', 'success');
      };
    });
    tbody.querySelectorAll('[data-restore-delete]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.restoreDelete;
        const entry = ledger.find(l => l.id === id);
        if (!entry) return;
        delete entry.deletedAt;
        delete entry.deletedBy;
        delete entry.deletedReason;
        renderDashboard();
        renderLedger();
        toast('Entry restored', 'success');
      };
    });
  }

  function renderLedgerPager() {
    const total = ledgerFiltered.length;
    const perPage = ledgerView.perPage;
    const page = ledgerView.page;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = total === 0 ? 0 : (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, total);

    const pager = document.getElementById('ledgerPager');
    pager.innerHTML = `
      <button type="button" data-page="first" ${page <= 1 ? 'disabled' : ''} title="First page">«</button>
      <button type="button" data-page="prev"  ${page <= 1 ? 'disabled' : ''} title="Previous page">‹ Prev</button>
      <span class="pager-info">Page</span>
      <input type="number" class="pager-jump" min="1" max="${totalPages}" value="${page}" />
      <span class="pager-info">of ${totalPages.toLocaleString()}</span>
      <button type="button" data-page="next" ${page >= totalPages ? 'disabled' : ''} title="Next page">Next ›</button>
      <button type="button" data-page="last" ${page >= totalPages ? 'disabled' : ''} title="Last page">»</button>
      <div class="pager-spacer"></div>
      <span class="pager-info">Showing <strong>${start.toLocaleString()}–${end.toLocaleString()}</strong> of ${total.toLocaleString()}</span>
      <label class="pager-info">Per page
        <select id="ledgerPerPage">
          ${[50, 100, 250, 500, 1000].map(n =>
            `<option value="${n}" ${n === perPage ? 'selected' : ''}>${n}</option>`
          ).join('')}
        </select>
      </label>
    `;

    pager.querySelectorAll('button[data-page]').forEach(b => {
      b.onclick = () => {
        const dir = b.dataset.page;
        if (dir === 'first') ledgerView.page = 1;
        else if (dir === 'prev') ledgerView.page = Math.max(1, page - 1);
        else if (dir === 'next') ledgerView.page = Math.min(totalPages, page + 1);
        else if (dir === 'last') ledgerView.page = totalPages;
        renderLedgerPage();
        renderLedgerPager();
      };
    });

    const jump = pager.querySelector('.pager-jump');
    jump.addEventListener('change', () => {
      let p = parseInt(jump.value, 10);
      if (!Number.isFinite(p) || p < 1) p = 1;
      if (p > totalPages) p = totalPages;
      ledgerView.page = p;
      renderLedgerPage();
      renderLedgerPager();
    });

    pager.querySelector('#ledgerPerPage').addEventListener('change', e => {
      ledgerView.perPage = +e.target.value || 100;
      ledgerView.page = 1;
      renderLedgerPage();
      renderLedgerPager();
    });
  }

  function updateLedgerHeaderArrows() {
    document.querySelectorAll('#ledgerTable th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === ledgerView.sortKey && ledgerView.sortDir) {
        th.classList.add(ledgerView.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function ledgerTypeClass(t) {
    if (t === 'attendance' || t === 'camping_nights') return 'blue';
    if (t === 'service_hours' || t === 'hiking_miles') return 'warn';
    if (t === 'leadership' || t === 'merit_badge_award') return '';
    return '';
  }

  // Filter/sort/archive event wiring (delegated so it survives re-renders)
  document.addEventListener('input', e => {
    if (e.target.id === 'ledgerFilter') {
      ledgerView.page = 1;
      renderLedger();
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'ledgerTypeFilter') {
      ledgerView.page = 1;
      renderLedger();
    }
    if (e.target.id === 'ledgerShowArchived') {
      ledgerView.showArchived = e.target.checked;
      ledgerView.page = 1;
      renderLedger();
    }
  });
  document.addEventListener('click', e => {
    const th = e.target.closest('#ledgerTable th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (ledgerView.sortKey === key) {
      // Toggle direction on the active column
      ledgerView.sortDir = ledgerView.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      // New column: default desc for numeric/date columns, asc for text
      ledgerView.sortKey = key;
      ledgerView.sortDir = (key === 'date' || key === 'enteredAt' || key === 'qty') ? 'desc' : 'asc';
    }
    ledgerView.page = 1;
    renderLedger();
  });

  // ── COURT OF HONOR ───────────────────────────────────────
  function renderCoh() {
    document.getElementById('cohDate').value  = DATA.cohCandidates.cohDate;
    document.getElementById('cohSince').value = DATA.cohCandidates.sincePreviousCoh;

    // Summary chips
    const items = DATA.cohCandidates.items.filter(c => effectiveInclude(c));
    const ranks = items.filter(i => i.type === 'Rank').length;
    const mbs   = items.filter(i => i.type === 'Merit Badge').length;
    const led   = items.filter(i => i.type === 'Leadership').length;
    document.getElementById('cohSummary').innerHTML = `
      <span class="tag blue">${items.length} recognitions</span>
      <span class="tag">${ranks} rank award${ranks === 1 ? '' : 's'}</span>
      <span class="tag warn">${mbs} merit badge${mbs === 1 ? '' : 's'}</span>
      <span class="tag gray">${led} leadership term${led === 1 ? '' : 's'}</span>
    `;

    // Candidates table
    const cbody = document.getElementById('cohCandidatesBody');
    cbody.innerHTML = DATA.cohCandidates.items.map((c, i) => {
      const key = c.scoutId + '|' + c.award + '|' + c.date;
      const checked = effectiveInclude(c);
      return `
        <tr>
          <td style="text-align:center;"><input type="checkbox" data-coh-key="${esc(key)}" ${checked ? 'checked' : ''} /></td>
          <td>${esc(scoutName(c.scoutId))}</td>
          <td>${esc(c.award)}</td>
          <td>${fmtDate(c.date)}</td>
          <td><span class="tag ${c.type === 'Rank' ? '' : c.type === 'Merit Badge' ? 'warn' : 'blue'}">${esc(c.type)}</span></td>
          <td style="color:var(--admin-gray-500);font-style:italic;">${esc(c.note || '')}</td>
        </tr>
      `;
    }).join('');

    cbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        cohSelections[cb.dataset.cohKey] = cb.checked;
        renderCoh();
      });
    });

    // History
    document.getElementById('cohHistoryBody').innerHTML = DATA.cohHistory.map(c => `
      <tr>
        <td>${fmtDate(c.date)}</td>
        <td>${esc(c.title)}</td>
        <td class="num">${c.recognitions}</td>
      </tr>
    `).join('');

    document.getElementById('cohPrint').onclick = () => {
      window.print();
    };
    document.getElementById('cohCreate').onclick = () => {
      const title = document.getElementById('cohTitle').value || 'Court of Honor';
      const n = items.length;
      toast(`Created "${title}" with ${n} recognitions (prototype: not persisted)`, 'success');
    };
  }

  function effectiveInclude(c) {
    const key = c.scoutId + '|' + c.award + '|' + c.date;
    if (key in cohSelections) return cohSelections[key];
    return c.include !== false;
  }

  // ── BULK ARCHIVE / RESTORE BY SCOUT ──────────────────────
  // Used when a scout ages out or is reactivated. All of their
  // ledger entries are archived (or restored) in one pass, with
  // a shared timestamp so the cohort can be identified later.
  function archiveScout(scoutId) {
    const scout = scoutById(scoutId);
    if (!scout) return;
    const affected = ledger.filter(l => l.scoutId === scoutId && !l.archivedAt);
    if (!confirm(`Mark ${scout.displayName} as aged-out?\n\nThis will archive ${affected.length.toLocaleString()} ledger entr${affected.length === 1 ? 'y' : 'ies'}. Entries can be restored from the Ledger Archive view or by reactivating the scout here.`)) return;
    const stamp = todayISO();
    affected.forEach(l => {
      l.archivedAt = stamp;
      l.archivedBy = 'PB';
      l.archivedReason = 'scout_aged_out';
    });
    scout.active = false;
    renderDashboard();
    renderLedger();
    renderAdmin();
    renderFastEntry();   // fast-entry scout pickers exclude inactive scouts
    toast(`${scout.displayName} marked aged-out · ${affected.length.toLocaleString()} entries archived`, 'success');
  }

  function reactivateScout(scoutId) {
    const scout = scoutById(scoutId);
    if (!scout) return;
    const affected = ledger.filter(l => l.scoutId === scoutId && l.archivedReason === 'scout_aged_out');
    if (!confirm(`Reactivate ${scout.displayName}?\n\nThis will restore ${affected.length.toLocaleString()} aged-out ledger entr${affected.length === 1 ? 'y' : 'ies'}. Entries archived manually will stay archived.`)) return;
    affected.forEach(l => {
      delete l.archivedAt;
      delete l.archivedBy;
      delete l.archivedReason;
    });
    scout.active = true;
    renderDashboard();
    renderLedger();
    renderAdmin();
    renderFastEntry();
    toast(`${scout.displayName} reactivated · ${affected.length.toLocaleString()} entries restored`, 'success');
  }

  // ── EXPORT ───────────────────────────────────────────────
  function renderExport() {
    const tbody = document.getElementById('exportBody');
    tbody.innerHTML = DATA.scoutbookExportPreview.map(r => `
      <tr>
        <td><span class="tag ${r.status === 'Ready' ? '' : 'danger'}">${esc(r.status)}</span></td>
        <td class="mono">${esc(r.memberId)}</td>
        <td>${esc(r.firstName)}</td>
        <td>${esc(r.lastName)}</td>
        <td>${esc(r.advancementType)}</td>
        <td class="mono">${esc(r.advancementId)}</td>
        <td>${esc(r.dateCompleted)}</td>
      </tr>
    `).join('');

    // CSV preview
    const ready = DATA.scoutbookExportPreview.filter(r => r.status === 'Ready');
    const header = 'MemberID|FirstName|MiddleName|LastName|AdvancementType|AdvancementID|Version|DateCompleted|DateApproved|DateAwarded';
    const lines = ready.map(r =>
      [r.memberId, r.firstName, '', r.lastName, r.advancementType, r.advancementId, '1', r.dateCompleted, r.dateCompleted, r.dateCompleted].join('|')
    );
    const csv = [header, ...lines].join('\n');
    document.getElementById('exportCsvPreview').textContent = csv;

    document.getElementById('exportCopy').onclick = () => {
      navigator.clipboard.writeText(csv)
        .then(() => toast('CSV copied to clipboard', 'success'))
        .catch(() => toast('Copy failed — select and copy manually', 'danger'));
    };
    document.getElementById('exportDownload').onclick = () => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scoutbook-export-' + todayISO() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('CSV downloaded', 'success');
    };
  }

  // ── LOOKUPS / ADMIN ─────────────────────────────────────
  function renderAdmin() {
    document.getElementById('lookupCodesBody').innerHTML =
      DATA.lookups.internalRequirementCodes.map(c => `
        <tr>
          <td class="mono">${esc(c.code)}</td>
          <td>${esc(c.label)}</td>
          <td>${esc(c.officialMapping)}</td>
          <td class="mono">${esc(c.scoutbookId || '—')}</td>
        </tr>
      `).join('');

    const scoutsBody = document.getElementById('lookupScoutsBody');
    scoutsBody.innerHTML = DATA.scouts.map(s => {
      const entryCount = ledger.reduce((n, l) => n + (l.scoutId === s.id ? 1 : 0), 0);
      const archivedCount = ledger.reduce((n, l) => n + (l.scoutId === s.id && l.archivedAt ? 1 : 0), 0);
      const statusTag = s.active === false
        ? '<span class="tag gray">Aged out</span>'
        : (s.bsaMemberId ? '<span class="tag">Active</span>' : '<span class="tag warn">Needs BSA ID</span>');
      const action = s.active === false
        ? `<button class="ws-btn small" type="button" data-scout-reactivate="${esc(s.id)}">Reactivate &amp; restore</button>`
        : `<button class="ws-btn small danger" type="button" data-scout-ageout="${esc(s.id)}">Mark aged-out</button>`;
      return `
        <tr>
          <td>${esc(s.displayName)}
            <span style="display:block;font-size:11px;color:var(--admin-gray-500);">${entryCount.toLocaleString()} ledger entr${entryCount === 1 ? 'y' : 'ies'}${archivedCount ? ` · ${archivedCount.toLocaleString()} archived` : ''}</span>
          </td>
          <td class="mono">${esc(s.id)}</td>
          <td class="mono">${esc(s.bsaMemberId || '')}</td>
          <td>${statusTag}</td>
          <td class="actions">${action}</td>
        </tr>
      `;
    }).join('');

    scoutsBody.querySelectorAll('[data-scout-ageout]').forEach(b => {
      b.onclick = () => archiveScout(b.dataset.scoutAgeout);
    });
    scoutsBody.querySelectorAll('[data-scout-reactivate]').forEach(b => {
      b.onclick = () => reactivateScout(b.dataset.scoutReactivate);
    });

    document.getElementById('lookupLeadersBody').innerHTML =
      DATA.leaders
        .filter(l => l.code.length <= 4 && !['Lead','Project','Event','Outing','Camp','Clinic','Prior','Turner'].includes(l.code))
        .map(l => `
          <tr>
            <td class="mono">${esc(l.code)}</td>
            <td>${esc(l.name)}</td>
            <td>${esc(l.role)}</td>
          </tr>
        `).join('');

    document.getElementById('lookupMbBody').innerHTML =
      DATA.meritBadgeCatalog.slice().sort((a,b) => a.name.localeCompare(b.name)).map(b => `
        <tr>
          <td>${esc(b.name)}</td>
          <td>${b.eagle ? '<span class="tag warn">Eagle</span>' : '<span class="tag gray">—</span>'}</td>
          <td class="mono">${esc(b.scoutbookId || '')}</td>
        </tr>
      `).join('');
  }

})();
