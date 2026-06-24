# Multi-Game Support — Feasibility & Architecture Plan (master)

> Status: **research/planning deliverable** (raised 2026-06-24, re-scoped 2026-06-24). No code yet.
> Goal: extend MetaGFX from a League-of-Legends control room to a multi-title one —
> **CS2, Dota 2, Valorant, Rainbow Six Siege**, keeping LoL.
>
> **SCOPE GUARDRAILS (this effort):**
> - ❌ **No in-game overlays** (round/economy/bomb HUDs, killfeed, net-worth bars, live
>   scoreboards-on-the-game). Those stay with dedicated 3rd-party broadcast tools. Revisit
>   later only if explicitly wanted.
> - ✅ **Every game gets the non-in-game broadcast graphic set** the app already does:
>   brackets, group stage, tournament structure, pre-show, break, lower-thirds, ticker, win
>   screen, head-to-head, player intro/spotlight, prizepool — **plus the pre-game
>   presentation** (champ draft / hero draft / agent select / map veto / operator bans) as
>   full broadcast scenes, not client HUDs.
> - ✅ **Live game data stays in scope — as a data source, not a renderer.** It serves
>   admin tooling, caster intel, and graphics *data* (live series/round score, current draft
>   state, player/team stats). Strictly read-only / suggest-only — see constraint below.

---

## 1. Executive summary

The product is in better shape for this than the "deeply LoL-coupled" framing suggests.
A `match.game` field already exists (default `'lol'`) and the control UI already has
`isLol` gates around fearless draft. **Roughly two-thirds of the graphic set and ~all of
the tournament/production infrastructure is already game-agnostic** — it consumes generic
teams/players/schedule/bracket data that has nothing to do with champions. With in-game
overlays out of scope, this effort leans almost entirely on systems we've already proven.

The LoL coupling is concentrated in a predictable cluster: the **draft/champ-select**
presentation, **champion art/assets** (DDragon sync), the **5-role player model**, and the
**op.gg/Riot intel** integration. Everything else (bracket, group stage, prizepool,
tournament structure, pre-show, break screen, lower-thirds, ticker, win screen chrome,
buses, switcher, presence/multi-user, theming, Companion) generalises with little or no
change.

**The recommended shape is a per-tournament `game` selector backed by a "game adapter"
interface** that declares: the roster model (roles/positions), the **pre-game presentation
module** (draft/veto/ban as a broadcast scene), the **asset source**, and the **data
adapters** (stat source + optional live-data feed). Game-agnostic systems stay in core;
per-game concerns live behind the adapter. **No `overlays` concept** — there are no in-game
overlays in this effort.

**Recommended sequencing:** CS2 first (best open data + simplest broadcast graphics set),
then Dota 2 (official GSI draft data + OpenDota/STRATZ), then Valorant (gated by Riot API
access; community scrape/manual fallback), then R6 Siege (hardest — manual-entry title).

**⚠️ Load-bearing constraint ([[feedback-no-automation]]):** live data feeds are
**read-only inputs that pre-fill/suggest** in admin/caster/graphics-data panels. They must
**never auto-trigger graphics**. Graphics control stays 100% manual. GSI/listeners/APIs
populate a "suggested state" (live score, draft picks, stats) the operator confirms or that
casters read — they do not push to air. The switcher stays read-only.

---

## 2. Research findings — live *data* availability per game

We want the **data** (live score, draft state, player/team stats) for admin, caster, and
graphics-data uses — **not** the in-game HUD rendering. Grades below reflect how cleanly we
can obtain that data.

### LoL (have today)
- Riot API + op.gg ([[opgg-integration]]); LCU/Live Client Data API exists for live state
  but is **unused** (app is manual). Draft/champ-select presentation already built.
- Assets: DDragon champion art sync.

### CS2 — **best open data**
- **Live data:** **Game State Integration (GSI)** — CS2 POSTs live JSON locally: `map`
  (mode/phase/team scores/round-win history), `round` (phase, bomb planted/exploded/defused,
  winner), per-player state/economy, `bomb`, and observer `allplayers`. For our use this
  gives **live series/round score + economy + map state as data** to feed caster intel and
  auto-suggest scores. Mature libs (C#/Go/JS/Python).
- **Match control + stats:** **MatchZy** (CounterStrikeSharp) → **Get5-compatible webhooks**
  (BO1/3/5, map veto, round/stat events) ingested via **G5API**. Optional; useful for series
  score + veto data without an observer PC.
- **Intel:** FACEIT API, HLTV (scrape), Leetify.
- **Must run for live data:** a small **GSI listener** (observer PC) *or* MatchZy/Get5+G5API.
  Both optional — the broadcast graphics work fully with manual entry.

### Dota 2 — **strong, official**
- **Live data:** official **GSI** (same mechanism) incl. a full **draft** block (pick/ban
  ids+classes, active team, reserve time) → can auto-suggest the **hero-draft presentation
  graphic**. Also live score/net-worth/objectives as data. Node lib `xzion/dota2-gsi`.
- **Intel:** **OpenDota** (free REST) + **STRATZ** (GraphQL) + Steam Web API.
- **Must run:** GSI listener (same shape as CS2). Intel is outbound API calls only.

### Valorant — **possible but gated**
- **Live data:** no sanctioned observer GSI. Riot API match history exists but production
  keys are **gated/whitelisted** + **RSO OAuth** opt-in. Community: **valorant-api.com**
  (static agent/map/weapon assets — great for the agent-select graphic), **vlr.gg** scrapers
  (match/series results, per-map stats) — **post-hoc, not low-latency**.
- **Reality:** treat as **operator-entered + asset-assisted**; live data is best-effort
  (scrape series state, static assets). Agent-select presentation + scoreboard data feasible.

### R6 Siege — **hardest**
- **Live data:** no open live API; Ubisoft access restrictive; live score/timer only via
  third-party WS observer tools (e.g. EsportsDash). Operator bans only since **Siege X
  (2025-06-10)**.
- **Intel:** SiegeGG, Stats.CC, Esports Tales (scrape).
- **Reality:** **manual-entry title** — operator inputs score/round/bans; we supply the
  broadcast graphics + static operator assets. Live ingestion deferred/optional.

---

## 3. Feasibility matrix

| Game | Live **data** (intel/graphics-data, not HUD) | Pre-game presentation | Player/team intel | Must run for live data | Data grade |
|---|---|---|---|---|---|
| **LoL** *(have)* | LCU/Live Client (unused) | ✅ champ draft (built) | Riot + op.gg | nothing (manual) | ★★★★☆ |
| **CS2** | ✅ GSI / MatchZy-Get5 (score/econ/veto) | map veto | FACEIT, HLTV scrape | GSI listener *or* MatchZy+G5API (opt) | ★★★★★ |
| **Dota 2** | ✅ official GSI (incl. draft pick/ban) | hero draft | OpenDota, STRATZ | GSI listener (opt) | ★★★★★ |
| **Valorant** | ⚠️ scrape/manual; Riot gated | agent select | Riot (gated), vlr.gg scrape | scraper (opt) / manual | ★★☆☆☆ |
| **R6 Siege** | ❌ manual; 3rd-party WS only | operator bans | SiegeGG scrape | manual (opt WS bridge) | ★☆☆☆☆ |

**Read:** broadcast graphics for **all five are feasible now** with manual entry. Live
*data* is a bonus that's free+clean for CS2/Dota (GSI), best-effort for Valorant, and
mostly manual for R6.

---

## 4. Existing systems map — core vs LoL-coupled

Audited `server.js` (`makeDefault`, routes), `public/graphics/*`, `public/control/control.js`.

### Already game-agnostic (keep as-is, minor labelling only)
- **Tournament engine:** `tournament` (group stage, single/double elim, seeding, schedule,
  stages/Bo formats), `bracket`, `groupStage`, `tournamentStructure`, `prizepool`.
- **Show graphics:** `preShow`, `breakScreen`, `lowerThird` (set-driven, output-routed),
  `ticker`, `bgOutput`, `headToHead` (team mode), `winScreen` chrome.
- **Infra:** GFX **buses** ([[gfx-bus-system]]), **switcher** (read-only), **presence /
  multi-user / claiming / action log**, **theming**, **Companion / keybinds**, auth/roles,
  profiles, Teams DB, talent roster.
- **Team model:** `match.team1/team2` (name/tag/logo/score) — fully generic.

### LoL-coupled (must go behind the game adapter)
- **`draft` graphic + champ-select** — 20-step ban sequence, blue/red side, fearless.
  `match.game === 'lol'` already gates fearless in `control.js` (~L5649/5776/6753/6808/6940);
  champ-select reads `GAME_LABELS[match.game]`.
- **Champion art / DDragon asset sync** — champion-keyed; needs a per-game asset source.
- **5-role player model** — `DEFAULT_ROLES` (top/jg/mid/adc/sup) baked into
  `makeDefaultPlayers()`; role swaps; role-keyed picks (`team1RolePicks`).
- **op.gg / Riot intel** — `/api/ranks/refresh`, `/api/champpool/refresh`,
  `/api/champstats/draft`; `opggRegion`/`riotId` player fields.
- **"Pick"-consuming graphics:** head2head (champ rows), player-intro (champ strips),
  player-spotlight (champ art + stats), win-screen (`showPicks`). → need a per-game
  "pick entity" notion (champion / hero / agent / operator / none).

### Single biggest structural item
`state` is one global object persisted to `state.json`. The clean move: `game` lives on the
tournament/profile and **selects which adapter renders the per-game slice of state** — don't
fork `state` per game. Needs a state.json/profiles.json migration; do **not** rename the
persisted `t1*/t2*` keys ([[team-naming-convention]]).

---

## 5. Proposed architecture — the game adapter

A **`GameAdapter`** interface (one module per title, e.g. `games/cs2.js`) declaring:

```
GameAdapter {
  id, label, icon,
  roster: { positions[], teamSize, hasSubs },   // replaces hard-coded DEFAULT_ROLES
  pregame: {                                     // the "draft" slot, as a BROADCAST SCENE
    kind: 'champ-draft'|'hero-draft'|'agent-select'|'map-veto'|'operator-ban'|'none',
    sequence,                                    // ban/pick order; null for non-draft titles
    pickEntity: 'champion'|'hero'|'agent'|'operator'|'map'|null
  },
  assets: { source: 'ddragon'|'valorant-api'|'static'|..., entityArt(id), ... },
  intel:  { provider: 'opgg'|'opendota'|'stratz'|'faceit'|'vlr'|'none', fetchRank?, fetchStats? },
  liveData?: {                                   // OPTIONAL, read-only → suggested state only
    kind: 'gsi'|'webhook'|'scrape'|'none',
    ingest(payload) -> { score?, draftState?, stats? }   // feeds admin/caster/graphics DATA
  }
  // NOTE: no `overlays` — in-game HUDs are out of scope this effort.
}
```

**Core stays game-agnostic.** Server keeps generic `match`, `players`, `tournament`,
`bracket`, etc. The adapter supplies: the **roster shape** (`makeDefaultPlayers` reads
`adapter.roster.positions`), the **pre-game presentation module** (LoL champ-draft is just
one implementation; CS2 `map-veto`, Dota `hero-draft`, R6 `operator-ban`, Valorant
`agent-select`), the **asset + intel adapters**, and an **optional live-data adapter**.

**Live-data pattern (respecting [[feedback-no-automation]]):** an optional **listener
sidecar** (small separate process) receives GSI/webhook/scrape data and writes a
`state.live.suggested` slice (live series/round score, current draft state, stats). The
admin/caster UI shows it as "live: T 7–5 · [apply to score]" and casters read it directly —
**nothing reaches air without an operator action.** Switcher stays read-only.

**Reuse verdict (no in-game overlays):** of the broadcast graphics, **~9 reuse as-is**
(bracket, group stage, tournament structure, prizepool, pre-show, break screen,
lower-third, ticker, bg-output), **3–4 adapt** (head2head, player-intro, player-spotlight,
win-screen — swap "champion" for the per-game pick entity, or hide pick rows for
no-draft-entity titles), and **1 is adapter-selected** (the pre-game presentation: champ
draft / hero draft / agent select / map veto / operator ban).

---

## 6. Phased roadmap (broadcast-graphics first; live data as optional data layer)

**Phase 0 — Abstraction groundwork (no new game).** Promote `match.game` to a first-class
per-tournament/profile selector (game picker in tournament setup). Introduce `GameAdapter`
and refactor LoL into `games/lol.js` behind it **with zero behaviour change**. Route
roster, asset sync, intel, and the pre-game module through the adapter. Migration plan for
state.json/profiles. **Deliverable: identical LoL behaviour, now adapter-driven.**

**Phase 1 — CS2.** `games/cs2.js`: 5-slot roster, **map-veto** pre-game presentation,
static/community asset source, FACEIT/HLTV intel. Optional **live-data listener** (GSI or
MatchZy/Get5+G5API) writing `state.live.suggested` for series/round score + veto + caster
intel. **Deliverable: a runnable CS2 broadcast production (graphics work fully manual;
live data optional).**

**Phase 2 — Dota 2.** `games/dota2.js`: **hero-draft** pre-game presentation (GSI draft
block can auto-suggest picks/bans into the existing draft UI shape), OpenDota/STRATZ intel,
hero spotlight reuse. Reuse the Phase-1 listener sidecar. **Deliverable: Dota 2 production
with live-suggested draft + score.**

**Phase 3 — Valorant.** `games/valorant.js`: **agent-select** pre-game presentation,
valorant-api.com static assets, scoreboard data via scrape/manual. **Deliverable: Valorant
as a strong manual-entry title with static assets + best-effort live data.**

**Phase 4 — R6 Siege.** `games/r6.js`: **operator-ban** board + manual entry baseline,
static operator assets; optional third-party WS score/timer bridge. **Deliverable: R6
manual-entry production.**

**Cross-cutting (every phase):** docs/wiki page per game, Companion/keybind coverage,
theming parity, self-rendered screenshot review before handover
([[feedback-self-screenshot-before-handover]]), feature branch per phase
([[feedback-git-workflow]]), confirm any new visual design before building
([[feedback-confirm-design-changes]]).

---

## 7. Key risks / open questions

- **State shape:** confirm `game`-on-profile (adapter selects render) over per-game forks.
  Needs a migration plan; don't rename persisted `t1*/t2*` keys ([[team-naming-convention]]).
- **Live-data process model:** sidecar vs in-server route; how the observer PC reaches the
  control server (LAN). Must preserve manual-only triggering.
- **Valorant/R6 data access:** validate Riot prod-key feasibility / any usable R6 live
  bridge *before* relying on live data — assume manual entry until proven.
- **Asset licensing/sync UX:** per-game asset sources (valorant-api, static operator/agent/
  map packs) need a sync flow like champion-assets, plus gitignore hygiene
  ([[feedback-repo-hygiene]]) — users sync art locally; art stays out of the repo.

---

## 8. Planning structure (how we run this)

**This file is the master architecture/feasibility plan.** Each phase gets its own focused
implementation plan **authored just-in-time** (immediately before the phase starts), because
later phases depend on what we learn in earlier ones (esp. Valorant/R6 data access, and how
clean the Phase-0 adapter refactor turns out). Writing all five detailed plans up front
would be premature and likely rewritten.

- `MULTI-GAME-SUPPORT-PLAN.md` ← this master doc (living; update as facts change).
- Per-phase plan written when we reach it (e.g. a `PHASE-0-*.md` / dedicated planning doc):
  scope, file-level change list, migration steps, test/verification, screenshots, risks.
