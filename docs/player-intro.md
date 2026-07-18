# Player Intro

A full-roster introduction for both teams — handles, roles, ranks and (optionally) per-player character art — in one of several layouts. Driven from **Graphics → Player Intro**, output at `/graphics/player-intro/`.

It reads the two loaded teams and their rosters ([Match & draft control](match-and-draft.md)), so set those up first.

## Layouts

Pick a layout in the control tab. The three core layouts show the same data; choose the one that fits your scene. VALORANT tournaments add two more: [Agent Cards](#agent-cards-valorant) and [Team Fan](#team-fan-valorant).

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

### Agent Cards (VALORANT)

A full-screen matchup board only offered on VALORANT tournaments: each team's five **agents as tall full-body portrait cards** clustered left and right around a centre VS, with team-name headers (team logos in the outer corners when **Logo** is on) and each card labelled with the player handle and agent name. It uses the same card language as the [Map Veto](map-veto.md) board, with energetic staggered in/out animations built to hand off into a match graphic.

![Player Intro — Agent Cards layout (VALORANT)](img/valorant-agent-cards.webp)

It reads each player's **Agent** field from the roster ([VALORANT guide](valorant.md#rosters--agents)) — assign agents once they lock, then bring the board up.

### Team Fan (VALORANT)

A composited "team photo": each team's five agents overlapped into one full-body lineup — centre agent tallest and foremost, heights stepping down outward, all standing on a shared floor, with each player's handle + agent beneath. The layout **auto-arranges by art width** (the widest portraits take the outer slots so capes and ability effects tuck behind their neighbours). A **Teams** option shows **both teams** around a centre VS, or **one team** full-screen — the hero treatment below. Enter animations: **Rise** (centre lands first, the fan opens outward) or **Converge** (outer agents sweep in from the sides while the centre rises).

![Player Intro — Team Fan layout, one team (VALORANT)](img/valorant-team-fan.webp)

## Controls

![Player Intro control tab](img/tool-player-intro.jpg)

From the Player Intro ctrl-bar:

![Player Intro live control bar — layout, options, animation and background](img/pi-controls.jpg)

- **Show / hide** the graphic (entrance/exit animate).
- **Layout** — Nameplate · Team Stack · Bar (VALORANT adds **Agent Cards** and **Team Fan**; the fan also gets a **Teams** group — Both / Team 1 / Team 2).
- **Options: Logo / Rank / Champs** — toggle each data row.
  - *League of Legends* — Ranks come from the Riot API ([Players / Rosters](match-and-draft.md#league-of-legends--ranks-and-champion-pools)). **Champs** blends each player's **top 3 most-played** champions (from their op.gg pool) along their row as overlapping splash crops that fade toward the name — players with no pool data fall back to a clean name. Available on the **Nameplate** and **Team Stack** layouts; the **Bar** layout is always name-only.
  - *VALORANT* — the art toggle shows each player's assigned **agent** rising out of their row instead of a champion strip.
- **Animation** — the entrance style (*Rise · Stagger · Fade*, plus *Split* on Agent Cards); the layout picks a sensible default.
- **Background** — transparent by default, or a **Dark** backdrop; the centre logo can be overridden per broadcast.

## Notes

- The rosters and ranks are pulled from the loaded teams — if a player has no rank set, that row simply omits it.
- For a single-player highlight rather than the whole roster, use [Player Spotlight](player-spotlight.md).
- Like all overlays this is transparent — composite it over your scene (or the [BG Output](bg-output.md) layer).
