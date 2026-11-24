/* Stillwater Koi prototype: input, interface, saving, the frame loop.
   The screen is kept clear: a purse at the top, one bar at the bottom, and one pop-up sheet at a time.
   Taps do the obvious thing for what is under them, so there are no tools to pick apart from food or pebbles. */
(function () {
  'use strict';
  var S = window.KoiSim, T = S.T, A = window.KoiAudio, R = window.KoiRender;
  var SAVE_KEY = 'stillwater-koi-v1', SAND_KEY = SAVE_KEY + '-sand';
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c'), cardEl = $('card'), awayEl = $('away'), sheetEl = $('sheet'), headEl = $('head'), bodyEl = $('body'),
      scrimEl = $('scrim'), placeEl = $('placebar'), fileEl = $('file');
  var qs = location.search;
  var speedM = /[?&]speed=(\d+)/.exec(qs);
  var fresh = /[?&]fresh=1/.test(qs);
  var nosave = /[?&]nosave=1/.test(qs);

  var view = R.create(canvas);
  var SW = 0, SH = 0, zoom = 1, game = null;      // the screen in CSS pixels, and how big one world pixel is on it
  var hand = 'food';                               // what a tap on open water does: 'food' or 'pebble'
  var sheet = null, tabs = { koi: 'koi' };
  var selected = null, pick = null;                // the koi on the card, and the koi chosen for pairing
  var selItem = null;                              // a garden thing on the card: { kind, i }
  var selLot = null, selGate = false, buildId = null, sands = {};   // a building on the card, the plot being built on, saved sand
  var placing = null;                              // a garden thing being carried: { type, a, seed, move }
  var arranging = false;                           // taps pick up garden things instead of feeding
  var shopSel = -1, confirmNew = false, lastSaved = 0, wasSettled = false;

  var GROUPS = {
    koi: { tabs: [['koi', 'Your koi'], ['book', 'Koi Book']] },
    sell: { title: 'Sell' },
    dealer: { title: 'Koi dealer' },
    requests: { title: 'Requests' },
    shows: { title: 'Koi shows' },
    garden: { title: 'Garden shop' },
    map: { title: 'Map' },
    build: { title: 'Build' },
    move: { title: 'Move to another pond' },
    menu: { title: 'Menu' }
  };
  var ORDER = ['koi', 'map', 'requests', 'shows', 'sell', 'dealer', 'garden', 'menu'];
  var COIN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#dcbc5e" stroke="#a8873a"/></svg>';
  var ICON = {
    food: '<svg viewBox="0 0 24 24" stroke="none" fill="#dcc08a"><circle cx="8" cy="9" r="2.6"/><circle cx="15.5" cy="8" r="2.1"/><circle cx="12.5" cy="15.5" r="2.9"/></svg>',
    pebble: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10" opacity=".45"/></svg>'
  };

  var VIEW_W = 1280, VIEW_H = 800;
  function size() {
    SW = Math.max(50, window.innerWidth); SH = Math.max(50, window.innerHeight);
    // a Steam Deck sees the world at full size; a phone sees it smaller so the koi are not giants
    // the screen shows the middle 1280 x 800 of a plot, scaled to cover it: on a Steam Deck that is one to one
    zoom = Math.max(SW / VIEW_W, SH / VIEW_H);
  }
  /* Zoom in or out, keeping the point of the garden under (sx, sy) on the screen where it is. */
  var baseZoom = 1, userZoom = 1, ZOOM_KEY = SAVE_KEY + '-zoom';
  function setZoom(next, sx, sy) {
    return;   // the view is fixed now: one plot to a screen
    next = Math.max(0.3, Math.min(1.6, next));
    if (Math.abs(next - userZoom) < 0.004 || !game) return;
    if (sx === undefined) { sx = SW / 2; sy = SH / 2; }
    var wx = sx / zoom + game.cam.x, wy = sy / zoom + game.cam.y;
    userZoom = next; zoom = baseZoom * userZoom;
    game.resize(SW / zoom, SH / zoom);
    game.camTo = null;
    game.cam.x = wx - sx / zoom; game.cam.y = wy - sy / zoom;
    game.panBy(0, 0);
    view.setup(game, SW, SH, zoom);
    try { localStorage.setItem(ZOOM_KEY, String(userZoom)); } catch (e) {}
  }

  /* ---------- saving ---------- */
  function boot() {
    size();
    var away = null, data = null;
    if (!fresh) { try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; } }
    if (data) game = S.Game.load(data, SW / zoom, SH / zoom);
    if (game && data.savedAt) {
      var elapsed = (Date.now() - data.savedAt) / 1000;
      if (elapsed > 60) away = game.catchUp(elapsed);
    }
    var isNew = !game;
    if (!game) game = S.Game.fresh(SW / zoom, SH / zoom, (Math.random() * 4294967296) >>> 0);
    if (speedM) game.timeScale = Math.max(1, +speedM[1]);
    view.setup(game, SW, SH, zoom);
    if (!isNew) { try { sands = JSON.parse(localStorage.getItem(SAND_KEY)) || {}; } catch (e) { sands = {}; } view.sandIn(sands); }
    if (fresh) {
      // a new pond was asked for once; do not ask again on the next reload
      try {
        if (!nosave) localStorage.removeItem(SAND_KEY);
        history.replaceState(null, '', location.pathname + qs.replace(/[?&]fresh=1/, '').replace(/^&/, '?'));
      } catch (e) {}
      fresh = false;
    }
    if (away) showAway(away);
    else if (isNew) toast('Tap the water to drop some food. Swipe down to visit the Market.');
    setHand(hand);
    setWatch(false);
    stir();
    save();
    window.__game = game;
  }

  function save() {
    if (nosave || !game) return false;
    var d = game.toJSON();
    d.savedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(d));
      var sand = view.sandOut();
      if (sand) { for (var sid in sand) sands[sid] = sand[sid]; localStorage.setItem(SAND_KEY, JSON.stringify(sands)); }
      lastSaved = d.savedAt;
      return true;
    } catch (e) { return false; }
  }
  function exportSave() {
    save();
    var d = game.toJSON(), sand = sands;
    d.savedAt = Date.now();
    var blob = new Blob([JSON.stringify({ game: 'stillwater-koi', save: d, sand: sand })], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'stillwater-koi-save.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Saved to a file.');
  }
  fileEl.addEventListener('change', function () {
    var f = fileEl.files && fileEl.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var d = null;
      try { d = JSON.parse(rd.result); } catch (e) {}
      if (!d || !d.save || !S.Game.load(d.save, 800, 600)) { toast('That file is not a Stillwater Koi save.'); return; }
      try {
        d.save.savedAt = Date.now();
        localStorage.setItem(SAVE_KEY, JSON.stringify(d.save));
        if (d.sand && typeof d.sand === 'object') localStorage.setItem(SAND_KEY, JSON.stringify(d.sand)); else localStorage.removeItem(SAND_KEY);
      } catch (e) { toast('Could not store that save here.'); return; }
      nosave = true;            // do not let the pond on screen overwrite the one just loaded
      location.reload();
    };
    rd.readAsText(f);
    fileEl.value = '';
  });
  function newPond() {
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(SAND_KEY); } catch (e) {}
    nosave = true;
    location.reload();
  }

  /* ---------- small helpers ---------- */
  function span(sec) {
    var m = Math.round(sec / 60);
    if (m < 1) return 'under a minute';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60); m = m % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }
  // pond seconds left, shown as real time at the current pace
  function wait(pondSec) { return span(Math.max(0, pondSec) / game.presence() / game.timeScale); }
  function swatch(genes, unknown) {
    if (unknown) return '<span class="sw q">?</span>';
    var ph = S.phenotype(genes);
    return '<span class="sw" style="background:' + S.BASES[ph.base].col + '">' +
      (ph.second >= 0 ? '<i style="background:' + S.SECONDS[ph.second].col + '"></i>' : '') + '</span>';
  }
  function price(n) { return '<span class="price">' + COIN + n + '</span>'; }
  // only touch the page when the text changed, so a button is never swapped out mid-tap
  function put(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } el.hidden = false; }
  function fedWord(k) { return k.full >= 0.66 ? 'Well fed' : k.full >= 0.3 ? 'Peckish' : 'Hungry'; }
  function kind(k) { return game.revealed(k) ? S.varietyName(k.genes) : 'Colours not in yet'; }
  function pct(p) { return p >= 0.995 ? '100%' : p < 0.01 ? '<1%' : Math.round(p * 100) + '%'; }
  function areaAt(col, row) {
    for (var i = 0; i < S.AREAS.length; i++) if (S.AREAS[i].col === col && S.AREAS[i].row === row) return S.AREAS[i];
    return null;
  }

  function toast(text) {
    var box = $('toasts'), el = document.createElement('div');
    el.className = 'toast glass'; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { el.className = 'toast glass out'; }, 4200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5300);
  }

  function showAway(a) {
    var html = '<h2>Welcome back</h2><p>You were away for ' + span(a.elapsed) + '.</p>';
    if (a.earned > 0) html += '<p>The koi earned ' + a.earned + ' coins.</p>';
    for (var i = 0; i < Math.min(4, a.notes.length); i++) html += '<p class="muted">' + a.notes[i] + '</p>';
    html += '<button class="gold" data-act="closeaway">Sit down</button>';
    awayEl.innerHTML = html; awayEl.hidden = false;
  }

  /* ---------- the bar, the purse, the arrows ---------- */
  var marks = {};   // which stations have something for you
  /* The screen keeps out of the way. Leave it alone for a few seconds and everything but the garden fades;
     touch anything and it comes back. In Watch mode it fades sooner. */
  var calm = 0, lastTouch = 0, calmShown = -1;
  function stir() { lastTouch = performance.now(); }
  function stepCalm(dt) {
    var idle = performance.now() - lastTouch, busy = sheet || placing || arranging || selected || selLot || selGate || pick || !awayEl.hidden;
    var want = !busy && idle > (game.watch ? 2500 : 7000) ? 1 : 0;
    calm += (want - calm) * Math.min(1, dt * (want ? 0.9 : 7));
    if (Math.abs(calm - calmShown) > 0.01) { calmShown = calm; document.documentElement.style.setProperty('--calm', calm.toFixed(2)); }
  }
  function setWatch(on) {
    game.setWatch(on);
    $('watch').setAttribute('aria-pressed', on ? 'true' : 'false');
    put($('watch'), '<svg viewBox="0 0 24 24"><path d="M2 12c3-5.500 7-8 10-8s7 2.500 10 8c-3 5.500-7 8-10 8s-7-2.500-10-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (on ? 'Watching' : 'Watch'));
    if (on && !hinted.watch) { hinted.watch = 1; toast('Sit back. The caretaker will feed the koi and bring in the takings, a little slower than you would.'); }
  }
  /* The koi that could be paired with the one chosen: grown, not already paired, and not itself. */
  function mates() {
    if (!pick || game.koi.indexOf(pick) < 0) return null;
    return game.koi.filter(function (k) { return !game.canPair(pick, k); });
  }
  function setHand(h) {
    if (h !== hand) A.ui('hand');
    hand = h;
    put($('hand'), ICON[h] + (h === 'food' ? 'Feed' : 'Play'));
  }
  function drawHud() {
    $('coins').textContent = game.coins;
    $('count').textContent = game.koi.length + ' / ' + game.capacity() + ' koi';
    var ready = 0, i;
    if (game.koi.length > 2) for (i = 0; i < game.requests.length; i++) if (game.matches(i).length) ready++;
    $('ready').hidden = !ready; $('ready').textContent = ready + (ready === 1 ? ' request ready' : ' requests ready');
    marks.requests = ready > 0; marks.sell = game.goodsWorth() > 0;
    marks.shows = game.showEntrants(game.showNow()).length > 0;
    var gcap = game.gateCap(), gfull = game.gate.till >= gcap - 0.5;
    $('gatepill').className = 'pill small glass' + (gfull ? ' full' : '');
    put($('gatepill'), 'Gate ' + Math.floor(game.gate.till) + ' / ' + gcap + (gfull ? ' · full' : ''));
    $('gatepill').hidden = game.gate.till < 0.8 * gcap;
    if (game.gate.till >= 1 && !hinted.gate) { hinted.gate = 1; toast('Guests pay at the ticket gate in the Market. Go there to collect.'); }
    var st = game.stars(), stars = '';
    for (i = 0; i < 5; i++) stars += i < st ? '★' : '☆';
    $('stars').textContent = stars + '  ' + game.visitors.length + ' guests';
    var gl = game.goalNow(), done = game.goalDone();
    $('goal').hidden = !gl;
    if (gl) { $('goal').className = 'pill small glass' + (done ? ' done' : ''); put($('goal'), (done ? 'Done: ' : 'Next: ') + gl.text + (done ? ' · tap for ' : ' · ') + price(gl.reward)); }
    var ripe = game.ripeCount();
    $('basket').hidden = !game.goodsWorth() && !ripe;
    $('basket').textContent = game.goodsWorth() ? 'Basket ' + game.goodsWorth() : ripe + ' ready to pick';
  }
  /* Each plot is a room that fills the screen. A swipe, an arrow, an arrow key or a flick of the right stick
     goes to the plot next door. You can go to any plot you have built on, or could build on. */
  function roomOf() { return game.areaUnder(game.cam.x + game.W / 2, game.cam.y + game.H / 2); }
  function navigable(a) { return !!a && (!!game.lots[a.id] || game.reachable(a.id)); }
  // on a narrow screen a plot is wider than the view, so the view may slide this far inside it before the next plot
  function rangeX() { return Math.max(0, VIEW_W / 2 - game.W / 2); }
  function rangeY() { return Math.max(0, VIEW_H / 2 - game.H / 2); }
  function clampN(v, lim) { return v < -lim ? -lim : v > lim ? lim : v; }
  function goRoom(a, fromX, fromY) {
    var sh = S.SHAPES[a.id], rx = rangeX(), ry = rangeY();
    game.glide(sh.cx + clampN(fromX || 0, rx) - game.W / 2, sh.cy + clampN(fromY || 0, ry) - game.H / 2);
  }
  /* Let the view come to rest: inside the plot it started in, or on the next one if it was pulled far enough. */
  function settle(from) {
    var a = from || roomOf(), sh = S.SHAPES[a.id], rx = rangeX(), ry = rangeY();
    var ox = game.cam.x + game.W / 2 - sh.cx, oy = game.cam.y + game.H / 2 - sh.cy, px = Math.abs(ox) - rx, py = Math.abs(oy) - ry, nb = null;
    if (px > game.W * 0.14 && px >= py) nb = areaAt(a.col + (ox > 0 ? 1 : -1), a.row);
    else if (py > game.H * 0.14) nb = areaAt(a.col, a.row + (oy > 0 ? 1 : -1));
    if (nb && navigable(nb)) {
      // arrive at the near side of the new plot
      goRoom(nb, nb.col !== a.col ? (ox > 0 ? -rx : rx) : ox, nb.row !== a.row ? (oy > 0 ? -ry : ry) : oy);
      A.ui('hand');
    } else goRoom(a, ox, oy);
    drawNav();
  }
  function page(dc, dr) {
    var a = roomOf(), nb = areaAt(a.col + dc, a.row + dr);
    if (!navigable(nb)) return false;
    goRoom(nb, 0, 0); A.ui('hand');
    return true;
  }
  /* While a finger drags the view: it follows, but will not go far toward a plot you cannot visit. */
  var dragRoom = null;
  /* Dragging moves the view freely, and when you let go it carries on a little and eases to a stop. */
  var drift = { x: 0, y: 0, at: 0, on: false };
  function dragView(dx, dy) {
    var now = performance.now(), ms = Math.max(4, Math.min(80, now - drift.at));
    game.panBy(dx, dy);
    // how fast the view is moving, in world pixels a second, smoothed over the last few moves
    drift.x += (dx / ms * 1000 - drift.x) * 0.45; drift.y += (dy / ms * 1000 - drift.y) * 0.45;
    drift.at = now; drift.on = false;
  }
  function letGo() {
    // a finger that paused before lifting leaves the view still
    if (performance.now() - drift.at > 90) { drift.x = drift.y = 0; return; }
    var sp = Math.hypot(drift.x, drift.y), cap = 2600;
    if (sp > cap) { drift.x *= cap / sp; drift.y *= cap / sp; }
    drift.x *= 0.75; drift.y *= 0.75;                 // a soft carry, not a throw
    drift.on = sp > 40;
  }
  function stepDrift(dt) {
    if (!drift.on) return;
    if (game.camTo) { drift.on = false; return; }   // an arrow or a station has taken the view somewhere on purpose
    if (dt < 0.002) return;                          // nothing to do in a frame that took no time
    var bx = game.cam.x, by = game.cam.y;
    game.panBy(drift.x * dt, drift.y * dt);
    var k = Math.exp(-dt * 5);
    drift.x *= k; drift.y *= k;
    // spent, or up against the edge of the garden
    if (Math.hypot(drift.x, drift.y) < 12 || (game.cam.x === bx && game.cam.y === by)) drift.on = false;
  }
  var NAV = { l: [-1, 0, 'navL'], r: [1, 0, 'navR'], u: [0, -1, 'navU'], d: [0, 1, 'navD'] };
  function navTo(dir) {
    var n = NAV[dir], f = roomOf();
    return areaAt(f.col + n[0], f.row + n[1]);
  }
  function navState(dir) {
    var nb = navTo(dir);
    return !navigable(nb) ? '' : game.lots[nb.id] ? 'go' : 'locked';
  }
  function drawNav() {
    for (var dir in NAV) {
      var el = $(NAV[dir][2]), st = sheet || placing ? '' : navState(dir);
      el.hidden = !st;
      el.className = 'nav glass' + (st === 'locked' ? ' locked' : '');
    }
  }
  function nav(dir) { page(NAV[dir][0], NAV[dir][1]); }

  /* ---------- sheets ---------- */
  function openSheet(name) {
    sheet = sheet === name ? null : name;
    A.ui(sheet ? 'open' : 'close');
    confirmNew = false; shopSel = -1;
    if (sheet) { if (placing) stopPlacing(); arranging = false; drawPlace(); }
    drawSheet(); drawNav();
  }
  function closeSheet() { if (sheet) openSheet(sheet); }
  function tabOf() { return GROUPS[sheet].tabs ? tabs[sheet] : sheet; }

  function drawSheet() {
    var bs = document.querySelectorAll('#bar [data-sheet]'), i;
    for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-sheet') === sheet ? 'true' : 'false');
    if (!sheet) { sheetEl.hidden = true; scrimEl.hidden = true; return; }
    var g = GROUPS[sheet], tab = tabOf(), h = '';
    if (g.tabs) {
      h = '<div class="tabs">';
      for (i = 0; i < g.tabs.length; i++) h += '<button data-tab="' + g.tabs[i][0] + '" aria-pressed="' + (g.tabs[i][0] === tab) + '">' + g.tabs[i][1] + '</button>';
      h += '</div>';
    } else h = '<h2>' + g.title + '</h2>';
    put(headEl, h + '<button class="x" data-act="close" aria-label="Close">&times;</button>');
    sheetEl.className = 'glass' + (tab === 'dealer' ? ' wide' : '');
    put(bodyEl, BODY[tab]());
    sheetEl.hidden = false; scrimEl.hidden = false;
  }

  var BODY = {
    koi: function () {
      var h = '', list = game.koi.slice().sort(function (a, b) { return b.growth - a.growth; }), i;
      for (i = 0; i < list.length; i++) {
        var k = list[i], pr = game.pairOf(k.id), sub = kind(k) + ' · ' + game.stage(k) + (game.pondsOpen() > 1 ? ' · ' + S.biomeById(k.pond).name : '');
        if (pick && pick !== k && !game.canPair(pick, k)) sub += ' · <span style="color:#dcbc5e">can pair with ' + pick.name + '</span>';
        if (pr) sub += ' · ' + (pr.waiting ? 'waiting for room' : 'fry in ' + wait(pr.left));
        h += '<div class="row click" data-act="select" data-id="' + k.id + '">' + swatch(k.genes, !game.revealed(k)) +
          '<div class="grow"><div>' + k.name + '</div><div class="sub">' + sub + '</div></div><div class="num">' + game.value(k) + '</div></div>';
      }
      var rooms = S.BIOMES.filter(function (b) { return game.sections(b.id); }).map(function (b) { return b.name + ' ' + game.pondCount(b.id) + ' of ' + game.pondCap(b.id); }).join(' · ');
      return h + '<p class="muted">Tap a koi to find it. ' + rooms + '.</p>';
    },
    book: function () {
      var h = '<p class="muted">' + game.bookCount() + ' of ' + S.BOOK_TOTAL + ' found.</p><div class="book">', i;
      for (i = 0; i < S.VARIETIES.length; i++) {
        var v = S.VARIETIES[i], got = !!game.book[v.key];
        h += '<div class="bk' + (got ? '' : ' un') + '">' + swatch(v.genes, !got) + '<span>' + (got ? v.name : 'Not found yet') + '</span></div>';
      }
      return h + '</div>';
    },
    sell: function () {
      var h = '<p class="muted">What the garden has grown, and koi ready for a new home.</p>', k, any = false, i;
      h += '<h3>From the garden</h3>';
      for (k in S.GOODS) {
        var n = game.goods[k] || 0, gd = S.GOODS[k];
        if (!n) continue;
        any = true;
        h += '<div class="row"><div class="grow"><div>' + gd.name + ' <span class="muted">· ' + n + '</span></div><div class="sub">' + gd.price + ' each</div></div>' +
          '<button class="gold" data-act="sellgoods" data-good="' + k + '">Sell all ' + price(n * gd.price) + '</button></div>';
      }
      if (!any) {
        var ripe = game.ripeCount();
        h += '<p class="sub">' + (ripe ? ripe + ' of your plants ' + (ripe === 1 ? 'is' : 'are') + ' ready. Tap the ones that glint to pick them.'
          : 'Nothing in the basket. Lotus, reeds, water iris and bonsai all grow something you can pick and sell here.') + '</p>';
      }
      h += '<h3>Koi</h3>';
      var list = game.koi.slice().sort(function (a, b) { return game.value(b) - game.value(a); });
      for (i = 0; i < list.length; i++) {
        var f = list[i], block = game.canSell(f);
        h += '<div class="row">' + swatch(f.genes, !game.revealed(f)) + '<div class="grow"><div>' + f.name + '</div><div class="sub">' + kind(f) + ' · ' + game.stage(f) +
          (game.pairOf(f.id) ? ' · paired' : '') + '</div></div><button data-act="sellkoi" data-id="' + f.id + '"' + (block ? ' disabled' : '') + '>' + price(game.value(f)) + '</button></div>';
      }
      if (game.koi.length <= 2) h += '<p class="sub">Keep at least two koi in the pond.</p>';
      return h;
    },
    requests: function () {
      var h = '<p class="muted">People asking for a particular koi. They pay well above the usual price.</p>', i, n;
      for (i = 0; i < game.requests.length; i++) {
        var r = game.requests[i];
        if (!r) { h += '<div class="req"><div class="row"><div class="grow muted">Someone new will ask in ' + wait(game.requestWait[i]) + '.</div></div></div>'; continue; }
        var m = game.matches(i);
        h += '<div class="req"><div class="row">' + swatch(r.genes) + '<div class="grow"><div>' + r.name + '</div><div class="sub">' + r.who + ' · ' +
          (r.stage === 'Adult' ? 'Adult or older' : 'Young or older') + (game.book[r.key] ? '' : ' · not yet in your Koi Book') + '</div></div>' + price(r.reward) + '</div><div class="acts">';
        for (n = 0; n < m.length; n++) {
          h += '<button class="gold" data-act="give" data-id="' + i + '" data-koi="' + m[n].id + '"' + (game.koi.length <= 2 ? ' disabled' : '') + '>Give ' + m[n].name + '</button>';
        }
        h += '<button data-act="pass" data-id="' + i + '">Pass</button></div></div>';
      }
      return h;
    },
    shows: function () {
      var now = game.showNow(), h, i, n;
      h = '<p class="muted">Koi shows are held one after another. Win one to open the next. Each wants a particular koi, raised a particular way; a winner comes home with its ribbon.</p>';
      h += '<p class="sub">' + game.showsWon() + ' of ' + S.SHOWS.length + ' shows won. Every win makes the garden better known.</p>';
      for (i = 0; i < S.SHOWS.length; i++) {
        var s = S.SHOWS[i], won = game.shows[s.id], lock = won ? '' : game.showLocked(s);
        if (!won && s !== now) {                     // later shows: name only, so there is something to look forward to
          h += '<div class="req"><div class="row"><div class="grow muted">🔒 ' + s.name + '</div>' + price(s.prize) + '</div></div>';
          continue;
        }
        h += '<div class="req"><div class="row"><div class="grow"><div>' + (won ? '🏆 ' : '') + s.name + '</div><div class="sub">' + s.host + ' · ' + s.want + '</div>' +
          (won ? '<div class="sub">Won by ' + won + '.</div>' : lock ? '<div class="sub">🔒 ' + lock + '</div>' : '') + '</div>' + price(s.prize) + '</div>';
        if (!won && !lock) {
          var ents = game.showEntrants(s);
          h += '<div class="acts">';
          for (n = 0; n < ents.length; n++) h += '<button class="gold" data-act="enter" data-show="' + s.id + '" data-koi="' + ents[n].id + '">Enter ' + ents[n].name + '</button>';
          h += '</div>';
          if (!ents.length) h += '<p class="sub">None of your koi fits yet. Breed for it, raise it, and carry it to the right pond.</p>';
        }
        h += '</div>';
      }
      return h;
    },
    dealer: function () {
      var room = true, h, i;
      if (shopSel >= 0 && !game.offers[shopSel]) shopSel = -1;
      h = '<div class="awning"></div><div class="tanks">';
      for (i = 0; i < game.offers.length; i++) {
        var o = game.offers[i];
        h += '<div class="tank' + (i === shopSel ? ' on' : '') + (o ? '' : ' sold') + '"' + (o ? ' data-act="tank" data-id="' + i + '"' : '') + '>' +
          '<canvas width="300" height="190" data-tank="' + i + '"></canvas>' +
          '<div class="tag">' + (o ? '<span>' + S.varietyName(o.genes) + '</span><span class="num">' + o.price + '</span>' : '<span class="muted">Sold</span>') + '</div></div>';
      }
      h += '</div><div class="counter">';
      if (shopSel >= 0) {
        var so = game.offers[shopSel], cm = Math.round(game._len(so) / game.fishBase * 62);
        h += '<div class="grow"><div>' + S.varietyName(so.genes) + '</div><div class="sub">Young · ' + cm + ' cm · grown in about ' + wait(T.growAdult - so.growth) + '</div></div>' +
          '<button class="gold" data-act="buy" data-id="' + shopSel + '"' + (game.coins < so.price || !game.roomFor(so.genes, so.growth) ? ' disabled' : '') + '>Take home ' + price(so.price) + '</button>';
        if (!game.roomFor(so.genes, so.growth)) h += '</div><div class="counter"><div class="grow sub">No pond that would take this koi has room. Make a pond bigger, or open one that suits it.</div>';
      } else {
        h += '<div class="grow muted">' + (room ? 'Tap a tank to look closer. New koi arrive in ' + wait(game.offerLeft) + '.' : 'Your pond is full. Open more water from the Map.') + '</div>';
      }
      return h + '</div>';
    },
    garden: function () {
      var groups = ['Plants', 'Decorations', 'Zen garden'], gi, type;
      var h = '<p class="muted">Pick something, then tap where it should go. Place as many as you like.</p>' +
        '<div class="acts"><button data-act="arrange">Move or put away things</button></div>';
      for (gi = 0; gi < groups.length; gi++) {
        h += '<h3>' + groups[gi] + '</h3>';
        for (type in S.PLANTS) {
          var sp = S.PLANTS[type];
          if (sp.group !== groups[gi]) continue;
          var have = game.count(type), lim = sp.max * (sp.where === 'zen' ? 1 : game.waterAreas().length);
          h += '<div class="row"><div class="grow"><div>' + sp.name + (have ? ' <span class="muted">· ' + have + '</span>' : '') + '</div>' +
            '<div class="sub">' + sp.note + (sp.note.indexOf('Just') === 0 ? '' : ' Counts for the first ' + lim + '.') + '</div></div>' +
            '<button data-act="plant" data-type="' + type + '"' + (game.coins < sp.cost ? ' disabled' : '') + '>' + price(sp.cost) + '</button></div>';
        }
      }
      return h;
    },
    map: function () {
      var st = game.stars(), rn = game.renown(), next = S.STARS[st];
      var h = '<p class="muted">Six ponds, each opened a section at a time, and the street along the bottom. Finish all four sections of a pond to unlock the next. Tap a square to go there.</p><div class="plan">', r, c;
      function lockNote(pond) {
        for (var i = 1; i < S.BIOMES.length; i++) if (S.BIOMES[i].id === pond) return 'After the ' + S.BIOMES[i - 1].name + ' (' + game.sections(S.BIOMES[i - 1].id) + '/4)';
        return '';
      }
      for (r = 0; r < S.ROWS; r++) for (c = 0; c < S.COLS; c++) {
        var a = areaAt(c, r), lot = game.lots[a.id], can = !lot && game.reachable(a.id);
        h += '<button data-act="lot" data-area="' + a.id + '" class="' + (lot ? 'k-' + lot.kind : can ? 'free' : 'far') + (a.biome ? ' b-' + a.biome : '') + '"' + (lot || can ? '' : ' disabled') + '>' +
          (lot ? '<b>' + (lot.kind === 'pond' ? S.THEME_NAMES[S.themeOf(a.id)] : S.KINDS[lot.kind].name) + '</b><span>' + (lot.kind === 'pond' ? (a.first ? game.pondCount(a.biome) + ' of ' + game.pondCap(a.biome) + ' koi' : '') : 'Level ' + lot.level) +
            (game.tillCap(a.id) ? ' · ' + Math.floor(lot.till) + ' in till' : '') + '</span>' : can ? '<b>+</b><span>' + (a.biome ? S.THEME_NAMES[a.biome] : 'Build') + '</span>' : a.biome ? '<span>' + S.THEME_NAMES[a.biome] + (a.first && game.pondLocked(a.biome) ? '<br>🔒 ' + lockNote(a.biome) : '') + '</span>' : '') + '</button>';
      }
      return h + '</div>';
    },
    build: function () {
      var area = S.areaById(buildId), h, kind;
      if (area.biome) {
        var bio = S.biomeById(area.biome), cost = game.buildCost(buildId, 'pond'), n = game.sections(area.biome);
        h = '<p>' + (n ? 'Open another section of the ' + bio.name + '. The water runs together into one bigger pond, with room for 6 more koi.'
                       : 'Open the ' + bio.name + '. It starts with room for 6 koi, and has four sections in all.') + '</p>' +
          '<p class="muted">' + (bio.bases ? 'Only ' + game.likes(area.biome) + ' koi can live here. Carry them over from another pond once their colours are in.' : 'Any koi can live here.') + '</p>' +
          '<div class="acts"><button class="gold" data-act="build" data-kind="pond"' + (game.canBuild(buildId, 'pond') ? ' disabled' : '') + '>' + (n ? 'Open this section ' : 'Open the pond ') + price(cost) + '</button></div>' +
          '<p class="sub" style="margin-top:8px">You have ' + game.coins + ' coins.</p>';
        return h;
      }
      h = '<p class="muted">What should stand here on the street? You have ' + game.coins + ' coins.</p>';
      for (kind in S.KINDS) {
        var kd = S.KINDS[kind];
        if (kd.fixed || kd.retired || kind === 'pond') continue;
        var c2 = game.buildCost(buildId, kind), have = game.built(kind);
        h += '<div class="row"><div class="grow"><div>' + kd.name + (have ? ' <span class="muted">· you have ' + have + '</span>' : '') + '</div><div class="sub">' + kd.note +
          (kd.pay ? ' About ' + kd.pay + ' coins a guest.' : '') + '</div></div>' +
          '<button class="gold" data-act="build" data-kind="' + kind + '"' + (game.coins < c2 ? ' disabled' : '') + '>' + price(c2) + '</button></div>';
      }
      return h;
    },
    move: function () {
      var k = selected, h, i;
      if (!k || game.koi.indexOf(k) < 0) return '<p class="muted">Choose a koi first.</p>';
      h = '<p class="muted">' + k.name + ' is a ' + kind(k).toLowerCase() + ', living in the ' + S.biomeById(k.pond).name + '.</p>';
      for (i = 0; i < S.BIOMES.length; i++) {
        var b = S.BIOMES[i], open = game.sections(b.id), why = game.canMove(k, b.id);
        if (b.id === k.pond) continue;
        h += '<div class="row"><div class="grow"><div>' + b.name + (open ? ' <span class="muted">· ' + game.pondCount(b.id) + ' of ' + game.pondCap(b.id) + '</span>' : '') + '</div>' +
          '<div class="sub">' + (why || (b.bases ? 'For ' + game.likes(b.id) + ' koi.' : 'Any koi may live here.')) + '</div></div>' +
          '<button class="gold" data-act="moveto" data-pond="' + b.id + '"' + (why ? ' disabled' : '') + '>Move</button></div>';
      }
      return h;
    },
    menu: function () {
      var L = R.lightAt(game.sitting / 60), pr = game.presence();
      var ago = !lastSaved ? 'not yet' : Date.now() - lastSaved < 60000 ? 'a moment ago' : Math.round((Date.now() - lastSaved) / 60000) + ' min ago';
      var h;
      h = '<h3>Your garden</h3><p class="sub">' + game.koi.length + ' of ' + game.capacity() + ' koi · ' + game.bookCount() + ' of ' + S.BOOK_TOTAL + ' kinds found · ' +
        game.stars() + ' of 5 stars · ' + game.visitors.length + ' guests in the garden' + (game.goodsWorth() ? ' · basket worth ' + game.goodsWorth() : '') + '</p>';
      h += '<h3>Stations</h3><p class="sub">Everything is done at a station in the garden: tap one there, or go straight to it from here.</p><div class="acts">';
      S.STATIONS.forEach(function (q) { h += '<button data-act="station" data-id="' + q.id + '">' + q.name + '</button>'; });
      h += '</div>';
      h += '<h3>Sound</h3><div class="row"><div class="grow">Sound and music</div><button data-act="sound">' + (A.isOn() ? 'On' : 'Off') + '</button></div>';
      h += '<h3>Your pond</h3><p>It saves by itself every few seconds, on this device. Close the game whenever you like.</p>' +
        '<p class="sub">' + (nosave ? 'Saving is switched off for this visit.' : 'Last saved ' + ago + '.') + '</p>' +
        '<div class="acts"><button data-act="savenow">Save now</button><button data-act="export">Save to a file</button><button data-act="import">Load from a file</button></div>';
      h += confirmNew
        ? '<p style="margin-top:14px">This clears your koi, coins and garden for good.</p><div class="acts"><button data-act="newyes">Clear it and start again</button><button class="gold" data-act="newno">Keep my pond</button></div>'
        : '<div class="acts" style="margin-top:14px"><button data-act="newpond">Start a new pond</button></div>';
      h += '<h3>How to play</h3>' +
        '<p><b>Feed</b> (bottom left): tap the water to drop food, or hold still and a koi that trusts you will eat from your hand. Drag to look around; the view stays where you leave it.</p>' +
        '<p><b>Play</b>: tap for a pebble, drag for ripples, and drag across the Zen Garden to rake the sand.</p>' +
        '<p><b>Watch</b> (bottom of the screen) is for sitting back: a caretaker feeds the koi and brings in the takings, more slowly than you, and keeps a quarter. Leave the screen alone and everything but the garden fades.</p>' +
        '<p>The Koi book and the Map stand by the Home Pond. Selling, buying koi, requests, koi shows and the garden shop are all at the Market, one swipe down.</p>' +
        '<p>There are six ponds, and none joins another. Each grows in four sections, and the next pond only opens once every section of the one before it is built. Each takes only koi of its own colours, so breed for them and carry them over: tap a koi, then Move.</p>' +
        '<p>Tap open ground beside what you own to build on it. Tap a building to take the coins guests have left, or to upgrade it. </p>' +
        '<p>Guests pay at the ticket gate in the Market and throw food to the koi. The gate only holds so much: go and collect it, and upgrade it to hold more.</p>' +
        '<p>Tap a koi to see it, pair it or sell it. Tap a plant that glints to pick what it has grown, then sell it at the Market.</p>' +
        '<p>The arrows at the edge of the screen, two fingers, the arrow keys and the right stick also move the view. </p>' +
        '<p class="sub">' + L.label + (pr > 1.05 ? '. While you are here the pond runs ' + (Math.round(pr * 10) / 10) + ' times faster.' : '. The pond is resting.') + '</p>';
      return h;
    }
  };
  function drawTanks() {
    if (sheet !== 'dealer') return;
    var cs = bodyEl.querySelectorAll('canvas[data-tank]');
    for (var i = 0; i < cs.length; i++) view.drawTank(cs[i], game.offers[+cs[i].getAttribute('data-tank')], game.time, i);
  }

  /* ---------- the card ---------- */
  function select(k) {
    if (k && k !== selected) A.ui('select');
    selected = k;
    if (k) { selItem = null; selLot = null; selGate = false; }
    drawCard();
  }
  function itemRef() {
    if (!selItem || !game.itemType(selItem)) { selItem = null; return null; }
    return selItem;
  }
  var XBTN = '<button class="x" data-act="closecard" aria-label="Close">&times;</button>';
  function drawCard() {
    if (selected && game.koi.indexOf(selected) < 0) selected = null;
    if (pick && game.koi.indexOf(pick) < 0) pick = null;
    if (sheet) { cardEl.hidden = true; return; }
    if (!selected && selGate) {
      var gt = Math.floor(game.gate.till), gup = game.gateUpgradeCost(), nextCap = gup ? S.GATE.caps[game.gate.level] : 0;
      put(cardEl, XBTN + '<h2>Ticket gate</h2><p class="muted">Every guest pays ' + game.ticket() + ' coins to come in. More stars, dearer tickets.</p>' +
        '<p class="muted" style="margin-top:6px">Holding ' + gt + ' of ' + game.gateCap() + '. When it is full, the rest is lost.</p><div class="acts">' +
        '<button class="gold" data-act="gatecollect"' + (gt < 1 ? ' disabled' : '') + '>Collect ' + price(gt) + '</button>' +
        (gup ? '<button data-act="gateup"' + (game.coins < gup ? ' disabled' : '') + '>Hold ' + nextCap + ' ' + price(gup) + '</button>' : '<button disabled>Biggest cash box</button>') + '</div>');
      return;
    }
    if (!selected && selLot && game.lots[selLot]) {
      var lot = game.lots[selLot], kd = S.KINDS[lot.kind], cap = game.tillCap(selLot), up = game.upgradeCost(selLot), till = Math.floor(lot.till);
      var hh = XBTN + '<h2>' + (lot.kind === 'pond' ? S.THEME_NAMES[S.themeOf(selLot)] : kd.name) + '</h2><p class="muted">Level ' + lot.level + ' of 3 · renown ' + Math.round(kd.renown * S.LEVEL[lot.level - 1]) + '</p><p class="note">' + kd.note + '</p>';
      if (cap) hh += '<p class="muted" style="margin-top:6px">Till: ' + till + ' of ' + cap + '</p>';
      hh += '<div class="acts">' + (cap ? '<button class="gold" data-act="collect"' + (till < 1 ? ' disabled' : '') + '>Collect ' + price(till) + '</button>' : '') +
        (up ? '<button data-act="upgrade"' + (game.coins < up ? ' disabled' : '') + '>Upgrade ' + price(up) + '</button>' : '<button disabled>Fully upgraded</button>') + '</div>';
      put(cardEl, hh);
      return;
    }
    if (!selected) {
      var ref = itemRef();
      if (!ref) { cardEl.hidden = true; return; }
      var sp = S.PLANTS[game.itemType(ref)];
      put(cardEl, XBTN + '<h2>' + sp.name + '</h2><p class="muted">' + sp.note + '</p><div class="acts">' +
        '<button class="gold" data-act="moveitem">Move</button><button data-act="putaway">Put away ' + price(Math.floor(sp.cost / 2)) + '</button></div>');
      return;
    }
    var k = selected, pr = game.pairOf(k.id), st = game.stage(k), i;
    var cm = Math.round(k.len / game.fishBase * 62);
    var h = XBTN + '<h2>' + k.name + '</h2><p>' + kind(k) + '</p>' +
      '<p class="muted">' + st + ' · ' + cm + ' cm · ' + fedWord(k) + '</p>' +
      '<p class="muted">' + S.TEMPERS[k.temper].name + ' · ' + S.bondWord(k.bond) + (game.pondsOpen() > 1 ? ' · ' + S.biomeById(k.pond).name : '') + '</p>';
    var note = '', acts = '';
    if (pr) {
      var other = game.byId(pr.a === k.id ? pr.b : pr.a);
      note = 'Paired with ' + (other ? other.name : 'another koi') + '. ' + (pr.waiting ? 'Waiting for room in the pond.' : 'Fry in ' + wait(pr.left) + '.');
    } else if (st === 'Fry') {
      note = 'Its colours come in as it grows: about ' + wait(T.growYoung - k.growth) + ' if kept fed.';
    } else if (st === 'Young') {
      note = 'Can be paired once grown: about ' + wait(T.growAdult - k.growth) + ' if kept fed.';
    } else if (pick && pick !== k) {
      var why = game.canPair(pick, k);
      if (!why) {
        var out = S.outcomes(pick.genes, k.genes), shown = 0, fresh2 = 0;
        h += '<div class="pre"><div class="sub">With ' + pick.name + ', the fry could be</div>';
        for (i = 0; i < out.length; i++) {
          if (!game.book[out[i].key]) { fresh2 += out[i].p; continue; }
          if (shown < 4) { h += '<div class="prow">' + swatch(out[i].genes) + '<span class="grow">' + out[i].name + '</span><span class="num">' + pct(out[i].p) + '</span></div>'; shown++; }
        }
        if (fresh2 > 0) h += '<div class="prow">' + swatch(null, true) + '<span class="grow">Something new</span><span class="num">' + pct(fresh2) + '</span></div>';
        h += '</div>';
      }
      acts += '<button class="gold" data-act="pair"' + (why ? ' disabled' : '') + '>Pair with ' + pick.name + '</button>';
    } else if (pick === k) {
      var ms = mates() || [], here = roomOf(), near = ms.filter(function (m) { return game.pondNear(m.x, m.y).id === here.id; }).length;
      note = !ms.length ? 'No other koi is grown and free to pair yet.'
        : 'Tap one of the ' + (ms.length === 1 ? 'koi' : ms.length + ' koi') + ' with a gold ring to pair with ' + k.name + '.' +
          (near < ms.length ? ' ' + (ms.length - near) + ' of them ' + (ms.length - near === 1 ? 'is' : 'are') + ' in another pond.' : '');
      acts += '<button data-act="unpick">Never mind</button>';
    } else {
      acts += '<button data-act="pick">Pair</button>';
    }
    var block = game.canSell(k);
    if (game.pondsOpen() > 1 && !pr && pick !== k) acts += '<button data-act="movekoi">Move</button>';
    acts += '<button data-act="sell"' + (block ? ' disabled' : '') + '>Sell ' + price(game.value(k)) + '</button>';
    if (block && !note) note = block;
    h += '<div class="acts">' + acts + '</div>' + (note ? '<p class="note">' + note + '</p>' : '');
    put(cardEl, h);
  }

  /* ---------- carrying a garden thing to its place ---------- */
  function startPlacing(type, move) {
    placing = { type: type, a: move && move.kind === 'plant' ? (game.plants[move.i].a || 0) : Math.PI / 2,
                seed: move && move.kind === 'plant' ? game.plants[move.i].seed : (Math.random() * 1e9) | 0, move: move || null };
    if (sheet) closeSheet();
    arranging = false; selItem = null; select(null);
    drawPlace(); drawNav();
  }
  function stopPlacing() { placing = null; drawPlace(); drawNav(); }
  function drawPlace() {
    if (placing) {
      var sp = S.PLANTS[placing.type];
      put(placeEl, '<span class="grow">' + (placing.move ? 'Tap where ' + sp.name.toLowerCase() + ' should go' : 'Tap to place ' + sp.name.toLowerCase()) + '</span>' +
        '<button data-act="turn" aria-label="Turn">Turn</button><button class="gold" data-act="doneplace">Done</button>');
    } else if (arranging) {
      put(placeEl, '<span class="grow">Tap something to move it or put it away</span><button class="gold" data-act="doneplace">Done</button>');
    } else placeEl.hidden = true;
  }
  function ghost() {
    if (!placing) return null;
    var hp = handPos(), x = hp.x / zoom + game.cam.x, y = hp.y / zoom + game.cam.y;
    return { type: placing.type, x: x, y: y, a: placing.a, seed: placing.seed, ok: !game.canPlace(placing.type, x, y, !!placing.move) };
  }
  function setDown(x, y) {
    var why = game.canPlace(placing.type, x, y, !!placing.move);
    if (why) { toast(why); return; }
    if (placing.move) { game.moveItem(placing.move, x, y, placing.a); stopPlacing(); arranging = true; drawPlace(); }
    else {
      game.place(placing.type, x, y, placing.a);
      placing.seed = (Math.random() * 1e9) | 0;
      if (game.coins < S.PLANTS[placing.type].cost) stopPlacing();   // keep going while the coins last
    }
    refresh(); save();
  }

  /* ---------- every button on the page ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-sheet],[data-tab],[data-nav]') : null;
    if (!el || el.disabled) return;
    game.touch(); A.unlock(); stir();
    if (el.hasAttribute('data-sheet')) { openSheet(el.getAttribute('data-sheet')); drawCard(); return; }
    if (el.hasAttribute('data-tab')) { tabs[sheet] = el.getAttribute('data-tab'); shopSel = -1; A.ui('select'); bodyEl.scrollTop = 0; drawSheet(); return; }
    if (el.hasAttribute('data-nav')) { nav(el.getAttribute('data-nav')); return; }
    var act = el.getAttribute('data-act'), id = +el.getAttribute('data-id'), k;
    if (act === 'close') closeSheet();
    else if (act === 'hand') setHand(hand === 'food' ? 'pebble' : 'food');
    else if (act === 'watch') setWatch(!game.watch);
    else if (act === 'closecard') { selected = null; selItem = null; selLot = null; selGate = false; }
    else if (act === 'gatecollect') game.collectGate();
    else if (act === 'gateup') game.upgradeGate();
    else if (act === 'gogate') { selGate = false; goRoom(S.areaById('market'), 0, 0); }
    else if (act === 'select') {
      k = game.byId(id); closeSheet(); select(k);
      if (k) game.glide(k.x - game.W / 2, k.y - game.H / 2);
    }
    else if (act === 'buy') { if (game.buy(id)) shopSel = -1; }
    else if (act === 'tank') { shopSel = id; A.ui('select'); }
    else if (act === 'plant') startPlacing(el.getAttribute('data-type'));
    else if (act === 'arrange') { closeSheet(); arranging = true; drawPlace(); }
    else if (act === 'turn') { if (placing) placing.a += Math.PI / 4; }
    else if (act === 'doneplace') { stopPlacing(); arranging = false; selItem = null; drawPlace(); }
    else if (act === 'moveitem') { if (itemRef()) startPlacing(game.itemType(selItem), selItem); }
    else if (act === 'putaway') { if (itemRef()) { game.removeItem(selItem); selItem = null; } }
    else if (act === 'lot') {
      var lid = el.getAttribute('data-area');
      closeSheet(); game.lookAt(lid);
      if (game.lots[lid]) { selected = null; selItem = null; selGate = false; selLot = lid; }
      else { buildId = lid; openSheet('build'); }
    }
    else if (act === 'build') { if (game.build(buildId, el.getAttribute('data-kind'))) { closeSheet(); selected = null; selLot = buildId; } }
    else if (act === 'upgrade') { if (selLot) game.upgrade(selLot); }
    else if (act === 'collect') { if (selLot) game.collect(selLot); }
    else if (act === 'goal') { game.claimGoal(); }
    else if (act === 'movekoi') { if (selected) openSheet('move'); }
    else if (act === 'moveto') {
      var mk = selected;
      if (mk && game.move(mk.id, el.getAttribute('data-pond'))) { closeSheet(); game.glide(mk.x - game.W / 2, mk.y - game.H / 2); }
    }
    else if (act === 'station') {                  // from the menu: go to a station and open it
      var sid = el.getAttribute('data-id'), sn = null;
      S.STATIONS.forEach(function (q) { if (q.id === sid) sn = q; });
      closeSheet();
      if (sn) { goRoom(S.areaById(sn.lot), 0, 0); openSheet(sid); }
    }
    else if (act === 'give') { k = game.byId(+el.getAttribute('data-koi')); if (game.fulfil(id, k && k.id) && selected === k) selected = null; }
    else if (act === 'pass') game.passRequest(id);
    else if (act === 'enter') game.enterShow(el.getAttribute('data-show'), +el.getAttribute('data-koi'));
    else if (act === 'pick') { pick = selected; }
    else if (act === 'unpick') { pick = null; }
    else if (act === 'pair') { if (game.pair(pick.id, selected.id)) pick = null; }
    else if (act === 'sell') { if (game.sell(selected.id)) selected = null; }
    else if (act === 'sellkoi') { k = game.byId(id); if (game.sell(id) && selected === k) selected = null; }
    else if (act === 'sellgoods') game.sellGoods(el.getAttribute('data-good'));
    else if (act === 'closeaway') awayEl.hidden = true;
    else if (act === 'sound') A.setOn(!A.isOn());
    else if (act === 'savenow') toast(save() ? 'Saved.' : 'Could not save here.');
    else if (act === 'export') exportSave();
    else if (act === 'import') fileEl.click();
    else if (act === 'newpond') confirmNew = true;
    else if (act === 'newno') confirmNew = false;
    else if (act === 'newyes') { newPond(); return; }
    refresh();
    if (act !== 'savenow') save();
  });

  function refresh() {
    while (game.events.length) { var ev = game.events.shift(); A.event(ev.kind); toast(ev.text); }
    if (game.settledFor > 20 && !wasSettled) { wasSettled = true; toast('The pond is settled. Stay as long as you like.'); }
    if (game.settledFor === 0) wasSettled = false;
    drawHud(); drawSheet(); drawCard(); drawNav();
  }

  /* ---------- touching the pond ---------- */
  var pointers = {}, nPointers = 0, pinch = 0;
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  var mouse = { x: 0, y: 0, on: false, down: false };
  var still = { x: 0, y: 0, since: 0 }, hinted = {}, keys = {}, offered = false;
  function handPos() { return cur.on ? { x: cur.x, y: cur.y } : { x: mouse.x, y: mouse.y }; }
  // every frame: tell the pond where the hand is, pick up coins under it, and notice food held still
  function trackHand() {
    var x, y, on, down;
    if (cur.on) { x = cur.x; y = cur.y; on = true; down = !!cur.held; }
    else { x = mouse.x; y = mouse.y; on = mouse.on; down = mouse.down; }
    if (Math.abs(x - still.x) + Math.abs(y - still.y) > 10 || !down) { still.x = x; still.y = y; still.since = game.time; }
    var wx = x / zoom + game.cam.x, wy = y / zoom + game.cam.y;
    on = on && !placing && !sheet && nPointers < 2 && game.onWater(wx, wy);
    var offer = on && down && hand === 'food' && !arranging && game.time - still.since > 0.45;
    if (offer) { game.touch(); offered = true; }
    game.setHand(wx, wy, on, offer);
    if (on) game.sweep(wx, wy);
    // arrow keys and WASD slide the view
    var kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
    var ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
    if ((kx || ky) && !sheet) game.panBy(kx * 16, ky * 16);

  }
  canvas.addEventListener('pointerleave', function () { mouse.on = false; });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = pos(e);
    mouse.x = p.x; mouse.y = p.y; mouse.on = true;
    A.unlock(); padCursor(false); stir();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    pointers[e.pointerId] = p; nPointers++;
    drift.on = false; drift.x = drift.y = 0;         // a new touch stops any glide
    if (nPointers >= 2) {                            // a second finger: both now move and zoom the view, nothing else
      pinch = 0;
      for (var id in pointers) { pointers[id].pan = true; pointers[id].rake = false; clearTimeout(pointers[id].wait); pointers[id].wait = 0; }
      mouse.down = false;
      return;
    }
    if (e.button === 2 || e.button === 1) {          // right or middle button: cancel, or drag the view
      if (placing) { stopPlacing(); return; }
      p.pan = true; return;
    }
    mouse.down = true;
    p.fed = 0; p.sx = p.x; p.sy = p.y; offered = false;
    if (hand === 'food' || placing || arranging) {
      // feeding: a tap acts when the finger lifts, and a drag moves the view instead
      p.defer = true;
    } else if (e.pointerType === 'touch') {
      // a finger waits a moment before it acts, in case a second finger is on its way to move the view
      p.wait = setTimeout(function () { p.wait = 0; if (pointers[e.pointerId] === p && !p.pan) press(p); }, 90);
    } else press(p);
  });
  /* The hand comes down at a point on the screen. What happens depends on what is there. */
  function press(p) {
    var x = p.x / zoom + game.cam.x, y = p.y / zoom + game.cam.y;
    game.touch();
    if (placing) { setDown(x, y); p.idle = true; return; }
    var inside = x >= 0 && y >= 0 && x <= S.COLS * S.AW && y <= S.ROWS * S.AH, area = game.areaUnder(x, y);
    if (!inside) { p.idle = true; return; }
    if (!game.lots[area.id]) {                       // open ground: offer to build on it
      p.idle = true;
      if (!S.inBlob(S.SHAPES[area.id], x, y)) return;
      if (game.reachable(area.id)) { buildId = area.id; if (sheet !== 'build') openSheet('build'); }
      else toast('Build beside what you already have first.');
      return;
    }
    if (arranging) {
      p.idle = true;
      selected = null; selItem = game.itemAt(x, y);
      if (selItem) A.ui('select');
      drawCard();
      return;
    }
    if (game.harvestAt(x, y)) { p.idle = true; refresh(); save(); return; }   // something ripe
    if (game.petCat(x, y)) { p.idle = true; return; }
    var stn = game.stationAt(x, y);
    if (stn && stn.id === 'gate') {                  // the ticket gate: fetch the takings, or look at it
      p.idle = true;
      if (!game.collectGate()) { selected = null; selItem = null; selLot = null; selGate = true; A.ui('select'); }
      refresh(); save();
      return;
    }
    if (stn) { p.idle = true; if (sheet !== stn.id) openSheet(stn.id); drawCard(); return; }
    var lot = game.lotAt(x, y), lk = lot ? game.kindOf(lot.id) : null;
    if (lot && lk !== 'pond' && !(lk === 'zen' && hand === 'pebble')) {     // a building: empty its till, or look at it
      p.idle = true;
      var got = game.collect(lot.id);
      if (!got) { selected = null; selItem = null; selGate = false; selLot = lot.id; A.ui('select'); }
      refresh(); save();
      return;
    }
    if (game.onWater(x, y)) {
      if (game.sweep(x, y)) { p.idle = true; return; }            // a coin
      var f = game.fishAt(x, y);
      if (f) { p.idle = true; select(f); return; }                // a koi
    }
    if (selected && !pick) select(null);
    if (selLot || selGate) { selLot = null; selGate = false; drawCard(); }
    if (game.onSand(x, y)) { if (hand === 'pebble') p.rake = true; return; }
    if (!game.onWater(x, y)) return;                             // grass: nothing to do
    if (hand === 'pebble') game.poke(x, y, 1);
    else game.feed(x, y);
  }
  // q is where the hand was on the screen (and keeps a running distance in q.fed), p is where it is now
  function drag(q, p) {
    var d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
    if (d < 1) return;
    var cx = game.cam.x, cy = game.cam.y, z = zoom;
    var ax = q.x / z + cx, ay = q.y / z + cy, bx = p.x / z + cx, by = p.y / z + cy;
    if (q.wait) return;
    if (q.defer && !q.pan) {
      if (Math.abs(p.x - q.sx) + Math.abs(p.y - q.sy) < 9 || offered) return;
      q.pan = true;
    }
    if (q.pan) dragView((q.x - p.x) / z / Math.max(1, nPointers), (q.y - p.y) / z / Math.max(1, nPointers));
    else if (q.idle) { /* that press already did its job */ }
    else if (q.rake || (hand === 'pebble' && game.onSand(bx, by))) {
      if (d < 3) return;
      if (!game.onSand(bx, by)) { q.x = p.x; q.y = p.y; return; }
      view.rake(ax, ay, bx, by);
      game.touch();
      A.cue({ k: 'rake', x: p.x / SW, s: Math.min(1, d / 30) });
    }
    else if (hand === 'pebble') { if (game.onWater(bx, by)) game.wake(ax, ay, bx, by); }
    else {
      // dragging food scatters a trail, one pinch every so often
      q.fed += d;
      if (q.fed > 70) { q.fed = 0; if (game.onWater(bx, by)) game.feed(bx, by); }
    }
    q.x = p.x; q.y = p.y;
  }
  canvas.addEventListener('pointermove', function (e) {
    game.touch(); stir();
    var mp = pos(e); mouse.x = mp.x; mouse.y = mp.y; mouse.on = true;
    var q = pointers[e.pointerId];
    if (!q) return;
    e.preventDefault();
    if (nPointers === 2) {
      // two fingers: the distance between them is the zoom
      var ids = Object.keys(pointers), o = pointers[ids[0]] === q ? pointers[ids[1]] : pointers[ids[0]];
      var dist = Math.hypot(mp.x - o.x, mp.y - o.y);
      pinch = dist;
    }
    drag(q, mp);
  });
  window.addEventListener('mousemove', function () { padCursor(false); stir(); });
  function up(e) {
    var q = pointers[e.pointerId];
    if (q && q.pan && nPointers <= 1) { dragRoom = null; letGo(); drawNav(); }   // the view eases to a stop and stays there
    if (q && q.wait) { clearTimeout(q.wait); q.wait = 0; if (!q.pan) press(q); }   // a quick tap
    if (q && q.defer && !q.pan && !offered) press(q);
    if (pointers[e.pointerId]) { delete pointers[e.pointerId]; nPointers = Math.max(0, nPointers - 1); }
    mouse.down = false;
    if (e.pointerType === 'touch') mouse.on = false;
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  var wheelAt = 0;
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    game.touch();
    var mp = pos(e);
    if (placing && !e.ctrlKey) placing.a += (e.deltaY > 0 ? 1 : -1) * Math.PI / 12;
    else game.panBy((e.shiftKey ? e.deltaY : e.deltaX) / zoom, (e.shiftKey ? 0 : e.deltaY) / zoom);   // scroll or two-finger slide: move the view freely
  }, { passive: false });

  window.addEventListener('keyup', function (e) { keys[e.key] = false; });
  window.addEventListener('keydown', function (e) {
    game.touch(); A.unlock(); stir();
    keys[e.key] = true;
    if (e.key === '1') setHand('food');
    else if (e.key === '2') setHand('pebble');
    else if (e.key === ' ') { setHand(hand === 'food' ? 'pebble' : 'food'); e.preventDefault(); }
    else if (e.key === 'q' && placing) placing.a -= Math.PI / 12;
    else if (e.key === 'e' && placing) placing.a += Math.PI / 12;
    else if (e.key === 'm') { openSheet('map'); drawCard(); }
    else if (e.key === 'Tab') { openSheet('menu'); drawCard(); e.preventDefault(); }
    else if (e.key === 'Escape') back();
  });
  function back() {
    if (!awayEl.hidden) { awayEl.hidden = true; return; }
    if (placing || arranging) { stopPlacing(); arranging = false; selItem = null; drawPlace(); drawCard(); return; }
    if (sheet) { closeSheet(); drawCard(); return; }
    selected = null; selItem = null; selLot = null; selGate = false; pick = null; drawCard();
  }

  /* ---------- gamepad: a cursor on the left stick, so one thumb is enough ----------
     A tap · B back · X food or pebble · Y next menu · bumpers switch tab or turn a thing ·
     right stick looks around (or scrolls a sheet) */
  var cur = { x: 0, y: 0, on: false, held: null }, was = {}, cursorEl = $('cursor'), hintEl = $('padhint');
  function padCursor(show) {
    if (cur.on === show) return;
    cur.on = show;
    cursorEl.hidden = !show; hintEl.hidden = !show;
    if (show && !cur.x) { cur.x = SW / 2; cur.y = SH / 2; }
  }
  function stick(v) { var a = Math.abs(v); return a < 0.18 ? 0 : (v < 0 ? -1 : 1) * Math.pow((a - 0.18) / 0.82, 1.6); }
  function pollPad(dt, pads) {
    var gp = null, i;
    pads = pads || (navigator.getGamepads ? navigator.getGamepads() : []);
    for (i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    if (!gp) return;
    function down(b) { return !!(gp.buttons[b] && gp.buttons[b].pressed); }
    function hit(b) { var d = down(b), h = d && !was[b]; was[b] = d; return h; }
    var mx = stick(gp.axes[0] || 0) + (down(15) ? 0.45 : 0) - (down(14) ? 0.45 : 0);
    var my = stick(gp.axes[1] || 0) + (down(13) ? 0.45 : 0) - (down(12) ? 0.45 : 0);
    var sx = stick(gp.axes[2] || 0), sy = stick(gp.axes[3] || 0);
    var any = mx || my || sx || sy;
    for (i = 0; i < 8; i++) if (down(i)) any = true;
    if (!any) { was = {}; cur.held = null; return; }
    game.touch(); A.unlock(); padCursor(true); stir();
    cur.x = Math.max(4, Math.min(SW - 4, cur.x + mx * 640 * dt));
    cur.y = Math.max(4, Math.min(SH - 4, cur.y + my * 640 * dt));
    cursorEl.style.transform = 'translate(' + (cur.x - 13) + 'px,' + (cur.y - 13) + 'px)';
    if (sheet) bodyEl.scrollTop += sy * 600 * dt;
    else {
      if (sx || sy) game.panBy(sx * 900 * dt, sy * 900 * dt);   // the right stick slides the view
    }

    if (hit(0)) {
      var el = document.elementFromPoint(cur.x, cur.y);
      var target = el && el.closest ? el.closest('[data-act],[data-sheet],[data-tab],[data-nav]') : null;
      if (target) target.click();
      else if (el === canvas) { cur.held = { x: cur.x, y: cur.y, fed: 0 }; press(cur.held); }
    } else if (cur.held && down(0)) {
      drag(cur.held, { x: cur.x, y: cur.y });
    }
    if (!down(0)) cur.held = null;
    if (hit(1)) { back(); refresh(); }
    if (hit(2)) setHand(hand === 'food' ? 'pebble' : 'food');
    if (hit(3)) {
      var n = ORDER.indexOf(sheet) + 1;
      if (n < ORDER.length) { if (sheet) sheet = null; openSheet(ORDER[n]); } else closeSheet();
      drawCard();
    }
    var rb = hit(5), lb = hit(4);
    if (placing) { if (rb) placing.a += Math.PI / 12; if (lb) placing.a -= Math.PI / 12; }
    else if ((rb || lb) && sheet && GROUPS[sheet].tabs) {
      var ts = GROUPS[sheet].tabs, ti = 0;
      for (i = 0; i < ts.length; i++) if (ts[i][0] === tabs[sheet]) ti = i;
      tabs[sheet] = ts[(ti + (rb ? 1 : ts.length - 1)) % ts.length][0];
      shopSel = -1; drawSheet();
    }
  }
  window.__pollPad = pollPad;   // lets a test feed in a pretend controller

  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { pointers = {}; nPointers = 0; size(); game.resize(SW / zoom, SH / zoom); view.setup(game, SW, SH, zoom); drawNav(); }, 80);
  });

  /* ---------- frame ---------- */
  var raf = 0, last = 0, acc = 0, uiClock = 0, saveClock = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.1, (t - last) / 1000); last = t;
    acc += dt;
    var n = 0;
    pollPad(dt);
    trackHand();
    stepDrift(dt);
    while (acc >= S.DT && n < 4) { game.step(); acc -= S.DT; n++; }
    if (acc > S.DT) acc = 0;
    while (game.cues.length) A.cue(game.cues.shift());
    A.setNight(R.lightAt(game.sitting / 60).night);
    A.setRain(game.rain.amt);
    var ir = itemRef(), it = ir ? (ir.kind === 'pad' ? game.pads[ir.i] : game.plants[ir.i]) : null;
    stepCalm(dt);
    view.draw({ selected: selected, pick: pick, ghost: ghost(), item: it, marks: marks, mates: mates(), calm: calm });
    drawTanks();
    uiClock += dt; saveClock += dt;
    if (game.events.length || uiClock > 1) { uiClock = 0; refresh(); }
    if (saveClock > 10) { saveClock = 0; save(); }
  }
  var hiddenAt = 0;
  function start() { if (!raf && !document.hidden) { last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stop(); save(); hiddenAt = Date.now(); }
    else {
      // the app was in the background: the pond kept its own time
      if (hiddenAt) { var gone = (Date.now() - hiddenAt) / 1000; hiddenAt = 0; if (gone > 5) { game.catchUp(gone); game.sinceInput += gone; } }
      start();
    }
  });
  window.addEventListener('pagehide', save);

  boot();
  refresh();
  view.draw({ selected: selected, pick: pick, marks: marks });
  start();
})();
