# WP-G-F plan F4: production at the field camp, rally points, and an AI that spends (GH-183, GH-136, G3 Q3). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct

Refreshed against `main` `b44df7aa` (v0.121.4, 6 Oct). What F4 replaces is unchanged: the flat `buildQueue` (`mission.ts` ~L525), `productionAnchor` (~L601), `buildBlockedReason` and its "field camp destroyed — no production" (~L609–628), `requestBuild` (~L679), the deploy loop (~L1079–1095), `CONTEST_RADIUS_SQ` (~L416) and `contestedIn` (~L1575). *(Line refs re-read on `f2d5d9e8`, 11 Oct; they moved +8 to +13. Locate by symbol.)*

- **#402 infantry halt and kneel to fire** (`7962b6ea`, a lead-approved one-off sim change; `packages/sim` otherwise stays closed until Stage 4). 15 foot types fire only while kneeling; a stopped unit kneels; a plain `move` runs through holding fire; an arrived attack-mover is walked on by `stepSweep`; a foot patroller halts on contact (`stepPatrols`, `mission.ts` ~L1536). Kneel 0.2 s (`KNEEL_DROP_TICKS` = `KNEEL_RISE_TICKS` = 4), final. Sim pins 2109596329 / 1425295494 (4 Oct) → **922714084 / 3200430224**.
- **GH-382** re-grounded 19 maps. `deir_amun_2_foothold`'s camp moved (26,34) → (21,35); `deirAmun2Plan`'s gate `M(15, 27)` → `M(15, 31)`; `wadi_halam_2_laager`'s anchor (18,21) → (21,25). Task 1's serial predictions were never measured; measure them on this ground. `bs_ladder.ts:97` (report-only, not CI) also buys one `inf_squad` at 120 s in Beit Sahwan II.
- **Camp census, corrected:** no map has ever carried a `c` tile (not at `751b6742`, `067fab9a` or `b44df7aa`). Six missions stand **one** camp each, all through `structures`: `beit_sahwan_2_foothold` (2,20), `deir_amun_2_foothold` (21,35), `khan_rafid_2_foothold` (20,38), `qarn_hadid_2_foothold` (25,34), `umm_zeitoun_2_buildup` (20,43), `wadi_halam_3_counterraid` (3,20). No mission has two.
- **GH-330:** `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts` ~L63) must equal `LADDER_CREDITS` (`tools/src/campaign_credits.test.ts`). Both read **5870** on `f2d5d9e8` (5830 on `b44df7aa`, 5736 on 4 Oct; #431 and #444 moved it). A ladder re-pin moves both in one commit.
- **#374 Pixi retired:** the rally marker is drawn by three only. The dock shows a "deploying" chip for a bought type whose GLB has not landed (`meshPending`, `ui/production.ts`).

**Interactions (R, read from source; none measured):**
- **D5 rally `move` under #402.** *(Pre-flight 2, 2026-10-11: the attack-move half of this bullet is
  stale; since #537 a no-sweep attack-move holds at its goal. Ruling (lead, 2026-10-11): the rally is a no-sweep attack-move.)* A rallied foot unit runs to the point holding fire the whole way, even under fire (`sim.ts` ~L3828). It kneels on arrival and stays there (`stepSweep` skips `attackMove` 0, `sim.ts` ~L5177). An attack-move would fight its way there, but on arrival `stepSweep` would walk it on: toward a current target in cover, or else to the nearest enemy position its side has recorded, which since #402 includes an identified enemy out of reach. So it would not hold the rally point. The player's right-click is always an attack-move (`input/intents.ts` ~L285/324/337), and there is no plain-move button. Task 9's bought enemy units walking to `rally` behave the same way. A trigger `commit` re-orders them as an attack-move (`mission.ts` ~L1701).
- **At the exit.** `spawn` resets the unit to `BRACE_NONE` (`sim.ts` ~L1757). `runtime.step` runs after `sim.tick`, so a rally `move` queued on the deploy tick is applied before the next tick's `stepBrace`: the unit never drops, and starts 0 ticks late. With no rally the unit kneels at the exit (4 ticks), and a rally set later costs it a 4-tick rise. Successive units still deploy onto the one exit tile (`structureExit`, `sim.ts` ~L4526), as today.
- **D1 contested.** The rule is unchanged by #402. A foot patroller that makes contact now stays where it met the player and can hold a camp contested. No shipped camp mission has a foot patroller near its camp (they are `moto_rpg` and `technical`, vehicles, which #402 leaves alone). The building plans' camps sit near what the enemy is sent to:
  - Beit Sahwan II: all three waves go to `kdf_assembly`, 5.0 tiles from the exit (1.5,19.5). Unchanged since 4 Oct.
  - Deir Amun II: the 110 s wave and the `pump_yard` commit go to `pump_gate`, 5.4 tiles from the exit (20.5,34.5); it was 11.2 tiles before GH-382. The 340 s wave goes to `ford_centre`, 5.1 tiles away.
  - Khan Rafid II: its technical patrols y = 34, about 3.5 tiles from the exit (19.5,37.5).

### For the lead
1. **D5 vs #402.** Should the rally order stay a plain `move`? It holds the point, but the unit does not shoot back on the way, and it is an order the player cannot otherwise give. Or should it be an attack-move, which fights on the way but is walked off the point by the closing rule? Or a third rule, such as an attack-move that halts on arrival (new sim behaviour)?
   **Ruled 6 Oct (lead):** add a "Hold position" order (`2026-10-06-hold-position.md`, on `main` Wed 4 Nov, before F4). The rally point issues Hold on arrival. A held unit stays put, kneels, fires at anything in range, and never advances, chases or closes. The walk to the point stays D5's `move`.
2. **Task 9 / D7–D8.** The same question for the enemy's bought units walking to their `rally` marker. By `move` they walk past KDF troops holding fire, and #402's halt-on-contact covers patrollers only.
   **Ruled 6 Oct (lead):** likewise. The enemy's bought units issue Hold on arrival at their `rally` marker. A trigger's `commit` (an attack-move) releases them.
   *(Pre-flight 2, 2026-10-11: items 1 and 2 were reopened by #537. Ruling (lead, 2026-10-11): the rally and the enemy's bought units use a no-sweep attack-move; no Hold.)*
3. **D1 vs GH-382.** Deir Amun II's gate fight now falls inside the camp's 6-tile radius, as Beit Sahwan II's wave target already did. Under D1 both lines would pause whenever a wave arrives. Is that the intended "no production while contested", or should contest be measured another way (a smaller radius, or the camp footprint rather than the exit)?
   **Ruled 6 Oct:** intended. A contested camp pauses; D1 stands as written.

## Pre-flight 2 (2026-10-11), evening, against main 49715ff9

Read and grepped, not run.

- **#537 removed the reason for D5's shape.** D5 (and its 6 Oct ruling) made the rally a `move`
  followed by Hold on arrival because "an attack-move would fight its way there, but on arrival
  `stepSweep` would walk it on". Since #537 `stepSweep` walks on only an attack-move that set
  `sweep: true` (waves, `commit`s, `targets.ts`). A no-sweep attack-move fights its way to the point
  and holds there with no arrival hook. The same is true of Task 9's bought enemy units walking to
  `rally`. A trigger `commit` still sweeps, so it still sends them on. See the decision below.
- **Hold has no sim command** (ruling (lead, 2026-10-11)). Task 5's "a rallied unit holds on arrival"
  and Task 9's "hold there on arrival" are re-written below for a no-sweep attack-move.
- **Five plans build now, not three.** #542 added buying to **Wadi Halam IV** (`wadiHalam4Plan`,
  `inf_squad` as logistics allow, ~L612) and **Umm Zeitoun III** (`ummZeitoun3Plan`, a mortar then
  rifles, ~L2314), beside BS II, DA II and WH II. Neither stands a camp (they deploy at the start
  marker, as WH II does). Task 10 re-proves all five, and "Lines that move" in Global Constraints is
  their five lines.
- **Task 9's probe seeds.** `main` now has a 30-seed harness (#539, #542): seeds 424242 then 1..29,
  `passive-sweep.ts` and `plan-sweep.ts` with a worker pool. The G3 sheet's list on
  `spike/skirmish-g0` is a different set. Recommended (default, not a question): run the probe over
  `main`'s set and reuse its worker pattern, and say in the probe that it is not the G3 set. `PT_SEED`
  is read in `playtest-run.ts` (~L228), not `playtest.ts` ~L201; the passive controls are
  `passiveAcrossSeeds` calls.

| where | correction | |
|---|---|---|
| Changed since 4 Oct (D5 under #402), D5, For the lead 1 and 2 | The closing rule no longer walks a no-sweep attack-mover off its goal (#537) | dated notes in place; **ruled** below |
| Task 5 Step 1, Step 3; Task 9 Step 1 | The "holds on arrival" test and its control ("where an attack-mover would be walked off") rest on the old closing rule. Under the recommended answer the control becomes a `sweep: true` attack-move, which is walked off | dated notes in place |
| Global, Re-pins | Sim pins are **three**: flat `1202444260`, relief `3354895120`, orders `2737216487`. Unmoved (R) | fixed in place |
| Global, Re-pins, Task 10 | `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5917** (`playtest.ts` ~L3096; `GATES` ~L2820) | fixed in place |
| Global, Task 10 | Playtest holds every plan, control and gate on 30 seeds (~57 s locally). Serial lines and the contested pause must keep all five building plans at 30/30 | fixed in place |
| Task 10 Step 2 | `deirAmun2Plan` is at ~L1413 (its `M(15, 31)` orders ~L1423-1437); unchanged by #542 | noted |
| Order of landing | #540 (time limit) lands Wed 4 Nov, before F1 (ruling (lead, 2026-10-11)). The five building plans' slowest 30-seed wins must stay inside their limits after the serial lines slow them | noted |

### Ruling (lead, 2026-10-11): the rally order

**The rally order is a plain attack-move without `sweep`**, for the player's rally and for the enemy's
bought units alike: they fight on the way (a foot unit halts to fire under #402) and hold on arrival,
with no arrival hook, no Hold command (retired the same day) and no runtime list of rallied ids. A
trigger `commit`, which sweeps, still sends the enemy's units on. The options as they were put are in
PR #544's first commit (`fb25a54f`).

---

## Pre-flight, 11 Oct (against main f2d5d9e8)

Read against `main` `f2d5d9e8` (11 Oct). Docs only; nothing measured. Sim pins still **922714084 / 3200430224**
(unchanged since #402). The camp census holds: six missions, one camp each, all through `structures`, none with
`side`, no `c` tile on any map. The three `playtest` plans that build are at the lines the plan names.

**Landed since `b44df7aa` that touches this plan:**
- **#431, #444:** `LADDER_CREDITS` and `CAMPAIGN_CREDITS` are **5870** (5830 → 5868 → 5870). #431 also edited `MissionRuntime` (`razeExempt`, built in `start()`); F4's Task 3 builds its lines in the same place, so merge carefully. It does not touch production.
- **#428/#461 alert language:** tier, tone and place on every feed line; Space jumps to the latest important/major alert; the alert ring flashes the minimap.
- **#454 chrome register:** credits `--commend`, this mission's logistics/intel `--info`, selected `--selected`, `--on` for a live state only, `--disabled-opacity`, button-case rule; pinned by `ui/chrome-register.test.ts`.
- **#426 cue table (`ui/cues.ts`):** every `MissionEvent` kind needs a row. F4 adds no kind (see Q5/Q6).
- **#474/#479 memory gate:** deferred buildables are decoded only when `runtime.production` lists them (`warmUnitMesh`, `main.ts`). Serial lines change who is listed when (Task 3).
- **#427, #457:** armed orders take the ground point; the move cursor and the marker a move leaves share `ORDER_GROUND_COLOR_KEY` (lime, `vfx.tracer`).
- **#488 tutorial:** `data/tutorial/beit_sahwan_0.json` has **9 steps and no economy beat**; the tutorial mission has no `resources`, no camp, no dock reveal.
- **Hold position (`2026-10-06-hold-position.md`):** still a plan on `main`; `hold`/`holdPos` do not exist yet. F4's rally arrival depends on it, as the 6 Oct ruling says.

| task | what changed | fixed in place / question |
|---|---|---|
| all | `mission.ts` moved +8 to +13 lines (e.g. `buildQueue` L517 → ~L525, `contestedIn` L1562 → ~L1575, `production` getter L791 → ~L799, `spawnPlacement` L1250 → ~L1259, commit L1688 → ~L1701); `sim.ts` `structureExit` 4530 → ~4526, brace line 3829 → ~3828 | fixed in place (all refs now "~L", locate by symbol) |
| all | `input/intents.ts` attack-move sites 270/292/305 → ~285/324/337; `main.ts` unit lookup 2102–2110 → `unitInfo` ~L2332 | fixed in place |
| 10, re-pins | `LADDER_CREDITS` 5830 → **5870** (`playtest.ts` ~L3195, was ~L3181); `CAMPAIGN_CREDITS` 5830 → 5870; `stores-model.ts` comment still says 5,736 (not ours) | fixed in place |
| 3 | `main.ts` calls `three.warmUnitMesh(p.unit)` for every item in `runtime.production` each tick (GH-469). A serial line that lists only its current item would decode the second type's textures late | fixed in place: the flattened getter lists queued items (`doneTicks` 0); new test in Task 3 |
| 3, Global | Memory gate: `DEFAULT_MISSIONS` are three `resources` missions with no camp and no builds in the walk | fixed in place (Global Constraints note); F4 moves no reading unless a task adds a build or `enemy.production` to a walked mission |
| 7 | `missionUnitTypes` already walks the whole mission JSON, so `enemy.production.menu` units load at boot, not cold | fixed in place (note under Task 7); adds `bitmapsMiB` only to a mission that uses it (none, D7) |
| 9 | `built` is the player's arrival signal (`alert.arrived`, announcer "reinforcements", `cues.ts` row). An enemy purchase on the same event would announce enemy units as ours | fixed in place: side-1 purchases emit no `built`; test added |
| Lane A: dock | #454 register; the dock head already carries a static `--commend` credits chip; `--info` for logistics | fixed in place (Lane A bullet) |
| Lane A: paused | #428/#461: tier/tone/place, cooldown, minimap flash through `at` | fixed in place (important, warn, app-derived from the `contested` edge, no new `MissionEvent`); Q5 |
| Lane A: rally | Armed rally is a fourth arming source (`anyArmed`, Escape); armed orders take the ground point; deny cue on a refused point; move-cursor colour | fixed in place; marker is Q4 |
| Lane A: marker | `addOrderMarker` is transient; a persistent marker is a new `Renderer` method; colour is `ORDER_GROUND_COLOR_KEY` | fixed in place (note); the mock gate stays, Q4 |
| Lane A: tutorial | Tutorial mission has no economy at all; step vocabulary has no rally intent (`INTENT_KINDS`) | not fixed; Q7 |
| Task 5 / Task 9 | Hold position still unlanded; F4 stays blocked on it (order plan already says it lands 4 Nov) | no change |
| Task 5, #402 | Brace claims re-checked: `spawn` resets `BRACE_NONE`; `stepBrace` plain-move branch "runs through"; `stepSweep` skips `attackMove` 0 | still true, no change |
| Task 4, D1 | `contestedIn` unchanged (no air skip, `tunnelIn` guard) | still true, no change |

### For the lead (continuing the numbering above)

4. **The rally marker's mock.** The plan already gates the marker on an approved mock (no status marks in the world). Recommended mock: not a new mark, but the move order's own route line and marker (lime, `ORDER_GROUND_COLOR_KEY`) from the camp exit to the rally point, shown only while that camp's dock is open, and gone when it closes. Show the mock at 2 zoom levels on `beit_sahwan_2_foothold` before Task 5's Lane A half starts. If it is rejected, the rally point has no world mark and the dock row names it ("Rally: set" or "not set") and nothing else shows it.
5. **How "production paused" speaks.** Recommended: an `important`, `warn` feed alert on the first pause of a line (debounced), placed at the camp exit; the dock line shows "Contested: production paused"; no new `MissionEvent` kind, no minimap zone state, no world outline for a camp. Alternative: also mark the camp on the minimap like a contested zone (`--bad` dashed, pulsing).
6. **Enemy purchases are silent.** Recommended: a side-1 buy emits no `built`, no alert and no cue in Stage 4 (D7: no shipped mission buys). G-G adds an "enemy reinforcing" alert and cue when it needs one. Applied in place; overrule if you want a "hostile reinforcements" alert now.
7. **The tutorial's economy step.** The 9-step tutorial has no logistics, no dock and no camp, and its step vocabulary can already await the `built` MissionEvent but has no rally intent (`INTENT_KINDS` in `input/intents.ts` lacks one, and the tutorial schema cross-checks it). Recommended: add two beats only, "build one unit" (await `mission` event `built`) and "set a rally point" (await a new `rally` intent), by giving the tutorial mission a `resources` block and revealing `dock`/`logistics`; teach the pause with the live alert on the first camp mission, not with a scripted enemy in the tutorial. This is a scope call on the tutorial (and on `beit_sahwan_0`'s length), not only a Lane A string.
8. **A first-use hint for the rally point.** Recommended: no in F4 (the dock button and the tutorial beat carry it); revisit in the polish lane if testers miss it. A hint would need a new rule field in `hint-rules.ts`.

---

**Goal:** Production gets a place, a pace and a destination, and the enemy buys the same way the
player does.

| | today (`main` `067fab9a`; unchanged on `b44df7aa`) | after F4 |
|---|---|---|
| where | beside the first living camp, else `player_start` (`productionAnchor`, `buildBlockedReason`) | **one production line per camp**; a mission with no camp keeps one line at `player_start` |
| pace | **parallel**: five orders in one tick deploy together after one build time (M, G3 sheet) | **serial**: each line builds one unit at a time, at the `build_time_s` every unit already authors. That is the cooldown, with numbers already on the cost curve |
| contested | not a concept | **no production while the camp is contested**: the line's clock stops and nothing deploys until the ground is clear |
| destination | the unit stands at the camp exit | **a player-set rally point** per line; a finished unit walks there |
| the enemy | campaign enemies are authored placements; nothing buys | a mission may give side 1 a camp, a purse and a menu; a **spend-down rule** buys through the **same line rules** (serial, contested pause, F3's cap) |

**Architecture:**
- **A production line is a small pure state machine** (`production.ts`): a queue, the item in
  progress, ticks remaining, a rally point. `MissionRuntime` owns one per production anchor per side,
  advances it once a tick with a `contested` flag, and spawns through the existing `spawnPlacement`
  path. It replaces the flat `buildQueue` array.
- **The rally order is a sim command**, `move`, queued for the spawned ids on the deploy tick. The
  runtime already spawns through the sim and the sim already takes `move`; nothing new crosses the
  boundary, and invariant 4 holds (the runtime issues commands, it does not write positions).
  *(6 Oct: under #402 a plain `move` runs a foot unit through holding fire. Ruled 6 Oct: the
  runtime queues `hold` when the unit arrives (Hold position, `2026-10-06-hold-position.md`, H-D5),
  also a sim command through `queueCommand`.)* *(Ruling (lead, 2026-10-11): superseded. The rally is
  one no-sweep `attackMove`; there is no `hold`.)*
- **The enemy's spender is a pure function** (`spendDown`) over its menu, its purse, its population
  room and its line state, so its behaviour is unit-tested before any mission authors an enemy camp.
  **No shipped campaign mission authors one in Stage 4** (D7); G-G's commander (Stage 5) is the first
  real customer, and a harness probe is the witness until then.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-183 F4 and F5; GH-136 (the field camp as the production site).
- GH-167 (G3) Q3, the lead on 4 Oct: *production at the field camp (one queue per camp, build time,
  no production while the camp is contested, AI spends its budget the same way). Addition: the
  player sets a rally point, where a unit goes when it is ready.*
- The G3 decision sheet (PR #369, `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`), Q3:
  the parallel queue, the camp missions (the sheet says 8, "6 via `structures`, `umm_zeitoun_3/4`
  via the map symbol `c`"; no map has ever carried a `c` tile, and the tree has **six**, one camp
  each, all via `structures`; see "Changed since 4 Oct"), the spike's AI banking (3,816 unspent
  against a passive player; 670–1,630 unspent at 1.63× in `naive` games; M on the spike branch
  `spike/skirmish-g0` at `2cd77e4a`, whose sim does not carry #402), the officers' "never charged" prices
  (officers stay a deploy slot), and GH-115/GH-109's limits (no construction yard, no power, no sell,
  no mirrored tech trees).
- F2 (`2026-10-04-gf2-held-ground-income.md`): side 1's purse from held zones. F3
  (`2026-10-04-gf3-population-cap-on-loan.md`): the cap and the queue reservation.
- Field works plan (`2026-09-29-field-works.md`, Stage 5): a work that produces would be a second
  line; F4 does not add any.

**Base:** read against `main` `067fab9a`, refreshed against `b44df7aa` (6 Oct). Branch
`feat/gf4-production`, cut from `main` after F2 lands. Nothing measured yet: (M) is quoted from the
G3 sheet (measured before GH-382 and #402), (R) is reasoned.

---

## Decisions

- **By the lead, 4 Oct (G3 Q3):** as in the table and Refs.
- **Recorded from G3 (no new ruling needed):** officers stay a deploy slot and are never built from a
  line; no camp is built by the player in Stage 4 (a buildable camp is a field-works question for
  Stage 5, inside GH-115's limit).
- **Taken defaults (confirm or overrule):**
  - **D1. Contested** means a living, surface, ground unit of the other side within
    `CONTEST_RADIUS_SQ` (6 tiles, the hold rule's own number: `mission.ts` ~L416, 2359296 = (6 × 256)²,
    compared on `>> 8` deltas in `contestedIn`, `mission.ts` ~L1575) of the line's exit point. Aircraft do
    not contest a camp (the #279 ruling (a) principle, as in F1 and F2). `contestedIn` has no air
    skip today, so D1's is new code. *(6 Oct: GH-382 put Deir Amun II's gate fight inside this
    radius. Ruled 6 Oct: intended, a contested camp pauses.)*
  - **D2. A mission with no camp keeps one line at `player_start`**, and the contested rule applies
    to that point too: reinforcements arrive at a point the player holds (#183 F4). A mission with
    neither builds nothing, as today.
  - **D3. Pay at queue time, as today.** Cancelling a queued item refunds it in full; cancelling the
    item in progress refunds it in full too (the unit never existed). The F3 population reservation
    is released with it.
  - **D4. A camp that dies loses its line**: the item in progress is lost, queued items are refunded,
    and the rally point goes with it. Today's "field camp destroyed — no production" stands once the
    last camp is gone.
  - **D5. The rally order is ~~a `move`, not an attack-move~~ a no-sweep `attackMove` (ruling (lead, 2026-10-11)).** A rally point on a blocked tile is
    refused (the set call returns false), never snapped. A rally point is per line and survives
    until cleared or the camp dies. No rally point: the unit stays at the exit, as today. *(6 Oct:
    the sim's own `move` snaps a blocked goal to the nearest open tile, `sim.ts` ~L2063 onward, so
    the refusal is the runtime's check. Under #402 a `move` runs a foot unit through holding fire,
    and an attack-move would not hold the point.)* **Ruled 6 Oct (lead):** on arrival the runtime
    issues Hold position (`2026-10-06-hold-position.md`). "Arrived" is the first tick the rallied
    unit reads `moving === 0` (H-D5). The unit then stays, kneels and fires at anything in range,
    and the closing rule cannot walk it off. The next order the player gives releases it (H-D2).
    *(Ruling (lead, 2026-10-11): replaced. The rally is `{ kind: 'attackMove', ids, x, y }` with no
    `sweep`; it fights on the way and holds on arrival because `stepSweep` skips a no-sweep
    attack-mover (#537). No arrival hook, no `hold`. A blocked rally point is still refused by the
    runtime, as above.)*
  - **D6. Which line a build goes to**: the line the caller names; with none named, the line with the
    fewest items, ties to the lowest index. The dock names the selected camp (S-F).
  - **D7. No shipped campaign mission gives side 1 a camp in Stage 4.** Every campaign enemy stays
    authored. The enemy half is proved on fixtures and a harness probe (Task 9), and G-G spends
    through it in Stage 5. A mission that wants a buying enemy later is a campaign design decision
    with its own playtest proof.
  - **D8. The spend-down rule**: whenever side 1's line is idle and its purse covers the cheapest
    affordable menu item that fits its population room, it buys the next affordable item in menu
    order (round-robin from the last item bought). It never banks for a dearer item. Deterministic,
    no `rng`, and it spends to zero, which is the property the spike lacked (3,816 banked, M).
    Smarter spenders (gap-driven, the spike's) are G-G's.

---

## Global Constraints

- **The four invariants hold.** Line clocks are integer ticks. No `rng` (D8 is deterministic by
  construction). The runtime issues ~~`move` commands, and since the 6 Oct ruling `hold` commands,~~
  no-sweep `attackMove` commands (ruling (lead, 2026-10-11)) through `sim.queueCommand`; it never writes a position. No floating point added.
- **Sim pins unmoved** by every task (R): the golden replays build no `MissionRuntime`. A move is a
  defect. *Pre-flight 2 (2026-10-11): on `49715ff9` they are three, flat **1202444260**, relief
  **3354895120**, orders **2737216487** (#537).* On `main` they read flat **922714084** and relief **3200430224**
  (`packages/sim/src/determinism.test.ts` ~L427 and ~L721; 2109596329 and 1425295494 on 4 Oct, both
  moved by #402).
- **The economy pins move once**, in Task 6, with the reason.
- **`pnpm balance`** byte-identical (R).
- **`pnpm playtest`**: exit 0 at every commit. Lines that move are the missions whose plans build
  (`beit_sahwan_2_foothold`, `deir_amun_2_foothold`, `wadi_halam_2_laager`, M; *Pre-flight 2: plus
  `wadi_halam_4_village` and `umm_zeitoun_3_clearance` since #542, and every plan on 30/30 seeds*) and, through serial
  timing, nothing else (R): a plan that builds nothing cannot see a line. Every plan still wins;
  every passive control still loses. *(6 Oct: there is a fourth `requestBuild` site, `boughtProbe`
  (`playtest.ts` ~L2609). Its two `(bought)` lines each build one unit at t=0, at `player_start`,
  since `beit_sahwan_4_subterranean` and `umm_zeitoun_4_clearance` have no camp. Serial timing
  cannot move a single build; D2's contested rule could (R). D1's pause, not only serial timing,
  can move the two camp plans; see "Changed since 4 Oct". `maxTierProbes` replays the building
  plans at max tier too.)*
- **The memory gate is untouched by F4 itself** *(11 Oct, #474/#479)*. `pnpm perf:memory -- --gate`
  walks `DEFAULT_MISSIONS` (`tools/src/perf/memory.ts`): `qarn_hadid_3_clearance`,
  `umm_zeitoun_4_clearance` and `khan_rafid_3_clearance`. All three are `resources` missions with no
  camp and no `structures`, so D2 gives each a `player_start` line, and the walk never orders a
  build, so no deferred buildable is decoded. The six camp missions are not in the walk. If a task
  adds a build order to a walked mission, or `enemy.production` to one, re-read `bitmapsMiB` and
  the GPU budget in `tools/src/perf/memory-budgets.ts`.
- **Every check seen red**, by a one-line mutation, quoted in the commit.
- **Gates before every commit:** as F1, plus `pnpm validate:data` for Task 7.
- **Git, TypeScript, lane:** as F1. The dock, the rally input and its marker are WP-S-F's (Lane A).

---

## File structure

| File | Role | Task |
|---|---|---|
| `docs/campaign/economy/production-numbers.md` | **New.** G-NUM and the D-list for the lead | 1 |
| `packages/sim/src/production.ts` (+ test) | **New.** Pure: `ProductionLine`, `advance`, `cancel`; `spendDown` | 2, 8 |
| `packages/sim/src/mission.ts` (+ test) | Lines per anchor per side; contested; rally; enemy purse and spender; the `production` getter (`mission.ts` ~L799) per line | 3, 4, 5, 9 |
| `packages/sim/src/structures.ts`, `packages/sim/src/sim.ts`, `data/schemas/mission.schema.json` | `structures[].side` (a placement-level `produces_for` override; per-structure state lives in `Sim`, see Task 7) | 7 |
| `data/schemas/mission.schema.json`, the `validate:data` script (`tools/validate_data.mjs`) | `enemy.production` | 7 |
| `packages/sim/src/determinism.test.ts` | The economy re-pin | 6 |
| `packages/app/src/main.ts`, `ui/production.ts`, `ui/dock-model.ts` | Call sites `typecheck` forces (the `production` shape, read as `DockView.production`, `ui/dock-model.ts` ~L64) | 3 |
| `tools/src/backtest/playtest.ts` | Plan re-proofs | 10 |
| `tools/src/backtest/enemy-production-probe.ts` | **New.** The witness for D7/D8 | 9 |
| `docs/GDD.md` §3, `docs/campaign/README.md`, `CLAUDE.md`, `docs/HANDOVER.md` | Contract and ledger | 11 |

---

## Task 1: the numbers and the D-list (G-NUM; halts for the lead)

**Model:** opus. **Agent:** `balance-analyst`.

- [ ] **Step 1: Serial timing on today's plans.** On a scratch copy of the runtime with a serial queue
  (never a tracked edit), run the three building plans and report, per build: queue tick, deploy tick
  parallel vs serial, and the outcome line. This says before any code whether a plan needs re-timing
  (Task 10) and by how much.
  *(6 Oct: measure on GH-382's ground and with #402 in the sim, since nothing was measured on
  4 Oct. The three plans are `playtest.ts` ~L514 (one `inf_squad` at 120 s), ~L809 (every 60 s
  from 90 to 700, at `player_start`) and `deirAmun2Plan` ~L1679 (every 40 s from 60 to 420, camp
  (21,35)). Run D1's contest test in the same scratch copy too: both camp plans' wave targets lie
  within 6 tiles of the camp exit ("Changed since 4 Oct"). Note the two `(bought)` probes as well.)*
- [ ] **Step 2: Build times.** Tabulate `build_time_s` (authored as `cost.build_time_s`, read as
  `unitInfo().buildTimeS`; every KDF unit is buildable, `unitInfo` in `main.ts`, ~L2332) for every buildable KDF unit. A serial line
  turns them into the pace of a whole mission: at 7 minutes, a 30 s unit is 14 a line at most. Flag any
  build time that makes a five-to-seven-minute mission's dock pointless or instant.
- [ ] **Step 3: The D-list.** D1–D8 go to the lead in one comment on #183, each with its alternative.
  Record the answer and the date. Tasks 3–9 read only the answered rules.

---

## Task 2: the production line, as a pure state machine

**Model:** sonnet. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/production.ts` (new), `production.test.ts` (new).

**Interfaces:**

```ts
export interface LineItem { unit: string; logistics: number; intel: number; population: number; buildTicks: number }
export interface ProductionLine {
  readonly side: 0 | 1; readonly anchor: number;   // structure index, or -1 = player_start (D2)
  queue: LineItem[]; current: LineItem | null; ticksLeft: number;
  rally: { x: Fx; y: Fx } | null;
}
/** One tick. Returns the item that finished this tick, or null. A contested line
 *  does not count down and does not finish (G3 Q3). */
export function advance(line: ProductionLine, contested: boolean): LineItem | null;
export function enqueue(line: ProductionLine, item: LineItem): void;
/** D3. Removes queue index i (-1 = the item in progress) and returns it for the refund. */
export function cancel(line: ProductionLine, i: number): LineItem | null;
```

- [ ] **Step 1: Write the failing tests:**
  - two items queued in one tick finish `buildTicks` apart, not together (the defect G3 named);
  - a contested tick stops the count: 10 contested ticks in the middle delay the finish by exactly 10;
  - an item that would finish on a contested tick finishes on the first clear tick after it;
  - cancelling the item in progress starts the next one on the next tick, with its full build time;
  - cancelling a queued item returns it and leaves the current one untouched;
  - an empty line stays idle and never returns an item.
- [ ] **Step 2: Implement.** No allocation per tick on the idle path.
- [ ] **Step 3: See it red.** Decrement while contested: the contested test fails. Start the next item
  with `ticksLeft` carried over from the cancelled one: the cancel test fails.

---

## Task 3: lines in the runtime, serial for the player

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 1, 2.

**Files:** `packages/sim/src/mission.ts` and its test; app call sites only.

**Interfaces:**

```ts
/** D6. `line` is an index into `productionLines(0)`; omitted = the shortest queue. */
requestBuild(unitId: string, line?: number): boolean;
cancelBuild(line: number, index: number): boolean;      // D3 refund, F3 reservation released
productionLines(side: 0 | 1): readonly { anchor: number; exit: [Fx, Fx]; queued: number;
  current: string | null; progress: number /* 0..1000, integer */; contested: boolean;
  rally: [Fx, Fx] | null }[];
// The `production` getter (mission.ts ~L799; the dock reads it as DockView.production,
// ui/dock-model.ts ~L64) keeps its shape { unit, doneTicks, totalTicks, ticksLeft }[] for the
// dock until S-F, flattened across lines.
// (11 Oct) It lists QUEUED items too, not only each line's current one, and a queued item reads
// doneTicks 0, totalTicks = its buildTicks, ticksLeft = the ticks ahead of it plus its own.
// Two readers depend on that: `main.ts`'s per-tick `runtime.production` loop calls
// `three.warmUnitMesh(p.unit)` (GH-469: a queued build is the cue to decode a deferred
// buildable's textures, 12 s or more before the unit exists), and `dock-model.ts`'s tile bar
// takes the nearest item of each type.
```

- [ ] **Step 1: Write the failing tests:**
  - **"two builds queued in one tick deploy one build time apart"** on a camp mission (red on
    `main`: they deploy together);
  - **"two camps are two lines"**: one build on each deploys together, each at its own camp's exit;
  - **"a mission with no camp builds at `player_start`, serially"** (D2);
  - **"a camp's death loses the item in progress and refunds the queue"** (D4); with the last camp
    gone, `buildBlockedReason` still reads "field camp destroyed — no production";
  - the F3 cap and reservation still bind across lines (one reservation pool per side);
  - `cancelBuild` refunds logistics and intel exactly;
  - *(11 Oct)* **"a queued item is in `production` from the tick it is queued"**: the getter lists the
    second serial item at once, with `doneTicks` 0. Without it `warmUnitMesh` (GH-469) would not
    decode a second type's textures until its turn, and the unit would draw late.
- [ ] **Step 2: Implement.** Lines are built at construction from the structures with
  `producesFor === side` (map and mission alike, in structure index order). No shipped map carries
  a `c` tile; every shipped camp is a mission `structures` entry, raised by `raiseMissionStructures`
  (`mission.ts` ~L1219), which runs in `start()` before any force spawns. So build the lines in or after
  `start()`, not in the constructor. `productionAnchor` stays for `buildBlockedReason`. The flat
  `buildQueue` goes.
- [ ] **Step 3: Measure.** Sim pins unmoved. `playtest`: the three building plans' lines may move
  (Task 1 Step 1 predicted by how much); nothing else moves. Do not edit plans here; Task 10 owns that.
  If a building plan now **fails**, stop: Task 10 must land in the same PR before this task's commit
  can be green, so reorder within the branch and say so.
- [ ] **Step 4: See it red.** Put every build on line 0 whatever D6 says: "two camps are two lines"
  fails. Keep the old parallel push beside the line: the first test fails.

---

## Task 4: no production while the camp is contested

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 3.

**Files:** `packages/sim/src/mission.ts` and its test.

- [ ] **Step 1: Write the failing tests:**
  - an enemy squad 5 tiles from the camp exit freezes the line; at 7 tiles it does not (D1);
  - the same enemy squad buried in a tunnel below does not contest (the `tunnelIn` guard);
  - an enemy drone over the camp does not contest (D1);
  - a line frozen for 15 s finishes 15 s late, and the `built` event carries the real tick;
  - the `player_start` line (D2) is contested by the same rule;
  - `productionLines(0)[i].contested` reads true on exactly the frozen ticks (the HUD's flag).
- [ ] **Step 2: Implement.** One contest test per line per tick, sharing the hold rule's distance
  arithmetic (extract it from the objective code rather than copying it). That code is
  `contestedIn`, `mission.ts` ~L1575–1597. It hard-codes side 1 against side 0, is gated on the zone,
  and carries the `tunnelIn` guard but no air skip. *(6 Oct: since #402 a foot patroller that holds
  a target is halted by `stepPatrols` (`mission.ts` ~L1536) and stays put. A fixture whose patrol
  meets the player beside a camp therefore freezes the line for as long as the patroller holds a
  target (R). Every patroller in the six shipped camp missions is a vehicle.)*
- [ ] **Step 3: See it red.** Test `CONTEST_RADIUS_SQ * 2`: the 7-tile case freezes. Drop the air skip:
  the drone test fails.

---

## Task 5: the rally point

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 3.

**Files:** `packages/sim/src/mission.ts` and its test, `packages/sim/src/index.ts`.

**Interfaces:**

```ts
/** D5. False on a blocked tile, an off-map point, an unknown line, or after the mission ended. */
setRally(line: number, x: Fx, y: Fx): boolean;
clearRally(line: number): boolean;
```

- [ ] **Step 1: Write the failing tests:**
  - with a rally point, a finished unit receives a ~~`move`~~ no-sweep `attackMove` (ruling (lead, 2026-10-11)) to it on its deploy tick, and arrives;
  - with none, it stands at the exit (byte-identical to Task 3's behaviour);
  - a rally point on a `#` tile is refused and the previous one is kept;
  - a rally point set while an item is in progress applies to that item;
  - a multi-unit placement (a team of three) moves as one group order, so it lands in formation
    (`formation.ts`), not stacked on one tile (CLAUDE.md, "units stack on one tile is a bug").
    *(6 Oct: a line deploys `{ unit, count: 1 }` today (`mission.ts` ~L1087–1091), one entity per
    item, so this case needs a fixture with count > 1. The case shipped content reaches is two
    items rallied one build time apart. Each is a one-unit `move`, and `assignFormation`'s
    `reservedTilesFor` (`sim.ts` ~L2015) keeps the second off the first's tile. Pin that too.)*;
  - *(6 Oct, #402)* a foot unit with a rally point never drops at the exit: `spawn` resets it to
    `BRACE_NONE` (`sim.ts` ~L1757), and the `move` queued in `runtime.step` is applied before the next
    tick's `stepBrace`. It walks holding fire and kneels on arrival. A unit with no rally kneels at the
    exit after `KNEEL_DROP_TICKS`; *(Ruling (lead, 2026-10-11): under the no-sweep attack-move it does
    not hold fire on the way: it halts to fire at what comes into range, as any attack-mover does under
    #402, then walks on. Pin that instead of "walks holding fire".)*
  - *(ruled 6 Oct)* **"a rallied unit holds on arrival"**: on the first tick it reads `moving === 0`,
    the runtime queues one `hold` for it (Hold position, H-D5), and `sim.state.holdPos` reads 1.
    An identified enemy out of its reach does not walk it off the point; the control is the same
    layout with no `hold`, where an attack-mover would be walked off;
    *(Ruling (lead, 2026-10-11): the rally is a no-sweep attack-move and there is no
    `hold`: the test asserts the unit is still on the point 10 s after arriving with an identified
    enemy out of reach, and the control is the same order with `sweep: true`, which walks off. Seen
    red by setting `sweep: true` on the rally order.)*
  - the rally order reaches the sim through `queueCommand` and nowhere else: a test spies the
    command queue and asserts one `attackMove` with the spawned ids and no `sweep` (ruling (lead,
    2026-10-11); it read `move`).
- [ ] **Step 2: Implement.** `spawnPlacement` already returns the spawned ids (`number[]`,
  `mission.ts` ~L1259); queue the `move` for them in the same tick. *(The move is `{ kind: 'move', ids,
  x, y }`, `sim.ts` ~L594. Ruled 6 Oct: the walk stays a `move`, and the runtime keeps the rallied ids
  and queues `{ kind: 'hold', ids }` for each one as it arrives (`2026-10-06-hold-position.md`,
  on `main` before F4).)* *(Ruling (lead, 2026-10-11): queue `{ kind: 'attackMove', ids, x, y }` with
  no `sweep`, and nothing on arrival.)*
- [ ] **Step 3: See it red.** Skip the arrival `hold`: "a rallied unit holds on arrival" fails.
  *(Ruling (lead, 2026-10-11): there is no arrival `hold`; the mutation is "set `sweep: true` on the
  rally order", and "a rallied unit holds on arrival" fails.)*
  Write `goalX/goalY` directly instead of queueing a command: the spy test
  fails (and invariant 4 says why it must). Both fields are private on `Sim` (`sim.ts` ~L882; read
  through `goalOf`), so the mutation needs a cast. Accept blocked tiles: the `#` test fails.

---

## Task 6: the economy pin learns production

**Model:** haiku. **Agent:** `sim-guard`. **Depends:** Tasks 3–5, F1 Task 1.

**Files:** `mission.ts` (`economyHash`), `determinism.test.ts`.

- [ ] **Step 1:** `economyHash` folds every line (side, anchor, queue units and costs, current,
  ticks left, rally) in line order. The F1 fixtures gain a second camp, a rally point, a cancel, and
  an enemy squad that contests one camp for 10 s.
- [ ] **Step 2: Re-pin once.** Commit: *"economy pins re-pinned: serial production lines per camp,
  the contested pause and rally points (G3 Q3, lead 4 Oct); the fixtures gained a second camp, a
  rally point, a cancel and a contested window; was N / M"*. Coverage: assert the replay passes
  through a frozen line, a refund and a rally arrival.
- [ ] **Step 3: See it red.** Hash `ticksLeft` but not `rally`: a fixture variant with a different rally
  point hashes the same, and the pair test written for it fails.

---

## Task 7: an enemy camp and its menu, in the schema

**Model:** sonnet. **Agent:** `mission-author`. **Depends:** Task 1.

**Files:** `data/schemas/mission.schema.json`, `packages/sim/src/structures.ts`,
`packages/sim/src/mission.ts` (types only), the `validate:data` script and its tests.
*(6 Oct, verified on `b44df7aa`. `tools/validate_data.mjs` has no spec of its own: a testable rule
goes in a sibling module with its own `tools/src/validate_<x>.test.ts`, as
`tools/validate_briefing.mjs` and `tools/src/validate_briefing.test.ts` do. `produces_for` is a
TYPE field (`structures.ts` ~L92, `StructureType.producesFor`), so a per-placement `side` is new
per-structure state in `Sim` (`sim.ts`). Its readers are `productionAnchor` (`mission.ts` ~L601),
`declaresProduction` (~L632) and `stepDemolition`'s own-camp skip (`sim.ts` ~L4914). Without the
last, side 1's own demolishers would level an enemy camp. The override is fixed at `start()`, so
leaving it out of `hash()` keeps the sim pins unmoved, as the Global Constraints require (R).)*

**Interfaces (schema):**

```json
"structures[].side": { "type": "integer", "enum": [0, 1],
  "description": "Overrides the structure type's produces_for for this placement. A camp placed for side 1 is the enemy's production site." },
"enemy.production": { "type": "object", "additionalProperties": false,
  "required": ["menu"],
  "properties": {
    "logistics_start": { "type": "integer", "minimum": 0 },
    "logistics_rate_per_min": { "type": "integer", "minimum": 0 },
    "menu": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "rally": { "type": "string", "description": "Map marker built units walk to." },
    "tag": { "type": "string", "description": "Group tag given to built units, so triggers and waves can commit them." } } }
```

*(6 Oct, verified: a trigger's `commit` addresses a placement's **`group`**, not its `tag`
(`mission.ts` ~L1690–1701; the schema's `$defs.placement` says "Trigger orders address groups", and
`tag` is "Objective targeting (eliminate_hvt, locate)". Waves spawn their own units and commit
nothing. As written, Task 9's "a trigger that `commit`s that tag" cannot be expressed. For its
stated purpose the field must give built units a `group`, by renaming it or adding one beside
`tag`. This is a field name, not a ruling.)*

*(11 Oct, verified: `missionUnitTypes` (`packages/app/src/mesh-catalogue.ts`) walks the whole mission
JSON for any string that is a unit id, so `enemy.production.menu` is loaded at boot with no code
change. Those meshes are not "cold" (only deferred KDF buildables are), so a mission that adds a
menu adds decoded textures to its `bitmapsMiB` reading. None does in Stage 4 (D7).)*

- [ ] **Step 1: Write the failing validator tests:** a menu unit that is not an enemy unit (`data/units/enemy/`) is
  refused (no mirrored tech trees, GH-109); an unknown rally marker is refused; `enemy.production` with no
  side-1 camp in `structures` is refused; `pop_cap`-style refusals do not apply (the enemy has no
  cap in the campaign).
- [ ] **Step 2: Implement.** `validate:data` passes on the shipped tree (no mission uses either field,
  D7).
- [ ] **Step 3: See it red.** Remove the side-1 camp check: a menu with nowhere to build passes.

---

## Task 8: the spend-down rule, as a pure function

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 2.

**Files:** `production.ts` and its test.

**Interfaces:**

```ts
/** D8. The next unit to buy, or null. `last` is the menu index bought last (-1 at start). */
export function spendDown(menu: readonly LineItem[], last: number, purse: number,
  popRoom: number | null, lineIdle: boolean): number | null;
```

- [ ] **Step 1: Write the failing tests** (literal menus and purses):
  - an idle line with enough for two items buys the next in round-robin order;
  - a busy line buys nothing (serial: the enemy waits like the player);
  - an unaffordable next item is skipped for the next affordable one; it never waits to save up;
  - no room under the cap (F3) buys nothing; room for 1 skips a 2-pop item;
  - **the property**: over any purse sequence, the spender never holds more than the dearest menu item
    while its line is idle (it spends down). Run it over a fixed table of 50 literal purses, not a
    random generator.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.** Return the dearest affordable item instead of round-robin: the order test
  fails. Wait for the next item when unaffordable: the property test fails.

---

## Task 9: the enemy buys through the same line

**Model:** sonnet. **Agent:** `sim-guard`, then `playtest`. **Depends:** Tasks 3–8, F2 Task 7.

**Files:** `packages/sim/src/mission.ts` and its test,
`tools/src/backtest/enemy-production-probe.ts` (new).

- [ ] **Step 1: Write the failing tests** (a fixture with `enemy.production`):
  - side 1's purse is `logistics_start` + its rate + F2's held-zone income for side 1, in the same
    integer accumulator F2 introduced (1/2400ths since F2's 6 Oct refresh, so that a halved odd
    rate stays exact; it read 1/1200 on 4 Oct);
  - it buys through `spendDown`, one unit at a time, and its line freezes when a KDF squad contests its
    camp (the same rule, G3 Q3);
  - built units get the authored `tag` and walk to the `rally` marker, and hold there on arrival
    (ruled 6 Oct: the same `hold` the player's rally issues); *(Ruling (lead, 2026-10-11): the same
    no-sweep attack-move the player's rally issues, and no `hold`)*;
  - a trigger that `commit`s that tag sends them on, which is how authored content and bought units
    meet. *(6 Oct: `commit` reads a `group` (see Task 7's note) and issues an attack-move
    (`mission.ts` ~L1701), which releases them from Hold (H-D2). The walk to `rally` is a `move` by
    D5, so under #402 a bought foot unit walks past KDF troops holding fire until it arrives, then
    holds (ruled 6 Oct).)*;
  - with no `enemy.production` block, side 1 never buys, even with a purse from zones (D7: today's
    campaign behaviour);
  - *(11 Oct)* **a side-1 purchase emits no `built` event.** `built` is the player's "reinforcement
    arrived" signal: `ui/alerts.ts` words it as `alert.arrived` (minor, info, `world.arrivedAt` scans
    side 0), `voice/announce.ts` says "reinforcements", and `cues.ts` has a row for the kind. An
    enemy purchase through the same event would announce the enemy's units as ours. The test
    asserts the event list holds no `built` for a bought enemy unit.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: The witness.** `enemy-production-probe.ts` loads `tel_marum_3_clearance` and, in
  memory only, gives side 1 a camp at its battery position, a purse of 1.6× the KDF's starting
  logistics (Q7's ratio, applied here only as a probe number), and a menu of `sarim_rifles` and
  `atgm_cell`. It runs the shipped plan and a passive control over the 30-seed list the G3 sheet names
  and prints, per run: units bought, unspent at the end (as a share), outcome, length. Report-only, no
  gate: C5 (spending) is report-only at G4 by the lead's own table. The expected reading is unspent
  near 0% (R, D8), against the spike's banked thousands.
  *(6 Oct, verified on GH-382's `tel_marum_3`: `battery_position` is still a marker, at (25,6), and
  `sarim_rifles` and `atgm_cell` are in `data/units/enemy/`. Both halt to fire under #402. But the
  HVT `rocket_battery` stands at (25.5,6.5). A 2×2 camp placed at the marker covers its tile, and
  `raiseMissionStructures` runs before spawns, so `assertGroundClear` (`mission.ts` ~L1131) refuses the
  load. This was equally true on 4 Oct. Place the probe's camp on open ground beside the marker
  and name the tile in the probe. The KDF's starting logistics there are 400, so the purse is 640.
  The 30-seed list (`424242 … 8888` plus `11 … 777`, G3 sheet Q6) lives in the spike harness on
  `spike/skirmish-g0`, not on `main`. On `main` a playtest run takes its seed from `PT_SEED`
  (`playtest.ts` ~L201–202, default 424242). The passive control is `playtest.ts` ~L1962.)*
  *(Pre-flight 2, 2026-10-11: `main` now sweeps 30 seeds itself, 424242 then 1..29 (#539, #542;
  `passive-sweep.ts`, `plan-sweep.ts`). Use that set and its worker pattern, and say the set is not the
  G3 one. `PT_SEED` is read in `playtest-run.ts` ~L228; the passive controls are `passiveAcrossSeeds`
  calls.)*
- [ ] **Step 4: See it red.** Let side 1 build in parallel (skip the line): the "one unit at a time"
  test fails, and the probe's bought count jumps.

---

## Task 10: the plans re-proved

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Tasks 3–5.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1:** Re-run every plan (30 seeds; Pre-flight 2). For each of the three building plans
  (five since #542: add `wadi_halam_4_village` and `umm_zeitoun_3_clearance`), if the serial line changed
  its outcome, re-time its `requestBuild` calls to the same intent (the same units, queued earlier or
  on two camps where the mission has two) rather than changing what it buys. Comment each change with
  Task 1's parallel-vs-serial ticks. *(6 Oct: no shipped mission has two camps; each of the six
  stands one.)*
- [ ] **Step 2: One plan uses a rally point.** `deir_amun_2_foothold`, the one plan that spends for
  replacement (M, G3 sheet), sets its camp's rally point at its forward position, so the rally path is
  exercised by the gate and not only by unit tests. It must still win.
  *(6 Oct: on GH-382's ground the forward position is the pump gate the hold force takes,
  `M(15, 31)` in `deirAmun2Plan` (`playtest.ts` ~L1661, ~L1669), beside the `pump_gate` marker
  (15,32). It is 6.5 tiles from the camp exit (20.5,34.5); on 4 Oct the gate was `M(15, 27)` on
  the old `deir_amun` ground. Today the plan never orders its bought squads, so they kneel at the
  exit. Under D5 and #402 they walk into the gate fight holding fire, and hold there on arrival
  (ruled 6 Oct). *(Ruling (lead, 2026-10-11): under the no-sweep attack-move they fight their way into
  the gate and hold there.)* The camp's 6-tile radius covers `pump_gate`, so D1 pauses the line during that
  fight, which is intended (ruled 6 Oct). Measure both before re-timing.)*
- [ ] **Step 3: Measure.** Every plan wins; every passive control loses; banking lines (F2) printed
  and their pins re-read; `LADDER_CREDITS` and `GATES` re-pinned only where a grade or `unitHome`
  moved, with the per-mission terms in the comment. *(Pre-flight 2, 2026-10-11: **5917** on
  `49715ff9`, ~L3096; `GATES` ~L2820.)* *(6 Oct: `LADDER_CREDITS` is **5870** on
  `f2d5d9e8` (`playtest.ts` ~L3195; 5830 on `b44df7aa`, 5736 on 4 Oct) and `GATES` is unchanged (`playtest.ts` ~L2944). Since
  GH-330, `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts` ~L63, 5870) must move in the same
  commit, or `tools/src/campaign_credits.test.ts` goes red.)*
- [ ] **Step 4: See it red.** Remove the rally call: Step 2's plan line returns to its no-rally timing,
  proving the gate sees the rally (state the moved figure in the commit).

---

## Task 11: contract and ledger

**Model:** haiku.

**Files:** `docs/GDD.md` §3, `docs/campaign/README.md`, `CLAUDE.md` (the production lines under
"Dev instruments" if the dock's behaviour is described there; the GH-136 status), `docs/HANDOVER.md`.

- [ ] **Step 1:** GDD §3: one line per camp, build time as the pace, the contested pause, the rally
  point, the enemy buying the same way, officers outside the line. GH-115/GH-109's limits restated.
- [ ] **Step 2:** `docs/campaign/README.md`: `structures[].side` and `enemy.production` in the schema
  digest, with D7 (no campaign enemy buys in Stage 4).
- [ ] **Step 3:** `docs/HANDOVER.md` §1, §3 (D1–D8 as answered), §4. Close GH-136 in the PR body.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat, relief and orders (three since #537) | **unmoved** (R): 1202444260 / 3354895120 / 2737216487 on `49715ff9` (Pre-flight 2); 922714084 / 3200430224 on `main` at `f2d5d9e8` (2109596329 / 1425295494 on 4 Oct, moved by #402) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 6 (born in F1; not on `main` yet) | serial lines per camp, the contested pause, rally points (G3 Q3) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | the three (five since #542, Pre-flight 2) building plans' lines move (serial timing, the contested pause, and one rally) | Task 10's plan edits, each commented |
| `LADDER_CREDITS` | **5917** on `49715ff9` (Pre-flight 2); 5870 on `f2d5d9e8` (5830 on `b44df7aa`, 5736 on 4 Oct); moves only if a building plan's grade or `unitHome` moves (R) | named per mission |
| `CAMPAIGN_CREDITS` | **5917** on `49715ff9` (Pre-flight 2); moves with `LADDER_CREDITS`, same commit (GH-330, `campaign_credits.test.ts`) | as `LADDER_CREDITS` |

## Lane A needs (WP-S-F #184)

- **The dock per camp** (`ui/dock-model.ts`, `ui/production.ts`; the `b` key stays `production` and
  `focusFirst()`): a camp switcher where a mission has two; each line's queue, the item in progress
  with its progress bar (`progress`, 0–1000), and cancel per item with the refund shown. Chrome
  register (#454, `ui/chrome-register.test.ts`): the refund and the line's logistics/intel figures
  wear `--info` (this mission's currencies, as the tile badges do), credits stay `--commend` (the
  dock head's chip, static), a paused line is `--disabled-opacity` with `not-allowed` only on the
  controls it disables (cancel stays live), `--on` (lime) only for the armed "Set rally" button. The
  camp switcher is a tab (display capitals); "Set rally" and "Clear rally" are `.rl-btn` actions
  (sentence case). Durations from `--dur-*`.
- **"Contested: production paused"** on the line, from `contested`, and a feed alert when it starts.
  *(11 Oct, #428/#461.)* The alert is derived in the app from the edge of
  `productionLines(0)[i].contested`, not from a new `MissionEvent` kind: tier `important` (so Space
  jumps to it), tone `warn` (our capability is stopped, nothing of ours is lost), place = the camp
  exit through `world.placeOf`, `at` = the exit so the minimap flashes it, its cue the tier's own
  (`ALERT_CUE.important`). It needs a new `Alert.kind` (`'production'`) in `ui/alerts.ts`, an
  `alert.productionPaused` line in `en.json` naming the camp and the place, and a cooldown like
  `PINNED_COOLDOWN_TICKS` so an enemy walking the 6-tile edge does not spam it. Resuming is the dock
  line clearing, with no alert. The camp is not an objective zone, so the minimap's zone states
  (`zoneStateOf`) are not extended; the alert ring is the minimap's cue. A new `MissionEvent` kind
  would instead need a `cues.ts` row (`MISSION_EVENT_SOUND`, red on a missing row), a
  `describeMissionEvent` case, `missionEventTier` and an `announce.ts` decision.
- ~~**Hold position** (ruled 6 Oct, its own plan `2026-10-06-hold-position.md`, Task 3): H (`halt`
  moves to X) and a HUD button, landing before this plan. A rallied unit shows as holding on its card and chip.~~
  *(Ruling (lead, 2026-10-11): retired. A rallied unit reads the chip's existing idle "holding" word,
  which is now true of every arrived player unit.)*
- **Setting a rally point**: an armed order from the dock ("Set rally", then a ground click), the same
  arming model as fire support (Escape disarms, #264, closed by #268). There is no structure selection today (FW Task 11
  adds a works-only one in Stage 5), so the dock is the entry point.
  *(11 Oct)* Armed rally is a fourth source for `anyArmed` (`input/keymap.ts`; `escapeTarget` takes
  one boolean), beside the attack-move and smoke orders (`main.ts`'s `armedOrder`) and the support
  call (`production.setArmed`). Like armed smoke and armed support it takes the GROUND point under
  the pointer (#427's wall-to-building resolution does not apply), a blocked tile gets the deny cue
  (`sink.deny`, `ui.deny`; the runtime's `setRally` returned false), and a successful set gets no
  cue (confirm is for primary actions only). The cursor needs a rung in `input/cursor.ts`
  (`cursorFor`, ranked with `armedSmoke`): the move cursor wears the order's ground colour
  (`ORDER_GROUND_COLOR_KEY`, #457), and a rally point is a standing move, so reuse `move` rather
  than a new sight. Pointer-only, like smoke: a keyboard-only player leaves the default (the unit
  stands at the exit). **The rally marker is drawn in
  the world, so it is mocked and shown to the lead before it is built** (memory: mock a world overlay
  first; no status marks in the world). Keep it an order indicator shown while the camp's dock is
  open, not a permanent mark. *(11 Oct)* If approved it is a new `Renderer` method in
  `packages/render/src/api.ts` (`addOrderMarker` is transient), drawn by `ThreeRenderer` only, in
  `ORDER_GROUND_COLOR_KEY` (`vfx.tracer`), with its `renderOrder` taken from `units/render-order.ts`.
  No gated golden scenario opens a dock, so no baseline moves.
- **The tutorial's economy step** *(11 Oct: see lead question 7; `beit_sahwan_0_tutorial` has no
  `resources` block, no camp and no logistics today)*: build, see it pause under fire, set a rally
  point.
- Strings through `t()`.
