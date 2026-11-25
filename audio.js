/* Koi: sound and music. The water is the loudest thing; everything else is small and soft.
   Browsers only allow sound after a tap or key press, so nothing plays until the first one. */
(function (root) {
  'use strict';
  var DIR = 'assets/audio/';
  var GROUPS = { plop: 4, eat: 3, food: 3, coin: 3, select: 3, hand: 3, wake: 3, plant: 2, twinkle: 2 };
  var SMALL = ['bubbles', 'open', 'close'];
  Object.keys(GROUPS).forEach(function (g) { for (var i = 1; i <= GROUPS[g]; i++) SMALL.push(g + i); });
  var PREF = 'koi-sound-v1';

  /* The music to choose from. Two are recordings; koto and chimes are played live, note by note, so they never repeat;
     rainfall is a rain recording with a chime now and then. */
  var THEMES = [
    { id: 'garden', name: 'Tea garden', about: 'Two slow pieces, taking turns', pieces: ['music_day', 'music_night'] },
    { id: 'moon', name: 'Moonlit', about: 'The quiet night piece', pieces: ['music_night'] },
    { id: 'koto', name: 'Koto', about: 'A koto, wandering', gen: 'koto' },
    { id: 'chimes', name: 'Wind chimes', about: 'Bronze chimes in the breeze', gen: 'chimes' },
    { id: 'rain', name: 'Rainfall', about: 'Rain on the water', loop: 'amb_rain', gen: 'drops' }
  ];
  function theme(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[0]; }

  /* Three volumes, 0..1, set by the sliders in Settings. The gain is the square, so the sliders feel even.
     0.8 on a slider is the mix as designed. */
  var BASE = { sound: 0.9, water: 0.32, music: 0.3 };
  var vol = { sound: 0.8, water: 0.8, music: 0.8 }, themeId = 'garden';
  try {
    var saved = JSON.parse(localStorage.getItem(PREF) || 'null');
    if (saved) {
      for (var key in vol) {
        if (typeof saved[key] === 'number') vol[key] = Math.max(0, Math.min(1, saved[key]));
        else if (saved[key] === false) vol[key] = 0;               // from the old on/off buttons
      }
      if (saved.sound === false && saved.water === undefined) vol.water = 0;
      if (saved.theme) themeId = theme(saved.theme).id;
    }
  } catch (e) {}
  function gainOf(k) { return BASE[k] * vol[k] * vol[k] / 0.64; }
  function save() { try { localStorage.setItem(PREF, JSON.stringify({ sound: vol.sound, water: vol.water, music: vol.music, theme: themeId })); } catch (e) {} }

  var ctx = null, master, sfxBus, ambBus, musicBus, genBus;
  var buf = {}, loading = {}, lastPick = {}, lastAt = {};
  var started = false;

  function load(name) {
    if (loading[name]) return loading[name];
    loading[name] = fetch(DIR + name + '.ogg').then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); })
      .then(function (b) { buf[name] = b; })
      .catch(function () { loading[name] = null; });
    return loading[name];
  }
  function loadTheme(t) {
    (t.pieces || []).forEach(load);
    if (t.loop) load(t.loop);
  }

  /* A soft hall for the live instruments: a burst of noise that dies away over a few seconds. */
  function makeHall() {
    var sr = ctx.sampleRate, n = Math.floor(sr * 3.2), ir = ctx.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    var cv = ctx.createConvolver(); cv.buffer = ir; return cv;
  }

  function unlock() {
    if (!started) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      started = true;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = gainOf('sound'); sfxBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = gainOf('water'); ambBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = gainOf('music'); musicBus.connect(master);
      // the live instruments go in dry and through the hall
      genBus = ctx.createGain(); genBus.gain.value = 1.6;
      var hall = makeHall(), wet = ctx.createGain(); wet.gain.value = 0.55;
      genBus.connect(musicBus); genBus.connect(hall); hall.connect(wet); wet.connect(musicBus);
      amb = new Looper('amb_day', ambBus);
      rain = new Looper('amb_rain', musicBus);
      SMALL.forEach(load);                                  // the small sounds first, then the long recordings
      load('amb_day'); loadTheme(theme(themeId));
      music.next = ctx.currentTime + 2.5;
      setInterval(update, 300);
    }
    if (ctx && ctx.state === 'suspended' && !document.hidden && !paused) ctx.resume();
  }

  /* One sound. A group name ("plop") picks one of plop1..4, never the same twice running.
     gap: skip it if the same sound played less than this many seconds ago. */
  function play(name, v, rate, pan, gap) {
    if (!ctx || !vol.sound || ctx.state !== 'running') return;
    var t = ctx.currentTime;
    if (gap && lastAt[name] !== undefined && t - lastAt[name] < gap) return;
    var file = name, n = GROUPS[name];
    if (n) {
      var i = 1 + ((Math.random() * n) | 0);
      if (i === lastPick[name]) i = 1 + (i % n);
      file = name + i;
      if (buf[file]) lastPick[name] = i;
    }
    var b = buf[file];
    if (!b) return;
    lastAt[name] = t;
    var src = ctx.createBufferSource(); src.buffer = b;
    src.playbackRate.value = (rate || 1) * (0.96 + Math.random() * 0.08);
    var g = ctx.createGain(); g.gain.value = v === undefined ? 0.5 : v;
    src.connect(g);
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); p.connect(sfxBus);
    } else g.connect(sfxBus);
    src.start();
  }

  /* Things that happen on the water, from the pond's cue list. x runs 0..1 across the screen; s is 0..1. */
  function cue(c) {
    var pan = (c.x - 0.5) * 1.2, s = c.s;
    switch (c.k) {
      case 'food': play('food', 0.32, 1, pan, 0.08); play('plop', 0.12, 1.6, pan, 0.08); break;
      case 'eat': play('eat', 0.2 + 0.14 * s, 1.45 - 0.45 * s, pan, 0.06); break;   // a big koi gulps lower
      case 'wake': play('wake', 0.07 + 0.13 * s, 1, pan, 0.4); break;
      case 'drip': play('plop', 0.12 + 0.2 * s, 1.05, pan, 0.3); break;
      case 'sip': play('eat', 0.1, 1.25, pan, 0.3); break;
      case 'harvest': play('plant', 0.4, 1.1, pan); play('twinkle', 0.3, 1.2, pan); break;
      case 'ripe': play('twinkle', 0.16, 1.35, pan, 1.2); break;
      case 'fry': play('bubbles', 0.4, 1.1, pan); play('twinkle', 0.32, 1.25, pan); break;
    }
  }

  /* Things that happen in the shop and the menus. */
  function ui(kind) {
    switch (kind) {
      case 'open': play('open', 0.32); break;
      case 'close': play('close', 0.3); break;
      case 'tab': play('select', 0.26, 1.05, 0, 0.05); break;
      case 'arm': play('hand', 0.3, 1.1); break;
      case 'buyKoi': play('coin', 0.38); play('bubbles', 0.3); break;
      case 'buyPlant': play('coin', 0.38); play('plant', 0.36); break;
      case 'sell': play('coin', 0.42); setTimeout(function () { play('coin', 0.3, 1.2); }, 110); break;
      case 'no': play('hand', 0.22, 0.7, 0, 0.2); break;
      case 'toggle': play('select', 0.3, 0.9); break;
      case 'menu': play('select', 0.24, 1.15, 0, 0.05); break;
      case 'saved': play('twinkle', 0.3, 1.1); break;
      case 'feat': play('twinkle', 0.42, 0.9); setTimeout(function () { play('twinkle', 0.3, 1.2); }, 160); break;
      case 'test': play('plop', 0.4, 1, 0, 0.15); break;
    }
  }

  /* A long recording played end to end with itself, overlapping by a few seconds so there is no seam. */
  var amb = null, rain = null, XF = 5;
  function Looper(name, bus) {
    this.name = name; this.next = 0; this.srcs = [];
    this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(bus);
  }
  Looper.prototype.tick = function () {
    var b = buf[this.name], t = ctx.currentTime;
    if (!b || t < this.next - 1) return;
    var at = Math.max(t, this.next), d = b.duration, first = !this.srcs.length;
    var src = ctx.createBufferSource(); src.buffer = b;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + (first ? 2 : XF));
    g.gain.setValueAtTime(1, at + d - XF);
    g.gain.linearRampToValueAtTime(0, at + d);
    src.connect(g); g.connect(this.out);
    src.start(at);
    var me = this; this.srcs.push(src);
    src.onended = function () { var i = me.srcs.indexOf(src); if (i >= 0) me.srcs.splice(i, 1); };
    this.next = at + d - XF;
  };
  Looper.prototype.stop = function (fade) {
    var t = ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.srcs.forEach(function (s) { try { s.stop(t + fade); } catch (e) {} });
    this.srcs = []; this.next = 0;
    var out = this.out;
    setTimeout(function () { out.gain.cancelScheduledValues(0); out.gain.value = 1; }, fade * 1000 + 50);
  };

  /* ---------- the live instruments ---------- */
  var SR = 0, notes = {};
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // a plucked string: a burst of noise run round a loop that loses a little each time (Karplus-Strong)
  function pluck(m) {
    var k = 'p' + m; if (notes[k]) return notes[k];
    var sr = SR, f = hz(m), len = Math.floor(sr * 3), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    var N = Math.max(2, Math.round(sr / f)), ring = new Float32Array(N), i, last = 0;
    for (i = 0; i < N; i++) { last = last * 0.55 + (Math.random() * 2 - 1) * 0.45; ring[i] = last; }
    var loss = Math.pow(0.5, 1 / (f * (m < 60 ? 2.4 : 1.6)));
    for (i = 0; i < len; i++) {
      var j = i % N, nx = ring[(j + 1) % N];
      var v = ring[j];
      ring[j] = (v + nx) * 0.5 * loss;
      d[i] = v * (i < 40 ? i / 40 : 1);
    }
    return (notes[k] = b);
  }
  // a hanging bronze tube: a few out-of-tune partials, the high ones dying first
  function bell(m) {
    var k = 'b' + m; if (notes[k]) return notes[k];
    var sr = SR, f = hz(m), len = Math.floor(sr * 5), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    var P = [[1, 1, 1.1], [2.76, 0.42, 2.2], [5.4, 0.2, 3.6], [8.93, 0.09, 5.5], [0.5, 0.18, 0.7]];
    for (var i = 0; i < len; i++) {
      var t = i / sr, v = 0;
      for (var p = 0; p < P.length; p++) v += Math.sin(6.2832 * f * P[p][0] * t) * P[p][1] * Math.exp(-t * P[p][2]);
      d[i] = v * 0.4 * (i < 60 ? i / 60 : 1);
    }
    return (notes[k] = b);
  }
  function note(b, at, v, pan, rate) {
    var src = ctx.createBufferSource(); src.buffer = b; if (rate) src.playbackRate.value = rate;
    var g = ctx.createGain(); g.gain.value = v;
    src.connect(g);
    if (ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(genBus); }
    else g.connect(genBus);
    src.start(at);
  }

  // the "in" scale on D: D Eb G A Bb, the sound of old Japanese court and koto music
  var KOTO = [50, 55, 57, 62, 63, 67, 69, 70, 74, 75, 79, 81];
  var CHIME = [74, 76, 79, 81, 83, 86, 88, 91];           // D major pentatonic, high and bright
  var gen = { next: 0, at: 5, left: 0, rest: false, beat: 0.42 };

  function genKoto(t) {
    while (gen.next < t + 1.2) {
      var at = gen.next;
      if (gen.left <= 0) {
        if (!gen.rest) { gen.rest = true; gen.next += gen.beat * (4 + Math.random() * 6); continue; }
        gen.rest = false; gen.left = 8 + ((Math.random() * 10) | 0);
        gen.at = 4 + ((Math.random() * 4) | 0);
        // a phrase opens with a low open string under it
        note(pluck(KOTO[Math.random() < 0.6 ? 0 : 1]), at, 0.5, -0.2);
      }
      if (Math.random() < 0.68) {
        var step = [-2, -1, -1, 1, 1, 2, 0][(Math.random() * 7) | 0];
        gen.at = Math.max(2, Math.min(KOTO.length - 1, gen.at + step));
        var v = 0.36 + Math.random() * 0.22;
        note(pluck(KOTO[gen.at]), at, v, (Math.random() - 0.5) * 0.5);
        // now and then the koto's little bend up into a note, or a fifth below it
        if (Math.random() < 0.12 && gen.at > 3) note(pluck(KOTO[gen.at - 3]), at + 0.01, v * 0.6, 0.1);
      }
      gen.left--;
      // a little push and pull in the time, and a held note at the end of a phrase
      gen.next += gen.beat * (gen.left === 0 ? 3 : Math.random() < 0.15 ? 2 : 1) * (0.94 + Math.random() * 0.12);
    }
  }
  function genChimes(t, sparse) {
    while (gen.next < t + 1.2) {
      var at = gen.next;
      if (sparse) {
        note(bell(CHIME[(Math.random() * CHIME.length) | 0] - 12), at, 0.18 + Math.random() * 0.12, (Math.random() - 0.5) * 1.2);
        gen.next += 4 + Math.random() * 9;
        continue;
      }
      // a gust: a few chimes knock together, then the air goes still
      if (gen.left <= 0) { gen.left = 2 + ((Math.random() * 6) | 0); gen.next += 1.5 + Math.random() * 5; continue; }
      note(bell(CHIME[(Math.random() * CHIME.length) | 0]), at, 0.14 + Math.random() * 0.16, (Math.random() - 0.5) * 1.4);
      gen.left--;
      gen.next += 0.12 + Math.random() * 0.5;
    }
  }

  /* ---------- whichever theme is chosen ---------- */
  var music = { next: 0, i: 0, src: null, gain: null, playing: '' };
  function stopPiece(fade) {
    if (!music.src) return;
    var t = ctx.currentTime;
    music.gain.gain.cancelScheduledValues(t);
    music.gain.gain.setValueAtTime(music.gain.gain.value, t);
    music.gain.gain.linearRampToValueAtTime(0, t + fade);
    try { music.src.stop(t + fade + 0.05); } catch (e) {}
    music.src = null; music.playing = '';
  }
  function tickMusic() {
    var t = ctx.currentTime, th = theme(themeId);
    if (!vol.music || t < music.next) return;
    if (th.loop) { rain.tick(); if (buf[th.loop]) music.playing = th.id; }
    if (th.gen) {
      SR = ctx.sampleRate;
      if (gen.next < t) gen.next = t + 0.1;
      if (th.gen === 'koto') genKoto(t); else genChimes(t, th.gen === 'drops');
      music.playing = th.id;
    }
    if (!th.pieces || music.src) return;
    var name = th.pieces[music.i % th.pieces.length], b = buf[name];
    if (!b) return;
    var src = ctx.createBufferSource(); src.buffer = b;
    var g = ctx.createGain(), top = name === 'music_night' ? 0.75 : 1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(top, t + 3);
    g.gain.setValueAtTime(top, t + b.duration - 5);
    g.gain.linearRampToValueAtTime(0, t + b.duration);
    src.connect(g); g.connect(musicBus);
    src.start(t);
    src.onended = function () { if (music.src === src) { music.src = null; music.playing = ''; } };
    music.src = src; music.gain = g; music.playing = name;
    music.i++;
    music.next = t + b.duration + 25 + Math.random() * 30;
  }

  function setTheme(id) {
    var th = theme(id);
    if (th.id === themeId) return;
    themeId = th.id; save();
    if (!ctx) return;
    loadTheme(th);
    stopPiece(1.2);
    if (rain) rain.stop(1.5);
    gen.next = 0; gen.left = 0; gen.rest = false;
    music.i = 0; music.playing = '';
    music.next = ctx.currentTime + 1;
  }

  /* Weather: rain falling on the water, under everything else. */
  var weather = { rain: 0 }, rainAmb = null, rainGain = null;
  function setWeather(w) { weather.rain = Math.max(0, Math.min(1, +w.rain || 0)); }
  function tickWeather() {
    if (!rainAmb) {
      rainGain = ctx.createGain(); rainGain.gain.value = 0; rainGain.connect(ambBus);
      rainAmb = new Looper('amb_rain', rainGain);
    }
    rainGain.gain.setTargetAtTime(weather.rain * 1.3, ctx.currentTime, 1.5);
    if (weather.rain > 0.03) { load('amb_rain'); rainAmb.tick(); }
    else if (rainAmb.srcs.length && weather.rain < 0.01) rainAmb.stop(2);
  }

  var paused = false;
  function update() {
    if (!ctx || ctx.state !== 'running') return;
    amb.tick();
    tickWeather();
    tickMusic();
  }

  /* kind is 'sound', 'water' or 'music'; v is 0..1. */
  function setVolume(kind, v) {
    if (!(kind in vol)) return;
    var was = vol[kind];
    vol[kind] = Math.max(0, Math.min(1, +v || 0)); save();
    if (!ctx) return;
    var bus = kind === 'sound' ? sfxBus : kind === 'water' ? ambBus : musicBus;
    bus.gain.setTargetAtTime(gainOf(kind), ctx.currentTime, kind === 'sound' ? 0.03 : 0.15);
    if (kind === 'music') {
      if (!vol.music) { stopPiece(1); rain.stop(1); }
      if (vol.music && !was) { music.next = ctx.currentTime + 0.4; gen.next = 0; }
    }
  }

  /* Everything goes still while the game is set aside (Save and exit), and comes back after. */
  function pause(p) {
    paused = !!p;
    if (!ctx) return;
    if (paused) ctx.suspend(); else if (!document.hidden) ctx.resume();
  }

  // the first touch, click or key anywhere wakes the sound up
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { root.addEventListener(ev, unlock, true); });
  // quiet while the page is in the background
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (!paused) ctx.resume();
  });

  root.KoiAudio = {
    unlock: unlock, cue: cue, ui: ui, setVolume: setVolume, setTheme: setTheme, pause: pause, setWeather: setWeather,
    themes: THEMES.map(function (t) { return { id: t.id, name: t.name, about: t.about }; }),
    theme: function () { return themeId; },
    volumes: function () { return { sound: vol.sound, water: vol.water, music: vol.music }; },
    state: function () {
      return { started: started, ctx: ctx ? ctx.state : 'none', loaded: Object.keys(buf).length, theme: themeId,
               music: music.playing, musicNext: music.next, now: ctx ? ctx.currentTime : 0 };
    }
  };
})(window);
