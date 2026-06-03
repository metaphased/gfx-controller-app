/* ============================================================================
   MetaGFX — shared UI theme applier
   Applies a saved theme (preset + accent/panel overrides) to any chrome surface.
   Pairs with /shared/tokens.css. Load this in <head> BEFORE first paint.

   Effective theme resolution (most→least specific):
     per-user saved theme  ->  superadmin panel default  ->  Graphite baseline
   A localStorage cache is applied synchronously to avoid a flash, then the
   server value (from /api/auth/me) reconciles it.
   ============================================================================ */
(function () {
  const PRESETS = ['graphite', 'steel', 'bronze'];
  const CACHE_KEY = 'metagfx.theme';
  const root = document.documentElement;

  function hslToRgb(h, s, l) {
    h /= 360;
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p; };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
      r = f(p, q, h + 1/3); g = f(p, q, h); b = f(p, q, h - 1/3); }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // Clear inline overrides so the chosen preset's CSS values show through.
  function clearOverrides() {
    ['--accent', '--accent-rgb', '--bg2', '--bg3', '--bg-raise'].forEach(v => root.style.removeProperty(v));
  }

  function apply(theme) {
    theme = theme || {};
    root.setAttribute('data-theme', PRESETS.includes(theme.preset) ? theme.preset : 'graphite');
    clearOverrides();

    if (theme.accentHue != null && theme.accentSat != null) {
      const h = +theme.accentHue, s = +theme.accentSat;
      const [r, g, b] = hslToRgb(h, s / 100, 0.70);
      root.style.setProperty('--accent', `hsl(${h} ${s}% 70%)`);
      root.style.setProperty('--accent-rgb', `${r},${g},${b}`);
    }
    if (theme.panelLight != null) {
      const l = +theme.panelLight;
      root.style.setProperty('--bg2', `hsl(220 6% ${l}%)`);
      root.style.setProperty('--bg3', `hsl(220 6% ${l + 5}%)`);
      root.style.setProperty('--bg-raise', `hsl(220 6% ${l + 9}%)`);
    }
  }

  function cache(theme) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(theme || {})); } catch (e) {} }
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; } }

  // 1) Instant apply from cache (no flash).
  const cached = readCache();
  if (cached) apply(cached);

  // 2) Reconcile from the server: user theme overrides the panel default.
  function refresh() {
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return null;
        const effective = (data.user && data.user.theme) || data.themeDefault || { preset: 'graphite' };
        apply(effective);
        cache(effective);
        return { user: (data.user && data.user.theme) || null, default: data.themeDefault || null, effective };
      })
      .catch(() => null);
  }

  window.MetaTheme = { apply, cache, refresh, hslToRgb, PRESETS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
