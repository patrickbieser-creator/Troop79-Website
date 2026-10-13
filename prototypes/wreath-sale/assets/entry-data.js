/* "My customer" mode prototype — shared by scout-entry / my-orders-entry / admin-orders-entry.
   Loaded AFTER data.js. Adds Oliver P. and his family's orders to the existing arrays, plus the
   prototype-only switches (pretend date, who is signed in) and the floating notes panel. */

SELLERS.push({ slug: 'oliver-p', name: 'Oliver P.', full: 'Oliver Prescott', goal: 25, active: true,
  message: 'I’m saving for Philmont next summer. Thank you for helping Troop 79 and me get there!', msgStatus: 'approved' });

const FAMILY = {
  scout:  { who: 'Oliver',        label: 'Oliver Prescott',                 email: 'oliver.prescott@gmail.com' },
  parent: { who: 'Dana Prescott', label: 'Dana Prescott (Oliver’s parent)', email: 'dana.prescott@gmail.com' }
};

/* Scout-entered orders carry: entered {by, role}, collected (the scout has the money), payNote.
   They are source 'paper', fulfill 'scout', no address, no fees. */
ORDERS.push(
  { id: 'W-1031', round: 1, placed: '2026-10-08', seller: 'oliver-p', source: 'paper', fulfill: 'scout', entered: { by: 'Oliver', role: 'scout' },
    cust: { name: 'Grandma Sue', phone: '414-555-0119', email: '', addr: '', zip: '', note: 'Front porch is fine.' },
    lines: [{ n: 2, q: 2 }, { n: 16, q: 1 }], gift: 0, cover: false, collected: true, payNote: 'Cash at the Oct 9 meeting, gave it to Patrick', pay: 'paid', method: '' },
  { id: 'W-1034', round: 1, placed: '2026-10-09', seller: 'oliver-p', source: 'paper', fulfill: 'scout', entered: { by: 'Oliver', role: 'scout' },
    cust: { name: 'Mr. Hendricks, next door', phone: '', email: '', addr: '', zip: '', note: '' },
    lines: [{ n: 3, q: 1 }, { n: 11, q: 1 }], gift: 0, cover: false, collected: false, payNote: '', pay: 'unpaid', method: '' },
  { id: 'W-1036', round: 1, placed: '2026-10-09', seller: 'oliver-p', source: 'link', fulfill: 'scout',
    cust: { name: 'Lena Park', email: 'lpark@gmail.com', phone: '414-555-0171', addr: '3321 N Frederick Ave', zip: '53211' },
    lines: [{ n: 2, q: 1 }, { n: 12, q: 1 }], gift: 0, cover: false, pay: 'paid', method: 'PayPal' },
  { id: 'W-1038', round: 1, placed: '2026-10-11', seller: 'oliver-p', source: 'paper', fulfill: 'scout', entered: { by: 'Dana Prescott', role: 'parent' },
    cust: { name: 'Aunt Joan', phone: '262-555-0144', email: 'joan.ruiz@yahoo.com', addr: '', zip: '', note: 'One for the veterans, one for her.' },
    lines: [{ n: 21, q: 1 }, { n: 1, q: 1, donated: true }], gift: 0, cover: false, collected: true, payNote: 'Venmo’d Patrick 10/11', pay: 'unpaid', method: '' },
  { id: 'W-1039', round: 1, placed: '2026-10-10', seller: 'oliver-p', source: 'paper', fulfill: 'scout', entered: { by: 'Oliver', role: 'scout' }, cancelled: { by: 'Oliver', on: '2026-10-11' },
    cust: { name: 'Coach Dahl', phone: '', email: '', addr: '', zip: '', note: '' },
    lines: [{ n: 5, q: 1 }], gift: 0, cover: false, collected: false, payNote: '', pay: 'unpaid', method: '' }
);
/* Orders placed in the prototype (scout-entry.html) survive a page change so you can see them elsewhere. */
const NEW_KEY = 'wreath-entry-new';
try { JSON.parse(localStorage.getItem(NEW_KEY) || '[]').forEach(o => ORDERS.push(o)); } catch (e) { /* none */ }
const nextOrderId = () => 'W-' + (1050 + ORDERS.filter(o => o.id >= 'W-1050').length);

/* ── Pretend date + pretend viewer (shared across the three pages) ── */
const TODAYS = [
  { id: 'oct12', date: '2026-10-12', label: 'Oct 12 · round 1 open' },
  { id: 'oct27', date: '2026-10-27', label: 'Oct 27 · after the Oct 25 cutoff (round 2)' },
  { id: 'nov16', date: '2026-11-16', label: 'Nov 16 · sale closed' }
];
const pGet = (k, d) => { try { return localStorage.getItem('wreath-entry-' + k) || d; } catch (e) { return d; } };
const pSet = (k, v) => { try { localStorage.setItem('wreath-entry-' + k, v); } catch (e) { /* ignore */ } };
const pToday = () => TODAYS.find(t => t.id === pGet('today', 'oct12')) || TODAYS[0];
const phase = () => { const d = pToday().date; return d <= SALE.round1.date ? 'r1' : d <= SALE.round2.date ? 'r2' : 'closed'; };
/* A round-1 order is editable until the round-1 cutoff; a round-2 order until the round-2 cutoff. */
const canEditRound = o => o.round === 1 ? phase() === 'r1' : phase() !== 'closed';
const cutoffLabel = o => (o.round === 1 ? SALE.round1 : SALE.round2).label;
const pViewer = () => pGet('viewer', 'scout');   // scout | parent | out

const isScoutEntered = o => !!o.entered;

/* ── Shared site chrome for the three pages ── */
function entryChrome(active) {
  return siteChrome(active).replace('my-orders.html', 'my-orders-entry.html').replace('admin.html', 'admin-orders-entry.html');
}

/* ── Plan's open questions, answered (shown in every notes panel) ── */
const OPEN_QS = `
  <h4>Plan open questions: my recommendation</h4>
  <ul>
    <li><strong>Who gets the confirmation?</strong> <span class="rec">The person signed in, always. When the scout enters it, also copy the household’s parents who have an email (deduped). When a parent enters it, only that parent. Never the customer.</span> Parents hold the Venmo and cash risk; scouts rarely read their own mail.</li>
    <li><strong>Cancel or edit only?</strong> <span class="rec">Cancel, until the round cutoff, as a soft cancel:</span> the order stays in Admin as Cancelled (who, when), drops out of the Rose count and the scout’s totals. Two-step inline confirm, no dialog. Once the treasurer marks it Paid, or after the cutoff, only a leader can change or cancel it.</li>
    <li><strong>Donated wreaths and the cash gift?</strong> <span class="rec">Donated wreaths yes; cash gift no.</span> A donated wreath is a normal line item and counts toward credit. The gift sits outside the 30% split and makes “Money collected” two numbers. The online checkout is the only place it lives today. Easy to add if you disagree: one “Gift to Troop 79” row under the cart.</li>
  </ul>`;

/* ── Floating notes panel. opts: { states: [[label, fnName]], pretendViewer: bool, gaps: [html] } ── */
function mountNotes(opts) {
  const d = document.createElement('details');
  d.className = 'pnotes';
  d.open = window.innerWidth >= 900 && pGet('notesOpen', '1') === '1';
  const stateBtns = (opts.states || []).map(([label, fn], i) => `<button type="button" data-st="${i}">${label}</button>`).join('');
  d.innerHTML = `<summary>Prototype notes</summary><div class="pnotesBody">
    <h4>${opts.noToday && !opts.pretendViewer ? 'Data' : 'Pretend'}</h4>
    ${opts.noToday ? '' : `<label>Today <select id="pnToday" aria-label="Pretend today">${TODAYS.map(t => `<option value="${t.id}"${t.id === pToday().id ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`}
    ${opts.pretendViewer ? `<label>Viewer <select id="pnViewer" aria-label="Who is signed in"><option value="scout">Signed in as Oliver</option><option value="parent">Signed in as Dana (parent)</option><option value="out">Signed out / another family</option></select></label>` : ''}
    ${stateBtns ? `<h4>States</h4><div class="pbtns">${stateBtns}</div>` : ''}
    <div class="pbtns" style="margin-top:6px"><button type="button" id="pnReset">Forget orders placed here</button></div>
    ${(opts.gaps && opts.gaps.length) ? `<h4>On this screen</h4><ul>${opts.gaps.map(g => `<li>${g}</li>`).join('')}</ul>` : ''}
    ${OPEN_QS}
  </div>`;
  document.body.appendChild(d);
  d.addEventListener('toggle', () => pSet('notesOpen', d.open ? '1' : '0'));
  const v = d.querySelector('#pnViewer'); if (v) v.value = pViewer();
  const td = d.querySelector('#pnToday'); if (td) td.addEventListener('change', e => { pSet('today', e.target.value); location.reload(); });
  if (v) v.addEventListener('change', e => { pSet('viewer', e.target.value); location.reload(); });
  d.querySelector('#pnReset').addEventListener('click', () => { try { localStorage.removeItem(NEW_KEY); } catch (e) { /* ignore */ } location.reload(); });
  d.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => opts.states[+b.dataset.st][1]()));
}

/* shared little helpers */
const linesTotal = lines => lines.reduce((s, l) => s + item(l.n).price * l.q, 0);
const phoneBits = c => [c.phone, c.email].filter(Boolean).join(' · ');
