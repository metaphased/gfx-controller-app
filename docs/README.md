# MetaGFX documentation

The full guide to running a broadcast with MetaGFX, with rundowns and extra information for all available features.

New here? Start with **[Getting started](getting-started.md)**, then work down the Tournament & data list — it mirrors the order you'll actually do things on show day. Game-specific features (drafts, vetoes, live data) live in their own sections per game.

## Getting started

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, first run, logging in, the required-reading checklist. |

## Tournament & data

| Guide | What it covers |
|---|---|
| [Tournament setup](tournament-setup.md) | Tournament info, sponsors, the competing-teams pool, structure (groups/bracket), roster size, broadcast info. |
| [Teams Database](tournament-setup.md#teams-database) | The reusable team/roster store and importing from Sheets/CSV/JSON. |
| [Schedule](schedule.md) | Broadcast days, matches, and schedule ↔ bracket result linking. |
| [Match & draft control](match-and-draft.md) | Loading a match, rosters & ranks, series tracking, and the per-game draft boards. |

## Graphics

Every graphic is a browser source for OBS/vMix at 1920×1080. Each page below covers what the overlay looks like and how to drive it from its control tab. These work for every game; game-specific overlays are in the game sections further down.

| Guide | Graphic |
|---|---|
| [Broadcast Theming](theming.md) | The whole broadcast's visual identity — palette, fonts, shape & surface, animation, Looks. |
| [Player Intro](player-intro.md) | Player/roster intro — Nameplate, Team Stack, Bar layouts (plus Agent Cards on VALORANT). |
| [Win Screen](win-screen.md) | Match/series result, stingers and the COMP winning-picks screen. |
| [Post-Game Scoreboard](post-game.md) | End-of-game player stat board — CS2 and Dota 2, fed by live data. |
| [Break Screen](break-screen.md) | "Back soon" / PIP break card. |
| [Pre-show](pre-show.md) | Countdown, sponsors and ticker. |
| [Lower Third](lower-third.md) | Set-driven name/title strips — 4 designs, free positioning, per-scene outputs and bus routing. |
| [Bracket](bracket.md) | Single/double-elimination bracket. |
| [Group Stage](group-stage.md) | Group standings overlay. |
| [Tournament Structure](tournament-structure.md) | Format/structure overview overlay. |
| [Prizepool](prizepool.md) | Prize breakdown overlay. |
| [BG Output](bg-output.md) | Standalone animated background layer. |
| [Ticker](ticker.md) | Scrolling info ticker. |

## League of Legends

| Guide | What it covers |
|---|---|
| [Draft Overlay](draft.md) | Live pick/ban board with timer. |
| [Player Spotlight](player-spotlight.md) | 1–2 player spotlight with champion stats; fullscreen + lower third; 4 designs. |
| [Head to Head](head-to-head.md) | Team-vs-team comparison and lineups with champion splash art. |
| [Champion assets](champion-assets.md) | Syncing champion tiles/centered/splash art. |

## Counter-Strike 2

CS2 live data (GSI / MatchZy) is in **beta** — the data flows are being exercised in live productions and may still be refined.

| Guide | What it covers |
|---|---|
| [Map Veto](map-veto.md) | Map-veto pre-game board — ban/pick sequence, accordion reveal. |
| [Map Intro](map-intro.md) | Cinematic map introduction card with lineups and flyby. |
| [Live Data (CS2)](live-data.md) | CS2 GSI / MatchZy ingest for auto-filling scores and player stats. |

## Dota 2

| Guide | What it covers |
|---|---|
| [Hero Draft](hero-draft.md) | Captains Mode pick/ban board, the draft timer, and auto-fill from the live game. |
| [Live Data (Dota 2)](dota-live-data.md) | Dota GSI setup, the live feed inspector, game archive and stat snapshots. |
| [Match Summary](match-summary.md) | Whole-match analysis board — scoreboards, items, net-worth graph with event markers. |

## VALORANT

VALORANT support is in **alpha** — data entry is manual (there is no live VALORANT feed).

| Guide | What it covers |
|---|---|
| [VALORANT guide](valorant.md) | Agent & map asset sync, per-player agents, the Agent Cards & Team Fan intro layouts, win-screen agents. |
| [Post-Map Data](valorant-data.md) | Riot ID validation + per-map scores, agents, stats & pools via a community API (beta — reliability disclaimer inside). |
| [Map Veto](map-veto.md) | The shared map-veto board — VALORANT uses DEF/ATK sides and a side-choice decider. |
| [Map Intro](map-intro.md) | Cinematic map introduction card with the veto story. |

## Systems & integrations

| Guide | What it covers |
|---|---|
| [GFX Bus](gfx-bus.md) | Route many graphics through a few shared browser sources. |
| [OMT Output](omt-output.md) | Graphics as native OMT video sources with alpha — no browser source (beta). |
| [Operator & multi-user](operator-and-multiuser.md) | Operator view, roles, presence, page claiming, the log. |
| [User profile](user-profile.md) | Per-user keybinds, password, appearance, Companion download, log out. |
| [Caster view](caster-view.md) | Read-only, token-authed caster dashboard. |
| [Live Switcher](live-switcher.md) | OBS/vMix on-air (PGM/PVW) detection. |
| [Companion / Stream Deck](companion.md) | Bitfocus Companion + action API. |
| [Control-surface theming](ui-theming.md) | Per-user control-panel appearance (the overlays' look is under [Broadcast Theming](theming.md)). |

---

*This wiki is actively growing — some pages above may land after others. The [README](../README.md) is the project landing page; this index is the documentation home.*
