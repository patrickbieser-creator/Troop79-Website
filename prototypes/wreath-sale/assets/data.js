/* Wreath sale prototype — shared data + helpers.
   Every total on every screen is computed from CATALOG + ORDERS below, so the
   books, the scout's earnings, the Rose order and the leaderboard always agree.
   Prices and unit costs are the 2026 sheet's. Prototype "today" is 2026-10-12. */

const SALE = {
  year: 2026,
  today: '2026-10-12',
  round1: { date: '2026-10-25', label: 'Saturday, October 25' },
  round2: { date: '2026-11-15', label: 'Saturday, November 15' },
  zipPrefix: '532',
  feePct: 0.0199,           // PayPal US nonprofit rate (assumed; spec: "about 2% + $0.49")
  feeFixed: 0.49,
  scoutShare: 0.30,
  pickup: {
    day: 'Saturday, December 6',
    window: '9 a.m. to noon',
    place: 'Immanuel Lutheran Church, 1100 N Astor St',
    note: 'Fellowship hall, Astor Street door'
  },
  deliveryWindow: 'Saturday, December 6 or Sunday, December 7',
  contactEmail: 'bsatroop79bg@gmail.com'
};

/* kind drives the placeholder art; group drives the store's section headings */
const CATALOG = [
  { n: 1,  name: 'Wreath',               size: '20″', kind: 'ring',   group: 'wreaths', price: 26, cost: 16.07, desc: 'Fresh mixed greens, pine cones and a red bow. Fits a standard front door.' },
  { n: 2,  name: 'Wreath',               size: '26″', kind: 'ring',   group: 'wreaths', price: 32, cost: 18.24, desc: 'A fuller door wreath with cones and a red bow attached.' },
  { n: 3,  name: 'Wreath',               size: '36″', kind: 'ring',   group: 'wreaths', price: 42, cost: 27.87, desc: 'For a wide door, a gate or a garage. Bow attached.' },
  { n: 4,  name: 'Wreath',               size: '48″', kind: 'ring',   group: 'wreaths', price: 52, cost: 38.04, desc: 'For a garage or a big wall. Bow comes unattached; hanger not included.' },
  { n: 5,  name: 'Wreath',               size: '60″', kind: 'ring',   group: 'wreaths', price: 60, cost: 45.47, desc: 'For a barn, a church or a storefront. Bow comes unattached.' },
  { n: 6,  name: 'Wreath',               size: '72″', kind: 'ring',   group: 'wreaths', price: 76, cost: 57.02, desc: 'Our largest. Bow comes unattached; it takes two people to hang.' },
  { n: 7,  name: 'Double wreath',        size: '36″', kind: 'double', group: 'wreaths', price: 55, cost: 39.55, desc: 'Greens on both faces, for a window, a fence or anywhere seen from both sides.' },
  { n: 8,  name: 'Double wreath',        size: '48″', kind: 'double', group: 'wreaths', price: 70, cost: 50.35, desc: 'The larger two-sided wreath. Bow comes unattached.' },
  { n: 21, name: 'Extra Special wreath', size: '24″', kind: 'boxed',  group: 'boxed',   price: 42, cost: 29.85, desc: 'Decorated with cones, berries and ribbon, and boxed, ready to give.' },
  { n: 22, name: 'Platinum wreath',      size: '24″', kind: 'boxed',  group: 'boxed',   price: 46, cost: 32.70, desc: 'Our most decorated wreath, boxed, ready to give or ship yourself.' },
  { n: 9,  name: 'Candy cane',           size: '36″',  kind: 'cane',   group: 'shapes',  price: 30, cost: 20.25, desc: 'Greens shaped into a candy cane with a red bow, for a door or a lamp post.' },
  { n: 20, name: 'Cross',                size: '36″', kind: 'cross',  group: 'shapes',  price: 40, cost: 27.65, desc: 'A cross of greens, often placed at a cemetery. Easel sold separately.' },
  { n: 10, name: 'Swag',                 size: '30″',  kind: 'swag',   group: 'shapes',  price: 20, cost: 13.62, desc: 'A flat spray of greens with a bow, for a door, a mailbox or a gate.' },
  { n: 11, name: 'Roping',               size: '25 ft', kind: 'roping', group: 'shapes', price: 42, cost: 31.82, desc: 'Pine roping for railings, porches and doorways. One 25-foot length.' },
  { n: 12, name: 'Tabletop tree',        size: '18″', kind: 'tree',   group: 'trees',   price: 55, cost: 43.25, desc: 'A small tree for a table or a windowsill, ready to decorate.' },
  { n: 13, name: 'Tabletop tree',        size: '27″', kind: 'tree',   group: 'trees',   price: 75, cost: 55.05, desc: 'A bigger tabletop tree for an entry or a porch. Stand included.' },
  { n: 14, name: 'Centerpiece',          size: '',    kind: 'center', group: 'trees',   price: 50, cost: 38.65, desc: 'A low table arrangement with a candle holder. Candle not included.' },
  { n: 15, name: 'Easel',                size: '30″',  kind: 'easel',  group: 'extras',  price: 10, cost: 5.85,  desc: 'A wire stand that holds a wreath or cross upright at a grave or on a porch.' },
  { n: 16, name: 'Door hanger',          size: '15″',  kind: 'hanger', group: 'extras',  price: 5,  cost: 4.05,  desc: 'An over-the-door hook for wreaths up to 26″. No nails needed.' }
];
const GROUPS = [
  { id: 'wreaths', title: 'Wreaths' },
  { id: 'boxed',   title: 'Decorated and boxed' },
  { id: 'shapes',  title: 'Shapes and greens' },
  { id: 'trees',   title: 'Trees and table' },
  { id: 'extras',  title: 'Hangers and stands' }
];
/* What a customer can donate to veterans: the two door wreaths. */
const DONATABLE = [1, 2];

/* Sellers. Customer-facing name is always first name + last initial. */
const SELLERS = [
  { slug: 'ben-b',   name: 'Ben B.',   full: 'Ben Brandt',    goal: 30, active: true,
    message: 'Hi! I’m selling wreaths to help pay for Philmont next summer. Thank you for supporting Troop 79!', msgStatus: 'approved' },
  { slug: 'fiona-k', name: 'Fiona K.', full: 'Fiona Kessler', goal: 20, active: true,
    message: 'Every wreath helps our troop go camping. I’ll deliver yours myself!', msgStatus: 'approved' },
  { slug: 'henry-e', name: 'Henry E.', full: 'Henry Ellison', goal: 15, active: true, message: '', msgStatus: 'none' },
  { slug: 'lucy-l',  name: 'Lucy L.',  full: 'Lucy Lindgren', goal: 25, active: true,
    message: 'I’m saving for summer camp at Camp Long Lake. Thanks for ordering!', msgStatus: 'pending' },
  { slug: 'owen-r',  name: 'Owen R.',  full: 'Owen Ruiz',     goal: 10, active: true, message: '', msgStatus: 'none' },
  { slug: 'jonah-m', name: 'Jonah M.', full: 'Jonah Mueller', goal: 0,  active: false, message: '', msgStatus: 'none' }
];
/* Scouts on the roster who are not sellers yet (Admin › Sellers picker). */
const ROSTER_NOT_SELLING = ['Anjali P.|Anjali Patel', 'Charlie W.|Charlie Walters', 'Maya S.|Maya Sorensen', 'Nora P.|Nora Pfeiffer', 'Sam T.|Sam Thao'];

/* Sample orders. seller null = troop store. fulfill: scout | pickup | delivery | none (all donated). */
const ORDERS = [
  { id: 'W-1001', round: 1, placed: '2026-10-03', seller: 'ben-b', source: 'link', fulfill: 'scout', cust: { name: 'Margaret Brandt', email: 'mbrandt47@gmail.com', phone: '414-555-0172', addr: '2814 N Bartlett Ave', zip: '53211' },
    lines: [{ n: 2, q: 2 }, { n: 11, q: 1 }], gift: 10, cover: false, pay: 'paid', method: 'PayPal' },
  { id: 'W-1002', round: 1, placed: '2026-10-03', seller: null, source: 'store', fulfill: 'pickup', cust: { name: 'Rev. Karen Olsen', email: 'kolsen@immanuelmke.org', phone: '414-555-0110', addr: '', zip: '' },
    lines: [{ n: 5, q: 1 }, { n: 20, q: 2 }, { n: 15, q: 2 }], gift: 0, cover: true, pay: 'paid', method: 'Card' },
  { id: 'W-1004', round: 1, placed: '2026-10-04', seller: 'ben-b', source: 'link', fulfill: 'scout', cust: { name: 'Tom Reyes', email: 'tom.reyes@outlook.com', phone: '414-555-0148', addr: '1702 E Royall Pl', zip: '53202' },
    lines: [{ n: 3, q: 1 }, { n: 16, q: 1 }], gift: 0, cover: true, pay: 'paid', method: 'Venmo' },
  { id: 'W-1005', round: 1, placed: '2026-10-04', seller: 'fiona-k', source: 'link', fulfill: 'scout', cust: { name: 'Diane Kessler', email: 'dkessler@gmail.com', phone: '262-555-0193', addr: '4410 N Maryland Ave', zip: '53211' },
    lines: [{ n: 1, q: 2 }, { n: 10, q: 2 }], gift: 0, cover: false, pay: 'paid', method: 'PayPal' },
  { id: 'W-1006', round: 1, placed: '2026-10-05', seller: 'henry-e', source: 'link', fulfill: 'scout', cust: { name: 'Walter Ellison', email: 'wellison@att.net', phone: '920-555-0121', addr: '612 Lake St', zip: '54220' }, relative: true,
    lines: [{ n: 21, q: 1 }, { n: 1, q: 1, donated: true }], gift: 25, cover: false, pay: 'paid', method: 'PayPal' },
  { id: 'W-1007', round: 1, placed: '2026-10-05', seller: null, source: 'store', fulfill: 'delivery', cust: { name: 'Janelle Price', email: 'jprice@gmail.com', phone: '414-555-0166', addr: '3125 S Delaware Ave', zip: '53207' },
    lines: [{ n: 2, q: 1 }, { n: 16, q: 1 }], gift: 0, cover: false, pay: 'paid', method: 'Card' },
  { id: 'W-1009', round: 1, placed: '2026-10-06', seller: 'ben-b', source: 'link', fulfill: 'scout', cust: { name: 'Carol Bieber', email: 'carolb@comcast.net', phone: '773-555-0139', addr: '2240 N Lincoln Ave, Chicago', zip: '60614' }, relative: true,
    lines: [{ n: 21, q: 1 }, { n: 1, q: 1, donated: true }], gift: 0, cover: true, pay: 'paid', method: 'PayPal' },
  { id: 'W-1011', round: 1, placed: '2026-10-07', seller: 'lucy-l', source: 'paper', fulfill: 'scout', cust: { name: 'Ruth Lindgren', email: '', phone: '414-555-0177', addr: '5210 N Lake Dr', zip: '53217' },
    lines: [{ n: 2, q: 1 }, { n: 12, q: 1 }, { n: 9, q: 1 }], gift: 0, cover: false, pay: 'paid', method: 'Check' },
  { id: 'W-1013', round: 1, placed: '2026-10-07', seller: 'ben-b', source: 'paper', fulfill: 'scout', cust: { name: 'Dan Kowalski', email: '', phone: '414-555-0185', addr: '2830 N Bartlett Ave', zip: '53211' },
    lines: [{ n: 1, q: 2 }, { n: 10, q: 1 }], gift: 0, cover: false, pay: 'paid', method: 'Cash' },
  { id: 'W-1014', round: 1, placed: '2026-10-08', seller: 'owen-r', source: 'link', fulfill: 'scout', cust: { name: 'Gloria Ruiz', email: 'gruiz@yahoo.com', phone: '414-555-0102', addr: '1935 S 6th St', zip: '53204' },
    lines: [{ n: 4, q: 1 }, { n: 2, q: 1 }], gift: 5, cover: false, pay: 'unpaid', method: '' },
  { id: 'W-1016', round: 1, placed: '2026-10-08', seller: 'lucy-l', source: 'link', fulfill: 'scout', cust: { name: 'Mark Anders', email: 'manders@gmail.com', phone: '414-555-0154', addr: '4820 N Woodruff Ave', zip: '53217' },
    lines: [{ n: 3, q: 1 }, { n: 11, q: 2 }], gift: 0, cover: false, pay: 'paid', method: 'PayPal' },
  { id: 'W-1017', round: 1, placed: '2026-10-09', seller: 'ben-b', source: 'paper', fulfill: 'scout', cust: { name: 'Sue Ortiz', email: '', phone: '414-555-0126', addr: '2906 N Murray Ave', zip: '53211' },
    lines: [{ n: 13, q: 1 }, { n: 14, q: 1 }], gift: 0, cover: false, pay: 'unpaid', method: '' },
  { id: 'W-1019', round: 1, placed: '2026-10-09', seller: 'fiona-k', source: 'link', fulfill: 'scout', cust: { name: 'Aaron Feld', email: 'afeld@uwm.edu', phone: '414-555-0115', addr: '3011 N Cramer St', zip: '53211' },
    lines: [{ n: 7, q: 1 }, { n: 1, q: 2, donated: true }], gift: 0, cover: true, pay: 'paid', method: 'Card' },
  { id: 'W-1021', round: 1, placed: '2026-10-10', seller: 'ben-b', source: 'link', fulfill: 'scout', cust: { name: 'Greg Holm', email: 'gholm@gmail.com', phone: '414-555-0161', addr: '4718 N Ardmore Ave', zip: '53217' },
    lines: [{ n: 2, q: 3 }, { n: 9, q: 1 }], gift: 0, cover: false, pay: 'unpaid', method: '' },
  { id: 'W-1022', round: 1, placed: '2026-10-10', seller: null, source: 'store', fulfill: 'none', cust: { name: 'Helen Vogt', email: 'hvogt@gmail.com', phone: '608-555-0108', addr: '', zip: '' },
    lines: [{ n: 2, q: 4, donated: true }], gift: 0, cover: true, pay: 'paid', method: 'PayPal' },
  { id: 'W-1026', round: 1, placed: '2026-10-11', seller: 'ben-b', source: 'link', fulfill: 'scout', cust: { name: 'Pat Lindqvist', email: 'plindqvist@gmail.com', phone: '414-555-0190', addr: '3240 N Hackett Ave', zip: '53211' },
    lines: [{ n: 7, q: 1 }, { n: 20, q: 1 }], gift: 0, cover: false, pay: 'paid', method: 'Check' },
  /* Round 2 (shows how "Changes" will look after Oct 25) */
  { id: 'W-1041', round: 2, placed: '2026-10-29', seller: 'henry-e', source: 'paper', fulfill: 'scout', cust: { name: 'Lena Ellison', email: '', phone: '414-555-0133', addr: '2621 N Stowell Ave', zip: '53211' },
    lines: [{ n: 2, q: 1 }, { n: 8, q: 1 }], gift: 0, cover: false, pay: 'unpaid', method: '' },
  { id: 'W-1044', round: 2, placed: '2026-11-02', seller: null, source: 'store', fulfill: 'pickup', cust: { name: 'Bob Grabowski', email: 'bgrab@gmail.com', phone: '414-555-0144', addr: '', zip: '' },
    lines: [{ n: 1, q: 3 }, { n: 22, q: 1 }], gift: 10, cover: false, pay: 'paid', method: 'PayPal' }
];

/* ── helpers ── */
const item = n => CATALOG.find(c => c.n === n);
const seller = slug => SELLERS.find(s => s.slug === slug);
const money = v => '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/.00$/, '');
const money2 = v => '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const itemLabel = c => (c.size ? c.size + ' ' : '') + c.name.toLowerCase().replace(/^./, m => m.toUpperCase());
const itemTitle = c => c.name + (c.size ? ' · ' + c.size : '');
const profitOf = n => +(item(n).price - item(n).cost).toFixed(2);

function orderCalc(o) {
  let items = 0, sale = 0, cost = 0, profit = 0, donated = 0;
  o.lines.forEach(l => {
    const c = item(l.n);
    items += l.q; sale += c.price * l.q; cost += c.cost * l.q; profit += (c.price - c.cost) * l.q;
    if (l.donated) donated += l.q;
  });
  const fee = o.cover ? feeFor(sale + (o.gift || 0)) : 0;
  const total = sale + (o.gift || 0) + fee;
  const scoutShare = o.seller ? profit * SALE.scoutShare : 0;
  return { items, sale, cost, profit, donated, fee, total, scoutShare, paid: o.pay === 'paid' ? total : 0, due: o.pay === 'paid' ? 0 : total };
}
function sellerStats(slug) {
  const os = ORDERS.filter(o => o.seller === slug);
  const t = { orders: os.length, items: 0, sale: 0, profit: 0, share: 0, paid: 0, due: 0, methods: new Set() };
  os.forEach(o => { const c = orderCalc(o); t.items += c.items; t.sale += c.sale; t.profit += c.profit; t.share += c.scoutShare; t.paid += c.paid; t.due += c.due; if (o.method) t.methods.add(o.method); });
  return t;
}
function feeFor(subtotal) { return subtotal > 0 ? Math.round((subtotal * SALE.feePct + SALE.feeFixed) * 100) / 100 : 0; }
function zipOk(z) { return /^\d{5}$/.test(z) && z.startsWith(SALE.zipPrefix); }
function linesSummary(lines) {
  return lines.map(l => (l.q > 1 ? l.q + ' × ' : '') + itemLabel(item(l.n)) + (l.donated ? ' (donated)' : '')).join(', ');
}
function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

/* ── cart (localStorage so it survives store → checkout) ── */
const CART_KEY = 'wreath-proto-cart';
function cartGet() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || { lines: {}, seller: null, source: 'store' }; }
  catch (e) { return { lines: {}, seller: null, source: 'store' }; }
}
function cartSet(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); }
/* line key: "<catalog#>" or "<catalog#>d" for donated */
function cartLines(c) {
  return Object.entries(c.lines).filter(([, q]) => q > 0).map(([k, q]) => ({ key: k, n: parseInt(k, 10), donated: k.endsWith('d'), q }));
}
function cartTotals(c) {
  let items = 0, sale = 0;
  cartLines(c).forEach(l => { items += l.q; sale += item(l.n).price * l.q; });
  return { items, sale };
}
/* prototype-only switches (checkout page controls) */
const PROTO_KEY = 'wreath-proto-mode';
function protoGet() { try { return JSON.parse(localStorage.getItem(PROTO_KEY)) || { pay: 'paypal', result: 'ok' }; } catch (e) { return { pay: 'paypal', result: 'ok' }; } }
function protoSet(p) { localStorage.setItem(PROTO_KEY, JSON.stringify(p)); }

/* ── Rose's product photos (Images/ at the project root, copied to assets/img). Every item has one;
   placeholderArt() is the fallback for an item added without a photo. ── */
const PHOTOS = {
  1: 'wreath-20', 2: 'wreath-26', 3: 'wreath-36', 4: 'wreath-48', 5: 'wreath-60', 6: 'wreath-72',
  7: 'wreath-double-face-36', 8: 'wreath-double-face-48', 9: 'cane-36', 10: 'door-swag-30',
  11: 'garland-25', 12: 'christmas-tree-18', 13: 'christmas-tree-27', 14: 'centerpiece', 15: 'easel-30',
  16: 'door-hanger-15', 20: 'cross-36', 21: 'wreath-special-24', 22: 'wreath-platinum-24'
};

function wreathArt(c, cls) {
  if (PHOTOS[c.n]) {
    return `<img class="${cls || 'art'} photo" src="assets/img/${PHOTOS[c.n]}.jpg" alt="${esc(itemTitle(c))}" loading="lazy">`;
  }
  return placeholderArt(c, cls);
}

/* ── placeholder art: inline SVG silhouettes in brand greens ── */
function placeholderArt(c, cls) {
  const g1 = '#3d5a3e', g2 = '#527554', red = '#8c3b3b', bark = '#8b6914';
  const bow = (x, y) => `<path d="M${x} ${y} l-14 -8 v16 z M${x} ${y} l14 -8 v16 z" fill="${red}"/><circle cx="${x}" cy="${y}" r="4" fill="${red}"/><path d="M${x - 3} ${y + 3} l-6 16 M${x + 3} ${y + 3} l6 16" stroke="${red}" stroke-width="3"/>`;
  const ring = (r, w) => {
    let s = `<circle cx="100" cy="92" r="${r}" fill="none" stroke="${g1}" stroke-width="${w}"/>`;
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, x = 100 + r * Math.cos(a), y = 92 + r * Math.sin(a); s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="4" fill="${i % 2 ? g2 : g1}" transform="rotate(${(i * 15 + 60) % 180} ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }
    return s;
  };
  let art = '';
  switch (c.kind) {
    case 'ring': art = ring(48, 18) + bow(100, 140); break;
    case 'double': art = ring(48, 24) + `<circle cx="100" cy="92" r="30" fill="none" stroke="${g2}" stroke-width="3" stroke-dasharray="4 5"/>` + bow(100, 140); break;
    case 'boxed': art = `<rect x="38" y="30" width="124" height="124" rx="4" fill="#f4efe6" stroke="${bark}" stroke-width="2"/>` + ring(42, 16) + `<circle cx="72" cy="66" r="4" fill="${red}"/><circle cx="130" cy="110" r="4" fill="${red}"/><circle cx="66" cy="112" r="3" fill="${bark}"/>` + bow(100, 134); break;
    case 'cane': art = `<path d="M118 160 V70 a26 26 0 0 0 -52 0" fill="none" stroke="${g1}" stroke-width="20" stroke-linecap="round"/><path d="M118 160 V70 a26 26 0 0 0 -52 0" fill="none" stroke="${g2}" stroke-width="6" stroke-dasharray="6 10"/>` + bow(118, 96); break;
    case 'cross': art = `<rect x="88" y="26" width="24" height="136" fill="${g1}"/><rect x="52" y="62" width="96" height="24" fill="${g1}"/><rect x="94" y="30" width="12" height="128" fill="${g2}" opacity=".6"/>` + bow(100, 74); break;
    case 'swag': art = `<path d="M100 40 C70 80 60 120 64 160 M100 40 C100 90 100 120 100 165 M100 40 C130 80 140 120 136 160" stroke="${g1}" stroke-width="16" stroke-linecap="round" fill="none"/>` + bow(100, 52); break;
    case 'roping': art = `<path d="M20 70 Q60 120 100 70 T180 70" stroke="${g1}" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M20 70 Q60 120 100 70 T180 70" stroke="${g2}" stroke-width="5" fill="none" stroke-dasharray="3 7"/><path d="M30 120 Q70 165 110 120 T190 120" stroke="${g1}" stroke-width="16" fill="none" stroke-linecap="round" opacity=".55"/>`; break;
    case 'tree': art = `<path d="M100 26 L140 92 H120 L150 140 H50 L80 92 H60 Z" fill="${g1}"/><path d="M100 40 L126 86 H74 Z" fill="${g2}"/><rect x="88" y="140" width="24" height="18" fill="${bark}"/><rect x="74" y="156" width="52" height="8" fill="#787060"/>`; break;
    case 'center': art = `<ellipse cx="100" cy="128" rx="70" ry="20" fill="${g1}"/><ellipse cx="100" cy="120" rx="54" ry="14" fill="${g2}"/><rect x="92" y="70" width="16" height="48" fill="#faf6ef" stroke="#c8bfaf"/><path d="M100 56 q6 8 0 14 q-6 -6 0 -14" fill="${bark}"/><circle cx="62" cy="122" r="5" fill="${red}"/><circle cx="140" cy="124" r="5" fill="${red}"/>`; break;
    case 'easel': art = `<path d="M100 30 L60 166 M100 30 L140 166 M100 30 L100 166 M72 120 H128" stroke="#555" stroke-width="5" fill="none" stroke-linecap="round"/>`; break;
    case 'hanger': art = `<path d="M70 30 H120 V64 M70 30 V48 M120 64 q0 30 -20 30 q-14 0 -14 -14" stroke="#555" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M96 98 V160" stroke="#c8bfaf" stroke-width="2" stroke-dasharray="4 4"/>`; break;
  }
  const label = c.size ? `<text x="190" y="176" text-anchor="end" font-family="Open Sans, Arial, sans-serif" font-size="15" font-weight="700" fill="#787060">${c.size}</text>` : '';
  return `<svg class="${cls || 'art'}" viewBox="0 0 200 184" role="img" aria-label="Photo coming soon: ${esc(itemTitle(c))}"><rect width="200" height="184" fill="#f4efe6"/>${art}${label}</svg>`;
}

/* shared site header (keeps every page consistent) */
function siteChrome(active) {
  const nav = [['index.html', 'Prototype index'], ['store.html', 'Wreaths'], ['my-orders.html', 'Members'], ['admin.html', 'Admin']];
  return `<div class="mast"><div class="mastInner"><a class="mastName" href="index.html">Scout Troop 79</a><span class="mastSub">Milwaukee, Wisconsin</span></div></div>
  <nav class="mainNav" aria-label="Site"><ul class="navInner">${nav.map(([h, t]) => `<li><a href="${h}"${active === h ? ' aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul></nav>`;
}
