# Mission Design Document — Act II · Sur · **Tel Marum and Umm Zeitoun**

**Date:** 2026-09-03 · **Status:** proposal. Nothing here is canon until the lead
signs §8.
**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`,
censused and *measured* this session; every content claim cites a path, and every
sight, route and duration figure below was produced by driving the real `Sim`,
`FlowField` or `pnpm playtest` today (method in the Appendix).
**Read first:** `docs/campaign/README.md` (the contract), `docs/campaign/storyline.md`
(the war), `docs/campaign/beit_sahwan/design.md` (Act I), `docs/campaign/research-2026-09-03.md`.
**Downstream:** `narrative-designer` (§3.2, §5 story hooks), `level-scripter`
(§3.3, §5, §7), `mission-author` (all of it, §4 especially), `playtest` (§5.6).

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| **D13** | Act I is landed; move to Act II | lead, 2026-09-03 (`storyline.md` §0.2) | this document |
| D4 | One villain per front, atrocity at the opening, killed or captured at the end | lead | **Karim Adhal**, Idit's file **LANTERN**, *the observer*. Atrocity: a week of rockets on Kedem's north. End: **`eliminate_hvt`**, Umm Zeitoun IV |
| D1/D2 | Shai Hammai, Idit Zohar, the two voices | lead | Shai is a **Major** for the whole of Act II — Tel Marum I–III *and* Umm Zeitoun 1–4. No promotion inside either town |
| D9 | Static continuity, authored text only | 2026-08-21 spec | no line in Act II branches on the ledger |
| D10 | War order proximity → standoff → source | GDD §2 | Sur sits between the Marj and Naharin; §2 lists the `world.json` edits |
| — | **The engine slice of 2026-09-03 landed** (`say`, `remove`, `starting_force.group`, `dispatch`/`aftermath`/`debrief`, `data/campaign/commander.json`) | `docs/superpowers/specs/2026-09-03-narrative-layer-engine-design.md`; verified in the tree this session | several Act I twists that were `engine` are expressible now. §3.3 re-classifies T6–T8 against the vocabulary as it actually stands |

**The register.** Sur's atrocity is *told*, never played: one settlement, one
morning, off-map, in the `dispatch`. What is *played* is the machine that did it —
an observer on a hill and a tube behind it. The ceiling is Act I's
(`beit_sahwan/design.md` §10 O-D): name what happened, never a method, never a
scene.

---

## 1. Premise and plot options

### The premise

Rockets have been falling on Kedem's north for a week and nobody can say from
where. They come from behind a mountain wall, out of range of anything that can
answer, and they are accurate — which means somebody is watching where they land.

`rocket_battery` is **range 20, sight 6** (`data/units/enemy/rocket_battery.json`),
and `selectTarget` gates every shot on **per-side** identification
(`packages/sim/src/sim.ts`). The battery fires at whatever *any* Sarim unit has
seen. So the weapon is not the tube. The weapon is the eyes, and Act II's question
— *can you reach?* — is really *which eye is worth the crossing.*

Three plots follow. They differ in **how much of Sur is playable**, **what the
player decides on the ground**, and **where the villain dies**.

---

### Option A — *"Act II ends at the pass"*

Tel Marum's three shipped missions, re-briefed, with **one new tagged placement**
beside `tm_hvt_battery` in III so Karim Adhal has an ending. Umm Zeitoun stays
unbuilt.

- **Phase ladder:** 2 → 3 → 5. Three missions, the town guideline's floor.
- **What the player decides, act-wide:** the shipped decision — the wide saddle
  (armour, under two Kornet pockets) or the boulder corridor (infantry only, ten
  tiles longer). That is a genuine, measured, terrain-enforced split
  (`tools/src/tel_marum_doctrine.test.ts`), and it is the only act-level decision
  on offer.
- **How the villain ends:** `eliminate_hvt` on a `sarim_rifles` tagged
  `tm_hvt_lantern`, placed beside the Grad at `[25.5,6.5]`.
- **Cost, stated plainly.** Adhal is introduced as *the man who cannot be reached*
  and then dies standing next to his own gun, three missions later, on the same
  axis, in a fight the player was already having. GH-122 stays open. Sur is a
  one-town region and §2's `world.json` C3 (`planned: true`) has to carry the
  weight of an act that is half a town short. And the act's own question is never
  asked: at Tel Marum you reach the battery by taking a **pass**, which is the
  Marj's question (force a gap) in mountain clothing.
- **Buys:** it ships this week. Zero new content beyond one placement, one
  objective, three `dispatch`/`aftermath` strings and the `say` lines.

### Option B — *"Tel Marum plus a short Umm Zeitoun"* — two missions

Tel Marum I–III, then **`umm_zeitoun_1_recon`** and **`umm_zeitoun_2_clearance`**
on one new map: find the observer net, then kill it and Adhal with it.

- **Phase ladder:** 2 → 3 → 5, then 2 → 5. Five missions across two towns.
- **What the player decides:** in the recon, which eyes the drone buys and which
  it cannot; in the clearance, the order in which he blinds them, under one clock.
- **How the villain ends:** `eliminate_hvt(uz_hvt_lantern)` on the crest in the
  second mission.
- **Cost:** a whole 48×48 relief map with pinned sight tests, for two missions.
  The map's best ideas — a battery that *displaces*, a hamlet that is his bait, an
  economy in the one phase Act II can justify one — are all cut, because they need
  a build-up and a second clearance to live in. **The town guideline is 3–5
  missions; two is under it**, and Umm Zeitoun would be the only town in the game
  below the floor.
- **Buys:** the villain dies where the front design put him, at roughly half the
  authoring cost of (C).

### Option C — *"Tel Marum re-integrated, Umm Zeitoun in four"* — **RECOMMENDED**

Tel Marum I–III re-briefed and re-integrated (the `requires` fix, the `dispatch`,
the `say` lines, and the promotion moved off `tel_marum_3_clearance`), then the
four-mission Umm Zeitoun of `storyline.md` §4.1 on a new map: **recon → build-up →
clearance → clearance**, phases 2 → 4 → 5 → 5.

- **Phase ladder across the act:** Tel Marum 2 → 3 → 5; Umm Zeitoun 2 → 4 → 5 → 5.
  Ascending inside each town, which is the rule. Umm Zeitoun **skips foothold on
  purpose** and it is a story fact: after Tel Marum the brigade already has its
  foothold in Sur.
- **What the player decides, act-wide:** *which eye is worth the crossing.* Every
  mission is a different answer to it — in I the drone's look versus the
  MANPAD's envelope; in II whether to rush the near knoll or endure the shelling
  for four minutes; in III which horn first, and each horn is a different
  **domain**; in IV what to bring, since there is no dozer and the depot comes
  down under charges.
- **How the villain ends:** `eliminate_hvt(uz_hvt_lantern)` on the crest in
  Umm Zeitoun IV, with a `withdraw_to` that makes a slow player climb for him.
  **Not `capture`** — an observer's doctrine is not being where you are looking
  (`storyline.md` §2.3).
- **Cost:** one 48×48 relief map (**drafted and measured in §4 of this document**),
  four mission JSONs, four `playtest` plans and four passive controls, one
  `world.json` edit, one `commander.json` edit. No new art of any kind (§6).
- **Buys:** the war gets its middle. Sur becomes a two-town region, GH-122 closes,
  and Act II asks a question no other act asks.

### Recommendation

**Option C.** Three reasons, in order of weight:

1. **A is the only option in which Act II never asks its own question.** Tel
   Marum is a pass: one axis, two saddles, forcing a gap. That is a fine mission
   set and it is *the Marj's question on a mountain*. "Can you reach?" needs
   ground with no gap to force — a basin you cross in the open, watched from
   several hills, where the decision is which hill to pay for. §4 is that ground.
2. **B pays for the map and then throws away what the map is for.** The
   displacement, the hamlet and the economy are the three things that make the
   basin more than a shooting range, and none of them fits in two missions.
3. **C is the only one that closes GH-122** and lets `world.json` C1 (Naharin
   unlocks on the last Sur mission) mean something.

### Killing my own favourite

**If the lead takes A, Act II survives and so does the campaign.** Adhal gets a
real ending — `eliminate_hvt` beside his own battery is not a cheat, and the
briefing already frames the battery as the thing you must physically reach. The
war order holds, Naharin still follows Sur, and the ending in `storyline.md` §5 is
untouched. What is lost is the act's question and one town of GH-122. That is a
real loss and not a fatal one; it is also **the cheapest possible Act II**, and if
the schedule is the binding constraint the lead should take it without apology.

**What A cannot survive is being called finished.** `world.json` needs C3's
`planned: true` (§7 G5) or Sur reads 100% complete on one town of two, which is
the same lie the Marj told before Act I.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | II of III. Sur · Sarim Brigades · Tel Marum, then Umm Zeitoun. *Standoff*, the second of GDD §2's three |
| **Shai's rank on entry** | **Major**, 3 stars. Promoted at the Act I boundary for the Marj — "the district's routes came down, with the man who dug them" (`storyline.md` §2.1) |
| **Shai's rank on exit** | **Major.** Promoted to **Lieutenant Colonel** at the act boundary, after the last Sur mission, for "the batteries stopped firing on Kedem's north". **Never inside a town** |
| **`commander.json` is wrong for this act today** | `data/campaign/commander.json` reads `{ "rank": "Major", "stars": 3, "until_mission": "tel_marum_3_clearance" }`. Under Option C the four Umm Zeitoun missions come *after* that in campaign order, so the resolver hands them **Lieutenant Colonel** and promotes Shai mid-act. **One-line fix:** `until_mission` → `umm_zeitoun_4_clearance`. Under Option A the file is already correct |
| **Idit's intel thread** | This is the front where information *is* the weapon, and the mechanism is in the engine rather than in her dialogue. Tel Marum I is the densest intel mission in the game — four `locate` primaries, one of them literally *"whoever is spotting for the battery"*. II proves that killing one eye eases the shelling and does not stop it. III is where her work is meant to pay and currently does not (§3.4). Umm Zeitoun 1 makes the *quality* of her picture buyable: four posts, and the drone can only reach some of them for free (§5.1) |
| **The villain's atrocity** | **Told, not played.** A week of rockets onto one settlement on Kedem's north, one morning, off-map, no name. It belongs in `tel_marum_1_recon`'s `dispatch` — the field exists now and that mission has none |
| **The villain's presence, mission by mission** | **TM I** his whole network seen at once: `tm_pocket_east`, `tm_pocket_west`, `tm_spotter_west`, `tm_picket_wide`, `tm_bay_lip`, `tm_hvt_battery`. **TM II** one of his eyes dies and the shelling does not stop — the briefing already says so. **TM III** `tm_spotter_narrow` and `tm_manpad`, and his gun dies while he does not. **UZ 1** four posts on four hills and two MANPAD teams that make looking at two of them expensive. **UZ 2** the near post ranges the ground the brigade must build on. **UZ 3** he shells the hamlet he is standing in, and the observer who calls it sits on the knoll the player levelled a mission ago. **UZ 4** he is on the crest with the relay, and he moves when pressed |
| **The villain's end** | **Umm Zeitoun IV**, `eliminate_hvt(uz_hvt_lantern)`. Under Option A, `eliminate_hvt(tm_hvt_lantern)` at `tel_marum_3_clearance` |
| **Ledger in, from Act I** | `roster.surviving_units` (Beit Sahwan IV's survivors — measured today: **roster out 6**), `roe.mission_ratings` (Act I's plans measured 75 / 100 / 100 / 94 / 98 → a mean well above every KDF unlock threshold), `campaign.completed_missions`, `intel.marked_positions` (produced by `beit_sahwan_1_recon` and `_4_subterranean`) |
| **Ledger out of the act** | `R M C` from all seven missions, `I` from Tel Marum I and Umm Zeitoun 1 and 3, and **`civ.settlements_evacuated`** from Umm Zeitoun 1 and 3. That last is a live key produced today by exactly one mission and read by nothing; adding it costs nothing and **no line may branch on it while D9 stands** |
| **What Act III inherits** | a roster that has crossed two mountains, an ROE rating that has already gated the `sniper_team` (60) this act depends on, and a `marked_positions` list long enough that Wadi Halam I's recon is a check rather than a discovery |
| **`world.json` edits** | **C1** Naharin's `unlock.after_mission` → the last Sur mission (`umm_zeitoun_4_clearance` under C; `tel_marum_3_clearance` under A). Today **both Sur and Naharin unlock on `beit_sahwan_3_clearance`**, so a player can skip Sur entirely — verified in `data/campaign/world.json` this session. **C2** Sur's `unlock.after_mission` → `beit_sahwan_4_subterranean`, so Act I ends with Sahim. **C3** `planned: true` on the towns with no missions (§7 G5). Under C, `sur.towns[umm_zeitoun].missions` gains four ids |

---

## 3. Tel Marum, as shipped — what changes

Three missions exist and they are good. Nothing here re-authors a fight. What
changes is: three story fields that did not exist when they were written, a
one-line ledger fix, the `say` lines, and — the one real defect — **a passive
player cannot lose any of them.**

### 3.1 What is measured, today, in this worktree

`pnpm playtest`, run this session, exit 0:

```
tel_marum_1_recon (passive control):     ONGOING in 20.0 min, ROE 100, roster out 0
tel_marum_1_recon:                       VICTORY in  0.9 min, ROE 100, roster out 7
tel_marum_2_foothold (passive control):  ONGOING in 20.0 min, ROE 100, roster out 0
tel_marum_2_foothold:                    VICTORY in  4.2 min, ROE 100, roster out 5
tel_marum_3_clearance (passive control): ONGOING in 20.0 min, ROE 100, roster out 0
tel_marum_3_clearance:                   VICTORY in  3.5 min, ROE 100, roster out 9
```

Duration ratios against declared `target_minutes`: I **0.13** (7), II **0.70**
(6), III **0.50** (7). Only II carries an endure-clock, so only II's ratio is
informative (GH-84); I's plan flies the drone to the answer and III's goes
straight up the axis.

> **The defect.** All three passive controls are **`ongoing`, not `defeat`**.
> `tools/src/backtest/playtest.ts` says so in its own comments: mission I's
> `ongoing` was an authorised **bounded fallback** after a real attempt (24
> attackers stalls, 28 wipes at 12.4 min, and 28 in sustained pursuit "is a
> stand-up battle, not a pursuit response to a recon patrol"), and **II and III
> inherited that ruling without their own measurement** — the file says so
> verbatim: *"no wave-volume wipe was attempted for this mission."*
>
> The README's rule is *"a mission a passive player wins is not a mission"*, and
> these three are one step better than that and one step short of the bar: a
> passive player cannot win and cannot lose. He is **stuck, not lost**, which is
> the state this pipeline is supposed to refuse.
>
> **Why it happens is structural, not a tuning miss.** Only three objective types
> can ever reach `failed` — `raze`, `collapse` and `evacuate_before`, each on a
> `seconds` deadline. Tel Marum's six primaries are `locate ×4`, `hold_for`,
> `eliminate_hvt`, `capture` — none of them can fail. `checkEnd` then loses only
> on a wipe or on ROE, and **Sarim doctrine is standoff: the enemy does not come
> to you**, so a force parked at `[24,44]`, 38 tiles from the battery, is never
> wiped. On this front the enemy will not lose the mission for you.
>
> **The fix, and it is a design rule for the whole act:** *on a front whose enemy
> will not come to you, the clock is the only thing that can beat you — so every
> mission carries exactly one failable primary.* Umm Zeitoun is designed to that
> rule (§5.6). Retrofitting it to Tel Marum is a change to shipped, measured
> content and is §8 **O-C** for the lead, not a decision I take here.

### 3.2 Per mission: re-brief, and the `say` lines

**Tel Marum ships with `"triggers": []` in all three missions** — verified this
session. There is not one trigger id in the town, so there is nothing for a
trigger `say` to hang on. Every mid-mission line in Act II is therefore either an
**objective `say` / `say_on_fail`** (live, no new trigger needed) or a **new
trigger authored for the purpose**. Waves cannot speak at all: the wave item shape
is `at_seconds trigger to units` and carries no `say` (§7 G12).

#### I — `tel_marum_1_recon` · *The Gateway* · recon · 7 min

| | |
|---|---|
| **re-brief?** | **Yes — new fields only.** The `briefing` already carries the atrocity (*"Rockets have been falling on the north for a week and nobody can say from where"*) and the orders voice must not gain narration |
| **`dispatch`** | The act's opening, and the only place the settlement is named as a thing that happened. One sentence, ≤240 chars, off-map, no method |
| **`say` candidates** (all live) | `find_spotter.say` — **idit**, on identifying `tm_spotter_west`: the line that turns a contact into a *person*, because the whole act rests on the player believing a hill has a man on it. `find_battery.say` — **idit**: the tube is 38 tiles from the start line and out of reach, said once. `screen_out.say_on_fail` — n/a, `survive_until` cannot fail |
| **twist** | **T6, re-classified below** |
| **story hook** | Idit's first Sur picture, and the first mission of the war in which what she is looking for is a *pair of eyes* rather than a weapon |

#### II — `tel_marum_2_foothold` · *The Start Line* · foothold · 6 min

| | |
|---|---|
| **re-brief?** | **No.** The shipped briefing carries the act's whole thesis already — *"It fires wherever the Sarim line can see… he is not the only pair of eyes on that ground, so do not expect it to stop."* Keep verbatim |
| **`say` candidates** (all live) | `kill_spotter.say` — **shai**, on the HVT dying: this is **T7**, and it needs saying rather than building (below). `hold_approach.say` — **net**, on the hold completing |
| **twist** | **T7** |
| **story hook** | the mission that teaches the rule the act is made of: indirect fire is not weather, it is a person on a hill |

#### III — `tel_marum_3_clearance` · *The Pass* · clearance · 7 min

| | |
|---|---|
| **re-brief?** | **Under Option C, no** — only the ledger line changes (§3.4). **Under Option A, yes**: +1 tagged placement, +1 primary, and an `aftermath` |
| **`say` candidates** (all live) | `kill_battery.say` — **idit**, on the Grad dying: *the shelling stops and the man who aimed it does not*, which is the line that carries the act into Umm Zeitoun. Under Option A this becomes Adhal's death line instead |
| **ROE** | shipped and correct: `flagged_zones: ["town_block"]`, `fail_below: 45`, the battery two tiles from the block. **Change nothing** |
| **twist** | **T8** |
| **story hook** | Idit's corridor line is measured and pinned (`tools/src/tel_marum_doctrine.test.ts`); the briefing's "ten tiles longer" is the number the test proves. Do not paraphrase either |

### 3.3 T6–T8, re-classified against the vocabulary as it stands today

| twist | storyline's classification | **classification now** | why, and the smallest shape |
|---|---|---|---|
| **T6 "The eye is behind you."** On `zone_entered(valley_floor)` a `sarim_rifles` spawns *behind* the hollow | expressible today | **expressible today, and now it can speak.** `on: {kind:"zone_entered", zone:"valley_floor"}` → `do: {kind:"spawn", units:[…]}` plus `say: {speaker:"idit", text:…}` on the same trigger | This is the act's premise as a jump-scare: the ground you formed up in was never yours. Mission I has no triggers at all, so this is the town's first. **Watch the trigger id** — it is shown verbatim as `enemy reacts (<id>)`; name it as prose |
| **T7 "He was never in the pocket."** The `eliminate_hvt` completes and the shelling does not ease for 30 s | needs nothing new, needs *saying* | **live, and the saying is now free.** `objectives[].say` on `kill_spotter`, speaker `shai` or `idit`. No trigger, no wave change | The wave clock already produces the effect; the storyline was right that only the voice was missing, and the voice exists now. **This is the cheapest real twist in the act** |
| **T8 "The battery fires into its own town."** A rocket lands in the block the player may not shoot into, and the ROE score does not move | `spawn` can stage it; making a round *land* there needs sim work | **still engine, and it should stay unbuilt at Tel Marum** — but the *idea* is expressible on other ground, and Umm Zeitoun III is where it is spent (§5.3). What cannot be authored is *where an enemy round lands*; what can be authored is **civilians standing where his own fire will reach them**, so that his rockets kill them and the player's score does not move because `stepRoe` only ever deducts for a `destroyed` whose `by` is a player unit | The purest statement of the bait, moved from a scripted impact to a placement. §7 G13 records the engine version |

Two more, new, both for `level-scripter`:

- **T-C1 "The tube moves."** `tm_hvt_battery` gets `group: "battery"` and a trigger
  `on: casualties_pct(40) → withdraw_to: town_edge`. *Expressible today.* It makes
  the Grad a thing that runs rather than a thing that sits, and it is the
  rehearsal for Umm Zeitoun's displacing battery. **Risk:** it can walk the
  `eliminate_hvt` primary out of the shipped plan's reach — `playtest` must re-run.
- **T-C2 "The corridor was watched after all."** On entering the boulder
  corridor, a `spawn` of one `sarim_rifles` at `sarim_west [8,4]`.
  *Expressible today, plus one additive map edit:* `tel_marum.json` declares six
  zones (`valley_floor pass overwatch_east overwatch_west approach town_block`)
  and **none over the corridor**, so this needs a **new zone
  `narrow_corridor [10,12,2,6]`** — x10–11, y12–17, the twelve `b` tiles
  themselves. Additive, the character grid untouched, and a zone nothing names is
  inert, so the other two missions are unaffected. It is the honest answer to the
  measured finding that the flank is priced by terrain and not by fire —
  CLAUDE.md's own conclusion is that closing the rest needs something that
  **shoots** the corridor, not something that watches it, and a spawned rifle
  section shoots it.

### 3.4 The `requires` fix — one line, real consequence

`data/missions/tel_marum_3_clearance.json` declares
`"requires": ["roster.surviving_units"]`. **It should be
`["roster.surviving_units", "intel.marked_positions"]`**, as
`beit_sahwan_3_clearance` and `tel_marum_2_foothold` already do. Act II spends two
missions building a picture and its clearance does not declare that it reads one.

**What it changes mechanically: nothing.** Verified this session —
`MissionRuntime` reads `ctx.ledger['intel.marked_positions']` directly and never
consults `ledger.requires`; `packages/app/src/campaign.ts` gates only on
`campaign.completed_missions`. `requires` is a declaration. So the fix is free,
cannot move `pnpm playtest`, and makes the contract honest.

**What it changes in play** is already true and merely unstated: a tag marked in
mission I spawns **pre-identified and forfeits its ambush** in a later mission
(`spawnPlacement`'s `preMarked`). Tel Marum III fields `tm_bay_lip` — a
`recoilless_team` in `ambush(4)` — carrying the same tag it carries in I. **A
player who found the bay lip in the recon disarms that ambush before the clearance
starts; one who rushed the recon walks into it.** That is GDD §4's carry-over,
already authored, and III does not say it reads it.

### 3.5 What any change does to the three shipped plans

Read before touching anything (`tools/src/backtest/playtest.ts`):

- **I's plan resolves at 0.9 min** — before the first wave spawns at 150 s. It
  flies the drone to `[24,25]`, then around the west by `[16,27] [11,22] [11,12]
  [15,8]`, deliberately staying outside `tm_picket_wide`'s and `tm_spotter_west`'s
  **8-tile weapon and 9-tile sight** at every leg. **Anything added inside that
  corridor breaks the plan.** T6's spawn is in `valley_floor` behind the hollow
  and does not touch it; T-C2's is at `sarim_west [8,4]`, 4.5 tiles from the
  plan's last waypoint `[15,8]` — **that one is a real risk and must be measured.**
- **II's plan takes the southern edge of the `approach` zone**, mortars from the
  hollow at `[24,29]`, and sends infantry up the west side to `[20,16]`. A `say`
  on `kill_spotter` cannot touch it. T7 is text.
- **III's plan takes the wide saddle**, kills the west observer with mortars from
  the hollow first, and reaches the battery at `[25,6]` by t=240. **T-C1's
  `withdraw_to: town_edge [25,2]`** moves the HVT four tiles further on; the
  plan's last order is an `attackMove` onto `[25,6]`, so it would probably still
  chase and kill it — *probably* is not a measurement. Under Option A the new
  `tm_hvt_lantern` placement sits beside the battery and dies in the same fight,
  which is the safest possible addition.
- **Adding a failable primary to any of the three (§8 O-C) invalidates all six
  lines** and needs the full ladder re-run, both plan and control.

---

## 4. Umm Zeitoun — the map

**New content asset. `data/maps/umm_zeitoun.json` — MISSING.** Gate
`pnpm validate:data`; pipeline: hand-authored JSON, owner `mission-author`.

Everything below was **drafted and then driven through the real `Sim` and
`FlowField` this session** — `parseMap` accepts it (which is what checks the two
grid dimensions and every marker and zone bound), and every sight and route figure
in §4.4 and §4.5 is a measurement, not a drawing. The method, and its one caveat,
are in the Appendix. **It is a draft**: `mission-author` should lift it, and
`level-scripter` should treat §4.4 as the test file that must exist *before* any
mission is authored on it.

### 4.1 What makes it different from Tel Marum

| | **Tel Marum** | **Umm Zeitoun** |
|---|---|---|
| shape | a pass: one axis, a rock wall, two saddles | a basin: no wall across it, no gate, crossable everywhere |
| the puzzle | **force a gap** | **choose which hill to pay for** |
| what prices the ground | the Kornet pockets covering the wide saddle; a boulder field that shuts armour out of the narrow one | being **seen** — and four posts on four hills, each seeing a different piece of the floor |
| the enemy's eyes | two spotters, one of which is measured to buy almost nothing | four posts *plus two MANPAD teams*, and the MANPADs are the longest ground sight Sarim owns (12) |
| the drone | free — nothing on the map can touch it | priced. Two `manpad_team` (missile 13, air-only) cover the two posts worth the most |
| dead ground | the hollow, out of the battery's range **and** unobservable | the staging bowl behind the watershed rim, **measured unobservable from every enemy position on the map** |
| the domain split | one corridor, infantry-only | the two horns are the **same distance** and different domains: west is infantry-only, east is armour-capable and bare |

### 4.2 The character grid — 48×48, `terrain: "arid"`

```
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
^^............................................^^
^^............n...............................^^
^^..........nnnnn...^^........................^^
^^.........nnnnnnn..^^.......www.###..........^^
^^.........nnnnnnn..^^.......www.###..........^^
^^........nnnnn##nn.^^.......www..............^^
^^.........nnnnnnn..^^...........ss...........^^
^^.........nnnnnnn..^^..rrrrrrrrr.............^^
^^.........^^^^^^^......r.....................^^
^^..........^^^^^.......r.....................^^
^^....1.................r...2..1..............^^
^^................n.....r...............2.....^^
^^......1........nnn....r.....1..1............^^
^^..............nnnnn...r.....n...............^^
^^.....1..1......nnn....r....nnn1.............^^
^^................n2..1.r...nnnnn.............^^
^^.......bbb............r....nnn..1...........^^
^^.....bbbbbbb.......1..r.....n...............^^
^^....bbb^^bbbbrrrrrrrrrrrrrrrrrrrrrrrrrr.....^^
^^....bb^^nbbbb........1r............n........^^
^^...bb^^nnnbbbb........r..........1nnn.......^^
^^...bb^nnnnnbbb......2.r1.........nnnnn......^^
^^...bbbbnnnbbbb...hhhssr.hh........nnn.......^^
^^....bbbbnbbbb....hhh..r.hh.........n........^^
^^....bbbbbbbbb.........r...........2..1......^^
^^.....bbbbbbb.....ss...r.hh.1................^^
^^.......bbb.2..1..ss...r.hh..........2..1....^^
^^....1............ooo..r...1.................^^
^^.............2..ooooonr...............1.....^^
^^......n.......dddddddddddddddd........n.....^^
^^.....nnn....o..1..onnnrn.............nnn....^^
^^....nnnnn.ooooo...nssnrnn..2..1.....nnnnn...^^
^^.....nnn..oo1oo..1.nnnrn.....n.......nnn....^^
^^....2.n1.oo111oo...nnnrn....nnn.1.....n.....^^
^^..........oo1oo.2..1.nr....nnnnn............^^
^^......1..1ooo111111111r111111111............^^
^^............o111111111r11111111.............^^
^^....111111111111111111r11111111111111111....^^
^^......n.n..n.n..n.n..nrn..n.n..n.n..n.n.....^^
^^......2...2...2...2...r...2...2...2...2.....^^
^^......................r.....................^^
^^......................r.....................^^
^^......................r.....................^^
^^......................r.....................^^
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Symbols used, all legal under `data/schemas/map.schema.json` and all cross-checked
against `data/structures.json`, counted from the grid above: `.` 1396 · `^` 399 ·
`n` 160 · `1` 104 · `r` 69 · `b` 69 · `o` 31 · `2` 19 · `d` 16 · `h` 14 · `s` 10 ·
`w` 9 · `#` 8. No `3` — cover 2 and cover 3 are not separable in a duel
(`tools/src/qarn_hadid_relief.test.ts`), so a third tier would be decoration.

### 4.3 The elevation grid — same dimensions, digits 0–7

```
222222222222222222222222222222222222222222222222
222222222222222222222222222222222222222222222222
222222222222333332222222222222222222222222222222
222222222223344433222222222222222222222222222222
222222222233444443322222222222222222222222222222
222222222334555554332222222222222222222222222222
222222222344566654432222222222222222222222222222
222222222344567654432222222222222222222222222222
111111111344566654431111111111111111111111111111
111111111334555554331111111111111111111111111111
111111111233444443321111111111111111111111111111
111111111123344433211111111111111111111111111111
000000000002333332000000000000000000000000000000
000000000000002011111000000000000000000000000000
000000000000000011211000000000000000000000000000
000000000000000012221000000011111000000000000000
000000000000000011211000000011211000000000000000
000000000000000011111000000012221000000000000000
000000001111100000000000000011211001111100000000
000000011222110000000000000011111011222110000000
000000112222211000000000000000000112222211000000
000001123333321100000000000000001123333321100000
000001223444322100000000000000001223444322100000
000001223454322100000000000000001223454322100000
000001223444322100000000000000001223444322100000
000001123333321100000000000000001123333321100000
000000112222211000000000000000000112222211000000
000000011222110000000000000000000011222110000000
000000001111100000000000000000000001111100000000
000000000000000000000011100000000000000000000000
000000000000000000000111110000000000000000000000
000000111110000000001122211000000000001111100000
000000112110000000011222221100000000001121100000
000000122210000000011223221100000000001222100000
000000112110000000011222221101111100001121100000
000000111110000000001122211001121100001111100000
000000000000000000000111110001222100000000000000
000000000000000000000011100001121100000000000000
000000000000000000000000000001111100000000000000
222222222222222222222222222222222222222222222222
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
333333333333333333333333333333333333333333333333
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
```

Range 0–7, above the 0–4 the schema calls the practical band and matching
`qarn_hadid`'s 0–7 — justified by the crest, which has to see over the two horns
and be worth a mission to climb. Two things about it are load-bearing:

- **The watershed rim is elevation 4 at y=40–41 with the staging bowl at 1
  behind it.** That two-and-a-half level lip is the whole reason the bowl is dead
  ground (§4.4), and it is exactly the Tel Marum lesson: a lip one level shallower
  would look identical in the JSON and hide nothing, because `EYE_HEIGHT` is 1.
- **The basin floor is 0 and the four peaks rise to 3 / 5 / 5 / 7.** Slope is
  priced by `FlowField` at `UPHILL_PER_LEVEL` per level climbed and descent is
  free, so every hill on this map is expensive to attack and cheap to leave —
  which is the doctrine, not decoration.

### 4.4 Markers, zones, and the sight claims — **stated as assertions, and measured**

**Markers** (25), every one verified this session to sit on a passable tile:

```json
"markers": {
  "kdf_start": [24,45], "camp_ground": [21,44], "rim_crest": [24,41],
  "civ_refuge": [23,37], "uz_wells": [14,35], "knoll_stone": [23,33],
  "hamlet_square": [24,26], "lane_west": [14,28], "lane_centre": [24,20],
  "lane_east": [33,27], "horn_west": [10,23], "horn_east": [37,23],
  "crest": [14,7], "crest_reverse": [13,4], "stockpile_yard": [32,7],
  "battery_south": [30,30], "battery_north": [27,13], "battery_west": [12,17],
  "north_gate": [19,10], "civ_north": [27,3],
  "manpad_north": [20,12], "manpad_basin": [30,22],
  "sarim_north": [24,3], "sarim_east": [45,12], "sarim_west": [3,12]
}
```

**Zones** (11), with their contents audited:

```json
"zones": {
  "staging": [18,43,12,3], "crest_line": [18,40,13,2], "refuge_wadi": [21,36,5,3],
  "post_stone": [21,32,4,3], "hamlet": [19,24,9,5], "basin_floor": [8,18,32,16],
  "horn_west": [8,21,5,5], "horn_east": [35,21,5,5], "crest_top": [12,5,5,5],
  "stockpile": [29,5,7,5], "north_shelf": [25,2,5,3]
}
```

- `staging` — 33 open + 3 road, every tile passable. Contains `kdf_start` and `camp_ground`.
- `crest_line` — 16 open, 6 knoll, 2 road, 2 cover-2. The ground II must hold.
- `refuge_wadi` — contains `civ_refuge [23,37]`. **The runtime throws if the refuge marker is outside the arrival zone**, so this pairing is not optional.
- `north_shelf` — contains `civ_north [27,3]`, the northern refuge for IV's porters.
- `post_stone` — **exactly two `s` tiles**, one contiguous shanty, plus knoll and road. A well-formed `raze` zone: no `low_profile`, no `per_tile`, no protected structure, which is what `tools/validate_data.mjs` checks.
- `stockpile` — **three structures**: `w` ×9 (warehouse, 340 hp/tile), `#` ×6 (concrete, 700), `s` ×2 (shanty, 120). 7,500 hp total. Also well-formed for `raze`.
- `crest_top` — two `#` tiles, one concrete structure: Adhal's relay hut. An optional secondary `raze` for IV.
- `hamlet` — 14 `h`, 6 `s`, 5 road, 20 open. **The flagged zone**, never a raze target.
- `basin_floor` — a `zone_entered` trigger region only; it contains rock, structures and the ditch and must never be a `capture` or `hold_for` target.

#### The assertions a test must pin, before a mission is authored

Written in the idiom of `tools/src/tel_marum_doctrine.test.ts`: **every negative
paired with a positive on the same geometry**, and every claim stated twice where
the two registers differ — as a **terrain fact** (a 48-sight `OBSERVER`: "nothing
solid blocks this ray") and as a **roster fact** (the unit actually posted there).
Confusing those two is what made `tm_spotter_narrow` a decorative eye.

**A. The staging bowl is dead ground, and the rim crest is not.** *Measured, all
seven, terrain fact:*

| from | `staging [24,44]` | `camp_ground [21,44]` | `rim_crest [24,41]` |
|---|---|---|---|
| `crest [14,7]` | **blind** | **blind** | SEES |
| `horn_west [10,23]` | **blind** | **blind** | SEES |
| `horn_east [37,23]` | **blind** | **blind** | SEES |
| `knoll_stone [23,33]` | **blind** | **blind** | SEES |
| `manpad_north [20,12]` | **blind** | **blind** | SEES |
| `manpad_basin [30,22]` | **blind** | **blind** | SEES |
| `battery_south [30,30]` | **blind** | **blind** | SEES |

This is the map's spine, and it says the thing the act is about: **the ground you
can hide in is worth nothing, and the ground you must hold is the ground that can
be seen.** The bowl is *inside* the battery's 20-tile envelope from
`battery_south` (15.2) — it is safe only because nobody can see into it.

**B. Each post watches its own lane and no post watches them all.** *Measured,
roster fact,* `sarim_rifles` sight 9:

| post | sees | does not |
|---|---|---|
| `horn_west` | `lane_west` **6.4 SEES** | `lane_east` (27.0, out of sight) |
| `horn_east` | `lane_east` **5.7 SEES** | `lane_west` (23.5, out of sight) |
| `knoll_stone` | `rim_crest` **8.1 SEES**, `hamlet_square` **7.1 SEES**, `civ_refuge` **4.0 SEES** | `uz_wells` 9.2 **blind** |
| `crest` | `north_gate` **5.8 SEES**, `crest_reverse` **3.2 SEES** | `stockpile_yard` 18.0 **blind** |

The crest is a **relay, not a spotter**: at sight 9 its post watches only the two
ways up to itself. That is deliberate and it must be *written* that way, or it
becomes the Tel Marum mistake.

**C. The MANPAD teams are Sarim's real spotters.** `manpad_team` has **sight 12**,
the longest standing eye in the roster, and identification is per-side — so an AA
team feeds the battery exactly as a rifleman does. *Measured, roster fact:*

| team | sees | does not |
|---|---|---|
| `manpad_north [20,12]` | `north_gate` **2.2**, `lane_centre` **8.9** | `crest` 7.8 **blind** (its own rock collar), `stockpile_yard` 13.0 blind |
| `manpad_basin [30,22]` | `lane_east` **5.8**, `lane_centre` **6.3**, `horn_east` **7.1** | `hamlet_square` 7.2 **blind** (the houses) |

**There is therefore no free lane.** `lane_centre [24,20]` is outside every rifle
post's sight 9 — and both MANPADs see it. Killing them blinds the centre *and*
frees the drone, which is one decision doing two jobs.

**D. The hamlet is a warren, not an observation post.** *Measured:* an observer on
open ground **inside** the hamlet at `[22,26]` is **blind** to `hamlet_square`
(2.0), `civ_refuge` (11.0), `lane_west` (8.2) and `rim_crest` (15.1) — the houses
block his own sight — and sees only `knoll_stone` (7.1). Consequence for the
author: **you cannot solve the hamlet from outside and the men in it cannot fight
you from range.** Clearing it is a walk-in job, which is exactly the ROE shape
Act I built at the clinic block.

**E. A drone's look is priced, and the price is a table.** *Measured,*
`recon_drone` sight 16, MANPAD missile range 13:

| station | posts identified | inside a MANPAD envelope? |
|---|---|---|
| `[24,41]` rim crest | `knoll_stone` only | no (29.3 / 19.9) |
| `[14,30]` west flank | `horn_west` only | **no** (19.0 / 17.9) |
| `[24,30]` mid-basin | `horn_west`, `horn_east`, `knoll_stone` | **yes** — `manpad_basin` 10.0 |
| `[18,16]` north-west | `crest`, `horn_west` | **yes** — `manpad_north` 4.5 |
| `[24,16]` north axis | `crest`, `horn_west`, `horn_east` | **yes** — both, 5.7 / 8.5 |

One post is free, two are cheap-and-covered, and **the crest cannot be bought
without entering an envelope.** That is Umm Zeitoun I's whole decision, and it is
a measurement rather than an intention.

**F. The sniper is the answer to the observer, and the campaign already gates
it.** `sniper_team`: sight **16**, `amr` range **15**, `collateral_risk` **0.05** —
the one KDF weapon that cannot break ROE. *Measured, from open ground:*

| target | from | distance | result |
|---|---|---|---|
| `crest` | `[19,13]` | 7.8 | **SEES**, AMR reaches |
| `horn_west` | `[22,20]` lateral road | 12.4 | **SEES**, AMR reaches |
| `horn_west` | `[22,30]` axis | 13.9 | **SEES**, AMR reaches |
| `horn_east` | `[26,20]` | 11.4 | **SEES**, AMR reaches |
| `horn_east` | `[26,30]` | 13.0 | **SEES**, AMR reaches |
| `knoll_stone` | `[24,41]` rim crest | 8.1 | **SEES**, AMR reaches |

Every horn dies from **11–14 tiles**, outside `sarim_rifles`' 9-tile sight and
8-tile rifle. `sniper_team` unlocks at **`roe_rating_min: 60`**. So restraint in
Act I literally buys the tool that wins Act II — the campaign's thesis as a
mechanic, and it costs nothing to build because both halves already ship.

**G. The KDF mortar is the player's own Grad, and it needs the player's own
eyes.** `mortar_team` range 18, sight 7. *Measured:* from the wadi `[24,37]` the
knoll post is at 4.1 and **cannot see the tube**; from mid-basin `[24,28]`,
`horn_west` is 14.9 and `horn_east` 13.9, both blind to the tube; from
`lane_centre` the crest is 16.4, blind to the tube. **The mirror is exact**: the
player's tube outranges its own sight and fires on what his drone found. `mortar_60`
carries `collateral_risk: 0.7`, so the same tube is the mission's ROE bait the
moment it fires near the hamlet.

### 4.5 Routes, per domain — **measured through the real `FlowField`, slope priced**

| leg | foot | vehicle |
|---|---|---|
| `kdf_start` → `rim_crest` | 4 | 4 |
| `rim_crest` → `knoll_stone` | 8 | 8 |
| `rim_crest` → `hamlet_square` | **15** | **19** — the ditch costs armour +4 |
| `rim_crest` → `horn_west` summit | **18** | **null — no route at all** |
| `rim_crest` → `horn_east` summit | **18** | **18** |
| `rim_crest` → `lane_centre` | 21 | 22 |
| `lane_centre` → `stockpile_yard` | 13 | 13 |
| `lane_centre` → `crest` | 16 | 16 |
| `hamlet_square` → `civ_refuge` | 11 | 19 |
| `uz_wells` → `civ_refuge` | 9 | 9 |
| `kdf_start` → `stockpile_yard` | **38** | **38** |

Three of those are the design:

- **The two horns are the same distance and different domains.** 18 tiles each.
  West is ringed by a scree apron (`b`, 69 tiles) and is **infantry-only,
  measured null for armour**; east is a bare open glacis rising 0→5 with nothing
  but its knoll cap, so armour drives up and is visible the whole way. Same
  objective, two prices, and the player picks which one he can afford.
- **The anti-tank ditch (`d`, 16 tiles at y=31, x=16–31) costs armour four tiles
  to enter the hamlet and costs infantry nothing.** It is not a chokepoint — the
  detours west of x=16 and east of x=31 are both wide open — it is a *tax on
  bringing the autocannon into the flagged block*, which is precisely the decision
  Umm Zeitoun III is about.
- **38 tiles start-to-depot**, the same axis length as Tel Marum's, so the act's
  two towns feel like one distance.

### 4.6 What is deliberately NOT on this map

- **No tunnels.** Sarim doctrine is standoff, not the Marj's spade. `tunnels` is absent.
- **No chokepoint across the basin.** The `^` frame is a boundary, not a wall; between y=12 and y=39 there is no rock line the player must pass through. This is the one structural difference from Tel Marum and it must survive any edit.
- **No `mosque` tile.** GDD §2, and `storyline.md` O10 is still open.
- **No cover-3.** Measured elsewhere as indistinguishable from cover 2 in a duel.
- **No `civilians` sprite dependency assumed** — see §6.

---

## 5. Umm Zeitoun — the four missions

### 5.0 The ladder

Ledger keys: **R** `roster.surviving_units` · **M** `roe.mission_ratings` ·
**C** `campaign.completed_missions` · **I** `intel.marked_positions` ·
**E** `civ.settlements_evacuated`.

| # | id · name | phase | min | primaries (type · target) | secondaries | ledger req / prod | econ |
|---|---|---|---|---|---|---|---|
| 1 | `umm_zeitoun_1_recon` · **Cold Ground** | recon | 6 | `locate` `uz_eye_crest` · `locate` `uz_eye_west` · `locate` `uz_eye_east` · `locate` `uz_eye_knoll` · **`evacuate_before` `refuge_wadi` ×2 @240 s** | `locate` `uz_manpad_basin` · `survive_until` 240 | R / R M C I **E** | n |
| 2 | `umm_zeitoun_2_buildup` · **The Long Look** | buildup | 7 | `hold_for` `crest_line` 240 s · **`raze` `post_stone` @300 s** | `eliminate_hvt` `uz_eye_knoll` · `capture` `post_stone` 15 s | R I / R M C | **y** |
| 3 | `umm_zeitoun_3_clearance` · **Blinding** | clearance | 7 | `eliminate_hvt` `uz_eye_west` · `eliminate_hvt` `uz_eye_east` · **`evacuate_before` `refuge_wadi` ×4 @300 s** | `locate` `uz_hvt_lantern` · `eliminate_hvt` `uz_eye_knoll` | R I / R M C I **E** | n |
| 4 | `umm_zeitoun_4_clearance` · **The Stockpile** | clearance | 7 | **`raze` `stockpile` @300 s** · `eliminate_hvt` `uz_hvt_lantern` | `eliminate_hvt` `uz_battery` · `evacuate_before` `north_shelf` ×3 @240 s · `raze` `crest_top` | R I / R M C | **y** |

Phases ascend **2 → 4 → 5 → 5**. Foothold is skipped deliberately and it is a
story fact: after Tel Marum the brigade already has its foothold in Sur. Mission 2
is the war's **second** build-up — GDD §4's one phase with breathing room, and the
only one Act II can justify. Every objective type above is one of the **nine the
runtime runs** (`SUPPORTED`, `packages/sim/src/mission.ts`); `mark`, `escort` and
`no_collateral_above` are in the schema, throw at runtime, and are not used.

**The one rule the ladder is built on.** Row by row, the **bold** primary is the
mission's only failable objective — `raze`, `collapse` and `evacuate_before` are
the only three types that can reach `failed`, each on a `seconds` deadline, and
Sarim will not come and wipe you (§3.1). So on this front **the clock is the only
thing that can beat you**, and each mission carries exactly one. They alternate
between people and structures, and no two are the same object: the families at the
wells, the post over the crest line, the hamlet, the depot.

**Economy, and what it is for.** Only 2 and 4, and each for a named reason.

- **2 (build-up):** `logistics_start 500`, `logistics_rate_per_min 150`,
  `intel_start 150`, one `camp` raised by `structures[]` at `camp_ground [21,44]`
  — the only shipped precedent is `beit_sahwan_2_foothold`. Spend it on
  `inf_squad` to hold `crest_line` while the demolition party goes forward: the
  mission's decision is doing both at once and the logistics is what makes both
  possible. `intel_start 150` buys **exactly one satellite sweep** (`SWEEP_COST`
  150) — Idit's "the recon you did not have time to do" — and a second is
  *earned by standing still*, because `recon_drone` accrues 8 Intel/min and every
  **stationary** `inf_squad` accrues 5 (`INTEL_PER_MIN_DRONE` / `_SCOUT`;
  `inf_squad`, `sniper_team`, `recon_drone` and `attack_drone` all carry
  `mark_target`). A build-up that holds ground therefore *pays* in intel, with no
  new schema field at all.
- **4 (clearance):** `logistics_start 600`, `logistics_rate_per_min 100`,
  `intel_start 250` — one **precision strike** (`STRIKE_COST` 250), which is
  attributed to a living caller so the ROE bill lands on the player who ordered
  it. The logistics exists for exactly one purpose: **`demo_squad` costs 300, and
  `demo_squad` is the only unit in this act that can raze anything** (`demolish`
  is declared by `demo_squad` and `dozer_d9` alone). Lose them all and the primary
  becomes impossible — which is why it has a deadline, and why the mission is
  *lost* rather than stuck.
- **1 and 3 have none and must not gain one.** A recon is not a phase about
  spending, and a clearance on this map is about what you brought.

**What the force is, and the one hole.** `starting_force` **never consults a
unit's `unlock` gate** (`spawnPlacement` has no equivalent of `requestBuild`'s
`buildBlockedReason`) — a known hole every shipped mission already relies on. What
a campaign arriving here plausibly holds is not in doubt: Act I's and Tel Marum's
plans measured ROE **75 / 100 / 100 / 94 / 98 / 100 / 100 / 100** this session, a
mean of ~96, well past every threshold. So `demo_squad` (50), `mbt_lavi` (55),
`ifv_namer` (40), `recon_drone` (35) and **`sniper_team` (60)** are all honestly
earned on the intended path. **`dozer_d9` is not fielded**, and the reason is
authorial rather than the gate: Sur has no dozer, the depot comes down under
charges, and *what to bring* is the last mission's question. `heli_peten` stays
fielded by nothing, as it is today.

---

### 5.1 Umm Zeitoun I — `umm_zeitoun_1_recon` · *Cold Ground* · recon · **6 min**

| | |
|---|---|
| **player start** | `player_start [24,45]`. `recon_drone` ×1 `[24,43]`; `jeep_shoded` ×1 `[22,44]`; `inf_squad` ×3 `[24,45]` **from_ledger**; `at_team` ×1 `[26,45]` **from_ledger**; `apc_eitan` ×1 `[22,45]`. No resources. Mirrors `tel_marum_1_recon`'s shape exactly, which is the point: the same patrol, deeper ground |
| **civilians** | `refuge: "civ_refuge"`; one group, `civilians ×3` at `[14.5,35.5]`, **`group: "wells_families"`**. Nine tiles from the refuge on foot, and the refuge is inside `refuge_wadi` — the runtime throws otherwise |
| **enemy — the net, all `hold_position` unless stated** | `uz_eye_crest` `sarim_rifles` ×1 `[14.5,7.5]` · `uz_eye_west` ×1 `[10.5,23.5]` · `uz_eye_east` ×1 `[37.5,23.5]` · `uz_eye_knoll` ×1 `[23.5,33.5]`, `stance garrison building [21,33]` · `uz_manpad_north` `manpad_team` ×1 `[20.5,12.5]` · `uz_manpad_basin` `manpad_team` ×1 `[30.5,22.5]` · `uz_atgm_glacis` `atgm_cell` ×1 `[34.5,20.5]` `stance ambush(10)` · `uz_battery` `rocket_battery` ×1 `marker battery_south`, `group battery` |
| **waves** | 150 s `sarim_rifles` ×1 from `sarim_west` → `uz_wells`; 260 s `sarim_rifles` ×2 from `sarim_north` → `lane_centre`. Light on purpose — this is a patrol's pursuit, not a battle, and Tel Marum I measured what happens when you try to make a recon losable by volume instead: 24 attackers stalls, 28 is a stand-up fight |
| **triggers** | `they_move_the_families_off` — `on: timer_s 242` → `do: {kind:"remove", group:"wells_families"}`, `say: {speaker:"idit", …}`. Fires **two seconds after** the objective's own 240 s deadline, the same ordering Act I uses at First Light: `stepTriggers` runs before `stepObjectives`, and two seconds costs nothing and makes the order not load-bearing |
| **the decision** | **which look you can afford.** Measured (§4.4 E): from the rim crest the drone sees only the near knoll; from `[14,30]` on the west flank it buys `uz_eye_west` and is outside both MANPAD envelopes; from `[24,30]` mid-basin it buys three posts at once and sits 10.0 from `manpad_basin`; **the crest cannot be identified from anywhere outside a MANPAD's 13 tiles.** So the player chooses: three cheap posts and a dead drone, or one free post and a long night on foot. And the jeep that would screen the drone is the only carrier that can reach the wells |
| **why it matters later** | `intel.marked_positions` accumulates **by tag**, and the tag joins the ledger the moment **any one** body of that placement is identified. Four separate tags therefore give **real partial credit**: identify two posts and two are pre-identified in III, where a tagged garrison **spawns pre-identified and forfeits its ambush**. `uz_atgm_glacis` is in `ambush(10)` in every later mission carrying the same tag — **a thorough recon disarms the Kornet on the east glacis before the clearance starts; a rushed one walks a Namer into it at ten tiles** |
| **ROE** | `enabled` only. No flagged zone, no `fail_below`. The temptation is answering the pursuit waves with the Eitan's `rws_50` beside the families — `rws_50` is `collateral_risk` 0.25, below the 0.3 structural threshold and the 0.5 danger-close one, so it costs nothing, and that is the correct lesson to teach here rather than a punishment |
| **loss condition (for `playtest`)** | **`evacuate_before(refuge_wadi, count 2, seconds 240)` fails.** A passive player never comes within 4 tiles of the families, so `CivilianFlight` never orders them out (`SHEPHERD_RADIUS_SQ`, 4 tiles; the only other trigger is suppression above 0.3, and a passive run generates no fire near them). The count can never be met, the primary reaches `failed`, and `checkEnd` loses. **This is the whole reason the objective is a primary** |
| **twist candidates** | **T-U1 "They were gone before you got there."** The `remove` at 242 s, with Idit's line. *Expressible today* — `remove` landed 2026-09-03. **T-U2 "The fourth hill is not a hill."** `uz_eye_crest` is identified and the contact decays to unknown within the mission, because nothing holds a sight line on it — `revealAt` is explicitly not exempt from decay. *Expressible today; it needs measuring, not building.* **T-U3 "The drone is the mission."** Losing the `recon_drone` costs nothing this mission and everything in III. *Live — it is the ledger, said out loud* |
| **story hooks** | The `dispatch` is the act's, not this mission's: the settlement, the morning, the week. Idit's question here is not *what is on that ground* but *who is looking at us*, and the answer is that she can only afford three of four. `say` on each `locate`, speaker **idit**, one line each and short. `say_on_fail` on the evacuation, speaker **shai** — the only line in the mission that is not a report |

---

### 5.2 Umm Zeitoun II — `umm_zeitoun_2_buildup` · *The Long Look* · buildup · **7 min**

| | |
|---|---|
| **player start** | `inf_squad` ×3 and `at_team` ×1 **from_ledger** at `[24,45]`/`[26,45]`; `apc_eitan` ×2 `[22,45]`; `mbt_lavi` ×1 `[26,44]`; `mortar_team` ×1 `[23,45]` (note `[24,46]` is frame rock — the `^` border runs two tiles deep on every edge); `demo_squad` ×1 `[21,45]`; `recon_drone` ×1 `[24,43]`. `structures`: one `camp` at `camp_ground [21,44]`, inside `staging`, **measured unobservable from every enemy position** |
| **resources** | `logistics_start 500`, `logistics_rate_per_min 150`, `intel_start 150`, `supply_corridor true` |
| **enemy** | the net minus the crest (this fight is southern): `uz_eye_knoll` `sarim_rifles` ×1 `[23.5,33.5]` `stance garrison building [21,33]`, `group knoll` · `uz_eye_west` ×1 `[10.5,23.5]` · `uz_eye_east` ×1 `[37.5,23.5]` · `uz_manpad_basin` `manpad_team` ×1 `[30.5,22.5]` · `uz_rcl_south` `recoilless_team` ×1 `[27.5,32.5]` `stance ambush(6)` · `uz_battery` `rocket_battery` ×1 `marker battery_south`, `group battery` |
| **waves** | 90 s `sarim_rifles` ×2 from `sarim_west` → `knoll_stone`; 180 s `recoilless_team` ×1 from `sarim_north` → `rim_crest`; 210 s `loiter_drone` ×1 from `sarim_north` → `camp_ground` — a kamikaze hunting the camp, which is the one thing a build-up cannot replace; 300 s `sarim_rifles` ×2 from `sarim_east` → `crest_line` |
| **triggers** | `the_tube_moves_north` — `on: casualties_pct 30` → `do: {kind:"withdraw_to", group:"battery", to:"battery_north"}`, plus `say` (**net**). This is the mission's reward made mechanical: **from `battery_south` the Grad reaches `rim_crest` at 12.5; from `battery_north` it is 28.2 and out of range entirely.** Killing a third of the garrison ends the shelling of the ground you are holding |
| **the decision** | **rush the knoll, or endure the hold.** `hold_for(crest_line, 240)` is cumulative, and the crest line is elevation 4 — the highest ground on the southern half and, measured, **seen by `uz_eye_knoll` at 8.1** while `battery_south` reaches it at 12.5. So the ground the mission requires you to stand on is the one piece of ground the enemy can both see and shell. The post is 8 tiles away, on a knoll that costs a climb; taking it early thins the hold and stops the clock's cost; taking it late means four minutes under rockets. The economy is what lets a good player do both — 500 + 150/min buys three more rifle squads, and holding still with them **earns Intel** |
| **the raze** | `raze(post_stone, seconds 300)`. The zone holds exactly one shanty (two tiles, 240 hp). Two paths, both live: `demo_squad`'s `demolish` order (5 s of charges once inside 2 tiles) or ordinary fire, because the observer **garrisons the shed** and the automatic structure-fire path needs a hostile inside it. Killing the man and levelling the post are therefore *related but separate* acts, and the objective is the second one: he cannot be replaced on a heap of blocks |
| **ROE** | `enabled`, no flagged zone, **no `fail_below`.** The build-up is the mission where the player learns that `mortar_60` (`collateral_risk` 0.7) reaches the knoll post from the wadi at 4.1 tiles **from ground the post cannot see** — and there are no civilians in front of it, so the lesson is free here and expensive in III |
| **loss condition (for `playtest`)** | **`raze(post_stone)` fails at 300 s.** A passive player never orders a demolition and never fires, so the shed stands. `hold_for` cannot fail; `capture` cannot fail; the force is never wiped. The raze deadline is the whole loss condition and it must not be removed or lengthened past 300 |
| **twist candidates** | **T-U4 "The camp is the target."** The `loiter_drone` at 210 s goes for `camp_ground`, not for the line — a build-up loses by losing what it is building. *Expressible today.* **T-U5 "He watched you dig it."** The knoll post's own field of view is measured to include the crest line and **exclude** the staging bowl, so the enemy knows what you are building and not where — a `say` line, not a mechanic. *Live.* **T-U6 "They come back for the hill."** The 300 s wave from `sarim_east` retakes the razed post's ground. *Expressible today*, and it argues for `capture(post_stone, 15)` staying a secondary rather than becoming a primary |
| **story hooks** | The one mission in Act II with breathing room, and it should feel like it: engineers, a camp, a supply corridor, and a man on a hill eight tiles away watching all of it. Shai's beat is the arithmetic of a hold; Idit's is that the shelling has a source and the source has a name now. `say` on `hold_the_line`, speaker **net**; `say` on the `withdraw_to` trigger, speaker **idit** — *the tube has moved, and that is what killing his eyes buys* |

---

### 5.3 Umm Zeitoun III — `umm_zeitoun_3_clearance` · *Blinding* · clearance · **7 min**

| | |
|---|---|
| **player start** | `inf_squad` ×3, `at_team` ×1, `mortar_team` ×1 **from_ledger**; `mbt_lavi` ×1 `[26,44]`; `ifv_namer` ×1 `[20,44]`; `apc_eitan` ×2 `[22,45]`; **`sniper_team` ×1 `[24,44]`**; `recon_drone` ×1 `[24,43]`. No resources — a clearance is about what you brought |
| **why the sniper is here** | Measured (§4.4 F): `sniper_team` sees and reaches **every** post from 8–14 tiles, outside `sarim_rifles`' 9-tile sight and 8-tile rifle, with `amr` at `collateral_risk` **0.05** — the one KDF weapon that cannot break ROE at all. It unlocks at `roe_rating_min: 60`. **Act II's answer to the observer is a better observer, and Act I's restraint is what bought him.** That sentence is the campaign's thesis and it needs no engine work to be true |
| **civilians** | `refuge: "civ_refuge"`; `civilians ×6` in two groups inside `hamlet`, at `[22.5,26.5]` ×3 `group hamlet_north` and `[21.5,28.5]` ×3 `group hamlet_south`. Eleven tiles to the refuge on foot |
| **enemy** | `uz_eye_west` `sarim_rifles` ×1 `[10.5,23.5]` · `uz_eye_east` ×1 `[37.5,23.5]` · `uz_eye_knoll` ×1 `[23.5,33.5]` (re-posted on the bare knoll; the shed is rubble) · `uz_manpad_basin` `manpad_team` ×1 `[30.5,22.5]` · `uz_atgm_glacis` `atgm_cell` ×1 `[34.5,20.5]` `ambush(10)` · `uz_atgm_lateral` `atgm_cell` ×1 `[17.5,19.5]` `ambush(10)` · **in the hamlet**: `sarim_rifles` ×2 `stance garrison building [20,24]` and `[26,27]`, `recoilless_team` ×1 `[25.5,27.5]` `ambush(6)` · `uz_hvt_lantern` `sarim_rifles` ×1 `[13.5,6.5]`, `group lantern` — **seen, not reachable** · `uz_battery` `rocket_battery` ×1 `marker battery_west`, `group battery` |
| **waves** | 120 s `sarim_rifles` ×2 from `sarim_west` → `horn_west`; 240 s `recoilless_team` ×1 from `sarim_east` → `horn_east`; 330 s `sarim_rifles` ×2 from `sarim_north` → `hamlet_square` |
| **triggers** | `he_shells_his_own_village` — `on: casualties_pct 35` → `do: {kind:"withdraw_to", group:"battery", to:"battery_south"}`, `say` (**enemy** or **idit**). **This is the mission.** From `battery_west` the Grad reaches the hamlet at 15.0 and the refugees' road at 22.8 — *out of range*. From `battery_south` it reaches the hamlet at 7.2 and **`civ_refuge` at 9.9**. So pressing the fight **brings his fire onto the road his own people are walking down** |
| **the decision — three of them, stacked** | **(a) Which horn first.** Measured identical at **18 tiles** from the rim crest and mechanically opposite: `horn_west` is **no route at all for armour** (a scree apron, `b`), so it is an infantry job with a climb; `horn_east` is armour-capable over a bare glacis rising 0→5 with an `atgm_cell` in `ambush(10)` on it. Same objective, two prices, and the player owns exactly one force. **(b) Whether to kill the knoll observer.** He is not a primary. He is the only eye that sees `hamlet_square` (7.1) *and* `civ_refuge` (4.0), so while he lives the battery can be handed the evacuation route the moment it displaces. **(c) How to clear the hamlet.** The ditch (`d`, y=31, x=16–31) costs armour **+4 tiles** to enter it and infantry nothing |
| **ROE — the act's bait, and it is Adhal's** | `flagged_zones: ["hamlet"]`, `fail_below: 45`. Measured (§4.4 D): a man standing inside the hamlet is **blind in every direction** — the houses block his own sight — so **you cannot solve the hamlet from outside and the men in it cannot fight you from range.** The lazy answer is to shell it, and the arithmetic is Beit Sahwan III's transposed: `nearMiss` inside a flagged zone deducts 5 per incident when the weapon's `collateral_risk` ≥ **0.3**, which arms `cannon_30` (0.35), `gun_120` (0.55), `mortar_60` (0.70) and `charges` (0.60), and does **not** arm `rifles` (0.10), `coax_mg` (0.20), `rws_50` (0.25) or `amr` (0.05). `at_team`'s `spike_atgm` is **0.30 exactly**, sitting on the threshold in Q16.16 — `level-scripter` should measure which side it lands on rather than assume, because the answer decides whether the AT team may fire into the block. The block is takeable with rifles, the Eitan's remote gun and a sniper, and it is not takeable with autocannon inside a 45-point floor |
| **and the half the player is not billed for** | `stepRoe` deducts for a dead civilian **only when `by` is a player unit** (`mission.ts`: `if (e.by >= 0 && st.side[e.by] === 0)`), and for a destroyed structure only the same way. So when the Grad kills the hamlet's people **the score does not move and the mission is lost anyway**, because the `evacuate_before` count becomes unreachable. That is `storyline.md`'s **T8** — *"the penalty is on the player, always"* — delivered with **zero engine work**, by placement rather than by a scripted impact |
| **loss condition (for `playtest`)** | **`evacuate_before(refuge_wadi, count 4, seconds 300)` fails.** Passive: nobody comes within 4 tiles of the hamlet, nothing flees, the count stays 0. Both `eliminate_hvt` primaries can only stay incomplete |
| **twist candidates** | **T8-U "The battery fires into its own town."** The displacement trigger above. *Expressible today* — placement plus `withdraw_to`, no sim work; the engine version (choosing where an enemy round lands) stays §7 G13. **T-U7 "The eye you left alive."** `uz_eye_knoll` survives II as a secondary and is the reason the refugees are shelled in III. *Expressible today.* **T-U8 "He is on the hill you cannot reach."** `locate(uz_hvt_lantern)` completes — the crest is 34 tiles from the start line — and nothing follows. *Live; it is a `locate` and a `say`.* **T-U9 "The house was the section."** A `garrison` in the hamlet that `dismount`s into the street on `zone_entered(hamlet)`. *Expressible today* — `dismount` is a live `do.kind` |
| **story hooks** | Idit finds him for the first time and cannot do anything with it. Shai's half is the hamlet: the same passage as Beit Sahwan III's clinic block, in a different register, because this time **the man calling the fire onto it is not in it.** `say` on `locate(uz_hvt_lantern)`, speaker **idit**. `say_on_fail` on the evacuation, speaker **shai** — and it must not be a sermon; Act I's ceiling holds |

---

### 5.4 Umm Zeitoun IV — `umm_zeitoun_4_clearance` · *The Stockpile* · clearance · **7 min**

| | |
|---|---|
| **player start** | `inf_squad` ×3, `at_team` ×1, `mortar_team` ×1, `sniper_team` ×1 **from_ledger**; `mbt_lavi` ×2 `[26,44]`; `ifv_namer` ×1 `[20,44]`; `apc_eitan` ×2 `[22,45]`; **`demo_squad` ×2 `[21,45]`**; `recon_drone` ×1 `[24,43]` |
| **resources** | `logistics_start 600`, `logistics_rate_per_min 100`, `intel_start 250`, `supply_corridor true` |
| **civilians** | `refuge: "civ_north"`; `civilians ×4` at `[31.5,8.5]`, `group porters`. They run **north, into their own ground**, five tiles to `north_shelf` — the KDF is not taking them anywhere, it is getting them off a target |
| **enemy** | `uz_hvt_lantern` `sarim_rifles` ×1 `[13.5,6.5]`, `group lantern`, **tag `uz_hvt_lantern`** · `uz_lantern_guard` `sarim_rifles` ×1 `[15.5,5.5]`, `group lantern` · `uz_eye_crest` ×1 `[14.5,7.5]` · `uz_eye_depot` ×1 `[31.5,12.5]` — measured to see `stockpile_yard` at **5.1**, which is what lets the battery shell the demolition party · `uz_manpad_north` `manpad_team` ×1 `[20.5,12.5]` · `uz_rcl_depot` `recoilless_team` ×1 `[33.5,10.5]` `ambush(6)` · `uz_atgm_north` `atgm_cell` ×1 `[27.5,10.5]` `ambush(10)` · **`sarim_rifles` ×1 `stance garrison building [30,6]`** inside the warehouse — a hostile inside a structure is what lets ordinary fire damage it, so the raze has a second path · `uz_battery` `rocket_battery` ×1 `marker battery_north`, `group battery`, **tag `uz_battery`** |
| **waves** | 150 s `sarim_rifles` ×2 from `sarim_north` → `stockpile_yard`; 260 s `recoilless_team` ×1 + `sarim_rifles` ×1 from `sarim_west` → `crest`; 360 s `loiter_drone` ×1 from `sarim_north` → `stockpile_yard` |
| **triggers** | `the_tube_goes_west` — `on: casualties_pct 40` → `withdraw_to group battery to battery_west`, `say` (**net**). Measured trade: from `battery_north` the Grad reaches `stockpile_yard` at 7.8 and `crest` at 14.3; from `battery_west` the depot is 22.4 — **out of range** — and the crest is 10.2. So pressing the fight makes the depot safe to work and the crest harder to take. · `he_goes_over_the_back` — `on: casualties_pct 50` → `withdraw_to group lantern to crest_reverse`, `say` (**enemy**). Adhal moves to the crest's northern shoulder, out of sight of the basin, and a slow player has to climb the whole hill for him |
| **the decision** | **what you brought, and in what order.** There is no dozer. `demolish` is declared by `demo_squad` and `dozer_d9` only, and the stockpile is **three structures, 7,500 hp** (`w` ×9 at 340/tile, `#` ×6 at 700, `s` ×2 at 120), each needing a squad stationary within 2 tiles for 5 s. Two `demo_squad` go in; a third and fourth are buyable at 300 logistics each, which is the entire reason this clearance has an economy. Meanwhile `manpad_team` denies the drone, `recoilless_team` and `atgm_cell` price every vehicle approach, and Adhal is 16 tiles the other way, leaving when pressed. **Split the force and the raze runs out of clock; don't, and he is over the back of the hill** |
| **Adhal's end** | **`eliminate_hvt(uz_hvt_lantern)`**, never `capture`. `storyline.md` §2.3 is right and the reason is doctrinal: an observer's whole practice is not being where you are looking, so taking his ground is not taking him. The `withdraw_to` at 50% is that sentence as a mechanic. **He is `sarim_rifles`, not a special unit** — the same body the player has been killing on hills for two towns, which is the correct final image for a man who is only ever *a pair of eyes* |
| **ROE** | `flagged_zones: ["hamlet"]` retained though the fight is 20 tiles north of it — costs nothing and keeps the score continuous — and **`fail_below: 45`**. The live bait is the porters: `charges` is `collateral_risk` 0.6, above the 0.5 heavy-ordnance threshold, so **a demolition set within 2 tiles of a civilian is "danger close" at −3 an event and killing one is −8**, and `stepDemolition` will level *any* non-protected building a demolisher merely halts beside. The `evacuate_before(north_shelf, ×3, 240 s)` is a **secondary**, so it cannot lose the mission — it is a bill, not a trap |
| **loss condition (for `playtest`)** | **`raze(stockpile, seconds 300)` fails.** A passive player never orders a demolition, so all three structures stand at 300 s. `eliminate_hvt` can only stay incomplete. This is also why the deadline is load-bearing rather than flavour: losing both `demo_squad` makes the primary permanently impossible, and without the deadline the mission would be unwinnable and unlosable at once |
| **twist candidates** | **T-U10 "He does not wait for you."** The 50% `withdraw_to`. *Expressible today.* **T-U11 "The depot is a magazine."** The concrete block detonates when razed and takes the yard with it — `spawnCollapseFx`/`structure_collapse` already exist, but *damage* from a structure's destruction is `COLLAPSE_SHOCK` and is not authorable per structure. *Engine — small; §7 G14.* **T-U12 "The last eye is not on a hill."** `uz_eye_depot` at `[31.5,12.5]` sits on a two-level spur, not a peak, and is the only post the player can reach without a climb — the act's shape breaking on its last mission. *Live; a placement.* **T-U13 "The relay outlives him."** Secondary `raze(crest_top)` on the two `#` tiles of his hut, so the ending is a building coming down rather than a body. *Expressible today* |
| **story hooks** | The `aftermath` is the act's, and it is Idit's: the tubes have stopped and the north is quiet. Shai's promotion is the **act boundary**, not this mission — nothing in the text may promote him. `say` on `eliminate_hvt(uz_hvt_lantern)`, speaker **idit**; `say` on the withdrawal trigger, speaker **enemy** — the one line Adhal gets in the whole campaign, and it should be about *looking*, not about the player |

---

### 5.5 Karim Adhal across Act II, in one table

| where | what he does | mechanism, live today |
|---|---|---|
| **`dispatch`, Tel Marum I** | the atrocity: a week of rockets on one settlement of Kedem's north, one morning, off-map | `dispatch` string (landed 2026-09-03) |
| **Tel Marum I** | his network seen whole: two Kornet pockets, a picket, a bay lip, a spotter and the tube | six tagged placements, shipped |
| **Tel Marum II** | one of his eyes dies and the shelling does not stop | `eliminate_hvt` + the wave clock, shipped; the *saying* is a `say` |
| **Tel Marum III** | his gun dies and he does not; the gun is parked two tiles from a block the player may not shell | `flagged_zones` + `fail_below 45`, shipped |
| **Umm Zeitoun I** | four posts on four hills, and two AA teams that make two of them expensive to look at | placements; measured in §4.4 C and E |
| **Umm Zeitoun II** | one post, eight tiles from the ground the brigade must hold, and a tube that leaves when pressed | `garrison` stance + `casualties_pct → withdraw_to` |
| **Umm Zeitoun III** | he shells the village he is standing in, and the eye that calls it is one the player levelled a mission ago and did not kill | `casualties_pct → withdraw_to` between two battery markers, measured to change what the Grad can reach |
| **Umm Zeitoun IV** | he is on the crest with the relay, and he goes over the back of the hill at 50% | `withdraw_to crest_reverse`; **`eliminate_hvt`** ends him |

**He never speaks until the last mission.** Idit names him; the `dispatch` states
what he did; every other mission characterises him through a placement. That is
the README's *"he speaks through what he does"* taken literally, and it also keeps
`speaker: "enemy"` — the one speaker with no portrait and no voice — down to a
single line in the whole act.

### 5.6 What `playtest` must measure, and in what order

The harness convention is one scripted plan proving VICTORY and one no-orders
control proving DEFEAT. **All four Umm Zeitoun controls must return `defeat`, not
`ongoing`** — that is the point of the failable-primary rule and it is the one
thing about this act that must not be negotiated down to a "bounded fallback".

| mission | control must lose because | plan must prove |
|---|---|---|
| **I** | `evacuate_before(refuge_wadi, 2, 240)` reaches `failed`. Nothing else on the map can end the mission | that four `locate`s and an evacuation fit in 6 minutes with one carrier, and *which* drone stations the plan uses — the plan should take the cheap ones, not the clever ones |
| **II** | `raze(post_stone, 300)` reaches `failed` | that `hold_for(crest_line, 240)` and the raze are both reachable, and **that the hold is genuinely contested** — if the Grad never fires on the crest line the mission is an endurance check and the knoll post is decoration |
| **III** | `evacuate_before(refuge_wadi, 4, 300)` reaches `failed` | that both horns die inside 7 minutes with a force that cannot take the western one in vehicles at all, and that **ROE stays above 45** on a plan that clears the hamlet with rifles. Also run a deliberately careless variant with the Namer inside the block and record what it costs — Beit Sahwan III's equivalent lost 55 of 61 points |
| **IV** | `raze(stockpile, 300)` reaches `failed` | that 7,500 hp of structures and an HVT 16 tiles the other way both fit in 7 minutes, and **what happens when both `demo_squad` die** — the answer must be a clean loss on the deadline, never a stall |

Four further things to measure, none of which a `result === expect` assertion can
see (GH-84):

1. **Duration.** Only II carries an endure-clock, so only II's ratio against
   `target_minutes` is informative; I, III and IV will read low because the plan
   holds perfect information and the player does not. **Do not tune against a low
   ratio on I, III or IV.**
2. **`roster out` after each mission**, because it prices the next one through
   `from_ledger`.
3. **The recon carry-over, explicitly.** Run III twice: once with all four tags in
   `intel.marked_positions` and once with none, and record the difference. If it
   is nil, the `ambush(10)` placements are not doing their job and the act's
   central promise is not being kept.
4. **The Grad's target selection.** Tel Marum's lesson was that a battery *can*
   reach a piece of ground and never *chooses* to: `selectTarget` is hurts-first
   then nearest. Umm Zeitoun II and III both depend on the Grad actually firing on
   the crest line and on the hamlet. **Trace its `fire` events**; if it prefers
   something nearer and softer, the displacement triggers are decoration and the
   design has to be told, not patched.

---

## 6. Asset manifest

Every row is **PRESENT (path)** or **MISSING (gate + pipeline)**. Censused in this
worktree this session; gate names are the ones in `package.json`.

### 6.1 Units — all PRESENT, and **Act II needs no new unit**

| unit | data | mesh | sprite |
|---|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` | `assets/sprites/INF_SQUAD` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` | `assets/sprites/INF_AT` |
| `mortar_team` | `data/units/kdf/mortar_team.json` | `art/meshes/mortar_team.glb` | `assets/sprites/INF_MORTAR` |
| `sniper_team` | `data/units/kdf/sniper_team.json` | `art/meshes/sniper_team.glb` | `assets/sprites/INF_SNIPER` |
| `demo_squad` | `data/units/kdf/demo_squad.json` | `art/meshes/demo_squad.glb` | `assets/sprites/INF_DEMO` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` | `EITAN_HULL`, `EITAN_TURR` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` | `NAMER_HULL`, `NAMER_TURR` |
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json` | `art/meshes/vehicles/mbt_lavi.glb` | `TNK_HULL`, `TNK_TURR` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` | `JEEP_HULL` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | **none — sprite-only by design** | `assets/sprites/DRONE_RECON` |
| `sarim_rifles` | `data/units/enemy/sarim_rifles.json` | `art/meshes/sarim_rifles.glb` | `assets/sprites/INF_SARIM` |
| `atgm_cell` | `data/units/enemy/atgm_cell.json` | `art/meshes/atgm_cell.glb` | `assets/sprites/INF_ATGM` |
| `rocket_battery` | `data/units/enemy/rocket_battery.json` | `art/meshes/vehicles/rocket_battery.glb` | `assets/sprites/ROCKETBATTERY_HULL` |
| `recoilless_team` | `data/units/enemy/recoilless_team.json` | **none — sprite-only** | `assets/sprites/INF_RECOILLESS` |
| `manpad_team` | `data/units/enemy/manpad_team.json` | **none — sprite-only** | `assets/sprites/INF_MANPAD` |
| `loiter_drone` | `data/units/enemy/loiter_drone.json` | **none — sprite-only** | `assets/sprites/DRONE_LOITER` |
| `civilians` | `data/units/civilians.json` | `art/meshes/civilians/{civilian_woman,office_worker,farm_worker,civilian_child}.glb` | **MISSING — see 6.6** |

**What sprite-only means on the default renderer, stated because it is easy to get
backwards.** `three` is the default and it draws a mesh for any type with a GLB
and a **billboard** for any type without one — so `manpad_team`, `recoilless_team`
and `loiter_drone` draw correctly today, as flat sprites among 3D bodies. They are
not missing and they are not broken. The visible consequence is *stylistic*: counting the enemy bodies this design
authors across Umm Zeitoun's four missions, garrisons and waves together,
**roughly a quarter of them are billboards** — this arc leans on `manpad_team`
and `recoilless_team` harder than any shipped mission set does. That is a judgement for the lead (§8 O-F), not a gate failure, and it
is the first mission set in the game where it is this concentrated. Three
**mesh** GLBs — `manpad_team`, `recoilless_team`, `loiter_drone` — would close it:
gate `pnpm validate:meshes` (headless Blender render, palette, silhouette IoU
against every other mesh and sprite, and the mesh contract), pipeline
`tools/units/kit.py` → `tools/units/rig.py` → `tools/export_mesh_team.py`, owner
`blender-art`.

### 6.2 Structures — all PRESENT

`data/structures.json`, 8 types, each with an idle and a wreck GLB in
`art/meshes/buildings/` (verified: `shanty`, `house`, `apartment`, `warehouse`,
`concrete`, `wall`, `mosque`, `camp`, plus each `_wreck`). Umm Zeitoun uses
**five**: `shanty s`, `house h`, `warehouse w`, `concrete #`, and `camp c` raised
by II's `structures[]`. `house` and `warehouse` ship their supplied photo-textured
Meshy bakes and are the named palette exemption. **No `mosque` tile is authored**
(GDD §2; `storyline.md` O10 is open).

### 6.3 Decor — all PRESENT

`art/meshes/decor/`: `grass_0-2`, `sand_0-2`, `bush_0-2`, `tree_0-2` (`o`),
`rock_0-2` (`n`), `slab_0-2` (`^`), `boulder_0-2` (`b`), `ditch_0` (`d`).
**Umm Zeitoun is the second map in the game to author `b` and the second to author
`d`**, and the first to author both plus relief in one basin. Road `r` has no decor
family, by design.

### 6.4 Maps

| row | status |
|---|---|
| `data/maps/tel_marum.json` | **PRESENT**, 48×48, elevation 0–4. **Unchanged unless `level-scripter` takes T-C2**, which needs one additive zone `narrow_corridor [10,12,2,6]` — verified this session to be exactly the twelve `b` tiles at x10–11, y12–17. Gate `pnpm validate:data`; the character grid is not touched and a zone nothing names is inert, so the other two missions are unaffected |
| `data/maps/marj_perimeter.json`, `beit_sahwan_outskirts.json`, `wadi_halam_basin.json`, `qarn_hadid.json`, `tutorial_ground.json` | **PRESENT**, untouched |
| **`data/maps/umm_zeitoun.json`** | **MISSING — the arc's one content asset.** Gate `pnpm validate:data` (schema, symbol cross-check against the structure catalogue and terrain legend, row and elevation dimensions, marker and zone bounds). Pipeline: hand-authored JSON — **§4 is the draft, lift it.** Owner `mission-author`. *Already checked this session:* `parseMap` accepts it, both grids are 48×48, and every marker sits on a passable tile |
| **`tools/src/umm_zeitoun_doctrine.test.ts`** | **MISSING — and it must land with the map, not after it.** Gate `pnpm test`. Pipeline: the assertions in §4.4 and §4.5, in the idiom of `tools/src/tel_marum_doctrine.test.ts`, every negative paired with a positive. Owner `level-scripter` |

### 6.5 VFX — all PRESENT, nothing new

15 emitters in `data/vfx/` including `shell_impact.json`, `structure_collapse.json`
and `catastrophic_kill.json`; `art/meshes/vfx/{explosion_burst,muzzle_flash,smoke_plume}.glb`.
A Grad round already arcs, throws `shell_impact` on the frame clock, and draws as
`vfx.fire`/`vfx.ember` on `three`. Act II adds no surface.

### 6.6 The one real art hole, inherited from Act I

> **`civilians` billboard sheet — MISSING.** `civilians` is the one unit type with
> no `SPRITE_MAP` entry and no sheet, so on `?renderer=pixi` or `&nomesh` a
> civilian **draws nothing**. Umm Zeitoun places 3, 6 and 4 of them across three
> missions and **two of those missions score on them, one of them fatally.**
> Gate: `pnpm validate:assets` (palette, reserved bands, binary alpha, silhouette
> IoU, framing) **and** a `SPRITE_MAP` entry, which no gate checks — three
> complete sheets have shipped and drawn nothing for want of one. Pipeline
> `tools/units/kit.py` → `render_team.py`. Owner `blender-art`. Priority is the
> lead's answer to §8 **O-F**.

### 6.7 Audio and the narrative layer

| row | status |
|---|---|
| 11 weapon/impact sets, `.ogg` + `.m4a`, CC0 from `tools/gen_audio.py` | **PRESENT** (`assets/audio/`) |
| EVA announcement set (objective complete/failed, unit lost, reinforcements, **taken**) | **MISSING.** Gate `pnpm validate:audio` — **fails by construction**: `KNOWN_EVENTS` is six weapon events and a voice set has none of them. GH-110; the gate must widen first (§7 G4) |
| Shai / Idit / Adhal voice lines | **MISSING.** Same gate; every variant needs a redistribution-safe licence **and** a source URL. `storyline.md` §2.4(5) binds hardest here |
| Radio overlay art (frame, speaker plate, portrait slot) | **MISSING.** Gate `pnpm validate:ui` (no colour literals). Owner `render-vfx`. **Not blocking** — a `say` line already lands in the notice feed and on the commander bar |
| Shai / Idit portraits | **MISSING.** **No gate** — `tools/validate_assets.py` defaults to `--sprites assets/sprites`, so `assets/ui/` is ungated. Generative permitted with PR disclosure |
| **Adhal portrait** | **MISSING**, no gate. **Must resemble no real person and carry no real insignia** |
| **Sarim Brigades faction mark** | **MISSING**, no gate. Vector. The only insignia shipping is `assets/campaign/flag_brigade.png` (KDF) — **PRESENT** |
| KDF rank insignia, **3 stars (Major)** — the only rank Act II needs | **MISSING**, no gate; `pnpm validate:ui` if drawn in CSS |
| `data/campaign/commander.json` | **PRESENT** — and **wrong for this act** under Option C (§2): `until_mission` on the Major entry must move to `umm_zeitoun_4_clearance` |
| `dispatch` / `aftermath` / `debrief`, `say` on triggers and objectives, `remove`, `starting_force.group` | **PRESENT** — landed 2026-09-03, verified in `data/schemas/mission.schema.json` and `packages/sim/src/mission.ts` this session |
| Campaign board (`world_map.png`, `layer_{base,marj,sur,naharin}.png`, `sahar_basin.svg`, `flag_brigade.png`, `art/meshes/campaign/sahar_basin.glb`) | **PRESENT.** Act II needs a `world.json` edit only |

---

## 7. Engine and schema gaps

Ranked by how much of Act II each blocks. Numbering follows `storyline.md` §7
where the gap is the same. **None of them stops the act shipping.**

| # | gap | smallest proposal | owner | Act II impact |
|---|---|---|---|---|
| **G5** | **A town cannot say it is unwritten.** `world.schema.json` has no `planned` property, so Sur reads 100% complete on one town of two under Option A, and the Marj already reads complete on one of three | `planned: true` on a town, excluded from `regionProgress`; and fix `nextMissionAfter`'s dead end at a town boundary | `sim-guard` (schema), `app` (`campaign.ts`) | **Option A cannot honestly ship without it.** Under C it is still wanted for `khan_rafid` and `deir_amun` |
| **G4** | **The audio gate cannot accept a voice file.** `KNOWN_EVENTS` is `{fire, penetration, ricochet, near_miss, aps_intercept, destroyed}` — all weapon events | A non-weapon set kind and its events (`objective_complete`, `objective_failed`, `unit_lost`, `reinforcements`, `taken`, `line`). The licence and source-URL checks stay — they are that gate's load-bearing half | `render-vfx` + `content-validator`; GH-110 | Every audio row in §6.7 |
| **G8** | **A trigger cannot fire on an objective, and cannot see the sim** | Two `on.kind`s: `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds). The tutorial's `await` already gates on every `SimEvent`, so the predicate is reused | `sim-guard` | Every displacement in §5 is on `casualties_pct` or a bare `timer_s` because there is no "the player has entered the depot" or "this objective completed" condition. It works; it is a clock where a consequence belongs |
| **G12** | **A wave cannot speak.** The wave item is `{at_seconds, trigger, to, units}` — `say` was added to triggers and objectives and **not** to waves | Add `say?: { speaker, text }` to the wave item, emitted when the wave spawns. The `wave` `MissionEvent` already exists, so this is one field and one push | `sim-guard` | Reinforcements arriving is the most legible thing that happens in a mission and it is the one event with no voice. Workaround: a `timer_s` trigger at the same second, carrying the line and no `do` — **which the schema does not allow, because `do` is required.** So today the workaround costs a real order |
| **G13** | **An author cannot choose where an enemy round lands.** T8's literal form — a rocket into the block the player may not shoot into — needs sim work | Out of scope, recorded. §5.3 delivers the *meaning* with placement instead: his rounds kill people the player is scored on saving, and `stepRoe` charges him nothing | `sim-guard` | None — the design is written around it |
| **G14** | **A structure's destruction cannot carry authored consequences.** `COLLAPSE_SHOCK` is a tuning constant, not a per-structure field, so "the magazine goes up" (T-U11) is not authorable | A `collapse_damage` / `collapse_radius` on a structure type in `data/structures.json` | `sim-guard` | One twist candidate, cut cleanly |
| **G10 (corrected)** | **No Intel *rate*.** `resources` is `additionalProperties: false` with exactly `logistics_start`, `intel_start`, `logistics_rate_per_min`, `supply_corridor` — **so `intel_rate_per_min` is a schema field plus a runtime line, not "content, not engine" as `storyline.md` §7 records** | Add `intel_rate_per_min`, accrued beside logistics. **But note it is only half needed:** Intel already accrues at 8/min per living drone and 5/min per stationary `mark_target` carrier, so `intel_start` alone gives Act II a real economy today (§5.0) | `sim-guard` (schema + one line); `mission-author` for the content half | None blocking. The storyline's classification should be corrected |
| **G6** | **No friendly-tagged HVT / `capture` cannot require its target alive** | recorded; Act II uses neither | `sim-guard` | None — Adhal dies by `eliminate_hvt`, which is honest for an observer |
| **G9** | **`mark`, `escort`, `no_collateral_above` throw.** `escort` is the obvious shape for a demolition party | Out of scope; recorded so nobody authors one by reading the schema | `sim-guard`; GH-2, GH-4 | None |
| **G15** | **`playtest` cannot express "this mission got 3× longer".** Its assertion is `result === expect` and nothing else; a mission can blow out sevenfold and CI stays green (GH-84) | A per-mission duration ceiling in the harness — a design call, and **not** `target_minutes`, for the reasons `storyline.md` and CLAUDE.md both record | `playtest` | Act II adds four plans to a harness that cannot see the thing this act is most likely to get wrong |

---

## 8. Open decisions for the lead

| # | decision | in plain words | recommendation |
|---|---|---|---|
| **O-A** | **Which plot?** A (Act II ends at the pass, +1 placement), B (a two-mission Umm Zeitoun), C (a four-mission Umm Zeitoun) | A ships this week and never asks the act's own question. B pays for a whole relief map and then cuts the three things the map is for. C is one map, four missions, four plans and two one-line data edits, and it closes GH-122 | **C.** If the schedule forbids it, take **A** without apology and pair it with `planned: true` (G5) so Sur does not read finished |
| **O-B** | **Does the map get authored now?** | The cost of C is one 48×48 relief map **with a pinned sight test**, four mission JSONs, four `playtest` plans and four passive controls. The map is drafted and measured in §4; what is not written is the test file and the JSON | **Yes, and the test file lands in the same commit as the map.** Tel Marum's whole history is a warning: its saddle was "free" for two milestones because the ground was authored before anything measured what the ground did |
| **O-C** | **Do Tel Marum's three missions gain a failable primary?** | All three passive controls currently return `ongoing`, not `defeat` — a passive player is **stuck rather than lost**, which the pipeline's own contract refuses. Fixing it means adding a `raze`, `collapse` or `evacuate_before` primary to shipped, measured content, and re-running six `playtest` lines | **Yes, but not in this change.** Do it as its own slice after Act II lands, so the six lines move once and for a stated reason. The cheapest shape is a **civilian group in the pass town-block with an `evacuate_before` primary in III** — the map already has `town_block`, and it makes the ROE bait and the loss condition the same object |
| **O-D** | **Is `commander.json` corrected?** | Under Option C the Major entry's `until_mission` is `tel_marum_3_clearance`, which promotes Shai to Lt Col for the four Umm Zeitoun missions — **mid-act, which D-level policy forbids** | **Yes** — `until_mission` → `umm_zeitoun_4_clearance`. One line, and it is wrong the moment the first Umm Zeitoun mission exists |
| **O-E** | **Does `tel_marum_3_clearance` gain `intel.marked_positions` in `requires`?** | It reads the recon today and does not declare it. Verified this session: `requires` is read by neither the runtime nor `campaign.ts`, so the change cannot move any measurement | **Yes.** One line, free, and it makes the act's contract honest |
| **O-F** | **Does Pixi still have to be playable, and does the billboard mix matter?** | Two things ride on this. `civilians` draws nothing on Pixi or `&nomesh`, and Umm Zeitoun scores on civilians in two missions. Separately, on the default renderer five of ~14 enemy bodies in this arc are billboards among meshes (`manpad_team`, `recoilless_team`, `loiter_drone`) | The lead's. If Pixi must be playable, the `civilians` sheet is Act II's one genuinely missing art asset. The three enemy meshes are a *look* decision, not a gate, and they are cheap next to a map |
| **O-G** | **How much may Adhal say?** | He gets one line in the whole act, on the withdrawal trigger in the last mission. `speaker: "enemy"` exists and is deliberately never named | **One line, about looking, never about the player.** Everything else he does is a placement. The register is Act I's ceiling: stated, never depicted |
| **O-H** | **Does the act keep `raze` as the loss condition in two of four missions?** | The only three failable objective types are `raze`, `collapse` and `evacuate_before`. Sur has no tunnels, so `collapse` is out, which leaves two shapes for four missions | **Yes, and say why in the document rather than hiding it.** They alternate — families, a post, a hamlet, a depot — and the alternative is a fourth objective type, which is engine work nobody has asked for |

---

## Appendix — the census and the measurements this was written from

Run 2026-09-03 in `/Users/ilpinto/dev/roaring-lions-story` on `feat/story-act-1`.
Anything not listed here was not checked this session.

```
pnpm playtest                                                # 19 lines, exit 0 — every figure in §3.1
ls data/units/kdf data/units/enemy data/units/civilians.json
ls art/meshes art/meshes/{vehicles,buildings,decor,civilians,vfx,campaign}
ls assets/sprites assets/audio assets/ui assets/campaign; ls data/vfx
jq/py: data/maps/tel_marum.json, qarn_hadid.json            # rows, elevation, markers, zones
jq/py: data/schemas/{mission,map}.schema.json               # town enum, roe, resources, placement, say, wave
jq/py: data/structures.json                                 # 8 types, hp_per_tile, roe_penalty, garrison_slots
cat data/campaign/{commander.json,world.json}
cat data/missions/tel_marum_{1_recon,2_foothold,3_clearance}.json   # triggers: [] in all three
sed: packages/sim/src/mission.ts  SUPPORTED, stepTriggers (remove), stepRoe,
     locate/raze/collapse checks, markedThisMission, requestSweep/requestStrike,
     INTEL_PER_MIN_DRONE=8 / _SCOUT=5, SWEEP_COST=150, STRIKE_COST=250
sed: packages/sim/src/sim.ts      losRay, detectionPair, stepDemolition, DEMO_SECONDS=5
sed: packages/sim/src/civilians.ts  CIV_FLEE_AT, SHEPHERD_RADIUS_SQ (4 tiles)
sed: packages/app/src/campaign.ts   campaignRoe, unlock gating (completed_missions only)
grep: tools/validate_data.mjs       raze zone checks (seconds on primary, no protected/per_tile/low_profile)
sed: tools/src/backtest/playtest.ts the three Tel Marum plans and their control comments
```

**The measurements.** The Umm Zeitoun grids in §4 were generated, then driven
through the **real `Sim`, `FlowField` and `parseMap`** from a scratch harness
outside the repository (absolute-path imports; `packages/sim` imports nothing and
`packages/data/src/map.ts` imports only `data/structures.json`, so no build step is
involved). Every `sees(...)` uses `sim.debugDetection` after 12 simulated seconds,
exactly as `tools/src/tel_marum_doctrine.test.ts` does; every route walks
`FlowField.compute` over `sim.blocked` or `sim.blockedVehicle` with the elevation
grid, so slope is priced. **No file was written into `data/`, `tools/` or
`packages/` by this document.**

Three method caveats, stated so nobody repeats them:

1. **A 48-sight observer measures TERRAIN, not the roster.** Every table in §4.4
   says which it is. `tm_spotter_narrow` is what happens when the two are confused.
2. **`debugDetection` returns no record for some pairs**, and the harness treats a
   missing record as *not visible*. That is safe for a negative claim and would be
   unsafe for a positive one; every positive above has a distance inside the
   watcher's own `sight_tiles`.
3. **Two probe origins were mis-sited inside the hamlet's houses on the first
   pass** and returned `blind` for a reason that had nothing to do with the claim
   being tested. Structures block. Check the symbol under every probe tile before
   believing a negative — the fix produced the §4.4 F table, which reverses the
   first reading entirely.

**Not verified this session, and flagged as such:** whether *Karim Adhal* collides
with a real public figure (`storyline.md` §2.4(3) — that check happens outside this
repository); whether the Grad actually *chooses* the crest line and the hamlet as
targets (§5.6 item 4 — a Tel Marum-shaped risk, and the single most likely way
this design is wrong); the real-player duration of anything, which no instrument
in this tree can measure; and any claim in
`docs/campaign/research-2026-09-03.md` not re-run above.

**One last check, done after this document was written.** The two fenced grids in
§4.2 and §4.3 were extracted *from this file*, recombined with the marker and zone
blocks in §4.4, and handed to `parseMap`: **accepted, 48×48, 25 markers, 11 zones,
10 structures** — 1 `warehouse`, 2 `concrete`, 4 `shanty`, 3 `house`, which is
exactly what §4.4's zone audit and §5.4's 7,500 hp claim assume. The text and the
thing measured are the same bytes.
