# Mission Design Document — Act II · Sur · **Qarn Hadid**, the pass road

**Date:** 2026-09-07 · **Status:** proposal. Nothing here is canon until the lead
signs §8.
**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`,
censused and *measured* this session. Every content claim cites a path; every
route, sight and structure figure below was produced either by
`tools/src/qarn_hadid_relief.test.ts` (quoted, not re-derived) or by driving the
real `Sim` and `FlowField` over `data/maps/qarn_hadid.json` today — method in the
Appendix.
**Read first:** `docs/campaign/README.md` (the contract),
`docs/campaign/storyline.md` (§0 decisions, §3.2 Act II, §4.3 the Qarn Hadid
sketch this expands), `docs/campaign/tel_marum/design.md` (the Act II MDD),
`docs/campaign/map-variants-design.md` §2 (the obstacle grammar and its five
rules), `docs/campaign/research-2026-09-03.md`.
**Downstream:** `narrative-designer` (§2, §5 story hooks), `level-scripter`
(§5 enemy and twists, §7), `mission-author` (all of it), `playtest` (§5.5).

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| D13 / D14 | Act II is Sur; it is landed as Tel Marum ×3 + Umm Zeitoun ×4; Karim Adhal ends on the crest at `umm_zeitoun_4_clearance` | lead, `storyline.md` §0.2 | **Qarn Hadid is an interlude inside a finished act.** It adds a third Sur town between the two and changes neither end of it. **No `qh_hvt_lantern`. Adhal is never on this map in person** |
| D1 / D2 | Shai Hammai, Idit Zohar, the two voices | lead | Shai is a **Major** across all three missions. `data/campaign/commander.json` needs **no change** — §7 C3 |
| D4 | One villain per front: atrocity at the front's opening, killed or captured at its end | lead | LANTERN's atrocity was told at `tel_marum_1_recon`; his end is Umm Zeitoun IV. At Qarn Hadid he is present only in **what he built and where he put his eyes** |
| D8 / D10 | Fixed sequence; proximity → standoff → source | lead, GDD §2 | Qarn Hadid sits third-from-last in Sur, before Umm Zeitoun. Naharin's `unlock.after_mission` stays `umm_zeitoun_4_clearance` — §7 C2 |
| D9 | Static continuity, authored text only | 2026-08-21 spec | no line below branches on the ledger |
| D11 | Doctrine, never a people, a faith, a real place or a real insignia | GDD §2 | Qarn Hadid is a pass and a village on it. No new personal name is coined anywhere in this arc |
| — | The narrative engine slice landed (`say`, `say_on_fail`, `remove`, `starting_force.group`, `dispatch`/`aftermath`/`debrief`, `briefing_video`) | verified in `data/schemas/mission.schema.json` this session | every twist in §5 that needs a voice has one today |

**The register.** Sur's atrocity is told, never played, and it was already told a
town ago. What Qarn Hadid plays is the *machine*: a gate somebody poured concrete
across, a tube in a bowl nobody can see into, and a mast on a hill that cannot see
anything at all. Nothing here depicts a scene; the ceiling is Act I's.

---

## 1. Premise and plot options

### The premise

Between Tel Marum's pass and Umm Zeitoun's basin there is one road, and it goes
through a rock wall with two ways through it. One is **high**: a shoulder at the
crest of the mountain, level 6, eight tiles from the axis. One is **low**: a notch
at plain level carrying the road, eight tiles further out — and somebody has cut
an anti-tank ditch across it.

So the ground does the thing no shipped mission's ground does: **it disagrees
about the cheapest road depending on who is asking.** Measured through the real
`FlowField` and pinned in `tools/src/qarn_hadid_relief.test.ts`, from `[24,40]` to
`[24,12]`:

- a rifleman goes through the **saddle** — 332, against 354 through the shoulder;
- a vehicle goes through the **shoulder** — 354, because the ditch shuts the
  saddle to anything wheeled or tracked; fill the ditch in and it takes the
  saddle at 332;
- flatten the map and the rifleman goes through the **shoulder** (304 vs 320).
  The relief route is **two tiles longer** and shares nothing with the flat one
  but its two endpoints. This is a reordering, not a price.

And the two gates are **nine tiles apart with a level-7 horn between them.**
Measured this session at sights 9, 12 and 48: a post standing in the shoulder gap
sees **20 of 20** shoulder tiles and **0 of 20** saddle tiles; a post in the
saddle notch sees the exact mirror. **Neither half of a split force can see, or
support by fire, the other half, from the moment it enters its gate until it is
out the far side.**

That is the whole arc. Everything below is a different way of asking the player
to accept it.

---

### Option A — *"The Two Gates"* · recon → foothold → clearance · **RECOMMENDED**

Three missions. The wall is the subject of all three, and the split is forced a
different way each time.

- **Phase ladder:** 2 → 3 → 5. Three missions, the town guideline's floor,
  matching the storyline's §4.3 sketch.
- **What the player decides, town-wide:** *which half of the force goes first, and
  what the other half is worth while it waits.* In **I** the drone can cross a
  gate for free and the eastern pocket cannot be droned at all, so the picture and
  the civilians compete for the same men on the same 240-second clock. In **II**
  the high gate is physically closed — a poured revetment — so the infantry can
  cross at once, alone, into a notch watched from both sides, while the armour
  cannot cross at all until the engineers open the shoulder; and the economy buys
  units that are gate-locked by domain. In **III** the second ditch across the
  village approach repeats the trick inside one mission: **the armour's road into
  the town runs under the hill the relay sits on**, measured.
- **How the villain shows:** the revetment (his engineering), the tube in the
  Hollow with its eyes forward on the scree bench (his doctrine), and the relay
  mast on the blind hill (his link to the next town's guns). He is not killed and
  is not present.
- **Cost:** three mission JSONs, three `playtest` plans and three passive
  controls, one schema enum value, one `world.json` town, **one additive map
  marker**, one line in GDD §2, and one line in the campaign-board exporter plus a
  re-export (§6, §7). No new art is authored.
- **Buys:** Act II gets the three-town weight Act I has; the tree's most
  elaborate map stops being sandbox-only; and the campaign gains the one decision
  it has never posed — a force that cannot arrive together.

### Option B — *"The Pocket, then the Pass"* · recon → foothold → buildup → clearance

Four missions. The first two happen **south of the wall**: the eastern pocket
(scree and the Hollow) is its own fight before the gates are ever touched, and the
build-up is where the crossing force is bought.

- **Phase ladder:** 2 → 3 → 4 → 5. Ascending, and it uses the one phase GDD §4
  gives breathing room to.
- **Why it is mechanically different from A:** the split is bought by the
  **scree** rather than by the gates. Pinned: `[40,31]`→`[40,23]` is **8 tiles on
  foot and 20 by vehicle**, and with the boulders cleared both are 8. So the
  eastern pocket is foot country and the player learns the domain lesson on his
  own side of the wall, where a mistake is survivable. Then the build-up turns
  the lesson into a **procurement** decision no mission in the game poses: with
  the high gate still shut, a Namer you buy can only ever use a road that is not
  open yet, and a rifle section can go now.
- **Cost:** a fourth mission, and the war's **third** build-up. `wadi_halam_3`'s
  briefing calls itself "the only breathing room the brigade ever gets" and Umm
  Zeitoun II already dented that; a third would retire the line.
- **Buys:** the cleanest teaching order in the arc, and a genuinely new use of the
  economy.

### Option C — *"The Iron Horn"* · recon → foothold → clearance, with the town forbidden

Three missions, same phases as A, different objectives in the third: the terminal
target is the **relay on the terraced knoll**, the village is `flagged_zones` with
`fail_below: 55`, and the clearance is `eliminate_hvt` + `capture the_terraces` +
`evacuate_before` with **no `capture village` at all**. You take a hill and you do
not fight in the town you are walking past.

- **Why it is mechanically different from A:** A's third mission is a town
  clearance with an ROE corner; C's is a **restraint mission with a climb in it** —
  the highest ROE pressure in Act II, and the knoll is cover 3 with a rock core,
  reached by a four-level climb. Pinned: on the cover-3 terrace at `[27,15]` an
  `inf_squad` under 90 s of rifle fire loses **less than a fifth** of the HP it
  loses in the open, and the open tile wipes it in **9 runs of 10**.
- **Cost:** the arc ends without the road being opened, which is the thing the
  arc is about. And the honest warning from the same test file: **cover 2 and
  cover 3 are not separable in a duel** (`COVER_HIT` = 1 / .375 / .1375 / .09), so
  the knoll's fictional strength is bigger than its mechanical one.
- **Buys:** the strongest restraint beat available on this ground, and it needs
  no `capture` of a 180-tile zone in seven minutes.

### Recommendation

**Option A.** Three reasons, in order of weight:

1. **It is the only option in which the map's own idea is the mission's idea in
   every mission.** The map exists to make domains disagree; A disagrees three
   times, on three different obstacles (the ditch at the notch, the revetment at
   the shoulder, the second ditch at the village), each one measured.
2. **B is right and too expensive.** Its teaching order is better and its
   build-up is a real invention, but it costs a fourth mission and the third
   build-up in a fourteen-mission war, on a town whose whole argument in
   `storyline.md` §4.4 is *"it is nearly free."* If the lead wants four, take B —
   it is the better game and the worse trade.
3. **C's ending is wrong for an interlude.** Qarn Hadid is the road to Umm
   Zeitoun. An arc that ends with the road still closed hands the next town a
   contradiction. C's restraint knot survives inside A as the flagged clinic in
   III (§5.3), at a fraction of the cost.

### Killing my own favourite

The plot I most wanted was **"the armour never crosses"** — the whole vehicle
half stays on the southern plain and supports the infantry through the gates by
fire, which would make the two-piece force permanent instead of temporary.

**It is measured dead.** From `south_plain [24,33]` at sight 12 — better than any
KDF ground unit except the sniper and the drone — **2 of the 20 shoulder-gate
tiles and 0 of the 20 saddle tiles** are visible, and nothing north of the wall is
visible at all. A Lavi (sight 12, gun range 12) parked on the plain has nothing to
shoot. The wall is opaque, so armour left south is not "in overwatch", it is
absent. Recorded rather than tuned around: this is the same shape as CLAUDE.md's
Tel Marum finding that the corridor needs something that *shoots* it, not
something that *watches* it.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | II of III. Sur · Sarim Brigades · **third town**, between Tel Marum and Umm Zeitoun. *Standoff* |
| **Where it sits in fiction** | the pass road that joins them. Tel Marum was the gateway into Sur; Umm Zeitoun is the basin where the batteries live; Qarn Hadid is the twelve kilometres in between that the brigade has been driving round for two weeks |
| **Shai's rank on entry** | **Major**, 3 stars |
| **Shai's rank on exit** | **Major.** No promotion inside a town, and no act boundary here. Lieutenant Colonel still arrives after `umm_zeitoun_4_clearance` |
| **`commander.json`** | **no change.** Campaign order is the flattened `world.json` order (`commanderRankFailures`, `tools/validate_narrative.mjs`), and the Major entry's `until_mission` is `umm_zeitoun_4_clearance`, which stays later than all three Qarn Hadid missions once they are inserted between Tel Marum and Umm Zeitoun |
| **Idit's intel thread** | continuous with both neighbours and, for the first time, **priced by a domain**. At Tel Marum the drone was free; at Umm Zeitoun a MANPAD made a look expensive. Here the drone is free *through a gate* and cannot buy the eastern pocket at all, so the picture and the civilians compete for the same men. What she carries out is the same key both neighbours use: `intel.marked_positions` |
| **The villain's atrocity** | already told (Tel Marum I's week of rockets). Qarn Hadid adds his **signature**, not a new atrocity: the anti-tank ditch he cut across the village's own approach at `y=11, x=20–34`, with the town on the far side of it. He did not defend the pass; he priced it, and the price is paid by whoever still lives there |
| **The villain's presence, mission by mission** | **I** the tube in the Hollow — dead ground on the *player's* side of the wall — with its eyes forward on the scree bench, which is the Sur thesis restated: the weapon is the eyes. **II** the poured revetment across the high gate: engineering, done before the brigade arrived, with a section garrisoned in it. **III** the relay mast on the terraced knoll, the one hill on the map that sees nothing, because a mast is not an eye |
| **The villain's end** | **not here.** `umm_zeitoun_4_clearance`, `eliminate_hvt(uz_hvt_lantern)`, unchanged |
| **Ledger in** | `roster.surviving_units` (Tel Marum III's survivors), `roe.mission_ratings`, `campaign.completed_missions`, `intel.marked_positions` (produced by `tel_marum_1_recon`) |
| **Ledger out** | `R M C` from all three, `I` from I and III, `civ.settlements_evacuated` from I and III. All five keys exist and the runtime produces exactly these; `civ.settlements_evacuated` is still read by nothing, and **no line may branch on it while D9 stands** |
| **What Umm Zeitoun inherits** | a roster that has crossed a wall the wrong way round, a `marked_positions` list two towns long, and one story fact its own briefings can lean on: the relay that carried the pass's picture to the batteries is down, so the basin's guns are slower to be told |
| **`world.json`** | one new town in `regions[sur].towns`, between `tel_marum` and `umm_zeitoun`. **Umm Zeitoun's place in the chain does not move** and Naharin's `unlock.after_mission` stays `umm_zeitoun_4_clearance` — §7 C2 |

---

## 3. Map overview — `data/maps/qarn_hadid.json`

**PRESENT.** 48×48, `terrain: "arid"`, elevation grid 0–7 (every other shipped map
tops out at 4), the only map carrying all ten terrain symbols and the only place
`3` (cover 3) and `d` (anti-tank ditch) are authored at all. Twelve markers, seven
zones, 20 structures. **No mission uses it.** No `tunnels` block, so nothing here
can be a `collapse`.

### 3.1 The shape, north to south

| feature | tiles | what it is |
|---|---|---|
| **the village** | zone `village [20,1,18,10]` (x20–37, y1–10) | the pass-road town: 1 apartment, 3 houses, 1 shanty, 1 walled warehouse compound (12 `=` wall tiles), on a road that runs east–west along y=6 |
| **the clinic** | zone `clinic [42,6,5,5]` (x42–46, y6–10) | one `house` structure at the village's eastern end, in its own zone, with a walled yard around it. **The only zone on the map holding exactly one structure** |
| **the terraces** | zone `the_terraces [8,5,7,7]`, marker `knoll_top [10,9]` | a terraced knoll in the north-west: cover-3 benches around an impassable `^` core, elevation to 5. Cover 3 is authored **nowhere else in the game** |
| **the second ditch** | `d`, x20–34, y=11 | an anti-tank line across the village's own approach. Two ways round it: the **west end at x=17–19** and the **east end at x=35–37**, through the thorn grove |
| **the thorn grove** (`o` draws the arid grove species since 2026-09-07 — the lead: *"using olive tree does not fit the desert terrain"*; `TerrainTones.groveFamily`) | `o`, x35–43, y11–15 | cover 1, elevation to 4; the eastern approach to the village and the east ditch end |
| **the cover-3 block** | `3`, x26–33, y14–16 | heavy cover straddling the road just north of the wall. `[32,15]` is the tile that watches the low gate |
| **the wall** | `^`, y18–22, full width but for two gaps | impassable, sight-blocking, no HP. The horn between the gaps is elevation **7** |
| **the shoulder gate (high, west)** | x18–21, y18–22; marker `shoulder_gate [20,20]` | open ground **at the crest**: elevation 6, five levels above the plain either side. **The only road north for a vehicle** |
| **the saddle gate (low, east)** | x29–32, y18–22; marker `saddle_gate [30,22]`; road at x=30 | a notch at **plain level (1)** carrying the road — and the `d` ditch runs across all four of its tiles at y=20. **Foot only** |
| **the southern plain** | y23–33; markers `south_plain [24,33]`, `kdf_start [24,39]` | open, knolls, groves in the south-west; zone `south_staging [16,34,17,12]` behind it |
| **the scree** | zone `scree [33,23,15,6]`, `b` x34–47, y25–30 | a boulder fan splitting the eastern flank. Markers `scree_north [40,23]`, `scree_south [40,30]`; the **bench at x=33** is the one column armour can use |
| **the Hollow** | zone `hollow [31,31,15,15]`, marker `hollow_floor [38,38]` | a bowl: floor at elevation **0**, rim at 3. Marker `east_post [45,33]` on its eastern lip |
| **the refuge** | marker `civ_refuge [10,43]` | south-west, behind the staging ground. **It sits inside no declared zone** — see §7 G9 |

### 3.2 The routes, measured

**Quoted from `tools/src/qarn_hadid_relief.test.ts`** (pinned, every positive
paired with a control built from the same map with one thing removed):

| claim | number |
|---|---|
| foot `[24,40]`→`[24,12]` | takes the **saddle**; flattened, takes the **shoulder** |
| the two routes | 30 tiles with relief, 28 flat; they share **only their two endpoints** |
| forced through each gate, flat | shoulder **304**, saddle **320** |
| forced through each gate, with relief | shoulder **354**, saddle **332** |
| what the shoulder pays | exactly **50** = 5 levels × `UPHILL_PER_LEVEL` |
| vehicle `[24,40]`→`[24,12]` | takes the **shoulder** (354); with the ditch filled in, the **saddle** (332) |
| scree `[40,31]`→`[40,23]` | foot **8**, vehicle **20**; boulders cleared, both **8** |
| the Hollow `[28,38]`→`[46,38]` | route **identical** with relief and flat; 230 vs 180. A 16-tile bowl prices ground and reorders nothing |
| elevation at the wall | horn `[24,20]` = **7**, shoulder gate `[20,20]` = **6**, saddle notch `[30,20]` = **1** |
| the ditch, as authored | two straight runs and no junction tile: `x20–34, y11` and `x29–32, y20` |
| cover 3 at `[27,15]` | over 10 seeds an `inf_squad` loses **< 0.2×** the HP it loses in the open; the open tile wipes it in **9 of 10** runs, cover 3 in **0**. And **2 vs 3 is not separable** |

**Measured this session** (method in the Appendix), all from `kdf_start [24,39]`:

| from → to | foot | vehicle | gate used |
|---|---|---|---|
| `north_junction [24,12]` | **29 tiles** / 322 | **27 tiles** / 344 | foot **saddle**, vehicle **shoulder** |
| `village_square [28,5]` | **34** / 374 | **39** / 486 | foot **saddle**, vehicle **shoulder** |
| `knoll_top [10,9]` | 31 / 442 | 31 / 442 | both **shoulder** |
| `scree_north [40,23]` | **16** / 244 | **22** / 280 | neither (south of the wall) |
| `hollow_floor [38,38]` | 14 / 164 | 14 / 164 | neither |
| `civ_refuge [10,43]` | 14 / 166 | 14 / 166 | neither |

The vehicle route to the village walks the **x=19 column** from the plain to the
wall and crosses the second ditch at its **west end, `[19,11]`** — under the
terraced knoll — then enters the town from the west at `[20,9]`.

**Two armour roads into the village, one per ditch end**, so map-variants rule 2
(two routes, no shared chokepoint) holds by construction:

| from | vehicle | foot | crosses the second ditch at |
|---|---|---|---|
| shoulder gate's north exit `[20,17]` | **17 tiles** | 13 | **x=19** (west end, under the relay hill) |
| saddle gate's north exit `[30,17]` | **23 tiles** | 12 | **x=37** (east end, through the thorn grove) |

### 3.3 The sight facts the arc is built on

All measured this session with the real detection path, at the sight ranges the
shipped roster actually has (`sarim_rifles` 9, `recoilless_team` 8,
`manpad_team` 12, `mbt_lavi` 12, `recon_drone`/`sniper_team` 16) and at 48 for
pure terrain.

1. **The gates cannot see each other, at any range.** `[20,20]` sees 20/20
   shoulder tiles and **0/20** saddle tiles; `[30,20]` the mirror. True at 9, 12
   and 48.
2. **Who can watch the low gate, at rifle range:** `[32,15]` on the cover-3 block
   sees **20 of 20** notch tiles at sight 9; the scree bench `[33,26]` sees
   **17 of 20**. One post north of the wall, one south of it.
3. **Who can watch the high gate:** `[24,12]` 8/20 at sight 9 and 11/20 at 12;
   the west ditch end `[18,11]` 9/20 at 9; the knoll's east shoulder `[14,12]`
   5/20 at 9 and 11/20 at 12. Nobody sees more than 12 of 20 from outside it.
4. **The relay hill is blind.** `knoll_top [10,9]` at sight 48 sees the shoulder
   gate and **nothing else on the map** — not the village, not the junction, not
   the ditch. It sees **0 of 10** tiles of the armour's road. But the knoll's
   **east shoulder** does: `[15,8]` sees 8/10 at sight 8, `[14,12]` 7/10,
   [**corrected at authoring, 2026-09-07** — the 10-tile road sample does not
   reproduce from the script's definition (it is 7 tiles); measured through the
   real `Sim` and pinned in `tools/src/qarn_hadid_doctrine.test.ts` S8c–S11:
   `knoll_top` sees **4 of 7**, not 0; `[15,8]` 4/7; `[14,12]` (the Kornet) **7/7**;
   `[13,10]` 5/7. III's briefing beats 4–5 were rewritten to those numbers.]
   `[13,10]` 6/10. The mast sits where it cannot see; the rifles sit where they
   can.
5. **The Hollow is dead ground twice over.** `hollow_floor [38,38]` at sight 48
   sees only its own rim, and nothing outside the bowl sees into it. Within a
   Grad's 20-tile range of it: `kdf_start` 14.0, `south_plain` 14.9,
   `saddle_gate` 17.9 — and **not** `shoulder_gate` (25.5) or `north_junction`
   (29.5). **The tube covers the low road and cannot reach the high one.**
6. **The tube's eyes have to be forward.** Nothing in the scree sees `kdf_start`
   at sight 8, 9 or 12. The bench `[33,26]` at sight 8 sees `[28,32]` and
   `[30,30]` and no further west. So the Grad can only be given the eastern half
   of the plain, and only by that one post — kill it and the tube is blind.
7. **`the_gates [17,16,17,9]`** is 153 tiles: **108 foot-passable, 104
   vehicle-passable**, the difference being the four ditch tiles.
8. **Structures by zone:** `village` 18 (1 apartment, 3 houses, 12 walls, 1
   shanty, 1 warehouse), `clinic` 1 house, and **zero** in `the_gates`, `hollow`,
   `scree`, `south_staging`, `the_terraces`.
9. **Markers in zones:** `kdf_start`→`south_staging`; `shoulder_gate`,
   `saddle_gate`→`the_gates`; `village_square`→`village`; `knoll_top`→
   `the_terraces`; `scree_north`→`scree`; `hollow_floor`, `east_post`→`hollow`.
   **`south_plain`, `north_junction`, `scree_south` and `civ_refuge` are in no
   zone at all.**

### 3.4 What is deliberately NOT changed

No character-grid edit, no elevation edit, no zone edit, and **no per-mission
variant** — `docs/campaign/map-variants-design.md` §3's ladder has no Qarn Hadid
row, and this map is already the most shaped ground in the tree. The single
additive change the arc needs is **one marker** (§7 C4), and an optional variant
for III is offered as O-QH7.

---

## 4. Mission ladder

| # | id · name | phase | target | primaries (type · target) | secondaries | ledger requires / produces | econ |
|---|---|---|---|---|---|---|---|
| I | `qarn_hadid_1_recon` · *Both Gates* | recon | **6** | `locate` · `qh_watch_shoulder` · `locate` · `qh_watch_notch` · **`evacuate_before` · `south_staging` (count 2, 240 s)** | `locate` · `qh_hvt_tube`; `locate` · `qh_watch_bench`; `locate` · `qh_atgm_ditch`; `survive_until` 300 | **R** / **R M C I E** | n |
| II | `qarn_hadid_2_foothold` · *The Shoulder* | foothold | **7** | `hold_for` · `the_gates` (180 s) · **`raze` · `the_gates` (300 s)** | `capture` · `hollow` (15 s); `eliminate_hvt` · `qh_watch_bench` | **R I** / **R M C** | **y** |
| III | `qarn_hadid_3_clearance` · *The Village Road* | clearance | **7** | `capture` · `village` (20 s) · `eliminate_hvt` · `qh_hvt_relay` · **`evacuate_before` · `clinic` (count 3, 300 s)** | `capture` · `the_terraces` (15 s); `locate` · `qh_watch_grove` | **R I** / **R M C I E** | **y** (was `n` here; §5.3, the sheet and the script all author it, and the JSON does) |

Phases ascend **2 → 3 → 5**. Every objective type is one of the nine the runtime
runs; no `mark`, `escort` or `no_collateral_above` appears anywhere. Every
`target_minutes` is inside the schema's 5–7 band.

**The failable primary is in bold on every row**, and it is the whole passive-loss
argument: `raze`, `collapse` and `evacuate_before` are the only three types that
can reach `failed`, and a failed primary is a defeat in `checkEnd`. Tel Marum
carries none of them and all three of its passive controls end **`ongoing`** —
stuck, not lost, which is the state this pipeline refuses (`tel_marum/design.md`
§3.1). **Qarn Hadid is designed to that rule from the first line**, exactly as Umm
Zeitoun and Wadi Halam now are.

III's primary set is deliberately the same shape as `tel_marum_3_clearance`'s
(`capture` + `eliminate_hvt` + `evacuate_before`), which is shipped, measured and
plays in 3.5 minutes on its plan.

---

## 5. Per mission

Coordinates below are tile centres for `mission-author` to place from; every one
was checked against the map's rows and elevation this session and the symbol is
given where it matters. **Placements spread across tiles** — a count-3 group
occupies three tiles — so a clear `at` does not promise clear ground for its
siblings.

### 5.1 I — `qarn_hadid_1_recon` · *Both Gates* · recon · 6 min

**Player starting state.** `map.player_start [24,42]` (road, inside
`south_staging`). No economy, no `structures[]`.

| unit | count | from | at |
|---|---|---|---|
| `recon_drone` | 1 | — | `[24,41]` |
| `jeep_shoded` | 1 | — | `[22,43]` |
| `inf_squad` | 2 | `from_ledger` | `[24,43]` |
| `at_team` | 1 | `from_ledger` | `[26,43]` |
| `apc_eitan` | 1 | — | `[25,44]` |

**Civilians — the road party.** Four, in two groups, on the pass road **east** of
the staging ground and outside the arrival zone: 2 at `[34,31]` and 2 at
`[36,32]` (open ground, elevation 2 and 3). `civilians.refuge: "kdf_start"`
`[24,39]`, and the `evacuate_before` target is zone **`south_staging`
`[16,34,17,12]`**, which contains that marker — so **this mission needs no map
change at all.**

Measured, and stated plainly because it decides how the objective plays: from
`[34,31]` the foot line to the refuge is **10 tiles and it crosses into
`south_staging` after 3 of them**, and the party is **11 tiles from
`player_start` for both a rifleman and a jeep.** So the walk home is short and
**the whole cost is the reach** — the party sits inside the scree bench's 8-tile
eye and inside the Hollow tube's 20-tile arc, and it is in the same direction as
the two tags the drone cannot buy. One force, two errands, one clock.

**If `playtest` finds the evacuation resolving inside the first minute**, the dial
is the spawn, not the deadline: move the party onto the scree's southern apron
(the `b` field, x34–47, y25–30), where **no carrier can reach them at all** —
foot crosses it in 8 tiles and a vehicle goes 20 round — and the rescue becomes
the domain split in miniature. Do not lengthen the walk home; map-variants rule 4
is about exactly that.

The jeep and the Eitan are there for one reason and the briefing should say so:
they carry 2 each, and `CivilianFlight` boards civilians into any player carrier
with a free slot inside 4 tiles (`packages/sim/src/civilians.ts`,
`SHEPHERD_RADIUS_SQ`). **Driving is how you beat the clock; walking is how you
lose it.**

**Enemy stance.**

| tag / group | unit | at | stance | why there |
|---|---|---|---|---|
| `qh_watch_shoulder` | `sarim_rifles` ×1 | `[24,12]` `.` | `hold_position` | watches the **high** gate: 8/20 of it at his own sight 9 |
| `qh_watch_notch` | `sarim_rifles` ×1 | `[32,15]` cover 3 | `hold_position` | watches the **low** gate: **20/20** at sight 9 |
| `qh_watch_bench` | `recoilless_team` ×1 | `[33,26]` `.` | `ambush(4)` | the tube's forward eye; sees the eastern plain inside 8 tiles |
| `qh_atgm_ditch` | `atgm_cell` ×1 | `[14,12]` `.` | `hold_position` | the deep tag. Covers the west ditch end (7/10 of the armour leg at sight 8) — and comes back in **III** as an `ambush` |
| `qh_hvt_tube`, group `tube` | `rocket_battery` ×1 | marker `hollow_floor` | `hold_position` | dead ground; range 20 reaches the start line and the low gate, not the high one |
| `qh_manpad_scree` | `manpad_team` ×1 | `[40,30]` `.` | `hold_position` | missile 13, air-only: the drone cannot buy the pocket. **Open ground, not on the `b` field** — see §7 G2 |
| — | `sarim_rifles` ×1 | patrol `[30,16] → [30,22]` | `patrol` | a picket walking the road through the notch, so the low gate is not a still photograph |

**Waves.** 150 s: 1 `sarim_rifles` from `north_junction` to `saddle_gate`, with a
`say` — the low gate is being reinforced while you look at it. 260 s: 1
`sarim_rifles` from `north_junction` to `shoulder_gate`.

**Triggers.** `zone_entered(scree)` → `spawn` 1 `sarim_rifles` at `scree_north`,
with an Idit `say`: the pocket is not empty. `casualties_pct(40)` →
`withdraw_to village_square`, group `tube` — he does not leave a tube to be
overrun.

**The decision.** *The drone goes north; the men go east; there is one clock.*
The two gate-watch posts are 8.5 tiles apart and one drone sortie through the
saddle can identify both — that is the primary pair and it is achievable. The
three tags that matter later are all somewhere the drone cannot help: the bench
and the tube are under the MANPAD's 13-tile envelope, and `qh_atgm_ditch` is 17
tiles deep past the notch. Meanwhile the road party will not move until a soldier
is within 4 tiles of them, and the same men are the only ones who can go east.
**Every tag you skip is bought back at full price in II and III.**

**Passive-player loss.** A passive force parked at `[24,42]` is seen by nothing —
measured: nothing in the scree sees `kdf_start` at sight 8, 9 or 12 — so the tube
never fires, the civilians are never suppressed, nobody walks, and
`evacuate_before` fails at **240 s**. Defeat by clock, with no wipe required.
`playtest` must confirm this on the passive probe.

**Twist candidates** (for `level-scripter` to classify):

- **T-QH1 "The tube is behind you."** The Grad is in the Hollow, on the player's
  own side of the wall, and its eyes are the recoilless team on the bench. *Almost
  certainly expressible today* — placement plus a `say`; the firing itself is the
  engine's per-side identification rule doing its own work.
- **T-QH2 "Two gates, one drone."** On `zone_entered(the_gates)`, a `say` from
  Idit naming which gate the picture is now about. *Expressible today.*
- **T-QH3 "They are on the road, not in a house."** The road party is a group with
  a `remove` trigger at `timer_s(250)` if they were never reached — the Sarim move
  them off, and the objective has already failed by then. *Expressible today*
  (`do.kind: "remove"` with `group`, shipped and used by `umm_zeitoun_1_recon`).
  **Use it or do not, but do not let a failed evacuation leave four civilians
  standing in a field for the rest of the mission.**

**Story hooks** (`narrative-designer`): the `dispatch` names the pass road as the
thing the brigade has been driving round for two weeks. Idit's beat is that this
is the first ground where the *map* is the intelligence — she can tell him which
gate the vehicles can use before anybody has seen an enemy. Shai's beat is the
cost line: two vehicles, two seats each, and a family on the road.

### 5.2 II — `qarn_hadid_2_foothold` · *The Shoulder* · foothold · 7 min · **economy**

**Player starting state.** `player_start [24,42]`.

| unit | count | from | at |
|---|---|---|---|
| `inf_squad` | 3 | `from_ledger` | `[24,43]` |
| `at_team` | 1 | `from_ledger` | `[26,43]` |
| `mortar_team` | 1 | `from_ledger` | `[23,44]` |
| `demo_squad` | 1 | — | `[22,43]` |
| `mbt_lavi` | 1 | — | `[26,44]` |
| `ifv_namer` | 1 | — | `[20,44]` |
| `apc_eitan` | 2 | — | `[25,44]` |
| `recon_drone` | 1 | — | `[24,41]` |

`resources`: `logistics_start 500`, `logistics_rate_per_min 130`, no intel (the
campaign has no intel economy — §7 G7). `structures`: one `camp`, size `[2,2]`,
at `[25,34]` (cover-2 open ground inside `south_staging`; 13.6 tiles from the
Hollow, so **inside a Grad's range if the tube ever comes back south** — that is
the point of the `capture hollow` secondary).

**The revetment.** One mission-placed structure: `{ "type": "concrete", "at":
[18,19], "size": [4,1] }` — four tiles of poured concrete across the **whole
width of the shoulder gap**, at the row above the crest. The gap is x18–21 with
`^` at x=17 and x=22, so this **seals the high gate to both domains** until it
comes down; the saddle is untouched and open to foot from t=0.

Three facts that make it work and one that would break it:

- `concrete` is `hp_per_tile 700`, `roe_penalty 3`, `garrison_slots 2`
  (`data/structures.json`). It is **not** `low_profile` and **not** `per_tile`, so
  it is a legal `raze` target — unlike `wall` and `fence`, which are both and are
  refused by `tools/validate_data.mjs`.
- A destroyed building leaves **passable rubble** (`packages/sim/src/sim.ts`
  ~4569: "a collapsed building leaves rubble a vehicle can cross"), so razing it
  genuinely opens the gate.
- Garrison a `sarim_rifles` inside it. That gives the player a **second** road to
  the primary — the automatic structure-fire path needs a hostile inside a
  building, so a garrisoned revetment can be shot down by the Lavi, while an empty
  one can only be demolished by the `demo_squad`'s charges.
- **Do not place a `wall` here instead.** `validate_data.mjs` scans the map's
  *rows* for bad raze types and never sees mission-placed structures, so a
  `wall` revetment would pass the gate and produce a mission no demolisher will
  touch. That validator hole is §7 G1.

**Enemy stance.**

| tag / group | unit | at | stance |
|---|---|---|---|
| group `gate` | `sarim_rifles` ×1 | garrison the revetment, `[19,19]` | `garrison` |
| group `gate` | `sarim_rifles` ×1 | `[21,17]` (elev 3, north of the shoulder) | `hold_position` |
| group `gate` | `atgm_cell` ×1 | `[19,16]` (elev 3) | `hold_position` |
| `qh_watch_notch` | `sarim_rifles` ×1 | `[32,15]` cover 3 | `hold_position` |
| `qh_atgm_saddle` | `atgm_cell` ×1 | `[33,16]` | `ambush(6)` |
| `qh_watch_bench` | `recoilless_team` ×1 | `[33,26]` | `ambush(4)` — **pre-identified and ambush-forfeited if I found it** |
| `qh_manpad_scree` | `manpad_team` ×1 | `[40,30]` | `hold_position` |
| — | `sarim_rifles` ×1 | `[38,38]` (`hollow_floor`) | `hold_position` — the stay-behind that makes `capture hollow` a fight |
| `qh_hvt_tube`, group `tube` | `rocket_battery` ×1 | `[26,13]` | `hold_position` — **displaced north**: from there it reaches both gates (8.5–8.9 tiles) and **not** the camp (21.0) |

**Waves.** 120 s: 2 `sarim_rifles` from `north_junction` → `shoulder_gate`.
240 s: 1 `recoilless_team` from `village_square` → `saddle_gate`. 330 s:
2 `sarim_rifles` from `village_square` → `saddle_gate`, with a `say`. Cadence: one
push per gate, alternating, so neither half of the split force gets a quiet
mission.

**Triggers.** `zone_entered(the_gates)` → `commit` group `gate` to `saddle_gate` —
the garrison of the *high* gate walks to the *low* one, which the player cannot
see happening from where his armour is. `casualties_pct(40)` → `withdraw_to
village_square`, group `tube`.

**The decision.** *Which half goes first, and what you buy for the half that is
waiting.* Three strands, simultaneous, none able to see the others:

1. the infantry can cross at the saddle immediately, alone, into a notch covered
   20/20 from `[32,15]` and 17/20 from the bench;
2. the `demo_squad` must reach `[19,20]` and open the shoulder before 300 s, or
   the mission is lost;
3. the armour can do nothing until it opens — and it is the only thing that can
   hold the southern half of `the_gates` against the wave cadence.

And the economy is **gate-locked by domain**: at 130 logistics a minute the player
can buy roughly one Namer or three rifle sections across the mission, and a Namer
bought at t=120 cannot use any road until the engineers finish. **This is the only
mission in the game where what you buy is constrained by which obstacle it can
cross.** That is the reason the economy is here and not in a build-up.

**Passive-player loss.** The revetment stands, `raze` fails at **300 s**, defeat.
A passive player also never contests `the_gates`, so the `hold_for` never starts;
but it is the raze deadline that ends the mission, and that is deliberate — the
losable objective is the one the player must *act* on.

**Twist candidates.**

- **T-QH4 "The high gate was closed after the picture was taken."** The revetment
  does not appear in the recon at all and cannot: `intel.marked_positions` reveals
  **units by tag** and there is no way to pre-reveal terrain or a structure (§7
  G6). So this is a surprise by construction, and all it needs is Idit's line
  admitting the picture was a day old. *Expressible today* — an objective `say`.
- **T-QH5 "The gate you opened is not the gate they defend."** The
  `zone_entered(the_gates) → commit group gate → saddle_gate` above: the player
  spends five minutes opening the high gate and the enemy spends them walking to
  the low one. *Expressible today.*
- **T-QH6 "The tube went north."** The Grad that shelled the start line in I is now
  north of the wall, where it can reach both gates and nothing behind them.
  Nothing to build; it needs the `say` that makes the displacement legible.
  *Expressible today.*

**Story hooks.** LANTERN's engineering is his character here: he did not garrison
the pass, he **priced** it, and the concrete was poured before the brigade was
even in Sur. Shai's line is the one a Major says and a Captain does not — that he
is going to send men through a gate he cannot support, on purpose, and how long
they will be alone.

### 5.3 III — `qarn_hadid_3_clearance` · *The Village Road* · clearance · 7 min

**Player starting state.** `player_start [24,42]`. `resources`:
`logistics_start 400`, `logistics_rate_per_min 80` — the clearance trickle, the
same numbers `tel_marum_3_clearance` and `umm_zeitoun_3_clearance` carry.

| unit | count | from |
|---|---|---|
| `inf_squad` | 3 | `from_ledger` |
| `at_team` | 1 | `from_ledger` |
| `mortar_team` | 1 | `from_ledger` |
| `demo_squad` | 1 | `from_ledger` |
| `mbt_lavi` | 1 | — |
| `ifv_namer` | 1 | — |
| `apc_eitan` | 2 | — |
| `sniper_team` | 1 | — |
| `recon_drone` | 1 | — |

**Civilians.** Five, in two groups: 3 at `[29,3]` (cover 2, by the road) and 2 at
`[22,5]` (cover 2, by the apartments). `civilians.refuge: "clinic_yard"` — the
**new marker at `[44,10]`**, cover-2 open ground in the walled yard south of the
clinic house, inside zone `clinic [42,6,5,5]`. Measured line: `[30,3]`→`[46,9]`
is **17 tiles on foot**, `[29,8]`→`[46,9]` is 19 (both measured to `[46,9]`, two tiles from the proposed marker inside the same yard; `mission-author` re-measures to the marker itself) — short, on the player's axis of
advance, and it satisfies map-variants rule 4.

> **Why not the map's own `civ_refuge`.** `[10,43]` is in **no zone**, so a
> `evacuate_before` naming it throws at load (`mission.ts` ~748), and the walk
> from the village is **36–41 tiles through a contested gate** — rule 4's exact
> prohibition. The zero-edit fallback, if the lead refuses the new marker, is
> `refuge: "village_square"` / `target: "village"` with the families spawned
> *outside* the town; it inverts the fiction (they walk *into* the fight) and I do
> not recommend it.

**ROE.** `flagged_zones: ["clinic"]`, `fail_below: 45`. The zone the families are
walking into is the zone you may not put a heavy round into. From
`beit_sahwan_3_clearance`'s measured lesson, the penalty arms at
`collateral_risk >= 0.3`: the Namer's `cannon_30` trips it, rifles, `coax_mg` and
the Eitan's `rws_50` do not. **Keeping the armour off the clinic is the play, and
infantry can still fight there** — that is what makes this a decision rather than
a tax.

**Enemy stance.**

| tag / group | unit | at | stance | why |
|---|---|---|---|---|
| `qh_hvt_relay`, group `relay` | `sarim_rifles` ×2 | `[10,9]`, `[11,10]` (cover 3, elev 4) | `ambush(2)` | the mast party. They do not fire until you are on top of them — a relay crew does not give away a mast |
| — | `sarim_rifles` ×1 | `[15,8]` (knoll east shoulder, cover 2, elev 3) | `hold_position` | **sees 8 of 10 tiles of the armour's road at sight 8** |
| `qh_atgm_ditch` | `atgm_cell` ×1 | `[14,12]` | `ambush(6)` | Kornet range 10 over the west ditch end. **Pre-identified and ambush-forfeited if I found it** |
| group `village` | `sarim_rifles` ×2 | apartment `[22,3]`, house `[27,3]` | `garrison` | the town |
| group `village` | `recoilless_team` ×1 | warehouse yard `[34,9]` | `ambush(5)` | the compound |
| `qh_watch_grove` | `sarim_rifles` ×1 | `[39,13]` (thorn grove, elev 2) | `hold_position` | the eastern eye over the east ditch end. A `locate` secondary, and the tag Umm Zeitoun inherits |
| `qh_watch_notch` | `sarim_rifles` ×1 | `[32,15]` | `hold_position` | returns from I and II |
| `qh_manpad_north` | `manpad_team` ×1 | `[36,12]` | `hold_position` | prices the drone north of the wall |

**Waves.** 120 s: 2 `sarim_rifles` from `village_square` → `north_junction`.
240 s: 1 `recoilless_team` from `knoll_top` → `shoulder_gate`. 330 s:
2 `sarim_rifles` from `village_square` → **`clinic_yard`**, with a `say` — he is
putting rifles where the families are walking.

**Triggers.** `zone_entered(village)` → `commit` group `village` to
`village_square`. `casualties_pct(45)` → `withdraw_to knoll_top`, group `village`
— the town garrison falls back onto the relay hill, concentrating the last fight
on the ground the player has to climb.

**The decision.** *The knoll or the gauntlet.* The armour's road into the village
crosses the second ditch at `[19,11]` and runs directly under the terraces —
`[15,8]` sees 8 of its 10 tiles at sight 8, `[14,12]` 7 of 10, and there is a
Kornet at the second of those. The player can:

- take the knoll first with foot (a four-level climb onto cover 3, no armour help
  worth having, and the mast party will not shoot until you are on it), then walk
  the armour in safely; or
- send the armour round the **east** ditch end instead — 23 tiles from the saddle
  exit instead of 17 from the shoulder exit, through the thorn grove and under
  `qh_watch_grove`; or
- run the gauntlet and pay for it.

Meanwhile the families need 17 tiles of walking and will not start until a soldier
is inside 4 tiles of them, and the clock is 300 s.

**Recon quality, cashed.** Two tags carry from mission I into this one, and both
are `ambush` here:

- `qh_atgm_ditch` — identified in I, it spawns **pre-identified and forfeits its
  ambush** (`spawnPlacement`'s `preMarked`), so the Kornet over the armour road is
  a known gun instead of a first shot from nowhere;
- `qh_watch_bench` — identified in I, it was already disarmed in II.

**A player who flew the drone north and never sent anybody east gets both
ambushes live.** That is GDD §4's carry-over, authored rather than asserted, and
it is the reason mission I's secondaries are worth the clock.

**Passive-player loss.** The families never move; `evacuate_before` fails at
**300 s**; defeat.

**Twist candidates.**

- **T-QH7 "The mast is not an eye."** `knoll_top` at sight 48 sees nothing on this
  map but the shoulder gate. Idit's line is that the hill they have to take is the
  one hill from which nothing can be seen, and that is *why* it is worth taking:
  it is a relay, not an observer. *Expressible today* — an objective `say`.
  **Measured, so do not paraphrase it.**
- **T-QH8 "The clinic fills up."** The 330 s wave `to: clinic_yard`, or a
  `zone_entered(clinic) → spawn` of a section with `stance: garrison` on the
  clinic house: the enemy occupies the building the civilians are walking into,
  inside the flagged zone. *Expressible today.* The purest LANTERN bait on this
  map and the cruellest thing in the arc — **leave it to `playtest` to decide**
  whether the mission survives it (O-QH3).
- **T-QH9 "He gives the town back."** The `casualties_pct(45) → withdraw_to
  knoll_top` above. *Expressible today.* Note the risk `tel_marum/design.md`
  records for T-C1: a `withdraw_to` can walk a fight out of a scripted plan's
  reach, so `playtest` re-runs after it lands.
- **T-QH10 "His fire kills them and your score does not move."** Civilians are
  untargetable by either side and are hurt only by ordnance
  (`mission.schema.json`), and `stepRoe` only ever deducts for a `destroyed` whose
  `by` is a player unit. Placing the families on the axis his own indirect fire
  walks along makes the point without a scripted impact — the engine version
  (choosing where an enemy round lands) is still engine work, recorded at
  `tel_marum/design.md` T8. *Expressible today as a placement.*

**Story hooks.** The arc's last beat is the ditch, not the mast: he cut an
anti-tank line through the fields of a town he was not defending, and the people
on the far side of it are the ones now walking to a clinic. Shai's debrief line is
about the road being open and what it cost to open it; Idit's is that the next
town's guns will be slower to be told, which is the only thing the pass was ever
worth.

### 5.4 Karim Adhal across Qarn Hadid, in one table

| mission | what he does | what the player sees |
|---|---|---|
| I | puts a tube in the one bowl on the map that nothing can see into, and its eyes eight tiles forward on a boulder bench | rounds on the road with no one visible to have called them |
| II | had already poured concrete across the only gate armour can use | a five-minute engineering job under fire, while his garrison walks to the other gate |
| III | left a mast on a blind hill above the only road into the town, and a ditch through the town's own fields | the last climb, and a clinic full of people who live on the wrong side of his obstacle |
| — | **is never on this map** | his end is `umm_zeitoun_4_clearance` and nothing here may pre-empt it |

### 5.5 What `playtest` must measure, and in what order

1. **Three passive controls first.** Each must return **DEFEAT**, not `ongoing`.
   The argument is in §5.1–§5.3 and it rests on one measured fact — nothing in the
   scree sees `kdf_start` at any realistic sight — so if the passive probe on I
   comes back `ongoing`, the reason is that something *is* seeing the start line
   and the tube is suppressing the civilians into evacuating themselves. That is a
   real finding, not a tuning miss; fix it by moving the road party, not by
   widening the deadline.
2. **Then the three scripted plans**, and read the duration ratio only for II —
   it is the only mission of the three carrying an *endure* clock (`hold_for`
   180 s). I and III's clocks are deadlines, which are ceilings on the allowance,
   not floors on the length; GH-84's split says their ratios are uninformative.
3. **The domain assertions belong in a test, before any JSON is authored** — a
   `tools/src/qarn_hadid_doctrine.test.ts` beside the relief test, pinning: the
   two gates cannot see each other at 9/12/48; `[32,15]` sees 20/20 of the notch
   at sight 9; `knoll_top` sees 0/10 of the armour leg and `[15,8]` sees 8/10; the
   Hollow is within Grad range of the start line and not of the shoulder; the two
   armour roads into the village are 17 and 23 tiles and cross the ditch at x=19
   and x=37; and the civilian line from the village to `clinic_yard` is ≤ 20 tiles
   on foot. Every one of those is a number this document argues from.
4. **Re-run after any `withdraw_to` twist lands** (T-QH9), and after the II
   revetment's garrison is decided — a garrisoned revetment is a second route to
   the raze primary and changes the plan's shape.

---

## 6. Asset manifest

**Verdict: zero new art is authored, and it very nearly holds.** Every unit,
structure, decor family, VFX emitter and map this arc needs already ships. The one
row that breaks a literal "zero" is the **campaign board**, which needs a marker
node re-exported into an existing GLB from sources that are already on disk — a
one-line edit to a Python table and a re-run, not an art commission.

### 6.1 Units — all PRESENT

| unit | data | mesh | sprite |
|---|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` | `assets/sprites/INF_SQUAD` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` | `assets/sprites/INF_AT` |
| `mortar_team` | `data/units/kdf/mortar_team.json` | `art/meshes/mortar_team.glb` | `assets/sprites/INF_MORTAR` |
| `demo_squad` | `data/units/kdf/demo_squad.json` | `art/meshes/demo_squad.glb` | `assets/sprites/INF_DEMO` |
| `sniper_team` | `data/units/kdf/sniper_team.json` | `art/meshes/sniper_team.glb` | `assets/sprites/INF_SNIPER` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | — (sprite-only by design) | `assets/sprites/DRONE_RECON` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` | `assets/sprites/JEEP_HULL` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` | `assets/sprites/EITAN_HULL`, `EITAN_TURR` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` | `assets/sprites/NAMER_HULL`, `NAMER_TURR` |
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json` | `art/meshes/vehicles/mbt_lavi.glb` | `assets/sprites/TNK_HULL`, `TNK_TURR` |
| `sarim_rifles` | `data/units/enemy/sarim_rifles.json` | `art/meshes/sarim_rifles.glb` | `assets/sprites/INF_SARIM` |
| `atgm_cell` | `data/units/enemy/atgm_cell.json` | `art/meshes/atgm_cell.glb` | `assets/sprites/INF_ATGM` |
| `recoilless_team` | `data/units/enemy/recoilless_team.json` | — (sprite-only) | `assets/sprites/INF_RECOILLESS` |
| `manpad_team` | `data/units/enemy/manpad_team.json` | — (sprite-only) | `assets/sprites/INF_MANPAD` |
| `rocket_battery` | `data/units/enemy/rocket_battery.json` | `art/meshes/vehicles/rocket_battery.glb` | `assets/sprites/ROCKETBATTERY_HULL` |
| `civilians` | `data/units/civilians.json` | `art/meshes/civilians/` ×4 | **none, by design** — absent from `SPRITE_MAP`, so they draw nothing on `?renderer=pixi` or `&nomesh`. Inherited, not new |

**No new unit.** Nothing in this arc needs a type the war does not already field.

### 6.2 Structures — all PRESENT

| type | used for | mesh | sprite |
|---|---|---|---|
| `house` ×4, `apartment`, `shanty`, `warehouse`, `wall` ×12 | already in the map's rows (the village and the clinic) | `art/meshes/buildings/{house,apartment,shanty,warehouse,wall}.glb` + `_wreck` | `assets/sprites/BLD_*` |
| `concrete` | **the revetment in II** (`structures[]`, 4×1 at `[18,19]`) | `art/meshes/buildings/concrete.glb`, `concrete_wreck.glb` | `assets/sprites/BLD_CONCRETE` |
| `camp` | **the field camp in II** (`structures[]`, 2×2 at `[25,34]`) | `art/meshes/buildings/camp.glb`, `camp_wreck.glb` | **no sprite sheet** — `camp` has a `mesh-catalogue.ts` entry and no `SPRITE_MAP` entry, so on Pixi or `&nomesh` a placed camp draws nothing. **Inherited** (`beit_sahwan_2_foothold` already places one); gate `pnpm validate:assets`; owner `blender-art` if the lead wants it closed |

### 6.3 Decor, maps, VFX, audio, UI

| row | state |
|---|---|
| decor families for all ten symbols (`grass sand bush tree rock slab boulder ditch`) | **PRESENT** — `art/meshes/decor/` (22 GLBs, including `boulder_0..2` and `ditch_0`) |
| `data/maps/qarn_hadid.json` | **PRESENT**, unchanged but for **one additive marker** (§7 C4) |
| per-mission map variants | **not used** — see §3.4 and O-QH7 |
| VFX | **PRESENT** — `data/vfx/` (15 emitters). Nothing new: no effect in this arc that `shell_impact`, `structure_collapse` and the `fire_*` set do not already cover |
| audio | **PRESENT for weapons** — `assets/audio/` (11 weapon/impact sets + `music/holding_the_perimeter.mp3`). **MISSING:** any voice, EVA or bark line. Gate `pnpm validate:audio`; owner GH-110. Nothing in this arc depends on it |
| portraits | **PRESENT** — `assets/ui/portraits/{shai_hammai,idit_zohar,karim_adhal,nadir_sahim,jubran_hallaq}.png`. The 2026-09-03 digest's "no portraits" line is stale |
| `briefing_video` | **MISSING and optional** — `assets/video/` holds `tel_marum_2_briefing.mp4` and `tel_marum_3_briefing.mp4` only. Gate: `validate_data.mjs` requires the file to exist if the field is declared. See O-QH5 |
| **campaign board** `art/meshes/campaign/sahar_basin.glb` | **MISSING a `qarn_hadid` marker node.** Gate: `pnpm test` (`packages/render/src/three/campaign/world-scene.test.ts`, "finds a marker for every town"). Pipeline: one line in `TOWN_SITES` in `tools/campaign/export_meshy_world.py` (`"qarn_hadid": ("sur", u, v)`) plus a re-export. **Both source blends are PRESENT** in the main checkout at the paths the exporter expects — `art/blend/map/Meshy_AI_multi_biome_hex_diora_0902115508_image-to-3d-texture.blend` (185.2 MB) and `..._0902123927_part-segmentation.blend` (140.9 MB). Owner `blender-art`. **Trap:** the exporter derives `SRC_DIR` from its own repo root and special-cases only the `.claude/worktrees/three-renderer` worktree, so it must be run from `/Users/ilpinto/dev/roaring-lions` or that branch must be extended; `art/blend/` does not exist in this worktree |
| campaign board, flat (Pixi) path | **PRESENT, no art needed** — `ui/worldmap.ts` draws the pin from `world.json`'s `at` over `assets/campaign/world_map.png` |

---

## 7. Engine, schema and content changes

### Changes this arc requires

| # | change | file | gate / owner |
|---|---|---|---|
| **C1** | add `"qarn_hadid"` to the `town` enum (6 → 7 values) | `data/schemas/mission.schema.json` | `pnpm validate:data` · `mission-author` / `sim-guard` |
| **C2** | insert a town into `regions[sur].towns`, **between `tel_marum` and `umm_zeitoun`**: `{ "id": "qarn_hadid", "name": "Qarn Hadid", "at": [548.0, 105.0], "missions": ["qarn_hadid_1_recon","qarn_hadid_2_foothold","qarn_hadid_3_clearance"] }`. **Nothing else in the file changes**: Sur's `unlock.after_mission` stays `beit_sahwan_4_subterranean`, **Naharin's stays `umm_zeitoun_4_clearance`**, and Umm Zeitoun keeps its place as Sur's last town. `world.schema.json` has no per-town `unlock`, so the position in the array is the only ordering there is | `data/campaign/world.json` | `pnpm validate:data` · `mission-author` |
| **C3** | **no change** to `data/campaign/commander.json` — verified against `commanderRankFailures`: campaign order is the flattened `world.json` order, and Major's `until_mission: umm_zeitoun_4_clearance` is still later than all three new missions | — | — |
| **C4** | add **one marker** `"clinic_yard": [44, 10]` to the map. Additive: no row, zone or elevation change, so `tools/src/qarn_hadid_relief.test.ts` (which reads rows and elevation only) cannot be disturbed, and no mission uses this map today | `data/maps/qarn_hadid.json` | `pnpm validate:data` (marker bounds) · `mission-author` |
| **C5** | add Qarn Hadid to GDD §2's town list ("Tel Marum, Umm Zeitoun (Sur)") | `docs/GDD.md` | `narrative-designer` |
| **C6** | add the `qarn_hadid` marker node to the campaign board | `tools/campaign/export_meshy_world.py` + `art/meshes/campaign/sahar_basin.glb` | `pnpm test` · `blender-art` |
| **C7** | three plans and three passive controls | `tools/src/backtest/playtest.ts` | `pnpm playtest` · `playtest` |
| **C8** | the doctrine test of §5.5.3 | `tools/src/qarn_hadid_doctrine.test.ts` (new) | `pnpm test` · `level-scripter` |

**`at: [548.0, 105.0]` was checked, not guessed.** `validate_data.mjs` requires
every town pin to lie inside its region's country outline; point-in-polygon
against `data/campaign/countries.json`'s `sur` outline returns **true**, and the
point is the midpoint of the two existing Sur pins (135.5 px from each of
`tel_marum [421.4,55.9]` and `umm_zeitoun [674.4,153.3]`), which is where a road
between them belongs.

### Gaps this arc surfaces

| # | gap | found where | owner / smallest fix |
|---|---|---|---|
| **G1** | **The `raze` type-check scans map rows only.** `validate_data.mjs` walks `map.rows` for `low_profile` / protected / `per_tile` structures inside a raze zone, but `MissionRuntime.raiseMissionStructures` raises `structures[]` *before* the snapshot, so a mission-placed `wall` or `fence` in a raze zone passes the gate and produces a mission no demolisher will touch — unwinnable with a deadline to fail on. **New, found this session; FIXED the same day** (`validate_data.mjs` now scans `mission.structures[]` footprints against the zone with the same three reasons; proved on a probe placing a `wall` in Wadi Halam V's depot zone, and every shipped mission still passes) | `tools/validate_data.mjs` (raze block) vs `packages/sim/src/mission.ts` | closed |
| **G2** | **`manpad_team` is vehicle-domain.** Its role is `aa`, which is not in `FOOT_ROLES`, so `wheeled` defaults true and a two-man missile team cannot cross `b` or `d`. Qarn Hadid is the only map with both symbols, so this is the first map where it is visible. Same for `gun_truck` (correct there). | `packages/sim/src/sim.ts:213`, `data/units/enemy/manpad_team.json` | `sim-guard` — one line, `mobility.wheeled: false`, the mirror of the override `rocket_battery` already carries. **Not in this arc's commit**: it moves Tel Marum and Umm Zeitoun too (O-QH4). Until then, never place one on scree |
| **G3** | **`dozer_d9` walks an anti-tank ditch.** Role `engineer`, no `wheeled` override, so a 62-tonne bulldozer is foot-domain. No mission here fields it; `wadi_halam_5_depot` does, and Qarn Hadid is the first ground where a ditch would expose it | same | `sim-guard`, same one-line shape |
| **G4** | **No trigger fires on an objective completing, and none re-arms.** Only waves take `trigger: <objective id>`. Every "and then this happens" beat in §5 is therefore a one-shot `zone_entered`, `timer_s` or `casualties_pct` | `packages/sim/src/mission.ts` `stepTriggers` | `sim-guard`, recorded not requested |
| **G5** | a wave's `from` resolves as a **map marker only**; the schema still promises "or tunnel id". No tunnels on this map, so it does not bite here | `mission.schema.json` vs `mission.ts` | `sim-guard` — correct the text or build the feature |
| **G6** | **`intel.marked_positions` reveals units by tag and nothing else** — no terrain, no structure. So a recon can never pre-reveal the revetment, and T-QH4 leans on that deliberately | `mission.ts` | none requested; it is a design constraint, not a bug |
| **G7** | **No `intel_rate_per_min` exists anywhere in the campaign**, so Idit's "certainty costs" register still has no economy behind it (`storyline.md` G10). II declares logistics only | `data/missions/*.json` | `mission-author`, act-wide, out of scope here |
| **G8** | **The campaign board reads towns from the GLB**, so a `world.json` town with no marker node fails `world-scene.test.ts` and leaves an invisible pin (`data-placed="0"`) on the default renderer while the flat Pixi board draws it fine | `packages/render/src/three/campaign/world-scene.ts` | `blender-art` — C6 |
| **G9** | **`civ_refuge [10,43]` sits in no declared zone**, so any `evacuate_before` naming it throws at load. A latent trap for anyone authoring on this map from the marker list alone | `data/maps/qarn_hadid.json` | either C4's approach, or add a zone around it; **say which in the map, not in a comment** |
| **G10** | **`starting_force` ignores unit unlocks** (known hole). II and III field `demo_squad` (ROE 50) and `sniper_team` (ROE 60). Act I's measured plan ratings are 75 / 100 / 100 / 94 / 98, so a campaign arriving here honestly holds both — recorded, not exploited | `mission.ts` `spawnPlacement` | `sim-guard`, campaign-wide |

---

## 8. Open decisions for the lead

| # | decision | recommendation |
|---|---|---|
| **O-QH1** | **Three missions (A) or four (B)?** B teaches the domain split on the player's own side of the wall first and turns it into a procurement decision in a build-up; A is the interlude the storyline argued for | **A.** Take B if the lead wants the better game and will pay a fourth mission and the war's third build-up for it |
| **O-QH2** | **Does the campaign board get its marker now?** Without C6 the arc ships with a red unit test and an invisible pin on the default renderer | **Do the re-export.** It is one line in `TOWN_SITES` and a re-run; both source blends are already on disk in the main checkout |
| **O-QH3** | **The clinic is both the refuge and the flagged zone.** Is T-QH8 (a section garrisons it behind the families) too cruel? | **Author the mission without it and let `playtest` try it.** If the mission still wins with rifles kept forward and armour kept off the zone, keep it; it is the sharpest thing in the arc |
| **O-QH4** | **Should `manpad_team` become foot-domain (G2)?** | **Yes, but in its own commit.** It changes reachable ground in two shipped towns and needs its own `playtest` run |
| **O-QH5** | **A `briefing_video` for any of the three?** Tel Marum II and III have one each | **No for I and II; optional for III.** An interlude that opens with a cinematic reads as an act opener |
| **O-QH6** | **Confirm the position: Qarn Hadid before Umm Zeitoun** | **Yes.** It is the road to the basin, and putting it after would make the brigade arrive at the batteries and then go back for the pass |
| **O-QH7** | **Per-mission map variants?** `map-variants-design.md` §3's ladder has no Qarn Hadid row | **None for I and II.** Optional `qarn_hadid_3` for III, doing exactly one thing: swap the clinic's three `h` tiles to the `k` `clinic` type (same 260 hp, same `roe_penalty` 6, different mesh) so the building the player must not shoot **looks** like a clinic |
| **O-QH8** | **Does the arc need a `debrief`?** The field is live and outcome-aware; the end screen otherwise shows a number | **Yes, on III** — Shai on the road being open, Idit on the batteries being slower to be told. `narrative-designer` writes it |

---

## Appendix — the census and the measurements this was written from

**Census, run this session in `/Users/ilpinto/dev/roaring-lions-story` unless
noted.** `data/units/kdf` (14) and `data/units/enemy` (15) plus
`data/units/civilians.json`; `art/meshes/` (23 entries incl. 9 vehicles,
20 building GLBs, 22 decor GLBs, 4 civilian GLBs); `assets/sprites` (40 sheets);
`assets/audio` (11 weapon/impact sets + `music/`); `assets/ui/portraits` (5);
`assets/video` (2); `data/vfx` (15); `data/structures.json` (10 types — note
`clinic` and `fence` have been added since the 2026-09-03 digest, and `mosque` is
now `hall`); `data/maps` (23 files, 12 of them per-mission variants);
`data/missions` (18); `data/campaign/world.json`, `countries.json`,
`commander.json`. `art/blend/` was censused in the **main** checkout
(`/Users/ilpinto/dev/roaring-lions`), where it is complete: `map/` holds both
Meshy campaign sources.

**Runtime facts were grepped, not remembered.** The nine live objective kinds and
their completion/failure rules, the four trigger conditions and the **six** `do`
kinds (`commit withdraw_to spawn reinforce dismount remove`), the `say` /
`say_on_fail` shape and its four speakers, `hold_for` and `capture` both requiring
an **uncontested** zone (`contestedIn`), `evacuate_before`'s refuge-inside-zone
throw, `raze`'s start-of-mission snapshot and its `seconds` requirement on a
primary, `checkEnd`'s three defeat conditions, `CivilianFlight`'s two triggers to
move (suppression > 0.3, a soldier inside 4 tiles) and its transport boarding —
all read from `packages/sim/src/mission.ts`, `packages/sim/src/civilians.ts` and
`data/schemas/mission.schema.json` today.

**Route and sight measurements** were produced by driving the real `FlowField`
and the real `Sim` detection path over `data/maps/qarn_hadid.json` through
`parseMap` + `applyTerrain`, in throwaway scripts run with `tools/node_modules/
.bin/tsx` and deleted afterwards (`git status` clean). The method mirrors
`tools/src/qarn_hadid_relief.test.ts` and `tools/src/tel_marum_doctrine.test.ts`:

- **routes** — `FlowField.compute(mask, elevation, gx, gy)` with
  `mask = sim.blocked` for foot and `sim.blockedVehicle` for wheels and tracks,
  then walking `field.dirs` from the start tile; cost read from
  `field.costAt(index)` in tenths of a tile;
- **sight** — two units spawned on the two tiles and `sim.debugDetection(a, b)
  .visible` read directly, which is range plus `losRay` with no accumulated
  contact in it, so the answer does not depend on how long the sim ran;
- **caveat, the same one Tel Marum's test carries:** a `sees()` result taken with
  a sight-48 observer is a statement about *terrain*, not about the roster. Where
  a roster range matters above, the range is named (8, 9, 12) and the measurement
  was taken at it.

**One measurement is quoted rather than re-derived**, on instruction and because
it is already pinned with controls: every number in §3.2's first table comes from
`tools/src/qarn_hadid_relief.test.ts`, which pairs each claim against the same map
with one thing removed — the elevation flattened, the `d` filled in, the `b`
cleared, the cover overridden.
