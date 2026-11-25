/* The More menu: Shop, the Koi Book (achievements), and Settings (volume, music, pond colour, saving).
   Also the little banners that announce a birth or an achievement, and the screen you see after Save and exit. */
(function () {
  'use strict';
  var S = window.PondSim, G = window.KoiGame, D = window.KoiDraw, A = window.KoiAudio, Shop = window.KoiShop;
  var I = Shop.icons;
  function sfx(k) { if (A) A.ui(k); }
  function pond() { return G.pond(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  var BOOK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">' +
             '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z" fill="currentColor" fill-opacity="0.22"/><path d="M12 6.5v13"/></svg>';
  var KNOB = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
             '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2.2" fill="currentColor"/><circle cx="15.5" cy="12" r="2.2" fill="currentColor"/><circle cx="7.5" cy="18" r="2.2" fill="currentColor"/></svg>';
  var btn = document.getElementById('shopBtn');

  /* ---------- the pop-up above the More button ---------- */
  var more = el('div'); more.id = 'more'; more.hidden = true; more.setAttribute('role', 'menu'); more.setAttribute('aria-label', 'More');
  more.innerHTML =
    '<button type="button" role="menuitem" class="pick" data-go="shop">' + I.STALL + '<span>Shop</span></button>' +
    '<button type="button" role="menuitem" class="pick" data-go="book">' + BOOK + '<span>Koi book</span><b class="tally"></b></button>' +
    '<button type="button" role="menuitem" class="pick" data-go="settings">' + KNOB + '<span>Settings</span></button>';
  document.body.appendChild(more);
  var picks = Array.prototype.slice.call(more.querySelectorAll('.pick'));

  function openMore() {
    if (!more.hidden) return;
    more.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    more.querySelector('.tally').textContent = tally().done + '/' + tally().of;
    sfx('menu');
    picks[0].focus({ preventScroll: true });
  }
  function closeMore(back) {
    if (more.hidden) return;
    more.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open');
    if (back) btn.focus();
  }
  btn.addEventListener('click', function () { if (more.hidden) openMore(); else { closeMore(); sfx('menu'); } });
  picks.forEach(function (p, i) {
    p.addEventListener('click', function () {
      closeMore();
      var go = p.dataset.go;
      if (go === 'shop') Shop.open(); else if (go === 'book') openBook(); else openSettings();
    });
    p.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        picks[(i + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length].focus();
      }
    });
  });
  document.addEventListener('pointerdown', function (e) {
    if (!more.hidden && !more.contains(e.target) && !btn.contains(e.target)) closeMore();
  }, true);

  /* ---------- a wooden board: the same yard as the shop, smaller ---------- */
  var open = null;                       // the board that is showing, if any
  function board(id, title, wide) {
    var wrap = el('div'); wrap.id = id; wrap.className = 'yard'; wrap.hidden = true;
    wrap.innerHTML =
      '<div class="stall board' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + 'T">' +
        '<div class="yard-top">' +
          '<div class="plate"></div>' +
          '<div class="sign"><h2 id="' + id + 'T">' + title + '</h2></div>' +
          '<button class="shut" type="button" aria-label="Back to the water">' + I.CROSS + '</button>' +
        '</div>' +
        '<div class="lots"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    var b = { wrap: wrap, body: wrap.querySelector('.lots'), plate: wrap.querySelector('.plate'), shut: wrap.querySelector('.shut') };
    b.shut.addEventListener('click', function () { closeBoard(b); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeBoard(b); });
    return b;
  }
  function openBoard(b) {
    if (open) closeBoard(open, true);
    b.wrap.hidden = false; open = b; sfx('open');
    b.body.scrollTop = 0;
    b.shut.focus({ preventScroll: true });
  }
  function closeBoard(b, quiet) {
    if (b.wrap.hidden) return;
    b.wrap.hidden = true; if (open === b) open = null;
    if (!quiet) { sfx('close'); btn.focus({ preventScroll: true }); G.save(); }
  }
  function shelf(root, text) { var h = el('h3', 'shelf'); h.textContent = text; root.appendChild(h); return h; }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!more.hidden) { closeMore(true); return; }
      if (open) { closeBoard(open); return; }
    }
    if (e.key !== 'Tab' || !open) return;
    // keep the keyboard inside the board while it is open
    var f = Array.prototype.filter.call(open.wrap.querySelectorAll('button, input'), function (x) { return !x.disabled && x.tabIndex !== -1 && x.offsetParent; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- the koi book ---------- */
  var book = board('book', 'Koi Book', true);
  var MARKS = [['kept', 'Kept'], ['born', 'Born here'], ['grown', 'Grown']];
  function entry(v) { return pond().book[v] || { kept: false, born: 0, grown: false }; }
  function tally() {
    var done = 0, of = 0;
    S.VARIETY_ORDER.forEach(function (v) { var e = entry(v); of += 3; done += (e.kept ? 1 : 0) + (e.born ? 1 : 0) + (e.grown ? 1 : 0); });
    S.FEATS.forEach(function (f) { of++; if (pond().feats[f.id]) done++; });
    return { done: done, of: of };
  }
  function plantList(kinds) {
    var names = kinds.map(function (k) { return S.PLANTS[k].name.replace('water lily', 'lily').toLowerCase(); });
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : names[0];
  }
  // a koi drawn once, still, in a small round dish; a koi you have never kept is a shadow
  function dish(c, v, known) {
    var d = Math.min(window.devicePixelRatio || 1, 2), W = Math.round((c.clientWidth || 120) * d);
    c.width = W; c.height = W;
    var x = c.getContext('2d'), cx = W / 2, R = W * 0.46;
    x.fillStyle = 'rgba(8,4,2,0.4)'; x.beginPath(); x.arc(cx + W * 0.02, cx + W * 0.03, R, 0, 6.2832); x.fill();
    var rim = x.createLinearGradient(0, cx - R, 0, cx + R);
    rim.addColorStop(0, '#6b5a44'); rim.addColorStop(1, '#3e3226');
    x.fillStyle = rim; x.beginPath(); x.arc(cx, cx, R, 0, 6.2832); x.fill();
    var wg = x.createRadialGradient(cx - R * 0.2, cx - R * 0.25, R * 0.05, cx, cx, R * 0.86);
    wg.addColorStop(0, '#3a6f72'); wg.addColorStop(1, '#183a40');
    x.fillStyle = wg; x.beginPath(); x.arc(cx, cx, R * 0.86, 0, 6.2832); x.fill();
    var look = S.VARIETIES[v].look;
    if (!known) look = { body: '#0f2226', patch: '#0f2226', spots: [] };
    var f = { look: look, variety: v, len: R * 1.35, x: cx + R * 0.08, y: cx, a: -Math.PI * 0.62, phase: 1.2, turn: 0.35, glow: 0, k: 1 };
    D.fish(x, f);
  }
  function buildBook() {
    var root = book.body, p = pond(), t = tally();
    root.innerHTML = '';
    book.plate.innerHTML = '<span class="n">' + t.done + '</span><span class="of">of ' + t.of + '</span>';
    var lead = el('p', 'note left');
    lead.innerHTML = 'Keep each variety, grow one to <b>' + Math.round(S.GROWN_K * 24) + ' cm</b>, and have one born in your pond. ' +
      'Two grown, well-fed koi have young now and then, and the plants on the water decide what the babies look like.';
    root.appendChild(lead);
    shelf(root, 'Varieties');
    var g = el('div', 'grid book-grid');
    root.appendChild(g);
    var dishes = [];
    S.VARIETY_ORDER.forEach(function (v) {
      var e = entry(v), V = S.VARIETIES[v];
      var card = el('div', 'page' + (e.kept ? '' : ' unknown'));
      var c = el('canvas'); c.setAttribute('role', 'img');
      c.setAttribute('aria-label', e.kept ? 'A ' + V.name + ' koi' : 'A koi you have not kept yet');
      card.appendChild(c);
      var h = el('h4'); h.textContent = V.name; card.appendChild(h);
      var m = el('ul', 'marks');
      MARKS.forEach(function (mk) {
        var on = mk[0] === 'born' ? e.born > 0 : e[mk[0]];
        var li = el('li', on ? 'on' : '');
        li.textContent = mk[1] + (mk[0] === 'born' && e.born > 1 ? ' ×' + e.born : '');
        li.setAttribute('aria-label', mk[1] + (on ? ': done' : ': not yet'));
        m.appendChild(li);
      });
      card.appendChild(m);
      var hint = el('p', 'hint');
      var fav = S.favouredBy(v);
      hint.textContent = e.born ? 'Born near ' + plantList(fav) + '.' : 'Babies come near ' + plantList(fav) + '.';
      card.appendChild(hint);
      g.appendChild(card);
      dishes.push([c, v, e.kept]);
    });
    shelf(root, 'Milestones');
    var ms = el('ul', 'feats');
    S.FEATS.forEach(function (f) {
      var done = !!p.feats[f.id];
      var li = el('li', done ? 'done' : '');
      li.innerHTML = '<span class="seal" aria-hidden="true"></span><span class="what"><b></b><span></span></span>';
      li.querySelector('b').textContent = f.name;
      li.querySelector('.what span').textContent = f.about;
      li.setAttribute('aria-label', f.name + ': ' + f.about + (done ? ' Done.' : ' Not yet.'));
      ms.appendChild(li);
    });
    root.appendChild(ms);
    requestAnimationFrame(function () { dishes.forEach(function (d) { dish(d[0], d[1], d[2]); }); });
  }
  function openBook() { buildBook(); openBoard(book); }

  /* ---------- settings ---------- */
  var set = board('settings', 'Settings', false);
  set.plate.remove();
  function buildSettings() {
    var root = set.body;
    root.innerHTML = '';

    shelf(root, 'Volume');
    var vols = A ? A.volumes() : { music: 0.8, sound: 0.8, water: 0.8 };
    [['music', 'Music'], ['sound', 'Sounds'], ['water', 'Water and birds']].forEach(function (r) {
      var row = el('label', 'slide');
      row.innerHTML = '<span class="lbl"></span><input type="range" min="0" max="100" step="1"><output></output>';
      row.querySelector('.lbl').textContent = r[1];
      var inp = row.querySelector('input'), out = row.querySelector('output');
      function show() {
        out.textContent = inp.value === '0' ? 'Off' : inp.value;
        inp.style.setProperty('--fill', inp.value + '%');
      }
      inp.value = Math.round(vols[r[0]] * 100); show();
      inp.addEventListener('input', function () { show(); if (A) { A.unlock(); A.setVolume(r[0], inp.value / 100); } });
      if (r[0] === 'sound') inp.addEventListener('change', function () { sfx('test'); });
      root.appendChild(row);
    });

    if (A) {
      shelf(root, 'Music');
      var tg = el('div', 'choices themes'); tg.setAttribute('role', 'radiogroup'); tg.setAttribute('aria-label', 'Music');
      A.themes.forEach(function (th) {
        var b = el('button', 'choice'); b.type = 'button'; b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(A.theme() === th.id));
        b.innerHTML = '<b></b><span></span>';
        b.querySelector('b').textContent = th.name; b.querySelector('span').textContent = th.about;
        b.addEventListener('click', function () {
          A.unlock(); A.setTheme(th.id); sfx('tab');
          if (A.volumes().music === 0) { A.setVolume('music', 0.6); buildSettings(); return; }
          tg.querySelectorAll('.choice').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        });
        tg.appendChild(b);
      });
      root.appendChild(tg);
    }

    shelf(root, 'Pond colour');
    var pg = el('div', 'choices ponds'); pg.setAttribute('role', 'radiogroup'); pg.setAttribute('aria-label', 'Pond colour');
    G.schemes.forEach(function (sc) {
      var b = el('button', 'swatch'); b.type = 'button'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(G.scheme() === sc.id));
      b.innerHTML = '<i aria-hidden="true"></i><span></span>';
      b.querySelector('i').style.background = 'radial-gradient(circle at 42% 40%, ' + sc.floor[0] + ', ' + sc.floor[1] + ' 55%, ' + sc.floor[2] + ')';
      b.querySelector('span').textContent = sc.name;
      b.addEventListener('click', function () {
        G.setScheme(sc.id); sfx('tab');
        pg.querySelectorAll('.swatch').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      });
      pg.appendChild(b);
    });
    root.appendChild(pg);

    // the seasons and the weather: let them turn, or hold one
    var K = window.KoiSky;
    if (K) {
      var pills = function (title, list, current, setIt) {
        shelf(root, title);
        var g = el('div', 'choices pills'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', title);
        list.forEach(function (o) {
          var b = el('button', 'choice'); b.type = 'button'; b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(current === o[0]));
          b.innerHTML = '<b></b>'; b.querySelector('b').textContent = o[1];
          b.addEventListener('click', function () {
            setIt(o[0]); sfx('tab');
            g.querySelectorAll('.choice').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
          });
          g.appendChild(b);
        });
        root.appendChild(g);
      };
      pills('Seasons', [['turn', 'Turning']].concat(K.seasons.map(function (n, i) { return [String(i), n]; })), K.prefs().season, K.setSeason);
      pills('Weather', [['turn', 'Changing'], ['clear', 'Always clear'], ['rain', 'Rain'], ['snow', 'Snow'], ['windy', 'Windy'], ['mist', 'Mist']],
            K.prefs().weather, K.setWeather);
    }

    shelf(root, 'Your game');
    var row = el('div', 'gamebtns');
    var bSave = el('button', 'act sell'); bSave.type = 'button'; bSave.textContent = 'Save';
    var bExit = el('button', 'act'); bExit.type = 'button'; bExit.textContent = 'Save and exit';
    var bNew = el('button', 'act quiet'); bNew.type = 'button'; bNew.textContent = 'Start a new pond';
    var saved = 0, armed = false, armT = 0;
    bSave.addEventListener('click', function () {
      G.save(); sfx('saved');
      bSave.textContent = G.saving() ? 'Saved' : 'Not saved in test mode';
      clearTimeout(saved); saved = setTimeout(function () { bSave.textContent = 'Save'; }, 1800);
    });
    bExit.addEventListener('click', function () { G.save(); closeBoard(set, true); rest(); });
    bNew.addEventListener('click', function () {
      if (!armed) {
        armed = true; sfx('arm'); bNew.classList.add('sure');
        bNew.textContent = 'Tap again: lose this pond';
        clearTimeout(armT); armT = setTimeout(function () { armed = false; bNew.classList.remove('sure'); bNew.textContent = 'Start a new pond'; }, 3500);
        return;
      }
      G.startOver();
    });
    row.appendChild(bSave); row.appendChild(bExit); row.appendChild(bNew);
    root.appendChild(row);
    var fine = el('p', 'fine');
    fine.textContent = 'Your pond also saves itself every few seconds, and when you close the page.';
    root.appendChild(fine);
  }
  function openSettings() { buildSettings(); openBoard(set); }

  /* ---------- after Save and exit: the water, still, and a way back ---------- */
  var restEl = el('div'); restEl.id = 'rest'; restEl.hidden = true;
  restEl.innerHTML = '<div class="restcard" role="dialog" aria-modal="true" aria-labelledby="restT">' +
    '<img class="restmark" src="assets/brand/icon.svg" alt="" width="112" height="112">' +
    '<h1 id="restT">Koi Keeper</h1><p>Your pond is saved. The koi will be here when you come back.</p>' +
    '<button type="button" class="act sell">Back to the water</button></div>';
  document.body.appendChild(restEl);
  var restBtn = restEl.querySelector('button');
  function rest() {
    restEl.hidden = false; document.body.classList.add('resting');
    if (A) A.pause(true);
    restBtn.focus({ preventScroll: true });
  }
  restBtn.addEventListener('click', function () {
    restEl.hidden = true; document.body.classList.remove('resting');
    if (A) { A.pause(false); A.unlock(); }
    btn.focus({ preventScroll: true });
  });

  /* ---------- banners: a birth, an achievement ---------- */
  var news = el('div'); news.id = 'news'; news.setAttribute('aria-live', 'polite');
  document.body.appendChild(news);
  var queue = [], showing = false;
  function say(kind, title, text) { queue.push({ kind: kind, title: title, text: text }); if (!showing) next(); }
  function next() {
    var n = queue.shift();
    if (!n) { showing = false; return; }
    showing = true;
    var b = el('div', 'banner ' + n.kind);
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = n.title; b.querySelector('span').textContent = n.text;
    news.appendChild(b);
    if (n.kind !== 'born') sfx('feat');
    setTimeout(function () { b.classList.add('go'); }, 3200);
    setTimeout(function () { b.remove(); next(); }, 3700);
  }
  function announce(list) {
    list.forEach(function (n) {
      var V = S.VARIETIES[n.id];
      if (n.kind === 'born') say('born', 'A baby ' + V.name + '!', n.first ? 'The first ever born in your pond. Added to your koi book.' : 'Born in your pond.');
      else if (n.kind === 'grown') say('feat', V.name + ', fully grown', 'Grown to ' + Math.round(S.GROWN_K * 24) + ' cm. Marked in your koi book.');
      else if (n.kind === 'feat') {
        var f = S.FEATS.filter(function (x) { return x.id === n.id; })[0];
        if (f) say('feat', 'Achievement: ' + f.name, f.about);
      }
    });
    if (open === book) buildBook();
  }

  window.KoiMenu = {
    announce: announce, openBook: openBook, openSettings: openSettings,
    isOpen: function () { return !more.hidden || !!open || !restEl.hidden; }
  };
})();
