/* Koi: what is above the water. Branches of three trees reach in over the edges and sway in the wind;
   the seasons turn every few minutes (blossom, green, red and gold, bare and snowy), and the weather changes:
   breeze, wind, rain that rings the water, snow, mist. Petals and leaves fall, land and float.
   This is all for looking at: the koi and the crops do not care what season it is. */
(function () {
  'use strict';
  var S = window.PondSim;
  var SEASON_LEN = 360;                       // seconds of real time per season
  var SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  var PREF = 'koi-sky-v1';
  var pref = { season: 'turn', weather: 'turn' };
  try { var sv = JSON.parse(localStorage.getItem(PREF) || 'null'); if (sv) { pref.season = sv.season || 'turn'; pref.weather = sv.weather || 'turn'; } } catch (e) {}
  function savePref() { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) {} }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  /* Each tree's leaves through the year: three leaf colours, how full the tree is, and blossom. */
  var LOOKS = {
    cherry: [
      { c: [[150, 190, 110], [124, 170, 92], [168, 200, 120]], d: 0.45, bloom: [242, 188, 204], bd: 1 },
      { c: [[70, 120, 62], [88, 138, 70], [58, 104, 56]], d: 1, bloom: null, bd: 0 },
      { c: [[214, 146, 56], [196, 104, 48], [226, 176, 74]], d: 0.7, bloom: null, bd: 0 },
      { c: [[120, 100, 80], [110, 90, 70], [130, 110, 90]], d: 0, bloom: null, bd: 0 }
    ],
    maple: [
      { c: [[146, 188, 96], [168, 202, 112], [128, 176, 90]], d: 0.8, bloom: null, bd: 0 },
      { c: [[62, 112, 56], [80, 130, 62], [52, 98, 52]], d: 1, bloom: null, bd: 0 },
      { c: [[204, 62, 40], [224, 98, 42], [172, 42, 36]], d: 0.85, bloom: null, bd: 0 },
      { c: [[120, 100, 80], [110, 90, 70], [130, 110, 90]], d: 0, bloom: null, bd: 0 }
    ],
    pine: [
      { c: [[52, 92, 62], [66, 106, 66], [44, 80, 58]], d: 1, bloom: null, bd: 0 },
      { c: [[42, 80, 56], [56, 94, 60], [36, 70, 52]], d: 1, bloom: null, bd: 0 },
      { c: [[46, 82, 58], [60, 96, 62], [40, 74, 54]], d: 1, bloom: null, bd: 0 },
      { c: [[40, 70, 56], [52, 84, 60], [34, 62, 50]], d: 0.9, bloom: null, bd: 0 }
    ]
  };
  function lookAt(kind, ph) {
    var L = LOOKS[kind], s = Math.floor(ph) % 4, f = ph - Math.floor(ph), n = (s + 1) % 4, t = smooth((f - 0.82) / 0.18);
    var a = L[s], b = L[n];
    return {
      c: [mix(a.c[0], b.c[0], t), mix(a.c[1], b.c[1], t), mix(a.c[2], b.c[2], t)],
      d: lerp(a.d, b.d, t),
      bloom: a.bloom || b.bloom, bd: lerp(a.bd, b.bd, t),
      snow: lerp(s === 3 ? 1 : 0, n === 3 ? 1 : 0, t)
    };
  }

  /* Weather. Every few minutes the sky picks again, from what suits the season. */
  var WEATHER = {
    clear:  { name: 'Clear', wind: 0.15, rain: 0, snow: 0, dim: 0, fog: 0 },
    breeze: { name: 'A breeze', wind: 0.5, rain: 0, snow: 0, dim: 0, fog: 0 },
    windy:  { name: 'Windy', wind: 1, rain: 0, snow: 0, dim: 0.05, fog: 0 },
    shower: { name: 'Light rain', wind: 0.25, rain: 0.5, snow: 0, dim: 0.18, fog: 0 },
    rain:   { name: 'Rain', wind: 0.4, rain: 1, snow: 0, dim: 0.32, fog: 0 },
    snow:   { name: 'Snow', wind: 0.2, rain: 0, snow: 1, dim: 0.12, fog: 0.15 },
    mist:   { name: 'Mist', wind: 0.05, rain: 0, snow: 0, dim: 0.05, fog: 1 }
  };
  var CHANCES = [
    [['clear', 4], ['breeze', 3], ['shower', 2], ['rain', 1.5], ['mist', 1]],
    [['clear', 6], ['breeze', 2], ['shower', 1.5], ['rain', 1]],
    [['clear', 3], ['breeze', 2], ['windy', 3], ['rain', 2], ['mist', 1.5]],
    [['clear', 3], ['snow', 4], ['windy', 1], ['mist', 1.5]]
  ];
  var BLOCK = 150;                             // seconds the weather holds
  function hash(n) { var r = S.mulberry32((n * 2654435761) >>> 0); r(); return r(); }
  function weatherFor(block, season) {
    var list = CHANCES[season], sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i][1];
    var r = hash(block) * sum;
    for (i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return list[i][0]; }
    return 'clear';
  }

  var state = { ph: 0, season: 0, weather: 'clear', wind: 0.15, rain: 0, snow: 0, dim: 0, fog: 0, gust: 0 };
  function phase(now) {
    if (pref.season !== 'turn') return (+pref.season) + 0.5;
    return (now / 1000 / SEASON_LEN) % 4;
  }

  /* ---------- the trees ---------- */
  var trees = [], W = 0, H = 0, dpr = 1, look = null, lastPaint = -1;
  // a tree: some limbs that reach in from one place outside the edge; each limb is painted to its own canvas, and sways on its own
  function makeTree(kind, ax, ay, ang, L, seed) {
    var rng = S.mulberry32(seed), limbs = [];
    var pine = kind === 'pine', n = pine ? 3 : 3;
    for (var li = 0; li < n; li++) {
      var segs = [], clusters = [];
      var a0 = ang + (li - (n - 1) / 2) * (pine ? 0.55 : 0.5) + (rng() - 0.5) * 0.2;
      (function grow(parent, a, len, w, depth) {
        var i = segs.length;
        segs.push({ p: parent, a: a, len: len, w: w, d: depth });
        var maxD = pine ? 3 : 4;
        // leaves along the outer twigs
        if (depth >= (pine ? 1 : 2)) {
          var nc = pine ? 3 : depth >= maxD ? 3 : 1;
          for (var c = 0; c < nc; c++) clusters.push({ s: i, f: 0.35 + rng() * 0.65, o: (rng() - 0.5) * len * 0.5, r: L * (pine ? 0.2 : 0.16) * (0.75 + rng() * 0.5), seed: (rng() * 1e9) | 0 });
        }
        if (depth >= maxD || len < 6) return;
        var kids = depth === 0 ? 2 : rng() < 0.6 ? 2 : 3;
        for (var k = 0; k < kids; k++) {
          var spread = pine ? (k - (kids - 1) / 2) * 1.0 : (k - (kids - 1) / 2) * 0.62;
          grow(i, a + spread + (rng() - 0.5) * 0.35, len * (0.66 + rng() * 0.16), w * 0.64, depth + 1);
        }
      })(-1, a0, L * (0.95 + rng() * 0.35) * (li === 1 ? 1.15 : 1), L * 0.17, 0);
      limbs.push({ segs: segs, clusters: clusters, ph: rng() * 6.28, sp: 0.7 + rng() * 0.5, can: null, sh: null, bx: 0, by: 0 });
    }
    return { kind: kind, ax: ax, ay: ay, limbs: limbs };
  }
  // where every segment ends, with no wind, relative to the tree's anchor
  function layout(limb) {
    var pts = [];
    for (var i = 0; i < limb.segs.length; i++) {
      var s = limb.segs[i], p = s.p < 0 ? { x: 0, y: 0, a: 0 } : pts[s.p];
      var a = s.a, x0 = p.x, y0 = p.y;
      pts.push({ x0: x0, y0: y0, x: x0 + Math.cos(a) * s.len, y: y0 + Math.sin(a) * s.len, a: a });
    }
    return pts;
  }

  function paintLimb(tree, limb) {
    var pts = layout(limb), minX = 0, minY = 0, maxX = 0, maxY = 0, i;
    var pad = 0;
    limb.clusters.forEach(function (c) { if (c.r > pad) pad = c.r; });
    pad += 6;
    for (i = 0; i < pts.length; i++) {
      minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
      minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
    }
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var cw = Math.ceil((maxX - minX) * dpr), ch = Math.ceil((maxY - minY) * dpr);
    if (!limb.can) { limb.can = document.createElement('canvas'); limb.sh = document.createElement('canvas'); }
    var c = limb.can; c.width = cw; c.height = ch;
    var x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr);
    limb.bx = minX; limb.by = minY;
    var lk = lookAt(tree.kind, state.ph);
    // the wood
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (i = 0; i < pts.length; i++) {
      var s = limb.segs[i], p = pts[i];
      x.strokeStyle = tree.kind === 'pine' ? '#3a2a20' : tree.kind === 'cherry' ? '#4a3028' : '#3f3024';
      x.lineWidth = Math.max(1.2, s.w);
      x.beginPath(); x.moveTo(p.x0, p.y0); x.lineTo(p.x, p.y); x.stroke();
    }
    // light along the top of the wood
    x.globalAlpha = 0.35;
    for (i = 0; i < pts.length; i++) {
      var s2 = limb.segs[i], q = pts[i];
      if (s2.w < 2.5) continue;
      x.strokeStyle = '#8a6a4f'; x.lineWidth = s2.w * 0.3;
      x.beginPath(); x.moveTo(q.x0 - s2.w * 0.2, q.y0 - s2.w * 0.25); x.lineTo(q.x - s2.w * 0.2, q.y - s2.w * 0.25); x.stroke();
    }
    x.globalAlpha = 1;
    // snow lying along the branches
    if (lk.snow > 0.02) {
      x.globalAlpha = lk.snow * 0.8; x.strokeStyle = '#eef2f4';
      for (i = 0; i < pts.length; i++) {
        var s3 = limb.segs[i], r3 = pts[i];
        if (s3.w < 2.2) continue;                      // it does not settle on the thin twigs
        x.lineWidth = s3.w * 0.42;
        x.beginPath(); x.moveTo(r3.x0 - s3.w * 0.25, r3.y0 - s3.w * 0.3); x.lineTo(r3.x - s3.w * 0.25, r3.y - s3.w * 0.3); x.stroke();
      }
      x.globalAlpha = 1;
    }
    // the leaves (or needles), and blossom
    limb.clusters.forEach(function (cl) {
      var p = pts[cl.s], ang = p.a, along = cl.f;
      var cx = p.x0 + (p.x - p.x0) * along - Math.sin(ang) * cl.o, cy = p.y0 + (p.y - p.y0) * along + Math.cos(ang) * cl.o;
      cl.x = cx; cl.y = cy;
      var r = S.mulberry32(cl.seed), k;
      if (tree.kind === 'pine') {
        if (r() > lk.d) return;
        x.lineWidth = 1.4; x.lineCap = 'round';
        for (k = 0; k < 26; k++) {
          var na = r() * 6.283, nl = cl.r * (0.45 + r() * 0.55);
          x.strokeStyle = rgb(lk.c[(r() * 3) | 0]);
          x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(na) * nl, cy + Math.sin(na) * nl); x.stroke();
        }
        if (lk.snow > 0.02) {
          x.fillStyle = rgb([238, 242, 244], lk.snow * 0.85);
          x.beginPath(); x.ellipse(cx - cl.r * 0.15, cy - cl.r * 0.15, cl.r * 0.5, cl.r * 0.38, r() * 3, 0, 6.283); x.fill();
        }
        return;
      }
      for (k = 0; k < 7; k++) {
        var keep = r(), la = r() * 6.283, ld = cl.r * Math.sqrt(r()) * 0.75, lr = cl.r * (0.32 + r() * 0.16), ci = (r() * 3) | 0, rot = r() * 3.14;
        if (keep > lk.d) continue;
        var lx = cx + Math.cos(la) * ld, ly = cy + Math.sin(la) * ld;
        x.fillStyle = rgb(lk.c[ci]);
        x.beginPath(); x.ellipse(lx, ly, lr, lr * 0.5, rot, 0, 6.283); x.fill();
        x.fillStyle = 'rgba(255,255,230,0.12)';
        x.beginPath(); x.ellipse(lx - lr * 0.15, ly - lr * 0.12, lr * 0.55, lr * 0.22, rot, 0, 6.283); x.fill();
      }
      if (lk.bloom && lk.bd > 0.02) {
        for (k = 0; k < 4; k++) {
          var bk = r(), ba = r() * 6.283, bdd = cl.r * Math.sqrt(r()) * 0.8, br = cl.r * (0.16 + r() * 0.08);
          if (bk > lk.bd) continue;
          var bx = cx + Math.cos(ba) * bdd, by = cy + Math.sin(ba) * bdd;
          for (var pp = 0; pp < 5; pp++) {
            var pa = pp * 1.2566 + ba;
            x.fillStyle = rgb(lk.bloom);
            x.beginPath(); x.arc(bx + Math.cos(pa) * br * 0.7, by + Math.sin(pa) * br * 0.7, br * 0.62, 0, 6.283); x.fill();
          }
          x.fillStyle = '#c9506e'; x.beginPath(); x.arc(bx, by, br * 0.3, 0, 6.283); x.fill();
        }
      }
    });
    // its shadow: the same shape, dark
    var sh = limb.sh; sh.width = cw; sh.height = ch;
    var y = sh.getContext('2d');
    y.drawImage(c, 0, 0);
    y.globalCompositeOperation = 'source-in';
    y.fillStyle = '#02070a'; y.fillRect(0, 0, cw, ch);
  }
  function paint() {
    look = state.ph;
    trees.forEach(function (t) { t.limbs.forEach(function (l) { paintLimb(t, l); }); });
  }

  function setup(w, h, ratio) {
    W = w; H = h; dpr = Math.min(ratio || 1, 1.5);
    var m = Math.min(W, H), L = m * 0.085;
    trees = [
      makeTree('cherry', W + L * 0.4, -L * 0.4, Math.PI * 0.75, L * 1.05, 101),
      makeTree('maple', -L * 0.5, H * 0.52, -0.12, L, 202),
      makeTree('pine', W * 0.3, H + L * 0.5, -Math.PI / 2 + 0.15, L * 0.9, 303)
    ];
    falling.length = 0; floating.length = 0; drops.length = 0;
    paint();
  }

  /* ---------- falling petals and leaves, snow, rain ---------- */
  var falling = [], floating = [], drops = [], flakes = [];
  function leafColour(kind) {
    var lk = lookAt(kind, state.ph);
    if (lk.bloom && lk.bd > 0.3 && Math.random() < 0.85) return { col: lk.bloom, petal: true };
    return { col: lk.c[(Math.random() * 3) | 0], petal: false };
  }
  function shed(dt) {
    var s = Math.floor(state.ph) % 4;
    var rate = [0.5, 0.06, 0.6, 0][s] * (0.4 + state.wind * 2.2);
    if (Math.random() > rate * dt) return;
    var t = trees[(Math.random() * 2) | 0];          // cherry and maple drop things; the pine keeps its needles
    var lk = lookAt(t.kind, state.ph);
    if (lk.d < 0.1 && !(lk.bloom && lk.bd > 0.2)) return;
    var l = t.limbs[(Math.random() * t.limbs.length) | 0], c = l.clusters[(Math.random() * l.clusters.length) | 0];
    if (!c || c.x === undefined) return;
    var p = limbToWorld(t, l, c.x, c.y), lc = leafColour(t.kind);
    falling.push({ x: p.x, y: p.y, z: 1, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, rot: Math.random() * 6.28,
                   spin: (Math.random() - 0.5) * 4, col: lc.col, petal: lc.petal, size: (lc.petal ? 3.2 : 4.5) * (0.8 + Math.random() * 0.4) });
  }
  function sway(t, l, now) {
    var w = state.wind, g = state.gust;
    return (Math.sin(now * l.sp * (0.6 + w) + l.ph) * (0.012 + w * 0.035) + Math.sin(now * 2.7 * l.sp + l.ph * 2) * w * 0.012 + g * 0.05 * w) ;
  }
  var swayNow = 0;
  function limbToWorld(t, l, x, y) {
    var a = sway(t, l, swayNow), c = Math.cos(a), s = Math.sin(a);
    return { x: t.ax + x * c - y * s, y: t.ay + x * s + y * c };
  }

  var pond = null, clock = 0, repaintAt = 0;
  function update(dt, p, now) {
    pond = p; clock += dt; swayNow = clock;
    // season
    var ph = phase(now), s = Math.floor(ph) % 4;
    state.ph = ph; state.season = s;
    // weather: ease toward what the sky has picked
    var block = Math.floor(now / 1000 / BLOCK);
    var name = pref.weather === 'clear' ? 'clear' : pref.weather !== 'turn' ? pref.weather : weatherFor(block, Math.floor(phase(block * BLOCK * 1000)) % 4);
    if (name === 'snow' && s !== 3 && pref.weather === 'turn') name = 'mist';
    state.weather = name;
    var tw = WEATHER[name], e = Math.min(1, dt / 7);
    ['wind', 'rain', 'snow', 'dim', 'fog'].forEach(function (k) { state[k] += (tw[k] - state[k]) * e; });
    state.gust += ((Math.sin(clock * 0.37) > 0.6 ? 1 : 0) - state.gust) * Math.min(1, dt * 0.8);
    // repaint the trees now and then as their colours change (often while a season turns, rarely otherwise)
    var f = ph - Math.floor(ph);
    if (clock >= repaintAt || (look !== null && Math.floor(look) !== Math.floor(ph) && pref.season === 'turn')) {
      paint(); repaintAt = clock + (f > 0.8 ? 1.5 : 20);
    }
    // falling leaves and petals
    shed(dt);
    var wx = Math.cos(0.4) * state.wind * 40, wy = Math.sin(0.4) * state.wind * 40, i;
    for (i = falling.length - 1; i >= 0; i--) {
      var q = falling[i];
      q.z -= dt * (q.petal ? 0.16 : 0.22);
      q.x += (q.vx + wx + Math.sin(clock * 2 + q.rot) * 12) * dt; q.y += (q.vy + wy) * dt; q.rot += q.spin * dt;
      if (q.z <= 0) {
        falling.splice(i, 1);
        if (q.x > 0 && q.x < W && q.y > 0 && q.y < H) {
          if (p) p.poke(q.x, q.y, 0.12, true);
          q.age = 0; q.life = 20 + Math.random() * 20;
          floating.push(q);
          if (floating.length > 40) floating.shift();
        }
      }
    }
    for (i = floating.length - 1; i >= 0; i--) {
      var o = floating[i];
      o.age += dt;
      if (o.age > o.life) { floating.splice(i, 1); continue; }
      if (p) {
        // the ripples carry them, like the food
        var h1 = p.height(o.x + 2, o.y) - p.height(o.x - 2, o.y), h2 = p.height(o.x, o.y + 2) - p.height(o.x, o.y - 2);
        o.vx = (o.vx - h1 * 400 * dt) * Math.exp(-dt * 1.2) + wx * 0.02 * dt; o.vy = (o.vy - h2 * 400 * dt) * Math.exp(-dt * 1.2) + wy * 0.02 * dt;
      }
      o.x += o.vx * dt; o.y += o.vy * dt; o.rot += o.vx * 0.002;
    }
    // rain: drops ring the water
    var nRain = state.rain * 38 * dt;
    while (nRain > 0) {
      if (Math.random() < nRain) {
        var rx = Math.random() * W, ry = Math.random() * H;
        if (p) p.poke(rx, ry, 0.05 + Math.random() * 0.08, true);
        drops.push({ x: rx, y: ry, age: 0 });
      }
      nRain -= 1;
    }
    for (i = drops.length - 1; i >= 0; i--) { drops[i].age += dt; if (drops[i].age > 0.35) drops.splice(i, 1); }
    // snow
    var nSnow = state.snow * 40 * dt;
    while (nSnow > 0) {
      if (Math.random() < nSnow) flakes.push({ x: Math.random() * (W + 200) - 100, y: Math.random() * (H + 200) - 100, z: 1, r: 1.2 + Math.random() * 2, ph: Math.random() * 6.28 });
      nSnow -= 1;
    }
    for (i = flakes.length - 1; i >= 0; i--) {
      var fl = flakes[i];
      fl.z -= dt * 0.18;
      fl.x += (wx * 0.6 + Math.sin(clock * 1.3 + fl.ph) * 8) * dt; fl.y += (wy * 0.6 + 6) * dt;
      if (fl.z <= 0) { flakes.splice(i, 1); if (p && Math.random() < 0.15) p.poke(fl.x, fl.y, 0.03, true); }
    }
    if (flakes.length > 500) flakes.splice(0, flakes.length - 500);
    if (window.KoiAudio && KoiAudio.setWeather) KoiAudio.setWeather({ rain: state.rain, wind: state.wind });
  }

  /* ---------- drawing ---------- */
  function drawLeaf(ctx, q, x, y, s, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(q.rot);
    ctx.fillStyle = rgb(q.col, a);
    ctx.beginPath();
    if (q.petal) ctx.ellipse(0, 0, s, s * 0.7, 0, 0, 6.283);
    else ctx.ellipse(0, 0, s, s * 0.45, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }
  // on the water: leaves and petals that have landed
  function drawFloating(ctx) {
    for (var i = 0; i < floating.length; i++) {
      var o = floating[i], a = Math.min(1, (o.life - o.age) / 4) * Math.min(1, o.age * 3);
      ctx.globalAlpha = 0.3 * a; ctx.fillStyle = '#02070a';
      ctx.beginPath(); ctx.ellipse(o.x + 1.5, o.y + 2, o.size, o.size * 0.6, o.rot, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
      drawLeaf(ctx, o, o.x, o.y, o.size, 0.92 * a);
    }
    ctx.globalAlpha = 1;
  }
  // above everything: shadows of the branches, the branches, things falling, rain, mist, the light of the season
  var TINT = [[255, 236, 236, 0.03], [255, 226, 160, 0.045], [255, 160, 70, 0.06], [200, 220, 255, 0.09]];
  function drawAbove(ctx) {
    var i, now = swayNow, sunOff = Math.min(W, H) * 0.045 * (1 - state.dim * 1.5);
    // shadows first, softened by cloud
    ctx.globalAlpha = 0.26 * (1 - state.dim * 1.6) + 0.04;
    trees.forEach(function (t) {
      t.limbs.forEach(function (l) {
        if (!l.sh) return;
        ctx.save(); ctx.translate(t.ax + sunOff, t.ay + sunOff * 1.4); ctx.rotate(sway(t, l, now));
        ctx.drawImage(l.sh, l.bx, l.by, l.sh.width / dpr, l.sh.height / dpr); ctx.restore();
      });
    });
    for (i = 0; i < falling.length; i++) {
      var q = falling[i];
      ctx.fillStyle = '#02070a'; ctx.globalAlpha = 0.25 * (1 - q.z * 0.6);
      ctx.beginPath(); ctx.ellipse(q.x + q.z * sunOff * 2 + 1, q.y + q.z * sunOff * 2.8 + 1, q.size, q.size * 0.6, q.rot, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the branches
    trees.forEach(function (t) {
      t.limbs.forEach(function (l) {
        if (!l.can) return;
        ctx.save(); ctx.translate(t.ax, t.ay); ctx.rotate(sway(t, l, now));
        ctx.drawImage(l.can, l.bx, l.by, l.can.width / dpr, l.can.height / dpr); ctx.restore();
      });
    });
    // falling things, bigger the higher they are
    for (i = 0; i < falling.length; i++) { var f = falling[i]; drawLeaf(ctx, f, f.x, f.y, f.size * (1 + f.z * 0.6), 1); }
    // rain: short slanting streaks and the first splash of each drop
    if (state.rain > 0.02) {
      ctx.strokeStyle = 'rgba(210,225,235,' + (0.35 * state.rain) + ')'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      var n = (state.rain * 70) | 0, sx = 6 + state.wind * 14, sy = 14;
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        var rx = (Math.sin(i * 12.9898 + Math.floor(now * 14) * 78.233) * 43758.5453) % 1, ry = (Math.sin(i * 39.346 + Math.floor(now * 14) * 11.135) * 24634.6345) % 1;
        rx = Math.abs(rx) * W; ry = Math.abs(ry) * H;
        ctx.moveTo(rx, ry); ctx.lineTo(rx + sx, ry + sy);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(220,235,240,0.45)';
      for (i = 0; i < drops.length; i++) {
        var d = drops[i], k = d.age / 0.35;
        ctx.globalAlpha = (1 - k) * state.rain;
        ctx.beginPath(); ctx.arc(d.x, d.y, 1 + k * 5, 0, 6.283); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // snow
    if (flakes.length) {
      ctx.fillStyle = '#f4f7fa';
      for (i = 0; i < flakes.length; i++) {
        var fl = flakes[i];
        ctx.globalAlpha = Math.min(1, fl.z * 4) * 0.9;
        ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r * (0.7 + fl.z * 0.7), 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // the light of the season, then cloud and mist
    var s = state.season, fr = state.ph - Math.floor(state.ph), tt = smooth((fr - 0.82) / 0.18);
    var a = TINT[s], b = TINT[(s + 1) % 4];
    ctx.fillStyle = rgb(mix(a, b, tt), lerp(a[3], b[3], tt)); ctx.fillRect(0, 0, W, H);
    if (state.dim > 0.01) { ctx.fillStyle = 'rgba(8,12,20,' + state.dim * 0.55 + ')'; ctx.fillRect(0, 0, W, H); }
    if (state.fog > 0.01) {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.15, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(200,210,215,' + 0.08 * state.fog + ')'); g.addColorStop(1, 'rgba(200,210,215,' + 0.32 * state.fog + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  function label() { return SEASONS[state.season] + ' · ' + WEATHER[state.weather].name.toLowerCase(); }

  window.KoiSky = {
    setup: setup, update: update, drawFloating: drawFloating, drawAbove: drawAbove, label: label,
    seasons: SEASONS, weathers: Object.keys(WEATHER).map(function (k) { return { id: k, name: WEATHER[k].name }; }),
    prefs: function () { return { season: pref.season, weather: pref.weather }; },
    setSeason: function (v) { pref.season = v; savePref(); repaintAt = 0; },
    setWeather: function (v) { pref.weather = v; savePref(); },
    state: function () { return { season: SEASONS[state.season], ph: +state.ph.toFixed(3), weather: state.weather, wind: +state.wind.toFixed(2), rain: +state.rain.toFixed(2), snow: +state.snow.toFixed(2), falling: falling.length, floating: floating.length, flakes: flakes.length }; }
  };
})();
