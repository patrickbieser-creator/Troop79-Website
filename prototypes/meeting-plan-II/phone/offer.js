/* Add an offer: shared picker for drawer.html and live.html.
   An offer = a class someone will teach: topic (one requirement, a focus group, or free text) + teacher (optional).
   In production the requirement search is a paginated server query (README, Focus sets), not this sample list. */
const OFFER_REQS = [
  {code:'Scout 1a', title:'Oath, Law, motto, slogan', kind:'rank'},
  {code:'Scout 1d', title:'First Class badge meaning', kind:'rank'},
  {code:'Scout 4a', title:'Square knot, two half hitches, taut-line', kind:'rank'},
  {code:'Tenderfoot 3a', title:'Two half hitches', kind:'rank'},
  {code:'Tenderfoot 3b', title:'Taut-line hitch', kind:'rank'},
  {code:'Tenderfoot 4a', title:'First aid basics', kind:'rank'},
  {code:'Tenderfoot 4b', title:'Heat and cold injuries', kind:'rank'},
  {code:'Tenderfoot 6a', title:'Fitness test, first round', kind:'rank'},
  {code:'Tenderfoot 7a', title:'Flag ceremony and folding', kind:'rank'},
  {code:'Second Class 2f', title:'Build and light a fire', kind:'rank'},
  {code:'Second Class 3a', title:'Compass and orienting a map', kind:'rank'},
  {code:'Second Class 6a', title:'First aid for sprains and burns', kind:'rank'},
  {code:'First Class 4a', title:'Orienteering course', kind:'rank'},
  {code:'First Class 7a', title:'First aid: rescue breathing', kind:'rank'},
  {code:'Star 6', title:'Cyber Chip for grade', kind:'rank'},
  {code:'First Aid · req 5', title:'Bleeding and shock', kind:'mb'},
  {code:'First Aid · req 9', title:'Transporting an injured person', kind:'mb'},
  {code:'Electricity · req 5', title:'Electricity make-up', kind:'mb'},
  {code:'Camping · req 4a', title:'Personal and group gear', kind:'mb'},
  {code:'Cooking · req 4', title:'Plan a campout menu', kind:'mb'}
];
const OFFER_GROUPS = [
  {code:'Tenderfoot 6a–6c', title:'Tenderfoot fitness', n:3},
  {code:'Tenderfoot 3a–3d', title:'Knots and lashings', n:4},
  {code:'Tenderfoot 4a–4d · Second Class 6a–6c', title:'First aid night', n:7},
  {code:'Camping 4a–4b, 8d', title:'Camping merit badge prep', n:3}
];
/* People who said Can't are left out, like the board's teacher lists. */
const OFFER_ADULTS = [
  ['Patrick B','Coming'],['Alex S','Coming'],['Jenna M','Coming'],['Dan V','Coming'],['Rachel D','Coming'],['Mark F','Coming'],
  ['Mike T','Not sure yet'],['Chris N','Not sure yet'],
  ['Ben W','No answer'],['Dana K','No answer'],['Greg H','No answer'],['Joe M','No answer'],['Karen O','No answer'],['Laura P','No answer'],['Nina G','No answer'],['Steve R','No answer'],['Tom K','No answer']
];

function OfferPicker(root, opts) {
  const S = {q:'', topic:null, teacher: opts.teacher ?? null};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const toks = s => s.toLowerCase().replace(/[·–,()]/g, ' ').split(/\s+/).filter(Boolean);
  const match = (hay, q) => { const h = toks(hay).join(' '); return toks(q).every(t => h.includes(t)); };
  const emit = () => opts.onChange && opts.onChange({topic: S.topic, teacher: S.teacher});

  root.innerHTML = `<div class="op">
    <div class="op-step" id="opStep1"><span class="op-n">1</span>What will be taught?</div>
    <div class="op-search" id="opSearch"><label class="sr-only" for="opQ">Search a requirement or focus group, or type a title</label>
      <input id="opQ" type="text" enterkeyhint="search" autocomplete="off" placeholder="Try “Tenderfoot 4a” or “first aid”"></div>
    <div id="opTopic"></div>
    <div id="opTeach"></div></div>`;
  const q = root.querySelector('#opQ');
  q.addEventListener('input', () => { S.q = q.value; draw(); });

  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (d.opPick !== undefined) {
      if (d.opPick === 'free') S.topic = {kind:'other', code:'Other', title:S.q.trim(), free:true};
      else if (d.opPick.startsWith('g')) { const g = OFFER_GROUPS[+d.opPick.slice(1)]; S.topic = {kind:'group', code:g.code, title:g.title, group:true}; }
      else { const r = OFFER_REQS[+d.opPick.slice(1)]; S.topic = {...r}; }
      draw(); emit(); root.querySelector('#opTeach [aria-checked="true"]')?.focus();
    }
    if (d.opChange !== undefined) { S.topic = null; draw(); emit(); q.focus(); }
    if (d.opTeacher !== undefined) { S.teacher = d.opTeacher || null; draw(); emit(); root.querySelector(`[data-op-teacher="${CSS.escape(d.opTeacher)}"]`)?.focus(); }
  });

  function draw() {
    const T = root.querySelector('#opTopic'), W = root.querySelector('#opTeach');
    root.querySelector('#opSearch').hidden = !!S.topic;
    if (S.topic) {
      const tag = S.topic.free ? '<span class="tag" style="background:#eceff1;color:#4a5961">Free-text title</span>'
        : S.topic.group ? '<span class="tag tag-focus">Focus group</span>' : `<span class="tag ${S.topic.kind==='mb'?'tag-mb':'tag-rank'}">${S.topic.kind==='mb'?'Merit badge':'Rank'}</span>`;
      T.innerHTML = `<div class="op-chosen"><div style="flex:1;min-width:0"><div><span class="code">${esc(S.topic.code)}</span> ${tag}</div><b>${esc(S.topic.title)}</b>
        ${S.topic.group ? '<div class="meta">One class · scouts pick it as one pick</div>' : ''}${S.topic.free ? '<div class="meta">Not tied to a requirement, so it won’t suggest likely fits</div>' : ''}</div>
        <button class="btn btn-ghost" data-op-change style="min-height:40px">Change</button></div>`;
      W.innerHTML = `<div class="op-step"><span class="op-n">2</span>Who teaches it? <span class="meta" style="font-weight:400">Optional</span></div>
        <div role="radiogroup" aria-label="Teacher">${[['', 'No teacher yet', 'Find one later on the board']].concat(OFFER_ADULTS.map(([n, a]) => [n, n, a])).map(([v, l, m]) =>
          `<button class="op-row" role="radio" aria-checked="${(S.teacher || '') === v}" data-op-teacher="${esc(v)}"><span class="op-radio" aria-hidden="true"></span><span style="flex:1">${esc(l)}</span><span class="meta">${esc(m)}</span></button>`).join('')}</div>`;
      return;
    }
    W.innerHTML = '';
    const qs = S.q.trim();
    const reqs = qs ? OFFER_REQS.map((r, i) => [r, i]).filter(([r]) => match(r.code + ' ' + r.title, qs)).slice(0, 8) : [];
    const groups = OFFER_GROUPS.map((g, i) => [g, i]).filter(([g]) => !qs || match(g.code + ' ' + g.title, qs));
    let h = '';
    if (!qs) h += '<div class="op-hint">Search a single requirement, pick a focus group, or type your own title.</div>';
    if (reqs.length) h += `<div class="op-group">Requirements</div>` + reqs.map(([r, i]) => `<button class="op-row" data-op-pick="r${i}"><span style="flex:1;min-width:0"><span class="code">${esc(r.code)}</span><br>${esc(r.title)}</span><span class="tag ${r.kind==='mb'?'tag-mb':'tag-rank'}">${r.kind==='mb'?'MB':'Rank'}</span></button>`).join('');
    if (groups.length) h += `<div class="op-group">Focus groups</div>` + groups.map(([g, i]) => `<button class="op-row" data-op-pick="g${i}"><span style="flex:1;min-width:0">${esc(g.title)}<br><span class="meta">${esc(g.code)} · ${g.n} requirements · one class</span></span></button>`).join('');
    if (qs) h += `<div class="op-group">Something else</div><button class="op-row" data-op-pick="free"><span style="flex:1;min-width:0">Use “${esc(qs)}” as a title</span></button>`;
    if (qs && !reqs.length && !groups.length) h = '<div class="op-hint">No requirement or focus group matches. You can still use it as a title.</div>' + h;
    T.innerHTML = h;
  }
  draw();
  return { reset() { S.q = ''; S.topic = null; q.value = ''; draw(); emit(); }, focus() { q.focus(); } };
}
