# Win Screen

Celebrate a game or series result with a winner reveal. Ten styles — from quick on-scene reveals to full-screen **stingers** that double as scene transitions, plus a **COMP** screen showing the winning draft (champions on LoL, heroes on Dota 2). Driven from **Graphics → Win Screen**, output at `/graphics/win-screen/`.

![Win Screen — COMP style](img/win-screen-comp.webp)

## Choosing the winner

![Win Screen control bar — winner picker](img/ws-controls.jpg)

In the control bar pick the **winning team**; the control tab below sets the **message** (e.g. "WINS THE MATCH"), the **series score**, the **accent colour** (follows the team side by default, or custom/primary) and — for COMP — the winning-draft options.

![Win Screen control tab — message, accent, draft picks and the style picker](img/tool-win-screen.jpg)

## Styles

**Reveals** — animate in over your scene:

| Style | Feel |
|---|---|
| **Blade** | Diagonal band sweeps across. Fast and punchy. |
| **Burst** | Detonates from centre with shockwave rings. |
| **Slam** | Full-screen overlay — most coverage, great for a clean cut. |
| **Split** | Team colour floods one half, sharp centre divider. |
| **Spotlight** | Screen darkens, a light beam crowns the winner with sparkles. |
| **Wipe** | Cinematic letterbox bars close in, name slices through with a light streak. |

<table>
<tr>
<td width="50%"><img src="img/win-screen-blade.webp" alt="Win Screen — Blade reveal"><br><sub><b>Blade</b> — diagonal band reveal</sub></td>
<td width="50%"><img src="img/win-screen-split.webp" alt="Win Screen — Split reveal"><br><sub><b>Split</b> — team colour floods one half</sub></td>
</tr>
</table>

**Stingers** — fully opaque, made to cover a scene transition (show it, cut your scene behind it, hide it):

| Style | Feel |
|---|---|
| **Shutter** | Opaque panels drive in from top & bottom; winner snaps in on the seam. |
| **Flood** | A solid colour floods the frame on an angled wipe. |
| **Push Slab** | A full-screen slab pushes up from the bottom, holds, then pushes off. |

<table>
<tr>
<td width="50%"><img src="img/win-screen-shutter.webp" alt="Win Screen — Shutter stinger"><br><sub><b>Shutter</b> — panels meet on a seam</sub></td>
<td width="50%"><img src="img/win-screen-flood.webp" alt="Win Screen — Flood stinger"><br><sub><b>Flood</b> — solid colour wipe</sub></td>
</tr>
</table>

**League of Legends:**

- **COMP** — a full-screen showcase of the **winning team's champion picks and players** (pictured above). Needs a recorded game in the series so the picks are known. Options let you toggle the picks, choose their position, and pick the portrait shape and background treatment.

**Dota 2:** the winning-picks row shows the winner's five **drafted heroes** from the current [hero draft](hero-draft.md) — landscape hero art labelled by hero name.

## Notes

- The **stingers** are designed as transitions: because they fully cover the frame, you can switch scenes in OBS/vMix while the stinger is up. See the Companion/Stream Deck integration for triggering them on a button.
- **COMP** reads the winning side's picks from the draft/series — run or commit the [draft](match-and-draft.md#draft) so they're populated, and sync [champion art](champion-assets.md).
- Series score and team data come from the [Game Setup](match-and-draft.md#game-setup) series tracker.
