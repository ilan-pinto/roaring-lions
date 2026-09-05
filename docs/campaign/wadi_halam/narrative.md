# Wadi Halam — Narrative Trigger Sheet

**Act III · Naharin · Rif Cells · Shai Hammai is a Lieutenant Colonel in all five
missions, and a Colonel only after the last one.**

**Date:** 2026-09-06 · **Status:** the five shipped missions were read,
beat-checked and **three of them edited** — the two the design marks *re-brief y
(text)* plus two objective labels that had to name Hallaq's people. Everything
else here is authored text waiting on `mission-author`, who owns `dispatch`,
`aftermath`, `debrief`, `say`, `say_on_fail`, the new objectives and the
`requires`/`produces` lines.
**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`:
`data/missions/wadi_halam_*.json` read as they stand, `data/maps/wadi_halam_basin.json`
parsed for every marker and zone cited, `mission.schema.json` read for the shapes
rather than remembered, and `briefingBeats` ported rather than eyeballed.
Contract: `docs/campaign/README.md`. Canon: `docs/campaign/storyline.md` §0.2 O4,
§1, §2.1–§2.4, §3.3, §5. Upstream: `docs/campaign/wadi_halam/design.md` §2, §3,
§5, §6, §10. The voice and the table shape are Act I's and Act II's —
`docs/campaign/beit_sahwan/narrative.md`, `docs/campaign/tel_marum/narrative.md`.

Downstream: `mission-author` (the story fields, the four Option C objectives, the
ledger lines), `level-scripter` (the nine trigger ids and the bindings, §9),
`render-vfx` (radio overlay, the villain portrait's missing surface, the debrief
split), `sim-guard` (§10), `content-validator`.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code and the text can reach a player today |
| `schema` | the field is specced and does not exist |
| `engine` | the surface is an approved target with no implementation — the radio overlay's art, `eva`, `bark`, a `debrief` that can tell a win from a loss, a line bound to a wave or a `SimEvent`, a hard-coded toast string |

Every status row's rightmost cell is one of those three words. The count is §12.

**`schema` is empty again.** The engine slice of 2026-09-03 landed `say` on
`triggers[]` and `objectives[]`, `say_on_fail` on objectives, `dispatch` /
`aftermath` / `debrief`, `remove`, and `group` on `starting_force`. Verified in
this worktree rather than recalled: `$defs.say` takes `speaker ∈ {shai, idit,
net, enemy}` and `text` ≤ 240 (`data/schemas/mission.schema.json`); `dispatch`,
`aftermath` and `debrief` are each `maxLength: 240`; `sayNotice`
(`ui/mission-notice.ts:27`) routes a line into the notice feed; `hud.ts:555`
appends `aftermath` to the victory banner; `ui/menu.ts:387` prints `debrief` on
the end screen. What is still `engine` is what a line *looks* like, not whether
it arrives.

### 0.2 The two voices, and why the JSON reads as one

The deploy screen and the commander bar carry one speaker at a time and the
`briefing` is one string, so a briefing is Shai's orders voice end to end with
**Idit named in the third person** wherever the picture is hers — *"Intel puts
the local commander at the north hide"* is her, in his mouth. The `say` lines
carry a real `speaker` field, so inside a mission she speaks in her own name.

- **In this sheet** each briefing is a two-hander, one speaker per beat.
- **In the JSON** it is one string.

Beat boundaries below are **not editorial**. They are what `briefingBeats`
(`packages/app/src/ui/loading.ts`; at most two sentences and 240 characters,
whichever comes first) produces, checked with a port of that function (§12).

### 0.3 The order the player meets the story in, which is not the order it is written in

Measured in `packages/app/src/main.ts`, not assumed. `await loading.done()` sits
at **line 1078** and `hud.announce(name, "N primary objective(s)", mission.dispatch)`
at **line 1284**. The deploy screen — the briefing — therefore comes **before**
the title card, so **`dispatch` is read after the orders, not before them.**

Two consequences, and both are authorial rather than defects:

1. Act III's atrocity, told in mission I's `dispatch`, lands *after* Shai has
   already given the order to cross. That is survivable and arguably right — the
   orders voice does not depend on it — but it is why **mission I's live text
   never names Jubran Hallaq** (§1.4).
2. A longer title-card hold for a mission carrying a `dispatch` is still
   `render-vfx` work (`ui/motion.ts:49`, `holdMs = 900`, dismissed on any input).

### 0.4 The villain

**Jubran Hallaq**, KDF file name **FERRY** — *the smuggler* (`storyline.md`
§2.3). Not a commander: a logistician with guns. The charges under Beit Sahwan
and the rockets over Tel Marum came up his road, which is why he is last.

He is characterised by **placements and by an absence**: bank patrols that turn
before they are told, raiders who break off at sixty per cent, a lieutenant who
runs at forty, a quartermaster in a house, and finally a man who will not walk
twenty tiles east to leave his own gate. The player meets him in four stages, in
this order and no other:

1. **What he does to the people on his road** — the `dispatch` on mission I.
   Told, off-map, no method, no scene. The only place in Act III the atrocity is
   *stated*.
2. **His name in an order** — mission III's briefing, applied this pass: *Jubran
   Hallaq's man on this ground.* First live mention in the tree.
3. **His organisation** — mission III's and IV's objective labels: his local
   commander, his quartermaster.
4. **Himself** — mission V, in his own gateway. `kill_gate_rpg`'s shipped label
   stays *"Kill or capture whoever is holding the gate"* verbatim, because the
   reveal belongs to the `say` and not to the objective list.

**He speaks once in the whole act** (design §10 O-I: *one line, about the road,
never about the player*), and it is **not** on his death. §5.7 records the
placement and why it differs from the design's table.

### 0.5 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality,
accent, idiom or insignia, on either side. The **Rif Cells are technicals,
raids, smuggling and mobility, and nothing else** (GDD §2). No line in this
sheet gives a population to a faction: the carriers at the ford, the herders on
the cattle track and the families in the village are people who live on a road
two armies are fighting over, and the text says only that. Hallaq's own hold on
them is stated as *haulage*, which is what the doctrine word "smuggling" means
when it reaches a person.

The mosque is written as **the one building on this map nobody may touch** and
never as anybody's. If the lead ever renames the structure type
(`storyline.md` §0.3 O10), no line here has to change: none of them names it as
a faith, only as a protection.

This binds hardest on the `eva` and `bark` rows (§7, §7a), which are the ones
that would be **recorded** — retrofitting the rule means throwing audio away
(GH-110).

### 0.6 Option C, and how it is marked

`design.md` §1 recommends **Option C** — one failable primary in each of I–IV,
so a passive player is lost rather than stuck. **The lead has not chosen.** Four
objectives and their lines therefore do not exist yet:

| mission | objective | type |
|---|---|---|
| I | `get_the_carriers_out` | `evacuate_before(refuge, 3, 300)` |
| II | `burn_store` | `raze(pasture, 300)` |
| III | `get_the_herders_out` | `evacuate_before(refuge, 3, 300)` |
| IV | `evac_families` → `"primary": true` | already ships, one word |

Every row that depends on one is marked **[C]** in its overlay column. Its
*status* is still `live`, because the surface exists — what is missing is the
objective, and that is `mission-author`'s. **Nothing in this sheet was applied to
the JSON for Option C.** If the lead takes Option A instead, delete the **[C]**
rows and the sheet still reads: the briefings, the labels, the villain ladder and
both endings are all independent of it.

### 0.7 What Act III can say and what it still cannot

| | |
|---|---|
| **new since Act II** | nothing. The vocabulary is exactly the 2026-09-03 slice |
| **still impossible** | **a wave cannot speak.** Act III is *the wave town* — nine authored `waves` entries and four `spawn` triggers, thirteen reinforcement events across five missions — and reinforcements arriving is the most legible thing that happens in any of them. Five rows here are `engine` for it (§10 G-D) |
| **still impossible** | a trigger cannot fire on an **objective** or on a `SimEvent`, so every line bound to "the depot is down" or "the D9 is dead" is on a clock or on `casualties_pct` instead (§10 G-E) |
| **still half-built** | `debrief` is one string on **every** end, so it cannot tell a win from a loss. Ten paired lines below are `engine` for that reason alone (§10 G-C) |
| **still silent** | **a civilian reaching the refuge produces no notice at all in a real mission.** `describeMissionEvent` (`main.ts:248`) has no `evacuated` case and falls to `default: return null`; the `civilian evacuated — n of m out` line at `main.ts:1844` is the **sandbox `&civ` path only**. Act III scores on civilians in one shipped mission and three under Option C (§10 G-H) |
| **new here, and it is a picture** | **Hallaq's portrait ships and has no surface.** `assets/ui/portraits/jubran_hallaq.png` exists; `speakerPortrait` (`ui/hud-model.ts:221`) returns `undefined` for anything but `shai`/`idit`, and `speakerPlate` returns the literal `ENEMY`. His one line renders as `— <text>`, tone `warn`, beside a hatch (§10 G-F) |

---

## 1. `wadi_halam_1_fords` — Wadi Halam I — The Fords

`recon` · **Lieutenant Colonel** · `wadi_halam_basin` · requires **R** ·
produces **R M C I** (+**E** under C) · `target_minutes` 6.
**Act III opens here, and so does Hallaq — told, never seen.**

### 1.1 `name`

`Wadi Halam I — The Fords` — **unchanged.**

### 1.2 `dispatch` — the act's opening — 218 chars — **not applied** (`mission-author`)

> *The corridor into Naharin has carried somebody else's war for four years, and
> the people who live on it carry it by hand. One hamlet stopped hauling for
> Jubran Hallaq last spring. Nobody on that road has stopped since.*

Narrator, story voice, off-map. Three things it does deliberately.

**It names the atrocity by its effect and never by its method** — Act I's own
ceiling (`beit_sahwan/design.md` §10 O-D: name what happened, never depict it),
and the same construction as `beit_sahwan_breach`'s *"four villages left outside
the wire."* What happened to that hamlet is not on the page and must not be put
there.

**The hamlet has no name.** `storyline.md` §2.4(1) forbids coining a toponym
without a `world.json` entry, and one is not needed: the sentence is about a
rule, not a place.

**It is the first and last time the word "carry" is innocent.** *Carried
somebody else's war* / *carry it by hand* / *stopped hauling* — the act's whole
economy in three verbs, and mission I's Option C primary is four people doing
exactly that at the south ford.

### 1.3 `briefing` — 402 chars, 3 beats — **unchanged**

`design.md` §5.1: *re-brief* **y — new fields only**. *"The shipped `briefing` is
good and its last line, 'Do not chase what runs,' is the Rif characterised in
four words. **Do not touch it.**"* It is not touched.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Naharin opens at the wadi. Two fords cross it, and the Rif who work this corridor disperse the moment they are seen — so the job tonight is to see them first. | 158 |
| 2 | **Shai** | Push a screen across the tree line, build the picture, and hold the ford watch for four minutes while the column crosses behind you — riders will keep coming at the crossing out of the east the whole time you sit on it. | 219 |
| 3 | **Shai** | Do not chase what runs. | 23 |

Idit / Shai / Shai — the picture, the plan, the cost. Beat 3 is twenty-three
characters and is the best closing beat in the tree: it is a rule of engagement
written as tactics, which is the whole house style.

**One seam, recorded and not cut.** Beat 1's last clause, *"so the job tonight is
to see them first,"* is an order inside Idit's beat. It is shipped, it is
measured, and the design says new fields only.

**Under Option C it gains a clause and does not gain a beat** — see §1.5. That
clause is **not applied**, because the objective it describes does not exist.

### 1.4 Objectives

| id | as an order | as a toast | status |
|---|---|---|---|
| `picture` | Identify four dispersal sites | `OBJECTIVE COMPLETE — Identify four dispersal sites` | live |
| `take_ford` | Hold the ford watch for four minutes | `OBJECTIVE COMPLETE — Hold the ford watch for four minutes` | live |
| `screen_out` | Stay in the field for the first three minutes twenty | `OBJECTIVE COMPLETE — Stay in the field for the first three minutes twenty` | live |
| **[C]** `get_the_carriers_out` | **Get three carriers off the south ford to the refuge** | `OBJECTIVE COMPLETE — Get three carriers off the south ford to the refuge` | live |

`picture` is kept because *"dispersal sites"* is already Idit's word and not a
soldier's — the design says so and it is right. `get_the_carriers_out` is built
in the tree's own idiom for this type (`beit_sahwan_breach`: *"Get two families
inside the wire before the ring closes"*; Umm Zeitoun IV: *"Get three porters off
the depot ground to the northern shelf"*) — a count, a place they are leaving, a
place they are going.

**`take_ford` is NOT changed, and the design permits either.** §5.1 says it *may*
name the crossing as Hallaq's. It does not, for a reason that is measured rather
than tasteful: the briefing is read **before** the `dispatch` (§0.3), so a label
naming him would be the campaign's first mention of the man — in a toast, before
the story voice has said who he is. He is named in mission III's briefing
instead, in an order, where the player has three missions of his road behind him.

### 1.5 **[C]** The one clause the briefing gains under Option C — **not applied**

Inserted before *"Do not chase what runs."*, as its own sentence. Measured through
the same port of `briefingBeats`: 402 → **498 chars, beats 158 / 219 / 119**, so
beats 1 and 2 are untouched and the closing beat gains a sentence in front of
the rule it already carries:

> *Four of them are carrying for him at the south ford tonight and cannot get off
> it on their own. Do not chase what runs.*

`mission-author` applies this **only if** `get_the_carriers_out` is authored in
the same commit. A briefing that describes an objective the mission does not have
is worse than no clause at all.

### 1.6 `debrief` — 117 chars — **not applied**

> *The fords are the only two crossings in forty tiles. Whatever happened
> tonight, the corridor still runs through them.*

Honest on a win and on a loss, which is what `debrief` requires today (§10 G-C).
The two fords being the only vehicle crossings is a map fact (`design.md` §3.3),
not a flourish.

### 1.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Wadi Halam I — The Fords` · *2 primary objectives* (*3* under C) | `hud.announce`; shipped | live |
| mission start | `dispatch` | narrator | §1.2 | wants a longer title-card hold; `render-vfx` | live |
| mission start | `brief` | Idit / Shai | beats 1–3, §1.3 | one speaker on screen today | live |
| `objective(picture, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify four dispersal sites` | shipped | live |
| `objective(picture, complete)` | `radio` | **Idit** | "Four sites and not one of them is a position. Nobody digs in on a road he means to keep using — this is a haulage route with guns parked along it." | `objectives[].say`; the act's thesis, said once, on the fourth identification | live |
| `objective(take_ford, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the ford watch for four minutes` | shipped | live |
| `objective(take_ford, complete)` | `radio` | **net** | "Ford watch held. The column is across the wadi." | `objectives[].say`; the brigade net, flat, no name | live |
| `objective(screen_out, complete)` @200 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for the first three minutes twenty` | shipped | live |
| `screen_out` failing | — | — | **cannot happen.** `survive_until` is not one of the three types `checkEnd` can fail, so a `say_on_fail` here would never fire and must not be authored | authorial silence | live |
| **[C]** `objective(get_the_carriers_out, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get three carriers off the south ford to the refuge` | **[C]** | live |
| **[C]** `objective(get_the_carriers_out, complete)` | `radio` | **Shai** | "Four of them off the ford and out of the corridor. They were on his road because somebody put them on it; tonight they are not." | `objectives[].say`; **[C]** the restrained half of his voice, said once | live |
| **[C]** `objective(get_the_carriers_out, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get three carriers off the south ford to the refuge` | **[C]** the only way to lose this mission; loses it | live |
| **[C]** `objective(get_the_carriers_out, failed)` @300 s | `radio` | **Shai** | "The crossing shut with them still on it. We were eight tiles away and looking the other way." | `objectives[].say_on_fail`; **[C]** the one place in Act III `say_on_fail` earns its keep on a *choice* rather than a clock | live |
| `evacuated` (a carrier reaches the refuge) | `toast` | system | **nothing at all** | `describeMissionEvent` has no `evacuated` case (§10 G-H) | engine |
| trigger `bank_reacts` → `the bank patrol turns for the ford` | `toast` | system | `enemy reacts (the bank patrol turns for the ford)` | id renamed for prose (§9); `zone_entered(ford_watch)` → `commit bank` | live |
| same trigger | `radio` | **Idit** | "Both bank patrols have turned for the north ford. They did not wait to be told and they will not stay to be fought." | `triggers[].say`; the first time the player sees Rif mobility used as a *decision* | live |
| wave t=90 s (2 `moto_rpg` from `rif_south` → `ford_south`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded string | live |
| wave t=90 s | `radio` | Idit | "Motorcycles off the southern track. Ninety seconds of quiet and then something every fifteen — that is the cadence, and it does not change." | a wave cannot carry a `say` (§10 G-D) | engine |
| wave t=210 s (2 `moto_rpg` from `rif_east` → `ford_north`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=225 s (1 `technical` + 1 `moto_rpg` from `rif_south` → `ford_south`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=225 s | `radio` | Idit | "Both fords at once now. They are not trying to hold the crossing — they are pricing the four minutes you agreed to sit on it." | a wave cannot speak (§10 G-D) | engine |
| `SimEvent destroyed`, the `recon_drone` | `radio` | Idit | "Drone is down. Whatever it had not looked at yet, somebody walks to." | needs a trigger that can watch the sim (§10 G-E) | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(any)` | `debrief` | narrator | §1.6 | end screen, above the rating | live |
| `missionEnd(victory)` | `debrief` | Shai | "Four sites, and every one of them empty by the time anybody looked twice. That is the picture: there is nothing here to take, only a road." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "We have part of the picture and they have the crossing. Whatever we did not see tonight goes east tomorrow." | needs the win/lose split | engine |

---

## 2. `wadi_halam_2_laager` — Wadi Halam II — Grazing Ground

`foothold` · **Lieutenant Colonel** · requires **R** (+**I**, §10 G-B) ·
produces **R M C** (+**I**) · `target_minutes` 7 · economy 400 + 120/min.
**The mission where the player's own supply line is the subject.**

### 2.1 `name`

`Wadi Halam II — Grazing Ground` — **unchanged.**

### 2.2 `briefing` — 385 chars, 2 beats — **unchanged**

`design.md` §5.2: *re-brief* **n**. *"That is correct, measured (cover 1,
`COVER_HIT` 1 → .375) and in Shai's voice. Keep verbatim."*

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | Push through to the pasture and dig in while the engineers lay the crossing behind you. The ground is terraced — bunds run across the pasture in bands, real cover if you hold it, and the Rif know the ground as well as you do. | 225 |
| 2 | **Shai** | Technicals and motorcycles will come at the pump house from every direction in waves. Accumulate five minutes of uncontested pasture and the corridor is yours. | 159 |

**This is the one briefing in the act with no Idit beat, and that is the
characterisation.** II produces no `locate`, requires none and asks no question:
`storyline.md` §2.2 has her *choosing which questions are worth a life* by Act
III, and the first thing she declines to ask about is a field. Nothing is added
to give her a line here. She is deliberately absent and returns in III.

**Under Option C it gains one clause** — see §2.3, **not applied**.

### 2.3 **[C]** The clause the briefing gains under Option C — **not applied**

Appended as a fourth sentence. Measured: 385 → **505 chars, beats 225 / 159 /
119** — beats 1 and 2 untouched, one new beat:

> *There is a shed on the pasture's western edge and it is his forward store — it
> comes down inside the same five minutes.*

Again: applied **only** in the commit that authors `burn_store`.

### 2.4 Objectives

| id | as an order | as a toast | status |
|---|---|---|---|
| `hold_pasture` | Hold the pasture for five minutes | `OBJECTIVE COMPLETE — Hold the pasture for five minutes` | live |
| `keep_ford` | Keep the ford watch clear | `OBJECTIVE COMPLETE — Keep the ford watch clear` | live |
| **[C]** `burn_store` | **Burn the forward store at the pump house inside five minutes** | `OBJECTIVE COMPLETE — Burn the forward store at the pump house inside five minutes` | live |

Both shipped labels are unchanged. `burn_store` says *inside five minutes*
because it shares the hold's clock exactly, which is the decision the objective
exists to force.

### 2.5 `debrief` — 113 chars — **not applied**

> *A laager is a place that can be found. That is the trade — they know where you
> are, and you know they are coming.*

Honest either way, and it is the foothold phase stated as a bargain rather than
as a win.

### 2.6 Trigger table

II has **no `enemy.waves` at all**: its four reinforcements are `spawn` triggers,
so the player reads `enemy reacts (wave_1)` and not `enemy reinforcements`. That
is why the id rewrites matter more here than anywhere else in the town — four of
the nine are in this mission.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Wadi Halam II — Grazing Ground` · *1 primary objective* (*2* under C) | shipped | live |
| mission start | `brief` | Shai | beats 1–2, §2.2 | Idit deliberately absent | live |
| mission start | `dispatch` | — | **none, and there must not be one.** The act's dispatch is mission I's; a second turns an opening into narration | authorial silence | live |
| `objective(hold_pasture, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the pasture for five minutes` | shipped | live |
| `objective(hold_pasture, complete)` | `radio` | **net** | "Five minutes of pasture, uncontested. The crossing is laid and the corridor is open behind you." | `objectives[].say` | live |
| `objective(keep_ford, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Keep the ford watch clear` | shipped; goes `active → complete` under C because the extra fight holds a unit there long enough | live |
| **[C]** `objective(burn_store, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Burn the forward store at the pump house inside five minutes` | **[C]** | live |
| **[C]** `objective(burn_store, complete)` | `radio` | **Idit** | "The shed was a forward store — fuel, crates, a manifest. Half of what was in it was routed on to Sur. This ground is not the end of his road; it is the middle of it." | `objectives[].say`; **[C] T10 delivered as an object rather than as a line** | live |
| **[C]** `objective(burn_store, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Burn the forward store at the pump house inside five minutes` | **[C]** the only way to lose this mission | live |
| **[C]** `objective(burn_store, failed)` @300 s | `radio` | **Shai** | "The shed is standing and the pasture is ours. One of those was the mission." | `objectives[].say_on_fail`; **[C]** | live |
| trigger `wave_1` → `riders out of the north` @60 s | `toast` | system | `enemy reacts (riders out of the north)` | id renamed (§9); `spawn` 2 `technical` at `rif_north` | live |
| trigger `wave_2` → `riders out of the south` @150 s | `toast` | system | `enemy reacts (riders out of the south)` | id renamed; `spawn` 2 `moto_rpg` + 1 `technical` at `rif_south` | live |
| trigger `wave_3` → `technicals off the east track` @240 s | `toast` | system | `enemy reacts (technicals off the east track)` | id renamed; `spawn` 2 `technical` at `rif_east` | live |
| trigger `wave_4` → `the last of the motorcycles` @330 s | `toast` | system | `enemy reacts (the last of the motorcycles)` | id renamed; `spawn` 3 `moto_rpg` at `rif_south` | live |
| trigger `wave_3` | `radio` | Idit | "Third compass point in four minutes. There is no direction this pasture is safe from, which is why they gave you a field and not a hill." | four `spawn` triggers already carry `say`; **only one is used**, so the feed is not a chatline | engine |
| trigger `picket_withdraws` → `the raiders break off east` | `toast` | system | `enemy reacts (the raiders break off east)` | id renamed; `casualties_pct(60)` → `withdraw_to rif_east` | live |
| same trigger | `radio` | **Idit** | "Sixty per cent and they are breaking off east. That is not a rout — mobility is their armour, and they will be back on the same trucks inside a week." | `triggers[].say`; **the line that stops the player reading a withdrawal as a win** | live |
| `built` (an `inf_squad` bought with the 120/min) | `toast` | system | `reinforcement deployed — inf_squad` | prints the raw unit id; Act I **G-D**, still open | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(any)` | `debrief` | narrator | §2.5 | | live |
| `missionEnd(victory)` | `debrief` | net | "Pasture held, crossing laid. The brigade is east of the wadi for the first time in this war." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Shai | "We did not keep five minutes of a field. The engineers are not laying a crossing under that." | needs the win/lose split | engine |

---

## 3. `wadi_halam_3_counterraid` — Wadi Halam III — The Cattle Track

`buildup` · **Lieutenant Colonel** · requires **R I** · produces **R M C I**
(+**E** under C) · `target_minutes` 6. **The only build-up in the war, and it is
a raid. And the one mission edited in the briefing this pass.**

### 3.1 `name`

`Wadi Halam III — The Cattle Track` — **unchanged.**

### 3.2 `briefing` — 537 chars, 3 beats — **CHANGED, and applied**

`design.md` §5.3: *re-brief* **y — text only**. *"The shipped briefing names 'the
local commander' and never says **whose**. One clause: he is Hallaq's. Everything
else … is the best sentence in the town and stays verbatim."*

**Two things changed and one of them is a defect nobody had found.**

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** → **Idit** | The pasture is ours; now we raid back. Intel puts the local commander at the north hide — **Jubran Hallaq's man on this ground**, riding a technical he will not hesitate to run in if he has to. | 189 |
| 2 | **Idit** → **Shai** | A second position dug in to the south covers the cattle track. Kill the commander, get eyes on the southern hide, and hold the bunds for five minutes. | 150 |
| 3 | **Shai** | The moment the commander goes down, what is left of the local cell will come back at the bunds twice more to retake them. Catching the commander himself is a mobility problem, not a firepower one. | 196 |

**Change 1 — the clause.** *"— Jubran Hallaq's man on this ground,"* is inserted
into the shipped sentence. It is the campaign's **first live naming of the
villain of Act III**, it arrives in an order rather than in narration, and it
costs 37 characters.

**Change 2 — and this is the one worth reading.** The shipped briefing's last
sentence was **289 characters long**, and `briefingBeats` cannot split a
sentence: `if (held.length > 0 && …) flush()` requires a held sentence before it
will break, so a single sentence over the limit becomes **a beat over the
limit**. Measured with a port of that function across every mission in the tree:
`wadi_halam_3_counterraid` was **the only briefing in the game with a beat above
240 characters**, and no test or gate sees it. The sentence is now three
sentences. **Every word survives**, the clause the design protects
(*"catching the commander himself is a mobility problem, not a firepower one"*)
survives verbatim bar its opening capital, and the mission's beats are now
189 / 150 / 196.

The general defect is recorded as §10 **G-A** — it will recur the next time
somebody writes a long sentence, and nothing will say so.

**The Shai→Idit seam inside beats 1 and 2 is shipped, not introduced here.** Two
sentences per beat and two voices means one beat has to carry both; splitting
them would need sentence lengths this text does not have, and the design says
text only.

### 3.3 Objectives

| id | as an order | as a toast | status |
|---|---|---|---|
| `kill_amir` | **Kill or capture Hallaq's local commander** | `OBJECTIVE COMPLETE — Kill or capture Hallaq's local commander` | live |
| `hold_bunds` | Hold the bunds for five minutes while the counter-raid comes in | `OBJECTIVE COMPLETE — Hold the bunds for five minutes while the counter-raid comes in` | live |
| `mark_hides` | Get eyes on the southern hide | `OBJECTIVE COMPLETE — Get eyes on the southern hide` | live |
| **[C]** `get_the_herders_out` | **Get three herders off the cattle track to the refuge** | `OBJECTIVE COMPLETE — Get three herders off the cattle track to the refuge` | live |

**`kill_amir` is CHANGED and applied**: *"Kill or capture the local commander"* →
*"Kill or capture Hallaq's local commander"*. It names a **position in an
organisation**, never a person — the man has no name in the fiction and must not
acquire one. *Kill or capture* is kept because it is the construction mission V
uses for Hallaq himself, and the three of them are meant to read as a ladder.

`mark_hides` is kept verbatim; the design says so and it is the one mark in Act
III that is actually **spent** (in this same mission, under C, and in the
shipped chain from mission I).

### 3.4 `debrief` — 85 chars — **not applied**

> *The only breathing room the brigade gets in this war, and it was spent going
> forward.*

True on a win and on a loss, and it is the phase note the whole campaign turns
on: Act I has no build-up at all and Act III's is a raid.

### 3.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Wadi Halam III — The Cattle Track` · *2 primary objectives* (*3* under C) | shipped | live |
| mission start | `brief` | Shai / Idit | beats 1–3, §3.2 | **applied this pass** | live |
| `objective(kill_amir, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill or capture Hallaq's local commander` | **applied this pass** | live |
| `objective(kill_amir, complete)` | `radio` | **Idit** | "That is Hallaq's man on this ground. He does not know where the rockets went; he knows which nights the fords were clear, and that is what puts us at the depot." | `objectives[].say`; what a lieutenant is *worth*, which is the only reason the act keeps going east | live |
| `objective(hold_bunds, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the bunds for five minutes while the counter-raid comes in` | shipped | live |
| `objective(hold_bunds, complete)` | `radio` | **net** | "Bunds held. Both counter-raids are off the pasture." | `objectives[].say` | live |
| `objective(mark_hides, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get eyes on the southern hide` | shipped | live |
| `objective(mark_hides, complete)` | `radio` | **Idit** | "That is the hide, and I am not asking for a second one. What is left in those bunds we can read off the ground afterwards; the herd on the track cannot wait for me to be sure." | `objectives[].say`; **Idit declining to ask — the act's one statement of it, and it is never repeated** | live |
| **[C]** `objective(get_the_herders_out, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get three herders off the cattle track to the refuge` | **[C]** | live |
| **[C]** `objective(get_the_herders_out, complete)` | `radio` | **net** | "Herd and herders are off the track and inside the refuge line." | `objectives[].say`; **[C]** flat, because this is the one of the three evacuations that is nobody's fault | live |
| **[C]** `objective(get_the_herders_out, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get three herders off the cattle track to the refuge` | **[C]** loses the mission | live |
| **[C]** `objective(get_the_herders_out, failed)` @300 s | `radio` | **Shai** | "The track is shut with them still on it. We chose to raid this ground; they only live on it." | `objectives[].say_on_fail`; **[C]** the middle rung of design §10 O-H's escalation of *whose fault it is* | live |
| `evacuated` (a herder reaches the refuge) | `toast` | system | **nothing at all** | §10 G-H | engine |
| trigger `amir_runs` → `the commander runs for the east track` | `toast` | system | `enemy reacts (the commander runs for the east track)` | id renamed (§9); `casualties_pct(40)` → `withdraw_to rif_east` | live |
| same trigger | `radio` | **Shai** | "He is running for the east track and he will not stop. Take him if the shot is there — do not take the bunds off the map to chase him." | `triggers[].say`; the scripted withdrawal turned into characterisation, and it is *"Do not chase what runs"* charged for the second time | live |
| wave t=90 s (2 `technical` from `rif_east` → `pump_house`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=200 s (2 `moto_rpg` + 1 `technical` from `rif_south` → `pump_house`) | `toast` | system | `enemy reinforcements — 3 unit(s) inbound` | hard-coded | live |
| wave t=200 s | `radio` | Idit | "Second counter-raid, and it is going for the pump house rather than for you. They want the pasture back more than they want the fight." | a wave cannot speak (§10 G-D) | engine |
| `SimEvent contact` on `wh_hide_south` when it was **not** pre-marked | `radio` | Idit | "The southern hide was live. If the drone had been eight tiles further south last week, that would have been a map reference instead of an ambush." | needs a sim-watching trigger (§10 G-E); it is the act's carry-over said aloud | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(any)` | `debrief` | narrator | §3.4 | | live |
| `missionEnd(victory)` | `debrief` | Idit | "One commander, one hide and a track full of people. Two of those we were asked for." | needs the win/lose split | engine |
| `missionEnd(defeat)` | `debrief` | Shai | "He is east with his cell and the bunds are theirs again. We spent the only quiet week of the war on it." | needs the win/lose split | engine |

---

## 4. `wadi_halam_4_village` — Wadi Halam IV — Wadi Halam

`clearance` · **Lieutenant Colonel** · requires **R** (should be **R I**, §10
G-B) · produces **R M C E** · `target_minutes` 7 · `flagged_zones: ["mosque_block"]`,
`fail_below: 40`. **The atrocity shown.**

### 4.1 `name`

`Wadi Halam IV — Wadi Halam` — **unchanged.** The town naming the mission is
right: it is the only mission in the act whose object is a place people live in.

### 4.2 `briefing` — 464 chars, 3 beats — **unchanged**

`design.md` §5.4: *re-brief* **n**. *"'heavy ordnance reaches further across open
ground than it does between walls, so mind what you call in' is shipped, correct
and in Shai's voice. Keep verbatim."*

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | The village is inhabited and the mosque is under protection — heavy ordnance reaches further across open ground than it does between walls, so mind what you call in. | 165 |
| 2 | **Idit** | A cache guard and three cells hold the houses; a pair of technicals waiting at the south hide will run for the village the moment you make contact. | 147 |
| 3 | **Shai** | Clear and hold the village, kill or capture whoever is guarding the cache, and get the families out to the refuge before the fighting closes the road. | 150 |

Shai / Idit / Shai. Beat 1 is **restraint written as ballistics** and it is the
second-strongest ROE line in the tree after Beit Sahwan III's clinic warning: it
never says firing near the mosque is wrong, it says what heavy ordnance *does* on
open ground. Change nothing.

**Beat 3 keeps *"whoever is guarding the cache"* while the objective label now
says *"the quartermaster holding Hallaq's cache"*, and the mismatch is
deliberate.** The order stays anonymous because Shai is giving it before anybody
has been identified; the objective list is Idit's column and it says who he is.

### 4.3 Objectives

| id | as an order | as a toast | status |
|---|---|---|---|
| `take_village` | Clear and hold the village for 20 seconds | `OBJECTIVE COMPLETE — Clear and hold the village for 20 seconds` | live |
| `kill_cache_guard` | **Kill or capture the quartermaster holding Hallaq's cache** | `OBJECTIVE COMPLETE — Kill or capture the quartermaster holding Hallaq's cache` | live |
| `evac_families` | Shepherd the families to the refuge before the road closes | `OBJECTIVE COMPLETE — Shepherd the families to the refuge before the road closes` | live |

**`kill_cache_guard` is CHANGED and applied**: *"Kill or capture whoever is
guarding the cache"* → *"Kill or capture the quartermaster holding Hallaq's
cache"*. Per the design: name him as **his quartermaster**, by function, never as
a name. It keeps the *Kill or capture* construction that V uses for Hallaq
himself, so the ladder — his commander, his quartermaster, him — reads across
three missions.

`evac_families`'s label is unchanged and needs nothing: it is the best objective
text in the town. Under Option C **one word changes and it is not in this
column** — `"primary": false` → `true`, which is `mission-author`'s and is the
cheapest correct change anywhere in Act III (design §10 O-C: take it whatever
happens to the rest).

### 4.4 `debrief` — 156 chars — **not applied**

> *A garrisoned house comes down or it stays garrisoned; there is no third way to
> clear one. What that costs is on the rating. What it was for is on the order.*

Honest on a win and on a loss. It carries `design.md` §5.4's central measurement
— of IV's twenty-three lost points, **eighteen are the price of the order and
five are carelessness** — without printing numbers that would be wrong on a
defeat. The numbers themselves go in the victory line, which cannot be authored
yet (§10 G-C).

### 4.5 Trigger table

IV has **no waves at all** — it is the one Wadi Halam mission with no
reinforcement clock, a fixed problem with a deadline, and the deadline is the
families.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Wadi Halam IV — Wadi Halam` · *2 primary objectives* (*3* under C) | shipped | live |
| mission start | `brief` | Shai / Idit | beats 1–3, §4.2 | | live |
| `objective(take_village, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear and hold the village for 20 seconds` | shipped | live |
| `objective(take_village, complete)` | `radio` | **net** | "Village is held. Four houses, four cells, and none of them left it." | `objectives[].say`; flat, because taking the village is the *smaller* half of this mission | live |
| `objective(kill_cache_guard, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill or capture the quartermaster holding Hallaq's cache` | **applied this pass** | live |
| `objective(kill_cache_guard, complete)` | `radio` | **Idit** | "That is not a fighter, that is a book-keeper with a launcher. What he was holding names the depot east of here and says how much of it is still full." | `objectives[].say`; the line that turns mission V from a map into a consequence | live |
| `objective(evac_families, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Shepherd the families to the refuge before the road closes` | shipped | live |
| `objective(evac_families, complete)` | `radio` | **Shai** | "Every one of them is at the refuge." | `objectives[].say`; **the most important line in the game and it is thirty-four characters** — see §4.6 | live |
| `objective(evac_families, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Shepherd the families to the refuge before the road closes` | already reaches `failed` today; loses the mission only once `"primary": true` **[C]** | live |
| `objective(evac_families, failed)` @300 s | `radio` | **Idit** | "The road is shut and there are still families inside it. Nine did not come in at First Light. Somebody has to keep saying the number, and it is not going to be you." | `objectives[].say_on_fail`; **Idit says the number Shai will not** — see §4.6 | live |
| `evacuated` (a family reaches the refuge) | `toast` | system | **nothing at all** | §10 G-H, and this is the mission it costs the most | engine |
| `roe` deduction, fire into `mosque_block` | `toast` | system | hard-coded `roeNotice` copy | five of IV's twenty-three points, measured | live |
| trigger `reserve_commits` → `the technicals at the south hide run for the village` | `toast` | system | `enemy reacts (the technicals at the south hide run for the village)` | id renamed (§9); `first_contact` → `commit reserve` to `village_center` | live |
| same trigger | `radio` | **net** | "Two technicals off the south hide, running for the village centre." | `triggers[].say`; the net, because this one is a fact and not a meaning | live |
| a structure levelled inside `village` | `toast` | system | hard-coded `roe` copy; **nothing names the building** | `render-vfx`; the player is billed and not told what for | engine |
| `SimEvent destroyed` on the last garrisoned house | `radio` | Shai | "That is the last of the four. Everything still moving in there lives here." | needs a sim-watching trigger (§10 G-E) | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(any)` | `debrief` | narrator | §4.4 | | live |
| `missionEnd(victory)` | `debrief` | Shai | "Twenty-three points. Eighteen of them were the order and five were how we carried it out, and only the five are mine." | needs the win/lose split; **this is where the 18/5 split is said** | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The village is standing and so are they. Whoever was in those houses is still in them." | needs the win/lose split | engine |

### 4.6 The two lines on `evac_families`, and why they are not both Shai's

`design.md` §5.4 assigns **both** the completion and the failure to Shai. This
sheet gives the completion to Shai and **the failure to Idit**, and the reason is
shipped precedent rather than preference.

`beit_sahwan_breach` — the mission this one answers — already ships exactly this
pairing on exactly this objective type:

```
"say":         { "speaker": "shai", "text": "Two in. Get the gate shut behind them." },
"say_on_fail": { "speaker": "idit", "text": "The ring is closed. Whatever is still outside it is outside it." }
```

Shai counts the ones who got in. Idit says what happened to the rest. That is
`storyline.md` §2.1(3) and §2.2(6) written as data, seventeen missions earlier,
and Act III's job is to close it rather than to invent a new shape for it.

**Why the completion line is seven words.** First Light spent a paragraph of
briefing on the families who would not come in — *"nobody is coming back for them
afterwards"* — and got two of eleven. The answer to that is not a speech. It is
Shai confirming a count and saying nothing else, and the player who remembers
mission one supplies the rest.

**Why the failure line carries the number.** Nine is the only number in the
campaign nobody has ever said aloud. Shai cannot say it — §2.1(3) is explicit —
so if it is ever said it must be hers, it must be at a failure, and it must be
said once. This is the once. The last clause, *"it is not going to be you,"* is
not an accusation: it is a division of labour between two people who were in the
same room that morning.

---

## 5. `wadi_halam_5_depot` — Wadi Halam V — Break the Depot

`clearance` · **Lieutenant Colonel → Colonel at the campaign's end, not inside
the mission** · requires **R** · produces **R M C** · `target_minutes` 7 ·
economy 400 + 80/min · `fail_below: 40`. **Hallaq's end, and the campaign's.**

### 5.1 `name`

`Wadi Halam V — Break the Depot` — **unchanged.**

### 5.2 `briefing` — 1,223 chars, 8 beats — **CHANGED by four words, and applied**

`design.md` §5.5: *re-brief* **y — a new field and one line**. *"The
D9-and-the-village passage is the finest bait writing in the tree and must not be
touched."* It is not touched. The only edit is in the first sentence.

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Shai** | Seven structures inside **Hallaq's** depot, one unarmed bulldozer, and a choice of route. Mind which one you take. | 110 |
| 2 | **Shai** | The straight line east runs through the village, and a D9 levels whatever it halts beside — the houses will come down one at a time with nobody ordering it, and each one is judged. | 221 |
| 3 | **Shai** | The road south of the village costs you a little time and nothing else. The D9 cannot defend itself and it is the slowest thing on the map — escort it, do not race it. | 167 |
| 4 | **Idit** | An RPG team holds the gate gap and three gun trucks sit inside the wire; a second RPG team is dug in dead centre of the depot. | 126 |
| 5 | **Idit** | The gun trucks cannot scratch the D9's armour, but either RPG team will put a rocket straight through its blade if it works unescorted. | 135 |
| 6 | **Idit** | Motorcycles are staged to the east and will come down on the column the moment you push that way, and more will keep arriving from the east and south the whole time the charges are going in. | 190 |
| 7 | **Shai** | Levelling the depot is not the end of it — the Rif want the ground back, and the column has to hold the rubble for four minutes against everything still coming. | 160 |
| 8 | **Shai** | Raze the depot, kill or capture whoever is holding the gate, hold what is left, and keep the column intact. | 107 |

Beat 2 contains the sentence *"The mosque is not a target at any price"* as its
second half; the beat splitter keeps it with the D9 sentence, which is exactly
where it belongs.

**The edit, and what paid for it.** *"the walled depot"* → *"Hallaq's depot"*.
Four words, and it makes the object of the last mission of the war a **person's
property** rather than a place — which is Act III's question stated in the first
clause of the last briefing. It is **shorter by three characters**, so the
briefing stays at the top of the shipped 385–1,225 band instead of setting a new
ceiling. Nothing is lost: the enclosure is named twice more in beats 4 and 8
(*"inside the wire"*, *"the gate gap"*), which is where a player actually needs
it.

**What is deliberately not said.** The briefing does **not** say Hallaq is at the
gate. Knowing the depot is his does not tell you he is standing in it, and the
reveal is `kill_gate_rpg.say`'s (§5.4).

### 5.3 Objectives — all four **unchanged**

| id | as an order | as a toast | status |
|---|---|---|---|
| `raze_depot` | Raze the depot inside five minutes | `OBJECTIVE COMPLETE — Raze the depot inside five minutes` | live |
| `kill_gate_rpg` | Kill or capture whoever is holding the gate | `OBJECTIVE COMPLETE — Kill or capture whoever is holding the gate` | live |
| `hold_depot` | Hold the depot for four minutes once it is down | `OBJECTIVE COMPLETE — Hold the depot for four minutes once it is down` | live |
| `no_bleed` | Stay in the field for the first five minutes | `OBJECTIVE COMPLETE — Stay in the field for the first five minutes` | live |

`kill_gate_rpg` is **kept verbatim** on the design's instruction and on its own
merit: *"whoever is holding the gate"* is a voice naming a person without naming
him, and it is the last objective the campaign gives the player.

### 5.4 The `say` lines, and the campaign's closing line

`raze_depot.say` is the line that closes all three acts and it is Idit's, because
the road was her question from the first `locate` in the Marj:

> **Idit** — 203 chars — *"Seven buildings, and everything in them came through
> here first. The charges under Beit Sahwan came up this road. So did the rockets
> that fell on the north for a week before anybody could say from where."*

The last clause is `tel_marum_1_recon`'s own `dispatch` returned as a fact —
*"nobody could say from where"* — which is the only callback in the act and the
only one it needs.

`kill_gate_rpg.say` is Shai's and it is flat:

> **Shai** — 154 chars — *"That is Jubran Hallaq, in his own gateway. Everything
> that ever came up this road came up it for him, and he would not walk twenty
> tiles east to leave it."*

No triumph, no summary, no sentence about what it means. The whole act has been
building to a logistician who would not leave his own gate, and the line reports
that he did not.

### 5.5 `debrief` — 130 chars — **not applied**

> *Nineteen points of this depot is the order itself. Whatever the number below
> says, part of it was decided before the column moved.*

**This is the last text on the last screen of the campaign, and it is deliberately
not an ending.** The end screen prints `debrief` above `ROE 81 · 4 unit(s)
walking out`, so the debrief's only job is to tell the player what that 81 is:
`raze_depot` requires seven structures down and those seven are worth exactly
nineteen points (`design.md` §1, measured). **Break the Depot cannot be played
above 81, and that number is the point.** The ending itself is the `aftermath`
(§5.6), which is where the campaign's last *line* belongs — not to Shai, not to
Idit, and not to the rating.

### 5.6 `aftermath` — Act III and the campaign close — **both variants, the lead has not chosen**

`aftermath` is live and victory-only (`ui/hud.ts:555`, appended to the victory
banner). `design.md` §6.4 and `storyline.md` §5 both recommend **Option 1**; O9
is open and this sheet takes no decision.

#### Option 1 — *"Ari Actual"* — 234 chars — **recommended by the design**

> *The corridor is cut. Brigade signed the file at first light, the same hour of
> the same day it started. They are giving you the Ari'im — all of it, not a
> company in a yard. Idit brings the callsign down herself: Ari Actual. Five
> stars.*

Carries what §6.2 requires: the corridor cut · the brigade given rather than a
company · Idit as the one who says it · the five stars · and it lands on a
**person**. *"At first light"* is the campaign's own first mission used as a time
of day, which is the only pun in eighteen missions and is allowed exactly once.
*Ari Actual* is an already-approved fictional asset
(`2026-08-21-commander-brief-design.md`), so the ending **reuses canon rather
than inventing it**.

**Why it is the stronger of the two, in one sentence:** the player finishes on
ROE 81 because the mission ordered him to level seven buildings, and this is the
only ending that makes that 81 the reason he is being given the brigade rather
than a disappointment.

#### Option 2 — *"The Quiet Ground"* — 216 chars

> *They took the wire down at Beit Sahwan this morning. Nobody fired a shot to
> make that happen; you spent a year not firing them. The slip came in the post —
> five stars, no ceremony — and a road you can drive at night.*

Carries §6.3's list: the wire down at Beit Sahwan · nobody fired a shot ·
the slip in the post rather than a ceremony · a road you can drive at night. It
is the stronger ending on **restraint**, which is Act III's own question, and the
weaker on **revenge** — it closes the loop on the families rather than on the men
who took them.

**Take Option 2 only if Naharin is the last content anyone authors.** Option 1
leaves a callsign a Kharat Badlands epilogue could open on and finally displays
`commander.json`'s Colonel entry, which today is the default for missions after
`wadi_halam_5_depot` and there are none. Option 2 closes the door, which is a
fine thing for an ending and a bad thing for a project at v0.27.

**Neither changes `commander.json`.** Do not move the Lieutenant Colonel entry's
`until_mission` back to `wadi_halam_4_village` to make him a Colonel during the
last mission: that is a promotion inside a town, which act-boundary policy
forbids. The promotion exists in the `aftermath` and nowhere else.

### 5.7 Jubran Hallaq's one line — 165 chars — and why it is not on his death

On `harass_commits` (`first_contact` → `commit harass` to `depot_gate`),
`speaker: "enemy"`, and it is the only line any villain speaks in Act III.

> *Everything that ever crossed this basin crossed it on that road. The yard can
> be rebuilt in a season. The road was here before the yard and it will be here
> after it.*

About the road; never about the player; **no second person anywhere in it**
(design §10 O-I). It fires as he releases the motorcycles onto the column, so it
is bound to a thing he *does*.

**A choice recorded, because the design reads the other way.** `design.md` §5.5
puts `say` (**shai**) on `kill_gate_rpg` and a **net** line on `harass_commits`;
§10 O-I says Hallaq's one line should be on his own death or capture. A trigger
and an objective each carry one `say`, so both cannot happen. This sheet gives
him the trigger and leaves the death to Shai, for three reasons:

1. **He is a logistician, and a logistician's last word is about freight, not
   about himself.** The line says the road outlives the depot, which is true —
   `raze_depot` levels seven buildings and does not touch a tile of road.
2. **A villain who makes a speech as he dies is a different genre.** Adhal was
   given the same treatment in Act II for the same reason
   (`tel_marum/narrative.md` §7.5): he speaks before anybody has found him and
   goes out in silence.
3. **`sayNotice` renders `enemy` with no name at all** — `— <text>`, tone `warn`
   — so the line reads as *intercepted* rather than addressed, which only works
   if he is not answering something.

The net line the design wanted on `harass_commits` is therefore **dropped**, not
moved: `enemy reacts (the motorcycles come down on the column)` already tells the
player what happened, and it is verbatim what beat 6 of the briefing promised, so
the toast confirms a warning rather than printing an identifier.

**Where his portrait would show, and why it does not.**
`assets/ui/portraits/jubran_hallaq.png` ships (58.2 KiB) and this is the one line
in the campaign that would draw it — the commander bar's `.rl-cmd__face`.
`speakerPortrait` cannot resolve anything but `shai` and `idit` and
`speakerPlate` returns the literal string `ENEMY`, so today he speaks as a hatch
labelled ENEMY (§10 G-F). Cheapest unrealised story surface in the tree.

### 5.8 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Wadi Halam V — Break the Depot` · *3 primary objectives* | shipped | live |
| mission start | `brief` | Shai / Idit | beats 1–8, §5.2 | **applied this pass** | live |
| mission start | `dispatch` | — | **none.** The act's dispatch is mission I's | authorial silence | live |
| `objective(raze_depot, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Raze the depot inside five minutes` | shipped | live |
| `objective(raze_depot, complete)` | `radio` | **Idit** | §5.4 — "Seven buildings, and everything in them came through here first. The charges under Beit Sahwan came up this road. So did the rockets that fell on the north for a week before anybody could say from where." | `objectives[].say`; **the line that closes all three acts** | live |
| `objective(raze_depot, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Raze the depot inside five minutes` | the only way to lose V today; loses it | live |
| `objective(raze_depot, failed)` @300 s | `radio` | **Shai** | "Five minutes, and the depot is standing. Whatever we brought to bring it down is not going to bring it down now." | `objectives[].say_on_fail`; states the real failure — a dead D9 and a dead `demo_squad` make the primary impossible | live |
| `objective(kill_gate_rpg, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill or capture whoever is holding the gate` | shipped, verbatim | live |
| `objective(kill_gate_rpg, complete)` | `radio` | **Shai** | §5.4 — "That is Jubran Hallaq, in his own gateway. Everything that ever came up this road came up it for him, and he would not walk twenty tiles east to leave it." | `objectives[].say`; **the villain's end, said flatly** | live |
| `objective(hold_depot, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the depot for four minutes once it is down` | shipped | live |
| `objective(hold_depot, complete)` | `radio` | **net** | "Depot ground held, four minutes. Nothing came back onto it." | `objectives[].say` | live |
| `objective(no_bleed, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for the first five minutes` | shipped | live |
| `no_bleed` gets no `say` | — | — | **deliberate.** A `survive_until` cannot fail, and a fourth voice line in the busiest mission in the act is chatter | authorial silence | live |
| trigger `harass_commits` → `the motorcycles come down on the column` | `toast` | system | `enemy reacts (the motorcycles come down on the column)` | id renamed (§9); confirms beat 6 rather than printing an identifier | live |
| same trigger | `radio` | **enemy** | §5.7 — "Everything that ever crossed this basin crossed it on that road. The yard can be rebuilt in a season. The road was here before the yard and it will be here after it." | `triggers[].say`; `sayNotice` gives `enemy` no name, tone `warn` | live |
| same trigger | `radio` portrait | enemy | `jubran_hallaq.png` on `.rl-cmd__face` | `speakerPortrait` returns `undefined` for `enemy` (§10 G-F) | engine |
| wave t=45 s (1 `technical` + 1 `moto_rpg` from `rif_south`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=100 s (1 `technical` + 2 `moto_rpg` from `rif_east`) | `toast` | system | `enemy reinforcements — 3 unit(s) inbound` | hard-coded | live |
| wave t=160 s (1 `technical` + 3 `moto_rpg` from `rif_south`) | `toast` | system | `enemy reinforcements — 4 unit(s) inbound` | hard-coded | live |
| wave t=160 s | `radio` | Idit | "Escalating each time and always at the gate. Four minutes of this and then they stop counting and start arriving." | a wave cannot speak (§10 G-D) | engine |
| wave t=220 s (1 `technical` + 2 `moto_rpg` from `rif_south`) | `toast` | system | `enemy reinforcements — 3 unit(s) inbound` | hard-coded | live |
| a house levelled by the D9 in the village | `toast` | system | hard-coded `roe` copy; **nothing names the building or says the D9 did it** | `stepDemolition` levels what it halts beside and no notice says which; `render-vfx` | engine |
| a house levelled by the D9 | `radio` | Shai | "It came down beside him. Nobody ordered that and it is still on the rating." | needs a sim-watching trigger (§10 G-E); **the bait's own line, and it cannot be authored** | engine |
| `SimEvent destroyed`, the `dozer_d9` | `radio` | Shai | "Dozer is gone. There is 586 of logistics in the pool and twenty-six seconds of build time, and the clock does not stop for either." | needs a sim-watching trigger (§10 G-E) | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `aftermath` | narrator | §5.6, Option 1 or Option 2 | victory banner; **the campaign's last line** | live |
| `missionEnd(any)` | `debrief` | narrator | §5.5 | end screen, above the rating | live |
| `missionEnd(victory)` | `debrief` | Shai | "Nineteen points, and every one of them was the order. There is no carelessness on this rating." | needs the win/lose split; deliberately subordinate to the `aftermath` | engine |
| `missionEnd(defeat)` | `debrief` | Idit | "The depot is standing and the road is open. Whatever came up it last month comes up it next month." | needs the win/lose split | engine |

---

## 6. Ambient lore — secondary locations

Ground the player crosses that no objective names. Every line fires once and
stops the game for nobody. Every marker, zone and count below was read from
`data/maps/wadi_halam_basin.json` this session, not from the design: 12 markers
and 7 zones resolve, the map is 48×48, `"terrain": "green"`, and it declares
**no `elevation` grid and no `tunnels` key** — which is why `collapse` is
unavailable for the whole town and why three of Act III's failable primaries are
`evacuate_before`.

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the west pasture | `kdf_crossing [3,24]`, x0–6 | `radio` | Shai | "Six tiles of open grass between the start line and the trees. There is no cover on this side and there was never meant to be — nobody defends a bank they cross twice a day." | engine |
| the poplar gallery | x7–12, 228 tiles of `o` | `radio` | Idit | "Two hundred and twenty-eight tiles of poplar along the water, one tile of cover apiece. It hides a motorcycle perfectly and stops nothing." | engine |
| the north ford | `ford_north [10,15]` | `radio` | Idit | "North ford. One of two places in forty tiles where anything with wheels gets across this wadi, and both of them are on their side of the trees." | engine |
| the south ford | `ford_south [10,32]` | `radio` | Idit | "South ford, seventeen tiles down from the north one. There is no third crossing and there never has been — that is the whole geometry of this mission." | engine |
| the ford watch | zone `ford_watch [7,12,6,24]` | `radio` | Shai | "Six tiles wide and twenty-four deep. You are not holding a crossing, you are holding the length of river both crossings are on." | engine |
| the bunds | 67 tiles of `1`, 20 of `n` | `radio` | Shai | "Dry-stone bunds in bands across the pasture. One level of cover on the low ones and two on the terrace walls, and it is the difference between a squad and a casualty list." | engine |
| the pump house | `pump_house [17,20]` | `radio` | Idit | "The pump house is the only built thing on the pasture, so it is the only thing on the pasture worth a map reference — to us and to them." | engine |
| the north hide | `hide_north [22,9]` | `radio` | Idit | "The north hide is a hollow with a technical parked in it and a man sitting on the technical. He is not dug in because he does not intend to be there long." | engine |
| the south hide | `hide_south [22,38]` | `radio` | Idit | "Southern hide, three tiles of ambush laid on the cattle track. It is the one position in this basin that appears in two different missions." | engine |
| the village | zone `village [25,15,9,18]` | `radio` | Idit | "Four houses, two sheds and a lane, and people in all of it. Nobody in there chose which side of a corridor to be born on." | engine |
| the mosque block | zone `mosque_block [28,22,4,4]`, 9 tiles of `m` | `radio` | Shai | "Thirty points, and it is the only structure on this map the demolishers will refuse on their own. Everything else here comes down if something halts beside it." | engine |
| the depot wall | 41 `wall` tiles, x34 / x42 / y16 / y31 | `radio` | Idit | "Forty-one tiles of wall and every one of them is worth nothing. The wall is not the depot — the seven buildings inside it are." | engine |
| the depot | zone `depot [35,17,7,14]`, `depot_gate [34,24]` | `radio` | Idit | "Three warehouses, two concrete stores and two sheds. Nineteen points of restraint, and the mission's own orders spend all of it." | engine |
| the east road | zone `east_road [42,22,6,4]` | `radio` | Idit | "The track east of the depot is the only piece of this map nothing has ever been asked to do anything about. It is where the corridor goes." | engine |
| the Rif approaches | `rif_north [44,9]`, `rif_east [44,24]`, `rif_south [44,39]` | `radio` | Idit | "Three approaches off the eastern edge and they have used all three in one afternoon. There is no fourth, and they have never needed one." | engine |
| the refuge | `civ_refuge [22,36]` / zone `refuge [19,34,8,6]` | `radio` | Shai | "The refuge is a fold of ground south of the track with nothing in it. That is the point of it — it is the one place on this map nobody wants." | engine |
| a civilian reaches the refuge | zone `refuge` | `toast` | system | `one family into the refuge` — proposed replacement for the silent `evacuated` (§10 G-H) | engine |

**`east_road` is authored and used by no mission** (design §3.1) — it is the only
zone on the map nothing names, and it is the natural condition for T13 (§8). Its
lore line above is written on the assumption that it stays unused; if
`level-scripter` binds it, the line moves to the twist table.

---

## 7. EVA announcements — the Act III delta

**The set is Act I's** (`beit_sahwan/narrative.md` §8), written once for the whole
campaign and not per town: the brigade net, flat, unhurried, no name, no accent,
no idiom, no prowords beyond *Actual*. `storyline.md` §2.4(5) binds hardest here
— **the doctrine rule heads that sheet before a single line is recorded**
(GH-110), because retrofitting it means throwing the audio away.

`tools/validate_audio.py`'s `KNOWN_EVENTS` is six weapon and impact events, so
`pnpm validate:audio` **cannot accept a voice file at all**. The gate widens
first (§10 G-G).

Act III adds four events the earlier sets do not cover. Everything else is
reused.

| event | line | status |
|---|---|---|
| `evacuated` (side 2 reaches the refuge) | "Civilians clear." | engine |
| a demolisher levels a structure **nobody targeted** (`stepDemolition`'s two-tile auto-search) | "Structure down. Not ordered." | engine |
| a `demolisher` unit is destroyed while a `raze` clock is running | "Demolition asset lost." | engine |
| an enemy group `withdraw_to` fires while the player is still in contact | "Enemy breaking contact." | engine |

**"Civilians clear" and not "civilians saved."** The net reports a state, never a
verdict — and on this map the same word has to cover four families walking to a
fold of ground and a herd being moved off a track.

## 7a. Barks

**Not written here, deliberately, and for the same reason as Acts I and II.**
Barks are keyed by unit **role**, never per unit (GH-110), and the
doctrine-not-people rule has to head that sheet **before** a line exists, because
it constrains accent, idiom and phrasing — the things that carry ethnicity in a
recording and the things that cannot be edited out of one. Act III fields nine
KDF roles and five Rif roles; a role-keyed set for both is its own deliverable
and must not be smuggled in at the bottom of a briefing sheet.

One Act III-specific warning for whoever writes it: **`dozer_d9` has no weapon
and no bark precedent anywhere in the tree**, and it is the one unit in the game
whose acknowledgement would be heard immediately before a building falls on
somebody's house. Its role's set is the one to write last and to write carefully.

---

## 8. The twist lines — T9 to T13

Classification is `level-scripter`'s; the lines are this sheet's. The "mechanic"
column is what is needed *besides* a voice.

| # | mission | twist | speaker | line | mechanic | status |
|---|---|---|---|---|---|---|
| **T9** | I | *The riders are carrying.* One dispersing technical carries civilians, not fighters | Idit | "Hold the shot on the second technical. Whatever is riding in the back of that one is not shooting at anybody." | **ENGINE, and `storyline.md` §3.3's "expressible today as passengers" is wrong** — `embarkPassengers(id, p.passengers, side)` gives passengers the **carrier's** side, so a civilian on an enemy technical spawns on side 1, never enters `civIds`, and costs nothing to kill. §10 **G-I** | engine |
| **T10** | II | *The pump house is the cache.* What you hold is what he wants back | Idit | §2.6 — "The shed was a forward store — fuel, crates, a manifest. Half of what was in it was routed on to Sur. This ground is not the end of his road; it is the middle of it." | **none under Option C** — the shed is a `structures[]` entry inside the shipped `pasture` zone and `raze(pasture, 300)` is the objective. Under Option A it degrades to a `say` on `hold_pasture` and stays true | live |
| **T11** | III | *He is worth more talking.* `wh_hvt_amir` routs rather than dies and can be taken | Idit | §3.5 — "That is Hallaq's man on this ground. He does not know where the rockets went; he knows which nights the fords were clear, and that is what puts us at the depot." | **none, and do not build the `capture` version.** `capture` reads only `livingIn(z,0)` and `contestedIn(z)`, so a zone at `rif_east` completes whether he is standing in it or dead in it. The shipped `eliminate_hvt` label already says *Kill or capture*; the label is the twist (§10 G-J) | live |
| **T12** | IV | *The cache guard is one of ours.* A KDF soldier taken at First Light, left holding the cache | Idit | **not written for Act III, deliberately** — the fallback puts him in the `civilians` block, where the player *cannot shoot him*, so the cruelty becomes "the autocannon that clears the house kills him", which is Beit Sahwan III's lesson repeated | needs a friendly-tagged HVT and a `capture` that requires its target alive — §10 **G-J**. `design.md` §1 Option B measured the fallback working end to end; take it **after** C, not instead of it | engine |
| **T13** | V | *The corridor runs both ways.* A wave arrives from the west, out of ground the player already took | net | "Something came across the ford behind you. That crossing has been ours since the first night and it was never ours at night." | **expressible today** — `zone_entered(east_road)` (the zone nothing uses) → `spawn` at `ford_south` or `pump_house`, **never** at `kdf_crossing`, which is occupied at `start()` and must clear `assertGroundClear`. The line is `net` because nobody has seen it yet | live |

**T10 is the one to build first** and it is not the cheapest: it is the only
twist in the act that turns a *hold* into a *statement*, and Option C already
pays for the whole of it — one raised `shanty`, one garrison, one objective row.
T13 is the cheapest and should follow it, because `east_road` has been on the map
since the green-basin spec waiting for exactly this.

---

## 9. Trigger ids — proposals, because an id is player-facing prose

A trigger's `id` is printed verbatim as `enemy reacts (<id>)`
(`main.ts:265`), and `mission.schema.json` puts no pattern on it.
**`level-scripter` owns these ids; none of the renames is applied.**

**Nine ship, not eight.** The brief that commissioned this sheet said eight; the
five mission files declare **nine** triggers between them (I one, II five, III
one, IV one, V one) and every one of them is a debug identifier on screen today.
All nine are proposed below.

| mission | shipped id | proposed | why |
|---|---|---|---|
| I | `bank_reacts` | **`the bank patrol turns for the ford`** | it is what the player is about to watch happen, and it names the direction so he can act on it rather than merely be told |
| II | `wave_1` | **`riders out of the north`** | II's four reinforcements are `spawn` **triggers**, not `waves`, so they print `enemy reacts (wave_1)` and not `enemy reinforcements` — this is the mission where the raw ids cost the most |
| II | `wave_2` | **`riders out of the south`** | |
| II | `wave_3` | **`technicals off the east track`** | names the vehicle, because the third wave is the one that changes what the player needs |
| II | `wave_4` | **`the last of the motorcycles`** | *the last of* is a promise the mission keeps: there is no fifth |
| II | `picket_withdraws` | **`the raiders break off east`** | *break off* rather than *withdraw* or *retreat* — Rif doctrine is disengagement, and the word must not read as a rout |
| III | `amir_runs` | **`the commander runs for the east track`** | the id the brief asks about. A sentence about a person doing something, in the register of the briefing's *"a mobility problem, not a firepower one"*, and it names the direction |
| IV | `reserve_commits` | **`the technicals at the south hide run for the village`** | the longest of the nine and worth it: it names where they came from, which the player has not looked at yet |
| V | `harass_commits` | **`the motorcycles come down on the column`** | verbatim what briefing beat 6 already promised, so the notice feed **confirms a warning** instead of printing an identifier |

**The `enemy reacts` prefix is honest on all nine.** Every trigger in Act III is
an enemy act — a commit, a spawn, a withdrawal — so the hard-coded prefix never
lies here. Act I's six friendly `deliver_*` tutorial triggers remain the only
place it does.

---

## 10. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | **A single sentence longer than 240 characters becomes a beat longer than 240 characters, silently.** `briefingBeats` flushes only when something is already held, so it cannot split a sentence. `wadi_halam_3_counterraid` shipped a **289-character beat** and was the only briefing in the tree over the limit; **fixed in this pass**, but nothing prevents the next one. `loading.test.ts` tests the splitter, not the content | a check over `data/missions/*.json` in `tools/validate_data.mjs`, or one spec that runs `briefingBeats` across every shipped briefing and asserts the limit | `content-validator` |
| **G-B** | **The harness and the game disagree about Act III's ledger.** `wadi_halam_2_laager` neither requires nor produces `intel.marked_positions`, and `playtest.ts` chains each mission on the *produced* ledger of the one before, so **III has been measured with an empty marked list since the town shipped**. `main.ts:1759` merges instead, so the app does not have the bug. `wh_aa_east` is the tag that satisfies `validate_data.mjs` | declare the key on II (design §5.2). Leave IV and V alone — no tag in either is produced by an earlier mission, so `requires` there would be aspiration (design §10 O-F) | `mission-author` |
| **G-C** | **`debrief` is one string on every mission end**, where `aftermath` is victory-only, so the campaign's closing screen cannot tell a win from a loss. **Ten** written lines here are `engine` for that and no other reason | `debrief_victory` / `debrief_defeat` (or `debrief: { victory, defeat }`), read by `showEndScreen` off `missionEnd.result` | `sim-guard` + `render-vfx`; `storyline.md` §7 **G11** |
| **G-D** | **A wave cannot speak**, and **Act III is the wave town** — nine `waves` entries plus four `spawn` triggers, thirteen reinforcement events across five missions. Five rows here are `engine` for it. The `timer_s` workaround is not available: `do` is required | `say?: {speaker, text}` on the wave item, emitted with the existing `wave` event | `sim-guard`; design §9 **G12** |
| **G-E** | **A trigger cannot fire on an objective or on a `SimEvent`.** Every reaction in Act III is on a clock or on `casualties_pct`, so the bait's own line — *the house came down beside him and nobody ordered it* — cannot be authored at the moment it happens. Five rows are `engine` for it | two `on.kind`s: `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds); the tutorial's `await` already gates on every `SimEvent` | `sim-guard`; design §9 **G8** |
| **G-F** | **A villain portrait has no surface**, and Act III is where it costs a picture. `assets/ui/portraits/jubran_hallaq.png` ships; `speakerPortrait` (`ui/hud-model.ts:221`) resolves only `shai`/`idit` and `speakerPlate` returns the literal `ENEMY` | a `villains` map in `commander.json` keyed by front, and one branch each in `speakerPlate`/`speakerPortrait`. The `enemy` speaker value already exists | `mission-author` (data) + `render-vfx`; design §9 **G18** |
| **G-G** | **`pnpm validate:audio` cannot accept a voice file.** `KNOWN_EVENTS` is six weapon and impact events. Every `eva` row in §7 and every voice line in the act is blocked on the gate widening **before** anything is recorded | a non-weapon set kind and its events; the licence and source-URL checks stay | `content-validator`; GH-110, design §9 **G4** |
| **G-H** | **A civilian reaching the refuge is silent in a real mission.** `describeMissionEvent` (`main.ts:248`) has no `evacuated` case and falls to `default: return null`; the `civilian evacuated — n of m out` note at `main.ts:1844` is the sandbox `&civ` path. Act III scores on civilians in one shipped mission and **three under Option C, two of them fatally** | one `case 'evacuated'` in `describeMissionEvent` | `render-vfx`; Act I **G-B**, still open |
| **G-I** | **A passenger cannot be a civilian**, so **T9 is not expressible** — `embarkPassengers(id, p.passengers, side)` gives passengers the carrier's side, a civilian on an enemy technical spawns on side 1, never enters `civIds`, and killing it costs nothing. This contradicts `storyline.md` §3.3 | a `side` override on a nested passenger placement, or `civilians.groups[].mounted_in: <tag>` | `sim-guard`; design §9 **G16** |
| **G-J** | **No friendly-tagged HVT, and `capture` does not require its target alive** (the branch reads only `livingIn(z,0)` and `contestedIn(z)`). T12's real form and T11's "taken alive" both degrade to a label | a `side`/`friendly` field on a placement scored as a catastrophe on death; and an optional `target` on `capture` that must be alive inside the zone | `sim-guard`; design §9 **G6** |
| **G-K** | **`evacuate_before` cannot name a group** — it counts `civFlight.evacuatedCount` against `count` and nothing else. All three Act III evacuations are therefore *counts*, and no objective can say that a **particular** person must come out | an optional `group` on the objective, counting only civilians in that group | `sim-guard`; design §9 **G17** |
| **G-L** | **The radio overlay does not exist.** Every `say` row lands in the notice feed and on the commander bar with no portrait frame, no speaker plate art and no voice; `shai`, `idit`, `net` and `enemy` are told apart by an uppercase string | frame, plate and portrait slot | `render-vfx`; **not blocking** — the lines arrive |
| **G-M** | **A town cannot say it is unwritten**, so at the end of the war the board flies three brigade flags and **two of them are earned on one town of three** — `khan_rafid` and `deir_amun` carry `"missions": []` and contribute 0/0. This is the only campaign-complete state the game has, and it is two-thirds false | `planned: true` on a town, excluded from `regionProgress` | `sim-guard` + `app`; design §9 **G5** |
| **G-N** | **`campaignSummary` reads a dead key** (`main.ts:140`, `roe.cumulative_rating`, documented as written by nothing), so the menu never shows campaign ROE — and **both endings in §5.6 are written on a number the shell cannot display** | read `campaignRoe(ledger).mean` | `app`; design §9 |
| **G-O** | **The `civilians` sprite sheet is missing and Act III is now the arc most damaged by it.** `civilians` is the one unit type with no `SPRITE_MAP` entry and no sheet, so on `?renderer=pixi` or under `&nomesh` a civilian walks, is shot at and evacuates **while drawing nothing**. Option C makes three Act III missions score on civilians | the sheet (`tools/units/kit.py` → `render_team.py`, gate `pnpm validate:assets`) **and** a `SPRITE_MAP` entry, which no gate checks | `blender-art`; design §10 O-G |

---

## 11. GDD amendments

**Canon did not move, and §11 needs no edit this pass.** Checked clause by clause
against what Act III does:

- *"Shai Hammai … promoted across the campaign to Colonel — the KDF's own
  five-star insignia … Promotions are act-level beats."* True: he is a Lieutenant
  Colonel in all five missions (`commander.json`, `until_mission:
  wadi_halam_5_depot`, inclusive) and a Colonel only in the `aftermath`.
- *"Idit Zohar … provides the intelligence in every mission … she never gives an
  order."* True of every `say` in this sheet, checked one by one. Act III adds a
  refinement rather than a contradiction: she also declines to ask (§3.5).
- *"One villain per front … introduces an arch-terrorist through an atrocity in
  its opening mission, keeps him present through what he does, and ends with him
  captured or killed."* True: `dispatch` at I, placements through II–IV,
  `eliminate_hvt(wh_gate_rpg)` at V.
- *"The story reaches the player through … `dispatch` … `aftermath` …
  `debrief` … and mid-mission `say` lines."* True and current; the Act II sheet
  corrected this paragraph on 2026-09-03 and nothing has moved since.

**No version bump, because nothing was applied.**

### 11.1 Two proposals, neither applied, both the lead's

**(a) Name the three villains in §11.** Offered by Act I's sheet and again by Act
II's; this is the third time, and the shipped text has now moved past the
document — `beit_sahwan_breach` names Sahim, and as of this pass three Wadi Halam
fields name Hallaq.

> In §11, *"…characterised by his doctrine (the digger, the observer, the
> smuggler) and named in the fictional register the towns use."* becomes
> *"…characterised by his doctrine and named in the fictional register the towns
> use — Nadir Sahim in the Marj, Karim Adhal in Sur, Jubran Hallaq in Naharin,
> filed by Idit's section as SPADE, LANTERN and FERRY."*

+1 sentence, no decision moved: `storyline.md` §0.2 records all three names as
decided on 2026-09-03.

**(b) §11 already commits to one of the two endings, and O9 is open.** The
sentence *"…and ends the war a Colonel with the brigade"* is Option 1 stated as
canon. Under Option 2 the brigade goes home and the ground is handed back, and
that clause becomes false.

> **If the lead takes Option 2**, the fix is three words: *"…and ends the war a
> Colonel."*

**Not applied in either direction**, because applying it would answer O9 — which
is the lead's decision and is the first one Act III needs (design §10 O-B).
Recorded here so that whoever answers it knows the GDD is one clause behind.

**`storyline.md` needs no edit.** §3.3's Act III table, §2.3's FERRY entry and
§5's two endings are all still true of what is written here. The one row that is
now stale in a *different* document is `design.md` §5.5's speaker assignment for
`harass_commits` and `kill_gate_rpg`; §5.7 records the swap and its reasons
rather than silently taking it.

---

## 12. Row counts

Every table row in this file whose last cell is `live`, `schema` or `engine`,
counted by script rather than by eye.

**164 rows** carry one.

| status | rows | what they are |
|---|---|---|
| `live` | **114** | `toast` 47 · `radio`, i.e. a `say` on a trigger or an objective, 25 · objective labels 18 · `brief` 5 · `title` 5 · `debrief` 5 · `dispatch` 3 · twist rows 3 · `aftermath` 1 · and **4 rows recording a deliberate silence** (`screen_out` and `no_bleed`, neither of which can fail; the second and third `dispatch`, which must not exist) |
| `schema` | **0** | none. Every field Act III needs exists |
| `engine` | **50** | ambient lore 17 · paired win/lose `debrief` 10 · `radio` 10 · `toast` 6 · `eva` 4 · twist rows 2 (T9, T12) · Hallaq's portrait on the commander bar 1 |

**50 `engine` rows**, and not one of them is blocked on a *field*. They are
blocked on five things and only five: a **radio overlay with portraits** (G-L,
and G-F for the one row that would draw Hallaq), a **voice layer** (G-G, and the
audio gate widens first), a **`debrief` that can tell a win from a loss** (G-C,
10 rows), **a line bound to a wave or to a `SimEvent`** — the ten `engine`
`radio` rows split exactly five and five — and the **silent `evacuated` event**
(G-H, 3 of the 6 `engine` toasts). Every one of the 17 ambient rows is `engine`
for two of those together: no event to fire on, and no surface to fire into.

**30 %** of the writing in this act still reaches nobody. Act I was 47 %, Act II
31 %; the difference between Act I and the two since is the engine slice of
2026-09-03, and what keeps Act III from going lower is that **Naharin is the wave
town** — five `engine` rows are wave lines, in a town where reinforcements
arriving is the most legible thing that happens.

---

## 13. What was applied to `data/missions/` this pass, and what was not

**Applied — three files, five fields, all inside `name` / `briefing` /
`objectives[].text`:**

| file | field | change |
|---|---|---|
| `wadi_halam_3_counterraid.json` | `briefing` | *"— Jubran Hallaq's man on this ground,"* inserted (design §5.3, *re-brief y, text only*); the 289-character final sentence split into three, every word kept, the protected clause verbatim. 505 → 537 chars, beats 152/62/**289** → 189/150/196 |
| `wadi_halam_3_counterraid.json` | `objectives[kill_amir].text` | *"Kill or capture the local commander"* → *"Kill or capture Hallaq's local commander"* |
| `wadi_halam_4_village.json` | `objectives[kill_cache_guard].text` | *"Kill or capture whoever is guarding the cache"* → *"Kill or capture the quartermaster holding Hallaq's cache"* |
| `wadi_halam_5_depot.json` | `briefing` | *"the walled depot"* → *"Hallaq's depot"* (design §5.5, *one clause naming Hallaq*). 1,225 → **1,223** chars, so the briefing stays at the top of the shipped band instead of setting a new ceiling |

**Not applied, and why:**

- `wadi_halam_1_fords` and `wadi_halam_2_laager` — **untouched**. I is *re-brief
  y, new fields only* and the new field is `dispatch`, which is
  `mission-author`'s; II is *re-brief n*.
- `wadi_halam_4_village`'s briefing — *re-brief n*, kept verbatim.
- `take_ford`'s optional rename — declined, with the measured reason in §1.4.
- Every `dispatch`, `aftermath`, `debrief`, `say` and `say_on_fail` in this sheet
  — those fields exist and are live, but they are **not** among the three fields
  this agent may write. `mission-author` applies them.
- All four Option C objectives and the one-word `"primary": true` on
  `evac_families` — `mission-author`'s, and the lead has not chosen the option.
- The nine trigger id renames — `level-scripter`'s.

**Verification run this pass:**

- `pnpm -s validate:data` → *data gate passed: 87 file(s) validated, palette keys
  resolved*.
- `npx vitest run packages/app/src/ui/loading` → **21 passed**.
- A port of `briefingBeats` across all five Wadi Halam briefings and then across
  every mission in `data/missions/`: **0 failing beats**, every beat ≤ 240
  characters and ≤ 2 sentences, every total inside 385–1,225 (402 / 385 / 537 /
  464 / 1,223). Before this pass the same script returned **1 failing beat**, and
  it was the only one in the tree.
- Every authored string in this sheet measured against the schema's
  240-character limit, by script rather than by eye: **94 quoted `say` lines,
  longest 203** (`raze_depot.say`), and **13 story-voice blockquotes, longest
  234** (Option 1's `aftermath`). **Nothing is over.**
- The two Option C briefing variants (§1.5, §2.3) beat-checked the same way:
  **158 / 219 / 119** and **225 / 159 / 119**, every beat ≤ 240 and ≤ 2
  sentences.

**What `mission-author` applies from here**, in order of what unblocks the most:
`wadi_halam_1_fords.dispatch` (§1.2) — without it Act III has no villain until
mission III; the ledger fix on II (§10 G-B), because until it lands every
measurement of III is a thin-recon measurement; the fourteen `say` and four
`say_on_fail` lines; the five `debrief` strings; and last, on mission V only, the
`aftermath` the lead chooses, which is the last line of the war.
