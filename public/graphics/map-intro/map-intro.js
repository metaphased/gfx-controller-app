// Map Intro overlay — map-intro.js
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _lastVisible = null, _exitTimer = null, _enterTimer = null;

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
// Candidate screenshot variants for a map (base + _1.._5). Missing ones 404 → dropped on load
// error. Mirrors map-veto's flyby set; used by the optional map-intro slideshow.
function mapThumbVariants(name, w) {
  var s = mapSlug(name); if (!s) return []; w = w || 1920;
  var out = ['/api/mapart?slug=' + s + '&kind=thumb&w=' + w + ART_TOK + artRev()];
  for (var i = 1; i <= 5; i++) out.push('/api/mapart?slug=' + s + '&kind=thumb&v=' + i + '&w=' + w + ART_TOK + artRev());
  return out;
}
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

// ── Map art + optional flyby slideshow ───────────────────────────────────────────
// flyby on → cycle the map's screenshot set (base + _1.._5), crossfading opacity between
// two stacked <img> layers; the FIRST image is random so the card opens differently each
// time. flyby off, or a per-map custom pool image, shows a single still.
var MI_FLYBY_MS = 5000;
var _fly = { timer: null, urls: [], idx: 0, curA: true, key: '' };
function miStopFlyby() { if (_fly.timer) { clearTimeout(_fly.timer); _fly.timer = null; } }
function miClearArt() {
  miStopFlyby(); _fly.key = ''; _fly.urls = [];
  ['mi-art-a', 'mi-art-b'].forEach(function (id) { var im = $(id); if (im) { im.classList.remove('on'); im.onload = null; im.onerror = null; im.removeAttribute('src'); } });
  $('mi-root').classList.add('mi-noart');
}
function miSchedule() {
  miStopFlyby();
  if (_fly.urls.length <= 1) return;                 // nothing to cycle to
  _fly.timer = setTimeout(function () {
    var a = $('mi-art-a'), b = $('mi-art-b'); if (!a || !b || _fly.urls.length <= 1) return;
    _fly.idx = (_fly.idx + 1) % _fly.urls.length;
    var show = _fly.curA ? b : a, hide = _fly.curA ? a : b;
    // Fade incoming IN on top; drop the outgoing only after the fade (no bleed-through dip).
    show.style.zIndex = '2'; hide.style.zIndex = '1';
    show.onload = function () { show.classList.add('on'); setTimeout(function () { hide.classList.remove('on'); }, 1150); };
    show.src = _fly.urls[_fly.idx];
    _fly.curA = !_fly.curA;
    miSchedule();
  }, MI_FLYBY_MS);
}
function miRenderArt(state, row) {
  var mi = state.mapIntro || {};
  var name = row.map;
  var entry = poolEntry(state, name);
  var custom = (entry && entry.image) ? entry.image : '';
  var key = name + '|' + (mi.flyby ? 'fly' : 'one') + '|' + (custom ? 'c' : '') + '|' + _artRev;
  if (key === _fly.key) return;                       // unchanged → leave current still / slideshow running
  _fly.key = key;
  miStopFlyby();
  var a = $('mi-art-a'), b = $('mi-art-b'); if (!a || !b) return;
  b.classList.remove('on'); b.onload = null; b.onerror = null; b.removeAttribute('src');
  _fly.curA = true; _fly.idx = 0; _fly.urls = [];

  // Single still: flyby off, or a per-map custom image (no variant set to cycle).
  if (!mi.flyby || custom) {
    var single = custom || mapThumbUrl(name, 1920);
    $('mi-root').classList.toggle('mi-noart', !single);
    a.onerror = null;
    if (single) { a.src = single; a.classList.add('on'); } else { a.classList.remove('on'); a.removeAttribute('src'); }
    return;
  }

  // Flyby slideshow — random starting image, then crossfade every MI_FLYBY_MS.
  var cand = mapThumbVariants(name, 1920);
  if (!cand.length) { $('mi-root').classList.add('mi-noart'); return; }
  $('mi-root').classList.remove('mi-noart');
  var base = cand[0], startIdx = Math.floor(Math.random() * cand.length);
  a.onerror = function () { if (a.src.indexOf(base) < 0) a.src = base; };   // missing variant → base
  a.src = cand[startIdx]; a.classList.add('on');
  var pend = cand.length;
  function settle() {                                  // index the cycle at whatever ended up on screen
    var shown = (_fly.urls.indexOf(cand[startIdx]) >= 0) ? cand[startIdx] : base;
    _fly.idx = Math.max(0, _fly.urls.indexOf(shown));
    miSchedule();
  }
  cand.forEach(function (u) {
    var im = new Image();
    im.onload = function () { if (_fly.urls.indexOf(u) < 0) _fly.urls.push(u); if (--pend === 0) settle(); };
    im.onerror = function () { if (--pend === 0) settle(); };
    im.src = u;
  });
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
    miClearArt(); $('mi-lineups').innerHTML = '';
    return;
  }

  // Map art backdrop — single still or, if enabled, the crossfading flyby slideshow.
  miRenderArt(state, row);

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
    if (visible) { _fly.key = ''; renderAll(state); animateIn(); }   // re-randomize the flyby start each show
    else if (_lastVisible !== null) { animateOut(); miStopFlyby(); }
    _lastVisible = visible;
    return;
  }
  if (!visible) return;
  renderAll(state);
});
