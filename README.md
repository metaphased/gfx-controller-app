# MetaGFX — Esports Broadcast Graphics Controller

A self-hosted Node.js broadcast graphics system for live esports production. Runs locally, connects to OBS/vMix via browser sources, controlled by a web-based admin panel.

## Stack

- **Server:** Node.js 18+ · Express · Socket.io (real-time state sync to all connected pages)
- **Auth:** Session-based login for the control panel; JWT tokens for graphics browser sources
- **Data:** JSON files in `data/` (auto-created on first run, not checked in to git)
- **No build step** — plain HTML/CSS/JS throughout

## Setup

```bash
npm install
npm start
```

Control panel: `http://localhost:3000`

On first run the server auto-creates a default admin account:
- **Username:** `admin`
- **Password:** `admin`

Change this immediately via **Settings → Accounts**.

### Environment variables

Create a `.env` file in the project root (not required to run, only needed for Riot API features):

```
RIOT_API_KEY=your_key_here
PORT=3000
```

- `RIOT_API_KEY` — Riot Games Developer API key for Solo Queue rank lookups. Development keys expire every 24 hours; regenerate at https://developer.riotgames.com
- `PORT` — defaults to `3000` if not set

### Development (auto-reload on save)

```bash
npm run dev
```

## Graphics outputs

All graphics are browser sources intended for OBS or vMix at **1920×1080**.

Each URL requires a `?token=XXXX` parameter. The full URLs with your active token are listed in the control panel under **Settings → Output URLs** — copy these directly into OBS/vMix.

| Graphic | Path |
|---|---|
| Head to Head | `/graphics/head2head/` |
| Draft | `/graphics/draft/` |
| Win Screen | `/graphics/win-screen/` |
| Break Screen | `/graphics/break-screen/` |
| Pre-show | `/graphics/pre-show/` |
| Lower Third | `/graphics/lower-third/` |
| Bracket | `/graphics/bracket/` |
| Group Stage | `/graphics/group-stage/` |
| Tournament Structure | `/graphics/tournament-structure/` |
| Prizepool | `/graphics/prizepool/` |
| BG Output | `/graphics/bg-output/` |

## Control panel sections

**Tournament:** Profiles, Tournament Setup, Teams Database, Schedule, Groups, Playoffs

**Game:** Game Setup, Draft, Players / Rosters, Match Intel

**Graphics:** Broadcast Theme, BG Output, Lower Third, Head to Head, Pre-show, Ticker, Draft, Bracket, Group Stage, Tournament Structure, Prizepool, Break Screen, Win Screen

**System:** Settings (users, token, output URLs, logos)

### User roles

| Role | Access |
|---|---|
| `admin` | Full control panel |
| `operator` | Simplified operator view (live graphic toggles, score, lower third) |

Create additional users in **Settings → Accounts**.

## Key features

- Real-time state sync across all browser tabs and graphics via Socket.io
- Profile system — save/restore full tournament configurations per event
- Draft overlay with role-commit → auto-fetch champion stats from op.gg MCP (optional, separate setup)
- Match Intel panel — live rank, champion pool, and draft stats for both teams
- Pick/ban timer with pause/resume — timer freezes on the overlay when paused
- Break screen PIP mode — shrink to corner while other content shows
- Ticker feed — shared across Break Screen and Pre-show
- Background animation system — 12 canvas-based animations + fog overlay
- Bo1/Bo3/Bo5 series tracking with game-by-game draft snapshots
- Bracket (single + double elimination), Group Stage standings, Tournament Structure, Prizepool graphics

## Data directory

The `data/` directory is created automatically on first run and is not checked in to git. It contains:

| File | Contents |
|---|---|
| `state.json` | Live broadcast state (restored on server restart) |
| `users.json` | User accounts (hashed passwords) |
| `teams.json` | Teams database |
| `profiles.json` | Saved tournament profiles |
| `session-secret.txt` | Auto-generated session signing key |
