# Control-Surface Theming (UI Appearance)

This covers theming the **control surfaces** — the control panel, operator view, and the surrounding chrome (sidebar, top bars, cards, buttons, tables).

> Not to be confused with [Broadcast Theming](theming.md), which themes the **graphics overlays** (palette, accents, background, animation) that go on air. This page is purely about how the *tool* looks to the people operating it.

## Design direction

The chrome uses a deliberate, broadcast-tool aesthetic: **dark neutrals with a single neutral accent**, **sharp corners**, high-contrast titles, and **saturated colour reserved for live/on-air signals** (PGM/PVW/LIVE tags and active toggles). The UI font is **Inter** throughout (dense numeric/score data uses Barlow Condensed).

## Customising your theme

**Settings → Appearance.** Changes preview instantly and are **saved to your own account** — every user keeps their own look.

| Control | Effect |
|---|---|
| **Preset** | A starting palette: **Graphite** (neutral grey), **Steel** (cool blue accent), **Bronze** (warm). |
| **Accent hue** | Rotates the single accent colour (used for active nav, hover, primary buttons). |
| **Accent saturation** | 0% = pure neutral grey accent; higher = more colour. |
| **Panel lightness** | Lightens/darkens the panel/inset background ramp. |

- **Save** — persists the theme to your account.
- **Reset to default** — loads the panel default (see below); click Save to keep it.
- **Set as panel default** *(superadmin only)* — makes the current settings the **starting theme for everyone**. Individual users can still override it with their own saved theme.

The shipped default is **Graphite**, accent hue 0 / saturation 0% (pure neutral grey), panel lightness 9%.

## How it works

- All chrome colours, contrast levels, radii and signal colours are CSS variables defined once in **`public/shared/tokens.css`** (served at `/shared/tokens.css`). Every surface consumes them, so the whole UI re-themes from one place. Presets are `[data-theme="graphite|steel|bronze"]` blocks; the accent/panel sliders set a few inline variable overrides on top.
- **`public/shared/theme.js`** applies the effective theme on every chrome page, in the `<head>` before paint. It applies a `localStorage`-cached copy first (no flash) then reconciles with the server.
- **Effective theme** resolves most-specific first: **your saved theme → the superadmin panel default → Graphite**.
- Persistence mirrors the per-user keybinds pattern: `POST /api/users/me/theme`; `GET /api/auth/me` returns your `theme` plus the `themeDefault`. The superadmin default lives in `settings.uiTheme`.

### Scope

- **Control panel** and **Operator** view: fully themed and per-user.
- **Caster view** and **Login**: use the baked default palette (no per-user theming — they're output/pre-auth surfaces).

## Live styleguide

A reference page at **`/styleguide/`** (admin) renders every chrome component against the tokens, with preset/slider controls — handy for previewing palette changes against real components before committing to one.

## Related

- Operator layout is also per-user: drag-reorder the operator panels via **Edit Layout** (saved to your account), independent of theming.
