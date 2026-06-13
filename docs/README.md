# MetaGFX documentation

The full guide to running a broadcast with MetaGFX. These pages are the single source of truth — GitHub renders them as the wiki, and the in-app help reads the same files, so they never drift from the version you're running.

New here? Start with **[Getting started](getting-started.md)**, then work down the Setup & workflow list — it mirrors the order you'll actually do things on show day.

## Setup & workflow

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, first run, logging in, the required-reading checklist. |
| [Tournament setup](tournament-setup.md) | Tournament info, sponsors, the competing-teams pool, structure (groups/bracket), roster size, broadcast info. |
| [Teams Database](tournament-setup.md#teams-database) | The reusable team/roster store and importing from Sheets/CSV/JSON. |
| [Schedule](schedule.md) | Broadcast days, matches, and schedule ↔ bracket result linking. |
| [Match & draft control](match-and-draft.md) | Loading a match, rosters & ranks, the draft board, series tracking and fearless. |

## Graphics

Every graphic is a browser source for OBS/vMix at 1920×1080. Each page below covers what the overlay looks like and how to drive it from its control tab.

| Guide | Graphic |
|---|---|
| [Player Intro](player-intro.md) | Player/roster intro — Panel, Stack, Champion Showcase layouts. |
| [Player Spotlight](player-spotlight.md) | 1–2 player spotlight; fullscreen + lower third; 4 designs. |
| [Head to Head](head-to-head.md) | Team-vs-team comparison and lineups. |
| [Draft Overlay](draft.md) | Live pick/ban board with timer. |
| [Win Screen](win-screen.md) | Match/series result, stingers and the COMP winning-picks screen. |
| [Break Screen](break-screen.md) | "Back soon" / PIP break card. |
| [Pre-show](pre-show.md) | Countdown, sponsors and ticker. |
| [Lower Third](lower-third.md) | Name/title lower thirds. |
| [Bracket](bracket.md) | Single/double-elimination bracket. |
| [Group Stage](group-stage.md) | Group standings overlay. |
| [Tournament Structure](tournament-structure.md) | Format/structure overview overlay. |
| [Prizepool](prizepool.md) | Prize breakdown overlay. |
| [BG Output](bg-output.md) | Standalone animated background layer. |
| [Ticker](ticker.md) | Scrolling info ticker. |

## Systems & integrations

| Guide | What it covers |
|---|---|
| [GFX Bus](gfx-bus.md) | Route many graphics through a few shared browser sources. |
| [Operator & multi-user](operator-and-multiuser.md) | Operator view, roles, presence, page claiming, the log. |
| [Caster view](caster-view.md) | Read-only, token-authed caster dashboard. |
| [Champion assets](champion-assets.md) | Syncing champion tiles/centered/splash art. |
| [Live Switcher](live-switcher.md) | OBS/vMix on-air (PGM/PVW) detection. |
| [Companion / Stream Deck](companion.md) | Bitfocus Companion + action API. |
| [Theming & Looks](theming.md) | Palette, accents, background and reusable Looks. |
| [Control-surface theming](ui-theming.md) | Per-user control-panel appearance. |

---

*This wiki is actively growing — some pages above may land after others. The [README](../README.md) is the project landing page; this index is the documentation home.*
