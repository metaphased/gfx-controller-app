# Caster view

A read-only dashboard for casters and analysts — rosters, the live draft, series history, standings, bracket and schedule — all in one page that updates in real time. It needs no account, just the graphics token, so you can share it with on-air talent who shouldn't touch the controls.

Open at **`/caster?token=XXXX`** (grab the full link from **Settings → Output URLs**).

## Tabs

| Tab | What's there |
|---|---|
| **Roster** | Both teams' players with roles, ranks, Riot IDs and champion pools — with **op.gg** deep links for prep. |
| **Series** | The current series: score, format, per-game results and draft history (incl. the **fearless** champion pool used so far). |
| **Draft** | A live pick/ban board mirroring the [draft](draft.md) as it happens. |
| **Standings** | Group-stage standings. |
| **Bracket** | The playoff bracket. |
| **Schedule** | The broadcast schedule. |

## How to use it

- It's **read-only** — casters can read everything but change nothing, so there's no risk of them altering the broadcast.
- It updates **live** over the same WebSocket state as everything else, so the draft board, scores and standings move in real time during the show.
- Share the `/caster?token=XXXX` link (and nothing else) with talent — the token grants caster + graphics read access but not the control panel.

## Notes

- Ranks and champion pools come from the [Riot API and op.gg](match-and-draft.md#ranks-and-champion-pools); refresh them from the control panel so casters see current data.
- For driving graphics, that's the [operator view](operator-and-multiuser.md); the caster view is purely for reading.
