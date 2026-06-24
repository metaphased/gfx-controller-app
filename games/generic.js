// Generic fallback adapter — used for any title without a dedicated adapter yet
// (Phase 0: valorant, cs2, and "generic / other"). Provides the game-agnostic broadcast
// graphics with a neutral 5-slot roster, no draft presentation, and no champion-style
// assets/intel. Dedicated adapters (cs2.js, dota2.js, …) replace it per phase.
module.exports = {
  id:    'generic',
  label: '',
  roster: {
    positions: ['', '', '', '', ''], // 5 unlabelled slots
    teamSize:  5,
    hasSubs:   true,
  },
  pregame: {
    kind:       'none',
    pickEntity: null,
    fearless:   false,
  },
  assets: { source: 'static' },
  intel:  { provider: 'none' },
};
