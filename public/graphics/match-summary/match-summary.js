// Dota 2 Match Summary overlay — match-summary.js (Phase E2)
// Scoreboards + ranked net worth come from state.live.dota (socket); the net-worth-over-time
// graph polls /api/live/dota/timeline (samples + events) while the graphic is visible.
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null, _exitTimer = null, _enterTimer = null, _lastSig = '';
var _tl = { samples: [], events: [] }, _tlTimer = null, _msOpts = {};

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function fmtNw(n) { n = n | 0; return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function fmtClock(sec) {
  sec = sec | 0; var neg = sec < 0; sec = Math.abs(sec);
  return (neg ? '-' : '') + Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
}

// Roster display name by Steam ID (then name) — the GSI in-game name is never shown.
function dotaRosterName(state, teamKey, p) {
  var roster = ((state.players || {})[teamKey]) || [];
  var sid = String(p.steamid || '');
  if (sid) { var bySid = roster.filter(function (r) { return String(r.steamid || '') === sid; })[0]; if (bySid && bySid.handle) return bySid.handle; }
  var gn = norm(p.gsiName);
  if (gn) { var byName = roster.filter(function (r) { return norm(r.handle) === gn || norm(r.name) === gn; })[0]; if (byName && byName.handle) return byName.handle; }
  return '';   // no roster match → fall back to the hero name
}
function teamMeta(state, key) {
  var m = (state.match && state.match[key]) || {};
  return { name: m.name || m.tag || (key === 'team1' ? 'RADIANT' : 'DIRE'), logo: m.logo || '' };
}
function heroIconCss(p) {
  // Minimap icon layered over the portrait — the portrait shows through if the icon 404s.
  var icon = String(p.heroImg || '').replace('/heroes/', '/heroes/icons/');
  return 'background-image:url(' + esc(icon) + '),url(' + esc(p.heroImg || '') + ')';
}

// ── Team scoreboards ────────────────────────────────────────────────────────────
function itemsHtml(p) {
  var items = p.items || [];
  return '<span class="ms-items">' + items.map(function (it) {
    return '<span class="ms-item' + (it.neutral ? ' ms-item-neutral' : '') + '" title="' + esc(it.name) + '"' +
      (it.img ? ' style="background-image:url(' + esc(it.img) + ')"' : '') + '></span>';
  }).join('') + '</span>';
}
function rowHtml(state, teamKey, p) {
  var name = dotaRosterName(state, teamKey, p) || p.hero || '';
  return '<div class="ms-row">' +
    '<span class="ms-cell-hero">' +
      '<span class="ms-hero"' + (p.heroImg ? ' style="background-image:url(' + esc(p.heroImg) + ')"' : '') + '></span>' +
      ((p.level | 0) ? '<span class="ms-lvl">' + (p.level | 0) + '</span>' : '') +
    '</span>' +
    '<span class="ms-cell-name"><span class="ms-pname">' + esc(name) + '</span>' +
      (p.hero ? '<span class="ms-hero-sub">' + esc(p.hero) + '</span>' : '') + '</span>' +
    '<span class="ms-kda"><b>' + (p.kills | 0) + '</b>/' + (p.deaths | 0) + '/' + (p.assists | 0) + '</span>' +
    '<span class="ms-gpm">' + (p.gpm | 0) + '</span>' +
    itemsHtml(p) +
  '</div>';
}
function teamPanelHtml(state, key, players, isWinner) {
  var tm = teamMeta(state, key), showLogos = !(_msOpts.showLogos === false);
  var color = key === 'team1' ? 'var(--ms-rad-chrome)' : 'var(--ms-dire-chrome)';
  var head = '<div class="ms-t-head" style="--team-color:' + color + '">' +
    (showLogos && tm.logo ? '<div class="ms-t-logo" style="background-image:url(' + esc(tm.logo) + ')"></div>' : '') +
    '<span class="ms-t-name">' + esc(tm.name) + '</span>' +
    '<span class="ms-t-side">' + (key === 'team1' ? 'RADIANT' : 'DIRE') + '</span>' +
    (isWinner ? '<span class="ms-win-badge">WIN</span>' : '') +
  '</div>';
  var header = '<div class="ms-row ms-row-head" style="--team-color:' + color + '">' +
    '<span class="ms-cell-hero">Hero</span><span class="ms-cell-name">Player</span>' +
    '<span>K/D/A</span><span>GPM</span><span style="text-align:right">Items</span></div>';
  var rows = players.length ? players.map(function (p) { return rowHtml(state, key, p); }).join('')
    : '<div class="ms-empty">No live data</div>';
  return head + header + rows;
}

// ── Ranked net-worth column ──────────────────────────────────────────────────────
function nwColHtml(mp) {
  var all = [];
  (mp.team1 || []).forEach(function (p) { all.push({ p: p, t: 't1' }); });
  (mp.team2 || []).forEach(function (p) { all.push({ p: p, t: 't2' }); });
  all.sort(function (a, b) { return (b.p.netWorth | 0) - (a.p.netWorth | 0); });
  if (!all.length) return '<div class="ms-nw-head">NET WORTH</div><div class="ms-empty">No live data</div>';
  var max = Math.max(1, all[0].p.netWorth | 0);
  var rows = all.map(function (e) {
    var w = Math.max(3, Math.round((e.p.netWorth | 0) / max * 100));
    return '<div class="ms-nw-row ' + e.t + '">' +
      '<span class="ms-nw-hero" style="' + heroIconCss(e.p) + '"></span>' +
      '<span class="ms-nw-bar-wrap"><span class="ms-nw-bar" style="width:' + w + '%"></span></span>' +
      '<span class="ms-nw-val">' + fmtNw(e.p.netWorth) + '</span>' +
    '</div>';
  }).join('');
  return '<div class="ms-nw-head">NET WORTH</div><div class="ms-nw-list">' + rows + '</div>';
}

// ── Score · timer · distribution strip ───────────────────────────────────────────
function stripHtml(state, d, mp) {
  var t1 = teamMeta(state, 'team1'), t2 = teamMeta(state, 'team2');
  var sum = function (arr) { var s = 0; (arr || []).forEach(function (p) { s += p.netWorth | 0; }); return s; };
  var nw1 = sum(mp.team1), nw2 = sum(mp.team2), tot = nw1 + nw2;
  var pct1 = tot ? nw1 / tot * 100 : 50;
  var lead = nw1 - nw2;
  var leadTxt = !tot ? '—' : lead === 0 ? 'EVEN' :
    (lead > 0 ? (t1.name || 'RADIANT') : (t2.name || 'DIRE')) + ' +' + fmtNw(Math.abs(lead));
  var teamHtml = function (tm, kills, cls) {
    return '<div class="ms-s-team ' + cls + '">' +
      (tm.logo ? '<span class="ms-s-logo" style="background-image:url(' + esc(tm.logo) + ')"></span>' : '') +
      '<span class="ms-s-name">' + esc(tm.name) + '</span>' +
      '<span class="ms-s-kills">' + (kills | 0) + '</span>' +
    '</div>';
  };
  return teamHtml(t1, d.radiantScore, 'left') +
    '<span class="ms-s-clock">' + fmtClock(d.clockTime) + '</span>' +
    '<div id="ms-nwbar-zone">' +
      '<div id="ms-nwbar-labels">' +
        '<span class="ms-nwbar-val t1">' + fmtNw(nw1) + '</span>' +
        '<span id="ms-nwbar-lead">' + esc(leadTxt) + '</span>' +
        '<span class="ms-nwbar-val t2">' + fmtNw(nw2) + '</span>' +
      '</div>' +
      '<div id="ms-nwbar"><span class="seg-t1" style="width:' + pct1 + '%"></span><span class="seg-gap"></span><span class="seg-t2" style="flex:1"></span></div>' +
    '</div>' +
    teamHtml(t2, d.direScore, 'right');
}

// ── Net-worth-over-time graph (SVG) ──────────────────────────────────────────────
// Differential (Radiant − Dire) around a zero baseline: green area above (Radiant lead),
// red below (Dire lead) — position + side labels carry identity, not colour alone.
var MARKS = {
  roshan:    { opt: 'markRoshan',    label: 'ROSHAN',    glyph: 'R',  fill: '#f0cc44', ink: '#07120a' },
  tormentor: { opt: 'markTormentor', label: 'TORMENTOR', glyph: 'T',  fill: '#3ec8e8', ink: '#07120a' },
  tower:     { opt: 'markTower',     label: 'TOWER',     glyph: 'TW', fill: '',        ink: '#07120a' },
  barracks:  { opt: 'markBarracks',  label: 'BARRACKS',  glyph: 'RX', fill: '',        ink: '#07120a' },
  ancient:   { opt: 'markAncient',   label: 'ANCIENT',   glyph: 'GG', fill: '#ffffff', ink: '#07120a' },
  multikill: { opt: 'markMultikill', label: 'MULTIKILL', glyph: '',   fill: '',        ink: '#07120a' },
  teamfight: { opt: 'markTeamfight', label: 'TEAMFIGHT', glyph: 'TF', fill: '#c9d4e0', ink: '#07120a' },
};
var RAD = '#26aa5a', DIRE = '#e14b3d';   // validated chart pair (see match-summary.css)
// Building/multikill chips are coloured by the team the event FAVOURS: a destroyed
// building favours the destroyer (opposite of the owning `side`); a multikill favours
// the killer's own `team`.
function markFill(e) {
  var m = MARKS[e.type] || {};
  if (e.type === 'tower' || e.type === 'barracks' || e.type === 'ancient') {
    if (e.side === 'team1') return DIRE;
    if (e.side === 'team2') return RAD;
    return m.fill || '#c9d4e0';
  }
  if (e.type === 'multikill') return e.team === 'team2' ? DIRE : RAD;
  return m.fill || '#c9d4e0';
}
function markGlyph(e) {
  if (e.type === 'multikill') { var c = Math.min(5, Math.max(3, e.count | 0)); return c + 'K'; }
  return (MARKS[e.type] || {}).glyph || '?';
}
function enabledEvents() {
  // makeDefault always seeds every markX flag (deepMerge), so a plain truthy check works.
  return (_tl.events || []).filter(function (e) { var m = MARKS[e.type]; return m && !!_msOpts[m.opt]; });
}
function legendHtml() {
  // Side-coloured types (tower/rax/ancient/multikill) take either team colour per event, so
  // their legend chip stays neutral — the chip explains the GLYPH, the event carries the team.
  var SIDED = { tower: 1, barracks: 1, ancient: 1, multikill: 1 };
  var seen = {}, out = '';
  enabledEvents().forEach(function (e) {
    if (seen[e.type]) return; seen[e.type] = 1;
    var m = MARKS[e.type];
    var fill = SIDED[e.type] ? '#c9d4e0' : markFill(e);
    out += '<span class="ms-lg"><span class="chip" style="background:' + fill + '"></span>' + m.label + '</span>';
  });
  return out;
}
function niceCeil(v) {
  if (v <= 0) return 1000;
  var pow = Math.pow(10, Math.floor(Math.log10(v)));
  var n = v / pow;
  var f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return f * pow;
}
function renderGraph() {
  var box = $('ms-graph'); if (!box) return;
  var s = _tl.samples || [];
  if (s.length < 2) {
    box.innerHTML = '<div class="ms-graph-empty">WAITING FOR LIVE MATCH DATA</div>';
    $('ms-graph-legend').innerHTML = '';
    return;
  }
  var W = 1720, H = 270, L = 64, R = 20, T = 56, B = 24;   // svg space + margins (marker lanes live in T)
  var iw = W - L - R, ih = H - T - B;
  var t0 = s[0].t, t1 = s[s.length - 1].t, span = Math.max(1, t1 - t0);
  var maxAbs = 0;
  s.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs((p.rnw | 0) - (p.dnw | 0))); });
  var yMax = niceCeil(maxAbs * 1.1);
  var X = function (t) { return L + (t - t0) / span * iw; };
  var Y = function (v) { return T + ih / 2 - (v / yMax) * (ih / 2); };
  var zero = Y(0);

  var pts = s.map(function (p) { return [X(p.t), Y((p.rnw | 0) - (p.dnw | 0))]; });
  var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
  var area = line + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + zero + 'L' + pts[0][0].toFixed(1) + ' ' + zero + 'Z';

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
  svg += '<defs>' +
    '<clipPath id="ms-clip-up"><rect x="0" y="0" width="' + W + '" height="' + zero + '"/></clipPath>' +
    '<clipPath id="ms-clip-dn"><rect x="0" y="' + zero + '" width="' + W + '" height="' + (H - zero) + '"/></clipPath>' +
    '<linearGradient id="ms-fill-up" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + RAD + '" stop-opacity="0.42"/><stop offset="1" stop-color="' + RAD + '" stop-opacity="0.04"/></linearGradient>' +
    '<linearGradient id="ms-fill-dn" x1="0" y1="1" x2="0" y2="0">' +
      '<stop offset="0" stop-color="' + DIRE + '" stop-opacity="0.42"/><stop offset="1" stop-color="' + DIRE + '" stop-opacity="0.04"/></linearGradient>' +
    '<filter id="ms-glow" x="-20%" y="-40%" width="140%" height="180%">' +
      '<feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#9fd9ff" flood-opacity="0.35"/></filter>' +
  '</defs>';

  // Recessive horizontal grid at half + full amplitude, both sides; strong zero baseline.
  [-1, -0.5, 0.5, 1].forEach(function (f) {
    var y = Y(yMax * f);
    svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>';
    svg += '<text class="ms-axis-lbl" x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + (f > 0 ? '+' : '−') + fmtNw(yMax * Math.abs(f)) + '</text>';
  });
  svg += '<line x1="' + L + '" y1="' + zero + '" x2="' + (W - R) + '" y2="' + zero + '" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>';

  // Time ticks about every 5 minutes (snapped), formatted m:ss.
  var step = Math.max(300, Math.ceil(span / 6 / 300) * 300);
  for (var tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
    svg += '<line x1="' + X(tt) + '" y1="' + (H - B) + '" x2="' + X(tt) + '" y2="' + (H - B + 5) + '" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>';
    svg += '<text class="ms-axis-lbl" x="' + X(tt) + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtClock(tt) + '</text>';
  }

  // Lead shading (clipped to each side of zero) + the glowing differential line.
  svg += '<path d="' + area + '" fill="url(#ms-fill-up)" clip-path="url(#ms-clip-up)"/>';
  svg += '<path d="' + area + '" fill="url(#ms-fill-dn)" clip-path="url(#ms-clip-dn)"/>';
  svg += '<path d="' + line + '" fill="none" stroke="#e8f4ff" stroke-width="2.5" stroke-linejoin="round" filter="url(#ms-glow)"/>';

  // Side identity labels (position + text, not colour alone).
  svg += '<text class="ms-side-lbl" x="' + L + '" y="' + (T - 34) + '" fill="' + RAD + '">▲ RADIANT LEAD</text>';
  svg += '<text class="ms-side-lbl" x="' + L + '" y="' + (H - B - 8) + '" fill="' + DIRE + '">▼ DIRE LEAD</text>';

  // Event markers: subtle full-height stem + a chip in one of two lanes (alternate when
  // neighbours crowd) with a 2px surface ring so overlapping chips stay separable.
  var evs = enabledEvents().slice().sort(function (a, b) { return a.t - b.t; });
  var lastX = -1e9, lane = 0;
  evs.forEach(function (e) {
    var x = X(Math.min(t1, Math.max(t0, e.clock != null ? e.clock : e.t)));
    lane = (x - lastX < 30) ? 1 - lane : 0; lastX = x;
    var cy = 14 + lane * 26, fill = markFill(e), glyph = markGlyph(e);
    svg += '<line x1="' + x + '" y1="' + (cy + 11) + '" x2="' + x + '" y2="' + (H - B) + '" stroke="' + fill + '" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 3"/>';
    svg += '<circle cx="' + x + '" cy="' + cy + '" r="11" fill="' + fill + '" stroke="#070e16" stroke-width="2"/>';
    svg += '<text x="' + x + '" y="' + (cy + 3.5) + '" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="10.5" font-weight="800" fill="' + (MARKS[e.type] || {}).ink + '">' + glyph + '</text>';
  });

  svg += '</svg>';
  box.innerHTML = svg;
  $('ms-graph-legend').innerHTML = legendHtml();
}

// ── Timeline polling (only while visible) ────────────────────────────────────────
function fetchTimeline() {
  fetch('/api/live/dota/timeline?token=' + encodeURIComponent(_gfxToken))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j && j.samples) { _tl = j; renderGraph(); } })
    .catch(function () {});
}
function startTlPoll() { if (_tlTimer) return; fetchTimeline(); _tlTimer = setInterval(fetchTimeline, 5000); }
function stopTlPoll() { if (_tlTimer) { clearInterval(_tlTimer); _tlTimer = null; } }

// ── Render ──────────────────────────────────────────────────────────────────────
function renderAll(state) {
  var d = (state.live && state.live.dota) || {}, mp = d.matchPlayers || { team1: [], team2: [] };
  _msOpts = state.matchSummary || {};
  $('ms-title').textContent = _msOpts.title || 'MATCH SUMMARY';
  $('ms-team1').innerHTML = teamPanelHtml(state, 'team1', mp.team1 || [], d.winTeam === 'team1');
  $('ms-team2').innerHTML = teamPanelHtml(state, 'team2', mp.team2 || [], d.winTeam === 'team2');
  $('ms-nw-col').innerHTML = nwColHtml(mp);
  $('ms-strip').innerHTML = stripHtml(state, d, mp);
  renderGraph();
}
function contentSig(state) {
  var d = (state.live && state.live.dota) || {};
  return JSON.stringify([d.winTeam, d.radiantScore, d.direScore, d.clockTime, d.matchPlayers,
    state.matchSummary, (state.match && state.match.team1 && state.match.team1.name),
    (state.match && state.match.team2 && state.match.team2.name)]);
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('ms-root'); if (!root) return;
  if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null; }
  root.classList.remove('ms-exiting');
  root.style.display = '';
  void root.offsetWidth;
  root.classList.add('ms-entering');
  _enterTimer = setTimeout(function () { root.classList.remove('ms-entering'); _enterTimer = null; }, 1800);
}
function animateOut() {
  var root = $('ms-root'); if (!root) return;
  if (_enterTimer) { clearTimeout(_enterTimer); root.classList.remove('ms-entering'); _enterTimer = null; }
  root.classList.add('ms-exiting');
  _exitTimer = setTimeout(function () { root.classList.remove('ms-exiting'); root.style.display = 'none'; _exitTimer = null; }, 700);
}

// Solid dark backing (fullscreen scene) or transparent overlay.
function getEffectiveBgState(state) {
  var ms = state.matchSummary || {}, dark = ms.bg !== 'transparent';
  var ov = Object.assign({}, state.settings || {}, {
    bgType: dark ? 'color' : 'transparent', bgColor: dark ? '#070e16' : '', bgImage: '', bgAnimation: '', bgFogLayer: false,
  });
  return Object.assign({}, state, { settings: ov });
}

socket.on('state', function (state) {
  var root = $('ms-root');
  var ms = state.matchSummary || {};
  var visible = !!ms.visible;

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'matchSummary');
  GfxSettings.applyBackground(root, getEffectiveBgState(state));

  if (visible !== _lastVisible) {
    if (visible) { renderAll(state); _lastSig = contentSig(state); animateIn(); startTlPoll(); }
    else if (_lastVisible !== null) { animateOut(); stopTlPoll(); }
    _lastVisible = visible;
    return;
  }
  if (!visible) return;
  var sig = contentSig(state);
  if (sig !== _lastSig) { _lastSig = sig; renderAll(state); }
});
