# Broadcast Theming & Animation

Everything visual is configured under **Broadcast Theme** in the control panel and applies live to every graphic overlay. Theme settings are saved per tournament profile; reusable **Looks** let you carry a visual identity across profiles.

## Colour palette & accents

- **Colour Palette** — four named slots (Primary / Secondary / Light / Dark) exposed to the overlays as the CSS variables `--gfx-c1`–`--gfx-c4`.
- **Team Side Accents** — Blue side / Red side colours (`--gfx-blue` / `--gfx-red`), used to differentiate sides in the Draft and Head-to-Head graphics.

> Note: today the overlays mainly consume **Primary** + the side accents; the other palette slots are wired sparsely. Broadening palette usage is a planned enhancement.

## Background

Per-graphic background mode (Transparent / Solid / Image / Animated) plus the canvas animation type, base colour, speed and an optional fog layer.

> For performance, prefer **Transparent** overlays with the dedicated **BG Output** page as a separate OBS/vMix source underneath — an animated canvas *inside* a graphic source is much heavier than compositing two independent sources.

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
