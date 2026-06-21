# Tournament setup

Everything that describes the *event itself* — its name, the teams competing, the structure (groups and/or bracket), roster sizes and broadcast info — lives under **Tournament → Tournament Setup**. Set this up once and every graphic and picker downstream reads from it.

This page also covers the **[Teams Database](#teams-database)** (your reusable team store) and **[Profiles](#profiles)** (saving/swapping whole events).

![Tournament Setup tab](img/tool-tournament-setup.jpg)

## Tournament Info

The first card. Sets the broad identity used across overlays:

![Tournament Info card](img/ts-info.jpg)

- **Tournament Name** — shown on structure/break/pre-show graphics.
- **Game** — League of Legends, VALORANT, CS2 or Generic. LoL unlocks the draft board, champion art and op.gg/Riot features.
- **Tournament Logo** — paste a URL or **Upload**. Used where a tournament mark is shown.

## Sponsor Logos

> **Scope:** sponsor tools are for crediting sponsors who contribute to the **prize pool** of a community/grassroots event — not for selling commercial ad space.

Add sponsor logos here; they appear on the [Pre-show](pre-show.md) and other sponsor-aware graphics. Manage the list with **+ Add Sponsor Logo** (URL or upload).

![Sponsor Logos card](img/ts-sponsors.jpg)

## Competing Teams

The teams playing in **this** tournament — a *pool* drawn from your [Teams Database](#teams-database).

![Competing Teams pool](img/ts-competing.jpg)

- **+ Add Team** lets you pick an existing team from the database or create a new one.
- Only teams in this pool appear in the **Schedule**, **Bracket**, **Groups** and **Game Setup** pickers — so the pickers stay short and relevant.
- Your full Teams Database stays separate and untouched; the pool is just "who's in this event".

## Tournament Structure

Defines how the event is shaped. The card adapts depending on whether you have a group stage.

![Tournament Structure card — group stage + double-elim playoffs](img/ts-structure.jpg)

### Group stage (optional)

Tick **This tournament has a Group Stage** to reveal:

- **Total Teams in Tournament**
- **Number of Groups** — then **Generate Groups →** creates the group shells (populate them in **Tournament → Groups**).
- **Teams advancing per group** — how many qualify into the bracket.
- **Playoff Seeding** — **Manual** (you place teams into bracket slots yourself) or **Seeded (cross-bracket)** (the app cross-seeds group qualifiers).

If there's no group stage, you just set **Total Teams in Tournament** directly.

### Playoff format

- **Single** or **Double Elimination**.
- **Include 3rd / 4th place match** (single-elim option).

### Generating the bracket

1. Click **Preview Bracket Structure** — the app works out the round and match slots from your settings and shows a preview card.
2. Review it, then **Confirm & Apply to Playoffs →**. The rounds appear in **Tournament → Playoffs**, where you assign teams to slots and edit them.

See [Bracket](bracket.md) for the bracket *graphic*, and [Schedule](schedule.md#bracket-linking) for how match results flow back into the bracket automatically.

## Roster

![Roster card](img/ts-roster.jpg)

- **Players per team** — drives the roster editors and structure overlay.
- **Max substitutes per team** — `0` hides the sub count in the structure overlay.

## Broadcast Info

Optional fields shown on the [Tournament Structure](tournament-structure.md) overlay when you toggle them on in that graphic's tab: **Start/End Date**, **Region**, **Patch / Version**, **Tiebreaker Rule**, **Location**.

![Broadcast Info card](img/ts-broadcast.jpg)

## Prizepool

Tick **This tournament has a prizepool** to flag the event as having one. The actual breakdown is entered and displayed via the dedicated [Prizepool](prizepool.md) graphic — this is just the on/off flag.

## Stage Formats

Per-stage default series formats (e.g. groups = Bo1, playoffs = Bo3, finals = Bo5). These pre-fill the **Format** when you build the [Schedule](schedule.md), so you're not setting Bo3/Bo5 on every match by hand.

---

## Teams Database

**Tournament → Teams Database** is your reusable, cross-tournament store of teams and their rosters. The [Competing Teams](#competing-teams) pool pulls from here; editing a team here doesn't disturb other events.

![Teams Database — saved teams, each with logo, tag and roster size](img/ts-teams-table.jpg)

### Creating / editing a team

**+ New Team** (or click an existing team) opens the editor:

![Team editor — name, tag, logo, starting lineup and subs](img/tool-teams-database.jpg)

- **Team Name**, **Tag** (short acronym, max 6 chars), **Logo** (URL or upload — square ~200×200 recommended; overlays show it at ~34px).
- **Players** — one row per roster slot. Per player you can set the handle, **role**, **op.gg region** and **Riot ID** (`Name#TAG`). Riot ID + region power rank lookups and op.gg links; see [Match & draft control](match-and-draft.md#ranks-and-champion-pools).

### Importing teams

![Importing teams — Google Sheets and JSON / CSV file import](img/ts-import.jpg)

Two import paths sit at the bottom of the Teams tab. Both **create or update** teams (matched by name), one **row per player**.

- **Google Sheets** — the sheet must be publicly readable; supply **Sheet ID**, **API Key** and **Range** (default `Sheet1`).
- **JSON / CSV file** — choose a file and **Import**.

**Columns** (headers are case-insensitive; spaces/underscores ignored):

| Column | Required | Notes |
|---|---|---|
| `team` | ✓ | Team name — rows are grouped by it. |
| `handle` | ✓ | Player IGN. (`ign`, `player`, `summoner` also accepted.) |
| `role` | – | Top / Jungle / Mid / Bot / Support (`position`, `lane` accepted). Defaults by row order if blank. |
| `riotId` | – | Riot ID as `Name#TAG` — powers [rank lookups](match-and-draft.md#ranks-and-champion-pools) and op.gg links. |
| `region` | – | op.gg region (e.g. `euw`, `na`, `oce`, `kr`). |
| `name` | – | Player's real name. |
| `country` | – | Country / nationality. |
| `tag` | – | Team acronym (team-level — taken from any of the team's rows). |
| `logo` | – | Team logo URL (team-level). |
| `sub` | – | Truthy (`yes`/`true`/`1`) marks the row as a **substitute**. (A 6th+ starter also rolls into subs.) |

Only `team` + `handle` are required; everything else is optional — a simple `team, handle, role` sheet works fine. The extra columns let you bring in Riot IDs, regions and team branding in one go instead of typing them in the [editor](#creating--editing-a-team) afterwards.

**Example CSV:**

```csv
team,tag,logo,handle,role,riotId,region
Aurora Vanguard,AUR,https://example.com/aur.png,Ardent,Top,Ardent#EUW,euw
Aurora Vanguard,AUR,,Quill,Jungle,Quill#EUW,euw
Crimson Talons,CRT,,Granite,Top,Granite#NA1,na
```

---

## Profiles

**System → Profiles** saves an entire event — tournament info, teams pool, structure, schedule and current state — as a named **profile**, so you can run several tournaments from one install and switch between them. Saved profiles live in `data/profiles.json`.

![Profiles — each saved event with Load / Rename / Delete](img/ts-profiles.jpg)

> Loading a profile resets live state (including the draft) to that profile's saved data, so don't switch profiles mid-match.

## See also

- [Schedule](schedule.md) — lay out the matches once teams and structure exist.
- [Match & draft control](match-and-draft.md) — drive a loaded match live.
- [Theming & Looks](theming.md) — the visual identity, kept separate from the tournament data.
