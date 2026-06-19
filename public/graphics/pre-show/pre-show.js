// Pre-show Countdown — pre-show.js
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _initialised  = false;
let _timerInterval = null;
let _tickerVisible = null;
let _gamesHash     = null;

function $(id) { return document.getElementById(id); }
function _eH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Countdown timer ───────────────────────────────────────────────────────────
function runTimer(timerEnd) {
  clearInterval(_timerInterval);
  var el = $('ps-timer');
  if (!el) return;
  if (!timerEnd) {
    el.textContent = '--:--';
    el.classList.remove('ps-timer-done');
    return;
  }
  if (timerEnd <= Date.now()) {
    el.textContent = '00:00';
    el.classList.add('ps-timer-done');
    return;
  }
  function tick() {
    var rem = Math.max(0, timerEnd - Date.now()) / 1000;
    var h = Math.floor(rem / 3600);
    var m = Math.floor((rem % 3600) / 60);
    var s = Math.floor(rem % 60);
    el.textContent = h > 0
      ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0')
      : String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    if (rem <= 0) {
      el.textContent = '00:00';
      el.classList.add('ps-timer-done');
      clearInterval(_timerInterval);
    }
  }
  tick();
  _timerInterval = setInterval(tick, 500);
}

// ── Sponsor logos ─────────────────────────────────────────────────────────────
function renderSponsors(logos) {
  var el = $('ps-sponsors');
  if (!el) return;
  if (!logos || !logos.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = logos.map(function(url) {
    if (!url) return '';
    return '<img class="ps-sponsor-logo" src="' + _eH(url) + '" alt="">';
  }).filter(Boolean).join('');
}

// ── Ticker label ──────────────────────────────────────────────────────────────
function renderTickerLabel(ticker) {
  TickerEngine.renderLabel(
    { wrap: 'ps-ticker-label', text: 'ps-ticker-label-text', img: 'ps-ticker-label-img' },
    ticker
  );
}

// ── Ticker scroll — identical logic to break screen ───────────────────────────
function renderTicker(ticker) {
  var wrap  = $('ps-ticker');
  var inner = $('ps-ticker-inner');
  if (!wrap || !inner) return;

  var items = (ticker && ticker.autoMode) ? (ticker.autoItems || []) : ((ticker && ticker.items) || []);
  var show  = !!(ticker && ticker.visible && items.length);

  renderTickerLabel(ticker);

  if (show !== _tickerVisible) {
    var isFirst = (_tickerVisible === null);
    _tickerVisible = show;
    var root = $('ps-root');

    if (show) {
      wrap.style.display = '';
      wrap.classList.remove('ticker-entering', 'ticker-leaving');
      void wrap.offsetWidth;
      wrap.classList.add('ticker-entering');
      // Drive the vertical border cover animation
      if (root) {
        root.classList.remove('ps-ticker-leaving');
        root.classList.add('ps-ticker-on', 'ps-ticker-entering');
        var _rootRef = root;
        setTimeout(function() { _rootRef.classList.remove('ps-ticker-entering'); }, 1500);
      }
    } else {
      wrap.classList.remove('ticker-entering', 'ticker-leaving');
      wrap.classList.add('ticker-leaving');
      // Drive the vertical border cover animation
      if (root && !isFirst) {
        root.classList.remove('ps-ticker-on', 'ps-ticker-entering');
        root.classList.add('ps-ticker-leaving');
        var _rootLeaveRef = root;
        setTimeout(function() {
          if (!_tickerVisible) { _rootLeaveRef.classList.remove('ps-ticker-leaving'); }
        }, 1500);
      }
      var hideRef = wrap;
      setTimeout(function() {
        if (!_tickerVisible) {
          hideRef.style.display = 'none';
          hideRef.classList.remove('ticker-leaving');
          inner.style.animation = 'none';
          inner.innerHTML = '';
          delete inner._tickerText;
        }
      }, 1500);
      return;
    }
  }

  if (!show) return;

  // ── Build content ─────────────────────────────────────────────────────────
  TickerEngine.renderScroll(inner, items, {
    winClass:       'ps-ticker-result-win',
    lossClass:      'ps-ticker-result-loss',
    scoreClass:     'ps-ticker-result-score',
    liveLabelClass: 'ps-ticker-live-label',
    liveDotClass:   'ps-ticker-live-dot',
    itemClass:      'ps-ticker-item',
    animName:       'ps-ticker-scroll'
  });
}

// ── Match cards ───────────────────────────────────────────────────────────────
function renderGames(games) {
  var container = $('ps-games');
  if (!container) return;
  var hash = JSON.stringify(games || []);
  if (hash === _gamesHash) return;
  _gamesHash = hash;
  if (!games || !games.length) { container.innerHTML = ''; return; }

  container.innerHTML = games.map(function(g) {
    var t1 = g.team1 || {}, t2 = g.team2 || {};
    // Pre-show is a countdown holding screen — no game is "live/current" yet, so
    // every match gets the same highlight treatment rather than singling one out.
    var cls = 'ps-card is-current';
    var t1LogoBg = t1.logo ? 'background-image:url(' + _eH(t1.logo) + ')' : '';
    var t2LogoBg = t2.logo ? 'background-image:url(' + _eH(t2.logo) + ')' : '';
    var t1Name   = _eH(t1.name || t1.tag || '?');
    var t2Name   = _eH(t2.name || t2.tag || '?');

    // Format/stage appear in footer (center layout) AND inline in vs column (side layout)
    var footerParts = [];
    if (g.format) footerParts.push('<span class="ps-card-format">' + _eH(g.format) + '</span>');
    if (g.stage)  footerParts.push('<span class="ps-card-stage">'  + _eH(g.stage)  + '</span>');
    var sideFormatHtml = (g.format || g.stage)
      ? '<span class="ps-card-format-side">' + _eH((g.format || '') + (g.format && g.stage ? ' · ' : '') + (g.stage || '')) + '</span>'
      : '';

    return '<div class="' + cls + '">' +
      '<div class="ps-card-inner">' +
        '<div class="ps-card-team">' +
          '<div class="ps-card-logo" style="' + t1LogoBg + '"></div>' +
          '<div class="ps-card-name">' + t1Name + '</div>' +
        '</div>' +
        '<div class="ps-card-vs">' +
          '<span class="ps-card-vs-text">VS</span>' +
          sideFormatHtml +
        '</div>' +
        '<div class="ps-card-team">' +
          '<div class="ps-card-logo" style="' + t2LogoBg + '"></div>' +
          '<div class="ps-card-name">' + t2Name + '</div>' +
        '</div>' +
      '</div>' +
      (footerParts.length ? '<div class="ps-card-footer">' + footerParts.join('') + '</div>' : '') +
    '</div>';
  }).join('');

  fitGameNames();
}

// Shrink team-name font to fit its box instead of truncating with an ellipsis.
// Broadcast fonts vary wildly in width, so a name that fits one font overflows
// another — fit per card and unify both names to the smaller size so each VS
// card stays balanced. Re-run on data change, font load, and resize.
function fitGameNames() {
  var cards = document.querySelectorAll('#ps-games .ps-card');
  for (var c = 0; c < cards.length; c++) {
    var names = cards[c].querySelectorAll('.ps-card-name');
    var minSize = Infinity;
    for (var i = 0; i < names.length; i++) {
      var el = names[i];
      el.style.fontSize = '';                                    // reset to CSS base
      var size = parseFloat(getComputedStyle(el).fontSize) || 24;
      var guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > 9 && guard++ < 80) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
      }
      if (size < minSize) minSize = size;
    }
    if (minSize !== Infinity) for (var j = 0; j < names.length; j++) names[j].style.fontSize = minSize + 'px';
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(state) {
  var ps       = state.preShow    || {};
  var settings = state.settings   || {};
  var tourn    = state.tournament  || {};
  var root     = $('ps-root');

  // Layout class
  if (root) {
    root.classList.toggle('layout-side', ps.layout === 'side');
  }

  // Logo scale CSS variable
  document.documentElement.style.setProperty('--ps-logo-scale', (ps.logoScale || 8) + 'vh');

  // Logo
  var logos   = (settings.logoSet && settings.logoSet.logos) || [];
  var logoUrl = ps.logoUrl || (logos.length ? logos[0].url : '');
  var logoEl  = $('ps-logo');
  if (logoEl) {
    if (!ps.hideLogo && logoUrl) { logoEl.src = logoUrl; logoEl.style.display = ''; }
    else                          { logoEl.style.display = 'none'; }
  }

  // Header text
  var nameEl = $('ps-tourn-name');
  if (nameEl) {
    if (ps.hideHeaderText) {
      nameEl.style.display = 'none';
    } else {
      nameEl.style.display = '';
      nameEl.textContent = ps.headerText || tourn.name || '';
    }
  }

  // Timer label
  var lblEl = $('ps-timer-label');
  if (lblEl) lblEl.textContent = ps.timerLabel || 'BROADCAST BEGINS IN';

  runTimer(ps.timerEnd || null);
  renderSponsors((state.match && state.match.sponsorLogos) || []);
  renderGames(state.todayGames || []);
  renderTicker(state.ticker || {});

  // renderGames re-fits names on a data change; also re-fit when the broadcast
  // font or layout changes (those don't rebuild the cards).
  var font = (getComputedStyle(document.documentElement).getPropertyValue('--gfx-font') || '').trim();
  var envKey = (ps.layout || '') + '|' + font;
  if (envKey !== _fitEnv) { _fitEnv = envKey; requestAnimationFrame(fitGameNames); }
}
var _fitEnv = '';
// Re-fit on web-font load (measurement before the font swaps is wrong) and resize.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { _fitEnv = ''; fitGameNames(); });
window.addEventListener('resize', function() { _fitEnv = ''; fitGameNames(); });

// ── Living backdrop — mirror the BG Output source's background ───────────────
// Pre-show is a full-screen holding graphic, so it carries its own animated
// backdrop on the dedicated #ps-bg layer, driven by the SAME settings as the
// BG Output source (state.bgOutput) — one place to control it. applyBackground
// key-caches internally (only restarts on real change) and its render loop
// auto-pauses when OBS isn't showing the source, so it costs nothing off-program.
function applyPreshowBg(state) {
  var root = document.getElementById('ps-root');
  if (!root) return;
  // Ensure the backdrop layer exists — a cached index.html may not have #ps-bg.
  var bgEl = document.getElementById('ps-bg');
  if (!bgEl) {
    bgEl = document.createElement('div');
    bgEl.id = 'ps-bg';
    root.insertBefore(bgEl, root.firstChild);
  }
  // Enforce positioning inline EVERY call, so the backdrop shows regardless of
  // whether index.html / pre-show.css are cached or stale (a pre-existing but
  // unpositioned #ps-bg would be a 0-height static block). Individual props are
  // used so we never wipe the background applyBackground sets on it.
  var bs = bgEl.style;
  bs.position = 'absolute'; bs.top = '0'; bs.left = '0'; bs.right = '0'; bs.bottom = '0';
  bs.zIndex = '0'; bs.overflow = 'hidden'; bs.pointerEvents = 'none';
  var bgo = state.bgOutput || {};
  GfxSettings.applyBackground(bgEl, { settings: {
    bgType:         bgo.bgType         || 'animation',
    bgAnimation:    bgo.bgAnimation    || 'particles',
    bgColor:        bgo.bgColor        || 'transparent',
    bgImage:        bgo.bgImage        || '',
    bgFogLayer:     bgo.bgFogLayer     || false,
    bgFogIntensity: bgo.bgFogIntensity != null ? bgo.bgFogIntensity : 50,
    bgRenderer:     bgo.bgRenderer     || 'gpu',
    bgFps:          bgo.bgFps          != null ? bgo.bgFps : 60,
    bgWaveMode:     bgo.bgWaveMode     || 'clean',
    animation:      bgo.animation      || { bgSpeed: 'medium' },
    palette:        bgo.palette        || [],
  } });
}

// ── Socket — graphic is always visible, no show/hide toggle ──────────────────
socket.on('state', function(state) {
  var root = $('ps-root');
  if (!root) return;

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'preShow');
  applyPreshowBg(state);

  if (!_initialised) {
    root.style.display = '';
    void root.offsetWidth;
    root.classList.add('visible');
    _initialised = true;
  }

  renderAll(state);
});
