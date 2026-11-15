# Qasr Liwan: Narrative Trigger Sheet

**Act I · The Marj Strip · Ashwar Front · *The Long Ground*, town 1 of 4 new, the Marj's
second town in campaign order (after Beit Sahwan, before Khan Rafid). Shai Hammai is a
Captain in all five missions and is not promoted here (L-3).**

**Date:** 2026-11-15 · **Author:** `narrative-designer` · **Status:** authored text, written
against an approved design. The lead approved the arc (PR 1438) and this town's Mission
Design Document (PR 1445: Option A *Five Doors*, every O-QL default) on 15 Nov 2026.

**Nothing in this pass was applied to any data file.** None of the five
`data/missions/qasr_liwan_*.json` files exists, no `qasr_liwan` map exists, and the town is
not yet in `world.json` or in `mission.schema.json`'s `town` enum. There is no `name`,
`briefing` or `objectives[].text` to edit, so `pnpm validate:data` has nothing of this
sheet's to check. `mission-author` pastes every string below when the files land. The
re-briefs in §9 and the GDD block in §10 are exact text, also unapplied, for the reasons
given there.

**Upstream:** `docs/campaign/qasr_liwan/design.md` (renamed from `mdd.md` in this branch,
per O-QL7): §0, §2, §4, §5 and its story hooks, §7 and §8.
`docs/campaign/the_long_ground/arc-outline.md` and `transposition.md`. `dossier.md` was
**not** read, and nothing here draws on it.
**Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md` §0, §2.1 to
§2.4 and §3.1, and `docs/GDD.md` §2 and §11.
**Format:** follows `docs/campaign/khan_rafid/narrative.md`, the nearest landed sheet.

**Downstream:**
- `mission-author`: five `name`s, five briefings, 23 objective texts, three `dispatch`es,
  two `aftermath`s, ten `debrief` lines, every `say`, two `hostages_place`s; the
  `wadi_halam_3_counterraid` debrief line and the Khan Rafid I dispatch (§9).
- `level-scripter`: trigger ids, labels and bindings, and the five defects found while
  writing (§11, D-1 to D-5).
- `sim-guard`: G-QL2 and the say-only trigger the ambient lore needs (§11).
- `render-vfx`: nothing new.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code. The text reaches a player the moment `mission-author` pastes it into the field named in the row |
| `schema` | the field is specced and the runtime ignores it |
| `engine` | nothing can fire the line today: a line on a `SimEvent`, on a route opening, on an objective completing as a trigger condition (G-QL2), or a say-only trigger |

Checked against this worktree, not recalled:
- `mission.schema.json` `$defs/say` is `{ speaker ∈ shai | idit | net | enemy, text ≤ 240 }`.
- A `say` is carried by `objectives[].say`, `objectives[].say_on_fail`, `triggers[].say`
  (on the trigger, not under `do`), `enemy.waves[].say`, and `debrief.victory` /
  `debrief.defeat`.
- `dispatch` and `aftermath` are strings of 240 or fewer. `hostages_place` is 40 or fewer
  and is read by the board as "{N} came back at {place}." (`campaign.ts` `hostagesLine`,
  `en.json` `world.hostages.back`).
- A trigger's `label` is 48 or fewer with no full stop, and it is what the feed prints. An
  unlabelled trigger prints nothing (`ui/mission-notice.ts` `triggerLabel`).
- Waves and arrivals are worded by the alert layer (`alert.wave`), and a civilian reaching a
  refuge prints `clear (1)` (`notice.evacuated`).
- A trigger needs a `do` (`required: ["on", "do"]`) and `do.group` names **one** group.

**`schema` is 0 in this sheet.** Every row is `live` or `engine`. The count is §12.

**No `engine` line here can ride a tutorial step.** The step machine
(`data/schemas/tutorial.schema.json`, `tutorial/runtime.ts`) is the only condition-gated
mid-mission text engine, and the README gates it to the tutorial mission, so it is not
available to these five.

### 0.2 The two voices

The deploy screen and the commander bar show one speaker at a time, and `briefing` is one
string. So in the JSON each briefing reads as Shai's orders end to end. In this sheet each
briefing is a two-hander with one speaker per beat, because it has to be written and read
aloud that way: Idit's picture, Shai's plan, alternating, closing on a cost.

- **Shai, Captain.** Second person, present tense, one tile-level fact, a cost at the end.
- **Idit.** What is known, how well, and what knowing more costs. **She never gives an
  order**, in the briefing or on the radio.
- **No `enemy` line in this town.** Nadir Sahim was taken at Beit Sahwan IV (D-QL1). GDD §11:
  in a town that neither opens nor closes a front, *"the front's adversary is present only
  through what he leaves … and he does not speak."* Sahim is not named anywhere in this
  sheet. The two adversaries on the ground are job titles, **the yard commander** and **the
  grid chief** (L-5).

### 0.3 The rules that bind every line here

- **Doctrine, never a people.** The Ashwar Front is tunnels, ambush and human terrain. The
  people of Qasr Liwan are people who live in a city two armies are fighting over. No line
  gives a faction a population, a faith, an accent or an idiom.
- **The person freed in QL I is never characterised (L-16).** Every line says "one of the
  people taken at First Light", "the person" or "one person". No role, rank, unit, age or
  sex, and no gendered pronoun. `transposition.md` §4 R1 calls the person a soldier; the
  design overrules it, and so does this sheet.
- **No real hostages.** The taken are the fictional people of First Light (D12). No line
  depicts harm to them.
- **The clinic (L-11).** Idit's picture names the yard. No line says anything about what is
  or is not inside or under the clinic. The clinic appears only as a building that must
  stand and as a wall that rounds land beside.
- **The relief depot (L-12).** It is "the relief depot", a walled warehouse yard. No agency is
  named or implied, no mark is described, and no line suggests that the depot, its staff or
  anyone in the city shelters the enemy. A route venting in its yard is **geometry**. The one
  line that mentions it says the depot is not the target.
- **Names.** No proper noun is coined. *Qasr Liwan* and *the Cut* are L-2 canon. Every
  other place is a feature from `design.md` §3.2: the north edge, the north road, the coast
  road, the seam, the south quarter, the south street, the checkpoint, the handover ground,
  the water point, the forward ground, the clinic yard, the forecourt, the shore quarter,
  the pump yard and the relief depot.
- **The Cut is first named in QL II's `dispatch`.** Nothing in QL I uses the word.
- **L-10.** No new line uses the brigade's number or the word *Yahalom*. The lines say "the
  brigade" and "the engineers". The unit card still reads *Yahalom Engineers*; that is
  L-10's separate issue.
- **Conduct, never ROE.** Each `no_collateral_above` text states its number.
- **Static text must hold for every outcome (D9).** No `debrief`, `aftermath` or `say`
  assumes a secondary was done, that exactly the minimum walked out, or that the pause was
  never broken. Each defeat line holds for every way the mission can be lost: its clock,
  its ceiling, or the time limit.
- **Restraint is consequence.** A line says what a round costs, never why it is wrong.
- **The Marj is arid.** Every `o` is thorn scrub and desert trees. No olive appears.

### 0.4 Decisions recorded before the text

1. **Three `dispatch`es: I, II and III.**
   - I opens a new town, which is the house rule: all seven shipped `dispatch`es sit on the
     first mission of a town (census of `data/missions/*.json`).
   - **II and III would be the first `dispatch`es mid-town**, a deviation the lead can
     strike. II names the Cut, the design's story hook; the orders voice cannot say *"it
     will divide the Marj for the rest of the war"* without narrating. III says the pause
     was agreed, which Shai cannot say without narrating either. Struck, II's line falls back
     on beat 2 of its briefing and III's on beat 1.
   - IV and V have none.
2. **Two `aftermath`s: III and V.**
   - III's says only that four came back, the design's hook. A win needs all four, so the
     number is true on every victory.
   - V's says the water did not reach the deep routes, and it closes the town.
   - II's (T-QL2c) is written and **held** in §8, because II's victory debrief already says
     it. That keeps the banner rare: the four shipped `aftermath`s all close a town or an
     act.
   - **III's would be the first mid-town `aftermath`**, another deviation the lead can strike.
     The design asks for it, and the four coming back is the town's centre. Struck, the line
     moves into III's victory debrief.
3. **No `briefing_video`** on any of the five. `validate_data.mjs` requires the file, and
   the lead cuts these himself.
4. **`hostages_place`** on the two missions with a `hostages` evacuation:
   - QL I: `a house on the north edge` (25 characters). The board reads *"One came back at a
     house on the north edge."*
   - QL III: `the Cut` (7). The board reads *"Four came back at the Cut."*
   - Neither phrase characterises the person or people.

---

## 1. `qasr_liwan_1_recon`: Qasr Liwan I · One House

`recon` · night · **Captain** · requires **R** · produces **R M C X I H** ·
`target_minutes` 6 · no economy · Intel by doing only. **How much of the edge to look at
before going in, against a clock.**

### 1.1 `name`

`Qasr Liwan I — One House`

Town, numeral, name, as `Tel Marum I — The Gateway` and `Khan Rafid I — House Numbers`.
The design's own name, and the mission's whole size: one house and one gate.

### 1.2 `dispatch`: 171 characters

> *Beit Sahwan is held, and the man who dug it was taken at its shaft head. Up the coast road
> is the Marj's city, Qasr Liwan, prepared for years to be fought for from inside.*

Narrator, story voice. Sentence one closes the thread from Beit Sahwan IV in that
mission's own words (*the shaft head*) without naming him. Sentence two is the town's
premise as doctrine. **It does not mention the taken**: the briefing's first beat does,
and saying it here first would spend the reveal. Status `live`.

### 1.3 `briefing`: 7 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | One house on the north edge of Qasr Liwan, walled, with a single gate onto the lane, and one of the people taken at First Light is inside it. That is the whole of what I have, and I have had it for six hours. | 208 |
| 2 | **Shai** | Find the guard on that gate, then walk that one person out through it and across the north road to the extraction, eight tiles from the courtyard. You have five minutes. | 169 |
| 3 | **Idit** | The street twelve tiles west of the house is asleep, and anything of ours over that courtyard wakes it, the drone included. It wakes on its own in three minutes regardless. | 172 |
| 4 | **Shai** | So the house is looked at from the lane, never from above it. Spend the drone on the rest of the edge. | 102 |
| 5 | **Idit** | A mortar on the edge is laid on that courtyard and cannot reach the extraction, so the walk out is the dangerous half. There are posts on both approaches I cannot place, and each one you find is one the next fight does not have to. | 231 |
| 6 | **Shai** | The houses round that gate are lived in. Nothing you brought is heavy enough to cost you there, a called barrage is, and more than ten Conduct lost tonight ends it. | 164 |
| 7 | **Shai** | One person out of one gate; the street is not the objective, so do not make it one. | 83 |

Read aloud: her house, his clock, her street, his rule, her mortar, his cost, his close.

- **Beat 1 gives no source** (the design's hook): she has one house and six hours, and
  nothing else. *"One of the people taken at First Light"*, and nothing more (L-16).
- **Beat 2.** The walk from the courtyard through the north gate to `ql_extract` is 8
  tiles, and `evacuate_before` fails at 300 s (`design.md` §5.1).
- **Beats 3 and 4 are the design's one hard requirement.** `zone_entered(ql_house_yard)`
  counts aircraft (G-QL5), so a drone over the courtyard commits `street`, and
  `timer_s(180)` commits it anyway. The house is looked at from the lane.
- **Beat 5.** `ql_mortar` at (10,15) has range 16. It reaches the courtyard (about 10) and
  not `ql_extract` (about 18.4), which is QL-A8. The north road at the gate is inside its
  range, so the line says *the extraction* and not *the north road*. The posts on both
  approaches are `ql_post_tower` (the north road) and `ql_post_coast` (the coast road). The
  last clause is the carry into II, said as a cost.
- **Beat 6.** The issued force fields no weapon at or above `collateral_risk` 0.3, so the
  only Conduct risk is fire support bought with earned Intel (`design.md` §5.1). Ceiling 10.
- **Beat 7** closes on the cost.

**The JSON string, to be pasted whole (1,135 characters):**

> One house on the north edge of Qasr Liwan, walled, with a single gate onto the lane, and one of the people taken at First Light is inside it. That is the whole of what I have, and I have had it for six hours. Find the guard on that gate, then walk that one person out through it and across the north road to the extraction, eight tiles from the courtyard. You have five minutes. The street twelve tiles west of the house is asleep, and anything of ours over that courtyard wakes it, the drone included. It wakes on its own in three minutes regardless. So the house is looked at from the lane, never from above it. Spend the drone on the rest of the edge. A mortar on the edge is laid on that courtyard and cannot reach the extraction, so the walk out is the dangerous half. There are posts on both approaches I cannot place, and each one you find is one the next fight does not have to. The houses round that gate are lived in. Nothing you brought is heavy enough to cost you there, a called barrage is, and more than ten Conduct lost tonight ends it. One person out of one gate; the street is not the objective, so do not make it one.

### 1.4 Objectives

Objective ids are proposals; `mission-author` and `level-scripter` own them. Each `text` is
read once as an order on the deploy screen and once as a toast, `OBJECTIVE COMPLETE —
<text>`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `find_the_gate_guard` | `locate` · `ql_house_guard` · primary | Identify the guard on the courtyard gate | OBJECTIVE COMPLETE — Identify the guard on the courtyard gate | live |
| `walk_one_out` | `evacuate_before` · `ql_extract`, count 1, `hostages`, 300 s · **primary, failable** | Walk one person out to the north road | OBJECTIVE COMPLETE — Walk one person out to the north road | live |
| `keep_the_street` | `no_collateral_above` 10 · **primary, failable** | Lose no more than 10 Conduct | OBJECTIVE COMPLETE — Lose no more than 10 Conduct | live |
| `find_the_seam_post` | `locate` · `ql_post_seam` · secondary, `carries` → II | Identify the sandbag post at the coast junction | OBJECTIVE COMPLETE — Identify the sandbag post at the coast junction | live |

- `walk_one_out` says *walk*, because `CivilianFlight` walks a civilian once a soldier is
  within four tiles. It says *the north road*, because `ql_extract` lies on the road's far
  side and the order has to name ground the player can find.
- `keep_the_street` names the ceiling's number, as `design.md` §4 requires. As a toast it
  completes with the other primaries, so it reads as a report.
- `find_the_seam_post` calls the post by what it is in this mission: a sandbag berm where
  the north road meets the coast road. The word *seam* belongs to II, where the ring exists.
  It is the one tag of three with an objective; `ql_post_tower` and `ql_post_coast` carry
  silently (`design.md` §0).

`hostages_place`: `a house on the north edge` (live).

### 1.5 `debrief`

> **victory** · Idit: *"One out of Qasr Liwan. Nobody had come back out of this city
> before tonight, and nobody gave us this one."* (105)

> **defeat** · Shai: *"Not tonight. The north edge knows now what we came for, and it
> will not be asleep the next time."* (96)

- **Victory** is the design's hook: the first time the city has given anyone back. The
  second sentence corrects the verb, so the city still gives nothing. It does not repeat
  Beit Sahwan IV's *"the first time this district has given anybody back"*.
- **Defeat** holds for all three ways to lose: the 300 s clock, the ceiling, or the time
  limit. It holds even when the person was walked out before the ceiling failed, because a
  defeat writes nothing to the ledger, and the board will not count them. Status `live`.

### 1.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qasr Liwan I — One House` · *3 primary objectives* | `hud.announce` | live |
| mission start | `dispatch` | narrator | §1.2 | title card | live |
| mission start | `brief` | Idit / Shai | §1.3, beats 1 to 7 | deploy screen, then the commander bar | live |
| `zone_entered(ql_house_yard)` → `the_street_heard_the_courtyard` (`commit street` → `the_house`) | `toast` | system | `The street heard the courtyard` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "The street west of you is up and moving on the house. The mortar on the edge is laid on that courtyard, and every second in it is a second under that tube." | `triggers[].say`. **T-QL1b folded in**: the mortar warning lands at the one moment it matters | live |
| `timer_s(180)` → `the_street_wakes` (`commit street` → `the_house`) | `toast` | system | `The street west of the house is waking` | trigger `label`. If the courtyard trigger fired first, this label still reads true: the commit is repeated, and the street is still coming | live |
| same trigger | `radio` | **Idit** | "Three minutes. The street to the west is up and walking to the house." | `triggers[].say` | live |
| wave t=210 s (`moto_rpg` ×2, `north_road_w` → `ql_extract_point`) | `toast` | system | `enemy reinforcements — 2 units inbound · <place>` | alert layer, hard-coded | live |
| same wave | `radio` | **Idit** | "Two riders coming east along the north road toward the extraction. The edge is awake." | `enemy.waves[].say` | live |
| `objective(find_the_gate_guard, complete)` | `radio` | **Idit** | "That is the guard, on the lane outside the only gate. One man on one gate means they do not think anybody knows about this house." | `objectives[].say`. Her inference and her confidence | live |
| `objective(find_the_seam_post, complete)` | `radio` | **Idit** | "Sandbag post where the north road meets the coast, facing the way we would come round. It goes on the board, and it will still be there when we come back for that corner." | `objectives[].say`. The carry into II, said when it is bought | live |
| `evacuated` (the person reaches `ql_extract`) | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(walk_one_out, complete)` | `radio` | **Shai** | "One out and on the road. Get clear of the edge before it finishes waking." | `objectives[].say` | live |
| `objective(walk_one_out, failed)` | `radio` | **Idit** | "The house is gone from us. A picture like that one comes once, and I do not get to buy it twice." | `objectives[].say_on_fail`. Holds whether it failed on the clock or because the walk became impossible | live |
| `objective(keep_the_street, failed)` | `radio` | **Shai** | "That is past ten on this street, and past ten is the night." | `objectives[].say_on_fail` | live |
| `SimEvent identified` on `ql_mortar` | `radio` | **Idit** | "That is the mortar, at the west end of the edge, laid on the courtyard. Now we know what the walk out is for." | no trigger can watch a `SimEvent`, and `ql_mortar` has no objective | engine |
| `SimEvent identified` on `ql_post_tower` | `radio` | **Idit** | "Rifles on the water-tower knoll, watching the north road. That is the fast way in, and it was never empty." | same gap | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — Conduct n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | **Idit** | §1.5 | end screen, portrait and plate | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §1.5 | end screen | live |

**Trigger labels, for `validate:data`:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `the_street_heard_the_courtyard` | `zone_entered(ql_house_yard)` → `commit street` | `The street heard the courtyard` | 30 |
| `the_street_wakes` | `timer_s(180)` → `commit street` | `The street west of the house is waking` | 38 |

The two labels differ because both triggers can fire in one mission. No `first_contact` trigger exists, by design (`design.md` §5.1).

---

## 2. `qasr_liwan_2_foothold`: Qasr Liwan II · The Ring

`foothold` · **Captain** · requires **R I** · produces **R M C X E** · `target_minutes` 7 ·
**economy**: a camp, 400 + 120/min, income `coast_road` 28 and `the_cut` 20. **Hold the seam
or keep the checkpoint open; doing both splits the force.**

### 2.1 `name`

`Qasr Liwan II — The Ring`

### 2.2 `dispatch`: 216 characters

> *The brigade is closing a ring round Qasr Liwan. South of the city it is opening a road
> across the enclave, and the road has a name before it has a checkpoint: the Cut. It will
> divide the Marj for the rest of the war.*

The design's hook: the Cut is named here for the first time, as a road, and the narrator
says what it becomes. That sentence cannot be said in the orders voice. Status `live`.

### 2.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The ring round Qasr Liwan closes in two places. In the north it is the seam, where the north road meets the coast, and whatever the house raid saw on it is already on your map. | 176 |
| 2 | **Shai** | In the south it is the Cut, the checkpoint at the foot of the city, and both are held for four minutes. They are forty tiles apart and you cannot stand on both, so the camp is there to buy the second force. | 206 |
| 3 | **Idit** | Both are dug under. Crews come up inside the seam and beside the coast road, and any hold with one of them standing in it stops counting. | 137 |
| 4 | **Shai** | The seam's trouble comes on wheels down the coast road, so it wants the AT team and a jeep; the Cut is one-tile lanes, and it wants rifles. Buy for that. | 153 |
| 5 | **Idit** | Nine residents are in the south quarter's lanes. They walk once one of ours is within four tiles of them, and their way to the refuge goes through the checkpoint's lane. | 169 |
| 6 | **Shai** | Six of them through inside five minutes, or the checkpoint is a wall. The mortar, the AT missile and the Namer's cannon are billed near those houses, and the rifles are not. | 173 |

- **Beat 1 is Idit's hook:** the posts she can name came from the one house. *"Whatever the
  house raid saw"* holds for a player who saw nothing, so a static line never claims a
  carry the ledger may not hold.
- **Beat 2** names the Cut a second time, now in the orders voice, after the dispatch. The
  two holds are 240 s each and about 40 tiles apart (`design.md` §5.2).
- **Beat 3.** `ql2_vent_north` vents inside `ring_north`, and `ql2_vent_south` vents beside
  `coast_road`. A buried enemy contests nothing, and a surfaced one does. The line says
  *any hold with one of them standing in it*, which is exact. "Both holds stop" would not
  be: the south vent is far from the Cut.
- **Beat 4 is the economy order** the design asks the briefing to give. The 270 s
  `technical` comes down the coast road past the seam. The Cut's lanes are one tile wide.
- **Beat 6.** Count 6 of 9 at 300 s. `south_quarter` is flagged with no ceiling, so billing
  costs rating, not the mission. The design names the mortar and the Namer. The AT team's
  missile is `collateral_risk` 0.30, which meets the 0.3 floor, so it is named too.

**The JSON string, to be pasted whole (1,019 characters):**

> The ring round Qasr Liwan closes in two places. In the north it is the seam, where the north road meets the coast, and whatever the house raid saw on it is already on your map. In the south it is the Cut, the checkpoint at the foot of the city, and both are held for four minutes. They are forty tiles apart and you cannot stand on both, so the camp is there to buy the second force. Both are dug under. Crews come up inside the seam and beside the coast road, and any hold with one of them standing in it stops counting. The seam's trouble comes on wheels down the coast road, so it wants the AT team and a jeep; the Cut is one-tile lanes, and it wants rifles. Buy for that. Nine residents are in the south quarter's lanes. They walk once one of ours is within four tiles of them, and their way to the refuge goes through the checkpoint's lane. Six of them through inside five minutes, or the checkpoint is a wall. The mortar, the AT missile and the Namer's cannon are billed near those houses, and the rifles are not.

### 2.4 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `hold_the_seam` | `hold_for` · `ring_north` 240 · primary | Hold the seam for four minutes | OBJECTIVE COMPLETE — Hold the seam for four minutes | live |
| `hold_the_cut` | `hold_for` · `the_cut` 240 · primary | Hold the Cut checkpoint for four minutes | OBJECTIVE COMPLETE — Hold the Cut checkpoint for four minutes | live |
| `residents_through` | `evacuate_before` · `cut_refuge`, count 6 of 9, 300 s · **primary, failable** | Get six residents south of the Cut | OBJECTIVE COMPLETE — Get six residents south of the Cut | live |
| `take_the_coast_road` | `capture` · `coast_road` 15 · secondary | Take the coast road where it meets the Cut | OBJECTIVE COMPLETE — Take the coast road where it meets the Cut | live |

`cut_refuge` lies south of the checkpoint (y44 to 46), so *south of the Cut* is the ground.

### 2.5 `debrief`

> **victory** · Idit: *"The ring is shut and the Cut is open, and the first people through
> the checkpoint were the people who live behind it. Everything after this crosses that
> road."* (158)

> **defeat** · Shai: *"Qasr Liwan is not ringed tonight. Both ends of it are a day older,
> and so is everybody still in those lanes."* (108)

- **Victory** carries T-QL2c, *the Cut is the brigade's from now on*, without spending an
  aftermath. *Live behind it* is plain geography: the residents live north of the
  checkpoint.
- **Defeat** holds for the evacuation clock and for the time limit alike. Status `live`.

### 2.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qasr Liwan II — The Ring` · *3 primary objectives* | `hud.announce` | live |
| mission start | `dispatch` | narrator | §2.2 | title card | live |
| mission start | `brief` | Idit / Shai | §2.3, beats 1 to 6 | deploy screen, commander bar | live |
| `zone_entered(ring_north)` → `the_seam_reserve_comes_up` (`commit seam_reserve` → `seam_point`) | `toast` | system | `The seam's reserve is coming out of the houses` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "Three more out of the houses at the seam's back. They were waiting for somebody to stand on it." | `triggers[].say` | live |
| `zone_entered(the_cut)` → `the_lanes_move_on_the_checkpoint` (`commit lanes` → `cut_gate`) | `toast` | system | `The lanes are moving on the checkpoint` | trigger `label` | live |
| same trigger | `radio` | **net** | "Two moving south out of the lanes onto the checkpoint." | `triggers[].say`. Net, and flat: a position report | live |
| `casualties_pct(50)` → `the_seam_reserve_falls_back` (`withdraw_to north_muster`, group `seam_reserve`) | `toast` | system | `What is left of the seam reserve falls back` | trigger `label`. Reads true if the reserve is already dead. No `say` | live |
| wave t=270 s (`technical`, `coast_north` → `coast_point`) | `radio` | **Idit** | "A technical coming down the coast road from the north, past the seam and on to the Cut." | `enemy.waves[].say`. The other four waves are worded by the alert layer only | live |
| waves t=120, 180, 330, 390 s | `toast` | system | `enemy reinforcements — N units inbound · <place>` | alert layer; no `say`, deliberately | live |
| `evacuated` ×N | `toast` | system | `clear (1)` | `notice.evacuated`, one per resident | live |
| `objective(hold_the_seam, complete)` | `radio` | **Shai** | "The seam is shut. Leave enough on it that it stays that way." | `objectives[].say` | live |
| `objective(hold_the_cut, complete)` | `radio` | **Shai** | "The Cut is ours. From here on it does not get given back." | `objectives[].say`. The town's spine, in one line | live |
| `objective(residents_through, complete)` | `radio` | **Idit** | "Six through the checkpoint and south of the Cut. The rest of the quarter has watched it be done." | `objectives[].say` | live |
| `objective(residents_through, failed)` | `radio` | **Shai** | "Five minutes, and they are still in the lanes. A checkpoint nobody can walk through is a wall." | `objectives[].say_on_fail`; the briefing's close, paid | live |
| `objective(take_the_coast_road, complete)` | `radio` | **net** | "Coast road junction held. Supply is running along the Cut." | `objectives[].say` | live |
| `SimEvent ventOpened` inside `ring_north` | `radio` | **Idit** | "They are up inside the seam. The hold stops while they are standing in it." | the vent is autonomous; no trigger can watch it | engine |
| `missionEnd(victory)` | `debrief` | **Idit** | §2.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §2.5 | end screen | live |

**Trigger labels:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `the_seam_reserve_comes_up` | `zone_entered(ring_north)` → `commit seam_reserve` | `The seam's reserve is coming out of the houses` | 46 |
| `the_lanes_move_on_the_checkpoint` | `zone_entered(the_cut)` → `commit lanes` | `The lanes are moving on the checkpoint` | 38 |
| `the_seam_reserve_falls_back` | `casualties_pct(50)` → `withdraw_to north_muster` | `What is left of the seam reserve falls back` | 43 |

---

## 3. `qasr_liwan_3_buildup`: Qasr Liwan III · The Pause

`buildup` · **Captain** · requires **R** · produces **R M C X I H** · `target_minutes` 7 ·
**economy**: a camp, 500 + 150/min, income `water_point` 80 · ceiling **5**. **What to build,
and where to stand when it ends.** The Marj's first build-up, which is why §9's re-briefs
exist.

### 3.1 `name`

`Qasr Liwan III — The Pause`

### 3.2 `dispatch`: 210 characters

> *A pause was agreed at midnight. For as long as it holds nobody fires across the Cut, and
> in the morning four of the people taken at First Light are to be walked out to the open
> ground beside it and handed back.*

The design's hook, all of it. *Agreed* carries the truce (G-6), and the narrator says it
because neither voice can. Status `live`.

### 3.3 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The pause holds for four minutes from the time you step off. Their lines are back just past the edge of what we can see, and they stay there unless one of theirs dies or something of ours crosses the south street. | 213 |
| 2 | **Shai** | Four of the taken are being walked to the open ground west of the checkpoint. At ninety seconds the party with them steps back; go to them then and not before, and bring all four south across the Cut. | 200 |
| 3 | **Idit** | From south of that street I can see into the clinic yard, and from nowhere closer. Crossing it to look, with a squad or with the drone, ends the pause for everyone on that ground. | 179 |
| 4 | **Shai** | Put the mortar and the AT team on ambush before anything identifies anything, because a tube left to its own judgement is how a pause ends. The handover ground is flagged, and Conduct has five points to give today. | 214 |
| 5 | **Idit** | When it ends it ends on the forward ground north of the checkpoint, from three sides, with wheels a minute later. The water point west of it pays eighty a minute to whoever holds it. | 182 |
| 6 | **Shai** | Spend the quiet on what holds that ground at four minutes: AT for the wheels, rifles for the rest. The four come first, because there is no buying them back under fire. | 168 |

Each beat checked against `design.md` §5.3:
- **Beat 1** states both early breaks exactly: `casualties_pct(5)`, where one death is
  enough, and `zone_entered(pause_line)`. The pause ends at `timer_s(240)`. QL-A7 holds the
  lines 11 or more tiles from every zone the player needs.
- **Beat 2.** `handover` is at x9 to 14, west of the checkpoint. The party withdraws at
  90 s. `pause_refuge` is south of the Cut. Count 4 of 4.
- **Beat 3 is Idit's hook, the cost of looking.** `zone_entered` counts aircraft (G-QL5),
  so the drone breaks the pause as surely as a squad. The look at `ql_yard_watch` is taken
  from south of `pause_line`.
- **Beat 4 is the design's hold-fire rule.** The player's own hold-fire is the `ambush`
  stance. A mortar on its default stance fires on anything the drone identifies within 18
  tiles. Ceiling 5: *"five points to give"* is exact, since the mission fails above five.
- **Beat 5.** The waves at 240 s come from the north and the west, the lines commit from
  three groups, and the technical and bikes come at 300 s. Income 80.
- **Beat 6** closes on the cost.

**The JSON string, to be pasted whole (1,161 characters):**

> The pause holds for four minutes from the time you step off. Their lines are back just past the edge of what we can see, and they stay there unless one of theirs dies or something of ours crosses the south street. Four of the taken are being walked to the open ground west of the checkpoint. At ninety seconds the party with them steps back; go to them then and not before, and bring all four south across the Cut. From south of that street I can see into the clinic yard, and from nowhere closer. Crossing it to look, with a squad or with the drone, ends the pause for everyone on that ground. Put the mortar and the AT team on ambush before anything identifies anything, because a tube left to its own judgement is how a pause ends. The handover ground is flagged, and Conduct has five points to give today. When it ends it ends on the forward ground north of the checkpoint, from three sides, with wheels a minute later. The water point west of it pays eighty a minute to whoever holds it. Spend the quiet on what holds that ground at four minutes: AT for the wheels, rifles for the rest. The four come first, because there is no buying them back under fire.

### 3.4 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `bring_four_across` | `evacuate_before` · `pause_refuge`, count 4 of 4, `hostages`, 330 s · **primary, failable** | Bring all four of the taken south of the Cut | OBJECTIVE COMPLETE — Bring all four of the taken south of the Cut | live |
| `hold_the_forward_ground` | `hold_for` · `staging` 300 · primary | Hold the forward ground for five minutes | OBJECTIVE COMPLETE — Hold the forward ground for five minutes | live |
| `keep_the_pause` | `no_collateral_above` 5 · **primary, failable** | Lose no more than 5 Conduct | OBJECTIVE COMPLETE — Lose no more than 5 Conduct | live |
| `take_the_water_point` | `capture` · `water_point` 15 · secondary | Take the water point west of the checkpoint | OBJECTIVE COMPLETE — Take the water point west of the checkpoint | live |
| `find_the_yard_watch` | `locate` · `ql_yard_watch` · secondary, `carries` → IV | Identify the watch in the clinic yard | OBJECTIVE COMPLETE — Identify the watch in the clinic yard | live |

*The taken* is the campaign's own word (D12, `hostages`), and it names no one.

`hostages_place`: `the Cut` (live).

### 3.5 `aftermath`: 117 characters

> *Four walked back across the Cut. That is the whole of what the pause bought, and the
> brigade did not ask it for more.*

The design's hook (*"says only that four came back"*), with one more clause: restraint stated as a
fact about the brigade, not as a sentiment. It holds for every win, because a win needs all
four, and whether the pause broke early does not change it. Status `live`.

### 3.6 `debrief`

> **victory** · Idit: *"Four back across the Cut. What we built in the quiet held the
> forward ground when the quiet ended."* (98)

> **defeat** · Shai: *"The pause is over, and we came out of it worse than we went in."*
> (63)

- **Victory.** Idit says the number, as in §2.2 of `storyline.md`. `staging` is a primary,
  so *held the forward ground* is true on every win.
- **Defeat** holds for all four causes: the 330 s clock, the ceiling, the time limit, or the
  forward ground lost. Status `live`.

### 3.7 Trigger table

**For `level-scripter`:** `do.group` names one group, so the design's three line groups
(`west_line`, `centre_line`, `east_line`) would take **nine** triggers to break the pause
three ways, each needing a label. They all commit to `staging_point`. **Make them one group,
`pause_lines`**, and there are three triggers. The labels below assume that (§11, D-1).

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qasr Liwan III — The Pause` · *3 primary objectives* | `hud.announce` | live |
| mission start | `dispatch` | narrator | §3.2 | title card | live |
| mission start | `brief` | Idit / Shai | §3.3, beats 1 to 6 | deploy screen, commander bar | live |
| `timer_s(90)` → `the_handover_party_steps_back` (`withdraw_to handover_withdraw`, group `handover_party`) | `toast` | system | `The party at the handover steps back` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "The party with them has stepped back toward the city. Nobody is standing over the four now." | `triggers[].say`. Idit reports and does not order | live |
| `timer_s(240)` → `the_pause_ends` (`commit pause_lines` → `staging_point`) | `toast` | system | `The pause is over` | trigger `label`; true whether or not it broke early | live |
| same trigger | `radio` | **Shai** | "Four minutes. Everything they kept out of sight is walking at the forward ground." | `triggers[].say` | live |
| `zone_entered(pause_line)` → `ours_over_the_south_street` (`commit pause_lines`) | `toast` | system | `Our units are over the south street` | trigger `label`. A fact, so it reads true even when it fires after 240 s | live |
| same trigger | `radio` | **Idit** | "Something of ours is over the south street, and their lines can see it. Whatever quiet was left is gone." | `triggers[].say`. Holds before and after the hour | live |
| `casualties_pct(5)` → `the_first_of_theirs_down` (`commit pause_lines`) | `toast` | system | `One of theirs is down and their lines move` | trigger `label`. **No `say`**: this fires on the first enemy death whenever it comes, normally after 240 s, so a line about breaking the pause would be false on most wins (§11, D-2) | live |
| waves t=240 s (×2) | `toast` | system | `enemy reinforcements — N units inbound · <place>` | alert layer; the hour's own label says the rest | live |
| wave t=300 s (`technical`, `moto_rpg` ×2, `city_east` → `staging_point`) | `radio` | **Idit** | "Wheels from the east end of the city, a technical and two bikes, for the forward ground." | `enemy.waves[].say` | live |
| wave t=390 s | `toast` | system | `enemy reinforcements — 3 units inbound · <place>` | alert layer | live |
| `evacuated` ×4 | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(bring_four_across, complete)` | `radio` | **Shai** | "Four across. Whatever happens on the forward ground now, that part is done." | `objectives[].say`. Holds if the forward ground was already held | live |
| `objective(bring_four_across, failed)` | `radio` | **Shai** | "Not all four are across, and that ground will not be quiet again. There is no second handover." | `objectives[].say_on_fail`. Holds whether the clock ran out or the count became unreachable | live |
| `objective(keep_the_pause, failed)` | `radio` | **Shai** | "That is more than five Conduct, and five was all the pause had to give." | `objectives[].say_on_fail` | live |
| `objective(hold_the_forward_ground, complete)` | `radio` | **net** | "Forward ground held. The checkpoint has a line in front of it again." | `objectives[].say` | live |
| `objective(take_the_water_point, complete)` | `radio` | **net** | "Water point held. It pays for the next fight from here." | `objectives[].say` | live |
| `objective(find_the_yard_watch, complete)` | `radio` | **Idit** | "Rocket team standing in the clinic yard, on the open ground. He goes on the board, and he does not get the first shot when we go in there." | `objectives[].say`. Names the yard only (L-11) | live |
| `SimEvent fire` by a side-0 unit before t=240 s | `radio` | **Shai** | "That round was ours. Everything after it is too." | needs a sim-watching trigger, and a time window no condition has (G-6) | engine |
| `missionEnd(victory)` | `aftermath` | narrator | §3.5 | victory banner | live |
| `missionEnd(victory)` | `debrief` | **Idit** | §3.6 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §3.6 | end screen | live |

**Trigger labels:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `the_handover_party_steps_back` | `timer_s(90)` → `withdraw_to handover_withdraw` | `The party at the handover steps back` | 36 |
| `the_pause_ends` | `timer_s(240)` → `commit pause_lines` | `The pause is over` | 17 |
| `ours_over_the_south_street` | `zone_entered(pause_line)` → `commit pause_lines` | `Our units are over the south street` | 35 |
| `the_first_of_theirs_down` | `casualties_pct(5)` → `commit pause_lines` | `One of theirs is down and their lines move` | 42 |

---

## 4. `qasr_liwan_4_clearance`: Qasr Liwan IV · The Clinic Yard

`clearance` · **Captain** · requires **R I** · produces **R M C X I E** · `target_minutes` 7 ·
no economy · ceiling 10, `structure_penalty_mult` 2. **Which weapon you may use beside a
clinic.**

### 4.1 `name`

`Qasr Liwan IV — The Clinic Yard`

The name is the yard, not the building (L-11).

### 4.2 `briefing`: 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The shaft mouth is in the clinic yard, the open ground inside the compound's west wall. That is what I have, and it is all of what I have. | 138 |
| 2 | **Shai** | Take the yard and hold it fifteen seconds with nothing of theirs in it, then stand the engineers beside the route and bring it down. Six minutes for the shaft. | 159 |
| 3 | **Idit** | Six people are in the forecourt south of the clinic, and they walk out through the south gate once one of ours is within four tiles. A firing position covers that gate from the south-west. | 188 |
| 4 | **Shai** | Walk five of them to the refuge by the checkpoint inside five minutes. People first or yard first is yours to choose; the yard first stops the crews coming up under you. | 169 |
| 5 | **Idit** | Their east position is three tiles off the clinic's wall. Every heavy round that misses it lands beside the clinic and is billed. | 129 |
| 6 | **Shai** | The rifles and the Lavi's coax are free beside that wall; its gun, the Namer's cannon and the AT missile are not. Lose the clinic and you have spent more than ten Conduct in one go, which is the mission. | 203 |

- **Beat 1 is the whole of Idit's picture, by rule.** The yard, and nothing about the
  building. *"All of what I have"* is her confidence, stated as a limit.
- **Beat 2.** `capture` takes 15 s uncontested. A charge needs an identified route, an
  engineer within 2 tiles, and 8 s still (`tunnel_charge_time_s`). `collapse` at 360 s.
- **Beat 3.** The forecourt is x30 to 34, y24 to 28, south of the clinic (x30 to 33, y21 to
  23), and the south gate is (29,29). The F at (22,30) covers it.
- **Beat 4.** Count 5 of 6 at 300 s, and `clinic_refuge` lies north of the checkpoint. The
  order of the work is the design's second decision.
- **Beat 5.** The F at (37,23) stands three open tiles east of the clinic's east edge.
  *Heavy* is exact: a stray bills only from `collateral_risk` 0.3 up.
- **Beat 6 is Shai's hook, what the tank is for and what it is not.** The coax is 0.20 and
  free. The gun is 0.55, the cannon 0.35 and the Spike 0.30, all billed. A `clinic` is
  `roe_penalty` 6, so at multiplier 2 it costs 12 and fails the mission alone.

**The JSON string, to be pasted whole (991 characters):**

> The shaft mouth is in the clinic yard, the open ground inside the compound's west wall. That is what I have, and it is all of what I have. Take the yard and hold it fifteen seconds with nothing of theirs in it, then stand the engineers beside the route and bring it down. Six minutes for the shaft. Six people are in the forecourt south of the clinic, and they walk out through the south gate once one of ours is within four tiles. A firing position covers that gate from the south-west. Walk five of them to the refuge by the checkpoint inside five minutes. People first or yard first is yours to choose; the yard first stops the crews coming up under you. Their east position is three tiles off the clinic's wall. Every heavy round that misses it lands beside the clinic and is billed. The rifles and the Lavi's coax are free beside that wall; its gun, the Namer's cannon and the AT missile are not. Lose the clinic and you have spent more than ten Conduct in one go, which is the mission.

### 4.3 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `take_the_yard` | `capture` · `clinic_yard` 15 · primary | Take and hold the clinic yard | OBJECTIVE COMPLETE — Take and hold the clinic yard | live |
| `walk_the_forecourt_out` | `evacuate_before` · `clinic_refuge`, count 5 of 6, 300 s · **primary, failable** | Walk five people out of the clinic forecourt | OBJECTIVE COMPLETE — Walk five people out of the clinic forecourt | live |
| `bring_the_shaft_down` | `collapse` · `clinic_yard` 360 · **primary, failable** | Bring down the shaft in the clinic yard | OBJECTIVE COMPLETE — Bring down the shaft in the clinic yard | live |
| `keep_the_clinic` | `no_collateral_above` 10 · **primary, failable** | Lose no more than 10 Conduct | OBJECTIVE COMPLETE — Lose no more than 10 Conduct | live |
| `the_yard_commander` | `eliminate_hvt` · `ql_yard_commander` · secondary | Kill the commander at the yard's north gate | OBJECTIVE COMPLETE — Kill the commander at the yard's north gate | live |

`bring_the_shaft_down` names the yard as the place of the shaft, as the design requires.
The yard commander stands outside `clinic_yard`, at (27,18), so *at the yard's north gate*
is where the player will find him.

### 4.4 `debrief`

> **victory** · Idit: *"The shaft is down and the clinic is standing, and the walk out of
> the forecourt was the part that counted. The yard had a hole in it, and now it is a
> yard."* (155)

> **defeat** · Shai: *"We came off that compound without the job done. The yard is
> somebody else's again, and so is whatever is under it."* (114)

- **Victory.** *The clinic is standing* is true on every win, because its loss fails the
  ceiling. *The walk out … was the part that counted* is the design's hook (*"names the
  people who walked out: the count, not who they were"*) without asserting a number that
  might be five or six. *The yard had a hole in it* is about the yard, and says nothing of the
  building (L-11).
- **Defeat.** *Whatever is under it* points at the yard. Status `live`.

### 4.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qasr Liwan IV — The Clinic Yard` · *4 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | §4.2, beats 1 to 6 | deploy screen, commander bar | live |
| `zone_entered(compound)` → `the_shore_lane_moves_on_the_yard` (`commit quarter` → `yard_point`) | `toast` | system | `The shore-quarter lane moves on the yard` | trigger `label` | live |
| same trigger | `radio` | **net** | "Two from the shore-quarter lane, moving on the yard through the west gate." | `triggers[].say` | live |
| `casualties_pct(50)` → `the_firing_line_leaves` (`withdraw_to north_muster`, group `firing_line`) | `toast` | system | `Their firing line leaves the compound` | trigger `label` | live |
| same trigger | `radio` | **Idit** | "The firing positions round the compound are emptying north. What is left of the fight is in the yard." | `triggers[].say` | live |
| wave t=150 s (`militia_cell` ×2 → `yard_point`) | `toast` | system | `enemy reinforcements — 2 units inbound · <place>` | alert layer | live |
| wave t=270 s (`technical`, `rpg_team` → `south_gate`) | `radio` | **Idit** | "A technical and a rocket team coming round to the south gate, the gate the walk goes through." | `enemy.waves[].say`. Holds whether or not anyone is still walking | live |
| `evacuated` ×N | `toast` | system | `clear (1)` | `notice.evacuated` | live |
| `objective(take_the_yard, complete)` | `radio` | **Idit** | "The yard is yours. The engineers can only charge the mouth while someone is watching it." | `objectives[].say`. A mechanic, not a claim about where the mouth is, so T-QL4a cannot falsify it. Idit states it; she does not order it | live |
| `objective(bring_the_shaft_down, complete)` | `radio` | **Shai** | "The shaft is down and the clinic is standing. That is the job, both halves." | `objectives[].say`. True at the tick: a lost clinic would already have failed the mission | live |
| `objective(bring_the_shaft_down, failed)` | `radio` | **Idit** | "Six minutes, and the yard is still open underneath. Whatever comes up there next comes up beside that clinic." | `objectives[].say_on_fail` | live |
| `objective(walk_the_forecourt_out, complete)` | `radio` | **Shai** | "Five out of the forecourt and at the refuge. Whatever is left in that compound is the fight." | `objectives[].say`. Holds whichever half was done first | live |
| `objective(walk_the_forecourt_out, failed)` | `radio` | **Shai** | "The clock is out on the forecourt. Anybody still in it is still beside the fight." | `objectives[].say_on_fail` | live |
| `objective(keep_the_clinic, failed)` | `radio` | **Shai** | "That is past ten beside a clinic. Nothing in that yard was worth it." | `objectives[].say_on_fail` | live |
| `objective(the_yard_commander, complete)` | `radio` | **Idit** | "The yard commander is down at the north gate. He ran that firing line from outside his own yard." | `objectives[].say` | live |
| `SimEvent identified` on `ql_shore_watch` | `radio` | **Idit** | "Rocket team on the shore-quarter lane, watching west. He goes on the board for the pump yard." | the silent carry into V has no objective, so nothing can say it | engine |
| `SimEvent fire` by `mbt_lavi` `gun_120` with an impact in zone `clinic` | `radio` | **Shai** | "That was the main gun beside the clinic. Coax only inside that wall." | needs a sim-watching trigger | engine |
| `missionEnd(victory)` | `debrief` | **Idit** | §4.4 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §4.4 | end screen | live |

**Trigger labels:**

| trigger id | on → do | label | chars |
|---|---|---|---|
| `the_shore_lane_moves_on_the_yard` | `zone_entered(compound)` → `commit quarter` | `The shore-quarter lane moves on the yard` | 40 |
| `the_firing_line_leaves` | `casualties_pct(50)` → `withdraw_to north_muster` | `Their firing line leaves the compound` | 37 |

---

## 5. `qasr_liwan_5_subterranean`: Qasr Liwan V · The Pumps

`subterranean` · **Captain** · requires **R I** · produces **R M C X I** · `target_minutes` 7
· **economy**: a camp, 500 + 90/min · ceiling 10, `structure_penalty_mult` 4. **Where the
engineers stand while the water drives the shallow crews up.**

### 5.1 `name`

`Qasr Liwan V — The Pumps`

### 5.2 `briefing`: 7 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | This ground gets mapped before anybody goes into it. Three deep routes run under the shore quarter, and a route counts only while something of ours is watching it: look away and it goes cold. | 191 |
| 2 | **Shai** | Hold the pump yard on the west edge for three minutes and the water goes into the shallow tier. When it does, those crews come up at the yard's two ends, into whoever is standing there. | 185 |
| 3 | **Idit** | The water does not reach the deep tier. Those three are found and charged by hand inside six minutes, and one of them is still being dug toward the Cut. | 152 |
| 4 | **Shai** | Two engineer squads, three routes and the pump yard all want the same minute, so choose the order before you start. A third engineer squad is on the camp's list if the brigade's Conduct has earned it. | 200 |
| 5 | **Idit** | One deep route comes up inside the relief depot's walled yard. The depot is not the target, and that route can be read and charged from outside its wall. | 153 |
| 6 | **Shai** | The depot is flagged, and bringing it down loses the mission; so does any house on this shore. Rifles answer what comes up beside it, and nothing heavier does. | 159 |
| 7 | **Shai** | Map first and charge second: an engineer beside a route nobody is watching is a man standing in the open for nothing. | 117 |

- **Beat 1's first sentence is mapping**, the design's hook: the brigade maps first and
  enters second. Idit states it as a fact about the ground; she gives no order. *Goes cold* is the shipped *"unwatched contact decays"*.
- **Beat 2** is the fiction of the pumps (G-4). The `hold_for` completes, then two waves
  spawn on the shallow vent markers at the yard's north and south edges.
- **Beat 3.** The deep tier does not flood (T4, carried honestly). `collapse` at 360 s.
  `ql5_deep_cut` is dug live.
- **Beat 4** names the reward for restraint, as the design asks. A third `yahalom_squad`
  is buyable only once the campaign's Conduct has opened its 75 gate.
- **Beat 5 is the L-12 line.** It names the depot, says where the route surfaces, and says
  in so many words that the depot is not the target. *Can be read and charged* is Idit's
  picture, not an order. QL-A6 holds the route readable from
  outside `relief_depot`.
- **Beat 6.** At multiplier 4 the depot (3) costs 12 and a house (6) costs 24. Each fails
  the ceiling alone; a shanty (8) does not, so the line says *house*. The rifles are 0.10.
  The Namer's cannon (0.35) and the Spike (0.30) bill a stray.
- **Beat 7** closes on the cost. It is the mechanic of beat 1, paid in a man.

**The JSON string, to be pasted whole (1,163 characters):**

> This ground gets mapped before anybody goes into it. Three deep routes run under the shore quarter, and a route counts only while something of ours is watching it: look away and it goes cold. Hold the pump yard on the west edge for three minutes and the water goes into the shallow tier. When it does, those crews come up at the yard's two ends, into whoever is standing there. The water does not reach the deep tier. Those three are found and charged by hand inside six minutes, and one of them is still being dug toward the Cut. Two engineer squads, three routes and the pump yard all want the same minute, so choose the order before you start. A third engineer squad is on the camp's list if the brigade's Conduct has earned it. One deep route comes up inside the relief depot's walled yard. The depot is not the target, and that route can be read and charged from outside its wall. The depot is flagged, and bringing it down loses the mission; so does any house on this shore. Rifles answer what comes up beside it, and nothing heavier does. Map first and charge second: an engineer beside a route nobody is watching is a man standing in the open for nothing.

### 5.3 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `run_the_pumps` | `hold_for` · `pump_yard` 180 · primary (the waves' `trigger`) | Hold the pump yard for three minutes | OBJECTIVE COMPLETE — Hold the pump yard for three minutes | live |
| `the_deep_routes` | `collapse` · `shore_grid` 360 · **primary, failable** | Collapse the deep routes under the shore | OBJECTIVE COMPLETE — Collapse the deep routes under the shore | live |
| `keep_the_depot` | `no_collateral_above` 10 · **primary, failable** | Lose no more than 10 Conduct | OBJECTIVE COMPLETE — Lose no more than 10 Conduct | live |
| `the_grid_chief` | `eliminate_hvt` · `ql_grid_chief` · secondary | Kill the grid chief at the deep shaft head | OBJECTIVE COMPLETE — Kill the grid chief at the deep shaft head | live |
| `find_the_deep_crew` | `locate` · `ql_deep_crew` · secondary, **no `carries`** until O-QL3's reader exists | Find the crew digging toward the Cut | OBJECTIVE COMPLETE — Find the crew digging toward the Cut | live |

`the_deep_routes` gives no count. The briefing says three, and T-QL5c could make it four.
`run_the_pumps` keeps the design's id, because the waves name it.

### 5.4 `aftermath`: 179 characters, the town's close

> *The pumps ran for a day and the shallow routes under the shore filled. The deep ones did
> not: the brigade brought those down by hand, one engineer and one watched route at a time.*

The design's hook, said plainly: the water does not reach the deep routes. The second clause
is the town's lesson, *map first*, stated as what happened. Status `live`.

### 5.5 `debrief`

> **victory** · Shai: *"The city is ringed and cut off from the south, and what is under its
> shore is ours. Qasr Liwan is still standing, and so is everybody we walked out of it."*
> (154)

> **defeat** · Idit: *"We came off the shore with the grid still the city's. A ring on the
> map is only as good as what is underneath it."* (113)

- **Victory** closes the town as the design asks: ringed, cut off from the south, the shore's
  ground the brigade's. The second sentence is restraint as a result. A campaign at QL V
  has completed I to IV, so every walk-out primary behind it was done.
- **Defeat** holds for each cause. Status `live`.

### 5.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qasr Liwan V — The Pumps` · *3 primary objectives* | `hud.announce` | live |
| mission start | `brief` | Idit / Shai | §5.2, beats 1 to 7 | deploy screen, commander bar | live |
| `objective(run_the_pumps, complete)` | `toast` | system | OBJECTIVE COMPLETE — Hold the pump yard for three minutes | **no `say`, deliberately**: the two waves keyed on this objective fire on the same tick, and `hud.say` replaces the bar's line rather than queuing it (`ui/hud.ts` `say()`), so one line is written, on the first wave | live |
| wave on `run_the_pumps` (`militia_cell` ×3, `vent_shallow_n` → `pump_point`) | `radio` | **Idit** | "The water is in. Crews coming up at both ends of the pump yard, north and south." | `enemy.waves[].say` on the first of the two waves only | live |
| second wave on `run_the_pumps` | `toast` | system | `enemy reinforcements — 3 units inbound · <place>` | alert layer | live |
| wave t=240 s (`technical`, `north_muster` → `pump_point`) | `radio` | **Idit** | "A technical down the coast road from the north edge, for the pump yard." | `enemy.waves[].say` | live |
| `objective(the_deep_routes, complete)` | `radio` | **Idit** | "The deep routes are down. The shore is ours above and below, as far as anything we can see." | `objectives[].say`. Her confidence, stated | live |
| `objective(the_deep_routes, failed)` | `radio` | **Idit** | "Six minutes, and there is still a deep route open under the shore. The water never reached it, and neither did we." | `objectives[].say_on_fail` | live |
| `objective(keep_the_depot, failed)` | `radio` | **Shai** | "That is past ten Conduct on an empty shore. Nothing that came up there was worth it." | `objectives[].say_on_fail` | live |
| `objective(the_grid_chief, complete)` | `radio` | **Idit** | "The grid chief is down at his own shaft head. He was running that grid to a plan drawn before the war." | `objectives[].say`. The town's adversary is a plan (D-QL1), in Deir Amun III's register | live |
| `objective(find_the_deep_crew, complete)` | `radio` | **Idit** | "That is the crew digging toward the Cut, on the south edge of the shore. He is not on any plan I have; he is making one." | `objectives[].say` | live |
| `route_open` on `ql5_deep_cut` (**T-QL5a**) | `radio` | **Idit** | "The crew under the apron is through. They come up a few tiles from the start line." | G-QL2's `route_open`. **The `timer_s` stand-in is not recommended**: if the digger dies first, a timed line and its required label both lie | engine |
| `objective_complete(run_the_pumps)` → `remove` the shallow stocks | `radio` | **Idit** | "The water got there. Nothing more is coming up the shallow routes." | G-QL2's `objective_complete` | engine |
| `missionEnd(victory)` | `aftermath` | narrator | §5.4 | victory banner | live |
| `missionEnd(victory)` | `debrief` | **Shai** | §5.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §5.5 | end screen | live |

The design authors no trigger in V; the waves ride `run_the_pumps` and the clock. Any
trigger added for a twist takes its label from §8.

---

## 6. Ambient lore: secondary locations

The ground the player crosses that no objective names. Every place is a feature from
`design.md` §3.2, and its id resolves in §3.4. **Every row is `engine`**: a line needs a
trigger, a trigger needs a `do`, and no `do` is a no-op. The `zone_entered` triggers the town
needs are already spent on the design's mechanics. The smallest fix is a say-only trigger
(§11, G-N1). Each line fires once and stops nothing.

| location | mission · zone / marker | channel | speaker | line | status |
|---|---|---|---|---|---|
| the north road | I · `r` y=3 | `radio` | Shai | "The north road is the city's top edge and the fastest way in. Fast is why somebody is watching it." | engine |
| the water-tower knoll | I · `tower_knoll` (32,5) | `radio` | Idit | "Cover two on a knoll by the water tower, the only high ground on the edge. Whoever stands there sees the whole north road." | engine |
| the north edge | I · zone `ql_edge` | `radio` | Idit | "Low houses in pairs on lanes one tile wide. A lane like that sees along itself and nowhere else." | engine |
| main street | II, IV · `r` y=16 | `radio` | Shai | "Main street runs the width of the city. Everything that moves north to south crosses it." | engine |
| the apartment block | all · `a` x36 to 38, y11 to 13 | `radio` | Idit | "One block on the east edge stands taller than anything else in the city, and losing it costs fourteen Conduct." | engine |
| the south quarter | II · zone `south_quarter` | `radio` | Idit | "The last row of houses before the open ground. The people in them have the shortest walk in the city and the most fighting in front of it." | engine |
| the apron | II, III · y37 to 40 | `radio` | Shai | "Open ground between the last houses and the Cut, with a little scrub. Nobody stands on it for long." | engine |
| the checkpoint | II to V · `the_cut` | `radio` | Shai | "Two lines of barrier with a two-tile lane between them. Everything that crosses the Cut goes through that lane." | engine |
| the clinic compound | IV · zone `compound` | `radio` | Idit | "A walled compound with four one-tile gates. The walls stop a man and not a look, either way." | engine |
| the pump houses | V · `p` x4 to 5, y27 and y31 | `radio` | Idit | "Two pump houses on the west edge, and the only reason the shallow routes can be flooded at all. On this shore each one costs eight Conduct to lose." | engine |
| the shore quarter | V · zone `shore_quarter` | `radio` | Shai | "The shore quarter has been emptied. Its houses are billed at four times on this shore, empty or not." | engine |

The apartment is `roe_penalty` 14, under `PROTECTED_ROE` (20), so the sim does **not**
protect it: a unit may fire on it when a hostile is inside. The line therefore states its
price and claims no protection.

---

## 7. EVA announcements and barks

**EVA: no delta.** The campaign's set is written once: `beit_sahwan/narrative.md` §8, Act
II's four additions, and the Khan Rafid sheet's `tunnelContact` lost line, which is `engine`.
Checked event by event against these five missions, every event is already covered:
`evacuated`, a wave, a vent opening, a route collapsing, a civilian taken (none here) and
contact lost (V). The `notice.evacuated` caption is live.

**Barks: none written, and the rule comes first.**

> **Barks are keyed by unit role, never per unit (GH-110), and the doctrine-not-people rule
> heads that sheet before a single line is on it.** No real place, faith, ethnicity,
> nationality, accent, idiom or insignia, on either side. Language is admitted only
> symmetrically (GDD §2 Voice): KDF in Hebrew, the doctrines in standard military Arabic,
> with no dialect, slogan, religious phrase or real call sign, and a native speaker reviews
> every line before it is recorded. Retrofitting the rule means throwing recorded audio
> away.

This town fields eleven KDF roles and six Ashwar roles and **adds none**.

---

## 8. Twist lines

Classification is `level-scripter`'s (`design.md` §5). The voice is live; the column says
what else each needs. Every row is `live` if the twist is adopted, because its line rides a
surface that exists.

| twist | binding | speaker | line or label | needs | status |
|---|---|---|---|---|---|
| **T-QL1a** "The guard was relieved" | `find_the_gate_guard`'s `say`, replacing §1.6's | Idit | "The man on that gate is not the one I had. He is in the lane west of it; the post moved before we did." | a second placement with the same tag | live |
| **T-QL1b** "The mortar knows the courtyard" | folded into §1.6's courtyard trigger | Idit | (§1.6) | nothing | live |
| **T-QL1c** "The street waits at the gate" | `commit street` → `house_gate` | — | no new line; §1.6's labels still read true | a marker change | live |
| **T-QL2a** "The seam was a decoy" | `the_seam_reserve_comes_up`'s `say`, replacing §2.6's | Idit | "The seam's vent is empty. The reserve is coming up the coast road instead." | an unstocked `ql2_vent_north` | live |
| **T-QL2b** "They come through with the residents" | the t=390 s wave's `say` | Idit | "Two bikes riding the Cut from the west, into the lane the residents use." | the timing | live |
| **T-QL2c** "The Cut is the brigade's from now on" | `aftermath`, **held** | narrator | "The Cut was opened that night and held from the next morning on. It did not close again for the rest of the war." | nothing; held because §2.5's victory carries it | live |
| **T-QL3a** "One of them is not walking" | `the_handover_party_steps_back`'s `say`, replacing §3.7's | Idit | "The party has stepped back. Three of the four are together; the fourth is standing apart to the west, and somebody has to go to that one too." | one civilian placed apart | live |
| **T-QL3b** "They stood closer" | `timer_s(200)` → `withdraw_to`, group `pause_lines` | Idit | label `Their lines have moved up into sight`; say "Their lines have come forward into sight. Nobody has fired. They want to be seen." | markers 2 tiles south | live |
| **T-QL3c** "The pause ends early, and nobody fired" | — | — | **no line, by recommendation.** It teaches that restraint is not rewarded (`design.md` §5.3) | — | live |
| **T-QL4a** "The mouth moved" | `take_the_yard`'s `say`, replacing §4.5's | Idit | "The mouth is not where I drew it. It is at the yard's south end, and the north one goes nowhere." | two routes | live |
| **T-QL4b** "The commander goes to ground" | `casualties_pct(30)` → `withdraw_to` a lane marker | — | label `The yard commander runs for the shore lanes` | a marker | live |
| **T-QL4c** "Nothing beneath the clinic" | — | — | **no line and no placement, by rule (L-11)** | — | live |
| **T-QL5a** "It comes up at the Cut" | §5.6 | Idit | (§5.6) | G-QL2 `route_open` | engine |
| **T-QL5b** "The chief goes for the quay" | `casualties_pct(60)` → `withdraw_to` a beach marker | — | label `The grid chief runs for the beach` | a marker | live |
| **T-QL5c** "A fourth route" | a line when the fourth route is first identified | Idit | "There is a fourth route under the shore with no spoil on it. The picture was short by one." | a trigger on a route identification | engine |

---

## 9. Re-briefs of landed text

**None of the three below is applied in this branch.**
- O-QL5's two lines change **in QL III's commit** (the lead's default). Applying
  `storyline.md` now would split the pair, and make canon describe a build-up that does not
  ship.
- The `debrief` and `dispatch` fields are outside this agent's three JSON fields, so their
  owner is `mission-author`.

### 9.1 O-QL5 (a): `storyline.md` §3.1, the paragraph after the ledger

**Old:**

> **Act I's shape is a story fact worth keeping.** Beit Sahwan runs phases 1, 2, 3,
> 5, 6 — **no build-up**. True rather than absent: the brigade got no breathing room
> in the Marj. §4(b) puts that at risk and says so.

**New:**

> **Act I's shape is a story fact, and *The Long Ground* changed it.** Beit Sahwan runs
> phases 1, 2, 3, 5, 6 with **no build-up**: the brigade got no breathing room taking the
> perimeter. The Marj's one build-up is Qasr Liwan III, *The Pause*, and it is not rest. It
> is a pause agreed with the other side, four of the taken handed back at the Cut, and the
> waves the moment it ends. The brigade's breathing room in the Marj was spent receiving
> people. (O-QL5, the lead, 15 Nov 2026.)

Owner: `narrative-designer` (`storyline.md` is in this agent's rights), in QL III's commit.

**Also in `storyline.md`, the same commit:**
- **§4.2.** The sentence quoting the 2026-08-21 spec (*"made `wadi_halam_3_counterraid`
  'the only breathing room the brigade ever gets'"*) gains a bracketed note: *"(superseded:
  Qasr Liwan III is the Marj's build-up; O-QL5)"*.
- **§4.1.** *"the war's **second** build-up"* stays true in campaign order (QL III, then
  Umm Zeitoun II, then Wadi Halam III).

### 9.2 O-QL5 (b): `wadi_halam_3_counterraid.json` `debrief.defeat`

**Old** · Shai: *"He is east with his cell and the bunds are theirs again. We spent the only
quiet week of the war on it."*

**New** · Shai: *"He is east with his cell and the bunds are theirs again. We spent the one
quiet week Naharin gave us on it."* (107)

- **Keep "quiet week".** It is load-bearing: Ein Qasab is set in it
  (`wadi_halam_rain/mdd.md` §1, *"in the 'only quiet week of the war' that III's defeat
  debrief names"*). The new line keeps the week and drops the war-wide claim that QL III
  falsifies.
- Owner: `mission-author`, in QL III's commit.
- Same commit: `wadi_halam/narrative.md`'s row for this line (its §3 trigger table,
  `missionEnd(defeat)`) gets the new text, and `wadi_halam_rain/mdd.md` §1's quotation
  gains *"(re-briefed by O-QL5)"*.
- `data/locales/` holds no mission overlay today (`README.md` only), so no translation
  moves.

**Other copies, checked, and left alone because they are history:**
- `wadi_halam/script.md` lines 203 and 879, and `wadi_halam/narrative.md` line 461, quote
  the pre-split string *"The only breathing room the brigade gets in this war"*. That line no
  longer ships.
- `khan_rafid/design.md` lines 141 and 227 to 229, `beit_sahwan/design.md` line 91,
  `qarn_hadid/design.md` lines 111 and 121, and the 2026-08-21 spec and plan record the old
  premise as the reason for earlier decisions.

### 9.3 C7: `khan_rafid_1_recon.json` `dispatch` (proposed; the lead may strike it)

This town makes a shipped line false. Khan Rafid I's dispatch says Sahim *"has been at brigade
a week"*. In campaign order, five Qasr Liwan missions and a pause now come between his
capture and Khan Rafid. The design's C7 offers Khan Rafid's re-brief the Cut.

**Old:** *"The man who prepared the Marj has been at brigade a week, answering questions. Seven
kilometres up the coast road the town he built for this is still holding, and nobody in it
has had a new order since the morning he was taken."*

**New:** *"The man who prepared the Marj has been at brigade since the winter began, answering
questions. South of the Cut the town he built for this is still holding, and nobody in it
has had a new order since the morning he was taken."* (225)

Owner: `mission-author`. It lands with this town's missions, because until then the old line
is true.

**Flagged, not written:** Deir Amun III's shipped `aftermath` (*"Brigade put a third star on the
slip"*) promotes Shai at Deir Amun III. Under L-3 the Captain runs to
`bir_tarsha_5_subterranean`. That line belongs to Bir Tarsha's sheet, and it does not affect
this town.

---

## 10. GDD amendments (exact text, unapplied)

Canon moved when the lead approved the arc: the Marj has a fourth town, the Cut, and a
build-up. This text lands **with the town's content**, as Ein Qasab's did (PR 915), so the
GDD never lists a town the board cannot show. It touches §2 and §11 only.

**Version line:** `1.2.4` → **`1.2.5`**, appending to the status clause:

> ; §2 and §11 gain Qasr Liwan, the Marj's city, and the Cut (2026-11-15)

**§2, the towns line. Old:**

> **Towns:** Beit Sahwan, Khan Rafid, Deir Amun (Marj) · Tel Marum, Qarn Hadid, Umm Zeitoun (Sur) · Wadi Halam, Ein Qasab (Naharin).

**New:**

> **Towns:** Beit Sahwan, Qasr Liwan, Khan Rafid, Deir Amun (Marj) · Tel Marum, Qarn Hadid, Umm Zeitoun (Sur) · Wadi Halam, Ein Qasab (Naharin).

**§11, the paragraph that opens "Not every town opens a front or closes one." Old first
sentence:**

> **Not every town opens a front or closes one.** Qarn Hadid falls between Tel Marum
> and Umm Zeitoun, and Ein Qasab falls in the winter between Wadi Halam's third and
> fourth missions, when the rain shuts the fords and the corridor's traffic goes onto
> the marsh causeways.

**New first sentence (the paragraph's last sentence is unchanged):**

> **Not every town opens a front or closes one.** Qasr Liwan, the Marj's city, comes
> after Beit Sahwan and after the digger is taken: a ring, a road the brigade cuts across
> the enclave and holds for the rest of the war (the Cut), a pause in which some of the
> taken are handed back, and a clinic yard. Qarn Hadid falls between Tel Marum
> and Umm Zeitoun, and Ein Qasab falls in the winter between Wadi Halam's third and
> fourth missions, when the rain shuts the fords and the corridor's traffic goes onto
> the marsh causeways.

The rest of *The Long Ground* (Act IV, the ending moving to the Line, the rank ladder) moves
§11 again. Those are later towns' blocks. This one says only what Qasr Liwan makes true.

---

## 11. Defects and gaps found while writing

| # | finding | owner | class |
|---|---|---|---|
| **D-1** | QL III's three line groups need nine labelled triggers, because `do.group` is one group. Make them one group, `pause_lines` (§3.7) | `level-scripter` | today |
| **D-2** | QL III's `casualties_pct(5)` is one-shot and fires on the first enemy death **whenever it comes**, normally after 240 s. Its action is then harmless (the lines are already committed), but any `say` about breaking the pause would be false on most wins. The label is written to hold both ways; the trigger carries no `say` | `level-scripter` | today |
| **D-3** | QL I's courtyard and timer triggers can both fire, so they carry different labels. The second commit is a no-op | `level-scripter` | today |
| **D-4** | `design.md` §5.1 says the mortar *"reaches the courtyard … and not the extract"*, which is right, but the north road outside the gate (about 14.4 tiles from (10,15)) **is** in range 16. The briefing says *extraction*, never *north road*, for that reason. QL-A8 should also pin the gate tile's distance, so the walk's first tiles are known to be under the mortar | `level-scripter` | today |
| **D-5** | `design.md` §5.2 names the mortar and the Namer as QL II's billed weapons. `at_team` Spike is `collateral_risk` 0.30, which meets the 0.3 floor, so it bills too. The briefing names all three | `level-scripter` | today |
| **G-N1** | a say-only trigger: `do` optional, or a `do.kind` that does nothing, so a `zone_entered` can carry a line. §6's eleven rows wait on it | `sim-guard` | engine |
| **G-QL2** | `on.kind: route_open` and `objective_complete` (`design.md` §7.2). Two rows in §5.6 and T-QL5a wait on it | `sim-guard` | engine |
| — | a trigger that watches a `SimEvent` (`identified`, `fire`, `ventOpened`). Six rows wait on it, and T-QL5c | `sim-guard` | engine |

---

## 12. Verification

Run on the finished file by script (a port of `briefingBeats` and a cell parser), never by
eye. The script and its last run are described here; it is not committed.

- **Briefings.** Each JSON string above was split by a Python port of
  `packages/app/src/ui/loading.ts` `briefingBeats`: split on `(?<=[.!?])\s+`, pack at most
  two sentences and 240 characters. The beats it returns equal the beat tables, row for row,
  in all five missions.
  - QL I: 1,135 characters in 7 beats.
  - QL II: 1,019 in 6.
  - QL III: 1,161 in 6.
  - QL IV: 991 in 6.
  - QL V: 1,163 in 7.
  - All five are inside the shipped 385 to 1,225 band. No beat is over 240 characters or
    two sentences, and no single sentence is over 240.
- **Limits.**
  - Every quoted line in a table, and every `dispatch`, `aftermath` and `debrief`, is 240
    or fewer.
  - Every trigger label and objective text is 48 or fewer, with no full stop.
  - Both `hostages_place` values are 40 or fewer.
- **Status.** Every row of every table that has a status column carries `live`, `schema` or
  `engine`. **`engine`: 21 rows, 20 distinct lines** (T-QL5a is a row in §5.6 and again in
  §8). `schema`: 0.
- **Falsified.** The checker was fed five mutated copies: a 241-character radio line, a label
  ending in a full stop, a JSON string one sentence longer than its beat table, a row whose
  status is not one of the three words, and a 56-character objective text. It exited 1 on
  each, and exits 0 on this file.
- **Not run:** `pnpm validate:data` and `pnpm test`. No JSON and no code changed, and no
  Qasr Liwan mission file exists for either to read.
- **Not run by this agent:** the dossier's deny-list grep. This agent may not read
  `dossier.md`, so the check belongs to `campaign-historian`. The sheet coins no proper noun
  (§0.3).
