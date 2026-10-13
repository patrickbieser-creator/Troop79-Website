/* Store + scout page renderer. Config: <body data-mode="store|scout">.
   The general store is credited to Troop 79, always: no scout picker. Scout credit comes only
   from a scout link (?s=<slug>, default ben-b); the last link opened wins.
   An unknown or retired slug falls back to the general store with a quiet notice.
   Prototype toggle (in the dark strip): "After the final cutoff" shows the closed state. */
(function () {
  const body = document.body;
  let mode = body.dataset.mode;
  const params = new URLSearchParams(location.search);
  const proto = protoGet();
  const closed = !!proto.closed;
  let slug = null, fallbackFrom = null;

  if (mode === 'scout') {
    const want = params.get('s') || 'ben-b';
    const s = seller(want);
    if (s && s.active) slug = want; else { fallbackFrom = want; mode = 'store'; }
  }

  /* Store page = troop order. If the cart was credited to a scout, say so once and offer the way back. */
  const cart = cartGet();
  let droppedFrom = null;
  if (mode === 'scout') { cart.seller = slug; cart.source = 'link'; }
  else { if (!closed && cart.seller && cartLines(cart).length && seller(cart.seller)) droppedFrom = cart.seller; cart.seller = null; cart.source = 'store'; }
  cartSet(cart);

  /* prototype-only control */
  const pc = document.getElementById('protoClosed');
  if (pc) {
    pc.innerHTML = `<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="pClosed"${closed ? ' checked' : ''}> After the final cutoff</label>`;
    document.getElementById('pClosed').addEventListener('change', e => { proto.closed = e.target.checked; protoSet(proto); location.reload(); });
  }

  const root = document.getElementById('store');
  const days = Math.round((new Date(SALE.round1.date) - new Date(SALE.today)) / 864e5);
  const first = slug ? seller(slug).name.split(' ')[0] : '';

  document.getElementById('deadline').innerHTML = closed
    ? `<div class="deadlineInner"><strong>Sales are closed for ${SALE.year}</strong><span class="soft">Thank you! Next year’s sale opens in October.</span></div>`
    : `<div class="deadlineInner"><strong>Order by ${SALE.round1.label}</strong><span class="soft">${days} days left · last orders ${SALE.round2.label}</span></div>`;

  const moneyBlock = `<div class="card pad money"><h2>Where the money goes</h2><ul>
      <li>Every wreath pays for the troop’s camping, gear and program for the year.</li>
      <li>${mode === 'scout' ? `${first} gets credit for your order: 30% of its profit goes into ${first}’s scout account` : 'Orders here support the whole troop. Scouts earn 30% of the profit on orders placed through their own link'}, for camp fees and high-adventure trips.</li>
      <li>Wreaths arrive fresh the first weekend of December.</li></ul></div>`;

  let head = '';
  if (mode === 'scout') {
    const s = seller(slug), st = sellerStats(slug);
    const pct = s.goal ? Math.min(100, Math.round(st.items / s.goal * 100)) : 0;
    const msg = s.msgStatus === 'approved' && s.message ? `<blockquote>${esc(s.message)}</blockquote>` : '';
    const goal = s.goal ? `<div class="goal" aria-label="${st.items} of ${s.goal} wreaths sold"><strong>${st.items} of ${s.goal} wreaths</strong> toward ${first}’s goal<div class="goalBar"><span style="width:${pct}%"></span></div></div>` : '';
    head = `<p class="kicker">Troop 79 Christmas wreaths</p><h1>${closed ? `${esc(s.name)}’s wreath sale is closed` : `You’re ordering from ${esc(s.name)}`}</h1>
      ${closed ? `<p class="notice" style="margin-bottom:16px">Sales are closed for ${SALE.year}. Thank you for supporting ${first} and Troop 79. If you already ordered, ${first} delivers ${SALE.deliveryWindow}.</p>` : ''}
      <div class="intro"><div class="greet">${msg}${goal}${closed ? '' : `<p class="meta" style="margin:0">${first} delivers your order in person, ${SALE.deliveryWindow}.</p>`}</div>${moneyBlock}</div>`;
  } else {
    const back = droppedFrom ? `<p class="notice warn" role="status" style="margin-bottom:16px">Your cart was credited to ${esc(seller(droppedFrom).name)} Orders placed here go to Troop 79. <a href="scout.html?s=${droppedFrom}">Back to ${esc(seller(droppedFrom).name.split(' ')[0])}’s page</a> to keep the credit.</p>` : '';
    head = `${fallbackFrom ? `<p class="notice warn" role="status" style="margin-bottom:16px">That scout link isn’t active this year. You can still order here; orders here go to Troop 79.</p>` : ''}${back}
      <p class="kicker">Troop 79 wreath sale ${SALE.year}</p><h1>Christmas wreaths</h1>
      ${closed ? `<p class="notice" style="margin-bottom:16px">Sales are closed for ${SALE.year}. Thank you! If you already ordered, pickup is ${SALE.pickup.day}, ${SALE.pickup.window}, at ${SALE.pickup.place}.</p>`
        : `<p class="lede">Fresh wreaths, roping and trees, sold by the scouts of Troop 79. Pick up at the church or have them delivered in Milwaukee.</p>`}
      <div class="intro">${moneyBlock}</div>`;
  }

  const groups = GROUPS.map(g => {
    const items = CATALOG.filter(c => c.group === g.id);
    return `<h2 class="groupTitle">${g.title}</h2><ul class="products">${items.map(c => `
      <li class="card product">${wreathArt(c)}<div class="body">
        <div class="pHead"><span class="pName">${esc(c.name)}${c.size ? ` <span class="pSize">${c.size}</span>` : ''}</span><span class="pPrice">${money(c.price)}</span></div>
        <p class="pDesc">${esc(c.desc)}</p>
        ${closed ? '' : `<div class="addLine" data-key="${c.n}" data-label="${esc(itemLabel(c))}"></div>`}</div></li>`).join('')}</ul>`;
  }).join('');

  const vets = closed ? '' : `<section class="card vets" aria-labelledby="vetsH"><h2 id="vetsH">Donate a wreath to veterans</h2>
    <p class="meta" style="margin:0 0 8px">The troop delivers donated wreaths to veterans in December. Nothing comes to you${mode === 'scout' ? `, and ${first} still gets credit for the sale` : ''}.</p>
    ${DONATABLE.map(n => { const c = item(n); return `<div class="vetRow"><span class="grow"><strong>${esc(itemLabel(c))}</strong>, donated · ${money(c.price)}</span><span class="addLine" data-key="${n}d" data-label="${esc(itemLabel(c))}, donated"></span></div>`; }).join('')}
  </section>`;

  root.innerHTML = closed
    ? `<div>${head}${groups}</div>`
    : `<div class="storeGrid"><div>${head}${groups}${vets}</div>
    <aside class="card pad cartAside" aria-labelledby="cartH"><h2 id="cartH">Your order</h2><div id="cartBody"></div></aside></div>`;
  if (closed) return;
  document.getElementById('cartBarHost').innerHTML = `<div class="cartBar" id="cartBar"><div class="sum"><strong id="barTotal"></strong><span id="barCount"></span></div><a class="btn primary" href="checkout.html">Checkout</a></div>`;

  function credited() { const s = cart.seller && seller(cart.seller); return s ? s.name : 'Troop 79'; }

  function renderAdd(el) {
    const k = el.dataset.key, q = cart.lines[k] || 0, lbl = el.dataset.label;
    el.innerHTML = q === 0
      ? `<button type="button" class="btn secondary sm" data-act="add" aria-label="Add ${lbl}">Add</button>`
      : `<span class="qty sm"><button type="button" data-act="dec" aria-label="One fewer ${lbl}">−</button><input type="number" min="0" max="99" inputmode="numeric" value="${q}" aria-label="Quantity, ${lbl}"><button type="button" data-act="inc" aria-label="One more ${lbl}"${q >= 99 ? ' disabled' : ''}>+</button></span><span class="inCart">In cart</span>`;
  }
  function renderCart() {
    const ls = cartLines(cart), t = cartTotals(cart);
    const cb = document.getElementById('cartBody');
    cb.innerHTML = ls.length === 0
      ? `<p class="cartEmpty">Nothing yet. Add a wreath to start.</p>`
      : `<ul class="cartList">${ls.map(l => `<li><span>${l.q} × ${esc(itemLabel(item(l.n)))}${l.donated ? ' <span class="tag vet">Donated</span>' : ''}</span><span class="num">${money(item(l.n).price * l.q)}</span></li>`).join('')}</ul>
         <div class="cartTotal"><span>Total</span><span class="num">${money(t.sale)}</span></div>
         <a class="btn primary block" href="checkout.html">Checkout</a>`;
    if (mode === 'scout') cb.insertAdjacentHTML('beforeend', `<p class="meta" style="margin:8px 0 0">Credited to ${esc(credited())}</p>`);
    const bar = document.getElementById('cartBar');
    bar.hidden = ls.length === 0;
    body.classList.toggle('hasCartBar', ls.length > 0);
    document.getElementById('barTotal').textContent = money(t.sale);
    document.getElementById('barCount').textContent = `${t.items} item${t.items === 1 ? '' : 's'}${mode === 'scout' ? ' · ' + credited() : ''}`;
  }
  function setQty(k, q) {
    q = Math.max(0, Math.min(99, q | 0));
    if (q === 0) delete cart.lines[k]; else cart.lines[k] = q;
    cartSet(cart);
    document.querySelectorAll(`.addLine[data-key="${k}"]`).forEach(renderAdd);
    renderCart();
  }
  const toastEl = document.getElementById('toast');
  let tt;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 1800); }

  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const al = b.closest('.addLine'), k = al.dataset.key, q = cart.lines[k] || 0;
    if (b.dataset.act === 'add') { setQty(k, 1); toast(`Added ${al.dataset.label}`); al.querySelector('input').focus(); }
    if (b.dataset.act === 'inc') setQty(k, q + 1);
    if (b.dataset.act === 'dec') { setQty(k, q - 1); if (q - 1 === 0) al.querySelector('button').focus(); else al.querySelector('[data-act="dec"]').focus(); }
  });
  root.addEventListener('change', e => {
    if (e.target.matches('.addLine input')) setQty(e.target.closest('.addLine').dataset.key, parseInt(e.target.value, 10) || 0);
  });
  document.querySelectorAll('.addLine').forEach(renderAdd);
  renderCart();
})();
