// Global HTML-escape helper — wrap any user-entered data (team/player names,
// handles, ticker/lower-third text, titles) before interpolating into innerHTML.
window.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// Shared graphics settings helper — include in every graphic overlay
window.GfxSettings = (function () {

  function get(s) { return (s && s.settings) || {}; }

  // Hex (#rgb or #rrggbb) → "r, g, b" triplet string for use inside rgba(var(...), a).
  function _hexTriplet(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(isNaN)) return null;
    return r + ', ' + g + ', ' + b;
  }

  function applyTheme(el, s) {
    const st = get(s);
    const pal = st.palette || [];
    const defaults = ['#1ffaff', '#a7a38e', '#e8e6df', '#070f12'];
    for (let i = 0; i < 4; i++) {
      const hex = (pal[i] && pal[i].hex) || defaults[i];
      el.style.setProperty('--gfx-c' + (i + 1), hex);
      // RGB triplet so overlays can theme translucent surfaces: rgba(var(--gfx-cN-rgb, …), a)
      const trip = _hexTriplet(hex);
      if (trip) el.style.setProperty('--gfx-c' + (i + 1) + '-rgb', trip);
    }
    const blue = st.blueAccent || '#1e6fff', red = st.redAccent || '#ff3b3b';
    el.style.setProperty('--gfx-blue', blue);
    el.style.setProperty('--gfx-red',  red);
    const blueTrip = _hexTriplet(blue), redTrip = _hexTriplet(red);
    if (blueTrip) el.style.setProperty('--gfx-blue-rgb', blueTrip);
    if (redTrip)  el.style.setProperty('--gfx-red-rgb',  redTrip);
    el.style.setProperty('--gfx-bg',   st.bgColor    || 'transparent');
  }

  function applyBackground(el, s) {
    const st = get(s);

    // Build a key from every setting that affects what's drawn.
    // If nothing relevant changed, leave the running animation untouched.
    const bgKey = [
      st.bgType        || 'transparent',
      st.bgColor       || '',
      st.bgImage       || '',
      st.bgAnimation   || '',
      (get(s).animation || {}).bgSpeed || 'medium',
      st.bgFogLayer    ? '1' : '0',
      st.bgFogIntensity != null ? String(st.bgFogIntensity) : '50',
    ].join('|');
    if (bgKey === _lastBgKey && (st.bgType !== 'animation' || !!_canvas) && (!st.bgFogLayer || !!_fogCanvas)) return;

    stopBgAnimation();
    _lastBgKey = bgKey;
    switch (st.bgType) {
      case 'color':
        el.style.background = st.bgColor || '#070f12';
        break;
      case 'image':
        el.style.background = st.bgColor || '#070f12';
        if (st.bgImage) {
          el.style.backgroundImage    = 'url(' + st.bgImage + ')';
          el.style.backgroundSize     = 'cover';
          el.style.backgroundPosition = 'center';
        }
        break;
      case 'animation':
        el.style.background = st.bgColor || '#070f12';
        _startBgAnimation(el, st.bgAnimation || 'particles', bgSpeed(s), st.bgImage || '');
        break;
      case 'transparent':
      default:
        el.style.background = 'transparent';
    }
    if (st.bgFogLayer) {
      const intensity = Math.max(0.1, Math.min(1, (st.bgFogIntensity != null ? st.bgFogIntensity : 50) / 100));
      _startFogLayer(el, intensity);
    }
  }

  function bgSpeed(s) {
    const speed = (get(s).animation || {}).bgSpeed || 'medium';
    return speed === 'slow' ? 0.4 : speed === 'fast' ? 2 : 1;
  }

  function palette(s, idx) {
    const pal = get(s).palette || [];
    const defaults = ['#1ffaff', '#a7a38e', '#e8e6df', '#070f12'];
    return (pal[idx] && pal[idx].hex) || defaults[idx] || '#ffffff';
  }

  function accent(s, side) {
    const st = get(s);
    return side === 'blue' ? (st.blueAccent || '#1e6fff') : (st.redAccent || '#ff3b3b');
  }

  function logo(s, type) { return (get(s).logoSet || {})[type] || ''; }

  // ── Easing library + animation token injection ──────────────────────────────
  // Standard easing curves expressible as a single cubic-bezier.
  var EASINGS = {
    linear:        'linear',
    easeInSine:    'cubic-bezier(0.12,0,0.39,0)',
    easeOutSine:   'cubic-bezier(0.61,1,0.88,1)',
    easeInOutSine: 'cubic-bezier(0.37,0,0.63,1)',
    easeInQuad:    'cubic-bezier(0.11,0,0.5,0)',
    easeOutQuad:   'cubic-bezier(0.5,1,0.89,1)',
    easeInOutQuad: 'cubic-bezier(0.45,0,0.55,1)',
    easeInCubic:   'cubic-bezier(0.32,0,0.67,0)',
    easeOutCubic:  'cubic-bezier(0.33,1,0.68,1)',
    easeInOutCubic:'cubic-bezier(0.65,0,0.35,1)',
    easeInQuart:   'cubic-bezier(0.5,0,0.75,0)',
    easeOutQuart:  'cubic-bezier(0.25,1,0.5,1)',
    easeInOutQuart:'cubic-bezier(0.76,0,0.24,1)',
    easeInQuint:   'cubic-bezier(0.64,0,0.78,0)',
    easeOutQuint:  'cubic-bezier(0.22,1,0.36,1)',
    easeInOutQuint:'cubic-bezier(0.83,0,0.17,1)',
    easeInExpo:    'cubic-bezier(0.7,0,0.84,0)',
    easeOutExpo:   'cubic-bezier(0.16,1,0.3,1)',
    easeInOutExpo: 'cubic-bezier(0.87,0,0.13,1)',
    easeInCirc:    'cubic-bezier(0.55,0,1,0.45)',
    easeOutCirc:   'cubic-bezier(0,0.55,0.45,1)',
    easeInOutCirc: 'cubic-bezier(0.85,0,0.15,1)',
    easeInBack:    'cubic-bezier(0.36,0,0.66,-0.56)',
    easeOutBack:   'cubic-bezier(0.34,1.56,0.64,1)',
    easeInOutBack: 'cubic-bezier(0.68,-0.6,0.32,1.6)',
  };

  // Bounce/elastic can't be a single cubic-bezier — sample the Penner formula into
  // a CSS linear() easing function. When linear() is unsupported (older CEF), we
  // fall back to the nearest overshoot bezier below.
  function _bounceOut(t) {
    var n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) { t -= 1.5 / d1;   return n1 * t * t + 0.75; }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    t -= 2.625 / d1; return n1 * t * t + 0.984375;
  }
  var _EASE_FN = {
    easeOutBounce: _bounceOut,
    easeInBounce:  function (t) { return 1 - _bounceOut(1 - t); },
    easeInOutBounce: function (t) { return t < 0.5 ? (1 - _bounceOut(1 - 2 * t)) / 2 : (1 + _bounceOut(2 * t - 1)) / 2; },
    easeOutElastic: function (t) { var c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
    easeInElastic:  function (t) { var c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4); },
    easeInOutElastic: function (t) { var c5 = (2 * Math.PI) / 4.5; return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2 : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1; },
  };
  function _toLinear(fn, samples) {
    var pts = [];
    for (var i = 0; i <= samples; i++) pts.push(+fn(i / samples).toFixed(4));
    return 'linear(' + pts.join(',') + ')';
  }
  Object.keys(_EASE_FN).forEach(function (name) {
    EASINGS[name] = _toLinear(_EASE_FN[name], /elastic/i.test(name) ? 32 : 24);
  });

  // Nearest single-bezier fallback for renderers without CSS linear().
  var _EASE_FALLBACK = {
    easeOutBounce: EASINGS.easeOutBack, easeInBounce: EASINGS.easeInBack, easeInOutBounce: EASINGS.easeInOutBack,
    easeOutElastic: EASINGS.easeOutBack, easeInElastic: EASINGS.easeInBack, easeInOutElastic: EASINGS.easeInOutBack,
  };
  var _supportsLinear = (function () {
    try { return !!(window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0,1)')); }
    catch (e) { return false; }
  })();

  // Resolve an easing name to a timing-function string the current renderer can parse.
  function resolveEasing(name) {
    var v = EASINGS[name] || EASINGS.easeOutQuart;
    if (!_supportsLinear && v.indexOf('linear(') === 0) return _EASE_FALLBACK[name] || EASINGS.easeOutBack;
    return v;
  }

  var _SPEED_MULT = { instant: 0, fast: 0.5, medium: 1, slow: 1.6 };

  // Inject the animation tokens onto `el` (usually document.documentElement),
  // resolving global settings merged with this graphic's overrides.
  // Easings are role-based (enter/exit/move); duration is a single unitless scale
  // so overlay CSS keeps its own choreographed timings: calc(0.55s * var(--gfx-dur-scale)).
  var _prefersReducedMotion = (function () {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  })();
  var _lastAnimKey = null;
  function applyAnimation(el, s, graphicKey) {
    var anim = get(s).animation || {};
    var ov   = (anim.overrides && graphicKey && anim.overrides[graphicKey]) || {};
    var mult = _SPEED_MULT[ov.speed || anim.speed];
    if (mult == null) mult = 1;
    if (_prefersReducedMotion) mult = 0; // honour OS/browser reduced-motion → instant
    var enter = resolveEasing(ov.enterEase || anim.enterEase || 'easeOutQuart');
    var exit  = resolveEasing(ov.exitEase  || anim.exitEase  || 'easeInQuart');
    var move  = resolveEasing(ov.moveEase  || anim.moveEase  || 'easeInOutQuad');
    // Skip redundant :root writes — only touch styles when something actually changed,
    // so frequent state broadcasts don't trigger needless style recalcs.
    var key = graphicKey + '|' + enter + '|' + exit + '|' + move + '|' + mult;
    if (key === _lastAnimKey) return;
    _lastAnimKey = key;
    el.style.setProperty('--gfx-ease-enter', enter);
    el.style.setProperty('--gfx-ease-exit',  exit);
    el.style.setProperty('--gfx-ease-move',  move);
    el.style.setProperty('--gfx-dur-scale',  String(mult));
  }

  // ── Read --gfx-c1 as [r,g,b] ────────────────────────────────────────────────
  function _accentRgb() {
    const hex = (getComputedStyle(document.documentElement).getPropertyValue('--gfx-c1') || '')
      .trim().replace('#', '') || '1ffaff';
    return [
      parseInt(hex.slice(0, 2), 16) || 31,
      parseInt(hex.slice(2, 4), 16) || 250,
      parseInt(hex.slice(4, 6), 16) || 255,
    ];
  }

  // ── Canvas state ─────────────────────────────────────────────────────────────
  let _canvas = null, _ctx = null, _animId = null, _bgResizeFn = null;
  let _fogCanvas = null, _fogCtx = null, _fogAnimId = null, _fogResizeFn = null;
  let _lastBgKey = null; // tracks what is currently running so identical calls are ignored
  let _persistedFogData = null; // fog puff state — survives animation restarts
  let _animFrameFn = null, _fogAnimFrameFn = null;

  // Pause rAF loops when the tab is hidden; resume when it becomes visible.
  function _rafMain(fn) { _animFrameFn = fn; _animId = document.hidden ? null : requestAnimationFrame(fn); }
  function _rafFog(fn)  { _fogAnimFrameFn = fn; _fogAnimId = document.hidden ? null : requestAnimationFrame(fn); }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (_animFrameFn)    _animId    = requestAnimationFrame(_animFrameFn);
      if (_fogAnimFrameFn) _fogAnimId = requestAnimationFrame(_fogAnimFrameFn);
    }
  });

  function stopBgAnimation() {
    if (_animId)     { cancelAnimationFrame(_animId); _animId = null; }
    if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
    if (_bgResizeFn) { window.removeEventListener('resize', _bgResizeFn); _bgResizeFn = null; }
    _canvas = null; _ctx = null; _animFrameFn = null;
    stopFogLayer();
  }

  function stopFogLayer() {
    if (_fogAnimId)     { cancelAnimationFrame(_fogAnimId); _fogAnimId = null; }
    if (_fogCanvas && _fogCanvas.parentNode) _fogCanvas.parentNode.removeChild(_fogCanvas);
    if (_fogResizeFn)   { window.removeEventListener('resize', _fogResizeFn); _fogResizeFn = null; }
    _fogCanvas = null; _fogCtx = null; _fogAnimFrameFn = null;
  }

  function _startBgAnimation(container, type, sp, bgImgUrl) {
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;will-change:transform';
    container.style.position = container.style.position || 'relative';
    container.insertBefore(_canvas, container.firstChild);
    _ctx = _canvas.getContext('2d');

    function resize() {
      _canvas.width  = container.offsetWidth  || window.innerWidth;
      _canvas.height = container.offsetHeight || window.innerHeight;
    }
    resize();
    _bgResizeFn = resize;
    window.addEventListener('resize', resize);

    if      (type === 'particles') _particles(sp);
    else if (type === 'scanlines') _scanlines(sp);
    else if (type === 'grid')      _grid(sp);
    else if (type === 'hexgrid')   _hexgrid(sp);
    else if (type === 'diamonds')  _diamonds(sp);
    else if (type === 'dotwave')   _dotwave(sp);
    else if (type === 'lines')     _lines(sp);
    else if (type === 'rings')     _rings(sp);
    else if (type === 'circuit')   _circuit(sp);
    else if (type === 'rain')      _rain(sp);
    else if (type === 'fog')       _fog(sp);
    else if (type === 'wave')      _wave(sp, bgImgUrl);
  }

  // ── Fog overlay layer (composable on top of any bg type) ─────────────────────
  function _startFogLayer(container, intensity) {
    _fogCanvas = document.createElement('canvas');
    _fogCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
    container.style.position = container.style.position || 'relative';
    container.appendChild(_fogCanvas);
    _fogCtx = _fogCanvas.getContext('2d');
    function resize() {
      _fogCanvas.width  = container.offsetWidth  || window.innerWidth;
      _fogCanvas.height = container.offsetHeight || window.innerHeight;
    }
    resize();
    _fogResizeFn = resize;
    window.addEventListener('resize', resize);
    const fogData = _makeFogPuffs();
    function frame() {
      if (!_fogCanvas) return;
      _drawFogFrame(_fogCtx, _fogCanvas, fogData, intensity);
      _rafFog(frame);
    }
    frame();
  }

  // ── Background animations ────────────────────────────────────────────────────

  function _particles(sp) {
    const pts = Array.from({ length: 70 }, () => ({
      x:  Math.random() * (_canvas.width  || 1920),
      y:  Math.random() * (_canvas.height || 1080),
      r:  Math.random() * 1.5 + 0.4,
      vx: (Math.random() - 0.5) * 0.35 * sp,
      vy: (Math.random() - 0.5) * 0.35 * sp,
      a:  Math.random() * 0.45 + 0.08,
    }));
    function frame() {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      pts.forEach(p => {
        p.x = (p.x + p.vx + _canvas.width)  % _canvas.width;
        p.y = (p.y + p.vy + _canvas.height) % _canvas.height;
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        _ctx.fillStyle = 'rgba(255,255,255,' + p.a + ')';
        _ctx.fill();
      });
      _rafMain(frame);
    }
    frame();
  }

  function _scanlines(sp) {
    let offset = 0;
    function frame() {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      _ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = offset % 4; y < _canvas.height; y += 4) _ctx.fillRect(0, y, _canvas.width, 1);
      offset += 0.4 * sp;
      _rafMain(frame);
    }
    frame();
  }

  function _grid(sp) {
    let phase = 0;
    const spacing = 44;
    function frame() {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      _ctx.strokeStyle = 'rgba(255,255,255,' + (0.055 + Math.sin(phase) * 0.02) + ')';
      _ctx.lineWidth = 1;
      for (let x = 0; x < _canvas.width;  x += spacing) { _ctx.beginPath(); _ctx.moveTo(x, 0); _ctx.lineTo(x, _canvas.height); _ctx.stroke(); }
      for (let y = 0; y < _canvas.height; y += spacing) { _ctx.beginPath(); _ctx.moveTo(0, y); _ctx.lineTo(_canvas.width, y);  _ctx.stroke(); }
      phase += 0.009 * sp;
      _rafMain(frame);
    }
    frame();
  }

  function _hexgrid(sp) {
    let phase = 0;
    const sz = 28, w3 = Math.sqrt(3);
    function hexPath(cx, cy) {
      _ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        i === 0 ? _ctx.moveTo(cx + sz * Math.cos(a), cy + sz * Math.sin(a))
                : _ctx.lineTo(cx + sz * Math.cos(a), cy + sz * Math.sin(a));
      }
      _ctx.closePath();
    }
    function frame() {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      _ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + Math.sin(phase) * 0.018) + ')';
      _ctx.lineWidth = 0.7;
      const cols = Math.ceil(_canvas.width  / (sz * w3)) + 2;
      const rows = Math.ceil(_canvas.height / (sz * 1.5)) + 2;
      for (let r = -1; r < rows; r++) {
        for (let c = -1; c < cols; c++) { hexPath(c * sz * w3 + (r % 2 ? sz * w3 / 2 : 0), r * sz * 1.5); _ctx.stroke(); }
      }
      phase += 0.007 * sp;
      _rafMain(frame);
    }
    frame();
  }

  function _diamonds(sp) {
    let phase = 0;
    const sz = 40;
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      phase += 0.007 * sp;
      _ctx.strokeStyle = 'rgba(255,255,255,' + (0.055 + Math.sin(phase) * 0.018) + ')';
      _ctx.lineWidth = 0.7;
      const diag = Math.sqrt(w * w + h * h);
      _ctx.save();
      _ctx.translate(w / 2, h / 2);
      _ctx.rotate(Math.PI / 4);
      const count = Math.ceil(diag / sz) + 2;
      for (let x = -count * sz; x <= count * sz; x += sz) {
        _ctx.beginPath(); _ctx.moveTo(x, -diag); _ctx.lineTo(x, diag); _ctx.stroke();
      }
      for (let y = -count * sz; y <= count * sz; y += sz) {
        _ctx.beginPath(); _ctx.moveTo(-diag, y); _ctx.lineTo(diag, y); _ctx.stroke();
      }
      _ctx.restore();
      _rafMain(frame);
    }
    frame();
  }

  function _dotwave(sp) {
    const SPACING = 38, DOT_R = 1.4, BUCKETS = 16;
    const slots = Array.from({ length: BUCKETS }, () => []);
    let phase = 0;
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      phase += 0.008 * sp;
      const cols = Math.ceil(w / SPACING) + 1;
      const rows = Math.ceil(h / SPACING) + 1;
      for (let b = 0; b < BUCKETS; b++) slots[b].length = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * SPACING, y = r * SPACING;
          const wave = Math.sin(x / w * Math.PI * 4 + phase) * Math.cos(y / h * Math.PI * 3 + phase * 0.75) * 0.5 + 0.5;
          slots[Math.min(BUCKETS - 1, wave * BUCKETS | 0)].push(x, y);
        }
      }
      for (let b = 0; b < BUCKETS; b++) {
        const pts = slots[b];
        if (!pts.length) continue;
        _ctx.fillStyle = 'rgba(255,255,255,' + (0.04 + b / BUCKETS * 0.16).toFixed(3) + ')';
        _ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          _ctx.moveTo(pts[i] + DOT_R, pts[i + 1]);
          _ctx.arc(pts[i], pts[i + 1], DOT_R, 0, Math.PI * 2);
        }
        _ctx.fill();
      }
      _rafMain(frame);
    }
    frame();
  }

  function _lines(sp) {
    let offset = 0;
    const SPACING = 55;
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      offset = (offset + 0.18 * sp) % SPACING;
      _ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      _ctx.lineWidth = 1;
      const diag = Math.sqrt(w * w + h * h);
      _ctx.save();
      _ctx.translate(w / 2, h / 2);
      _ctx.rotate(Math.PI / 4);
      const count = Math.ceil(diag / SPACING) + 2;
      for (let i = -count; i <= count; i++) {
        const x = i * SPACING + offset;
        _ctx.beginPath(); _ctx.moveTo(x, -diag); _ctx.lineTo(x, diag); _ctx.stroke();
      }
      _ctx.restore();
      _rafMain(frame);
    }
    frame();
  }

  function _rings(sp) {
    const RING_COUNT = 6;
    const rings = Array.from({ length: RING_COUNT }, (_, i) => ({ phase: i / RING_COUNT }));
    let lastTs = null;
    function frame(ts) {
      if (lastTs === null) lastTs = ts;
      const dt = (ts - lastTs) / (5200 / sp);
      lastTs = ts;
      const w = _canvas.width, h = _canvas.height;
      const cx = w * 0.5, cy = h * 0.5;
      const maxR = Math.sqrt(cx * cx + cy * cy) * 1.06;
      _ctx.clearRect(0, 0, w, h);
      rings.forEach(ring => {
        ring.phase = (ring.phase + dt) % 1;
        const alpha = ring.phase < 0.12
          ? (ring.phase / 0.12) * 0.13
          : (1 - ring.phase) * 0.13;
        _ctx.beginPath();
        _ctx.arc(cx, cy, ring.phase * maxR, 0, Math.PI * 2);
        _ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
        _ctx.lineWidth = 1;
        _ctx.stroke();
      });
      _rafMain(frame);
    }
    _rafMain(frame);
  }

  function _circuit(sp) {
    const [r, g, b] = _accentRgb();
    const traces = [];
    let spawnTimer = 0;
    const SPAWN_INTERVAL = Math.max(1, Math.floor(80 / sp));
    const MAX_TRACES = 18;
    let pulse = 0;
    function spawnTrace() {
      const w = _canvas.width || 1920, h = _canvas.height || 1080;
      const edge = Math.floor(Math.random() * 4);
      let x, y, dir;
      if      (edge === 0) { x = Math.random() * w; y = 0; dir = 2; }
      else if (edge === 1) { x = w; y = Math.random() * h; dir = 3; }
      else if (edge === 2) { x = Math.random() * w; y = h; dir = 0; }
      else                 { x = 0; y = Math.random() * h; dir = 1; }
      traces.push({ x, y, dir,
        speed: (22 + Math.random() * 45) * sp,
        path: [{ x, y }],
        alpha: 0.4 + Math.random() * 0.45,
        maxSegs: 3 + Math.floor(Math.random() * 5),
        curSeg: 0, segLen: 50 + Math.random() * 150,
        age: 0, maxAge: 200 + Math.random() * 180, nodes: [],
      });
    }
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      pulse += 0.012 * sp;
      if (++spawnTimer >= SPAWN_INTERVAL && traces.length < MAX_TRACES) { spawnTimer = 0; spawnTrace(); }
      const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const glowMult = 0.9 + Math.sin(pulse) * 0.1;
      for (let i = traces.length - 1; i >= 0; i--) {
        const t = traces[i];
        if (++t.age > t.maxAge) { traces.splice(i, 1); continue; }
        const fadeIn  = Math.min(1, t.age / 18);
        const fadeOut = t.age > t.maxAge * 0.65 ? 1 - (t.age - t.maxAge * 0.65) / (t.maxAge * 0.35) : 1;
        const a = t.alpha * fadeIn * fadeOut * glowMult;
        if (t.curSeg < t.maxSegs) {
          const [dx, dy] = DIRS[t.dir];
          const step = t.speed / 60;
          t.x += dx * step; t.y += dy * step;
          t.path.push({ x: t.x, y: t.y });
          if (t.path.length > 500) t.path.shift();
          if ((t.segLen -= step) <= 0) {
            t.curSeg++;
            t.dir = (t.dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
            t.segLen = 45 + Math.random() * 145;
            t.nodes.push({ x: t.x, y: t.y });
          }
        }
        if (t.path.length < 2) continue;
        _ctx.beginPath();
        _ctx.moveTo(t.path[0].x, t.path[0].y);
        for (let j = 1; j < t.path.length; j++) _ctx.lineTo(t.path[j].x, t.path[j].y);
        _ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.55})`; _ctx.lineWidth = 1; _ctx.stroke();
        t.nodes.forEach(n => {
          _ctx.beginPath(); _ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
          _ctx.fillStyle = `rgba(${r},${g},${b},${a})`; _ctx.fill();
        });
        const last = t.path[t.path.length - 1];
        _ctx.beginPath(); _ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a * 1.8)})`; _ctx.fill();
      }
      _rafMain(frame);
    }
    frame();
  }

  function _rain(sp) {
    const [r, g, b] = _accentRgb();
    const W = () => _canvas.width || 1920, H = () => _canvas.height || 1080;
    const count = Math.floor(W() / 10);
    const drops = Array.from({ length: count }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      len:   15 + Math.random() * 55,
      speed: (1.5 + Math.random() * 4.5) * sp,
      alpha: 0.06 + Math.random() * 0.18,
      thick: Math.random() < 0.06 ? 2 : 1,
    }));
    function frame() {
      const w = W(), h = H();
      _ctx.clearRect(0, 0, w, h);
      drops.forEach(d => {
        d.y += d.speed;
        if (d.y - d.len > h) {
          d.y = -d.len; d.x = Math.random() * w;
          d.len = 15 + Math.random() * 55; d.speed = (1.5 + Math.random() * 4.5) * sp;
          d.alpha = 0.06 + Math.random() * 0.18;
        }
        const gr = _ctx.createLinearGradient(d.x, d.y - d.len, d.x, d.y);
        gr.addColorStop(0,   `rgba(${r},${g},${b},0)`);
        gr.addColorStop(0.5, `rgba(${r},${g},${b},${d.alpha * 0.4})`);
        gr.addColorStop(1,   `rgba(${r},${g},${b},${d.alpha})`);
        _ctx.strokeStyle = gr; _ctx.lineWidth = d.thick;
        _ctx.beginPath(); _ctx.moveTo(d.x, d.y - d.len); _ctx.lineTo(d.x, d.y); _ctx.stroke();
      });
      _rafMain(frame);
    }
    frame();
  }

  // ── Fog helpers ──────────────────────────────────────────────────────────────
  function _makeFogPuffs() {
    if (_persistedFogData) return _persistedFogData; // reuse existing positions — fog never resets mid-show
    const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
    // Background layer: large, slow, deep — cool blue-white tones
    const bgPuffs = Array.from({ length: 12 }, () => ({
      x:          Math.random() * w,
      y:          h * (0.74 + Math.random() * 0.27),
      rx:         320 + Math.random() * 280,
      ry:         65  + Math.random() * 90,
      vx:         (Math.random() - 0.5) * 0.22,
      alpha:      0.026 + Math.random() * 0.030,
      phase:      Math.random() * Math.PI * 2,
      phase2:     Math.random() * Math.PI * 2,
      phase3:     Math.random() * Math.PI * 2,
      phaseSpeed: 0.00025 + Math.random() * 0.00045,
      cr: 198 + Math.floor(Math.random() * 18),
      cg: 218 + Math.floor(Math.random() * 14),
      cb: 245 + Math.floor(Math.random() * 10),
    }));
    // Foreground layer: smaller, faster, more prominent — slight warm-white variation
    const fgPuffs = Array.from({ length: 16 }, () => ({
      x:          Math.random() * w,
      y:          h * (0.67 + Math.random() * 0.35),
      rx:         140 + Math.random() * 170,
      ry:         30  + Math.random() * 52,
      vx:         (Math.random() - 0.5) * 0.52,
      alpha:      0.038 + Math.random() * 0.058,
      phase:      Math.random() * Math.PI * 2,
      phase2:     Math.random() * Math.PI * 2,
      phase3:     Math.random() * Math.PI * 2,
      phaseSpeed: 0.00065 + Math.random() * 0.0011,
      cr: 213 + Math.floor(Math.random() * 20),
      cg: 226 + Math.floor(Math.random() * 14),
      cb: 248 + Math.floor(Math.random() * 8),
    }));
    _persistedFogData = { bgPuffs, fgPuffs };
    return _persistedFogData;
  }

  function _drawFogFrame(ctx, canvas, fogData, intensity) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Multi-stop base gradient — builds density toward ground
    const base = ctx.createLinearGradient(0, h * 0.54, 0, h);
    base.addColorStop(0,    'rgba(200,215,235,0)');
    base.addColorStop(0.28, `rgba(202,218,238,${0.016 * intensity})`);
    base.addColorStop(0.62, `rgba(206,221,242,${0.052 * intensity})`);
    base.addColorStop(1,    `rgba(210,225,245,${0.088 * intensity})`);
    ctx.fillStyle = base;
    ctx.fillRect(0, h * 0.54, w, h * 0.46);

    function drawPuff(p) {
      // Multi-frequency drift for organic, non-repeating motion
      p.phase  += p.phaseSpeed;
      p.phase2 += p.phaseSpeed * 2.31;
      p.phase3 += p.phaseSpeed * 0.73;
      const vxDynamic = p.vx + Math.sin(p.phase * 0.38 + p.phase2) * 0.16;
      p.x = (p.x + vxDynamic + w) % w;
      const cy = p.y
        + Math.sin(p.phase)        * 13
        + Math.sin(p.phase2)       *  6
        + Math.sin(p.phase3 * 1.4) *  4;

      // Render at x and at wrapped edge positions so puffs don't pop
      const xs = [p.x];
      if (p.x < p.rx + 40)      xs.push(p.x + w);
      if (p.x > w - p.rx - 40)  xs.push(p.x - w);

      xs.forEach(px => {
        ctx.save();
        ctx.translate(px, cy);
        ctx.scale(1, p.ry / p.rx);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
        gr.addColorStop(0,    `rgba(${p.cr},${p.cg},${p.cb},${p.alpha * intensity})`);
        gr.addColorStop(0.42, `rgba(${p.cr},${p.cg},${p.cb},${p.alpha * intensity * 0.55})`);
        gr.addColorStop(1,    `rgba(${p.cr},${p.cg},${p.cb},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(0, 0, p.rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    fogData.bgPuffs.forEach(drawPuff);
    fogData.fgPuffs.forEach(drawPuff);
  }

  function _fog(sp) {
    const fogData = _makeFogPuffs();
    function frame() {
      if (!_canvas) return;
      _drawFogFrame(_ctx, _canvas, fogData, 0.9);
      _rafMain(frame);
    }
    frame();
  }

  function _wave(sp, bgImgUrl) {
    const [r, g, b] = _accentRgb();
    let phase = 0;
    let bgImg = null;
    if (bgImgUrl) { bgImg = new Image(); bgImg.crossOrigin = 'anonymous'; bgImg.src = bgImgUrl; }
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      phase += 0.007 * sp;
      if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
        const STRIP_H = 4;
        for (let y = 0; y < h; y += STRIP_H) {
          const ny = y / h;
          const dx = Math.sin(ny * Math.PI * 5 + phase) * 14 * Math.sqrt(sp)
                   + Math.cos(ny * Math.PI * 2 + phase * 0.65) * 6 * Math.sqrt(sp);
          _ctx.drawImage(bgImg, 0, y, w, STRIP_H, dx, y, w, STRIP_H);
        }
        for (let i = 0; i < 3; i++) {
          const yBase = h * (0.25 + i * 0.25), amp = h * 0.02;
          _ctx.beginPath(); _ctx.moveTo(0, yBase);
          for (let x = 0; x <= w; x += 10)
            _ctx.lineTo(x, yBase + Math.sin(x / w * Math.PI * 4 + phase + i) * amp);
          _ctx.strokeStyle = `rgba(${r},${g},${b},0.12)`; _ctx.lineWidth = 1; _ctx.stroke();
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const yBase = h * (0.08 + i * 0.16), amp = h * (0.025 + i * 0.004);
          const freq = 2 + i * 0.7, alpha = 0.025 + i * 0.013;
          _ctx.beginPath(); _ctx.moveTo(0, yBase);
          for (let x = 0; x <= w; x += 6)
            _ctx.lineTo(x, yBase + Math.sin(x / w * Math.PI * freq + phase + i * 0.9) * amp
                                 + Math.sin(x / w * Math.PI * freq * 0.5 + phase * 1.3) * amp * 0.4);
          _ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          _ctx.lineWidth = 0.8 + i * 0.25; _ctx.stroke();
        }
        const shimY = ((phase * 100) % h + h) % h;
        const shimGrad = _ctx.createLinearGradient(0, shimY - 35, 0, shimY + 35);
        shimGrad.addColorStop(0, 'rgba(255,255,255,0)');
        shimGrad.addColorStop(0.5, `rgba(${r},${g},${b},0.04)`);
        shimGrad.addColorStop(1, 'rgba(255,255,255,0)');
        _ctx.fillStyle = shimGrad; _ctx.fillRect(0, shimY - 35, w, 70);
      }
      _rafMain(frame);
    }
    frame();
  }

  return { applyTheme, applyBackground, applyAnimation, resolveEasing, EASINGS, bgSpeed, palette, accent, logo, stopBgAnimation };
})();
