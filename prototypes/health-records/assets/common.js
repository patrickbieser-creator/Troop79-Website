/* Health Records prototype — shared helpers + sample data. Everyone here is invented.
   "Today" is pinned to Thu Nov 12, 2026 so statuses are stable. */
var HR = (function () {
  var TODAY = new Date(2026, 10, 12);
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function d(iso) { if (!iso) return null; var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
  /* Date display standard: "Nov 20, '26" */
  function fmt(x) { var dt = typeof x === 'string' ? d(x) : x; if (!dt) return ''; return MON[dt.getMonth()] + ' ' + dt.getDate() + ", '" + String(dt.getFullYear()).slice(2); }
  function plusYear(isoStr) { var dt = d(isoStr); return iso(new Date(dt.getFullYear() + 1, dt.getMonth(), dt.getDate())); }
  function daysUntil(isoStr) { return Math.round((d(isoStr) - TODAY) / 864e5); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var TRIP = { name: 'Fall Camp', start: '2026-11-21', end: '2026-11-23', where: 'Camp Wahkonda' };

  /* status of an annual health record: On file · Expires soon (≤60 days or before the trip) · Expired · Missing */
  function status(health, trip) {
    if (!health) return { key: 'missing', label: 'Missing', tone: 'danger', rank: 1 };
    var until = plusYear(health.signed);
    var n = daysUntil(until);
    if (n < 0) return { key: 'expired', label: 'Expired', tone: 'danger', rank: 0, until: until };
    if (n <= 60 || (trip && d(until) < d(trip.end))) return { key: 'soon', label: 'Expires soon', tone: 'warning', rank: 2, until: until, beforeTrip: trip && d(until) < d(trip.end) };
    return { key: 'ok', label: 'On file', tone: 'success', rank: 3, until: until };
  }

  /* ── Fake scans: drawn SVG, all marked SAMPLE, no real IDs ── */
  function lines(x, y, w, n, gap, labelSet) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var yy = y + i * gap;
      if (labelSet) s += '<text x="' + x + '" y="' + (yy - 4) + '" font-size="13" fill="#555">' + labelSet[i % labelSet.length] + '</text>';
      s += '<line x1="' + (x + (labelSet ? 150 : 0)) + '" y1="' + yy + '" x2="' + (x + w) + '" y2="' + yy + '" stroke="#999" stroke-width="1"/>';
    }
    return s;
  }
  function boxes(x, y, cols, rows, cw, rh, labels) {
    var s = '';
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var xx = x + c * cw, yy = y + r * rh;
      s += '<rect x="' + xx + '" y="' + yy + '" width="14" height="14" fill="none" stroke="#777"/>';
      s += '<text x="' + (xx + 20) + '" y="' + (yy + 12) + '" font-size="12" fill="#555">' + labels[(r * cols + c) % labels.length] + '</text>';
    }
    return s;
  }
  function watermark(w, h) {
    return '<text x="' + w / 2 + '" y="' + h / 2 + '" font-size="' + Math.round(w / 6) + '" fill="#c0392b" fill-opacity=".09" font-family="Arial" font-weight="700" text-anchor="middle" transform="rotate(-28 ' + w / 2 + ' ' + h / 2 + ')">SAMPLE</text>';
  }
  function scribble(x, y) { return '<path d="M' + x + ' ' + y + ' q 20 -18 40 0 t 40 0 t 30 -6" stroke="#2b4f8a" stroke-width="2" fill="none"/>'; }

  function formPage(part) {
    var titles = {
      A: 'BSA Annual Health and Medical Record — Part A',
      B: 'BSA Annual Health and Medical Record — Part B',
      C: 'BSA Annual Health and Medical Record — Part C'
    };
    var subs = { A: 'Informed consent, release agreement, and authorization', B: 'General information and health history', C: 'Pre-participation physical exam' };
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100" role="img" aria-label="Sample scan: ' + titles[part] + '">';
    s += '<rect width="850" height="1100" fill="#fbfaf6"/><rect x="40" y="40" width="770" height="1020" fill="none" stroke="#333" stroke-width="2"/>';
    s += '<rect x="40" y="40" width="770" height="70" fill="#e9e6dc"/>';
    s += '<text x="60" y="82" font-family="Arial" font-size="24" font-weight="700" fill="#222">' + titles[part] + '</text>';
    s += '<text x="60" y="140" font-family="Arial" font-size="15" fill="#444">' + subs[part] + '</text>';
    s += lines(60, 190, 730, 5, 38, ['Full name', 'Date of birth', 'Address', 'City / State', 'Unit']);
    s += '<rect x="60" y="400" width="730" height="200" fill="none" stroke="#999"/>';
    s += boxes(80, 420, 3, 6, 240, 30, ['Allergies', 'Asthma', 'Diabetes', 'Seizures', 'Heart', 'Surgery', 'Medications', 'Sleep issues', 'Other']);
    s += lines(60, 660, 730, 7, 36);
    s += '<text x="60" y="960" font-family="Arial" font-size="13" fill="#555">Signature</text><line x1="140" y1="962" x2="460" y2="962" stroke="#999"/>' + scribble(170, 950);
    s += '<text x="500" y="960" font-family="Arial" font-size="13" fill="#555">Date</text><line x1="540" y1="962" x2="790" y2="962" stroke="#999"/>';
    s += '<text x="560" y="956" font-family="Arial" font-size="18" fill="#2b4f8a">11 / 20 / 25</text>';
    s += '<text x="60" y="1040" font-family="Arial" font-size="12" fill="#888">Prototype placeholder — not a real form</text>';
    s += watermark(850, 1100) + '</svg>';
    return s;
  }
  function cardFront() {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540" role="img" aria-label="Sample scan: insurance card front">';
    s += '<rect x="8" y="8" width="840" height="524" rx="36" fill="#eaf1f6" stroke="#6f95b3" stroke-width="3"/>';
    s += '<rect x="8" y="8" width="840" height="110" rx="36" fill="#274d69"/><rect x="8" y="80" width="840" height="38" fill="#274d69"/>';
    s += '<text x="50" y="80" font-family="Arial" font-size="40" font-weight="700" fill="#fff">SAMPLE HEALTH PLAN</text>';
    s += '<text x="50" y="180" font-family="Arial" font-size="22" fill="#274d69">Member</text><rect x="50" y="195" width="320" height="22" rx="4" fill="#9fb4c4"/>';
    s += '<text x="50" y="265" font-family="Arial" font-size="22" fill="#274d69">ID</text><rect x="50" y="280" width="260" height="22" rx="4" fill="#9fb4c4"/>';
    s += '<text x="460" y="180" font-family="Arial" font-size="22" fill="#274d69">Group</text><rect x="460" y="195" width="200" height="22" rx="4" fill="#9fb4c4"/>';
    s += '<text x="460" y="265" font-family="Arial" font-size="22" fill="#274d69">Plan</text><rect x="460" y="280" width="240" height="22" rx="4" fill="#9fb4c4"/>';
    s += '<text x="50" y="380" font-family="Arial" font-size="20" fill="#274d69">Office visit  ·  Urgent care  ·  ER</text><rect x="50" y="395" width="420" height="18" rx="4" fill="#bccbd6"/>';
    s += '<text x="50" y="490" font-family="Arial" font-size="18" fill="#6f95b3">Prototype placeholder — not a real card</text>';
    s += watermark(856, 540) + '</svg>';
    return s;
  }
  function cardBack() {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540" role="img" aria-label="Sample scan: insurance card back">';
    s += '<rect x="8" y="8" width="840" height="524" rx="36" fill="#f6f7f8" stroke="#9ba1aa" stroke-width="3"/>';
    s += '<rect x="8" y="60" width="840" height="70" fill="#3a3f47"/>';
    s += '<text x="50" y="190" font-family="Arial" font-size="22" font-weight="700" fill="#3a3f47">Member services</text><rect x="50" y="205" width="300" height="18" rx="4" fill="#cdd1d6"/>';
    s += '<text x="50" y="270" font-family="Arial" font-size="22" font-weight="700" fill="#3a3f47">Pharmacy</text><rect x="50" y="285" width="260" height="18" rx="4" fill="#cdd1d6"/>';
    s += '<text x="50" y="350" font-family="Arial" font-size="22" font-weight="700" fill="#3a3f47">Providers</text><rect x="50" y="365" width="420" height="18" rx="4" fill="#cdd1d6"/><rect x="50" y="395" width="360" height="18" rx="4" fill="#cdd1d6"/>';
    s += '<text x="50" y="480" font-family="Arial" font-size="20" font-weight="700" fill="#9ba1aa">THIS IS A SAMPLE CARD</text>';
    s += watermark(856, 540) + '</svg>';
    return s;
  }
  function immun() {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100" role="img" aria-label="Sample scan: immunization record">';
    s += '<rect width="850" height="1100" fill="#fdfdfb"/><rect x="40" y="40" width="770" height="1020" fill="none" stroke="#333" stroke-width="2"/>';
    s += '<text x="60" y="95" font-family="Arial" font-size="26" font-weight="700" fill="#222">Immunization Record — SAMPLE CLINIC</text>';
    s += lines(60, 150, 730, 2, 40, ['Patient', 'Date of birth']);
    var vax = ['Tetanus (Tdap)', 'MMR', 'Polio', 'Hepatitis B', 'Varicella', 'Meningococcal', 'Influenza', 'COVID-19'];
    s += '<text x="60" y="270" font-family="Arial" font-size="15" font-weight="700">Vaccine</text><text x="420" y="270" font-family="Arial" font-size="15" font-weight="700">Dates given</text>';
    for (var i = 0; i < vax.length; i++) {
      var y = 310 + i * 60;
      s += '<line x1="60" y1="' + (y + 16) + '" x2="790" y2="' + (y + 16) + '" stroke="#ccc"/><text x="60" y="' + y + '" font-family="Arial" font-size="16" fill="#333">' + vax[i] + '</text>';
      s += '<rect x="420" y="' + (y - 14) + '" width="' + (90 + (i * 37) % 160) + '" height="16" rx="3" fill="#d6dbe1"/>';
    }
    s += scribble(560, 960) + '<text x="60" y="1040" font-family="Arial" font-size="12" fill="#888">Prototype placeholder — not a real record</text>';
    s += watermark(850, 1100) + '</svg>';
    return s;
  }
  /* A phone photo of a page: the form slightly rotated on a table */
  function photo(kind) {
    var inner = kind === 'immun' ? immun() : kind === 'card' ? cardFront() : formPage('A');
    var b64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(inner);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100" role="img" aria-label="Sample photo of a page"><rect width="850" height="1100" fill="#8a7a64"/><image href="' + b64 + '" x="60" y="70" width="730" height="960" transform="rotate(-2 425 550)" preserveAspectRatio="xMidYMid meet"/></svg>';
  }
  function scan(type) {
    if (type === 'A' || type === 'B' || type === 'C') return formPage(type);
    if (type === 'front') return cardFront();
    if (type === 'back') return cardBack();
    if (type === 'immun') return immun();
    if (type === 'photo') return photo('form');
    if (type === 'photoImmun') return photo('immun');
    return formPage('A');
  }
  function thumb(type) { return '<span class="thumb">' + scan(type) + '</span>'; }

  /* ── Viewer: pinch-zoom-looking, buttons + double-click + ctrl/wheel + drag to pan ──
     opts: { host, title, pages:[type], download, fail, onClose } */
  function openViewer(opts) {
    var host = opts.host || document.body;
    var v = document.createElement('div');
    v.className = 'viewer';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-modal', 'true');
    v.setAttribute('aria-label', opts.title);
    var i = 0, z = 1, px = 0, py = 0;
    var prev = document.activeElement;
    function render() {
      if (opts.fail) {
        v.innerHTML = '<div class="viewerBar"><button type="button" data-x aria-label="Close">✕</button><span class="ttl">' + esc(opts.title) + '</span></div>' +
          '<div class="viewerStage" style="cursor:default"><div class="viewerMsg"><p>Can’t load. Use the paper binder.</p><button type="button" class="btn secondary sm" data-retry>Retry</button></div></div>';
        v.querySelector('[data-retry]').onclick = function () {
          v.querySelector('.viewerMsg').innerHTML = '<div class="spinner"></div><p>Trying again…</p>';
          setTimeout(function () { opts.fail = opts.failAgain || false; render(); }, 900);
        };
      } else {
        var n = opts.pages.length;
        v.innerHTML = '<div class="viewerBar"><button type="button" data-x aria-label="Close">✕</button><span class="ttl">' + esc(opts.title) + '</span>' +
          '<button type="button" data-zo aria-label="Zoom out">−</button><button type="button" data-zi aria-label="Zoom in">+</button></div>' +
          '<div class="viewerStage"><div class="viewerPage">' + scan(opts.pages[i]) + '</div></div>' +
          '<div class="viewerFoot">' +
          (n > 1 ? '<button type="button" data-pv aria-label="Previous page"' + (i === 0 ? ' disabled' : '') + '>‹</button><span>Page ' + (i + 1) + ' of ' + n + '</span><button type="button" data-nx aria-label="Next page"' + (i === n - 1 ? ' disabled' : '') + '>›</button>' : '<span class="hint">Pinch or double-tap to zoom</span>') +
          (opts.download ? '<button type="button" data-dl>Download for printing</button>' : '') + '</div>';
        wire();
      }
      v.querySelector('[data-x]').onclick = close;
      v.querySelector('[data-x]').focus();
    }
    function apply() {
      var pg = v.querySelector('.viewerPage');
      if (!pg) return;
      pg.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' + z + ')';
      v.querySelector('.viewerStage').classList.toggle('zoomed', z > 1);
    }
    function zoom(f) { z = Math.max(1, Math.min(4, z * f)); if (z === 1) { px = 0; py = 0; } apply(); }
    function wire() {
      var st = v.querySelector('.viewerStage');
      v.querySelector('[data-zi]').onclick = function () { zoom(1.5); };
      v.querySelector('[data-zo]').onclick = function () { zoom(1 / 1.5); };
      st.ondblclick = function () { if (z > 1) { z = 1; px = py = 0; } else z = 2.2; apply(); };
      st.onwheel = function (e) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
      var drag = null;
      st.onpointerdown = function (e) { if (z === 1) return; drag = { x: e.clientX - px, y: e.clientY - py }; st.setPointerCapture(e.pointerId); };
      st.onpointermove = function (e) { if (!drag) return; px = e.clientX - drag.x; py = e.clientY - drag.y; var pg = v.querySelector('.viewerPage'); pg.style.transition = 'none'; apply(); };
      st.onpointerup = function () { drag = null; var pg = v.querySelector('.viewerPage'); if (pg) pg.style.transition = ''; };
      var pv = v.querySelector('[data-pv]'), nx = v.querySelector('[data-nx]');
      if (pv) pv.onclick = function () { i--; z = 1; px = py = 0; render(); };
      if (nx) nx.onclick = function () { i++; z = 1; px = py = 0; render(); };
      var dl = v.querySelector('[data-dl]');
      if (dl) dl.onclick = function () { dl.textContent = 'Downloaded (PDF, ' + opts.pages.length + (opts.pages.length === 1 ? ' page)' : ' pages)'); dl.disabled = true; if (opts.onDownload) opts.onDownload(); };
      apply();
    }
    function close() { v.remove(); document.removeEventListener('keydown', key); if (prev && prev.focus) prev.focus(); if (opts.onClose) opts.onClose(); }
    function key(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight' && v.querySelector('[data-nx]:not([disabled])')) v.querySelector('[data-nx]').click();
      if (e.key === 'ArrowLeft' && v.querySelector('[data-pv]:not([disabled])')) v.querySelector('[data-pv]').click();
    }
    document.addEventListener('keydown', key);
    host.appendChild(v);
    render();
    return { close: close };
  }

  /* ── Sample troop (invented). Ben Rivera's family has already updated his form here (Nov 8),
     so admin + leader views show him On file; parent.html starts from before that update. ── */
  function P(id, first, last, kind, age, hh, health, ins, imm, notes, contact, going) {
    return { id: id, first: first, last: last, name: first + ' ' + last, kind: kind, age: age, household: hh, health: health, insurance: ins, immun: imm, notes: notes, contact: contact, going: !!going };
  }
  var FULL = { front: true, back: true, date: '2026-03-03' };
  var people = [
    P('ben', 'Ben', 'Rivera', 'scout', 14, 'Rivera', { signed: '2026-11-08', parts: 'A+B' }, FULL, { date: '2026-11-08' }, { text: 'Peanut allergy, EpiPen in blue bag. Gets homesick the first night.', on: '2026-10-02', by: 'Dana Rivera' }, { name: 'Dana', rel: 'mother', phone: '(414) 555-0142' }, 1),
    P('maya', 'Maya', 'Thornton', 'scout', 13, 'Thornton', { signed: '2025-11-15', parts: 'A+B' }, FULL, { date: '2025-11-15' }, { text: 'Seasonal allergies; takes a Zyrtec each morning.', on: '2025-11-15', by: 'Erin Thornton' }, { name: 'Erin', rel: 'mother', phone: '(414) 555-0177' }, 1),
    P('nora', 'Nora', 'Thornton', 'scout', 11, 'Thornton', { signed: '2025-11-15', parts: 'A+B' }, FULL, { date: '2025-11-15' }, null, { name: 'Erin', rel: 'mother', phone: '(414) 555-0177' }, 1),
    P('sam', 'Sam', 'Kowalczyk', 'scout', 12, 'Kowalczyk', null, null, null, null, { name: 'Paul', rel: 'father', phone: '(414) 555-0119' }, 1),
    P('leo', 'Leo', 'Haddad', 'scout', 15, 'Haddad', { signed: '2026-06-02', parts: 'A+B+C' }, FULL, { date: '2026-06-02' }, { text: 'Asthma. Inhaler in his backpack, front pocket.', on: '2026-06-02', by: 'Rana Haddad' }, { name: 'Rana', rel: 'mother', phone: '(414) 555-0163' }, 1),
    P('owen', 'Owen', 'Pratt', 'scout', 12, 'Pratt', { signed: '2026-08-19', parts: 'A+B' }, FULL, { date: '2026-08-19' }, null, { name: 'Mark', rel: 'father', phone: '(414) 555-0108' }, 1),
    P('priya', 'Priya', 'Nair', 'scout', 14, 'Nair', { signed: '2026-04-11', parts: 'A+B' }, FULL, { date: '2026-04-11' }, { text: 'Vegetarian. No other concerns.', on: '2026-04-11', by: 'Anil Nair' }, { name: 'Anil', rel: 'father', phone: '(414) 555-0131' }, 1),
    P('eli', 'Eli', 'Brandt', 'scout', 13, 'Brandt', { signed: '2026-02-27', parts: 'A+B' }, FULL, { date: '2026-02-27' }, null, { name: 'Sara', rel: 'mother', phone: '(414) 555-0185' }, 1),
    P('theo', 'Theo', 'Marsh', 'scout', 16, 'Marsh', { signed: '2026-07-07', parts: 'A+B+C' }, FULL, { date: '2026-07-07' }, { text: 'Bee sting allergy (mild). Benadryl in first-aid kit is fine.', on: '2026-07-07', by: 'Lauren Marsh' }, { name: 'Lauren', rel: 'mother', phone: '(414) 555-0150' }, 1),
    P('jonah', 'Jonah', 'Ruiz', 'scout', 11, 'Ruiz', { signed: '2026-09-14', parts: 'A+B' }, { front: true, back: false, date: '2026-09-14' }, null, null, { name: 'Marisol', rel: 'mother', phone: '(414) 555-0126' }, 1),
    P('dana', 'Dana', 'Rivera', 'adult', 44, 'Rivera', { signed: '2026-03-04', parts: 'A+B' }, FULL, { date: '2026-03-04' }, null, { name: 'Luis', rel: 'spouse', phone: '(414) 555-0143' }, 1),
    P('greg', 'Greg', 'Thornton', 'adult', 47, 'Thornton', { signed: '2025-11-15', parts: 'A+B+C' }, FULL, { date: '2025-11-15' }, { text: 'Type 2 diabetes, diet controlled.', on: '2025-11-15', by: 'Greg Thornton' }, { name: 'Erin', rel: 'spouse', phone: '(414) 555-0177' }, 1),
    P('ann', 'Ann', 'Kowalczyk', 'adult', 41, 'Kowalczyk', null, null, null, null, { name: 'Paul', rel: 'spouse', phone: '(414) 555-0119' }, 1),
    P('mark', 'Mark', 'Pratt', 'adult', 50, 'Pratt', { signed: '2026-08-19', parts: 'A+B+C' }, FULL, { date: '2026-08-19' }, null, { name: 'Jen', rel: 'spouse', phone: '(414) 555-0109' }, 1),
    /* not going to Fall Camp (troop-wide views) */
    P('ava', 'Ava', 'Lindqvist', 'scout', 12, 'Lindqvist', { signed: '2025-10-30', parts: 'A+B' }, FULL, { date: '2025-10-30' }, null, { name: 'Per', rel: 'father', phone: '(414) 555-0170' }),
    P('caleb', 'Caleb', 'Osei', 'scout', 15, 'Osei', { signed: '2026-01-09', parts: 'A+B' }, FULL, { date: '2026-01-09' }, { text: 'Wears glasses; spare pair in the troop trailer.', on: '2026-01-09', by: 'Ama Osei' }, { name: 'Ama', rel: 'mother', phone: '(414) 555-0112' }),
    P('finn', 'Finn', 'Gallagher', 'scout', 13, 'Gallagher', null, null, null, null, { name: 'Moira', rel: 'mother', phone: '(414) 555-0134' }),
    P('iris', 'Iris', 'Becker', 'scout', 14, 'Becker', { signed: '2025-12-20', parts: 'A+B' }, FULL, null, null, { name: 'Tom', rel: 'father', phone: '(414) 555-0158' }),
    P('noah', 'Noah', 'Whitfield', 'scout', 11, 'Whitfield', { signed: '2026-05-23', parts: 'A+B' }, FULL, { date: '2026-05-23' }, null, { name: 'Kim', rel: 'mother', phone: '(414) 555-0191' }),
    P('rosa', 'Rosa', 'Delgado', 'scout', 16, 'Delgado', { signed: '2025-09-02', parts: 'A+B+C' }, FULL, { date: '2025-09-02' }, null, { name: 'Victor', rel: 'father', phone: '(414) 555-0103' }),
    P('karen', 'Karen', 'Okafor', 'adult', 52, 'Okafor', { signed: '2026-05-01', parts: 'A+B+C' }, FULL, { date: '2026-05-01' }, null, { name: 'Emeka', rel: 'spouse', phone: '(414) 555-0166' }),
    P('jordan', 'Jordan', 'Alvarez', 'adult', 45, 'Alvarez', { signed: '2026-02-14', parts: 'A+B+C' }, FULL, { date: '2026-02-14' }, null, { name: 'Lee', rel: 'spouse', phone: '(414) 555-0120' }),
    P('beth', 'Beth', 'Sorensen', 'adult', 39, 'Sorensen', { signed: '2025-12-30', parts: 'A+B' }, FULL, { date: '2025-12-30' }, null, { name: 'Erik', rel: 'spouse', phone: '(414) 555-0147' })
  ];

  return { TODAY: TODAY, TRIP: TRIP, d: d, iso: iso, fmt: fmt, plusYear: plusYear, daysUntil: daysUntil, esc: esc, status: status, scan: scan, thumb: thumb, openViewer: openViewer, people: people };
})();
