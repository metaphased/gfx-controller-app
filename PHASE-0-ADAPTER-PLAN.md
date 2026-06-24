# Phase 0 — Game-Adapter Abstraction Groundwork (implementation plan)

> Parent: [MULTI-GAME-SUPPORT-PLAN.md](MULTI-GAME-SUPPORT-PLAN.md) · Status: **plan, not started**.
> Goal: introduce the `GameAdapter` abstraction and route LoL through it **with zero
> behaviour change**, so Phases 1–4 can add titles by dropping in an adapter.
> Branch: `feature/game-adapter` ([[feedback-git-workflow]]).

---

## 0. Outcome / definition of done

- LoL productions behave **byte-identically** to today (draft, rosters, intel, win-screen
  picks, champ-select label) — verified by self-rendered before/after screenshots.
- A `GameAdapter` registry exists server-side; LoL is a fully-implemented adapter; a
  **generic fallback** adapter exists so `valorant`/`cs2`/`generic` selections don't crash
  (they get a generic 5-slot roster, no draft, no champion intel/assets).
- All clients (control, operator, caster, graphics) read game capabilities from **one
  resolved adapter descriptor in state** instead of scattered `isLol` / hard-coded
  `DEFAULT_ROLES` / `GAME_LABELS`.
- Existing `state.json` and saved `profiles.json` load cleanly (migration is a no-op safety
  net; deepMerge already covers new fields).

**Explicitly NOT in Phase 0:** any new game's real graphics/data, live-data listeners,
pre-game modules other than LoL champ-draft, asset/intel providers other than DDragon/op.gg.

---

## 1. Current-state facts (verified in code)

These shape the design — the seams already half-exist:

- `match.game` defaults `'lol'` (`server.js:486`), settable via `POST /api/tournament`
  (`server.js:2191-2208`, mirrors to `tournament.game`). UI selector already present:
  `public/control/index.html:240` (`ts-game`: lol/valorant/cs2/generic), read back at
  `control.js:818`.
- Roster model hard-coded in **two** places: `DEFAULT_ROLES = ['Top','Jungle','Mid','Bot','Support']`
  at `server.js:421` and `control.js:41`. Used in `makeDefaultPlayers` (`server.js:424`),
  load-team (`server.js:1148`), import paths (`server.js:2012`, `2340`), and control roster
  rendering (`control.js:3015/3480/3595/3625`).
- LoL-only gating today is `match.game === 'lol'` at `control.js:5649`, `5776`, `6753`,
  `6808`, `6940` (all fearless-draft / schedule-game UI).
- Champ-select label: `GAME_LABELS` at `champ-select/index.html:188`, used L257.
- Draft sequence: `DRAFT_SEQUENCE` at `draft/draft.js:12` (the 20-step ban order).
- Persistence: `loadState()` = `deepMerge(makeDefault(), JSON.parse(state.json))`
  (`server.js:697-709`) → **adding fields to makeDefault is automatically migration-safe**.
  Established migration pattern: `migrateAnimationSettings` / `migrateLowerThird`
  (`server.js:620/640`, called in loadState). Profiles snapshot `state.tournament`
  (carries `game`) — `server.js:788`.

**Architectural decision confirmed by code:** `game` already lives on the
tournament/profile. Phase 0 formalizes *resolving an adapter from it* — no per-game state
fork, no key rename ([[team-naming-convention]]).

---

## 2. The adapter (Phase-0 shape)

New module `games/` (server-side, plain CommonJS to match `server.js`).

`games/index.js` — registry + resolver:
```js
const ADAPTERS = { lol: require('./lol'), generic: require('./generic') };
// Phase 0: valorant/cs2 resolve to generic until their phases land.
function resolveAdapter(gameId) { return ADAPTERS[gameId] || ADAPTERS.generic; }
function adapterDescriptor(gameId) {        // lightweight, client-safe slice for state
  const a = resolveAdapter(gameId);
  return { id: a.id, label: a.label, positions: a.roster.positions,
           teamSize: a.roster.teamSize, pregameKind: a.pregame.kind,
           pickEntity: a.pregame.pickEntity, supportsFearless: !!a.pregame.fearless,
           assetSource: a.assets.source, intelProvider: a.intel.provider };
}
```

`games/lol.js` — captures *today's* behaviour exactly:
```js
module.exports = {
  id: 'lol', label: 'League of Legends',
  roster: { positions: ['Top','Jungle','Mid','Bot','Support'], teamSize: 5, hasSubs: true },
  pregame: { kind: 'champ-draft', pickEntity: 'champion', fearless: true,
             sequence: /* the existing 20-step order */ },
  assets: { source: 'ddragon' },
  intel:  { provider: 'opgg' },
  // liveData: omitted in Phase 0
};
```

`games/generic.js` — safe fallback (used by valorant/cs2/generic in Phase 0):
```js
module.exports = {
  id: 'generic', label: '',
  roster: { positions: ['','','','',''], teamSize: 5, hasSubs: true }, // 5 unlabelled slots
  pregame: { kind: 'none', pickEntity: null, fearless: false, sequence: null },
  assets: { source: 'static' },
  intel:  { provider: 'none' },
};
```

> `DRAFT_SEQUENCE` stays in `draft/draft.js` for Phase 0 (referenced by the lol adapter
> conceptually). Full extraction into pluggable pre-game modules happens in Phase 1 when
> CS2 `map-veto` needs a second implementation — Phase 0 only needs the **capability seam**
> (`pregameKind`/`supportsFearless`), not the plugin machinery.

---

## 3. Work items

### A. Server — registry + resolution (low risk)
1. Add `games/index.js`, `games/lol.js`, `games/generic.js` (§2).
2. `makeDefaultPlayers(positions)` takes positions; default callers pass the **resolved
   adapter's** positions (game defaults to `'lol'`, so identical output). Replace bare
   `DEFAULT_ROLES` uses at `server.js:424/1148/2012/2340` with adapter positions resolved
   from `state.match.game`. Keep `DEFAULT_ROLES` as the lol adapter's array (single source).
3. In `broadcast()` payload, include `state.adapter = adapterDescriptor(state.match.game)`
   (computed, not persisted) so every client gets capabilities in one place.
4. Add `migrateGame(st)` (mirrors `migrateLowerThird`): ensure `st.match.game` and
   `st.tournament.game` exist (default `'lol'`); call it in `loadState()`. No-op for
   existing data; safety net for old profiles.
5. Guard LoL-only data endpoints behind `intel.provider==='opgg'` /
   `assets.source==='ddragon'`: `/api/ranks/refresh`, `/api/champpool/refresh`,
   `/api/champstats/draft`, `/api/assets/*` → if the active adapter doesn't support them,
   return a clear `{skipped:true, reason}` instead of running. (For LoL: unchanged.)

### B. Client — read capabilities from `state.adapter` (medium risk, mechanical)
6. `control.js`: replace the 5 `match.game === 'lol'` checks
   (`5649/5776/6753/6808/6940`) with `state.adapter.supportsFearless` /
   `state.adapter.pregameKind === 'champ-draft'`.
7. `control.js`: replace hard-coded `DEFAULT_ROLES` (`41`, used `3015/3480/3595/3625`) with
   `state.adapter.positions` (fall back to the array if state not yet loaded).
8. Hide/show the **Draft tab + fearless toggle** when `pregameKind !== 'champ-draft'` (so
   selecting `generic` cleanly drops LoL-only UI rather than showing dead controls).
9. `champ-select/index.html`: replace `GAME_LABELS[...]` with `state.adapter.label`.
10. Sanity-pass the "pick"-consuming graphics (head2head / player-intro / player-spotlight /
    win-screen `showPicks`): when `pickEntity === null`, hide pick/champ rows gracefully.
    For LoL (`pickEntity:'champion'`) → unchanged.

### C. UI — game picker (tiny)
11. Keep the existing `ts-game` selector. Confirm switching to `generic` reshapes nothing
    destructively (don't wipe rosters on game change — Phase 0 keeps 5 slots for all). Add a
    short helper note that non-LoL titles are "graphics-only until their phase lands."
    Do **not** add `dota2`/`r6` options yet (no adapters).

### D. Docs / memory
12. Update [MULTI-GAME-SUPPORT-PLAN.md](MULTI-GAME-SUPPORT-PLAN.md) §5 to point at the real
    `games/` module once built. No wiki/help page in Phase 0 (no user-facing feature yet).

---

## 4. Sequencing within the phase
A1–A3 (registry + state descriptor) → A4 (migration) → B6–B9 (client reads descriptor) →
B10 (graphic sanity) → A5 (endpoint guards) → C11 → verify. Each step is independently
testable against an unchanged LoL production.

## 5. Risks & mitigations
- **Roster reshaping on game change** — *decision:* Phase 0 does **not** reshape rosters when
  `game` changes (all current games = 5 slots); avoids data loss. Reshaping is a per-adapter
  concern revisited when an adapter has ≠5 slots. Flag in master doc open questions.
- **Client reads `state.adapter` before first broadcast** — keep the literal `DEFAULT_ROLES`
  array as a fallback in `control.js` so a pre-load render can't break.
- **Profiles carry `tournament.game`** already — confirm a saved LoL profile round-trips
  unchanged (load → adapter resolves lol → identical).
- **Don't rename persisted keys** (`t1*/t2*`, role-keyed picks) — adapter only changes
  *resolution*, not stored shape ([[team-naming-convention]]).

## 6. Verification / acceptance ([[feedback-verify-dont-claim-fixed]], [[feedback-self-screenshot-before-handover]])
- Load current `state.json` + a saved LoL profile → diff rendered draft / rosters / intel /
  win-screen picks vs `master`: **no visual or data diff**.
- Self-render (headless, isolated worktree on :3010 per [[feedback-demo-inject-shared-data-hazard]])
  screenshots of: draft graphic, champ-select, head2head, player-spotlight, win-screen — LoL.
- Switch game → `generic`: Draft tab + fearless hidden, roster = 5 blank slots, op.gg/DDragon
  endpoints return `skipped`, no console errors, other graphics render.
- Switch back → `lol`: full behaviour returns.
- Run any existing tests; manual smoke of `/control`, `/operator`, `/caster`, a `/bus`.

## 7. Rough size
~1 focused session. Mostly mechanical substitution behind a new ~3-file module; the only
thinking is the client capability wiring (B) and the endpoint guards (A5).
