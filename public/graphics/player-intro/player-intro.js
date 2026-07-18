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

// Scales styleTarget's font-size down (binary search) until the text fits within el.
// Pass styleTarget separately when the text node and its measuring container differ (bar layout).
// Measures the TARGET's intrinsic width against el's inner width: el.scrollWidth is
// unreliable when the text is right-/end-aligned (e.g. flex justify-end pushes the
// overflow to the LEFT, which scrollWidth doesn't report) — so a long name on the
// left-hand side would falsely "fit" and clip. The target's own scrollWidth is
// direction-independent.
function fitText(el, maxPx, minPx, styleTarget) {
  if (!el) return;
  var target = styleTarget || el;
  // When a separate measuring child is passed (the bar uses a <span> inside the
  // name container), compare the child's intrinsic width to the container's inner
  // width minus padding. el.scrollWidth can't be used there: an end-aligned span
  // (justify-content:flex-end) overflows to the LEFT, which scrollWidth ignores,
  // and clientWidth would also wrongly count the container's padding as usable.
  // When the element holds the text directly (panel/stack), the classic
  // scrollWidth>offsetWidth overflow test is correct.
  var cs = window.getComputedStyle(el);
  var avail = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  function fits(px) {
    target.style.fontSize = px + 'px';
    if (target === el) return el.scrollWidth <= el.offsetWidth;
    return target.scrollWidth <= avail;
  }
  if (fits(maxPx)) return;
  var lo = minPx, hi = maxPx;
  while (hi - lo > 1) {
    var mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid; else hi = mid;
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
      var pool = (p && p.champPool) || [];
      pool.slice(0, 3).forEach(function(c) {
        var name = c && c.name;
        if (!name) return;
        var url = champSplashUrl(name);
        if (!url || _preloadedSplashes.has(url)) return;
        _preloadedSplashes.add(url);
        var img = new Image(); img.src = url;
      });
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

// True for games with no fixed roster roles (CS2 etc.) — read from the adapter.
function piNoRoles(state) {
  var a = state.adapter || {};
  return a.positions ? !a.positions.some(function(p) { return !!p; }) : false;
}

// ── CS2 player stats (live-data) ────────────────────────────────────────────────
// Compact one-line CS stat for a player in role-less games (CS2 etc.). Prefers the
// tournament aggregate ("KD 1.75 · 95 ADR") once any maps are logged, else falls
// back to the live current-map line ("24 / 11 / 6"). Matches the player to stats by
// normalized in-game name (clan prefixes stripped) with steamid as an override.
// Returns '' for games with roles (LoL) or when nothing matches — the handle shows alone.
// Mirrors spotlight.js csAggForPlayer/csLiveForPlayer; kept in sync deliberately.
function piNormName(s) { return String(s || '').toLowerCase().replace(/\s+/g, '').trim(); }
function piCsStatLine(state, player) {
  if (!player || !piNoRoles(state)) return '';
  var key = piNormName(player.handle || player.name), sid = player.steamid;
  if (!key && !sid) return '';

  var lines = (state.tournament && state.tournament.csStats) || [];
  var a = { maps: 0, kills: 0, deaths: 0, adr: 0 }, hit = false;
  lines.forEach(function(l) {
    if ((sid && l.steamid === sid) || (key && piNormName(l.name) === key)) {
      hit = true; a.maps++; a.kills += l.kills | 0; a.deaths += l.deaths | 0; a.adr += l.adr | 0;
    }
  });
  if (hit && a.maps) {
    var kd = (a.kills / Math.max(1, a.deaths)).toFixed(2);
    var adr = Math.round(a.adr / a.maps);
    return 'KD ' + kd + (adr ? ' · ' + adr + ' ADR' : '');
  }

  var lp = (state.live && state.live.players) || {};
  for (var k in lp) {
    var p = lp[k];
    if ((sid && p.steamid === sid) || (key && piNormName(p.name) === key)) {
      return (p.kills | 0) + ' / ' + (p.deaths | 0) + ' / ' + (p.assists | 0);
    }
  }
  return '';
}

// Player slots for a team: role-based (LoL) gives a fixed top→support order with role
// icons; role-less games (CS2) list players in roster order with no role icon.
// Returns [{ player, roleKey }] — roleKey '' means "no role icon".
function piSlots(state, players) {
  if (piNoRoles(state)) {
    return (players || [])
      .filter(function(p) { return p && (p.handle || p.name); })
      .map(function(p) { return { player: p, roleKey: '' }; });
  }
  return ROLES.map(function(r) { return { player: getPlayerByRole(players, r), roleKey: r }; });
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
  scheduleRefit();
}

// Re-fit team names after layout settles AND after fonts finish loading. The fit
// depends on the player column's width (max-content), which depends on the active
// font — if a broadcast/custom font swaps in after the first fit, a long team name
// would otherwise overflow and clip. document.fonts.ready covers ALL fonts (not
// just Barlow Condensed); the rAF + timeout catch late layout.
function scheduleRefit() {
  requestAnimationFrame(refitNames);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(refitNames);
  }
  setTimeout(refitNames, 300);
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
// Champion strip: the player's top-3 most-played champions as blended splash crops
// filling the row toward the centre divider. Fades out toward the name side so the
// handle stays legible (mirrors the H2H card scrim). Falls back to nothing when the
// player has no champ-pool data, so the row reads cleanly either way.
// L→R [left%, width%] slots per champion count. Slots overlap generously so each
// image's edge-fade meets its neighbour's and the alphas sum to ~full opacity
// (smooth cross-blend with no dark gutters and no visible rectangular edges).
var CHAMP_SLOTS = {
  1: [[0, 100]],
  2: [[0, 62], [38, 62]],
  3: [[0, 46], [27, 46], [54, 46]],
};

function champStripHtml(champPool, side, layout) {
  var pool = (champPool || []).slice(0, 3).filter(function(c) { return c && c.name; });
  if (!pool.length) return '';
  var isRight = side === 'right';
  // Mirror around the centre divider: most-played champion sits nearest the player
  // name on BOTH sides. Left strip reads name→divider (c1..cN); right strip is
  // reversed so it reads divider→name. Slot positions are the same L→R for both.
  var ordered = isRight ? pool.slice().reverse() : pool;
  var n = ordered.length;
  var slots = CHAMP_SLOTS[n];

  var imgs = ordered.map(function(c, idx) {
    var url = champSplashUrl(c.name);
    if (!url) return '';
    var nameEnd = isRight ? idx === n - 1 : idx === 0;
    var divEnd  = isRight ? idx === 0     : idx === n - 1;

    // Build a horizontal alpha mask. Every edge fades fully to transparent BEFORE
    // the image edge, except the one edge that butts the centre divider (kept hard
    // so the inner champion meets the divider cleanly). The name-side outer edge
    // gets a long fade; interior seam edges get a medium fade.
    var leftHard  = divEnd && isRight;    // right column: divider is on the left
    var rightHard = divEnd && !isRight;   // left column:  divider is on the right
    var leftFade  = (nameEnd && !isRight) ? 58 : 30;
    var rightFade = (nameEnd && isRight)  ? 58 : 30;
    var leftStop  = leftHard  ? '#000 0%'   : 'transparent 0%';
    var rightStop = rightHard ? '#000 100%' : 'transparent 100%';
    var mask = 'linear-gradient(to right, ' + leftStop + ', #000 ' + leftFade + '%, #000 ' + (100 - rightFade) + '%, ' + rightStop + ')';

    var s = slots[idx];
    var style = 'left:' + s[0] + '%;width:' + s[1] + '%' +
      ';-webkit-mask-image:' + mask + ';mask-image:' + mask;
    // Real <img> (not a CSS background) so the browser decodes each splash to ~its
    // display size with high-quality resampling, instead of GPU-scaling a full-res
    // texture down ~7× — which aliases/artifacts badly in OBS/CEF.
    return '<img class="pi-champ-img" decoding="async" src="' + url + '" style="' + style + '">';
  }).join('');

  var wrap = 'pi-champstrip pi-champstrip-' + (layout || 'panel') + (isRight ? ' pi-champstrip-right' : '');
  return '<span class="' + wrap + '">' + imgs + '</span>';
}

// ── VALORANT agents ──────────────────────────────────────────────────────────────
// Agents lock hidden (no public draft), so we don't have a "pool" like LoL champs — each
// player has ONE agent this map, set manually on the roster. In the player-intro row we show
// the agent's icon in the (otherwise empty) role-icon slot, so the lineup reads at a glance.
var _piVal = false;   // set per render — true when the tournament game is VALORANT
function piIsValorant(state) { var a = state.adapter || {}; return a.assetSource === 'valorant' || (state.match || {}).game === 'valorant'; }
function agentSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function agentImgUrl(name)  { var s = agentSlug(name); return s ? '/agents/bust/' + s + '.webp' : ''; }     // head+torso bust crop (fills the row well)
function agentIconUrl(name) { var s = agentSlug(name); return s ? '/agents/icons/' + s + '.png' : ''; }   // small headshot icon
function agentPortraitUrl(name) { var s = agentSlug(name); return s ? '/agents/' + s + '.png' : ''; }     // full-body portrait (Agent Cards layout)

// Big agent portrait filling the row toward the centre divider — the VALORANT equivalent of
// the champion splash strip (same H2H-card feel), fading toward the name so the handle stays
// legible. One agent per player (no draft pool). Reuses the champ-strip container + sizing.
// Busts are bottom-anchored to the row and free to break ABOVE it (strip + containers don't
// clip in VALORANT mode) so heads are never cut — no per-agent framing nudges needed.
function agentStripHtml(agentName, side, layout) {
  var url = agentImgUrl(agentName); if (!url) return '';
  var isRight = side === 'right';
  var mask = isRight
    ? 'linear-gradient(to right, #000 0%, #000 48%, transparent 94%)'
    : 'linear-gradient(to right, transparent 6%, #000 52%, #000 100%)';
  var wrap = 'pi-champstrip pi-agentstrip pi-champstrip-' + (layout || 'panel') + (isRight ? ' pi-champstrip-right' : '');
  return '<span class="' + wrap + '"><img class="pi-champ-img pi-agent-portrait" decoding="async" src="' + url + '" style="-webkit-mask-image:' + mask + ';mask-image:' + mask + '"></span>';
}

function buildPanelRowHtml(player, roleKey, side, showRank, showChamps, csLine) {
  var handle    = player.handle || '';
  var icon      = ROLE_ICONS[roleKey] || '';
  var rank      = showRank   ? rankText(player.rank || null) : '';

  var isRight = side === 'right';
  var rowCls  = 'pi-pnl-row' + (isRight ? ' pi-pnl-row-right' : '') + (_piVal ? ' pi-pnl-row-agent' : '');

  var strip  = showChamps ? (_piVal ? agentStripHtml(player.agent, side, 'panel') : champStripHtml(player.champPool, side, 'panel')) : '';
  var roleEl = _piVal ? '' : (roleKey ? '<span class="pi-pnl-role-icon" style="background-image:url(' + icon + ')"></span>' : '');
  var textEl = (
    '<span class="pi-pnl-text">' +
      '<span class="pi-pnl-handle">' + esc(handle) + '</span>' +
      (csLine    ? '<span class="pi-pnl-csstat">' + esc(csLine) + '</span>' : '') +
      (rank      ? '<span class="pi-pnl-rank">'  + rank      + '</span>' : '') +
    '</span>'
  );

  return '<div class="' + rowCls + '">' + strip + roleEl + textEl + '</div>';
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
  _piVal = piIsValorant(state);

  setBg('pi-panel-t1-logo', t1.logo);
  setBg('pi-panel-t2-logo', t2.logo);
  setTxt('pi-panel-t1-name', t1.name || t1.tag || '');
  setTxt('pi-panel-t2-name', t2.name || t2.tag || '');

  var maxPanelNamePx = Math.round(window.innerHeight * 0.042);
  fitText($('pi-panel-t1-name'), maxPanelNamePx, Math.round(maxPanelNamePx * 0.42));
  fitText($('pi-panel-t2-name'), maxPanelNamePx, Math.round(maxPanelNamePx * 0.42));

  var t1Hdr = $('pi-panel-t1-hdr'), t2Hdr = $('pi-panel-t2-hdr');
  if (t1Hdr) t1Hdr.style.setProperty('--team-color', 'var(--gfx-blue)');
  if (t2Hdr) t2Hdr.style.setProperty('--team-color', 'var(--gfx-red)');

  setLogoOrVs($('pi-panel-centre-img'), $('pi-panel-vs'), showLogo ? getCentreLogo(state) : '');

  function fillRows(elId, players, side) {
    var el = $(elId);
    if (!el) return;
    var slots = piSlots(state, players);
    var rows = slots.map(function(sl) {
      return { player: sl.player, roleKey: sl.roleKey, cs: piCsStatLine(state, sl.player) };
    });
    var key = rows.map(function(r) {
      var p = r.player;
      return [p.handle||'', r.roleKey, showRank, rankText(p.rank||null), showChamps, _piVal, p.agent||'',
        (p.champPool || []).slice(0, 3).map(function(c){return c && c.name;}).join(','), r.cs].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = rows.map(function(r) {
        return buildPanelRowHtml(r.player, r.roleKey, side, showRank, showChamps, r.cs);
      }).join('');
    }
  }

  fillRows('pi-panel-t1-rows', t1Players, 'left');
  fillRows('pi-panel-t2-rows', t2Players, 'right');
}

// ── Layout: Team Card Stack ───────────────────────────────────────────────────
function buildStackPlayerHtml(player, roleKey, showRank, showChamps, side, csLine) {
  var handle    = player.handle || '';
  var icon      = ROLE_ICONS[roleKey] || '';
  var rank      = showRank   ? rankText(player.rank || null) : '';

  var strip = showChamps ? (_piVal ? agentStripHtml(player.agent, side, 'stack') : champStripHtml(player.champPool, side, 'stack')) : '';
  var roleEl = _piVal ? '' : (roleKey ? '<span class="pi-stk-role" style="background-image:url(' + icon + ')"></span>' : '');
  return (
    '<div class="pi-stk-player' + (_piVal ? ' pi-stk-player-agent' : '') + '">' +
      strip +
      roleEl +
      '<span class="pi-stk-handle">' + esc(handle) + '</span>' +
      (csLine    ? '<span class="pi-stk-csstat">' + esc(csLine) + '</span>' : '') +
      (rank      ? '<span class="pi-stk-rank">' + rank + '</span>' : '') +
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
  _piVal = piIsValorant(state);

  var t1El = $('pi-stack-t1'), t2El = $('pi-stack-t2');
  if (t1El) t1El.style.setProperty('--team-color', 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', 'var(--gfx-red)');

  setBg('pi-stack-t1-logo', t1.logo);
  setBg('pi-stack-t2-logo', t2.logo);
  setTxt('pi-stack-t1-name', t1.name || t1.tag || '');
  setTxt('pi-stack-t2-name', t2.name || t2.tag || '');

  // The stack has no centre VS/logo — the two team halves simply meet in the middle.

  function fillPlayers(elId, players, side) {
    var el = $(elId);
    if (!el) return;
    var slots = piSlots(state, players);
    var rows = slots.map(function(sl) {
      return { player: sl.player, roleKey: sl.roleKey, cs: piCsStatLine(state, sl.player) };
    });
    var key = rows.map(function(r) {
      var p = r.player;
      return [p.handle||'', r.roleKey, showRank, rankText(p.rank||null), showChamps, _piVal, p.agent||'',
        (p.champPool || []).slice(0, 3).map(function(c){return c && c.name;}).join(','), r.cs].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = rows.map(function(r) {
        return buildStackPlayerHtml(r.player, r.roleKey, showRank, showChamps, side, r.cs);
      }).join('');
    }
  }

  fillPlayers('pi-stack-t1-players', t1Players, 'left');
  fillPlayers('pi-stack-t2-players', t2Players, 'right');
}

// ── Layout: Nameplate Bar ─────────────────────────────────────────────────────
// The Bar layout is name-only: its rows are too thin for the champ strip and its
// centre dead-space is already filled by the team names, so champions are never
// shown here regardless of the showChamps toggle.
function buildBarPlayerHtml(player, roleKey, showRank, csLine) {
  var handle = player.handle || '';
  var icon   = ROLE_ICONS[roleKey] || '';
  var rank   = showRank ? rankTextShort(player.rank || null) : '';

  return (
    '<div class="pi-bar-player">' +
      (roleKey ? '<span class="pi-bar-role" style="background-image:url(' + icon + ')"></span>' : '') +
      '<span class="pi-bar-text">' +
        '<span class="pi-bar-handle">' + esc(handle) + '</span>' +
        (csLine ? '<span class="pi-bar-csstat">' + esc(csLine) + '</span>' : '') +
        (rank ? '<span class="pi-bar-rank">' + rank + '</span>' : '') +
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
  var showLogo   = pi.showLogo !== false;

  // CS2 stat lines need the same extra row height as ranks (a second line per player).
  var hasCs = piNoRoles(state) &&
    t1Players.concat(t2Players).some(function(p) { return !!piCsStatLine(state, p); });

  var bandEl = document.querySelector('.pi-bar-band');
  if (bandEl) {
    bandEl.classList.toggle('has-rank', showRank);
    bandEl.classList.toggle('has-cs', hasCs);  // CS stat line is taller than a rank — needs more band height
    bandEl.style.setProperty('--pi-bar-alpha', pi.barOpacity !== undefined ? pi.barOpacity : 0.93);
  }

  setBg('pi-bar-t1-logo', t1.logo);
  setBg('pi-bar-t2-logo', t2.logo);

  var t1El = $('pi-bar-t1'), t2El = $('pi-bar-t2');
  if (t1El) t1El.style.setProperty('--team-color', 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', 'var(--gfx-red)');

  setLogoOrVs($('pi-bar-centre-img'), $('pi-bar-vs'), showLogo ? getCentreLogo(state) : '');

  function fillPlayers(elId, players) {
    var el = $(elId);
    if (!el) return;
    var slots = piSlots(state, players);
    var rows = slots.map(function(sl) {
      return { player: sl.player, roleKey: sl.roleKey, cs: piCsStatLine(state, sl.player) };
    });
    var key = rows.map(function(r) {
      var p = r.player;
      return [p.handle||'', r.roleKey, showRank, rankText(p.rank||null), r.cs].join(':');
    }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = rows.map(function(r) {
        return buildBarPlayerHtml(r.player, r.roleKey, showRank, r.cs);
      }).join('');
    }
  }

  // Populate the player columns FIRST — their max-content width determines how much
  // room is left for the team name, so the name must be fitted against the final
  // layout, not an empty (too-wide) slot.
  fillPlayers('pi-bar-t1-players', t1Players);
  fillPlayers('pi-bar-t2-players', t2Players);

  // Team names in the dead space flanking the centre, fitted to the space the
  // players leave behind.
  var t1NameEl = $('pi-bar-t1-team-name');
  var t2NameEl = $('pi-bar-t2-team-name');
  if (t1NameEl) t1NameEl.innerHTML = '<span>' + esc(t1.name || t1.tag || '') + '</span>';
  if (t2NameEl) t2NameEl.innerHTML = '<span>' + esc(t2.name || t2.tag || '') + '</span>';

  var maxBarNamePx = Math.round(window.innerHeight * 0.05);
  var minBarNamePx = Math.round(maxBarNamePx * 0.34);
  if (t1NameEl) fitText(t1NameEl, maxBarNamePx, minBarNamePx, t1NameEl.querySelector('span'));
  if (t2NameEl) fitText(t2NameEl, maxBarNamePx, minBarNamePx, t2NameEl.querySelector('span'));
}

// ── Layout: Agent Cards (VALORANT) ────────────────────────────────────────────
// A full-screen "hero shot" layout — each team's five agents as tall portrait cards
// (full-body art, not the row bust) clustered LEFT / RIGHT with VS in the centre, in the
// same card language as the Map Veto board. Valorant-only (needs one agent per player);
// falls back to the Nameplate panel for any other game (no wired portrait art).
function buildAgentCardHtml(player, i) {
  var handle = player.handle || '';
  var agent  = player.agent || '';
  var url    = agentPortraitUrl(agent);
  var portrait = url ? '<img class="pi-ac-portrait" decoding="async" src="' + url + '" alt="">' : '';
  return (
    '<div class="pi-ac-card" style="--i:' + i + '">' +
      portrait +
      '<div class="pi-ac-scrim"></div>' +
      '<div class="pi-ac-foot">' +
        '<span class="pi-ac-handle">' + esc(handle) + '</span>' +
        (agent ? '<span class="pi-ac-agent">' + esc(agent) + '</span>' : '') +
      '</div>' +
    '</div>'
  );
}

// Set (or collapse) an Agent Cards header logo box. Empty url → hidden + display:none so the
// flex row drops the box and its gap, sliding the team name out to the cluster edge.
function acHeaderLogo(id, url) {
  var el = $(id);
  if (!el) return;
  el.style.backgroundImage = url ? 'url(' + url + ')' : '';
  el.style.display = url ? '' : 'none';
}

function renderAgentCards(state) {
  var match     = state.match || {};
  var pi        = state.playerIntro || {};
  var t1        = match.team1 || {};
  var t2        = match.team2 || {};
  var t1Players = (state.players && state.players.team1) || [];
  var t2Players = (state.players && state.players.team2) || [];
  var showLogo  = pi.showLogo !== false;

  var t1El = $('pi-ac-t1'), t2El = $('pi-ac-t2');
  if (t1El) t1El.style.setProperty('--team-color', 'var(--gfx-blue)');
  if (t2El) t2El.style.setProperty('--team-color', 'var(--gfx-red)');

  // Team logos live in the outer region of each header, gated by the Logo toggle. When off
  // (or the team has no logo) collapse the box so the name slides out to the cluster edge.
  acHeaderLogo('pi-ac-t1-logo', showLogo && t1.logo ? t1.logo : '');
  acHeaderLogo('pi-ac-t2-logo', showLogo && t2.logo ? t2.logo : '');
  setTxt('pi-ac-t1-name', t1.name || t1.tag || '');
  setTxt('pi-ac-t2-name', t2.name || t2.tag || '');

  var maxNamePx = Math.round(window.innerHeight * 0.05);
  fitText($('pi-ac-t1-name'), maxNamePx, Math.round(maxNamePx * 0.4));
  fitText($('pi-ac-t2-name'), maxNamePx, Math.round(maxNamePx * 0.4));

  // Centre is always the VS lockup for this layout — team branding lives in the outer regions.
  setLogoOrVs($('pi-ac-centre-img'), $('pi-ac-vs'), '');

  function fillCards(elId, players) {
    var el = $(elId);
    if (!el) return;
    var rows = piSlots(state, players).map(function(sl) { return sl.player; });
    var key = rows.map(function(p) { return [p.handle || '', p.agent || ''].join(':'); }).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = rows.map(buildAgentCardHtml).join('');
    }
  }

  fillCards('pi-ac-t1-cards', t1Players);
  fillCards('pi-ac-t2-cards', t2Players);
  fitAgentCardHandles();
}

// Shrink each player handle down until it fits the card width (long handles would otherwise
// clip) — the card is narrow, so this is a genuine fit rather than the usual headroom. Runs
// every render (idempotent: fitText resets to max, then binary-searches down) and again after
// fonts load via refitNames.
function fitAgentCardHandles() {
  var handles = document.querySelectorAll('.pi-agentcards .pi-ac-handle');
  var maxPx = Math.round(window.innerHeight * 0.027);
  var minPx = Math.round(maxPx * 0.45);
  for (var i = 0; i < handles.length; i++) fitText(handles[i], maxPx, minPx);
}

// ── Layout: Team Fan (VALORANT) ───────────────────────────────────────────────
// A composited "team photo": each team's five agents overlapped into ONE hero image —
// centre agent tallest/foremost, heights stepping down outward (\\||//), all standing on a
// common floor. Shows one team or both (VS centre), from pi.fanTeams: 'both' | 'team1' |
// 'team2'. Valorant-only (full-body art).
// Slot geometry per visual position 0..4: centre-x (% of stage), height (% of stage),
// z-index, and the distance-from-centre used for the animation stagger.
var FAN_SLOTS = [
  { x: 12, h: 76, z: 1, d: 2 },
  { x: 31, h: 87, z: 2, d: 1 },
  { x: 50, h: 100, z: 3, d: 0 },
  { x: 69, h: 87, z: 2, d: 1 },
  { x: 88, h: 76, z: 1, d: 2 },
];

// Valorant is role-less — roster order carries no meaning, so the fan is free to arrange.
function fanPlayers(players) {
  return (players || []).filter(function (p) { return p && (p.handle || p.agent); }).slice(0, 5);
}

// Some portraits are much WIDER than others (capes, deployed abilities, nebulae) and at
// fan overlap they slather across their neighbours. Fix: measure each portrait's aspect
// and put the WIDEST art on the OUTER slots (low z → wide elements tuck BEHIND the inner
// neighbour) and the narrowest in the tall centre slot. Aspect cache is filled by
// preloading the local images; until an aspect is known we fall back to roster order and
// re-render when the load lands (local files — near-instant).
var _fanAspect = {};        // slug -> width/height
var _fanLoading = {};       // slug -> true while an Image() load is in flight
function fanEnsureAspects(list, onReady) {
  var pending = 0;
  list.forEach(function (p) {
    var slug = agentSlug(p.agent);
    if (!slug || _fanAspect[slug] != null || _fanLoading[slug]) return;
    _fanLoading[slug] = true;
    pending++;
    var img = new Image();
    img.onload = function () {
      _fanAspect[slug] = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      delete _fanLoading[slug];
      if (--pending === 0 && onReady) onReady();
    };
    img.onerror = function () { _fanAspect[slug] = 1; delete _fanLoading[slug]; if (--pending === 0 && onReady) onReady(); };
    img.src = agentPortraitUrl(p.agent);
  });
  return pending === 0;
}

// Visual arrangement: widest two → outer slots (0, 4), middle two → slots 1, 3,
// narrowest → centre (2). Deterministic (slug tiebreak) so repeated renders agree.
function fanArrange(list) {
  var known = list.every(function (p) { return _fanAspect[agentSlug(p.agent)] != null; });
  if (!known || list.length < 2) return list;
  var byWidth = list.slice().sort(function (a, b) {
    var d = (_fanAspect[agentSlug(b.agent)] || 1) - (_fanAspect[agentSlug(a.agent)] || 1);
    return d !== 0 ? d : agentSlug(a.agent) < agentSlug(b.agent) ? -1 : 1;
  });
  var out = [];
  var order = [0, 4, 1, 3, 2];              // widest → first/fifth, narrowest → centre
  byWidth.forEach(function (p, i) { out[order[i]] = p; });
  return out.filter(function (p) { return p; });
}

function buildFanStageHtml(arranged) {
  var html = '';
  for (var i = 0; i < FAN_SLOTS.length; i++) {
    var p = arranged[i] || {};
    var url = agentPortraitUrl(p.agent);
    if (!url) continue;
    var s = FAN_SLOTS[i];
    html += '<img class="pi-fan-agent" decoding="async" src="' + url + '"' +
      ' style="left:' + s.x + '%;height:' + s.h + '%;z-index:' + s.z + ';--d:' + s.d + '">';
  }
  return html;
}

function buildFanNamesHtml(arranged) {
  return FAN_SLOTS.map(function (_, i) {
    var p = arranged[i] || {};
    return '<span class="pi-fan-name"><b>' + esc(p.handle || '') + '</b>' +
      (p.agent ? '<i>' + esc(p.agent) + '</i>' : '') + '</span>';
  }).join('');
}

function renderFan(state) {
  var match     = state.match || {};
  var pi        = state.playerIntro || {};
  var t1        = match.team1 || {};
  var t2        = match.team2 || {};
  var showLogo  = pi.showLogo !== false;
  var teams     = pi.fanTeams === 'team1' || pi.fanTeams === 'team2' ? pi.fanTeams : 'both';
  var root      = $('pi-root');

  root.classList.toggle('fan-solo', teams !== 'both');

  var t1El = $('pi-fan-t1'), t2El = $('pi-fan-t2'), cEl = $('pi-fan-centre');
  if (t1El) { t1El.style.display = teams === 'team2' ? 'none' : ''; t1El.style.setProperty('--team-color', 'var(--gfx-blue)'); }
  if (t2El) { t2El.style.display = teams === 'team1' ? 'none' : ''; t2El.style.setProperty('--team-color', 'var(--gfx-red)'); }
  if (cEl)  cEl.style.display = teams === 'both' ? '' : 'none';

  acHeaderLogo('pi-fan-t1-logo', showLogo && t1.logo ? t1.logo : '');
  acHeaderLogo('pi-fan-t2-logo', showLogo && t2.logo ? t2.logo : '');
  setTxt('pi-fan-t1-name', t1.name || t1.tag || '');
  setTxt('pi-fan-t2-name', t2.name || t2.tag || '');

  var maxNamePx = Math.round(window.innerHeight * 0.05);
  fitText($('pi-fan-t1-name'), maxNamePx, Math.round(maxNamePx * 0.4));
  fitText($('pi-fan-t2-name'), maxNamePx, Math.round(maxNamePx * 0.4));

  setLogoOrVs($('pi-fan-centre-img'), $('pi-fan-vs'), '');

  function fill(stageId, namesId, players) {
    var stage = $(stageId), names = $(namesId);
    if (!stage) return;
    var list = fanPlayers(players);
    // Width-aware arrangement needs the portraits' aspects — preload any unknown ones and
    // re-fill when they land (local files, so this resolves within a frame or two).
    var ready = fanEnsureAspects(list, function () { stage.dataset.key = ''; fill(stageId, namesId, players); });
    var arranged = ready ? fanArrange(list) : list;
    var key = arranged.map(function (p) { return [p.handle || '', p.agent || ''].join(':'); }).join('|') + '|' + teams + '|' + (ready ? 'w' : 'r');
    if (stage.dataset.key !== key) {
      stage.dataset.key = key;
      stage.innerHTML = buildFanStageHtml(arranged);
      if (names) names.innerHTML = buildFanNamesHtml(arranged);
    }
  }
  if (teams !== 'team2') fill('pi-fan-t1-stage', 'pi-fan-t1-names', (state.players && state.players.team1) || []);
  if (teams !== 'team1') fill('pi-fan-t2-stage', 'pi-fan-t2-names', (state.players && state.players.team2) || []);
}

// ── Render dispatch ───────────────────────────────────────────────────────────
function renderAll(state) {
  var pi     = state.playerIntro || {};
  var layout = pi.layout || 'panel';
  var root   = $('pi-root');
  if (!root) return;

  // Agent Cards / Team Fan need Valorant's per-player agent art — for any other game there's
  // no wired portrait, so fall back to the Nameplate panel rather than show empty frames.
  if ((layout === 'agentcards' || layout === 'fan') && !piIsValorant(state)) layout = 'panel';

  if (root.dataset.layout !== layout) {
    root.dataset.layout = layout;
    root.classList.remove('layout-panel', 'layout-stack', 'layout-bar', 'layout-agentcards', 'layout-fan');
    root.classList.add('layout-' + layout);
  }

  if      (layout === 'stack')      renderStack(state);
  else if (layout === 'bar')        renderBar(state);
  else if (layout === 'agentcards') renderAgentCards(state);
  else if (layout === 'fan')        renderFan(state);
  else                              renderPanel(state);
}

// ── Background ────────────────────────────────────────────────────────────────
// Player Intro can show a solid dark backing (useful when run full-screen rather
// than as an overlay) or stay transparent. It never paints an animated canvas —
// that lives only in the dedicated BG Output source.
function getEffectiveBgState(state) {
  var pi   = state.playerIntro || {};
  var dark = (pi.piBg === 'dark');
  var overrideSettings = Object.assign({}, state.settings || {}, {
    bgType:  dark ? 'color' : 'transparent',
    bgColor: dark ? '#07101a' : '',
    bgImage: '', bgAnimation: '', bgFogLayer: false, // never animate inside the overlay
  });
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
    var minBarPx = Math.round(maxBarPx * 0.34);
    var t1El = $('pi-bar-t1-team-name'), t2El = $('pi-bar-t2-team-name');
    if (t1El) fitText(t1El, maxBarPx, minBarPx, t1El.querySelector('span'));
    if (t2El) fitText(t2El, maxBarPx, minBarPx, t2El.querySelector('span'));
  } else if (layout === 'agentcards') {
    var maxAcPx = Math.round(window.innerHeight * 0.05);
    var minAcPx = Math.round(maxAcPx * 0.4);
    fitText($('pi-ac-t1-name'), maxAcPx, minAcPx);
    fitText($('pi-ac-t2-name'), maxAcPx, minAcPx);
    fitAgentCardHandles();
  } else if (layout === 'fan') {
    var maxFanPx = Math.round(window.innerHeight * 0.05);
    var minFanPx = Math.round(maxFanPx * 0.4);
    fitText($('pi-fan-t1-name'), maxFanPx, minFanPx);
    fitText($('pi-fan-t2-name'), maxFanPx, minFanPx);
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
  GfxSettings.applyAnimation(document.documentElement, state, 'playerIntro');
  GfxSettings.applyBackground(root, getEffectiveBgState(state));

  // VALORANT flag on the root — releases the panel/stack container clipping so the tall
  // agent busts can break above the box instead of having their heads cut off (CSS .pi-val).
  if (root) root.classList.toggle('pi-val', piIsValorant(state));

  if (root) {
    var layout = pi.layout || 'panel';
    var defaultAnim = layout === 'stack' ? 'split' : layout === 'bar' ? 'slide' : 'rise';   // agentcards + fan default rise
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

// Safety net: re-fit team names whenever the space available to them changes —
// e.g. a broadcast/custom font swapping in widens the player column and shrinks
// the team-name slot. Without this a long name fitted against the wrong width
// would overflow and clip. Debounced to a frame; fitText only changes font-size
// (not the flex container width) so this can't loop.
(function observeNameFit() {
  if (!window.ResizeObserver) return;
  var pending = false;
  var ro = new ResizeObserver(function() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function() { pending = false; refitNames(); });
  });
  ['pi-bar-t1-team-name', 'pi-bar-t2-team-name', 'pi-panel-t1-name', 'pi-panel-t2-name']
    .forEach(function(id) { var el = $(id); if (el) ro.observe(el); });
})();
