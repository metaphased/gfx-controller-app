# Operator view & multi-user

MetaGFX is built for a crew. The **operator view** is a streamlined live-production surface, and a layer of **multi-user** features (roles, presence, soft page-claiming, attribution and a log) keeps several people working without stepping on each other.

## Roles

| Role | Access |
|---|---|
| `superadmin` | Full control panel + full user management. The seeded `admin` account is superadmin. |
| `admin` | Full control panel; manages operators and their own password. |
| `operator` | The simplified operator view only (toggles, score, lower third). |
| Graphics token | Read-only access to graphics outputs + the [caster view](caster-view.md) — no account. |

Create and manage accounts in **Settings → Accounts**. (Change the default `admin` / `admin` password first — see [Getting started](getting-started.md#-before-you-go-live--required-reading).)

## Operator view

Open at **`/operator`** (operator or admin login). It's a focused, live-production layout rather than the full setup panel:

- **Graphic toggles + ctrl-bars** — show/hide every graphic and adjust its key live options, the same controls as the admin panel's ctrl-bars.
- **Score / series tracker** — drive the match score and series.
- **Lower-third builder** — fire lower thirds for players and casters.
- **Bus routing** — switch what's live on each [GFX bus](gfx-bus.md).
- **On-air indicator** — the [Live Switcher](live-switcher.md) LIVE/OFF-AIR pill and per-graphic PGM/PVW tags.
- **Drag-reorderable panels** — arrange the surface to suit how you operate.

Operators get exactly the controls they need for show day and none of the tournament-setup machinery.

## Working as a crew

When more than one person is connected, MetaGFX coordinates them in real time:

- **Presence** — a strip shows who's online and which page each person is on.
- **Soft page-claiming** — when you start working on a graphic's page, it's *claimed*; others see a badge showing who's editing it, so two people don't fight over the same overlay. It's advisory (a soft lock), not a hard block.
- **Last-action attribution** — each graphic records who last showed/hid/changed it, so it's clear who did what.
- **System log** — **System → Log** is a running record of actions (shows/hides/edits) with the user and time, for after-the-fact review.

All graphic and state changes broadcast over WebSockets, so every panel, operator view and output stays in sync instantly.

## Notes

- Everything is **manual** by design — there's no automation driving graphics; the crew is always in control. (Any automation belongs in OBS/vMix.)
- The [caster view](caster-view.md) is a separate read-only, token-authed surface for non-operating crew (casters/analysts).
