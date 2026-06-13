# Getting started

This page gets MetaGFX running and points you at the few things that will save you a broken broadcast. Once you're in, follow the Setup & workflow guides in order: **[Tournament setup](tournament-setup.md) → [Schedule](schedule.md) → [Match & draft control](match-and-draft.md)**.

## Requirements

- **Node.js 18+**
- **OBS or vMix** with a browser-source capable scene (graphics render at 1920×1080)
- *(Optional)* a **persistent Riot API key** for Solo Queue rank lookups — see [below](#riot-api-key)

## Install & first run

```bash
npm install
npm start                    # serves on http://localhost:3000
node scripts/sync-assets.js  # download champion images (first run / after clone)
```

For auto-reload while developing, use `npm run dev` instead of `npm start`.

Then open the **control panel** at `http://localhost:3000/control` and log in.

> **First login:** `admin` / `admin` (a `superadmin` account seeded on first run).

## ⚠️ Before you go live — required reading

A handful of things bite people the first time. Read these once.

| # | What | Why it matters |
|---|---|---|
| 1 | **Change the default admin password** | First run seeds `admin` / `admin`. Change it immediately in **Settings → Accounts**, or anyone on your network can drive your broadcast. |
| 2 | **Champion images are NOT in the repo** | They're downloaded on demand to keep the repo small. After cloning, run the [asset sync](champion-assets.md) (or **Settings → Champion Assets**) — otherwise champion art is blank. |
| 3 | **Use a *persistent* Riot key** | Rank lookups need `RIOT_API_KEY`. **Don't use the 24-hour Development key** — it expires mid-event. See [Riot API key](#riot-api-key). |
| 4 | **Graphics need the token** | Every overlay/caster URL needs `?token=XXXX`. Copy the ready-made URLs from **Settings → Output URLs** into OBS/vMix. |
| 5 | **Remote OBS?** | If OBS runs on a different machine, set `EXTERNAL_URL` (see [below](#environment-variables)) so a **Local / External** toggle appears in **Settings → Output URLs**. |

## Adding the graphics to OBS / vMix

1. In MetaGFX, open **Settings → Output URLs** and copy the URL for the graphic you want (each already includes `?token=XXXX`).
2. In OBS/vMix add a **Browser Source** and paste the URL.
3. Set the source to **1920 × 1080**.
4. Leave the background transparent — overlays are transparent by design; composite them over your scene. For a coloured/animated backdrop use the separate [BG Output](bg-output.md) source as its own layer underneath.

To run many graphics through a handful of shared browser sources (big RAM/VRAM saving), see [GFX Bus](gfx-bus.md).

## Environment variables

All optional. Create a `.env` file in the project root:

```
RIOT_API_KEY=your_persistent_key_here
PORT=3000
EXTERNAL_URL=http://YOUR_LAN_IP:3000
```

| Variable | Required | Description |
|---|---|---|
| `RIOT_API_KEY` | No | Persistent Riot key for Solo Queue rank lookups. **Not** the 24-hour dev key. |
| `PORT` | No | Server port, defaults to `3000`. |
| `EXTERNAL_URL` | No | LAN IP/hostname for sharing output URLs to a remote OBS on the same network. |

### Riot API key

Rank lookups (Players / Rosters → *Refresh Ranks*) call the Riot API and need a key in `RIOT_API_KEY`.

- Register a **persistent product key** at [developer.riotgames.com](https://developer.riotgames.com).
- **Do not** use the **Development key** — it lasts 24 hours and will expire partway through your event.
- It's optional: everything else works without it, but ranks won't fetch.

Champion **pool** data comes from op.gg (see [Match & draft control](match-and-draft.md)) and doesn't need a Riot key.

## The views

| View | URL | Who | What |
|---|---|---|---|
| **Control panel** | `/control` | admin | Full tournament setup, match management, all graphic control, settings. |
| **Operator view** | `/operator` | operator/admin | Streamlined live production. See [Operator & multi-user](operator-and-multiuser.md). |
| **Caster view** | `/caster?token=XXXX` | token | Read-only caster dashboard. See [Caster view](caster-view.md). |

## Where data lives

The `data/` directory is created on first run and is **not** in git (it's yours, and machine-specific):

| File | Contents |
|---|---|
| `state.json` | Live broadcast state (restored on restart). |
| `users.json` | Accounts (hashed passwords). |
| `teams.json` | Teams Database. |
| `profiles.json` | Saved tournament [profiles](tournament-setup.md#profiles). |
| `session-secret.txt` | Auto-generated session signing key. |

## Next steps

- **[Tournament setup](tournament-setup.md)** — create the event, add competing teams, define the structure.
- **[Schedule](schedule.md)** — lay out broadcast days and matches.
- **[Match & draft control](match-and-draft.md)** — load a match and drive the live graphics.
