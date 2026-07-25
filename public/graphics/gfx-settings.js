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

  // Strip characters that could break out of a quoted CSS font-family name.
  function _cssFontName(name) { return String(name || '').replace(/['"\\<>;{}]/g, '').trim(); }

  // Inject @font-face rules for any uploaded custom fonts carried in the broadcast
  // settings, so a chosen custom family renders on overlays. Idempotent.
  function _applyCustomFonts(list) {
    var css = (Array.isArray(list) ? list : []).map(function (f) {
      var name = _cssFontName(f && f.name), url = f && f.url;
      if (!name || !url) return '';
      var fmt = /\.woff2(\?|$)/i.test(url) ? 'woff2' : /\.woff(\?|$)/i.test(url) ? 'woff'
              : /\.otf(\?|$)/i.test(url)  ? 'opentype' : 'truetype';
      return "@font-face{font-family:'" + name + "';font-display:swap;src:url('" + url + "') format('" + fmt + "');}";
    }).join('\n');
    var el = document.getElementById('_gfx-custom-fonts');
    if (!el) { el = document.createElement('style'); el.id = '_gfx-custom-fonts'; document.head.appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
  }

  // Hex (#rgb or #rrggbb) → "r, g, b" triplet string for use inside rgba(var(...), a).
  function _hexTriplet(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(isNaN)) return null;
    return r + ', ' + g + ', ' + b;
  }

  var _lastThemeKey = null;
  function applyTheme(el, s) {
    const st = get(s);
    const pal = st.palette || [];
    const defaults = ['#1ffaff', '#a7a38e', '#e8e6df', '#070f12'];
    // applyTheme runs on EVERY state broadcast in every overlay, but the theme
    // (palette / accents / bg colour / fonts) rarely changes mid-show. Skip the
    // ~15 redundant :root writes + custom-font rebuild when nothing themable
    // changed, so frequent broadcasts (e.g. typing in a control field) don't
    // dirty every overlay's root style. Mirrors applyAnimation's _lastAnimKey gate.
    const themeKey = [
      (pal[0] && pal[0].hex) || '', (pal[1] && pal[1].hex) || '',
      (pal[2] && pal[2].hex) || '', (pal[3] && pal[3].hex) || '',
      st.blueAccent || '', st.redAccent || '', st.bgColor || '',
      st.overlayFont || '', st.overlayFont2 || '',
      String(st.cornerRadius == null ? st.cornerStyle || '' : st.cornerRadius), st.surfaceStyle || '', st.textCase || '',
      (Array.isArray(st.customFonts) ? st.customFonts : [])
        .map(function (f) { return (f && f.name) + ':' + (f && f.url); }).join(','),
    ].join('|');
    if (themeKey === _lastThemeKey) return;
    _lastThemeKey = themeKey;
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

    // Overlay typography — Primary (display) + Secondary (labels) broadcast fonts,
    // themeable like the palette. Empty = leave unset so the CSS fallback chain wins:
    // secondary elements use `var(--gfx-font-2, var(--gfx-font, 'Barlow Condensed'))`,
    // so an unset secondary falls back to the primary, then to the literal default.
    _applyCustomFonts(st.customFonts);
    var font = _cssFontName(st.overlayFont);
    if (font) el.style.setProperty('--gfx-font', "'" + font + "'");
    else      el.style.removeProperty('--gfx-font');
    var font2 = _cssFontName(st.overlayFont2);
    if (font2) el.style.setProperty('--gfx-font-2', "'" + font2 + "'");
    else       el.style.removeProperty('--gfx-font-2');

    // ── Structural theme (shape / surface / label style) ──────────────────────
    // Each token stays UNSET for its DEFAULT value, so the wired CSS falls back to
    // its own designed literal (per-element radii, glass surfaces, per-rule label
    // tracking) and the default look is reproduced exactly. Only a non-default
    // choice sets a token, overriding uniformly across every overlay.
    var cr = st.cornerRadius;
    if (cr === undefined && typeof st.cornerStyle === 'string') cr = ({ sharp: 0, soft: 3, round: 14 })[st.cornerStyle]; // legacy enum
    if (typeof cr === 'number' && isFinite(cr)) el.style.setProperty('--gfx-radius', cr + 'px');
    else                                        el.style.removeProperty('--gfx-radius');

    // Surface — overlays composite over OBS with no backdrop-filter, so "glass" is
    // pure translucency. Default 'glass' leaves both tokens unset (each panel keeps
    // its own surface); 'solid' = opaque, 'outline' = near-transparent fill + accent edge.
    var surf = st.surfaceStyle;
    if (surf === 'solid') {
      el.style.setProperty('--gfx-panel-bg', 'rgb(var(--gfx-c4-rgb, 7,15,18))');
      el.style.removeProperty('--gfx-panel-border');
    } else if (surf === 'outline') {
      el.style.setProperty('--gfx-panel-bg', 'rgba(var(--gfx-c4-rgb, 7,15,18), 0.22)');
      el.style.setProperty('--gfx-panel-border', '1px solid rgba(var(--gfx-c1-rgb, 31,250,255), 0.6)');
    } else {                                                                // 'glass' / default
      el.style.removeProperty('--gfx-panel-bg');
      el.style.removeProperty('--gfx-panel-border');
    }

    // Text case — global across every overlay (names + labels). Default 'upper'
    // leaves the token UNSET so wired CSS falls back to its own `uppercase` literal.
    if (st.textCase === 'normal') el.style.setProperty('--gfx-text-transform', 'none');
    else                          el.style.removeProperty('--gfx-text-transform');    // 'upper' / default
  }

  function applyBackground(el, s) {
    const st = get(s);
    _setBgFps(st.bgFps);

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
      st.bgRenderer    || 'gpu',
      st.bgFps != null ? String(st.bgFps) : '60',
      st.bgWaveMode    || 'clean',
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
      case 'animation': {
        el.style.background = st.bgColor || '#070f12';
        const animType = st.bgAnimation || 'particles';
        const useGpu = (st.bgRenderer || 'gpu') === 'gpu';
        const acc = _accentRgb();
        const glColor = [acc[0] / 255, acc[1] / 255, acc[2] / 255];
        // `wave` has two styles: 'clean' (the GPU shader sine-bands) and 'image'
        // (canvas-only — ripples a loaded bg image, scaled to cover). Image style
        // forces the canvas path; both renderer settings then behave identically.
        const waveImg = (animType === 'wave' && st.bgWaveMode === 'image') ? (st.bgImage || '') : '';
        const gpuOk = useGpu && _glSupportsType(animType) && !waveImg;
        // Try the GPU/shader path first; _startGLAnimation returns false (and the
        // canvas path runs) when the type has no shader or WebGL is unavailable.
        if (!(gpuOk && _startGLAnimation(el, animType, bgSpeed(s), glColor))) {
          _startBgAnimation(el, animType, bgSpeed(s), waveImg);
        }
        break;
      }
      case 'transparent':
      default:
        el.style.background = 'transparent';
    }
    if (st.bgFogLayer) {
      const intensity = Math.max(0.1, Math.min(1, (st.bgFogIntensity != null ? st.bgFogIntensity : 50) / 100));
      _startFogLayer(el, intensity);
    }
  }

  // Force an overlay element fully transparent and tear down any running bg
  // animation/fog. Graphic overlays are always transparent now — any animated
  // background runs only in the dedicated BG Output source (cheaper: one canvas
  // in its own browser source instead of a canvas composited inside every graphic).
  function clearBackground(el) {
    stopBgAnimation();
    if (el) { el.style.background = 'transparent'; el.style.backgroundImage = 'none'; }
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

  // ── Logo library ────────────────────────────────────────────────────────────
  // Every graphic resolves its logo through ONE chain: graphic pick → event logo → none.
  // A placement stores a library ENTRY ID, so replacing the file in the library updates
  // every graphic at once. Accepts the whole state or just the settings object.
  //   ''/'auto'/unknown id → the event logo   ·   'none' → nothing
  //   a literal URL        → used as-is (legacy saves, written before the library existed)
  function _logoSet(s) { return (get(s).logoSet || (s && s.logoSet) || {}); }
  function _findLogo(ls, id) {
    var logos = ls.logos || [];
    for (var i = 0; i < logos.length; i++) if (logos[i] && logos[i].id === id) return logos[i];
    return null;
  }
  function logoUrl(s, ref) {
    var ls = _logoSet(s);
    var r = String(ref == null ? '' : ref).trim();
    if (r === 'none') return '';
    if (/^(https?:\/\/|\/|data:)/i.test(r)) return r;
    var hit = r && _findLogo(ls, r);
    if (hit) return hit.url || '';
    var ev = ls.eventLogoId && _findLogo(ls, ls.eventLogoId);
    return (ev && ev.url) || '';
  }
  // The event logo on its own (no per-graphic pick) — for graphics that only ever show it.
  function eventLogo(s) { return logoUrl(s, ''); }
  // Sponsor placements, in the operator's order.
  function sponsorLogos(s) {
    var ls = _logoSet(s);
    return (ls.sponsorIds || []).map(function (id) {
      var l = _findLogo(ls, id); return l && l.url;
    }).filter(Boolean);
  }

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

  // Frame-rate cap. We output 60fps to Twitch, so there's no value rendering the
  // bg canvas faster than that on a high-refresh dev monitor — skip frames that
  // arrive early. 1000/61 keeps true 60Hz displays running every frame (16.67ms ≥
  // 16.39ms) while clamping 120/144Hz down to ~60.
  // Configurable cap, derived from bgFps (default 60). 1000/(fps+1) keeps a true
  // fps-Hz display running every frame while clamping higher-refresh monitors down.
  // The 'Performance' (30fps) mode halves per-frame work for the slow ambient bgs.
  let _frameMs = 1000 / 61;
  function _setBgFps(fps) { _frameMs = 1000 / ((Number(fps) || 60) + 1); }
  var _mainLastTs = 0, _fogLastTs = 0;

  // Pause render loops when the page isn't actually being shown. document.hidden
  // covers tab/scene switches, but OBS does NOT reliably set it for a source merely
  // toggled invisible (the eye icon) inside an active scene — so also honour OBS's
  // obsSourceVisibleChanged (eye toggle) / obsSourceActiveChanged (program) events,
  // which it dispatches to browser sources. Defaults stay 'shown' for non-OBS hosts.
  let _obsVisible = true, _obsActive = true;
  var _resumeGL = null; // set by the WebGL engine so it resumes alongside the canvas loops
  function _renderPaused() { return document.hidden || !_obsVisible || !_obsActive; }

  function _rafMain(fn) {
    _animFrameFn = fn;
    if (_renderPaused()) { _animId = null; return; }
    _animId = requestAnimationFrame(function (ts) {
      if (ts - _mainLastTs < _frameMs) { _rafMain(fn); return; } // early frame — skip, recheck next tick
      _mainLastTs = ts;
      fn(ts);
    });
  }
  function _rafFog(fn) {
    _fogAnimFrameFn = fn;
    if (_renderPaused()) { _fogAnimId = null; return; }
    _fogAnimId = requestAnimationFrame(function (ts) {
      if (ts - _fogLastTs < _frameMs) { _rafFog(fn); return; }
      _fogLastTs = ts;
      fn(ts);
    });
  }
  function _resumeRenderLoops() {
    if (_renderPaused()) return;
    if (_animFrameFn    && _animId    == null) _animId    = requestAnimationFrame(_animFrameFn);
    if (_fogAnimFrameFn && _fogAnimId == null) _fogAnimId = requestAnimationFrame(_fogAnimFrameFn);
    if (_resumeGL) _resumeGL();
  }
  document.addEventListener('visibilitychange', _resumeRenderLoops);
  window.addEventListener('obsSourceVisibleChanged', function (e) {
    _obsVisible = !!(e && e.detail && e.detail.visible);
    _resumeRenderLoops();
  });
  window.addEventListener('obsSourceActiveChanged', function (e) {
    _obsActive = !!(e && e.detail && e.detail.active);
    _resumeRenderLoops();
  });

  function stopBgAnimation() {
    if (_animId)     { cancelAnimationFrame(_animId); _animId = null; }
    if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
    if (_bgResizeFn) { window.removeEventListener('resize', _bgResizeFn); _bgResizeFn = null; }
    _canvas = null; _ctx = null; _animFrameFn = null; _mainLastTs = 0;
    _stopGLAnimation(); // tear down the GPU path too, so neither renderer lingers
    stopFogLayer();
  }

  function stopFogLayer() {
    if (_fogAnimId)     { cancelAnimationFrame(_fogAnimId); _fogAnimId = null; }
    if (_fogCanvas && _fogCanvas.parentNode) _fogCanvas.parentNode.removeChild(_fogCanvas);
    if (_fogResizeFn)   { window.removeEventListener('resize', _fogResizeFn); _fogResizeFn = null; }
    _fogCanvas = null; _fogCtx = null; _fogAnimFrameFn = null; _fogLastTs = 0;
  }

  // ── WebGL background engine (opt-in GPU path) ────────────────────────────────
  // A single full-screen quad + one procedural fragment shader per bg type renders
  // the whole frame in one GPU draw call — far cheaper than the thousands of 2D
  // canvas ops the equivalent animation needs. Falls back to the canvas path when a
  // type has no shader or the context can't be created. Only ONE renderer is ever
  // live; stopBgAnimation tears both down so nothing lingers when unselected.
  let _glCanvas = null, _gl = null, _glProgram = null, _glAnimId = null;
  let _glResizeFn = null, _glPhase = 0, _glSpeed = 1, _glLastTs = 0;
  let _glU = null, _glDraw = null;

  const _GL_VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

  // Fragment-shader registry keyed by bg animation type. Each procedural shader
  // replicates the look of the same-named canvas animation, baking in that
  // animation's exact constants. Uniforms (via _GL_HEAD): uRes (px), uTime
  // (generic frame-time = accumulated speed/frame; each shader applies its own
  // rate), uColor (theme accent, 0..1). gl_FragCoord origin is bottom-left, so
  // every shader flips Y (`fc`) to match the canvas top-left origin. Output is
  // premultiplied (vec4(rgb*a, a)) for correct transparent compositing.
  // Only the types whose canvas versions are draw-call-heavy are shader-backed;
  // cheap/stateful ones (particles, rings, circuit, fog) stay on canvas via fallback.
  const _GL_HEAD = 'precision highp float;uniform vec2 uRes;uniform float uTime;uniform vec3 uColor;const float PI=3.14159265;\n';
  const _GL_FRAG = {
    // ~2040 dots/frame on canvas — the biggest win.
    dotwave: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'float SP=44.0,R=1.4,ph=uTime*0.008;' +
      'vec2 gp=floor(fc/SP+0.5)*SP;float d=length(fc-gp);' +
      'float wave=sin(gp.x/uRes.x*PI*4.0+ph)*cos(gp.y/uRes.y*PI*3.0+ph*0.75)*0.5+0.5;' +
      'float a=(0.04+wave*0.16)*(1.0-smoothstep(R-0.6,R+0.6,d));' +
      'gl_FragColor=vec4(vec3(a),a);}',
    // Orthogonal grid, 44px, pulsing alpha.
    grid: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'float SP=44.0;vec2 m=mod(fc,SP);vec2 dl=min(m,SP-m);' +
      'float line=max(1.0-smoothstep(0.0,1.0,dl.x),1.0-smoothstep(0.0,1.0,dl.y));' +
      'float a=(0.055+sin(uTime*0.009)*0.02)*line;gl_FragColor=vec4(vec3(a),a);}',
    // 45°-rotated grid, 40px.
    diamonds: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'vec2 p=fc-uRes*0.5;float s=0.70710678;vec2 rp=vec2(p.x*s+p.y*s,-p.x*s+p.y*s);' +
      'float SP=40.0;vec2 m=mod(rp,SP);vec2 dl=min(m,SP-m);' +
      'float line=max(1.0-smoothstep(0.0,1.0,dl.x),1.0-smoothstep(0.0,1.0,dl.y));' +
      'float a=(0.055+sin(uTime*0.007)*0.018)*line;gl_FragColor=vec4(vec3(a),a);}',
    // Diagonal scrolling stripes, 55px.
    lines: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'vec2 p=fc-uRes*0.5;float s=0.70710678;float rx=p.x*s+p.y*s;' +
      'float SP=55.0;float m=mod(rx-uTime*0.18,SP);float d=min(m,SP-m);' +
      'float a=0.05*(1.0-smoothstep(0.0,1.0,d));gl_FragColor=vec4(vec3(a),a);}',
    // Six drifting accent-coloured sine bands (no-image wave variant).
    wave: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'float ph=uTime*0.007,x=fc.x/uRes.x,a=0.0;' +
      'for(int i=0;i<6;i++){float fi=float(i);' +
      'float yBase=uRes.y*(0.08+fi*0.16),amp=uRes.y*(0.025+fi*0.004),freq=2.0+fi*0.7;' +
      'float y=yBase+sin(x*PI*freq+ph+fi*0.9)*amp+sin(x*PI*freq*0.5+ph*1.3)*amp*0.4;' +
      'a+=(0.025+fi*0.013)*(1.0-smoothstep(0.8+fi*0.25,2.3+fi*0.25,abs(fc.y-y)));}' +
      'a=min(a,1.0);gl_FragColor=vec4(uColor*a,a);}',
    // Accent rain: one falling streak per ~14px column, hashed length/speed/alpha.
    rain: _GL_HEAD +
      'float h11(float n){return fract(sin(n*12.9898)*43758.5453);}' +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'float colW=14.0;float col=floor(fc.x/colW);' +
      'float h1=h11(col),h2=h11(col+11.3),h3=h11(col+27.7);' +
      'float len=15.0+h1*55.0;float speed=1.5+h2*4.5;float al=0.06+h3*0.18;' +
      'float period=uRes.y+len;float headY=mod(uTime*speed+h1*period,period);' +
      'float inStreak=step(headY-len,fc.y)*step(fc.y,headY);' +
      'float grad=clamp((fc.y-(headY-len))/len,0.0,1.0);' +
      'float cx=(col+0.5)*colW;float xline=1.0-smoothstep(0.5,1.5,abs(fc.x-cx));' +
      'float a=al*grad*inStreak*xline;gl_FragColor=vec4(uColor*a,a);}',
    // Pointy-top hex outline grid, size 28, pulsing alpha. Cube-round to the nearest
    // hex centre, then an iq hexagon SDF gives the cell border (outline = |sd|~0).
    hexgrid: _GL_HEAD +
      'void main(){vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);' +
      'float s=28.0,R=24.248711;' +                                                  // R = apothem = s*sqrt(3)/2
      'float q=(0.5773503*fc.x-0.3333333*fc.y)/s;float r=(0.6666667*fc.y)/s;' +      // pixel→axial
      'float cx=q,cz=r,cy=-cx-cz;' +
      'float rx=floor(cx+0.5),ry=floor(cy+0.5),rz=floor(cz+0.5);' +
      'float dx=abs(rx-cx),dy=abs(ry-cy),dz=abs(rz-cz);' +
      'if(dx>dy&&dx>dz){rx=-ry-rz;}else if(dy>dz){ry=-rx-rz;}else{rz=-rx-ry;}' +      // cube round
      'float hx=s*1.7320508*(rx+rz*0.5);float hy=s*1.5*rz;' +                         // nearest centre (px)
      'vec2 p=(fc-vec2(hx,hy)).yx;' +                                                 // swap → pointy-top
      'vec3 k=vec3(-0.8660254,0.5,0.5773503);p=abs(p);' +
      'p-=2.0*min(dot(k.xy,p),0.0)*k.xy;' +
      'p-=vec2(clamp(p.x,-k.z*R,k.z*R),R);' +
      'float sd=length(p)*sign(p.y);' +                                              // hex SDF, 0 at border
      'float a=(0.05+sin(uTime*0.007)*0.018)*(1.0-smoothstep(0.0,1.0,abs(sd)));' +
      'gl_FragColor=vec4(vec3(a),a);}',
  };

  function _glSupportsType(type) { return !!_GL_FRAG[type]; }

  function _glCompile(gl, src, kind) {
    const sh = gl.createShader(kind);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[gfx bg] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh); return null;
    }
    return sh;
  }

  // Returns true if the GL path took over; false → caller uses the canvas path.
  function _startGLAnimation(container, type, sp, color) {
    const frag = _GL_FRAG[type];
    if (!frag) return false;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false })
            || cv.getContext('experimental-webgl');
    if (!gl) return false;
    const vs = _glCompile(gl, _GL_VERT, gl.VERTEX_SHADER);
    const fs = _glCompile(gl, frag, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[gfx bg] program link failed:', gl.getProgramInfoLog(prog));
      return false;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied-alpha compositing

    container.style.position = container.style.position || 'relative';
    container.insertBefore(cv, container.firstChild);

    _glCanvas = cv; _gl = gl; _glProgram = prog;
    _glSpeed = sp; _glPhase = 0; _glLastTs = 0;
    _glU = {
      res:   gl.getUniformLocation(prog, 'uRes'),
      time:  gl.getUniformLocation(prog, 'uTime'),
      color: gl.getUniformLocation(prog, 'uColor'),
    };
    const col = color || [1, 1, 1];

    function resize() {
      const w = container.offsetWidth || window.innerWidth;
      const h = container.offsetHeight || window.innerHeight;
      cv.width = w; cv.height = h;
      gl.viewport(0, 0, w, h);
    }
    resize();
    _glResizeFn = resize;
    window.addEventListener('resize', resize);

    _glDraw = function () {
      gl.uniform2f(_glU.res, cv.width, cv.height);
      gl.uniform1f(_glU.time, _glPhase);
      if (_glU.color) gl.uniform3f(_glU.color, col[0], col[1], col[2]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    _glLoop();
    return true;
  }

  function _glLoop() {
    if (_renderPaused() || !_gl) { _glAnimId = null; return; }
    _glAnimId = requestAnimationFrame(function (ts) {
      if (ts - _glLastTs < _frameMs) { _glLoop(); return; }
      _glLastTs = ts;
      _glPhase += _glSpeed; // generic frame-time; each shader bakes its own rate (matches the canvas per-type constants)
      _glDraw();
      _glLoop();
    });
  }
  _resumeGL = function () { if (_gl && _glProgram && _glAnimId == null) _glLoop(); };

  function _stopGLAnimation() {
    if (_glAnimId)   { cancelAnimationFrame(_glAnimId); _glAnimId = null; }
    if (_glResizeFn) { window.removeEventListener('resize', _glResizeFn); _glResizeFn = null; }
    if (_gl) { const lose = _gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
    if (_glCanvas && _glCanvas.parentNode) _glCanvas.parentNode.removeChild(_glCanvas);
    _glCanvas = null; _gl = null; _glProgram = null; _glU = null; _glDraw = null;
    _glPhase = 0; _glLastTs = 0;
  }

  function _startBgAnimation(container, type, sp, bgImgUrl) {
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
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

  // Pre-rendered dot sprites, one per brightness bucket — built once and reused.
  // Blitting a cached bitmap with drawImage is far cheaper than re-tessellating a
  // fresh arc() path for every one of ~2000 dots each frame (the old hot path).
  let _dotSprites = null, _dotSpriteKey = '';
  function _dotSpriteSet(r, buckets) {
    const key = r + 'x' + buckets;
    if (_dotSprites && _dotSpriteKey === key) return _dotSprites;
    const size = Math.ceil(r * 2) + 2, c = size / 2;
    const arr = [];
    for (let b = 0; b < buckets; b++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const cx = cv.getContext('2d');
      cx.fillStyle = 'rgba(255,255,255,' + (0.04 + b / buckets * 0.16).toFixed(3) + ')';
      cx.beginPath(); cx.arc(c, c, r, 0, Math.PI * 2); cx.fill();
      arr.push(cv);
    }
    _dotSprites = arr; _dotSpriteKey = key;
    return arr;
  }

  function _dotwave(sp) {
    const SPACING = 44, DOT_R = 1.4, BUCKETS = 16; // spacing widened for perf (was 38)
    const sprites = _dotSpriteSet(DOT_R, BUCKETS);
    const off = sprites[0].width / 2; // sprite centre → grid point
    let phase = 0;
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      phase += 0.008 * sp;
      const cols = Math.ceil(w / SPACING) + 1;
      const rows = Math.ceil(h / SPACING) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * SPACING, y = r * SPACING;
          const wave = Math.sin(x / w * Math.PI * 4 + phase) * Math.cos(y / h * Math.PI * 3 + phase * 0.75) * 0.5 + 0.5;
          const b = Math.min(BUCKETS - 1, wave * BUCKETS | 0);
          _ctx.drawImage(sprites[b], (x - off) | 0, (y - off) | 0);
        }
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
    const count = Math.floor(W() / 14); // density trimmed for perf (was /10)
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
    if (bgImgUrl) { bgImg = new Image(); bgImg.src = bgImgUrl; } // no crossOrigin: drawImage only (display), so a tainted image is fine — and it avoids CORS blocking cross-origin/EXTERNAL_URL images
    function frame() {
      const w = _canvas.width, h = _canvas.height;
      _ctx.clearRect(0, 0, w, h);
      phase += 0.007 * sp;
      if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
        const STRIP_H = 4;
        // Scale the source image to COVER the viewport (was sampled 1:1 in canvas
        // pixels, so only the image's top-left corner showed on a larger source).
        const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
        const scale = Math.max(w / iw, h / ih);
        const ox = (w - iw * scale) / 2, oy = (h - ih * scale) / 2;
        const srcX = -ox / scale, srcW = w / scale, srcH = STRIP_H / scale;
        for (let y = 0; y < h; y += STRIP_H) {
          const ny = y / h;
          const dx = Math.sin(ny * Math.PI * 5 + phase) * 14 * Math.sqrt(sp)
                   + Math.cos(ny * Math.PI * 2 + phase * 0.65) * 6 * Math.sqrt(sp);
          _ctx.drawImage(bgImg, srcX, (y - oy) / scale, srcW, srcH, dx, y, w, STRIP_H);
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

  return { applyTheme, applyBackground, clearBackground, applyAnimation, resolveEasing, EASINGS, bgSpeed, palette, accent, logo, logoUrl, eventLogo, sponsorLogos, stopBgAnimation };
})();
