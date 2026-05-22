# MetaGFX — Esports Broadcast Graphics Controller

A self-hosted Node.js broadcast graphics system for live esports production. Runs locally, connects to OBS/vMix via browser sources, controlled by a web-based admin panel.

## Stack

- **Server:** Node.js + Express + Socket.io (real-time state sync)
- **Auth:** JWT tokens — all graphics require `?token=XXXX` in the URL
- **Data:** op.gg MCP (champion pools, player stats), Riot API (Solo Queue rank)
- **No build step** — plain HTML/CSS/JS throughout

## Running

```bash
npm install
npm start
```

Control panel: `http://localhost:3000`
Default credentials are set in `users.json`.

Copy `.env.example` to `.env` and add a Riot API key if using rank/champion pool fetching.

## Graphics outputs

All graphics live at `/graphics/<name>/` and require `?token=XXXX`.

| Graphic | Path |
|---|---|
| Head to Head | `/graphics/head2head/` |
| Draft | `/graphics/draft/` |
| Win Screen | `/graphics/win-screen/` |
| Break Screen | `/graphics/break-screen/` |
| Pre-show | `/graphics/preshow/` |
| Lower Third | `/graphics/lower-third/` |
| Bracket | `/graphics/bracket/` |
| Group Stage | `/graphics/group-stage/` |
| Tournament Structure | `/graphics/tournament-structure/` |
| Prizepool | `/graphics/prizepool/` |
| BG Output | `/graphics/bg-output/` |

Output URLs with active token are listed in the control panel under **Settings → Graphics Output URLs**.

## Control panel sections

**Tournament:** Profiles, Tournament Setup, Teams Database, Schedule, Groups, Playoffs

**Game:** Game Setup, Draft, Players / Rosters, Match Intel

**Graphics:** Broadcast Theme, BG Output, Lower Third, Head to Head, Pre-show, Ticker, Draft, Bracket, Group Stage, Tournament Structure, Prizepool, Break Screen, Win Screen

**System:** Settings (users, token, logos)

## Key features

- Real-time state sync across all browser tabs and graphics via Socket.io
- Profile system — save/restore full tournament configurations
- Draft overlay with role-commit → auto-fetch champion stats from op.gg
- Match Intel panel — live rank, champion pool, and draft stats for both teams
- Break screen PIP mode — shrink to corner while other content shows
- Ticker feed — shared across Break Screen and Pre-show
- Background animation system — 12 canvas-based animations + fog overlay
- Bo1/Bo3/Bo5 series tracking with game-by-game draft snapshots
- Bracket (single + double elimination), Group Stage standings, Tournament Structure graphic
