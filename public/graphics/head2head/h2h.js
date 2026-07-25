// Head to Head overlay — h2h.js
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _lastVisible = null;
var _exitTimer   = null;
var _enterTimer  = null;
var _preloadedSplashes = new Set();

function _preloadSplash(champName) {
  if (!champName) return;
  var url = '/graphics/head2head/champions/' + champName + '_0.jpg';
  if (_preloadedSplashes.has(url)) return;
  _preloadedSplashes.add(url);
  var img = new Image(); img.src = url;
}

function _preloadPickSplashes(picks) {
  (picks || []).forEach(function(url) {
    var name = champNameFromUrl(url);
    if (name) _preloadSplash(name);
  });
}

// Role order matches state.draft.team1RolePicks / team2RolePicks indices
// (DRAFT_ROLES in control.js = ['Top','Jungle','Mid','Bot','Support'])
const ROLES        = ['top', 'jungle', 'mid', 'bot', 'support'];
const ROLE_LABELS  = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
const ROLE_ICONS   = {
  top:     '/graphics/draft/roles/top.png',
  jungle:  '/graphics/draft/roles/jungle.png',
  jg:      '/graphics/draft/roles/jungle.png',
  mid:     '/graphics/draft/roles/mid.png',
  bot:     '/graphics/draft/roles/bot.png',
  adc:     '/graphics/draft/roles/bot.png',
  support: '/graphics/draft/roles/support.png',
  sup:     '/graphics/draft/roles/support.png',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function setBg(id, url) { const el = $(id); if (el) el.style.backgroundImage = url ? 'url(' + url + ')' : ''; }

// Strip path + extension + Riot-style trailing _N suffix → champion name
// e.g. '/champions/Ahri.png' → 'Ahri',  '/path/Yasuo_0.jpg' → 'Yasuo'
function champNameFromUrl(url) {
  if (!url) return '';
  return url.split('/').pop().replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
}

// Normalise role strings from Teams DB ('adc', 'ADC', 'Bot', 'bot' → 'bot')
function normalizeRole(r) {
  r = (r || '').toLowerCase().trim();
  return r === 'adc' ? 'bot' : r;
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('h2h-root');
  if (!root) return;
  if (_exitTimer)  { clearTimeout(_exitTimer);  _exitTimer  = null; }
  if (_enterTimer) { clearTimeout(_enterTimer); _enterTimer = null; }
  root.classList.remove('h2h-exiting');
  root.style.display = '';
  void root.offsetWidth;
  root.classList.add('visible', 'h2h-entering');
  _enterTimer = setTimeout(function() {
    root.classList.remove('h2h-entering');
    _enterTimer = null;
  }, 1400);
}
function animateOut() {
  var root = $('h2h-root');
  if (!root) return;
  if (_enterTimer) { clearTimeout(_enterTimer); root.classList.remove('h2h-entering'); _enterTimer = null; }
  root.classList.remove('visible');
  root.classList.add('h2h-exiting');
  _exitTimer = setTimeout(function() {
    root.classList.remove('h2h-exiting');
    root.style.display = 'none';
    _exitTimer = null;
  }, 700);
}

// ── Row builder ───────────────────────────────────────────────────────────────
function buildRowHTML(i, t1Picks, t2Picks, t1Players, t2Players) {
  var roleKey   = ROLES[i];
  var roleLabel = ROLE_LABELS[i];
  var iconUrl   = ROLE_ICONS[roleKey];

  var t1ChampUrl  = t1Picks[i] || '';
  var t2ChampUrl  = t2Picks[i] || '';
  var t1ChampName = champNameFromUrl(t1ChampUrl);
  var t2ChampName = champNameFromUrl(t2ChampUrl);

  // Construct path to the larger splash art (champname_0.jpg)
  var t1Splash = t1ChampName ? '/graphics/head2head/champions/' + t1ChampName + '_0.jpg' : '';
  var t2Splash = t2ChampName ? '/graphics/head2head/champions/' + t2ChampName + '_0.jpg' : '';

  // Match player to role — players use 'top'/'jungle'/'mid'/'bot'/'adc'/'support'
  var t1Player = t1Players.find(function(p) { return normalizeRole(p.role) === roleKey; }) || {};
  var t2Player = t2Players.find(function(p) { return normalizeRole(p.role) === roleKey; }) || {};

  var splashStyle1 = t1Splash ? 'background-image:url(' + t1Splash + ')' : '';
  var splashStyle2 = t2Splash ? 'background-image:url(' + t2Splash + ')' : '';

  return (
    '<div class="h2h-card h2h-card-left" style="' + splashStyle1 + '">' +
      '<div class="h2h-player-info">' +
        '<div class="h2h-champ-name">' + esc(t1ChampName) + '</div>' +
        '<div class="h2h-player-handle">' + esc(t1Player.handle || '') + '</div>' +
        '<div class="h2h-stats-strip" id="h2h-stats-t1-' + i + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="h2h-centre">' +
      '<div class="h2h-role-icon" style="background-image:url(' + iconUrl + ')"></div>' +
      '<div class="h2h-role-label">' + roleLabel + '</div>' +
    '</div>' +
    '<div class="h2h-card h2h-card-right" style="' + splashStyle2 + '">' +
      '<div class="h2h-player-info">' +
        '<div class="h2h-champ-name">' + esc(t2ChampName) + '</div>' +
        '<div class="h2h-player-handle">' + esc(t2Player.handle || '') + '</div>' +
        '<div class="h2h-stats-strip" id="h2h-stats-t2-' + i + '"></div>' +
      '</div>' +
    '</div>'
  );
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(state) {
  var h2h      = state.headToHead || {};
  var draft    = state.draft      || {};
  var match    = state.match      || {};
  var settings = state.settings   || {};
  var t1      = match.team1      || {};
  var t2      = match.team2      || {};
  // Players live at state.players (top-level) — state.match does not include them
  var t1Players = (state.players && state.players.team1) || [];
  var t2Players = (state.players && state.players.team2) || [];
  var t1Picks   = draft.team1RolePicks || [];
  var t2Picks   = draft.team2RolePicks || [];

  // ── Team headers ─────────────────────────────────────────────────────────
  setBg('h2h-t1-logo', t1.logo);
  setBg('h2h-t2-logo', t2.logo);
  var t1NameEl = $('h2h-t1-name');
  var t2NameEl = $('h2h-t2-name');
  if (t1NameEl) t1NameEl.textContent = t1.name || t1.tag || '';
  if (t2NameEl) t2NameEl.textContent = t2.name || t2.tag || '';

  // ── Centre logo — uniform chain: h2h pick → event logo → none ─────────────
  var centreLogo   = GfxSettings.logoUrl(state, settings.h2hLogoUrl);
  var centreLogoEl = $('h2h-centre-logo');
  if (centreLogoEl) {
    if (centreLogo) { centreLogoEl.src = centreLogo; centreLogoEl.style.display = ''; }
    else              { centreLogoEl.style.display = 'none'; }
  }

  // ── Build rows (once) or update when data changes ─────────────────────────
  var rowsEl = $('h2h-rows');
  if (!rowsEl) return;

  if (rowsEl.children.length !== 5) {
    rowsEl.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var row = document.createElement('div');
      row.className = 'h2h-row';
      row.dataset.roleIdx = i;
      rowsEl.appendChild(row);
    }
  }

  // Key each row on its data so we only rebuild innerHTML when picks/players change
  Array.from(rowsEl.children).forEach(function(row, i) {
    var t1Url = t1Picks[i] || '';
    var t2Url = t2Picks[i] || '';
    var t1P   = t1Players.find(function(p) { return normalizeRole(p.role) === ROLES[i]; }) || {};
    var t2P   = t2Players.find(function(p) { return normalizeRole(p.role) === ROLES[i]; }) || {};
    var key = t1Url + '|' + t2Url + '|' + (t1P.handle || '') + '|' + (t2P.handle || '');

    if (row.dataset.rowKey !== key) {
      row.dataset.rowKey = key;
      row.innerHTML = buildRowHTML(i, t1Picks, t2Picks, t1Players, t2Players);
    }
  });

  // ── Apply mode + active row ───────────────────────────────────────────────
  var root = $('h2h-root');
  if (!root) return;

  var mode      = h2h.mode || 'spotlight';
  var spotlight = (h2h.spotlightRole !== undefined && h2h.spotlightRole !== null)
                  ? h2h.spotlightRole : 0;

  // Only touch the mode class when mode actually changes — removing and re-adding
  // the same class every render creates an intermediate height state that Chrome
  // uses as the transition start point, making the animation look invisible.
  if (!root.classList.contains('mode-' + mode)) {
    root.classList.remove('mode-spotlight', 'mode-lineup');
    root.classList.add('mode-' + mode);
  }

  Array.from(rowsEl.children).forEach(function(row, i) {
    row.classList.toggle('active', mode === 'spotlight' && i === spotlight);
  });

  // ── Champion stats strips ─────────────────────────────────────────────────
  var champCfg = settings.h2hChampStats || {};
  if (champCfg.enabled) {
    var slotMap = [
      { prefix: 't1', players: t1Players },
      { prefix: 't2', players: t2Players },
    ];
    slotMap.forEach(function(s) {
      var picks = s.prefix === 't1' ? t1Picks : t2Picks;
      for (var i = 0; i < 5; i++) {
        var el = $(('h2h-stats-' + s.prefix + '-' + i));
        if (!el) continue;
        var player = s.players.find(function(p) { return normalizeRole(p.role) === ROLES[i]; }) || {};
        var stats  = player.draftChampStats || null;
        var tokens = champCfg[ROLE_LABELS[i]] || [];
        var champName = champNameFromUrl(picks[i] || '');
        var key = JSON.stringify([champName, stats, tokens]);
        if (el.dataset.statsKey === key) continue;
        el.dataset.statsKey = key;
        el.innerHTML = buildStatsStripHtml(stats, tokens, champName);
      }
    });
  } else {
    // Clear strips when disabled
    for (var si = 0; si < 5; si++) {
      var e1 = $('h2h-stats-t1-' + si), e2 = $('h2h-stats-t2-' + si);
      if (e1 && e1.innerHTML !== '') e1.innerHTML = '';
      if (e2 && e2.innerHTML !== '') e2.innerHTML = '';
    }
  }
}

function buildStatsStripHtml(stats, tokens, champName) {
  var champ = esc((stats && stats.champ) || champName || 'this champion');
  if (!stats) return '<span class="h2h-stat-no-data">No Solo Queue data on ' + champ + ' this season</span>';
  if (!tokens || !tokens.length) return '';

  function pill(label, value) {
    return '<div class="h2h-stat-pill"><span class="h2h-stat-pill-label">' + label + '</span><span class="h2h-stat-pill-value">' + value + '</span></div>';
  }

  return tokens.map(function(tok) {
    switch (tok) {
      case 'winRate': return pill('Win Rate',                 stats.winRate + '%');
      case 'games':   return pill('As ' + champ + ' this season', stats.games + ' Games');
      case 'kda':     return pill('Average K/D/A',           stats.kda.k + '/' + stats.kda.d + '/' + stats.kda.a);
      case 'cs':      return pill('Average CS',              stats.cs);
      case 'kp':      return pill('Kill Participation',      stats.kp + '%');
      case 'damage':  return pill('Avg Damage',              Math.round(stats.damage / 1000) + 'k');
      case 'vision':  return pill('Avg Vision',              stats.vision);
      default:        return '';
    }
  }).join('');
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('state', function(state) {
  var root    = $('h2h-root');
  var h2h     = state.headToHead || {};
  var visible = !!h2h.visible;
  var draft   = state.draft || {};
  _preloadPickSplashes(draft.team1RolePicks);
  _preloadPickSplashes(draft.team2RolePicks);

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'headToHead');
  GfxSettings.clearBackground(root);

  // Apply anim class BEFORE animateIn so the correct keyframes fire
  if (root) {
    var animStyle = h2h.animStyle || 'standard';
    if (!root.classList.contains('anim-' + animStyle)) {
      root.classList.remove('anim-standard', 'anim-impact', 'anim-drop');
      root.classList.add('anim-' + animStyle);
    }
  }

  renderAll(state);

  if (visible !== _lastVisible) {
    if (visible) animateIn();
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
  }
});
