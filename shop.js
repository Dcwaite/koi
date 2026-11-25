/* The koi dealer: a button on the water, and a yard of tubs and trays where you buy and sell. */
(function () {
  'use strict';
  var S = window.PondSim, G = window.KoiGame, D = window.KoiDraw;

  var MON = '<svg class="mon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="#d9b45c" stroke="#7d6227" stroke-width="1.4"/>' +
            '<circle cx="10" cy="10" r="6.3" fill="none" stroke="#f6e2a6" stroke-width="0.8" opacity="0.7"/><rect x="7.4" y="7.4" width="5.2" height="5.2" rx="0.6" fill="#4a3412"/></svg>';
  var STALL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">' +
              '<path d="M2.5 9 12 3.5 21.5 9Z" fill="currentColor" fill-opacity="0.25"/><path d="M4 9v11.5M20 9v11.5"/>' +
              '<path d="M6.5 9v5.5M10 9v6.5M14 9v6.5M17.5 9v5.5"/><path d="M3 20.5h18"/></svg>';
  var BASKET = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">' +
               '<path d="M7 10a5 5 0 0 1 10 0"/><path d="M3 10h18l-2 9.5H5Z" fill="currentColor" fill-opacity="0.25"/><path d="M8 13v4M12 13v4M16 13v4"/></svg>';
  var CROSS ='<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>';

  /* ---------- the button on the water ---------- */
  var btn = document.createElement('button');
  btn.id = 'shopBtn'; btn.type = 'button'; btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = '<span class="purse">' + MON + '<span class="n"></span></span>' +
                  '<span class="basket" hidden>' + BASKET + '<span class="b"></span></span>' +
                  '<span class="go">' + STALL + 'Shop</span>';
  document.body.appendChild(btn);

  /* ---------- the yard ---------- */
  var shop = document.createElement('div');
  shop.id = 'shop'; shop.hidden = true;
  shop.innerHTML =
    '<div class="stall" role="dialog" aria-modal="true" aria-labelledby="shopTitle">' +
      '<div class="yard-top">' +
        '<div class="plate" title="Your coins">' + MON + '<span class="n"></span></div>' +
        '<div class="sign"><h2 id="shopTitle">Koi Dealer</h2></div>' +
        '<button class="shut" type="button" aria-label="Back to the water">' + CROSS + '</button>' +
      '</div>' +
      '<div class="crates" role="tablist" aria-label="Shop sections">' +
        '<button class="crate" type="button" role="tab" data-tab="koi">Koi</button>' +
        '<button class="crate" type="button" role="tab" data-tab="plants">Plants</button>' +
        '<button class="crate" type="button" role="tab" data-tab="sell">Sell</button>' +
      '</div>' +
      '<p class="note" aria-live="polite"></p>' +
      '<div class="lots" role="tabpanel"></div>' +
    '</div>';
  document.body.appendChild(shop);

  var plate = shop.querySelector('.plate'), plateN = plate.querySelector('.n'), purseN = btn.querySelector('.n');
  var note = shop.querySelector('.note'), lotsEl = shop.querySelector('.lots'), shut = shop.querySelector('.shut');
  var crates = Array.prototype.slice.call(shop.querySelectorAll('.crate'));
  var tab = 'koi', lots = [], raf = 0, shown = 0;

  function pond() { return G.pond(); }

  var basketEl = btn.querySelector('.basket'), basketN = btn.querySelector('.b');
  function showCoins(delta) {
    var n = pond().coins, h = pond().basketCount();
    plateN.textContent = n; purseN.textContent = n;
    basketEl.hidden = !h; basketN.textContent = h;
    btn.setAttribute('aria-label', 'Shop. You have ' + n + ' coins' + (h ? ' and ' + h + ' things harvested to sell.' : '.'));
    if (!delta) return;
    var g = document.createElement('span');
    g.className = 'gain' + (delta < 0 ? ' spend' : '');
    g.textContent = (delta > 0 ? '+' : '−') + Math.abs(delta);
    plate.appendChild(g);
    setTimeout(function () { g.remove(); }, 1500);
    plate.classList.remove('bump'); void plate.offsetWidth; plate.classList.add('bump');
  }

  /* ---------- drawing the tubs and trays ---------- */
  var mot = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function fitCanvas(c) {
    var d = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(c.clientWidth * d);
    if (w > 0 && c.width !== w) { c.width = w; c.height = w; }
    return c.width;
  }

  function drawTub(lot, t) {
    var c = lot.canvas, W = fitCanvas(c), x = lot.ctx;
    if (!W) return;
    var cx = W / 2, cy = W / 2, R = W * 0.46, wr = R * 0.84, i;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W);
    // its shadow on the deck
    x.fillStyle = 'rgba(8,4,2,0.45)';
    x.beginPath(); x.ellipse(cx + W * 0.025, cy + W * 0.035, R * 1.01, R, 0, 0, 6.2832); x.fill();
    // the tub: a thick blue-grey rim
    var rim = x.createLinearGradient(0, cy - R, 0, cy + R);
    rim.addColorStop(0, '#5d8597'); rim.addColorStop(0.5, '#3d6476'); rim.addColorStop(1, '#27485a');
    x.fillStyle = rim; x.beginPath(); x.arc(cx, cy, R, 0, 6.2832); x.fill();
    x.strokeStyle = 'rgba(10,25,35,0.6)'; x.lineWidth = Math.max(1, W * 0.008);
    x.beginPath(); x.arc(cx, cy, wr + x.lineWidth * 0.5, 0, 6.2832); x.stroke();
    // the water
    var wg = x.createRadialGradient(cx - wr * 0.25, cy - wr * 0.3, wr * 0.05, cx, cy, wr);
    wg.addColorStop(0, '#3f7f84'); wg.addColorStop(0.7, '#2a5d64'); wg.addColorStop(1, '#183c43');
    x.fillStyle = wg; x.beginPath(); x.arc(cx, cy, wr, 0, 6.2832); x.fill();
    x.save();
    x.beginPath(); x.arc(cx, cy, wr, 0, 6.2832); x.clip();
    // the koi, circling
    var f = lot.fish, th = lot.off + (mot.matches ? 0.3 : 1) * t * lot.speed;
    var rr = wr * 0.34;
    f.x = cx + Math.cos(th) * rr; f.y = cy + Math.sin(th) * rr;
    f.a = th + Math.PI / 2; f.turn = 0.9; f.len = wr * lot.size;
    f.phase = lot.off * 3 + t * (mot.matches ? 2 : 6.5);
    f.glow = Math.max(0, 1 - (t - lot.glowAt) / 1.4);
    D.fish(x, f);
    // the rim's shadow falling into the water, and two soft glints on the surface
    var sh = x.createLinearGradient(0, cy - wr, 0, cy - wr * 0.3);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sh; x.fillRect(cx - wr, cy - wr, 2 * wr, wr * 0.7);
    for (i = 0; i < 2; i++) {
      var gx = cx + Math.cos(t * 0.3 + i * 2.6 + lot.off) * wr * 0.35, gy = cy + Math.sin(t * 0.23 + i * 1.9) * wr * 0.3;
      var gl = x.createRadialGradient(gx, gy, 0, gx, gy, wr * 0.35);
      gl.addColorStop(0, 'rgba(200,230,225,0.08)'); gl.addColorStop(1, 'rgba(200,230,225,0)');
      x.fillStyle = gl; x.fillRect(gx - wr * 0.35, gy - wr * 0.35, wr * 0.7, wr * 0.7);
    }
    x.restore();
    // light catching the top of the rim
    x.strokeStyle = 'rgba(225,242,250,0.32)'; x.lineWidth = R * 0.05; x.lineCap = 'round';
    x.beginPath(); x.arc(cx, cy, R * 0.92, Math.PI * 1.08, Math.PI * 1.5); x.stroke();
  }

  function drawTray(lot, t) {
    var c = lot.canvas, W = fitCanvas(c), x = lot.ctx;
    if (!W) return;
    var m = W * 0.05, s = W - 2 * m, b = s * 0.11;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W);
    x.fillStyle = 'rgba(8,4,2,0.45)'; x.fillRect(m + W * 0.02, m + W * 0.03, s, s);
    // a cedar water tray
    var wood = x.createLinearGradient(0, m, 0, m + s);
    wood.addColorStop(0, '#9b6b3f'); wood.addColorStop(1, '#6a4527');
    x.fillStyle = wood; x.fillRect(m, m, s, s);
    x.strokeStyle = 'rgba(40,22,10,0.35)'; x.lineWidth = Math.max(1, W * 0.006);
    for (var i = 1; i < 6; i++) { x.beginPath(); x.moveTo(m, m + i * s / 6); x.lineTo(m + b, m + i * s / 6); x.moveTo(m + s - b, m + i * s / 6); x.lineTo(m + s, m + i * s / 6); x.stroke(); }
    var wx = m + b, ws = s - 2 * b;
    var wg = x.createRadialGradient(wx + ws * 0.4, wx + ws * 0.35, ws * 0.05, wx + ws / 2, wx + ws / 2, ws * 0.75);
    wg.addColorStop(0, '#2b5c5f'); wg.addColorStop(1, '#122e33');
    x.fillStyle = wg; x.fillRect(wx, wx, ws, ws);
    x.save();
    x.beginPath(); x.rect(wx, wx, ws, ws); x.clip();
    var p = lot.pad, sp = mot.matches ? 0.3 : 1;
    p.x = W / 2; p.y = W / 2; p.r = ws * 0.32 * p.k;
    p.rot = lot.off + Math.sin(t * 0.25 * sp + lot.off) * 0.3;
    p.tx = Math.sin(t * 1.3 * sp + lot.off) * 0.07; p.ty = Math.cos(t * 1.1 * sp + lot.off) * 0.07; p.bob = Math.sin(t * 1.7 * sp) * 0.25;
    D.pad(x, p);
    var sh = x.createLinearGradient(0, wx, 0, wx + ws * 0.25);
    sh.addColorStop(0, 'rgba(0,0,0,0.4)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sh; x.fillRect(wx, wx, ws, ws * 0.25);
    x.restore();
    x.strokeStyle = 'rgba(255,225,180,0.3)'; x.lineWidth = Math.max(1, W * 0.01);
    x.beginPath(); x.moveTo(m + 2, m + s - 2); x.lineTo(m + 2, m + 2); x.lineTo(m + s - 2, m + 2); x.stroke();
  }

  // a round woven basket seen from above, with the harvest piled in it
  function drawBasket(lot) {
    var c = lot.canvas, W = fitCanvas(c), x = lot.ctx;
    if (!W || lot.drawnAt === W) return;           // it does not move: draw it once per size
    lot.drawnAt = W;
    var cx = W / 2, cy = W / 2, R = W * 0.45, i;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W);
    x.fillStyle = 'rgba(8,4,2,0.45)'; x.beginPath(); x.ellipse(cx + W * 0.025, cy + W * 0.035, R, R * 0.98, 0, 0, 6.2832); x.fill();
    var bg = x.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    bg.addColorStop(0, '#7a5530'); bg.addColorStop(0.78, '#a37a46'); bg.addColorStop(1, '#c39a5e');
    x.fillStyle = bg; x.beginPath(); x.arc(cx, cy, R, 0, 6.2832); x.fill();
    // the weave: rings of short strands, each ring offset from the last
    x.lineCap = 'round';
    for (var ring = 0; ring < 7; ring++) {
      var rr = R * (0.2 + ring * 0.115), n = Math.round(10 + ring * 7), dash = 6.2832 / n;
      x.strokeStyle = ring % 2 ? 'rgba(60,35,15,0.35)' : 'rgba(235,205,150,0.22)'; x.lineWidth = Math.max(1, W * 0.018);
      for (i = 0; i < n; i++) { var a0 = i * dash + (ring % 2) * dash / 2; x.beginPath(); x.arc(cx, cy, rr, a0, a0 + dash * 0.55); x.stroke(); }
    }
    x.strokeStyle = '#d0a96b'; x.lineWidth = R * 0.08; x.beginPath(); x.arc(cx, cy, R * 0.96, 0, 6.2832); x.stroke();
    x.strokeStyle = 'rgba(70,40,15,0.5)'; x.lineWidth = Math.max(1, W * 0.006); x.beginPath(); x.arc(cx, cy, R * 0.91, 0, 6.2832); x.stroke();
    // the pile
    var n2 = Math.min(lot.count, 9), s = R * (lot.produce === 'chestnut' ? 0.42 : 0.55);
    for (i = n2 - 1; i >= 0; i--) {
      var a = i * 2.39996 + lot.off, d = R * 0.5 * Math.sqrt((i + 0.4) / Math.max(n2, 1));
      x.save(); x.shadowColor = 'rgba(20,10,4,0.45)'; x.shadowBlur = W * 0.02; x.shadowOffsetY = W * 0.01;
      D.produce(x, lot.produce, cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, a);
      x.restore();
    }
  }

  function frame(ms) {
    raf = requestAnimationFrame(frame);
    var t = ms / 1000;
    for (var i = 0; i < lots.length; i++) {
      var l = lots[i];
      if (l.canvas.getBoundingClientRect().bottom < 0) continue;
      if (l.produce) drawBasket(l); else if (l.fish) drawTub(l, t); else drawTray(l, t);
    }
  }

  function minutes(sec) {
    if (sec < 60) return Math.ceil(sec) + ' s';
    var m = sec / 60, whole = Math.floor(m), half = m - whole >= 0.25 && m - whole < 0.75;
    if (m - whole >= 0.75) whole++;
    return (whole || '') + (half ? '½' : '') + ' min';
  }

  /* ---------- the lots ---------- */
  function tubLen(k) { return Math.min(1.15, 0.45 + 0.5 * k); }      // how long a koi looks in a tub (in tub radii), by its size

  function makeLot(o) {
    var el = document.createElement('div');
    el.className = 'lot';
    var c = document.createElement('canvas');
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', o.alt);
    el.appendChild(c);
    var tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = '<h3></h3><p class="meta"></p><div class="cost">' + MON + '<span></span></div>';
    tag.querySelector('h3').textContent = o.name;
    tag.querySelector('.meta').textContent = o.meta;
    tag.querySelector('.cost span').textContent = o.cost;
    el.appendChild(tag);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'act' + (o.sell ? ' sell' : '');
    el.appendChild(b);
    var lot = { el: el, canvas: c, ctx: c.getContext('2d'), tag: tag, btn: b, off: Math.random() * 6.283,
                speed: 0.35 + Math.random() * 0.2, glowAt: -9, update: null };
    if (o.look) lot.fish = { look: o.look, len: 10, x: 0, y: 0, a: 0, phase: 0, turn: 0, glow: 0 }, lot.size = o.size;
    if (o.plant) lot.pad = { kind: o.plant, k: o.padK || 1, tone: o.tone || 0, flower: S.PLANTS[o.plant].flower, r: 10, x: 0, y: 0, rot: 0, tx: 0, ty: 0, bob: 0,
                             grow: o.grow === undefined ? 1e9 : o.grow };
    if (o.produce) { lot.produce = o.produce; lot.count = o.count; }
    lots.push(lot);
    return lot;
  }

  function stamp(lot, word) {
    var old = lot.tag.querySelector('.stamp');
    if (old) old.remove();
    var s = document.createElement('div');
    s.className = 'stamp'; s.textContent = word;
    lot.tag.appendChild(s);
    clearTimeout(lot.stampT);
    lot.stampT = setTimeout(function () { s.remove(); }, 1600);
  }

  function setNote() {
    var p = pond();
    if (tab === 'koi') note.innerHTML = 'Young koi, about ' + Math.round(S.YOUNG_K * 24) + ' cm. Feed them and they grow, and a bigger koi fetches more. <b>' + p.fish.length + ' of ' + S.MAX_FISH + '</b> in your pond.';
    else if (tab === 'plants') note.innerHTML = 'Crops ripen on the water and glow when ready. Tap one to pick it, then sell the harvest here. <b>' + p.pads.length + ' of ' + S.MAX_PADS + '</b> plants in your pond.';
    else note.innerHTML = 'What the dealer pays today. Koi fetch more the bigger they grow. Plants sell back for half.';
  }
  function refresh() { setNote(); for (var i = 0; i < lots.length; i++) if (lots[i].update) lots[i].update(); }

  function grid(parent) { var g = document.createElement('div'); g.className = 'grid'; parent.appendChild(g); return g; }
  function shelf(parent, text) { var h = document.createElement('h3'); h.className = 'shelf'; h.textContent = text; parent.appendChild(h); }

  function buildKoi(root) {
    var g = grid(root);
    S.VARIETY_ORDER.forEach(function (id) {
      var v = S.VARIETIES[id];
      var lot = makeLot({ name: v.name, meta: Math.round(S.YOUNG_K * 24) + ' cm, young', cost: v.price, look: v.look, size: tubLen(S.YOUNG_K),
                          alt: 'A young ' + v.name + ' koi swimming in a tub' });
      lot.update = function () {
        var why = pond().canBuyFish(id);
        lot.btn.disabled = !!why; lot.btn.textContent = why || 'Buy';
      };
      lot.btn.addEventListener('click', function () {
        var r = pond().buyFish(id);
        if (r.error) return;
        lot.glowAt = performance.now() / 1000;
        stamp(lot, 'Bought'); showCoins(-v.price); G.save(); refresh();
      });
      g.appendChild(lot.el);
    });
  }

  function buildPlants(root) {
    shelf(root, 'Crops');
    var gc = grid(root);
    S.CROP_ORDER.forEach(function (id, n) {
      var pl = S.PLANTS[id], P = S.PRODUCE[id], c = pl.crop;
      var lot = makeLot({ name: pl.name, meta: c.yield + ' ' + P.unit + ' every ' + minutes(c.grow), cost: pl.price, plant: id, tone: n % 3,
                          alt: 'A ripe ' + pl.name.toLowerCase() + ' plant in a wooden tray' });
      lot.update = function () {
        var why = pond().canBuyPlant(id);
        lot.btn.disabled = !!why; lot.btn.textContent = why || 'Buy';
      };
      lot.btn.addEventListener('click', function () {
        var r = pond().buyPlant(id);
        if (r.error) return;
        stamp(lot, 'Bought'); showCoins(-pl.price); G.save(); refresh();
      });
      gc.appendChild(lot.el);
    });
    shelf(root, 'Flowers');
    var g = grid(root);
    S.PLANT_ORDER.forEach(function (id, n) {
      var pl = S.PLANTS[id];
      var lot = makeLot({ name: pl.name, meta: pl.flower ? 'A pad with a flower' : 'A plain green pad', cost: pl.price, plant: id, tone: n % 3,
                          alt: 'A ' + pl.name.toLowerCase() + ' floating in a wooden tray' });
      lot.update = function () {
        var why = pond().canBuyPlant(id);
        lot.btn.disabled = !!why; lot.btn.textContent = why || 'Buy';
      };
      lot.btn.addEventListener('click', function () {
        var r = pond().buyPlant(id);
        if (r.error) return;
        stamp(lot, 'Bought'); showCoins(-pl.price); G.save(); refresh();
      });
      g.appendChild(lot.el);
    });
  }

  function sellButton(lot, price, sellIt, cantWhy) {
    var armed = false, timer = 0;
    lot.update = function () {
      var why = cantWhy();
      lot.btn.disabled = !!why;
      lot.btn.classList.toggle('sure', armed && !why);
      lot.btn.textContent = why || (armed ? 'Tap again to sell' : 'Sell for ' + price);
    };
    lot.btn.addEventListener('click', function () {
      if (!armed) { armed = true; lot.update(); clearTimeout(timer); timer = setTimeout(function () { armed = false; lot.update(); }, 3000); return; }
      clearTimeout(timer);
      var r = sellIt();
      if (r.error) { armed = false; lot.update(); return; }
      showCoins(r.paid); G.save(); render(true);
    });
  }

  function buildSell(root) {
    var p = pond();
    shelf(root, 'Your harvest');
    var kinds = S.CROP_ORDER.filter(function (k) { return p.basket[k] > 0; });
    if (!kinds.length) {
      var none = document.createElement('p'); none.className = 'empty';
      none.textContent = 'Nothing picked yet. Grow crops from the Plants crate, and tap them on the water when they glow.';
      root.appendChild(none);
    } else {
      var gh = grid(root);
      kinds.forEach(function (k) {
        var P = S.PRODUCE[k], n = p.basket[k], total = n * P.value;
        var lot = makeLot({ name: P.name, meta: n + ' at ' + P.value + ' each', cost: total, produce: k, count: n, sell: true,
                            alt: 'A basket of ' + n + ' ' + (n === 1 ? P.one : P.many) });
        lot.update = function () { lot.btn.disabled = false; lot.btn.textContent = 'Sell all for ' + total; };
        lot.btn.addEventListener('click', function () {
          var r = pond().sellProduce(k);
          if (r.error) return;
          showCoins(r.paid); G.save(); render(true);
        });
        gh.appendChild(lot.el);
      });
    }
    shelf(root, 'Your koi');
    var g = grid(root);
    p.fish.slice().sort(function (a, b) { return S.fishValue(b) - S.fishValue(a); }).forEach(function (f) {
      var v = S.VARIETIES[f.variety], price = S.fishValue(f);
      var lot = makeLot({ name: v.name, meta: S.sizeCm(f) + ' cm', cost: price, look: f.look, size: tubLen(f.kt), sell: true,
                          alt: 'Your ' + S.sizeCm(f) + ' cm ' + v.name + ' koi in a tub' });
      sellButton(lot, price, function () { return pond().sellFish(f); }, function () { return pond().fish.length <= 1 ? 'Keep at least one' : ''; });
      g.appendChild(lot.el);
    });
    shelf(root, 'Your plants');
    if (!p.pads.length) {
      var e = document.createElement('p'); e.className = 'empty'; e.textContent = 'No plants in your pond yet.'; root.appendChild(e);
      return;
    }
    var g2 = grid(root);
    p.pads.forEach(function (pad) {
      var pl = S.PLANTS[pad.kind], price = S.padValue(pad);
      var meta = 'From your pond';
      if (pl.crop) { var left = pl.crop.grow - pad.grow; meta = left <= 0 ? 'Ripe, pick it first' : 'Ripe in ' + minutes(left); }
      var lot = makeLot({ name: pl.name, meta: meta, cost: price, plant: pad.kind, padK: Math.min(1.1, pad.k), tone: pad.tone, sell: true, grow: pad.grow,
                          alt: 'Your ' + pl.name.toLowerCase() + ' in a wooden tray' });
      sellButton(lot, price, function () { return pond().sellPad(pad); }, function () { return ''; });
      g2.appendChild(lot.el);
    });
  }

  function render(keepScroll) {
    var top = lotsEl.scrollTop;
    lots = [];
    lotsEl.innerHTML = '';
    crates.forEach(function (c) { c.setAttribute('aria-selected', c.dataset.tab === tab ? 'true' : 'false'); c.tabIndex = c.dataset.tab === tab ? 0 : -1; });
    if (tab === 'koi') buildKoi(lotsEl); else if (tab === 'plants') buildPlants(lotsEl); else buildSell(lotsEl);
    refresh();
    lotsEl.scrollTop = keepScroll ? top : 0;
  }

  /* ---------- opening and closing ---------- */
  function open() {
    if (!shop.hidden) return;
    shop.hidden = false; shown = Date.now();
    showCoins(0); render(false);
    if (!raf) raf = requestAnimationFrame(frame);
    shut.focus();
  }
  function close() {
    if (shop.hidden) return;
    shop.hidden = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lots = []; lotsEl.innerHTML = '';
    G.save();
    btn.focus();
  }

  btn.addEventListener('click', open);
  shut.addEventListener('click', close);
  shop.addEventListener('click', function (e) { if (e.target === shop) close(); });
  crates.forEach(function (c) {
    c.addEventListener('click', function () { if (tab !== c.dataset.tab) { tab = c.dataset.tab; render(false); } });
  });
  shop.querySelector('.crates').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = crates.findIndex(function (c) { return c.dataset.tab === tab; });
    i = (i + (e.key === 'ArrowRight' ? 1 : crates.length - 1)) % crates.length;
    tab = crates[i].dataset.tab; render(false); crates[i].focus();
  });
  document.addEventListener('keydown', function (e) {
    if (shop.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    // keep the keyboard inside the shop while it is open
    var f = Array.prototype.filter.call(shop.querySelectorAll('button'), function (b) { return !b.disabled && b.tabIndex !== -1; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  showCoins(0);
  window.addEventListener('koi:change', function () { showCoins(0); });
  window.KoiShop ={ open: open, close: close, isOpen: function () { return !shop.hidden; } };
})();
