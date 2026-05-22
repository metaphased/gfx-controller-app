# Esports Broadcast GFX Controller

A full-featured local broadcast graphics system for esports productions — built for OBS, vMix, and similar production software. Runs as a Node.js server with a real-time Socket.io control panel.

---

## Quick Start

```bash
npm install
npm start
```

Open the control panel at **http://localhost:3000/control/**

Use your admin credentials on first launch. All graphic URLs use a **token** for read-only access without requiring login.

---

## Graphic Outputs

Add each URL as a **Browser Source** in OBS/vMix. Set width `1920`, height `1080`. Enable **Transparent Background** for overlays.

The token for each URL is shown in **Settings → Graphics Output URLs** in the control panel.

| Graphic | URL | Type |
|---|---|---|
| Head to Head | `/graphics/head2head/?token=...` | Overlay |
| Pre-show | `/graphics/pre-show/?token=...` | Full screen |
| Draft Overlay | `/graphics/draft/?token=...` | Overlay |
| Bracket | `/graphics/bracket/?token=...` | Full screen |
| Group Stage | `/graphics/group-stage/?token=...` | Full screen |
| Tournament Structure | `/graphics/tournament-structure/?token=...` | Full screen |
| Prizepool | `/graphics/prizepool/?token=...` | Full screen |
| BG Output | `/graphics/bg-output/?token=...` | Full screen (opaque) |
| Break Screen | `/graphics/break-screen/?token=...` | Full screen |
| Win Screen | `/graphics/win-screen/?token=...` | Full screen |
| Scoreboard | `/graphics/scoreboard/?token=...` | Overlay |
| Lower Third | `/graphics/lower-third/?token=...` | Overlay |

### BG Output
A standalone **opaque** background page designed to be used as a persistent base layer in your production software. All other transparent overlays sit on top of it. Gives a consistent animated background across your entire show. Controlled independently from the main Broadcast Theme background.

---

## Control Panel — Section Guide

### Tournament
- **Profiles** — Save and load full show configurations (team data, settings, bracket, all GFX state). Use a new profile per tournament/day.
- **Tournament Setup** — Tournament name, format (Bo1/Bo3/Bo5), playoff format (single/double elim), region, patch, location, dates, group stage toggle, tiebreaker rules, sponsor logos.
- **Teams Database** — Full roster management. Team name, tag, logo, accent colour. Player handles, real names, roles. Logos and portraits can be uploaded or linked.
- **Schedule** — Day-by-day match schedule. Link matches to bracket rounds. Set current active game. View draft history per game.
- **Groups** — Group stage standings editor. Set qualifying cutoff lines per group.
- **Playoffs** — Bracket editor for single or double elimination. Edit match results, mark complete.

### Game
- **Game Setup** — Active match controls. Load teams from the schedule or directly. Manage series state, game number, format. Record game results with winner/loser. Restore completed games. View series/draft snapshots.
- **Draft** — Draft phase controller. Set blue/red sides, advance steps manually or via auto-timer. Role assignment post-draft. Fearless draft tracking. Phase label (Subtle/Bold). Timer duration.
- **Players / Rosters** — Per-team player list with roles for the active match. Used by Head to Head, Lower Third, and Draft overlays.

### Graphics

#### Broadcast Theme
Global visual settings applied to all graphics:
- **Colour palette** — 4 swatchable slots (Primary, Secondary, Light, Dark) + Blue/Red side accents
- **Graphic Background** — Transparent / Solid / Image / Animated. Background animations:
  - Classic geometric (pulsing): Grid, Hex Grid, Diamonds, Dot Wave, Lines, Rings
  - Atmospheric: Particles, Scanlines, Circuit, Rain, Fog, Wave (+ image distortion)
- **Fog Layer** — Composable overlay that adds bottom-anchored fog on top of any background type
- **Broadcast Logos** — Logo library used across all graphics (tournament emblem, wordmark, etc.)

#### BG Output
Independent background settings for the BG Output page. Same animation options as Broadcast Theme but controlled separately.

#### Scoreboard
Top-of-screen score bar overlay. Shows team tags, scores, game/series state.

#### Lower Third
Customisable text overlay. Quick-select buttons populate from the active roster.

#### Head to Head
Full-screen versus graphic. Spotlight mode (champion splash arts + player names) and Lineup mode. Pulls from Match Setup and Rosters automatically.

#### Pre-show
Full-screen countdown/schedule graphic. Two layouts:
- **Centre** — Logo + countdown timer centred, schedule below
- **Side** — Timer panel left, upcoming matches right

Supports countdown timer, target-time mode, sponsor logos, bracket-linked TBD teams, live ticker.

#### Ticker
Scrolling news/results banner. Auto mode pulls from schedule results. Manual mode for custom items. Appears on Break Screen and Pre-show.

#### Draft
Full arena-style draft overlay. Features:
- 5v5 ban/pick grid with champion art
- Per-team fearless ban tracking
- CCW timer ring with auto-reset on step advance
- Phase label (Banning / Picking) in Subtle or Bold style
- Role assignment post-draft syncs pick order to role slots
- Arena layout (standard) — Classic layout placeholder pending

#### Bracket
Animated playoff bracket. Single or double elimination. Connector animations reveal when rounds complete. Section labels animate in. Shows scores, marks complete matches.

#### Group Stage
Group stage standings. Two modes:
- **Live** — All teams equal, no qualifier distinction (during play)
- **Final** — Qualifying indicator, cutoff line, eliminated teams dimmed

#### Tournament Structure
Info graphic showing the tournament format. Shows Group Stage + Playoffs cards or Playoffs only (solo layout). Info pills: Teams/Rosters, Dates (with cross-year detection), Region, Patch, Location.

#### Prizepool
Prize breakdown graphic. Add placement rows (1st, 2nd–3rd, etc.) and bonus/sponsor award cards with images. 1st place row gets an accent highlight treatment.

#### Break Screen
Full-screen break overlay. Features:
- Custom message + subtext
- Countdown timer (set minutes/seconds, extend by 5m from bottom bar)
- Next match auto-derived from schedule
- Sponsor logos
- **PIP mode** — Compact layout showing live series state + score in a corner pip
- Live ticker

#### Win Screen
Animated victory screen. 6 animation styles:
- **Blade** — Parallelogram band sweeps across. Fast and punchy.
- **Burst** — Detonates from centre with shockwave rings and colour flash.
- **Slam** — Full-screen overlay, card slams in from right. Best for scene transitions.
- **Split** — Team colour floods the left half, glowing divider at centre, content on left. Font auto-scales for long team names.
- **Spotlight** — Screen dims, light cone descends from above, logo springs in with sparkle particles.
- **Wipe** — Cinematic letterbox bars close from top and bottom, light streak sweeps across.

Auto-populated from game results. Team colour drives all accent colours.

---

## Bottom Live Bar

The persistent control bar at the bottom of the control panel gives one-click access to all toggles during a live show:

`Game context | LOWER 3RD | H2H | DRAFT | BRACKET | GROUPS | STRUCTURE | PRIZES | BREAK + timer + PIP | TICKER | WIN`

- Coloured dots indicate each graphic's live status
- BREAK group includes timer inputs, ▶ start, ✕ clear, +5m extend, and PIP toggle
- WIN indicator shows which team is currently set as winner

---

## Theming & Scaling

All graphics use CSS `vh`/`vw` units. Changing your OBS/vMix browser source to 1440p or 4K scales everything automatically — no code changes needed.

Team accent colours are set per-team and propagate to win screens, draft overlays, and all team-specific elements automatically.

---

## Authentication & Tokens

The control panel requires login. Two roles:
- **Admin** — Full access including bracket/group editing, settings, user management
- **Operator** — Access to live show controls only (game setup, GFX triggers, etc.)

Graphics use a read-only **graphics token** (shown in Settings → Graphics Output URLs). This allows OBS/vMix browser sources to connect without operator credentials. Regenerating the token invalidates all current OBS URLs — do this before a show to lock down access, not during.

---

## Profile System

Profiles save the full show state: tournament config, bracket, schedule, team data, all GFX settings. Use a new profile for each tournament or show day. Loading a profile restores everything except the graphics token.

---

## File Structure

```
server.js              — Express + Socket.io server, all API endpoints, state management
public/
  control/             — Control panel (HTML + CSS + JS, served at /control/)
  graphics/
    gfx-settings.js    — Shared GFX helper (theme, background animations, fog layer)
    head2head/
    pre-show/
    draft/
    bracket/
    group-stage/
    tournament-structure/
    prizepool/
    bg-output/
    break-screen/
    win-screen/
    scoreboard/
    lower-third/
data/                  — Persisted state (profiles, uploads index) — not committed to git
public/uploads/        — Uploaded images — not committed to git
```
