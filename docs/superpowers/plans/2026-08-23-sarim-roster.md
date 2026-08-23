# Sarim Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Sarim Brigades a six-unit roster by adding four units as pure JSON, and add the sixth GDD §5.7 backtest target that proves the standoff doctrine works.

**Architecture:** Four unit files under `data/units/enemy/`, registered in `@lions/data`'s `units` export. No engine code: every field they use — `faction: "sarim"`, roles `artillery`/`aa`, weapon types `rocket`/`atgm`/`rpg`, `can_target: ["air"]`, `splash_tiles`, `min_range_tiles` — is already in the schema and live in the sim. One new backtest target, `standoffExchange()`, alongside the existing five.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, JSON Schema (ajv), Python 3 for the cost-curve gate.

**Spec:** `docs/superpowers/specs/2026-08-23-sarim-roster-design.md` (committed `9a919d7`)

## Global Constraints

- **NO changes to `packages/sim/src/`.** This slice is data plus one backtest file. A diff touching sim source means something has gone wrong — stop and raise it.
- **NO changes to `data/schemas/`.** Every field these units need already exists. If one appears not to, stop and raise it rather than extending the schema.
- **`pnpm test:determinism` pin must not move.** No sim code is touched. Movement is a bug in the work, never a value to update.
- **The four units must NOT declare `hidden_setup`.** It is dead — declared by `atgm_cell` and read by nothing. Authoring more instances deepens the exact pattern the spec catalogues.
- **The four units must NOT use weapon `magazine` or `reload_s`.** Also dead: schema-only, read by the sim for APS alone.
- **The schema's `interceptor` weapon type is NOT used.** It is vestigial — zero structure damage, filler falloff, no shipped weapon declares it.
- **No pre-existing unit's stats may be changed** to make a gate pass. If the cost-curve refit pushes an existing unit out of band, STOP and report it. `attack_drone` sits at +16.7% against a ±18% band and is the likely casualty.
- **TypeScript strict. No `any`.** No non-null assertions.
- **Never `git add -A` or `git add .`, and never `git stash` in any form.** This repository's stash stack is shared with other live worktrees and concurrent sessions. Stage the exact paths each task names.
- **Commit message trailers** — every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `data/units/enemy/rocket_battery.json` | **new** — the front's signature indirect weapon | 1 |
| `data/units/enemy/sarim_rifles.json` | **new** — trained infantry that holds under fire | 1 |
| `data/units/enemy/manpad_team.json` | **new** — anti-air, air-only | 1 |
| `data/units/enemy/recoilless_team.json` | **new** — medium AT below the Kornet cell | 1 |
| `packages/data/src/index.ts` | register all four in `units` | 1 |
| `tools/src/backtest/targets.ts` | **new** `standoffExchange()` | 2 |
| `tools/src/balance/cli.ts` | run the sixth target | 2 |
| `docs/GDD.md` *(only if it lists the roster)* | name the four units | 3 |

### Why all four units are ONE task

`tools/validate_balance.py` **refits the cost curve from the whole roster on every run**. Splitting the units across tasks would fit Task A's costs against one curve, then move that curve when Task B lands — silently invalidating Task A's fitted prices. The four units are atomic with respect to their own gate, so they land together.

---

### Task 1: The four units

**Files:**
- Create: `data/units/enemy/rocket_battery.json`
- Create: `data/units/enemy/sarim_rifles.json`
- Create: `data/units/enemy/manpad_team.json`
- Create: `data/units/enemy/recoilless_team.json`
- Modify: `packages/data/src/index.ts` (import block ending ~line 53, `units` export ~line 136)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `units.rocket_battery`, `units.sarim_rifles`, `units.manpad_team`, `units.recoilless_team` on `@lions/data`'s `units` export, and four new `UnitId` values.

- [ ] **Step 1: Author `rocket_battery.json`**

The longest weapon in the game, past `mortar_team`'s 18. Fragile, slow, and with a `min_range_tiles` hole it cannot defend — reaching it is a mission, not a duel. `rocket` is in `INDIRECT_MASK` (`sim.ts:222`), so it needs no line of sight: rock blocks sight and does not block this.

```json
{
  "id": "rocket_battery",
  "name": "Rocket Battery",
  "faction": "sarim",
  "role": "artillery",
  "cost": { "logistics": 290, "build_time_s": 40, "population": 3 },
  "hull": {
    "hp": 320,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 4,
    "suppression_resistance": 0.35
  },
  "mobility": { "speed_tiles_s": 0.5 },
  "sensors": {
    "optics": 0.9,
    "sight_tiles": 6,
    "signature": 0.6,
    "firing_signature_mult": 6.0
  },
  "weapons": [
    {
      "id": "grad_122",
      "type": "rocket",
      "range_tiles": 20,
      "effective_range_tiles": 15,
      "accuracy": 0.4,
      "penetration": 40,
      "damage": 240,
      "splash_tiles": 3.0,
      "suppression": 110,
      "rof_per_min": 2,
      "min_range_tiles": 4,
      "can_target": ["ground", "structure"],
      "collateral_risk": 0.7
    }
  ]
}
```

- [ ] **Step 2: Author `sarim_rifles.json`**

"Best-trained" made mechanical: where `militia_cell` melts at `suppression_resistance` 0.4 and `inf_squad` holds at 0.5, these hold at 0.72. Ground must be taken rather than shocked.

```json
{
  "id": "sarim_rifles",
  "name": "Sarim Rifles",
  "faction": "sarim",
  "role": "infantry",
  "cost": { "logistics": 340, "build_time_s": 26, "population": 2 },
  "hull": {
    "hp": 420,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 8,
    "suppression_resistance": 0.72
  },
  "mobility": { "speed_tiles_s": 0.9 },
  "sensors": { "optics": 1.15, "sight_tiles": 9, "signature": 0.5 },
  "weapons": [
    {
      "id": "rifles",
      "type": "small_arms",
      "range_tiles": 8,
      "effective_range_tiles": 6.5,
      "accuracy": 0.68,
      "penetration": 10,
      "damage": 18,
      "suppression": 55,
      "rof_per_min": 320,
      "can_target": ["ground", "air"],
      "collateral_risk": 0.15
    }
  ]
}
```

- [ ] **Step 3: Author `manpad_team.json`**

`can_target: ["air"]` **only** — helpless against infantry, exactly as `recon_drone` is, and that is the doctrine rather than an oversight. Type `atgm` because `FALLOFF_SCALE` gives it 0.25 against every other class's 1.0 (`tuning.ts:36`), which is a guided missile holding accuracy at range.

```json
{
  "id": "manpad_team",
  "name": "MANPAD Team",
  "faction": "sarim",
  "role": "aa",
  "cost": { "logistics": 210, "build_time_s": 18, "population": 1 },
  "hull": {
    "hp": 320,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 2,
    "suppression_resistance": 0.5
  },
  "mobility": { "speed_tiles_s": 0.75 },
  "sensors": {
    "optics": 1.2,
    "sight_tiles": 12,
    "signature": 0.4,
    "firing_signature_mult": 5.0
  },
  "weapons": [
    {
      "id": "manpad",
      "type": "atgm",
      "range_tiles": 13,
      "effective_range_tiles": 11,
      "accuracy": 0.7,
      "penetration": 60,
      "damage": 300,
      "suppression": 15,
      "rof_per_min": 3,
      "min_range_tiles": 2,
      "can_target": ["air"],
      "collateral_risk": 0.1
    }
  ]
}
```

- [ ] **Step 4: Author `recoilless_team.json`**

Fills the gap between rifles and a 235-cost Kornet cell, so a Sarim position is not all-or-nothing. Shorter and weaker than `atgm_cell` on every axis.

```json
{
  "id": "recoilless_team",
  "name": "Recoilless Team",
  "faction": "sarim",
  "role": "at_team",
  "cost": { "logistics": 205, "build_time_s": 16, "population": 1 },
  "hull": {
    "hp": 340,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 3,
    "suppression_resistance": 0.45
  },
  "mobility": { "speed_tiles_s": 0.85 },
  "sensors": { "optics": 1.0, "sight_tiles": 8, "signature": 0.45 },
  "weapons": [
    {
      "id": "spg9",
      "type": "rpg",
      "range_tiles": 7,
      "effective_range_tiles": 5.5,
      "accuracy": 0.6,
      "penetration": 650,
      "damage": 320,
      "suppression": 25,
      "rof_per_min": 4,
      "can_target": ["ground"],
      "collateral_risk": 0.3
    }
  ]
}
```

- [ ] **Step 5: Register them in `@lions/data`**

In `packages/data/src/index.ts`, add four imports after the `diggerCrew` import (~line 52):

```ts
import rocketBattery from '../../../data/units/enemy/rocket_battery.json';
import sarimRifles from '../../../data/units/enemy/sarim_rifles.json';
import manpadTeam from '../../../data/units/enemy/manpad_team.json';
import recoillessTeam from '../../../data/units/enemy/recoilless_team.json';
```

and four entries to the `units` export, after `digger_crew`:

```ts
  rocket_battery: rocketBattery,
  sarim_rifles: sarimRifles,
  manpad_team: manpadTeam,
  recoilless_team: recoillessTeam,
```

- [ ] **Step 6: Validate the shapes**

```bash
pnpm validate:data
pnpm typecheck
```

Expected: the data gate passes with 4 more files than its previous count of 65 (so 69), and typecheck is clean.

If `validate:data` rejects a field, **do not invent a schema change** — stop and report. Every field above was verified present in `unit.schema.json` before this plan was written.

- [ ] **Step 7: Fit the costs to the curve**

```bash
python3 tools/validate_balance.py --units data/units
```

The `cost.logistics` values in Steps 1-4 are **starting estimates, not answers**. The curve is refitted from the whole roster on every run, so the only way to know a price is to run the gate.

If any of the four is out of band, adjust **only that unit's `cost.logistics`** toward the printed `expected=` value and re-run. Do not change its stats to chase the price — the stats are the design; the cost is the consequence.

Repeat until the gate passes.

- [ ] **Step 8: Check whether the refit broke an existing unit**

This is the step the whole task turns on. Run:

```bash
python3 tools/validate_balance.py --units data/units --tolerance 0.001
```

That deliberately fails everything and prints a `deviation=` line per unit. Record the **largest positive** and **largest negative** deviation among the **pre-existing 25 units**, and compare against the pre-task baseline:

```
rpg_team      -4.4%
attack_drone  +16.7%     ← 1.3 points from the ±18% limit
```

If `attack_drone` — or any pre-existing unit — has moved past ±18%, **STOP and report it**. Do not retune it. Do not adjust the new units to drag the curve back. That is a finding about the roster's economy, and it is the controller's call.

Report the before/after numbers either way, even when nothing breaks.

- [ ] **Step 9: Confirm nothing else moved**

```bash
pnpm test
pnpm test:determinism
```

Expected: all pass, hash unchanged. New JSON files touch no test and no sim code; if the determinism hash moves, something is very wrong — stop and report.

- [ ] **Step 10: Commit**

```bash
git add data/units/enemy/rocket_battery.json data/units/enemy/sarim_rifles.json \
        data/units/enemy/manpad_team.json data/units/enemy/recoilless_team.json \
        packages/data/src/index.ts
git commit -F - <<'EOF'
feat(data): Sarim gets a roster instead of two units

Four units, all pure JSON: a rocket battery, trained rifles, a MANPAD
team and a recoilless team. Sarim had an ATGM cell and a loitering drone
against Ashwar's six and KDF's thirteen, and Tel Marum cannot be authored
against a roster that does not exist.

The battery is the front's signature and the longest weapon in the game
at 20 tiles. It matters more than its range suggests: `rocket` sits in
INDIRECT_MASK beside `mortar`, so it needs no line of sight. Rock blocks
sight and does not block this, which is what makes hiding behind slice
1's ridges insufficient -- you cannot wait the rockets out under cover,
because cover is not what stops them. Its min_range hole is the answer:
reaching the tubes is a mission rather than a duel.

The rifles are "best-trained" made mechanical -- suppression resistance
0.72 where militia melt at 0.4 and KDF infantry hold at 0.5, so ground
must be taken rather than shocked. The MANPAD carries no ground weapon
at all, helpless against infantry exactly as recon_drone is, because a
Sarim position is meant to be a combined-arms problem.

No unit declares hidden_setup, and none uses weapon magazine or
reload_s. All three are schema-only fields the sim ignores, and
authoring more instances would deepen a pattern the spec already
catalogues four times over.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 2: The sixth §5.7 target

`pnpm balance` runs five targets. #15 requires a sixth and it does not exist. As #15 words it — *"an ATGM cell firing from ≥8 tiles wins the cost exchange against an APS-equipped MBT over a three-missile engagement"* — a one-versus-one cannot pass: one Kornet's three missiles land ~0.75 of them past a 0.75-Pk APS for ~300 of 3000 HP, while the Lavi's 12-tile gun outranges the cell's 10 and shoots first.

So the target is an **equal-spend** exchange, which is what a cost exchange means.

**Files:**
- Modify: `tools/src/backtest/targets.ts` (append a new exported function)
- Modify: `tools/src/balance/cli.ts:6` (import) and `:10` (results array)

**Interfaces:**
- Consumes: `units.atgm_cell` and `units.mbt_lavi` from `./harness`; `runBattle`, `countAlive`, `TargetResult`.
- Produces: `export function standoffExchange(seeds?: number): TargetResult`.

- [ ] **Step 1: Write the target**

Append to `tools/src/backtest/targets.ts`. Note the file's existing imports at the top already bring in `Sim`, `fx`, `TICKS_PER_SECOND`, `countAlive`, `runBattle`, `units` and `TargetResult` — extend that import line rather than adding a second one.

```ts
// ---------------------------------------------------------------------------
// 6. Standoff cost exchange (closes #15)
//    Equal logistics on both sides: 4x atgm_cell (940) against 1x mbt_lavi
//    (906), opening at 8 tiles.
//
//    #15 words this as one cell against one tank, which cannot pass and should
//    not: a single Kornet puts three missiles into a 0.75-Pk APS for ~300 of
//    3000 HP, while the Lavi's 12-tile gun outranges the cell's 10 and shoots
//    first. "Wins the cost exchange" means equal spend, and at equal spend the
//    mechanism is SATURATION -- twelve missiles against an APS magazine of
//    three. That is the doctrine the front is built on, so that is what gets
//    measured.
//
//    A win requires the tank dead AND at most 3 cells lost: 4 cells lost is
//    940 logistics spent to destroy 906, which is a loss however it looks on
//    the field.
// ---------------------------------------------------------------------------
const CELL_COST = 235;
const TANK_COST = 906;

export function standoffExchange(seeds = 30): TargetResult {
  let wins = 0;
  const cellsLost: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 77000 + s, width: 24, height: 12, capacity: 16 });
    const cell = sim.addUnitType(units.atgm_cell);
    const tank = sim.addUnitType(units.mbt_lavi);
    // Four cells abreast on the west side, the tank 8 tiles east of them.
    for (let i = 0; i < 4; i++) sim.spawn(cell, 0, fx.from(2.5), fx.from(3.5 + i * 1.5));
    sim.spawn(tank, 1, fx.from(10.5), fx.from(5.5), WEST);
    runBattle(sim, 90 * TICKS_PER_SECOND);
    const alive = countAlive(sim);
    const lost = 4 - alive[0];
    cellsLost.push(lost);
    if (alive[1] === 0 && lost * CELL_COST < TANK_COST) wins++;
  }
  const rate = wins / seeds;
  return {
    name: 'Standoff cost exchange',
    detail: `4x atgm_cell (${4 * CELL_COST}) vs 1x mbt_lavi (${TANK_COST}) at 8 tiles, ` +
      `mean ${mean(cellsLost).toFixed(1)} cells lost`,
    measured: `${(rate * 100).toFixed(0)}% of engagements won on cost`,
    target: '≥60%',
    pass: rate >= 0.6,
  };
}
```

- [ ] **Step 2: Wire it into `pnpm balance`**

`tools/src/balance/cli.ts` line 6 becomes:

```ts
import { atgmPk, apsIntercept, urbanRatio, lanchester, airContested, standoffExchange } from '../backtest/targets';
```

and line 10:

```ts
const results = [atgmPk(), apsIntercept(), urbanRatio(), lanchester(), airContested(), standoffExchange()];
```

- [ ] **Step 3: Run it and report the number honestly**

```bash
pnpm balance
```

Two outcomes, and they are handled differently:

**If the sixth target passes:** confirm the original five figures are unchanged from their pre-task values, and continue.

**If the sixth target FAILS:** stop and report the measured rate. Do **not**:
- add a fifth or sixth cell until it passes — equal spend is the definition of the target, and padding it makes the number meaningless
- lower the ≥60% threshold to whatever was measured
- change `atgm_cell` or `mbt_lavi` stats

A failure here is a real finding about whether the standoff doctrine works at all, and it is the controller's call what to do about it. Report the rate, the mean cells lost, and whether the tank died at all.

- [ ] **Step 4: Confirm the other gates**

```bash
pnpm typecheck
pnpm lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tools/src/backtest/targets.ts tools/src/balance/cli.ts
git commit -F - <<'EOF'
feat(tools): a sixth §5.7 target measures the standoff doctrine

Closes the last acceptance box on #15.

#15 words the target as one ATGM cell beating one APS-equipped MBT from
eight tiles, which cannot pass and should not. A single Kornet puts
three missiles into a 0.75-Pk APS for roughly 300 of 3000 HP, and the
Lavi's 12-tile gun outranges the cell's 10 and shoots first. Read
literally the target asks the cheapest anti-tank unit in the game to
beat the most expensive tank one-to-one.

"Wins the cost exchange" means equal spend, so the target is four cells
(940 logistics) against one tank (906), opening at eight tiles. At equal
spend the mechanism is saturation -- twelve missiles against an APS
magazine of three -- and saturation is the doctrine the whole front is
built on. A win needs the tank dead AND at most three cells lost, since
four lost is 940 spent to destroy 906.

No shipped unit was retuned to make this pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 3: Docs and the full gate sweep

**Files:**
- Modify: `docs/GDD.md` — **only** if it enumerates the Sarim roster. Check first with `grep -n "atgm_cell\|loiter_drone" docs/GDD.md`. If it lists them, add the four; if it does not, make no change and say so in the report.

**Interfaces:**
- Consumes: everything above. Produces nothing.

- [ ] **Step 1: Check whether the GDD lists the roster**

```bash
grep -n "atgm_cell\|loiter_drone\|Sarim" docs/GDD.md | head -20
```

If Sarim's units are enumerated somewhere, add the four new ones in the same style as the surrounding text, naming what each is for in a few words. If the GDD describes the faction only in prose, change nothing — inventing a roster table the document does not have is scope creep.

- [ ] **Step 2: Run every gate**

```bash
pnpm test
pnpm test:determinism
pnpm typecheck
pnpm lint
pnpm validate:data
pnpm validate:ui
pnpm build
pnpm balance
python3 tools/validate_balance.py --units data/units
```

Check each against what it guards:

| Gate | Expectation |
|---|---|
| `test` | 631/631, unchanged — this slice adds no test |
| `test:determinism` | hash **unchanged**; no sim code touched |
| `typecheck` / `lint` | clean |
| `validate:data` | **69** files (was 65), gate passed |
| `validate:ui` | 18 files clean |
| `build` | succeeds |
| `balance` | original five figures **unmoved**, sixth passing |
| `validate_balance.py` | **29** units within ±18% (was 25) |

- [ ] **Step 3: Run the playtest harness**

```bash
pnpm playtest
```

Expected: **exits 1**, failing on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` — the pre-existing baseline tracked as #96 and #97. No mission fields the new units, so this slice cannot have changed it. Record the failing mission names so a reader can see none were added.

- [ ] **Step 4: Commit**

Only if Step 1 changed `docs/GDD.md`:

```bash
git add docs/GDD.md
git commit -F - <<'EOF'
docs(gdd): name the four Sarim units

Gates: test 631/631 / determinism pin unmoved / typecheck / lint /
validate:data 69 files / validate:ui / build / balance six targets /
validate_balance 29 units within ±18%. pnpm playtest still red on the
two missions tracked as #96 and #97, unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

If Step 1 changed nothing, make no commit and report the full gate results instead.

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| Four units, shapes and anchors | 1 |
| `rocket` fires indirect | 1 (the battery's design and commit message) |
| `atgm` for the MANPAD, `interceptor` unused | 1 (Step 3) + Global Constraints |
| Weapon `magazine`/`reload_s` stay dead | Global Constraints |
| No `hidden_setup` on new units | Global Constraints |
| Cost curve refit risk, `attack_drone` at +16.7% | 1, Step 8 |
| Sixth target `standoffExchange()` | 2 |
| Verification (balance, validate_balance, determinism, validate:data) | 1 Steps 6-9, 3 Step 2 |
| Roster ships unused; no mission fields them | 3, Step 3 (playtest unchanged) |

**Placeholder scan.** No TBD/TODO. Every unit's full JSON is written out; the backtest target is complete code. Task 3's GDD step is conditional on a `grep` whose outcome the implementer reports either way — that is a real instruction, not a deferral.

**Type consistency.** `standoffExchange(seeds = 30): TargetResult` matches its interface block, its import in `cli.ts`, and the `TargetResult` shape used by the other five targets (`name`, `detail`, `measured`, `target`, `pass`). `WEST` and `mean` are already defined/imported in `targets.ts` — `WEST` at line 7, `mean` in the existing harness import.

**One risk the plan cannot remove.** Both Task 1 Step 8 and Task 2 Step 3 can legitimately fail, and both are instructed to STOP rather than tune until green. That is deliberate: a curve refit that breaks `attack_drone`, or a standoff exchange the cells lose, are findings about the game's economy and doctrine. Neither is something an implementer should quietly paper over, and both are the controller's call.
