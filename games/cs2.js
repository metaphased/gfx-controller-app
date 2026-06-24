// Counter-Strike 2 adapter. Broadcast graphics + a map-veto pre-game presentation
// (the LoL-draft equivalent). No rigid roster roles (CS2 roles are loose: IGL/AWP/entry…),
// so positions are blank. In-game HUDs are out of scope (3rd-party tools). Live data
// (GSI/MatchZy) is a later, optional, DATA-only hook.
module.exports = {
  id:    'cs2',
  label: 'CS2',
  roster: {
    positions: ['', '', '', '', ''], // 5 slots, no fixed roles
    teamSize:  5,
    hasSubs:   true,
  },
  pregame: {
    kind:       'map-veto',  // shown as a broadcast scene; operator-entered
    pickEntity: 'map',
    fearless:   false,
  },
  assets: { source: 'cs2-maps' },  // map-pool images (not DDragon champions)
  intel:  { provider: 'none' },    // FACEIT/HLTV is a later, optional data-only hook
  // Fallback active-duty map pool — used to seed a tournament's pool when no saved default
  // exists (settings.mapPoolDefaults.cs2 overrides this). The pool rotates over time, so
  // it's editable per tournament + the default is settable ("Set as default").
  defaultMapPool: ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust II', 'Overpass'],
};
