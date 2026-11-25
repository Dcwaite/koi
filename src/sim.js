/* Stillwater Koi prototype: the game simulation. No DOM in here so node can test it. */
(function (root) {
  'use strict';
  var Water = (typeof module !== 'undefined' && module.exports) ? require('./water.js') : root.Water;
  var clamp = Water.clamp, wrapAngle = Water.wrapAngle, mulberry32 = Water.mulberry32;

  var DT = 1 / 60, MIN = 60;

  /* Tuning. Times are in pond seconds unless they say otherwise. */
  var T = {
    presenceMult: 4,          // pond time runs this much faster while someone is at the pond
    presenceHold: 600,        // real seconds after the last input before presence starts to fade
    presenceFade: 60,         // real seconds the fade takes
    growYoung: 180 * MIN,
    growAdult: 720 * MIN,
    growMax: 2400 * MIN,
    fullSpan: 40 * MIN,       // a full koi is hungry again after this long
    hungryGrowth: 0.4,        // growth rate of a hungry koi, relative to a fed one
    bite: 0.34,
    pairTime: 30 * MIN,
    incomePerSec: 0.0005 / 60, // pocket money: 0.05% of a koi's value per real minute
    offlineIncomeCap: 8 * 3600,
    maxPads: 7,
    padCost: 40,
    padShade: 0.05,           // each pad keeps koi fed this much longer
    dealerRefresh: 20 * MIN,
    pelletLife: 90,
    mutation: 0.01,
    tossEvery: [60, 110],     // real seconds between coins thrown for a content koi, while someone is at the pond
    coinLife: 45,             // a coin lies in the water this long before the silt takes it
    tossShare: 0.03,          // a tossed coin is worth this share of the koi's value
    maxTossed: 14,
    maxVisitors: 8,
    lotusCost: 90, lotusBonus: 0.10,
    reedGrowth: 0.06, irisBond: 0.10,
    requestRefill: 5 * MIN,
    biteGrowth: 6 * MIN,      // a mouthful is worth this much growing, on top of time passing
    duskMinute: 92,
    seasonLen: 8 * 60,       // real seconds in a season, so a year at the lake is a little over half an hour
    seasonFade: 40           // real seconds the change from one season to the next takes
  };
  /* The garden is one screen: a lake in the middle, and everything else on its banks. Nothing scrolls.
     The world is AW x AH. There is one area, the lake, and the tea house has a small yard of its own. */
  var AW = 1600, AH = 1000, COLS = 1, ROWS = 1;
  var BIOMES = [{ id: 'home', name: 'the lake', c0: 0, r0: 0, first: [0, 0], bases: null, price: 0 }];
  function biomeById(id) { return id === 'home' ? BIOMES[0] : null; }
  var AREAS = [{ id: 'home', col: 0, row: 0, biome: 'home', first: true, ring: 0 }];
  var SHAPES = {
    home: { cx: AW / 2, cy: 450, rx: 560, ry: 300, lobes: [[2, 0.05, 0.6], [3, 0.04, 2.1]] },
    tea: { cx: 1430, cy: 150, rx: 125, ry: 92, lobes: [[3, 0.04, 0.5]] }
  };
  function areaById(id) { return id === 'home' ? AREAS[0] : null; }
  function areaAt(col, row) { return col === 0 && row === 0 ? AREAS[0] : null; }

  /* What can stand on a plot. cost: to build (outer plots cost more). renown: what it adds to the garden's name.
     pay / stop / cap: what a guest leaves in the till, how likely a passing guest is to stop, and how much the till holds. */
  var KINDS = {
    pond: { name: 'Koi pond', cost: 500, renown: 40, note: 'Room for 6 more koi. Joins any pond beside it, and guests throw coins in.' },
    market: { name: 'Market', cost: 600, renown: 20, pay: 4, stop: 0.8, cap: 60, fixed: true, note: 'Sell koi and what the garden grows. Guests browse the stalls.' },
    dango: { retired: true, name: 'Dango stall', cost: 250, renown: 25, pay: 6, stop: 0.7, cap: 80, note: 'Guests stop for a snack and leave coins in the till.' },
    tea: { name: 'Tea house', cost: 900, renown: 60, pay: 14, stop: 0.6, cap: 160, note: 'Guests sit for tea. A good earner.' },
    zen: { name: 'Zen garden', cost: 700, renown: 70, note: 'Sand to rake and stones to set. Somewhere quiet.' },
    moss: { retired: true, name: 'Moss garden', cost: 600, renown: 55, note: 'Koi come to trust you 15% faster.' },
    bamboo: { retired: true, name: 'Bamboo grove', cost: 800, renown: 55, note: 'Fry and young koi grow 10% faster.' },
    nursery: { retired: true, name: 'Nursery', cost: 900, renown: 30, note: 'Grows flowers and reeds for your basket by itself.' },
    hatchery: { retired: true, name: 'Hatchery', cost: 1500, renown: 35, note: 'Pairs have their fry 25% sooner.' },
    shrine: { retired: true, name: 'Shrine', cost: 2500, renown: 120, pay: 22, stop: 0.35, cap: 220, note: 'Guests leave offerings. A great deal of renown.' }
  };
  /* Stations: the things in the garden you tap to do the business of running it. Each stands on a plot,
     at dx, dy from its middle, where it can be seen when that plot fills the screen. */
  var STATIONS = [
    { id: 'requests', name: 'Requests', x: 140, y: 300, w: 62, h: 50 },
    { id: 'koi', name: 'Koi book', x: 140, y: 600, w: 60, h: 52 },
    { id: 'shows', name: 'Koi shows', x: 1460, y: 330, w: 62, h: 50 },
    { id: 'plans', name: 'Lake works', x: 1460, y: 610, w: 60, h: 52 },
    { id: 'sell', name: 'Sell', x: 300, y: 880, w: 78, h: 48 },
    { id: 'dealer', name: 'Koi dealer', x: 530, y: 880, w: 78, h: 48 },
    { id: 'gate', name: 'Ticket gate', x: 1310, y: 884, w: 96, h: 50 },
    { id: 'garden', name: 'Garden shop', x: 1070, y: 880, w: 78, h: 48 }
  ];
  /* The ticket gate: every guest pays to come in, and the takings wait there until you fetch them.
     It only holds so much; a bigger cash box is an upgrade. */
  var GATE = { caps: [120, 300, 700, 1500, 3000], costs: [250, 700, 1800, 4500] };
  var LEVEL = [1, 1.6, 2.3];          // how much more a building does at level 1, 2 and 3
  var STARS = [0, 150, 400, 800, 1400]; // renown needed for one to five stars
  /* Things to aim for, one at a time. Each pays coins when claimed. */
  var GOALS = [
    { text: 'Feed your koi', reward: 30, done: function (g) { return g.stats.fed >= 3; } },
    { text: 'Collect the takings at the ticket gate', reward: 40, done: function (g) { return g.stats.gate >= 1; } },
    { text: 'Pair two koi', reward: 60, done: function (g) { return g.stats.pairs >= 1; } },
    { text: 'Make the lake bigger', reward: 150, done: function (g) { return g.lots.home.level >= 2; } },
    { text: 'Fill a request', reward: 200, done: function (g) { return g.stats.requests >= 1; } },
    { text: 'Welcome a wild koi', reward: 200, done: function (g) { return g.stats.wild >= 1; } },
    { text: 'Keep 10 koi', reward: 300, done: function (g) { return g.koi.length >= 10; } },
    { text: 'Build the tea house', reward: 300, done: function (g) { return !!g.lots.tea; } },
    { text: 'Find 12 kinds of koi', reward: 500, done: function (g) { return g.bookCount() >= 12; } },
    { text: 'Build the moon bridge', reward: 600, done: function (g) { return !!g.works.bridge; } },
    { text: 'Find 25 kinds of koi', reward: 1000, done: function (g) { return g.bookCount() >= 25; } },
    { text: 'Dig the lake to its biggest', reward: 2000, done: function (g) { return g.lots.home.level >= 4; } },
    { text: 'Find 40 kinds of koi', reward: 3000, done: function (g) { return g.bookCount() >= 40; } }
  ];
  /* Every pond but the first has a mood of its own, so opening one is opening a new place. */
  var THEMES = ['spring', 'lotus', 'maple', 'snow', 'lantern'];
  var THEME_NAMES = { home: 'Home pond', lotus: 'Lotus pond', maple: 'Maple pond', snow: 'Snow pond', lantern: 'Lantern pond', spring: 'Spring pond' };
  function themeOf(id) {
    var a = areaById(id);
    return a && a.biome ? a.biome : 'home';
  }
  /* The year turns while you sit by the lake: each season changes the light, what floats on the water,
     and what comes to visit. A season lasts T.seasonLen real seconds. */
  var SEASONS = [{ id: 'spring', name: 'Spring' }, { id: 'lotus', name: 'Summer' }, { id: 'maple', name: 'Autumn' }, { id: 'snow', name: 'Winter' }];
  var SEASON_TEXT = {
    spring: 'Spring has come. Blossom drifts over the water.',
    lotus: 'Summer is here. Lotus flowers open on the lake.',
    maple: 'Autumn. The maples drop their leaves on the water.',
    snow: 'Winter. Thin ice rims the lake, and snow is falling.'
  };
  /* Lake works: things to build around the one lake. The lake itself is dug bigger in steps. */
  var LAKE_CAP = [12, 18, 26, 36], LAKE_COST = [600, 1800, 5000];
  var WORKS = {
    tea: { name: 'Tea house', cost: 900, renown: 60, note: 'On the far bank. Guests stop for tea and leave coins in its till.' },
    falls: { name: 'Waterfall', cost: 700, renown: 50, note: 'Fresh water spills in at the top of the lake. Koi stay fed 8% longer, and wild koi find their way in twice as often.' },
    bridge: { name: 'Moon bridge', cost: 1200, renown: 80, note: 'A bridge out to the island. Guests cross it to feed the koi.' }
  };
  function blobR(sh, th) {
    var r = 1, i;
    for (i = 0; i < sh.lobes.length; i++) r += sh.lobes[i][1] * Math.cos(sh.lobes[i][0] * th + sh.lobes[i][2]);
    return r;
  }
  function inBlob(sh, x, y) {
    var dx = (x - sh.cx) / sh.rx, dy = (y - sh.cy) / sh.ry, r = blobR(sh, Math.atan2(dy, dx));
    return dx * dx + dy * dy < r * r;
  }
  /* The point on a shape's edge in direction th (k = 1), or that far again inside or outside it. */
  function blobPoint(sh, th, k) {
    var r = blobR(sh, th) * (k === undefined ? 1 : k);
    return [sh.cx + Math.cos(th) * sh.rx * r, sh.cy + Math.sin(th) * sh.ry * r];
  }
  function outline(id, n) {
    var pts = [], i;
    n = n || 120;
    for (i = 0; i < n; i++) pts.push(blobPoint(SHAPES[id], i / n * 6.2832));
    return pts;
  }
  function segDist(x, y, x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0, t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - x0 - dx * t, y - y0 - dy * t);
  }
  var FC = 10;   // the bank is worked out on a grid this fine, in world pixels

  /* The lake: a soft-cornered box with a bay at the top left and an island toward the top right, its edge
     wandering so it never looks drawn with a ruler. level 1 to 4: each dig pulls the banks back.
     Returns how far a point is from the shore, roughly: below zero is water. */
  var LAKE = { lv: [[320, 180, 730], [292, 160, 748], [262, 140, 764], [235, 122, 780]], round: 230 };
  var ISLE = { x: 1010, y: 372, rx: 104, ry: 70 };
  var FALLS_X = 450;
  function smin(a, b, k) { var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); }
  function lakeD(x, y, level, seed) {
    var L = LAKE.lv[clamp(level | 0, 1, 4) - 1], x0 = L[0], x1 = AW - L[0], y0 = L[1], y1 = L[2], r = LAKE.round;
    var qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r), qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
    var d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    var bay = (Math.hypot((x - FALLS_X) / 175, (y - y0 - 6) / 62) - 1) * 62;
    d = smin(d, bay, 70);
    var isl = (Math.hypot((x - ISLE.x) / ISLE.rx, (y - ISLE.y) / ISLE.ry) - 1) * ISLE.ry;
    d = -smin(-d, isl, 50);
    // two coves where the land pushes in, so no side of the lake runs straight
    var cove1 = (Math.hypot((x - 650) / 175, (y - y1 - 44) / 104) - 1) * 104, cove2 = (Math.hypot((x - x1 - 36) / 104, (y - 560) / 128) - 1) * 104;
    d = -smin(-d, cove1, 60); d = -smin(-d, cove2, 60);
    return d + 20 * Math.sin(x / 310 + seed) + 15 * Math.sin(y / 230 + seed * 1.7) + 7 * Math.sin((x + y) / 97 + seed * 2.3) + 11 * Math.sin((x - y) / 410 + seed * 0.9);
  }
  // a wall runs round the whole garden, with a gate in the middle of each side where visitors come and go
  var WALL = 46;
  var GATES = [{ x: 1310, y: AH - WALL, a: -Math.PI / 2 }];
  // gravel paths join every plot to the ones beside it
  var PATHS = [];
  AREAS.forEach(function (a) {
    var e = areaAt(a.col + 1, a.row), so = areaAt(a.col, a.row + 1);
    if (e) PATHS.push([a.id, e.id]);
    if (so) PATHS.push([a.id, so.id]);
  });

  /* What the garden grows. A plant ripens in pond time, is picked with a tap, and is sold at the market. */
  var GOODS = {
    blossom: { name: 'Lotus blossom', from: 'lotus', every: 30 * MIN, price: 30 },
    reeds: { name: 'Reed bundle', from: 'reed', every: 20 * MIN, price: 14 },
    iris: { name: 'Iris flower', from: 'iris', every: 25 * MIN, price: 22 },
    cutting: { name: 'Bonsai cutting', from: 'bonsai', every: 45 * MIN, price: 45 }
  };
  var CROP = {};
  Object.keys(GOODS).forEach(function (k) { CROP[GOODS[k].from] = k; });

  var PLANTS = {
    pad: { name: 'Lily pad', cost: 40, max: 7, group: 'Plants', where: 'pad', note: 'Shade. Koi stay fed 5% longer.' },
    lotus: { name: 'Lotus', cost: 90, max: 7, group: 'Plants', where: 'pad', note: 'Visitors toss 10% more.' },
    reed: { name: 'Reeds', cost: 70, max: 5, group: 'Plants', where: 'edge', note: 'Fry and young koi grow 6% faster.' },
    iris: { name: 'Water iris', cost: 110, max: 4, group: 'Plants', where: 'edge', note: 'Koi come to trust you 10% faster.' },
    duckweed: { name: 'Duckweed', cost: 30, max: 4, group: 'Plants', where: 'water', note: 'Something to nibble. Hungry koi grow a little faster.' },
    rock: { name: 'Mossy rock', cost: 35, max: 6, group: 'Decorations', where: 'water', note: 'Just nice to look at.' },
    spout: { name: 'Bamboo spout', cost: 120, max: 1, group: 'Decorations', where: 'edge', note: 'Fresh water. Koi stay fed 8% longer.' },
    lantern: { name: 'Stone lantern', cost: 150, max: 3, group: 'Decorations', where: 'edge', note: 'Glows after dusk. Evening visitors toss 15% more.' },
    stone: { name: 'Standing stone', cost: 60, max: 5, group: 'Zen garden', where: 'zen', note: 'Visitors linger. Coins come 3% more often.' },
    bonsai: { name: 'Bonsai pine', cost: 140, max: 3, group: 'Zen garden', where: 'zen', note: 'Visitors linger. Coins come 3% more often.' },
    bench: { name: 'Stone bench', cost: 120, max: 2, group: 'Zen garden', where: 'zen', note: 'Visitors linger. Coins come 3% more often.' },
    pagoda: { name: 'Stone pagoda', cost: 260, max: 1, group: 'Zen garden', where: 'zen', note: 'Visitors linger. Coins come 3% more often.' }
  };

  /* ---------- genetics ----------
     Each gene is a pair of alleles (indexes into the tables below).
     The lower index is dominant, so the rare looks hide in common fish. */
  var BASES = [
    { id: 'orange', name: 'Orange', col: '#c47a45', rar: 0, w: 0.34 },
    { id: 'white', name: 'White', col: '#d8d1be', rar: 0.1, w: 0.30 },
    { id: 'gold', name: 'Gold', col: '#c6a565', rar: 0.3, w: 0.20 },
    { id: 'charcoal', name: 'Charcoal', col: '#3b4047', rar: 0.6, w: 0.12 },
    { id: 'slate', name: 'Slate', col: '#6f8791', rar: 1.2, w: 0.04 }
  ];
  var PATTERNS = [
    { id: 'solid', word: '', rar: 0, w: 0.30 },
    { id: 'patched', word: 'patched', rar: 0.2, w: 0.35 },
    { id: 'saddle', word: 'saddled', rar: 0.4, w: 0.20 },
    { id: 'speckled', word: 'speckled', rar: 0.7, w: 0.10 },
    { id: 'crown', word: 'crowned', rar: 1.2, w: 0.05 }
  ];
  var SECONDS = [
    { id: 'cream', name: 'Cream', col: '#d9d1bd', rar: 0, w: 0.35 },
    { id: 'rust', name: 'Rust', col: '#bf6a38', rar: 0.2, w: 0.30 },
    { id: 'ink', name: 'Ink', col: '#2f3237', rar: 0.4, w: 0.22 },
    { id: 'gold', name: 'Gold', col: '#c9a85c', rar: 0.7, w: 0.13 }
  ];
  // a second colour that cannot be seen against this base
  var CONFLICT = { orange: 'rust', white: 'cream', gold: 'gold', charcoal: 'ink' };

  function phenotype(g) {
    var b = Math.min(g.base[0], g.base[1]);
    var p = Math.min(g.pattern[0], g.pattern[1]);
    var lo = Math.min(g.second[0], g.second[1]), hi = Math.max(g.second[0], g.second[1]);
    var hide = CONFLICT[BASES[b].id], s = -1;
    if (SECONDS[lo].id !== hide) s = lo; else if (SECONDS[hi].id !== hide) s = hi;
    if (s < 0) p = 0;
    if (p === 0) s = -1;
    return { base: b, pattern: p, second: s };
  }
  function varietyKey(g) { var ph = phenotype(g); return ph.base + '|' + ph.pattern + '|' + ph.second; }
  function varietyName(g) {
    var ph = phenotype(g);
    if (ph.pattern === 0) return 'Solid ' + BASES[ph.base].name;
    return SECONDS[ph.second].name + '-' + PATTERNS[ph.pattern].word + ' ' + BASES[ph.base].name;
  }
  function rarity(g) {
    var ph = phenotype(g);
    return BASES[ph.base].rar + PATTERNS[ph.pattern].rar + (ph.second >= 0 ? SECONDS[ph.second].rar : 0);
  }
  var VARIETIES = (function () {
    var seen = {}, list = [], b, p, s;
    for (b = 0; b < BASES.length; b++) for (p = 0; p < PATTERNS.length; p++) for (s = 0; s < SECONDS.length; s++) {
      var g = { base: [b, b], pattern: [p, p], second: [s, s] }, k = varietyKey(g);
      if (!seen[k]) { seen[k] = 1; list.push({ key: k, name: varietyName(g), genes: g }); }
    }
    return list;
  })();
  var BOOK_TOTAL = VARIETIES.length;

  /* What a pair can have, with the chance of each look (mutation aside). */
  function outcomes(a, b) {
    var map = {}, list = [], i;
    for (i = 0; i < 64; i++) {
      var g = { base: [a.base[i & 1], b.base[(i >> 1) & 1]],
                pattern: [a.pattern[(i >> 2) & 1], b.pattern[(i >> 3) & 1]],
                second: [a.second[(i >> 4) & 1], b.second[(i >> 5) & 1]] };
      var key = varietyKey(g);
      if (!map[key]) { map[key] = { key: key, name: varietyName(g), genes: g, p: 0 }; list.push(map[key]); }
      map[key].p += 1 / 64;
    }
    list.sort(function (x, y) { return y.p - x.p; });
    return list;
  }

  function weighted(table, rng) {
    var r = rng(), i;
    for (i = 0; i < table.length; i++) { r -= table[i].w; if (r < 0) return i; }
    return table.length - 1;
  }
  function randomGenes(rng) {
    return { base: [weighted(BASES, rng), weighted(BASES, rng)],
             pattern: [weighted(PATTERNS, rng), weighted(PATTERNS, rng)],
             second: [weighted(SECONDS, rng), weighted(SECONDS, rng)] };
  }
  function passOn(pair, table, rng) {
    var a = pair[rng() < 0.5 ? 0 : 1];
    if (rng() < T.mutation) a = (rng() * table.length) | 0;
    return a;
  }
  function inherit(a, b, rng) {
    return { base: [passOn(a.base, BASES, rng), passOn(b.base, BASES, rng)],
             pattern: [passOn(a.pattern, PATTERNS, rng), passOn(b.pattern, PATTERNS, rng)],
             second: [passOn(a.second, SECONDS, rng), passOn(b.second, SECONDS, rng)] };
  }

  var NAMES = ['Miso', 'Plum', 'Ember', 'Reed', 'Pebble', 'Mochi', 'Sora', 'Kumo', 'Hana', 'Taro', 'Yuzu', 'Fern',
    'Moss', 'Opal', 'Wren', 'Sumi', 'Nori', 'Kiri', 'Maple', 'Dusk', 'Tansy', 'Bo', 'Ume', 'Ash', 'Clover', 'Juno',
    'Sable', 'Pip', 'Lark', 'Suki', 'Indigo', 'Birch', 'Hazel', 'Momo', 'Rin', 'Sage', 'Koto', 'Brook', 'Fig', 'Aki'];

  var TEMPERS = [{ id: 'bold', name: 'Bold' }, { id: 'shy', name: 'Shy' }, { id: 'greedy', name: 'Greedy' }, { id: 'gentle', name: 'Gentle' }];
  var STAGES = ['Fry', 'Young', 'Adult', 'Elder'];
  var WHO = ['The tea house', 'A neighbour', 'The village school', 'A travelling painter', 'The temple garden',
    'A collector from the city', 'The innkeeper', 'A grandmother'];
  function bondWord(b) { return b < 0.12 ? 'Wary of you' : b < 0.35 ? 'Getting used to you' : b < 0.7 ? 'Knows you' : 'Trusts you'; }

  /* ---------- the pond ---------- */
  var WANDER = 0, FLEE = 1, WARY = 2, CURIOUS = 3;

  function Game(W, H, seed) {
    this.seed = (seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    this.W = W; this.H = H;
    this.time = 0; this.pondTime = 0; this.sitting = 0;
    this.sinceInput = 0; this.sinceTouch = 0; this.timeScale = 1;
    this.idleTimer = 4 + this.rng() * 5;
    this.step_ = 0;
    this.koi = []; this.pellets = []; this.pads = []; this.pairs = [];
    this.coins = 60; this.coinFrac = 0; this.nextId = 1;
    this.book = {}; this.offers = []; this.offerLeft = T.dealerRefresh;
    this.events = [];
    this.cues = [];           // things worth a sound: { k, x (0..1 across the pond), s }
    this.settledFor = 0;
    this.requests = [null, null, null]; this.requestWait = [0, 0, 0];
    this.shows = {};                                       // show id -> the name of the koi that won it
    this.plants = [];
    this.hand = { x: 0, y: 0, on: false, offer: false };   // where the player's hand is over the water
    this.tossed = []; this.visitors = []; this.floaters = []; this.sparks = [];
    this.unlocked = { home: true };
    this.lots = { home: { kind: 'pond', level: 1, till: 0 } };   // the lake, and the tea house once built
    this.stats = { fed: 0, picked: 0, pairs: 0, tills: 0, requests: 0, upgrades: 0, guests: 0, gate: 0, lost: 0, wild: 0, herons: 0 };
    this.works = { falls: false, bridge: false };          // lake works built (the tea house is a lot, for its till)
    this.seasonClock = 0;                                  // real seconds the year has run
    this.happ = { next: 14, list: [], wildAt: 0 };         // what is going on at the lake just now
    this.drifts = [];                                      // petals and leaves the wind has put on the water
    this.gate = { till: 0, level: 1 };
    this.watch = false;      // Watch mode: sit back and let the caretaker look after things
    this.keeper = null;      // the caretaker, while there is one in the garden
    this.cat = null;         // the cat who lives by the Home Pond
    this.goal = 0; this.guestIn = 6;
    this.goods = {};
    this.cam = { x: 0, y: 0 }; this.camTo = null;   // top left of the view, in world pixels
    this.gox = 0; this.goy = 0;                     // where the wave grid sits in the world
    this._buildField();
    this.popped = 0;
    this.rain = { on: false, timer: 240 + this.rng() * 300, amt: 0 };
    this.fly = { state: 'away', timer: 20 + this.rng() * 30, x: 0, y: 0, a: 0, pad: 0, tx: 0, ty: 0, wing: 0 };
    this.frog = { pad: -1, timer: 25 + this.rng() * 20, a: 0 };
    this._makeGrid(); this._sizes();
  }

  Game.fresh = function (W, H, seed) {
    var g = new Game(W, H, seed);
    g.cam.x = SHAPES.home.cx - W / 2; g.cam.y = SHAPES.home.cy - H / 2;
    g._clampCam(); g._syncGrid();
    g.addKoi({ base: [0, 3], pattern: [1, 2], second: [0, 2] }, T.growAdult, 1.0);
    g.addKoi({ base: [1, 2], pattern: [1, 3], second: [1, 3] }, T.growAdult, 0.96);
    g.addKoi({ base: [1, 4], pattern: [2, 4], second: [2, 3] }, T.growYoung * 1.4, 1.05);
    g.addPad(true); g.addPad(true); g.pads[1].flower = true;
    g.koi[0].temper = 0; g.koi[1].temper = 3; g.koi[2].temper = 1;
    g.coins = 100;
    for (var i = 0; i < 3; i++) { g.koi[i].bond = 0.15; g.requests[i] = g._newRequest(); }
    g._refreshOffers();
    g._placeCat();
    g.events.length = 0;
    return g;
  };

  Game.prototype._makeGrid = function () {
    var g = Water.chooseGrid(this.W, this.H);
    this.grid = new Water.WaveGrid(g.w, g.h);
    this.cx = this.W / g.w; this.cy = this.H / g.h;
  };
  Game.prototype._sizes = function () {
    this.fishBase = clamp(AH * 0.115, 40, 92);
    this.padBase = clamp(AH * 0.072, 24, 54);
  };
  Game.prototype.gx = function (x) { return (x - this.gox) / this.cx - 0.5; };
  Game.prototype.gy = function (y) { return (y - this.goy) / this.cy - 0.5; };

  /* The window changed size. The world stays as it is; only the view and its wave grid change. */
  Game.prototype.resize = function (W, H) {
    this.W = W; this.H = H;
    this._makeGrid();
    this.gox = this.goy = 0;
    this._clampCam(); this._syncGrid();
    this._constrain();
  };

  /* ---------- the world: areas, walls, camera ---------- */
  Game.prototype.kindOf = function (id) { return this.lots[id] ? this.lots[id].kind : null; };
  Game.prototype.isWater = function (col, row) {
    var a = areaAt(col, row);
    return !!(a && this.kindOf(a.id) === 'pond');
  };
  Game.prototype.waterAreas = function () {
    var out = [], i;
    for (i = 0; i < AREAS.length; i++) if (this.kindOf(AREAS[i].id) === 'pond') out.push(AREAS[i]);
    return out;
  };
  /* Ponds on neighbouring plots run together into one: the water between them is a broad neck,
     nearly as wide as the ponds themselves, not a ditch. { x0, y0, x1, y1, w } with w half its width. */
  Game.prototype.channels = function () { return []; };
  /* The shoreline, as closed loops of points about 20 apart, for drawing. Islands are loops too.
     Traced once from the field each time the water changes. */
  Game.prototype.shore = function () {
    if (this._loops) return this._loops;
    var fw = this.fw, fh = this.fh, f = this.field, next = {}, pts = {}, x, y;
    var CASES = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
                  9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
    function link(a, b) { (next[a] || (next[a] = [])).push(b); (next[b] || (next[b] = [])).push(a); }
    for (y = 0; y < fh - 1; y++) for (x = 0; x < fw - 1; x++) {
      var i = y * fw + x, tl = f[i], tr = f[i + 1], bl = f[i + fw], br = f[i + fw + 1];
      var code = (tl > 0 ? 1 : 0) | (tr > 0 ? 2 : 0) | (br > 0 ? 4 : 0) | (bl > 0 ? 8 : 0), segs = CASES[code], k;
      if (!segs) continue;
      // each crossing sits on an edge of this cell: 0 top, 1 right, 2 bottom, 3 left
      var id = [2 * i, 2 * (i + 1) + 1, 2 * (i + fw), 2 * i + 1];
      if (!pts[id[0]]) pts[id[0]] = [(x + tl / (tl - tr)) * FC, y * FC];
      if (!pts[id[1]]) pts[id[1]] = [(x + 1) * FC, (y + tr / (tr - br)) * FC];
      if (!pts[id[2]]) pts[id[2]] = [(x + bl / (bl - br)) * FC, (y + 1) * FC];
      if (!pts[id[3]]) pts[id[3]] = [x * FC, (y + tl / (tl - bl)) * FC];
      for (k = 0; k < segs.length; k++) link(id[segs[k][0]], id[segs[k][1]]);
    }
    var loops = [], seen = {}, key;
    for (key in next) {
      if (seen[key]) continue;
      var loop = [], cur = key, prev = null, guard = 0;
      while (cur !== undefined && !seen[cur] && guard++ < 200000) {
        seen[cur] = 1;
        if (guard % 2) loop.push(pts[cur]);
        var nb = next[cur], go = String(nb[0]) !== String(prev) ? nb[0] : nb[1];
        prev = cur; cur = go === undefined ? undefined : String(go);
      }
      if (loop.length > 5) loops.push(loop);
    }
    this._loops = loops;
    return loops;
  };
  /* Work out where the water is and how far each spot is from the bank. Done once, and again
     whenever a pond opens. depth() then answers in no time, for any shape of water. */
  Game.prototype._buildField = function () {
    var fw = Math.ceil(COLS * AW / FC) + 1, fh = Math.ceil(ROWS * AH / FC) + 1, n = fw * fh;
    var wet = new Uint8Array(n), ch = [], x, y, i;
    var lv = this.lots.home ? this.lots.home.level : 1;
    for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) wet[y * fw + x] = lakeD(x * FC, y * FC, lv, 1.3) < 0 ? 1 : 0;
    // distance to the nearest cell of the other kind, by two sweeps
    function sweep(zeroWhere) {
      var d = new Float32Array(n), A = FC, B = FC * 1.4142, v, j;
      for (j = 0; j < n; j++) d[j] = wet[j] === zeroWhere ? 0 : 1e9;
      for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) {
        j = y * fw + x; v = d[j];
        if (x > 0 && d[j - 1] + A < v) v = d[j - 1] + A;
        if (y > 0) {
          if (d[j - fw] + A < v) v = d[j - fw] + A;
          if (x > 0 && d[j - fw - 1] + B < v) v = d[j - fw - 1] + B;
          if (x < fw - 1 && d[j - fw + 1] + B < v) v = d[j - fw + 1] + B;
        }
        d[j] = v;
      }
      for (y = fh - 1; y >= 0; y--) for (x = fw - 1; x >= 0; x--) {
        j = y * fw + x; v = d[j];
        if (x < fw - 1 && d[j + 1] + A < v) v = d[j + 1] + A;
        if (y < fh - 1) {
          if (d[j + fw] + A < v) v = d[j + fw] + A;
          if (x < fw - 1 && d[j + fw + 1] + B < v) v = d[j + fw + 1] + B;
          if (x > 0 && d[j + fw - 1] + B < v) v = d[j + fw - 1] + B;
        }
        d[j] = v;
      }
      return d;
    }
    var toLand = sweep(0), toWater = sweep(1), f = new Float32Array(n);
    for (i = 0; i < n; i++) f[i] = wet[i] ? toLand[i] - FC / 2 : -(toWater[i] - FC / 2);
    this.field = f; this.fw = fw; this.fh = fh;
    // where a person can walk: dry land inside the wall, and the bridges
    var walk = new Uint8Array(n), toGate = new Int32Array(n), queue = new Int32Array(n), head = 0, tail = 0, j, k2;
    var m = Math.ceil((WALL + 10) / FC);
    for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) {
      i = y * fw + x;
      var ok = f[i] < -14 && x >= m && y >= m && x < fw - m && y < fh - m;
      // the moon bridge, once built, runs from the top bank out to the island
      if (!ok && this.works && this.works.bridge && Math.abs(x * FC - ISLE.x) < 26 && y * FC > 60 && y * FC < ISLE.y) ok = true;
      walk[i] = ok ? 1 : 0; toGate[i] = -1;
    }
    for (j = 0; j < GATES.length; j++) {
      // step in from the wall to the first walkable cell
      var gx = GATES[j].x, gy = GATES[j].y;
      for (k2 = 0; k2 < 12; k2++) {
        i = Math.round(gy / FC) * fw + Math.round(gx / FC);
        if (walk[i]) { toGate[i] = 0; queue[tail++] = i; break; }
        gx += Math.cos(GATES[j].a) * FC; gy += Math.sin(GATES[j].a) * FC;
      }
    }
    var NB = [-1, 1, -fw, fw, -fw - 1, -fw + 1, fw - 1, fw + 1];
    while (head < tail) {
      i = queue[head++];
      for (j = 0; j < 8; j++) {
        k2 = i + NB[j];
        if (k2 < 0 || k2 >= n || !walk[k2] || toGate[k2] >= 0) continue;
        if (Math.abs((k2 % fw) - (i % fw)) > 1) continue;
        toGate[k2] = toGate[i] + 1; queue[tail++] = k2;
      }
    }
    this.walk = walk; this.toGate = toGate; this._loops = null;
    // where the waterfall spills in: the bank straight up from the middle of the bay
    for (y = Math.round(LAKE.lv[lv - 1][1] / FC); y > 0 && f[y * fw + Math.round(FALLS_X / FC)] > 0; y--);
    this.fallsAt = [FALLS_X, y * FC];
    if (this.cat && !this.walkable(this.cat.x, this.cat.y)) this._placeCat();
    if (this.keeper) this.keeper = null;
    this._shapeKey();
  };
  /* How far a point is from the bank: positive in the water, negative on land. */
  Game.prototype.depth = function (x, y) {
    var fw = this.fw, fh = this.fh, f = this.field;
    var gx = clamp(x / FC, 0, fw - 1.001), gy = clamp(y / FC, 0, fh - 1.001);
    var ix = gx | 0, iy = gy | 0, tx = gx - ix, ty = gy - iy, i = iy * fw + ix;
    return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + fw] * (1 - tx) + f[i + fw + 1] * tx) * ty;
  };
  /* Which way is deeper water from here, as a unit vector. */
  Game.prototype.inward = function (x, y) {
    var gx = this.depth(x + 8, y) - this.depth(x - 8, y), gy = this.depth(x, y + 8) - this.depth(x, y - 8);
    var m = Math.hypot(gx, gy);
    if (m < 1e-6) { var a = this.pondNear(x, y), sh = SHAPES[a.id]; gx = sh.cx - x; gy = sh.cy - y; m = Math.hypot(gx, gy) || 1; }
    return [gx / m, gy / m];
  };
  Game.prototype.pondNear = function (x, y) {
    var ws = this.waterAreas(), best = ws[0], bd = 1e18, i;
    for (i = 0; i < ws.length; i++) {
      var sh = SHAPES[ws[i].id], d = (sh.cx - x) * (sh.cx - x) + (sh.cy - y) * (sh.cy - y);
      if (d < bd) { bd = d; best = ws[i]; }
    }
    return best;
  };
  /* Push a point back into the water, keeping m away from the bank. */
  Game.prototype.clampIn = function (x, y, m) {
    var i, d, g;
    for (i = 0; i < 30; i++) {
      d = this.depth(x, y);
      if (d >= m) return [x, y];
      g = this.inward(x, y);
      var stepLen = Math.min(60, m - d + 1.5);
      x += g[0] * stepLen; y += g[1] * stepLen;
    }
    if (this.depth(x, y) < 0) { var sh = SHAPES[this.pondNear(x, y).id]; return [sh.cx, sh.cy]; }
    return [x, y];
  };
  Game.prototype.onWater = function (x, y) { return this.depth(x, y) > 0; };
  Game.prototype.onSand = function (x, y) { var a = this.areaUnder(x, y); return this.kindOf(a.id) === 'zen' && inBlob(SHAPES[a.id], x, y); };
  Game.prototype.onMarket = function (x, y) { return inBlob(SHAPES.market, x, y); };
  /* A random spot in a pond, at least m from its bank. */
  Game.prototype.spotIn = function (area, m) {
    var sh = SHAPES[area.id], rng = this.rng, t, x = sh.cx, y = sh.cy;
    for (t = 0; t < 80; t++) {
      var p = [sh.cx + (rng() - 0.5) * 1500, sh.cy + (rng() - 0.5) * 900];
      if (this.depth(p[0], p[1]) >= m) return p;
    }
    return [x, y];
  };
  Game.prototype.areaUnder = function (x, y) {
    return areaAt(clamp(Math.floor(x / AW), 0, COLS - 1), clamp(Math.floor(y / AH), 0, ROWS - 1));
  };
  /* The area in the middle of the view. */
  Game.prototype.focusArea = function () { return this.areaUnder(this.cam.x + this.W / 2, this.cam.y + this.H / 2); };
  /* There is one lake. These answer the questions the many ponds used to. */
  Game.prototype.sections = function (pond) { return pond === 'home' ? 1 : 0; };
  Game.prototype.pondsOpen = function () { return 1; };
  Game.prototype.capacity = function () { return LAKE_CAP[clamp(this.lots.home.level, 1, 4) - 1]; };
  Game.prototype.pondCap = function (pond) { return pond === 'home' ? this.capacity() : 0; };
  Game.prototype.pondCount = function (pond) { return pond === 'home' ? this.koi.length : 0; };
  Game.prototype.pondAt = function () { return 'home'; };
  Game.prototype.accepts = function () { return ''; };
  Game.prototype.likes = function () { return 'any'; };
  Game.prototype.canMove = function () { return 'There is only the one lake.'; };
  Game.prototype.move = function () { return false; };
  Game.prototype.roomFor = function () { return this.koi.length < this.capacity() ? 'home' : null; };
  Game.prototype._shapeKey = function () {
    var ids = Object.keys(this.lots).sort(), k = '', i;
    for (i = 0; i < ids.length; i++) k += ids[i] + this.lots[ids[i]].kind + this.lots[ids[i]].level + ',';
    k += (this.works && this.works.bridge ? 'b' : '') + (this.works && this.works.falls ? 'f' : '');
    this.shapeKey = k;
  };

  /* ---------- building ---------- */
  Game.prototype.built = function (kind) {
    var n = 0, id;
    for (id in this.lots) if (this.lots[id].kind === kind) n++;
    return n;
  };
  /* How much of a kind you have, counting a level 2 as 1.6 and a level 3 as 2.3. */
  Game.prototype.power = function (kind) {
    var n = 0, id;
    for (id in this.lots) if (this.lots[id].kind === kind) n += LEVEL[this.lots[id].level - 1];
    return n;
  };
  /* A plot can be built on once it is beside one you already have. */
  /* A section of a pond can be opened if it is that pond's first, or lies beside one already open.
     A plot on the street can be built on once it is beside something you have. */
  /* The ponds open in order, each only once the one before it is fully built (all four sections open).
     '' if this pond may be opened, else why not. A pond already open stays open. */
  Game.prototype.pondLocked = function (pond) {
    var i;
    for (i = 1; i < BIOMES.length; i++) if (BIOMES[i].id === pond) break;
    if (i >= BIOMES.length || this.sections(pond)) return '';
    var prev = BIOMES[i - 1];
    return this.sections(prev.id) >= 4 ? '' : 'Finish all four sections of the ' + prev.name + ' first.';
  };
  Game.prototype.reachable = function (id) {
    var a = areaById(id), d, D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (!a) return false;
    if (a.first) return !this.pondLocked(a.biome);
    for (d = 0; d < 4; d++) {
      var b = areaAt(a.col + D[d][0], a.row + D[d][1]);
      if (b && this.lots[b.id] && (!a.biome || b.biome === a.biome)) return true;
    }
    return false;
  };
  Game.prototype.buildCost = function (id, kind) {
    var a = areaById(id);
    if (kind === 'pond' && a && a.biome) {
      // each further section of a pond costs more than the last
      var b = biomeById(a.biome), n = this.sections(a.biome);
      return Math.round(b.price * (a.biome === 'home' ? [1, 1, 1.7, 2.7][Math.min(3, n)] : 1 + 0.6 * n) / 10) * 10;
    }
    return KINDS[kind].cost;
  };
  Game.prototype.canBuild = function (id, kind) {
    var a = areaById(id);
    if (!a || !KINDS[kind] || KINDS[kind].fixed) return 'That cannot be built.';
    if (this.lots[id]) return 'This plot is already built on.';
    if (a.biome && kind !== 'pond') return 'This is part of the ' + biomeById(a.biome).name + '.';
    if (!a.biome && kind === 'pond') return 'Ponds do not go on the street.';
    if (a.biome && this.pondLocked(a.biome)) return this.pondLocked(a.biome);
    if (!this.reachable(id)) return a.biome ?'Open the section beside this one first.' : 'Build beside what you already have first.';
    if (this.coins < this.buildCost(id, kind)) return 'Needs ' + this.buildCost(id, kind) + ' coins.';
    return '';
  };
  Game.prototype.build = function (id, kind) {
    if (this.canBuild(id, kind)) return false;
    var a = areaById(id);
    this.coins -= this.buildCost(id, kind);
    this.lots[id] = { kind: kind, level: 1, till: 0 };
    this.unlocked[id] = true;
    this._buildField();
    if (kind === 'pond') { this.addPad(true, false, a); this.addPad(true, this.rng() < 0.4, a); }
    this.events.push({ kind: 'unlock', text: kind === 'pond' ? (this.sections(a.biome) === 1 ? 'The ' + biomeById(a.biome).name + ' is open.' : 'The ' + biomeById(a.biome).name + ' is bigger.') : KINDS[kind].name + ' built.' });
    this.lookAt(id);
    return true;
  };
  Game.prototype.upgradeCost = function (id) {
    var lot = this.lots[id];
    if (!lot) return 0;
    if (id === 'home') return lot.level < 4 ? LAKE_COST[lot.level - 1] : 0;
    if (lot.level >= 3) return 0;
    return Math.round(KINDS[lot.kind].cost * [1.5, 2.5][lot.level - 1] / 10) * 10;
  };
  Game.prototype.upgrade = function (id) {
    var lot = this.lots[id], cost = this.upgradeCost(id);
    if (!lot || !cost || this.coins < cost) return false;
    this.coins -= cost;
    lot.level++;
    this.stats.upgrades++;
    if (id === 'home') {
      this._buildField();
      this.addPad(true, false, AREAS[0]);
      this.events.push({ kind: 'unlock', text: 'The lake is bigger: room for ' + this.capacity() + ' koi.' });
    } else {
      this._shapeKey();
      this.events.push({ kind: 'unlock', text: KINDS[lot.kind].name + ' is now level ' + lot.level + '.' });
    }
    return true;
  };
  /* Lake works. '' if this one can be built now, else why not. */
  Game.prototype.hasWork = function (id) { return id === 'tea' ? !!this.lots.tea : !!this.works[id]; };
  Game.prototype.canWork = function (id) {
    var w = WORKS[id];
    if (!w) return 'No such thing.';
    if (this.hasWork(id)) return 'Already built.';
    if (this.coins < w.cost) return 'Needs ' + w.cost + ' coins.';
    return '';
  };
  Game.prototype.buildWork = function (id) {
    if (this.canWork(id)) return false;
    this.coins -= WORKS[id].cost;
    if (id === 'tea') { this.lots.tea = { kind: 'tea', level: 1, till: 0 }; this.unlocked.tea = true; this._shapeKey(); }
    else { this.works[id] = true; this._buildField(); }
    this.stats.upgrades++;
    this.events.push({ kind: 'unlock', text: WORKS[id].name + ' built.' });
    return true;
  };
  Game.prototype.tillCap = function (id) {
    var lot = this.lots[id];
    return lot && KINDS[lot.kind].cap ? Math.round(KINDS[lot.kind].cap * LEVEL[lot.level - 1]) : 0;
  };
  /* Take what the guests have left at a building. */
  Game.prototype.collect = function (id) {
    var lot = this.lots[id], n = lot ? Math.floor(lot.till) : 0, sh = SHAPES[id];
    if (n < 1) return 0;
    lot.till -= n;
    this.coins += n;
    this.stats.tills++;
    this.floaters.push({ x: sh.cx, y: sh.cy - 60, text: '+' + n, age: 0 });
    this._cue('pick', sh.cx, 1);
    this.touch();
    return n;
  };
  /* ---------- the caretaker ----------
     In Watch mode a caretaker walks the garden doing what you would: feeding hungry koi, and bringing in the
     takings when the gate or a till is getting full. They are slower than you, and keep a quarter of what they carry. */
  Game.prototype.setWatch = function (on) {
    this.watch = !!on;
    if (on) this.touch();
  };
  Game.prototype._keeperHome = function () { return [860, 896]; };
  Game.prototype._keeperGo = function (kp, x, y, job) {
    var path = this.routeBetween(kp.x, kp.y, x, y);
    if (!path || path.length < 2) { kp.state = 'idle'; kp.timer = 3; return false; }
    kp.path = path; kp.pi = 1; kp.state = 'walk'; kp.job = job;
    return true;
  };
  Game.prototype._keeperChoose = function (kp) {
    var rng = this.rng, id, i, spot;
    if (this.gate.till >= 0.6 * this.gateCap()) { var st = this.gateAt(); this._keeperGo(kp, st.x + 40, st.y + 46, { what: 'gate' }); return; }
    for (id in this.lots) {
      var cap = this.tillCap(id);
      if (cap && this.lots[id].till >= 0.6 * cap) { spot = this._spot(id, null); if (spot && this._keeperGo(kp, spot[0], spot[1], { what: 'till', id: id })) return; }
    }
    var hungry = null;
    for (i = 0; i < this.koi.length; i++) if (this.koi[i].full < 0.45 && (!hungry || this.koi[i].full < hungry.full)) hungry = this.koi[i];
    if (hungry) {
      id = this.pondNear(hungry.x, hungry.y).id; spot = this._spot(id, hungry);
      if (spot && this._keeperGo(kp, spot[0], spot[1], { what: 'feed', pond: id, koi: hungry.id, left: 3 })) return;
    }
    if (rng() < 0.5) { spot = this._spot('home', null); if (spot && this._keeperGo(kp, spot[0], spot[1], { what: 'rest' })) return; }
    kp.state = 'idle'; kp.timer = 4 + rng() * 6;
  };
  Game.prototype._stepKeeper = function (dt) {
    var kp = this.keeper, rng = this.rng, home = this._keeperHome();
    if (!kp) {
      if (!this.watch || !this.walkable(home[0], home[1])) return;
      kp = this.keeper = { x: home[0], y: home[1], a: -1.57, state: 'idle', timer: 1.5, path: null, pi: 0, job: null, keeper: true,
                           seed: 7, phase: 0, throwT: 0, stops: ['home'], si: 0, koi: 0, speed: 118 };
    }
    if (kp.throwT > 0) kp.throwT = Math.max(0, kp.throwT - dt * 2.2);
    if (kp.state === 'walk') {
      var tp = kp.path[kp.pi], dx = tp[0] - kp.x, dy = tp[1] - kp.y, d = Math.hypot(dx, dy), step = kp.speed * dt;
      kp.phase += dt * 8.5;
      if (d > 0.01) { kp.a += wrapAngle(Math.atan2(dy, dx) - kp.a) * Math.min(1, dt * 9); kp.x += dx / d * Math.min(step, d); kp.y += dy / d * Math.min(step, d); }
      if (d <= step && ++kp.pi >= kp.path.length) {
        if (kp.job && kp.job.what === 'leave') { this.keeper = null; return; }
        kp.state = 'work'; kp.timer = 0.7;
      }
      return;
    }
    kp.timer -= dt;
    if (kp.timer > 0) return;
    if (!this.watch) {
      // you are back at it: the caretaker walks home to the Market
      if (Math.hypot(kp.x - home[0], kp.y - home[1]) < 30 || !this._keeperGo(kp, home[0], home[1], { what: 'leave' })) this.keeper = null;
      return;
    }
    var job = kp.job;
    if (kp.state === 'work' && job) {
      var n, pay;
      if (job.what === 'gate') { n = Math.floor(this.gate.till); this.gate.till -= n; }
      else if (job.what === 'till' && this.lots[job.id]) { n = Math.floor(this.lots[job.id].till); this.lots[job.id].till -= n; }
      if (n > 0) {
        pay = Math.round(n * 0.75);
        this.coins += pay;
        this.floaters.push({ x: kp.x, y: kp.y - 30, text: '+' + pay, age: 0 });
        this._cue('pick', kp.x, 0.6);
      }
      if (job.what === 'feed' && job.left > 0 && this.byId(job.koi)) {
        kp.stops = [job.pond]; kp.si = 0; kp.koi = job.koi;
        this._throw(kp, this.byId(job.koi));
        job.left--; kp.timer = 1.3;
        return;
      }
      if (job.what === 'rest') { kp.job = null; kp.state = 'idle'; kp.timer = 6 + rng() * 8; return; }
    }
    kp.job = null;
    this._keeperChoose(kp);
  };

  /* ---------- the cat ----------
     A cat lives on the bank of the Home Pond. It watches the koi, wanders now and then, sleeps a lot, and likes to be stroked. */
  Game.prototype._placeCat = function () {
    var spot = this._spot('home', null) || [SHAPES.home.cx - 500, SHAPES.home.cy + 320];
    this.cat = { x: spot[0], y: spot[1], a: 0, state: 'sit', timer: 6, path: null, pi: 0, phase: 0, purr: 0 };
  };
  Game.prototype.petCat = function (x, y) {
    var c = this.cat;
    if (!c || Math.hypot(c.x - x, c.y - y) > 36) return false;
    c.purr = 1; c.state = 'sit'; c.timer = 10;
    this.floaters.push({ x: c.x, y: c.y - 26, text: 'purr', age: 0, kind: 'grow' });
    this._cue('purr', c.x, 1);
    this.touch();
    return true;
  };
  Game.prototype._stepCat = function (dt) {
    var c = this.cat, rng = this.rng, i;
    if (!c) return;
    c.phase += dt;
    if (c.purr > 0) c.purr = Math.max(0, c.purr - dt * 0.4);
    if (c.state === 'walk') {
      var tp = c.path[c.pi], dx = tp[0] - c.x, dy = tp[1] - c.y, d = Math.hypot(dx, dy), step = 62 * dt;
      if (d > 0.01) { c.a += wrapAngle(Math.atan2(dy, dx) - c.a) * Math.min(1, dt * 8); c.x += dx / d * Math.min(step, d); c.y += dy / d * Math.min(step, d); }
      if (d <= step && ++c.pi >= c.path.length) { c.state = 'sit'; c.timer = 10 + rng() * 14; }
      return;
    }
    if (c.state === 'sit') {
      // watch whichever koi is nearest
      var best = null, bd = 1e9;
      for (i = 0; i < this.koi.length; i++) { var dd = Math.hypot(this.koi[i].x - c.x, this.koi[i].y - c.y); if (dd < bd) { bd = dd; best = this.koi[i]; } }
      var want = best ? Math.atan2(best.y - c.y, best.x - c.x) : Math.atan2(SHAPES.home.cy - c.y, SHAPES.home.cx - c.x);
      c.a += wrapAngle(want - c.a) * Math.min(1, dt * 1.5);
    }
    c.timer -= dt;
    if (c.timer > 0) return;
    var r = rng();
    if (r < 0.3) { c.state = 'nap'; c.timer = 25 + rng() * 35; }
    else if (r < 0.7) {
      var spot = this._spot('home', null), path = spot ? this.routeBetween(c.x, c.y, spot[0], spot[1]) : null;
      if (path && path.length > 1) { c.path = path; c.pi = 1; c.state = 'walk'; } else { c.state = 'sit'; c.timer = 8; }
    } else { c.state = 'sit'; c.timer = 10 + rng() * 14; }
  };

  /* ---------- the ticket gate ---------- */
  Game.prototype.ticket = function () { return 4 + 2 * this.stars(); };
  Game.prototype.gateCap = function () { return GATE.caps[this.gate.level - 1]; };
  Game.prototype.gateUpgradeCost = function () { return this.gate.level < GATE.caps.length ? GATE.costs[this.gate.level - 1] : 0; };
  Game.prototype.upgradeGate = function () {
    var cost = this.gateUpgradeCost();
    if (!cost || this.coins < cost) return false;
    this.coins -= cost;
    this.gate.level++;
    this.stats.upgrades++;
    this.events.push({ kind: 'unlock', text: 'The ticket gate now holds ' + this.gateCap() + ' coins.' });
    return true;
  };
  Game.prototype.gateAt = function () { for (var i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === 'gate') return STATIONS[i]; };
  /* Fetch the takings. */
  Game.prototype.collectGate = function () {
    var n = Math.floor(this.gate.till), st = this.gateAt();
    if (n < 1) return 0;
    this.gate.till -= n;
    this.coins += n;
    this.stats.gate++;
    this.floaters.push({ x: st.x, y: st.y - 50, text: '+' + n, age: 0 });
    this._cue('pick', st.x, 1);
    this.touch();
    return n;
  };
  /* The walk in: from the south gate in the wall up to the ticket gate. Worked out once for each lie of the land. */
  Game.prototype._entry = function () {
    if (this._entryKey !== this.shapeKey) {
      var st = this.gateAt(), g0 = GATES[0];
      this._entryKey = this.shapeKey;
      this._entryPath = this.routeBetween(g0.x + Math.cos(g0.a) * 30, g0.y + Math.sin(g0.a) * 30, st.x, st.y + 46);
    }
    return this._entryPath;
  };

  /* The station under a point, or null. */
  Game.prototype.stationAt = function (x, y) {
    for (var i = 0; i < STATIONS.length; i++) {
      var st = STATIONS[i];
      if (Math.abs(x - st.x) < st.w && Math.abs(y - st.y) < st.h) return st;
    }
    return null;
  };
  /* The built plot whose shape is under a point, or null. */
  Game.prototype.lotAt = function (x, y) {
    return this.lots.tea && inBlob(SHAPES.tea, x, y) ? { id: 'tea' } : null;
  };

  /* ---------- the garden's name ---------- */
  Game.prototype.renown = function () {
    var r = 0, i, id;
    for (i = 0; i < this.koi.length; i++) r += this.koi[i].growth >= T.growAdult ? 10 : this.koi[i].growth >= T.growYoung ? 4 : 1;
    r += 6 * this.bookCount();
    for (id in this.lots) r += id === 'home' ? 40 * this.lots.home.level : KINDS[this.lots[id].kind].renown * LEVEL[this.lots[id].level - 1];
    for (id in this.works) if (this.works[id]) r += WORKS[id].renown;
    r += 1.5 * Math.min(60, this.plants.length + this.pads.length);
    r += 40 * Object.keys(this.shows || {}).length;      // every show won makes the garden better known
    return Math.round(r);
  };
  Game.prototype.stars = function () {
    var r = this.renown(), n = 1, i;
    for (i = 1; i < STARS.length; i++) if (r >= STARS[i]) n = i + 1;
    return n;
  };
  Game.prototype.maxGuests = function () { return 5 + 4 * this.stars(); };
  Game.prototype.goalNow = function () { return this.goal < GOALS.length ? GOALS[this.goal] : null; };
  Game.prototype.goalDone = function () { var g = this.goalNow(); return !!g && g.done(this); };
  Game.prototype.claimGoal = function () {
    var g = this.goalNow();
    if (!g || !g.done(this)) return 0;
    this.coins += g.reward;
    this.goal++;
    this.events.push({ kind: 'unlock', text: g.text + ': done. ' + g.reward + ' coins.' });
    return g.reward;
  };

  /* The view may roam over every open area, and lean a little way into its closed neighbours. */
  /* How far the top left of the view may go: { x0, x1, y0, y1 }. */
  Game.prototype.camLimits = function () {
    // the view never moves: the middle of the screen is the middle of the garden
    var x = AW / 2 - this.W / 2, y = AH / 2 - this.H / 2;
    return { x0: x, x1: x, y0: y, y1: y };
  };
  Game.prototype._clampCam = function () {
    var L = this.camLimits(), c = this.cam;
    c.x = clamp(c.x, L.x0, L.x1); c.y = clamp(c.y, L.y0, L.y1);
  };
  Game.prototype.glide = function (x, y) { this.camTo = { x: x, y: y }; };
  Game.prototype.panBy = function (dx, dy) {
    this.cam.x += dx; this.cam.y += dy; this.camTo = null;
    this._clampCam(); this._syncGrid();
  };
  Game.prototype.lookAt = function (id) {
    var a = areaById(id);
    if (a) this.camTo = { x: (a.col + 0.5) * AW - this.W / 2, y: (a.row + 0.5) * AH - this.H / 2 };
  };
  Game.prototype._stepCam = function (dt) {
    if (this.camTo) {
      var c = this.cam, k = Math.min(1, dt * 4), px = c.x, py = c.y;
      c.x += (this.camTo.x - c.x) * k; c.y += (this.camTo.y - c.y) * k;
      this._clampCam();
      if (Math.abs(c.x - px) + Math.abs(c.y - py) < 0.05) this.camTo = null;
    } else this._clampCam();
    this._syncGrid();
  };
  /* The wave grid covers only what is on screen, so its cost never grows with the world.
     When the view moves, the ripples are shifted by whole cells to stay where they were. */
  Game.prototype._syncGrid = function () {
    var g = this.grid, cx = this.cx, cy = this.cy;
    var dx = Math.round((Math.floor(this.cam.x / cx) * cx - this.gox) / cx);
    var dy = Math.round((Math.floor(this.cam.y / cy) * cy - this.goy) / cy);
    if (!dx && !dy) return;
    this.gox += dx * cx; this.goy += dy * cy;
    if (Math.abs(dx) >= g.w || Math.abs(dy) >= g.h) { g.cur.fill(0); g.prev.fill(0); g.drops.length = 0; return; }
    var sw = g.sw, sh = g.h + 2, bufs = [g.cur, g.prev], b, x, y;
    for (b = 0; b < 2; b++) {
      var a = bufs[b], old = a.slice();
      for (y = 0; y < sh; y++) {
        var sy = y + dy;
        for (x = 0; x < sw; x++) {
          var sx = x + dx;
          a[y * sw + x] = (sx >= 0 && sx < sw && sy >= 0 && sy < sh) ? old[sy * sw + sx] : 0;
        }
      }
    }
    for (b = 0; b < g.drops.length; b++) { g.drops[b].x -= dx; g.drops[b].y -= dy; }
  };

  /* ---------- koi records ---------- */
  Game.prototype._len = function (k) {
    var t = Math.min(1, k.growth / T.growAdult);
    var s = 0.28 + 0.72 * Math.pow(t, 0.8);
    if (k.growth > T.growAdult) s += 0.35 * Math.min(1, (k.growth - T.growAdult) / (T.growMax - T.growAdult));
    return this.fishBase * k.sizePot * s;
  };
  Game.prototype._fit = function (k) {
    k.len = this._len(k);
    k.base = Math.max(k.len * 0.34, 13);
  };
  function stageOf(k) {
    if (k.growth < T.growYoung) return 'Fry';
    if (k.growth < T.growAdult) return 'Young';
    if (k.growth < T.growAdult * 2) return 'Adult';
    return 'Elder';
  }
  Game.prototype.stage = stageOf;
  Game.prototype.value = function (k) {
    var t = Math.min(T.growMax / T.growAdult, k.growth / T.growAdult);
    return Math.max(1, Math.round((4 + 96 * Math.pow(t, 1.4)) * (1 + (k.growth >= T.growYoung ? rarity(k.genes) : 0)) * k.sizePot * k.sizePot));
  };
  Game.prototype.byId = function (id) {
    for (var i = 0; i < this.koi.length; i++) if (this.koi[i].id === id) return this.koi[i];
    return null;
  };
  Game.prototype.pairOf = function (id) {
    for (var i = 0; i < this.pairs.length; i++) if (this.pairs[i].a === id || this.pairs[i].b === id) return this.pairs[i];
    return null;
  };

  Game.prototype._name = function () {
    var rng = this.rng, n, t, i, used;
    for (t = 0; t < 30; t++) {
      n = NAMES[(rng() * NAMES.length) | 0]; used = false;
      for (i = 0; i < this.koi.length; i++) if (this.koi[i].name === n) used = true;
      if (!used) return n;
    }
    return n;
  };

  Game.prototype._embody = function (k, x, y) {
    var rng = this.rng, t, i;
    k.a = rng() * 6.283; k.turn = 0; k.wa = 0; k.phase = rng() * 6.283;
    k.mode = WANDER; k.timer = 0; k.t0 = 1; k.fx = 0; k.fy = 0; k.tx = 0; k.ty = 0; k.comeBack = false;
    k.nib = 0; k.tossIn = 30 + rng() * 80; k.pulse = 0; k.snack = 0;
    this._fit(k); k.v = k.base;
    if (x !== undefined) { k.x = x; k.y = y; return; }
    for (t = 0; t < 60; t++) {
      var pd = k.pond || 'home', ws = this.waterAreas().filter(function (w) { return w.biome === pd; });
      if (!ws.length) ws = [areaById('home')];
      var spot = this.spotIn(ws[(rng() * ws.length) | 0], 70);
      k.x = spot[0]; k.y = spot[1];
      var far = true;
      for (i = 0; i < this.koi.length; i++) {
        if (this.koi[i] !== k && Math.hypot(this.koi[i].x - k.x, this.koi[i].y - k.y) < k.len * 1.5) far = false;
      }
      if (far) break;
    }
  };

  Game.prototype.addKoi = function (genes, growth, sizePot, x, y, pond) {
    var rng = this.rng;
    var k = { id: this.nextId++, name: this._name(), genes: genes, seed: (rng() * 4294967296) >>> 0,
              sizePot: sizePot === undefined ? 0.85 + rng() * 0.3 : sizePot, growth: growth || 0, full: 0.6,
              bond: 0, temper: (rng() * TEMPERS.length) | 0, pond: pond || (x !== undefined ? this.pondAt(x, y) : 'home') };
    this.koi.push(k);
    this._embody(k, x, y);
    if (k.growth >= T.growYoung) this._note(k);
    return k;
  };
  Game.prototype._note = function (k) {
    var key = varietyKey(k.genes);
    if (!this.book[key]) {
      this.book[key] = 1;
      this.events.push({ kind: 'book', text: 'New in the Koi Book: ' + varietyName(k.genes) + '.' });
    }
  };
  Game.prototype.bookCount = function () { return Object.keys(this.book).length; };

  Game.prototype._cue = function (k, x, s) {
    if (this.cues.length < 24) this.cues.push({ k: k, x: clamp((x - this.cam.x) / this.W, -0.3, 1.3), s: s === undefined ? 1 : s });
  };

  /* ---------- things the player does ---------- */
  Game.prototype.touch = function () { this.sinceInput = 0; };
  Game.prototype.presence = function () {
    var p = 1 + (T.presenceMult - 1) * clamp((T.presenceHold + T.presenceFade - this.sinceInput) / T.presenceFade, 0, 1);
    // just watching still counts as being here, at half the pace of tending it yourself
    return this.watch ? Math.max(p, 2) : p;
  };

  /* A pebble at (x, y). quiet = made by the pond itself, koi ignore it. */
  Game.prototype.poke = function (x, y, strength, quiet) {
    var s = strength === undefined ? 1 : strength;
    x = clamp(x, 0, COLS * AW); y = clamp(y, 0, ROWS * AH);
    this.grid.drop(this.gx(x), this.gy(y), s);
    this._cue(quiet ? 'drip' : 'plop', x, s);
    if (quiet) return;
    this.touch(); this.sinceTouch = 0;
    this.idleTimer = 5 + this.rng() * 8;
    this._startle(x, y, 240, true);
    this._scare(x, y);
  };

  Game.prototype.wake = function (x0, y0, x1, y1) {
    var g = this.grid;
    var ax = this.gx(x0), ay = this.gy(y0), bx = this.gx(x1), by = this.gy(y1);
    var d = Math.hypot(bx - ax, by - ay);
    var n = Math.min(60, Math.max(1, Math.ceil(d / 1.5)));
    var amp = -0.2 * Math.min(1, d / n + 0.25);
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      g.bump(ax + (bx - ax) * t, ay + (by - ay) * t, 1.7, amp);
    }
    this.touch(); this.sinceTouch = 0;
    this._cue('wake', x1, Math.min(1, d / 6));
    this._startle(x1, y1, this.fishBase * 0.9, false);
  };

  /* A pinch of food: a few pellets and a soft ring. Koi are not startled by it. */
  Game.prototype.feed = function (x, y) {
    var rng = this.rng;
    var at = this.clampIn(x, y, 8);
    x = at[0]; y = at[1];
    for (var i = 0; i < 3; i++) {
      var pp = this.clampIn(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 30, 6);
      this.pellets.push({ x: pp[0], y: pp[1], age: 0, r: 2.2 + rng() * 1.2 });
    }
    while (this.pellets.length > 45) this.pellets.shift();
    this.grid.drop(this.gx(x), this.gy(y), 0.3);
    this._cue('food', x);
    this.stats.fed++;
    this.touch(); this.sinceTouch = 0;
  };

  Game.prototype.fishAt = function (x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.koi.length; i++) {
      var f = this.koi[i], d = Math.hypot(f.x - x, f.y - y);
      if (d < Math.max(20, f.len * 0.5) && d < bd) { bd = d; best = f; }
    }
    return best;
  };

  Game.prototype.canSell = function (k) {
    if (k.wild) return 'Welcome it to the lake first.';
    if (this.pairOf(k.id)) return 'Paired koi stay until their fry arrive.';
    if (this.koi.length <= 2) return 'Keep at least two koi in the pond.';
    return '';
  };
  Game.prototype.sell = function (id) {
    var k = this.byId(id);
    if (!k || this.canSell(k)) return false;
    var v = this.value(k);
    this.coins += v;
    this.koi.splice(this.koi.indexOf(k), 1);
    this.events.push({ kind: 'sold', text: k.name + ' went to a new home for ' + v + ' coins.' });
    return true;
  };

  Game.prototype.canPair = function (a, b) {
    if (!a || !b || a === b) return 'Choose two different koi.';
    if (stageOf(a) === 'Fry' || stageOf(a) === 'Young') return a.name + ' is not grown yet.';
    if (stageOf(b) === 'Fry' || stageOf(b) === 'Young') return b.name + ' is not grown yet.';
    if (this.pairOf(a.id)) return a.name + ' is already paired.';
    if (this.pairOf(b.id)) return b.name + ' is already paired.';
    if (a.wild || b.wild) return 'Welcome the wild koi first.';
    return '';
  };
  Game.prototype.pair = function (aId, bId) {
    var a = this.byId(aId), b = this.byId(bId);
    if (this.canPair(a, b)) return false;
    this.pairs.push({ a: a.id, b: b.id, left: T.pairTime / (1 + 0.25 * Math.min(2.3, this.power('hatchery'))), waiting: false });
    this.stats.pairs++;
    this.events.push({ kind: 'pair', text: a.name + ' and ' + b.name + ' are paired.' });
    return true;
  };

  Game.prototype._spawn = function (p, idx) {
    var a = this.byId(p.a), b = this.byId(p.b), rng = this.rng;
    if (!a || !b) { this.pairs.splice(idx, 1); return; }
    var room = this.pondCap(a.pond) - this.pondCount(a.pond);
    if (room <= 0) {
      p.left = 0;
      if (!p.waiting) {
        p.waiting = true;
        this.events.push({ kind: 'full', text: 'The pond is full. ' + a.name + ' and ' + b.name + ' are waiting for room.' });
      }
      return;
    }
    var n = Math.min(room, 3 + ((rng() * 6) | 0));
    for (var i = 0; i < n; i++) {
      var pot = clamp((a.sizePot + b.sizePot) / 2 + (rng() - 0.5) * 0.16, 0.75, 1.3);
      var ang = rng() * 6.283, rr = a.len * (0.3 + rng() * 0.5);
      var born = this.clampIn(a.x + Math.cos(ang) * rr, a.y + Math.sin(ang) * rr, 10);
      var c = this.addKoi(inherit(a.genes, b.genes, rng), 0, pot, born[0], born[1], a.pond);
      c.full = 0.5;
    }
    this.pairs.splice(idx, 1);
    this.events.push({ kind: 'fry', text: a.name + ' and ' + b.name + ' have ' + n + ' fry.' });
    this.poke(a.x, a.y, 0.5, true);
  };

  Game.prototype._refreshOffers = function () {
    this.offers = [];
    for (var i = 0; i < 3; i++) {
      var o = { genes: randomGenes(this.rng), sizePot: 0.88 + this.rng() * 0.26, growth: T.growYoung * 1.1 };
      o.price = Math.round(this.value(o) * 1.6) + 10;
      this.offers.push(o);
    }
    this.offerLeft = T.dealerRefresh;
  };
  Game.prototype.buy = function (i) {
    var o = this.offers[i];
    var to = o ? this.roomFor(o.genes, o.growth) : null;
    if (!o || this.coins < o.price || !to) return false;
    this.coins -= o.price;
    var k = this.addKoi(o.genes, o.growth, o.sizePot, undefined, undefined, to);
    this.offers[i] = null;
    this.events.push({ kind: 'bought', text: k.name + ' has joined the ' + biomeById(to).name + '.' });
    this.poke(k.x, k.y, 0.5, true);
    return true;
  };

  Game.prototype.addPad = function (free, lotus, area, x, y) {
    area = area || this._gardenArea();
    var cost = lotus ? T.lotusCost : T.padCost;
    if (!free) { if (this.coins < cost) return false; this.coins -= cost; }
    var rng = this.rng, i = this.pads.length, t, k;
    var pad = { x: 0, y: 0, vx: 0, vy: 0, rot: rng() * 6.283, rotv: 0, k: 0.78 + rng() * 0.5,
                r: 0, bob: 0, tx: 0, ty: 0, flower: lotus ? true : rng() < 0.3, lotus: !!lotus, tone: i % 3 };
    pad.r = this.padBase * pad.k;
    if (x !== undefined) { pad.x = x; pad.y = y; }
    for (t = 0; t < 80 && x === undefined; t++) {
      var ps = this.spotIn(area, pad.r + 10);
      pad.x = ps[0]; pad.y = ps[1];
      var ok = true;
      for (k = 0; k < this.pads.length; k++) {
        var q = this.pads[k];
        if (Math.hypot(q.x - pad.x, q.y - pad.y) < q.r + pad.r + 14) ok = false;
      }
      if (ok) break;
    }
    this.pads.push(pad);
    if (!free) { this.poke(pad.x, pad.y, 0.5, true); this.events.push({ kind: 'pad', text: lotus ? 'A lotus opens on the water.' : 'A new lily pad settles on the water.' }); }
    return true;
  };

  /* ---------- time ---------- */
  /* Everything that only depends on how much time went by. Works for one
     frame and for eight hours away alike, so catching up is a formula. */
  Game.prototype._progress = function (realDt, mult, incomeDt) {
    var pondDt = realDt * mult, i, k, total = 0;
    var span = T.fullSpan * (1 + T.padShade * this.eff('pad')) * (1 + 0.08 * this.eff('spout')) * (this.works.falls ? 1.08 : 1);
    var hungry = T.hungryGrowth + 0.03 * this.eff('duckweed');
    var reeds = (1 + T.reedGrowth * this.eff('reed')) * (1 + 0.10 * Math.min(2.3, this.power('bamboo')));
    this.pondTime += pondDt;
    for (i = 0; i < this.koi.length; i++) {
      k = this.koi[i];
      total += this.value(k);
      var before = stageOf(k);
      var fed = Math.min(pondDt, k.full * span);
      k.growth = Math.min(T.growMax, k.growth + (fed + (pondDt - fed) * hungry) * (k.growth < T.growAdult ? reeds : 1) + (k.snack || 0));
      k.snack = 0;
      k.full = Math.max(0, k.full - pondDt / span);
      var after = stageOf(k);
      if (after !== before && before === 'Fry') {
        // the fry's colours have come in: now we know what it is
        this.events.push({ kind: 'reveal', text: k.name + "'s colours are in: " + varietyName(k.genes) + '.' });
        this._note(k);
        if (k.x !== undefined) this.sparks.push({ x: k.x, y: k.y, age: 0 });
      } else if (after !== before) {
        this.events.push({ kind: 'grew', text: k.name + ' is now ' + (after === 'Young' ? 'a Young koi' : after === 'Adult' ? 'an Adult' : 'an Elder') + '.' });
      }
      this._fit(k);
    }
    this.coinFrac += total * T.incomePerSec * incomeDt;
    var whole = Math.floor(this.coinFrac);
    this.coinFrac -= whole; this.coins += whole;
    for (i = this.pairs.length - 1; i >= 0; i--) {
      var p = this.pairs[i];
      p.left -= pondDt;
      if (p.left <= 0) this._spawn(p, i);
    }
    this.offerLeft -= pondDt;
    if (this.offerLeft <= 0) this._refreshOffers();
    for (var lid in this.lots) {
      var lot = this.lots[lid];
      if (lot.kind !== 'nursery') continue;
      lot.grow = (lot.grow || 0) + pondDt * LEVEL[lot.level - 1];
      while (lot.grow >= 12 * MIN) {
        lot.grow -= 12 * MIN;
        var gk = ['blossom', 'reeds', 'iris'][(this.rng() * 3) | 0];
        this.goods[gk] = (this.goods[gk] || 0) + 1;
        if (pondDt < 60) this.floaters.push({ x: SHAPES[lid].cx, y: SHAPES[lid].cy - 40, text: '+1 ' + GOODS[gk].name.toLowerCase(), age: 0, kind: 'grow' });
      }
    }
    for (i = 0; i < this.plants.length; i++) this._ripen(this.plants[i], this.plants[i].type, pondDt);
    for (i = 0; i < this.pads.length; i++) if (this.pads[i].lotus) this._ripen(this.pads[i], 'lotus', pondDt);
    for (i = 0; i < 3; i++) {
      if (this.requests[i]) continue;
      this.requestWait[i] -= pondDt;
      if (this.requestWait[i] <= 0) {
        this.requests[i] = this._newRequest();
        this.events.push({ kind: 'request', text: 'A new request has come in.' });
      }
    }
    return whole;
  };

  /* Time away. Timers get the whole time at normal speed; income stops at the cap. */
  Game.prototype.catchUp = function (elapsed) {
    var before = this.coins, e0 = this.events.length;
    this._progress(elapsed, 1, Math.min(elapsed, T.offlineIncomeCap));
    this.gate.till = Math.min(this.gateCap(), this.gate.till + this.gateCap() * 0.5 * Math.min(1, elapsed / 7200));
    this.seasonClock += elapsed; this._seasonWas = this.season().i;
    // the tills kept filling while you were out, up to about half
    for (var id in this.lots) {
      var cap = this.tillCap(id);
      if (cap) this.lots[id].till = Math.min(cap, this.lots[id].till + cap * 0.5 * Math.min(1, elapsed / 7200));
    }
    var notes = this.events.splice(e0).map(function (e) { return e.text; });
    return { elapsed: elapsed, earned: this.coins - before, notes: notes };
  };

  Game.prototype.isSettled = function () {
    if (!this.koi.length || this.pellets.length) return false;
    for (var i = 0; i < this.koi.length; i++) if (this.koi[i].full < 0.5) return false;
    for (i = 0; i < this.pairs.length; i++) if (this.pairs[i].waiting) return false;
    return true;
  };

  Game.prototype.step = function () {
    var s = this.timeScale;
    this.step_++;
    this._stepCam(DT);
    this.time += DT;
    this.sinceInput += DT;
    this.sitting += DT * s;
    this._stepSeason(DT * s);
    this._progress(DT * s, this.presence(), DT * s);
    this._idle(DT);
    this.grid.step();
    this._stepPellets(DT);
    this._stepFish(DT);
    this._stepPads(DT);
    this._stepExtras(DT);
    this.settledFor = this.isSettled() ? this.settledFor + DT : 0;
  };

  Game.prototype._idle = function (dt) {
    this.sinceTouch += dt;
    if (this.sinceTouch < 6) return;
    this.idleTimer -= dt;
    if (this.idleTimer > 0) return;
    var rng = this.rng;
    this.idleTimer = 7 + rng() * 12;
    if (rng() < 0.45 && this.koi.length) {
      var f = this.koi[(rng() * this.koi.length) | 0];
      this.poke(f.x + Math.cos(f.a) * f.len * 0.3, f.y + Math.sin(f.a) * f.len * 0.3, 0.2 + 0.35 * Math.min(1, f.len / this.fishBase), true);
    } else {
      var ix = this.cam.x + this.W * (0.06 + rng() * 0.88), iy = this.cam.y + this.H * (0.06 + rng() * 0.88);
      if (this.onWater(ix, iy)) this.poke(ix, iy, 0.4, true);
    }
  };

  Game.prototype._stepPellets = function (dt) {
    for (var i = this.pellets.length - 1; i >= 0; i--) {
      var p = this.pellets[i];
      p.age += dt;
      if (p.age > T.pelletLife) this.pellets.splice(i, 1);
    }
  };

  /* ---------- motion (from the pond toy, plus feeding) ---------- */
  Game.prototype._startle = function (x, y, radius, comeBack) {
    var rng = this.rng;
    for (var i = 0; i < this.koi.length; i++) {
      var f = this.koi[i];
      var dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy);
      var tp = TEMPERS[f.temper].id;
      if (d > radius * (tp === 'shy' ? 1.3 : 1)) continue;
      // a koi that knows you does not mind a hand trailing through the water
      if (!comeBack && (rng() < f.bond * 0.9 || (tp === 'gentle' && rng() < 0.5))) continue;
      if (d < 1e-6) { dx = Math.cos(f.a); dy = Math.sin(f.a); d = 1; }
      var j = (rng() - 0.5) * 0.9, c = Math.cos(j), s = Math.sin(j);
      f.fx = (dx * c - dy * s) / d; f.fy = (dx * s + dy * c) / d;
      f.mode = FLEE;
      f.t0 = f.timer = (0.7 + rng() * 0.5) * (tp === 'bold' ? 0.6 : 1);
      f.comeBack = comeBack;
      if (comeBack) {
        var ang = f.id * 2.4 + rng() * 0.6, rr = f.len * 0.6;
        var M = this._margin(f) * 0.6;
        var back = this.clampIn(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, M);
        f.tx = back[0]; f.ty = back[1];
      }
    }
  };

  Game.prototype._margin = function (f) {
    return Math.min(Math.max(f.len * 1.3, 90), 200);
  };

  Game.prototype._stepFish = function (dt) {
    var W = this.W, H = this.H, fish = this.koi, rng = this.rng, pellets = this.pellets, i, k;
    for (i = 0; i < fish.length; i++) {
      var f = fish[i], len = f.len, M = this._margin(f);
      f.wa += (rng() - 0.5) * 0.3; f.wa *= 0.975;
      var da = f.a + f.wa;
      var dx = Math.cos(da), dy = Math.sin(da);
      var vt = f.base, maxTurn = 1.8, accel = 1.5;

      if (f.mode === FLEE) {
        dx = f.fx * 4 + dx * 0.3; dy = f.fy * 4 + dy * 0.3;
        vt = f.base * (2 + 10 * f.timer / f.t0);
        maxTurn = 11; accel = 14;
        if ((this.step_ & 3) === 0) this.grid.bump(this.gx(f.x), this.gy(f.y), 1.6, -0.07 * Math.min(1, len / this.fishBase));
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

      // food and the hand
      if (f.mode === WANDER || f.mode === CURIOUS) {
        var tp = TEMPERS[f.temper].id, hand = this.hand, seeking = false;
        var hx = f.x + Math.cos(f.a) * len * 0.36, hy = f.y + Math.sin(f.a) * len * 0.36;
        if (hand.offer && f.full < 0.98 && (f.bond >= 0.12 || tp === 'bold')) {
          // food held still at the surface: come and take it from the hand
          seeking = true;
          var ox = hand.x - f.x, oy = hand.y - f.y, om = Math.hypot(ox, oy) || 1;
          if (Math.hypot(hand.x - hx, hand.y - hy) < Math.max(12, len * 0.24)) {
            vt = f.base * 0.15;
            f.nib -= dt;
            if (f.nib <= 0) { f.nib = 0.6 + rng() * 0.6; this._bite(f, hand.x, hand.y, 0.12, 0.03, 0.4); }
          } else {
            dx += ox / om * 3.2; dy += oy / om * 3.2;
            vt = f.base * (0.4 + 1.2 * Math.min(1, om / (len * 2)));
            maxTurn = 3.2; accel = 3;
          }
          f.mode = WANDER;
        } else if (f.full < (tp === 'greedy' ? 0.999 : 0.9) && pellets.length) {
          var best = -1, bd = 1e9;
          for (k = 0; k < pellets.length; k++) {
            if (pellets[k].age < 0.4) continue;
            var pd = Math.hypot(pellets[k].x - hx, pellets[k].y - hy);
            if (pd < bd) { bd = pd; best = k; }
          }
          if (best >= 0) {
            var pl = pellets[best];
            seeking = true;
            if (bd < Math.max(9, len * 0.22)) {
              pellets.splice(best, 1);
              this._bite(f, pl.x, pl.y, T.bite, 0.015, 0.25);
            } else {
              var px = pl.x - f.x, py = pl.y - f.y, pm = Math.hypot(px, py) || 1;
              dx += px / pm * 3.2; dy += py / pm * 3.2;
              vt = f.base * (0.45 + 1.5 * Math.min(1, pm / (len * 2))) * (tp === 'greedy' ? 1.3 : 1);
              maxTurn = 3.2; accel = 3;
              f.mode = WANDER;
            }
          }
        }
        // a koi that knows you drifts over to say hello
        if (!seeking && hand.on && f.bond > 0.3 && f.mode === WANDER) {
          var gx_ = hand.x - f.x, gy_ = hand.y - f.y, gm = Math.hypot(gx_, gy_);
          if (gm > len * 1.1) { dx += gx_ / gm * f.bond * 1.6; dy += gy_ / gm * f.bond * 1.6; }
        }
      }

      // walls: push toward the inside, harder the closer the fish is
      var p, bank = this.depth(f.x, f.y);
      if (bank < M) {
        var inw = this.inward(f.x, f.y);
        p = Math.min(1.5, (M - bank) / M);
        // a koi after food will come right up to the bank for it
        var shy = (f.mode === WANDER || f.mode === CURIOUS) && seeking ? 0.3 : 1;
        dx += inw[0] * p * p * 6 * shy; dy += inw[1] * p * p * 6 * shy;
      }

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
      if (f.pulse > 0) f.pulse = Math.max(0, f.pulse - dt * 2.2);
    }
    this._constrain();
  };

  Game.prototype._constrain = function () {
    var W = this.W, H = this.H, fish = this.koi, pads = this.pads, i, k, pass;
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
        var f = fish[i], at = this.clampIn(f.x, f.y, f.len * 0.3);
        f.x = at[0]; f.y = at[1];
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
        var pp = pads[i], er = pp.r + 3, pin = this.clampIn(pp.x, pp.y, er);
        if (pin[0] !== pp.x) { pp.vx = 0; pp.x = pin[0]; }
        if (pin[1] !== pp.y) { pp.vy = 0; pp.y = pin[1]; }
      }
    }
  };

  Game.prototype._stepPads = function (dt) {
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

  /* ---------- looks coming in, trust, visitors' coins ---------- */
  Game.prototype.revealed = function (k) { return k.growth >= T.growYoung; };
  /* How far a fry's looks have come in: colour first, then pattern. */
  Game.prototype.develop = function (k) {
    var t = k.growth / T.growYoung;
    return { colour: clamp(t / 0.55, 0, 1), pattern: clamp((t - 0.55) / 0.45, 0, 1) };
  };
  Game.prototype.count = function (type) {
    var n = 0, i;
    if (type === 'pad') return this.pads.length;
    if (type === 'lotus') { for (i = 0; i < this.pads.length; i++) if (this.pads[i].lotus) n++; return n; }
    for (i = 0; i < this.plants.length; i++) if (this.plants[i].type === type) n++;
    return n;
  };
  Game.prototype._bondGain = function (f) {
    var tp = TEMPERS[f.temper].id;
    return (tp === 'bold' ? 1.4 : tp === 'shy' ? 0.7 : 1) * (1 + T.irisBond * this.eff('iris')) * (1 + 0.15 * Math.min(2.3, this.power('moss')));
  };

  /* One mouthful, from a pellet or from the hand. More koi nearby means more splash. */
  Game.prototype._bite = function (f, x, y, food, bond, tossChance) {
    var near = 0, i;
    for (i = 0; i < this.koi.length; i++) {
      var o = this.koi[i];
      if (o !== f && Math.hypot(o.x - f.x, o.y - f.y) < (f.len + o.len) * 1.1) near++;
    }
    near = Math.min(3, near);
    var s = Math.min(1, f.len / this.fishBase);
    f.full = Math.min(1, f.full + food);
    f.bond = Math.min(1, f.bond + bond * this._bondGain(f));
    // every mouthful makes the koi a little bigger and worth a little more
    var v0 = this.value(f), g0 = f.growth;
    f.snack = (f.snack || 0) + T.biteGrowth * food / T.bite;
    f.growth = Math.min(T.growMax, g0 + f.snack);
    var dv = this.value(f) - v0;
    f.growth = g0;
    f.pulse = 1;
    if (dv > 0) this.floaters.push({ x: f.x, y: f.y - f.len * 0.25, text: f.name + ' +' + dv, age: 0, kind: 'grow' });
    this.grid.drop(this.gx(x), this.gy(y), (0.12 + 0.16 * s) * (1 + 0.35 * near));
    this._cue('eat', x, Math.min(1, s * (1 + 0.3 * near)));
    // people on the bank love to watch them feed
    if (this.rng() < tossChance) this._toss(f);
  };

  /* ---------- visitors ----------
     People come in through a gate, walk round to the bank near a koi they like, stop, and throw a coin in.
     They watch for a little while and then walk back out the way they came. */
  Game.prototype.walkable = function (x, y) {
    var gx = Math.round(x / FC), gy = Math.round(y / FC);
    return gx >= 0 && gy >= 0 && gx < this.fw && gy < this.fh && this.walk[gy * this.fw + gx] === 1;
  };
  Game.prototype._clearLine = function (x0, y0, x1, y1) {
    var d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 8), i;
    for (i = 1; i < n; i++) if (!this.walkable(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
    return true;
  };
  /* The way on foot from the nearest gate to a spot: a list of points, or null if there is none. */
  Game.prototype.routeTo = function (x, y) {
    var fw = this.fw, tg = this.toGate, i = Math.round(y / FC) * fw + Math.round(x / FC), pts = [[x, y]], j, k, guard = 0;
    var NB = [-1, 1, -fw, fw, -fw - 1, -fw + 1, fw - 1, fw + 1];
    if (i < 0 || i >= tg.length || tg[i] < 0) return null;
    while (tg[i] > 0 && guard++ < 4000) {
      var best = -1;
      for (j = 0; j < 8; j++) { k = i + NB[j]; if (k >= 0 && k < tg.length && tg[k] >= 0 && tg[k] < tg[i] && (best < 0 || tg[k] < tg[best])) best = k; }
      if (best < 0) return null;
      i = best;
      pts.push([(i % fw) * FC, Math.floor(i / fw) * FC]);
    }
    // pull the string tight: drop every point that can be skipped without stepping off the land
    var out = [pts[0]], a = 0;
    while (a < pts.length - 1) {
      var b = Math.min(pts.length - 1, a + 90);
      while (b > a + 1 && !this._clearLine(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]); a = b;
    }
    return out.reverse();
  };
  Game.prototype._cell = function (x, y) { return clamp(Math.round(y / FC), 0, this.fh - 1) * this.fw + clamp(Math.round(x / FC), 0, this.fw - 1); };
  /* The way on foot between any two spots on dry land, or null. Searched outward from the far end. */
  Game.prototype.routeBetween = function (x0, y0, x1, y1) {
    var fw = this.fw, walk = this.walk, n = walk.length, sc = this._cell(x0, y0), tc = this._cell(x1, y1), i, j, k;
    var NB = [-1, 1, -fw, fw, -fw - 1, -fw + 1, fw - 1, fw + 1];
    if (!walk[tc]) return null;
    if (!walk[sc]) { for (j = 0; j < 8 && !walk[sc]; j++) if (walk[sc + NB[j]]) sc += NB[j]; if (!walk[sc]) return null; }
    if (!this._bd || this._bd.length !== n) { this._bd = new Int32Array(n); this._bs = new Uint32Array(n); this._bq = new Int32Array(n); this._bg = 0; }
    var gen = ++this._bg, d = this._bd, st = this._bs, q = this._bq, head = 0, tail = 0, found = false;
    d[tc] = 0; st[tc] = gen; q[tail++] = tc;
    while (head < tail) {
      i = q[head++];
      if (i === sc) { found = true; break; }
      for (j = 0; j < 8; j++) {
        k = i + NB[j];
        if (k < 0 || k >= n || !walk[k] || st[k] === gen || Math.abs((k % fw) - (i % fw)) > 1) continue;
        st[k] = gen; d[k] = d[i] + 1; q[tail++] = k;
      }
    }
    if (!found) return null;
    var pts = [[x0, y0]];
    i = sc;
    while (d[i] > 0) {
      var best = -1;
      for (j = 0; j < 8; j++) { k = i + NB[j]; if (k >= 0 && k < n && st[k] === gen && d[k] < d[i] && Math.abs((k % fw) - (i % fw)) <= 1 && (best < 0 || d[k] < d[best])) best = k; }
      if (best < 0) return null;
      i = best;
      pts.push([(i % fw) * FC, Math.floor(i / fw) * FC]);
    }
    pts.push([x1, y1]);
    var out = [pts[0]], a = 0;
    while (a < pts.length - 1) {
      var b = Math.min(pts.length - 1, a + 90);
      while (b > a + 1 && !this._clearLine(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  };
  /* Somewhere to stand at a plot: on the bank of a pond (near a koi, if one is named), or inside a building's yard. */
  Game.prototype._spot = function (id, koi) {
    var sh = SHAPES[id], rng = this.rng, vs = this.visitors, t, i;
    if (this.kindOf(id) !== 'pond') {
      for (t = 0; t < 12; t++) {
        var q = blobPoint(sh, 0.4 + rng() * 2.4, 0.5 + rng() * 0.32);       // the front of the yard, south of the building
        if (this.walkable(q[0], q[1])) return q;
      }
      return null;
    }
    // walk out from the middle of this section until the bank. Where the water runs off the screen to the next
    // section there is no bank to stand on, so try another way. The headland island cannot be reached on foot.
    var base = koi ? Math.atan2(koi.y - sh.cy, koi.x - sh.cx) : rng() * 6.283, tg = this.toGate;
    if (this.works.bridge && rng() < 0.3) {
      // out on the island, by the water
      for (t = 0; t < 10; t++) {
        var ia = rng() * 6.283, ix = ISLE.x + Math.cos(ia) * ISLE.rx * 0.55, iy = ISLE.y + Math.sin(ia) * ISLE.ry * 0.5;
        if (this.walkable(ix, iy) && tg[this._cell(ix, iy)] >= 0) return [ix, iy];
      }
    }
    for (t = 0; t < 26; t++) {
      var ang = base + (rng() - 0.5) * (0.8 + t * 0.5), ux = Math.cos(ang), uy = Math.sin(ang), r, x = 0, y = 0, hit = false, crowded = false;
      for (r = 60; r < 760; r += 14) {
        x = sh.cx + ux * r; y = sh.cy + uy * r;
        if (Math.abs(x - sh.cx) > 760 || Math.abs(y - sh.cy) > 470) break;
        if (this.depth(x, y) < -30) { hit = true; break; }
      }
      if (!hit || !this.walkable(x, y) || tg[this._cell(x, y)] < 0) continue;
      for (i = 0; i < vs.length; i++) if (Math.hypot(vs[i].bx - x, vs[i].by - y) < 56) crowded = true;
      if (!crowded) return [x, y];
    }
    return null;
  };
  /* A guest comes in at a gate with a few places in mind. first / koi: where they are headed first, if we know. */
  Game.prototype._newGuest = function (first, koi, opt) {
    var rng = this.rng, vs = this.visitors, ids = Object.keys(this.lots), stops = [], t, id;
    // nobody comes while you are away from the pond, or while the garden is shut (closed is for testing)
    opt = opt || {};
    if (this.closed || this.presence() <= 1.5 || (vs.length >= this.maxGuests() && !opt.force)) return null;
    if (first) stops.push(first);
    var want = 2 + ((rng() * 3) | 0);
    for (t = 0; t < 30 && stops.length < want; t++) {
      id = ids[(rng() * ids.length) | 0];
      var kd = this.lots[id].kind, like = kd === 'pond' ? 0.9 : KINDS[kd].stop || 0.45;
      if (stops.indexOf(id) < 0 && rng() < like) stops.push(id);
    }
    if (!stops.length) stops.push('home');
    if (opt.painter) stops = ['home'];
    var entry = this._entry();
    if (!entry || entry.length < 2) return null;
    var path = entry.slice(), last = path[path.length - 1];
    path[path.length - 1] = [last[0] + (rng() - 0.5) * 90, last[1] + (rng() - 0.5) * 24];   // not all on the same paving stone
    stops.unshift('gate');
    var v = { x: path[0][0] + (rng() - 0.5) * 50, y: path[0][1], bx: path[path.length - 1][0], by: path[path.length - 1][1], path: path, pi: 1, state: 'walk', leaving: false, did: false,
              stops: stops, si: 0, timer: 0, a: 0, koi: koi ? koi.id : 0, seed: (rng() * 1e9) | 0, phase: rng() * 6, throwT: 0, age: 0, speed: 100 + rng() * 30 };
    if (opt.painter) v.painter = true;
    vs.push(v);
    this.stats.guests++;
    return v;
  };
  /* A koi has caught someone's eye: a guest already at that pond throws a coin, or a new guest sets out for it. */
  Game.prototype._toss = function (k) {
    var vs = this.visitors, pond = this.pondNear(k.x, k.y).id, i;
    for (i = 0; i < vs.length; i++) {
      if (vs[i].state === 'stop' && vs[i].did && vs[i].stops[vs[i].si] === pond && this.rng() < 0.6) { this._throw(vs[i], k); return; }
    }
    this._newGuest(pond, k);
  };
  Game.prototype._throw = function (v, k) {
    var rng = this.rng, i, here = [], pond = v.stops ? v.stops[v.si] : null;
    if (!k) {
      k = this.byId(v.koi);
      if (!k || (pond && this.pondNear(k.x, k.y).id !== pond)) {
        for (i = 0; i < this.koi.length; i++) if (!pond || this.pondNear(this.koi[i].x, this.koi[i].y).id === pond) here.push(this.koi[i]);
        k = here.length ? here[(rng() * here.length) | 0] : null;
      }
    }
    v.throwT = 1;
    if (this.tossed.length >= T.maxTossed) return;
    // a handful of food, never a long throw: near the koi if the koi is close, else a little way out from the bank
    var sh = SHAPES[this.pondNear(v.x, v.y).id], tx = k ? k.x : sh.cx, ty = k ? k.y : sh.cy;
    var dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy) || 1, reach = Math.min(d + (rng() - 0.5) * 60, 240 + rng() * 120);
    var land = this.clampIn(v.x + dx / d * reach + (rng() - 0.5) * 50, v.y + dy / d * reach + (rng() - 0.5) * 50, 60);
    v.a = Math.atan2(land[1] - v.y, land[0] - v.x);
    this.tossed.push({ x: v.x, y: v.y, sx: v.x, sy: v.y, tx: land[0], ty: land[1], fly: 0, air: 0.55 + Math.hypot(land[0] - v.x, land[1] - v.y) / 700,
                       age: 0, coins: 0, food: true, r: 5, ph: rng() * 6.283 });
    this._cue('throw', v.x, 0.5);
  };
  /* Where a guest goes after a stop: the next place they had in mind, or home by the nearest gate. */
  Game.prototype._onward = function (v) {
    var spot, path;
    while (++v.si < v.stops.length) {
      if (!this.lots[v.stops[v.si]]) continue;
      spot = this._spot(v.stops[v.si], null);
      path = spot ? this.routeBetween(v.x, v.y, spot[0], spot[1]) : null;
      if (path && path.length > 1) { v.path = path; v.pi = 1; v.bx = spot[0]; v.by = spot[1]; v.state = 'walk'; v.did = false; return true; }
    }
    path = this.routeTo(v.x, v.y);
    if (!path || path.length < 2) return false;
    v.path = path.reverse(); v.pi = 1; v.state = 'walk'; v.leaving = true;
    return true;
  };
  Game.prototype._stepVisitors = function (dt) {
    var vs = this.visitors, rng = this.rng, i;
    // the better the garden's name, the more often someone comes through the gate
    if (this.presence() > 1.5) {
      this.guestIn -= dt;
      if (this.guestIn <= 0) {
        this.guestIn = 22 / (0.5 + 0.5 * this.stars()) * (0.7 + rng() * 0.6) / this.tossRate();
        this._newGuest(null, null);
      }
    }
    for (i = vs.length - 1; i >= 0; i--) {
      var v = vs[i], id = v.stops[v.si], lot = this.lots[id];
      v.age += dt;
      if (v.throwT > 0) v.throwT = Math.max(0, v.throwT - dt * 2.2);
      if (v.state === 'stop') {
        var sh = SHAPES[id] || SHAPES.home, k = lot && lot.kind === 'pond' ? this.byId(v.koi) : null;
        var want = k ? Math.atan2(k.y - v.y, k.x - v.x) : Math.atan2(sh.cy - v.y, sh.cx - v.x);
        if (v.throwT <= 0) v.a += wrapAngle(want - v.a) * Math.min(1, dt * 2);
        v.timer -= dt;
        if (v.timer > 0) continue;
        if (!v.did && id === 'gate') {
          // pay to come in. If the cash box is full the guest still comes in, but the coins are lost
          v.did = true; v.timer = 0.3;
          var fee = this.ticket(), room = this.gateCap() - this.gate.till, took = Math.max(0, Math.min(fee, room));
          this.gate.till += took;
          if (took < fee) this.stats.lost += fee - took;
          this.floaters.push({ x: v.x, y: v.y - 26, text: took > 0 ? '+' + Math.round(took) : 'gate full', age: 0, kind: 'till' });
          if (took > 0) this._cue('ticket', v.x, 0.5);
        } else if (!v.did && lot) {
          v.did = true;
          if (lot.kind === 'pond' && v.painter) { v.painting = true; v.timer = 45 + rng() * 25; }
          else if (lot.kind === 'pond') { this._throw(v); v.timer = 4 + rng() * 6; }
          else {
            var kd = KINDS[lot.kind];
            if (kd.pay) {
              var pay = Math.round(kd.pay * (0.8 + rng() * 0.4) * LEVEL[lot.level - 1]);
              lot.till = Math.min(this.tillCap(id), lot.till + pay);
              this.floaters.push({ x: v.x, y: v.y - 26, text: '+' + pay, age: 0, kind: 'till' });
            }
            v.timer = 1 + rng() * 1.5;
          }
        } else if (v.painting) {
          // the picture is done: the painter pays for the view, and goes
          var tip = 20 + 10 * this.stars();
          v.painting = false; v.timer = 1;
          this.coins += tip;
          this.floaters.push({ x: v.x, y: v.y - 30, text: '+' + tip, age: 0 });
          this.events.push({ kind: 'sold', text: 'The painter finished a picture of the lake and left you ' + tip + ' coins.' });
          this._cue('pick', v.x, 0.8);
        } else if (!this._onward(v)) vs.splice(i, 1);
        continue;
      }
      var tp = v.path[v.pi], dx = tp[0] - v.x, dy = tp[1] - v.y, d = Math.hypot(dx, dy), step = v.speed * dt;
      v.phase += dt * 8.5;
      if (d > 0.01) {
        v.a += wrapAngle(Math.atan2(dy, dx) - v.a) * Math.min(1, dt * 9);
        v.x += dx / d * Math.min(step, d); v.y += dy / d * Math.min(step, d);
      }
      if (d <= step && ++v.pi >= v.path.length) {
        if (v.leaving) vs.splice(i, 1);
        else { v.state = 'stop'; v.did = false; v.timer = id === 'gate' ? 0.5 + rng() * 0.6 : lot && lot.kind === 'pond' ? 0.7 + rng() * 0.9 : 2.5 + rng() * 3.5; }
      }
    }
  };
  Game.prototype.sweep = function (x, y) {
    var got = 0;
    for (var i = this.tossed.length - 1; i >= 0; i--) {
      var b = this.tossed[i];
      if (b.fly < 1 || b.age < 0.15 || Math.hypot(b.x - x, b.y - y) > b.r + 18) continue;
      this.tossed.splice(i, 1);
      this.coins += b.coins; got += b.coins; this.stats.picked++;
      this.floaters.push({ x: b.x, y: b.y, text: '+' + b.coins, age: 0 });
      this.grid.drop(this.gx(b.x), this.gy(b.y), 0.15);
      this._cue('pick', b.x, 1);
    }
    if (got) { this.touch(); this.popped += got; }
    return got;
  };
  Game.prototype.setHand = function (x, y, on, offer) {
    var h = this.hand;
    h.x = x; h.y = y; h.on = !!on; h.offer = !!(on && offer);
  };

  Game.prototype._stepExtras = function (dt) {
    var rng = this.rng, i, W = this.W, H = this.H;
    for (i = this.tossed.length - 1; i >= 0; i--) {
      var b = this.tossed[i];
      b.ph += dt * 2;
      if (b.fly < 1) {
        b.fly = Math.min(1, b.fly + dt / b.air);
        b.x = b.sx + (b.tx - b.sx) * b.fly; b.y = b.sy + (b.ty - b.sy) * b.fly;
        if (b.fly >= 1) {
          if (b.food) {
            // it scatters on the water for the koi to find
            for (var n = 0; n < 3; n++) {
              var pp = this.clampIn(b.x + (rng() - 0.5) * 34, b.y + (rng() - 0.5) * 34, 6);
              this.pellets.push({ x: pp[0], y: pp[1], age: 0, r: 2.2 + rng() * 1.2 });
            }
            while (this.pellets.length > 60) this.pellets.shift();
            this.grid.drop(this.gx(b.x), this.gy(b.y), 0.3);
            this._cue('food', b.x);
            this.tossed.splice(i, 1);
            continue;
          }
          this.grid.drop(this.gx(b.x), this.gy(b.y), 0.5);
          this._cue('splash', b.x, 0.5);
        }
      } else {
        b.age += dt;
        if (b.age > T.coinLife) this.tossed.splice(i, 1);
      }
    }
    this._stepVisitors(dt);
    for (i = this.floaters.length - 1; i >= 0; i--) {
      var fl = this.floaters[i];
      fl.age += dt; fl.y -= 22 * dt;
      if (fl.age > 1.3) this.floaters.splice(i, 1);
    }
    for (i = this.sparks.length - 1; i >= 0; i--) {
      this.sparks[i].age += dt;
      if (this.sparks[i].age > 1.8) this.sparks.splice(i, 1);
    }
    // people stop to watch content koi and throw a coin now and then, but only while you are here too
    if (this.presence() > 1.5) {
      for (i = 0; i < this.koi.length; i++) {
        var k = this.koi[i];
        if (k.full < 0.5 || k.growth < T.growYoung) continue;
        k.tossIn -= dt;
        if (k.tossIn <= 0) {
          k.tossIn = (T.tossEvery[0] + rng() * (T.tossEvery[1] - T.tossEvery[0])) / this.tossRate();
          this._toss(k);
        }
      }
    }
    for (i = 0; i < this.plants.length; i++) {
      var pl = this.plants[i];
      if (pl.type !== 'spout') continue;
      pl.t = (pl.t === undefined ? 3 : pl.t) - dt;
      if (pl.t <= 0) {
        pl.t = 8 + rng() * 4;
        var at = this.plantAt(pl);
        this.poke(at.x + Math.cos(at.a) * 52, at.y + Math.sin(at.a) * 52, 0.45, true);
      }
    }
    this._stepRain(dt); this._stepFly(dt); this._stepFrog(dt); this._stepHappen(dt);
    this._stepKeeper(dt); this._stepCat(dt);
  };

  /* ---------- visitors ---------- */
  Game.prototype._stepRain = function (dt) {
    var r = this.rain, rng = this.rng;
    r.timer -= dt;
    if (r.timer <= 0) {
      r.on = !r.on; r.timer = r.on ? 70 + rng() * 60 : 420 + rng() * 420;
      if (!r.on && this.presence() > 1.5) this.startHappening('rainbow');   // the sun comes out after the rain
    }
    r.amt = clamp(r.amt + (r.on ? dt / 8 : -dt / 10), 0, 1);
    if (r.amt > 0 && rng() < r.amt * 0.4) this.grid.drop(rng() * (this.grid.w - 1), rng() * (this.grid.h - 1), 0.1 + rng() * 0.2);
  };
  Game.prototype._flyLeave = function () {
    var fl = this.fly;
    fl.state = 'out'; fl.tx = fl.x + (this.rng() < 0.5 ? -900 : 900); fl.ty = fl.y + (this.rng() - 0.5) * 600;
  };
  Game.prototype._stepFly = function (dt) {
    var fl = this.fly, rng = this.rng, p;
    fl.timer -= dt; fl.wing += dt;
    if (!this.pads.length || fl.pad >= this.pads.length) { fl.state = 'away'; fl.pad = 0; if (fl.timer < 10) fl.timer = 30; return; }
    if (fl.state === 'away') {
      if (fl.timer > 0 || !this.pads.length) return;
      fl.pad = (rng() * this.pads.length) | 0;
      if (fl.pad === this.frog.pad) { fl.timer = 6; return; }
      p = this.pads[fl.pad];
      fl.x = p.x + (rng() < 0.5 ? -800 : 800); fl.y = p.y + (rng() - 0.5) * 600;
      fl.state = 'in';
    } else if (fl.state === 'in' || fl.state === 'out') {
      p = this.pads[fl.pad];
      var tx = fl.state === 'in' ? p.x + p.r * 0.25 : fl.tx, ty = fl.state === 'in' ? p.y - p.r * 0.2 : fl.ty;
      var dx = tx - fl.x, dy = ty - fl.y, d = Math.hypot(dx, dy);
      if (d < 6) {
        if (fl.state === 'in') { fl.state = 'sit'; fl.timer = 20 + rng() * 30; }
        else { fl.state = 'away'; fl.timer = 40 + rng() * 70; }
        return;
      }
      var wob = Math.sin(fl.wing * 5) * 0.6 * Math.min(1, d / 120);
      var a = Math.atan2(dy, dx) + wob, sp = Math.min(190, 60 + d * 1.5);
      fl.a = a; fl.x += Math.cos(a) * sp * dt; fl.y += Math.sin(a) * sp * dt;
    } else {
      p = this.pads[fl.pad];
      fl.x = p.x + p.r * 0.25; fl.y = p.y - p.r * 0.2;
      if (fl.timer <= 0) this._flyLeave();
    }
  };
  Game.prototype._frogJump = function () {
    var fr = this.frog, p = this.pads[fr.pad];
    if (p) {
      var x = p.x + Math.cos(fr.a) * p.r * 1.35, y = p.y + Math.sin(fr.a) * p.r * 1.35;
      this.poke(x, y, 0.7, true);
      this._cue('plop', x, 0.5);
    }
    fr.pad = -1; fr.timer = 20 + this.rng() * 30;
  };
  Game.prototype._stepFrog = function (dt) {
    var fr = this.frog, rng = this.rng;
    fr.timer -= dt;
    if (fr.timer > 0) return;
    if (fr.pad >= 0) { this._frogJump(); return; }
    if (!this.pads.length) { fr.timer = 10; return; }
    var i = (rng() * this.pads.length) | 0;
    if (this.fly.state !== 'away' && this.fly.pad === i) { fr.timer = 5; return; }
    fr.pad = i; fr.a = rng() * 6.283; fr.timer = 70 + rng() * 90;
    this.poke(this.pads[i].x, this.pads[i].y, 0.3, true);
  };
  /* A pebble sends the visitors off for a while. */
  Game.prototype._scare = function (x, y) {
    var fr = this.frog, fl = this.fly, p;
    if (fr.pad >= 0) { p = this.pads[fr.pad]; if (p && Math.hypot(p.x - x, p.y - y) < 190) this._frogJump(); }
    if ((fl.state === 'sit' || fl.state === 'in') && Math.hypot(fl.x - x, fl.y - y) < 220) this._flyLeave();
  };

  /* ---------- the turning year ---------- */
  Game.prototype.season = function () {
    var n = this.seasonClock / T.seasonLen, i = Math.floor(n) % 4, f = n - Math.floor(n), fade = T.seasonFade / T.seasonLen;
    return { i: i, id: SEASONS[i].id, name: SEASONS[i].name, next: SEASONS[(i + 1) % 4], mix: clamp((f - (1 - fade)) / fade, 0, 1), f: f };
  };
  Game.prototype._stepSeason = function (dt) {
    this.seasonClock += dt;
    var se = this.season();
    if (this._seasonWas === undefined) this._seasonWas = se.i;
    if (se.i !== this._seasonWas) {
      this._seasonWas = se.i;
      this.events.push({ kind: 'season', text: SEASON_TEXT[se.id] });
    }
  };

  /* ---------- happenings ----------
     Something is always going on at the lake. While you are here, every half a minute or so something
     drops in: a heron to fish, ducks paddling across, a turtle, a kingfisher, a gust of petals, a painter,
     a school trip, a wild koi from the stream; and at night lanterns on the water or fireflies.
     Each one is { kind, t (seconds so far), dur, x, y, a, state }. */
  var HAPPEN_TEXT = {
    heron: 'A heron has landed to fish. Tap it to shoo it off.',
    turtle: 'A turtle has come up for air. Tap it for luck.',
    wild: 'A wild koi has swum in from the stream. Tap it to welcome it.',
    painter: 'A painter has come to paint the lake.',
    school: 'A school trip has come to see the koi.',
    lanterns: 'Someone has set paper lanterns afloat.'
  };
  var AMBIENT = { gust: 1, lanterns: 1, fireflies: 1, mist: 1, rainbow: 1 };
  Game.prototype._waterSpot = function (m) { return this.spotIn(AREAS[0], m || 60); };
  Game.prototype._offEdge = function (x, y) {
    // the nearest point a little way off the edge of the screen
    var c = this.cam, l = x - c.x, r = c.x + this.W - x, t = y - c.y, b = c.y + this.H - y, m = Math.min(l, r, t, b);
    return m === l ? [c.x - 80, y] : m === r ? [c.x + this.W + 80, y] : m === t ? [x, c.y - 80] : [x, c.y + this.H + 80];
  };
  Game.prototype.duckAt = function (h, j) {
    var wig = Math.sin(h.t * 1.3 + j * 1.9) * 9;
    return [h.x - Math.cos(h.a) * j * 36 - Math.sin(h.a) * wig, h.y - Math.sin(h.a) * j * 36 + Math.cos(h.a) * wig];
  };
  Game.prototype._pickHappening = function () {
    var rng = this.rng, se = this.season().id, min = this.sitting / 60, hs = this.happ.list, pool = [], total = 0, i, r;
    function add(k, w) {
      for (var j = 0; j < hs.length; j++) if (hs[j].kind === k) return;
      if (w > 0) { pool.push([k, w]); total += w; }
    }
    add('heron', 2); add('kingfisher', 2); add('gust', 2.2); add('painter', 0.9);
    add('ducks', se === 'snow' ? 0.6 : 2); add('turtle', se === 'snow' ? 0 : 1.4);
    if (this.stars() >= 2) add('school', 0.8);
    if (this.koi.length < this.capacity() && this.time - this.happ.wildAt > (this.works.falls ? 150 : 300)) add('wild', this.works.falls ? 2.4 : 1.2);
    if (min > 100) { add('lanterns', 2); if (se === 'spring' || se === 'lotus') add('fireflies', 3); }
    if (min < 25) add('mist', 1.4);
    r = rng() * total;
    for (i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r < 0) return pool[i][0]; }
    return null;
  };
  /* Start something happening now. Returns it, or null if it cannot happen just now. */
  Game.prototype.startHappening = function (kind) {
    var rng = this.rng, h = { kind: kind, t: 0, dur: 60, x: 0, y: 0, a: 0, state: 'on', seed: (rng() * 1e9) | 0 }, p, q, e, t;
    if (kind === 'heron') {
      p = this._spot('home', null);
      if (!p) return null;
      e = this._offEdge(p[0], p[1]);
      h.x = e[0]; h.y = e[1]; h.tx = p[0]; h.ty = p[1]; h.state = 'fly'; h.dur = 70 + rng() * 40; h.strike = 0; h.next = 4;
      h.a = Math.atan2(p[1] - e[1], p[0] - e[0]);
    } else if (kind === 'ducks') {
      p = this._waterSpot(90);
      for (t = 0; t < 30; t++) {
        q = this._waterSpot(90);
        var ok = Math.hypot(q[0] - p[0], q[1] - p[1]) > 380, n;
        for (n = 1; n < 20 && ok; n++) if (this.depth(p[0] + (q[0] - p[0]) * n / 20, p[1] + (q[1] - p[1]) * n / 20) < 35) ok = false;
        if (ok) break;
        q = null;
      }
      if (!q) return null;
      h.x = p[0]; h.y = p[1]; h.tx = q[0]; h.ty = q[1]; h.a = Math.atan2(q[1] - p[1], q[0] - p[0]); h.n = 2 + ((rng() * 3) | 0); h.dur = 120; h.fast = 0;
      this.poke(p[0], p[1], 0.5, true);
    } else if (kind === 'turtle') {
      p = this._waterSpot(110);
      h.x = p[0]; h.y = p[1]; h.a = rng() * 6.283; h.dur = 45 + rng() * 30;
      this.poke(p[0], p[1], 0.5, true);
    } else if (kind === 'kingfisher') {
      p = this._waterSpot(70); e = this._offEdge(p[0] + (rng() - 0.5) * 400, p[1]);
      h.x = e[0]; h.y = e[1]; h.tx = p[0]; h.ty = p[1]; h.state = 'fly'; h.dur = 20; h.a = Math.atan2(p[1] - e[1], p[0] - e[0]);
    } else if (kind === 'gust') {
      h.a = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.7; h.dur = 7; h.every = 0;
    } else if (kind === 'wild') {
      if (this.koi.length >= this.capacity()) return null;
      var genes = randomGenes(rng), g2 = randomGenes(rng);
      if (rarity(g2) > rarity(genes)) genes = g2;
      p = this.works.falls ? this.clampIn(this.fallsAt[0], this.fallsAt[1] + 60, 40) : this._waterSpot(60);
      var k = this.addKoi(genes, 0, 0.9 + rng() * 0.3, p[0], p[1], 'home');
      k.growth = T.growYoung * (1.05 + rng() * 0.7); this._fit(k); k.v = k.base;
      k.wild = 120; k.full = 0.7;
      h.koi = k.id; h.dur = 130; this.happ.wildAt = this.time;
      this.sparks.push({ x: p[0], y: p[1], age: 0 });
      this.poke(p[0], p[1], 0.7, true);
    } else if (kind === 'painter') {
      var v = this._newGuest('home', null, { painter: true, force: true });
      if (!v) return null;
      h.v = v; h.dur = 300;
    } else if (kind === 'school') {
      if (this.closed || this.presence() <= 1.5) return null;
      h.left = 5; h.qt = 0; h.dur = 60;
    } else if (kind === 'lanterns') { h.dur = 130; }
    else if (kind === 'fireflies') { h.dur = 120; }
    else if (kind === 'mist') { h.dur = 100; }
    else if (kind === 'rainbow') { h.dur = 45; }
    else return null;
    this.happ.list.push(h);
    if (HAPPEN_TEXT[kind]) this.events.push({ kind: 'happen', text: HAPPEN_TEXT[kind] });
    return h;
  };
  Game.prototype._stepHappen = function (dt) {
    var hp = this.happ, hs = hp.list, rng = this.rng, i;
    if (this.presence() > 1.5 && !this.closed) {
      hp.next -= dt;
      if (hp.next <= 0) {
        hp.next = 20 + rng() * 28;
        var busy = 0;
        for (i = 0; i < hs.length; i++) if (!AMBIENT[hs[i].kind]) busy++;
        var kind = this._pickHappening();
        if (kind && (busy < 2 || AMBIENT[kind])) this.startHappening(kind);
      }
    }
    for (i = hs.length - 1; i >= 0; i--) { hs[i].t += dt; if (this._stepOne(hs[i], dt)) hs.splice(i, 1); }
    for (i = this.drifts.length - 1; i >= 0; i--) {
      var d = this.drifts[i], k2 = Math.exp(-dt * 0.35);
      d.age += dt; d.vx *= k2; d.vy *= k2; d.rot += d.spin * dt;
      var nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
      if (this.depth(nx, ny) > 8) { d.x = nx; d.y = ny; } else { d.vx = d.vy = 0; }
      if (d.age > d.life) this.drifts.splice(i, 1);
    }
  };
  /* One step of one happening. True when it is over. */
  Game.prototype._stepOne = function (h, dt) {
    var rng = this.rng, dx, dy, d, k, i;
    function fly(sp) {
      dx = h.tx - h.x; dy = h.ty - h.y; d = Math.hypot(dx, dy);
      if (d > 0.5) { h.a += wrapAngle(Math.atan2(dy, dx) - h.a) * Math.min(1, dt * 6); }
      var st = Math.min(d, sp * dt);
      if (d > 0.01) { h.x += dx / d * st; h.y += dy / d * st; }
      return d <= sp * dt + 0.5;
    }
    switch (h.kind) {
      case 'heron':
        if (h.state === 'fly') {
          if (fly(260)) { h.state = 'stand'; var g = this.inward(h.x, h.y); h.a = Math.atan2(g[1], g[0]); }
        } else if (h.state === 'stand') {
          if (h.strike > 0) h.strike = Math.max(0, h.strike - dt * 2);
          h.next -= dt;
          if (h.next <= 0) {
            h.next = 4 + rng() * 5;
            var fx = h.x + Math.cos(h.a) * 70, fy = h.y + Math.sin(h.a) * 70;
            for (i = 0; i < this.koi.length; i++) {
              k = this.koi[i];
              if (Math.hypot(k.x - fx, k.y - fy) < 230) { h.strike = 1; this.poke(fx, fy, 0.6, true); this._startle(fx, fy, 230, true); break; }
            }
          }
          if (h.t > h.dur) this._heronOff(h);
        } else if (fly(300)) return true;
        return false;
      case 'ducks':
        dx = h.tx - h.x; dy = h.ty - h.y; d = Math.hypot(dx, dy);
        var sp = h.fast > 0 ? 80 : 34;
        h.fast = Math.max(0, h.fast - dt);
        if (d > 1) { h.x += dx / d * Math.min(d, sp * dt); h.y += dy / d * Math.min(d, sp * dt); }
        h.every = (h.every || 0) - dt;
        if (h.every <= 0) {
          h.every = 0.35;
          for (i = 0; i < h.n; i++) { var dp = this.duckAt(h, i); this.grid.drop(this.gx(dp[0] - Math.cos(h.a) * 12), this.gy(dp[1] - Math.sin(h.a) * 12), 0.05); }
        }
        if (d < 2 || h.t > h.dur) { this.poke(h.x, h.y, 0.4, true); return true; }
        return false;
      case 'turtle':
        if (h.t > h.dur || h.state === 'down') { this.poke(h.x, h.y, 0.6, true); return true; }
        h.a += Math.sin(h.t * 0.4) * dt * 0.2;
        return false;
      case 'kingfisher':
        if (h.state === 'fly') {
          if (fly(420)) {
            this.poke(h.x, h.y, 0.9, true); this._cue('splash', h.x, 0.6);
            this._startle(h.x, h.y, 160, true);
            var o = this._offEdge(h.x, h.y); h.tx = o[0]; h.ty = o[1]; h.state = 'out';
          }
        } else if (fly(360) || h.t > h.dur) return true;
        return false;
      case 'gust':
        h.every -= dt;
        while (h.every <= 0 && h.t < h.dur) {
          h.every += 0.09;
          var at = this._waterSpot(20), spd = 50 + rng() * 60, wa = h.a + (rng() - 0.5) * 0.5;
          this.drifts.push({ x: at[0], y: at[1], vx: Math.cos(wa) * spd, vy: Math.sin(wa) * spd, age: 0, life: 14 + rng() * 14,
                             rot: rng() * 6.283, spin: (rng() - 0.5) * 2, r: 0.7 + rng() * 0.6, kind: this.season().id });
          if (rng() < 0.3) this.grid.drop(this.gx(at[0]), this.gy(at[1]), 0.06);
        }
        while (this.drifts.length > 140) this.drifts.shift();
        return h.t > h.dur;
      case 'wild':
        k = this.byId(h.koi);
        if (!k || !k.wild) return true;
        k.wild -= dt;
        if (k.wild <= 0) {
          this.poke(k.x, k.y, 0.6, true);
          this.koi.splice(this.koi.indexOf(k), 1);
          this.events.push({ kind: 'happen', text: 'The wild koi swam off downstream.' });
          return true;
        }
        return false;
      case 'painter':
        return this.visitors.indexOf(h.v) < 0;
      case 'school':
        h.qt -= dt;
        if (h.qt <= 0 && h.left > 0) { h.qt = 1.1; h.left--; this._newGuest(null, null, { force: true }); }
        return h.left <= 0 || h.t > h.dur;
      default:
        return h.t > h.dur;
    }
  };
  Game.prototype._heronOff = function (h) {
    var o = this._offEdge(h.x, h.y);
    h.tx = o[0]; h.ty = o[1]; h.state = 'off';
  };
  /* A tap that lands on something visiting. True if it did. */
  Game.prototype.tapHappening = function (x, y) {
    var hs = this.happ.list, i, j, h, gift;
    for (i = 0; i < hs.length; i++) {
      h = hs[i];
      if (h.kind === 'heron' && h.state !== 'off' && Math.hypot(h.x - x, h.y - y) < 50) {
        this._heronOff(h);
        gift = 5 + 3 * this.stars();
        this.coins += gift; this.stats.herons++;
        this.floaters.push({ x: h.x, y: h.y - 34, text: '+' + gift, age: 0 });
        this.events.push({ kind: 'happen', text: 'Off it goes. The koi are safe, and it dropped a feather worth ' + gift + ' coins.' });
        this._cue('splash', h.x, 0.5); this.touch();
        return true;
      }
      if (h.kind === 'turtle' && h.state !== 'down' && Math.hypot(h.x - x, h.y - y) < 44) {
        h.state = 'down';
        gift = 10 + 5 * this.stars();
        this.coins += gift;
        this.floaters.push({ x: h.x, y: h.y - 30, text: '+' + gift, age: 0 });
        this.events.push({ kind: 'happen', text: 'The turtle blinks at you and slips under. Good luck: ' + gift + ' coins.' });
        this._cue('plop', h.x, 0.7); this.touch();
        return true;
      }
      if (h.kind === 'ducks') {
        for (j = 0; j < h.n; j++) {
          var dp = this.duckAt(h, j);
          if (Math.hypot(dp[0] - x, dp[1] - y) < 30) { h.fast = 3; this.poke(dp[0], dp[1], 0.5, true); this._cue('splash', dp[0], 0.4); this.touch(); return true; }
        }
      }
    }
    return false;
  };
  /* A wild koi, welcomed: it stays. */
  Game.prototype.welcome = function (id) {
    var k = this.byId(id);
    if (!k || !k.wild) return false;
    delete k.wild;
    this.stats.wild++;
    this._note(k);
    this.sparks.push({ x: k.x, y: k.y, age: 0 });
    this.events.push({ kind: 'bought', text: k.name + ' has made the lake its home.' });
    this.touch();
    return true;
  };

  /* ---------- the garden ---------- */
  /* Where new garden things go: the water you are looking at, or home if you are looking at land. */
  Game.prototype._gardenArea = function () {
    var a = this.focusArea();
    return a && this.kindOf(a.id) === 'pond' ? a : areaById('home');
  };
  /* How many of a thing count toward its effect. You may place as many as you like;
     the effect stops growing after a few. */
  Game.prototype.eff = function (type) {
    var spec = PLANTS[type];
    return Math.min(this.count(type), spec.max * (spec.where === 'zen' ? 1 : this.waterAreas().length));
  };
  Game.prototype.tossRate = function () {
    var n = 0, i;
    for (i = 0; i < this.plants.length; i++) if (PLANTS[this.plants[i].type].where === 'zen') n++;
    return 1 + 0.03 * Math.min(n, 11);
  };

  /* Anything can go anywhere in an open area. Floating plants need water under them. */
  Game.prototype.canPlace = function (type, x, y, free) {
    var spec = PLANTS[type];
    if (!spec) return 'No such thing.';
    if (x < 0 || y < 0 || x > COLS * AW || y > ROWS * AH) return 'Out of the garden.';
    var a = this.areaUnder(x, y);
    if (!this.lots[a.id]) return 'That plot is not built on yet.';
    if ((spec.where === 'pad' || type === 'duckweed') && !this.onWater(x, y)) return 'This one needs water.';
    if (!free && this.coins < spec.cost) return 'Needs ' + spec.cost + ' coins.';
    return '';
  };
  Game.prototype.place = function (type, x, y, a) {
    if (this.canPlace(type, x, y)) return false;
    var spec = PLANTS[type];
    if (spec.where === 'pad') return this.addPad(false, type === 'lotus', null, x, y);
    this.coins -= spec.cost;
    this.plants.push({ type: type, x: x, y: y, a: a || 0, seed: (this.rng() * 4294967296) >>> 0 });
    this.events.push({ kind: 'pad', text: spec.name + ' placed.' });
    if (this.onWater(x, y)) this.poke(x, y, 0.5, true);
    return true;
  };
  /* What garden thing is under a point: { kind: 'plant' | 'pad', i }. */
  Game.prototype.itemAt = function (x, y) {
    var i;
    for (i = this.plants.length - 1; i >= 0; i--) {
      if (Math.hypot(this.plants[i].x - x, this.plants[i].y - y) < 38) return { kind: 'plant', i: i };
    }
    for (i = this.pads.length - 1; i >= 0; i--) {
      if (Math.hypot(this.pads[i].x - x, this.pads[i].y - y) < this.pads[i].r) return { kind: 'pad', i: i };
    }
    return null;
  };
  Game.prototype.itemType = function (ref) {
    if (!ref) return null;
    if (ref.kind === 'pad') return this.pads[ref.i] ? (this.pads[ref.i].lotus ? 'lotus' : 'pad') : null;
    return this.plants[ref.i] ? this.plants[ref.i].type : null;
  };
  Game.prototype.moveItem = function (ref, x, y, a) {
    var type = this.itemType(ref);
    if (!type || this.canPlace(type, x, y, true)) return false;
    var it = ref.kind === 'pad' ? this.pads[ref.i] : this.plants[ref.i];
    it.x = x; it.y = y;
    if (ref.kind === 'pad') { it.vx = it.vy = 0; } else if (a !== undefined) it.a = a;
    if (this.onWater(x, y)) this.poke(x, y, 0.4, true);
    return true;
  };
  /* Put a thing away. Half its price comes back. */
  Game.prototype.removeItem = function (ref) {
    var type = this.itemType(ref);
    if (!type) return false;
    var back = Math.floor(PLANTS[type].cost / 2);
    if (ref.kind === 'pad') {
      this.pads.splice(ref.i, 1);
      var fr = this.frog, fl = this.fly;
      if (fr.pad === ref.i) { fr.pad = -1; fr.timer = 20; } else if (fr.pad > ref.i) fr.pad--;
      if (fl.pad === ref.i) { if (fl.state !== 'away') this._flyLeave(); fl.pad = 0; } else if (fl.pad > ref.i) fl.pad--;
    } else this.plants.splice(ref.i, 1);
    this.coins += back;
    this.events.push({ kind: 'sold', text: PLANTS[type].name + ' put away. ' + back + ' coins back.' });
    return true;
  };
  Game.prototype.plantAt = function (pl) { return { x: pl.x, y: pl.y, a: pl.a || 0 }; };

  /* ---------- growing things to sell ---------- */
  Game.prototype._ripen = function (it, type, pondDt) {
    var good = CROP[type];
    if (!good || it.ripe) return;
    it.grow = (it.grow || 0) + pondDt;
    if (it.grow >= GOODS[good].every) { it.grow = 0; it.ripe = true; }
  };
  /* Pick whatever is ripe under a point. Returns the kind of good, or null. */
  Game.prototype.harvestAt = function (x, y) {
    var i, it = null, type = null;
    for (i = this.plants.length - 1; i >= 0 && !it; i--) {
      if (this.plants[i].ripe && Math.hypot(this.plants[i].x - x, this.plants[i].y - y) < 52) { it = this.plants[i]; type = it.type; }
    }
    for (i = this.pads.length - 1; i >= 0 && !it; i--) {
      if (this.pads[i].ripe && Math.hypot(this.pads[i].x - x, this.pads[i].y - y) < this.pads[i].r + 8) { it = this.pads[i]; type = 'lotus'; }
    }
    if (!it) return null;
    var good = CROP[type];
    it.ripe = false; it.grow = 0;
    this.goods[good] = (this.goods[good] || 0) + 1;
    this.floaters.push({ x: it.x, y: it.y - 20, text: '+1 ' + GOODS[good].name.toLowerCase(), age: 0, kind: 'grow' });
    this.sparks.push({ x: it.x, y: it.y, age: 0.5 });
    this._cue('harvest', it.x, 1);
    this.touch();
    return good;
  };
  Game.prototype.ripeCount = function () {
    var n = 0, i;
    for (i = 0; i < this.plants.length; i++) if (this.plants[i].ripe) n++;
    for (i = 0; i < this.pads.length; i++) if (this.pads[i].ripe) n++;
    return n;
  };
  /* Sell goods at the market: n of one kind, or all of it. Returns the coins made. */
  Game.prototype.sellGoods = function (good, n) {
    var have = this.goods[good] || 0;
    if (!GOODS[good] || !have) return 0;
    n = n === undefined ? have : Math.min(n, have);
    var made = n * GOODS[good].price;
    this.goods[good] = have - n;
    this.coins += made;
    this.events.push({ kind: 'sold', text: 'Sold ' + n + ' ' + GOODS[good].name.toLowerCase() + (n > 1 && good !== 'reeds' && good !== 'iris' ? 's' : '') + ' for ' + made + ' coins.' });
    return made;
  };
  Game.prototype.goodsWorth = function () {
    var w = 0, k;
    for (k in this.goods) if (GOODS[k]) w += this.goods[k] * GOODS[k].price;
    return w;
  };

  /* ---------- requests ---------- */
  Game.prototype._newRequest = function () {
    var rng = this.rng, i, sets = { base: {}, pattern: {}, second: {} }, have = {}, taken = {}, seen = {}, pool = [];
    var genes, key, b, p, s, t;
    for (i = 0; i < this.koi.length; i++) {
      var g = this.koi[i].genes;
      sets.base[g.base[0]] = sets.base[g.base[1]] = 1;
      sets.pattern[g.pattern[0]] = sets.pattern[g.pattern[1]] = 1;
      sets.second[g.second[0]] = sets.second[g.second[1]] = 1;
      if (this.revealed(this.koi[i])) have[varietyKey(g)] = 1;
    }
    for (i = 0; i < this.requests.length; i++) if (this.requests[i]) taken[this.requests[i].key] = 1;
    // mostly ask for something this pond could breed but does not have yet
    for (b in sets.base) for (p in sets.pattern) for (s in sets.second) {
      genes = { base: [+b, +b], pattern: [+p, +p], second: [+s, +s] }; key = varietyKey(genes);
      if (!have[key] && !taken[key] && !seen[key]) { seen[key] = 1; pool.push(genes); }
    }
    if (pool.length && rng() < 0.75) genes = pool[(rng() * pool.length) | 0];
    else {
      for (t = 0; t < 20; t++) {
        b = weighted(BASES, rng); p = weighted(PATTERNS, rng); s = weighted(SECONDS, rng);
        genes = { base: [b, b], pattern: [p, p], second: [s, s] }; key = varietyKey(genes);
        if (!have[key] && !taken[key]) break;
      }
    }
    var stage = rng() < 0.5 ? 'Young' : 'Adult';
    var reward = Math.round(100 * (1 + rarity(genes)) * (stage === 'Adult' ? 2.2 : 1.3) / 5) * 5 + 20;
    return { who: WHO[(rng() * WHO.length) | 0], key: varietyKey(genes), name: varietyName(genes), genes: genes, stage: stage, reward: reward };
  };
  Game.prototype.matches = function (i) {
    var r = this.requests[i], out = [], n;
    if (!r) return out;
    for (n = 0; n < this.koi.length; n++) {
      var k = this.koi[n];
      if (!k.wild && this.revealed(k) && varietyKey(k.genes) === r.key && STAGES.indexOf(stageOf(k)) >= STAGES.indexOf(r.stage) && !this.pairOf(k.id)) out.push(k);
    }
    return out;
  };
  Game.prototype.fulfil = function (i, id) {
    var r = this.requests[i], k = this.byId(id);
    if (!r || !k || this.koi.length <= 2 || this.matches(i).indexOf(k) < 0) return false;
    this.coins += r.reward;
    this.koi.splice(this.koi.indexOf(k), 1);
    this.requests[i] = null; this.requestWait[i] = T.requestRefill;
    this.stats.requests++;
    this.events.push({ kind: 'sold', text: r.who + ' welcomed ' + k.name + '. ' + r.reward + ' coins.' });
    return true;
  };
  Game.prototype.passRequest = function (i) {
    if (!this.requests[i]) return false;
    this.requests[i] = null; this.requestWait[i] = T.requestRefill;
    return true;
  };

  /* ---------- koi shows ----------
     Contests held one after another. Each opens once the one before it is won and the garden has what it
     needs (a pond open, a building built). Each asks for a koi of a certain kind, raised a certain way.
     A koi that fits wins first prize and comes home again: shows take nothing from the pond. */
  function phOf(k) { return phenotype(k.genes); }
  function baseIs(k, ids) { return ids.indexOf(BASES[phOf(k).base].id) >= 0; }
  function patIs(k, ids) { return ids.indexOf(PATTERNS[phOf(k).pattern].id) >= 0; }
  function atLeast(k, stage) { return STAGES.indexOf(stageOf(k)) >= STAGES.indexOf(stage); }
  function inSeason(id) { return function (g) { return g.season().id === id; }; }
  var SHOWS = [
    { id: 'fair', name: 'Village Fair', host: 'The village', prize: 200,
      want: 'Any patched koi, grown to Adult.',
      unlock: null,
      fits: function (g, k) { return !patIs(k, ['patched']) ? 'Not patched.' : !atLeast(k, 'Adult') ? 'Not an Adult yet.' : ''; } },
    { id: 'blossom', name: 'Spring Blossom Show', host: 'The spring festival', prize: 400,
      want: 'An orange or white koi with a pattern, grown to Adult. Held in spring.',
      unlock: { text: 'Wait for spring', ok: inSeason('spring') },
      fits: function (g, k) { return !baseIs(k, ['orange', 'white']) ? 'Not orange or white.' : patIs(k, ['solid']) ? 'Needs a pattern.' : !atLeast(k, 'Adult') ? 'Not an Adult yet.' : ''; } },
    { id: 'teacup', name: 'Tea House Cup', host: 'The tea house', prize: 600,
      want: 'A saddled koi that trusts you.',
      unlock: { text: 'Build the tea house', ok: function (g) { return !!g.lots.tea; } },
      fits: function (g, k) { return !patIs(k, ['saddle']) ? 'Not saddled.' : k.bond < 0.7 ? 'Does not trust you yet.' : ''; } },
    { id: 'lotus', name: 'Lotus Moon Show', host: 'The temple garden', prize: 900,
      want: 'A gold koi with a pattern, grown to Adult. Held in summer.',
      unlock: { text: 'Wait for summer', ok: inSeason('lotus') },
      fits: function (g, k) { return !baseIs(k, ['gold']) ? 'Not gold.' : patIs(k, ['solid']) ? 'Needs a pattern.' : !atLeast(k, 'Adult') ? 'Not an Adult yet.' : ''; } },
    { id: 'maple', name: 'Maple Harvest Show', host: 'The harvest festival', prize: 1300,
      want: 'A speckled koi, grown to Adult. Held in autumn, once you have found 20 kinds of koi.',
      unlock: { text: 'Find 20 kinds of koi, and wait for autumn', ok: function (g) { return g.bookCount() >= 20 && g.season().id === 'maple'; } },
      fits: function (g, k) { return !patIs(k, ['speckled']) ? 'Not speckled.' : !atLeast(k, 'Adult') ? 'Not an Adult yet.' : ''; } },
    { id: 'snow', name: 'First Snow Show', host: 'The mountain inn', prize: 2000,
      want: 'A slate koi, grown to Adult. Held in winter.',
      unlock: { text: 'Wait for winter', ok: inSeason('snow') },
      fits: function (g, k) { return !baseIs(k, ['slate']) ? 'Not slate.' : !atLeast(k, 'Adult') ? 'Not an Adult yet.' : ''; } },
    { id: 'lantern', name: 'Lantern Night', host: 'The lantern festival', prize: 3500,
      want: 'A crowned charcoal or slate koi, grown to Elder. Held after dark, once the moon bridge is built.',
      unlock: { text: 'Build the moon bridge, and wait for night', ok: function (g) { return !!g.works.bridge && g.sitting / 60 > 100; } },
      fits: function (g, k) { return !baseIs(k, ['charcoal', 'slate']) ? 'Not charcoal or slate.' : !patIs(k, ['crown']) ? 'Not crowned.' : !atLeast(k, 'Elder') ? 'Not an Elder yet.' : ''; } },
    { id: 'grand', name: 'Grand Champion', host: 'A collector from the city', prize: 8000,
      want: 'A crowned koi with gold markings that trusts you, grown to Elder.',
      unlock: { text: 'Dig the lake to its biggest and earn 5 stars', ok: function (g) { return g.lots.home.level >= 4 && g.stars() >= 5; } },
      fits: function (g, k) { var ph = phOf(k); return !patIs(k, ['crown']) ? 'Not crowned.' : ph.second < 0 || SECONDS[ph.second].id !== 'gold' ? 'No gold markings.' : k.bond < 0.7 ? 'Does not trust you yet.' : !atLeast(k, 'Elder') ? 'Not an Elder yet.' : ''; } }
  ];
  /* The show now being held: the first not yet won. Null once all are won. */
  Game.prototype.showNow = function () {
    for (var i = 0; i < SHOWS.length; i++) if (!this.shows[SHOWS[i].id]) return SHOWS[i];
    return null;
  };
  Game.prototype.showsWon = function () { return Object.keys(this.shows).length; };
  /* '' if the show is open for entries, else what the garden still needs. */
  Game.prototype.showLocked = function (s) {
    if (this.shows[s.id]) return 'Already won.';
    if (s !== this.showNow()) return 'Win the shows before it first.';
    return s.unlock && !s.unlock.ok(this) ? s.unlock.text + ' first.' : '';
  };
  /* Why this koi cannot enter the show, or '' if it can. */
  Game.prototype.canEnter = function (s, k) {
    if (!k || this.koi.indexOf(k) < 0) return 'No such koi.';
    if (!this.revealed(k)) return 'Its colours are not in yet.';
    if (k.wild) return 'Welcome it first.';
    return this.showLocked(s) || s.fits(this, k);
  };
  Game.prototype.showEntrants = function (s) {
    var out = [], i;
    if (!s || this.showLocked(s)) return out;
    for (i = 0; i < this.koi.length; i++) if (!this.canEnter(s, this.koi[i])) out.push(this.koi[i]);
    return out;
  };
  Game.prototype.enterShow = function (showId, koiId) {
    var s = null, i, k = this.byId(koiId);
    for (i = 0; i < SHOWS.length; i++) if (SHOWS[i].id === showId) s = SHOWS[i];
    if (!s || this.canEnter(s, k)) return false;
    this.shows[s.id] = k.name;
    this.coins += s.prize;
    this.events.push({ kind: 'unlock', text: k.name + ' won the ' + s.name + '! ' + s.prize + ' coins.' });
    return true;
  };

  /* ---------- saving ---------- */
  Game.prototype.toJSON = function () {
    var W = this.W, H = this.H;
    return {
      v: 1, layout: 7, works: this.works, seasonClock: this.seasonClock, goods: this.goods, seed: this.seed, coins: this.coins, coinFrac: this.coinFrac, nextId: this.nextId,
      pondTime: this.pondTime, book: this.book, pairs: this.pairs, offers: this.offers, offerLeft: this.offerLeft,
      requests: this.requests, requestWait: this.requestWait, plants: this.plants, popped: this.popped, shows: this.shows,
      lots: this.lots, stats: this.stats, goal: this.goal, gate: this.gate, cam: { x: this.cam.x, y: this.cam.y },
      koi: this.koi.filter(function (k) { return !k.wild; }).map(function (k) {   // a wild koi not yet welcomed is not kept
        return { id: k.id, name: k.name, genes: k.genes, seed: k.seed, sizePot: k.sizePot, growth: k.growth, full: k.full,
                 bond: k.bond, temper: k.temper, pond: 'home' };
      }),
      pads: this.pads.map(function (p) {
        return { x: p.x / AW, y: p.y / AH, k: p.k, rot: p.rot, flower: p.flower, lotus: !!p.lotus, tone: p.tone, grow: p.grow || 0, ripe: !!p.ripe };
      })
    };
  };

  Game.load = function (d, W, H) {
    if (!d || d.v !== 1 || !d.koi || !d.koi.length) return null;
    var g = new Game(W, H, ((d.seed >>> 0) + ((d.pondTime | 0) >>> 0) + 1) >>> 0);
    g.seed = d.seed; g.coins = d.coins; g.coinFrac = d.coinFrac || 0; g.nextId = d.nextId;
    g.pondTime = d.pondTime || 0; g.book = d.book || {};
    g.pairs = d.pairs || []; g.offers = d.offers || []; g.offerLeft = d.offerLeft || 0;
    g.requests = d.requests || [null, null, null]; g.requestWait = d.requestWait || [0, 0, 0];
    g.plants = d.plants || []; g.popped = d.popped || 0;
    g.goods = d.goods || {};
    g.shows = d.shows || {};
    if (d.stats) Object.keys(d.stats).forEach(function (k) { g.stats[k] = d.stats[k]; });
    if (d.gate && d.gate.level >= 1 && d.gate.level <= GATE.caps.length) g.gate = { till: d.gate.till || 0, level: d.gate.level };
    g.goal = d.goal || 0;
    g.seasonClock = d.seasonClock || 0;
    if (d.layout === 7) {
      var L = d.lots || {};
      g.lots = { home: { kind: 'pond', level: clamp((L.home && L.home.level) | 0, 1, 4), till: 0 } };
      if (L.tea) g.lots.tea = { kind: 'tea', level: clamp(L.tea.level | 0, 1, 3), till: L.tea.till || 0 };
      g.works = { falls: !!(d.works && d.works.falls), bridge: !!(d.works && d.works.bridge) };
    } else {
      // the garden has become one lake since this was saved. The koi, the coins, the Koi Book and the shows
      // come across. Pond sections become a bigger lake; everything else built is handed back as coins.
      var back = 0, homeN = 0, tea = false;
      Object.keys(d.lots || {}).forEach(function (id) {
        var lot = d.lots[id];
        if (id === 'home' || id === 'market') return;
        if (lot.kind === 'pond' && /^p(2|3)(2|3)$/.test(id) && d.layout === 6) homeN++;
        else if (lot.kind === 'tea' && !tea) tea = true;
        else back += 400;
      });
      g.lots = { home: { kind: 'pond', level: clamp(1 + homeN, 1, 4), till: 0 } };
      if (tea) g.lots.tea = { kind: 'tea', level: 1, till: 0 };
      (d.plants || []).forEach(function (pl) { if (PLANTS[pl.type]) back += PLANTS[pl.type].cost; });
      g.coins += back;
      g.plants = []; d.pads = [];
      g.goal = 0;
    }
    g.unlocked = {};
    Object.keys(g.lots).forEach(function (id) { g.unlocked[id] = true; });
    g._buildField();
    g._clampCam(); g._syncGrid();
    g.plants = g.plants.filter(function (pl) { return PLANTS[pl.type]; });
    g.plants.forEach(function (pl) {
      if (pl.x !== undefined) return;
      var w = PLANTS[pl.type].where, hs = SHAPES.home;
      if (w === 'water') { pl.x = hs.cx + (pl.fx - 0.5) * 800; pl.y = hs.cy + (pl.fy - 0.5) * 500; pl.a = 0; }
      else if (pl.side === 0) { pl.x = hs.cx + (pl.at - 0.5) * 900; pl.y = hs.cy - 440; pl.a = Math.PI / 2; }
      else if (pl.side === 1) { pl.x = hs.cx + 700; pl.y = hs.cy + (pl.at - 0.5) * 500; pl.a = Math.PI; }
      else if (pl.side === 2) { pl.x = hs.cx + (pl.at - 0.5) * 900; pl.y = hs.cy + 440; pl.a = -Math.PI / 2; }
      else { pl.x = hs.cx - 700; pl.y = hs.cy + (pl.at - 0.5) * 500; pl.a = 0; }
    });
    var i;
    for (i = 0; i < d.koi.length; i++) {
      var s = d.koi[i];
      var k = { id: s.id, name: s.name, genes: s.genes, seed: s.seed, sizePot: s.sizePot, growth: s.growth, full: s.full,
                bond: s.bond || 0, temper: s.temper === undefined ? s.id % TEMPERS.length : s.temper,
                pond: 'home' };
      g.koi.push(k);
      g._embody(k);
    }
    for (i = 0; i < (d.pads || []).length; i++) {
      var p = d.pads[i];
      g.pads.push({ x: p.x * AW, y: p.y * AH, vx: 0, vy: 0, rot: p.rot, rotv: 0, k: p.k, r: g.padBase * p.k,
                    bob: 0, tx: 0, ty: 0, flower: p.flower, lotus: !!p.lotus, tone: p.tone, grow: p.grow || 0, ripe: !!p.ripe });
    }
    for (i = 0; i < 3; i++) if (!g.requests[i] && g.requestWait[i] <= 0) g.requests[i] = g._newRequest();
    if (!g.pads.length) { g.addPad(true, false, AREAS[0]); g.addPad(true, true, AREAS[0]); }
    g._placeCat();
    g._seasonWas = g.season().i;
    g._constrain();
    return g;
  };

  var api = { Game: Game, T: T, DT: DT, AREAS: AREAS, AW: AW, AH: AH, COLS: COLS, ROWS: ROWS, areaById: areaById,
              SHAPES: SHAPES, outline: outline, blobPoint: blobPoint, GOODS: GOODS, CROP: CROP, KINDS: KINDS, LEVEL: LEVEL, STATIONS: STATIONS, GATE: GATE, LAKE: LAKE, LAKE_CAP: LAKE_CAP, LAKE_COST: LAKE_COST, WORKS: WORKS, ISLE: ISLE, SEASONS: SEASONS, lakeD: lakeD, THEMES: THEMES, THEME_NAMES: THEME_NAMES, themeOf: themeOf, BIOMES: BIOMES, biomeById: biomeById, STARS: STARS, GOALS: GOALS, SHOWS: SHOWS, areaAt: areaAt, GATES: GATES, PATHS: PATHS, WALL: WALL, inBlob: inBlob, PLANTS: PLANTS, TEMPERS: TEMPERS, STAGES: STAGES, VARIETIES: VARIETIES,
              outcomes: outcomes, bondWord: bondWord, BASES: BASES, PATTERNS: PATTERNS, SECONDS: SECONDS, BOOK_TOTAL: BOOK_TOTAL,
              phenotype: phenotype, varietyName: varietyName, varietyKey: varietyKey, rarity: rarity,
              inherit: inherit, randomGenes: randomGenes, stageOf: stageOf,
              WANDER: WANDER, FLEE: FLEE, WARY: WARY, CURIOUS: CURIOUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KoiSim = api;
})(typeof window !== 'undefined' ? window : this);
