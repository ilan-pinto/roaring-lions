# Vehicle health: HP alone ends a vehicle (GH-560). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Design:** `docs/superpowers/specs/2026-10-27-vehicle-health-design.md` (merged in GH-858). Read §0, §1, §5.2,
§8 and §9 first. Its numbers are the expected values throughout this plan.

**The lead's rulings (27 Oct, GH-858 comments), all as the design recommended:**
1. **HP alone ends a vehicle.** The catastrophic roll is removed. A penetration costs at least 34% of max HP ×
   (1 + overmatch/60).
2. **Versus is re-centred by re-pricing in data** until every offered cell is inside 60/40 at 96 seeds.
3. **Regeneration is kept**, but a non-penetrating hit that could have come through restarts the 10 s delay.
4. **The cannot-penetrate fallback is kept.** Standoff (Sarim) stays report-only, with a doctrine/data
   follow-up.

Follow-ups named by the lead: `mission-author` for `wadi_halam_5_depot (gate open)` seed 22, and the versus
re-price pass. Both are tasks here (Tasks 7 and 8).

**Measured evidence.** The designer's scratch runs are preserved, outside the repo, at
`/Users/ilpinto/dev/roaring-lions-ep/_coord/vehicle-health/design-runs/`. The scratchpad they came from gets
wiped. Inside:
- `C9-H3-R5/` is the ruled combination: `det.txt`, `balance.txt`, `playtest.txt`, `vs-*.txt` and `probe.txt`;
- `V0-base/` is today;
- `scratch-switches.patch` is the switch scaffold;
- `probe-src/vh-probe.ts` is the scratch probe;
- `simtests-C9.txt` is `vitest run packages/sim` under C9.

**Base:** `origin/main` `6448d111` (v0.129.2). Nothing under `packages/sim`, `data` or `tools/src/backtest` has
changed since the design's base `0c86c10c`, so every design number still applies. Re-check at pre-flight. Find
code by symbol, never by line: `resolveHit` (its bounce branch and its penetration tail), `rollComponent`,
`ComponentResult`, `applyDamage`, `stepUpkeep` (field recovery), `stepFieldFix`, `hash()`.

**History checked (28 Oct).**
- `gh pr list --state all --search GH-560` finds only GH-858, the design (merged).
- `origin/docs/vehicle-health-design` is the design branch. No implementation branch exists.
- No PR is open on the repo.
- No follow-up issue exists yet for the Standoff doctrine, the re-price or the depot seed.

**Goal.** A vehicle dies when its HP bar reaches zero, and at no other time. The bar is the truth: luck deaths
go from 78–100% of armoured kills to 0%. The campaign stays winnable: 37/37 plans on 30/30 seeds, `LADDER_CREDITS`
and `ROSTER_MAX` held or re-pinned with the lead's sign-off. Every offered versus cell is inside 60/40 at 96 seeds.

**Architecture.** Two integer constants, one pure helper module, three edits in `resolveHit`/`rollComponent`,
one deleted union member. No new column, no new per-tick work, no new RNG draw.

- **The penetration cost.** `penetrationHpCost(maxHp, damage, shift)` returns
  `max(damage, 0.34 × maxHp × (60 + shift) / 60)`. `resolveHit`'s penetration tail applies that instead of
  the weapon's `damage`.
- **The component table without a kill.** `rollComponent` keeps its ONE draw on the shooter's stream, so
  every later draw is where it was. It loses the catastrophic weight and branch. Overmatch still moves `shift`
  points off crew shaken, so the rest of the table shares them.
- **The regen restart.** In `resolveHit`'s bounce branch, a round that `threatens` (the existing test,
  `splash > 0 || pen >= armorSide`) writes `lastDamagedTick`, as a penetration already does.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

---

## How the real change differs from the scratch switches

The scratch patch is NOT applied, cherry-picked or copied. It is the specification of what was measured, no more.

| Scratch (measured, never committed) | Ships |
|---|---|
| Eight `VH_*` switches at the end of `tuning.ts`, read in `sim.ts` | None. Two named constants: `PEN_HP_FLOOR = 22282 // 0.34` and `PEN_HP_OVERMATCH_DIV = 60`. `COMP_CATASTROPHIC` is deleted. |
| Catastrophic weight scaled by `VH_CAT_FULL_PCT` (0), the other weights x100 | The weight, its branch and `'catastrophic'` in `ComponentResult` are deleted. The total is `92 - shift`. **The draw is the same as the scratch's**, because `floor(u·100T/2^16) < 100w` holds exactly when `floor(u·T/2^16) < w` (w an integer), so every result matches C9. |
| `VH_REGEN_MODE` branches inside `stepUpkeep` | `stepUpkeep` is untouched. One line goes in `resolveHit`'s bounce branch: mode 5's write, unconditionally. |
| A `vhHpBefore` private field, the cause of the 8 `snapshot-schema.test.ts` failures in `simtests-C9.txt` | No new field or column. The snapshot schema and the format pin do not move. |
| The cost floor computed inline, with the overmatch shift recomputed beside `rollComponent`'s copy | Pure helpers `overmatchShift(z)` and `penetrationHpCost(maxHp, damage, shift)` in `packages/sim/src/vehicle-health.ts`, used by both call sites. **Same arithmetic, same order** (Ruling 2). |
| `VH_FALLBACK` modes 1–2 | None (ruling 4: the fallback is kept as it is). |
| `tools/src/backtest/scratch-vh/vh-probe.ts` | Ported as `tools/src/backtest/vehicle-health-probe.ts`: report-only, no switch reads, the `cat` column dropped (Task 4). |

The consequence is the plan's cheapest check. **The implementation must reproduce C9 bit for bit:** the relief
pin 1483138559, the C9 `balance.txt` and `playtest.txt` (timing lines aside), and every `vs-*.txt` cell. A
difference anywhere means the real change is not the measured one: STOP (G-4).

---

## Global Constraints (bind every task and every child)

- **G-1. The four invariants.**
  - Fixed point only. `Math.*`, `Date.*` and floating-point literals stay out of `packages/sim`.
  - The cost's one division is the integer `((a * b) / c) | 0` form that `swarmDive` already uses. The product
    is exact in a double (below 2^53), and the result fits int32 for any hull under about 64,000 hp (Task 1
    tests the bound).
  - No new RNG draw, and none removed: `rollComponent` still draws exactly once per penetration (invariant 3,
    and the reason C9's streams line up).
  - Nothing outside the sim writes sim state.
- **G-2. No allocation and no per-tick cost.** There are two integer multiplies on a penetration and one store on
  a threatening bounce. Nothing is added to any per-tick loop.
- **G-3. Pins move only as the pin table says, each in its own commit** carrying "Was <n>." and the reason.
  - That commit comes right after the behaviour commit that moved the pin, and the branch is never pushed
    between them. The PR is squash-merged, so CLAUDE.md's "update it in the same commit" holds on `main`.
  - A move this plan did not predict is a finding. Explain it before re-pinning.
- **G-4. STOP and report** (common rules) if any of these moves beyond what C9 measured:
  - a playtest OUTCOME, a §5.7 number, `LADDER_CREDITS`, `ROSTER_MAX` or a versus fairness reading.
  - What C9 measured is pre-ruled by the lead and does not stop the work. It is: 36/37 plans
    (`wadi_halam_5_depot (gate open)` seed 22), Air is contested at max tier 3 trucks 30% → 0% (2 trucks 33% → 0%),
    and the five versus cells outside 60/40 listed in the pin table.
  - Anything else is a STOP. The named STOP gates are S1–S6 below.
- **G-5. Every new check is seen red** by a one-line mutation of the implementation. The commit message names the
  mutation and quotes its red line, and the mutation is undone by an edit. Oracles take literals, never values
  imported from the code under test (casebook: "the oracle imported its arguments").
- **G-6. A re-derived test is never loosened.** Where a test asserted today's draws or today's lethality, the
  fixture changes (a stated HP, window or draw constant), never the assertion's bar. Each change is named in the
  commit with the reason. Deleting a test needs the lead.
- **G-7. Gates before every commit touching the sim:** `pnpm test:determinism && pnpm lint && pnpm typecheck &&
  pnpm test`. Before the task reports, also run `pnpm validate:data`, `pnpm validate:ui`, `pnpm balance` and
  `pnpm playtest`. Record outputs in `_coord/vehicle-health-progress.md` (not committed).
- **G-8. House rules, in every brief.**
  - Never pkill or killall, and never kill a dev server. Port 5177 is off-limits.
  - No browser in this plan. No local `ui:routes`, `golden-baseline` or `ui:shots`: CI runs them.
  - Git: `/usr/bin/git`, one plain command per call. Commit with `git commit -F <msg> -- <paths>`. Never `-A`,
    `git checkout <file>`, `git stash`, rebase or force-push.
  - Write issue refs as GH-NNN, never with a hash mark.
  - No deploys, secrets or production.
  - Commits end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. The PR body ends with the Claude
    Code line. The lead merges.
- **G-9. Children.**
  - Every child runs in the FOREGROUND, with `model` passed explicitly. Sonnet implements. Opus is for judgement
    only: the sim-guard review, the re-price lever choice (Task 7A) and the final review.
  - One reviewer per task, plus `sim-guard` (Opus) over every sim diff.
- **G-10. Shared files.** `sim.ts`, `tuning.ts`, `playtest.ts` and `data/versus/*.json` are high-churn. Edit only
  the named sites, rebase on conflict, and never take another lane's hunk.

---

## Rulings on ambiguity (made in this plan; the lead may overturn any)

1. **`'catastrophic'` leaves `ComponentResult`, and `COMP_CATASTROPHIC` leaves `tuning.ts`.** Weight 0 would
   leave a dead branch that a later edit could revive silently. The single draw stays (Architecture), so
   deleting changes nothing the scratch's weight 0 did not.
   - Only two places compare against the literal: `combat.test.ts` (rewritten, Task 2) and a comment in
     `alerts.test.ts` (Task 5).
   - The `catastrophic_kill` VFX trigger keeps its name. It keys off the `destroyed` event, never the component
     result (design §1; `explosion-burst.ts` header).
   - The GDD keeps "Catastrophic" as the name of the HP-0 brew-up (Task 9).
2. **The cost's arithmetic is the scratch's, in the scratch's order.**
   - Step 1: `floor = fx.mul(maxHp, PEN_HP_FLOOR)`.
   - Step 2: `floor = ((floor * (PEN_HP_OVERMATCH_DIV + shift)) / PEN_HP_OVERMATCH_DIV) | 0`.
   - Step 3: return `floor > damage ? floor : damage`.

   A Q16 `fx.mul(floor, ONE + shift/60)` rounds differently, so it would be a different change: the hp values
   would differ by one raw unit, the pins would differ, and every reading would have to be re-measured. It is
   rejected so that C9 stays the reference.
3. **The regen restart is one store to the existing `lastDamagedTick`.** No new `lastThreatTick` column. That
   column was not measured, and it would move every pin.
   - `lastDamagedTick` has two other readers, and both see the restart:
     - `stepFieldFix` restarts a stuck hull's crew fix on `lastDamagedTick === tickCount`;
     - the workshop's component repair in `stepUpkeep` restarts on `!== tickCount`.
   - So a threatening bounce now also restarts the crew field fix and the workshop repair. That is part of what
     C9 measured, and it matches the rule's wording ("a hit that could have come through"). Task 2 pins both
     with tests, and Task 9 documents them.
4. **The cost applies to every penetration of a hard target** (`!isSoft`), helicopters included, as measured.
   - Soft targets are unchanged.
   - Every damage path that is not a penetration roll is unchanged: splash, fire support, kamikaze, placed
     charges, collapse and the swarm paths.
   - Kill credit is unchanged: an HP death goes through `applyDamage` → `destroy(target, by)` with the same
     shooter the roll credited.
5. **No other constant moves.** `REGEN_DELAY_TICKS`, `REGEN_FRAC`, `REGEN_CAP`, `PEN_HURTS_MIN`, the component
   weights, `OVERMATCH_SHIFT_*` and the fallback all stay as they are.
6. **One PR**, carrying the sim change, the pins, the versus re-price, the depot fix and the docs.
   - A merge deploys to production, and the sim change alone would put five unbalanced cells into live versus
     rooms (design §0: "before it reaches a versus room").
   - The PR is not offered for merge until Task 10's gate shows all 16 offered cells inside and 37/37.
   - The other option is two PRs, the sim one held unmerged (GH-421's GH-809/GH-816 pattern). It is open to the
     lead (Q2).
7. **The versus re-price levers, in order of preference** (Task 7):
   - (a) JSON room data: `data/versus/<map>.json` (income zone rates, tunnel capacities, camps) and
     `data/doctrines/<faction>.json` (`budget.logistics_start`, `pop_cap`). Their only reader is the versus
     room (`match-world.ts`); pre-flight confirms it.
   - (b) the versus literal tables in `packages/app/src/net`: `VERSUS_SEATS` (`versus-seats.ts`) and
     `VERSUS_EXTRA`/`VERSUS_SARIM` (`versus-force.ts`). GH-816 moved seats under the lead's approval as "room
     data". The lead said DATA, so (b) is a STOP (S4).
   - (c) a unit's `cost` in `data/units/**`. It moves the campaign economy, `validate_balance.py`'s cost-curve
     band and possibly `LADDER_CREDITS`. STOP (S4); recommended against.
   - Maps and the sim are not levers.
8. **The depot seed is fixed in mission data or in the scripted plan, never in mission TypeScript.**
   - The brief says data. Precedent (GH-584, GH-570) re-scripted plans when the plan, not the mission, relied on
     a property the model change removed.
   - Task 8 root-causes the seed first, and the class decides. Either way the fix is a STOP for the lead before
     it commits (S5), because a mission's difficulty is a design call.
9. **Standoff stays report-only:** no gate in `pnpm balance`.
   - Its report is the committed probe's standoff rows (Task 4).
   - The doctrine/data follow-up (cell sight against Kornet range, a spotter, APS saturation) becomes a GH issue
     in Task 9.
10. **The probe is committed** as `tools/src/backtest/vehicle-health-probe.ts`, report-only, with
    `pnpm --filter @lions/tools vehicle-health:probe`. It is the witness GH-560 closes on.
    - It gets one cheap gating test (Task 4): no luck death in the Lavi duel over 20 seeds.
    - That test is falsified by restoring the catastrophic weight.
11. **The presentation is unchanged** (design §1: nothing downstream reads the component result).
    - Task 5 pins the bands the HP model now produces, with literals, so that a future band edit sees what it
      changes.
    - A scar or readout change is a lead question (Q4, Q5), not this plan.

---

## Pin table

Expected values are C9's (`design-runs/C9-H3-R5/`) unless marked "not measured".

| Pin | File | Task 2 (behaviour) | Task 7 (re-price) | Task 8 (depot) |
|---|---|---|---|---|
| golden flat `1258746094` | `packages/sim/src/determinism.test.ts` (2 sites) | unchanged (C9) | — | — |
| relief `1070599391` | same file (2 sites: the pinned hash, and the N2 explicit-table test) | **`1483138559`** (C9 `det.txt`); any other value is S1 | — | — |
| orders `2559269335` | same file (2 sites) | unchanged (C9) | — | — |
| `ECONOMY_PIN` `904873885`, `ECONOMY_PIN_RELIEF` `2771311510`, `RUNTIME_DIGEST_PIN` `2037118941` / `_RELIEF` `1884258391`, `WOUNDED_WORLD_PIN` `3748305113` | same file | unchanged (C9: 105 of 107 determinism tests held) | — | moves only if a pinned replay reads the depot JSON (re-read) |
| `fire-support.test.ts` `HASH`; snapshot format pin `3686246844` | `packages/sim/src/` | unchanged (C9 sim suite; no column added) | — | — |
| versus mirror hashes: `versus-force.test.ts` beit `695551139` / tel_marum `4263437644`; `match-world.test.ts` beit `823410040` / tel_marum `4263437644` (two sites); `versus-breach.test.ts` tel_marum `4263437644` (two sites) | app, tools | **not measured** (the design ran `packages/sim` only): re-read in Task 3 | re-read: moves with any lever on that map | — |
| `VERSUS_ECONOMY_PINS` tel_marum `750746188` / wadi_tarfan `955375532` | `match-world.test.ts` | not measured: re-read | moves with any economy lever | — |
| arena rush-over-passive seed `48514` | `tools/src/net/arena.test.ts`, `players.test.ts` | not measured. An OUTCOME: a flip is S3 | re-read; a flip is S3 | — |
| two-client, `bot-row-budget`, net and worker literals | tools, net, worker | not measured: re-read (expected to fold no sim combat) | re-read | — |
| sim unit tests asserting today's draws | `combat.test.ts` (2 + the catastrophic-share test), `mobility.test.ts` (2), `air-forced-landing.test.ts` (1), `focus.test.ts` (1), `hit-suppression.test.ts` (1) | re-derived (G-6, Task 2) | — | — |
| `pnpm playtest` | `tools/src/backtest/playtest.ts` | **36/37**: depot (gate open) seed 22, a defeat; every control still loses 30/30; slowest-seed lines move (C9) | identical (room data only) | **37/37** |
| `LADDER_CREDITS` = `CAMPAIGN_CREDITS` `5961` | `playtest.ts`, `packages/app/src/ui/stores-model.ts` | unchanged (C9) | unchanged | may move: S5 |
| `ROSTER_MAX` `30` | `playtest.ts` | unchanged (C9) | unchanged | may move: S5 |
| `pnpm balance` §5.7 | `tools/src/balance` | identical except max-tier Air is contested: 3 trucks 30% → 0%, 2 trucks 33% → 0% (target ≤ 50%) | identical | identical |
| versus offered cells (16) | `pnpm versus:probe`, report-only | **5 outside** (below) | **0 outside** | identical |
| golden visual (gated scenarios) | `tools/golden-baselines/` | expected unchanged; CI decides; S6 if a gated scenario reds | — | — |
| `shippedContentDigest()` | no literal | — | moves with the JSON | moves with the JSON |

**The five cells C9 reads outside 60/40** (`vs-*.txt`, 96 seeds; today 0 of 16):
1. mirror `beit_sahwan_outskirts`: west 58 / east 38, **west 60.4%**;
2. economy `tel_marum` Sarim friendly: KDF 34 / Sarim 62, **Sarim 64.6%**;
3. tunnels cell 3 `tel_marum` KDF friendly: KDF 60 / Sarim 36, **KDF 62.5%**;
4. tunnels cell 3 `wadi_tarfan` KDF friendly: KDF 34 / Sarim 62, **Sarim 64.6%**;
5. tunnels cell 3 `wadi_tarfan` Sarim friendly: KDF 37 / Sarim 59, **Sarim 61.5%**.

The other eleven read inside. The placed force is S54.2, S57.3, S53.1 and S59.4. The other economy cells are
K56.3, S52.1 and level. The other mirrors are level, level and E52.1. Tunnel cell 3 Tel Marum Sarim-friendly
reads S53.1.

**Cell 2's Sarim edge, which GH-816 restored and the re-price must keep.** Under C9, cell 2's Sarim wins beat
cell 1's on wadi_tarfan KDF friendly (60 vs 50), wadi_tarfan Sarim friendly (58 vs 48) and tel_marum Sarim
friendly (64 vs 62). tel_marum KDF friendly has none, as on main.

---

## Pre-flight conflict table

| Pair / task | Produces → consumes | Finding | Ruling |
|---|---|---|---|
| T1 → T2 | `overmatchShift`, `penetrationHpCost`, the two constants | consistent | T1 lands first, hash-neutral (its pins unchanged are its proof) |
| T2 → T3 | the relief pin, plus every non-sim literal the change moves | T3 cannot know its list until T2 runs `pnpm test` | T2 records the full failure list, and T3 re-pins from that list only |
| T2 → T4 | C9 reproduction | the whole plan rests on it | T4 diffs against `design-runs/C9-H3-R5/` first; S1/S2 |
| T4 → T7, T8 | the measured versus and playtest baselines under the new model | T7 and T8 both need T4's numbers | sequential after T4; T7 and T8 then run in parallel (disjoint files: `data/versus`, `data/doctrines`, versus tables vs `data/missions/wadi_halam_5_depot.json`, `plans/wadi_halam.ts`) |
| T7 vs versus-tunnels stream (GH-681) | `data/versus/*.json` tunnel capacities, `match-world.test.ts` literals | **overlap** if that stream is still open | pre-flight checks `gh pr list` and `_coord/`; rebase on it, never take its hunk; re-measure after it lands |
| T7 vs net-n3 stream (Sarim seat rules) | `versus-seats.ts`, `@lions/net` config | overlap only if lever (b) is chosen | (b) is a STOP anyway (S4) |
| T7 vs tutorial-economy (Lane A) | `data/doctrines/*.json` | possible overlap | pre-flight greps for open work on the doctrine files |
| T2 vs special-units-e1 (heal aura) | `stepUpkeep` aura heal and regen | T2 does NOT touch `stepUpkeep` (Ruling 3) | none; a merged aura change is re-measured at T4 |
| T2 vs special-units-p2 / wounded-p2 (camo Lavi, ambulance: hard hulls) | new hard unit types take the cost too | correct by Ruling 4 | T1's bound census counts them; a newly landed hard unit is a re-measure at T4 |
| T8 vs `plans/wadi_halam.ts` | the depot plan | other depot variants share the file | Task 8 edits only the `(gate open)` plan, if class (a) |
| T9 vs `CLAUDE.md`, `docs/HANDOVER.md` | shared docs | other lanes append | one bullet and one ledger row; rebase |

---

## Task 0: pre-flight (record in `_coord/vehicle-health-progress.md`)

**Model:** Sonnet. No commit.

- [ ] **1. Worktree.**
  - `git -C /Users/ilpinto/dev/roaring-lions fetch origin main`, then
    `git -C /Users/ilpinto/dev/roaring-lions worktree add /Users/ilpinto/dev/roaring-lions-ep/vehicle-health -b
    feat/vehicle-health origin/main`, then `pnpm install` once.
  - Confirm with `git log 0c86c10c..origin/main -- packages/sim data tools/src/backtest` that nothing changed
    since the design's base. If something did, every C9 comparison below becomes "re-measure first": STOP and
    ask.
- [ ] **2. Pins.** Re-read every literal in the pin table:
  `grep -rnE "toBe\([0-9]{8,}\)|_PIN = |PINS = |LADDER_CREDITS =|CAMPAIGN_CREDITS =|ROSTER_MAX =" packages tools`.
  Note any value that differs from the table.
- [ ] **3. Baselines** to `_coord/vehicle-health/baseline/`:
  - `pnpm test:determinism`, the full `pnpm test`, `pnpm balance`, `pnpm playtest`;
  - the four versus arms at 96 seeds, exactly as `design-runs/vh-run.sh` ran them (the mirror on the four
    fair maps, `--arr=kdf/sarim,sarim/kdf`, `--economy`, `--tunnels` on `tel_marum,wadi_tarfan`);
  - the scratch probe at 200 seeds, run from a copy outside the repo.

  Each must match `design-runs/V0-base/`, timing lines aside. A mismatch means main moved under the design:
  STOP.
- [ ] **4. Lever readers.** `grep -rn "logistics_start\|pop_cap\|income_zones\|capacity" packages tools`. Confirm
  that `data/doctrines/*.json` and `data/versus/*.json` are read only by the versus room
  (`packages/app/src/net/match-world.ts` and its tests) and the versus probe. Record the readers (Ruling 7).
- [ ] **5. Other streams.** Run `gh pr list --state open` and list `_coord/*-progress.md`. Fill in the conflict
  table's "if still open" rows.

---

## Task 1: the cost and the shift, pure (hash-neutral)

**Model:** Sonnet implementer; Sonnet reviewer. `sim-guard` (Opus) reviews Tasks 1 and 2 as one diff, after Task 2.

**Files:**
- `packages/sim/src/vehicle-health.ts` (new: imports only `./fixed` and `./tuning`);
- `packages/sim/src/vehicle-health.test.ts` (new);
- `packages/sim/src/tuning.ts`: two constants, added after `OVERMATCH_SHIFT_MAX`;
- `packages/sim/src/sim.ts`: `rollComponent` calls `overmatchShift` (refactor only);
- `tools/src/vehicle_health_bounds.test.ts` (new).

**Interfaces.**

```ts
// tuning.ts, after OVERMATCH_SHIFT_MAX
/** GH-560 (lead ruling 1, 27 Oct): a penetration of a hard hull costs at least this fraction of its MAX hp,
 *  scaled by overmatch (PEN_HP_OVERMATCH_DIV). HP, not a roll, ends a vehicle: 2 hits at heavy overmatch,
 *  3 otherwise (spec 2026-10-27-vehicle-health-design §5.2). */
export const PEN_HP_FLOOR = 22282; // 0.34
/** The floor is multiplied by (DIV + shift) / DIV, shift being the 0-30 overmatch shift: x1.5 at most. */
export const PEN_HP_OVERMATCH_DIV = 60;

// vehicle-health.ts
/** The overmatch shift, clamp((z - 1) * OVERMATCH_SHIFT_PER_Z, 0, OVERMATCH_SHIFT_MAX): an integer 0..30.
 *  The one copy; rollComponent and the cost both read it. */
export function overmatchShift(z: Fx): number;
/** What a penetration costs a hard hull, Q16.16: max(damage, floor(maxHp * PEN_HP_FLOOR) * (DIV + shift) / DIV).
 *  Integer arithmetic in exactly this order (plan Ruling 2). */
export function penetrationHpCost(maxHp: Fx, damage: Fx, shift: number): Fx;
```

- [ ] **Step 1: failing tests** in `vehicle-health.test.ts`. Every expected value is a literal, computed by hand
  from the formula. Each row is (hp, shift, weapon damage) → the cost in raw units → the hits to kill it, which
  is `ceil(maxHp / cost)`:

  | case (design §5.2) | hp | shift | damage | cost, raw | hits |
  |---|---|---|---|---|---|
  | 120 mm v Lavi front | 3000 | 28 | 520 | 98040800 | 3 |
  | 120 mm v Namer front | 2200 | 30 | 520 | 73530600 | 2 |
  | 120 mm v Eitan front | 1600 | 30 | 520 | 53476800 | 2 |
  | Kornet v Lavi front | 3000 | 8 | 400 | 75758800 | 3 |
  | Kornet v Lavi side | 3000 | 30 | 400 | 100269000 | 2 |
  | RPG-7 v Lavi side | 3000 | 27 | 300 | 96926700 | 3 |
  | RPG-7 v Eitan front | 1600 | 30 | 300 | 53476800 | 2 |
  | ZU-23 v Peten front | 640 | 0 | 85 | 14260480 | 3 |
  | the weapon dominates | 640 | 0 | 300 | 19660800 (= the damage) | 3 |

  More rows:
  - `overmatchShift`, with z values exact in Q16: z = 1.0 → 0, z = 1.5 → 5, z = 3.5 → 25, z = 4 → 30,
    z = 9 → 30 (clamped), z = 0.5 → 0;
  - **no single hit kills a sound hull**: for hp 3000 at shift 30, `cost < maxHp`, raw 100269000 < 196608000;
  - **the bound**: hp 60000 at shift 30 returns raw 2005380000, an int32. Mutation M-1a reads 1061928 instead.

  Run: red (no module).
- [ ] **Step 2: implement** both functions (Ruling 2's order). In `rollComponent`, replace the inline shift lines
  with `const shift = overmatchShift(z);`. Nothing else in `sim.ts` changes in this task.
- [ ] **Step 3: the data bound** (`tools/src/vehicle_health_bounds.test.ts`).
  - For every shipped unit type with front armour ≥ 30 mm (`SOFT_ARMOR_LIMIT`), base tier and max tier,
    `hp × 65536 × 0.51 < 2^31`.
  - Assert exactly the counted number of hard types was checked: a census that finds none must fail (casebook:
    the empty array). There are 16 at `6448d111`, from the Lavi at 3000 hp down to the Peten at 640. Re-count at
    pre-flight and write that count as a literal.
- [ ] **Step 4: gates (G-7).** `test:determinism` must pass unchanged. That proves the refactor is byte-identical.
  `balance` and `playtest` must be byte-identical to the baseline, timing aside.
- [ ] **Step 5: mutations** (G-5), each red and quoted:
  - M-1a: `| 0` moved before the division;
  - M-1b: `PEN_HP_OVERMATCH_DIV = 90` (the Namer row reads 3);
  - M-1c: `overmatchShift` without its clamp;
  - M-1d: the census filter inverted, so it checks soft units (the count assertion reds).
- [ ] **Step 6: commit** `sim: the penetration cost and the overmatch shift, pure (GH-560)`.

## Task 2: HP alone ends a vehicle, and a threatening bounce restarts the regen delay (behaviour)

**Model:** Sonnet implementer; Sonnet reviewer; then **`sim-guard` (Opus)** over Tasks 1–2 before Task 3 commits.

**Files:** `packages/sim/src/sim.ts`, at three sites:
- `ComponentResult`;
- `resolveHit`'s penetration tail and its bounce branch;
- `rollComponent`'s weights and switch.

Also `packages/sim/src/tuning.ts` (delete `COMP_CATASTROPHIC`; reword the `OVERMATCH_SHIFT_*` comment: "moved
from crew_shaken; the rest of the table shares them") and the tests below.

- [ ] **Step 1: failing tests** in `packages/sim/src/vehicle-health.test.ts` (a `describe` per property). Each uses
  a role-less fixture and literal expectations.
  - **HP alone ends a hull.** A fixture hull (hp 3000, front 300) is penetrated by a fixture round at z ≥ 4
    (shift 30).
    - After the first penetration: alive, `hp` raw `96339000` (= 196608000 − 100269000).
    - After the second: `destroyed` with `by` = the shooter, and `hp ≤ 0` on that tick.
  - **No component event is ever `catastrophic`, and every hard death is an HP death.** The 30 seeds of
    `combat.test.ts`'s AT-team-on-MBT scene: for every `destroyed` of the tank, `sim.state.hp[tank] <= 0` that
    tick. The tank must be destroyed on at least 5 of the 30 seeds, or the check is vacuous.
  - **The draw is still one per penetration, over 92 − shift.** Through `roll()`'s stub (as `mobility.test.ts`
    does), on a TRACKED fixture (a sound wheeled hull turns `mobility_kill` into `mobility_damaged`),
    `calls === 1`. At z = 1 (shift 0, total 92), hi-16 draws:
    - `0x8000` → (32768 × 92) >>> 16 = 46: `mobility_kill`;
    - `0xF000` → 86: `combat_ineffective`;
    - `0xFFFF` → 91: `combat_ineffective`, never destroyed.

    At z = 4 (shift 30, total 62):
    - `0x3000` → 11: `crew_shaken`;
    - `0x4000` → 15: `mobility_kill`;
    - `0xFFFF` → 61: `combat_ineffective`.
  - **A threatening bounce restarts the delay; a harmless one does not.**
    - A hull at half hp, last damaged at tick T₀, takes a round with `pen >= armorSide` and P(pen) ≈ 0 on the
      front (no splash) at tick T: `hp` is unchanged through T + 199. At T + 200 it gains exactly
      `fx.mul(maxHp, 16)` (hp 3000: raw 48000).
    - The same scene with a rifle round (`pen < armorSide`, no splash): regen starts at T₀ + 200 as before.
  - **The two other readers of `lastDamagedTick`** (Ruling 3). A stuck tracked hull's `fieldFixTicks` returns to
    0 on the tick of a threatening bounce, and does not on a harmless one. A hull in a workshop aura has its
    `auraRepairTicks` reset by a threatening bounce.
- [ ] **Step 2: implement.**
  - The penetration tail becomes `this.applyDamage(target, penetrationHpCost(tType.hp, this.prDamage[pr],
    overmatchShift(z)), shooter);`. The `alive` check and `rollComponent` call stay as they are. `tType` is the
    target's type, already in scope.
  - In the bounce branch, right after `const threatens = …`: `if (threatens) this.lastDamagedTick[target] =
    this.tickCount;`. Add a comment quoting ruling 3.
  - In `rollComponent`: `total = wCrew + COMP_MOBILITY + COMP_FIREPOWER + COMP_BOTH`, the last `else` becomes
    `combat_ineffective`, and the `catastrophic` case is deleted. Drop `'catastrophic'` from `ComponentResult`
    and delete `COMP_CATASTROPHIC` from `tuning.ts` and from `sim.ts`'s import list.
- [ ] **Step 3: re-derive the tests that asserted today** (G-6; the C9 failure list, `simtests-C9.txt`):
  - `mobility.test.ts` and `air-forced-landing.test.ts`: `U_COMBAT_INEFFECTIVE` becomes `0xf0000000`. The
    comment becomes "(61440 * 92) >>> 16 = 86, inside [80, 92)". `U_MOBILITY`'s comment becomes 46, inside
    [45, 65); its value stays.
  - `combat.test.ts`:
    - "rifles never penetrate an MBT front; ATGMs usually do": the tank now dies after 3 impacts. Give the
      fixture tank enough hp to survive the window, or pool the impacts over seeds. Keep `> 0.75` and
      `impacts > 3`.
    - "mobility kills stop movement but leave the gun firing": the hull dies before it fires. Raise the fixture
      hp. The property stays.
    - "most penetrations do not destroy the vehicle at moderate overmatch": now `destroyed / penetrations < 0.4`
      and `crewShaken / componentEvents > 0.2`. The catastrophic count goes, and Step 1's HP-death test replaces
      it.
  - `focus.test.ts` "slot 1 keeps its own target…": the APC dies inside the 5 s window (two 51% penetrations),
    so `focusTarget` reads −1. Raise the APC fixture's hp. All four assertions stay.
  - `hit-suppression.test.ts` "a round that bounces off the hull…": the HULL fixture dies before four bounces.
    Raise its hp. Keep `> 3` and `DOUBLED`.
  - `alerts.test.ts`: only the comment "catastrophic is a loss" changes, to "a destroyed hull is a loss".
- [ ] **Step 4: gates (G-7).** `test:determinism` reds on exactly the two relief sites, reading **1483138559**.
  Any other value, or any other determinism red, is **S1**.

  Run the FULL `pnpm test` and record every failure outside `packages/sim` in the progress file, then classify
  each:
  - (a) a hash literal that folds `sim.hash()` or a versus replay: Task 3 re-pins it;
  - (b) a test asserting an outcome (who wins, a count, a seed choice): **S3**, STOP;
  - (c) anything else: STOP.
- [ ] **Step 5: mutations** (G-5), each red and quoted:
  - M-2a: the penetration tail back to `this.prDamage[pr]` (the HP-death test reds);
  - M-2b: `rollComponent`'s last `else` back to a `destroy` (the never-catastrophic test reds);
  - M-2c: the bounce write deleted (the regen-restart test reds);
  - M-2d: `if (threatens)` → `if (true)` (the harmless-bounce test reds);
  - M-2e: the component draw replaced by a constant 0 (the `calls === 1` test reds).
- [ ] **Step 6: commit** `sim: HP alone ends a vehicle; a threatening bounce restarts the regen delay (GH-560)`.
  Include the tests, and say in the body that the relief pin moves in the next commit.

## Task 3: the pins (their own commits)

**Model:** Sonnet. Do not start until `sim-guard` (Opus) has passed Tasks 1–2.

- [ ] **Step 1.** Change the relief pin's two sites in `determinism.test.ts` to `1483138559`. Commit
  `sim: relief pin 1483138559, HP alone ends a vehicle (GH-560). Was 1070599391.` The body says why: the relief
  replay puts guns on armour, and the flat replay never does (as PR GH-570 found). It also states that flat
  `1258746094` and orders `2559269335` are unchanged.
- [ ] **Step 2.** Re-pin each class (a) literal from Task 2 Step 4 in ONE commit per file family, each with
  "Was <n>." Example: `app: versus mirror pins under the HP model (GH-560). Was 4263437644.`
  - **Proof in the message:** with the penetration tail reverted (M-2a), every old value reads back.
  - If one does not read back, the literal moved for another reason. That is a finding: STOP.
- [ ] **Step 3.** `pnpm test` green end to end. Nothing in class (b) is re-pinned here.

## Task 4: reproduce C9, commit the probe, and the first STOP gate

**Model:** Sonnet (the `balance-analyst` agent, `model: sonnet`). Opus reviews only if S2 trips.

- [ ] **Step 1: measure.** Run `pnpm balance`, `pnpm playtest`, the four versus arms at 96 seeds (Task 0's
  commands) and the scratch probe (copy outside the repo) at 200 seeds. Diff each against
  `design-runs/C9-H3-R5/`, timing lines stripped.
  - **Expected: identical.**
  - **S2, STOP and report** if any line differs:
    - a §5.7 number other than max-tier Air;
    - a playtest line other than depot seed 22 and the slowest-seed and time-limit lines C9 shows;
    - `LADDER_CREDITS` ≠ 5961 or `ROSTER_MAX` ≠ 30;
    - any versus cell, by even one game.
  - The report says which instrument differed, and quotes both lines.
- [ ] **Step 2: the probe**, `tools/src/backtest/vehicle-health-probe.ts`.
  - Port `design-runs/probe-src/vh-probe.ts`: the `'@lions/sim'` imports already point at the package. Drop the
    `cat` column. Luck becomes "a destroyed hard hull whose bar read ≥ 0.5 on the tick before".
  - Keep every scenario row, including the three standoff rows (Ruling 9) and the mirror and assault fights.
  - Add `"vehicle-health:probe"` to `tools/package.json`. No `VH_*` reads; `SEEDS` comes from `--seeds=`.
  - Header: report-only, what it measures, where its numbers are quoted (the design, this plan).
- [ ] **Step 3: its one gating test**, `vehicle-health-probe.test.ts`.
  - The Lavi v Lavi duel at 20 seeds: luck deaths 0, and the median bar at death < 0.5. C9 reads 0% and 0.07 at
    200 seeds; record the 20-seed reading in the test comment.
  - Measure its runtime and give it an explicit timeout (CLAUDE.md "measured test timeouts").
  - Falsify: add a constant 8-weight catastrophic branch back into `rollComponent` (one line). Luck goes
    non-zero, the test reds, quote it, undo it.
- [ ] **Step 4: commit** `tools: vehicle-health probe, report-only, the GH-560 witness (GH-560)`.
- [ ] **Step 5: report** the C9-vs-branch table to the lead. This is the evidence that the real change is the
  measured one. It is not a STOP when identical; proceed to Tasks 5–8.

## Task 5: presentation, what the bar now shows (no behaviour change expected)

**Model:** Sonnet (the `render-vfx` agent, `model: sonnet`).

**Files:** `packages/render/src/three/units/vehicle-damage.test.ts`, plus comments only where they are now wrong.

- [ ] **Step 1: read and confirm** (record each in the progress file):
  - the HP bar, the HUD card (`hud.ts` reads `st.hp`), the scar and wisp (`vehicleDamageBand` →
    `structureHpBand`, `ceil(8 × hp / max)`), alerts (`alerts.ts` maps three component results and ignores the
    rest), voice (`director.ts` `callOf`) and the debug overlay (`overlay.ts` prints `e.result`);
  - none of them names `catastrophic`. `works-model.ts`'s heal-rate comparison against `REGEN_FRAC` is unchanged.
- [ ] **Step 2: pin the reading the HP model produces**, with literal raw hp values from Task 1's table and
  `vehicleDamageBand`. The band after each surviving hit:
  - Lavi v 120 mm (shift 28): 5, then 1, then dead. Scar after the first hit, wisp after the second.
  - Lavi v Kornet front (shift 8): 5, then 2.
  - Namer or Eitan at shift 30: 4, then dead.
  - Peten v ZU-23 (shift 0): **6** (clean: no scar after a low-overmatch first penetration), then 3.

  These are literals: the test imports no sim constant.
- [ ] **Step 3: mutation.** `structureHpBand` with `Math.floor` for `Math.ceil` reds the test. Quote it, undo it.
- [ ] **Step 4: commit** `render: pin what the vehicle bands read under the HP model (GH-560)`. No golden-baseline
  run locally. If CI's `visual` job reds on a GATED scenario, that is **S6**: read the log and confirm it is a hull
  band change. Bless only through the `visual-baseline-bless` workflow from CI numbers, after the lead sees the
  picture.

## Task 6: AI and doctrine, anything that read the roll

**Model:** Sonnet. Read-mostly. A commit only if a comment or test is wrong.

- [ ] **Step 1: census** (record each with file and symbol). Expected: nothing reads the roll.
  - `grep -rn "catastrophic" packages tools --include=*.ts`: only `catastrophic_kill` VFX names remain.
  - Target choice reads P(pen), not HP: `selectTarget`, `weaponHurts`, `canFocus`, `focusHurts` and `projectHit`.
    `HitProjection` carries no kill chance.
  - No sim decision reads an HP fraction: no AI threshold, no stance, no mission trigger
    (`grep -n "hp" packages/sim/src/mission.ts` and `mission.schema.json`).
  - The versus agents (`tools/src/net/view.ts`) print hp and never decide on it.
- [ ] **Step 2: the doctrine and report-only instruments.** The `*_doctrine.test.ts` files ran in Task 2's full
  `pnpm test`; record pass. Run each report-only probe before and after, and record the lines that moved (no gate):
  `garrison-probes.ts`, `saddle-price.ts`, `e5-probes.ts`, `special-units-probes.ts`, `air-assault-probe.ts`,
  `e6-swarm-probe.ts`, `wh_pacing.ts`. A probe that moves a number its own doc calls a target is a finding for the
  lead (report, do not tune).
- [ ] **Step 3: draft** the Standoff follow-up issue text (Task 9 opens it). Its contents, from design §6:
  - the cell sees 10 tiles against the Lavi's 12 with thermal;
  - the Kornet's 14-tile range is unusable unspotted;
  - the first launch multiplies its signature ×5;
  - the Trophy takes 1.05 of the 1.32 missiles a cell gets off;
  - the saturation form "three cells mission-kill an APS MBT ≥ 50%" (54% today, 51% under H3) is measurable now.

## Task 7: the versus re-price, every offered cell inside 60/40 at 96 seeds

### Task 7A: choose the levers (judgement)

**Model:** **Opus** (the `balance-analyst` agent, `model: opus`). Output: a lever table to the lead. No commit.

- [ ] **Step 1: the bar.**
  - All 16 offered cells inside 60/40 at 96 seeds, read exactly as Task 0 ran them.
  - No cell that is inside goes outside.
  - Cell 2's Sarim edge holds where C9 has one (pin table).
  - The placed-force cells move only with a placed-force lever.
  - `pnpm balance` and `pnpm playtest` are byte-identical before and after every lever: proof that room data
    reached no campaign number.
- [ ] **Step 2: sweep with the probe's own knobs first.** `--start=<kdf>/<sarim>`, `--pop-cap=` and
  `--rate-scale=` are in-memory overrides, never written to disk. They cover the economy and tunnel arms without
  editing a file. Then try JSON edits on a scratch copy of `data/versus/<map>.json` for per-map rates and tunnel
  capacities, undone by an edit.

  Candidates per outside cell, in Ruling 7's order:

  | Cell (C9) | Lean | Candidate levers |
  |---|---|---|
  | economy `tel_marum` Sarim friendly, S64.6 | Sarim | Tel Marum income zone rates (`pass`/`approach` 40, overwatch 20, `ammo_draw` 20); the doctrine purse or pop cap (both maps, all economy and tunnel cells: watch the other seven) |
  | tunnels `tel_marum` KDF friendly, K62.5 | KDF | Tel Marum route capacity: the south pair is at 4 since GH-816 (3 read 51.0%, 5 read 67.7% Sarim-friendly) |
  | tunnels `wadi_tarfan` KDF friendly, S64.6 | Sarim | Wadi Tarfan hostile capacities (`wt_h_south` 2, `wt_h_east` 3); GH-816's table: 2/2 lost the cell 2 edge, 3/3 read 65.6% |
  | tunnels `wadi_tarfan` Sarim friendly, S61.5 | Sarim | the same files as the row above, so they must be solved together |
  | mirror `beit_sahwan_outskirts`, W60.4 | west | **no JSON lever exists**: Beit is mirror-only, with no `data/versus` file, and both sides field the same force. The only lever is a `VERSUS_SEATS` entry (Ruling 7 (b)). |

- [ ] **Step 3: S4, STOP.** Report to the lead: the chosen levers, a per-cell table before (C9) and after at 96
  seeds for all 16 cells and the cell 2 edges, and the playtest and balance byte-identity. Any lever from class (b)
  or (c) needs the lead's yes. The Beit mirror needs (b) unless the lead accepts 60.4% as noise (Q1). The design
  calls a 60.4–62.5% cell "a lean, not a verdict", but the ruled bar is 60/40.

### Task 7B: apply the levers and re-pin

**Model:** Sonnet. Only after the lead approves 7A.

- [ ] **Step 1.** Apply the approved levers, one commit per map:
  `data: re-price <map> versus under the HP model (GH-560)`. Each commit body carries its cells' before and after.
- [ ] **Step 2.** Re-pin the versus literals each lever moved (pin table, Task 7 column). Each gets its own commit
  with "Was <n>." and the proof that reverting the lever reads the old value back.
- [ ] **Step 3: arena seed.** If `arena.test.ts` / `players.test.ts`'s rush-over-passive seed no longer wins from
  both seats, that is **S3**. Report seeds 0–11 under GH-816's method, with the candidate seed, before any change.
- [ ] **Step 4.** Re-run all four arms at 96 seeds on the branch head and put the 16-cell table in the progress
  file. It goes into the PR body (Task 10).

## Task 8: `wadi_halam_5_depot (gate open)` seed 22

**Model:** Sonnet (the `mission-author` agent, `model: sonnet`). Sweeps can use the `playtest` agent on Sonnet.

**Files:** `data/missions/wadi_halam_5_depot.json` (class b), or the `(gate open)` plan in
`tools/src/backtest/plans/wadi_halam.ts` (class a). Never mission TypeScript.

- [ ] **Step 1: root cause.** Replay seed 22 of the `(gate open)` plan. Print the world at each loss, the way
  `playtest.ts`'s position dump does. One line each for:
  - the tick, the unit lost and what killed it;
  - its HP history (bar before each hit, and any regen between);
  - which objective failed, with its defeat cause;
  - what the same seed did on today's model (the `V0-base` run).

  Under the HP model the Kipod (`apc_kipod`, gate open) is the likely first suspect: a hull the roll never ended
  until its bar was spent. The seed decides, not the suspect.
- [ ] **Step 2: classify.**
  - (a) The plan relied on a hull surviving damage that the honest bar now shows (for example, pushing a damaged
    hull back into the gate RPG): fix the plan.
  - (b) The mission is harder for anyone under the HP model (for example, the gate's `ambush(3)` RPG plus the
    interior RPG now reliably end the lead hull): fix the data, meaning starting force, an enemy placement,
    timing, or `time_limit_s` within `validate_time_limit.mjs`.
  - (c) The mission cannot be won with the honest bar: a design finding for the lead.
- [ ] **Step 3: S5, STOP.** Report the root cause, the class and the proposed fix, with the seed sweep (30 seeds)
  of every depot variant under it: plain, `(gate open)`, `(no orders)` (must still lose 30/30), `(bought)` and
  `(max tier)`. Include the full `pnpm playtest` diff and `LADDER_CREDITS` / `ROSTER_MAX` under the fix. Commit
  nothing until the lead answers.
- [ ] **Step 4: after the yes.**
  - (b): `data: wadi_halam_5_depot under the HP model (GH-560)`. Check every briefing, objective and trigger
    label line is still true (`player-wording.test.ts`, the GH-593 precedent).
  - (a): `tools: re-plan wadi_halam_5_depot (gate open) under the HP model (GH-560)`.
  - Then, in separate commits, `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and `ROSTER_MAX` if they moved, each with the
    per-mission credit lines that moved and "Was <n>.".
  - `pnpm playtest`: 37/37 on 30/30 seeds; every control still loses; the time-limit lines hold their margins.

## Task 9: docs

**Model:** Sonnet. Docs only, plus one `gh issue create`.

- [ ] **GDD §5.4.**
  - The table keeps its four recoverable results. "Catastrophic" becomes the HP-0 row: "HP reaches 0: destroyed,
    crew lost (the brew-up)". It has no weight, because it is not a roll.
  - New text: a penetration costs at least 34% of max HP × (1 + overmatch/60), so 2 hits at heavy overmatch and
    3 otherwise. Give the design's §5.2 examples in one sentence.
  - Field recovery: 10 s after the last damaging or threatening hit, 0.49%/s up to 70%. A threatening bounce
    (blast, or penetration up to the side armour) restarts it, the crew field fix and the workshop repair.
  - Keep "most penetrations do not destroy the vehicle": it is now true by construction.
- [ ] **GDD §5.7.** Standoff (Sarim) gets "report-only (GH-560 ruling 4, 27 Oct); doctrine follow-up GH-NNN",
  with the new issue's number.
- [ ] **`docs/agent-notes/sim-and-orders.md`**: a "Vehicle health (GH-560)" bullet. It covers the rule and
  constants, Ruling 3's two side effects, that `'catastrophic'` is gone and why the draw stays, the pins that
  moved, C9's measurements (luck 0%, bar at death, TTK), the probe command, and the four lead rulings.
- [ ] **`CLAUDE.md`**, under "Sim rules worth knowing from outside the sim": one bullet. "HP alone ends a
  vehicle (GH-560): a penetration costs ≥ 34% × (1 + overmatch/60) of max hp, the component table has no kill,
  a threatening bounce restarts regen; `pnpm --filter @lions/tools vehicle-health:probe` is the witness."
- [ ] **`docs/agent-notes/mission-findings.md`**: the depot finding (Task 8's root cause and fix).
- [ ] **The design doc's status line**: "Ruled 27 Oct (GH-858 comments); implemented by
  `docs/superpowers/plans/2026-10-28-vehicle-health.md`." Nothing else in it changes.
- [ ] **`docs/HANDOVER.md`**: the Lane C row. **`docs/superpowers/plans/2026-10-04-stage4-order.md`**: GH-560's
  line.
- [ ] **Open the Standoff issue** from Task 6's draft: "Standoff (Sarim): doctrine and data, not vehicle health
  (GH-560 follow-up)".
- [ ] Commit `docs: vehicle health as built (GH-560)`.

## Task 10: final gate and the PR

**Model:** Sonnet runs the gates. **Opus** does the final review: the whole diff against this plan's rulings,
the pin table and the casebook shapes.

- [ ] **Gates on the branch head**, with exit codes recorded: `pnpm test:determinism`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm validate:data`, `pnpm validate:ui`, `pnpm balance` (both tiers),
  `pnpm playtest`, the four versus arms at 96 seeds, and the probe at 200 seeds.
- [ ] **Every pin in the pin table** at its final value, each move in its own commit with "Was <n>."
  (`git log --format=%s origin/main..HEAD`).
- [ ] **Open the PR to main**, not a draft: `sim: HP alone ends a vehicle (GH-560)`. The body:
  - the four rulings;
  - the C9-reproduction table (Task 4);
  - the 16-cell versus table today → HP model → re-priced;
  - the playtest line (37/37) and the depot fix with its root cause;
  - §5.7 at both tiers;
  - every pin with "was → now";
  - the falsifications (M-1a…M-2e, the probe, the bands);
  - what was not measured (design §10: real players, garrisons, max tier in the probe);
  - Q1–Q6 for the lead.

  Write "Closes GH-560" only if the lead wants the issue closed on merge. It ends with the Claude Code line.
- [ ] **CI.** `gh run list` after the push. The `visual` job falls under S6. The lead merges.

---

## STOP gates (where the lead sees numbers)

| Gate | Where | Trips when | Report |
|---|---|---|---|
| **S1** | Task 2 Step 4 | the relief pin is not 1483138559, or flat, orders, economy, digest, wounded, fire-support or the snapshot format pin moves | the value, and which line of the change caused it (bisect by reverting one edit at a time) |
| **S2** | Task 4 Step 1 | any instrument differs from C9 beyond the pre-ruled moves (G-4) | both lines, per instrument |
| **S3** | Tasks 2, 3, 7B | a test outside the sim asserting an OUTCOME fails (arena seed, doctrine test, a who-wins count) | the test, today's value, the new value, and the candidate fix |
| **S4** | Task 7A | always, before any re-price commit; and any lever beyond JSON room data | the lever table, all 16 cells before and after, the cell 2 edges, balance and playtest byte-identity |
| **S5** | Task 8 Step 3 | always, before the depot fix commits; and any `LADDER_CREDITS`/`ROSTER_MAX` move | the root cause, the class, every depot variant's 30-seed sweep, and the full playtest diff |
| **S6** | Tasks 5, 10 | CI `visual` red on a gated scenario | the log's scenario and band reading; bless only through the CI workflow |

## Task order and batches

T0 → T1 → T2 → `sim-guard` (Opus) over T1–T2 → T3 → T4. Then T5, T6 and T7A in parallel: disjoint files, and
T7A writes nothing. Then T7B after S4, and T8 after S5. T7B and T8 may run in parallel in one worktree, because
their files are disjoint; commit with `-- <paths>`. Then T9 → T10.

The heavy runs are the tunnel arm (about 14 min each) and `pnpm playtest`. Never run two heavy instruments at
once, on the lead's machine.

## Review focus

1. **Is the shipped change the measured change?** Task 4's byte-identity with C9 answers it. A reviewer checks the
   arithmetic order (Ruling 2) and that the draw survived (`calls === 1`).
2. **Vacuous checks.** The HP-death test needs ≥ 5 destroyed tanks. The bound census asserts its counted hard types
   (16 at `6448d111`). The probe test needs deaths to exist. Each has a floor on its own sample.
3. **Loosened tests.** Every re-derived test changes a fixture, never a bar (G-6). Diff each `expect` line.
4. **`lastDamagedTick`'s other readers** (Ruling 3): pinned by tests, and documented.
5. **Versus levers leaking into the campaign**: balance and playtest byte-identical across Task 7B's commits.

---

## For the lead (the PR body repeats these)

1. **Q1. The Beit mirror reads west 60.4% under the HP model** (58 v 38 at 96 seeds), and only a `VERSUS_SEATS`
   move can fix it. That is a literal table in TypeScript, not JSON data.
   - **Recommendation:** approve a seat move as room data, as you did for GH-816.
   - The alternative is to accept 60.4% as the noise the design names. The bar would then be bent for one cell.
2. **Q2. One PR or two.** **Recommendation: one** (Ruling 6). Merge deploys, and the sim change alone puts five
   cells outside 60/40 into live rooms. The other way is two PRs, the sim one held unmerged until the re-price is
   ready.
3. **Q3. The depot fix: mission data or plan.** **Recommendation:** let seed 22's root cause decide (Task 8).
   - Fix data if the honest bar makes the mission harder for a real player.
   - Re-plan if the plan relied on a hull the roll used to spare.
   - Either way you see the 30-seed sweep before it commits.
4. **Q4. A low-overmatch first penetration does not scar.** A ZU-23 through a Peten's front costs 34%, which
   leaves band 6 (clean). So does any shift-0 penetration of any hull.
   - **Recommendation:** no change now. Judge it in a real fight.
   - If you want every penetration to show, the scar's first band moves 5 → 6. That is presentation-only and
     needs a mock first.
5. **Q5. "Hits to kill" on hover.** GDD §5.8 asks that a shot's cost be readable. Under the HP model it can say
   "2 hits" or "3 hits" honestly.
   - **Recommendation:** a follow-up issue in the presentation lane, not this plan.
6. **Q6. The arena seed.** If the rush-over-passive seed flips (S3), **recommendation:** pick the new one by
   GH-816's method (seeds 0–11, rush winning from both seats) and report it.

---

## Ledger (filled in by the executor)

- Pre-flight (Task 0), baselines vs `V0-base`: _pending_.
- Hard-type census count (Task 1 Step 3): _pending_.
- Task 2's full `pnpm test` failure list and classes: _pending_.
- Task 4's C9-reproduction table: _pending_.
- Task 6's census and probe deltas: _pending_.
- Task 7A's lever table (S4), and the lead's answer: _pending_.
- Task 7B's 16-cell table on the branch head: _pending_.
- Task 8's root cause, class and sweep (S5), and the lead's answer: _pending_.
- Task 10's gates, with exit codes: _pending_.
