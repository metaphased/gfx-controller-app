# Post-Map Data (VALORANT) — BETA

Pulls each finished map's match record — final score, winner, and every player's **agent, K/D/A and ACS** — as a one-click suggestion, plus per-player **agent pools** for the caster view. It feeds the [Post-Game Scoreboard](post-game.md), the Series Tracker, and auto-fills roster agents so the [Player Intro layouts](player-intro.md) and [Win Screen](win-screen.md) are correct without manual entry.

> ⚠️ **Reliability disclaimer — read this first.** Match data comes from the **[HenrikDev API](https://docs.henrikdev.xyz/)**, an **unofficial community service** that is not affiliated with or endorsed by Riot Games. MetaGFX cannot guarantee its availability, accuracy, or continued operation — it may rate-limit, change, or stop working at any time, including mid-event. Treat it as a convenience, not a dependency: **everything it fills in can also be entered manually** (scores in Game Setup → Series Tracker, agents on the roster), so a broadcast never breaks if the API is down. Riot's official API does not expose VALORANT match data to standard keys, which is why this integration exists at all.

Like CS2's live data, this is **data-only**: fetches land as suggestions the operator reviews and applies — nothing airs automatically.

## What it feeds

| Surface | What it gets |
|---|---|
| [Post-Game Scoreboard](post-game.md) | Per-player agent (icon + name), K/D/A, +/-, ACS, K/D — sorted by ACS. |
| Series Tracker (Game Setup) | The map's final score, winner, and `final` status. |
| Roster agents | Each player's agent for the played map — so the [Player Intro](player-intro.md) layouts and the [Win Screen agent showcase](win-screen.md) are correct with zero typing. |
| [Caster view](caster-view.md) roster | Each player's most-played agents with win rates (agent pools). |

## Setup

Two keys in your `.env`, then restart the server:

```
RIOT_API_KEY=your_riot_key            # official — Riot ID validation (also used for LoL ranks)
HENRIKDEV_API_KEY=HDEV-xxxxxxxx-...   # unofficial — match data & agent pools
```

- **`RIOT_API_KEY`** — your standard Riot developer key ([developer.riotgames.com](https://developer.riotgames.com)). Only the global Account service is used; no VALORANT-specific access is required.
- **`HENRIKDEV_API_KEY`** — a free **Basic** key, issued instantly via the [HenrikDev Discord](https://docs.henrikdev.xyz/) (see their docs for the invite). The Basic tier's 30 requests/minute cap is far above what MetaGFX sends (see [Request budget](#request-budget)).

## Workflow

1. **Validate Riot IDs** — Players page → **✓ Validate Riot IDs**. Checks every roster `Name#TAG` against the official Riot API, flags typos, and stores each player's PUUID (the key that matches roster players to match data). Re-run after any roster change.
2. **Set the region** — Game Setup → **Post-Map Data** card → Region (EU / NA / AP / KR / BR / LATAM). This is the *event's* VALORANT region; the fetch fails with the wrong one.
3. **After a map finishes** → **⟳ Fetch latest map**. One request pulls the most recent **custom game** containing your roster.
4. **Review the suggestion** — map, score, winner, both teams' stat lines, and a **"N roster players matched"** count. A full tournament lobby matches 10; a low count means stand-ins or the wrong match — check before applying.
5. **Apply** to the right Series Tracker slot (it pre-selects the first unfinished map). This writes the score/winner, fills all roster agents, and stores the scoreboard stats. Re-fetching and re-applying updates rather than duplicates.
6. **Confirm before air** — the Post-Game tab's *Confirm data* panel shows exactly what the scoreboard will render.
7. *(Optional, prep time)* **Refresh Agent Pools** — Players page — for the caster view's most-played-agents tables.

## Request budget

All traffic is operator-click-triggered — MetaGFX never polls. Per action: validation ≈ 1 request per roster player (official API); fetch = **1 request**; apply = 0; pools ≈ 1 per player. A full Bo3 with pools prep is ~25 requests spread over hours, against a 30/**minute** cap.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| *"No roster PUUIDs"* | Run **Validate Riot IDs** first. |
| *"No recent custom match found"* | Wrong **region**; or the lobby wasn't a **custom game**; or the first validated roster player wasn't in it. |
| Low *"roster players matched"* count | Stand-ins, or an older scrim was matched — verify the map/score before applying. |
| *"rate limited"* | Wait a minute and retry (only realistic if buttons are mashed repeatedly). |
| HenrikDev HTTP 5xx / fetch failed | The community API is down or changed — **fall back to manual entry**; the show goes on. |

## Notes

- Only **custom games** are searched — the tournament/scrim case. It will not match ranked queues.
- The Riot ID validation half works without a HenrikDev key at all, and is worth running for roster hygiene regardless.
- Feature status: **BETA** until it has been exercised across real events.
