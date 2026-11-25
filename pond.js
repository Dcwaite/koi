/* Pond simulation: wave grid, fish, lily pads, food. No DOM in here so node can test it. */
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

  /* ---------- pond: grid + fish + pads ---------- */
  var WANDER = 0, FLEE = 1, WARY = 2, CURIOUS = 3, FEED = 4;
  var DT = 1 / 60;

  /* Food. A pinch is a few pellets; each floats on the ripples until a koi takes it,
     or soaks and sinks. A koi that has eaten enough loses interest, and gets hungry again slowly. */
  var PINCH = 5;            // pellets per tap
  var MAX_FOOD = 80;
  var FOOD_LIFE = 55;       // seconds a pellet floats before it sinks (plus up to 20 more)
  var SINK = 5;             // seconds the sinking takes
  var BITE = 0.13;          // how much fuller one pellet makes a koi (1 = full)
  var DIGEST = 150;         // seconds for a full koi to be hungry again

  var FISH_LOOKS = [
    { body: '#c47a45', patch: '#d9d1bd', spots: [[0.2, 0.5, 0.9], [0.62, -0.4, 0.8]] },
    { body: '#d8d1be', patch: '#bf6a38', spots: [[0.12, 0.0, 1.0], [0.5, 0.6, 0.9], [0.8, -0.2, 0.7]] },
    { body: '#3b4047', patch: '#5e4f3d', spots: [[0.35, -0.5, 0.8]] },
    { body: '#c6a565', patch: '#ddd6c2', spots: [[0.45, 0.4, 1.0]] },
    { body: '#d5cdb9', patch: '#2f3237', spots: [[0.25, -0.6, 0.8], [0.6, 0.5, 0.9], [0.1, 0.5, 0.5]], patch2: '#b9683a' }
  ];

  function Pond(W, H, seed) {
    this.rng = mulberry32(seed === undefined ? 1 : seed);
    this.W = W; this.H = H;
    this.time = 0;
    this.sinceTouch = 0;
    this.idleTimer = 4 + this.rng() * 5;
    this.idleEvents = 0;
    this.fish = [];
    this.pads = [];
    this.food = [];
    this.eaten = 0;
    this._makeGrid();
    this._sizes();
    var rng = this.rng, i, k, t;
    for (i = 0; i < 4; i++) {
      var pad = { x: 0, y: 0, vx: 0, vy: 0, rot: rng() * 6.283, rotv: 0, k: 0.78 + rng() * 0.5,
                  r: 0, bob: 0, tx: 0, ty: 0, flower: i === 1, tone: i % 3 };
      pad.r = this.padBase * pad.k;
      for (t = 0; t < 80; t++) {
        pad.x = pad.r + 8 + rng() * (W - 2 * pad.r - 16);
        pad.y = pad.r + 8 + rng() * (H - 2 * pad.r - 16);
        var ok = true;
        for (k = 0; k < this.pads.length; k++) {
          var q = this.pads[k];
          if (Math.hypot(q.x - pad.x, q.y - pad.y) < q.r + pad.r + 14) ok = false;
        }
        if (ok) break;
      }
      this.pads.push(pad);
    }
    for (i = 0; i < 5; i++) {
      var f = { x: 0, y: 0, a: rng() * 6.283, v: 0, turn: 0, wa: 0, phase: rng() * 6.283,
                k: 0.8 + rng() * 0.45, len: 0, base: 0, mode: WANDER, timer: 0, t0: 1,
                fx: 0, fy: 0, tx: 0, ty: 0, look: FISH_LOOKS[i % FISH_LOOKS.length], idx: i,
                full: 0.3, notice: -1, chase: 0, cool: 0, target: null };
      f.len = this.fishBase * f.k; f.base = f.len * 0.34; f.v = f.base;
      for (t = 0; t < 80; t++) {
        f.x = W * (0.15 + rng() * 0.7); f.y = H * (0.15 + rng() * 0.7);
        var far = true;
        for (k = 0; k < this.fish.length; k++) {
          if (Math.hypot(this.fish[k].x - f.x, this.fish[k].y - f.y) < f.len * 1.5) far = false;
        }
        if (far) break;
      }
      this.fish.push(f);
    }
  }

  Pond.prototype._makeGrid = function () {
    var g = chooseGrid(this.W, this.H);
    this.grid = new WaveGrid(g.w, g.h);
    this.cx = this.W / g.w; this.cy = this.H / g.h;
  };
  Pond.prototype._sizes = function () {
    var m = Math.min(this.W, this.H);
    this.fishBase = clamp(m * 0.125, 44, 96);
    this.padBase = clamp(m * 0.072, 24, 54);
  };

  Pond.prototype.resize = function (W, H) {
    var sx = W / this.W, sy = H / this.H, i;
    this.W = W; this.H = H;
    this._makeGrid();
    this._sizes();
    for (i = 0; i < this.fish.length; i++) {
      var f = this.fish[i];
      f.x *= sx; f.y *= sy; f.tx *= sx; f.ty *= sy;
      f.len = this.fishBase * f.k; f.base = f.len * 0.34;
    }
    for (i = 0; i < this.pads.length; i++) {
      var p = this.pads[i];
      p.x *= sx; p.y *= sy; p.r = this.padBase * p.k;
    }
    for (i = 0; i < this.food.length; i++) { this.food[i].x *= sx; this.food[i].y *= sy; }
    this._constrain();
    this._keepFood();
  };

  /* A pinch of food scattered around (x, y). The fish are not startled by it. */
  Pond.prototype.feed = function (x, y, n) {
    var rng = this.rng, count = n === undefined ? PINCH : n, spread = this.fishBase * 0.32;
    x = clamp(x, 0, this.W); y = clamp(y, 0, this.H);
    for (var i = 0; i < count; i++) {
      var a = rng() * 6.283, r = Math.sqrt(rng()) * spread;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      this.food.push({ x: px, y: py, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, age: 0,
                       life: FOOD_LIFE + rng() * 20, size: 0.8 + rng() * 0.4, rot: rng() * 6.283 });
      this.grid.bump(this.gx(px), this.gy(py), 1.1, -0.1);
    }
    while (this.food.length > MAX_FOOD) this.food.shift();
    this.grid.drop(this.gx(x), this.gy(y), 0.22);
    this.sinceTouch = 0;
    this.idleTimer = 5 + rng() * 8;
    this._keepFood();
  };

  /* Pellets stay inside, where a koi can reach them, and slide off the lily pads. */
  Pond.prototype._keepFood = function () {
    var m = this.fishBase * 0.3, food = this.food, pads = this.pads;
    for (var i = 0; i < food.length; i++) {
      var p = food[i];
      for (var k = 0; k < pads.length; k++) {
        var q = pads[k], dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy), need = q.r + 3;
        if (d < need) {
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
          p.x = q.x + dx / d * need; p.y = q.y + dy / d * need;
        }
      }
      p.x = clamp(p.x, m, this.W - m); p.y = clamp(p.y, m, this.H - m);
    }
  };

  Pond.prototype._stepFood = function (dt) {
    var g = this.grid, food = this.food, drag = Math.exp(-dt * 1.6);
    for (var i = food.length - 1; i >= 0; i--) {
      var p = food[i];
      p.age += dt;
      if (p.age >= p.life + SINK) { food.splice(i, 1); continue; }
      // ripples carry the pellets downhill on the surface
      var gx = this.gx(p.x), gy = this.gy(p.y);
      var sx = g.sample(gx + 1, gy) - g.sample(gx - 1, gy), sy = g.sample(gx, gy + 1) - g.sample(gx, gy - 1);
      p.vx = (p.vx - sx * 900 * dt) * drag; p.vy = (p.vy - sy * 900 * dt) * drag;
      var sp = Math.hypot(p.vx, p.vy);
      if (sp > 40) { p.vx *= 40 / sp; p.vy *= 40 / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this._keepFood();
  };

  /* Where the koi's mouth is. */
  function mouth(f) { return { x: f.x + Math.cos(f.a) * f.len * 0.4, y: f.y + Math.sin(f.a) * f.len * 0.4 }; }

  Pond.prototype._nearestFood = function (f) {
    var m = mouth(f), best = null, bd = 1e18, food = this.food;
    for (var i = 0; i < food.length; i++) {
      var p = food[i];
      if (p.age > p.life) continue;           // already sinking
      var d = (p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  Pond.prototype.gx = function (x) { return x / this.cx - 0.5; };
  Pond.prototype.gy = function (y) { return y / this.cy - 0.5; };
  Pond.prototype.height = function (x, y) { return this.grid.sample(this.gx(x), this.gy(y)); };

  /* A pebble at (x, y) in CSS px. quiet = made by the pond itself, fish ignore it. */
  Pond.prototype.poke = function (x, y, strength, quiet) {
    var s = strength === undefined ? 1 : strength;
    x = clamp(x, 0, this.W); y = clamp(y, 0, this.H);
    this.grid.drop(this.gx(x), this.gy(y), s);
    if (quiet) return;
    this.sinceTouch = 0;
    this.idleTimer = 5 + this.rng() * 8;
    this._startle(x, y, Math.min(this.W, this.H) * 0.3, true);
  };

  /* A finger dragged from (x0,y0) to (x1,y1): a line of small dips. */
  Pond.prototype.wake = function (x0, y0, x1, y1) {
    var g = this.grid;
    var ax = this.gx(x0), ay = this.gy(y0), bx = this.gx(x1), by = this.gy(y1);
    var d = Math.hypot(bx - ax, by - ay);
    var n = Math.min(60, Math.max(1, Math.ceil(d / 1.5)));
    var amp = -0.2 * Math.min(1, d / n + 0.25);
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      g.bump(ax + (bx - ax) * t, ay + (by - ay) * t, 1.7, amp);
    }
    this.sinceTouch = 0;
    this._startle(x1, y1, this.fishBase * 0.9, false);
  };

  Pond.prototype._startle = function (x, y, radius, comeBack) {
    var rng = this.rng;
    for (var i = 0; i < this.fish.length; i++) {
      var f = this.fish[i];
      var dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy);
      if (d > radius) continue;
      if (d < 1e-6) { dx = Math.cos(f.a); dy = Math.sin(f.a); d = 1; }
      var j = (rng() - 0.5) * 0.9, c = Math.cos(j), s = Math.sin(j);
      f.fx = (dx * c - dy * s) / d; f.fy = (dx * s + dy * c) / d;
      f.mode = FLEE;
      f.t0 = f.timer = 0.7 + rng() * 0.5;
      f.comeBack = comeBack;
      if (comeBack) {
        // each fish returns to its own spot around the splash, not the same pixel
        var ang = f.idx * 2.4 + rng() * 0.6, rr = f.len * 0.6;
        var M = this._margin(f) * 0.6;
        f.tx = clamp(x + Math.cos(ang) * rr, M, this.W - M);
        f.ty = clamp(y + Math.sin(ang) * rr, M, this.H - M);
      }
    }
  };

  Pond.prototype._margin = function (f) {
    return Math.min(Math.max(f.len * 1.3, Math.min(this.W, this.H) * 0.16), Math.min(this.W, this.H) * 0.45);
  };

  Pond.prototype._stepFish = function (dt) {
    var W = this.W, H = this.H, fish = this.fish, rng = this.rng, i, k;
    for (i = 0; i < fish.length; i++) {
      var f = fish[i], len = f.len, M = this._margin(f);
      f.wa += (rng() - 0.5) * 0.3; f.wa *= 0.975;
      var da = f.a + f.wa;
      var dx = Math.cos(da), dy = Math.sin(da);
      var vt = f.base, maxTurn = 1.8, accel = 1.5;

      // hunger: a calm koi notices food after a moment, each in its own time
      f.full = Math.max(0, f.full - dt / DIGEST);
      if (f.cool > 0) f.cool -= dt;
      if (f.mode === WANDER || f.mode === CURIOUS) {
        if (f.full < 1 && f.cool <= 0 && this.food.length) {
          if (f.notice < 0) f.notice = 0.25 + rng() * 1.1;
          f.notice -= dt;
          if (f.notice <= 0) { f.mode = FEED; f.notice = -1; f.chase = 0; }
        } else f.notice = -1;
      }

      if (f.mode === FEED) {
        var t = f.full < 1 ? this._nearestFood(f) : null;
        f.chase += dt;
        if (!t || f.chase > 14) {
          f.mode = WANDER;
          if (t) f.cool = 3 + rng() * 3;      // could not reach it: give up for a little while
        } else {
          var mo = mouth(f), fx = t.x - mo.x, fy = t.y - mo.y, fd = Math.hypot(fx, fy);
          if (fd < len * 0.14) {
            this.food.splice(this.food.indexOf(t), 1);
            this.eaten++;
            f.full = Math.min(1.2, f.full + BITE);
            f.chase = 0;
            this.grid.drop(this.gx(t.x), this.gy(t.y), 0.3);   // the little ring of a mouth at the surface
            if (f.full >= 1) f.mode = WANDER;
          } else {
            dx = dx * 0.3 + fx / fd * 3; dy = dy * 0.3 + fy / fd * 3;
            vt = f.base * (0.6 + 1.7 * Math.min(1, fd / (len * 2.5)));
            maxTurn = 3.4; accel = 3;
          }
        }
      }

      if (f.mode === FLEE) {
        dx = f.fx * 4 + dx * 0.3; dy = f.fy * 4 + dy * 0.3;
        vt = f.base * (2 + 10 * f.timer / f.t0);
        maxTurn = 11; accel = 14;
        if ((this.step_ & 3) === 0) this.grid.bump(this.gx(f.x), this.gy(f.y), 1.6, -0.07);
        f.timer -= dt;
        if (f.timer <= 0) {
          if (f.comeBack) { f.mode = WARY; f.timer = 2.4 + rng() * 2.2; }
          else f.mode = WANDER;
        }
      } else if (f.mode === WARY) {
        vt = f.base * 1.4;
        f.timer -= dt;
        if (f.timer <= 0) { f.mode = CURIOUS; f.timer = 9; }
      } else if (f.mode === CURIOUS) {
        var ex = f.tx - f.x, ey = f.ty - f.y, ed = Math.hypot(ex, ey);
        f.timer -= dt;
        if (ed < len * 0.3 || f.timer <= 0) {
          f.mode = WANDER;
        } else {
          dx += ex / ed * 2.4; dy += ey / ed * 2.4;
          vt = f.base * (0.5 + 1.2 * Math.min(1, ed / (len * 2.5)));
        }
      }

      // walls: push toward the inside, harder the closer the fish is (softer while going for food near the edge)
      var p, wf = 6;
      if (f.mode === FEED) { M = Math.min(M, len * 0.7); wf = 2; }
      if (f.x < M) { p = (M - f.x) / M; dx += p * p * wf; }
      if (f.x > W - M) { p = (f.x - (W - M)) / M; dx -= p * p * wf; }
      if (f.y < M) { p = (M - f.y) / M; dy += p * p * wf; }
      if (f.y > H - M) { p = (f.y - (H - M)) / M; dy -= p * p * wf; }

      // keep a little room from the other fish
      for (k = 0; k < fish.length; k++) {
        if (k === i) continue;
        var o = fish[k], sx = f.x - o.x, sy = f.y - o.y, sd = Math.hypot(sx, sy);
        var R = (len + o.len) * 0.6;
        if (sd < R && sd > 1e-6) { var wgt = (1 - sd / R) * 2.5; dx += sx / sd * wgt; dy += sy / sd * wgt; }
      }

      var diff = wrapAngle(Math.atan2(dy, dx) - f.a);
      var tr = clamp(diff * 4, -maxTurn, maxTurn);
      f.turn += (tr - f.turn) * Math.min(1, dt * (f.mode === FLEE ? 20 : 6));
      f.a = wrapAngle(f.a + f.turn * dt);
      f.v += (vt - f.v) * Math.min(1, dt * accel);
      f.x += Math.cos(f.a) * f.v * dt;
      f.y += Math.sin(f.a) * f.v * dt;
      f.phase += dt * (2.2 + 7 * f.v / len);
    }
    this._constrain();
  };

  /* Hard guarantees: everything inside the pond, nothing on top of anything. */
  Pond.prototype._constrain = function () {
    var W = this.W, H = this.H, fish = this.fish, pads = this.pads, i, k, pass;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < fish.length; i++) {
        for (k = i + 1; k < fish.length; k++) {
          var a = fish[i], b = fish[k], min = (a.len + b.len) * 0.16;
          var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d < min) {
            if (d < 1e-6) { dx = Math.cos(i * 2.4 + k); dy = Math.sin(i * 2.4 + k); d = 1; }
            var push = (min - d) * 0.5 + 0.01;
            a.x -= dx / d * push; a.y -= dy / d * push;
            b.x += dx / d * push; b.y += dy / d * push;
          }
        }
      }
      for (i = 0; i < fish.length; i++) {
        var f = fish[i], e = Math.min(f.len * 0.3, W * 0.4, H * 0.4) + f.idx * 0.75;
        f.x = clamp(f.x, e, W - e); f.y = clamp(f.y, e, H - e);
      }
    }
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < pads.length; i++) {
        for (k = i + 1; k < pads.length; k++) {
          var p = pads[i], q = pads[k], need = p.r + q.r + 3;
          var px = q.x - p.x, py = q.y - p.y, pd = Math.hypot(px, py);
          if (pd < need) {
            if (pd < 1e-6) { px = 1; py = 0; pd = 1; }
            var ps = (need - pd) * 0.5;
            p.x -= px / pd * ps; p.y -= py / pd * ps;
            q.x += px / pd * ps; q.y += py / pd * ps;
          }
        }
      }
      for (i = 0; i < pads.length; i++) {
        var pp = pads[i], er = Math.min(pp.r + 3, W * 0.5, H * 0.5);
        if (pp.x < er) { pp.x = er; if (pp.vx < 0) pp.vx = 0; }
        if (pp.x > W - er) { pp.x = W - er; if (pp.vx > 0) pp.vx = 0; }
        if (pp.y < er) { pp.y = er; if (pp.vy < 0) pp.vy = 0; }
        if (pp.y > H - er) { pp.y = H - er; if (pp.vy > 0) pp.vy = 0; }
      }
    }
  };

  Pond.prototype._stepPads = function (dt) {
    var g = this.grid, pads = this.pads;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i], s = p.r * 0.55;
      var gx = this.gx(p.x), gy = this.gy(p.y), sx = s / this.cx, sy = s / this.cy;
      var hl = g.sample(gx - sx, gy), hr = g.sample(gx + sx, gy);
      var hu = g.sample(gx, gy - sy), hd = g.sample(gx, gy + sy);
      var h = (hl + hr + hu + hd) * 0.25;
      var hp = (g.samplePrev(gx - sx, gy) + g.samplePrev(gx + sx, gy) + g.samplePrev(gx, gy - sy) + g.samplePrev(gx, gy + sy)) * 0.25;
      var tx = (hr - hl), ty = (hd - hu);
      p.bob += (h - p.bob) * 0.5;
      p.tx += (tx - p.tx) * 0.5; p.ty += (ty - p.ty) * 0.5;
      // a travelling wave pushes along its direction of travel: -h_t * grad h
      var ht = h - hp;
      var fx = -ht * tx, fy = -ht * ty, fm = Math.hypot(fx, fy);
      var TH = 0.0006;
      if (fm > TH) {
        var gain = Math.min((fm - TH) * 9000, 60) / fm;
        p.vx += fx * gain * dt; p.vy += fy * gain * dt;
        p.rotv += (fx * 0.7 - fy * 0.4) * gain * dt * 0.01;
      }
      var drag = Math.exp(-dt * 1.1);
      p.vx *= drag; p.vy *= drag; p.rotv *= drag;
      var sp = Math.hypot(p.vx, p.vy), cap = 26;
      if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rotv * dt;
    }
    this._constrain();
  };

  /* If nobody has touched the water for a while: now and then one raindrop,
     or one fish rising. Nothing else. */
  Pond.prototype._idle = function (dt) {
    this.sinceTouch += dt;
    if (this.sinceTouch < 6) return;
    this.idleTimer -= dt;
    if (this.idleTimer > 0) return;
    var rng = this.rng;
    this.idleTimer = 7 + rng() * 12;
    this.idleEvents++;
    if (rng() < 0.45) {
      var f = this.fish[(rng() * this.fish.length) | 0];
      this.poke(f.x + Math.cos(f.a) * f.len * 0.3, f.y + Math.sin(f.a) * f.len * 0.3, 0.55, true);
    } else {
      this.poke(this.W * (0.06 + rng() * 0.88), this.H * (0.06 + rng() * 0.88), 0.4, true);
    }
  };

  Pond.prototype.step = function () {
    this.step_ = (this.step_ | 0) + 1;
    this.time += DT;
    this._idle(DT);
    this.grid.step();
    this._stepFish(DT);
    this._stepPads(DT);
    this._stepFood(DT);
  };

  var api = { Pond: Pond, WaveGrid: WaveGrid, shade: shade, chooseGrid: chooseGrid, mulberry32: mulberry32, DT: DT,
              WANDER: WANDER, FLEE: FLEE, WARY: WARY, CURIOUS: CURIOUS, FEED: FEED, SINK: SINK, BITE: BITE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PondSim = api;
})(typeof window !== 'undefined' ? window : this);
