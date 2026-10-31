# Ein Qasab — Narrative Trigger Sheet

**Act III · Naharin · Rif Cells · "The Flood Week" (Plot B, GH-912). This is a second Naharin town, set in the
winter between Wadi Halam III and Wadi Halam IV. Shai Hammai is a Lieutenant Colonel in all three missions. He is
not promoted here, and nothing here promotes him.**

**Date:** 2026-10-31. **Status:** authored text for three missions that do not exist yet. **No file was edited
except this one.** `ein_qasab_1_recon`, `ein_qasab_2_foothold` and `ein_qasab_3_buildup` have no JSON. `ein_qasab`
is not in `mission.schema.json`'s `town` enum and has no `world.json` entry (MDD G2). The two new maps are not in
`data/maps/`. So the three live fields this agent may write (`name`, `briefing`, `objectives[].text`) have nowhere
to go yet. They are printed whole below, for `mission-author` to paste.

**Written against** branch `content/ein-qasab-town` in `/Users/ilpinto/dev/roaring-lions-ep/wh-rain-build`, at
`55ffb5e22`. Read this session rather than recalled:
- `data/schemas/mission.schema.json`: `$defs.say` is `{speaker ∈ shai|idit|net|enemy, text ≤ 240}`; trigger
  `label` is ≤ 48; `dispatch` and `aftermath` are ≤ 240; `debrief` is `{victory, defeat}`.
- `packages/app/src/ui/loading.ts` (`briefingBeats`, ported for the check in §12).
- `main.ts` `describeMissionEvent`: a trigger prints its `label`; `say` goes to the commander bar; `evacuated`
  prints `clear (n)`.
- `ui/after-action.ts`, `gate-sentence.ts`, `campaign.ts` `villainState`, `campaign-close.ts`.
- `data/campaign/commander.json`, `world.json`, and the shipped Wadi Halam missions.

Every route, step count and sight figure is **quoted from the MDD and not re-derived**. The MDD measured them on its
sketches, and `mission-author` re-measures from the committed maps.

**Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md` §1, §2.1 to §2.4, §3.3, and
`docs/campaign/names.md` §8. **Upstream:** `docs/campaign/wadi_halam_rain/mdd.md` (Plot B, §0 to §5, §7, §8).
**Precedents:** `docs/campaign/wadi_halam/narrative.md` (the act's voice), `docs/campaign/qarn_hadid/narrative.md`
(an interleaved town whose villain is present only through what he left).

**Downstream:**
- `level-scripter`: the trigger ids, labels and bindings, the twist classification (§8), and the proper-noun list (§9).
- `mission-author`: the three mission files, every `say`, `debrief` and `dispatch`, `world.json`, and the map names.
- `render-vfx` / app: the town lock sentence (G1), and the after-action "Carries into" row (§10).
- `sim-guard`: T-C2's condition (G5).
- `content-validator`.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code. The text reaches a player the moment `mission-author` pastes it |
| `schema` | the field is specced and the runtime ignores it |
| `engine` | an approved target with no implementation: a trigger bound to a `SimEvent`, a town-level gate (G1), recorded voice audio, a terrain change, or a line with no event to fire on and no surface to fire into |

Every row's rightmost cell is one of those three words. The counts are in §12. **`schema` is 0 in this town**: every
field it needs exists.

### 0.2 Two voices, one string

A `briefing` is one string, and the deploy screen and commander bar show one speaker at a time. So in the JSON the
briefing is the orders voice end to end, with Idit's picture carried in it. **In this sheet each briefing is a
two-hander, one speaker per beat, alternating Idit / Shai.** That is how it is written and read aloud. The `say`
lines carry a real `speaker`, so inside a mission Idit, the net and the enemy speak in their own names.

**The beat boundaries are not editorial.** Every beat below is exactly what `briefingBeats` produces from the pasted
string: at most two sentences and 240 characters. This was checked with a port of the function (§12). Every beat is
two sentences except each briefing's last, so the splitter cannot merge two speakers into one beat.

### 0.3 The order of play is not enforced, so every line was read in both orders

G1 opens this town after `wadi_halam_3_counterraid`. But the board still lets a player go on to Wadi Halam IV and V
first (MDD §1 Plot B, "honest limit"). So **every line here was read three times**:
1. as the week after the cattle track;
2. as a player who has already cleared the village (WH IV);
3. as a player who has already broken the depot and watched Hallaq die at his gate (WH V).

A line that was false in any of the three was rewritten. Four rules came out of that reading:

| rule | why | example |
|---|---|---|
| Anchor to Wadi Halam III, never to IV or V | III is always behind the player | dispatch: *"The rains came the week after the cattle track"* |
| Hallaq is present tense only inside the winter's fiction. Nothing claims he is alive *now* | after V he is dead | *"His loads went down to the old marsh causeways"* (the winter); no *"he is still out there"* |
| The hook into IV and V is said as **where the freight was going**, never as **where we go next** | after V the yard is rubble | *"…that is where this winter's freight was going"* (§4.4) |
| No rank, no stars, no "next week" | the rank comes from `world.json` position (MDD §0.1 point 4); the three missions are one week | *"later this week"*, *"this week"* |

### 0.4 The villain

**Jubran Hallaq**, KDF file **FERRY**, *the smuggler* (`storyline.md` §2.3). **He stays alive, and he is never on
the map.** He ends at Wadi Halam V, unchanged.

He is present through three things he does, one a mission, in this order:

| mission | what he does | where the player meets it |
|---|---|---|
| **I** | the rain closes the fords, so he puts people under the loads | the `dispatch`, the carriers primary, and Idit's *"Every load on that road tonight is a family"* |
| **II** | his drone crates in a farm barn, two tiles from a family | the failable `raze`, and Idit's barn line tying the swarms over the cattle track to barns like this one |
| **III** | his stock, and the manifests that name the yard east of Wadi Halam village | `burn_the_stock.say`, the act's hook into IV and V |

**The town's HVT is not Hallaq.** `eq_hvt_ferryman` is *"Hallaq's man on the winter road"*. That is a function, not
a name, and it extends the act's ladder:
- *"Hallaq's local commander"* (WH III);
- *"the quartermaster holding Hallaq's cache"* (WH IV);
- *"whoever is holding the gate"* (WH V, Hallaq himself).

**He has no personal name, and must not get one** (the WH III precedent: *"the man has no name in the fiction and
must not acquire one"*). **The word "ferryman" must never reach a player**, because Idit's file name for Hallaq is
FERRY: a lieutenant called *the ferryman* reads as the villain (§9).

**Hallaq does not speak in this town.** One line is written and **HELD**, and §5 gives the reason. It is decisive
rather than a matter of taste: an `enemy` line paints Hallaq's portrait (`speakerPortrait` resolves `enemy` to the
front's villain), and a player arriving here after WH V would see a dead man speak.

### 0.5 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality, accent, idiom or insignia, on either side.
The Rif Cells are technicals, raids, smuggling and mobility, and this town takes the mobility away. Nothing else is
said about them. The carriers, the farm family and the hamlet families are people who live on a road two armies are
fighting over, and the text says only that.

Hallaq's hold on them is **haulage**: *"under a load"*, *"carry"*, *"freight"*, *"manifests"*. That is what the
doctrine word "smuggling" means when it reaches a person. The atrocity is named by its effect, never its method,
which is Act I's ceiling and WH I's own construction.

**No new place name is coined anywhere in the player's text.** *Ein Qasab* is the one proper noun this town adds. It
was approved by the lead at S-6 (rain spec §12.5) and gets its `world.json` entry by G2. Everything else is a
**feature** that resolves to a marker or zone: the causeways, the reeds, the hamlet, the hollow, the saddle, the dyke
gap, the lip, the mill islet. This binds hardest on the `eva` and `bark` rows, which would be recorded (§7).

### 0.6 What this town can say, and what it cannot

| | |
|---|---|
| **can, today** | a line on an objective completing or failing, on a trigger, or on a wave, in four voices, reaching the commander bar; trigger `label`s in the feed; `dispatch`; `aftermath`; a `debrief` that tells a win from a loss; the `clear (n)` notice when a civilian reaches the refuge; EVA captions built from the objective text |
| **cannot** | a trigger cannot fire on a `SimEvent` or on an objective. So *"the drone is down"*, *"the reed cell sprang"* and *"the lead vehicle was hit at the causeway mouth"* are `engine` (§10 G-E) |
| **cannot** | a briefing cannot branch on the ledger. EQ III states the carry-over as a **rule**, true whichever way I and II fell (§4.3, the Qarn Hadid III precedent) |
| **cannot, new here** | a town cannot be locked (G1). Its board sentence is written and is `engine` (§1) |
| **cannot, new here** | an enemy cannot fail an objective by arriving somewhere (G5), so no text promises that the lieutenant *escapes* (§4, T-C2) |

---

## 1. The town, and the board

| surface | where | text | note | status |
|---|---|---|---|---|
| town name | `world.json` town `name` | **Ein Qasab** | listed **first** in Naharin's `towns`, before `wadi_halam`, so the rank reads Lieutenant Colonel (MDD G3) | live |
| town gate | `world.json` town `unlock.after_mission: wadi_halam_3_counterraid` | — | G1, a field that does not exist yet | engine |
| locked pin, spoken line | new key `world3d.say.townLocked`: `{town} — {reason}` | *Ein Qasab — Clear Wadi Halam III — The Cattle Track first* | `{reason}` must come from `gateSentence` (`gate.clearMission`). **Never** from `@lions/sim`'s `unlockReason`, which says `requires clearing wadi_halam_3_counterraid`: a raw id, refused by `player-wording.test.ts` | engine |
| locked pin, hover | new key `world3d.hover.townLocked`: `{town} — locked: {reason}` | *Ein Qasab — locked: Clear Wadi Halam III — The Cattle Track first* | same | engine |
| open pin, hover | `world3d.hover.opening` (shipped) | *Naharin — opens Ein Qasab I — The Causeways* | shipped key, no new text | live |
| next mission | `campaign.next.label` (shipped) | *Next: Ein Qasab II — Dead Ground* | | live |
| region blurb | `world.json` Naharin `blurb` | **unchanged** | rendered nowhere (`README.md`, `board` row) | live |
| villain card | `commander.json` `villains.naharin.lines` | **unchanged** | see §10 G-Q for a one-line robustness fix | live |
| Free Play card | `en.json` `freePlay.map.ein_qasab` | *A reed marsh valley crossed by two causeways under a basalt ridge.* | drops the *"Terrain study:"* prefix once a mission plays on it. The map stays in `UNLISTED_MAP_IDS` until its art is complete (MDD §0.1 point 9) | live |
| Free Play card | `en.json` `freePlay.map.jebel_matar` | *Wet downs: a farm in a hollow under two crests, and one gap in a basalt dyke.* | the menu spec needs a key per map | live |
| Free Play card | `en.json` `freePlay.map.ein_qasab_3` | *A fen of two reed channels, one causeway to a mill islet, and a hamlet above.* | | live |
| map display name | `data/maps/jebel_matar.json` `name` | **Ein Qasab — The Hill Farm** | recommended over the toponym "Jebel Matar" (§9, Q2) | live |
| map display name | `data/maps/ein_qasab_3.json` `name` | **Ein Qasab — The Lower Causeway** | the town's maps follow the `<Town> — <feature>` convention | live |

The three `freePlay.map.*` strings and both lock keys go into `en.json`, so **they are read by
`player-wording.test.ts`**. Each was checked against its deny list by script, and none carries a denied word. The word
*manifest* **is** on that list, so it appears in this town only in mission `say` data, never in a catalogue string
(§10 G-R).

---

## 2. `ein_qasab_1_recon` — Ein Qasab I — The Causeways

`recon`. **Lieutenant Colonel.** On the shipped `ein_qasab` map. Requires **R**; produces **R M C X I E**.
`target_minutes` 6; `time_limit_s` 720; no economy; no `fail_below`; `flagged_zones: ["hamlet"]`.
**The week the Rif cannot run, and the first of the town's two finds.**

### 2.1 `name`

`Ein Qasab I — The Causeways`

The act's first mission is *The Fords*. The fords are closed now, and the causeways are what the rain left, so this
name is the premise in two words. The MDD's working name *"Reed Spring"* is **not** used: it is a literal translation
of the toponym. Printing it beside *Ein Qasab* tells a player which real language the name came from, and the
fiction rule exists to stop exactly that.

### 2.2 `dispatch` — 232 chars

> *The rains came the week after the cattle track, and both fords went under. Jubran Hallaq does not stop for weather. His loads went down to the old marsh causeways, and where a truck cannot go, the people beside the marsh carry them.*

Narrator, story voice.
- **It anchors to Wadi Halam III**, which is always behind the player (§0.3).
- **It names the atrocity by its effect**, in WH I's own verb: WH I's dispatch is *"carry it by hand"*, and this is
  the same people carrying again.
- **It names Hallaq**, because by now the player has heard him named in WH III's briefing.

This is the second `dispatch` in Naharin. The Qarn Hadid precedent applies (`qarn_hadid/narrative.md` §0.6): a town
opening onto a changed road, not onto a dead settlement. **The zero-risk alternative, for the lead:** cut it, and let
briefing beat 1 carry the rain alone. That costs the town its only story-voice line before a debrief (Q4).

### 2.3 `briefing` — 1,016 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | With the fords under water, the corridor's traffic has come down to this marsh: two causeways over the reeds, and nothing else here a wheel can use. A truck on a causeway cannot leave it, so for one week the Rif cannot scatter. | 227 |
| 2 | **Shai** | Put the sniper on the west ridge and build the picture: four of the positions covering the causeways. Keep the drone off the east crest, where a gun truck owns the sky out to eleven tiles. | 188 |
| 3 | **Idit** | Four carriers are out there, two loaded on the south causeway and two in the hamlet yard waiting for theirs. Every load on that road tonight is a family. | 153 |
| 4 | **Shai** | Get three of them to the refuge before the next load moves. The Eitan reaches them fastest and drives past whatever is lying in the reeds to do it; on foot it is slower, in cover, and it spends men the picture needs. | 216 |
| 5 | **Idit** | Whatever you mark beside these causeways tonight stays marked. Meet it again this week and it does not get the first shot. | 122 |
| 6 | **Shai** | Every round you put into those reeds is billed where it lands, and the carriers are standing beside them. | 105 |

What each beat does:
- **Beat 1** is MDD §3.0's first row said as intelligence: vehicles are road-bound, and *"a vehicle on a causeway
  cannot leave it."* *"Cannot scatter"* is the act's own idea turned over: WH I's *"disperse the moment they are
  seen,"* and WH II's *"mobility is their armour."*
- **Beat 2** is the MDD's measured advice in the orders voice:
  - the sniper on the level-4 west ridge (sight 16, thermal) *"can see the whole floor"*;
  - the drone *"cannot overfly the crest truck's 11-tile reach"* (`gun_truck`, AA role).
- **Beat 3** is the MDD's story hook (*"every load is a family"*) and the placement fact: two civilians on
  `causeway_s`, two in the hamlet yard.
- **Beat 4** is the decision, wheels or feet, with each side's price. The Eitan is fast, and it drives past
  `eq_reed_cell`'s ambush. Feet wade in cover and spend squads the `locate` needs.
- **Beat 5 is what the find is worth**, said as a rule of the world and never as a star (§2.4). A tag identified here
  *"spawns identified and forfeits its ambush"* in EQ III (MDD §5.3).
- **Beat 6 closes on a cost.** It is the restraint beat (MDD hook: *"Shai's restraint beat on the evacuation"*), and
  it is written as billing rather than as a sermon, in the register of Beit Sahwan III's *"billed for every second
  they can see it."*

Idit / Shai, alternating through all six beats: the picture, the plan, the picture's human cost, the decision, what
knowing is worth, the price.

**The JSON string, to be pasted whole:**

> With the fords under water, the corridor's traffic has come down to this marsh: two causeways over the reeds, and nothing else here a wheel can use. A truck on a causeway cannot leave it, so for one week the Rif cannot scatter. Put the sniper on the west ridge and build the picture: four of the positions covering the causeways. Keep the drone off the east crest, where a gun truck owns the sky out to eleven tiles. Four carriers are out there, two loaded on the south causeway and two in the hamlet yard waiting for theirs. Every load on that road tonight is a family. Get three of them to the refuge before the next load moves. The Eitan reaches them fastest and drives past whatever is lying in the reeds to do it; on foot it is slower, in cover, and it spends men the picture needs. Whatever you mark beside these causeways tonight stays marked. Meet it again this week and it does not get the first shot. Every round you put into those reeds is billed where it lands, and the carriers are standing beside them.

### 2.4 Objectives

The ids are proposals; `level-scripter` and `mission-author` own them. Each `text` is read four ways, because the game
shows it four ways:
- as an order, on the deploy screen;
- as a toast, `OBJECTIVE COMPLETE — <text>`;
- as an EVA caption, `Objective complete. <text>`, or `One minute. <text>` before a deadline;
- on a defeat, `Objective failed: <text> · <clock>` or `Out of time — <text> was not finished`.

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `picture` | `locate` · count 4 · **primary** | Identify four positions covering the causeways | `OBJECTIVE COMPLETE — Identify four positions covering the causeways` | live |
| `get_the_carriers_home` | `evacuate_before` · `refuge` ×3 @300 s · **primary, failable** | Get three carriers to the refuge before the next load moves | `OBJECTIVE COMPLETE — Get three carriers to the refuge before the next load moves` | live |
| `find_the_reed_cell` | `locate` · `eq_reed_cell` · secondary · **`carries: true`** | Find the cell lying up in the reeds by the south causeway | `OBJECTIVE COMPLETE — Find the cell lying up in the reeds by the south causeway` | live |

Notes on the three texts:
- ***"before the next load moves"* gives the 300 s deadline a reason inside the fiction.** At 300 s the last wave
  (`moto_rpg` ×2 to `causeway_s`) comes down onto the carriers' causeway. The EVA caption reads *"One minute. Get
  three carriers to the refuge before the next load moves,"* which is an order and a reason in one line.
- **All four civilians are called carriers**, the two on the causeway and the two in the yard. That is the premise:
  the people of the marsh hamlets are the wheels Hallaq lost (MDD §1).
- **`find_the_reed_cell` carries.** Its worth is said in beat 5, in its own `say` (§2.7), and on the after-action
  report's *"Carries into"* row. The objective text itself only orders the find, as every shipped `locate` does.
- **No `survive_until` screen is authored.** The WH I and Tel Marum I recons cap at two stars because their only
  secondary is a clock the passive control also completes (`README.md`, "The third star"). This mission's one
  secondary is the carry, so it can reach three.

### 2.5 `debrief`

> **victory** · **Idit** — 145 chars — *Four positions, and the carriers at the refuge instead of under a load. This is the first week of the war the Rif have had to stand still for us.*

> **defeat** · **Shai** — 114 chars — *We came off the marsh without enough of it. Whatever crosses those causeways tonight crosses with people under it.*

**The victory line names no count.** The objective needs three, but four can come out, and *"three people"* would be
false on the better run.

**The defeat line is true under every cause this mission can lose by** (§2.6). WH I pairs Shai on the win and Idit on
the loss; this town swaps the pair on I and III, so the act does not hand the same voice the same beat five times.

### 2.6 How this mission is lost, read in the end screen's own frames

| cause | frame (shipped `en.json`) | reads |
|---|---|---|
| the carriers' deadline | `outcome.failed.objective` | *Objective failed: Get three carriers to the refuge before the next load moves · 5:00* |
| the 720 s limit with `picture` open | `outcome.failed.timeUp` | *Out of time — Identify four positions covering the causeways was not finished* |
| every unit lost | `outcome.failed.force` | *Every unit lost · m:ss* |
| Conduct | — | **cannot happen**: no `fail_below`, the recon precedent (WH I) |

No frame says *"withdrawn"*. That is an internal `defeatCause` id, and no line in this sheet uses the word (checked by
script, §12).

### 2.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Ein Qasab I — The Causeways` · *2 primary objectives* | `hud.announce` | live |
| mission start | `dispatch` | narrator | §2.2 | title card | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §2.3 | deploy screen, then the commander bar | live |
| `objective(picture, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify four positions covering the causeways` | shipped path | live |
| `objective(picture, complete)` | `radio` | **Idit** | "Four, and every one of them is tied to the two causeways one way or another. A Rif cell with nowhere to drive to is a position, for once." | `objectives[].say`. True whichever four of the six tags are found, including the crest truck and the copse watch | live |
| `objective(find_the_reed_cell, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the cell lying up in the reeds by the south causeway` | | live |
| `objective(find_the_reed_cell, complete)` | `radio` | **Idit** | "That is the reed cell, lying up in the reeds beside the carriers' causeway. It is on the board now, and wherever it lies up later this week it does not get the first shot." | `objectives[].say`. **The carry, said when it is bought** (QH I precedent) | live |
| `evacuated` (a carrier reaches the refuge) | `toast` | system | `clear (1)` | `notice.evacuated`, shipped | live |
| `objective(get_the_carriers_home, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get three carriers to the refuge before the next load moves` | | live |
| `objective(get_the_carriers_home, complete)` | `radio` | **Shai** | "Three at the refuge. Whatever goes onto that causeway next, it goes without them." | `objectives[].say`. Shai counts the ones who got in (the BS breach / WH IV pairing) | live |
| `objective(get_the_carriers_home, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get three carriers to the refuge before the next load moves` | the only failable primary; it loses the mission | live |
| `objective(get_the_carriers_home, failed)` @300 s | `radio` | **Idit** | "The next load is moving and they are under it. We were the width of a marsh away." | `objectives[].say_on_fail`. Idit says what happened to the rest. The marsh is 5–8 tiles wide, so *"the width of a marsh"* is short | live |
| trigger `the_track_patrol_turns_for_the_hamlet` (`zone_entered(hamlet)` → `commit track` to `hamlet`) | `toast` | system | **label:** `Track patrol turns for the hamlet` | `triggers[].label`, 33 chars | live |
| same trigger | `radio` | **Idit** | "The east track patrol has turned for the hamlet. It is a technical on a track, so it comes the one way it can, and you can see which." | `triggers[].say` | live |
| trigger `the_riders_pull_back_along_the_south_causeway` (`casualties_pct(50)` → `withdraw_to track` to `rif_se`) | `toast` | system | **label:** `Riders pull back along the south causeway` | 41 chars. **T-A1.** *"Pull back"*, never a word that reads as a rout | live |
| same trigger | `radio` | **Idit** | "They are pulling out the only way wheels can here, back along the south causeway. Whatever is still standing on it is in their road." | `triggers[].say`. True whether or not the carriers are still on it | live |
| wave 100 s (`moto_rpg` ×2, `rif_ne` → `causeway_n`) | `toast` | system | `enemy reinforcements — 2 units inbound · north-east` | `alert.wave`, shipped | live |
| wave 100 s | `radio` | **Idit** | "Two riders off the north-east, and both have come down onto the north causeway. There is nowhere else here for a wheel to go, and every rider after them will do the same." | `enemy.waves[].say`. The cadence said once, as in WH I | live |
| wave 150 s (`technical`, `rif_se` → `causeway_s`) | `toast` | system | `enemy reinforcements — 1 unit inbound · south-east` | **no `say`, deliberately** | live |
| wave 200 s (`moto_rpg` ×2, `rif_se` → `hamlet`) | `radio` | **Idit** | "Two more off the south-east, and they are going to the hamlet, not to you. They are coming to load the yard." | `enemy.waves[].say`. The deadline, given a face | live |
| waves 250 s and 300 s | `toast` | system | `alert.wave`, shipped | **no `say`**: the 300 s wave lands on the carriers' failure tick, and two voices on one tick is chatter | live |
| `SimEvent destroyed` (`recon_drone`, by `eq_crest_truck`) | `radio` | **Idit** | "Drone is down over the east crest. That truck owns the sky out there; whatever is left to see, a man walks to." | needs a trigger that watches the sim (§10 G-E). **No tutorial step can carry it**: the step machine is gated to the tutorial | engine |
| `SimEvent ambushSprung` (`eq_reed_cell`) | `radio` | **Shai** | "That is the reed cell, firing out of the reeds beside the carriers. Anything you send in after it goes toward them first." | **T-A2**'s line. Same gap; the shipped `alert.ambushSprung` toast already fires | engine |
| `missionEnd(victory)` | `toast` | system | `mission.notice.missionAccomplished` | shipped | live |
| `missionEnd(victory)` | `debrief` | **Idit** | §2.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §2.5 | end screen | live |
| every `say` above | voice audio | Idit / Shai | as above | GH-110: nothing recorded (licence D5) | engine |

**A placement fact `level-scripter` must settle before these lines are true** (§10 G-P). The MDD puts `eq_reed_cell`
at (21.5, 35.5) and the causeway carriers at (31.5, 34.5), **10 tiles apart**. But T-A2 says the cell "holds fire
until a KDF unit is within 3 tiles of the carriers. It is the ambush radius, keyed to where the civilians stand."
That only works if the two are about 3 tiles apart. The lines above say *beside*, which survives either answer.
Beat 6 does too, because every causeway is lined with reeds. **Recommended:** stand the carriers at the shipped
`causeway_s` marker (22, 34), beside the cell, which makes T-A2 real.

---

## 3. `ein_qasab_2_foothold` — Ein Qasab II — Dead Ground

`foothold`. **Lieutenant Colonel.** On the new `jebel_matar` map (display name §1). Requires **R I**; produces
**R M C X I**. `target_minutes` 7; `time_limit_s` 840; `logistics_start` 400; `field_works: { kdf_outpost: 1 }`;
`flagged_zones: ["farmhouse"]`; `fail_below` 40. **The barn, and where to dig in.**

### 3.1 `name`

`Ein Qasab II — Dead Ground`

*Dead ground* is ground no observer can see. It is the mission's whole decision: the hold zone is a level-0 hollow
under two level-4 crests, so *"a raider on the level-1 north downs is three levels below the crest and invisible from
the farm"* (MDD §3.0). The name is the trap, and it is a soldier's term.

The MDD's *"Rain Hill"* is **not** used:
- it is a translation of the toponym *Jebel Matar*, the same objection as §2.1;
- *Rainhill* is a real English village.

Tree check: *dead ground* appears once, as a common noun in `deir_amun_1_recon`'s `say`. That is benign.
**Alternative if the lead wants it plainer:** *The Hill Farm* (Q1).

### 3.2 `dispatch`

**None, and there must not be one.** The town's dispatch is mission I's.

### 3.3 `briefing` — 1,039 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The farm in this hollow is the winter road's staging post, and his drone crates sit in its barn waiting for the rain to stop. The crests either side stand four levels over it, and nothing off the north downs is in sight until it tops them. | 239 |
| 2 | **Shai** | Hold the hollow for five minutes and burn the barn inside the same five. The engineers' charges are clean and slow under fire; the mortar and the Namer are quick, and every round near that yard is billed. | 204 |
| 3 | **Idit** | A family is in the yard between the house and the barn, two tiles from the cell inside it. There is a truck in the north saddle, and identified today it is a known gun over the causeway head, not a first shot. | 209 |
| 4 | **Shai** | You have the logistics for one outpost. Dig it into the hollow and it sees nothing; put it on the crest and it sees them coming, from outside the ground you have to hold. | 170 |
| 5 | **Idit** | Every wheel from the east comes through one two-tile gap in the dyke. From the north it is the saddle for wheels and the crest for feet. | 136 |
| 6 | **Shai** | The barn is the order; the house and the family beside it are on the rating. | 76 |

What each beat does:
- **Beat 1** carries the MDD's two story hooks, the farm as the winter road's staging post and Hallaq's drones by the
  crate (*"his drone crates"*: WH III's briefing has already named him as the man running them). It also carries the
  measured sight fact the hold is built on.
- **Beat 2** is the barn's two prices from MDD §5.2, word for word in meaning:
  - the demo squad's charges are *"clean and slow under fire"*;
  - the mortar and the Namer are *"fast, but every round near the yard is billed."*
- **Beat 3, second sentence, is what the carrying find is worth.** Idit says what an identification buys and what
  its absence costs, and gives no order (MDD hook: *"because it will be at the causeway head next week"*, with "next
  week" removed per §0.3). *"Over the causeway head"*, not *"at"*: the truck stands at (30.5, 12.5), just east of the
  `causeway_head` zone, overwatching it.
- **Beat 4 is the decision**, the hollow that sees nothing or the crest that splits the force. It is also the first
  campaign use of field works (MDD G8). If G8's fallback drops `field_works`, replace beat 4 with: *"Dig in where the
  hollow is, and know what it cannot see. A picket on the crest sees them coming, from outside the ground you have
  to hold."* (2 sentences, 138 chars, checked.)
- **Beat 5** is the two measured door facts: every eastern wheel through one 2-tile gap; the boulder band costs a
  north-west wheel 8 tiles, so the north is the saddle for wheels.
- **Beat 6 closes on the cost.** The `raze` target is billed nothing since 2026-10-07 (WH V's §5.5 note), and the
  flagged farmhouse and the family are billed for everything.

**The JSON string, to be pasted whole:**

> The farm in this hollow is the winter road's staging post, and his drone crates sit in its barn waiting for the rain to stop. The crests either side stand four levels over it, and nothing off the north downs is in sight until it tops them. Hold the hollow for five minutes and burn the barn inside the same five. The engineers' charges are clean and slow under fire; the mortar and the Namer are quick, and every round near that yard is billed. A family is in the yard between the house and the barn, two tiles from the cell inside it. There is a truck in the north saddle, and identified today it is a known gun over the causeway head, not a first shot. You have the logistics for one outpost. Dig it into the hollow and it sees nothing; put it on the crest and it sees them coming, from outside the ground you have to hold. Every wheel from the east comes through one two-tile gap in the dyke. From the north it is the saddle for wheels and the crest for feet. The barn is the order; the house and the family beside it are on the rating.

### 3.4 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `hold_the_hollow` | `hold_for` · `hollow` 300 s · **primary** | Hold the farm hollow for five minutes | `OBJECTIVE COMPLETE — Hold the farm hollow for five minutes` | live |
| `burn_the_barn` | `raze` · `barn_yard` 300 s · **primary, failable** | Burn the barn and the crates inside five minutes | `OBJECTIVE COMPLETE — Burn the barn and the crates inside five minutes` | live |
| `mark_the_saddle_truck` | `locate` · `eq_saddle_truck` · secondary · **`carries: true`** | Identify the truck in the north saddle | `OBJECTIVE COMPLETE — Identify the truck in the north saddle` | live |

- ***"the barn and the crates"*.** `barn_yard` is the barn only, and the MDD warns that `raze` must not count the
  yard walls. So the text names the barn and nothing that is not in the target set.
- ***"Identify the truck in the north saddle"*.** Truthful even after `the_saddle_truck_comes_down_to_the_farm` has
  moved it: it names where the truck *was* when the order was given, as WH III's *"Get eyes on the southern hide"*
  does.

### 3.5 `debrief`

> **victory** · **Shai** — 130 chars — *The farm is ours and the barn is ash. Whatever comes over those crests now comes down into us, and we see it on the skyline first.*

> **defeat** · **Idit** — 111 chars — *We are off the farm and they are back in the hollow. From the crest you cannot see what they are putting in it.*

The defeat line is true for all four causes (§3.6). It does not say the barn is standing, because a Conduct defeat
can come after the barn burns. The image is the mission's own decision, the hollow's blindness, turned on the
player's side.

### 3.6 How this mission is lost

| cause | reads |
|---|---|
| the barn's deadline | *Objective failed: Burn the barn and the crates inside five minutes · 5:00* |
| Conduct below 40 | *Conduct fell below the mission floor · m:ss* |
| the 840 s limit with the hold open | *Out of time — Hold the farm hollow for five minutes was not finished* |
| every unit lost | *Every unit lost · m:ss* |

### 3.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Ein Qasab II — Dead Ground` · *2 primary objectives* | | live |
| mission start | `dispatch` | — | **none.** The town's dispatch is mission I's | authorial silence | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §3.3 | | live |
| `objective(hold_the_hollow, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the farm hollow for five minutes` | | live |
| `objective(hold_the_hollow, complete)` | `radio` | **net** | "Five minutes in the hollow, uncontested. The farm is the brigade's for the rest of the week." | `objectives[].say`; the net, flat | live |
| `objective(burn_the_barn, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Burn the barn and the crates inside five minutes` | | live |
| `objective(burn_the_barn, complete)` | `radio` | **Idit** | "Crates, fuel and launch rails, under the hay. The swarms over the cattle track came out of barns like this one, and this one was waiting for the rain to stop." | `objectives[].say`. **Hallaq's presence, as an object.** The swarms over the cattle track are WH III's, always behind the player | live |
| `objective(burn_the_barn, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Burn the barn and the crates inside five minutes` | the only failable primary | live |
| `objective(burn_the_barn, failed)` @300 s | `radio` | **Shai** | "Five minutes, and the barn is standing with the crates in it. When the rain stops, they fly." | `objectives[].say_on_fail`. The cost, said as a forecast | live |
| `objective(mark_the_saddle_truck, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the truck in the north saddle` | | live |
| `objective(mark_the_saddle_truck, complete)` | `radio` | **Idit** | "That is the saddle crew. Wherever it is parked when we reach the causeway head, it is on the board now." | `objectives[].say`. **The carry, said when it is bought.** *"Crew"*, not *"truck"*, on purpose: the MDD lets EQ III field this tag as a `gun_truck` where II has a `technical`, and the tag (not the vehicle) is what carries. The line is true for either | live |
| trigger `the_saddle_truck_comes_down_to_the_farm` (`zone_entered(hollow)` → `commit saddle` to `farm`) | `toast` | system | **label:** `Saddle truck comes down to the farm` | 35 chars | live |
| same trigger | `radio` | **Idit** | "The truck in the saddle has started down the north track for the farm. If it is going to be identified on this ground, it is now." | `triggers[].say`. Idit prices the carry at the moment it gets harder | live |
| trigger `riders_come_through_the_dyke_gap` (`first_contact` → `commit gap` to `farm`) | `toast` | system | **label:** `Riders come through the dyke gap` | 32 chars | live |
| same trigger | `radio` | **Idit** | "Riders through the dyke gap, one at a time, because that is all it is wide. It is the only door on that side." | `triggers[].say`. The single-AT-team decision, given to the player as a fact | live |
| wave 60 s (`moto_rpg` ×2, `rif_n`) | `toast` | system | `alert.wave`, shipped | no `say` | live |
| wave 105 s (`militia_cell` ×2, `rif_nw`, on foot over the crest) | `radio` | **Idit** | "Two cells walking over the north crest on foot. From the farm they are not there until they are on the skyline." | `enemy.waves[].say`. The mission's name, happening | live |
| waves 150 s, 195 s, 240 s, 285 s | `toast` | system | `alert.wave`, shipped | **no `say`**. The gap trigger has already said the east, and the 105 s line the north | live |
| `works complete` (the outpost) | `toast` | system | `<b>Outpost</b> — complete` | `feed.works.complete`, shipped | live |
| `works complete` (the outpost) | `radio` | **Shai** | "Outpost is up. It is the first thing the brigade has built since the rain came." | needs a trigger on a `SimEvent` (§10 G-E) | engine |
| `SimEvent ambushSprung` (`eq_pocket_rpg`) | `radio` | **Idit** | "That was the marsh pocket west of the farm, and nothing of ours had looked into it." | same gap | engine |
| a round into the flagged `farmhouse` | `toast` | system | the shipped `roeNotice` copy | hard-coded, live | live |
| `missionEnd(victory)` | `debrief` | **Shai** | §3.5 | | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §3.5 | | live |
| every `say` above | voice audio | | | GH-110 | engine |

---

## 4. `ein_qasab_3_buildup` — Ein Qasab III — One Road

`buildup`. **Lieutenant Colonel.** On the new `ein_qasab_3` map (display name §1). Requires **R I**; produces
**R M C X**. `target_minutes` 7; `time_limit_s` 840.
- Economy: a camp, 400 + 150/min, a supply corridor, the `mill_islet` income zone, `intel_start` 100.
- ROE: `flagged_zones: ["hamlet"]`, `fail_below` 40.

**What to buy when every vehicle has one road, and where to put the stop.**

### 4.1 `name`

`Ein Qasab III — One Road`

It names two facts that are the same fact:
- *"every vehicle route crosses the causeway (21 road tiles)"*;
- the lieutenant's *"only road out is the protected one"*.

It sits in the tree's register beside *Both Gates* and *All Four*.

The MDD's *"The Long Causeway"* is **not** used. *Long Causeway* is a real road name in England, which is ground (c)
of `names.md` §3, a real feature. Tree check: *one road* appears once, as a common noun in
`beit_sahwan_2_foothold`'s `say`. Benign.

### 4.2 `briefing` — 1,042 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | Below the hamlet the fen is two reed channels with one causeway over them, and every vehicle you own crosses on it. Hallaq's man on the winter road is in the yard at the causeway head, with the stock barn beside him. | 216 |
| 2 | **Shai** | Burn the stock, hold the causeway head for four minutes, and kill or capture him. The camp builds what you pay for, and anything on wheels it builds goes up that one road in single file, under the terrace. | 205 |
| 3 | **Idit** | When he has lost enough he runs for the north road, and it goes up through the hamlet. You came with the Intel for one smoke screen; a sweep of the dead ground behind the lip costs half as much again. | 200 |
| 4 | **Shai** | Buy feet. A squad wades where a Namer cannot, and an AT team sent early across the west island reaches the lip before he does. | 126 |
| 5 | **Idit** | Reed cells will wade out for the camp's door and the supply road; while one stands at the door, the camp builds nothing. What you marked on the causeways and at the saddle this week comes back with its ambush spent. | 215 |
| 6 | **Shai** | Stop him beyond the hamlet, or chase him through it and pay for every shot. | 75 |

What each beat does:
- **Beat 1:** the map and the man.
- **Beat 2:** the three primaries and the buy constraint (*"single file, under the terrace"*, MDD §5.3).
- **Beat 3 is Idit pricing what knowing costs**, in exact numbers. `intel_start` 100 is one smoke screen; a drone
  sweep is 150, half as much again. The rest has to be earned, at 8 an identification and 40 an objective. The sweep
  shows *"the reserve and the escape road"*. She does not tell him to buy it.
- **Beat 4 is Shai's buy.** The MDD's hook is *"Shai on buying infantry when he has the money for armour."* Its
  measured case: an AT team sent early, *"wading the west island and climbing to the lip: 44 steps on foot"*,
  against the lieutenant's 13 steps by wheel once he runs.
- **Beat 5** gives the camp's two threats as mechanics:
  - production pauses while a ground enemy contests the exit (`production.ts`);
  - the convoy halves while a cell sits within 2 tiles of the road.

  Its second sentence is **the carry-over rule** (§4.3).
- **Beat 6 closes on the cost.** It is the stop decision, said as billing. *"Pay for every shot"* is the hamlet's
  `fail_below` 40 and `structure_penalty_mult` 1.

**What the briefing deliberately does not say:** that he *escapes*. Without T-C2 (§8; G5) nothing removes him at
`north_exit`. He withdraws there and can still be killed, so a briefing that promised *"if he reaches the road he is
gone"* would be a promise the mission does not keep. *"Stop him beyond the hamlet, or chase him through it"* is true
with T-C2 and without it.

**The JSON string, to be pasted whole:**

> Below the hamlet the fen is two reed channels with one causeway over them, and every vehicle you own crosses on it. Hallaq's man on the winter road is in the yard at the causeway head, with the stock barn beside him. Burn the stock, hold the causeway head for four minutes, and kill or capture him. The camp builds what you pay for, and anything on wheels it builds goes up that one road in single file, under the terrace. When he has lost enough he runs for the north road, and it goes up through the hamlet. You came with the Intel for one smoke screen; a sweep of the dead ground behind the lip costs half as much again. Buy feet. A squad wades where a Namer cannot, and an AT team sent early across the west island reaches the lip before he does. Reed cells will wade out for the camp's door and the supply road; while one stands at the door, the camp builds nothing. What you marked on the causeways and at the saddle this week comes back with its ambush spent. Stop him beyond the hamlet, or chase him through it and pay for every shot.

### 4.3 The carry-over, read in one string

**The requirement is real.** Three tags from earlier missions come back here, and each spawns identified with its
ambush forfeited if it was marked:
- `eq_reed_cell` (EQ I's carrying secondary);
- `eq_causeway_rpg` (marked by EQ I's picture);
- `eq_saddle_truck` (EQ II's carrying secondary).

**The surface cannot branch.** `briefing` is a plain string, and no field reads the ledger
(`qarn_hadid/narrative.md` §9 P1, still unbuilt).

**So beat 5 states the rule, not the state:** *"What you marked on the causeways and at the saddle this week comes
back with its ambush spent."*
- A player who marked all three reads it as reassurance.
- A player who marked none reads it as a warning.
- Neither reads a falsehood.

It names the two places, *"on the causeways"* (EQ I) and *"at the saddle"* (EQ II), and that is what makes I and II's
three stars legible: the player is told, in the orders voice, what the finds bought. The rule's other half (*"whatever
you did not gets the first shot"*) is left to the `engine` line in §4.7, because beat 5 has no room for it under 240.

### 4.4 Objectives

| id | type · target | as an order | as a toast | status |
|---|---|---|---|---|
| `kill_hallaqs_man` | `eliminate_hvt` · `eq_hvt_ferryman` · **primary** | Kill or capture Hallaq's man on the winter road | `OBJECTIVE COMPLETE — Kill or capture Hallaq's man on the winter road` | live |
| `hold_the_head` | `hold_for` · `causeway_head` 240 s · **primary** | Hold the causeway head for four minutes | `OBJECTIVE COMPLETE — Hold the causeway head for four minutes` | live |
| `burn_the_stock` | `raze` · `stock_yard` 330 s · **primary, failable** | Burn the stock barn inside five and a half minutes | `OBJECTIVE COMPLETE — Burn the stock barn inside five and a half minutes` | live |
| `take_the_mill` | `capture` · `mill_islet` 15 s · secondary | Take the mill islet and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the mill islet and hold it for 15 seconds` | live |

- ***"Kill or capture"*** is kept, as the act's ladder requires (§0.4). It is a kill until GH-18 (MDD G4), exactly as
  in WH III to V.
- ***"five and a half minutes"***: the tree spells minutes out. 330 s has no shipped precedent; WH I's *"three
  minutes twenty"* is the nearest.
- **`take_the_mill`** matches the shipped `capture` label shape (*"Take the hollow behind the start line and hold it
  for 15 seconds"*, QH II). It does not carry: the MDD gives EQ III no carrying secondary, and nothing after it reads
  one.

### 4.5 `debrief` and `aftermath`

> **victory** · **Shai** — 139 chars — *One road, and the stock is ash at the end of it. When the water goes down, there is a winter's freight less on the corridor than he loaded.*

> **defeat** · **Idit** — 138 chars — *We came back over the causeway without what we crossed it for. When the fords open, the north bank goes east with whatever is still on it.*

***"than he loaded"*** is Hallaq, inside the winter's fiction. It reads true before WH IV, after it, and after WH V
(§0.3).

**`aftermath`: none, deliberately.**
- The three shipped `aftermath` lines are all act or campaign closes.
- WH V's *Ari Actual* is the war's last one.
- A banner here would sit, for a player arriving after WH V, after the campaign's ending.

### 4.6 How this mission is lost

| cause | reads |
|---|---|
| the stock's deadline | *Objective failed: Burn the stock barn inside five and a half minutes · 5:30* |
| Conduct below 40 | *Conduct fell below the mission floor · m:ss* |
| the 840 s limit with a primary open | *Out of time — Kill or capture Hallaq's man on the winter road was not finished*, or *… Hold the causeway head for four minutes was not finished* |
| every unit lost | *Every unit lost · m:ss* |

**If the war ends on this mission.** A player who cleared WH V first finishes the campaign here, and
`campaign-close.ts`'s four closing lines follow this mission's own debrief. Read in that order, they are true: *"That
was the last question on the board. Three fronts, and nothing left on the wall to read."* Nothing here repeats them,
and nothing here contradicts them (§10 G-S).

### 4.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Ein Qasab III — One Road` · *3 primary objectives* | | live |
| mission start | `dispatch` | — | **none** | authorial silence | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §4.2 | | live |
| `objective(burn_the_stock, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Burn the stock barn inside five and a half minutes` | | live |
| `objective(burn_the_stock, complete)` | `radio` | **Idit** | "The stock is burning and the manifests are not. Every load in that barn was addressed to one yard, east of the village at Wadi Halam, and that is where this winter's freight was going." | `objectives[].say`. **The hook into WH IV and V** (MDD §2). Past tense on purpose (§0.3) | live |
| `objective(burn_the_stock, failed)` @330 s | `toast` | system | `OBJECTIVE FAILED — Burn the stock barn inside five and a half minutes` | the only failable primary | live |
| `objective(burn_the_stock, failed)` @330 s | `radio` | **Shai** | "Five and a half minutes, and the stock is standing. When the fords open, it goes east full." | `objectives[].say_on_fail` | live |
| `objective(kill_hallaqs_man, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill or capture Hallaq's man on the winter road` | | live |
| `objective(kill_hallaqs_man, complete)` | `radio` | **Idit** | "That is Hallaq's man on the winter road. He knew which causeway would carry a truck on which night, and nobody else on that bank does." | `objectives[].say`. What a lieutenant is *worth*, as WH III's line is | live |
| `objective(hold_the_head, complete)` @240 s | `toast` | system | `OBJECTIVE COMPLETE — Hold the causeway head for four minutes` | | live |
| `objective(hold_the_head, complete)` | `radio` | **net** | "Causeway head held, four minutes. The road is ours as far as the terrace." | `objectives[].say` | live |
| `objective(take_the_mill, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the mill islet and hold it for 15 seconds` | | live |
| `objective(take_the_mill, complete)` | `radio` | **net** | "Mill islet taken. It is the one place on the fen two vehicles can pass, and the traffic that stops at it pays our camp now." | `objectives[].say`. **True only while `mill_islet` is an income zone** (MDD §5.3). If the zone is cut, the line loses its second clause | live |
| zone `mill_islet` gained / lost | `toast` | system | `ground held — income zone ours` / `ground lost — …` | `alert.zone.*`, shipped | live |
| trigger `the_reserve_comes_over_the_lip` (`zone_entered(causeway_head)` → `commit reserve` to `causeway_head`) | `toast` | system | **label:** `Reserve comes down over the lip` | 31 chars | live |
| same trigger | `radio` | **Idit** | "There was a reserve behind the lip, in ground nothing south of the houses can see. It is coming down to the head." | `triggers[].say`. The sweep the player did not buy, answered | live |
| trigger `hallaqs_man_runs_for_the_north_road` (`casualties_pct(40)` → `withdraw_to ferry` to `north_exit`) | `toast` | system | **label:** `Hallaq's man runs for the north road` | 36 chars. The MDD's working label, unchanged | live |
| same trigger | `radio` | **Shai** | "He is running for the north road, and it goes up through the hamlet. Stop him beyond the houses if you can get there; in them, every shot is billed." | `triggers[].say`. *"Do not chase what runs"*, charged a third time, after WH I and WH III | live |
| wave 45 s (`technical`, `rif_nw` → `causeway_head`) | `toast` | system | `alert.wave` | no `say` | live |
| wave 100 s (`militia_cell` ×2, `reed_e` → `south_landing`, wading) | `radio` | **Idit** | "Two cells wading out of the east reeds for the south landing. They are not after the head; they are after your road." | `enemy.waves[].say` | live |
| wave 150 s (`moto_rpg` ×2, `rif_n`) | `toast` | system | `alert.wave` | no `say` | live |
| wave 200 s (`rpg_team` + `militia_cell`, `reed_w` → the camp exit) | `radio` | **Idit** | "A cell and an RPG team out of the west reeds, walking to the camp's door. While anything of theirs stands at it, the camp builds nothing." | `enemy.waves[].say`. Production pauses while the exit is contested | live |
| production paused / supply cut | `toast` | system | `production paused — Camp 1`; `supply cut — convoy income halved` | `alert.productionPaused`, `alert.supply.cut`, shipped | live |
| wave 250 s (`technical` + `moto_rpg`, `rif_nw`) | `toast` | system | `alert.wave` | no `say` | live |
| wave 300 s (`militia_cell` ×2, `reed_e` → `mill`) | `toast` | system | `alert.wave` | `say` only under T-C3 (§8) | live |
| a round into the flagged `hamlet` | `toast` | system | the shipped `roeNotice` copy | | live |
| `SimEvent destroyed`: the column's lead vehicle, by `eq_causeway_rpg` **unmarked** | `radio` | **Idit** | "That team was lying at the causeway mouth and nothing of ours had seen it. Marked on the north causeway, it would have been a map reference instead of a first shot." | §10 G-E. **The carry-over said aloud, at the moment it costs**: the other half of §4.3's rule | engine |
| `missionEnd(victory)` | `debrief` | **Shai** | §4.5 | | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §4.5 | | live |
| `missionEnd(victory)` | `aftermath` | — | **none** (§4.5) | authorial silence | live |
| every `say` above | voice audio | | | GH-110 | engine |

---

## 5. Jubran Hallaq at Ein Qasab — why he does not speak

`wadi_halam/narrative.md` §5.7 gives Hallaq **one line in the whole act**, on WH V's
`the_motorcycles_come_down_on_the_column`, about the road and never about the player. Adding one here breaks that
for two reasons. The first is mechanical, and decides it.

1. **A dead man would speak.** `speaker: "enemy"` paints the front's villain (`speakerPortrait` resolves `enemy`;
   `commander.json` `villains.naharin.portrait` is `jubran_hallaq.png`). The board does not stop a player clearing WH
   V before this town (§0.3). That player would hear Hallaq, and see his face, after watching him die at his gate.
2. **It spends the act's scarcest effect on a week in which he loses only freight.** Qarn Hadid made the same call for
   Karim Adhal (`qarn_hadid/narrative.md` §4).

**And the lieutenant cannot speak as `enemy` either.** The same portrait would draw Hallaq's face over his man's
words. The schema has four speakers and none of them is *a villain's subordinate*.

One line is written and **HELD**, for the moment it would sit on if the lead overrules this (Q3). It needs the
trigger's existing `say` (Shai's) moved off it, since one trigger carries one `say`:

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| **HELD** · EQ III `hallaqs_man_runs_for_the_north_road` | `radio` | **enemy** | "Leave the stock where it stands. Stock is bought again in a season; a man who knows the causeways is not." | an instruction to his own man, so there is no second person meaning the player. A logistician's last word is about freight. **Not to be authored** unless the lead overrules §5 *and* G1's ordering becomes enforced | live |

---

## 6. Ambient lore — secondary locations

Ground the player crosses that no objective names.

**All rows are `engine`, for two reasons at once:**
- **There is no event to fire them on.** A `zone_entered` trigger must also `do` something, so a lore-only trigger
  does not exist.
- **The tutorial step machine, the only condition-gated text engine, is gated to the tutorial.** No tutorial step
  can carry them.

Markers and zones are the MDD's (§3.1 to §3.3) and the shipped `ein_qasab.json` (`causeway_n`, `causeway_s`,
`east_crest`, `hamlet`, `kdf_start`; zones `east_downs`, `hamlet`, `marsh`, `west_ridge`, read this session).

| mission | location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|---|
| I | the west ridge | zone `west_ridge` | `radio` | Shai | "Four levels over the floor, and the one ground on this map that sees all of it." | engine |
| I | the oak copse | (10.5, 16.5), `eq_copse_watch` | `radio` | Idit | "One cell on our own bank, in the oaks. They were not expecting anybody to come this way in the rain either." | engine |
| I | the marsh | zone `marsh` | `radio` | Idit | "Five to eight tiles of reed, the whole height of the valley. A rifleman crosses it at full pace in cover; nothing with wheels crosses it at all." | engine |
| I | the north causeway | `causeway_n` (22, 12) | `radio` | Idit | "North causeway, one level over the water. It was built for carts, and it is the width of one truck." | engine |
| I | the south causeway | `causeway_s` (22, 34) | `radio` | Idit | "South causeway, twenty-two tiles below the north one. There is no third, and both of them end at the same downs." | engine |
| I | the east crest | `east_crest` (39, 10) | `radio` | Shai | "Two levels over the downs, with the hamlet behind it. Whatever stands on that crest sees both causeways come ashore." | engine |
| I | the hamlet | zone `hamlet` | `radio` | Idit | "Four houses inside a wall. Everybody on this map who is not fighting lives in them." | engine |
| I | the refuge | zone `refuge` [0, 44, 10, 4] | `radio` | Shai | "The refuge is the corner behind our own start line. That is all it has to be." | engine |
| II | the summit | `north_summit` (8, 8) | `radio` | Idit | "Five levels, as high as anything on the downs, and it looks at the farm from too far away to matter." | engine |
| II | the boulder band | x13–30, y4–7 | `radio` | Idit | "Boulders across the north flank. A man walks through them; a truck from the north-west goes eight tiles round." | engine |
| II | the north saddle | `north_saddle` (34, 11) | `radio` | Idit | "The one low place in the north crest, two levels down, with the track through it. Everything on wheels from the north uses it." | engine |
| II | the shoulder | `shoulder` (22, 13) | `radio` | Shai | "The crest's high shoulder, five levels. Stand there and the north downs are yours; the hollow is behind you and out of sight." | engine |
| II | the dyke | the `^` band, south edge to east edge | `radio` | Idit | "A basalt dyke two tiles thick, cut once for vehicles and twice by rubble men can climb. It adds nothing to the raid's walk; it decides where the wheels come through." | engine |
| II | the dyke gap | `dyke_gap` (37, 35) | `radio` | Shai | "Two tiles wide. One team holds it, and while it does, the east has no other door." | engine |
| II | the marsh pockets | three pockets, 70 tiles | `radio` | Idit | "Three pockets of reed around the farm. They keep the wheels on the track and they keep a man out of sight." | engine |
| II | the farmhouse | zone `farmhouse` | `radio` | Idit | "The house is flagged, and the family's whole life is between it and the barn." | engine |
| III | the lip | zone `lip` | `radio` | Idit | "Five levels, two above the slope behind it. From the hamlet terrace the ground beyond the lip does not exist." | engine |
| III | the reverse slope | y0–3, level 3 | `radio` | Idit | "Dead ground behind the lip, with boulders a man can walk through and a truck cannot. Whatever he keeps in reserve, he keeps there." | engine |
| III | the north road | `north_exit` (18, 0) | `radio` | Shai | "The track up from the causeway head goes through the hamlet and over the lip. It is his only road off this map, and it is the protected one." | engine |
| III | the hamlet terrace | zone `hamlet` [8, 8, 30, 4] | `radio` | Idit | "Four low houses on the terrace above the head. They watch the causeway because there is nothing else to watch." | engine |
| III | the stock barn | zone `stock_yard` | `radio` | Idit | "A warehouse inside a yard wall at the causeway head. The wall is worth nothing; what is stacked inside it is a winter." | engine |
| III | the north channel | y17–19 | `radio` | Shai | "Three rows of reed and water from bank to bank. A squad wades it in the open; a column crosses it on one tile of road." | engine |
| III | the west island | x0–16, y20–28 | `radio` | Idit | "Tussock between the channels. No vehicle reaches it, and a rifleman from the camp is on it in sixteen steps." | engine |
| III | the mill | `mill` (23, 25) | `radio` | Idit | "The pump house on the islet. It is the passing place, so every vehicle you own stops beside it." | engine |
| III | the south landing | zone `south_landing` | `radio` | Shai | "Where the causeway comes ashore on our side. Lose it and the camp is building for a road it cannot reach." | engine |
| III | the supply road | y40, from `supply_entry` (0, 40) | `radio` | Idit | "The convoy road runs along the south bank with reeds sixteen steps away. It is the cheapest thing on this map to cut." | engine |

---

## 7. EVA announcements — the Ein Qasab delta

The EVA set is shipped as captions (`packages/app/src/voice/announce.ts`, `announce.*` in `en.json`); audio is
unrecorded, which is GH-110, licence D5. **The captions this town produces are its objective texts in the shipped
frames** (*New tasking.* / *Objective complete.* / *Objective failed.* / *One minute.*). Each was read in those
frames in §2.4, §3.4 and §4.4.

**There is no new announcement, with one exception that is `engine` twice over:**

| event | line | status |
|---|---|---|
| a vehicle wreck closes the causeway (T-C1, needs G6) | "Road blocked." | engine |

**The doctrine rule heads this section before any line is recorded:** the net is flat, unhurried and unnamed, with
no accent, idiom or slogan, and no prowords beyond *Actual*. It reports a state, never a verdict.

## 7a. Barks

**The rule first, because retrofitting it means throwing recorded audio away (GH-110):** barks are keyed by unit
**role**, never per unit. Every line is doctrine and never a people: KDF in Hebrew, the Rif in standard military
Arabic, and no faith, dialect, slogan or real call sign on either side (GDD §2 Voice).

**No lines are written here.** The town adds no role (MDD §6.1). One warning is new: **civilians never bark.** Their
role is `support`, which is shared with the medic, and the carriers here are civilians walked through the reeds under
fire. A `support`-keyed set must exclude the civilian unit by type before any line is recorded.

---

## 8. The twist lines — T-A1 to T-C4

The **classification is `level-scripter`'s.** The lines are this sheet's, and so is the recommendation. The
"mechanic" column is what each needs besides a voice.

| # | mission | twist | speaker | line | mechanic, and the recommendation | status |
|---|---|---|---|---|---|---|
| **T-A1** | I | *They cannot run.* The 50% withdrawal drives back along the carriers' causeway | Idit | "They are pulling out the only way wheels can here, back along the south causeway. Whatever is still standing on it is in their road." | `withdraw_to` and the vehicle mask, live. **Adopt.** It costs nothing; it is the MDD's own trigger, and the theme in one moment | live |
| **T-A2** | I | *The carriers are the cover.* The reed cell springs only near the carriers | Shai | §2.7, the `ambushSprung` row; carried live by beat 6 and the reed cell's `say` | an `ambush(3)` stance. **Adopt, and fix the placement first** (§2.7, G-P): at the MDD's coordinates the cell is 10 tiles from the carriers and the twist cannot happen | live |
| **T-A3** | I | *The north causeway goes under* at 240 s | Idit | "The north causeway has gone under. One road left for anything on wheels, theirs and ours." | no action changes terrain (G6). **Do not adopt.** EQ III already has one road | engine |
| **T-B1** | II | *The crates fly.* A swarm at 200 s | Idit | "A swarm off the north downs. Not every crate on this road was in that barn." | `spawn`, live. **Adopt only as an edge spawn at `rif_n`, with this label: `Drone swarm lifts off the north downs`** (37 chars). The MDD's form spawns the swarm *at the barn*. A trigger cannot read whether the barn has burned, so a player who burned it at 150 s would see drones rise from ash. The edge form is true either way. **Measure it first**: there is no Remetz in II, and rifles are poor against a swarm (GH-274 `swarm.hit_mult`) | live |
| **T-B2** | II | *The family is the cell's cover* | — | **no line**: a stance condition on civilians is a new schema field (MDD) | **Do not adopt.** Beat 3 and the flagged farmhouse already make the family the cost | engine |
| **T-B3** | II | *The saddle truck was a decoy* | Idit | "The saddle truck has gone back over the crest at the first shot. It was never there to fight; the raid is coming through the gap." | `withdraw_to` and a wave, live. **Do not adopt.** It puts a second trigger on group `saddle`, against the MDD's `zone_entered(hollow)` commit. It also pulls the carrying target off the map early, which makes EQ II's third star a race | live |
| **T-C1** | III | *The wreck closes the road* | Shai | "That wreck is the road now. Everything behind it walks or waits." | wrecks are not in the masks (G6). **Do not adopt** | engine |
| **T-C2** | III | *He gets off the map* | Idit | "He is over the lip and up the north road. What he knew about the causeways went with him." | an enemy-side arrival condition plus a removal (G5). **Recommend as the town's one engine follow-up.** Without it the stop is urgency with no loss behind it. The briefing is written so it stays true until then (§4.2) | engine |
| **T-C3** | III | *The mill is full of people* | Idit | on `take_the_mill`: "There are families in the mill. The hamlet sent them down to the one building on the fen with a floor above the water, and every vehicle you own stops beside it." The 300 s wave: "Two cells wading for the mill. If the families are still inside it, that is where this fight is now." | a civilian group at `mill`, live. **Adopt, subject to `playtest`.** It turns the income islet, the buildup's one purchase of ground, into a Conduct decision, and it is the act's bait at its smallest. Under T-C3 the first line **replaces** the net's `take_the_mill.say` | live |
| **T-C4** | III | *The crates fly again.* A swarm wave at 220 s | Idit | "A swarm off the north, and the laser carrier can stand on the causeway or the islet and nowhere else. Not every crate on this road was in a barn we found." | a wave, live. **Hold.** At most one swarm in the town, and T-B1's edge form tells the same story a mission earlier. If T-C4 is adopted *instead*, give it this `say` and leave T-B1 out | live |

**Build order, if the lead wants one:**
1. **T-A1 and T-A2**: free, and they are the theme.
2. **T-C3**: the one twist that turns a purchase into restraint.
3. **T-B1** (edge form), once measured.
4. **T-C2**, when `sim-guard` can.

---

## 9. Proper nouns, for `level-scripter` to carry into the screen

`storyline.md` §2.4 and `names.md` §3 and §8. **The web probes (`names.md` §3: exact title, full-text search, and the
armed-force search) were not run this session**, because no web tool is available to this agent. Each row below
therefore says what *was* checked, and the web pass is the outstanding step.

| noun | used as | rule | checked this session | verdict |
|---|---|---|---|---|
| **Ein Qasab** | town name, mission prefix, existing map name | §2.4(1): needs a `world.json` entry (G2) | in-repo: the map, its `name`, `en.json`, `UNLISTED_MAP_IDS`. The lead approved the name at S-6 (rain spec §12.5). That spec records that a real-world collision "cannot be ruled out" (*Ein* is a common spring prefix, *Qasab* is reed) | **keep**; the residual risk is the lead's, already accepted |
| **The Causeways** | EQ I title | generic noun phrase, like *The Fords* | in-repo: no title or proper noun collision | keep |
| **Dead Ground** | EQ II title | military common noun | in-repo: one benign common-noun use (`deir_amun_1_recon` `say`) | keep; web pass pending |
| **One Road** | EQ III title | generic | in-repo: one benign common-noun use (`beit_sahwan_2_foothold` `say`) | keep |
| **Hallaq's man on the winter road** | `eq_hvt_ferryman`'s in-fiction designation | not a personal name, so §2.4(3) does not apply. **It must not acquire a name** (WH III precedent) | — | keep |
| *ferryman* | the tag id only | **collides with Hallaq's KDF file name FERRY** | in-repo: this sheet's script checks every player string for `ferry` (§12): 0 hits | **never in a player string.** Optionally rename the tag to `eq_hvt_winter_road` so no future author lifts it into a label |
| *Jebel Matar* | map id `jebel_matar` (rain spec §5.4) | §2.4(1): a coined toponym with no `world.json` entry. *Jebel* (mountain) + *matar* (rain) is a common-noun compound, so a real place cannot be ruled out | in-repo: the rain spec and the MDD only | **keep as the id, not as a display name.** The display name is *Ein Qasab — The Hill Farm* (§1, Q2) |
| *Rain Hill*, *Reed Spring* | the MDD's and spec's glosses | translations of the toponyms; *Rainhill* is a real English village | — | **never in a player string** |
| **Ein Qasab — The Hill Farm** | `jebel_matar` `name` | `<Town> — <feature>` | in-repo: no use of *hill farm* | keep |
| **Ein Qasab — The Lower Causeway** | `ein_qasab_3` `name` | `<Town> — <feature>` | in-repo: the MDD's working name only | keep |
| *The Long Causeway* | the MDD's EQ III title | *Long Causeway* is a real road name in England (`names.md` §3 ground c) | — | **not used** |

**Names this sheet relies on and does not add:** Jubran Hallaq, the Rif, Wadi Halam, the cattle track (WH III's
title), Eitan, Namer. All are canon.

---

## 10. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-E** | A trigger cannot fire on a `SimEvent` or an objective. Five `radio` rows here are `engine` for this alone: the drone, two ambushes, the outpost, and the unmarked RPG | two `on.kind`s, `sim` and `objective` (Act III's G-E, unchanged) | `sim-guard` |
| **G1** | No town-level gate (MDD G1). The board's two lock lines (§1) are `engine` | `unlock.after_mission` on a town; render it through `gateSentence`, never `unlockReason` | `sim-guard`, app |
| **G5** | Trigger conditions read the player side only, so T-C2 is unbuildable and the briefing must not promise an escape | an enemy-side arrival condition (MDD G5) | `sim-guard` |
| **G-P** | **A placement contradiction in the MDD.** `eq_reed_cell` at (21.5, 35.5) and the causeway carriers at (31.5, 34.5) are 10 tiles apart, so T-A2's "keyed to where the civilians stand" cannot happen with an `ambush(3)` | carriers at the shipped `causeway_s` marker (22, 34) | `level-scripter` |
| **G-Q** | `villainState` has no `ends_at` for Naharin, and falls back to the region's last mission. With `ein_qasab` listed **first**, that is still `wadi_halam_5_depot`, which is correct. One reordering of `towns` would flip Hallaq's card to *killed* on EQ III | add `"ends_at": "wadi_halam_5_depot"` to `commander.json` `villains.naharin`, as the Marj's has | `mission-author` |
| **G-R** | *manifest* is on `player-wording.test.ts`'s deny list for `en.json`. Mission data is not scanned, and WH II's shipped `burn_store.say` already uses it | none needed. **Keep the word out of every catalogue string** (§1 does). Recorded so a later move of mission lines into the catalogue does not trip the gate | `content-validator` |
| **G-S** | The war's end now depends on order. `campaignComplete` needs every Naharin mission, so the four closing lines follow whichever of WH V and EQ III is cleared last. WH V's *Ari Actual* and the Colonel line still fire at WH V, and EQ then plays with a Lieutenant Colonel on the HUD | none recommended. The closing lines read true after EQ III (§4.6). This is the MDD's "honest limit", stated where the text is affected | the lead (Q5) |
| **G-T** | **The after-action report names the wrong mission.** `Carries into {next}` uses the town's *next* mission. EQ I's reed cell would read *"Carries into Ein Qasab II — Dead Ground: Find the cell lying up in the reeds by the south causeway"*, but EQ II never reads that tag; EQ III does | name the first later mission whose `requires` includes the key and whose placements carry the tag, or fall back to `Carries forward: {text}` | app (`ui/after-action.ts`) |
| **G-U** | The harness keeps the chain only if II declares `requires` **I**. EQ III reads `eq_reed_cell` from I. `MissionRuntime` unions incoming `intel.marked_positions` with its own, so the chain holds if, and only if, EQ II requires I (the MDD's ledger says it does) | keep `requires: R I` on EQ II; `playtest` must wire the chain with the app's merged ledger (`tools/src/backtest/playtest.ts` comment at 242) | `level-scripter`, `playtest` |
| **G-L** | No radio overlay with portrait frame and plate art. **Not blocking**: every line arrives on the commander bar | (Act III G-L) | `render-vfx` |
| **G-G** | `pnpm validate:audio` cannot accept a voice file. Every voice row is blocked on it | GH-110 | `content-validator` |

---

## 11. GDD amendments

**Canon moved by one fact:** Naharin has a second town, a winter interlude between Wadi Halam III and IV, with no
promotion and no villain line in it. Exact text follows. **None of it was applied**, because the brief for this pass
forbids editing shipped files, and because the town must reach the tree (G2) before a document says it exists (the
Qarn Hadid precedent, `qarn_hadid/narrative.md` §11.1).

### 11.1 GDD §2, the town list (gated on G2)

> **Towns:** Beit Sahwan, Khan Rafid, Deir Amun (Marj) · Tel Marum, Qarn Hadid, Umm Zeitoun (Sur) · Wadi Halam,
> Ein Qasab (Naharin).

### 11.2 GDD §11, one sentence added after the villain paragraph

> **Not every town opens a front or closes one.** Qarn Hadid falls between Tel Marum and Umm Zeitoun, and Ein Qasab
> falls in the winter between Wadi Halam's third and fourth missions, when the rain shuts the fords and the
> corridor's traffic goes onto the marsh causeways. In such a town the front's adversary is present only through
> what he leaves (a tube in a bowl, crates in a barn, a manifest), and he does not speak.

### 11.3 GDD §11, a stale clause (independent of this town, recorded because it was found)

§11's last sentence lists *"a `debrief` that can tell a victory from a defeat"* as approved and not built. It was
built at G11 (`debrief: { victory, defeat }`, used by every Wadi Halam mission). The portraits now resolve for all
three named speakers, including `enemy`. **Replacement:**

> **Approved and not yet built:** voice audio for briefings, transmissions and announcements, and a radio overlay
> frame for the `say` lines.

**Version line, if all three land:** 1.2.3 → **1.2.4**.

### 11.4 `storyline.md` §3.3 (the lead's, when it decides)

Two rows, proposed for the Act III table:

| id | name | phase | rank | Idit's intel beat | FERRY's presence |
|---|---|---|---|---|---|
| `ein_qasab_1_recon` · `_2_foothold` · `_3_buildup` | Ein Qasab I–III — The Causeways · Dead Ground · One Road | recon · foothold · buildup | Lt Col | the count on the causeways; the truck at the saddle; the manifests naming the yard east of Wadi Halam | the carriers, the crates in a barn, the stock. His man on the winter road dies or is taken; he does not appear |

---

## 12. Row counts and verification

Every table row in this file whose last cell is `live`, `schema` or `engine`, **counted by script**. The proper-noun
table, the ladder tables and the defeat-cause tables carry no status cell, and are not counted.

| status | rows | what they are |
|---|---|---|
| `live` | **102** | see the breakdown below |
| `schema` | **0** | every field this town needs exists |
| `engine` | **42** | see the breakdown below |

**144 rows** carry a status.

The **102 `live` rows:**
- by section: the board 10 · EQ I 27 · EQ II 25 · EQ III 33 · the HELD Hallaq line 1 · twist rows 6;
- by channel, inside the three mission tables:
  - `toast` 35;
  - `radio` (a `say` on an objective, trigger or wave) 24;
  - objective rows 10;
  - `debrief` 6;
  - `title` 3, `brief` 3;
  - `dispatch` 3 (EQ I's line, and the deliberate nones on II and III);
  - `aftermath` 1 (EQ III's deliberate none).

**One of the 102 is HELD and must not be authored**: Hallaq's line in §5. Its status is `live` because the field and
the portrait both exist, not because it ships.

The **42 `engine` rows:**
- ambient lore 26;
- `radio` bound to a `SimEvent` 5 (I: the drone, the reed cell's ambush; II: the outpost, the pocket RPG; III: the
  unmarked RPG at the causeway mouth);
- voice audio 3, one a mission;
- board lock lines 3 (the town gate, the spoken line, the hover);
- twist rows 4 (T-A3, T-B2, T-C1, T-C2);
- EVA 1 (*"Road blocked."*).

What the 42 are blocked on, and nothing else:
1. **No event and no surface at once**: the 26 ambient rows.
2. **A trigger that can watch the sim** (G-E): 5 rows.
3. **A town gate** (G1): 3 rows.
4. **Terrain and wreck changes, an enemy-side condition, and a civilian stance condition** (G6, G5, T-B2): 4 twist
   rows and the EVA row.
5. **Recorded voice** (GH-110): 3 rows.

Excluding ambient lore, **16 of 118 rows (14%) reach nobody today.**

**Run this pass, by script rather than by eye** (a port of `briefingBeats` from `packages/app/src/ui/loading.ts`,
with `BEAT_SENTENCES = 2` and `BEAT_CHARS = 240`, read from the source):

| mission | chars | beats | splitter output equals the intended beats | every beat ≤ 240 chars and ≤ 2 sentences | inside 385–1,225 |
|---|---|---|---|---|---|
| I — The Causeways | 1,016 | 6 | yes | yes (longest 227) | yes |
| II — Dead Ground | 1,039 | 6 | yes | yes (longest 239) | yes |
| III — One Road | 1,042 | 6 | yes | yes (longest 216) | yes |

The same script also checked the following:
- Every line quoted in a table is ≤ 240 characters: every `say`, `say_on_fail`, HELD, twist and ambient line.
  **77 lines; the longest is 184** (`burn_the_stock.say`). The six `debrief` lines are 111 to 145. The `dispatch` is
  232.
- **The 7 trigger labels are ≤ 48 characters with no full stop.** The longest is 41 (`Riders pull back along the
  south causeway`). Every non-`remove` trigger has one: I 2, II 2 + T-B1's spawn, III 2. T-C4 is a wave, and a wave
  takes no label.
- No player string contains *withdrawn* or *ferry*.
- No label, objective text, mission name or catalogue string contains a word on `player-wording.test.ts`'s deny list.
- EQ II's beat-4 fallback (§3.3) is 2 sentences and 138 characters.

**Every Idit line was re-read for an imperative**, and none carries one. Her one near-order, *"I want it identified"*,
was rewritten as a price in beat 3 of EQ II before this sheet was written.

**Read aloud in beat order**, each briefing runs: Idit's picture, Shai's plan, Idit's human cost or price, Shai's
decision, Idit's worth-of-knowing, and Shai's cost.

**What `mission-author` applies from here**, in order:
1. G2 (the `town` enum value and the `world.json` entry, together) and G1;
2. the two map `name`s and the three `freePlay.map.*` strings;
3. the three mission files, each with its `briefing` string printed whole above, its objective texts, `say` and
   `say_on_fail` lines, `debrief`, and, on EQ I only, the `dispatch`;
4. then `pnpm validate:data` and `pnpm test` (`loading.test.ts`).

Before any of it, `level-scripter` settles G-P (the reed cell's placement).

---

## 13. Questions for the lead (recommendation first)

1. **Q1, the three titles.** **Recommend *The Causeways*, *Dead Ground*, *One Road*.**
   - The MDD's working names were *Reed Spring*, *Rain Hill* and *The Long Causeway*.
   - *Reed Spring* and *Rain Hill* translate the toponyms, which tells a player which real language the names came
     from.
   - *Rainhill* and *Long Causeway* are real places in England.
   - If *Dead Ground* reads too grim, the alternative is *The Hill Farm*.
2. **Q2, `jebel_matar`'s display name.** **Recommend *Ein Qasab — The Hill Farm*, and keep `jebel_matar` as the id
   only.**
   - *Jebel Matar* as a display name coins a toponym with no `world.json` entry (`storyline.md` §2.4(1)).
   - It has not been web-screened. *Mountain + rain* is a common-noun compound, so a real place cannot be ruled out.
   - If the lead wants the toponym, it needs the `names.md` §3 web pass and a ruling that a map may name a place the
     board does not.
3. **Q3, Hallaq's voice.** **Recommend he does not speak at Ein Qasab** (§5).
   - An `enemy` line paints his portrait.
   - The board lets a player arrive here after his death at the gate.
   - His one line in the act stays on WH V. The HELD line in §5 is there if the lead overrules.
4. **Q4, a `dispatch` on EQ I.** **Recommend yes** (§2.2): the town opens onto a changed road, the Qarn Hadid
   precedent. If the lead wants dispatches kept to act openings, cut it, and beat 1 carries the rain alone.
5. **Q5, the order of play is not enforced.** **Recommend accepting it** (§0.3, §10 G-S).
   - Every line here was written to read true in either order.
   - The war's four closing lines follow whichever of WH V and EQ III is cleared last, and they read true after
     either.
   - Enforcing the order would need a mission-level gate on WH IV, which nothing in the schema offers.
6. **Q6, the twists.** **Recommend adopting T-A1, T-A2 (after the G-P placement fix), T-C3, and T-B1 in its edge
   form; holding T-C4; not adopting T-A3, T-B2, T-B3 or T-C1; and making T-C2 the town's one engine follow-up.** The
   classification is `level-scripter`'s; this is the narrative recommendation, with reasons in §8.
7. **Q7, the GDD.** **Recommend applying §11.1 to §11.3 in the same commit that lands G2**, with the version line at
   1.2.4, and no earlier. A town in the GDD that the tree cannot load is a document telling a reader something the
   game will deny.
