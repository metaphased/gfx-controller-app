# Live Switcher — OBS / vMix on-air detection

The control panel can connect to your production switcher to show, in the app chrome, **when the broadcast is actually on air** and **which graphics are genuinely live on the program output** — not just which ones you've toggled visible.

Two indicators appear once a switcher is connected:

- **Broadcast status** — a **LIVE** (red, pulsing) / **OFF AIR** pill in the Operator and Control top bars. Shows **NO SIGNAL** if the switcher can't be reached.
- **Per-graphic tags** — a red **PGM** tag on a graphic's ctrl-bar control when its source is actually visible on the program output, and (optionally) a green **PVW** tag when it's in preview.

It's entirely optional — leave the switcher set to **None** and nothing changes.

## Setup

Configure under **Settings → Live Switcher** (admin). Pick **OBS** or **vMix**, fill in the connection details, tick **Enabled**, and click **Save & Connect**. The card shows a live **connection status**.

### OBS

1. In OBS: **Tools → WebSocket Server Settings**.
2. Enable the server, note the **Port** (default `4455`) and **Password**.
3. In MetaGFX: Switcher = **OBS**, enter the OBS machine's **host/IP**, **port**, and **password**.

OBS support uses the [obs-websocket v5](https://github.com/obsproject/obs-websocket) protocol (`obs-websocket-js`). It's event-driven (reacts to scene/source/stream changes instantly) with a periodic resync as a safety net, and reconnects automatically if OBS restarts.

### vMix

1. In vMix: **Settings → Web Controller** — enable it (default port `8088`).
2. In MetaGFX: Switcher = **vMix**, enter the vMix machine's **host/IP** and **port**.

vMix support polls the HTTP API (`http://host:8088/api`) roughly once a second.

## How a switcher source maps to a graphic

The app needs to know which switcher source corresponds to which MetaGFX graphic:

- **OBS — automatic, by URL.** Every MetaGFX graphic is a Browser Source with a known URL (`/graphics/draft/`, `/bus/A`, etc.). The app reads each browser source's URL and matches it — no manual mapping needed. **Bus** sources (`/bus/<id>`) resolve to whichever graphic is currently live on that bus.
- **vMix — by input title (best-effort).** vMix doesn't reliably expose a browser input's URL, so graphics are matched by **input title**. Name your vMix inputs to match the graphic (e.g. `Lower Third`, `Bracket`, `Win Screen`) and they'll be picked up. The **on-air (LIVE) flag is always reliable** regardless of titles.

### What counts as "live on program"

- **OBS:** sources that are **enabled** in the current **program scene** (groups are walked through; a source hidden via its eye icon is not counted).
- **vMix:** the **active input** plus any inputs on **active overlay channels**.

## Preview (PVW) tags

**Show preview (PVW) tags** is an optional checkbox (default **off**). When enabled, graphics in the switcher's preview show a green **PVW** tag.

> **Limitation — per-source PVW.** PVW detection is reliable only in a **scene-switching** workflow, where each look lives in its own scene and you preview/transition between scenes. If you instead composite several sources (e.g. multiple bus sources) inside a **single scene** and toggle their visibility, OBS exposes no per-source preview state through its API, so those sources won't show a PVW tag. **PGM detection is unaffected** and remains reliable. If you don't use scene-based previewing, leave PVW off.

## Notes & limitations

- The switcher connection details (incl. the OBS password) are stored server-side and are **stripped from the state sent to non-admin (operator / token) clients**.
- If the switcher is unreachable the app degrades gracefully: the status flips to disconnected, tags clear, the rest of the app keeps working, and it retries on a reconnect loop.
- vMix per-graphic matching is **best-effort** (title-based); the broadcast on-air flag is always accurate.
- This is a read-only indicator — MetaGFX never changes your switcher; it only reflects its state.

## Read-only by design

This integration only **reflects** the switcher's state — it never drives it, and switcher state never triggers actions in MetaGFX. Graphics control is manual at all times; any automation belongs in OBS/vMix.
