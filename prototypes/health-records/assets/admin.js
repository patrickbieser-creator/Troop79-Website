/* Admin-side shared pieces: the person panel (Scout Accounts pattern), a dialog shell, a toast,
   and the sample access log. Depends on common.js. */
var HA = (function () {
  var fmt = HR.fmt, esc = HR.esc;

  var ME = 'Jordan Alvarez'; /* the signed-in admin (invented) */

  /* Append-only access log sample (newest first). where = event name or "Search". */
  var LOG = [
    { on: '2026-11-11', who: 'Karen Okafor', whose: 'Leo Haddad', what: 'Health record', where: 'Fall Camp' },
    { on: '2026-11-10', who: 'Jordan Alvarez', whose: 'Greg Thornton', what: 'Health record', where: 'Fall Camp' },
    { on: '2026-11-10', who: 'Karen Okafor', whose: 'Ben Rivera', what: 'Things we should know', where: 'Fall Camp' },
    { on: '2026-11-04', who: 'Beth Sorensen', whose: 'Caleb Osei', what: 'Insurance card, front', where: 'Search' },
    { on: '2026-10-18', who: 'Jordan Alvarez', whose: '22 people', what: 'Printed binder', where: 'Klondike Prep Day' },
    { on: '2026-10-17', who: 'Karen Okafor', whose: 'Theo Marsh', what: 'Health record', where: 'Klondike Prep Day' },
    { on: '2026-10-17', who: 'Karen Okafor', whose: 'Theo Marsh', what: 'Health record (downloaded)', where: 'Klondike Prep Day' },
    { on: '2026-09-26', who: 'Mark Pratt', whose: 'Rosa Delgado', what: 'Immunizations', where: 'Search' },
    { on: '2026-09-12', who: 'Beth Sorensen', whose: 'Priya Nair', what: 'Health record', where: 'Canoe Weekend' },
    { on: '2026-09-12', who: 'Beth Sorensen', whose: 'Priya Nair', what: 'Insurance card, back', where: 'Canoe Weekend' }
  ];

  function badge(s) { return '<span class="aBadge ' + s.tone + '">' + s.label + '</span>'; }
  function cellHealth(p, trip) {
    var s = HR.status(p.health, trip);
    var sub = s.key === 'missing' ? '' : s.key === 'expired' ? 'ran out ' + fmt(s.until) : (s.beforeTrip ? 'runs out ' + fmt(s.until) + ', before the trip' : 'until ' + fmt(s.until));
    return badge(s) + (sub ? '<span class="sub">' + sub + '</span>' : '');
  }
  function cellIns(p) {
    if (!p.insurance) return '<span class="aBadge danger">Missing</span>';
    return p.insurance.back ? 'Front, back' : 'Front only<span class="sub">no back</span>';
  }
  function cellImm(p) { return p.immun ? fmt(p.immun.date) : '<span class="aBadge muted">Not added</span>'; }
  function cellNotes(p) { return p.notes ? '<span class="clip" title="' + esc(p.notes.text) + '">' + esc(p.notes.text) + '</span>' : '<span style="color:var(--admin-gray-400)">—</span>'; }

  function toast(msg) { var t = document.createElement('div'); t.className = 'adminToast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3300); }

  /* dialog(html with header/.body/.acts) → returns {el, close} ; Esc and scrim click close */
  function dialog(inner, wide, onClose) {
    var prev = document.activeElement;
    var s = document.createElement('div');
    s.className = 'aScrim';
    s.innerHTML = '<div class="aDialog' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlgT">' + inner + '</div>';
    document.body.appendChild(s);
    function close() { s.remove(); document.removeEventListener('keydown', k); if (prev && prev.focus) prev.focus(); if (onClose) onClose(); }
    function k(e) { if (e.key === 'Escape' && !document.querySelector('body > .viewer')) close(); }
    document.addEventListener('keydown', k);
    s.addEventListener('mousedown', function (e) { if (e.target === s) close(); });
    var f = s.querySelector('[data-autofocus]') || s.querySelector('button');
    if (f) f.focus();
    return { el: s, close: close };
  }

  /* The person panel. opts: { trip, where, onClose, onRemind } */
  function panel(host, p, opts) {
    var s = HR.status(p.health, opts.trip);
    var views = LOG.filter(function (l) { return l.whose === p.name; }).slice(0, 3);
    var docs = '';
    if (p.health) docs += '<li><span class="what">Health record<small>Parts ' + p.health.parts + ' · signed ' + fmt(p.health.signed) + '</small></span><button class="aBtn" type="button" data-pv="health">View</button></li>';
    else docs += '<li><span class="what">Health record<small>Not on file</small></span><span class="aBadge danger">Missing</span></li>';
    if (p.insurance) docs += '<li><span class="what">Insurance card<small>' + (p.insurance.back ? 'Front, back' : 'Front only') + ' · ' + fmt(p.insurance.date) + '</small></span><button class="aBtn" type="button" data-pv="front">Front</button>' + (p.insurance.back ? '<button class="aBtn" type="button" data-pv="back">Back</button>' : '') + '</li>';
    else docs += '<li><span class="what">Insurance card<small>Not on file</small></span></li>';
    docs += p.immun ? '<li><span class="what">Immunizations<small>' + fmt(p.immun.date) + '</small></span><button class="aBtn" type="button" data-pv="immun">View</button></li>' : '<li><span class="what">Immunizations<small>Not added</small></span></li>';

    host.innerHTML = '<section class="panel" aria-labelledby="pnT" tabindex="-1">' +
      '<div class="panelHead"><h2 id="pnT">' + esc(p.name) + '<span class="chip">' + p.kind + '</span></h2><div style="display:flex;gap:6px;align-items:center">' +
      (s.key !== 'ok' && opts.onRemind ? '<button class="aBtn quiet" type="button" data-remind>Remind family</button>' : '') +
      '<button class="close" type="button" aria-label="Close" data-close>×</button></div></div>' +
      '<p class="status">' + badge(s) + ' ' + (s.until ? (s.key === 'expired' ? 'ran out ' : 'good until ') + fmt(s.until) : 'no health record on file') + ' · ' + p.household + ' household</p>' +
      '<h3>Things the family told us</h3>' + (p.notes ? '<div class="told">' + esc(p.notes.text) + '<small>Typed by family, ' + fmt(p.notes.on) + ' · not read from the form</small></div>' : '<div class="told" style="color:var(--admin-gray-500)">Nothing typed by the family.</div>') +
      '<h3>Emergency contact</h3><div class="told">' + esc(p.contact.name + ' ' + p.last) + ' (' + p.contact.rel + ') · ' + p.contact.phone + '</div>' +
      '<h3>Documents</h3><ul class="docList">' + docs + '</ul><p class="hint">Viewing is logged.</p>' +
      '<h3>Recent views</h3>' + (views.length ? '<ul class="docList">' + views.map(function (v) { return '<li><span class="what">' + esc(v.who) + ' · ' + esc(v.what) + '<small>' + fmt(v.on) + ' · ' + esc(v.where) + '</small></span></li>'; }).join('') + '</ul>' : '<p class="hint" style="margin:0">No one has opened these files.</p>') +
      '</section>';
    host.hidden = false;
    var sec = host.querySelector('.panel');
    sec.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if ('close' in t.dataset) return opts.onClose();
      if ('remind' in t.dataset) return opts.onRemind(p);
      if (t.dataset.pv) {
        var map = { health: { t: 'Health record', pages: p.health && p.health.parts === 'A+B+C' ? ['A', 'B', 'C'] : ['A', 'B'] }, front: { t: 'Insurance card, front', pages: ['front'] }, back: { t: 'Insurance card, back', pages: ['back'] }, immun: { t: 'Immunizations', pages: ['immun'] } }[t.dataset.pv];
        LOG.unshift({ on: HR.iso(HR.TODAY), who: ME, whose: p.name, what: map.t, where: opts.where });
        HR.openViewer({ title: p.name + ' · ' + map.t, pages: map.pages, download: true });
      }
    });
    sec.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('body > .viewer, .aScrim')) opts.onClose(); });
  }

  return { ME: ME, LOG: LOG, badge: badge, cellHealth: cellHealth, cellIns: cellIns, cellImm: cellImm, cellNotes: cellNotes, toast: toast, dialog: dialog, panel: panel };
})();
