/* Stillwater Koi prototype: sound. Everything is quiet by design; the water is the loudest thing. */
(function (root) {
  'use strict';
  var DIR = 'assets/audio/';
  var FILES = ['plop1', 'plop2', 'plop3', 'plop4', 'eat1', 'eat2', 'eat3', 'food1', 'food2', 'food3',
    'coin1', 'coin2', 'coin3', 'select1', 'select2', 'select3', 'hand1', 'hand2', 'hand3',
    'wake1', 'wake2', 'wake3', 'open', 'close', 'plant1', 'plant2', 'twinkle1', 'twinkle2', 'bubbles',
    'amb_day', 'amb_night', 'amb_rain', 'music_day', 'music_night'];
  var GROUPS = { plop: 4, eat: 3, food: 3, coin: 3, select: 3, hand: 3, wake: 3, plant: 2, twinkle: 2 };
  var PREF = 'stillwater-koi-sound';

  var ctx = null, master, sfxBus, ambBus, musicBus;
  var buf = {}, lastPick = {}, lastAt = {};
  var on = true, started = false, night = 0, rain = 0;
  try { on = localStorage.getItem(PREF) !== 'off'; } catch (e) {}

  function load(name) {
    return fetch(DIR + name + '.ogg').then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return ctx.decodeAudioData(a); })
      .then(function (b) { buf[name] = b; })
      .catch(function () {});
  }

  /* Call from any key, click or button press. Browsers only let sound start from one. */
  function unlock() {
    if (!started) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      started = true;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = on ? 1 : 0; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = 0.5; ambBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.2; musicBus.connect(master);
      loops.day = new Looper('amb_day'); loops.night = new Looper('amb_night'); loops.rain = new Looper('amb_rain');
      FILES.forEach(load);
      music.next = 0;
      setInterval(update, 500);   // keeps loops going even if frames are slow
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function setOn(v) {
    on = v;
    try { localStorage.setItem(PREF, v ? 'on' : 'off'); } catch (e) {}
    if (ctx) master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.2);
  }

  /* One sound. name is a file or a group ("plop" picks one of plop1..4, never the same twice running). */
  function play(name, vol, rate, pan, gap) {
    if (!ctx || !on || ctx.state !== 'running') return;
    var t = ctx.currentTime;
    if (gap && lastAt[name] !== undefined && t - lastAt[name] < gap) return;
    lastAt[name] = t;
    var file = name, n = GROUPS[name];
    if (n) {
      var i = 1 + ((Math.random() * n) | 0);
      if (i === lastPick[name]) i = 1 + (i % n);
      lastPick[name] = i; file = name + i;
    }
    var b = buf[file];
    if (!b) return;
    var src = ctx.createBufferSource(); src.buffer = b;
    src.playbackRate.value = (rate || 1) * (0.96 + Math.random() * 0.08);
    var g = ctx.createGain(); g.gain.value = vol === undefined ? 0.5 : vol;
    src.connect(g);
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); p.connect(sfxBus);
    } else g.connect(sfxBus);
    src.start();
  }

  /* Things that happen on the water. x runs 0..1 across the pond. */
  function cue(c) {
    var pan = (c.x - 0.5) * 1.2;
    if (c.k === 'plop') play('plop', 0.3 + 0.35 * c.s, 1, pan);
    else if (c.k === 'drip') play('eat', 0.1 + 0.12 * c.s, 1.25, pan, 0.2);
    else if (c.k === 'wake') play('wake', 0.06 + 0.12 * c.s, 1, pan, 0.45);
    else if (c.k === 'food') play('food', 0.28, 1, pan, 0.12);
    else if (c.k === 'eat') play('eat', 0.2 + 0.12 * c.s, 1.45 - 0.4 * c.s, pan, 0.07);
    else if (c.k === 'splash') { play('plop', 0.22, 1.5, pan, 0.05); play('coin', 0.1, 1.3, pan, 0.05); }
    else if (c.k === 'pick') play('coin', 0.3, 1, pan, 0.04);
    else if (c.k === 'purr') play('select', 0.14, 0.55, pan, 0.5);
    else if (c.k === 'ticket') play('coin', 0.14, 1.25, pan, 0.25);
    else if (c.k === 'throw') play('hand', 0.12, 0.8, pan, 0.2);
    else if (c.k === 'harvest') { play('plant', 0.35, 1.1, pan); play('twinkle', 0.3, 1.2, pan); }
    else if (c.k === 'rake') play('food', 0.1 + 0.1 * c.s, 0.7, pan, 0.22);
  }
  /* Things the game announces. */
  function event(kind) {
    if (kind === 'sold') play('coin', 0.4);
    else if (kind === 'bought') { play('coin', 0.35); play('plop', 0.3); }
    else if (kind === 'pad') play('plant', 0.4);
    else if (kind === 'book') play('twinkle', 0.6, 1, 0, 0.6);
    else if (kind === 'grew') play('twinkle', 0.45, 0.85, 0, 0.6);
    else if (kind === 'fry') { play('bubbles', 0.35); play('twinkle', 0.4, 1.1); }
    else if (kind === 'pair') play('select', 0.4, 0.8);
    else if (kind === 'reveal') play('twinkle', 0.5, 1, 0, 0.5);
    else if (kind === 'request') play('open', 0.25, 1.2);
    else if (kind === 'unlock') { play('twinkle', 0.6, 0.8); play('coin', 0.4); }
  }
  function ui(kind) {
    if (kind === 'hand') play('hand', 0.3);
    else if (kind === 'select') play('select', 0.3);
    else if (kind === 'open') play('open', 0.3);
    else if (kind === 'close') play('close', 0.3);
  }

  /* A long recording played end to end with itself, overlapping by a few seconds so there is no seam. */
  var loops = {}, XF = 5;
  function Looper(name) {
    this.name = name; this.next = 0;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(ambBus);
  }
  Looper.prototype.tick = function () {
    var b = buf[this.name], t = ctx.currentTime;
    if (!b || t < this.next - 1) return;
    var at = Math.max(t, this.next), d = b.duration;
    var src = ctx.createBufferSource(); src.buffer = b;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + XF);
    g.gain.setValueAtTime(1, at + d - XF);
    g.gain.linearRampToValueAtTime(0, at + d);
    src.connect(g); g.connect(this.out);
    src.start(at);
    this.next = at + d - XF;
  };

  /* Music comes and goes: one piece, then a long stretch of just the pond. */
  var music = { next: 0, first: true };
  function tickMusic() {
    var t = ctx.currentTime;
    if (!music.next) { music.next = t + 25; return; }
    if (t < music.next) return;
    var name = night > 0.5 ? 'music_night' : 'music_day', b = buf[name];
    if (!b) return;
    var src = ctx.createBufferSource(); src.buffer = b;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(name === 'music_night' ? 0.6 : 1, t + 4);
    g.gain.setValueAtTime(name === 'music_night' ? 0.6 : 1, t + b.duration - 5);
    g.gain.linearRampToValueAtTime(0, t + b.duration);
    src.connect(g); g.connect(musicBus);
    src.start(t);
    music.next = t + b.duration + 70 + Math.random() * 80;
  }

  function update() {
    if (!ctx || ctx.state !== 'running') return;
    loops.day.tick(); loops.night.tick(); loops.rain.tick();
    var t = ctx.currentTime;
    loops.day.out.gain.setTargetAtTime(1 - night, t, 2);
    loops.night.out.gain.setTargetAtTime(night, t, 2);
    loops.rain.out.gain.setTargetAtTime(rain * 0.8, t, 1.5);
    tickMusic();
  }
  function setNight(n) { night = Math.max(0, Math.min(1, n)); }
  function setRain(n) { rain = Math.max(0, Math.min(1, n)); }

  root.KoiAudio = { unlock: unlock, cue: cue, event: event, ui: ui, setNight: setNight, setRain: setRain, update: update,
                    setOn: setOn, isOn: function () { return on; },
                    state: function () { return { started: started, ctx: ctx ? ctx.state : 'none', loaded: Object.keys(buf).length, of: FILES.length, night: night, musicNext: music.next, now: ctx ? ctx.currentTime : 0 }; } };
})(window);
