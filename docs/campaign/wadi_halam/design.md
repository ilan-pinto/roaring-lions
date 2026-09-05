# Mission Design Document — Act III · Naharin · **Wadi Halam**

**Date:** 2026-09-06 · **Status:** proposal. Nothing here is canon until the lead
signs §10.
**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`,
censused and *measured* this session. Every content claim cites a path; every
duration, ROE figure, roster count and objective verdict below was produced by
driving the real `Sim` and `MissionRuntime` today (method and full command list in
the Appendix). **No file under `data/`, `tools/` or `packages/` was written by this
document.**
**Read first:** `docs/campaign/README.md` (the contract), `docs/campaign/storyline.md`
(the war — §0 D15, §1, §2.3 FERRY, §3.3, §5, §7), `docs/campaign/beit_sahwan/design.md`
(Act I), `docs/campaign/tel_marum/design.md` (Act II).
**Downstream:** `narrative-designer` (§5 story hooks, §6), `level-scripter`
(§5 twists, §9), `mission-author` (all of it), `playtest` (§7).

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| **D15** | Act III started (2026-09-06): Naharin, Wadi Halam's five shipped missions re-integrated around Jubran Hallaq; Shai Lt Col then Colonel; the ending still open, so this design carries both | lead | this document |
| D4 | One villain per front, atrocity at the opening, killed or captured at the end | lead | **Jubran Hallaq**, Idit's file **FERRY**, *the smuggler*. Atrocity **told** at I and **shown** at IV. End: `eliminate_hvt(wh_gate_rpg)` at V |
| D1/D2 | Shai Hammai, Idit Zohar, the two voices | lead | Shai is a **Lieutenant Colonel** for all five missions. **Colonel at the campaign's end, not inside the town** |
| D9 | Static continuity, authored text only | 2026-08-21 spec | no line in Act III branches on the ledger |
| D10 | War order proximity → standoff → source | GDD §2 | Naharin is last. `world.json` already gates it on `umm_zeitoun_4_clearance` — **verified this session, C1 and C2 are done** |
| O9 | The ending | open | §6 specifies both, fully, and recommends one the lead can overrule |
| — | The 2026-09-03 engine slice landed | `docs/superpowers/specs/2026-09-03-narrative-layer-engine-design.md`; verified in the tree this session | `say` on triggers and objectives, `say_on_fail`, `dispatch`/`aftermath`/`debrief`, `remove`, `group` on `starting_force`, `data/campaign/commander.json`. §5's twists are re-classified against the vocabulary as it actually stands |

**The register.** Hallaq's atrocity is what he does to the people of his own
corridor when they stop carrying for him. It is **told** in I's `dispatch` — one
sentence, no method, no scene — and **shown** in IV as four families in four
houses and a deadline. Act I's ceiling binds: name what happened, never depict it
(`beit_sahwan/design.md` §10 O-D).

---

## 1. Premise and plot options

### The premise

Naharin is a green river basin: poplar galleries along the water, terraced pasture,
one village, one walled depot. It is not a front line. It is a **road** — the
corridor that carried the charges under Beit Sahwan and the rockets over Tel Marum,
and it runs through somebody's pasture, somebody's ford and somebody's village.

Act III's question is *can you stop?* The mechanics ask it three ways and all three
already ship:

- **The player can level anything.** The map holds **77 ROE points of destructible
  building** — 4 houses (−6 each) + 4 shanties (−2) + 3 warehouses (−3) + 2
  concrete (−3) + 1 mosque (−30). Measured from the parsed map this session.
- **The mission's own orders cost restraint.** `wadi_halam_5_depot`'s `raze_depot`
  primary requires all **seven** depot structures down, and those seven are worth
  exactly **−19**. Measured: a clean, sanctioned, optimal demolition ends on
  **ROE 81**. **Break the Depot cannot be played above 81.** The last mission of
  the war bills the player nineteen points for obeying it.
- **The last mission hands him a D9.** `dozer_d9` has no weapons and a two-tile
  automatic demolition search. Anything with `roe_penalty < 20` that it merely
  halts beside comes down with nobody ordering it — every house in the village.
  The mosque is exempt at 30 (`PROTECTED_ROE = 20`, `packages/sim/src/structures.ts:135`),
  so the only way it falls is a deliberate `demolish` order.

Three plots follow. They differ in **what the player can lose**, **whether the
villain's cruelty reaches the player as a mechanic**, and **how much new content
Act III costs**.

---

### Option A — *"The road, re-integrated"* — text and three ledger lines

The five shipped missions, unchanged mechanically. What is added is the story layer
the engine slice made possible: `dispatch` on I, `aftermath` and `debrief` on V,
`say` lines on the shipped triggers and objectives, the eight trigger ids rewritten
as prose (the player reads them verbatim), Hallaq named in three objective labels,
and the `requires`/`produces` chain corrected.

- **Phase ladder:** 2 → 3 → 4 → 5 → 5. Unchanged, and it is the only town in the
  game with a build-up.
- **What the player decides, act-wide:** unchanged from what ships — in V, which
  road the D9 takes.
- **How the villain ends:** `eliminate_hvt(wh_gate_rpg)`, re-labelled to name him.
- **Cost:** ~12 strings and 3 ledger lines. No new placement, no map edit, no
  measurement to redo. Ships in a day.
- **What it cannot survive being called.** **Four of the five missions cannot be
  lost.** Measured this session with a no-orders control on each: I, II, III and IV
  all return **ONGOING at the 20-minute cap**; only V returns DEFEAT. A passive
  player is **stuck, not lost**, which is the state `docs/campaign/README.md` rule
  4 exists to refuse. Worse than Tel Marum's version of the same defect: **mission
  I's `picture` primary — four `locate` identifications — COMPLETES in the passive
  run.** The recon completes because the enemy attacks you. Half of the opening
  mission's primaries are satisfied by doing nothing at all.

### Option B — *"The road, plus T12: the cache guard is one of ours"*

Option A plus the storyline's strongest Act III twist made real at IV.
`wh_hvt_cache` stops being an `rpg_team` and becomes **a KDF soldier taken at First
Light, left holding Hallaq's cache.** The primary that reads *"Kill or capture
whoever is guarding the cache"* becomes the campaign's cruellest sentence.

- **What it needs to be what it wants to be:** a **friendly-tagged HVT** — a
  placement that spawns on side 0 or a third state, is targetable by the player,
  and whose death is scored as a catastrophe. That is **G6, engine work**, and it
  also wants `capture` to require its target alive (also G6).
- **The fallback, and it is Act I's own** — the `civilians` representation the
  hostages used at Beit Sahwan IV. **Measured working end to end this session:**
  swap the `wh_hvt_cache` `rpg_team` for an ordinary `militia_cell` garrison, add
  a `civilians` group of **one** at `[33.5,30.5]` carrying the tag, replace
  `kill_cache_guard` with `capture(cache_house, 15)` on a new additive zone
  `cache_house [30,27,4,4]`, and raise `evac_families` to `count: 4` and
  `primary: true`. Result: the shipped IV plan **VICTORY in 6.3 min, ROE 77,
  roster out 7**; the no-orders control **DEFEAT in 5.0 min**.
- **What the fallback loses, stated plainly.** A civilian is untargetable by either
  side and can only be hurt by ordnance, so the player **cannot shoot him** — the
  cruelty becomes "the autocannon that clears the house kills him", which is Beit
  Sahwan III's lesson repeated rather than a new one. And **`evacuate_before`
  cannot name a group** (recorded gap), so the objective can only require a
  *count*: the mission cannot say *he* specifically must come out. The tag is
  carried and read by nothing.
- **Cost:** 1 additive map zone, 1 placement swap, 1 civilian group, 2 objective
  edits — plus G6 to make it the thing it is for.

### Option C — *"The road, made losable"* — **RECOMMENDED**

Option A plus **one failable primary in each of I–IV**, so that a passive player is
lost rather than stuck, exactly as Umm Zeitoun is (`pnpm playtest`: all four Umm
Zeitoun controls return DEFEAT). Only `raze`, `collapse` and `evacuate_before` can
reach `failed`, and **`collapse` is unavailable for the whole town** —
`wadi_halam_basin` declares no `tunnels` key at all — so the two shapes are `raze`
and `evacuate_before`, and each one is the mission's own object.

| # | the failable primary | why it fits the fiction |
|---|---|---|
| **I** | `evacuate_before(refuge, 3, 300)` — four carriers at the south ford | Hallaq's atrocity is told at I. The carriers are the *evidence* of it, alive and in the way. Recon becomes "see them first, and get these people off his road" |
| **II** | `raze(pasture, 300)` — his forward store at the pump house | The first thing the war orders you to destroy is a shed in a field. Act III's question, stated on the second screen. This is also **T10** given an object |
| **III** | `evacuate_before(refuge, 3, 300)` — the herders on the cattle track | You chose to raid; the track is where people live. And the herd sits beside `wh_hide_south`, the town's one carry-over tag, so **a thorough recon in I is what makes this cheap** |
| **IV** | `evac_families` → `"primary": true` | **One word.** The objective, its target, its count, its deadline and its civilians all ship today |
| **V** | unchanged | `raze(depot, 300)` already fails and already loses |

- **Phase ladder:** unchanged, 2 → 3 → 4 → 5 → 5.
- **What the player decides, act-wide:** *what the road costs the people on it.*
  In I whether the screen splits to shepherd; in II whether the store is worth two
  ROE points and the time; in III whether to press south to the herd past a hide
  he was only asked to look at; in IV the order of four garrisoned houses against
  a 300-second evacuation clock; in V which road the D9 takes.
- **How the villain ends:** `eliminate_hvt(wh_gate_rpg)` at V. **No new placement.**
- **Cost:** 1 new zone (`north_hide` is NOT needed under the final shape — see
  §5.3), 2 `civilians` blocks, 1 raised structure, 1 garrison placement, 4
  objective rows, 1 word, ~12 strings, 3 ledger lines. **No new art, no new map,
  no engine work.**
- **Measured, the whole ladder, chained:** see §4 and §7. Five plans VICTORY in
  **5.2–6.1 min**; five no-orders controls **DEFEAT at 5.0 min**; ROE
  100 / 98 / 100 / 77 / 81; roster out 4 / 8 / 6 / 7 / 4 — **identical to the
  shipped chain in every mission**. Only I's plan needs amending, by one leg.

### Recommendation

**Option C.** Three reasons, in order of weight:

1. **A is the only option in which Act III is not a set of missions.** The
   pipeline's own contract says a mission a passive player wins is not a mission,
   and four of five here are one step worse than that: they cannot be won *or*
   lost. Tel Marum has the same defect and it was deferred as O-C because
   retrofitting shipped, measured content is a decision. **Here it is not a
   retrofit — it is the act's own question.** Act III asks *can you stop?* and a
   mission whose only failure mode is a wipe cannot ask it.
2. **C costs the shipped plans almost nothing, and that is measured, not
   estimated.** II, III and IV win on their shipped plans unamended. Only I needs
   a change, and it is one order: send the jeep to the carriers before it takes
   station. Cost: **+0.6 min, 0 survivors**.
3. **C is the only option that makes the town's carry-over pay.** `wh_hide_south`
   is the **one and only tag shared between any two Wadi Halam missions** (I → III).
   Today the shipped I plan does not even mark it, and marking it is worth
   **6 seconds**. Under C, with the herd on the cattle track beside the hide,
   marking it in I is worth **42 seconds** in III (5.9 min → 5.2 min), because a
   pre-marked ambusher forfeits its ambush and the shepherd's run past the hide
   stops being a fight.

### Killing my own favourite

**If the lead takes A, Act III survives and so does the campaign.** Hallaq gets a
real ending — the shipped `wh_gate_rpg` text already reads as him — the war order
holds, `world.json` needs nothing, and the ending in §6 is untouched. What is lost
is the second score having anything to bite on for four missions out of five, and
the honest ability to say Act III is finished. **A is also the right call if the
schedule is the binding constraint**, and it should be taken without apology; it
just must not be described as done.

**And B should not be taken instead of C.** B is the better *scene* and C is the
better *act*. B's twist in its fallback form is Beit Sahwan IV's mechanic played a
second time with a worse handle on it; in its real form it is engine work nobody
has scheduled. The honest sequence is **C now, B next, when G6 lands** — and B
then slots into IV without touching anything C did, because C's change to IV is one
word and B's change to IV subsumes it.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | III of III. Naharin · Rif Cells · Wadi Halam. *Source*, the last of GDD §2's three |
| **Shai's rank on entry** | **Lieutenant Colonel**, 4 stars. Promoted at the Act II boundary for "the batteries stopped firing on Kedem's north" |
| **Shai's rank on exit** | **Colonel**, 5 stars, at the **campaign's end** — after `wadi_halam_5_depot`, never inside the town |
| **`commander.json` is already correct, and there is a catch** | `data/campaign/commander.json` reads `{"rank":"Lieutenant Colonel","stars":4,"until_mission":"wadi_halam_5_depot"}` then `{"rank":"Colonel","stars":5}` with no `until_mission`. `until_mission` is **inclusive** (`commanderForMission`, `packages/app/src/campaign.ts`), so Shai is a Lt Col for all five missions and Colonel is the default afterwards. **But there is no mission afterwards**, so *the Colonel entry is never displayed anywhere in the game.* The promotion exists only in whatever `aftermath` says. §6 turns on this |
| **Idit's intel thread** | This is the act where she **chooses which questions are worth a life** (`storyline.md` §2.2). Mechanically that shows up as an *absence*: Act III declares **two `locate` objectives in the whole act** — I's `picture` (a bare `count: 4`, so it does not even name what it wants seen) and III's `mark_hides`, which is a secondary. Tel Marum I alone declares four, every one of them named. She stops asking. §5 names the two places a `locate` is deliberately NOT asked and why |
| **The villain's atrocity** | **Told** at `wadi_halam_1_fords`, in a `dispatch` the mission does not have: what he does to people of the corridor who stop carrying for him. One sentence, off-map, no method. **Shown** at `wadi_halam_4_village` — four families in four houses, a protected block, a 300-second deadline |
| **The villain's presence, mission by mission** | see §2.1 |
| **The villain's end** | `wadi_halam_5_depot`, `eliminate_hvt(wh_gate_rpg)`, **no new placement**. The shipped label is *"Kill or capture whoever is holding the gate"* — a voice naming a person without naming him. FERRY is the smuggler who will not leave his own gate |
| **Ledger in, from Sur** | `roster.surviving_units` (Umm Zeitoun IV's survivors — measured this session: **roster out 11**), `roe.mission_ratings` (the twelve Act I + II missions, measured 75 / 100 / 100 / 94 / 98 / 100 / 100 / 100 / 100 / 98 / 79 / 92), `campaign.completed_missions`, `intel.marked_positions`, `civ.settlements_evacuated`. **The intel carried in names nothing in Naharin** — not one tag produced by any Marj or Sur mission appears on a Wadi Halam placement. Act III's recon is self-contained, and that is fine so long as nobody claims otherwise |
| **Ledger out** | `R M C` from all five; `I` from I and III; `E` from IV — and under Option C also from I and III. This is the campaign's terminal ledger: **nothing reads it.** `wadi_halam_5_depot` produces `R M C` for a mission that does not exist |
| **`world.json`** | **Nothing to change.** Naharin's `unlock.after_mission` is `umm_zeitoun_4_clearance` and Sur's is `beit_sahwan_4_subterranean` — the storyline's C1 and C2 are already applied, verified this session. **C3 (`planned: true`) is still open** and it is what makes the *end* of the war honest: see §6 |
| **The campaign ROE, and the ending is written on it** | Measured over all seventeen shipped missions on their optimal plans: **mean 94**. Under Option C, 94 (II drops 2). Every KDF unlock tops out at 65, so a competent campaign clears all of them and `starting_force`'s unlock-blindness never has to be relied on |

### 2.1 Jubran Hallaq across Act III, in one table

| mission | what FERRY *does* | how the player learns it |
|---|---|---|
| **I — The Fords** | Nothing is seen of him. The `dispatch` names the corridor and what happens to people on it who stop carrying. His galleries and bank patrols are the road's guards | told (`dispatch`), and — under C — four carriers alive at the south ford who are the sentence made physical |
| **II — Grazing Ground** | The pasture is a supply laager and the pump house is his forward store. His raiders come from **three markers on three clocks** and break off at 60% — mobility as armour, exactly the Rif design (`2026-08-10-enemy-technical-design.md`) | **T10**: what you are holding is what he wants back, and he says so. Under C the store is razed, so the player learns it by burning it |
| **III — The Cattle Track** | **`wh_hvt_amir` is his lieutenant** — a `militia_cell` riding a technical at the north hide, group `amir`, `casualties_pct(40) → withdraw_to rif_east`. The shipped briefing already calls catching him *"a mobility problem, not a firepower one"* | the man runs. **T11**: he is worth more talking |
| **IV — Wadi Halam** | **His quartermaster** (`wh_hvt_cache`) holds the cache in the south-east house; three cells hold the other corners; two technicals at the south hide run for the village on `first_contact`. **The village is inhabited and it is his** | the atrocity **shown**: four families, four houses, a mosque under protection, a 300-second road |
| **V — Break the Depot** | He is at the gate of his own depot with an RPG team, three gun trucks inside the wire, motorcycles staged east, and four waves out of the south and the east. **He does not leave** | `eliminate_hvt(wh_gate_rpg)` — and the mission's own order costs the player 19 points of restraint before he fires a shot |

---

## 3. Map overview

**`data/maps/wadi_halam_basin.json` — PRESENT, and Act III needs nothing new on it
beyond zones.** 48×48, `"terrain": "green"`, **no `elevation` grid** (flat), **no
`tunnels` key** (so `collapse` is unavailable for the whole town). Verified this
session by parsing the shipped file.

Symbol census, counted from the rows this session: `.` 1813 · `o` 228 (poplar
gallery, cover 1) · `1` 67 (hedgerow bunds, cover 1) · `h` 45 (house) · `=` 45
(compound wall) · `r` 43 (road) · `n` 20 (dry-stone terrace, cover 2) · `w` 18
(warehouse) · `m` 9 (mosque) · `#` 8 (concrete) · `s` 8 (shanty). No `2`, `3`, `^`,
`b` or `d`.

**West to east**, because Naharin lies east of Kedem: exposed west pasture (x0–6),
the wadi's poplar gallery with two fords (x7–12), terraced cultivation (x13–23),
the village (x25–33), the walled depot (x35–41), Rif hinterland (x42–47).

### 3.1 Markers and zones, as shipped — every one resolves

| marker | at | used by |
|---|---|---|
| `kdf_crossing` | [3,24] | player start reference |
| `ford_north` | [10,15] | I wave `to` |
| `ford_south` | [10,32] | I wave `to` |
| `pump_house` | [17,20] | III wave `to` |
| `hide_north` | [22,9] | III `amir` placement marker |
| `hide_south` | [22,38] | IV reserve placement marker |
| `village_center` | [29,26] | IV `commit` destination |
| `depot_gate` | [34,24] | V garrison marker and every V wave `to` |
| `rif_north` | [44,9] | II wave `from` |
| `rif_east` | [44,24] | I, II, III, V wave `from`; II and III `withdraw_to` |
| `rif_south` | [44,39] | I, II, III, V wave `from` |
| `civ_refuge` | [22,36] | IV `civilians.refuge` |

| zone | rect (x,y,w,h) | used by |
|---|---|---|
| `ford_watch` | [7,12,6,24] | I `hold_for` + `zone_entered`, II `capture` |
| `pasture` | [13,14,11,20] | II `hold_for`, III `hold_for` |
| `village` | [25,15,9,18] | IV `capture` |
| `mosque_block` | [28,22,4,4] | IV `roe.flagged_zones` |
| `depot` | [35,17,7,14] | V `raze`, V `hold_for` |
| `refuge` | [19,34,8,6] | IV `evacuate_before` |
| `east_road` | [42,22,6,4] | **nothing** |

> **`east_road` is authored and used by no mission.** The green-basin spec assigned
> it to V's `zone_entered` trigger; the shipped V uses `first_contact` instead. It
> is a claim the map makes and nothing honours — and it is the natural condition
> for **T13** (§5.5).

### 3.2 What destroying the map costs — measured

| where | structures | ROE if all levelled | hp |
|---|---|---|---|
| the village | 4 house, 2 shanty | **−28** | 12,180 |
| the mosque (inside `village` and `mosque_block`) | 1 mosque | **−30** | 8,100 |
| the depot | 3 warehouse, 2 concrete, 2 shanty | **−19** | 12,200 |
| the depot wall ring | 41 `wall` (per-tile, low-profile) | 0 | 8,200 |
| the east track wall | 4 `wall` | 0 | 800 |

The wall ring at x=34 / x=42 / y=16 / y=31 sits **entirely outside** the `depot`
rect, which is what keeps it out of V's raze set.

### 3.3 Chokepoints, dead ground, protected structures

- **The two fords at y=15 and y=32 are the only vehicle crossings** of the poplar
  gallery. There is no third. That is the whole of mission I's geometry.
- **The village is the short road and the southern track at y=34 is the long one.**
  Measured this session: taking the V column straight through `village_center`
  finishes **0.3 min FASTER** and costs **8 ROE points** (one house, one shanty)
  against the southern route. Parking the D9 in the village for a further 120
  seconds costs **nothing more** — the auto-search reaches two tiles and the houses
  are spread. So the bait is real, cheap, and **a time saving**, which is a more
  interesting shape than the green-basin spec predicted (it estimated ~55; the
  measurement is **73**).
- **The mosque is the only protected structure on the map** (`roe_penalty` 30 ≥
  `PROTECTED_ROE` 20). No demolisher will touch it on its own initiative; only an
  explicit order can. Measured: ordering the D9 onto it in V ends the mission at
  **ROE 43** — a **VICTORY**, three points above `fail_below: 40`. One more house
  (−6) takes it to 37 and loses. **The cliff is one house wide**, and §10 O-D asks
  the lead whether that is the intended width.
- **`wadi_halam_5_depot` declares no `flagged_zones`.** Its briefing says *"The
  mosque is not a target at any price"* and its ROE block does not flag the mosque
  block, so firing *near* it in V costs nothing; only levelling it does. IV flags
  it and V does not. §5.5 proposes the one-line fix.

### 3.4 Map edits this design asks for — all additive

The character grid is shared by five missions and **is not touched**. A zone
nothing names is inert.

| edit | rect | for | risk |
|---|---|---|---|
| zone `cache_house` | `[30,27,4,4]` | Option B's `capture` of the quartermaster's house | none — no shipped mission names it |
| zone `north_hide` | `[20,6,5,6]` | **only** if the lead prefers the rejected III-raze variant (§5.3) | none |
| marker `wh_ferry_landing` | — | **not asked for.** Recorded so nobody adds one: I's evacuation uses the shipped `civ_refuge` and `refuge`, and `civ_refuge [22,36]` is inside `refuge [19,34,8,6]`, which `MissionRuntime.start()` requires or it throws | — |

---

## 4. Mission ladder

Phases ascend within the town. All `target_minutes` are as shipped and all are 5–7.
**Bold** marks what Option C adds. Every objective type is one of the nine the
runtime runs (`SUPPORTED`, `packages/sim/src/mission.ts:312`).

| # | id · name | phase | target | primaries (type · target) | secondaries | ledger requires / produces | econ |
|---|---|---|---|---|---|---|---|
| **I** | `wadi_halam_1_fords` · *The Fords* | recon | 6 | `locate` ×4 · `picture` · `hold_for` · `ford_watch` 240 · **`evacuate_before` · `refuge` 3 / 300** | `survive_until` 200 | **R** / **R M C I** + **E** | n |
| **II** | `wadi_halam_2_laager` · *Grazing Ground* | foothold | 7 | `hold_for` · `pasture` 300 · **`raze` · `pasture` 300** | `capture` · `ford_watch` 15 | **R** + **I** / **R M C** + **I** | **y** — 400 + 120/min |
| **III** | `wadi_halam_3_counterraid` · *The Cattle Track* | buildup | 6 | `eliminate_hvt` · `wh_hvt_amir` · `hold_for` · `pasture` 300 · **`evacuate_before` · `refuge` 3 / 300** | `locate` · `wh_hide_south` | **R I** / **R M C I** + **E** | n |
| **IV** | `wadi_halam_4_village` · *Wadi Halam* | clearance | 7 | `capture` · `village` 20 · `eliminate_hvt` · `wh_hvt_cache` · **`evacuate_before` · `refuge` 3 / 300 (primary)** | — | **R** + **I** / **R M C E** | n |
| **V** | `wadi_halam_5_depot` · *Break the Depot* | clearance | 7 | `raze` · `depot` 300 · `eliminate_hvt` · `wh_gate_rpg` · `hold_for` · `depot` 240 | `survive_until` 300 | **R** / **R M C** | **y** — 400 + 80/min |

**Ledger keys, verbatim:** **R** `roster.surviving_units` · **M** `roe.mission_ratings`
· **C** `campaign.completed_missions` · **I** `intel.marked_positions` · **E**
`civ.settlements_evacuated`. All five exist.

### 4.1 The measured ladder — Option C, chained, this session

```
I   fords            VICTORY 5.4 min  ROE 100  roster out 4   picture=c take_ford=c screen_out=c get_the_carriers_out=c
II  laager           VICTORY 5.7 min  ROE  98  roster out 8   burn_store=c hold_pasture=c keep_ford=c
III counterraid      VICTORY 5.2 min  ROE 100  roster out 6   kill_amir=c hold_bunds=c mark_hides=c get_the_herders_out=c
IV  village          VICTORY 6.0 min  ROE  77  roster out 7   take_village=c kill_cache_guard=c evac_families=c
V   depot            VICTORY 6.1 min  ROE  81  roster out 4   raze_depot=c kill_gate_rpg=c hold_depot=c no_bleed=c

I   (no orders)      DEFEAT  5.0 min  get_the_carriers_out=f
II  (no orders)      DEFEAT  5.0 min  burn_store=f
III (no orders)      DEFEAT  5.0 min  get_the_herders_out=f
IV  (no orders)      DEFEAT  5.0 min  evac_families=f
V   (no orders)      DEFEAT  5.0 min  raze_depot=f
```

Against the shipped ladder (`pnpm -s playtest`, this session): I 4.8/100/4, II
5.6/100/8, III 5.6/100/6, IV 6.1/77/7, V 6.1/81/4, and V's control DEFEAT 5.0.
**Every roster count is identical.** The only durations that move are I (+0.6, the
shepherd leg) and III (−0.4, because the thorough recon pays).

**Duration ratios against `target_minutes`:** I 0.90, II 0.81, III 0.87, IV 0.86,
V 0.87. Four of the five carry an endure-clock (`hold_for` or `survive_until`), so
four of the five ratios are informative under GH-84's rule — Wadi Halam is the
best-behaved town in the game on this measure, and that is because Rif doctrine
*comes to you*: the enemy sets the clock, so the plan cannot skip it.

---

## 5. Per mission

Each entry gives: player starting state · enemy stance · the decision · re-brief
verdict · `say` candidates (all live) · trigger-id rewrites (the player reads them
verbatim) · objective-label changes · twists re-classified · the passive-control
verdict · story hooks.

---

### 5.1 I — `wadi_halam_1_fords` · *The Fords* · **recon** · 6 min

**Player starting state.** `recon_drone` ×1 [3,22] · `jeep_shoded` ×1 [2,24] ·
`apc_eitan` ×1 [1,26] · `inf_squad` ×2 [2,22] · `at_team` ×1 [1,20]. No
`from_ledger` — I is the region's entry point and must run from an empty ledger.
`player_start [3,24]`. **No economy**, correctly: a recon is not about spending.

**Enemy stance, in words.** Two `moto_rpg` in `ambush(4)` in the poplar gallery,
one at each ford approach (`wh_gallery_north` [9.5,13.5], `wh_gallery_south`
[9.5,31.5]) — the crossing is mined with motorcycles. Two `technical` on
north–south `patrol` legs along the far bank at x=20.5, group `bank`, both tagged
`wh_bank_patrol`. A `militia_cell` on the bund at [18.5,20.5] (`wh_bund_cell`) and
a second in `ambush(3)` at the south hide [21.5,35.5] (`wh_hide_south`). One
trigger: `zone_entered(ford_watch)` → `commit` group `bank` to `ford_north`. Three
waves out of the south and east at 90 s, 210 s and 225 s, all `moto_rpg` and
`technical`, all aimed at the fords. **Cadence: nothing comes for a minute and a
half, then something comes every fifteen seconds for the last two.**

**The player's decision.** Where the screen stands while the picture is built —
and, under C, whether it splits. The four identifications and the four-minute ford
hold both want the whole force at the crossing; the carriers are eight tiles the
wrong way.

**Re-brief? Yes — new fields only.** The shipped `briefing` is good and its last
line, *"Do not chase what runs,"* is the Rif characterised in four words. **Do not
touch it.** What it needs is the act's opening `dispatch`.

**`dispatch` (the act's opening, ≤240 chars).** Hallaq's atrocity, told: what
happens to people of the corridor who stop carrying for him. Off-map, no method,
no scene. This is the only place in Act III where the atrocity is *stated*.

**`say` candidates (all live today).**

| where | speaker | the beat |
|---|---|---|
| `picture.say` | **idit** | on the fourth identification: these are dispersal sites, not positions — the difference between a garrison and a road |
| `take_ford.say` | **net** | on the hold completing: the column is across |
| `get_the_carriers_out.say` | **shai** | on the evacuation completing — the restrained half of his voice, said once |
| `get_the_carriers_out.say_on_fail` | **shai** | the mission's loss line. This is the one place in Act III where `say_on_fail` earns its keep |
| trigger `bank_reacts` | **idit** | the patrol turning for the ford is the first time the player sees Rif mobility used as a decision |

**Trigger id rewrite.** `bank_reacts` reads to the player as
`enemy reacts (bank_reacts)`. → **`the bank patrol turns for the ford`**.

**Objective labels.** `picture` *"Identify four dispersal sites"* — keep; it is
already Idit's word, not a soldier's. `take_ford` — may name the crossing as his.

**Twist — T9 "The riders are carrying."** *One dispersing technical carries
civilians, not fighters; killing it is the mission's ROE cliff.*
**Classification: ENGINE (G6-adjacent), and the storyline's "expressible today
only as passengers" is wrong.** Measured this session: `passengers` is live and
schema-legal, and `civilians`' role is `support`, which is in `FOOT_ROLES`, so
`validate_data.mjs` would accept it — but `embarkPassengers(id, p.passengers,
side)` gives passengers **the carrier's side**. A civilian riding an enemy
technical spawns on side 1, never enters `civIds`, and is therefore not a civilian
for ROE, for `evacuate_before`, or for the danger-close rules. **Killing them would
cost nothing.** The smallest proposal is a `side` override on a nested passenger
placement, or a `civilians.groups[].mounted_in`. Recorded as **G16**.

**Passive-control verdict: SOLVED by C, and the underlying fact is the worst in the
town.** Measured, shipped mission, no orders: **ONGOING at 20.0 min**, and
`picture=c` **and** `screen_out=c`. Only `take_ford` keeps a passive player from
victory, and he completes the recon primary **because the enemy attacks him** —
three waves attack-move into his screen at x≈10 and identify themselves. With
`evacuate_before(refuge, 3, 300)` added: **DEFEAT at 5.0 min**, `get_the_carriers_out=f`.

**What it does to the shipped plan.** The shipped plan **fails** the new primary
(DEFEAT 5.0) — measured. The amendment is one order: send the jeep to `[15,31]` at
t=0 instead of `[9,20]`, then `[17,34]`, then back to the ford watch at t=120.
A player unit within 4 tiles (`SHEPHERD_RADIUS_SQ`) starts a civilian walking to
the refuge on its own, so one pass covers both groups. Result: **VICTORY 5.4 min,
ROE 100, roster out 4** — the same four survivors the shipped plan produces.
The amended plan also flies the drone on to `[21,35]`, which marks
**`wh_hide_south`**; §5.3 is where that is paid back.

**Story hooks for `narrative-designer`.** Idit's first Naharin picture, and the
first mission of the war where what she is looking for is *a road* rather than a
weapon or a pair of eyes. Shai's line about not chasing is already written and is
the best statement of Rif doctrine in the tree.

---

### 5.2 II — `wadi_halam_2_laager` · *Grazing Ground* · **foothold** · 7 min

**Player starting state.** `apc_eitan` ×1, `ifv_namer` ×1, `inf_squad` ×2,
`at_team` ×1 — **all `from_ledger: true`**, so I's four survivors price this
mission. `player_start [3,24]`. **Economy: `logistics_start` 400,
`logistics_rate_per_min` 120** — GDD §3's foothold anchor exactly. **What the
player should spend it on:** `inf_squad` (280) to thicken the laager, because the
pasture hold is a body count and the waves come from three directions. The shipped
plan buys one every sixty seconds. Nothing else in the KDF roster is worth buying
here: armour costs more than the mission's whole income and arrives after the third
wave.

**Enemy stance.** One `gun_truck` on `hold_position` at [44.5,20.5]
(`wh_aa_east`), group `raiders` — an anti-air piece on a map where the player has
no aircraft, which reads as a threat and is one only to a drone. Everything else
arrives by trigger: four `spawn` waves at **60 s, 150 s, 240 s and 330 s** from
`rif_north`, `rif_south` and `rif_east`, all into group `raiders`, all on `patrol`
legs that run from their spawn to the pasture's east edge at [17.5,20.5]. One
withdrawal: `casualties_pct(60)` → `withdraw_to rif_east`. **Cadence: a wave every
ninety seconds from a different compass point, and at 60% losses they all break
off at once.** That is the Rif thesis — engage and disengage, mobility as armour.

**The player's decision.** Where the laager sits, and what the 120/min buys. The
pasture is 11×20 tiles and the hold needs a living unit inside it, uncontested
within 6 tiles, for 300 cumulative seconds. Under C, also: the store at the pump
house has to come down inside 300 seconds, which is the same clock as the hold.

**Re-brief? No.** *"The ground is terraced — bunds run across the pasture in bands,
real cover if you hold it, and the Rif know the ground as well as you do."* That is
correct, measured (cover 1, `COVER_HIT` 1 → .375) and in Shai's voice. Keep
verbatim. Under C it gains one clause about the store.

**`say` candidates.**

| where | speaker | the beat |
|---|---|---|
| `hold_pasture.say` | **net** | the corridor is open |
| `burn_store.say` | **idit** | **T10 delivered**: what was in the shed says the corridor runs both ways |
| trigger `picket_withdraws` | **idit** | they are not beaten, they are leaving — the line that stops the player reading a withdrawal as a win |

**Trigger id rewrites.** All five are debug identifiers on screen today:
`wave_1` → **`riders out of the north`** · `wave_2` → **`riders out of the south`**
· `wave_3` → **`technicals off the east track`** · `wave_4` → **`the last of the
motorcycles`** · `picket_withdraws` → **`the raiders break off east`**.

**Twist — T10 "The pump house is the cache."** *What you hold is what he wants
back, and he says so.* **Classification: expressible today as a `say` line
alone** (the storyline's own reading, and it is right). **Under Option C it stops
being a line and becomes an object**: a `shanty` raised at `[16,19]` by the
mission's `structures[]`, garrisoned by a `militia_cell`, inside the shipped
`pasture` zone, with `raze(pasture, 300)` as a primary. A garrisoned man cannot be
shot; the house has to come down — which is the same mechanic IV's four corner
cells use, rehearsed once, cheaply, three missions earlier.

**Passive-control verdict: SOLVED by C.** Measured, shipped mission, no orders:
**ONGOING at 20.0 min**. `hold_pasture` never starts because the force spawns at
x2–4 and the `pasture` zone begins at x13 — the failure is structural, not a
tuning miss. With `raze(pasture, 300)`: **DEFEAT at 5.0 min**, `burn_store=f`.

**What it does to the shipped plan.** **Nothing that needs amending.** Measured
with the shipped plan unaltered: **VICTORY 5.7 min, ROE 98, roster out 8** against
5.6 / 100 / 8 shipped. The two points are the shanty. One side effect worth
knowing: the secondary `keep_ford` goes from `active` to `complete`, because the
extra fight keeps a unit on the ford watch long enough for its 15-second capture.

**Ledger fix.** II should `require` and `produce` `intel.marked_positions`. The
green-basin spec (`2026-08-16`, "Ledger") says it should and the shipped file does
not — and that omission is **not cosmetic in the harness**: `tools/src/backtest/playtest.ts`
chains each mission on the *produced* ledger of the one before, so II silently
drops I's four tags and III has been measured with an empty marked list since it
shipped. The **app does not have this bug** (`main.ts` does `{...ledger, ...me.ledger}`),
so the harness and the game disagree. Declaring the key on II makes them agree.
`wh_aa_east` is the tag that satisfies `validate_data.mjs`'s "declares intel but
tags nothing" rule.

**Story hooks.** The only breathing-room-adjacent mission before the build-up, and
the one where the player's own supply line is the subject. Idit's absence is
deliberate: II produces no `locate` and asks no question. She is not spending a
life on a field.

---

### 5.3 III — `wadi_halam_3_counterraid` · *The Cattle Track* · **buildup** · 6 min

**Player starting state.** `apc_eitan`, `ifv_namer`, `inf_squad` ×2, `at_team` —
`from_ledger` — plus one fresh `jeep_shoded` at [8,22]. `player_start [9,21]` —
east of the wadi, because I and II took the crossing. **No economy**, which is the
one thing wrong with calling this a build-up: GDD §4 says build-up is "production
and force composition" and this mission produces nothing. §10 O-E asks the lead.

**Enemy stance.** `wh_hvt_amir` is a `militia_cell` **riding** a `technical` at
`hide_north` (a live `passengers` placement), group `amir`, `hold_position`. Two
placements tagged `wh_hide_south` in `ambush(3)` at [21.5,38.5] and [23.5,38.5] —
a `militia_cell` and an `rpg_team`. Two `moto_rpg` on short `patrol` legs at x=20.5
covering the track. Two waves at **90 s and 200 s** from `rif_east` and `rif_south`
into `pump_house`. One trigger: `casualties_pct(40)` → `withdraw_to rif_east` for
group `amir`.

**The player's decision.** Speed against mass. The commander runs at 40% enemy
casualties, so he has to be reached before the fight matures; the bunds have to be
held for 300 seconds against two counter-raid waves at the same time. Under C, a
third call: the herd on the cattle track sits beside the hide the player was only
asked to *look at*.

**Re-brief? Yes — text only.** The shipped briefing names "the local commander"
and never says **whose**. One clause: he is Hallaq's. Everything else — *"catching
the commander himself is a mobility problem, not a firepower one"* — is the best
sentence in the town and stays verbatim.

**`say` candidates.**

| where | speaker | the beat |
|---|---|---|
| `kill_amir.say` | **idit** | on the HVT dying or being taken: what a lieutenant knows, and what it is worth |
| `mark_hides.say` | **idit** | on the south hide being identified — and this is where she says what a mark is *for*, since it is the one mark in Act III that is spent |
| trigger `amir_runs` | **shai** | the line that turns a scripted withdrawal into a characterisation: he does not fight for ground |

**Trigger id rewrite — the one the brief asks about.** `amir_runs` displays as
`enemy reacts (amir_runs)`. It should read **`the commander runs for the east
track`** — a sentence about a person doing something, in the same register as the
briefing's "a mobility problem, not a firepower one", and naming the direction so
the player can act on it rather than merely be told.

**Objective labels.** `kill_amir` *"Kill or capture the local commander"* → should
name him as Hallaq's man. `mark_hides` *"Get eyes on the southern hide"* — keep.

**Twist — T11 "He is worth more talking."** *`wh_hvt_amir` routs rather than dies
and can be taken.* **Classification: expressible today, with one caveat that
matters.** `capture` is live and requires only 10–15 uninterrupted seconds of
uncontested player presence in a zone — **it does not require its target to be
alive** (verified in `mission.ts`: the `capture` branch reads `livingIn(z, 0)` and
`contestedIn(z)` and nothing else). So a `capture` zone at `rif_east` completes
whether the man is standing in it or dead in it, and the "taken alive" reading is
carried entirely by the label. That is G6 and it is the same hollow the storyline
records for SPADE. **Recommendation: keep the shipped `eliminate_hvt` and let the
label do the work** — it already says "Kill or capture" — rather than adding a
`capture` that cannot check the thing its name claims.

**Passive-control verdict: SOLVED by C.** Measured, shipped mission, no orders:
**ONGOING at 20.0 min**. `hold_bunds` never starts (start line at x7–9, `pasture`
begins at x13); `kill_amir` cannot fail. With `evacuate_before(refuge, 3, 300)`:
**DEFEAT at 5.0 min**, `get_the_herders_out=f`.

**Why the herd and not a raze, with the numbers.** Both were measured.

| variant | shipped plan | roster out | control |
|---|---|---|---|
| `raze(north_hide, 300)` on a raised garrisoned shanty at [23,10] (+1 additive zone) | VICTORY 5.6 min, ROE 98 | **2** (from 6) | DEFEAT 5.0 |
| **`evacuate_before(refuge, 3, 300)`, four herders at [20.5,32.5] and [23.5,33.5]** | VICTORY 5.9 min, ROE 100 | **6** | DEFEAT 5.0 |

The raze costs **four of six survivors** because the chase pair has to linger at
the north hide while the counter-raid comes in, and III's survivors price IV and V
through `from_ledger`. The evacuation costs none. **Take the herd.**

**And this is the mission where recon quality is finally worth something.** The
town's carry-over is exactly one tag — `wh_hide_south`, produced by I, consumed by
III — and today the shipped I plan does not mark it. Measured three ways:

| III, with the herd | duration | roster out |
|---|---|---|
| thin recon (nothing marked) | 5.9 min | 6 |
| **thorough recon (`wh_hide_south` marked in I)** | **5.2 min** | 6 |

**42 seconds**, because a pre-marked ambusher spawns identified and forfeits its
ambush (`spawnPlacement`'s `preMarked`), so the shepherd's run to the refuge stops
being a fight. Against the shipped mission the same carry-over is worth **6
seconds** (5.6 → 5.5), because nothing the player is asked to do goes near the
hide. **Option C is what turns the act's stated carry-over promise into a
measurable one**, and this is the single strongest argument for it.

**Where Idit does not ask.** III has the act's only *secondary* `locate` and IV and
V have none at all. That is her Act III arc made mechanical: by the village she has
stopped asking for pictures of things and started asking for people. `narrative-designer`
should say this once, in III's `mark_hides.say`, and never again.

**Story hooks.** The only build-up in the war, and it is a raid. The brigade's one
piece of breathing room is spent going forward.

---

### 5.4 IV — `wadi_halam_4_village` · *Wadi Halam* · **clearance** · 7 min

**Player starting state.** `apc_eitan`, `ifv_namer`, `at_team`, `jeep_shoded` from
the ledger; **three fresh `inf_squad`** at [9,21] — the mission buys its own
infantry because four garrisoned houses have to come down and only gunfire does it.
`player_start [9,21]`. No economy: a clearance is not about spending, and the town
is the map.

**Enemy stance.** Four `garrison` placements, one per village corner:
`wh_cell_nw` [26,17], `wh_cell_ne` [31,17], `wh_cell_sw` [26,28] — `militia_cell` —
and **`wh_hvt_cache`**, an `rpg_team`, in the south-east house [31,28]. Two
`technical` at `hide_south`, group `reserve`, `hold_position`, tagged
`wh_village_reserve`. One trigger: `first_contact` → `commit reserve` to
`village_center`. **No waves at all.** IV is the only Wadi Halam mission with no
reinforcement clock: it is a fixed problem with a deadline, and the deadline is
the families.

**ROE.** `flagged_zones: ["mosque_block"]`, `fail_below: 40`,
`structure_penalty_mult: 1`. Four `civilians` groups (2+1+1) at [28.5,20.5],
[29.5,28.5], [25.5,23.5]; `refuge: civ_refuge`.

**The player's decision.** The order of four houses, against one 300-second
evacuation clock, with a protected block in the middle of the village. A garrisoned
man cannot be shot — his house has to come down — so clearing the village *is* four
sequential demolitions by gunfire, and the mosque sits between the north pair and
the south pair.

**Re-brief? No.** *"heavy ordnance reaches further across open ground than it does
between walls, so mind what you call in"* is shipped, correct and in Shai's voice.
Keep verbatim.

**Where IV's 23 ROE points go — measured, and it matters for the fiction.**
100 − 3 × 6 (three houses) − 5 (one incident of fire into `mosque_block`) = **77**.
**Eighteen of the twenty-three are the price of the order the mission gave.** Only
the five is carelessness. That is Act III's question in a single number, and
`narrative-designer` should have Shai say it once in the `debrief`.

**`say` candidates.**

| where | speaker | the beat |
|---|---|---|
| `kill_cache_guard.say` | **idit** | on the quartermaster dying: what a quartermaster is, and that his ledger is the depot |
| `evac_families.say` | **shai** | on the evacuation completing — the campaign's answer to First Light's nine who did not come in. **This is the single most important `say` line in the game** and it should be one sentence |
| `evac_families.say_on_fail` | **shai** | and its opposite |
| trigger `reserve_commits` | **net** | technicals inbound from the south |

**Trigger id rewrite.** `reserve_commits` → **`the technicals at the south hide
run for the village`**.

**Objective labels.** `kill_cache_guard` *"Kill or capture whoever is guarding the
cache"* — the same construction V uses for Hallaq, and it should stay parallel;
name him as **his quartermaster**, not as a name.

**Twist — T12 "The cache guard is one of ours."** *`wh_hvt_cache` is a KDF soldier
taken at First Light and left holding the cache.* **Classification: ENGINE (G6) for
the form it wants; the civilian fallback is expressible today and was measured
working this session.** Full shape and cost in §1 Option B. The two things the
fallback cannot do: the player cannot shoot him (civilians are untargetable and
hurt only by ordnance), and `evacuate_before` cannot name a group, so the objective
can only require a *count* — the tag on him is carried and read by nothing. Both
are recorded as G6 and G17.

**Passive-control verdict: SOLVED BY ONE WORD.** Measured, shipped mission, no
orders: **ONGOING at 20.0 min**, and `evac_families` **already reaches `failed`** —
it is simply `"primary": false`, and `checkEnd` reads only primaries. Setting
`"primary": true`: control **DEFEAT at 5.0 min**; shipped plan **VICTORY 6.1 min,
ROE 77, roster out 7** — byte-identical to the baseline. **This is the cheapest
real fix available anywhere in the Act III design and it should be taken whatever
the lead decides about the rest of Option C.**

**Ledger fix.** IV should `require` `intel.marked_positions` (the green-basin spec
says so and the shipped file does not). Free — `requires` is a declaration that
neither `MissionRuntime` nor `campaign.ts` reads — but note honestly that **no tag
in IV is produced by any earlier mission**, so the declaration would be aspiration
rather than a contract. §10 O-F asks whether to make it true by giving IV's
`wh_village_reserve` a tag III can mark, or to leave `requires` alone.

**Story hooks.** The atrocity shown. Four families in four houses that the player
must knock down to win. The mosque he must not touch is the one building nobody is
shooting from.

---

### 5.5 V — `wadi_halam_5_depot` · *Break the Depot* · **clearance** · 7 min

**Player starting state.** `apc_eitan`, `ifv_namer`, `inf_squad` ×2, `at_team` from
the ledger; fresh **`dozer_d9`** [13,25], **`demo_squad`** [15,24], `jeep_shoded`
[14,25]. `player_start [13,24]`. **Economy: 400 + 80/min** — GDD §3's clearance
trickle. **What it is for:** a replacement D9 (586 logistics, 26 s) if the first
one dies. That is the mission's whole economy and it should stay that way.

> **The unlock loophole, restated because Act III is where it bites.** `dozer_d9`
> gates at ROE 60 and `demo_squad` at 50, and `spawnPlacement` never consults an
> unlock — only `requestBuild` does. So `starting_force` hands out both
> unconditionally. Measured this session, the campaign's optimal mean is **94**, so
> a competent player has earned them; a careless one gets them anyway. Resolving
> the hole in the obvious direction would strip V of both demolishers and the
> `raze` deadline is what keeps that a *lost* mission rather than a stuck one.

**Enemy stance.** `wh_gate_rpg` — an `rpg_team` in `ambush(3)` **on the gate
marker** — plus three `gun_truck` on `hold_position` inside the wire and a second
`rpg_team` in `ambush(3)` dead centre at [38,24]. Three `moto_rpg` staged east at
[44,20], group `harass`, released by `first_contact` onto `depot_gate`. Four waves
at **45 s, 100 s, 160 s and 220 s** from `rif_south` and `rif_east`, escalating
1+1 → 1+2 → 1+3 → 1+2, all onto `depot_gate`. **Cadence: something arrives at the
gate every minute for the first four minutes, and then the player has to hold the
rubble for four more.**

**The player's decision.** The road. Measured this session:

| route | duration | ROE | what it cost |
|---|---|---|---|
| the southern track (the shipped plan) | 6.1 min | **81** | the seven depot structures, −19 |
| straight east through `village_center` | **5.8 min** | **73** | −19, plus one house and one shanty |
| through the village and parked there 120 s more | 6.1 min | **73** | the same — the auto-search reaches 2 tiles and the houses are spread |
| through the village, D9 ordered onto the mosque | 6.6 min | **43** | −19, −8, and **−30** |

So: **the short road is faster and costs eight points**, and it is not close to the
`fail_below: 40` floor. The mosque alone is not enough either — 43 is a VICTORY.
**One more house takes it to 37 and loses.** The cliff exists and it is one house
wide.

**Re-brief? Yes — a new field and one line.** The D9-and-the-village passage is the
finest bait writing in the tree and must not be touched. What V needs is the
campaign's **`aftermath`** (§6), a **`debrief`**, and one clause naming Hallaq.

**`say` candidates.**

| where | speaker | the beat |
|---|---|---|
| `kill_gate_rpg.say` | **shai** | Hallaq's death or capture, said flatly. The whole act has been building to a man who would not leave his own gate |
| `raze_depot.say` | **idit** | on the depot going down: what came up this road, named — the charges under Beit Sahwan and the rockets over Tel Marum. **This is the line that closes all three acts** |
| `hold_depot.say` | **net** | the ground is held |
| `raze_depot.say_on_fail` | **shai** | the loss line |
| trigger `harass_commits` | **net** | motorcycles on the column |

**Trigger id rewrite.** `harass_commits` → **`the motorcycles come down on the
column`** — which is verbatim what the briefing already promises, so the notice
feed confirms a warning instead of printing an identifier.

**Objective label.** `kill_gate_rpg` — **keep verbatim**. *"Kill or capture whoever
is holding the gate"* is already a voice naming a person without naming him, and
the `say` line is where he gets his name.

**Twist — T13 "The corridor runs both ways."** *A wave arrives from the west, out
of ground the player already took.* **Classification: expressible today, and the
map is already set up for it.** A wave with `from: "kdf_crossing"` or a
`zone_entered(east_road)` trigger firing a `spawn` behind the column. **`east_road`
is authored and used by nothing** (§3.1), which makes it the free condition. One
caution for `level-scripter`: a wave `from` a marker on the player's own start line
must clear `assertGroundClear` at `start()`, and V's start line is occupied at
t=0 — use `ford_south` or `pump_house`, both behind the column and both clear by
the time the column is at the gate.

**Passive-control verdict: ALREADY CORRECT.** Measured: **DEFEAT at 5.0 min**,
`raze_depot=f`. V is the only Wadi Halam mission that already refuses a passive
player, and it does so because `raze` carries a deadline. It is the model the other
four should copy, and Option C is that copy.

**One ROE inconsistency to fix.** V declares **no `flagged_zones`** while its
briefing says *"The mosque is not a target at any price."* IV flags `mosque_block`;
V does not. So in V, firing into the mosque block costs nothing and only levelling
it costs 30. **One line: add `"flagged_zones": ["mosque_block"]` to V's `roe`.**
Measured consequence on the shipped plan: none — the southern route never puts a
round in that block (the plan's ROE trace shows only structure destructions). It
would bite exactly the player the briefing is warning.

**Story hooks.** The end of the war is a man standing in a gateway refusing to
move, and a bulldozer that has to be walked past four houses to reach him.

---

## 6. The two endings

Both end on the Colonel promotion. Both are `aftermath` on `wadi_halam_5_depot`,
which is **live today** (`packages/app/src/ui/hud.ts:555`, appended to the victory
banner on victory only). Both also want a `debrief` (`ui/menu.ts:387`, on the end
screen). Story voice, never orders voice. `narrative-designer` writes the strings;
what follows is the specification.

### 6.1 What the player actually sees today, at the end of the war

Censused this session, and it is thinner than anyone would guess.

1. **The victory banner** (`hud.ts`): the mission name, and `aftermath` beneath it
   if authored. Today: nothing.
2. **The end screen** (`ui/menu.ts` `showEndScreen`): title **"Town is quiet"**,
   tag **"Victory"**, `debrief` if authored, then the single line
   **`ROE 81 · 4 unit(s) walking out`**, then links. `nextMissionAfter` returns
   `undefined` after `wadi_halam_5_depot`, so the "next mission →" link is absent
   and the player is offered **replay / campaign map / menu**. *The last screen of
   the campaign is the same screen as every other mission's, minus one link.*
3. **The campaign board**: each region flies `assets/campaign/flag_brigade.png`
   when `regionProgress` reads `complete`. At the end of the war all three do —
   but **two of them are lying**: `khan_rafid` and `deir_amun` carry
   `"missions": []`, contribute 0/0, and so the Marj reads 5/5 complete on one town
   of three. That is **G5**, and it is what stands between the board and a true
   campaign-complete state.
4. **`commander.json`'s Colonel entry is never displayed**, because it is the
   default for missions after `wadi_halam_5_depot` and there are none.
5. **The main menu's campaign line never shows ROE.** `campaignSummary`
   (`main.ts:140`) reads `roe.cumulative_rating`, a legacy key the sim documents as
   *"written by nothing"*. It shows the roster and stops. The ending is supposed to
   be written on Shai's ROE rating and the shell cannot say what it is.

**So the one-line data change that gives the player an ending is `aftermath` on
`wadi_halam_5_depot`.** One string, ≤240 characters, no engine work, shown on the
victory banner. A `debrief` is the second line and is worth having, with the caveat
that it shows on defeat too (**G11**).

### 6.2 Option 1 — *"Ari Actual"* **(recommended)**

The corridor is cut. Brigade signs Shai's file the same hour of the same day the
war started, and what he is given is the 401st itself — the brigade whose company
he held a compound with in mission one. The last beat is **Idit handing him the
callsign she used to hand him picture on: Ari Actual**, an already-approved
fictional asset (`2026-08-21-commander-brief-design.md`).

| | |
|---|---|
| **`aftermath` must carry** | the corridor cut · the brigade given, not a company · Idit as the one who says it · the five stars · and it must land on a **person**, not a narrator. ≤240 chars. `narrative-designer` writes it; the storyline §5 draft is 234 and is a good starting point |
| **`debrief` must carry** | the ROE number as a *judgement*, not a score — the seventeen missions' mean is what he is being promoted on. And it must read on a **defeat** too (G11), so it cannot say "you won" |
| **end screen today** | "Town is quiet · Victory · ROE 81 · 4 unit(s) walking out". The 81 is not a failure: it is the bill for the order he obeyed, and the `debrief` is where that is said |
| **campaign-complete on the board** | three brigade flags, two of them earned. **Fix is `planned: true` (G5)** on `khan_rafid` and `deir_amun`, excluded from `regionProgress`. One schema property and one `campaign.ts` line |
| **`commander.json`** | **unchanged.** Do **not** move the Lt Col entry's `until_mission` back to `wadi_halam_4_village` to make him a Colonel during the last mission — that is a promotion inside a town, which D-level policy forbids. The Colonel entry stays as the default, invisible until an epilogue mission exists |

**Why it is recommended.** It closes on the two people the player has spent
seventeen missions with, it reuses canon rather than inventing it, and — the real
argument — **it is the only ending that gives the number on the end screen a
meaning.** The player finishes on ROE 81 because the mission ordered him to level
seven buildings. An ending that says "they gave you the brigade for what you did
not destroy" makes that 81 the point rather than a disappointment.

### 6.3 Option 2 — *"The Quiet Ground"*

The war ends with a handover, not a promotion. Shai is made Colonel and the first
thing he does with it is give the ground back: the towns pass to a civil authority
and the brigade goes home. The closing image is the Beit Sahwan compound a year on,
wire down, road open at night.

| | |
|---|---|
| **`aftermath` must carry** | the wire down at Beit Sahwan · that nobody fired a shot to make it happen · the slip in the post rather than a ceremony · a road you can drive at night. ≤240 chars |
| **`debrief`** | same constraint (must read on defeat), and here it should be **Idit's**, not Shai's — she is the one who says the number he will not |
| **end screen today** | identical. The 81 reads differently: as the last thing he broke |
| **campaign-complete** | the same G5 fix, and it matters *more* here, because "the ground is handed back" and a board showing two unearned flags are the same lie in two places |
| **`commander.json`** | unchanged, for the same reason |

**What it buys and what it costs.** It is the stronger ending on **restraint** —
Act III's own question, answered — and the weaker one on **revenge**: it closes the
loop on the nine who did not come in at First Light rather than on the men who took
them. It is also the harder ending to write in 240 characters without sounding like
a policy statement.

### 6.4 The recommendation, and how to overrule it

**Take Option 1.** Two reasons and one concession.

1. **The campaign's through-line is *"you begin holding a perimeter someone else
   chose, and you end choosing what not to destroy."*** Option 1 rewards the
   choosing. Option 2 *is* the choosing, restated — which makes it a summary rather
   than a consequence.
2. **Option 1 has somewhere to go.** If a Kharat Badlands epilogue is ever authored
   (`storyline.md` §4.3's variant), "Ari Actual" is a callsign the next mission can
   open on, and the Colonel entry in `commander.json` finally displays. "The Quiet
   Ground" closes the door, which is a fine thing for an ending to do and a bad
   thing for a project at v0.27.

**The concession, so the lead can overrule me cleanly:** Option 2 is the better
ending **if the lead intends the campaign to be finished**. If Naharin is the last
content anyone authors, close on the wire coming down. The two are one string apart
and nothing else in this document changes.

---

## 7. What `playtest` must measure

The harness convention is one scripted plan proving VICTORY and one no-orders
control proving DEFEAT. **Wadi Halam has four missions with no control in the
harness at all** — only `wadi_halam_5_depot (no orders)` exists. Adding the other
four is the first task whatever the lead decides, because it is what turned this
document's central finding up.

| mission | the control must lose because | the plan must prove |
|---|---|---|
| **I** | `evacuate_before(refuge, 3, 300)` reaches `failed`. **Nothing else on the map can end it** — measured, the shipped mission returns ONGOING at 20 min with `picture` already complete | that four identifications, a four-minute ford hold and a two-group shepherd fit in six minutes with one jeep — and that the drone reaches **`wh_hide_south`**, because III is where that is spent |
| **II** | `raze(pasture, 300)` reaches `failed` | that the shipped plan brings the store down without amendment (measured: it does), and that the 120/min actually buys something — trace `built` events and record how many `inf_squad` land before the 330 s wave |
| **III** | `evacuate_before(refuge, 3, 300)` reaches `failed` | **run it twice, and this is the act's one real carry-over test**: once with `intel.marked_positions: ["wh_hide_south"]` and once with `[]`. Measured today at **5.2 vs 5.9 min**. If that gap ever closes, the two `ambush(3)` placements at the south hide are not doing their job and Act III's carry-over promise is broken |
| **IV** | `evac_families` reaches `failed` **as a primary** | that the shipped plan is unmoved (measured: 6.1 min, ROE 77, roster 7, byte-identical), and **record the ROE trace** — 18 of the 23 points are the order and 5 are carelessness, and that split is the mission's meaning |
| **V** | `raze_depot` reaches `failed` — already proven | that the southern road still wins on 81, and **add a second, deliberately careless variant**: the column through `village_center`. Measured today at **73**, and at **43** with the mosque ordered down. Record both; they are the numbers §10 O-D turns on |

Five further things no `result === expect` assertion can see (GH-84):

1. **The harness's ledger chain does not match the app's.** `playtest.ts` passes
   each mission the *produced* ledger of the one before; `main.ts` merges produced
   keys into a persistent one. Because II produces no `intel.marked_positions`,
   **the harness has been running III with an empty marked list since the town
   shipped**, and the game has not. Declaring the key on II (§5.2) makes them
   agree; until then, any III measurement is a thin-recon measurement.
2. **`roster out` after each mission**, because `from_ledger` prices the next one.
   The rejected III-raze variant took it from 6 to 2 — that is the failure mode to
   watch for on any new objective.
3. **Duration.** Four of the five carry an endure-clock so four ratios are
   informative. All five sit at 0.81–0.90 of `target_minutes`, which is the
   tightest band of any town. Do not tune it looser.
4. **The 20-minute cap is not a duration ceiling.** A mission can blow out
   several-fold and CI stays green (G15). Act III is the town most exposed to this
   because four of its five missions are paced by enemy clocks the player cannot
   shorten.
5. **The passive controls must be added even under Option A**, as ONGOING with the
   reason stated in a comment, so the defect is in the harness rather than only in
   this document.

---

## 8. Asset manifest

Every row is **PRESENT (path)** or **MISSING (gate + pipeline)**. Censused in this
worktree this session; gate names are the ones in `package.json`.

### 8.1 Units — all PRESENT, and Act III needs no new unit

| unit | data | mesh | sprite |
|---|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` | `assets/sprites/INF_SQUAD` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` | `assets/sprites/INF_AT` |
| `demo_squad` | `data/units/kdf/demo_squad.json` | `art/meshes/demo_squad.glb` | `assets/sprites/INF_DEMO` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` | `EITAN_HULL`, `EITAN_TURR` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` | `NAMER_HULL`, `NAMER_TURR` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` | `JEEP_HULL` |
| **`dozer_d9`** | `data/units/kdf/dozer_d9.json` | `art/meshes/vehicles/dozer_d9.glb` | `assets/sprites/D9_HULL` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | **none — sprite-only by design** | `assets/sprites/DRONE_RECON` |
| `militia_cell` | `data/units/enemy/militia_cell.json` | `art/meshes/militia_cell.glb` | `assets/sprites/INF_MILITIA` |
| `rpg_team` | `data/units/enemy/rpg_team.json` | `art/meshes/rpg_team.glb` | `assets/sprites/INF_RPG` |
| `technical` | `data/units/enemy/technical.json` | `art/meshes/vehicles/technical.glb` | `TECH_HULL`, `TECH_TURR` |
| `moto_rpg` | `data/units/enemy/moto_rpg.json` | `art/meshes/moto_rpg.glb` | `assets/sprites/MOTO_RPG` |
| **`gun_truck`** | `data/units/enemy/gun_truck.json` | **none — sprite-only** | `GUNTRUCK_HULL`, `GUNTRUCK_TURR` (`main.ts:944`) |
| `civilians` | `data/units/civilians.json` | `art/meshes/civilians/{civilian_woman,office_worker,farm_worker,civilian_child}.glb` | **MISSING — see 8.5** |

**What `gun_truck` being sprite-only means on the default renderer, stated because
it is easy to get backwards.** `three` is the default; it draws a mesh for any type
with a GLB and a **billboard** for any type without one. So `gun_truck` draws
correctly today, as a flat sprite among 3D bodies. It is not missing and it is not
broken. Act III fields **four of them** — one in II (`wh_aa_east`) and three inside
the depot in V — against **about sixty other enemy bodies** across the town's
garrisons, waves and spawn triggers (12 / 11 / 11 / 6 / 20, counted from the five
files this session), so the mix is far milder than Umm Zeitoun's (§8 of the Act II
MDD records a quarter). It is a
*look* judgement for the lead (§10 O-G), not a gate failure. Closing it is one
mesh GLB: gate `pnpm validate:meshes`, pipeline `tools/vehicles/kit.py` →
`tools/export_mesh_vehicle.py`, owner `blender-art`.

**And on `?renderer=pixi`, `gun_truck` is the only Act III unit that draws
*better* than it does on three** — every mesh vehicle in the town has no death
state (`art/meshes/vehicles/*.glb` declare zero animations), so a destroyed
`technical` on the default renderer goes mesh → intact 2D sprite fading → 2D wreck
in half a second. That is a known engine debt (CLAUDE.md, "Known scaling debts"),
it is not Act III's to fix, and Act III is the town where it is most visible
because the Rif roster is almost entirely vehicles.

### 8.2 Structures — all PRESENT

`data/structures.json`, 8 types, each with an idle and a wreck GLB in
`art/meshes/buildings/` (verified: `shanty house apartment warehouse concrete wall
mosque camp`, plus each `_wreck`). Wadi Halam uses **six**: `house h`,
`warehouse w`, `concrete #`, `shanty s`, `wall =`, `mosque m`. `house` and
`warehouse` ship their supplied photo-textured Meshy bakes and are the named
palette exemption.

> **`mosque` is the one live instance of `storyline.md` O10** — a structure type
> named for a place of worship of a real faith, `roe_penalty` 30, on three maps
> (`beit_sahwan_outskirts` 9 tiles, `wadi_halam_basin` 9, `marj_perimeter` 4).
> Act III leans on it harder than any other content: it is the only protected
> structure on the map, it is the only thing that can lose V's ROE, and IV's
> `flagged_zones` names its block. **If the lead renames the type, Act III is the
> arc that has to be re-briefed.** No beat here depends on the *name*; every beat
> depends on there being one building the player may not touch.

### 8.3 Decor and terrain — all PRESENT

`art/meshes/decor/`: `grass_0-2`, `sand_0-2`, `bush_0-2`, `tree_0-2` (`o`),
`rock_0-2` (`n`), `slab_0-2` (`^`), `boulder_0-2` (`b`), `ditch_0` (`d`). Wadi
Halam authors `o` (228 tiles) and `n` (20) and nothing else; road `r` has no decor
family by design. `"terrain": "green"` resolves through `TERRAIN_THEMES` and the
`sward` scatter — the whole point of the green-basin spec.

### 8.4 Maps and tests

| row | status |
|---|---|
| `data/maps/wadi_halam_basin.json` | **PRESENT**, 48×48, `green`, no elevation, no tunnels. **Unchanged** except for the additive zones in §3.4. Gate `pnpm validate:data` |
| **`tools/src/wadi_halam_doctrine.test.ts`** | **MISSING.** Tel Marum, Umm Zeitoun and Qarn Hadid each have a pinned doctrine test; Wadi Halam has none, and it is the only campaign map with none. Gate `pnpm test`. Pipeline: the measurements in §3.2 and §3.3 in the idiom of `tools/src/tel_marum_doctrine.test.ts` — the seven depot structures and their 19 points, the village's 28 + 30, the two-tile auto-demolition reach, and the two fords being the only vehicle crossings. Owner `level-scripter` |

### 8.5 The one real art hole — and Act III makes it worse

> **`civilians` billboard sheet — MISSING.** `civilians` is the one unit type with
> no `SPRITE_MAP` entry and no sheet, so on `?renderer=pixi` or under `&nomesh` a
> civilian is spawned, walks, is shot at and evacuates **while drawing nothing**.
> `main.ts:834` warns by name rather than refusing.
> **Wadi Halam ships four civilians in one mission. Option C makes it twelve
> across three, and in all three the evacuation is a PRIMARY that can lose the
> mission.** This is now the arc most damaged by that hole, ahead of Umm Zeitoun.
> Gate: `pnpm validate:assets` (palette, reserved bands, binary alpha, silhouette
> IoU, framing) **and** a `SPRITE_MAP` entry, which no gate checks — three complete
> sheets have shipped and drawn nothing for want of one. Pipeline
> `tools/units/kit.py` → `render_team.py`. Owner `blender-art`. Priority is the
> lead's answer to §10 O-G.

### 8.6 VFX — all PRESENT, nothing new

15 emitters in `data/vfx/`, including `shell_impact.json`, `structure_collapse.json`
and `catastrophic_kill.json`; `art/meshes/vfx/{explosion_burst,muzzle_flash,smoke_plume}.glb`.
A building coming down already throws `structure_collapse` through `spawnCollapseFx`,
and Act III does that **ten times** in an optimal shipped run (three village houses and the seven depot structures), eleven under Option C. **No new surface.**

### 8.7 Narrative layer, UI art and audio

| row | status |
|---|---|
| `dispatch` / `aftermath` / `debrief`, `say` / `say_on_fail`, `remove`, `starting_force.group` | **PRESENT** — landed 2026-09-03, verified in `data/schemas/mission.schema.json` and `packages/sim/src/mission.ts` this session |
| `data/campaign/commander.json` | **PRESENT and correct for Act III** — Lt Col through `wadi_halam_5_depot`, Colonel after. §6.1 records that the Colonel entry is never displayed |
| **Shai portrait** | **PRESENT** — `assets/ui/portraits/shai_hammai.png`. Resolved by `packages/app/src/portrait-catalogue.ts`, drawn on the commander bar |
| **Idit portrait** | **PRESENT** — `assets/ui/portraits/idit_zohar.png` |
| **Jubran Hallaq portrait** | **PRESENT — `assets/ui/portraits/jubran_hallaq.png`, 58.2 KiB — and it has NO SURFACE.** `speakerPortrait` (`ui/hud-model.ts:221`) returns `undefined` for anything but `shai` and `idit`, and `speakerPlate` returns the literal string `ENEMY`. A `say` with `speaker: "enemy"` shows the hatch and the word ENEMY. **Where it would show:** the commander bar's `.rl-cmd__face`, on `wh_gate_rpg`'s death line in V, if `commander.json` gained a per-front villain entry and `speakerPortrait` learned to read it. That is **G18** — one JSON key and two lines, and it is the cheapest unrealised story surface in the tree |
| `nadir_sahim.png`, `karim_adhal.png` | **PRESENT**, same non-surface |
| Radio overlay art (frame, speaker plate, portrait slot) | **MISSING.** Gate `pnpm validate:ui` (no colour literals). Owner `render-vfx`. **Not blocking** — a `say` already lands in the notice feed and on the commander bar |
| KDF rank insignia, **4 stars (Lt Col) and 5 (Colonel)** | **MISSING**, no gate (`tools/validate_assets.py` defaults to `--sprites assets/sprites`, so `assets/ui/` is ungated); `pnpm validate:ui` applies if drawn in CSS |
| Rif Cells faction mark | **MISSING**, no gate. Vector. The only insignia shipping is `assets/campaign/flag_brigade.png` (KDF) — **PRESENT** |
| Campaign board (`world_map.png`, `layer_{base,marj,sur,naharin}.png`, `sahar_basin.svg`, `flag_brigade.png`, `art/meshes/campaign/sahar_basin.glb`) | **PRESENT.** Act III needs **no `world.json` edit at all** |
| 11 weapon/impact audio sets, `.ogg` + `.m4a`, CC0 from `tools/gen_audio.py` | **PRESENT** (`assets/audio/`) |
| **Music** | `assets/audio/music/holding_the_perimeter.mp3` is **PRESENT in the tree and is another session's work in flight.** **This design deliberately specifies nothing against it** — no cue, no stinger, no ending sting. When that session lands, the ending in §6 is the obvious first customer and should be revisited then |
| EVA announcement set (objective complete/failed, unit lost, reinforcements) | **MISSING.** Gate `pnpm validate:audio` — **fails by construction**: `KNOWN_EVENTS` is six weapon events and a voice set has none. GH-110; the gate must widen first (G4) |
| Shai / Idit / Hallaq voice lines | **MISSING.** Same gate; every variant needs a redistribution-safe licence **and** a source URL. `storyline.md` §2.4(5) binds hardest here — accent, language and idiom carry ethnicity |

---

## 9. Engine and schema gaps

Ranked by how much of Act III each blocks. Numbering follows `storyline.md` §7 and
`tel_marum/design.md` §7 where the gap is the same; **G16, G17 and G18 are new.**
**None of them stops Act III shipping in the recommended shape.**

| # | gap | smallest proposal | owner | Act III impact |
|---|---|---|---|---|
| **G11** | **`debrief` is one string on every mission end**, where `aftermath` shows on victory only — so the campaign's closing word cannot tell a win from a loss | `debrief_victory` / `debrief_defeat` (or `debrief: { victory, defeat }`), read by `showEndScreen` off `missionEnd.result` | `sim-guard` (schema) + `render-vfx` (`ui/menu.ts`) | **The ending (§6).** Both options need a debrief that reads on a defeat, which constrains the writing to something that works either way. This is the one gap that touches the campaign's last screen |
| **G5** | **A town cannot say it is unwritten.** `world.schema.json` has no `planned` property, so at the end of the war the Marj flies a brigade flag it earned on one town of three | `planned: true` on a town, excluded from `regionProgress` | `sim-guard` (schema), `app` (`campaign.ts`) | **The only campaign-complete state the board has is two-thirds false.** §6 |
| **G18** | **A villain portrait has no surface.** `jubran_hallaq.png` ships and `speakerPortrait` can only resolve `shai` and `idit`; `speakerPlate` returns the literal `ENEMY` | a `villains` map in `commander.json` keyed by front or mission, and one branch each in `speakerPlate`/`speakerPortrait`. The `enemy` speaker enum value already exists | `mission-author` (data) + `render-vfx` (`hud-model.ts`) | Hallaq's one line in V lands as `ENEMY` beside a hatch. Cheapest unrealised story surface in the tree |
| **G6** | **No friendly-tagged HVT, and `capture` does not require its target alive.** Verified: the `capture` branch reads only `livingIn(z,0)` and `contestedIn(z)` | a `side` (or `friendly: true`) field on a placement, scored as a catastrophe on death; and an optional `target` on `capture` that must be alive inside the zone at completion | `sim-guard` | **T12 in its real form**, and T11's "taken alive". Both degrade to a label today, and this document recommends taking the label rather than a `capture` that cannot check its own name |
| **G16** | **A passenger cannot be a civilian.** `embarkPassengers(id, p.passengers, side)` gives passengers the carrier's side, so a civilian aboard an enemy technical spawns on side 1, never enters `civIds`, and is worth nothing to ROE | a `side` override on a nested passenger placement, or `civilians.groups[].mounted_in: <tag>` | `sim-guard` | **T9 "The riders are carrying"** is not expressible today, contrary to `storyline.md` §3.3's "expressible today only as passengers" |
| **G17** | **`evacuate_before` cannot name a group.** It counts `civFlight.evacuatedCount` against `count` and nothing else | an optional `group` on the objective, counting only civilians in that group | `sim-guard` | T12's fallback can require *four* civilians out but never *that one*. Also the reason Act III's three evacuations are all counts |
| **G12** | **A wave cannot speak.** The wave item is `{at_seconds, trigger, to, units}`; `say` went to triggers and objectives and not to waves | `say?: { speaker, text }` on the wave item, emitted with the `wave` event | `sim-guard` | Act III is **the wave town** — **nine authored `waves` entries plus four `spawn` triggers**, thirteen reinforcement events across five missions, and reinforcements arriving is the most legible thing that happens in any of them. The workaround (a `timer_s` trigger at the same second carrying the line and no `do`) is **not available**: `do` is required |
| **G8** | **A trigger cannot fire on an objective, and cannot see the sim** | two `on.kind`s: `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds); the tutorial's `await` already gates on every `SimEvent` | `sim-guard` | Every reaction in Act III is on a clock or a casualty percentage because there is no "the depot is down" or "the families are out" condition. T13's cleanest form wants one |
| **G4** | **The audio gate cannot accept a voice file.** `KNOWN_EVENTS` is `{fire, penetration, ricochet, near_miss, aps_intercept, destroyed}` | a non-weapon set kind and its events; the licence and source-URL checks stay | `render-vfx` + `content-validator`; GH-110 | every voice row in §8.7 |
| **G15** | **`playtest` cannot express "this mission got 3× longer."** Its assertion is `result === expect` | a per-mission duration ceiling in the harness — a design call, and **not** `target_minutes` | `playtest` | Act III's five missions are paced by enemy clocks; a wave-volume change could double a mission and CI would stay green |
| **G9** | **`mark`, `escort`, `no_collateral_above` throw.** `escort` is the obvious shape for V | out of scope; recorded so nobody authors one by reading the schema | `sim-guard`; GH-2, GH-4 | V is literally an escort mission and says so in its briefing, expressed entirely through `raze` + `hold_for` |
| **G10** | **No Intel economy.** `resources` is `additionalProperties: false` with `logistics_start`, `intel_start`, `logistics_rate_per_min`, `supply_corridor` | add `intel_rate_per_min`. Note Intel already accrues at 8/min per drone, so `intel_start` alone would give I an economy today | `sim-guard` + `mission-author` | Idit's Act III arc is "which questions are worth a life", and the resource that would price a question does not exist in any Naharin mission |
| **—** | **`campaignSummary` reads a dead key** (`main.ts:140`, `roe.cumulative_rating`, documented as "written by nothing"), so the menu never shows campaign ROE | read `campaignRoe(ledger).mean` instead. One line | `app` | Not a schema gap; recorded because §6's ending is written on a number the shell cannot display |

---

## 10. Open decisions for the lead

| # | decision | in plain words | recommendation |
|---|---|---|---|
| **O-A** | **Which plot?** A (re-integration only), B (+T12), C (+a failable primary in I–IV) | A ships in a day and leaves four of five missions unlosable, which the pipeline's own contract refuses. B is the act's best scene and needs engine work to be what it is for. C is 4 objective rows, 2 civilian groups, 1 raised structure and 1 word, measured to cost the shipped plans 0.6 minutes and 0 survivors | **C.** If the schedule forbids it, take **A** and still take IV's one-word change, which is free |
| **O-B** | **The ending — O9, and it is the first decision, not the last** | Option 1 "Ari Actual" (the brigade is handed to Shai) or Option 2 "The Quiet Ground" (the ground is handed back). One `aftermath` string apart | **Option 1**, unless the lead intends Naharin to be the last content anyone authors — in which case Option 2 and close the door |
| **O-C** | **Does IV's `evac_families` become a primary?** | One word. Measured: the shipped plan is byte-identical (6.1 min, ROE 77, roster 7) and the no-orders control goes from ONGOING to DEFEAT | **Yes, unconditionally.** It is the cheapest correct change in the whole design and it is independent of O-A |
| **O-D** | **Is the mosque cliff the right width?** | Measured: ordering the D9 onto the mosque in V ends at **ROE 43** — a victory, three points above `fail_below: 40`. One more house takes it to 37 and loses. So the campaign's last mission tolerates its own worst act | The lead's. Two honest options: leave it (the point is that restraint is *scored*, not enforced) or raise V's `fail_below` to 45, which makes the mosque alone fatal. **I lean to leaving it** — a rule that cannot be broken is not a rule the player chose to keep |
| **O-E** | **Is `wadi_halam_3_counterraid` really a build-up?** | It is the only mission in the war with the `buildup` phase and it declares **no `resources`** — GDD §4 calls build-up "the one phase where the player has breathing room" and this one is a raid with a five-minute hold | The lead's. Adding `logistics_start`/`rate` would make the phase honest and would move the measured ladder; **leaving it is also defensible** and the storyline already treats "the brigade never gets breathing room" as a story fact. If it changes, `playtest` re-runs III, IV and V |
| **O-F** | **Should IV and V declare `intel.marked_positions` in `requires`?** | The green-basin spec says they should. But **no tag in IV or V is produced by any earlier mission**, so the declaration would be aspiration. Making it true means giving IV's `wh_village_reserve` a tag III can mark | **Declare it on II only** (where it is true and where it fixes the harness's chain, §5.2), and leave IV and V alone until somebody authors the tag |
| **O-G** | **Does Pixi still have to be playable, and does the billboard mix matter?** | Two things ride on this. `civilians` draws nothing on Pixi or `&nomesh`, and Option C makes **three** Act III missions score on civilians, two of them fatally. Separately, four `gun_truck` in the town are billboards among meshes | The lead's. If Pixi must be playable, the **`civilians` sheet is Act III's one genuinely missing art asset** and it is now the highest-priority art row in the campaign. The `gun_truck` mesh is a *look* decision, not a gate |
| **O-H** | **Three of Act III's five failable primaries are `evacuate_before`. Is that repetition?** | The only failable types are `raze`, `collapse` and `evacuate_before`, and Naharin has no tunnels, so `collapse` is out for the whole town — two shapes for five missions | **Keep it, and say why in the mission text rather than hiding it.** The three are an escalation of *whose fault it is*: at the fords they are Hallaq's victims, on the cattle track they are in the way of a raid the player chose to run, in the village they are in the houses he is clearing. That is the act's question asked three times, harder each time |
| **O-I** | **How much may Hallaq say?** | He gets one line in the whole act, on his own death or capture in V. `speaker: "enemy"` exists and is deliberately never named | **One line, about the road, never about the player.** Everything else he does is a placement. And if G18 lands, that one line is where his portrait shows |

---

## Appendix — the census and the measurements this was written from

Run 2026-09-06 in `/Users/ilpinto/dev/roaring-lions-story` on `feat/story-act-1`.
Anything not listed here was not checked this session.

```
pnpm -s playtest                                            # 27 lines, exit 0 — every shipped figure in §4.1
cat data/missions/wadi_halam_{1_fords,2_laager,3_counterraid,4_village,5_depot}.json
python3: data/maps/wadi_halam_basin.json                    # rows, symbol counts, markers, zones, no elevation, no tunnels
python3: data/schemas/mission.schema.json                   # top-level props, $defs.say, trigger, objective, wave, placement, roe, resources, structures, civilians
cat data/structures.json data/campaign/{world.json,commander.json}
cat data/units/enemy/{technical,moto_rpg,gun_truck,militia_cell,rpg_team}.json
python3: data/units/kdf/*.json                              # sight, abilities, unlock, weapons
sed: packages/sim/src/mission.ts    SUPPORTED(:312), capture/hold_for/raze/collapse/evacuate_before/eliminate_hvt/locate,
                                    stepRoe(:1158), spawnPlacement preMarked(:1107), embarkPassengers(:1084),
                                    checkEnd, intel.marked_positions union(:1630), evacuate_before refuge guard(:716)
sed: packages/sim/src/sim.ts        stepDemolition(:4279) — the auto-search and its PROTECTED_ROE skip
sed: packages/sim/src/structures.ts DEMO_SECONDS=5, DEMO_RANGE_SQ=2 tiles, PROTECTED_ROE=20
sed: packages/sim/src/civilians.ts  CIV_FLEE_AT, SHEPHERD_RADIUS_SQ (4 tiles)
sed: packages/app/src/campaign.ts   commanderForMission (until_mission is INCLUSIVE), regionProgress, nextMissionAfter, campaignRoe
sed: packages/app/src/ui/menu.ts    showEndScreen(:377) — title, debrief, "ROE N · M unit(s) walking out"
sed: packages/app/src/ui/hud.ts     announce/dispatch(:452), victory banner aftermath(:555)
sed: packages/app/src/ui/hud-model.ts speakerPlate(:202), speakerPortrait(:221)
sed: packages/app/src/main.ts       describeMissionEvent(:255) "enemy reacts (<id>)", ledger merge(:1759), campaignSummary(:140), SPRITE_MAP gun_truck(:944)
cat packages/app/src/portrait-catalogue.ts
grep: tools/validate_data.mjs       passengers/can_embark, PROTECTED_ROE, consumesIntel, trigger no-op guards
ls: art/meshes{,/vehicles,/buildings,/decor,/civilians}; assets/{sprites,audio,audio/music,ui/portraits,campaign}; data/vfx
ls: tools/src/*.test.ts                                     # no wadi_halam_*.test.ts
```

**The measurements.** Every figure in §1, §3.2, §3.3, §4.1, §5 and §7 was produced
by a scratch harness under
`/private/tmp/claude-501/.../scratchpad/`, outside the repository, importing
`packages/sim/src/index.ts` and `packages/data/src/index.ts` by absolute path and
reproducing `tools/src/backtest/playtest.ts`'s `run()` exactly — same seed
(424242), same capacity (256), same structure and tunnel registration, same
20-minute cap. Mission JSON is deep-copied and mutated **in memory**; map JSON
likewise for the additive-zone probes. The five shipped plans were lifted verbatim.
**Nothing was written into `data/`, `tools/` or `packages/`.**

Four method caveats, stated so nobody repeats them:

1. **The passive controls were run from an EMPTY ledger**, not from the chained
   one. `spawnPlacement` falls back to the authored count when the ledger is short,
   so a `from_ledger` placement spawns at full strength either way; the controls'
   own alive counts (6 / 5 / 4 / 7 / 8) confirm it. A control's job is to prove the
   mission can be lost, and the ledger cannot change that verdict.
2. **`parseMap` returns structure tiles as FLAT INDICES**, not `[x,y]` pairs. Two
   earlier passes of the §3.2 audit printed `xNaN` and a single bogus `(none)`
   bucket before that was noticed. Divide by `map.width`.
3. **An `evacuate_before` probe must put its refuge marker inside its arrival
   zone** or `MissionRuntime.start()` throws. `civ_refuge [22,36]` is inside
   `refuge [19,34,8,6]`; every probe here used that shipped pair.
4. **The first T12 probe aimed its `capture` at `mosque_block`** — a zone the plan
   never holds — and returned ONGOING for a reason that had nothing to do with the
   twist. Re-run against an additive `cache_house [30,27,4,4]` it returns VICTORY
   6.3 min / ROE 77 / roster 7. Check the zone under every probe before believing a
   negative.

**Not verified this session, and flagged as such:** whether *Jubran Hallaq*
collides with a real public figure (`storyline.md` §2.4(3) — that check happens
outside this repository); the real-player duration of anything, which no instrument
in this tree can measure; whether the four Rif waves in V actually *reach* the
depot gate rather than dying en route (the harness reports the result, not the
route); and any claim in `docs/campaign/research-2026-09-03.md` not re-run above.
