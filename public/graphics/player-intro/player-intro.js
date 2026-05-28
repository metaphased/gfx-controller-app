// Player Intro overlay — player-intro.js
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null;
var _exitTimer   = null;
var _enterTimer  = null;

var ROLES      = ['top', 'jungle', 'mid', 'bot', 'support'];
var ROLE_ICONS = {
  top:     '/graphics/draft/roles/top.png',
  jungle:  '/graphics/draft/roles/jungle.png',
  jg:      '/graphics/draft/roles/jungle.png',
  mid:     '/graphics/draft/roles/mid.png',
  bot:     '/graphics/draft/roles/bot.png',
  adc:     '/graphics/draft/roles/bot.png',
  support: '/graphics/draft/roles/support.png',
  sup:     '/graphics/draft/roles/support.png',
};

var CHAMP_KEY_FIXES = {
  "kai'sa":         'Kaisa',
  "cho'gath":       'Chogath',
  "kha'zix":        'Khazix',
  "kog'maw":        'KogMaw',
  "rek'sai":        'RekSai',
  "vel'koz":        'Velkoz',
  "bel'veth":       'Belveth',
  "k'sante":        'KSante',
  "wukong":         'MonkeyKing',
  "nunu & willump": 'Nunu',
  "renata glasc":   'Renata',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function setTxt(id, val) { var e = $(id); if (e) e.textContent = val; }
function setBg(id, url)  { var e = $(id); if (e) e.style.backgroundImage = url ? 'url(' + url + ')' : ''; }

// Scales styleTarget's font-size down (binary search) until el's content fits within el.
// Pass styleTarget separately when the text node and its measuring container differ (bar layout).
function fitText(el, maxPx, minPx, styleTarget) {
  if (!el) return;
  var target = styleTarget || el;
  target.style.fontSize = maxPx + 'px';
  if (el.scrollWidth <= el.offsetWidth) return;
  var lo = minPx, hi = maxPx;
  while (hi - lo > 1) {
    var mid = (lo + hi) >> 1;
    target.style.fontSize = mid + 'px';
    if (el.scrollWidth <= el.offsetWidth) lo = mid; else hi = mid;
  }
  target.style.fontSize = lo + 'px';
}

function normChampKey(name) {
  if (!name) return '';
  var fix = CHAMP_KEY_FIXES[name.toLowerCase()];
  return fix || name.replace(/['\s.&]/g, '');
}

function champSplashUrl(name) {
  var key = normChampKey(name);
  return key ? '/graphics/head2head/champions/' + key + '_0.jpg' : '';
}

var _preloadedSplashes = new Set();
function _preloadSplashes(players) {
  Object.values(players || {}).forEach(function(team) {
    (team || []).forEach(function(p) {
      var name = p && p.champPool && p.champPool[0] && p.champPool[0].name;
      if (!name) return;
      var url = champSplashUrl(name);
      if (!url || _preloadedSplashes.has(url)) return;
      _preloadedSplashes.add(url);
      var img = new Image(); img.src = url;
    });
  });
}

function normalizeRole(r) {
  r = (r || '').toLowerCase().trim();
  return r === 'adc' ? 'bot' : r;
}

function getPlayerByRole(players, roleKey) {
  return (players || []).find(function(p) { return normalizeRole(p.role) === roleKey; }) || {};
}

function rankText(rank) {
  if (!rank || !rank.tier) return '';
  var tier = rank.tier.charAt(0).toUpperCase() + rank.tier.slice(1).toLowerCase();
  if (tier === 'Challenger' || tier === 'Grandmaster' || tier === 'Master') {
    return tier + ' ' + (rank.lp || 0) + 'LP';
  }
  return tier + ' ' + (rank.division || '') + ' ' + (rank.lp || 0) + 'LP';
}

var RANK_ABBREVS = {
  challenger: 'CHAL', grandmaster: 'GM', master: 'MSTR',
  diamond: 'DIA', emerald: 'EMR', platinum: 'PLAT',
  gold: 'GOLD', silver: 'SIL', bronze: 'BRNZ', iron: 'IRON'
};
function rankTextShort(rank) {
  if (!rank || !rank.tier) return '';
  var t = rank.tier.toLowerCase();
  var abbr = RANK_ABBREVS[t] || rank.tier.slice(0, 4).toUpperCase();
  if (t === 'challenger' || t === 'grandmaster' || t === 'master') {
    return abbr + ' ' + (rank.lp || 0) + 'LP';
  }
  return abbr + ' ' + (rank.division || '') + ' ' + (rank.lp || 0) + 'LP';
}

function getCentreLogo(state) {
  var pi = state.playerIntro || {};
  // piLogoUrl: non-empty string = specific override; empty = auto (fall back to h2hLogoUrl)
  if (pi.piLogoUrl) return pi.piLogoUrl;
  var settings = state.settings || {};
  var lib = (settings.logoSet && settings.logoSet.logos) || [];
  var sel = settings.h2hLogoUrl !== undefined ? settings.h2hLogoUrl : '';
  return sel || (lib.length ? lib[0].url : '');
}

function setLogoOrVs(imgEl, vsEl, logoUrl) {
  if (!imgEl) return;
  if (logoUrl) {
    imgEl.src = logoUrl; imgEl.style.display = '';
    if (vsEl) vsEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    if (vsEl) vsEl.style.display = '';
  }
}

// Champion section: circular splash crop + name label
function champHtml(champName, wrapClass, iconClass, labelClass) {
  if (!champName) return '';
  var url = champSplashUrl(champName);
  var iconHtml = url
    ? '<span class="pi-champ-icon ' + iconClass + '" style="background-image:url(' + url + ')"></span>'
    : '';
  return (
    '<span class="' + wrapClass + '">' +
      iconHtml +
      '<span class="' + labelClass + '">' + champName + '</span>' +
    '</span>'
  );
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('pi-root');
  if (!root) return;
  if (_exitTimer)  { clearTimeout(_exitTimer);  _exitTimer  = null; }
  if (_enterTimer) { clearTimeout(_enterTimer); _enterTimer = null; }
  root.classList.remove('pi-exiting');
  root.style.display = '';
  void root.offsetWidth;
  root.classList.add('visible', 'pi-entering');
  _enterTimer = setTimeout(function() {
    root.classList.remove('pi-entering');
    _enterTimer = null;
  }, 1200);
  // Re-fit team names once Barlow Condensed is confirmed loaded.
  // Resolves as a microtask (font already cached) or when the font file arrives —
  // either way fires after the synchronous renderAll/fitText that follows this call.
  document.fonts.load('900 1em "Barlow Condensed"').then(refitNames);
}

function animateOut() {
  var root = $('pi-root');
  if (!root) return;
  if (_enterTimer) { clearTimeout(_enterTimer); root.classList.remove('pi-entering'); _enterTimer = null; }
  root.classList.remove('visible');
  root.classList.add('pi-exiting');
  _exitTimer = setTimeout(function() {
    root.classList.remove('pi-exiting');
    root.style.display = 'none';
    _exitTimer = null;
  }, 700);
}

// ── Layout: Nameplate Panel ───────────────────────────────────────────────────
function buildPanelRowHtml(player, roleKey, side, showRank, showChamps) {
  var handle    = player.handle || '';
  var icon      = ROLE_ICONS[roleKey] || '';
  var rank      = showRank   ? rankText(player.rank || null) : '';
  var champName = showChamps ? ((player.champPool && player.champPool[0] && player.champPool[0].name) || '') : '';

  var isRight = side === 'right';
  var rowCls  = 'pi-pnl-row' + (isRight ? ' pi-pnl-row-right' : '');

  var roleEl = '<span class="pi-pnl-role-icon" style="background-image:url(' + icon + ')"></span>';
  var textEl = (
    '<span class="pi-pnl-text">' +
      '<span class="pi-pnl-handle">' + handle + '</span>' +
      (rank      ? '<span class="pi-pnl-rank">'  + rank      + '</span>' : '') +
      (champName ? champHtml(champName, 'pi-pnl-champ', '', 'pi-pnl-champ-label') : '') +
    '</span>'
  );

  return '<div class="' + rowCls + '">' + roleEl + textEl + '</div>';
}

function renderPanel(state) {
  var match      = state.match || {};
  var pi         = state.playerIntro || {};
  var t1         = match.team1 || {};
  var t2         = match.team2 || {};
  var t1Players  = (state.players && state.players.team1) || [];
  var t2Players  = (state.players && state.players.team2) || [];
  var showRank   = !!pi.showRank;
  var showChamps = !!pi.showChamps;
  var showLogo   = pi.showLogo !== false;

  setBg('pi-panel-t1-logo', t1.logo);
  setBg('pi-panel-t2-logo', t2.logo);
  setTxt('pi-panel-t1-name', t1.name || t1.tag || '');
  setTxt('pi-panel-t2-name', t2.name || t2.tag || '');

  var maxPanelNamePx = Math.round(window.innerHeight * 0.042);
  fitText($('pi-panel-t1-name'), maxPanelNamePx, Math.round(maxPanelNamePx * 0.42));
  fitText($('pi-panel-t2-name'), maxPanelNamePx, Math.round(maxPanelNamePx * 0.42));

  var t1Hdr = $('pi-panel-t1-hdr'), t2Hdr = $('pi-panel-t2-hdr');
  if (t1Hdr) t1Hdr.style.setProperty('--team-color', t1.color || 'var(--gfx-blue)');
  if (t2Hdr) t2Hdr.style.setProperty('--team-color', t2.color || 'var(--gfx-red)');

  setLogoOrVs($('pi-panel-centre-img'), $('pi-panel-vs'), showLogo ? getCentreLogo(state) : '');

  function fillRows(elId, players, side) {
    var el = $(elId);
    if (!el) return;
    var key = ROLES.map(function(r) {
      var p = getPlayerByRole(players, r);
      return [p.handle||'', showRank, rankText(p.rank||null), showChamps,
        (p.champPool && p.champPool[0] && p.champPool[0].name) || ''].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = ROLES.map(function(r) {
        return buildPanelRowHtml(getPlayerByRole(players, r), r, side, showRank, showChamps);
      }).join('');
    }
  }

  fillRows('pi-panel-t1-rows', t1Players, 'left');
  fillRows('pi-panel-t2-rows', t2Players, 'right');
}

// ── Layout: Team Card Stack ───────────────────────────────────────────────────
function buildStackPlayerHtml(player, roleKey, showRank, showChamps) {
  var handle    = player.handle || '';
  var icon      = ROLE_ICONS[roleKey] || '';
  var rank      = showRank   ? rankText(player.rank || null) : '';
  var champName = showChamps ? ((player.champPool && player.champPool[0] && player.champPool[0].name) || '') : '';

  return (
    '<div class="pi-stk-player">' +
      '<span class="pi-stk-role" style="background-image:url(' + icon + ')"></span>' +
      '<span class="pi-stk-handle">' + handle + '</span>' +
      (rank      ? '<span class="pi-stk-rank">' + rank + '</span>' : '') +
      (champName ? champHtml(champName, 'pi-stk-champ', '', 'pi-stk-champ-label') : '') +
    '</div>'
  );
}

function renderStack(state) {
  var match      = state.match || {};
  var pi         = state.playerIntro || {};
  var t1         = match.team1 || {};
  var t2         = match.team2 || {};
  var t1Players  = (state.players && state.players.team1) || [];
  var t2Players  = (state.players && state.players.team2) || [];
  var showRank   = !!pi.showRank;
  var showChamps = !!pi.showChamps;
  var showLogo   = pi.showLogo !== false;

  var t1El = $('pi-stack-t1'), t2El = $('pi-stack-t2');
  if (t1El) t1El.style.setProperty('--team-color', t1.color || 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', t2.color || 'var(--gfx-red)');

  setBg('pi-stack-t1-logo', t1.logo);
  setBg('pi-stack-t2-logo', t2.logo);
  setTxt('pi-stack-t1-name', t1.name || t1.tag || '');
  setTxt('pi-stack-t2-name', t2.name || t2.tag || '');

  setLogoOrVs($('pi-stack-centre-img'), $('pi-stack-vs'), showLogo ? getCentreLogo(state) : '');

  function fillPlayers(elId, players) {
    var el = $(elId);
    if (!el) return;
    var key = ROLES.map(function(r) {
      var p = getPlayerByRole(players, r);
      return [p.handle||'', showRank, rankText(p.rank||null), showChamps,
        (p.champPool && p.champPool[0] && p.champPool[0].name) || ''].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = ROLES.map(function(r) {
        return buildStackPlayerHtml(getPlayerByRole(players, r), r, showRank, showChamps);
      }).join('');
    }
  }

  fillPlayers('pi-stack-t1-players', t1Players);
  fillPlayers('pi-stack-t2-players', t2Players);
}

// ── Layout: Nameplate Bar ─────────────────────────────────────────────────────
function buildBarPlayerHtml(player, roleKey, showRank, showChamps) {
  var handle    = player.handle || '';
  var icon      = ROLE_ICONS[roleKey] || '';
  var rank      = showRank   ? rankTextShort(player.rank || null) : '';
  var champName = showChamps ? ((player.champPool && player.champPool[0] && player.champPool[0].name) || '') : '';
  var champUrl  = champName  ? champSplashUrl(champName) : '';

  // .pi-bar-champ-cell is always present so the subgrid has a stable 3-column shape
  return (
    '<div class="pi-bar-player">' +
      '<span class="pi-bar-role" style="background-image:url(' + icon + ')"></span>' +
      '<span class="pi-bar-text">' +
        '<span class="pi-bar-handle">' + handle + '</span>' +
        (rank ? '<span class="pi-bar-rank">' + rank + '</span>' : '') +
      '</span>' +
      '<span class="pi-bar-champ-cell">' +
        (champUrl ? '<span class="pi-champ-icon" style="background-image:url(' + champUrl + ')"></span>' : '') +
      '</span>' +
    '</div>'
  );
}

function renderBar(state) {
  var match      = state.match || {};
  var pi         = state.playerIntro || {};
  var t1         = match.team1 || {};
  var t2         = match.team2 || {};
  var t1Players  = (state.players && state.players.team1) || [];
  var t2Players  = (state.players && state.players.team2) || [];
  var showRank   = !!pi.showRank;
  var showChamps = !!pi.showChamps;
  var showLogo   = pi.showLogo !== false;

  var bandEl = document.querySelector('.pi-bar-band');
  if (bandEl) {
    bandEl.classList.toggle('has-rank', showRank);
    bandEl.style.setProperty('--pi-bar-alpha', pi.barOpacity !== undefined ? pi.barOpacity : 0.93);
  }

  setBg('pi-bar-t1-logo', t1.logo);
  setBg('pi-bar-t2-logo', t2.logo);

  var t1El = $('pi-bar-t1'), t2El = $('pi-bar-t2');
  if (t1El) t1El.style.setProperty('--team-color', t1.color || 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', t2.color || 'var(--gfx-red)');

  // Team names in dead space flanking the centre
  var t1NameEl = $('pi-bar-t1-team-name');
  var t2NameEl = $('pi-bar-t2-team-name');
  if (t1NameEl) t1NameEl.innerHTML = '<span>' + (t1.name || t1.tag || '') + '</span>';
  if (t2NameEl) t2NameEl.innerHTML = '<span>' + (t2.name || t2.tag || '') + '</span>';

  var maxBarNamePx = Math.round(window.innerHeight * 0.05);
  var minBarNamePx = Math.round(maxBarNamePx * 0.42);
  if (t1NameEl) fitText(t1NameEl, maxBarNamePx, minBarNamePx, t1NameEl.querySelector('span'));
  if (t2NameEl) fitText(t2NameEl, maxBarNamePx, minBarNamePx, t2NameEl.querySelector('span'));

  setLogoOrVs($('pi-bar-centre-img'), $('pi-bar-vs'), showLogo ? getCentreLogo(state) : '');

  function fillPlayers(elId, players) {
    var el = $(elId);
    if (!el) return;
    var key = ROLES.map(function(r) {
      var p = getPlayerByRole(players, r);
      return [p.handle||'', showRank, rankText(p.rank||null), showChamps,
        (p.champPool && p.champPool[0] && p.champPool[0].name) || ''].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = ROLES.map(function(r) {
        return buildBarPlayerHtml(getPlayerByRole(players, r), r, showRank, showChamps);
      }).join('');
    }
  }

  fillPlayers('pi-bar-t1-players', t1Players);
  fillPlayers('pi-bar-t2-players', t2Players);
}

// ── Render dispatch ───────────────────────────────────────────────────────────
function renderAll(state) {
  var pi     = state.playerIntro || {};
  var layout = pi.layout || 'panel';
  var root   = $('pi-root');
  if (!root) return;

  if (root.dataset.layout !== layout) {
    root.dataset.layout = layout;
    root.classList.remove('layout-panel', 'layout-stack', 'layout-bar');
    root.classList.add('layout-' + layout);
  }

  if      (layout === 'stack') renderStack(state);
  else if (layout === 'bar')   renderBar(state);
  else                         renderPanel(state);
}

// ── Background override ───────────────────────────────────────────────────────
// Player Intro can override the global bg independently (useful as an overlay).
function getEffectiveBgState(state) {
  var pi    = state.playerIntro || {};
  var piBg  = pi.piBg || 'transparent';
  if (piBg === 'global') return state;
  var overrideSettings = Object.assign({}, state.settings || {});
  if (piBg === 'dark') {
    overrideSettings.bgType  = 'color';
    overrideSettings.bgColor = '#07101a';
  } else {
    overrideSettings.bgType  = 'transparent';
    overrideSettings.bgColor = '';
  }
  return Object.assign({}, state, { settings: overrideSettings });
}

// Re-measures team name sizes after fonts have loaded — fixes first-show inaccuracy
// where fitText runs against the fallback font before Barlow Condensed downloads.
function refitNames() {
  var root = $('pi-root');
  if (!root || root.style.display === 'none') return;
  var layout = root.dataset.layout || 'panel';
  if (layout === 'panel') {
    var maxPx = Math.round(window.innerHeight * 0.042);
    fitText($('pi-panel-t1-name'), maxPx, Math.round(maxPx * 0.42));
    fitText($('pi-panel-t2-name'), maxPx, Math.round(maxPx * 0.42));
  } else if (layout === 'bar') {
    var maxBarPx = Math.round(window.innerHeight * 0.05);
    var minBarPx = Math.round(maxBarPx * 0.42);
    var t1El = $('pi-bar-t1-team-name'), t2El = $('pi-bar-t2-team-name');
    if (t1El) fitText(t1El, maxBarPx, minBarPx, t1El.querySelector('span'));
    if (t2El) fitText(t2El, maxBarPx, minBarPx, t2El.querySelector('span'));
  }
}

// ── Socket ────────────────────────────────────────────────────────────────────
var ALL_ANIMS = ['anim-rise', 'anim-stagger', 'anim-fade', 'anim-split', 'anim-slide'];

socket.on('state', function(state) {
  var root    = $('pi-root');
  var pi      = state.playerIntro || {};
  var visible = !!pi.visible;
  _preloadSplashes(state.players);

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(root, getEffectiveBgState(state));

  if (root) {
    var layout = pi.layout || 'panel';
    var defaultAnim = layout === 'stack' ? 'split' : layout === 'bar' ? 'slide' : 'rise';
    var anim = pi.animVariant || defaultAnim;
    var animClass = 'anim-' + anim;
    if (!root.classList.contains(animClass)) {
      ALL_ANIMS.forEach(function(c) { root.classList.remove(c); });
      root.classList.add(animClass);
    }
  }

  if (visible !== _lastVisible) {
    if (visible)                    animateIn();
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
  }

  if (!visible) return;
  renderAll(state);
});
