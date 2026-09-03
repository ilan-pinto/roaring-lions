# Beit Sahwan — Narrative Trigger Sheet

**Act I · The Marj Strip · Ashwar Front · Shai Hammai is a Captain throughout.**

**Date:** 2026-09-03 · **Revised the same day — delta pass after the level
script was applied.** **Status:** the `live` rows are applied to
`data/missions/beit_sahwan_*.json` and pass `pnpm validate:data`; everything
else is written against a surface that does not exist yet and says so.
**Written against** the six missions on `feat/story-act-1`, read from the JSON
**as it now stands** — First Light and IV both changed under this sheet, and
§2 and §6 are rewritten against the new placements, waves, triggers and
objectives rather than against the earlier text. Contract:
`docs/campaign/README.md`. Canon: `docs/campaign/storyline.md` §0.2, §1, §2,
§3.1. GDD §2 and §11.

Upstream, and **this is the line that changed**: `docs/campaign/beit_sahwan/design.md`
now exists (Option C, the hostage spine) and so does
`docs/campaign/beit_sahwan/script.md`. The first version of this sheet was
written before either, from `storyline.md` §3.1 and the shipped JSON alone; §2
and §6 below are now written against design §5.2–§5.6 and §7 IV and against
script §1 and §5, with every mechanical claim still read from the mission files
rather than from a summary of them.

**What this pass changed in the JSON** — nothing outside the three text fields:
`beit_sahwan_breach.briefing` and its `hold_outpost` label,
`beit_sahwan_4_subterranean.briefing` and its `find_spade` label. `get_them_out`
and `take_the_shaft_head` keep the text `level-scripter` shipped them with,
which was this sheet's own proposal quoted back (§6.3).

Downstream: `level-scripter` (the one surviving id rename in §10),
`render-vfx` (radio overlay, debrief screen, the two toast defects in §11),
`sim-guard` (`say` on triggers and objectives; the two `remove` verbs Act I's
spine waits on, §13).

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code and the text can reach a player today |
| `schema` | the surface is specced and the field does not exist (`dispatch`, `aftermath`) |
| `engine` | the surface is an approved target with no implementation (`radio`, `eva`, `bark`, `debrief`, and any toast string that is hard-coded today) |

Every row's rightmost cell is one of those three words. The count is §13.

### 0.2 The two voices, and why the JSON reads as one

The deploy screen has **exactly one hard-coded speaker**
(`packages/app/src/ui/hud.ts:68`), so the briefing the player sees today is
Shai's alone. The briefings below are therefore written twice:

- **In this sheet** the briefing is a two-hander, one speaker per beat.
- **In the JSON** the same text is Shai's orders voice end to end, with Idit
  named in the **third person** wherever the picture is hers — *"Idit needs the
  picture"*, *"Idit is reading spoil west of the line"*, *"her section files him
  as SPADE"*, *"Idit has four routes under the town"*. No `Idit:` prefix appears
  in any mission file. When the
  commander becomes data (`storyline.md` §7 G2) those third-person references
  become her beats and the words barely change.

The beat boundaries below are **not editorial** — they are what
`briefingBeats` (`packages/app/src/ui/loading.ts`) produces from the shipped
string: at most two sentences and 240 characters, whichever comes first. Every
speaker change falls on a real beat boundary, checked with a port of that
function rather than by eye (§13).

### 0.3 The villain

**Nadir Sahim**, KDF file name **SPADE** — *the digger*
(`storyline.md` §2.3). He is named in exactly two places in shipped text,
because those are the two places the storyline says he must be: **III**, where
the position inside the clinic block is his bait, and **IV**, where the network
is his and Act I ends on him. He is **not** named in the tutorial, in First
Light, in I or in II. He speaks once in this whole act, on a trigger, and what
he says is an invitation to break ROE.

### 0.4 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality,
accent, idiom or insignia, on either side. Ashwar Front is defined by tunnels,
IEDs, ambush and human terrain, and by nothing else. This binds hardest on the
`eva` and `bark` rows, which are the ones that would eventually be recorded —
retrofitting the rule means throwing audio away (GH-110).

---

## 1. `beit_sahwan_0_tutorial` — Beit Sahwan 0 — Working Up

`recon` · Captain (pre-war) · `tutorial_ground` · no ledger keys.

### 1.1 `name`

`Beit Sahwan 0 — Working Up` — **unchanged.**

### 1.2 `briefing` — 413 chars, 3 beats — **unchanged**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | Nothing here is contested yet. The battalion has given you a corner of the training area and one of everything it will hand you next week, delivered a piece at a time as you get to it. | 184 |
| 2 | **Shai** | Learn what each of them is for. Nothing you lose here comes off the roster, and nothing you learn here is free later. | 117 |
| 3 | **Shai** | The exercise runs ten minutes. Work through it at your own pace; nothing out here is trying to beat the clock. | 110 |

**This is the one briefing in Act I that is not a two-hander, and that is the
point.** `storyline.md` §3.1 records Idit's intel beat here as *"none — not yet
attached"*. The player meets her in the compound at First Light, on the morning
she reads the attack off a wall. Giving her a beat in a pre-war exercise would
spend the introduction before there is anything to introduce her with.

### 1.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `work_up` | Work through the training area | `OBJECTIVE COMPLETE — Work through the training area` |
| `clear_the_area` | Clear the training area | `OBJECTIVE COMPLETE — Clear the training area` |

Both **unchanged.**

### 1.4 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan 0 — Working Up` · *1 primary objective* | `hud.announce`; applied | live |
| mission start | `brief` | Shai | beats 1–3 above | deploy screen, ◂/▸ paging; applied | live |
| `zone_entered(z_wall)` → `deliver_second_squad` | `toast` | system | **`enemy reacts (deliver_second_squad)`** | hard-coded prefix; **wrong — this is a friendly delivery.** See §11 G-C | live |
| `zone_entered(z_house)` → `deliver_sniper` | `toast` | system | `enemy reacts (deliver_sniper)` | same defect | live |
| `zone_entered(z_east_view)` → `deliver_transports` | `toast` | system | `enemy reacts (deliver_transports)` | same defect | live |
| `zone_entered(z_road_west)` → `deliver_armour` | `toast` | system | `enemy reacts (deliver_armour)` | same defect | live |
| `zone_entered(z_road_east)` → `deliver_drones` | `toast` | system | `enemy reacts (deliver_drones)` | same defect | live |
| `zone_entered(z_demo)` → `deliver_support` | `toast` | system | `enemy reacts (deliver_support)` | same defect | live |
| any trigger with `do.kind: reinforce` | `toast` | system | `reinforcements — a second squad is up` | proposed replacement string; needs `describeMissionEvent` to read `do.kind` (§11 G-C) | engine |
| step machine, 13 steps | `tutorial` | — | shipped `title`/`teach`/`nudge` in `data/tutorial/beit_sahwan_0.json` | **the only condition-gated mid-mission text engine that exists**; not edited here — outside this agent's file rights | live |
| step `what_a_shot_costs` | `tutorial` | Shai | "The mortar does not care who is under it, and the number you carry out of here is the one that buys your next tank." | **the one `radio` line in Act I a live surface could carry today** — as an extra `teach` on an existing step; owner `mission-author`, not applied here | live |
| `objective(work_up, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Work through the training area` | applied | live |
| `objective(clear_the_area, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear the training area` | applied | live |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | Shai | "That is everything the battalion will hand you. Next week none of it is a demonstration." | end screen has zero authorable text | engine |

---

## 2. `beit_sahwan_breach` — Beit Sahwan — First Light

`breach` · Captain · `marj_perimeter` · produces **R M C** · `dawn`.
**The campaign's opening mission, and Nadir Sahim's atrocity.**

### 2.1 `name`

`Beit Sahwan — First Light` — **unchanged.**

### 2.2 `dispatch` — the campaign's opening

> *Beit Sahwan, before dawn. Nadir Sahim spent four years digging under the Marj
> and one morning spending it — every approach at once, and four villages left
> outside the wire. The senior officer still inside was a captain.*

219 chars. Narrator, story voice. It introduces Sahim **by what he did** and by
nothing else — no rank, no title, no cause — and it introduces Shai without
naming him, because the player is about to be him. `dispatch` is a field that
does not exist (`storyline.md` §7 G3); the title card holds for 900 ms and
dismisses on any input (`ui/motion.ts:49`), so a longer hold is part of the
same piece of work. Status **`schema`**.

### 2.3 `briefing` — 1,182 chars, 8 beats — **changed (delta pass)**

`design.md` §5.6: the shipped text *"already carries the atrocity in full and
**must not gain narration**"*, and needs *"two clauses it does not have: the
forward section, and the eye aloft."* Both are added; the five shipped beats
survive **word for word** as beats 1, 2, 3, 7 and 8.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | They came at dawn, out of the Marj, across every approach at once. | 66 |
| 2 | **Shai** | What is left of the company is inside the compound on the Beit Sahwan road, and the road is still open behind us — supply is coming forward, so spend it as it arrives rather than banking it. | 190 |
| 3 | **Idit** | Two gates, both on the road, and two blind faces they will cut straight through rather than walk round. | 103 |
| 4 | **Shai** | A section of the company is still outside the wire, north-west of the yard: bring it in and that corner of the wall is manned again, or leave it out and hold the one position we have past it. | 191 |
| 5 | **Idit** | They have an eye aloft north of the wire and a mortar crew laid in behind it. What lands in this yard lands because that eye is watching. | 137 |
| 6 | **Shai** | Only the sniper's rifle reaches that high, and the tube itself is four tiles off the section's position. Whichever of the two you spend is not covering the wall while it works. | 176 |
| 7 | **Shai** | The villages are outside the wire and the families in them have nowhere else to go: get at least two inside before the ring closes, because nobody is coming back for them afterwards. | 182 |
| 8 | **Shai** | Take something fast, brush them, and let them walk themselves in. Hold the yard, and still be standing when the column reaches us. | 130 |

Idit / Shai / Idit / Shai / Idit / Shai / Shai / Shai. The picture and the plan
alternate for six beats and the last three are Shai's, exactly as the shipped
five closed on two of his — the back half is cost and orders, which are his.

**What changed and why.**

1. **Beat 4 — the forward section, as a decision rather than a fact.** The level
   script moves one `inf_squad` from `[21,18]` to `[20,14]`, outside the wire
   (`script.md` §1.2, "The forward section"). The beat gives the player both
   halves of the choice and no recommendation: *"bring it in and that corner of
   the wall is manned again, or leave it out and hold the one position we have
   past it."* It does not say which is right, because the mission does not
   either.
2. **Beats 5 and 6 — the eye, the tube, and what answering either costs.**
   Idit reports the two placements (`bs0_spotter_aloft`, a `paramotor` on a
   lateral patrol at sight 14; `bs0_barrage`, a `mortar_crew` holding behind
   it) and states the relationship the whole opening turns on: *"what lands in
   this yard lands because that eye is watching."* Shai then prices both
   answers in one beat. **Both facts are measured, not asserted**: the
   `sniper_team`'s `amr` at range 15 is the only weapon inside the compound
   that reaches the paramotor at `[24.5,10.5]` (`rws_50` 9, `pintle_mg` 8,
   `rifles` 8 — `design.md` §5.2), and the tube at `[21.5,10.5]` is 3.8 tiles
   from the forward post at `[20,14]`, inside `rifles` range 8. *"Whichever of
   the two you spend is not covering the wall while it works"* is the cost, and
   it is the only sentence in the beat that is not a fact.
3. **Nothing else moved.** Beat 7 is the atrocity beat verbatim, *"nobody is
   coming back for them afterwards"* included; beats 1, 2, 3 and 8 are the
   shipped strings unedited. 675 → **1,182 chars**, inside the shipped 385–1,225
   band — second longest in the tree behind `wadi_halam_5_depot`'s 1,225, which
   is the band's own ceiling. That length is deliberate: First Light asks more
   simultaneous decisions than any other mission and it is the one briefing a
   player reads before they know anything at all.

**Idit is not named in the third person here, and that is the one briefing in
the act where she should not be.** `storyline.md` §3.1 records her beat at First
Light as *"she is **in** the compound, not on a net"*. Every other Act I
briefing refers to her by name because she is reporting from somewhere else;
this one does not, because she is standing next to him.

### 2.4 Objectives

| id | as an order | as a toast |
|---|---|---|
| `survive_relief` | Still be standing when the relief column arrives | `OBJECTIVE COMPLETE — Still be standing when the relief column arrives` |
| `hold_compound` | Hold the compound for three minutes | `OBJECTIVE COMPLETE — Hold the compound for three minutes` |
| `evac_settlements` | Get two families inside the wire before the ring closes | `OBJECTIVE COMPLETE — Get two families inside the wire before the ring closes` |
| `hold_outpost` | **Hold the post outside the wire for two minutes** | `OBJECTIVE COMPLETE — Hold the post outside the wire for two minutes` |

The first three are **unchanged**. `hold_outpost` is new
(`hold_for(outpost_ground, 120)`, secondary) and its provisional text was *"Hold
the forward post for two minutes"*.

**Why it changed.** `design.md` §5.6 asks the label to *"name the position, not
the men"*, and *"the post outside the wire"* is the position — it also stops the
line reading as a near-twin of `hold_compound`'s *"Hold the compound for three
minutes"*, which is the same verb, the same shape and the opposite decision. The
toast is where it earns its keep: `hold_for` completes at 120 s and the post is
overrun by the t=120 s wave, so `OBJECTIVE COMPLETE — Hold the post outside the
wire for two minutes` lands **in the same breath as the assault that takes it**.
That is the beat design §5.2 asks for — *they held for two minutes and then they
were gone* — and it is carried entirely by a live surface.

`evac_settlements` remains the only objective in this mission the runtime can
mark `failed` (`mission.ts:1478`), so the atrocity still has a mechanical voice
at t=270 s.

### 2.5 Trigger table

Rewritten for the level script (`script.md` §1.2). Waves and trigger ids are read
from `data/missions/beit_sahwan_breach.json` as it now stands, not from the
design sheet's summary of it.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan — First Light` · *2 primary objectives* | applied | live |
| mission start | `dispatch` | narrator | §2.2 above | needs the field + a longer title-card hold | schema |
| mission start | `brief` | Shai / Idit | beats 1–8 above | one hard-coded speaker today; **applied** | live |
| garrison `bs0_spotter_aloft` first identified | `radio` | Idit | "That is their eye, not a raider — he is pacing north of the wire and he is not coming any closer." | needs `say`; there is no placement-scoped trigger either, so this wants a `SimEvent contact` binding | engine |
| garrison `bs0_barrage` first fires | `radio` | Idit | "The tube is behind him and it is firing off what he can see. Take one of the two away and the other stops being worth anything." | | engine |
| wave t=18 s (10 units, five `raid_*` markers → `compound_centre`) | `toast` | system | `enemy reinforcements — 10 unit(s) inbound` | hard-coded | live |
| wave t=18 s (6 units, three `raid_*` markers → `assault_sw`) | `toast` | system | `enemy reinforcements — 6 unit(s) inbound` | hard-coded | live |
| wave t=18 s (either) | `radio` | Idit | "Every approach at once. There is no main effort in this — he does not need one." | | engine |
| wave t=50 s (2 `paramotor` from `raid_n`) | `radio` | Idit | "Two more aloft, north. They are coming in over the wire rather than through it." | retimed from the shipped t=245 wave; *"more"* added because the eye is already up at t=0 | engine |
| `first_contact` → `villages_rise` | `toast` | system | `enemy reacts (villages_rise)` | id shown verbatim; **rename proposed, §10** | live |
| `first_contact` → `villages_rise` | `radio` | Idit | "The north-east corner is moving and it is not moving on us. Those positions were manned before dawn, not after." | rewritten: the shipped line said *"corners"* plural and this trigger commits one group | engine |
| `first_contact` → `they_take_the_south_village` | `toast` | system | `enemy reacts (they_take_the_south_village)` | reads as prose; **keep** | live |
| `first_contact` → `they_take_the_south_village` | `radio` | Idit | "South-east the same second. They are not queuing for the gates — they are going to the houses." | new; the old `south_rises` line is retired with its trigger | engine |
| wave t=120 s (3 `militia_cell` + 1 `charge_squad` → `outpost`) | `radio` | Shai | "That is a charge squad walking onto the forward post. Whatever is out there is out there now." | the physical event `hold_outpost` is timed against | engine |
| `objective(hold_outpost, complete)` @120 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the post outside the wire for two minutes` | **applied**; lands in the same breath as the wave above | live |
| `objective(hold_outpost, complete)` @120 s | `radio` | Shai | "Two minutes on that corner. Nobody is going to ask them for a third." | | engine |
| `timer_s(150)` → `they_come_for_the_west_families` | `toast` | system | `enemy reacts (they_come_for_the_west_families)` | reads as prose; **keep** | live |
| `timer_s(150)` → `they_come_for_the_west_families` | `radio` | Idit | "West corner is up and walking to the houses. If anything of yours is going that way it goes now." | | engine |
| wave t=160 s (2 `technical` + 2 `rpg_team` → `compound_centre`) | `toast` | system | `enemy reinforcements — 4 unit(s) inbound` | hard-coded | live |
| **`timer_s(165)` → `they_take_the_section`** | `radio` | Idit | "The forward post is off the net. Nobody saw them fall and there is nothing out there to recover." | **the taking of the section.** No `do.kind` removes anything and `starting_force` cannot carry a `group` (`script.md` §1.6 G1, G2), so neither the trigger nor its line exists | engine |
| `timer_s(190)` → `the_last_village_goes` | `toast` | system | `enemy reacts (the_last_village_goes)` | reads as prose; **keep** | live |
| `timer_s(190)` → `the_last_village_goes` | `radio` | Idit | "That is the last corner. All four villages are inside their line now, not ours." | | engine |
| wave t=205 s (3 `moto_rpg` + 4 `militia_cell` → `assault_se`) | `radio` | Idit | "South-east now. Same face, other corner — he is reading which one you reinforced." | shipped line, retimed 15 s, content identical | engine |
| wave t=250 s (2 `paramotor` + 4 `militia_cell` → `compound_centre`) | `toast` | system | `enemy reinforcements — 6 unit(s) inbound` | hard-coded | live |
| `evacuated` (a civilian reaches `compound`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no case for it | **defect, §11 G-B**; proposed: `one family through the wire` | engine |
| `objective(evac_settlements, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get two families inside the wire before the ring closes` | applied | live |
| `objective(evac_settlements, complete)` | `radio` | Shai | "Two in. Get the gate shut behind them." | | engine |
| `objective(evac_settlements, failed)` @270 s | `toast` | system | `OBJECTIVE FAILED — Get two families inside the wire before the ring closes` | applied | live |
| `objective(evac_settlements, failed)` @270 s | `radio` | Idit | "The ring is closed. Whatever is still outside it is outside it." | **the single most important unbuilt line in Act I** | engine |
| **`timer_s(272)` → `the_ring_closes`** | `radio` | Idit | "The corners are walking back the way they came and they are not walking back empty." | **the taking of the families.** Same missing `do.kind` (`script.md` §1.6 G1). Replaces §9 T1's older sketch, which was written for a `timer_s(270)` kill rather than this trigger's id and timing | engine |
| `objective(hold_compound, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the compound for three minutes` | applied | live |
| `objective(survive_relief, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Still be standing when the relief column arrives` | applied | live |
| `roe` deduction inside `clinic` | `toast` | system | hard-coded `roeNotice` copy | strings are not authorable | live |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | Shai | "The column is through. We hold the yard we started the morning in and nothing else." | | engine |
| `missionEnd(victory)` | `debrief` | Idit | "Eleven were outside the wire at first light. Two came in." | **she says the number he will not**; `storyline.md` §2.2(6) | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The compound went at 0-something. I did not get the time." | | engine |

**The two takings are the only `engine` mechanisms in this mission** — every
other row above is either applied today or waits on the `radio` surface alone
(§11 G-E). Both are written here so the sheet is not silently short of Act I's
spine, and both are marked so nobody reads them as shippable. `design.md` §6.3's
recommended shipping order stands: the mission plays without them, and the
taking is stated in `dispatch`, `aftermath` and `debrief` until the verb lands.

---

## 3. `beit_sahwan_1_recon` — Beit Sahwan I — Recon

`recon` · Captain · `beit_sahwan_outskirts` · requires **R** · produces **R M C I**.
**Idit's first picture, and the first time the player sees a fire plan rather
than a picket line.**

### 3.1 `name`

`Beit Sahwan I — Recon` — **unchanged.**

### 3.2 `briefing` — 555 chars, 3 beats — **changed**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Before anything moves on Beit Sahwan, Idit needs the picture: six garrison positions, and the ATGM cell that overlooks the east road. An identification takes eyes held on a position, not a glance. | 196 |
| 2 | **Shai** | The battalion has attached one of everything it owns — armor, an IFV, mortars, scouts and a drone — so use this approach to learn your tools. Push the drone east, keep the heavy metal back as a screen, and do not get decisively engaged. | 236 |
| 3 | **Idit** | The mortar does not care who is under it. What you find and who you bring home is what the brigade fights with next week. | 121 |

Idit / Shai / Idit.

**What changed and why.** §3.1 marks this **re-brief n**, so the substance is
untouched and every distinctive phrase survives. Three edits, all of them
seam work:

1. *"command needs the picture"* → *"**Idit** needs the picture"*. The shipped
   sentence attributed the `locate` to an abstraction. It is hers — ten of the
   thirty-six shipped objectives are `locate` and every one of them is her
   asking a question (`storyline.md` §2.2).
2. The mechanical hint that was buried in an objective label —
   *"(get eyes on until ID)"* — became a sentence in her voice:
   *"An identification takes eyes held on a position, not a glance."* That is
   her defined function, **what knowing more costs**, and it reads as English
   rather than as a UI note in brackets.
3. *"mind the mortar near houses"* → *"The mortar does not care who is under
   it."* Same instruction, stated as a consequence rather than a caution, and
   it reuses the tutorial's own shipped phrasing (`what_a_shot_costs`).

The seams matter mechanically: the shipped string produced **two** beats, the
first of which mixed her sentence and his. Three beats with one speaker each is
what makes the two-hander expressible at all when the commander becomes data.

### 3.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `picture` | Identify six garrison positions | `OBJECTIVE COMPLETE — Identify six garrison positions` |
| `hvt_seen` | **Identify the ATGM cell overlooking the east road** | `OBJECTIVE COMPLETE — Identify the ATGM cell overlooking the east road` |

`hvt_seen` **changed** from *"Find and identify the ATGM cell overlooking the
east road (get eyes on until ID)"*. The old label read as an instruction sheet
in the order position and as a stage direction in the toast position; the
parenthetical moved into the briefing (§3.2). `picture` unchanged.

### 3.4 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan I — Recon` · *1 primary objective* | applied | live |
| mission start | `brief` | Shai / Idit | beats 1–3 above | applied | live |
| `first_contact` → `hunt_the_scouts` | `toast` | system | `enemy reacts (hunt_the_scouts)` | id reads well; **keep** | live |
| `first_contact` → `hunt_the_scouts` | `radio` | Idit | "Both technicals are off the eastern road and running for the assembly area. They are hunting the drone, not you." | | engine |
| `locate` count 1 of 6 | `radio` | Idit | "One. Hold it until it reads, then move." | | engine |
| `objective(picture, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify six garrison positions` | applied | live |
| `objective(picture, complete)` | `radio` | Idit | "Six positions, and every one of them was put there. That is a fire plan, not a picket line." | **SPADE by inference, two missions before he is named** | engine |
| `objective(hvt_seen, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the ATGM cell overlooking the east road` | applied | live |
| `objective(hvt_seen, complete)` | `radio` | Idit | "The ATGM cell has the whole east road. It has been in that position long enough to have a range card." | | engine |
| `SimEvent contact` on `bs_observer_aloft` | `radio` | Idit | "Something is orbiting the eastern edge. It is not shooting, which is worse." | ambient, §9 | engine |
| `SimEvent contact` on `bs_mortar_pit` | `radio` | Idit | "Mortar pit behind the town, laid on the approach we just used." | ambient, §9 | engine |
| `SimEvent destroyed`, side 0 | `eva` | brigade net | "Unit lost." | shared set, §8 | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | Idit | "That is the district on a board for the first time. Everything after this is us choosing where to go into it." | | engine |

---

## 4. `beit_sahwan_2_foothold` — Beit Sahwan II — Foothold

`foothold` · Captain · `beit_sahwan_outskirts` · requires **R** · produces **R M C**.
**He digs while you hold.**

### 4.1 `name`

`Beit Sahwan II — Foothold` — **unchanged.**

### 4.2 `briefing` — 648 chars, 4 beats — **changed**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The battalion has its foothold west of town and Ashwar knows it. Idit is reading spoil west of the line — disturbed earth creeping toward you, which means a crew is cutting a shaft out of town right now. | 203 |
| 2 | **Shai** | Hold the western approach for five minutes while the engineers dig in behind you. The corridor delivers reinforcements — spend them well; what survives tonight clears the town tomorrow. | 185 |
| 3 | **Idit** | Ashwar dug this ground for years before the war reached it, and a route that comes up behind your line is worth more to them than every man they will spend in front of it. | 171 |
| 4 | **Shai** | Keep the Yahalom engineers alive; they are the only team that can bring a tunnel down. | 86 |

Idit / Shai / Idit / Shai.

**What changed and why.** §3.1 marks this **re-brief n** — *"Already names the
digging and the Yahalom"* — so the digging and the Yahalom are exactly what
survived. Three edits:

1. *"Intel says a crew is already cutting a shaft"* → *"**Idit** is reading
   spoil west of the line"*. One word of attribution, and it turns a faceless
   source into the character who has to be right.
2. *"One more thing: Ashwar digs."* was a hinge, not a beat. It became her
   line about what the digging is **for**: a route behind the line is worth
   more than the men in front of it. That is `storyline.md` §2.3's
   characterisation of SPADE stated as doctrine, in the mission before he is
   named.
3. The seams moved so that the four beats each have one speaker. The shipped
   string put *"Hold the western approach…"* — an order — in the same beat as
   *"Ashwar knows it"*.

**Sahim is deliberately not named here.** §3.1 gives his presence in II as
*"he digs while you hold"*, and a villain who is announced before the player
has met his work is a villain the player has been told about rather than shown.

### 4.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `hold_west` | Hold the western approach for five minutes | `OBJECTIVE COMPLETE — Hold the western approach for five minutes` |
| `collapse_tunnel` | Collapse the tunnel Ashwar is digging under the approach | `OBJECTIVE COMPLETE — Collapse the tunnel Ashwar is digging under the approach` |

Both **unchanged.** `collapse_tunnel` declares no `seconds`, so it cannot fail
— there is no `OBJECTIVE FAILED` line to write for it.

### 4.4 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan II — Foothold` · *1 primary objective* | applied | live |
| mission start | `brief` | Shai / Idit | beats 1–4 above | applied | live |
| `timer_s(60)` → `flank_delivery_rolls` | `toast` | system | `enemy reacts (flank_delivery_rolls)` | rename proposed, §10 | live |
| `timer_s(60)` → `flank_delivery_rolls` | `radio` | Idit | "A technical is running the northern lane with passengers up. That is a taxi, not a gun truck." | | engine |
| `timer_s(67)` → `flank_delivery_drops` | `toast` | system | `enemy reacts (flank_delivery_drops)` | rename proposed, §10 | live |
| `timer_s(67)` → `flank_delivery_drops` | `radio` | Idit | "It has put an RPG team down short of your line and turned for home." | | engine |
| wave t=45 s (2) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=150 s (3) | `radio` | Idit | "Second lot out of the town centre, same track as the first." | | engine |
| wave t=260 s (3, from `mortar_line`) | `radio` | Idit | "Technicals off the mortar line. They only have the one road east and they keep using it." | ambient, §9 | engine |
| `SimEvent ventOpened` on `bs_tn_west` | `radio` | Idit | "A vent has opened behind the line. The shaft was finished before we got here." | | engine |
| `SimEvent surfaced` | `radio` | Idit | "They are up on the surface. They will fire once and go back down." | describes the shipped vent-and-submerge loop exactly | engine |
| `SimEvent tunnelCollapsed` | `eva` | brigade net | "Route collapsed." | shared set, §8 | engine |
| `objective(collapse_tunnel, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse the tunnel Ashwar is digging under the approach` | applied | live |
| `objective(collapse_tunnel, complete)` | `radio` | Shai | "That is one route they will not have back this year." | | engine |
| `objective(hold_west, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the western approach for five minutes` | applied | live |
| `built` (a reinforcement is produced at the camp) | `toast` | system | `reinforcement deployed — <unit id>` | hard-coded and prints the **raw unit id**; §11 G-D | live |
| `missionEnd(victory)` | `debrief` | Idit | "They spent a night's men on a line they did not want, to buy a day on a shaft they did." | | engine |

---

## 5. `beit_sahwan_3_clearance` — Beit Sahwan III — Clearance

`clearance` · Captain · `beit_sahwan_outskirts` · requires **R I** · produces **R M C** ·
`roe.fail_below: 40`, `flagged_zones: [clinic]`.
**Sahim's bait, and the strongest ROE writing in the tree.**

### 5.1 `name`

`Beit Sahwan III — Clearance` — **unchanged.**

### 5.2 `briefing` — 1,158 chars, 6 beats — **changed**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Idit's picture comes with you: at least one AT position dug in along the western approach, and the ATGM cell overlooking the eastern road. The fire plan is Nadir Sahim's; her section files him as SPADE. | 202 |
| 2 | **Shai** | A company minus probes the town outskirts. Identify the garrison before committing armour, destroy that cell before the follow-on convoy can move, then clear the town centre and hold it. | 186 |
| 3 | **Idit** | The district is not empty: residents shelter among the buildings and the clinic on the southern block is protected. Sahim knows it: he holds a position inside the clinic block itself, on the doorstep of the town centre you have to take. | 236 |
| 4 | **Shai** | Heavy ordnance near either will be judged: rifles and the Eitan's remote gun may work in there. Autocannon and tank fire may not — bring them near it and you will be billed for every second they can see it. | 206 |
| 5 | **Shai** | Engineers are attached: they can bring a held building down around its defenders, but they must stand beside it long enough to set the charges. | 143 |
| 6 | **Shai** | The militia hold the houses themselves: rounds will not reach them through masonry, so each building must come down or be cleared. Mind what you level — the mosque is not a target. | 180 |

Idit / Shai / Idit / Shai / Shai / Shai — the back half is Shai's because the
back half is fire policy and demolition, which are his.

**What changed and why.** §3.1 marks this **re-brief n** with *"The clinic-block
warning is the strongest ROE writing in the tree. Keep verbatim"*, and the task
requires Sahim named here because III is his bait. Both held:

1. **The warning is verbatim.** *"Rifles and the Eitan's remote gun may work in
   there. Autocannon and tank fire may not — bring them near it and you will be
   billed for every second they can see it."* Not a word moved. One full stop
   became a colon, joining it to *"Heavy ordnance near either will be judged"*,
   and that was done for a mechanical reason: at two sentences to a beat, the
   old arrangement pushed *"Autocannon and tank fire may not"* onto a separate
   page from the rule it qualifies. It now lands whole, in one beat, 206 of
   240 characters.
2. **He is named twice and characterised once.** *"The fire plan is Nadir
   Sahim's; her section files him as SPADE."* — a person and a file handle,
   in Idit's voice, as `storyline.md` §2.4(2) requires. Then *"Sahim knows it:
   he holds a position inside the clinic block itself"*, which replaces the
   shipped *"Be warned that the militia know it"*. Same fact, same block, same
   consequence; it now has an author. **The bait is that a named man is
   standing where the player is forbidden to shoot.**
3. The opener moved. *"A company minus probes the town outskirts"* was a fine
   sentence in the wrong beat — it opened a mission whose first fact is that
   the player is carrying last mission's intelligence (`requires:
   intel.marked_positions`). Idit's picture opens; his plan follows.
4. Total went from 1,093 to a longer but still in-range 1,158 (limit
   1,225) and from 7 beats to 6, because the shipped string had a 42-character
   orphan beat.

**`mosque` is left exactly as shipped, and it is not settled.**
`storyline.md` §0.3 **O10** is open for the lead: a structure type named for a
place of worship of a real faith, against GDD §2's rule. It is the structure
type in `data/structures.json`, it is 9 tiles on this map, and the briefing
line is mechanically accurate. Changing the word here without changing the
structure would make the text disagree with the data. **Recorded, not
resolved** — the lead's call, and if it goes the other way the fix is one word
in this file and one in `data/structures.json`.

### 5.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `picture` | Build the picture: identify four garrison positions | `OBJECTIVE COMPLETE — Build the picture: identify four garrison positions` |
| `kill_atgm` | Destroy the ATGM cell overlooking the east road | `OBJECTIVE COMPLETE — Destroy the ATGM cell overlooking the east road` |
| `take_town` | Clear the town centre and hold it for 20 seconds | `OBJECTIVE COMPLETE — Clear the town centre and hold it for 20 seconds` |

All three **unchanged.** They read correctly in both positions already.

### 5.4 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan III — Clearance` · *2 primary objectives* | applied | live |
| mission start | `brief` | Shai / Idit | beats 1–6 above | applied | live |
| `casualties_pct(50)` → `reserve_counterattack` | `toast` | system | `enemy reacts (reserve_counterattack)` | rename proposed, §10 | live |
| `casualties_pct(50)` → `reserve_counterattack` | `radio` | Idit | "The southern cell has left its own block and is running for the town centre. He has decided he can spend it." | | engine |
| first `roe` deduction inside `clinic` | `toast` | system | hard-coded `roeNotice` copy | strings not authorable | live |
| first `roe` deduction inside `clinic` | `radio` | **Nadir Sahim** | "You have the range. Take it." | **his only line in Act I.** Villain portrait plate; no other villain audio anywhere in this act | engine |
| `SimEvent contact` on `bs_charge_centre` | `radio` | Idit | "Charge squad in the market lane, sitting still. They are waiting for something with tracks." | | engine |
| `SimEvent contact` on `bs_loiter_munition` | `radio` | Idit | "Something small is loitering east of the town. It is one-use and it is looking for the Lavi." | ambient, §9 | engine |
| wave t=300 s (2, from `mortar_line`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| `objective(picture, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Build the picture: identify four garrison positions` | applied | live |
| `objective(kill_atgm, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Destroy the ATGM cell overlooking the east road` | applied | live |
| `objective(kill_atgm, complete)` | `radio` | Idit | "East road is clear of it. The convoy can move whenever you say." | | engine |
| `objective(take_town, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear the town centre and hold it for 20 seconds` | applied | live |
| `objective(take_town, complete)` | `radio` | Shai | "Town centre is ours. Nobody goes into the southern block for any reason." | | engine |
| `missionEnd(defeat)` via `fail_below: 40` | `debrief` | Idit | "The rating went under forty at the clinic block. That is the mission, and it is also the next three." | ROE gates nine KDF unlocks | engine |
| `missionEnd(victory)` | `debrief` | Shai | "The town is ours and the block is still standing. Both of those were the objective." | | engine |

---

## 6. `beit_sahwan_4_subterranean` — Beit Sahwan IV — Subterranean

`subterranean` · Captain → **Major at act end** · `beit_sahwan_outskirts` ·
requires **R I** · produces **R M C I** · `roe.fail_below: 40`.
**Act I closes here.**

### 6.1 `name`

`Beit Sahwan IV — Subterranean` — **unchanged.**

### 6.2 `briefing` — 1,178 chars, 7 beats — **changed (delta pass): the rescue**

The mission is no longer four routes and a clock. `design.md` §7 IV and
`script.md` §5.2 put **four people at the shaft head** at `[24.5,14.5]`, an
`rpg_team` beside them, **Nadir Sahim himself holding the shaft head**
(`bs4_hvt_spade`, `hold_position`, no `withdraw_to` anywhere in the mission),
and move the civilians' refuge to `civ_collection` at `[29,33]`, three tiles
from the start. The briefing now carries all of it and the second clock.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | The town is ours and the fighting has not stopped. Rounds come from empty ground, the shooters are gone before the echo, and the reason is under your feet. | 155 |
| 2 | **Idit** | Nadir Sahim mined this district years before we reached it and he has not left it. He holds the north shaft head, with four people beside him who have been out of reach since the first morning. | 193 |
| 3 | **Shai** | The collection point is three tiles from your start line, and they are counted the moment they reach it. Four minutes for the people and five for the routes; the second does not wait for the first. | 197 |
| 4 | **Idit** | Idit has four routes under the town, and one is being reopened right now: spoil creeping west along the main road. Disturbed earth is something any soldier can read. | 165 |
| 5 | **Shai** | A rocket team stands over the four; the Namer's cannon answers that and loses you the mission. Nothing heavy inside two tiles of them. | 134 |
| 6 | **Idit** | Only the drone or the engineers can tell you where the other three run, and only while somebody is looking. | 107 |
| 7 | **Shai** | Yahalom must stand still in the open beside a route to set the charge, so whether they live is a decision you make with everything else you have. Get the people out, take the ground he stands on, then bring all four down. | 221 |

Shai / Idit / Shai / Idit / Shai / Idit / Shai — the cleanest alternation in the
act, and it can be because the mission has exactly two subjects: what is under
the town, which is hers, and what it costs to reach it, which is his.

**What changed and why.**

1. **Beat 2 — the man and the four, in one breath.** *"He has not left it"* is
   the whole of `bs4_hvt_spade`'s behaviour as authored: `hold_position`, no
   `withdraw_to`, `script.md` §5.5 T-B5. *"Four people beside him who have been
   out of reach since the first morning"* is the only line in the act that
   reaches back to First Light, and it is a present-state fact rather than a
   story — **the taking itself is still told in `dispatch`, `aftermath` and
   `debrief` only** (`design.md` §6.3), because it is story voice and this is
   orders. Nothing here claims a rescue the mission cannot count.
2. **Beat 3 — the collection point and the two clocks.** `civ_collection`
   `[29,33]` is 3.2 tiles from `player_start [26,34]`, so *"three tiles from
   your start line"* is measured. *"Four minutes for the people and five for the
   routes; the second does not wait for the first"* is `get_them_out`'s 240 s
   and `bring_it_down`'s 300 s, said as the ordering problem they are: both run
   from t=0, and the shaft head is twenty tiles up a road with a live ambush on
   it.
3. **Beat 5 — the act's new ROE bait, priced in one sentence.** The four stand
   two tiles from an `rpg_team`; the `ifv_namer`'s `cannon_30` is the obvious
   answer to an ambushing RPG team and the one weapon that clears the
   danger-close threshold. *"The Namer's cannon answers that and loses you the
   mission"* is consequence and nothing else — no rule, no reproach, and the
   arithmetic behind it is real (`fail_below: 40`; four civilians killed is 32
   points).
4. **Beat 7 — the order of work, as the closer.** *"Get the people out, take the
   ground he stands on, then bring all four down"* replaces the shipped *"Bring
   all four down"* and is the mission's whole sequence in one line. **"Take the
   ground he stands on" is a `capture`, not a verb the runtime lacks** —
   `take_the_shaft_head` is `capture(shaft_head, 10)`, live today, so the
   briefing promises exactly what the mission can deliver. The Yahalom sentence
   ahead of it is shipped text, unedited.
5. **What was cut.** The shipped beat about charge squads reaching the line
   before it forms (`bs4_charge_crossroads` is still on the map) and the clause
   *"the other three were finished years ago and left no dirt at all"*. Both
   went for room: 912 → 1,178 chars with four new subjects to carry, and the
   surviving half of the second — *"only while somebody is looking"* — is the
   part that is a mechanic rather than a colour note.

**§11 G-A is closed.** The earlier sheet said this briefing must not say *"take
Sahim alive"* until a `capture` objective existed behind it. It exists
(`take_the_shaft_head`), so the line is written, and the `aftermath`'s **A**
variant (§6.4) is now the live one.

### 6.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `bring_it_down` | Collapse every route under the district | `OBJECTIVE COMPLETE — Collapse every route under the district` |
| `read_the_ground` | Find the crew reopening Sahim's western route | `OBJECTIVE COMPLETE — Find the crew reopening Sahim's western route` |
| `get_them_out` | **Get five people out to the collection point before the routes come down** | `OBJECTIVE COMPLETE — Get five people out to the collection point before the routes come down` |
| `take_the_shaft_head` | **Hold the shaft head until Sahim is out of it** | `OBJECTIVE COMPLETE — Hold the shaft head until Sahim is out of it` |
| `find_spade` | **Find Nadir Sahim at the shaft head** | `OBJECTIVE COMPLETE — Find Nadir Sahim at the shaft head` |

The first two are **unchanged**. Of the three new ones, two keep their
provisional text and one was polished.

- **`get_them_out` — kept verbatim.** At 71 characters it ties
  `tel_marum_2_foothold`'s observer line for the longest objective string in the
  tree, and it earns them: it names the count, the
  place and the deadline, and *"Get five people out"* deliberately answers First
  Light's *"Get two families inside the wire"*. **The act opens on getting
  people in and closes on getting people out**, in the same verb, and that rhyme
  is worth more than a shorter line. `count: 5` is global across all eight
  civilians on the map (`script.md` §5.6 G5) — the text says *"five people"*
  rather than *"the hostages"* for exactly that reason, and is therefore
  accurate rather than aspirational.
- **`take_the_shaft_head` — kept verbatim.** It was this sheet's own §6.5
  proposal and `script.md` §5.7 quoted it back. *"Until Sahim is out of it"*
  states a capture without asserting one the objective cannot check
  (`capture` cannot require its target alive — `script.md` §5.6 G4), and it
  names the ground rather than the man, which is what the objective actually
  measures.
- **`find_spade` — changed** from *"Find Nadir Sahim"*. The bare name is the one
  objective label in the act that is neither a position nor a task; it also
  reads oddly beside its sibling `read_the_ground`, which is the same verb with
  a place attached. **"Find Nadir Sahim at the shaft head"** names the position,
  pairs the secondary with the primary that takes it, and is accurate: the
  tagged placement sits at `[25.5,13.5]`, inside `shaft_head` `[25,12,3,3]`.

`bring_it_down` and `get_them_out` are both failable primaries on a clock, so
**Act I's last mission can be lost two ways on time and neither is a fight.**

### 6.4 `aftermath` — Act I closes

**Variant A is now the one.** The earlier sheet carried two, because A depended
on a capture placement that did not exist; `bs4_hvt_spade` and
`take_the_shaft_head` both ship now, so A is honest against the mission as it
stands and B is retired.

> *Four routes under Beit Sahwan, and the man who dug them came up out of the
> last one with his hands empty. Brigade put a third star on the slip and said
> nothing else about it. The Marj is quiet. Sur is not.*

205 chars. Three stars is Major (`storyline.md` §2.1, §0.2 O6). *"Came up out of
the last one with his hands empty"* is a capture and says so without a verb the
player did not perform — and `capture(shaft_head, 10)` is the verb they did.
The last two sentences hand the campaign to Act II.

**Retired — variant B**, kept only so nobody re-derives it: *"Four routes under
Beit Sahwan, and by morning none of them went anywhere. Brigade put a third star
on the slip and said nothing else about it. Sahim is not in the district any
more, and neither is his ground."* It claimed no capture because none was
authorable. It is now weaker than the mission.

Status **`schema`** — the field does not exist (`storyline.md` §7 G3).

### 6.5 Trigger table

`beit_sahwan_4_subterranean` still declares **no triggers**, deliberately: T-B5
(*"he waits"*) is the absence of a `withdraw_to`, and adding a
`casualties_pct(spade_party)` row would delete it. Every row below is an
objective, a wave, a `SimEvent` or the mission end.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan IV — Subterranean` · *3 primary objectives* | title count changes with the two new primaries; applied | live |
| mission start | `brief` | Shai / Idit | beats 1–7 above | **applied** | live |
| garrison `bs_track_north` spawns **pre-identified** (tag carried in `intel.marked_positions` from I) | `radio` | Idit | "The track north of the road is where I lost the column last time, and it is still occupied. You are looking at it before it looks at you." | the payoff of I's new `find_the_column` secondary (`locate(bs_track_north)`); a thorough recon forfeits this ambush | engine |
| garrison `bs_track_north` spawns **unmarked** (I's secondary not completed) | `radio` | Idit | "There is a gun on the road north and I cannot tell you where. We did not finish looking last time." | the same placement, the other way round — one of only two places in Act I where carry-over is audible | engine |
| `SimEvent contact` on `bs4_hvt_spade` | `radio` | Idit | "That is Sahim, on the shaft head, not moving. He has never once left his own hole and he is not going to start." | | engine |
| `objective(find_spade, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find Nadir Sahim at the shaft head` | **applied** | live |
| `SimEvent contact` on the `spade_guard` `rpg_team` | `radio` | Shai | "Rocket team two tiles off the people. Rifles only in there — the cannon is not a choice you have." | the mission's ROE bait, restated at the moment it becomes live | engine |
| `SimEvent tunnelContact` (side 0, any route) | `radio` | Idit | "Route identified. Hold the eye on it — the moment nobody is looking it goes back to a rumour." | **the shipped mechanic exactly**: identification is live only while a `mark_tunnel` carrier holds line of sight | engine |
| `evacuated` (a civilian reaches `collection_point`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no case for it | **defect, §11 G-B**, and it bites hardest here: the rescue's own progress is silent until the fifth one lands | engine |
| `evacuated`, first of the four from the shaft head | `radio` | Shai | "One of them is on our side of the road. Keep the lift moving and do not stop to fight for it." | the `ifv_namer`'s 5 slots take the whole group in one lift | engine |
| wave t=150 s (2 `militia_cell` from `mortar_line`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| `SimEvent ventOpened` | `eva` | brigade net | "Vent opened." | shared set, §8 | engine |
| `SimEvent surfaced` | `radio` | Idit | "Up behind you, out of ground you cleared an hour ago." | | engine |
| `objective(get_them_out, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get five people out to the collection point before the routes come down` | **applied** | live |
| `objective(get_them_out, complete)` | `radio` | Idit | "Five at the collection point. That is the first time this district has given anybody back." | | engine |
| `objective(get_them_out, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Get five people out to the collection point before the routes come down` | **applied**; a failed primary loses the mission (`checkEnd`) | live |
| `objective(get_them_out, failed)` @240 s | `radio` | Shai | "Clock is out on the people. Nothing under this town is worth what we just did not do." | the mirror of First Light's failure, at the other end of the act | engine |
| `objective(take_the_shaft_head, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the shaft head until Sahim is out of it` | **applied** | live |
| `objective(take_the_shaft_head, complete)` | `radio` | Idit | "The shaft head is yours and he is standing on the wrong side of it. Four years of digging and he is above ground." | **Act I's ending, said once** | engine |
| wave t=240 s (1 `rpg_team` + 1 `technical` from `mortar_line`) | `radio` | Idit | "Last of what the mortar line can send. After this he is spending the ones underground." | | engine |
| `objective(read_the_ground, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the crew reopening Sahim's western route` | applied | live |
| `objective(read_the_ground, complete)` | `radio` | Idit | "That is the crew on the west route. He keeps his diggers close to the work, which is how we found him." | tense changed: the sheet no longer promises a capture the mission cannot stage — it has one | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_west`) | `radio` | Shai | "West route down." | needs a per-route `say`; `level-scripter` | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_north`) | `radio` | Shai | "North route down. That is the one under the shaft head." | | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_souk`) | `radio` | Idit | "The souk route is down. That one was older than the war." | ambient, §9 | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_clinic`) | `radio` | Idit | "Clinic route down. He put it there on purpose and we took it without touching the block." | **the act's ROE thesis in one line** | engine |
| `objective(bring_it_down, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse every route under the district` | applied | live |
| `objective(bring_it_down, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Collapse every route under the district` | applied | live |
| `objective(bring_it_down, failed)` @300 s | `radio` | Idit | "Clock is out and there is still ground under this town that is not ours." | | engine |
| `roe` deduction within 2 tiles of the four | `toast` | system | hard-coded `roeNotice` copy | strings not authorable; this is the deduction the briefing priced | live |
| `missionEnd(defeat)` via `fail_below: 40` | `debrief` | Idit | "The rating went under forty with them standing there. He does not have to win these; he only has to be next to them." | | engine |
| `missionEnd(victory)` | `aftermath` | narrator | §6.4 above | victory banner | schema |
| `missionEnd(victory)` | `debrief` | Idit | "Four routes, and all four were his. That is the Marj." | | engine |
| `missionEnd(victory)` | `debrief` | Shai | "Then we go north." | **the act boundary and the promotion**; Captain → Major | engine |

---

## 7. Ambient lore — secondary locations

Places the player passes through that no objective names. Every line is a
`radio` transmission or a `toast`, fires once, and stops the game for nobody.

| location | map / id | channel | speaker | line | status |
|---|---|---|---|---|---|
| the corner villages | `marj_perimeter` staging at `[6,8] [37,8] [6,39] [38,39]` | `radio` | Idit | "Those four corners were occupied before the first shot. The families are between them and us." | engine |
| **the forward post** | `marj_perimeter` `outpost` `[20,14]` / zone `outpost_ground` | `radio` | Idit | "That post was put out there to watch the northern approach in a war nobody thought was coming this week." | engine |
| **the families' markers** | `marj_perimeter` `families_nw/ne/sw/se` | `radio` | Idit | "Four village blocks, one family in each, and every one of them is closer to a corner than it is to us." | engine |
| the compound gates | `marj_perimeter` `compound` | `radio` | Idit | "Two gates, both on the road. They have never once used them." | engine |
| `civ_refuge` | both maps | `toast` | system | `one family through the wire` | engine |
| **the collection point** | `beit_sahwan_outskirts` `civ_collection` `[29,33]` / zone `collection_point` | `radio` | Shai | "Collection point is behind the start line and it stays behind it. Nothing forms up there and nothing fights from there." | engine |
| **the shaft head** | `beit_sahwan_outskirts` zone `shaft_head` `[25,12,3,3]` | `radio` | Idit | "The north mouth comes up inside that block. He did not choose it for the ground — he chose it for who lives on top of it." | engine |
| the mortar line | `beit_sahwan_outskirts` `mortar_line` | `radio` | Idit | "Everything that reinforces this town comes down the one track east of it. They have never needed a second." | engine |
| the market lane | `bs_ambush_market_lane` | `radio` | Idit | "The market lane has been an ambush position since before we crossed the line. It is where the district narrows." | engine |
| the west alley | `bs_ambush_west_alley` | `radio` | Idit | "West alley. Whoever picked it picked the one place armour cannot turn round." | engine |
| the north block | `bs_cell_north_block` (garrisoned building) | `radio` | Idit | "They are inside the north block, not behind it. Rounds will not reach them through that." | engine |
| the souk route | `bs_tn_souk` | `radio` | Idit | "This one runs under the souk. It is older than the war, and it was not dug for the war." | engine |
| the clinic route | `bs_tn_clinic` | `radio` | Idit | "The fourth comes up under the clinic block. That is not geology." | engine |
| the north route | `bs_tn_north` | `radio` | Idit | "North route, under the housing, with two teams sitting in it waiting for a vent." | engine |
| `tunnel_mouth_west` | `beit_sahwan_outskirts` zone | `radio` | Idit | "The western mouth is where the spoil ends. It is the only one of the four that ever showed us anything." | engine |
| the training area | `tutorial_ground` | `radio` | Shai | "This ground was a battalion range before it was anything. Next week it is behind the line." | engine |

---

## 8. EVA announcements — the shared set

**Written once for the whole campaign, not per mission.** The brigade net, not a
person: flat, unhurried, no prowords beyond *Actual*, no name, no accent, no
idiom. `storyline.md` §2.4(5) binds hardest here — **write the doctrine rule at
the top of this set before a single line is recorded** (GH-110), because
retrofitting it means throwing the audio away.

`audio.schema.json`'s `KNOWN_EVENTS` is six weapon and impact events today, so
`pnpm validate:audio` **cannot accept a voice file at all**. The gate widens
first (`storyline.md` §7 G4).

| event | line | status |
|---|---|---|
| `objective` complete | "Objective complete." | engine |
| `objective` complete, last primary | "Primary objective complete." | engine |
| `objective` failed | "Objective failed." | engine |
| `trigger` fired | "Enemy movement." | engine |
| `wave` inbound | "Reinforcements inbound." | engine |
| `built` — player reinforcement produced | "Reinforcements on the road." | engine |
| `SimEvent destroyed`, side 0 | "Unit lost." | engine |
| `SimEvent destroyed`, side 0, second within 10 s | "Another one." | engine |
| `roe` deduction | "Rules of engagement. Deduction recorded." | engine |
| `roe` score within 10 of `fail_below` | "Rating is close to the floor." | engine |
| `SimEvent ventOpened` | "Vent opened." | engine |
| `SimEvent tunnelCollapsed` | "Route collapsed." | engine |
| `evacuated` | "Civilian through the wire." | engine |
| `missionEnd` victory | "Mission accomplished." | engine |
| `missionEnd` defeat | "Mission failed." | engine |

## 8a. Barks

**Not written here, deliberately.** Barks are keyed by unit role, not per unit
(GH-110), and the doctrine-not-people rule has to head that sheet **before** a
line exists, because it constrains accent, idiom and phrasing — the things that
carry ethnicity in a recording, and the things that cannot be edited out of one.
Act I fields eleven KDF roles and eleven Ashwar roles; a role-keyed set for both
is its own deliverable and should not be smuggled in at the bottom of a briefing
sheet.

---

## 9. The twist candidates — T1 to T5

`storyline.md` §3.1 proposes five in-level twists for Act I. The lines are
written; the classification is `level-scripter`'s to confirm. **Every line here
is `engine` regardless of whether its mechanic is expressible today**, because
there is no surface that can speak mid-mission — that is the whole of §7 G1.
The "mechanic" column is what would be needed *besides* a voice.

| # | mission | twist | channel | speaker | line | mechanic | status |
|---|---|---|---|---|---|---|---|
| **T1** | `_breach` | *The families that did not get in.* **Now authored as the trigger `the_ring_closes` at `timer_s(272)`** (`script.md` §1.2) — the nine outside are **taken**, not killed | `radio` | Idit | "The corners are walking back the way they came and they are not walking back empty." | **engine** — `do:{kind:"remove", group:"families"}`; `design.md` §6.1, `script.md` §1.6 G1. The old sketch, written for a 270 s *kill*, is retired: an abduction must not run through `destroy()` or it deducts 8 ROE for the enemy's act | engine |
| **T2** | `_1_recon` | *The picture is old.* One `locate` target was abandoned days ago; the real cell is four tiles off | `radio` | Idit | "That position is cold. No fire, and the tracks leaving it are days old — the cell is off it and close." | expressible today: two tagged placements plus a `spawn` | engine |
| **T3** | `_2_foothold` | *The spoil was a decoy.* The western shaft is real and empty; the route under the line is a second one | `radio` | Idit | "The western shaft is real and it is empty. The route under your line is a different one and it was finished before we came." | expressible today: two routes, one `collapse` target | engine |
| **T4** | `_3_clearance` | *He is in the block.* Sahim is identified inside the flagged block and leaves during the fight | `radio` | Idit | "Sahim is inside the clinic block. That is a confirmed identification and a protected structure, and it is the same building." | expressible today: tagged placement + `withdraw_to` | engine |
| **T4b** | `_3_clearance` | …and he leaves | `radio` | Idit | "He is out of the block and moving north on foot." | same trigger's `withdraw_to` | engine |
| **T5** | `_4_subterranean` | *A soldier under the road.* **The shipped half is now the baseline** — the four at the shaft head are a `civilians` placement, and §6.2 beat 2 says they have been out of reach since the first morning. What is still a twist is the *loss*, in First Light | `radio` | Idit | "We have lost a Yahalom team off the net at the west shaft. They did not die. They went down." | **engine** — player-side removal plus `group` on `starting_force` (`script.md` §1.6 G1, G2). A true friendly-tagged prisoner is a further schema field (`design.md` §9 G6) | engine |

**T4 is the one to build first**, and not because it is the cheapest. It is the
only twist in the act that states the campaign's whole engine in one event: the
player knows exactly where the man who opened the war is standing, and shooting
there loses the mission at `fail_below: 40`. Everything else in Act I is a
version of that argument; T4 is the argument itself.

---

## 10. Trigger id renames — **proposals only**

A trigger's `id` is shown to the player verbatim as `enemy reacts (<id>)`
(`main.ts:262`), so an id is player-facing prose. `mission.schema.json` puts no
pattern on it. **`level-scripter` owns these ids and none of them were changed
in the JSON.**

| mission | shipped id | proposed | why |
|---|---|---|---|
| `_breach` | `villages_rise` | `the_north_village_goes_first` | **The one that matters, and the level script kept it** (`script.md` §1.1, "shipped, kept"). The proposal stands and is now *stronger*: the trigger's `do` changed from `commit → compound_centre` to `commit(ring_ne → families_ne)`, so `enemy reacts (villages_rise)` is printed at the exact moment armed men move on a village the player is scored on protecting. GDD §2 forbids attaching combat to a population. The new name also pairs with the three ids `level-scripter` wrote beside it — `they_take_the_south_village`, `they_come_for_the_west_families`, `the_last_village_goes` — which all read correctly as prose and need no change |
| `_breach` | `south_rises` | **retired** | the trigger no longer exists; the four ring groups now commit on `first_contact` ×2 and `timer_s` 150 / 190. Its `radio` line is retired with it (§2.5) |
| `_2_foothold` | `flank_delivery_rolls` | `a_technical_runs_the_north_lane` | "Flank delivery" is authoring jargon in the player's face |
| `_2_foothold` | `flank_delivery_drops` | `it_puts_an_rpg_team_down` | reads as the second half of a sentence, which is what it is |
| `_3_clearance` | `reserve_counterattack` | `the_southern_cell_commits` | accurate and less like a wargame manual |
| `_1_recon` | `hunt_the_scouts` | **keep** | already reads as prose: `enemy reacts (hunt_the_scouts)` |
| `_0_tutorial` | all six `deliver_*` | **keep the ids; fix the prefix** | renaming cannot help — the prefix is hard-coded `enemy reacts` and these are friendly deliveries. §11 G-C |

---

## 11. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | ~~**Act I has no ending.**~~ **CLOSED.** `bs4_hvt_spade` (`militia_cell`, `hold_position`, `[25.5,13.5]`), the `shaft_head` zone `[25,12,3,3]` and the `capture(shaft_head, 10)` primary `take_the_shaft_head` all ship. The `aftermath` **A** variant is now the live one (§6.4), the objective text this sheet proposed is applied verbatim, and §6.2 beat 7 says *"take the ground he stands on"* with a real objective behind it. **No engine work was needed, exactly as predicted.** What remains is a smaller, separate gap: `capture` cannot require its target alive, so the objective completes the same whether Sahim is standing there or already dead (`script.md` §5.6 G4) | done; the residue is an optional `requires_alive` on `capture` | `sim-guard` |
| **G-B** | **A civilian reaching the wire is silent.** `evacuated` is a `MissionEvent` and `describeMissionEvent` (`main.ts:253`) has no case for it, so it falls to `default: return null`. The mechanic the whole campaign's motive rests on — First Light's eleven, and `evacuate_before` in three shipped missions — produces **no toast, no sound and no line**. Only the objective's own completion at count 2 says anything | one `case 'evacuated'` returning a toast | `render-vfx` |
| **G-C** | **A friendly reinforcement is announced as an enemy reaction.** `describeMissionEvent`'s `case 'trigger'` prints `enemy reacts (<id>)` for every trigger regardless of `do.kind`. Six of the tutorial's six triggers are `reinforce` — the player's own equipment arriving — so the game's teaching mission announces each delivery as an enemy move | read `mission.triggers[].do.kind` and print `reinforcements (<id>)` for `reinforce` | `render-vfx` |
| **G-D** | **`built` prints a raw unit id.** `reinforcement deployed — ifv_namer`. Every other toast in that function is prose | look the display name up from the unit JSON | `render-vfx` |
| **G-E** | **No mid-mission line of any kind.** Everything in the `radio` rows above — 46 of them in this act — waits on `say: { speaker, text }` on `triggers[].do` and `objectives[]`, emitted as a new `MissionEvent` kind, plus an overlay. No sim state changes, so the determinism hash cannot move | `storyline.md` §7 G1 | `sim-guard` + `render-vfx` |
| **G-F** | **The commander is a constant with one rank.** `ui/hud.ts:68` reads `Lt Col Shai Hammai` in all six Beit Sahwan missions; he is a **Captain** in every one of them. The player is told the wrong rank for the whole of Act I, including the mission whose entire point is that he is too junior for the job he is doing | `data/campaign/commander.json` per §7 G2 | `mission-author` + `render-vfx` |
| **G-G** | **No `dispatch`, `aftermath` or `debrief` field exists.** §2.2, §6.4 and every `debrief` row above are written and unshippable | three optional strings | `sim-guard` + `render-vfx` |
| **G-H** | **`pnpm validate:audio` cannot accept a voice file.** Its `KNOWN_EVENTS` is six weapon/impact events. Every row in §8 is blocked on the gate widening before a single line is recorded | a non-weapon set kind | `content-validator`; GH-110 |
| **G-I** | **O10 is open.** `mosque` is a structure type named for a place of worship of a real faith, on three maps, and `_3_clearance`'s briefing names it. GDD §2 says never a faith. Not resolved here — the lead's, per `storyline.md` §0.3 | one word in `data/structures.json` and one in the briefing, together or not at all | the lead |

---

## 12. GDD amendments

**None. Canon did not move.**

Checked against `docs/GDD.md` §11 as it stands: Shai Hammai, Captain at First
Light, promoted across the campaign; Idit Zohar in the same compound; the two of
them the voices of the HUD with the briefing as a two-hander; one villain per
front, opened with an atrocity, ended captured or killed, characterised by
doctrine and named in the fictional register the towns use; the planned
surfaces listed as approved and unbuilt. Everything this sheet writes sits
inside that. **No edit to `docs/GDD.md` was made and its version line is
untouched.**

**Re-checked for the delta pass**, because two of the changes look at first like
canon moving and neither is. §11 already says the villain *"ends with him
captured or killed"*, so IV's `capture(shaft_head, 10)` is that sentence being
honoured rather than extended. And §11 already says *"missions may turn the plot
inside the level — a kidnapped civilian killed, a soldier abducted — where the
declarative vocabulary can express it, and the vocabulary is extended where it
cannot"*: the four at the shaft head are the expressible half, the two `remove`
triggers are the half that needs extending, and §11 anticipated both. **No edit
and no version bump.**

One optional refinement is offered and **not applied**, because it is the
lead's to take. §11 states the naming rule for the villains but names none of
them, while shipped mission text now names one. If the lead wants canon and
content to agree by name, the smallest change is a single clause in §11's
villain paragraph:

> **Proposed, not applied.** In §11, *"…characterised by his doctrine (the
> digger, the observer, the smuggler) and named in the fictional register the
> towns use."* becomes *"…characterised by his doctrine and named in the
> fictional register the towns use — Nadir Sahim in the Marj, Karim Adhal in
> Sur, Jubran Hallaq in Naharin, filed by Idit's section as SPADE, LANTERN and
> FERRY."*

That is +1 sentence and a version bump from 1.2 to 1.2.1. It moves no decision;
`storyline.md` §0.2 already records all three names as decided on 2026-09-03.

---

## 13. Row counts

Every table row in this file whose last cell is `live`, `schema` or `engine`,
counted by script rather than by eye. **170 rows**, up from 140 before this
delta pass — the level script added triggers, waves, objectives and two whole
positions, and each of them needed binding.

| status | rows | what they are |
|---|---|---|
| `live` | **63** (was 53) | `title` 6 · `brief` 6 · `toast` 49 · `tutorial` 2. Shipped surfaces only: title cards, deploy-screen briefings, objective / trigger / wave / mission-end / ROE toasts, and the tutorial step machine. **The 6 applied briefings and the 4 applied objective labels are inside this count, validated.** Eight of the 49 toasts are `live` and *wrong* — the six `enemy reacts (deliver_*)` deliveries and the two raw-id `built` lines (G-C, G-D) |
| `schema` | **2** (unchanged) | `dispatch` on First Light, `aftermath` on IV. Two optional strings away from shipping; **§6.4 is down to one variant now that G-A is closed**, so both are authorable the moment the fields exist |
| `engine` | **105** (was 85) | `radio` 72 · `eva` 18 · `debrief` 11 · `toast` 4 (the replacements the hard-coded strings block) |

**105 `engine` rows.** That is the number to quote: **62% of the writing in this
act reaches nobody today**, and all of it sits behind four pieces of work —
`say` on triggers and objectives, a radio overlay, the three story fields, and a
debrief screen. One `radio` line in the whole act has a live carrier, and only
because the tutorial's step machine exists (§1.4).

**Two of the 105 are `engine` for a second reason, and they are the act's
spine.** `they_take_the_section` (§2.5, `timer_s(165)`) and `the_ring_closes`
(§2.5, `timer_s(272)`) wait on a `do.kind` that removes a group *and* — for the
first — on `group` being legal on `starting_force` (`script.md` §1.6 G1, G2).
Every other `engine` row in this sheet has a working mechanism and no voice;
those two have neither. They are written anyway, and marked twice, because
`design.md` §6.3's shipping order is to author the act without them: the mission
plays, the evacuation still fails visibly at 270 s, and the taking is **stated**
in `dispatch`, `aftermath` and `debrief` until the verb lands.

**What this delta pass changed in the JSON**, and nothing else:
`beit_sahwan_breach.briefing` (675 → 1,182 chars, 5 → 8 beats),
`beit_sahwan_breach.objectives[hold_outpost].text`,
`beit_sahwan_4_subterranean.briefing` (912 → 1,178 chars, 5 → 7 beats), and
`beit_sahwan_4_subterranean.objectives[find_spade].text`. `get_them_out` and
`take_the_shaft_head` keep the text they shipped with. `pnpm validate:data`
passes on 77 files; `loading.test.ts` passes; every beat in both briefings is
≤ 240 characters and ≤ 2 sentences, checked with a port of `briefingBeats`
rather than by eye.

**Nothing in this sheet blocks Act II.** The six applied briefings, the four
applied objective labels and the six unchanged mission names are the whole of
what Act I can say to a player right now, and they say it in one voice with
Idit named in the third person wherever she is not standing in the room —
which at First Light, alone in the act, she is.
