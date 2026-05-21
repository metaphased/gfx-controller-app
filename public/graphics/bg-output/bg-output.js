const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

socket.on('state', function(state) {
  const bgo = state.bgOutput || {};

  // Build a pseudo-settings object so GfxSettings helpers work unchanged
  const pseudo = {
    settings: {
      bgType:         bgo.bgType         || 'animation',
      bgAnimation:    bgo.bgAnimation    || 'particles',
      bgColor:        bgo.bgColor        || '#070f12',
      bgImage:        bgo.bgImage        || '',
      bgFogLayer:     bgo.bgFogLayer     || false,
      bgFogIntensity: bgo.bgFogIntensity != null ? bgo.bgFogIntensity : 50,
      animation:      bgo.animation      || { bgSpeed: 'medium' },
      palette:        bgo.palette        || [],
    },
  };

  GfxSettings.applyTheme(document.documentElement, pseudo);
  GfxSettings.applyBackground(document.body, pseudo);
});
