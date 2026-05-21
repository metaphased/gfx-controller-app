const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _visible = false;
let _style   = 'blade';
let _outTimer = null;

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

  const ws    = state.winScreen || {};
  const match = state.match     || {};

  const visible  = !!ws.visible;
  const rawStyle = ws.style || 'blade';
  const style    = rawStyle === 'surge' ? 'burst' : rawStyle;

  const root = document.getElementById('win-root');
  if (style !== _style) {
    root.classList.remove('style-' + _style);
    root.classList.add('style-' + style);
    _style = style;
  }

  populateContent(ws, match);

  if (visible && !_visible) {
    if (_outTimer) { clearTimeout(_outTimer); _outTimer = null; }
    _visible = true;
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  }
});

function populateContent(ws, match) {
  const teamKey = ws.team || 'team1';
  const team    = match[teamKey] || {};

  const color = team.color || '#1ffaff';
  setWinColor(color);

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
  _spotAccent = [r, g, b];
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
  const textEl = nameEl.parentElement;
  if (!textEl) return;

  nameEl.style.fontSize = '';
  const available = textEl.offsetWidth;
  if (available === 0) return; // not visible yet — animateIn's rAF will handle it

  if (nameEl.scrollWidth <= available) return; // fits at default 7vh, nothing to do

  const minPx = Math.max(30, window.innerHeight * 0.038); // ~4vh floor
  const currentPx = parseFloat(getComputedStyle(nameEl).fontSize);

  // Jump to approximate size in one shot using the overflow ratio
  let targetPx = Math.max(minPx, Math.floor(currentPx * (available / nameEl.scrollWidth)));
  nameEl.style.fontSize = targetPx + 'px';

  // Fine-tune by 1px steps in case reflow shifts the balance slightly
  while (nameEl.scrollWidth > available && targetPx > minPx) {
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
  if (_style === 'split') requestAnimationFrame(fitSplitName);
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
  const dur = (ANIM_MS[_style] || ANIM_MS.blade).out;
  _outTimer = setTimeout(() => {
    root.classList.remove('is-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, dur);
}
