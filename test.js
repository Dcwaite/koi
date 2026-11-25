// node pond/test.js  -- exits 1 on any failure
'use strict';
var S = require('./pond.js');
var failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failed++;
}
function finite(g) {
  for (var i = 0; i < g.cur.length; i++) if (!isFinite(g.cur[i]) || !isFinite(g.prev[i])) return false;
  return true;
}
function maxAbs(g) { var m = 0; for (var i = 0; i < g.cur.length; i++) { var v = Math.abs(g.cur[i]); if (v > m) m = v; } return m; }

// ---- 1. single poke stays finite and decays
(function () {
  var g = new S.WaveGrid(200, 150), i;
  g.drop(80, 60, 1);
  for (i = 0; i < 60; i++) g.step();
  var e1 = g.energy(), m1 = maxAbs(g);
  for (i = 0; i < 600; i++) g.step();
  var e2 = g.energy();
  for (i = 0; i < 3000; i++) g.step();
  var e3 = g.energy();
  check('single poke: finite', finite(g));
  check('single poke: energy decays', e2 < e1 * 0.1 && e3 < e2 * 0.01,
    'E@60=' + e1.toExponential(2) + ' E@660=' + e2.toExponential(2) + ' E@3660=' + e3.toExponential(2) + ' peak|h|@60=' + m1.toFixed(3));
})();

// ---- 2. cannot blow up under sustained poking
(function () {
  var g = new S.WaveGrid(320, 230), rng = S.mulberry32(42), i, worst = 0;
  for (i = 0; i < 6000; i++) {
    if (i % 5 === 0) g.drop(rng() * 319, rng() * 229, 1);
    if (i % 3 === 0) g.bump(rng() * 319, rng() * 229, 1.7, -0.3);
    if (i % 400 === 0) g.drop(0, 0, 1);            // corners and edges too
    if (i % 400 === 200) g.drop(319, 115, 1);
    g.step();
    if (i % 100 === 0) { var m = maxAbs(g); if (m > worst) worst = m; }
  }
  var eBusy = g.energy();
  check('hammering 6000 steps: finite', finite(g));
  check('hammering 6000 steps: bounded', worst < 40, 'peak |h| = ' + worst.toFixed(2));
  for (i = 0; i < 3000; i++) g.step();
  var eAfter = g.energy();
  check('then left alone 3000 steps: dies away', finite(g) && eAfter < eBusy * 1e-6,
    'E busy=' + eBusy.toExponential(2) + ' E after=' + eAfter.toExponential(2));
})();

// ---- 3. symmetry under 90 degree rotation
(function () {
  var N = 129, g = new S.WaveGrid(N, N), c = (N - 1) / 2, i, x, y, worst = 0, peak = 0;
  g.drop(c, c, 1);
  for (i = 0; i < 150; i++) g.step();           // long enough to have reflected off the edges
  for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
    var a = g.cur[(y + 1) * g.sw + x + 1];
    var b = g.cur[(x + 1) * g.sw + (N - 1 - y) + 1];   // rotated 90 degrees
    var d = Math.abs(a - b); if (d > worst) worst = d;
    if (Math.abs(a) > peak) peak = Math.abs(a);
  }
  check('centre poke is 4-fold symmetric', worst <= 1e-6 && peak > 1e-3, 'max diff ' + worst.toExponential(2) + ', peak ' + peak.toFixed(4));
})();

// ---- 4. fish and pads: 10 minutes with random pokes, several window shapes
function fishRun(W, H, seed) {
  var p = new S.Pond(W, H, seed), rng = S.mulberry32(seed * 977 + 5);
  var steps = 36000, out = 0, padOut = 0, minPair = 1e9, minPadGap = 1e9, i, k, j;
  var corner = new Array(p.fish.length).fill(0), startled = 0, curious = 0, returned = 0;
  var cz = Math.min(W, H) * 0.12;
  var lx = 0, ly = 0;
  for (i = 0; i < steps; i++) {
    var before = p.fish.map(function (q) { return q.mode; });
    var r = rng();
    if (r < 1 / 90) {                                   // a poke every 1.5 s on average
      var f = p.fish[(rng() * p.fish.length) | 0];
      if (rng() < 0.5) { lx = f.x + (rng() - 0.5) * 60; ly = f.y + (rng() - 0.5) * 60; }   // aimed at a fish
      else if (rng() < 0.3) { lx = rng() < 0.5 ? 0 : W; ly = rng() < 0.5 ? 0 : H; }       // corners
      else { lx = rng() * W; ly = rng() * H; }
      p.poke(lx, ly, 1);
    } else if (r < 1 / 90 + 1 / 40) {                   // and some dragging
      var nx = Math.min(W, Math.max(0, lx + (rng() - 0.5) * 50)), ny = Math.min(H, Math.max(0, ly + (rng() - 0.5) * 50));
      p.wake(lx, ly, nx, ny); lx = nx; ly = ny;
    }
    if (i === 20000) p.resize(W, H);                    // a resize mid-run must not break anything
    p.step();
    for (k = 0; k < p.fish.length; k++) {
      var a = p.fish[k];
      if (!(a.x >= 0 && a.x <= W && a.y >= 0 && a.y <= H) || !isFinite(a.a) || !isFinite(a.v)) out++;
      if ((a.x < cz || a.x > W - cz) && (a.y < cz || a.y > H - cz)) corner[k]++;
      if (before[k] !== S.FLEE && a.mode === S.FLEE) startled++;
      if (before[k] === S.WARY && a.mode === S.CURIOUS) curious++;
      if (before[k] === S.CURIOUS && a.mode === S.WANDER && Math.hypot(a.tx - a.x, a.ty - a.y) < a.len) returned++;
      for (j = k + 1; j < p.fish.length; j++) {
        var d = Math.hypot(a.x - p.fish[j].x, a.y - p.fish[j].y);
        if (d < minPair) minPair = d;
      }
    }
    for (k = 0; k < p.pads.length; k++) {
      var q = p.pads[k];
      if (!(q.x - q.r >= 0 && q.x + q.r <= W && q.y - q.r >= 0 && q.y + q.r <= H)) padOut++;
      for (j = k + 1; j < p.pads.length; j++) {
        var g = Math.hypot(q.x - p.pads[j].x, q.y - p.pads[j].y) - q.r - p.pads[j].r;
        if (g < minPadGap) minPadGap = g;
      }
    }
  }
  var worstCorner = Math.max.apply(null, corner) / steps;
  var tag = W + 'x' + H + ' seed ' + seed + ': ';
  check(tag + 'fish always inside the pond', out === 0, out + ' violations');
  check(tag + 'no two fish at the same point', minPair > 2, 'closest pair ever ' + minPair.toFixed(1) + 'px');
  check(tag + 'no fish lives in a corner', worstCorner < 0.15, 'worst fish spent ' + (worstCorner * 100).toFixed(1) + '% of the time in a corner zone');
  check(tag + 'fish startle, then come back', startled > 20 && curious > 5 && returned > 3,
    startled + ' startles, ' + curious + ' turned curious, ' + returned + ' reached the splash');
  check(tag + 'pads always inside, never overlapping', padOut === 0 && minPadGap > -0.5 && (W < 500 || minPadGap >= 0),
    padOut + ' violations, smallest gap ' + minPadGap.toFixed(1) + 'px');
  check(tag + 'water still finite', finite(p.grid));
}
fishRun(1000, 720, 1);
fishRun(375, 812, 2);
fishRun(1920, 1080, 3);
fishRun(320, 480, 4);

// ---- 5. pads: bob with waves and get nudged, but only slowly
(function () {
  var p = new S.Pond(1000, 720, 9), pad = p.pads[0], x0 = pad.x, y0 = pad.y, i, maxTilt = 0, maxV = 0;
  for (i = 0; i < 600; i++) {
    if (i % 60 === 0) p.poke(pad.x - pad.r * 2.2, pad.y, 1);
    p.step();
    maxTilt = Math.max(maxTilt, Math.hypot(pad.tx, pad.ty));
    maxV = Math.max(maxV, Math.hypot(pad.vx, pad.vy));
  }
  var moved = Math.hypot(pad.x - x0, pad.y - y0);
  check('pad tilts as waves pass', maxTilt > 0.02, 'max tilt reading ' + maxTilt.toFixed(3));
  check('pad is nudged, slowly', moved > 2 && maxV <= 26.01, 'moved ' + moved.toFixed(1) + 'px in 10 s, top speed ' + maxV.toFixed(1) + 'px/s');
})();

// ---- 6. left alone: quiet, but not dead
(function () {
  var p = new S.Pond(1000, 720, 5), i, quietSteps = 0;
  for (i = 0; i < 60 * 300; i++) { p.step(); if (maxAbs0(p.grid) < 1e-3) quietSteps++; }
  function maxAbs0(g) { return i % 30 ? 1 : maxAbs(g); }
  check('idle 5 minutes: a few rings, not many', p.idleEvents >= 8 && p.idleEvents <= 40, p.idleEvents + ' idle rings in 5 min');
  var a = new S.Pond(800, 600, 77), b = new S.Pond(800, 600, 77);
  for (i = 0; i < 3000; i++) { a.step(); b.step(); }
  check('seeded: same seed, same pond', a.fish[2].x === b.fish[2].x && a.idleEvents === b.idleEvents && a.grid.energy() === b.grid.energy());
})();

// ---- 7. feeding: koi come for the food and eat it, without being startled, and stop when full
function feedRun(W, H, seed) {
  var p = new S.Pond(W, H, seed), i, k, startled = 0, out = 0, padHidden = 0, firstBite = -1, fed = 0;
  var tag = W + 'x' + H + ' seed ' + seed + ': ';
  for (i = 0; i < 120; i++) p.step();
  var spots = [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7], [0.04, 0.96], [0.96, 0.04]];
  for (i = 0; i < spots.length; i++) { p.feed(W * spots[i][0], H * spots[i][1]); fed += 5; }
  for (i = 0; i < 60 * 40; i++) {
    var before = p.fish.map(function (q) { return q.mode; });
    p.step();
    if (firstBite < 0 && p.eaten > 0) firstBite = i * S.DT;
    for (k = 0; k < p.fish.length; k++) if (before[k] !== S.FLEE && p.fish[k].mode === S.FLEE) startled++;
    for (k = 0; k < p.food.length; k++) {
      var f = p.food[k];
      if (!(f.x >= 0 && f.x <= W && f.y >= 0 && f.y <= H) || !isFinite(f.x)) out++;
      for (var j = 0; j < p.pads.length; j++) if (Math.hypot(f.x - p.pads[j].x, f.y - p.pads[j].y) < p.pads[j].r) padHidden++;
    }
  }
  check(tag + 'koi find the food quickly', firstBite >= 0 && firstBite < 6, 'first bite after ' + firstBite.toFixed(1) + ' s');
  check(tag + 'they eat most of it, even near the edges', p.eaten >= fed * 0.7, p.eaten + ' of ' + fed + ' pellets eaten in 40 s');
  check(tag + 'food does not startle them', startled === 0, startled + ' startles');
  check(tag + 'pellets stay in the water, off the pads', out === 0 && padHidden === 0, out + ' outside, ' + padHidden + ' under a pad');
  check(tag + 'water still finite', finite(p.grid));
}
feedRun(1000, 720, 1);
feedRun(375, 812, 2);
feedRun(1920, 1080, 3);

(function () {
  var p = new S.Pond(1000, 720, 6), i;
  p.breedTimer = Infinity;   // no babies here: this is about the koi already in the pond
  for (i = 0; i < 12; i++) p.feed(200 + i * 50, 360);           // far more than five koi can eat
  for (i = 0; i < 60 * 60; i++) p.step();
  var full = p.fish.every(function (f) { return f.full > 0.85; });
  check('koi stop eating when full', full && p.eaten < 60, p.eaten + ' of 60 eaten; fullness ' + p.fish.map(function (f) { return f.full.toFixed(2); }).join(' '));
  for (i = 0; i < 60 * 90; i++) p.step();
  check('uneaten food sinks away', p.food.length === 0, p.food.length + ' pellets left after 2.5 min');
  var hungryLater = p.fish.every(function (f) { return f.full < 0.75; });
  for (i = 0; i < 60 * 60; i++) p.step();
  var later = p.fish.every(function (f) { return f.full < 0.4; });
  check('and get hungry again', hungryLater || later, 'fullness ' + p.fish.map(function (f) { return f.full.toFixed(2); }).join(' '));
})();

// ---- growth: eating makes a koi bigger, a little at a time, up to a limit, and it still fits in the pond
(function () {
  var p = new S.Pond(1000, 720, 8), i, k, out = 0, maxJump = 0;
  p.breedTimer = Infinity;   // no babies here: this is about the koi already in the pond
  var len0 = p.fish.map(function (f) { return f.len; });
  var eaten0 = p.fish.map(function () { return 0; });
  for (var round = 0; round < 24; round++) {
    p.fish.forEach(function (f) { f.full = 0; });        // skip the digesting, so the test is quick
    for (k = 0; k < 9; k++) p.feed(150 + (k % 5) * 170, 200 + (k % 3) * 160 + (round % 2) * 60);
    for (i = 0; i < 60 * 30; i++) {
      var before = p.fish.map(function (f) { return f.len; });
      p.step();
      for (k = 0; k < p.fish.length; k++) {
        var f = p.fish[k];
        maxJump = Math.max(maxJump, (f.len - before[k]) / before[k]);
        if (!(f.x >= 0 && f.x <= 1000 && f.y >= 0 && f.y <= 720)) out++;
      }
    }
    if (round === 0) for (k = 0; k < p.fish.length; k++) eaten0[k] = p.fish[k].len / len0[k];
  }
  var grewAfterOne = eaten0.every(function (r) { return r > 1.02; });
  var capped = p.fish.every(function (f) { return f.k <= S.K_MAX + 1e-9; });
  var nearCap = p.fish.every(function (f) { return f.k > S.K_MAX * 0.9; });
  check('koi grow after a feeding', grewAfterOne, 'size after first feeding x' + eaten0.map(function (r) { return r.toFixed(2); }).join(' x'));
  check('growth is smooth, never a jump', maxJump < 0.01, 'largest growth in one step ' + (maxJump * 100).toFixed(2) + '%');
  check('koi stop growing at the limit', capped && nearCap, 'sizes after 24 feedings ' + p.fish.map(function (f) { return f.k.toFixed(2); }).join(' ') + ' (limit ' + S.K_MAX + ')');
  check('big koi still stay in the pond', out === 0, out + ' violations');
  check('sparks are cleaned up', p.sparks.length < 20, p.sparks.length + ' left');
})();

// ---- 8. the shop: buying, selling, limits, and the save
(function () {
  var p = new S.Pond(1000, 720, 12), r, i;
  check('start with ' + S.START_COINS + ' coins, 5 koi, 4 plants', p.coins === S.START_COINS && p.fish.length === 5 && p.pads.length === 4);
  r = p.buyFish('ogon');
  check('cannot buy what you cannot afford', !!r.error && p.coins === S.START_COINS && p.fish.length === 5, r.error);
  r = p.buyFish('chagoi');
  check('buying a koi takes its price and adds a young koi', !r.error && p.coins === S.START_COINS - 20 && p.fish.length === 6 && r.fish.k === S.YOUNG_K);
  var young = S.fishValue(r.fish);
  check('a koi sells for less than it cost while it is young', young < 20, 'young Chagoi fetches ' + young);
  r.fish.kt = r.fish.k = S.K_MAX;
  check('a fully grown koi fetches several times its price', S.fishValue(r.fish) > 20 * 3, 'grown Chagoi fetches ' + S.fishValue(r.fish));
  var before = p.coins, worth = S.fishValue(r.fish);
  var sold = p.sellFish(r.fish);
  check('selling pays its value and takes it away', sold.paid === worth && p.coins === before + worth && p.fish.indexOf(r.fish) < 0);
  p.coins = 10000;
  for (i = 0; i < 20; i++) p.buyFish('kohaku');
  check('the pond holds at most ' + S.MAX_FISH + ' koi', p.fish.length === S.MAX_FISH && p.canBuyFish('kohaku') === 'Pond is full');
  for (i = 0; i < 20; i++) p.buyPlant('pink');
  check('and at most ' + S.MAX_PADS + ' plants', p.pads.length === S.MAX_PADS && p.canBuyPlant('pad') === 'No room left');
  var pad = p.pads[0], pv = S.padValue(pad), c0 = p.coins;
  check('a plant sells back for half', p.sellPad(pad).paid === pv && p.coins === c0 + pv && pv === Math.round(S.PLANTS[pad.kind].price / 2));
  while (p.fish.length > 1) p.sellFish(p.fish[0]);
  check('the last koi cannot be sold', !!p.sellFish(p.fish[0]).error && p.fish.length === 1);
  for (i = 0; i < 600; i++) p.step();
  check('pads never overlap after a buying spree', p.pads.every(function (a, k) {
    return p.pads.every(function (b, j) { return j <= k || Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.5; });
  }));

  var q = new S.Pond(1000, 720, 13);
  q.coins = 77; q.buyFish('tancho'); q.fish[0].kt = 1.5; q.buyPlant('yellow');
  var saved = JSON.parse(JSON.stringify(q.toState()));
  var back = new S.Pond(390, 844, 99);
  var ok = back.fromState(saved);
  check('a save loads back the same koi, sizes, plants and coins', ok && back.coins === q.coins && back.fish.length === q.fish.length &&
    back.fish.every(function (f, k) { return f.variety === q.fish[k].variety && Math.abs(f.kt - q.fish[k].kt) < 1e-3; }) &&
    back.pads.length === q.pads.length && back.pads.some(function (d) { return d.kind === 'yellow'; }));
  check('a broken save is ignored', !new S.Pond(800, 600, 1).fromState({ v: 1, fish: [{ v: 'nope', k: 1 }], pads: [] }) &&
    !new S.Pond(800, 600, 1).fromState('junk'));
})();

// ---- 9. crops: they ripen, are picked with a tap, and the harvest sells
(function () {
  var p = new S.Pond(1000, 720, 21), i;
  p.coins = 1000;
  var cress = p.buyPlant('cress').pad, lotus = p.buyPlant('lotus').pad;
  check('a new crop starts unripe, and a tap on it does not pick it', S.ripeness(cress) === 0 && p.harvestAt(cress.x, cress.y) === null);
  for (i = 0; i < 60 * 89; i++) p.step();
  check('watercress is not ripe a second early', S.ripeness(cress) < 1 && !p.ripeCropAt(cress.x, cress.y));
  for (i = 0; i < 60 * 2; i++) p.step();
  check('watercress ripens in 90 s', S.ripeness(cress) === 1);
  var miss = p.harvestAt(cress.x + Math.max(cress.r * 1.3, 30), cress.y + Math.max(cress.r * 1.3, 30));
  check('a tap beside a ripe crop misses it', miss === null && S.ripeness(cress) === 1);
  var h = p.harvestAt(cress.x + cress.r * 0.5, cress.y);
  check('a tap on a ripe crop picks it into the basket and it starts again',
    h && h.kind === 'cress' && h.n === 2 && p.basket.cress === 2 && S.ripeness(cress) === 0 && p.pops.length === 1);
  for (i = 0; i < 60 * 200; i++) p.step();
  check('a ripe crop waits, it does not pile up', S.ripeness(cress) === 1 && p.basket.cress === 2);
  var before = p.coins, sold = p.sellProduce('cress');
  check('the harvest sells for its value', sold.paid === 2 * S.PRODUCE.cress.value && p.coins === before + sold.paid && p.basket.cress === 0);
  check('nothing to sell is refused', !!p.sellProduce('cress').error);
  check('lotus is still growing after 5 min', S.ripeness(lotus) > 0.5 && S.ripeness(lotus) < 1, 'ripeness ' + S.ripeness(lotus).toFixed(2));

  // closing the page: crops keep growing from the saved time
  p.harvestAt(cress.x, cress.y);
  p.basket.lotus = 3;
  var t0 = 1700000000000, saved = JSON.parse(JSON.stringify(p.toState(t0)));
  var q = new S.Pond(800, 600, 5);
  q.fromState(saved, t0 + 60 * 1000);
  var qc = q.pads.filter(function (d) { return d.kind === 'cress'; })[0], ql = q.pads.filter(function (d) { return d.kind === 'lotus'; })[0];
  check('crops keep growing while the page is closed', S.ripeness(qc) > 0.6 && S.ripeness(qc) < 0.7 && q.basket.lotus === 3,
    'cress ripeness after 60 s away ' + S.ripeness(qc).toFixed(2));
  var r = new S.Pond(800, 600, 5);
  r.fromState(saved, t0 + 3 * 3600 * 1000);
  check('and wait, ripe, after a long time away', r.pads.filter(function (d) { return S.isCrop(d.kind); }).every(function (d) { return S.ripeness(d) === 1; }));
  check('pops fade away', (function () { for (var k = 0; k < 200; k++) p.step(); return p.pops.length === 0; })());
})();

// ---- 9b. breeding and the koi book
(function () {
  var p = new S.Pond(1000, 720, 31), i;
  check('a new pond has no news, and its starting koi are in the book', p.news.length === 0 &&
    p.fish.every(function (f) { return p.book[f.variety] && p.book[f.variety].kept; }));
  // hungry koi have no young
  p.fish.forEach(function (f) { f.k = f.kt = 1.2; f.full = 0; });
  check('hungry koi have no young', p.breed() === null && p.fish.length === 5);
  // small koi have no young
  p.fish.forEach(function (f) { f.k = f.kt = 0.7; f.full = 1; });
  check('young koi have no young', p.breed() === null);
  // grown, fed koi do, and the baby is small, near its parents, and in the book
  p.fish.forEach(function (f) { f.k = f.kt = 1.2; f.full = 1; });
  var n0 = p.fish.length, baby = p.breed();
  check('grown, fed koi have a baby', baby && p.fish.length === n0 + 1 && baby.k === S.FRY_K && p.book[baby.variety].born === 1 &&
    p.news.some(function (n) { return n.kind === 'born' && n.id === baby.variety; }) && p.feats.fry,
    baby ? baby.variety : 'none');
  check('the baby is inside the pond', baby.x > 0 && baby.x < 1000 && baby.y > 0 && baby.y < 720);
  // it happens by itself over time, and never past a full pond
  var q = new S.Pond(1000, 720, 32);
  q.fish.forEach(function (f) { f.k = f.kt = 1.2; });
  var born = 0;
  for (i = 0; i < 60 * 60 * 15; i++) {
    if (i % 600 === 0) q.fish.forEach(function (f) { f.full = 1; });   // well looked after
    q.step();
  }
  check('koi have young by themselves, up to a full pond', q.bornCount > 0 && q.fish.length <= S.MAX_FISH, q.bornCount + ' born, ' + q.fish.length + ' koi');
  // plants tip the odds: a pond of lotus brings Platinum Ogon, which neither parent is
  var r = new S.Pond(1000, 720, 33);
  var plain = r.babyOdds('kohaku', 'kohaku');
  r.coins = 5000; for (i = 0; i < 6; i++) r.buyPlant('lotus');
  var lotus = r.babyOdds('kohaku', 'kohaku');
  function pOf(list, v) { var e = list.filter(function (x) { return x.variety === v; })[0]; return e ? e.p : 0; }
  check('plants decide the babies: lotus brings Platinum Ogon', pOf(plain, 'ogon') === 0 && pOf(lotus, 'ogon') > 0.15,
    'ogon ' + pOf(plain, 'ogon').toFixed(2) + ' -> ' + pOf(lotus, 'ogon').toFixed(2));
  var counts = {}, rr = new S.Pond(1000, 720, 34);
  rr.coins = 5000; for (i = 0; i < 6; i++) rr.buyPlant('lotus');
  for (i = 0; i < 300; i++) {
    rr.fish = rr.fish.slice(0, 2);
    rr.fish.forEach(function (f) { f.variety = 'kohaku'; f.k = f.kt = 1.2; f.full = 1; });
    var b = rr.breed(); counts[b.variety] = (counts[b.variety] || 0) + 1;
  }
  check('and it shows in the babies born', counts.ogon > 50 && counts.kohaku > 50, JSON.stringify(counts));
  // growing marks the book
  var g = new S.Pond(1000, 720, 35); g.breedTimer = Infinity;
  var f = g.fish[0]; f.kt = S.GROWN_K + 0.01; g._grew(f);
  check('a koi grown to full size is marked in the book', g.book[f.variety].grown && g.news.some(function (n) { return n.kind === 'grown'; }));
  // the book survives a save
  var st = JSON.parse(JSON.stringify(p.toState(1))), back = new S.Pond(800, 600, 36);
  back.fromState(st, 1);
  check('the koi book and milestones are saved', back.book[baby.variety].born === 1 && back.feats.fry && back.bornCount === 1 && back.news.length === 0);
  var old = JSON.parse(JSON.stringify(p.toState(1))); delete old.book; delete old.feats;
  var back2 = new S.Pond(800, 600, 37); back2.fromState(old, 1);
  check('an older save starts its book from the koi in the pond', back2.fish.every(function (f) { return back2.book[f.variety].kept; }));
})();

// ---- 10. timing
(function () {
  [[1000, 720], [375, 812], [1920, 1080]].forEach(function (s) {
    var p = new S.Pond(s[0], s[1], 3), g = p.grid, out = new Uint8ClampedArray(g.w * g.h * 4), i, n = 600;
    for (i = 0; i < 200; i++) { if (i % 20 === 0) p.poke(Math.random() * s[0], Math.random() * s[1], 1); p.step(); S.shade(g, out); }
    var t0 = process.hrtime.bigint();
    for (i = 0; i < n; i++) { if (i % 20 === 0) p.poke((i * 37) % s[0], (i * 53) % s[1], 1); g.step(); }
    var t1 = process.hrtime.bigint();
    for (i = 0; i < n; i++) { if (i % 20 === 0) p.poke((i * 37) % s[0], (i * 53) % s[1], 1); p.step(); }
    var t2 = process.hrtime.bigint();
    for (i = 0; i < n; i++) S.shade(g, out);
    var t3 = process.hrtime.bigint();
    var wave = Number(t1 - t0) / 1e6 / n, full = Number(t2 - t1) / 1e6 / n, sh = Number(t3 - t2) / 1e6 / n;
    check('timing ' + s[0] + 'x' + s[1] + ' -> grid ' + g.w + 'x' + g.h + ' (' + g.w * g.h + ' cells)', full + sh < 4,
      'wave step ' + wave.toFixed(3) + ' ms, full step (wave+fish+pads) ' + full.toFixed(3) + ' ms, shading ' + sh.toFixed(3) + ' ms; frame budget 16.7 ms');
  });
})();

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
