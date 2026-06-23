# Broadcast Theming & Animation

Everything visual is configured under **Broadcast Theme** in the control panel and applies live to every graphic overlay. Theme settings are saved per tournament profile; reusable **Looks** let you carry a visual identity across profiles.

![Broadcast Theme control tab](img/tool-broadcast-theme.jpg)

## Colour palette & accents

Four palette slots are wired across **every** overlay (exposed as CSS variables `--gfx-c1`–`--gfx-c4`, plus RGB-triplet variants `--gfx-cN-rgb` for translucent surfaces). Each has a role:

| Slot | Var | Drives |
|---|---|---|
| **Primary** | `--gfx-c1` | main accent — headers, key highlights, winner accent, accent tints/gradients |
| **Secondary** | `--gfx-c2` | stage/format labels (Grand Final, "Advances to Playoffs", match format) & secondary highlights |
| **Light** | `--gfx-c3` | primary foreground text (muted/secondary text deliberately left neutral) |
| **Dark** | `--gfx-c4` | panel / card / bar backgrounds (kept translucent — the dark "glass" look) |

- **Team Side Accents** — Blue side / Red side colours (`--gfx-blue` / `--gfx-red`), used to differentiate sides in Draft, Head-to-Head and Player Intro (team 1 = blue, team 2 = red). These are *side*-based, not per-team.
- **No per-team colours** — teams are differentiated by their logos and names, while a designed palette plus side accents avoid colour clashes. The Win Screen accent comes from the winning side, Primary, or a custom colour (see its **Accent Colour** control).

Every wiring keeps the original colour as a literal fallback, so the default palette reproduces the standard look exactly and unsupported renderers degrade gracefully. Changing a slot updates all graphics live. A wild palette can reduce legibility — the seeded **Looks** are safe starting points.

## Typography

The **Typography** card sets the **broadcast fonts** used across *every* overlay. There are two:

- **Primary (display)** — the big display text: team/player names, titles, big numbers/scores.
- **Secondary (labels)** — the supporting text: stage/format labels, ranks, captions, sub-text, stat labels, ticker copy.

![Typography card on the Broadcast Theme tab](img/tool-typography.jpg)

Pick any bundled family for each from its dropdown and all graphics restyle live; a two-line preview shows both. Pairing a condensed display face with a rounder label face (or vice-versa) gives the broadcast typographic contrast. Leave **Secondary** on **Same as primary** for a single-font look — that's the default (both **Barlow Condensed**). Both choices are saved per profile and travel with [Looks](#looks).

Bundled families ship self-hosted (no external font CDN) with display weights (400–900), so headings and names stay crisp rather than faux-bold.

Changing the **primary** font restyles all display text — here the Win Screen with the default Barlow Condensed, then with Poppins:

![Win Screen — default Barlow Condensed](img/typography-default.jpg)

![Win Screen — primary font set to Poppins](img/typography-primary.jpg)

Setting a different **secondary** font adds hierarchy — display text stays on the primary while labels/meta switch. Here the Player Spotlight keeps condensed names but renders its labels (team, stat labels, role, "signature champion") in a rounder secondary face:

![Player Spotlight — primary display vs secondary label font](img/typography-secondary.jpg)

### Custom fonts (advanced)

Upload your own typeface to use across the overlays:

- Supported formats: **woff2, woff, ttf, otf** (max 4 MB).
- The **name is read from the font file itself** (its built-in family name), so you don't have to retype a tidy name — leave the name box blank unless you want to override it. (WOFF2 is compressed, so those fall back to the filename.) It then appears in the Overlay font list (under **Custom**) and in the live preview.
- **Custom fonts are global** — shared across all profiles, not tied to one. Removing a font reverts any overlay using it to the default.

Under the hood, the chosen families are injected as the `--gfx-font` (primary) and `--gfx-font-2` (secondary) CSS variables. Display text uses `var(--gfx-font, 'Barlow Condensed')`; label/meta text uses `var(--gfx-font-2, var(--gfx-font, 'Barlow Condensed'))` — so an unset secondary falls back to the primary, and an unset primary to the default. Uploaded fonts are registered as `@font-face` rules built from `settings.customFonts` and served from `/uploads/fonts`.

## Shape & surface

The **Shape & Surface** card restyles the panel-based graphics (prizepool, bracket, group stage, tournament structure, player intro) structurally — saved per profile and inside a [Look](#looks):

- **Corners** — **Sharp** (square), **Soft** (the default, lightly rounded), or **Round**. Circular elements (medal coins, role/seed badges) always stay round.
- **Surface** — **Glass** (the default translucent dark panels), **Solid** (opaque), or **Outline** (near-transparent fill with an accent border). The bespoke/dramatic graphics (win screen, draft, spotlight, pre-show, head-to-head) keep their own designed surface.

## Text case

The **Text case** control (Typography card) sets how *all* overlay text reads:

- **UPPERCASE** *(default)* — the standard broadcast look.
- **Normal** — every name and label renders in its source case (e.g. "Aurora Vanguard" rather than "AURORA VANGUARD").

Shape, Surface and Text case are pure CSS-variable overrides with literal fallbacks, so the defaults reproduce the standard design exactly and each choice travels inside a Look.

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

## Logos & image uploads

Wherever you upload an image in the control panel — broadcast/event logos, sponsor logos, team logos, prize-pool and pre-show artwork — the file is **automatically optimised on upload** so output stays light no matter what you drop in:

- **Re-encoded to WebP** (transparency and animated GIF/WebP frames are preserved).
- **Downscaled to fit 1920 px on the long edge** (never upscaled, so small logos stay crisp).

This keeps `uploads/` small and your OBS/vMix browser sources fast — a 7 MB 4000 px PNG typically lands well under 100 KB. Accepted formats are PNG, JPEG, GIF and WebP (SVG is intentionally not accepted); files larger than 16 MB are rejected before processing.

## Looks

A **Look** bundles the palette, accents, background, overlay font, **shape & surface, text case** and full animation config (including per-graphic overrides) into a named, reusable visual identity. Looks are theme-only — applying one never touches teams, schedule or other tournament data, and the logo library is intentionally excluded.

From the **Looks** card (top of Broadcast Theme):

- **Save current as Look** — snapshot the current theme + animation under a name
- **Apply** — replace the current theme/animation with the Look's
- **Update** — overwrite an existing Look with the current settings
- **Rename** / **Delete**
- **Export** / **Import** — download a Look as a portable `.metalook.json` file to carry a visual identity between events or installs, and import one a colleague shared (validated + sanitised on import).

Five example Looks (Broadcast Clean, Neon Surge, Big Impact, Minimal Mono, Soft Rounded) are seeded on first run. Looks are stored in `data/looks.json`; the API lives at `GET/POST /api/looks*` (admin only).
