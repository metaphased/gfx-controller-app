// Dota 2 adapter. Like LoL it has a hero pick/ban draft (Captains Mode) + meaningful roster
// positions (1–5) + per-hero art — so it reuses the champion-style "pick entity" shape, with
// 'hero' as the entity. The hero-draft broadcast graphic, hero assets, and optional GSI
// live-data hook (official Dota 2 GSI carries the full draft block) land in later sub-steps;
// until then Dota 2 gets the full shared graphic set and a manual roster. In-game HUDs are out
// of scope. Starts 'alpha' (adapter only) → 'beta' once the draft + assets ship.
module.exports = {
  id:    'dota2',
  label: 'Dota 2',
  maturity: 'alpha',  // control-room only; bumps to 'beta' when the hero draft + assets land
  roster: {
    positions: ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'], // Dota positions 1–5
    teamSize:  5,
    hasSubs:   true,
  },
  pregame: {
    kind:       'hero-draft',  // Captains Mode pick/ban, shown as a broadcast scene (later sub-step)
    pickEntity: 'hero',
    fearless:   false,
  },
  assets: { source: 'dota-heroes' }, // hero portraits (Valve CDN / OpenDota), not DDragon champions
  intel:  { provider: 'opendota' },  // OpenDota / STRATZ — a later, optional data hook
};
