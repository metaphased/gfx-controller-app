// Player Intro overlay — player-intro.js
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null;
var _exitTimer   = null;
var _enterTimer  = null;

var ROLES       = ['top', 'jungle', 'mid', 'bot', 'support'];
var ROLE_LABELS = ['Top', 'Jg', 'Mid', 'ADC', 'Sup'];
var ROLE_ICONS  = {
  top:     '/graphics/draft/roles/top.png',
  jungle:  '/graphics/draft/roles/jungle.png',
  mid:     '/graphics/draft/roles/mid.png',
  bot:     '/graphics/draft/roles/bot.png',
  support: '/graphics/draft/roles/support.png',
};

// DDragon key overrides for champions whose key doesn't match the raw display name
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

function normChampSplash(name) {
  if (!name) return '';
  var fix = CHAMP_KEY_FIXES[name.toLowerCase()];
  if (fix) return fix;
  return name.replace(/['\s.&]/g, '');
}

function champSplashUrl(name) {
  var key = normChampSplash(name);
  return key ? '/graphics/head2head/champions/' + key + '_0.jpg' : '';
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

function getCentreLogo(state) {
  var settings = state.settings || {};
  var lib = (settings.logoSet && settings.logoSet.logos) || [];
  var sel = settings.h2hLogoUrl !== undefined ? settings.h2hLogoUrl : '';
  return sel || (lib.length ? lib[0].url : '');
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
  }, 1400);
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

// ── Layout B row builder ──────────────────────────────────────────────────────
function buildRowHtmlB(i, t1Players, t2Players, showRank) {
  var roleKey  = ROLES[i];
  var iconUrl  = ROLE_ICONS[roleKey];

  var t1p = getPlayerByRole(t1Players, roleKey);
  var t2p = getPlayerByRole(t2Players, roleKey);

  var t1Champ = (t1p.champPool && t1p.champPool[0] && t1p.champPool[0].name) || '';
  var t2Champ = (t2p.champPool && t2p.champPool[0] && t2p.champPool[0].name) || '';
  var t1Splash = champSplashUrl(t1Champ);
  var t2Splash = champSplashUrl(t2Champ);

  var t1RankStr = showRank ? rankText(t1p.rank || null) : '';
  var t2RankStr = showRank ? rankText(t2p.rank || null) : '';

  var s1 = t1Splash ? ' style="background-image:url(' + t1Splash + ')"' : '';
  var s2 = t2Splash ? ' style="background-image:url(' + t2Splash + ')"' : '';

  return (
    '<div class="pi-card pi-card-left"' + s1 + '>' +
      '<div class="pi-player-info">' +
        '<div class="pi-handle">' + (t1p.handle || '') + '</div>' +
        (t1RankStr ? '<div class="pi-rank">' + t1RankStr + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="pi-row-centre">' +
      '<div class="pi-role-icon" style="background-image:url(' + iconUrl + ')"></div>' +
      '<div class="pi-role-label">' + ROLE_LABELS[i] + '</div>' +
    '</div>' +
    '<div class="pi-card pi-card-right"' + s2 + '>' +
      '<div class="pi-player-info">' +
        '<div class="pi-handle">' + (t2p.handle || '') + '</div>' +
        (t2RankStr ? '<div class="pi-rank">' + t2RankStr + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}

// ── Layout B render ───────────────────────────────────────────────────────────
function renderLayoutB(state) {
  var match    = state.match    || {};
  var pi       = state.playerIntro || {};
  var t1       = match.team1   || {};
  var t2       = match.team2   || {};
  var t1Players = (state.players && state.players.team1) || [];
  var t2Players = (state.players && state.players.team2) || [];
  var showRank = !!pi.showRank;
  var showLogo = pi.showLogo !== false;

  // Team headers
  setBg('pi-t1-logo', t1.logo);
  setBg('pi-t2-logo', t2.logo);
  setTxt('pi-t1-name', t1.name || t1.tag || '');
  setTxt('pi-t2-name', t2.name || t2.tag || '');

  // Team accent border colours
  var t1El = $('pi-header-left');
  var t2El = $('pi-header-right');
  if (t1El) t1El.style.setProperty('--team-color', t1.color || 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', t2.color || 'var(--gfx-red)');

  // Centre logo
  var logoUrl = showLogo ? getCentreLogo(state) : '';
  var cLogoEl = $('pi-centre-logo');
  if (cLogoEl) {
    if (logoUrl) { cLogoEl.src = logoUrl; cLogoEl.style.display = ''; }
    else           cLogoEl.style.display = 'none';
  }

  // Player rows
  var rowsEl = $('pi-rows-b');
  if (!rowsEl) return;

  if (rowsEl.children.length !== 5) {
    rowsEl.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var row = document.createElement('div');
      row.className = 'pi-row';
      row.dataset.roleIdx = i;
      rowsEl.appendChild(row);
    }
  }

  Array.from(rowsEl.children).forEach(function(row, i) {
    var t1p = getPlayerByRole(t1Players, ROLES[i]);
    var t2p = getPlayerByRole(t2Players, ROLES[i]);
    var t1Champ = (t1p.champPool && t1p.champPool[0] && t1p.champPool[0].name) || '';
    var t2Champ = (t2p.champPool && t2p.champPool[0] && t2p.champPool[0].name) || '';
    var key = [
      t1Champ, t2Champ, t1p.handle || '', t2p.handle || '',
      showRank, rankText(t1p.rank || null), rankText(t2p.rank || null),
    ].join('|');
    if (row.dataset.rowKey !== key) {
      row.dataset.rowKey = key;
      row.innerHTML = buildRowHtmlB(i, t1Players, t2Players, showRank);
    }
  });
}

// ── Layout C card builder ─────────────────────────────────────────────────────
function buildCardHtmlC(player, roleKey, showRank) {
  var handle = player.handle || '';
  var champ  = (player.champPool && player.champPool[0] && player.champPool[0].name) || '';
  var splash = champSplashUrl(champ);
  var icon   = ROLE_ICONS[roleKey] || '';
  var rank   = showRank ? rankText(player.rank || null) : '';

  return (
    '<div class="pi-card-c"' + (splash ? ' style="background-image:url(' + splash + ')"' : '') + '>' +
      '<div class="pi-card-c-info">' +
        '<div class="pi-card-c-role" style="background-image:url(' + icon + ')"></div>' +
        '<div class="pi-card-c-handle">' + handle + '</div>' +
        (rank ? '<div class="pi-card-c-rank">' + rank + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}

// ── Layout C render ───────────────────────────────────────────────────────────
function renderLayoutC(state) {
  var match    = state.match    || {};
  var pi       = state.playerIntro || {};
  var t1       = match.team1   || {};
  var t2       = match.team2   || {};
  var t1Players = (state.players && state.players.team1) || [];
  var t2Players = (state.players && state.players.team2) || [];
  var showRank = !!pi.showRank;
  var showLogo = pi.showLogo !== false;

  // Team headers
  setBg('pi-c-t1-logo', t1.logo);
  setBg('pi-c-t2-logo', t2.logo);
  setTxt('pi-c-t1-name', t1.name || t1.tag || '');
  setTxt('pi-c-t2-name', t2.name || t2.tag || '');

  // Team accent border colours (set inline so each can vary)
  var t1HdrEl = $('pi-c-header-t1');
  var t2HdrEl = $('pi-c-header-t2');
  if (t1HdrEl) t1HdrEl.style.borderBottomColor = t1.color || '';
  if (t2HdrEl) t2HdrEl.style.borderTopColor    = t2.color || '';

  // Centre divider logo / VS
  var logoUrl = showLogo ? getCentreLogo(state) : '';
  var cLogoEl = $('pi-c-centre-logo');
  var vsEl    = $('pi-c-vs');
  if (cLogoEl) {
    if (logoUrl) { cLogoEl.src = logoUrl; cLogoEl.style.display = ''; if (vsEl) vsEl.style.display = 'none'; }
    else         { cLogoEl.style.display = 'none'; if (vsEl) vsEl.style.display = ''; }
  }

  // T1 cards
  var t1CardsEl = $('pi-c-t1-cards');
  if (t1CardsEl) {
    var t1Key = ROLES.map(function(r) {
      var p = getPlayerByRole(t1Players, r);
      return [(p.champPool && p.champPool[0] && p.champPool[0].name) || '', p.handle || '', showRank, rankText(p.rank || null)].join(':');
    }).join('|');
    if (t1CardsEl.dataset.key !== t1Key) {
      t1CardsEl.dataset.key = t1Key;
      t1CardsEl.innerHTML = ROLES.map(function(r) {
        return buildCardHtmlC(getPlayerByRole(t1Players, r), r, showRank);
      }).join('');
    }
  }

  // T2 cards
  var t2CardsEl = $('pi-c-t2-cards');
  if (t2CardsEl) {
    var t2Key = ROLES.map(function(r) {
      var p = getPlayerByRole(t2Players, r);
      return [(p.champPool && p.champPool[0] && p.champPool[0].name) || '', p.handle || '', showRank, rankText(p.rank || null)].join(':');
    }).join('|');
    if (t2CardsEl.dataset.key !== t2Key) {
      t2CardsEl.dataset.key = t2Key;
      t2CardsEl.innerHTML = ROLES.map(function(r) {
        return buildCardHtmlC(getPlayerByRole(t2Players, r), r, showRank);
      }).join('');
    }
  }
}

// ── Main render dispatch ──────────────────────────────────────────────────────
function renderAll(state) {
  var pi     = state.playerIntro || {};
  var layout = pi.layout || 'B';
  var root   = $('pi-root');
  if (!root) return;

  // Switch layout class when it changes
  if (root.dataset.layout !== layout) {
    root.dataset.layout = layout;
    root.classList.remove('layout-B', 'layout-C');
    root.classList.add('layout-' + layout);
  }

  if (layout === 'C') renderLayoutC(state);
  else                renderLayoutB(state);
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('state', function(state) {
  var root    = $('pi-root');
  var pi      = state.playerIntro || {};
  var visible = !!pi.visible;

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(root, state);

  // Apply animation variant class before animateIn so keyframes fire correctly
  if (root) {
    var anim = pi.animVariant || 'slide';
    if (!root.classList.contains('anim-' + anim)) {
      root.classList.remove('anim-slide', 'anim-stagger', 'anim-cinematic', 'anim-fan', 'anim-rise', 'anim-reveal');
      root.classList.add('anim-' + anim);
    }
  }

  if (visible !== _lastVisible) {
    if (visible)                  animateIn();
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
  }

  if (!visible) return;
  renderAll(state);
});
