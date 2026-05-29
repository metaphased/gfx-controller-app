const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _visible = false;
let _style   = 'blade';
let _outTimer = null;
let _accentHex = '#1ffaff'; // win accent = palette Primary (real hex; setWinColor derives rgba)

const ANIM_MS = {
  blade:     { in: 900,  out: 700  },
  burst:     { in: 1100, out: 650  },
  slam:      { in: 1000, out: 750  },
  split:     { in: 1150, out: 900  },
  spotlight: { in: 1350, out: 750  },
  wipe:      { in: 1050, out: 650  },
};

socket.on('connect', () => {
  _visible = false;
  _style   = 'blade';
});

socket.on('state', state => {
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
  root.style.display = 'block';
  root.classList.remove('is-exiting', 'is-visible');
  void root.offsetWidth;
  root.classList.add('is-entering');
  if (_style === 'spotlight') startSpotParticles();
  if (_style === 'split') { startSplitParticles(); requestAnimationFrame(fitSplitName); }
  const dur = (ANIM_MS[_style] || ANIM_MS.blade).in;
  setTimeout(() => {
    root.classList.remove('is-entering');
    root.classList.add('is-visible');
  }, dur);
}

function animateOut() {
  const root = document.getElementById('win-root');
  root.classList.remove('is-entering', 'is-visible');
  root.classList.add('is-exiting');
  stopSpotParticles();
  stopSplitParticles();
  const dur = (ANIM_MS[_style] || ANIM_MS.blade).out;
  _outTimer = setTimeout(() => {
    root.classList.remove('is-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, dur);
}
