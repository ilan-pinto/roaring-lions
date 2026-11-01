# Mission Design Document: Act III in the rain (Wadi Halam on the `wetland` theme, GH-912)

**Date:** 2026-10-31. **Status:** design only, for the lead's pick. No mission JSON, no map JSON, no art.
**Written against:** `origin/main` at `a20f0dadf`. Every content claim below was censused this session and cites a
path. Every route number was measured this session through the real `parseMap`, `applyTerrain` and `FlowField` on
the shipped `ein_qasab` and on the two sketches in section 3 (the method is in section 9).
**Contract:** `docs/campaign/README.md`. **Story:** `docs/campaign/storyline.md`. **Theme:**
`docs/superpowers/specs/2026-10-28-rain-terrain-design.md` (GH-871).
**Downstream:** `narrative-designer` (names, briefings, `say` lines), then `level-scripter` (ECA rows, the twist
classification, the gap report), then `mission-author` (maps and missions), then `playtest`.

---

## 0. The short version

- **Recommended: Plot B, "The Flood Week".** Three missions, set in the winter between Wadi Halam III and Wadi
  Halam IV, run as a **second Naharin town, `ein_qasab`**:
  1. recon on the shipped Ein Qasab map;
  2. foothold on Jebel Matar (designed in the rain spec, section 5.4, and not yet built);
  3. buildup on one new map, the lower causeway (`ein_qasab_3`).
- **The idea in one line.** Rain closes the fords, so Jubran Hallaq moves his traffic onto the old marsh causeways.
  The marsh takes the wheels off the Rif, whose armour is mobility. For one week they cannot run, and nor can the
  brigade's Eitans.
- **Nothing shipped changes in Plot B.** Hallaq still dies at his gate in Wadi Halam V. Shai stays a Lieutenant
  Colonel all the way through.
- **Maps.** Ein Qasab is reused once, with additive markers and zones only. **Two new maps are needed**: Jebel
  Matar and `ein_qasab_3`. "One ground per mission" (GH-382, `tools/src/map_distinctness.ts`) rules out a second
  use of any map.
- **Engine and schema work.** One small gap is new: a town-level `unlock.after_mission` (G1). Without it, the new
  town opens the moment Naharin opens, before Wadi Halam I. Plot B also needs one `town` enum value and a
  `world.json` entry.
- **Two other plots** are in section 1:
  - **A, "After the Gate":** a coda after Wadi Halam V, with no villain left.
  - **C, "The Winter Road":** Hallaq's end is moved from his gate into the marsh. It is the strongest drama, and it
    is killed on cost.
- **The lead's questions** are in section 8, each with its recommendation first.

### 0.1 Facts the census forced (read before section 1)

1. **"Wadi Halam VI, VII" cannot go inside the Wadi Halam town.** It already holds five missions
   (`data/campaign/world.json`), and the contract allows 3–5 a town (`docs/campaign/README.md`). Inside that town,
   phases also ascend, so anything slotted between III (`buildup`) and IV (`clearance`) could only be a buildup or a
   clearance. A second Naharin town avoids both problems. Marj and Sur already have three towns each. Naharin has one.
2. **Every campaign mission plays on its own ground** (GH-382). A three-mission town needs three maps.
3. **Towns in a live region are open at the same time.** `missionOpen` and `nextMissionOf` are in
   `packages/app/src/campaign.ts`, and there is no town-level gate in `data/schemas/world.schema.json`. So today no
   board can *enforce* "between III and IV". G1 makes the town open *after* III. Section 1 says honestly what remains.
4. **Shai's rank is resolved by position in `world.json`** (`missionPosition` in `campaign.ts`; the ranks are in
   `data/campaign/commander.json`, with Lieutenant Colonel `until_mission: wadi_halam_5_depot`). A town listed after
   `wadi_halam` would show **Colonel** during the flood week. Plot B lists `ein_qasab` **before** `wadi_halam`.
5. **Hallaq dies at Wadi Halam V's gate, on screen.** That mission's `kill_gate_rpg.say` reads: "That is Jubran
   Hallaq, in his own gateway". `commander.json` holds the matching line: "Dead at the gate he would not leave". Any
   continuation after V either has no villain to end or must move his end. That is the difference between A and C.
6. **Rain and haze are presentation only** (spec section 7, approved). Haze is capped at 0.26, so that "rain must
   not visually hide what the sim lets the player see". **No decision in this document rests on visibility in the
   rain.** The mechanical "low visibility" is the reed bed:
   - `~` is cover 1 (`COVER_SIG` 0.75, `COVER_HIT` 0.375 in `packages/sim/src/tuning.ts`);
   - an ambush stance adds `AMBUSH_SIG` 0.5 on top.
7. **Wading costs a rifleman nothing.** `~` is `{ blocked: 0, boulder: 1, cover: 1 }` (`packages/data/src/map.ts`).
   The sim has no terrain speed term (the spec rejected mud speed). So the marsh is the *best* foot ground on the
   map: full speed, and cover 1 everywhere. The decision the marsh creates is **separating foot from wheels**, not
   slowing anyone down.
8. **The Rif are wheeled, and the brigade's transport is wheeled too.**
   - `technical`, `moto_rpg` and `gun_truck` default to wheeled, because their roles (`technical`, `aa`) are not in
     `FOOT_ROLES` (`packages/sim/src/sim.ts:392`).
   - `apc_eitan`, `ifv_namer`, `jeep_shoded` and `aa_remetz` are wheeled.
   - `drone_swarm`, `loiter_drone`, `recon_drone` and the helicopters are `domain: air`, so the marsh does not touch
     them.
   - Civilians are foot (`data/units/civilians.json`, role `support`), and `CivilianFlight` can `load` them into an
     APC (`packages/sim/src/civilians.ts`).
9. **The spec's revision-2 ruling "Free Play only at first, no campaign mission yet" is superseded** by the lead's
   GH-912 request (31 Oct). Ein Qasab stays out of the Free Play picker (`UNLISTED_MAP_IDS` in
   `packages/app/src/ui/menu.ts`) until its art is complete. A mission boots its map by file and does not need the
   listing.

---

## 1. Premise and plot options

**The premise, shared by all three plots.** The Fords (Wadi Halam I) are a summer road. When the winter rains come,
the wadi runs and the fords close. Downstream, the valley floor drowns into reed marsh, which the corridor's people
have always crossed on two old causeways. Hallaq does not stop for weather. He moves the stock onto the causeways.
Where the trucks cannot go, he puts the people of the marsh hamlets under the loads, so the carriers become the
wheels he lost. The fight is on the theme's one mechanic: **wheels keep to the causeways, and feet go anywhere,
in cover.**

### Plot A: "After the Gate" (a coda after Wadi Halam V)

| | |
|---|---|
| Where | After Wadi Halam V. A new town after `wadi_halam`, opened by G1 `after_mission: wadi_halam_5_depot`. |
| Count | **3**, the town minimum. Recon (Ein Qasab), foothold (Jebel Matar), clearance (`ein_qasab_3`). |
| Shai | Colonel throughout. The promotion already happened at V, and nothing moves. |
| The decision | **Restraint with nobody left to blame.** Hallaq is dead. What is left are leaderless cells on the winter road, and families on the brigade's side of the marsh who want to go home. The evacuations run **backwards**: `evacuate_before`'s refuge is the hamlet, across the marsh. The last mission has no HVT. Its failable primary is getting the families home, under the highest `fail_below` in the campaign (60, against 40–45 elsewhere). |
| Villain's end | None. **This breaks the contract's villain rule** (one per front, ended in the front's last mission), because the front's last mission would no longer be the one in which he ends. |
| What it costs | No shipped line moves, but V's `aftermath` ("The corridor is cut… Ari Actual") now plays three missions before the war ends. Read honestly, Plot A is the shipped ending's Option 2 ("The Quiet Ground", `storyline.md` section 5) *played* rather than narrated. O9 is the lead's to reopen. |

### Plot B: "The Flood Week" (interleaved in the winter, between III and IV), RECOMMENDED

| | |
|---|---|
| Where | Between Wadi Halam III and IV, in the "only quiet week of the war" that III's defeat debrief names. A new town listed **before** `wadi_halam` in Naharin (so it reads Lieutenant Colonel), opened by G1 `after_mission: wadi_halam_3_counterraid`. |
| Count | **3**: recon, foothold, buildup. A 2-mission version exists only *inside* the Wadi Halam town (section 8, Q2), and it is not recommended. |
| Shai | Lieutenant Colonel on entry and exit. No promotion. |
| The decision | **Wheels or feet, three ways.** Recon asks how to reach the carriers: by the Eitan along the ambushed causeway, or on foot through the reeds. Foothold asks where to dig in: in the blind hollow (the hold zone), or on the crest that sees. Buildup asks **what to buy when every vehicle has one road**, and where to put the stop on a lieutenant whose only escape road runs through a protected hamlet. |
| Villain's end | Not here. Hallaq ends at V as shipped. The town's last mission ends **his man on the winter road**: a new tagged HVT, as WH III's `wh_hvt_amir` and WH IV's `wh_hvt_cache` are. Hallaq is present by what he does: the carriers, the drone crates in a farm barn, and the stock whose manifests point Idit at the depot. |
| What it costs | G1 (a town unlock), one `town` enum value, and one `world.json` entry. No shipped mission, line, rank or pin changes. **Honest limit:** after G1 the town opens after III, but the board still lets the player go straight to IV and V. Text in B must read correctly in either order, as Khan Rafid and Deir Amun already do beside Beit Sahwan. |

### Plot C: "The Winter Road" (Hallaq's end moved into the marsh)

| | |
|---|---|
| Where | After Wadi Halam V. A new town after `wadi_halam`, opened by G1 `after_mission: wadi_halam_5_depot`. |
| Count | **3**: recon, foothold, clearance. |
| Shai | Lieutenant Colonel, then **Colonel at C-III**. `commander.json` Lieutenant Colonel `until_mission` moves from `wadi_halam_5_depot` to `ein_qasab_3_clearance`. |
| The decision | The finale's only road. Hallaq is in the causeway village. At 40% casualties he runs for the north exit on the one wheeled road, through the protected hamlet. **Where do you put the stop**: on the lip beyond the hamlet (foot only, sent early, across the reeds), or in the hamlet (Conduct)? |
| Villain's end | `eliminate_hvt`, "kill or capture" (prisoners are GH-18, M2), on the causeway. The smuggler is stripped of his road by water. |
| What it costs | Re-briefing shipped Wadi Halam V: its `kill_gate_rpg.say` names Hallaq at the gate, and his two `commander.json` lines name the gate. Moving the `aftermath` and the Colonel promotion line. Re-running V's narrative checks. Rewriting the act's finest beat ("he would not walk twenty tiles east to leave it"). |

### Recommendation: Plot B

1. **It puts the rain where the theme's season and the story already have room.** The theme is the late-winter flush
   (spec revision 3). Wadi Halam III's defeat debrief already names a quiet week.
2. **It gives Act III's stated problem a week where the problem goes away.** Wadi Halam II's Idit: "mobility is their
   armour". Wadi Halam III's briefing: "a mobility problem, not a firepower one". On `wetland`, the Rif's technicals,
   motorcycles and gun trucks are confined to causeways and tracks. Every mission in B turns on that, and so does
   the player's own transport.
3. **It touches nothing shipped.** No line, rank, aftermath, playtest pin or villain line moves. The cost is one small
   app/schema gap.
4. **It makes recon pay.** Two carrying secondaries (EQ I, EQ II) are read by EQ III's ambushes, so the first two
   missions can reach three stars. Act III's recon missions cap at two today (`docs/campaign/README.md`, "The third
   star").

### Killing my own favourite

My favourite is **C**: the smuggler caught on the one road the rain left him. Kill it, and B keeps the mechanic.
EQ III's lieutenant has the same single escape road through the same protected hamlet, and the player makes the same
stop decision. Wadi Halam V keeps the gate line. What B loses is the villain's face at the end of the rain. That is
a narrative loss, not a mechanical one, and V already pays it off. **B survives without C.**

---

## 2. Place in the global storyline (Plot B)

| | |
|---|---|
| Act | III, Naharin, Rif Cells, *"can you stop?"* (`storyline.md` section 1) |
| Board | Region `naharin`. New town `ein_qasab`, listed first in `towns`, gated by G1 on `wadi_halam_3_counterraid`. |
| Shai, on entry and exit | Lieutenant Colonel (4 stars) and Lieutenant Colonel. No promotion mid-act, and none in this town. |
| Idit's thread | **The count.** EQ I: how many carriers are on the causeways and who covers them (`locate` count, plus the carrying `eq_reed_cell`). EQ II: the crates in the barn, and the truck at the saddle she wants marked (`eq_saddle_truck`, carrying). EQ III: the stock's manifests, which name the yard east of the village (the hook into Wadi Halam IV and V). She never orders. She prices what knowing costs: a drone sweep of the dead ground behind the lip is 150 Intel. |
| Hallaq's atrocity, echoed | Shipped: WH I tells it (the hamlet that stopped carrying), WH IV shows it. Here: when the fords flood he puts **people under the loads**. EQ I's failable primary is getting the carriers off the causeways. |
| Hallaq's presence | Never on the map. He is the carriers (EQ I), the drone crates beside a family (EQ II), and the stock and its manifests (EQ III). |
| His end | Wadi Halam V, unchanged. |
| The town's HVT | `eq_hvt_ferryman`, "Hallaq's man on the winter road". He works the causeways and dies or is taken in EQ III. The name is the narrative-designer's, screened under `storyline.md` section 2.4. |
| Ledger, in | `roster.surviving_units` from Wadi Halam III, the survivors of the counter-raid. |
| Ledger, out | `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions`, `campaign.mission_results`, `intel.marked_positions` (EQ I and EQ II), `civ.settlements_evacuated` (EQ I). Wadi Halam IV requires only the roster (`data/missions/wadi_halam_4_village.json`), so nothing downstream must change. |

---

## 3. Map overview

**Theme on all three:** `terrain: wetland` (`data/schemas/map.schema.json` enum). Rain belongs to the theme
(`TERRAIN_WEATHER` in `packages/app/src/terrain-themes.ts`), so every mission below is played in rain. Naharin has
no `REGION_BIOME` entry (`tools/validate_biome.mjs`, `{ sur: 'highland' }` only), so a wetland map is legal in a
Naharin mission.

| Map | Status | Mission (B) | Grid | Elevation | Built | `~` tiles |
|---|---|---|---|---|---|---|
| `ein_qasab` | **PRESENT**, `data/maps/ein_qasab.json`. Reused with additive markers and zones only; its rows are guarded by `tools/src/ein_qasab_marsh.test.ts` | EQ I recon | 48×48 | 0–4 | 1.7% | 311 |
| `jebel_matar` | **NEW**, from the spec's section 5.4 brief, re-sketched here for the mission | EQ II foothold | 48×48 | 0–5 | 1.2% | 70 |
| `ein_qasab_3` | **NEW**, "the lower causeway" (working name; `narrative-designer` screens it) | EQ III buildup | 48×48 | 0–5 | 1.3% | 370 |

**Distinctness, measured** (`compare` in `tools/src/map_distinctness.ts`, every shipped map, all eight orientations;
gates are feature 35% and elevation-within 80%):

| Map | Highest feature identity | Highest elevation-within | Verdict |
|---|---|---|---|
| `jebel_matar` | 5.5% (`ein_qasab`) | **75.9%** (`wadi_halam_4`) | passes, with a 4-point margin |
| `ein_qasab_3` | 10.3% (`ein_qasab`) | **76.7%** (`wadi_halam_4`) | passes, with a 3-point margin |

**Both new maps were redrawn by this gate.**
- The first Jebel Matar relief (north downs 1, south 1) read 84.4% against `wadi_halam_5`. A second (north 2) read
  80.8% against `beit_sahwan_2`.
- The first `ein_qasab_3` (lip at 3) read 96.9% against `ein_qasab`.

The margins are thin. `mission-author` must re-run `map_distinctness` after any elevation edit.

### 3.0 How the rain and the marsh change the decisions

| Effect | Rule (cited) | What it does to a decision | Measured on these maps |
|---|---|---|---|
| **Vehicles are road-bound** | `~` sets the vehicle mask (`TERRAIN_LEGEND['~']`, `map.ts`), and so do `b` and `d` | Each map's wheeled routes are a handful of tiles the enemy can predict: two causeways (EQ I), one dyke gap and one saddle (EQ II), one causeway (EQ III). A vehicle on a causeway cannot leave it. | EQ I: `kdf_start` to the hamlet by wheel is 39 steps, 0 marsh, 13 causeway or track tiles. EQ III: a vehicle **cannot reach either island** (no route), and every vehicle route crosses the causeway (21 road tiles). |
| **Infantry wade** | foot mask open on `~`, no speed term | Foot goes straight across, in cover, and arrives without its vehicles' fire. The marsh separates the force more than it slows it. | EQ I: `kdf_start` to the hamlet on foot is 37 steps, 6 of them marsh. EQ III: the camp to the west island is 16 steps on foot. |
| **Low visibility** | Haze is presentation only, ≤ 0.26 (spec 4.5, 7); reeds are cover 1; ambush 0.5 | **Nothing rests on the haze.** What hides men is the reed bed. A militia cell in `ambush` in the reeds beside a causeway is the theme's signature contact. Recon must find it with a drone (thermal) or a sniper (thermal, sight 16) before a vehicle drives past it. | — |
| **The Rif lose their doctrine** | `technical`, `moto_rpg`, `gun_truck` are wheeled | "Disperse on contact" (WH I) needs ground to disperse over. Here a withdrawing technical drives back onto the causeway, often through its own carriers. | EQ I: riders from the east edge reach either causeway in 25 steps by wheel. |
| **Drones are untouched** | `domain: air` | A drone swarm does not care about the marsh, and the Remetz laser that answers it is wheeled. That is a twist candidate (T-B4), not a base design. | — |
| **Civilians wade and can ride** | `civilians` is a foot role; `CivilianFlight` queues `load` | Carriers can be walked out through the reeds (slow, in cover), or picked up by an Eitan on the causeway (fast, but where the ambush is). | EQ I: the hamlet to the refuge is 39 steps on foot (9 marsh) or 41 by wheel (17 causeway or track). |

**Relief, and what it decides** (the lead: relief must decide something or stay at the edges):
- **Ein Qasab.** The west ridge (level 4) overwatches the whole floor, and the east crest (2) hides the hamlet's
  approach (spec 5.3).
- **Jebel Matar.** The relief decides **sight**. The hold zone lies in a level-0 hollow under two level-4 crests, so a
  raider on the level-1 north downs is three levels below the crest and invisible from the farm. The relief does not
  reorder the foot routes: the flat control gives the same 25 steps from `rif_nw`. It is not dressed up as doing so.
- **`ein_qasab_3`.** The lip (5) stands two levels above its reverse slope (3), so the escape road and the reserve
  are in dead ground from everything south of the hamlet.
- **Elsewhere.** The north-east crag and the north-west boulder bands are edge relief.

Every open step on both sketches is at most 1 level a tile, and every building stands on one level (measured: 0
violations).

### 3.1 `ein_qasab`: reused for EQ I

The grid is shipped (`data/maps/ein_qasab.json`; bands in spec 5.3; the as-built table is in
`docs/agent-notes/maps-and-terrain-design.md`):
- the west ridge with basalt crags, oak copses and a boulder skirt;
- a reed marsh 5–8 tiles wide running the full height;
- **two causeways** at y 12 and y 34 (x 13–37, level 1);
- the east downs with a 2-level crest at x 38–40, and the walled hamlet (four houses) at (42, 22).

**Additions** (additive only; `rows` and `elevation` untouched, so `ein_qasab_marsh.test.ts` and the
`high_ground_maps` `RISES` entry stay as they are):

| id | kind | value | why |
|---|---|---|---|
| `wounded_evac` | marker | (2, 46) | every mission's loaned medic needs one (`tools/src/medic_every_mission.test.ts`) |
| `civ_refuge` | marker | (5, 46) | `civilians.refuge` |
| `rif_ne` | marker | (47, 5) | wave entry north-east (open, wheels reach `causeway_n` in 25 steps) |
| `rif_se` | marker | (47, 40) | wave entry south-east (wheels reach `causeway_s` in 25 steps) |
| `refuge` | zone | [0, 44, 10, 4] | `evacuate_before` target (all open tiles) |
| `hamlet` | zone | shipped [41, 19, 7, 7] | flagged for Conduct |

The shipped markers `kdf_start` (4, 44), `causeway_n` (22, 12), `causeway_s` (22, 34), `hamlet` (42, 22) and
`east_crest` (39, 10) are used as they are.

### 3.2 `jebel_matar`: new, for EQ II ("Rain Hill", the wet downs)

**Shape.**
- A farm in a level-0 hollow (y 16–28), between a level-4 north crest (y 9–12) and a level-4 south crest (y 32).
- The north crest has a level-5 shoulder at x 18–27, and a level-2 saddle at x 32–36 with the north track through it.
- A summit (level 5) at (8, 6).
- A boulder band (`b`, foot only) on the north flank, x 13–30, y 4–7. It costs a wheeled raider from the north-west
  8 tiles: 33 steps against 25 for the no-boulder control.
- **A basalt dyke `^`**, two tiles thick, running from the south edge (x 25) to the east edge (y 26). It has one
  vehicle gap at (37–38, 35) and two `b` rubble crossings that are foot only.
  - It adds no distance on the east raid line (23 steps with or without it).
  - What it does is put **every eastern wheel through one 2-tile gap**.
- Three marsh pockets (70 tiles) close the hollow to vehicles off the track.
- The farmstead: a house, a barn (`w`), and a walled yard with its gate at x 24. Built share is 1.2%.

```
   0         1         2         3         4
   012345678901234567890123456789012345678901234567
00 ..................................r.............   north downs, level 1 (rif_n at 34,0; rif_nw at 20,0)
01 ..ooooo...........................r.............
02 ..ooooo...........................r.....ooooo...
03 ..ooooo...........................r.....ooooo...
04 .............b.bb.bb.bb.bb.bb.b...r.....ooooo...   boulder band: foot only, wheels lose 8 tiles
05 .......^^^...bbbbbbbbbbbbbbbbbb...r.............   summit crags at (7-9,5)
06 .......^.....bbbbbbbbbbbbbbbbbb...r.............
07 .........^^..b.bb.bb.bb.bb.bb.b...r.............
08 ..................................r.............
09 ..................................r.............   north crest, level 4 (shoulder 5 at x18-27)
10 ..........^^^^^...................r.............
11 ..................................r.....^^^^^...   saddle x32-36 at level 2
12 ..................................r.............
13 ..................................r.............
14 ..................................r.............
15 .................................r..............
16 ................................r...............   hollow, level 0, from here
17 ...............................r................
18 ....11111.....................111111....111111..
19 ...........~~~................r.................
20 ..........~~~~~.....====.====.r.................   the farm: house (21-22), barn (26-27), yard wall
21 ..........~~~~~.....=hh...ww=.r.................
22 .........~~~~~~~....=hh...ww=.r.................
23 ..........~~~~~.....====.====.r...~~~...........
24 ..........~~~~~.........rrrrrrr..~~~~~..........
25 ...........~~~..........r.......~~~~~~~.........
26 ................~~~~....r........~~~~~........^^   the dyke reaches the east edge
27 ..222222.......~~~~~~...r.....r...~~~.222222.^^.
28 ................~~~~....r......r............^^..
29 ........................r.......r..........bb...   rubble crossing (foot only)
30 ........................r........r........bb....
31 ........................r.........r......^^.....
32 ........................r..........r....^^......   south crest, level 4 (notch at x22-26, level 3)
33 ........................r...........r..^^.......
34 ........................r......ooooo.r^^........
35 ........ooooooo.........r......ooooo..rrrrrrrrrr   dyke gap (37-38,35); rif_e at (47,35)
36 ........ooooooo.........r...........^^..........
37 ........ooooooo.........r..........^^...........
38 ........................r.........^^............
39 ....11111111..111111....r........^^.............
40 ........................r.......bb..............   rubble crossing (foot only)
41 ........................r...222222..............
42 ........................r.....^^................
43 ........................r....^^.................
44 ....111111..............r...^^......11111111....
45 ........................r..^^...................   kdf_start (24,45), level 3
46 ........................r.^^....................
47 ........................r^^.....................
```

<details><summary>Elevation (one digit a tile)</summary>

```
00 111111111111111111111111111111111111111111111111
01 111111111111111111111111111111111111111111111111
02 111111111111111111111111111111111111111111111111
03 111112222222111111111111111111111111111111111111
04 111112333332111111111111111111111111111111111111
05 111112344432111111111111111111111111111111111111
06 111112345432111111111111111111111111111111111111
07 222222344432222222222222222222222222222222222222
08 333333333333333333333333333333332222233333333333
09 444444444444444444444444444444432222234444444444
10 444444444444444444555555555544432222234444444444
11 444444444444444444555555555544432222234444444444
12 444444444444444444555555555544432222234444444444
13 333333333333333333444444444433332222233333333333
14 222222222222222222333333333322222222222222222222
15 111111111111111111222222222211111111111111111111
16 000000000000000000111111111100000000000000000000
17-28 all 0
29 111111111111111111111111111111111111111111111111
30 222222222222222222222222222222222222222222222222
31 333333333333333333333333333333333333333333333333
32 444444444444444444444433333444444444444444444444
33-47 all 3
```
</details>

**Markers:**

| id | at |
|---|---|
| `kdf_start` | (24, 45) |
| `wounded_evac` | (20, 45) |
| `farm` | (24, 25) |
| `north_summit` | (8, 8) |
| `shoulder` | (22, 13) |
| `north_saddle` | (34, 11) |
| `south_saddle` | (24, 32) |
| `dyke_gap` | (37, 35) |
| `rif_n` | (34, 0) |
| `rif_nw` | (20, 0) |
| `rif_e` | (47, 35) |

**Zones:**

| id | rect | what it is |
|---|---|---|
| `hollow` | [17, 18, 15, 10] | the hold |
| `barn_yard` | [26, 21, 2, 2] | the barn only. `raze` must not count the yard walls, each of which is its own structure. |
| `farmhouse` | [20, 20, 5, 4] | flagged |
| `north_saddle` | [31, 9, 7, 5] | |
| `north_crest` | [4, 9, 40, 4] | |

**Measured routes** (steps; foot / vehicle):

| From | To | Foot | Vehicle | Notes |
|---|---|---|---|---|
| `kdf_start` | `farm` | 20 | 20 | |
| `rif_nw` | `farm` | 25 | 33 | the boulders |
| `rif_n` | `farm` | 25 | 25 | |
| `rif_e` | `farm` | 23 | 23 | through the gap |

**New pins for `mission-author`:**
- `high_ground_maps` `RISES` (crest band, shoulder, summit; read on first run);
- a doctrine test with three checks, each against its own control:
  - the eastern wheels pass the dyke gap (dyke flattened);
  - the north-west wheel route is +8 (boulders flattened);
  - the hollow is dead ground from the north downs (an LOS walk).

### 3.3 `ein_qasab_3`: new, for EQ III ("the lower causeway")

**Shape.** Downstream of Ein Qasab, the valley floor is a broad fen running west to east (y 17–31):
- **two full-width marsh channels** (y 17–19 and y 29–31), with tussock islands between them that are reachable on
  foot only;
- **one causeway** (x 24, level 1 over the channels) crossing to an islet with a mill (`p`, the `pump_house` type);
- marsh meanders at x 17–18 and x 30–31, which keep the wheels on the islet (`mill_islet`, the passing place).

**North bank:**
- a lower terrace (level 2) with the stock barn and its walled yard at the causeway head;
- the hamlet terrace (level 4): four low houses, flagged;
- **the lip** (level 5, y 4–7), with the reverse slope behind it at level 3, which is **dead ground**;
- the escape track up x 18 to `north_exit` (18, 0). It runs through the flagged hamlet zone, so **his only road out
  is the protected one**;
- a basalt crag at the north-east corner (edge relief) and a boulder band on the reverse slope.

**South bank:** level 0 to 2, with the camp (a mission `structures[]` entry at (8, 40), not a map tile; WH III and
UZ II do the same) and the supply road along y 40 from the west edge.

```
   0         1         2         3         4
   012345678901234567890123456789012345678901234567
00 ..................r..........................^^^   reverse slope, level 3 (north_exit 18,0; rif_n 30,0; rif_nw 10,0)
01 ..................r...bbb.bbb.bbb.bb........^^^^
02 ..................r...bbbbbbbbbbbbbb........^^^^   boulders on the reverse slope: foot only
03 ..................r...b.bbb.bbb.bbb........^^^^^
04 ..................r........................^^^^^   the lip, level 5, y4-7
05 ....22222...22222.r..................2222.^^^^^^
06 .....oooooo.......r.................oooo..^^^^^^
07 .....oooooo.......r.................oooo........
08 ..................r.............................   hamlet terrace, level 4
09 .........hh.......r........hh..hh..hh...........   four houses (flagged zone `hamlet`)
10 .........hh.......r........hh..hh..hh...........
11 ..111111..........rrrrrrr.11111111111111........   terrace riser, level 3
12 ...................====.r.......................   lower terrace, level 2: stock barn + yard
13 ...................=ww..r.......................
14 ...................=ww..r.......................
15 ........................r.......................
16 ........................r.......................   causeway head
17 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~   north channel (causeway at level 1)
18 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~
19 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~
20 ...oooo..........~~.....r.....~~....~...........   west island | islet (wheels) | east island
21 ...oooo.~........~~.....r.....~~..~~~~~.........
22 ......~~~~~.1111.~~.....r.....~~....~...........
23 .....~~~~~~~.....~~..pp.r.....~~........~.......   the mill (21-22,23-24)
24 ..111.~~~~~......~~..pp.r.....~~......~~~~~.....   reed_w (0,24) / reed_e (47,23)
25 ........~........~~.....r.....~~.....~~~~~~~....
26 ............~....~~.ooo.r.....~~.1111.~~~~~.....
27 ..........~~~~~..~~.ooo.r.....~~........~.oooo..
28 ............~....~~.....r.....~~..........oooo..
29 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~   south channel
30 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~
31 ~~~~~~~~~~~~~~~~~~~~~~~~r~~~~~~~~~~~~~~~~~~~~~~~
32 ........................r.......................   south landing, level 0
33 ........................r.......................
34 ........................r.......................
35 ........................r.......................
36 ..111111................r...11111111....111111..
37 ........................r.......................
38 ........................r.......................   south bank, level 2
39 ........................r.............oooooo....
40 rrrrrrrr..rrrrrrrrrrrrrrr.............oooooo....   supply road; camp structure at (8,40) 2x2
41 ......................................oooooo....
42 ................................................
43 ..oooo........................22222222..........
44 ..oooo..........................................   kdf_start (8,44)
45 ..oooo..........................................
46 ................................................
47 ................................................
```

<details><summary>Elevation (one digit a tile)</summary>

```
00-02 all 3
03    all 4
04-07 all 5   (the lip)
08-10 all 4   (the hamlet terrace)
11    all 3
12-14 all 2   (the lower terrace, the barn)
15-16 all 1
17-19 0 everywhere except x24 = 1 (the causeway)
20-28 all 0   (islands and islet)
29-31 0 everywhere except x24 = 1
32-36 all 0
37    all 1
38-47 all 2
```
</details>

**Markers:**

| id | at |
|---|---|
| `kdf_start` | (8, 44) |
| `wounded_evac` | (4, 41) |
| `causeway_foot` | (24, 34) |
| `causeway_head` | (24, 13) |
| `mill` | (23, 25) |
| `stock` | (22, 13) |
| `hamlet` | (31, 12) |
| `north_exit` | (18, 0) |
| `lip_w` | (14, 6) |
| `rif_n` | (30, 0) |
| `rif_nw` | (10, 0) |
| `reed_w` | (0, 24) |
| `reed_e` | (47, 23) |
| `south_landing` | (24, 36) |
| `supply_entry` | (0, 40) |

**Zones:**

| id | rect |
|---|---|
| `causeway_head` | [19, 11, 10, 6] |
| `stock_yard` | [20, 13, 2, 2] (the barn only) |
| `hamlet` | [8, 8, 30, 4], flagged |
| `mill_islet` | [19, 20, 11, 9] |
| `south_landing` | [20, 32, 9, 6] |
| `lip` | [4, 4, 38, 4] |

**Measured routes** (steps):

| Route | Domain | Steps | Notes |
|---|---|---|---|
| camp exit (10, 41) to `causeway_head` | vehicle | 33 | against 28 for the no-marsh control; 21 road tiles |
| the same | foot | 28 | 3 marsh |
| camp exit to the mill islet | vehicle | 22 | |
| camp exit to the west island | vehicle | **no route** | |
| the same | foot | 16 | |
| `causeway_head` to `north_exit` | vehicle | 13 | his escape |
| `kdf_start` to `north_exit` | foot | 44 | 15 of them marsh; the stop's walk |
| `reed_w` to camp exit | foot | 17 | 3 marsh; a reed cell reaches the camp's door |
| `reed_w` to the supply road (4, 40) | foot | 16 | the cut |
| `reed_e` to `south_landing` | foot | 23 | |

**Decor budget, flagged.**
- The fen has **370 marsh tiles against Ein Qasab's 311**.
- At the lead's three reed clumps a tile (GH-871, 30 Oct), the reeds are the largest single decor load.
- `decorPlacements` must be run against the 0.9 M placed-triangle ceiling (spec section 3) before the map is
  committed.
- If it is over: narrow each channel from 3 rows to 2 (−96 tiles). That keeps the barrier and the island
  geometry.

**New pins for `mission-author`:**
- `RISES` (the lip, the hamlet terrace);
- a doctrine test with three checks, each against a control:
  - no vehicle reaches either island;
  - every vehicle route south to north crosses the causeway (marsh flattened);
  - the reverse slope is dead ground from the hamlet terrace's south edge (an LOS walk);
- a water-share guard like `ein_qasab_marsh.test.ts`, so that the 0.25–0.35 band holds on this realisation.

### 3.4 The backdrop kit on the wet maps

`art/meshes/backdrop/wadi_halam_kit.glb` (source `art/src/backdrop/wadi_halam_kit.blend`) is PRESENT and placed on
`wadi_halam_4` only: its `backdrop` block has `kit: wadi_halam_kit`. It is a limestone valley with terraces, olive
rows and red-roofed hamlets (`_coord/wadi-halam-look/kit-spec.md`).

**Recommended: place the same kit on all three wet maps.** These valleys are Wadi Halam's own floor in winter, and
the walls should be the same walls. Layouts come from `pnpm backdrop:layout` (`tools/backdrop/layout_cli.py`), on
each map's far sides only.

**Open, and the lead's call (Q6):**
- the kit's one atlas was baked for the `green` light;
- under `rainLight` (sun ×0.46, fill 1.35, haze `overcast.1`) it has never been seen;
- a wet atlas variant would be Blender-only work (`blender-art`), with no Meshy call.

### 3.5 Visibility

Built share is 1.2–1.7%, and no building stands on a main route. Each map still needs
`npx tsx tools/src/map_visibility.ts --draw=<id>` from its objectives once it is in `data/maps/`
(`tools/src/map_visibility.test.ts` gates every campaign map at 84%). It cannot be run on a scratch file, so it is
not claimed here.

---

## 4. Mission ladder (Plot B)

Ledger keys, verbatim:
- **R** `roster.surviving_units`
- **M** `roe.mission_ratings`
- **C** `campaign.completed_missions`
- **X** `campaign.mission_results`
- **I** `intel.marked_positions`
- **E** `civ.settlements_evacuated`

All six exist in shipped missions (`jq` census of `data/missions/*.json`). None is new.

| # | id (name, working) | phase | target_minutes | time_limit_s | primaries (type · target) | secondaries | ledger requires / produces | economy |
|---|---|---|---|---|---|---|---|---|
| I | `ein_qasab_1_recon` (Ein Qasab I, Reed Spring) | recon | 6 | 720 | `locate` · count 4; **`evacuate_before` · `refuge`, count 3, 300 s (failable)** | `locate` · `eq_reed_cell` (**carries**, read by III) | R / R M C X I E | n |
| II | `ein_qasab_2_foothold` (Ein Qasab II, Rain Hill) | foothold | 7 | 840 | `hold_for` · `hollow`, 300 s; **`raze` · `barn_yard`, 300 s (failable)** | `locate` · `eq_saddle_truck` (**carries**, read by III) | R I / R M C X I | y (field works only: one outpost) |
| III | `ein_qasab_3_buildup` (Ein Qasab III, The Long Causeway) | buildup | 7 | 840 | `eliminate_hvt` · `eq_hvt_ferryman`; `hold_for` · `causeway_head`, 240 s; **`raze` · `stock_yard`, 330 s (failable)** | `capture` · `mill_islet`, 15 s | R I / R M C X | y (camp, production, supply corridor) |

**How the ladder is built:**
- **Phases ascend:** recon, then foothold, then buildup.
- **Every objective type is among the nine** the runtime runs (`SUPPORTED`, `packages/sim/src/mission.ts:669`).
- **Every mission has exactly one failable primary**, which is the Act III shape (`storyline.md` D16).
- **No passive player wins any of them.** The passive control loses EQ I at 300 s (the carriers are never
  shepherded), and EQ II and III when the barn or the stock still stands.
- **Each `time_limit_s` is twice `target_minutes`, at least 60 s clear of every primary deadline** (the latest is
  EQ III's 330 s against 840).

---

## 5. Per mission (Plot B)

### 5.1 EQ I: `ein_qasab_1_recon`, recon, 6 min, on `ein_qasab`

**Player starting state.** The player starts at `kdf_start` (4, 44), with no `resources` block. Intel is earned by
identifications at 8 each.

| unit | count | at | source |
|---|---|---|---|
| `recon_drone` | 1 | (4, 42) | loan (gate ROE 70) |
| `sniper_team` | 1 | (3, 43) | loan (gate ROE 80) |
| `jeep_shoded` | 1 | (6, 43) | issued |
| `inf_squad` | 2 | (5, 45) | `from_ledger` |
| `at_team` | 1 | (3, 45) | `from_ledger` |
| `apc_eitan` | 1 | (7, 44) | `from_ledger` |
| `inf_medic_squad` | 1 | (2, 44) | loan (PR 905/908) |

No Namer: the point is that vehicles are a liability here.

**Enemy** (faction `rif`, doctrine "pinned to the causeways"). Six tagged positions. The picture needs four.

| tag | unit | at | stance | notes |
|---|---|---|---|---|
| `eq_reed_cell` | `militia_cell` | (21.5, 35.5) `~` | ambush 3 | in the reeds beside `causeway_s`, where the carriers stand; the carrying secondary |
| `eq_causeway_rpg` | `rpg_team` | (24.5, 13.5) `~` | ambush 4 | beside `causeway_n`; also carried into III by the picture |
| `eq_crest_truck` | `gun_truck` | (39.5, 9.5), level 2 | hold_position, group `crest` | AA role: denies the drone the north-east third |
| `eq_track_patrol` | `technical` | patrols (39.5, 14.5) to (39.5, 32.5) on the east track | patrol, group `track` | |
| `eq_hamlet_cell` | `militia_cell` | a hamlet house, (42.5, 20.5) | garrison | inside the flagged zone |
| `eq_copse_watch` | `militia_cell` | (10.5, 16.5), oak copse | hold_position | the first contact, on the brigade's own bank |

**Waves.** The cadence in words: a rider pair about every 50 s from the east edge, and every one of them comes
down onto a causeway, because that is the only place the wheels can go.

| at | units | from | to |
|---|---|---|---|
| 100 s | `moto_rpg` ×2 | `rif_ne` | `causeway_n` |
| 150 s | `technical` ×1 | `rif_se` | `causeway_s` |
| 200 s | `moto_rpg` ×2 | `rif_se` | `hamlet` |
| 250 s | `moto_rpg` + `technical` | `rif_ne` | `causeway_n` |
| 300 s | `moto_rpg` ×2 | `rif_se` | `causeway_s` |

**Triggers:**
- `zone_entered(hamlet)` → `commit` group `track` to `hamlet` ("The track patrol turns for the hamlet").
- `casualties_pct(50)` → `withdraw_to` group `track` to `rif_se` ("Riders pull back onto the causeway"). The
  withdrawal route by wheel is the south causeway.

**Civilians:**
- `refuge: civ_refuge`;
- 2 at (44.5, 22.5) in the hamlet yard;
- 2 at (31.5, 34.5) **on `causeway_s`, carrying**.

**ROE:** enabled, `flagged_zones: ["hamlet"]`, no `fail_below` (the recon precedent, WH I).

**The player's decision: the carriers, by wheel or on foot.**
- **By wheel.** The Eitan reaches the causeway carriers fastest and can load them. It drives past `eq_reed_cell`'s
  ambush, unseen in cover 1 and ambush 0.5, and the carriers stand danger-close to any fire on the cell.
- **On foot.** Infantry wade 6 marsh tiles to the hamlet in cover, and walk the families 39 steps home through the
  reeds. That is slow, and it uses squads the picture also needs.
- **Finding the cell first.** The sniper on the west ridge (level 4, sight 16, thermal) can see the whole floor. The
  drone cannot overfly the crest truck's 11-tile reach.
- **The pay-off.** Marking `eq_reed_cell` and `eq_causeway_rpg` here is what disarms EQ III's causeway ambushes.

**Twist candidates** (for `level-scripter` to classify):
- **T-A1 "They cannot run."** The 50% withdrawal drives the technicals back along the causeway the carriers are on.
  Expressible today (`withdraw_to` and the vehicle mask).
- **T-A2 "The carriers are the cover."** The reed cell holds fire until a KDF unit is within 3 tiles of the carriers.
  It is the ambush radius, keyed to where the civilians stand. Expressible today.
- **T-A3 "The north causeway goes under."** At `timer_s(240)`, `causeway_n` floods to `~` and the wheels have one
  road. Engine work: no trigger action changes terrain (G6).

**Story hooks** (for `narrative-designer`):
- the carriers as Hallaq's lost wheels;
- Idit's count ("four on the south causeway, and every load is a family");
- the line that this is the first time in the act the Rif *cannot* disperse;
- Shai's restraint beat on the evacuation.

### 5.2 EQ II: `ein_qasab_2_foothold`, foothold, 7 min, on `jebel_matar`

**Player starting state.** The player starts at `kdf_start` (24, 45).

| unit | count | at | source |
|---|---|---|---|
| `apc_eitan` | 1 | (23, 44) | `from_ledger` |
| `ifv_namer` | 1 | (25, 46) | `from_ledger` |
| `inf_squad` | 2 | (22, 45) | `from_ledger` |
| `at_team` | 1 | (26, 44) | `from_ledger` |
| `mortar_team` | 1 | (21, 46) | issued (ungated) |
| `demo_squad` | 1 | (22, 46) | loan (ROE 77): the `construct` carrier and the barn's charges |
| `inf_medic_squad` | 1 | (20, 44) | loan |

**Resources:** `logistics_start` 400, enough for one outpost at t = 0, and no rate. `field_works: { kdf_outpost: 1 }`
(350 logistics, 30 s, garrison 3; `data/structures.json`). **This is the first campaign use of field works**
(census: no shipped mission declares `field_works`). See G8.

**Enemy:**

| tag | unit | at | stance |
|---|---|---|---|
| `eq_barn_cell` | `militia_cell` | the barn (26.5, 21.5) | garrison |
| `eq_pocket_rpg` | `rpg_team` | (12.5, 22.5), the west marsh pocket | ambush 4 |
| `eq_saddle_truck` | `technical` | (34.5, 11.5), the north saddle | hold_position, group `saddle` (the carrying secondary) |
| `eq_gap_rider` | `moto_rpg` | patrols (30.5, 24.5) to (37.5, 35.5) through the dyke gap | patrol, group `gap` |

**Waves**, all to `farm`. The cadence in words: one raid every 45 s, alternating the north (wheels through the saddle,
foot over the crest) and the east (wheels through the one gap).

| at | units | from |
|---|---|---|
| 60 s | `moto_rpg` ×2 | `rif_n` |
| 105 s | `militia_cell` ×2 | `rif_nw` (foot, over the crest) |
| 150 s | `technical` + `moto_rpg` | `rif_e` (through the gap) |
| 195 s | `militia_cell` + `rpg_team` | `rif_nw` |
| 240 s | `technical` ×2 | `rif_n` |
| 285 s | `moto_rpg` ×2 | `rif_e` |

**Triggers:**
- `zone_entered(hollow)` → `commit` group `saddle` to `farm` ("The saddle truck comes down").
- `first_contact` → `commit` group `gap` to `farm` ("Riders come through the dyke gap").

**Civilians:** 2 in the yard between the house and the barn, at (23.5, 21.5) and (24.5, 22.5). There is no
evacuation objective, so they move only under fire (`missionShepherds` is false).

**ROE:** `flagged_zones: ["farmhouse"]`, `fail_below: 40` (the Act III value).

**The player's decision: where to dig in.**
- The hold zone is the hollow. It is dead ground under level-4 crests, so a raider on the north downs is invisible
  from the farm until he tops the crest.
- A picket or the outpost on `north_crest` sees him coming, stands outside the zone, and splits the force.
- **The barn.** The cell sits in the barn, two tiles from the family:
  - the demo squad's charges are clean and slow under fire;
  - the mortar and the Namer are fast, but every round near the yard is billed.
- **The east.** Every eastern wheel comes through one gap, where a single AT team holds the whole flank.

**Twist candidates:**
- **T-B1 "The crates fly."** At `timer_s(200)`, a `drone_swarm` spawns at the barn ("Hallaq's crates"), because
  burning the store late lets it launch. Expressible today (`spawn` at a marker); `drone_swarm` is in `data/units/enemy/`.
- **T-B2 "The family is the cell's cover."** The barn cell holds fire while the civilians are in the yard. That needs
  a stance condition on civilians: a schema field.
- **T-B3 "The saddle truck was a decoy."** `eq_saddle_truck` withdraws at first contact and the real wheeled raid
  comes through the gap. Expressible today (`withdraw_to` and a wave).

**Story hooks:**
- the farm as the winter road's staging post;
- Hallaq's drones by the crate (WH III's briefing);
- Idit wants the saddle truck marked "because it will be at the causeway head next week";
- the outpost as the brigade's first stake in the marsh.

### 5.3 EQ III: `ein_qasab_3_buildup`, buildup, 7 min, on `ein_qasab_3`

**Player starting state.** The player starts at `kdf_start` (8, 44).

| unit | count | at | source |
|---|---|---|---|
| `apc_eitan` | 1 | (11, 43) | `from_ledger` |
| `ifv_namer` | 1 | (13, 43) | `from_ledger` |
| `inf_squad` | 2 | (9, 44) | `from_ledger` |
| `at_team` | 1 | (7, 45) | `from_ledger` |
| `jeep_shoded` | 1 | (12, 45) | issued |
| `demo_squad` | 1 | (10, 45) | loan |
| `inf_medic_squad` | 1 | (6, 44) | loan |

**Structures:** `camp` at (8, 40), size 2×2.

**Resources:**
- `logistics_start` 400 and `logistics_rate_per_min` 150 (WH III's numbers);
- `supply_corridor: true`, `supply_entry: supply_entry`;
- `income_zones: [{ zone: mill_islet, rate_per_min: <by the 40% rule> }]`
  (`docs/campaign/economy/income-numbers.md`; ground both sides want, and the passive force is not in it);
- `intel_start` 100: one smoke screen. The buildup is the phase where Intel is spent (GDD section 4).
- The base rate halves while a reed cell sits within 2 tiles of the supply road. `reed_w` reaches it in 16 steps.

**What to spend on, said plainly.** Every vehicle the camp builds has one road to the fight: 21 road tiles, single
file, under the terrace. **Buy feet:**
- `inf_squad` (292);
- `at_team` (236), a second team for the stop;
- one `mortar_team` (209), walked to the islet: range 18 reaches the head yard at about 11 tiles;
- not the Namer (630).

**Spend Intel on one of two things:**
- a **smoke screen** (100) on the north channel while the column crosses, which blinds the terrace overwatch;
- a **drone sweep** (150) of the reverse slope, which shows the reserve and the escape road.

**Enemy:**

| tag | unit | at | stance | notes |
|---|---|---|---|---|
| `eq_hvt_ferryman` | `technical` | (24.5, 13.5), the head yard | hold_position, group `ferry` | **the HVT** |
| `eq_stock_guard` | `militia_cell` | the barn (20.5, 13.5) | garrison | |
| `eq_causeway_rpg` | `rpg_team` | (23.5, 16.5), the causeway mouth | ambush 4 | **if marked in EQ I, spawns identified and forfeits its ambush**: the column's lead vehicle lives |
| `eq_reed_cell` | `militia_cell` | (26.5, 18.5), the north channel | ambush 3 | **EQ I's carrying secondary** |
| `eq_saddle_truck` | `gun_truck`* | (30.5, 12.5), the lower terrace | hold_position | **EQ II's carrying secondary**; overwatches the causeway, range 11 |
| `eq_lip_reserve` | `militia_cell` + `rpg_team` | (36.5, 3.5), behind the lip in dead ground | hold_position, group `reserve` | |

\* The tag carries the identification, not the unit type. If the lead prefers the same `technical` as EQ II, it is a
one-word change.

**Waves:**

| at | units | from | to |
|---|---|---|---|
| 45 s | `technical` | `rif_nw` | `causeway_head` |
| 100 s | `militia_cell` ×2 | `reed_e` | `south_landing` (wading: the supply cut) |
| 150 s | `moto_rpg` ×2 | `rif_n` | `causeway_head` |
| 200 s | `rpg_team` + `militia_cell` | `reed_w` | the camp exit. **Production pauses** while a ground enemy contests it (`packages/sim/src/production.ts`). |
| 250 s | `technical` + `moto_rpg` | `rif_nw` | `causeway_head` |
| 300 s | `militia_cell` ×2 | `reed_e` | `mill` |

**Triggers:**
- `zone_entered(causeway_head)` → `commit` group `reserve` to `causeway_head` ("The reserve comes over the lip").
- `casualties_pct(40)` → `withdraw_to` group `ferry` to `north_exit` ("Hallaq's man runs for the north road"). That
  is 13 steps by wheel, **through the flagged hamlet**.

**Civilians:** 2 at (29.5, 9.5) and 1 at (33.5, 10.5) in the hamlet, with no evacuation (they move under fire only).

**ROE:** `flagged_zones: ["hamlet"]`, `fail_below: 40`, `structure_penalty_mult: 1` (WH IV and V's values).

**The player's decision.** Three spends against one clock:
1. **What to buy, given one road** (above).
2. **The stop.** Either send an AT team early, alone, wading the west island and climbing to the lip: 44 steps on
   foot, 15 of them marsh. Or chase him up a road that runs through the protected hamlet, where every shot is
   billed.
3. **The camp's door.** Guard it against the reed raiders (production stops and the supply line halves), or push
   everything north and pay for it in logistics.

The stock is the failable clock. Burning it with fire from the causeway is fast, but the barn sits below the flagged
terrace. Demo charges are clean, and they take a squad across the causeway.

**Twist candidates:**
- **T-C1 "The wreck closes the road."** A vehicle killed on the causeway blocks it. Engine work: wrecks do not enter
  the masks (G6).
- **T-C2 "He gets off the map."** If the ferryman reaches `north_exit`, he is removed and the primary fails. Needs an
  enemy-side `zone_entered` or an arrival condition (G5), schema plus runtime.
- **T-C3 "The mill is full of people."** The hamlet families shelter at the mill on the islet, the passing place
  every vehicle stops at. Expressible today (a civilian group at `mill`).
- **T-C4 "The crates fly" again.** A `drone_swarm` wave at 220 s. A Remetz (`aa_remetz`, wheeled, gate ROE 85)
  bought from the camp can only stand on the causeway or the islet. Expressible today; measure it before adopting
  (GH-274's `swarm.hit_mult` makes rifles poor against swarms).

**Story hooks:**
- the manifests at the stock, which give Idit the yard east of the village (the bridge into WH IV and V);
- the lieutenant's road through the hamlet, the act's bait in its smallest form;
- Shai on buying infantry when he has the money for armour.

### 5.4 Plots A and C on the same three maps

The maps are plot-independent on purpose. Whichever plot the lead picks, the same three get built.

| Plot | # | id | phase | min / limit | primaries | secondaries | ROE | ledger req / prod | economy |
|---|---|---|---|---|---|---|---|---|---|
| A | I | `ein_qasab_1_recon` | recon | 6 / 720 | `locate` count 4; **`evacuate_before` · `hamlet`, count 3, 300 s**: families on the west bank walked *home* across the marsh | `locate` · `eq_reed_cell` (carries) | `hamlet` flagged | R / R M C X I E | n |
| A | II | `ein_qasab_2_foothold` | foothold | 7 / 840 | `hold_for` · `hollow` 300 s; **`raze` · `barn_yard` 300 s** | `locate` · `eq_saddle_truck` (carries) | `farmhouse`, fail 40 | R I / R M C X I | y (one outpost) |
| A | III | `ein_qasab_3_clearance` | clearance | 7 / 840 | `capture` · `causeway_head` 20 s; `hold_for` · `mill_islet` 240 s; **`evacuate_before` · `hamlet` (reverse refuge), 3, 330 s** | — | `hamlet`, **fail 60** | R I / R M C X E | n |
| C | I | as B-I | recon | 6 / 720 | as B-I | as B-I | as B-I | R / R M C X I E | n |
| C | II | as B-II | foothold | 7 / 840 | as B-II | as B-II | as B-II | R I / R M C X I | y |
| C | III | `ein_qasab_3_clearance` | clearance | 7 / 840 | **`eliminate_hvt` · `wh_hvt_ferry` (Hallaq)**; `hold_for` · `causeway_head` 240 s; **`raze` · `stock_yard` 330 s** | `capture` · `mill_islet` 15 s | `hamlet`, fail 45 | R I / R M C X | y |

**Plot A's enemy.** The same placements, re-tagged, with no HVT. The cells withdraw rather than fight to the last
(`casualties_pct(40)` → `withdraw_to`), because nobody is paying them now.

**Plot C's enemy.** As B-III, with Hallaq in place of the ferryman. **C needs these shipped edits:**
- `wadi_halam_5_depot.json` `kill_gate_rpg.say`;
- `commander.json` (`villains.naharin.lines`, the Lieutenant Colonel `until_mission`, the Colonel promotion line);
- moving V's `aftermath` to C-III;
- `storyline.md` section 2.3's FERRY row.

---

## 6. Asset manifest

Every row is **PRESENT** (with its path) or **MISSING** (with the gate it must pass and the pipeline that makes it).
Censused this session on `origin/main` `a20f0dadf`, `git ls-files` plus `ls`.

### 6.1 Units: all PRESENT, and no new unit is needed

| id | data | mesh |
|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` |
| `mortar_team` | `data/units/kdf/mortar_team.json` | `art/meshes/mortar_team.glb` |
| `sniper_team` | `data/units/kdf/sniper_team.json` | `art/meshes/sniper_team.glb` |
| `demo_squad` | `data/units/kdf/demo_squad.json` | `art/meshes/demo_squad.glb` |
| `inf_medic_squad` | `data/units/kdf/inf_medic_squad.json` | `art/meshes/inf_medic_squad.glb` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | `art/meshes/vehicles/recon_drone.glb` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` |
| `aa_remetz` (T-C4 only) | `data/units/kdf/aa_remetz.json` | `art/meshes/vehicles/aa_remetz.glb` |
| `militia_cell` | `data/units/enemy/militia_cell.json` | `art/meshes/militia_cell.glb` |
| `rpg_team` | `data/units/enemy/rpg_team.json` | `art/meshes/rpg_team.glb` |
| `moto_rpg` | `data/units/enemy/moto_rpg.json` | `art/meshes/moto_rpg.glb` |
| `technical` | `data/units/enemy/technical.json` | `art/meshes/vehicles/technical.glb` |
| `gun_truck` | `data/units/enemy/gun_truck.json` | `art/meshes/vehicles/gun_truck.glb` |
| `drone_swarm` (T-B1, T-C4) | `data/units/enemy/drone_swarm.json` | `art/meshes/vehicles/drone_swarm.glb` |
| civilians | `data/units/civilians.json` | `art/meshes/civilians/civilian_child.glb`, `civilian_woman.glb` |

### 6.2 Structures: all PRESENT (`data/structures.json`, `art/meshes/buildings/`)

| type | symbol | mesh | used for |
|---|---|---|---|
| `house` | `h` | `house.glb` | the hamlets, the farmhouse |
| `warehouse` | `w` | `warehouse.glb` | the barn and the stock (spec 5.2 names `w` as "barn as the warehouse type") |
| `wall` | `=` | `wall.glb` | yards |
| `pump_house` | `p` | `pump_house.glb` | the mill on the islet |
| `camp` | `c` (a mission structure) | `camp.glb` | EQ III |
| `kdf_outpost` | `O` (field works) | `kdf_outpost.glb`, `kdf_outpost_construction.glb` | EQ II |

A basalt-stone village is a later call (spec 2.5). The textured stone bakes stand.

### 6.3 Maps and terrain

| asset | status |
|---|---|
| `wetland` theme (schema enum, `TERRAIN_THEMES.wetland`, `TERRAIN_WEATHER`) | PRESENT: `data/schemas/map.schema.json`, `packages/app/src/terrain-themes.ts` |
| `~` legend and the `wetland`-only lint | PRESENT: `packages/data/src/map.ts` `TERRAIN_LEGEND`, `THEME_SYMBOLS`; `tools/validate_data.mjs` |
| `ein_qasab` | PRESENT: `data/maps/ein_qasab.json`. Needs the additive markers and zones in 3.1 (gates: `validate:data`, `medic_every_mission.test.ts`) |
| `jebel_matar` | MISSING. Gates: `validate:data`, `map_grid.test.ts`, `high_ground_maps.test.ts` (`RISES`), `map_distinctness` (measured passing on this sketch), `map_visibility.test.ts`, `medic_every_mission.test.ts`, a new doctrine test, and `freePlay.map.jebel_matar` in `en.json` (the menu spec requires a key per map). Pipeline: `mission-author` from 3.2. |
| `ein_qasab_3` | MISSING. Same gates, plus a water-share guard, plus the `decorPlacements` triangle census against 0.9 M. Pipeline: `mission-author` from 3.3. |
| Ground tiles (5) | PRESENT: `assets/textures/wetland_open_tile.jpg`, `basalt_rock_tile.jpg`, `wet_scrub_tile.jpg`, `oak_litter_tile.jpg`, `basalt_scree_tile.jpg` |

### 6.4 Decor and props

| asset | status |
|---|---|
| reeds ×3 | PRESENT: `art/meshes/decor/reed_{0,1,2}.glb`, sources `art/src/terrain/wetland/reed_{0,1,2}.blend` |
| wet grass ×3 | PRESENT: `art/meshes/decor/wet_grass_{0,1,2}.glb`, sources `art/src/terrain/wetland/wet_grass_{0,1,2}.blend` |
| **oak ×3** | MISSING (stand-in). `packages/app/src/mesh-catalogue.ts:445-446` maps `oak` to `decor/cedar_{0,1,2}.glb`. Meshy bases A and B are previewed and held in `_coord/wet-theme/meshy/oak_a`, `oak_b`, outside the repo; A needs its re-roll. Gate: `pnpm validate:meshes`. Pipeline: Meshy base, then `tools/terrain/fit_meshy_wet_decor.py`. Blocked on the **Meshy API-key credit limit** ("API key credit limit reached", `_coord/wet-theme/meshy-ledger.md`, call 5c), which is the lead's account setting. |
| **willow ×3** | MISSING (stand-in). `mesh-catalogue.ts:447-448` maps it to `decor/desert_tree_{0,1,2}.glb`. The first preview was rejected (it came out weeping), and the re-roll was refused at the key limit. Same gate and pipeline. |
| **shrub (lentisk) ×3** | MISSING (stand-in). `mesh-catalogue.ts:449-450` maps it to `decor/bush_{0,1,2}.glb`. The preview is a keeper; the Meshy remesh collapsed, so the 600-tri cut goes to Blender. Same gate. |
| rocks and boulders | PRESENT, shared and retinted (`decorColors`, spec 2.3) |
| `round_bale`, `culvert_pipe` | PRESENT: `art/meshes/props/round_bale.glb`, `culvert_pipe.glb`, sources `art/src/terrain/wetland/*.blend` |
| `tractor_wreck` | MISSING. Meshy preview 20 credits, refused at the key limit. Gate: `validate:meshes` plus `PROP_TRI_CAPS` on both sides. |

**Cost to finish the trees and the tractor**, from the ledger: about 60 credits (tractor 20, willow re-roll 20,
oak A re-roll 20), which keeps the run inside the approved 200 cap. The missions do not wait on it: the trees are
presentation only, and the stand-ins place the same tiles.

### 6.5 Rain, VFX, backdrop, UI, audio

| asset | status |
|---|---|
| falling rain, splash, `rainLight`, wet debug layers, `wet` / `wet-downs` scenarios | MISSING on main. **P4 is in flight** (GH-871: S-L2 approved 31 Oct; T13 and the PR to follow). Gate: P4's own PR (report-only visual scenarios, frame budget +1.0 / +0.7 / +0.4 ms). |
| KDF infantry readability lift under rain | MISSING (S-L2 ruling, in P4). The missions put infantry in reeds and on wet causeways all the time, so this is the lift they lean on. |
| `vehicle_mud.json` | MISSING (`data/vfx/` holds `vehicle_dust.json` only). Gate: `index.test.ts`, which pins `vfxEmitters` to the directory. P4. |
| backdrop kit | PRESENT: `art/meshes/backdrop/wadi_halam_kit.glb`, `art/src/backdrop/wadi_halam_kit.blend`. A `backdrop` block on each of the three maps is MISSING (`pnpm backdrop:layout`, then hand edits). A wet atlas variant is optional and MISSING (`blender-art`, Q6). |
| briefing images | PRESENT: `assets/ui/plates/units/*.jpg` (for example `sniper_team.jpg`, `demo_squad.jpg`, `at_team.jpg`). A wetland scene plate is optional and MISSING. |
| portraits | PRESENT: `assets/ui/portraits/shai_hammai.png`, `idit_zohar.png`, `jubran_hallaq.png` |
| board pin for `ein_qasab` | MISSING: a `world.json` `at` coordinate on `campaign/world_map.png`. Town pins are DOM anchors, so no art is needed. |
| ambience or a rain bed | not wanted: every bed is off by the lead's ruling of 9 Oct (`packages/app/src/ambience.ts`) |
| barks | PRESENT engine; lines unrecorded, the shipped status (WP-AU1) |

---

## 7. Engine and schema gaps the arc depends on

| # | gap | needed by | smallest proposal | owner |
|---|---|---|---|---|
| **G1** | **No town-level gate.** Every town in a live region is open (`missionOpen` and `nextMissionOf`, `packages/app/src/campaign.ts`; `world.schema.json` towns have only `id`, `name`, `at` and `missions`). | all plots (B: after WH III; A and C: after WH V) | `unlock: { after_mission }` on a town, the shape the region already uses, read by `townProgress`, `missionOpen` and the board's lock sentence. **`nextMissionAfter`'s fallback must skip a locked town.** | `sim-guard` (schema), the app campaign shell |
| G2 | `town` enum and `world.json` entry | all | `"ein_qasab"` in `mission.schema.json` `town`; a `world.json` town (placement in `towns` per section 0.1, point 4) | `mission-author` |
| G3 | Rank by position | B | list `ein_qasab` before `wadi_halam`. `validate_narrative.mjs`'s ascending-rank check is unaffected. Depends on G1. | `mission-author` |
| G4 | "Kill or capture" is a kill (prisoners are GH-18, M2) | B-III, C-III | none now. Upgrade in place when GH-18 lands (`storyline.md` G8). | `sim-guard` |
| G5 | Trigger conditions are player-side only (`zone_entered` reads player units) | T-C2 | an `enemy_zone_entered` condition, or an arrival test on `withdraw_to` | `sim-guard` |
| G6 | No runtime terrain change; wrecks are not in the masks | T-A3, T-C1 | none recommended. Keep them as twist candidates. | `sim-guard` |
| G7 | The decor triangle budget on `ein_qasab_3` (370 marsh tiles) | B-III, A-III, C-III | run `decorPlacements` against 0.9 M; narrow the channels if over | `render-vfx`, `mission-author` |
| G8 | **Field works' first campaign use** | B-II, A-II | `validate_works.mjs` is live, but no playtest plan has ever raised a work. If the plan harness cannot, drop `field_works` from EQ II and keep the rest. | `playtest` |
| G9 | Rain itself (P4) and the infantry lift | all | in flight under GH-871 | `render-vfx` |
| G10 | The Meshy key limit | the trees, the tractor | raise the per-key limit in the Meshy dashboard (about 60 credits to finish) | **the lead** |
| G11 | The sandbox anchors on the new maps | Free Play only | named seats (P5's recommendation, `docs/agent-notes/maps-and-terrain-design.md`) | app |

**Not gaps.**
- Every objective type is live (`SUPPORTED`).
- Every trigger condition and action used is live: `first_contact`, `casualties_pct`, `timer_s`, `zone_entered`, and
  `commit`, `withdraw_to`, `spawn` (`mission.ts:3840-3930`; there is a sixth action, `remove`).
- Waves on a clock (`at_seconds`) and on an objective (`trigger`) are live.
- `supply_corridor`, `income_zones`, `intel_start`, `field_works`, `civilians` and `structures[]` are all in
  `mission.schema.json`.

---

## 8. Open decisions for the lead (recommendation first)

1. **Which plot?** **Recommend B, "The Flood Week"**: three missions, interleaved after Wadi Halam III, touching
   nothing shipped. A is the coda with no villain. C moves Hallaq's end and re-briefs V.
2. **A second Naharin town (`ein_qasab`) rather than "Wadi Halam VI–VIII"?** **Recommend yes.**
   - Inside the Wadi Halam town, the count breaks the contract's 3–5.
   - Inside it, the interleave could only be build-ups or clearances.
   - The one thing in-town buys is an enforced order, with no G1.
   - If the lead wants that, the honest 2-mission version is EQ III and a build-up rework of EQ II, slotted between
     WH III and IV. It loses the recon, and with it the carrying secondaries that disarm EQ III.
3. **Approve G1, a town-level `unlock.after_mission`?** **Recommend yes.** It is small and app-side, and every plot
   needs it.
4. **The maps: reuse Ein Qasab for EQ I, build Jebel Matar for EQ II (which also gives it its Free Play card once the
   art is in), and build `ein_qasab_3` for EQ III?** **Recommend yes.** That is two new maps and one reuse, and
   GH-382 forbids fewer.
5. **Build on the stand-in trees now, or wait for the Meshy trees?** **Recommend building and play-testing now.**
   - Decor is presentation only.
   - Ship when P4's rain lands.
   - Raise the Meshy key limit whenever it suits: about 60 credits finishes the trees and the tractor.
6. **The backdrop on the wet maps: reuse `wadi_halam_kit`, or a wet atlas variant?** **Recommend reuse**, laid out per
   map, and judged under `rainLight` at the first capture. A wet variant is Blender-only and can follow.
7. **First campaign use of field works in EQ II (one outpost)?** **Recommend yes**, with G8's fallback if the
   playtest harness cannot plan it.
8. **Three stars for EQ I and EQ II, through carrying secondaries that EQ III reads?** **Recommend yes.** It is the
   first time Act III's recon can earn the third star. `playtest` must prove the carry (the Beit Sahwan III `picture`
   precedent, `docs/campaign/README.md`).
9. **Time of day under rain.** **Recommend the default day light on all three.** `rainLight` already dims open ground
   23% (spec 4.5). Dawn or dusk under rain has not been measured for readability.
10. **Rain stays presentation only** (spec section 7). **Recommend yes.** The one rule worth trying, rain shortening
    smoke, waits for a mission built for it. EQ III's smoke-on-the-causeway would be that mission, after the look
    lands.

---

## 9. Verification (this session)

- **Plots:** three, mechanically distinct:
  - A has no HVT, and its evacuations run reversed under `fail_below` 60;
  - B has a town lieutenant and a buy-for-one-road buildup;
  - C ends the villain and moves the rank boundary.
- **Every `target_minutes` is 6 or 7.** Every `time_limit_s` is at least 2× it, and at least 60 s over the latest
  primary deadline. Phases ascend. Every objective type is in `SUPPORTED`.
- **Every unit, structure and map id** resolves to a path in section 6, or is listed as new with its gate. Every
  marker and zone is either shipped (`ein_qasab`) or defined in section 3 on a sketch whose tiles were checked: each
  placement sits on a passable tile, and `stock_yard` and `barn_yard` cover the warehouse only.
- **Ledger keys:** all six used are in shipped missions (`jq` census). None is new.
- **The asset manifest** has no row without a status.
- **The measurements:**
  - Routes, census, step and building-level checks: a scratch script runs the worktree's own `parseMap`,
    `applyTerrain` and `FlowField` on `data/maps/ein_qasab.json` and the two sketches. Its route helper is the
    `route()` of `tools/src/tel_marum_doctrine.test.ts`.
  - Distinctness: `compare` from `tools/src/map_distinctness.ts`, against every file in `data/maps/`.
  - The sketches are reproduced in sections 3.2 and 3.3. **`mission-author` re-measures from the committed JSON**:
    the numbers here are for the sketches, and any edit can move them.
- **Not run, because none can run on a design or a scratch map:** `pnpm playtest`, `map_visibility`,
  `validate:data` on new missions, `decorPlacements`. Each one is listed above where it binds.
