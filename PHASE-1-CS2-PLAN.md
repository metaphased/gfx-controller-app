# Phase 1 — CS2 (implementation plan)

> Parent: [MULTI-GAME-SUPPORT-PLAN.md](MULTI-GAME-SUPPORT-PLAN.md) · Branch: `feature/cs2-adapter` · Status: **plan**.
> Goal: make CS2 a first-class title — the existing game-agnostic broadcast graphics +
> a **map-veto** pre-game presentation. In-game HUDs stay out of scope (3rd-party tools).
> Live data is optional, DATA-only, read-only ([[feedback-no-automation]]).

## Scope (this phase)
- ✅ `games/cs2.js` adapter, registered so CS2 stops falling back to generic.
- ✅ CS2 gets the full shared graphic set already (bracket, groups, structure, prizepool,
  pre-show, break, lower-thirds, ticker, win screen, H2H/team, player intro/spotlight).
- ✅ **Map-veto pre-game presentation** — operator-entered veto, shown as a broadcast scene.
- ✅ CS2 map-pool asset set (map images) + a place to manage it.
- ⛔ No in-game overlays (round/econ/bomb/killfeed).
- 🔸 Live data (GSI / MatchZy-Get5) — **deferred to a later sub-step**; design the data hook
  but don't require it. Veto + everything works fully manual.

## Sub-steps (sequenced, each independently shippable)
**1a — CS2 adapter (no new visuals).** `games/cs2.js`: roster (5 slots), `pregame.kind:'map-veto'`,
`pickEntity:'map'`, `assets.source:'cs2-maps'`, `intel.provider:'none'`. Register in
`games/index.js`. CS2 then shows its real label + the shared graphics; champ-draft UI stays
hidden (already gated). Verify LoL untouched. *Safe, mechanical.*

**1b — Map-veto data model + control UI.** State slice `state.mapVeto` (game-scoped): map pool,
veto sequence (ordered steps: team + action ban/pick + map + side), Bo format. A new control
panel (gated `cap-map-veto`) to enter/edit the veto and a live-bar toggle. Server endpoints
mirror existing graphic patterns.

**1c — Map-veto broadcast graphic.** `public/graphics/map-veto/` overlay rendering the veto
scene (DESIGN TBD — see question below). Reuses theming tokens, animation system, buses.

**1d — CS2 map assets.** Bundled/sync map images for the active-duty pool; manageable like
champion assets but map-scoped. Gitignored per [[feedback-repo-hygiene]].

**1e — (later) Live data hook.** Optional GSI/MatchZy listener writing `state.live.suggested`
(series/map score, veto result) for operator-confirm — never auto-air.

## Adapter shape (1a) — proposed
```
cs2: { label:'CS2',
  roster:{ positions:['','','','',''], teamSize:5, hasSubs:true },   // no rigid roles in CS2
  pregame:{ kind:'map-veto', pickEntity:'map', fearless:false },
  assets:{ source:'cs2-maps' }, intel:{ provider:'none' } }
```
Open Q1 (roster): CS2 has loose roles (IGL/AWP/entry/support/lurker) not fixed slots — keep
**5 unlabelled slots** (recommended) or offer an optional free-text role per player?

## Map veto — the new visual (needs design confirmation before 1c)
Default active-duty pool (editable): Mirage, Inferno, Nuke, Ancient, Anubis, Dust II, Train.
Bo3 veto = ban·ban·pick·pick·ban·ban·decider (each pick carries the opponent's side choice).
Open Q2 (layout): see options in the chat question.

## Verification / guardrails
- LoL parity re-checked (screenshots) after 1a.
- Self-rendered veto screenshots before handover ([[feedback-self-screenshot-before-handover]]).
- Confirm veto visual design before building 1c ([[feedback-confirm-design-changes]]).
- Feature branch; isolated DATA_DIR testing; check banding ([[feedback-image-banding]]).
