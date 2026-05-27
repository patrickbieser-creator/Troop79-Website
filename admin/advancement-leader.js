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

    // Refresh hooks: some screens derive their content from the live ledger
    // and need a fresh render whenever the user navigates back to them.
    document.querySelector('.ws-nav-btn[data-screen="mb-progress"]').addEventListener('click', refreshMbProgress);
    document.querySelector('.ws-nav-btn[data-screen="fast-entry"]').addEventListener('click', applyFastEntryPrefill);
  }

  function refreshMbProgress() {
    if (!DATA) return;
    if (mbProgressState.activeMb) {
      const mb = (DATA.meritBadgeCatalog || []).find(m => m.id === mbProgressState.activeMb);
      if (mb) renderMbDetail(mb);
    } else {
      renderMbCatalog();
    }
  }

  function loadData() {
    // Cache-bust the JSON so prototype iterations show up without manual hard-reload.
    // Strip the query param when porting to production (Supabase replaces this fetch).
    fetch('../data/advancement.json?t=' + Date.now(), { cache: 'no-store' })
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
    const mbCatalog = DATA.meritBadgeCatalog || [];
    const rankPrefixes = {
      'scout':'S','tenderfoot':'TF','second-class':'SC','first-class':'FC',
      'star':'Star','life':'Life','eagle':'Eagle'
    };

    // Build a flat pool of (rank, req[, sub]) tuples so seed completions land on
    // the same codes the picker generates. This makes the "completed" UI states
    // appear immediately in the demo without anyone needing to save first.
    const rankReqPool = [];
    DATA.ranks.forEach(rank => {
      const prefix = rankPrefixes[rank.id] || rank.id;
      rank.requirements.forEach(req => {
        rankReqPool.push({
          code: `${prefix}-${req.code}`,
          label: `${rank.displayName} ${req.code} — ${req.label}`
        });
        (req.subRequirements || []).forEach((sub, idx) => {
          rankReqPool.push({
            code: `${prefix}-${req.code}.${idx + 1}`,
            label: `${rank.displayName} ${req.code} / ${sub.label}`
          });
        });
      });
    });

    const typeBuckets = [
      { weight: 45, build: () => {
          const r = pick(rankReqPool);
          return { type: 'rank_requirement', code: r.code, label: r.label, unit: 'complete', qty: 1 };
      }},
      { weight: 15, build: () => {
          const mb = pick(mbCatalog);
          // Prefer leaf codes from the authored requirement tree when available
          // so the MB Progress grid lights up for badges where requirements are
          // modeled. Leaves match the column codes (1a, 2a.1, etc.).
          const authored = (DATA.meritBadgeRequirements || {})[mb.id];
          let reqCode;
          if (authored && authored.length) {
            const leaves = flattenMbLeaves(authored);
            reqCode = leaves.length ? leaves[Math.floor(rand() * leaves.length)].code : `${rint(1,9)}${pick(['a','b','c',''])}`;
          } else {
            reqCode = `${rint(1,9)}${pick(['a','b','c',''])}`;
          }
          return { type: 'merit_badge_requirement', code: `${mb.id}-${reqCode}`, label: `${mb.name} requirement ${reqCode}`, unit: 'complete', qty: 1 };
      }},
      { weight: 12, build: () => ({ type: 'attendance', code: 'Meeting', label: 'Troop meeting', unit: 'event', qty: 1 }) },
      { weight: 8,  build: () => ({ type: 'service_hours', code: 'Service', label: pick(['Park cleanup','Food drive','Pinewood derby setup','Eagle project assist']), unit: 'hours', qty: rint(1,6) }) },
      { weight: 8,  build: () => ({ type: 'camping_nights', code: 'Nights', label: pick(['Summer camp','Winter campout','Backpacking trip','Klondike']), unit: 'nights', qty: rint(1,3) }) },
      { weight: 6,  build: () => ({ type: 'hiking_miles', code: 'Miles', label: pick(['Ice Age Trail','Lapham Peak','Kettle Moraine','State park hike']), unit: 'miles', qty: rint(2,12) }) },
      { weight: 4,  build: () => {
          const mb = pick(mbCatalog);
          return { type: 'merit_badge_award', code: `MB:${mb.id}`, label: `${mb.name} merit badge`, unit: 'badge', qty: 1 };
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

    // PROTOTYPE SEED — simulate "today's leader activity" so the Fast Entry audit
    // tape always has something to show on first display (the random window above
    // rarely lands on today by chance). Delete this block when wiring real data.
    const today = isoDate(now);
    const todayActivityCount = 12;
    for (let i = 0; i < todayActivityCount; i++) {
      const t = pickType();
      const by = pick(leaderCodes) || 'PB';
      // Most "today's entries" sign off recent work — randomize the completion
      // date within the past 30 days, but enteredAt is always today.
      const completionTs = now - rand() * 30 * 24 * 3600 * 1000;
      out.unshift({
        id: ++nextId,
        date: isoDate(completionTs),
        scoutId: pick(activeScouts),
        type: t.type,
        code: t.code,
        label: t.label,
        by,
        qty: t.qty,
        unit: t.unit,
        enteredBy: by,
        enteredAt: today,
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
    renderMbProgress();
    renderCoh();
    renderExport();
    renderAdmin();
    // After all initial renders, honor any deep-link prefill in the URL hash
    // (e.g. opening Fast Entry from the MB Progress grid with scout+mb+req set).
    applyFastEntryPrefill();
  }

  // ── Utility ──────────────────────────────────────────────
  function scoutById(id) { return DATA.scouts.find(s => s.id === id); }
  function scoutName(id) { const s = scoutById(id); return s ? s.displayName : id; }

  // Optionality phrasing — two variants:
  //   optionalityLabel: short pill text used in space-constrained UI (grid
  //     headers, picker group rows). Examples: "Complete any 2", "Complete any one".
  //   optionalityNote: full instructional phrasing used in the requirements
  //     list so parents/scouts spot the option at a glance.
  //     Examples: "Do any 2 of the following", "Do any one of the following".
  function optionalityLabel(node) {
    if (!node || !node.complete) return '';
    if (node.complete === 'all') return '';
    if (node.complete === 'any') return 'Complete any one';
    if (node.complete === 'n-of') return `Complete any ${node.completeN || 1}`;
    return '';
  }
  function optionalityNote(node) {
    if (!node || !node.complete) return '';
    if (node.complete === 'all') return '';
    if (node.complete === 'any') return 'Do any one of the following';
    if (node.complete === 'n-of') return `Do any ${node.completeN || 1} of the following`;
    return '';
  }

  // External link URLs for a merit badge. The catalog entry may override either
  // by setting `bsaPageUrl` or `workbookUrl`; otherwise we derive a best-guess
  // URL from the canonical patterns. A 404 means the badge needs a manual
  // override in the catalog.
  function bsaPageUrlFor(mb) {
    return mb.bsaPageUrl || `https://www.scouting.org/merit-badges/${encodeURIComponent(mb.id)}/`;
  }
  function workbookUrlFor(mb) {
    if (mb.workbookUrl) return mb.workbookUrl;
    // usscouts.org workbook PDFs use the badge name stripped of spaces/punctuation
    const slug = (mb.name || '').replace(/&/g, 'and').replace(/[^A-Za-z]/g, '');
    return `https://usscouts.org/usscouts/mb/worksheets/${slug}.pdf`;
  }

  // Walk a requirements tree depth-first and return the leaf nodes.
  // Leaves are nodes with no children — they become grid columns and signoff codes.
  function flattenMbLeaves(reqs) {
    const out = [];
    function walk(n) {
      if (!n.children || !n.children.length) {
        out.push(n);
      } else {
        n.children.forEach(walk);
      }
    }
    (reqs || []).forEach(walk);
    return out;
  }

  // Find the top-level parent code of a leaf (e.g. "2a.1" → "2"). Used to group
  // columns visually in the MB Progress grid.
  function topLevelOf(reqs, leafCode) {
    function check(node, top) {
      if (node.code === leafCode) return top;
      if (!node.children) return null;
      for (const c of node.children) {
        const r = check(c, top);
        if (r) return r;
      }
      return null;
    }
    for (const top of reqs || []) {
      const r = check(top, top.code);
      if (r) return r;
    }
    return null;
  }
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

  // ── REQUIREMENT PICKER ───────────────────────────────────
  // Tabs (rank ids + 'mb') · search across codes/labels/MB names · chips for selections.
  // For Merit Badges: alphabetical list → click "Open" → quick-add common req #s
  // (data lacks per-MB requirement definitions, so MB picker uses a freeform req# field
  // plus a one-click "Earned (full MB)" action that creates an mb_award entry).
  const RANK_CODE_PREFIX = {
    'scout': 'S',
    'tenderfoot': 'TF',
    'second-class': 'SC',
    'first-class': 'FC',
    'star': 'Star',
    'life': 'Life',
    'eagle': 'Eagle'
  };

  // Picker contract:
  //   multi:true  → checkbox semantics with three visual states per row:
  //                   empty       (not in ledger, not pending)
  //                   pending     (newly checked, not yet saved)  → dashed outline
  //                   completed   (returned by getCompletion)      → solid green + date badge
  //                 Click an empty row → marks pending.
  //                 Click a pending row → returns to empty.
  //                 Click a completed row → confirm prompt → onUncomplete(entry).
  //                 getValues() returns the pending items (use for the Save button).
  //   multi:false → single-select via radio. No completion logic. No chips.
  //                 getValues() returns [selectedItem] or [].
  // Catalog of Troop 79 leadership positions. Lives here (not in advancement.json)
  // because it's stable, lookup-only, and not yet authored in the data file.
  const LEADERSHIP_POSITIONS = [
    'Senior Patrol Leader', 'Assistant SPL', 'Patrol Leader', 'Assistant PL',
    'Troop Guide', 'Scribe', 'Quartermaster', 'Den Chief', 'Bugler',
    'Chaplain Aide', 'Historian', 'Librarian', 'OA Representative', 'Instructor'
  ];

  function createRequirementPicker({
    mount,
    multi = true,
    onChange,
    initial = [],
    getCompletion = null,   // (item) => {date, by, entryId} | null
    onUncomplete = null,    // (entry, reason) => void
    getHistory = null,      // (kind) => [{date, by, code, label, qty, unit, id}]
    showFormTabs = true     // false hides Service/Events/Leadership (used in Event Roster)
  }) {
    const state = {
      activeTab: 'tenderfoot',
      activeMb: null,
      search: '',
      // multi: tracks PENDING adds only. Completed state comes from getCompletion.
      // single: tracks the one selected item.
      selections: initial.slice()
    };

    function makeRankItem(rank, req, sub) {
      const prefix = RANK_CODE_PREFIX[rank.id] || rank.id;
      if (sub) {
        const subIdx = req.subRequirements.indexOf(sub) + 1;
        return {
          key: `rank:${rank.id}:${req.code}.${subIdx}`,
          kind: 'rank_requirement',
          code: `${prefix}-${req.code}.${subIdx}`,
          label: `${rank.displayName} ${req.code} / ${sub.label}`,
          rank: rank.id
        };
      }
      return {
        key: `rank:${rank.id}:${req.code}`,
        kind: 'rank_requirement',
        code: `${prefix}-${req.code}`,
        label: `${rank.displayName} ${req.code} — ${req.label}`,
        rank: rank.id
      };
    }
    function makeMbReqItem(mb, reqCode) {
      const clean = String(reqCode).trim();
      return {
        key: `mb:${mb.id}:${clean}`,
        kind: 'merit_badge_requirement',
        code: `${mb.id}-${clean}`,
        label: `${mb.name} requirement ${clean}`,
        mb: mb.id
      };
    }
    function makeMbAwardItem(mb) {
      return {
        key: `mb:${mb.id}:award`,
        kind: 'merit_badge_award',
        code: `MB:${mb.id}`,
        label: `${mb.name} — Merit Badge Earned`,
        mb: mb.id
      };
    }

    function completionFor(item) {
      return (multi && getCompletion) ? getCompletion(item) : null;
    }
    function statusFor(item) {
      if (!multi) return state.selections.some(s => s.key === item.key) ? 'selected' : 'empty';
      const c = completionFor(item);
      if (c) return 'completed';
      return state.selections.some(s => s.key === item.key) ? 'pending' : 'empty';
    }
    function handleRowClick(item) {
      const status = statusFor(item);
      if (status === 'completed') {
        const entry = completionFor(item);
        const reason = prompt(
          `"${item.label}" was completed on ${fmtDate(entry.date)} by ${entry.by}.\n\nRemove this completion? Provide a reason (e.g. duplicate, wrong scout, typo).\n\nThe entry will be hidden but recoverable via the Universal Ledger's "Show hidden rows" toggle.`,
          ''
        );
        if (reason === null) return;
        const r = reason.trim();
        if (!r) { toast('Removal cancelled — a reason is required', 'danger'); return; }
        onUncomplete && onUncomplete(entry, r);
        render();
        return;
      }
      if (status === 'pending' || status === 'selected') {
        state.selections = state.selections.filter(s => s.key !== item.key);
      } else {
        if (multi) {
          state.selections.push(item);
        } else {
          state.selections = [item];
        }
      }
      onChange && onChange(state.selections);
      render();
    }
    function clear() {
      state.selections = [];
      onChange && onChange(state.selections);
      render();
    }

    function renderTabs() {
      const rankTabs = DATA.ranks.filter(r => r.id !== 'scout').map(r => ({
        id: r.id,
        label: r.displayName.replace('Second Class', '2nd Class').replace('First Class', '1st Class')
      }));
      const baseTabs = [
        ...rankTabs,
        { id: 'scout', label: 'Scout' },
        { id: 'mb', label: 'MBs' }
      ];
      const formTabs = showFormTabs ? [
        { id: '__divider1', label: '|', divider: true },
        { id: 'service', label: 'Service' },
        { id: 'events', label: 'Events' },
        { id: 'leadership', label: 'Leadership' }
      ] : [];
      const tabs = [...baseTabs, ...formTabs];
      return `<div class="req-picker-tabs">${tabs.map(t => t.divider
        ? `<span class="req-picker-tab tab-divider">${esc(t.label)}</span>`
        : `<button type="button" class="req-picker-tab${state.activeTab === t.id ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
      ).join('')}</div>`;
    }

    function renderSummary() {
      // Only show summary bar in multi mode (Scout-First). Counts pending in the picker's
      // current scout context. Completed totals aren't computed here — too costly for
      // every requirement across the catalog and not load-bearing UX.
      if (!multi) return '';
      const pendingCount = state.selections.length;
      if (pendingCount === 0) return '';
      return `<div class="req-picker-summary">
        <span class="ps-pending"><span class="ps-dot"></span><strong>${pendingCount}</strong> pending — click <em>Save</em> to commit</span>
      </div>`;
    }

    function renderSearchRow() {
      // Service/Events/Leadership tabs use forms instead of search — hide the
      // search input there to keep the UI focused.
      const formTabs = new Set(['service', 'events', 'leadership']);
      if (formTabs.has(state.activeTab)) {
        return `<div class="req-picker-search-row">
          <span class="req-picker-context" style="flex:1;">${selectionCountLabel()}</span>
        </div>`;
      }
      const inMbDetail = state.activeTab === 'mb' && state.activeMb;
      const context = inMbDetail
        ? `<button type="button" class="req-picker-back" data-back="1">&larr; All merit badges</button>`
        : '';
      return `<div class="req-picker-search-row">
        ${context}
        <input type="search" class="req-picker-search" placeholder="${state.activeTab === 'mb' && !state.activeMb ? 'Search merit badges…' : 'Search requirements…'}" value="${esc(state.search)}" />
        <span class="req-picker-context">${selectionCountLabel()}</span>
      </div>`;
    }

    function selectionCountLabel() {
      if (!multi) return state.selections.length ? '1 selected' : 'Pick one';
      const n = state.selections.length;
      return n === 0 ? 'No new sign-offs' : `${n} pending`;
    }

    function renderRankList() {
      const rank = DATA.ranks.find(r => r.id === state.activeTab);
      if (!rank) return '<div class="req-picker-empty">No requirements found.</div>';
      const q = state.search.trim().toLowerCase();
      const rows = rank.requirements.flatMap(req => {
        const matchesParent = !q || req.code.toLowerCase().includes(q) || req.label.toLowerCase().includes(q);
        const subRows = (req.subRequirements || []).map((sub) => ({ req, sub }))
          .filter(({ sub }) => !q || sub.label.toLowerCase().includes(q));
        if (!matchesParent && subRows.length === 0) return [];
        return [{ req }, ...subRows];
      });
      if (rows.length === 0) return `<div class="req-picker-empty">No requirements match &ldquo;${esc(state.search)}&rdquo;</div>`;
      return rows.map(({ req, sub }) => {
        const item = makeRankItem(rank, req, sub);
        return renderItemRow(item, {
          codeDisplay: sub ? `${req.code}.${req.subRequirements.indexOf(sub) + 1}` : req.code,
          label: sub ? sub.label : req.label,
          indented: !!sub
        });
      }).join('');
    }

    // Shared row renderer with three-state visual logic.
    function renderItemRow(item, { codeDisplay, label, indented, indentPx }) {
      const status = statusFor(item);
      const completion = status === 'completed' ? completionFor(item) : null;
      const classes = ['req-row'];
      if (status === 'completed') classes.push('completed');
      else if (status === 'pending') classes.push('pending');
      else if (status === 'selected') classes.push('selected');
      const checked = status !== 'empty';
      const inputType = multi ? 'checkbox' : 'radio';
      const indentStyle = indentPx != null
        ? `style="margin-left:${indentPx}px;"`
        : (indented ? 'style="margin-left:28px;"' : '');
      let badge = '';
      if (status === 'completed') {
        badge = `<span class="req-completion-date" title="Signed off by ${esc(completion.by)}">Done ${esc(fmtDate(completion.date))} · ${esc(completion.by)}</span>`;
      } else if (status === 'pending') {
        badge = `<span class="req-completion-date">Pending</span>`;
      }
      return `<label class="${classes.join(' ')}" ${indentStyle} data-row-key="${esc(item.key)}">
        <input type="${inputType}" name="req-picker" ${checked ? 'checked' : ''} data-row-toggle="${esc(item.key)}" />
        <span class="req-code">${esc(codeDisplay)}</span>
        <span class="req-label">${esc(label)}</span>
        ${badge}
      </label>`;
    }

    function renderReqTree(mb, nodes, q, depth) {
      const matchesQ = (n) => !q || n.code.toLowerCase().includes(q) || (n.label || '').toLowerCase().includes(q);
      const subtreeMatches = (list) => list.some(n => matchesQ(n) || (n.children && subtreeMatches(n.children)));
      return nodes.map(node => {
        const hasChildren = !!(node.children && node.children.length);
        if (q && !matchesQ(node) && (!hasChildren || !subtreeMatches(node.children))) return '';
        if (hasChildren) {
          const rule = optionalityLabel(node);
          const indentPx = depth * 20;
          const header = `<div class="req-group-header" style="margin-left:${indentPx}px;">
            <span class="req-group-code">${esc(node.code)}</span>
            <span class="req-group-label">${esc(node.label || '')}</span>
            ${rule ? `<span class="req-rule-tag">${esc(rule)}</span>` : ''}
          </div>`;
          return header + renderReqTree(mb, node.children, q, depth + 1);
        }
        // Leaf: clickable row
        const item = makeMbReqItem(mb, node.code);
        item.label = `${mb.name} ${node.code} — ${node.label || ''}`;
        return renderItemRow(item, { codeDisplay: node.code, label: node.label || '', indentPx: depth * 20 });
      }).join('');
    }

    function renderMbList() {
      const q = state.search.trim().toLowerCase();
      const mbs = (DATA.meritBadgeCatalog || [])
        .filter(mb => !q || mb.name.toLowerCase().includes(q))
        .sort((a,b) => a.name.localeCompare(b.name));
      if (mbs.length === 0) return `<div class="req-picker-empty">No merit badges match &ldquo;${esc(state.search)}&rdquo;</div>`;
      return mbs.map(mb => `
        <div class="req-mb-row">
          <span class="mb-name">${esc(mb.name)}</span>
          ${mb.eagle ? '<span class="mb-eagle">Eagle</span>' : ''}
          <button type="button" class="mb-open" data-open-mb="${esc(mb.id)}">Open &rarr;</button>
        </div>
      `).join('');
    }

    function renderMbDetail() {
      const mb = (DATA.meritBadgeCatalog || []).find(m => m.id === state.activeMb);
      if (!mb) return '<div class="req-picker-empty">Merit badge not found.</div>';
      const awardItem = makeMbAwardItem(mb);
      const authoredReqs = (DATA.meritBadgeRequirements || {})[mb.id];

      const header = `<div class="req-mb-detail-header">
        <span class="req-mb-detail-title">${esc(mb.name)}${mb.eagle ? ' <span class="mb-eagle" style="margin-left:6px;">Eagle</span>' : ''}</span>
      </div>
      ${renderItemRow(awardItem, { codeDisplay: 'AWARD', label: 'Full merit badge earned', indented: false })}`;

      // If we have authored requirements for this MB, render them with their
      // proper hierarchy. Parents are non-clickable group headers (annotated with
      // their optionality rule). Leaves are clickable three-state rows.
      // Fall back to the generic 1–9 quick chips for MBs without authored data.
      if (authoredReqs) {
        const q = state.search.trim().toLowerCase();
        const list = renderReqTree(mb, authoredReqs, q, 0);
        return `<div class="req-mb-detail">
          ${header}
          <div style="margin-top:6px;">${list || `<div class="req-picker-empty">No requirements match &ldquo;${esc(state.search)}&rdquo;</div>`}</div>
        </div>`;
      }

      // Fallback for MBs without authored requirements
      const common = ['1','2','3','4','5','6','7','8','9'];
      return `<div class="req-mb-detail">
        ${header}
        <div class="req-mb-quick" style="margin-top:6px;">
          <label>Add requirement #</label>
          <input type="text" id="mbQuickInput-${esc(mb.id)}" placeholder="e.g. 4b" />
          <button type="button" class="primary" data-mb-quick="${esc(mb.id)}">Add</button>
          <span class="req-mb-hint">Requirements for this badge not authored yet — enter from pamphlet</span>
        </div>
        <div style="margin-top:6px;">
          ${common.map(c => renderItemRow(makeMbReqItem(mb, c), { codeDisplay: 'Req ' + c, label: '', indented: false })).join('')}
        </div>
      </div>`;
    }

    function renderBody() {
      if (state.activeTab === 'mb') {
        return state.activeMb ? renderMbDetail() : renderMbList();
      }
      if (state.activeTab === 'service')    return renderServiceTab();
      if (state.activeTab === 'events')     return renderEventsTab();
      if (state.activeTab === 'leadership') return renderLeadershipTab();
      return renderRankList();
    }

    // ── Service / Events / Leadership tabs ─────────────────────
    // Shared shape: a small entry form on top, pending items + history below.
    // Pending items live in state.selections like everything else; they remove
    // via an explicit × button rather than re-clicking the row (since these
    // entries are user-authored, not toggleable catalog items).

    function renderEntryRow(entry, opts) {
      const cls = opts.pending ? 'req-history-row pending' : 'req-history-row';
      const dateText = opts.pending ? 'pending' : esc(fmtDate(entry.date));
      const qtyText = entry.qty != null && entry.unit
        ? `${entry.qty} ${entry.qty === 1 ? entry.unit.replace(/s$/, '') : entry.unit}`
        : '';
      const byText = entry.by ? `· ${esc(entry.by)}` : '';
      const removeBtn = opts.pending
        ? `<button type="button" class="h-remove" data-pending-remove="${esc(entry.key)}" title="Remove">&times;</button>`
        : `<button type="button" class="h-remove" data-history-remove="${entry.id}" title="Remove (asks for reason)">&times;</button>`;
      return `<div class="${cls}">
        <span class="h-date">${dateText}</span>
        ${qtyText ? `<span class="h-qty">${esc(qtyText)}</span>` : ''}
        <span class="h-label">${esc(entry.label || '')}</span>
        <span class="h-by">${byText}</span>
        ${removeBtn}
      </div>`;
    }

    function pendingByKind(kind) {
      return state.selections.filter(s => s.kind === kind);
    }

    function historyByKind(kind, kinds) {
      if (!getHistory) return [];
      const filter = kinds || [kind];
      try {
        return getHistory(filter) || [];
      } catch (e) {
        return [];
      }
    }

    function renderServiceTab() {
      const pending = pendingByKind('service_hours');
      const history = historyByKind('service_hours');
      return `<div class="req-entry-form">
        <div class="row">
          <label class="fld">Date</label>
          <input type="date" id="svcDate" value="${esc(todayISO())}" />
          <label class="fld">Hrs</label>
          <input type="number" id="svcHrs" class="narrow" min="0.5" step="0.5" placeholder="2" />
        </div>
        <div class="row">
          <input type="text" id="svcDesc" placeholder="Description (e.g. Park cleanup, food drive)" />
          <button type="button" class="add-btn" data-add-service>+ Add Service</button>
        </div>
      </div>
      <div class="req-history-section">
        ${pending.length ? `<div class="req-history-heading">Pending (${pending.length})</div>${pending.map(p => renderEntryRow(p, { pending: true })).join('')}` : ''}
        ${multi && getHistory ? `<div class="req-history-heading" style="margin-top:8px;">History${history.length ? ` (${history.length})` : ''}</div>` : ''}
        ${multi && getHistory ? (history.length ? history.map(h => renderEntryRow(h, { pending: false })).join('') : '<div class="req-history-empty">No prior service entries for this scout.</div>') : ''}
      </div>`;
    }

    function renderEventsTab() {
      const pending = state.selections.filter(s => ['attendance', 'camping_nights', 'hiking_miles'].includes(s.kind));
      const history = historyByKind(null, ['attendance', 'camping_nights', 'hiking_miles']);
      const activityOpts = (DATA.activityTypes || []).map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
      return `<div class="req-entry-form">
        <div class="row">
          <label class="fld">Event</label>
          <select id="evtType">${activityOpts}</select>
          <input type="date" id="evtDate" value="${esc(todayISO())}" />
        </div>
        <div class="row">
          <label class="fld">Nights</label>
          <input type="number" id="evtNights" class="narrow" min="0" placeholder="0" />
          <label class="fld">Miles</label>
          <input type="number" id="evtMiles" class="narrow" min="0" placeholder="0" />
          <label class="fld">Hrs</label>
          <input type="number" id="evtHrs" class="narrow" min="0" step="0.5" placeholder="0" />
          <button type="button" class="add-btn" data-add-event>+ Add Event</button>
        </div>
        <div class="row">
          <input type="text" id="evtNote" placeholder="Optional note (e.g. Klondike Derby 2026)" />
        </div>
      </div>
      <div class="req-history-section">
        ${pending.length ? `<div class="req-history-heading">Pending (${pending.length})</div>${pending.map(p => renderEntryRow(p, { pending: true })).join('')}` : ''}
        ${multi && getHistory ? `<div class="req-history-heading" style="margin-top:8px;">History${history.length ? ` (${history.length})` : ''}</div>` : ''}
        ${multi && getHistory ? (history.length ? history.map(h => renderEntryRow(h, { pending: false })).join('') : '<div class="req-history-empty">No prior event entries for this scout.</div>') : ''}
      </div>`;
    }

    function renderLeadershipTab() {
      const pending = pendingByKind('leadership');
      const history = historyByKind('leadership');
      const posOpts = LEADERSHIP_POSITIONS.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
      return `<div class="req-entry-form">
        <div class="row">
          <label class="fld">Position</label>
          <select id="ldrPos">${posOpts}</select>
        </div>
        <div class="row">
          <label class="fld">Start</label>
          <input type="date" id="ldrStart" value="${esc(todayISO())}" />
          <label class="fld">Months</label>
          <input type="number" id="ldrMonths" class="narrow" min="1" max="36" value="6" />
          <button type="button" class="add-btn" data-add-leadership>+ Add Term</button>
        </div>
      </div>
      <div class="req-history-section">
        ${pending.length ? `<div class="req-history-heading">Pending (${pending.length})</div>${pending.map(p => renderEntryRow(p, { pending: true })).join('')}` : ''}
        ${multi && getHistory ? `<div class="req-history-heading" style="margin-top:8px;">History${history.length ? ` (${history.length})` : ''}</div>` : ''}
        ${multi && getHistory ? (history.length ? history.map(h => renderEntryRow(h, { pending: false })).join('') : '<div class="req-history-empty">No prior leadership terms for this scout.</div>') : ''}
      </div>`;
    }

    // Synthesize a fresh key for user-authored entries — date + a counter
    // suffix keeps it unique across multiple adds in the same form session.
    let _pendingSeq = 0;
    function makePendingKey(prefix) {
      _pendingSeq += 1;
      return `${prefix}:${Date.now()}.${_pendingSeq}`;
    }

    function addServicePending() {
      const date = mount.querySelector('#svcDate').value;
      const hrs = parseFloat(mount.querySelector('#svcHrs').value);
      const desc = (mount.querySelector('#svcDesc').value || '').trim();
      if (!hrs || hrs <= 0) { toast('Enter service hours', 'danger'); return; }
      if (!desc) { toast('Enter a description', 'danger'); return; }
      state.selections.push({
        key: makePendingKey('service'),
        kind: 'service_hours',
        code: 'Service',
        label: desc,
        date,
        qty: hrs,
        unit: 'hours'
      });
      onChange && onChange(state.selections);
      render();
    }

    function addEventPending() {
      const type = mount.querySelector('#evtType').value;
      const typeLabel = (DATA.activityTypes || []).find(t => t.id === type)?.label || type;
      const date = mount.querySelector('#evtDate').value;
      const nights = parseFloat(mount.querySelector('#evtNights').value) || 0;
      const miles = parseFloat(mount.querySelector('#evtMiles').value) || 0;
      const hrs = parseFloat(mount.querySelector('#evtHrs').value) || 0;
      const note = (mount.querySelector('#evtNote').value || '').trim();
      const baseLabel = note ? `${typeLabel} — ${note}` : typeLabel;

      // One event can produce multiple ledger entries (attendance + nights + miles + hours).
      // We push each as a separate pending item so they save as distinct ledger rows.
      const groupKey = makePendingKey('evt');
      state.selections.push({
        key: groupKey,
        kind: 'attendance',
        code: typeLabel,
        label: baseLabel,
        date,
        qty: 1,
        unit: 'event'
      });
      if (nights > 0) state.selections.push({
        key: groupKey + ':nights', kind: 'camping_nights', code: 'Nights', label: baseLabel, date, qty: nights, unit: 'nights'
      });
      if (miles > 0) state.selections.push({
        key: groupKey + ':miles', kind: 'hiking_miles', code: 'Miles', label: baseLabel, date, qty: miles, unit: 'miles'
      });
      if (hrs > 0) state.selections.push({
        key: groupKey + ':hrs', kind: 'service_hours', code: 'Service', label: baseLabel, date, qty: hrs, unit: 'hours'
      });
      onChange && onChange(state.selections);
      render();
    }

    function addLeadershipPending() {
      const pos = mount.querySelector('#ldrPos').value;
      const date = mount.querySelector('#ldrStart').value;
      const months = parseInt(mount.querySelector('#ldrMonths').value, 10) || 6;
      state.selections.push({
        key: makePendingKey('lead'),
        kind: 'leadership',
        code: 'Lead',
        label: `${pos} (${months} mo term)`,
        date,
        qty: months,
        unit: 'months'
      });
      onChange && onChange(state.selections);
      render();
    }

    function render() {
      mount.innerHTML = `<div class="req-picker">
        ${renderTabs()}
        ${renderSearchRow()}
        ${renderSummary()}
        <div class="req-picker-list">${renderBody()}</div>
      </div>`;

      // Tab clicks
      mount.querySelectorAll('.req-picker-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          state.activeTab = btn.dataset.tab;
          state.activeMb = null;
          state.search = '';
          render();
        });
      });
      // Search
      const search = mount.querySelector('.req-picker-search');
      if (search) {
        search.addEventListener('input', (e) => {
          state.search = e.target.value;
          // Re-render only the body + count to preserve focus
          const list = mount.querySelector('.req-picker-list');
          if (list) list.innerHTML = renderBody();
          const ctx = mount.querySelector('.req-picker-context');
          if (ctx) ctx.textContent = selectionCountLabel();
          bindListHandlers();
        });
      }
      // Back to MB list
      const back = mount.querySelector('[data-back]');
      if (back) back.addEventListener('click', () => { state.activeMb = null; state.search = ''; render(); });
      bindListHandlers();
    }

    function bindListHandlers() {
      // Row toggle (handles empty/pending/completed via handleRowClick)
      mount.querySelectorAll('[data-row-toggle]').forEach(input => {
        // Use mousedown so we can intercept BEFORE the native checkbox toggles —
        // otherwise an already-completed checkbox would briefly uncheck before
        // the confirm prompt, and a cancelled confirm leaves it in the wrong state.
        const label = input.closest('label');
        if (label) {
          label.addEventListener('click', (e) => {
            // Let the click bubble through, but route logic via our handler.
            // Prevent default so the input doesn't double-toggle when we re-render.
            e.preventDefault();
            const item = itemFromKey(input.dataset.rowToggle);
            if (item) handleRowClick(item);
          });
        }
      });
      // Open MB
      mount.querySelectorAll('[data-open-mb]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.activeMb = btn.dataset.openMb;
          state.search = '';
          render();
        });
      });
      // MB freeform quick add
      mount.querySelectorAll('[data-mb-quick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mbId = btn.dataset.mbQuick;
          const input = mount.querySelector(`#mbQuickInput-${CSS.escape(mbId)}`);
          if (!input) return;
          const val = input.value.trim();
          if (!val) return;
          const mb = (DATA.meritBadgeCatalog || []).find(m => m.id === mbId);
          if (!mb) return;
          handleRowClick(makeMbReqItem(mb, val));
          input.value = '';
        });
      });
      // Service / Events / Leadership form adds
      const srvBtn = mount.querySelector('[data-add-service]');
      if (srvBtn) srvBtn.addEventListener('click', addServicePending);
      const evtBtn = mount.querySelector('[data-add-event]');
      if (evtBtn) evtBtn.addEventListener('click', addEventPending);
      const ldrBtn = mount.querySelector('[data-add-leadership]');
      if (ldrBtn) ldrBtn.addEventListener('click', addLeadershipPending);
      // Pending-row remove (× button on user-authored pending items)
      mount.querySelectorAll('[data-pending-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.pendingRemove;
          state.selections = state.selections.filter(s => s.key !== key);
          onChange && onChange(state.selections);
          render();
        });
      });
      // History-row remove (× button on completed entries → confirm + soft-delete)
      mount.querySelectorAll('[data-history-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const entryId = +btn.dataset.historyRemove;
          const entry = onUncomplete && getHistory ? findHistoryEntry(entryId) : null;
          if (!entry) return;
          const reason = prompt(
            `Remove this ${entry.kind || 'entry'} from ${fmtDate(entry.date)} (${entry.qty || ''} ${entry.unit || ''})?\n\nProvide a reason (e.g. duplicate, wrong scout, typo).\n\nThe entry will be hidden but recoverable via the Universal Ledger's "Show hidden rows" toggle.`,
            ''
          );
          if (reason === null) return;
          const r = reason.trim();
          if (!r) { toast('Removal cancelled — a reason is required', 'danger'); return; }
          onUncomplete({ entryId: entry.id, date: entry.date, by: entry.by }, r);
          render();
        });
      });
    }

    function findHistoryEntry(entryId) {
      if (!getHistory) return null;
      // We don't know the kind, so ask for every kind we render in tabs.
      const allKinds = ['service_hours', 'attendance', 'camping_nights', 'hiking_miles', 'leadership'];
      const entries = getHistory(allKinds) || [];
      return entries.find(e => e.id === entryId) || null;
    }

    function itemFromKey(key) {
      // key formats:
      //   rank:<rankId>:<code>           (req with no sub)
      //   rank:<rankId>:<code>.<subIdx>  (sub-req)
      //   mb:<mbId>:<reqCode>            (mb req)
      //   mb:<mbId>:award                (mb award)
      const parts = key.split(':');
      if (parts[0] === 'rank') {
        const rank = DATA.ranks.find(r => r.id === parts[1]);
        if (!rank) return null;
        const tail = parts.slice(2).join(':');
        const dot = tail.indexOf('.');
        if (dot > -1) {
          const parentCode = tail.slice(0, dot);
          const subIdx = parseInt(tail.slice(dot + 1), 10);
          const req = rank.requirements.find(r => r.code === parentCode);
          if (!req || !req.subRequirements) return null;
          const sub = req.subRequirements[subIdx - 1];
          return sub ? makeRankItem(rank, req, sub) : null;
        }
        const req = rank.requirements.find(r => r.code === tail);
        return req ? makeRankItem(rank, req) : null;
      }
      if (parts[0] === 'mb') {
        const mb = (DATA.meritBadgeCatalog || []).find(m => m.id === parts[1]);
        if (!mb) return null;
        const tail = parts.slice(2).join(':');
        if (tail === 'award') return makeMbAwardItem(mb);
        return makeMbReqItem(mb, tail);
      }
      return null;
    }

    render();
    return {
      getValues: () => state.selections.slice(),
      clear,
      setValues: (items) => { state.selections = items.slice(); render(); }
    };
  }

  let scoutFirstPicker = null;
  let reqFirstPicker = null;

  // Look up the active (non-archived, non-deleted) ledger entry for a given
  // scout + code, if any. Returns the most recent such entry or null.
  function findActiveCompletion(scoutId, code) {
    if (!scoutId || !code) return null;
    const matches = ledger.filter(l =>
      l.scoutId === scoutId &&
      l.code === code &&
      !l.archivedAt &&
      !l.deletedAt
    );
    if (matches.length === 0) return null;
    // Most recent by date, fall back to entry id
    matches.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0));
    return matches[0];
  }

  function mountScoutFirstPicker() {
    const scoutId = document.getElementById('scoutFirstSel').value;
    scoutFirstPicker = createRequirementPicker({
      mount: document.getElementById('scoutFirstPicker'),
      multi: true,
      getCompletion: (item) => {
        const entry = findActiveCompletion(scoutId, item.code);
        return entry ? { date: entry.date, by: entry.by, entryId: entry.id } : null;
      },
      onUncomplete: (completion, reason) => {
        const entry = ledger.find(l => l.id === completion.entryId);
        if (!entry) return;
        entry.deletedAt = todayISO();
        entry.deletedBy = 'PB';
        entry.deletedReason = reason;
        renderDashboard();
        renderLedger();
        renderFastEntryTape();
        toast('Completion removed (recoverable from Show hidden rows)', 'success');
      },
      // History feed for Service / Events / Leadership tabs — most recent first,
      // filtered to the selected scout. Capped to keep rendering fast.
      getHistory: (kinds) => {
        if (!scoutId || !kinds || !kinds.length) return [];
        const set = new Set(kinds);
        return ledger
          .filter(l => l.scoutId === scoutId && set.has(l.type) && !l.archivedAt && !l.deletedAt)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 30)
          .map(l => ({ id: l.id, date: l.date, by: l.by, code: l.code, label: l.label, qty: l.qty, unit: l.unit, kind: l.type }));
      }
    });
  }

  // ── FAST ENTRY ───────────────────────────────────────────
  // Bulk-grid pending: scouts the leader has just checked but not yet saved.
  // Already-completed scouts are not tracked here — they come from the ledger.
  let reqFirstPending = new Set();

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

    // Scout grid is now completion-aware: rendered fresh whenever the requirement
    // picker selection changes (so date badges reflect the current code).
    renderReqFirstScoutGrid();

    // Scout-First picker is scout-aware: its completion lookup queries the ledger for
    // the currently-selected scout. We re-mount whenever the scout changes so the
    // visual state (completed = solid green + date; pending = dashed) reflects that
    // scout's history.
    mountScoutFirstPicker();
    const scoutSelEl = document.getElementById('scoutFirstSel');
    scoutSelEl.onchange = mountScoutFirstPicker;

    // Requirement-First picker is single-select (radio): no completion state inside
    // the picker. Completion state appears in the scout grid below as date badges.
    if (!reqFirstPicker) {
      reqFirstPicker = createRequirementPicker({
        mount: document.getElementById('reqFirstPicker'),
        multi: false,
        initial: [{
          key: 'mb:cooking:4b',
          kind: 'merit_badge_requirement',
          code: 'cooking-4b',
          label: 'Cooking requirement 4b',
          mb: 'cooking'
        }],
        onChange: () => renderReqFirstScoutGrid()
      });
    }

    // Buttons
    document.getElementById('reqFirstSelectAll').onclick = () => {
      // "Select all" toggles pending state for scouts who haven't already completed
      // the picked requirement. Already-completed scouts are never auto-toggled —
      // removing a completion requires the explicit confirm-and-reason flow.
      const code = currentReqFirstCode();
      const eligible = DATA.scouts.filter(s => s.active && !findActiveCompletion(s.id, code));
      const allPending = eligible.length > 0 && eligible.every(s => reqFirstPending.has(s.id));
      eligible.forEach(s => {
        if (allPending) reqFirstPending.delete(s.id);
        else reqFirstPending.add(s.id);
      });
      renderReqFirstScoutGrid();
    };
    document.getElementById('reqFirstClear').onclick = () => {
      reqFirstPicker && reqFirstPicker.clear();
      document.getElementById('reqFirstNotes').value = '';
      reqFirstPending.clear();
      renderReqFirstScoutGrid();
    };
    document.getElementById('reqFirstSave').onclick = saveRequirementFirst;
    document.getElementById('scoutFirstClear').onclick = () => {
      scoutFirstPicker && scoutFirstPicker.clear();
      document.getElementById('scoutFirstNotes').value = '';
    };
    document.getElementById('scoutFirstSave').onclick = saveScoutFirst;

    // Initial population of today's audit tape under the entry cards.
    renderFastEntryTape();
  }

  function updateReqFirstCount() {
    const code = currentReqFirstCode();
    const completed = code
      ? DATA.scouts.filter(s => s.active && findActiveCompletion(s.id, code)).length
      : 0;
    const pending = reqFirstPending.size;
    const label = code
      ? `(${pending} pending · ${completed} already done)`
      : `(${pending} pending)`;
    document.getElementById('reqFirstSelCount').textContent = label;
    document.getElementById('reqFirstBtnCount').textContent = pending;
  }

  function currentReqFirstCode() {
    if (!reqFirstPicker) return null;
    const items = reqFirstPicker.getValues();
    return items.length ? items[0].code : null;
  }

  function renderReqFirstScoutGrid() {
    const grid = document.getElementById('reqFirstScoutGrid');
    if (!grid) return;
    const code = currentReqFirstCode();
    const scouts = DATA.scouts.filter(s => s.active);
    grid.innerHTML = scouts.map(s => {
      const completion = code ? findActiveCompletion(s.id, code) : null;
      const isPending = reqFirstPending.has(s.id);
      const cls = ['scout-check'];
      if (completion) cls.push('completed');
      else if (isPending) cls.push('pending');
      const checked = !!completion || isPending;
      const badge = completion
        ? `<span class="done-badge" title="Signed off by ${esc(completion.by)}">${esc(fmtDate(completion.date))}</span>`
        : (isPending ? `<span class="done-badge">pending</span>` : '');
      return `<label class="${cls.join(' ')}" data-scout="${esc(s.id)}">
        <input type="checkbox" value="${esc(s.id)}" ${checked ? 'checked' : ''} />
        <span class="name">${esc(s.displayName)}</span>
        ${badge}
        <span class="rk">${RANK_LABELS[s.currentRank].split(' ').map(w => w[0]).join('')}</span>
      </label>`;
    }).join('');
    grid.querySelectorAll('label.scout-check').forEach(label => {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        const scoutId = label.dataset.scout;
        const completion = code ? findActiveCompletion(scoutId, code) : null;
        if (completion) {
          const sName = scoutName(scoutId);
          const reason = prompt(
            `${sName} completed "${code}" on ${fmtDate(completion.date)} (signed by ${completion.by}).\n\nRemove this completion? Provide a reason (e.g. duplicate, wrong scout, typo).\n\nThe entry will be hidden but recoverable via the Universal Ledger's "Show hidden rows" toggle.`,
            ''
          );
          if (reason === null) return;
          const r = reason.trim();
          if (!r) { toast('Removal cancelled — a reason is required', 'danger'); return; }
          const entry = ledger.find(l => l.id === completion.id);
          if (entry) {
            entry.deletedAt = todayISO();
            entry.deletedBy = 'PB';
            entry.deletedReason = r;
          }
          renderDashboard();
          renderLedger();
          renderFastEntryTape();
          renderReqFirstScoutGrid();
          toast(`Completion removed for ${sName}`, 'success');
          return;
        }
        if (reqFirstPending.has(scoutId)) reqFirstPending.delete(scoutId);
        else reqFirstPending.add(scoutId);
        renderReqFirstScoutGrid();
      });
    });
    updateReqFirstCount();
  }

  function saveScoutFirst() {
    const scoutId = document.getElementById('scoutFirstSel').value;
    const date    = document.getElementById('scoutFirstDate').value;
    const by      = document.getElementById('scoutFirstBy').value;
    const items   = scoutFirstPicker ? scoutFirstPicker.getValues() : [];
    const notes   = document.getElementById('scoutFirstNotes').value.trim();

    if (!items.length) { toast('Check at least one requirement to sign off', 'danger'); return; }

    items.forEach(it => {
      // Item's own date wins over the form date — service/events/leadership pickers
      // collect a per-entry date in their forms. Rank/MB items don't carry date.
      ledger.unshift(makeLedgerEntry({
        scoutId,
        date: it.date || date,
        by,
        code: it.code,
        label: it.label,
        notes,
        kind: it.kind,
        qty: it.qty,
        unit: it.unit
      }));
    });
    document.getElementById('scoutFirstNotes').value = '';
    // clear() empties pending selections and re-renders the picker IN PLACE.
    // Re-render re-evaluates getCompletion for every visible row, so just-saved
    // items pick up their new ledger entry and flip from "pending" to "completed"
    // (solid green + date badge) without resetting the active tab or any MB drill-in.
    scoutFirstPicker.clear();
    renderDashboard();
    renderLedger();
    renderFastEntryTape();
    refreshMbProgress();
    toast(`Saved ${items.length} entr${items.length === 1 ? 'y' : 'ies'} for ${scoutName(scoutId)}`, 'success');
  }

  function saveRequirementFirst() {
    const items = reqFirstPicker ? reqFirstPicker.getValues() : [];
    const date  = document.getElementById('reqFirstDate').value;
    const by    = document.getElementById('reqFirstBy').value;
    const notes = document.getElementById('reqFirstNotes').value.trim();

    if (items.length === 0) { toast('Pick a requirement or fill in an entry form', 'danger'); return; }
    if (reqFirstPending.size === 0) { toast('Check at least one scout to sign off', 'danger'); return; }

    // For service/events/leadership: a single "pick" can produce multiple ledger
    // items (e.g. attendance + nights + miles). We apply all items to each pending
    // scout so a bulk save mirrors what would have been entered scout-by-scout.
    let saveCount = 0;
    reqFirstPending.forEach(scoutId => {
      items.forEach(it => {
        ledger.unshift(makeLedgerEntry({
          scoutId,
          date: it.date || date,
          by,
          code: it.code,
          label: it.label,
          notes,
          kind: it.kind,
          qty: it.qty,
          unit: it.unit
        }));
        saveCount++;
      });
    });
    const n = reqFirstPending.size;
    reqFirstPending.clear();
    // Clear the picker's pending items (they've all been saved).
    reqFirstPicker.clear();
    // Re-render scout grid in place so newly-saved scouts flip from pending → completed.
    renderReqFirstScoutGrid();
    renderDashboard();
    renderLedger();
    renderFastEntryTape();
    refreshMbProgress();
    toast(`Saved ${saveCount} ledger ${saveCount === 1 ? 'entry' : 'entries'} for ${n} scout${n === 1 ? '' : 's'}`, 'success');
  }

  function lookupLabel(code) {
    const lk = (DATA.lookups.internalRequirementCodes || []).find(c => c.code === code);
    return lk ? lk.label : null;
  }

  function makeLedgerEntry({ scoutId, date, by, code, label, notes, kind, qty, unit }) {
    const type = kind
      || (code.startsWith('MB:') ? 'merit_badge_award'
          : /^(Camp|Event|Meeting|Service)/i.test(code) ? 'attendance'
          : 'rank_requirement');
    return {
      id: ++_ledgerId,
      date,
      scoutId,
      type,
      code,
      label,
      by,
      qty: qty != null ? qty : 1,
      unit: unit || 'complete',
      enteredBy: by,
      enteredAt: todayISO(),
      notes
    };
  }

  // ── EVENT ROSTER ─────────────────────────────────────────
  // Per-scout pending requirements for the Event Roster. Survives row-filter
  // changes (which re-draw the rows) so a leader can filter, expand, pick reqs,
  // clear the filter, and still have those pendings tracked. Pickers themselves
  // are re-mounted on row redraw and read their initial state from this map.
  const rosterPendingReqs = {};   // scoutId -> [picker items]
  const rosterOpenScouts = new Set();   // scoutId currently expanded
  const rosterPickers = {};       // scoutId -> picker instance (lazy)

  function renderEventRoster() {
    const tbody = document.getElementById('rosterBody');
    const filterInput = document.getElementById('rosterFilter');

    const draw = () => {
      const filter = filterInput.value.trim().toLowerCase();
      const rows = DATA.scouts.filter(s => s.active && (!filter ||
        (s.displayName + ' ' + s.patrol).toLowerCase().includes(filter)));
      tbody.innerHTML = rows.map((s, i) => {
        const pending = rosterPendingReqs[s.id] || [];
        const isOpen = rosterOpenScouts.has(s.id);
        const reqsBtn = `<button type="button" class="roster-reqs-toggle${pending.length ? ' has-pending' : ''}${isOpen ? ' open' : ''}" data-toggle-reqs="${s.id}">
          ${pending.length ? `<span class="reqs-count">${pending.length}</span>` : '+'} ${pending.length ? 'pending' : 'Add reqs'}
          <span class="caret">▼</span>
        </button>`;
        return `
        <tr data-id="${s.id}">
          <td style="text-align:center;"><input type="checkbox" class="roster-attend" ${i < 3 ? 'checked' : ''} /></td>
          <td>${esc(s.displayName)}</td>
          <td>${esc(s.patrol || '')}</td>
          <td><span class="tag gray">${RANK_LABELS[s.currentRank]}</span></td>
          <td class="num"><input type="number" class="narrow-num roster-nights" value="${i < 3 ? '2' : '0'}" min="0" /></td>
          <td class="num"><input type="number" class="narrow-num roster-miles"  value="0" min="0" /></td>
          <td class="num"><input type="number" class="narrow-num roster-hours"  value="0" min="0" /></td>
          <td>${reqsBtn}</td>
        </tr>
        <tr class="roster-reqs-row" data-scout-row="${s.id}" style="display:${isOpen ? 'table-row' : 'none'};">
          <td colspan="8">
            <div class="reqs-row-header">Sign-offs for <strong>${esc(s.displayName)}</strong> from this event &mdash; pendings are saved alongside attendance.</div>
            <div class="roster-picker-mount" id="rosterPicker-${esc(s.id)}"></div>
          </td>
        </tr>`;
      }).join('');
      updateRosterCount();
      tbody.querySelectorAll('.roster-attend').forEach(cb =>
        cb.addEventListener('change', updateRosterCount));
      tbody.querySelectorAll('[data-toggle-reqs]').forEach(btn => {
        btn.addEventListener('click', () => toggleRosterReqs(btn.dataset.toggleReqs));
      });
      // Re-mount any pickers that were open when we redrew
      rosterOpenScouts.forEach(scoutId => mountRosterPicker(scoutId));
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
      tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        if (!tr.querySelector('.roster-attend').checked) return;
        tr.querySelector('.roster-nights').value = n;
        tr.querySelector('.roster-miles').value  = m;
        tr.querySelector('.roster-hours').value  = h;
      });
      toast('Applied defaults to attending scouts');
    };
    document.getElementById('rosterSave').onclick = saveEventRoster;

    function toggleRosterReqs(scoutId) {
      if (rosterOpenScouts.has(scoutId)) {
        rosterOpenScouts.delete(scoutId);
      } else {
        rosterOpenScouts.add(scoutId);
      }
      draw();
    }

    function mountRosterPicker(scoutId) {
      const mountEl = document.getElementById('rosterPicker-' + scoutId);
      if (!mountEl) return;
      // Fresh picker per mount — the DOM was just replaced by draw().
      rosterPickers[scoutId] = createRequirementPicker({
        mount: mountEl,
        multi: true,
        showFormTabs: false,
        initial: (rosterPendingReqs[scoutId] || []).slice(),
        getCompletion: (item) => {
          const entry = findActiveCompletion(scoutId, item.code);
          return entry ? { date: entry.date, by: entry.by, entryId: entry.id } : null;
        },
        onUncomplete: (completion, reason) => {
          const entry = ledger.find(l => l.id === completion.entryId);
          if (!entry) return;
          entry.deletedAt = todayISO();
          entry.deletedBy = 'PB';
          entry.deletedReason = reason;
          renderDashboard();
          renderLedger();
          renderFastEntryTape();
          toast('Completion removed (recoverable from Show hidden rows)', 'success');
        },
        onChange: (items) => {
          rosterPendingReqs[scoutId] = items.slice();
          // Refresh just the toggle button label/badge without redrawing the whole table
          const btn = tbody.querySelector(`[data-toggle-reqs="${scoutId}"]`);
          if (btn) {
            const hasP = items.length > 0;
            btn.classList.toggle('has-pending', hasP);
            btn.innerHTML = `${hasP ? `<span class="reqs-count">${items.length}</span>` : '+'} ${hasP ? 'pending' : 'Add reqs'} <span class="caret">▼</span>`;
            btn.classList.add('open');
          }
        }
      });
    }
  }

  function saveEventRoster() {
    const tbody = document.getElementById('rosterBody');
    const activity = document.getElementById('rosterActivity').selectedOptions[0].text;
    const date = todayISO();
    const by = 'PB';
    let count = 0;
    let scoutsWritten = 0;

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      if (!tr.querySelector('.roster-attend').checked) return;
      const id = tr.dataset.id;
      const nights = +tr.querySelector('.roster-nights').value || 0;
      const miles  = +tr.querySelector('.roster-miles').value  || 0;
      const hours  = +tr.querySelector('.roster-hours').value  || 0;
      scoutsWritten++;

      ledger.unshift(makeLedgerEntry({
        scoutId: id, date, by, code: 'Activity', label: activity,
        kind: 'attendance', qty: 1, unit: 'event'
      }));
      count++;
      if (nights > 0) {
        ledger.unshift(makeLedgerEntry({
          scoutId: id, date, by, code: 'Nights', label: activity + ' — camping',
          kind: 'camping_nights', qty: nights, unit: 'nights'
        }));
        count++;
      }
      if (miles > 0) {
        ledger.unshift(makeLedgerEntry({
          scoutId: id, date, by, code: 'Miles', label: activity + ' — hiking',
          kind: 'hiking_miles', qty: miles, unit: 'miles'
        }));
        count++;
      }
      if (hours > 0) {
        ledger.unshift(makeLedgerEntry({
          scoutId: id, date, by, code: 'Service', label: activity + ' — service',
          kind: 'service_hours', qty: hours, unit: 'hours'
        }));
        count++;
      }
      // Per-scout requirement sign-offs from the inline picker
      const reqs = rosterPendingReqs[id] || [];
      reqs.forEach(it => {
        ledger.unshift(makeLedgerEntry({
          scoutId: id, date, by,
          code: it.code, label: it.label,
          kind: it.kind, qty: it.qty, unit: it.unit
        }));
        count++;
      });
      rosterPendingReqs[id] = [];
    });

    // Refresh any open pickers in place so just-saved reqs flip pending → completed.
    rosterOpenScouts.forEach(scoutId => {
      const p = rosterPickers[scoutId];
      if (p) p.clear();
    });
    // And update the toggle-button summaries (counts went to zero).
    tbody.querySelectorAll('[data-toggle-reqs]').forEach(btn => {
      btn.classList.remove('has-pending');
      const isOpen = btn.classList.contains('open');
      btn.innerHTML = `+ Add reqs <span class="caret">▼</span>`;
      if (isOpen) btn.classList.add('open');
    });

    renderDashboard();
    renderLedger();
    renderFastEntryTape();
    refreshMbProgress();
    toast(`Saved ${count} ledger entries across ${scoutsWritten} scout${scoutsWritten === 1 ? '' : 's'} for "${activity}"`, 'success');
  }

  function updateRosterCount() {
    const n = document.querySelectorAll('#rosterBody .roster-attend:checked').length;
    document.getElementById('rosterAttCount').textContent =
      `${n} attending`;
  }

  // ── MB PROGRESS ──────────────────────────────────────────
  // Computes per-MB progress per scout from the live ledger. Always derived
  // (no cached store) so the catalog reflects the latest sign-offs the
  // moment any save lands.
  const mbProgressState = { activeMb: null };

  function mbAwardCodeFor(mbId)      { return 'MB:' + mbId; }
  function mbReqCodePrefix(mbId)     { return mbId + '-'; }

  function buildMbProgress(mbId) {
    // Returns { byScout: { scoutId: { award: bool, reqCodes: Set<reqCode> } }, started: [scoutId] }
    const awardCode = mbAwardCodeFor(mbId);
    const reqPrefix = mbReqCodePrefix(mbId);
    const byScout = {};
    ledger.forEach(l => {
      if (l.archivedAt || l.deletedAt) return;
      let reqCode = null;
      let isAward = false;
      if (l.code === awardCode) {
        isAward = true;
      } else if (typeof l.code === 'string' && l.code.startsWith(reqPrefix)) {
        reqCode = l.code.slice(reqPrefix.length);
      } else {
        return;
      }
      const slot = byScout[l.scoutId] || (byScout[l.scoutId] = { award: false, reqCodes: new Set() });
      if (isAward) slot.award = true;
      if (reqCode) slot.reqCodes.add(reqCode);
    });
    const started = Object.keys(byScout).filter(id => {
      const s = scoutById(id);
      return s && s.active;
    });
    return { byScout, started };
  }

  function renderMbProgress() {
    renderMbCatalog();
    // If the URL hash already targets a specific MB, drill in immediately.
    const target = readHashParam('mb');
    if (target) {
      openMbDetail(target);
    } else {
      showMbCatalogView();
    }

    document.getElementById('mbDetailBack').onclick = () => {
      mbProgressState.activeMb = null;
      writeHashParam('mb', null);
      showMbCatalogView();
      renderMbCatalog();
    };

    const filter = document.getElementById('mbCatalogFilter');
    filter.oninput = renderMbCatalog;
  }

  function showMbCatalogView() {
    document.getElementById('mbProgressCatalog').style.display = '';
    document.getElementById('mbProgressDetail').style.display = 'none';
  }
  function showMbDetailView() {
    document.getElementById('mbProgressCatalog').style.display = 'none';
    document.getElementById('mbProgressDetail').style.display = '';
  }

  function renderMbCatalog() {
    const grid = document.getElementById('mbCatalogGrid');
    if (!grid) return;
    const q = (document.getElementById('mbCatalogFilter').value || '').trim().toLowerCase();
    const cards = (DATA.meritBadgeCatalog || [])
      .filter(mb => !q || mb.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));

    grid.innerHTML = cards.map(mb => {
      const progress = buildMbProgress(mb.id);
      const startedScouts = progress.started;
      const completedCount = startedScouts.filter(id => progress.byScout[id].award).length;
      const partialCount = startedScouts.length - completedCount;
      const hasProgress = startedScouts.length > 0;
      const eagleTag = mb.eagle ? '<span class="mb-eagle">Eagle</span>' : '';
      return `<div class="mb-catalog-card ${hasProgress ? 'has-progress' : 'empty-state'}" data-mb="${esc(mb.id)}">
        <div class="mb-name">${esc(mb.name)}${eagleTag}</div>
        <div class="mb-counts">
          <div class="mb-count completed"><strong>${completedCount}</strong><span>Completed</span></div>
          <div class="mb-count partial"><strong>${partialCount}</strong><span>In Progress</span></div>
          <div class="mb-count none"><strong>${DATA.scouts.filter(s => s.active).length - startedScouts.length}</strong><span>Not Started</span></div>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.mb-catalog-card').forEach(card => {
      card.addEventListener('click', () => openMbDetail(card.dataset.mb));
    });
  }

  function openMbDetail(mbId) {
    const mb = (DATA.meritBadgeCatalog || []).find(m => m.id === mbId);
    if (!mb) return;
    mbProgressState.activeMb = mbId;
    writeHashParam('mb', mbId);
    showMbDetailView();
    renderMbDetail(mb);
  }

  function renderMbDetail(mb) {
    const progress = buildMbProgress(mb.id);
    const startedScouts = progress.started
      .map(id => scoutById(id))
      .filter(Boolean)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const completedCount = startedScouts.filter(s => progress.byScout[s.id].award).length;
    const partialCount = startedScouts.length - completedCount;
    const totalActive = DATA.scouts.filter(s => s.active).length;
    const notStarted = totalActive - startedScouts.length;

    document.getElementById('mbDetailTitle').innerHTML = `${esc(mb.name)} ${mb.eagle ? '<span class="mb-eagle" style="vertical-align:6px;margin-left:6px;">Eagle</span>' : ''}`;
    document.getElementById('mbDetailSubtitle').innerHTML = `
      ${mb.scoutbookId ? `Scoutbook ID ${esc(mb.scoutbookId)} &nbsp;·&nbsp; ` : ''}
      <a href="${esc(bsaPageUrlFor(mb))}" target="_blank" rel="noopener" class="mb-extern-link">Official BSA page ↗</a>
      &nbsp;·&nbsp;
      <a href="${esc(workbookUrlFor(mb))}" target="_blank" rel="noopener" class="mb-extern-link">Workbook (PDF) ↗</a>
    `;

    document.getElementById('mbDetailStats').innerHTML = `
      <div class="ws-stat"><div class="ws-stat-label">Completed</div><div class="ws-stat-value" style="color:var(--admin-forest);">${completedCount}</div><div class="ws-stat-sub">earned the badge</div></div>
      <div class="ws-stat"><div class="ws-stat-label">In Progress</div><div class="ws-stat-value">${partialCount}</div><div class="ws-stat-sub">at least one requirement</div></div>
      <div class="ws-stat"><div class="ws-stat-label">Not Started</div><div class="ws-stat-value" style="color:var(--admin-gray-500);">${notStarted}</div><div class="ws-stat-sub">of ${totalActive} active scouts</div></div>
      <div class="ws-stat"><div class="ws-stat-label">Eagle Required</div><div class="ws-stat-value" style="color:${mb.eagle ? '#8a5a00' : 'var(--admin-gray-500)'};">${mb.eagle ? 'Yes' : 'No'}</div><div class="ws-stat-sub">&nbsp;</div></div>
    `;

    const authoredReqs = (DATA.meritBadgeRequirements || {})[mb.id];
    const leaves = authoredReqs ? flattenMbLeaves(authoredReqs) : [];

    // Compute group spans for the two-row header. A "group" is the top-level
    // requirement (1, 2, 3, …) and each leaf belongs to exactly one group.
    const groups = [];
    if (authoredReqs) {
      for (const top of authoredReqs) {
        const myLeaves = leaves.filter(l => topLevelOf(authoredReqs, l.code) === top.code);
        if (myLeaves.length > 0) groups.push({ top, leaves: myLeaves });
      }
    }
    const groupStartCodes = new Set(groups.map(g => g.leaves[0].code));

    // ── Grid header (two rows: groups + leaf codes)
    const head = document.getElementById('mbGridHead');
    const groupRow = `<tr>
      <th rowspan="2">Scout</th>
      ${groups.map(g => {
        const rule = optionalityLabel(g.top);
        return `<th class="group-col" colspan="${g.leaves.length}" title="Req ${esc(g.top.code)} — ${esc(g.top.label || '')}">
          Req ${esc(g.top.code)}${rule ? `<span class="group-rule">${esc(rule)}</span>` : ''}
        </th>`;
      }).join('')}
      <th class="award-col" rowspan="2" title="Full merit badge earned">AWARD</th>
    </tr>`;
    const leafRow = `<tr>
      ${leaves.map(l => `<th class="req-col${groupStartCodes.has(l.code) ? ' group-start' : ''}" title="${esc(l.code)} — ${esc(l.label || '')}">${esc(l.code)}</th>`).join('')}
    </tr>`;
    head.innerHTML = groupRow + leafRow;

    // ── Grid body
    const body = document.getElementById('mbGridBody');
    if (startedScouts.length === 0) {
      const cols = leaves.length + 2;
      body.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:22px;color:var(--admin-gray-500);font-style:italic;">No scouts have started this merit badge yet.</td></tr>`;
    } else {
      body.innerHTML = startedScouts.map(s => {
        const slot = progress.byScout[s.id];
        const rank = RANK_LABELS[s.currentRank];
        const cells = leaves.map(l => {
          const done = slot.reqCodes.has(l.code);
          return `<td class="mb-cell${done ? ' done' : ''}${groupStartCodes.has(l.code) ? ' group-start' : ''}" data-scout="${esc(s.id)}" data-mb="${esc(mb.id)}" data-req="${esc(l.code)}" title="${esc(s.displayName)} — ${esc(l.code)} — ${done ? 'completed (click to open Fast Entry)' : 'not yet (click to sign off)'}">${done ? '■' : '□'}</td>`;
        }).join('');
        const awardCell = `<td class="mb-cell award${slot.award ? ' done' : ''}" data-scout="${esc(s.id)}" data-mb="${esc(mb.id)}" data-req="__award" title="${esc(s.displayName)} — ${slot.award ? 'badge earned' : 'not yet awarded'}">${slot.award ? '★' : '☆'}</td>`;
        return `<tr>
          <td class="scout-name">${esc(s.displayName)} <span class="rk">${rank}</span></td>
          ${cells}
          ${awardCell}
        </tr>`;
      }).join('');
      body.querySelectorAll('.mb-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          const scoutId = cell.dataset.scout;
          const mbId = cell.dataset.mb;
          const req = cell.dataset.req;
          jumpToFastEntryForMb(scoutId, mbId, req);
        });
      });
    }

    // ── Requirements list below the grid (full hierarchy with optionality)
    const reqsList = document.getElementById('mbReqsList');
    const reqsSource = document.getElementById('mbReqsSource');
    if (authoredReqs) {
      reqsSource.textContent = '— from the official BSA pamphlet (paraphrased in prototype)';
      reqsList.innerHTML = `<div class="mb-reqs-list">${renderRequirementsTree(authoredReqs)}</div>`;
    } else {
      reqsSource.textContent = '';
      reqsList.innerHTML = `<div class="mb-reqs-empty">Official requirement list not yet authored for this badge in the prototype data. (Cooking, Camping, and Woodwork have full lists; others will be added.)</div>`;
    }
  }

  // Render the full requirement tree (parent → child → grandchild) for display
  // beneath the progress grid. Top-level requirements always render as bold
  // headings even when they have no children (e.g. Camping req 4 "Cooking and
  // food safety in camp" is a leaf in the data but a top-level requirement
  // visually). Each parent with optionality shows its rule annotation.
  function renderRequirementsTree(nodes, depth = 0) {
    return nodes.map(node => {
      const hasChildren = !!(node.children && node.children.length);
      const note = optionalityNote(node);
      const indent = depth * 18;
      if (!hasChildren && depth > 0) {
        return `<div class="mb-req-leaf" style="margin-left:${indent}px;">
          <span class="req-code-tag">${esc(node.code)}</span> ${esc(node.label || '')}
        </div>`;
      }
      return `<div class="mb-req-parent" style="margin-left:${indent}px;">
        <div class="mb-req-head">
          <span class="req-code-tag">${esc(node.code)}</span>${esc(node.label || '')}
        </div>
        ${note ? `<div class="mb-req-note">${esc(note)}</div>` : ''}
        ${hasChildren ? `<div class="mb-req-children">${renderRequirementsTree(node.children, depth + 1)}</div>` : ''}
      </div>`;
    }).join('');
  }

  function jumpToFastEntryForMb(scoutId, mbId, reqCode) {
    const navBtn = document.querySelector('.ws-nav-btn[data-screen="fast-entry"]');
    if (!navBtn) return;
    // Encode the prefill in the URL hash so a refresh/back-button keeps the context.
    const params = new URLSearchParams();
    params.set('scout', scoutId);
    params.set('mb', mbId);
    if (reqCode && reqCode !== '__award') params.set('req', reqCode);
    if (reqCode === '__award') params.set('req', 'award');
    window.location.hash = '#prefill?' + params.toString();
    navBtn.click();
    applyFastEntryPrefill();
  }

  // ── URL hash prefill ─────────────────────────────────────
  // We use the hash (#prefill?scout=…&mb=…&req=…) instead of search params so
  // these deep-links don't trigger a page reload and don't conflict with
  // anything the server might interpret.
  function readHashParam(name) {
    const h = window.location.hash || '';
    if (!h.startsWith('#prefill?')) return null;
    const params = new URLSearchParams(h.slice('#prefill?'.length));
    return params.get(name);
  }
  function writeHashParam(name, value) {
    const h = window.location.hash || '';
    let params;
    if (h.startsWith('#prefill?')) params = new URLSearchParams(h.slice('#prefill?'.length));
    else params = new URLSearchParams();
    if (value == null) params.delete(name);
    else params.set(name, value);
    const next = params.toString();
    window.location.hash = next ? '#prefill?' + next : '';
  }

  function applyFastEntryPrefill() {
    const scoutId = readHashParam('scout');
    const mbId = readHashParam('mb');
    const reqCode = readHashParam('req');
    // Only act if we have at least a scout — and only when navigating to Fast Entry.
    if (!scoutId) return;
    const fastEntry = document.getElementById('fast-entry');
    if (!fastEntry || !fastEntry.classList.contains('active')) return;

    // Set the scout, which triggers a picker re-mount with that scout's completion state.
    const scoutSel = document.getElementById('scoutFirstSel');
    if (scoutSel && scoutSel.value !== scoutId) {
      scoutSel.value = scoutId;
      scoutSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!mbId) return;
    // Open the MB tab and drill into the badge. We poke the picker via DOM
    // since its public API doesn't expose tab/drill control — same surface
    // the user would click.
    const pickerMount = document.getElementById('scoutFirstPicker');
    if (!pickerMount) return;
    const mbTab = Array.from(pickerMount.querySelectorAll('.req-picker-tab')).find(t => t.textContent.trim() === 'MBs');
    if (mbTab) mbTab.click();
    // After the click, the MB list is rendered; drill into the target badge.
    const openBtn = pickerMount.querySelector(`[data-open-mb="${mbId}"]`);
    if (openBtn) openBtn.click();
    // Optionally pre-mark the requirement as pending.
    if (reqCode && reqCode !== 'award') {
      const targetInput = pickerMount.querySelector(`input[data-row-toggle="mb:${mbId}:${reqCode}"]`);
      if (targetInput) {
        const label = targetInput.closest('label');
        // Only flip if not already completed — a completed click triggers the confirm prompt.
        if (label && !label.classList.contains('completed') && !label.classList.contains('pending')) {
          label.click();
        }
        if (label) label.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } else if (reqCode === 'award') {
      const awardInput = pickerMount.querySelector(`input[data-row-toggle="mb:${mbId}:award"]`);
      if (awardInput) {
        const label = awardInput.closest('label');
        if (label && !label.classList.contains('completed') && !label.classList.contains('pending')) {
          label.click();
        }
        if (label) label.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    // Clear the hash so a reload doesn't keep re-applying the prefill.
    // (We do this AFTER the picker has finished its async-y bits.)
    setTimeout(() => { window.location.hash = ''; }, 250);
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

  // Shared row HTML so the Universal Ledger and the Fast Entry audit tape
  // can't drift apart in column order / styling.
  function renderLedgerRowHTML(l) {
    const archived = !!l.archivedAt;
    const deleted  = !!l.deletedAt;
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
    `;
  }

  // Wire row actions (Edit / Archive / Delete / Restore) on any tbody that
  // contains rows rendered by renderLedgerRowHTML. Used by both the Universal
  // Ledger and the Fast Entry tape; afterChange is called after a mutation so
  // each view can re-render itself.
  function wireLedgerRowActions(tbody, afterChange) {
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
        renderFastEntryTape();
        afterChange && afterChange();
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
        renderFastEntryTape();
        afterChange && afterChange();
        toast('Entry restored', 'success');
      };
    });
    tbody.querySelectorAll('[data-delete]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.delete;
        const entry = ledger.find(l => l.id === id);
        if (!entry) return;
        const reason = prompt(`Delete ledger entry "${entry.label}" for ${scoutName(entry.scoutId)}?\n\nWhy is this entry being deleted? (e.g. duplicate, wrong scout, typo)\n\nThis entry will be hidden from the default view but recoverable via "Show hidden rows".`, '');
        if (reason === null) return;
        const r = reason.trim();
        if (!r) { toast('Delete cancelled — a reason is required', 'danger'); return; }
        entry.deletedAt = todayISO();
        entry.deletedBy = 'PB';
        entry.deletedReason = r;
        renderDashboard();
        renderLedger();
        renderFastEntryTape();
        // Picker views care about deletion too — they re-evaluate completion state.
        if (scoutFirstPicker) scoutFirstPicker.clear();
        renderReqFirstScoutGrid();
        afterChange && afterChange();
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
        renderFastEntryTape();
        if (scoutFirstPicker) scoutFirstPicker.clear();
        renderReqFirstScoutGrid();
        afterChange && afterChange();
        toast('Entry restored', 'success');
      };
    });
  }

  // Today's-entries audit tape under Fast Entry. Same row format as the
  // Universal Ledger; filtered to enteredAt === today and shown newest first.
  function renderFastEntryTape() {
    const tbody = document.getElementById('fastEntryTapeBody');
    if (!tbody) return;
    const today = todayISO();
    // ledger.unshift() puts new saves at the front, so natural array order =
    // newest first for the user's session. Any seed entry whose random
    // enteredAt happens to match today trails after — fine for the prototype.
    const todayRows = ledger.filter(l => l.enteredAt === today);
    const visible = todayRows.filter(l => !l.archivedAt && !l.deletedAt);

    document.getElementById('fastEntryTapeDate').textContent = '· ' + fmtDate(today);
    document.getElementById('fastEntryTapeMeta').textContent = visible.length === 0
      ? 'no entries yet today'
      : `${visible.length.toLocaleString()} ${visible.length === 1 ? 'entry' : 'entries'}`;

    if (visible.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:18px;color:var(--admin-gray-500);font-style:italic;">No entries yet today. Save above and they'll appear here.</td></tr>`;
      return;
    }
    tbody.innerHTML = visible.map(renderLedgerRowHTML).join('');
    wireLedgerRowActions(tbody);
  }

  function renderLedgerPage() {
    const tbody = document.getElementById('ledgerBody');
    const total = ledgerFiltered.length;
    const start = (ledgerView.page - 1) * ledgerView.perPage;
    const end = Math.min(start + ledgerView.perPage, total);
    const pageRows = ledgerFiltered.slice(start, end);

    tbody.innerHTML = total === 0
      ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--admin-gray-500);">No entries match the current filters.</td></tr>'
      : pageRows.map(renderLedgerRowHTML).join('');

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

    wireLedgerRowActions(tbody);
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
