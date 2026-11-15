# Mission Design Document: Act I · The Marj Strip · **Qasr Liwan**

**Date:** 2026-11-15 · **Author:** `campaign-designer` · **Status:** proposal, for the lead's
review before `narrative-designer` and any JSON. Nothing here is canon until the lead signs §8.
**Arc:** *The Long Ground*, town 1 of 4 new. The lead approved the arc on 15 Nov 2026 with
L-1 to L-16 at their defaults (ruling comment on PR 1438). This document hardens the outline's
five Qasr Liwan rows.
**Written against:** branch `cl/qasr-liwan-mdd` at `f6fa89146`, which carries
`docs/campaign/the_long_ground/` from PR 1438. I ran the census and the code reads this
session; the commands are in the appendix.
**Reads:** `docs/campaign/README.md` (the contract), `storyline.md` (§0.1, §2, §2.4, §3.1, §4.2),
`the_long_ground/arc-outline.md` and `transposition.md`, `docs/GDD.md` §2, §4, §6 and §11,
`research-2026-09-03.md` (the newest digest, and stale: the census below supersedes it),
`khan_rafid/design.md` and `qarn_hadid/design.md` for the house layout.
`the_long_ground/dossier.md` was **not** read and nothing here draws on it.
**Downstream:** `narrative-designer` (§2, the story hooks in §5), `level-scripter` (§3's
assertions, §5's enemy and twists, §7), `mission-author` (all of it; §3 is the map spec),
`playtest` (§5.7).

**Every distance, open-tile count and walk in §3 and §5 is a draft number.** A
tile BFS (8-connected, with no corner-cutting) produced them from the grids below.
`FlowField` prices ground differently, so `level-scripter` re-measures and pins
each one before any JSON is authored. The maps are flat, so the two should agree
closely.

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| L-1 | Plot A, *The Long Ground*: Act I extended | lead, 15 Nov 2026 | Qasr Liwan is the Marj's second town in campaign order, after Beit Sahwan and before Khan Rafid |
| L-2 | The names **Qasr Liwan** and **the Cut** | lead | no other proper noun is coined in this document. Every other feature has a plain-English id (the north edge, the seam, the yard, the pump yard, the relief depot, the water point, the shore quarter) |
| L-3 | Promotions at act boundaries; Captain through the extended Act I | lead | Shai is a **Captain** in all five missions. `commander.json`'s Captain entry runs `until_mission: deir_amun_3_subterranean` today, and Qasr Liwan sits before that, so this town needs no rank edit. The move to `bir_tarsha_5_subterranean` belongs to Bir Tarsha's MDD |
| L-5 | Adversaries are job titles only | lead | the yard commander (QL IV) and the grid chief (QL V), named to nobody |
| L-8 | The pause is playable | lead | QL III is a build-up (§5.3). It is the Marj's **first** build-up, and two landed lines say the Marj has none (§7, C6) |
| L-11 | The shaft is in the yard, and the clinic stands | lead | QL IV's `capture` and `collapse` zone is the yard's open ground only. The clinic is a separate flagged zone, and nobody is garrisoned in it (§5.4) |
| L-12 | The aid-compound beat is a flagged relief depot over the grid's far head, with no agency named or implied | lead | QL V. The depot is a plain `warehouse` in a walled yard. It carries no mark, and no line says whose it is |
| L-16 | Who is freed in QL I stays unsaid | lead | **the person is one `civilians` placement and is never characterised.** No line, id or objective text says soldier, family, role, rank or unit. `transposition.md` §4's R1 row reads "the taken soldier is a `civilians` placement", which would answer L-16. This design does not follow it, and G-7 (a friendly-tagged prisoner) is therefore **not used** |
| D4 | One villain per front, captured or killed at its end | lead, `storyline.md` §0.1 | **Nadir Sahim is already taken**, at `beit_sahwan_4_subterranean`, which comes before this town. See D-QL1 |
| D9 | Static continuity, authored text only | `storyline.md` §0.1 | no line branches on the ledger |
| D11 | Doctrine, never a people, a faith, a real place or a real insignia | GDD §2 | the city is defined by what the Ashwar Front does in it (tunnels, ambush, human terrain), never by who lives there |

### D-QL1: the front's villain has already been taken

`data/campaign/commander.json` gives `villains.marj` the value `ends_at:
"beit_sahwan_4_subterranean"`. This town comes after that mission in `world.json`'s
order, so D4's letter cannot hold here. Khan Rafid met the same problem and answered it
in `khan_rafid/design.md` D-KR1, and this design follows that answer. The GDD's own
§11 rule fits it: *"Not every town opens a front or closes one … the front's
adversary is present only through what he leaves, and he does not speak."*

> **He was taken at the shaft head, and the city he built for went on without him.** Qasr
> Liwan is the ground he prepared and never saw used. His presence is what is in it:
> a family's house holding one of the people taken at First Light, a ring of posts that knew
> the brigade was coming, a pause that his people use to stand closer, a shaft dug into a
> clinic's yard, and a route that ends under the one building the player may not fire on.
> The town's last mission ends on a **job title**, the grid chief, as a secondary.

The cost, said plainly: this town has no named man to kill. That is why its fifth
mission ends on a sequence of charges and not on a person.

### Deviations from the arc outline's five rows

The outline is approved, and these changes stay inside its frame. Each one is listed
for the lead to strike.

| row | outline | here | why |
|---|---|---|---|
| QL I | secondary `locate · ql_ring_posts` (carries) | three tags: `ql_post_seam`, `ql_post_tower` and `ql_post_coast`. Only `ql_post_seam` is a `locate` objective (carries); the other two carry silently | the runtime marks a tag in the ledger the moment **any** unit carrying it is seen (`mission.ts`, the carry-over loop after `identified.add`). One tag over three posts would hand QL II all three after one sighting. A tag per post makes a rushed recon cost exactly what it skipped |
| QL I | ceiling 10 | 10, with the arithmetic stated | the issued force fields no weapon at or above `collateral_risk` 0.3. The only Conduct risk is fire support bought with earned Intel (§5.1) |
| QL III | ceiling 10 | **5** | at 10, two stray rounds into the handover ground pass. At 5, one is forgiven and a second is not, and a dead civilian (8) or a levelled house (6) is never forgiven. That is the outline's own sentence, "one careless volley … loses it", made true in numbers |
| QL III | produces R M C X H | adds **I**, and a carrying secondary `locate · ql_yard_watch` read by QL IV | GDD §4: "the one phase where the player has breathing room; Intel is spent here on the coming assault". Spending the pause on a look at the clinic yard is what that sentence means |
| QL IV | ceiling 10 | 10, **with `structure_penalty_mult: 2`** | a `clinic` is `roe_penalty` 6. At multiplier 1 its loss alone does not cross 10, so "the clinic must stand" would be false. At 2 it costs 12 and fails the mission by itself |
| QL IV | produces R M C X E | adds **I** (`ql_shore_watch`, read by QL V) | a clearance that sees the shore quarter's watcher hands QL V a pre-identified post |
| QL V | ceiling 10 | 10, **with `structure_penalty_mult: 4`** | a `warehouse` is `roe_penalty` 3. At 4 the relief depot costs 12 and fails the mission alone. G-QL1 is the proper fix |
| QL V | secondaries `locate · ql_deep_crew` (carries), `survive_until 300` | `eliminate_hvt · ql_grid_chief`; `locate · ql_deep_crew` **without** `carries` until a reader exists (O-QL3) | a `survive_until` secondary is a clock the passive control also completes (README, third star). A `carries` flag with no reader is the Beit Sahwan III failure the README records |

---

## 1. Premise and plot options

### The premise

Beit Sahwan is held. Up the coast road is the Marj's city, **Qasr Liwan**: a grid of low
houses on one-tile lanes, a walled clinic compound in its centre, warehouses and a pump yard
on the shore, and its southern edge facing open ground the brigade will turn into **the
Cut**. It is inhabited, and the Ashwar Front prepared it for years as ground to be fought
for from inside.

Five missions take the city in ascending phase order: **recon → foothold → build-up →
clearance → subterranean** (phases 2, 3, 4, 5, 6). Every mission plays on **one
geography**. That is one base map plus four variants in the shipped pattern
(`beit_sahwan_2/3/4`, `khan_rafid_2/3`), so the player learns one city's streets five
times over. Each mission is fought in a different quarter: the north edge, the
seam and the Cut, the Cut again, the centre, and the shore.

The three plots below differ in **what the town asks the player to keep**,
**which ground repeats**, and **how it ends**. Their names differ least.

### Option A: *"Five Doors"* · recon → foothold → build-up → clearance → subterranean · **RECOMMENDED**

The approved outline, hardened.

- **Each mission asks a different question about the same restraint.**
  - **I:** how much to look before going in.
  - **II:** which seam to hold, when the force cannot hold both.
  - **III:** what to build, and where to stand when the pause ends.
  - **IV:** which weapon you are allowed to use beside a clinic.
  - **V:** where the engineers stand while the water drives the shallow crews up.
- **Recon carries twice inside the town.**
  - I's three ring-post tags are read by II.
  - III's look at the yard (`ql_yard_watch`) is read by IV.
  - IV's sight of the shore watcher (`ql_shore_watch`) is read by V.
  - Each one turns a hidden `ambush` into a pre-identified post (`mission.ts`,
    marked tags spawn identified and forfeit the ambush).
- **Two missions return people.**
  - I returns one person, unnamed (L-16).
  - III returns four at a handover.
  - Both write `civ.hostages_recovered`. Today only Beit Sahwan IV writes that key.
- **The ending is a sequence, not a man.** QL V's failable primary is
  `collapse(shore_grid, 360)`. The grid chief is a secondary.
- **Cost:**
  - one base map and four variants;
  - five mission JSONs, five plans and five passive controls;
  - one doctrine test;
  - one schema enum value, one `world.json` town, one GDD §2 word and one board pin;
  - two re-briefs of landed text (§7);
  - no new unit and no new structure.

### Option B: *"One Road South"* · the same five phases, one refuge for the town

The same five missions, but **the Cut is the only refuge in the town**. Zone `the_cut`
is where the residents walk in II, where the taken walk in III, and where the clinic's
people walk in IV. That is the Khan Rafid device, one refuge asked three times,
moved to the road that will divide the Marj for the rest of the war.

- **Mechanically different from A in IV.**
  - The clinic's people do not walk to a local refuge outside the compound. They walk
    **about 30 tiles** across the city to the Cut, and the yard fight becomes a column
    escorted through lanes.
  - `CivilianFlight` walks a civilian alone once a soldier has come within 4 tiles
    (`civilians.ts`, `SHEPHERD_RADIUS_SQ`). The only cover on the walk is where the player's
    units stand along it, and enemy fire aimed at them is what splashes the walkers.
- **What it buys.** The Cut's meaning is said by the mechanics three times, and the
  board's account of the town reads as one road.
- **What it costs.**
  - The IV walk breaks `map-variants-design.md` rule 4 (a short walk to the refuge;
    Khan Rafid's assertion KR-A3 holds it to 14 tiles) by a factor of two.
  - The clearance turns into a convoy mission, so the clinic-yard decision (which
    weapon beside the clinic) is lost to a different one (which lanes to picket).
  - III and IV both lean on the same zone, which makes them read alike.

### Option C: *"The Chief Runs"* · the same ladder, and the town ends on a person

A's ladder, but QL V's failable primary is an `eliminate_hvt` on the grid chief, and it
can **fail**.

- When the pump yard's hold completes, the chief leaves his post for the deep route whose
  far head lies under the relief depot.
- A `group_in_zone(chief, depot_vent)` trigger then fires `remove` on his group. Under
  GH-815 an `eliminate_hvt` whose target is removed fails at once.
- Stopping him means collapsing the depot route before he reaches it, or killing
  him in the lanes on the way.
- **Mechanically different:** a race instead of a sequencing problem, with a failable
  `eliminate_hvt` that no shipped mission uses.
- **Costs and buys:** it gives the town a person to end on, and is all expressible today
  (`group_in_zone` GH-912, `remove`, GH-815).

### Recommendation

**Option A**, for three reasons:

1. **It is the approved arc.** Every beat the outline's coverage matrix assigns to Qasr
   Liwan lands where the matrix says: P1-c and P1-d in II, P1-f in III, P1-e in IV, and
   T3, T4, P1-g and P1-i in V. B moves the IV beat's weight and C changes V's.
2. **Five different decisions.** A passive player loses all five (§5), and an active
   player decides something different in each. B spends two missions on one zone.
3. **The cheapest honest ending.** The Marj's adversary is a network (D-QL1). A town that
   ends on its routes coming down is the front's own doctrine, as Deir Amun's is.

**Against A, honestly.** A is the only plot with five refuge and ceiling designs to
measure, and three of its ceilings rely on `structure_penalty_mult`, the blunt fallback
for G-QL1.

### Killing my own favourite

**My favourite is C.** A failable chase is the most alive ending in the town. It uses
three runtime features no shipped mission combines, and it gives the player one face to
remember.

**It does not survive the town's own constraint.** C makes the relief depot the
villain's way out. Its last beat shows the aid compound as the place an enemy commander
goes to escape, which implies exactly what L-12 forbids: an agency's compound that
harbours the enemy. In A the depot is ground the player must not hit, and nothing about
it is a claim. With C dead, A still stands. The chief is still in V, as a secondary,
and is found and killed at his own shaft head.

I also ran A without the pause (the L-8 alternative). The town still stands at four
missions (2, 3, 5, 6) and IV's carry comes from I instead of III. It loses the town's
only build-up and its second handover. L-8 has ruled, so this is recorded only.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | I, The Marj Strip · Ashwar Front · *proximity*. The second town of five under L-1: Beit Sahwan, **Qasr Liwan**, Khan Rafid, Deir Amun, Bir Tarsha |
| **Where it sits in the fiction** | after Beit Sahwan IV. Sahim is in a cell and the brigade's next ground is the city up the coast road. The arc's real phase 1 (`arc-outline.md` §3, Qasr Liwan) |
| **Shai's rank on entry** | **Captain**, 2 stars |
| **Shai's rank on exit** | **Captain.** No promotion in a town, and none at its end (L-3) |
| **Idit's intel thread** | **I:** she has one house and a reason to believe one of the taken is in it, and the briefing does not say how she knows. **II:** the ring is built on what I saw; every post found in I is a post she can name. **III:** the pause is the only time she can look at the clinic yard without a fight, and looking is the one thing in the pause that can break it (§5.3). **IV:** the shaft is in the yard, not in the clinic, and her picture says so and says nothing more. **V:** *a route counts only while someone is watching it* (`sim.ts`, unwatched contact decays). She maps first, and the brigade learns to enter second |
| **The villain's atrocity** | already played, at First Light (D12). The town adds no new one and depicts nothing |
| **The adversary's presence** | **I** the taken held in a family's house. **II** a ring of posts at the seam, and crews venting at both ends. **III** his people use the pause to stand closer: the enemy lines hold just outside the player's sight, and the waves come the moment it ends. **IV** a shaft dug into a clinic's yard, with firing positions three tiles from its wall. **V** a two-tier grid under the shore, a crew still digging toward the Cut, and a route ending under the relief depot |
| **His end** | the network's, in V: `collapse(shore_grid, 360)`, with `eliminate_hvt(ql_grid_chief)` as a secondary. The front's villain card (`villainState`) does not change. It already reads Sahim *captured* from Beit Sahwan IV |
| **Ledger in** | `roster.surviving_units` (Beit Sahwan IV's survivors) and `intel.marked_positions`, which is a union across the campaign (`mission.ts`, "Union with what came in") |
| **Ledger out** | R M C X from all five. **I** from I, III, IV and V. **H** from I and III. **E** from II and IV. All seven keys are produced by shipped missions today (`jq -r '.ledger.produces[]' data/missions/*.json`), and this town declares no new one |
| **What Khan Rafid inherits** | a roster that has fought in a city it was trying not to break; two more lines on the board's account of the taken; and one story fact Khan Rafid I's re-brief can use: **the Cut now divides the Marj, and Khan Rafid is on the other side of it** |

---

## 3. Map overview

**One base map and four variants, all MISSING.**

- Each is 48×48, `terrain: "arid"`, with **no `elevation` key** (flat).
- The gate is `pnpm validate:data` plus `tools/src/map_visibility.test.ts` (84%).
- `mission-author` hand-authors the JSON from these grids.

| map id | mission | differs from the base by |
|---|---|---|
| `qasr_liwan` | QL I | is the base (it includes the seam berm on row 1) |
| `qasr_liwan_2` | QL II | the Cut's checkpoint (rows 39, 40, 42); two `tunnels` |
| `qasr_liwan_3` | QL III | the checkpoint stands; the seam berm is gone, so the ring is closed; the water point's cistern (rows 1, 38 to 42) |
| `qasr_liwan_4` | QL IV | III's ground plus three enemy firing positions round the compound and the yard commander's sandbags (rows 18 to 25, 30, 31); one `tunnels` route |
| `qasr_liwan_5` | QL V | III's ground plus the deep shaft head's firing position, which replaces a shanty (rows 30, 31); five `tunnels` routes |

### Why flat, and why no domain split

`map-variants-design.md` §2.2 measured elevation's two real jobs: shape at zero tile
cost, and dead ground. A city's sight is dominated by its buildings, which is the same
argument `khan_rafid/design.md` §3 made for Khan Rafid. **There is no `b` and no `d`**:
on every variant, foot-reachable and wheel-reachable tiles are equal, about 2,010 to
2,030 depending on the variant. This town's constraints are Conduct and one-tile lanes,
not ground. `income_census.test.ts` (a wheeled route to every income zone at t=0) is
satisfied by construction.

**No olive groves.** On an arid map `o` draws the `desert_tree` family (`decor-place.ts`,
the `groveFamily` default; `art/meshes/decor/desert_tree_0..2.glb`). Every `o` below is
thorn scrub and desert trees.

### 3.1 The base grid, `qasr_liwan` (draft)

North is up; x runs east and y runs south; the sea is off-map past x=0 (G-15).

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
 0  ..r.......oooooo..........111111........r.......
 1  ..r.gg.gg.oooooo........................r.......
 2  .1r.....................................r.......
 3  ..rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.......
 4  ..r..................r..................r.......
 5  ..r.hh..ss..hh..ss...r..ss..hh..n.......r.......
 6  ..r.hh..ss..hh..ss...r..ss..hh...n..hh..r.......
 7  .1r............===.==r..............hh..r.......
 8  ..r............=hh11=r..................r..ooo..
 9  ..r.ss..hh..ss.=hh11=r..hh..ss..hh......r..ooo..
10  ..r.ss..hh..ss.=..11=r..hh..ss..hh......r..ooo..
11  ..r............======r..............aaa.r.......
12  .1r..................r..............aaa.r.......
13  ..r.hh..ss..hh.......r..ss..hh......aaa.r.......
14  ..r.hh..ss..hh.......r..ss..hh..........r.......
15  ..r..................r..................r.22....
16  ..rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.......
17  .1r..................r..................r.......
18  ..r.www========.hh...r..................r.......
19  ..r.www=.wwww.=.hh...r..===.========....r.......
20  ..r....=.wwww.=......r..=..........=.##.r.......
21  ..r....=.wwww........r..=.....kkkk.=.##.r.......
22  .1r.ss.=......=.ss...r..=.1...kkkk.=....r..ooo..
23  ..r.ss.=......=.ss...r..=.....kkkk.=....r..ooo..
24  ..r....=......=......r......2...........r..ooo..
25  ..r....===.====......r..=..........=....r.......
26  ..r.............hh...r..=..1.......=.ss.r.......
27  .1r.pp..ss..hh..hh...r..=..........=.ss.r.......
28  ..r.....ss..hh.......r..=..........=....r.......
29  ..r..11..............r..=====.======....r.......
30  ..r.....hh..ss.......r..................r.22....
31  ..r.pp..hh..ss.......r..................r.......
32  .1r..................r..................r.......
33  ..rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.......
34  ..r..................r..................r....2..
35  ..r.ss..hh..ss..hh...r..hh..ss..hh..ss..r.......
36  ..r.ss..hh..ss..hh...r..hh..ss..hh..ss..r.......
37  .1r..................r..................r.......
38  ..r...11......1......r...........11.....r...1...
39  ..r..................r..................r.......
40  ..r..................r..................r.......
41  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr
42  .1r.............................................
43  ..r.........22..............................22..
44  ..r.ooooo...............22........ooooo.........
45  ..r.ooooo.........................ooooo.........
46  ..r.............................................
47  .1r.............................................
```

Symbols used, all legal on `arid` (`packages/data/src/map.ts` `TERRAIN_LEGEND`; the
building letters come from each type's `symbol` in `data/structures.json`):

- terrain: `.` open; `1`/`2` cover; `r` road; `o` desert scrub (cover 1); `n` knoll (cover 2);
- `h` house (`roe_penalty` 6); `s` shanty (2); `a` apartment (14); `w` warehouse (3);
  `#` concrete (3); `k` clinic (6); `p` pump_house (2);
- `=` wall (low profile, `roe_penalty` 0); `g` sandbag_wall (low profile, 0); `T` t_wall (0);
  `H` hesco (low profile, 0); `F` militia_firing_position (owner 1, 0).

A contiguous run of one letter is one structure (`parseMap`'s flood fill), so every house
here is a separate 2×2 block, set off by lanes or by a neighbour of a different letter.

**Census of the base:**

- 19 houses, 17 shanties, 1 apartment, 2 warehouses, 1 concrete block, 1 clinic, 2 pump
  houses, 81 wall tiles and 4 sandbag tiles;
- the non-wall structures sum to **181** Conduct points at multiplier 1.

### 3.2 The shape, north to south

| feature | tiles | what it is |
|---|---|---|
| **the north road** | `r` y=3, x2 to 40 | the city's northern boundary and the night approach. It meets the coast road at the north-west junction, **the seam** |
| **the seam** | zone `ring_north [3,0,8,6]` (x3 to 10, y0 to 5) | where the ring closes on the sea in the north. A sandbag berm (`g`, row 1) across it is the enemy's post in I and II and is gone from III on |
| **the north edge** | y4 to 15, x3 to 39 | low house-and-shanty pairs on one-tile lanes, with the water-tower knoll (`n`, x32 to 33, y5 to 6) |
| **the house** | walled courtyard x15 to 20, y7 to 11; house `h` x16 to 17, y8 to 9; courtyard cover x18 to 19, y8 to 10; **one gate, north, at (18,7)** | QL I's subject. The only way in or out is the gate onto the lane at y=6 |
| **main street** | `r` y=16, x2 to 40 | the city's east–west spine |
| **the clinic compound** | walls x24 to 35, y19 to 29; gates north (27,19), west (24,24), east (35,24) and south (29,29) | the clinic `k` (4×3, x30 to 33, y21 to 23), its forecourt (x30 to 34, y24 to 28) and the **yard** (x25 to 29, y20 to 28), with cover at (26,22), (27,26) and (28,24) |
| **the shore quarter** | x3 to 20, y17 to 37 | warehouses, the **relief depot** (a `w` 4×3 at x9 to 12, y19 to 21, in a walled yard x7 to 14, y18 to 25, gates east (14,21) and south (10,25)), shanties and houses, and the **pump yard** on the west edge |
| **the pump yard** | zone `pump_yard [0,26,7,7]` | two `pump_house` (x4 to 5 at y27 and y31), the coast road, cover at (5,29) and (6,29). The sea is off-map (G-15) |
| **the south street** | `r` y=33, x2 to 40 | the edge of the inhabited city |
| **the south quarter** | y34 to 37 | the residents' row of houses and shanties (QL II) |
| **the apron** | y37 to 40 | open ground north of the Cut, scrub at (6 to 7,38), (14,38) and (33 to 34,38) |
| **the Cut** | `r` y=41, full width | the road the brigade opens in II and holds for the rest of the war. From II on its checkpoint is two `T` lines (y40 and y42, x24 to 27 and x30 to 33) with a **two-tile lane at x28 to 29**, and `H` at (23,39) and (34,39) |
| **south of the Cut** | y42 to 47 | the brigade's ground, with scrub and cover. The KDF start lines from III on |
| **the inland road and the east ground** | `r` x=40; x41 to 47 | the Kedem side. II starts here |

### 3.3 The variants, as the rows that change

Each row below replaces the base row of the same number, in full.

**`qasr_liwan_2`** (QL II):

```
39  ..r..................r.H..........H.....r.......
40  ..r..................r..TTTT..TTTT......r.......
42  .1r.....................TTTT..TTTT..............
```

**`qasr_liwan_3`** (QL III), which is II's checkpoint with the seam berm removed and the water point added:

```
 1  ..r.......oooooo........................r.......
38  ..r...11......1.22...r...........11.....r...1...
39  ..r..................r.H..........H.....r.......
40  ..r..................r..TTTT..TTTT......r.......
42  .1r.....................TTTT..TTTT..............
```

**`qasr_liwan_4`** (QL IV), which is III plus the firing positions and the yard sandbags:

```
 1  ..r.......oooooo........................r.......
18  ..r.www========.hh...rFF................r.......
19  ..r.www=.wwww.=.hh...rFF===.========....r.......
23  ..r.ss.=......=.ss...r..=.....kkkk.=.FF.r..ooo..
24  ..r....=......=......r......2........FF.r..ooo..
25  ..r....===.====......r..=.gg.......=....r.......
30  ..r.....hh..ss.......rFF................r.22....
31  ..r.pp..hh..ss.......rFF................r.......
38  ..r...11......1.22...r...........11.....r...1...
39  ..r..................r.H..........H.....r.......
40  ..r..................r..TTTT..TTTT......r.......
42  .1r.....................TTTT..TTTT..............
```

**`qasr_liwan_5`** (QL V), which is III plus the deep shaft head's `F` in place of the shanty at (12,30):

```
 1  ..r.......oooooo........................r.......
30  ..r.....hh..FF.......r..................r.22....
31  ..r.pp..hh..FF.......r..................r.......
38  ..r...11......1.22...r...........11.....r...1...
39  ..r..................r.H..........H.....r.......
40  ..r..................r..TTTT..TTTT......r.......
42  .1r.....................TTTT..TTTT..............
```

### 3.4 Zones and markers, per map

Zones are `[x, y, w, h]` and markers are `[x, y]`, as in `data/maps/*.json`. "open"
means passable tiles reachable on foot from `player_start`. Every marker below is on a
passable tile (checked).

| map | zone | rect | open | what it holds |
|---|---|---|---|---|
| `qasr_liwan` | `ql_lane` | [12,5,12,10] | 83 | the house's neighbours: 3 houses, 2 shanties and the courtyard walls (22 points). **Flagged** |
| | `ql_house_yard` | [16,8,4,3] | 8 | the house and the courtyard; trigger zone only |
| | `ql_extract` | [20,0,6,3] | 18 | the extraction, on the north road's far side. Holds `ql_extract_point (22,1)` |
| | `ql_edge` | [4,4,36,12] | 325 | the north edge; narrative reference only |
| `qasr_liwan_2` | `ring_north` | [3,0,8,6] | 40 | the seam: hold zone, and the north vent's head |
| | `the_cut` | [24,39,10,5] | 34 | the checkpoint: hold zone and income zone |
| | `cut_refuge` | [26,44,6,3] | 18 | the residents' refuge. Holds `refuge_point (28,45)` |
| | `coast_road` | [0,37,6,7] | 42 | where the coast road meets the Cut: capture and income |
| | `south_quarter` | [3,34,36,4] | 112 | the residents' houses (4 houses, 4 shanties, 32 points). **Flagged** |
| `qasr_liwan_3` | `staging` | [24,36,10,4] | 34 | the forward ground north of the checkpoint; hold zone |
| | `handover` | [9,36,6,4] | 21 | where the taken stand. **Flagged** |
| | `walk_south` | [9,40,7,3] | 21 | their walk across the Cut. **Flagged** |
| | `pause_refuge` | [9,43,7,4] | 28 | holds `pause_refuge_point (12,45)` |
| | `water_point` | [15,37,5,3] | 15 | the cistern: capture and income |
| | `pause_line` | [3,32,37,2] | 74 | the south street band; crossing it breaks the pause |
| `qasr_liwan_4` | `clinic_yard` | [25,20,5,9] | 43 | **open ground only**. Capture zone and collapse zone; holds the route's mouth |
| | `clinic` | [30,21,5,8] | 28 | the clinic and its forecourt, where its people stand. **Flagged** |
| | `compound` | [24,19,12,11] | 80 | the whole walled compound; trigger zone |
| | `clinic_refuge` | [25,37,8,3] | 24 | holds `clinic_refuge_point (29,38)` |
| `qasr_liwan_5` | `pump_yard` | [0,26,7,7] | 45 | hold zone |
| | `shore_grid` | [8,26,9,11] | 71 | collapse zone: the three **deep** mouths and none of the shallow ones |
| | `relief_depot` | [7,18,8,8] | 26 | the depot and its walled yard. **Flagged** |
| | `shore_quarter` | [3,17,18,21] | 282 | the inhabited shore (6 houses, 5 shanties, 2 warehouses). **Flagged** |

### 3.5 Tunnels (drafts)

Every route is `pre_dug` unless marked; `dig_tiles_per_s` is the 0.15 default.

| map | route | mouth | waypoints | vent | tier | note |
|---|---|---|---|---|---|---|
| `qasr_liwan_2` | `ql2_vent_north` | (12,12) | (8,9) | (6,5) | — | vents **inside** `ring_north`, so the seam is contested from below |
| | `ql2_vent_south` | (14,31) | (12,36) | (6,38) | — | vents beside `coast_road`, 9 tiles from the west residents |
| `qasr_liwan_4` | `ql4_yard` | (26,21) | (23,22), (23,27) | (27,27) | — | mouth and vent both in the yard. It runs under the west wall, so it can be identified from the lane outside |
| `qasr_liwan_5` | `ql5_shallow_n` | (15,24) | (15,22) | (6,24) | shallow | mouth **outside** `shore_grid`; vent at the pump yard's north edge |
| | `ql5_shallow_s` | (19,34) | (14,38) | (6,34) | shallow | mouth outside `shore_grid`; vent at the pump yard's south edge |
| | `ql5_deep_depot` | (11,29) | (11,26) | (11,23) | deep | **vent inside the relief depot's yard** |
| | `ql5_deep_quay` | (9,34) | (5,36) | (1,37) | deep | vents on the beach |
| | `ql5_deep_cut` | (15,35) | (18,37) | (22,39) | deep, **not `pre_dug`** | dug live by `ql_deep_crew` (`digs`), about 8.1 tiles, so about 54 s at 0.15. Its vent opens on the apron a few tiles from the start line |

**The two tiers are mouth geometry, and nothing deeper.** `collapse` counts every route
whose **mouth** lies in its zone (`mission.ts`, `collapseTargets`). The shallow mouths sit
outside `shore_grid`, so the primary never asks for them: in the fiction the pumps have
done that work. The routes are 2D map data and there is no depth in the sim.

### 3.6 Chokepoints, dead ground and protected structures

- **One-tile lanes.** The north edge and the south quarter are 2×2 blocks on one-tile
  lanes. A lane gives sight along its own axis and nothing else, which is why `ambush(3)`
  is worth authoring here (`rpg_team` RPG range 5, sight 7).
- **One gate, three times.**
  - The house's courtyard has a single north gate, and the clinic compound four
    one-tile gates.
  - The **checkpoint's lane** is two tiles wide between `T` lines. `t_wall` is not low
    profile, so it blocks sight and movement.
  - Walls (`=`) are `low_profile` and block movement **and not sight**: a militia rifle
    sees into the yard over them, and so does the player.
- **Nothing on these maps is protected in the sim's sense.** `PROTECTED_ROE` is 20
  (`structures.ts`), and the dearest structure here is the apartment at 14. Units may
  fire on or breach any building on their own initiative when a hostile is inside it.
  So **every protected-by-design building is protected by Conduct, not by the sim**:
  - it sits in a flagged zone;
  - it carries a ceiling it can fail alone, using the mission's `structure_penalty_mult`
    (QL IV ×2, QL V ×4);
  - and **nobody is garrisoned in it**.
  G-QL1 is the proper fix.
- **The Conduct arithmetic** (`mission.ts` `stepRoe`), read this session:
  - a player-caused **structure loss** costs `roe_penalty × structure_penalty_mult`,
    rounded half up;
  - a **stray** costs 5 (`flagged_structure_penalty`): a near-miss inside a flagged zone
    from a weapon with `collateral_risk ≥ 0.3`, once per zone per 10 s
    (`ZONE_DEDUCT_COOLDOWN` 200 ticks);
  - a fire-support **strike** into a flagged zone costs 5 on the same cooldown;
  - **heavy ordnance** (`≥ 0.5`) aimed within 2 tiles of a civilian costs 3
    (`DANGER_CLOSE_SQ`);
  - a **civilian** killed by the player costs 8.

  The KDF weapons at or above 0.3 are `at_team` spike 0.30, `inf_grenadier` gl_40 0.30,
  `ifv_namer` cannon_30 0.35, `mbt_lavi` gun_120 0.55, `mortar_team` mortar_60 0.70 and
  `demo_squad` charges 0.60. The ones below are every rifle 0.10, `sniper_team` amr 0.05,
  `mbt_lavi` coax 0.20, `apc_eitan` rws_50 0.25 and `jeep_shoded` pintle 0.25
  (`data/units/kdf/*.json`).

### 3.7 Assertions for a new `tools/src/qasr_liwan_doctrine.test.ts`

- **QL-A1** Every zone a `capture` or `hold_for` names holds **at least 12 tiles passable
  to both domains** (Khan Rafid's KR-A7 trap). Drafts:
  - `ring_north` 40; `the_cut` 34; `coast_road` 42; `staging` 34; `water_point` 15;
  - `clinic_yard` 43; `pump_yard` 45.
- **QL-A2** Each refuge marker lies inside its `evacuate_before` zone. The runtime throws
  at load otherwise (`mission.ts`, "refuge marker … is outside zone"), and the throw names
  the objective, not the map.
- **QL-A3** Every civilian group's foot walk to its refuge is **14 tiles or fewer**, and
  each group is more than 4 tiles from `player_start` and from every player placement.
  Drafts:
  - QL I 8;
  - QL II 13, 10 and 12;
  - QL III 8;
  - QL IV 13 and 14.
- **QL-A4** `clinic_yard` holds **no** structure but sandbags, and zone `clinic` holds
  exactly one `clinic`. No capture or collapse can be satisfied by levelling the clinic,
  and no garrison can stand inside the capture zone's contest radius in a building.
- **QL-A5** `shore_grid` contains the mouths of `ql5_deep_depot`, `ql5_deep_quay` and
  `ql5_deep_cut`, and **not** those of `ql5_shallow_n` or `ql5_shallow_s`.
  - `ql5_deep_depot`'s vent lies inside `relief_depot`.
- **QL-A6 (the one the depot design rests on).** From every tile **outside** `relief_depot`,
  a `mark_tunnel` observer (sight 12, `ugv_recon_dog`) can identify `ql5_deep_depot`
  somewhere along its run.
  - So the route can be found **without** standing in the depot's yard, even though its
    crews surface there.
  - If the losRay to a tile under a building fails, move the waypoint off the depot wall.
- **QL-A7 (the pause).** In `qasr_liwan_3`, no enemy `hold_position` placement is within
  **8 tiles** (rifle and sight range plus one) of any tile of `staging` or `handover`.
  Drafts:
  - the west line is 9.5 from the handover;
  - the centre line is 10.2 from staging;
  - the east line is 10.8 from staging.
- **QL-A8 (QL I's mortar).** `ql_mortar` at (10,15) has range 16: it reaches the house
  (about 10) and **not** `ql_extract` (about 18.4). This is pinned because the rescue's
  whole risk model depends on it.

The visibility gate (README rule 10) is **not measured**. These maps have no JSON yet,
and the instrument reads `data/maps/`. The grids follow `ground-ladder.md` §15:
- one apartment only, on the east edge, so its shadow falls on blocks and not on lanes
  near an objective;
- low houses everywhere else;
- the clinic is 1.2 to 1.4 world units fitted.

`mission-author` runs `npx tsx tools/src/map_visibility.ts --draw=<id>` on each file
before the mission JSON is written.

---

## 4. Mission ladder

Every mission declares `time_limit_s` at twice `target_minutes` (720 for 6, 840 for 7).
Every primary deadline plus 60 s fits inside it (`tools/validate_time_limit.mjs`). **The
failable primary is in bold.** Ledger shorthand:
- **R** `roster.surviving_units`; **M** `roe.mission_ratings`;
- **C** `campaign.completed_missions`; **X** `campaign.mission_results`;
- **I** `intel.marked_positions`; **E** `civ.settlements_evacuated`;
- **H** `civ.hostages_recovered`.

| # | id · name | phase | min | primaries (type · target) | secondaries | requires / produces | econ |
|---|---|---|---|---|---|---|---|
| 1 | `qasr_liwan_1_recon` · *One House* | recon | 6 | `locate` · `ql_house_guard`; **`evacuate_before` · `ql_extract` (count 1, `hostages`, 300 s)**; **`no_collateral_above` 10** | `locate` · `ql_post_seam` (carries → II) | R / R M C X I H | n (Intel by doing only) |
| 2 | `qasr_liwan_2_foothold` · *The Ring* | foothold | 7 | `hold_for` · `ring_north` 240; `hold_for` · `the_cut` 240; **`evacuate_before` · `cut_refuge` (count 6 of 9, 300 s)** | `capture` · `coast_road` 15 | R I / R M C X E | **y**: camp, 400 + 120/min; income `coast_road` 28, `the_cut` 20 |
| 3 | `qasr_liwan_3_buildup` · *The Pause* | buildup | 7 | **`evacuate_before` · `pause_refuge` (count 4 of 4, `hostages`, 330 s)**; `hold_for` · `staging` 300; **`no_collateral_above` 5** | `capture` · `water_point` 15; `locate` · `ql_yard_watch` (carries → IV) | R / R M C X I H | **y**: camp, 500 + 150/min; income `water_point` 80 |
| 4 | `qasr_liwan_4_clearance` · *The Clinic Yard* | clearance | 7 | `capture` · `clinic_yard` 15; **`evacuate_before` · `clinic_refuge` (count 5 of 6, 300 s)**; **`collapse` · `clinic_yard` 360**; **`no_collateral_above` 10** (`structure_penalty_mult` 2) | `eliminate_hvt` · `ql_yard_commander` | R I / R M C X I E | n |
| 5 | `qasr_liwan_5_subterranean` · *The Pumps* | subterranean | 7 | `hold_for` · `pump_yard` 180; **`collapse` · `shore_grid` 360**; **`no_collateral_above` 10** (`structure_penalty_mult` 4) | `eliminate_hvt` · `ql_grid_chief`; `locate` · `ql_deep_crew` (`carries` pending O-QL3) | R I / R M C X I | **y**: camp, 500 + 90/min |

- **Phases ascend:** 2, 3, 4, 5, 6.
- **Every type used is one of the twelve in `SUPPORTED`** (`mission.ts:726`); `escort`
  and `score` are not used, and `mark` stays absent.
- **Every ceiling sits beside another primary**, as `no_collateral_above` requires.
  Each ceiling's own text must tell the player its number.
- **Stars:**
  - I and III can reach three stars (their carrying secondaries are read by II and IV).
  - IV caps at two, which is normal for a clearance.
  - V caps at two until O-QL3 names a reader for `ql_deep_crew`.
- **The economy rows follow `income-numbers.md`'s 40% rule** on the GDD anchors: a
  foothold's 120 gives 48 (28 + 20), and a build-up's 200 gives 80. No income zone holds
  a starting placement, so a passive player earns nothing from one, which is the
  `ZONE_PASSIVE_INCOME` control. QL V's 500 + 90 copies `deir_amun_3_subterranean`.

---

## 5. Per mission

The tables give unit ids, counts, `from_ledger`, positions and stances. "On loan" means
the unit's gate is closed on a fresh campaign. It is fielded anyway, and it goes back
afterwards (README; `loanedPlacements`). The gates are read from
`data/units/kdf/*.json` `unlock`: `recon_drone` Conduct 70, `sniper_team` 80,
`yahalom_squad` 75, `ifv_namer` 85, `mbt_lavi` 90, and `ugv_recon_dog` and
`inf_medic_squad` price-gated at 4,000 and 4,250. **Every force carries an
`inf_medic_squad`**, as every campaign mission but the tutorial does (GH-707).

### 5.1 QL I: `qasr_liwan_1_recon` · *One House* · recon · 6 min · night

**Player starting state.**
- `map.player_start [44,2]`, east of the north road's end.
- `time_of_day: "night"`, which is presentation only (the app reads it and the sim never
  does; G-11).
- No `structures[]` and no logistics. Intel is earned by doing (8 per first
  identification, 40 per completed objective).

| unit | count | from | at |
|---|---|---|---|
| `recon_drone` | 1 | on loan | [44,3] |
| `sniper_team` | 1 | on loan | [43,2] |
| `inf_squad` | 2 | `from_ledger` | [44,1] |
| `jeep_shoded` | 1 | — | [45,2] |
| `apc_eitan` | 1 | — | [45,4] |
| `inf_medic_squad` | 1 | on loan unless bought | [43,4] |

**Civilians.** **One** placement, count 1, at **[18,9]** in the courtyard.
- `civilians.refuge: "ql_extract_point"` [22,1], inside `ql_extract`.
- `hostages_place`: a short phrase for "a house on the north edge" (`narrative-designer`
  words it, ≤40 characters).
- **No resident is placed anywhere.** `evacuate_before` counts every civilian who
  reaches the zone (G-8), and `civ.hostages_recovered` writes the objective's `count`,
  not who arrived (`mission.ts`, `recoveredHere += o.def.count`). A resident placed
  next door could complete the rescue and put a false 1 on the board. The neighbours
  are protected instead by the flagged zone and the ceiling.
- The walk from the courtyard through the north gate to the extract is **8 tiles**.

**Enemy stance.**

| tag / group | unit | at | stance | why there |
|---|---|---|---|---|
| `ql_house_guard` | `militia_cell` ×1 | [19,5] | `hold_position` | outside the courtyard's only gate, on the lane. **The primary `locate`** |
| `ql_lane_rpg` | `rpg_team` ×1 | [14,7] | `ambush(3)` | the lane west of the gate. An RPG fired at men beside the courtyard is the one enemy round that can splash the person walking out |
| group `street` | `militia_cell` ×2 | [6,11], [7,12] | `hold_position` | the street that wakes. 12 tiles west of the house |
| `ql_post_seam` | `militia_cell` ×1 | [7,2] | `hold_position` | behind the seam's berm; **carries into II** (secondary) |
| `ql_post_tower` | `militia_cell` ×1 | [32,5] (knoll) | `hold_position` | watches the north road, the direct route from the start. 12.4 tiles from the start, out of his sight (7) |
| `ql_post_coast` | `rpg_team` ×1 | [3,13] | `ambush(4)` | on the coast road. Carries silently into II |
| `ql_mortar` | `mortar_crew` ×1 | [10,15] | `hold_position` | range 16: **reaches the courtyard (about 10) and not the extract (about 18.4)**; QL-A8 |

**Waves.** 210 s: `moto_rpg` ×2 from `north_road_w` [6,3] to `ql_extract_point`. The
edge wakes up.

**Triggers.**
- `zone_entered(ql_house_yard)` → `commit street` → `the_house` [18,9].
- `timer_s(180)` → `commit street` → `the_house`. The street wakes on its own.
- Labels for `narrative-designer`, each under 48 characters, for example "The street is
  waking".
- **No `first_contact` trigger**: in this runtime it fires on any identification by either
  side (`isEnemyContact`), so the first drone sighting would fire it. That is the
  opposite of a quiet approach.

**The decision.** *How much of the edge to look at before going in, against a clock.*
- The guard is the only primary `locate`, and the drone can find him in one pass.
- Every other tag is time:
  - the tower post sits on the fast route;
  - the coast post covers the long way round;
  - the mortar is the only thing that can kill the person in the courtyard, and it is
    12 tiles from where the drone is looking.
- The street wakes at 180 s, or sooner if the player is seen at the house, and
  `evacuate_before` fails at 300 s.
- A player who goes straight in at about 60 s walks the person out before the street
  arrives, and hands II one tag out of three.
- A player who spends 150 s finding the mortar and the posts goes in as the street
  wakes. He has to hold the gate and the lane while the walk happens, and he hands II
  a known seam.

**Conduct.**
- `roe.flagged_zones: ["ql_lane"]`, `no_collateral_above` 10, multiplier 1.
- **The issued force fields no weapon at or above 0.3**, so the only way to lose
  Conduct is fire support: earned Intel buys a mortar barrage at 120 or a strike at 250.
- A barrage on the lane when the street wakes costs:
  - one strike into the flagged zone (5);
  - plus 3 if it is aimed within 2 tiles of the person;
  - and 6 for each house it brings down.
- So **one barrage dropped on the lane is survivable, and a second, or one that takes a
  house, is not.** That is the temptation the street exists to create.

**Passive-player loss.**
- A force parked at [44,2] is 12.4 tiles from the nearest post, outside its sight (7),
  so nothing sees it. The sniper (sight 16, range 15) may shoot the tower post from the
  start line, and that changes nothing.
- Nobody reaches the courtyard, so nobody walks, and `evacuate_before` **fails at 300 s**.
- The 210 s wave heads for the extract, 22 tiles west of the start.
- `playtest` confirms all of this with the passive probe.

**Twist candidates** (`level-scripter` classifies each):

- **T-QL1a "The guard was relieved."** The `ql_house_guard` placement Idit expects is
  empty. The real guard is a second placement with the same tag, in the lane at [12,6]
  (the `T2` shape, `storyline.md` §3.1). *Likely expressible today* (two placements, one
  tag; `locate` needs both).
- **T-QL1b "The mortar knows the courtyard."** On `zone_entered(ql_house_yard)`, a `say`
  from Idit that the mortar is ranged on it. *Expressible today.*
- **T-QL1c "The street does not come; it waits."** The `street` group's commit goes to
  the gate, not the house, so the walk out is the fight. *Expressible today*: change the
  marker.

**Story hooks** (`narrative-designer`):
- **The source.** Idit has one house and does not say how she knows; the briefing
  should not explain it.
- **The person.** "One of the people taken at First Light", and nothing more, in every
  line (L-16).
- **Shai's beat:** a clock, one person and a street of neighbours.
- **`debrief.victory`:** the first time the city has given anyone back.
- **The board line** moves by one.

### 5.2 QL II: `qasr_liwan_2_foothold` · *The Ring* · foothold · 7 min · **economy**

**Player starting state.**
- `map.player_start [44,24]`, on the east ground beside the inland road.
- `structures[]`: one `camp` at [44,27] (2×2) with its exit at `camp_exit` [43,27].
- `resources`:
  - `logistics_start` 400, `logistics_rate_per_min` 120;
  - `income_zones` `coast_road` 28 and `the_cut` 20.

| unit | count | from | at |
|---|---|---|---|
| `inf_squad` | 3 | `from_ledger` | [44,23] |
| `at_team` | 1 | `from_ledger` | [45,24] |
| `mortar_team` | 1 | `from_ledger` | [45,22] |
| `apc_eitan` | 2 | — | [43,25] |
| `jeep_shoded` | 1 | — | [43,22] |
| `ifv_namer` | 1 | on loan | [45,26] |
| `recon_drone` | 1 | on loan | [44,21] |
| `inf_medic_squad` | 1 | on loan unless bought | [42,24] |

**What to spend Logistics on (the briefing says it).** The camp buys a **second force**
for the second seam. The ungated menu is `inf_squad` (292), `at_team` (236),
`mortar_team` (209), `jeep_shoded` (317) and `apc_eitan` (520).
- The seam is ground for moving vehicles: the wave at 270 s is a `technical`, and the
  north road is the only fast way to it. It wants an `at_team` and a jeep.
- The Cut is infantry ground in one-tile lanes, so it wants two squads.
- 400 to start plus 120 a minute is about four units by 180 s.

**Civilians: the residents.** Three groups of 3 (**9**) in the south quarter's lanes:
- at [15,38], [19,38] and [37,37];
- `civilians.refuge: "refuge_point"` [28,45], inside `cut_refuge`;
- count **6 of 9**;
- walks of 13, 10 and 12 tiles, through or beside the checkpoint's lane;
- the nearest group is 14.8 tiles from the start.

**Enemy stance.**

| tag / group | unit | at | stance | note |
|---|---|---|---|---|
| `ql_post_seam` | `militia_cell` ×1 | [7,2] | `hold_position` | **read from I.** Pre-identified if I saw it |
| `ql_post_coast` | `rpg_team` ×1 | [3,13] | `ambush(4)` | read from I. Marked means it forfeits its ambush |
| `ql_post_tower` | `militia_cell` ×1 | [32,5] | `hold_position` | read from I. Watches the north road to the seam |
| `ql_mortar` | `mortar_crew` ×1 | [10,15] | `hold_position` | read from I. 12.6 tiles from the seam's point |
| group `seam_reserve` | `militia_cell` ×2, `rpg_team` ×1 | [10,7], [11,7], [12,7] | `hold_position` | commits on the seam |
| group `lanes` | `militia_cell` ×2 | [18,31], [19,31] | `hold_position` | the lanes north of the Cut |
| `ql_lanes_rpg` | `rpg_team` ×1 | [23,34] | `ambush(3)` | the lane mouth above the checkpoint |
| (buried) | `militia_cell` ×2 | `in_tunnel: ql2_vent_north` | — | vents **inside** `ring_north` |
| (buried) | `militia_cell` ×1, `rpg_team` ×1 | `in_tunnel: ql2_vent_south` | — | vents beside `coast_road` |

A buried enemy contests nothing (`enemyNear` skips `tunnelIn`). A crew that has surfaced
to fire does contest, so the vents pause both holds while they are up.

**Waves.**

| at | units | from | to |
|---|---|---|---|
| 120 s | `militia_cell` ×2 | `north_muster` [10,7] | `seam_point` [6,3] |
| 180 s | `militia_cell` ×2, `rpg_team` ×1 | `lanes_muster` [18,31] | `cut_gate` [28,41] |
| 270 s | `technical` ×1 | `north_road_w` [6,3] (a new marker on this map) | `coast_point` [3,40] (new) |
| 330 s | `militia_cell` ×3 | `north_muster` | `seam_point` |
| 390 s | `moto_rpg` ×2 | `lanes_muster` | `cut_gate` |

**Triggers.**
- `zone_entered(ring_north)` → `commit seam_reserve` → `seam_point`.
- `zone_entered(the_cut)` → `commit lanes` → `cut_gate`.
- `casualties_pct(50)` → `withdraw_to north_muster`, group `seam_reserve`.

**The decision.** *Hold the seam or keep the checkpoint open; doing both splits the force.*
- The two holds are about 40 tiles apart: `seam_point` is 40 tiles on foot from the
  start and `cut_gate` is 20.
- `hold_for` accumulates and never resets, so either can be held in pieces, but each
  pauses whenever a vent crew surfaces in it.
- The residents need a soldier within 4 tiles to start walking, and they walk through
  the checkpoint's lane.
- So **the Cut asks for men in the lanes at the same minute the seam asks for the AT
  team on the north road.**
- I's recon decides how much the seam costs: a known mortar and two known posts make
  the north a short fight; three unknowns make it the long one.

**Conduct.** `roe.flagged_zones: ["south_quarter"]`, multiplier 1, no ceiling and no
`fail_below` (the outline's row). **The evacuation is the civilian objective here.** The
mortar and the Namer's cannon are the two weapons that bill near the residents' houses.

**Passive-player loss.**
- Nobody reaches the residents and nobody walks, so `evacuate_before` **fails at 300 s**.
- The enemy fires only at targets and a passive force has none near the residents, so
  **no enemy round suppresses a resident into walking on his own** (`CIV_FLEE_AT` 0.3).
  `playtest`'s passive probe must check that no resident flees. If one does, the wave
  path through the south quarter is the reason, and the marker moves.
- No income zone holds a starting placement.

**Twist candidates.**
- **T-QL2a "The seam was a decoy."** `ql2_vent_north` has no stock, and the reserve
  comes from the coast road. *Expressible today.*
- **T-QL2b "They come through with the residents."** A `moto_rpg` wave rides the Cut
  from the west at the moment the residents walk. *Expressible today*; the timing is
  `level-scripter`'s.
- **T-QL2c "The Cut is the brigade's from now on."** An `aftermath` only. *Expressible today.*

**Story hooks.**
- **The `dispatch` names the Cut for the first time.** It is a road, and it will
  divide the Marj for the rest of the war.
- **Idit's beat:** the posts she can name came from the one house.
- **Shai's beat:** two seams and one brigade.

### 5.3 QL III: `qasr_liwan_3_buildup` · *The Pause* · build-up · 7 min · **economy**

**Player starting state.**
- `map.player_start [42,45]`, south of the Cut.
- `structures[]`: one `camp` at [44,44] with its exit at `camp_exit` [41,43].
- `resources`:
  - `logistics_start` 500, `logistics_rate_per_min` 150;
  - `intel_start` 0;
  - `income_zones` `water_point` 80.

| unit | count | from | at |
|---|---|---|---|
| `inf_squad` | 3 | `from_ledger` | [42,44] |
| `at_team` | 1 | `from_ledger` | [43,46] |
| `mortar_team` | 1 | `from_ledger` | [41,46] |
| `apc_eitan` | 1 | — | [40,45] |
| `jeep_shoded` | 1 | — | [40,44] |
| `recon_drone` | 1 | on loan | [43,45] |
| `inf_medic_squad` | 1 | on loan unless bought | [41,44] |

No sniper and no tank. Both out-range the enemy's eyes (sniper range 15 and sight 16;
Lavi gun 12 and sight 12), and either would break the pause on its own (below).

**What to spend Logistics on.** The force that holds `staging` when the pause ends at 240 s.
- 500 plus 150 a minute is about 1,100 by then, plus 80 a minute from the water point
  once it is held: four or five ungated units.
- AT for the `technical` at 300 s, two squads for the infantry waves, and a mortar only
  if it stays out of the handover's zones.
- **Intel** earned in the pause buys a smoke screen (100) for the walk, or nothing.

**Civilians: the taken.** **One group of 4** at [12,37], inside `handover`.
- `civilians.refuge: "pause_refuge_point"` [12,45], inside `pause_refuge`.
- Count **4 of 4**, `hostages: true`; `hostages_place` "the Cut".
- The walk across the Cut is **8 tiles**.
- **No resident is placed** (G-8).

**The pause, as the runtime can express it today** (G-6 is the proper form).
1. **The handover party.** Group `handover_party`, `militia_cell` ×2 at [11,34] and
   [13,34], `hold_position`, 3 tiles from the taken. `timer_s(90)` → `withdraw_to
   handover_withdraw` [14,28], about 10 tiles back. Before 90 s, a soldier who walks up
   to the taken is in their rifles' range.
2. **The lines.** The enemy holds just beyond the player's eyes:
   - group `west_line`, `militia_cell` ×2 at [9,29] and [11,29], 9.5 tiles from the
     handover;
   - group `centre_line`, `militia_cell` ×2 and `rpg_team` ×1 at [22,26], [23,27] and
     [22,27], 10.2 from staging;
   - group `east_line`, `militia_cell` ×2 at [39,27] and [39,28], 10.8 from staging;
   - `mortar_crew` ×1 at [17,24], 13.9 from staging's corner and 14.9 from the handover.

   Militia sight and rifle range are 7, and the player's infantry see 8 (QL-A7). **Nobody
   fires unless somebody moves.**
3. **The end.** `timer_s(240)` → `commit` each line group → `staging_point` [28,38].
4. **The pause can be broken early, by either side's act:**
   - `zone_entered(pause_line)` → `commit` the lines. The player crossed the south street.
   - `casualties_pct(5)` → `commit` the lines. Eleven enemies stand at start, so one death
     is enough.
5. **The player's own hold-fire is the `ambush` stance.**
   - The sim's `setStance` command with `stance: 'ambush'` (`sim.ts` `Command`) is issued
     by the app (`input/intents.ts`, `ui/advisor.ts`).
   - A mortar left on its default stance fires on anything the drone identifies within
     18 tiles. That one round is the careless volley.

**Enemy stance (also).**
- `ql_yard_watch`, `rpg_team` ×1 at [27,22] inside the clinic yard, `hold_position`.
- It is 14 tiles from staging, and the **carrying secondary** is to find it.
- Finding it means flying the drone over the compound during the pause, with the mortar
  and AT team on `ambush`, or the first identification brings the pause down.

**Waves** (the end of the pause, on the clock):

| at | units | from | to |
|---|---|---|---|
| 240 s | `militia_cell` ×3, `rpg_team` ×1 | `city_north` [21,18] | `staging_point` |
| 240 s | `militia_cell` ×2 | `city_west` [6,20] | `water_point`'s centre (new marker `water_mk` [17,38]) |
| 300 s | `technical` ×1, `moto_rpg` ×2 | `city_east` [39,18] | `staging_point` |
| 390 s | `militia_cell` ×2, `rpg_team` ×1 | `city_north` | `staging_point` |

**The decision.** *What to build, and where to stand when it ends.*
- The taken are only reachable safely between 90 s and 240 s.
- Reaching them takes a soldier to the handover, **18 tiles west of staging**.
- The water point pays 80 a minute and sits between the handover and staging, under the
  west wave's arrival.
- `staging` must be held for 300 s in total, and only the 150 s before the pause ends are
  free.

So the player chooses, minute by minute:
- whether to spend the pause **receiving the taken** (free now, and impossible under fire
  later);
- whether to spend it **building** (what holds staging at 240 s);
- or whether to spend it **looking at the clinic yard** (IV's carry, and the one act that
  can end the pause early).

**Conduct.**
- `roe.flagged_zones: ["handover", "walk_south"]`, multiplier 1.
- **`no_collateral_above` 5** (a deviation from the outline):
  - one stray into the handover ground (5) is forgiven, and a second is not;
  - a civilian killed (8) or a house levelled (6) is never forgiven.
- The 240 s west wave goes to the water point, **one tile east of the flagged handover
  zone**. A mortar answering it is the round most likely to cost the mission.

**Passive-player loss.**
- Nobody walks to the handover, so `evacuate_before` **fails at 330 s**.
- `staging` is forward of the start, so a passive force holds nothing.
- The waves from 240 s fight a force parked south of the Cut, and the clock decides it
  first.

**Twist candidates.**
- **T-QL3a "One of them is not walking."** One of the four taken is placed apart, at
  [10,36], so the walk needs a second soldier. *Expressible today.*
- **T-QL3b "They stood closer."** At `timer_s(200)` the lines `withdraw_to` markers 2
  tiles **south**, inside the player's sight, so the pause ends with the enemy already
  visible. *Expressible today.* `withdraw_to` is a move, and the name is the runtime's.
- **T-QL3c "The pause ends early, and nobody fired."** A `timer_s(200)` early commit with
  a `say` that it was not the brigade. *Expressible today*, and it is the cheapest
  version of a treacherous pause. **I recommend against it**: it teaches the player that
  restraint is not rewarded, which is the one lesson this town must not teach.

**Story hooks.** The `dispatch` says a pause was agreed and that people will be handed
back at the Cut. Idit's beat is the cost of looking (she can see the yard, and seeing
it is what ends the quiet). Shai's beat is that the pause is the only time the brigade
can buy the next fight. The `aftermath` says only that four came back.

### 5.4 QL IV: `qasr_liwan_4_clearance` · *The Clinic Yard* · clearance · 7 min

**Player starting state.**
- `map.player_start [28,44]`, south of the checkpoint.
- No economy. Intel by doing.

| unit | count | from | at |
|---|---|---|---|
| `yahalom_squad` | 1 | on loan | [27,45] |
| `ugv_recon_dog` | 1 | on loan unless bought | [29,45] |
| `inf_squad` | 3 | `from_ledger` | [28,43] |
| `at_team` | 1 | `from_ledger` | [26,44] |
| `ifv_namer` | 1 | on loan | [31,44] |
| `mbt_lavi` | 1 | on loan | [33,45] |
| `apc_eitan` | 1 | — | [24,45] |
| `inf_medic_squad` | 1 | on loan unless bought | [30,46] |

The Lavi is issued on purpose. Its coax (0.20) is free in the yard and its gun (0.55) is
not, and that is the mission's thesis (`khan_rafid/design.md` §3.1).

**Civilians: the clinic's people.**
- Two groups of 3 (**6**) at [32,26] and [33,27], in the forecourt inside zone `clinic`.
- `civilians.refuge: "clinic_refuge_point"` [29,38], inside `clinic_refuge`.
- Count **5 of 6**: one death is the margin, and the ceiling makes it costly.
- The walks out through the south gate are 13 and 14 tiles.
- No other civilian is placed (G-8).

**Enemy stance.**

| tag / group | unit | at | stance | note |
|---|---|---|---|---|
| `ql_yard_watch` | `rpg_team` ×1 | [23,24] | `ambush(3)` | outside the west gate. **Read from III**: pre-identified and its ambush forfeit if III found it |
| `ql_yard_commander` | `militia_cell` ×1 | [27,24] | `hold_position` | in the yard behind the sandbags. **Secondary** |
| group `firing_line` | `militia_cell` ×1 | `garrison` F [22,18] | `garrison` | north-west of the compound, on the clinic street |
| group `firing_line` | `militia_cell` ×1, `rpg_team` ×1 | `garrison` F [37,23] | `garrison` | east, **three tiles from the clinic's wall**: the bait (below) |
| group `firing_line` | `militia_cell` ×1 | `garrison` F [22,30] | `garrison` | south-west, covering the south gate and the walk out |
| group `quarter` | `militia_cell` ×2 | [19,23], [19,24] | `hold_position` | the shore-quarter lane west of the compound |
| `ql_shore_watch` | `rpg_team` ×1 | [15,26] | `hold_position` | the shore quarter's watcher. **Carries silently into V** |
| (buried) | `militia_cell` ×2, `rpg_team` ×1 | `in_tunnel: ql4_yard` | — | vents **in the yard** at (27,27); a surfaced crew pauses the capture |

**Nobody is garrisoned in the clinic, or in any house.** The only garrisons are in the
enemy's own works (`militia_firing_position`, `owner` 1, `roe_penalty` 0): levelling one
costs nothing, and a round that misses one lands near the clinic.

**Waves.**
- 150 s: `militia_cell` ×2, from `north_muster` [21,8] to `yard_point` [27,24].
- 270 s: `technical` ×1 and `rpg_team` ×1, from `east_muster` [40,12] to `south_gate` [29,30].

**Triggers.**
- `zone_entered(compound)` → `commit quarter` → `yard_point`.
- `casualties_pct(50)` → `withdraw_to north_muster`, group `firing_line`. The firing line
  gives up the compound.

**The decision.** *Which weapon you may use beside a clinic.*
- The yard is a fight: capture it for 15 s uncontested, find the route (the dog, or the
  Yahalom's own `mark_tunnel`), and hold the Yahalom still for 8 s within 2 tiles of the
  route (`tunnel_charge_time_s` 8; `CHARGE_RANGE_SQ`, 2 tiles).
- The people must be walked out of the forecourt past the south-west firing position
  before 300 s.
- The east firing position is three tiles from the clinic's wall.
  - Every Lavi or Namer round that misses it lands in zone `clinic` and costs 5.
  - The rifles and the coax cost nothing.
- **The order is the second decision:**
  - people first (300 s), then the route (360 s);
  - or the yard first, so the vent stops surfacing, then the people under less fire.

**Conduct.**
- `roe.flagged_zones: ["clinic"]`, `structure_penalty_mult` **2**, `no_collateral_above` 10.
- **Losing the clinic costs 12 and fails the mission alone.**
- A house costs 12 and fails alone. A shanty costs 4, and a firing position 0.
- Two strays into the clinic zone (10) pass, and a third fails.
- A civilian killed (8) plus one stray (5) fails.
- Nothing in the win needs any of it.

**Passive-player loss.** `evacuate_before` **fails at 300 s**, and `collapse` fails at
360 s. The enemy fires only at targets, so no clinic civilian is suppressed into walking.

**Twist candidates.**
- **T-QL4a "The mouth moved."** Idit's picture places the mouth at the yard's north end.
  It is at the south end, and a second, empty decoy shaft is drawn as a route outside
  the collapse zone. *Expressible today* (two routes).
- **T-QL4b "The commander goes to ground."** `casualties_pct(30)` → `withdraw_to` a lane
  marker for the yard commander's group, so the secondary becomes a pursuit into the
  shore quarter. *Expressible today.*
- **T-QL4c "Nothing beneath the clinic."** Deliberately **not** a twist. No line and no
  placement says anything about what is or is not under the clinic itself (L-11).

**Story hooks.**
- **Idit's picture says one thing: the shaft is in the yard.** Her beats and the
  objective text name the yard and never the building (L-11).
- **Shai's beat:** what the tank is for and what it is not.
- **The `debrief` names the people** who walked out: the count, not who they were.

### 5.5 QL V: `qasr_liwan_5_subterranean` · *The Pumps* · subterranean · 7 min · **economy**

**Player starting state.**
- `map.player_start [24,44]`, south of the Cut.
- `structures[]`: one `camp` at [26,45] with its exit at `camp_exit` [28,44].
- `resources`: `logistics_start` 500, `logistics_rate_per_min` 90.

| unit | count | from | at |
|---|---|---|---|
| `yahalom_squad` | 2 | on loan | [23,45], [25,44] |
| `ugv_recon_dog` | 1 | on loan unless bought | [24,43] |
| `recon_drone` | 1 | on loan | [22,44] |
| `inf_squad` | 3 | `from_ledger` | [24,45] |
| `at_team` | 1 | `from_ledger` | [21,45] |
| `ifv_namer` | 1 | on loan | [27,43] |
| `apc_eitan` | 1 | — | [20,44] |
| `inf_medic_squad` | 1 | on loan unless bought | [22,46] |

**What to spend Logistics on.** Bodies for the pump yard while the engineers work. The
ungated `inf_squad` and `at_team` fit. A third `yahalom_squad` can be bought only by a
campaign whose Conduct has opened its 75 gate. That is a reward for restraint the
briefing should name.

**Civilians.** None are placed: the shore has been emptied. The relief depot and the
shore's houses are protected by the flagged zones and the ceiling.

**Tunnels** (§3.5): two shallow routes and three deep ones.

**Enemy stance.**

| tag / group | unit | at | stance | note |
|---|---|---|---|---|
| (buried) | `militia_cell` ×1 | `in_tunnel: ql5_shallow_n` | — | vents at the pump yard's north edge |
| (buried) | `militia_cell` ×1 | `in_tunnel: ql5_shallow_s` | — | vents at its south edge |
| (buried) | `militia_cell` ×2, `rpg_team` ×1 | `in_tunnel: ql5_deep_depot` | — | **surfaces inside the relief depot's yard** |
| (buried) | `militia_cell` ×1 | `in_tunnel: ql5_deep_quay` | — | the beach |
| (buried) | `militia_cell` ×2 | `in_tunnel: ql5_deep_cut` | — | surfaces on the apron when the dig completes (about 54 s) |
| `ql_deep_crew` | `digger_crew` ×1 | [15,35] | `digs: ql5_deep_cut` | the `bs4_digger` pattern (`beit_sahwan_4_subterranean`): a tagged digger is a `locate` target |
| `ql_grid_chief` | `militia_cell` ×1 | [14,32] | `garrison` F [12,30] | the deep shaft head's command post. **Secondary.** Levelling an F costs 0 |
| `ql_shore_watch` | `rpg_team` ×1 | [6,25] | `ambush(3)` | **read from IV**: pre-identified and its ambush forfeit if IV saw it |
| group `pump_guard` | `militia_cell` ×2 | [5,29], [6,29] | `hold_position` | in the pump yard, on cover. They contest the hold until cleared |

**Waves.**

| at | units | from | to |
|---|---|---|---|
| on `run_the_pumps` complete (the `hold_for` objective's id; the wave's `trigger` field) | `militia_cell` ×3 | `vent_shallow_n` [6,24] | `pump_point` [3,29] |
| on `run_the_pumps` complete | `militia_cell` ×2, `rpg_team` ×1 | `vent_shallow_s` [6,34] | `pump_point` |
| 240 s | `technical` ×1 | `north_muster` [6,8] | `pump_point` |

**The pumps, as the runtime can express them.**
- The `hold_for` is the fiction of the water going in.
- When it completes, the shallow crews are **forced up**: the two waves spawn on the
  shallow vents' tiles and come at the pump yard.
- A route cannot be made to vent on a trigger, and a wave `from` a tunnel id is
  unimplemented (G-12). So the vent markers stand in.
- The small `in_tunnel` stocks in the shallow routes keep venting either way. Removing
  them when the pumps run needs a trigger keyed on an objective completing (G-QL2).
- **The deep tier does not flood** (`arc-outline.md` §3, dossier T4 as cited by beat ID).
  Its three routes must be found and charged by hand.
- `collapseTunnel` splashes with **damage 0** (`sim.ts`, `TUNNEL_COLLAPSE_SHOCK` only), so
  no charge can hurt the depot. **The depot's danger is fire at the crews that surface
  beside it.**

**The decision.** *Where to put the engineers while the shallow crews come up.*
- A route counts only while somebody watches it.
  - The dog (sight 12) and the drone (16) identify the routes.
  - An unwatched route decays to unknown (`sim.ts`, "Unwatched contact decays").
  - A Yahalom can charge only an identified route (`stepTunnelCharge`).
- Two engineers, three deep routes, and a pump hold that, when it completes, brings
  five men up at the yard the infantry are standing in.
- **Run the pumps early** and the flush lands while the engineers are still at the mouths.
  **Run them late** and the deep crews have been venting at the depot all along.
- `ql5_deep_depot` can be identified and charged from outside the depot's yard (QL-A6),
  and doing it first silences the crews that surface beside the one building the player
  must not hit.

**Conduct.**
- `roe.flagged_zones: ["relief_depot", "shore_quarter"]`, `structure_penalty_mult` **4**,
  `no_collateral_above` 10.
- **The depot costs 12 and fails alone.** A house costs 24, a shanty 8, a pump house 8,
  and a firing position 0.
- Two strays (10) pass and a third fails.
- The Namer's cannon (0.35) is the only issued weapon at or above 0.3 besides fire
  support. The rifles answer the depot's crews for free.

**Passive-player loss.**
- `collapse` **fails at 360 s**.
- The `ql5_deep_cut` crew surfaces about 5 tiles from a parked start force at about 54 s
  and fights it, and the clock decides first.

**Twist candidates.**
- **T-QL5a "It comes up at the Cut."** `ql5_deep_cut`'s vent opening behind the start
  line is the twist. A `say` from Idit when the dig completes needs a trigger on a route
  opening (G-QL2's sibling). Today a `timer_s` close to the measured dig time does it.
  *Expressible today, approximately.*
- **T-QL5b "The chief goes for the quay."** `casualties_pct(60)` → `withdraw_to` a beach
  marker for the chief's group: he leaves his post and the secondary becomes a run. Kept
  as a secondary only. Option C's failable form is dead (§1).
- **T-QL5c "A fourth route."** One more deep route, not `pre_dug`, with no spoil and a
  digger who is never placed: the picture is incomplete. *Needs authoring care.* A route
  nobody digs and nobody stocks is inert, so it is decoration unless it is in the collapse
  zone, and then it becomes a primary target found only by `mark_tunnel`.

**Story hooks.**
- **The briefing's first sentence is mapping:** the brigade enters second.
- **The water as told:** the pumps are the fiction of the water going in, and the
  `aftermath` says plainly that the water does not reach the deep routes.
- **The relief depot:** "the relief depot", with no agency and no mark (L-12).
- **The grid chief** is a job title.
- **The `debrief.victory`** closes the town: the city is ringed, cut off from the south,
  and the ground under its shore is the brigade's.

### 5.6 The adversary across the town, in one table

| mission | what he does | what the player can do about it |
|---|---|---|
| I | holds one of the taken in a family's house, behind one gate | find the mortar before going in |
| II | rings the city with posts that knew the approach, and vents at both seams | carry I's tags; split the force |
| III | uses the pause to stand closer, and comes the moment it ends | build, receive the taken, and keep the mortar on ambush |
| IV | digs a shaft into a clinic's yard and sets firing positions three tiles from its wall | fight with rifles beside the clinic |
| V | ends a route under the relief depot and digs toward the Cut | map first, and charge the depot route from outside its yard |

### 5.7 What `playtest` must measure, in this order

1. **Passive controls, all five.** Each must end in DEFEAT by its failable primary's
   clock: QL I at 300 s, II at 300 s, III at 330 s, IV at 300 s and V at 360 s. QL II's
   probe also asserts that **no resident flees without a soldier** (§5.2), and QL I's
   that no `first_contact` trigger exists.
2. **QL III's pause holds.** A scripted plan that receives the taken between 90 s and
   240 s with the mortar on `ambush` must see **no enemy fire before 240 s**. If fire
   comes, QL-A7's distances are wrong.
3. **The ceilings can be met.** In each of III, IV and V, the winning plan's Conduct loss
   is printed beside its threshold. A plan that wins at exactly the threshold is a warning.
4. **The carries are read.** `carryReaderOf` names QL II for `ql_post_seam` and QL IV for
   `ql_yard_watch`. `pnpm playtest`'s star assertion holds I and III at three stars.
5. **Time in band.** Each winning plan inside its own limit with the README's margins
   (120 s and 20% over the slowest 30-seed win).
6. **First shipped `no_collateral_above`.** The harness drives three missions that carry
   one (G-16). Confirm the plan ladder reports a ceiling failure as a defeat with an
   objective cause.

---

## 6. Asset manifest

Censused in this worktree on 2026-11-15 (appendix). No row is without a path or a gate.

### 6.1 Units, all PRESENT

| unit | path | used in |
|---|---|---|
| `recon_drone` | `data/units/kdf/recon_drone.json`, `art/meshes/vehicles/recon_drone.glb` | I, II, III, V |
| `sniper_team` | `data/units/kdf/sniper_team.json`, `art/meshes/sniper_team.glb` | I |
| `inf_squad` | `data/units/kdf/inf_squad.json`, `art/meshes/inf_squad.glb` | all |
| `inf_medic_squad` | `data/units/kdf/inf_medic_squad.json`, `art/meshes/inf_medic_squad.glb` | all |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json`, `art/meshes/vehicles/jeep_shoded.glb` | I, II, III |
| `apc_eitan` | `data/units/kdf/apc_eitan.json`, `art/meshes/vehicles/apc_eitan.glb` | all |
| `at_team` | `data/units/kdf/at_team.json`, `art/meshes/at_team.glb` | II to V |
| `mortar_team` | `data/units/kdf/mortar_team.json`, `art/meshes/mortar_team.glb` | II, III |
| `ifv_namer` | `data/units/kdf/ifv_namer.json`, `art/meshes/vehicles/ifv_namer.glb` | II, IV, V |
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json`, `art/meshes/vehicles/mbt_lavi.glb` | IV |
| `yahalom_squad` | `data/units/kdf/yahalom_squad.json`, `art/meshes/yahalom_squad.glb` | IV, V |
| `ugv_recon_dog` | `data/units/kdf/ugv_recon_dog.json`, `art/meshes/ugv_recon_dog.glb` | IV, V |
| `militia_cell`, `rpg_team`, `mortar_crew`, `digger_crew` | `data/units/enemy/*.json`, `art/meshes/<id>.glb` | as tabled |
| `technical`, `moto_rpg` | `data/units/enemy/*.json`; `art/meshes/vehicles/technical.glb`, `art/meshes/moto_rpg.glb` | II, III, IV, V |
| `civilians` | `data/units/civilians.json`; `art/meshes/civilians/{civilian_child,civilian_woman,farm_worker,office_worker}.glb` | I to IV |

### 6.2 Structures, all PRESENT

`data/structures.json` types, each with an idle and a wreck GLB in `art/meshes/buildings/`:

- `house`, `shanty`, `apartment`, `warehouse` (the relief depot), `concrete`, `clinic`,
  `pump_house`, `wall`;
- `sandbag_wall`, `t_wall`, `hesco`, `militia_firing_position`, `camp`.

No new structure is needed. `fence` and `hall` are deliberately unused.

### 6.3 Maps, data and the board

| asset | status | gate and pipeline |
|---|---|---|
| map `qasr_liwan` (+ markers and zones in §3.4) | MISSING | `pnpm validate:data`; `map_visibility.test.ts` (84%); `qasr_liwan_doctrine.test.ts` (new, §3.7). `mission-author`, hand-authored from §3.1 |
| maps `qasr_liwan_2`, `_3`, `_4`, `_5` (+ `tunnels`) | MISSING | as above; the variant rows in §3.3 and the routes in §3.5 |
| missions `qasr_liwan_1_recon` … `_5_subterranean` | MISSING | `pnpm validate:data` (schema, `validate_time_limit`, `validate_income`, the garrison and burial rules); `pnpm playtest`. `mission-author` |
| map and mission registration | MISSING | `packages/data/src/index.ts` imports, plus the maps and missions records (`index.test.ts` pins them). `mission-author` |
| town id `qasr_liwan` | MISSING | `data/schemas/mission.schema.json` `town` enum (eight values today). `sim-guard` (G-10) |
| `world.json` town entry | MISSING | `data/campaign/world.json`, region `marj`, between `beit_sahwan` and `khan_rafid`, with five missions and an `at` inside the `marj` outline in `countries.json` (a proposal: about [64, 318], confirmed by the board's own point-in-outline check). `mission-author` |
| GDD §2 town list | MISSING | one word in `docs/GDD.md` §2's towns line. `narrative-designer` |
| `commander.json` | PRESENT, unchanged | `data/campaign/commander.json`. Captain until `deir_amun_3_subterranean` already covers this town |
| portraits | PRESENT | `assets/ui/portraits/shai_hammai.png`, `idit_zohar.png` |
| briefing plates | optional, MISSING | `assets/ui/plates/` holds only `units/`. Ungated; generative art is disclosed in the PR |

### 6.4 Decor, props, VFX, audio

| asset | status | path |
|---|---|---|
| desert scrub (`o`) | PRESENT | `art/meshes/decor/desert_tree_0..2.glb` |
| tunnel mouth and vent props | PRESENT | `art/meshes/props/tunnel_mouth.glb`, `tunnel_mouth_collapsed.glb`, `tunnel_vent.glb`, `tunnel_vent_collapsed.glb`, `spoil_heap.glb` |
| street props (optional dressing) | PRESENT | `art/meshes/props/water_tank.glb`, `laundry_line.glb`, `jersey_barrier.glb`, `wrecked_car.glb` |
| collapse and demolition VFX | PRESENT | `data/vfx/tunnel_collapse.json`, `collapse_flash.json`, `structure_collapse.json` |
| town ambience | PRESENT | `assets/audio/ambience/amb_town.ogg` (`data/audio.json`) |
| a mark that tells the relief depot from a warehouse at a glance | MISSING, **optional** | `pnpm validate:meshes`; `blender-art`, with the lead approving art numbers first. **No real agency's insignia, colour or emblem**: plain stacked crates and a tarpaulin at most. Without it the flagged zone's overlay is the only tell |
| a shore or sea edge | MISSING, **not needed** | G-15: the sea is off-map, and the beach strip x0 to 1 reads as the edge. A water tile is a renderer and theme change, out of scope |
| voice lines for the five missions | not written | the bark and briefing pipeline (WP-AU1). A native speaker reviews every line (`storyline.md` §2.4 rule 5) |

`art/blend/` in the main checkout (`KDF`, `enemy`, `civilian`, `terrain object`, `map`
and the tile folders) holds nothing this town needs that is not already exported.

---

## 7. Engine, schema and content gaps

### 7.1 Against the arc's G-list

| # | gap | here | class | today's fallback in this design | owner |
|---|---|---|---|---|---|
| G-4 | no flooding | QL V | engine | the `pump_yard` hold, then waves from the shallow vent markers, with the deep tier collapsed by hand | `sim-guard` |
| G-5 | player units cannot go below ground | QL IV, V | engine | every raid stays at the shaft head; charges are worked from the surface | `sim-guard` |
| G-6 | no mission-side weapons-held window | QL III | engine | distance (QL-A7), the handover party's `withdraw_to` at 90 s, early-break triggers on the pause line and on the first death, and the player's own `ambush` stance | `sim-guard` |
| G-7 | a friendly-tagged prisoner | QL I | — | **not used.** The person is a `civilians` placement and is never characterised (L-16) | — |
| G-8 | `evacuate_before` counts every civilian and cannot name a group | QL I, III, IV | schema | **no other civilian is placed** on a mission with a `hostages` evacuation. QL IV places only the clinic's people | `sim-guard` |
| G-9 | `locate` targets units, never routes | QL V | schema | the collapse already needs every deep route found; `ql_deep_crew` is a tagged digger | `sim-guard` |
| G-10 | a new town | all five | schema + data | none: `qasr_liwan` is added to the `town` enum, `world.json` and GDD §2 | `sim-guard`, `mission-author` |
| G-11 | night is presentation only | QL I | design note | night is mood. The raid works by stance, a trigger and a clock | none |
| G-12 | a wave `from` a tunnel is unimplemented (`mission-findings.md`) | QL II, IV, V | engine | `in_tunnel` stocks that vent, and waves from markers on vent tiles | `sim-guard` |
| G-15 | no sea tile on an arid map | QL V | design note | the sea is off-map past x=0 | none |
| G-16 | first shipped `no_collateral_above` | QL I, III, IV, V | test | `playtest` drives three ceilings in one town (§5.7 item 6) | `playtest` |

### 7.2 New gaps this town surfaces

| # | gap | missions | class | smallest proposal | owner |
|---|---|---|---|---|---|
| **G-QL1** | Conduct cannot price one building above its type. A `clinic` is 6 and a `warehouse` 3, so a ceiling of 10 cannot protect either alone | QL IV, V | schema + engine | `structures[].roe_penalty` on a mission placement, overriding the type's, read where `structureDestroyed` is judged. Today's stand-in is `structure_penalty_mult` (×2 and ×4), which also prices every house in those missions at 12 and 24 | `sim-guard` |
| **G-QL2** | no trigger condition on an objective completing, nor on a route opening | QL V | schema + engine | `on.kind: "objective_complete"` with `objective`, and `"route_open"` with `route`. With them, a `remove` on the shallow stocks can say "the water got there", and a `say` can mark the deep crew breaking through. Waves already take `trigger: <objective id>` | `sim-guard` |
| **G-QL3** | civilians exist from t=0 only; nothing can spawn side 2 | QL III | engine | `spawn` with a `side: 2` placement. The taken could then **arrive** at the handover instead of standing there behind a guard who steps back | `sim-guard` |
| **G-QL4** | nothing checks a `capture` or `hold_for` zone for enough passable tiles (Khan Rafid's G9) | all | validator | the doctrine test's QL-A1 asserts it per map. The general rule belongs in `validate_data.mjs` | `content-validator` |

### 7.3 Content changes this town requires

| # | change | file | owner |
|---|---|---|---|
| C1 | `qasr_liwan` in the `town` enum | `data/schemas/mission.schema.json` | `sim-guard` |
| C2 | the town entry and its five missions | `data/campaign/world.json` | `mission-author` |
| C3 | five maps and five missions, and their registration | `data/maps/`, `data/missions/`, `packages/data/src/index.ts` | `mission-author` |
| C4 | `tools/src/qasr_liwan_doctrine.test.ts` (QL-A1 to QL-A8) | `tools/src/` | `level-scripter` writes the assertions, `mission-author` lands them |
| C5 | GDD §2's towns line gains Qasr Liwan | `docs/GDD.md` | `narrative-designer` |
| C6 | **Re-briefs: QL III falsifies two landed lines.** `storyline.md` §3.1, *"Beit Sahwan runs phases 1, 2, 3, 5, 6, no build-up … the brigade got no breathing room in the Marj"*; and `wadi_halam_3_counterraid.json`'s `debrief.defeat`, *"We spent the only quiet week of the war on it"* (as quoted in `khan_rafid/design.md` §1). Either both lines change in the same commit as QL III, or QL III's `aftermath` says the pause was not quiet. I recommend the first | `docs/campaign/storyline.md`, `data/missions/wadi_halam_3_counterraid.json` | `narrative-designer` |
| C7 | Khan Rafid I's re-brief (`arc-outline.md` §2: "KR I re-briefed") can name the Cut | `data/missions/khan_rafid_1_recon.json` | `narrative-designer` |

---

## 8. Open decisions for the lead

| # | decision | default |
|---|---|---|
| **O-QL1** | The plot | **Option A, *Five Doors*** (§1) |
| **O-QL2** | The deviations from the outline's rows (§0): three post tags; III's ceiling at 5; III and IV producing I; IV and V using `structure_penalty_mult`; V's `survive_until` replaced by `eliminate_hvt(ql_grid_chief)` | **Accept all.** Each one can be struck on its own |
| **O-QL3** | Who reads `ql_deep_crew`? A `carries` flag needs a later mission that requires I and places the tag (`carryReaderOf`) | **Khan Rafid IV** (`khan_rafid_4_clearance`, the next new mission in campaign order, which requires R I in the outline): its block guards carry the tag. It is a requirement on KR IV's MDD. Until then V's `locate` is a plain secondary, and V caps at two stars |
| **O-QL4** | G-QL1 (a per-placement `roe_penalty`) before authoring, or `structure_penalty_mult` now | **Author with the multiplier now** and file G-QL1. Both ceilings are true in numbers today |
| **O-QL5** | C6: re-brief the two "no build-up" lines, or keep them and have QL III's `aftermath` say the pause was not quiet | **Re-brief both**, in QL III's commit |
| **O-QL6** | The relief depot's optional mark (§6.4) | **No mark.** The flagged-zone overlay carries it, and nothing risks resembling a real agency |
| **O-QL7** | This file is `mdd.md` as the brief asked, while the README's pipeline and every other town folder use `design.md` | **Rename to `design.md`** when the lead signs it, so `narrative-designer` and `level-scripter` find it where the README says |

---

## Appendix: the census and the reads this was written from

```bash
# objective, trigger and ledger vocabulary
sed -n 726,729p packages/sim/src/mission.ts          # SUPPORTED: 12 types incl. escort, no_collateral_above, score
sed -n 4456,4593p packages/sim/src/mission.ts        # each type's complete/fail rule
sed -n 4277,4380p packages/sim/src/mission.ts        # 5 trigger conditions x 6 actions
sed -n 4258,4275p packages/sim/src/mission.ts        # first_contact fires on any identification
sed -n 3800,3860p packages/sim/src/mission.ts        # Conduct: structure, civilian, stray
jq -r '.ledger.produces[]' data/missions/*.json | sort | uniq -c   # 7 keys
# civilians
sed -n 1,290p packages/sim/src/civilians.ts          # one refuge, 4-tile shepherd, transport boarding
sed -n 2688,2710p packages/sim/src/mission.ts        # refuge must lie in every evacuate zone
# tunnels
sed -n 12150,12265p packages/sim/src/sim.ts          # charge: identified, 2 tiles, still; collapse splash damage 0
sed -n 540,570p tools/validate_data.mjs              # burial rules
# content
ls data/units/kdf data/units/enemy data/units/civilians.json
jq -r '.types|keys' data/structures.json             # + symbol, roe_penalty, low_profile, owner per type
ls art/meshes art/meshes/buildings art/meshes/vehicles art/meshes/decor art/meshes/civilians art/meshes/props
ls data/vfx assets/audio assets/ui/portraits assets/ui/plates
ls /Users/ilpinto/dev/roaring-lions/art/blend         # main checkout
for f in data/maps/*.json; do jq -r '[.id,.width,.terrain]|@tsv' $f; done
jq '.regions[0]' data/campaign/world.json; jq '.ranks, .villains.marj' data/campaign/commander.json
```

The grids were generated by a design-aid script that is not committed: one base, the
variants as row deltas. It checked:
- 48×48, with only symbols from `TERRAIN_LEGEND` and `data/structures.json`;
- every zone in bounds and every marker on a passable tile;
- every refuge marker inside its evacuation zone;
- every tunnel mouth and vent on a passable tile, and each mouth's collapse zone;
- foot and wheeled reachability from `player_start` (8-connected BFS, no corner-cutting);
- open tiles per zone, structures and Conduct sums per zone, and civilian walks.

The real-name check on this file was run as a scan for coined proper nouns. Every one
is canon or on the L-2 list. The dossier's deny-list grep belongs to its owner,
`campaign-historian`: this design did not read the dossier.
