# Ground ladder — a new map for every campaign mission (GH-382)

**Status:** design, for the lead's sign-off. Step 1 of 2. **No map is built here.**
Written 2026-10-04 against `origin/main` at `6deb5b59` (v0.119.0).
**Downstream:** `mission-author` (maps, re-homed JSON), `level-scripter` (waves and
triggers on the new ground), `narrative-designer` (briefings whose numbers move),
`playtest` (plan re-scripts and the difficulty re-measure).
**Contract:** `docs/campaign/README.md`. **Story:** `docs/campaign/storyline.md`.
**Predecessor:** `docs/campaign/map-variants-design.md` (2026-09-06). It bent the
existing grounds with obstacles; the `_2`/`_3`/`_4` files it produced are why the
numbers below are 90–100%. This document replaces ground, not obstacles.

The lead (4 Oct): *"players should be surprised by a new map in every mission."*

---

## 0. The problem as a number

Measured this session over every map a campaign mission names (20 files). Two
measures, because they disagree and the difference matters for the check in §9:

- **raw** = share of all 2,304 tiles identical, position for position;
- **feature** = the same share over tiles where *either* map is not open `.`.

| arc | missions | map files | raw identity | feature identity |
|---|---|---|---|---|
| Wadi Halam | 5 | `wadi_halam_basin`, `_2`..`_5` | 96–100% | 83–98% |
| Umm Zeitoun | 4 | `umm_zeitoun` (×2), `_3`, `_4` | 97–99% (I and II share one file) | 92–96% |
| Beit Sahwan I–IV | 4 | `beit_sahwan_outskirts`, `_2`..`_4` | 92–98% | 70–91% |
| Tel Marum | 3 | `tel_marum_1`..`_3` | 90–91% | 78–79% |
| Qarn Hadid | 3 | `qarn_hadid` (one file) | 100% | 100% |
| Khan Rafid | 3 | `khan_rafid` (one file) | 100% | 100% |
| Deir Amun | 3 | `deir_amun` (one file) | 100% | 100% |

**The highest feature identity between two maps of different towns is 16%**
(`tel_marum_*` vs `umm_zeitoun`). Every repeated pair sits at 70% or above.
That gap, 16 → 70, is the space the distinctness check lives in (§9).

---

## 1. Rules this ladder follows

1. **Mission 1 of an arc keeps its base map** where a base map anchors something
   else: the golden gate (`beit_sahwan_outskirts` quiet/vehicle, `qarn_hadid`
   aftermath), the menu diorama (`beit_sahwan_outskirts`), and the doctrine tests
   (`qarn_hadid_doctrine`/`_relief`, `umm_zeitoun_doctrine`, `khan_rafid_doctrine`,
   `deir_amun_doctrine`). Moving those missions buys one map and breaks a gate.
   Tel Marum is the exception: its base `tel_marum` carries no mission, so all
   three Tel Marum missions get new ground and the base stays as the sandbox and
   `relief` scenario map.
2. **Same town, different ground.** Every new map is a district, approach, slope,
   bend or outlying part of the town the mission is already in. No briefing has to
   move town.
3. **Different dominant feature per mission inside an arc** (relief, river/ford,
   dense streets, orchards, ridge, open plain, compound, tunnels). No two
   consecutive missions share one.
4. **Region biome is fixed.** Sur maps must say `terrain: highland`
   (`tools/validate_biome.mjs`, `REGION_BIOME`). Marj stays `arid`, Naharin
   `green`. Variety inside a region comes from time of day, grove species and
   ground density (§10).
5. **Nothing in the ledger contract changes.** Every mission keeps its
   `requires`/`produces`. `intel.marked_positions` reveals by placement *tag*
   (`mission.ts`), not by tile, so a recon on one map still pays the clearance on
   another as long as the tags survive.
6. **Every objective target survives by id.** Marker, zone and tunnel ids stay the
   same so mission JSON changes only in coordinates. The "needs" column lists
   them per mission.
7. **The Qarn Hadid and Tel Marum lessons apply** (CLAUDE.md, map section):
   - a climb telescopes, so slope only reorders a route over ground that rises
     *above* its destination and comes back down (a rim, a spur, a shoulder);
   - a bowl 16 tiles across prices ground and reorders nothing;
   - cover 2 and cover 3 are not separable in a duel; the big rung is 0 → 1;
   - `b`/`d` stop wheels and tracks, never feet, and never sight;
   - one level of rise sits at eye level; two levels hide troops;
   - a post that watches a straight defile stands inside its weapons;
   - nothing is obvious by eye on a 48×48 grid. Measure every route claim
     through `FlowField` before it ships.
8. **Civilians walk the foot field.** `b` and `d` are free to them; `^` and
   buildings are not. Never lengthen a refuge line without measuring it against
   the `evacuate_before` clock.
9. **No new art.** Every map uses the shipped structure catalogue and decor
   families. `d` in Naharin draws as a ditch, which is what it is.

### Symbols used (from `data/schemas/map.schema.json` and `data/structures.json`)

| terrain | meaning | buildings | meaning (ROE penalty) |
|---|---|---|---|
| `.` | open | `h` | house (6) |
| `1` `2` `3` | cover 1–3 | `a` | apartment (14) |
| `r` | road | `s` | shed (2) |
| `o` | grove (cover 1; species per map) | `w` | warehouse (3) |
| `n` | knoll (cover 2) | `#` | concrete (3) |
| `^` | rock ridge: impassable, blocks sight | `=` | compound wall (0) |
| `b` | boulder field: foot only | `m` | civic hall (30) |
| `d` | ditch: foot only | `k` | clinic (6) |
| elevation | 0–9 grid, optional | `f` `p` `y` `c` | fence, pump house, relay, camp |

### Thumbnail key

Each thumbnail is 12×12; one character is about 4×4 tiles. Map symbols as above,
plus four glyphs that exist only in the thumbnails:
`@` player start · `*` primary objective · `E` enemy entry (wave marker) ·
`T` tunnel mouth · `R` civilian refuge. Elevation is a line under the block.
Mission-1 thumbnails are **downsampled from the shipped map**, not drawn.

---

## 2. Beit Sahwan (Act I, the Marj, `arid`) — 3 new maps

Base `beit_sahwan_outskirts`: open fields west, a small town on one road cross.
The Marj blurb is *"no mountain, no river, no depth"*, so relief here stays at
0–2. **Replace in place:** `beit_sahwan_2`, `_3`, `_4` keep their ids and get new
rows; mission JSON changes only coordinates.

| # | mission · phase | ground idea | dominant | symbols | needs from the ground (from the mission JSON) | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `beit_sahwan_1_recon` · recon | **keep** — the town seen from the western fields | open plain + small town | as shipped | — unchanged | — | `beit_sahwan_outskirts` |
| II | `beit_sahwan_2_foothold` · foothold | **The western terraces.** The KDF line on stepped fields west of town. A dry irrigation channel runs N–S across the approach; field walls and sheds. The town is a skyline strip on the east edge. | relief (terraces) | `. 1 2 = s o r h a`, elev 0–2 | `kdf_assembly` W; `camp` at [2,20] on open ground; `west_approach` (hold 300 s) over the terraces; `mortar_line` + `town_center` in the town strip (both wave sources); `bs_tn_west` mouth in the strip inside `tunnel_mouth_west`, vent behind the line (`digs`, `in_tunnel`); re-home 10 `at` placements | You defend from the high terrace and the attack climbs at you; the spoil shows in the channel bed. | `beit_sahwan_2` (rewrite) |
| III | `beit_sahwan_3_clearance` · clearance | **The old town.** Inside the town at street scale: apartment blocks, houses, two boulevards crossing at a square, the clinic block south of it. Rubble (`b`) chokes the alleys. | dense streets | `. 1 2 h a s k m r b` | `town` (capture 20 s) on the square; `clinic` flagged, south block (briefing says so); `bs_hvt_atgm` overlooking an east road; AT post on the western approach; `mortar_line` E (waves); `civ_refuge` W; re-home 5 civilians and 23 `at` placements; requires **I** | Sight lines of 3–5 tiles. Armour lives on the two boulevards because the alleys are foot-only. | `beit_sahwan_3` (rewrite) |
| IV | `beit_sahwan_4_subterranean` · subterranean | **The south quarter and the quarry.** The town after III: a rubble quarter, one E–W main road, and the north shaft head on the floor of a limestone quarry pit. | tunnels + quarry relief | `. 1 2 h s k r b ^`, elev 0–2 | `town` holds the mouths of all four routes (`bs_tn_west/north/souk/clinic`) and **no other mouth** (collapse counts mouths in the zone); `bs_tn_west` spoil runs west along the main road; `shaft_head` (capture 10 s) in the pit; `collection_point` with `civ_collection` about 3 tiles from start [26,34] (briefing); `clinic` flagged; `mortar_line` waves; re-home 8 civilians (4 hostages at the shaft) and 22 `at` placements | The town you took is rubble. Rubble fields stop vehicles everywhere except the main road, and the shaft head sits in a pit you look down into. | `beit_sahwan_4` (rewrite) |

```text
I base         II             III            IV          
............   ..2=...o..ha   aa.hhb.aa.hh   ...^^^^^^...
............   .2..=.....hE   aa.hhbraa.hh   ..^^.*..^^..
.......h.o..   2=...1.o..ah   ..b..brrrrrE   ..^.....^...
...o...h2oo.   ..=.1...rrrh   hh.aab.r.hhh   .bb^^.^^bb.E
..oo2m..aa..   .2=..1.o.rTh   hhbaa..r.b.h   hbbT.rrr.bbh
.@o1rrrrrr..   @.*=.1...r.h   @rrrrr*rrrrr   rrrrrrrrTrrr
......rkk...   c.2..1.o..hh   hh.b.k.r.aah   hb.b..k.bTbh
..n..2r.2hnn   .2=..1....ah   hhbhhk.rb.ah   hbbT.bkb.bb.
..n..2r..hn.   ..=.1..o..hh   ..b....r....   .b..bb..b..h
......aa....   .2..=.....hE   aa.hh.br.hhE   s.s.s.@.s.s.
.....oo.....   2=..1..o..ha   aa.hhb.r.hh.   ss.sRs..s.ss
.....R......   ..=........h   R..........1   ............
```
- **II** elev: W terraces 2, middle 1, dry channel (col 7) 0, town strip 1
- **III** elev: flat (0). Streets are the relief.
- **IV** elev: quarter 1, quarry rim 2, pit floor 0 (one ramp, NE)

**Watch:** BS III is the golden gate's report-only `combat` scenario
(`capture-protocol.ts`, `mission: 'beit_sahwan_3_clearance'`). Its capture will move.
It does not vote, so no bless is needed, but say so in the PR.

---

## 3. Khan Rafid (Act I, the Marj, `arid`) — 2 new maps

Base `khan_rafid`: the Old Town alleys north, one straight Main Street, the ward
compound, the new quarter south. KR I keeps it (`khan_rafid_doctrine.test.ts`).
**New ids:** `khan_rafid_2`, `khan_rafid_3`.

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `khan_rafid_1_recon` · recon | **keep** — the alleys and Main Street | dense streets | as shipped | — unchanged | — | `khan_rafid` |
| II | `khan_rafid_2_foothold` · foothold | **The ward on the tell.** The ward sits on a low mound in an open market plain. A ring road circles its foot. The Old Town is a band to the north, the souk inside it. | compound on a mound | `. 1 = h s a w m r c`, elev 0–2 | `ward` 9×7 with **four gates and a low wall** (briefing), hold 240 s, flagged; `civ_refuge` inside the ward (evacuate 4 there in 300 s); `market` (capture); `souk_alley` within fire of the ward over its wall; `ward_gate`, `ward_north_gate`, `main_street`; `kr_west_edge` + `north_road` wave sources; `camp` at [24,33]; 2 civilian groups N of the ward, 1 S; re-home 19 `at` | The ward is on a mound: you see over the wall, and so does everything around it. A ring road replaces the one straight street. | `khan_rafid_2` (new) |
| III | `khan_rafid_3_clearance` · clearance | **The garden souk.** The east quarter, where the souk spills into walled orchards. The store is a walled yard on the north edge. The ward and its civic hall sit SW. | orchards + compound walls | `. = o h s w m r`, grove `olive` | `souk` (capture 20 s) in the core; `ward` with the civic hall `m` holding `kr_hvt_ward`, flagged; `civ_refuge` in the ward (evacuate 6 in 300 s); `store` (capture); `east_lane`, `souk_alley`, `main_street`, `ward_north_gate`; `kr_west_edge` + `north_road` waves; 4 civilian groups; re-home 25 `at`; requires **I** | Walled gardens. Every orchard is a room with one gap, and the drone is blind behind the walls it flies over. | `khan_rafid_3` (new) |

```text
I base         II             III         
.2..==oo..2.   .hhshhashh..   ..======..E.
.2rrrrErrr2.   .hs.hh.shhE.   ..=ww..=....
2hshsshhah.2   .....r......   .....r......
.ssshsssha11   ...rrrrrr...   =oo=hshs=oo=
22.hskm=hs22   ..r..===.r..   =oo=s*sh=oo=
2..hskR=r..2   Er.1.=R*=r..   =oo=hshs=oo=
..rr2r.rrr.E   ..r..=..=.r.   .....r......
..hha#.a..w.   ..r..===.r..   .===.r.=oo=.
.wr.a.2a.1w.   ...rrrrrr...   E=m=rrr=oo=.
.wr11hs.h.s.   .ww...r..1..   .=R=.r.=oo=.
..roo..oo...   .ww.c.r.....   .....r......
.2r...@...2.   ......@.....   .....@......
```
- **II** elev: ward mound 2, ring road 1, plain 0
- **III** elev: flat (0). Walls and gardens are the obstacle.

**Briefing to touch:** KR III says *"the lanes and the road east are laid the way
they were laid last week."* That stays true mechanically, because the KR I tags
(`kr_lane_west`, `kr_lane_east`) carry the recon. The words need
`narrative-designer`: *the same cells, a different quarter*.

---

## 4. Deir Amun (Act I, the Marj, `arid`) — 2 new maps

Base `deir_amun`: plateau and road north, an escarpment with two gaps, the hamlet
on the lip of a dry watercourse, the wadi E–W, start south. DA I keeps it
(`deir_amun_doctrine.test.ts`). **New ids:** `deir_amun_2`, `deir_amun_3`.

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `deir_amun_1_recon` · recon | **keep** — the escarpment, the gully and the watercourse | relief + tunnels | as shipped | — unchanged | — | `deir_amun` |
| II | `deir_amun_2_foothold` · foothold | **The pump yard in the bend.** Close in on the wadi: it loops round in an S-bend, and the pump yard stands on the spur inside the meander. The hamlet is across the bed, two ravines to the north. | river bed and fords | `. b = h s o r ^ c`, elev 0–2 | `pump_yard` walled, **one gate on the south side** (briefing), hold 240 s **and** collapse 240 s, so the mouth of `da_tn_pump` is inside the yard and its vent is in the wadi bed behind it (briefing: *"comes up in the wadi bed behind you"*); `da_tn_yard` also stocked; `store_yard` (capture); `hamlet` flagged; `camp` at [26,34] *"on the bank"*; `pump_gate`, `ford_centre`, `hamlet_lane`, `hamlet_north`; `gap_east`/`gap_west`/`north_road` waves; re-home 19 `at` | The wadi is not a line behind you any more. It loops round you, and the enemy comes up the bed on three sides. | `deir_amun_2` (new) |
| III | `deir_amun_3_subterranean` · subterranean | **Down from the plateau.** The same nine houses, attacked from the north this time. You start on the plateau and come down through two ravines to the hamlet on the lip. The spoil field and the wadi lie below it. | relief + tunnels | `. n ^ b h s r o`, elev 0–4 | `hamlet` holds the mouths of exactly the four routes (`da_tn_east/lane/north/yard`), flagged; one route vents on **the player's own road east** (briefing); `spoil_field_centre`, `hamlet_lane`, `hamlet_north`; `gap_east`/`gap_west` waves on the flanks; `player_start` moves north onto the plateau; open sight lines over the hamlet for the detector (contact goes cold 16 s after the last eye leaves); re-home 23 `at` | For the first time you come at the village from above. The escarpment you looked up at in I and II is now behind you. | `deir_amun_3` (new) |

```text
I base         II             III         
.nn..s..nnn.   ^^..E.^^^..E   .....@......
.2....E...r2   ^^.r..^^..^^   ..rrrrrrrrr.
^^^^E^^^.^^^   ..r..hh.....   .n.......n..
....1...2wr.   .r..hhs.bbb.   ^^^.^^^^^.^^
.1*..nnnnwr1   r.bbbb.bb...   E.b.....b..E
..b.hhhr..r.   .bb.oo.b....   ..b.hhT.hT..
..b#=.hww...   bb.===b.....   ...Th*shh...
bbbbbbbrbbrb   b.=*T=.b....   ..bbbbbbbb..
22222o2rbbr2   b..=.=.b.c..   ..h..hh.T.rr
.2..ooo.oor2   .bb...b..r..   .....o..oo.r
...1....11..   ...bbbb.r...   bbbbb.bbbbbr
.....1@r....   .......@....   .....bb.....
```
- **II** elev: banks 2, yard spur 2, wadi bed (b) 0; fords are the gaps in the bed
- **III** elev: plateau 4, ravine floors 3→2, hamlet lip 2, wadi 0

---

## 5. Tel Marum (Act II, Sur, `highland`) — 3 new maps

Base `tel_marum`: a valley floor between rock walls, a wall across the middle
with a wide saddle and a boulder corridor, the battery and town behind it. **No
mission uses the base.** It stays for the sandbox, the `relief` golden scenario
and `tel_marum_doctrine.test.ts`. All three missions sit on `tel_marum_1`..`_3`,
which are copies of it at 78–79% feature identity. **Replace in place.**

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `tel_marum_1_recon` · recon | **The long valley.** Far south of the pass, the approach valley itself. Open slopes on both flanks instead of walls, a stony stream bed meandering down the floor, a knoll line with the hollow behind it. The pass is a notch at the north edge. | river/ford + open floor | `. n o b r ^`, elev 0–5 | 4 `locate` primaries on posts: `tm_pocket_east`/`west` on the flank spurs, `tm_spotter_west`, `tm_hvt_battery` near the notch; `hollow` dead ground and out of battery reach (briefing); herders north of the hollow, refuge `start_line`, `muster_ground` near the start (evacuate 2 in 300 s); `town_edge` waves; re-home 12 `at` | No walls. The valley is wide, its sides are slopes you can climb, and a stream with three fords cuts the floor. | `tel_marum_1` (rewrite) |
| II | `tel_marum_2_foothold` · foothold | **The terraced slope.** The hillside under the wall. Dry-stone terraces climb north toward the saddle, and the ammunition draw is a gully cutting diagonally up the slope. | relief (climbing terraces) | `. 1 b ^ s`, elev 0–5 | `approach` (hold 240 s) part-way up, with dead ground behind some terrace steps (*"not every tile of the approach is watched"*); `ammo_draw` inside the gully (raze 300 s; the shanty is placed by the mission at [22,27] and moves); `tm_spotter_west` on a western terrace; `saddle_wide` at the top; `town_edge` waves; re-home 13 `at` | The whole map climbs. Each terrace step is dead ground to the one above it, and the cache sits down in a gully you have to enter. | `tel_marum_2` (rewrite) |
| III | `tel_marum_3_clearance` · clearance | **Through the massif.** The wall is no longer a line six tiles thick but a massif you thread for twenty. The wide saddle is a switchback road; the narrow way is a rock-choked defile winding west. The town and battery lie on the far side. | ridge | `. ^ b r h #`, elev 2–6 | `pass` (capture 20 s) on the saddle road; `saddle_narrow` at the defile; defile **foot-only** (`b`) and longer than the saddle (briefing: *ten tiles*); `tm_hvt_battery` 2 tiles from `town_block` (flagged); 3 civilians in the town, refuge `approach` (evacuate 2 in 300 s); `sarim_west` + `town_edge` waves; re-home 16 `at` | Twenty tiles of switchbacks and defile instead of one gap in a wall, with the town only in view at the end. | `tel_marum_3` (rewrite) |

```text
today tm_1     I              II             III         
^^....E...^^   ^^^^^.E.^^^^   ^^^^^^.E.^^^   ..hh#.*.hh..
^^........^^   .n...r...n..   .1111.....1.   ..h...r..h..
^^.^......^^   .....r......   1111....1111   ^^^^^.r^^^^^
^^b^^^.^^^^^   ..oo.r..o...   ..111.b.111.   ^^b^^.r.^^^^
^^b^^...^^^^   ...bb.b.....   111..b.111..   ^^b^^^r^^^^^
^^......oo^^   .b...r.bb...   .11.b*.11111   ^b^^^r.^^^^^
^^oo......^^   b..o.r...bb.   1111.b..111.   ^b^^^.r^^^^^
^^........^^   ..nnn.......   ..11..b.11..   ^^b^^r*^^^^^
^^b.bbb.bb^^   .....oo..n..   111111.b.111   ^^b^^.r.^^^^
^^.....n..^^   ..bb.r.bb...   .1111...b.11   .b.....r....
^^.oo.....^^   bb..R@..b..b   ....11..*...   .....r......
^^....@...^^   .....r......   ......@.....   .....@......
```
- **I** elev: valley floor 0–1, stream bed (b) 0, side slopes 3–5 (no flank walls)
- **II** elev: climbs north, row 11 = 0 to row 1 = 5; the draw (b) cuts 1 below its sides
- **III** elev: massif 6; saddle road climbs 2→4 in switchbacks; corridor (b) 3

**Briefing numbers to re-measure:** TM III's *ten tiles longer*, *seventeen*
(Grad range to the defile) and *"the only Sarim eyes ... sit at its northern
mouth"*. These are the decision, so the **ground honours them** and
`FlowField` proves it. A new `tel_marum_3` doctrine block replaces the
variant test. The base doctrine test stays on `tel_marum`.

---

## 6. Qarn Hadid (Act II, Sur, `highland`) — 2 new maps

Base `qarn_hadid`: a rock wall with two gates (a high shoulder and a low notch
with a ditch), the village north, scree and a bowl east. QH I keeps it: two
doctrine tests and the `aftermath` golden scenario sit on it. **New ids:**
`qarn_hadid_2`, `qarn_hadid_3`.

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `qarn_hadid_1_recon` · recon | **keep** — the two gates | ridge + relief | as shipped | — unchanged | — | `qarn_hadid` |
| II | `qarn_hadid_2_foothold` · foothold | **The gates, close in.** The wall at twice the scale. The shoulder gate is a switchback road climbing to the concrete revetment at its crest; the notch is a long cutting with the ditch in it. The hollow is a bowl to the SE and the camp is south. | ridge (switchbacks) | `. ^ r d n # c`, elev 0–6 | `the_gates` (raze 300 s, then hold 180 s) holds the revetment (`concrete` placed by the mission at [18,19]; moves); notch **foot-only** (`d`) and covered from above; no vehicle route north until the revetment falls; `shoulder_gate`, `saddle_gate`; `hollow` (capture); `qh_watch_bench`; `camp` at [25,34]; `north_junction` + `village_square` waves; re-home 17 `at` | The gates at twice the scale: a switchback climb up the shoulder, and a notch cutting long enough to be a fight of its own. | `qarn_hadid_2` (new) |
| III | `qarn_hadid_3_clearance` · clearance | **The village fields.** The first map wholly north of the wall: the wall is the south edge behind you. An anti-tank ditch spans the fields with a way round each end, under the terraced knoll to the west and through the thorn grove to the east. The village and clinic stand on a rise. | open plain + ditch line | `. 1 d n o r h m k a ^`, elev 1–4 | `village` (capture 20 s); `clinic` flagged, with `clinic_yard` the refuge (evacuate 3 in 300 s; civilians start at the north edge); `the_terraces` + `knoll_top` W; `qh_watch_grove` in the east grove; `qh_hvt_relay`; `north_junction` near the start, `shoulder_gate` at the south edge; `knoll_top` + `village_square` waves; west way **shorter** than east (briefing *17 vs 23*); re-home 22 `at` | The wall is behind you. The obstacle is a ditch dug across open fields, and you choose which end to turn. | `qarn_hadid_3` (new) |

```text
I base         II             III         
...1.a22h22.   ...E..r..E..   ..hhkhhah.R.
.2nn122r2222   .....r......   .hhrhmh*hk..
.23n122dw=22   ^^^^.r^^^^^^   ...r..1.....
.1nn..E3.oo.   ^^^r.^^^^.^^   .n..r....oo.
^^^n^.^r^^n^   ^^^.r^^^^d^^   nnn.r...ooo.
^^^^^^^r^^^^   ^^^r*^^^^.^^   .n.dddddddoo
.nnn..n.bbbb   ^^^.r^^^^d^^   ....r.....o.
22oo.o..bb22   ^^^^r.^^^.^^   ..1.r...1...
.ooo112.2.2.   ....r....n..   ....r.......
....11R2..12   ...r....n.n.   .....@......
....2.@12221   ..c.r...n.n.   ^^^^^r^^^^^^
...22...12..   ....@.......   ^^^^^r^^^^^^
```
- **II** elev: plain 1, switchback climbs to 6 at the revetment; notch cutting 1; bowl SE 0
- **III** elev: fields 1, terraced knoll W 4, village rise 3, grove 1

**Briefing numbers:** QH III's *seventeen* and *twenty-three* tiles, and *"a post
on its east shoulder sees four of its seven tiles"*, are the mission's decision.
The ground honours them, measured.

---

## 7. Umm Zeitoun (Act II climax, Sur, `highland`, grove `olive`) — 3 new maps

Base `umm_zeitoun`: an open basin with four hills, a crest north, two horns, a
hamlet on the floor and a wadi south. UZ I keeps it
(`umm_zeitoun_doctrine.test.ts`). **UZ II moves off the shared file** to a new
`umm_zeitoun_2`. **UZ III and IV are replaced in place.**

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `umm_zeitoun_1_recon` · recon | **keep** — the basin and its four hills | open basin + hills | as shipped | — unchanged | — | `umm_zeitoun` |
| II | `umm_zeitoun_2_buildup` · buildup | **The south rim.** The basin's southern lip at twice the scale: a long crest across the middle of the map, the camp bowl behind it to the south, the basin falling away north. The stone knoll is a separate outcrop forward of the crest, and olive terraces step down the reverse slope. | ridge (reverse slope) | `. 1 n o r c`, elev 1–5 | `crest_line` (hold 240 s), the highest ground on this half; `camp_ground` + `camp` [20,43] **dead to every enemy position** (briefing); `post_stone` (raze 300 s, capture) on the knoll, about 8 tiles off the crest; `knoll_stone`, `rim_crest`; `battery_south` 12 tiles from the crest; `battery_north`; `sarim_east/north/west` waves; re-home 12 `at` | You build on the reverse slope of a real crest. The whole enemy side is downhill, and seeing it means stepping onto the skyline. | `umm_zeitoun_2` (new) |
| III | `umm_zeitoun_3_clearance` · clearance | **Between the horns.** A wide E–W valley with a horn filling each flank. The west horn is scree; the east is a bare glacis. Between them a walled hamlet sits in olive terraces above a stream, with the wadi to the south. | relief (two horns) | `. b n o h r`, elev 0–5 | `horn_west` (scree, **no vehicle route**) and `horn_east` (bare glacis, Kornet at about 10 tiles) each holding an `eliminate_hvt` post; both horns about 18 tiles from the start line (the briefing says *from the crest*, so re-brief or keep a crest at the start); `hamlet` flagged, with houses blocking sight in and out; `refuge_wadi` + `civ_refuge` about 11 tiles from the hamlet (evacuate 4 in 300 s); `hamlet_square`, `battery_south`/`_west`; `sarim_*` waves; re-home 21 `at` | The horns fill the map's flanks. You pick one and walk its whole length. | `umm_zeitoun_3` (rewrite) |
| IV | `umm_zeitoun_4_clearance` · clearance | **The northern shelf and the summit.** The far side of the basin. You start low in the south. The depot is on a high shelf to the NE with an eye on a spur beside it; the crest is a separate summit 16 tiles west. The ground falls away between them. | relief (shelf and summit) | `. 1 ^ n o h w # r`, elev 0–7 | `stockpile` (raze 300 s, 3 buildings) on the shelf, eye seeing the yard at 5 tiles; `crest` + `crest_reverse` + `crest_top` on the summit, about 16 tiles from the stockpile (briefing); `north_shelf` with `civ_north` (evacuate 3 porters); `hamlet` flagged; `battery_north`/`_west`; `sarim_north/west` waves; re-home 18 `at` | The last map of Sur is a climb. The depot and the man you came for sit on two summits with a valley between. | `umm_zeitoun_4` (rewrite) |

```text
I base         II             III            IV          
^^^^^^E^^^^^   E.....E....E   E....E.....E   E.^^.*..w#w.
^..nn^.w#..^   ..n.........   bbb.......n.   .^n.n...ww*.
^..nn.r....^   .....nn.....   b*bb.....n*.   ..n..n..^...
E...n......^   .....n*.....   bbb..oo...nn   ...^...^n.E.
^.b.n..n...^   .1..1....1..   bb..ohho....   ..1..o..^...
^bnb.rr.rn.^   nnnnn*nnnnnn   b..ohhhho...   .....oo.....
^bbb.hh..n.^   oo.oo.oo.oo.   ...ohhhho...   ..o....o....
^...dodd...^   .o.oo..o.oo.   ....oooo....   ...1.hh..1..
^nnoonn...n^   ....c.......   .....r......   ....hhh.....
^.1o1R111..^   ...r..r.....   ..bbb.R.bbb.   ..o..r..o...
^.....r....^   ...r.@r.....   .....r......   .....r......
^^^^^^@^^^^^   ............   .....@......   .....@......
```
- **II** elev: basin side 1, crest 5, reverse-slope terraces 3→2, camp bowl 1
- **III** elev: W horn 5 (scree), E horn 4 (bare glacis), floor 1, wadi 0
- **IV** elev: floor 0–1 south, falling ground mid 2–3, shelf 6 (NE), crest summit 7 (NW)

**Briefing numbers:** UZ II (*twelve*, *eight*), UZ III (*eighteen*, *ten*,
*eleven*), UZ IV (*five*, *sixteen*). Honour the ones the decision rests on (UZ
III's scree vs glacis, UZ IV's two-summit split) and re-brief the rest.

---

## 8. Wadi Halam (Act III, Naharin, `green`) — 4 new maps

Base `wadi_halam_basin`: a tree-lined wadi with two fords on the west, the
pasture in the middle, the village and the walled depot east. WH I keeps it: it
*is* the fords. **Replace in place:** `wadi_halam_2`..`_5` keep their ids.
Naharin has no water tile. A river here is a tree line, a stony bed (`b`) and an
elevation dip. Fords are gaps in the bed.

| # | mission · phase | ground idea | dominant | symbols | needs from the ground | surprise | map |
|---|---|---|---|---|---|---|---|
| I | `wadi_halam_1_fords` · recon | **keep** — the fords | river/ford | as shipped | — unchanged | — | `wadi_halam_basin` |
| II | `wadi_halam_2_laager` · foothold | **The bunded pasture.** Open grazing ground beyond the fords, crossed by earth bunds in long bands, *"real cover if you hold it"* (briefing). The pump house stands mid-field, the forward-store shed on the western edge. A short tree line with one ford in the NW corner. | open plain | `. 1 o s p r`, elev 0–1 | `pasture` (hold 300 s **and** raze 300 s), so the shed and the pump house (placed by the mission at [16,19]; moves) stand inside it; the shed on the pasture's **western edge** (briefing); `ford_watch` (capture) on the corner ford; `pump_house`; `rif_east/north/south` on three edges (*"from every direction"*); start [3,24]; re-home 7 `at` | Bands of bunds turn a flat field into firing steps, and the raiders come from three edges at once. | `wadi_halam_2` (rewrite) |
| III | `wadi_halam_3_counterraid` · buildup | **The cattle track.** Hedgerow country: a sunken droving lane winds N–S through small hedged fields between the two hides. The bunds sit at the centre, the stream bed along the south edge with the refuge on it. | orchards / hedgerows | `. o r b 1 c`, elev 0–1 | `hide_north` with `wh_hvt_amir` on a technical, with **a road out** for him (*"a mobility problem"*); `wh_hide_south` covering the track (locate); `pasture` (hold 300 s) on the bunds; `refuge` + `civ_refuge` on the south bed (evacuate 3 in 300 s, civilians near it); `pump_house`; `rif_east`/`rif_south` waves; `camp` [3,20]; start [9,21]; re-home 11 `at`; requires **I** | Hedgerows. The drone sees over them and nothing on the ground does, and the commander's technical runs the lane. | `wadi_halam_3` (rewrite) |
| IV | `wadi_halam_4_village` · clearance | **Wadi Halam village.** The village itself at street scale. Its houses step down a slope to a stony stream bed with one ford, and the civic hall stands on the middle terrace. | dense streets on a slope | `. h m r b o`, elev 0–3 | `village` (capture 20 s) and `village_center`; `hall_block` flagged around the hall; `wh_hvt_cache` in a house; `hide_south` beyond the ford with the two technicals; `refuge` + `civ_refuge` W, on the road out (evacuate 3 in 300 s); 4 civilians in the houses; re-home 12 `at` | The first lived-in village in Naharin, terraced down to a stream. The technicals come across the ford, not down a road. | `wadi_halam_4` (rewrite) |
| V | `wadi_halam_5_depot` · clearance | **The depot on the embankment.** You enter from the SW. The village sits on the diagonal between you and the depot, the civic hall in it. The depot is a fenced yard on a raised embankment NE with one ramp gate. The long way round is a river road along the bed. | compound | `. h m o r f w # b`, elev 0–2 | `depot` with **7 structures** (raze 300 s, hold 240 s); `depot_gate` at the ramp (`wh_gate_rpg`); the **straight line** from start to depot runs through the village and `hall_block` (briefing); a **southern road** that costs time and no houses; the D9 must reach the depot **without crossing `b`** (it is tracked); the mission's 3 `fence` placements move into the map as `f`, or are re-homed (`wadi_halam_5_depot_fence.test.ts` pins them); `rif_east`/`rif_south` waves; re-home 12 `at` | The depot stands above you on an embankment with one way in, and the safe road is the river road. | `wadi_halam_5` (rewrite) |

```text
I base         II             III            IV             V           
............   o....E......   oo.oo.Eoo.oo   .....o.o....   .......ffffE
..o.........   o.1111111...   o..o.*..o..o   ..hhh.hhhh..   ..o...rfw#wf
..o.........   o...........   oo.o.rr.oo.o   .hh.rr.hh.h.   .hh..r.fwwwf
..on.n......   o.1111.1111.   ...rr..o....   R..rhhhm.hh.   hhmh.r.fw*wf
..oo..hhhw=.   o...s....p.E   o.r.oo.o.oo.   @rr.h*hhhh.E   .hhrr..ffrff
..o111.m=w=.   @.111*11.11.   @r..o.*..o.E   ..rhh.hh.hh.   ..r..o...r..
@.*o1..mrw=E   ............   o.rr.oo.oo..   .hh.r.hh.h..   @r..o....r.E
..oo..hh===.   ..11111.111.   oo..r...o.o.   ..hh.r.hh...   .r.oo..rr...
..orrr..r...   ............   .o.o.r.oo..o   bb.bbrbbbbbb   ..r...r.....
..o..R.....E   ...1111111..   oo..o.r..o..   .o..r....o..   ...rrr......
..o.........   ............   bbb..bRbbbbb   ..o.r.......   bbbbbbbbbbbb
............   .....E......   ....b..b...E   ............   ............
```
- **II** elev: bunds step 0–1 in bands; tree line + ford W, upper quarter only
- **III** elev: fields 1, sunken track (r) 0, stream bed (b) 0
- **IV** elev: village steps 3→1 down to the stream bed (b) 0; ford at the road
- **V** elev: river flats 0, village 1, depot embankment 2 with one ramp (the gate)

---

## 9. The distinctness check

**Proposal:** a vitest spec over every map a campaign mission names (the set in
`data/campaign/world.json`, resolved through each mission's `map.file`). It fails
when two maps are too alike.

**Use feature identity, not raw identity.** Raw identity is dominated by open
ground: `marj_perimeter` (90% `.`) and `tutorial_ground` read **87% raw**, and
nobody would call them the same map. A raw 70% gate would fail the breach on day
one. Feature identity puts them at 16% or below.

| measure | most similar *different* maps | least similar *repeated* pair | gate |
|---|---|---|---|
| raw | 87% (`marj_perimeter` / `tutorial_ground`) | 92% (`beit_sahwan_2` / `_4`) | cannot separate them |
| feature | **16%** (`tel_marum_*` / `umm_zeitoun`) | **70%** (`beit_sahwan_2` / `_4`) | **fail above 35%** |

Four parts:

1. **Feature identity ≤ 35%** for every pair. That is twice the worst honest
   pair and half the best repeated one. The lead asked for "~70%": raw 70%
   cannot tell these maps apart, and feature 35% is what that figure means once
   open ground stops counting.
2. **All eight orientations.** Compare each pair under the 4 rotations × mirror.
   A flipped copy otherwise passes at 0%.
3. **Elevation counts too.** Where both maps carry a grid, also fail on more than
   80% of tiles within ±1 level. A flat copy of a relief map would otherwise
   read as different ground.
4. **Report-only for the base anchors at first.** Mission-1 maps are compared
   like every other, so a new map that copies its own base fails.

**Falsification (lands in the commit message):** copy `khan_rafid.json` to
`khan_rafid_2.json` with only its id changed, point KR II at it, and watch the
spec go red at 100%. Mirror it and watch it stay red. Put it back. Also run it
on today's `main`: it must list the seven arcs in §0 and nothing else.

**When it turns on:** it lands with arc 1 as report-only (it prints the table).
It becomes a gate once the last arc lands, because until then `main` fails it by
design.

---

## 10. Theme rotation

Biome is fixed per region (§1 rule 4). Three levers remain:

- **`map.time_of_day`** in the mission JSON. It wins over everything, and the
  sim never reads it. Only `beit_sahwan_breach` (`dawn`) and the tutorial
  (`day`) author it today, so the other 25 campaign missions all draw `day`.
- **`grove`** on the map (`olive | desert | cedar`).
- **Ground density** (streets against open ground), which changes the palette
  more than either.

`night` resolves to `dusk` until it is its own preset (D10), so in practice there
are three lights. Where a briefing names the hour, the hour wins.

| # | mission | light today → proposed | grove | ground reads as | anchored by |
|---|---|---|---|---|---|
| 0 | tutorial | day → day | desert | open | — |
| 1 | BS breach | dawn → dawn | desert | compound | *"dawn"* |
| 2 | BS I | day → **day** | desert | fields + town | — |
| 3 | BS II | day → **dusk** | desert | terraces | *"what survives tonight"* |
| 4 | BS III | day → **day** | desert | dense streets | *"clears the town tomorrow"* |
| 5 | BS IV | day → **dusk** | desert | rubble + quarry | — |
| 6 | KR I | day → **dawn** | desert | alleys | — |
| 7 | KR II | day → **day** | desert | mound + plain | — |
| 8 | KR III | day → **dusk** | **olive** | walled gardens | — |
| 9 | DA I | day → **dawn** | desert | escarpment | *"this morning"* |
| 10 | DA II | day → **dusk** | desert | wadi bend | — |
| 11 | DA III | day → **day** | desert | plateau descent | — |
| 12 | TM I | day → **dusk** | cedar | long valley | *"tonight you find out"* |
| 13 | TM II | day → **day** | cedar | terraced slope | — |
| 14 | TM III | day → **dawn** | cedar | massif | — |
| 15 | QH I | day → **day** | cedar | the gates | — |
| 16 | QH II | day → **dusk** | cedar | switchbacks | — |
| 17 | QH III | day → **dawn** | cedar | fields + ditch | — |
| 18 | UZ I | day → **day** | olive | basin | — |
| 19 | UZ II | day → **dusk** | olive | reverse slope | — |
| 20 | UZ III | day → **dawn** | olive | horns | — |
| 21 | UZ IV | day → **day** | olive | shelf + summit | — |
| 22 | WH I | day → **dusk** | olive | fords | *"the job tonight"* |
| 23 | WH II | day → **dawn** | olive | open pasture | — |
| 24 | WH III | day → **day** | olive | hedgerows | — |
| 25 | WH IV | day → **dusk** | olive | village streets | — |
| 26 | WH V | day → **dawn** | olive | embankment depot | aftermath: *"at first light"* |

No two consecutive missions share a light. Region changes (11 → 12, 21 → 22)
also change the biome. Light is 16 one-line mission-JSON edits, so it can land before any
map does, as its own small PR, and give part of the "new place" feeling at once.

---

## 11. Build order (worst repeated first)

One PR per arc. Each PR carries its maps, the re-homed mission JSON, the
re-scripted plans and the difficulty re-measure.

| rank | arc | new maps | why this place | risk |
|---|---|---|---|---|
| 1 | **Wadi Halam** | 4 | Worst numbers in the tree: 96–100% raw, WH II is the base byte for byte, and 5 missions play it. | Medium: WH V's D9 route and fence test |
| 2 | **Umm Zeitoun** | 3 | I and II share one file outright; III and IV are 97–99%. Act II's climax. | High: the heaviest doctrine and the most briefing numbers |
| 3 | **Khan Rafid** | 2 | One shared file. Flat urban with no relief and no tunnels, the cheapest arc to prove the pipeline on. | Low |
| 4 | **Deir Amun** | 2 | One shared file, with tunnels on both new maps. | Medium: route mouths and collapse zones |
| 5 | **Qarn Hadid** | 2 | One shared file. Relief at 0–7; Qarn Hadid's lessons apply in full. | Medium |
| 6 | **Beit Sahwan** | 3 | 70–91% feature. Moves the `combat` report-only capture. | Medium: BS IV's four routes |
| 7 | **Tel Marum** | 3 | The least alike (78–79% feature), but all three move, and TM III's corridor is the most measured ground in the game. | High: re-proving the saddle facts |

**Alternative order:** KR first, as the pipeline pilot (smallest, flat, no
tunnels), then strictly by numbers. Recommended if `mission-author` has not built
a map from scratch since Qarn Hadid.

**Before arc 1:** the distinctness spec (report-only) and the light rotation (§10).

---

## 12. Playtest plans that need re-scripting

`tools/src/backtest/playtest.ts` scripts every plan in **tile coordinates**, so
every mission that moves map needs its plan, its passive control and any probe
rewritten. **19 missions, in 7 arcs.** Probe counts are the `run()` and probe
call sites in `playtest.ts` today.

| arc | missions to re-script | call sites | also touched |
|---|---|---|---|
| WH | II, III, IV, V | 2 / 2 / 4 / 4 | `wadi_halam_variants.test.ts` (retire), `wadi_halam_5_depot_fence.test.ts`, `first_light_fence.test.ts`, `building-captures.ts`, `walk_placements.ts` |
| UZ | II, III, IV | 3 / 5 / 3 | `umm_zeitoun_variants.test.ts` (retire), `renderer-options.test.ts`, the `heli_peten_gunship` bought-probe on UZ IV |
| KR | II, III | 3 / 9 | — |
| DA | II, III | 5 / 3 | — |
| QH | II, III | 3 / 5 | — |
| BS | II, III, IV | 1 / 2 / 3 | `beit_sahwan_variants.test.ts` (retire), `deploy_choice.test.ts`, `garage-seed.ts`, `walk_carryover.ts`, `walk_world.ts`, the `recon_zikit` bought-probe on BS IV, `routes-check.ts` (boots BS II) |
| TM | I, II, III | 3 / 3 / 3 | `tel_marum_variants.test.ts` (retire), `formation_walk.test.ts` (measured on TM II's force), `saddle-price.ts` (TM III's instrument), `routes-check.ts`, `load-profile.ts` |

**Carry-over:** plans chain ledgers (`led1 → BS II → ...`), so a re-scripted
mission changes the survivors the next mission's plan inherits. Re-run the whole
arc chain, not one mission.

**Unchanged:** BS breach, BS I, KR I, DA I, QH I, UZ I, WH I (they keep their
maps). Their plans still run, but their downstream ledgers may move.

**What `pnpm playtest` cannot see** (CLAUDE.md): it asserts the outcome only. A
mission can run 7× long and stay green. So every arc PR records **minutes before
and after** for each moved mission. Anything that moves more than ~15% of its
own baseline goes back to the map. It shows most on missions with a `hold_for` or
`survive_until` primary, where the plan runs the clock out rather than racing it.

**The plan ladder re-measure** (the issue's gate): terrain moves difficulty
(memory: *"a single jeep swung First Light by five minutes"*). Re-run the
naive/sensible ladders per arc and put the win rates in the PR beside the
optimal plan.

---

## 13. Gates per arc PR

| gate | what it proves | note |
|---|---|---|
| `pnpm validate:data` | schema, symbols, zones in bounds, collapse zones hold a mouth, Sur maps `highland` | catches a missing marker id, not a misplaced one |
| `pnpm playtest` | every plan still wins, every passive control still loses | durations by hand, §12 |
| plan ladder | difficulty | win rates in the PR body |
| distinctness spec | the new maps are new | report-only until the last arc |
| a per-map doctrine block | each route and sight claim a briefing makes | replaces the retired `*_variants.test.ts`; every claim paired with a control map with one thing removed |
| `vehicle_conform_census.test.ts` | no false >10° hull tilt on any passable tile | holds every shipped map at 0, so relief maps must pass it |
| world-state walk | nothing spawns in a wall | memory: *a count-3 group occupies 3 tiles*; walk each placement |
| golden gate | untouched | no gated scenario map changes; BS III `combat` is report-only |
| `pnpm validate:meshes` / assets | unchanged | no new art |

---

## 14. Open decisions for the lead

1. **Mission 1 keeps its base map** (BS, KR, DA, QH, UZ, WH), so 19 new maps and
   not 25. The bases anchor golden scenarios, the menu diorama and doctrine
   tests. *Recommended: yes.*
2. **The distinctness gate measures feature identity at 35%**, not raw identity
   at 70%. Raw 70% would fail the breach against the tutorial (87%) and pass
   nothing useful. *Recommended: feature 35%, eight orientations, plus
   elevation.*
3. **Briefing numbers.** Ground honours the numbers the decision rests on (TM
   III's ten-tile detour, QH III's 17 vs 23, UZ III's scree against glacis);
   `narrative-designer` re-briefs the rest. *Alternative:* re-brief all of them
   and design the ground freely.
4. **`night` or `dusk`** for the three "tonight" missions (BS II, TM I, WH I). `night` renders as dusk today and would change when a
   real night preset lands. *Recommended: author `dusk`, so nothing changes under
   a later renderer PR.*
5. **Should the 19 new maps appear in `/free-play`?** Today every shipped map
   does. Twenty-six sandboxes would bury the six that are built for it.
   *Recommended: list base maps only (a picker filter, not a data change).*
6. **`d` as an irrigation cut in Naharin** (WH II if needed) draws as an
   anti-tank ditch. *Recommended: use bunds (`1`) and the stony bed (`b`) only,
   and keep `d` for the places a ditch was dug on purpose.*
7. **Build order:** worst numbers first (WH, UZ, ...) or Khan Rafid as the
   pipeline pilot. *Recommended: KR pilot if the author is new to from-scratch
   maps; otherwise WH first.*
8. **Light rotation first?** It is 16 one-line JSON edits with no map, and it
   lands the most visible change soonest. *Recommended: yes, as its own PR.*
