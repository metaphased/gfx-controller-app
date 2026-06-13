<p align="center">
  <img src="public/fonts/metagfx-logo.png" alt="MetaGFX" width="420">
</p>

<h1 align="center">MetaGFX — Esports Tournament & Broadcast Suite</h1>

A self-hosted Node.js tournament & broadcast platform for esports. Teams, schedule, groups, brackets and prize pool are managed in one web panel that drives live OBS/vMix graphics — every overlay stays in sync, no manual re-entry. Runs locally.

> [!IMPORTANT]
> **MetaGFX is built for community and grassroots tournaments — not paid or commercial productions.**
>
> **The built-in sponsor tools are intended for crediting sponsors who contribute to the players'/competitors' prize pool — not for selling commercial ad space or funding staff/operator pay.**

## Stack

- **Server:** Node.js 18+ · Express · Socket.io (real-time state sync to all connected pages)
- **Auth:** Session-based login for the control panel; token-based access for graphics browser sources and caster view
- **Data:** JSON files in `data/` (auto-created on first run, not checked in to git)
- **No build step** — plain HTML/CSS/JS throughout

## Setup

```bash
npm install
npm start
```

Control panel: `http://localhost:3000/control`  
Operator view: `http://localhost:3000/operator`  
Caster view:   `http://localhost:3000/caster?token=XXXX`

On first run the server auto-creates a default superadmin account:
- **Username:** `admin`
- **Password:** `admin`

Change this immediately via **Settings → Accounts**.

### Environment variables

Create a `.env` file in the project root:

```
RIOT_API_KEY=your_key_here
PORT=3000
EXTERNAL_URL=http://YOUR_STATIC_IP:3000
```

| Variable | Required | Description |
|---|---|---|
| `RIOT_API_KEY` | No | Riot Games API key for Solo Queue rank lookups. **Do not use the temporary 24-hour Development key with this system** — it's only for *building* a tool and will expire mid-event. **Register a persistent key** by applying for a registered app/product at https://developer.riotgames.com. |
| `PORT` | No | Server port, defaults to `3000` |
| `EXTERNAL_URL` | No | Static IP/hostname for sharing output URLs outside localhost (e.g. to a remote OBS on the same LAN). When set, a **Local / External** toggle appears in **Settings → Output URLs** |

### Champion asset sync (standalone)

> [!NOTE]
> **The champion images (tiles, centered, splash) are not checked into git** — they're downloaded on demand to keep the repo small. After cloning, run the sync (below) or use **Settings → Champion Assets** to populate them. (The small role icons under `graphics/*/roles` do ship with the app.)

Downloads champion tiles, centered images, splash art, and role icons from the [DDragon GitHub repo](https://github.com/noxelisdev/LoL_DDragon). Only missing files are fetched on each run. Handles champion renames between DDragon versions (case-insensitive comparison on Windows).

```bash
node scripts/sync-assets.js            # download all missing files
node scripts/sync-assets.js --check    # report what's missing (lists filenames), no downloads
node scripts/sync-assets.js --force-roles  # re-download role icons (resolution upgrade)
```

Admins can also trigger a sync from **Settings → Champion Assets** in the control panel. The UI shows real-time per-target progress (file count + current filename) streamed via Socket.io while the sync runs.

### Development (auto-reload on save)

```bash
npm run dev
```

## Views

### Control Panel (`/control`)
Full admin interface for tournament setup, match management, graphic control, and system settings. Requires login.

### Operator View (`/operator`)
Simplified live-production view with graphic controls (show/hide toggles + ctrl-bar), live score/series tracker, and lower third builder. Requires operator or admin login. Shows a live presence strip indicating who else is connected and on which page. Panels can be **drag-reordered per-user** via **Edit Layout**, and an on-air indicator appears when a [live switcher](docs/live-switcher.md) is connected.

### Caster View (`/caster?token=XXXX`)
Read-only information page for casters during a live broadcast. Authenticated via the graphics token (same token as OBS browser sources). Tabs:

| Tab | Contents |
|---|---|
| **Roster** | Both teams' full player cards with Solo Queue rank, champion pool + win rates, Riot ID, op.gg link |
| **Series** | Current series games — side, result, role picks per game |
| **Draft** | Live pick/ban board with timer; per-game draft history; fearless ban pool for the series |
| **Standings** | Group stage standings (when active) |
| **Bracket** | Bracket results (when active) |
| **Schedule** | Day's schedule with match results |

## Graphics outputs

All graphics are browser sources intended for OBS or vMix at **1920×1080**.

Each URL requires a `?token=XXXX` parameter. The full URLs with your active token are listed in the control panel under **Settings → Output URLs** — copy these directly into OBS/vMix.

| Graphic | Path | Notes |
|---|---|---|
| Player Intro | `/graphics/player-intro/` | 3 layouts: Panel, Stack, Champion Showcase |
| Head to Head | `/graphics/head2head/` | Spotlight + lineup modes, champion stats strip |
| Draft Overlay | `/graphics/draft/` | Pick/ban board with timer |
| Win Screen | `/graphics/win-screen/` | 10 styles incl. 3 full-screen stingers + **COMP** (winning team's champion picks, full-screen); optional winning-draft-picks row on the other full-screen styles |
| Break Screen | `/graphics/break-screen/` | PIP mode supported |
| Pre-show | `/graphics/pre-show/` | |
| Lower Third | `/graphics/lower-third/` | |
| Bracket | `/graphics/bracket/` | Single + double elimination |
| Group Stage | `/graphics/group-stage/` | |
| Tournament Structure | `/graphics/tournament-structure/` | |
| Prizepool | `/graphics/prizepool/` | |
| Player Spotlight | `/graphics/player-spotlight/` | One or two players (left/right stage); Fullscreen + Lower Third; 4 designs; champion art + stats (op.gg / tournament sources, per-stat overrides), caption; see [docs](docs/player-spotlight.md) |
| BG Output | `/graphics/bg-output/` | Background animations only |

### GFX Bus outputs

Bus outputs are shared browser sources that automatically display whichever assigned graphic is currently visible — eliminating the need for one OBS source per graphic.

| Path | Notes |
|---|---|
| `/bus/:id` | e.g. `/bus/busA` — add `?token=XXXX` as with graphics |

Configure buses and assign graphics to them under **Routing** in the control panel. The operator view includes a routing matrix to switch the active graphic on each bus live.

## Control panel sections

**Tournament:** Profiles, Tournament Setup, Teams Database, Schedule, Groups, Playoffs

**Game:** Game Setup, Players / Rosters, Draft, Match Intel

**Graphics:** Broadcast Theme, BG Output, Lower Third, Head to Head, Pre-show, Ticker, Draft, Bracket, Group Stage, Tournament Structure, Prizepool, Break Screen, Win Screen, Scoreboard, Player Intro, Player Spotlight

**System:** Profiles, Routing (GFX bus config), Settings (users, token, output URLs, logos, **Appearance** theme, **Live Switcher**), Log (action history)

### User roles

| Role | Access |
|---|---|
| `superadmin` | Full control panel + full user management (create/delete/change password for any account) |
| `admin` | Full control panel; can manage operators and own password only — cannot modify other admin accounts |
| `operator` | Simplified operator view (live graphic toggles, score, lower third) |
| Graphics token | Read-only access to all graphics outputs and caster view — no account required |

The seeded `admin` account is `superadmin` by default. Create additional users in **Settings → Accounts**.

## Key features

- **Real-time state sync** across all browser tabs and graphics via Socket.io
- **Profile system** — save/restore full tournament configurations per event
- **Dashboard** — active match, tournament info, live schedule with scores and BOx status, live graphics status
- **GFX ctrl-bar** — persistent live control zone on every graphics page (show/hide, position, opacity, and graphic-specific options)
- **Draft overlay** with role-commit → auto-fetch champion stats from op.gg MCP (optional, separate setup); role assignment panel uses role-first rows (Top→Support) with a dropdown selector per role and a drag-drop toggle; caster view displays picks in role order once roles are committed
- **Match Intel panel** — live rank, champion pool, and draft stats for both teams
- **Pick/ban timer with pause/resume** — timer freezes on the overlay when paused
- **Player Intro graphic** — 3 layout variants (Panel, Stack/Mirror, Champion Showcase) with rank icons and team logos
- **Caster view** — live read-only dashboard for casters with roster intel, live draft board, series history, and fearless pool
- **External URL toggle** — serve OBS-ready URLs pointing to your static IP without changing the `.env` each run
- **Break screen PIP mode** — shrink to corner while other content shows
- **Ticker feed** — shared across Break Screen and Pre-show
- **Background animation system** — 12 canvas-based animations + fog overlay
- **Bo1/Bo3/Bo5 series tracking** with game-by-game draft snapshots
- **Bracket** (single + double elimination), **Group Stage** standings, **Tournament Structure**, and **Prizepool** graphics
- **Schedule ↔ bracket linking** — link a scheduled game to a playoff bracket match; the matchup shows on the bracket before it's played, and recording the series result fills the score + winner automatically (clearing reverts it)
- **Multi-user workflow** — built for shared production crew use:
  - **Presence strip** on all operator/caster/admin views — see who is connected and which page they're on
  - **Last-action attribution** on every GFX ctrl-bar — shows who last showed/hid a graphic and when
  - **Soft page claiming** — navigating to a GFX page claims it; others see an amber "Operated by [name]" indicator in the ctrl-bar (no hard blocking)
  - **Destructive action confirmation** — inline 2-second countdown confirm on reset, clear result, and delete operations
  - **System Log** — server-side ring buffer of significant actions (show/hide, record game, load profile, etc.), viewable by admin under **System → Log**
  - **Superadmin / admin role hierarchy** — prevents admins from modifying each other's accounts
- **Custom modal system** — all confirm/alert dialogs use an in-app styled overlay matching the UI theme, replacing browser-native popups
- **Animation customization** — global + per-graphic easing and speed control with a full easing library (Sine→Expo, Back, Bounce, Elastic), a live preview, and reusable named **Looks** that bundle palette + accents + background + animation into a visual identity applied over any profile; see [docs/theming.md](docs/theming.md)
- **Control-surface theming** — theme the control/operator UI (preset + accent hue/saturation + panel lightness), saved **per-user** with a superadmin-set panel default; one shared token system drives all chrome, plus a live styleguide at `/styleguide`; see [docs/ui-theming.md](docs/ui-theming.md)
- **Operator layout editor** — drag-reorder the operator panels (**Edit Layout**) to prioritise what you watch; saved per-user, independent of theme
- **Live on-air indicator (OBS / vMix)** — connect your switcher to flag when the broadcast is actually on air (LIVE/OFF AIR pill) and which graphics are genuinely live on program (PGM tags, optional PVW); OBS matches sources automatically by URL (event-driven detection — tags flip within ~100 ms of a switch), vMix by input title; see [docs/live-switcher.md](docs/live-switcher.md)
- **Per-user keybinds** — each operator records their own keyboard shortcuts for any graphics or match action; managed via a keybind editor that groups shortcuts into independently collapsible categories (profile modal on admin, **⌨ Keybinds** in operator); stored per-user account and ignored when an input field has focus
- **Bitfocus Companion / Stream Deck integration** — download a ready-to-import Companion 4.x profile from the profile modal; 4 pages of buttons (Show/Hide, Toggle, Match & Draft, Bus); auth token embedded in all URLs; SSE stream at `/api/events` for live state feedback (graphic visibility, scores, draft phase); see [docs/companion.md](docs/companion.md)
- **Champion asset sync** — download/update champion tiles, centered images, and role icons from DDragon; real-time progress in the admin UI or via `node scripts/sync-assets.js`
- **GFX Bus system** — shared OBS/vMix browser sources that route automatically to whichever assigned graphic is currently visible; create named buses, assign any graphics to each, and switch live from the operator routing matrix; ctrl-bar bus tags turn orange when a graphic is live on a bus; graphics preload in hidden iframes so switching is instant with no blank frames; out-animations play in full before the iframe hides
- **Head to Head improvements** — champion stats strip collapses to zero height when inactive (prevents player name overflow in lineup mode); header bars are fully opaque for clean scene masking
- **Player Spotlight graphic** — one- or two-player highlight built around each player's signature champion (left/right stage with directional slides and a Both face-off + head-to-head stat comparison); Fullscreen or Lower Third; 4 designs (Showcase, Angled, Full-bleed, Framed); per-player champion/caption/stat overrides with op.gg or this-event tournament stat sources; see [docs/player-spotlight.md](docs/player-spotlight.md)

## Data directory

The `data/` directory is created automatically on first run and is not checked in to git. It contains:

| File | Contents |
|---|---|
| `state.json` | Live broadcast state (restored on server restart) |
| `users.json` | User accounts (hashed passwords) |
| `teams.json` | Teams database |
| `profiles.json` | Saved tournament profiles |
| `session-secret.txt` | Auto-generated session signing key |
