# Mission Design Document — Act I · The Marj Strip · **Khan Rafid and Deir Amun**

**Date:** 2026-09-07 · **Status:** proposal. Nothing here is canon until the lead
signs §8.
**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`,
censused this session. Every content claim cites a path; every route, walk and
structure figure in §3 was produced by running the two draft grids below through
a tile-BFS this session, and **every one of them is labelled as a draft number
that `level-scripter` and `mission-author` must re-measure through the real
`FlowField`** — a BFS counts tiles, `FlowField` prices ground and slope, and the
two disagree wherever elevation does anything.
**Read first:** `docs/campaign/README.md` (the contract), `docs/campaign/storyline.md`
(§0 decisions, §3.1 Act I, §4.2 the sketch this expands, §4.4 why this is last),
`docs/campaign/beit_sahwan/design.md` (same act, same town arc, same villain),
`docs/campaign/qarn_hadid/design.md` (the conventions downstream now expects),
`docs/campaign/map-variants-design.md` §2 (the obstacle grammar and its five
rules), `docs/GDD.md` §2/§4/§6/§11.
**Downstream:** `narrative-designer` (§2, §5 story hooks), `level-scripter`
(§5 enemy, twists, §3 assertions, §7), `mission-author` (all of it, and §3 is the
map spec), `playtest` (§5.7).

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| D12 | The war opens at First Light, transposed entirely into the fiction | lead, `storyline.md` §0.2 | the eleven civilians of `beit_sahwan_breach`, two counted in, are the thing this arc is a second chance at. Nothing below depicts anything |
| D4 | One villain per front: atrocity at the opening, captured or killed at the end | lead | **Nadir Sahim, file SPADE.** And his end already shipped — see D-KR1 |
| D1 / D2 | Shai Hammai, Idit Zohar, the two voices | lead | Shai is a **Captain** across all six missions. That is a **required** `commander.json` change — §7 C4 |
| D8 / D10 | Fixed sequence; proximity → standoff → source | lead, GDD §2 | Khan Rafid then Deir Amun, both after Beit Sahwan, both before Sur. Whether Sur's *gate* moves with them is §8 O-KR1 |
| D9 | Static continuity, authored text only | 2026-08-21 spec | no line below branches on the ledger. `civ.settlements_evacuated` is produced by four of the six and read by nothing; that stays true |
| D11 | Doctrine, never a people, a faith, a real place or a real insignia | GDD §2 | **no new personal name is coined anywhere in this arc.** The two new adversaries are a block commander and a digging chief, named by their job in the shipped `wh_hvt_amir` register ("the local commander", never named to the player) |
| D17 | Qarn Hadid landed 2026-09-07 the same way this is being worked | lead | the conventions of `docs/campaign/qarn_hadid/design.md` are followed here: bolded failable primary on every ladder row, a passive-loss paragraph per mission, measured claims labelled as assertions, and an asset manifest with no row without a path or a gate |

### D-KR1 — the one decision that had to be taken before anything else

**Nadir Sahim is already captured, and it is already shipped and played.**
`data/missions/beit_sahwan_4_subterranean.json` carries
`take_the_shaft_head` — a `capture` primary whose objective text is *"Hold the
shaft head until Sahim is out of it"* — plus `find_spade`, a `locate` on
`bs4_hvt_spade`. He goes into a cell at the end of Act I's fifth mission, and
this arc's six missions come **after** it in `world.json`'s flattened campaign
order.

So D4's letter — *captured or killed in the last mission of his front* — cannot
be satisfied without either re-briefing a landed mission or reading D4
differently. Three answers exist and each is one of the plots in §1. The one this
document recommends is:

> **He was taken at the shaft head, and the Marj did not stop.** What the KDF
> got at the bottom of that shaft was not a surrender, it was a **map** —
> and the two towns are what the map was worth. His presence through the arc is
> his own hand: a district he prepared for years, a ward he chose because it is
> full of people, and six routes he dug before the war reached him. His end as a
> problem is the last of them coming down in `deir_amun_3_subterranean`.

That reading is *better* than D4's letter for this particular front, and the
reason is doctrinal rather than convenient. The Ashwar Front is defined by
tunnels, IEDs, ambush and **human terrain** (GDD §2). A front whose weapon is
ground does not end when its architect is arrested; it ends when the ground
does. Sur ends with an observer killed because Sur *is* an observer. The Marj
ends with a network collapsed because the Marj *is* a network.

**The cost, stated so the lead can overrule it:** the arc has no villain to kill,
and `eliminate_hvt` in the last mission is a digging chief rather than a name.
The alternative — Option C in §1 — re-briefs `beit_sahwan_4_subterranean` so the
shaft head holds his deputy and moves Sahim's own capture to Deir Amun III. That
is one shipped mission's objective text, one narrative sheet, one script sheet
and a `playtest` re-run of Beit Sahwan IV. It is not expensive. It is just a
landed, played mission, and re-opening one to satisfy the letter of a rule the
spirit already covers is the lead's call, not mine (§8 O-KR2).

**The register.** Beit Sahwan's ceiling is the ceiling here:
*"nobody is coming back for them afterwards."* Consequence, not sermon. Nothing
in this arc depicts an atrocity; what it does is put the player in the position
of being the one who came back, and then price it.

---

## 1. Premise and plot options

### The premise

Two towns finish the Marj.

**Khan Rafid** is the enclave's dense middle: a souk of narrow lanes north of a
main street, apartment blocks and warehouses south of it, and in the exact
centre a walled compound holding a clinic and a civic hall. It is **inhabited**,
and Sahim's people are still in it because that is what he built the place to
be. There is nothing to take here that is worth taking. What there is, is a town
you can win and still lose most of.

**Deir Amun** is barely a town: nine buildings and a pump house on the north lip
of a dry wadi, with six routes under it. The people are gone. What is left is
the junction — the place where the Marj's district network joins the road east —
and the ground itself is the last thing Sahim owns.

Three plots follow. They differ in **how many times the player is asked the
arc's question** and in **what closes the front**, not in names.

---

### Option A — *"What You Keep"* · Khan Rafid ×3, Deir Amun ×3 · **RECOMMENDED**

Six missions, two new maps, the §4.2 sketch hardened.

- **Phase ladder:** Khan Rafid **2 → 3 → 5**, Deir Amun **2 → 3 → 6**. Both
  ascend; both are inside GDD §6's three-to-five per town.
- **The distinguishing mechanic, town one: one refuge, three missions, an
  ascending count and an ascending price.** `evacuate_before` is a **primary in
  all three Khan Rafid missions**, on the **same zone** — the walled ward at the
  centre of the map — with counts **2 of 4 → 4 of 6 → 6 of 8** and an ROE floor
  that climbs **none → 45 → 50**. Only three shipped missions use
  `evacuate_before` as a primary anywhere in the game
  (`beit_sahwan_breach`, `wadi_halam_4_village`, `qarn_hadid_1_recon`/`_3`), and
  no town has ever used it twice. The ward is simultaneously the refuge, the
  `flagged_zones` entry, and — in mission 2 — the `hold_for` target. **The one
  piece of ground the player must hold, must walk civilians into, and may not
  fire into, is the same nine-by-seven rectangle.**
- **The distinguishing mechanic, town two: knowledge decays, and you cannot hold
  all of it.** A route can be charged only while it is **identified**
  (`sim.ts:4423`, *"A route nobody has found cannot be charged"*), a route is
  identified only while a living `mark_tunnel` carrier holds a **clear
  `losRay`** to a tile it runs under or somebody is watching its spoil
  (`markerSeesRoute`, `trailStrengthFor`), and unwatched contact **decays back
  to unknown** (`sim.ts:2728`, *"Unwatched contact decays — IDENTIFIED
  included… tunnel visibility is live, detector-shaped"*). Deir Amun puts six
  routes on one map and gives the player two `yahalom_squad` and one
  `recon_drone`. He physically cannot know them all at once. **The mission is a
  sequencing problem, and it is the only mission in the game where the enemy is
  the map.**
- **How the front closes:** the network, not a man. `collapse(hamlet, 300)` in
  the last mission, with `eliminate_hvt` on the digging chief beside it.
- **Cost:** two new 48×48 maps, six mission JSONs, six `playtest` plans and six
  passive controls, two doctrine tests, `world.json` mission arrays, one
  `commander.json` line, eight lines in `packages/data/src/index.ts`. **No new
  art of any kind** (§6). No schema edit — `khan_rafid` and `deir_amun` are
  already in `mission.schema.json`'s `town` enum and already have pins on the
  campaign board (§7).
- **Buys:** the Marj completes; Act I's shape (phases 1,2,3,5,6 — *no build-up*)
  survives intact; GH-19 gets both towns and the subterranean showcase it asked
  for; and the campaign gains the beat `storyline.md` §4.2 calls the strongest
  available anywhere in the tree.

### Option B — *"The Enclave"* · Khan Rafid ×4, Deir Amun deferred

Four missions on one new map, with **per-mission map variants**. Deir Amun keeps
`"missions": []`.

- **Phase ladder:** **2 → 3 → 4 → 5**. It uses the one phase Act I does not
  have.
- **Why it is mechanically different from A:** the same streets, four times, and
  **the ground records what the player did to them.** `khan_rafid_2/3/4` are
  variant map files in the shipped pattern (`beit_sahwan_2/3/4`,
  `tel_marum_1/2/3`, `umm_zeitoun_3/4` — twelve of the 23 files in `data/maps/`
  are already variants): mission 3's grid carries the barricades the enemy put
  up after mission 2, mission 4's carries rubble where mission 3 was fought and
  one lane closed. Nothing in the game does this today across a whole town, and
  it is the most literal possible reading of *"how much of the town do you still
  have."* The build-up in slot 3 is where the player buys the force for the
  clearance, under a rate he has to earn by holding the ward.
- **Cost:** the Marj does **not** complete. GH-19's subterranean showcase does
  not happen. And it is the war's **third** build-up: `wadi_halam_3_counterraid`
  and `umm_zeitoun_2_buildup` already exist, and
  `wadi_halam_3_counterraid.json`'s `debrief.defeat` says *"We spent the only
  quiet week of the war on it"* — which a Marj build-up makes false, in Act I,
  before the player has ever read it.
- **Buys:** four missions for one map instead of six for two, the cleanest
  possible statement of the arc's thesis, and the phase Act I lacks.

### Option C — *"The Digger's Deputy"* · Khan Rafid ×3, Deir Amun ×3, and Sahim's end moves

Option A's ladder exactly, plus a re-brief of `beit_sahwan_4_subterranean`.

- **Why it is mechanically different from A:** it is not — the six missions are
  the same. What changes is **what the last one is for**. In A, Deir Amun III is
  `collapse(hamlet, 300)` + `eliminate_hvt(da_hvt_engineer)`. In C the shaft head
  at Beit Sahwan IV holds Sahim's **digging chief** (`bs4_hvt_spade` is renamed
  and its objective text changed from *"until Sahim is out of it"*), and Deir
  Amun III gains `capture(da_shaft_head, 10)` with Sahim tagged inside it —
  **the same shape as Beit Sahwan IV's own ending, moved two towns later.**
- **Cost:** one shipped, played, `playtest`-pinned mission is re-opened. Its
  objective text, its `say`/`debrief` lines, `docs/campaign/beit_sahwan/`'s
  narrative and script sheets, and its plan and passive control all move. **This
  design must not edit `docs/campaign/beit_sahwan/`**, so the change is a request
  with an owner, not a change made here.
- **Buys:** D4 satisfied to the letter, and a front that ends on a person.

### Recommendation

**Option A.** Three reasons, in order of weight:

1. **It is the only option that finishes the Marj**, which is the entire reason
   `storyline.md` §4.4 has this plot on the list. B leaves a region two-thirds
   built and a GitHub issue (GH-19) half-closed.
2. **The distinguishing mechanic needs three askings, and A is the only plot
   that gives it three.** "Keeping a town, not taking one" is not a scene. If
   `evacuate_before` is a primary once, it is a mission with civilians in it —
   the game already has four of those. Asked three times on one refuge with a
   rising count and a rising ROE floor, it becomes an arc, and the number the
   player reads at the end of mission three is a number he can compare to the
   two he read before it.
3. **Deir Amun is the only place the tunnel subsystem is the subject.** It
   shipped in Beit Sahwan IV as one mission's mechanic inside a town about
   something else. `feat/tunnel-subsystem` built digging, spoil, live
   identification, venting and collapse, and exactly one mission uses any of it.
   Six routes, decaying knowledge and two engineers is what that subsystem was
   for.

**Against A, honestly:** it is two maps and six missions, the largest of the
three plots in `storyline.md` §4, and §4.4 put it last for that reason. If the
lead wants the beat and not the bill, **take B** — it is the cheaper game and,
on the town-degradation mechanic alone, arguably the better one.

### Killing my own favourite

**My favourite is B.** A town that visibly degrades across four missions on four
grids is the most interesting thing in this document, it costs one map instead of
two, and it would be the first content in the tree to use the variant system for
something other than "the same ground on a different day."

**It does not survive the arc's own job.** This plot exists to complete a region
(`storyline.md` §4.4), and B completes nothing: Deir Amun stays empty, the Marj
stays two towns of three, and the campaign board keeps a dead pin. It also spends
the war's third build-up in the act whose *defining* fact is that it has none —
`storyline.md` §3.2, *"Beit Sahwan runs phases 1, 2, 3, 5, 6 — no build-up. True
rather than absent: the brigade got no breathing room in the Marj."* B would make
Act I the act with the breathing room. The degradation idea is not lost: it is
recoverable inside A as three Khan Rafid variants with no phase change and no
fourth mission (§8 O-KR6), which is the shipped variant pattern and costs three
map files.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | I of III. The Marj Strip · Ashwar Front · **towns two and three of three**, after Beit Sahwan. *Proximity* |
| **Where it sits in fiction** | Beit Sahwan was the perimeter and the town around it. Khan Rafid is the enclave's middle — the ground Sahim spent years preparing, seven kilometres up the coast road. Deir Amun is where the district's routes meet the road east, and it is where the Marj stops being the Marj's problem and starts being Naharin's |
| **Shai's rank on entry** | **Captain**, 2 stars |
| **Shai's rank on exit** | **Captain.** No promotion inside a town and none at the end of one: Major arrives at the **act boundary**, which is now the end of Deir Amun rather than the end of Beit Sahwan. That is a required `commander.json` edit — §7 C4 |
| **Idit's intel thread** | the arc is **her arc**, and for the first time the source is a person. What she has is what a prisoner told her, and it is a year old. Khan Rafid I's `locate` set is her checking it; Khan Rafid III cashes it as pre-identified ambushes; Deir Amun I asks the one question the ledger cannot answer for her — **`intel.marked_positions` reveals units by tag and cannot pre-reveal a tunnel route** (`mission.ts:942`, CLAUDE.md's own note that GDD §4's "thorough recon → tunnel mouths pre-marked" is not literal) — so at Deir Amun she has to send men to look, and what they find fades when they leave |
| **The villain's atrocity** | already played, at First Light. This arc adds no new one. What it adds is his **method**, seen from the inside: he did not hide behind the people of Khan Rafid, he **built for them to be there** |
| **The villain's presence, mission by mission** | **KR I** the fire plan around the ward — three posts, none of which can shoot the ward and all of which can shoot anyone crossing to it. **KR II** the push into the compound: a `commit` on `zone_entered(ward)`, because the one place the KDF will not shoot is the one place worth standing. **KR III** the block commander garrisoned in the **civic hall**, which `roe_penalty` 30 makes literally unshootable on a gunner's initiative (`PROTECTED_ROE = 20`, `structures.ts:135`) — the player must level it deliberately, or make him leave. **DA I** a crew still digging, a year after he was taken. **DA II** a route that opens inside the yard the player is told to hold. **DA III** four routes he finished before the war, none of which leave spoil |
| **The villain's end** | **the network.** `collapse(hamlet, 300)` in `deir_amun_3_subterranean`, with `eliminate_hvt(da_hvt_engineer)` beside it. See D-KR1 and §8 O-KR2 |
| **Ledger in** | `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions`, `intel.marked_positions` (produced by `beit_sahwan_1_recon` and `_4_subterranean`) |
| **Ledger out** | `R M C` from all six; `I` from KR I, KR III, DA I and DA III; `E` from KR I, KR II and KR III. All five keys exist and the runtime produces exactly these |
| **What Act II inherits** | a roster that has fought six missions in a town it was trying not to break, an ROE rating that has survived the highest floor in the game, and one story fact Tel Marum's briefings can lean on: **the Marj is finished, and the road east out of Deir Amun is where everything that came into it came from** — which is Naharin, and which is why Sur is second and not third |
| **`world.json`** | fill in two mission arrays that already exist and are empty. `at` pins already present and already inside the `marj` outline. **The one real decision is whether Sur's `unlock.after_mission` moves** — §7 C3, §8 O-KR1 |

---

## 3. Map overview

Two new 48×48 maps, both **`terrain: "arid"`**, both **MISSING** and specified
below in full. Khan Rafid has **no elevation grid**; Deir Amun has one, **0–5**.

**A note that is wrong in a lot of prose and must not be repeated here.** Since
2026-09-07 the `o` symbol on an arid map draws the **`desert_tree`** family
(`decor-place.ts:212`, `const grove: GroveFamily = input.groveFamily ??
'desert_tree'`; `art/meshes/decor/desert_tree_0..2.glb`). There are **no olive
groves in the Marj**. Every `o` below is thorn scrub and desert trees, and
`narrative-designer` must not write an olive into a briefing.

### Why one map has relief and the other does not

`map-variants-design.md` §2.2 measured it and the answer is not taste.
Elevation's two real jobs are **shape at zero tile cost** and **dead ground**;
it is a weak router (*"a bowl prices ground and reorders nothing"*, *"a ridge
with a distant saddle does nothing"*, and a saddle only reorders when
`crest > 0.8 × offset`). Khan Rafid's sight is already dominated by buildings —
40 non-wall structures, most of them sight-blocking — so an elevation grid there
would buy shape the player cannot see past a house anyway, and would cost the
smooth-ground budget for nothing measurable. Deir Amun has nine buildings and
needs its dead ground from the ground itself, so it gets a wadi.

---

### 3.1 `khan_rafid` — the enclave · **MISSING**, gate `pnpm validate:data`

48×48 · `terrain: "arid"` · **no `elevation` key** (absent means flat) ·
40 non-wall structures + 57 `wall` tiles · **no `tunnels` block**, so nothing
here can be a `collapse`.

#### The grid (draft — `mission-author` authors the JSON from this)

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
 0  ................................................
 1  .................======...ooooooo...............
 2  ...22222.........=wwww=...ooooooo.......22222...
 3  ...22222.........=wwww=...ooooooo.......22222...
 4  ...22222.........=wwww=.................22222...
 5  ......rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr......
 6  .............r...................r..............
 7  .2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
 8  .2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
 9  .2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
10  ......hhhhsssrhhhss.sshh.hhss.hhhraaahh.........
11  .............r...................r..............
12  ......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
13  ......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
14  ......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
15  ......sssshhhrssshh.hhss.sshh.sssrhhhaa.........
16  .............r...................r..............
17  .22222.......rhhhss=====.=====...rhhss....22222.
18  .22222.......rhhhss=.kkk..mmm=...rhhss....22222.
19  .22222.......rhhhss=.kkk..mmm=...rhhss....22222.
20  .22222.......rhhhss..kkk..mmm....rhhss....22222.
21  .22222.......rhhhss=.kkk.....=...rhh......22222.
22  .............rhhh..=.........=111r1ss...........
23  .............r.....=====.=====111r1ss...........
24  .............r11111...........111r111...........
25  ..rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr..
26  .........r.....222222.................r.........
27  .........r.....222222.................r.........
28  .........r.........###................r.........
29  .........rhhh......###................r.........
30  .........rhhh..aaaa###.....aaaa.......r..www....
31  .........rhhh..aaaa........aaaa.......r..www....
32  .........r.....aaaa........aaaa.......r..www....
33  ...======r.....aaaa........aaaa....111r11.......
34  ...=wwww=r..............2222.......111r11.......
35  ...=wwww.r..............2222..........r..sss....
36  ...=wwww=r....11111..hhh.ss.....hhh...r..sss....
37  ...======r....11111..hhh.ss.....hhh...r..sss....
38  .........r....11111..hhh.ss.....hhh...r.........
39  .........r............................r.........
40  .........r....ooooooo.......ooooooo...r.........
41  .........r....ooooooo.......ooooooo...r.........
42  .........r....ooooooo.......ooooooo...r.........
43  ....22222r............................r.22222...
44  ....22222r............................r.22222...
45  ....22222r............................r.22222...
46  .........r......1111111111111111......r.........
47  .........r............................r.........
```

#### The shape, south to north

| feature | tiles | what it is |
|---|---|---|
| **the staging ground** | y42–47, zone `staging [14,42,21,6]` | open, the KDF start line. Marker `kr_start [24,45]`. Two road mouths: the **coast road** `r` at x=9 and the **inland road** `r` at x=38, both running y26→47 |
| **the fringe** | `o` x14–20 and x28–34, y40–42 | desert-tree scrub either side of the approach; cover 1 |
| **the New Quarter** | y28–39, zone `new_quarter [8,28,32,12]` | armour country: two 4×4 apartment blocks (`a`, 520 hp/tile, `roe_penalty` **14**), a 3×3 concrete block, two walled warehouse yards, three-tile streets. The KDF field camp goes here |
| **Main Street** | `r` y=25, x2–45 | the town's spine, full width, and the only east–west road. Markers `main_street [24,25]`, `kr_west_edge [2,25]`, `kr_east_edge [45,25]` |
| **the market** | zone `market [30,22,7,5]` (x30–36, y22–26) | an open square of cover-1 ground with two shanty stalls, east of the ward, on Main Street. Marker `market_square [32,23]` |
| **the ward** | zone `ward [20,17,9,7]` (x20–28, y17–23) | **the arc's whole subject.** A walled compound holding one `clinic` (`k`, 3×4, 260 hp/tile, `roe_penalty` 6) and one `hall` (`m`, 3×3, 900 hp/tile, **`roe_penalty` 30**), with **four gates** — north `[24,17]`, south `[24,23]`, west `[19,20]`, east `[29,20]`. Markers `civ_refuge [24,22]` (inside the zone, in the forecourt between the two buildings), `ward_gate [24,24]`, `ward_north_gate [24,17]` |
| **the Old Town** | y6–15, zone `old_town [6,6,33,10]`; capture zone `souk [19,6,11,10]` (x19–29, y6–15) | the dense half: eleven two-and-three-tile house and shanty blocks on **one-tile alleys** at x=19, x=24, x=29, with cross-alleys at y=6, y=11 and y=16. Marker `souk_alley [24,11]` |
| **the two lanes** | `r` x=13 and x=33, y6–24 | the only *roads* through the Old Town, each **one tile wide between building walls**. Markers `west_lane [13,24]`, `east_lane [33,24]` |
| **the north road** | `r` y=5, x6–41 | the Ashwar's line of communication. Marker `north_road [24,5]` |
| **the store** | zone `store [16,1,8,5]` (x16–23, y1–5) | a walled warehouse compound on the north road, its only opening onto the road itself. Marker `store_gate [19,5]`. A `capture` secondary in KR III |

#### Chokepoints, dead ground, protected structures

- **Three ways north from Main Street, and they are not equal.** The west lane
  (x=13) and the east lane (x=33) are one-tile roads with houses on both sides;
  the third is **straight through the ward**, in the south gate at `[24,23]` and
  out the north gate at `[24,17]`.
- **Dead ground** is the Old Town alleys. A one-tile alley between two rows of
  `h`/`s` gives sight along its own axis and nothing else, which is what makes
  `ambush(3)` worth authoring here and what a rushed recon pays for in KR III.
- **`=` does not block sight, and this is the single easiest thing to get wrong
  on this map.** `wall` is `low_profile: true`, `per_tile: true`,
  `standing_cover: 2`, `roe_penalty: 0` (`data/structures.json`). So the ward's
  walls stop movement and **not** bullets: a militia cell in the souk can see
  and shoot into the compound over them, the player can shoot back, and only the
  player is billed for it. Breaching one costs nothing, and `stepBreach`
  (`sim.ts:3073`) will cut a panel on its own initiative because a `wall` has
  `garrison_slots: 0` — houses, with 2, are exempt.
- **Two protected tiers, and only one of them is *protected*.** `hall`
  (`roe_penalty` 30) is at or above `PROTECTED_ROE` (20, `structures.ts:135`),
  which means the sim **refuses to engage it, breach it, or demolish it on any
  unit's own initiative** (`sim.ts:2977`, `:3073`, `:4345`). It comes down only
  for an explicit `demolish` order from a selection containing nothing but
  demolishers (`input/intents.ts` `sortStructureOrder`). `clinic` and `apartment`
  are not protected and behave normally.
- **A garrisoned enemy contests a zone and cannot be shot out of it without
  levelling his building.** `contestedIn` (`mission.ts:1325`) skips only buried
  units — a unit inside a structure is at the structure's position and counts —
  and a garrisoned unit is not a legal aimpoint (`sim.ts:2483`). So **every
  `capture` and `hold_for` in this arc whose zone contains a garrisoned building
  is a demolition decision**, at that building's `roe_penalty`, and the ladder is
  authored to make each one a different price: `store`'s warehouse is 3,
  `market`'s stalls are 2, the north-east `apartment` is 14, and the ward's
  `hall` is 30 and cannot be shot at all.
- **The ROE arithmetic, so `level-scripter` can price a plan.** A destroyed
  structure deducts `roe_penalty × structure_penalty_mult` (`mission.ts:1209`).
  Levelling every non-wall structure on this map is **−228 at mult 1** and −456
  at mult 2. A near-miss inside a `flagged_zones` entry from a weapon with
  `collateral_risk ≥ 0.3` deducts 5, **once per zone per 10 s**
  (`ZONE_DEDUCT_COOLDOWN = 200`). Which KDF weapons arm that: `at_team` spike
  (0.30), `ifv_namer` cannon_30 (0.35), `mbt_lavi` gun_120 (0.55),
  `mortar_team` mortar_60 (0.70), `demo_squad` charges (0.60). Which do **not**:
  all rifles (0.10), `sniper_team` amr (0.05), Lavi `coax_mg` (0.20),
  `apc_eitan` rws_50 (0.25), `jeep_shoded` pintle_mg (0.25). **So armour is not
  banned from the ward — its secondary armament is free there and its main gun
  is not.** That is the arc's mechanical thesis and no shipped mission states it.

#### The routes, drafted and to be measured

Tile-BFS on the grid above, 8-connected, from `kr_start [24,45]`. **These are
draft numbers.** The map is flat, so `FlowField` should agree closely, but
`level-scripter` measures and pins them before any JSON is authored.

| claim | draft |
|---|---|
| `kr_start` → `souk_alley [24,11]` | **34 tiles**, through the ward |
| the same with **both ward gates shut** | **38 tiles** — so **the fastest road north runs through the one zone the player may not fight in**, and it saves four tiles |
| `kr_start` → `north_road [24,5]` | 40 · with the ward shut, 43 |
| `kr_start` → `store_gate [19,5]` | 43 · with the ward shut, 44 |
| west lane shut at `[13,16]`, or east lane shut at `[33,16]`, or both | **34, unchanged** — the ward route does not use either, so `map-variants-design.md` rule 2 (two routes to every primary, no shared chokepoint) holds with slack |
| foot vs vehicle reachable tiles | **1836 and 1836.** There is no `b` and no `d` on this map: **Khan Rafid has no domain split at all**, deliberately. Its constraint is ROE and street width; Deir Amun's is ground |
| civilian walk to `civ_refuge [24,22]` | from the Old Town y=16 line: **8–13 tiles**. From the New Quarter y=27 line: **5–7 tiles**. All well inside `map-variants-design.md` rule 4 |

**Assertions for `tools/src/khan_rafid_doctrine.test.ts`** (new; §7 C8):

- **KR-A1** `kr_start`→`souk_alley` through the ward is **strictly cheaper** than
  the same route with `[24,17]` and `[24,23]` blocked, measured through
  `FlowField.compute` on both masks, with the blocked control built from the
  same map.
- **KR-A2** blocking the narrowest tile of the cheapest route leaves a **finite**
  route for both domains (rule 2), tested at `[24,20]`, `[13,16]` and `[33,16]`.
- **KR-A3** the foot line from every authored civilian spawn to `civ_refuge` is
  **≤ 14 tiles** and crosses no blocked tile (rule 4). This is the assertion that
  catches a spawn walled into a courtyard, which is the failure a grid cannot
  show by eye.
- **KR-A4** `civ_refuge [24,22]` lies **inside** zone `ward`. The runtime throws
  at load if it does not (`mission.ts:748`), and the throw names the objective,
  not the map, so it reads as a mission bug.
- **KR-A5** a `sarim`-range observer standing in the souk at `[24,16]` **sees**
  tiles inside the ward — the `low_profile` wall fact above, pinned as behaviour
  rather than prose, because it is the fact the whole ROE design rests on.
- **KR-A6** zone `ward` contains exactly **two** structures, one `clinic` and one
  `hall`, and zone `souk` contains **no** `hall` — so no `raze` or stray
  demolition inside the capture zone can cost 30.
- **KR-A7 — the trap this document nearly shipped.** Every zone named by a
  `capture` or `hold_for` objective contains **at least 12 tiles passable to both
  domains**. A first draft of zone `store` was `[17,1,6,4]`, drawn tightly round
  the warehouse compound — and **every tile in it is a building or a wall**, so
  `livingIn(zone, 0) > 0` can never be true and the objective can never start.
  Nothing catches that: `validate_data.mjs` checks a `raze` zone for the wrong
  structure types and a `collapse` zone for tunnel mouths, and checks a
  `capture` zone for nothing at all (§7 G9). Counted on the final grid:
  `ward` **26** open tiles, `souk` **46**, `market` **31**, `store` **16**.

---

### 3.2 `deir_amun` — the junction · **MISSING**, gate `pnpm validate:data`

48×48 · `terrain: "arid"` · **`elevation` 0–5** · 13 non-wall structures +
34 `wall` tiles · **six `tunnels` routes**.

#### The grid (draft)

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
 0  ................................................
 1  ......nnnnnnn.......sss...........nnnnnnnnn.....
 2  ......nnnnnnn.......sss...........nnnnnnnnn.....
 3  ......nnnnnnn.....................nnnnnnnnn.....
 4  ....rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr...
 5  ................................................
 6  ..22222....................................2222.
 7  ..22222....................................2222.
 8  ...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
 9  ...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
10  ...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
11  ...............2222222.........22222222.........
12  ...............2222222.........22222222.........
13  ...................................======r......
14  ...............11111...............=wwww=r......
15  .......ssbbb...11111...............=wwww=r......
16  .......ssbbb..........nnnnnnnnnnnnn=wwww=r......
17  .........bbb..........nnnnnnnnnnnnn==.===r......
18  ......111bbb..........nnnnnnnnnnnnn......r11111.
19  ......111bbb......rrrrrrrrrrrrrrrrrrrrrrrr11111.
20  .........bbb......hhh.....ssr.hhh........r11111.
21  .........bbb......hhh.hhh.ssr.hhh.s......r......
22  .........bbb......hhh.hhh...r.....s......r......
23  .........bbb..........hhhhhhr............r......
24  .........bbb======.......hhhr.www........r......
25  .........bbb=###.=ss..##.hhhr.www..hhh...r......
26  .........bbb=###.=ss..##....r.www..hhh...r......
27  .........bbb=###.=..........r............r......
28  .........bbb===.==..........r............r......
29  222222222bbb2222222222222222r222222222222r222222
30  bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
31  bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
32  bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
33  2222222222222222222222222222r222222222222r222222
34  ............................r............r......
35  ...222222.........ooooooooo.r............r.2222.
36  ...222222.........ooooooooo.r...ooooooo..r.2222.
37  ...222222.........ooooooooo.r...ooooooo..r.2222.
38  ..................ooooooooo.r...ooooooo..r.2222.
39  ............................r............r......
40  ............11111...........r....111111..r......
41  ............11111...........r....111111..r......
42  ............11111...........r....111111..r......
43  ............................r............r......
44  ............................r............r......
45  ....................11111111r11..........r......
46  ....................11111111r11..........r......
47  ............................r............r......
```

#### The elevation grid (draft, range 0–5)

```
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
 0  444444444444444444444444444444444444444444444444
 1  444444555555544444444444444444444455555555544444
 2  444444555555544444444444444444444455555555544444
 3  444444555555544444444444444444444455555555544444
 4  444444444444444444444444444444444444444444444444
 5  444444444444444444444444444444444444444444444444
 6  444444444444444444444444444444444444444444444444
 7  444444444444444444444444444444444444444444444444
 8  444444444444444444444444444444444444444444444444
 9  444444444444444444444444444444444444444444444444
10  444444444444444444444444444444444444444444444444
11  333333333333333333333333333333333333333333333333
12  333333333333333333333333333333333333333333333333
13  333333333333333333333333333333333333333333333333
14  333334444333333333333333333333333333333333333333
15  333334442000233333333333333333333333333333333333
16  333334442000233333333344444444444443333333333333
17  333334442000233333333344444444444443333333333333
18  333334442000233333333344444444444443333333333333
19  333334442000233333333333333333333333333333333333
20  333334442000233333333333333333333333333333333333
21  333333332000233333333333333333333333333333333333
22  333333332000233333333333333333333333333333333333
23  333333332000233333333333333333333333333333333333
24  333333332000233333333333333333333333333333333333
25  333333332000233333333333333333333333333333333333
26  333333332000233333333333333333333333333333333333
27  333333332000233333333333333333333333333333333333
28  333333332000233333333333333333333333333333333333
29  222222222000222222222222222222222222222222222222
30  000000000000000000000000000000000000000000000000
31  000000000000000000000000000000000000000000000000
32  000000000000000000000000000000000000000000000000
33  222222222222222222222222222222222222222222222222
34  222222222222222222222222222222222222222222222222
35  222222222222222222111111111222222222222222222222
36  222222222222222222111111111222221111111222222222
37  222222222222222222111111111222221111111222222222
38  111111111111111111111111111111111111111111111111
39  111111111111111111111111111111111111111111111111
40  111111111111111111111111111111111111111111111111
41  111111111111111111111111111111111111111111111111
42  111111111111111111111111111111111111111111111111
43  111111111111111111111111111111111111111111111111
44  111111111111111111111111111111111111111111111111
45  111111111111111111111111111111111111111111111111
46  111111111111111111111111111111111111111111111111
47  111111111111111111111111111111111111111111111111
```

#### The shape, south to north

| feature | tiles | what it is |
|---|---|---|
| **the staging ground** | y40–47, zone `staging [18,40,14,8]`, elevation 1 | marker `da_start [24,44]`. Two roads north: `r` x=28 (y19→47) and `r` x=41 (y13→47) |
| **the south bank** | y34–39, elevation 2, `o` groves at x18–26 and x32–38 | desert-tree scrub on the low terrace |
| **the wadi** | y29–33, zone `the_wadi [0,29,48,5]` · bed y30–32 at **elevation 0**, lips y29 and y33 at **2** | a dry watercourse of `b` **across the full width**, with **three vehicle fords**: west x14–16, centre x27–29 (carries the road), east x40–42. Markers `ford_west [15,31]`, `ford_centre [28,31]`, `ford_east [41,31]`, `wadi_bend [20,31]` |
| **the tributary** | `b` x9–11, y15–29 · bed at elevation **0**, lips x=8 and x=12 at **2** | a side gully running north out of the wadi, **sealed to vehicles for its whole length**; the top of it is open at y=14. Marker `tributary_lip [12,22]` |
| **the pump yard** | zone `pump_yard [12,23,7,6]` (x12–18, y23–28) | a walled yard round a `concrete` pump house (`#`, 700 hp/tile), **one gate**, at `[15,28]`, from the south. Markers `pump_gate [15,28]`, `pump_yard_floor [16,26]` |
| **the hamlet** | zone `hamlet [18,20,17,8]` (x18–34, y20–27), elevation 3 | nine buildings: four `h`, three `s`, one `w` compound, one `#` water tower, on one-tile lanes at x=21, x=25, x=29 and the road at x=28. Markers `hamlet_lane [28,23]`, `hamlet_north [28,19]` |
| **the north street** | `r` y=19, x18–41 | joins the two roads across the top of the hamlet |
| **the spoil field** | zone `spoil_field [22,16,13,3]` (x22–34, y16–18), `n` cover 2, **elevation 4** | the diggers' dumps. It is **one level higher than the terrace because it is spoil** — the only place on either map where elevation is a fact about the enemy rather than about the ground. Marker `spoil_field_centre [28,17]` |
| **the store compound** | zone `store_yard [35,12,7,7]` (x35–41, y12–18) | a walled `w` on the east road; one gate at `[37,17]`. Markers `store_gate [37,17]`, `store_road [41,15]` |
| **the tributary head** | zone `da_west [5,14,9,7]` (x5–13, y14–20), elevation 3–4 | two shanties on a shoulder above the gully mouth. Marker `da_west_head [7,17]` |
| **the north slope** | y8–12, zone `north_slope [3,8,43,5]` | **three `^` rock spines** at x3–14, x22–30 and x39–45, y8–10, standing on elevation 4, leaving **two gaps**: x15–21 and x31–38. Markers `gap_west [18,9]`, `gap_east [34,9]` |
| **the plateau** | y0–7, elevation 4 with two knolls at 5 | the enemy's line of communication and every wave's origin. Markers `north_road [24,4]`, `plateau_west [9,2]`, `plateau_east [38,2]`, `da_west_edge [1,19]`, `da_east_edge [46,19]` |

#### The six routes

Geometry lives in the map (`map.schema.json` `tunnels`: `id`, `mouth`,
`waypoints`, `vent`, `dig_tiles_per_s`, `pre_dug`). A `collapse` objective claims
a route **when its mouth lies inside the objective's zone** and nothing else
(`mission.ts:775`).

| id | mouth | waypoints | vent | dug? | claimed by |
|---|---|---|---|---|---|
| `da_tn_west` | `[9,17]` | `[[10,22]]` | `[10,28]` | `dig_tiles_per_s: 0.16` | zone `da_west` — **DA I** |
| `da_tn_pump` | `[16,26]` | `[[18,28]]` | `[20,30]` | `dig_tiles_per_s: 0.16` | zone `pump_yard` — **DA II** |
| `da_tn_lane` | `[20,23]` | `[[23,20]]` | `[27,18]` | `pre_dug: true` | zone `hamlet` — **DA III** |
| `da_tn_yard` | `[25,26]` | `[[29,24]]` | `[33,21]` | `pre_dug: true` | zone `hamlet` — **DA III** |
| `da_tn_north` | `[30,22]` | `[[32,17]]` | `[34,13]` | `pre_dug: true` | zone `hamlet` — **DA III** |
| `da_tn_east` | `[33,25]` | `[[37,23]]` | `[41,19]` | `pre_dug: true` | zone `hamlet` — **DA III** |

**Every mouth and every vent tile above is open ground on the draft grid** —
checked this session, tile by tile. The two dug routes leave spoil and are
findable by anyone who can see the dirt; the four `pre_dug` ones **never stamp
trail at all**, so `mark_tunnel` is the only channel that can ever find them
(`sim.ts:2710`). That split is the arc's teaching order and it is authored in the
map, not in a briefing.

#### Chokepoints, dead ground, protected structures

- **The wadi is the chokepoint and it is per-domain.** Foot crosses `b` anywhere;
  wheels and tracks cross at three fords, thirteen tiles apart. The tributary is
  sealed to vehicles over fifteen rows and open at the top.
- **The dead ground is the two beds.** Bed at 0, lip at 2, terrace at 3: with
  `BLOCK_RISE = 2` and `EYE_HEIGHT = 1`, a two-level lip is exactly the threshold
  at which terrain obscures ground troops, and the geometry says an observer on
  the terrace loses the bed as soon as he steps back from the lip. **That is a
  claim, not a measurement** — assertion DA-A3 below.
- **The `^` spines block the drone.** `moveDomain` gives an air unit the **foot**
  flow field (`sim.ts:488`), so `recon_drone` is stopped and blinded by `^`
  exactly like a rifleman. The two gaps at x15–21 and x31–38 are the drone's only
  ways north and they are deliberate: `map-variants-design.md` §2.1's rule is
  *"never put `^` across a recon drone's only line."*
- **No protected structure on this map.** No `hall`, no `clinic`. The highest
  `roe_penalty` here is `concrete` at 3 and `house` at 6, and levelling every
  structure on the map is **−46 at mult 1**. That is deliberate: *Deir Amun is
  the town there is nothing left to keep*, and its ROE pressure comes almost
  entirely from `flagged_zones: ["hamlet"]` charging 5 per ten seconds of heavy
  fire into an empty village.

#### The routes, drafted and to be measured

Tile-BFS from `da_start [24,44]`, 8-connected, ignoring slope. **Every number
below will move once `FlowField` charges `UPHILL_PER_LEVEL` for the climb out of
the bed**; they are here to show the *shape*, and the assertions are what ship.

| from `da_start` to | foot | vehicle |
|---|---|---|
| `ford_centre [28,31]` | 13 | 13 |
| `pump_gate [15,28]` | 16 | 16 |
| `pump_yard_floor [16,26]` | 18 | 18 |
| `hamlet_lane [28,23]` | 21 | 21 |
| `da_tn_lane` mouth `[20,23]` | 21 | 21 |
| `da_tn_yard` mouth `[25,26]` | 18 | 18 |
| `da_tn_north` mouth `[30,22]` | 22 | 22 |
| `da_tn_east` mouth `[33,25]` | 19 | 19 |
| `spoil_field_centre [28,17]` | 27 | 27 |
| `store_gate [37,17]` | 27 | 27 |
| **`da_west_head [7,17]`** | **27** | **37** |
| `gap_west [18,9]` / `gap_east [34,9]` | 35 | 35 |
| `da_tn_west` mouth `[9,17]` | 27 | **no route** — the mouth is a `b` tile in the gully bed |

**Assertions for `tools/src/deir_amun_doctrine.test.ts`** (new; §7 C8):

- **DA-A1 — the one that makes the arc winnable or not.** For **each of the six
  routes**, there exists at least one tile the route runs under that is *open
  ground* and that some standable tile within **8 tiles** (`yahalom_squad`'s
  sight) reaches with a clear `losRay`. `markerSeesRoute` (`sim.ts:2809`) needs
  exactly that, and *"a route nobody has found cannot be charged"* — so a route
  buried entirely under buildings makes a `collapse` primary **permanently
  impossible**, which `checkEnd` turns into a mission that is unwinnable and
  unlosable at once. Measure this before the map file is committed.
- **DA-A2** the vehicle route to `da_west_head` is **≥ 8 tiles longer** than the
  foot route, and both are finite. Paired against a control with the tributary's
  `b` cleared, where both must be equal. This is `map-variants-design.md` rule 3
  — a detour priced in tiles, not in deaths.
- **DA-A3 — the dead ground.** Two units spawned on the terrace at `[24,26]` and
  in the bed at `[24,31]`: `sim.debugDetection(a, b).visible` is **false** at
  sight 8 and 12, and **true** when one of them stands on the lip at `[24,29]`.
  Paired against a control with the elevation grid flattened, where it must be
  true from everywhere.
- **DA-A4** the `recon_drone`, on the **foot** field, reaches `north_road [24,4]`
  from `da_start` — the `^` spines have two gaps and the air unit uses them.
  Paired against a control with the gaps filled, where it must be unreachable.
- **DA-A5** zone `hamlet` contains exactly **four** tunnel mouths; zones
  `pump_yard` and `da_west` contain exactly **one** each; and the three zones are
  disjoint. `validate_data.mjs` refuses a `collapse` zone with no mouths, but
  nothing refuses a zone with *five*.
- **DA-A6** blocking `ford_centre` leaves a finite vehicle route to `hamlet_lane`
  through both other fords (rule 2).
- **DA-A7** the same open-tile floor as KR-A7, for `pump_yard`, `store_yard` and
  `hamlet`. Both walled-yard zones were widened for exactly this reason: the
  first draft of `pump_yard` had **four** open tiles inside the wall and
  `store_yard` had **one**. Counted on the final grid: `pump_yard` **16**,
  `store_yard` **20**, `hamlet` well over 60.

### 3.3 What is deliberately not on these maps

- **No `d` (anti-tank ditch) anywhere.** `b` and `d` are mechanically identical
  to the byte (`packages/data/src/map.ts`), and the choice between them is
  fiction: `b` is natural stone, `d` is something dug. A dry wadi bed is stone.
  `qarn_hadid` remains the only map with `d`.
- **No `3` (cover 3) anywhere.** `qarn_hadid_relief.test.ts` measured that
  **cover 2 and cover 3 are not separable in a duel** (`COVER_HIT` = 1 / .375 /
  .1375 / .09; the big rung is 0→1), so a third tier buys fiction and no
  mechanics. `qarn_hadid` remains the only map with it.
- **No elevation on Khan Rafid** — see the opening of §3.
- **No per-mission map variants in the recommended plot.** They are the
  recoverable half of Option B and are offered as O-KR6.

---

## 4. Mission ladder

| # | id · name | phase | target | primaries (type · target) | secondaries | ledger requires / produces | econ |
|---|---|---|---|---|---|---|---|
| 1 | `khan_rafid_1_recon` · *House Numbers* | recon | **6** | `locate` · `kr_watch` (3 tagged) · **`evacuate_before` · `ward` (count 2, 240 s)** | `locate` · `kr_lane_west`; `locate` · `kr_lane_east`; `locate` · `kr_hvt_ward`; `survive_until` 300 | **R** / **R M C I E** | n |
| 2 | `khan_rafid_2_foothold` · *The Ward* | foothold | **7** | `hold_for` · `ward` (240 s) · **`evacuate_before` · `ward` (count 4, 300 s)** | `capture` · `market` (15 s); `eliminate_hvt` · `kr_lane_west` | **R I** / **R M C E** | **y** |
| 3 | `khan_rafid_3_clearance` · *What You Keep* | clearance | **7** | `capture` · `souk` (20 s) · **`evacuate_before` · `ward` (count 6, 300 s)** | `eliminate_hvt` · `kr_hvt_ward`; `capture` · `store` (15 s) | **R I** / **R M C I E** | **y** |
| 4 | `deir_amun_1_recon` · *Read the Ground* | recon | **6** | `locate` · `da_diggers` (3 tagged) · **`collapse` · `da_west` (240 s)** | `locate` · `da_hvt_engineer`; `locate` · `da_watch_gap`; `survive_until` 300 | **R I** / **R M C I** | n |
| 5 | `deir_amun_2_foothold` · *Set the Charges* | foothold | **7** | `hold_for` · `pump_yard` (240 s) · **`collapse` · `pump_yard` (240 s)** | `capture` · `store_yard` (15 s); `eliminate_hvt` · `da_watch_gap` | **R I** / **R M C** | **y** |
| 6 | `deir_amun_3_subterranean` · *All Four* | subterranean | **7** | **`collapse` · `hamlet` (300 s)** · `eliminate_hvt` · `da_hvt_engineer` | `destroy_all`; `survive_until` 300 | **R I** / **R M C I** | **y** |

Phases ascend **2 → 3 → 5** within Khan Rafid and **2 → 3 → 6** within Deir Amun.
Every objective type is one of the nine the runtime runs (`mission.ts:323`); no
`mark`, `escort` or `no_collateral_above` appears anywhere. Every
`target_minutes` is inside the schema's 5–7 band. Every ledger key is one of the
five that exist.

**The failable primary is in bold on every row**, and that is the whole
passive-loss argument: `raze`, `collapse` and `evacuate_before` are the only
three types that can reach `failed`, and a failed primary is a defeat in
`checkEnd`. `tel_marum`'s three passive controls all end **`ongoing`** — stuck
rather than lost, the state this pipeline refuses — and Wadi Halam, Umm Zeitoun
and Qarn Hadid were all designed away from it. **This arc is designed to that
rule from the first line, and it is the only arc in which every one of the six
failable primaries is on the *same* mechanic within its town.**

**`destroy_all` is a secondary in DA III and not a primary, against
`storyline.md` §4.2's sketch.** The reason is measurable: `destroy_all` completes
only when every id in `enemyIds` is dead, waves append to that list, and a wave
on a clock can therefore extend the mission indefinitely — which is exactly the
failure CLAUDE.md records as invisible to CI (*"the same break at 900 s took that
mission from 2.5 min to 17.2 min … and the gate stayed GREEN"*). Left as a
secondary it costs nothing and reads as the thing it is: collapsing a stocked
route kills everyone below it (`sim.ts:4578`), so bringing all four down usually
completes it anyway.

---

## 5. Per mission

Coordinates are tile centres for `mission-author` to place from; every one was
checked against the draft grids this session and the symbol is given where it
matters. **Placements spread across tiles** — a count-3 group occupies three —
so a clear `at` does not promise clear ground for its siblings, and
`assertGroundClear` is what catches it at load.

**One hard rule for this whole arc, and it applies to `mission-author` before
anything else:** ***do not field a `demo_squad` on either map.*** Nothing here
needs one — the tunnel charge is `yahalom_squad`'s `tunnel_charge`, not
`demo_squad`'s `demolish` — and `stepDemolition`'s automatic branch levels the
nearest unprotected, unoccupied structure a `canDemolish` unit merely halts
beside, with no order (`sim.ts:4336`). On a 40-building town at
`structure_penalty_mult: 2` that is an unbounded ROE leak the player never
ordered and cannot see the cause of. The same branch is what cost Umm Zeitoun II
its own camp at tick 100.

---

### 5.1 KR I — `khan_rafid_1_recon` · *House Numbers* · recon · 6 min

**Player starting state.** `map.player_start [24,45]`. No `resources`, no
`structures[]`.

| unit | count | from | at |
|---|---|---|---|
| `recon_drone` | 1 | — | `[24,44]` |
| `jeep_shoded` | 1 | — | `[22,45]` |
| `apc_eitan` | 1 | — | `[26,45]` |
| `inf_squad` | 2 | `from_ledger` | `[24,46]` |
| `at_team` | 1 | `from_ledger` | `[27,46]` |

**Civilians.** Four, in two groups, in the Old Town on the y=16 cross-alley:
**2 at `[20,16]`** and **2 at `[27,16]`** (both open ground). `civilians.refuge:
"civ_refuge"` `[24,22]`, and the `evacuate_before` target is zone **`ward`**,
which contains that marker — assertion KR-A4.

Measured on the draft grid: the foot walk from `[20,16]` to the refuge is
**9 tiles** and from `[27,16]` **8**, both through the ward's north gate at
`[24,17]`. **So the walk home is short and the whole cost is the reach** — the
groups sit 29 and 30 tiles from the start line, on the far side of Main Street,
inside a town nobody has scouted.

`jeep_shoded` and `apc_eitan` carry **2 each** (`hull.transport_slots`), and
`CivilianFlight` boards a civilian into any player carrier with a free slot
inside 4 tiles (`civilians.ts`, `SHEPHERD_RADIUS_SQ`). **Driving is how you beat
the clock. Walking is how you lose it** — and the jeep is 2.9 tiles/s against
infantry at 0.9, so the mission's first decision is made in the first ten
seconds.

**Enemy stance.** `enemy.faction: "ashwar"`, `doctrine_profile: "the town he
built"`.

| tag / group | unit | at | stance | why there |
|---|---|---|---|---|
| `kr_watch` | `militia_cell` ×1 | `[19,11]` (Old Town alley) | `hold_position` | the west alley's eye. Sight 7 down a one-tile alley |
| `kr_watch` | `militia_cell` ×1 | `[29,11]` (Old Town alley) | `hold_position` | the east alley's eye |
| `kr_lane_west` | `rpg_team` ×1 | `[13,20]` (the west lane) | `ambush(3)` | the lane, not the ward. A rocket team that does not fire until you are three tiles away, in a road one tile wide. A `locate` secondary |
| `kr_watch` | `atgm_cell` ×1 | `[43,25]` (Main Street, east end) | `hold_position` | range 10 down a straight road with no cover on it. **This is the tag that makes crossing Main Street a decision** |
| `kr_hvt_ward`, group `ward_party` | `militia_cell` ×1 | `[31,16]` | `hold_position` | the block commander, forward of the ward, watching the crossing. He is a `locate` **secondary** here and comes back garrisoned in KR III |
| `kr_lane_east` | `rpg_team` ×1 | `[33,20]` (the east lane) | `ambush(3)` | the mirror of the west lane. A `locate` secondary |
| — | `militia_cell` ×1 | patrol `[24,24] → [24,17]` | `patrol` | **a patrol through the ward's own gates**, so the compound is not a still photograph and the player learns on sight that the enemy walks through it too |
| — | `mortar_crew` ×1 | `[24,3]` (north edge, grove) | `hold_position` | range 16 from y=3 reaches y=19 — **Main Street and no further south**, and **it cannot reach either civilian group at y=16 by more than a tile.** That siting is deliberate and load-bearing; see the passive-loss note |

**Waves.** 150 s: 2 `militia_cell` from `north_road` to `souk_alley`, with a
`say`. 260 s: 1 `technical` from `kr_east_edge` to `main_street` — the road is
his, and it is straight.

**Triggers.** `zone_entered(ward)` → `spawn` 1 `militia_cell` at
`ward_north_gate`, with an Idit `say`: the compound is not empty and never was.
`casualties_pct(35)` → `withdraw_to souk_alley`, group `ward_party`.

**The decision.** *The drone goes north; the men go to the ward; there is one
clock.* The three `kr_watch` posts are spread across the Old Town and Main
Street, and one drone sortie up the centre identifies the two in the alleys; the
third is an ATGM nineteen tiles east along a straight road with no cover on it,
covered by its own weapon. Meanwhile the
two families will not move until a soldier is inside 4 tiles of them, and the
only bodies that can reach them in 240 s are the same two carriers the player
would rather keep behind the drone. **Every tag skipped here is bought back at
full price in KR II and KR III**, where `kr_lane_west`, `kr_lane_east` and
`kr_watch`'s ATGM are all `ambush` — and a pre-identified placement **spawns identified and forfeits
its ambush** (`spawnPlacement`'s `preMarked`).

**Passive-player loss.** A passive force at `[24,45]` is 20 tiles from anything
that can see it and further than that from anything that can shoot it. Nobody is
within 4 tiles of a civilian; nothing suppresses one; nobody walks;
`evacuate_before` **fails at 240 s**. Defeat by clock, no wipe required.

**Twist candidates** (for `level-scripter` to classify):

- **T-KR1 "The patrol walks through the clinic yard."** The `patrol` stance
  through `[24,24] → [24,17]` puts an enemy section inside the flagged compound
  on a loop, and every player's first instinct is to shoot it there. *Expressible
  today* — one `stance: {kind: "patrol", waypoints: [...]}`.
- **T-KR2 "The road is the trap."** `kr_watch`'s ATGM at `[43,25]` covers ten
  tiles of a 44-tile straight road with no cover on it, and Main Street runs the
  whole width of the town — every route from the staging ground to the ward
  crosses it somewhere. *Expressible today* — a placement plus an Idit `say` when
  it fires.
- **T-KR3 "They were never going to stay."** `do.kind: "remove"` with `group` on
  a `timer_s(250)` for any civilian group still un-reached: the objective has
  already failed by then, and this is what stops four people standing in an alley
  for the rest of the mission. *Expressible today* — the verb shipped and
  `umm_zeitoun_1_recon` uses it.

**Story hooks** (`narrative-designer`). The `dispatch` is the prisoner: what he
told Idit, how old it is, and that she does not believe the half of it. Idit's
beat is that Khan Rafid has house numbers and a clinic and a hall and a market
day, and that every one of those is why he chose it. Shai's beat is the cost
line and it is an arithmetic he has done before: **two vehicles, two seats each,
and four people on the far side of a road he has not crossed.**

---

### 5.2 KR II — `khan_rafid_2_foothold` · *The Ward* · foothold · 7 min · **economy**

**Player starting state.** `player_start [24,45]`.

| unit | count | from | at |
|---|---|---|---|
| `inf_squad` | 3 | `from_ledger` | `[24,46]` |
| `at_team` | 1 | `from_ledger` | `[27,46]` |
| `mortar_team` | 1 | `from_ledger` | `[21,46]` |
| `apc_eitan` | 2 | — | `[26,45]` |
| `jeep_shoded` | 1 | — | `[22,45]` |
| `ifv_namer` | 1 | — | `[29,45]` |
| `recon_drone` | 1 | — | `[24,44]` |

`resources`: `logistics_start 400`, `logistics_rate_per_min 120` — the shipped
foothold rate (`beit_sahwan_2_foothold`, `tel_marum_2_foothold`,
`wadi_halam_2_laager` all carry 400/120). No `intel_start`: the campaign has no
Intel economy (§7 G4). `structures`: one `camp`, size `[2,2]`, at **`[24,33]`**
— open ground in the New Quarter, 12 tiles behind the ward, off both roads and
outside every wave's path.

**Civilians.** Six, in three groups: **2 at `[16,16]`** (Old Town, west), **2 at
`[31,16]`** (Old Town, east), **2 at `[23,27]`** (New Quarter, south of Main
Street). Draft walks to the refuge: **13, 9 and 5 tiles.** Refuge and target as
KR I.

**ROE.** `enabled: true`, `flagged_zones: ["ward"]`, **`fail_below: 45`**,
`structure_penalty_mult: 1`. This is the **first foothold in the game with an
ROE floor at all** — every shipped foothold declares `{"enabled": true}` and
nothing else — and that escalation is the mission's point.

**Enemy stance.**

| tag / group | unit | at | stance |
|---|---|---|---|
| group `ward_push` | `militia_cell` ×2 | `[24,14]`, `[29,14]` (souk alleys) | `hold_position` |
| group `ward_push` | `rpg_team` ×1 | `[22,16]` | `ambush(3)` |
| `kr_lane_west` | `rpg_team` ×1 | `[13,18]` (west lane) | `ambush(3)` — **pre-identified and ambush-forfeited if KR I found it** |
| `kr_lane_east` | `rpg_team` ×1 | `[33,18]` (east lane) | `ambush(3)` — same |
| `kr_hvt_ward`, group `ward_party` | `militia_cell` ×1 | `[24,9]` (souk) | `hold_position` — he is not in the hall yet |
| — | `militia_cell` ×2 | `garrison` the apartment block at `[34,8]` | `garrison` | the north-east block overlooks the east lane; `apartment` is `roe_penalty` **14** and **not** protected, so it can be shot down — at a price |
| — | `mortar_crew` ×1 | `[24,3]` | `hold_position` | same siting as KR I, same reason |
| — | `technical` ×1 | patrol `[8,25] → [40,25]` | `patrol` | Main Street belongs to somebody |

**Waves.** 120 s: 2 `militia_cell` from `north_road` → `ward_north_gate`, with a
`say`. 240 s: 1 `rpg_team` + 1 `moto_rpg` from `kr_west_edge` → `main_street`.
330 s: 2 `militia_cell` from `north_road` → `ward_gate`, with a `say`.
**Cadence: one push at the ward every two minutes, alternating with one down the
road**, so neither the hold nor the escorting ever gets a quiet stretch.

**Triggers.** `zone_entered(ward)` → `commit` group `ward_push` to `civ_refuge`
— the moment the player takes the compound, the enemy walks into it, because it
is the one place the KDF will not shoot. `casualties_pct(40)` → `withdraw_to
souk_alley`, group `ward_party`. `timer_s(200)` → `spawn` 1 `charge_squad` at
`souk_alley`, committed at the ward — a suicide charge is doctrinally Ashwar and
mechanically the one enemy unit that can splash a civilian.

**The decision.** *What are you allowed to bring inside the wire you are
holding?* Three strands run at once:

1. **The hold.** `hold_for(ward, 240)` is cumulative, and it pauses whenever an
   enemy stands **inside** the zone within 6 tiles of a friendly who is also
   inside it (`contestedIn`, `CONTEST_RADIUS_SQ` = 6 tiles). The ward is 9×7 with
   four gates and low walls, so pausing it is easy and clearing it takes bodies.
2. **The escort.** Six civilians in three places, and the two carriers can do two
   at a time.
3. **The bill.** The Namer is the obvious answer to a section in the compound —
   and `cannon_30` is `collateral_risk` 0.35, which arms the flagged-zone penalty
   at −5 per ten seconds for as long as it fires there. Its own coax equivalent
   does not exist; the **Eitan's `rws_50` (0.25) and the Lavi's `coax_mg` (0.20)
   are free inside the zone**, and rifles at 0.10 are free everywhere. So the
   play is: **infantry and the Eitan clear the compound, the Namer holds the
   street outside it**, and a player who does it the other way round watches a
   number fall he cannot get back.

And the economy is the fourth strand: at 120 a minute the player buys roughly
three rifle sections or one Namer across the mission, and **what he buys is a
choice between more bodies for a hold and more gun for a street he is not allowed
to use the gun in.**

**Passive-player loss.** The three families never move; `evacuate_before` **fails
at 300 s**; defeat. A passive player also never enters the ward, so `hold_for`
never starts — but it is the evacuation deadline that ends the mission, and that
is deliberate: **the losable objective is the one the player has to act on.**

**Twist candidates.**

- **T-KR4 "He comes to the one place you will not shoot."** The
  `zone_entered(ward) → commit ward_push → civ_refuge` above. *Expressible
  today.* The purest statement of SPADE's doctrine available in the vocabulary,
  and it needs one trigger and one `say`.
- **T-KR5 "The block above the lane."** Two cells garrisoned in the north-east
  `apartment`: 14 ROE to level, `garrison_slots` 4, and it overlooks the east
  lane. The player can pay 14 or he can go the other way. *Expressible today.*
- **T-KR6 "One of them runs the wrong way."** A civilian group placed so that the
  nearest thing to it at t=0 is an enemy section, so the first `CivilianFlight`
  break at suppression > 0.3 sends them across the fight rather than out of it.
  *Expressible today as a placement* — and `playtest` should be asked whether it
  is cruel or merely unfair (O-KR5).

**Story hooks.** The ward is a decision Shai makes out loud and it is the one a
Captain is not supposed to make: he puts the brigade's weight on a compound with
no military value because it is the only place in Khan Rafid where a family can
stand and not be in somebody's field of fire. Idit's beat is the second half of
First Light finally being possible — she says the number, because she is the one
who says the numbers.

---

### 5.3 KR III — `khan_rafid_3_clearance` · *What You Keep* · clearance · 7 min

**Player starting state.** `player_start [24,45]`. `resources`:
`logistics_start 400`, `logistics_rate_per_min 80` — the clearance trickle every
shipped clearance carries.

| unit | count | from |
|---|---|---|
| `inf_squad` | 4 | `from_ledger` |
| `at_team` | 1 | `from_ledger` |
| `mortar_team` | 1 | `from_ledger` |
| `apc_eitan` | 2 | — |
| `jeep_shoded` | 1 | — |
| `ifv_namer` | 1 | — |
| `mbt_lavi` | 1 | — |
| `sniper_team` | 1 | — |
| `recon_drone` | 1 | — |

`mbt_lavi` gates at ROE 55 and `sniper_team` at 60; `starting_force` **ignores
unit unlocks** (known hole, `mission.ts` `spawnPlacement`), and Act I's measured
plan ratings are 75 / 100 / 100 / 94 / 98, so a campaign arriving here honestly
holds both. Recorded, not exploited.

**Civilians.** Eight, in four groups: **2 at `[16,16]`**, **2 at `[20,16]`**,
**2 at `[31,16]`**, **2 at `[30,27]`**. Draft walks: 13, 9, 9, 7.

**ROE.** `enabled: true`, `flagged_zones: ["ward"]`, **`fail_below: 50`**,
**`structure_penalty_mult: 2`**.

Both of those are firsts and **only one of them is an experiment**. `fail_below`
50 is five points above the shipped maximum (45, on the four clearances that have
one). `structure_penalty_mult: 2` has **never been used** — all four missions
that declare the field declare 1 — and it is the dial that literally scores *how
much of the town is standing*: at mult 2 a `house` costs **12**, an `apartment`
**28**, a `shanty` **4**, and levelling the whole town costs **−456**. **From
100, eight houses lose the mission.** That is a rule a player can hold in his
head, and it is the sentence the arc has been building to.

> **This is the one number in the arc that must be measured before it ships.**
> `playtest` runs the scripted plan first and reads its ROE. **If the plan lands
> under 65, the fallback is `structure_penalty_mult: 1` and `fail_below: 55`** —
> which keeps a high floor and drops the experiment, rather than keeping the
> experiment and lowering the floor. Two experiments at once is how a mission
> becomes unwinnable for a reason nobody can name.

**Enemy stance.**

| tag / group | unit | at | stance | why |
|---|---|---|---|---|
| `kr_hvt_ward`, group `hall_party` | `militia_cell` ×1 | **`garrison` the `hall`**, building `[27,19]` | `garrison` | **the block commander, inside the one structure on the map the sim will not shoot on its own initiative** (`roe_penalty` 30 ≥ `PROTECTED_ROE` 20). He is an `eliminate_hvt` **secondary**, and that is the point |
| group `hall_party` | `rpg_team` ×1 | `[25,22]` (ward forecourt) | `ambush(3)` | inside the flagged zone, three tiles from the refuge marker |
| group `souk` | `militia_cell` ×2 | `garrison` the blocks at `[21,8]` and `[26,13]` | `garrison` | the souk |
| group `souk` | `rpg_team` ×1 | `[24,11]` (the centre alley) | `ambush(3)` | the alley the player must walk to take `souk` |
| `kr_lane_east` | `rpg_team` ×1 | `[33,14]` | `ambush(3)` | **pre-identified and ambush-forfeited if KR I found it** |
| `kr_watch` | `atgm_cell` ×1 | `[41,25]` | `ambush(6)` | **pre-identified and ambush-forfeited if KR I found it** |
| — | `charge_squad` ×1 | `[19,6]` | `hold_position` | the one unit that can splash a civilian. **Sited north of the souk, out of the ward, deliberately** |
| — | `militia_cell` ×2 | `garrison` the store `w` at `[19,3]` | `garrison` | the `capture(store, 15)` secondary |
| — | `mortar_crew` ×1 | `[38,3]` | `hold_position` | range 16 from y=3 reaches y=19; still short of every civilian group |
| — | `loiter_drone` ×1 | `[24,1]` | `hold_position` | a kamikaze drone over the north road. Ashwar borrows one, exactly as `beit_sahwan_3_clearance` does |

**Waves.** 130 s: 2 `militia_cell` from `north_road` → `souk_alley`. 250 s:
1 `technical` + 1 `moto_rpg` from `kr_west_edge` → `main_street`. 340 s:
2 `militia_cell` from `north_road` → **`ward_north_gate`**, with a `say` — he is
putting rifles into the compound the families are walking into, and he does it
after the clock has run far enough that the player has committed.

**Triggers.** `zone_entered(souk)` → `commit` group `souk` to `souk_alley`.
**`casualties_pct(45)` → `withdraw_to souk_alley`, group `hall_party`** — and
this one is the mission. `first_contact` → `spawn` 1 `rpg_team` at `east_lane`.

**The decision.** *You cannot shoot him out of that building, so what will you
do instead?*

The block commander is garrisoned in a `hall`. The sim will not fire on it
(`selectBuildingTarget`, `sim.ts:2977`), will not breach it (`:3073`), and will
not demolish it on a sapper's initiative (`:4345`). The only ways he dies are:

- **level the hall.** An explicit `demolish` order, from a selection containing
  nothing but demolishers (`sortStructureOrder`) — and there is no `demo_squad`
  in this force, by the hard rule in §5, so this route is *closed by the roster*
  rather than by a warning. If the lead wants it open, adding one costs 30 × 2 =
  **−60 ROE** from a floor of 50, which is the mission;
- **make him come out.** `casualties_pct(45) → withdraw_to souk_alley` queues a
  `move` on group `hall_party`, and a `move` command calls `leaveStructure`
  (`sim.ts:1927`). **Hurt his block enough and he walks into the street, where a
  rifle can reach him.** Patience beats a demolition, and the mechanic says so
  without a word of text;
- **leave him.** He is a **secondary**. The mission is winnable with him alive,
  and a player who takes the souk, gets six people into the ward and drives home
  without touching the hall has done the thing the campaign is about.

Around that sit the two clocks: `capture(souk, 20)` needs 20 **uninterrupted**
seconds with nothing hostile within 6 tiles of a friendly inside a 110-tile zone,
and eight families need six arrivals inside 300 s.

**Recon quality, cashed.** Two tags carry from KR I and both are `ambush` here:
`kr_lane_east`'s rocket team in a one-tile lane, and `kr_watch`'s ATGM at
`ambush(6)` on Main Street. **A player who flew the drone north in KR I and never
sent a carrier east gets both of them live**, at three and six tiles, in a road
with no cover. That is GDD §4's carry-over authored rather than asserted.

**Passive-player loss.** The families never move; `evacuate_before` **fails at
300 s**; defeat.

**Twist candidates.**

- **T-KR7 "You are not allowed to kill him."** The hall garrison above.
  *Expressible today* — one `garrison` stance on a `roe_penalty` 30 structure,
  and the whole behaviour falls out of the sim's existing protected-site rules.
  **This is the strongest thing in the arc and it costs one line of JSON.**
- **T-KR8 "He gives the ward back and takes the souk."** The
  `casualties_pct(45) → withdraw_to souk_alley` above. *Expressible today.*
  Carries `tel_marum/design.md`'s recorded risk for T-C1 — a `withdraw_to` can
  walk a fight out of a scripted plan's reach — so `playtest` re-runs after it
  lands.
- **T-KR9 "His round kills them and your score does not move."** `stepRoe` only
  deducts for a `destroyed` civilian whose `by` is a player unit. Placing a
  family on the axis the enemy's own `charge_squad` runs down makes the point
  with no scripted impact and no engine work. *Expressible today as a placement.*
  Choosing where an **enemy** round lands is still engine work and is recorded at
  `tel_marum/design.md` T8.
- **T-KR10 "The house numbers."** Idit's `debrief` reads the count back: how many
  came in, how many did not, and — if the lead takes O-KR4 — how many buildings
  are still standing. *Expressible today* as `debrief: { victory, defeat }`,
  which is live and outcome-aware since 2026-09-06.

**Story hooks.** This is the mission the whole campaign has been walking toward
and it must not say so. Shai's line is the roster, not the feeling: what he is
bringing, what each thing costs inside the compound, and the one order he gives
about the hall. Idit's is the arithmetic — she knows the number that was left
outside the wire at First Light and she is the only person who will say the new
one out loud. **The `debrief` is the beat**, not the briefing.

---

### 5.4 DA I — `deir_amun_1_recon` · *Read the Ground* · recon · 6 min

**Player starting state.** `player_start [24,44]`. No `resources`.

| unit | count | from | at |
|---|---|---|---|
| `recon_drone` | 1 | — | `[24,43]` |
| `yahalom_squad` | 1 | — | `[24,45]` |
| `inf_squad` | 2 | `from_ledger` | `[22,45]` |
| `at_team` | 1 | `from_ledger` | `[27,45]` |
| `apc_eitan` | 1 | — | `[28,45]` (on the road) |

**No civilians.** Deir Amun is empty and that is the story. `evacuate_before`
appears nowhere in this town.

**ROE.** `enabled: true`. No floor, per the shipped recon convention.

**The failable primary is a `collapse`, in a recon mission**, and that is
deliberate rather than a category error: `phase` is read by nothing in the
runtime, GDD §4's recon is *"mark tunnel mouths"* literally, and this is the
smallest possible version of the mechanic the town's last mission is made of —
**one route, one engineer, find it and put it down.**

`da_tn_west` carries `dig_tiles_per_s: 0.16` and a `digs` assignment, so it
**advances and stamps spoil** as the mission runs. Spoil is the channel anyone
can read (`trailStrengthFor` takes *any* living surface unit of the side), so the
player finds this route by looking at the ground rather than by carrying a
detector — which is exactly the lesson, and the reason the other four routes,
which are `pre_dug` and leave nothing, are a different problem in DA III.

**Enemy stance.**

| tag / group | unit | at | stance | why |
|---|---|---|---|---|
| `da_diggers` | `digger_crew` ×1 | `[9,18]`, `digs: "da_tn_west"` | `hold_position` | **the crew still working, a year after he was taken.** In the gully bed, in dead ground |
| `da_diggers` | `militia_cell` ×1 | `[7,19]` (the shoulder) | `hold_position` | their cover, on the lip where the bed can actually be seen from |
| `da_diggers` | `militia_cell` ×1 | `[21,22]` (hamlet, west lane) | `hold_position` | the third tagged body, and the one that puts the count inside the village |
| `da_hvt_engineer` | `digger_crew` ×1 | `[28,17]` (spoil field) | `hold_position` | the digging chief, on his own spoil. A `locate` **secondary** here; the `eliminate_hvt` in DA III |
| `da_watch_gap` | `rpg_team` ×1 | `[18,11]` (west gap) | `ambush(4)` | the northern gap. A `locate` secondary, and it comes back in DA II as an `ambush` |
| — | `rpg_team` ×1 | `[16,29]` (west ford's north lip) | `ambush(4)` | **the ford, not the crossing** — an ambush on the lip, where the bed below is dead ground |
| — | `militia_cell` ×2 | `in_tunnel: "da_tn_lane"` | — | stocked. They surface at `[27,18]`, in the spoil field, behind anyone who has gone west |
| — | `mortar_crew` ×1 | `[24,2]` (plateau) | `hold_position` | range 16 from y=2 reaches y=18 — the north street and the spoil field, **not** the wadi |

**Waves.** 140 s: 2 `militia_cell` from `gap_west` → `da_west_head`. 260 s:
1 `rpg_team` from `north_road` → `hamlet_lane`.

**Triggers.** `zone_entered(da_west)` → `commit` group `da_diggers` to
`da_west_head` — they defend the work. `first_contact` → `spawn` 1 `militia_cell`
at `wadi_bend`, with an Idit `say`: the bed is a road and it is theirs.

**The decision.** *Which of your two ways west do you send the engineers down?*
The gully bed is **27 tiles on foot from the start line and it is dead ground the
whole way** — nothing on the terrace can see into it once it steps back from the
lip (assertion DA-A3). The shoulder above it is **37 tiles for a vehicle**, ten
tiles further, because the tributary is sealed to anything wheeled or tracked
over fifteen rows and the only crossing is at the top. So:

- **foot down the bed** — short, unseen, and the `rpg_team` on the ford lip and
  the `militia_cell` on the shoulder are both looking straight down into it at
  the two places it can be seen from; or
- **everything round the top** — ten tiles longer for the armour, and the
  engineers arrive with something that can shoot.

And whichever the player picks, the charge itself is 8 s of a stationary,
unshaken team within 2 tiles of the route (`CHARGE_RANGE_SQ` = 2 tiles,
`tunnel_charge_time_s: 8`), which is the longest eight seconds in the arc.

**Passive-player loss.** Nothing finds the route; nothing charges it;
`collapse(da_west)` **fails at 240 s**; defeat. And it fails for a reason the
player can name, which is the standard this pipeline holds: not "you were killed"
but "you did not go and look."

**Twist candidates.**

- **T-DA1 "He is still digging."** A `digger_crew` with a live `digs` assignment,
  a year after the man who ordered it went into a cell. *Expressible today* — the
  `digs` key ships and `beit_sahwan_2_foothold` and `_4_subterranean` both use
  it. Needs one `say` to be legible.
- **T-DA2 "The dirt is the intelligence."** Idit's line on the difference between
  a route you can see the spoil of and one you cannot. *Expressible today* as an
  objective `say`, **and it is true of the map**: two routes carry
  `dig_tiles_per_s` and four carry `pre_dug`, which the schema's own comment says
  never stamps trail.
- **T-DA3 "Behind you, out of the spoil."** The two `in_tunnel` cells on
  `da_tn_lane` surfacing at `[27,18]`, in the spoil field, once the player has
  gone west. *Expressible today* — `in_tunnel` placements vent on their own; this
  is the loop the subsystem was built around.

**Story hooks.** The `dispatch` names the junction: everything that ever came
into the Marj came through here, and after this mission the only road left is the
one east, which is Naharin, which is Act III. Idit's beat is the limit of what
the prisoner bought her — she has his routes on paper and paper is not
identification. Shai's is the engineers: **they walk the last part alone, and he
says how far.**

---

### 5.5 DA II — `deir_amun_2_foothold` · *Set the Charges* · foothold · 7 min · **economy**

**Player starting state.** `player_start [24,44]`.

| unit | count | from | at |
|---|---|---|---|
| `yahalom_squad` | 2 | — | `[26,45]`, `[22,45]` |
| `inf_squad` | 3 | `from_ledger` | `[24,46]` |
| `at_team` | 1 | `from_ledger` | `[28,46]` |
| `mortar_team` | 1 | `from_ledger` | `[20,46]` |
| `apc_eitan` | 2 | — | `[28,44]` |
| `ifv_namer` | 1 | — | `[30,45]` |
| `recon_drone` | 1 | — | `[24,43]` |

`resources`: `logistics_start 400`, `logistics_rate_per_min 120` — the foothold
rate. `structures`: one `camp`, size `[2,2]`, at **`[26,34]`** — open ground on
the wadi's south lip, four tiles from `ford_centre`, eleven from the pump yard,
and in plain view of the hamlet. GDD §4's foothold is *"establish the FOB under
harassment"*, and a camp you can see from the enemy's own street is that
sentence.

**ROE.** `enabled: true`, `flagged_zones: ["hamlet"]`, **`fail_below: 40`**,
`structure_penalty_mult: 1`.

**Enemy stance.**

| tag / group | unit | at | stance |
|---|---|---|---|
| group `yard` | `militia_cell` ×1 | `garrison` the pump house, building `[14,26]` | `garrison` |
| group `yard` | `rpg_team` ×1 | `[18,28]` (outside the yard's only gate) | `ambush(4)` |
| `da_watch_gap` | `rpg_team` ×1 | `[18,11]` | `ambush(4)` — **pre-identified and ambush-forfeited if DA I found it** |
| group `hamlet` | `militia_cell` ×2 | `garrison` `[19,21]` and `[31,20]` | `garrison` |
| group `hamlet` | `mortar_crew` ×1 | `[28,17]` (spoil field, elevation 4) | `hold_position` |
| `da_hvt_engineer` | `digger_crew` ×1 | `[33,22]` | `hold_position` |
| — | `rpg_team` ×2 | `in_tunnel: "da_tn_pump"` | — | **stocked in the route that opens inside the yard the player is told to hold.** They vent at `[20,30]`, in the wadi bed, behind him |
| — | `militia_cell` ×2 | `in_tunnel: "da_tn_yard"` | — | vent at `[33,21]` |
| — | `technical` ×1 | patrol `[41,20] → [41,32]` | `patrol` | the east road |

**Waves.** 110 s: 2 `militia_cell` from `gap_west` → `pump_gate`. 230 s:
1 `rpg_team` + 1 `moto_rpg` from `north_road` → `hamlet_lane`. 340 s:
2 `militia_cell` from `gap_east` → `ford_centre`, with a `say` — they are going
for the camp, not the yard.

**Triggers.** `zone_entered(pump_yard)` → `commit` group `hamlet` to
`pump_gate`. `casualties_pct(40)` → `withdraw_to hamlet_north`, group `yard`.
`timer_s(180)` → `spawn` 1 `charge_squad` at `hamlet_lane`.

**The decision.** *Two primaries on one rectangle, and one of them says stay
while the other says finish.*

`hold_for(pump_yard, 240)` is cumulative and pauses on contest.
`collapse(pump_yard, 240)` is a deadline, and the route's mouth is **inside the
yard** — so the charge has to be worked by a team standing still, unshaken, for
8 s, inside the ground being contested, while the route it is charging is
**stocked with two `rpg_team` who vent behind the player at `[20,30]`.** The yard
has exactly **one gate**, at `[15,28]`, from the south; taking it is a fight down
a one-tile opening into a walled compound.

The two `yahalom_squad` are the whole mission's flexibility. Sending both at the
route finishes it fast and leaves the hold thin; sending one finishes it slowly
under contest, which is the same as not finishing it, because the charge clock
resets when the team moves (`sim.ts:4440`).

**Passive-player loss.** The route stands; `collapse(pump_yard)` **fails at
240 s**; defeat. The `hold_for` never even starts.

**Twist candidates.**

- **T-DA4 "The thing you are holding is a door."** Two `rpg_team` stocked in
  `da_tn_pump`, whose mouth is inside the yard. *Expressible today* — `in_tunnel`
  placements, exactly as `beit_sahwan_4_subterranean` uses them. Needs a `say`
  the first time they vent.
- **T-DA5 "One gate."** The pump yard's single opening at `[15,28]`, which is
  also the tile the `ambush(4)` rocket team is looking at. *Expressible today* —
  it is the map.
- **T-DA6 "They are not coming for the yard."** The 340 s wave routed at
  `ford_centre` rather than at the objective, four tiles from the camp.
  *Expressible today* — a wave `to:` a marker behind the player, the same shape
  as `wadi_halam/design.md`'s T13.

**Story hooks.** The foothold beat in a town with nobody in it: the brigade puts
a camp on a bank, and the only thing that makes it a foothold rather than a
picnic is what is under the ground it is standing on. Idit's beat is the second
route — she has the paper, and the paper says there are more. Shai's is the
engineers again, and the eight seconds.

---

### 5.6 DA III — `deir_amun_3_subterranean` · *All Four* · subterranean · 7 min · **economy**

**Player starting state.** `player_start [24,44]`. `resources`:
`logistics_start 500`, `logistics_rate_per_min 90` — `beit_sahwan_4_subterranean`
carries exactly these, and this is the war's second subterranean mission.

| unit | count | from |
|---|---|---|
| `yahalom_squad` | 2 | — |
| `inf_squad` | 4 | `from_ledger` |
| `at_team` | 1 | `from_ledger` |
| `mortar_team` | 1 | `from_ledger` |
| `apc_eitan` | 2 | — |
| `ifv_namer` | 1 | — |
| `mbt_lavi` | 1 | — |
| `recon_drone` | 1 | — |

**ROE.** `enabled: true`, `flagged_zones: ["hamlet"]`, **`fail_below: 45`**,
`structure_penalty_mult: 1`.

**Enemy stance.**

| tag / group | unit | at | stance | why |
|---|---|---|---|---|
| `da_hvt_engineer`, group `chief` | `digger_crew` ×1 | `[28,17]` (spoil field, elevation 4) | `hold_position` | **the digging chief, on the spoil his own crews raised.** The arc's `eliminate_hvt`. He is on the surface: a buried unit cannot be shot (`sim.ts:2483`) |
| group `chief` | `militia_cell` ×2 | `[26,18]`, `[31,18]` | `hold_position` | his escort |
| group `hamlet` | `militia_cell` ×2 | `garrison` `[19,21]`, `[26,20]` | `garrison` | the village |
| group `hamlet` | `rpg_team` ×2 | `[24,22]`, `[33,24]` | `ambush(3)` | the lanes between the mouths |
| — | `rpg_team` ×2 | `in_tunnel: "da_tn_lane"` | — | vent `[27,18]` |
| — | `militia_cell` ×2 | `in_tunnel: "da_tn_yard"` | — | vent `[33,21]` |
| — | `rpg_team` ×1, `militia_cell` ×1 | `in_tunnel: "da_tn_north"` | — | vent `[34,13]` |
| — | `militia_cell` ×2 | `in_tunnel: "da_tn_east"` | — | vent `[41,19]`, **on the player's own east road** |
| — | `charge_squad` ×1 | `[28,20]` | `ambush(2)` | the one thing that can splash a `yahalom_squad` mid-charge |
| — | `mortar_crew` ×1 | `[24,2]` | `hold_position` | reaches y=18: the spoil field and the north street |
| — | `atgm_cell` ×1 | `[41,14]` | `ambush(6)` | the east road, for the armour |

**Waves.** 120 s: 2 `militia_cell` from `gap_east` → `hamlet_north`. 250 s:
1 `rpg_team` + 1 `technical` from `gap_west` → `hamlet_lane`, with a `say`.
**No third wave.** The mission's pressure is the four clocks and the venting; a
340 s wave on top of them was tempting and would have made the `destroy_all`
secondary a treadmill.

**Triggers.** `zone_entered(hamlet)` → `commit` group `hamlet` to
`hamlet_lane`. `casualties_pct(50)` → `withdraw_to spoil_field_centre`, group
`chief` — he falls back onto his own spoil, which is the one piece of raised
ground on the map and the last thing the player has to take.
`timer_s(210)` → `spawn` 1 `charge_squad` at `hamlet_north`.

**The decision.** *You cannot know all four at once. Which order?*

Four `pre_dug` routes, four mouths at `[20,23]`, `[25,26]`, `[30,22]`, `[33,25]`
— spread across sixteen tiles of a village with one-tile lanes and nine
sight-blocking buildings. Against them: two `yahalom_squad` (`mark_tunnel`,
sight 8, on foot at 0.85 tiles/s) and one `recon_drone` (`mark_tunnel`, sight 16,
air — but on the **foot** field and blinded by buildings exactly like a
rifleman). And the rules:

- a `pre_dug` route **never stamps trail**, so a detector with a clear line is
  the *only* channel;
- **contact decays** the moment nothing senses it — from full confidence to
  `lost` in about 322 ticks, ~16 s;
- a route nobody has found **cannot be charged**;
- the charge is 8 s stationary and unshaken, within 2 tiles.

So the drone is a **pointer, not a scout**: it can hold one route identified
while a team walks to it, and the moment it leaves, that knowledge starts to go.
The player's real choice is the order — the two mouths in the open lanes
(`[20,23]`, `[30,22]`) are cheap to find and are covered by the two `ambush(3)`
rocket teams; the two in the yards (`[25,26]`, `[33,25]`) need somebody to walk
into a courtyard to get a line. And every one he brings down kills whoever was
stocked in it (`collapseTunnel`, `sim.ts:4578`), so **the order he picks decides
which of the four groups gets to vent behind him and which never surfaces at
all.**

The Lavi and the mortar are the temptation and the bill: `gun_120` at
`collateral_risk` 0.55 and `mortar_60` at 0.70 both arm the flagged-zone penalty
at −5 per ten seconds, and there is nothing in the hamlet worth the money.
Rifles and the Eitan's `rws_50` are free.

**Passive-player loss.** No route is ever identified; none is charged;
`collapse(hamlet)` **fails at 300 s**; defeat.

**Twist candidates.**

- **T-DA7 "Everything you know goes cold behind you."** The decay rule, made
  legible. *Expressible today* only as a `say` — the runtime already emits
  `tunnelContact` at `level: 'lost'`, but **a mission trigger cannot fire on a
  `SimEvent`** (§7 G2), so the line has to hang on a `timer_s` or an objective.
  The honest version is Idit saying it once, up front, and letting the player
  discover it.
- **T-DA8 "The last one is under your own road."** `da_tn_east` vents at
  `[41,19]`, on the east road the player's armour uses. *Expressible today* —
  it is the map.
- **T-DA9 "He is standing on it."** The chief on the spoil field, one level
  higher than everything around him because his own crews put it there.
  `casualties_pct(50) → withdraw_to spoil_field_centre` concentrates the last
  fight on it. *Expressible today.* Carries the same `withdraw_to` re-run caveat
  as T-KR8.
- **T-DA10 "The road east."** The `aftermath` on this mission is the Marj's end
  and it points at Naharin. *Expressible today* — `aftermath` is live.

**Story hooks.** The arc's last beat is not the chief and not the collapse: it is
that Deir Amun is empty. Khan Rafid had eight families and a market and a hall;
Deir Amun has nine houses and nobody, and the difference between them is what
Sahim's ground does to the people on it over ten years. Idit's `debrief` is the
count across all six missions. Shai's is the road east, and the fact that he
does not know yet that it is going to take him two more years.

---

### 5.7 Nadir Sahim across the arc, in one table

| mission | what he did | what the player sees |
|---|---|---|
| KR I | chose a town with a clinic, a hall and a market day, and put his fire plan around all three | posts that can see the ward from everywhere and cannot shoot it from anywhere |
| KR II | built a compound the KDF would not fire into, so that it would be the safest place in the enclave — for him | a section walking in through a gate the player is holding |
| KR III | put the man running the block inside the one building the sim refuses to engage | an HVT the player can watch, cannot shoot, and can make walk out |
| DA I | left a crew digging, and they were still digging a year after he was taken | disturbed earth on a gully floor |
| DA II | dug a route that opens inside a walled yard, so that whoever holds the yard is standing on a door | two rocket teams surfacing behind the line |
| DA III | finished four routes before the war and left no spoil on any of them | four things that are only there while somebody is looking |
| — | **is never on either map** | he is in a cell at brigade, and §8 O-KR2 is whether that stays true |

### 5.8 What `playtest` must measure, and in what order

1. **Six passive controls first.** Each must return **DEFEAT**, not `ongoing`.
2. **Then the one measurement that can invalidate the arc's thesis.** Run KR I
   with a probe that shells the Old Town and does **nothing else**. `CIV_FLEE_AT`
   is 0.3 suppression and a fleeing civilian walks to the refuge on its own, so
   **if a player can win the evacuations by frightening people instead of
   fetching them, the whole arc inverts.** The design defends against it by
   siting every enemy indirect weapon short of every civilian group — the
   `mortar_crew` at y=2–3 reaches y=18–19 and the families are at y=16 and y=27 —
   but that is arithmetic, not a measurement. If the probe wins, the fix is to
   move the groups behind buildings and out of splash, **not** to raise the
   count.
3. **Then KR III's ROE, before anything else about KR III.** Run the scripted
   plan and read `roeScore`. Under 65 → fall back to `structure_penalty_mult: 1`
   and `fail_below: 55` (§5.3). This is the only tuning decision in the arc that
   is not already pinned by a shipped precedent.
4. **Then the six scripted plans**, and read the duration ratio only for KR II,
   DA II and DA III — GH-84's split says a ratio is informative only where a
   primary makes the player **endure** a clock (`hold_for`, `survive_until`).
   KR I, KR III and DA I's clocks are deadlines, which are ceilings on the
   allowance rather than floors on the length, and their ratios mean nothing.
5. **The map assertions belong in tests, before any JSON is authored** — §3.1
   KR-A1…A6 and §3.2 DA-A1…A6. **DA-A1 first of all**, because a route no
   detector can ever reach makes DA III unwinnable *and* unlosable, and no other
   gate in the tree catches it.
6. **Re-run after any `withdraw_to` twist lands** (T-KR8, T-DA9).

---

## 6. Asset manifest

**Verdict: zero new art, and this time it holds without an asterisk.** Every
unit, structure, decor family, VFX emitter, portrait and campaign-board marker
this arc needs already ships and was censused this session. The only MISSING rows
are the two map JSONs, which are content the pipeline produces from §3, and the
optional briefing videos.

### 6.1 Units — all PRESENT

| unit | data | mesh | sprite |
|---|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` | `assets/sprites/INF_SQUAD` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` | `assets/sprites/INF_AT` |
| `mortar_team` | `data/units/kdf/mortar_team.json` | `art/meshes/mortar_team.glb` | `assets/sprites/INF_MORTAR` |
| `yahalom_squad` | `data/units/kdf/yahalom_squad.json` | `art/meshes/yahalom_squad.glb` | `assets/sprites/INF_YAHALOM` |
| `sniper_team` | `data/units/kdf/sniper_team.json` | `art/meshes/sniper_team.glb` | `assets/sprites/INF_SNIPER` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | — (sprite-only by design) | `assets/sprites/DRONE_RECON` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` | `assets/sprites/JEEP_HULL` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` | `EITAN_HULL`, `EITAN_TURR` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` | `NAMER_HULL`, `NAMER_TURR` |
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json` | `art/meshes/vehicles/mbt_lavi.glb` | `TNK_HULL`, `TNK_TURR` |
| `militia_cell` | `data/units/enemy/militia_cell.json` | `art/meshes/militia_cell.glb` | `assets/sprites/INF_MILITIA` |
| `rpg_team` | `data/units/enemy/rpg_team.json` | `art/meshes/rpg_team.glb` | `assets/sprites/INF_RPG` |
| `mortar_crew` | `data/units/enemy/mortar_crew.json` | `art/meshes/mortar_crew.glb` | `assets/sprites/INF_MORTAR_E` |
| `digger_crew` | `data/units/enemy/digger_crew.json` | `art/meshes/digger_crew.glb` | `assets/sprites/INF_DIGGER` |
| `charge_squad` | `data/units/enemy/charge_squad.json` | `art/meshes/charge_squad.glb` | `assets/sprites/INF_CHARGE` |
| `atgm_cell` | `data/units/enemy/atgm_cell.json` | `art/meshes/atgm_cell.glb` | `assets/sprites/INF_ATGM` |
| `technical` | `data/units/enemy/technical.json` | `art/meshes/vehicles/technical.glb` | `TECH_HULL`, `TECH_TURR` |
| `moto_rpg` | `data/units/enemy/moto_rpg.json` | `art/meshes/moto_rpg.glb` | `assets/sprites/MOTO_RPG` |
| `loiter_drone` | `data/units/enemy/loiter_drone.json` | — (sprite-only) | `assets/sprites/DRONE_LOITER` |
| `civilians` | `data/units/civilians.json` | `art/meshes/civilians/` ×4 | **none, by design** — absent from `SPRITE_MAP`, so a civilian draws nothing on `?renderer=pixi` or `&nomesh`. Inherited, not new |

**No new unit.** `demo_squad` and `dozer_d9` are deliberately absent (§5's hard
rule); `paramotor` and `gun_truck` are available and unused.

### 6.2 Structures — all PRESENT

| type | sym | used for | mesh | sprite |
|---|---|---|---|---|
| `house` | `h` | both maps' housing | `art/meshes/buildings/house.glb` + `house_wreck.glb` | `assets/sprites/BLD_HOUSE` |
| `shanty` | `s` | both maps | `shanty.glb` + `shanty_wreck.glb` | `BLD_SHANTY` |
| `apartment` | `a` | Khan Rafid's New Quarter and north-east block | `apartment.glb` + `_wreck` | `BLD_APARTMENT` |
| `warehouse` | `w` | both maps' compounds | `warehouse.glb` + `_wreck` | `BLD_WAREHOUSE` |
| `concrete` | `#` | KR's New Quarter block, DA's pump house and water tower | `concrete.glb` + `_wreck` | `BLD_CONCRETE` |
| `wall` | `=` | the ward, the compounds | `wall.glb` + `_wreck` | `BLD_WALL` |
| `clinic` | `k` | **the ward** | `clinic.glb` + `clinic_wreck.glb` | **no sheet** — mesh-only, draws nothing on Pixi/`&nomesh`. **Inherited** (`beit_sahwan_outskirts` already carries 16 `k` tiles); gate `pnpm validate:assets`; owner `blender-art` if the lead wants it closed |
| `hall` | `m` | **the ward** | `hall.glb` + `hall_wreck.glb` | **no sheet** — as above; `beit_sahwan_outskirts` carries 9 `m` tiles |
| `camp` | — | the two `structures[]` field camps | `camp.glb` + `camp_wreck.glb` | **no sheet** — as above; `beit_sahwan_2_foothold` already places one |
| `fence` | `f` | **not used** | `fence.glb` + `_wreck` | no sheet |

### 6.3 Decor, maps, VFX, audio, UI, board

| row | state |
|---|---|
| decor for every symbol used (`. 1 2 r o n ^ b`) | **PRESENT** — `art/meshes/decor/`: `grass_0..2`, `sand_0..2`, `bush_0..2`, `desert_tree_0..2`, `rock_0..2`, `slab_0..2`, `boulder_0..2`. **`o` on an arid map draws `desert_tree`, not `tree`** (`decor-place.ts:212`) |
| `ditch_0.glb` | **PRESENT and unused** — no `d` on either map (§3.3) |
| `data/maps/khan_rafid.json` | **MISSING.** Gate `pnpm validate:data` (schema, map bounds, palette, and the `raze`/marker cross-checks). Pipeline: hand-authored JSON by `mission-author` from §3.1's grid, markers and zones |
| `data/maps/deir_amun.json` | **MISSING.** Same gate and pipeline, from §3.2's grid, elevation grid, markers, zones and six `tunnels` entries |
| per-mission map variants | **not used** in the recommended plot — O-KR6 |
| VFX | **PRESENT** — `data/vfx/` (15 emitters). This arc needs `tunnel_collapse.json`, `structure_collapse.json` and `shell_impact.json`, all present. Nothing new |
| audio | **PRESENT for weapons** — `assets/audio/` (11 weapon/impact sets + `music/`). **MISSING:** any voice, EVA or bark line. Gate `pnpm validate:audio` — which **fails by construction** for a voice file today (`KNOWN_EVENTS` is six weapon events); owner GH-110. Nothing in this arc depends on it |
| portraits | **PRESENT** — `assets/ui/portraits/shai_hammai.png`, `idit_zohar.png`, `nadir_sahim.png` (plus the two other villains) |
| `briefing_video` | **MISSING and optional** — `assets/video/` holds `tel_marum_2_briefing.mp4` and `tel_marum_3_briefing.mp4` only. `validate_data.mjs` requires the file to exist if the field is declared. See O-KR7 |
| **campaign board** `art/meshes/campaign/sahar_basin.glb` | **PRESENT and already correct.** Verified this session by reading the GLB's own strings: it carries `rl_town` marker nodes for `khan_rafid` and `deir_amun` (and `qarn_hadid`). `tools/campaign/export_meshy_world.py`'s `TOWN_SITES` already lists both under `marj`. **No re-export, no `blender-art` work, no red unit test.** This is the row Qarn Hadid had to pay and this arc does not |
| campaign board, flat (Pixi) path | **PRESENT, no art needed** — `ui/worldmap.ts` draws both pins from `world.json`'s existing `at` values over `assets/campaign/world_map.png` |
| `art/blend/` sources | censused in the **main** checkout (`/Users/ilpinto/dev/roaring-lions`), where it is complete: `KDF/`, `enemy/` (including `Nadir Sahim/`, `clinic/`, `civic hall/`), `civilian/`, `map/`, `terrain object/`, `desert tile/`, `rock tile/`, `terrain tiles /`, `effects/`. **Nothing in this arc needs an export from any of it** |

---

## 7. Engine, schema and content changes

### Changes this arc requires

| # | change | file | gate / owner |
|---|---|---|---|
| **C1** | **no schema edit.** `khan_rafid` and `deir_amun` are **already** in `mission.schema.json`'s `town` enum (censused: the enum holds all seven towns). GDD §2's town list **already names both**. Neither file changes | — | — |
| **C2** | fill in the two empty mission arrays: `regions[marj].towns[khan_rafid].missions = ["khan_rafid_1_recon","khan_rafid_2_foothold","khan_rafid_3_clearance"]` and `[deir_amun].missions = ["deir_amun_1_recon","deir_amun_2_foothold","deir_amun_3_subterranean"]`. **Both town entries already exist with `at` pins** (`khan_rafid [113.7,385.5]`, `deir_amun [281.4,480.9]`) that already pass `validate_data.mjs`'s point-in-polygon test against the `marj` outline, because they ship today | `data/campaign/world.json` | `pnpm validate:data` · `mission-author` |
| **C3** | **the one decision that changes the campaign's shape.** Sur's `unlock.after_mission` is `beit_sahwan_4_subterranean` today. **Recommended: move it to `deir_amun_3_subterranean`.** Naharin's stays `umm_zeitoun_4_clearance`. Nothing else in the tree uses `after_mission` — censused: the only two occurrences in all of `data/` are the two region gates, and every KDF unit unlock is `roe_rating_min` | `data/campaign/world.json` | `pnpm validate:data` · **the lead**, §8 O-KR1 |
| **C4** | **required, not optional.** `commander.json`'s Captain entry reads `until_mission: "beit_sahwan_4_subterranean"`. Campaign order is the flattened `world.json` order (`commanderRankFailures`, `tools/validate_narrative.mjs:140`), so the moment Khan Rafid and Deir Amun gain missions, Shai is a **Major** for all six of them unless this moves to **`deir_amun_3_subterranean`**. The brief fixes him as a Captain throughout; the Major entry's `until_mission` (`umm_zeitoun_4_clearance`) is unchanged and still later | `data/campaign/commander.json` | `pnpm validate:data`, `pnpm test` · `mission-author` |
| **C5** | two new map files, from §3.1 and §3.2 | `data/maps/khan_rafid.json`, `data/maps/deir_amun.json` | `pnpm validate:data` · `mission-author` |
| **C6** | six new mission files | `data/missions/khan_rafid_{1_recon,2_foothold,3_clearance}.json`, `data/missions/deir_amun_{1_recon,2_foothold,3_subterranean}.json` | `pnpm validate:data` · `mission-author` |
| **C7** | register 2 maps + 6 missions | `packages/data/src/index.ts` (8 imports + 8 registry entries) | `pnpm test`, `tsc` · `mission-author` |
| **C8** | the assertions of §3.1 and §3.2 | `tools/src/khan_rafid_doctrine.test.ts`, `tools/src/deir_amun_doctrine.test.ts` (both new) | `pnpm test` · `level-scripter` |
| **C9** | six plans and six passive controls | `tools/src/backtest/playtest.ts` | `pnpm playtest` (CI, `gates` job) · `playtest` |
| **C10** | **no campaign-board work.** Both marker nodes are already in the shipped GLB | — | — |

### Gaps this arc surfaces

| # | gap | found where | owner / smallest fix |
|---|---|---|---|
| **G1** | **`intel.marked_positions` cannot pre-reveal a tunnel route**, and after the subsystem's playtest it should not — it reveals units by tag, and tunnel visibility is live and decays. So **GDD §4's "thorough recon → tunnel mouths pre-marked" is not literal**, and Deir Amun leans on that deliberately: DA I's recon buys the *ambushers* over the routes, not the routes. This is CLAUDE.md's own recorded finding and it is repeated here because the sentence in the GDD is the one an author reads first. **Fix the GDD sentence, not the engine** | `mission.ts:942`, GDD §4 | `narrative-designer` — one line in GDD §4 |
| **G2** | **No trigger fires on a `SimEvent`, and none re-arms.** The runtime emits `tunnelContact` at `suspected` / `identified` / `lost`, which is precisely the beat DA III is about, and a mission cannot hear it. Every "and then this happens" in §5 is therefore a one-shot `zone_entered`, `timer_s` or `casualties_pct` | `mission.ts` `stepTriggers` | `sim-guard` — `storyline.md` G6's `on.kind: "sim"`; recorded, not requested |
| **G3** | **A wave's `from` resolves as a map marker only**, while `mission.schema.json` still promises *"Spawn point or tunnel id. Tunnels keep producing until located and collapsed."* Deir Amun is the map where that sentence would actually be worth building — six routes, four of them the objective — and it works around it with `in_tunnel` garrisons instead, exactly as Beit Sahwan IV does | `mission.schema.json` vs `mission.ts:1307` | `sim-guard` — correct the text or build the feature |
| **G4** | **No `intel_rate_per_min` exists anywhere in the campaign**, so Idit's "certainty costs" register still has no economy behind it. Four of this arc's six missions declare logistics only | `data/missions/*.json` | `mission-author`, campaign-wide, out of scope here |
| **G5** | **`starting_force` ignores unit unlocks** (known hole). KR III fields `mbt_lavi` (ROE 55) and `sniper_team` (60); DA I–III field `yahalom_squad` (55). Act I's measured plan ratings are 75/100/100/94/98, so a campaign arriving here honestly holds all three — recorded, not exploited | `mission.ts` `spawnPlacement` | `sim-guard`, campaign-wide |
| **G6** | **`stepDemolition`'s automatic branch is an unbounded ROE leak on a dense map.** A `canDemolish` unit that merely halts within `DEMO_RANGE_SQ` of an unprotected, unoccupied, non-`low_profile` structure that is not its own side's camp levels it with no order. On a 40-building town at `structure_penalty_mult: 2` that is −12 per house the player never asked for and cannot attribute. **This arc's answer is a roster rule (§5), not an engine ask** — but it is the reason the rule exists, and the day someone adds a `demo_squad` to a Khan Rafid mission it will bite | `sim.ts:4336` | recorded. If it is ever wanted as an engine fix, the shape is the camp guard's: an opt-out on the mission or the structure |
| **G9** | **`validate_data.mjs` does not check that a `capture` or `hold_for` zone contains a single passable tile.** It checks a `raze` zone for `low_profile` / protected / `per_tile` structures and a `collapse` zone for tunnel mouths, and checks a hold zone for nothing. A zone drawn tightly round a walled compound — which is the natural thing to draw — produces an objective `livingIn(zone, 0)` can never satisfy: **unwinnable and unlosable at once**, the same trap class the `raze` check exists to stop. Found by hand this session on a first draft of `store` (§3.1 KR-A7) | `tools/validate_data.mjs` vs `mission.ts:1556` | **CLOSED the same day** — the check landed exactly as proposed (zone tiles against the map rows plus `mission.structures[]`, with `b`/`d` counted passable since they are open ground on foot); proved on a probe whose `capture` zone was drawn over two house tiles, and all 102 shipped files still pass |
| **G7** | **`hall`, `clinic` and `camp` have no sprite sheet**, so on `?renderer=pixi` or `&nomesh` the ward draws two invisible buildings and the field camps draw nothing. **Inherited** — `beit_sahwan_outskirts` already carries 16 `k` and 9 `m` tiles and `beit_sahwan_2_foothold` already places a camp — but this arc is the first to make an *invisible* building the subject of an objective, which raises it from cosmetic to confusing | `packages/app/src/main.ts` `SPRITE_MAP` vs `mesh-catalogue.ts` | `blender-art` + `render-vfx`; gate `pnpm validate:assets`. §8 O-KR8 |
| **G8** | **A collapsed route is alive again in the next mission on the same map.** All of a map's `tunnels` are registered for every mission that uses it (`playtest.ts:36`, `MissionRuntime`'s `ctx.tunnels`), so `da_tn_west` and `da_tn_pump` — brought down in DA I and DA II — stand again in DA III. They are harmless there: no objective names them and no placement stocks them, so an unstocked route with no digger is inert geometry. But a player who walks a Yahalom past one sees a route he collapsed last mission | `mission.ts` / `sim.addTunnel` | recorded. The zero-engine fix is map variants (`deir_amun_3.json` with a shorter `tunnels` array), which `map-variants-design.md` §3 currently forbids because indices are positional — so the honest answer is either a variant with an explicit exemption, or leaving it. §8 O-KR9 |

---

## 7a. What the ladder measured, once it was playable (2026-09-08)

`pnpm playtest` carries six passive controls and six scripted plans. Every
passive run loses on its own clock (4/5/5/4/4/5 min) and every plan wins
(0.5 / 4.4 / 2.8 / 1.0 / 4.8 / 1.4 min, ROE 100 / 95 / 86 / 100 / 70 / 85).
Two findings contradict this document's own framing and are recorded here
rather than quietly fixed.

**O-KR4 is settled by measurement: KR III keeps `structure_penalty_mult: 2`
and `fail_below: 50`.** The scripted plan rates **86**, well over the 65 the
gate asked for, so the fallback (mult 1, floor 55) was not taken and its
drafted briefing clause stays unused. The 86 is one shanty at −4, the Lavi's
own splash during the souk fight, plus −10 of flagged-zone fire reaching
into the ward. The hall itself was never hit: `roe_penalty` 30 keeps it off
`selectStructureTarget` entirely, exactly as §3.1 argued.

**The rising civilian count bites in ONE mission, not three.** §1 sells the
spine as escalating pressure across the town; measured, KR I's `get_two_in`
and KR II's `get_four_in` are both nearly free — `CivilianFlight`'s 4-tile
shepherd radius means a plain mass attack-move toward the ward incidentally
boards families nobody ordered anywhere, so KR I's real gate is recon
sequencing and KR II's is attrition discipline. Only **KR III** holds the
thesis cleanly: a plan that takes the souk first and detaches transports
afterwards wins the fight (souk taken, HVT dead) and **loses the mission**
on the 300 s deadline. The arc still escalates; it escalates in the last
mission rather than across all three, and a future pass that wants the
design's own curve should tighten KR II's count or its refuge distance
rather than add a fourth mission.

**Deir Amun's sequencing is forced by asset scarcity, not by the decay
timer.** Two `mark_tunnel` carriers against four routes cannot hold all four
identified at once whatever the timer does, and the winning plan never once
triggered the 16 s decay: each team holds its own mouth while charging it.
What actually breaks a plan is adjacent and sharper, and it is worth
knowing before authoring any charge: **a `move` or `attackMove` order
silently clears `chargeOrder`**, so retasking a team to its second mouth
before the first charge completes cancels that charge with no warning and
the route never comes down. That is the naive plan's exact failure and it
costs `da_tn_north` and the `all_four` deadline.

---

## 8. Open decisions for the lead

| # | decision | recommendation |
|---|---|---|
| **O-KR1** | **Does Sur's `unlock.after_mission` move to `deir_amun_3_subterranean`?** Today it is `beit_sahwan_4_subterranean`, so Sur opens after five missions. Moving it makes Act I **eleven** missions before the second front opens, and a player who stalls on Khan Rafid III's ROE floor has nothing else to play. Leaving it means a player can go north with the Marj two-thirds done, which is exactly what D8 and D10 exist to prevent — and the same reasoning `storyline.md` §3.4 C2 used to put it where it is | **Move it.** The region gate is the only thing enforcing the fixed sequence, and "you may not go north until the Marj is finished" is the sentence Act I is about. But this is the one decision here that changes the campaign's shape, and the counter-argument is real |
| **O-KR2** | **Does Nadir Sahim's end move?** He is captured at `beit_sahwan_4_subterranean` today, which is now mid-act. Option C in §1 re-briefs that mission so the shaft head holds his deputy and moves his own capture to Deir Amun III | **No — keep D-KR1's reading.** The Marj's villain is a man whose weapon is ground, and ending the front on the ground is better than ending it on him twice. But it is D4's letter, it is the lead's rule, and re-opening one landed mission is a smaller price than it looks |
| **O-KR3** | **Three missions per town (A), four on one town (B), or the split (C)?** | **A.** Take B if the lead wants the beat without the second map and will accept an unfinished Marj and the war's third build-up |
| **O-KR4** | **`structure_penalty_mult: 2` on Khan Rafid III?** Never used anywhere; it is the dial that literally scores how much of the town is standing (−12 a house, −28 an apartment, −456 for all of it), and it is the only untested number in the arc | **Yes, gated on measurement.** `playtest` reads the scripted plan's ROE first; under 65 → mult 1 and `fail_below` 55. **Do not raise both dials at once** |
| **O-KR5** | **Is `evacuate_before` as a primary in all three Khan Rafid missions too much?** Three missions in a row where the player loses on a civilian clock is a lot of the same pressure | **Keep all three.** It is the distinguishing mechanic and one asking is a scene, not an arc. If `playtest` says it grinds, the dial is **KR II's count (4 → 3)**, not the presence of the objective |
| **O-KR6** | **Per-mission map variants for Khan Rafid?** The recoverable half of Option B: `khan_rafid_2` and `khan_rafid_3` in the shipped variant pattern, showing the town degrading — barricades after I, rubble and a closed lane after II | **Not in the first commit.** Author the base map and six missions, get `playtest` green, then add the variants as a second pass. They change no phase, no objective, no ledger and no economy, so they cannot break anything that is already measured |
| **O-KR7** | **A `briefing_video` for any of the six?** Tel Marum II and III have one each | **One, on `khan_rafid_3_clearance`.** It is the arc's beat and the campaign's emotional centre. None on the other five |
| **O-KR8** | **Close G7 — sprite sheets for `hall`, `clinic` and `camp`?** This arc makes an invisible building the subject of an objective on the Pixi path and under `&nomesh` | **Yes, but not in this arc's commit.** It is three sheets through `validate:assets` and it fixes three shipped maps at the same time |
| **O-KR9** | **G8 — a route collapsed in DA I standing again in DA III.** Fix with a `deir_amun_3` variant carrying a shorter `tunnels` array, or leave it? | **Leave it and record it.** `map-variants-design.md` §3's invariant is that `tunnels` blocks are copied byte-identical because `collapse` resolves routes by zone and indices are positional; breaking that for cosmetics is a bad trade |
| **O-KR10** | **Deir Amun II is a foothold, not a build-up** — the cost `storyline.md` §4.2 asks the lead to accept. **My position: keep it a foothold, and the reason is mechanical before it is narrative.** GDD §4's foothold is *"establish the FOB under harassment. Engineering, supply corridor. Defensive, time-pressured"*, which is a literal description of DA II: a camp on a bank, two engineers, one gate, and a route that opens inside the ground you are holding. A build-up is *"the one phase where the player has breathing room"*, and there is none here.<br><br>**And the story cost of overruling me is smaller than the storyline claims, so the lead should know the real number.** The protected line does not live in `wadi_halam_3_counterraid`'s briefing; it lives in its `debrief.defeat` — *"We spent the only quiet week of the war on it"* — one string in one JSON file. And `umm_zeitoun_2_buildup` already made the war's build-up count two, so the fact is half-spent already.<br><br>**If overruled:** DA II becomes `deir_amun_2_buildup`, phase `buildup`, `logistics_rate_per_min` 120 → **200** (the shipped buildup band is 150–200), the ladder stays 2 → 4 → 6 (still ascending), `wadi_halam_3_counterraid.json`'s `debrief.defeat` is rewritten in the same commit, and `playtest` re-runs DA II and DA III | **Keep it a foothold** |

---

## Appendix — the census and the measurements this was written from

**Census, run this session in `/Users/ilpinto/dev/roaring-lions-story` unless
noted.** `data/units/kdf` (14) and `data/units/enemy` (15) plus
`data/units/civilians.json`; `art/meshes/` (17 infantry GLBs, 9 vehicles,
20 building GLBs, 26 decor GLBs, 4 civilians, `campaign/sahar_basin.glb`);
`assets/sprites` (40 sheets); `assets/audio` (11 weapon/impact sets + `music/`);
`assets/ui/portraits` (5); `assets/video` (2); `data/vfx` (15);
`data/structures.json` (10 types, with each type's symbol, hp, `roe_penalty`,
`garrison_slots`, `low_profile` and `per_tile` read individually);
`data/maps` (23 files, 12 of them per-mission variants); `data/missions` (21);
`data/campaign/world.json`, `countries.json`, `commander.json`;
`data/schemas/mission.schema.json` (top-level keys, the `town` enum, `roe`,
`resources`, objective properties, the `say` shape, `placement`, `starting_force`,
`structures`, `map`, `enemy`); `data/schemas/map.schema.json` (`tunnels`);
`data/schemas/world.schema.json`. `art/blend/` was censused in the **main**
checkout (`/Users/ilpinto/dev/roaring-lions`), where it is complete.

**Runtime facts were grepped, not remembered.** The nine live objective kinds
(`mission.ts:323`) and each one's completion and failure rule (`stepObjectives`,
`:1506`); the four trigger conditions and the **six** `do` kinds (`commit
withdraw_to spawn reinforce dismount remove`, `:1371`–`:1442`); `contestedIn`'s
side-1-and-side-0-both-inside rule and `CONTEST_RADIUS_SQ` = 6 tiles (`:1325`);
`evacuate_before`'s refuge-inside-zone throw (`:748`); `collapse`'s
mouth-inside-zone rule and its registration check (`:775`); `raze`'s
start-of-mission snapshot; every branch of `stepRoe` and its four constants
(`DANGER_CLOSE_SQ` 2 tiles, `HEAVY_COLLATERAL` 0.5, `STRUCTURAL_COLLATERAL` 0.3,
`ZONE_DEDUCT_COOLDOWN` 200 ticks, `:1195`–`:1290`); `CivilianFlight`'s two
triggers to move (`CIV_FLEE_AT` 0.3 suppression, `SHEPHERD_RADIUS_SQ` 4 tiles)
and its transport boarding (`civilians.ts`); `PROTECTED_ROE` = 20
(`structures.ts:135`) and its three consumers — `selectBuildingTarget`
(`sim.ts:2977`), `stepBreach` (`:3073`), `stepDemolition`'s automatic branch
(`:4345`) — plus `sortStructureOrder`'s demolishers-only rule
(`app/src/input/intents.ts`); `markerSeesRoute`'s `losRay` gate (`:2809`);
`trailStrengthFor`'s any-unit observer set (`:2773`); the contact-decay branch
and its "IDENTIFIED included" comment (`:2728`); `CHARGE_RANGE_SQ` = 2 tiles
(`tunnels.ts:45`) and `stepTunnelCharge`'s "a route nobody has found cannot be
charged" (`:4423`); `collapseTunnel` killing its garrison and a destroyed
building killing its own (`:4578`); `applyDamage`'s refusal to aim at side > 1;
a `move` command calling `leaveStructure` (`:1927`); `moveDomain` giving air the
foot field (`:488`); `TERRAIN_LEGEND` and the contiguous-run structure rule
(`packages/data/src/map.ts`); `commanderRankFailures`' flattened-world-order rule
(`tools/validate_narrative.mjs:140`); and `validate_data.mjs`'s
one-mission-one-town and town-pin-inside-country checks (`:733`, `:818`).

**The campaign board was verified from the asset's own bytes**, not from the
exporter: `strings art/meshes/campaign/sahar_basin.glb` returns `rl_town` ×7 and
both `khan_rafid` and `deir_amun`, so `world-scene.test.ts`'s "finds a marker for
every town" passes with the two towns populated and no re-export is needed.

**The two grids in §3 were built and checked by script this session**, not drawn
by eye: 48 rows of 48 characters each, every character in the legend, structure
components counted by flood fill (Khan Rafid 40 non-wall structures + 57 `wall`
tiles; Deir Amun 13 + 34), every marker, tunnel mouth and vent tile confirmed to
be open ground, and connectivity confirmed by an 8-connected tile BFS on both the
foot mask and the vehicle mask (`b`/`d` removed). **Every distance quoted in §3 is
a BFS tile count on a draft grid.** It is not a `FlowField` cost: it ignores
`COST_DIAG`, ignores `UPHILL_PER_LEVEL`, and therefore understates every route
that climbs — which on Deir Amun is most of them. The assertions in §3.1 and
§3.2 are what ship, and `level-scripter` measures them the way
`tools/src/qarn_hadid_relief.test.ts` and `tel_marum_doctrine.test.ts` do: through
`FlowField.compute(mask, elevation, gx, gy)` and `sim.debugDetection(a, b)`, each
positive paired against a control built from the same map with one thing removed.

**Not verified this session, and flagged as such:** whether either new map's
draft grid survives `pnpm validate:data`'s palette and bounds checks (it has
never been parsed by `parseMap`), and whether the ROE numbers in §5.3 are
reachable by a real plan — that is §5.8 item 3, and it is the reason O-KR4 is
gated on a measurement rather than settled here.
