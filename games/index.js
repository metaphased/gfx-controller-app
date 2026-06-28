// Game-adapter registry. Each adapter declares how a title differs from the
// game-agnostic core: roster shape, pre-game (draft / veto / ban) presentation, asset
// source, and stat/intel provider. The active game (state.match.game) resolves to an
// adapter; core code reads capabilities from the resolved descriptor rather than
// branching on the raw game id. See MULTI-GAME-SUPPORT-PLAN.md / PHASE-0-ADAPTER-PLAN.md.
const lol     = require('./lol');
const cs2     = require('./cs2');
const dota2   = require('./dota2');
const generic = require('./generic');

// valorant / r6 (and any unknown id) fall back to the generic adapter until their phase
// lands. LoL, CS2 and Dota 2 are implemented (Dota 2 is adapter-stage / alpha).
const ADAPTERS = { lol, cs2, dota2, generic };

function resolveAdapter(gameId) {
  return ADAPTERS[gameId] || generic;
}

// Control-room maturity flag (NEVER shown on-air) so operators know how production-ready a
// title is: 'stable' = battle-tested, 'beta' = shipped + actively hardening, 'alpha' =
// early / planned. Games picked in the control room that have no dedicated adapter yet
// (valorant / r6) run on the generic core, so they're flagged 'alpha' here rather than
// inheriting generic's 'stable'. Keyed by the SELECTED game id. Real adapters (incl. Dota 2,
// which is alpha) carry their own `maturity`.
const PLANNED_MATURITY = { valorant: 'alpha', r6: 'alpha' };
function gameMaturity(gameId) {
  if (PLANNED_MATURITY[gameId]) return PLANNED_MATURITY[gameId];
  return resolveAdapter(gameId).maturity || 'stable';
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
    rosterIds:        a.roster.idScheme || null, // 'steam' (CS2) → Steam ID + HLTV roster fields; else op.gg/none
    pregameKind:      a.pregame.kind,      // 'champ-draft' | 'none' | (later) 'map-veto' | …
    pickEntity:       a.pregame.pickEntity, // 'champion' | null | (later) 'hero' | 'agent' | …
    supportsFearless: !!a.pregame.fearless,
    assetSource:      a.assets.source,
    intelProvider:    a.intel.provider,
    defaultMapPool:   a.defaultMapPool || null, // for "load default pool" in map-veto control
    maturity:         gameMaturity(gameId),     // control-room badge only; never on-air
  };
}

module.exports = { resolveAdapter, adapterDescriptor, gameMaturity, ADAPTERS };
