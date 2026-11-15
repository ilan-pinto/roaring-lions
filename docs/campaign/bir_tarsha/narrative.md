# Bir Tarsha: Narrative Trigger Sheet

**Act I · The Marj Strip · Ashwar Front · *The Long Ground*, town 2 of 4 new and the Marj's fifth and last town in campaign order. Shai Hammai is a Captain in all five missions and is not promoted here (L-3). The Major promotion lives in Sur's briefing (lead ruling 5).**

**Date:** 2026-11-15 · **Author:** `narrative-designer` · **Status:** authored text, written against an approved design. The lead approved the arc (PR 1438) and this town's Mission Design Document (PR 1453: Option B *Gate and Strip*, and all seven rulings at the recommendations) on 15 Nov 2026. The escort design it leans on (PR 1454, GH-1439) is a **proposal**; nothing in this sheet's text depends on its field shapes.

**Nothing in this pass was applied to any data file.** None of the five `data/missions/bir_tarsha_*.json` files exists, no `bir_tarsha` map exists, and the town is not yet in `world.json` or in `mission.schema.json`'s `town` enum (MDD G-10). There is no `name`, `briefing` or `objectives[].text` to edit, so `pnpm validate:data` has nothing of this sheet's to check. `mission-author` pastes every string below when the files land. The re-brief in §8 is exact text, also unapplied, for the reason given there.

**Upstream:** `docs/campaign/bir_tarsha/design.md` (§0, §2, §4, §5 and its story hooks, §7); `docs/campaign/the_long_ground/arc-outline.md` (read from `origin/cl/campaign-historian`, since it is not on this branch's tree); the Qasr Liwan sheet (`origin/cl/qasr-liwan-narrative`) for format. **Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md` §2.1 to §2.4 (rule 6, as amended by PR 1447, admits real equipment and unit names), `docs/GDD.md` §2 and §11.

**Downstream:**
- `mission-author`: five `name`s, five briefings, 18 objective texts, one `dispatch`, one held and one live `aftermath`, ten `debrief` lines, every `say`, two `hostages_place`s; the Deir Amun III `aftermath` re-brief (§8).
- `level-scripter`: trigger ids, labels and bindings, and the two points the design leaves open (D-BN1, D-BN2, §10).
- `sim-guard`: the say-only trigger the ambient lore needs.
- `render-vfx`: nothing new.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code. The text reaches a player the moment `mission-author` pastes it into the field named in the row |
| `schema` | the field is specced and the runtime ignores it |
| `engine` | nothing can fire the line today: a line on a `SimEvent`, on a route opening, or on a say-only trigger |

Checked against this tree, not recalled:
- `mission.schema.json` `$defs/say` is `{ speaker ∈ shai | idit | net | enemy, text ≤ 240 }`, carried by `objectives[].say`, `objectives[].say_on_fail`, `triggers[].say`, `enemy.waves[].say`, `debrief.victory` and `debrief.defeat`.
- `dispatch` and `aftermath` are strings of 240 or fewer. `hostages_place` is 40 or fewer, read by the board as "{N} came back at {place}.".
- A trigger's `label` is 48 or fewer with no full stop, and it is what the feed prints. An unlabelled trigger prints nothing.
- A trigger needs a `do`, so a line with no action to carry needs a say-only trigger (`engine`).

**`schema` is 0 in this sheet.** Every row is `live` or `engine`. The count is §11. **No `engine` line here can ride a tutorial step**: the step machine is gated to the tutorial mission.

### 0.2 The two voices

The deploy screen and the commander bar show one speaker at a time, and `briefing` is one string. So in the JSON each briefing reads as Shai's orders end to end. In this sheet each briefing is a two-hander with one speaker per beat, because it has to be written and read aloud that way: Idit's picture, Shai's plan, alternating, closing on a cost.

- **Shai, Captain.** Second person, present tense, one tile-level fact, a cost at the end.
- **Idit.** What is known, how well, and what knowing more costs. **She never gives an order.**
- **No `enemy` line in this town.** The front's man, Nadir Sahim, was taken at Beit Sahwan IV (D-BT1). The two adversaries on the ground are job titles: **the works crew** and **the block commander**. Neither speaks.

### 0.3 The rules that bind every line here

- **Doctrine, never a people.** The Ashwar Front is tunnels, ambush and human terrain. No line gives a faction a population, a faith, an accent or an idiom, and the people of the town are people who live in a town on a fence.
- **The taken are never characterised.** Every line says "the people taken at First Light", "the person" or "one person". No role, rank, age or sex, no pronoun (L-16). No line depicts harm to them, and no real hostage is implied.
- **Civilians are always protected.** Every Conduct line states a number and no line gives a reason to hit a house. No win needs harm.
- **Real equipment names are admitted** (rule 6, GH-1440): this sheet uses *D9*, *Lavi* and *T-wall*. It uses *the engineers* for `yahalom_squad` (L-10: no new line uses the unit's real display name), and it names no real place, person, operation, faith or insignia.
- **The Badlands** are L-2 canon (*the Kharat Badlands*), pending the second screening. The sheet writes *the Badlands* and never the adjective, so the lead adds it or does not.
- **Names.** No proper noun is coined. *Bir Tarsha*, *the Fence*, *the Fence Road* and *the Gate* are L-2 canon. Every other place is a feature from the design: the gate road, the cross road, the safe quarter, the camp quarter, the extraction, the refuge, the belt, the hamlet, the far gate, the ridge, the chamber.
- **Conduct, never ROE.** Each `no_collateral_above` text states its number.
- **Static text must hold for every outcome.** No `debrief`, `aftermath` or `say` assumes a secondary was done, that exactly the minimum came out, or that a unit survived. Each defeat line holds for every way the mission can be lost: its clock, its ceiling, an escort failure, or the time limit.
- **Restraint is consequence.** A line says what a round costs, never why it is wrong.
- **The Marj is arid.** No olive appears.

### 0.4 Decisions recorded before the text

1. **One `dispatch`: I.** It opens a new town, the house rule. II to V have none; a mid-town `dispatch` is a deviation the lead has not asked for.
2. **Two `aftermath`s: III (held) and V.** V's closes the town and the act. III's is written and **held**, as in the Qasr Liwan sheet (§0.4): the lead can strike it, and if struck the line moves into III's victory debrief.
3. **No `briefing_video`** on any of the five. `validate_data.mjs` requires the file, and the lead cuts these himself.
4. **`hostages_place`** on the two missions with a `hostages` evacuation: III `the north of the camp quarter` (29 characters) and V `the Fence Road` (14). The board reads *"Three came back at the north of the camp quarter."* and *"One came back at the Fence Road."*
5. **The escort's wording is independent of GH-1439's field shape.** IV's texts name what the player owes (*bring the four blades through*) and not how the engine counts it.

---

## 1. `bir_tarsha_1_recon`: Bir Tarsha I · The Gate Road

`recon` · dawn · **Captain** · requires **R** · produces **R M C X I E** · `target_minutes` 6 · economy: no · **Decision:** How long to spend on the gate before the residents are out, and whether the crew on the east works is worth the minutes.

### 1.1 `name`

`Bir Tarsha I — The Gate Road`

Town, numeral, name, as `Qasr Liwan I — One House` and `Tel Marum I — The Gateway`. The road is the mission: it runs from the brigade to the gate.

### 1.2 `dispatch`

> *The brigades went home in the spring and came back in the autumn. The last stronghold of the Marj stands at its southern end, against a fence that nobody fires across.*  (167 characters)

Sentence one is the outline's P2-d, told as a fact; sentence two is the town's premise. It names no enemy and no atrocity (D-BT1: the front's man was taken a town ago). Status `live`.

### 1.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Bir Tarsha has one road, and the road ends at a gate in the Fence. I can read the garrison at that gate from here, and I cannot read who mans the works that run east along the Fence Road. | 187 |
| 2 | **Shai** | Identify the garrison at the gate. Then walk six of the eight residents in the west quarter out to the refuge in the north-west. | 128 |
| 3 | **Idit** | They walk once one of ours is within four tiles of them, or once a round lands near them, and the second way is the one I would not choose. The east works are the other way, and the crew on them is not a thing I can see. | 220 |
| 4 | **Shai** | Shepherd first, look east second. Five minutes for the residents, six for the picture. | 86 |
| 5 | **Idit** | South of the gate is the Fence, and past it are the Badlands. The edge of them is a flagged line, and a round that lands over it is the costliest one you can fire this morning. | 176 |
| 6 | **Shai** | Six out and the gate named. A crew you did not find is a crew the next fight finds for you. | 91 |

- Beat 1 is the town's whole picture: one road, one gate, and a blind spot. *"Who mans the works"* is the secondary, and it is said as a gap in her picture, never as an order.
- Beat 2 gives both primaries. Six of eight is `count 6` on a plain `evacuate_before` (300 s, no `hostages`; the residents are not the taken).
- Beat 3 is the shepherd rule (`civilians.ts`: a ground unit within four tiles, or a round near them). The second clause is Conduct said as a method.
- Beat 4 puts the clock on the residents (300 s) and the mission (`target_minutes` 6, `time_limit_s` 720).
- Beat 5 introduces the Badlands by function, not by place. *Kharat* is L-2 canon pending its second screening, so the sheet says *the Badlands* and the lead can add the adjective.
- Beat 6 closes on the cost. *"The next fight finds for you"* is the carry into IV, true for a player who never found the crew.

**The JSON string, to be pasted whole (893 characters, splits into 6 beats by a port of `briefingBeats`):**

> Bir Tarsha has one road, and the road ends at a gate in the Fence. I can read the garrison at that gate from here, and I cannot read who mans the works that run east along the Fence Road. Identify the garrison at the gate. Then walk six of the eight residents in the west quarter out to the refuge in the north-west. They walk once one of ours is within four tiles of them, or once a round lands near them, and the second way is the one I would not choose. The east works are the other way, and the crew on them is not a thing I can see. Shepherd first, look east second. Five minutes for the residents, six for the picture. South of the gate is the Fence, and past it are the Badlands. The edge of them is a flagged line, and a round that lands over it is the costliest one you can fire this morning. Six out and the gate named. A crew you did not find is a crew the next fight finds for you.

### 1.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is read once as an order and once as a toast, `OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `identify_the_gate` | `locate` · `bt_gate_garrison` · primary | Identify the garrison at the gate | OBJECTIVE COMPLETE — Identify the garrison at the gate | live |
| `six_out` | `evacuate_before` · `gate_refuge`, count 6, 300 s · **primary, failable** | Walk six residents out to the refuge | OBJECTIVE COMPLETE — Walk six residents out to the refuge | live |
| `find_the_crew` | `locate` · `bt_works_crew` · secondary, `carries` → IV | Identify the crew on the east works | OBJECTIVE COMPLETE — Identify the crew on the east works | live |

- `six_out` says *walk*, because `CivilianFlight` walks a resident once a ground unit is within four tiles. It names the refuge, the one piece of ground the player can find.
- `find_the_crew` is the only carrying secondary. A crew that came out because the gate was assaulted first (`first_contact` commits it) is not a located group, so a rushed recon cannot get it.

### 1.5 `debrief`

> **victory** · Idit: *"The gate has a name and six are out of the west quarter. The works along the Fence Road are still half a picture, and half is what you gave me."* (143)

> **defeat** · Shai: *"Not this morning. The gate is awake now, and the west quarter is where it was left."* (83)

The defeat holds for the residents' clock, a Conduct collapse and the time limit. The victory line does not claim the crew was found: *half a picture* is true either way. Status `live`.

### 1.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Bir Tarsha I — The Gate Road` · *2 primary objectives* | `hud.announce` | live |
| mission start | `dispatch` | narrator | §1 dispatch | title card | live |
| mission start | `brief` | Idit / Shai | briefing, beats 1 to 6 | deploy screen, then the commander bar | live |
| `first_contact` at the gate → `bt1_works_stir` (`commit` the works crew) | `toast` | system | `The east works are stirring` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "Movement on the east works. Whoever is on them has heard the gate, and from here on they are looking west." | `triggers[].say` | live |
| `objective(identify_the_gate, complete)` | `radio` | **Idit** | "That is the garrison: two blocks and a missile team on the road. Nothing at the gate is waiting for us in particular, and nothing is asleep." | `objectives[].say` | live |
| `objective(find_the_crew, complete)` | `radio` | **Idit** | "Marked. That is the crew on the east works, and the next time we come down this road I can tell you which posts are theirs." | `objectives[].say`. The carry into IV, said when it is bought | live |
| `evacuated` (a resident reaches the refuge) | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(six_out, complete)` | `radio` | **Shai** | "Six out. The west quarter is quiet, and it has one less reason to be a target." | `objectives[].say` | live |
| `objective(six_out, failed)` | `radio` | **Idit** | "The quarter is closed to us now. There is no second morning for a walk like that, and the people in it know it." | `objectives[].say_on_fail`. Holds for the clock and for a count that can no longer reach six | live |
| `SimEvent identified` on any east-works post | `radio` | **Idit** | "That is a firing position on the Fence Road, facing west. It is not the gate, and it is not the only one." | no trigger can watch a `SimEvent` | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — Conduct n, k units survive` | hard-coded | live |
| `missionEnd` | `debrief` | Idit (victory) / Shai (defeat) | §1 debrief | end screen | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `bt1_works_stir` | `first_contact` (gate) → `commit` crew | `The east works are stirring` | 27 |

---

## 2. `bir_tarsha_2_foothold`: Bir Tarsha II · The Gate

`foothold` · day · **Captain** · requires **R I** · produces **R M C X E** · `target_minutes` 7 · economy: **yes**: a camp at the gate, income zone `the_gate`; Logistics buys infantry and a Lavi · **Decision:** What to buy at the camp, and whether to meet the second push forward or let it break on the sandbags.

### 2.1 `name`

`Bir Tarsha II — The Gate`

`Qasr Liwan II — The Ring` set the pattern: the place is the objective. The gate is a two-tile gap and it is the name.

### 2.2 `dispatch`

None. The first town-1 mid-town dispatch is already a deviation (Qasr Liwan §0.4); II has no hook the briefing does not carry.

### 2.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The gate is a two-tile gap in the Fence between two concrete blocks, and it is yours if you can keep it for four minutes. I expect two pushes, both from the east end of the Fence Road, and the second harder than the first. | 222 |
| 2 | **Shai** | Hold the gate for four minutes. The camp buys infantry and a Lavi, and you will want both. | 90 |
| 3 | **Idit** | Ten residents are on the cross road north of the safe quarter, and it is the one quarter in the town that is nobody's. They walk in once one of ours is within four tiles of them. | 178 |
| 4 | **Shai** | Seven in inside five minutes, or the quarter is a wall and not a quarter. Do not put a mortar round near it to buy the gate. | 124 |
| 5 | **Idit** | Their mortar is on the east firing position and it is laid on the cross road. The Badlands edge is behind you, and a round that lands across the Fence costs more than any you can spend here. | 190 |
| 6 | **Shai** | The terminal's roof is worth fifteen seconds if you can spare the rifles. The gate comes first. | 95 |

- Beat 1 carries the two-wave shape (`timer_s` 150 and 270) as a forecast. It says *I expect*, so a changed cadence never makes it false.
- Beat 2 is the economy order the design asks the briefing to give (`camp`, Logistics, `inf_squad` and `mbt_lavi`).
- Beat 3 is the evacuation set-up. **The design (§5.2) says the ten start in `safe_quarter` and also that seven must get out of it; an evacuation needs them to start outside the destination. The sheet assumes they start on the cross road and walk into the quarter.** Open point D-BN1.
- Beat 4 gives the count (7 of 10) and the clock (300 s) and names the restraint as a cost.
- Beat 5 is the mortar's position and the flagged line. It does not say what the round would hit.
- Beat 6 is the secondary (`capture terminal_roof`, 15 s) as a price.

**The JSON string, to be pasted whole (904 characters, splits into 6 beats by a port of `briefingBeats`):**

> The gate is a two-tile gap in the Fence between two concrete blocks, and it is yours if you can keep it for four minutes. I expect two pushes, both from the east end of the Fence Road, and the second harder than the first. Hold the gate for four minutes. The camp buys infantry and a Lavi, and you will want both. Ten residents are on the cross road north of the safe quarter, and it is the one quarter in the town that is nobody's. They walk in once one of ours is within four tiles of them. Seven in inside five minutes, or the quarter is a wall and not a quarter. Do not put a mortar round near it to buy the gate. Their mortar is on the east firing position and it is laid on the cross road. The Badlands edge is behind you, and a round that lands across the Fence costs more than any you can spend here. The terminal's roof is worth fifteen seconds if you can spare the rifles. The gate comes first.

### 2.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is read once as an order and once as a toast, `OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `hold_the_gate` | `hold_for` · `the_gate`, 240 s · primary | Hold the gate for four minutes | OBJECTIVE COMPLETE — Hold the gate for four minutes | live |
| `seven_in` | `evacuate_before` · `safe_quarter`, count 7, 300 s · **primary, failable** | Walk seven residents into the safe quarter | OBJECTIVE COMPLETE — Walk seven residents into the safe quarter | live |
| `take_the_roof` | `capture` · `terminal_roof`, 15 s · secondary | Hold the terminal's roof for fifteen seconds | OBJECTIVE COMPLETE — Hold the terminal's roof for fifteen seconds | live |

- `hold_the_gate` is the design's own phrase. As a toast it reads *OBJECTIVE COMPLETE — Hold the gate for four minutes*, which is true.
- `seven_in` is written for the reading in beat 3. If the design keeps the ten *inside* the destination, the text becomes *Keep seven residents in the safe quarter*, and `level-scripter` rules.

### 2.5 `debrief`

> **victory** · Idit: *"The gate is ours, and the safe quarter is still a quarter. The camp stays, and the next time that road is open it will be open from our side."* (141)

> **defeat** · Shai: *"The gate is theirs again, and the quarter with it. The camp does not carry; the ground does."* (92)

Neither line claims the roof or the count. The defeat covers the gate falling, the residents' clock, a Conduct collapse and the time limit. Status `live`.

### 2.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Bir Tarsha II — The Gate` · *2 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | briefing, beats 1 to 6 | deploy screen, then the commander bar | live |
| `timer_s` 150 → `bt2_first_push` (`spawn` wave 1) | `toast` | system | `A push is coming from the fence road` | trigger `label` | live |
| same wave | `radio` | **Idit** | "First push, from the east end of the Fence Road. It is the lighter of two, and it is meant to show us where the weight goes." | `enemy.waves[].say` | live |
| wave 1 spawns | `toast` | system | `enemy reinforcements — 4 units inbound · <place>` | alert layer, hard-coded | live |
| `timer_s` 270 → `bt2_second_push` (`spawn` wave 2) | `toast` | system | `The second push is on the road` | trigger `label` | live |
| same wave | `radio` | **Idit** | "Second push. A charge squad is walking with it, and it is walking at the terminal, not at you." | `enemy.waves[].say` | live |
| `objective(take_the_roof, complete)` | `radio` | **Shai** | "The roof is ours. Every window on the Fence Road is now looking at us from our own side." | `objectives[].say` | live |
| `evacuated` (a resident reaches the safe quarter) | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(seven_in, failed)` | `radio` | **Idit** | "The quarter is not open. A gate with nobody behind it is a wall, and there is nothing left in this town for us to hold it for." | `objectives[].say_on_fail` | live |
| `SimEvent` mortar fires on the cross road | `radio` | **Idit** | "The cross road is under the tube. Count the seconds between rounds and move the residents inside them." | a line on a `SimEvent` | engine |
| `missionEnd` | `debrief` | Idit (victory) / Shai (defeat) | §2 debrief | end screen | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `bt2_first_push` | `timer_s` 150 → `spawn` | `A push is coming from the fence road` | 36 |
| `bt2_second_push` | `timer_s` 270 → `spawn` | `The second push is on the road` | 30 |

---

## 3. `bir_tarsha_3_clearance`: Bir Tarsha III · Two Houses

`clearance` · day · **Captain** · requires **R I** · produces **R M C X H** · `target_minutes` 6 · economy: no · **Decision:** Split the force and enter both blocks together, or take one and fight for the second.

### 3.1 `name`

`Bir Tarsha III — Two Houses`

The outline's own name. Lead ruling 6 makes the phase `clearance`, so the id is `bir_tarsha_3_clearance` and not `_buildup` (MDD §4).

### 3.2 `dispatch`

None. The outline asks for none, and a mid-town `dispatch` is a deviation the lead has not asked for.

### 3.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Two apartment blocks stand ten tiles apart in the camp quarter, with two of the people taken at First Light in each. I can place both doors and the guard on each, and nothing inside. | 182 |
| 2 | **Shai** | Take out the guard on each door, and bring three of the four to the extraction on the north edge. You are not bringing out fewer than three. | 140 |
| 3 | **Idit** | The first shot at either block warns the other inside twenty seconds, and their firing positions cover the lane between. A missile team on each roof looks into any yard you cross. | 179 |
| 4 | **Shai** | So split and go in together, or take one and fight for the second. The second is slower, louder and dearer. | 107 |
| 5 | **Idit** | Both blocks are lived in, and the one that holds the taken holds the neighbours as well. A cannon round into either is fourteen Conduct. | 136 |
| 6 | **Shai** | Fifteen is the line. One hit on a block is fourteen, and a second hit ends the mission. | 87 |

- Beat 1 follows L-16's rule for the taken: *"two of the people taken at First Light"*, no role, no rank, no sex, no pronoun. The two blocks are *apartment blocks*, not a place.
- Beat 2 is `count 3` and the extraction (`bt3_extract`). It does not call the guards *hostage-takers*; they are guards.
- Beat 3 is the design's hard requirement: the blocks warn each other (20 s), the firing positions cover the lane, and a roof team sits on each block.
- Beat 4 is the decision, said as a price and not a verdict.
- Beat 5 is the apartment's `roe_penalty` 14. It says *lived in* and does not describe who lives there.
- Beat 6 is the ceiling (15): 14 is under, a second hit is over. Strictly above the threshold fails.

**The JSON string, to be pasted whole (836 characters, splits into 6 beats by a port of `briefingBeats`):**

> Two apartment blocks stand ten tiles apart in the camp quarter, with two of the people taken at First Light in each. I can place both doors and the guard on each, and nothing inside. Take out the guard on each door, and bring three of the four to the extraction on the north edge. You are not bringing out fewer than three. The first shot at either block warns the other inside twenty seconds, and their firing positions cover the lane between. A missile team on each roof looks into any yard you cross. So split and go in together, or take one and fight for the second. The second is slower, louder and dearer. Both blocks are lived in, and the one that holds the taken holds the neighbours as well. A cannon round into either is fourteen Conduct. Fifteen is the line. One hit on a block is fourteen, and a second hit ends the mission.

### 3.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is read once as an order and once as a toast, `OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `bring_three_out` | `evacuate_before` · `bt3_extract`, `hostages`, count 3 · **primary, failable** | Bring three of the four taken out to the extraction | OBJECTIVE COMPLETE — Bring three of the four taken out to the extraction | live |
| `guard_west` | `eliminate_hvt` · `bt3_guard_west` · primary | Take out the guard on the west block | OBJECTIVE COMPLETE — Take out the guard on the west block | live |
| `guard_east` | `eliminate_hvt` · `bt3_guard_east` · primary | Take out the guard on the east block | OBJECTIVE COMPLETE — Take out the guard on the east block | live |
| `keep_the_blocks` | `no_collateral_above` 15 · **primary, failable** | Lose no more than 15 Conduct | OBJECTIVE COMPLETE — Lose no more than 15 Conduct | live |

- **One evacuation objective, not two.** The design's ladder lists `evacuate_before` ×2, but G-8 (`evacuate_before` counts every civilian, not only a block's) makes a second identical objective redundant: both would complete on the same three. The sheet writes one; open point D-BN2 for `level-scripter`.
- `guard_west` and `guard_east` name the guard on a door, not a person. The text never says *kill*; the mission's verb is the objective type.

`hostages_place`: `the north of the camp quarter` (29 characters, live).

### 3.5 `debrief`

> **victory** · Idit: *"Three or four came back down the lane. Two houses were never meant to be taken at once, and the camp quarter has that to remember."* (130)

> **defeat** · Shai: *"Not today. The blocks are warned and the lane is covered, and the people in them are exactly where they were."* (109)

The victory line holds for 3 or 4 out. The defeat line holds for the clock, the ceiling and the time limit, and it makes no claim about how many reached the extraction. Status `live`.

### 3.6 `aftermath`

> *Three came back from the camp quarter, or four, and the Marj counted each of them.*  (82 characters)

**Held** (a mid-town `aftermath` is a deviation, as in Qasr Liwan §0.4). Written for the lead to strike or keep; if struck, it moves to the victory debrief. *Three, or four* is exact: a win needs at least three. Status `live`.

### 3.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Bir Tarsha III — Two Houses` · *4 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | briefing, beats 1 to 6 | deploy screen, then the commander bar | live |
| `first_contact` on the west block → `bt3_west_warns_east` (`commit` the east guard after 20 s) | `toast` | system | `The east block has been warned` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "Shots at the west block. The east block heard them, and it is moving a team to its yard." | `triggers[].say` | live |
| `first_contact` on the east block → `bt3_east_warns_west` | `toast` | system | `The west block has been warned` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "The west block is up. Count twenty seconds from that last shot." | `triggers[].say` | live |
| `objective(guard_west, complete)` | `radio` | **Shai** | "West door is open. Do not stop in the yard." | `objectives[].say` | live |
| `objective(guard_east, complete)` | `radio` | **Shai** | "East door is open. The lane is the dangerous half." | `objectives[].say` | live |
| `evacuated` (one of the taken reaches the extraction) | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(bring_three_out, complete)` | `radio` | **Idit** | "Three on the north edge. Count them again when you are clear of the lane." | `objectives[].say` | live |
| `objective(bring_three_out, failed)` | `radio` | **Idit** | "There are not three to bring any more. Whatever this was, it was not a count we could afford to be wrong about." | `objectives[].say_on_fail` | live |
| `objective(keep_the_blocks, failed)` | `radio` | **Shai** | "That is past fifteen. A block with a cannon round in it is not the thing we came to carry out." | `objectives[].say_on_fail` | live |
| `SimEvent identified` on a roof missile team | `radio` | **Idit** | "Missile team on the roof. It sees into the yard and nowhere else." | a line on a `SimEvent` | engine |
| `missionEnd` | `debrief` | Idit (victory) / Shai (defeat) | §3 debrief | end screen | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `bt3_west_warns_east` | `first_contact` (west) → `commit` east | `The east block has been warned` | 30 |
| `bt3_east_warns_west` | `first_contact` (east) → `commit` west | `The west block has been warned` | 30 |

---

## 4. `bir_tarsha_4_clearance`: Bir Tarsha IV · The Blade Line

`clearance` · day · **Captain** · requires **R I** · produces **R M C X** · `target_minutes` 7 · economy: **yes**: a camp at the corral; Logistics buys replacement infantry only · **Decision:** Which end of the belt to open first, what to do about the berms, and how to answer the fire that comes out of the hamlet's lee.

### 4.1 `name`

`Bir Tarsha IV — The Blade Line`

The outline's own name, and the lead's mission. *Blade* is the dozer's own word; the line is the one the blades cut.

### 4.2 `dispatch`

None. The lead's dozer mission has no story hook the orders voice cannot carry.

### 4.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Between the Fence and the hamlet is a belt of works thirty tiles long: firing positions, posts, workshops and berms. If you found the east works crew I can say which are theirs, and if you did not, all of them are. | 214 |
| 2 | **Shai** | Four D9s are yours for this, and the battalion goes with them. Level every work in the belt and bring the blades through to the far gate, and lose two blades and the work is over. | 179 |
| 3 | **Idit** | A hamlet stands north of the belt, eight tiles from the nearest post, and it is lived in. I expect fire out of its lee as soon as the first blade stops, and it is meant to be answered into a house. | 197 |
| 4 | **Shai** | Do not answer into a house. A house is six Conduct, two are twelve, and a third is the mission. | 95 |
| 5 | **Idit** | A T-wall closes the road at the east end, and a D9 will cut it where wheels cannot cross it. Until it is down the far gate is out of reach, and three shafts in the belt vent behind whoever is looking at the wall. | 212 |
| 6 | **Shai** | Berms are low and a blade will not take one by passing it, so each is an order. Shafts down, works level, blades through. | 121 |

- Beat 1 hedges the carry. The ledger may or may not hold `bt_works_crew`, and a static line cannot claim it.
- Beat 2 states the lead's rulings: four on loan (ruling 4) and the tolerance of two (ruling 2, GH-1439). *Lose two* is the escort's `fail_after_losses`. The first sentence of the pair gives the work objectives and the escort in one breath.
- Beat 3 is the bait, said as a prediction. The hamlet is the nearest `h` to the belt (eight tiles from the zone; no house within 2 tiles, MDD assertion 1). It does not say who is in the houses.
- Beat 4 is the ceiling (12) in terms of the house's `roe_penalty` 6: exactly two at the line, and the third over.
- Beat 5 is the T-wall and the shafts. *Cut where wheels cannot cross* is `far_gate` unreachable wheeled until the `T` tiles fall (MDD §3.3).
- Beat 6 is the berm rule (`low_profile` tiles need an explicit `demolish`, G-BT1, 13 tiles) and the three objectives as a closing sequence.

**The JSON string, to be pasted whole (1023 characters, splits into 6 beats by a port of `briefingBeats`):**

> Between the Fence and the hamlet is a belt of works thirty tiles long: firing positions, posts, workshops and berms. If you found the east works crew I can say which are theirs, and if you did not, all of them are. Four D9s are yours for this, and the battalion goes with them. Level every work in the belt and bring the blades through to the far gate, and lose two blades and the work is over. A hamlet stands north of the belt, eight tiles from the nearest post, and it is lived in. I expect fire out of its lee as soon as the first blade stops, and it is meant to be answered into a house. Do not answer into a house. A house is six Conduct, two are twelve, and a third is the mission. A T-wall closes the road at the east end, and a D9 will cut it where wheels cannot cross it. Until it is down the far gate is out of reach, and three shafts in the belt vent behind whoever is looking at the wall. Berms are low and a blade will not take one by passing it, so each is an order. Shafts down, works level, blades through.

### 4.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is read once as an order and once as a toast, `OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `blades` | `escort` · `blades` → `far_gate`, `fail_after_losses` 2, `until` [`clear_works`, `drop_shafts`] · **primary, failable** | Bring the four blades through to the far gate | OBJECTIVE COMPLETE — Bring the four blades through to the far gate | live |
| `clear_works` | `raze` · `fence_works`, 390 s · **primary, failable** | Level the works along the Fence Road in six and a half minutes | OBJECTIVE COMPLETE — Level the works along the Fence Road in six and a half minutes | live |
| `drop_shafts` | `collapse` · `fence_works`, 390 s · **primary, failable** | Bring down the three shafts in the works | OBJECTIVE COMPLETE — Bring down the three shafts in the works | live |
| `keep_the_hamlet` | `no_collateral_above` 12 · **primary, failable** | Lose no more than 12 Conduct | OBJECTIVE COMPLETE — Lose no more than 12 Conduct | live |

- The escort's fields are GH-1439 (PR 1454): `fail_after_losses` and `until`. **The objective text does not depend on the field shapes**, so the sheet survives if the lead rules a different shape.
- `clear_works` and `drop_shafts` name their clock as a duration, as `deir_amun_3_subterranean`'s *inside five minutes* does. 390 s is six and a half minutes.

### 4.5 `debrief`

> **victory** · Shai: *"The belt is level and the blades are through. Nothing stands on the Fence Road that was not put there by the people who left it."* (128)

> **defeat** · Idit: *"Not this time. Whatever was left standing on the Fence Road is still facing the gate, and the blades that did not come back are not ours to count."* (146)

Neither line claims how many blades survived: the win allows one lost, the defeat covers the escort (two lost), either work objective's clock, the ceiling and the time limit. The victory line claims nothing about homes beyond the belt. Status `live`.

### 4.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Bir Tarsha IV — The Blade Line` · *4 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | briefing, beats 1 to 6 | deploy screen, then the commander bar | live |
| `first_contact` (the first blade halts) → `bt4_lee_opens` (`commit` the missile teams) | `toast` | system | `Fire is coming from the hamlet's lee` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "Missile teams out of the hamlet's lee, on the lane. Do not answer toward the houses. Put the escort between the blades and them." | `triggers[].say` | live |
| `timer_s` 240 → `bt4_vent_opens` (`dismount` the shaft militia) | `toast` | system | `A shaft has opened behind the escort` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "A shaft vented behind you. It is in the dead ground south of the hamlet, and it has been waiting for the blades to pass." | `triggers[].say` | live |
| `objective(clear_works, complete)` | `radio` | **Shai** | "The belt is level. Everything on that strip is flat except the wall." | `objectives[].say` | live |
| `objective(drop_shafts, complete)` | `radio` | **Idit** | "Three shafts down. Nothing in the belt runs under the road any more." | `objectives[].say` | live |
| `objective(blades, complete)` | `radio` | **Shai** | "Blades through the fence line. Count them on the far side." | `objectives[].say` | live |
| `objective(blades, failed)` | `radio` | **Idit** | "That is two blades gone. With half the line left, the work cannot be finished from the near side." | `objectives[].say_on_fail` | live |
| `objective(keep_the_hamlet, failed)` | `radio` | **Shai** | "That is past twelve. There is a house in the count that should not be in it." | `objectives[].say_on_fail` | live |
| a blade is lost (one of the four) | `radio` | **Shai** | "One blade down. Another and it is over." | a line on a `SimEvent` (unit lost) that is not a loss of the objective | engine |
| `missionEnd` | `debrief` | Shai (victory) / Idit (defeat) | §4 debrief | end screen | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `bt4_lee_opens` | `first_contact` → `commit` missile teams | `Fire is coming from the hamlet's lee` | 36 |
| `bt4_vent_opens` | `timer_s` 240 → `dismount` | `A shaft has opened behind the escort` | 36 |

---

## 5. `bir_tarsha_5_subterranean`: Bir Tarsha V · Under the Fence

`subterranean` · dusk · **Captain** · requires **R I** · produces **R M C X I H** · `target_minutes` 7 · economy: no · **Decision:** The order of the charges, and whether to walk the person out of the chamber and take the block commander before the last charge ends the mission.

### 5.1 `name`

`Bir Tarsha V — Under the Fence`

The outline's own name. *Under the Fence* says where; there is no verb to argue with.

### 5.2 `dispatch`

None. V is the act's last mission and carries an `aftermath` instead.

### 5.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Five routes run under the Fence Road toward the border. One was dug wide enough for a truck, which is the one that matters, and it is as far east as they could take it. | 168 |
| 2 | **Shai** | Bring all five down inside six and a half minutes. The engineers take the charges, and the rest of you keep them alive until they are set. | 138 |
| 3 | **Idit** | The engineers' survey found a concrete chamber at the head of the east route, with one person inside, alone. It is on the surface and it is not on the clock. | 157 |
| 4 | **Shai** | Walk that person out before the last charge goes, because the mission ends the moment the routes are down. The charges are the order; the person is yours to choose. | 164 |
| 5 | **Idit** | A block commander holds the post east of the ridge. If he is pressed he walks north, and whatever is left of the Marj's cells walks with him. | 141 |
| 6 | **Shai** | The light goes in ten minutes and the houses on the surface are lived in. More than ten Conduct lost ends it. | 109 |

- Beat 1 is G-13: the wide route is told and nothing in the sim changes. It says *as far east as they could take it* so the line is true wherever `bt5_wide`'s mouth ends up, and it gives no map reference.
- Beat 2 is the primary (`collapse fence_road`, 390 s) and `yahalom_squad` as *the engineers*, per L-10 (no new line uses the unit's real display name).
- Beat 3 is the third-star secondary, described as the design does: a surface structure (the G-5 stand-in), one person, alone. The person is never characterised (L-16 applies). It does not say whose the chamber is.
- Beat 4 states the ordering rule the mission is built on: the mission ends when the primaries do, so the person has to come out first. It is a cost, not a verdict.
- Beat 5 is the hinge the outline keeps (`bt5_block_commander`): he withdraws north when pressed. *The remnant of the Marj* is the fiction's hinge for Sur; no real death is described (L-4, dossier D-1).
- Beat 6 is the ceiling (10) and the light, as consequence only.

**The JSON string, to be pasted whole (882 characters, splits into 6 beats by a port of `briefingBeats`):**

> Five routes run under the Fence Road toward the border. One was dug wide enough for a truck, which is the one that matters, and it is as far east as they could take it. Bring all five down inside six and a half minutes. The engineers take the charges, and the rest of you keep them alive until they are set. The engineers' survey found a concrete chamber at the head of the east route, with one person inside, alone. It is on the surface and it is not on the clock. Walk that person out before the last charge goes, because the mission ends the moment the routes are down. The charges are the order; the person is yours to choose. A block commander holds the post east of the ridge. If he is pressed he walks north, and whatever is left of the Marj's cells walks with him. The light goes in ten minutes and the houses on the surface are lived in. More than ten Conduct lost ends it.

### 5.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is read once as an order and once as a toast, `OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `all_five` | `collapse` · `fence_road`, 390 s · **primary, failable** | Bring down the five routes under the Fence Road in six and a half minutes | OBJECTIVE COMPLETE — Bring down the five routes under the Fence Road in six and a half minutes | live |
| `keep_the_surface` | `no_collateral_above` 10 · **primary, failable** | Lose no more than 10 Conduct | OBJECTIVE COMPLETE — Lose no more than 10 Conduct | live |
| `walk_the_person_out` | `evacuate_before` · `chamber_refuge`, `hostages`, count 1, 330 s · secondary, `carries` | Walk the person in the chamber out to the refuge | OBJECTIVE COMPLETE — Walk the person in the chamber out to the refuge | live |
| `take_the_commander` | `eliminate_hvt` · `bt5_block_commander` · secondary | Take the block commander | OBJECTIVE COMPLETE — Take the block commander | live |

- `walk_the_person_out` is the line the design hangs the third star on, so its text names the act and nothing about the person (L-16).
- `take_the_commander` calls him by his post, which is how the outline names him. It does not name him, because he has no name in canon: Sahim, the Marj's man, was taken at Beit Sahwan IV (D-BT1).

`hostages_place`: `the Fence Road` (14 characters, live).

### 5.5 `debrief`

> **victory** · Idit: *"The routes under the Fence Road are down. What was left of the Marj went north, and the brigade did not follow."* (111)

> **defeat** · Shai: *"Not tonight. The routes are still open under the Fence, and the dusk is theirs now."* (83)

The victory line claims neither the person nor the commander, because either secondary can be missed on a win. The defeat covers the collapse clock, the ceiling and the time limit. Status `live`.

### 5.6 `aftermath`

> *The Fence Road is quiet, and the border it ran beside is only a fence again. The Marj is not finished with, but it is behind the brigade, and the brigade has somewhere else to go.*  (179 characters)

Closes the town and Act I: the Marj is behind the brigade, which is what the outline's last beat needs. It does not name Sur, the Major or the remnant's direction (ruling 5: the promotion lives in Sur's briefing). Status `live`.

### 5.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Bir Tarsha V — Under the Fence` · *2 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | briefing, beats 1 to 6 | deploy screen, then the commander bar | live |
| `casualties_pct` on the command post → `bt5_commander_moves` (`withdraw_to` north) | `toast` | system | `The block commander is pulling north` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "The post east of the ridge is emptying north. Whoever left it carries the remnant with him, and he is not coming back." | `triggers[].say` | live |
| `zone_entered(chamber_refuge)` → `bt5_chamber_reached` | `toast` | system | `The chamber is in reach` | trigger `label` | live |
| same trigger | `radio` | **Shai** | "You are at the chamber. Walk that one person out before you touch the last route." | `triggers[].say` | live |
| `evacuated` (the person reaches the refuge) | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(walk_the_person_out, complete)` | `radio` | **Idit** | "One out and walking. That is the one that counts, and it is not on any clock." | `objectives[].say` | live |
| `objective(take_the_commander, complete)` | `radio` | **Shai** | "The post is ours. The routes under it can be taken in any order now." | `objectives[].say` | live |
| `objective(all_five, complete)` | `radio` | **Idit** | "All five down. The Fence Road runs over nothing." | `objectives[].say` | live |
| `objective(all_five, failed)` | `radio` | **Shai** | "The clock is out. Whatever is still open under the Fence is open to anyone." | `objectives[].say_on_fail` | live |
| `objective(keep_the_surface, failed)` | `radio` | **Shai** | "That is past ten. The houses above the routes are the count now." | `objectives[].say_on_fail` | live |
| `SimEvent route opens` on the wide route | `radio` | **Idit** | "This one is wide. The others were dug for men; this one was dug for a truck." | no trigger can watch a route opening | engine |
| `missionEnd` | `debrief` | Idit (victory) / Shai (defeat) | §5 debrief | end screen | live |
| `missionEnd(victory)` | `aftermath` | narrator | §5 aftermath | victory banner on the after-action report | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `bt5_commander_moves` | `casualties_pct` → `withdraw_to` | `The block commander is pulling north` | 36 |
| `bt5_chamber_reached` | `zone_entered(chamber_refuge)` | `The chamber is in reach` | 23 |

---

## 6. Ambient lore: secondary locations

Each is a `radio` line on a say-only trigger. A trigger needs a `do`, and a say-only trigger does not exist, so all four are `engine`. None is needed by a mission.

| place | event | speaker | line | needs | status |
|---|---|---|---|---|---|
| the safe quarter | `zone_entered(safe_quarter)` the first time a ground unit enters it (II) | **Idit** | "Three lanes, no firing positions and no flag on any roof. It is the one place in Bir Tarsha nobody has claimed, and it should stay that way." | a say-only trigger (a trigger needs a `do`) | engine |
| the gate terminal roof | `zone_entered(terminal_roof)` | **Idit** | "From the roof you can see the whole of the Fence Road to the east, and the whole of the Badlands to the south. Look at one and not the other." | same | engine |
| the hamlet | `zone_entered(hamlet)` (IV) | **Shai** | "Houses. Nothing in them is ours to hit and nothing in them is the target." | same | engine |
| the east works | `zone_entered(works_east)` (I) | **Idit** | "The Fence Road ends in a ring of posts. Whoever drew it did not draw it to be walked into." | same | engine |

---

## 7. EVA announcements and barks

- **EVA.** No new caption. The five recorded announcements and the caption-only rest are hard-coded (`data/audio.json` `announcements`) and read the same in every town.
- **Barks.** None authored. Bark lines are keyed by unit role and owned by WP-AU1; the doctrine-not-people rule heads any bark sheet before a line is written. The four units this town adds to a force the player has not seen before (`dozer_d9`, `ifv_namer`, `mbt_lavi`, `yahalom_squad`) already have voice classes.

---

## 8. Re-brief of landed text

**Not applied in this branch.** The `aftermath` field is outside this agent's three JSON fields, so its owner is `mission-author`; it lands with this town's missions, because until then the old line is true.

### 8.1 `deir_amun_3_subterranean.json` `aftermath`

The Qasr Liwan sheet (§9) flagged this line and left it to this town: it promotes Shai at Deir Amun III, and under L-3 the Captain runs to `bir_tarsha_5_subterranean` (the Major promotion belongs to Sur's briefing, ruling 5). It also says *"The Marj is quiet. Sur is not."*, which a fifth Marj town now falsifies. The outline gives Deir Amun III an `aftermath` that tells the brigades going home in the spring (P2-d). This is it.

**Old** (173):

> *Six routes under the junction, and by morning none of them went anywhere. Brigade put a third star on the slip and said nothing else about it. The Marj is quiet. Sur is not.*

**New** (185):

> *Six routes under the junction, and by morning none of them went anywhere. The brigades went home in the spring, and one battalion stayed on the Cut. The Marj was quiet until the autumn.*

- The first sentence is kept as shipped.
- Bir Tarsha I's `dispatch` picks the thread up (*"went home in the spring and came back in the autumn"*), so the pair reads as one story told twice.
- **The Cut** is named in Qasr Liwan II's `dispatch` first; this is its second use, in the narrator's voice.
- **Also required, not text:** `data/campaign/commander.json` `ranks[0].until_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean` (MDD §7.3 item 2). Its `promotion_line` is already Idit's *"Third star. Nobody said promotion — they handed him a wider map and a longer list of towns."* and fires on the first Sur mission, which is where ruling 5 wants it.

**Optional, not written:** one Idit line in `tel_marum_1_recon`'s briefing that the remnant went north. The shipped briefing opens *"Sur begins at the pass"* and carries no rank, so there is nothing to correct; the thread can be left to the Sur sheet.

---

## 9. GDD amendments

§2 (the towns list) and §11 (story) gain Bir Tarsha with the town's content, so the GDD never lists a town the board cannot show. The exact wording is `mission-author`'s with `world.json`: a town in the `marj` region, five missions, phases 2, 3, 5, 5, 6, the last unlocking Sur (MDD §7.3 item 1). This sheet adds no canon beyond it.

---

## 10. Defects and open points found while writing

| id | where | what | owner |
|---|---|---|---|
| D-BN1 | MDD §5.2 | II says the ten residents start in `safe_quarter` and that seven must get out of it. An evacuation needs them to start outside its destination. The sheet writes them on the cross road, walking in. | `level-scripter` |
| D-BN2 | MDD §4 | III lists `evacuate_before` ×2; G-8 makes a second one redundant (both would complete on the same count). The sheet writes one and flags it. | `level-scripter` |
| D-BN3 | `deir_amun_3_subterranean.json` | the shipped `aftermath` promotes Shai a town early and says the Marj is quiet (§8.1). | `mission-author` |
| D-BN4 | MDD §3.3 | the T-wall continues the ridge at one `b` foot gap; IV's beat 5 says *a D9 will cut it where wheels cannot cross it*. If the lead re-rules the barrier, the line goes with it. | `level-scripter` |

---

## 11. Verification

- **Every beat** is at most two sentences and 240 characters, and each briefing splits into exactly the beats written, checked with a port of `briefingBeats` (`packages/app/src/ui/loading.ts`) in a script, not by eye. Briefing lengths: 893, 904, 836, 1023, 882 characters, all inside the shipped 385 to 1,225.
- **Every trigger `label`** is at most 48 characters with no full stop (script).
- **Every `say`, `dispatch`, `aftermath` and `debrief` line** is at most 240 characters (script).
- **Status counts:** 62 `live` rows, 9 `engine` rows (the 5 trigger-table ones and the 4 in §6), 0 `schema`.
- **Read aloud, in beat order:** Idit's picture, Shai's plan, alternating, in all five.
- **Not run:** `pnpm validate:data` and `pnpm test`, because no data file changed. A docs-only change.
