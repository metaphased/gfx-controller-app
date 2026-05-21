# Esports Broadcast GFX Controller

Local broadcast graphics system for esports productions — built for vMix integration.

## Quick Start

```bash
npm install
npm start
```

Then open:
- **Control Panel** → http://localhost:3000/control/

---

## vMix Setup — Add Web Browser Sources

In vMix, add each graphic as a **Web Browser** input:

| Graphic | URL |
|---|---|
| Scoreboard | `http://localhost:3000/graphics/scoreboard/` |
| Lower Third | `http://localhost:3000/graphics/lower-third/` |
| Head to Head | `http://localhost:3000/graphics/head2head/` |
| Champ Select | `http://localhost:3000/graphics/champ-select/` |
| Bracket | `http://localhost:3000/graphics/bracket/` |
| Break Screen | `http://localhost:3000/graphics/break-screen/` |
| Win Screen | `http://localhost:3000/graphics/win-screen/` |

**vMix Web Browser settings:**
- Width: `1920`, Height: `1080`
- Enable: "Transparent Background" ✓
- All graphics except Break Screen and Win Screen are transparent overlays — layer them over your scenes

---

## Control Panel Overview

### Match Setup
- Set team names, tags, logos, and accent colors
- Configure tournament name, format, and game title
- Upload sponsor logos (displayed on break screen)
- Control scores with +/- buttons

### Players / Rosters
- Enter handle, real name, and role for each player (5 per team)
- Used by Lower Third quick buttons, Head to Head, and Champ Select

### Import Data
- **Google Sheets** — Enter Sheet ID + API Key, pulls player data automatically
- **JSON / CSV** — Upload files with columns: `team, handle, name, role, country`
  - `team` column should be `1`, `2`, or the team name/tag

### Graphics Control
Each graphic section has SHOW / HIDE buttons that control visibility in real-time.

**Scoreboard** — Top-of-screen score bar. Control scores directly from this tab.

**Lower Third** — Customizable text overlay. Use Quick Player buttons to auto-populate from roster.

**Head to Head** — Full-screen versus graphic. Pulls from Match Setup + Players automatically.

**Champ Select** — Draft overlay. Enter image URLs or champion names for bans/picks. Set current phase.

**Bracket** — Build your playoff bracket with rounds and matches. Mark matches complete to show scores.

**Break Screen** — Full-screen break overlay with animated background. Supports countdown timer.

**Win Screen** — Animated victory screen with particle effects. Select winning team and show.

---

## Expanding the System

### Adding a New Graphic
1. Create `public/graphics/your-graphic/index.html`
2. Connect to Socket.io and listen to `state` events
3. Add your graphic to the control panel tabs

### Adding Game Support
In the server state, `match.game` can be any string. Add new logic in graphic pages based on this value.

### Google Sheets Format
Your sheet should have a header row with at minimum:
```
team | handle | name | role | country
```
`team` should be `1` or `2`, or match your team name/tag.

### Uploading Images
Click any "Upload" button to add PNGs to the local `/public/uploads/` directory. Uploaded files persist between sessions.

---

## Theming
The base color scheme (defined in CSS variables on each page):
- Background: `#0a1b20`
- Accent: `#a7a38e`
- Primary / Highlight: `#1ffaff`

Team colors can be customized per-team in Match Setup and will propagate to all graphics.
