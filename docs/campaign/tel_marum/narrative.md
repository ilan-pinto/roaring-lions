# Tel Marum and Umm Zeitoun — Narrative Trigger Sheet

**Act II · Sur · Sarim Brigades · Shai Hammai is a Major throughout.**

**Date:** 2026-09-03 · **Status:** the three shipped Tel Marum missions were
read, beat-checked and left **unchanged** — the design asks for no re-brief and
none was needed. Everything written for the four Umm Zeitoun missions is
authored text waiting on `mission-author`, who owns the mission files, the
`say`/`dispatch`/`aftermath`/`debrief` fields, and the map.
**Written against** `feat/story-act-1` in this worktree: `data/missions/tel_marum_*.json`
read as they stand, the schema read for the shapes rather than remembered, and
`commanderForMission` driven for real (§12 G-A). Contract:
`docs/campaign/README.md`. Canon: `docs/campaign/storyline.md` §0.2, §2.1–§2.3,
§3.2, §4.1. Upstream: `docs/campaign/tel_marum/design.md` §2, §3, §5. The voice
and the table shape are Act I's — `docs/campaign/beit_sahwan/narrative.md`.

**What this pass changed in the JSON: nothing.** §3.2 of the design marks
Tel Marum II and III **re-brief n** and Tel Marum I **re-brief y, new fields
only**, and the new field is `dispatch`, which is `mission-author`'s. All three
briefings were run through a port of `briefingBeats` and all three pass on every
beat; every objective label is in the tree's own house style (§1.4, §2.4, §3.4).
An edit here would have been a change for its own sake to measured content.

Downstream: `mission-author` (four mission files, the `say` lines, `dispatch`,
`aftermath`, `debrief`, `commander.json`'s one line, `world.json`),
`level-scripter` (trigger ids and bindings, §11), `render-vfx` (radio overlay,
portraits, the `debrief` split), `sim-guard` (§12), `content-validator`.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code and the text can reach a player today |
| `schema` | the field is specced and does not exist |
| `engine` | the surface is an approved target with no implementation (`radio` overlay art, `eva`, `bark`, a `debrief` that can tell a win from a loss, any hard-coded toast string) |

Every row's rightmost cell is one of those three words. The count is §14.

**`schema` is empty in this act, and that is new.** The engine slice of
2026-09-03 (`docs/superpowers/specs/2026-09-03-narrative-layer-engine-design.md`)
landed `say: {speaker, text}` on `triggers[]` and on `objectives[]`,
`say_on_fail` on objectives, the `dispatch` / `aftermath` / `debrief` strings,
the `remove` verb and `group` on `starting_force`. Verified in this worktree, not
recalled: `mission.schema.json` `$defs.say` takes `speaker ∈ {shai, idit, net,
enemy}` and `text` ≤ 240; `mission.ts:1365/1559/1564` emit it; `main.ts:274`
routes it to `sayNotice` and `main.ts:1731` to `hud.say`. So a mid-mission line
lands in the notice feed **and** on the commander bar today, with no overlay and
no voice. What is still `engine` is what it *looks* like, not whether it arrives.

### 0.2 The two voices, and why the JSON reads as one

The deploy screen and the commander bar carry one speaker at a time and the
briefing is one string, so the `briefing` field is Shai's orders voice end to
end, with **Idit named in the third person** wherever the picture is hers. The
`say` lines are the other half: they carry a real `speaker` field, so from
2026-09-03 Idit speaks in her own name inside a mission even though she still
cannot inside a briefing.

- **In this sheet** each briefing is a two-hander, one speaker per beat.
- **In the JSON** it is one string. The four Umm Zeitoun briefings are printed
  whole in §4.2, §5.2, §6.2 and §7.2 exactly as they should be pasted.

Beat boundaries below are **not editorial**: they are what `briefingBeats`
(`packages/app/src/ui/loading.ts`, at most two sentences and 240 characters,
whichever comes first) produces from the string, checked with a port of that
function rather than by eye (§14).

### 0.3 The villain

**Karim Adhal**, KDF file name **LANTERN** — *the observer*
(`storyline.md` §2.3). His doctrine is the whole act: `rocket_battery` is range
20 and sight 6, so the battery fires on what somebody else sees, and Adhal is
the somebody. He is characterised by placements — four posts on four hills, two
missile teams that price a look, a tube that displaces when pressed — and the
player meets him in three stages, in this order and no other:

1. **What he did** — the `dispatch` on Tel Marum I. No name, because nobody
   could say from where.
2. **His file name** — Idit, on the Grad dying in Tel Marum III. *The gun is
   down and the man who aimed it is not.*
3. **His own name** — Idit, on `locate(uz_hvt_lantern)` in Umm Zeitoun III,
   thirty-four tiles away and unreachable. He is killed in Umm Zeitoun IV.

**He speaks once in the whole act**, on the battery's withdrawal trigger in
Umm Zeitoun IV, and the line is about looking. He never addresses the player.

### 0.4 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality,
accent, idiom or insignia, on either side. The Sarim Brigades are defined by
**standoff — rockets, ATGMs, the best-trained infantry on the board — and by
nothing else**. No line in this sheet gives a population to a faction: the
families at the wells, the hamlet and the porters are people who live on ground
two armies are fighting over, and the text says only that.

This binds hardest on the `eva` and `bark` rows, which are the ones that would
be recorded — retrofitting the rule means throwing audio away (GH-110).

### 0.5 What Act II can say that Act I could not, and what it still cannot

| | |
|---|---|
| **new since Act I** | a line can fire on an objective completing, an objective **failing**, or a trigger firing, in any of four voices, and it reaches the player |
| **still impossible** | **a wave cannot speak.** The wave item is `{at_seconds, trigger, to, units}` — `say` was added to triggers and objectives and not to waves. The `timer_s` workaround costs a real order, because `do` is required (§12 G-D) |
| **still impossible** | a trigger cannot fire **on an objective** or on a `SimEvent`, so every line bound to "he was identified" or "that route opened" is on a clock or on `casualties_pct` instead (§12 G-E) |
| **still half-built** | `debrief` is one string shown on **every** mission end, so it cannot say different things for a win and a loss. Every paired Shai/Idit end line below is `engine` for that reason alone (§12 G-C) |

---

## 1. `tel_marum_1_recon` — Tel Marum I — The Gateway

`recon` · **Major** · `tel_marum` · requires **R** · produces **R M C I** ·
`target_minutes` 7. **The act opens here, and so does Adhal.**

### 1.1 `name`

`Tel Marum I — The Gateway` — **unchanged.**

### 1.2 `dispatch` — the act's opening — 235 chars

> *For a week the north woke to rockets and nobody could say from where. On the
> eighth morning one settlement took nine before the sirens stopped. No
> launch was ever seen, no line ever plotted. Somebody had been looking at it a
> long time.*

Narrator, story voice, off-map. The settlement is **not named** — `storyline.md`
§2.4(1) forbids coining a toponym without a `world.json` entry, and the design's
"no name" is that rule. Neither is Adhal: the atrocity's whole character is that
there was nobody to name, and the last sentence introduces him as a *practice*
rather than a person. The nine is deliberately not First Light's eleven.

`dispatch` is live (`main.ts:1260`, `hud.announce(name, "N primary
objective(s)", mission.dispatch)`); the title card holds 900 ms and dismisses on
any input (`ui/motion.ts:49`), so a longer hold for a mission that carries one is
`render-vfx` work and is the only thing between this line and a reader. Status
**`live`**; owner `mission-author`.

### 1.3 `briefing` — 465 chars, 3 beats — **unchanged**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Sur begins at the pass, and the pass is watched. Rockets have been falling on the north for a week and nobody can say from where, so tonight you find out. | 154 |
| 2 | **Shai** | Push the drone up the valley and build the picture — two ATGM pockets on the wall, a Grad section behind it, and whoever is feeding them targets. | 145 |
| 3 | **Shai** | Keep the metal in the hollow: the valley floor south of it is out of the battery's reach, and everything north of it is not. Bring back the picture, not casualties. | 164 |

Idit / Shai / Shai — the picture, the plan, the cost, which is the shape every
Act I briefing closes on.

**One seam, recorded and not cut.** Beat 1's last clause, *"so tonight you find
out,"* is an order inside Idit's beat. Splitting it would take two sentences and
the design says **new fields only** — the briefing already carries the atrocity
and the orders voice must not gain narration. It stays.

### 1.4 Objectives — all **unchanged**

| id | as an order | as a toast |
|---|---|---|
| `find_pocket_east` | Identify the eastern ATGM pocket | `OBJECTIVE COMPLETE — Identify the eastern ATGM pocket` |
| `find_pocket_west` | Identify the western ATGM pocket | `OBJECTIVE COMPLETE — Identify the western ATGM pocket` |
| `find_spotter` | Identify whoever is spotting for the battery | `OBJECTIVE COMPLETE — Identify whoever is spotting for the battery` |
| `find_battery` | Find the Grad section behind the wall | `OBJECTIVE COMPLETE — Find the Grad section behind the wall` |
| `screen_out` | Stay in the field for four minutes | `OBJECTIVE COMPLETE — Stay in the field for four minutes` |

`find_spotter`'s label is the best objective text in the act and the reason the
act works: it asks for a **person**, not a position, in a game where everything
else on the list is a weapon. Nothing here needs touching.

### 1.5 `debrief` — 121 chars

> *Whatever the drone brought back is what the brigade plans on. Whatever it did
> not is a hill somebody is still sitting on.*

One line, honest on a win and on a loss, which is what `debrief` requires today
(§12 G-C). Status **`live`**; owner `mission-author`.

### 1.6 Trigger table

The mission ships `"triggers": []`. Every row below is an objective, a wave, or
the mission end, except **T6**, which is the town's first trigger and is
`mission-author`'s to author.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Tel Marum I — The Gateway` · *4 primary objectives* | `hud.announce`; shipped | live |
| mission start | `dispatch` | narrator | §1.2 above | wants a longer title-card hold; `render-vfx` | live |
| mission start | `brief` | Idit / Shai | beats 1–3 above | one speaker on screen today; shipped | live |
| `objective(find_pocket_east, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the eastern ATGM pocket` | shipped | live |
| `objective(find_pocket_west, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the western ATGM pocket` | shipped | live |
| **the two pockets get no `say`, deliberately** | — | — | a weapon being found is a toast; a *man* being found is a line. Four `say`s in a recon is chatter | authorial | live |
| `objective(find_spotter, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify whoever is spotting for the battery` | shipped | live |
| `objective(find_spotter, complete)` | `radio` | **Idit** | "That one is not a picket. He is lying still on the west lip with the whole valley in front of him, and everything that has fallen on the north fell because a man was doing that." | `objectives[].say`; **the line that turns a contact into a person** | live |
| `objective(find_battery, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the Grad section behind the wall` | shipped | live |
| `objective(find_battery, complete)` | `radio` | **Idit** | "The tube is behind the wall, thirty-eight tiles from your start line. Sight six — it has never once seen the thing it was firing at." | `objectives[].say`; the act's thesis, said once | live |
| `objective(screen_out, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for four minutes` | shipped | live |
| `screen_out` failing | — | — | **cannot happen.** `survive_until` is not one of the three types `checkEnd` can fail, so `say_on_fail` here would never fire and must not be authored | — | live |
| wave t=150 s (1 `sarim_rifles` from `town_edge` → `hollow`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded string | live |
| wave t=150 s | `radio` | Idit | "Something came down off the wall and it is walking to the hollow. They know where you would have parked." | **a wave cannot carry a `say`** (§12 G-D) | engine |
| wave t=260 s (2 `sarim_rifles` → `start_line`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=380 s (1 `recoilless_team` → `start_line`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| **T6** `zone_entered(valley_floor)` → `something_moves_behind_the_hollow` | `toast` | system | `enemy reacts (something_moves_behind_the_hollow)` | id renamed for prose (§11); trigger not yet authored | live |
| **T6** same trigger | `radio` | **Idit** | "Something moved on the floor behind you. That ground was never yours; you were only the first thing to stand on it." | `triggers[].say`; the spawn is `sarim_west [8,4]`-safe only if it stays clear of the drone route (§3.5 of the design) | live |
| `SimEvent contact` on `tm_manpad` | `radio` | Idit | "Missile team on the shoulder. Nothing of ours flies over that line twice." | needs a trigger that can watch the sim (§12 G-E) | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(any)` | `debrief` | narrator | §1.5 above | end screen, above the rating | live |
| `missionEnd(victory)` | `debrief` | Shai | "Four positions and a tube. That is more of Sur than anybody has had since the shelling started." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "We came back with part of it. The part we did not get is the part that has been killing people." | needs the win/lose split | engine |

---

## 2. `tel_marum_2_foothold` — Tel Marum II — The Start Line

`foothold` · **Major** · `tel_marum` · requires **R I** · produces **R M C** ·
`target_minutes` 6. **The mission that teaches the rule the act is made of.**

### 2.1 `name`

`Tel Marum II — The Start Line` — **unchanged.**

### 2.2 `briefing` — 482 chars, 3 beats — **unchanged**

Design §3.2: *re-brief* **n**. *"The shipped briefing carries the act's whole
thesis already… Keep verbatim."* It does, and it is kept.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The picture says the Grad cannot see past the wall — it doesn't have to. It fires wherever the Sarim line can see, and the best eyes on that ground belong to the man in the west pocket. | 185 |
| 2 | **Shai** | Take the approach and hold it for four minutes while the engineers mark the start line behind you. Kill him and the shelling slackens — he is not the only pair of eyes on that ground, so do not expect it to stop. | 212 |
| 3 | **Shai** | Not every tile of the approach is watched: pick your ground before you are made to. | 83 |

Idit / Shai / Shai. Beat 1 opens *"The picture says"* — it is hers by
construction, and this is the one shipped Act II briefing that needs no
attribution work at all.

### 2.3 `dispatch`

**None, and there must not be one.** The act's dispatch is Tel Marum I's. A
second one in the next mission turns an opening into narration.

### 2.4 Objectives — both **unchanged**

| id | as an order | as a toast |
|---|---|---|
| `hold_approach` | Hold the approach for four minutes | `OBJECTIVE COMPLETE — Hold the approach for four minutes` |
| `kill_spotter` | Kill the observer in the west pocket — the shelling will ease, not stop | `OBJECTIVE COMPLETE — Kill the observer in the west pocket — the shelling will ease, not stop` |

`kill_spotter`'s label is the only objective in the tree that tells the player
its own reward is partial, and the toast is where it lands: the completion
notice and the next incoming round arrive together. That is **T7 delivered by a
live surface with no engine work**, and it has been shipped since before this
sheet existed.

### 2.5 `debrief` — 89 chars

> *The shelling was never weather. It is a man on a hill, and there is more than
> one of him.*

Honest on a win and on a loss. Status **`live`**.

### 2.6 Trigger table

`"triggers": []`. Nothing new is needed — this mission's twist is text.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Tel Marum II — The Start Line` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–3 above | shipped | live |
| `objective(kill_spotter, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the observer in the west pocket — the shelling will ease, not stop` | shipped | live |
| `objective(kill_spotter, complete)` | `radio` | **Shai** | "Eyes off that lip. Count the next thirty seconds — anything that still lands is being called by somebody else." | `objectives[].say`; **T7, and the cheapest real twist in the act** | live |
| `objective(hold_approach, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the approach for four minutes` | shipped | live |
| `objective(hold_approach, complete)` | `radio` | **net** | "Approach held. Start line is marked and the engineers are off the ground." | `objectives[].say`; the brigade net, flat, no name | live |
| wave t=120 s (1 `sarim_rifles` → `saddle_wide`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=210 s (1 `recoilless_team` → `saddle_wide`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=210 s | `radio` | Idit | "Recoilless coming down to the wide saddle. He is not reinforcing the pocket — he is pricing the road behind you." | a wave cannot speak (§12 G-D) | engine |
| `SimEvent fire` from `tm_hvt_battery` onto the approach | `eva` | brigade net | "Incoming. Indirect." | shared set, §9 | engine |
| `missionEnd(any)` | `debrief` | narrator | §2.5 above | | live |
| `missionEnd(victory)` | `debrief` | Idit | "One eye off that ground and the rounds kept coming. That is the front, not a bad night." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Shai | "We did not hold the ground the engineers were marking. There is no start line, so there is no pass." | needs the win/lose split | engine |

---

## 3. `tel_marum_3_clearance` — Tel Marum III — The Pass

`clearance` · **Major** · `tel_marum` · requires **R** (should be **R I**, §12 G-B)
· produces **R M C** · `target_minutes` 7. **Adhal's bait, and his gun's end.**

### 3.1 `name`

`Tel Marum III — The Pass` — **unchanged.**

### 3.2 `briefing` — 752 chars, 4 beats — **unchanged**

Design §3.2 under Option C: *re-brief* **n** — *"the two-routes briefing is
measured and correct (pinned in `tools/src/tel_marum_doctrine.test.ts`)… Do not
paraphrase either."* The **ten tiles** in beat 2 is the number that test proves;
CLAUDE.md records the earlier "nine" as wrong and this text as already corrected.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Two ways through the wall and neither is free. The wide saddle lies under both Kornet pockets and will cost you vehicles. | 121 |
| 2 | **Idit** | The narrow one is ten tiles longer and no missile reaches it — the Grad's rockets do, at seventeen, but the only Sarim eyes over that corridor sit at its northern mouth and see no further, so most of its length goes unwatched. | 226 |
| 3 | **Shai** | What you cannot do is send everything that way: the corridor is choked with fallen rock, passable on foot and to nothing on wheels or tracks. Armour goes through the pass or it does not go. | 189 |
| 4 | **Shai** | Mind the town block behind the pass: it stands two tiles from the battery you are ordered to destroy, which is the one place heavy ordnance is guaranteed to land. Take the pass, and put the battery out of the war. | 213 |

Idit / Idit / Shai / Shai — two beats of measured picture, two of decision and
cost. The seam falls exactly where the mission's own argument turns.

**Beat 4 is the counter-battery bait and it is restraint written as arithmetic.**
`flagged_zones: ["town_block"]`, `fail_below: 45`, and `tm_hvt_battery` parked
two tiles from the block. The text never says shelling the block is wrong; it
says it *is guaranteed to land there*. Change nothing.

### 3.3 `aftermath`

**None.** Under Option C the act does not end here — the batteries do not stop
until Umm Zeitoun IV, and the promotion is the act boundary after it. A victory
banner that closed Sur at the pass would make the four missions that follow read
as an epilogue. (Under Option A this section carries the act's `aftermath`
instead and Umm Zeitoun's §7.6 is void.)

### 3.4 Objectives — both **unchanged**

| id | as an order | as a toast |
|---|---|---|
| `take_pass` | Take the pass and hold it for 20 seconds | `OBJECTIVE COMPLETE — Take the pass and hold it for 20 seconds` |
| `kill_battery` | Destroy the Grad section | `OBJECTIVE COMPLETE — Destroy the Grad section` |

`20` as a numeral was checked against the tree rather than assumed: three shipped
`capture` labels spell seconds as digits (`beit_sahwan_3_clearance`,
`tel_marum_3_clearance`, `wadi_halam_4_village`) and every minutes figure is
spelled out. Changing one of the three would break the house style, not fix it.

### 3.5 `debrief` — 75 chars

> *The gun was the cheap half of him. The eyes are what this front is made of.*

Honest either way, and it is the sentence that carries the player into Umm
Zeitoun. Status **`live`**.

### 3.6 Trigger table

`"triggers": []`. T-C1 and T-C2 are `level-scripter`'s proposals and both would
be this town's first triggers; their lines are written and their risk to the
shipped plan is recorded in the design's §3.5, not here.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Tel Marum III — The Pass` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–4 above | shipped | live |
| `objective(take_pass, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the pass and hold it for 20 seconds` | shipped | live |
| `objective(take_pass, complete)` | `radio` | **net** | "Pass is held. Nothing on wheels goes north of the wall by any other road." | `objectives[].say`; states the boulder corridor's consequence without repeating the briefing | live |
| `objective(kill_battery, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Destroy the Grad section` | shipped | live |
| `objective(kill_battery, complete)` | `radio` | **Idit** | "The tube is down and the north can sleep tonight. Whoever was telling it where to fire has not been on this ground once — the file calls him LANTERN." | `objectives[].say`; **the act's hinge — the file name arrives here and nowhere earlier** | live |
| first `roe` deduction inside `town_block` | `toast` | system | hard-coded `roeNotice` copy | strings are not authorable; this is the deduction beat 4 priced | live |
| first `roe` deduction inside `town_block` | `radio` | Shai | "That is the block, not the battery. He parked it there so that the round which kills it is the round that bills you." | needs a trigger that can watch the sim (§12 G-E) | engine |
| wave t=150 s (1 `sarim_rifles` from `sarim_west` → `saddle_narrow`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=240 s (1 `recoilless_team` → `pass`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| **T-C1** `casualties_pct(40)` → `the_tube_backs_into_the_town` | `toast` | system | `enemy reacts (the_tube_backs_into_the_town)` | id proposed for prose (§11); `withdraw_to town_edge` | live |
| **T-C1** same trigger | `radio` | **Idit** | "The tube is backing into the town block. He is not hiding it from you — he is putting it where your heavy ordnance is the thing that finds it." | `triggers[].say`; **risks walking `kill_battery` out of the shipped plan's reach — `playtest` must re-run** | live |
| **T-C2** `zone_entered(narrow_corridor)` → `the_corridor_was_watched_after_all` | `toast` | system | `enemy reacts (the_corridor_was_watched_after_all)` | needs a new zone on the map (design §3.3); **the map is another agent's file this session** | live |
| **T-C2** same trigger | `radio` | **Idit** | "Rifles in the corridor. Somebody was watching the one route the rock was supposed to keep quiet." | `triggers[].say` | live |
| `missionEnd(any)` | `debrief` | narrator | §3.5 above | | live |
| `missionEnd(victory)` | `debrief` | Shai | "The pass is a road now. The block behind it is still standing, which is the only part of this I will be asked about." | needs the win/lose split | engine |
| `missionEnd(defeat)` via `fail_below: 45` | `debrief` | Idit | "The rating went under forty-five with the tube still firing. He parked it there for that and it worked." | needs the win/lose split | engine |

---

## 4. `umm_zeitoun_1_recon` — Cold Ground

`recon` · **Major** · `umm_zeitoun` (**the map landed in this worktree this
session and is another agent's file — read, never edited here**) · requires **R** · produces **R M C I E** · `target_minutes` 6.
**The first mission of the war in which what Idit is looking for is a pair of
eyes rather than a weapon — and the first she cannot afford all of.**

Every mechanical figure below is the design's (§4.4, §4.5, §5.1), measured
through the real `Sim` and `FlowField` there. Nothing in this section re-derives
one and nothing invents one.

### 4.1 `name`

`Umm Zeitoun I — Cold Ground`

The title-card convention is the town, a numeral, then the name — `Tel Marum I —
The Gateway`, `Beit Sahwan IV — Subterranean`. *Cold Ground* is what the recon
finds: four posts that have been sitting there since before the brigade knew the
basin existed.

### 4.2 `briefing` — 801 chars, 5 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Umm Zeitoun is a basin: no wall across it, no gate to force, crossable anywhere on its width. Idit counts four hills over the floor and each one sees a different piece of it. | 174 |
| 2 | **Shai** | Identify all four posts before the brigade puts anything on this ground. Push the drone up the middle and take the cheap looks first. | 133 |
| 3 | **Idit** | Two missile teams cover the northern half, air only, out to thirteen tiles. The crest cannot be identified from outside that envelope, so the drone buys you the near hills for nothing and that one for its life. | 210 |
| 4 | **Shai** | Three families are at the wells on the west flank, nine tiles from the wadi on foot. You have four minutes before somebody else moves them. | 139 |
| 5 | **Shai** | The jeep is the only thing you have that can screen the drone and the only thing that can carry a family off that flank. It will not do both. | 141 |

Idit / Shai / Idit / Shai / Shai. Beat 1 is the map's whole character in one
sentence and it is the sentence that separates this town from Tel Marum: *a pass
is forced, a basin is crossed.* Beat 3 is the MANPAD envelope stated as a price
rather than a threat. Beat 5 is the cost, and it is a real one — the
`jeep_shoded` is the only carrier on the roster that reaches `uz_wells`.

**The JSON string, to be pasted whole:**

> Umm Zeitoun is a basin: no wall across it, no gate to force, crossable anywhere on its width. Idit counts four hills over the floor and each one sees a different piece of it. Identify all four posts before the brigade puts anything on this ground. Push the drone up the middle and take the cheap looks first. Two missile teams cover the northern half, air only, out to thirteen tiles. The crest cannot be identified from outside that envelope, so the drone buys you the near hills for nothing and that one for its life. Three families are at the wells on the west flank, nine tiles from the wadi on foot. You have four minutes before somebody else moves them. The jeep is the only thing you have that can screen the drone and the only thing that can carry a family off that flank. It will not do both.

### 4.3 `dispatch`

**None.** Act II's dispatch is Tel Marum I's and there is exactly one per front.

### 4.4 Objectives

Objective **ids are proposals** — `mission-author` and `level-scripter` own them.
The `text` is this sheet's, and every label names the **ground**, not the man on
it, because the toast is read at the moment the position falls.

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `find_the_crest` | `locate` · `uz_eye_crest` · primary | Identify the post on the northern crest | `OBJECTIVE COMPLETE — Identify the post on the northern crest` |
| `find_the_west_horn` | `locate` · `uz_eye_west` · primary | Identify the post on the western horn | `OBJECTIVE COMPLETE — Identify the post on the western horn` |
| `find_the_east_horn` | `locate` · `uz_eye_east` · primary | Identify the post on the eastern horn | `OBJECTIVE COMPLETE — Identify the post on the eastern horn` |
| `find_the_stone_knoll` | `locate` · `uz_eye_knoll` · primary | Identify the post above the stone knoll | `OBJECTIVE COMPLETE — Identify the post above the stone knoll` |
| `get_the_wells_clear` | `evacuate_before` · `refuge_wadi` ×2 @240 s · **primary** | Get two families from the wells into the wadi inside four minutes | `OBJECTIVE COMPLETE — Get two families from the wells into the wadi inside four minutes` |
| `find_the_missile_team` | `locate` · `uz_manpad_basin` · secondary | Identify the missile team covering the basin | `OBJECTIVE COMPLETE — Identify the missile team covering the basin` |
| `screen_out` | `survive_until` 240 s · secondary | Stay in the field for four minutes | `OBJECTIVE COMPLETE — Stay in the field for four minutes` |

`screen_out` reuses `tel_marum_1_recon`'s id and its exact label: same type, same
240 s, same job. Two recons in one act should read as the same order.

**`get_the_wells_clear` is the only objective on this map that can fail**, and
that is the mission (design §5.1). Its failure text therefore has to be the best
line in the mission and is in §4.6.

### 4.5 `debrief` — 98 chars

> *Four hills, and a drone that can only pay for some of them. That is the whole
> of Sur in one night.*

Honest on a win and on a loss. Status **`live`**.

### 4.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Umm Zeitoun I — Cold Ground` · *5 primary objectives* | | live |
| mission start | `brief` | Idit / Shai | beats 1–5 above | | live |
| `objective(find_the_crest, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post on the northern crest` | | live |
| `objective(find_the_crest, complete)` | `radio` | **Idit** | "That is the crest post, and I have him for as long as something is looking at him. Nothing of ours can hold that from outside thirteen tiles." | `objectives[].say`; states the decay rule (**T-U2**) at the one moment the player feels it | live |
| `objective(find_the_west_horn, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post on the western horn` | | live |
| `objective(find_the_west_horn, complete)` | `radio` | **Idit** | "West horn is a post, not a picket. He is lying on the shoulder with the whole western floor under him." | `objectives[].say` | live |
| `objective(find_the_east_horn, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post on the eastern horn` | | live |
| `objective(find_the_east_horn, complete)` | `radio` | **Idit** | "East horn the same, across the basin. Between the two of them there is no line across this floor that nobody sees." | `objectives[].say` | live |
| `objective(find_the_stone_knoll, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post above the stone knoll` | | live |
| `objective(find_the_stone_knoll, complete)` | `radio` | **Idit** | "The near one is in the shed on the stone knoll, four tiles from the wadi road. That is the eye that matters to the families, not to us." | `objectives[].say`; **plants the whole of III two missions early** | live |
| `objective(find_the_missile_team, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the missile team covering the basin` | | live |
| `objective(find_the_missile_team, complete)` | `radio` | **Idit** | "Missile team on the northern shelf. Air only, thirteen tiles — the drone crosses that line once." | `objectives[].say` | live |
| `evacuated` (a civilian reaches `refuge_wadi`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no `evacuated` case | Act I's **G-B**, still open; `render-vfx` | engine |
| `objective(get_the_wells_clear, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get two families from the wells into the wadi inside four minutes` | | live |
| `objective(get_the_wells_clear, complete)` | `radio` | **Shai** | "Two families in the wadi. Leave the rest of that flank alone; nothing else out there is worth the jeep." | `objectives[].say` | live |
| `objective(get_the_wells_clear, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Get two families from the wells into the wadi inside four minutes` | a failed primary loses the mission (`checkEnd`) | live |
| `objective(get_the_wells_clear, failed)` @240 s | `radio` | **Shai** | "Four minutes. Whatever is still at the wells is not ours to move now." | `objectives[].say_on_fail`; the mirror of First Light's *"The ring is closed"*, at the other end of the war | live |
| `timer_s(242)` → `they_move_the_families_off` (`remove` group `wells_families`) | `toast` | system | `enemy reacts (they_move_the_families_off)` | id reads as prose; **keep** | live |
| same trigger | `toast` | system | `taken (1)` ×3 | `removedNotice`, side 2; one line per body, by design | live |
| same trigger | `radio` | **Idit** | "The wells are empty and nobody fought over them. They walked them north between the hills while we were looking at the hills." | `triggers[].say`; **T-U1**, and the enemy's act costs the player nothing on ROE — `stepRoe` only bills a `destroyed` whose `by` is a player unit | live |
| wave t=150 s (1 `sarim_rifles` from `sarim_west` → `uz_wells`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=150 s | `radio` | Idit | "One rifle section walking to the wells. He is not coming for you." | a wave cannot speak (§12 G-D) | engine |
| wave t=260 s (2 `sarim_rifles` from `sarim_north` → `lane_centre`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| `SimEvent destroyed` on the `recon_drone` | `radio` | Idit | "Drone is gone. Whatever it had not looked at yet, we go and look at on foot, next week, with people." | **T-U3** — the ledger said out loud; needs a sim-watching trigger (§12 G-E) | engine |
| `missionEnd(any)` | `debrief` | narrator | §4.5 above | | live |
| `missionEnd(victory)` | `debrief` | Idit | "Four posts on the board and two families in the wadi. It is the first night of this front we have finished holding more than we started with." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Shai | "We were four tiles from the wells and looking at a hill. That is the whole report." | needs the win/lose split | engine |

---

## 5. `umm_zeitoun_2_buildup` — The Long Look

`buildup` · **Major** · `umm_zeitoun` · requires **R I** · produces **R M C** ·
`target_minutes` 7 · **economy: yes.** *The war's second build-up, and the only
phase in Act II with breathing room.*

### 5.1 `name`

`Umm Zeitoun II — The Long Look`

Two readings, both meant: the observer eight tiles away who watches the brigade
build, and the four minutes the player spends standing on ground he can see.

### 5.2 `briefing` — 926 chars, 5 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Sur has more than one tube: this one is south of the basin, and from there it reaches the crest line at twelve tiles. Idit has an observer marked on the stone knoll, eight tiles off that same ground. | 199 |
| 2 | **Shai** | Hold the crest line for four minutes while the engineers work behind you. It is the highest ground on this half of the basin and the one piece of it he can both see and shell. | 175 |
| 3 | **Idit** | The camp ground in the bowl is dead to every position on this map — nothing up there can see what you are putting on it. What they can see is the line. | 151 |
| 4 | **Shai** | Supply is coming forward and the corridor behind it is open, so spend it as it arrives. Level the post above the knoll inside five minutes, with charges or with fire while the observer is still inside the shed. | 210 |
| 5 | **Shai** | Break a third of what is in front of you and the tube pulls north, out of reach of the line entirely. Everything you buy to make that happen is not standing on the crest while it happens. | 187 |

Idit / Shai / Idit / Shai / Shai. Beat 1 opens *"Sur has more than one tube"*
because the player killed one at the pass and the act must not read as a
repetition. Beat 3 is **T-U5** — the camp is unobservable and the line is not, so
the enemy knows what is being built and not where. Beat 5 is the mission's cost
and its only genuine dilemma: the logistics that ends the shelling is the
logistics that is not on the hill.

**The JSON string, to be pasted whole:**

> Sur has more than one tube: this one is south of the basin, and from there it reaches the crest line at twelve tiles. Idit has an observer marked on the stone knoll, eight tiles off that same ground. Hold the crest line for four minutes while the engineers work behind you. It is the highest ground on this half of the basin and the one piece of it he can both see and shell. The camp ground in the bowl is dead to every position on this map — nothing up there can see what you are putting on it. What they can see is the line. Supply is coming forward and the corridor behind it is open, so spend it as it arrives. Level the post above the knoll inside five minutes, with charges or with fire while the observer is still inside the shed. Break a third of what is in front of you and the tube pulls north, out of reach of the line entirely. Everything you buy to make that happen is not standing on the crest while it happens.

### 5.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `hold_the_crest_line` | `hold_for` · `crest_line` 240 s · primary | Hold the crest line for four minutes | `OBJECTIVE COMPLETE — Hold the crest line for four minutes` |
| `level_the_stone_post` | `raze` · `post_stone` @300 s · **primary** | Level the post above the stone knoll inside five minutes | `OBJECTIVE COMPLETE — Level the post above the stone knoll inside five minutes` |
| `kill_the_knoll_eye` | `eliminate_hvt` · `uz_eye_knoll` · secondary | Kill the observer in the shed on the stone knoll | `OBJECTIVE COMPLETE — Kill the observer in the shed on the stone knoll` |
| `take_the_stone_knoll` | `capture` · `post_stone` 15 s · secondary | Take the stone knoll and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the stone knoll and hold it for 15 seconds` |

`level_the_stone_post` and `kill_the_knoll_eye` are deliberately two objectives
and not one, because the mission's argument is that they are two acts: the man
can be replaced and the shed cannot. The label for the raze names the **post**;
the label for the HVT names the **shed** he is in. Neither is the other.

### 5.4 `debrief` — 83 chars

> *Nobody replaces an observer on a heap of blocks. They replace him on the next
> hill.*

Honest on a win and a loss. Status **`live`**.

### 5.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Umm Zeitoun II — The Long Look` · *2 primary objectives* | | live |
| mission start | `brief` | Idit / Shai | beats 1–5 above | | live |
| `objective(hold_the_crest_line, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the crest line for four minutes` | | live |
| `objective(hold_the_crest_line, complete)` | `radio` | **net** | "Crest line held four minutes. Engineers are off it." | `objectives[].say`; flat, no name — the net reports, it does not comment | live |
| `objective(level_the_stone_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Level the post above the stone knoll inside five minutes` | | live |
| `objective(level_the_stone_post, complete)` | `radio` | **Shai** | "Post is down. Nobody replaces an observer on a heap of blocks — they replace him on the next hill." | `objectives[].say`; the mission's thesis, and the `debrief` echoes it on purpose | live |
| `objective(level_the_stone_post, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Level the post above the stone knoll inside five minutes` | **the only way to lose this mission**; a failed primary loses it | live |
| `objective(level_the_stone_post, failed)` @300 s | `radio` | **Shai** | "Five minutes gone and the shed is still standing. He has watched everything we put on that line." | `objectives[].say_on_fail` | live |
| `objective(kill_the_knoll_eye, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the observer in the shed on the stone knoll` | | live |
| `objective(kill_the_knoll_eye, complete)` | `radio` | **Idit** | "Knoll post is down. The wadi road is unobserved for the first time since we came into this basin." | `objectives[].say`; **the reward the player will not understand until III**, which is the point | live |
| `objective(take_the_stone_knoll, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the stone knoll and hold it for 15 seconds` | **no `say`, deliberately** — the toast is the whole beat, and T-U6 says they come back for it | live |
| `casualties_pct(30)` → `the_tube_moves_north` (`withdraw_to` group `battery` → `battery_north`) | `toast` | system | `enemy reacts (the_tube_moves_north)` | id reads as prose; **keep** | live |
| same trigger | `radio` | **Idit** | "Battery is displacing north. Twenty-eight tiles to the crest line from there — that is what taking a third of them off him buys." | `triggers[].say`. **The design records two speakers for this row** (`net` in its trigger table, `idit` in its story hooks); Idit, because the line states a *meaning* and the net states facts | live |
| wave t=90 s (2 `sarim_rifles` from `sarim_west` → `knoll_stone`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=180 s (1 `recoilless_team` → `rim_crest`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=210 s (1 `loiter_drone` from `sarim_north` → `camp_ground`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=210 s | `radio` | Shai | "Something small and low is going for the camp, not the line. Whatever is behind you is the thing you are building." | **T-U4**; a wave cannot speak (§12 G-D) | engine |
| wave t=300 s (2 `sarim_rifles` from `sarim_east` → `crest_line`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| `built` — a purchased `inf_squad` arrives | `toast` | system | `reinforcement deployed — inf_squad` | **prints a raw unit id.** Act I's **G-D**, still open; `render-vfx` | engine |
| `SimEvent fire` from `uz_battery` onto `crest_line` | `eva` | brigade net | "Incoming. Indirect." | shared set, §9 | engine |
| `missionEnd(any)` | `debrief` | narrator | §5.4 above | | live |
| `missionEnd(victory)` | `debrief` | Shai | "Four minutes on the line, a camp behind it, and one less hill in this basin with a man on it." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The shed is standing and everything we built is inside twelve tiles of a tube. We built it where he was looking." | needs the win/lose split | engine |

---

## 6. `umm_zeitoun_3_clearance` — Blinding

`clearance` · **Major** · `umm_zeitoun` · requires **R I** · produces **R M C I E**
· `target_minutes` 7. **The act's ROE bait, and the mission where Idit finds
Adhal and can do nothing with it.**

### 6.1 `name`

`Umm Zeitoun III — Blinding`

The word is the mission: two posts killed and a front that stops being able to
see. It is also what the battery does to itself when it displaces onto ground it
cannot observe.

### 6.2 `briefing` — 1,101 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Both horns sit eighteen tiles from the crest and they are not the same job: the western is scree, and nothing on wheels or tracks gets up it. The eastern is a bare glacis with a Kornet team lying on it at ten tiles. | 215 |
| 2 | **Shai** | Kill both posts. You have one force, it will not take the western horn in vehicles, and you decide which half of it walks before anything moves. | 144 |
| 3 | **Idit** | Six families are in the hamlet on the floor between them, eleven tiles from the wadi. Nobody inside that block can see out of it and nothing outside it can see in — the houses do that in both directions. | 203 |
| 4 | **Shai** | Get four of them to the wadi inside five minutes. The block is flagged: rifles, the remote gun and the sniper's rifle work in there, and autocannon, tank fire or anything from the tubes is billed against a floor of forty-five. | 226 |
| 5 | **Idit** | His battery is west of the basin and reaches neither the hamlet nor the road out of it from there. Press him off that ground and it goes south, and the eye on the stone knoll can hand it both. | 192 |
| 6 | **Shai** | You will not be billed for a rocket he fires. You will lose this all the same if four of them do not reach the wadi. | 116 |

Idit / Shai / Idit / Shai / Idit / Shai — the only briefing in the act that
alternates cleanly all the way down, because this mission has three stacked
decisions and each one needs the picture before the order.

**Beat 6 is the act's ROE thesis and the reason the mission exists.** It is two
mechanical facts and no opinion: `stepRoe` deducts only when the `by` of a
`destroyed` is a player unit, so his rockets cost the rating nothing; and
`evacuate_before` is a primary, so the count becoming unreachable loses the
mission anyway. That is `storyline.md`'s **T8** — *"the penalty is on the player,
always"* — delivered by a placement and a `withdraw_to`, with **zero engine
work**. The briefing never says shelling the block is wrong. It says what it
costs, and then it says what *his* shelling costs, which is nothing and
everything.

Beat 4's collateral list is measured, not remembered (design §5.3): the 0.3
structural threshold arms `cannon_30` 0.35, `gun_120` 0.55, `mortar_60` 0.70 and
`charges` 0.60, and does not arm `rifles` 0.10, `coax_mg` 0.20, `rws_50` 0.25 or
`amr` 0.05. **`spike_atgm` is 0.30 exactly and the text deliberately does not
rule on it** — `level-scripter` measures which side of the comparison it lands on
in Q16.16 before anybody writes "the AT team may fire in there".

**The JSON string, to be pasted whole:**

> Both horns sit eighteen tiles from the crest and they are not the same job: the western is scree, and nothing on wheels or tracks gets up it. The eastern is a bare glacis with a Kornet team lying on it at ten tiles. Kill both posts. You have one force, it will not take the western horn in vehicles, and you decide which half of it walks before anything moves. Six families are in the hamlet on the floor between them, eleven tiles from the wadi. Nobody inside that block can see out of it and nothing outside it can see in — the houses do that in both directions. Get four of them to the wadi inside five minutes. The block is flagged: rifles, the remote gun and the sniper's rifle work in there, and autocannon, tank fire or anything from the tubes is billed against a floor of forty-five. His battery is west of the basin and reaches neither the hamlet nor the road out of it from there. Press him off that ground and it goes south, and the eye on the stone knoll can hand it both. You will not be billed for a rocket he fires. You will lose this all the same if four of them do not reach the wadi.

### 6.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `kill_the_west_horn` | `eliminate_hvt` · `uz_eye_west` · primary | Kill the post on the western horn | `OBJECTIVE COMPLETE — Kill the post on the western horn` |
| `kill_the_east_horn` | `eliminate_hvt` · `uz_eye_east` · primary | Kill the post on the eastern horn | `OBJECTIVE COMPLETE — Kill the post on the eastern horn` |
| `get_the_hamlet_out` | `evacuate_before` · `refuge_wadi` ×4 @300 s · **primary** | Get four families out of the hamlet to the wadi inside five minutes | `OBJECTIVE COMPLETE — Get four families out of the hamlet to the wadi inside five minutes` |
| `find_adhal` | `locate` · `uz_hvt_lantern` · secondary | Find the man the posts are reporting to | `OBJECTIVE COMPLETE — Find the man the posts are reporting to` |
| `kill_the_knoll_eye` | `eliminate_hvt` · `uz_eye_knoll` · secondary | Kill the eye on the stone knoll that overlooks the wadi road | `OBJECTIVE COMPLETE — Kill the eye on the stone knoll that overlooks the wadi road` |

Two notes on the labels.

**`find_adhal` does not name him.** *"Find the man the posts are reporting to"* is
what the player knows before the objective completes; the name arrives in the
`say` on the same tick. Putting *Karim Adhal* in the label would spend the reveal
on the objective list at t=0.

**`kill_the_knoll_eye` names its consequence, not its target.** It is a
secondary, and a secondary needs a reason on the face of it: *the eye that
overlooks the wadi road* is why killing him matters, measured at 4.0 tiles to
`civ_refuge` and 7.1 to `hamlet_square`. The same placement survives II if the
player left it; **T-U7** is the whole of that sentence.

### 6.4 `debrief` — 93 chars

> *A block like that is blind in both directions. That is not an accident and it
> is not geology.*

Honest on a win and on a loss; the second clause is a deliberate echo of Act I's
clinic route. Status **`live`**.

### 6.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Umm Zeitoun III — Blinding` · *3 primary objectives* | | live |
| mission start | `brief` | Idit / Shai | beats 1–6 above | | live |
| `objective(kill_the_west_horn, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the post on the western horn` | | live |
| `objective(kill_the_west_horn, complete)` | `radio` | **Idit** | "West horn is blind. Half the floor belongs to nobody now." | `objectives[].say` | live |
| `objective(kill_the_east_horn, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the post on the eastern horn` | | live |
| `objective(kill_the_east_horn, complete)` | `radio` | **Idit** | "East horn is blind. Whatever he calls from here he calls off a map, not off the ground." | `objectives[].say` | live |
| `objective(find_adhal, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the man the posts are reporting to` | | live |
| `objective(find_adhal, complete)` | `radio` | **Idit** | "That is Karim Adhal, on the northern crest, thirty-four tiles out. Two towns of his work and this is the first time anybody has had his ground." | `objectives[].say`; **T-U8 — the name arrives here, and nothing follows, which is the beat** | live |
| `objective(kill_the_knoll_eye, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the eye on the stone knoll that overlooks the wadi road` | | live |
| `objective(kill_the_knoll_eye, complete)` | `radio` | **Idit** | "Knoll is clear. Nothing left in this basin can put a round on the wadi road by looking at it." | `objectives[].say` | live |
| `casualties_pct(35)` → `he_brings_the_tube_south` (`withdraw_to` group `battery` → `battery_south`) | `toast` | system | `enemy reacts (he_brings_the_tube_south)` | **id renamed from the design's `he_shells_his_own_village`** — §11, and the reason is the doctrine rule | live |
| same trigger | `radio` | **Idit** | "Battery is coming south. From that position it reaches the hamlet at seven tiles and the wadi road at ten, and every round of it is his." | `triggers[].say`; **T8-U, the act's bait made mechanical** | live |
| a civilian killed by an enemy round | `roe` | — | **no deduction at all** — `stepRoe` bills only a `destroyed` whose `by` is a player unit | shipped behaviour, and the design depends on it | live |
| `evacuated` (a civilian reaches `refuge_wadi`) | `toast` | system | **nothing at all** | Act I's **G-B**; the evacuation's own progress is silent until the fourth one lands | engine |
| `objective(get_the_hamlet_out, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get four families out of the hamlet to the wadi inside five minutes` | | live |
| `objective(get_the_hamlet_out, complete)` | `radio` | **Shai** | "Four out of the block. Nothing else in there is worth a round from the tubes." | `objectives[].say` | live |
| `objective(get_the_hamlet_out, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get four families out of the hamlet to the wadi inside five minutes` | loses the mission | live |
| `objective(get_the_hamlet_out, failed)` @300 s | `radio` | **Shai** | "Clock is out on the hamlet. They are under his rockets now and we are not going back through them." | `objectives[].say_on_fail`; **flat, and not a sermon — Act I's ceiling holds** | live |
| first `roe` deduction inside `hamlet` | `toast` | system | hard-coded `roeNotice` copy | the deduction beat 4 priced | live |
| first `roe` deduction inside `hamlet` | `radio` | Shai | "That was inside the block. It is the same forty-five points whether the round was aimed at a house or past one." | needs a sim-watching trigger (§12 G-E) | engine |
| `zone_entered(hamlet)` → `the_house_was_the_section` (`dismount`) | `toast` | system | `enemy reacts (the_house_was_the_section)` | **T-U9**; `dismount` is a live `do.kind` | live |
| same trigger | `radio` | **Idit** | "They are out of the houses and into the street. They will not fight you from in there — they were never going to." | `triggers[].say` | live |
| wave t=120 s (2 `sarim_rifles` from `sarim_west` → `horn_west`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=240 s (1 `recoilless_team` from `sarim_east` → `horn_east`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=330 s (2 `sarim_rifles` from `sarim_north` → `hamlet_square`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=330 s | `radio` | Idit | "He is putting rifles into the square while the families are still walking out of it." | a wave cannot speak (§12 G-D) | engine |
| `missionEnd(any)` | `debrief` | narrator | §6.4 above | | live |
| `missionEnd(victory)` | `debrief` | Shai | "Both horns down and four out of the block, and we took it with rifles because the rating is the equipment." | needs the win/lose split | engine |
| `missionEnd(defeat)` via `fail_below: 45` | `debrief` | Idit | "The rating went under forty-five inside the block. He did not have to be in it — he only had to be able to reach it." | needs the win/lose split | engine |

---

## 7. `umm_zeitoun_4_clearance` — The Stockpile

`clearance` · **Major** · `umm_zeitoun` · requires **R I** · produces **R M C** ·
`target_minutes` 7 · **economy: yes.** **Act II ends here. Karim Adhal ends
here.**

### 7.1 `name`

`Umm Zeitoun IV — The Stockpile`

Flat on purpose. The last mission of the act is a demolition job with a man on a
hill sixteen tiles the other way, and the title should not promise a duel.

### 7.2 `briefing` — 950 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The depot is three buildings on the northern shelf, seven and a half thousand between them, and there is an eye on the spur beside it that sees the yard at five tiles. What that eye sees, the tube shells. | 204 |
| 2 | **Shai** | Bring all of it down inside five minutes. There is no dozer in Sur — that is two demolition parties, five seconds of charges at a time, standing still within two tiles of what they are dropping. | 194 |
| 3 | **Idit** | The man every post in this basin has been reporting to is on the crest, sixteen tiles the other way. Idit has had his voice for two towns and never once his ground. | 164 |
| 4 | **Shai** | You cannot do both of those slowly. Buy a third party with the logistics if you want the depot and the crest inside the same seven minutes. | 139 |
| 5 | **Shai** | Four porters are on the depot ground and the shelf behind it is five tiles from them. | 85 |
| 6 | **Shai** | Charges do not care who is beside the wall: set one within two tiles of them and you are billed for it, and the party will level whatever else it halts beside. | 159 |

Idit / Shai / Idit / Shai / Shai / Shai. Beats 5 and 6 split because the pair is
245 characters — one over the limit — which is the machine putting the porters on
their own beat, and it reads better that way than it would have written as one.

**Beat 2 is the mission's whole shape.** No dozer, 7,500 hp, five seconds at a
time, standing still. *What to bring* is the question, and the answer is bought
with logistics rather than chosen from a road.

**Beat 6 is the last ROE line of the act** and it is the one the player is most
likely to break by accident: `charges` is `collateral_risk` 0.6, above the 0.5
heavy-ordnance threshold, so a demolition set within two tiles of a civilian is
danger close at −3 an event and killing one is −8 — and `stepDemolition` will
level *any* non-protected building a demolisher merely halts beside. The porters
are a **secondary** evacuation, so it is a bill and not a trap.

**The JSON string, to be pasted whole:**

> The depot is three buildings on the northern shelf, seven and a half thousand between them, and there is an eye on the spur beside it that sees the yard at five tiles. What that eye sees, the tube shells. Bring all of it down inside five minutes. There is no dozer in Sur — that is two demolition parties, five seconds of charges at a time, standing still within two tiles of what they are dropping. The man every post in this basin has been reporting to is on the crest, sixteen tiles the other way. Idit has had his voice for two towns and never once his ground. You cannot do both of those slowly. Buy a third party with the logistics if you want the depot and the crest inside the same seven minutes. Four porters are on the depot ground and the shelf behind it is five tiles from them. Charges do not care who is beside the wall: set one within two tiles of them and you are billed for it, and the party will level whatever else it halts beside.

### 7.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `raze_the_stockpile` | `raze` · `stockpile` @300 s · **primary** | Raze the stockpile inside five minutes | `OBJECTIVE COMPLETE — Raze the stockpile inside five minutes` |
| `kill_adhal` | `eliminate_hvt` · `uz_hvt_lantern` · primary | Kill Karim Adhal on the northern crest | `OBJECTIVE COMPLETE — Kill Karim Adhal on the northern crest` |
| `kill_the_battery` | `eliminate_hvt` · `uz_battery` · secondary | Destroy the rocket battery north of the depot | `OBJECTIVE COMPLETE — Destroy the rocket battery north of the depot` |
| `get_the_porters_clear` | `evacuate_before` · `north_shelf` ×3 @240 s · secondary | Get three porters off the depot ground to the northern shelf | `OBJECTIVE COMPLETE — Get three porters off the depot ground to the northern shelf` |
| `bring_the_relay_down` | `raze` · `crest_top` · secondary | Bring the relay hut on the crest down | `OBJECTIVE COMPLETE — Bring the relay hut on the crest down` |

`raze_the_stockpile` reuses `wadi_halam_5_depot`'s exact construction — *"Raze
the depot inside five minutes"* — because it is the same objective type on the
same clock and the tree should say the same thing the same way.

**`kill_adhal` is the one label in the act that names a man**, and it is the last
objective of the front. Act I set the precedent with *"Find Nadir Sahim at the
shaft head"*: the position and the name together, so the toast reads as a place
being taken rather than a scalp. `eliminate_hvt`, never `capture` — an observer's
whole practice is not being where you are looking, so taking his ground is not
taking him (`storyline.md` §2.3).

`get_the_porters_clear` says **off the depot ground**, not *to safety*: they run
five tiles north into their own ground and the brigade is not taking them
anywhere. The refuge is `civ_north`, inside `north_shelf`.

### 7.4 `debrief` — 107 chars

> *Nothing in Sur comes down by driving at it. Five seconds at a time, standing
> still, with the hill watching.*

Honest on a win and on a loss. Status **`live`**.

### 7.5 Karim Adhal's one line — 135 chars

On `the_tube_goes_west`, `speaker: "enemy"`, and it is the only line any villain
speaks in Act II.

> *Move it west. The tube was never what had to see — that has been on the hill
> since long before the first rocket, and it does not close.*

About looking; never about the player; no second person anywhere in it. *"It does
not close"* is an eye, and it is the last thing the player hears from him before
the crest. He does not speak again — at `casualties_pct(50)` he leaves without a
word, which is the character.

**A choice recorded, because the design reads the other way.** `design.md` §5.4
puts `say` (**net**) on `the_tube_goes_west` and `say` (**enemy**) on
`he_goes_over_the_back`; this sheet swaps them. Two reasons. The player hears him
**before** anybody has found him, which is what an observer is; and his own
withdrawal stays silent, so the man who is characterised by absence is absent
from his own exit. `sayNotice` gives `enemy` no name at all — *"— Move it
west."*, tone `warn` — so the transmission reads as intercepted rather than
addressed, which only works if he is not answering something.

### 7.6 `aftermath` — Act II closes — 227 chars

> *Nothing fell on the north that morning, or the one after it. They took Adhal
> off the crest with the whole basin still in front of him. Brigade put a fourth
> star on the slip. The tubes came up a road, and the road is not in Sur.*

Four stars is Lieutenant Colonel (`storyline.md` §2.1, §0.2 O6). *"With the whole
basin still in front of him"* is the observer's ending — he died looking — and it
claims no capture the mission cannot stage. The last sentence hands the campaign
to Naharin and to the smuggler whose road carried the rockets, which is GDD §2's
*proximity, standoff, source* stated as a consequence rather than as a plan.

**The promotion is the act boundary, not this mission**, so nothing in the
`briefing`, the `say` lines or the `debrief` promotes him — only the `aftermath`
does, and it does it in four words. Status **`live`**; owner `mission-author`.

### 7.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Umm Zeitoun IV — The Stockpile` · *2 primary objectives* | | live |
| mission start | `brief` | Idit / Shai | beats 1–6 above | | live |
| `objective(raze_the_stockpile, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Raze the stockpile inside five minutes` | | live |
| `objective(raze_the_stockpile, complete)` | `radio` | **Shai** | "Depot is down. That is what was coming over the wall at Tel Marum, and it is not coming again." | `objectives[].say`; the only line in the act that reaches back to the pass | live |
| `objective(raze_the_stockpile, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Raze the stockpile inside five minutes` | **the only way to lose this mission**; loses it | live |
| `objective(raze_the_stockpile, failed)` @300 s | `radio` | **Shai** | "Five minutes. The depot is standing and the parties that were going to bring it down are not." | `objectives[].say_on_fail`; states the real failure — both `demo_squad` dead makes the primary impossible | live |
| `casualties_pct(40)` → `the_tube_goes_west` (`withdraw_to` group `battery` → `battery_west`) | `toast` | system | `enemy reacts (the_tube_goes_west)` | id reads as prose; **keep** | live |
| same trigger | `radio` | **enemy** | §7.5 — "Move it west. The tube was never what had to see — that has been on the hill since long before the first rocket, and it does not close." | `triggers[].say`; `sayNotice` renders `enemy` with **no name**, tone `warn` | live |
| `casualties_pct(50)` → `he_goes_over_the_back` (`withdraw_to` group `lantern` → `crest_reverse`) | `toast` | system | `enemy reacts (he_goes_over_the_back)` | id reads as prose; **keep** | live |
| same trigger | `radio` | **net** | "He is over the back of the crest and out of sight of the basin. Whoever wants him climbs." | `triggers[].say`; **T-U10.** Flat, and deliberately not his own voice (§7.5) | live |
| `objective(kill_adhal, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill Karim Adhal on the northern crest` | | live |
| `objective(kill_adhal, complete)` | `radio` | **Idit** | "Adhal is off the crest. He never fired a round in this war and he chose where every one of them landed." | `objectives[].say`; **the act's last word on him, and it is hers, because the whole front was her question** | live |
| `objective(kill_the_battery, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Destroy the rocket battery north of the depot` | | live |
| `objective(kill_the_battery, complete)` | `radio` | **Idit** | "Battery is finished. Sur has nothing left that reaches Kedem." | `objectives[].say`; the act's title condition, stated once | live |
| `evacuated` (a porter reaches `north_shelf`) | `toast` | system | **nothing at all** | Act I's **G-B** | engine |
| `objective(get_the_porters_clear, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get three porters off the depot ground to the northern shelf` | | live |
| `objective(get_the_porters_clear, complete)` | `radio` | **Shai** | "Porters are on the shelf. Nothing of ours goes north of the yard for them." | `objectives[].say` | live |
| `objective(get_the_porters_clear, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Get three porters off the depot ground to the northern shelf` | a **secondary** — it bills, it does not lose | live |
| `objective(get_the_porters_clear, failed)` @240 s | `radio` | **Shai** | "They are still on the yard and the charges are already set. Work round them or work slower." | `objectives[].say_on_fail` | live |
| `objective(bring_the_relay_down, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Bring the relay hut on the crest down` | | live |
| `objective(bring_the_relay_down, complete)` | `radio` | **net** | "Relay hut is down." | `objectives[].say`; **T-U13** — four words, because the ending is a building coming down and not a speech | live |
| `roe` deduction, danger close to the porters | `toast` | system | hard-coded `roeNotice` copy | the deduction beat 6 priced | live |
| a building levelled by a halted `demo_squad` | `toast` | system | **nothing that names it** | `stepDemolition` levels what it halts beside and no notice says which; `render-vfx` | engine |
| wave t=150 s (2 `sarim_rifles` from `sarim_north` → `stockpile_yard`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=260 s (1 `recoilless_team` + 1 `sarim_rifles` from `sarim_west` → `crest`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=260 s | `radio` | Idit | "They are reinforcing the crest, not the depot. He is worth more to them than the rockets are." | a wave cannot speak (§12 G-D) | engine |
| wave t=360 s (1 `loiter_drone` → `stockpile_yard`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| `SimEvent destroyed`, both `demo_squad` | `radio` | Shai | "That was the last party. Whatever is still standing at the deadline stays standing." | needs a sim-watching trigger (§12 G-E) | engine |
| `missionEnd(any)` | `debrief` | narrator | §7.4 above | | live |
| `missionEnd(victory)` | `aftermath` | narrator | §7.6 above | victory banner | live |
| `missionEnd(victory)` | `debrief` | Idit | "Two towns, seven missions and one man, and the only thing he ever did was look at us." | needs the win/lose split | engine |
| `missionEnd(victory)` | `debrief` | Shai | "Then we go to the road." | **the act boundary and the promotion**; Major → Lieutenant Colonel | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The depot is standing and he is on the reverse slope. Nothing about the north changes tonight." | needs the win/lose split | engine |

---

## 8. Ambient lore — secondary locations

Ground the player crosses that no objective names. Every line fires once and
stops the game for nobody. Marker and zone ids are read from
`data/maps/tel_marum.json` for the first block and from `data/maps/umm_zeitoun.json`
for the second. **That map landed in this worktree while this sheet was being
written**, so every id and every coordinate below was re-checked against the file
rather than against `design.md` §4.4: all 20 markers cited resolve, all 11 zones
resolve, and `staging` is `[18,43,12,3]` as the design drew it. Nothing in §8.2 is
a claim against a file that does not exist.

### 8.1 Tel Marum

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the hollow | `hollow [24,29]` | `radio` | Idit | "The hollow is the one piece of this valley the battery cannot reach and cannot see. It is also the only piece of it worth nothing." | engine |
| the wide saddle | `saddle_wide [24,14]` / zone `pass` | `radio` | Idit | "Both pockets were laid on the wide saddle before anybody dug them in. It is the only road and they have had years to know it." | engine |
| the narrow saddle | `saddle_narrow [10,14]` | `radio` | Idit | "Nothing on wheels has been up the narrow saddle since the rock came down. That is why nobody is watching it and why nobody needs to." | engine |
| the boulder corridor | `tel_marum` x10–11, y12–17 | `radio` | Shai | "Fallen rock, two tiles wide, six deep. A man walks it and everything else turns round." | engine |
| the east overwatch | `overwatch_east [28,16]` | `radio` | Idit | "East bay lip. Whatever is lying up there is lying in ambush, not in overwatch — it fires once and it fires close." | engine |
| the west overwatch | `overwatch_west [20,16]` | `radio` | Idit | "West lip is the better post of the two and it is the one he keeps a man on." | engine |
| the battery position | `battery_position [25,6]` | `radio` | Idit | "Sight six, reach twenty. Everything that tube has ever hit was somebody else's arithmetic." | engine |
| the town block | zone `town_block [24,3,3,2]` | `radio` | Shai | "Six tiles of housing behind the wall, two from the gun. He did not park there because the ground is good." | engine |
| the town edge | `town_edge [25,2]` | `radio` | Idit | "Everything that reinforces this pass comes off the northern edge. There has never been a second road." | engine |

### 8.2 Umm Zeitoun

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the staging bowl | `staging [18,43,12,3]`, `camp_ground [21,44]` | `radio` | Idit | "Nothing on this map can see into the bowl. It is the only ground in Sur we have ever been able to say that about." | engine |
| the rim crest | `rim_crest [24,41]` / zone `crest_line` | `radio` | Shai | "The rim is the highest thing on the southern half and everything that matters is on the other side of it." | engine |
| the wells | `uz_wells [14,35]` | `radio` | Idit | "The wells were here before the basin had a name on our maps. Nine tiles to the wadi and no road between." | engine |
| the wadi | `civ_refuge [23,37]` / zone `refuge_wadi` | `toast` | system | `one family into the wadi` — proposed replacement for the silent `evacuated` (Act I **G-B**) | engine |
| the stone knoll | `knoll_stone [23,33]` / zone `post_stone` | `radio` | Idit | "One shed on a knoll, four tiles from the wadi road. Two hundred and forty points of block, and the best-placed eye in the basin." | engine |
| the hamlet | `hamlet_square [24,26]` / zone `hamlet` | `radio` | Idit | "Fourteen houses and a lane. Nobody in there can see out of it, which is why the people in it never saw any of this start." | engine |
| the western horn | `horn_west [10,23]` | `radio` | Shai | "Scree the whole way up. On foot it is a climb; on tracks it is not a route at all." | engine |
| the eastern horn | `horn_east [37,23]` | `radio` | Shai | "Bare glacis, nought to five. Anything that goes up it is seen for the whole climb." | engine |
| the anti-tank ditch | y=31, x=16–31 | `radio` | Idit | "Somebody cut that ditch across the floor with a machine. It costs armour four tiles and infantry nothing, which tells you who they expected." | engine |
| the lanes | `lane_west [14,28]`, `lane_centre [24,20]`, `lane_east [33,27]` | `radio` | Idit | "Three lanes across the floor and every one of them is under a different hill. There is no fourth." | engine |
| the northern crest | `crest [14,7]` / zone `crest_top` | `radio` | Idit | "Two concrete tiles on the highest ground in the basin, with an aerial. That is not a position — it is a place to sit and read." | engine |
| the reverse slope | `crest_reverse [13,4]` | `radio` | Shai | "The back of the crest is dead to everything south of it. If he goes over, somebody climbs." | engine |
| the depot | `stockpile_yard [32,7]` / zone `stockpile` | `radio` | Idit | "Nine bays of warehouse, six of concrete, two sheds. Everything that fell on the north came through that yard." | engine |
| the northern shelf | `civ_north [27,3]` / zone `north_shelf` | `radio` | Shai | "The shelf behind the depot is theirs and it stays theirs. We are not moving anybody — we are getting them off a target." | engine |
| the battery positions | `battery_south [30,30]`, `battery_north [27,13]`, `battery_west [12,17]` | `radio` | Idit | "Three surveyed positions for one tube. He has never had to fight for a piece of ground in his life." | engine |
| the missile teams | `manpad_north [20,12]`, `manpad_basin [30,22]` | `radio` | Idit | "Two missile teams, thirteen tiles, air only. They are not here for us — they are here for the drone." | engine |

---

## 9. EVA announcements — the Act II delta

**The set is Act I's** (`docs/campaign/beit_sahwan/narrative.md` §8) and it is
written once for the whole campaign, not per town: the brigade net, flat,
unhurried, no name, no accent, no idiom, no prowords beyond *Actual*.
`storyline.md` §2.4(5) binds hardest here — **the doctrine rule heads that sheet
before a single line is recorded** (GH-110), because retrofitting it means
throwing the audio away.

`tools/validate_audio.py`'s `KNOWN_EVENTS` is six weapon and impact events, so
`pnpm validate:audio` **cannot accept a voice file at all**. The gate widens
first (`storyline.md` §7 G4).

Act II adds four events Act I's set does not cover. Everything else is reused.

| event | line | status |
|---|---|---|
| `removed`, side 2 (a civilian group taken) | "Civilians off the net." | engine |
| `SimEvent fire` from a `rocket_battery` at the player | "Incoming. Indirect." | engine |
| an enemy `withdraw_to` on a tagged group | "Enemy displacing." | engine |
| a `raze` target's last structure down | "Structure down. Objective clear." | engine |

**"Civilians off the net" and not "taken"** — the toast already says *taken*
(`removedNotice`), and a spoken line repeating a written one in the same second
is noise. The net reports that it has lost contact, which is all the net knows.

## 9a. Barks

**Not written here, deliberately, and for the same reason as Act I.** Barks are
keyed by unit **role**, never per unit (GH-110), and the doctrine-not-people rule
has to head that sheet **before** a line exists, because it constrains accent,
idiom and phrasing — the things that carry ethnicity in a recording and the
things that cannot be edited out of one. Act II fields eleven KDF roles and six
Sarim roles; a role-keyed set for both is its own deliverable and must not be
smuggled in at the bottom of a briefing sheet.

---

## 10. The twist lines — T6 to T8 and T-U1 to T-U13

The classification is `level-scripter`'s; the lines are this sheet's. **The
"mechanic" column is what is needed *besides* a voice** — the voice itself exists
now, which is the difference between this table and Act I's.

| # | mission | twist | speaker | line | mechanic | status |
|---|---|---|---|---|---|---|
| **T6** | TM I | *The eye is behind you.* A `sarim_rifles` spawns behind the hollow | Idit | "Something moved on the floor behind you. That ground was never yours; you were only the first thing to stand on it." | `zone_entered(valley_floor)` → `spawn`; **the town's first trigger**. Must miss the drone route (design §3.5) | live |
| **T7** | TM II | *He was never in the pocket.* The HVT dies and the shelling does not ease | Shai | "Eyes off that lip. Count the next thirty seconds — anything that still lands is being called by somebody else." | **none** — the wave clock already does it and `objectives[].say` says it. The cheapest real twist in the act | live |
| **T8** | TM III | *The battery fires into its own town* | — | **not written for Tel Marum, deliberately** | choosing where an enemy round lands is sim work (§12 G-F). Spent at Umm Zeitoun III instead, as **T8-U** | engine |
| **T8-U** | UZ III | the same idea by placement: he displaces onto ground from which his rounds reach the block the player may not shoot into | Idit | "Battery is coming south. From that position it reaches the hamlet at seven tiles and the wadi road at ten, and every round of it is his." | `casualties_pct(35)` → `withdraw_to`. **Zero engine work** | live |
| **T-C1** | TM III | *The tube moves.* The Grad withdraws into the town block | Idit | "The tube is backing into the town block. He is not hiding it from you — he is putting it where your heavy ordnance is the thing that finds it." | `casualties_pct(40)` → `withdraw_to town_edge`; **can walk `kill_battery` out of the shipped plan's reach** | live |
| **T-C2** | TM III | *The corridor was watched after all* | Idit | "Rifles in the corridor. Somebody was watching the one route the rock was supposed to keep quiet." | `zone_entered` on a **new** `narrow_corridor` zone the map does not declare | live |
| **T-U1** | UZ I | *They were gone before you got there* | Idit | "The wells are empty and nobody fought over them. They walked them north between the hills while we were looking at the hills." | `timer_s(242)` → `remove`; landed 2026-09-03 | live |
| **T-U2** | UZ I | *The fourth hill is not a hill.* The crest post decays back to unknown | Idit | "That is the crest post, and I have him for as long as something is looking at him. Nothing of ours can hold that from outside thirteen tiles." | none — `revealAt` is not exempt from decay. Needs **measuring**, not building | live |
| **T-U3** | UZ I | *The drone is the mission.* Losing it costs nothing now and everything in III | Idit | "Drone is gone. Whatever it had not looked at yet, we go and look at on foot, next week, with people." | a trigger that can watch a `SimEvent` (§12 G-E) | engine |
| **T-U4** | UZ II | *The camp is the target.* The loiter drone goes for `camp_ground` | Shai | "Something small and low is going for the camp, not the line. Whatever is behind you is the thing you are building." | a wave cannot speak (§12 G-D) | engine |
| **T-U5** | UZ II | *He watched you dig it.* The post sees the line and not the bowl | Idit | briefing beat 3 — *"nothing up there can see what you are putting on it. What they can see is the line."* | none; it is text and it is applied | live |
| **T-U6** | UZ II | *They come back for the hill.* The 300 s wave retakes the razed post's ground | — | **no line, deliberately** — `enemy reinforcements — 2 unit(s) inbound` while the player stands on the rubble is the whole beat | none | live |
| **T-U7** | UZ II→III | *The eye you left alive.* The knoll observer survives II and is why the refugees are shelled in III | Idit | "The near one is in the shed on the stone knoll, four tiles from the wadi road. That is the eye that matters to the families, not to us." | none — a secondary in II, a secondary in III, and a `say` in I that plants it | live |
| **T-U8** | UZ III | *He is on the hill you cannot reach* | Idit | "That is Karim Adhal, on the northern crest, thirty-four tiles out. Two towns of his work and this is the first time anybody has had his ground." | none — a `locate` and a `say` | live |
| **T-U9** | UZ III | *The house was the section* | Idit | "They are out of the houses and into the street. They will not fight you from in there — they were never going to." | `zone_entered(hamlet)` → `dismount`, a live `do.kind` | live |
| **T-U10** | UZ IV | *He does not wait for you* | net | "He is over the back of the crest and out of sight of the basin. Whoever wants him climbs." | `casualties_pct(50)` → `withdraw_to crest_reverse` | live |
| **T-U11** | UZ IV | *The depot is a magazine.* The concrete block detonates when razed | — | **not written** — a structure's destruction cannot carry authored damage (`COLLAPSE_SHOCK` is a tuning constant) | schema field on `data/structures.json` (§12 G-G) | engine |
| **T-U12** | UZ IV | *The last eye is not on a hill.* `uz_eye_depot` sits on a two-level spur, reachable without a climb | Idit | "That one is not on a peak. Two levels of spur, and it is the first post in this basin anybody could walk up to." | none — a placement | live |
| **T-U13** | UZ IV | *The relay outlives him* | net | "Relay hut is down." | `raze(crest_top)` secondary + `objectives[].say` | live |

**T-U7 is the one to build first**, and not because it is cheapest. It is the
only twist in the act that makes a *secondary the player skipped* into the reason
people die two missions later, which is the act's whole argument about
information — and all three of its parts (a `say` in I, an `eliminate_hvt`
secondary in II, the same tag in III) are live today with no engine work at all.

---

## 11. Trigger ids — proposals, because an id is player-facing prose

A trigger's `id` is printed verbatim as `enemy reacts (<id>)`
(`main.ts:262`), and `mission.schema.json` puts no pattern on it.
**`level-scripter` owns these ids; none of them exists in the JSON yet.**

| mission | design's id | proposed | why |
|---|---|---|---|
| UZ III | `he_shells_his_own_village` | **`he_brings_the_tube_south`** | *"his own village"* makes the population **his**, and this campaign never gives a people to a faction (GDD §2, `storyline.md` §2.4(5)). The families in the hamlet are people who live where two armies are fighting, and the id the player reads must not say otherwise. The proposed name states the act rather than the possession, reads as prose, and loses nothing: the *meaning* is carried by Idit's `say` on the same tick |
| TM I | — (new) | **`something_moves_behind_the_hollow`** | T6 has no id yet. `enemy reacts (something_moves_behind_the_hollow)` is the twist's own sentence |
| TM III | — (new) | **`the_tube_backs_into_the_town`** | T-C1. Names what the player will see and what it will cost |
| TM III | — (new) | **`the_corridor_was_watched_after_all`** | T-C2, verbatim from the design's own title, which already reads as prose |
| UZ III | — (new) | **`the_house_was_the_section`** | T-U9 |
| UZ I | `they_move_the_families_off` | **keep** | reads correctly as prose and the verb is the right one — they are moved, not killed |
| UZ II | `the_tube_moves_north` | **keep** | |
| UZ IV | `the_tube_goes_west` | **keep** | |
| UZ IV | `he_goes_over_the_back` | **keep** | the best of the set: it is what happens and it is how a soldier would say it |

**Act I's `enemy reacts` defect does not recur here.** Every trigger in Act II is
an enemy act — a displacement, a spawn, a dismount, a group taken — so the
hard-coded prefix is correct on all nine rows. The tutorial's six friendly
`deliver_*` triggers remain the only place it lies (Act I **G-C**).

---

## 12. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | **The rank is wrong for all four Umm Zeitoun missions, and it is measured.** `commanderForMission` was driven against the shipped `data/campaign/commander.json` and `world.json` this session: `tel_marum_1_recon` and `tel_marum_3_clearance` resolve **Major, 3 stars** (correct), and `umm_zeitoun_1_recon` and `umm_zeitoun_4_clearance` resolve **Lieutenant Colonel, 4 stars** — Shai is promoted **mid-act**, which D-level policy forbids. The cause is two data facts: the Major entry's `until_mission` is `tel_marum_3_clearance`, and `world.json`'s `umm_zeitoun` town carries `"missions": []`, so the ids fall through `missionPosition`'s prefix match to a town that sits *after* the Major boundary | `until_mission` → `umm_zeitoun_4_clearance`, **and** the four ids into `world.json`'s `umm_zeitoun.missions`. Both are one line; **either alone is not enough** | `mission-author` |
| **G-B** | **`tel_marum_3_clearance` does not declare the recon it reads.** `requires` is `["roster.surviving_units"]` where `beit_sahwan_3_clearance` and `tel_marum_2_foothold` both declare `intel.marked_positions`. Verified in the design: `requires` is read by neither the runtime nor `campaign.ts`, so the fix cannot move a measurement — but Act II spends two missions building a picture and its clearance does not say it uses one, while `tm_bay_lip` sits in `ambush(4)` carrying the same tag mission I marks | add `intel.marked_positions` | `mission-author` |
| **G-C** | **`debrief` is one string on every mission end**, where `aftermath` is victory-only, so a debrief cannot say different things for a win and a loss. Fifteen written lines in this sheet are `engine` for that reason and no other | `debrief_victory` / `debrief_defeat`, read off `missionEnd.result` in `showEndScreen` | `sim-guard` + `render-vfx`; `storyline.md` §7 **G11** |
| **G-D** | **A wave cannot speak.** The wave item is `{at_seconds, trigger, to, units}` — `say` was added to triggers and objectives and not to waves. Reinforcements arriving is the most legible thing that happens in a mission and it is the one event with no voice. Six rows in this sheet are `engine` for it. The `timer_s` workaround costs a real order, because `do` is **required** | `say?: {speaker, text}` on the wave item, emitted with the existing `wave` event | `sim-guard`; design §7 **G12** |
| **G-E** | **A trigger cannot fire on a `SimEvent` or on an objective.** Every displacement in this act is on `casualties_pct` or a clock because there is no "the player entered the depot" or "the drone died" condition. Five `radio` rows here are `engine` for it | two `on.kind`s — `sim` (one of the 24 `SimEvent` kinds) and `objective`. The tutorial's `await` already gates on every `SimEvent`, so the predicate is reused | `sim-guard`; design §7 **G8** |
| **G-F** | **An author cannot choose where an enemy round lands**, so T8's literal form is unbuildable. Recorded, not blocking: Umm Zeitoun III delivers the *meaning* by placement instead | out of scope | `sim-guard`; design §7 **G13** |
| **G-G** | **A structure's destruction carries no authored consequence** (`COLLAPSE_SHOCK` is a tuning constant), so T-U11 is cut | `collapse_damage` / `collapse_radius` on a structure type | `sim-guard`; design §7 **G14** |
| **G-H** | **A civilian reaching the refuge is silent.** `describeMissionEvent` has no `evacuated` case, so it falls to `default: return null`. Act II scores on civilians in **three** of seven missions and the mechanic produces no toast, no sound and no line until the objective's own count lands | one `case 'evacuated'` | `render-vfx`; Act I **G-B**, still open |
| **G-I** | **`built` prints a raw unit id** — `reinforcement deployed — inf_squad`. Both economy missions in this act buy squads, so it fires repeatedly | look the display name up from the unit JSON | `render-vfx`; Act I **G-D**, still open |
| **G-J** | **The radio overlay does not exist.** Every `say` row lands in the notice feed and on the commander bar with no portrait, no speaker plate art and no voice, so `shai`, `idit`, `net` and `enemy` are told apart by an uppercase initial string (`sayNotice`) and, on the bar, by `speakerPlate` | frame, plate and portrait slot | `render-vfx`; **not blocking** — the lines arrive |
| **G-K** | **`pnpm validate:audio` cannot accept a voice file.** `KNOWN_EVENTS` is six weapon and impact events. Every `eva` row in §9 and every voice line in the act is blocked on the gate widening before anything is recorded | a non-weapon set kind and its events | `content-validator`; GH-110 |
| **G-L** | **A town cannot say it is unwritten.** `world.schema.json` has no `planned` property, so Sur reads complete on one town of two until the four Umm Zeitoun ids land — and the moment they land as ids with no files, the board is worse | `planned: true`, excluded from `regionProgress` | `sim-guard` + `app`; design §7 **G5** |

---

## 13. GDD amendments

**Canon moved once, and it is a factual correction rather than a story
decision.** §11's closing paragraph read:

> *"**Planned narrative surfaces**, approved and not yet built: EVA
> announcements, voice audio for briefings and transmissions, and a radio
> overlay for mid-mission lines. Until they ship, the story reaches the player
> through the mission name, the briefing delivered in beats, and objective
> labels — see `docs/campaign/README.md` for the surface contract."*

That last sentence became false on 2026-09-03, when `dispatch`, `aftermath`,
`debrief` and `say` landed. **Applied**, with the version line bumped 1.2 → 1.2.1:

> **The story reaches the player** through the mission name, the briefing
> delivered in beats, `dispatch` on the title card, `aftermath` on the victory
> banner, `debrief` on the end screen, objective labels, and mid-mission `say`
> lines carried by triggers and objectives into the notice feed and onto the
> commander bar. **Approved and not yet built:** EVA announcements, voice audio
> for briefings and transmissions, a radio overlay with portraits for the `say`
> lines, and a `debrief` that can tell a victory from a defeat. See
> `docs/campaign/README.md` for the surface contract.

Nothing else in §11 moved. Checked clause by clause against what this act does:
Shai a Major through Sur and promoted at the act boundary (§7.6); Idit supplying
the picture and never giving an order (every `say` in this sheet, checked);
**one villain per front, opened by an atrocity and ended captured or killed,
characterised by doctrine and named in the fictional register the towns use** —
Adhal opens Act II in a `dispatch` and dies in `umm_zeitoun_4_clearance`; and
*"missions may turn the plot inside the level… where the declarative vocabulary
can express it"*, which is §10's classification exactly.

**One refinement is offered again and again not applied**, because it is the
lead's and Act I's sheet already put it to him. §11 states the villains' naming
rule and names none of them, while shipped text now names Sahim in three places
and Act II will name Adhal in two:

> **Proposed, not applied.** In §11, *"…characterised by his doctrine (the
> digger, the observer, the smuggler) and named in the fictional register the
> towns use."* becomes *"…characterised by his doctrine and named in the
> fictional register the towns use — Nadir Sahim in the Marj, Karim Adhal in
> Sur, Jubran Hallaq in Naharin, filed by Idit's section as SPADE, LANTERN and
> FERRY."*

+1 sentence. It moves no decision — `storyline.md` §0.2 records all three names
as decided on 2026-09-03 — and it is deferred only because the same proposal is
already sitting in Act I's sheet awaiting the same answer.

**`storyline.md` itself needs no edit.** §3.2's Act II table, §4.1's Umm Zeitoun
ladder and §2.3's LANTERN entry are all still true of what is written here; the
one row that is now stale in a *different* document is `design.md` §5.4's speaker
assignment for `the_tube_goes_west`, and §7.5 records the swap and its reason
rather than silently taking it.

---

## 14. Row counts

Every table row in this file whose last cell is `live`, `schema` or `engine`,
counted by script rather than by eye.

**213 rows** carry one.

| status | rows | what they are |
|---|---|---|
| `live` | **147** | `toast` 67 · `radio`, i.e. a `say` on a trigger or an objective, 39 · `title` 7 · `brief` 7 · `debrief` 7 · twist rows 15 · `dispatch` 1 · `aftermath` 1 · `roe` 1 · two rows that record a **deliberate silence** (the pockets that get no `say`; the `survive_until` that cannot fail) |
| `schema` | **0** | none. Every field this act needs exists |
| `engine` | **66** | ambient lore 25 (`radio` 24, `toast` 1) · paired win/lose `debrief` 15 · `radio` 11 · `eva` 6 · `toast` 5 · twist rows 4 |

**66 `engine` rows.** Not one of them is blocked on a *field*: they are blocked on
four things and only four — a **radio overlay with portraits** (`render-vfx`), a
**voice layer** (GH-110, and the audio gate widens first), a **`debrief` that can
tell a win from a loss** (§12 G-C, 15 rows), and **trigger conditions over waves
and `SimEvent`s** so a line can be bound to a drone dying or reinforcements
landing rather than to a clock (§12 G-D 6 rows, G-E 5 rows). Every one of the 25
ambient rows is `engine` for the second and fourth reasons together: they have no
event to fire on and no surface to fire into.

**31 %** of the writing in this act still reaches nobody. In Act I the figure was
47 %, and the whole difference is the engine slice of 2026-09-03 — the `say`
lines that were the largest `engine` block in Beit Sahwan are the largest `live`
block here.

**What is applied to `data/missions/` this pass: nothing.** The three shipped Tel
Marum missions were read, their briefings beat-checked with a port of
`briefingBeats` (I 465 chars / 3 beats, II 482 / 3, III 752 / 4 — every beat ≤ 240
characters and ≤ 2 sentences, every total inside the shipped 385–1,225 band),
their objective labels checked against the whole tree's house style, and none of
them needed a word changed. `pnpm validate:data` and `loading.test.ts` were run
to prove the tree is where this sheet says it is, not because this sheet moved
it.

**What `mission-author` applies from here**, in order of what unblocks the most:
`commander.json`'s one line and `world.json`'s four ids (§12 G-A, without which
Shai is a Lieutenant Colonel in his own act); `tel_marum_1_recon.dispatch` and
`.debrief` and the two `say` lines; `tel_marum_2_foothold`'s two `say` lines and
`debrief`; `tel_marum_3_clearance`'s two `say` lines, `debrief` and the
`requires` fix; then the four Umm Zeitoun files, each with the `briefing` string
printed whole above, its objective labels, its `say` and `say_on_fail` lines, its
`debrief`, and — on the last one only — the `aftermath` that ends Act II.
