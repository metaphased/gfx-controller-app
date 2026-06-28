// Post-Game Scoreboard overlay — post-game.js
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null, _exitTimer = null, _enterTimer = null, _lastSig = '';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// ── Data resolution ─────────────────────────────────────────────────────────────
function currentSeriesKey(state) {
  var m = state.match || {};
  if (m.scheduleGameId) return 'sg:' + m.scheduleGameId;
  var n = function (x) { return String(x || '').toLowerCase().trim(); };
  return 'tm:' + [n((m.team1 || {}).name), n((m.team2 || {}).name)].sort().join('__');
}
// Finalized/scored maps of the current series, in order.
function finalizedRows(state) {
  return ((state.match && state.match.mapResults) || []).filter(function (r) {
    return r && r.map && (r.status === 'final' || r.winner || r.t1Rounds || r.t2Rounds);
  });
}
// The map row to display: postGame.selectedSlug (normalized map name) else the latest.
function resolveRow(state) {
  var rows = finalizedRows(state); if (!rows.length) return null;
  var sel = (state.postGame && state.postGame.selectedSlug) || '';
  if (sel) { var hit = rows.filter(function (r) { return norm(r.map) === sel; })[0]; if (hit) return hit; }
  return rows[rows.length - 1];
}
// Per-team player stat lines for a map, from the accumulated csStats (one line/player/map).
function playersForRow(state, row) {
  var sk = currentSeriesKey(state), mapN = norm(row.map);
  var lines = ((state.tournament && state.tournament.csStats) || []).filter(function (l) {
    return l.seriesKey === sk && norm(l.map) === mapN;
  });
  var by = { team1: [], team2: [] };
  lines.forEach(function (l) { (by[l.team] || by.team1).push(l); });
  var sortK = function (a, b) { return (b.kills | 0) - (a.kills | 0) || (a.deaths | 0) - (b.deaths | 0); };
  by.team1.sort(sortK); by.team2.sort(sortK);
  return by;
}
// Which team won round r, given the round's winning side and the team that started CT.
// CS2 MR12: regulation swaps after round 12; OT is MR3 (swap every 3) — best-effort.
function roundTeam(r, ctStartTeam, side) {
  var ct = ctStartTeam === 'team2' ? 'team2' : 'team1', t = ct === 'team1' ? 'team2' : 'team1';
  var swapped = r <= 24 ? r > 12 : (Math.floor((r - 25) / 3) % 2 === 0 ? false : true);
  var roundCt = swapped ? t : ct, roundT = swapped ? ct : t;
  return side === 'CT' ? roundCt : roundT;
}

// ── Render ──────────────────────────────────────────────────────────────────────
// Only two win conditions get an icon: bomb-plant (explosion) and defuse (cutters).
// Elimination / time-out rounds show just the team logo.
var SVG_BOMB = '<svg class="pg-rc-cond pg-cond-bomb" viewBox="0 0 24 24"><polygon points="12,0.5 13.7,7.8 20.1,3.9 16.2,10.3 23.5,12 16.2,13.7 20.1,20.1 13.7,16.2 12,23.5 10.3,16.2 3.9,20.1 7.8,13.7 0.5,12 7.8,10.3 3.9,3.9 10.3,7.8"/></svg>';
var SVG_DEFUSE = '<svg class="pg-rc-cond pg-cond-defuse" viewBox="0 0 24 24"><path d="M9.64 7.64A4 4 0 1 0 7.5 9.78L10 12l-2.5 2.5A4 4 0 1 0 8.91 15.9L12 12.83l6.5 6.5H21v-1L9.64 7.64ZM6 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/><path d="M19 3l-5.5 5.5 1.4 1.4L21 4V3z"/></svg>';
function condIcon(cond) { return cond === 'bomb' ? SVG_BOMB : cond === 'defuse' ? SVG_DEFUSE : ''; }

function teamMeta(state, key) {
  var m = (state.match && state.match[key]) || {};
  return { name: m.name || m.tag || (key === 'team1' ? 'Team 1' : 'Team 2'), tag: m.tag || '', logo: m.logo || '',
    color: key === 'team1' ? 'var(--gfx-blue)' : 'var(--gfx-red)' };
}

function statRowHtml(l) {
  var kills = l.kills | 0, deaths = l.deaths | 0, plus = kills - deaths;
  var kd = (kills / Math.max(1, deaths)).toFixed(2);
  var diff = (plus > 0 ? '+' : '') + plus;
  var badges = '';
  if (l.k5) badges += '<span class="pg-mk pg-mk-ace">ACE</span>';
  if (l.k4) badges += '<span class="pg-mk">4K</span>';
  if (l.k3) badges += '<span class="pg-mk">3K</span>';
  var star = (l.mvps | 0) ? '<span class="pg-mvp" title="' + (l.mvps | 0) + ' MVP">★</span>' : '';
  return '<div class="pg-row">' +
    '<span class="pg-pname">' + esc(l.name || '?') + star + badges + '</span>' +
    '<span class="pg-stat pg-k">' + kills + '</span>' +
    '<span class="pg-stat pg-d">' + deaths + '</span>' +
    '<span class="pg-stat pg-a">' + (l.assists | 0) + '</span>' +
    '<span class="pg-stat pg-diff ' + (plus > 0 ? 'pos' : plus < 0 ? 'neg' : '') + '">' + diff + '</span>' +
    '<span class="pg-stat pg-adr">' + (l.adr | 0) + '</span>' +
    '<span class="pg-stat pg-kd">' + kd + '</span>' +
  '</div>';
}

function colHtml(state, key, lines, isWinner) {
  var tm = teamMeta(state, key), showLogos = !(state.postGame && state.postGame.showLogos === false);
  var head = '<div class="pg-col-head" style="--team-color:' + tm.color + '">' +
    (showLogos && tm.logo ? '<div class="pg-col-logo" style="background-image:url(' + esc(tm.logo) + ')"></div>' : '') +
    '<span class="pg-col-name">' + esc(tm.name) + '</span>' +
    (isWinner ? '<span class="pg-win-badge">WIN</span>' : '') +
  '</div>';
  var header = '<div class="pg-row pg-row-head">' +
    '<span class="pg-pname">Player</span>' +
    '<span class="pg-stat">K</span><span class="pg-stat">D</span><span class="pg-stat">A</span>' +
    '<span class="pg-stat">+/-</span><span class="pg-stat">ADR</span><span class="pg-stat">K/D</span>' +
  '</div>';
  var rows = lines.length ? lines.map(statRowHtml).join('') : '<div class="pg-empty">No stats</div>';
  return '<div class="pg-col-inner' + (isWinner ? ' pg-winner' : '') + '" style="--team-color:' + tm.color + '">' + head + header + rows + '</div>';
}

function roundsHtml(state, row) {
  if (!(state.postGame && state.postGame.showRounds !== false)) return '';
  var hist = row.roundHistory || [];
  if (!hist.length) return '';
  var ctStart = row.ctStartTeam || '';
  var logos = { team1: teamMeta(state, 'team1').logo, team2: teamMeta(state, 'team2').logo };
  // Cell COLOUR = the side that won the round (CT vs T); the LOGO = the team that won.
  // Sides swap at half, so a team's logo appears on both colours — showing the swap.
  var cells = hist.map(function (h) {
    var side = h.side === 'CT' ? 'ct' : 't';
    var team = roundTeam(h.r, ctStart, h.side);
    var div = (h.r === 13) ? ' pg-rc-half' : '';   // halftime divider before round 13
    var logo = logos[team];
    var inner = logo ? '<span class="pg-rc-logo" style="background-image:url(' + esc(logo) + ')"></span>' : '';
    return '<span class="pg-rc pg-rc-' + side + div + '" title="Round ' + h.r + ' · ' + h.side + '">' +
      inner + condIcon(h.cond) + '</span>';
  }).join('');
  return '<div class="pg-rounds-inner">' + cells + '</div>';
}

function renderAll(state) {
  var row = resolveRow(state);
  var pg = state.postGame || {};
  $('pg-title').textContent = pg.title || 'POST-GAME';
  if (!row) {
    $('pg-map').textContent = '';
    $('pg-h-score').textContent = '';
    $('pg-h-t1').textContent = ''; $('pg-h-t2').textContent = '';
    $('pg-rounds').innerHTML = '';
    $('pg-col-t1').innerHTML = '<div class="pg-empty">No completed map selected</div>';
    $('pg-col-t2').innerHTML = '';
    return;
  }
  var t1 = teamMeta(state, 'team1'), t2 = teamMeta(state, 'team2');
  var by = playersForRow(state, row);
  $('pg-map').textContent = row.map || '';
  $('pg-h-t1').textContent = t1.name;
  $('pg-h-t2').textContent = t2.name;
  $('pg-h-t1').className = 'pg-h-team' + (row.winner === 'team1' ? ' pg-h-win' : '');
  $('pg-h-t2').className = 'pg-h-team' + (row.winner === 'team2' ? ' pg-h-win' : '');
  $('pg-h-score').innerHTML = '<b class="' + (row.winner === 'team1' ? 'pg-sc-win' : '') + '">' + (row.t1Rounds | 0) + '</b>' +
    '<span class="pg-sc-sep">:</span><b class="' + (row.winner === 'team2' ? 'pg-sc-win' : '') + '">' + (row.t2Rounds | 0) + '</b>';
  $('pg-rounds').innerHTML = roundsHtml(state, row);
  $('pg-col-t1').innerHTML = colHtml(state, 'team1', by.team1, row.winner === 'team1');
  $('pg-col-t2').innerHTML = colHtml(state, 'team2', by.team2, row.winner === 'team2');
}

// A signature so we only re-render the inner content (not re-fire the entrance) when data changes.
function contentSig(state) {
  var row = resolveRow(state);
  return JSON.stringify([row && row.map, row && row.t1Rounds, row && row.t2Rounds, row && row.winner,
    row && (row.roundHistory || []).length, (state.postGame || {}).showRounds, (state.postGame || {}).showLogos,
    (state.tournament && state.tournament.csStats || []).length]);
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('pg-root'); if (!root) return;
  if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null; }
  root.classList.remove('pg-exiting');
  root.style.display = '';
  void root.offsetWidth;
  root.classList.add('pg-entering');
  _enterTimer = setTimeout(function () { root.classList.remove('pg-entering'); _enterTimer = null; }, 1600);
}
function animateOut() {
  var root = $('pg-root'); if (!root) return;
  if (_enterTimer) { clearTimeout(_enterTimer); root.classList.remove('pg-entering'); _enterTimer = null; }
  root.classList.add('pg-exiting');
  _exitTimer = setTimeout(function () { root.classList.remove('pg-exiting'); root.style.display = 'none'; _exitTimer = null; }, 700);
}

// Solid dark backing (post-game is a fullscreen scene) or transparent overlay.
function getEffectiveBgState(state) {
  var pg = state.postGame || {}, dark = pg.bg !== 'transparent';
  var ov = Object.assign({}, state.settings || {}, {
    bgType: dark ? 'color' : 'transparent', bgColor: dark ? '#070e16' : '', bgImage: '', bgAnimation: '', bgFogLayer: false,
  });
  return Object.assign({}, state, { settings: ov });
}

socket.on('state', function (state) {
  var root = $('pg-root');
  var pg = state.postGame || {};
  var visible = !!pg.visible;

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'postGame');
  GfxSettings.applyBackground(root, getEffectiveBgState(state));

  if (visible !== _lastVisible) {
    if (visible) { renderAll(state); _lastSig = contentSig(state); animateIn(); }
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
    return;
  }
  if (!visible) return;
  var sig = contentSig(state);
  if (sig !== _lastSig) { _lastSig = sig; renderAll(state); }
  else renderAll(state); // cheap; keeps theme/name edits live
});
