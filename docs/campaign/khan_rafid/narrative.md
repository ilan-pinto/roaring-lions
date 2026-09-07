# Khan Rafid and Deir Amun — Narrative Trigger Sheet

**Act I · The Marj Strip · Ashwar Front · towns two and three of three, after
Beit Sahwan. Shai Hammai is a Captain throughout all six missions and is not
promoted here — the third star belongs at the end of this arc, and §0.6 records
that it is currently awarded five missions early.**

**Date:** 2026-09-08 · **Status:** authored text waiting on two things — the lead
signing `design.md` §8, and `mission-author`, who owns
`data/missions/khan_rafid_*.json` and `data/missions/deir_amun_*.json`, every
field in them, the two map files, `world.json` and `commander.json`. **Nothing in
this pass was applied to any file.** The six mission JSONs do not exist; neither
map exists; `khan_rafid` and `deir_amun` are in `world.json` with empty mission
arrays and in `mission.schema.json`'s `town` enum, and that is all. Writing text
into a tree that cannot hold it is how a sheet starts lying about itself.

**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`,
censused this session. Every schema shape below was read from
`data/schemas/mission.schema.json` rather than recalled; every seat count,
speed, weapon and `collateral_risk` from `data/units/kdf/**`; the beat rule from
`packages/app/src/ui/loading.ts`; `describeMissionEvent`, `sayNotice` and
`renderCommander` from `packages/app/src`; the shipped objective-label
conventions from all twenty-one mission files at once. **Every briefing below was
split with a port of `briefingBeats`, not counted by eye**, and the beat tables
print what that function returns. Route, tile, walk and ROE figures are **quoted
from `design.md` §3.1, §3.2 and §5 and not re-derived** — that document measured
them and labels each as a draft for `level-scripter` to re-measure through the
real `FlowField`.

**Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md`
§0.2, §2.1–§2.4, §3.1. **Upstream:** `docs/campaign/khan_rafid/design.md` —
**Option A adopted**, §0 decisions and D-KR1, §4 ladder, §5 per mission and story
hooks, §5.7 Sahim's table, §8 open decisions. **Neighbours, for continuity of
voice and thread:** `docs/campaign/beit_sahwan/narrative.md` (the act this
continues, and the mission that took the villain),
`docs/campaign/qarn_hadid/narrative.md` (the most recent sheet, whose format this
follows).

**Downstream:** `mission-author` (six mission files, two `dispatch`es, one
`aftermath`, twelve `debrief` lines, every `say`, `world.json`,
`commander.json`), `level-scripter` (trigger ids and bindings, §12),
`render-vfx` (§13 G-B, G-C), `sim-guard` (§13 G-A, G-E, G-F),
`content-validator` (§13 G-I).

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code and the text can reach a player the moment `mission-author` pastes it |
| `schema` | the field is specced and the runtime ignores it |
| `engine` | the surface is an approved target with no implementation — `eva`, `bark`, a trigger that can watch a `SimEvent`, a briefing that can branch on the ledger, or a hard-coded toast string an author cannot reach |

Every row's rightmost cell is one of those three words. The count is §15.

**`schema` is 0 in this arc.** Verified in this worktree rather than recalled:
`mission.schema.json` `$defs.say` is `{speaker ∈ {shai, idit, net, enemy}, text
≤ 240}` and is referenced by `objectives[].say`, `objectives[].say_on_fail`,
`triggers[].say`, `enemy.waves[].say`, `debrief.victory` and `debrief.defeat`;
`dispatch` and `aftermath` are plain strings capped at 240; `debrief` is
outcome-aware and rendered with a portrait and a plate
(`main.ts:1858`, `menu.ts` `showEndScreen`). What is still `engine` is a surface
that does not exist at all, never a field.

**Every string in this sheet was checked against the 240-character cap by
script**, re-run against the finished file: **138 quoted strings, 0 over**, and
every capped field with them — 2 `dispatch`es, 1 `aftermath`, 12 `debrief`
lines, every `say`, every `say_on_fail` and the HELD enemy line. The six
briefings are **898–1,118 characters in 38 beats**, inside the shipped 385–1,225
band, and **no beat exceeds 240 characters or two sentences** (§15).

### 0.2 The two voices, and why the JSON reads as one

The deploy screen and the commander bar carry one speaker at a time and
`briefing` is a single string, so in the JSON each briefing is Shai's orders
voice end to end. In **this sheet** every briefing is a two-hander with one
speaker per beat, because that is how it must be written and read aloud even
where the surface cannot show it. The `say` lines carry a real `speaker`, so
Idit, the brigade net and the enemy speak in their own right inside a mission —
and since 2026-09-07 the commander bar paints that speaker's **portrait and
plate** (`hud.ts` `paintFace`, `renderCommander`, `speakerPlate`;
`assets/ui/portraits/` holds all five faces). That is a correction to Act II's
recorded gap and it is in §13 G-D.

Beat boundaries below are **not editorial**. `briefingBeats` packs sentences in
pairs and flushes early when a pair would exceed 240 characters, so a beat is
two sentences unless the pair is too long. Each briefing's full string is printed
whole under its beat table, exactly as it should be pasted.

### 0.3 The villain who is not here — the arc's central problem, and how it is written

**Nadir Sahim, KDF file SPADE, was captured six missions ago and it shipped.**
`data/missions/beit_sahwan_4_subterranean.json` carries `take_the_shaft_head` —
`capture`, *"Hold the shaft head until Sahim is out of it"* — plus
`find_spade`, and an `aftermath` in which *"the man who dug them came up out of
the last one with his hands empty."* These six missions come **after** that in
`world.json`'s flattened order. So this arc opens on a front whose villain is
already in a cell, and `design.md` D-KR1 and O-KR2 ask for it to be written that
way rather than for a landed mission to be re-opened.

**It is writable, it is better than the alternative, and this is how.** The
absence is not apologised for anywhere; it is the arc's subject, and it does
three different jobs across the six missions.

| | what the absence does | where it is said |
|---|---|---|
| **1. It changes what intelligence is.** | Idit's source is, for the first time, a person — and a person is worth less than a drone. He will tell her what he built; he cannot tell her who is standing in it, and paper is not identification | KR I beat 1; DA I beat 3; `find_the_block_commander.say`; `bring_down_the_west` debrief |
| **2. It changes who the enemy is.** | Nobody is coordinating the Marj. What the player fights is a plan still running with nobody writing it: waves that arrive on a clock nobody called, a crew still digging, a block commander holding a building because no one came to tell him to stop | KR I `wave 150 s`; `find_the_block_commander.say`; KR III `he_walks_out_of_the_hall`; DA I `find_the_crew.say` |
| **3. It changes what an ending is.** | A front whose weapon is ground does not end when its architect is arrested; it ends when the ground does. Taking him closed a file and stopped nothing, and the campaign says that **once**, in the last debrief of the act | DA III `debrief.victory`; the `aftermath` |

**What it costs, stated so the lead can overrule it.** There is no man to kill
at the end of this arc: `eliminate_hvt` in the last mission is a digging chief
with no name (`design.md` D11 — no new personal name is coined anywhere here),
and no villain speaks in six missions. `design.md` §1 Option C is the other
answer and it re-briefs a landed, played, `playtest`-pinned mission. **This sheet
does not move his capture and writes nothing that assumes it moved.**

**And there is a mechanical argument for the absence that the design could not
have known**, found this session: `commander.json`'s `villains` block maps
**region → portrait**, and `marj` resolves to `nadir_sahim.png`
(`campaign.ts:364`, `hud.ts` `paintFace`). So **any `enemy` line in a Khan Rafid
or Deir Amun mission paints Sahim's face on the commander bar**, for a line
spoken by somebody who is not him and could not be. That is not a reason to
avoid the speaker in principle — it is a decisive reason to author none in this
arc. §8 has the one line written and **HELD**, and what it would cost to ship.

### 0.4 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality,
accent, idiom or insignia, on either side. The Ashwar Front is tunnels, IEDs,
ambush and human terrain and nothing else. No line in this sheet gives a
population to a faction: the people in Khan Rafid's ward are people who live in a
town two armies are fighting over, and the text says only that. The ward is never
*his* ward and the hall is never *their* hall; it is a civic hall in a town he
prepared, which is the whole point and is also the only way to say it.

**No new proper noun is coined anywhere in this arc.** *Khan Rafid* and *Deir
Amun* are canon (GDD §2, `world.json`, `storyline.md` §4.2). Every other name on
the page — the ward, the souk, the Old Town, the New Quarter, Main Street, the
market, the store, the two lanes, the wadi, the tributary, the pump yard, the
hamlet, the spoil field, the gaps — is a **feature**, and resolves to a marker or
a zone in `design.md` §3.1 and §3.2. The two adversaries are named by their job:
**the block commander** and **the digging chief**, in the shipped `wh_hvt_amir`
register (*"Kill or capture Hallaq's local commander"*), never named to the
player.

**The Marj is arid and its groves are desert trees.** Since 2026-09-07 an `o`
tile on an arid map draws the `desert_tree` family
(`decor-place.ts:212`). There is no olive anywhere in this sheet, and there must
not be one in a briefing.

### 0.5 What this arc can say, and what it still cannot

| | |
|---|---|
| **can, today** | a line on an objective completing, an objective **failing**, a trigger firing or a wave arriving, in four voices, reaching the notice feed and the commander bar with the speaker's portrait and plate; `dispatch` on the title card; `aftermath` on the victory banner; a `debrief` that tells a win from a loss |
| **cannot, and it is this arc's own gap** | **a `MissionEvent` that nothing announces is this arc's central mechanic.** A stocked route venting behind the player is autonomous — no trigger fires, `describeMissionEvent` has no case, and Deir Amun is built on it. Five rows below are `engine` for that alone (§13 **G-A**) |
| **cannot** | **a civilian reaching the refuge is silent.** `describeMissionEvent` has no `evacuated` case — read this session, `main.ts:267`. Khan Rafid scores on civilians in **all three** missions with counts 2, 4 and 6, and the mechanic the whole arc is built on produces no toast, no sound and no line until the count lands (§13 **G-B**) |
| **cannot** | a briefing cannot branch on the ledger, so KR III cannot say what KR I found. §3.3 beat 3 is the rule-not-state fallback the tree already uses |
| **cannot** | an author cannot choose where an enemy round lands, so T-KR9 is delivered as a placement (§13 **G-F**) |

### 0.6 Four decisions recorded before the text

**1. Two `dispatch`es, one per town — KR I and DA I.** Four shipped missions
carry one: `beit_sahwan_breach`, `tel_marum_1_recon`, `wadi_halam_1_fords` and
`qarn_hadid_1_recon` (censused this session; the fourth landed with the Qarn
Hadid sheet's own recommendation). **All four are the first mission of a new
town**, and KR I and DA I are the first missions of two new towns. The reason
they are needed rather than merely permitted is §0.3: the front's premise — a
district running on a plan whose author is in a cell — is a story fact, and Shai
cannot say it without the orders voice starting to narrate, which README rule 1
forbids. Each is four sentences, names Sahim not at all, and opens onto a town
rather than onto an act.

**2. `deir_amun_3_subterranean` carries the `aftermath`, and it should — but the
third star is currently awarded twice, and that is a defect this sheet found
rather than one it creates.** The argument both ways, honestly:

- **For.** The three shipped `aftermath`s are all act or campaign closes
  (`beit_sahwan_4_subterranean`, `umm_zeitoun_4_clearance`,
  `wadi_halam_5_depot`). Act I now ends here, not at Beit Sahwan IV, because
  `world.json` already places both towns between Beit Sahwan and Sur. And
  `design.md` C4 requires `commander.json`'s Captain entry to move its
  `until_mission` to `deir_amun_3_subterranean`, which puts the **promotion** at
  this mission — and the promotion is what an Act I aftermath is for.
- **Against.** An aftermath is a banner that says *"that was the act"*, and Beit
  Sahwan IV already says it. Two act-closing banners in one act is one too many,
  and the second one reads as an epilogue to the first.
- **The resolution, and it is not a preference.** `beit_sahwan_4_subterranean`'s
  shipped `aftermath` reads *"Brigade put a third star on the slip and said
  nothing else about it. The Marj is quiet. Sur is not."* If these six missions
  land with `commander.json` corrected per C4, **the campaign tells the player he
  is a Major, then plays six missions in which he is a Captain, and then promotes
  him again.** The `aftermath` is not one of the three fields this agent may
  edit and `beit_sahwan/` is not this arc's document, so it is a **request with
  an owner** — the exact replacement text is §14.2, it is one string, and it must
  land in the same commit as `commander.json` C4 and the six mission files.

**3. No `briefing_video` is declared on any of the six.** `design.md` O-KR7
recommends one on `khan_rafid_3_clearance` and this sheet agrees that if there is
one cut in this arc it belongs there — it is the arc's beat. But the lead cuts
these himself and `validate_data.mjs` requires the file to exist, so an
aspirational path fails the gate. If he wants it: the asset is
`assets/video/khan_rafid_3_briefing.mp4` and the field is
`"briefing_video": "video/khan_rafid_3_briefing.mp4"`. What it should show is in
§3.4.

**4. No `enemy` line ships in this arc.** §0.3's portrait finding, plus the
same argument the Qarn Hadid sheet made about scarcity. One line is written and
**HELD** at §8.

---

## 1. `khan_rafid_1_recon` — Khan Rafid I — House Numbers

`recon` · **Captain** · `khan_rafid` · requires **R** · produces **R M C I E** ·
`target_minutes` 6 · no economy. **The mission where the reach is the whole
cost.**

Ledger letters as `design.md` §4 uses them: **R** `roster.surviving_units`,
**M** `roe.mission_ratings`, **C** `campaign.completed_missions`, **I**
`intel.marked_positions`, **E** `civ.settlements_evacuated`.

### 1.1 `name`

`Khan Rafid I — House Numbers`

The title-card convention is the town, a numeral, then the name — `Tel Marum I —
The Gateway`, `Beit Sahwan IV — Subterranean`, `Qarn Hadid I — Both Gates`.
*House Numbers* is `design.md`'s own name and it is the mission's argument: this
is a town with addresses in it, and the enemy chose it for exactly that. It is
also what the mission mechanically does — the player goes and reads three
positions off a street plan.

### 1.2 `dispatch` — 227 chars

> *The man who prepared the Marj has been at brigade a week, answering questions.
> Seven kilometres up the coast road the town he built for this is still holding,
> and nobody in it has had a new order since the morning he was taken.*

Narrator, story voice. It is the arc's premise in two sentences and it names
nobody: *the man who prepared the Marj* is the same construction
`tel_marum_1_recon` uses for Adhal. The second sentence is the whole of §0.3's
job 2, stated as a fact about a town rather than as a theme. **It says nothing
about a capture the player did not perform** — he did perform it, six missions
ago, and this is the consequence rather than the recap. `dispatch` is live
(`main.ts` `hud.announce(name, "N primary objective(s)", mission.dispatch)`).
Status **`live`**; owner `mission-author`.

### 1.3 `briefing` — 1,085 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Khan Rafid has house numbers, a market day, a clinic and a civic hall, and every one of those is why he chose it. The man who chose it is answering questions at brigade, and none of his answers say who is holding the town this week. | 232 |
| 2 | **Shai** | Push the drone up the centre and identify the posts in the two Old Town alleys. It can have both in one sortie; nothing on the ground can, because an alley one tile wide sees along its own axis and nowhere else. | 211 |
| 3 | **Idit** | The third post is a missile cell nineteen tiles east on Main Street, and Main Street is the only road across this town. It runs the full width, it is straight, and there is no cover on it. | 188 |
| 4 | **Shai** | Four people are stopped in the Old Town alleys, thirty tiles out and past both the road and the ward. Get two of them back inside the ward inside four minutes. | 159 |
| 5 | **Shai** | The jeep and the Eitan carry two each, and nothing boards until a soldier is within four tiles of it. The walk back from there is nine tiles and the walk out is thirty, which is the whole of this clock. | 202 |
| 6 | **Shai** | Bring back the posts, and do not cross that street twice for a picture you already have. | 88 |

Idit / Shai / Idit / Shai / Shai / Shai — the same shape as `qarn_hadid_1_recon`
and `tel_marum_1_recon`: her picture, his plan, the part of the picture she
cannot buy, then the cost.

**Beat 1 is `design.md`'s Idit hook and the arc's premise in the intel voice.**
The first sentence is the villain's method seen from the inside — he did not hide
behind the people of Khan Rafid, he built for them to be there — said as a list
of civic facts with no adjective on any of them. The second is §0.3's job 1: her
source is a man, and a man is worth less than a drone. **She never says he was
captured**; the dispatch already did, and the orders slot must not narrate.

**Beat 2 is measured, not asserted.** `design.md` §3.1: the Old Town's alleys are
one tile wide between building rows and *"a one-tile alley gives sight along its
own axis and nothing else"*, which is why `ambush(3)` is worth authoring there
and why the drone can hold both alley posts in a single sortie.

**Beat 3 is T-KR2 and it is the mission's real decision.** `kr_watch`'s
`atgm_cell` sits at `[43,25]`, nineteen tiles east along Main Street, which runs
`x2–45` at `y=25` — the full width, the only east–west road, and no cover on it.
Every route from the staging ground to the ward crosses it somewhere.

**Beats 4 and 5 are the cost, and every number is `design.md` §5.1's.** The two
civilian groups sit at `[20,16]` and `[27,16]`, 29 and 30 tiles from
`kr_start [24,45]`; the foot walk from there to `civ_refuge [24,22]` is 9 and 8
tiles. `jeep_shoded` and `apc_eitan` both declare `hull.transport_slots: 2` (read
this session), and `CivilianFlight` boards a civilian into any player carrier
with a free slot inside four tiles (`SHEPHERD_RADIUS_SQ`). The jeep runs at 2.9
tiles/s against infantry at 0.9. **The walk home is short and the reach is the
whole bill**, and the briefing says so in one clause rather than lecturing about
it.

**Beat 6 closes on the cost, which is the house rule.** *"Bring back the picture,
not casualties"* (Tel Marum I), *"Do not chase what runs"* (Wadi Halam I). Here
it is a second crossing of a road the mission has just priced.

**The JSON string, to be pasted whole:**

> Khan Rafid has house numbers, a market day, a clinic and a civic hall, and every one of those is why he chose it. The man who chose it is answering questions at brigade, and none of his answers say who is holding the town this week. Push the drone up the centre and identify the posts in the two Old Town alleys. It can have both in one sortie; nothing on the ground can, because an alley one tile wide sees along its own axis and nowhere else. The third post is a missile cell nineteen tiles east on Main Street, and Main Street is the only road across this town. It runs the full width, it is straight, and there is no cover on it. Four people are stopped in the Old Town alleys, thirty tiles out and past both the road and the ward. Get two of them back inside the ward inside four minutes. The jeep and the Eitan carry two each, and nothing boards until a soldier is within four tiles of it. The walk back from there is nine tiles and the walk out is thirty, which is the whole of this clock. Bring back the posts, and do not cross that street twice for a picture you already have.

### 1.4 Objectives

Objective **ids are proposals** — `mission-author` and `level-scripter` own them.
The `text` is this sheet's, and it is read twice below because it is read twice
in the game: once on the deploy screen as an order, once in the notice feed as
`OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `find_the_watch` | `locate` · `kr_watch` ×3 · **primary** | Identify the three posts covering the ward crossing | `OBJECTIVE COMPLETE — Identify the three posts covering the ward crossing` |
| `get_two_in` | `evacuate_before` · `ward` ×2 @240 s · **primary** | Get two families into the ward inside four minutes | `OBJECTIVE COMPLETE — Get two families into the ward inside four minutes` |
| `find_the_west_lane` | `locate` · `kr_lane_west` · secondary | Identify the rocket team in the west lane | `OBJECTIVE COMPLETE — Identify the rocket team in the west lane` |
| `find_the_east_lane` | `locate` · `kr_lane_east` · secondary | Identify the rocket team in the east lane | `OBJECTIVE COMPLETE — Identify the rocket team in the east lane` |
| `find_the_block_commander` | `locate` · `kr_hvt_ward` · secondary | Find the man giving the orders in this block | `OBJECTIVE COMPLETE — Find the man giving the orders in this block` |
| `screen_out` | `survive_until` 300 s · secondary | Stay in the field for five minutes | `OBJECTIVE COMPLETE — Stay in the field for five minutes` |

**`find_the_watch` names what the three posts have in common rather than where
they are**, because that is the mission's lesson and it is the first line the
player reads about this town: none of them can shoot the ward and all of them can
shoot anyone crossing to it. The count-3 `locate` follows
`beit_sahwan_1_recon`'s *"Identify six garrison positions"* and
`wadi_halam_1_fords`'s *"Identify four dispersal sites"*.

**`get_two_in` says *into the ward*, not *to the collection point*.** The refuge
`civ_refuge [24,22]` is inside the `ward` zone (assertion KR-A4, and the runtime
throws at load if it is not — `mission.ts:748`), and the ward is also the
`flagged_zones` entry and mission II's `hold_for` target. **One name for one
rectangle, in all three missions**, so a player reads the same word three times
and it means the same ground each time.

`find_the_west_lane` and `find_the_east_lane` are the two tags that come back as
`ambush(3)` in KR II and KR III, so they are the reason the secondaries are worth
the clock. Naming them by side rather than by unit is deliberate: the player will
meet them by side.

`find_the_block_commander` **is a question the arc answers with nobody.** He is
giving orders in this block and receiving none, and the `say` on this objective
is where that lands.

`screen_out` reuses `qarn_hadid_1_recon`'s and `tel_marum_1_recon`'s id and label
shape — four recons across the game should give the same order the same way.
**It cannot fail**: `survive_until` is not one of the three types `checkEnd` can
drive to `failed`, so a `say_on_fail` on it would never fire and must not be
authored.

### 1.5 `debrief` — victory 140 chars, defeat 149 chars

> **victory** · Shai — *Two into the ward and two still in the alley. Four seats,
> one street and thirty tiles — that arithmetic does not get better by being
> braver.*

> **defeat** · Idit — *Nothing of ours was within four tiles of those alleys in
> four minutes. The picture we did bring back is of a town that still has people
> living in it.*

Shai's victory line is a **report on a win that is also a shortfall**, which is
the arc's whole register and the reason `evacuate_before` is a primary three
times: the mission is won at two and the other two are still standing there. He
names the seats, the street and the distance and not one word about how he feels
about it, and *"does not get better by being braver"* is the closest he comes —
a statement about a plan. It also sets up KR II and KR III, where the arithmetic
genuinely does change, because the force grows to eleven seats.

Idit's defeat line states the boarding rule as the failure (*within four tiles*)
and then does the thing only she does: reports what was learned anyway. Status
**`live`**.

### 1.6 The thread in, from `beit_sahwan_4_subterranean`

Beit Sahwan IV's shipped victory debrief is Idit: *"Four routes, and all four
were his. That is the Marj."* Khan Rafid I opens on the half of that sentence
nobody has tested — **the Marj was not only his routes, it was his choice of
ground**, and the ground is still occupied. The two missions share a key
(`intel.marked_positions`, produced by both), so Idit's file is one list and it
grows; and they share a construction, because Beit Sahwan IV's own
`evacuate_before` was *"Get five people out to the collection point"*. **Act I
opened on getting two families inside a wire and this arc is the same verb three
more times, with the count going up instead of down.**

`beit_sahwan_4_subterranean`'s `aftermath` is the one thing that does **not**
thread cleanly, and §0.6 and §14.2 are where that is dealt with.

### 1.7 Trigger table

The mission does not exist; every trigger below is `level-scripter`'s to author
and every id is proposed as prose, because `main.ts:276` prints it verbatim as
`enemy reacts (<id>)` (§12).

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Khan Rafid I — House Numbers` · *2 primary objectives* | `hud.announce`; shipped | live |
| mission start | `dispatch` | narrator | §1.2 | title-card hold is `render-vfx`'s standing item | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §1.3 | one speaker on screen at a time | live |
| `objective(find_the_watch, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the three posts covering the ward crossing` | shipped | live |
| `objective(find_the_watch, complete)` | `radio` | **Idit** | "Three posts, and not one of them can put a round inside the ward. Every one of them can put a round on anybody crossing to it. That is not an accident of ground; it was laid that way." | `objectives[].say`; **T-KR2 and the villain's method in one line.** 183 chars | live |
| `objective(find_the_west_lane, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the rocket team in the west lane` | shipped | live |
| `objective(find_the_west_lane, complete)` | `radio` | **Idit** | "Rocket team in the west lane, in a road one tile wide with houses on both sides. He is on the board now and he does not get a first shot next week." | `objectives[].say`; **the carry-over said at the moment it is bought** — this tag spawns pre-identified in II and III and forfeits its ambush (`spawnPlacement`'s `preMarked`) | live |
| `objective(find_the_east_lane, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the rocket team in the east lane` | shipped | live |
| `objective(find_the_east_lane, complete)` | `radio` | **Idit** | "The east lane is the mirror of it. Two lanes, two teams, and the only third way north runs through the compound we are not allowed to fight in." | `objectives[].say`; states the map's whole geometry once, and it is `design.md` §3.1's three-ways-north exactly | live |
| `objective(find_the_block_commander, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the man giving the orders in this block` | shipped | live |
| `objective(find_the_block_commander, complete)` | `radio` | **Idit** | "That is the man giving the orders in this block, and he has not been given one himself since the shaft head. He is holding a town to a plan nobody is still writing." | `objectives[].say`; **§0.3 job 2, said once in the arc's first mission.** *The shaft head* is `beit_sahwan_4_subterranean`'s own zone name, which is the only backward reference in six missions | live |
| `objective(screen_out, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for five minutes` | shipped | live |
| `screen_out` failing | — | — | **cannot happen**; no `say_on_fail` (§1.4) | authorial | live |
| `evacuated` (a civilian reaches `civ_refuge`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no `evacuated` case | §13 **G-B**; `render-vfx` | engine |
| `objective(get_two_in, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get two families into the ward inside four minutes` | shipped | live |
| `objective(get_two_in, complete)` | `radio` | **Shai** | "Two inside the wall. Whatever is still in that alley is not worth a second run across the street." | `objectives[].say`; **the order stops at two**, which is what makes the other two a cost rather than a task | live |
| `objective(get_two_in, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Get two families into the ward inside four minutes` | **the only way to lose this mission**; a failed primary loses it in `checkEnd` | live |
| `objective(get_two_in, failed)` @240 s | `radio` | **Shai** | "Four minutes, and nothing of ours got within four tiles of them. They are somebody else's problem now, and there is nobody left in this town whose problem that is." | `objectives[].say_on_fail`; the boarding rule stated as the failure, and the last clause is the absence doing work at the worst possible moment | live |
| wave t=150 s (2 `militia_cell`, `north_road` → `souk_alley`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded string | live |
| wave t=150 s | `radio` | **Idit** | "Two sections down the north road into the souk alleys. Nobody called for them — that is a standing order arriving on time, from before anybody was on this road to call it off." | `enemy.waves[].say`, live since 2026-09-06. **§0.3 job 2 as a mechanic**: a wave on a clock is exactly what a plan with no author looks like | live |
| wave t=260 s (1 `technical`, `kr_east_edge` → `main_street`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded; **no `say`, deliberately** — the road being his is beat 3's job and Idit saying it twice makes it a theme instead of a fact | live |
| **T-KR-a** `zone_entered(ward)` → `the_compound_was_never_empty` (`spawn` 1 `militia_cell` at `ward_north_gate`) | `toast` | system | `enemy reacts (the_compound_was_never_empty)` | id proposed as prose (§12) | live |
| **T-KR-a** same trigger | `radio` | **Idit** | "There is a section coming in through the north gate. The compound was never empty — he has been walking men through it since before we crossed the perimeter." | `triggers[].say`; **T-KR1 and T-KR4's seed.** The patrol through `[24,24] → [24,17]` teaches the same thing silently; this says it once | live |
| **T-KR-b** `casualties_pct(35)` → `he_gives_up_the_crossing` (`withdraw_to souk_alley`, group `ward_party`) | `toast` | system | `enemy reacts (he_gives_up_the_crossing)` | id proposed as prose | live |
| **T-KR-b** same trigger | `radio` | **net** | "The party forward of the ward is falling back into the souk. The crossing is open." | `triggers[].say`; **net, and flat** — it is a position report, and Idit's talking in this mission is already spent on the three posts | live |
| **T-KR-c** `timer_s(250)` → `they_move_the_families_off` (`remove`, group `families`) | `toast` | system | `enemy reacts (they_move_the_families_off)` | id mirrors `umm_zeitoun_1_recon`'s shipped `they_move_the_families_off`; `do.kind: "remove"` is shipped | live |
| **T-KR-c** same trigger | `toast` | system | `taken (1)` ×N | `removedNotice`, side 2; one line per body, by design | live |
| **T-KR-c** same trigger | `radio` | **Idit** | "The alley is empty. Nobody fought over them; they were walked off it while the drone was over the souk." | `triggers[].say`; **T-KR3.** It costs the player nothing on ROE — `stepRoe` bills only a `destroyed` whose `by` is a player unit — which is the point, and it fires after the objective has already failed | live |
| `SimEvent destroyed` on the `recon_drone` | `radio` | **Idit** | "Drone is gone. Three posts still to read and the only things left that can read them are the two vehicles carrying people." | needs a trigger that can watch the sim (§13 **G-A**) | engine |
| `SimEvent fire` from `kr_watch`'s `atgm_cell` onto anything crossing Main Street | `radio` | **Shai** | "That came down the length of the street. Nothing crosses there again above a wall." | same gap; the ATGM firing is the mission's central fact and it currently arrives silently | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | **Shai** | §1.5 | end screen, above the rating, with portrait and plate | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §1.5 | end screen | live |

---

## 2. `khan_rafid_2_foothold` — Khan Rafid II — The Ward

`foothold` · **Captain** · `khan_rafid` · requires **R I** · produces **R M C E**
· `target_minutes` 7 · **economy: yes** (`logistics_start` 400, 120/min).
**The first foothold in the game with an ROE floor, and the mission is that
escalation.**

### 2.1 `name`

`Khan Rafid II — The Ward`

`design.md`'s own name and the right one. The ward is the `hold_for` target, the
`evacuate_before` target, the `flagged_zones` entry and the place the enemy walks
into — **one nine-by-seven rectangle wearing four hats**, and the title should
name the ground rather than the act, because the act is *holding*, which is not a
title.

### 2.2 `briefing` — 1,093 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The ward is nine tiles by seven with four gates and a low wall, and the wall stops men and not bullets. A cell in the souk can fire into that compound over it, you can fire back, and only one of you is billed for it. | 216 |
| 2 | **Shai** | There is nothing in that ward worth taking and you are going to hold it for four minutes anyway. The clock is cumulative and it stops the moment anything hostile is standing inside the wall with you. | 199 |
| 3 | **Idit** | Six people in three groups: two groups north of the ward in the Old Town and one south of Main Street. Four have to be inside that wall in five minutes; the wall will hold all six. | 180 |
| 4 | **Shai** | Rifles and the Eitan's fifty are free inside the compound. The Namer's cannon is not: it is billed for every ten seconds it fires in there, and this mission is lost under forty-five. | 182 |
| 5 | **Shai** | So the infantry and the Eitan clear the ward and the Namer holds the street outside it. At a hundred and twenty a minute the camp buys you three rifle sections or one more gun you may not use inside the wire. | 208 |
| 6 | **Shai** | He will walk into that compound the moment it is yours, because it is the one place you will not shoot. | 103 |

Idit / Shai / Idit / Shai / Shai / Shai.

**Beat 1 is the map fact the whole ROE design rests on, and it is a measurement.**
`wall` in `data/structures.json` is `low_profile: true`, `standing_cover: 2`,
`roe_penalty: 0` — it stops movement and not line of sight (assertion KR-A5,
which pins it as behaviour rather than prose). *Only one of you is billed for it*
is `stepRoe`: the deduction is on a player unit's fire inside a `flagged_zones`
entry and nothing else. **That sentence is the arc's mechanical thesis and no
shipped mission states it.**

**Beat 2 is `design.md`'s Shai hook and it is the line a Captain is not supposed
to say out loud.** He is putting the brigade's weight on a compound with no
military value, he says so in the first clause, and he gives the order in the
same breath. The second sentence is `contestedIn` stated exactly: `hold_for` is
cumulative and pauses whenever an enemy stands inside the zone within six tiles
of a friendly who is also inside it.

**Beat 3 is Idit's beat and it is the arc's spine.** `design.md`'s hook for this
mission is *"the second half of First Light finally being possible — she says the
number, because she is the one who says the numbers."* What she says is a
**capacity**: four have to be inside, and the wall will hold all six. That is the
whole of it. **She does not mention First Light, does not mention the nine who
did not come in, and does not say anything about what it means** — and the excess
between four and six is the emotional content, delivered as a fact about a
rectangle. §7 is why this is the one place in the arc that sentence can be said.

**Beat 4 is the bill, priced from `design.md` §3.1's own arithmetic.** The
flagged-zone penalty arms at `collateral_risk ≥ 0.3` and deducts 5 once per zone
per ten seconds (`ZONE_DEDUCT_COOLDOWN`). Read from `data/units/kdf/**` this
session: `ifv_namer` `cannon_30` is 0.35 and arms it; `apc_eitan` `rws_50` is
0.25 and does not; `inf_squad` rifles are 0.10. `fail_below: 45`. **So armour is
not banned from the ward — its secondary armament is free there and its main gun
is not**, and that is a decision rather than a tax.

**Beat 5 is the answer to beat 4 and then the economy.** At 400/120 the player
buys roughly three rifle sections or one Namer across seven minutes, and *one
more gun you may not use inside the wire* is the choice stated in nine words.
`beit_sahwan_2_foothold`, `tel_marum_2_foothold` and `wadi_halam_2_laager` all
carry 400/120, so nothing here is a new rate.

**Beat 6 is T-KR4 and it is the closer.** It is a prediction, not an order, and
it is the purest statement of the front's doctrine available in the trigger
vocabulary: `zone_entered(ward)` → `commit` group `ward_push` → `civ_refuge`.
The player is told exactly what is going to happen and cannot prevent it by
knowing.

**The JSON string, to be pasted whole:**

> The ward is nine tiles by seven with four gates and a low wall, and the wall stops men and not bullets. A cell in the souk can fire into that compound over it, you can fire back, and only one of you is billed for it. There is nothing in that ward worth taking and you are going to hold it for four minutes anyway. The clock is cumulative and it stops the moment anything hostile is standing inside the wall with you. Six people in three groups: two groups north of the ward in the Old Town and one south of Main Street. Four have to be inside that wall in five minutes; the wall will hold all six. Rifles and the Eitan's fifty are free inside the compound. The Namer's cannon is not: it is billed for every ten seconds it fires in there, and this mission is lost under forty-five. So the infantry and the Eitan clear the ward and the Namer holds the street outside it. At a hundred and twenty a minute the camp buys you three rifle sections or one more gun you may not use inside the wire. He will walk into that compound the moment it is yours, because it is the one place you will not shoot.

### 2.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `hold_the_ward` | `hold_for` · `ward` 240 s · **primary** | Hold the ward for four minutes | `OBJECTIVE COMPLETE — Hold the ward for four minutes` |
| `get_four_in` | `evacuate_before` · `ward` ×4 @300 s · **primary** | Get four families into the ward inside five minutes | `OBJECTIVE COMPLETE — Get four families into the ward inside five minutes` |
| `take_the_market` | `capture` · `market` 15 s · secondary | Take the market and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the market and hold it for 15 seconds` |
| `kill_the_west_lane` | `eliminate_hvt` · `kr_lane_west` · secondary | Kill the rocket team in the west lane | `OBJECTIVE COMPLETE — Kill the rocket team in the west lane` |

`hold_the_ward` follows the tree's own construction exactly — *"Hold the
approach for four minutes"* (Tel Marum II), *"Hold the ford watch for four
minutes"* (Wadi Halam I). Minutes are spelled out and seconds are digits, in all
twenty-one shipped files.

**`get_four_in` is the same sentence as `get_two_in` with one word changed, and
that is deliberate.** The player read *"Get two families into the ward inside
four minutes"* last mission; this is *four* and *five*. **The escalation has to be
legible in the label**, because the label is the toast and the toast is what the
player compares. §7.

`take_the_market` says *hold it for 15 seconds*, matching all five shipped
`capture` labels that carry a number.

`kill_the_west_lane` is the same tag KR I could have identified, named the same
way in both missions — a player who found it recognises the label, and one who
did not is told what it is by reading it. The same construction
`qarn_hadid_2_foothold` uses for the bench post.

### 2.4 `debrief` — victory 134 chars, defeat 135 chars

> **victory** · Idit — *Four inside the wall and the wall held. That is the first
> compound in this district we have stood in without taking it apart.*

> **defeat** · Shai — *We held a compound for four minutes and put nobody in it.
> The clock was never on the ground; it was on the families, and it always was.*

Idit's is the arc's second chance said once, from the far side, as a fact about
a district: *without taking it apart*. Shai's defeat line states the passive-loss
design exactly — `hold_for` never drives a defeat, `evacuate_before` does, and
the losable objective is the one the player has to act on. He does not blame the
player and he does not absolve him; he says which clock it was. Status **`live`**.

### 2.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Khan Rafid II — The Ward` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §2.2 | shipped | live |
| `objective(hold_the_ward, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the ward for four minutes` | shipped | live |
| `objective(hold_the_ward, complete)` | `radio` | **net** | "Ward held, four minutes. Nothing came out of that compound that we did not carry out of it." | `objectives[].say`; **net and flat** — holding a walled yard for four minutes is not a speech, and the second clause is the only claim worth making about it | live |
| `evacuated` (a civilian reaches `civ_refuge`) | `toast` | system | **nothing at all** | §13 **G-B**; **worst instance in the tree** — six civilians, four counted, and the progress is invisible until the fourth | engine |
| `objective(get_four_in, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get four families into the ward inside five minutes` | shipped | live |
| `objective(get_four_in, complete)` | `radio` | **Idit** | "Four inside the wall. There is room in there for the other two and eighty seconds of clock; that is your decision, not mine." | `objectives[].say`; **she never gives an order** (`storyline.md` §2.2) — the last clause is the rule, said out loud, at the one moment it is load-bearing | live |
| `objective(get_four_in, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get four families into the ward inside five minutes` | **the only way to lose this mission**; loses it | live |
| `objective(get_four_in, failed)` @300 s | `radio` | **Shai** | "Five minutes. We held the compound and put nobody in it, which is the one way this was always going to be lost." | `objectives[].say_on_fail`; states the passive-loss shape as the failure | live |
| `objective(take_the_market, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the market and hold it for 15 seconds` | shipped | live |
| `objective(take_the_market, complete)` | `radio` | **net** | "Market square is ours. Main Street is cut east of the ward." | `objectives[].say`; the mechanical payoff of a 15-second capture, said in nine words | live |
| `objective(kill_the_west_lane, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the rocket team in the west lane` | shipped | live |
| `objective(kill_the_west_lane, complete)` | `radio` | **Shai** | "West lane is clear. That is one of the two ways north that does not go through the compound." | `objectives[].say`; the map's geometry restated at the moment the player has bought a piece of it | live |
| wave t=120 s (2 `militia_cell`, `north_road` → `ward_north_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=120 s | `radio` | **Idit** | "Two sections down the north road for the gate. Every two minutes, on the clock, whether or not there is anything at the gate to fight." | `enemy.waves[].say`; **the cadence named at the first push**, which is `design.md`'s *"one push at the ward every two minutes"*, and it is §0.3 job 2 again — a timetable nobody is adjusting | live |
| wave t=240 s (1 `rpg_team` + 1 `moto_rpg`, `kr_west_edge` → `main_street`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; **no `say`** — the alternating road push is the cadence's second half and Idit has already named it | live |
| wave t=330 s (2 `militia_cell`, `north_road` → `ward_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=330 s | `radio` | **Idit** | "Two more at the north gate, and the families are still walking to it. He is not aiming at them; he is aiming at the gate, and they are in it." | `enemy.waves[].say`; **the doctrine's cruellest property said without a word of judgement** — the human terrain is not a target, it is a location | live |
| **T-KR-d** `zone_entered(ward)` → `they_walk_into_the_ward` (`commit` group `ward_push` → `civ_refuge`) | `toast` | system | `enemy reacts (they_walk_into_the_ward)` | id proposed as prose (§12) | live |
| **T-KR-d** same trigger | `radio` | **Idit** | "They are walking into the ward. Not round it and not at the gates — into it, because it is the one piece of ground on this map where your guns are the ones that cost you." | `triggers[].say`; **T-KR4, the arc's strongest twist and one trigger.** The briefing predicted it; this is the receipt | live |
| **T-KR-e** `casualties_pct(40)` → `the_block_pulls_back_into_the_souk` (`withdraw_to souk_alley`, group `ward_party`) | `toast` | system | `enemy reacts (the_block_pulls_back_into_the_souk)` | id proposed as prose. **`playtest` re-runs after this lands** — `tel_marum/design.md` records that a `withdraw_to` can walk a fight out of a scripted plan's reach | live |
| **T-KR-e** same trigger | `radio` | **net** | "The party forward of the compound has gone back into the souk. They are not finished; they are shortening." | `triggers[].say`; net, because it is a position report and it sets up KR III's version of the same move | live |
| **T-KR-f** `timer_s(200)` → `a_charge_squad_comes_for_the_gate` (`spawn` 1 `charge_squad` at `souk_alley`, committed at the ward) | `toast` | system | `enemy reacts (a_charge_squad_comes_for_the_gate)` | id proposed as prose | live |
| **T-KR-f** same trigger | `radio` | **Shai** | "One charge squad, out of the souk, coming at the gate. That is the only thing on this map that can kill a family inside the wall, and it does not care which side of it he dies on." | `triggers[].say`; **T-KR9's live half.** The `charge_squad` is the one enemy unit that can splash a civilian, and `stepRoe` does not bill the player for it | live |
| `built` at the camp | `toast` | system | `reinforcement deployed — inf_squad` | prints a raw unit id; §13 **G-C** | engine |
| `SimEvent destroyed`, a civilian, `by` an enemy unit | `radio` | **Idit** | "That was his, inside the wall, and the rating has not moved. It only ever moves for ours." | **T-KR9 in its literal form**; needs a sim-watching trigger (§13 **G-A**) | engine |
| `roe` deduction inside `ward` | `toast` | system | hard-coded `roeNotice` copy | strings are not authorable; this is the deduction beat 4 priced | live |
| `roe` deduction inside `ward`, first | `radio` | **Shai** | "That was the compound. Whatever fired it is outside the wall from here on, and the rifles stay in." | needs a sim-watching trigger (§13 **G-A**) | engine |
| `missionEnd(victory)` | `debrief` | **Idit** | §2.4 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §2.4 | end screen | live |

---

## 3. `khan_rafid_3_clearance` — Khan Rafid III — What You Keep

`clearance` · **Captain** · `khan_rafid` · requires **R I** · produces
**R M C I E** · `target_minutes` 7 · **economy: yes** (`logistics_start` 400,
80/min). **The arc's beat, and the mission the campaign has been walking toward
since First Light. It must not say so.**

### 3.1 `name`

`Khan Rafid III — What You Keep`

`design.md`'s own name. It is the only title in the arc that is about the score
rather than about a piece of ground, and it earns that because
`structure_penalty_mult: 2` makes the score literally a count of what is still
standing. It is also two readings at once — the buildings and the people — and
**neither the briefing nor any `say` in this mission points at the second one.**
The title carries it and nothing else has to.

### 3.2 `briefing` — 1,118 chars, 7 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The man running this block is inside the civic hall in the ward, and the hall is the one building here that nothing of ours will fire on by itself. It is not shot at, not breached and not brought down by anybody acting on his own. | 230 |
| 2 | **Shai** | You have nobody with you who can level it, and that is deliberate. Hurt his people hard enough and he leaves it on his own feet, which is the only way he comes out. | 164 |
| 3 | **Idit** | The lanes and the road east are laid the way they were laid last week. Whatever you identified then comes back with its ambush spent; whatever you did not gets its first shot. | 175 |
| 4 | **Shai** | Clear the souk and hold it twenty seconds without a break. Eight families are in that quarter and six of them have to be inside the ward in five minutes. | 153 |
| 5 | **Shai** | The carriers hold eleven between them, so the clock is the only thing standing between you and all eight. Nothing boards until a soldier is inside four tiles of it. | 164 |
| 6 | **Shai** | Every structure you bring down here is billed at twice the usual, and eight houses is this mission. The floor is fifty and there is no getting a house back. | 156 |
| 7 | **Shai** | Take the souk, get them in, and be able to say what is still standing. | 70 |

Idit / Shai / Idit / Shai / Shai / Shai / Shai.

**Beats 1 and 2 are T-KR7, the strongest thing in the arc, and they cost one line
of JSON.** `hall` is `roe_penalty` 30, which is at or above `PROTECTED_ROE`
(20, `structures.ts:135`), so the sim refuses to engage it (`sim.ts:2977`),
breach it (`:3073`) or demolish it on any unit's own initiative (`:4345`). The
only remaining routes are an explicit `demolish` order from a selection of
nothing but demolishers — **closed by the roster, because `design.md` §5 forbids
a `demo_squad` on either map** — or `casualties_pct(45) → withdraw_to
souk_alley`, which queues a `move` on group `hall_party`, and a `move` calls
`leaveStructure` (`sim.ts:1927`). *"Hurt his people hard enough and he leaves it
on his own feet"* is that mechanic said in one clause. **Patience beats a
demolition, and the briefing states it as the plan rather than as a lesson.**

**Beat 3 is the recon-dependent clause, written as a rule and not as a state.**
A briefing is a plain `string` and cannot read the ledger (§13 **G-E**), so the
sentence is true whichever way the ledger fell: `kr_lane_east` and `kr_watch`'s
ATGM either spawn pre-identified with their ambush forfeited or they do not, and
the player's own memory of KR I is what resolves it. This is the same fallback
`qarn_hadid_3_clearance` ships and the same nineteen-word idea; the wording is
deliberately close, because it teaches a campaign mechanic and the campaign
should teach it the same way twice.

**Beats 4 and 5 are the spine's third asking, and beat 5 is the reason it is not
a repetition.** The force carries two `apc_eitan` at 2 seats, one `jeep_shoded`
at 2 and one `ifv_namer` at 5 — **eleven seats for eight people** (read from
`data/units/kdf/**` this session). So the shortfall is no longer structural. In
KR I it was four seats and one street; here the seats are there and **the clock
is the only thing between the player and all eight**. §7 is why that matters.

**Beat 6 is the arc's title said as arithmetic.** `structure_penalty_mult: 2`
has never been used in the tree; at mult 2 a `house` costs 12, an `apartment` 28,
and levelling every non-wall structure on the map is −456. From 100, **eight
houses lose the mission** at `fail_below: 50`. That is a rule a player can hold
in his head, and *there is no getting a house back* is the only sentence in six
missions that comes near a moral — it is a fact about a score that does not go
up.

> **Beat 6 is gated on measurement and this sheet carries the fallback.**
> `design.md` §5.3 and O-KR4: `playtest` runs the scripted plan first and reads
> `roeScore`; **under 65, the mission falls back to `structure_penalty_mult: 1`
> and `fail_below: 55`**. If that happens, beat 6 becomes:
>
> *"Every structure you bring down here is on the bill and there are forty of
> them. The floor is fifty-five, which is the highest this brigade has ever been
> asked to hold."*
>
> 167 chars, two sentences, one beat — verified. **Do not ship both dials.**

**Beat 7 closes on the cost.** *Be able to say what is still standing* is the
same shape as `tel_marum_3_clearance`'s shipped debrief — *"the only part of this
I will be asked about"* — and it is an order about a report, not a sermon.

**The JSON string, to be pasted whole:**

> The man running this block is inside the civic hall in the ward, and the hall is the one building here that nothing of ours will fire on by itself. It is not shot at, not breached and not brought down by anybody acting on his own. You have nobody with you who can level it, and that is deliberate. Hurt his people hard enough and he leaves it on his own feet, which is the only way he comes out. The lanes and the road east are laid the way they were laid last week. Whatever you identified then comes back with its ambush spent; whatever you did not gets its first shot. Clear the souk and hold it twenty seconds without a break. Eight families are in that quarter and six of them have to be inside the ward in five minutes. The carriers hold eleven between them, so the clock is the only thing standing between you and all eight. Nothing boards until a soldier is inside four tiles of it. Every structure you bring down here is billed at twice the usual, and eight houses is this mission. The floor is fifty and there is no getting a house back. Take the souk, get them in, and be able to say what is still standing.

### 3.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `take_the_souk` | `capture` · `souk` 20 s · **primary** | Clear the souk and hold it for 20 seconds | `OBJECTIVE COMPLETE — Clear the souk and hold it for 20 seconds` |
| `get_six_in` | `evacuate_before` · `ward` ×6 @300 s · **primary** | Get six families into the ward inside five minutes | `OBJECTIVE COMPLETE — Get six families into the ward inside five minutes` |
| `kill_the_block_commander` | `eliminate_hvt` · `kr_hvt_ward` · secondary | Kill the block commander if you can make him leave the hall | `OBJECTIVE COMPLETE — Kill the block commander if you can make him leave the hall` |
| `take_the_store` | `capture` · `store` 15 s · secondary | Take the store on the north road and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the store on the north road and hold it for 15 seconds` |

`take_the_souk` follows `beit_sahwan_3_clearance` (*"Clear the town centre and
hold it for 20 seconds"*) and `qarn_hadid_3_clearance` — same type, same 20 s,
same words.

**`get_six_in` completes the ladder in the label**: *two* / *four* / *six*, one
word changed each time, on the same ground, so the three toasts are directly
comparable. That is the mechanism §7 argues for and it lives entirely in these
three strings.

**`kill_the_block_commander` teaches the mechanic in its own label**, which is
unusual and is the right call here. The conditional is honest: he is garrisoned
in a structure the sim will not engage, this force has nobody who can level it,
and the only route is making him walk out. A label reading *"Kill the block
commander"* would promise a shot the player cannot take and would read as a bug
on a `?renderer=pixi` or `&nomesh` client, **where the hall does not draw at
all** (§13 **G-H**). It is also the only objective in the arc whose text admits
the player may not be able to do it — which is correct, because it is a
secondary and the mission is designed to be won without him.

`take_the_store` names the road because the store's only opening is onto it
(`design.md` §3.1) and because the zone was widened to sixteen open tiles after a
first draft made it unwinnable (KR-A7, §13 **G-K**).

### 3.4 `briefing_video`

**None declared** (§0.6 decision 3). If the lead cuts one, this is the mission
(`design.md` O-KR7) and the field is
`"briefing_video": "video/khan_rafid_3_briefing.mp4"`. What it should show, so
the cut and the text do not fight: **a walled yard between two buildings, from
above, with people walking into it and nothing firing.** Ten seconds, the shape
of the two shipped Tel Marum cuts. It must not show the hall being levelled, must
not show a casualty, and must not show a face — the arc's whole discipline is
that it never depicts what it prices.

### 3.5 `debrief` — victory 148 chars, defeat 137 chars

> **victory** · Idit — *Six of the eight into the ward, and the town is still
> standing. I will write the other two down, the same way I wrote down the ones
> at the compound.*

> **defeat** · Shai — *The souk is ours and the ward is empty. I would rather
> have had it the other way round, and next week somebody will ask me which I
> chose.*

**This is T-KR10 and it is the arc's beat.** Idit reads the count back — the two
things the mission scored, *six* and *still standing*, in one sentence — and then
does the only thing in six missions that reaches back to First Light. *The ones
at the compound* is `marj_perimeter`'s own `compound`, the ground of
`beit_sahwan_breach`, where eleven were outside the wire and two came in. **She
does not say the number, does not say the mission, and does not say what it cost
him**; she says that she keeps a list and that this is another line in it. She is
the one who says the numbers, and here the number she withholds is the whole
point.

Shai's defeat line is the mission's two clocks stated as the choice he actually
made, and it ends on being asked rather than on being wrong. Status **`live`**.

### 3.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Khan Rafid III — What You Keep` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–7, §3.2 | shipped | live |
| `objective(take_the_souk, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear the souk and hold it for 20 seconds` | shipped | live |
| `objective(take_the_souk, complete)` | `radio` | **net** | "Souk is held. The Old Town is ours from Main Street to the north road." | `objectives[].say`; flat, because a 20-second capture is a fact about a map | live |
| `evacuated` (a civilian reaches `civ_refuge`) | `toast` | system | **nothing at all** | §13 **G-B**; eight civilians, six counted, all of it silent | engine |
| `objective(get_six_in, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get six families into the ward inside five minutes` | shipped | live |
| `objective(get_six_in, complete)` | `radio` | **Idit** | "Six into the ward. I have kept this count since the first morning of the war and that is the best of them." | `objectives[].say`; **the arc's one sentence about itself**, and it is a fact about a ledger she keeps rather than a feeling. It fires once, in the sixth of six evacuations | live |
| `objective(get_six_in, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get six families into the ward inside five minutes` | **the only way to lose this mission on a clock**; loses it | live |
| `objective(get_six_in, failed)` @300 s | `radio` | **Shai** | "Five minutes, and six of them were not inside the wall when it ran out. We took ground today and we did not keep the thing we came for." | `objectives[].say_on_fail`; the title said as the failure, once, and never anywhere else in the mission | live |
| `objective(kill_the_block_commander, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the block commander if you can make him leave the hall` | shipped | live |
| `objective(kill_the_block_commander, complete)` | `radio` | **Idit** | "He is down in the street outside the hall. He could have stayed in that building for the rest of the war and we would have had to walk away from him." | `objectives[].say`; **states the mechanic's other half** — the player did not out-shoot him, he left | live |
| `objective(take_the_store, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the store on the north road and hold it for 15 seconds` | shipped | live |
| `objective(take_the_store, complete)` | `radio` | **net** | "Store compound is clear. Nothing comes down the north road into this town without crossing us now." | `objectives[].say` | live |
| wave t=130 s (2 `militia_cell`, `north_road` → `souk_alley`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; **no `say`** — the north-road push is the town's metronome and it has been named twice already | live |
| wave t=250 s (1 `technical` + 1 `moto_rpg`, `kr_west_edge` → `main_street`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; no `say` | live |
| wave t=340 s (2 `militia_cell`, `north_road` → `ward_north_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=340 s | `radio` | **Idit** | "Two sections at the north gate of the ward, and there are families inside it. He is putting rifles into the one compound on this map you cannot answer with a cannon." | `enemy.waves[].say`; the arc's doctrine at the latest possible moment, after the player has committed. **`design.md` §5.3 sites this wave deliberately at 340 s for exactly that** | live |
| **T-KR-g** `zone_entered(souk)` → `the_souk_empties_into_its_own_alleys` (`commit` group `souk` → `souk_alley`) | `toast` | system | `enemy reacts (the_souk_empties_into_its_own_alleys)` | id proposed as prose (§12) | live |
| **T-KR-g** same trigger | `radio` | **net** | "The garrison is out of the blocks and forming in the alleys." | `triggers[].say`; deliberately flat and short — this mission's talking is spent on the hall | live |
| **T-KR-h** `casualties_pct(45)` → `he_walks_out_of_the_hall` (`withdraw_to souk_alley`, group `hall_party`) | `toast` | system | `enemy reacts (he_walks_out_of_the_hall)` | id proposed as prose. **This trigger is the mission.** `playtest` re-runs after it lands (T-KR8's recorded `withdraw_to` risk) | live |
| **T-KR-h** same trigger | `radio` | **Idit** | "He is out of the hall and moving into the souk. He was not going to leave for us; he left because there was nobody left in the block for him to hold it with." | `triggers[].say`; **T-KR8, and §0.3 job 2 landing on a person.** He is not displacing to a better position and he is not being commanded — the building stopped being worth holding and nobody told him either way | live |
| **T-KR-i** `first_contact` → `a_rocket_team_moves_into_the_east_lane` (`spawn` 1 `rpg_team` at `east_lane`) | `toast` | system | `enemy reacts (a_rocket_team_moves_into_the_east_lane)` | id proposed as prose | live |
| **T-KR-i** same trigger | `radio` | **Shai** | "Rocket team into the east lane, on the road we came up. Nothing goes back down it on wheels until somebody clears that." | `triggers[].say`; the withdrawal route priced at the moment it closes | live |
| garrisoned `apartment` at `[34,8]` taking structure fire | `toast` | system | hard-coded structure-damage copy | **T-KR5.** `apartment` is `roe_penalty` 14 and **not** protected, so it can be shot down at 28 under mult 2. **No `say`** — the price is on the score and the player should discover it there | live |
| **T-KR5** the block above the lane, as a line | `radio` | **Idit** | "Two cells in the north-east block, four floors over the east lane. It is not protected, so you can have it — at twenty-eight, which is two houses and a bit." | no event exists to fire it on (§13 **G-A**); written because the ground is priced | engine |
| **T-KR6** a civilian group broken toward the fight | `radio` | **Idit** | "One of those groups has broken the wrong way. They are moving, and they are moving across the street rather than off it." | `CivilianFlight` breaks at suppression > 0.3 and emits no `MissionEvent` an author can hear (§13 **G-A**) | engine |
| `built` at the camp | `toast` | system | `reinforcement deployed — inf_squad` | raw unit id; §13 **G-C** | engine |
| `roe` deduction from a destroyed structure | `toast` | system | hard-coded `roeNotice` copy | at mult 2 this fires at −12 a house; the number beat 6 priced | live |
| `missionEnd(victory)` | `debrief` | **Idit** | §3.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §3.5 | end screen | live |
| `missionEnd(victory)` | `aftermath` | narrator | **none, deliberately** — the act closes at Deir Amun III (§0.6, §6.5) | victory banner | live |

---

## 4. `deir_amun_1_recon` — Deir Amun I — Read the Ground

`recon` · **Captain** · `deir_amun` · requires **R I** · produces **R M C I** ·
`target_minutes` 6 · no economy. **No civilians anywhere in this town, and that
is the story.**

### 4.1 `name`

`Deir Amun I — Read the Ground`

`design.md`'s own name and it is an instruction the mission means literally: the
route the player has to bring down is being dug **now**, so it throws spoil, and
the spoil is readable by any living surface unit of the side
(`trailStrengthFor`) rather than by a detector. **The town's first lesson is that
dirt is intelligence; its last, in III, is that the four routes that matter throw
none.**

### 4.2 `dispatch` — 207 chars

> *Everything that ever came into the Marj came through Deir Amun. The people
> left it in the first week of the war; the district's routes did not, and all
> six of them join the road east under nine empty houses.*

Narrator, story voice. It names the junction, which is `design.md` §2's whole
placement of this town, and it sets the register that separates Deir Amun from
Khan Rafid in one clause: **the people left.** Khan Rafid is a town you can win
and still lose most of; this is a town there is nothing left to keep, and the
fear here is of ground rather than of a man. The last clause hands forward to Act
II without naming Naharin, which is Act III's to name.

### 4.3 `briefing` — 1,059 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Deir Amun is nine houses and a pump yard on the lip of a dry watercourse, and nobody lives in any of it now. What is left is the junction: every route in this district joins the road east under that village. | 207 |
| 2 | **Shai** | A crew is working the western route this morning. Find them, find where it runs, and put it down inside four minutes. | 117 |
| 3 | **Idit** | I have his routes on paper and paper is not identification. A route is on the board only while somebody with a detector is looking at it, and it goes back to a rumour the moment they stop. | 188 |
| 4 | **Idit** | This one is being dug now, so it is throwing spoil along the gully floor, and disturbed earth is something any soldier can read. The ones he finished before the war throw nothing at all. | 186 |
| 5 | **Shai** | Two ways west and they are not the same road. The bed is twenty-seven tiles on foot and nothing on the terrace can see into it; the shoulder is thirty-seven for anything on wheels. | 180 |
| 6 | **Shai** | The engineers set a charge standing still in the open, two tiles from the route, for eight seconds. Get them there with something that can shoot, and bring the west route down. | 176 |

Idit / Shai / Idit / Idit / Shai / Shai. The run of two Idit beats in the middle
is the mission's shape rather than a slip: beats 3 and 4 are one argument in two
halves — what her file cannot do, and what the ground can.

**Beat 1's second clause is the town in five words.** Deir Amun's register is set
by absence, and the briefing states it as a fact about occupancy before it states
anything about the enemy.

**Beat 3 is §0.3 job 1 and it is the arc's intel thesis.** She has what the
prisoner gave up, and it is worthless as identification: `intel.marked_positions`
reveals **units by tag** and cannot pre-reveal a tunnel route (`mission.ts:942`;
CLAUDE.md's own recorded finding, and `design.md` §7 G1). Tunnel visibility is
live and detector-shaped — a route is identified only while a `mark_tunnel`
carrier holds a clear `losRay` to a tile it runs under, and unwatched contact
decays back to unknown. **So GDD §4's "thorough recon → tunnel mouths pre-marked"
is not literal, and this beat is the fiction agreeing with the code.** §14.1
proposes the GDD correction.

**Beat 4 is T-DA2 and it is true of the map, not a colour note.** `da_tn_west`
and `da_tn_pump` carry `dig_tiles_per_s: 0.16` and stamp trail; the four under
the hamlet are `pre_dug` and the schema's own comment says a `pre_dug` route
never stamps any. The last sentence is the only foreshadowing DA III needs.

**Beat 5 is `design.md` §5.4's decision, in tiles.** The gully bed is 27 tiles on
foot and dead ground the whole way (assertion DA-A3); the shoulder route is 37
for a vehicle, because the tributary is sealed to anything wheeled or tracked
over fifteen rows and the only crossing is at the top (DA-A2). **Both numbers are
drafts and `level-scripter` re-measures them through the real `FlowField` before
this ships** — the map has elevation and `UPHILL_PER_LEVEL` will move them.

**Beat 6 is the eight seconds, and it is the longest eight seconds in the arc.**
`CHARGE_RANGE_SQ` is 2 tiles and `tunnel_charge_time_s` is 8, stationary and
unshaken; the clock resets when the team moves (`sim.ts:4440`). *Get them there
with something that can shoot* is the whole of beat 5's consequence in seven
words.

**The JSON string, to be pasted whole:**

> Deir Amun is nine houses and a pump yard on the lip of a dry watercourse, and nobody lives in any of it now. What is left is the junction: every route in this district joins the road east under that village. A crew is working the western route this morning. Find them, find where it runs, and put it down inside four minutes. I have his routes on paper and paper is not identification. A route is on the board only while somebody with a detector is looking at it, and it goes back to a rumour the moment they stop. This one is being dug now, so it is throwing spoil along the gully floor, and disturbed earth is something any soldier can read. The ones he finished before the war throw nothing at all. Two ways west and they are not the same road. The bed is twenty-seven tiles on foot and nothing on the terrace can see into it; the shoulder is thirty-seven for anything on wheels. The engineers set a charge standing still in the open, two tiles from the route, for eight seconds. Get them there with something that can shoot, and bring the west route down.

### 4.4 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `find_the_crew` | `locate` · `da_diggers` ×3 · **primary** | Find the crew working the western route | `OBJECTIVE COMPLETE — Find the crew working the western route` |
| `bring_down_the_west` | `collapse` · `da_west` @240 s · **primary** | Collapse the western route inside four minutes | `OBJECTIVE COMPLETE — Collapse the western route inside four minutes` |
| `find_the_chief` | `locate` · `da_hvt_engineer` · secondary | Find the digging chief on the spoil field | `OBJECTIVE COMPLETE — Find the digging chief on the spoil field` |
| `find_the_gap_gun` | `locate` · `da_watch_gap` · secondary | Identify the rocket team over the west gap | `OBJECTIVE COMPLETE — Identify the rocket team over the west gap` |
| `screen_out` | `survive_until` 300 s · secondary | Stay in the field for five minutes | `OBJECTIVE COMPLETE — Stay in the field for five minutes` |

`bring_down_the_west` follows `beit_sahwan_4_subterranean`'s *"Collapse every
route under the district"* and `beit_sahwan_2_foothold`'s *"Collapse the tunnel
Ashwar is digging under the approach"* — the tree's two `collapse` labels, and
this one names the deadline as `qarn_hadid_2_foothold`'s raze label does.

**`find_the_crew` says *working*, present tense, and that is load-bearing.** The
`digger_crew` at `[9,18]` carries a live `digs: "da_tn_west"` assignment and the
route advances as the mission runs. T-DA1 is the whole of it: a crew still at
work on an order nobody has renewed.

`find_the_chief` is the tag that becomes DA III's `eliminate_hvt`, named the same
way in both missions.

`screen_out` reuses the shared recon id and label. **It cannot fail**; no
`say_on_fail`.

### 4.5 `debrief` — victory 118 chars, defeat 120 chars

> **victory** · Shai — *One route down and the crew with it. Five more on a sheet
> of paper written by a man who has been in a cell for a week.*

> **defeat** · Idit — *The route is still open and the crew is still working it.
> Nobody has told them to stop and there is nobody left who can.*

Shai's line is the arc's ratio said once: one of six, and the other five are an
intelligence product rather than a target list. Idit's is §0.3 job 2 in its
purest form and it is a **defeat** line, which is where it belongs — the front
carrying on without its commander is worse news than a man escaping, and it is
the only place the sheet is allowed to say so plainly. Status **`live`**.

### 4.6 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Deir Amun I — Read the Ground` · *2 primary objectives* | shipped | live |
| mission start | `dispatch` | narrator | §4.2 | title card | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §4.3 | shipped | live |
| `objective(find_the_crew, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the crew working the western route` | shipped | live |
| `objective(find_the_crew, complete)` | `radio` | **Idit** | "That is the crew, and they are still working. Nobody has told them to stop, and the man who would have is in a cell at brigade." | `objectives[].say`; **T-DA1, and the only line in six missions that names his situation directly.** It fires once, on a secondary-shaped primary, in the town where the absence is the subject | live |
| `objective(find_the_chief, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the digging chief on the spoil field` | shipped | live |
| `objective(find_the_chief, complete)` | `radio` | **Idit** | "That is the man running the digging, standing on his own spoil. He is the only one down here who knows where all six of them go." | `objectives[].say`; sets up DA III's `eliminate_hvt` on the same tag and prices it — killing him is not killing a commander, it is closing the last copy of a map | live |
| `objective(find_the_gap_gun, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the rocket team over the west gap` | shipped | live |
| `objective(find_the_gap_gun, complete)` | `radio` | **Idit** | "Rocket team laid on the west gap, which is one of the two ways through the rock line. He is on the board and he does not get a first shot next week." | `objectives[].say`; the carry-over, said at the moment it is bought — this tag is `ambush(4)` in DA II and spawns pre-identified if it was found here | live |
| `objective(bring_down_the_west, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse the western route inside four minutes` | shipped | live |
| `objective(bring_down_the_west, complete)` | `radio` | **Shai** | "West route down. One of six, and the other five are on a piece of paper that has never been checked against the ground." | `objectives[].say`; the arc's arithmetic and the setup for both remaining missions | live |
| `objective(bring_down_the_west, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Collapse the western route inside four minutes` | **the only way to lose this mission**; loses it | live |
| `objective(bring_down_the_west, failed)` @240 s | `radio` | **Idit** | "Four minutes, and the route is still open and still growing. They will have another twelve tiles of it by the time anybody comes back." | `objectives[].say_on_fail`; **the failure is a distance, not a death** — the route advances at `dig_tiles_per_s: 0.16`, and the failure the design wants is *"you did not go and look"* | live |
| `objective(screen_out, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for five minutes` | shipped | live |
| wave t=140 s (2 `militia_cell`, `gap_west` → `da_west_head`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=140 s | `radio` | **Idit** | "Two sections down through the west gap for the gully head. They are not defending a village; there is nobody in it. They are defending the work." | `enemy.waves[].say`; **the town's thesis at its first push** — what is defended here is a hole, not a place | live |
| wave t=260 s (1 `rpg_team`, `north_road` → `hamlet_lane`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded; **no `say`** — the second wave arriving in an empty village needs no gloss and the first one has the argument | live |
| **T-DA-a** `zone_entered(da_west)` → `the_crew_stops_digging_and_turns_round` (`commit` group `da_diggers` → `da_west_head`) | `toast` | system | `enemy reacts (the_crew_stops_digging_and_turns_round)` | id proposed as prose (§12) | live |
| **T-DA-a** same trigger | `radio` | **net** | "The crew has stopped digging. They are coming up onto the shoulder with the section that was covering them." | `triggers[].say`; net and flat — a position report, and the mission's talking is spent on the file and the dirt | live |
| **T-DA-b** `first_contact` → `the_bed_is_a_road_and_it_is_theirs` (`spawn` 1 `militia_cell` at `wadi_bend`) | `toast` | system | `enemy reacts (the_bed_is_a_road_and_it_is_theirs)` | id proposed as prose | live |
| **T-DA-b** same trigger | `radio` | **Idit** | "There is a section in the bed behind you. That watercourse is not dead ground for them — it is a road, and it is theirs." | `triggers[].say`; **the dead ground cuts both ways**, which is DA-A3's own geometry said from the other side | live |
| `SimEvent surfaced` — the two `in_tunnel` cells on `da_tn_lane` venting at `[27,18]` | `radio` | **Shai** | "Up behind you, out of the spoil field. That ground was ours ten minutes ago and it has a door in it." | **T-DA3.** An `in_tunnel` placement vents on its own; **no trigger fires and `describeMissionEvent` has no case**, so the arc's signature event is silent (§13 **G-A**) | engine |
| `SimEvent tunnelContact` (side 0, `identified`) | `eva` | the brigade net | "Route identified." | §10; the campaign's set has `ventOpened` and `tunnelCollapsed` and not this | engine |
| `SimEvent tunnelContact` (side 0, `lost`) | `eva` | the brigade net | "Contact lost." | §10; **the arc's one genuine EVA delta** | engine |
| `missionEnd(victory)` | `debrief` | **Shai** | §4.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §4.5 | end screen | live |

---

## 5. `deir_amun_2_foothold` — Deir Amun II — Set the Charges

`foothold` · **Captain** · `deir_amun` · requires **R I** · produces **R M C** ·
`target_minutes` 7 · **economy: yes** (`logistics_start` 400, 120/min).
**Two primaries on one rectangle, and one of them says stay while the other says
finish.**

### 5.1 `name`

`Deir Amun II — Set the Charges`

`design.md`'s own name, plural and deliberate: there are two `yahalom_squad` and
one route, and the mission's flexibility is entirely in how the player divides
them. It is also the only title in the arc that names a **task** rather than a
place, which is right for the one mission whose difficulty is a procedure.

### 5.2 `briefing` — 898 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The pump yard is a walled compound with one gate, on the south side, and a route runs up into it. The mouth is inside the wall, so the ground you are being told to hold is a door. | 179 |
| 2 | **Shai** | Hold the yard for four minutes and bring that route down in the same four minutes. Neither clock waits for the other. | 117 |
| 3 | **Idit** | It is stocked, and whoever is in it comes up in the wadi bed behind you rather than through your gate. They will do it while your engineers are kneeling on the mouth. | 166 |
| 4 | **Shai** | Two Yahalom teams, and the charge is eight seconds of standing still that resets the moment they move. Send both and the yard is thin; send one and he works under contest, which is the same as not working. | 205 |
| 5 | **Shai** | The camp is on the bank four tiles from the centre ford and in plain view of their street. Not everything that comes south is coming for the yard. | 146 |
| 6 | **Shai** | Hold the gate, put the route down, and keep something between them and the camp. | 80 |

Idit / Shai / Idit / Shai / Shai / Shai. **The shortest briefing in the arc at
898 characters**, and it should be: this mission is one idea, and the idea is
already the shortest sentence in it.

**Beat 1 is T-DA4 and it is the arc's second-best line.** `da_tn_pump`'s mouth is
at `[16,26]`, inside zone `pump_yard [12,23,7,6]`, and the yard has exactly one
gate at `[15,28]` from the south. *The ground you are being told to hold is a
door* is the mission title said as a fact about a map, and everything in the
briefing after it is consequence.

**Beat 3 is the vent, priced.** Two `rpg_team` are stocked `in_tunnel:
"da_tn_pump"` and surface at `[20,30]` — in the wadi bed, **behind** the player,
not at the gate he is defending. *While your engineers are kneeling on the mouth*
is the timing rather than a warning: a charge is eight stationary seconds and
that is when it happens.

**Beat 4 is the whole decision in two clauses**, and the second is the mechanic:
the charge clock resets when the team moves (`sim.ts:4440`), so a Yahalom working
under contest is not working slowly, he is not working. `hold_for` is cumulative
and pauses on contest (`contestedIn`), so the two primaries genuinely compete for
the same bodies.

**Beat 5 is T-DA6 and the reason this is a foothold rather than a picnic.** The
`camp` sits at `[26,34]` on the wadi's south lip, four tiles from `ford_centre`
and in plain view of the hamlet. GDD §4's foothold is *"establish the FOB under
harassment"*, and the 340 s wave is routed at `ford_centre` rather than at the
objective. **The briefing warns about it in one flat sentence and never mentions
it again**, so a player who forgets is caught by the wave and not by a repetition.

**Beat 6 closes on three verbs and no adjective.**

**The JSON string, to be pasted whole:**

> The pump yard is a walled compound with one gate, on the south side, and a route runs up into it. The mouth is inside the wall, so the ground you are being told to hold is a door. Hold the yard for four minutes and bring that route down in the same four minutes. Neither clock waits for the other. It is stocked, and whoever is in it comes up in the wadi bed behind you rather than through your gate. They will do it while your engineers are kneeling on the mouth. Two Yahalom teams, and the charge is eight seconds of standing still that resets the moment they move. Send both and the yard is thin; send one and he works under contest, which is the same as not working. The camp is on the bank four tiles from the centre ford and in plain view of their street. Not everything that comes south is coming for the yard. Hold the gate, put the route down, and keep something between them and the camp.

### 5.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `hold_the_yard` | `hold_for` · `pump_yard` 240 s · **primary** | Hold the pump yard for four minutes | `OBJECTIVE COMPLETE — Hold the pump yard for four minutes` |
| `shut_the_door` | `collapse` · `pump_yard` @240 s · **primary** | Collapse the route under the pump yard inside four minutes | `OBJECTIVE COMPLETE — Collapse the route under the pump yard inside four minutes` |
| `take_the_store_yard` | `capture` · `store_yard` 15 s · secondary | Take the store compound and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the store compound and hold it for 15 seconds` |
| `kill_the_gap_gun` | `eliminate_hvt` · `da_watch_gap` · secondary | Kill the rocket team over the west gap | `OBJECTIVE COMPLETE — Kill the rocket team over the west gap` |

**`shut_the_door` is the one objective id in the arc that is a metaphor**, and it
earns it: the id is never shown to the player (only `triggers[].id` is), and the
`text` is literal — *the route under the pump yard*. The id is for
`level-scripter` and for whoever reads the JSON in a year.

`hold_the_yard` and `shut_the_door` **name the same rectangle in two objectives**,
deliberately, because that is the mission. A player who reads both labels on the
deploy screen has already been told the problem.

`kill_the_gap_gun` is DA I's `find_the_gap_gun` tag with the verb changed —
the same two-mission construction Khan Rafid uses for the west lane and Qarn
Hadid uses for the bench post.

### 5.4 `debrief` — victory 143 chars, defeat 128 chars

> **victory** · Idit — *The yard is ours and the door under it is shut. He built
> this place so that holding a piece of ground and standing on a door were the
> same act.*

> **defeat** · Shai — *We held the yard for four minutes and left the way in open
> underneath it. Everything we did today we did standing on their road.*

Idit's victory line is the front's doctrine stated as an architectural fact, in
the past tense, about a man who is not here — which is the only tense this arc is
allowed to use for him. Shai's defeat line is the same sentence from the losing
side and it is the closest the arc comes to a joke. Status **`live`**.

### 5.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Deir Amun II — Set the Charges` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §5.2 | shipped | live |
| `objective(hold_the_yard, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold the pump yard for four minutes` | shipped | live |
| `objective(hold_the_yard, complete)` | `radio` | **net** | "Pump yard held, four minutes. One gate, and it stayed ours." | `objectives[].say`; flat, and T-DA5 in six words | live |
| `objective(shut_the_door, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse the route under the pump yard inside four minutes` | shipped | live |
| `objective(shut_the_door, complete)` | `radio` | **Shai** | "The route under the yard is down. Whatever was still in it is not coming up anywhere." | `objectives[].say`; **literally true** — `collapseTunnel` kills everyone stocked in the route (`sim.ts:4578`), and the line states it without celebrating it | live |
| `objective(shut_the_door, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Collapse the route under the pump yard inside four minutes` | **the only way to lose this mission**; loses it. `hold_for` never even starts for a passive player | live |
| `objective(shut_the_door, failed)` @240 s | `radio` | **Shai** | "Four minutes on the charge and the mouth is still open inside the wall. We are holding a yard with a door in the floor of it." | `objectives[].say_on_fail`; beat 1 returned as the failure | live |
| `objective(take_the_store_yard, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the store compound and hold it for 15 seconds` | shipped | live |
| `objective(take_the_store_yard, complete)` | `radio` | **net** | "Store compound is clear. The east road is watched from our side of it now." | `objectives[].say` | live |
| `objective(kill_the_gap_gun, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the rocket team over the west gap` | shipped | live |
| `objective(kill_the_gap_gun, complete)` | `radio` | **Shai** | "The gap is clear. That is one of the two ways through the rock line and it is the one their reinforcements use." | `objectives[].say`; states what the secondary bought — the 110 s and 340 s waves both come through a gap | live |
| wave t=110 s (2 `militia_cell`, `gap_west` → `pump_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; **no `say`** — a push at the objective in the mission's second minute explains itself | live |
| wave t=230 s (1 `rpg_team` + 1 `moto_rpg`, `north_road` → `hamlet_lane`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; no `say` | live |
| wave t=340 s (2 `militia_cell`, `gap_east` → `ford_centre`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=340 s | `radio` | **Idit** | "Two sections across the centre ford. They are not going to the yard — they are going to the camp on the bank, and the camp is four tiles from that ford." | `enemy.waves[].say`; **T-DA6**, and the one moment in the mission where the answer is behind the player | live |
| **T-DA-c** `zone_entered(pump_yard)` → `the_village_comes_down_to_the_yard` (`commit` group `hamlet` → `pump_gate`) | `toast` | system | `enemy reacts (the_village_comes_down_to_the_yard)` | id proposed as prose (§12) | live |
| **T-DA-c** same trigger | `radio` | **Idit** | "The village is coming down the lane at the yard. There are nine houses up there and not one person in them; every body on that street is a fighter." | `triggers[].say`; **the town's own ROE inversion, said once.** Khan Rafid's streets are full of people and this one is not, and the difference is what the two towns are for | live |
| **T-DA-d** `casualties_pct(40)` → `the_yard_party_falls_back_up_the_lane` (`withdraw_to hamlet_north`, group `yard`) | `toast` | system | `enemy reacts (the_yard_party_falls_back_up_the_lane)` | id proposed as prose. **`playtest` re-runs after this lands** | live |
| **T-DA-d** same trigger | `radio` | **net** | "The yard party is out of the pump house and going north up the lane." | `triggers[].say`; flat position report | live |
| **T-DA-e** `timer_s(180)` → `a_charge_squad_comes_down_the_lane` (`spawn` 1 `charge_squad` at `hamlet_lane`) | `toast` | system | `enemy reacts (a_charge_squad_comes_down_the_lane)` | id proposed as prose | live |
| **T-DA-e** same trigger | `radio` | **Shai** | "Charge squad down the lane. Get the engineers off the mouth or get something between him and them." | `triggers[].say`; the one enemy unit that can end a charge outright, named as a decision | live |
| `SimEvent surfaced` — the two `rpg_team` on `da_tn_pump` venting at `[20,30]` | `radio` | **Shai** | "They are up out of the bed behind the yard. The thing you are holding was always a door and it opens from their side." | **T-DA4's payoff, and it is silent today** (§13 **G-A**). The cheap-and-worse fallback is a `timer_s(150)` `say`, **rejected**: it fires whether or not they have vented, and a line about something that has not happened reads as a bug | engine |
| `built` at the camp | `toast` | system | `reinforcement deployed — inf_squad` | raw unit id; §13 **G-C** | engine |
| `SimEvent destroyed` on a `yahalom_squad` | `radio` | **Shai** | "That was one of the demolition teams. Whatever is still open at four minutes stays open." | needs a sim-watching trigger (§13 **G-A**) | engine |
| `missionEnd(victory)` | `debrief` | **Idit** | §5.4 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §5.4 | end screen | live |

---

## 6. `deir_amun_3_subterranean` — Deir Amun III — All Four

`subterranean` · **Captain**, and the act's promotion lands **after** this
mission · `deir_amun` · requires **R I** · produces **R M C I** ·
`target_minutes` 7 · **economy: yes** (`logistics_start` 500, 90/min — exactly
`beit_sahwan_4_subterranean`'s). **Act I closes here, and this is the only
mission in the game where the enemy is the map.**

### 6.1 `name`

`Deir Amun III — All Four`

`design.md`'s own name. It is a count, it is the primary objective, and it is the
only title in the arc that is a number — which is right for the mission whose
whole problem is that the player cannot hold four things in his hand at once.

### 6.2 `briefing` — 1,094 chars, 7 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | There are four routes under this village and every one was finished before the war, so none of them throws spoil. The only thing that can find them is a man with a detector and a clear line to the ground they run under. | 219 |
| 2 | **Idit** | You cannot hold all four at once. Contact goes cold about sixteen seconds after the last eye leaves it, and the drone is a pointer rather than a scout, blind behind a building exactly like a rifleman. | 200 |
| 3 | **Shai** | Work them in an order and mean it. Bringing one down kills whoever is stocked in it, so what you drop first decides which of the rest comes up behind you. | 154 |
| 4 | **Shai** | One of them surfaces on your own road east. Whatever you leave standing there is standing under your armour. | 108 |
| 5 | **Idit** | The chief is on the spoil field north of the village, a level above everything around it, on ground his own crews raised. He does not go underground and he will not leave it. | 174 |
| 6 | **Shai** | The Lavi's gun and the mortar are billed by the ten seconds in that village and there is nothing in it worth the money. Rifles and the Eitan's fifty are free. | 158 |
| 7 | **Shai** | Bring all four down inside five minutes, and take the chief off that spoil. | 75 |

Idit / Idit / Shai / Shai / Idit / Shai / Shai. **Her two beats open it because
this is the one mission in the game whose difficulty is epistemic** — what can be
known, for how long, and by whom — and that is her register with nothing else in
it.

**Beat 1 is the map's teaching order arriving at its conclusion.** Deir Amun I
taught that dirt is intelligence; this says the four that matter throw none. A
`pre_dug` route never stamps trail (`sim.ts:2710`), so `mark_tunnel` is the only
channel, and *a clear line to the ground they run under* is `markerSeesRoute`
stated exactly — a clear `losRay` from a living carrier to a tile the route runs
beneath.

**Beat 2 is T-DA7 and it is the honest version.** The runtime emits
`tunnelContact` at `lost` and **a mission trigger cannot fire on a `SimEvent`**
(§13 **G-A**), so the decay can only be said once, up front, and discovered
afterwards. *About sixteen seconds* is `design.md`'s own measurement (~322
ticks). The drone clause is the one thing a player will otherwise get wrong:
`recon_drone` has `mark_tunnel` and sight 16, but `moveDomain` gives an air unit
the **foot** flow field (`sim.ts:488`) and it is blinded by a building exactly
like a rifleman. **So it is a pointer, not a scout**, and the briefing has to say
so or the mission reads as broken.

**Beat 3 is the whole decision.** `collapseTunnel` kills whoever is stocked in a
route (`sim.ts:4578`), and the four routes hold two `rpg_team`, two
`militia_cell`, an `rpg_team` and a `militia_cell`, and two `militia_cell`
respectively. **The order the player picks decides which groups get to vent
behind him and which never surface at all** — and that is a real strategic choice
made out of four `collapse` targets and nothing else.

**Beat 4 is T-DA8.** `da_tn_east` vents at `[41,19]`, on the east road the
player's own armour uses.

**Beat 5 is T-DA9 and it is characterisation with no adjective in it.** The chief
stands on `spoil_field [22,16,13,3]` at elevation 4 — a level above the terrace
**because his own crews put it there** — and `casualties_pct(50) → withdraw_to
spoil_field_centre` concentrates the last fight on it. He is on the surface
because a buried unit cannot be shot (`sim.ts:2483`).

**Beat 6 is the bill, and it is the shortest ROE line in the arc because the
village is empty.** `mbt_lavi` `gun_120` is `collateral_risk` 0.55 and
`mortar_team` `mortar_60` is 0.70; both arm the flagged-zone deduction at −5 per
ten seconds inside `hamlet`, at `fail_below: 45`. *There is nothing in it worth
the money* is the point: **Deir Amun's ROE pressure is not about people, it is
about spending a score on nine empty houses**, which is the exact inversion of
Khan Rafid.

**Beat 7 is two verbs and no summary.** The act does not end on a sentence about
the act; the `aftermath` does that, once.

**The JSON string, to be pasted whole:**

> There are four routes under this village and every one was finished before the war, so none of them throws spoil. The only thing that can find them is a man with a detector and a clear line to the ground they run under. You cannot hold all four at once. Contact goes cold about sixteen seconds after the last eye leaves it, and the drone is a pointer rather than a scout, blind behind a building exactly like a rifleman. Work them in an order and mean it. Bringing one down kills whoever is stocked in it, so what you drop first decides which of the rest comes up behind you. One of them surfaces on your own road east. Whatever you leave standing there is standing under your armour. The chief is on the spoil field north of the village, a level above everything around it, on ground his own crews raised. He does not go underground and he will not leave it. The Lavi's gun and the mortar are billed by the ten seconds in that village and there is nothing in it worth the money. Rifles and the Eitan's fifty are free. Bring all four down inside five minutes, and take the chief off that spoil.

### 6.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `all_four` | `collapse` · `hamlet` @300 s · **primary** | Collapse all four routes under the village inside five minutes | `OBJECTIVE COMPLETE — Collapse all four routes under the village inside five minutes` |
| `kill_the_chief` | `eliminate_hvt` · `da_hvt_engineer` · **primary** | Kill the digging chief on the spoil field | `OBJECTIVE COMPLETE — Kill the digging chief on the spoil field` |
| `clear_the_ground` | `destroy_all` · secondary | Clear everything Ashwar still has above ground here | `OBJECTIVE COMPLETE — Clear everything Ashwar still has above ground here` |
| `screen_out` | `survive_until` 300 s · secondary | Stay in the field for five minutes | `OBJECTIVE COMPLETE — Stay in the field for five minutes` |

**`all_four` says the count in the label**, which no shipped `collapse` label
does — `beit_sahwan_4_subterranean`'s is *"Collapse every route under the
district"*. The difference is deliberate and it is the mission: *every* is a
sweep and *all four* is a sequencing problem with a known denominator, and the
player needs the denominator on the deploy screen.

**`kill_the_chief` is a job title and never a name** (`design.md` D11). The
shipped register for this is `wadi_halam_3_counterraid`'s *"Kill or capture
Hallaq's local commander"*; here there is no possessive available, because the
man whose name would go in it is in a cell and the chief does not report to
anybody. **That absence is the arc and it is why the label is bare.**

**`clear_the_ground` says *above ground* on purpose.** `destroy_all` completes
when every id in `enemyIds` is dead, and collapsing a stocked route kills
everyone in it — so the secondary usually falls out of the primary. The label
tells the player which half of the map it is about, and `design.md` §4 explains
why it is a secondary and not a primary: waves append to `enemyIds`, and a
`destroy_all` primary with a wave clock behind it can extend a mission
indefinitely — the exact failure CI cannot see.

`screen_out` reuses the shared id and label. **It cannot fail**; no
`say_on_fail`.

### 6.4 `debrief` — victory 174 chars, defeat 132 chars

> **victory** · Idit — *All four, and the file on this district closes tonight.
> Taking the man never stopped any of it — the ground was the thing he was, and
> there is none of it left under here now.*

> **defeat** · Shai — *The village is standing on four open routes and we are
> going home. This district works tomorrow exactly the way it worked yesterday.*

**Idit's victory line is where the arc says its own thesis, once, at the last
possible moment, and nowhere else.** *Taking the man never stopped any of it* is
the honest reading of D-KR1 — it does not claim the capture was a mistake, and it
does not claim it was enough; it says which of the two things the front actually
was. **The file closing is hers because the file is hers**, and it is the same
file KR I's beat 1 said was answering questions and not helping.

Shai's defeat line is a front that continues, which is the only defeat this arc
can have. Status **`live`**.

### 6.5 `aftermath` — Act I closes — 173 chars

> *Six routes under the junction, and by morning none of them went anywhere.
> Brigade put a third star on the slip and said nothing else about it. The Marj
> is quiet. Sur is not.*

**The last two sentences are `beit_sahwan_4_subterranean`'s own, verbatim, and
that is a relocation rather than a duplication.** They are the act boundary and
the promotion, they belong wherever Act I ends, and Act I now ends here —
`world.json` already places Khan Rafid and Deir Amun between Beit Sahwan and Sur,
and `design.md` C4 requires `commander.json`'s Captain entry to run to
`deir_amun_3_subterranean` or Shai is a Major for all six of these missions.
Three stars is Major (`storyline.md` §2.1).

The first sentence is the arc's own: **six**, because the town's `tunnels` block
carries six routes and the arc brings down one in DA I, one in DA II and four
here. It claims no capture, promotes nobody but Shai, and hands forward on the
same two sentences the campaign already uses to hand forward.

**This line cannot ship until `beit_sahwan_4_subterranean`'s `aftermath` gives up
its own third star** (§0.6 decision 2, §14.2). Status **`live`** — the field
exists and is rendered on the victory banner — but it is **blocked on a one-string
edit in another town's mission file**, which is a request with an owner and not a
change this sheet may make.

### 6.6 The thread out, into Act II

Idit's `debrief.victory` and the `aftermath` between them hand Act II three
facts and no more: the Marj is finished, the road east out of Deir Amun is where
everything that came into the Marj came from, and Shai has a third star he did
not ask for. `tel_marum_1_recon`'s shipped briefing then opens on *"Rockets have
been falling on the north for a week and nobody can say from where"* — which is
the exact inversion of the town just left. **Here the enemy was ground the player
was standing on; there he is a man nobody can find.** Nothing in Tel Marum I
needs a word changed for that to work, and **this sheet changes nothing there.**

The one content dependency running the other way is `design.md` C3 / O-KR1:
Sur's `unlock.after_mission` is `beit_sahwan_4_subterranean` today and the design
recommends moving it here. That is the lead's call, it changes the campaign's
shape rather than its text, and **no line in this sheet assumes it either way.**

### 6.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Deir Amun III — All Four` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–7, §6.2 | shipped | live |
| `objective(all_four, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Collapse all four routes under the village inside five minutes` | shipped | live |
| `objective(all_four, complete)` | `radio` | **Shai** | "All four down. There is nothing under this village any more, and that is the last of the district." | `objectives[].say`; the act's mechanical ending, said in the orders voice and left there — the story voice gets it in the `debrief` and the `aftermath` | live |
| `objective(all_four, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Collapse all four routes under the village inside five minutes` | **the only way to lose this mission on a clock**; loses it | live |
| `objective(all_four, failed)` @300 s | `radio` | **Idit** | "Five minutes. Whatever is still open under that village is open for good, and there is nobody left who has to be told where it runs." | `objectives[].say_on_fail`; **the absence at the worst moment** — the routes outlive everyone who knew about them, which is the front's whole property | live |
| `objective(kill_the_chief, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the digging chief on the spoil field` | shipped | live |
| `objective(kill_the_chief, complete)` | `radio` | **Idit** | "The chief is down on his own spoil. He was digging to a plan drawn before the war by a man who has not seen this ground in years." | `objectives[].say`; **the arc's `eliminate_hvt` is not a duel and the line says so.** No `enemy` speaker, no name, no last words | live |
| `objective(clear_the_ground, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear everything Ashwar still has above ground here` | shipped | live |
| `objective(clear_the_ground, complete)` | `radio` | **net** | "Nothing of theirs is standing above ground in Deir Amun." | `objectives[].say`; flat and short — a `destroy_all` completing is a count, not an event | live |
| `objective(screen_out, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for five minutes` | shipped | live |
| wave t=120 s (2 `militia_cell`, `gap_east` → `hamlet_north`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; **no `say`** | live |
| wave t=250 s (1 `rpg_team` + 1 `technical`, `gap_west` → `hamlet_lane`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=250 s | `radio` | **Idit** | "One rocket team and a technical through the west gap. That is the last of what the plateau can send; after this he is spending what is underground." | `enemy.waves[].say`; **there is no third wave** (`design.md` §5.6) and this line is why — the pressure from here on is the four clocks and the venting | live |
| **T-DA-f** `zone_entered(hamlet)` → `the_village_comes_out_of_its_houses` (`commit` group `hamlet` → `hamlet_lane`) | `toast` | system | `enemy reacts (the_village_comes_out_of_its_houses)` | id proposed as prose (§12) | live |
| **T-DA-f** same trigger | `radio` | **net** | "They are out of the houses and into the lanes between the mouths." | `triggers[].say`; flat, and it names the geography the player has to work in | live |
| **T-DA-g** `casualties_pct(50)` → `he_falls_back_onto_his_own_spoil` (`withdraw_to spoil_field_centre`, group `chief`) | `toast` | system | `enemy reacts (he_falls_back_onto_his_own_spoil)` | id proposed as prose. **`playtest` re-runs after this lands** | live |
| **T-DA-g** same trigger | `radio` | **Idit** | "He has gone back onto the spoil field. It is the only high ground on this map and his own crews built it out of the routes you are here to bring down." | `triggers[].say`; **T-DA9, and the best sentence in Deir Amun** — the last position is made of the objective | live |
| **T-DA-h** `timer_s(210)` → `a_charge_squad_comes_for_the_engineers` (`spawn` 1 `charge_squad` at `hamlet_north`) | `toast` | system | `enemy reacts (a_charge_squad_comes_for_the_engineers)` | id proposed as prose | live |
| **T-DA-h** same trigger | `radio` | **Shai** | "Charge squad in the lanes, and your engineers are the only thing on this map that has to stand still. Cover them or move them." | `triggers[].say` | live |
| `SimEvent surfaced` — any of the four stocked routes venting | `radio` | **Shai** | "Up behind you, out of a mouth nobody was watching. That is one you did not get to first." | **T-DA3, and the mission's signature event, and it is silent** (§13 **G-A**). Four separate vents, four separate places, no line and no toast for any of them | engine |
| `SimEvent tunnelContact` (side 0, `identified`) | `radio` | **Idit** | "Route identified. Hold the eye on it — the moment nobody is looking it goes back to a rumour." | **T-DA7 in its literal form**; the line already exists in `beit_sahwan/narrative.md` §6.5 and is still `engine` for the same reason | engine |
| `SimEvent tunnelContact` (side 0, `lost`) | `eva` | the brigade net | "Contact lost." | §10; **the arc's EVA delta**, and it is the one announcement this mission genuinely needs | engine |
| `SimEvent tunnelCollapsed` (each of the four) | `eva` | the brigade net | "Route collapsed." | the campaign set already carries it (`beit_sahwan/narrative.md` §8) | engine |
| `built` at the camp | `toast` | system | `reinforcement deployed — inf_squad` | raw unit id; §13 **G-C** | engine |
| `missionEnd(victory)` | `debrief` | **Idit** | §6.4 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §6.4 | end screen | live |
| `missionEnd(victory)` | `aftermath` | narrator | §6.5 | victory banner; **blocked on §14.2** | live |

---

## 7. The ward, asked three times

`evacuate_before` is a primary in **all three** Khan Rafid missions, on the
**same zone**, with counts 2 → 4 → 6 and an ROE floor of none → 45 → 50. No town
in the game has ever used the type twice. This section exists because writing the
same objective three times is how an arc becomes a chore, and the three askings
have to be **three different sentences about three different problems**.

| | KR I | KR II | KR III |
|---|---|---|---|
| **the count** | 2 of 4 | 4 of 6 | 6 of 8 |
| **the constraint** | **seats and distance.** Four seats, one street, thirty tiles | **the flagged zone.** The ward is the refuge *and* the thing being held *and* the thing you may not fire into | **the clock alone.** Eleven seats for eight people |
| **the sentence that carries it** | *"Four seats, one street and thirty tiles — that arithmetic does not get better by being braver."* (debrief) | *"Four have to be inside that wall in five minutes; the wall will hold all six."* (beat 3) | *"The carriers hold eleven between them, so the clock is the only thing standing between you and all eight."* (beat 5) |
| **who says it** | Shai, as transport | Idit, as capacity | Shai, as speed |
| **what the player learns** | the reach is the bill | the safest ground is the ground he cannot use his guns on | the shortfall is now his own |

**The escalation is that the excuse is removed, one mission at a time.** In KR I
the player physically cannot take all four — two carriers, two seats each, and
one of them is also the only thing that can reach anything east. In KR II the
capacity arrives and the *permission* does not: there is room for all six inside
a compound he may not fight in. In KR III there are eleven seats for eight
people, and if two are left in an alley it is because of how he spent five
minutes. **The mission gets easier to succeed at and harder to feel good about,
and no line ever says the second half.**

**Why First Light is named exactly once, and not by Shai.** `storyline.md` §2.1:
*"He got two families through the wire and nine did not come in. He has never
said the number aloud and has never had to."* So he does not say it here. Idit
does — *"I will write the other two down, the same way I wrote down the ones at
the compound"* (§3.5) — and even she withholds the number, because §2.2 makes her
*"the one who says the number Shai will not"* and the strongest version of that
is a woman saying she keeps a list. **One reference, in the arc's last Khan Rafid
line, in the story voice, on the end screen.** Nowhere in any briefing; nowhere
in the orders voice at all.

**The one thing that would break it**, and it is `playtest`'s to check before
anything else about this arc (`design.md` §5.8 step 2): **if a player can win the
evacuations by frightening people instead of fetching them, the whole arc
inverts.** `CIV_FLEE_AT` is 0.3 suppression and a fleeing civilian walks to the
refuge on its own. The design defends with siting — every enemy indirect weapon
short of every civilian group — but that is arithmetic and not a measurement. If
the probe wins, **no line in this sheet survives contact with it**, and the fix
is the map, never the count.

---

## 8. Nadir Sahim across the arc, and why he does not speak

`design.md` §5.7 gives his presence mission by mission. This sheet's job is to
make sure the player meets it as **things** and never as a voice.

| mission | what he did | the line that carries it | speaker |
|---|---|---|---|
| **KR I** | chose a town with a clinic, a hall and a market day, and put his fire plan around all three | *"Three posts, and not one of them can put a round inside the ward. Every one of them can put a round on anybody crossing to it. That is not an accident of ground; it was laid that way."* | Idit |
| **KR II** | built a compound the KDF would not fire into, so it would be the safest place in the enclave — for him | *"Not round it and not at the gates — into it, because it is the one piece of ground on this map where your guns are the ones that cost you."* | Idit |
| **KR III** | put the man running the block inside the one building the sim refuses to engage | briefing beats 1–2, and *"He was not going to leave for us; he left because there was nobody left in the block for him to hold it with."* | Idit / Shai |
| **DA I** | left a crew digging | *"Nobody has told them to stop, and the man who would have is in a cell at brigade."* | Idit |
| **DA II** | dug a route that opens inside a walled yard | *"He built this place so that holding a piece of ground and standing on a door were the same act."* | Idit |
| **DA III** | finished four routes before the war and left no spoil on any of them | *"He was digging to a plan drawn before the war by a man who has not seen this ground in years."* | Idit |
| **the arc** | is never on either map, and is never quoted | *"Taking the man never stopped any of it — the ground was the thing he was."* | Idit, `debrief.victory`, once |

**Six lines, all Idit's, all in the past tense, all about a decision rather than
a person.** That is the only tense available: he is in a cell, so everything he
did here he did before the game started, and the arc's discipline is that the
present tense belongs to the people still carrying his plan out.

**No `enemy` line ships**, for three reasons in ascending weight.

1. **Scarcity.** `tel_marum/narrative.md` §7.5 records that a villain speaks
   *once* in an act. Act I's one has been spent or has not been written; either
   way an interlude is not where it goes.
2. **He is not there.** An `enemy` `say` is intercepted traffic from the front's
   commander. This front has none, which is the arc's subject, and giving it a
   voice would undo six missions of writing in one line.
3. **The portrait, which is mechanical and decides it.** `commander.json`'s
   `villains` block maps region → portrait and `marj` → `nadir_sahim.png`
   (`campaign.ts:364`). The commander bar paints the `enemy` speaker with that
   face (`hud.ts` `paintFace`), while `speakerPlate` still answers the literal
   word `ENEMY` — a face, never a name (`storyline.md` G18). **So an `enemy` line
   in a Khan Rafid or Deir Amun mission puts Sahim's face on the screen for words
   spoken by somebody who is not him and could not be**, in the one arc built on
   his not being there.

One line is written and **HELD**, so the lead can overrule §8 with a line in
front of him rather than a description of one. It would sit on
`he_walks_out_of_the_hall`, KR III, the one moment on either map that is purely
the block commander's:

> *Nobody is coming to tell you what to do. Hold the block, keep the lanes, and
> do not give them the compound.* — 107 chars

It is an instruction to his own people with no second person that means the
player, and it is deliberately **not Sahim's** — it is the block commander's, and
that is exactly the problem with shipping it: `sayNotice` and `paintFace` cannot
tell them apart, so the game would present it as the man in the cell.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| **HELD** · KR III `he_walks_out_of_the_hall` | `radio` | **enemy** | the line above | `triggers[].say`; the field is live and the portrait ships. **Not to be authored in this arc** unless the lead overrules §8, and if he does, the portrait mapping needs a per-mission override first | live |

---

## 9. Ambient lore — secondary locations

Ground the player crosses that no objective names. Every marker, zone and tile
range below is `design.md` §3.1's and §3.2's; **neither map file exists yet**, so
`mission-author` re-checks every id against the JSON when it lands. Every line
fires once and stops the game for nobody.

**All twenty-five rows are `engine`, for two reasons at once**: there is no event
to fire them on (a trigger cannot watch a `SimEvent`, and `zone_entered` is
one-shot and already spent on the twists), and the commander bar only carries a
line the sim hands it. They are written now because the ground is specified now.

### 9.1 Khan Rafid

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the staging ground | `kr_start [24,45]` / zone `staging [14,42,21,6]` | `radio` | Shai | "Twenty tiles of open ground and nothing in this town can see it. That is the last of that until we are back on it." | engine |
| the fringe | `o` x14–20 and x28–34, y40–42 | `radio` | Idit | "Thorn scrub and desert trees either side of the approach, cover one. It is the only thing between the start line and the road, and it is a single row deep." | engine |
| the New Quarter | zone `new_quarter [8,28,32,12]` | `radio` | Shai | "Three-tile streets and two apartment blocks. It is the only quarter in this town armour can turn round in, and it is on the wrong side of the road." | engine |
| Main Street | `r` y=25 / `main_street [24,25]` | `radio` | Idit | "One road east to west, the full width of the town, and no cover on any of it. Everything you do here crosses it somewhere." | engine |
| the market | zone `market [30,22,7,5]` / `market_square [32,23]` | `radio` | Idit | "An open square with two stalls, east of the ward. There was a market day here, and there has not been one since the perimeter went." | engine |
| the ward | zone `ward [20,17,9,7]` / `civ_refuge [24,22]` | `radio` | Shai | "Nine by seven, four gates, a clinic and a hall inside one wall. It is the only ground in this town where a family can stand and not be in somebody's field of fire." | engine |
| the hall | `m` at `[27,19]`, `roe_penalty` 30 | `radio` | Idit | "The civic hall is scored at thirty, and nothing of ours engages it on its own initiative. He put the man running the block inside it, which is what he learned from us." | engine |
| the clinic | `k` 3×4, `roe_penalty` 6 | `radio` | Idit | "The clinic is scored at six and it is not protected, so a gunner will answer fire from it. It is four tiles from where the families are counted in." | engine |
| the Old Town | zone `old_town [6,6,33,10]` / `souk_alley [24,11]` | `radio` | Idit | "Eleven blocks on alleys one tile wide. An alley like that gives sight along its own axis and nothing else, which is why every ambush in this town is in one." | engine |
| the two lanes | `west_lane [13,24]`, `east_lane [33,24]` | `radio` | Shai | "Two roads through the Old Town, one tile wide, houses on both sides. Anything that goes wrong in one of them goes wrong for the whole column." | engine |
| the north road | `r` y=5 / `north_road [24,5]` | `radio` | Idit | "The road across the top of the town is his line of communication, and it reaches the store compound before it reaches anything else." | engine |
| the store | zone `store [16,1,8,5]` / `store_gate [19,5]` | `radio` | Shai | "A walled warehouse on the north road with its only opening onto the road itself. Whoever holds it decides what reaches the souk." | engine |

### 9.2 Deir Amun

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the staging ground | `da_start [24,44]` / zone `staging [18,40,14,8]` | `radio` | Shai | "Two roads north out of here and both of them cross the watercourse. There is no third." | engine |
| the south bank | y34–39, `o` groves | `radio` | Idit | "Desert trees on the low terrace. It is the last cover on our side of the wadi, which is why the camp goes behind it and not in front." | engine |
| the wadi | zone `the_wadi [0,29,48,5]` / `ford_west`, `ford_centre`, `ford_east` | `radio` | Idit | "The bed runs the full width of the map and a man crosses it anywhere. Wheels and tracks cross at three fords, thirteen tiles apart." | engine |
| the bed | `wadi_bend [20,31]` | `radio` | Shai | "The bed sits two levels below its own lips. Anything standing in it is invisible from the terrace and blind to it, both at once." | engine |
| the tributary | `b` x9–11, y15–29 / `tributary_lip [12,22]` | `radio` | Idit | "A side gully running north out of the wadi, sealed to anything on wheels for fifteen rows and open at the top. On foot it is the short road west; on tracks it is not a road." | engine |
| the pump yard | zone `pump_yard [12,23,7,6]` / `pump_gate [15,28]` | `radio` | Shai | "One gate, from the south, into a walled yard round a pump house. There is no second way in and there is no second way out." | engine |
| the hamlet | zone `hamlet [18,20,17,8]` / `hamlet_lane [28,23]` | `radio` | Idit | "Nine buildings on lanes one tile wide, and nobody in any of them. There was a market here too, before what was under it was worth more than what was on top." | engine |
| the spoil field | zone `spoil_field [22,16,13,3]` / `spoil_field_centre [28,17]` | `radio` | Idit | "The high ground north of the village is not a hill. It is what came out of the routes, and it stands a level above the terrace because his crews put it there." | engine |
| the north street | `r` y=19 | `radio` | Shai | "The street across the top of the village joins both roads. Everything that comes off the plateau uses it." | engine |
| the store compound | zone `store_yard [35,12,7,7]` / `store_gate [37,17]` | `radio` | Shai | "A walled store on the east road with one gate. It is the only building here that was ever worth anything to anybody but a digger." | engine |
| the rock line | `^` spines y8–10 / `gap_west [18,9]`, `gap_east [34,9]` | `radio` | Idit | "Three rock spines across the north slope with two gaps in them, and the drone is stopped by rock exactly like a rifleman. Everything that reinforces this place comes through one of the two." | engine |
| the tributary head | zone `da_west [5,14,9,7]` / `da_west_head [7,17]` | `radio` | Shai | "Two shanties on a shoulder above the gully mouth. Nobody built them to live in — they were built to watch a hole." | engine |
| the plateau | `north_road [24,4]`, `plateau_west`, `plateau_east` | `radio` | Idit | "The plateau is his line of communication and every wave starts on it. It is also the road east, which is the one thing here that outlives him." | engine |

---

## 10. EVA announcements — the Khan Rafid and Deir Amun delta

**The campaign's set is written once, not per mission** —
`docs/campaign/beit_sahwan/narrative.md` §8 (fifteen lines, including
`ventOpened`, `tunnelCollapsed` and `evacuated`) plus Act II's four additions
(`tel_marum/narrative.md` §9): a civilian group taken, indirect fire inbound, an
enemy group displacing, and a `raze` target's last structure down. Checked event
by event against these six missions: `they_move_the_families_off` is the first;
the two `mortar_crew` are the second; five `withdraw_to` triggers are the third;
there is no `raze` in this arc at all.

**The delta is one line, and it is Deir Amun's whole mechanic.**

| event | line | why it is not already covered | status |
|---|---|---|---|
| `SimEvent tunnelContact`, side 0, level `lost` | "Contact lost." | The set announces a vent opening and a route collapsing — two things that *happen*. This is a thing that **stops** happening, and it is the only mechanic in the game where the player loses something by looking away. DA III is built on it and nothing currently marks it | engine |

**One further line is proposed and rejected**, recorded so nobody re-derives it:
`tunnelContact` at `identified` → *"Route identified."* It reads well and it is
redundant — the player already gets the route drawn on his map, which is a
stronger signal than a voice, and an announcement on every re-identification of a
decaying contact would fire several times a minute in DA III. **The asymmetry is
the point: the arrival is visible and the loss is not.**

`tools/validate_audio.py`'s `KNOWN_EVENTS` is six weapon and impact events, so
`pnpm validate:audio` cannot accept a voice file at all. The gate widens before
anything is recorded (GH-110, `storyline.md` §7 G4).

## 10a. Barks

**Not written here**, for the same reason as Act I and Act II, and the reason is
worth restating because it is the only thing in this sheet that cannot be fixed
after the fact.

> **Barks are keyed by unit ROLE, never per unit** (GH-110), and **the
> doctrine-not-people rule has to head that sheet before a single line exists on
> it.** No real place, faith, ethnicity, nationality, accent, idiom or insignia,
> on either side. That constrains accent, phrasing and idiom — the things that
> carry ethnicity in a recording, and the things that cannot be edited out of one
> afterwards. Retrofitting the rule means throwing recorded audio away.

This arc fields eleven KDF roles and nine Ashwar roles and **adds none**. A
role-keyed set for the campaign is its own deliverable and must not arrive at the
bottom of a briefing sheet.

---

## 11. The twist lines — T-KR1 to T-KR10, T-DA1 to T-DA10

The classification is `level-scripter`'s; the lines are this sheet's. The
"mechanic" column is what is needed **besides** a voice — the voice itself is
live.

| # | mission | twist | speaker | line | mechanic | status |
|---|---|---|---|---|---|---|
| **T-KR1** | KR I | *The patrol walks through the clinic yard.* An enemy section on a loop through the flagged compound, and every player's first instinct is to shoot it there | Idit | *(folded into T-KR-a)* "The compound was never empty — he has been walking men through it since before we crossed the perimeter." | one `patrol` stance, `[24,24] → [24,17]`; the `say` rides `zone_entered(ward)` | live |
| **T-KR2** | KR I | *The road is the trap.* The ATGM covers ten tiles of a forty-four-tile street that every route crosses | Idit | "Three posts, and not one of them can put a round inside the ward. Every one of them can put a round on anybody crossing to it. That is not an accident of ground; it was laid that way." | a placement and an `objectives[].say` | live |
| **T-KR3** | KR I | *They were never going to stay.* The un-reached groups are walked off | Idit | "The alley is empty. Nobody fought over them; they were walked off it while the drone was over the souk." | `timer_s(250)` → `remove` group `families`; the verb ships and `umm_zeitoun_1_recon` uses it | live |
| **T-KR4** | KR II | *He comes to the one place you will not shoot* | Idit | "They are walking into the ward. Not round it and not at the gates — into it, because it is the one piece of ground on this map where your guns are the ones that cost you." | `zone_entered(ward)` → `commit` group `ward_push` → `civ_refuge`. **The purest statement of the front's doctrine in the vocabulary, and it costs one trigger** | live |
| **T-KR5** | KR II | *The block above the lane.* Two cells garrisoned in a 14-penalty `apartment` overlooking the east lane | Idit | "Two cells in the north-east block, four floors over the east lane. It is not protected, so you can have it — at twenty-eight, which is two houses and a bit." | the placement is live; **the line has no event to hang on** (§13 G-A). The mechanic works silently and the price lands on the score | engine |
| **T-KR6** | KR II | *One of them runs the wrong way.* A group placed so the first `CivilianFlight` break sends it across the fight | Idit | "One of those groups has broken the wrong way. They are moving, and they are moving across the street rather than off it." | the placement is live; **`CivilianFlight` emits no `MissionEvent` an author can hear.** `playtest` decides whether it is cruel or merely unfair (O-KR5) | engine |
| **T-KR7** | KR III | *You are not allowed to kill him.* The block commander garrisoned in a `roe_penalty` 30 `hall` | Idit / Shai | briefing beats 1–2, and the objective label *"Kill the block commander if you can make him leave the hall"* | one `garrison` stance on a protected structure; the whole behaviour falls out of the sim's existing rules. **The strongest thing in the arc and it costs one line of JSON** | live |
| **T-KR8** | KR III | *He gives the ward back and takes the souk* | Idit | "He is out of the hall and moving into the souk. He was not going to leave for us; he left because there was nobody left in the block for him to hold it with." | `casualties_pct(45)` → `withdraw_to souk_alley`. **Re-run `playtest`** — a `withdraw_to` can walk a fight out of a plan's reach | live |
| **T-KR9** | KR III | *His round kills them and your score does not move* | Idit | "That was his, inside the wall, and the rating has not moved. It only ever moves for ours." | as a **placement** it is live and authored (a family on the axis the `charge_squad` runs down, and KR II's `a_charge_squad_comes_for_the_gate` says it in advance); as a line bound to the round landing it needs a sim-watching trigger **and** a way to choose where an enemy round lands (§13 G-A, G-F) | engine |
| **T-KR10** | KR III | *The house numbers.* The count read back | Idit | "Six of the eight into the ward, and the town is still standing. I will write the other two down, the same way I wrote down the ones at the compound." | `debrief.victory`, live and outcome-aware since 2026-09-06. **This is the arc's beat and it is in the debrief, not the briefing** | live |
| **T-DA1** | DA I | *He is still digging.* A live `digs` assignment on a crew nobody is commanding | Idit | "That is the crew, and they are still working. Nobody has told them to stop, and the man who would have is in a cell at brigade." | `digs` ships and two Beit Sahwan missions use it; one `objectives[].say` makes it legible | live |
| **T-DA2** | DA I | *The dirt is the intelligence* | Idit | briefing beat 4 — *"disturbed earth is something any soldier can read. The ones he finished before the war throw nothing at all."* | none; it is authored in the map — two routes with `dig_tiles_per_s`, four `pre_dug` | live |
| **T-DA3** | DA I / DA III | *Behind you, out of the spoil.* `in_tunnel` cells venting on ground already cleared | Shai | "Up behind you, out of the spoil field. That ground was ours ten minutes ago and it has a door in it." | the placement is live and vents on its own; **no trigger fires and no toast prints** (§13 G-A). **The arc's signature event is its most silent one** | engine |
| **T-DA4** | DA II | *The thing you are holding is a door* | Idit | briefing beat 1, and *"He built this place so that holding a piece of ground and standing on a door were the same act."* (debrief) | `in_tunnel` placements on a route whose mouth is inside the `hold_for` zone | live |
| **T-DA5** | DA II | *One gate* | net | "Pump yard held, four minutes. One gate, and it stayed ours." | it is the map | live |
| **T-DA6** | DA II | *They are not coming for the yard.* The last wave routed at the ford behind the player | Idit | "Two sections across the centre ford. They are not going to the yard — they are going to the camp on the bank, and the camp is four tiles from that ford." | a wave `to:` a marker behind the player, plus `enemy.waves[].say` | live |
| **T-DA7** | DA III | *Everything you know goes cold behind you* | Idit | briefing beat 2 (live); the literal per-event form is *"Route identified. Hold the eye on it — the moment nobody is looking it goes back to a rumour."* | the honest version is the briefing saying it once and the player discovering it; the per-event version needs a `SimEvent` trigger (§13 G-A) | live |
| **T-DA8** | DA III | *The last one is under your own road* | Shai | briefing beat 4 — *"One of them surfaces on your own road east. Whatever you leave standing there is standing under your armour."* | it is the map: `da_tn_east` vents at `[41,19]` | live |
| **T-DA9** | DA III | *He is standing on it* | Idit | "He has gone back onto the spoil field. It is the only high ground on this map and his own crews built it out of the routes you are here to bring down." | `casualties_pct(50)` → `withdraw_to spoil_field_centre`. **Re-run `playtest`** | live |
| **T-DA10** | DA III | *The road east.* Act I's close | narrator | the `aftermath`, §6.5 | `aftermath` is live; **blocked on §14.2** | live |

**T-KR7 is the one to build first**, and not because it is cheapest. It is the
only twist in the arc where the player is shown exactly where a man is standing,
told he cannot shoot him, and given a mechanic that makes him leave — and every
part of it falls out of `roe_penalty: 30` and a `garrison` stance with no engine
work at all. **T-DA3 is the one that most needs `sim-guard`**: it is the
subsystem's signature event, it happens four times in the last mission, and today
it happens in silence.

---

## 12. Trigger ids — proposals, because an id is player-facing prose

`main.ts:276` prints a trigger's `id` verbatim as `enemy reacts (<id>)` and
`mission.schema.json` puts no pattern on it. **`level-scripter` owns these; none
exists in JSON, because no mission file exists.**

| mission | proposed id | why |
|---|---|---|
| KR I | `the_compound_was_never_empty` | the twist's own sentence, and it is a correction of the player's assumption rather than a report of a spawn |
| KR I | `he_gives_up_the_crossing` | states what the player gained, which is what a `withdraw_to` actually is |
| KR I | `they_move_the_families_off` | **reuses `umm_zeitoun_1_recon`'s shipped id exactly.** The verb is *move*: they are taken, not killed, and the id must not say otherwise (`Sim.removeFromPlay`'s own doc comment) |
| KR II | `they_walk_into_the_ward` | seven words, and it is the whole doctrine. *Walk* rather than *push* or *assault*, because walking is what makes it terrible |
| KR II | `the_block_pulls_back_into_the_souk` | plain, and distinct from KR III's, which is the same verb about a different man |
| KR II | `a_charge_squad_comes_for_the_gate` | names the unit type, because the player needs to know what is coming and the toast is the only warning |
| KR III | `he_walks_out_of_the_hall` | **the arc's best id.** `enemy reacts (he_walks_out_of_the_hall)` is the mission's whole solution printed at the moment it works, and the player caused it |
| KR III | `the_souk_empties_into_its_own_alleys` | long and worth it — it says where they went, which is the thing a `commit` does not show |
| KR III | `a_rocket_team_moves_into_the_east_lane` | names the road, because the road is the player's way home |
| DA I | `the_crew_stops_digging_and_turns_round` | the digging stopping is the player's first success and the trigger is where he learns it |
| DA I | `the_bed_is_a_road_and_it_is_theirs` | a statement about terrain, which is what this town's triggers should be |
| DA II | `the_village_comes_down_to_the_yard` | *the village* rather than *the garrison*, because there is nobody in it but them |
| DA II | `the_yard_party_falls_back_up_the_lane` | plain; the mission's talking is spent elsewhere |
| DA II | `a_charge_squad_comes_down_the_lane` | pairs with KR II's, deliberately — the same unit doing the same job, so the player reads it the same way |
| DA III | `the_village_comes_out_of_its_houses` | distinct from DA II's, and it says what the player will see |
| DA III | `he_falls_back_onto_his_own_spoil` | **the twist and the geography in six words**, and the possessive is the whole line |
| DA III | `a_charge_squad_comes_for_the_engineers` | names the target rather than the place, because in this mission the engineers *are* the place |

**The hard-coded `enemy reacts` prefix is correct on all seventeen** — every
trigger in this arc is an enemy act: three spawns, five displacements, four
commits, one group taken, and four charge-squad arrivals. The tutorial's friendly
`deliver_*` triggers remain the only place that prefix lies (Act I **G-C**).

---

## 13. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | **A trigger cannot fire on a `SimEvent` or on an objective, and in this arc that silences the subsystem the last town is made of.** An `in_tunnel` garrison **vents on its own** — no trigger, no `describeMissionEvent` case — so `surfaced` is invisible in DA I, DA II and four times in DA III; `tunnelContact` at `lost` is the mechanic DA III's briefing spends two sentences on and nothing marks it; and the drone dying, the ATGM firing down Main Street, a `yahalom_squad` dying mid-charge and the first ROE deduction inside the ward are all lines the missions earn and cannot say. **Ten `radio` rows here are `engine` for this and nothing else** | two `on.kind`s — `sim` (one of the 24 `SimEvent` kinds) and `objective`. The tutorial's `await` already gates on every `SimEvent`, so the predicate is reused | `sim-guard`; Act II **G-B/G-E** |
| **G-B** | **A civilian reaching the refuge is silent, and this is the arc that proves it matters.** `describeMissionEvent` (`main.ts:267`) has no `evacuated` case and falls to `default: return null`. Khan Rafid scores on civilians in **all three** missions at counts 2, 4 and 6 on the same zone — twelve arrivals across the town — and every one of them produces no toast, no sound and no line until the objective's own count lands. **The mechanic the arc is built on has no feedback at all** | one `case 'evacuated'` returning a toast | `render-vfx`; Act I **G-B**, still open |
| **G-C** | **`built` prints a raw unit id** — `reinforcement deployed — inf_squad`. Four of these six missions declare an economy and buy across seven minutes, so it fires repeatedly | look the display name up from the unit JSON | `render-vfx`; Act I **G-D**, still open |
| **G-D** | ~~**The radio overlay does not exist.**~~ **CORRECTION, measured this session and recorded because two sheets carry the old claim.** The commander bar now paints the `say` speaker's **portrait and plate** (`hud.ts` `paintFace`, `renderCommander`, `speakerPlate`; `main.ts:1831` `hud.say`), `commander.json` carries `people.shai`, `people.idit` and a per-region `villains` block, and all five portraits ship in `assets/ui/portraits/`. The end screen does the same for `debrief` (`menu.ts` `showEndScreen`). **Every `say` row in this sheet is `live` and arrives with a face.** What is still absent is a distinct frame, a hold, and voice audio | none blocking; the remaining work is presentation | `render-vfx` |
| **G-E** | **A briefing cannot branch on the ledger.** KR III's picture genuinely differs by what KR I found (`kr_lane_east` and `kr_watch`'s ATGM spawn pre-identified and forfeit their ambush), and DA II's differs by whether DA I found `da_watch_gap`. `briefing` is a plain `string`; `ledger.requires` is read by neither the runtime nor `campaign.ts`. **The fallback is beat 3 of KR III — the rule stated instead of the state** — which is `qarn_hadid_3_clearance`'s shipped solution and is used here for the same reason | `briefing_variants`: an optional array of `{ requires_ledger, briefing }` checked in order, falling back to `briefing`. `briefingBeats` still splits whichever string wins | `sim-guard` + `render-vfx`; Act II **G-A** |
| **G-F** | **An author cannot choose where an enemy round lands**, so T-KR9's literal form is unbuildable. Delivered as a placement instead: a family on the axis the `charge_squad` runs down, plus KR II's trigger line saying in advance what it will do. `stepRoe` bills only a `destroyed` whose `by` is a player unit, so the mechanic is already correct — it just cannot be pointed at | out of scope | `sim-guard`; Act II **G-C** |
| **G-G** | **The third star is currently awarded twice, and both halves are content.** `commander.json`'s Captain entry reads `until_mission: "beit_sahwan_4_subterranean"`; campaign order is `world.json`'s flattened order, and `khan_rafid` and `deir_amun` already sit between Beit Sahwan and Sur with empty mission arrays — so the moment they gain missions, **Shai is a Major for all six of these, against `storyline.md` §2.1's act-boundary rule and against this brief**. `design.md` C4 moves it to `deir_amun_3_subterranean`, which is required and not optional. And **`beit_sahwan_4_subterranean`'s shipped `aftermath` says the star was put on the slip**, so with C4 applied the campaign promotes him, plays six missions in which he is a Captain, and promotes him again | one line in `commander.json` **and** one string in `beit_sahwan_4_subterranean.json`'s `aftermath` (§14.2), **in the same commit as the six mission files** | `mission-author` + the lead |
| **G-H** | **`hall` and `clinic` have no sprite sheet, and this arc makes an invisible building the subject of an objective label.** Inherited (`design.md` §7 G7) — `beit_sahwan_outskirts` already carries `k` and `m` tiles — but *"Kill the block commander if you can make him leave the hall"* names a building that draws nothing on `?renderer=pixi` and under `&nomesh`, which raises it from cosmetic to unreadable. The `camp` has the same hole and it is the buy point in four missions | three sheets through `validate:assets`, which fixes three shipped maps at the same time | `blender-art` + `render-vfx`; `design.md` O-KR8 |
| **G-I** | **`pnpm validate:audio` cannot accept a voice file.** `KNOWN_EVENTS` is six weapon and impact events, so §10's delta and every voice recording in the campaign are blocked on the gate widening first | a non-weapon set kind and its events | `content-validator`; GH-110 |
| **G-J** | **A town cannot say it is unwritten.** `world.schema.json` has no `planned` property, and `khan_rafid` and `deir_amun` are **already in `world.json` with empty mission arrays**, which is the state this gap describes — the board shows two pins in the Marj that lead nowhere, today, before this arc lands. **`world.json`'s mission arrays and the six mission files must land in the same commit** | `planned: true`, excluded from `regionProgress` | `sim-guard` + `app`; Act II **G-L** |
| **G-K** | **`validate_data.mjs` does not check a `capture` or `hold_for` zone for passable tiles.** `design.md` §7 G9 records this as **CLOSED the same day** — the check landed and all 102 shipped files pass. Recorded here only because this arc has five such zones (`souk`, `market`, `store`, `pump_yard`, `store_yard`) and `design.md` KR-A7 caught a draft `store` with zero open tiles in it. **Nothing to do; do not re-open it** | none | — |
| **G-L** | **A route collapsed in DA I stands again in DA III**, because every map tunnel is registered for every mission that uses the map (`design.md` §7 G8). It is mechanically harmless — unstocked, no digger, no objective names it — but a player who walks a Yahalom past `da_tn_west` in DA III sees a route he brought down. **This sheet's mitigation is textual and complete**: no line anywhere claims a route stays down between missions, DA III's briefing says *"four routes under this village"* rather than *four left of six*, and DA I's debrief says *"one of six"* rather than *five remain*. O-KR9 says leave it | none, per O-KR9; the zero-engine fix is a map variant, which `map-variants-design.md` §3 forbids | recorded |

---

## 14. GDD amendments

### 14.1 `docs/GDD.md` §11 — one paragraph, and it is not this arc's doing

**§11's story-surface list is stale in two places**, checked clause by clause
against shipped code this session. Its last paragraph reads:

> **Approved and not yet built:** EVA announcements, voice audio for briefings
> and transmissions, a radio overlay with portraits for the `say` lines, and a
> `debrief` that can tell a victory from a defeat.

Two of those four shipped:

- **an outcome-aware `debrief`** — `mission.schema.json`'s `debrief` is
  `{victory?, defeat?}`, `main.ts:1858` picks the variant by result, and
  `menu.ts` `showEndScreen` renders it above the rating with a portrait and a
  plate. Live since 2026-09-06;
- **portraits for the `say` lines** — `hud.ts` `paintFace` and `renderCommander`
  paint the speaker's face and `speakerPlate` its plate, resolved from
  `commander.json`'s `people` and per-region `villains`; all five portraits are in
  `assets/ui/portraits/`. Live since 2026-09-07.

**Exact replacement text:**

> **Approved and not yet built:** EVA announcements, voice audio for briefings
> and transmissions, and a dedicated frame and hold for a mid-mission
> transmission — the speaker's portrait and plate already paint on the commander
> bar and on the end screen.

**Version line: 1.2.2 → 1.2.3.**

**§11's other clauses were re-read against this arc and all hold.** Shai a
Captain throughout with no promotion inside a town; Idit supplying the picture
and never giving an order — every `say` attributed to her in this sheet was
re-read for an imperative and none carries one, and where the closest thing
appears (§2.5, *"that is your decision, not mine"*) it is a refusal to give one;
one villain per front, opened by an atrocity and ended captured or killed,
present in between through what he does — **§0.3 is the reading of that clause
this arc adopts and D-KR1 is where it was decided**; and *"missions may turn the
plot inside the level… where the declarative vocabulary can express it"*, which
is §11's classification exactly.

**GDD §2's town list already names Khan Rafid and Deir Amun** (censused this
session, line 15 of §2), and `mission.schema.json`'s `town` enum already carries
both. **No §2 amendment.**

**Not applied this pass**, deliberately. `docs/GDD.md` was not edited. The
correction is independent of this arc — it is true today, with no Marj content in
the tree — and should land in whichever commit the lead takes rather than in a
documents-only pass on a design §8 has not signed. Say the word and it goes in as
one paragraph and one version bump.

### 14.2 `data/missions/beit_sahwan_4_subterranean.json` — `aftermath` — a request, not a change

**This is the one edit this arc requires in another town's shipped content, and
this agent may not make it**: `aftermath` is not one of the three fields it may
edit, and `docs/campaign/beit_sahwan/` is not its document. It is stated here in
full so `mission-author` can apply it verbatim.

**Shipped today** (205 chars):

> *Four routes under Beit Sahwan, and the man who dug them came up out of the
> last one with his hands empty. Brigade put a third star on the slip and said
> nothing else about it. The Marj is quiet. Sur is not.*

**Proposed** (202 chars):

> *Four routes under Beit Sahwan, and the man who dug them came up out of the
> last one with his hands empty. Brigade took the file and said nothing else
> about it. The perimeter is ours. The enclave is not.*

**What changed and why.** The capture is untouched — it is the mission's own
ending and the strongest sentence in Act I. What moves is the **third star**,
which belongs at the act boundary, and the act boundary is now
`deir_amun_3_subterranean` because `world.json` already places two Marj towns
after Beit Sahwan. *Brigade took the file* keeps the shape of the sentence and
replaces the promotion with the thing the capture actually produced — which is
also §0.3's whole premise, the file Idit spends six missions finding out is not
identification. *The perimeter is ours. The enclave is not.* replaces the
hand-off to Sur with a hand-off to Khan Rafid, in the same two-clause rhythm, and
`enclave` is `design.md` §1's own word for the Marj's dense middle.

**It is a package with `commander.json` C4 and it must land in the same commit**
(§13 **G-G**). If the lead rejects Option A and Khan Rafid and Deir Amun are not
built, **nothing here applies and the shipped string is correct as it stands.**

### 14.3 `docs/campaign/storyline.md`

**No edit needed.** §2.3's SPADE entry, §3.1's Act I table and §4.2's Khan
Rafid / Deir Amun sketch are all still true of what is written here. Two facts
this sheet establishes are worth recording *somewhere* eventually and are **not**
recorded by editing that file in this pass:

1. **§2.1's rank ladder says the Major arrives at the act boundary and names the
   Marj as what earned it** — *"the district's routes came down, with the man who
   dug them."* That sentence is now literally the shape of this arc: the man came
   down at Beit Sahwan IV and the routes come down at Deir Amun III, and the star
   arrives after both. **The ladder needs no change; only `commander.json` does.**
2. **§3.1's Act I table has six rows and this arc adds six more.** Extending it
   is the lead's call at the same time he signs `design.md` §8, and it is
   `storyline.md`'s owner's edit, not this sheet's.

---

## 15. Row counts

Every table row in this file whose last cell is `live`, `schema` or `engine`,
counted by script rather than by eye.

**222 rows** carry one.

| status | rows | what they are |
|---|---|---|
| `live` | **170** | `toast` 70 · `radio` — a `say` on an objective, a trigger or a wave — 55 (KR I 10 · KR II 10 · KR III 9 · DA I 8 · DA II 9 · DA III 8 · the HELD enemy line 1) · `debrief` 12 · `title` 6 · `brief` 6 · `dispatch` 2 · `aftermath` 2 (one of them the deliberate *none* on KR III) · twist rows 16 · one row recording a **deliberate silence** (the `survive_until` that cannot fail) |
| `schema` | **0** | none. Every field this arc needs exists |
| `engine` | **52** | ambient lore 25 (`radio`) · `radio` with no event to fire on 11 · hard-coded `toast` paths 7 · `eva` 5 · twist rows 4 |

**One of the 55 `live` `radio` rows is HELD and must not be authored** — the
`enemy` line in §8. Its status is `live` because the field, the speaker and the
portrait all exist, not because the line ships. **169 rows are text
`mission-author` can paste.**

**52 `engine` rows, blocked on exactly four things and nothing else:**

1. **A trigger that can watch a `SimEvent` or an objective** (§13 **G-A**) —
   **11 `radio` rows and the arc's whole subterranean subsystem.** Four vents in
   DA III, one each in DA I and DA II, `tunnelContact` going cold, the drone
   dying, the ATGM firing down Main Street, a Yahalom dying mid-charge, the first
   ROE deduction inside the ward, T-KR5's price and T-KR6's broken group. Every
   one is a line the mission has already earned and cannot say.
2. **Two hard-coded toast paths** (§13 **G-B**, **G-C**) — 7 rows: three silent
   `evacuated`s across the three Khan Rafid missions, and four `built`s printing a
   raw unit id.
3. **`eva` and the audio gate** (§13 **G-I**) — 5 rows.
4. **No event and no surface at once** — the 25 ambient rows in §9, which have
   nothing to fire on. They are written because the ground is specified, not
   because they are close.

**23 % of the writing in this arc reaches nobody**, against 23 % at Qarn Hadid,
22 % across the rest of Act II and 40 % in Act I. **Excluding ambient lore the
figure is 27 of 197, or 14 %** — and unlike either neighbour, **the largest
single block of it is not scenery: it is the tunnel subsystem's own events.**
Deir Amun is the first content in the game where the *mechanic* the mission is
built on is the thing with no voice, and §13 **G-A** is the one gap in this sheet
whose closing would change how the arc plays rather than how it reads.

**Two figures that are not row counts and matter more.**

- **Six briefings, 898–1,118 characters, 38 beats, every beat ≤ 240 characters
  and ≤ 2 sentences.** Split with a port of `briefingBeats`, not counted by eye.
  The shipped range is 385–1,225.
- **138 quoted strings and every capped field checked against the 240-character
  validator limit by script: 0 over.** That covers 2 `dispatch`es, 1 `aftermath`,
  the proposed Beit Sahwan IV replacement, 12 `debrief` lines, every
  `objectives[].say`, every `say_on_fail`, every `triggers[].say`, every
  `enemy.waves[].say`, all 25 ambient lines, and the HELD enemy line.
