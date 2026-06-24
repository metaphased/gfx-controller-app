// Game-adapter registry. Each adapter declares how a title differs from the
// game-agnostic core: roster shape, pre-game (draft / veto / ban) presentation, asset
// source, and stat/intel provider. The active game (state.match.game) resolves to an
// adapter; core code reads capabilities from the resolved descriptor rather than
// branching on the raw game id. See MULTI-GAME-SUPPORT-PLAN.md / PHASE-0-ADAPTER-PLAN.md.
const lol     = require('./lol');
const generic = require('./generic');

// Phase 0: only LoL is fully implemented. valorant / cs2 (and any unknown id) fall back
// to the generic adapter until their phase lands.
const ADAPTERS = { lol, generic };

function resolveAdapter(gameId) {
  return ADAPTERS[gameId] || generic;
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
    pregameKind:      a.pregame.kind,      // 'champ-draft' | 'none' | (later) 'map-veto' | …
    pickEntity:       a.pregame.pickEntity, // 'champion' | null | (later) 'hero' | 'agent' | …
    supportsFearless: !!a.pregame.fearless,
    assetSource:      a.assets.source,
    intelProvider:    a.intel.provider,
  };
}

module.exports = { resolveAdapter, adapterDescriptor, ADAPTERS };
