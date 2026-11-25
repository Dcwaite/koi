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

// ---- 8. timing
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
