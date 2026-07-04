// Counter-Strike 2 adapter. Broadcast graphics + a map-veto pre-game presentation
// (the LoL-draft equivalent). No rigid roster roles (CS2 roles are loose: IGL/AWP/entry…),
// so positions are blank. In-game HUDs are out of scope (3rd-party tools). Live data
// (GSI/MatchZy) is a later, optional, DATA-only hook.
module.exports = {
  id:    'cs2',
  label: 'CS2',
  maturity: 'beta',  // control-room only (never on-air): map-veto + live data shipped, hardening

  roster: {
    positions: ['', '', '', '', ''], // 5 slots, no fixed roles
    teamSize:  5,
    hasSubs:   true,
    idScheme:  'steam',  // roster carries optional Steam ID (live-data match override) + HLTV link
    links:     'hltv',   // roster shows an HLTV.org link field (CS2-specific)
  },
  pregame: {
    kind:       'map-veto',  // shown as a broadcast scene; operator-entered
    pickEntity: 'map',
    fearless:   false,
  },
  assets: { source: 'cs2-maps' },  // map-pool images (not DDragon champions)
  intel:  { provider: 'none' },    // FACEIT/HLTV is a later, optional data-only hook
  liveData: { gsi: true, matchzy: true }, // CS2 GSI (observer client) + MatchZy (game server)
  // Fallback active-duty map pool — used to seed a tournament's pool when no saved default
  // exists (settings.mapPoolDefaults.cs2 overrides this). Names only: the map-veto graphic
  // auto-resolves each map's image/icon from its `de_<name>` slug (community
  // MurkyYT/cs2-map-icons repo), with the per-map image field as a custom override.
  defaultMapPool: ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust II', 'Cache'],
};
