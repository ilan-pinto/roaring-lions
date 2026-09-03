# Beit Sahwan — Narrative Trigger Sheet

**Act I · The Marj Strip · Ashwar Front · Shai Hammai is a Captain throughout.**

**Date:** 2026-09-03 · **Status:** the `live` rows are applied to
`data/missions/beit_sahwan_*.json` and pass `pnpm validate:data`; everything
else is written against a surface that does not exist yet and says so.
**Written against** the six shipped missions on `feat/story-act-1`, read from
the JSON this session. Contract: `docs/campaign/README.md`. Canon:
`docs/campaign/storyline.md` §0.2, §1, §2, §3.1. GDD §2 and §11.

Upstream: no `docs/campaign/beit_sahwan/design.md` exists — `campaign-designer`
has not run for this town. This sheet is written from `storyline.md` §3.1's
ladder and the shipped JSON directly, and every mechanical claim below is read
from the mission files rather than from a design document.

Downstream: `level-scripter` (binding lines to triggers, the id renames in §10),
`mission-author` (the +1 placement Act I's ending needs, §11 G-A),
`render-vfx` (radio overlay, debrief screen, the two toast defects in §11),
`sim-guard` (`say` on triggers and objectives).

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

### 2.3 `briefing` — 675 chars, 5 beats — **unchanged, deliberately**

`storyline.md` §3.1: *"Carries the atrocity in full. Needs the campaign's
opening `dispatch` and nothing else — the orders voice must not gain
narration."* The shipped string splits into a clean two-hander with no edit at
all, which is the strongest possible argument for leaving it alone.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | They came at dawn, out of the Marj, across every approach at once. | 66 |
| 2 | **Shai** | What is left of the company is inside the compound on the Beit Sahwan road, and the road is still open behind us — supply is coming forward, so spend it as it arrives rather than banking it. | 190 |
| 3 | **Idit** | Two gates, both on the road, and two blind faces they will cut straight through rather than walk round. | 103 |
| 4 | **Shai** | The villages are outside the wire and the families in them have nowhere else to go: get at least two inside before the ring closes, because nobody is coming back for them afterwards. | 182 |
| 5 | **Shai** | Take something fast, brush them, and let them walk themselves in. Hold the yard, and still be standing when the column reaches us. | 130 |

Idit / Shai / Idit / Shai / Shai. Beat 4 is the only line in the campaign where
Shai says a cost of this kind out loud, and he still does not say the number:
**eleven are outside, two are counted, nine are not.** That number is Idit's,
and she says it at the end (§2.6).

### 2.4 Objectives

| id | as an order | as a toast |
|---|---|---|
| `survive_relief` | Still be standing when the relief column arrives | `OBJECTIVE COMPLETE — Still be standing when the relief column arrives` |
| `hold_compound` | Hold the compound for three minutes | `OBJECTIVE COMPLETE — Hold the compound for three minutes` |
| `evac_settlements` | Get two families inside the wire before the ring closes | `OBJECTIVE COMPLETE — Get two families inside the wire before the ring closes` |

All three **unchanged.** `evac_settlements` is `evacuate_before`, which is one
of only three objective types the runtime can mark `failed`
(`mission.ts:1478`), so the atrocity has a mechanical voice:
`OBJECTIVE FAILED — Get two families inside the wire before the ring closes`
at t=270 s. Nothing else in Act I fails on a clock except IV's `collapse`.

### 2.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan — First Light` · *2 primary objectives* | applied | live |
| mission start | `dispatch` | narrator | §2.2 above | needs the field + a longer title-card hold | schema |
| mission start | `brief` | Shai / Idit | beats 1–5 above | one hard-coded speaker today | live |
| `first_contact` → `villages_rise` | `toast` | system | `enemy reacts (villages_rise)` | id shown verbatim; **rename proposed, §10** | live |
| `first_contact` → `villages_rise` | `radio` | Idit | "Movement out of the north corners. Those positions were manned before dawn, not after." | needs `say` on `triggers[].do` | engine |
| `timer_s(240)` → `south_rises` | `toast` | system | `enemy reacts (south_rises)` | rename proposed, §10 | live |
| `timer_s(240)` → `south_rises` | `radio` | Idit | "South corners committing. That is the last of what was staged outside the wire." | | engine |
| wave t=20 s (7 units, `raid_w`/`raid_nw`) | `toast` | system | `enemy reinforcements — 7 unit(s) inbound` | hard-coded | live |
| wave t=55 s (6) | `radio` | Idit | "Second push, south and east. The motorcycles are the ones that will reach you first." | | engine |
| wave t=95 s (6, to `assault_nw`) | `radio` | Idit | "They have stopped coming at the gates. North-west face, where the wall has no eyes." | | engine |
| wave t=140 s (4) | `toast` | system | `enemy reinforcements — 4 unit(s) inbound` | hard-coded | live |
| wave t=190 s (7, to `assault_se`) | `radio` | Idit | "South-east now. Same face, other corner — he is reading which one you reinforced." | | engine |
| wave t=245 s (6, paramotors from `raid_n`) | `radio` | Idit | "Two aloft, north. They are coming in over the wire rather than through it." | | engine |
| `evacuated` (a civilian reaches `compound`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no case for it | **defect, §11 G-B**; proposed: `one family through the wire` | engine |
| `objective(evac_settlements, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get two families inside the wire before the ring closes` | applied | live |
| `objective(evac_settlements, complete)` | `radio` | Shai | "Two in. Get the gate shut behind them." | | engine |
| `objective(evac_settlements, failed)` @270 s | `toast` | system | `OBJECTIVE FAILED — Get two families inside the wire before the ring closes` | applied | live |
| `objective(evac_settlements, failed)` @270 s | `radio` | Idit | "The ring is closed. Whatever is still outside it is outside it." | **the single most important unbuilt line in Act I** | engine |
| `objective(hold_compound, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the compound for three minutes` | applied | live |
| `objective(survive_relief, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Still be standing when the relief column arrives` | applied | live |
| `roe` deduction inside `clinic` | `toast` | system | hard-coded `roeNotice` copy | strings are not authorable | live |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | Shai | "The column is through. We hold the yard we started the morning in and nothing else." | | engine |
| `missionEnd(victory)` | `debrief` | Idit | "Eleven were outside the wire at first light. Two came in." | **she says the number he will not**; `storyline.md` §2.2(6) | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The compound went at 0-something. I did not get the time." | | engine |

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

### 6.2 `briefing` — 912 chars, 5 beats — **changed**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | The town is ours and the fighting has not stopped. Rounds come from empty ground, the shooters are gone before the echo, and the reason is under your feet. | 155 |
| 2 | **Idit** | Nadir Sahim mined this district years before we reached it, and Idit has four routes under the town. One is being reopened right now: spoil creeping west along the main road, and disturbed earth is something any soldier can read. | 229 |
| 3 | **Shai** | They have men waiting close in with charges of their own, fast enough to reach your line before you have finished forming it. Put something else in front to meet them, not the engineers. | 186 |
| 4 | **Idit** | The other three were finished years ago and left no dirt at all; only the drone or the engineers themselves can tell you where they run, and only while somebody is looking. | 172 |
| 5 | **Shai** | Yahalom must stand still in the open beside a route to set the charge, so whether they live is a decision you make with everything else you have. Bring all four down. | 166 |

Shai / Idit / Shai / Idit / Shai. Shai opens because the opening fact — the
town is held and the fighting continues — is his; her picture is the four
routes and what seeing them costs, which is beat 2 and beat 4.

**What changed and why.** §3.1 marks this **re-brief y**, so this is the one
Act I briefing where a change was expected. Two:

1. *"Ashwar mined this district long before we reached it"* → *"**Nadir Sahim**
   mined this district years before we reached it"*. Act I's last mission is
   his end; the network the player is about to destroy is the thing that made
   him, and the briefing now says whose it is.
2. Beat order. The shipped string ran picture, picture, picture, threat, order,
   and the threat sentence — the charge squads that will reach the line first —
   arrived after two long paragraphs about geology. It now alternates, and the
   mission ends on the sentence that was already its best: *"whether they live
   is a decision you make with everything else you have."* **"Bring all four
   down"** moved to the end, where it is the last thing the player reads before
   deploying.

**What is NOT in this briefing, and must not be until the placement lands.**
§3.1 says IV *"Must gain SPADE's capture as a primary and say so"*, at the cost
of **+1 placement and +1 objective** — `mission-author` and `level-scripter`
work, not text work. Until then the briefing says the network is his and stops
there. Writing *"take Sahim alive"* into an orders voice with no `capture`
objective behind it would be the one failure mode this sheet exists to prevent.
See §11 G-A.

### 6.3 Objectives

| id | as an order | as a toast |
|---|---|---|
| `bring_it_down` | Collapse every route under the district | `OBJECTIVE COMPLETE — Collapse every route under the district` |
| `read_the_ground` | **Find the crew reopening Sahim's western route** | `OBJECTIVE COMPLETE — Find the crew reopening Sahim's western route` |

`read_the_ground` **changed** from *"Find the crew reopening the western
route"*. One possessive: it is the `locate` that puts the player's eyes on his
work, and `storyline.md` §2.3 names it as how you find him. `bring_it_down`
unchanged.

`bring_it_down` is `collapse` with `seconds: 300` and `primary: true`, so it
**can fail** (`mission.ts:1433`) — the only failable primary in Act I besides
First Light's evacuation. Act I can be lost on a clock, twice, at both ends.

### 6.4 `aftermath` — Act I closes

Two versions, because one of them depends on content that does not exist.

**A — once the +1 capture placement lands (§11 G-A). Preferred.**

> *Four routes under Beit Sahwan, and the man who dug them came up out of the
> last one with his hands empty. Brigade put a third star on the slip and said
> nothing else about it. The Marj is quiet. Sur is not.*

205 chars. Three stars is Major (`storyline.md` §2.1, §0.2 O6). "Came up out of
the last one with his hands empty" is a capture and says so without a verb the
player did not perform. The last two sentences hand the campaign to Act II.

**B — honest against the mission as it ships today.**

> *Four routes under Beit Sahwan, and by morning none of them went anywhere.
> Brigade put a third star on the slip and said nothing else about it. Sahim is
> not in the district any more, and neither is his ground.*

208 chars. No capture is claimed. Ships the moment the `aftermath` field exists,
with no mission change at all.

Status **`schema`** for both — the field does not exist (`storyline.md` §7 G3).

### 6.5 Trigger table

`beit_sahwan_4_subterranean` declares **no triggers**. Every row below is an
objective, a wave, a `SimEvent` or the mission end.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan IV — Subterranean` · *1 primary objective* | applied | live |
| mission start | `brief` | Shai / Idit | beats 1–5 above | applied | live |
| `SimEvent tunnelContact` (side 0, any route) | `radio` | Idit | "Route identified. Hold the eye on it — the moment nobody is looking it goes back to a rumour." | **the shipped mechanic exactly**: identification is live only while a `mark_tunnel` carrier holds line of sight | engine |
| `SimEvent ventOpened` | `eva` | brigade net | "Vent opened." | shared set, §8 | engine |
| `SimEvent surfaced` | `radio` | Idit | "Up behind you, out of ground you cleared an hour ago." | | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_west`) | `radio` | Shai | "West route down." | needs a per-route `say`; `level-scripter` | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_north`) | `radio` | Shai | "North route down." | | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_souk`) | `radio` | Idit | "The souk route is down. That one was older than the war." | ambient, §9 | engine |
| `SimEvent tunnelCollapsed` (`bs_tn_clinic`) | `radio` | Idit | "Clinic route down. He put it there on purpose and we took it without touching the block." | **the act's ROE thesis in one line** | engine |
| wave t=150 s (2, from `mortar_line`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=240 s (2, from `mortar_line`) | `radio` | Idit | "Last of what the mortar line can send. After this he is spending the ones underground." | | engine |
| `objective(read_the_ground, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the crew reopening Sahim's western route` | applied | live |
| `objective(read_the_ground, complete)` | `radio` | Idit | "That is the crew on the west route. He keeps his diggers close to the work, which is how we will get him." | sets up the capture the mission cannot yet stage (§11 G-A) | engine |
| `objective(bring_it_down, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse every route under the district` | applied | live |
| `objective(bring_it_down, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Collapse every route under the district` | applied | live |
| `objective(bring_it_down, failed)` @300 s | `radio` | Idit | "Clock is out and there is still ground under this town that is not ours." | | engine |
| `capture(shaft_head)` — **does not exist yet** | `toast` | system | `OBJECTIVE COMPLETE — Hold the shaft head until Sahim is out of it` | proposed objective text for §11 G-A; do not author until the placement exists | engine |
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
| the compound gates | `marj_perimeter` `compound` | `radio` | Idit | "Two gates, both on the road. They have never once used them." | engine |
| `civ_refuge` | both maps | `toast` | system | `one family through the wire` | engine |
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
| **T1** | `_breach` | *The families that did not get in.* At `timer_s(270)` the civilians still outside are killed rather than merely left | `radio` | Idit | "The ring is closed on the western villages. There is nothing out there left for us to reach." | **engine** — needs a `do.kind` that kills a named civilian group (`execute`, §7 G7) | engine |
| **T2** | `_1_recon` | *The picture is old.* One `locate` target was abandoned days ago; the real cell is four tiles off | `radio` | Idit | "That position is cold. No fire, and the tracks leaving it are days old — the cell is off it and close." | expressible today: two tagged placements plus a `spawn` | engine |
| **T3** | `_2_foothold` | *The spoil was a decoy.* The western shaft is real and empty; the route under the line is a second one | `radio` | Idit | "The western shaft is real and it is empty. The route under your line is a different one and it was finished before we came." | expressible today: two routes, one `collapse` target | engine |
| **T4** | `_3_clearance` | *He is in the block.* Sahim is identified inside the flagged block and leaves during the fight | `radio` | Idit | "Sahim is inside the clinic block. That is a confirmed identification and a protected structure, and it is the same building." | expressible today: tagged placement + `withdraw_to` | engine |
| **T4b** | `_3_clearance` | …and he leaves | `radio` | Idit | "He is out of the block and moving north on foot." | same trigger's `withdraw_to` | engine |
| **T5** | `_4_subterranean` | *A soldier under the road.* A `yahalom_squad` is taken when a route is identified, held as an HVT to reach before the last collapse | `radio` | Idit | "We have lost a Yahalom team off the net at the west shaft. They did not die. They went down." | **engine** — needs player-side removal (`remove`, the mirror of `reinforce`, §7 G7) | engine |

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
| `_breach` | `villages_rise` | `the_north_corners_commit` | **The one that matters.** "Villages rise" reads as the villagers rising, on a map carrying eleven civilians the player is scored on protecting. GDD §2 forbids attaching combat to a population; the trigger actually commits a garrison group of `militia_cell`s staged in the map's four corners, so the accurate name is also the safe one |
| `_breach` | `south_rises` | `the_south_corners_commit` | same, and it pairs |
| `_2_foothold` | `flank_delivery_rolls` | `a_technical_runs_the_north_lane` | "Flank delivery" is authoring jargon in the player's face |
| `_2_foothold` | `flank_delivery_drops` | `it_puts_an_rpg_team_down` | reads as the second half of a sentence, which is what it is |
| `_3_clearance` | `reserve_counterattack` | `the_southern_cell_commits` | accurate and less like a wargame manual |
| `_1_recon` | `hunt_the_scouts` | **keep** | already reads as prose: `enemy reacts (hunt_the_scouts)` |
| `_0_tutorial` | all six `deliver_*` | **keep the ids; fix the prefix** | renaming cannot help — the prefix is hard-coded `enemy reacts` and these are friendly deliveries. §11 G-C |

---

## 11. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | **Act I has no ending.** `storyline.md` §2.3 makes IV Sahim's end and §3.1 says the briefing "must gain SPADE's capture as a primary and say so". IV declares `collapse` + `locate` and no person. `capture` is live (10 s uninterrupted zone hold), so this needs **+1 tagged placement at the shaft head and +1 `capture` objective** — no engine work at all. The `aftermath` A variant (§6.4) and the proposed objective text in §6.5 are written against it and are not to be authored before it | 1 placement, 1 objective, 1 zone | `mission-author` + `level-scripter` |
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
counted by script rather than by eye. **140 rows.**

| status | rows | what they are |
|---|---|---|
| `live` | **53** | `title` 6 · `brief` 6 · `toast` 39 · `tutorial` 2. Shipped surfaces only: title cards, deploy-screen briefings, objective / trigger / wave / mission-end / ROE toasts, and the tutorial step machine. **The 4 briefings and 2 objective labels this sheet changed are inside this count, applied and validated.** Eight of the 39 toasts are `live` and *wrong* — the six `enemy reacts (deliver_*)` deliveries and the two raw-id `built` lines (G-C, G-D) |
| `schema` | **2** | `dispatch` on First Light, `aftermath` on IV. Two optional strings away from shipping; the second has two written variants (§6.4) and only one of them can be authored before G-A |
| `engine` | **85** | `radio` 53 · `eva` 18 · `debrief` 10 · `toast` 4 (the replacements the hard-coded strings block) |

**85 `engine` rows.** That is the number to quote: **61% of the writing in this
act reaches nobody today**, and all of it sits behind four pieces of work —
`say` on triggers and objectives, a radio overlay, the three story fields, and a
debrief screen. One `radio` line in the whole act has a live carrier, and only
because the tutorial's step machine exists (§1.4).

**Nothing in this sheet blocks Act II.** The four applied briefings, the two
applied objective labels and the six unchanged mission names are the whole of
what Act I can say to a player right now, and they say it in one voice with
Idit named in the third person, exactly as the deploy screen requires.
