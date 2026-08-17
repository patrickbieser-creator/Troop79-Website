/* ════════════════════════════════════════════════════════════════════
   WEEKLY ADVANCEMENT REPORT — sample data, consolidation logic, and
   renderers. Shared by admin.html, report.html, and archive.html.

   All scout names are FICTIONAL. Generated ledger volume is calibrated
   to the real production sample cited in Plans/Weekly-Advancement-Report.md:
   a 3-week post-Summer-Camp window logged 676 merit-badge-requirement
   entries, 107 rank-requirement entries, and 21 merit-badge-award entries.

   Everything here mirrors the plan's technical approach:
     - filters on entered_at, never date (see LEDGER entries below —
       most have date === entered_at, a handful deliberately don't)
     - consolidation is generalized from the weekly-scout-advancement-
       summary-for-bugle skill's "per rank" rule to "per rank OR per badge"
   ════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ── Seeded RNG (mulberry32) — deterministic across reloads ───────── */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFromString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
    return h;
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function weightedPick(rng, items) {
    // items: [{v, w}]
    const total = items.reduce((s, i) => s + i.w, 0);
    let r = rng() * total;
    for (const i of items) { if ((r -= i.w) <= 0) return i.v; }
    return items[items.length - 1].v;
  }

  /* ── Reference lists ───────────────────────────────────────────────── */
  const RANK_ORDER = ['Scout', 'Tenderfoot', 'Second Class', 'First Class', 'Star', 'Life', 'Eagle'];

  const SCOUTS = [
    'Aiden Brooks', 'Sofia Delgado', 'Marcus Whitfield', 'Priya Nair', 'Owen Callahan',
    'Anaya Thompson', 'Ezra Lindqvist', 'Chloe Marchetti', 'Jamal Ferris', 'Ruby Sokolov',
    'Diego Alvarez', 'Nora Kowalczyk', 'Theo Bergstrom', 'Amara Osei', 'Liam Fitzgerald',
    'Ines Rocha', 'Caleb Voss', 'Maya Petrov', 'Wyatt Donahue', 'Zara Hassan',
    'Beckett Lund', 'Freya Nilsen', 'Julian Ochoa', 'Ivy Sandoval', 'Miles Okafor',
    'Delaney Frost', 'Rowan Castellano', 'Nadia Wren',
  ];
  const LEADERS = ['Mrs. Weber', 'Mr. Kowalski', 'Mr. Odom'];

  // Roughly funnel-shaped rank distribution — most scouts cluster mid-ranks.
  const SCOUT_RANK = {};
  (function assignRanks() {
    const buckets = [
      ['Scout', 3], ['Tenderfoot', 4], ['Second Class', 5], ['First Class', 6],
      ['Star', 5], ['Life', 3], ['Eagle', 2],
    ];
    let i = 0;
    buckets.forEach(([rank, n]) => { for (let k = 0; k < n; k++) SCOUTS_slot(rank); });
    function SCOUTS_slot(rank) { SCOUT_RANK[SCOUTS[i]] = rank; i++; }
  })();

  const RANK_REQS = {
    'Scout': [
      ['1a', 'Buddy system'], ['1b', 'Scout Oath & Law meaning'], ['2a', 'Scout badge requirements'],
      ['3a', 'Physical fitness test'], ['4a', 'Digital safety pledge'], ['5a', 'Patrol method'],
      ['6a', 'Flag ceremony'], ['7a', 'Six essentials'], ['8a', 'Leave No Trace'], ['9a', 'Swim classification'],
    ],
    'Tenderfoot': [
      ['1a', 'Camping gear checklist'], ['1b', 'Tarp/tent pitch'], ['1c', 'Pack for Overnight Campout'],
      ['2a', 'Cooking gear care'], ['2b', 'Duty roster'], ['2c', 'Camp clean-up methods'],
      ['3a', 'Compass use'], ['3b', 'Map symbols'], ['4a', 'Nosebleed'], ['4b', 'Bites & stings'],
      ['4c', 'Choking'], ['5a', 'Fitness improvement plan'], ['6a', 'Flag folding'], ['7a', 'Patrol identity'],
    ],
    'Second Class': [
      ['1a', 'Ten troop/patrol activities'], ['1b', 'Assist campout duty roster'], ['2a', 'Knife, saw & ax'],
      ['2b', 'Fire safety'], ['2c', 'Meal Prep on Campout'], ['2d', 'Camp gadget'], ['3a', '5-mile hike'],
      ['3b', 'Compass/map 5-mile hike'], ['4a', 'Woods tools'], ['5a', 'Swim 100 yards'],
      ['5b', 'Water rescue methods'], ['6a', 'Heart Attack & CPR'], ['6b', 'Closed wounds (bruise, hematoma)'],
      ['6c', 'Bandaging'], ['7a', 'Public health basics'], ['8a', 'Digital citizenship'], ['9a', 'Scoutmaster Conference'],
    ],
    'First Class': [
      ['1a', 'Ten more troop activities'], ['1b', 'Lead a campout activity'], ['2a', 'Menu planning'],
      ['2b', 'Food budget'], ['2c', 'Cooking gear'], ['3a', 'Timber hitch & clove hitch'],
      ['3b', 'Lashings project'], ['4a', 'Orienteering course'], ['4b', 'Trail signs'],
      ['5a', 'Aquatics skill'], ['6a', 'Rescue breathing'], ['6b', 'Poisoning response'],
      ['7a', 'First aid kit contents'], ['8a', 'Eating Together as Patrol'], ['9a', 'Visit a Civic Leader'],
      ['9b', 'Environmental issue project'], ['10a', 'Scout Spirit & References'],
      ['11a', 'Scoutmaster Conference'], ['12a', 'Board of Review'],
    ],
    'Star': [
      ['1a', '4 Months Active as First Class'], ['2a', 'Merit badge count'], ['3a', 'Position of Responsibility'],
      ['4a', 'Service project (6 hrs)'], ['5a', 'Scout Spirit & References'], ['6a', 'Scoutmaster Conference'],
      ['7a', 'Board of Review'],
    ],
    'Life': [
      ['1a', '6 Months Active as Life'], ['2a', 'Merit badge count'], ['3a', 'Position of Responsibility'],
      ['4a', 'Service project (6 hrs)'], ['5a', 'Scout Spirit & References'], ['6a', 'Scoutmaster Conference'],
      ['7a', 'Board of Review'],
    ],
    'Eagle': [
      ['1a', '6 Months Active as Life'], ['2a', 'Eagle-required badge count'], ['3a', 'Position of Responsibility'],
      ['4a', 'Service Project Leadership'], ['5a', 'Scout Spirit & References'], ['6a', 'Scoutmaster Conference'],
      ['7a', 'Board of Review'],
    ],
  };

  const GENERIC_MB_REQS = [
    ['1', 'Explain safety rules'], ['2', 'Show proper technique'], ['3', 'Identify local hazards'],
    ['4', 'Complete a service project'], ['5', 'Keep a log for one month'], ['6', 'Explain career opportunities'],
    ['7', 'Discuss with your counselor'], ['8', 'Demonstrate the skill'], ['9', 'Explain the history'],
  ];
  const MB_REQS = {
    'Swimming': [['1', 'Swim classification test'], ['2', '100-yard swim'], ['3', 'Survival float'], ['4', 'Rescue methods'], ['5', 'Diving entry'], ['6', 'Sculling']],
    'Canoeing': [['1', 'Capsize & re-enter'], ['2', 'J-stroke'], ['3', 'Portage a canoe'], ['4', 'Rescue a capsized canoer']],
    'Climbing': [['1', 'Belay commands'], ['2', 'Tie a figure-eight'], ['3', 'Rappel safely'], ['4', 'Knot inspection']],
    'Camping': [['1', 'Pack for Overnight Campout'], ['2', '20 Nights Camping Log'], ['3', 'Cooking gear care'], ['4', 'Leave No Trace']],
    'Cooking': [['1', 'Menu planning'], ['2', 'Food budget'], ['3', 'Meal Prep on Campout'], ['4', 'Camp stove safety'], ['5', 'Dutch oven cooking']],
    'Wilderness Survival': [['1', 'Build a shelter'], ['2', 'Signal for help'], ['3', 'Survival kit contents'], ['4', 'Overnight survival experience']],
    'Fishing': [['1', 'Cast accurately'], ['2', 'Identify local fish'], ['3', 'Clean & cook a catch'], ['4', 'Knot: improved clinch']],
    'Environmental Science': [['1', 'Water quality test'], ['2', 'Air pollution project'], ['3', 'Ecology field study'], ['4', 'ID native plants']],
    'First Aid': [['1', 'Nosebleed'], ['2', 'Closed wounds (bruise, hematoma)'], ['3', 'Bites & stings'], ['4', 'Heart Attack & CPR'], ['5', 'Splinting a fracture']],
    'Lifesaving': [['1', 'Reaching rescue'], ['2', 'Throwing rescue'], ['3', 'Tow a swimmer'], ['4', 'Release from a grip']],
    'Emergency Preparedness': [['1', 'Family emergency plan'], ['2', '72-hour kit'], ['3', 'Community drill participation']],
    'Archery': [['1', 'Range safety rules'], ['2', 'Shooting form'], ['3', 'Bow maintenance']],
  };
  const HOT_BADGES = Object.keys(MB_REQS); // summer-camp-heavy badges
  const EAGLE_BADGES = new Set([
    'Swimming', 'Camping', 'Cooking', 'Environmental Science', 'First Aid', 'Emergency Preparedness',
    'Citizenship in the Community', 'Citizenship in the Nation', 'Citizenship in the World',
    'Personal Fitness', 'Personal Management', 'Family Life', 'Communication',
  ]);
  const LONGTAIL_BADGES = [
    'Citizenship in the Community', 'Citizenship in the Nation', 'Citizenship in the World',
    'Personal Fitness', 'Personal Management', 'Family Life', 'Communication', 'Cycling',
    'Photography', 'Robotics', 'Chess', 'Weather', 'Space Exploration', 'Leatherwork',
    'Basketry', 'Wood Carving', 'Music', 'Art',
  ];
  const ALL_BADGES = HOT_BADGES.concat(LONGTAIL_BADGES);

  const LEADERSHIP_ROLES = [
    'Patrol Leader', 'Senior Patrol Leader', 'Assistant Senior Patrol Leader', 'Scribe',
    'Quartermaster', 'Historian', 'Chaplain Aide', 'Instructor', 'Den Chief', 'Librarian',
  ];
  const OTHER_AWARDS = [
    "Totin' Chip", "Firem'n Chit", 'Paul Bunyan Woodsman', 'National Outdoor Award — Aquatics',
    'Mile Swim BSA', '50-Miler Award',
  ];
  const LOGISTICS_KINDS = [
    { kind: 'service_hours', label: n => `${n} hours — Food pantry sort` },
    { kind: 'camping_nights', label: n => `${n} nights — Summer Camp` },
    { kind: 'hiking_miles', label: n => `${n} miles — Compass hike` },
  ];

  /* ── sort helper matching the skill's numeric+letter req-code sort ── */
  function sortKey(code) {
    const m = /^(\d+)([a-z]?)$/i.exec(String(code));
    return m ? [parseInt(m[1], 10), m[2] || ''] : [999, ''];
  }
  function cmpCode(a, b) {
    const [an, al] = sortKey(a), [bn, bl] = sortKey(b);
    return an !== bn ? an - bn : al.localeCompare(bl);
  }

  function dateStr(d) { return d.toISOString().slice(0, 10); }
  function addDays(dateStr0, n) {
    const d = new Date(dateStr0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dateStr(d);
  }
  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtDateLong(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  /* ── Ledger entry generator ────────────────────────────────────────
     Produces raw rows shaped like ledger_entries: { kind, scout, code,
     label, group (rank or badge name), eagle, entered_at, date, by }.
     `date` differs from `entered_at` only for a handful of entries, to
     demonstrate the entered_at-filtering rule concretely.                */
  function genLedger(opts) {
    const rng = mulberry32(seedFromString(opts.seedKey));
    const rows = [];
    const usedRankReq = new Set();
    const usedBadgeReq = new Set();

    function addRankReq(n, rankWeights, hotFraction) {
      let guard = 0;
      let made = 0;
      while (made < n && guard < n * 40) {
        guard++;
        const rank = weightedPick(rng, rankWeights);
        const pool = RANK_REQS[rank]; if (!pool || !pool.length) continue;
        const hotCut = Math.max(1, Math.floor(pool.length * hotFraction));
        const useHot = rng() < 0.72;
        const item = useHot ? pick(rng, pool.slice(0, hotCut)) : pick(rng, pool);
        const scout = pick(rng, SCOUTS.filter(s => SCOUT_RANK[s] === rank || RANK_ORDER.indexOf(SCOUT_RANK[s]) === RANK_ORDER.indexOf(rank) - 1));
        if (!scout) continue;
        const key = scout + '|' + rank + '|' + item[0];
        if (usedRankReq.has(key)) continue;
        usedRankReq.add(key);
        rows.push(mkEntry('rank_requirement', scout, item[0], item[1], rank, false));
        made++;
      }
    }
    function addBadgeReq(n, badgeWeights, hotFraction) {
      let guard = 0; let made = 0;
      while (made < n && guard < n * 40) {
        guard++;
        const badge = weightedPick(rng, badgeWeights);
        const pool = MB_REQS[badge] || GENERIC_MB_REQS;
        const hotCut = Math.max(1, Math.floor(pool.length * hotFraction));
        const useHot = rng() < 0.72;
        const item = useHot ? pick(rng, pool.slice(0, hotCut)) : pick(rng, pool);
        const scout = pick(rng, SCOUTS);
        const key = scout + '|' + badge + '|' + item[0];
        if (usedBadgeReq.has(key)) continue;
        usedBadgeReq.add(key);
        rows.push(mkEntry('merit_badge_requirement', scout, item[0], item[1], badge, EAGLE_BADGES.has(badge)));
        made++;
      }
    }
    function mkEntry(kind, scout, code, label, group, eagle) {
      const entered = pick(rng, opts.dateWindow);
      return { kind, scout, code, label, group, eagle, entered_at: entered, date: entered, by: pick(rng, LEADERS) };
    }

    // Rank requirements — weighted toward the mid ranks (matches troop shape)
    addRankReq(opts.rankReqCount, [
      { v: 'Scout', w: 4 }, { v: 'Tenderfoot', w: 10 }, { v: 'Second Class', w: 24 },
      { v: 'First Class', w: 28 }, { v: 'Star', w: 18 }, { v: 'Life', w: 10 }, { v: 'Eagle', w: 6 },
    ], 0.45);

    // Merit badge requirements — weighted toward summer-camp badges
    const badgeWeights = ALL_BADGES.map(b => ({ v: b, w: HOT_BADGES.includes(b) ? 9 : 1 }));
    addBadgeReq(opts.mbReqCount, badgeWeights, 0.5);

    // Merit badges earned
    for (let i = 0; i < opts.mbAwardCount; i++) {
      const badge = weightedPick(rng, badgeWeights);
      const scout = pick(rng, SCOUTS);
      const entered = pick(rng, opts.dateWindow);
      rows.push({ kind: 'merit_badge_award', scout, group: badge, eagle: EAGLE_BADGES.has(badge), entered_at: entered, date: entered, by: pick(rng, LEADERS) });
    }
    // Ranks earned
    const rankAwardPool = RANK_ORDER.slice(1); // Tenderfoot..Eagle (Scout is a checklist join, not a BoR award)
    for (let i = 0; i < opts.rankAwardCount; i++) {
      const rank = pick(rng, rankAwardPool);
      const scout = pick(rng, SCOUTS);
      const entered = pick(rng, opts.dateWindow);
      rows.push({ kind: 'rank_award', scout, group: rank, entered_at: entered, date: entered, by: pick(rng, LEADERS) });
    }
    // Leadership
    for (let i = 0; i < opts.leadershipCount; i++) {
      const role = pick(rng, LEADERSHIP_ROLES);
      const scout = pick(rng, SCOUTS);
      const entered = pick(rng, opts.dateWindow);
      rows.push({ kind: 'leadership', scout, group: role, entered_at: entered, date: entered, by: pick(rng, LEADERS) });
    }
    // Other awards (Totin' Chip etc.)
    for (let i = 0; i < opts.otherCount; i++) {
      const desc = pick(rng, OTHER_AWARDS);
      const scout = pick(rng, SCOUTS);
      const entered = pick(rng, opts.dateWindow);
      rows.push({ kind: 'award', scout, group: desc, entered_at: entered, date: entered, by: pick(rng, LEADERS) });
    }
    // Logistics (service hours / camping nights / hiking miles) — gated behind
    // a prototype toggle on the consuming page, see Open Question in the plan.
    for (let i = 0; i < opts.logisticsCount; i++) {
      const spec = pick(rng, LOGISTICS_KINDS);
      const scout = pick(rng, SCOUTS);
      const entered = pick(rng, opts.dateWindow);
      const n = 2 + Math.floor(rng() * 5);
      rows.push({ kind: spec.kind, scout, group: spec.label(n), entered_at: entered, date: entered, by: pick(rng, LEADERS) });
    }

    return rows;
  }

  /* ── Scenario definitions ──────────────────────────────────────────
     HEAVY mirrors the real post-Summer-Camp sample cited in the plan.
     "today" is pinned to 2026-08-17 to match this session's actual date,
     so "default range = last published end date -> today" reads naturally. */
  const TODAY = '2026-08-17';

  function windowDates(start, end) {
    const out = []; let d = start;
    while (d <= end) { out.push(d); d = addDays(d, 1); }
    return out;
  }

  const SCENARIOS = {
    heavy: {
      key: 'heavy',
      label: 'Heavy week (post–Summer Camp)',
      lastPublishedEnd: '2026-07-27',
      today: TODAY,
      dateWindow: windowDates('2026-07-28', TODAY),
      rankReqCount: 112,
      mbReqCount: 681,
      mbAwardCount: 21,
      rankAwardCount: 4,
      leadershipCount: 9,
      otherCount: 6,
      logisticsCount: 46,
    },
    light: {
      key: 'light',
      label: 'Normal week',
      lastPublishedEnd: '2026-08-10',
      today: TODAY,
      dateWindow: windowDates('2026-08-11', TODAY),
      rankReqCount: 7,
      mbReqCount: 11,
      mbAwardCount: 2,
      rankAwardCount: 0,
      leadershipCount: 1,
      otherCount: 1,
      logisticsCount: 3,
    },
    empty: {
      key: 'empty',
      label: 'Quiet week (nothing to report)',
      lastPublishedEnd: '2026-08-16',
      today: TODAY,
      dateWindow: windowDates('2026-08-16', TODAY), // single day, deliberately no entries land here
      rankReqCount: 0, mbReqCount: 0, mbAwardCount: 0, rankAwardCount: 0, leadershipCount: 0, otherCount: 0, logisticsCount: 0,
    },
    // ── Canned historical reports (already "published", not selectable in
    // the admin scenario switcher) — back this session's history strip,
    // the archive listing, and permalinks with real, re-derivable content
    // instead of static screenshots.
    hist1: {
      key: 'hist1', historical: true, label: 'Jun 22 – Jul 6, 2026',
      startDate: '2026-06-22', endDate: '2026-07-06',
      publishedAt: '2026-07-07T14:20:00', generatedBy: 'Mrs. Weber', note: '',
      dateWindow: windowDates('2026-06-22', '2026-07-06'),
      rankReqCount: 14, mbReqCount: 22, mbAwardCount: 3, rankAwardCount: 2, leadershipCount: 2, otherCount: 1, logisticsCount: 4,
    },
    hist2: {
      key: 'hist2', historical: true, label: 'Jul 7 – Jul 27, 2026 (Summer Camp travel week)',
      startDate: '2026-07-07', endDate: '2026-07-27',
      publishedAt: '2026-07-28T09:05:00', generatedBy: 'Mr. Kowalski',
      note: 'Light week — most of the troop was traveling to and from Summer Camp. Sign-offs from camp itself land in next week’s report once staff cards are transcribed.',
      dateWindow: windowDates('2026-07-07', '2026-07-27'),
      rankReqCount: 4, mbReqCount: 2, mbAwardCount: 1, rankAwardCount: 0, leadershipCount: 1, otherCount: 0, logisticsCount: 2,
    },
  };
  const HISTORICAL_IDS = ['hist1', 'hist2'];

  /* ── Publish / archive persistence (localStorage) ──────────────────
     Lets a Publish click in admin.html actually show up on report.html /
     archive.html in this browser — makes the draft→published loop feel
     real across the two surfaces instead of two disconnected mockups. */
  const LS_LATEST = 't79adv_latest_v1';
  const LS_ARCHIVE = 't79adv_archive_v1';

  function readLS(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function writeLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

  function publishToArchive(meta, report, markdown) {
    const id = 'live-' + Date.now();
    const record = { id, meta: Object.assign({}, meta), report, markdown };
    const archive = readLS(LS_ARCHIVE, []);
    archive.push(record);
    writeLS(LS_ARCHIVE, archive);
    writeLS(LS_LATEST, record);
    return record;
  }
  function updateLiveRecord(id, meta, report, markdown) {
    const archive = readLS(LS_ARCHIVE, []);
    const idx = archive.findIndex(r => r.id === id);
    const record = { id, meta: Object.assign({}, meta), report, markdown };
    if (idx > -1) archive[idx] = record; else archive.push(record);
    writeLS(LS_ARCHIVE, archive);
    const latest = readLS(LS_LATEST, null);
    if (latest && latest.id === id) writeLS(LS_LATEST, record);
    return record;
  }
  function unpublishLive(id) {
    const archive = readLS(LS_ARCHIVE, []).filter(r => r.id !== id);
    writeLS(LS_ARCHIVE, archive);
    const latest = readLS(LS_LATEST, null);
    if (latest && latest.id === id) writeLS(LS_LATEST, archive.length ? archive[archive.length - 1] : null);
  }
  function getLiveArchive() { return readLS(LS_ARCHIVE, []); }
  function getLiveLatest() { return readLS(LS_LATEST, null); }

  function buildHistoricalRecord(histKey) {
    const sc = SCENARIOS[histKey];
    const { rows } = buildLedger(histKey);
    const meta = { startDate: sc.startDate, endDate: sc.endDate, status: 'published', publishedAt: sc.publishedAt, generatedBy: sc.generatedBy, note: sc.note };
    const report = buildReport(rows);
    const markdown = toMarkdown(report, meta);
    return { id: histKey, meta, report, markdown };
  }

  // Full archive list = canned historical + anything published this
  // session, newest first.
  function listArchive() {
    const canned = HISTORICAL_IDS.map(buildHistoricalRecord);
    const live = getLiveArchive();
    return canned.concat(live).sort((a, b) => (a.meta.endDate < b.meta.endDate ? 1 : -1));
  }
  function getPublishedById(id) {
    if (HISTORICAL_IDS.includes(id)) return buildHistoricalRecord(id);
    return getLiveArchive().find(r => r.id === id) || null;
  }
  function getLatestPublished() {
    const live = getLiveLatest();
    if (live) return live;
    // Fall back to the newest canned historical report so report.html
    // has something real to show before admin.html has ever published.
    return buildHistoricalRecord('hist2');
  }

  // The "late correction" example entry: earned during Summer Camp (three
  // weeks before entered), but entered_at falls inside the heavy window —
  // demonstrating why every query filters on entered_at, never date. Its
  // earned date (Jul 22) is also BEFORE the heavy report's start (Jul 28),
  // so per Decision #4 it's exactly the case that should show a date.
  const LATE_ENTRY_EXAMPLE = {
    kind: 'rank_requirement', scout: 'Ines Rocha', code: '9a', label: 'Visit a Civic Leader',
    group: 'First Class', eagle: false, entered_at: TODAY, date: '2026-07-22', by: 'Mrs. Weber',
    isLateExample: true,
  };
  // The "backfilled credit" example: Patrick's own motivating case for
  // Decision #4 — a scout given credit for something completed over a
  // year ago (transfer credit / prior experience), recorded this week.
  const BACKFILL_EXAMPLE = {
    kind: 'merit_badge_requirement', scout: 'Marcus Whitfield', code: '1', label: 'Pack for Overnight Campout',
    group: 'Camping', eagle: true, entered_at: TODAY, date: '2025-06-02', by: 'Mr. Odom',
    isBackfillExample: true,
  };

  function buildLedger(scenarioKey) {
    const sc = SCENARIOS[scenarioKey];
    let rows = genLedger({ seedKey: 'troop79-' + scenarioKey, ...sc });
    if (scenarioKey === 'heavy') {
      // Guarantee the two hand-authored examples always win their exact
      // (scout, group, code) slot — consolidateGroup keeps the FIRST entry
      // it sees per scout+code, so a random collision here would otherwise
      // silently swallow the example. Strip any accidental collision first.
      const examples = [LATE_ENTRY_EXAMPLE, BACKFILL_EXAMPLE];
      const exampleKeys = new Set(examples.map(e => e.scout + '|' + e.group + '|' + (e.code || '')));
      rows = rows.filter(r => !exampleKeys.has(r.scout + '|' + r.group + '|' + (r.code || '')));
      rows = rows.concat(examples);
    }
    return { scenario: sc, rows };
  }

  /* ── Filtering (entered_at only, inclusive) + consolidation ───────── */
  function filterByEnteredAt(rows, start, end) {
    return rows.filter(r => r.entered_at >= start && r.entered_at <= end);
  }

  // Generalized consolidation — "per rank OR per badge", per the plan.
  // groupRows: entries that share one rank or one badge (already filtered
  // to kind === rank_requirement or merit_badge_requirement).
  function consolidateGroup(groupRows) {
    const byCode = new Map(); // code -> { label, scouts: Set, entriesByScout: Map }
    groupRows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, { label: r.label, scouts: new Map() });
      const g = byCode.get(r.code);
      if (!g.scouts.has(r.scout)) g.scouts.set(r.scout, r); // de-dupe same scout+req
    });
    const codes = Array.from(byCode.keys()).sort(cmpCode);

    const sharedLines = [];
    const soloByScout = new Map(); // scout -> [{code,label,entry}]
    codes.forEach(code => {
      const g = byCode.get(code);
      const scoutNames = Array.from(g.scouts.keys()).sort();
      if (scoutNames.length > 1) {
        sharedLines.push({ codes: [code], labels: [g.label], scouts: scoutNames, entries: scoutNames.map(s => g.scouts.get(s)) });
      } else {
        const s = scoutNames[0];
        if (!soloByScout.has(s)) soloByScout.set(s, []);
        soloByScout.get(s).push({ code, label: g.label, entry: g.scouts.get(s) });
      }
    });

    const singleSoloLines = [];
    const consolidatedLines = [];
    Array.from(soloByScout.keys()).sort().forEach(scout => {
      const items = soloByScout.get(scout).sort((a, b) => cmpCode(a.code, b.code));
      if (items.length === 1) {
        singleSoloLines.push({ codes: [items[0].code], labels: [items[0].label], scouts: [scout], entries: [items[0].entry] });
      } else {
        consolidatedLines.push({
          codes: items.map(i => i.code), labels: items.map(i => i.label), scouts: [scout],
          entries: items.map(i => i.entry),
        });
      }
    });

    return sharedLines.concat(singleSoloLines, consolidatedLines);
  }

  /* ── Build the full report content model from filtered rows ───────── */
  // Section 5 scope per Decision #3 (2026-08-17): leadership, award, AND
  // logistics kinds (service_hours / camping_nights / hiking_miles) — no
  // longer a togglable choice, this is the permanent kind list.
  const SECTION5_LOGISTICS_KINDS = ['service_hours', 'camping_nights', 'hiking_miles'];

  function buildReport(rows) {
    const ranksEarned = groupAward(rows.filter(r => r.kind === 'rank_award'), r => r.group, RANK_ORDER);
    const badgesEarned = groupAward(rows.filter(r => r.kind === 'merit_badge_award'), r => r.group, null, true);

    const rankReqRows = rows.filter(r => r.kind === 'rank_requirement');
    const rankReqs = RANK_ORDER.map(rank => {
      const lines = consolidateGroup(rankReqRows.filter(r => r.group === rank));
      return { rank, lines };
    }).filter(g => g.lines.length);

    const badgeReqRows = rows.filter(r => r.kind === 'merit_badge_requirement');
    const badgesWithReqs = Array.from(new Set(badgeReqRows.map(r => r.group))).sort();
    const badgeReqs = badgesWithReqs.map(badge => ({
      badge, eagle: EAGLE_BADGES.has(badge), lines: consolidateGroup(badgeReqRows.filter(r => r.group === badge)),
    }));

    const leadership = groupAward(rows.filter(r => r.kind === 'leadership'), r => r.group, null);
    const logisticsRows = rows.filter(r => SECTION5_LOGISTICS_KINDS.includes(r.kind));
    let otherAwards = groupAward(rows.filter(r => r.kind === 'award'), r => r.group, null)
      .concat(groupAward(logisticsRows, r => r.group, null));
    otherAwards.sort((a, b) => a.name.localeCompare(b.name));

    const counts = {
      mbReq: badgeReqRows.length, rankReq: rankReqRows.length,
      mbAward: rows.filter(r => r.kind === 'merit_badge_award').length,
      rankAward: rows.filter(r => r.kind === 'rank_award').length,
      leadership: rows.filter(r => r.kind === 'leadership').length,
      other: rows.filter(r => r.kind === 'award').length + logisticsRows.length,
      total: rows.length,
    };

    return { ranksEarned, badgesEarned, rankReqs, badgeReqs, leadership, otherAwards, counts, isEmpty: rows.length === 0 };
  }

  function groupAward(rows, keyFn, order, tagEagle) {
    const map = new Map();
    rows.forEach(r => {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, { name: k, eagle: tagEagle ? !!r.eagle : false, scouts: new Map() });
      map.get(k).scouts.set(r.scout, r);
    });
    let names = Array.from(map.keys());
    names = order ? order.filter(n => map.has(n)) : names.sort();
    return names.map(n => {
      const g = map.get(n);
      const scoutNames = Array.from(g.scouts.keys()).sort();
      return { name: n, eagle: g.eagle, scouts: scoutNames, entries: scoutNames.map(s => g.scouts.get(s)) };
    });
  }

  /* ── Per-entry date display rule (Decision #4, 2026-08-17) ─────────
     NOT a toggle. Show the earned date on a line ONLY when it falls
     outside the report's own start/end range — i.e. a backfilled
     correction or credit for something completed long before this
     report period. Everything earned inside the period (the vast
     majority of lines) stays date-free, matching the skill's style. ── */
  function datesOutOfRange(entries, meta) {
    const out = [];
    (entries || []).forEach(e => {
      if (e && e.date && (e.date < meta.startDate || e.date > meta.endDate)) {
        const label = fmtDateLong(e.date);
        if (out.indexOf(label) === -1) out.push(label);
      }
    });
    return out;
  }
  // A "line" (requirement line) has scouts[] and entries[] that are only
  // 1:1-aligned for shared/single-solo lines. A consolidated line (one
  // scout, several joined codes) has one scout but one entry per code —
  // this resolves the right entry subset for a given scout slot either way.
  function entriesForScoutSlot(line, scoutIdx) {
    if (line.scouts.length === line.entries.length) return [line.entries[scoutIdx]];
    return line.entries; // consolidated: all entries belong to the sole scout
  }

  /* ── Markdown rendering (the single source for preview + export) ──── */
  function scoutLineMd(scout, entry, meta) {
    const out = datesOutOfRange([entry], meta);
    return out.length ? `  - ${scout} *(earned ${out[0]})*` : `  - ${scout}`;
  }
  function reqScoutLineMd(scout, entries, meta) {
    const out = datesOutOfRange(entries, meta);
    return out.length ? `  - ${scout} *(earned ${out.join(', ')})*` : `  - ${scout}`;
  }

  function toMarkdown(report, meta) {
    const lines = [];
    const rangeLabel = `${fmtDateLong(meta.startDate)} – ${fmtDateLong(meta.endDate)}`;
    lines.push(`# Weekly Advancement Report`);
    lines.push(`*${rangeLabel}*`);
    if (meta.note) { lines.push(''); lines.push(`> ${meta.note}`); }

    if (report.isEmpty) {
      lines.push('');
      lines.push('No advancement was logged in this date range.');
      return lines.join('\n') + '\n';
    }

    function awardSection(title, groups) {
      if (!groups.length) return;
      lines.push(''); lines.push(`## ${title}`);
      groups.forEach(g => {
        lines.push(`- **${g.name}**${g.eagle ? ' *(Eagle-required)*' : ''}`);
        g.scouts.forEach((s, i) => lines.push(scoutLineMd(s, g.entries[i], meta)));
      });
    }
    function reqLineMd(line) {
      const head = line.codes.length > 1
        ? `${line.codes.join(', ')}** — ${line.labels.join(', ')}`
        : `${line.codes[0]}** — ${line.labels[0]}`;
      lines.push(`- **${head}`);
      line.scouts.forEach((s, i) => lines.push(reqScoutLineMd(s, entriesForScoutSlot(line, i), meta)));
    }

    awardSection('Ranks Earned', report.ranksEarned);
    awardSection('Merit Badges Earned', report.badgesEarned);

    if (report.rankReqs.length) {
      lines.push(''); lines.push(`## Rank Requirements Completed`);
      report.rankReqs.forEach(g => {
        lines.push(`_${g.rank}_`);
        g.lines.forEach(reqLineMd);
      });
    }
    if (report.badgeReqs.length) {
      lines.push(''); lines.push(`## Merit Badge Requirements Completed`);
      report.badgeReqs.forEach(g => {
        lines.push(`_${g.badge}${g.eagle ? ' (Eagle-required)' : ''}_`);
        g.lines.forEach(reqLineMd);
      });
    }
    if (report.leadership.length || report.otherAwards.length) {
      lines.push(''); lines.push(`## Leadership & Other`);
      if (report.leadership.length) {
        lines.push('**Leadership**');
        report.leadership.forEach(g => {
          lines.push(`- **${g.name}**`);
          g.scouts.forEach((s, i) => lines.push(scoutLineMd(s, g.entries[i], meta)));
        });
      }
      if (report.otherAwards.length) {
        lines.push('**Other**');
        report.otherAwards.forEach(g => {
          lines.push(`- **${g.name}**`);
          g.scouts.forEach((s, i) => lines.push(scoutLineMd(s, g.entries[i], meta)));
        });
      }
    }
    return lines.join('\n') + '\n';
  }

  /* ── Styled HTML rendering (drives both the admin preview and the
     public page — same content model, editable flag toggles the
     inline-edit affordances). ─────────────────────────────────────── */
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function scoutLiHtml(scout, entries, meta, editable, onRemoveAttr) {
    const out = datesOutOfRange(entries, meta);
    const dateBit = out.length ? `<span class="entryDate">earned ${esc(out.join(', '))}</span>` : '';
    const nameSpan = editable ? `<span contenteditable="true" data-scout-name>${esc(scout)}</span>` : esc(scout);
    const removeBtn = editable ? `<button type="button" class="scoutRemove" ${onRemoveAttr}>Remove</button>` : '';
    return `<li>${nameSpan}${dateBit}${removeBtn}</li>`;
  }

  function renderAwardGroupHtml(g, meta, editable) {
    const items = g.scouts.map((s, i) => scoutLiHtml(s, [g.entries[i]], meta, editable, `data-remove-scout="${esc(s)}" data-remove-group="${esc(g.name)}"`)).join('');
    return `<div class="awardGroup" data-group="${esc(g.name)}">
      <div class="agName">${esc(g.name)}${g.eagle ? '<span class="eagleDot">&#9733; EAGLE</span>' : ''}</div>
      <ul class="agScouts">${items}</ul>
    </div>`;
  }

  function renderReqLineHtml(line, meta, editable, groupKey) {
    const codeTags = line.codes.map(c => `<span class="reqTag reqTag--ghost">${esc(c)}</span>`).join(' ');
    const labelText = line.labels.join(', ');
    const lineKey = line.codes.join(',');
    const labelEl = editable
      ? `<span class="rlLabels" contenteditable="true" data-line-label data-group="${esc(groupKey)}" data-line="${esc(lineKey)}">${esc(labelText)}</span>`
      : `<span class="rlLabels">${esc(labelText)}</span>`;
    const items = line.scouts.map((s, i) => scoutLiHtml(s, entriesForScoutSlot(line, i), meta, editable, `data-remove-scout="${esc(s)}" data-remove-line="${esc(lineKey)}" data-remove-group="${esc(groupKey)}"`)).join('');
    return `<div class="reqLine ${editable ? 'isEditable' : ''}" data-line="${esc(lineKey)}" data-group="${esc(groupKey)}">
      <div class="rlHead">${codeTags}${labelEl}</div>
      <ul class="rlScouts">${items}</ul>
    </div>`;
  }

  function renderReportHtml(report, meta, opts) {
    opts = opts || {};
    const editable = !!opts.editable;
    let html = '';

    if (meta.note) {
      html += `<div class="editorNoteRead"><strong>Editor&rsquo;s note</strong>${esc(meta.note)}</div>`;
    }

    if (report.isEmpty) {
      html += `<div class="emptyState">
        <span class="esIcon" aria-hidden="true">🌤</span>
        <h3>No advancement to report this week</h3>
        <p>Nothing was logged with an entry date in this range. That&rsquo;s normal for an off week —
        no meeting, a holiday break, or everyone mid-project. Check back after the next sign-off.</p>
      </div>`;
      return html;
    }

    function section(title, bodyHtml) {
      if (!bodyHtml) return '';
      return `<div class="sectionDivider"><span class="divLabel">${esc(title)}</span><span class="divRule"></span></div>${bodyHtml}`;
    }

    if (report.ranksEarned.length) {
      html += section('Ranks Earned', report.ranksEarned.map(g => renderAwardGroupHtml(g, meta, editable)).join(''));
    }
    if (report.badgesEarned.length) {
      html += section('Merit Badges Earned', report.badgesEarned.map(g => renderAwardGroupHtml(g, meta, editable)).join(''));
    }
    if (report.rankReqs.length) {
      const body = report.rankReqs.map(g => `
        <div class="rankGroupTitle">${esc(g.rank)} <span class="rgCount">${g.lines.reduce((n, l) => n + l.scouts.length, 0)} sign-off${g.lines.length === 1 && g.lines[0].scouts.length === 1 ? '' : 's'}</span></div>
        ${g.lines.map(l => renderReqLineHtml(l, meta, editable, g.rank)).join('')}`).join('');
      html += section('Rank Requirements Completed', body);
    }
    if (report.badgeReqs.length) {
      const body = report.badgeReqs.map(g => `
        <div class="rankGroupTitle">${esc(g.badge)}${g.eagle ? '<span class="eagleDot">&#9733; EAGLE</span>' : ''} <span class="rgCount">${g.lines.reduce((n, l) => n + l.scouts.length, 0)} sign-off${g.lines.length === 1 && g.lines[0].scouts.length === 1 ? '' : 's'}</span></div>
        ${g.lines.map(l => renderReqLineHtml(l, meta, editable, g.badge)).join('')}`).join('');
      html += section('Merit Badge Requirements Completed', body);
    }
    if (report.leadership.length || report.otherAwards.length) {
      let body = '';
      if (report.leadership.length) {
        body += `<div class="rankGroupTitle">Leadership</div>` + report.leadership.map(g => renderAwardGroupHtml(g, meta, editable)).join('');
      }
      if (report.otherAwards.length) {
        body += `<div class="rankGroupTitle">Other</div>` + report.otherAwards.map(g => renderAwardGroupHtml(g, meta, editable)).join('');
      }
      html += section('Leadership & Other', body);
    }
    return html;
  }

  /* ── Scout-centric view (added 2026-08-17, per Patrick's request) ──
     Reorganizes the SAME consolidated report content by scout instead
     of by category — no separate aggregation pass against raw ledger
     rows. Every line/entry object referenced here is the exact same
     object the category view renders, so edits made from either view
     mutate one shared model (see the shared data-group/data-line/
     data-scout-name contract both renderers use). ───────────────────── */
  function buildScoutView(report) {
    const byScout = new Map();
    function ensure(s) {
      if (!byScout.has(s)) byScout.set(s, {
        scout: s, ranksEarned: [], badgesEarned: [],
        rankReqsByRank: new Map(), badgeReqsByBadge: new Map(),
        leadership: [], otherAwards: [],
      });
      return byScout.get(s);
    }
    report.ranksEarned.forEach(g => g.scouts.forEach((s, i) => ensure(s).ranksEarned.push({ name: g.name, entry: g.entries[i] })));
    report.badgesEarned.forEach(g => g.scouts.forEach((s, i) => ensure(s).badgesEarned.push({ name: g.name, eagle: g.eagle, entry: g.entries[i] })));
    report.rankReqs.forEach(g => g.lines.forEach(line => line.scouts.forEach((s, idx) => {
      const rec = ensure(s);
      if (!rec.rankReqsByRank.has(g.rank)) rec.rankReqsByRank.set(g.rank, []);
      rec.rankReqsByRank.get(g.rank).push({ line, scoutIdx: idx });
    })));
    report.badgeReqs.forEach(g => g.lines.forEach(line => line.scouts.forEach((s, idx) => {
      const rec = ensure(s);
      if (!rec.badgeReqsByBadge.has(g.badge)) rec.badgeReqsByBadge.set(g.badge, { eagle: g.eagle, items: [] });
      rec.badgeReqsByBadge.get(g.badge).items.push({ line, scoutIdx: idx });
    })));
    report.leadership.forEach(g => g.scouts.forEach((s, i) => ensure(s).leadership.push({ name: g.name, entry: g.entries[i] })));
    report.otherAwards.forEach(g => g.scouts.forEach((s, i) => ensure(s).otherAwards.push({ name: g.name, entry: g.entries[i] })));

    const names = Array.from(byScout.keys()).sort();
    return names.map(n => byScout.get(n));
  }

  function scoutRowHtml(labelHtml, entries, meta, editable, removeAttrs) {
    const out = datesOutOfRange(entries, meta);
    const dateBit = out.length ? `<span class="entryDate">earned ${esc(out.join(', '))}</span>` : '';
    const removeBtn = editable ? `<button type="button" class="scoutRemove" ${removeAttrs}>Remove</button>` : '';
    return `<div class="scoutRow">${labelHtml}${dateBit}${removeBtn}</div>`;
  }
  function scoutReqRowHtml(item, meta, editable, groupKey) {
    const { line, scoutIdx } = item;
    const codeTags = line.codes.map(c => `<span class="reqTag reqTag--ghost">${esc(c)}</span>`).join(' ');
    const lineKey = line.codes.join(',');
    const labelText = line.labels.join(', ');
    const labelEl = editable
      ? `<span class="rlLabels" contenteditable="true" data-line-label data-group="${esc(groupKey)}" data-line="${esc(lineKey)}">${esc(labelText)}</span>`
      : `<span class="rlLabels">${esc(labelText)}</span>`;
    const removeAttrs = `data-remove-scout="${esc(line.scouts[scoutIdx])}" data-remove-line="${esc(lineKey)}" data-remove-group="${esc(groupKey)}"`;
    return scoutRowHtml(codeTags + labelEl, entriesForScoutSlot(line, scoutIdx), meta, editable, removeAttrs);
  }

  function renderScoutViewHtml(scoutView, meta, opts) {
    opts = opts || {};
    const editable = !!opts.editable;
    const expandScout = opts.expandScout || null; // auto-open one card for a shared per-scout link
    if (!scoutView.length) {
      return `<div class="emptyState">
        <span class="esIcon" aria-hidden="true">🌤</span>
        <h3>No advancement to report this week</h3>
        <p>Nothing was logged with an entry date in this range. That&rsquo;s normal for an off week —
        no meeting, a holiday break, or everyone mid-project. Check back after the next sign-off.</p>
      </div>`;
    }
    return `<div class="scoutCardGrid">` + scoutView.map(rec => {
      let body = '';
      if (rec.ranksEarned.length) {
        body += rec.ranksEarned.map(a => scoutRowHtml(`<strong>${esc(a.name)} — Rank Earned</strong>`, [a.entry], meta, editable, `data-remove-scout="${esc(rec.scout)}" data-remove-group="${esc(a.name)}"`)).join('');
      }
      if (rec.badgesEarned.length) {
        body += rec.badgesEarned.map(a => scoutRowHtml(`<strong>${esc(a.name)} — Merit Badge Earned</strong>${a.eagle ? '<span class="eagleDot">&#9733; EAGLE</span>' : ''}`, [a.entry], meta, editable, `data-remove-scout="${esc(rec.scout)}" data-remove-group="${esc(a.name)}"`)).join('');
      }
      Array.from(rec.rankReqsByRank.keys()).sort((a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b)).forEach(rank => {
        body += `<div class="scoutSubhead">${esc(rank)}</div>`;
        rec.rankReqsByRank.get(rank).sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]))
          .forEach(item => { body += scoutReqRowHtml(item, meta, editable, rank); });
      });
      Array.from(rec.badgeReqsByBadge.keys()).sort().forEach(badge => {
        const g = rec.badgeReqsByBadge.get(badge);
        body += `<div class="scoutSubhead">${esc(badge)}${g.eagle ? '<span class="eagleDot">&#9733; EAGLE</span>' : ''}</div>`;
        g.items.sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]))
          .forEach(item => { body += scoutReqRowHtml(item, meta, editable, badge); });
      });
      if (rec.leadership.length) {
        body += `<div class="scoutSubhead">Leadership</div>`;
        body += rec.leadership.map(a => scoutRowHtml(`<strong>${esc(a.name)}</strong>`, [a.entry], meta, editable, `data-remove-scout="${esc(rec.scout)}" data-remove-group="${esc(a.name)}"`)).join('');
      }
      if (rec.otherAwards.length) {
        body += `<div class="scoutSubhead">Other</div>`;
        body += rec.otherAwards.map(a => scoutRowHtml(`<strong>${esc(a.name)}</strong>`, [a.entry], meta, editable, `data-remove-scout="${esc(rec.scout)}" data-remove-group="${esc(a.name)}"`)).join('');
      }
      const itemCount = rec.ranksEarned.length + rec.badgesEarned.length + rec.leadership.length + rec.otherAwards.length +
        Array.from(rec.rankReqsByRank.values()).reduce((n, arr) => n + arr.length, 0) +
        Array.from(rec.badgeReqsByBadge.values()).reduce((n, g) => n + g.items.length, 0);
      const isOpen = !!(expandScout && expandScout === rec.scout);
      return `<div class="scoutCard" data-scout-card="${esc(rec.scout)}">
        <button type="button" class="scoutCardHead" data-scout-head aria-expanded="${isOpen}">
          <span class="scoutCardName">${esc(rec.scout)}</span>
          <span class="rgCount">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
          <span class="scoutCardCaret" aria-hidden="true">&#9660;</span>
        </button>
        <div class="scoutCardBody" ${isOpen ? '' : 'hidden'}>${body}</div>
      </div>`;
    }).join('') + `</div>`;
  }

  /* ── Mutation helpers used by admin.html's structured editor ───────
     These mutate a report object in place; the caller re-renders after. */
  function removeScoutFromReport(report, groupKey, lineKey, scoutName) {
    function stripFrom(list, matchName) {
      for (const g of list) {
        if (g.name === matchName || g.badge === matchName || g.rank === matchName) {
          if (g.scouts) {
            const idx = g.scouts.indexOf(scoutName);
            if (idx > -1) { g.scouts.splice(idx, 1); g.entries.splice(idx, 1); return true; }
          }
          if (g.lines) {
            for (const line of g.lines) {
              const idx = line.scouts.indexOf(scoutName);
              if (idx > -1 && (!lineKey || line.codes.join(',') === lineKey)) {
                line.scouts.splice(idx, 1); line.entries.splice(idx, 1); return true;
              }
            }
          }
        }
      }
      return false;
    }
    stripFrom(report.ranksEarned, groupKey) || stripFrom(report.badgesEarned, groupKey) ||
      stripFrom(report.rankReqs, groupKey) || stripFrom(report.badgeReqs, groupKey) ||
      stripFrom(report.leadership, groupKey) || stripFrom(report.otherAwards, groupKey);
    // prune now-empty lines/groups
    report.rankReqs.forEach(g => { g.lines = g.lines.filter(l => l.scouts.length); });
    report.badgeReqs.forEach(g => { g.lines = g.lines.filter(l => l.scouts.length); });
    report.rankReqs = report.rankReqs.filter(g => g.lines.length);
    report.badgeReqs = report.badgeReqs.filter(g => g.lines.length);
    report.ranksEarned = report.ranksEarned.filter(g => g.scouts.length);
    report.badgesEarned = report.badgesEarned.filter(g => g.scouts.length);
    report.leadership = report.leadership.filter(g => g.scouts.length);
    report.otherAwards = report.otherAwards.filter(g => g.scouts.length);
    report.isEmpty = !report.ranksEarned.length && !report.badgesEarned.length && !report.rankReqs.length &&
      !report.badgeReqs.length && !report.leadership.length && !report.otherAwards.length;
  }

  /* ── Public exports ────────────────────────────────────────────────── */
  global.AdvRpt = {
    SCENARIOS, HISTORICAL_IDS, RANK_ORDER, SCOUTS, LEADERS,
    buildLedger, filterByEnteredAt, buildReport,
    toMarkdown, renderReportHtml, removeScoutFromReport,
    buildScoutView, renderScoutViewHtml, datesOutOfRange,
    fmtDate, fmtDateLong, addDays, TODAY,
    publishToArchive, updateLiveRecord, unpublishLive,
    listArchive, getPublishedById, getLatestPublished,
  };
})(window);
