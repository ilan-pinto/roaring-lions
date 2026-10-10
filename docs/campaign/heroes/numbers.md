# Field commanders: the numbers (G-NUM, GH-298)

**2026-10-02** · status: **numbers for approval, docs only** · base `origin/main` `2b539784` ·
spec `docs/superpowers/specs/2026-09-30-field-commanders-design.md` (cited as "spec §n") ·
names `docs/campaign/heroes/names.md` (PR #309) · art held from #318.

This file replaces every **P** in spec §6.1 with a number, a reason and a label. It changes no
sim code, no `tuning.ts`, no unit JSON and no test. The sim work is Stage 5, after FW (#277) and
E6 (#274).

**Labels.** Every figure is **(M)**, measured this session by a command quoted here, or **(R)**,
reasoned by arithmetic from the code and tables named beside it. Nothing is unlabelled.

**Names.** The fires officer is **Sagi** Sharav. The brief and the spec say "Yoav", but the rule-3
screen replaced that name (Operation Yoav, 1948; `names.md` §2.2). The ids are functional
(`officer_infantry`, `officer_fires`, `officer_armour`, `officer_engineer`), so only `name`
depends on this. Decision N-11 asks the lead to confirm it.

## 0. The rulings these numbers serve

- The four officers are Maya (infantry), Yoav/Sagi (fires), Ronen (armour) and Dalia (engineer).
- An officer is always wounded, never killed.
- An officer is earned **and** buyable with brigade credits. Roar coins never buy one.
- **An officer buys at most one ratio step.** 1:1 with an officer plus smoke must still fail.
- The officer meshes exist and are held (#318).

## 1. Method

### 1.1 What a "ratio step" is, as a number

§5.7's force ladder is 1:1 fails, 2:1 is unreliable and 3:1 is reliable. A step is one rung of
that ladder. In force it is ×2 from 1:1 and ×1.5 from 2:1. The test applied below is **≤ ×2**, the
first rung, and the lower ×1.5 is quoted where it binds. Smoke is the precedent (lead ruling D1,
GDD §5.7): it takes 2:1 into the 3:1 band, and 1:1 plus smoke still fails.

Each officer is held to this in two ways:

1. **Per table.** Each effect is compared with the next rung of the `tuning.ts` table it moves
   (`COVER_HIT`, `COVER_SUPP`, `VET_*`, `AMBUSH_SIG`, `SUPP_DECAY`). Section 7 sets these side by side.
2. **End to end.** A paired-seed probe compares the officer against adding force (a second
   mortar tube, more hulls, a bigger wave), or runs it on the §5.7 urban town itself.

### 1.2 The probes, and why they are trusted

The probes are throwaway TypeScript in the session scratchpad (`.../scratchpad/hero-num/`), not
repo code. They do not edit the sim. They **shadow private methods on one live `Sim` instance**
(TypeScript `private` is compile-time only). Each effect is emulated exactly as the spec writes it:

| effect | how the probe emulates it |
|---|---|
| per-unit decay, pin threshold and rout threshold | `stepUpkeep` replaced by a copy that reads per-unit decay, `pinAt` and rout ticks (spec §2.1) |
| `supp_taken_mult` and dig-in cover | `applySuppression` replaced by a copy that adds the multiplier after veterancy and before cover, and the cover step (spec §2.1, §2.4) |
| dig-in on the hit roll | `hitFactors` wrapped to raise the target's own tile cover by one for that call only |
| observed fire | `fireAt` wrapped to rescale the miss vector of the projectile it just wrote, **after** the shipped RNG draws, which is the spec's own rule (§2.2) |
| fire distribution | `selectTarget` replaced, for flagged shooters only, by the shipped scan with the `(hurts, !taken, distance)` key. `firstEngager` is rebuilt from the previous tick's `curTarget` (§2.3). |
| prove the route | `detectionPair` wrapped. ×2 on an ambusher is computed as "stance 0 for this read", because `AMBUSH_SIG` is exactly 0.5. |
| aura refresh | every 10 ticks, MAX over sources. The source is off while pinned, garrisoned, carried or buried (FW cadence, spec §1.2, Q4). |

**Fidelity check (M).** With the emulation installed and no officer present, 60 of 60 urban runs
(1:1 and 2:1, with and without smoke, 15 seeds each) end on a **final `sim.hash()` identical** to
the unpatched sim's. **Falsified (M):** changing the copied default decay from 65046 to 65045 drops
that to **0/60**. Restored, it reads 60/60 again.

**Seeds.** The urban arms reuse `urbanAssault`'s town, plan and seeds (`60000 + ratio·1000 + s`),
at s = 0..119 unless stated otherwise. The officer is spawned **last**, so every other entity
keeps its id and RNG stream and the arms are paired seed for seed (spec §6.2).

**Baseline (M), `pnpm balance` at `2b539784`.** Base: 1:1 0%, 2:1 63%, 3:1 100%, 4:1 100%;
smoke 1:1 0%, 2:1 100%. Max tier: 1:1 0%, 2:1 55%, 3:1 80%, 4:1 98%; smoke 1:1 0%, 2:1 97%.
ATGM Pk 0.67 base and 0.77 max; APS 0.73; Lanchester and air pass. Exit 0 (51.9 s).

## 2. Maya: infantry company commander (`officer_infantry`)

### 2.1 Parameters

| ability | radius | duration | cooldown / charges | magnitude (Q16.16) | table step it moves |
|---|---|---|---|---|---|
| **Presence** (passive aura, own foot) | **5** tiles | while the source is live (refreshed every 10 ticks) | — | `supp_recovery_mult` **1.5**: decay `SUPP_DECAY` 65046 → **64802** (`fx.expNeg(0.0075×1.5)`, LUT value **(M)**). `rout_delay_mult` **1.5**: `ROUT_AFTER_TICKS` 200 → **300**. | suppression recovery and the rout clock (§2.2) |
| **Rally** (order) | **4** | instant | **2 charges, 30 s** (600 ticks) | own soft foot that are pinned or routed get `suppression = min(s, 29490)`, which is `UNPIN_AT − 1`. Her own signature ×**2.0** for **10 s**. | the pin hysteresis band |
| **Assault on my mark** (order) | **6** | **20 s** (400 ticks) | **1 charge** | pin threshold `PIN_AT` 0.70 → **0.85** (55706). Incoming suppression ×**0.8** (52429). Then **20 s** at λ × 0.5 (decay **65291**), or λ × 0.75 (**65168**) inside Presence. | pin threshold; incoming suppression |
| hull | — | — | — | hp 110, crew 2, sight 9, optics 1.2, signature 0.7, carbines | — |

### 2.2 Arithmetic against `tuning.ts` (R, except where marked M)

- **Presence recovery.** Under steady fire of *I* per tick, suppression settles at
  *S\* = I / (1 − d)*. 1 − 65046/65536 = 0.007477; 1 − 64802/65536 = 0.011200. That is
  *S\** × **0.668** (M, computed with `fx`). As an incoming multiplier, 0.668 sits between three
  veterancy levels (1 − 3 × `VET_SUPP_BONUS` 0.08 = 0.76) and one `COVER_SUPP` rung (0→1 = ×0.475).
  **Less than one cover rung.** Unpinning from 0.70 to under 0.45 takes **59 → 40 ticks**
  (2.95 → 2.0 s), and from `SUPP_CAP` 2.0 it takes **199 → 133 ticks** (M, `fx.mul` loop).
- **Rout.** 10 s → 15 s, one threshold scaled ×1.5. It is the same size as a rung of the ratio
  ladder itself, and it only delays a rout.
- **Rally** sets suppression to the bottom of the hysteresis band (`UNPIN_AT − 1`) and never lower.
  It saves at most the time decay would take. That is 59 ticks from `PIN_AT`, or 199 from
  `SUPP_CAP`, twice a mission, 30 s apart. Fire landing on that tick re-pins first, because
  `stepCombat` runs before `stepUpkeep` (spec §2.1).
- **Assault.** ×0.8 incoming is 2.5 veterancy levels (1 − 2.5 × 0.08). The +0.15 on the pin
  threshold is smaller than the 0.25 hysteresis band. After the window comes 20 s of halved
  recovery, so 0.70 → 0.45 takes **118 ticks** instead of 59 (M).

### 2.3 Measured on the §5.7 town (M)

Maya follows group 1, 3 tiles behind its lead squad, re-ordered every 40 ticks. She rallies when 2
or more squads within 4 tiles are pinned or routed, and orders the assault when group 1's lead is
within 8 tiles of its block front (spec §6.2's plan). Wins count **squads only** toward the 25%
survivor rule.

| arm (120 seeds, base roster) | 1:1 | 1:1 + smoke | 2:1 | 2:1 + smoke |
|---|---|---|---|---|
| no officer | 0/120 | 0/120 | 82/120 (68%) | 119/120 |
| officer body only (no aura, no orders) | 0/120 | 0/120 | 82/120 | 119/120 |
| **Maya, all three abilities (numbers above)** | **0/120** | **0/120** | **92/120 (77%)** | **120/120** |
| Presence only | 0 | 0 | 94 | 119 |
| Rally only | 0 | 0 | 76 | 120 |
| Assault only | 0 | 0 | 78 | 120 |
| max tier: no officer → Maya | 0 → 0 | 0 → 0 | 75 → **104** (87%) | 118 → 115 |

**At the gate's own seeds (s = 0..59) (M):** base 1:1 + Maya **0/60**, 1:1 + Maya + smoke
**0/60**, 2:1 + Maya 48/60, 2:1 + Maya + smoke 60/60. Max tier: 0/60, 0/60, 50/60, 58/60.

**Band scan, 2:1, 120 seeds (M).** The rally and assault numbers are unchanged throughout.

| presence `supp` / `rout` / radius | base | max tier |
|---|---|---|
| 1.2 / 1.25 / 5 | 82 | 88 |
| 1.35 / 1.5 / 5 | 88 | 95 |
| **1.5 / 1.5 / 5 (recommended)** | **92** | **104** |
| 1.5 / 2.0 / 5 | 98 | 108 |
| 1.5 / 1.5 / 4 | 91 | 104 |
| 1.5 / 1.5 / 6 (her service radius at 3 missions) | 100 | 115 |
| 1.5 / 2.0 / 6 (top of every band) | 93 | 114 |

At the top of every band, 1:1 + smoke reads **2/120** (1.7%) and 1:1 reads 0/120; max tier
1:1 + smoke reads 0/120 (M).

**Verdict: one step at most, held with margin.** 1:1 never leaves the fail band, with or without
smoke, at any number in any band. 2:1 moves *toward* the 3:1 band: +8 pp base, +24 pp max tier.
That is less than smoke's own step on the same seeds: +31 pp base (82 → 119) and +36 pp max tier (75 → 118). The max-tier row clears §5.7's 2:1 ceiling
(87% against 85%), as smoke's max-tier row already does (`targets.ts:333-338`). It is recorded,
not enforced, for the same reason: no honest upper bound exists against a 100% ceiling.

**Two findings.** **Presence carries all of it.** Alone it reads 94; rally alone reads 76 and
assault alone 78, both within noise of the 82 baseline or below it. This is the reason to keep the
recommended numbers rather than raise them: the orders are timing tools, and they add no second
step. **Her body adds nothing.** Body-only equals no officer, seed for seed (82 = 82).

**On defence (M; R3, the passive-player risk).** Four `inf_squad` hold a line against a
`militia_cell` wave, scored as at least one squad alive at 240 s, 60 seeds per cell. On cover 1,
Presence moves the 50% breakpoint from about **9.2** to about **10.8** militia, **×1.18**. On
open ground it moves nothing (W6 57 against 54, W8 0 against 0). This is under a step.

## 3. Sagi (the brief's "Yoav"): forward observer and fires officer (`officer_fires`)

### 3.1 Parameters

| ability | radius / range | duration | cooldown / charges | magnitude | table step it moves |
|---|---|---|---|---|---|
| **Observed fire** (passive `observer`) | his own sight, **12** tiles, with LOS and smoke below `SMOKE_BLOCKS_AT` | while alive, surface and unpinned | — | `indirect_scatter_mult` **0.5** (32768): a KDF `INDIRECT_MASK` miss lands **0.25–0.75** tiles out instead of `SCATTER_BASE` + u = 0.5–1.5. The hit roll is untouched. | indirect miss scatter |
| **Priority call for fire** (`call_strike`) | any point he can observe | 3 s delay (unchanged) | **60 s cooldown** (1200 ticks); **1 free call** a mission, then `STRIKE_COST` 250 Intel | scatter `% (9830 + 1)` = **0 to 0.15** tiles instead of `STRIKE_SCATTER` 0.3. 600 damage, 2-tile splash. | strike scatter and its Intel price |
| hull | — | — | — | hp 100, crew 2, sight 12, optics 1.6, signature 0.5, carbines | — |

### 3.2 Arithmetic (R)

- **Mortar splash.** `mortar_team` splashes 180 damage over 1.8 tiles, linear falloff. The mean
  splash fraction of a miss is 1 − r/1.8: **0.444** unobserved and **0.722** observed, **×1.63**
  per miss against a point target (M, numerical integral). The only KDF indirect weapon is
  `mortar_60` (`rocket` is Sarim's). The hit chance does not move.
- **Strike.** Damage is 600 × (1 − r/2). Over r ∈ [0, 0.3] the mean is **555** and the minimum
  **510**. Over r ∈ [0, 0.15] they are **577.5** and **555** (M). Both minimums kill any single
  `militia_cell` (360 hp) or `sarim_rifles` (420 hp). So the halved scatter is **inert against a
  point target** and buys only the edge of a group. The priority call's real value is the free
  250 Intel and the rule that he must observe.

### 3.3 Measured (M)

**Observed fire.** One `mortar_team` at 14 tiles. Sagi stands 10 tiles from the target in
**every** arm, so contact is identical and only the observer flag changes. 60 seeds, 180 s cap.

| target | 1 tube, unobserved | 1 tube, observed ×0.5 | ×0.75 | ×0.4 | **2 tubes, unobserved (one step)** |
|---|---|---|---|---|---|
| 1 `militia_cell`, cover 2 | 86.4 s | **54.9 s (×1.57)** | 67.9 s | 52.2 s (×1.66) | **47.9 s (×1.80)** |
| 1 `militia_cell`, cover 0 | 67.8 s | **44.6 s (×1.52)** | 54.1 s | 42.6 s | **33.8 s (×2.01)** |
| 4 `militia_cell`, cover 1, all killed by 180 s | 13/60 | **56/60** | 30/60 | 60/60 | **60/60**, 100.6 s |

Every observed miss was rescaled (188/188, 155/155, 565/565), so the emulation fired on every
eligible shot. **Observed fire adds +52–57% to the kill rate, where a second tube adds +80–101%.** That is less than one step
at every ×, and ×0.5 sits inside N8's band.

**Free priority call, upper bound.** On the §5.7 town, one defender (rotating by seed) is struck
dead at t = 0, a perfect strike with no scatter and no delay. 1:1 reads **0/120**, 1:1 + smoke
**15/120 (12.5%)**, 2:1 77/120 (82 without, within noise) and 2:1 + smoke 118/120. **The ruling
holds even for a perfect free strike:** 1:1 + smoke stays under 25%.

## 4. Ronen: armour commander, command tank (`officer_armour`)

### 4.1 Parameters

| ability | radius | duration | cooldown | magnitude | table step it moves |
|---|---|---|---|---|---|
| **Fire distribution** (passive aura, own vehicles) | **6** | while the source is live | — | key `(hurts, !taken, distance)`. **No accuracy, penetration or damage change.** | target choice only |
| **Crew drill** (same aura) | **6** | the same | — | vehicle `supp_recovery_mult` **1.5**, decay **64802** | crew-shaken recovery |
| **Smoke and bound** (app-side fan-out) | **6**, 4 screens 6 tiles apart | each screen is `SMOKE_MAX` 255 at 1 per tick (about 13 s) | each hull's own `SMOKE_COOLDOWN` 45 s | none of its own: it spends smoke, which is itself one step (D1) | — |
| hull | — | — | — | `mbt_lavi`'s, including `smoke` | **a whole MBT** (§4.3) |

### 4.2 Arithmetic (R/M)

Crew shaken sets suppression to `CREW_SHAKEN_SUPP` 0.8. Under drill, recovering below 0.45 takes
**77 → 52 ticks** (3.85 → 2.6 s) (M, `fx` loop). The steady-state equivalence is the same ×0.668
as Maya's Presence (§2.2), which is less than one `COVER_SUPP` rung.

### 4.3 Measured (M)

Three `mbt_lavi`, plus Ronen spawned last, attack-move against the enemy below. 60 seeds, 240 s cap.

| enemy | 3 + Ronen, aura OFF (= 4 Lavi) | **3 + Ronen, aura ON** | 5 Lavi (+1 hull) | 6 Lavi (×1.5) | 8 Lavi (×2) |
|---|---|---|---|---|---|
| 5 `technical` | 65.6 s, 38.9 rounds | **64.7 s, 38.3** | 56.1 s | 48.0 s | 39.8 s |
| 4 `recoilless_team` (cover 1) + 2 `technical` | 72.1 s, 44.1 rounds | **65.5 s, 40.1** | 70.0 s, 54.1 | 62.4 s | 55.7 s |
| 4 `atgm_cell` (cover 2) | won 44/60, 165 s, 0.43 hulls lost | **won 49/60, 147 s, 0.47** | 54/60, 130 s, 0.27 | 58/60, 111 s | 60/60, 89 s |

**The aura is worth less than one extra hull** in all three fights. It saves 9% of rounds where
targets are soft and many. It is well under a step.

**His hull, which is the problem (M).** On the §5.7 town, Ronen's command Lavi attack-moves with
group 1. No aura applies there: the town has no other vehicles.

| arm (120 seeds) | 1:1 | 1:1 + smoke | 2:1 | 2:1 + smoke |
|---|---|---|---|---|
| no officer | 0 | 0 | 82 | 119 |
| **Ronen's hull, fighting** | **76/120 (63%)** | **13/120 (11%)** | **116/120 (97%)** | 120 |
| Dalia's body, fighting (comparison) | 0 | 0 | 88 | 120 |

The ruling's own clause (**1:1 + officer + smoke ≤ 25%**) holds at 11%. Smoke screens the tank's
own line of fire. But **1:1 + Ronen alone is 63%**, a full step from 1:1 into the 2:1 band, and
the spec's implied clause `1:1 + officer ≤ 0.25` fails. The cause is not command. It is a free
906-logistics MBT that militia rifles cannot hurt (pen 8 against side armour 300), added outside
the starting force and outside credits (spec §1.6). **Decision N-2** removes it: the command
tank **replaces one `mbt_lavi`** in the starting force, so his net effect is the aura alone. 9 of
the 16 slot missions field a Lavi in `starting_force`. 7 of the 11 slot missions after his gate do
(R, counted from `data/missions/*.json`).

## 5. Dalia: engineer commander (`officer_engineer`)

### 5.1 Parameters

| ability | radius | duration | cooldown / charges | magnitude (Q16.16) | table step it moves |
|---|---|---|---|---|---|
| **Work site** (passive aura, own foot) | **4** | while the source is live | — | `work_rate_mult` **1/0.7**, stored as **93622** (not 93623, see below). `build_rate_mult` **4/3**, stored as **87381**. | time held on station |
| **Prove the route** (`hostile_area`) | **3** | the same | — | an enemy in `ambush` within 3 tiles reads signature **×2.0** to side-0 observers | exactly cancels `AMBUSH_SIG` 0.5 |
| **Dig in** (order) | **3** | **20 s** settle (400 ticks) while stationary, unpinned and on the same tile; lasts until the unit moves | **2 charges** | effective cover `c → c + 1`, **capped at 1** (recommended, see below; spec P was 2) | **one `COVER_HIT` / `COVER_SUPP` rung, 0 → 1 only** |
| hull | — | — | — | hp 150, crew 3, sight 8, optics 1.2, signature 0.6, carbines | — |

### 5.2 Arithmetic (R/M)

- **Work.** `demolitionTicks` 100 (`DEMO_SECONDS` 5) → **70**, the D9's 40 → **28**, and
  `tunnelChargeTicks` 160 → **112**. **Store 93622, not the spec's 93623 (M):**
  `fx.toInt(fx.div(fromInt(100), 93623))` truncates to **69**, and 160 to **111**; 93622 gives
  70 and 112. Build: 87381 gives 400 → 300 exactly (M). Two engineers on one building do not stack
  (`demoTicks` is per worker; the first to finish destroys it), so this is the only speed-up the
  model has. As exposure, ×0.7 of the time under fire is ×0.7 hazard, a smaller cut than one
  `COVER_HIT` rung (×0.375).
- **Prove the route.** `AMBUSH_SIG` 0.5 × 2.0 = 1.0. The ambusher reads exactly as an un-stanced
  unit on the same tile, and never below that. The rung it removes is the stance itself.
- **Dig in.** `COVER_HIT` 0→1 is ×0.375 and 1→2 is ×0.367. `COVER_SUPP` 0→1 is ×0.475 and 1→2 is
  **×0.290**. **On suppression, 1→2 is the bigger rung.** The spec's R5 named 0→1 as the big one,
  which is true of the hit table only.

### 5.3 Measured (M)

**Dig in, on the hold probe** (4 `inf_squad` against a `militia_cell` wave of W; at least one squad
alive at 240 s; 60 seeds). "Line" digs in all four squads; "r3" digs the two within 3 tiles of
her, which is what radius 3 reaches on this line.

| line | dig-in | W6 | W8 | W10 | W12 | W16 | W20 | W24 | 50% breakpoint | force ×, against the same line undug |
|---|---|---|---|---|---|---|---|---|---|---|
| cover 0 | none | 54 | 0 | 0 | 0 | 0 | 0 | 0 | ≈ 6.9 | — |
| cover 0 | r3, cap 1 or 2 | 60 | 31 | 0 | 0 | 0 | 0 | 0 | ≈ 8.1 | ×1.17 |
| cover 0 | whole line, cap 1 or 2 | 60 | 60 | 15 | 2 | 0 | 0 | 0 | ≈ 9.3 | **×1.35** |
| cover 1 | none | 60 | 60 | 9 | 0 | 0 | 0 | 0 | ≈ 9.2 | — |
| cover 1 | r3, **cap 1** | 60 | 60 | 19 | 2 | 0 | 0 | 0 | ≈ 9.5 | ×1.03 |
| cover 1 | r3, cap 2 | 60 | 60 | 60 | 60 | 45 | 1 | 0 | ≈ 17.4 | **×1.89** |
| cover 1 | whole line, cap 2 | 60 | 60 | 60 | 60 | 60 | 43 | 4 | ≈ 21.4 | **×2.33** |

The emulation's 0→1 (×1.35) matches undug cover 1 against undug cover 0 (9.2 / 6.9 = ×1.33),
which cross-checks it against the shipped cover table. **At cap 2 the 1→2 rung is more than one
step (×2.33)**, and at radius 3 it is within 6% of one (×1.89). At cap 1 the largest reading is
×1.35. **Recommend `cover_cap` 1** (decision N-1). Physically, a scrape turns open ground into
light cover; it does not turn a light position into a heavy one.

**Prove the route** (an `rpg_team` in `ambush(N)` beside a three-squad column, Dalia walking point
2 tiles ahead, 100 seeds per cell). The score is the share of fights where the ambusher fires
before being identified (the GDD §5.7 ambush measure).

- Detection here is nearly binary per geometry: every cell read 100/100 or 0/100.
- **Radius 3 changes 1 of 18 cells.** It only beats a trap *tighter* than her own reach (cover 3,
  `ambush(2)`, 1 off the road: 100 → 0). Against `ambush(3)` it is inert, because she enters her
  own radius on the tick the trap springs. Radius 4 changes 3 of 18, radius 5 changes 5, and
  radius 4 at ×1.5 behaves like radius 3.
- Outside her radius nothing changes, by construction (the scope is the aura).
- Authored content (R, counted from `data/missions/*.json`) has 56 ambush stances. Their trap
  radii are 2 (3 stances), 3 (24), 4 (17), 5 (1), 6 (7) and 10 (4). **At radius 3 she counters 3
  of 56; at radius 4, 44.** Radius 4 would end Ashwar's doctrine wherever she leads. Radius 3
  leaves it standing and makes walking point a choice. Decision N-7.

## 6. Service steps (spec §1.5, N16)

| officer | at 3 missions survived | at 6 | still one step at the top? |
|---|---|---|---|
| Maya | Presence radius 5 → **6** | rally **+1 charge** (3) | **yes (M)**: radius 6 reads 2:1 100/120 base and 115/120 max tier. With rout 2.0 on top, 1:1 + smoke reads 2/120. |
| Ronen | aura radius 6 → **7** | smoke-and-bound unchanged (it has no charges) | yes (R): the aura is under one hull at radius 6, and +1 tile adds recipients, not effect per recipient |
| Dalia | work-site radius 4 → **5** | dig-in **+1 charge** (3) | yes (R): charges add coverage, not depth. The cap stays 1. |
| Sagi | — | — | **the whitelist cannot express a step for him** (`^(aura\.area\[0\]\.radius|orders\.[a-z_]+\.(charges|radius))$`; he has no `area` and `call_strike` has a cooldown, not charges). Decision N-10. |

## 7. Summary: each effect against its table (R)

| officer | effect | the `tuning.ts` rung it is compared with | the effect | ≤ one rung? |
|---|---|---|---|---|
| Maya | Presence recovery | `COVER_SUPP` 0→1 ×0.475 | steady-state ×0.668 | yes |
| Maya | rout delay | ratio rung ×1.5 | ×1.5 | yes (equal) |
| Maya | Assault, taken | `COVER_SUPP` 0→1 ×0.475 | ×0.8 (2.5 veterancy levels) | yes |
| Maya | Assault, pin threshold | hysteresis band 0.25 | +0.15 | yes |
| Sagi | observed scatter | a second tube (×1.80–2.01 measured) | ×1.52–1.57 kill rate | yes |
| Sagi | priority scatter | `STRIKE_SCATTER` 0.3 | 0.15; minimum damage 510 → 555 | yes (inert against a point target) |
| Ronen | fire distribution | +1 hull | under +1 hull, measured | yes |
| Ronen | crew drill | `COVER_SUPP` 0→1 | ×0.668 | yes |
| Ronen | **hull** | the ratio ladder | **1:1 0% → 63%** | **one full step on its own: N-2** |
| Dalia | work ×0.7 time | `COVER_HIT` 0→1 ×0.375 hazard | ×0.7 hazard | yes |
| Dalia | prove the route ×2 | `AMBUSH_SIG` 0.5 | exactly cancels it | yes (equal) |
| Dalia | dig-in, cap 1 | one cover rung, 0→1 | ×1.35 force, measured | yes |
| Dalia | dig-in, cap 2 | one cover rung, 1→2 | **×1.89–2.33 force, measured** | **no at ×2.33: N-1** |

## 8. Earn paths and prices

### 8.1 The ladder, re-walked (M)

`pnpm playtest` at `2b539784` (exit 0, `credit ladder: 5849 over 26 missions`, matching
`LADDER_CREDITS` 5849) was summed in `world.json` order. It reproduces `GATES` exactly (12 stars
after 5, 30 after 13, 44 after 19). `prices.md` §2 is the stale 5544 ladder and is not used.

| # | mission | slot? | stars, cumulative | credits, cumulative | Conduct average |
|---|---|---|---|---|---|
| 3 | beit_sahwan_2_foothold | 1 | 7 | 697 | 99.0 |
| 4 | beit_sahwan_3_clearance | 1 | 10 | 977 | 99.3 |
| 5 | beit_sahwan_4_subterranean | 0 (Q5) | 12 | 1165 | 99.0 |
| 6 | khan_rafid_1_recon | 0 | 15 | 1475 | 99.2 |
| 7 | khan_rafid_2_foothold | 1 | 17 | 1700 | 99.3 |
| 8 | khan_rafid_3_clearance | 1 | 19 | 1916 | 96.4 |
| 9 | deir_amun_1_recon | 0 | 22 | 2186 | 96.8 |
| 10 | deir_amun_2_foothold | 1 | 24 | 2411 | 94.6 |
| 11 | deir_amun_3_subterranean | 0 | 26 | 2651 | 93.7 |
| 12 | tel_marum_1_recon | 0 | 28 | 2851 | 94.3 |
| 13 | tel_marum_2_foothold | 1 | 30 | 3049 | 94.5 |
| 14 | tel_marum_3_clearance | 1 | 32 | 3279 | 94.6 |

The remaining slot missions are 16, 17, 19, 20, 21 and 23–26. That is 16 slots in all, matching
spec §3.1.

### 8.2 Gates and prices

"Fielded first" is the first slot mission after the officer opens. **Slots gained** is how many
slot missions a first-campaign purchase fields him in before the earned path would, on the
optimal ladder, spending nothing else.

| officer | earned gate | opens after (M) | fielded first, earned | price | affordable after (M) | fielded first, bought | slots gained |
|---|---|---|---|---|---|---|---|
| Maya | story: `after_mission beit_sahwan_4_subterranean` | **5** | #7 | **1,200** | 6 (1475) | #7 | **0** |
| Sagi | `stars_min` **20** | **9** | #10 | **1,500** | 7 (1700) | #8 | **+1** |
| Dalia | `stars_min` **30** | **13** | #14 | **1,800** | 8 (1916) | #10 | **+2** |
| Ronen | Conduct ≥ **85** AND `after_mission tel_marum_1_recon` | **12** | #13 | **2,400** | 10 (2411) | #13 | **0** |

**Recommendation: keep the spec's prices** (decision N-3). Reasons:

- **The band (R).** All four sit inside the earned-and-bought band of 850–3,200
  (`prices.md` §4) and under the bought-only floor of 4,000 (`prices.md` §8). Nothing play can
  reach costs what something play cannot.
- **Ordering by strength.** Ronen, who brings a hull, is dearest. Maya's Presence is the
  strongest pure aura measured, but her gate opens first, and the order follows the gates as the
  star units' prices do.
- **Margins.** Maya and Ronen gain no slot in a first campaign at **any** price in the band. No
  price ≥ 850 is affordable before mission 3. Ronen's next slot after mission 10, 11 or 12 is #13
  either way, so his 11-credit knife edge at mission 10 changes nothing. **Their purchase buys
  permanence**: from mission 1 of the next campaign, which is #3's foothold (spec §1.5, D4).
  Sagi gains one slot (#8) and Dalia two (#10, #13).
- **Totals.** The four cost **6,900, 1.18 × `LADDER_CREDITS`**. With half the ladder reserved for
  upgrades (`prices.md` §7), a first campaign buys one or two.

**Two notes:**

- **The §4.2 cap.** No mission pays more than a fifth of the cheapest star-gated price
  (5 × 310 = 1,550). It is broken by Maya (1,200) and Sagi (1,500), exactly as `breach_team`'s 850
  breaks it, the exception the lead accepted on 2026-09-18 (`prices.md` §3.4). For an officer, the
  cap's purpose (no lucky run makes it feel free) is met another way: the officer still has to
  be slotted, and wounds cost missions.
- **A realistic ★★ player** (2 stars a mission) opens Sagi after mission 10 and Dalia after 15
  (R), one to two missions later than the table. A price is then a slightly bigger shortcut.

**Roar coins: no path.** `unlock.price` is brigade credits only (G7); validator rule 1 means an
officer is never bought-only.

### 8.3 `cost.logistics` (never charged; it fits the hull to the curve)

Spec §1.1's placeholder of 180 for the foot officers **fails the cost-curve gate (M)**. With the
four staged in `--also`, the refit pushes `attack_drone` to **+18.9%** (limit ±18%). At **Maya
200, Sagi 210, Dalia 205, Ronen 906** (= `mbt_lavi`), `validate_balance.py --also <staged>`
passes 38/38 units. All four officers fall within −0.3% to −3.9% of the fitted curve, and
`attack_drone` reads +17.2% (M). It also passes beside E5's staged directory (39/39) and with
`--max-tier --upgrade-cost-factor 0.02` (38/38) (M). Whoever stages the JSON (task A5) uses these.

## 9. Wounds (always wounded, never killed)

| rule | number | label |
|---|---|---|
| what triggers it | the officer is destroyed (hp 0, or his hull destroyed). No roll, no RNG draw (spec §3.3). | R |
| recovery | sits out **the next 1 won mission**, slot or not. A defeat writes nothing, so a lost retry does not heal him (spec §1.5, Q6). | R |
| what the player loses meanwhile | (1) that mission's officer slot: the deploy row greys him, and the slot stays empty unless another fit officer is unlocked; (2) one mission of service accrual, since `missions` does not increment while out; (3) **no credits**, because he is outside `startingIds` (spec §1.6). The purchase and the unlock are never lost. | R |
| how often it happens | Maya on the §5.7 town, 120 seeds: wounded in **1/120** winning 2:1 runs, **9/120** in 2:1 + smoke (she pushes further), **0/120** at 1:1, and **93/120** at 1:1 + smoke, which is a losing fight. **About 1–8% of won fights** on this plan. | M |
| what it costs over a campaign | Maya has 14 slot missions after her gate. One wound costs one of them, about 7% of her campaign. | R |

**Recommendation: 1 won mission** (decision N-9). At the measured wound rate, a two-mission
recovery would still be rare. Lengthening it is the lever R4 names, a data change if the stakes
read low in playtest.

## 10. Effect on `pnpm balance` §5.7

| target | effect | label |
|---|---|---|
| ATGM Pk 0.67 / 0.77, APS 0.73, urban 0/63/100/100 (base) and 0/55/80/98 (max), Lanchester, air | **unchanged.** No §5.7 scenario spawns an officer, and `officer_slots` defaults to 0. The B1 re-pin moves the determinism hash, not these numbers (spec §8.1's "no behaviour moved" proof). | R |
| Smoke buys one step (2:1 + smoke 100% / 97%) | unchanged, same reason | R |
| **New pinned case, Maya** (spec §6.2) | enforced 1:1 + Maya + smoke **0/60** and 1:1 + Maya **0/60** (≤ 25%, both rosters). Recorded 2:1 + Maya **48/60** base and **50/60** max; 2:1 + Maya + smoke **60/60** and **58/60** | M, gate seeds |
| cost of that case | 2 arms × 60 seeds × 2 rosters = 240 runs at about 56 ms a run, **about 13 s** added to the 52 s run | R from M (480 probe runs in 26.9 s) |
| Ronen's Lanchester variant (spec §6.2) | inert: Lanchester fields only `inf_squad`, and his aura affects vehicles | R |
| GDD ambush ≥ 80% outside Dalia's radius | holds by construction (the aura's scope). Inside it, see §5.3. No `pnpm balance` target measures ambush today. | R |

## 11. Not measured, and why

- **The passive control of each adopting mission with each officer** (spec §6.2, R3) is content
  work (D2). It needs `officer_slots` and the slot spawn in `mission.ts`, which are Stage 5. The
  defence probe (§2.3, §5.3) is the proxy: Presence ×1.18, dig-in at cap 1 ×1.35 at most.
- **Fire distribution's cost per tick and its swap stability** need the real implementation
  (B5, `perf-analyst`).
- **Rally's self-signature boost** (×2 for 10 s) is not in the Maya probe. Leaving it out flatters
  her, so the probe's 1:1 readings are upper bounds.
- **Smoke and bound** is app-side and spends existing smoke. No probe was needed beyond D1.
- **Work and build rates** were checked as tick arithmetic only. FW construction and E6's placed
  charge do not exist yet.

## Decisions for the lead

| # | decision | recommended default |
|---|---|---|
| N-1 | Dig-in's `cover_cap`: spec P was 2; at 2 the 1→2 rung measures ×2.33 force (more than one step). | **Cap 1**: dig-in lifts open ground to light cover only (×1.35 at most). |
| N-2 | Ronen's command tank is a free MBT outside the starting force: 1:1 + his hull alone wins 63% on the §5.7 town. | **His tank replaces one `mbt_lavi` in the starting force**, and his slot is offered only where the force fields one (7 of 11 slot missions after his gate). His net effect is then the aura, under +1 hull. |
| N-3 | Prices. | **Keep 1,200 / 1,500 / 1,800 / 2,400** (Maya / Sagi / Dalia / Ronen). The set is 6,900 = 1.18 ladders. Accept the §4.2 cap exception for Maya and Sagi, as for `breach_team`. |
| N-4 | Earned gates. | **Keep the spec's**: Maya after `beit_sahwan_4_subterranean` (opens after #5), Sagi ≥ 20 stars (#9), Dalia ≥ 30 stars (#13), Ronen Conduct ≥ 85 AND `tel_marum_1_recon` (#12). |
| N-5 | Maya's numbers. | **Keep P**: Presence r5, recovery ×1.5, rout ×1.5; Rally r4, 2 charges, 30 s, self-signature ×2 for 10 s; Assault r6, 20 s, pin 0.85, taken ×0.8, 20 s after-cost at λ × 0.5. 1:1 + smoke stays at 0% even at the top of every band. |
| N-6 | Sagi's numbers. | **Keep P**: observed scatter ×0.5 (+52–57% kill rate against a second tube's +80–101%), priority scatter 0.15, 60 s cooldown, **1 free call** a mission (a perfect free strike keeps 1:1 + smoke at 12.5%). |
| N-7 | Dalia's prove-the-route radius: 3 counters 3 of 56 authored ambushes, 4 counters 44. | **Radius 3, ×2.0**. It beats only traps tighter than her reach, and Ashwar's ambush doctrine stands. |
| N-8 | Officer `cost.logistics` (never charged): 180 fails the cost curve. | **Maya 200, Sagi 210, Dalia 205, Ronen 906.** |
| N-9 | Wound recovery. | **Sits out the next 1 won mission**; no credits lost. Wounds were measured at 1–8% of won fights. |
| N-10 | Sagi's service step: the spec's patch whitelist cannot express one. | **No service step for Sagi in v1.** Revisit by adding `orders.call_strike.free_calls` to the whitelist if service needs parity. |
| N-11 | The fires officer's name: the brief says Yoav, and the #309 screen replaced it. | **Sagi Sharav**, per `names.md`. The id `officer_fires` is unaffected. |
| N-12 | Dalia's work-rate constant. | **Store 93622** (1/0.7 rounded down) so a 100-tick charge lands on 70 ticks. The spec's 93623 truncates to 69. `sim-guard` pins the tick counts in B6. |
