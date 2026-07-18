// Game-adapter registry. Each adapter declares how a title differs from the
// game-agnostic core: roster shape, pre-game (draft / veto / ban) presentation, asset
// source, and stat/intel provider. The active game (state.match.game) resolves to an
// adapter; core code reads capabilities from the resolved descriptor rather than
// branching on the raw game id. See MULTI-GAME-SUPPORT-PLAN.md / PHASE-0-ADAPTER-PLAN.md.
const lol      = require('./lol');
const cs2      = require('./cs2');
const dota2    = require('./dota2');
const valorant = require('./valorant');
const generic  = require('./generic');

// Any unknown id falls back to the generic adapter until its phase lands. LoL, CS2 and Dota 2
// are implemented; VALORANT is adapter-stage / alpha (reuses the CS2 map-veto pipeline + agent
// art, no live GSI).
const ADAPTERS = { lol, cs2, dota2, valorant, generic };

function resolveAdapter(gameId) {
  return ADAPTERS[gameId] || generic;
}

// Control-room maturity flag (NEVER shown on-air) so operators know how production-ready a
// title is: 'stable' = battle-tested, 'beta' = shipped + actively hardening, 'alpha' =
// early / planned. Planned titles with no dedicated adapter yet run on the generic core and
// would be flagged here; real adapters (incl. VALORANT + Dota 2, both alpha) carry their own
// `maturity`. Empty now that VALORANT has a real adapter — kept for the next planned title.
const PLANNED_MATURITY = {};
// Display labels for planned titles with no adapter yet. Real adapters carry their own `label`.
const PLANNED_LABELS = {};
function gameMaturity(gameId) {
  if (PLANNED_MATURITY[gameId]) return PLANNED_MATURITY[gameId];
  return resolveAdapter(gameId).maturity || 'stable';
}

// Single source of truth for the selectable game list — implemented adapters first (in
// registry order), then planned titles, then the generic fallback. Adding a new adapter to
// ADAPTERS (or a planned id to PLANNED_*) makes it appear everywhere that consumes this
// (first-run wizard, pickers) with no other change. Each entry: { id, label, maturity }.
function listGames() {
  const impl = Object.keys(ADAPTERS)
    .filter(id => id !== 'generic')
    .map(id => ({ id, label: ADAPTERS[id].label, maturity: gameMaturity(id) }));
  const planned = Object.keys(PLANNED_MATURITY)
    .map(id => ({ id, label: PLANNED_LABELS[id] || id, maturity: gameMaturity(id) }));
  return [...impl, ...planned, { id: 'generic', label: 'Generic / Other', maturity: gameMaturity('generic') }];
}

// Lightweight, client-safe slice broadcast in the state payload as `state.adapter`, so
// control / operator / caster / graphics all read capabilities from ONE place instead of
// re-deriving them per client. Derived, never persisted.
function adapterDescriptor(gameId) {
  const a = resolveAdapter(gameId);
  return {
    id:               a.id,
    label:            a.label,
    positions:        a.roster.positions.slice(),
    teamSize:         a.roster.teamSize,
    rosterIds:        a.roster.idScheme || null, // 'steam' (CS2, Dota) → Steam ID roster field for live-data match
    rosterLinks:      a.roster.links || null,    // 'hltv' (CS2) → HLTV.org roster link column
    pregameKind:      a.pregame.kind,      // 'champ-draft' | 'none' | (later) 'map-veto' | …
    pickEntity:       a.pregame.pickEntity, // 'champion' | null | (later) 'hero' | 'agent' | …
    supportsFearless: !!a.pregame.fearless,
    assetSource:      a.assets.source,
    intelProvider:    a.intel.provider,
    defaultMapPool:   a.defaultMapPool || null, // for "load default pool" in map-veto control
    defaultDraftOrder: a.defaultDraftOrder || null, // for "load default order" in hero-draft control
    liveData:         !!(a.liveData && a.liveData.gsi), // has a GSI live-data integration (CS2, Dota 2)
    hiddenGraphics:   (a.hiddenGraphics || []).slice(), // graphics hidden for this game (nav/bar/bus/keybinds)
    maturity:         gameMaturity(gameId),     // control-room badge only; never on-air
  };
}

module.exports = { resolveAdapter, adapterDescriptor, gameMaturity, listGames, ADAPTERS };
