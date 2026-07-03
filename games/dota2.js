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
    idScheme:  'steam',  // roster carries optional Steam ID → match GSI live players (name never shown)
  },
  pregame: {
    kind:       'hero-draft',  // Captains Mode pick/ban, shown as a broadcast scene (later sub-step)
    pickEntity: 'hero',
    fearless:   false,
  },
  assets: { source: 'dota-heroes' }, // hero portraits (Valve CDN / OpenDota), not DDragon champions
  hiddenGraphics: ['playerSpotlight'], // spotlight isn't used for Dota — hide it everywhere for this game

  intel:  { provider: 'opendota' },  // OpenDota / STRATZ — a later, optional data hook
  liveData: { gsi: true },           // Dota 2 GSI (observer/GOTV client) — live match data feed
  // Default Captains Mode pick/ban order (team1 = FIRST PICK). 24 steps, 7 bans + 5 picks per
  // team — the 7.34+ order (bans 3-2-2 first-pick / 4-1-2 second-pick, picks 1-3-1), VERIFIED
  // against the picks_bans order of current pro matches via the OpenDota API (2026-07). A
  // PRESET, not gospel — Valve re-tunes CM between patches, so the operator can edit this
  // order in Tournament Settings (settings.heroDraftDefault overrides; "Set as default").
  defaultDraftOrder: [
    // Ban phase 1 — first-pick 3 / second-pick 4
    { team: 'team1', action: 'ban' }, { team: 'team1', action: 'ban' }, { team: 'team2', action: 'ban' }, { team: 'team2', action: 'ban' },
    { team: 'team1', action: 'ban' }, { team: 'team2', action: 'ban' }, { team: 'team2', action: 'ban' },
    // Pick phase 1 — 1 each
    { team: 'team1', action: 'pick' }, { team: 'team2', action: 'pick' },
    // Ban phase 2 — first-pick 2 / second-pick 1
    { team: 'team1', action: 'ban' }, { team: 'team1', action: 'ban' }, { team: 'team2', action: 'ban' },
    // Pick phase 2 — 3 each
    { team: 'team2', action: 'pick' }, { team: 'team1', action: 'pick' }, { team: 'team1', action: 'pick' },
    { team: 'team2', action: 'pick' }, { team: 'team2', action: 'pick' }, { team: 'team1', action: 'pick' },
    // Ban phase 3 — 2 each
    { team: 'team1', action: 'ban' }, { team: 'team2', action: 'ban' }, { team: 'team1', action: 'ban' }, { team: 'team2', action: 'ban' },
    // Pick phase 3 — 1 each (second-pick team gets the true last pick)
    { team: 'team1', action: 'pick' }, { team: 'team2', action: 'pick' },
  ],
};
