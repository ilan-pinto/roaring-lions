# Finish the damaged hull: a target preference toward low HP fraction (GH-560 Task 6 finding) — measured note

**Date:** 2026-10-28 · **Status:** REPORT ONLY. Nothing under `packages/`, `data/` or `tools/` changes
on this branch, and no sim change was committed anywhere. Every number below comes from scratch edits in a
detached worktree at `origin/main` (2080d550, v0.129.5), undone by deleting the worktree. **Builds on:**
`2026-10-27-vehicle-health-design.md` (GH-560, merged) and `docs/agent-notes/sim-and-orders.md`
("Vehicle health"). **For:** the lead; `sim-guard` and `balance-analyst` if it is built.

---

## 0. Recommendation first

**Do not build it now.** If the lead wants the behaviour anyway, build **variant 2** (a mild weight,
section 3), and treat the cost list in section 6 as the price.

Why not, in five lines:

1. **It buys little that the numbers can see.** On armed vehicle fights (1,500 seeds per scenario) the mild
   variants move win rate by -0.3 to +1.5 percentage points against a standard error of about 1.8, and the
   surviving-value margin by +22 to +193 logistics points per fight, which is 2% to 21% of one Lavi (906).
   The sign is positive in all eight side-by-scenario cells for variants 1 and 2, but no single cell clears
   noise.
2. **It does what it says on a cold target and nothing more.** First kill comes 35% sooner and the number of
   damaged-but-alive hulls halves, but the Lavi line takes 5% to 10% LONGER to clear (about 1% longer on the Eitan and
   Namer lines), because fire concentrated on the weakest hull is partly spent on rounds in flight at a hull
   that dies first (inferred from impact counts).
3. **It buys a re-run of work GH-560 just finished.** Every variant changes which target a shot goes to, so
   it re-rolls every combat that has two hard hulls in reach. Four or five tests in three files fail for every
   variant (section 6), and 1 of the 16 versus cells leaves the 60/40 band at 96 seeds for the two best
   variants (base worst cell 59.4%). At 288 seeds that cell reads inside the band, so it is sampling noise,
   but the bar is a deterministic 96-seed count and has to be won back with data.
4. **It reads a number a gunner cannot read.** The shooter would look at the target's true HP fraction. The
   player sees a damaged hull's bar (`docs/polish/combat-states.md`), so it is not secret from the player,
   but a crew sees smoke, a stopped hull and its own hits, not 2,100 of 3,000 hit points.
5. **The player already has this lever.** A right-click on an identified enemy is an `attack` order (GH-420)
   and `selectTarget` takes an ordered focus first. "Finish that hull" is one click. The automatic rule
   would only matter for unattended units and the AI seats.

If it is built, the variant is 2, the change is about ten lines in `selectTarget`, and it needs no new RNG
draw, no new column and no change to `canFocus`, `focusHurts`, `weaponHurts` or `projectHit`.

---

## 1. What the code does today

`packages/sim/src/sim.ts`, `selectTarget` (line 6421 at 2080d550), called once per weapon slot per tick from
`stepCombat` (line 6877), so the choice is re-made every tick and nothing is remembered between ticks:

1. An ordered focus (`focusTarget`) wins the slot if the slot can reach it and `weaponHurts` it.
2. Otherwise scan every unit. `engageable` is the per-candidate filter (sight, range, line of fire, not
   garrisoned, not a civilian). `weaponHurts` asks whether P(pen) against the face shown reaches
   `PEN_HURTS_MIN` (0.05); a soft target always counts as hurt.
3. A target the weapon can hurt beats one it cannot. Among equals, the lower RANKED squared distance wins,
   where the rank is the squared distance, times `ANTI_ARMOR_SOFT_RANK_SQ` (4) when an anti-armour weapon
   looks at a soft, unarmed or firepower-killed target.

So the whole doctrine is "the nearest thing I can hurt". It reads no HP. There is no randomness in the
choice: `selectTarget` draws nothing, so a new rule inside it has no stream to disturb. A rule would change
which target a shot goes to, and through that which later draws happen, which is the same way any combat
change re-rolls a seeded game. A shooter whose candidate set holds no damaged hard hull picks exactly as
before (checked, section 5).

`data/doctrines/{kdf,sarim}.json` hold the build menu, pop cap and starting budget only (358 and 288
bytes). There is no target-choice doctrine in data: the rule is in `sim.ts`. The GH-560 census (ledger
`vehicle-health-progress.md`, Task 6) found no other reader of an HP fraction for a decision.

## 2. How it was measured

A scratch hook in `selectTarget` read `globalThis.__FINISH = { mode, mask }` (mode from the `FINISH_MODE`
environment variable, mask = which sides use the rule). Mode 0 is the shipped behaviour and was checked
byte-identical: `pnpm test:determinism` 107/107 at mode 0. The patch is
`/Users/ilpinto/dev/roaring-lions-ep/_coord/finish-hull/scratch-selectTarget.patch` (62 lines).

Only a **hard** hull (`!isSoft`, front plate 30 mm or more) that the weapon `hurts` is eligible, so
infantry, soft vehicles and a shot that would bounce are untouched. The fraction is
`f = clamp(fx.div(hp[t], type.hp), 0, ONE)`, integer Q16.16, with no new column.

| Variant | Rule on the ranked distance squared |
|---|---|
| 1 tie-break | Two hurtable hard hulls within a factor 1.21 (79299) of each other in ranked distance squared: the lower `f` wins. Outside the band: nearest, as today. |
| 2 mild weight | rank x (0.5 + 0.5 f). A hull at zero HP counts as 0.71x as far; at half HP, 0.87x. |
| 3 strong weight | rank x (0.25 + 0.75 f). A hull at zero HP counts as 0.5x as far; at half HP, 0.79x. |
| 4 step | rank x 0.5 when `f` < 0.5, else x 1. |

Instruments (scripts in `/Users/ilpinto/dev/roaring-lions-ep/_coord/finish-hull/`: `focus-probe.ts`,
`run.sh`, `out/summarize.sh`; raw outputs in `out/`):

- **Cold line.** Three shooters at 8 tiles from four weaponless targets abreast, all identified, so the rule
  is the only difference. 1,500 seeds (variants 1 to 3; variant 4 at 400).
- **Armed mirrors.** Vehicles attack-move onto each other. The rule is switched on for the west side only,
  the east side only, both, or neither, on the same seeds. The effect is the rule side's gain over the same
  side's control, which cancels the geometry's side bias (the control is not 50/50: for example 57/42 in the
  3-v-3 Lavi fight). 1,500 seeds per cell; the standard error of a win-rate difference is about 1.8 points.
- **The gates:** `pnpm balance`, `pnpm playtest`, the four 96-seed `pnpm versus:probe` arms,
  `pnpm vehicle-health:probe -- --seeds=200`, `pnpm test:determinism` and a full `pnpm test`, for each variant.

## 3. Results

### 3.1 The mechanism: cold line abreast (1,500 seeds)

3 Lavi against 4 cold Lavi, 8 tiles. "Damaged alive" is hulls with less than a full bar at 25 s.

| | first kill | dead of 4 at 15 / 25 / 40 s | damaged alive at 25 s | all dead |
|---|---|---|---|---|
| off (today) | 24.9 s | 0.22 / 0.65 / 2.22 | 2.04 | 63.2 s |
| 1 tie-break | 16.3 s | 0.65 / 1.06 / 2.19 | 1.07 | 66.7 s |
| 2 mild | 16.1 s | 0.66 / 1.07 / 2.17 | 1.03 | 68.4 s |
| 3 strong | 15.6 s | 0.68 / 1.08 / 2.19 | 0.96 | 69.2 s |
| 4 step (400 seeds, own control 25.5 s / 63.1 s) | 21.4 s | 0.34 / 0.80 / 2.00 | 1.65 | 68.8 s |

3 Lavi against 4 cold Eitan: first kill 13.5 s to 10.4 / 10.3 / 10.1 s (variants 1 / 2 / 3), damaged alive
1.22 to 0.80 / 0.78 / 0.70, all dead 46.2 s to 46.6 / 46.5 / 47.3 s. 2 Lavi against 4 cold Namer: first kill
17.4 s to 14.3 s in all three, damaged alive 0.95 to 0.72 / 0.68 / 0.68, all dead 70.9 s to 71.5 / 71.7 / 71.5 s.

Reading: the rule does what it is for (earlier kills, no lingering wounded). The clear time does not improve:
it is 0.4 s to 6.0 s worse. Penetrating impacts by 25 s fall from 5.03 to 4.67 / 4.61 / 4.57 (Lavi line) while
shots stay at 12.00, which is what a round arriving after its target has died would look like. That cause is
inferred from the counts, not isolated (no probe tags a round as arriving on a dead hull).

### 3.2 Armed fights (1,500 seeds per scenario; effect = rule side minus the same side's control)

Win-rate effect in points (west rule / east rule), and the surviving-value margin gained, in logistics
points (west / east). Lavi costs 906. Standard error of a win-rate effect is about 1.8 points.

| Scenario | 1 tie-break | 2 mild | 3 strong |
|---|---|---|---|
| 3 Lavi v 3 Lavi | -0.3 / +0.1 ; +45 / +57 | +0.1 / +0.1 ; +62 / +57 | -3.3 / -0.7 ; -98 / +23 |
| 4 Lavi v 4 Lavi | +1.3 / +1.5 ; +193 / +147 | +1.1 / +1.3 ; +186 / +125 | -1.1 / -1.5 ; +76 / -27 |
| 2 Lavi 2 Eitan mirror | +0.9 / +0.1 ; +55 / +23 | +0.7 / +0.1 ; +48 / +22 | +0.5 / -0.5 ; +52 / 0 |
| Lavi, Namer, Eitan x2 mirror | +0.9 / 0.0 ; +44 / +41 | +0.9 / +0.4 ; +39 / +54 | +0.8 / +0.1 ; +40 / +61 |

Controls for the same four scenarios (no rule): west/east win 57.1/42.3, 42.9/55.4, 53.7/44.5 and
45.5/38.1 (16.4% undecided). Variant 3 pulls fire onto the far damaged hull and loses ground in the plain
Lavi fights (-98 and -27 value, -3.3 points); variants 1 and 2 are mildly positive everywhere and
significant nowhere. Variant 4 was run at 400 seeds only and reads as noise (-0.5 to +2.0 points).

### 3.3 The gates

| | base | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `pnpm balance` §5.7 | all met, both tiers | identical rows | identical rows | identical rows | identical rows |
| `pnpm playtest` plans | 37 of 37, 30/30 each | 37 of 37 | 37 of 37 | 37 of 37 (umm_zeitoun_4 slowest win 406 s to 436 s) | 37 of 37 |
| Versus cells inside 60/40 (96 seeds, 16 offered) | 16/16 (worst 59.4%) | 15/16 (62.5%) | 15/16 (60.4%) | 14/16 (62.5%, 61.5%) | 12/16 (up to 62.5%) |
| `pnpm test:determinism` | 107/107 | 107/107 | 107/107 | 105/107 (relief pin) | 107/107 |
| Full `pnpm test`, failing tests | 0 | 5, 3 files | 4, 3 files | 6, 4 files | 4, 3 files |
| `vehicle-health:probe` (200 seeds) | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 |

`pnpm balance` is blind to this change by construction: its targets are ATGM, APS, urban, smoke, air and
swarm, and none puts two hard hulls in reach of one shooter. The 16 versus cells are the sensitive
instrument, and they are sensitive to ANY perturbation: a cell at 55% to 59% on 96 seeds moves by its own
sampling error (about 5 points) when the rolls change. Control for that, 288 seeds on the 8 faction and
economy cells (base worst 56.3%): variant 2 reads all 8 inside, worst 58.0%; variant 1 has one at 61.1%
(Tel Marum, economy, Sarim friendly; base 56.3%, a difference of 1.2 standard errors). The mirror and tunnel
cells were not repeated at 288.

`vehicle-health:probe` rows that move under variant 2 (the others are unchanged): the Lavi mirror (all
armour) reads deaths per run 5.28 to 5.36, time to kill median 55.4 s to 51.9 s, west wins 41.0% to 45.5%;
the KDF assault on a Sarim hold reads 0.91 to 0.92 deaths per run. The GH-560 gate row (the Lavi duel) and
the S5 rows did not move.

## 4. Realism read

For: concentrating fire on a target already hit is ordinary gunnery practice ("most dangerous first, then
nearest; re-engage until it is destroyed"; that is general knowledge, not sourced from this repository),
and after GH-560 a hull is a durable object that takes several hits, which "nearest" treats as
interchangeable.

Against: (a) the rule uses the true bar, where a crew infers damage from its own hits, smoke and the target
stopping; the sim already has observable states (`firepowerKilled`, `mobilityKilled`, and
`lastDamagedTick`) that a more honest proxy could use, unmeasured here; (b) crews also spend rounds on
a target about to die, and the cold-line counts say concentration costs about 0.4 of 5 impacts in
flight, which is realistic and is also why the clear time does not improve; (c) the existing
`ANTI_ARMOR_SOFT_RANK_SQ` rule already deprioritises a firepower-killed hull for anti-armour weapons (a
hull that cannot shoot is "finished enough"), and a second HP-driven rank would compose with it
multiplicatively (a firepower-killed hull at half HP ranks 4 x 0.75 under variant 2), which nobody has
looked at.

## 5. Invariants and structure

- **Determinism / RNG (invariants 2 and 3).** The choice is pure integer Q16.16 and draws nothing. Mode 0
  is byte-identical (107/107). Variants 1, 2 and 4 move no determinism golden; variant 3 moves the relief
  replay (`1483138559` to `1368561466` on my run). No shooter's stream gets a new draw; a shooter with no
  damaged hard hull in reach selects exactly as today.
- **The ordered-focus path is untouched.** `focusTarget`, `canFocus`, `focusHurts`, `weaponHurts`,
  `projectHit` and the app's `intents.ts` need no edit, and nothing re-derives "can it hurt that".
- **Where it would go.** Only `selectTarget`'s scan loop and `tuning.ts` (two raw Q16.16 constants with the
  decimal in a trailing comment: for variant 2, 32768 `// 0.5` for the floor). The 64-bit-safe form is
  `fx.mul(rank, 32768 + (f >> 1))`; a squared distance of 40 tiles is 1.05 x 10^8 in Q16.16, and the anti-armour discount multiplies it by 4, still below int32.
- **Cost.** One `fx.div` per candidate that passes `engageable`, is hurt and is a hard hull (16 types). Not
  timed: `selectTarget` is already the O(N^2) scan in `scaling-debts.md`, and a division on a few percent
  of its candidates is small, but `perf-analyst` should confirm before it ships.
- **Non-transitivity.** Variant 1 is not a total order (the band comparison is not transitive), so its
  result depends on scan order. It is deterministic, but it is the argument against it.

## 6. What it would cost to ship (variant 2)

1. `selectTarget` change plus two constants, a unit test for the rank (with the mutation that sets the floor
   to 1.0 and watches it go red, per CLAUDE.md), and a `determinism.test.ts` note; no golden moves.
2. Re-seed the failing tests (four for variant 2, five for variant 1) in three files, as GH-560 did before it: `tools/src/backtest/versus-probe.test.ts`
   (the wadi_tarfan game "the two tables decide differently"), `tools/src/net/arena.test.ts` (two tests
   that pin a seed where rush beats passive), and `tools/src/net/players.test.ts` (rush beats passive from
   seat 0). Each is a hand-picked seed that has to be re-found (`players.test.ts` documents several previous
   re-picks). Not done here.
3. Re-win the 16/16 versus bar. At 96 seeds variant 2 leaves 15/16 (Wadi Tarfan faction, Sarim friendly,
   60.4%); the base's own worst cell is 59.4% (faction, Wadi Tarfan, Sarim friendly), so there is no headroom
   and a data re-pricing round (camps, capacities), like GH-560's own, is the likely price.
4. Docs: `sim-and-orders.md` ("Target choice still reads P(pen), never HP" becomes untrue), GDD 5.3.
5. A playtest read of the eight Sarim missions with `loiter_drone` is not needed (no drone path touches it),
   but `pnpm playtest` should be re-run on the built variant, not on this scratch.

## 7. What was not measured

- Wall-clock cost of the extra division (structural estimate only).
- Variant 4 at more than 400 seeds, and the mirror and tunnel versus cells at more than 96.
- A proxy that uses `lastDamagedTick` ("the hull I just hit") instead of the true fraction.
- Garrisons (`pnpm balance` is blind to them; `garrison-probes.ts` was not run) and the air-assault and
  e6 swarm probes. The rule is limited to hulls with a plate of 30 mm or more, so a helicopter is eligible
  (Peten, Yanshuf) and a drone swarm is not, but no helicopter scenario was run.
- Whether a cleverer scenario than two blobs finds a larger effect: a staggered line, hull-down positions
  and mixed AT and cannon fire were not built.

Scratch files: `/Users/ilpinto/dev/roaring-lions-ep/_coord/finish-hull/` (`focus-probe.ts`,
`scratch-selectTarget.patch`, `run.sh`, `out/`). The measurement worktree was removed after copying them.
