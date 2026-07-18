# Map Intro

A cinematic full-screen introduction card for the **current or next map** of a series — big map art, the map name, which team picked it, and optionally the two lineups. Show it as the teams load in. Available for the map-veto games (**CS2** and **[VALORANT](valorant.md)**).

## Quick start

1. Make sure map art is downloaded — **CS2:** **Settings → Broadcast Assets → Map Assets · CS2**; **VALORANT:** the [Agent & Map Assets sync](valorant.md#one-time-setup-agent--map-assets).
2. Open **Graphics → Map Intro**. It defaults to the current/next map from the series; the **Map** selector in the control bar overrides it.
3. Bring it on air with the **MAP INTRO** button.

The map's pick and starting side come from the recorded [map veto](map-veto.md) in the game's own vocabulary (CS2 "CT start" / knife round; VALORANT "DEF/ATK start"); the pool itself (and any per-map image overrides) is set in **Tournament Setup → Map Pool**.

## Options

| Option | What it does |
|---|---|
| **Title** | Custom header — leave blank to show the map name. |
| **Animation** | **Cinematic** (slow reveal) or **Impact** (hard cut-in). |
| **Show team lineups** | Both rosters on the card. |
| **Map flyby** | *(CS2)* Slowly cycles through the map's screenshot set (random starting shot) instead of one static image. VALORANT maps have a single splash, so they always show the still. |

## Notes

- Standard 1920×1080 browser source; URL under **Settings → Output URLs**, routable over the [GFX Bus](gfx-bus.md).
- *(CS2)* If map art looks outdated or broken, use **Refresh images** (Tournament Setup → Map Pool) to re-download and rebuild it. *(VALORANT)* re-run the [asset sync](valorant.md#one-time-setup-agent--map-assets) instead.
