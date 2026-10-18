/* Meeting Requests & Teaching Offers prototype: sample troop, shared state, matcher.
   Every screen loads this file. State lives in localStorage so a pick made on the
   member page shows up on the admin board, the editor tray and the TV display.
   The matcher here is a stand-in for lib/meeting-board/match.ts: same rules as the
   plan (≤2 topics per scout, ≤8 per session, one topic per block, tie-breaks), not
   the production code. */

const TODAY = '2026-10-29';          // prototype "today" is Thursday, October 29, 2026
const STORE_KEY = 'mtgBoardProto.v3';

/* ───────────── Catalog ───────────── */
const SKILLS = [
  ['first-aid', 'First Aid', false], ['knots', 'Knots & Lashings', true], ['woods-tools', 'Woods Tools', false],
  ['fire-safety', 'Fire Safety', false], ['cooking', 'Cooking & Meal Planning', true], ['navigation', 'Navigation & Maps', true],
  ['fitness', 'Fitness', true], ['camping', 'Camping Skills', true], ['aquatics', 'Aquatics', false],
  ['nature', 'Nature & Weather', true], ['citizenship', 'Citizenship & Community', true], ['teaching', 'Teaching (EDGE)', true],
  ['safety', 'Safety & Awareness', true]
].map(([id, name, youth]) => ({ id, name, youth }));
/* Why an adult-only skill is adult-only: the Guide to Safe Scouting (woods tools, fire, aquatics) or our own troop rule (first aid). */
function adultOnlyNote(id) { return id === 'first-aid' ? 'Adults only (troop rule)' : 'Adults only (Guide to Safe Scouting)'; }
const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

const RANKS = [
  { id: 'scout', name: 'Scout' }, { id: 'tenderfoot', name: 'Tenderfoot' }, { id: 'second-class', name: 'Second Class' },
  { id: 'first-class', name: 'First Class' }, { id: 'star', name: 'Star' }, { id: 'life', name: 'Life' }, { id: 'eagle', name: 'Eagle' }
];
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r.id, i]));
const RANK_NAME = Object.fromEntries(RANKS.map((r) => [r.id, r.name]));

/* Top-level requirement rows the pick list offers (code|label|skill|venue m/o/e).
   NOT_PLANNABLE rows (Scout Spirit, conferences, tenure, POR, MB counts, Eagle
   project, boards of review) are left out, as the engine does. Star, Life and
   Eagle have nothing plannable at a meeting. */
const REQ_SRC = {
  scout: ['1a|Oath, Law, motto and slogan|citizenship|m', '1c|Sign, salute and handshake|citizenship|m', '1d|What the First Class badge means|citizenship|m',
    '1e|The Outdoor Code|nature|m', '1f|Pledge of Allegiance|citizenship|m', '2a|How the troop is led||m', '2b|Four steps of advancement||m',
    '2c|The ranks||m', '2d|Merit badges||m', '3a|Patrols||m', '3b|Patrol spirit||m', '4a|Square knot, two half hitches, taut-line|knots|m',
    '4b|Care of rope|knots|m', '5|Pocketknife safety|woods-tools|m', '6|Cyber Chip and staying safe|safety|m'],
  tenderfoot: ['1a|Pack for an overnight campout|camping|e', '1b|Camp in a tent you pitched|camping|o', '1c|Practice the Outdoor Code|nature|o',
    '2a|Help cook a campout meal|cooking|o', '2b|Clean up after a campout meal|cooking|o', '2c|Eat as a patrol|camping|o', '3a|Square knot, used|knots|m',
    '3b|Two half hitches, used|knots|m', '3c|Taut-line hitch, used|knots|m', '3d|Knife, saw and ax care|woods-tools|m', '4a|First aid|first-aid|m',
    '4b|Poisonous plants|nature|m', '4c|Preventing campout injuries|first-aid|m', '4d|Build a first aid kit|first-aid|m', '5a|Buddy system on an outing|safety|o',
    '5b|What to do if you get lost|navigation|m', '5c|Safe hiking|safety|m', '6a|Fitness test|fitness|m', '6b|30-day fitness plan|fitness|e',
    '6c|Fitness retest|fitness|m', '7a|Flag: raise, lower, fold|citizenship|m', '7b|One hour of service|citizenship|o', '8|Teach the square knot (EDGE)|teaching|m'],
  'second-class': ['1b|Leave No Trace|nature|m', '1c|Pick a site and pitch a tent|camping|o', '2a|When to use a cooking fire|fire-safety|m',
    '2b|Tinder, kindling and fuel|fire-safety|e', '2c|Build a fire|fire-safety|o', '2d|Backpacking stove safety|cooking|m', '2e|Cook a hot breakfast|cooking|o',
    '2f|Sheet bend|knots|m', '2g|Bowline|knots|m', '3a|Map and compass|navigation|m', '3b|5-mile compass hike|navigation|o', '3c|Hiking hazards|safety|m',
    '3d|Directions by day and night|navigation|e', '4|Tracks of 10 animals|nature|o', '5a|Safe swim precautions|aquatics|m', '5b|Beginner swim test|aquatics|o',
    '5c|Water rescue|aquatics|o', '5d|Dangers of swimmer rescue|aquatics|m', '6a|First aid|first-aid|m', '6b|Choking, stroke, bleeding|first-aid|m',
    '6c|Preventing outing injuries|first-aid|m', '6d|Home and wilderness emergencies|first-aid|m', '6e|Car accident response|first-aid|m', '7a|Fitness|fitness|m',
    '7b|Fitness challenges|fitness|e', '7c|Drugs, alcohol and tobacco|safety|m', '8a|Flag ceremony|citizenship|m', '8b|Respect for the flag|citizenship|m',
    '8c|Budget to earn an item||m', '8d|Shop for the item||o', '9a|Three R’s of personal safety|safety|m', '9b|Bullying|safety|m'],
  'first-class': ['1b|Tread Lightly|nature|m', '2a|Plan a campout menu|cooking|m', '2b|Budget and shop for it|cooking|e', '2c|Pots, pans and utensils|cooking|m',
    '2d|Safe food handling|cooking|m', '2e|Cook the meals|cooking|o', '3a|What lashings are for|knots|m', '3b|Timber hitch and clove hitch|knots|m',
    '3c|Three lashings|knots|m', '3d|Build a camp gadget|knots|o', '4a|Orienteering course|navigation|o', '4b|Geocache with a GPS|navigation|e',
    '5a|Identify 10 native plants|nature|o', '5b|Read a forecast|nature|m', '5c|Signs of bad weather|nature|m', '5d|Extreme weather|nature|m',
    '6a|BSA swim test|aquatics|o', '6b|Safe trip afloat|aquatics|m', '6c|Parts of a canoe and paddle|aquatics|m', '6d|Positions in a boat|aquatics|m',
    '6e|Line rescue|aquatics|o', '7a|First aid|first-aid|m', '7b|Moving an injured person|first-aid|m', '7c|Heart attack and CPR|first-aid|m',
    '7d|Hazards at home|safety|m', '7e|Home emergency plan|safety|m', '7f|Safe drinking water|camping|m', '8a|30-day fitness|fitness|e', '8b|Fitness goals|fitness|m',
    '9a|Talk with a public official|citizenship|e', '9b|An environmental issue|nature|m', '9c|Track your trash|nature|e', '10|Tell a friend about Scouting|citizenship|e'],
  star: [], life: [], eagle: []
};
const REQS = {};
for (const [rank, rows] of Object.entries(REQ_SRC)) {
  REQS[rank] = rows.map((row, i) => {
    const [code, label, skill, v] = row.split('|');
    return { key: `${rank}-${code}`, rank, code, label, skill: skill || null, venue: { m: 'meeting', o: 'outing', e: 'either' }[v], order: RANK_ORDER[rank] * 1000 + i };
  });
}
const REQ_BY_KEY = Object.fromEntries(Object.values(REQS).flat().map((r) => [r.key, r]));

/* Merit badges: [id, name, Eagle-required, has requirement rows]. Badges with no
   requirement rows can't be a merit badge night (Plan: 5 of 69). */
const MBS = [
  ['camping', 'Camping', true, true], ['chess', 'Chess', false, true], ['citizenship-community', 'Citizenship in the Community', true, true],
  ['citizenship-nation', 'Citizenship in the Nation', true, true], ['citizenship-society', 'Citizenship in Society', true, true],
  ['citizenship-world', 'Citizenship in the World', true, true], ['communication', 'Communication', true, true], ['cooking', 'Cooking', true, true],
  ['emergency-preparedness', 'Emergency Preparedness', true, true], ['environmental-science', 'Environmental Science', true, true],
  ['family-life', 'Family Life', true, true], ['first-aid', 'First Aid', true, true], ['hiking', 'Hiking', false, true],
  ['personal-fitness', 'Personal Fitness', true, true], ['personal-management', 'Personal Management', true, true], ['pioneering', 'Pioneering', false, true],
  ['space-exploration', 'Space Exploration', false, true], ['swimming', 'Swimming', false, true],
  ['bugling', 'Bugling', false, false], ['scuba-diving', 'Scuba Diving', false, false], ['signs-signals-codes', 'Signs, Signals, and Codes', false, false]
].map(([id, name, eagle, hasReqs]) => ({ id, name, eagle, hasReqs }));
const MB = Object.fromEntries(MBS.map((m) => [m.id, m]));
const MB_REQS = {
  cooking: [['1', 'Health and safety'], ['2', 'Nutrition'], ['3', 'Cooking basics'], ['4', 'Cook at home'], ['5', 'Camp cooking'], ['6', 'Trail and backpacking meals'], ['7', 'Food careers']],
  'first-aid': [['1', 'Safety and prevention'], ['2', 'First aid kits'], ['3', 'Shock'], ['4', 'Bleeding'], ['5', 'Burns and cold injuries'], ['6', 'Splints and transport'], ['7', 'CPR']],
  camping: [['1', 'Hazards'], ['2', 'Leave No Trace'], ['3', 'Gear'], ['4', 'Tents'], ['5', 'Menus'], ['6', 'Stoves'], ['7', 'Camping nights']]
};
function mbReqs(id) { return (MB_REQS[id] || [1, 2, 3, 4, 5, 6].map((n) => [String(n), `Requirement ${n}`])).map(([code, label]) => ({ code, label })); }

/* ───────────── People ───────────── */
// Scouts: rank = current rank held (null = working on Scout). done = finished rows of the NEXT rank.
const SCOUTS = [
  { id: 's-leo', name: 'Leo M', rank: null, grade: 5, patrol: 'Owls', hh: 'mendez', pct: 0.3, done: ['1a', '1c', '2a', '2b'] },
  { id: 's-owen', name: 'Owen P', rank: 'scout', grade: 6, patrol: 'Owls', hh: 'peterson', pct: 0.25, done: ['1a', '3a', '3b', '3c', '6a'] },
  { id: 's-ava', name: 'Ava K', rank: 'scout', grade: 6, patrol: 'Owls', hh: 'kowalski', pct: 0.2, done: ['1a', '5b', '7a'] },
  { id: 's-mateo', name: 'Mateo R', rank: 'scout', grade: 6, patrol: 'Foxes', hh: 'ruiz', pct: 0.35, done: ['3a', '3b', '3c', '5b', '5c', '7a'] },
  { id: 's-nora', name: 'Nora B', rank: 'scout', grade: 6, patrol: 'Foxes', hh: 'brandt', pct: 0.3, done: ['1a', '3a', '3b', '3c'] },
  { id: 's-finn', name: 'Finn P', rank: 'tenderfoot', grade: 7, patrol: 'Hawks', hh: 'peterson', pct: 0.4, done: ['1b', '2f', '3c', '3d', '7a', '8a', '8b', '9a', '9b'] },
  { id: 's-anjali', name: 'Anjali S', rank: 'tenderfoot', grade: 7, patrol: 'Hawks', hh: 'shah', pct: 0.45, done: ['1b', '2a', '2f', '3d', '8a', '8b'] },
  { id: 's-caleb', name: 'Caleb W', rank: 'tenderfoot', grade: 7, patrol: 'Hawks', hh: 'walsh', pct: 0.3, done: ['1b', '8a'] },
  { id: 's-isaac', name: 'Isaac T', rank: 'second-class', grade: 7, patrol: 'Bears', hh: 'tran', pct: 0.4, done: ['1b', '2c', '2d', '5b', '5c', '9b'] },
  { id: 's-priya', name: 'Priya N', rank: 'second-class', grade: 8, patrol: 'Bears', hh: 'nair', pct: 0.55, done: ['1b', '2a', '2c', '2d', '3a', '5b', '5c', '5d', '8b'] },
  { id: 's-henry', name: 'Henry L', rank: 'second-class', grade: 8, patrol: 'Bears', hh: 'lund', pct: 0.5, done: ['1b', '2c', '2d', '5b'] },
  { id: 's-zoe', name: 'Zoe W', rank: 'second-class', grade: 9, patrol: 'Foxes', hh: 'walsh', pct: 0.45, done: ['1b', '2d', '3a', '3b', '5b', '5c'] },
  { id: 's-sam', name: 'Sam O', rank: 'first-class', grade: 8, patrol: 'Hawks', hh: 'ortiz', mbs: ['first-aid', 'personal-fitness'], awarded: ['swimming'] },
  { id: 's-grace', name: 'Grace H', rank: 'first-class', grade: 9, patrol: 'Bears', hh: 'hale', mbs: ['cooking', 'citizenship-community'], awarded: ['first-aid', 'swimming'], mbDone: { cooking: ['2'] } },
  { id: 's-eli', name: 'Eli D', rank: 'first-class', grade: 7, patrol: 'Owls', hh: 'dahl', mbs: ['personal-fitness', 'chess'], awarded: [] },
  { id: 's-theo', name: 'Theo P', rank: 'star', grade: 9, patrol: 'Hawks', hh: 'peterson', mbs: ['cooking', 'communication', 'citizenship-nation'], awarded: ['first-aid', 'swimming', 'camping'], mbDone: { cooking: ['1'] } },
  { id: 's-lucas', name: 'Lucas G', rank: 'star', grade: 10, patrol: 'Bears', hh: 'grant', mbs: ['citizenship-community', 'cooking'], awarded: ['first-aid', 'swimming'], mbDone: { cooking: ['1', '2'] } },
  { id: 's-maya', name: 'Maya C', rank: 'life', grade: 10, patrol: 'Foxes', hh: 'chen', mbs: ['personal-management'], awarded: ['cooking', 'first-aid', 'camping', 'swimming'] },
  { id: 's-jack', name: 'Jack F', rank: 'life', grade: 11, patrol: 'Hawks', hh: 'fischer', mbs: ['family-life'], awarded: ['cooking', 'first-aid', 'camping'] },
  { id: 's-ben', name: 'Ben A', rank: 'eagle', grade: 12, patrol: 'Bears', hh: 'adeyemi', mbs: [], awarded: ['cooking', 'first-aid', 'camping', 'swimming', 'personal-fitness'] }
].map((s) => ({ kind: 'scout', mbs: [], awarded: [], mbDone: {}, done: [], pct: 0.6, override: null, ...s }));

// Adults: formal = how scouts address them (scout-facing views + TV); name = first + last initial (admin).
const ADULTS = [
  { id: 'a-ortiz', name: 'Karen O', formal: 'Mrs. Ortiz', role: 'Scoutmaster', leader: true, hh: 'ortiz', counselor: ['citizenship-community', 'communication'] },
  { id: 'a-vest', name: 'Dan V', formal: 'Mr. Vest', role: 'Assistant Scoutmaster', leader: true, hh: 'vest', counselor: ['pioneering'] },
  { id: 'a-hale', name: 'Mike H', formal: 'Mr. Hale', role: 'Assistant Scoutmaster', leader: true, hh: 'hale', counselor: ['hiking', 'personal-fitness'] },
  { id: 'a-grant', name: 'Tom G', formal: 'Mr. Grant', role: 'Assistant Scoutmaster', leader: true, hh: 'grant', counselor: ['swimming', 'first-aid'] },
  { id: 'a-brandt', name: 'Lisa B', formal: 'Ms. Brandt', role: 'Committee member', leader: true, hh: 'brandt', counselor: ['cooking', 'camping'] },
  { id: 'a-dahl', name: 'Sue D', formal: 'Mrs. Dahl', role: 'Advancement chair', leader: true, hh: 'dahl', counselor: ['personal-management', 'family-life'] },
  { id: 'a-rpeterson', name: 'Rachel P', formal: 'Mrs. Peterson', role: 'Parent', leader: false, hh: 'peterson', counselor: [] },
  { id: 'a-ruiz', name: 'Jorge R', formal: 'Mr. Ruiz', role: 'Parent', leader: false, hh: 'ruiz', counselor: [] }
].map((a) => ({ kind: 'adult', ...a }));
const PEOPLE = Object.fromEntries([...SCOUTS, ...ADULTS].map((p) => [p.id, p]));
const LEADER_ID = 'a-dahl';   // the admin persona: Sue D, advancement chair

function householdScouts(adultId) { const hh = PEOPLE[adultId].hh; return SCOUTS.filter((s) => s.hh === hh); }
function display(id, audience) { const p = PEOPLE[id]; if (!p) return '?'; return p.kind === 'adult' && audience === 'scout' ? p.formal : p.name; }
function firstName(id) { return PEOPLE[id].name.split(' ')[0]; }
function nextRank(s) { return s.rank === null ? 'scout' : (RANKS[RANK_ORDER[s.rank] + 1] || {}).id || null; }
/* canOfferToTeach (Decision 11): First Class+ always; grade 9+ unless override 'no'; override 'yes' adds anyone. */
function isJuniorLeader(s) {
  if (!s || s.kind !== 'scout') return false;
  if (s.rank && RANK_ORDER[s.rank] >= RANK_ORDER['first-class']) return true;
  if (s.override === 'yes') return true;
  return s.grade >= 9 && s.override !== 'no';
}
/* "Finished it themselves": current rank at/above the requirement's rank, or done in the ledger. */
function hasFinished(s, req) {
  if (!req || !req.rank) return false;
  if (s.rank && RANK_ORDER[s.rank] >= RANK_ORDER[req.rank]) return true;
  return nextRank(s) === req.rank && s.done.includes(req.code);
}

/* ───────────── Calendar + boards ───────────── */
const MEETINGS = [
  { id: 'oct25', date: '2026-10-25', day: 'Sunday', label: 'Sunday, October 25', short: 'Oct 25', title: 'Troop Meeting', kind: 'meeting', past: true },
  { id: 'nov1', date: '2026-11-01', day: 'Sunday', label: 'Sunday, November 1', short: 'Nov 1', title: 'Troop Meeting', kind: 'meeting' },
  { id: 'nov8', date: '2026-11-08', day: 'Sunday', label: 'Sunday, November 8', short: 'Nov 8', title: 'Troop Meeting: Cooking night', kind: 'meeting' },
  { id: 'nov14', date: '2026-11-14', day: 'Saturday', label: 'Saturday, November 14', short: 'Nov 14', title: 'Service day at the food pantry', kind: 'event' },
  { id: 'nov15', date: '2026-11-15', day: 'Sunday', label: 'Sunday, November 15', short: 'Nov 15', title: 'Campout prep meeting', kind: 'meeting' },
  { id: 'nov22', date: '2026-11-22', day: 'Sunday', label: 'Sunday, November 22', short: 'Nov 22', title: 'Fall Court of Honor', kind: 'event' },
  { id: 'nov29', date: '2026-11-29', day: 'Sunday', label: 'Sunday, November 29', short: 'Nov 29', title: 'Troop Meeting', kind: 'meeting' },
  { id: 'dec6', date: '2026-12-06', day: 'Sunday', label: 'Sunday, December 6', short: 'Dec 6', title: 'Troop Meeting', kind: 'meeting' }
];
const MEETING = Object.fromEntries(MEETINGS.map((m) => [m.id, m]));
const MEETING_TIME = '6:00–7:30 pm';
const MEETING_PLACE = 'Northwoods meeting room';
const BLOCK_TIMES = { 1: ['6:20–7:10'], 2: ['6:20–6:50', '6:55–7:25'], 3: ['6:15–6:35', '6:40–7:00', '7:05–7:25'] };
function rotationTimes(n) { const out = []; let t = 6 * 60 + 15; const len = n >= 4 ? 18 : 24; for (let i = 0; i < n; i++) { out.push(fmtMin(t) + '–' + fmtMin(t + len)); t += len + 2; } return out; }
function fmtMin(m) { return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

/* The board's mode when no meeting_boards row exists: rank for meetings, closed for everything else. */
function defaultBoard(m) { return MEETING[m].kind === 'meeting' ? { mode: 'rank', blocks: 2, mbId: null, stations: [], isDefault: true } : { mode: 'closed', blocks: 2, mbId: null, stations: [], isDefault: true }; }
function boardFor(m) { return state.boards[m] ? { ...defaultBoard(m), ...state.boards[m], isDefault: false } : defaultBoard(m); }
function nextOpenBoard(after) { return MEETINGS.find((x) => x.date > MEETING[after].date && boardFor(x.id).mode !== 'closed'); }

/* ───────────── State ───────────── */
function seed() {
  const P = (key, pri, asked, by, note) => ({ key, pri, asked, by: by || null, note: note || '', ...(asked < '2026-10-26' ? { carried: 'Oct 25' } : {}) });
  return {
    when: 'thu',                       // thu | sun | set | live (meeting on, agenda published)
    picks: {
      nov1: {
        's-leo': [P('scout-4a', 1, '2026-10-18'), P('scout-5', null, '2026-10-25')],
        's-owen': [P('tenderfoot-4a', null, '2026-10-25', 'a-rpeterson')],
        's-ava': [P('tenderfoot-4a', 1, '2026-10-26'), P('tenderfoot-3d', 2, '2026-10-26'), P('tenderfoot-6a', 3, '2026-10-18')],
        's-nora': [P('tenderfoot-4a', null, '2026-10-27', 'a-brandt'), P('tenderfoot-4d', null, '2026-10-27', 'a-brandt'), P('tenderfoot-3d', null, '2026-10-27', 'a-brandt')],
        's-finn': [P('second-class-5a', 1, '2026-10-18'), P('second-class-6a', 2, '2026-10-11', 'a-rpeterson'), P('second-class-2g', 3, '2026-10-26')],
        's-anjali': [P('second-class-6a', null, '2026-10-11'), P('second-class-2g', null, '2026-10-26'), P('second-class-3a', null, '2026-10-26')],
        's-caleb': [P('second-class-6a', null, '2026-10-11'), P('second-class-3a', null, '2026-10-27')],
        's-isaac': [P('first-class-3c', 1, '2026-10-11'), P('first-class-7a', 2, '2026-10-18')],
        's-priya': [P('first-class-3c', null, '2026-10-11'), P('first-class-3b', null, '2026-10-11')],
        's-henry': [P('first-class-7a', null, '2026-10-18')],
        's-zoe': [P('first-class-4b', null, '2026-10-26'), P('first-class-7a', null, '2026-10-26')],
        's-sam': [P('mb:first-aid', null, '2026-10-18', null, 'make-up: req 5')],
        's-eli': [P('mb:personal-fitness', null, '2026-10-26')],
        's-lucas': [P('mb:citizenship-community', null, '2026-10-25', null, 'make-up: req 7')]
      }
    },
    intents: {
      nov1: { 's-mateo': 'undecided', 's-henry': 'not_coming', 's-jack': 'not_coming', 's-ben': 'coming', 's-grace': 'coming',
        'a-ortiz': 'coming', 'a-vest': 'coming', 'a-hale': 'coming', 'a-brandt': 'undecided', 'a-grant': 'not_coming', 'a-rpeterson': 'coming', 'a-dahl': 'coming' },
      nov8: { 's-finn': 'coming', 's-anjali': 'coming', 's-caleb': 'coming', 's-owen': 'coming', 's-ava': 'coming', 's-nora': 'coming', 's-mateo': 'coming',
        's-leo': 'coming', 's-isaac': 'coming', 's-priya': 'coming', 's-zoe': 'coming', 's-sam': 'coming', 's-grace': 'coming', 's-eli': 'coming',
        's-theo': 'coming', 's-lucas': 'coming', 's-maya': 'coming', 's-ben': 'coming', 's-henry': 'not_coming',
        'a-brandt': 'coming', 'a-vest': 'coming', 'a-rpeterson': 'coming', 'a-ortiz': 'coming' }
    },
    teach: {
      nov1: { 'a-ortiz': [{ key: 'tenderfoot-4a' }, { key: 'mb:citizenship-community' }], 'a-vest': [{ key: 'tenderfoot-3d' }, { key: 'second-class-2b' }],
        'a-rpeterson': [{ key: 'second-class-6a' }], 's-grace': [{ key: 'scout-4a' }, { key: 'second-class-2g' }] },
      nov8: { 'a-brandt': [{ station: 0 }], 'a-rpeterson': [{ station: 1 }], 'a-vest': [{ station: 3 }] }
    },
    offers: [{ id: 1, person: 'a-hale', skill: 'navigation', key: null, title: null, dates: ['nov1', 'dec6'], note: 'Bring a compass if you have one.' }],
    skills: {
      'a-ortiz': ['first-aid', 'citizenship', 'teaching', 'safety'], 'a-vest': ['knots', 'woods-tools', 'fire-safety', 'cooking', 'camping'],
      'a-hale': ['navigation', 'fitness', 'nature'], 'a-grant': ['first-aid', 'aquatics', 'fitness', 'safety'], 'a-brandt': ['cooking', 'camping', 'nature'],
      'a-dahl': ['citizenship', 'teaching'], 'a-rpeterson': ['first-aid', 'safety'], 'a-ruiz': [],
      's-grace': ['knots', 'camping'], 's-sam': ['knots', 'fitness'], 's-theo': ['navigation', 'citizenship'], 's-lucas': ['cooking', 'nature'],
      's-maya': ['navigation', 'citizenship', 'teaching'], 's-jack': ['fitness', 'teaching'], 's-ben': ['knots', 'navigation', 'camping', 'cooking'], 's-eli': [], 's-zoe': []
    },
    changes: [
      { id: 4, whose: 'a-rpeterson', by: 'a-rpeterson', skill: 'first-aid', action: 'added', source: 'member', at: 'Oct 27, 8:14 pm', reviewed: false, reverted: false },
      { id: 3, whose: 's-jack', by: 's-jack', skill: 'teaching', action: 'added', source: 'member', at: 'Oct 26, 9:02 pm', reviewed: false, reverted: false },
      { id: 2, whose: 'a-rpeterson', by: 'a-rpeterson', skill: 'safety', action: 'added', source: 'member', at: 'Oct 22, 7:40 pm', reviewed: true, reverted: false },
      { id: 1, whose: 'a-hale', by: 'a-hale', skill: 'camping', action: 'removed', source: 'member', at: 'Oct 19, 6:55 pm', reviewed: true, reverted: false }
    ],
    boards: {
      nov1: { mode: 'rank', blocks: 2 },
      nov8: { mode: 'merit_badge', blocks: 4, mbId: 'cooking', stations: [
        { title: 'Health and safety', reqs: ['1'], loc: 'Kitchen' }, { title: 'Nutrition', reqs: ['2'], loc: 'Main hall' },
        { title: 'Cooking basics', reqs: ['3'], loc: 'Library corner' }, { title: 'Camp cooking', reqs: ['5'], loc: 'Parking lot' }] },
      nov15: { mode: 'closed', blocks: 2 }
    },
    rotations: {},
    promoted: {},
    published: {},
    rankMode: {},
    uid: 10
  };
}
let state = load();
function load() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.picks) return s; } catch (e) { /* private window */ } return seed(); }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
function resetState() { state = seed(); save(); }
function reloadState() { state = load(); }
function q(name, dflt) { const v = new URLSearchParams(location.search).get(name); return v == null || v === '' ? dflt : v; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
const WHEN = {
  thu: { label: 'Thursday before, 7:40 pm', clock: '7:40' },
  sun: { label: 'Sunday 4:10 pm (board still open)', clock: '4:10' },
  set: { label: 'Sunday 5:45 pm (after the 5:30 soft close)', clock: '5:45' },
  live: { label: 'Sunday 6:42 pm (meeting on)', clock: '6:42' }
};
function isPublished(m) { return !!state.published[m]; }

/* ───────────── Topics ───────────── */
function topicInfo(key) {
  if (key.startsWith('mb:')) { const mb = MB[key.slice(3)]; return { key, kind: 'mb', mbId: mb.id, label: mb.name, codeLabel: 'Merit badge', skill: null, venue: 'either', order: 9000 + MBS.indexOf(mb) }; }
  if (key.startsWith('ff:')) { const o = state.offers.find((x) => x.key === key); return { key, kind: 'ff', label: o ? o.title : key.slice(3), codeLabel: 'Something else', skill: null, venue: 'meeting', order: 9900 }; }
  const r = REQ_BY_KEY[key]; if (!r) return { key, kind: 'rank', label: key, codeLabel: key, order: 99999 };
  return { ...r, kind: 'rank', codeLabel: `${RANK_NAME[r.rank]} ${r.code}` };
}
function sessionTitle(keys) {
  const infos = keys.map(topicInfo);
  if (infos.length === 1) return { code: infos[0].codeLabel, title: infos[0].label };
  const r = infos[0];
  return { code: `${RANK_NAME[r.rank]} ${infos.map((i) => i.code).join(', ')}`, title: SKILL[r.skill] ? SKILL[r.skill].name.replace(' & Lashings', '').replace(' & Meal Planning', '') : r.label };
}
/* Who may teach a topic: adults with the skill (any adult when the row has none);
   Junior Leaders also need a youth-teachable skill and to have finished it. MB: any adult, counselor flag. */
function qualifies(pid, info) {
  const p = PEOPLE[pid]; const sk = state.skills[pid] || [];
  if (info.kind === 'ff') return true;
  if (info.kind === 'mb') return p.kind === 'adult';
  if (p.kind === 'adult') return !info.skill || sk.includes(info.skill);
  if (!isJuniorLeader(p)) return false;
  if (info.skill && (!SKILL[info.skill].youth || !sk.includes(info.skill))) return false;
  return hasFinished(p, info);
}
function needsCounselor(pid, info) { return info.kind === 'mb' && !(PEOPLE[pid].counselor || []).includes(info.mbId); }

/* ───────────── Picks, intent, carry-forward ───────────── */
function rawPicks(m, sid) { return (state.picks[m] || {})[sid]; }
/* Untaught picks carry to the next regular board (MB nights and closed boards hold them). */
function carriedFrom(m) { const idx = MEETINGS.findIndex((x) => x.id === m); for (let i = idx - 1; i >= 0; i--) { const b = boardFor(MEETINGS[i].id); if (b.mode === 'rank' && !MEETINGS[i].past) return MEETINGS[i].id; } return null; }
function picksFor(m, sid) {
  const b = boardFor(m); if (b.mode !== 'rank') return [];
  const own = rawPicks(m, sid); if (own) return own;
  const prev = carriedFrom(m); if (!prev) return [];
  const taught = new Set((matchFor(prev).assignment[sid] || []).flatMap((a) => a.keys));
  return picksFor(prev, sid).filter((p) => !taught.has(p.key)).map((p) => ({ ...p, later: false, carried: MEETING[prev].short }));
}
function heldPicks(m, sid) { const prev = carriedFrom(m); if (!prev) return []; const taught = new Set((matchFor(prev).assignment[sid] || []).flatMap((a) => a.keys)); return picksFor(prev, sid).filter((p) => !taught.has(p.key)); }
function orderedPicks(list) { return [...list].sort((a, b) => (a.pri == null) - (b.pri == null) || (a.pri || 0) - (b.pri || 0) || topicInfo(a.key).order - topicInfo(b.key).order); }
function commitsFor(m, pid) { return ((state.teach[m] || {})[pid] || []); }
function offersFor(m, pid) { return state.offers.filter((o) => o.person === pid && o.dates.includes(m)); }
function intentOf(m, pid) {
  const v = (state.intents[m] || {})[pid];
  if (v) return { value: v, implied: false };
  const p = PEOPLE[pid];
  const any = p.kind === 'scout' ? picksFor(m, pid).some((x) => !x.later) : commitsFor(m, pid).length + offersFor(m, pid).length > 0;
  return any ? { value: 'coming', implied: true } : { value: null, implied: false };
}
function setIntent(m, pid, v) { state.intents[m] = state.intents[m] || {}; state.intents[m][pid] = v; save(); }
function ensureOwnPicks(m, sid) { state.picks[m] = state.picks[m] || {}; if (!state.picks[m][sid]) state.picks[m][sid] = picksFor(m, sid).map((p) => ({ ...p })); return state.picks[m][sid]; }
function weeksAsked(asked, m) { const d = (new Date(MEETING[m].date) - new Date(asked)) / 864e5; return Math.max(1, Math.round(d / 7)); }

/* ───────────── Matcher (rank mode) ───────────── */
const _matchCache = {};
function matchFor(m) {
  const sig = JSON.stringify([state.picks[m], state.intents[m], state.teach[m], state.offers, state.skills, state.boards[m], m === 'nov29' ? [state.picks.nov1, state.intents.nov1, state.teach.nov1] : 0]);
  if (_matchCache[m] && _matchCache[m].sig === sig) return _matchCache[m].res;
  const res = computeMatch(m);
  _matchCache[m] = { sig, res };
  return res;
}
function computeMatch(m) {
  const b = boardFor(m);
  const empty = { blocks: [], sessions: [], offeredNoTakers: [], wanted: [], comingNothing: [], noAnswer: { scouts: [], adults: [] }, undecided: { scouts: [], adults: [] }, assignment: {}, counts: {} };
  if (b.mode !== 'rank') return empty;
  const nBlocks = b.blocks;
  const iv = (pid) => intentOf(m, pid).value;
  const scouts = SCOUTS.filter((s) => iv(s.id) !== 'not_coming');

  // Demand: one entry per scout pick, ordered the scout's way.
  const demand = {};
  const prefs = {};
  for (const s of scouts) {
    const list = orderedPicks(picksFor(m, s.id).filter((p) => !p.later));
    prefs[s.id] = list;
    list.forEach((p, i) => { (demand[p.key] = demand[p.key] || []).push({ sid: s.id, pickNo: i + 1, asked: p.asked, ranked: p.pri != null }); });
  }

  // Supply: direct commitments first, then broad skill offers expanded through skill_id.
  const sessions = []; const covered = {}; const offeredNoTakers = [];
  const teachers = [...ADULTS, ...SCOUTS].filter((p) => iv(p.id) !== 'not_coming');
  for (const t of teachers) {
    for (const c of commitsFor(m, t.id)) {
      if (!c.key || covered[c.key]) { if (c.key && covered[c.key]) covered[c.key].assist.push(t.id); continue; }
      const info = topicInfo(c.key);
      let keys = [c.key];
      if (info.kind === 'rank' && info.skill) {   // sibling picks sharing the skill merge into one session
        keys = keys.concat(Object.keys(demand).filter((k) => { const o = topicInfo(k); return k !== c.key && !covered[k] && o.kind === 'rank' && o.rank === info.rank && o.skill === info.skill && qualifies(t.id, o) && !commitsByAnyone(m, k); }));
      }
      const sess = { id: `${t.id}:${c.key}`, teacher: t.id, assist: [], keys, offer: false, scouts: [], block: null, counselorFlag: needsCounselor(t.id, info) };
      keys.forEach((k) => { covered[k] = sess; });
      if (!keys.some((k) => demand[k])) { offeredNoTakers.push({ teacher: t.id, keys, label: topicInfo(c.key).label, code: topicInfo(c.key).codeLabel }); continue; }
      sessions.push(sess);
    }
  }
  for (const t of teachers) {
    for (const o of offersFor(m, t.id)) {
      if (o.key) {   // requirement or freeform offer behaves like a commitment
        if (covered[o.key]) continue;
        const sess = { id: `${t.id}:${o.key}`, teacher: t.id, assist: [], keys: [o.key], offer: true, scouts: [], block: null };
        covered[o.key] = sess;
        if (demand[o.key]) sessions.push(sess); else offeredNoTakers.push({ teacher: t.id, keys: [o.key], label: topicInfo(o.key).label, code: 'Offer' });
        continue;
      }
      const byRank = {};
      Object.keys(demand).forEach((k) => { const info = topicInfo(k); if (!covered[k] && info.kind === 'rank' && info.skill === o.skill && qualifies(t.id, info)) (byRank[info.rank] = byRank[info.rank] || []).push(k); });
      const groups = Object.values(byRank).map((keys) => ({ keys, n: new Set(keys.flatMap((k) => demand[k].map((d) => d.sid))).size })).sort((a, z) => z.n - a.n);
      const room = Math.max(0, nBlocks - sessions.filter((s) => s.teacher === t.id).length);
      if (!groups.length) offeredNoTakers.push({ teacher: t.id, keys: [], label: SKILL[o.skill].name, code: 'Skill offer' });
      groups.slice(0, room).forEach((g) => { const sess = { id: `${t.id}:offer:${g.keys[0]}`, teacher: t.id, assist: [], keys: g.keys, offer: true, scouts: [], block: null }; g.keys.forEach((k) => { covered[k] = sess; }); sessions.push(sess); });
    }
  }

  // Blocks: a teacher's sessions go in different blocks; avoid stacking sessions the same scouts picked.
  const demandScouts = (sess) => new Set(sess.keys.flatMap((k) => (demand[k] || []).map((d) => d.sid)));
  sessions.sort((a, z) => demandScouts(z).size - demandScouts(a).size);
  const blockSess = Array.from({ length: nBlocks }, () => []);
  for (const sess of sessions) {
    const used = new Set(sessions.filter((x) => x.teacher === sess.teacher && x.block != null).map((x) => x.block));
    let best = null, bestScore = Infinity;
    for (let bi = 0; bi < nBlocks; bi++) {
      if (used.has(bi)) continue;
      const mine = demandScouts(sess);
      const overlap = blockSess[bi].reduce((n, o) => n + [...demandScouts(o)].filter((x) => mine.has(x)).length, 0);
      const score = overlap * 10 + blockSess[bi].length;
      if (score < bestScore) { bestScore = score; best = bi; }
    }
    if (best == null) { sess.unscheduled = true; continue; }
    sess.block = best; blockSess[best].push(sess);
  }
  const live = sessions.filter((s) => !s.unscheduled);

  // Assign: two rounds; within a round, closest to rank completion first, then longest asked.
  const assignment = {}; const busy = {};
  live.forEach((s) => { if (PEOPLE[s.teacher].kind === 'scout') (busy[s.teacher] = busy[s.teacher] || new Set()).add(s.block); });
  const oldest = (sid) => (prefs[sid] || []).reduce((a, p) => (p.asked < a ? p.asked : a), '9999');
  const order = scouts.filter((s) => (prefs[s.id] || []).length).sort((a, z) => (iv(a.id) === 'undecided') - (iv(z.id) === 'undecided') || z.pct - a.pct || oldest(a.id).localeCompare(oldest(z.id)));
  for (let round = 0; round < 2; round++) {
    for (const s of order) {
      const got = assignment[s.id] = assignment[s.id] || [];
      if (got.length >= Math.min(2, nBlocks)) continue;
      for (const p of prefs[s.id]) {
        const sess = covered[p.key];
        if (!sess || sess.unscheduled || got.some((g) => g.sessionId === sess.id)) continue;
        if (got.some((g) => g.block === sess.block) || (busy[s.id] && busy[s.id].has(sess.block)) || sess.scouts.length >= 8) continue;
        sess.scouts.push({ sid: s.id, pickNo: prefs[s.id].indexOf(p) + 1 });
        got.push({ sessionId: sess.id, block: sess.block, keys: sess.keys, key: p.key, pickNo: prefs[s.id].indexOf(p) + 1 });
        break;
      }
    }
  }
  // Undecided scouts with no picks: the engine's next-rank suggestion, into a live session.
  for (const s of scouts.filter((x) => iv(x.id) === 'undecided' && !(prefs[x.id] || []).length)) {
    const nr = nextRank(s); const sugg = (REQS[nr] || []).filter((r) => r.venue !== 'outing' && !hasFinished(s, r));
    const got = assignment[s.id] = [];
    for (const r of sugg) { const sess = covered[r.key]; if (sess && !sess.unscheduled && sess.scouts.length < 8) { sess.scouts.push({ sid: s.id, pickNo: null, placed: true }); got.push({ sessionId: sess.id, block: sess.block, keys: sess.keys, key: r.key, pickNo: null, placed: true }); break; } }
  }

  const teachingScouts = new Set(live.map((x) => x.teacher));
  const comingNothing = scouts.filter((s) => iv(s.id) && !(assignment[s.id] || []).length && !teachingScouts.has(s.id)).map((s) => ({ sid: s.id, fallback: engineFallback(s) }));
  const wanted = Object.keys(demand).filter((k) => !covered[k] || covered[k].unscheduled).map((k) => {
    const info = topicInfo(k);
    const qualified = [...ADULTS, ...SCOUTS].filter((p) => (p.kind === 'adult' || isJuniorLeader(p)) && qualifies(p.id, info) && !(info.kind === 'mb' && !(p.counselor || []).includes(info.mbId))).map((p) => ({ id: p.id, intent: iv(p.id), commits: commitsFor(m, p.id).length }));
    return { key: k, info, scouts: demand[k].map((d) => d.sid), weeks: weeksAsked(demand[k].reduce((a, d) => (d.asked < a ? d.asked : a), '9999'), m), qualified };
  }).sort((a, z) => z.scouts.length - a.scouts.length || z.weeks - a.weeks);

  const adultsNo = ADULTS.filter((a) => !iv(a.id)).map((a) => a.id);
  const scoutsNo = SCOUTS.filter((s) => !iv(s.id)).map((s) => s.id);
  const undecidedAdults = ADULTS.filter((a) => iv(a.id) === 'undecided').map((a) => ({ id: a.id, fits: wanted.filter((w) => w.qualified.some((qq) => qq.id === a.id)).map((w) => w.key) }));
  const undecidedScouts = SCOUTS.filter((s) => iv(s.id) === 'undecided').map((s) => ({ id: s.id, placed: (assignment[s.id] || [])[0] || null }));
  const blocks = blockSess.map((list) => list.sort((a, z) => z.scouts.length - a.scouts.length));
  const counts = {
    coming: SCOUTS.filter((s) => iv(s.id) === 'coming').length, undecided: undecidedScouts.length,
    notComing: SCOUTS.filter((s) => iv(s.id) === 'not_coming').length, noAnswer: scoutsNo.length,
    adultsComing: ADULTS.filter((a) => iv(a.id) === 'coming').length, live: live.length,
    picks: Object.values(demand).reduce((n, l) => n + l.length, 0)
  };
  return { blocks, sessions: live, offeredNoTakers, wanted, comingNothing, noAnswer: { scouts: scoutsNo, adults: adultsNo }, undecided: { scouts: undecidedScouts, adults: undecidedAdults }, assignment, counts, demand };
}
function commitsByAnyone(m, key) { return Object.values(state.teach[m] || {}).some((l) => l.some((c) => c.key === key)); }
function engineFallback(s) {
  const nr = nextRank(s); const r = (REQS[nr] || []).find((x) => x.venue !== 'outing' && !hasFinished(s, x));
  if (r) return `Engine: ${RANK_NAME[r.rank]} ${r.code}, ${r.label}`;
  return isJuniorLeader(s) ? 'Engine: merit badge work, or help teach' : 'Engine: merit badge work';
}
function sessionById(m, id) { return matchFor(m).sessions.find((s) => s.id === id); }

/* ───────────── Merit badge mode: rotations ───────────── */
function rotationsFor(m) {
  const b = boardFor(m);
  if (b.mode !== 'merit_badge') return null;
  const n = b.stations.length;
  const iv = (pid) => intentOf(m, pid).value;
  const coming = SCOUTS.filter((s) => iv(s.id) === 'coming' || iv(s.id) === 'undecided');
  const hasBadge = coming.filter((s) => s.awarded.includes(b.mbId)).map((s) => s.id);
  const placeable = coming.filter((s) => !s.awarded.includes(b.mbId)).map((s) => s.id);
  const ov = state.rotations[m];
  let groups;
  if (ov && ov.groups && ov.groups.length === n) {
    groups = ov.groups.map((g) => g.filter((id) => placeable.includes(id)));
    placeable.filter((id) => !groups.some((g) => g.includes(id))).forEach((id) => { groups.reduce((a, g) => (g.length < a.length ? g : a), groups[0]).push(id); });
  } else {
    groups = Array.from({ length: n }, () => []);
    const byPatrol = {};
    placeable.forEach((id) => { (byPatrol[PEOPLE[id].patrol] = byPatrol[PEOPLE[id].patrol] || []).push(id); });
    Object.values(byPatrol).sort((a, z) => z.length - a.length).forEach((members) => {
      const g = groups.reduce((a, x) => (x.length < a.length ? x : a), groups[0]);
      if (g.length + members.length <= Math.ceil(placeable.length / n) + 1) g.push(...members);
      else members.forEach((id) => groups.reduce((a, x) => (x.length < a.length ? x : a), groups[0]).push(id));
    });
  }
  const finished = (sid, st) => { const done = (PEOPLE[sid].mbDone || {})[b.mbId] || []; return st.reqs.length > 0 && st.reqs.every((r) => done.includes(r)); };
  const stationAt = (g, r) => (g + r) % n;
  const teachersAt = (si) => Object.entries(state.teach[m] || {}).filter(([, l]) => l.some((c) => c.station === si)).map(([pid]) => pid);
  const helpers = (ov && ov.helpers) || {};
  return { mbId: b.mbId, stations: b.stations, n, groups, hasBadge, helpers, finished, stationAt, teachersAt, times: rotationTimes(n),
    noAnswer: SCOUTS.filter((s) => !iv(s.id)).map((s) => s.id), notComing: SCOUTS.filter((s) => iv(s.id) === 'not_coming').map((s) => s.id) };
}
function saveRotations(m, groups, helpers) { state.rotations[m] = { groups, helpers }; save(); }

/* ───────────── Teaching-skill change log ───────────── */
function setSkills(pid, next, source, by) {
  const before = state.skills[pid] || [];
  const added = next.filter((x) => !before.includes(x)); const removed = before.filter((x) => !next.includes(x));
  const at = source === 'admin' ? 'Just now (admin)' : 'Just now';
  added.forEach((sk) => state.changes.unshift({ id: ++state.uid, whose: pid, by, skill: sk, action: 'added', source, at, reviewed: source !== 'member', reverted: false }));
  removed.forEach((sk) => state.changes.unshift({ id: ++state.uid, whose: pid, by, skill: sk, action: 'removed', source, at, reviewed: source !== 'member', reverted: false }));
  state.skills[pid] = [...next].sort((a, z) => SKILLS.findIndex((s) => s.id === a) - SKILLS.findIndex((s) => s.id === z));
  save();
  return { added, removed };
}
function unreviewedCount() { return state.changes.filter((c) => !c.reviewed && !c.reverted).length; }

/* ───────────── Chrome ───────────── */
function protoBar(text) {
  return `<div class="proto"><div class="protoInner"><span><strong>Prototype</strong> ${text}</span><span><a href="index.html">Walkthrough</a> · <button type="button" data-reset>Reset sample data</button></span></div></div>`;
}
function siteChrome(active) {
  const nav = [['Home', '#'], ['Calendar', '#'], ['News', '#'], ['Advancement', '#'], ['Members', 'member.html']];
  return `<div class="mast"><div class="mastInner"><a class="mastName" href="index.html">Scout Troop 79</a><span class="mastSub">Milwaukee, Wisconsin</span></div></div>
  <nav class="mainNav" aria-label="Site"><ul class="navInner">${nav.map(([t, h]) => `<li><a href="${h}"${active === t ? ' aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul></nav>`;
}
function adminChrome(active) {
  const n = unreviewedCount();
  const nav = [['Home', 'admin-home.html'], ['Calendar', 'admin-setup.html'], ['Meeting Plan', 'admin-plan.html'], ['Lookups', 'admin-lookups.html']];
  return `<div class="adminTop"><div class="adminTopInner"><nav aria-label="Admin">${nav.map(([t, h]) => `<a href="${h}"${active === t ? ' aria-current="page"' : ''}>${t}${t === 'Home' && n ? ` (${n})` : ''}</a>`).join('')}</nav><span>Troop 79 Admin · ${esc(PEOPLE[LEADER_ID].name)}</span></div></div>`;
}
function wireReset(after) {
  document.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => { resetState(); if (after) after(); else location.reload(); }));
}
function announce(msg) { const r = document.getElementById('live'); if (r) { r.textContent = ''; setTimeout(() => { r.textContent = msg; }, 30); } }
function meetingOptions(sel, filter) { return MEETINGS.filter((x) => !x.past && (!filter || filter(x))).map((x) => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${x.short} · ${esc(x.title)}</option>`).join(''); }
function whenOptions() { return Object.entries(WHEN).map(([k, v]) => `<option value="${k}"${state.when === k ? ' selected' : ''}>${v.label}</option>`).join(''); }
function setParam(k, v) { const u = new URL(location.href); u.searchParams.set(k, v); history.replaceState(null, '', u); }
/* Re-render without losing keyboard focus: elements carry data-fid. */
function keepFocus(fn) {
  const a = document.activeElement; const fid = a && a.getAttribute && a.getAttribute('data-fid');
  fn();
  if (fid) { const el = document.querySelector(`[data-fid="${CSS.escape(fid)}"]`); if (el) el.focus({ preventScroll: true }); }
}

/* ───────────── Personas (prototype only) ───────────── */
const PERSONAS = {
  finn: { id: 's-finn', label: 'Finn P · scout, Tenderfoot' },
  rachel: { id: 'a-rpeterson', label: 'Rachel P · parent of 3, no leader role, teaches' },
  vest: { id: 'a-vest', label: 'Dan V (Mr. Vest) · leader' },
  grace: { id: 's-grace', label: 'Grace H · Junior Leader (First Class)' },
  eli: { id: 's-eli', label: 'Eli D · First Class, grade 7 (Junior Leader by rank)' },
  zoe: { id: 's-zoe', label: 'Zoe W · Second Class, grade 9 (Junior Leader by grade)' },
  theo: { id: 's-theo', label: 'Theo P · Star, nothing left at a meeting' },
  maya: { id: 's-maya', label: 'Maya C · Life, already has Cooking' },
  leo: { id: 's-leo', label: 'Leo M · new scout' },
  ruiz: { id: 'a-ruiz', label: 'Jorge R · parent, no skills yet' }
};
function personaOptions(sel) { return Object.entries(PERSONAS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.label)}</option>`).join(''); }
const INTENT_LABEL = { coming: 'Coming', undecided: 'Not sure yet', not_coming: 'Can’t make it' };

/* One line of live state for a person on a meeting: "Coming · 3 picks". */
function scoutLine(m, sid) {
  const b = boardFor(m);
  if (b.mode === 'closed') return 'No sign-ups this week';
  const it = intentOf(m, sid).value;
  if (b.mode === 'merit_badge') {
    if (PEOPLE[sid].awarded.includes(b.mbId)) return it ? `${INTENT_LABEL[it]} · has the badge` : `No answer yet · has the badge`;
    return it ? `${MB[b.mbId].name} night · ${INTENT_LABEL[it]}` : `${MB[b.mbId].name} night · No answer yet`;
  }
  if (it === 'not_coming') return 'Can’t make it';
  if (isPublished(m)) {
    const got = (matchFor(m).assignment[sid] || []);
    if (got.length) return `You’re in ${got.map((g) => sessionTitle(sessionById(m, g.sessionId).keys).title).join(' and ')}`;
  }
  const n = picksFor(m, sid).length;
  if (!it) return n ? `${plural(n, 'pick')}` : 'No answer yet';
  return `${INTENT_LABEL[it]}${n ? ` · ${plural(n, 'pick')}` : ''}`;
}
function adultLine(m, pid) {
  const b = boardFor(m);
  if (b.mode === 'closed') return 'No sign-ups this week';
  const it = intentOf(m, pid).value;
  const n = commitsFor(m, pid).length + offersFor(m, pid).length;
  if (!it) return 'No answer yet';
  if (it === 'not_coming') return 'Can’t make it';
  return `${INTENT_LABEL[it]}${n ? ` · teaching ${n}` : ''}`;
}
function canTeachCard(pid) { const p = PEOPLE[pid]; return p.kind === 'adult' || isJuniorLeader(p); }

/* Deep links for the walkthrough: ?when=set, ?publish=nov1 (promotes every matched
   session, then publishes), ?unpublish=nov1, ?fresh=1 (reset sample data first). */
function publishAll(m) {
  const b = boardFor(m); state.promoted[m] = [];
  if (b.mode === 'rank') matchFor(m).sessions.slice().sort((a, z) => a.block - z.block).forEach((s) => state.promoted[m].push({ id: s.id, block: s.block, keys: s.keys, teacher: s.teacher, scouts: s.scouts.map((x) => x.sid) }));
  if (b.mode === 'merit_badge') { const r = rotationsFor(m); state.promoted[m].push({ id: 'rotations', block: 0, rot: true, title: MB[r.mbId].name + ' rotations', scouts: r.groups.flat(), stations: r.stations, teachers: r.stations.map((_, i) => r.teachersAt(i)) }); }
  state.published[m] = true;
}
(function deepLinks() {
  const p = new URLSearchParams(location.search); let changed = false;
  if (p.get('fresh')) { state = seed(); changed = true; }
  if (p.get('when') && WHEN[p.get('when')]) { state.when = p.get('when'); changed = true; }
  if (p.get('publish') && MEETING[p.get('publish')]) { publishAll(p.get('publish')); changed = true; }
  if (p.get('unpublish') && MEETING[p.get('unpublish')]) { state.published[p.get('unpublish')] = false; state.promoted[p.get('unpublish')] = []; changed = true; }
  if (changed) { save(); ['fresh', 'when', 'publish', 'unpublish'].forEach((k) => p.delete(k)); history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : '') + location.hash); }
})();
