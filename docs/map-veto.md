# Map Veto

The CS2 map-veto pre-game scene — the map-veto counterpart to the [Draft Overlay](draft.md) for League. It presents the ban/pick sequence for a series as a broadcast graphic: each pool map shown as a card, marked as a **ban**, a **pick** (with the picking team's starting side), or the **decider**. Output at `/graphics/map-veto/`.

It appears for games whose pre-game is a map veto (CS2). The pool, the veto order and the overlay's look are driven from two control tabs: **Game → Map Veto** (the sequence) and **Graphics → Map Veto** (the on-air look).

## Map pool

The maps come from the tournament's active-duty pool, set under **[Tournament Setup](tournament-setup.md) → Map Pool**:

- Edit the pool (names + order); **Load default pool** seeds the current active-duty set, and **Set as default** saves the current pool as the default for this game.
- Each map can take an optional **Image URL** (card background) and **Video URL** (used by the accordion view). Leave them blank and art is auto-resolved from each map's `de_*` slug.
- **Refresh map images** (on the overlay tab) re-downloads and rebuilds the map art if it's outdated or broken.

## Veto sequence (Game → Map Veto)

- **Bans First** — pick which team starts the veto. The other team follows in the official order. Each map is used once; changing the first-ban team clears the veto.
- **Veto Sequence** — one row per pool map. Each row sets the action — **ban**, **pick**, or **decider** — and, for a pick, the picking team's starting side (CT / T); the decider is the **knife round**.
- The sequence length follows the match **Best-of** and the pool, so a Bo3 reads bans → picks → decider as expected.

Per-map **round scores & winners** are entered separately, in **Game Setup → Series Tracker**, as the series plays out (see [Match & draft control](match-and-draft.md)). Those feed the [Break Screen](break-screen.md) and [Win Screen](win-screen.md).

## Overlay look (Graphics → Map Veto)

From the Map Veto Overlay ctrl-bar:

- **Show / hide** the overlay.
- **Title** — the heading above the maps (e.g. "MAP VETO").
- **Scale** — **Large**, **Normal**, or **Lower Third** (a bottom-anchored compact band that leaves the upper frame free for cameras). Scales can also be cycled live from the Operator view / live bar.
- **Show team names** — off shows team logos only (where a team has a logo).
- **Use official map icons instead of map names** — swap the map's text label for its icon.
- **Logo** — show/hide a centre event logo, with URL (or upload), scale and position.

## Accordion view

An optional full-screen horizontal focus view for walking through the veto live:

- The **focused** map expands and plays its clip (or shows its image) in full colour; the rest compress and desaturate — **bans go greyscale**, picks/decider stay low-saturation.
- **Reveal-draft** — maps to the right of the focused one stay hidden until you bring them in: **Reveal ▶** advances one map, **◀ Prev** moves focus among revealed maps, **⟲ Restart** hides them all again, and **Full draft view** shows the whole board at once.
- **Auto reveal** — steps through each map at a set pace (seconds per map), then settles on the full-draft view. It runs server-side, so every output stays in sync and it survives a page reload; any manual reveal/focus cancels it.
- **Animate map images (flyby)** — when a map is focused, crossfade through its image set every few seconds (a moving fallback when no per-map video is set).

## Driving it live

Beyond the Graphics tab, the scale cycle and the accordion reveal/full-draft/auto controls are also exposed on the **Operator view** and the admin **live bar**, so you can run the veto without leaving your live layout.

## Notes

- The overlay is transparent — add it as a browser source over your scene like any other graphic.
- Per-map **video** clips are optional; without them the accordion uses the map image (with a slow Ken Burns zoom) as the moving element.
- For automatically filling map/series scores from a live CS2 feed, see [Live Data](live-data.md).
