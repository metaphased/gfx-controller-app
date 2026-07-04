# Player Intro

A full-roster introduction for both teams — handles, roles, ranks and (optionally) each player's top-3 most-played champions — in one of three layouts. Driven from **Graphics → Player Intro**, output at `/graphics/player-intro/`.

It reads the two loaded teams and their rosters ([Match & draft control](match-and-draft.md)), so set those up first.

## Layouts

Pick a layout in the control tab. All three show the same data; choose the one that fits your scene.

### Nameplate

Both rosters side-by-side around a centre logo — the most complete read. With **Champions** on, each player's top-3 most-played splash crops blend along their row:

![Player Intro — Nameplate layout, champions on](img/player-intro-panel.webp)

With **Champions** off it falls back to a clean name + role + rank per player:

![Player Intro — Nameplate layout, champions off](img/player-intro-panel-nochamps.webp)

### Team Stack

A cleaner two-column stack of each team's five players.

![Player Intro — Team Stack layout](img/player-intro-stack.webp)

### Bar

A compact lower bar — useful when you want the rosters without covering the scene (always name + rank only).

![Player Intro — Bar layout](img/player-intro-bar.webp)

## Controls

![Player Intro control tab](img/tool-player-intro.jpg)

From the Player Intro ctrl-bar:

![Player Intro live control bar — layout, options, animation and background](img/pi-controls.jpg)

- **Show / hide** the graphic (entrance/exit animate).
- **Layout** — Nameplate · Team Stack · Bar.
- **Options: Logo / Rank / Champs** — toggle each data row. Ranks come from the Riot API ([Players / Rosters](match-and-draft.md#league-of-legends--ranks-and-champion-pools)). **Champs** blends each player's **top 3 most-played** champions (from their op.gg pool) along their row as overlapping splash crops that fade toward the name — players with no pool data fall back to a clean name. Available on the **Nameplate** and **Team Stack** layouts; the **Bar** layout is always name-only.
- **Animation** — the entrance style (*Rise · Stagger · Fade*); the layout picks a sensible default.
- **Background** — transparent by default, or a **Dark** backdrop; the centre logo can be overridden per broadcast.

## Notes

- The rosters and ranks are pulled from the loaded teams — if a player has no rank set, that row simply omits it.
- For a single-player highlight rather than the whole roster, use [Player Spotlight](player-spotlight.md).
- Like all overlays this is transparent — composite it over your scene (or the [BG Output](bg-output.md) layer).
