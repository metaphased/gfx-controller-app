# Map Intro — CS2

A cinematic full-screen introduction card for the **current or next map** of a CS2 series — big map art, the map name, which team picked it, and optionally the two lineups. Show it as the teams load in.

## Quick start

1. Make sure map art is downloaded: **Settings → Broadcast Assets → Map Assets · CS2** fetches art for the maps in your tournament pool.
2. Open **Graphics → Map Intro**. It defaults to the current/next map from the series; the **Map** selector in the control bar overrides it.
3. Bring it on air with the **MAP INTRO** button.

The map's pick and starting side come from the recorded [map veto](map-veto.md); the pool itself (and any per-map image overrides) is set in **Tournament Setup → Map Pool**.

## Options

| Option | What it does |
|---|---|
| **Title** | Custom header — leave blank to show the map name. |
| **Animation** | **Cinematic** (slow reveal) or **Impact** (hard cut-in). |
| **Show team lineups** | Both rosters on the card. |
| **Map flyby** | Slowly cycles through the map's screenshots (random starting shot) instead of one static image. |

## Notes

- Standard 1920×1080 browser source; URL under **Settings → Output URLs**, routable over the [GFX Bus](gfx-bus.md).
- If map art looks outdated or broken, use **Refresh images** (Tournament Setup → Map Pool) to re-download and rebuild it.
