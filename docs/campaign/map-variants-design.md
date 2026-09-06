# Map variants — one ground per mission, not one ground per town

**Status:** design, for the lead. Written 2026-09-06 against `feat/story-act-1`.
**Owner downstream:** `mission-author` (the JSON), `level-scripter` (waves and
triggers on the new gates), `playtest` (the re-runs).
**Contract:** `docs/campaign/README.md`. **Story:** `docs/campaign/storyline.md`.

The lead's direction, verbatim (2026-09-06):

> "The map is the same in all levels in Tel Marum — need to diversify the map
> between the levels. This is true for all other maps as well. It should be more
> diverse and with more obstacles for the units so they won't always go straight
> line."

This document says what to author, in what order, and how to prove it. Every
mechanical claim cites a file. Every route number was **measured this session**
through the real `FlowField` on the real map data, using the same helper
`tools/src/tel_marum_doctrine.test.ts` uses (`route()`, lines 195–213); estimates
are labelled as estimates.

---

## 0. The complaint, as a number

The lead's "straight line" is measurable: walk the flow field from a mission's
`player_start` to its objective and count direction changes.

Measured 2026-09-06, `FlowField.compute` with the real `blocked` / `blockedVehicle`
masks and the real elevation grid:

| map | leg | foot | veh | direction changes |
|---|---|---|---|---|
| `beit_sahwan_outskirts` | `kdf_assembly` [4,23] → `town_center` [31,22] | 27 | 27 | **1** |
| `beit_sahwan_outskirts` | [4,23] → `bs_hvt_atgm` [38,22] | 34 | 34 | **1** |
| `beit_sahwan_outskirts` | BS-IV start [26,34] → `shaft_head` [26,13] | 21 | 21 | **0** |
| `wadi_halam_basin` | `kdf_crossing` [3,24] → `village_center` [29,26] | 26 | 26 | **1** |
| `wadi_halam_basin` | [3,24] → `pump_house` [17,20] | 14 | 14 | **1** |
| `tel_marum` | `start_line` [24,44] → `battery_position` [25,6] | 38 | 38 | 3 — and **26 of the 38 steps are one column** |
| `marj_perimeter` | `raid_n` [24,2] → `compound_centre` [24,23] | 27 | 27 | 5 |
| `umm_zeitoun` | `kdf_start` [24,45] → `hamlet_square` [24,26] | 19 | **23** | foot 0, **veh 5** |
| `umm_zeitoun` | [24,45] → `stockpile_yard` [32,7] | 38 | 38 | foot 7, veh 9 |
| `umm_zeitoun` | [24,45] → `horn_west` [10,23] | 22 | **no route** | — |

Open-tile census of the same five maps (`.` as a fraction of 2,304):

| map | open `.` | symbols authored |
|---|---|---|
| `marj_perimeter` | 2,080 (90%) | `. 1 2 = r o n h s w m #` |
| `beit_sahwan_outskirts` | 1,855 (80%) | `. 1 2 r o n h a w m s` |
| `wadi_halam_basin` | 1,813 (79%) | `. 1 o n r h = w m s #` |
| `tel_marum` | 1,534 (66%, but 748 of the rest is the flanking `^`) | `. ^ b #` |
| `umm_zeitoun` | 1,396 (61%) | `. 1 2 ^ n b d r o h s w #` — **all ten terrain symbols** |

Three readings fall out of this table and they set the whole design:

1. **`umm_zeitoun` is already the answer.** It is the only shipped map where foot
   and vehicles take *different* routes to the same objective (19/0 turns vs 23/5
   turns) and the only one with an objective armour cannot reach at all
   (`horn_west`). It got there with `b`, `d` and relief and no engine work.
2. **`tel_marum` is the worst offender and the lead named it correctly.** Its
   whole terrain budget went into the wall across the middle; the 30×36 valley
   floor south of it is 1,000 tiles of nothing, and the march up it is one column.
3. **The problem is not "too few obstacles", it is "obstacles off the axis".**
   Beit Sahwan has 449 non-open tiles and still routes in one turn, because every
   one of them is beside the road rather than on it.

---

## 1. Approach

### Option A — a variant map file per mission (**recommended**)

`data/maps/<town>_<n>.json`, e.g. `tel_marum_2.json` with `"id": "tel_marum_2"`,
each derived from the town base: the same 48×48 frame, the same landmarks, the
same markers and zones, with obstacles added and routes bent. The mission points
at it (`"map": { "file": "tel_marum_2" }`) and nothing else changes.

**Why it works with the tree as it stands:**

- `mission.map.file` is a **free string** — `data/schemas/mission.schema.json`
  declares it `{"type": "string"}` with no enum, and `tools/validate_data.mjs`
  (lines 150–190) resolves it by *scanning `data/maps/`*, not against a list.
- The pinned doctrine tests keep meaning what they say.
  `tools/src/tel_marum_doctrine.test.ts` (27 assertions) and
  `tools/src/umm_zeitoun_doctrine.test.ts` (45) both read `maps.tel_marum` /
  `maps.umm_zeitoun` **by name**. Leave the base files alone and not one
  assertion moves.
- The visual gate needs no bless. Its four gated scenarios name
  `beit_sahwan_outskirts` (×2), `tutorial_ground` and `tel_marum`
  (`tools/src/golden-diff/capture-protocol.ts:282, 379, 421, 518`) — base ids.
  A new file is invisible to it. (One caveat in §5.)
- A whole 48×48 grid is the artefact an author can actually read. The map format
  exists to be sketched in a text editor (`map.schema.json`'s own `rows`
  description); a 48-line grid you can eyeball beats a patch list you cannot.
- The sandbox walks it for free: `?sandbox=tel_marum_2` works the moment the file
  is registered, with the full task force placed from the variant's own markers.

**Its one real cost is drift** — five copies of Beit Sahwan means a landmark
fixed in one is stale in four. §4 turns that into a checked invariant rather
than a hope: a per-town **shared-landmark test** asserting every variant agrees
with the base on the tiles the story requires be the same place, and carries the
base's markers and zones with identical coordinates.

### Option B — a per-mission terrain overlay in the mission schema

`map.overlay: [{ "at": [x,y], "rows": ["...", "..."] }]`, applied to the base
grid before `parseMap`.

**Why not:**

- It is a schema change *plus* a loader change in every consumer. `parseMap` takes
  a `MapJson` and `applyTerrain(map, sim)` takes the parsed result; the overlay
  would have to be applied before parse, which means `packages/app/src/main.ts`,
  `tools/src/backtest/playtest.ts`, `tools/src/walk_mission.ts`, `walk_world.ts`,
  the doctrine tests, the sandbox and the visual-gate harness each learn about it
  — or a new shared `mapForMission()` is introduced and all of them move onto it.
  `applyTerrain`'s own header records what happens when one idea lives in three
  places: *"Three copies of one idea is how tunnel registration went missing from
  playtest.ts: the harness died at Beit Sahwan II for two days with every test
  green."*
- **The sandbox could never show a variant.** `?sandbox=<map id>` has no mission,
  so an overlay carried by a mission is unreachable from it — and walking new
  ground in the sandbox is how Tel Marum's terrain was checked in the first place
  (CLAUDE.md, "Dev instruments").
- **It makes the pinned base tests describe ground nobody stands on.**
  `tel_marum_doctrine.test.ts` measures `maps.tel_marum`; under Option B that is
  a base every mission overwrites, so 27 assertions would still pass and no
  longer describe a battlefield.

### Option C — edit the base maps in place

Rejected outright: it breaks 72 pinned assertions across two doctrine tests,
forces a visual-gate bless on `tel_marum` and `beit_sahwan_outskirts`, and after
all that still delivers **one ground per town**, which is the thing being fixed.

### Recommendation

**Option A**, with the shared-landmark test as its price of admission. It is
zero engine work, zero schema work, zero bless, and the guard against its one
weakness is thirty lines of vitest.

---

## 2. The obstacle grammar

### 2.1 What each symbol buys

From `packages/data/src/map.ts` `TERRAIN_LEGEND` (lines 207–240) and
`data/structures.json`. "Sight" is `losRay`, which is tile-Bresenham over
`blocked` with no observer-type parameter (`packages/sim/src/sim.ts`).

| sym | stops foot | stops wheels/tracks | stops air | blocks sight | cover | HP | ROE penalty | decor family |
|---|---|---|---|---|---|---|---|---|
| `.` | – | – | – | – | 0 | – | – | `grass`/`sand` |
| `1` | – | – | – | – | 1 | – | – | `bush` |
| `2` | – | – | – | – | 2 | – | – | `bush` |
| `3` | – | – | – | – | 3 | – | – | `bush` |
| `r` road | – | – | – | – | 0 | – | – | none (albedo only) |
| `o` grove | – | – | – | – | 1 | – | – | `tree` |
| `n` knoll | – | – | – | – | 2 | – | – | `rock` |
| `^` ridge | **yes** | **yes** | **yes** | **yes** | 0 | none | none | `slab` |
| `b` boulder | – | **yes** | – | – | 0 | none | none | `boulder` |
| `d` ditch | – | **yes** | – | – | 0 | none | none | `ditch` |
| `s` shanty | **yes** | **yes** | **yes** | yes | rubble 1 | 120/tile | 2 | building mesh |
| `h` house | **yes** | **yes** | **yes** | yes | rubble 2 | 260/tile | 6 | building mesh |
| `w` warehouse | **yes** | **yes** | **yes** | yes | rubble 1 | 340/tile | 3 | building mesh |
| `a` apartment | **yes** | **yes** | **yes** | yes | rubble 2 | 520/tile | 14 | building mesh |
| `#` concrete | **yes** | **yes** | **yes** | yes | rubble 2 | 700/tile | 3 | building mesh |
| `m` mosque | **yes** | **yes** | **yes** | yes | rubble 2 | 900/tile | **30** | building mesh |
| `=` wall | **yes** | **yes** | **yes** | **no** (`low_profile`) | standing 2 | 200/tile | **0** | building mesh |
| `c` camp | **yes** | **yes** | **yes** | yes | rubble 2 | 300/tile | 0 | building mesh |
| elevation 0–9 | – | – | – | see below | – | – | – | – |

Five facts about this table that an author will otherwise get wrong, each one
either cited or measured:

- **`^` stops the drone.** `moveDomain` is `!isAir && wheeled ? DOMAIN_VEHICLE :
  DOMAIN_FOOT` (`packages/sim/src/sim.ts:488`), so an air unit walks the **foot**
  flow field — it ignores unit clipping (`sim.ts:4747`) and `b`/`d`, and it is
  stopped and blinded by `^` and by buildings exactly like a rifleman. The
  2026-08-22 rock-terrain design took that decision on purpose: *"Rock blocks air
  as well as ground… Decided: keep it that way."* **Never put `^` across a recon
  drone's only line.**
- **`b` and `d` are mechanically identical to the byte** — same vehicle-only
  mask, no cover, no sight-block, no HP, not destructible. They differ only in
  what the renderer draws (`map.ts`'s legend comment). Use `b` for natural stone,
  `d` for something dug. That is a fiction choice, not a mechanical one.
- **`=` is the only obstacle with no ROE cost.** `roe_penalty: 0`,
  `low_profile: true`, 200 hp a tile, `standing_cover: 2`. It stops both domains,
  does not block sight, is breachable, and shooting it is free. It is the right
  tool for "an edge the player must respect but may destroy".
- **Cover changes no route at all.** Measured: a 17×11 blanket of `n` (cover 2)
  laid across Tel Marum's valley floor left the route at 20 tiles and one column.
  `FlowField.compute` costs ground and slope only. **Cover shapes the fight, not
  the march.** (`COVER_HIT` = 1 / .375 / .1375 / .09, `tuning.ts:49`; the big rung
  is 0→1.)
- **Elevation is a weak router and a cheap shape tool** — §2.2.

### 2.2 The arithmetic of bending a route

`COST_ORTH = 10`, `COST_DIAG = 14` (`packages/sim/src/flowfield.ts:21–22`),
`UPHILL_PER_LEVEL = 10` (`packages/sim/src/tuning.ts:188`). So:

- **one level of climb costs one tile of ground**, and descent is free;
- **one tile of lateral shift, taken diagonally inside a leg that is already
  travelling that way, costs 4** — not 10. A detour that stays inside the
  existing leg is nearly free.

Both matter. Measured 2026-09-06 on `tel_marum`, goal `approach` [24,24], start
`start_line` [24,44], a three-row ridge laid across the floor at y=34–36 with a
three-tile saddle placed `k` tiles east of the axis:

| crest | k=3 | k=5 | k=8 | k=12 |
|---|---|---|---|---|
| 2 | straight | straight | straight | straight |
| 3 | **took the saddle** | straight | straight | straight |
| 4 | **saddle** | **saddle** | straight | straight |
| 6 | **saddle** | **saddle** | straight | straight |
| 9 | **saddle** | **saddle** | **saddle** | straight |

**The route was 20 tiles long in every one of the twenty runs.** The saddle
detour costs *nothing in tiles* — it is absorbed by diagonals inside the
north–south leg — and the shape changes completely (1 column → 4, 6 or 9).

The rule, derived and matching every cell above: a saddle `k` tiles off the axis
is taken when `10·h > 8·k`, i.e. **crest > 0.8 × offset**. A 2-level rise never
reorders anything; a 3-level rise reorders a saddle 3 tiles away and nothing
further.

Two corollaries an author needs before reaching for hills:

- **A ridge with a distant saddle does nothing.** Measured: crest 3 across
  x=6–33 with the only gap at x=34–41 gave foot 20 tiles, **one column** — the
  route walked straight over the ridge. This is CLAUDE.md's "a climb telescopes"
  reproduced on a second map.
- **A bowl prices ground and reorders nothing.** Measured: an 17×11 depression at
  level 3 on the same axis gave 20 tiles, one column — the Qarn Hadid negative,
  reproduced.

Elevation's real jobs are therefore **shape at zero tile cost** and **dead
ground**: `BLOCK_RISE = 2`, `EYE_HEIGHT = 1` (`sim.ts:703, 717`), so a lip needs
**two levels or more** to hide ground troops and a one-level rise hides nothing
(the Tel Marum map design calls this "the single easiest way to author this map
wrong").

### 2.3 What each tool costs, measured

All on `tel_marum`, `start_line` → `approach`, base = 20 tiles / 1 column:

| device | foot | vehicle | shape (distinct columns, veh) |
|---|---|---|---|
| base | 20 | 20 | 1 |
| `d` belt across the floor, crossings 10 tiles off-axis | 20 | 23 | **11** |
| `b`/`d` belt, crossings 4–6 tiles off-axis (TM-2 draft) | 20 | 20 | **5** |
| stream bed + groves + knolls (TM-1 draft) | 20 | 20 | **7** |
| elevation saddle 3 tiles off-axis, crest 3–4 | 20 | 20 | 4 |
| a row of `h` houses across the axis, one gap | **22** | **22** | **7** |
| interlocking `^` spurs, alternating gaps | **32** | **32** | **14** |

Three settings fall out of it, and §6 asks the lead to pick one:

- **light** — `b`/`d` with crossings near the axis, groves, knolls, a saddle.
  Route length unchanged; shape 1 → 5–7 columns; foot untouched.
- **medium** — the same plus a built line or a wall run with gaps. +1 to +4 tiles;
  shape → 7–9 columns; **foot bends too**.
- **heavy** — interlocking `^` spurs. +12 tiles (a 60% longer march); shape → 14
  columns. Reserve for ground a briefing already promises is hard.

### 2.4 The five rules for bending without sealing

1. **Every objective stays reachable by both domains unless the mission means to
   split them.** Where it does mean to (Tel Marum III's corridor, Umm Zeitoun
   III's western horn), the briefing must already say so.
2. **At least two routes to every primary**, and they must not share a
   chokepoint. The test form: block the best route's narrowest tile and re-run
   the field; a finite route must remain.
3. **Price a detour in tiles, never in deaths.** A detour that runs through a
   killing area is a fake choice; the Tel Marum saddle measurement is the
   evidence (through the pass 1.20 losses a run, up the corridor 0.30, same
   3.54-minute clock — CLAUDE.md).
4. **Never lengthen a civilian's line to its refuge.** `CivilianFlight.step`
   (`packages/sim/src/civilians.ts`) breaks a civilian for the refuge on
   suppression > 0.3 (`CIV_FLEE_AT`) or a soldier inside 4 tiles
   (`SHEPHERD_RADIUS_SQ`), then walks them there on the **foot** field against an
   `evacuate_before` deadline. `b` and `d` are free for foot, so they are safe by
   construction; **`^` and buildings are not**. Every variant with civilians must
   measure that route.
5. **Measure before it ships.** Every number in this document came from
   `FlowField.compute` on real map data. Nothing about a 48×48 grid is obvious by
   eye — the base Tel Marum wall's sight facts were "drawn wrong by eye first"
   (`tel_marum_doctrine.test.ts`), and drafting TM-3 for this document put a
   boulder tile under a civilian spawn (§3.1) that no amount of reading would
   have caught.

---

## 3. Per town, per mission

**The invariant across every variant:** the `markers` and `zones` blocks are
**copied whole from the base**, coordinates unchanged. A variant is the same
story ground on a different day, not a different place. New markers may be
*added* (for `level-scripter` to hang waves on); none may move or disappear.
`tunnels` blocks are copied byte-identical, because `collapse` objectives resolve
routes by zone.

### Ladder

| # | mission | phase | map today | variant | economy | changes |
|---|---|---|---|---|---|---|
| — | `beit_sahwan_0_tutorial` | recon | `tutorial_ground` | **none** | n | out of scope; it is in the visual gate |
| 1 | `beit_sahwan_breach` | breach | `marj_perimeter` | **none** (option in §6) | n | — |
| 2 | `beit_sahwan_1_recon` | recon | `beit_sahwan_outskirts` | **none** | n | recon learns the town as it is |
| 3 | `beit_sahwan_2_foothold` | foothold | `beit_sahwan_outskirts` | `beit_sahwan_2` | n | field walls + grove belt on the west approach |
| 4 | `beit_sahwan_3_clearance` | clearance | `beit_sahwan_outskirts` | `beit_sahwan_3` | n | street barricades; a physical edge on the clinic block |
| 5 | `beit_sahwan_4_subterranean` | subterranean | `beit_sahwan_outskirts` | `beit_sahwan_4` | n | the town after III: rubble, one road down |
| 6 | `tel_marum_1_recon` | recon | `tel_marum` | `tel_marum_1` | n | the herders' floor: stream bed, groves, knolls, a pen |
| 7 | `tel_marum_2_foothold` | foothold | `tel_marum` | `tel_marum_2` | n | the Sarim's earthworks: a ditch with two crossings |
| 8 | `tel_marum_3_clearance` | clearance | `tel_marum` | `tel_marum_3` | n | the churned pass: craters, blast aprons, a revetment |
| 9 | `umm_zeitoun_1_recon` | recon | `umm_zeitoun` | **none** | n | "crossable anywhere on its width" is the briefing |
| 10 | `umm_zeitoun_2_buildup` | buildup | `umm_zeitoun` | **none** | n | as above |
| 11 | `umm_zeitoun_3_clearance` | clearance | `umm_zeitoun` | `umm_zeitoun_3` | n | courtyard walls + orchard between hamlet and horns |
| 12 | `umm_zeitoun_4_clearance` | clearance | `umm_zeitoun` | `umm_zeitoun_4` | n | spoil round the stockpile; a cut across the north track |
| 13 | `wadi_halam_1_fords` | recon | `wadi_halam_basin` | **none** | n | the fords are the lesson |
| 14 | `wadi_halam_2_laager` | foothold | `wadi_halam_basin` | `wadi_halam_2` | n | **the terraces the briefing already claims** — first elevation grid |
| 15 | `wadi_halam_3_counterraid` | buildup | `wadi_halam_basin` | `wadi_halam_3` | n | gallery fingers; a cut across the east track |
| 16 | `wadi_halam_4_village` | clearance | `wadi_halam_basin` | `wadi_halam_4` | n | courtyard walls; a forecourt on the mosque block |
| 17 | `wadi_halam_5_depot` | clearance | `wadi_halam_basin` | `wadi_halam_5` | n | spoil either side of the last leg into the gate — light, **author last** |

Thirteen variants. No mission's phase, `target_minutes`, objectives, ledger or
economy changes; this is terrain only.

---

### 3.1 Tel Marum — the town the lead named

Base geography, for reference. `^` flanks at x=0–5 and x=42–47. A rock wall
across rows 12–17 with exactly two gaps: the **boulder corridor** at x=10–11
(foot 8 tiles across, vehicles 28 the long way round — pinned) and the **wide
pass** at x=22–26, widening into a bay at x=19–29 on rows 15–17. North of it a
plateau at elevation 1 with the `###` town block at x=24–26, y=3–4 and the Grad
at [25,6]. South of it 30×36 of open valley floor, with one 3-tile `^` outcrop at
x=23–25, y=20–21 and a two-level bench at x=18–30, y=25–26 (the lip that makes
the hollow dead ground).

**All three variants leave rows 12–17 and the flanking `^` untouched.** That wall
is the town's whole doctrine, it is what 27 pinned assertions are about, and it
is what the `relief` visual-gate scenario photographs.

---

#### `tel_marum_1` — *The Herders' Floor* (mission 6, `tel_marum_1_recon`, recon)

**Fiction.** Night. The floor is grazing ground before it is a battlefield — the
mission already places three herders on it at [21,24] and orders them off before
the battery finds the range. Give the ground the reason they are standing on it:
a stony seasonal watercourse, olive on the flanks, a stock pen by the west wall.
Nothing north of y=20 changes, because mission I's entire job is to *discover*
the wall and the four positions on it, and every sight fact there is pinned.

**Changed sector** (rows 20–43; the wall, bay and plateau are byte-identical):

```
     012345678901234567890123456789012345678901234567
 20  ^^^^^^.................^^^................^^^^^^
 21  ^^^^^^.................^^^.......ooooo....^^^^^^
 22  ^^^^^^...........................ooooo....^^^^^^
 23  ^^^^^^...........................ooooo....^^^^^^
 24  ^^^^^^..ooooo....................ooooo....^^^^^^
 25  ^^^^^^..ooooo.............................^^^^^^
 26  ^^^^^^..ooooo.............................^^^^^^
 27  ^^^^^^..ooooo.ss..........................^^^^^^
 28  ^^^^^^........ss..........................^^^^^^
 29  ^^^^^^....................................^^^^^^
 30  ^^^^^^....................................^^^^^^
 31  ^^^^^^............nnn.....................^^^^^^
 32  ^^^^^^............nnn.....................^^^^^^
 33  ^^^^^^............nnn.....................^^^^^^
 34  ^^^^^^bbbbbb...bbbbbbbbbbbbbbb...bbbbbbbbb^^^^^^
 35  ^^^^^^bbbbbb...bbbbbbbbbbbbbbb...bbbbbbbbb^^^^^^
 36  ^^^^^^.......................nnn..........^^^^^^
 37  ^^^^^^.......................nnn..........^^^^^^
 38  ^^^^^^.......................nnn..........^^^^^^
 39  ^^^^^^........ooooo.......................^^^^^^
 40  ^^^^^^........ooooo.......................^^^^^^
 41  ^^^^^^........ooooo.......................^^^^^^
 42  ^^^^^^........ooooo.......................^^^^^^
 43  ^^^^^^....................................^^^^^^
```

- stony bed `b`, y=34–35, x=6–11 / 15–29 / 33–41 — **two fords**, x=12–14 (west)
  and x=30–32 (east)
- olive `o` (cover 1): (8–12, 24–27), (33–37, 21–24), (14–18, 39–42)
- knolls `n` (cover 2): (18–20, 31–33), (29–31, 36–38)
- stock pen `s` 2×2 at (14–15, 27–28) — a `shanty`, 120 hp/tile, ROE penalty 2

**Routes forced** (measured, not estimated): foot and the drone are unchanged
everywhere — `b` is free to boots and to air. The **screen** changes: vehicle
`start_line` → `hollow` goes 15 → **17 tiles**, and its shape goes from **1
column to 7**; `start_line` → `approach` stays 20 tiles at **7 columns**. The
herders' own foot route [21,24] → `muster_ground` is **20 tiles, unchanged** —
rule 4 satisfied by construction.

**The decision.** The base mission's screen has nowhere to be; the variant makes
it choose a ford, and the fords are 18 tiles apart. The 150 s wave to `hollow`
and the 260 s wave to `start_line` both come from `town_edge`, so the ford the
player parks behind decides whether the waves arrive on the screen's front or its
flank. The drone's freedom to ignore all of it is now visible rather than
incidental — which is the recon phase's own lesson.

**Plan impact (`tools/src/backtest/playtest.ts:841–874`): none.** `at(4)` sends
the screen to [24,30] and the foot to [23,31] — both north of the bed. The four
drone legs ([24,25], [16,27], [11,22], [11,12], [15,8]) are all north of y=28.
Expect the armour to reach the hollow ~2 tiles later; the mission ran 0.13 of
target and has no endure-clock, so the clock is not at risk.

**Passive control: unchanged DEFEAT.** It loses on `clear_the_valley_floor` at
300 s, and the herders' foot route did not move.

**Markers/zones:** copied whole. Add `ford_west` [13,34] and `ford_east` [31,34]
for `level-scripter`.

---

#### `tel_marum_2` — *The Prepared Ground* (mission 7, `tel_marum_2_foothold`, foothold)

**Fiction.** A week has passed since the recon and the Sarim have used it. The
mission is a hold *while engineers mark a start line behind you*; the enemy has
spent the same week making the crossing expensive. This is the one mission in the
tree whose subject is earthworks, and `d` is, in the schema's own words, "the
same, dug rather than natural".

**Changed sector** (rows 20–40; elevation edits listed after):

```
     012345678901234567890123456789012345678901234567
 20  ^^^^^^.................^^^................^^^^^^
 21  ^^^^^^..........nnnn...^^^................^^^^^^
 22  ^^^^^^..........nnnn......................^^^^^^
 23  ^^^^^^..........nnnn......................^^^^^^
 24  ^^^^^^....................................^^^^^^
 ...
 32  ^^^^^^.11111111...1111111111...11111111111^^^^^^
 33  ^^^^^^.dddddddd...dddddddddd...ddddddddddd^^^^^^
 34  ^^^^^^.dddddddd...dddddddddd...ddddddddddd^^^^^^
 35  ^^^^^^.11111111...1111111111...11111111111^^^^^^
 36  ^^^^^^....................................^^^^^^
```

- anti-tank ditch `d`, y=33–34, x=7–14 / 18–27 / 31–41 — **two crossings**,
  x=15–17 and x=28–30
- spoil banks `1` (cover 1) on the same runs at y=32 and y=35 — the earth thrown
  both ways; the crossings become the fight and both sides have cover at them
- **the draw**: elevation 2 at (19–21, 27–29) and (25–27, 27–29), leaving
  x=22–24 at 0. The `ammo_draw` zone [22,27,2,2] and the mission-raised `shanty`
  at [22,27] now sit in a two-level slot open only to the south — dead ground
  from both overwatch shoulders, which is *why* a cache would be there
- knoll spur `n` at (16–19, 21–23) — ground for the western infantry leg

**Routes forced** (measured): vehicle `start_line` → `hollow` 15 → **16 tiles**,
1 column → **5**; `start_line` → `approach` **20 tiles, 5 columns**. Foot
unchanged. The bench at y=25–26 is untouched, so the hollow is still dead ground.

**The decision.** Which crossing the armour takes — and separately, whether the
demo squad goes down the covered slot to the cache or across the open. The two
crossings are 13 tiles apart and only the `tm_ammo_guard` at [22.5,26.5] is near
either. The `hold_for approach` clock does not start until the zone is occupied,
so a slow, covered approach costs the player only what the 300 s `raze` deadline
allows.

**Plan impact (`playtest.ts:907–943`): no order moves.** The `at(3)` armour moves
to [23,26] and [26,26] route through a crossing automatically — a flow field
needs no waypoint. Expect ~1–2 s later arrival. **Recommended change anyway:**
move `at(3)` to `at(1)`, because this mission runs 0.87 of target with only 1.1
minutes above its 240 s floor and there is no reason to spend the margin on
travel. The demo squad's move to [23,28] now enters the slot and is still direct.

**Passive control: unchanged DEFEAT** on `burn_the_ammo_point` at 300 s — a
passive player never orders a demolition, and the slot does not change that.

**Markers/zones:** copied whole. Add `crossing_west` [16,34], `crossing_east`
[29,34].

---

#### `tel_marum_3` — *The Churned Pass* (mission 8, `tel_marum_3_clearance`, clearance)

**Fiction.** Two missions of Grad fire and a fight for the approach. Short rounds
have cratered the floor; the Sarim have blown rock into the bay's shoulders as
they lost the approach; the gun sits in the revetment it has been firing from all
along, backed onto the block it is parked against. The briefing already says *"the
corridor is choked with fallen rock"* — the variant extends that sentence to the
rest of the ground it is standing on.

**Changed sector** (rows 2–22):

```
     012345678901234567890123456789012345678901234567
  2  ^^^^^^....................................^^^^^^
  3  ^^^^^^..................###...............^^^^^^
  4  ^^^^^^..................###...............^^^^^^
  5  ^^^^^^................bbbbb...............^^^^^^
  6  ^^^^^^............nnnn.b...b..............^^^^^^
  7  ^^^^^^............nnnn.b...b..............^^^^^^
  8  ^^^^^^............nnnn...r...nnnn.........^^^^^^
  9  ^^^^^^...................r...nnnn.........^^^^^^
 10  ^^^^^^.......^^^^^.......r...nnnn.........^^^^^^
 11  ^^^^^^.......^^^^^.......r................^^^^^^
 12  ^^^^^^^^^^bb^^^^^^^^^^.....^^^^^^^^^^^^^^^^^^^^^   <- wall, untouched
 13  ^^^^^^^^^^bb^^^^^^^^^^.....^^^^^^^^^^^^^^^^^^^^^
 14  ^^^^^^^^^^bb^^^^^^^^^^.....^^^^^^^^^^^^^^^^^^^^^
 15  ^^^^^^^^^^bb^^^^^^^...........^^^^^^^^^^^^^^^^^^
 16  ^^^^^^^^^^bb^^^^^^^b.........b^^^^^^^^^^^^^^^^^^
 17  ^^^^^^^^^^bb^^^^^^^b.........b^^^^^^^^^^^^^^^^^^
 18  ^^^^^^...bbbbbbbbbb...........bbbbbbbbb...^^^^^^
 19  ^^^^^^.......bbbbbb...........bbbbbbbbb...^^^^^^
 20  ^^^^^^..............bbb^^^bbb.............^^^^^^
 21  ^^^^^^..............bbb^^^bbb.............^^^^^^
 22  ^^^^^^....................................^^^^^^
```

- **blast aprons** `b` at y=18–19, x=9–18 and x=30–38 (the base already carries
  `bbbb` at (9–12,18); this widens it), leaving the bay mouth at x=19–29
- **crater belt** `b` at y=20–21, x=20–22 and x=26–28, flanking the base's `^^^`
  outcrop at x=23–25. The only vehicle gates north out of the approach are now
  **x ≤ 19** and **x ≥ 29**
- **the pockets' footings** `b` at (19, 16–17) and (29, 16–17) — armour can no
  longer roll round the outside of either Kornet position. [20,16] and [28,16],
  which the shipped plan attack-moves onto, stay open
- **the battery revetment** `b`: berm at y=5, **x=22–26**; sides at (22, 6–7) and
  (26, 6–7); open to the south. Armour must come at the gun frontally, up the
  axis it just fought through
- road `r` at x=25, y=8–11 (cosmetic — `r` is cover 0, blocked 0)
- plateau knolls `n` at (18–21, 6–8) and (29–32, 8–10)

> **Correction after authoring (2026-09-06).** The "pockets' footings" bullet
> above is not in the shipped `tel_marum_3.json` and should not be authored
> from this sketch as written: (19,16) and (29,16) sit inside rows 16-17,
> which this same section's own opening sentence (and CLAUDE.md, a third
> time) requires stay byte-identical to the base on all three variants — the
> wall is what 27 `tel_marum_doctrine.test.ts` assertions are about and what
> the `relief` visual-gate scenario photographs. Worse, (19,16) is the exact
> tile `tm_pocket_west`'s `atgm_cell` garrisons at `[19.5,16.5]` in both
> `tel_marum_1_recon` and `tel_marum_2_foothold` (III moves the same pocket to
> the same tile) — a boulder under a live garrison spawn. The shipped file
> keeps rows 12-17 an exact copy of the base for all three variants and drops
> both footing tiles; `tools/src/tel_marum_variants.test.ts`'s shared-landmark
> block pins the byte-identity as a guard against this recurring. Nothing
> measured below moved: `start_line -> battery_position` (38->39, 3->8
> columns), `approach -> saddle_wide` (10->14, 3->6 columns) and the two-gate
> redundancy check were all re-run against the real `FlowField` with the
> footings absent and match this section's numbers exactly — the crater belt
> at rows 20-21 already does the gating the footings were meant to sharpen.

> **A hazard this document caught by measuring rather than reading.** The first
> draft ran the revetment berm to x=27. The three families spawn at [27.5,5.5] —
> tile (27,5) — so they would have started standing inside a boulder field. It
> costs civilians nothing (they walk), but it made the vehicle route out of that
> tile `null`, which is how it was noticed. **The berm stops at x=26.** Whoever
> authors this must re-measure the civilian route after any change to rows 5–8.

**Routes forced** (measured on the first draft, i.e. with the berm at x=23–27;
re-measure after the fix): vehicle `start_line` → `battery_position` 38 → **39
tiles**, 3 columns → **8**; **`approach` → `saddle_wide` 10 → 14 tiles, 3 columns
→ 6**; foot `start_line` → `battery_position` **unchanged at 38**; foot corridor
south→north **unchanged at 8**; vehicle corridor 28 → 31.

**The decision — and it is the mission's own bait, made into ground.** The base
map lets armour cross the approach on a 29-tile front and pick its shoulder at
the last moment. The variant makes it choose a gate before it commits: **west**
(x ≤ 19, into the west pocket's arc) or **east** (x ≥ 29, into the east pocket's
and the `tm_bay_lip` recoilless team's). The infantry keeps the corridor, which
is still 8 tiles and still foot-only. The force splits three ways instead of two,
and the split is enforced by ground rather than hoped for.

**Plan impact (`playtest.ts:980–1023`): two orders want moving.**
`at(85)` (armour to [23,22]/[25,22]/[24,23]) is south of the crater belt — stands.
`at(130)` attack-moves the tanks to [28,16] and the Namer to [20,16]; both tiles
are still open, but the **routes** to them now share a gate, so the two arms will
arrive as a column instead of abreast. Recommend splitting it: send the tanks
through the east gate (waypoint [30,20] then [28,16]) and the Namer through the
west (waypoint [18,20] then [20,16]). `at(190)` and `at(240)` are inside the bay
and the pass and stand. **`at(240)`'s `attackMove` to [25,6] now hits the
revetment's south face** — it is open ground at x=24–26, so it stands, but the
tanks will engage the gun at 1–2 tiles instead of driving over it.

**Passive control: unchanged DEFEAT** at 300 s on `get_the_block_out`, provided
the berm stops at x=26 — the families' foot route [27,5] → `approach` is **19
tiles on both base and variant**, measured.

**Markers/zones:** copied whole; `town_block` [24,3,3,2] and its `fail_below: 45`
untouched, and no `b` is authored inside it. Add `gate_west` [18,20] and
`gate_east` [30,20].

---

### 3.2 Beit Sahwan

Base: `beit_sahwan_outskirts`, 80% open, 449 non-open tiles that route in **one
turn** because they are all beside the axis rather than on it. Four tunnel routes
(`bs_tn_west`, `_north`, `_souk`, `_clinic`) — **copy the `tunnels` block
byte-identical into every variant**, because `beit_sahwan_4_subterranean`'s
`collapse` primary targets zone `town` and `tools/validate_data.mjs` resolves the
routes inside it.

**`beit_sahwan_breach` (First Light) — no variant.** It is a 360° defence of a
walled yard against eight raid axes; obstacles inside the wire would block the
defenders' own fields of fire, and the eight axes *are* the mission's shape. An
option is offered in §6.

**`beit_sahwan_1_recon` — no variant.** Recon is where the player learns the town
as it is. Every later variant then reads as the town *changing*, which is the
whole point of the arc.

#### `beit_sahwan_2` — *the fields west of the line* (foothold)

Fiction: *"The battalion has its foothold west of town and Ashwar knows it… a
route that comes up behind your line is worth more to them than every man they
will spend in front of it."* The mission holds `west_approach` [0,8,17,32] — the
whole western third, which today is bare.

Changes (all inside `west_approach`, x=0–16, and all on tiles that are `.`
today): extend the olive belt at (8–15, 11–13) and (8–15, 24–26) — the existing
grove occupies (8–14, 14–20) and is not overwritten; **field walls** `=` in runs
of 5–6 along the old field lines at **y=17, x=2–7** and **y=27, x=2–7**, each
with a one-tile gap; knolls `n` at (2–5, 12–14) and (2–5, 32–34) — the map's own
knolls start at x=6, so these extend rather than replace; `2` at the wall gaps.

Effect: the three waves into `kdf_assembly` [4,23] (t=45/150/260 s, from
`town_center` and `mortar_line`) must funnel through two gaps instead of crossing
a 17×32 field. The player picks which gap to hold and which to give up. **Both
domains bend** — `=` blocks both — but it is breachable at 200 hp/tile and
carries **ROE penalty 0**, so tearing a wall down is free and is a legitimate
answer.

Estimated (to be measured at authoring): `kdf_assembly` → `town_center` vehicle
27 → **29–31 tiles**, turns 1 → **5+**.

Constraints: keep the `camp` at [2,20] (tiles 2–3, 20–21) clear on all four
sides — it is the mission's production site, and the wall runs at y=17 and y=27
are deliberately three rows clear of it; keep `bs_tn_west`'s vent at [7,22] on
open ground; `hold_for west_approach` needs presence anywhere in a 17×32 zone, so
partial obstruction cannot make it unholdable.

Plan impact: the shipped plan holds position in the assembly area and spends the
corridor; expect no order to move, and expect the waves to arrive later and
concentrated. **Re-measure the passive control** — this is the one variant that
could make a *passive* player harder to kill, and the control must stay DEFEAT.

> **Correction after authoring (2026-09-06).** The two horizontal wall runs
> above (y=17 and y=27, x=2–7) were built as sketched and measured to have
> **zero effect on anything the mission actually sends across them.** Both
> named enemy sources this mission fields (`town_center` [31,22] and
> `mortar_line` [44,24]) reduce to the identical straight line at **y=23**
> the entire width of `west_approach` for x≤16 — five and six rows off either
> sketched wall respectively — so the "must funnel through two gaps" effect
> above never happened; `kdf_assembly` → `town_center` measured **27 tiles, 1
> direction change, unchanged**, on both the base and the sketch. This is the
> same failure mode as the distant-saddle and bowl negatives in §2.2, just
> found on a second, more open map. Shipped instead: **one north–south wall
> at x=11**, spanning the zone's full height (y=9–39), with the sketch's own
> y=17 and y=27 kept as the two GATES cut into it rather than two separate
> wall rows — the vertical analogue of Tel Marum's TM-2 ditch. Measured
> against the real `FlowField`: `kdf_assembly` → `town_center` is now **27
> tiles (unchanged) with 1 → 3 direction changes** for both foot and vehicle,
> blocking either gate alone still routes at 27 tiles, and blocking both
> seals it to 36. `pnpm playtest` needed no order change — a flow field
> resolves the gate on its own — and the passive control stays DEFEAT.
> `tools/src/beit_sahwan_variants.test.ts` pins all of this against the base
> as a control.

#### `beit_sahwan_3` — *the town, contested* (clearance)

Fiction: the clinic-block briefing is the strongest ROE writing in the tree and
changes not a word. What changes is that the block now has an edge you can see.

Changes: `2` cover at the road junctions inside zone `town` [19,9,22,31]; `b`
rubble across **two of the four** road entries into the town — the northern `rr`
spur at **(31–32, 14–16)** and the southern vertical road at **(26–27, 29–31)**,
both verified as `r` tiles on the grid; a `=` wall run around the `clinic` zone
[29,23,6,6] with **one** gap on its west face.

Effect: armour enters the town by two ways instead of four, and the protected
block stops being an invisible rectangle. "Do not shoot into it" becomes "do not
drive into it", which is a better lesson and a cheaper one to learn.

Estimated: vehicle `kdf_assembly` → `town_center` 27 → **31–33**, turns 1 → 5+.

Constraints: `capture town` needs presence in the zone only. **Do not wall the
clinic's own tiles** — the `m` mosque tiles at (20–22, 18–20) and the ROE
`flagged_zones: ["clinic"]` are untouched. `fail_below: 40` stands. The house at
(28–31, 10–13) is garrisoned **by tile** in this mission
(`bs_cell_north_block`, `stance.building: [28,12]`), so it must stay a building —
see the BS-IV note below for what `validate_data.mjs` does otherwise.

Plan impact: the clearance plan drives to `town_center` and to `bs_hvt_atgm`
[38,22]; whichever road entry it uses must survive. Author the rubble on the two
entries the plan does *not* use, then re-run and check the printed minutes (the
plan runs 0.36 of target, so there is room).

> **Correction after authoring (2026-09-06), two parts.**
>
> **Part one, the "27 → 31–33 tiles" estimate does not hold.** Measured
> through the real `FlowField`, `kdf_assembly` → `town_center` and
> `kdf_assembly` → `bs_hvt_atgm` are **both unchanged** — 27 and 34 tiles, 1
> direction change each, identical to the base — because the plan's own
> route runs the main east–west road at y≈22, and both the north-spur rubble
> (y=14–16) and the south vertical-road rubble (y=29–31) sit five-plus rows
> off it, the same "obstacle beside the road rather than on it" shape §0
> already names for this map. This is not nothing: crossing the north spur
> directly is a genuine local closure (5 → 7 tiles, vehicle-only) and so is
> the south vertical road (9 → 10), and both are pinned as such. But neither
> bends the two headline legs, and the sentence "armour enters the town by
> two ways instead of four" should be read as "two of the town's *named
> side-streets* are now foot-only", not as a route-length claim. The clinic
> wall is the variant's real, substantial barrier: measured round it,
> **9 → 13 tiles** where the base map only detours the building itself.
>
> **Part two, the clinic wall exposed the plan to a new ROE fault the
> sketch could not have predicted, and it needed an order change to fix.**
> `wall` is `per_tile` and carries its own HP (200/tile) — a real structure,
> unlike the `2` cover it replaced. The plan's armour (`mbt_lavi` + `ifv_namer`)
> parks near the house block clearing `bs_cell_north_block` from t=1 to the
> old t=140, and once that fight ends it has nothing else to shoot at with
> nothing else in range: the wall's own north face (y=23) sits **10 tiles**
> from that position, inside both `ifv_namer`'s `cannon_30` (range 10) and
> `mbt_lavi`'s `gun_120` (range 12). Attack-move idle-fixates on it, and while
> knocking the wall down is free (`roe_penalty: 0`), `roe.flagged_zones`
> charges every stray heavy round that scatters into the zone regardless of
> intended target — six such strays over ~50s, ROE **94 → 61** (still clear
> of `fail_below: 40`, but a real, avoidable hit). Isolated by re-running with
> ONLY the wall present, nothing else, to confirm it was the cause and not
> the road rubble (which alone reproduces the base's ROE 94 exactly). Fixed
> in `playtest.ts` by moving the armour's own eastward order from t=140 to
> **t=85** — before the fixation has time to compound — cutting it to one
> stray (ROE 94 → 89). The infantry/Eitan half of that same `at(140)` block is
> untouched; it was never implicated. Final measured line: **2.6 min, ROE 84**
> (a second RNG-sensitive shift from the retiming itself, still comfortably
> above the floor). `tools/src/beit_sahwan_variants.test.ts` pins the two
> local closures and the clinic-wall detour as the variant's real, measured
> claims.

#### `beit_sahwan_4` — *the town after* (subterranean)

**The variant the fiction demands.** The briefing opens *"The town is ours and the
fighting has not stopped"* — it is set after III, and today it is fought on ground
that shows no sign of III having happened. Today its start [26,34] reaches
`shaft_head` in **21 tiles and zero direction changes**.

Changes: `b` rubble around the two `a` apartment footprints — (34–38, 15–19) and
(26–31, 36–38) — on their *surrounds*, never their tiles; the **warehouse block at
(30–33, 24–27) reduced to `b` rubble**, a building that came down in the
clearance; `2` cover in the debris; and **one road down**: `b` across the vertical
`rr` at (26–27, 23–28).

> **Which building may fall is a validation question, not a taste question.**
> `tools/validate_data.mjs` (~lines 331–334) requires a `garrison` stance to point
> at an actual building on the mission's map. In `beit_sahwan_4_subterranean` two
> placements do: `bs4_cell_souk` garrisons **[23,31]** (the souk shanty at 22–24,
> 30–32) and `bs_cell_north_block` garrisons **[28,12]** (the north house at
> 28–31, 10–13). Rubble either and `pnpm validate:data` goes red. The warehouse at
> (30–33, 24–27) is garrisoned by nothing in this mission, which is why it is the
> one nominated. Re-check that list against the mission JSON before authoring — it
> differs per mission on the same map.

Effect: the Namer and the Eitan can no longer drive the shaft axis; the two
`yahalom_squad` and the three `inf_squad` walk it. That is exactly the phase —
*"escort the EOD squad to shafts"* (GDD §4) — and it is currently a drive.

Estimated: vehicle [26,34] → `shaft_head` 21 → **27–31**, turns 0 → 6+; foot
**unchanged at 21**.

Constraints, all load-bearing: the `tunnels` block is byte-identical; **no `b` or
building may go between the four hostages at [24.5,14.5] and `civ_collection`
[29,33]** — `b` is free to foot so this is safe by construction, and it is why
rubble here is `b` and never `^`; the `collection_point` zone [28,32,4,3] and
`shaft_head` [25,12,3,3] stay clear.

Plan impact: the plan drives a `mark_tunnel` carrier at a route; check which
vehicle carries it and whether its lane survives. The mission runs 0.22 of
target, so the clock has room. **`evacuate_before` at 240 s is the risk** —
measure the hostages' foot route on the variant and require it within 2 tiles of
the base's.

> **Correction after authoring (2026-09-06), two parts, both found by running
> `pnpm playtest`, not by reading the sketch.**
>
> **Part one — the warehouse rubble is dropped.** `b` carries no sight-block
> (the terrain table, both here and in CLAUDE.md: boulder/rubble blocks sight
> NO, a building blocks sight YES), so replacing the warehouse opened a
> sightline south from `bs4_ambush_mouth_west`'s garrison at (31.5,23.5) —
> which sits on the warehouse's own top ring row — straight through ground a
> 340 hp/tile structure used to cover. Isolated by re-running with ONLY that
> one edit present: it alone turns this mission's scripted plan from VICTORY
> (2.1 min, roster 6) into DEFEAT, with an `inf_squad` dead at t=4.9s that
> previously only dropped to ~8 hp, and then **both** irreplaceable
> `yahalom_squad` teams dead by t=172s — this mission fields exactly two, and
> losing either makes `bring_it_down` unfinishable inside its 300s deadline
> regardless of anything else. The design's own stated EFFECT for this
> mission ("the Namer and the Eitan can no longer drive the shaft axis") is
> attributed to the road closure below, not the warehouse — the warehouse was
> flavour ("a building that came down") rather than load-bearing, so it is
> the piece dropped rather than re-tuning a plan finely balanced enough that
> its own comments already record hunting for a single winning tick. The
> warehouse stays a `w` building on the shipped `beit_sahwan_4.json`; the
> apartment surrounds and the road closure below are otherwise as sketched.
>
> **Part two — "one road down" needed widening, and the reason is the same
> diagonal-absorption finding as `beit_sahwan_2`'s wall.** The literal
> `b` across (26–27, 23–28) is 2 columns wide with open ground either side;
> a vehicle steps 1 column west onto (25,*y*) and the measured route does
> not lengthen AT ALL (21 tiles either way). Widened to the full open belt
> between the western tunnel-vent corridor and the clinic zone's own ring,
> x=20–28 (one row short of the souk's own ring at y=29, which must not be
> touched) — this does not lengthen the route either (still 21 tiles; a
> Chebyshev detour well inside this journey's own vertical distance is
> absorbed for free, exactly CLAUDE.md's "a climb telescopes" without any
> elevation at all), but it does bend it: **0 → 3 direction changes**,
> foot completely unaffected (0 → 0). This is the design's own "light"
> setting from §2.3 working as intended — route length unchanged, shape
> bent — not a shortfall to keep pushing on.
>
> Final measured line with both corrections: **2.1 min, ROE 98, roster out
> 4** (two fewer survivors than the unmodified base's roster 6, from the
> same RNG-stream sensitivity every entry in this document's Beit Sahwan
> section records — the objectives and the verdict are unchanged).
> `tools/src/beit_sahwan_variants.test.ts`'s shared-landmark block now
> asserts NO building tile changes on any of the three Beit Sahwan variants.

---

### 3.3 Wadi Halam

Base: `wadi_halam_basin`, green, 79% open, **no elevation grid at all**. Its
existing structure is good — the poplar gallery `o` at x=7–12 running the full
height, the bund lines `1`, the ford knolls, the village, the `=`-walled depot —
but again all of it is beside the axis: `kdf_crossing` → `village_center` is
**26 tiles, one turn**.

**`wadi_halam_1_fords` — no variant.** The fords are the lesson and the map
already teaches them (crossing → `ford_north` 9 tiles).

#### `wadi_halam_2` — *the terraces the briefing already claims* (foothold)

The briefing says: *"The ground is terraced — bunds run across the pasture in
bands, real cover if you hold it."* The bunds exist as `1` cover; **the terracing
does not exist at all.** Give the map its first elevation grid.

Changes: an `elevation` grid, flat 0 everywhere except the `pasture` zone
[13,14,11,20], which steps **0 → 1 → 2 → 3** west to east on the existing bund
lines, with a ramp (a level run) placed **3 tiles off each raider's axis** — per
§2.2 a 3-level step reorders a route whose saddle is 3 tiles away and nothing
further, so this is the exact regime. Plus `d` ditch stubs across the two
technical lanes: (36–41, 18–19) and (36–41, 28–29), each with one gap.

Effect: `technical`, `gun_truck` and `moto_rpg` are all wheeled, so `d` reroutes
**every raider** without touching the player's infantry. The mission is *"waves
from every direction"*; the variant makes the number of directions something the
player can reduce by holding two gaps. The terraces give the pump house real dead
ground (two levels is the floor for hiding ground troops — `BLOCK_RISE`/`EYE_HEIGHT`).

Estimated: raider `rif_east` → pump house 21 → **25–27**; player `kdf_crossing`
→ `pasture` +0 to +2 (the ramps sit on the player's own axis deliberately).

Constraints: `hold_for pasture` at 300 s and `raze pasture` at 300 s both run on
the same clock, and the plan sits at 0.80 of target with 0.6 min above its floor
— **do not lengthen the player's march**. The `shanty` the mission raises at
[16,19] must sit on a terrace *tread*, not a riser.

> **Correction after authoring (2026-09-06), two parts.**
>
> **Part one, the ditch coordinates.** The sketch's `(36-41, y18-19)` and
> `(36-41, y28-29)` sit INSIDE the depot compound's own walled footprint
> (x34-42, y16-31) — a shared landmark every Wadi Halam variant must leave
> untouched, the same rule Beit Sahwan and Tel Marum's variants carry for
> their own compounds and wall bands. Shipped instead: the same columns
> (36-41), relocated to open ground just outside the compound, at the rows
> each raider group's own straight-line beeline actually crosses — measured
> through the real `FlowField`, not estimated: `rif_north`'s beeline crosses
> x=36-41 at y≈12, `rif_south`'s at y≈35.
>
> **Part two, the estimate itself does not hold, and the reason is worth
> recording because it is a new variant of an old lesson.** Measured against
> the real `FlowField`, `rif_east → pump_house` is **35 tiles unchanged, the
> identical tile sequence** with or without the elevation grid — not the
> 25-27 estimated. Every one of the three wave approaches (`rif_north`,
> `rif_south`, `rif_east`) funnels through the SAME northwest corner (23,16)
> regardless of origin, because the depot compound's own bulk forces that
> funnel with no elevation involved at all, and climbing the shoulder there
> (a real cost) is still cheaper than any detour long enough to avoid it —
> the same "distant ridge"/"bowl" absorption CLAUDE.md already documents
> twice (Tel Marum, Qarn Hadid), reproduced here on a third map, and this
> time with no cover-vs-route confusion possible since it is elevation cost
> being absorbed, not a hard block being walked around. What the shoulder
> DOES do, measured: real dead ground (a sight line laid flat across its
> crest is blocked on the variant and clear on the base) — which is the
> OTHER half of §2.2's own conclusion ("elevation's real jobs are... shape at
> zero tile cost and dead ground"), just not the route-bending half. The
> shipped shoulder's own peak was also lowered from level 3 to level 2 during
> authoring, independent of the above: a single-tile jump from outside
> ground (elevation 0) to a level-3 zone edge measured over
> `SURFACE_OVERSHOOT_LEVELS`, the calibrated bound on how far the renderer's
> C1 ground spline may overshoot a sharp step (`packages/app/src/terrain-parity.test.ts`).
> Level 2 clears it with margin and still sits at exactly `BLOCK_RISE`, so
> the dead-ground claim survives unchanged. `d` ditch stubs still reroute
> **every raider that crosses them** (both are wheeled-only), and the
> mission's own two-gap texture is intact — it just is not what makes the
> approach longer, since it does not. All measured claims are pinned in
> `tools/src/wadi_halam_variants.test.ts`.

#### `wadi_halam_3` — *the cattle track* (buildup)

Fiction: *"Catching the commander himself is a mobility problem, not a firepower
one."* Make the mobility problem geometric.

Changes: olive `o` gallery fingers reaching east from the poplar line at
(13–18, 9–13) and (13–18, 36–40) — the two hides get approaches; `n` on the cattle
track at (20–23, 30–34); and a `d` cut on **each of the two bypasses round the
depot**, at **y=13, x=36–46 with a gap at x=40** and **y=33, x=36–46 with a gap at
x=44**. Both rows are open `.` on the grid today.

Effect: the depot compound (x=34–42, y=16–31, walled, one gate at [34,24]) already
forces every east–west wheeled move to pass north of y=16 or south of y=31. The
two cuts reduce those bypasses to one gate each. The trigger
`the_commander_runs_for_the_east_track` withdraws him to `rif_east` [44,24]; with
the cuts his only wheeled line out is a gap, and holding a gap is the mission —
the briefing's *"catching the commander is a mobility problem, not a firepower
one"* made mechanical.

**Verify at authoring:** a `withdraw_to` whose target has no route strands the
unit. Measure `wh_hvt_amir`'s vehicle route to [44,24] on the variant and require
it finite.

Estimated: commander's escape 18 → **20–22 tiles**, turns 1 → 4+.

> **Correction after authoring (2026-09-06).** The sketch's own row numbers
> (y=13 north, y=33 south) are unchanged — those rows ARE genuinely open,
> clear of the depot compound. What the sketch under-specified is the ditch's
> WIDTH: at 11 columns wide (x36-46) with two full rows of open ground on
> either side of it (row 14/15 north, row 34 south), a vehicle sidesteps a
> one-row ditch for nothing when the surrounding field is open — Beit Sahwan
> II's own "obstacle beside the road" correction, reproduced here on a
> second map. `wh_hvt_amir`'s withdrawal (`hide_north → rif_east`) measured
> completely unaffected either way, **30 tiles, finite** — which satisfies
> the design's own explicit ask (finite, not necessarily longer) exactly.
> Shipped and measured instead: a genuine LIGHT effect on the wheeled wave
> approaches to `pump_house`, matching CLAUDE.md's own calibration table
> (route length UNCHANGED, shape bent) rather than the estimated length
> increase — `rif_north → pump_house` stays 27 tiles with turns going 3 → 5,
> and `rif_south → pump_house` stays 30 tiles on a measurably different set
> of tiles (both dodge the ditch stub without a net-longer trip, since the
> lateral dogleg is absorbed the same way a Tel Marum saddle absorbs one —
> CLAUDE.md's "a climb telescopes", here without any elevation at all).
> Crossing either ditch directly is a genuine local closure (2 → 4 tiles),
> pinned as such rather than as a route-length claim.
> `tools/src/wadi_halam_variants.test.ts` pins all of the above.

#### `wadi_halam_4` — *the village* (clearance)

The village is two rows of houses — (25–28, 16–18) and (30–33, 16–18) north,
(25–28, 27–29) and (30–32, 27–29) south — with a one-column lane at **x=29**
between each pair, the mosque at (28–30, 22–24), and the vertical road at x=33.

Changes: a `=` courtyard wall in the **northern** lane at (29, 16–18) with one
gap; `b` rubble in the western approach lane at (24, 19–21); `2` cover in the
yards at (25–27, 20–21) and (30–32, 20–21); and a walled forecourt on
`mosque_block` [28,22,4,4] — `=` at (31, 22–25) and (28–31, 25) with one gap. The
same "physical edge on the protected zone" device as Beit Sahwan III, and for the
same reason (`m` carries ROE penalty **30**, the highest in the catalogue).

Estimated: vehicle `kdf_crossing` → `village_center` 26 → **29–31**, turns 1 → 6+.

Constraints — and this is the variant where rule 4 bites hardest. Three civilians
sit at [28.5,20.5], [29.5,28.5] and [25.5,23.5] and run to `refuge` [19,34,8,6] on
a 300 s clock. **The one at (29,28) is standing in the southern lane**, which is
why the southern lane is left open and only the northern one is walled. Walls
block foot; `b` does not. Measure all three routes on the variant and require each
within ~3 tiles of the base's; where one is not, swap that run from `=` to `b`.

> **Correction after authoring (2026-09-06), two parts.**
>
> **Part one, the headline estimate does not hold.** Measured against the
> real `FlowField`, `player_start(9,21) → village_center` is **unchanged at
> 20 tiles, 1 turn** — not 29-31/6+. The route runs the entire way along
> y=26, south of the courtyard wall (y16-18), the west-approach rubble
> (y19-21) and the mosque forecourt (y22-25) alike. This is Beit Sahwan
> III's own correction shape again: the headline leg is untouched, and what
> is real is a set of substantial LOCAL closures. Measured: the northern
> lane (x=29) turns out to be the ONLY north-south gap across the entire
> two-house block for its whole 16-18 height — every neighbouring column is
> a house — so walling it is not "one gap in a wide wall" but a closure of
> the block's single passage, and crossing it locally goes from 4 to **19**
> tiles; the west-approach rubble is a genuine local closure too (2 → 6);
> the mosque forecourt wall adds a real, modest cost on both of its
> approaches (8 → 9, 4 → 6).
>
> **Part two, the "one gap" in the northern lane is geometrically inert, and
> that is worth recording rather than silently shipping.** (29,17), the
> gap's own tile, is flanked on its EAST and WEST by houses at every one of
> rows 16-18, and its NORTH and SOUTH neighbours are the new wall — so it
> has no reachable orthogonal neighbour, and `FlowField.compute`'s
> no-corner-cutting rule (CLAUDE.md, "diagonal steps require both adjacent
> orthogonal tiles open") blocks every diagonal approach around a house too.
> A single-tile-wide corridor flanked by buildings for its entire length
> cannot host a partial "wall with a gap" the way Beit Sahwan II's wide
> field or Tel Marum's ditch can: any wall tile placed anywhere in it seals
> it completely, and the position of the "gap" is cosmetic. Measured by
> sealing that already-unreachable tile too and confirming the crossing
> length does not move at all. The wall is authored with the gap anyway,
> both because the sketch's own visual promise (a wall a player can SEE has
> a break in it) still reads correctly and because a future width change to
> this lane would make the gap load-bearing again for free. Civilian foot
> routes (all three) measured completely unaffected, matching rule 4 by
> construction. `tools/src/wadi_halam_variants.test.ts` pins all of the above.

#### `wadi_halam_5` — *the depot* (clearance) — **highest risk, author last**

This mission already has the best two-route writing in the tree: *"The straight
line east runs through the village, and a D9 levels whatever it halts beside…
The road south of the village costs you a little time and nothing else."* Do not
add a third choice. **Sharpen the existing two.**

Both routes already converge on **one gate** — the single gap in the depot's west
wall at [34,24] — and the last leg into it is the road at x=33, y=25–33: a
nine-tile straight column with `wh_gate_rpg` in ambush at its head and three gun
trucks behind the wire. That column is the mission's killing ground and it is
currently bare.

Change (light, deliberately): `b` spoil **either side of the last leg** at
(31–32, 25–26) and (31–32, 30–31), and `2` cover in the forecourt at (35–36,
22–23) and (35–36, 26–27). **The road at x=33 and the gate at [34,24] are not
touched**, so the D9's own route length is unchanged by construction. What changes
is that armour can no longer spread off the road onto the open ground either side
of it, and the escort has cover to fight the ambush from — so the escort has to be
*arranged* rather than ordered forward. This is the "light" setting from §2.3, and
it is chosen for this mission on purpose.

**Why it is the riskiest:** `raze depot` is gated at 300 s and `hold_for depot`
runs 240 s *after* the depot comes down — a 9-minute mechanical ceiling behind a
declaration of 7, which the optimal plan reaches in 6.1 min **only because it
razes fast** (CLAUDE.md). Any lengthening of the D9's march eats that margin
directly. Measure the D9's vehicle route before and after and require it
**identical**; anything else means the spoil has leaked onto the road, and the
change should be dropped rather than trimmed.

> **Correction after authoring (2026-09-06).** The northern spoil patch's own
> sketch coordinates, `(31-32, 25-26)`, moved the D9's route: measured, the
> D9's real route from its own spawn `[13,25]` to `depot_gate` steps through
> `(31,25)` as a diagonal shortcut on the unmodified base, and blocking it
> pushed the route from 21 to 22 tiles — precisely the failure this
> mission's own design text names ("anything else means the spoil has
> leaked onto the road, and the change should be dropped rather than
> trimmed"). Rather than dropping the change outright, the patch is shifted
> one row south to `(31-32, 26-27)`, which stays beside the same leg (the
> road at x=33 and the gate) and produces a route that is not merely the
> same LENGTH but the exact same tile sequence, byte for byte, verified
> against the base's own path array. One further correction the shift
> itself required: `(31,27)`/`(32,27)` are already the south house block's
> own footprint (`(30-32,27-29)`), so the shipped patch is a 2-tile sliver
> at row 26 rather than the sketch's full 2x2 — the same "never overwrite a
> building" rule (`only_open`) every other town's variants already follow.
> `tools/src/wadi_halam_variants.test.ts` pins the exact byte-identical path.

---

### 3.4 Umm Zeitoun

`umm_zeitoun` is the exemplar and needs the least work: all ten terrain symbols,
elevation 0–7, `b` scree on the west horn, `d` across y=31, and foot/vehicle
routes that already diverge. **45 assertions are pinned against it**
(`tools/src/umm_zeitoun_doctrine.test.ts`), including exact zone tile counts —
so a variant must be a new file and must not touch `staging`, `crest_line`,
`post_stone`, `stockpile`, `crest_top`, `hamlet` or `basin_floor`'s contents.

**`umm_zeitoun_1_recon` and `umm_zeitoun_2_buildup` — no variant.** Mission I's
briefing opens *"Umm Zeitoun is a basin: no wall across it, no gate to force,
crossable anywhere on its width."* Obstacles would make the briefing false, and
the mission's decision (which hills to buy cheaply, which to buy with the drone's
life) is a sight problem the map already poses well.

#### `umm_zeitoun_3` — *between the horns* (clearance)

Fiction: *"Nobody inside that block can see out of it and nothing outside it can
see in — the houses do that in both directions."* The hamlet is already good; the
ground *between* it and the two horns is bare glacis on both sides, and the
mission asks the player to split a force across it.

Changes (sector-level; exact tiles picked against the grid at authoring, because
the road at x=24, the scree at x=6–15 and the knoll clusters already occupy much
of this ground): `o` orchard on the **western** approach between the scree apron
and the hamlet at **(15–18, 25–28)** — verified open, and one column clear of
`hamlet`'s western edge at x=19; `o` orchard on the **eastern** approach at
**(30–34, 25–28)**; `2` cover on the eastern glacis at **(33–36, 18–19)**,
verified open today, where `uz_atgm_glacis` lies at [34.5,20.5].

Effect: modest and deliberate — the split is already the mission's decision; this
gives each half of the split its own covered line rather than the same open floor
twice, so "which half walks" becomes "which half walks *where*".

Estimated: +0 to +2 tiles either arm; shape 5 columns → 8.

Constraints, all hard. **Do not touch one tile inside `hamlet` [19,24,9,5]** —
`umm_zeitoun_doctrine.test.ts` pins its exact mix (14 house, 6 shanty, 5 road, 20
open) and it is the ROE `flagged_zone` with `fail_below: 45`; the hamlet is
already the densest ground on the map and needs nothing. Do not touch the `d` line
at y=31 or the scree at x=6–15, both of which the same file pins. Six civilians in
two groups (at [22.5,26.5] and [21.5,28.5]) run to `refuge_wadi` [21,36,5,3] on a
300 s clock — the orchards sit north of them and `o` does not block foot, so their
line is untouched by construction; verify it anyway.

#### `umm_zeitoun_4` — *the shelf* (clearance)

Fiction: *"there is no dozer in Sur — that is two demolition parties, five
seconds of charges at a time, standing still within two tiles of what they are
dropping."*

Changes: `b` spoil on the porters' working ground south of the yard at
**(28–35, 10–11)** — open `.` today; a `d` cut across the north track at
**y=11, x=17–27**, abutting the `^` spur at x=16 and **gapped at x=24, which is
the road** — a natural gate rather than an authored hole; and the crest's knoll
cap extended north at **y=3, x=10–18**.

Effect: the two `demo_squad` walk the last leg (both `b` and `d` are free to
foot) while the armour goes round to the gap. The mission's own sentence becomes
the mission's own geometry, and the `raze stockpile` 300 s clock stays a demand
on the *demolition parties* rather than on the whole force.

Constraints, all hard: **do not touch a single tile of `stockpile` [29,5,7,5] or
`crest_top` [12,5,5,5]** — both are `raze` targets and `validate_data.mjs`
audits their structure contents; four `porters` civilians run from [29.5,9.5] to
`north_shelf` [25,2,5,3] on a 240 s clock, and the `d` cut at y=11 is *south* of
them, so their line is untouched — verify it.

---

## 4. Authoring and measuring

### 4.1 Order

**Tel Marum → Beit Sahwan → Wadi Halam → Umm Zeitoun.**

- **Tel Marum first** because the lead named it, because its base is the *only*
  one that is both pinned by a doctrine test and photographed by the visual gate,
  and because its three missions sit on one wall — so proving that a variant can
  change the floor without moving one pinned sight fact proves the pattern
  everywhere else.
- **Beit Sahwan second**: five missions, the most content in the tree, four
  tunnels to preserve, and IV's fiction demands the change more loudly than any
  other mission's.
- **Wadi Halam third**: it is the largest single change (a map with *no*
  elevation grid gains one) and it wants the pattern settled first. Author V
  last within the town, and be willing to drop it.
- **Umm Zeitoun last and smallest**: it is already the exemplar, and its 45
  pinned assertions make it the town where a careless variant costs the most for
  the least gain.

Within a town: author the **latest phase first**. A clearance variant is the one
whose fiction most demands changed ground, and it is the one whose plan is most
sensitive — so it is the honest test of the pattern. Then work back.

### 4.2 What a variant's own test asserts

One file per town: `tools/src/<town>_variants.test.ts`. Five blocks, in this
order, each paired with a positive so a broken loader cannot pass it:

1. **Shared-landmark identity — the drift guard, and the reason Option A is
   safe.** For every variant of the town: the `markers` and `zones` objects deep-
   equal the base's (a variant may add keys, never move or drop one); the
   `tunnels` array deep-equals the base's; and every tile in the town's declared
   **landmark set** is character-identical to the base. Tel Marum's landmark set
   is rows 12–17 in full plus the flanking `^` columns; Beit Sahwan's is the
   structure tiles and the `rr` grid; Wadi Halam's is the depot compound and the
   poplar gallery; Umm Zeitoun's is `stockpile`, `crest_top`, `post_stone` and
   the `hamlet` structures.
2. **The route bends and does not seal.** For each variant and each primary's
   target: `route(variant, domain, player_start, target)` is finite for both
   domains (unless the mission deliberately splits them, in which case the
   vehicle result is asserted `null` **and the briefing is quoted in the test's
   comment**); and the **direction-change count is at least the number this
   document promises**. That last assertion is the lead's requirement made
   testable — nothing else in the tree can express "not a straight line".
3. **Two routes.** For each primary: re-run the field with the best route's
   narrowest tile forced blocked; a finite route must remain. Paired with the
   base as control.
4. **Civilian lines survive.** For every civilian group in the mission: the
   **foot** route from its spawn to its refuge on the variant is within a stated
   tolerance (recommend 2 tiles) of the same route on the base. This is the
   assertion that would have caught the TM-3 revetment fault, and the one that
   protects every `evacuate_before` deadline in the tree.
5. **Sight facts the briefing claims.** Only where the variant touches ground a
   briefing describes, using the base test's `sees()` helper with the 48-sight
   `OBSERVER`. For Tel Marum: assert the hollow is still dead ground from both
   shoulders on all three variants, and that the corridor is still unwatched from
   its own mouth.

Cost estimate: ~120 lines per town, four files.

### 4.3 The `playtest` re-runs

`pnpm playtest` (4.07 s, no browser, no GPU) after **each** variant, not at the
end. The assertion in `run()` is `result === expect` **and nothing else** — so:

- the *verdicts* (plan VICTORY, control DEFEAT) are checked by the exit code;
- the **durations are not**. CLAUDE.md records a mission degrading **7×, to 3.4×
  its own `target_minutes`, with the gate still green at exit 0**. So the printed
  minutes must be **captured before and after each variant and diffed by hand**,
  and a variant that moves a mission by more than ~15% of its own baseline goes
  back for another cut.
- Record both numbers per mission in the PR body. The seven missions with an
  endure-clock (`hold_for`/`survive_until` `seconds`) sit at 0.70–1.00 of target
  and 0.0–2.1 min above their own floor; those are the ones where a longer march
  actually shows. The six without an endure-clock scatter 0.10–0.87 because each
  plan hardcodes the answer — **a low ratio there is not evidence and must not be
  tuned against**.

Two controls that must specifically be re-proved, because a variant could
plausibly move them:

- `beit_sahwan_2_foothold (passive control)` — the west-approach walls make a
  passive defender harder to reach. It must stay DEFEAT.
- every `evacuate_before` control (Tel Marum I and III, Wadi Halam I/III/IV, Umm
  Zeitoun I/III) — these lose on a civilian clock, and §4.2 block 4 is what keeps
  that clock honest.

### 4.4 Registration

Per variant, two edits and nothing else:

1. `packages/data/src/index.ts` — one `import telMarum2 from
   '../../../data/maps/tel_marum_2.json';` beside the others, and one entry in
   the exported `maps` object.
2. the mission's `map.file`.

A forgotten registration is a **red test, not a silent bug**, and that is
deliberate: `packages/app/src/terrain-parity.test.ts` (line ~356) reads
`data/maps/` off disk and asserts `Object.keys(maps)` equals it exactly, and
`packages/app/src/ui/sandbox-menu.test.ts` asserts the same against the picker.
Both were written to stop hand-maintained map lists and they do their job here
for free.

*(Both files are in `packages/app/**`, which another agent is editing. Nothing in
this plan requires changing either of them — see §5 and §6.4.)*

---

## 5. Asset and gate consequences

| area | consequence | evidence |
|---|---|---|
| **Art** | **None. No new asset of any kind.** Every symbol this document uses already resolves to a shipped decor family: `d`→`ditch`, `b`→`boulder`, `o`→`tree`, `n`→`rock`, `^`→`slab`, `1/2/3`→`bush`, `.`→`grass`/`sand`, `r`→albedo only. | `packages/render/src/three/terrain/decor-place.ts:111–124` |
| **`pnpm validate:meshes`** | Unchanged — 21 decor meshes and 46 unit meshes, none added. Building symbols used (`s`, `h`, `=`) already ship meshes. | current gate output, CLAUDE.md |
| **`pnpm validate:data`** | Runs on every new file. The map schema is **unchanged** (no new field). It checks row count/length against `width`/`height`, marker/zone bounds, every symbol against the structure catalogue and terrain legend, and `elevationFailures` for `wadi_halam_2`'s new grid. **The check that will bite** is the `raze`/`collapse` zone-contents audit — do not touch a `raze` target's structure tiles. | `tools/validate_data.mjs:128, 150–190, 382–460`; `tools/validate_map_grid.mjs` |
| **Visual gate (`pnpm golden-baseline`)** | **No bless needed, provided base files are untouched.** Its four gated scenarios name `beit_sahwan_outskirts` ×2, `tutorial_ground` and `tel_marum` — base ids. New files are invisible to it. | `tools/src/golden-diff/capture-protocol.ts:282, 379, 421, 518` |
| **Visual gate — the one caveat** | The **report-only** `combat` scenario is `mission=beit_sahwan_3_clearance` (`capture-protocol.ts:449`). Moving that mission to `beit_sahwan_3` changes what that scenario photographs. It **does not vote** (its own noise is 969–3847 px against a 3231 px defect, so no honest threshold exists) and it has no baseline to bless — but its uploaded CI artifact will look different and someone will ask why. Say so in the PR. | CLAUDE.md, "The visual gate" |
| **`pnpm test`** | Grows. `terrain-parity.test.ts` runs `describe.each(MAP_IDS)` — a full per-map suite per variant — and `mesh-catalogue.test.ts` runs a decor-superset check per map. Thirteen variants means thirteen more map suites on a 2,012-spec / 18.65 s baseline. That is **free coverage**, not a cost to avoid. | `packages/app/src/terrain-parity.test.ts:354`, `mesh-catalogue.test.ts:225` |
| **`pnpm balance`** | Untouched. No sim code, no `tuning.ts`, no unit JSON. | — |
| **`pnpm test:determinism`** | Cannot move. The golden replay *"builds its world directly and never calls `parseMap` or `applyTerrain`"*. Run it anyway; a moved hash means something else changed. | `packages/sim/src/determinism.test.ts:325–330` |
| **`?sandboxes` picker** | **Every variant will appear**, and that is not optional — see below. | `packages/app/src/ui/menu.ts:8, 313–316` |

### Should variants be hidden from `?sandboxes`?

**No, and they effectively cannot be without weakening two guards.** The picker
builds its list from `Object.keys(maps)`, and *two separate tests assert that
every map file on disk reaches it* — `sandbox-menu.test.ts` ("offers every map
shipped in `data/maps/`, so a new one needs no edit here") and
`terrain-parity.test.ts` (`MAP_IDS` deep-equals the on-disk ids). Both were
written specifically to kill hand-maintained map lists. Adding a `hidden: true`
field to the map schema and an exclusion to both tests would reintroduce exactly
the drift they exist to prevent, in exchange for a tidier menu.

The list grows from 11 entries to 24. If that becomes a real complaint, the
right fix is **grouping in the picker by town-id prefix** — derived from the ids,
not from a list, so nothing can go stale. That is an app-side change owned by
whoever owns `packages/app`, and it is not required for this work.

---

## 6. Open decisions for the lead

1. **How far to bend — pick a setting.** §2.3 measured three, all on the same
   leg (`start_line` → `approach`, base 20 tiles / 1 column):
   - **light** — 20 tiles, 5–7 columns. Vehicles dogleg, foot walks straight, no
     mission's clock moves at all.
   - **medium** *(this document's recommendation)* — 20–24 tiles, 7–9 columns,
     with a built line or wall run where the fiction supports one, so **foot
     bends too**.
   - **heavy** — 32 tiles, 14 columns. A 60% longer march. Real, and it will show
     up in `playtest`'s printed minutes on any mission with an endure-clock.

   Recommendation: **medium for vehicles, light for foot, heavy nowhere unless a
   briefing already promises hard ground.** The asymmetry is the point — a force
   whose armour and infantry take different roads is the game's best existing
   idea (Tel Marum's corridor, Umm Zeitoun's western horn), and it costs no
   mission a second of its clock.

2. **Does mission I of each town get a variant?** This document says: **Tel Marum
   yes** (valley floor only; the wall, the bay and the plateau are byte-identical,
   so nothing the recon exists to discover changes), **Beit Sahwan, Wadi Halam
   and Umm Zeitoun no** — in those three, mission I is where the player learns the
   ground, and every later variant then reads as the town *changing under him*,
   which is worth more than variety in the first mission. If the lead wants all
   four, Wadi Halam I is the cheapest (gallery fingers only, no route change).

3. **First Light's yard.** Recommendation: **no obstacles inside the wire.**
   Eight raid axes converging on a walled yard is the mission's shape, and cover
   inside the yard blocks the defenders' own fields of fire — the plan
   deliberately leaves every defender where it placed him. The available option,
   if the lead wants the ground less bare: a broken ring of `1`/`2` cover
   **outside** the wall at ~8 tiles, which gives the attackers bounds and the
   defenders a beaten zone. It would need measuring against the passive control
   before it ships, because giving the attackers cover is the one change that
   could turn a losable mission into an unwinnable one. `marj_perimeter` is not
   in the visual gate, so a variant there costs no bless.

4. **`beit_sahwan_3_clearance` and the `combat` scenario.** Moving that mission
   onto `beit_sahwan_3` changes the frame the report-only `combat` capture
   uploads. It does not vote and needs no bless. Accept the changed artifact, or
   leave mission III on the base map and take the variant at IV only?

5. **`wadi_halam_5_depot` — variant or not?** It is the only mission whose
   mechanical ceiling (300 s raze + 240 s hold = 9 minutes behind a declared 7)
   already exceeds its own declaration, and the plan clears it in 6.1 min only by
   razing fast. The change proposed here is deliberately the lightest in the set —
   spoil beside a road that is itself untouched, so the D9's march cannot grow.
   Author it, measure the march, and **drop it outright if the route moves by one
   tile**? Or leave mission V on the base map and take the town's variety from
   II–IV alone?

6. **`map.time_of_day` is a dead field.** The schema declares
   `dawn | day | dusk | night` and **nothing in `packages/` or `tools/` reads it**
   (censused 2026-09-06: zero hits for `time_of_day` or `timeOfDay` outside the
   schema). Tel Marum I is a night mission in its briefing and a day mission on
   screen. If the lead wants per-mission *variety* and not only per-mission
   *terrain*, lighting is a second axis that is already half-declared — but it is
   renderer work, and it belongs to `render-vfx` rather than to this document.
   Flagging it, not proposing it.

---

## Appendix — the census and the measurements behind this document

Run 2026-09-06 in `/Users/ilpinto/dev/roaring-lions-story`, branch
`feat/story-act-1`.

**Read:** `docs/campaign/README.md`; `docs/campaign/storyline.md` §3.1–3.4;
`docs/GDD.md` §2, §4, §6, §11; `docs/campaign/research-2026-09-03.md`;
`docs/superpowers/specs/2026-09-01-terrain-t1-design.md`,
`2026-08-22-rock-terrain-design.md`, `2026-08-24-tel-marum-map-design.md`;
`CLAUDE.md`.

**Censused:** all 11 files in `data/maps/`; all 18 in `data/missions/`;
`data/structures.json`; `data/schemas/map.schema.json` and
`mission.schema.json`; `data/campaign/world.json` (names missions, never maps —
so no `world.json` change is required); `packages/data/src/map.ts`
(`TERRAIN_LEGEND`, `applyTerrain`); `packages/data/src/index.ts` (the `maps`
registry); `packages/sim/src/flowfield.ts`, `sim.ts` (`moveDomain`, `BLOCK_RISE`,
`EYE_HEIGHT`), `civilians.ts`, `tuning.ts` (read only);
`packages/render/src/three/terrain/decor-place.ts`; `tools/validate_data.mjs`,
`validate_map_grid.mjs`; `tools/src/backtest/playtest.ts`;
`tools/src/tel_marum_doctrine.test.ts`, `umm_zeitoun_doctrine.test.ts`,
`qarn_hadid_relief.test.ts`; `tools/src/golden-diff/capture-protocol.ts`,
`baseline.ts`; `packages/app/src/terrain-parity.test.ts`, `mesh-catalogue.test.ts`,
`ui/sandbox-menu.test.ts`, `ui/menu.ts` (read only — not edited).

**Measured** with `FlowField.compute` over the real `blocked` /
`blockedVehicle` masks and the real elevation grid, walked with the same
`route()`/`pathOf()` shape as `tel_marum_doctrine.test.ts:195–213`, driven from a
scratch script outside the repo:

- the twenty base-map legs in §0, both domains, with direction counts;
- the tile census of all five campaign maps;
- the twenty-cell crest × saddle-offset table in §2.2, and the two negatives
  beside it (distant saddle, bowl) and the cover-blanket control;
- the six device rows in §2.3;
- the three Tel Marum variant drafts in §3.1, each measured on eight legs across
  both domains, plus the civilian legs — which is how the revetment fault under
  the [27.5,5.5] civilian spawn was found.

No file under `data/`, `packages/` or `tools/` was modified. The only file this
work created is this one.
