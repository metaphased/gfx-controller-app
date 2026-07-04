# Phase 2 — Dota 2 (implementation plan)

> Authored just-in-time at the start of Phase 2 (after CS2 / Phase 1 merged to master,
> kept BETA pending live test). Branch `feature/dota2-adapter`. Governing rules:
> [[feedback-confirm-design-changes]] (confirm any NEW visual before building),
> [[feedback-self-screenshot-before-handover]], [[feedback-no-automation]] (live data =
> read-only/suggest), [[feedback-git-workflow]], isolated DATA_DIR testing.

## Where Dota 2 sits vs LoL / CS2
Dota 2 is **closer to LoL than CS2**: it has a **hero pick/ban draft** (Captains Mode), real
**roster positions (1–5)**, and **per-hero art** — i.e. it has a *pick entity* (`hero`), where
CS2 had none (map-veto, no picks). So Dota reuses the **champion-shaped** pick UI (draft,
player-intro picks, spotlight, win-screen picks, H2H) — but populated with **heroes** instead
of champions. The central question of this phase is **how much to generalise the existing
champion/draft infrastructure for heroes vs build Dota-specific graphics** (see DECISIONS).

## Scope (this phase)
- ✅ `games/dota2.js` adapter — registered, real label, `hero-draft` pregame, positions 1–5,
  `dota-heroes` assets, `opendota` intel. (2a — DONE.)
- 🔲 Hero **assets** (portraits) — sync like champion assets but hero-scoped (Valve CDN /
  OpenDota constants). Gitignored per [[feedback-repo-hygiene]].
- 🔲 **Hero-draft** pre-game presentation (Captains Mode pick/ban) — the centerpiece graphic.
- 🔲 Dota-ise the shared **pick-consuming** graphics (player-intro / spotlight / win-screen /
  H2H) so they show heroes, not champions (mirrors CS2's R3 audit, but feed-hero not hide).
- ⛔ No in-game overlays (net worth / objectives HUD).
- 🔸 Live data (official Dota 2 **GSI** carries the full draft block) — **deferred / manual-first**
  (user can't test live data sources currently; same stance as CS2). Design the hook, don't
  require it.

## Sub-steps (sequenced, each independently shippable)
**2a — Dota 2 adapter (no new visuals). ✅ DONE.** `games/dota2.js` + registered; removed dota2
from `PLANNED_MATURITY` (real adapter carries its own `maturity:'alpha'`). Dota shows its label +
the shared graphics; champ-draft + map-veto pre-game UI both hidden (pregameKind is neither).
Verified headless: shared nav present, Draft/H2H/Map Veto hidden, ALPHA badge, no JS errors,
LoL/CS2 descriptors unchanged.

**2b — Hero assets.** Hero portrait set for the active hero pool, manageable like champion assets
(map to a `cap-hero` / `dota-heroes` source). Names ↔ slugs (e.g. "Anti-Mage" → `antimage`).
Source: Valve CDN (`cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/…`) or
OpenDota constants. Gitignored.

**2c — Hero-draft data model + control UI.** State slice for the Captains Mode pick/ban sequence
(team + action ban/pick + hero + order), Bo format, active team. Control panel gated
`cap-hero-draft`; live-bar toggle; server endpoints mirror existing graphic patterns. (GSI can
later auto-suggest into this same shape.)

**2d — Hero-draft broadcast graphic.** `public/graphics/hero-draft/` (or generalised draft) —
renders the CM draft scene: two teams (Radiant/Dire), ban row + pick slots, hero portraits,
reserve time, active-pick highlight. Reuses theming/animation/bus tokens. **Design TBD — confirm
before building.**

**2e — Dota-ise shared pick graphics.** player-intro / spotlight / win-screen "picks" / H2H show
**heroes** for Dota (hero art + position labels), like LoL shows champions. Additive + gated so
LoL/CS2 unchanged.

**2f — (deferred) Dota GSI live-data hook.** Optional listener writing `state.live.suggested`
(draft picks/bans, score) for operator-confirm — never auto-air. Same sidecar shape as CS2.

## ✅ DECISIONS (confirmed by user 2026-06-29)
1. **Hero-draft graphic = Dota-specific build.** New `public/graphics/hero-draft/` (Radiant/Dire,
   CM sequence, hero art). Do NOT refactor the working LoL draft graphic.
2. **CM sequence = default preset + editable.** Ship a built-in **current-CM preset order** as the
   default; the order is **editable in Tournament Settings** (mirrors CS2's settable map-pool
   default). Once saved there, the draft controls run the steps in that saved order — preset now,
   adjustable later when Valve re-tunes CM.
3. **Live GSI = deferred / manual-first** (user can't test Dota live data yet — same as CS2).
4. **Build order: hero assets (2b) first.**
   (Side mapping Radiant→team1 / Dire→team2 + accent colours to confirm when 2d is built.)

## Verification / guardrails
- LoL + CS2 parity re-checked after each step (descriptors + screenshots).
- Self-rendered draft screenshots before handover; confirm the draft visual design before 2d.
- Feature branch `feature/dota2-adapter`; isolated DATA_DIR; check banding; keep CS2 BETA.

## Key code anchors
`games/index.js` (adapter registry + `gameMaturity`/`PLANNED_MATURITY`); cap-gating =
`pregameKind`/`pickEntity`/`positions` → `cap-champ-draft`/`cap-map-veto`/`cap-roles`/`cap-picks`
(control `applyAdapterUI` ~line 78, operator `applyOpsAdapterUI`). New pre-game graphic wiring =
mirror the CS2 map-veto/post-game pattern across server registries + control/operator surfaces
(see [[cs2-live-data]] "new graphic-wiring pattern"). Champion assets = `scripts/sync-assets` +
`/api/assets/*` gated `adapterSupports('ddragon')`; hero assets need a parallel `dota-heroes` path.
