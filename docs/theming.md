# Broadcast Theming & Animation

Everything visual is configured under **Broadcast Theme** in the control panel and applies live to every graphic overlay. Theme settings are saved per tournament profile; reusable **Looks** let you carry a visual identity across profiles.

## Colour palette & accents

Four palette slots are wired across **every** overlay (exposed as CSS variables `--gfx-c1`–`--gfx-c4`, plus RGB-triplet variants `--gfx-cN-rgb` for translucent surfaces). Each has a role:

| Slot | Var | Drives |
|---|---|---|
| **Primary** | `--gfx-c1` | main accent — headers, key highlights, winner accent, accent tints/gradients |
| **Secondary** | `--gfx-c2` | stage/format labels (Grand Final, "Advances to Playoffs", match format) & secondary highlights |
| **Light** | `--gfx-c3` | primary foreground text (muted/secondary text deliberately left neutral) |
| **Dark** | `--gfx-c4` | panel / card / bar backgrounds (kept translucent — the dark "glass" look) |

- **Team Side Accents** — Blue side / Red side colours (`--gfx-blue` / `--gfx-red`), used to differentiate sides in Draft, Head-to-Head and Player Intro (team 1 = blue, team 2 = red). These are *side*-based, not per-team.
- **Per-team colours were removed** — team logos and names differentiate teams; a designed palette + side accents avoid clashes. The Win Screen accent comes from the winning side, Primary, or a custom colour (see its **Accent Colour** control).

Every wiring keeps the original colour as a literal fallback, so the default palette reproduces the standard look exactly and unsupported renderers degrade gracefully. Changing a slot updates all graphics live. A wild palette can reduce legibility — the seeded **Looks** are safe starting points.

## Background

Graphic overlays are **always transparent** — composite them over your scene in OBS/vMix. For a coloured or animated backdrop, use the dedicated **BG Output** source (its own tab: background mode Transparent / Solid / Image / Animated, plus animation type, base colour, speed and an optional fog layer) as a separate layer underneath the overlays.

> This is a deliberate performance choice: an animated canvas *inside* every graphic source is far heavier than compositing two independent sources. The BG Output canvas is capped at ~60fps. Player Intro keeps its own optional solid **Dark** backing (cheap — a solid colour, never an animated canvas).

## Animation

The **Animation** card controls how graphics enter, exit, and react to data changes.

- **Editing target** — choose **All graphics (global default)** or a single graphic to override just that one.
- **Speed** — Instant / Fast / Medium / Slow (a global duration multiplier; overlays keep their own choreographed relative timings).
- **Easing** — separate **Entrance**, **Exit**, and **Data change** curves, chosen from a full library:
  - Sine, Quad, Cubic, Quart, Quint, Expo, Circ (In / Out / In-Out each)
  - Back (overshoot), Bounce, Elastic
- **Live preview** — replays the entrance easing at the chosen speed.
- **Per-graphic overrides** — when editing a specific graphic, each field offers **— Use global —** (inherit) plus a **Global** speed option; **Reset to global** clears that graphic's override. A note lists which graphics currently have custom overrides.

### How it works under the hood

`GfxSettings.applyAnimation()` (in `public/graphics/gfx-settings.js`) injects CSS variables on `:root`:

| Variable | Meaning |
|---|---|
| `--gfx-ease-enter` / `--gfx-ease-exit` / `--gfx-ease-move` | resolved timing-functions |
| `--gfx-dur-scale` | unitless speed multiplier (Instant=0 … Slow=1.6) |

Overlay CSS consumes them with literal fallbacks, e.g.
`animation: pi-rise calc(0.55s * var(--gfx-dur-scale, 1)) var(--gfx-ease-enter, cubic-bezier(0.25,1,0.5,1)) both;`
so an unset token always falls back to the original look.

- **Bounce / Elastic** can't be a single `cubic-bezier`, so they're emitted as CSS `linear()` easing functions. On renderers without `linear()` support (older embedded browsers), the nearest overshoot bezier is substituted automatically.
- **Reduced motion** — if the viewer's OS/browser requests reduced motion, the duration scale is forced to 0 (animations resolve instantly).

## Looks

A **Look** bundles the palette, accents, background and full animation config (including per-graphic overrides) into a named, reusable visual identity. Looks are theme-only — applying one never touches teams, schedule or other tournament data, and the logo library is intentionally excluded.

From the **Looks** card (top of Broadcast Theme):

- **Save current as Look** — snapshot the current theme + animation under a name
- **Apply** — replace the current theme/animation with the Look's
- **Update** — overwrite an existing Look with the current settings
- **Rename** / **Delete**

Three example Looks (Broadcast Clean, Neon Surge, Big Impact) are seeded on first run. Looks are stored in `data/looks.json`; the API lives at `GET/POST /api/looks*` (admin only).
