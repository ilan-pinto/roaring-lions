# WP-G-F plan F2: income from held ground, and corridors the enemy can cut (GH-183, G3 Q2). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct

Refreshed against `main` `b44df7aa` (6 Oct). Corrections only; every ruling and D-default stands.

**What landed that touches F2**
- **#402 halt and kneel to fire** (`7962b6ea`, spec `2026-10-05-infantry-halt-to-fire.md`), a lead-approved one-off sim change: sim pins flat 2109596329 -> **922714084**, relief 1425295494 -> **3200430224**; `LADDER_CREDITS` 5844 -> **5830** (5736 on 4 Oct, the rest GH-382). `MissionRuntime.stepPatrols` now halts a foot patroller on contact.
- **GH-382** (5 Oct) re-drew all five D7 maps. Zones per D7 map: UZ II 3, UZ IV 4, BS II 2, DA II 6, WH II 4 (were 11/11/6/8/7). Economy maps now 2–7 zones (not 6–11). Roads still on 17 of 18 (not `tel_marum_2`), tunnels still only on BS II/IV and DA II/III, and 16 of 18 economy missions sit on relief. The G3 sheet's (M) numbers were measured at `751b6742`, before GH-382 and #402.
- **GH-330** (`44e5874a`): `tools/src/campaign_credits.test.ts` holds `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts:63`) equal to `LADDER_CREDITS`. **GH-119**: every briefing has `briefing_sections` that must match it (`tools/validate_briefing.mjs`). No `data/locales/*/missions.json` overlay exists.
- Found on this refresh (each was already true at `067fab9a`): `Sim.fieldFor` is private, its domains are numeric and its pool evicts (Task 5); the sim has no road mask (Tasks 5, 7); `tunnelVent(r)` already exists (Task 6); rubble opens a route rather than cutting it; a halved odd rate is not exact in 1/1200ths (Task 1); a test cannot import `validate_data.mjs` (Task 3).

**New interactions**
- Holding is kneeling: an idle foot unit kneels, target or not. Kneeling never moves anyone, so D3's presence test is unchanged.
- **The closing rule moves holders.** In `stepSweep`, an arrived attack-mover walks toward a current target in cover, or toward an identified enemy it cannot reach but could engage. A plain `move` sets `attackMove` 0 and stays. The player's right-click is always an attack-move, and `halt` does **not** clear `attackMove` (the halt branch, `sim.ts` ~L2505-2514), so a halted holder is swept again on the next tick. A player's holding force can therefore walk out of its own zone. `playtest.ts`'s plans carry 124 plain `move` order sites and 59 `attackMove` ones in source, and no `halt`.
- Enemy `commit` triggers and waves are attack-moves too (`mission.ts:1688`, `:1780`), so enemy holders and interdictors chase in the same way.
- **Patrols halt on contact** (D3, D4 b). A foot patroller that meets the player in a zone or beside a route now stays there for as long as the fight lasts. Every patroller on the 18 economy missions is a vehicle (technical, moto_rpg), and #402 leaves vehicles alone, so no D7 mission is touched today; F4 and G-G content will be.
- Enemy foot rifles reach 7–8 tiles (`militia_cell` 7, `sarim_rifles` 8), past `CONTEST_RADIUS_SQ`'s 6. An enemy halted and firing on a guard 7 tiles away reads `interdicted` under D4 b.
- On three of the five D7 maps a zone holds the starting force or the camp: BS II `west_approach`, DA II `staging`, UZ II `staging`. (BS II has since left D7, ruled 6 Oct.)

### For the lead
- **G3 Q2 and D3 under #402.** A player's attack-moved holders leave a zone to chase (`stepSweep`), and `halt` does not stop that. Should "held" still mean bodies present (D3), or does holding need an order that keeps them (a hold or plain-move button, S-F's lane)?
  **Ruled 6 Oct (lead): add a "Hold position" order** (`2026-10-06-hold-position.md`, Wed 4 Nov, before F2). Held zones are kept by Hold: a held unit stays put, kneels, fires at anything in range, and never advances, chases or closes. D3 keeps its presence test.
- **D4 b.** "Contested, not cut" uses the hold radius (6 tiles), while enemy rifles now halt and fire from 7–8. Should a corridor's contest radius be 6, or weapon reach?
  **Ruled 6 Oct:** keep 6. Contest is occupation, not fire.
- **D7 on the new ground.** BS II has only two zones: `west_approach` (the start, the camp and the `hold_for` target) and a 3x3 `tunnel_mouth_west`. Should Task 8 add zones to the map (outside its file list), pay a start zone (then `ZONE_PASSIVE_INCOME` > 0 by construction), or should BS II leave D7?
  **Ruled 6 Oct:** drop BS II from D7. D7 is four missions.
- **D2 (not caused by a landing; also true at `067fab9a`).** On UZ II and UZ IV the rear stands two rows from the south edge, and the only road runs from the rear forward to the fight (to (24,25) and (33,7)), never to an edge. A south-edge `supply_entry` gives a convoy route a few tiles long that nothing reaches. Where should the entry sit?
  **Ruled 6 Oct:** at the map-edge tile nearest the player's start zone, along the shortest passable path. The implementer picks it and pins it (Task 3).
- **Lane C.** F2 now forces two `packages/app` edits: the `CAMPAIGN_CREDITS` copy (GH-330), and the road mask in `packages/app/src/mission-start.ts` (Task 7). Are those within Lane C's allowance, as F1's call-site rename was?
  **Ruled 6 Oct:** within the allowance.

**Goal:** Ground the player holds pays. Ground nobody holds cleanly pays nobody. A line the enemy
cuts pays half.

| | today (`main` `b44df7aa`; the same at `067fab9a`) | after F2 |
|---|---|---|
| logistics | one flat `logistics_rate_per_min` (18 missions, 80–150/min) | the flat rate stays as the **base**; **income zones pay on top**, to whichever side holds them uncontested |
| `supply_corridor` | declared by `umm_zeitoun_2_buildup` and `umm_zeitoun_4_clearance`, **read by nothing** ("a later slice", `mission.ts` income block, ~L1051) | read: a cut corridor **halves** what flows down it |
| contested ground | — | **pays nobody** (the spike's rule: "the rule that made both sides fight for the approach. Keep it", M, G-G0) |
| what cuts a line | — | an enemy holding ground on the route, a route that no longer exists for wheels (ditch, boulders; **not rubble**: a collapse sets its tiles' `blocked` to 0 and "leaves rubble a vehicle can cross", `Sim.destroyStructure`, so rubble can only open a route), and an open tunnel vent beside it |

**Architecture:**
- **All of it is `MissionRuntime`.** Zone ownership, the corridor route and the cut test read sim
  state (positions, sides, `sim.state.tunnelIn`, `sim.blocked`, `sim.boulder`, the vehicle mask
  `sim.blockedVehicle` = `blocked | boulder`, `sim.tnVentOpen`, `sim.elevation`) and write nothing
  back. No new sim state, so the two sim pins do not move (G3 sheet, "one correction").
- **Two pure modules carry the rules**, so each rule is unit-tested on literal grids before any
  mission sees it: `income.ts` (who holds a zone) and `corridor.ts` (the route and whether it is cut).
- **The route is the flow field the sim already has**, in the wheeled domain (a convoy is trucks),
  through `Sim.fieldFor`'s cache. No per-unit A* (CLAUDE.md, "What not to do").
  *Refresh correction:* `Sim.fieldFor(gx, gy, domain: number)` (`sim.ts` ~L1885) is **private**. Its
  domain is numeric: `DOMAIN_FOOT` 0 and `DOMAIN_VEHICLE` 1 (`sim.ts:232-233`). There is no
  `'wheeled'` value; a unit's `mobility.wheeled` picks `DOMAIN_VEHICLE`. On a map with no boulders it
  collapses to `DOMAIN_FOOT`, because the two masks are one array there. It also returns an index into
  a pool that, once past `MAX_FLOW_FIELDS` (128), reuses any field no living unit's `fieldRef` holds.
  An index the runtime kept could be recomputed for another goal under it, and calling it writes
  sim state, which this plan forbids. So the route is the **same `FlowField`**, built by the
  runtime: `new FlowField(w, h).compute(sim.blockedVehicle, sim.elevation, gx, gy)`
  (`flowfield.ts`, `compute(blocked, elevation, gx, gy)`). Every route ends at its holder's rear
  (D1, D2), so one field per rear serves every zone of that side.
- **The purse goes integer first** (Task 1), so that income from several sources at several rates
  adds up exactly and can be hashed.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-183, F2 and F5. GH-167 (G3) Q2, the lead on 4 Oct: *held-ground income on top of the base rate;
  a cut corridor halves a zone; a contested zone pays nobody*.
- The G3 decision sheet (PR #369, `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`), Q2: the
  banking table (15 of 18 winning plans bank 100%; M at `751b6742`, before GH-382 and #402;
  re-measure), the spike's contested-pays-nobody evidence, the map census, and the GDD anchors
  (foothold ~120, build-up ~200, clearance ~80, halved by interdiction: `docs/GDD.md` §3, L78). The
  census as the tree reads on `b44df7aa`: every economy map declares **2–7** zones (the sheet's
  "6–11" predates GH-382); road tiles on 17 of 18 (none on `tel_marum_2`); map tunnels only on Beit
  Sahwan II/IV and Deir Amun II/III.
- `docs/GDD.md` §3; CLAUDE.md "A map" (`b`, `d`, the wheeled mask, `FlowField.compute`'s mask
  parameter, `Sim.fieldFor`'s `(goal, domain)` cache: private, numeric domains, see Architecture).
- F1 (`2026-10-04-gf1-fire-support-intel.md`) for the economy pin this plan re-pins.

**Base:**
- Read against `main` `067fab9a` (4 Oct), refreshed against `b44df7aa` (6 Oct). Branch
  `feat/gf2-income`, cut from `main` after F1 and F3 land. Locate code by symbol; the line numbers
  quoted are `b44df7aa`'s.
- **Nothing here is measured yet.** (M) numbers are quoted from the G3 sheet's probe at `751b6742`,
  before GH-382 moved every D7 mission onto new ground and #402 changed infantry fire; treat each as
  stale until re-measured. (R) numbers are reasoned and each task says how to measure them.

---

## Decisions

- **By the lead, 4 Oct (G3 Q2):** zones pay on top of the base rate; a cut corridor halves a zone's
  income; a contested zone pays nobody.
- **Taken defaults (confirm or overrule):**
  - **D1. Every income zone has its own corridor**: the wheeled route from the zone to its holder's
    rear (side 0: the production anchor, else `player_start`; side 1: its production anchor from F4,
    else none). A zone with no rear for its holder is never cut. This is the literal reading of "a
    cut corridor halves a zone". (Refresh: the anchor is `MissionRuntime.productionAnchor(side)`,
    private, `mission.ts` ~L593; `player_start` is `mission.map.player_start`, not a map marker.
    Rears on main: the UZ II camp is at (20,43), the BS II camp at (2,20) and the DA II camp at (21,35).
    UZ IV and WH II stand no camp, and WH II's `pump_house` produces nothing, so their rears are
    `player_start` (24,45) and (3,24).)
  - **D2. The base rate is halved only where the mission says `supply_corridor: true`**, along its
    own route from a new `supply_entry` marker to the rear. That keeps the GDD's interdiction rule
    for the convoy and makes the two declared corridors live, while every other mission's base rate
    is untouched. The G3 sheet recommended exactly this layering.
  - **D3. Held** means: at least one living, surface, ground unit of the side inside the zone, and
    **no** living, surface, ground unit of the other side inside it. Both sides inside is contested
    and pays nobody, whether or not they are within reach of each other: a zone pays one holder or
    none, never two, and the hold objective's `CONTEST_RADIUS_SQ` only ever distinguished "contested"
    from "split", which pay the same here. The cost of this rule is the one the hold objective's
    comment names (a routed survivor in a far corner zeroes the zone); for income that is the
    intended pressure, and Task 8's world walk shows whether it bites on the four D7 missions. Aircraft
    neither hold nor contest (the #279 ruling (a) principle). Civilians are side 2 and count for
    nobody. (Refresh: the hold objective's `livingIn`/`contestedIn`, `mission.ts` ~L1562-1600,
    **do** count aircraft, so `zoneHolder` cannot reuse them as they stand. Since #402 a holder on
    foot kneels, which does not move it. But an attack-moved holder can be walked out of the zone by
    `stepSweep`, and `halt` does not prevent it: see "Changed since 4 Oct". Ruled 6 Oct: held zones
    are kept by the new Hold position order, `2026-10-06-hold-position.md`.)
  - **D4. Cut** means any of: (a) no wheeled route exists; (b) a living, surface, ground enemy unit
    stands within `CORRIDOR_INTERDICT_SQ` (2 tiles) of a route tile and no friendly unit is within
    `CONTEST_RADIUS_SQ` of it; (c) an open vent (`tnVentOpen`) of a hostile-stocked route lies
    within `CORRIDOR_VENT_SQ` (3 tiles) of a route tile.
    (Refresh: `CONTEST_RADIUS_SQ` is a module-private constant, `mission.ts:416`, = 2359296, which is
    6 tiles in `contestedIn`'s units: `(fx.sub(a, b) >> 8) | 0`, squared. `corridor.ts` needs it
    exported or moved to `tuning.ts`, value unchanged. In those units 2 tiles is 262144 (the same as
    `DANGER_CLOSE_SQ`, `mission.ts:403`) and 3 tiles is 589824. The sim records no owner for a
    tunnel, so "hostile-stocked" is derived from who is inside it (`sim.state.tunnelIn[i] === r`
    with `side[i]`) or from the side of its digger (`sim.tnDigger[r]`). Since #402, enemy rifles
    halt and fire from up to 7–8 tiles, outside the 6-tile contest radius. Ruled 6 Oct: the radius
    stays 6; contest is occupation, not fire.)
  - **D5. Convoys take the road.** Where the map has road tiles (`r`) and a road-connected route
    exists between the two ends' nearest road tiles, the route follows it; otherwise it is the
    wheeled flow-field route. This is what makes roads "a thing that cuts it": the road is where the
    convoy is, so it is where an enemy sits. (Refresh: the sim holds **no** road mask. `r` lives
    only in `parseMap`'s `decor` (`DECOR.road`, `packages/data/src/map.ts:131,227`), `applyTerrain`
    passes on no decor, and `@lions/sim` may not import `@lions/data`. So the runtime is handed the
    mask through `MissionContext`; see Task 7.)
  - **D6. Income goes to the holder**, side 1 included. In the campaign nothing spends side 1's
    purse until F4, so it changes no outcome; it is hashed and shown in no HUD.
  - **D7. Which missions get zones in F2:** the two corridor missions (`umm_zeitoun_2_buildup`,
    `umm_zeitoun_4_clearance`) and the three whose plans build (`beit_sahwan_2_foothold`,
    `deir_amun_2_foothold`, `wadi_halam_2_laager`). Five, because a zone matters only where something
    is bought with it, and every mission given zones re-proves its plan. The other 13 economy
    missions keep their flat rate until campaign design adds zones on purpose. (Refresh: all five
    still exist, and the three builders still build. All five sit on GH-382 ground: UZ II on
    `umm_zeitoun_2` (it was on `umm_zeitoun`), DA II on `deir_amun_2` (it was on `deir_amun`), and
    UZ IV, BS II and WH II on re-drawn maps of the same names. Each now declares 2–6 zones; see
    Task 2.) **Ruled 6 Oct: BS II leaves D7.** Its map offers only the start zone and a tunnel mouth.
    D7 is four missions: UZ II, UZ IV, DA II and WH II. BS II keeps its flat rate.
  - **D8. A skirmish is zones only** (base rate 0). That is G-G's configuration; F2 only has to make
    a base rate of 0 legal, which it already is.

---

## Global Constraints

- **The four invariants hold.** No floating point added; the income block's existing
  `rate / 1200` float accrual (`mission.ts` ~L1053-1054) is **removed** in Task 1, not extended. No
  `rng` draw anywhere in F2. Data flow stays one-way: the runtime reads the sim, never writes it
  (which is why the route does not go through `Sim.fieldFor`; see Architecture).
- **The two sim pins stay UNMOVED by every task.** A move is a defect. On `b44df7aa` they read
  flat **922714084** and relief **3200430224** (`packages/sim/src/determinism.test.ts` L427, L721).
  On 4 Oct they read 2109596329 and 1425295494; #402 moved them. Whatever F1/F3 leave is the
  reference.
- **The economy pins** (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`, from F1) **move once**, in Task 7,
  with the reason in the commit message and dated comments.
- **`pnpm balance`**: byte-identical (R): `targets.ts` builds no `MissionRuntime`.
- **`pnpm playtest`**: exit 0. Byte-identical through Task 7 (R; no shipped mission has a zone until
  Task 8, and Task 1 must be exact). Task 8 moves the four D7 missions' lines and nothing else.
  Every plan still wins, every passive control still loses (the Stage 4 exit line).
- **Every check is seen red**, by a one-line mutation of the implementation, quoted in the commit.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  `pnpm balance`, `pnpm playtest`, and `pnpm validate:data` when data or a schema changes. Output in
  the commit message.
- **Git, TypeScript, lane:** as F1. Lane C files only; the overlay and HUD are WP-S-F's. Two
  `packages/app` edits are forced (a question for the lead, "Changed since 4 Oct"):
  `CAMPAIGN_CREDITS` if the ladder moves, and the road mask at `packages/app/src/mission-start.ts:46`
  (Task 7). Ruled 6 Oct: both are within Lane C's allowance.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/mission.ts` | The integer purse; income; corridor state; events; `MissionContext.roadMask` (optional, new) | 1, 7 |
| `packages/sim/src/income.ts` (+ test) | **New.** Pure: `zoneHolder` | 4 |
| `packages/sim/src/corridor.ts` (+ test) | **New.** Pure: `corridorRoute`, `corridorCut` | 5, 6 |
| `packages/sim/src/sim.ts` | A read-only `ventTile(route)` accessor (no state, no hash). Refresh: `Sim.tunnelVent(r)` (public, Q16.16 tile centre, `sim.ts` ~L1570, present at `067fab9a` too) already is one; use it and skip this edit unless a null return is needed | 6 |
| `packages/sim/src/tuning.ts` | `CORRIDOR_INTERDICT_SQ`, `CORRIDOR_VENT_SQ`, `CORRIDOR_RECHECK_TICKS` | 5, 6 |
| `data/schemas/mission.schema.json` | `resources.income_zones`, `resources.supply_entry` | 3 |
| `tools/validate_data.mjs` (`pnpm validate:data` = `node tools/validate_data.mjs`) and a **new** `tools/validate_income.mjs` + `tools/src/validate_income.test.ts` | Cross-references: zone ids, the entry marker. A test cannot import `validate_data.mjs`, which runs its sweep at import time and exits; checks live in their own module, as `tools/validate_map_grid.mjs` / `tools/src/map_grid.test.ts` do | 3 |
| `docs/campaign/economy/income-numbers.md` | **New.** The G-NUM table | 2 |
| `data/missions/{umm_zeitoun_2_buildup,umm_zeitoun_4_clearance,deir_amun_2_foothold,wadi_halam_2_laager}.json` | Zones, entry marker (BS II left D7, ruled 6 Oct) | 3 (`supply_entry` on the two UZ missions), 8 |
| `data/maps/{umm_zeitoun_2,umm_zeitoun_4}.json` | The `supply_entry` marker (markers and zones are declared on the map, not the mission) | 3 |
| `tools/src/backtest/playtest.ts`, `tools/src/mission-harness.ts`, `tools/src/walk_world.ts`, `tools/src/backtest/saddle-price.ts`, `packages/app/src/mission-start.ts` | The five `new MissionRuntime(` sites: pass `roadMask` from the parsed map (absent means "no roads", so the game and the harness would route differently) | 7 |
| `tools/src/backtest/playtest.ts` | The banking report and gates; plan re-proofs | 9 |
| `docs/GDD.md` §3, `docs/campaign/README.md`, `docs/PERFORMANCE.md`, `docs/HANDOVER.md` | Contract, cost, ledger | 10 |

---

## Task 1: the purse goes integer

**Model:** sonnet. **Agent:** `sim-guard`.

**Why.** Income from a base rate plus several zones, each possibly halved, accrued in JS floats,
is a sum whose rounding depends on the order of addition. The day the economy is hashed for lockstep
(G-H), that is a desync. Fix the representation before adding sources.

**Files:** `packages/sim/src/mission.ts` and its test.

**Interfaces:**

```ts
/** Logistics in 1/2400ths: a full source adds 2 * rate per tick, a halved one adds rate.
 *  Both are exact at 20 Hz for every integer per-minute rate. */
private logisticsAcc = 0;   // replaces logisticsValue (mission.ts ~L515)
get logistics(): number;    // Math-free: (this.logisticsAcc / 2400) | 0, unchanged contract (floored)
// spending subtracts cost * 2400; refusals compare acc < cost * 2400
```

*Refresh correction:* the unit was 1/1200ths. In that unit an integer rate r adds r per tick, which
is exact, but a **halved** odd rate adds r/2, which is not: 45/min cut is 22.5 a tick. Task 7's
"odd rate halved accrues exactly" test could not pass. 1/2400ths keeps both cases integer. Note
too that today's refusal (`requestBuild`, ~L676) compares the **unfloored** float purse against the
cost, so this exact comparison is the same rule.

Also a refresh note: `logistics_rate_per_min` is typed `"number"` in `mission.schema.json`'s
`resources` block. Every shipped rate is an integer (18 of 18, 80–150). Exactness needs an integer,
so Task 3 tightens the type to `"integer"` alongside its new fields.

Overflow: the largest purse a 7-minute mission can hold is under 10,000 logistics (R), which is
2.4e7 in the accumulator, far inside 2^31.

- [ ] **Step 1: Write the failing tests:** a 120/min rate gives exactly 120 after 1200 ticks and 0
  after 9 ticks of 1/min; 80/min (not a divisor of 1200) gives exactly 80 after 1200 ticks; spending
  then accruing never shows a fractional purse.
- [ ] **Step 2: Implement.** Do the same for intel only if F1 left any fractional intel (it should
  not: F1's earn rule is integer lumps).
- [ ] **Step 3: Measure.** `playtest` **byte-identical** (R). If a line moves, it is a build that used
  to clear by a float hair and now clears a tick later or earlier: print the tick, explain it, and
  that line's move becomes part of this plan's playtest re-pin. Economy pins unmoved (they hash the
  floored purse, which is identical).
- [ ] **Step 4: See it red.** Accrue `(rate / 1200) | 0` logistics per tick (truncating, as whole
  logistics rather than accumulator units): the 80/min test fails, at 0.

---

## Task 2: the numbers and the zones, before the code (G-NUM)

**Model:** opus. **Agents:** `balance-analyst` for the rates, `mission-author` for the zone choice.
**Halts the run until the lead answers.**

**Files:** `docs/campaign/economy/income-numbers.md` (new).

- [ ] **Step 1: Which zones.** For each D7 mission, list its map's declared zones and propose the
  two to four that pay: ground the plan crosses, ground the enemy also wants, and at least one zone
  whose corridor crosses ground the enemy can reach. Draw each proposed corridor's route as a tile
  list (Task 5's function can be run from a scratch script once it exists; until then, by hand).
  **Refresh: on the GH-382 ground** (`data/maps/<map>.json`, `zones` as `[x, y, w, h]`), and on no
  older census:
  - `umm_zeitoun_2_buildup` (`umm_zeitoun_2`): `staging` [18,42,12,3] (holds the camp at (20,43) and
    three starting placements), `crest_line` [18,30,13,3] (the `hold_for` primary),
    `post_stone` [21,22,4,3] (`raze` and `capture`).
  - `umm_zeitoun_4_clearance` (`umm_zeitoun_4`): `hamlet` [18,25,14,11], `crest_top` [13,5,5,4],
    `stockpile` [28,2,10,9] (the `raze` primary), `north_shelf` [31,1,4,3] (`evacuate_before`).
  - `beit_sahwan_2_foothold` (`beit_sahwan_2`), **left D7 by the 6 Oct ruling, kept here for the
    record**: **only two**. `west_approach` [0,12,16,24] holds
    the whole starting force, the camp and `player_start`, and is the `hold_for` primary;
    `tunnel_mouth_west` [30,23,3,3] is the `collapse` target. The map has one tunnel, `bs_tn_west`.
  - `deir_amun_2_foothold` (`deir_amun_2`): `staging` [18,40,14,7] (the whole starting force),
    `the_wadi` [0,36,48,3], `pump_yard` [11,24,10,9] (`hold_for` and `collapse`), `hamlet`
    [12,8,30,12], `store_yard` [34,26,9,8] (`capture`), `north_bank` [3,5,43,5]. The map has two
    tunnels: `da_tn_pump`, and `da_tn_yard` (pre-dug, so its vent is open from tick 0).
  - `wadi_halam_2_laager` (`wadi_halam_2`): `ford_watch` [4,4,10,7] (`capture`), `pasture`
    [13,15,14,17] (`hold_for` and `raze`), `refuge` [2,37,7,6], `east_road` [40,22,8,4].
  A zone that holds the starting force pays a passive control by construction (Task 9's
  `ZONE_PASSIVE_INCOME`). Road tiles on these maps: 43, 91, 198 (BS II), 123, 34. Patrollers: one
  `moto_rpg` (BS II) and one `technical` (DA II), both vehicles, so #402's halt does not apply to
  them.
- [ ] **Step 2: Rates.** Anchor: **a full hold of every zone adds about 40% of the phase's GDD
  anchor** (R: foothold 120 → ~48/min over all zones), so holding ground is worth fighting for and
  losing it does not snowball inside seven minutes (the G3 sheet's objection to pure zones).
  Radii: interdiction 2 tiles, vent 3 tiles, re-check every 20 ticks.
- [ ] **Step 3: The yardstick.** State what success reads like on the banking report Task 9 adds:
  the GDD's rule is "banking >30% unspent at a win means income is too high or objectives too
  cheap" (`docs/GDD.md` L81), and 16 of 18 winning plans broke it (M at `751b6742`, before GH-382
  and #402; re-measure with Task 9's line before quoting it). F2 alone is expected to make banking
  **worse** (more income, nothing new to buy) until F4 lands. Say so in the doc, so nobody tunes F2's
  rates against F2's banking number.
- [ ] **Step 4: The lead answers** on #183. Record the date.

---

## Task 3: the schema and its cross-checks

**Model:** sonnet. **Agent:** `mission-author`. **Depends:** none.

**Files:** `data/schemas/mission.schema.json`; `tools/validate_data.mjs` calling a new
`tools/validate_income.mjs`; its tests in `tools/src/validate_income.test.ts` (the module idiom of
`tools/validate_map_grid.mjs` and `tools/src/map_grid.test.ts`); the two UZ mission JSONs
(`supply_entry`); `data/maps/umm_zeitoun_2.json` and `data/maps/umm_zeitoun_4.json` (the marker).

**Interfaces (schema):**

```json
"income_zones": {
  "type": "array",
  "items": { "type": "object", "additionalProperties": false,
    "required": ["zone", "rate_per_min"],
    "properties": {
      "zone": { "type": "string", "description": "A zone id declared by the mission's map." },
      "rate_per_min": { "type": "integer", "minimum": 1 } } } },
"supply_entry": { "type": "string",
  "description": "Map marker where the convoy enters. Required when supply_corridor is true." }
```

`supply_corridor`'s description is rewritten: it now does what it says. (On main it reads "If true,
logistics income can be interdicted by the enemy. Protecting the corridor becomes gameplay.")
`logistics_rate_per_min` goes from `"number"` to `"integer"` (Task 1).

- [ ] **Step 1: Write the failing validator tests:** an unknown zone id is refused by name; a
  duplicated zone is refused; `supply_corridor: true` with no `supply_entry` is refused; an unknown
  entry marker is refused.
- [ ] **Step 2: Implement.** The two shipped corridor missions now **fail** `validate:data` (no
  `supply_entry`). They are fixed in Task 8, so this task adds the entry markers for those two only,
  at the map edge their briefing names (text census first), with no zone yet. A JSON field that the
  runtime does not read until Task 7 changes no behaviour.
  Refresh notes:
  - The marker goes on the map. `tools/src/umm_zeitoun_ground.test.ts` (~L118) requires every marker
    on an unblocked tile. It must also stay off the vehicle mask: `umm_zeitoun_2` carries 112 `b`
    tiles and `umm_zeitoun_4` 117, and an entry on a boulder makes D4 a permanent `unreachable`.
  - The only briefing line is UZ II's "the corridor behind it is open", which puts it behind the
    line, to the south. UZ IV's briefing names no corridor.
  - On both maps the rear sits at row 43–45 of 48. The one road component (43 and 91 tiles) runs from
    (24,45) forward to (24,25) and to (33,7), and touches no map edge. This was also true at
    `067fab9a`.
  - **Ruled 6 Oct:** `supply_entry` goes at the map-edge tile nearest the player's start zone,
    along the shortest passable path. Measure the path through the vehicle mask, since a convoy is
    trucks. The implementer picks the tile on each map, pins it in
    `tools/src/umm_zeitoun_ground.test.ts`, and names it in the commit.
  - A briefing edit edits both `briefing` and the matching `briefing_sections` text
    (`tools/validate_briefing.mjs`, GH-119).
- [ ] **Step 3: See it red.** Remove the cross-reference: the unknown-zone test passes a bad id.

---

## Task 4: who holds a zone

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** none.

**Files:** `packages/sim/src/income.ts` (new), `income.test.ts` (new).

**Interfaces:**

```ts
export type Holder = 0 | 1 | -1;   // -1: nobody (empty or contested)
/** D3. Reads positions, sides, alive, tunnelIn and the air flag from a narrow view,
 *  so tests build it from literals rather than a Sim. Integer squared distances. */
export function zoneHolder(view: HoldView, zone: readonly [number, number, number, number]): Holder;
```

- [ ] **Step 1: Write the failing tests** (literal positions):
  - empty zone → -1; one side-0 squad → 0; one side-1 squad → 1;
  - both sides inside, 5 tiles apart → -1 (contested); 15 tiles apart → -1 as well (D3: one holder
    or none);
  - an aircraft over an empty zone → -1; an aircraft beside an enemy squad does not contest it;
  - a buried unit holds nothing and contests nothing (the objective's own `tunnelIn` guard);
  - civilians (side 2) hold nothing and contest nothing.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.** Drop the air skip: "an aircraft over an empty zone" returns 0. Drop the
  both-present rule (pay the side with more units inside): the "15 tiles apart" case pays one side.

---

## Task 5: the corridor's route

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** none.

**Files:** `packages/sim/src/corridor.ts` (new), `corridor.test.ts` (new), `tuning.ts`.

**Interfaces:**

```ts
/** The tiles a convoy drives from `from` to `to` (D5): along road tiles when a
 *  road-connected path joins the two ends' nearest road tiles, else the wheeled
 *  flow-field path. Null when no wheeled route exists (D4 a). Deterministic:
 *  ties broken by the flow field's own direction order. */
export function corridorRoute(src: RouteSource, from: TileXY, to: TileXY): Int32Array | null;
```

`RouteSource` exposes `fieldFor(goal, 'wheeled')`, `roadMask`, width and height, so the test can
build one on a literal grid with the real `FlowField`.
(Refresh: `'wheeled'` is not a domain value, and `Sim.fieldFor` is private and pooled; see
Architecture. Implement `RouteSource.fieldFor(goal)` as a vehicle-domain `FlowField` built over
`sim.blockedVehicle` and `sim.elevation`. `compute` prices each climb at `UPHILL_PER_LEVEL`, and 16
of the 18 economy maps carry relief, so the route bends round hills as a unit's does. `roadMask`
comes from `MissionContext` (Task 7): a `Uint8Array`, 1 where `parseMap` decor is `DECOR.road`.)

- [ ] **Step 1: Write the failing tests** (hand-drawn grids):
  - open ground: the route reaches `to` and every step is 8-adjacent;
  - a ditch row (`d`) across the map with no gap: `null`; one gap: the route passes through it;
  - a boulder field (`b`) is a wall to the route but not to a foot path over the same grid (the
    wheeled mask, CLAUDE.md "A map"), paired against the same grid with `b` turned to `.`;
  - a road that detours two tiles is still taken (D5); a road broken by a building is not;
  - on `tel_marum` (no road tiles: 0 `r` in `data/maps/tel_marum.json` on `b44df7aa`, unchanged since
    `067fab9a`; it carries 16 `b`), the route is the wheeled field's.
- [ ] **Step 2: Implement.** Road path: BFS over road tiles in fixed neighbour order. Flow path: walk
  the field's directions from `from` until `to`, capped at w*h steps (a cycle is a bug; the cap turns
  it into a test failure rather than a hang).
- [ ] **Step 3: See it red.** Use the foot mask instead of the wheeled one: the boulder test fails.
  Skip the road BFS: the detour test fails.

---

## Task 6: what cuts the corridor

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 4, 5.

**Files:** `corridor.ts` and its test, `packages/sim/src/sim.ts` (one accessor), `tuning.ts`.

**Interfaces:**

```ts
export type CutCause = 'unreachable' | 'interdicted' | 'vent' | null;
export function corridorCut(view: HoldView & VentView, route: Int32Array | null, holder: 0 | 1): CutCause;
// sim.ts: read-only, no new state, nothing hashed
ventTile(route: number): TileXY | null;
// Refresh: Sim.tunnelVent(r): readonly [Fx, Fx] (sim.ts ~L1570) already returns the vent's tile
// centre; fx.toInt of each gives the tile. sim.tnVentOpen, sim.tnAlive and sim.tnDigger are public.
```

*#402 note:* D4 b now meets patrols that halt on contact (`MissionRuntime.stepPatrols`,
`mission.ts` ~L1523; foot only) and enemy rifles that fire from a halt at up to 7–8 tiles. An
interdictor and a guard trading fire 7 tiles apart read `interdicted`, not contested. The tests
below pin the rule as written (6 tiles); whether that is the right radius is a question for the lead.

- [ ] **Step 1: Write the failing tests:**
  - `null` route → `'unreachable'`;
  - an enemy squad 1.5 tiles off a route tile, no friend near → `'interdicted'`;
  - the same with a friendly squad within 6 tiles of it → `null` (the line is contested, not cut);
  - an enemy aircraft over the route → `null`;
  - an open vent 2 tiles off the route → `'vent'`; the same vent closed → `null`;
  - a vent beside the route of a tunnel stocked by the **holder's own side** → `null`.
- [ ] **Step 2: Implement.** Precedence `unreachable` > `vent` > `interdicted`, for the HUD's one
  reason line.
- [ ] **Step 3: See it red.** Treat a closed vent as open: the closed-vent test fails. Drop the
  friendly-contest check: the contested test fails.

---

## Task 7: income in the runtime, and the economy re-pin

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 1, 3–6, and F1 Task 1.

**Files:** `packages/sim/src/mission.ts` and its test, `determinism.test.ts`; the five
`new MissionRuntime(` sites, for `roadMask` (File structure).

**Interfaces:**

```ts
// MissionContext (mission.ts ~L281) gains, optional: absent means the map has no roads (D5 falls
// back to the flow route). Each caller fills it from parseMap's decor (DECOR.road).
roadMask?: Uint8Array;
interface ZoneIncome { zone: string; rect: [number, number, number, number]; ratePerMin: number;
  holder: Holder; cut: CutCause; route: Int32Array | null }
/** Per side; side 1's is spent only by F4's enemy production. */
private enemyLogisticsAcc = 0;
get incomePerMin(): { base: number; zones: number; halvedBy: CutCause | null };   // side 0, for the HUD
// MissionEvent additions:
| { kind: 'zoneHolder'; tick: number; zone: string; holder: Holder }
| { kind: 'corridor'; tick: number; zone: string | null; cut: CutCause }   // zone null = the convoy
```

- [ ] **Step 1: Write the failing tests** (a fixture mission with two zones):
  - a held, uncut zone pays its rate to the holder, on top of the base;
  - a contested zone pays nobody; an empty zone pays nobody;
  - a cut corridor halves that zone only, and the other zone pays in full;
  - with `supply_corridor: true`, a cut convoy route halves the base; without it, nothing halves the
    base whatever stands on the road (D2);
  - side 1 holding a zone fills `enemyLogistics`, never the player's purse;
  - an odd rate halved accrues exactly (e.g. 45/min cut gives 22.5/min: the 1/2400 accumulator holds
    it exactly (45 units a tick), which is why Task 1 came first; 1/1200ths would need 22.5 a tick);
  - routes are recomputed every `CORRIDOR_RECHECK_TICKS` and after a structure dies, and a route
    through a collapsed building's rubble updates (the blocked mask changed).
- [ ] **Step 2: Implement.** Events fire on change only.
  *Fixture trap since #402:* an in-test unit type with no `role` derives as wheeled. It never braces
  and paths in `DOMAIN_VEHICLE` (the golden replay's riflemen did exactly this). A fixture unit meant
  as infantry needs `role: 'infantry'`. To keep a holder in its zone, order it there and then
  `hold` (Hold position, ruled 6 Oct, `2026-10-06-hold-position.md`, on `main` before F2). An
  attack-moved unit is walked out by `stepSweep`, and `halt` does not clear `attackMove`.
- [ ] **Step 3: Re-pin the economy pins, once.** The F1 fixtures gain two zones and a
  `supply_corridor` with an entry, and the hash gains zone holders, cut causes and the side-1 purse.
  Commit message: *"economy pins re-pinned: held-ground income and corridors (G3 Q2, lead 4 Oct); the
  fixtures gained two zones and a convoy route; was N / M"*. Coverage: assert the replay passes
  through a held state, a contested state and a cut state at least once each. (Refresh: F1's fixture
  maps, `beit_sahwan_outskirts` and `tel_marum`, are untouched by GH-382. A fixture's zones and entry
  marker go in its test `MissionContext` (`zones`, `markers`); `tel_marum` has no roads, so its
  convoy is the D5 fallback.)
- [ ] **Step 4: Measure.** Sim pins unmoved; `balance` identical; `playtest` byte-identical (no
  shipped mission has a zone yet; the two corridor missions now have an entry marker and
  `supply_corridor: true`, so **their base can halve**). If either corridor mission's line moves, it
  is the D2 halving acting on content for the first time. Record the line, keep it, and name it in
  this plan's playtest re-pin.
- [ ] **Step 5: See it red.**
  - Pay a contested zone's rate to side 0: "a contested zone pays nobody" fails.
  - Halve the base whenever any corridor is cut: the D2 test fails.
  - Skip the recheck after a structure dies: the rubble test fails.

---

## Task 8: zones on four missions, with a world walk

**Model:** sonnet. **Agent:** `mission-author`, then `playtest`. **Depends:** Tasks 2, 7.

**Files:** the four D7 mission JSONs (BS II left D7, ruled 6 Oct), and their `briefing` together with the matching
`briefing_sections` text, only if a briefing line now lies (`tools/validate_briefing.mjs`, GH-119).
There are no locale overlays: `data/locales/` holds only `README.md`. A zone added to a map is a
`data/maps/<map>.json` edit, and the arc's `tools/src/<arc>_ground.test.ts` may pin it.

- [ ] **Step 1: Author** the approved zones and rates. No objective, placement or trigger changes.
- [ ] **Step 2: The world walk.** For each mission, run the shipped plan and print, every 30 s:
  each zone's holder, each corridor's cut cause, the purse, and income per minute. A declarative
  gate needs a world-state walk: no unit test notices a zone whose rectangle stopped containing the
  ground it was chosen for (memory, "declarative gates need a world-state walk"; and "placements
  spread across tiles"). Paste the walk into the PR description.
  *#402:* expect holders to leave. A plan's attack-movers that arrive in a zone are walked out by
  `stepSweep` toward a covered target, or toward an identified enemy they cannot reach, and the walk
  then prints `holder -1`. That is the rule working, not a mis-authored zone. Tell the two apart by
  the order that put the unit there: a `move` stays, an `attackMove` may not, and Hold always
  stays (ruled 6 Oct). The per-arc ladders (`tools/src/backtest/{uz,da,wh}_ladder.ts`, passive /
  naive / sensible over seeds, written against zones and markers) are a second reading if a zone
  changes who wins.
- [ ] **Step 3: Measure.** Every plan still wins; every passive control still loses. Lines that move
  are the four missions' (purse, banking) and anything downstream of a changed outcome.
- [ ] **Step 4: See it red.** Point one zone at a rectangle the plan never enters: its walk prints
  `holder -1` for the whole mission. That is the reading a mis-authored zone gives, and the PR shows
  it once.

---

## Task 9: the banking report, and the plans re-proved

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Task 8.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1: The banking line.** For every economy mission, print earned, spent and banked % at
  the end of the winning plan and of the passive control. Pin two numbers in the `LADDER_CREDITS`
  idiom: **`BANKING_OVER_30_WINNERS`** (winning plans banking more than 30%; M: 16 of 18 at
  `751b6742`, before GH-382 and #402, so pin what this step prints on the branch, not 16) and
  **`ZONE_PASSIVE_INCOME`** (income from zones earned by passive controls across the four D7
  missions). Expect 0 or near it: a force that never moves holds only the ground it started on. On
  the new ground that ground is a zone on DA II (`staging`) and UZ II (`staging`), so the figure is
  0 only if Task 2 pays neither.
- [ ] **Step 2: Re-prove.** The three building plans (`beit_sahwan_2_foothold`,
  `deir_amun_2_foothold`, `wadi_halam_2_laager`) are re-run. BS II has no zones since the 6 Oct
  ruling, so its income is unchanged and its line should not move. (Refresh: unchanged in kind on main.
  BS II builds one `inf_squad` at 120 s, and holds `west_approach` with one whole-force `attackMove`
  to (8,23), so its holders are exposed to `stepSweep`. WH II builds one every 60 s from 90 to 700 at
  `player_start`, since it has no camp. DA II's `deirAmun2Plan` builds one every 40 s from 60 to
  420 at the camp, (21,35).) A plan that now has more to spend
  **does not** gain orders in F2: F4 is where spending gets a reason. If a plan's grade moves, it
  moves for income alone, and the ladder re-pin names it.
- [ ] **Step 3: See it red.** Double every zone's rate on a scratch copy: `BANKING_OVER_30_WINNERS`
  fails by name. Make passive controls hold their start zone (author a zone on `player_start`):
  `ZONE_PASSIVE_INCOME` fails.

---

## Task 10: cost, contract, ledger

**Model:** sonnet; `perf-analyst` for Step 1.

**Files:** `docs/PERFORMANCE.md`, `docs/GDD.md` §3, `docs/campaign/README.md`, `docs/HANDOVER.md`.

- [ ] **Step 1: Cost.** Zone holding is O(zones × units) per tick (D3 is a presence test, not a pairwise one), and the cut test is O(route tiles × units) every 20 ticks. Measure at 300 living units on a
  48x48 map with four zones: amortised per-tick cost, worst tick, and the share of the 50 ms budget.
  If it is above 0.1 ms amortised (the G3 sheet's E2 line for the commander), bucket units by tile
  first. Record capture conditions with the numbers. (Refresh: count the route itself too. One
  `FlowField.compute` per rear per recheck, outside the sim's pool, is a Dijkstra over 2304 cells
  with the uphill term, and on 16 of 18 economy maps that term is live.)
- [ ] **Step 2: Contract.** GDD §3: the base rate, zones on top, contested pays nobody, the cut and
  its three causes, the half. `docs/campaign/README.md`: `income_zones` and `supply_entry` in the
  schema digest, with the rule that an income zone is chosen for ground both sides want.
- [ ] **Step 3: Ledger.** `docs/HANDOVER.md` §1, §3 (D1–D8), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat and relief | **unmoved** (R): 922714084 and 3200430224 on `b44df7aa` (2109596329 and 1425295494 on 4 Oct, moved by #402) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 7 | held-ground income and corridors (G3 Q2) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical through Task 7 except a D2 halving on the two corridor missions (R); Task 8 moves the four D7 missions | zones authored; new banking lines and gates |
| `LADDER_CREDITS` | **5830** on `b44df7aa` (5736 on 4 Oct; GH-382 and #402 moved it). Moves only if a D7 mission's grade, `unitHome` or conduct term moves (`creditsFor`, `packages/sim/src/credits.ts`: win, carrying secondaries, `unitHome`, conduct points) (R: income alone changes no outcome a plan that does not spend can see). If it moves, `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts:63`) moves in the same commit (`tools/src/campaign_credits.test.ts`, GH-330) | named per mission in the pin's comment, the house style above `LADDER_CREDITS` (`tools/src/backtest/playtest.ts` ~L3181) |

## Lane A needs (WP-S-F #184)

- **The supply-line overlay** (S-F's own item): each corridor's route, drawn cut or open, from the
  runtime's routes. It is a world overlay, so it is **mocked and shown to the lead before it is
  built** (memory: "no status marks in the world"; mock a world overlay first).
- **Zone holders on the minimap**: held, contested, enemy-held, from `zoneHolder` events.
- **Income readout** beside the logistics counter: `+N/min`, with the half and its cause on hover
  (`incomePerMin`).
- **Alerts** through the existing feed: "supply line cut: enemy on the road", "zone lost",
  "zone contested". Throttled, like the civilian flee notice.
- Strings through `t()`; the tutorial's economy step names holding ground.
