# WP-G-F plan F2: income from held ground, and corridors the enemy can cut (GH-183, G3 Q2). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the player holds pays. Ground nobody holds cleanly pays nobody. A line the enemy
cuts pays half.

| | today (`main` `067fab9a`) | after F2 |
|---|---|---|
| logistics | one flat `logistics_rate_per_min` (18 missions, 80–150/min) | the flat rate stays as the **base**; **income zones pay on top**, to whichever side holds them uncontested |
| `supply_corridor` | declared by `umm_zeitoun_2_buildup` and `umm_zeitoun_4_clearance`, **read by nothing** ("a later slice", `mission.ts` income block) | read: a cut corridor **halves** what flows down it |
| contested ground | — | **pays nobody** (the spike's rule: "the rule that made both sides fight for the approach. Keep it", M, G-G0) |
| what cuts a line | — | an enemy holding ground on the route, a route that no longer exists for wheels (ditch, boulders, rubble), and an open tunnel vent beside it |

**Architecture:**
- **All of it is `MissionRuntime`.** Zone ownership, the corridor route and the cut test read sim
  state (positions, sides, `tunnelIn`, `blocked`, the boulder mask, `tnVentOpen`) and write nothing
  back. No new sim state, so the two sim pins do not move (G3 sheet, "one correction").
- **Two pure modules carry the rules**, so each rule is unit-tested on literal grids before any
  mission sees it: `income.ts` (who holds a zone) and `corridor.ts` (the route and whether it is cut).
- **The route is the flow field the sim already has**, in the wheeled domain (a convoy is trucks),
  through `Sim.fieldFor`'s cache. No per-unit A* (CLAUDE.md, "What not to do").
- **The purse goes integer first** (Task 1), so that income from several sources at several rates
  adds up exactly and can be hashed.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-183, F2 and F5. GH-167 (G3) Q2, the lead on 4 Oct: *held-ground income on top of the base rate;
  a cut corridor halves a zone; a contested zone pays nobody*.
- The G3 decision sheet (PR #369), Q2: the banking table (15 of 18 winning plans bank 100%, M), the
  spike's contested-pays-nobody evidence, the map census (every economy map declares 6–11 zones;
  road tiles on 17 of 18; tunnels on Beit Sahwan and Deir Amun), and the GDD anchors (foothold ~120,
  build-up ~200, clearance ~80, halved by interdiction).
- `docs/GDD.md` §3; CLAUDE.md "A map" (`b`, `d`, the wheeled mask, `FlowField.compute`'s mask
  parameter, `Sim.fieldFor`'s `(goal, domain)` cache).
- F1 (`2026-10-04-gf1-fire-support-intel.md`) for the economy pin this plan re-pins.

**Base:**
- Read against `main` `067fab9a`. Branch `feat/gf2-income`, cut from `main` after F1 and F3 land.
  Locate code by symbol.
- **Nothing here is measured yet.** (M) numbers are quoted from the G3 sheet; (R) numbers are
  reasoned and each task says how to measure them.

---

## Decisions

- **By the lead, 4 Oct (G3 Q2):** zones pay on top of the base rate; a cut corridor halves a zone's
  income; a contested zone pays nobody.
- **Taken defaults (confirm or overrule):**
  - **D1. Every income zone has its own corridor**: the wheeled route from the zone to its holder's
    rear (side 0: the production anchor, else `player_start`; side 1: its production anchor from F4,
    else none). A zone with no rear for its holder is never cut. This is the literal reading of "a
    cut corridor halves a zone".
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
    intended pressure, and Task 9's walk shows whether it bites on the five missions. Aircraft
    neither hold nor contest (the #279 ruling (a) principle). Civilians are side 2 and count for
    nobody.
  - **D4. Cut** means any of: (a) no wheeled route exists; (b) a living, surface, ground enemy unit
    stands within `CORRIDOR_INTERDICT_SQ` (2 tiles) of a route tile and no friendly unit is within
    `CONTEST_RADIUS_SQ` of it; (c) an open vent (`tnVentOpen`) of a hostile-stocked route lies
    within `CORRIDOR_VENT_SQ` (3 tiles) of a route tile.
  - **D5. Convoys take the road.** Where the map has road tiles (`r`) and a road-connected route
    exists between the two ends' nearest road tiles, the route follows it; otherwise it is the
    wheeled flow-field route. This is what makes roads "a thing that cuts it": the road is where the
    convoy is, so it is where an enemy sits.
  - **D6. Income goes to the holder**, side 1 included. In the campaign nothing spends side 1's
    purse until F4, so it changes no outcome; it is hashed and shown in no HUD.
  - **D7. Which missions get zones in F2:** the two corridor missions (`umm_zeitoun_2_buildup`,
    `umm_zeitoun_4_clearance`) and the three whose plans build (`beit_sahwan_2_foothold`,
    `deir_amun_2_foothold`, `wadi_halam_2_laager`). Five, because a zone matters only where something
    is bought with it, and every mission given zones re-proves its plan. The other 13 economy
    missions keep their flat rate until campaign design adds zones on purpose.
  - **D8. A skirmish is zones only** (base rate 0). That is G-G's configuration; F2 only has to make
    a base rate of 0 legal, which it already is.

---

## Global Constraints

- **The four invariants hold.** No floating point added; the income block's existing
  `rate / 1200` float accrual is **removed** in Task 1, not extended. No `rng` draw anywhere in F2.
  Data flow stays one-way: the runtime reads the sim, never writes it.
- **The two sim pins stay UNMOVED by every task.** A move is a defect.
- **The economy pins** (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`, from F1) **move once**, in Task 7,
  with the reason in the commit message and dated comments.
- **`pnpm balance`**: byte-identical (R): `targets.ts` builds no `MissionRuntime`.
- **`pnpm playtest`**: exit 0. Byte-identical through Task 7 (R; no shipped mission has a zone until
  Task 8, and Task 1 must be exact). Task 8 moves the five D7 missions' lines and nothing else.
  Every plan still wins, every passive control still loses (the Stage 4 exit line).
- **Every check is seen red**, by a one-line mutation of the implementation, quoted in the commit.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  `pnpm balance`, `pnpm playtest`, and `pnpm validate:data` when data or a schema changes. Output in
  the commit message.
- **Git, TypeScript, lane:** as F1. Lane C files only; the overlay and HUD are WP-S-F's.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/mission.ts` | The integer purse; income; corridor state; events | 1, 7 |
| `packages/sim/src/income.ts` (+ test) | **New.** Pure: `zoneHolder` | 4 |
| `packages/sim/src/corridor.ts` (+ test) | **New.** Pure: `corridorRoute`, `corridorCut` | 5, 6 |
| `packages/sim/src/sim.ts` | A read-only `ventTile(route)` accessor (no state, no hash) | 6 |
| `packages/sim/src/tuning.ts` | `CORRIDOR_INTERDICT_SQ`, `CORRIDOR_VENT_SQ`, `CORRIDOR_RECHECK_TICKS` | 5, 6 |
| `data/schemas/mission.schema.json` | `resources.income_zones`, `resources.supply_entry` | 3 |
| `tools/validate_data*` (the script `pnpm validate:data` runs) | Cross-references: zone ids, the entry marker | 3 |
| `docs/campaign/economy/income-numbers.md` | **New.** The G-NUM table | 2 |
| `data/missions/{umm_zeitoun_2_buildup,umm_zeitoun_4_clearance,beit_sahwan_2_foothold,deir_amun_2_foothold,wadi_halam_2_laager}.json` | Zones, entry marker | 8 |
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
/** Logistics in 1/1200ths (a per-minute rate added once per tick at 20 Hz is exact). */
private logisticsAcc = 0;   // replaces logisticsValue
get logistics(): number;    // Math-free: (this.logisticsAcc / 1200) | 0, unchanged contract (floored)
// spending subtracts cost * 1200; refusals compare acc < cost * 1200
```

Overflow: the largest purse a 7-minute mission can hold is under 10,000 logistics (R), which is
1.2e7 in the accumulator, far inside 2^31.

- [ ] **Step 1: Write the failing tests:** a 120/min rate gives exactly 120 after 1200 ticks and 0
  after 9 ticks of 1/min; 80/min (not a divisor of 1200) gives exactly 80 after 1200 ticks; spending
  then accruing never shows a fractional purse.
- [ ] **Step 2: Implement.** Do the same for intel only if F1 left any fractional intel (it should
  not: F1's earn rule is integer lumps).
- [ ] **Step 3: Measure.** `playtest` **byte-identical** (R). If a line moves, it is a build that used
  to clear by a float hair and now clears a tick later or earlier: print the tick, explain it, and
  that line's move becomes part of this plan's playtest re-pin. Economy pins unmoved (they hash the
  floored purse, which is identical).
- [ ] **Step 4: See it red.** Accrue `(rate / 1200) | 0` per tick (truncating): the 80/min test
  fails, at 0.

---

## Task 2: the numbers and the zones, before the code (G-NUM)

**Model:** opus. **Agents:** `balance-analyst` for the rates, `mission-author` for the zone choice.
**Halts the run until the lead answers.**

**Files:** `docs/campaign/economy/income-numbers.md` (new).

- [ ] **Step 1: Which zones.** For each D7 mission, list its map's declared zones and propose the
  two to four that pay: ground the plan crosses, ground the enemy also wants, and at least one zone
  whose corridor crosses ground the enemy can reach. Draw each proposed corridor's route as a tile
  list (Task 5's function can be run from a scratch script once it exists; until then, by hand).
- [ ] **Step 2: Rates.** Anchor: **a full hold of every zone adds about 40% of the phase's GDD
  anchor** (R: foothold 120 → ~48/min over all zones), so holding ground is worth fighting for and
  losing it does not snowball inside seven minutes (the G3 sheet's objection to pure zones).
  Radii: interdiction 2 tiles, vent 3 tiles, re-check every 20 ticks.
- [ ] **Step 3: The yardstick.** State what success reads like on the banking report Task 9 adds:
  the GDD's rule is "banking >30% unspent at a win means income is too high or objectives too
  cheap", and 16 of 18 winning plans break it today (M). F2 alone is expected to make banking
  **worse** (more income, nothing new to buy) until F4 lands. Say so in the doc, so nobody tunes F2's
  rates against F2's banking number.
- [ ] **Step 4: The lead answers** on #183. Record the date.

---

## Task 3: the schema and its cross-checks

**Model:** sonnet. **Agent:** `mission-author`. **Depends:** none.

**Files:** `data/schemas/mission.schema.json`, the `validate:data` script, its tests.

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

`supply_corridor`'s description is rewritten: it now does what it says.

- [ ] **Step 1: Write the failing validator tests:** an unknown zone id is refused by name; a
  duplicated zone is refused; `supply_corridor: true` with no `supply_entry` is refused; an unknown
  entry marker is refused.
- [ ] **Step 2: Implement.** The two shipped corridor missions now **fail** `validate:data` (no
  `supply_entry`). They are fixed in Task 8, so this task adds the entry markers for those two only,
  at the map edge their briefing names (text census first), with no zone yet. A JSON field that the
  runtime does not read until Task 7 changes no behaviour.
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

- [ ] **Step 1: Write the failing tests** (hand-drawn grids):
  - open ground: the route reaches `to` and every step is 8-adjacent;
  - a ditch row (`d`) across the map with no gap: `null`; one gap: the route passes through it;
  - a boulder field (`b`) is a wall to the route but not to a foot path over the same grid (the
    wheeled mask, CLAUDE.md "A map"), paired against the same grid with `b` turned to `.`;
  - a road that detours two tiles is still taken (D5); a road broken by a building is not;
  - on `tel_marum` (no road tiles, M), the route is the wheeled field's.
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
```

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

**Files:** `packages/sim/src/mission.ts` and its test, `determinism.test.ts`.

**Interfaces:**

```ts
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
  - an odd rate halved accrues exactly (e.g. 45/min cut gives 22.5/min: the 1/1200 accumulator holds
    it exactly, which is why Task 1 came first);
  - routes are recomputed every `CORRIDOR_RECHECK_TICKS` and after a structure dies, and a route
    through a collapsed building's rubble updates (the blocked mask changed).
- [ ] **Step 2: Implement.** Events fire on change only.
- [ ] **Step 3: Re-pin the economy pins, once.** The F1 fixtures gain two zones and a
  `supply_corridor` with an entry, and the hash gains zone holders, cut causes and the side-1 purse.
  Commit message: *"economy pins re-pinned: held-ground income and corridors (G3 Q2, lead 4 Oct); the
  fixtures gained two zones and a convoy route; was N / M"*. Coverage: assert the replay passes
  through a held state, a contested state and a cut state at least once each.
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

## Task 8: zones on five missions, with a world walk

**Model:** sonnet. **Agent:** `mission-author`, then `playtest`. **Depends:** Tasks 2, 7.

**Files:** the five D7 mission JSONs and their locale overlays (only if a briefing line now lies).

- [ ] **Step 1: Author** the approved zones and rates. No objective, placement or trigger changes.
- [ ] **Step 2: The world walk.** For each mission, run the shipped plan and print, every 30 s:
  each zone's holder, each corridor's cut cause, the purse, and income per minute. A declarative
  gate needs a world-state walk: no unit test notices a zone whose rectangle stopped containing the
  ground it was chosen for (memory, "declarative gates need a world-state walk"; and "placements
  spread across tiles"). Paste the walk into the PR description.
- [ ] **Step 3: Measure.** Every plan still wins; every passive control still loses. Lines that move
  are the five missions' (purse, banking) and anything downstream of a changed outcome.
- [ ] **Step 4: See it red.** Point one zone at a rectangle the plan never enters: its walk prints
  `holder -1` for the whole mission. That is the reading a mis-authored zone gives, and the PR shows
  it once.

---

## Task 9: the banking report, and the plans re-proved

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Task 8.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1: The banking line.** For every economy mission, print earned, spent and banked % at
  the end of the winning plan and of the passive control. Pin two numbers in the `LADDER_CREDITS`
  idiom: **`BANKING_OVER_30_WINNERS`** (winning plans banking more than 30%; M today: 16 of 18) and
  **`ZONE_PASSIVE_INCOME`** (income from zones earned by passive controls across the five missions;
  expected 0 or near it: a force that never moves holds only the ground it started on).
- [ ] **Step 2: Re-prove.** The three building plans (`beit_sahwan_2_foothold`,
  `deir_amun_2_foothold`, `wadi_halam_2_laager`) are re-run. A plan that now has more to spend
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
  first. Record capture conditions with the numbers.
- [ ] **Step 2: Contract.** GDD §3: the base rate, zones on top, contested pays nobody, the cut and
  its three causes, the half. `docs/campaign/README.md`: `income_zones` and `supply_entry` in the
  schema digest, with the rule that an income zone is chosen for ground both sides want.
- [ ] **Step 3: Ledger.** `docs/HANDOVER.md` §1, §3 (D1–D8), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat and relief | **unmoved** (R) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 7 | held-ground income and corridors (G3 Q2) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical through Task 7 except a D2 halving on the two corridor missions (R); Task 8 moves the five D7 missions | zones authored; new banking lines and gates |
| `LADDER_CREDITS` | moves only if a D7 mission's grade or `unitHome` moves (R: income alone changes no outcome a plan that does not spend can see) | named per mission in the pin's comment, the house style above `LADDER_CREDITS` |

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
