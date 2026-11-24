/* Stillwater Koi prototype: drawing. Reads the game, never changes it. */
(function (root) {
  'use strict';
  var S = root.KoiSim, Wt = root.Water;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Light over a sitting, in minutes at the pond: [minute, r, g, b, alpha, night] */
  var LIGHT = [
    [0, 255, 206, 160, 0.11, 0],
    [25, 255, 230, 200, 0.02, 0],
    [70, 255, 220, 180, 0.03, 0],
    [92, 255, 150, 92, 0.17, 0.15],
    [112, 12, 18, 44, 0.44, 1],
    [1e9, 12, 18, 44, 0.44, 1]
  ];
  function lightAt(min) {
    var i = 0;
    while (i < LIGHT.length - 2 && min >= LIGHT[i + 1][0]) i++;
    var a = LIGHT[i], b = LIGHT[i + 1];
    var t = clamp((min - a[0]) / (b[0] - a[0]), 0, 1);
    function m(k) { return a[k] + (b[k] - a[k]) * t; }
    return { r: m(1) | 0, g: m(2) | 0, b: m(3) | 0, a: m(4), night: m(5),
             label: min < 25 ? 'Morning' : min < 70 ? 'Midday' : min < 92 ? 'Afternoon' : min < 108 ? 'Dusk' : 'Night' };
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1, game = null;
    var wcan = document.createElement('canvas'), wctx = wcan.getContext('2d'), wimg = null;
    var floor = document.createElement('canvas');

    function buildFloor() {
      var W = S.AW, H = S.AH;   // one area's worth of pond floor, reused for every stretch of water
      floor.width = Math.max(1, Math.round(W)); floor.height = Math.max(1, Math.round(H));
      var f = floor.getContext('2d'), rng = Wt.mulberry32(11), i;
      var R = Math.hypot(W, H) * 0.62;
      var g = f.createRadialGradient(W * 0.46, H * 0.44, 0, W * 0.5, H * 0.5, R);
      g.addColorStop(0, '#1d3a3d'); g.addColorStop(0.55, '#162c33'); g.addColorStop(1, '#0e1a22');
      f.fillStyle = g; f.fillRect(0, 0, W, H);
      for (i = 0; i < 46; i++) {
        var x = rng() * W, y = rng() * H, r = (0.05 + rng() * 0.16) * Math.min(W, H);
        var light = rng() < 0.45;
        var b = f.createRadialGradient(x, y, 0, x, y, r);
        b.addColorStop(0, light ? 'rgba(70,110,104,0.10)' : 'rgba(6,12,18,0.16)');
        b.addColorStop(1, light ? 'rgba(70,110,104,0)' : 'rgba(6,12,18,0)');
        f.fillStyle = b; f.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      for (i = 0; i < 70; i++) {
        var sx = rng() * W, sy = rng() * H, sr = 2 + rng() * 6;
        f.fillStyle = rng() < 0.5 ? 'rgba(120,140,130,0.07)' : 'rgba(0,0,0,0.12)';
        f.beginPath(); f.ellipse(sx, sy, sr, sr * (0.6 + rng() * 0.4), rng() * 3.14, 0, 6.2832); f.fill();
      }
    }

    /* sw, sh: the canvas in CSS pixels. z: how many of them one world pixel takes. */
    var zoom = 1;
    function setup(g, sw, sh, z) {
      game = g; W = g.W; H = g.H; zoom = z || 1;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(sw * dpr); canvas.height = Math.round(sh * dpr);
      wcan.width = game.grid.w; wcan.height = game.grid.h;
      wimg = wctx.createImageData(game.grid.w, game.grid.h);
      buildFloor();
      if (!landPat) buildLand();
    }

    /* ---------- how a koi looks, from its genes ---------- */
    function lookOf(k) {
      if (k._look) return k._look;
      var ph = S.phenotype(k.genes), rng = Wt.mulberry32(k.seed), spots = [], i, n;
      var pat = S.PATTERNS[ph.pattern].id;
      if (pat === 'patched') {
        n = 2 + ((rng() * 2) | 0);
        for (i = 0; i < n; i++) spots.push([0.1 + (i + rng() * 0.7) * 0.7 / n, (rng() - 0.5) * 1.2, 0.7 + rng() * 0.35, (rng() - 0.5) * 0.8]);
      } else if (pat === 'saddle') {
        n = 2 + ((rng() * 2) | 0);
        for (i = 0; i < n; i++) spots.push([0.14 + i * 0.62 / n + rng() * 0.06, 0, 1.2, 0]);
      } else if (pat === 'speckled') {
        for (i = 0; i < 9; i++) spots.push([0.06 + rng() * 0.8, (rng() - 0.5) * 1.6, 0.28 + rng() * 0.16, 0]);
      } else if (pat === 'crown') {
        spots.push([0.03, 0, 0.6, 0]);
      }
      k._look = { body: S.BASES[ph.base].col, patch: ph.second >= 0 ? S.SECONDS[ph.second].col : null,
                  spots: spots, saddle: pat === 'saddle' };
      return k._look;
    }

    /* ---------- fish (from the pond toy) ---------- */
    var FW = [0.36, 0.74, 0.95, 1.0, 0.93, 0.78, 0.58, 0.4, 0.26, 0.17];
    var NS = FW.length;
    var sxs = new Float32Array(NS), sys = new Float32Array(NS);

    function spine(f) {
      var len = f.len;
      for (var i = 0; i < NS; i++) {
        var s = i / (NS - 1);
        sxs[i] = (0.36 - s * 0.8) * len;
        sys[i] = (Math.sin(f.phase - s * 3.0) * 0.085 - f.turn * 0.035) * len * s * s;
      }
    }
    function bodyPath(f) {
      var hw = f.len * 0.13, i;
      ctx.beginPath();
      ctx.moveTo(sxs[0] + f.len * 0.075, sys[0]);
      ctx.quadraticCurveTo(sxs[0] + f.len * 0.07, sys[0] - hw * FW[0], sxs[0], sys[0] - hw * FW[0]);
      for (i = 1; i < NS; i++) ctx.lineTo(sxs[i], sys[i] - hw * FW[i]);
      for (i = NS - 1; i >= 0; i--) ctx.lineTo(sxs[i], sys[i] + hw * FW[i]);
      ctx.quadraticCurveTo(sxs[0] + f.len * 0.07, sys[0] + hw * FW[0], sxs[0] + f.len * 0.075, sys[0]);
      ctx.closePath();
    }
    function tailPath(f) {
      var len = f.len, ex = sxs[NS - 1], ey = sys[NS - 1];
      var sw = (Math.sin(f.phase - 3.9) * 0.13 - f.turn * 0.03) * len;
      var tx = ex - len * 0.26;
      ctx.beginPath();
      ctx.moveTo(ex + len * 0.03, ey - len * 0.02);
      ctx.quadraticCurveTo(ex - len * 0.1, ey - len * 0.05 + sw * 0.4, tx, ey - len * 0.12 + sw);
      ctx.quadraticCurveTo(tx + len * 0.09, ey + sw * 0.8, tx, ey + len * 0.12 + sw);
      ctx.quadraticCurveTo(ex - len * 0.1, ey + len * 0.05 + sw * 0.4, ex + len * 0.03, ey + len * 0.02);
      ctx.closePath();
    }
    function finsPath(f) {
      var len = f.len, hw = len * 0.13, i = 2;
      var flap = Math.sin(f.phase * 0.7) * 0.15;
      ctx.beginPath();
      ctx.ellipse(sxs[i] - len * 0.05, sys[i] - hw * 1.15, len * 0.1, len * 0.04, 0.75 + flap, 0, 6.2832);
      ctx.ellipse(sxs[i] - len * 0.05, sys[i] + hw * 1.15, len * 0.1, len * 0.04, -0.75 - flap, 0, 6.2832);
    }

    // a fry starts out pale; its colour comes in as it grows, then its pattern
    var PALE = [176, 178, 164];
    function mix(hex, t) {
      var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgb(' + Math.round(PALE[0] + (r - PALE[0]) * t) + ',' + Math.round(PALE[1] + (g - PALE[1]) * t) + ',' + Math.round(PALE[2] + (b - PALE[2]) * t) + ')';
    }

    function drawFish(f) {
      var look = lookOf(f), len = f.len, hw = len * 0.13, i;
      var dev = game.develop(f), body = dev.colour >= 1 ? look.body : mix(look.body, dev.colour);
      spine(f);
      ctx.save();
      ctx.translate(f.x + len * 0.07, f.y + len * 0.11); ctx.rotate(f.a);
      ctx.fillStyle = 'rgba(2,6,10,0.22)';
      bodyPath(f); ctx.fill(); tailPath(f); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.a);
      if (f.pulse > 0) { var ps = 1 + 0.09 * f.pulse; ctx.scale(ps, ps); }   // a little swell with each mouthful
      ctx.globalAlpha = 0.5; ctx.fillStyle = body;
      finsPath(f); ctx.fill();
      ctx.globalAlpha = 0.62;
      tailPath(f); ctx.fill();
      ctx.globalAlpha = 0.9;
      bodyPath(f); ctx.fill();
      ctx.save();
      ctx.clip();
      if (look.patch && dev.pattern > 0) {
        ctx.globalAlpha = 0.9 * dev.pattern;
        ctx.fillStyle = look.patch;
        for (i = 0; i < look.spots.length; i++) {
          var sp = look.spots[i], k = Math.round(sp[0] * (NS - 1));
          ctx.beginPath();
          ctx.ellipse(sxs[k], sys[k] + sp[1] * hw, len * (look.saddle ? 0.075 : 0.13) * sp[2], hw * 0.95 * sp[2], sp[3], 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.22; ctx.strokeStyle = '#0b1216'; ctx.lineWidth = hw * 0.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sxs[2], sys[2]);
      for (i = 3; i < NS - 1; i++) ctx.lineTo(sxs[i], sys[i]);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#0c1014';
      ctx.beginPath();
      ctx.arc(sxs[0] + len * 0.01, sys[0] - hw * 0.34, len * 0.014, 0, 6.2832);
      ctx.arc(sxs[0] + len * 0.01, sys[0] + hw * 0.34, len * 0.014, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }

    /* ---------- lily pads (from the pond toy) ---------- */
    var PAD_TONES = [['#48684b', '#34503c'], ['#516f4a', '#3a5539'], ['#43624f', '#30493d']];
    function padShape(r) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, 0.22, 6.2832 - 0.22);
      ctx.closePath();
    }
    function drawFlower(r, lotus) {
      var pr = r * (lotus ? 0.47 : 0.34), i, a;
      ctx.save();
      ctx.translate(-r * 0.3, r * 0.22);
      for (var ring = 0; ring < 2; ring++) {
        ctx.fillStyle = lotus ? (ring ? '#f0d6da' : '#d59aa8') : (ring ? '#e3d9cd' : '#cdb9b4');
        var n = ring ? 6 : 8, rr = pr * (ring ? 0.68 : 1);
        for (i = 0; i < n; i++) {
          a = i * 6.2832 / n + ring * 0.4;
          ctx.beginPath();
          ctx.ellipse(Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5, rr * 0.55, rr * 0.24, a, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#c9a85c';
      ctx.beginPath(); ctx.arc(0, 0, pr * 0.17, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    function drawPad(p) {
      var r = p.r, tone = PAD_TONES[p.tone];
      var tx = clamp(p.tx, -0.6, 0.6), ty = clamp(p.ty, -0.6, 0.6);
      var bob = clamp(p.bob, -1.2, 1.2);
      var tm = Math.hypot(tx, ty), ta = Math.atan2(ty, tx);
      var squash = 1 - Math.min(0.16, tm * 0.45);
      var x = p.x - tx * r * 0.35, y = p.y - ty * r * 0.35;
      var sc = 1 + bob * 0.045;

      ctx.save();
      ctx.translate(x + 3 + bob * 2.5, y + 5 + bob * 3.5);
      ctx.rotate(p.rot); ctx.fillStyle = 'rgba(2,6,10,0.3)';
      padShape(r * 1.02); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ta); ctx.scale(squash * sc, sc); ctx.rotate(-ta);
      ctx.rotate(p.rot);
      var g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
      g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
      ctx.fillStyle = g; padShape(r); ctx.fill();
      ctx.strokeStyle = 'rgba(190,210,170,0.16)'; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,215,180,0.11)';
      ctx.beginPath();
      for (var i = 0; i < 9; i++) {
        var a = 0.5 + i * (6.2832 - 1.0) / 8;
        ctx.moveTo(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1);
        ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      }
      ctx.stroke();
      if (p.flower) drawFlower(r, p.lotus);
      ctx.restore();

      var lit = -(tx * 0.6 + ty * 0.8);
      if (Math.abs(lit) > 0.01) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillStyle = lit > 0 ? 'rgba(4,10,12,' + Math.min(0.3, lit * 0.9) + ')' : 'rgba(215,230,205,' + Math.min(0.2, -lit * 0.6) + ')';
        padShape(r * sc); ctx.fill();
        ctx.restore();
      }
    }

    function drawPellets() {
      var ps = game.pellets, life = S.T.pelletLife;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var a = Math.min(1, p.age * 3) * clamp((life - p.age) / 8, 0, 1);
        ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#02060a';
        ctx.beginPath(); ctx.arc(p.x + 1.5, p.y + 2.5, p.r, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = a; ctx.fillStyle = '#b9925a';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#dcc08a';
        ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.4, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function ring(f, style, dash) {
      if (!f) return;
      ctx.save();
      ctx.strokeStyle = style; ctx.lineWidth = 1.5;
      if (dash) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(22, f.len * 0.62), 0, 6.2832); ctx.stroke();
      ctx.restore();
    }

    /* ---------- garden things ---------- */
    function drawDuckweed(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), i;
      for (i = 0; i < 30; i++) {
        var a = rng() * 6.283, d = Math.sqrt(rng()) * 38, r = 2.2 + rng() * 2.6;
        var x = at.x + Math.cos(a) * d * 1.25, y = at.y + Math.sin(a) * d;
        var h = game.grid.sample(game.gx(x), game.gy(y));
        ctx.fillStyle = rng() < 0.5 ? '#6c9653' : '#557c46';
        ctx.beginPath(); ctx.ellipse(x + h * 6, y + h * 6, r, r * 0.85, a, 0, 6.2832); ctx.fill();
      }
    }
    function drawRock(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), i, n = 9;
      var R = 20 + rng() * 14, pts = [];
      for (i = 0; i < n; i++) { var a = i / n * 6.2832, rr = R * (0.78 + rng() * 0.34); pts.push([Math.cos(a) * rr * 1.2, Math.sin(a) * rr]); }
      function shape(ox, oy) {
        ctx.beginPath();
        for (var k = 0; k < n; k++) {
          var p0 = pts[k], p1 = pts[(k + 1) % n], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          if (k === 0) ctx.moveTo(at.x + ox + mx, at.y + oy + my);
          var p2 = pts[(k + 2) % n];
          ctx.quadraticCurveTo(at.x + ox + p1[0], at.y + oy + p1[1], at.x + ox + (p1[0] + p2[0]) / 2, at.y + oy + (p1[1] + p2[1]) / 2);
        }
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(2,6,10,0.32)'; shape(4, 7); ctx.fill();
      var g = ctx.createRadialGradient(at.x - R * 0.3, at.y - R * 0.3, 2, at.x, at.y, R * 1.3);
      g.addColorStop(0, '#6d7571'); g.addColorStop(1, '#3c4443');
      ctx.fillStyle = g; shape(0, 0); ctx.fill();
      ctx.save(); ctx.clip();
      for (i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(86,118,72,' + (0.35 + rng() * 0.3).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(at.x + (rng() - 0.5) * R * 1.6, at.y + (rng() - 0.5) * R * 1.2, R * (0.25 + rng() * 0.3), R * (0.15 + rng() * 0.2), rng() * 3, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
    function blades(at, rng, n, lo, hi, spread, cols, width) {
      var tips = [];
      ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var a = at.a + (i / (n - 1) - 0.5) * spread + (rng() - 0.5) * 0.2, L = lo + rng() * (hi - lo);
        var sway = Math.sin(game.time * 0.7 + i * 1.3 + (pl_seedPhase)) * 0.06;
        var bx = at.x + Math.cos(at.a + Math.PI / 2) * (i - n / 2) * 3, by = at.y + Math.sin(at.a + Math.PI / 2) * (i - n / 2) * 3;
        var tx = bx + Math.cos(a + sway) * L, ty = by + Math.sin(a + sway) * L;
        var mx = bx + Math.cos(a - 0.25) * L * 0.5, my = by + Math.sin(a - 0.25) * L * 0.5;
        ctx.strokeStyle = 'rgba(2,6,10,0.25)'; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(bx + 3, by + 5); ctx.quadraticCurveTo(mx + 3, my + 5, tx + 3, ty + 5); ctx.stroke();
        ctx.strokeStyle = cols[i % cols.length]; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
        tips.push([tx, ty, a]);
      }
      return tips;
    }
    var pl_seedPhase = 0;
    function drawReed(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), i;
      pl_seedPhase = pl.seed % 7;
      var tips = blades(at, rng, 9, 46, 86, 1.7, ['#587a4a', '#6c8d55', '#4b6b42'], 3.2);
      for (i = 0; i < tips.length; i += 3) {
        ctx.strokeStyle = '#6b4a32'; ctx.lineWidth = 5.5;
        ctx.beginPath(); ctx.moveTo(tips[i][0], tips[i][1]);
        ctx.lineTo(tips[i][0] - Math.cos(tips[i][2]) * 13, tips[i][1] - Math.sin(tips[i][2]) * 13); ctx.stroke();
      }
    }
    function drawIris(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), i, k;
      pl_seedPhase = pl.seed % 5;
      var tips = blades(at, rng, 7, 34, 60, 1.5, ['#5d8552', '#4f7448'], 3.6);
      for (i = 1; i < tips.length; i += 2) {
        for (k = 0; k < 3; k++) {
          var a = tips[i][2] + k * 2.094;
          ctx.fillStyle = k ? '#8a78c0' : '#a493d6';
          ctx.beginPath(); ctx.ellipse(tips[i][0] + Math.cos(a) * 5, tips[i][1] + Math.sin(a) * 5, 6.5, 3.6, a, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = '#d9b95a';
        ctx.beginPath(); ctx.arc(tips[i][0], tips[i][1], 2, 0, 6.2832); ctx.fill();
      }
    }
    function drawSpout(pl) {
      var at = game.plantAt(pl), c = Math.cos(at.a), sn = Math.sin(at.a), i;
      var ex = at.x + c * 46, ey = at.y + sn * 46;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(2,6,10,0.3)'; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(at.x + 4, at.y + 7); ctx.lineTo(ex + 4, ey + 7); ctx.stroke();
      ctx.strokeStyle = '#9aa56a'; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = '#b9c486'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(at.x - sn * 2.5, at.y + c * 2.5); ctx.lineTo(ex - sn * 2.5, ey + c * 2.5); ctx.stroke();
      ctx.strokeStyle = '#6f7a48'; ctx.lineWidth = 2;
      for (i = 1; i <= 2; i++) {
        var nx = at.x + c * 16 * i, ny = at.y + sn * 16 * i;
        ctx.beginPath(); ctx.moveTo(nx - sn * 5.5, ny + c * 5.5); ctx.lineTo(nx + sn * 5.5, ny - c * 5.5); ctx.stroke();
      }
      ctx.fillStyle = '#39402a';
      ctx.beginPath(); ctx.ellipse(ex, ey, 4.5, 4.5, 0, 0, 6.2832); ctx.fill();
    }
    function drawLantern(pl) {
      var at = game.plantAt(pl), x = at.x, y = at.y;
      ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(x - 17 + 4, y - 17 + 7, 34, 34);
      ctx.fillStyle = '#74776f'; ctx.fillRect(x - 18, y - 18, 36, 36);
      ctx.fillStyle = '#8b8e85'; ctx.fillRect(x - 13, y - 13, 26, 26);
      ctx.fillStyle = '#5f625b'; ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.fillStyle = '#a3a69c';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill();
      return [x, y];
    }
    function lanternGlow(x, y, night) {
      var flick = 1 + Math.sin(game.time * 7 + x) * 0.04;
      var g = ctx.createRadialGradient(x, y, 0, x, y, 210 * flick);
      g.addColorStop(0, 'rgba(255,200,120,' + (0.55 * night).toFixed(3) + ')');
      g.addColorStop(0.3, 'rgba(255,180,100,' + (0.16 * night).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 220, y - 220, 440, 440);
      ctx.fillStyle = 'rgba(255,226,170,' + Math.min(1, night * 1.2).toFixed(3) + ')';
      ctx.fillRect(x - 6, y - 6, 12, 12);
    }

    /* ---------- visitors ---------- */
    function drawFrog() {
      var fr = game.frog, p = game.pads[fr.pad];
      if (fr.pad < 0 || !p) return;
      var x = p.x + Math.cos(fr.a) * p.r * 0.4, y = p.y + Math.sin(fr.a) * p.r * 0.4;
      ctx.save(); ctx.translate(x, y); ctx.rotate(fr.a);
      ctx.fillStyle = 'rgba(2,6,10,0.3)';
      ctx.beginPath(); ctx.ellipse(1.5, 3, 10, 8, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#557d3e';   // back legs
      ctx.beginPath(); ctx.ellipse(-6, -7, 6, 3.2, 0.5, 0, 6.2832); ctx.ellipse(-6, 7, 6, 3.2, -0.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#6b9a4c';
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 7.5, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#7fae5c';
      ctx.beginPath(); ctx.ellipse(5, 0, 5.5, 5.5, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#e9e4d8';
      ctx.beginPath(); ctx.arc(7, -3.6, 2, 0, 6.2832); ctx.arc(7, 3.6, 2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#14171f';
      ctx.beginPath(); ctx.arc(7.6, -3.6, 1, 0, 6.2832); ctx.arc(7.6, 3.6, 1, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    function drawFly() {
      var fl = game.fly;
      if (fl.state === 'away') return;
      var flying = fl.state !== 'sit', lift = flying ? 12 : 2;
      var flap = flying ? Math.sin(fl.wing * 60) * 0.35 : Math.sin(fl.wing * 2) * 0.05;
      ctx.save(); ctx.translate(fl.x + lift * 0.5, fl.y + lift);
      ctx.rotate(fl.a); ctx.fillStyle = 'rgba(2,6,10,0.22)';
      ctx.beginPath(); ctx.ellipse(-4, 0, 10, 1.6, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(fl.a);
      ctx.fillStyle = 'rgba(225,238,240,0.42)';
      ctx.beginPath();
      ctx.ellipse(1, -7, 3, 9, 0.35 + flap, 0, 6.2832); ctx.ellipse(1, 7, 3, 9, -0.35 - flap, 0, 6.2832);
      ctx.ellipse(-3, -6, 2.6, 8, -0.3 + flap, 0, 6.2832); ctx.ellipse(-3, 6, 2.6, 8, 0.3 - flap, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = '#4f93a8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-13, 0); ctx.stroke();
      ctx.fillStyle = '#356a7c';
      ctx.beginPath(); ctx.arc(5.5, 0, 2.3, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    /* ---------- coins from the bank, numbers, sparkle ---------- */
    function coin(x, y, r, squash, a) {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#a8873a';
      ctx.beginPath(); ctx.ellipse(x, y, r * squash, r, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#dcbc5e';
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.78 * squash, r * 0.78, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#f3e2a0';
      ctx.beginPath(); ctx.ellipse(x - r * 0.25 * squash, y - r * 0.28, r * 0.28 * squash, r * 0.22, -0.6, 0, 6.2832); ctx.fill();
    }
    // coins lying in the water; drawn before the ripples so the surface plays over them
    function drawSunk() {
      var cs = game.tossed, life = S.T.coinLife, i;
      for (i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (c.fly < 1) continue;
        var a = clamp((life - c.age) / 6, 0, 1) * 0.92;
        var h = game.grid.sample(game.gx(c.x), game.gy(c.y));
        var x = c.x + h * 5, y = c.y + h * 5;
        ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#02060a';
        ctx.beginPath(); ctx.ellipse(x + 2, y + 3.5, c.r, c.r, 0, 0, 6.2832); ctx.fill();
        coin(x, y, c.r, 1, a);
      }
      ctx.globalAlpha = 1;
    }
    // a glint now and then so a waiting coin catches the eye, and coins still in the air
    function drawTossed() {
      var cs = game.tossed, life = S.T.coinLife, i;
      for (i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (c.fly < 1) {
          var up = Math.sin(c.fly * Math.PI);
          ctx.globalAlpha = 0.28 * (1 - up * 0.5); ctx.fillStyle = '#02060a';
          ctx.beginPath(); ctx.ellipse(c.x + 6 + up * 26, c.y + 9 + up * 40, c.r * (1 + up * 0.5), c.r * (1 + up * 0.5), 0, 0, 6.2832); ctx.fill();
          if (c.food) {
            var fs = 1 + up * 0.8, fk;
            ctx.fillStyle = '#b9925a';
            for (fk = 0; fk < 4; fk++) { ctx.beginPath(); ctx.arc(c.x + Math.cos(c.ph + fk * 1.7) * 7 * fs, c.y + Math.sin(c.ph * 1.3 + fk * 2.1) * 6 * fs, 2.6 * fs, 0, 6.2832); ctx.fill(); }
          } else coin(c.x, c.y, c.r * (1 + up * 0.9), 0.25 + 0.75 * Math.abs(Math.cos(c.ph * 6)), 1);
        } else {
          var g = Math.pow(Math.max(0, Math.sin(c.ph * 0.9)), 6) * clamp((life - c.age) / 6, 0, 1);
          if (g > 0.02) {
            var x = c.x - c.r * 0.3, y = c.y - c.r * 0.3, L = c.r * 1.5 * g;
            ctx.globalAlpha = g; ctx.strokeStyle = '#fff6d6'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    /* ---------- visitors: people seen from above, walking in, throwing, walking out ---------- */
    var SHIRTS = ['#8a5a4a', '#5f7a8a', '#7a7f5a', '#9a8a6a', '#6a5a7a', '#b0a590', '#4f6a5a', '#a06a5a'];
    var HAIR = ['#2a2623', '#3a2c22', '#4a3a2c', '#8d8a80', '#1c1a18'];
    function oval(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill(); }
    function drawVisitors() {
      var vs = game.keeper ? game.visitors.concat([game.keeper]) : game.visitors, cam = game.cam, i;
      for (i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v.x < cam.x - 60 || v.x > cam.x + W + 60 || v.y < cam.y - 60 || v.y > cam.y + H + 60) continue;
        var rng = Wt.mulberry32(v.seed), shirt = SHIRTS[(rng() * SHIRTS.length) | 0], hair = HAIR[(rng() * HAIR.length) | 0];
        var hat = rng() < 0.35, sc = 1.05 + rng() * 0.25, walking = v.state === 'walk', sw = walking ? Math.sin(v.phase) : 0;
        if (v.keeper) { shirt = '#3b5878'; hair = '#2a2623'; hat = true; sc = 1.3; }   // the caretaker: indigo coat, wide straw hat
        var fade = 1, gi;
        for (gi = 0; gi < S.GATES.length; gi++) fade = Math.min(fade, Math.hypot(v.x - S.GATES[gi].x, v.y - S.GATES[gi].y) / 110);
        fade = clamp(fade, 0, 1);
        var reach = v.throwT > 0 ? Math.sin(v.throwT * Math.PI) : 0;
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(v.x, v.y);
        ctx.fillStyle = 'rgba(2,6,10,0.30)'; oval(8, 12, 21 * sc, 17 * sc);
        ctx.rotate(v.a); ctx.scale(sc, sc);
        ctx.fillStyle = '#26221f'; oval(sw * 9 + 2, -7, 7, 4.2); oval(-sw * 9 + 2, 7, 7, 4.2);          // feet
        ctx.fillStyle = '#c9a58a'; oval(-sw * 7 + 2, -18, 4.6, 4.6);                                   // hands
        oval(sw * 7 + 2 + reach * 20, 18 - reach * 9, 4.6, 4.6);
        if (reach > 0.05) { ctx.strokeStyle = shirt; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(reach * 16, 17 - reach * 8); ctx.stroke(); }
        ctx.fillStyle = shirt; oval(0, 0, 10.5, 19.5);                                                 // shoulders
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; oval(-4, 0, 6, 17);
        ctx.fillStyle = hair; oval(2, 0, 8.6, 8.6);                                                    // head
        if (hat) { ctx.fillStyle = '#c8b68a'; oval(2, 0, v.keeper ? 16 : 13.5, v.keeper ? 16 : 13.5); ctx.fillStyle = '#a8956a'; oval(2, 0, v.keeper ? 4 : 6.5, v.keeper ? 4 : 6.5); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- the cat ---------- */
    function drawCat() {
      var c = game.cat, cam = game.cam;
      if (!c || c.x < cam.x - 60 || c.x > cam.x + W + 60 || c.y < cam.y - 60 || c.y > cam.y + H + 60) return;
      var nap = c.state === 'nap', walk = c.state === 'walk', t = c.phase, sw = walk ? Math.sin(t * 9) : 0;
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(2,6,10,0.30)'; oval(5, 8, 17, 13);
      ctx.rotate(c.a);
      ctx.strokeStyle = '#b97a3f'; ctx.lineWidth = 5; ctx.lineCap = 'round';          // tail: curled when asleep, swaying when not
      ctx.beginPath(); ctx.moveTo(-12, 0);
      if (nap) ctx.quadraticCurveTo(-22, 15, -2, 16);
      else ctx.quadraticCurveTo(-25, Math.sin(t * 2.2) * 9, -33, Math.sin(t * 2.2 + 1) * 13 - c.purr * 6);
      ctx.stroke();
      if (walk) { ctx.fillStyle = '#b97a3f'; oval(8 + sw * 5, -8, 4, 3); oval(8 - sw * 5, 8, 4, 3); oval(-8 - sw * 5, -8, 4, 3); oval(-8 + sw * 5, 8, 4, 3); }
      var breathe = nap ? Math.sin(t * 1.4) * 0.6 : 0;
      ctx.fillStyle = '#d59a55'; oval(0, 0, nap ? 13 : 15, (nap ? 12 : 10) + breathe);    // body
      ctx.fillStyle = '#efe6d4'; oval(-4, 3, 6, 4);                                        // a white patch
      ctx.fillStyle = '#b97a3f'; oval(3, -4, 5, 3);
      var hx = nap ? 9 : 14, hy = nap ? 7 : 0;
      ctx.fillStyle = '#b97a3f';                                                          // ears
      ctx.beginPath(); ctx.moveTo(hx + 1, hy - 6); ctx.lineTo(hx + 7, hy - 11); ctx.lineTo(hx + 7, hy - 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx + 1, hy + 6); ctx.lineTo(hx + 7, hy + 11); ctx.lineTo(hx + 7, hy + 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d59a55'; oval(hx, hy, 8, 7.5);                                     // head
      ctx.fillStyle = '#efe6d4'; oval(hx + 5, hy, 3.4, 4);
      if (!nap) { ctx.fillStyle = '#1c1a18'; oval(hx + 4, hy - 3.2, 1.2, 1.2); oval(hx + 4, hy + 3.2, 1.2, 1.2); }
      ctx.restore();
    }

    /* ---------- moods: every pond after the first is its own kind of place ---------- */
    var MOOD = {
      lotus: { ground: '120,100,120', ga: 0.12, water: '110,70,110', wa: 0.13 },
      maple: { ground: '150,84,44', ga: 0.22, water: '110,64,30', wa: 0.15 },
      snow: { ground: '228,234,240', ga: 0.66, water: '150,180,200', wa: 0.22 },
      lantern: { ground: '8,10,26', ga: 0.46, water: '6,8,30', wa: 0.42 },
      spring: { ground: '96,150,90', ga: 0.24, water: '70,150,120', wa: 0.17 }
    };
    function moodPonds() {
      var out = [], ws = game.waterAreas(), i;
      for (i = 0; i < ws.length; i++) { var th = S.themeOf(ws[i].id); if (MOOD[th]) out.push({ id: ws[i].id, sh: S.SHAPES[ws[i].id], th: th, m: MOOD[th] }); }
      return out;
    }
    function moodWash(ps, onWater) {
      for (var i = 0; i < S.BIOMES.length; i++) {
        var b = S.BIOMES[i], m = MOOD[b.id];
        if (!m || !game.sections(b.id)) continue;
        var cx = (b.c0 + 1) * AW, cy = (b.r0 + 1) * AH;
        if (onWater) { ctx.fillStyle = 'rgba(' + m.water + ',' + m.wa + ')'; ctx.fillRect(cx - AW, cy - AH, 2 * AW, 2 * AH); continue; }
        // the ground takes the pond's colour too, fading out toward its neighbours
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, AH / AW);
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, AW * 1.45);
        g.addColorStop(0, 'rgba(' + m.ground + ',' + m.ga + ')'); g.addColorStop(0.82, 'rgba(' + m.ground + ',' + m.ga + ')'); g.addColorStop(1, 'rgba(' + m.ground + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, AW * 1.45, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }
    /* What floats on a pond of each mood. Drawn inside the water. */
    function moodFloat(ps) {
      var cam = game.cam, t = game.time, i, k;
      for (i = 0; i < ps.length; i++) {
        var q = ps[i], sh = q.sh;
        if (sh.cx < cam.x - 900 || sh.cx > cam.x + W + 900 || sh.cy < cam.y - 600 || sh.cy > cam.y + H + 600) continue;
        var rng = Wt.mulberry32(900 + sh.cx + sh.cy * 3), n = q.th === 'maple' ? 30 : q.th === 'lotus' ? 16 : q.th === 'lantern' ? 13 : q.th === 'spring' ? 22 : 9;
        for (k = 0; k < n; k++) {
          var p0 = [sh.cx + (rng() - 0.5) * 1560, sh.cy + (rng() - 0.5) * 960], ph = rng() * 6.283, sz = rng();
          var x = p0[0] + Math.sin(t * 0.13 + ph) * 16, y = p0[1] + Math.cos(t * 0.11 + ph * 1.7) * 12;
          if (game.depth(x, y) < 24) continue;
          var h = game.grid.sample(game.gx(x), game.gy(y)); x += h * 6; y += h * 6;
          if (q.th === 'maple') {                      // fallen leaves, turning slowly
            ctx.save(); ctx.translate(x, y); ctx.rotate(ph + t * 0.08);
            ctx.fillStyle = ['#a8503a', '#c06a3a', '#8a3c2c', '#c98a3a'][k % 4];
            ctx.beginPath(); ctx.ellipse(0, 0, 7 + sz * 3, 3.2, 0, 0, 6.2832); ctx.ellipse(0, 0, 3.2, 6 + sz * 3, 0.5, 0, 6.2832); ctx.fill();
            ctx.restore();
          } else if (q.th === 'lotus') {               // open blossoms riding the water
            var pr = 11 + sz * 6, f;
            for (f = 0; f < 8; f++) { var fa = f * 0.785 + ph; ctx.fillStyle = f % 2 ? '#f0d6da' : '#d59aa8'; ctx.beginPath(); ctx.ellipse(x + Math.cos(fa) * pr * 0.5, y + Math.sin(fa) * pr * 0.5, pr * 0.55, pr * 0.24, fa, 0, 6.2832); ctx.fill(); }
            ctx.fillStyle = '#c9a85c'; ctx.beginPath(); ctx.arc(x, y, pr * 0.2, 0, 6.2832); ctx.fill();
          } else if (q.th === 'lantern') {             // paper lanterns set afloat
            var fl = 0.85 + 0.15 * Math.sin(t * 5 + ph * 9);
            var g = ctx.createRadialGradient(x, y, 0, x, y, 78);
            g.addColorStop(0, 'rgba(255,200,120,' + (0.42 * fl).toFixed(3) + ')'); g.addColorStop(0.35, 'rgba(255,170,90,' + (0.13 * fl).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,170,90,0)');
            ctx.fillStyle = g; ctx.fillRect(x - 80, y - 80, 160, 160);
            ctx.save(); ctx.translate(x, y); ctx.rotate(ph);
            ctx.fillStyle = '#5b4632'; ctx.fillRect(-9, -9, 18, 18);
            ctx.fillStyle = 'rgba(255,226,170,' + fl.toFixed(3) + ')'; ctx.fillRect(-6.5, -6.5, 13, 13);
            ctx.restore();
          } else if (q.th === 'spring') {              // bright new weed, and light on the water
            ctx.fillStyle = k % 3 ? '#7fae5c' : '#9cc474';
            ctx.beginPath(); ctx.arc(x, y, 3 + sz * 3, 0, 6.2832); ctx.arc(x + 6, y + 3, 2.5 + sz * 2, 0, 6.2832); ctx.arc(x - 3, y + 6, 2.5, 0, 6.2832); ctx.fill();
          } else {                                     // snow: thin plates of ice
            ctx.fillStyle = 'rgba(226,236,242,' + (0.16 + sz * 0.14).toFixed(3) + ')';
            ctx.beginPath(); ctx.ellipse(x, y, 30 + sz * 40, 18 + sz * 22, ph, 0, 6.2832); ctx.fill();
            ctx.strokeStyle = 'rgba(240,246,250,0.28)'; ctx.lineWidth = 1.2; ctx.stroke();
          }
        }
      }
    }
    /* Snow falling, when the pond in view is a snowy one. */
    function drawSnowfall() {
      var cam = game.cam, a = game.areaUnder(cam.x + W / 2, cam.y + H / 2), t = game.time, i;
      if (game.kindOf(a.id) !== 'pond' || S.themeOf(a.id) !== 'snow') return;
      ctx.fillStyle = 'rgba(245,248,252,0.8)';
      for (i = 0; i < 90; i++) {
        var sp = 26 + (i % 7) * 7, x = cam.x + (((i * 137.5 + Math.sin(t * 0.6 + i) * 22 + t * 9) % W) + W) % W, y = cam.y + ((i * 71.3 + t * sp) % H);
        ctx.beginPath(); ctx.arc(x, y, 1.3 + (i % 3) * 0.8, 0, 6.2832); ctx.fill();
      }
    }

    /* ---------- what ties the garden together: paths, trees, lanterns, the wall and its gates ---------- */
    var gravelPat = null, scene = null;
    function buildScene() {
      var T2 = 256, cv = document.createElement('canvas'), c = cv.getContext('2d'), rng = Wt.mulberry32(303), i, k;
      cv.width = cv.height = T2;
      c.fillStyle = '#4c4d43'; c.fillRect(0, 0, T2, T2);
      for (i = 0; i < 900; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(220,214,196,0.13)' : 'rgba(10,12,10,0.2)'; c.fillRect(rng() * T2, rng() * T2, 1.5 + rng() * 2, 1.5 + rng() * 2); }
      gravelPat = ctx.createPattern(cv, 'repeat');

      var WW = S.COLS * AW, WH = S.ROWS * AH, SH = S.SHAPES;
      scene = { paths: [], stones: [], trees: [], lamps: [] };
      function curve(ax, ay, bx, by, bend) {
        var mx = (ax + bx) / 2, my = (ay + by) / 2, d = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / d, ny = (bx - ax) / d, pts = [], t;
        var cx = mx + nx * bend, cy = my + ny * bend, n = Math.ceil(d / 24);
        for (t = 0; t <= n; t++) {
          var u = t / n;
          pts.push([(1 - u) * (1 - u) * ax + 2 * u * (1 - u) * cx + u * u * bx, (1 - u) * (1 - u) * ay + 2 * u * (1 - u) * cy + u * u * by]);
        }
        var path = new Path2D(); path.moveTo(ax, ay); path.quadraticCurveTo(cx, cy, bx, by);
        scene.paths.push({ path: path, pts: pts });
      }
      for (i = 0; i < S.PATHS.length; i++) {
        var A = SH[S.PATHS[i][0]], B = SH[S.PATHS[i][1]];
        curve(A.cx, A.cy, B.cx, B.cy, (rng() - 0.5) * 110);
      }
      var gateTo = ['p34', 'p20', 'p02', 'p52'];
      for (i = 0; i < S.GATES.length; i++) curve(S.GATES[i].x - Math.cos(S.GATES[i].a) * 60, S.GATES[i].y - Math.sin(S.GATES[i].a) * 60, SH[gateTo[i]].cx, SH[gateTo[i]].cy, (rng() - 0.5) * 60);
      function inShape(x, y, k2) {
        for (var id in SH) { var q = SH[id]; if (S.inBlob({ cx: q.cx, cy: q.cy, rx: q.rx * k2, ry: q.ry * k2, lobes: q.lobes }, x, y)) return true; }
        return false;
      }
      function nearPath(x, y, lim) {
        for (var a = 0; a < scene.paths.length; a++) {
          var ps = scene.paths[a].pts;
          for (var b = 0; b < ps.length; b += 2) if (Math.abs(ps[b][0] - x) < lim && Math.abs(ps[b][1] - y) < lim && Math.hypot(ps[b][0] - x, ps[b][1] - y) < lim) return true;
        }
        return false;
      }
      function nearChannel() { return false; }   // channels run under the paths, which the trees already keep off
      // stepping stones down the middle of each path, and a stone lantern here and there beside it
      for (i = 0; i < scene.paths.length; i++) {
        var ps = scene.paths[i].pts;
        for (k = 1; k < ps.length - 1; k += 2) {
          if (inShape(ps[k][0], ps[k][1], 1.04)) continue;
          var ang = Math.atan2(ps[k + 1][1] - ps[k - 1][1], ps[k + 1][0] - ps[k - 1][0]);
          scene.stones.push({ x: ps[k][0] + (rng() - 0.5) * 8, y: ps[k][1] + (rng() - 0.5) * 8, a: ang + 1.57 + (rng() - 0.5) * 0.4, L: 20 + rng() * 6, w: 12 + rng() * 4, c: (rng() * 3) | 0 });
          if (k % 14 === 7) {
            var side = (i + k) % 4 < 2 ? 1 : -1, lx = ps[k][0] - Math.sin(ang) * 62 * side, ly = ps[k][1] + Math.cos(ang) * 62 * side;
            if (!inShape(lx, ly, 1.1) && !nearChannel(lx, ly)) scene.lamps.push({ x: lx, y: ly });
          }
        }
      }
      // trees and shrubs wherever there is open ground
      var KINDS = ['maple', 'maple', 'pine', 'pine', 'cherry', 'bush', 'bush', 'bush'];
      for (i = 0; i < 4000 && scene.trees.length < 430; i++) {
        var x = 110 + rng() * (WW - 220), y = 110 + rng() * (WH - 220), kind = KINDS[(rng() * KINDS.length) | 0];
        var R = kind === 'bush' ? 24 + rng() * 18 : 48 + rng() * 40, okay = true;
        if (inShape(x, y, 1.0 + (R + 50) / 500) || nearPath(x, y, R + 104)) continue;
        for (k = 0; k < scene.trees.length; k++) if (Math.hypot(scene.trees[k].x - x, scene.trees[k].y - y) < (scene.trees[k].R + R) * 0.8) { okay = false; break; }
        for (k = 0; k < S.GATES.length; k++) if (Math.hypot(S.GATES[k].x - x, S.GATES[k].y - y) < 240) okay = false;
        if (okay) scene.trees.push({ x: x, y: y, R: R, kind: kind, seed: (rng() * 1e9) | 0 });
      }
      scene.trees.sort(function (a, b) { return a.y - b.y; });
    }
    function drawPaths() {
      var i, cam = game.cam, cols = ['#6f736b', '#7b7f76', '#666a63'];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (i = 0; i < scene.paths.length; i++) { ctx.strokeStyle = 'rgba(12,16,13,0.38)'; ctx.lineWidth = 86; ctx.stroke(scene.paths[i].path); }
      for (i = 0; i < scene.paths.length; i++) { ctx.strokeStyle = gravelPat; ctx.lineWidth = 70; ctx.stroke(scene.paths[i].path); }
      for (i = 0; i < scene.stones.length; i++) {
        var st = scene.stones[i];
        if (st.x < cam.x - 40 || st.x > cam.x + W + 40 || st.y < cam.y - 40 || st.y > cam.y + H + 40) continue;
        ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.a);
        ctx.fillStyle = 'rgba(2,6,10,0.28)'; oval(2, 4, st.L, st.w);
        ctx.fillStyle = cols[st.c]; oval(0, 0, st.L, st.w);
        ctx.fillStyle = 'rgba(215,220,208,0.14)'; oval(-3, -2, st.L - 6, st.w - 5);
        ctx.restore();
      }
    }
    var CANOPY = {
      maple: ['#7a4433', '#96553a', '#a8663f', '#b97a4a'],
      cherry: ['#b88d95', '#cba5ab', '#dcbcc0', '#ecd6d8'],
      bush: ['#3a5738', '#466841', '#52784a', '#628a56']
    };
    function nearStation(x, y, lim) {
      for (var n = 0; n < S.STATIONS.length; n++) if (Math.abs(S.STATIONS[n].x - x) < lim && Math.abs(S.STATIONS[n].y - y) < lim) return true;
      return false;
    }
    function drawTreeShadows() {
      var cam = game.cam, i;
      ctx.fillStyle = 'rgba(2,6,10,0.26)';
      for (i = 0; i < scene.trees.length; i++) {
        var t = scene.trees[i];
        if (t.x < cam.x - 160 || t.x > cam.x + W + 160 || t.y < cam.y - 160 || t.y > cam.y + H + 160) continue;
        if (game.depth(t.x, t.y) > -(t.R * 0.5 + 16) || nearStation(t.x, t.y, t.R + 70)) continue;   // no tree in the water, or over a station
        oval(t.x + t.R * 0.3, t.y + t.R * 0.42, t.R * 1.02, t.R * 0.9);
        if (t.kind === 'cherry') {                     // fallen petals
          var rng = Wt.mulberry32(t.seed + 9), k;
          ctx.fillStyle = 'rgba(236,214,216,0.55)';
          for (k = 0; k < 26; k++) { var a = rng() * 6.283, d = t.R * (0.9 + rng() * 0.9); oval(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d * 0.9, 2.4, 1.6); }
          ctx.fillStyle = 'rgba(2,6,10,0.26)';
        }
      }
    }
    function drawTrees() {
      var cam = game.cam, i, k;
      for (i = 0; i < scene.trees.length; i++) {
        var t = scene.trees[i], R = t.R;
        if (t.x < cam.x - 160 || t.x > cam.x + W + 160 || t.y < cam.y - 160 || t.y > cam.y + H + 160) continue;
        if (game.depth(t.x, t.y) > -(t.R * 0.5 + 16) || nearStation(t.x, t.y, t.R + 70)) continue;   // no tree in the water, or over a station
        var rng = Wt.mulberry32(t.seed), sway = Math.sin(game.time * 0.6 + t.seed % 7) * 2.5;
        var x = t.x + sway, y = t.y + sway * 0.4;
        if (t.kind === 'pine') {
          var n = 9, rot = rng() * 6.283;
          for (var layer = 0; layer < 3; layer++) {
            var rr = R * (1 - layer * 0.28);
            ctx.fillStyle = ['#24382d', '#2e4636', '#3a5641'][layer];
            ctx.beginPath();
            for (k = 0; k < n * 2; k++) {
              var a = rot + layer * 0.35 + k * Math.PI / n, d = k % 2 ? rr * 0.55 : rr;
              ctx.lineTo(x + sway * layer * 0.4 + Math.cos(a) * d, y + Math.sin(a) * d);
            }
            ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = '#4a6a4e'; oval(x + sway, y, R * 0.14, R * 0.14);
        } else {
          var cols = CANOPY[t.kind], m = t.kind === 'bush' ? 6 : 9;
          for (k = 0; k < m; k++) {
            var a2 = rng() * 6.283, d2 = R * (0.15 + rng() * 0.5), r2 = R * (0.42 + rng() * 0.22);
            ctx.fillStyle = cols[k < 3 ? 0 : 1 + (k % 2)];
            oval(x + Math.cos(a2) * d2, y + Math.sin(a2) * d2, r2, r2 * 0.92);
          }
          for (k = 0; k < 4; k++) {                    // light on the upper left
            var a3 = 3.5 + rng() * 1.4, d3 = R * (0.2 + rng() * 0.4);
            ctx.fillStyle = cols[3]; ctx.globalAlpha = 0.55;
            oval(x + Math.cos(a3) * d3, y + Math.sin(a3) * d3, R * 0.2, R * 0.16);
            ctx.globalAlpha = 1;
          }
        }
      }
    }
    function drawLamps() {
      var cam = game.cam, i;
      for (i = 0; i < scene.lamps.length; i++) {
        var l = scene.lamps[i];
        if (l.x < cam.x - 240 || l.x > cam.x + W + 240 || l.y < cam.y - 240 || l.y > cam.y + H + 240) continue;
        if (game.depth(l.x, l.y) > -24) continue;
        ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.fillRect(l.x - 11 + 4, l.y - 11 + 6, 22, 22);
        ctx.fillStyle = '#74776f'; ctx.fillRect(l.x - 12, l.y - 12, 24, 24);
        ctx.fillStyle = '#8b8e85'; ctx.fillRect(l.x - 8, l.y - 8, 16, 16);
        ctx.fillStyle = '#5f625b'; ctx.fillRect(l.x - 4, l.y - 4, 8, 8);
        lanterns.push([l.x, l.y]);
      }
    }
    function drawWall() {
      var WW = S.COLS * AW, WH = S.ROWS * AH, t = S.WALL, gap = 120, i;
      // beyond the wall: the dark of the woods
      ctx.fillStyle = '#0f1512';
      ctx.fillRect(-4000, -4000, WW + 8000, 4000); ctx.fillRect(-4000, WH, WW + 8000, 4000);
      ctx.fillRect(-4000, 0, 4000, WH); ctx.fillRect(WW, 0, 4000, WH);
      function run(x, y, w, h) {
        ctx.fillStyle = 'rgba(2,6,10,0.28)'; ctx.fillRect(x + 8, y + 12, w, h);
        ctx.fillStyle = '#8f897a'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#3f4744';
        if (w > h) ctx.fillRect(x, y + h / 2 - 9, w, 18); else ctx.fillRect(x + w / 2 - 9, y, 18, h);
        ctx.fillStyle = 'rgba(210,216,206,0.18)';
        if (w > h) ctx.fillRect(x, y + h / 2 - 9, w, 3); else ctx.fillRect(x + w / 2 - 9, y, 3, h);
      }
      run(0, 0, WW / 2 - gap, t); run(WW / 2 + gap, 0, WW / 2 - gap, t);
      run(0, WH - t, WW / 2 - gap, t); run(WW / 2 + gap, WH - t, WW / 2 - gap, t);
      run(0, 0, t, WH / 2 - gap); run(0, WH / 2 + gap, t, WH / 2 - gap);
      run(WW - t, 0, t, WH / 2 - gap); run(WW - t, WH / 2 + gap, t, WH / 2 - gap);
      // a gate in each side: two posts and a beam, the red of old lacquer
      for (i = 0; i < S.GATES.length; i++) {
        var g = S.GATES[i];
        ctx.save(); ctx.translate(g.x - Math.cos(g.a) * t / 2, g.y - Math.sin(g.a) * t / 2); ctx.rotate(g.a + Math.PI / 2);
        ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.fillRect(-gap - 22 + 8, -13 + 12, gap * 2 + 44, 26);
        ctx.fillStyle = '#7d4a3c'; ctx.fillRect(-gap - 22, -13, gap * 2 + 44, 26);
        ctx.fillStyle = '#96604e'; ctx.fillRect(-gap - 22, -13, gap * 2 + 44, 5);
        ctx.fillStyle = '#3a2a1c'; ctx.fillRect(-gap - 12, -24, 30, 48); ctx.fillRect(gap - 18, -24, 30, 48);
        ctx.fillStyle = '#5b4632'; ctx.fillRect(-gap - 7, -19, 20, 38); ctx.fillRect(gap - 13, -19, 20, 38);
        ctx.restore();
      }
    }

    function drawFloaters() {
      var fs = game.floaters, i;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (i = 0; i < fs.length; i++) {
        var f = fs[i];
        ctx.globalAlpha = clamp(1.6 - f.age * 1.3, 0, 1);
        ctx.font = (f.kind === 'grow' ? '14px' : '17px') + ' Georgia, serif';
        ctx.fillStyle = 'rgba(8,12,18,0.7)'; ctx.fillText(f.text, f.x + 1, f.y + 1.5);
        ctx.fillStyle = f.kind === 'grow' ? '#cfe3c4' : '#e8cd82'; ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }
    function drawSparks() {
      var sp = game.sparks, i, k;
      for (i = 0; i < sp.length; i++) {
        var s = sp[i], t = s.age / 1.8, R = 18 + t * 46;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = 'rgba(240,228,190,0.7)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.8, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = '#f3e6b8';
        for (k = 0; k < 9; k++) {
          var a = k * 0.698 + t * 1.2;
          ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R, 2.2 * (1 - t) + 0.6, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawOffer() {
      var h = game.hand;
      if (!h.offer) return;
      var pulse = 0.5 + 0.5 * Math.sin(game.time * 3);
      ctx.strokeStyle = 'rgba(220,192,138,' + (0.25 + 0.2 * pulse).toFixed(2) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(h.x, h.y, 16 + pulse * 3, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = '#b9925a';
      ctx.beginPath(); ctx.arc(h.x - 3, h.y + 1, 2.6, 0, 6.2832); ctx.arc(h.x + 3, h.y - 1, 2.4, 0, 6.2832); ctx.arc(h.x, h.y + 4, 2.2, 0, 6.2832); ctx.fill();
    }

    /* ---------- the zen garden: a sheet of sand you can rake ---------- */
    var zens = {}, zen = null, zctx = null, AW = S.AW, AH = S.AH, sandDirty = {};
    var SAND = '#b3a88d', SAND_D = 'rgba(84,74,54,0.42)', SAND_L = 'rgba(232,224,200,0.42)';
    function zenOf(id) {
      if (!zens[id]) { buildZen(); zens[id] = { cv: zen, c: zctx }; }
      return zens[id];
    }
    function buildZen() {
      zen = document.createElement('canvas'); zen.width = AW; zen.height = AH;
      zctx = zen.getContext('2d');
      var rng = Wt.mulberry32(23), i, y;
      zctx.fillStyle = SAND; zctx.fillRect(0, 0, AW, AH);
      for (i = 0; i < 2600; i++) {
        zctx.fillStyle = rng() < 0.5 ? 'rgba(70,62,46,0.10)' : 'rgba(240,232,208,0.10)';
        zctx.fillRect(rng() * AW, rng() * AH, 1.5 + rng() * 1.5, 1.5 + rng() * 1.5);
      }
      // freshly raked: long straight furrows
      for (y = 12; y < AH; y += 11) {
        zctx.strokeStyle = SAND_D; zctx.lineWidth = 1.6;
        zctx.beginPath(); zctx.moveTo(0, y); zctx.lineTo(AW, y); zctx.stroke();
        zctx.strokeStyle = SAND_L; zctx.lineWidth = 1.2;
        zctx.beginPath(); zctx.moveTo(0, y + 2.4); zctx.lineTo(AW, y + 2.4); zctx.stroke();
      }
      // a few islands of moss
      for (i = 0; i < 5; i++) {
        var mx = AW * (0.3 + rng() * 0.4), my = AH * (0.34 + rng() * 0.32), k;
        for (k = 0; k < 7; k++) {
          zctx.fillStyle = k < 3 ? '#44603f' : (rng() < 0.5 ? '#537349' : '#4a6943');
          zctx.beginPath(); zctx.ellipse(mx + (rng() - 0.5) * 70, my + (rng() - 0.5) * 44, 22 + rng() * 26, 15 + rng() * 16, rng() * 3, 0, 6.2832); zctx.fill();
        }
      }
    }
    /* Pull a five-tined rake from one point to another. World coordinates. */
    function rake(x0, y0, x1, y1) {
      var za = game.areaUnder(x1, y1), ox = za.col * AW, oy = za.row * AH, t;
      if (game.kindOf(za.id) !== 'zen') return;
      var zctx = zenOf(za.id).c;
      x0 -= ox; x1 -= ox; y0 -= oy; y1 -= oy;
      var dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
      if (d < 0.5) return;
      sandDirty[za.id] = true;
      var nx = -dy / d, ny = dx / d;
      zctx.save();
      zctx.lineCap = 'round';
      zctx.strokeStyle = SAND; zctx.lineWidth = 50;
      zctx.beginPath(); zctx.moveTo(x0, y0); zctx.lineTo(x1, y1); zctx.stroke();
      for (t = -2; t <= 2; t++) {
        var px = nx * t * 10, py = ny * t * 10;
        zctx.strokeStyle = SAND_D; zctx.lineWidth = 2;
        zctx.beginPath(); zctx.moveTo(x0 + px, y0 + py); zctx.lineTo(x1 + px, y1 + py); zctx.stroke();
        zctx.strokeStyle = SAND_L; zctx.lineWidth = 1.3;
        zctx.beginPath(); zctx.moveTo(x0 + px + 1.6, y0 + py + 2.2); zctx.lineTo(x1 + px + 1.6, y1 + py + 2.2); zctx.stroke();
      }
      zctx.restore();
    }

    /* ---------- things for the garden ---------- */
    function sandRings(at, R) {
      if (!game.onSand(at.x, at.y)) return;
      for (var i = 1; i <= 3; i++) {
        ctx.strokeStyle = SAND_D; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.ellipse(at.x, at.y, R + i * 11, (R + i * 11) * 0.86, 0, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = SAND_L; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(at.x + 1.5, at.y + 2.2, R + i * 11, (R + i * 11) * 0.86, 0, 0, 6.2832); ctx.stroke();
      }
    }
    function drawStone(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), R = 26 + rng() * 12;
      sandRings(at, R * 1.15);
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(at.a + rng() * 0.6);
      ctx.fillStyle = 'rgba(2,6,10,0.3)';
      ctx.beginPath(); ctx.ellipse(10, 16, R * 1.15, R * 0.8, 0.3, 0, 6.2832); ctx.fill();
      var g = ctx.createLinearGradient(-R, -R, R, R);
      g.addColorStop(0, '#8a8f88'); g.addColorStop(1, '#4b524f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-R * 0.9, R * 0.2); ctx.quadraticCurveTo(-R * 0.8, -R * 0.9, 0, -R * 0.8);
      ctx.quadraticCurveTo(R * 1.0, -R * 0.7, R * 0.95, R * 0.1); ctx.quadraticCurveTo(R * 0.7, R * 0.85, -R * 0.1, R * 0.75);
      ctx.quadraticCurveTo(-R * 0.8, R * 0.8, -R * 0.9, R * 0.2); ctx.fill();
      ctx.strokeStyle = 'rgba(210,214,204,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-R * 0.5, -R * 0.45); ctx.quadraticCurveTo(0, -R * 0.2, R * 0.2, R * 0.4); ctx.stroke();
      ctx.restore();
    }
    function drawBonsai(pl) {
      var at = game.plantAt(pl), rng = Wt.mulberry32(pl.seed), i;
      sandRings(at, 34);
      ctx.fillStyle = 'rgba(2,6,10,0.3)';
      ctx.beginPath(); ctx.ellipse(at.x + 12, at.y + 18, 46, 34, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#5a463a'; ctx.beginPath(); ctx.ellipse(at.x, at.y, 22, 16, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#3c3029'; ctx.beginPath(); ctx.ellipse(at.x, at.y, 17, 11, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#4a382c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.quadraticCurveTo(at.x + 16, at.y - 6, at.x + 20, at.y - 22); ctx.stroke();
      for (i = 0; i < 7; i++) {
        var a = rng() * 6.283, d = rng() * 26;
        ctx.fillStyle = i < 3 ? '#34513a' : (rng() < 0.5 ? '#42643f' : '#4d7147');
        ctx.beginPath(); ctx.ellipse(at.x + 14 + Math.cos(a) * d, at.y - 16 + Math.sin(a) * d * 0.8, 15 + rng() * 9, 11 + rng() * 7, a, 0, 6.2832); ctx.fill();
      }
    }
    function drawBench(pl) {
      var at = game.plantAt(pl);
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(at.a);
      ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.fillRect(-52 + 7, -15 + 11, 104, 30);
      ctx.fillStyle = '#5b5f59'; ctx.fillRect(-44, -17, 14, 34); ctx.fillRect(30, -17, 14, 34);
      ctx.fillStyle = '#8b8f86'; ctx.fillRect(-54, -14, 108, 28);
      ctx.fillStyle = '#9ea298'; ctx.fillRect(-54, -14, 108, 5);
      ctx.restore();
    }
    function drawPagoda(pl) {
      var at = game.plantAt(pl), i, sz = [46, 34, 23, 12];
      sandRings(at, 54);
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(at.a);
      ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(-46 + 12, -46 + 18, 92, 92);
      for (i = 0; i < sz.length; i++) {
        var z = sz[i];
        ctx.fillStyle = ['#63675f', '#787c73', '#8d9187', '#a5a99e'][i]; ctx.fillRect(-z, -z, 2 * z, 2 * z);
        ctx.strokeStyle = 'rgba(40,44,40,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(-z, -z, 2 * z, 2 * z);
        if (i < 3) { ctx.beginPath(); ctx.moveTo(-z, -z); ctx.lineTo(-sz[i + 1], -sz[i + 1]); ctx.moveTo(z, -z); ctx.lineTo(sz[i + 1], -sz[i + 1]);
          ctx.moveTo(-z, z); ctx.lineTo(-sz[i + 1], sz[i + 1]); ctx.moveTo(z, z); ctx.lineTo(sz[i + 1], sz[i + 1]); ctx.stroke(); }
      }
      ctx.fillStyle = '#c6b77a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    var lanterns = [];
    function drawItem(pl) {
      var t = pl.type;
      if (t === 'reed') drawReed(pl);
      else if (t === 'iris') drawIris(pl);
      else if (t === 'spout') drawSpout(pl);
      else if (t === 'lantern') lanterns.push(drawLantern(pl));
      else if (t === 'rock') drawRock(pl);
      else if (t === 'duckweed') drawDuckweed(pl);
      else if (t === 'stone') drawStone(pl);
      else if (t === 'bonsai') drawBonsai(pl);
      else if (t === 'bench') drawBench(pl);
      else if (t === 'pagoda') drawPagoda(pl);
    }

    /* ---------- the garden: ground, shaped water, stone banks, bridges ---------- */
    var landPat = null;
    function buildLand() {
      var T = 512, cv = document.createElement('canvas'), c = cv.getContext('2d'), rng = Wt.mulberry32(77), i, ox, oy;
      cv.width = cv.height = T;
      c.fillStyle = '#222c26'; c.fillRect(0, 0, T, T);
      // soft patches of moss, drawn nine times over so the tile has no seam
      for (i = 0; i < 44; i++) {
        var x = rng() * T, y = rng() * T, r = 30 + rng() * 80, light = rng() < 0.55;
        for (ox = -1; ox <= 1; ox++) for (oy = -1; oy <= 1; oy++) {
          var g = c.createRadialGradient(x + ox * T, y + oy * T, 0, x + ox * T, y + oy * T, r);
          g.addColorStop(0, light ? 'rgba(74,98,70,0.20)' : 'rgba(10,16,14,0.24)');
          g.addColorStop(1, light ? 'rgba(74,98,70,0)' : 'rgba(10,16,14,0)');
          c.fillStyle = g; c.fillRect(x + ox * T - r, y + oy * T - r, 2 * r, 2 * r);
        }
      }
      for (i = 0; i < 520; i++) {
        c.fillStyle = rng() < 0.5 ? 'rgba(120,150,110,0.10)' : 'rgba(0,0,0,0.14)';
        c.fillRect(rng() * T, rng() * T, 1.5 + rng() * 2, 1.5 + rng() * 2);
      }
      c.lineCap = 'round';
      for (i = 0; i < 90; i++) {       // little tufts
        var tx = 8 + rng() * (T - 16), ty = 8 + rng() * (T - 16), a = -1.57 + (rng() - 0.5) * 1.2, L = 4 + rng() * 5;
        c.strokeStyle = rng() < 0.5 ? 'rgba(96,126,86,0.35)' : 'rgba(70,100,70,0.35)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + Math.cos(a) * L, ty + Math.sin(a) * L); c.stroke();
      }
      landPat = ctx.createPattern(cv, 'repeat');
    }

    // paths and stones are worked out once for the ponds that are open, and again when another opens
    var shapeKey = null, waterPath = null, bankPath = null, zenPath = null, stones = [];
    function blobPath(id) {
      var pts = S.outline(id, 200), path = new Path2D(), i;
      path.moveTo(pts[0][0], pts[0][1]);
      for (i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
      return { path: path, pts: pts };
    }
    function shapes() {
      if (shapeKey === game.shapeKey && waterPath) return;
      shapeKey = game.shapeKey;
      waterPath = new Path2D(); bankPath = waterPath; stones = [];
      var loops = game.shore(), i, k, rng = Wt.mulberry32(5);
      for (i = 0; i < loops.length; i++) {
        var lp = loops[i], n = lp.length, since = 0;
        // a smooth line through the middle of each step of the shore
        waterPath.moveTo((lp[n - 1][0] + lp[0][0]) / 2, (lp[n - 1][1] + lp[0][1]) / 2);
        for (k = 0; k < n; k++) {
          var p0 = lp[k], p1 = lp[(k + 1) % n];
          waterPath.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
          since += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (since > 34) {
            // a stone on the bank, set a little back from the water
            since = -rng() * 14;
            var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, inw = game.inward(mx, my);
            stones.push({ x: mx - inw[0] * 8, y: my - inw[1] * 8, a: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + (rng() - 0.5) * 0.3,
                          L: 16 + rng() * 9, w: 9 + rng() * 5, c: (rng() * 3) | 0 });
          }
        }
        waterPath.closePath();
      }
    }
    function drawStones() {
      var cam = game.cam, i, cols = ['#5d635e', '#6a706a', '#545a56'];
      for (i = 0; i < stones.length; i++) {
        var st = stones[i];
        if (st.x < cam.x - 40 || st.x > cam.x + W + 40 || st.y < cam.y - 40 || st.y > cam.y + H + 40) continue;
        ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.a);
        ctx.fillStyle = 'rgba(2,6,10,0.3)';
        ctx.beginPath(); ctx.ellipse(2, 4, st.L, st.w, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = cols[st.c];
        ctx.beginPath(); ctx.ellipse(0, 0, st.L, st.w, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(205,210,200,0.15)';
        ctx.beginPath(); ctx.ellipse(-2, -2, st.L - 5, st.w - 4, 0, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }
    function drawSand() {
      for (var id in game.lots) {
        if (game.lots[id].kind !== 'zen') continue;
        var za = S.areaById(id), path = blobPath(id).path;
        ctx.save(); ctx.clip(path);
        ctx.drawImage(zenOf(id).cv, za.col * AW, za.row * AH);
        ctx.strokeStyle = 'rgba(40,34,22,0.35)'; ctx.lineWidth = 26; ctx.stroke(path);
        ctx.restore();
        ctx.strokeStyle = '#3b423f'; ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.stroke(path);
        ctx.strokeStyle = 'rgba(160,166,156,0.35)'; ctx.lineWidth = 2; ctx.stroke(path);
      }
    }
    function drawBridge(x, y, len, vertical) {
      var wide = 78, yy;
      ctx.save(); ctx.translate(x, y); if (!vertical) ctx.rotate(-Math.PI / 2);
      // from here the bridge runs down the y axis, centred on x = 0
      ctx.fillStyle = 'rgba(2,6,10,0.30)'; ctx.fillRect(-wide / 2 + (vertical ? 12 : -16), vertical ? 16 : 12, wide, len);
      ctx.fillStyle = '#6b5038'; ctx.fillRect(-wide / 2, 0, wide, len);
      var g = ctx.createLinearGradient(-wide / 2, 0, wide / 2, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.5, 'rgba(255,230,190,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g; ctx.fillRect(-wide / 2, 0, wide, len);
      ctx.strokeStyle = 'rgba(30,20,12,0.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (yy = 20; yy < len; yy += 20) { ctx.moveTo(-wide / 2 + 7, yy); ctx.lineTo(wide / 2 - 7, yy); }
      ctx.stroke();
      ctx.fillStyle = '#4a3625'; ctx.fillRect(-wide / 2, 0, 8, len); ctx.fillRect(wide / 2 - 8, 0, 8, len);
      ctx.fillStyle = '#8a6a4a'; ctx.fillRect(-wide / 2 + 1, 0, 2.5, len); ctx.fillRect(wide / 2 - 7, 0, 2.5, len);
      ctx.fillStyle = '#3a2a1c';
      for (yy = 20; yy < len; yy += 70) { ctx.fillRect(-wide / 2 - 3, yy - 6, 14, 12); ctx.fillRect(wide / 2 - 11, yy - 6, 14, 12); }
      ctx.restore();
    }
    /* Where two ponds have run together there is still a way across: stepping stones out from each bank,
       and a wooden bridge over the deep middle. Koi swim under and between. */
    /* The headland where a pond's four sections meet: a mound of moss and stones with a pine and a lantern.
       A cape while the pond is small; an island once all four sections are open. */
    function drawHeadlands() {
      var cam = game.cam, i, k;
      for (i = 0; i < S.BIOMES.length; i++) {
        var b = S.BIOMES[i];
        if (!game.sections(b.id)) continue;
        var x = (b.c0 + 1) * AW, y = (b.r0 + 1) * AH, rng = Wt.mulberry32(61 + i * 13);
        if (x < cam.x - 500 || x > cam.x + W + 500 || y < cam.y - 400 || y > cam.y + H + 400) continue;
        for (k = 0; k < 16; k++) {                    // moss
          var a = rng() * 6.283, d = Math.sqrt(rng()), mx = x + Math.cos(a) * d * 250, my = y + Math.sin(a) * d * 165;
          if (game.depth(mx, my) > -26) continue;
          ctx.fillStyle = ['#3a5738', '#466841', '#34503a'][k % 3];
          ctx.beginPath(); ctx.ellipse(mx, my, 40 + rng() * 40, 28 + rng() * 26, rng() * 3, 0, 6.2832); ctx.fill();
        }
        for (k = 0; k < 5; k++) {                     // a few standing stones
          var sa = rng() * 6.283, sx = x + Math.cos(sa) * 150, sy = y + Math.sin(sa) * 95, sr = 16 + rng() * 14;
          if (game.depth(sx, sy) > -30) continue;
          ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 5, sy + 8, sr * 1.2, sr * 0.9, 0.3, 0, 6.2832); ctx.fill();
          ctx.fillStyle = k % 2 ? '#6d7571' : '#5b6360'; ctx.beginPath(); ctx.ellipse(sx, sy, sr * 1.15, sr * 0.85, rng() * 3, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(210,216,204,0.16)'; ctx.beginPath(); ctx.ellipse(sx - 4, sy - 4, sr * 0.6, sr * 0.4, 0, 0, 6.2832); ctx.fill();
        }
        // a stone lantern, lit after dusk
        var lx = x + 70, ly = y + 40;
        ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.fillRect(lx - 13 + 5, ly - 13 + 8, 26, 26);
        ctx.fillStyle = '#74776f'; ctx.fillRect(lx - 14, ly - 14, 28, 28);
        ctx.fillStyle = '#8b8e85'; ctx.fillRect(lx - 9, ly - 9, 18, 18);
        ctx.fillStyle = '#5f625b'; ctx.fillRect(lx - 4, ly - 4, 8, 8);
        lanterns.push([lx, ly]);
        // an old pine, leaning out over the water
        var sway = Math.sin(game.time * 0.5 + i) * 2.5, px = x - 60 + sway, py = y - 30, R = 96, n = 9, layer;
        ctx.fillStyle = 'rgba(2,6,10,0.28)'; ctx.beginPath(); ctx.ellipse(px + R * 0.3, py + R * 0.42, R, R * 0.88, 0, 0, 6.2832); ctx.fill();
        for (layer = 0; layer < 3; layer++) {
          var rr = R * (1 - layer * 0.28);
          ctx.fillStyle = ['#24382d', '#2e4636', '#3a5641'][layer];
          ctx.beginPath();
          for (k = 0; k < n * 2; k++) { var pa = 0.4 + layer * 0.35 + k * Math.PI / n, pd = k % 2 ? rr * 0.55 : rr; ctx.lineTo(px + sway * layer * 0.4 + Math.cos(pa) * pd, py + Math.sin(pa) * pd); }
          ctx.closePath(); ctx.fill();
        }
      }
    }

    /* ---------- the market and the planted plots: painted once each, then kept ---------- */
    var feats = {};
    function feature(id) {
      var kind = game.kindOf(id), level = game.lots[id].level, key = id + kind + level;
      if (feats[key]) return feats[key];
      var a = S.areaById(id), cv = document.createElement('canvas'), c = cv.getContext('2d');
      cv.width = AW; cv.height = AH;
      var pts = S.outline(id, 160), ox = a.col * AW, oy = a.row * AH, cx = AW / 2, cy = AH / 2, i, k;
      var rng = Wt.mulberry32(101 + a.col * 17 + a.row * 31);
      function blob() {
        c.beginPath(); c.moveTo(pts[0][0] - ox, pts[0][1] - oy);
        for (var n = 1; n < pts.length; n++) c.lineTo(pts[n][0] - ox, pts[n][1] - oy);
        c.closePath();
      }
      function inside() { var t = rng() * 6.283, r = Math.sqrt(rng()) * 0.94, p = S.blobPoint(S.SHAPES[id], t, r); return [p[0] - ox, p[1] - oy]; }
      function shadow(x, y, w, h) { c.fillStyle = 'rgba(2,6,10,0.32)'; c.fillRect(x + 10, y + 14, w, h); }
      function edge(col) { blob(); c.strokeStyle = col; c.lineWidth = 10; c.lineJoin = 'round'; c.stroke(); c.strokeStyle = 'rgba(190,196,186,0.22)'; c.lineWidth = 2; c.stroke(); }

      if (kind === 'market') {
        blob(); c.fillStyle = '#54574f'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 620; i++) {                 // cobbles
          var q = inside();
          c.fillStyle = ['rgba(120,124,114,0.5)', 'rgba(70,74,68,0.55)', 'rgba(98,102,94,0.5)'][(rng() * 3) | 0];
          c.beginPath(); c.ellipse(q[0], q[1], 9 + rng() * 9, 6 + rng() * 6, rng() * 3, 0, 6.2832); c.fill();
        }
        c.restore();
        edge('#3b3f3a');
        // the shop: a tiled roof seen from above, with a striped awning along the front
        var bx = cx - 290, by = cy - 215, bw = 580, bh = 165;
        shadow(bx, by, bw, bh + 52);
        c.fillStyle = '#4b3a2f'; c.fillRect(bx, by, bw, bh);
        c.strokeStyle = 'rgba(20,14,10,0.35)'; c.lineWidth = 1.5; c.beginPath();
        for (k = by + 12; k < by + bh; k += 12) { c.moveTo(bx, k); c.lineTo(bx + bw, k); }
        c.stroke();
        c.fillStyle = 'rgba(255,225,190,0.10)'; c.fillRect(bx, by + bh / 2 - 6, bw, 12);
        c.fillStyle = '#2f241d'; c.fillRect(bx, by + bh / 2 - 2, bw, 4);
        for (k = 0; k * 40 < bw; k++) { c.fillStyle = k % 2 ? '#d8cdb6' : '#7d4a3c'; c.fillRect(bx + k * 40, by + bh, Math.min(40, bw - k * 40), 52); }
        c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(bx, by + bh, bw, 9);
        c.fillStyle = '#d8cdb6'; c.fillRect(cx - 92, by + 26, 184, 42);
        c.strokeStyle = '#2f241d'; c.lineWidth = 2; c.strokeRect(cx - 92, by + 26, 184, 42);
        c.fillStyle = '#2b221b'; c.font = '24px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MARKET', cx, by + 48);
        // stalls out front
        for (k = -1; k <= 1; k++) {
          var sx = cx + k * 190 - 70, sy = cy + 40;
          shadow(sx, sy, 140, 58);
          c.fillStyle = '#6b5038'; c.fillRect(sx, sy, 140, 58);
          c.strokeStyle = 'rgba(30,20,12,0.4)'; c.beginPath(); c.moveTo(sx, sy + 19); c.lineTo(sx + 140, sy + 19); c.moveTo(sx, sy + 39); c.lineTo(sx + 140, sy + 39); c.stroke();
          for (i = 0; i < 3; i++) {
            var tx = sx + 26 + i * 44, ty = sy + 29;
            if (k === 0) {                              // tubs of koi
              c.fillStyle = '#3a2a1c'; c.beginPath(); c.arc(tx, ty, 19, 0, 6.2832); c.fill();
              c.fillStyle = '#23474a'; c.beginPath(); c.arc(tx, ty, 15, 0, 6.2832); c.fill();
              c.fillStyle = ['#c47a45', '#d8d1be', '#c6a565'][i]; c.beginPath(); c.ellipse(tx + 2, ty - 1, 8, 3, 0.6 + i, 0, 6.2832); c.fill();
            } else {                                    // baskets of flowers and reeds
              c.fillStyle = '#8a6a4a'; c.beginPath(); c.arc(tx, ty, 18, 0, 6.2832); c.fill();
              c.fillStyle = '#5b4632'; c.beginPath(); c.arc(tx, ty, 14, 0, 6.2832); c.fill();
              for (var d2 = 0; d2 < 7; d2++) {
                c.fillStyle = k < 0 ? ['#d59aa8', '#f0d6da', '#e3d9cd'][d2 % 3] : ['#8a78c0', '#6c8d55', '#a493d6'][d2 % 3];
                c.beginPath(); c.arc(tx + (rng() - 0.5) * 18, ty + (rng() - 0.5) * 18, 3.6, 0, 6.2832); c.fill();
              }
            }
          }
        }
        for (k = 1; k <= 1; k += 2) {                 // a barrel (the notice board stands on the other side)
          c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.arc(cx + k * 330 + 6, cy - 60 + 9, 26, 0, 6.2832); c.fill();
          c.fillStyle = '#6b5038'; c.beginPath(); c.arc(cx + k * 330, cy - 60, 26, 0, 6.2832); c.fill();
          c.strokeStyle = '#3a2a1c'; c.lineWidth = 3; c.beginPath(); c.arc(cx + k * 330, cy - 60, 19, 0, 6.2832); c.stroke();
        }
      } else if (kind === 'moss') {
        blob(); c.fillStyle = '#2d4330'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 90; i++) {
          var m = inside(), mr = 26 + rng() * 44;
          c.fillStyle = ['#3a5738', '#466841', '#52784a', '#34503a'][(rng() * 4) | 0];
          c.beginPath(); c.ellipse(m[0], m[1], mr, mr * (0.6 + rng() * 0.3), rng() * 3, 0, 6.2832); c.fill();
          c.fillStyle = 'rgba(150,190,130,0.10)';
          c.beginPath(); c.ellipse(m[0] - mr * 0.2, m[1] - mr * 0.2, mr * 0.5, mr * 0.3, 0, 0, 6.2832); c.fill();
        }
        for (i = 0; i < 13; i++) {                  // stepping stones winding through
          var px = cx - 380 + i * 63, py = cy + Math.sin(i * 0.75) * 90;
          c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.ellipse(px + 3, py + 5, 24, 17, 0.2, 0, 6.2832); c.fill();
          c.fillStyle = i % 2 ? '#6a706a' : '#5d635e'; c.beginPath(); c.ellipse(px, py, 24, 17, 0.2 + rng() * 0.4, 0, 6.2832); c.fill();
        }
        c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.arc(cx + 126, cy - 104, 44, 0, 6.2832); c.fill();   // a stone basin
        c.fillStyle = '#74776f'; c.beginPath(); c.arc(cx + 120, cy - 112, 44, 0, 6.2832); c.fill();
        c.fillStyle = '#1d3a3d'; c.beginPath(); c.arc(cx + 120, cy - 112, 31, 0, 6.2832); c.fill();
        c.strokeStyle = 'rgba(206,226,220,0.4)'; c.lineWidth = 2; c.beginPath(); c.arc(cx + 120, cy - 112, 20, 3.4, 4.6); c.stroke();
        c.restore();
        edge('#243627');
      } else if (kind === 'bamboo') {
        blob(); c.fillStyle = '#242f24'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 400; i++) { var lf = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(150,140,90,0.16)' : 'rgba(0,0,0,0.18)'; c.fillRect(lf[0], lf[1], 5, 2); }
        for (i = 0; i < 58; i++) {
          var b2 = inside();
          c.fillStyle = 'rgba(2,6,10,0.28)'; c.beginPath(); c.ellipse(b2[0] + 12, b2[1] + 18, 38, 30, 0, 0, 6.2832); c.fill();
          for (k = 0; k < 11; k++) {
            var la = rng() * 6.283, ll = 26 + rng() * 24;
            c.fillStyle = ['#557a44', '#6a9052', '#47683b', '#7ba25e'][(rng() * 4) | 0];
            c.beginPath(); c.ellipse(b2[0] + Math.cos(la) * ll * 0.55, b2[1] + Math.sin(la) * ll * 0.55, ll * 0.5, 5, la, 0, 6.2832); c.fill();
          }
          c.fillStyle = '#9aa56a'; c.beginPath(); c.arc(b2[0], b2[1], 5.5, 0, 6.2832); c.fill();
          c.strokeStyle = '#4c5630'; c.lineWidth = 1.5; c.stroke();
        }
        c.restore();
        edge('#1c261d');
      } else if (kind === 'tea') {
        blob(); c.fillStyle = '#5c5b52'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 1500; i++) { var gv = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(200,196,180,0.16)' : 'rgba(20,20,16,0.2)'; c.fillRect(gv[0], gv[1], 2.5, 2.5); }
        for (i = 0; i < 7; i++) {                   // stones up to the door
          c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.ellipse(cx - 360 + i * 44 + 3, cy + 150 - i * 12 + 5, 22, 15, 0, 0, 6.2832); c.fill();
          c.fillStyle = '#74776f'; c.beginPath(); c.ellipse(cx - 360 + i * 44, cy + 150 - i * 12, 22, 15, rng() * 0.5, 0, 6.2832); c.fill();
        }
        c.restore();
        edge('#3c3d37');
        shadow(cx - 200, cy - 170, 400, 330);        // the veranda
        c.fillStyle = '#6b5038'; c.fillRect(cx - 200, cy - 170, 400, 330);
        c.strokeStyle = 'rgba(30,20,12,0.4)'; c.lineWidth = 1.5; c.beginPath();
        for (k = cx - 200 + 22; k < cx + 200; k += 22) { c.moveTo(k, cy - 170); c.lineTo(k, cy + 160); }
        c.stroke();
        var rx0 = cx - 150, ry0 = cy - 130, rw = 300, rh = 220, mx2 = cx, my2 = cy - 20;   // a hipped roof
        var faces = [[[rx0, ry0], [rx0 + rw, ry0], '#4b5451'], [[rx0 + rw, ry0], [rx0 + rw, ry0 + rh], '#3a4240'],
                     [[rx0 + rw, ry0 + rh], [rx0, ry0 + rh], '#333a38'], [[rx0, ry0 + rh], [rx0, ry0], '#434b48']];
        for (k = 0; k < 4; k++) {
          c.fillStyle = faces[k][2]; c.beginPath(); c.moveTo(faces[k][0][0], faces[k][0][1]); c.lineTo(faces[k][1][0], faces[k][1][1]); c.lineTo(mx2, my2); c.closePath(); c.fill();
        }
        c.strokeStyle = 'rgba(20,24,22,0.6)'; c.lineWidth = 2; c.beginPath();
        c.moveTo(rx0, ry0); c.lineTo(mx2, my2); c.lineTo(rx0 + rw, ry0); c.moveTo(rx0, ry0 + rh); c.lineTo(mx2, my2); c.lineTo(rx0 + rw, ry0 + rh); c.stroke();
        c.strokeRect(rx0, ry0, rw, rh);
        c.fillStyle = '#c6b77a'; c.beginPath(); c.arc(mx2, my2, 6, 0, 6.2832); c.fill();
        c.fillStyle = '#3a2a1c'; c.fillRect(cx - 40, cy + 108, 80, 34);                      // a low table and cushions
        c.fillStyle = '#7d4a3c'; c.beginPath(); c.arc(cx - 78, cy + 125, 15, 0, 6.2832); c.arc(cx + 78, cy + 125, 15, 0, 6.2832); c.fill();
      } else if (kind === 'dango') {
        blob(); c.fillStyle = '#585145'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 900; i++) { var dg = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(210,196,160,0.14)' : 'rgba(20,16,10,0.2)'; c.fillRect(dg[0], dg[1], 3, 3); }
        c.restore();
        edge('#3a352c');
        shadow(cx - 150, cy - 150, 300, 150);            // the stall: a red roof and a striped awning
        c.fillStyle = '#7d4a3c'; c.fillRect(cx - 150, cy - 150, 300, 110);
        c.fillStyle = '#96604e'; c.fillRect(cx - 150, cy - 150, 300, 8);
        for (k = 0; k * 30 < 300; k++) { c.fillStyle = k % 2 ? '#d8cdb6' : '#b0705c'; c.fillRect(cx - 150 + k * 30, cy - 40, 30, 40); }
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(cx - 150, cy - 40, 300, 7);
        c.strokeStyle = '#8a6a4a'; c.lineWidth = 5; c.lineCap = 'round';   // three dumplings on a stick, for a sign
        c.beginPath(); c.moveTo(cx - 62, cy - 96); c.lineTo(cx + 66, cy - 96); c.stroke();
        var dc = ['#d59aa8', '#efe6d4', '#8fae6c'];
        for (k = 0; k < 3; k++) { c.fillStyle = dc[k]; c.beginPath(); c.arc(cx - 36 + k * 36, cy - 96, 19, 0, 6.2832); c.fill(); c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(cx - 42 + k * 36, cy - 102, 6, 0, 6.2832); c.fill(); }
        for (k = 0; k < 9; k++) { c.fillStyle = k % 2 ? '#c8604a' : '#e0b05a'; c.beginPath(); c.arc(cx - 136 + k * 34, cy + 10, 8, 0, 6.2832); c.fill(); }   // paper lanterns
        for (k = -1; k <= 1; k += 2) {                    // benches with a red cloth
          shadow(cx + k * 200 - 60, cy + 70, 120, 40);
          c.fillStyle = '#6b5038'; c.fillRect(cx + k * 200 - 60, cy + 70, 120, 40);
          c.fillStyle = '#9a4a3c'; c.fillRect(cx + k * 200 - 44, cy + 70, 88, 40);
        }
      } else if (kind === 'hatchery') {
        blob(); c.fillStyle = '#4f524c'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 1100; i++) { var hg = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(200,204,196,0.13)' : 'rgba(10,14,12,0.2)'; c.fillRect(hg[0], hg[1], 2.5, 2.5); }
        c.restore();
        edge('#343833');
        shadow(cx - 230, cy - 200, 460, 150);            // a long shed
        c.fillStyle = '#566a6e'; c.fillRect(cx - 230, cy - 200, 460, 150);
        c.strokeStyle = 'rgba(16,24,26,0.4)'; c.lineWidth = 1.5; c.beginPath();
        for (k = cx - 230 + 20; k < cx + 230; k += 20) { c.moveTo(k, cy - 200); c.lineTo(k, cy - 50); }
        c.stroke();
        c.fillStyle = '#3d4d50'; c.fillRect(cx - 230, cy - 129, 460, 8);
        for (k = 0; k < 8; k++) {                         // rearing tubs, with fry in them
          var tx2 = cx - 255 + (k % 4) * 170, ty2 = cy + 30 + Math.floor(k / 4) * 120;
          c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.arc(tx2 + 6, ty2 + 9, 52, 0, 6.2832); c.fill();
          c.fillStyle = '#3a2a1c'; c.beginPath(); c.arc(tx2, ty2, 52, 0, 6.2832); c.fill();
          c.fillStyle = '#1f4347'; c.beginPath(); c.arc(tx2, ty2, 44, 0, 6.2832); c.fill();
          for (i = 0; i < 6; i++) { c.fillStyle = ['#c9c7b8', '#c47a45', '#d8d1be'][i % 3]; c.beginPath(); c.ellipse(tx2 + (rng() - 0.5) * 56, ty2 + (rng() - 0.5) * 56, 7, 2.6, rng() * 6.28, 0, 6.2832); c.fill(); }
          c.strokeStyle = 'rgba(206,226,220,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(tx2, ty2, 30, 3.4, 4.5); c.stroke();
        }
      } else if (kind === 'nursery') {
        blob(); c.fillStyle = '#38402f'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 700; i++) { var ng = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(120,150,100,0.14)' : 'rgba(10,12,8,0.22)'; c.fillRect(ng[0], ng[1], 3, 3); }
        for (k = 0; k < 5; k++) {                         // planted beds
          var by2 = cy + 40 + k * 46;
          c.fillStyle = '#2b241c'; c.fillRect(cx - 330, by2, 660, 26);
          for (i = 0; i < 26; i++) {
            c.fillStyle = [['#d59aa8', '#f0d6da'], ['#8a78c0', '#a493d6'], ['#6c8d55', '#8fae6c'], ['#e3d9cd', '#c9a85c'], ['#6c8d55', '#557a44']][k][i % 2];
            c.beginPath(); c.arc(cx - 318 + i * 25.5, by2 + 13 + (rng() - 0.5) * 6, 7, 0, 6.2832); c.fill();
          }
        }
        c.restore();
        edge('#262c20');
        shadow(cx - 210, cy - 210, 420, 190);            // the glasshouse
        c.fillStyle = '#7fa3a0'; c.fillRect(cx - 210, cy - 210, 420, 190);
        c.fillStyle = 'rgba(70,110,70,0.5)'; c.fillRect(cx - 196, cy - 196, 392, 162);
        c.strokeStyle = '#dfe6dc'; c.lineWidth = 3; c.strokeRect(cx - 210, cy - 210, 420, 190);
        c.lineWidth = 2; c.beginPath();
        for (k = cx - 210 + 60; k < cx + 210; k += 60) { c.moveTo(k, cy - 210); c.lineTo(k, cy - 20); }
        c.moveTo(cx - 210, cy - 115); c.lineTo(cx + 210, cy - 115); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.moveTo(cx - 210, cy - 210); c.lineTo(cx - 60, cy - 210); c.lineTo(cx - 210, cy - 80); c.fill();
      } else if (kind === 'shrine') {
        blob(); c.fillStyle = '#6a685c'; c.fill();
        c.save(); blob(); c.clip();
        for (i = 0; i < 1500; i++) { var sg = inside(); c.fillStyle = rng() < 0.5 ? 'rgba(226,220,200,0.16)' : 'rgba(20,20,16,0.2)'; c.fillRect(sg[0], sg[1], 2.5, 2.5); }
        for (k = 0; k < 7; k++) {                         // flagstones up the middle
          c.fillStyle = 'rgba(2,6,10,0.25)'; c.fillRect(cx - 44 + 3, cy + 250 - k * 56 + 5, 88, 46);
          c.fillStyle = k % 2 ? '#8b8e85' : '#7d8078'; c.fillRect(cx - 44, cy + 250 - k * 56, 88, 46);
        }
        c.restore();
        edge('#45443b');
        shadow(cx - 150, cy - 250, 300, 190);            // the hall: a dark roof with a gold ridge
        c.fillStyle = '#343a38'; c.fillRect(cx - 150, cy - 250, 300, 190);
        c.fillStyle = '#434b48'; c.fillRect(cx - 150, cy - 250, 300, 92);
        c.fillStyle = '#c6b77a'; c.fillRect(cx - 150, cy - 160, 300, 6);
        c.fillStyle = '#2a2f2d'; c.fillRect(cx - 176, cy - 76, 352, 26);
        c.fillStyle = '#5b4632'; c.fillRect(cx - 34, cy - 34, 68, 40);                 // the offering box
        c.strokeStyle = '#3a2a1c'; c.lineWidth = 2; c.beginPath();
        for (k = cx - 26; k < cx + 30; k += 10) { c.moveTo(k, cy - 34); c.lineTo(k, cy + 6); }
        c.stroke();
        shadow(cx - 130, cy + 96, 260, 22);              // the gate, seen from above
        c.fillStyle = '#a0483a'; c.fillRect(cx - 130, cy + 96, 260, 22);
        c.fillStyle = '#b86050'; c.fillRect(cx - 130, cy + 96, 260, 5);
        c.fillStyle = '#6e2f26'; c.fillRect(cx - 104, cy + 86, 26, 42); c.fillRect(cx + 78, cy + 86, 26, 42);
        for (k = -1; k <= 1; k += 2) {                    // stone lanterns
          shadow(cx + k * 210 - 16, cy - 16, 32, 32);
          c.fillStyle = '#74776f'; c.fillRect(cx + k * 210 - 17, cy - 17, 34, 34);
          c.fillStyle = '#8b8e85'; c.fillRect(cx + k * 210 - 11, cy - 11, 22, 22);
          c.fillStyle = '#e8cd82'; c.fillRect(cx + k * 210 - 5, cy - 5, 10, 10);
        }
      }
      // a gold pennant for each level
      for (k = 0; k < level && kind !== 'pond'; k++) {
        var px2 = cx - a.rx * 0.62 + k * 34, py2 = cy - a.ry * 0.52;
        c.fillStyle = 'rgba(2,6,10,0.3)'; c.beginPath(); c.arc(px2 + 3, py2 + 5, 6, 0, 6.2832); c.fill();
        c.fillStyle = '#3a2a1c'; c.beginPath(); c.arc(px2, py2, 5, 0, 6.2832); c.fill();
        c.fillStyle = '#dcbc5e'; c.beginPath(); c.moveTo(px2, py2 - 4); c.lineTo(px2 + 24, py2 + 4); c.lineTo(px2, py2 + 12); c.closePath(); c.fill();
      }
      feats[key] = cv;
      return cv;
    }
    function drawFeatures() {
      for (var id in game.lots) {
        var kd = game.lots[id].kind, a = S.areaById(id);
        if (kd !== 'pond' && kd !== 'zen') ctx.drawImage(feature(id), a.col * AW, a.row * AH);
      }
    }
    /* Stations: a book stand and a signpost by the Home Pond, a notice board and three stalls at the Market.
       Each has its name under it, and glints when it has something for you. */
    var calm = 0;   // 0 while you are busy, 1 when the screen has been left alone: labels and badges fade out
    function plate(x, y, text) {
      if (calm > 0.96) return;
      ctx.globalAlpha = 1 - calm;
      ctx.font = '15px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = ctx.measureText(text).width + 24;
      ctx.fillStyle = 'rgba(16,22,30,0.88)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 13, w, 26, 13); ctx.fill();
      ctx.strokeStyle = 'rgba(233,228,216,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e9e4d8'; ctx.fillText(text, x, y + 1);
      ctx.globalAlpha = 1;
    }
    function drawStations(ui) {
      var cam = game.cam, i, k;
      for (i = 0; i < S.STATIONS.length; i++) {
        var st = S.STATIONS[i], x = st.x, y = st.y;
        if (x < cam.x - 120 || x > cam.x + W + 120 || y < cam.y - 120 || y > cam.y + H + 120) continue;
        if (st.id === 'koi') {                           // a stand with an open book
          ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(x - 30 + 6, y - 24 + 9, 60, 46);
          ctx.fillStyle = '#5b4632'; ctx.fillRect(x - 30, y - 24, 60, 46);
          ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x - 30, y + 16, 60, 6);
          ctx.fillStyle = '#e9e1cc'; ctx.fillRect(x - 24, y - 19, 23, 32); ctx.fillRect(x + 1, y - 19, 23, 32);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - 1, y - 19, 2, 32);
          ctx.fillStyle = '#c47a45'; ctx.beginPath(); ctx.ellipse(x - 12, y - 6, 8, 3.4, 0.5, 0, 6.2832); ctx.fill();
          ctx.fillStyle = '#6f8791'; ctx.beginPath(); ctx.ellipse(x + 13, y - 8, 8, 3.4, -0.4, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = 'rgba(60,50,40,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (k = 0; k < 3; k++) { ctx.moveTo(x - 20, y + 2 + k * 4); ctx.lineTo(x - 5, y + 2 + k * 4); ctx.moveTo(x + 5, y + 1 + k * 4); ctx.lineTo(x + 20, y + 1 + k * 4); }
          ctx.stroke();
        } else if (st.id === 'map') {                    // a signpost: three boards pointing different ways
          ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.beginPath(); ctx.ellipse(x + 7, y + 10, 34, 26, 0, 0, 6.2832); ctx.fill();
          var cols = ['#7d4a3c', '#6b5038', '#8a6a4a'], angs = [-0.5, 2.3, 0.9];
          for (k = 0; k < 3; k++) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(angs[k]);
            ctx.fillStyle = cols[k]; ctx.beginPath(); ctx.moveTo(4, -9); ctx.lineTo(34, -9); ctx.lineTo(44, 0); ctx.lineTo(34, 9); ctx.lineTo(4, 9); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,235,200,0.25)'; ctx.fillRect(8, -6, 24, 2.5);
            ctx.restore();
          }
          ctx.fillStyle = '#3a2a1c'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.2832); ctx.fill();
          ctx.fillStyle = '#8a6a4a'; ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 4, 0, 6.2832); ctx.fill();
        } else if (st.id === 'gate') {                   // the ticket gate: a little booth, a rail, and the cash box
          ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(x - 88 + 6, y - 20 + 9, 60, 44);
          ctx.fillStyle = '#7d4a3c'; ctx.fillRect(x - 88, y - 20, 60, 44);             // booth roof
          ctx.fillStyle = '#96604e'; ctx.fillRect(x - 88, y - 20, 60, 6);
          ctx.fillStyle = '#d8cdb6'; ctx.fillRect(x - 80, y + 6, 44, 10);              // counter
          ctx.fillStyle = '#3a2a1c';                                                   // rail and posts either side of the way in
          ctx.fillRect(x - 20, y - 3, 6, 6); ctx.fillRect(x + 88, y - 3, 6, 6);
          ctx.fillRect(x + 30, y - 2, 60, 4);
          ctx.strokeStyle = '#a0483a'; ctx.lineWidth = 4; ctx.lineCap = 'round';       // the bar across
          ctx.beginPath(); ctx.moveTo(x - 17, y); ctx.lineTo(x + 22, y - 10); ctx.stroke();
          var cap = game.gateCap(), n = Math.floor(game.gate.till), full = game.gate.till >= cap - 0.5;
          var bob = Math.sin(game.time * (full ? 4 : 2)) * (full ? 4 : 2), bx = x - 58, by = y - 46 + bob, txt = n + ' / ' + cap;
          ctx.font = '15px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          var bw = ctx.measureText(txt).width + 44, bal = full ? 1 : 1 - 0.85 * calm;
          ctx.globalAlpha = bal;
          ctx.fillStyle = full ? 'rgba(60,48,20,0.95)' : 'rgba(16,22,30,0.9)'; ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - 15, bw, 30, 15); ctx.fill();
          ctx.strokeStyle = full ? '#e8cd82' : 'rgba(233,228,216,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
          coin(bx - bw / 2 + 16, by, 8, 1, bal);
          ctx.fillStyle = full ? '#e8cd82' : '#e9e4d8'; ctx.fillText(txt, bx + 10, by + 1);
          ctx.globalAlpha = 1;
        } else if (st.id === 'requests') {               // a notice board with notes pinned to it
          ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(x - 38 + 6, y - 28 + 9, 76, 56);
          ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x - 38, y - 28, 76, 56);
          ctx.fillStyle = '#8a6a4a'; ctx.fillRect(x - 33, y - 23, 66, 46);
          var notes = [[-27, -18, 20, 16, -0.08], [-2, -19, 24, 18, 0.06], [-24, 3, 22, 15, 0.05], [3, 4, 22, 14, -0.07]];
          for (k = 0; k < notes.length; k++) {
            var has = !!game.requests[Math.min(k, 2)];
            ctx.save(); ctx.translate(x + notes[k][0] + notes[k][2] / 2, y + notes[k][1] + notes[k][3] / 2); ctx.rotate(notes[k][4]);
            ctx.fillStyle = has ? '#e9e1cc' : 'rgba(233,225,204,0.25)'; ctx.fillRect(-notes[k][2] / 2, -notes[k][3] / 2, notes[k][2], notes[k][3]);
            ctx.fillStyle = '#a0483a'; ctx.beginPath(); ctx.arc(0, -notes[k][3] / 2 + 3, 2, 0, 6.2832); ctx.fill();
            ctx.restore();
          }
        }
        else if (st.id === 'shows') {                    // a show stand: a judging table under a red and white banner, a rosette on top
          ctx.fillStyle = 'rgba(2,6,10,0.32)'; ctx.fillRect(x - 36 + 6, y - 26 + 9, 72, 52);
          ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x - 36, y - 26, 72, 52);
          for (k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#d8cdb6' : '#a0483a'; ctx.fillRect(x - 33 + k * 11, y - 23, 11, 16); }
          ctx.fillStyle = '#23474a'; ctx.beginPath(); ctx.ellipse(x, y + 9, 24, 12, 0, 0, 6.2832); ctx.fill();   // the judging tub
          ctx.fillStyle = '#c47a45'; ctx.beginPath(); ctx.ellipse(x - 3, y + 9, 10, 3.6, 0.3, 0, 6.2832); ctx.fill();
          var won = game.showsWon ? game.showsWon() : 0;
          ctx.fillStyle = '#a0483a'; ctx.beginPath(); ctx.moveTo(x + 22, y - 18); ctx.lineTo(x + 17, y - 2); ctx.lineTo(x + 22, y - 6); ctx.lineTo(x + 27, y - 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = won ? '#dcbc5e' : '#8a6a4a'; ctx.beginPath(); ctx.arc(x + 22, y - 22, 8, 0, 6.2832); ctx.fill();
          ctx.fillStyle = won ? '#a8873a' : '#5b4632'; ctx.beginPath(); ctx.arc(x + 22, y - 22, 3.5, 0, 6.2832); ctx.fill();
        }
        plate(x, y + (st.id === 'gate' ? 44 : st.lot === 'market' && st.id !== 'requests' && st.id !== 'shows' ? 52 : 46), st.name);
        if (ui && ui.marks && ui.marks[st.id]) ripeMark(x + st.w - 22, y - st.h + 14);
      }
    }
    /* Coins waiting in a building's till: a purse floating over it. Tap the building to take them. */
    function drawTills() {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var id in game.lots) {
        var lot = game.lots[id], cap = game.tillCap(id), n = Math.floor(lot.till);
        if (!cap || n < 3) continue;
        var sh = S.SHAPES[id], full = lot.till >= cap - 0.5;
        var tal = full ? 1 : 1 - 0.85 * calm;
        ctx.globalAlpha = tal;
        var bob = Math.sin(game.time * (full ? 4 : 2) + sh.cx) * (full ? 5 : 3), x = sh.cx + sh.rx * 0.42, y = sh.cy - sh.ry * 0.5 + bob, w = 34 + String(n).length * 11;
        ctx.fillStyle = 'rgba(2,6,10,0.3)'; ctx.beginPath(); ctx.roundRect(x - w / 2 + 3, y - 17 + 5, w, 34, 17); ctx.fill();
        ctx.fillStyle = full ? 'rgba(60,48,20,0.95)' : 'rgba(16,22,30,0.9)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 17, w, 34, 17); ctx.fill();
        ctx.strokeStyle = full ? '#e8cd82' : 'rgba(233,228,216,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        coin(x - w / 2 + 17, y, 9, 1, tal);
        ctx.fillStyle = '#e9e4d8'; ctx.font = '16px Georgia, serif'; ctx.fillText(n, x + 10, y + 1);
      }
      ctx.globalAlpha = 1;
    }
    /* Something ready to pick: a slow gold glint. */
    function ripeMark(x, y) {
      var t = game.time * 2.2 + x * 0.01, g = 0.55 + 0.45 * Math.sin(t), L = 9 + 3 * g;
      ctx.globalAlpha = 0.5 + 0.5 * g;
      ctx.fillStyle = 'rgba(243,226,160,0.25)'; ctx.beginPath(); ctx.arc(x, y, 15 + 3 * g, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#fff6d6'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function drawRipe() {
      var i;
      for (i = 0; i < game.plants.length; i++) if (game.plants[i].ripe) ripeMark(game.plants[i].x, game.plants[i].y - 14);
      for (i = 0; i < game.pads.length; i++) if (game.pads[i].ripe) ripeMark(game.pads[i].x - game.pads[i].r * 0.3, game.pads[i].y + game.pads[i].r * 0.22);
    }

    /* Open ground beside what you have: a marked-out bed and a sign saying it can be built on. */
    function drawSigns() {
      var i;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (i = 0; i < S.AREAS.length; i++) {
        var a = S.AREAS[i];
        if (game.lots[a.id] || !game.reachable(a.id)) continue;
        var sh = S.SHAPES[a.id], path = blobPath(a.id).path;
        ctx.globalAlpha = 1 - 0.75 * calm;
        ctx.fillStyle = 'rgba(120,140,120,0.07)'; ctx.fill(path);
        ctx.strokeStyle = 'rgba(233,228,216,0.28)'; ctx.lineWidth = 3; ctx.setLineDash([18, 16]); ctx.stroke(path); ctx.setLineDash([]);
        if (a.biome) {
          // part of a pond: say which pond, who lives in it, and what this section costs
          var bio = S.biomeById(a.biome), cost = game.buildCost(a.id, 'pond'), opening = !game.sections(a.biome);
          ctx.fillStyle = '#e9e4d8'; ctx.font = '30px Georgia, serif'; ctx.fillText(bio.name, sh.cx, sh.cy - 30);
          ctx.fillStyle = '#b5b0a2'; ctx.font = '16px Georgia, serif';
          ctx.fillText(bio.bases ? 'For ' + game.likes(a.biome) + ' koi' : opening ? 'For any koi' : 'More room for your koi', sh.cx, sh.cy + 4);
          ctx.fillStyle = game.coins >= cost ? '#dcbc5e' : '#b5b0a2'; ctx.font = '18px Georgia, serif';
          ctx.fillText((opening ? 'Tap to open · ' : 'Tap to make it bigger · ') + cost + ' coins', sh.cx, sh.cy + 36);
        } else {
          ctx.fillStyle = '#e9e4d8'; ctx.font = '30px Georgia, serif'; ctx.fillText('Open ground', sh.cx, sh.cy - 16);
          ctx.fillStyle = '#dcbc5e'; ctx.font = '18px Georgia, serif'; ctx.fillText('Tap to build here', sh.cx, sh.cy + 22);
        }
        ctx.globalAlpha = 1;
      }
    }

    /* A thing being carried to its place. */
    function drawGhost(gh) {
      ctx.save();
      ctx.globalAlpha = gh.ok ? 0.75 : 0.35;
      if (gh.type === 'pad' || gh.type === 'lotus') {
        ctx.translate(gh.x, gh.y); ctx.fillStyle = '#48684b'; padShape(game.padBase); ctx.fill();
        if (gh.type === 'lotus') drawFlower(game.padBase, true);
      } else {
        var keep = lanterns; lanterns = [];
        drawItem({ type: gh.type, x: gh.x, y: gh.y, a: gh.a, seed: gh.seed });
        lanterns = keep;
      }
      ctx.restore();
      ctx.strokeStyle = gh.ok ? 'rgba(233,228,216,0.7)' : 'rgba(210,120,100,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.arc(gh.x, gh.y, 48, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    }

    function draw(ui) {
      var i, fish = game.koi, plants = game.plants, cam = game.cam, a;
      lanterns = [];
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#14171f'; ctx.fillRect(0, 0, W + 2, H + 2);
      ctx.translate(-cam.x, -cam.y);
      shapes();
      // the garden floor, everywhere
      calm = ui && ui.calm ? ui.calm : 0;
      var moods = moodPonds();
      ctx.fillStyle = landPat; ctx.fillRect(cam.x, cam.y, W, H);
      moodWash(moods, false);
      if (!scene) buildScene();
      drawPaths();
      // water and everything in it, only inside the ponds and channels
      ctx.save(); ctx.clip(waterPath, 'evenodd');
      var ponds = game.waterAreas();
      // one floor for each whole pond, however many of its sections are open, so no join shows in the water
      for (i = 0; i < S.BIOMES.length; i++) if (game.sections(S.BIOMES[i].id)) ctx.drawImage(floor, S.BIOMES[i].c0 * AW, S.BIOMES[i].r0 * AH, 2 * AW, 2 * AH);
      moodWash(moods, true);
      drawSunk();
      // small fish first so the big ones pass over them
      var order = fish.slice().sort(function (p, q) { return p.len - q.len; });
      for (i = 0; i < order.length; i++) {
        var f = order[i];
        if (f.x > cam.x - 150 && f.x < cam.x + W + 150 && f.y > cam.y - 150 && f.y < cam.y + H + 150) drawFish(f);
      }
      ctx.fillStyle = 'rgba(20,46,52,0.2)'; ctx.fillRect(cam.x, cam.y, W, H);
      Wt.shade(game.grid, wimg.data);
      wctx.putImageData(wimg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(wcan, game.gox, game.goy, game.grid.w * game.cx, game.grid.h * game.cy);
      drawPellets();
      for (i = 0; i < plants.length; i++) if (plants[i].type === 'duckweed') drawDuckweed(plants[i]);
      for (i = 0; i < game.pads.length; i++) drawPad(game.pads[i]);
      moodFloat(moods);
      drawFrog();
      // the bank throws a soft shadow onto the water
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(2,6,10,0.20)'; ctx.lineWidth = 46; ctx.stroke(bankPath);
      ctx.strokeStyle = 'rgba(2,6,10,0.30)'; ctx.lineWidth = 18; ctx.stroke(bankPath);
      ctx.restore();
      drawSand();
      drawFeatures();
      drawStones();
      drawHeadlands();
      drawSigns();
      drawStations(ui);
      drawTills();
      drawTreeShadows();
      drawLamps();
      drawTossed();
      // everything else, back to front
      var rest = plants.filter(function (p) { return p.type !== 'duckweed'; }).sort(function (p, q) { return p.y - q.y; });
      for (i = 0; i < rest.length; i++) drawItem(rest[i]);
      drawRipe();
      drawCat();
      drawVisitors();
      drawTrees();
      drawSnowfall();
      drawWall();
      drawFly();
      drawOffer();
      if (ui && ui.ghost) drawGhost(ui.ghost);

      var L = lightAt(game.sitting / 60);
      if (game.rain.amt > 0.01) {
        ctx.fillStyle = 'rgba(38,48,66,' + (0.12 * game.rain.amt).toFixed(3) + ')';
        ctx.fillRect(cam.x, cam.y, W, H);
      }
      if (L.a > 0.003) {
        ctx.fillStyle = 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',' + L.a.toFixed(3) + ')';
        ctx.fillRect(cam.x, cam.y, W, H);
      }
      if (L.night > 0.01) {
        // a lantern somewhere off the top right corner
        var lr = Math.max(W, H) * 0.75, lx = cam.x + W * 0.94, ly = cam.y - H * 0.06;
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        lg.addColorStop(0, 'rgba(255,196,120,' + (0.30 * L.night).toFixed(3) + ')');
        lg.addColorStop(0.45, 'rgba(255,180,100,' + (0.09 * L.night).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(255,180,100,0)');
        ctx.fillStyle = lg; ctx.fillRect(cam.x, cam.y, W, H);
        for (i = 0; i < lanterns.length; i++) lanternGlow(lanterns[i][0], lanterns[i][1], L.night);
      }
      drawSparks();
      drawFloaters();

      if (ui) {
        if (ui.mates) {
          // every koi that could be paired with the chosen one: a soft gold halo that breathes
          var pulse = 0.5 + 0.5 * Math.sin(game.time * 3);
          for (i = 0; i < ui.mates.length; i++) {
            var m = ui.mates[i], mr = Math.max(24, m.len * 0.66) + pulse * 5;
            ctx.fillStyle = 'rgba(220,188,94,' + (0.10 + 0.08 * pulse).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(m.x, m.y, mr, 0, 6.2832); ctx.fill();
            ctx.strokeStyle = 'rgba(232,205,130,' + (0.65 + 0.3 * pulse).toFixed(3) + ')'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(m.x, m.y, mr, 0, 6.2832); ctx.stroke();
          }
        }
        ring(ui.pick, 'rgba(201,168,92,0.75)', true);
        ring(ui.selected, 'rgba(233,228,216,0.6)', false);
        if (ui.item) {
          ctx.strokeStyle = 'rgba(233,228,216,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
          ctx.beginPath(); ctx.arc(ui.item.x, ui.item.y, 50, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }

    /* ---------- the dealer's tanks ---------- */
    /* Draw one koi swimming in a glass tank on another canvas. */
    function drawTank(cv, offer, t, idx) {
      var keep = ctx, w = cv.width, h = cv.height;
      ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#23474a'); g.addColorStop(1, '#122830');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(160,150,120,0.35)';   // gravel
      ctx.beginPath(); ctx.ellipse(w * 0.3, h + 6, w * 0.5, 22, 0, 0, 6.2832); ctx.ellipse(w * 0.8, h + 8, w * 0.4, 20, 0, 0, 6.2832); ctx.fill();
      if (offer) {
        var ph = t * 0.5 + idx * 2.1, len = Math.min(w * 0.42, h * 0.75);
        var x = w / 2 + Math.cos(ph) * w * 0.22, y = h / 2 + Math.sin(ph * 2) * h * 0.13;
        var vx = -Math.sin(ph) * w * 0.22, vy = Math.cos(ph * 2) * 2 * h * 0.13;
        var fk = offer._fake || (offer._fake = { genes: offer.genes, seed: 1 + idx * 977 + (offer.price | 0), growth: offer.growth, pulse: 0 });
        fk.x = x; fk.y = y; fk.a = Math.atan2(vy, vx); fk.len = len; fk.phase = t * 5 + idx; fk.turn = Math.cos(ph) * 0.8;
        drawFish(fk);
      }
      ctx.globalAlpha = 1;
      for (var i = 0; i < 5; i++) {               // a few bubbles from the air stone
        var by = h - ((t * 26 + i * 47 + idx * 13) % (h + 10));
        ctx.strokeStyle = 'rgba(220,238,238,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(w * 0.86 + Math.sin(t * 2 + i) * 4, by, 2 + (i % 3), 0, 6.2832); ctx.stroke();
      }
      g = ctx.createLinearGradient(0, 0, w, h);    // glass
      g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.3, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(210,235,235,0.35)'; ctx.fillRect(0, 7, w, 1.5);
      ctx = keep;
    }

    /* The raked sand of each zen garden as a picture, for saving: { plot: picture }, or null if nothing changed. */
    function sandOut() {
      var out = null, id;
      for (id in sandDirty) {
        if (!zens[id]) continue;
        try { out = out || {}; out[id] = zens[id].cv.toDataURL('image/jpeg', 0.8); } catch (e) {}
      }
      sandDirty = {};
      return out;
    }
    function sandIn(map) {
      Object.keys(map || {}).forEach(function (id) {
        if (!S.areaById(id) || typeof map[id] !== 'string') return;
        var img = new Image();
        img.onload = function () { zenOf(id).c.drawImage(img, 0, 0, AW, AH); };
        img.src = map[id];
      });
    }
    return { setup: setup, draw: draw, lookOf: lookOf, rake: rake, drawTank: drawTank, sandOut: sandOut, sandIn: sandIn };
  }

  root.KoiRender = { create: create, lightAt: lightAt };
})(window);
