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

---

# Phase 1 — REFINEMENT BACKLOG (CS2) — added 2026-06-25 (resume point after context clear)

> Context: map-veto is DONE (guided Bo1/3/5, scales, pool in Tournament Setup, default settable).
> Branch `feature/cs2-adapter`, NOT merged. Below is the remaining CS2 work the user asked for.
> Governing rules: [[feedback-no-automation]] (live data = read-only/suggest, operator confirms),
> [[feedback-confirm-design-changes]] (confirm any NEW visual design before building),
> [[feedback-self-screenshot-before-handover]], test via isolated DATA_DIR (no junctions —
> [[feedback-worktree-junction-hazard]]).

## R1 — CS2 match score logging (per-map ROUND scores)
**Need:** log scores as the series progresses — per MAP round score (e.g. 13-6), not just
maps-won. Three input methods, user picks based on their setup:
  1. **Manual** (baseline — build first): operator enters each map's round score in control.
  2. **MatchZy** (Get5/G5API webhook): server endpoint ingests map results from the match
     plugin. (Integration the admin runs on their CS2 server.)
  3. **GSI**: local HTTP listener reads live round score from the observer client.
**Design:**
- Data model: per-played-map results. The played maps are derivable from `mapVeto.steps`
  (the picks + decider, in order). Store round scores per map — options: extend
  `match.seriesGames` with `t1Rounds`/`t2Rounds`, OR a new `match.mapResults` =
  `[{ map, t1Rounds, t2Rounds, winner, status:'upcoming'|'live'|'final' }]` aligned to the
  veto's played maps. Series score (maps won) derives from this.
- Add a **score-source setting** (manual | matchzy | gsi), likely per-tournament or global
  in settings; default manual. Methods 2/3 write a SUGGESTED value the operator applies
  (never auto-air). Build manual first; matchzy/gsi are later sub-steps (the optional
  live-data hook 1e in the master plan — design the endpoint shape now, implement later).
- Control UI: a CS2 score panel (likely on GAME → Match/Series or a new spot) listing the
  played maps with editable round scores + winner; gated cap-* (cs2).

## R2 — Break screen: per-map round scores (CS2)
**Need:** break screen between maps should show previous maps' ROUND scores, not LoL-style
"1-0". E.g. Bo3 going to map 3, on break between map 2 and 3: "MAP 1 13-6 · MAP 2 8-13 ·
MAP 3 NEXT".
**Design:** break screen gets a CS2 mode (gated by adapter) that reads R1's per-map results
and renders the round-score line. Depends on R1 (score model). Keep LoL behaviour unchanged.

## R3 — Graphics audit for CS2 (keep / adapt / skip)
Go through every graphic; reuse what works, adapt or skip the LoL-coupled ones. User notes baked in:
| Graphic | CS2 verdict |
|---|---|
| Lower Third | KEEP as-is (generic). |
| Bracket / Group Stage / Tournament Structure / Prizepool / Pre-show / Ticker / BG Output | KEEP (game-agnostic). |
| Player Intro | KEEP — champ strips already hidden (cap-picks); name/role(none)/stats. |
| **Head to Head** | **SKIP for CS2** — no champ-pick granularity, not useful. Gate it off for cs2 (hide nav/controls), OR leave but de-emphasize. (Deferred idea: a "map intro" graphic replaces it for CS2 — later.) |
| **Player Spotlight** | **ADAPT** — works, but NO champion background art. Rethink display: lean on team colour/logo bg; show STATS if available (FACEIT/HLTV/manual). Needs design confirm. |
| **Win Screen** | **ADAPT** — no champion images. Lean into team NAME + LOGO + (series + map) score. Build a CS2 variant (showPicks off; consider showing map round scores). Needs design confirm. |
| Draft | N/A for CS2 (replaced by Map Veto; already gated). |
| Map Veto | DONE. |
| Match Intel (op.gg) | already hidden for cs2 (cap-opgg). CS2 stats source (FACEIT/HLTV) is a separate later effort. |

**Approach:** do the audit graphic-by-graphic; for SKIP → add cap gating; for ADAPT (spotlight,
win screen) → confirm the new CS2 visual design with the user BEFORE building.

## Suggested sequencing for the refinement
1. R1 manual score model + control entry (foundation for R2/win screen).
2. R2 break-screen CS2 score line.
3. R3 audit: gate H2H off for cs2 (quick); then ADAPT win screen (confirm design) + player
   spotlight (confirm design).
4. Later: MatchZy + GSI score ingestion (read-only/suggest); CS2 stats source; map-intro graphic.

## Key code anchors (for the fresh context)
- Adapter: `games/cs2.js` (+ `games/index.js` registry, `adapterDescriptor`). Capability classes:
  cap-champ-draft / cap-map-veto / cap-opgg / cap-assets / cap-picks / cap-roles, driven by
  `applyAdapterUI()` in control.js + `applyOpsAdapterUI()` in operator.
- Map veto: state `mapVeto` (server makeDefault) + `tournament.mapPool`; `/api/mapVeto`;
  control fns `_vetoSlots/mvRenderVeto/mvCommitVeto/tm*MapPool`; graphic `public/graphics/map-veto/`.
- Match/series score today: `match.team1.score`/`team2.score` (series) + `match.seriesGames` (LoL
  per-game snapshots, t1*/t2* keys — see team-naming convention comment above makeDefault in server.js).
- Win screen: state `winScreen` (showPicks etc.); graphic `public/graphics/win-screen/`.
- Break screen: state `breakScreen`; graphic `public/graphics/break-screen/`.
- Player spotlight: state `playerSpotlight`; graphic `public/graphics/player-spotlight/`.
