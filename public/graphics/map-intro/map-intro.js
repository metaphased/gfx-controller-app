// Map Intro overlay — map-intro.js
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null, _exitTimer = null, _enterTimer = null, _lastArtUrl = '';

function $(id) { return document.getElementById(id); }
function setTxt(id, v) { var e = $(id); if (e) e.textContent = v; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// ── Map art (reuses the /api/mapart resize proxy, mirroring map-veto.js) ─────────
var ART_TOK = _gfxToken ? ('&token=' + encodeURIComponent(_gfxToken)) : '';
var _artRev = 0;
function artRev() { return _artRev ? ('&rev=' + _artRev) : ''; }
function mapSlug(name) {
  var k = (name || '').toLowerCase().trim(); if (!k) return '';
  if (/^(de|cs|ar|dz)_/.test(k)) return k;
  k = k.replace(/[^a-z0-9]/g, '');
  if (k === 'dustii' || k === 'dust' || k === 'dust2') return 'de_dust2';
  return k ? ('de_' + k) : '';
}
function mapThumbUrl(name, w) { var s = mapSlug(name); return s ? ('/api/mapart?slug=' + s + '&kind=thumb&w=' + (w || 1920) + ART_TOK + artRev()) : ''; }
function poolEntry(state, name) {
  var pool = (state.tournament && state.tournament.mapPool) || [], n = norm(name);
  for (var i = 0; i < pool.length; i++) { var p = pool[i]; if (p && norm(typeof p === 'string' ? p : p.name) === n) return (typeof p === 'string' ? { name: p } : p); }
  return null;
}
function mapImage(state, name) { var e = poolEntry(state, name); return (e && e.image) ? e.image : mapThumbUrl(name, 1920); }

// ── Data resolution ─────────────────────────────────────────────────────────────
function teamMeta(state, key) {
  var m = (state.match && state.match[key]) || {};
  return { name: m.name || m.tag || (key === 'team1' ? 'Team 1' : 'Team 2'), tag: m.tag || '', logo: m.logo || '',
    color: key === 'team1' ? 'var(--gfx-blue)' : 'var(--gfx-red)' };
}
// The map to introduce: the selected one, else the first non-final (upcoming) row, else the last.
function resolveRow(state) {
  var rows = ((state.match && state.match.mapResults) || []).filter(function (r) { return r && r.map; });
  if (!rows.length) return null;
  var sel = (state.mapIntro && state.mapIntro.selectedSlug) || '';
  if (sel) { var hit = rows.filter(function (r) { return norm(r.map) === sel; })[0]; if (hit) return hit; }
  var next = rows.filter(function (r) { return r.status !== 'final' && !r.winner; })[0];
  return next || rows[rows.length - 1];
}
function mapNumber(state, row) {
  var rows = ((state.match && state.match.mapResults) || []).filter(function (r) { return r && r.map; });
  var i = rows.indexOf(row);
  return i >= 0 ? i + 1 : 1;
}
// Veto story: who picked the map + which team starts CT. The pick step's `side` is the OTHER
// (non-picking) team's start side, so CT-start = side==='CT' ? other : picker.
function vetoStory(state, mapName) {
  var steps = (state.mapVeto && state.mapVeto.steps) || [], n = norm(mapName);
  var pick = null, decider = null;
  steps.forEach(function (s) { if (!s || norm(s.map) !== n) return; if (s.action === 'pick') pick = s; if (s.action === 'decider') decider = s; });
  if (decider) return { picker: '', sideTxt: 'Decider · Knife round' };
  if (!pick || !pick.team) return null;
  var picker = teamMeta(state, pick.team).name;
  var other = pick.team === 'team1' ? 'team2' : 'team1';
  var ctTeam = pick.side === 'CT' ? other : pick.side === 'T' ? pick.team : '';
  return { picker: picker, sideTxt: ctTeam ? (teamMeta(state, ctTeam).name + ' CT start') : '' };
}

// ── Render ──────────────────────────────────────────────────────────────────────
function setBg(id, url) { var e = $(id); if (e) e.style.backgroundImage = url ? "url('" + String(url).replace(/'/g, "%27") + "')" : ''; }

function renderAll(state) {
  var mi = state.mapIntro || {};
  _artRev = (state.settings && state.settings.mapArtRev) || 0;
  var row = resolveRow(state);
  var t1 = teamMeta(state, 'team1'), t2 = teamMeta(state, 'team2');

  if (!row) {
    setTxt('mi-map', mi.title || ''); setTxt('mi-meta', ''); $('mi-veto').textContent = '';
    setBg('mi-art', ''); $('mi-lineups').innerHTML = '';
    return;
  }

  // Map art backdrop (decode-swap to avoid flashes is overkill here — single image).
  var art = mapImage(state, row.map);
  if (art !== _lastArtUrl) { _lastArtUrl = art; setBg('mi-art', art); }
  $('mi-root').classList.toggle('mi-noart', !art);

  setTxt('mi-map', (mi.title && mi.title.trim()) || row.map || '');
  var fmt = (state.match && state.match.format) || 'Bo3';
  var n = mapNumber(state, row), s1 = (t1 && state.match.team1.score) | 0, s2 = (state.match.team2 && state.match.team2.score) | 0;
  setTxt('mi-meta', 'MAP ' + n + ' · ' + fmt + ' · ' + s1 + '–' + s2);

  setBg('mi-t1-logo', t1.logo); setBg('mi-t2-logo', t2.logo);
  $('mi-t1-logo').classList.toggle('mi-nologo', !t1.logo);
  $('mi-t2-logo').classList.toggle('mi-nologo', !t2.logo);
  setTxt('mi-t1-name', t1.name); setTxt('mi-t2-name', t2.name);
  $('mi-t1-name').style.setProperty('--team-color', t1.color);
  $('mi-t2-name').style.setProperty('--team-color', t2.color);

  var vs = vetoStory(state, row.map);
  var vEl = $('mi-veto');
  if (vs) {
    vEl.style.display = '';
    vEl.innerHTML = (vs.picker ? '<span class="mi-veto-pick">Picked by ' + esc(vs.picker) + '</span>' : '') +
      (vs.picker && vs.sideTxt ? '<span class="mi-veto-sep">·</span>' : '') +
      (vs.sideTxt ? '<span class="mi-veto-side">' + esc(vs.sideTxt) + '</span>' : '');
  } else { vEl.style.display = 'none'; vEl.innerHTML = ''; }

  // Optional lineups (5-man rosters).
  var lu = $('mi-lineups');
  if (mi.showLineups) {
    var players = state.players || {};
    var colHtml = function (key, side) {
      var ps = (players[key] || []).filter(function (p) { return p && (p.handle || p.name); }).slice(0, 5);
      var rows = ps.map(function (p) { return '<div class="mi-lp">' + esc(p.handle || p.name) + '</div>'; }).join('');
      return '<div class="mi-lu-col mi-lu-' + side + '" style="--team-color:' + (key === 'team1' ? 'var(--gfx-blue)' : 'var(--gfx-red)') + '">' + rows + '</div>';
    };
    lu.innerHTML = colHtml('team1', 'l') + '<div class="mi-lu-gap"></div>' + colHtml('team2', 'r');
    lu.style.display = '';
  } else { lu.style.display = 'none'; lu.innerHTML = ''; }
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('mi-root'); if (!root) return;
  if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null; }
  root.classList.remove('mi-exiting');
  root.style.display = '';
  void root.offsetWidth;
  root.classList.add('mi-entering');
  _enterTimer = setTimeout(function () { root.classList.remove('mi-entering'); _enterTimer = null; }, 1600);
}
function animateOut() {
  var root = $('mi-root'); if (!root) return;
  if (_enterTimer) { clearTimeout(_enterTimer); root.classList.remove('mi-entering'); _enterTimer = null; }
  root.classList.add('mi-exiting');
  _exitTimer = setTimeout(function () { root.classList.remove('mi-exiting'); root.style.display = 'none'; _exitTimer = null; }, 700);
}

socket.on('state', function (state) {
  var mi = state.mapIntro || {};
  var visible = !!mi.visible;
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'mapIntro');

  // Animation variant: 'cinematic' (default rise/fade) | 'impact' (punchier in/out).
  var root = $('mi-root');
  if (root) {
    var impact = (mi.animVariant || 'cinematic') === 'impact';
    root.classList.toggle('mi-anim-impact', impact);
  }

  if (visible !== _lastVisible) {
    if (visible) { renderAll(state); animateIn(); }
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
    return;
  }
  if (!visible) return;
  renderAll(state);
});
