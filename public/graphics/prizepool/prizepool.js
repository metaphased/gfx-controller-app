// Prizepool Overlay
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _visible      = false;
var _outTimer     = null;
var _inTimer      = null;
var _prizepoolHash = '';

function $(id) { return document.getElementById(id); }
function _eH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Render ────────────────────────────────────────────────────────────────────
function renderPrizepool(state) {
  var pp   = state.prizepool  || {};
  var t    = state.tournament || {};
  var root = $('pp-root');
  if (!root) return;

  // Logo
  var logoImg   = $('pp-logo');
  var logoUrl   = t.logo || (state.match && state.match.tournamentLogo) || '';
  var logoShown = !!(pp.showLogo && logoUrl);
  if (logoImg) {
    if (logoShown) { logoImg.src = logoUrl; logoImg.style.display = ''; }
    else           { logoImg.style.display = 'none'; }
  }
  root.style.setProperty('--pp-logo-h', (pp.logoScale != null ? pp.logoScale : 7) + 'vh');
  root.classList.toggle('logo-center', pp.logoPosition === 'center');
  root.classList.toggle('has-logo', logoShown);

  var entries = pp.entries || [];

  // Clear unused divs
  var hlEl = $('pp-highlight'); if (hlEl) hlEl.innerHTML = '';

  var placements = entries.filter(function(e) { return e.type === 'placement'; });
  var bonuses    = entries.filter(function(e) { return e.type === 'bonus'; });

  // ── Placement list ─────────────────────────────────────────────────────────
  var plEl = $('pp-placements');
  if (plEl) {
    if (!placements.length) {
      plEl.innerHTML = '';
    } else {
      // Medal tier is keyed on placement ORDER (1st/2nd/3rd row) so it's robust
      // against range labels like "3RD-4TH": top three get a numbered gold/silver/
      // bronze coin, everything below gets a subtle accent pip.
      var rows = placements.map(function(e, i) {
        var tier  = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        var coin  = tier
          ? '<span class="pp-pl-medal pp-medal-' + tier + '">' + (i + 1) + '</span>'
          : '<span class="pp-pl-pip"></span>';
        var medal = '<span class="pp-pl-medal-slot">' + coin + '</span>';
        var left  = '<span class="pp-pl-left">' + medal +
                    '<span class="pp-pl-label">' + _eH(e.label) + '</span></span>';
        var rowCls = 'pp-placement-row' + (tier ? ' medal-' + tier : '') + (e.highlight ? ' pp-pl-highlight' : '');
        var imgHtml = '';
        if (e.highlight && e.prizeImage) {
          var imgScale = e.imageScale != null ? e.imageScale : 10;
          imgHtml = '<img class="pp-pl-hl-img" style="height:' + imgScale + 'vh" src="' + _eH(e.prizeImage) + '" alt="">';
        }
        return (
          '<div class="' + rowCls + '">' +
            left +
            imgHtml +
            '<span class="pp-pl-value">' + _eH(e.value) + '</span>' +
          '</div>'
        );
      }).join('');
      plEl.innerHTML = '<div class="pp-placements-wrap">' +
        '<div class="pp-pl-header"><span class="pp-pl-htitle">Prize Pool</span></div>' +
        rows + '</div>';
    }
  }

  // ── Bonus cards (row below placements, same width, centred) ───────────────
  var boEl = $('pp-bonuses');
  if (boEl) {
    if (!bonuses.length) {
      boEl.innerHTML = '';
    } else {
      var cards = bonuses.map(function(e) {
        var imgHtml = '';
        if (e.prizeImage) {
          var imgScale = e.imageScale != null ? e.imageScale : (e.imageSize === 'large' ? 26 : 15);
          imgHtml = '<div class="pp-bonus-img-wrap" style="height:' + imgScale + 'vh">' +
            '<img class="pp-bonus-img" src="' + _eH(e.prizeImage) + '" alt="">' +
            '</div>';
        }
        var footerHtml = '';
        if (e.sponsorLogo || e.sponsorName) {
          footerHtml = '<div class="pp-bonus-footer">' +
            (e.sponsorName ? '<span class="pp-bonus-sponsor-name">' + _eH(e.sponsorName) + '</span>' : '') +
            (e.sponsorLogo ? '<img class="pp-bonus-sponsor-logo" src="' + _eH(e.sponsorLogo) + '" alt="' + _eH(e.sponsorName||'') + '">' : '') +
            '</div>';
        }
        return (
          '<div class="pp-bonus-card">' +
            imgHtml +
            '<div class="pp-bonus-body">' +
              '<div class="pp-bonus-label">' + _eH(e.label) + '</div>' +
              (e.value ? '<div class="pp-bonus-value">' + _eH(e.value) + '</div>' : '') +
            '</div>' +
            footerHtml +
          '</div>'
        );
      }).join('');
      boEl.innerHTML = '<div class="pp-bonuses-row">' + cards + '</div>';
    }
  }
}

// ── Animation ─────────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('pp-root');
  if (!root) return;
  if (_outTimer) { clearTimeout(_outTimer); root.classList.remove('pp-exiting'); _outTimer = null; }

  root.style.display = '';
  void root.offsetWidth;

  var animEls = Array.from(root.querySelectorAll('.pp-highlight-card, .pp-placements-wrap, .pp-bonus-card'));
  animEls.forEach(function(el, i) { el.style.animationDelay = (0.1 + i * 0.08) + 's'; });

  root.classList.add('pp-entering');
  if (_inTimer) clearTimeout(_inTimer);
  _inTimer = setTimeout(function() {
    root.classList.remove('pp-entering');
    animEls.forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }, (0.1 + animEls.length * 0.08 + 0.5) * 1000);
}

function animateOut() {
  var root = $('pp-root');
  if (!root) return;
  if (_inTimer) {
    clearTimeout(_inTimer);
    root.classList.remove('pp-entering');
    root.querySelectorAll('.pp-highlight-card, .pp-placements-wrap, .pp-bonus-card').forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }
  root.classList.add('pp-exiting');
  if (_outTimer) clearTimeout(_outTimer);
  _outTimer = setTimeout(function() {
    root.classList.remove('pp-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, 500);
}

// ── Data fingerprint ──────────────────────────────────────────────────────────
function prizepoolHash(state) {
  var pp = state.prizepool  || {};
  var t  = state.tournament || {};
  return JSON.stringify({
    entries:  pp.entries,
    showLogo: pp.showLogo,
    scale:    pp.logoScale,
    pos:      pp.logoPosition,
    logo:     t.logo || (state.match && state.match.tournamentLogo) || ''
  });
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('connect', function() { _visible = false; });

socket.on('state', function(state) {
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'prizepool');
  GfxSettings.clearBackground(document.body);

  var pp      = state.prizepool || {};
  var visible = !!pp.visible;
  var hash    = prizepoolHash(state);

  if (visible && !_visible) {
    _visible = true;
    _prizepoolHash = hash;
    renderPrizepool(state);
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  } else if (hash !== _prizepoolHash) {
    _prizepoolHash = hash;
    renderPrizepool(state);
  }
});
