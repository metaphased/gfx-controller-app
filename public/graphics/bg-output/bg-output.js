const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _bgoHash = '';

socket.on('state', function(state) {
  const bgo  = state.bgOutput || {};
  const hash = JSON.stringify(bgo);
  if (hash === _bgoHash) return;
  _bgoHash = hash;

  // Build a pseudo-settings object so GfxSettings helpers work unchanged
  const pseudo = {
    settings: {
      bgType:         bgo.bgType         || 'animation',
      bgAnimation:    bgo.bgAnimation    || 'particles',
      bgColor:        bgo.bgColor        || '#070f12',
      bgImage:        bgo.bgImage        || '',
      bgFogLayer:     bgo.bgFogLayer     || false,
      bgFogIntensity: bgo.bgFogIntensity != null ? bgo.bgFogIntensity : 50,
      bgRenderer:     bgo.bgRenderer     || 'gpu',
      bgFps:          bgo.bgFps          != null ? bgo.bgFps : 60,
      bgWaveMode:     bgo.bgWaveMode     || 'clean',
      animation:      bgo.animation      || { bgSpeed: 'medium' },
      palette:        bgo.palette        || [],
    },
  };

  GfxSettings.applyTheme(document.documentElement, pseudo);
  GfxSettings.applyBackground(document.body, pseudo);
});
