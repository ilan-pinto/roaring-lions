# Mission Design Document: Act I · The Marj Strip · **Bir Tarsha**

**Date:** 2026-11-15 · **Author:** `campaign-designer` · **Status:** proposal, for the lead's
review before `narrative-designer` and any JSON. Nothing here is canon until the lead signs §8.
**Arc:** *The Long Ground*, town 2 of 4 new, the last town of Act I. The lead approved the arc on
15 Nov 2026 with L-1 to L-16 at their defaults (ruling on PR 1438), and Qasr Liwan, town 1, on the
same day (ruling on PR 1445). This document hardens the outline's five Bir Tarsha rows.
**Written against:** `main` at `e5be829ab`; the arc docs on branch `cl/campaign-historian`
(`docs/campaign/the_long_ground/`, PR 1438); the Qasr Liwan design on branch `cl/qasr-liwan-mdd`
(`docs/campaign/qasr_liwan/mdd.md`, PR 1445, which the lead's ruling renames to `design.md`),
used as the model for this document's layout and rigour. I ran the census and the code reads in
this session; the commands are in the appendix.
**Reads:** `docs/campaign/README.md` (the contract), `storyline.md` (§0.1, §2.4 as amended by the
GH-1440 ruling, PR 1447), `the_long_ground/arc-outline.md` and `transposition.md`, GDD §2, §4, §6,
`map_visibility.test.ts`'s header (the 84% gate), `packages/sim/src/mission.ts` and `sim.ts`
(escort, `stepDemolition`), `civilians.ts`, and the shipped `beit_sahwan_4_subterranean` and
`wadi_halam_5_depot` missions as the nearest patterns. `the_long_ground/dossier.md` was **not**
read and nothing here draws on it; beats are cited by the outline's ids only.
**Downstream:** `narrative-designer` (§2, the story hooks in §5), `level-scripter` (§3's
assertions, §5's enemy and twists, §7), `mission-author` (all of it; §3 is the map spec),
`playtest` (§5.7).

**Every distance, open-tile count and walk in §3 and §5 is a draft number.** A tile BFS
(8-connected, no corner-cutting) over the grids below produced them. `FlowField` prices ground
differently, so `level-scripter` re-measures and pins each one before any JSON is authored.
**Every claim about the runtime was read in `mission.ts`, `sim.ts`, `civilians.ts` or the schemas
this session** and is cited; anything I could not read is marked as unread.

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| L-1 | Plot A, *The Long Ground*: Act I extended | lead, 15 Nov 2026 | Bir Tarsha is the **fifth and last** Marj town in campaign order: Beit Sahwan, Qasr Liwan, Khan Rafid, Deir Amun, **Bir Tarsha** |
| L-2 | The names **Bir Tarsha**, the **Kharat Badlands**, *the Fence Road*, *the Gate* | lead | no other proper noun is coined here. Every other feature has a plain-English id (the safe quarter, the camp quarter, the works, the band, the barrier, the hamlet, the chamber) |
| L-3 | Promotions at act boundaries; Captain through the extended Act I | lead | Shai is a **Captain** in all five missions. `commander.json`'s Captain entry moves `until_mission` from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`; **that edit is this town's (§7.3)** |
| L-4 | PO-2 (a): Nadir Sahim stays taken at Beit Sahwan IV | lead | the front's commander in Bir Tarsha is a **job title** with a hinge and no name (§5.5) |
| L-5 | Adversaries are job titles only | lead | the gate chief is never a person; the block commander (V) is a secondary the briefing barely mentions |
| L-7 | The dozer mission is Bir Tarsha IV, four dozers all tagged | lead | §5.4. If `playtest` finds all-four brittle, tag two lead blades until G-1 lands |
| L-13 | Engine order: **G-2 first** | lead | the strong form of IV waits on GH-1439; §5.4 designs the shipped-today fallback and says exactly what it loses |
| L-15 | Authoring order: Qasr Liwan, **Bir Tarsha**, Khan Rafid IV, Jurf Nadi, Mina Sahil | lead | this town is second to be authored; the dozer mission lands with its town |
| L-16 | "One of the people taken at First Light", no role or rank | lead | the taken are never characterised here either |
| GH-1440 | Real equipment and real unit names are allowed; real places, people, operation names and faiths stay banned | lead, 15 Nov 2026 (PR 1447) | `dozer_d9`, `ifv_namer`, `mbt_lavi` and `yahalom_squad` are used by their shipped names |
| D4 | One villain per front, captured or killed at its end | `storyline.md` §0.1 | **Nadir Sahim is already taken** (Beit Sahwan IV), so D-BT1 below |
| D9 | Static continuity, authored text only | `storyline.md` §0.1 | no line branches on the ledger |
| D11 | Doctrine, never a people, a faith, a real place or a real insignia | GDD §2 | the town is defined by what the Ashwar Front does in it (a fence, works, tunnels, camps), never by who lives there |

### D-BT1: the front's villain has already been taken

`commander.json` gives `villains.marj` `ends_at: "beit_sahwan_4_subterranean"`. Qasr Liwan met the
same problem (D-QL1) and Khan Rafid before it (D-KR1); the answer is the same here, and it is the
GDD §11 rule: *the front's adversary is present only through what he leaves, and he does not
speak.*

> **The last stronghold is the ground the front kept in reserve.** Bir Tarsha is where the Marj's
> works end and the border begins: a fence, a gate that nobody has fired across, a camp quarter
> that holds some of the taken, a strip of fortifications and shafts built to be the way out.
> Nobody speaks for it. What speaks is a gate chief nobody names and, in the fifth mission, a
> **block commander** whose fall sends the remnant north (the hinge of P3-e, and nothing of the
> manner of its record).

The cost, said plainly: like Qasr Liwan, this town has no named man to kill. Its fifth mission ends
on a sequence of charges and a person walked out of a chamber, not on a face.

### Deviations from the arc outline's five rows

The outline is approved; these changes stay inside its frame, and each is listed for the lead to
strike.

| row | outline | here | why |
|---|---|---|---|
| geography | one base map (the outline's §4.3 default: the band "taking most of the southern third") | **two base maps**: the gate town for I to III, the Fence Road strip for IV and V (Option B, §1) | the band is 30 × 6 on a shared map; on its own map it is 27 × 10 with 31 razeable structures, and IV's razed ground becomes V's ground |
| BT III | `evacuate_before` count 5, "two of the taken in each" house | **four taken, count 3** | four taken cannot satisfy a count of 5 when no resident is placed (G-8, below), so the outline's own number is an unwinnable mission. Count 3 means the player may leave one behind and no more, which is the outline's sentence "at least one … must come out" made true. Count 4 (all of them) is the strict alternative (O-BT2) |
| BT IV | "the shortest road east runs past the hamlet" as the Conduct bait | the bait is **dead ground** | the barrier closes every wheeled route east, so no road is "shortest" past the hamlet. What is true is that the lee of the hamlet is the safest place to park four hulls, and a halted dozer within 2 tiles of a house levels it unordered (§5.4) |
| BT IV | 1 `yahalom_squad` | **2** | a primary `collapse` must be survivable-but-lossable (the schema's own reason for `seconds`); one squad lost leaves three mouths impossible |
| BT IV | berms are "2 or 3 sections" | 13 low-profile tiles (8 `hesco`, 5 `sandbag_wall`) | `hesco` and `sandbag_wall` are `per_tile` (one structure per tile, one `demolish` order each), so a "section" is several orders. I kept it to 13 so the micro-management is real and finite (G-BT1) |
| BT V | secondary `eliminate_hvt` only | the block commander also **withdraws** north on `casualties_pct`, so killing him is a race | the hinge: if he walks, the remnant goes north anyway (§5.5) |
| BT I | residents "walked out ahead of the fighting" | count 6 of 8 | at least two may be left; no win needs everyone, and none needs harm |

---

## 1. Premise and plot options

### The premise

The Marj ends at a fence. **Bir Tarsha** is the town on its inside: a gate where the main road meets
the border, a safe quarter where people displaced by the fighting have gathered, a camp quarter of
low blocks and sheds, and, running east along the fence from the gate, **the Fence Road**: a band of
firing positions, observation posts, a weapons workshop, sandbag and hesco berms and shafts. South
of the fence is the **Kharat Badlands**: neutral ground that nobody fires across, and where a round
that lands is the costliest mistake in the arc.

Five missions take it in ascending phase order, **recon → foothold → clearance → clearance →
subterranean** (phases 2, 3, 5, 5, 6): read the gate and walk the residents out; take the crossing
and hold it with the safe quarter open; enter two blocks at once for four of the taken; clear the
works with four dozers and a battalion; and bring the routes down while finding a person left alone
in a chamber.

The three plots below differ in **where the fence strip lives**, **which mission the player enters
tired**, and **what carries into the last one**. Their names differ least.

### Option A: *"One Geography"* · the outline's shape · recon → foothold → clearance → clearance → subterranean

- **One base map, five variants.** The gate town fills the north two thirds of a 48 × 48 map; the
  Fence Road is its southern third, as the outline's §4.3 default says. IV's band is about 30 × 6.
- **Carries:** `bt_works_crew` from I to IV; the chamber rescue's `hostages` count from V.
- **The player learns one place five times.** That is the house pattern (`beit_sahwan_2/3/4`).
- **The cost:** the band is **180 tiles at most**, and the dozers' lane, the hamlet's 3-tile gap, the
  barrier and `far_gate` all squeeze into one third of one map with the town above it. The lead asked
  for *a large area*.

### Option B: *"Gate and Strip"* · the same ladder, two geographies · **RECOMMENDED**

- **Two base maps.** `bir_tarsha` (the gate town) carries I, II and III. `bir_tarsha_4` (the Fence Road
  strip, a full 48 × 48 of fence, band, barrier and hamlet) carries IV, and V is **the same strip after
  IV**: every enemy work razed, the hamlet unchanged, and new ground on top (a chamber, a command post,
  five deep mouths). The player sees the ground they cleared.
- **The strip begins on the gate map.** I and II both show its first stretch (the works at the east end
  of the fence road, rows 31 to 34 of the gate map), so the Fence Road is read before it is cleared.
- **IV's band is 27 × 10 with 31 structures and 213 open tiles**, 2.6 times the area of Option A's, with
  its own hamlet, barrier line and `far_gate` (§3).
- **The cost:** one more base map (the number of map *files* is the same, five, because every mission
  already has its own); one more layout for `map_visibility` to measure; and a seam the story must
  cross in a line ("east along the fence").

### Option C: *"Blades before Houses"* · swap III and IV

- **Order:** I recon → II foothold → **IV, The Blade Line** → **III, Two Houses** → V. Both are
  clearance (phase 5), so the ladder still ascends.
- **What changes mechanically:** the dozer mission is fought with the **full** roster (nothing has been
  spent on the two blocks), and the rescue is fought by a force that has just cleared a mile of works.
  It also puts `bt_works_crew`'s carry one mission nearer its reader.
- **The cost:** the rescue (the arc's R3 beat, "a heavy gunfight on the way out") loses the
  freshness that makes its two-sites decision tense, and V's strip no longer follows IV directly, which
  breaks Option B's best idea.

### Recommendation

**Option B.** It is the only plot that gives the lead's *"many dozers raze a large area"* an
area large enough to need four dozers, and it makes IV and V one story (what the blades clear is what
the engineers then go under). Option A is the fallback if the lead would rather not add a base map; the
mission designs below work on either, and §5.4 says what shrinks.

### Killing my own favourite

My favourite is the strip map. Without it (Option A) the town survives: the band shrinks to 30 × 6,
the dozers' lane and the hamlet gap tighten, the barrier shares rows with the gate town's south, and
`playtest` has less room to find a clock. The arc is intact and the dozer mission is still the first
shipped use of `escort`. What it loses is *room*, which is what the lead asked for. So the favourite
stays, with Option A as the stated fallback.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | I, The Marj Strip · Ashwar Front · *proximity*. The **fifth** town of five (L-1), and the last before Act II's Sur |
| **Where it sits in the fiction** | after Deir Amun III. The main effort moved to the second stronghold and the brigades went home, and came back (outline P2-d, told in I's `dispatch`). The arc's real phase 3 (`arc-outline.md` §3, Bir Tarsha) |
| **Shai's rank on entry** | **Captain**, 2 stars |
| **Shai's rank on exit** | **Captain.** No promotion in a town (L-3). The Major promotion begins when Sur opens (Act II) |
| **Idit's intel thread** | **I:** she can read the gate and not the works crew, so the crew is the thing to find. **II:** the Badlands edge is the line she keeps repeating, and the safe quarter is the only reason to hold the gate. **III:** one source, two blocks, no time. **IV:** the crew found in I is the crew manning the works, and she can say which firing positions are theirs. **V:** the routes are the crew's road north, and one of them is wide enough for a truck (told, G-13) |
| **The villain's atrocity** | already played at First Light (D12). This town depicts none |
| **The adversary's presence** | **I** a gate garrison and a crew. **II** a counterattack that comes from the fence road. **III** guards in two blocks that warn each other. **IV** the works themselves, shafts that vent into the band, a barrier line and ATGM teams on both sides of it. **V** the routes under the road, a chamber, and a block commander who walks north when the first charge goes in |
| **His end** | no named man. V's `collapse` is the network's end; `eliminate_hvt · bt5_block_commander` is a secondary, and his withdrawal is the hinge |
| **Ledger in** | `roster.surviving_units` (Deir Amun III's survivors) and `intel.marked_positions` (a union across the campaign) |
| **Ledger out** | R M C X from all five. **I** from I and V. **E** (`civ.settlements_evacuated`) from I and II. **H** from III and V. All seven keys are produced by shipped missions today (`jq -r '.ledger.produces[]' data/missions/*.json`); this town declares none new |
| **What Act II inherits** | a roster that has fought a long fence; `civ.hostages_recovered` raised by 3 and 1; one story fact for Sur's first re-brief: **the remnant went north**. `world.json`: `sur`'s `unlock.after_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean` (§7.3) |

---

## 3. Map overview

**Two base maps and three variants, all MISSING** (§6.3). Each is 48 × 48, `terrain: "arid"`,
with **no `elevation` key** (flat). The gate is `pnpm validate:data` plus
`tools/src/map_visibility.test.ts` (the 84% floor: every campaign map must show 84% of its fight tiles
to the default camera, with no building's mesh over more than half of a rifleman standing there).
`mission-author` hand-authors the JSON from these grids; `level-scripter` re-measures.

| map id | mission | base | differs from its base by |
|---|---|---|---|
| `bir_tarsha` | BT I | is gate-town base | includes the two firing positions and the post at the fence road's east end (rows 31, 32), where the works crew sits |
| `bir_tarsha_2` | BT II | gate town | sandbag lines north of the terminal (row 30), two observation posts (row 33), the mortar position becomes a firing position (rows 31, 32) |
| `bir_tarsha_3` | BT III | gate town | yard sandbags at both blocks (rows 17, 21), two firing positions (rows 19, 20, 25, 26), one observation post (row 11) |
| `bir_tarsha_4` | BT IV | is strip base | the whole band, the hamlet, the barrier, the ridge |
| `bir_tarsha_5` | BT V | strip | IV's band razed (rows 16, 17, 20 to 29), plus the chamber and the command post |

### Why flat, and why `b` appears

`map-variants-design.md` §2.2 measured elevation's two jobs (shape and dead ground). This town's
constraints are Conduct, a barrier and a fence, not ground, and the hamlet's houses and the apartment
blocks supply the dead ground (sight is dominated by buildings, as in `khan_rafid/design.md` §3). **`b`
appears exactly once on the gameplay ground**: the foot gap in the barrier (row 25 of the strip). It is
open to infantry and a wall to anything wheeled or tracked (CLAUDE.md, boulders), which is how the barrier
stops the dozers and not the escort. `b` also fills the Badlands (south of the fence), which no player
unit can reach: the fence is complete except the gate, and every fence tile is `low_profile` and
therefore cut only by an explicit `demolish` order.

### 3.1 The gate town, `bir_tarsha` (draft)

North is up; x runs east and y runs south. `r` road, `h` house, `s` shed, `a` apartment block, `#`
concrete (the gate terminal), `f` fence, `F` firing position, `P` observation post, `2` and `1` cover,
`o` grove, `n` knoll, `b` boulder field.

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
00  ................................................
01  ................................................
02  ................................................
03  ....................................ooo.........
04  ........ooo............rr...........ooo.........
05  ........ooo............rr.......................
06  .......................rr.......................
07  .......................rr.................nn....
08  .......................rr.......................
09  .......................rr....ss.....ss..........
10  .......................rr.......................
11  .......................rr.......................
12  ......n................rr.......................
13  .......................rr......aaaa...ss........
14  .......................rr......aaaa.............
15  ...............1.......rr......aaaa.............
16  .......................rr.......................
17  .......................rr...........ss..........
18  .....................2.rr.2.....................
19  ...rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr...
20  ...rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr...
21  .....................2.rr.2.....................
22  .......................rr................aaaa...
23  ....hh..hh..hh..ss.....rr................aaaa...
24  ....hh..hh..hh.........rr.....ss.........aaaa...
25  .......................rr.......................
26  .......................rr..........ss...........
27  ..................1....rr.......................
28  ....hh..hh..sshh.......rr...ss..........ss......
29  ....hh..hh....hh.......rr.......................
30  .......................rr.......................
31  .................ss....rr.....1.......FF...FF...
32  ....ss....ss...........rr.............FF...FF.P.
33  .......................rr.......................
34  ...rrrrrrrrrrrrrrrrrr..rr.rrrrrrrrrrrrrrrrrrrrrr
35  ...rrrrrrrrrrrrrrrr####rr####rrrrrrrrrrrrrrrrrrr
36  ...................####rr####...................
37  ...................####rr####...................
38  fffffffffffffffffffffffrrfffffffffffffffffffffff
39  ................................................
40  ..bbbbb.......................bbbbbb........2...
41  ..bbbbb.....bbbb..............bbbbbb............
42  ............bbbb....2...................bbbbb...
43  ........................................bbbbb...
44  .........2.................2....................
45  .....2.............................2............
46  ................................................
47  ................................................
```

**The shape, north to south.**
- **Rows 0 to 18, the entry.** The brigade arrives down the gate road (x 23 to 24). The camp quarter
  (rows 8 to 28, x 27 to 45) is on the east; groves and a knoll on the north-east; open ground.
- **Rows 19 and 20, the cross road.** The town's one lateral. Cover tiles (`2`) at (21,18), (26,18),
  (21,21) and (26,21) make it a square.
- **Rows 22 to 33, the quarters.** West: the **safe quarter**, six houses and five sheds on 2-wide
  lanes. East: two apartment blocks, ten tiles apart door to door (**BFS 10 on `bir_tarsha`**, 11 on
  `bir_tarsha_3` once the yard sandbags stand).
- **Rows 34 to 37, the gate.** Two concrete blocks flanking the gate road, the road itself running
  through them and out through the fence at x 23 to 24, row 38. The Fence Road runs east and west
  along rows 34 and 35.
- **Rows 39 to 47, the Badlands.** Boulders and rock cover. Nothing player-side can enter it. It is a
  flagged zone, and the whole point of the ceiling and the flag on this map.
- **Rows 31 to 33, east end.** The works begin: two firing positions and a post. The crew that mans
  them is `bt_works_crew`.

### 3.2 The variants, as the rows that change

**`bir_tarsha_2` (BT II): rows 30 to 33.**
```
30  x19-21 and x26-28 become `g` (enemy sandbag lines north of the terminal; the gate road stays open)
31-32  (29,31) becomes a 2x2 `F` (the mortar position, now a firing position)
33  (18,33) and (29,33) become `P` (two observation posts on the fence road)
```
The mission adds its field camp through `structures[]` (a `camp` for side 0), not the grid, per the
schema ("a structure only one mission should own belongs there").

**`bir_tarsha_3` (BT III): rows 11, 17, 19, 20, 21, 25, 26.**
```
11  (38,11) becomes `P`
17  x30, x31, x34, x35 become `g` (the west block's yard wall, the door gap x32-33 stays open)
19-20  (36,19) becomes a 2x2 `F` (covers the west block's east side and the lane between the blocks)
21  x40, x41, x44, x45 become `g` (the east block's yard wall, the door gap x42-43 stays open)
25-26  (46,25) becomes a 2x2 `F` (the east block's rear)
```

### 3.3 The strip, `bir_tarsha_4` (draft)

North is up. The fence is row 30; the Fence Road is rows 26 and 27; the **band** is rows 20 to 29, x 10
to 36; the **hamlet** is rows 5 to 11, x 11 to 30, flagged; the **ridge** (`^`) closes the strip's north
at x 36, rows 0 to 21; the **barrier** (`T`) continues it at x 36, rows 22 to 29, with one `b` foot gap
at (36,25). `far_gate` is east of the barrier.

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
00  ....................................^...........
01  ....................................^...........
02  ..............................ooo...^...........
03  ......ooo.....................ooo...^...........
04  ......ooo...........................^...........
05  ....................................^...........
06  .............hh..hh..hh..hh..ss.....^...........
07  .............hh..hh..hh..hh.........^...........
08  ....................................^...nn......
09  ...........ss......ss......ss.......^...........
10  ...............hh......hh...........^...........
11  ...............hh......hh...........^...........
12  ....................................^...........
13  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr..^...........
14  ..r.................................^...........
15  ..r.................................^...........
16  ..r.....1.............1.............^...........
17  ..r.........................1.......^...........
18  ..r.................................^...........
19  ..r.................................^...........
20  ..r..1...........HHHH...............^...........
21  ..r........FF................FF.....^...........
22  ..r........FF.......FF.......FF..P..T...........
23  ..r..........ggg....FF....P.........T...........
24  ..r..................XX.......XX....T...........
25  ..r..........P.......XX.......XX....b...........
26  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrTrrrrrrrrrrr
27  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrTrrrrrrrrrrr
28  ...............FF.......FF......FFggT...........
29  ...............FF.......FFHHHH..FF..T...........
30  ffffffffffffffffffffffffffffffffffffffffffffffff
31  ................................................
32  ................................................
33  ...bbbbbb.............................2.........
34  ...bbbbbb.....................bbbbbb............
35  ..............................bbbbbb............
36  ................bbbbb...........................
37  ................bbbbb...........................
38  ........................................bbbbb...
39  ........................................bbbbb...
40  ..........2.....................................
41  ................................................
42  ........................2.......................
43  ................................................
44  ............................................2...
45  ......2.........................................
46  ................................................
47  ................................................
```

**What is in the band** (the `fence_works` zone, [10,20,27,10], **213 open tiles, 31 structures**):

| symbol | what | count | at | note |
|---|---|---|---|---|
| `F` | `militia_firing_position` | 6 | (11,21) (20,22) (29,21) (15,28) (24,28) (32,28) | owner 1 by type; 3 garrison slots, cover 3 |
| `P` | `militia_observation_post` | 3 | (13,25) (26,23) (33,22) | owner 1 by type |
| `X` | `militia_weapons_workshop` | 2 | (21,24) (30,24) | owner 1 by type |
| `H` | `hesco` | 8 tiles | row 20 x17-20; row 29 x26-29 | **neutral by type: placed `owner: 1`**; `low_profile`, `per_tile` |
| `g` | `sandbag_wall` | 5 tiles | row 23 x13-15; row 28 x34-35 | neutral by type: placed `owner: 1`; `low_profile`, `per_tile` |
| `T` | `t_wall` | 7 tiles | x36, rows 22-24 and 26-29 | neutral by type: placed `owner: 1`; **not** low-profile; 900 hp a tile |

**Why those counts.** The automatic branch of `stepDemolition` (`sim.ts`, read this session) levels any
structure a **halted** dozer stands within 2 tiles of (`DEMO_RANGE_SQ` is 2 tiles) unless it is
`roe_penalty` 20 or more, `low_profile`, the side's own camp or an `owner` equal to the demolisher's side. So
the 18 non-low-profile structures (6 F + 3 P + 2 X + 7 T) fall to a dozer that merely stops beside them;
the **13 low-profile tiles fall only to an explicit `demolish` order each**. A blade structure falls in
`demolition_time_s` (2.0 s for the D9) whatever its hp (`bladeDemolition`). That split is the
mission's micro-management, and it is honest: cutting a berm is an order (G-BT1).

**What is not in the band.** No `h`, `s`, `a`, `k`, `p` or `w`. The nearest hamlet structure to the band's
edge is the south pair of houses at rows 10 to 11; the band starts at row 20, so **8 tiles of open ground**
separate them (the outline's minimum is 3). The `fence` tiles at row 30 are in the zone's reach only at
its south edge row 29 (the zone ends before row 30), so razing is never asked to touch them.

### 3.3b `bir_tarsha_5` (BT V): the strip after IV

Rows 16, 17 and 20 to 29 differ from `bir_tarsha_4`. Every `F`, `P`, `X`, `H`, `g` and `T` in the band is
`.` (road tiles on rows 26 and 27 are `r`); the ridge, the hamlet, the fence and the Badlands are
unchanged. New: a `concrete` **chamber** (3 × 2) at (42,21), and a `concrete` **command post** (2 × 2) at
(38,16) east of the ridge's end.

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
00  ....................................^...........
01  ....................................^...........
02  ..............................ooo...^...........
03  ......ooo.....................ooo...^...........
04  ......ooo...........................^...........
05  ....................................^...........
06  .............hh..hh..hh..hh..ss.....^...........
07  .............hh..hh..hh..hh.........^...........
08  ....................................^...nn......
09  ...........ss......ss......ss.......^...........
10  ...............hh......hh...........^...........
11  ...............hh......hh...........^...........
12  ....................................^...........
13  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr..^...........
14  ..r.................................^...........
15  ..r.................................^...........
16  ..r.....1.............1.............^.##........
17  ..r.........................1.......^.##........
18  ..r.................................^...........
19  ..r.................................^...........
20  ..r..1..............................^...........
21  ..r.................................^.....###...
22  ..r.......................................###...
23  ..r.............................................
24  ..r.............................................
25  ..r.................................b...........
26  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr
27  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr
28  ................................................
29  ................................................
30  ffffffffffffffffffffffffffffffffffffffffffffffff
31  ................................................
32  ................................................
33  ...bbbbbb.............................2.........
34  ...bbbbbb.....................bbbbbb............
35  ..............................bbbbbb............
36  ................bbbbb...........................
37  ................bbbbb...........................
38  ........................................bbbbb...
39  ........................................bbbbb...
40  ..........2.....................................
41  ................................................
42  ........................2.......................
43  ................................................
44  ............................................2...
45  ......2.........................................
46  ................................................
47  ................................................
```

### 3.4 Markers, zones and the routes that matter

All coordinates are tile (x, y) on the grids above. Every zone below was counted against the draft grids
with a script (`/tmp/bt/grids.py` in the authoring session, reproduced as the census in the appendix):
the **open** counts are tiles that are neither blocked nor a structure footprint, which is what a
`locate`, `capture` or flag zone actually tests. A zone whose draft rectangle held no open tile was
enlarged (that is how `terminal_roof` came to be [24,33,6,6] and not the footprint [25,35,4,3]).

**Passability, draft.** Start to each objective on every gate-town map, foot, 8-connected: *gate_road_south*
34 tiles, *E1 door* 16, *E2 door* 20, E1 door to E2 door 10 (11 on III), start to the works mark 30. On the
strip, foot-reachable 1329 tiles and wheeled-reachable 998: `far_gate` is **unreachable** for a wheeled
unit while the `T` barrier stands and **reachable (39 tiles from the corral) once it falls**; a foot unit
reaches it through the `b` gap in 39. That asymmetry is the whole of IV's decision.

| map | zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|---|
| `bir_tarsha` | `gate_approach` | [19,28,12,6] | 70 | I `locate` the gate garrison |
| | `gate_refuge` | [3,3,9,5] | 45 | I residents' refuge |
| | `west_quarter` | [3,22,17,12] | 170 | I flagged (the safe quarter) |
| | `works_east` | [36,29,12,6] | 63 | I `locate bt_works_crew` |
| | `badlands_edge` | [0,39,48,6] | 288 | I flagged |
| `bir_tarsha_2` | `the_gate` | [17,30,14,7] | 68 | II `hold_for` |
| | `safe_quarter` | [3,22,17,12] | 168 | II `evacuate_before` and flagged |
| | `terminal_roof` | [24,33,6,6] | 18 | II secondary `capture` |
| | `crossroads` | [19,17,11,6] | 66 | II the counterattack lands here |
| `bir_tarsha_3` | `bt3_block_w` | [29,12,8,7] | 39 | III evacuation, west |
| | `bt3_block_e` | [39,20,8,8] | 46 | III evacuation, east |
| | `bt3_extract` | [21,0,8,4] | 32 | III where the taken must arrive |
| | `camp_quarter` | [27,8,19,22] | 365 | III flagged |
| `bir_tarsha_4` | `fence_works` | [10,20,27,10] | 213 | IV `raze` and `collapse` |
| | `hamlet` | [11,5,19,8] | 121 | IV flagged (houses) |
| | `far_gate` | [38,22,9,8] | 72 | IV `escort` destination |
| `bir_tarsha_5` | `fence_road` | [0,24,48,6] | (band, razed) | V `collapse` |
| | `chamber_refuge` | [40,18,8,6] | (open) | V `evacuate_before` |

**Markers (new).** Gate town: `start` (24,3) · `gate_road_south` (24,34) · `gate_refuge_point` (7,5) ·
`works_mark` (41,33) · `extract` (24,2). Strip: `corral` (6,16) (start and dozer park) ·
`blade_lane_w` (11,24) · `blade_lane_e` (30,24) · `bait_lee` (20,12) · `far_gate_point` (42,26). V adds
the five route mouths below.

**V's routes (draft).** All five sit in `fence_road` or at its edge. Vents are the tile the shaft opens
at; a route is cut by a `yahalom_squad` standing at its mouth.

| route | mouth | waypoint | vent | note |
|---|---|---|---|---|
| `bt5_a` | (8,27) | | (8,14) | west, hamlet side |
| `bt5_b` | (19,25) | | (19,16) | reaches the hamlet's lee |
| `bt5_c` | (29,27) | | (30,18) | |
| `bt5_wide` | (40,26) | (40,20) | (45,12) | the truck route: told, never shown (G-13) |
| `bt5_chamber` | (42,21) | | n/a | the captive's chamber (surface stand-in, G-5) |

**IV's shafts (draft, `in_tunnel` militia only).** `bt4_w` mouth (14,24) vent (14,15); `bt4_c` (24,25)
vent (24,17); `bt4_e` (31,26) vent (33,16). Each vent opens in the hamlet's **dead ground**, three
tiles from a house, which is the pressure on the player (§5.4).

### 3.5 Chokepoints, dead ground, protected structures

- **The gate (rows 34 to 38, x 23 to 24).** A two-tile pass through the fence between two concrete
  blocks. Everything on `bir_tarsha` and `_2` is decided around it.
- **The cross road (rows 19, 20).** The camp quarter's only lateral to the safe quarter: ten tiles from
  door to door between the apartments on III.
- **The Fence Road (IV rows 26, 27).** The dozers' lane: **two tiles wide** between the band and the
  fence, with `H` and `g` berms across it at four points.
- **The foot gap (IV, (36,25)).** One `b` tile: infantry only.
- **Dead ground.** The hamlet's lee (the tiles south of its southern houses, between the houses and
  the band) is out of sight of the whole `fence_works` zone because the houses block it; this is
  deliberate, and it is where the bait goes (§5.4).
- **Protected.** No `m` or `k` is placed on any of the five maps. All homes are `h`/`s`/`a` with
  `roe_penalty` 6 / 2 / 14 (`data/structures.json`, read this session). The hamlet's houses are 6 each.
- **Assertions for the doctrine test** (`tools/src/bir_tarsha_doctrine.test.ts`, to be written by
  `mission-author`, in the style of `tel_marum_doctrine.test.ts`): (1) on `bir_tarsha_4`, no `h`, `s`,
  `a` or `k` is within 2 tiles of any tile of `fence_works`; (2) `far_gate` is unreachable wheeled with
  the `T` tiles in place and reachable without them; (3) the `b` gap is passable on foot; (4) every
  non-`H`/`g` structure in `fence_works` has `roe_penalty` < 20 and is not `low_profile`; (5) E1 door
  to E2 door ≤ 12 on `bir_tarsha_3`; (6) every zone above has ≥ the open count in the table.

---

## 4. Mission ladder

All five are `town: "bir_tarsha"` (a schema edit, G-10), `faction: ashwar`, ROE on. Phases ascend
2, 3, 5, 5, 6.

| # | id | name | phase | target_min | time_limit_s | primaries | secondaries | requires | produces | economy |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `bir_tarsha_1_recon` | The Gate Road | recon | 6 | 720 | `locate bt_gate_garrison` · `evacuate_before gate_refuge` (residents, count 6 of 8) | `locate bt_works_crew` (carries → IV) | R | R M C X I E | n |
| 2 | `bir_tarsha_2_foothold` | The Gate | foothold | 7 | 840 | `hold_for the_gate` 240 s · `evacuate_before safe_quarter` 300 s (count 7 of 10, fails) | `capture terminal_roof` | R I | R M C X E | **y** |
| 3 | `bir_tarsha_3_buildup` | Two Houses | clearance | 6 | 720 | `evacuate_before` ×2 (hostages, 2 per block = 4 taken, count 3) · `eliminate_hvt` ×2 (the guards) · `no_collateral_above` 15 | none | R I | R M C X H | n |
| 4 | `bir_tarsha_4_clearance` | The Blade Line | clearance | 7 | 840 | `escort blades → far_gate` · `raze fence_works` 390 s · `collapse fence_works` 390 s · `no_collateral_above` 12 | none | R I | R M C X | **y** |
| 5 | `bir_tarsha_5_subterranean` | Under the Fence | subterranean | 7 | 840 | `collapse fence_road` 390 s · `no_collateral_above` 10 | `evacuate_before chamber_refuge` (hostages, count 1, 330 s, carries) · `eliminate_hvt bt5_block_commander` | R I | R M C X I H | n |

Ids follow the shipped pattern (`deir_amun_3_subterranean`); the outline's own phase names for 2 and 3
differ (`bir_tarsha_3_buildup` is a clearance in the outline, so the id should read `_3_clearance`: **open
decision 6**). `time_limit_s` is exactly twice `target_minutes` (the floor). Keys: R `roster.surviving_units`,
M `roe.mission_ratings`, C `campaign.completed_missions`, X `campaign.mission_results`, I
`intel.marked_positions`, E `civ.settlements_evacuated` (12 shipped missions produce it), H
`civ.hostages_recovered` (1 does). The seven keys are the only ones any shipped mission produces
(`jq -r '.ledger.produces[]' data/missions/*.json | sort | uniq -c`, run this session); this town declares none new.

---

## 5. Per mission

Unit counts are draft; `playtest` sets them. Every unit named resolves to `data/units/kdf/` or
`data/units/enemy/` (census in the appendix). "Tag" is `starting_force[].tag`.

### 5.1 BT I, The Gate Road (recon, dawn, 6 min)

**Player.** `starting_force`: 2 `inf_squad`, 1 `recon_zikit`, 1 `sniper_team`, 1 `ugv_recon_dog`,
1 `inf_medic_squad`. Plus `from_ledger` survivors. No economy. All foot (no vehicle can use the gate
road without being seen).

**Enemy.** A gate garrison of 2 `militia_cell` in the terminal blocks (`garrison`), 1 `atgm_cell` and 1
`rpg_team` (`hold_position`) at the road, tagged `bt_gate_garrison`; a works crew (1 `digger_crew`,
2 `militia_cell`, tag `bt_works_crew`) on the east firing positions, `patrol` between the two `F`s.
A one-shot `first_contact` trigger commits the works crew **only if the gate garrison is engaged**: a rushed
recon pulls the crew, and the crew then does not carry as a located group. No waves.

**Residents.** 8 civilians in the safe quarter (count 6 to recover), who walk to `gate_refuge` when a
ground unit is within 4 tiles (shepherd) or under fire. `evacuate_before` here is a plain `evacuate`
(not hostages), 300 s.

**The decision.** Spend the six minutes on the gate (the primary) or on finding the crew (the carried
secondary). The residents are the clock: they leave only when shepherded, and the shepherd must stay
out of the works crew's reach. **ROE.** Flagged: `west_quarter`, `badlands_edge`.
`flagged_structure_penalty` ~12, `fail_below` ~55.

**Twist candidates (for `level-scripter`).** (T1) The works crew starts a fence-side drill at minute 3
(timer). (T2) One resident will not leave without the medic. (T3) The gate garrison changes watch at
minute 4: a 40 s window.

**Story hooks.** The arc's first look at the gate; Idit can read the gate and not the crew; the first
fence tile is a character in the briefing.

### 5.2 BT II, The Gate (foothold, day, 7 min, economy)

**Player.** `starting_force`: 2 `inf_squad`, 1 `mbt_lavi`, 1 `mortar_team`, 1 `inf_medic_squad`,
1 `sniper_team`. A `camp` for side 0 placed via `structures[]`. Income zone `the_gate`; Logistics buys
`inf_squad` and `mbt_lavi` reinforcements at the camp. **Intel** is off (no drone).

**Enemy.** The counterattack: two `commit` waves from the fence road's east end at minutes 2:30 and
4:30 (`timer_s`), 2 `militia_cell` + 1 `rpg_team` + 1 `charge_squad` each, and a `mortar_crew` on the
`F` that shells `crossroads`. `atgm_cell` on the observation posts. The wave's second push is gated
on the first `casualties_pct`.

**Civilians.** 10 in `safe_quarter`; the failable `evacuate_before safe_quarter` needs 7 out by 300 s
and does not fail the mission if the gate holds but fails it if they are shelled. The secondary
`capture terminal_roof` 15 s.

**The decision.** What to buy at the camp, and whether to push the second wave or let it break on
the sandbags. Restraint is superior: the mortar shells the safe quarter, and the flagged penalty
makes counter-battery fire into the quarter cost.

**Twists.** (T1) The mortar position is a decoy at minute 5. (T2) The second wave carries a `charge_squad`
aimed at the terminal. (T3) A truck of fighters arrives at the Badlands edge and cannot enter.

**Hooks.** The gate holds because of the camp; Idit's repeated line about the Badlands edge.

### 5.3 BT III, Two Houses (clearance, day, 6 min)

**Player.** `starting_force`: 3 `inf_squad`, 1 `breach_team`, 1 `yahalom_squad`, 1 `sniper_team`,
1 `inf_medic_squad`, 1 `ifv_namer`. Plus survivors. No economy.

**Enemy.** Two blocks, E1 and E2 (apartments, 14 each). Each holds 2 of the 4 taken and 2 guards
(`militia_cell` garrisoned, tagged `bt3_guard_west`, `bt3_guard_east`); the two blocks warn each other
(a `first_contact` in either commits a counter-reaction in the other, `commit` with a 20 s delay) and
the camp quarter's `F` positions cover the lane between them. `atgm_cell` on the roof tile of each.

**The decision.** The player cannot hold both doors with one force. Take the west block first
(cheap, small yard) and the east block gets a warning, or split and thin both. The ceiling is 15
(`apartment` roe 14: one apartment hit is under the ceiling and a second is over), so heavy fire into
either block ends the mission.

**Twists.** (T1) A guard walks a hostage to the window (the shot is yours to refuse). (T2) The east
block's guard runs north when the west block falls. (T3) The `ifv_namer` can ram the yard sandbags
at the cost of its crew's cover.

**Hooks.** The R3 beat: "a heavy gunfight on the way out". Hostages recovered 3 raises
`civ.hostages_recovered`.

### 5.4 BT IV, The Blade Line (clearance, day, 7 min, economy)

*The lead's mission.* Four tagged `dozer_d9` raze the enemy's works on ground that has been
emptied of homes, while the rest of the brigade escorts them.

**Player.** `starting_force` at `corral`: **4 `dozer_d9` (tag `blades`)**, 2 `ifv_namer`, 2 `mbt_lavi`,
4 `inf_squad`, 2 `yahalom_squad`, 1 `sniper_team`, 1 `mortar_team`, 1 `ugv_recon_dog`. Economy y: a
`camp` at the corral, Logistics for replacement infantry only.

**Enemy.** The works (31 structures, §3.3): 6 `F`, 3 `P`, 2 `X`, berms. Garrisons in the F's
(`militia_cell`), `atgm_cell` and `rpg_team` on both sides of the `T` barrier, a `mortar_crew` behind
the ridge; `in_tunnel` `militia_cell` in the three shafts. A `first_contact` trigger commits the
`atgm_cell`s onto the lane when the first dozer stops.

**The decision, four parts.** (a) *Order of the lane.* The dozers can be routed west to east or in two
pairs from the middle. (b) *What to do about the berms.* The 13 `low_profile` tiles need an explicit
`demolish` each (G-BT1); the 18 others fall to a dozer that merely halts within 2 tiles. (c) *The
barrier.* `far_gate` is unreachable wheeled until the `T` tiles fall; the foot gap is a distraction.
(d) *The bait.* A `mortar_crew` and `atgm_cell` in the lee of the hamlet fire at the lane; the shafts
vent in dead ground three tiles from the houses. Hitting back wrongly puts rounds into houses (6 each,
the ceiling is 12: **two houses exactly at the ceiling, the third fails**; alternative 11 so the second does).

**What the mission is not.** The dozers do not touch homes: no house, shanty or clinic is within 2 tiles of
a raze zone (assertion 1), and the dozers' auto-demolish skips anything with `roe_penalty` ≥ 20 only,
so the *distance* is the protection. The `escort` objective **latches on arrival** and **fails on any
tagged loss**, so a dozer that dies sinks the mission: the escort must hold (G-2, GH-1439).

**Twists.** (T1) The first dozer to halt draws the ATGM team out of the lee. (T2) A shaft vent opens
behind the escort at minute 4. (T3) The hamlet's residents shelter in the cellars; the player is told,
not shown.

**Hooks.** *The blades.* The story of the arc's heaviest machine at last doing the job it was built for.
The crew from I is the crew manning these works.

### 5.5 BT V, Under the Fence (subterranean, dusk, 7 min)

**Player.** `starting_force` (surface): 2 `yahalom_squad` (tunnel charge), 2 `inf_squad`,
1 `recon_zikit` (`mark_tunnel`), 1 `ugv_recon_dog`, 1 `sniper_team`, 1 `inf_medic_squad`, and a
`mbt_lavi` for cover. No economy. The strip is IV's, razed.

**Enemy.** The routes (§3.4). Five routes, one of them wide. The command post (`#` 2 × 2 at (38,16))
holds `bt5_block_commander` (a `militia_cell` with an `officer` role) and 2 `militia_cell`; **he
withdraws north** on `casualties_pct` and a timer. Charge squads and `digger_crew` in the shallow mouths.
`in_tunnel` militia defend the three vents.

**The captive.** One person in the chamber at (44,24), a `concrete` 3 × 2 (surface stand-in: player
units cannot be `in_tunnel`, G-5). The secondary `evacuate_before chamber_refuge` (hostages, count 1,
330 s) must be completed **before** the last charge falls, because the mission ends when the primaries
do. That is the decision: go for the chamber and the commander first, or cut the routes first.

**The primary.** `collapse fence_road` 390 s. `no_collateral_above` 10: the dusk and the surface
houses are protected.

**Twists.** (T1) The wide route is told, never shown (G-13). (T2) The commander's withdrawal reveals a
sixth route. (T3) The captive is asked a question that changes the Sur re-brief.

**Hooks.** *The remnant went north.*

### 5.6 Adversary table

| mission | who | stance | why they are there |
|---|---|---|---|
| I | 2 `militia_cell` + `atgm_cell` + `rpg_team` | garrison / hold | the gate |
| I | `digger_crew` + 2 `militia_cell` (tag `bt_works_crew`) | patrol | the works crew |
| II | 2 waves of `militia_cell`, `rpg_team`, `charge_squad`; `mortar_crew` | commit / hold | the counterattack |
| III | 4 `militia_cell` garrison, 2 `atgm_cell` | garrison | the two blocks |
| IV | 6 F garrisons, `atgm_cell` ×2, `rpg_team`, `mortar_crew`, 3 `in_tunnel` `militia_cell` | hold / garrison | the works and the bait |
| V | `militia_cell` ×3, `digger_crew`, `charge_squad`, commander | ambush / hold / withdraw | the routes and the chamber |

### 5.7 Playtest measures

The `pnpm playtest` harness proves winnable, not how long (CLAUDE.md, known debts). The measures this
arc needs, in order: (1) **a passive plan loses every mission** (a passive IV is the dozers never moving:
it must lose to the clock, not stall; a passive V must lose to the clock); (2) a naive attack-move on
IV loses a dozer; (3) the sensible plan wins IV with the ceiling intact; (4) 30-seed slowest win
leaves a 120 s and 20% margin to `time_limit_s`; (5) V's rescue before the last charge. The playtest
harness has **no `escort` support** that I could find (grep this session, §7 G-16): the first shipped use
of `escort` needs a plan primitive that moves the tagged group.

---

## 6. Asset manifest

### 6.1 Units: all PRESENT

`data/units/kdf/`: `inf_squad`, `inf_medic_squad`, `recon_zikit`, `sniper_team`, `mortar_team`,
`ugv_recon_dog`, `yahalom_squad`, `ifv_namer`, `mbt_lavi`, `dozer_d9`, `breach_team`.
`data/units/enemy/`: `militia_cell`, `atgm_cell`, `rpg_team`, `mortar_crew`, `charge_squad`,
`digger_crew`. Their GLBs sit in `art/meshes/` and `assets/meshes/` (census in the appendix). **Unlock
note:** `dozer_d9` unlocks at Conduct 87, and `starting_force` ignores unlocks (CLAUDE.md, known
debts), so IV fields four on loan; whether a campaign at this point should hold four is **open
decision 4**.

### 6.2 Structures: all PRESENT

`data/structures.json` carries `apartment`, `house`, `shanty`, `concrete`, `hesco`, `t_wall`,
`sandbag_wall`, `fence`, `militia_firing_position`, `militia_observation_post`,
`militia_weapons_workshop`, `camp`, `clinic`, `sandbag_post`. GLBs in `art/meshes/buildings/` for each,
with `_wreck` twins for the large ones.

### 6.3 Missing

| row | gate | pipeline |
|---|---|---|
| maps `bir_tarsha`, `bir_tarsha_2`, `bir_tarsha_3`, `bir_tarsha_4`, `bir_tarsha_5` | `validate:data`; `map_visibility.test.ts` ≥ 84%; the doctrine test above | `mission-author` from §3 grids |
| `bir_tarsha` in `mission.schema.json`'s `town` enum | schema edit | G-10, `mission-author` |
| `data/campaign/world.json` town entry in the `marj` region and the `sur` unlock edit | `validate:data` | G-10 |
| briefing images for five missions | `validate_narrative.mjs` | `narrative-designer` and the art pipeline |
| `bir_tarsha_*` locale overlay | `validate_narrative.mjs` | `narrative-designer` |
| `commander.json` `until_mission` move | `validate:data` | `mission-author` (§7.3) |

No new unit, no new structure, no new VFX and no new audio is required.

---

## 7. Engine and schema gaps

| id | gap | owner | status |
|---|---|---|---|
| G-1 | `escort` has no shipped mission; its first use must pass `validate:data` and the playtest | `mission-author` | open |
| G-2 | the escort must hold (a tagged loss fails the mission), GH-1439 | sim | known; lead decision |
| G-3 | `no_collateral_above` needs ROE on and another primary | `mission-author` | satisfied here |
| G-5 | player units cannot be `in_tunnel`; the captive is a surface stand-in | design | known |
| G-8 | `evacuate_before` with `hostages: true` counts every civilian, not only the tagged ones; so no residents are placed on III | `mission-author` | known |
| G-10 | `town` enum lists eight towns; Bir Tarsha is a schema edit, a `world.json` entry and a GDD §2 edit | `mission-author` | open |
| G-13 | the wide route is told, never shown | `narrative-designer` | design |
| G-16 | the playtest harness has no escort support | `playtest` | open |
| BT-G1 | per-tile berms: one `demolish` order per tile, 13 of them in IV | `level-scripter` | design cost, not a bug |
| BT-G2 | a `move` order to an unreachable goal (far_gate for a wheeled unit behind `T`) must not stall the group | `level-scripter` | check |

### 7.3 Content changes to shipped data

1. `data/campaign/world.json`: add the Bir Tarsha town in the `marj` region; `sur`'s
   `unlock.after_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`.
2. `data/campaign/commander.json`: Shai's rank `until_mission` is the last Bir Tarsha mission, not Deir Amun III.
3. `data/schemas/mission.schema.json`: `bir_tarsha` in the `town` enum.
4. GDD §2: the town list.

---

## 8. Open decisions for the lead

1. **Option B (two base maps) or Option A (one)?** Recommended B (§1).
2. **The escort's hard fail (G-2, GH-1439)?** If a tagged dozer's loss fails the mission, IV is
   punishing; the alternative is to build the fail into the mission as a floor (lose two and fail).
3. **The ceiling in IV: 12 or 11?** 12 lets the third house fail; 11 lets the second.
4. **Four D9s on loan in IV**, when `dozer_d9` unlocks at Conduct 87.
5. **The Major promotion line** stays in Sur's briefing (L-3).
6. **Mission ids** (`_3_buildup` against `_3_clearance`).
7. **The captive in V as a third-star secondary**, using the surface stand-in (G-5).

---

## Appendix: census commands

```bash
# units
ls data/units/kdf/{dozer_d9,yahalom_squad,ifv_namer,mbt_lavi,inf_squad,sniper_team,mortar_team,ugv_recon_dog,inf_medic_squad,recon_zikit,breach_team}.json
ls data/units/enemy/{atgm_cell,rpg_team,mortar_crew,charge_squad,militia_cell,digger_crew}.json
# structures: roe_penalty, low_profile, per_tile
python3 -c "import json;d=json.load(open('data/structures.json'))['types'];[print(k,d[k]) for k in ('apartment','house','shanty','hesco','t_wall','sandbag_wall','fence')]"
# ledger keys produced by shipped missions
jq -r '.ledger.produces[]' data/missions/*.json | sort | uniq -c
# the town enum
grep -n '"town"' data/schemas/mission.schema.json
# objective types the runtime runs
grep -n "case '" packages/sim/src/mission.ts | head -40
```
