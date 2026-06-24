// League of Legends adapter — captures the app's original (pre-multi-game) behaviour, so
// routing LoL through the adapter is a no-op. The 20-step draft sequence itself still
// lives in public/graphics/draft/draft.js (DRAFT_SEQUENCE); extracting it into a
// pluggable pre-game module is deferred to Phase 1 (when CS2 map-veto forces it).
module.exports = {
  id:    'lol',
  label: 'League of Legends',
  roster: {
    positions: ['Top', 'Jungle', 'Mid', 'Bot', 'Support'],
    teamSize:  5,
    hasSubs:   true,
  },
  pregame: {
    kind:       'champ-draft',  // full pick/ban draft, shown as a broadcast scene
    pickEntity: 'champion',
    fearless:   true,           // fearless draft (no repeat champions across a series)
  },
  assets: { source: 'ddragon' }, // champion art synced from Riot DDragon
  intel:  { provider: 'opgg' },  // rank / champ-pool / draft champ-stats via op.gg + Riot
};
