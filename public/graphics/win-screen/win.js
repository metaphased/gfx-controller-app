const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _visible = false;
let _style   = 'blade';
let _outTimer = null;
let _accentHex = '#1ffaff'; // win accent = palette Primary (real hex; setWinColor derives rgba)

// Base hold times (ms) at the default animation speed (--gfx-dur-scale = 1).
// Each `in` must be ≥ the longest CSS entrance animation for that style, or
// removing `is-entering` interrupts an in-flight animation and the element
// snaps back to its base state. These are scaled by the live dur-scale below
// so the animation-speed setting keeps JS and CSS in sync.
const ANIM_MS = {
  blade:     { in: 900,  out: 700  },
  burst:     { in: 1350, out: 700  },  // outer ring ends at 0.62s+0.7s = 1320ms
  slam:      { in: 1000, out: 750  },
  split:     { in: 1150, out: 900  },
  spotlight: { in: 1350, out: 750  },
  wipe:      { in: 1200, out: 650  },  // streak ends at 0.42s+0.75s = 1170ms
  // Full-screen "stinger" styles — opaque cover, manual show/hide.
  shutter:   { in: 1000, out: 700  },
  flood:     { in: 1000, out: 700  },
  slab:      { in: 1000, out: 700  },
  // COMP — winning team's champion picks as the hero (shutter cover in → bg
  // cross-fade → header from top → champions rise from bottom; split exit).
  comp:      { in: 1650, out: 850  },
};

// Styles whose card is centred with room below — the only ones the showPicks
// toggle can layer the compact champ row onto. (COMP shows the comp natively.)
const CENTERED_STYLES = ['burst', 'slam', 'spotlight', 'shutter', 'flood', 'slab'];

// Current animation-speed multiplier the overlay CSS uses (set by
// GfxSettings.applyAnimation). 0 = instant / reduced-motion. NaN-safe → 1.
function _durScale() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gfx-dur-scale'));
  return isNaN(v) ? 1 : v;
}

// ── Winning-team champion picks ──────────────────────────────────────────────
// Strip path + extension + Riot _N suffix → champion name (mirrors h2h.js).
function champNameFromUrl(url) {
  if (!url) return '';
  return url.split('/').pop().replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
}
function champSplash(name) { return name ? '/graphics/head2head/champions/' + name + '_0.jpg' : ''; }

// VALORANT agents — one manually-set agent per winning player → full-body portrait art.
function agentSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// Tight full-body crop (transparent margins trimmed) so the win-screen showcase can show the
// whole agent with object-fit:contain and never clip a wide pose. Falls back handled in CSS.
function agentPortrait(name) { var s = agentSlug(name); return s ? '/agents/full/' + s + '.webp' : ''; }
function isValorantGame(state) { var a = state && state.adapter; return a ? a.assetSource === 'valorant' : ((state && state.match && state.match.game) === 'valorant'); }

const _COMP_ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'];
function _normRole(r) { r = (r || '').toLowerCase().trim(); return r === 'adc' ? 'bot' : r; }

// The most recent game the win-screen's team actually WON (skips byes), so the
// comp shown is always a game they won — not a side-swapped or lost game. The
// server wipes state.draft after each game, so picks must come from seriesGames.
function winningCompGame(ws, match) {
  const winner = ws.team || 'team1';
  const games = (match && match.seriesGames) || [];
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i] && games[i].winner === winner && !games[i].isBye) return games[i];
  }
  return null;
}

// Whether the champ row should be present for the current style + settings.
function _wantCompRow(ws) {
  return _style === 'comp' || (!!ws.showPicks && CENTERED_STYLES.indexOf(_style) !== -1);
}

// Toggle the root classes that show / position the compact champ-pick layer on
// the eligible centred styles (COMP shows it via its own .style-comp rule), plus
// the angled-mask shape toggle.
function applyPicksClasses(root, ws) {
  const layerOn = !!ws.showPicks && CENTERED_STYLES.indexOf(_style) !== -1;
  root.classList.toggle('picks-on', layerOn);
  const bottom = layerOn && ws.picksPosition === 'bottom';
  root.classList.toggle('picks-pos-bottom', bottom);
  root.classList.toggle('picks-pos-below', layerOn && !bottom);
  root.classList.toggle('shape-angled', ws.compShape === 'angled');
}

// 'Below' the card is a moving target: the card's height varies with logo, score
// row and message, and the Dota hero row is shorter than the LoL portraits — the
// old fixed 63vh top overlapped the card text for both games. Every centred style
// rests the card at top:50% / translate(-50%,-50%), so its resting bottom is
// H/2 + offsetHeight/2 — offset metrics ignore the entrance transforms, so this
// is stable even while the card is still animating in.
function positionPicksRow() {
  const root = document.getElementById('win-root');
  const row  = document.getElementById('ws-comp-row');
  const card = document.getElementById('ws-card');
  if (!root || !row || !card) return;
  if (!root.classList.contains('picks-on') || !root.classList.contains('picks-pos-below')) {
    row.style.top = '';                      // bottom mode / comp use the CSS rules
    return;
  }
  const H = window.innerHeight, vh = H / 100;
  const restingBottom = H / 2 + card.offsetHeight / 2;
  let top = Math.max(63 * vh, restingBottom + 2.5 * vh);
  top = Math.min(top, H - row.offsetHeight - 3 * vh);   // keep the row on screen
  row.style.top = (top / vh).toFixed(2) + 'vh';
}
window.addEventListener('resize', positionPicksRow);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => positionPicksRow());

// COMP built-in background. Bespoke = a CSS accent-energy animation; otherwise
// reuse the shared BG engine to render a premade style into the comp bg element.
// Only runs while the COMP win screen is on screen.
let _compBgKey = '';
function applyCompBackground(ws, state) {
  const el = document.getElementById('ws-comp-bg');
  if (!el) return;
  if (_style !== 'comp') {   // switched to another style — tear down now
    if (_compBgKey !== '') { GfxSettings.clearBackground(el); el.classList.remove('comp-bg-bespoke'); el.style.background = ''; _compBgKey = ''; }
    return;
  }
  if (!_visible) return;     // hiding — keep the bg so the collapse-exit can animate; torn down when the exit finishes
  const bg  = ws.compBg || 'bespoke';
  const key = bg + '|' + _accentHex;   // re-apply when the choice or accent changes
  if (key === _compBgKey) return;
  _compBgKey = key;
  if (bg === 'bespoke') {
    GfxSettings.clearBackground(el);   // tear down any premade canvas
    el.style.background = '';           // let the CSS base (--gfx-c4) show
    el.classList.add('comp-bg-bespoke');
  } else if (bg === 'solid') {
    GfxSettings.clearBackground(el);
    el.classList.remove('comp-bg-bespoke');
    el.style.background = 'var(--gfx-c4, #05080d)';
  } else {
    el.classList.remove('comp-bg-bespoke');
    el.style.position = 'absolute';   // keep the engine from forcing position:relative (collapses the box)
    const anim = (state.settings && state.settings.animation) || {};
    GfxSettings.applyBackground(el, { settings: {
      bgType: 'animation', bgAnimation: bg,
      bgColor: GfxSettings.palette(state, 3) || '#05080d',
      animation: { bgSpeed: anim.bgSpeed || 'medium' },
      palette: (state.settings && state.settings.palette) || [],
    } });
  }
}

// ── Dota: winning team's drafted HEROES ──────────────────────────────────────
// Dota has no per-game seriesGames pick history, so the winning comp is sourced from the current
// Captains Mode draft (heroDraft) — the winner's `action:'pick'` steps, in draft order, each
// carrying landscape hero art (`img`). Labelled with the hero name (heroes aren't tied to players).
function isHeroGame(state) { const a = state && state.adapter; return a ? a.pickEntity === 'hero' : ((state && state.match && state.match.game) === 'dota2'); }
function winnerHeroPicks(state, winner) {
  const steps = (state && state.heroDraft && state.heroDraft.steps) || [];
  return steps.filter(s => s && s.team === winner && s.action === 'pick' && (s.hero || s.img))
              .map(s => ({ name: s.hero || '', img: s.img || '' }));
}

let _compFp = '';
function buildCompRow(ws, match) {
  const row = document.getElementById('ws-comp-row');
  if (!row) return;
  if (!_wantCompRow(ws)) { if (_compFp !== '') { _compFp = ''; row.innerHTML = ''; row.classList.remove('hero-picks'); } return; }

  const winner   = ws.team || 'team1';
  const valMode  = isValorantGame(_lastState);
  const heroMode = !valMode && isHeroGame(_lastState);
  row.classList.toggle('hero-picks', heroMode);
  row.classList.toggle('agent-picks', valMode);

  let html = '';
  if (valMode) {
    // VALORANT — winning roster's manually-set agents as full-body portraits. There's no draft or
    // per-game agent history (no live data), so read the current roster like the Player Intro does.
    // Labelled by player handle (the image conveys the agent), mirroring the LoL handle labels.
    const players = (_lastState && _lastState.players && _lastState.players[winner]) || [];
    const picks = players.filter(p => p && p.agent).slice(0, 5).map(p => ({ handle: p.handle || '', agent: p.agent }));
    const fp = JSON.stringify({ w: winner, st: _style, val: picks });
    if (fp === _compFp) return;
    _compFp = fp;
    for (let i = 0; i < picks.length; i++) {
      const url = agentPortrait(picks[i].agent); if (!url) continue;
      html += '<div class="ws-comp-pick">' +
        '<div class="ws-comp-portrait"><img src="' + url + '" alt="" onerror="this.style.display=\'none\'"></div>' +
        (picks[i].handle ? '<div class="ws-comp-player">' + esc(picks[i].handle) + '</div>' : '') +
        '</div>';
    }
  } else if (heroMode) {
    // Dota — landscape hero art from the current draft; labelled by hero name.
    const picks = winnerHeroPicks(_lastState, winner);
    const fp = JSON.stringify({ w: winner, st: _style, hero: picks });
    if (fp === _compFp) return;
    _compFp = fp;
    for (let i = 0; i < picks.length && i < 5; i++) {
      const p = picks[i]; if (!p || !p.img) continue;
      html += '<div class="ws-comp-pick">' +
        '<div class="ws-comp-portrait"><img src="' + p.img + '" alt="" onerror="this.style.display=\'none\'"></div>' +
        (p.name ? '<div class="ws-comp-player">' + esc(p.name) + '</div>' : '') +
        '</div>';
    }
  } else {
    // LoL — champion splashes from the recorded winning game's role picks.
    const tk      = winner === 'team2' ? 't2' : 't1';   // seriesGames stores picks as t1/t2RolePicks
    const game    = winningCompGame(ws, match);
    const picks   = (game && game[tk + 'RolePicks']) || [];
    const players  = (game && game.players && game.players[winner]) || [];   // players keyed team1/team2

    // Only rebuild when the comp actually changes — otherwise the champion
    // images re-fetch and flicker on every state broadcast.
    const fp = JSON.stringify({ w: winner, st: _style, p: picks });
    if (fp === _compFp) return;
    _compFp = fp;

    for (let i = 0; i < 5; i++) {
      const url = picks[i]; if (!url) continue;
      const splash = champSplash(champNameFromUrl(url));
      const byRole = players.find(p => _normRole(p.role) === _COMP_ROLE_ORDER[i]);
      const handle = (byRole && byRole.handle) || (players[i] && players[i].handle) || '';
      html += '<div class="ws-comp-pick">' +
        '<div class="ws-comp-portrait">' +
          (splash ? '<img src="' + splash + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '</div>' +
        (handle ? '<div class="ws-comp-player">' + esc(handle) + '</div>' : '') +
        '</div>';
    }
  }
  row.innerHTML = html;
}

socket.on('connect', () => {
  _visible = false;
  _style   = 'blade';
});

let _lastState = null;
socket.on('state', state => {
  _lastState = state;
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'winScreen');
  _accentHex = resolveWinAccent(state);

  const ws    = state.winScreen || {};
  const match = state.match     || {};

  const visible  = !!ws.visible;
  const rawStyle = ws.style || 'blade';
  const style    = rawStyle === 'surge' ? 'burst' : rawStyle;

  const root = document.getElementById('win-root');
  if (style !== _style) {
    if (_style === 'split')     stopSplitParticles();
    if (_style === 'spotlight') stopSpotParticles();
    root.classList.remove('style-' + _style);
    root.classList.add('style-' + style);
    _style = style;
  }
  applyPicksClasses(root, ws);

  if (visible && !_visible) {
    populateContent(ws, match);
    if (_outTimer) { clearTimeout(_outTimer); _outTimer = null; }
    _visible = true;
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  } else if (visible) {
    populateContent(ws, match);
  }
  applyCompBackground(ws, state);
});

// Win accent source: 'side' = winning team's draft side (blue/red), 'custom' = a
// fixed hex, anything else = palette Primary. Returns a real hex (setWinColor derives rgba).
function resolveWinAccent(state) {
  const ws = state.winScreen || {};
  const settings = state.settings || {};
  const src = ws.accentSource || 'side';
  if (src === 'custom') return /^#[0-9a-fA-F]{6}$/.test(ws.accentCustom || '') ? ws.accentCustom : '#1ffaff';
  if (src === 'side') {
    const blueTeam = (state.draft && state.draft.blueSideTeam) || 'team1';
    const winnerOnBlue = (ws.team || 'team1') === blueTeam;
    return (winnerOnBlue ? settings.blueAccent : settings.redAccent) || GfxSettings.palette(state, 0);
  }
  return GfxSettings.palette(state, 0); // 'primary'
}

function populateContent(ws, match) {
  const teamKey = ws.team || 'team1';
  const team    = match[teamKey] || {};

  setWinColor(_accentHex);

  const logoEl = document.getElementById('ws-logo');
  if (logoEl) logoEl.style.backgroundImage = team.logo ? 'url(' + team.logo + ')' : '';

  const tagEl = document.getElementById('ws-tag');
  if (tagEl) tagEl.textContent = '✦ VICTORY ✦';

  const nameEl = document.getElementById('ws-name');
  if (nameEl) {
    nameEl.style.fontSize = '';
    nameEl.textContent = (team.name || team.tag || '').toUpperCase();
  }
  if (_style === 'split') requestAnimationFrame(fitSplitName);

  const msgEl = document.getElementById('ws-message');
  if (msgEl) msgEl.textContent = ws.message || 'WINS THE SERIES';

  const scoreRow    = document.getElementById('ws-score-row');
  const seriesScore = ws.seriesScore || '';
  // The hype redesign hides scores by default; the CS2 "auto series score" opt-in brings the
  // series score row back (only when there's a score to show).
  const rootEl = document.getElementById('win-root');
  if (rootEl) rootEl.classList.toggle('ws-series-on', !!(ws.autoSeriesScore && seriesScore));
  if (scoreRow) {
    if (seriesScore) {
      const parts = seriesScore.split('—').map(s => s.trim());
      const t1El  = document.getElementById('ws-score-t1');
      const t2El  = document.getElementById('ws-score-t2');
      if (t1El) t1El.textContent = teamKey === 'team1' ? parts[0] : parts[1];
      if (t2El) t2El.textContent = teamKey === 'team1' ? parts[1] : parts[0];
      scoreRow.style.display = 'flex';
    } else {
      scoreRow.style.display = 'none';
    }
  }

  renderWinMaps(match, teamKey);
  buildCompRow(ws, match);
  requestAnimationFrame(positionPicksRow);   // after the row/card layout commits
}

// Per-map round scores (CS2 / map-veto games). match.mapResults is only populated
// for map-veto games, so its presence is the gate. Winner's round count in accent.
function renderWinMaps(match, teamKey) {
  const el = document.getElementById('ws-maps');
  if (!el) return;
  const results = (match && match.mapResults) || [];
  const scored = results.filter(r => r && r.map && (r.winner || r.t1Rounds || r.t2Rounds));
  if (!scored.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = scored.map(function(r) {
    const t1cls = r.winner === 'team1' ? ' win' : '';
    const t2cls = r.winner === 'team2' ? ' win' : '';
    return '<span class="ws-map">' +
      '<span class="ws-map-name">' + esc(r.map || '') + '</span>' +
      '<span class="ws-map-score">' +
        '<span class="ws-map-r' + t1cls + '">' + (r.t1Rounds || 0) + '</span>' +
        '<span class="ws-map-dash">-</span>' +
        '<span class="ws-map-r' + t2cls + '">' + (r.t2Rounds || 0) + '</span>' +
      '</span></span>';
  }).join('<span class="ws-map-sep">·</span>');
}

function setWinColor(hex) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#1ffaff';
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const root = document.documentElement;
  root.style.setProperty('--win-color',   safe);
  root.style.setProperty('--win-col-a70', `rgba(${r},${g},${b},0.7)`);
  root.style.setProperty('--win-col-a30', `rgba(${r},${g},${b},0.3)`);
  root.style.setProperty('--win-col-a12', `rgba(${r},${g},${b},0.12)`);
  root.style.setProperty('--win-col-a06', `rgba(${r},${g},${b},0.06)`);
  root.style.setProperty('--win-col-a00', `rgba(${r},${g},${b},0)`);
  _spotAccent = [r, g, b];
}

// ── Split right-panel particle drift ─────────────────────────────────────────
let _splitCanvas = null, _splitCtx = null, _splitAnimId = null;

function startSplitParticles() {
  stopSplitParticles();
  const canvas = document.getElementById('ws-split-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  _splitCanvas = canvas;
  _splitCtx    = canvas.getContext('2d');

  const [r, g, b] = _spotAccent;

  const particles = Array.from({ length: 80 }, () => ({
    x:            canvas.width  * (0.52 + Math.random() * 0.44),
    y:            Math.random()  * canvas.height,
    vx:           (Math.random() - 0.5) * 0.25,
    vy:           -(0.25 + Math.random() * 0.5),
    rad:          0.5 + Math.random() * 2.0,
    baseAlpha:    0.1 + Math.random() * 0.28,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.012 + Math.random() * 0.02,
  }));

  function frame() {
    if (!_splitCanvas) return;
    _splitCtx.clearRect(0, 0, _splitCanvas.width, _splitCanvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.twinklePhase += p.twinkleSpeed;
      if (p.y < -5) {
        p.y = _splitCanvas.height + 5;
        p.x = _splitCanvas.width * (0.52 + Math.random() * 0.44);
      }
      const tw = 0.5 + 0.5 * Math.sin(p.twinklePhase);
      _splitCtx.beginPath();
      _splitCtx.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
      _splitCtx.fillStyle = `rgba(${r},${g},${b},${p.baseAlpha * tw})`;
      _splitCtx.fill();
    });
    _splitAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function stopSplitParticles() {
  if (_splitAnimId) { cancelAnimationFrame(_splitAnimId); _splitAnimId = null; }
  if (_splitCtx && _splitCanvas) _splitCtx.clearRect(0, 0, _splitCanvas.width, _splitCanvas.height);
  _splitCanvas = null; _splitCtx = null;
}

// ── Spotlight sparkle particles ───────────────────────────────────────────────
let _spotCanvas = null, _spotCtx = null, _spotAnimId = null;
let _spotAccent = [31, 250, 255];

function startSpotParticles() {
  stopSpotParticles();
  const canvas = document.getElementById('ws-spotlight-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  _spotCanvas = canvas;
  _spotCtx    = canvas.getContext('2d');

  const [r, g, b] = _spotAccent;
  const cx        = canvas.width / 2;

  const sparks = Array.from({ length: 55 }, () => ({
    x:            cx + (Math.random() - 0.5) * canvas.width  * 0.38,
    y:            Math.random() * canvas.height * 0.50,
    vx:           (Math.random() - 0.5) * 0.75,
    vy:           0.5 + Math.random() * 1.6,
    rad:          0.5 + Math.random() * 2.2,
    baseAlpha:    0.35 + Math.random() * 0.55,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.025 + Math.random() * 0.06,
  }));

  function frame() {
    if (!_spotCanvas) return;
    _spotCtx.clearRect(0, 0, _spotCanvas.width, _spotCanvas.height);
    sparks.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.twinklePhase += p.twinkleSpeed;
      if (p.y > _spotCanvas.height + 5) {
        p.y = -5;
        p.x = cx + (Math.random() - 0.5) * _spotCanvas.width * 0.42;
      }
      const tw = 0.5 + 0.5 * Math.sin(p.twinklePhase);
      _spotCtx.beginPath();
      _spotCtx.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
      _spotCtx.fillStyle = `rgba(${r},${g},${b},${p.baseAlpha * tw})`;
      _spotCtx.fill();
    });
    _spotAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function stopSpotParticles() {
  if (_spotAnimId) { cancelAnimationFrame(_spotAnimId); _spotAnimId = null; }
  if (_spotCtx && _spotCanvas) _spotCtx.clearRect(0, 0, _spotCanvas.width, _spotCanvas.height);
  _spotCanvas = null; _spotCtx = null;
}

// ── Animate in / out ──────────────────────────────────────────────────────────
// Scales the team name font down to fit the text column (split style only).
// Only called after the element is visible — if offsetWidth is 0 it means
// the graphic hasn't animated in yet, so we do nothing (animateIn queues its own rAF).
function fitSplitName() {
  if (_style !== 'split') return;
  const nameEl = document.getElementById('ws-name');
  if (!nameEl) return;

  nameEl.style.fontSize = '';
  // nameEl.offsetWidth is already the parent's inner content width —
  // block children are laid out at parent's width minus padding automatically.
  const available = nameEl.offsetWidth;
  if (available <= 0) return; // not in layout tree yet

  if (nameEl.scrollWidth <= available) return;

  const minPx = Math.max(30, window.innerHeight * 0.038);
  const currentPx = parseFloat(getComputedStyle(nameEl).fontSize);

  let targetPx = Math.max(minPx, Math.floor(currentPx * (available / nameEl.scrollWidth)));
  nameEl.style.fontSize = targetPx + 'px';

  while (nameEl.scrollWidth > nameEl.offsetWidth && targetPx > minPx) {
    targetPx -= 1;
    nameEl.style.fontSize = targetPx + 'px';
  }
}

function animateIn() {
  const root = document.getElementById('win-root');
  // Before revealing, make sure any comp splash images are decoded. On a cold load
  // they otherwise decode on the main thread DURING the entrance and jank the last
  // champions ("skips the last part"). Warm loads already have decoded images, so
  // the wait resolves instantly. A 400ms cap stops a slow/broken image holding the
  // win screen back. While we wait the root is still display:none (nothing shown).
  const imgs = Array.prototype.slice.call(document.querySelectorAll('#ws-comp-row img'));
  if (imgs.length && imgs.some(im => !im.complete)) {
    let started = false;
    const start = () => { if (!started) { started = true; revealEntrance(root); } };
    Promise.all(imgs.map(im => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))).then(start);
    setTimeout(start, 400);
    return;
  }
  revealEntrance(root);
}

function revealEntrance(root) {
  // Commit `is-entering` (which pins every element's hidden start-state) while the
  // root is STILL display:none, then reveal. That way the first painted frame
  // already has the pin — the entrance never flashes the resting/centred state
  // first (which it would if we revealed before adding the class, then let a
  // forced reflow present that resting frame ahead of the animation engaging).
  root.classList.remove('is-exiting', 'is-visible');
  root.classList.add('is-entering');
  root.style.display = 'block';
  void root.offsetWidth;
  // Now that the card is displayed (and measurable), position the below-card picks row. The
  // call in populateContent can run while the root is still display:none (the entrance waits on
  // image decode), measuring the card at height 0 → the row falls back to 63vh and overlaps the
  // card text. offsetHeight ignores the is-entering transforms, so this is stable mid-animation.
  requestAnimationFrame(positionPicksRow);
  if (_style === 'spotlight') startSpotParticles();
  if (_style === 'split') { startSplitParticles(); requestAnimationFrame(fitSplitName); }

  // Flip is-entering → is-visible only once the entrance has TRULY finished.
  // A fixed timer is just a guess at the end time; under load the champ animations
  // start late (5 filtered/masked portraits compositing), so the timer can fire a
  // few frames before the last champion lands — yanking is-entering mid-animation
  // and clipping its final frames into a few-px snap. For COMP we instead settle on
  // the LAST pick's animationend (can't clip), with a padded timer only as a
  // fallback. Other styles keep the plain timer.
  let settled = false;
  const settle = () => {
    if (settled || !root.classList.contains('is-entering')) return;
    settled = true;
    root.classList.remove('is-entering');
    root.classList.add('is-visible');
  };
  const dur = (ANIM_MS[_style] || ANIM_MS.blade).in * _durScale();
  if (_style === 'comp') {
    const picks = root.querySelectorAll('.ws-comp-pick');
    const last = picks[picks.length - 1];
    if (last) last.addEventListener('animationend', settle, { once: true });
    setTimeout(settle, dur + 350);   // fallback if animationend never fires
  } else {
    setTimeout(settle, dur);
  }
}

function animateOut() {
  const root = document.getElementById('win-root');
  root.classList.remove('is-entering', 'is-visible');
  root.classList.add('is-exiting');
  stopSpotParticles();
  stopSplitParticles();
  const dur = (ANIM_MS[_style] || ANIM_MS.blade).out * _durScale();
  _outTimer = setTimeout(() => {
    root.classList.remove('is-exiting');
    root.style.display = 'none';
    // Tear down the COMP background only now that the collapse-exit has finished.
    const cb = document.getElementById('ws-comp-bg');
    if (cb && _compBgKey !== '') { GfxSettings.clearBackground(cb); cb.classList.remove('comp-bg-bespoke'); cb.style.background = ''; _compBgKey = ''; }
    _outTimer = null;
  }, dur);
}
