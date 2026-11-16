# The Long Ground: campaign-arc outline

**Date:** 2026-11-15 · **Author:** `campaign-historian` · **Status:** proposal. **Nothing
here is canon until the lead signs §11.** It is written against the contract in
`docs/campaign/README.md`, on `main` at `036f7bd8a`.
**Reads:** `dossier.md` (cited by beat ID only) and `transposition.md`.
**Hands to:** `campaign-designer` (one Mission Design Document per town), then
`narrative-designer`, `level-scripter` and `mission-author`. This file writes no mission
JSON and no player-facing line.

**The arc in one sentence.** *The Marj is taken in a winter, held through a spring, left
on a line in the second autumn, and the war ends when the guns stop there and the last of
the taken walk back across it.*

---

## 0. What is proposed, in short

- **Keep** the twelve shipped Marj missions, Shai Hammai, Idit Zohar and Nadir Sahim's end
  at Beit Sahwan IV.
- **Add 19 missions: 18 in four new towns, and a fourth Khan Rafid mission.**
  - Act I's first winter (real phases 1 to 3) gains **Qasr Liwan** (5 missions), **Khan Rafid IV**
    and **Bir Tarsha** (5).
  - A new **Act IV, the return** (real phases 4 and 5), after Naharin, holds **Jurf Nadi** (4)
    and **Mina Sahil** (4).
- **Sur and Naharin are unchanged.** The war order D10 already leaves the Marj's last
  two phases for after the other fronts. The record has the same shape: a winter's
  offensive, a withdrawal, then a return to reconstituted ground. The arc keeps that
  shape and asserts no real parallel.
- **The lead's dozer mission** is **Bir Tarsha IV, *The Blade Line*** (§4). It is the first
  shipped use of `escort`, and with *The Pause* the first of `no_collateral_above`.
- **Cost:** 19 missions, 4 new towns (each a schema enum value, a `world.json` entry and a
  GDD §2 line), about 19 map files on 4 new base maps plus one Khan Rafid variant, no new
  units, and one optional new structure. The engine work is listed in §9. Four items there
  matter before authoring, and none blocks the arc: every mission has a fallback that runs
  today.

---

## 1. Placement against the existing acts: three plots

| | **Plot A: *The Long Ground*** (RECOMMENDED) | **Plot B: *One Winter*** | **Plot C: *The Return Only*** |
|---|---|---|---|
| shape | Act I extended (phases 1 to 3); Acts II and III unchanged; new Act IV (phases 4 and 5) | every phase in Act I, before Sur, compressed | Act I unchanged except re-briefs; all new content after Naharin |
| new missions | 19 | 12: Qasr Liwan ×4, KR IV, Bir Tarsha ×4, and Jurf Nadi and Mina Sahil folded into one three-mission town (the siege, the city, the Line) after Bir Tarsha, before Sur | 18: all four new towns, Qasr Liwan included, after Naharin; KR IV dropped |
| the record's order | kept: entry, the south, the border, then the return and the line | kept, compressed: the siege, the city and the line are one town | broken: the city's ring, pause and clinic yard (Qasr Liwan) come after the other fronts |
| rank (`commander.json`) | L-3 default: Captain through the extended Act I (the Captain entry's `until_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`), Major in Sur, Lt Col in Naharin, and **Colonel through Act IV**: Act IV is the brigade he is handed. Promotions stay at act boundaries | Captain for about 26 missions in a row, tutorial included. The ladder's structure is untouched, and the act runs very long | the ladder is untouched; Colonel through the return |
| `world.json` chain | Marj towns: Beit Sahwan, **Qasr Liwan**, Khan Rafid, Deir Amun, **Bir Tarsha**. Sur unlocks after `bir_tarsha_5_subterranean` (was `deir_amun_3_subterranean`). Naharin is unchanged. **Act IV needs a region that returns to the Marj: G-14** | Sur's unlock moves to the last Bir Tarsha mission | Act IV as in A |
| the ending | moves from `wadi_halam_5_depot` to `mina_sahil_4_clearance` (L-6) | stays on `wadi_halam_5_depot` | moves, as in A |
| what it costs that is landed | the GDD §11 "end of the war is said once" beat moves; Wadi Halam V's aftermath is re-written; `commander.json` ranks move | the least | the clinic, ring and pause beats lose their chronology |

**Recommendation: Plot A.** It is the only plot that tells *the whole story* the lead asked
for in the order it happened. Its one structural cost, a return to a region (G-14), is
app work and not a redesign. Plot B is the fallback if the lead wants the ending untouched;
Plot C is listed for completeness, and I recommend against it.

**On the act count.** Under Plot A the war has four acts: I the Marj (extended), II Sur,
III Naharin, and IV the return. L-3 offers the alternative of splitting Act I in two, with a
Major promotion between Qasr Liwan and Khan Rafid. That makes five acts, renumbers Sur,
Naharin and the return, and re-briefs every rank line in `storyline.md` §2.1. The default
keeps four acts.

---

## 2. The ladder at a glance

Shorthand for the ledger keys, all of which the runtime produces today (`jq -r
'.ledger.produces[]' data/missions/*.json`): **R** `roster.surviving_units`, **M**
`roe.mission_ratings`, **C** `campaign.completed_missions`, **X**
`campaign.mission_results`, **I** `intel.marked_positions`, **E**
`civ.settlements_evacuated`, **H** `civ.hostages_recovered`.

Every mission declares `time_limit_s` at twice its `target_minutes` (720 for 6, 840 for 7).
The **failable primary** is in bold on every row, because a passive player must lose,
never stall (README rule 4).

### Act I: the first winter (Plot A)

| # | id · name | phase | min | primaries | secondaries | requires / produces | econ | beat |
|---|---|---|---|---|---|---|---|---|
| | `beit_sahwan_*` ×6 (shipped) | | | | | as shipped | | P0, P1-a, P1-b |
| 1 | `qasr_liwan_1_recon` · *One House* | recon | 6 | `locate` · `ql_house_guard`; **`evacuate_before` · `ql_extract` (count 1, `hostages`, 300 s)**; **`no_collateral_above` 10** | `locate` · `ql_ring_posts` (carries) | R / R M C X I H | n | R1 |
| 2 | `qasr_liwan_2_foothold` · *The Ring* | foothold | 7 | `hold_for` · `ring_north` 240; `hold_for` · `the_cut` 240; **`evacuate_before` · `cut_refuge` (residents, 300 s)** | `capture` · `coast_road` 15 | R I / R M C X E | y | P1-c, P1-d |
| 3 | `qasr_liwan_3_buildup` · *The Pause* | buildup | 7 | **`evacuate_before` · `handover` → `pause_refuge` (`hostages`, 330 s)**; `hold_for` · `staging` 300; **`no_collateral_above` 10** | `capture` · `water_point` 15 | R / R M C X H | y | P1-f |
| 4 | `qasr_liwan_4_clearance` · *The Clinic Yard* | clearance | 7 | `capture` · `clinic_yard` 15; **`evacuate_before` · `clinic_refuge` (300 s)**; **`collapse` · `clinic_yard` 360**; **`no_collateral_above` 10** | `eliminate_hvt` · `ql_yard_commander` | R I / R M C X E | n | P1-e |
| 5 | `qasr_liwan_5_subterranean` · *The Pumps* | subterranean | 7 | `hold_for` · `pump_yard` 180; **`collapse` · `shore_grid` 360**; **`no_collateral_above` 10** (the relief depot) | `locate` · `ql_deep_crew` (carries); `survive_until` 300 | R I / R M C X I | y | T3, T4, P1-g, P1-i |
| | `khan_rafid_1..3` (shipped; KR I re-briefed) | | | | | as shipped | | P2-a, P2-b |
| 6 | `khan_rafid_4_clearance` · *Second Floor* | clearance | 6 | `eliminate_hvt` · `kr4_guard`; **`evacuate_before` · `kr4_extract` (count 3, `hostages`, 300 s)**; **`no_collateral_above` 12** | `capture` · `souk_corner` 15 | R I / R M C X H | n | R2 |
| | `deir_amun_1..3` (shipped; DA III aftermath re-written) | | | | | as shipped | | P2-c, P2-d, T5 |
| 7 | `bir_tarsha_1_recon` · *The Gate Road* | recon | 6 | `locate` · `bt_gate_watch`; **`evacuate_before` · `gate_refuge` (residents, 300 s)** | `locate` · `bt_works_crew` (carries) | R / R M C X I E | n | P3-a |
| 8 | `bir_tarsha_2_foothold` · *The Gate* | foothold | 7 | `hold_for` · `the_gate` 240; **`evacuate_before` · `safe_quarter` (residents, 300 s)** | `capture` · `terminal_roof` 15 | R I / R M C X E | y | P3-a |
| 9 | `bir_tarsha_3_clearance` · *Two Houses* | clearance | 6 | `eliminate_hvt` · `bt3_guard_east`; `eliminate_hvt` · `bt3_guard_west`; **`evacuate_before` · `bt3_extract` (count 5, `hostages`, 300 s)**; **`no_collateral_above` 15** | none | R I / R M C X H | n | R3 |
| 10 | **`bir_tarsha_4_clearance` · *The Blade Line* (THE DOZER ESCORT)** | clearance | 7 | **`escort` · `blades` → `far_gate`**; **`raze` · `fence_works` 390**; **`collapse` · `fence_works` 390**; **`no_collateral_above` 12** | `capture` · `berm_crest` 15 | R I / R M C X | y | P3-b, T6, T7, T8 |
| 11 | `bir_tarsha_5_subterranean` · *Under the Fence* | subterranean | 7 | **`collapse` · `fence_road` 390**; **`no_collateral_above` 10** | **`evacuate_before` · `chamber_refuge` (count 1, `hostages`, 330 s)** (carries); `eliminate_hvt` · `bt5_block_commander` | R I / R M C X I H | y | P3-c, P1-h, R4, P3-e |

Phases ascend in every town: Qasr Liwan 2, 3, 4, 5, 6; Khan Rafid 2, 3, 5, 5; Bir Tarsha 2,
3, 5, 5, 6. Bir Tarsha V's rescue is a **secondary**, so the mission's only failable
primary is the collapse. The rescue is the third star and the arc's hardest ordering
decision (§3, mission 11).

### Act IV: the return (Plot A)

| # | id · name | phase | min | primaries | secondaries | requires / produces | econ | beat |
|---|---|---|---|---|---|---|---|---|
| 12 | `jurf_nadi_1_recon` · *Ground Taken Twice* | recon | 6 | `locate` · `jn_cells` (count 4); **`evacuate_before` · `order_route` (residents, 300 s)** | `locate` · `jn_rigging_crew` (carries) | R / R M C X I E | n | P4-a, P4-b |
| 13 | `jurf_nadi_2_foothold` · *The Checkpoint* | foothold | 7 | `hold_for` · `checkpoint` 240; **`evacuate_before` · `south_refuge` (residents, 300 s)** | `capture` · `orchard_edge` 15 | R I / R M C X E | y | P4-b, P4-c |
| 14 | `jurf_nadi_3_clearance` · *Rigged Streets* | clearance | 7 | `capture` · `camp_square` 20; **`raze` · `jn_workshop` 330**; **`no_collateral_above` 10** | `eliminate_hvt` · `jn_charge_chief` | R I / R M C X | n | P4-c |
| 15 | `jurf_nadi_4_subterranean` · *The Complex* | subterranean | 7 | **`collapse` · `fence_routes` 360**; **`raze` · `complex_yard` 360** | `survive_until` 300 | R I / R M C X I | y | P4-d, P4-e |
| 16 | `mina_sahil_1_buildup` · *Held Ground* | buildup | 7 | `hold_for` · `held_east` 240; `hold_for` · `held_south` 240; **`raze` · `firing_line` 390**; **`no_collateral_above` 12** | `capture` · `water_tower` 15 | R I / R M C X | y (income zones) | P5-a, I-1 |
| 17 | `mina_sahil_2_clearance` · *The City Edge* | clearance | 7 | `capture` · `ring_road` 20; **`evacuate_before` · `cut_refuge` (residents, 330 s)** | `eliminate_hvt` · `ms_observer` | R / R M C X E | n | P5-b |
| 18 | `mina_sahil_3_clearance` · *The Harbour* | clearance | 7 | `capture` · `harbour_square` 20; **`raze` · `harbour_works` 360**; **`no_collateral_above` 10** | `locate` · `ms_last_cell` | R / R M C X I | y | P5-b |
| 19 | `mina_sahil_4_clearance` · *The Line* | clearance | 6 | **`escort` · `forward_force` → `behind_line`**; `survive_until` 330; **`evacuate_before` · `handover` → `line_refuge` (`hostages`, 330 s)**; **`no_collateral_above` 10** | none | R I / R M C X H | n | P5-c |

Phases ascend: Jurf Nadi 2, 3, 5, 6; Mina Sahil 4, 5, 5, 5. The second pause (I-1) is told in
Jurf Nadi IV's `aftermath` and Mina Sahil I's `dispatch`. It is not played (L-14).

### Two rules that bind every row

- **Civilians are always scored.** Every mission that places civilians, or flags an
  inhabited zone, carries a scored and achievable protection objective: a resident
  `evacuate_before`, a `hostages` evacuation, or a `no_collateral_above` ceiling, and usually
  two of them. Every ceiling sits on a mission that has another primary, as the schema
  requires. **No mission's win needs civilian harm.**
- **Every `raze` zone holds enemy works only.** The rule in §4.2 binds every `raze` in the
  arc (QL none; BT IV; JN III and IV; MS I and III): `militia_firing_position`,
  `militia_observation_post`, `militia_weapons_workshop`, berms (`hesco`, `sandbag_wall`,
  `t_wall`) and `concrete` placed with `owner: 1`. There is no `house`, `apartment`, `shanty`,
  `clinic`, `hall`, `pump_house` or `militia_field_clinic` in the zone or within 2 tiles of
  its edge, because a halted dozer or sapper levels such a structure on its own (§4.2).

---

## 3. The story, one paragraph per mission

Story voice only, never line copy: `narrative-designer` writes the lines. Shai is the orders
voice and Idit the intel voice. The adversary acts and does not speak, unless L-5 names
one.

### Qasr Liwan: the city (real phase 1)

**1 · One House (recon, night).** Beit Sahwan is held, and the brigade's next ground is
the Marj's city, up the coast road. Idit has one thing nobody else has: a house, and a
reason to believe one of the people taken at First Light is in it. Who it is stays unsaid
(L-16). The
mission is a night approach through the city's northern edge. Find the guard post, take the
house quietly, and walk one person out to the extraction point before the street wakes.
Whatever else the recon finds (`ql_ring_posts`) is what the ring is built on. **Decision:**
how much of the edge to look at before going in, against a clock. **Conduct:** the house's
neighbours are inhabited.

**2 · The Ring (foothold).** The brigade closes the ring. The northern zone is the ring's
seam, and the southern zone is **the Cut**, the road that will separate the city from the
rest of the Marj for the rest of the war. Residents walking south cross the Cut through a
checkpoint the player must hold open while the ring is contested from vents and lanes.
**Decision:** hold the seam or keep the checkpoint open. Doing both splits the force.

**3 · The Pause (buildup).** A pause is agreed, and the taken come back in a handover on
open ground at the Cut. It is the war's breathing room (GDD §4). The player builds,
repositions and receives the taken: they walk from the handover to the refuge, and the
player's units must be near enough for them to walk. The enemy holds at distance on
`hold_position` and in `ambush`. The `no_collateral_above` ceiling is the pause itself:
one careless volley near the handover loses it. When the clock runs out (`timer_s`), the
pause ends and the waves come. **Decision:** what to build and where to stand when it ends.
**Gap:** a real weapons-held window is G-6. Today's version is distance and stance.

**4 · The Clinic Yard (clearance).** The clinic compound is in the city centre. Idit's
picture says a route's mouth is in the yard, not in the clinic. The mission is to take the
yard, walk the clinic's people out to a refuge, find the shaft and bring it down with the
tunnel engineers. **The clinic must stand,** because it is flagged and the ceiling holds.
The yard commander (`ql_yard_commander`) is a secondary. Nothing in the text asserts what
was or was not beneath the clinic itself. The fiction takes no side on the real dispute
(dossier P1-e), and the target is a mouth in open ground.

**5 · The Pumps (subterranean).** Under the shore quarter is the city's grid, in two tiers.
This mission is where the brigade learns to **map before it enters**. The camera robot
(`ugv_recon_dog`), the drone and the engineers find the routes first, because a route only
counts while someone can see it. Holding the pump yard is the fiction of the water going in.
It forces the shallow tier's crews up and out at the vents, where they can be fought. The
**deep tier does not flood** (dossier T4): its routes must still be collapsed by hand,
including one whose far head lies under the **relief depot**, a flagged `warehouse` the
player must not bring down. No agency is named or implied. **Decision:** where to put the
engineers while the shallow crews are coming up. **Gap:** a true `flood` verb is G-4. Today
the pump yard is a `hold_for`, and venting is `in_tunnel` garrisons on triggers.

### Khan Rafid IV: the south (real phase 2)

**6 · Second Floor (clearance, night).** The main effort has turned to the enclave's
middle (Khan Rafid I to III, re-briefed only). Idit has two of the taken on the upper floor
of a block in the souk. The guards are a garrison in the block. The extraction needs covering
fire, and covering fire is the air strike (250 Intel). **Where the player drops it is the
mission:** the block's neighbours are flagged. Strike the street behind the extraction and
the walk out is safe and expensive. Strike nothing and the walk out is a firefight. The ceiling (12) is two houses' worth of
slack. The
count (3) is set because `evacuate_before` counts every civilian, so at least one of the two
taken must come out.

*Deir Amun I to III follow, as shipped.* Deir Amun III gains an `aftermath`: the brigades go
home in the spring, and one battalion stays on the Cut (dossier P2-d).

### Bir Tarsha: the border (real phase 3)

**7 · The Gate Road (recon).** The last stronghold is at the Marj's southern end, on the
fence with the **Kharat Badlands**: neutral ground across a fence that nobody fires
across. The `dispatch` says most of the brigade went home and came back. The recon reads
the gate's defence and the works along **the Fence Road**. The crew that mans them (`bt_works_crew`, a
garrison tag) carries into IV, while residents on the gate road are walked out ahead of the fighting.
**Conduct:** a flagged zone along the fence. A round that lands across it is the
costliest mistake in the arc.

**8 · The Gate (foothold).** Take the crossing and hold it. The gate's terminal is a
`concrete` structure the enemy garrisons, and its roof is the secondary. The town's
displaced people shelter in a safe quarter the player must keep open. **Decision:** the
gate is easiest to take with fire that the safe quarter is too close to.

**9 · Two Houses (clearance, day).** Two blocks about ten tiles apart in the camp quarter,
with two of the taken in each. Both must be entered close together, because the first shot
at one house warns the other. The extraction is a heavy firefight on the way out. One
extraction zone serves both. **Decision:** split the force to enter at once, or take one
house and then fight for the second. The second is the slower, louder, more costly path.
The ceiling (15) makes reckless covering fire a defeat. The count (5) means at least one of
the four taken must come out. This mission is a relocation: the record's raid was in a
central camp (dossier D-4).

**10 · The Blade Line (clearance): the lead's dozer escort.** §4.

**11 · Under the Fence (subterranean).** The deep routes under the Fence Road run toward the
border. Bringing them down is the primary, on a clock. One is drawn wide enough for a truck;
the briefing says so, and nothing in the sim changes (G-13). While mapping them, the
engineers find a **chamber** at one route's head with one of the taken inside, left there
(dossier R4). The chamber is a sealed surface structure at the mouth (G-5). Walking that
person out **before** that route comes down is the carrying secondary and the third star.
The route itself is on the primary's list. **Decision:** the order of the charges. The
block commander (`bt5_block_commander`) is a secondary the briefing barely mentions. If he
falls, the remnant goes north. The fiction keeps only that hinge, never the manner of the
real death (L-4, dossier D-1).

### Jurf Nadi: the return north (real phase 4, Act IV)

**12 · Ground Taken Twice (recon).** Naharin is closed and the brigade, now Shai's (L-6),
is sent back to the Marj. The camp quarter north of Beit Sahwan, taken in the first month,
has filled again with the same doctrine: IED belts, rigged houses and cells that know the
ground. An evacuation order is in force, and residents leave by one road the player must
keep clear. Idit's picture is built on a year-old map, and the mission is to find out how
wrong it is.

**13 · The Checkpoint (foothold).** The ring around the camp, and the checkpoint on the road
south. The residents come through it, and so, Idit warns, might the cells. Hold it under
harassment from the orchard edge. `charge_squad` placements are the IEDs.

**14 · Rigged Streets (clearance).** Into the camp square. The houses on the main lane are
rigged, and the workshop that rigs them (`jn_workshop`, a zone) must come down on a
clock. Its crew (`jn_rigging_crew`, a garrison tag found in I) is already marked. **Conduct:** the rigged houses are inhabited ground. The player clears the
workshop and the square without levelling the lane.

**15 · The Complex (subterranean).** The last of the northern routes run from the fence
hamlet, and their command yard is the complex. Bring both down. The `aftermath` is the
pause: a ceasefire takes effect, and the brigade withdraws to a buffer along the Kedem side
(dossier P4-e). Then, told in the story voice, the pause ends (I-1).

### Mina Sahil: the line (real phase 5, Act IV)

**16 · Held Ground (buildup).** The offensive's first stage is ground held, not raided. Its
measure is the **income zones**: each pays only while the brigade holds it and nobody
contests it (README, held-ground income). The player takes and keeps the eastern and
southern quarters of the harbour district's approach, and razes the firing line facing
them. Control is something the player earns tile by tile; the fiction never names a share.

**17 · The City Edge (clearance).** The second stage encircles the city. Residents are
ordered south across the Cut, the same road as mission 2, and the player keeps the crossing
open while the ring road is taken.

**18 · The Harbour (clearance).** Into the harbour district. The works in the harbour come
down on a clock, and the last cell's position is the carrying `locate`.

**19 · The Line (clearance): the end of the war.** A ceasefire is agreed, and it has an
hour and a **Line**. Everything forward of the Line must be back behind it when the hour
comes. That is `escort` on the forward force, and it fails if any of them is lost. The
last of the taken are handed over at the Line, and the player walks them to the refuge.
The ceiling holds, and the cells probe the Line until the hour. Nothing is won here. The
guns stop. The campaign board's line for the Marj, "N came back at <place>", gets its last
number (L-6).

---

## 4. Bir Tarsha IV, *The Blade Line*: the dozer escort

The lead's brief: many dozers raze a large area while a battalion escorts them, like a
hold-the-compound mission but an escort. **The area is fortifications, tunnel shafts, weapons
sites and berms on emptied ground along the Fence Road. It is never homes.**

### 4.1 What `escort` does, verified in code

`packages/sim/src/mission.ts`, read on 2026-11-15:

- **Setup** (around line 2666): `target` must be a tag on the player's own
  `starting_force` placements, or load throws. The tag must name only side-0 units, and
  `zone` must be a map zone. If every tagged unit **starts inside** the zone, it is an
  authoring error.
- **Evaluation** (around line 4516): `failed` the tick **any** tagged unit has
  `alive === 0` (killed, or taken by `remove`). `complete` the tick **every** tagged unit
  `standsIn` the zone at once: alive, on the surface, standing. A unit carried by a
  transport counts where its carrier is.
- **It latches.** `stepObjectives` skips every objective whose status is not `active`
  (around line 4467). Once the dozers have all stood in the zone together, the escort is
  complete for good, and a dozer lost afterwards fails nothing.
- `escort` has no `seconds`. The **work** is carried by `raze` (every structure in the zone,
  snapshotted at start, failing at `seconds`) and `collapse` (every route whose **mouth** is
  in the zone, failing at `seconds`).

### 4.2 The design that follows from the code

| element | value | why |
|---|---|---|
| the dozers | 4 × `dozer_d9`, all tagged `blades` (L-7). All four are on loan behind their Conduct gate, which the issued force allows (README) | "numerous". Tagging all four makes every one a defeat condition: G-1 |
| the escort | 2 × `ifv_namer`, 2 × `mbt_lavi`, 4 × `inf_squad`, 1 × `sniper_team`, 1 × `mortar_team`, 1 × `ugv_recon_dog`, 1 × `yahalom_squad`, plus `from_ledger` survivors | a battalion-sized column. The tunnel engineers are needed because a dozer cannot set a tunnel charge (`tunnel_charge` is on `yahalom_squad` only: G-3) |
| `fence_works`, the raze and collapse zone | a band about 30 × 6 tiles along the Fence Road. It holds 6 × `militia_firing_position`, 3 × `militia_observation_post`, 2 × `militia_weapons_workshop` (owner 1 by type, `roe_penalty` 0), runs of `hesco` and `sandbag_wall`, one `t_wall` barrier line across the strip, and 3 route **mouths**. The berms and the barrier are neutral by type (`owner` unset in `data/structures.json`), so each is placed with `owner: 1` (`structures[].owner`, `mission.schema.json`) to read as the enemy's works. The automatic branch skips only a demolisher's *own* side's works, so neutral or enemy-owned barriers are cut unordered either way | the enemy's works and nothing else. **No `house`, `apartment`, `shanty`, `clinic`, `hall`, `pump_house` or `militia_field_clinic` may stand in the zone or within 2 tiles of its edge** |
| `far_gate`, the escort destination | the strip's far end, **beyond the `t_wall` barrier line** | the latch (§4.1) means "arrive" must sit behind the work. Every structure's footprint is blocked to foot and vehicle alike (`Sim.addStructure` sets `blocked` on each tile), so a solid barrier also stops the infantry. Leave one tile of boulder field (`b`: open on foot, a wall to anything wheeled) as a foot gap. The dozers then cannot arrive without razing through, and the escort's infantry can still go ahead of them |
| the inhabited edge | the border hamlet north of the strip: `house` tiles in a **flagged** zone, inhabited, with at least 3 tiles of open ground between it and the band | `stepDemolition`'s automatic branch (`packages/sim/src/sim.ts`, around line 11935) levels the nearest structure under `PROTECTED_ROE` (20) that a **halted** dozer stands within 2 tiles of, **with no order**. A house is 6. The shortest road east runs past the hamlet, so a dozer parked there to wait for its escort brings a house down by itself. That is the mission's Conduct bait (Wadi Halam V's, shipped), and **the win never needs it**: the band is reachable without that road |
| low-profile works | `hesco` and `sandbag_wall` are `low_profile`, and the automatic branch skips them | they come down only on an explicit `demolish` order. This is the mission's micro-management, and it is honest: cutting a berm is an order |
| the enemy | `atgm_cell` and `rpg_team` in `ambush` on the hamlet side and the far side; `mortar_crew` behind the barrier; `charge_squad` in the band; `in_tunnel` garrisons on the three routes, venting on `zone_entered` | the dozers' hull is 2400 hp with a 240 front, and the HP model ends a vehicle by penetrations (GH-560). The escort's job is the ATGM teams |
| ceiling | `no_collateral_above` 12 | at most one house of slack (a house costs 6) |
| clocks | `raze` and `collapse` at 390 s; `target_minutes` 7; `time_limit_s` 840 | below |

### 4.3 Time arithmetic (an estimate; `playtest` decides)

`dozer_d9`: `speed_tiles_s` 0.6, `demolition_time_s` 2.0, and a charge resets when the dozer
is displaced or pinned (`suppression_resistance` 0.75).

| step | per dozer, unopposed |
|---|---|
| start to the band's near end, about 12 tiles | about 20 s |
| along a 7-to-8-tile lane (four dozers share about 30 tiles) | about 13 s |
| 4 or 5 structures in the lane, each 2 s plus about 3 s to reposition | about 25 s |
| 2 or 3 low-profile berm sections on order | about 15 s |
| the barrier line, then on to `far_gate`, about 6 tiles | about 15 s |
| **total, unopposed** | **about 90 s** |

The work alone fits in a quarter of the 390 s clock. **The clock is spent on the escort:**
clearing ambushes before a dozer stops, getting the tunnel engineers onto three mouths
inside a fire-swept band, and keeping the ATGMs off four slow hulls. So 390 s is a guess
that leaves about four minutes of contested time. `playtest` measures it with a passive
control (which loses on the raze clock) and the plan ladder. A *big* area, as the lead
asked, could also use a map larger than 48 × 48 (the renderer chunks maps above 48, and
`milh_flats_l` is 96 × 96). Every campaign map today is 48 × 48, and the visibility gate
(README rule 10) is measured on them. The default is 48 × 48, with the band taking most of
the southern third.

### 4.4 What it does not do yet, and the smallest fix

| gap | effect today | proposal | owner |
|---|---|---|---|
| **G-2: escort latches on arrival** | after the column reaches `far_gate`, the dozers can be lost freely while the rest of the raze finishes | an escort that **holds**: `until: "primaries"` on the objective. It completes with the other primaries (as `no_collateral_above` does in its second pass) and fails on any tagged loss before then | `sim-guard` |
| **G-1: all or nothing** | one dozer lost is a defeat; four makes the mission brittle | `count` on `escort`: "at least N of the tagged arrive, or survive" | `sim-guard` |
| **G-3: a dozer cannot collapse a route** | the record's dozers collapse shafts (dossier T7); here the tunnel engineers must | `tunnel_charge` on `dozer_d9` is a data change but a balance change. Route it to `balance-analyst` before anyone edits the JSON | `balance-analyst`, `sim-guard` |

**The mission is authorable today** with the latch documented in its design doc. G-2 is the
version the lead actually asked for, and it is recommended as the first engine item (L-13).

---

## 5. Tunnel warfare: the four shapes the brief asked for

| shape (dossier) | where | phase | how it plays |
|---|---|---|---|
| **mapping before entry** (T3) | Qasr Liwan V, and Deir Amun I *Read the Ground* (shipped) | subterranean, recon | `mark_tunnel` carriers (`ugv_recon_dog`, `recon_drone`, `scout_shachaf`, `recon_zikit`, `yahalom_squad`) hold sight lines; a route counts while watched. G-9: "map N routes" is not yet an objective |
| **flooding** (T4) | Qasr Liwan V | subterranean | the pump yard `hold_for`, with venting `in_tunnel` garrisons on triggers; the deep tier still needs charges. G-4 |
| **command-bunker raids** (T5) | the clinic yard (QL IV), the shore grid and relief depot (QL V), the southern network (Deir Amun III, shipped), the wide route near the gate (BT V) | clearance, subterranean | `capture` of the shaft head plus `collapse`. Troops stay on the surface (G-5) |
| **border-corridor demolition** (T6) | Bir Tarsha IV (shallow works) and V (deep routes) | clearance, subterranean | `collapse` along a long zone, and the tiers split across two missions (dossier T2) |
| clearing grids for buffers and corridors (T8) | Bir Tarsha IV, Jurf Nadi IV | clearance, subterranean | only enemy works on emptied ground, beside a flagged inhabited edge |

---

## 6. Coverage matrix: every required beat to a mission

| required beat | mission(s) |
|---|---|
| P1-a three weeks of strikes; infiltrators cleared | *First Light* and Beit Sahwan I (shipped); told |
| P1-b ground entry | Beit Sahwan I and II (shipped) |
| P1-c encirclement of the main city | QL II |
| P1-d the corridor bisecting the territory | QL II (the Cut), held through MS II |
| P1-e raid on a compound with a shaft (hospital) | QL IV |
| P1-f a one-week pause with exchanges | QL III |
| P1-g resumed clearing; the multi-level grid | QL V |
| P1-h a vehicle-wide tunnel near a crossing | BT V (told) |
| P1-i a tunnel under an aid compound | QL V (the relief depot, flagged) |
| P2-a to P2-c the main effort to the second stronghold, urban and subterranean | Khan Rafid I to III, Deir Amun I to III (shipped, re-briefed) |
| P2-d the brigades withdraw | DA III `aftermath`, BT I `dispatch` |
| P3-a the border city and its crossing | BT I, BT II |
| P3-b the whole border corridor | BT IV |
| P3-c cross-border smuggling routes | BT V |
| P3-e the front's commander falls in the border town | BT V secondary (hinge only) |
| P4-a to P4-c the siege of three northern towns | JN I to III (three quarters of one town) |
| P4-d, P4-e the final complex; a ceasefire and withdrawal to a buffer | JN IV |
| I-1 the second pause and its end | JN IV `aftermath`, MS I `dispatch` (told) |
| P5-a capture and hold, stage I | MS I |
| P5-b encircle and enter the city, stage II | MS II, MS III |
| P5-c a ceasefire along a fixed line | MS IV |
| **R1** night rescue of one of the taken in the first ground days | QL I |
| **R2** night raid, second-storey apartment, covering fire | KR IV |
| **R3** daytime raid on two apartment buildings under heavy fire | BT III |
| **R4** a captive found alone in an underground chamber | BT V |
| **T3** mapping before entry | QL V, DA I (shipped) |
| **T4** flooding | QL V |
| **T5** command bunkers | QL IV, QL V, DA III (shipped), BT V |
| **T6** border-corridor tunnel demolition | BT IV, BT V |
| **the dozer escort** | **BT IV** |

Nothing in the brief is dropped. Five beats are told rather than played (P1-a, P1-h, P2-d,
I-1, and the manner of P3-e), and each is listed in `transposition.md` §7 with the reason.

---

## 7. Ledger flow

- Every new mission **requires R**, and **I** wherever the mission before it in the
  same town produces I (the shipped convention: `khan_rafid_3_clearance` requires
  `roster.surviving_units` and `intel.marked_positions`).
- Every new mission **produces R M C X**, plus **I** on each recon and subterranean,
  **E** on each resident evacuation, and **H** on each `hostages` evacuation.
- **H**, `civ.hostages_recovered`, is produced today by one mission only (Beit Sahwan IV).
  This arc adds six producers: QL I, QL III, KR IV, BT III, BT V and MS IV, with QL III
  and MS IV as the handovers. **The taken are the campaign's spine (D12), and in Plot A
  the board's account of them closes at the Line.** Each needs `hostages_place`
  (`mission.schema.json`).
- **Carrying secondaries for the third star** (README): QL I `ql_ring_posts` → QL II's
  pre-identified posts; QL V `ql_deep_crew` → nothing in the Marj until Act IV, so check it
  survives `pnpm playtest`; BT I `bt_works_crew` → BT IV; BT V the chamber rescue
  (it carries through H); JN I `jn_rigging_crew` → JN III. A carrying `locate` names a
  **garrison tag**, and the same tag reappears on enemy placements in the later mission,
  which then requires I: carries work on unit tags, never on structures or zones. Every one must be proved by
  `playtest` to be read later, never flagged on hope (Beit Sahwan III's lesson, README).
- **Across the act gap.** Act IV's first mission requires R from the end of Naharin. The
  brigade that comes back is the one that fought there (`ROSTER_CAP` 150 applies).

---

## 8. Asset manifest

The census was run in this worktree on 2026-11-15: `ls data/units/kdf data/units/enemy`,
`ls art/meshes/buildings`, `jq '.types|keys' data/structures.json`, and
`jq -r '.id' data/maps/*.json`.

| asset | status | path, or gate + pipeline |
|---|---|---|
| KDF units: `dozer_d9`, `yahalom_squad`, `ugv_recon_dog`, `recon_drone`, `scout_shachaf`, `recon_zikit`, `demo_squad`, `inf_squad`, `inf_medic_squad`, `ifv_namer`, `mbt_lavi`, `apc_eitan`, `sniper_team`, `mortar_team`, `veh_ambulance`, `heli_yanshuf` | PRESENT | `data/units/kdf/` |
| Ashwar units: `militia_cell`, `rpg_team`, `charge_squad`, `digger_crew`, `atgm_cell`, `mortar_crew`, `moto_rpg`, `technical`, `loiter_drone`, `paramotor` | PRESENT | `data/units/enemy/` |
| `civilians` (residents and the taken) | PRESENT | `data/units/civilians.json` |
| structures: `clinic`, `apartment`, `house`, `shanty`, `warehouse` (relief depot), `pump_house`, `concrete` (gate terminal, chamber), `t_wall`, `hesco`, `sandbag_wall`, `sandbag_post`, `fence`, `militia_firing_position`, `militia_observation_post`, `militia_weapons_workshop`, `camp` | PRESENT, each with idle and wreck GLBs | `data/structures.json`, `art/meshes/buildings/` |
| a crossing terminal that reads as a gate | MISSING (optional; `concrete` + `fence` serves) | `pnpm validate:meshes`; `blender-art` (lead approves the art numbers first) |
| map `qasr_liwan` + `_2` to `_5` | MISSING | `pnpm validate:data`, `map_visibility.test.ts` (84%); hand-authored JSON (`mission-author`), with tunnels for `_4` and `_5` |
| map `khan_rafid_4` | MISSING | as above; a variant of `khan_rafid` |
| map `bir_tarsha` + `_2` to `_5` | MISSING | as above; `_4` and `_5` carry the Fence Road band and routes |
| map `jurf_nadi` + `_2` to `_4` | MISSING | as above |
| map `mina_sahil` + `_2` to `_4` | MISSING | as above; `_1` carries `income_zones`, `_4` the Line built of `t_wall` |
| town ids `qasr_liwan`, `bir_tarsha`, `jurf_nadi`, `mina_sahil` | MISSING | `mission.schema.json` `town` enum, `data/campaign/world.json`, GDD §2's town list (`sim-guard` for the schema) |
| a region that returns to the Marj (Act IV) | MISSING | G-14 (`app`, `world.schema.json`) |
| `commander.json` ranks for Plot A, and a villain entry for the return | MISSING | `pnpm validate:data`; `mission-author` |
| campaign board pins for four towns | MISSING | `world.json` `at`, inside the `marj` outline |
| briefing images or plates | optional | `assets/ui/plates/`, ungated; generative art disclosed in the PR |
| voice lines | not written | the bark and briefing pipeline (WP-AU1); a native speaker reviews every line (storyline §2.4 rule 5) |

**No new unit, no new structure required, no new VFX.** The arc's cost is maps and missions.

---

## 9. Engine and schema gaps

Each gap is classified per README rule 5: **today** (expressible now) / **schema** / **engine**.

| # | gap | missions | class | smallest proposal | owner |
|---|---|---|---|---|---|
| G-1 | `escort` is all-or-nothing | BT IV, MS IV | schema + engine | `count` on escort | `sim-guard` |
| G-2 | `escort` latches on arrival (`mission.ts`, around 4467) | BT IV | schema + engine | `until: "primaries"` | `sim-guard` |
| G-3 | a dozer cannot set a tunnel charge | BT IV | data (a balance change) | `tunnel_charge` on `dozer_d9`, after review | `balance-analyst` |
| G-4 | no flooding | QL V | engine | `do.kind: "flood"` on a route: stocked bodies surface at the vent, then the route closes | `sim-guard` |
| G-5 | player units cannot be `in_tunnel` (`tools/validate_data.mjs`); a buried civilian cannot surface (Beit Sahwan design §9 G3) | QL IV, QL V, BT V | engine | weaponless surfacing on a vent | `sim-guard` |
| G-6 | no mission-side weapons-held window | QL III, MS IV | engine | reuse the versus set-up (`Sim.beginSetup`, `setupActive`) as a mission `truce` block | `sim-guard` |
| G-7 | the taken soldier cannot be a KDF unit held by the enemy | QL I | schema + engine | a friendly-tagged prisoner (storyline §7 G7, T12) | `sim-guard` |
| G-8 | `evacuate_before` counts every civilian and cannot name a group | every rescue | schema | `group` on `evacuate_before` (Beit Sahwan design G5) | `sim-guard` |
| G-9 | `locate` targets units, never routes | QL V | schema | `locate` with `routes: [...]` | `sim-guard` |
| G-10 | four new towns | all new | schema + data | enum, `world.json` and GDD §2 | `sim-guard`, `mission-author` |
| G-11 | night is presentation only (the app reads `time_of_day`; the sim never does) | QL I, KR IV | design note | none: night is mood, and the raids work by stance and ambush | none |
| G-12 | a wave `from` a tunnel is unimplemented (`docs/agent-notes/mission-findings.md`) | QL V, BT V, JN IV | engine | as the agent note proposes | `sim-guard` |
| G-13 | no vehicle moves underground | BT V | out of scope | told in the briefing | none |
| G-14 | `world.json` is a fixed sequence of regions, so a region cannot appear twice | Act IV | schema + app | a `marj_return` region that shares the `marj` board outline in `countries.json` | `app` |
| G-15 | no sea or water tile on an arid map | QL V | design note | the sea is off-map; the pump yard sits at the map's edge | none |
| G-16 | first shipped use of `escort` and `no_collateral_above` | BT IV, QL III, MS IV and others | test | the `playtest` plans must drive an escort; check the harness before authoring | `playtest` |
| G-17 | villains are keyed by region (`commander.json` `villains.marj`, `ends_at` Beit Sahwan IV) | Act IV | schema | a villain entry per region return, if L-5 names one | `mission-author` |

**The four that matter before authoring:** G-2 (BT IV), G-6 (QL III), G-4 (QL V) and G-14
(Act IV). Each mission still has a today-fallback, so none of them blocks the arc.

---

## 10. Plot choices the record leaves open

**PO-1, placement.** §1. Plot A is recommended.

**PO-2, the front's commander (dossier P3-e).**
- (a) **RECOMMENDED.** Nadir Sahim stays taken at Beit Sahwan IV, as shipped, and the
  hinge falls on Bir Tarsha's block commander, a job title in the shipped
  `wh_hvt_amir` register. No landed mission changes.
- (b) Re-brief Beit Sahwan IV so the shaft head holds his deputy, and move Sahim's end to
  Bir Tarsha V. This is the closest echo of the record. It costs one landed mission's
  objective text, its sheets and a `playtest` re-run (Khan Rafid design §1 Option C), and it
  comes nearer to paraphrasing a real death. I recommend against it.

**PO-3, the end of the war.**
- (a) **RECOMMENDED. *The Line*.** The ending moves to `mina_sahil_4_clearance`. The guns
  stop on a marked line and the last of the taken walk back across it. Its `aftermath`
  says that this is a stop and not a peace: neutral, with no victory language. Storyline
  §5 Option 1's promotion and "Ari Actual" callsign move to the **start** of Act IV
  (Jurf Nadi I's `dispatch`): the brigade is his when he goes back.
- (b) Keep Storyline §5 Option 2, *The Quiet Ground*, as an epilogue after the Line. Its
  open-road image is a peace the record does not show, so I recommend against it.

**PO-4, where the dozers work.**
- (a) **RECOMMENDED.** Bir Tarsha IV: fortifications along the border strip.
- (b) Mina Sahil I: the held ground's firing line.
- (c) Jurf Nadi IV: the complex by the fence.

(b) and (c) carry the real buffer-clearing beat closer to inhabited ground. That is harder to
keep honest, so (a) is preferred.

---

## 11. Lead decisions, with recommended defaults

| # | decision | default |
|---|---|---|
| **L-1** | Placement | **Plot A, *The Long Ground*:** Act I extended, Act IV the return (§1) |
| **L-2** | New names: **Qasr Liwan**, **Mina Sahil**, **Bir Tarsha**, **Jurf Nadi**; the **Kharat Badlands** as the neutral neighbour; the features *the Cut*, *the Gate*, *the Fence Road* and *the Line* | **Accept**, after a second screening by the native speaker who reviews voice lines. Each was web-searched once on 2026-11-15 with no exact match; one further candidate failed screening and was dropped (`dossier.md` §9) |
| **L-3** | Rank ladder under Plot A | **Keep four acts and promotions at act boundaries:** Captain through the extended Act I (`until_mission` → `bir_tarsha_5_subterranean`), Major in Sur, Lt Col in Naharin, Colonel from the end of Wadi Halam V and through Act IV. The alternative is to split Act I at Qasr Liwan's end with a Major promotion, which gives five acts and renumbers the rest (§1) |
| **L-4** | The front's commander | **PO-2 (a):** Sahim stays taken. Only the structural hinge of P3-e is carried, never its manner |
| **L-5** | An adversary for Act IV | **Job titles only** (the remnant's commander, the charge chief), the Khan Rafid precedent. A new named villain needs a screened name, a portrait and a `commander.json` entry (G-17) |
| **L-6** | The ending | **PO-3 (a), *The Line*;** "Ari Actual" moves to Act IV's start |
| **L-7** | The dozer mission | **Bir Tarsha IV,** four dozers all tagged. If `playtest` finds it brittle, tag two lead blades until G-1 lands |
| **L-8** | The pause as a playable mission | **Playable** (QL III, buildup), with G-6 as its proper form |
| **L-9** | *Khan Rafid* reads as a blend of two real city names in this theatre (an observation from the census, outside this arc) | **Keep**: it is shipped and played. Raise it separately if the lead wants it reviewed |
| **L-10** | Two real-name collisions already in shipped canon: the brigade's number (GDD §2) matches a real armoured brigade named in the dossier's R4 sources, and `yahalom_squad`'s display name is the real counter-tunnel unit's | **Raise as a separate issue.** This arc adds neither and refers to both by id |
| **L-11** | The clinic-yard mission, given that the real event's claim is contested | **Keep:** the shaft is in the yard, the clinic stands and is protected, and no line asserts what lay beneath. The alternative is to tell the beat and not play it |
| **L-12** | The aid-compound beat | **Fold into QL V** as a flagged relief depot over the grid's far head, with no agency named or implied. The alternative is to drop it |
| **L-13** | Engine order | **G-2 first** (the dozer escort the lead asked for), then G-6, G-4 and G-14. Author BT IV today on the latching semantics, documented |
| **L-14** | The second pause (I-1) | **Told only:** QL III already plays a pause |
| **L-15** | Authoring order | **Qasr Liwan → Bir Tarsha → KR IV → Jurf Nadi → Mina Sahil.** Act I first, in campaign order, as O8 did; the dozer mission lands with its town |
| **L-16** | Who is freed in QL I (R1) | **Leave it unsaid:** "one of the people taken at First Light", with no role, rank or unit. Giving the person a role or a post risks mirroring the real record, which goes beyond operational shape |

---

## Appendix: how this was checked

```bash
grep -n "escort" packages/sim/src/mission.ts        # setup ~2666, evaluation ~4516
grep -n "status !== 'active'" packages/sim/src/mission.ts   # the latch, ~4467
sed -n 11935,12040p packages/sim/src/sim.ts         # stepDemolition: PROTECTED_ROE, lowProfile, owner skips
jq '.' data/units/kdf/dozer_d9.json                 # speed 0.6, demolition_time_s 2.0, wheeled
jq -c '.types|to_entries[]|{k:.key,low:.value.low_profile,owner:.value.owner,roe:.value.roe_penalty}' data/structures.json
jq -r '.properties.town.enum' data/schemas/mission.schema.json   # eight towns
grep -n '"time_of_day"' -A8 data/schemas/mission.schema.json     # dawn | day | dusk | night
```

The real-name check run before the PR: `grep -n -i -E` with the deny-list in `dossier.md` §9
over this file and `transposition.md`, which returns nothing. The pattern itself is kept
out of this file, because it is made of the names.
