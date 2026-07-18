// VALORANT adapter. A map-veto game like CS2 (Bo-N maps, veto/pick) — so it REUSES the CS2
// map-veto + map-intro pipeline via pregameKind:'map-veto'. Agents lock simultaneously with
// no public reveal, so there is NO pick/ban draft board; agents surface in Player Intro +
// Post-Game instead. No official live GSI feed — data is manual (which agent each player ran,
// starting sides, final score, winner). Roster is keyed by Riot ID (Name#TAG) like LoL.
// Agent + map art are synced locally from valorant-api.com (scripts/sync-valorant.js).
module.exports = {
  id:    'valorant',
  label: 'VALORANT',
  maturity: 'alpha',  // control-room only (never on-air): map-veto works; agents in graphics next

  roster: {
    positions: ['', '', '', '', ''],  // no fixed player roles (agent roles are per-agent; players flex)
    teamSize:  5,
    hasSubs:   true,
    idScheme:  'riot',   // Riot ID (Name#TAG) — same field LoL uses
  },
  pregame: {
    kind:       'map-veto',  // reuses the CS2 veto/intro graphics + control UI
    pickEntity: 'map',
    fearless:   false,
  },
  assets: { source: 'valorant' },  // agents (portraits/icons) + map art, synced from valorant-api.com
  intel:  { provider: 'none' },    // no op.gg-style live intel (3rd-party stats a later maybe)
  liveData: { gsi: false },        // no official live feed — manual data entry

  // Current competitive map pool (rotates per act — the operator can edit it in Tournament
  // Setup). Each map's `image` points at the locally-synced splash so the veto/intro use it
  // directly (bypassing the CS2 `de_<slug>` art proxy). Run scripts/sync-valorant.js to fetch.
  defaultMapPool: [
    { name: 'Ascent', image: '/valmaps/ascent.webp' },
    { name: 'Bind',   image: '/valmaps/bind.webp' },
    { name: 'Haven',  image: '/valmaps/haven.webp' },
    { name: 'Lotus',  image: '/valmaps/lotus.webp' },
    { name: 'Split',  image: '/valmaps/split.webp' },
    { name: 'Sunset', image: '/valmaps/sunset.webp' },
    { name: 'Icebox', image: '/valmaps/icebox.webp' },
  ],
};
