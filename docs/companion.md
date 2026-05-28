# Companion / Stream Deck Integration & Keybinds

## Overview

MetaGFX supports two ways to trigger graphics and match actions without touching the control panel:

- **Bitfocus Companion** — physical control surfaces (Stream Deck, X-Keys, etc.) via downloadable Companion profile
- **Keyboard shortcuts** — per-user keybinds recorded directly in the control panel

Both use the same underlying action API, so any action triggerable from a button is also triggerable from a keybind.

---

## Keybinds

### Setup

1. Log into the control panel and click the **user chip** in the bottom-left sidebar (shows your username and role)
2. The profile modal opens — keybinds are grouped by category: Graphics, Match, Draft, Bus
3. Click any **key combo field** to enter listening mode (the field highlights and shows "Press a key…")
4. Press the key combination you want — it records immediately
5. If the combo is already bound to another action, a conflict warning appears inline (you can still save the override)
6. Click **Save Keybinds** or close the modal — unsaved changes auto-save on close

### Behaviour

- Keybinds are **per-user** — different operators can have different layouts
- Keybinds are ignored when focus is inside an `<input>`, `<textarea>`, or `<select>` field
- Supported modifiers: `Ctrl`, `Alt`, `Shift`, `Meta` — any combination
- Supported keys: all standard keys, F-keys (`F1`–`F12`), numpad (`Numpad0`–`Numpad9`), arrows, etc.
- Example combos: `ctrl+1`, `ctrl+shift+f1`, `numpad0`, `alt+arrowup`

### Available actions

| Category | Action |
|---|---|
| Graphics | Show / Hide / Toggle for each overlay (Lower Third, Head to Head, Player Intro, Draft, Win Screen, Break Screen, Bracket, Group Stage, Tournament Structure, Prizepool, Ticker) |
| Match | Team 1 score +1 / -1, Team 2 score +1 / -1, Next game, Prev game, Swap sides |
| Draft | Reset draft, Replay intro, Toggle timer |
| Bus | Show / Hide / Next graphic for each configured bus |

---

## Companion / Stream Deck

### Requirements

- [Bitfocus Companion](https://bitfocus.io/companion) v4.x installed
- MetaGFX server running and accessible from the Companion machine
- A **Graphics Token** set in MetaGFX (**Settings → Security**)

> The graphics token is embedded in all button URLs so Companion can authenticate. Without it the buttons will get 401 responses. Set one in Settings before downloading the profile.

### Downloading the profile

1. Log into the control panel and click the user chip (bottom-left sidebar)
2. Click **⬡ Companion** in the profile modal footer
3. `metagfx-companion.companionconfig` downloads automatically

### Importing into Companion

1. Open Companion → **Settings → Import / Export**
2. Click **Full Import** tab, then choose the downloaded `.companionconfig` file
3. Companion shows a preview — select the components you want (at minimum: **Buttons**)
4. Under **Import Connections Behavior**, leave MetaGFX as **Create new connection**
5. Click **Import** to confirm

The import creates a **MetaGFX** connection (Generic: HTTP Requests) with your server's base URL pre-filled.

> If Companion is on a different machine from MetaGFX, edit the connection after import: **Connections → MetaGFX → Base URL** — change `http://localhost:3000` to your server's IP/hostname.

### Pages

The profile generates 4 pages:

| Page | Name | Contents |
|---|---|---|
| 1 | GFX Show/Hide | Show and Hide button for every graphic overlay |
| 2 | GFX Toggle | Toggle button for every graphic overlay |
| 3 | Match & Draft | T1/T2 score ±1, Next/Prev Game, Draft Timer toggle, Reset Draft, Replay Draft Intro |
| 4 | Bus | "Next graphic" cycle button for each configured GFX bus |

Assign pages to Stream Deck hardware in Companion under **Surfaces**.

### Re-generating the profile

Re-download the profile whenever:
- You change your graphics token
- You add or remove GFX buses (Bus page is generated from live settings)
- Your server IP/hostname changes

---

## Action API reference

All endpoints require auth (session cookie **or** `?token=XXXX` query param **or** `X-Graphics-Token: XXXX` header).

### Graphics

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/graphic/:name/show` | Show the named graphic |
| `POST` | `/api/graphic/:name/hide` | Hide the named graphic |
| `POST` | `/api/graphic/:name/toggle` | Toggle visibility |

Valid `:name` values: `lowerThird`, `headToHead`, `playerIntro`, `draft`, `winScreen`, `breakScreen`, `bracket`, `groupStage`, `tournamentStructure`, `prizepool`, `ticker`

### Match

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/match/score/team1/increment` | Team 1 score +1 |
| `POST` | `/api/match/score/team1/decrement` | Team 1 score -1 (min 0) |
| `POST` | `/api/match/score/team2/increment` | Team 2 score +1 |
| `POST` | `/api/match/score/team2/decrement` | Team 2 score -1 (min 0) |
| `POST` | `/api/match/next-game` | Advance to next game, clear draft picks |
| `POST` | `/api/match/prev-game` | Step back one game |

### Draft

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/draft/timer/toggle` | — | Start timer if stopped, stop if running |
| `POST` | `/api/draft` | `{"phase":"notstarted","currentStep":0}` | Reset draft to start |
| `POST` | `/api/draft` | `{"replayIntro":true}` | Replay draft intro animation |

### Bus

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/bus/:id/next` | Cycle bus to its next assigned graphic |

### SSE state stream

```
GET /api/events
```

Returns a persistent `text/event-stream`. Pushes a state snapshot on every change (debounced ~100 ms). Requires auth (session or token).

**Event payload:**

```json
{
  "type": "state",
  "visibilities": { "draft": true, "winScreen": false, "bracket": false, ... },
  "busState": { "busA": { "activeGraphic": "draft", "visible": true }, ... },
  "scores": { "team1": 1, "team2": 0 },
  "draftPhase": "picks2",
  "timerRunning": true,
  "activeProfile": "worlds-2025"
}
```

Use the `visibilities` fields to drive button LED feedback in Companion (via Generic HTTP feedback or custom variables).

### Companion profile download

```
GET /api/companion/profile
```

Returns a downloadable `.companionconfig` file pre-populated with all action buttons and the MetaGFX connection. Requires auth.
