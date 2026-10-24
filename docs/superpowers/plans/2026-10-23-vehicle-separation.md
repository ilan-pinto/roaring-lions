# Vehicle separation: vehicles in a group stop driving through each other (GH-421, PA-10). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Design:** `docs/superpowers/specs/2026-10-23-vehicle-separation-design.md` (read §1, §5 and §6 first).
**Supersedes:** `docs/superpowers/plans/2026-10-11-vehicle-spacing.md` (the push design; its Tasks 1, 1b
and 2a are parked on `feat/vehicle-spacing` @ `7e8371e3` and are reused below where named, re-measured).
**Instrument:** `tools/src/backtest/vehicle-overlap-probe.ts`, `pnpm --filter @lions/tools vehicle-overlap:probe`
(report-only, landed with this plan).

**Goal.** Two ground vehicles do not drive through each other, and a vehicle that is standing still is
never moved by another. Flow fields stay; no per-unit A*.

**Architecture.** Two stages, each landing on its own branch and PR.

- **Stage 1 — hull-aware formation slots (Option A).** `assignFormation` steps vehicle ranks 3 tiles
  apart (was 2) and pairs each rank's slots with its units by lateral order, ranks by forward order.
  Order time only: no new state, no per-tick cost.
- **Stage 2 — movers-only avoidance (Option B with B+).** In `stepMovement`, a participating mover
  refuses a step that deepens an overlap; it steers 45°/90° away from a stationary or oncoming hull,
  follows a same-way mover, ends its leg at contact when its goal is held (B+), and ghosts after 2 s of
  being blocked (today's behaviour, as a backstop). Nobody is ever pushed. One hashed column, `sepWait`.
  Participation by data: `mobility.footprint`.

**Gate on Stage 2.** The prototype lost scripted-plan seeds (spec §5; Khan Rafid II 0/30). Stage 2 starts
with a root-cause task and a go/no-go to the lead **before any pin moves** (Task 5).

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Base.** `main` at `cfa9b078` (23 Oct). Re-read every pin at pre-flight: other Lane C plans land first.
Worktrees under `/Users/ilpinto/dev/roaring-lions-ep/`; `pnpm install` once. Locate code by symbol, not
line: `stepMovement`, `assignFormation`, `applyCommands`' formation branch (`members.push`), `hash()`,
`unitTypeFromJson`, `addUnitType`, `stepSweep`, `stepTransport`, `stepDemolition`.

---

## Global constraints

- **The four invariants.** Fixed point only (`fx.mul`, `fx.div`, `fx.sqrt`, `fx.sin`, `fx.cos`); no
  `Math.*`, no `Date.*`, no `rng` in anything this plan adds to `packages/sim`. Footprints become Q16.16
  at load through `fx.from` (the sanctioned boundary). Nothing outside the sim writes sim state.
- **Order dependence is explicit and hashed.** Stage 2 reads neighbours in index order (Gauss–Seidel):
  `j < i` where it stands now, a moving `j > i` one nominal step ahead along its facing. Ids are creation
  order on both clients and every column read is hashed, so two clients that agree on a hash agree on
  every decision. No visiting order inside a tick may depend on anything unhashed (no Map/Set iteration).
- **No allocation per tick.** Capsule scratch (`Int32Array(15)`), overlap out (`Int32Array(4)`), the
  bucket grid (`head`, `next`) are allocated once in the constructor.
- **Pins move only as the re-pin table says, each in its own commit**, with "Was <n>." and the reason.
  A move this plan did not predict is a finding to explain before re-pinning.
- **STOP and report** (common rules) if a playtest OUTCOME, a §5.7 target, `LADDER_CREDITS`,
  `ROSTER_MAX` or a versus fairness result moves. Stage 1 is measured to move `LADDER_CREDITS`
  (5953 → 5948): it lands only with the lead's sign-off on that number (spec §8 Q1).
- **Every new check is seen red** by a one-line mutation of the implementation, quoted in the commit.
- **Gates before every commit touching the sim:** `pnpm lint && pnpm typecheck && pnpm test:determinism
  && pnpm test`, then `pnpm validate:data`, `pnpm balance`, `pnpm playtest`. Record the probe's output in
  the task report.
- **Never** run `pnpm ui:routes`, `golden-baseline`, `ui:shots` or `net:engines` locally; CI runs them.
  Never start or kill a dev server, never `pkill`, never port 5177.
- **Git:** `/usr/bin/git`, one plain command per call; `git commit -F <msg> -- <paths>`; never `-A`,
  `git checkout <file>`, `stash`, rebase or force-push. Commits end with
  `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. Write issue refs as GH-NNN. The lead merges.
- **Review:** one reviewer per task, plus `sim-guard` (Opus) on every sim diff.

---

## Re-pin table

| pin | Stage 1 (Tasks 1–2) | Stage 2 column (Task 4) | Stage 2 behaviour (Task 6) | Stage 2 follow-ups (Task 7) |
|---|---|---|---|---|
| `determinism.test.ts` flat `3719067886`, relief `2842924511`, orders `3272041047` | expected unchanged (prototype: 63/63 green) | **move** (column) | unchanged (no fixture has a footprint) | — |
| `SEPARATION_PIN` (new replay) | — | — | **born** | — |
| `WOUNDED_WORLD_PIN` `1774950105`, `ECONOMY_PIN` `904873885` / `_RELIEF` `2771311510`, `RUNTIME_DIGEST_PIN` `2037118941` / `_RELIEF` `1884258391`, `fire-support.test.ts` `HASH` | expected unchanged | **move** where they fold `sim.hash()` (grep at pre-flight) | re-read | — |
| versus literals: `packages/app/src/net/versus-force.test.ts`, `per-seat-types.test.ts`, `match-world.test.ts`, `tools/src/backtest/versus-breach.test.ts` | re-read | **move** (column) | **move** (behaviour) | — |
| `formation.test.ts`, `tools/src/formation_walk.test.ts` | **move** (re-derived, never loosened) | — | re-read | — |
| `pnpm playtest` outcomes (30 seeds) | hold (measured) | hold | **move** (measured; STOP → Task 5 go/no-go) | plan follow-ups, one commit each |
| `LADDER_CREDITS` = `CAMPAIGN_CREDITS` `5953` | **5948** (measured; lead sign-off) | — | moves (measured 5659 before follow-ups) | re-pin last, "Was <n>." |
| `ROSTER_MAX` `29` | unchanged (measured) | — | moves (measured 25 before follow-ups) | re-pin last |
| `pnpm balance` §5.7 | identical (measured) | identical | identical (measured) | — |
| `pnpm versus:probe`, net arena tests | re-read | re-read | re-read; a flip is a STOP | — |
| golden visual (`vehicle`, `kitted`) | expected unchanged | — | expected unchanged (spawned pairs are not ordered before capture); bless from CI only | — |
| `shippedContentDigest()` | moves with Task 1's JSON (no literal) | — | — | — |

How each is re-measured: determinism pins by `pnpm test:determinism` (the column commit carries the
proof that deleting its `hashArray` line reads every old value back); playtest by a full
`pnpm playtest` diffed against the pre-flight output with timing lines stripped; balance by diffing
`pnpm balance`'s PASS/FAIL and win-rate lines; versus by `pnpm versus:probe` (report-only) and the net
tests in `pnpm test`; the defect itself by the probe, before and after, quoted in the PR.

---

## Pre-flight (record in the first task's report)

- [ ] **1. Base and pins.** Cut the branch from `origin/main`. Re-read every pin in the re-pin table
  (`grep -rn "hash()).toBe(\|_PIN =\|LADDER_CREDITS =\|ROSTER_MAX =" packages tools`). Note which
  digests fold `sim.hash()`.
- [ ] **2. Baselines to the scratchpad:** `pnpm test:determinism`, `pnpm test`, `pnpm balance`,
  `pnpm playtest`, `pnpm versus:probe`, and the probe. All green; keep the files for diffing.
- [ ] **3. The roster.** Run `unitFootprintTable()` and list every type with a `vehicleHalfExtent` and
  ring class `light` or `armour`. That list, minus air and minus `moto_rpg`, is Task 1's footprint set
  (14 types at `cfa9b078`; spec §1.1).
- [ ] **4. Re-run the probe** and confirm spec §1.2's numbers (or record the drift).

---

# Stage 1

## Task 1: the footprint, as data (hash-neutral)

**Model:** Sonnet. **Agent:** implementer, then `sim-guard`.
**Reuse:** cherry-pick the shape of `76aa56d0` (schema block, `UnitTypeJson.mobility.footprint`,
`UnitType.sepHalfLen/sepHalfWid/sepCentre/sepBound`, `tools/src/vehicle_footprint.test.ts`), **not its
numbers**: the Lavi row predates the x1.18 rescale.

**Files:** `data/schemas/unit.schema.json`; the 14 unit JSONs of pre-flight 3; `packages/sim/src/sim.ts`
(types and `unitTypeFromJson` only); `tools/src/vehicle_footprint.test.ts` (new).

- [ ] **Step 1: failing test.** `vehicle_footprint.test.ts` with a LITERAL table of the 14 hulls from spec
  §1.1 (an oracle imported from the code under test cannot fail), plus: exactly those declare one; every
  vehicle-domain ground type declares one except `moto_rpg` (named exemption with a demotion assertion);
  each JSON agrees with `unitFootprintTable()` to 0.05 tile (the measured side); `half_width_tiles × 2 ≤
  VEHICLE_SPACING` (sideways slots never contested by parallel hulls); and the rank census:
  `max over pairs (half_length_A + |min(centre_A, 0)| + half_length_B + max(centre_B, 0)) < 3`
  (= 2.54 today, a Namer behind a camo Lavi, so Task 2's rank depth 3 clears every pair). Run: red.
- [ ] **Step 2: schema + JSON.** `mobility.footprint { half_length_tiles, half_width_tiles,
  centre_along_tiles? }`, bounds 0.2–1.5 / 0.2–1.0 / −0.5–0.5. Values from the measurement, 2 decimals.
- [ ] **Step 3: load.** `unitTypeFromJson` sets the four Fx fields (0 when absent; `sepBound =
  sepHalfLen + |sepCentre|`). Air ignores a footprint (schema-refused on air: assert in the test).
- [ ] **Step 4: gates.** Determinism, `pnpm test`, `validate:data`; `balance` and `playtest` byte-identical
  bar timing (nothing reads the fields). Mutations: delete the Lavi's footprint; swap the Namer's numbers
  for the Eitan's; put one on `recon_drone`; delete the `moto_rpg` exemption — each red, quoted.
- [ ] **Step 5: commit** `data: vehicle footprints, measured from the hull GLBs (GH-421)`.

## Task 2: hull-aware formation slots (Option A; LADDER_CREDITS moves)

**Model:** Sonnet implementer; Opus `sim-guard` review.

**Files:** `packages/sim/src/formation.ts`, `packages/sim/src/formation.test.ts`,
`packages/sim/src/sim.ts` (the `members.push` line only), `tools/src/formation_walk.test.ts`,
`tools/src/backtest/playtest.ts` (the `LADDER_CREDITS` literal, its own commit).

**Interfaces.**

```ts
// formation.ts
/** Between vehicle RANKS: two hulls in consecutive ranks need up to 2.54 tiles (a Namer behind a camo
 *  Lavi, vehicle_footprint.test.ts's census), so 3. Sideways stays VEHICLE_SPACING (2). */
export const VEHICLE_RANK_DEPTH = 3;
export interface FormationUnit {
  id: number;
  domain: number;
  front: boolean;
  /** Where the unit comes from, whole tiles: the same point the centroid is built from. */
  fromX: number;
  fromY: number;
}
```

- [ ] **Step 1: failing tests** in `formation.test.ts`:
  - ranks: three vehicles plus a fourth on open ground, approach east: the fourth's slot is 3 tiles
    behind the click row (was 2);
  - pairing: two vehicles side by side, the NORTH one with the higher id, ordered east: the north one
    takes the north slot (was: the lower id took offset 0, the higher id +2);
  - forward order: a column of three ordered along its own axis: the leading vehicle takes the front
    rank;
  - determinism: identical input twice, identical slots; ties broken by id.
- [ ] **Step 2: implement.** In phase 1, step `r` by `VEHICLE_RANK_DEPTH` for front units. Before it, sort
  `front` by forward projection `fromX·fwdX + fromY·fwdY` descending (ties by id). After it, for each rank,
  re-pair: that rank's units sorted by lateral projection `fromX·latX + fromY·latY`, its slots sorted by
  lateral offset, zipped. All integers. Pass `fromX/fromY` from `applyCommands` (the same `fromX/fromY`
  the centroid already uses, so an appended leg pairs from the end of the previous leg).
- [ ] **Step 3: tools.** `formation_walk.test.ts`: re-derive each expectation from the new rule (the
  Tel Marum force's vehicles are no longer all on `y === 30` once a second rank forms: assert the new
  rows, never loosen to a range). Print the world on failure, as the file does.
- [ ] **Step 4: gates.** `test:determinism` (expected unchanged; a move is a finding), `pnpm test`,
  `balance` (expected identical), `playtest`: every plan 30/30 expected, `LADDER_CREDITS` 5953 → 5948
  expected. **If anything else moves, STOP.** Probe before/after in the report (expected at-rest pairs
  43 → 35; group-move rows 3 → 1 and 5 → 3).
- [ ] **Step 5: mutations** (each red, quoted): `VEHICLE_RANK_DEPTH = 2`; the lateral sort reversed;
  the forward sort dropped.
- [ ] **Step 6: commits.** (1) `sim: vehicle ranks 3 deep, slots matched to where units stand (GH-421)`
  with tests; (2) **only after the lead's sign-off**: `tools: LADDER_CREDITS 5948 (GH-421). Was 5953.`
  with the per-mission credit lines that moved.

**Stage 1 PR.** Probe before/after table, playtest and balance diffs, the formation pictures from the
sandbox (one Metal check on your own port, music off, or CI captures). Closes nothing; GH-421 stays open.

---

# Stage 2

## Task 3: capsule geometry, pure (hash-neutral)

**Model:** Sonnet. **Reuse:** `c03fda80` (`packages/sim/src/separation.ts`, `separation-geometry.test.ts`)
verbatim, re-reviewed: `hullCapsule`, `closestSegmentPoints` (Ericson 5.1.9), `capsuleOverlap`.

- [ ] Cherry-pick, run its literal tests, add one: a Lavi capsule built from Task 1's Fx fields at facing
  0 and `QUARTER_TURN` matches hand-derived endpoints (literal Fx values in the test).
- [ ] Mutation: drop the `clamp01` on `t` → red. Commit `sim: capsule geometry for vehicle separation, pure (GH-421)`.

## Task 4: the `sepWait` column and the bucket grid (column re-pin, no behaviour)

**Model:** Sonnet; Opus `sim-guard`.

- [ ] Add `sepWait: Uint8Array(capacity)`, exposed as `state.sepWait`, folded LAST in `hash()`; reset in
  `spawn`. Add the bucket grid fields (`sepHead: Int32Array(ceil(w/2)·ceil(h/2))`, `sepNext:
  Int32Array(capacity)`), allocated in the constructor, unused.
- [ ] Re-pin every `sim.hash()` literal (re-pin table, column) in ONE commit whose message carries the
  proof: with the `hashArray(h, this.sepWait)` line deleted, every old value reads back. `balance` and
  `playtest` byte-identical bar timing.
- [ ] Commit `sim: sepWait joins the hash, no behaviour (GH-421); the sim and versus pins re-pinned`.

## Task 5: build the avoidance on the branch, root-cause every lost seed, GO/NO-GO (no commit of behaviour)

**Model:** Opus (judgement). **Output:** a report to the lead, not a commit.

- [ ] **Step 1: build** Option B with B+ (spec §4, rules 1–6) as real code: participation by
  `sepHalfWid > 0 && !isAir`, surface only; the bucket grid built once per tick at the top of
  `stepMovement` from participants' positions (2-tile cells, ids pushed in ascending order); the test,
  steer, wait, valve and arrival rules inside the per-unit loop between the wall clip and the position
  write; arrival reuses the existing leg-completion block (`finishLeg` extracted byte-identically first,
  as `5cb0ba16` did). Constants in `tuning.ts` after `ROUT_SPEED_SHIFT`:
  `SEP_VALVE_TICKS = 40`, `SEP_TURN_45 = 46341`.
- [ ] **Step 2: measure** the probe, `playtest`, `balance`, `versus:probe` and the net tests against the
  pre-flight files. Expected from the prototype: deep pair-ticks −75%, at-rest pairs 43 → 21, balance
  identical, and plan seeds lost (spec §5, last full row).
- [ ] **Step 3: root-cause every lost seed**, one line each: plan, seed, tick, which rule fired (log
  `sepWait` saturations and B+ arrivals per run, as the 18 Oct report's valve line did), and the
  mechanism. Start with Khan Rafid II (0/30, fails `get_four_in`) and Khan Rafid I (seeds 2, 11, 14, 28;
  its jeep and Eitan are both sent to (24, 22) at t = 30 s).
- [ ] **Step 4: classify** each as (a) the plan relied on two vehicles sharing a point or on reaching a
  tile another vehicle holds — fixable in the plan; (b) B+ ended a leg inside or at the edge of an
  objective zone — fixable by a refinement (for example: B+ never ends a leg while the goal tile lies in
  a zone an active objective reads; or a held goal re-resolves to the nearest free tile instead of ending
  the leg); (c) the mission is unwinnable with separation on — a design finding.
- [ ] **Step 5: GO/NO-GO** to the lead with the table. GO needs no (c). Any refinement from (b) is
  re-measured through Step 2 before the report.

## Task 6: the avoidance, committed (behaviour re-pin)

Only after GO. **Model:** Sonnet implementer from Task 5's code; Opus `sim-guard`.

- [ ] **Step 1: tests** in `packages/sim/src/separation.test.ts` (role-less fixtures given footprints),
  each with literal expectations:
  - **stationary hulls never move:** a parked Lavi beside a column of three driving past it on open
    ground: its `posX/posY` bit-identical on every tick;
  - **head-on on open ground:** two Lavis on one tile-centre line pass, both arrive, the largest
    capsule overlap ≤ 0.05 tile, the valve never saturates;
  - **head-on in a two-wide corridor:** both arrive; the valve saturates (the backstop is seen to fire);
  - **a hulk in a three-wide street** (`debugDisableMobility`): a column of three gets past within a
    stated tick, and the hulk never moves;
  - **convergence (B+):** four hulls ordered `exact` to one point stop with every pairwise overlap
    ≤ 0.05 tile;
  - **spawned inside each other:** two Lavis on one point, one ordered away: it leaves (rule 1);
  - **the D9 cutting:** a demolishing D9 with a column driving past: `demoTicks` counts down undisturbed;
  - **transport:** an Eitan ordered while two squads board: riders ride the steered hull;
  - **index order:** the same scene with the two hulls' spawn order swapped reaches the same
    no-overlap outcome (positions may differ; the property must not).
- [ ] **Step 2: the separation replay** in `determinism.test.ts`: a mixed group crossing a narrow gap
  plus a convergence, 900 ticks, asserting the valve fired at least once and no pair ends deeper than
  0.05 tile, then its hash: `SEPARATION_PIN` born.
- [ ] **Step 3: the probe becomes a gate** (`vehicle-overlap-probe.test.ts`): for each group-move row,
  deep pair-ticks ≤ 1.5 × the Task 5 reading and at-rest pairs ≤ the Task 5 reading. Falsified by
  turning the avoidance off (one line): every row red. The instrument tests stay.
- [ ] **Step 4: walk test** `tools/src/vehicle_separation_walk.test.ts`: the `tel_marum_2_foothold` force
  ordered to the third terrace, and the sandbox KDF force ordered east: after 90 s no pair overlaps
  by more than 0.05 tile and every vehicle stands where `formation_walk` expects.
- [ ] **Step 5: gates and pins.** Behaviour commit with tests; then the versus literals (each "Was <n>.");
  playtest outcome moves are NOT re-pinned here: they go to Task 7.
- [ ] **Mutations** (quoted): steer toward instead of away; drop rule 1's "reduces overlap" allowance
  (spawned pair traps); drop the `j > i` prediction (followers stop-start: the column test's arrival tick
  moves); valve never saturates (corridor deadlock); B+ removed (convergence red).

## Task 7: plan follow-ups and the playtest re-pins

- [ ] One commit per plan fixed under Task 5's class (a): the plan change and the seed sweep line
  (30/30) that proves it. Never a mission edit in this task.
- [ ] Then `LADDER_CREDITS` / `CAMPAIGN_CREDITS`, `ROSTER_MAX`, `GATES` re-pins, one commit each, with the
  per-mission lines that moved and "Was <n>.". Each is a STOP-and-report under the common rules: send
  the numbers to the lead before committing.

## Task 8: the cost

- [ ] Commit the scratch stress as `tools/src/perf/vehicle-separation-cost.ts`: 300 units (100 vehicles,
  200 infantry) on `qarn_hadid` under six group orders, `stepMovement` timed by prototype wrap (as
  `sim-scaling.ts` does), 400 ticks, two runs. Prototype reading (brute force): 0.05 → 0.75–0.84 ms.
  Expected with the bucket grid: < 0.1 ms. Add the row to `docs/PERFORMANCE.md` ("Sim tick cost").

## Task 9 (optional, spec §8 Q4): spawn offsets

- [ ] Move `SANDBOX_KDF`'s `dozer_d9` and `jeep_shoded` offsets so no hull overlaps at spawn (the probe's
  "sandbox spawn" row reads 0 at rest). Versus pins move ("Was <n>."); golden `vehicle`/`kitted` may move:
  bless from CI after merge, never from the branch.

## Task 10: the ledger

- [ ] `CLAUDE.md`: a movement bullet (who takes part, the never-push rule, the valve, the probe).
  `docs/HANDOVER.md`, `docs/polish/commercial-polish-audit.md` PA-10 → DONE,
  `docs/superpowers/plans/2026-10-04-stage4-order.md`; close GH-421 with the before/after probe table.

---

## Review focus

1. **A stationary hull moved.** The whole design rests on "never push". Task 6's first test, plus a
   grep: nothing in the new code writes `posX/posY` of any index but `i`.
2. **Order dependence leaking.** Any read of a `j > i` value that is not hashed, or a visiting order
   from a Map or Set.
3. **A leg ended in a zone.** B+ and objective zones (Task 5, class b).
4. **The valve masking a bug.** A scenario that only passes because the valve fired: the corridor test
   asserts it fires; the open-ground tests assert it does not.
5. **Cost.** The bucket grid's build must be O(participants), not O(count²).

## For the lead

- Spec §8 has four questions. Stage 1 needs only Q1 (accept `LADDER_CREDITS` −5).
- Stage 2 is gated on Task 5's GO/NO-GO; until then nothing in it changes a pin.
