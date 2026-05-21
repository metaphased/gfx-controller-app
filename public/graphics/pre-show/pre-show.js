// Pre-show Countdown — pre-show.js
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _initialised  = false;
let _timerInterval = null;
let _tickerVisible = null;

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
  var wrap    = $('ps-ticker-label');
  var textEl  = $('ps-ticker-label-text');
  var imgEl   = $('ps-ticker-label-img');
  if (!wrap) return;

  var mode = (ticker && ticker.labelMode) || 'text';
  if (mode === 'none') { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  if (mode === 'logo' && ticker.labelLogoUrl) {
    if (imgEl) { imgEl.src = ticker.labelLogoUrl; imgEl.style.display = ''; }
    if (textEl) textEl.style.display = 'none';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (textEl) { textEl.style.display = ''; textEl.textContent = (ticker && ticker.labelText) || 'NEWS'; }
  }
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
  var SEP = '   ·   '; // non-breaking spaces — immune to CSS whitespace trimming at span edges
  var setHtml = items.filter(function(i) { return i && (i.text || i.completed); }).map(function(i) {
    if (i.completed) {
      var w1 = i.winner === 'team1', w2 = i.winner === 'team2';
      return '<span class="' + (w1 ? 'ps-ticker-result-win' : 'ps-ticker-result-loss') + '">' + _eH(i.t1) + '</span>' +
             '<span class="ps-ticker-result-score">  ' + _eH(String(i.score1)) + '–' + _eH(String(i.score2)) + '  </span>' +
             '<span class="' + (w2 ? 'ps-ticker-result-win' : 'ps-ticker-result-loss') + '">' + _eH(i.t2) + '</span>';
    }
    if (i.live) {
      return '<span class="ps-ticker-live-label">LIVE</span><span class="ps-ticker-live-dot"></span>' + _eH(i.text);
    }
    return _eH(i.text);
  }).join(SEP) + SEP;

  if (inner._tickerText === setHtml) return;
  inner._tickerText = setHtml;

  inner.style.animation = 'none';
  inner.innerHTML = '';
  void inner.offsetWidth;

  // Probe rendered width of one copy
  var probe = document.createElement('span');
  probe.className = 'ps-ticker-item';
  probe.innerHTML = setHtml;
  inner.appendChild(probe);
  void inner.offsetWidth;
  var singleWidth = Math.max(1, probe.offsetWidth);
  inner.removeChild(probe);

  // Enough copies to always fill the visible track with no blank gap
  var trackWidth = (inner.parentElement ? inner.parentElement.offsetWidth : 0) || window.innerWidth;
  var perHalf    = Math.max(2, Math.ceil(trackWidth / singleWidth) + 1);

  for (var i = 0; i < perHalf * 2; i++) {
    var span = document.createElement('span');
    span.className = 'ps-ticker-item';
    span.innerHTML = setHtml;
    inner.appendChild(span);
  }
  void inner.offsetWidth;

  var duration = Math.max(8, (perHalf * singleWidth) / 90).toFixed(1);
  inner.style.animation = 'ps-ticker-scroll ' + duration + 's linear infinite';
}

// ── Match cards ───────────────────────────────────────────────────────────────
function renderGames(games) {
  var container = $('ps-games');
  if (!container) return;
  if (!games || !games.length) { container.innerHTML = ''; return; }

  container.innerHTML = games.map(function(g) {
    var t1 = g.team1 || {}, t2 = g.team2 || {};
    var cls = 'ps-card' + (g.isCurrent ? ' is-current' : '');
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
}

// ── Socket — graphic is always visible, no show/hide toggle ──────────────────
socket.on('state', function(state) {
  var root = $('ps-root');
  if (!root) return;

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(root, state);

  if (!_initialised) {
    root.style.display = '';
    void root.offsetWidth;
    root.classList.add('visible');
    _initialised = true;
  }

  renderAll(state);
});
