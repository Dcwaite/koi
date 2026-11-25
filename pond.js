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
  /* Growth. Each pellet moves a koi's size a little toward K_MAX, less as it nears it,
     and the koi swells into its new size over a second or so rather than jumping. */
  var K_MAX = 1.75;         // the biggest a koi gets, as a multiple of the pond's base fish size
  var GROW = 0.025;         // share of the remaining way to K_MAX that one pellet gives (about ten full feedings to get near it)
  var GLOW = 1.4;           // seconds the after-eating glow lasts

  /* Koi varieties. A look is a body colour plus patches: each spot is
     [place along the body 0..1, side to side -1..1, size]. metal = a pearly sheen. price is for a young koi. */
  var VARIETIES = {
    chagoi:   { name: 'Chagoi', price: 20, look: { body: '#8c6a45', patch: '#a07c52', spots: [[0.35, 0.0, 0.7]] } },
    karasu:   { name: 'Karasu', price: 25, look: { body: '#3b4047', patch: '#5e4f3d', spots: [[0.35, -0.5, 0.8]] } },
    kohaku:   { name: 'Kohaku', price: 30, look: { body: '#d8d1be', patch: '#bf6a38', spots: [[0.12, 0.0, 1.0], [0.5, 0.6, 0.9], [0.8, -0.2, 0.7]] } },
    hariwake: { name: 'Orange Hariwake', price: 35, look: { body: '#c47a45', patch: '#d9d1bd', spots: [[0.2, 0.5, 0.9], [0.62, -0.4, 0.8]], metal: true } },
    yamabuki: { name: 'Yamabuki', price: 40, look: { body: '#c6a565', patch: '#ddd6c2', spots: [[0.45, 0.4, 1.0]], metal: true } },
    asagi:    { name: 'Asagi', price: 45, look: { body: '#7d93a0', patch: '#c86a3c', spots: [[0.3, 0.95, 0.75], [0.3, -0.95, 0.75], [0.62, 0.95, 0.7], [0.62, -0.95, 0.7]] } },
    sanke:    { name: 'Sanke', price: 55, look: { body: '#d5cdb9', patch: '#2f3237', spots: [[0.25, -0.6, 0.8], [0.6, 0.5, 0.9], [0.1, 0.5, 0.5]], patch2: '#b9683a' } },
    showa:    { name: 'Showa', price: 65, look: { body: '#262a30', patch: '#c55a34', spots: [[0.15, 0.3, 0.9], [0.45, -0.5, 1.0], [0.75, 0.3, 0.8]], patch2: '#e2dccb' } },
    tancho:   { name: 'Tancho', price: 80, look: { body: '#e4ddcc', patch: '#c4392f', spots: [[0.07, 0.0, 0.7]] } },
    ogon:     { name: 'Platinum Ogon', price: 100, look: { body: '#e6e2d6', patch: '#f2efe6', spots: [], metal: true } }
  };
  var VARIETY_ORDER = ['chagoi', 'karasu', 'kohaku', 'hariwake', 'yamabuki', 'asagi', 'sanke', 'showa', 'tancho', 'ogon'];
  var STARTERS = ['hariwake', 'kohaku', 'karasu', 'yamabuki', 'sanke'];

  /* Plants for the water. flower: [outer petals, inner petals]. */
  var PLANTS = {
    pad:    { name: 'Lily pad', price: 10, flower: null },
    white:  { name: 'White water lily', price: 25, flower: ['#cdb9b4', '#e3d9cd'] },
    pink:   { name: 'Pink water lily', price: 35, flower: ['#c4808f', '#e8bcc5'] },
    yellow: { name: 'Yellow water lily', price: 35, flower: ['#c9a650', '#ecd896'] }
  };
  var PLANT_ORDER = ['pad', 'white', 'pink', 'yellow'];

  /* Crops: plants that ripen on the water. A ripe crop is picked with a tap, which puts its yield in
     the basket and starts it growing again. grow is in seconds of real time, and crops keep growing
     while you are away (up to ripe: they wait for you, they do not pile up). */
  PLANTS.cress    = { name: 'Watercress', price: 30, flower: null, crop: { grow: 90, yield: 2 } };
  PLANTS.chestnut = { name: 'Water chestnut', price: 60, flower: null, crop: { grow: 240, yield: 3 } };
  PLANTS.lotus    = { name: 'Lotus', price: 120, flower: null, crop: { grow: 480, yield: 2 } };
  var CROP_ORDER = ['cress', 'chestnut', 'lotus'];
  /* What a harvest gives, keyed by the crop that grows it. value is what the dealer pays for one. */
  var PRODUCE = {
    cress:    { name: 'Watercress', one: 'bunch of watercress', many: 'bunches of watercress', unit: 'bunches', value: 3 },
    chestnut: { name: 'Water chestnuts', one: 'water chestnut', many: 'water chestnuts', unit: 'nuts', value: 6 },
    lotus:    { name: 'Lotus pods', one: 'lotus pod', many: 'lotus pods', unit: 'pods', value: 20 }
  };
  function isCrop(kind) { return !!(PLANTS[kind] && PLANTS[kind].crop); }
  function ripeness(p) { var c = PLANTS[p.kind].crop; return c ? Math.min(1, (p.grow || 0) / c.grow) : 0; }

  /* The shop. */
  var MAX_FISH = 12, MAX_PADS = 12;
  var START_COINS = 40;
  var YOUNG_K = 0.65;       // the size of a koi from the shop
  var SELL_SHARE = 0.6;     // a koi sells for this share of its price at shop size, times its growth squared
  var PLANT_BACK = 0.5;     // a plant sells back for half
  var CM = 24;              // centimetres per unit of size, for the labels

  /* ---------- breeding ----------
     Two grown koi that have eaten well now and then have a baby. What it turns out to be leans toward its parents,
     but the plants in the pond tip it: each plant favours a couple of varieties, and the rare ones (Tancho, Platinum Ogon)
     only come from rare parents or the plants that call them. */
  var ADULT_K = 1.0;        // big enough to have young
  var GROWN_K = 1.5;        // "fully grown", for the koi book
  var FRY_K = 0.4;          // a newborn
  var FED = 0.35;           // both parents need to have eaten at least this well
  var BREED_GAP = [60, 130];  // seconds between chances, while the pond has grown, fed koi in it
  var PARENT_PULL = 4, PLANT_PULL = 1.5;
  var NURSERY = {
    pad:      ['chagoi', 'hariwake'],
    white:    ['tancho', 'kohaku'],
    pink:     ['kohaku', 'sanke'],
    yellow:   ['yamabuki', 'hariwake'],
    cress:    ['asagi', 'chagoi'],
    chestnut: ['karasu', 'showa'],
    lotus:    ['ogon', 'tancho']
  };
  /* Which plants favour a variety, for the hints in the book. */
  function favouredBy(variety) {
    var out = [];
    for (var k in NURSERY) if (NURSERY[k].indexOf(variety) >= 0) out.push(k);
    return out;
  }
  /* The odds for a baby of these two parents in this pond: { variety: weight }. */
  function babyOdds(a, b, pads) {
    var w = {};
    w[a] = (w[a] || 0) + PARENT_PULL; w[b] = (w[b] || 0) + PARENT_PULL;
    for (var i = 0; i < pads.length; i++) {
      var n = NURSERY[pads[i].kind];
      if (!n) continue;
      for (var j = 0; j < n.length; j++) w[n[j]] = (w[n[j]] || 0) + PLANT_PULL / n.length;
    }
    return w;
  }

  /* Milestones, kept in the koi book alongside the varieties. */
  var FEATS = [
    { id: 'harvest', name: 'First harvest', about: 'Pick a ripe crop from the water.' },
    { id: 'fry', name: 'New life', about: 'A baby koi is born in your pond.' },
    { id: 'full', name: 'A full pond', about: 'Keep 12 koi at once.' },
    { id: 'giant', name: 'A giant', about: 'Grow any koi to 41 cm.' },
    { id: 'purse', name: 'A heavy purse', about: 'Hold 500 coins at once.' },
    { id: 'keepAll', name: 'Every colour', about: 'Keep every variety of koi, at one time or another.' },
    { id: 'bornFive', name: 'Pond-bred', about: 'Have five different varieties born in your pond.' },
    { id: 'bornAll', name: 'Born of the pond', about: 'Have every variety born in your pond.' },
    { id: 'growAll', name: 'Master of koi', about: 'Grow every variety to full size.' },
    { id: 'treasure', name: 'Finders keepers', about: 'Take a treasure from a koi.' },
    { id: 'allTreasure', name: 'A full trove', about: 'Find one of every kind of treasure.' }
  ];

  /* ---------- treasures ----------
     Now and then a koi noses along the bottom and comes up with something in its mouth. It swims about with it
     until you tap it and take it; treasures sell at the shop. w is how often each turns up; the rare ones turn up
     more for bigger koi, who root deeper. */
  var TREASURES = {
    pebble: { name: 'Jade pebble', many: 'jade pebbles', value: 8, w: 30 },
    shell:  { name: 'River shell', many: 'river shells', value: 12, w: 24 },
    coin:   { name: 'Old copper coin', many: 'old copper coins', value: 20, w: 18 },
    bead:   { name: 'Glass bead', many: 'glass beads', value: 30, w: 12 },
    pearl:  { name: 'Freshwater pearl', many: 'freshwater pearls', value: 60, w: 6, rare: true },
    ring:   { name: 'Gold ring', many: 'gold rings', value: 120, w: 3, rare: true },
    frog:   { name: 'Jade frog', many: 'jade frogs', value: 220, w: 1.2, rare: true }
  };
  var TREASURE_ORDER = ['pebble', 'shell', 'coin', 'bead', 'pearl', 'ring', 'frog'];
  var FIND_GAP = [50, 120];    // seconds between finds
  var MAX_CARRY = 2;           // koi carrying something at once
  /* What a koi of this size is likely to find: [{ kind, p }]. */
  function findOdds(kt) {
    var out = [], sum = 0, i;
    for (i = 0; i < TREASURE_ORDER.length; i++) {
      var t = TREASURES[TREASURE_ORDER[i]], w = t.w * (t.rare ? Math.max(0.5, kt) * Math.max(0.5, kt) : 1);
      out.push({ kind: TREASURE_ORDER[i], p: w }); sum += w;
    }
    for (i = 0; i < out.length; i++) out[i].p /= sum;
    return out;
  }

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
    this.sparks = [];
    this.pops = [];            // "+2 watercress" rising from a harvest, for the drawing
    this.cues = [];            // things that make a sound, for the page to play: { k, x (0..1 across), s (0..1 size) }
    this.eaten = 0;
    this.coins = START_COINS;
    this.book = {};            // variety -> { kept, born (count), grown }: the koi book
    this.feats = {};           // milestone id -> true
    this.news = [];            // what was just achieved, for the page to announce: { kind, id }
    this.bornCount = 0;
    this.breedTimer = 45;      // a first chance comes fairly soon; after that it is BREED_GAP
    this.basket = { cress: 0, chestnut: 0, lotus: 0 };
    this.trove = {};           // treasure kind -> how many you are holding to sell
    this.found = {};           // treasure kind -> how many ever found, for the koi book
    this.findTimer = 30;       // the first find comes fairly soon
    this._makeGrid();
    this._sizes();
    var rng = this.rng, i;
    for (i = 0; i < 4; i++) {
      var rot = rng() * 6.283, pk = 0.78 + rng() * 0.5;
      this._placePad(this._newPad(i === 1 ? 'white' : 'pad', pk, rot));
    }
    for (i = 0; i < 5; i++) {
      var a = rng() * 6.283, ph = rng() * 6.283, fk = 0.8 + rng() * 0.45;
      this._keep(this._placeFish(this._newFish(STARTERS[i], fk, a, ph)));
    }
    this.news = [];            // the starting koi are not news
  }

  /* Something that makes a sound. The page plays and empties the list; it is capped so tests never grow it. */
  Pond.prototype._cue = function (k, x, s) {
    this.cues.push({ k: k, x: this.W ? clamp(x / this.W, 0, 1) : 0.5, s: s === undefined ? 0.5 : s });
    if (this.cues.length > 24) this.cues.shift();
  };

  Pond.prototype._newPad = function (kind, k, rot) {
    var pad = { x: 0, y: 0, vx: 0, vy: 0, rot: rot, rotv: 0, k: k, r: this.padBase * k, bob: 0, tx: 0, ty: 0,
                kind: kind, flower: PLANTS[kind].flower, tone: this.pads.length % 3, grow: 0 };
    return pad;
  };
  /* Put a pad somewhere clear of the others (if there is room) and add it. */
  Pond.prototype._placePad = function (pad) {
    var rng = this.rng, W = this.W, H = this.H;
    for (var t = 0; t < 120; t++) {
      pad.x = pad.r + 8 + rng() * Math.max(1, W - 2 * pad.r - 16);
      pad.y = pad.r + 8 + rng() * Math.max(1, H - 2 * pad.r - 16);
      var ok = true;
      for (var k = 0; k < this.pads.length; k++) {
        var q = this.pads[k];
        if (Math.hypot(q.x - pad.x, q.y - pad.y) < q.r + pad.r + 14) { ok = false; break; }
      }
      if (ok) break;
    }
    this.pads.push(pad);
    return pad;
  };

  Pond.prototype._newFish = function (variety, k, a, phase) {
    var f = { x: 0, y: 0, a: a, v: 0, turn: 0, wa: 0, phase: phase,
              k: k, len: 0, base: 0, mode: WANDER, timer: 0, t0: 1,
              fx: 0, fy: 0, tx: 0, ty: 0, variety: variety, look: VARIETIES[variety].look, idx: this.fish.length,
              full: 0.3, notice: -1, chase: 0, cool: 0, target: null, glow: 0, kt: k, carry: null };
    f.len = this.fishBase * f.k; f.base = f.len * 0.34; f.v = f.base;
    return f;
  };
  Pond.prototype._placeFish = function (f) {
    var rng = this.rng, W = this.W, H = this.H;
    for (var t = 0; t < 80; t++) {
      f.x = W * (0.15 + rng() * 0.7); f.y = H * (0.15 + rng() * 0.7);
      var far = true;
      for (var k = 0; k < this.fish.length; k++) {
        if (Math.hypot(this.fish[k].x - f.x, this.fish[k].y - f.y) < f.len * 1.5) { far = false; break; }
      }
      if (far) break;
    }
    this.fish.push(f);
    return f;
  };

  /* ---------- the shop: buying, selling, values ---------- */
  function fishValue(f) {
    var k = f.kt === undefined ? f.k : f.kt;
    return Math.max(1, Math.round(VARIETIES[f.variety].price * SELL_SHARE * (k / YOUNG_K) * (k / YOUNG_K)));
  }
  function padValue(p) { return Math.max(1, Math.round(PLANTS[p.kind].price * PLANT_BACK)); }
  function sizeCm(f) { return Math.round((f.kt === undefined ? f.k : f.kt) * CM); }

  /* Each returns a reason it could not (a short sentence), or the thing bought or sold. */
  Pond.prototype.canBuyFish = function (variety) {
    var v = VARIETIES[variety];
    if (!v) return 'No such koi.';
    if (this.fish.length >= MAX_FISH) return 'Pond is full';
    if (this.coins < v.price) return 'Need ' + (v.price - this.coins) + ' more';
    return '';
  };
  Pond.prototype.buyFish = function (variety) {
    var why = this.canBuyFish(variety);
    if (why) return { error: why };
    this.coins -= VARIETIES[variety].price;
    var rng = this.rng, f = this._placeFish(this._newFish(variety, YOUNG_K, rng() * 6.283, rng() * 6.283));
    f.glow = 1;
    this._keep(f);
    this.grid.drop(this.gx(f.x), this.gy(f.y), 0.7);      // it is let into the water with a splash
    return { fish: f };
  };
  Pond.prototype.sellFish = function (f) {
    var i = this.fish.indexOf(f);
    if (i < 0) return { error: 'That koi is not in the pond.' };
    if (this.fish.length <= 1) return { error: 'Keep at least one koi' };
    var paid = fishValue(f);
    this.fish.splice(i, 1);
    for (var k = 0; k < this.fish.length; k++) this.fish[k].idx = k;
    this.coins += paid;
    this.grid.drop(this.gx(f.x), this.gy(f.y), 0.5);
    return { paid: paid };
  };
  Pond.prototype.canBuyPlant = function (kind) {
    var p = PLANTS[kind];
    if (!p) return 'No such plant.';
    if (this.pads.length >= MAX_PADS) return 'No room left';
    if (this.coins < p.price) return 'Need ' + (p.price - this.coins) + ' more';
    return '';
  };
  Pond.prototype.buyPlant = function (kind) {
    var why = this.canBuyPlant(kind);
    if (why) return { error: why };
    this.coins -= PLANTS[kind].price;
    var rng = this.rng, pad = this._placePad(this._newPad(kind, 0.8 + rng() * 0.4, rng() * 6.283));
    this._constrain();
    this.grid.drop(this.gx(pad.x), this.gy(pad.y), 0.5);
    return { pad: pad };
  };
  Pond.prototype.sellPad = function (pad) {
    var i = this.pads.indexOf(pad);
    if (i < 0) return { error: 'That plant is not in the pond.' };
    var paid = padValue(pad);
    this.pads.splice(i, 1);
    this.coins += paid;
    this.grid.drop(this.gx(pad.x), this.gy(pad.y), 0.4);
    return { paid: paid };
  };

  /* ---------- crops: ripening, picking, selling the harvest ---------- */
  /* Time passing for the crops alone, e.g. while the page was hidden or closed. */
  Pond.prototype.ripen = function (seconds) {
    if (!(seconds > 0)) return;
    for (var i = 0; i < this.pads.length; i++) {
      var p = this.pads[i], c = PLANTS[p.kind].crop;
      if (!c) continue;
      var was = p.grow || 0;
      p.grow = Math.min(c.grow, was + seconds);
      if (was < c.grow && p.grow >= c.grow && seconds < 1) this._cue('ripe', p.x, 0.5);
    }
  };
  /* The ripe crop under (x, y), if any: the nearest whose leaves the point is on (with a little give for fingers). */
  Pond.prototype.ripeCropAt = function (x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.pads.length; i++) {
      var p = this.pads[i];
      if (!isCrop(p.kind) || ripeness(p) < 1) continue;
      var d = Math.hypot(p.x - x, p.y - y), reach = Math.max(p.r * 1.15, 26);
      if (d < reach && d < bd) { bd = d; best = p; }
    }
    return best;
  };
  /* Pick the ripe crop at (x, y). Returns { kind, n } or null if there is nothing ripe there. */
  Pond.prototype.harvestAt = function (x, y) {
    var p = this.ripeCropAt(x, y);
    if (!p) return null;
    var c = PLANTS[p.kind].crop, rng = this.rng;
    p.grow = 0;
    this.basket[p.kind] = (this.basket[p.kind] || 0) + c.yield;
    this.harvested = (this.harvested || 0) + c.yield;
    this._feat('harvest');
    this.pops.push({ x: p.x, y: p.y - p.r * 0.4, n: c.yield, kind: p.kind, age: 0 });
    for (var s = 0; s < 10; s++) {
      var sa = rng() * 6.283, sv = 18 + rng() * 30;
      this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, age: 0, life: 0.6 + rng() * 0.7 });
    }
    this.grid.drop(this.gx(p.x), this.gy(p.y), 0.35);
    this.sinceTouch = 0;
    this._cue('harvest', p.x, 0.5);
    return { kind: p.kind, n: c.yield };
  };
  Pond.prototype.basketCount = function () {
    var n = 0; for (var k in this.basket) n += this.basket[k] || 0; return n;
  };
  Pond.prototype.sellProduce = function (kind) {
    var n = this.basket[kind] || 0;
    if (!PRODUCE[kind] || n <= 0) return { error: 'Nothing to sell.' };
    var paid = n * PRODUCE[kind].value;
    this.basket[kind] = 0;
    this.coins += paid;
    return { paid: paid, n: n };
  };

  /* ---------- treasures ---------- */
  Pond.prototype.carriers = function () { return this.fish.filter(function (f) { return f.carry; }); };
  Pond.prototype._find = function (dt) {
    this.findTimer -= dt;
    if (this.findTimer > 0) return;
    this.findTimer = FIND_GAP[0] + this.rng() * (FIND_GAP[1] - FIND_GAP[0]);
    this.find();
  };
  /* A koi comes up from the bottom with something in its mouth. Returns the koi, or null if none can. */
  Pond.prototype.find = function (f, kind) {
    var rng = this.rng;
    if (!f) {
      if (this.carriers().length >= MAX_CARRY) return null;
      var free = this.fish.filter(function (q) { return !q.carry && q.mode !== FLEE; });
      if (!free.length) return null;
      f = free[(rng() * free.length) | 0];
    }
    if (!kind) {
      var odds = findOdds(f.kt), r = rng();
      kind = odds[odds.length - 1].kind;
      for (var i = 0; i < odds.length; i++) { r -= odds[i].p; if (r <= 0) { kind = odds[i].kind; break; } }
    }
    f.carry = kind;
    var m = mouth(f);
    this.grid.drop(this.gx(m.x), this.gy(m.y), 0.25);
    for (var s = 0; s < 8; s++) {
      var sa = rng() * 6.283, sv = 8 + rng() * 18;
      this.sparks.push({ x: m.x, y: m.y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, age: 0, life: 0.6 + rng() * 0.6 });
    }
    this._cue('find', m.x, 0.5);
    return f;
  };
  /* The koi carrying something whose head is under (x, y), with plenty of give: they keep swimming. */
  Pond.prototype.carrierAt = function (x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.fish.length; i++) {
      var f = this.fish[i];
      if (!f.carry) continue;
      var m = mouth(f), d = Math.min(Math.hypot(m.x - x, m.y - y), Math.hypot(f.x - x, f.y - y) * 1.2);
      if (d < Math.max(34, f.len * 0.5) && d < bd) { bd = d; best = f; }
    }
    return best;
  };
  /* Take the treasure from the koi at (x, y). Returns { kind } or null. */
  Pond.prototype.takeTreasureAt = function (x, y) {
    var f = this.carrierAt(x, y);
    if (!f) return null;
    var kind = f.carry, m = mouth(f), rng = this.rng;
    f.carry = null;
    this.trove[kind] = (this.trove[kind] || 0) + 1;
    var first = !this.found[kind];
    this.found[kind] = (this.found[kind] || 0) + 1;
    this._feat('treasure');
    if (TREASURE_ORDER.every(function (k) { return this.found[k]; }, this)) this._feat('allTreasure');
    if (first) this.news.push({ kind: 'treasure', id: kind });
    this.pops.push({ x: m.x, y: m.y - 10, n: 1, treasure: kind, age: 0 });
    for (var s = 0; s < 12; s++) {
      var sa = rng() * 6.283, sv = 16 + rng() * 30;
      this.sparks.push({ x: m.x, y: m.y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, age: 0, life: 0.6 + rng() * 0.7 });
    }
    this.grid.drop(this.gx(m.x), this.gy(m.y), 0.3);
    this.sinceTouch = 0;
    f.glow = Math.max(f.glow, 0.6);
    this._cue('treasure', m.x, clamp(TREASURES[kind].value / 220, 0, 1));
    return { kind: kind };
  };
  Pond.prototype.troveCount = function () {
    var n = 0; for (var k in this.trove) n += this.trove[k] || 0; return n;
  };
  Pond.prototype.sellTreasure = function (kind) {
    var n = this.trove[kind] || 0;
    if (!TREASURES[kind] || n <= 0) return { error: 'Nothing to sell.' };
    var paid = n * TREASURES[kind].value;
    this.trove[kind] = 0;
    this.coins += paid;
    return { paid: paid, n: n };
  };

  /* ---------- saving ---------- */
  /* now: the wall-clock time in ms, so crops can keep growing while the page is closed. */
  /* ---------- the koi book ---------- */
  Pond.prototype._entry = function (v) { return this.book[v] || (this.book[v] = { kept: false, born: 0, grown: false }); };
  Pond.prototype._feat = function (id) {
    if (this.feats[id]) return;
    this.feats[id] = true;
    this.news.push({ kind: 'feat', id: id });
  };
  Pond.prototype._checkFeats = function () {
    var kept = 0, born = 0, grown = 0;
    for (var i = 0; i < VARIETY_ORDER.length; i++) {
      var e = this.book[VARIETY_ORDER[i]];
      if (!e) continue;
      if (e.kept) kept++;
      if (e.born) born++;
      if (e.grown) grown++;
    }
    var n = VARIETY_ORDER.length;
    if (kept >= n) this._feat('keepAll');
    if (born >= 5) this._feat('bornFive');
    if (born >= n) this._feat('bornAll');
    if (grown >= n) this._feat('growAll');
    if (this.fish.length >= MAX_FISH) this._feat('full');
    if (this.coins >= 500) this._feat('purse');
  };
  /* A koi has joined the pond (bought, born, or there from the start). */
  Pond.prototype._keep = function (f) {
    var e = this._entry(f.variety);
    if (!e.kept) { e.kept = true; this.news.push({ kind: 'kept', id: f.variety }); }
    this._checkFeats();
    return f;
  };
  /* A koi has eaten and grown a little. */
  Pond.prototype._grew = function (f) {
    if (f.kt >= GROWN_K) {
      var e = this._entry(f.variety);
      if (!e.grown) { e.grown = true; this.news.push({ kind: 'grown', id: f.variety }); this._checkFeats(); }
    }
    if (f.kt >= 1.7) this._feat('giant');
  };
  /* The odds for a baby between two varieties in this pond, as fractions: [{ variety, p }], likeliest first. */
  Pond.prototype.babyOdds = function (a, b) {
    var w = babyOdds(a, b, this.pads), sum = 0, out = [], k;
    for (k in w) sum += w[k];
    for (k in w) out.push({ variety: k, p: w[k] / sum });
    return out.sort(function (x, y) { return y.p - x.p; });
  };
  /* The grown, well-fed koi that could have young right now. */
  Pond.prototype.parents = function () {
    return this.fish.filter(function (f) { return f.kt >= ADULT_K && f.full >= FED; });
  };
  Pond.prototype._breed = function (dt) {
    this.breedTimer -= dt;
    if (this.breedTimer > 0) return;
    var rng = this.rng;
    this.breedTimer = BREED_GAP[0] + rng() * (BREED_GAP[1] - BREED_GAP[0]);
    this.breed();
  };
  /* Two parents have a baby, if there are two and there is room. Returns the baby, or null. */
  Pond.prototype.breed = function () {
    if (this.fish.length >= MAX_FISH) return null;
    var ps = this.parents(), rng = this.rng;
    if (ps.length < 2) return null;
    var i = (rng() * ps.length) | 0, j = (rng() * (ps.length - 1)) | 0;
    if (j >= i) j++;
    var a = ps[i], b = ps[j];
    var w = babyOdds(a.variety, b.variety, this.pads), sum = 0, k;
    for (k in w) sum += w[k];
    var r = rng() * sum, pick = a.variety;
    for (k in w) { r -= w[k]; if (r <= 0) { pick = k; break; } }
    a.full -= 0.25; b.full -= 0.25;
    var f = this._newFish(pick, FRY_K, rng() * 6.283, rng() * 6.283);
    var M = this._margin(f);
    f.x = clamp((a.x + b.x) / 2, M, this.W - M); f.y = clamp((a.y + b.y) / 2, M, this.H - M);
    f.tx = f.x; f.ty = f.y;
    f.glow = 1; f.full = 0.5;
    this.fish.push(f);
    this.bornCount++;
    var e = this._entry(pick);
    e.born++; e.kept = true;
    this.news.push({ kind: 'born', id: pick, first: e.born === 1 });
    this._feat('fry');
    this._keep(f);
    this.grid.drop(this.gx(f.x), this.gy(f.y), 0.45);
    for (var s = 0; s < 14; s++) {
      var sa = rng() * 6.283, sv = 12 + rng() * 26;
      this.sparks.push({ x: f.x, y: f.y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, age: 0, life: 0.8 + rng() * 0.8 });
    }
    this._cue('fry', f.x, 0.5);
    return f;
  };

  Pond.prototype.toState = function (now) {
    var W = this.W, H = this.H;
    return {
      v: 1, t: now || 0, coins: this.coins, book: this.book, feats: this.feats, born: this.bornCount, trove: this.trove, found: this.found,
      basket: { cress: this.basket.cress || 0, chestnut: this.basket.chestnut || 0, lotus: this.basket.lotus || 0 },
      fish: this.fish.map(function (f) { var o = { v: f.variety, k: +f.k.toFixed(4), kt: +f.kt.toFixed(4), full: +f.full.toFixed(3) }; if (f.carry) o.c = f.carry; return o; }),
      pads: this.pads.map(function (p) { return { kind: p.kind, k: +p.k.toFixed(3), rot: +p.rot.toFixed(3), x: +(p.x / W).toFixed(4), y: +(p.y / H).toFixed(4), grow: +(p.grow || 0).toFixed(1) }; })
    };
  };
  /* Rebuild the koi and plants from a saved state. Anything unreadable is skipped. Returns false if nothing usable. */
  Pond.prototype.fromState = function (s, now) {
    if (!s || s.v !== 1 || !Array.isArray(s.fish) || !Array.isArray(s.pads)) return false;
    var fish = s.fish.filter(function (f) { return f && VARIETIES[f.v] && isFinite(f.k); }).slice(0, MAX_FISH);
    if (!fish.length) return false;
    var rng = this.rng, i;
    this.fish = []; this.pads = []; this.food = []; this.sparks = [];
    this.coins = Math.max(0, Math.floor(+s.coins || 0));
    for (i = 0; i < fish.length; i++) {
      var k = clamp(+fish[i].k, 0.3, K_MAX), f = this._newFish(fish[i].v, k, rng() * 6.283, rng() * 6.283);
      f.kt = clamp(isFinite(fish[i].kt) ? +fish[i].kt : k, k, K_MAX);
      f.full = clamp(+fish[i].full || 0, 0, 1.2);
      if (TREASURES[fish[i].c]) f.carry = fish[i].c;
      this._placeFish(f);
    }
    var pads = s.pads.filter(function (p) { return p && PLANTS[p.kind] && isFinite(p.k); }).slice(0, MAX_PADS);
    for (i = 0; i < pads.length; i++) {
      var pad = this._newPad(pads[i].kind, clamp(+pads[i].k, 0.5, 1.5), +pads[i].rot || 0);
      pad.x = clamp(+pads[i].x || 0.5, 0, 1) * this.W; pad.y = clamp(+pads[i].y || 0.5, 0, 1) * this.H;
      pad.grow = Math.max(0, +pads[i].grow || 0);
      this.pads.push(pad);
    }
    var b = s.basket || {};
    for (var kind in PRODUCE) this.basket[kind] = Math.max(0, Math.floor(+b[kind] || 0));
    this.trove = {}; this.found = {};
    for (var tk in TREASURES) {
      var tn = Math.max(0, Math.floor(+(s.trove || {})[tk] || 0)), fn = Math.max(0, Math.floor(+(s.found || {})[tk] || 0));
      if (tn) this.trove[tk] = tn;
      if (fn || tn) this.found[tk] = Math.max(fn, tn);
    }
    // the koi book; an older save has none, so it starts from the koi in the pond
    this.book = {}; this.feats = {};
    if (s.book && typeof s.book === 'object') for (var v in s.book) {
      if (!VARIETIES[v] || !s.book[v]) continue;
      this.book[v] = { kept: !!s.book[v].kept, born: Math.max(0, Math.floor(+s.book[v].born || 0)), grown: !!s.book[v].grown };
    }
    if (s.feats && typeof s.feats === 'object') for (var id in s.feats) if (s.feats[id]) this.feats[id] = true;
    this.bornCount = Math.max(0, Math.floor(+s.born || 0));
    for (i = 0; i < this.fish.length; i++) this._entry(this.fish[i].variety).kept = true;
    this.news = [];
    if (now && s.t && now > s.t) this.ripen((now - s.t) / 1000);
    this._constrain();
    return true;
  };

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
    this._cue('food', x, count / PINCH);
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
    this._cue('wake', x1, Math.min(1, d / 6));
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
      var f = fish[i];
      if (f.k < f.kt) {                                  // swell into the new size
        f.k = Math.min(f.kt, f.k + (f.kt - f.k) * dt * 2.5 + dt * 0.002);
        f.len = this.fishBase * f.k; f.base = f.len * 0.34;
      }
      if (f.glow > 0) f.glow = Math.max(0, f.glow - dt / GLOW);
      var len = f.len, M = this._margin(f);
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
            f.kt += (K_MAX - f.kt) * GROW;
            this._grew(f);
            f.glow = 1;
            this.grid.drop(this.gx(t.x), this.gy(t.y), 0.3);   // the little ring of a mouth at the surface
            this._cue('eat', t.x, clamp((f.kt - 0.5) / (K_MAX - 0.5), 0, 1));
            for (var s = 0; s < 6; s++) {                        // a few golden motes where it ate
              var sa = rng() * 6.283, sv = 10 + rng() * 22;
              this.sparks.push({ x: t.x, y: t.y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, age: 0, life: 0.7 + rng() * 0.6 });
            }
            if (this.sparks.length > 120) this.sparks.splice(0, this.sparks.length - 120);
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
      f.phase += dt * (2.2 + 7 * f.v / len + 9 * f.glow * f.glow);   // a happy flurry of the tail after a bite
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
      var mx = f.x + Math.cos(f.a) * f.len * 0.3;
      this.poke(mx, f.y + Math.sin(f.a) * f.len * 0.3, 0.55, true);
      this._cue('sip', mx, 0.6);
    } else {
      var dx_ = this.W * (0.06 + rng() * 0.88);
      this.poke(dx_, this.H * (0.06 + rng() * 0.88), 0.4, true);
      this._cue('drip', dx_, 0.4);
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
    for (var i = this.sparks.length - 1; i >= 0; i--) {
      var s = this.sparks[i], d = Math.exp(-DT * 3);
      s.age += DT;
      if (s.age >= s.life) { this.sparks.splice(i, 1); continue; }
      s.vx *= d; s.vy *= d; s.x += s.vx * DT; s.y += s.vy * DT;
    }
    this.ripen(DT);
    this._breed(DT);
    this._find(DT);
    if (this.step_ % 60 === 0) this._checkFeats();   // coins and pond size, once a second
    for (i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].age += DT;
      if (this.pops[i].age > 1.8) this.pops.splice(i, 1);
    }
  };

  var api = { Pond: Pond, WaveGrid: WaveGrid, shade: shade, chooseGrid: chooseGrid, mulberry32: mulberry32, DT: DT,
              WANDER: WANDER, FLEE: FLEE, WARY: WARY, CURIOUS: CURIOUS, FEED: FEED, SINK: SINK, BITE: BITE, K_MAX: K_MAX,
              VARIETIES: VARIETIES, VARIETY_ORDER: VARIETY_ORDER, PLANTS: PLANTS, PLANT_ORDER: PLANT_ORDER,
              MAX_FISH: MAX_FISH, MAX_PADS: MAX_PADS, START_COINS: START_COINS, YOUNG_K: YOUNG_K,
              fishValue: fishValue, padValue: padValue, sizeCm: sizeCm,
              CROP_ORDER: CROP_ORDER, PRODUCE: PRODUCE, isCrop: isCrop, ripeness: ripeness,
              ADULT_K: ADULT_K, GROWN_K: GROWN_K, FRY_K: FRY_K, NURSERY: NURSERY, FEATS: FEATS, favouredBy: favouredBy,
              TREASURES: TREASURES, TREASURE_ORDER: TREASURE_ORDER, findOdds: findOdds, MAX_CARRY: MAX_CARRY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PondSim = api;
})(typeof window !== 'undefined' ? window : this);
