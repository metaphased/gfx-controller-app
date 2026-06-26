// Player Spotlight overlay — spotlight.js
// Left/right player stage. Player A is locked to the left (#ps-slot-0), Player B to
// the right (#ps-slot-1). stage = 'a' (A only) | 'b' (B only) | 'both'. Each player's
// geometry is identical alone or together, so a stage change is a pure directional
// slide: a player always slides in from / out to their OWN side (A left, B right),
// and the Both view brings in the missing half. Entrance, exit and switching all use
// the same home-side slide. Splashes are pre-decoded (win-screen cold-load lesson).
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _visible       = false;
var _outTimer      = null;
var _fp            = '';     // content fingerprint — repopulate only on change
var _stageShown    = 'a';    // stage currently on screen
var _transitioning = false;
var _tourStats     = null;   // /api/tournament-stats cache (this-event per-champ W-L), for statSource
var _lastState     = null;   // most recent state, so a late stats fetch can re-render

// Stats shown for the featured champion. statTokens (per slot) pick which to show
// (empty = all); statOverrides (per slot) replace a value with manual text.
var PS_STAT_TOKENS = [
  { key: 'winRate', label: 'Win Rate' },
  { key: 'games',   label: 'Games'    },
  { key: 'record',  label: 'Record'   },
];

var ROLE_ICONS = {
  top: '/graphics/draft/roles/top.png', jungle: '/graphics/draft/roles/jungle.png',
  jg: '/graphics/draft/roles/jungle.png', mid: '/graphics/draft/roles/mid.png',
  bot: '/graphics/draft/roles/bot.png', adc: '/graphics/draft/roles/bot.png',
  support: '/graphics/draft/roles/support.png', sup: '/graphics/draft/roles/support.png',
};
var ROLE_LABELS = { top: 'Top', jungle: 'Jungle', mid: 'Mid', bot: 'Bot', adc: 'Bot', support: 'Support', sup: 'Support' };
var CHAMP_KEY_FIXES = {
  "kai'sa": 'Kaisa', "cho'gath": 'Chogath', "kha'zix": 'Khazix', "kog'maw": 'KogMaw',
  "rek'sai": 'RekSai', "vel'koz": 'Velkoz', "bel'veth": 'Belveth', "k'sante": 'KSante',
  "wukong": 'MonkeyKing', "nunu & willump": 'Nunu', "renata glasc": 'Renata',
};

function $(id) { return document.getElementById(id); }
function setTxt(id, v) { var e = $(id); if (e) e.textContent = v == null ? '' : v; }

function normChampKey(name) {
  if (!name) return '';
  var fix = CHAMP_KEY_FIXES[name.toLowerCase()];
  return fix || name.replace(/['\s.&]/g, '');
}
function champSplashUrl(name) { var k = normChampKey(name); return k ? '/graphics/head2head/champions-splash/' + k + '_0.jpg' : ''; }
function champCenteredUrl(name) { var k = normChampKey(name); return k ? '/graphics/head2head/champions/' + k + '_0.jpg' : ''; }
function normRole(r) { r = (r || '').toLowerCase().trim(); return r === 'adc' ? 'bot' : r; }

function rankText(rank) {
  if (!rank || !rank.tier) return '';
  var tier = rank.tier.charAt(0).toUpperCase() + rank.tier.slice(1).toLowerCase();
  if (tier === 'Challenger' || tier === 'Grandmaster' || tier === 'Master') return tier + ' ' + (rank.lp || 0) + ' LP';
  return tier + ' ' + (rank.division || '') + ' ' + (rank.lp || 0) + ' LP';
}

function _durScale() {
  var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gfx-dur-scale'));
  return isNaN(v) ? 1 : v;
}

// Accent ramp written onto `el` (each slot carries its own team colour).
function applyAccentVars(el, hex) {
  if (!el) return;
  var safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#1ffaff';
  var r = parseInt(safe.slice(1, 3), 16), g = parseInt(safe.slice(3, 5), 16), b = parseInt(safe.slice(5, 7), 16);
  el.style.setProperty('--ps-accent', safe);
  el.style.setProperty('--ps-acc-a70', 'rgba(' + r + ',' + g + ',' + b + ',0.70)');
  el.style.setProperty('--ps-acc-a30', 'rgba(' + r + ',' + g + ',' + b + ',0.30)');
  el.style.setProperty('--ps-acc-a12', 'rgba(' + r + ',' + g + ',' + b + ',0.12)');
  el.style.setProperty('--ps-acc-a00', 'rgba(' + r + ',' + g + ',' + b + ',0)');
}

function resolveAccent(state, team) {
  var ps = state.playerSpotlight || {}, s = state.settings || {};
  if (ps.accentSource === 'custom') return /^#[0-9a-fA-F]{6}$/.test(ps.accentCustom || '') ? ps.accentCustom : '#1ffaff';
  if (ps.accentSource === 'side') {
    var blueTeam = (state.draft && state.draft.blueSideTeam) || 'team1';
    return ((team || 'team1') === blueTeam ? s.blueAccent : s.redAccent) || GfxSettings.palette(state, 0);
  }
  return GfxSettings.palette(state, 0);
}

function resolveSlotPlayer(state, slot) {
  var team = (slot && slot.team) || 'team1';
  var roster = (state.players && state.players[team]) || [];
  if (slot && slot.handle) {
    var found = roster.find(function (p) { return p && p.handle === slot.handle; });
    if (found) return found;
  }
  return roster[0] || null;
}

function featuredChamp(player, slot) {
  if (slot && slot.champ) return slot.champ;
  var pool = (player && player.champPool) || [];
  return (pool[0] && pool[0].name) || '';
}

// op.gg champ-pool entry for a champion (name/games/wins/losses).
function poolEntryFor(player, champName) {
  var pool = (player && player.champPool) || [];
  return pool.find(function (c) { return normChampKey(c.name) === normChampKey(champName); }) || null;
}
// This-event tournament entry for a champion (from /api/tournament-stats, keyed by handle
// then champ key). Returns { games, wins, losses, winRate } or null.
function tourEntryFor(player, champName) {
  var handle = player && player.handle;
  if (!_tourStats || !handle || !_tourStats[handle]) return null;
  var map = _tourStats[handle], k = normChampKey(champName);
  for (var name in map) { if (normChampKey(name) === k) return map[name]; }
  return null;
}

// Resolve the W-L source for a champion per the statSource toggle: 'opgg' = champ pool,
// 'tournament' = this-event stats, 'both' = tournament if it has games, else the pool.
function statSourceEntry(player, champName, source) {
  var pool = poolEntryFor(player, champName), tour = tourEntryFor(player, champName);
  if (source === 'tournament') return tour;
  if (source === 'opgg') return pool;
  return (tour && tour.games) ? tour : pool;   // 'both' (default mix)
}

// The display value for one stat token from a resolved entry.
function statTokenValue(key, e) {
  if (!e || !e.games) return null;
  var wins = e.wins || 0, losses = e.losses || 0, games = e.games || 0;
  if (key === 'winRate') return (e.winRate != null ? e.winRate : Math.round((wins / games) * 100)) + '%';
  if (key === 'games')   return String(games);
  if (key === 'record')  return wins + 'W ' + losses + 'L';
  return null;
}

// ── CS2 player stats (live-data) ────────────────────────────────────────────────
// Match the featured player to live / accumulated CS stats by in-game name (fallback
// steamid). normName lowercases + strips spaces so a clan-prefixed handle still lines up.
function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, '').trim(); }
function csLiveForPlayer(state, player) {
  var lp = (state.live && state.live.players) || {}, key = normName(player && (player.handle || player.name));
  if (!key && !(player && player.steamid)) return null;
  for (var sid in lp) { var p = lp[sid];
    if ((player && player.steamid && p.steamid === player.steamid) || (key && normName(p.name) === key)) return p; }
  return null;
}
// Aggregate this player's accumulated lines (whole tournament) from state.tournament.csStats.
function csAggForPlayer(state, player) {
  var lines = (state.tournament && state.tournament.csStats) || [];
  if (!lines.length || !player) return null;
  var key = normName(player.handle || player.name), a = { maps: 0, kills: 0, deaths: 0, assists: 0, mvps: 0, _adr: 0 }, hit = false;
  lines.forEach(function (l) {
    if ((player.steamid && l.steamid === player.steamid) || (key && normName(l.name) === key)) {
      hit = true; a.maps++; a.kills += l.kills | 0; a.deaths += l.deaths | 0; a.assists += l.assists | 0; a.mvps += l.mvps | 0; a._adr += l.adr | 0;
    }
  });
  if (!hit) return null;
  a.adr = a.maps ? Math.round(a._adr / a.maps) : 0; a.kd = (a.kills / Math.max(1, a.deaths)).toFixed(2);
  return a;
}
// CS stat chips: tournament-so-far (K/D · ADR · Maps) if any maps are logged, else the live
// current-map line (K/D/A · ADR). Returns [] when there's no data (just the name shows).
function buildCsStats(player, state) {
  var agg = csAggForPlayer(state, player), out = [];
  if (agg && agg.maps) {
    out.push({ label: 'K / D', val: agg.kd });
    if (agg.adr) out.push({ label: 'ADR', val: String(agg.adr) });
    out.push({ label: 'Maps', val: String(agg.maps) });
    return out;
  }
  var live = csLiveForPlayer(state, player);
  if (live) {
    out.push({ label: 'K / D / A', val: (live.kills | 0) + ' / ' + (live.deaths | 0) + ' / ' + (live.assists | 0) });
    if (live.adr) out.push({ label: 'ADR', val: String(live.adr) });
  }
  return out;
}

// Build the stat chips for a slot: walk the token list in order, honour the slot's
// statTokens (empty = all) and statOverrides (manual text wins over the auto value).
function buildStats(player, champName, slot, state) {
  var ps = (state && state.playerSpotlight) || {};
  var adapter = (state && state.adapter) || {};
  // No champion pick entity (CS2 etc.) → show CS live-data stats instead of champ W/L.
  if (adapter.pickEntity != null && adapter.pickEntity !== 'champion') return buildCsStats(player, state);
  var entry = statSourceEntry(player, champName, ps.statSource || 'both');
  var overrides = (slot && slot.statOverrides) || {};
  var tokens = (slot && slot.statTokens && slot.statTokens.length)
    ? slot.statTokens : PS_STAT_TOKENS.map(function (t) { return t.key; });
  var out = [];
  PS_STAT_TOKENS.forEach(function (tok) {
    if (tokens.indexOf(tok.key) < 0) return;
    var ov = overrides[tok.key];
    var val = (ov != null && ov !== '') ? ov : statTokenValue(tok.key, entry);
    if (val == null || val === '') return;
    out.push({ label: tok.label, val: val });
  });
  return out;
}

// Point a slot's hero <img> at the right art (guarded — no reload on an unchanged
// champ/design/format). Big cinematic full designs → wide splash; cut-ins → centred crop.
function applyHeroSrc(idx, champName, design, format) {
  var heroImg = $('ps-hero-img-' + idx);
  if (!heroImg) return;
  var heroKey = champName + '|' + design + '|' + format;
  if (heroImg._key === heroKey) return;
  heroImg._key = heroKey;
  var ckey = normChampKey(champName);
  if (!ckey) { heroImg.removeAttribute('src'); return; }
  // Only the BLEED design uses the wide uncentred splash (it's meant to be the whole
  // cinematic scene). Every other design uses the CENTRED crop so the CHAMPION fills the
  // frame — the wide splash drops the champion to the edge and fills the box with
  // background scenery (the planet/sparks behind Orianna), which is not what we want here.
  var useSplash = (format === 'full') && (design === 'bleed');
  if (useSplash) {
    heroImg.onerror = function () { heroImg.onerror = null; heroImg.src = champCenteredUrl(champName); };
    heroImg.src = champSplashUrl(champName);
  } else {
    heroImg.onerror = null;
    heroImg.src = champCenteredUrl(champName);
  }
}

// Per-slot fingerprint (no DOM writes) for change detection.
function slotFp(state, idx) {
  var ps = state.playerSpotlight || {};
  var slot = (ps.players && ps.players[idx]) || {};
  var player = resolveSlotPlayer(state, slot);
  var team = slot.team || (idx === 0 ? 'team1' : 'team2');
  var adapter = state.adapter || {};
  var teamLogo = (state.match && state.match[team] && state.match[team].logo) || '';
  var csSig = (adapter.pickEntity != null && adapter.pickEntity !== 'champion')
    ? JSON.stringify(csAggForPlayer(state, player)) + JSON.stringify(csLiveForPlayer(state, player)) : '';
  return [team, player && player.handle, featuredChamp(player, slot),
    player && player.rank, normRole(player && player.role), resolveAccent(state, team), slot.caption,
    ps.statSource, slot.statTokens, slot.statOverrides, adapter.pickEntity, adapter.positions, teamLogo, csSig];
}

// Fill one slot's suffixed elements + its own accent + hero art.
function populateSlot(state, idx) {
  var ps = state.playerSpotlight || {};
  var slot = (ps.players && ps.players[idx]) || {};
  var player = resolveSlotPlayer(state, slot);
  var team = slot.team || (idx === 0 ? 'team1' : 'team2');
  var champName = featuredChamp(player, slot);
  var teamName = (state.match && state.match[team] && (state.match[team].name || state.match[team].tag)) || '';
  var role = normRole(player && player.role);
  var stats = buildStats(player, champName, slot, state);
  var design = ps.design || 'showcase';

  // Games without a champion pick entity (CS2 etc.) have no champion splash art and
  // no fixed roles — swap the hero art for a team-colour wash + faint team-logo
  // watermark, and hide the role row. Driven by the resolved adapter descriptor.
  var adapter = state.adapter || {};
  var noChamp = adapter.pickEntity != null && adapter.pickEntity !== 'champion';
  var noRoles = adapter.positions ? !adapter.positions.some(function (p) { return !!p; }) : false;

  var slotEl = $('ps-slot-' + idx);
  if (slotEl) {
    applyAccentVars(slotEl, resolveAccent(state, team));
    slotEl.classList.toggle('ps-nochamp', noChamp);
  }
  applyHeroSrc(idx, champName, design, ps.format || 'full');

  // Team-logo watermark (only used in the no-champ wash; harmless otherwise).
  var heroLogo = $('ps-hero-logo-' + idx);
  if (heroLogo) {
    var teamLogo = (state.match && state.match[team] && state.match[team].logo) || '';
    if (noChamp && teamLogo) { heroLogo.src = teamLogo; }
    else { heroLogo.removeAttribute('src'); }
  }

  setTxt('ps-team-' + idx, (teamName || '').toUpperCase());
  setTxt('ps-handle-' + idx, (player && player.handle ? player.handle : '').toUpperCase());

  var roleEl = $('ps-role-' + idx);
  if (roleEl) roleEl.style.display = (noChamp || noRoles) ? 'none' : '';
  var roleIcon = $('ps-role-icon-' + idx);
  if (roleIcon) { if (ROLE_ICONS[role]) roleIcon.src = ROLE_ICONS[role]; else roleIcon.removeAttribute('src'); }
  setTxt('ps-role-label-' + idx, ROLE_LABELS[role] || '');
  setTxt('ps-rank-' + idx, rankText(player && player.rank));

  var champLine = $('ps-champ-line-' + idx);
  if (champLine) champLine.style.display = champName ? 'flex' : 'none';
  setTxt('ps-champ-name-' + idx, (champName || '').toUpperCase());

  var statsEl = $('ps-stats-' + idx);
  if (statsEl) {
    statsEl.innerHTML = stats.map(function (s) {
      return '<div class="ps-stat"><span class="ps-stat-val">' + s.val + '</span><span class="ps-stat-label">' + s.label + '</span></div>';
    }).join('');
  }
  setTxt('ps-caption-' + idx, (slot && slot.caption) || '');
}

// Which slots a stage shows.
function slotsForStage(stage) { return stage === 'b' ? [1] : stage === 'both' ? [0, 1] : [0]; }
function homeInClass(i)  { return i === 0 ? 'ps-anim-in-left'  : 'ps-anim-in-right'; }
function homeOutClass(i) { return i === 0 ? 'ps-anim-out-left' : 'ps-anim-out-right'; }
function clearAnim(el) {
  if (el) el.classList.remove('ps-anim-in-left', 'ps-anim-in-right', 'ps-anim-out-left', 'ps-anim-out-right', 'ps-keep');
}

function setStageClasses(root, stage, showVs) {
  ['a', 'b', 'both'].forEach(function (s) { root.classList.toggle('stage-' + s, stage === s); });
  root.classList.toggle('show-vs', showVs !== false);
  // Entering Both clears any lingering out-anim so a rapid Both→one→Both replays the in.
  if (stage === 'both') { var b = document.querySelector('.ps-vs-badge'); if (b) b.classList.remove('ps-vs-leaving'); }
}

// Build the centre head-to-head comparison from both players' stats (Both view).
// Rows are aligned by stat label: A value · LABEL · B value.
function populateCompare(state) {
  var el = $('ps-compare');
  if (!el) return;
  var ps = state.playerSpotlight || {};
  var s0 = (ps.players && ps.players[0]) || {}, s1 = (ps.players && ps.players[1]) || {};
  var p0 = resolveSlotPlayer(state, s0), p1 = resolveSlotPlayer(state, s1);
  var st0 = buildStats(p0, featuredChamp(p0, s0), s0, state);
  var st1 = buildStats(p1, featuredChamp(p1, s1), s1, state);
  var byLabel = function (arr, label) { var f = arr.find(function (s) { return s.label === label; }); return f ? f.val : '—'; };
  // Use the union of labels in order (both players have the same set from buildStats).
  var labels = st0.map(function (s) { return s.label; });
  st1.forEach(function (s) { if (labels.indexOf(s.label) < 0) labels.push(s.label); });
  el.innerHTML = labels.map(function (label) {
    return '<div class="ps-cmp-row"><span class="ps-cmp-a">' + byLabel(st0, label) +
      '</span><span class="ps-cmp-label">' + label + '</span><span class="ps-cmp-b">' + byLabel(st1, label) + '</span></div>';
  }).join('');
}

// Repopulate the visible slots, fingerprinted. In Both, also build the centre compare.
function renderStage(state, stage) {
  var slots = slotsForStage(stage);
  var ps = state.playerSpotlight || {};
  var fp = JSON.stringify([ps.design, ps.format, stage, slots.map(function (i) { return slotFp(state, i); })]);
  if (fp === _fp) return;
  _fp = fp;
  slots.forEach(function (i) { populateSlot(state, i); });
  if (stage === 'both') populateCompare(state);
}

socket.on('state', function (state) {
  _lastState = state;
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'playerSpotlight');

  var ps = state.playerSpotlight || {};
  var root = $('ps-root');
  var stage = ps.stage || 'a';
  var showVs = ps.showVs;

  // Format + design always reflect immediately (geometry only). Stage is owned by the
  // transition logic so it can keep a leaving slot on screen mid-slide.
  ['full', 'l3'].forEach(function (f) { root.classList.toggle('format-' + f, (ps.format || 'full') === f); });
  ['angled', 'bleed', 'framed', 'showcase'].forEach(function (d) { root.classList.toggle('design-' + d, (ps.design || 'showcase') === d); });

  var visible = !!ps.visible;
  if (visible && !_visible) {
    setStageClasses(root, stage, showVs);
    renderStage(state, stage);
    if (_outTimer) { clearTimeout(_outTimer); _outTimer = null; }
    _visible = true; _stageShown = stage;
    animateIn(stage);
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  } else if (visible && !_transitioning) {
    if (stage !== _stageShown) {
      transitionStage(state, _stageShown, stage);
    } else {
      setStageClasses(root, stage, showVs);   // picks up a showVs / design change
      renderStage(state, stage);
    }
  }
});

// Pull this-event tournament stats (used by the 'tournament' / 'both' stat sources).
// Re-fetched whenever the server signals a recompute. If the graphic is live, force a
// re-render so the new numbers land immediately.
function refreshTourStats() {
  fetch('/api/tournament-stats' + (_gfxToken ? '?token=' + encodeURIComponent(_gfxToken) : ''))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      _tourStats = data;
      if (_visible && _lastState && !_transitioning) { _fp = ''; renderStage(_lastState, _stageShown); }
    })
    .catch(function () {});
}
socket.on('stats:invalidated', refreshTourStats);
refreshTourStats();

// Show: slide each visible player in from their own side. Splashes pre-decoded while
// the root is still display:none so the slide never decode-janks.
function animateIn(stage) {
  var root = $('ps-root');
  var slots = slotsForStage(stage);
  var imgs = slots.map(function (i) { return $('ps-hero-img-' + i); }).filter(function (im) { return im && im.getAttribute('src'); });
  var reveal = function () { revealStage(root, slots); };
  if (imgs.length && imgs.some(function (im) { return !im.complete; })) {
    var started = false, go = function () { if (!started) { started = true; reveal(); } };
    Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : Promise.resolve(); })).then(go);
    setTimeout(go, 400);
    return;
  }
  reveal();
}

function revealStage(root, slots) {
  root.classList.remove('is-exiting');
  var cmp = $('ps-compare'); if (cmp) cmp.classList.remove('ps-cmp-leaving');   // clear any lingering out-state
  [0, 1].forEach(function (i) { clearAnim($('ps-slot-' + i)); });
  slots.forEach(function (i) { var el = $('ps-slot-' + i); if (el) el.classList.add(homeInClass(i)); });
  root.style.display = 'block';
  void root.offsetWidth;
}

// Fade the centre comparison out with the graphic (Both view only) — on a live hide the
// stage stays 'both', so the class-based opacity wouldn't move it; .ps-cmp-leaving forces it.
function compareOut() {
  var el = $('ps-compare');
  if (!el || _stageShown !== 'both') return;
  el.classList.add('ps-cmp-leaving');
  setTimeout(function () { el.classList.remove('ps-cmp-leaving'); }, Math.round(320 * _durScale()) + 80);
}

// Play the VS badge's out animation, but only if it's actually on screen right now.
// .ps-vs-leaving (display:flex + ps-vs-out, both !important) keeps it visible through the
// anim and overrides the stage-gated display:none; removed once the anim finishes.
function vsBadgeOut() {
  var b = document.querySelector('.ps-vs-badge');
  if (!b || getComputedStyle(b).display === 'none') return;
  b.classList.add('ps-vs-leaving');
  setTimeout(function () { b.classList.remove('ps-vs-leaving'); }, Math.round(300 * _durScale()) + 80);
}

function animateOut() {
  var root = $('ps-root');
  var slots = slotsForStage(_stageShown);
  vsBadgeOut();   // fade the VS badge out with the graphic (if it was showing)
  compareOut();   // fade the centre stat comparison out too (Both view)
  [0, 1].forEach(function (i) { clearAnim($('ps-slot-' + i)); });
  slots.forEach(function (i) { var el = $('ps-slot-' + i); if (el) el.classList.add(homeOutClass(i)); });
  var dur = 600 * _durScale();
  _outTimer = setTimeout(function () {
    root.style.display = 'none';
    [0, 1].forEach(function (i) { clearAnim($('ps-slot-' + i)); });
    _fp = ''; _transitioning = false; _outTimer = null;
  }, dur);
}

// Stage change while live. Only the players that actually change move: a leaving player
// slides out to their own side, an entering player slides in from theirs, a STAYING
// player isn't touched (its info/geometry are side-locked, so there's nothing to reflow
// and no reason to re-animate it). When it's a pure A↔B swap (nobody stays) the two are
// SEQUENCED — leaving fully exits before the other enters — so their portraits/scrims
// never overlap mid-slide.
function transitionStage(state, oldStage, newStage) {
  _transitioning = true;
  var root = $('ps-root');
  var ps = state.playerSpotlight || {};
  var oldSlots = slotsForStage(oldStage), newSlots = slotsForStage(newStage);
  var leaving  = oldSlots.filter(function (i) { return newSlots.indexOf(i) < 0; });
  var entering = newSlots.filter(function (i) { return oldSlots.indexOf(i) < 0; });
  var staying  = newSlots.filter(function (i) { return oldSlots.indexOf(i) >= 0; });
  var outDur = Math.round(340 * _durScale());
  var inDur  = Math.round(560 * _durScale());

  var finish = function () {
    [0, 1].forEach(function (i) { clearAnim($('ps-slot-' + i)); });
    _fp = ''; _stageShown = newStage; _transitioning = false;
  };
  // Slide the entering players in (pre-decoding any cold art first), then settle.
  var enter = function () {
    setStageClasses(root, newStage, ps.showVs);
    entering.forEach(function (i) { populateSlot(state, i); });
    if (newStage === 'both') populateCompare(state);
    var imgs = entering.map(function (i) { return $('ps-hero-img-' + i); }).filter(function (im) { return im && im.getAttribute('src'); });
    var run = function () { entering.forEach(function (i) { var el = $('ps-slot-' + i); if (el) { clearAnim(el); el.classList.add(homeInClass(i)); } }); };
    if (imgs.length && imgs.some(function (im) { return !im.complete; })) {
      var started = false, go = function () { if (!started) { started = true; run(); } };
      Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : Promise.resolve(); })).then(go);
      setTimeout(go, 350);
    } else { run(); }
    setTimeout(finish, inDur + 60);
  };

  if (staying.length === 0 && leaving.length && entering.length) {
    // Pure A↔B swap → sequence. Keep the OLD stage (leaving stays visible) while it
    // slides out, then flip + bring the other in. No overlap at any point.
    leaving.forEach(function (i) { var el = $('ps-slot-' + i); if (el) { clearAnim(el); el.classList.add(homeOutClass(i)); } });
    setTimeout(function () { leaving.forEach(function (i) { clearAnim($('ps-slot-' + i)); }); enter(); }, outDur + 40);
  } else {
    // A staying player (→Both / Both→one). Leaving slides out (kept visible during the
    // slide via .ps-keep); entering slides in; staying is left alone. They're in
    // different halves, so this runs concurrently without overlap.
    // Leaving the Both stage → animate the VS badge out BEFORE the stage class flips
    // (while it's still on screen), then flip.
    if (oldStage === 'both' && newStage !== 'both') vsBadgeOut();
    leaving.forEach(function (i) { var el = $('ps-slot-' + i); if (el) { clearAnim(el); el.classList.add('ps-keep', homeOutClass(i)); } });
    setStageClasses(root, newStage, ps.showVs);
    setTimeout(function () { leaving.forEach(function (i) { clearAnim($('ps-slot-' + i)); }); }, outDur + 40);
    enter();
  }
}
