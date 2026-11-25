/* Koi: what is above the water. One big limb of a cherry on the bank reaches out over the pond and sways in the wind;
   the seasons turn every few minutes (blossom, green, red and gold, bare and snowy), and the weather changes:
   breeze, wind, rain that rings the water, snow, mist. Petals and leaves fall, land and float. Cloud shadows drift over,
   the sun glints on the ripples, gusts ruffle the water, dragonflies and butterflies visit, and ice creeps in from the
   edges in winter. This is all for looking at: the koi and the crops do not care what season it is. */
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
  function shade(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }

  /* The cherry through the year: three leaf colours, how full it is, and blossom. */
  var LOOK = [
    { c: [[150, 192, 104], [126, 174, 90], [172, 204, 118]], d: 0.4, bloom: [246, 196, 210], bd: 1 },
    { c: [[66, 118, 60], [86, 140, 70], [54, 102, 54]], d: 1, bloom: null, bd: 0 },
    { c: [[212, 96, 44], [230, 148, 56], [182, 60, 40]], d: 0.75, bloom: null, bd: 0 },
    { c: [[120, 100, 80], [110, 90, 70], [130, 110, 90]], d: 0, bloom: null, bd: 0 }
  ];
  function lookAt(ph) {
    var s = Math.floor(ph) % 4, f = ph - Math.floor(ph), n = (s + 1) % 4, t = smooth((f - 0.82) / 0.18);
    var a = LOOK[s], b = LOOK[n];
    return {
      c: [mix(a.c[0], b.c[0], t), mix(a.c[1], b.c[1], t), mix(a.c[2], b.c[2], t)],
      d: lerp(a.d, b.d, t),
      bloom: a.bloom || b.bloom, bd: lerp(a.bd, b.bd, t),
      snow: lerp(s === 3 ? 1 : 0, n === 3 ? 1 : 0, t)
    };
  }

  /* Weather. Every few minutes the sky picks again, from what suits the season. clouds: how many cloud shadows pass over. */
  var WEATHER = {
    clear:  { name: 'Clear', wind: 0.15, rain: 0, snow: 0, dim: 0, fog: 0, clouds: 1 },
    breeze: { name: 'A breeze', wind: 0.5, rain: 0, snow: 0, dim: 0, fog: 0, clouds: 3 },
    windy:  { name: 'Windy', wind: 1, rain: 0, snow: 0, dim: 0.05, fog: 0, clouds: 4 },
    shower: { name: 'Light rain', wind: 0.25, rain: 0.5, snow: 0, dim: 0.18, fog: 0, clouds: 1 },
    rain:   { name: 'Rain', wind: 0.4, rain: 1, snow: 0, dim: 0.32, fog: 0, clouds: 0 },
    snow:   { name: 'Snow', wind: 0.2, rain: 0, snow: 1, dim: 0.12, fog: 0.15, clouds: 0 },
    mist:   { name: 'Mist', wind: 0.05, rain: 0, snow: 0, dim: 0.05, fog: 1, clouds: 0 }
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

  var state = { ph: 0, season: 0, weather: 'clear', wind: 0.15, rain: 0, snow: 0, dim: 0, fog: 0, gust: 0, clouds: 1, frost: 0 };
  function phase(now) {
    if (pref.season !== 'turn') return (+pref.season) + 0.5;
    return (now / 1000 / SEASON_LEN) % 4;
  }
  var WIND_A = 0.4, WX = Math.cos(WIND_A), WY = Math.sin(WIND_A);    // the wind blows from the top left

  /* ---------- the branch ----------
     The limb is one piece, swaying a little about where it leaves the bank. Each side branch is its own piece,
     fixed to the limb at one end and swaying more, so the leaves move the way a real branch does. */
  var limb = null, pieces = [], W = 0, H = 0, T = 1, dpr = 1, look = null;

  function twig(rng, piece, x, y, a, len, w, depth, maxD, leafR) {
    // each twig is two pieces with a kink between, so nothing grows quite straight
    var w1 = w * 0.7, a1 = a + (rng() - 0.5) * 0.5, a2 = a - (a1 - a) * 0.8 + (rng() - 0.5) * 0.2;
    var mx = x + Math.cos(a1) * len * 0.5, my = y + Math.sin(a1) * len * 0.5;
    var x2 = mx + Math.cos(a2) * len * 0.5, y2 = my + Math.sin(a2) * len * 0.5, wm = (w + w1) / 2;
    piece.segs.push({ x0: x, y0: y, x: mx, y: my, a: a1, w0: w, w1: wm });
    piece.segs.push({ x0: mx, y0: my, x: x2, y: y2, a: a2, w0: wm, w1: w1 });
    a = a2;
    if (depth >= 1) {
      var nc = depth >= maxD ? 2 : 1;
      for (var c = 0; c < nc; c++) {
        var f = depth >= maxD ? 0.75 + rng() * 0.35 : 0.45 + rng() * 0.4, side = (rng() - 0.5) * len * 0.5;
        piece.clusters.push({ x: lerp(x, x2, f) - Math.sin(a) * side, y: lerp(y, y2, f) + Math.cos(a) * side,
                              r: leafR * (0.75 + rng() * 0.5), seed: (rng() * 1e9) | 0 });
      }
    }
    if (depth >= maxD || len < 5) return;
    var kids = rng() < 0.55 ? 2 : 3;
    for (var k = 0; k < kids; k++)
      twig(rng, piece, x2, y2, a + (k - (kids - 1) / 2) * 0.72 + (rng() - 0.5) * 0.4, len * (0.62 + rng() * 0.14), w1, depth + 1, maxD, leafR);
  }
  function newPiece(rng, bx, by, amp) {
    return { bx: bx, by: by, segs: [], clusters: [], amp: amp, ph: rng() * 6.28, sp: 0.75 + rng() * 0.5,
             can: null, sh: null, ox: 0, oy: 0 };
  }
  function makeBranch() {
    var rng = S.mulberry32(4242), wide = W > H * 1.1;
    var ax = W * (wide ? 0.8 : 0.9), ay = -T * 0.06;
    var a = wide ? Math.PI * 0.72 : Math.PI * 0.62;                 // in toward the middle, and down
    var total = Math.min(Math.hypot(W, H) * 0.5, T * 0.95), N = 8, seg = total / N;
    var w0 = T * 0.04, leafR = T * 0.04;
    limb = newPiece(rng, 0, 0, 0.006);
    var subs = [], x = 0, y = 0, bend = (rng() - 0.5) * 0.08;
    for (var j = 0; j < N; j++) {
      var w = lerp(w0, w0 * 0.3, j / N), wn = lerp(w0, w0 * 0.3, (j + 1) / N);
      a += bend + (rng() - 0.5) * 0.28;
      var x2 = x + Math.cos(a) * seg, y2 = y + Math.sin(a) * seg;
      limb.segs.push({ x0: x, y0: y, x: x2, y: y2, a: a, w0: w, w1: wn });
      if (j >= N - 3) limb.clusters.push({ x: lerp(x, x2, 0.5), y: lerp(y, y2, 0.5), r: leafR * 0.9, seed: (rng() * 1e9) | 0 });
      x = x2; y = y2;
      // a side branch at most joints, to alternate sides
      if (j < N - 1 && (j > 0 || rng() < 0.5) && rng() < 0.9) {
        var side = j % 2 ? 1 : -1, sa = a + side * (0.7 + rng() * 0.4);
        var sl = total * (0.3 - j * 0.014) * (0.8 + rng() * 0.4);
        var p = newPiece(rng, x, y, 0.022);
        twig(rng, p, 0, 0, sa, sl * 0.55, wn * 0.62, 0, j < 4 ? 3 : 2, leafR);
        subs.push(p);
      }
    }
    // the tip of the limb, branching out
    var tip = newPiece(rng, x, y, 0.026);
    twig(rng, tip, 0, 0, a + 0.25, seg * 0.9, w0 * 0.3, 0, 3, leafR);
    twig(rng, tip, 0, 0, a - 0.45, seg * 0.8, w0 * 0.26, 1, 3, leafR);
    subs.push(tip);
    limb.ax = ax; limb.ay = ay;
    pieces = [limb].concat(subs);
  }

  function leaf(x, cx, cy, len, wid, rot) {
    x.save(); x.translate(cx, cy); x.rotate(rot);
    x.beginPath(); x.moveTo(-len / 2, 0);
    x.quadraticCurveTo(0, -wid, len / 2, 0); x.quadraticCurveTo(0, wid, -len / 2, 0);
    x.fill(); x.restore();
  }
  function paintPiece(pc, lk) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, i;
    pc.segs.forEach(function (s) {
      minX = Math.min(minX, s.x0 - s.w0, s.x - s.w0); maxX = Math.max(maxX, s.x0 + s.w0, s.x + s.w0);
      minY = Math.min(minY, s.y0 - s.w0, s.y - s.w0); maxY = Math.max(maxY, s.y0 + s.w0, s.y + s.w0);
    });
    pc.clusters.forEach(function (c) {
      minX = Math.min(minX, c.x - c.r * 1.4); maxX = Math.max(maxX, c.x + c.r * 1.4);
      minY = Math.min(minY, c.y - c.r * 1.4); maxY = Math.max(maxY, c.y + c.r * 1.4);
    });
    var pad = 10; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var cw = Math.ceil((maxX - minX) * dpr), ch = Math.ceil((maxY - minY) * dpr);
    if (!pc.can) { pc.can = document.createElement('canvas'); pc.sh = document.createElement('canvas'); }
    var c = pc.can; c.width = cw; c.height = ch; pc.ox = minX; pc.oy = minY;
    var x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr);
    // the wood: tapering, dark below, lit along the top left
    function wood(col, dx, dy, k, minW) {
      x.fillStyle = col;
      for (i = 0; i < pc.segs.length; i++) {
        var s = pc.segs[i], nx = -Math.sin(s.a), ny = Math.cos(s.a), a0 = s.w0 * k / 2, a1 = s.w1 * k / 2;
        if (s.w0 * k < 0.6 || (minW && s.w1 < minW)) continue;
        x.beginPath();
        x.moveTo(s.x0 + nx * a0 + dx, s.y0 + ny * a0 + dy); x.lineTo(s.x + nx * a1 + dx, s.y + ny * a1 + dy);
        x.lineTo(s.x - nx * a1 + dx, s.y - ny * a1 + dy); x.lineTo(s.x0 - nx * a0 + dx, s.y0 - ny * a0 + dy);
        x.closePath(); x.fill();
        x.beginPath(); x.arc(s.x + dx, s.y + dy, a1, 0, 6.283); x.fill();
        if (pc === limb && i === 0) { x.beginPath(); x.arc(s.x0 + dx, s.y0 + dy, a0, 0, 6.283); x.fill(); }
      }
    }
    wood('#1f1714', 0, 0, 1.1);
    wood('#3a2c27', 0, 0, 1);
    wood('rgba(112,94,84,0.5)', -0.5, -0.7, 0.38, 3);
    wood('rgba(150,132,118,0.25)', -0.7, -1, 0.14, 5);
    // snow lying along the thicker wood
    if (lk.snow > 0.02) {
      x.globalAlpha = lk.snow * 0.9;
      wood('#eef3f6', -0.4, -0.9, 0.5, T * 0.011);
      x.globalAlpha = 1;
    }
    // the leaves: a dark mass for depth, then single pointed leaves, lighter toward the sun; then blossom
    var under = shade(mix(lk.c[0], [20, 34, 24], 0.45), 1);
    pc.clusters.forEach(function (cl) {
      var r = S.mulberry32(cl.seed), k;
      if (lk.d > 0.12) {
        x.fillStyle = rgb(under, Math.min(1, lk.d * 1.4) * 0.9);
        for (k = 0; k < 4; k++) { x.beginPath(); x.arc(cl.x + (r() - 0.5) * cl.r * 0.6, cl.y + (r() - 0.5) * cl.r * 0.6, cl.r * (0.42 + r() * 0.15), 0, 6.283); x.fill(); }
      }
      for (k = 0; k < 22; k++) {
        var keep = r(), la = r() * 6.283, ld = cl.r * (0.1 + 0.85 * Math.sqrt(r())), rot = la + (r() - 0.5) * 1.1;
        var len = cl.r * (0.4 + r() * 0.22), ci = (r() * 3) | 0;
        if (keep > lk.d) continue;
        var lx = cl.x + Math.cos(la) * ld, ly = cl.y + Math.sin(la) * ld;
        var lit = 1 + 0.2 * (-(Math.cos(la) + Math.sin(la)) / 1.414) * (ld / cl.r) + (k / 22) * 0.12;
        x.fillStyle = rgb(shade(lk.c[ci], lit));
        leaf(x, lx, ly, len, len * 0.3, rot);
        if (len > 7) {
          x.strokeStyle = 'rgba(255,255,220,0.18)'; x.lineWidth = 0.7;
          x.beginPath(); x.moveTo(lx - Math.cos(rot) * len * 0.4, ly - Math.sin(rot) * len * 0.4);
          x.lineTo(lx + Math.cos(rot) * len * 0.4, ly + Math.sin(rot) * len * 0.4); x.stroke();
        }
      }
      if (lk.bloom && lk.bd > 0.02) {
        for (k = 0; k < 6; k++) {
          var bk = r(), ba = r() * 6.283, bdd = cl.r * Math.sqrt(r()) * 0.9, br = cl.r * (0.15 + r() * 0.07);
          if (bk > lk.bd) continue;
          var bx = cl.x + Math.cos(ba) * bdd, by = cl.y + Math.sin(ba) * bdd;
          for (var pp = 0; pp < 5; pp++) {
            var pa = pp * 1.2566 + ba;
            x.fillStyle = rgb(shade(lk.bloom, pp < 2 ? 1.04 : 0.96));
            x.beginPath(); x.ellipse(bx + Math.cos(pa) * br * 0.62, by + Math.sin(pa) * br * 0.62, br * 0.62, br * 0.5, pa, 0, 6.283); x.fill();
          }
          x.fillStyle = '#d4627e'; x.beginPath(); x.arc(bx, by, br * 0.28, 0, 6.283); x.fill();
          x.fillStyle = '#f6e7a8'; x.beginPath(); x.arc(bx + br * 0.08, by - br * 0.08, br * 0.11, 0, 6.283); x.fill();
        }
      }
      if (lk.snow > 0.02 && lk.d > 0.1) {
        x.fillStyle = rgb([238, 243, 246], lk.snow * 0.8);
        x.beginPath(); x.ellipse(cl.x - cl.r * 0.15, cl.y - cl.r * 0.2, cl.r * 0.45, cl.r * 0.3, 0.5, 0, 6.283); x.fill();
      }
    });
    // its shadow: the same shape, dark and soft
    var sh = pc.sh; sh.width = cw; sh.height = ch;
    var y = sh.getContext('2d');
    if ('filter' in y) { y.filter = 'blur(' + (2.5 * dpr) + 'px)'; y.drawImage(c, 0, 0); y.filter = 'none'; }
    else y.drawImage(c, 0, 0);
    y.globalCompositeOperation = 'source-in';
    y.fillStyle = '#02070a'; y.fillRect(0, 0, cw, ch);
  }
  function paint() {
    look = state.ph;
    var lk = lookAt(state.ph);
    pieces.forEach(function (pc) { paintPiece(pc, lk); });
  }

  // how far each piece is turned by the wind just now
  function swayOf(pc, now) {
    var w = state.wind, g = state.gust, k = pc === limb ? 0.35 : 1;
    return k * (Math.sin(now * pc.sp * (0.6 + w) + pc.ph) * (pc.amp + w * pc.amp * 1.8)
              + Math.sin(now * 2.9 * pc.sp + pc.ph * 2) * w * pc.amp * 0.6 + g * w * pc.amp * 1.5);
  }
  var swayNow = 0;
  function toWorld(pc, px, py) {
    var la = swayOf(limb, swayNow), lc = Math.cos(la), ls = Math.sin(la), x = px, y = py;
    if (pc !== limb) {
      var a = swayOf(pc, swayNow), c = Math.cos(a), s = Math.sin(a);
      x = pc.bx + px * c - py * s; y = pc.by + px * s + py * c;
    }
    return { x: limb.ax + x * lc - y * ls, y: limb.ay + x * ls + y * lc };
  }
  function drawPieces(ctx, shadow, off, now) {
    var la = swayOf(limb, now);
    ctx.save(); ctx.translate(limb.ax + off, limb.ay + off * 1.4); ctx.rotate(la);
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i], img = shadow ? pc.sh : pc.can;
      if (!img) continue;
      if (pc === limb) { ctx.drawImage(img, pc.ox, pc.oy, img.width / dpr, img.height / dpr); continue; }
      ctx.save(); ctx.translate(pc.bx, pc.by); ctx.rotate(swayOf(pc, now));
      ctx.drawImage(img, pc.ox, pc.oy, img.width / dpr, img.height / dpr);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------- soft shapes, painted once ---------- */
  var blobDark = null, blobLight = null, frost = null;
  function makeBlob(col) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(' + col + ',1)'); g.addColorStop(0.5, 'rgba(' + col + ',0.6)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
  }
  // ice that creeps in from the edges in winter: a frosted rim with feathery crystals reaching out over the water
  function makeFrost() {
    var c = document.createElement('canvas'), k = Math.min(dpr, 1.25);
    c.width = Math.ceil(W * k); c.height = Math.ceil(H * k);
    var x = c.getContext('2d'), rng = S.mulberry32(77), deep = T * 0.07, i, n;
    x.scale(k, k);
    function edgePoint(t) {                                   // t in 0..1 around the edge, with the inward direction
      var p = t * 2 * (W + H);
      if (p < W) return { x: p, y: 0, a: Math.PI / 2 };
      p -= W; if (p < H) return { x: W, y: p, a: Math.PI };
      p -= H; if (p < W) return { x: W - p, y: H, a: -Math.PI / 2 };
      p -= W; return { x: 0, y: H - p, a: 0 };
    }
    n = Math.ceil(2 * (W + H) / 5);
    for (i = 0; i < n; i++) {
      var e = edgePoint(i / n), d = deep * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.13) * Math.sin(i * 0.051 + 1)) + rng() * 0.2);
      x.fillStyle = 'rgba(214,230,238,0.045)';
      x.beginPath(); x.arc(e.x, e.y, d, 0, 6.283); x.fill();
      x.fillStyle = 'rgba(232,242,247,0.09)';
      x.beginPath(); x.arc(e.x, e.y, d * 0.45, 0, 6.283); x.fill();
    }
    x.strokeStyle = 'rgba(236,245,250,0.32)'; x.lineCap = 'round';
    function crystal(px, py, a, len, depth) {
      // a slightly wandering spine, with a few side shoots at odd places
      var ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
      x.lineWidth = Math.max(0.4, 1 - depth * 0.3);
      x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
      if (depth >= 2) return;
      var shoots = 1 + ((rng() * 3) | 0);
      for (var b = 0; b < shoots; b++) {
        var f = 0.2 + rng() * 0.6, sd = rng() < 0.5 ? 1 : -1;
        crystal(lerp(px, ex, f), lerp(py, ey, f), a + sd * (0.6 + rng() * 0.5), len * (0.2 + rng() * 0.25), depth + 1);
      }
      if (rng() < 0.5) crystal(ex, ey, a + (rng() - 0.5) * 0.9, len * (0.3 + rng() * 0.3), depth + 1);
    }
    n = Math.ceil(2 * (W + H) / 22);
    for (i = 0; i < n; i++) {
      var q = edgePoint((i + rng() * 0.8) / n);
      crystal(q.x, q.y, q.a + (rng() - 0.5) * 1.3, deep * (0.25 + rng() * rng() * 1.1), 0);
    }
    return c;
  }

  function setup(w, h, ratio) {
    W = w; H = h; T = Math.min(W, H); dpr = Math.min(ratio || 1, 1.5);
    makeBranch();
    if (!blobDark) { blobDark = makeBlob('2,7,10'); blobLight = makeBlob('208,216,220'); }
    frost = null;                                      // painted when winter first needs it
    falling.length = 0; floating.length = 0; drops.length = 0; glints.length = 0; paws.length = 0;
    clouds.length = 0; bugs.length = 0;
    paint();
  }

  /* ---------- falling petals and leaves, snow, rain ---------- */
  var falling = [], floating = [], drops = [], flakes = [];
  function shed(dt) {
    var s = Math.floor(state.ph) % 4;
    var rate = [0.7, 0.08, 0.8, 0][s] * (0.4 + state.wind * 2.2);
    if (Math.random() > rate * dt) return;
    var lk = lookAt(state.ph);
    if (lk.d < 0.1 && !(lk.bloom && lk.bd > 0.2)) return;
    var pc = pieces[(Math.random() * pieces.length) | 0], c = pc.clusters[(Math.random() * pc.clusters.length) | 0];
    if (!c) return;
    var p = toWorld(pc, c.x, c.y), petal = lk.bloom && lk.bd > 0.3 && Math.random() < 0.85;
    falling.push({ x: p.x, y: p.y, z: 1, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, rot: Math.random() * 6.28,
                   spin: (Math.random() - 0.5) * 4, col: petal ? lk.bloom : lk.c[(Math.random() * 3) | 0], petal: petal,
                   size: (petal ? 3.2 : 4.5) * (0.8 + Math.random() * 0.4) });
  }

  /* ---------- the life of the pond ---------- */
  var clouds = [], glints = [], paws = [], bugs = [], mists = [];
  for (var mi = 0; mi < 5; mi++) mists.push({ x: Math.random(), y: Math.random(), r: 0.35 + Math.random() * 0.3, sp: 0.004 + Math.random() * 0.006 });

  function sunlight() { return Math.max(0, 1 - state.dim * 3.2 - state.fog * 1.2 - state.snow * 0.5) * (state.season === 3 ? 0.75 : 1); }

  function updateClouds(dt) {
    var want = Math.round(state.clouds * (1 - state.rain)), sp = 7 + state.wind * 22, i;
    if (clouds.filter(function (c) { return !c.go; }).length < want && Math.random() < dt * (clouds.length ? 0.06 : 1)) {
      var r = T * (0.45 + Math.random() * 0.45), first = !clouds.length;
      // a new cloud comes in from the upwind edges (or starts anywhere, the first time)
      var x0 = first ? Math.random() * W : Math.random() < 0.5 ? -r * 1.6 : Math.random() * W * 0.6,
          y0 = first ? Math.random() * H : x0 < 0 ? Math.random() * H * 0.7 : -r * 1.6;
      var parts = [];
      for (var k = 0; k < 4; k++) parts.push({ dx: (Math.random() - 0.5) * r * 1.2, dy: (Math.random() - 0.5) * r * 0.6, r: r * (0.5 + Math.random() * 0.45) });
      clouds.push({ x: x0, y: y0, r: r, parts: parts, a: first ? 1 : 0, go: false, sp: sp * (0.8 + Math.random() * 0.4) });
    }
    for (i = clouds.length - 1; i >= 0; i--) {
      var c = clouds[i];
      c.x += WX * c.sp * dt; c.y += WY * c.sp * dt;
      if (c.x - c.r * 2 > W || c.y - c.r * 2 > H) c.go = true;
      if (clouds.length - i > want + 0) c.go = c.go || (want < clouds.length && i === 0);
      c.a += ((c.go ? 0 : 1) - c.a) * Math.min(1, dt * 0.25);
      if (c.go && c.a < 0.02) clouds.splice(i, 1);
    }
  }

  // the sun catches the slopes of ripples for a moment
  function updateGlints(dt, p) {
    var sun = sunlight(), n = sun * (2 + state.wind * 9) * dt, i;
    while (n > 0) {
      if (Math.random() < n && p) {
        var best = null, bs = 0.004;
        for (var k = 0; k < 6; k++) {
          var gx = 10 + Math.random() * (W - 20), gy = 10 + Math.random() * (H - 20);
          var sl = Math.abs(p.height(gx + 2, gy) - p.height(gx - 2, gy)) + Math.abs(p.height(gx, gy + 2) - p.height(gx, gy - 2));
          if (sl > bs) { bs = sl; best = { x: gx, y: gy }; }
        }
        if (!best && state.wind > 0.3) best = { x: Math.random() * W, y: Math.random() * H };
        if (best) glints.push({ x: best.x, y: best.y, age: 0, life: 0.35 + Math.random() * 0.45, s: 1.6 + Math.random() * 2.2 });
      }
      n -= 1;
    }
    for (i = glints.length - 1; i >= 0; i--) { glints[i].age += dt; if (glints[i].age > glints[i].life) glints.splice(i, 1); }
    if (glints.length > 60) glints.splice(0, glints.length - 60);
  }

  // gusts: patches of ruffled water that travel with the wind
  function updatePaws(dt, p) {
    var i;
    if (state.wind > 0.3 && Math.random() < dt * 0.35 * state.wind) {
      var r = T * (0.1 + Math.random() * 0.12);
      paws.push({ x: Math.random() * W * 0.8 - r, y: Math.random() * H * 0.8 - r, r: r, age: 0, life: 3 + Math.random() * 3, sp: 40 + state.wind * 50 });
    }
    for (i = paws.length - 1; i >= 0; i--) {
      var w = paws[i];
      w.age += dt; w.x += WX * w.sp * dt; w.y += WY * w.sp * dt;
      if (w.age > w.life) { paws.splice(i, 1); continue; }
      var strength = Math.sin(Math.PI * w.age / w.life), n = 40 * dt * strength;
      while (n > 0) {
        if (Math.random() < n && p) {
          var a = Math.random() * 6.283, d = w.r * Math.sqrt(Math.random());
          var px = w.x + Math.cos(a) * d * 1.4, py = w.y + Math.sin(a) * d * 0.8;
          if (px > 0 && px < W && py > 0 && py < H) p.poke(px, py, 0.015 + Math.random() * 0.015, true);
        }
        n -= 1;
      }
    }
  }

  /* Dragonflies in summer: hover, dart, hover, and now and then touch the water. Butterflies in spring wander and flutter. */
  function bugTargets() {
    var s = state.season, f = state.ph - Math.floor(state.ph);
    var fair = state.rain < 0.2 && state.snow < 0.2 && state.fog < 0.5 && state.wind < 0.8;
    if (!fair) return { dragon: 0, fly: 0 };
    return { dragon: s === 1 ? 2 : (s === 0 && f > 0.5) || (s === 2 && f < 0.35) ? 1 : 0,
             fly: s === 0 ? 2 : s === 1 && f < 0.4 ? 1 : 0 };
  }
  function offEdge() {
    var e = (Math.random() * 4) | 0, m = 40;
    return e === 0 ? { x: Math.random() * W, y: -m } : e === 1 ? { x: W + m, y: Math.random() * H } :
           e === 2 ? { x: Math.random() * W, y: H + m } : { x: -m, y: Math.random() * H };
  }
  function inside(m) { return { x: m + Math.random() * (W - 2 * m), y: m + Math.random() * (H - 2 * m) }; }
  var DRAGON_COLS = [[46, 132, 160], [184, 62, 44], [70, 150, 96]];
  var FLY_COLS = [[244, 226, 136], [242, 240, 232], [236, 178, 96]];
  function updateBugs(dt, p) {
    var want = bugTargets(), have = { dragon: 0, fly: 0 }, i;
    bugs.forEach(function (b) { if (!b.leaving) have[b.kind]++; });
    ['dragon', 'fly'].forEach(function (kind) {
      if (have[kind] < want[kind] && Math.random() < dt * 0.08) {
        var s = offEdge(), cols = kind === 'dragon' ? DRAGON_COLS : FLY_COLS;
        bugs.push({ kind: kind, x: s.x, y: s.y, h: 0, t: Math.random() * 10, mode: 'go', fx: s.x, fy: s.y, to: inside(60), dur: 1.2, k: 0,
                    wait: 0, col: cols[(Math.random() * cols.length) | 0], dip: false, z: 1, leaving: false });
      }
      if (have[kind] > want[kind]) {
        for (i = 0; i < bugs.length; i++) if (bugs[i].kind === kind && !bugs[i].leaving) {
          var b0 = bugs[i]; b0.leaving = true; b0.mode = 'go'; b0.fx = b0.x; b0.fy = b0.y; b0.to = offEdge(); b0.k = 0; b0.dur = 1.6; break;
        }
      }
    });
    for (i = bugs.length - 1; i >= 0; i--) {
      var b = bugs[i];
      b.t += dt;
      if (b.kind === 'dragon') {
        if (b.mode === 'go') {
          b.k = Math.min(1, b.k + dt / b.dur);
          var e = smooth(b.k), nx = lerp(b.fx, b.to.x, e), ny = lerp(b.fy, b.to.y, e);
          if (Math.hypot(nx - b.x, ny - b.y) > 0.3) b.h = Math.atan2(ny - b.y, nx - b.x);
          b.x = nx; b.y = ny;
          b.z = b.dip ? 1 - 0.7 * Math.sin(Math.PI * Math.min(1, b.k * 1.2)) : 1;
          if (b.k >= 1) {
            if (b.leaving) { bugs.splice(i, 1); continue; }
            if (b.dip && p) { p.poke(b.x, b.y, 0.18, true); b.dip = false; }
            b.mode = 'hover'; b.wait = 0.8 + Math.random() * 2.6;
          }
        } else {
          b.wait -= dt;
          b.x += Math.sin(b.t * 9) * 6 * dt; b.y += Math.cos(b.t * 7.3) * 6 * dt; b.h += Math.sin(b.t * 3) * 0.2 * dt;
          if (b.wait <= 0) {
            b.mode = 'go'; b.fx = b.x; b.fy = b.y; b.k = 0;
            var tries = 0, t2;
            do { t2 = inside(50); tries++; } while (Math.hypot(t2.x - b.x, t2.y - b.y) > T * 0.6 && tries < 5);
            b.to = t2; b.dur = 0.35 + Math.hypot(t2.x - b.x, t2.y - b.y) / 700; b.dip = Math.random() < 0.25;
          }
        }
      } else {
        // a butterfly wanders: a slow turn that changes its mind, and it heads back in from the edges
        var sp = 34;
        if (b.leaving) {
          var aw = Math.atan2(b.to.y - b.y, b.to.x - b.x); b.h += Math.atan2(Math.sin(aw - b.h), Math.cos(aw - b.h)) * dt * 2;
          if (Math.hypot(b.to.x - b.x, b.to.y - b.y) < 20) { bugs.splice(i, 1); continue; }
        } else {
          b.h += Math.sin(b.t * 0.8 + b.col[0]) * 1.4 * dt;
          if (b.x < 50 || b.x > W - 50 || b.y < 50 || b.y > H - 50) {
            var ac = Math.atan2(H / 2 - b.y, W / 2 - b.x); b.h += Math.atan2(Math.sin(ac - b.h), Math.cos(ac - b.h)) * dt * 1.6;
          }
        }
        b.x += Math.cos(b.h) * sp * dt + WX * state.wind * 12 * dt; b.y += Math.sin(b.h) * sp * dt + WY * state.wind * 12 * dt;
        b.z = 0.85 + Math.sin(b.t * 2.3) * 0.15;
      }
    }
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
    ['wind', 'rain', 'snow', 'dim', 'fog', 'clouds'].forEach(function (k) { state[k] += (tw[k] - state[k]) * e; });
    state.gust += ((Math.sin(clock * 0.37) > 0.6 ? 1 : 0) - state.gust) * Math.min(1, dt * 0.8);
    state.frost += (lookAt(ph).snow - state.frost) * Math.min(1, dt * 0.5);
    // repaint the branch now and then as its colours change (often while a season turns, rarely otherwise)
    var f = ph - Math.floor(ph);
    if (clock >= repaintAt || (look !== null && Math.floor(look) !== Math.floor(ph) && pref.season === 'turn')) {
      paint(); repaintAt = clock + (f > 0.8 ? 1.5 : 20);
    }
    // falling leaves and petals
    shed(dt);
    var wx = WX * state.wind * 40, wy = WY * state.wind * 40, i;
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
    // the rest of the life of the pond
    updateClouds(dt); updateGlints(dt, p); updatePaws(dt, p); updateBugs(dt, p);
    for (i = 0; i < mists.length; i++) { mists[i].x += mists[i].sp * dt * (0.4 + state.wind); if (mists[i].x > 1.4) mists[i].x = -0.4; }
    if (window.KoiAudio && KoiAudio.setWeather) KoiAudio.setWeather({ rain: state.rain, wind: state.wind });
  }

  /* ---------- drawing ---------- */
  function drawLeaf(ctx, q, x, y, s, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(q.rot);
    ctx.fillStyle = rgb(q.col, a);
    ctx.beginPath();
    if (q.petal) ctx.ellipse(0, 0, s, s * 0.7, 0, 0, 6.283);
    else { ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.6, s, 0); ctx.quadraticCurveTo(0, s * 0.6, -s, 0); }
    ctx.fill();
    ctx.restore();
  }
  // on the water: ice at the edges, glints of sun, ruffled patches, and leaves and petals that have landed
  function drawFloating(ctx) {
    var i;
    if (state.frost > 0.02) {
      if (!frost) frost = makeFrost();
      ctx.globalAlpha = state.frost * 0.9; ctx.drawImage(frost, 0, 0, W, H); ctx.globalAlpha = 1;
    }
    for (i = 0; i < paws.length; i++) {
      var w = paws[i], k = Math.sin(Math.PI * w.age / w.life);
      ctx.globalAlpha = 0.09 * k; ctx.drawImage(blobLight, w.x - w.r * 1.5, w.y - w.r * 0.9, w.r * 3, w.r * 1.8);
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < floating.length; i++) {
      var o = floating[i], a = Math.min(1, (o.life - o.age) / 4) * Math.min(1, o.age * 3);
      ctx.globalAlpha = 0.3 * a; ctx.fillStyle = '#02070a';
      ctx.beginPath(); ctx.ellipse(o.x + 1.5, o.y + 2, o.size, o.size * 0.6, o.rot, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
      drawLeaf(ctx, o, o.x, o.y, o.size, 0.92 * a);
    }
    if (glints.length) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,250,226,0.9)'; ctx.fillStyle = 'rgba(255,252,236,1)';
      ctx.lineCap = 'round';
      for (i = 0; i < glints.length; i++) {
        var g = glints[i], ga = Math.sin(Math.PI * g.age / g.life), r = g.s * (0.6 + ga * 0.6);
        ctx.globalAlpha = ga * 0.75;
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(g.x - r * 2, g.y); ctx.lineTo(g.x + r * 2, g.y); ctx.moveTo(g.x, g.y - r * 1.3); ctx.lineTo(g.x, g.y + r * 1.3); ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, g.y, r * 0.45, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawDragon(ctx, b, x, y, sc, dark) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(b.h); ctx.scale(sc, sc);
    var flick = b.mode === 'go' ? 0.25 : 0.12, wa = Math.sin(b.t * 60) * flick;
    ctx.fillStyle = dark ? '#02070a' : 'rgba(214,232,238,0.38)';
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0)' : 'rgba(230,240,244,0.5)'; ctx.lineWidth = 0.5;
    [[3, 1], [3, -1], [-1, 1], [-1, -1]].forEach(function (wv, n) {
      ctx.save(); ctx.translate(wv[0], 0); ctx.rotate(wv[1] * (Math.PI / 2 - (n < 2 ? 0.12 : -0.12)) + wa * wv[1]);
      ctx.beginPath(); ctx.ellipse(6.5, 0, 6.5, n < 2 ? 1.9 : 2.2, 0, 0, 6.283); ctx.fill(); if (!dark) ctx.stroke();
      ctx.restore();
    });
    ctx.fillStyle = dark ? '#02070a' : rgb(b.col);
    ctx.beginPath(); ctx.ellipse(-7, 0, 9, 1.1, 0, 0, 6.283); ctx.fill();          // the long tail
    ctx.beginPath(); ctx.ellipse(2, 0, 3.2, 1.8, 0, 0, 6.283); ctx.fill();          // body
    ctx.fillStyle = dark ? '#02070a' : rgb(shade(b.col, 0.7));
    ctx.beginPath(); ctx.arc(5.6, 0, 1.7, 0, 6.283); ctx.fill();                   // head
    ctx.restore();
  }
  function drawFly(ctx, b, x, y, sc, dark) {
    var open = 0.25 + 0.75 * Math.abs(Math.sin(b.t * 9));
    ctx.save(); ctx.translate(x, y); ctx.rotate(b.h); ctx.scale(sc, sc);
    var col = dark ? '#02070a' : rgb(b.col), edge = dark ? '#02070a' : rgb(shade(b.col, 0.62));
    [1, -1].forEach(function (sd) {
      ctx.save(); ctx.scale(1, sd * open);
      ctx.fillStyle = edge;
      ctx.beginPath(); ctx.ellipse(1.5, 4.6, 3.6, 4.6, -0.35, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-2.4, 3.6, 2.6, 3.4, 0.4, 0, 6.283); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(1.4, 4.3, 3, 4, -0.35, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-2.3, 3.4, 2.1, 2.9, 0.4, 0, 6.283); ctx.fill();
      ctx.restore();
    });
    ctx.fillStyle = dark ? '#02070a' : '#2b221c';
    ctx.beginPath(); ctx.ellipse(0, 0, 4, 0.9, 0, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  // above everything: shadows of the branch, insects, the branch, things falling, rain, snow, clouds, mist, the light of the season
  var TINT = [[255, 236, 236, 0.03], [255, 226, 160, 0.045], [255, 160, 70, 0.06], [200, 220, 255, 0.09]];
  function drawAbove(ctx) {
    var i, now = swayNow, sunOff = T * 0.045 * (1 - state.dim * 1.5), sun = sunlight();
    // shadows first, softened by cloud
    ctx.globalAlpha = 0.3 * (1 - state.dim * 1.6) + 0.05;
    drawPieces(ctx, true, sunOff, now);
    for (i = 0; i < falling.length; i++) {
      var q = falling[i];
      ctx.fillStyle = '#02070a'; ctx.globalAlpha = 0.25 * (1 - q.z * 0.6);
      ctx.beginPath(); ctx.ellipse(q.x + q.z * sunOff * 2 + 1, q.y + q.z * sunOff * 2.8 + 1, q.size, q.size * 0.6, q.rot, 0, 6.283); ctx.fill();
    }
    // the insects and their shadows on the water
    for (i = 0; i < bugs.length; i++) {
      var b = bugs[i], hgt = b.z * sunOff * 1.3, draw = b.kind === 'dragon' ? drawDragon : drawFly;
      ctx.globalAlpha = 0.22 * (0.5 + sun * 0.5);
      draw(ctx, b, b.x + hgt, b.y + hgt * 1.4, b.kind === "fly" ? 1.45 : 1, true);
      ctx.globalAlpha = 1;
      draw(ctx, b, b.x, b.y, (b.kind === "fly" ? 1.45 : 1) * (0.95 + b.z * 0.15), false);
    }
    ctx.globalAlpha = 1;
    // the branch
    drawPieces(ctx, false, 0, now);
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
    // cloud shadows drifting over everything
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      ctx.globalAlpha = 0.2 * c.a * (0.4 + sun * 0.6);
      for (var pi = 0; pi < c.parts.length; pi++) {
        var pt = c.parts[pi];
        ctx.drawImage(blobDark, c.x + pt.dx - pt.r * 1.3, c.y + pt.dy - pt.r, pt.r * 2.6, pt.r * 2);
      }
    }
    ctx.globalAlpha = 1;
    // the light of the season, then cloud and mist
    var s = state.season, fr = state.ph - Math.floor(state.ph), tt = smooth((fr - 0.82) / 0.18);
    var a = TINT[s], bb = TINT[(s + 1) % 4];
    ctx.fillStyle = rgb(mix(a, bb, tt), lerp(a[3], bb[3], tt)); ctx.fillRect(0, 0, W, H);
    if (state.dim > 0.01) { ctx.fillStyle = 'rgba(8,12,20,' + state.dim * 0.55 + ')'; ctx.fillRect(0, 0, W, H); }
    if (state.fog > 0.01) {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.5, T * 0.15, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(200,210,215,' + 0.06 * state.fog + ')'); g.addColorStop(1, 'rgba(200,210,215,' + 0.28 * state.fog + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // banks of mist drifting slowly across
      for (i = 0; i < mists.length; i++) {
        var m = mists[i], mr = Math.max(W, H) * m.r;
        ctx.globalAlpha = 0.22 * state.fog;
        ctx.drawImage(blobLight, m.x * W - mr, m.y * H - mr * 0.5, mr * 2, mr);
      }
      ctx.globalAlpha = 1;
    }
  }

  function label() { return SEASONS[state.season] + ' · ' + WEATHER[state.weather].name.toLowerCase(); }

  window.KoiSky = {
    setup: setup, update: update, drawFloating: drawFloating, drawAbove: drawAbove, label: label,
    seasons: SEASONS, weathers: Object.keys(WEATHER).map(function (k) { return { id: k, name: WEATHER[k].name }; }),
    prefs: function () { return { season: pref.season, weather: pref.weather }; },
    setSeason: function (v) { pref.season = v; savePref(); repaintAt = 0; },
    setWeather: function (v) { pref.weather = v; savePref(); },
    state: function () {
      return { season: SEASONS[state.season], ph: +state.ph.toFixed(3), weather: state.weather, wind: +state.wind.toFixed(2), rain: +state.rain.toFixed(2),
               snow: +state.snow.toFixed(2), frost: +state.frost.toFixed(2), falling: falling.length, floating: floating.length, flakes: flakes.length,
               clouds: clouds.length, glints: glints.length, paws: paws.length,
               bugs: bugs.map(function (b) { return b.kind; }).join(',') };
    }
  };
})();
