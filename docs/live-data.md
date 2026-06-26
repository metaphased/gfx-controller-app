# Live Data — CS2 GSI / MatchZy ingest

MetaGFX can pull **live CS2 data** to fill in **map/series scores** and **per-player stats** for you, instead of typing them by hand. Two independent sources feed it:

- **Game State Integration (GSI)** — runs on a **CS2 client** (your observer / GOTV machine). Sends live round/score and per-player K/D/A as the match plays.
- **MatchZy** — runs on the **game server**. Sends authoritative map and series results (and, depending on version, per-player stats with ADR).

Use **either, both, or neither** — they're fully optional and independent. With neither enabled, nothing changes and you enter scores manually as always.

> **Data-only, by design.** Live Data only **records and suggests** — it never triggers a graphic. You still bring every overlay on and off air yourself. Scores can optionally auto-apply to the match result (your choice), but no graphic is ever shown automatically. Automation belongs in OBS/vMix.

It currently surfaces for **CS2** tournaments. The control card lives in **Tournament Setup → Live Data** (it appears for map-veto games).

## Quick start

1. Open **Tournament Setup → Live Data** (admin).
2. Enable **Game State Integration (GSI)** and/or **MatchZy**.
3. **GSI:** click **Download GSI config** and drop the file into the CS2 machine's config folder (below). Restart CS2.
4. **MatchZy:** **Copy MatchZy URL** and set it as MatchZy's event/webhook URL on the game server.
5. Set **CT side is → Team 1 / Team 2** so GSI's CT/T scores map to the right team.
6. Choose whether scores **auto-apply** or are **suggested** for you to apply.

The status pill next to each toggle reads **off**, **waiting…**, or **live · de_mirage R12 7–5** once data arrives. It decays back to *waiting* if a source goes quiet.

## The ingest token

GSI and MatchZy authenticate with a single **ingest token**, shown at the bottom of the card. It is a **separate secret** from the graphics token, and is **stripped from the state sent to non-admin (operator / caster / token) clients**.

- The token is embedded in the **GSI config** and in the **MatchZy URL** automatically — you don't paste it anywhere by hand.
- **Regenerate** rotates it. After rotating you must **re-download the GSI config** and **update MatchZy** with the new URL; the old ones stop working.

## GSI setup (observer / GOTV PC)

GSI runs on a **CS2 client** — typically your **observer** or a **GOTV** spectator client — because it needs `allplayers` data, which only a spectator sees.

1. In the Live Data card, click **Download GSI config** (`gamestate_integration_metagfx.cfg`).
2. Copy it into:
   `…\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\`
3. Restart CS2 (or the spectator client).

The config points CS2 at MetaGFX's `/api/live/gsi` endpoint and requests provider/map/round/player and `allplayers` match stats.

> **Reachability.** The URL must be reachable **from the CS2 machine**. If that's a different PC, the app must be addressable over the network — set **`EXTERNAL_URL`** (or use this machine's **LAN IP**), not `localhost`. The **Copy GSI URL** button copies the exact address the config uses. See [Getting started → Environment variables](getting-started.md#environment-variables) for `EXTERNAL_URL`.

## MatchZy setup (game server)

[MatchZy](https://shobhit-pathak.github.io/MatchZy/) runs on the **CS2 game server** and reports authoritative results.

1. In the Live Data card, click **Copy MatchZy URL**.
2. Point MatchZy's event / webhook URL at that address (it already carries the token).

MatchZy's map/series result events are treated as authoritative — a `map_result` / `map_end` finalizes the map and updates the series. MatchZy reports both teams **directly**, so the **CT side** setting doesn't affect it (it only matters for GSI's CT/T → team mapping).

> **MatchZy versions.** Field names vary between MatchZy releases. The parser is **defensive** — minor schema changes degrade gracefully rather than break — but if results don't land against your instance, that's the first place to check. The integration targets the current MatchZy release.

## Scores — review & apply

When score data arrives:

- **Auto-apply on** — scores flow straight into the map results and series (a note shows in the card: *⟳ Live scores auto-apply to the map results*).
- **Auto-apply off** (default) — each map's suggested score appears with an **Apply** button, plus **Apply all**. Nothing changes until you click.

GSI maps **CT/T → Team 1/Team 2** using the team names (and auto-handles the half-side swap); the **CT side is** setting is the fallback when names don't match. A finished map (`gameover` / `map_result`) is marked **final** with a winner, and the series score updates — feeding the break screen, win screen, top bar and map-veto graphic.

## Player stats

The card's **Player stats** readout has three views:

- **Live** — the current map, from GSI's `allplayers` (or MatchZy): K/D/A per player.
- **This series** — accumulated across the maps of the current series.
- **Tournament** — accumulated across the whole tournament (maps · K/D/A · KD).

Series/tournament totals are snapshotted each time a map is finalized, so they survive between maps and matches.

### Where stats appear in graphics

Stats are matched to your roster **by in-game name** (clan prefixes are ignored), so no roster data entry is required. They surface on:

- **[Player Spotlight](player-spotlight.md)** — the featured player's CS stats (tournament K/D · ADR · maps, else the live K/D/A line) in place of the LoL champion stats.
- **[Player Intro](player-intro.md)** — a compact stat line under each player's handle (tournament `KD 1.75 · 95 ADR`, else live `24 / 11 / 6`) in all three layouts.

You still bring these graphics on air yourself — Live Data only fills the numbers.

### Optional roster overrides (Steam ID / HLTV)

For CS2 teams, the **Teams Database** player editor has two optional extra fields:

- **Steam ID** — a precise match override. Matching works by name without it; fill it in only if a player's in-game name differs from their roster handle.
- **HLTV URL** — a manual link (no scraping). When set, an **HLTV ↗** shortcut appears next to that player in the roster panel.

Both are optional — leave them blank and name-matching handles everything.

## Notes & limitations

- **Optional and independent** — either source, both, or none. Manual entry always works.
- **GSI needs a spectator** — `allplayers` stats only come from an observer / GOTV client, not a player's own client.
- **The ingest token is admin-only** and stripped from non-admin state, like the graphics and switcher secrets.
- **Read-leaning by design** — Live Data suggests and records; it never shows or hides a graphic. Score auto-apply is the only automatic write, and it's opt-in.
