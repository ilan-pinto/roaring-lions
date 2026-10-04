# WP-G-F plan F4: production at the field camp, rally points, and an AI that spends (GH-183, GH-136, G3 Q3). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production gets a place, a pace and a destination, and the enemy buys the same way the
player does.

| | today (`main` `067fab9a`) | after F4 |
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
- The G3 decision sheet (PR #369), Q3: the parallel queue, the 8 camp missions (6 via `structures`,
  `umm_zeitoun_3/4` via the map symbol `c`), the spike's AI banking (3,816 unspent against a passive
  player; 670–1,630 unspent at 1.63× in `naive` games, M), the officers' "never charged" prices
  (officers stay a deploy slot), and GH-115/GH-109's limits (no construction yard, no power, no sell,
  no mirrored tech trees).
- F2 (`2026-10-04-gf2-held-ground-income.md`): side 1's purse from held zones. F3
  (`2026-10-04-gf3-population-cap-on-loan.md`): the cap and the queue reservation.
- Field works plan (`2026-09-29-field-works.md`, Stage 5): a work that produces would be a second
  line; F4 does not add any.

**Base:** read against `main` `067fab9a`. Branch `feat/gf4-production`, cut from `main` after F2
lands. Nothing measured yet: (M) is quoted from the G3 sheet, (R) is reasoned.

---

## Decisions

- **By the lead, 4 Oct (G3 Q3):** as in the table and Refs.
- **Recorded from G3 (no new ruling needed):** officers stay a deploy slot and are never built from a
  line; no camp is built by the player in Stage 4 (a buildable camp is a field-works question for
  Stage 5, inside GH-115's limit).
- **Taken defaults (confirm or overrule):**
  - **D1. Contested** means a living, surface, ground unit of the other side within
    `CONTEST_RADIUS_SQ` (6 tiles, the hold rule's own number) of the line's exit point. Aircraft do
    not contest a camp (the #279 ruling (a) principle, as in F1 and F2).
  - **D2. A mission with no camp keeps one line at `player_start`**, and the contested rule applies
    to that point too: reinforcements arrive at a point the player holds (#183 F4). A mission with
    neither builds nothing, as today.
  - **D3. Pay at queue time, as today.** Cancelling a queued item refunds it in full; cancelling the
    item in progress refunds it in full too (the unit never existed). The F3 population reservation
    is released with it.
  - **D4. A camp that dies loses its line**: the item in progress is lost, queued items are refunded,
    and the rally point goes with it. Today's "field camp destroyed — no production" stands once the
    last camp is gone.
  - **D5. The rally order is a `move`**, not an attack-move. A rally point on a blocked tile is
    refused (the set call returns false), never snapped. A rally point is per line and survives
    until cleared or the camp dies. No rally point: the unit stays at the exit, as today.
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
  construction). The runtime issues `move` commands through `sim.queueCommand`; it never writes a
  position. No floating point added.
- **Sim pins unmoved** by every task (R): the golden replays build no `MissionRuntime`. A move is a
  defect.
- **The economy pins move once**, in Task 6, with the reason.
- **`pnpm balance`** byte-identical (R).
- **`pnpm playtest`**: exit 0 at every commit. Lines that move are the missions whose plans build
  (`beit_sahwan_2_foothold`, `deir_amun_2_foothold`, `wadi_halam_2_laager`, M) and, through serial
  timing, nothing else (R): a plan that builds nothing cannot see a line. Every plan still wins;
  every passive control still loses.
- **Every check seen red**, by a one-line mutation, quoted in the commit.
- **Gates before every commit:** as F1, plus `pnpm validate:data` for Task 7.
- **Git, TypeScript, lane:** as F1. The dock, the rally input and its marker are WP-S-F's (Lane A).

---

## File structure

| File | Role | Task |
|---|---|---|
| `docs/campaign/economy/production-numbers.md` | **New.** G-NUM and the D-list for the lead | 1 |
| `packages/sim/src/production.ts` (+ test) | **New.** Pure: `ProductionLine`, `advance`, `cancel`; `spendDown` | 2, 8 |
| `packages/sim/src/mission.ts` (+ test) | Lines per anchor per side; contested; rally; enemy purse and spender; `queueView` per line | 3, 4, 5, 9 |
| `packages/sim/src/structures.ts`, `data/schemas/mission.schema.json` | `structures[].side` (a placement-level `produces_for` override) | 7 |
| `data/schemas/mission.schema.json`, the `validate:data` script | `enemy.production` | 7 |
| `packages/sim/src/determinism.test.ts` | The economy re-pin | 6 |
| `packages/app/src/main.ts`, `ui/production.ts`, `ui/dock-model.ts` | Call sites `typecheck` forces (`queueView` shape) | 3 |
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
- [ ] **Step 2: Build times.** Tabulate `build_time_s` for every buildable KDF unit. A serial line
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
// queueView() keeps its shape for the dock until S-F, flattened across lines.
```

- [ ] **Step 1: Write the failing tests:**
  - **"two builds queued in one tick deploy one build time apart"** on a camp mission (red on
    `main`: they deploy together);
  - **"two camps are two lines"**: one build on each deploys together, each at its own camp's exit;
  - **"a mission with no camp builds at `player_start`, serially"** (D2);
  - **"a camp's death loses the item in progress and refunds the queue"** (D4); with the last camp
    gone, `buildBlockedReason` still reads "field camp destroyed — no production";
  - the F3 cap and reservation still bind across lines (one reservation pool per side);
  - `cancelBuild` refunds logistics and intel exactly.
- [ ] **Step 2: Implement.** Lines are built at construction from the structures with
  `producesFor === side` (map and mission alike: the `c` camps of `umm_zeitoun_3/4` included, M), in
  structure index order. `productionAnchor` stays for `buildBlockedReason`. The flat `buildQueue`
  goes.
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
  arithmetic (extract it from the objective code rather than copying it).
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
  - with a rally point, a finished unit receives a `move` to it on its deploy tick, and arrives;
  - with none, it stands at the exit (byte-identical to Task 3's behaviour);
  - a rally point on a `#` tile is refused and the previous one is kept;
  - a rally point set while an item is in progress applies to that item;
  - a multi-unit placement (a team of three) moves as one group order, so it lands in formation
    (`formation.ts`), not stacked on one tile (CLAUDE.md, "units stack on one tile is a bug");
  - the rally `move` reaches the sim through `queueCommand` and nowhere else: a test spies the
    command queue and asserts one `move` with the spawned ids.
- [ ] **Step 2: Implement.** `spawnPlacement` already returns the spawned ids; queue the `move` for
  them in the same tick.
- [ ] **Step 3: See it red.** Write `goalX/goalY` directly instead of queueing a command: the spy test
  fails (and invariant 4 says why it must). Accept blocked tiles: the `#` test fails.

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
    1/1200 accumulator F2 introduced;
  - it buys through `spendDown`, one unit at a time, and its line freezes when a KDF squad contests its
    camp (the same rule, G3 Q3);
  - built units get the authored `tag` and walk to the `rally` marker;
  - a trigger that `commit`s that tag sends them on, which is how authored content and bought units
    meet;
  - with no `enemy.production` block, side 1 never buys, even with a purse from zones (D7: today's
    campaign behaviour).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: The witness.** `enemy-production-probe.ts` loads `tel_marum_3_clearance` and, in
  memory only, gives side 1 a camp at its battery position, a purse of 1.6× the KDF's starting
  logistics (Q7's ratio, applied here only as a probe number), and a menu of `sarim_rifles` and
  `atgm_cell`. It runs the shipped plan and a passive control over the 30-seed list the G3 sheet names
  and prints, per run: units bought, unspent at the end (as a share), outcome, length. Report-only, no
  gate: C5 (spending) is report-only at G4 by the lead's own table. The expected reading is unspent
  near 0% (R, D8), against the spike's banked thousands.
- [ ] **Step 4: See it red.** Let side 1 build in parallel (skip the line): the "one unit at a time"
  test fails, and the probe's bought count jumps.

---

## Task 10: the plans re-proved

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Tasks 3–5.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1:** Re-run every plan. For each of the three building plans, if the serial line changed
  its outcome, re-time its `requestBuild` calls to the same intent (the same units, queued earlier or
  on two camps where the mission has two) rather than changing what it buys. Comment each change with
  Task 1's parallel-vs-serial ticks.
- [ ] **Step 2: One plan uses a rally point.** `deir_amun_2_foothold`, the one plan that spends for
  replacement (M, G3 sheet), sets its camp's rally point at its forward position, so the rally path is
  exercised by the gate and not only by unit tests. It must still win.
- [ ] **Step 3: Measure.** Every plan wins; every passive control loses; banking lines (F2) printed
  and their pins re-read; `LADDER_CREDITS` and `GATES` re-pinned only where a grade or `unitHome`
  moved, with the per-mission terms in the comment.
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
| sim pins, flat and relief | **unmoved** (R) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 6 | serial lines per camp, the contested pause, rally points (G3 Q3) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | the three building plans' lines move (serial timing, and one rally) | Task 10's plan edits, each commented |
| `LADDER_CREDITS` | moves only if a building plan's grade or `unitHome` moves (R) | named per mission |

## Lane A needs (WP-S-F #184)

- **The dock per camp**: a camp switcher where a mission has two; each line's queue, the item in
  progress with its progress bar (`progress`, 0–1000), and cancel per item with the refund shown.
- **"Contested: production paused"** on the line, from `contested`, and a feed alert when it starts.
- **Setting a rally point**: an armed order from the dock ("Set rally", then a ground click), the same
  arming model as fire support (Escape disarms, #264). There is no structure selection today (FW Task 11
  adds a works-only one in Stage 5), so the dock is the entry point. **The rally marker is drawn in
  the world, so it is mocked and shown to the lead before it is built** (memory: mock a world overlay
  first; no status marks in the world). Keep it an order indicator shown while the camp's dock is
  open, not a permanent mark.
- **The tutorial's economy step**: build, see it pause under fire, set a rally point.
- Strings through `t()`.
