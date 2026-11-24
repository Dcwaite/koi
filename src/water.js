/* Water: wave grid and light shading, carried over from the pond toy. No DOM in here so node can test it. */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* ---------- wave grid ----------
     Two-buffer discrete wave equation with one ring of ghost cells
     (mirror boundary = reflection), a global damping factor and a little
     extra damping in a band near the edges so reflections come back soft. */
  var C2 = 0.42;          // (c*dt/dx)^2, must stay < 0.5 for stability
  var DAMP = 0.9905;
  var EDGE_BAND = 7;
  var EDGE_LOSS = 0.045;
  var SRC_W = 0.45, SRC_TAU = 11, SRC_LIFE = 46, MAX_DROPS = 24;

  function WaveGrid(w, h) {
    this.w = w; this.h = h;
    this.sw = w + 2;
    var n = (w + 2) * (h + 2);
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.damp = new Float32Array(n);
    this.drops = [];
    for (var y = 1; y <= h; y++) {
      for (var x = 1; x <= w; x++) {
        var d = Math.min(x - 1, y - 1, w - x, h - y);
        var e = d < EDGE_BAND ? 1 - d / EDGE_BAND : 0;
        this.damp[y * this.sw + x] = DAMP * (1 - EDGE_LOSS * e * e);
      }
    }
  }

  WaveGrid.prototype.bump = function (gx, gy, r, amp) {
    var w = this.w, h = this.h, sw = this.sw, cur = this.cur;
    var R = Math.ceil(r * 2.6), ir2 = 1 / (r * r);
    var x0 = Math.max(0, Math.floor(gx) - R), x1 = Math.min(w - 1, Math.ceil(gx) + R);
    var y0 = Math.max(0, Math.floor(gy) - R), y1 = Math.min(h - 1, Math.ceil(gy) + R);
    for (var y = y0; y <= y1; y++) {
      var dy = y - gy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - gx;
        cur[(y + 1) * sw + x + 1] += amp * Math.exp(-(dx * dx + dy * dy) * ir2);
      }
    }
  };

  /* A pebble: an immediate dip plus a short damped oscillating source,
     which is what gives a few concentric rings instead of one. */
  WaveGrid.prototype.drop = function (gx, gy, amp) {
    this.bump(gx, gy, 2.2, -0.9 * amp);
    this.drops.push({ x: gx, y: gy, amp: amp, age: 0 });
    if (this.drops.length > MAX_DROPS) this.drops.shift();
  };

  WaveGrid.prototype.step = function () {
    var w = this.w, h = this.h, sw = this.sw;
    var cur = this.cur, prev = this.prev, damp = this.damp;
    var i, x, y;

    var drops = this.drops;
    for (i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.age++;
      this.bump(d.x, d.y, 2.0, d.amp * 0.5 * Math.sin(d.age * SRC_W) * Math.exp(-d.age / SRC_TAU));
      if (d.age >= SRC_LIFE) drops.splice(i, 1);
    }

    // ghost cells mirror the edge cells
    var top = sw, bot = h * sw;
    for (x = 1; x <= w; x++) {
      cur[x] = cur[top + x];
      cur[bot + sw + x] = cur[bot + x];
    }
    for (y = 1; y <= h; y++) {
      i = y * sw;
      cur[i] = cur[i + 1];
      cur[i + w + 1] = cur[i + w];
    }

    var k0 = 2 - 4 * C2;
    for (y = 1; y <= h; y++) {
      i = y * sw + 1;
      for (x = 0; x < w; x++, i++) {
        // (n+s)+(e+w): this grouping is exactly invariant under 90 degree rotation
        prev[i] = (k0 * cur[i] + C2 * ((cur[i - sw] + cur[i + sw]) + (cur[i - 1] + cur[i + 1])) - prev[i]) * damp[i];
      }
    }
    this.cur = prev; this.prev = cur;
  };

  function bilinear(a, sw, w, h, gx, gy) {
    gx = clamp(gx, 0, w - 1.001); gy = clamp(gy, 0, h - 1.001);
    var x = gx | 0, y = gy | 0, fx = gx - x, fy = gy - y;
    var i = (y + 1) * sw + x + 1;
    return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + sw] * (1 - fx) + a[i + sw + 1] * fx) * fy;
  }
  WaveGrid.prototype.sample = function (gx, gy) { return bilinear(this.cur, this.sw, this.w, this.h, gx, gy); };
  WaveGrid.prototype.samplePrev = function (gx, gy) { return bilinear(this.prev, this.sw, this.w, this.h, gx, gy); };

  WaveGrid.prototype.energy = function () {
    var e = 0, cur = this.cur, prev = this.prev, sw = this.sw;
    for (var y = 1; y <= this.h; y++) {
      for (var x = 1; x <= this.w; x++) {
        var i = y * sw + x, v = cur[i] - prev[i];
        e += cur[i] * cur[i] + v * v;
      }
    }
    return e;
  };

  /* Light on water. Writes RGBA (w*h*4) meant to be laid over the pond floor:
     pale and translucent where the slope faces the light, dark where it
     faces away, plus a small glint at one particular tilt. */
  function shade(grid, out) {
    var w = grid.w, h = grid.h, sw = grid.sw, cur = grid.cur;
    var o = 0;
    for (var y = 1; y <= h; y++) {
      var i = y * sw + 1;
      for (var x = 0; x < w; x++, i++, o += 4) {
        // Sobel slopes: the 1-2-1 averaging hides grid-scale noise that would show as scanlines
        var a = cur[i - sw + 1] - cur[i - sw - 1], b = cur[i + sw + 1] - cur[i + sw - 1];
        var dx = (a + b + 2 * (cur[i + 1] - cur[i - 1])) * 0.25;
        var dy = (cur[i + sw + 1] + cur[i + sw - 1] - cur[i - sw + 1] - cur[i - sw - 1] + 2 * (cur[i + sw] - cur[i - sw])) * 0.25;
        var d = 0.6 * dx + 0.8 * dy;       // slope toward the light (upper left)
        var p = 0.8 * dx - 0.6 * dy;
        var v = d * 2.6;
        var g = d - 0.16;
        var q = 1 - (g * g + p * p) * 60;
        if (v > 0) {
          v = v / (1 + v) * 0.5;
          if (q > 0) v += q * q * 0.3;
          out[o] = 206; out[o + 1] = 226; out[o + 2] = 220;
          out[o + 3] = v * 255;
        } else {
          v = -v;
          out[o] = 3; out[o + 1] = 8; out[o + 2] = 12;
          out[o + 3] = v / (1 + v) * 150;
        }
      }
    }
  }

  function chooseGrid(W, H) {
    // cells of about 3 CSS px, never more than 320 along the long side
    var cell = Math.max(3, Math.max(W, H) / 320);
    return { w: Math.max(16, Math.round(W / cell)), h: Math.max(16, Math.round(H / cell)) };
  }

  var api = { WaveGrid: WaveGrid, shade: shade, chooseGrid: chooseGrid, mulberry32: mulberry32,
              clamp: clamp, wrapAngle: wrapAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Water = api;
})(typeof window !== 'undefined' ? window : this);
