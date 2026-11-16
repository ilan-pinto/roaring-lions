# Making the purse bind: objectives that need production (GH-1387), design

**Status: DESIGN FOR A LEAD DECISION. Docs only: no mission JSON, no `tuning.ts`, no unit stat, no code.** 16 Nov 2026.
**Issue:** GH-1387 (audit dimension D3, now 60, target 80). **Rulings it stands under** (GH-1378, 16 Nov): Q3, objective design
that makes the purse bind is outside the balance park (no tuning constant, no unit stat); Q4, held-ground income on 15 of
30 missions (the census is PR 1486); Q5, enemy camps allowed in a few campaign missions, lifting D7 for missions that
declare one.

**Done means, from the issue:** on the economy missions the plan that spends nothing loses or misses a primary; at most 5
of 20 winning plans bank over 30%; fire-support intel is spent in a majority of winning plans; in tester session 2 the median
tester banks 30% or less and 4 of 5 can explain a cut convoy. This document designs the first two and the harness proof; the
fire-support and tester halves are named as later slices (section 9, D7).

---

## 1. What I read and what I measured

**Read:** `data/missions/*.json` (resources, starting force, objectives, enemy), `data/units/kdf/*.json` (cost and `unlock`),
`packages/sim/src/credits.ts` (`creditsFor`, `creditInputFrom`), `tools/src/backtest/banking.ts` and the banking gate in
`playtest.ts` (`BANKING_OVER_30_MAX`), `plan-sweep.ts`/`income-probe.ts` (how a probe wraps the runtime),
`docs/campaign/economy/{production-numbers,prices,income-numbers}.md`, the GH-1386 census (PR 1486), and
`packages/app/src/main.ts` (how the build menu is gated).

**Measured, by a scratch probe that is not committed** (reproduced in Appendix A): the real `pnpm playtest` was run twice on
this tree, once as is, once with **every `requestBuild` and every `requestSupport` refused**. A refused spend makes a winning
plan "the same orders, never spending". Both runs are over the same 20 economy-mission plans. The run is the harness's
first-seed run (424242) of each plan; the 30-seed plan sweeps run in child processes the probe did not reach, so **this is one
seed per mission, not thirty** (a limit stated again in section 8).

## 2. The finding: the purse binds nowhere today

| result | count |
|---|---|
| winning plans that bank over 30% of what they had (the gate `BANKING_OVER_30_MAX` is 15) | **15 of 20** |
| winning plans that spend **nothing** | **12 of 20** |
| the same plans with every build and support spend refused: still **VICTORY** | **20 of 20** |
| of those 20: identical minutes, Conduct and stars to the spending plan | 13 of 20 identical; all 20 identical in stars |
| the others: minutes within 0.4, except `umm_zeitoun_2` (+1.7 min) and `umm_zeitoun_4` (+0.6); Conduct 5 lower on `ein_qasab_2` and `ein_qasab_3` | 7 of 20 |

So the issue's first criterion ("the plan that spends nothing loses or misses a primary") is **false on 20 of 20 missions
today**, and not only on the 12 whose plan happens not to spend: the eight plans that do spend (292 to 1,472 logistics) win
just as well without it. Money buys convenience, never a result. Every passive control banks 100% and loses, as it should.

The 20 and their purse, from the same run (`P` is `logistics_start` plus what the plan earned, base and zones; "bank" is the
share still held at the end):

| mission | start | earned | P | spent | bank |
|---|---|---|---|---|---|
| `beit_sahwan_2_foothold` | 400 | 608 | 1,008 | 292 | 71% |
| `beit_sahwan_3_clearance` | 600 | 187 | 787 | 0 | 100% |
| `beit_sahwan_4_subterranean` | 500 | 250 | 750 | 0 | 100% |
| `deir_amun_3_subterranean` | 500 | 139 | 639 | 0 | 100% |
| `khan_rafid_2_foothold` | 400 | 533 | 933 | 0 | 100% |
| `khan_rafid_3_clearance` | 400 | 151 | 551 | 0 | 100% |
| `qarn_hadid_2_foothold` | 500 | 455 | 955 | 0 | 100% |
| `qarn_hadid_3_clearance` | 400 | 277 | 677 | 0 | 100% |
| `tel_marum_2_foothold` | 400 | 500 | 900 | 0 | 100% |
| `tel_marum_3_clearance` | 400 | 189 | 589 | 0 | 100% |
| `umm_zeitoun_2_buildup` | 500 | 920 | 1,420 | 350 | 75% |
| `umm_zeitoun_3_clearance` | 400 | 100 | 500 | 0 | 100% |
| `umm_zeitoun_4_clearance` | 600 | 625 | 1,225 | 0 | 100% |
| `wadi_halam_3_counterraid` | 400 | 847 | 1,247 | 350 | 72% |
| `wadi_halam_5_depot` | 400 | 428 | 828 | 0 | 100% |
| *(already under 30%)* `wadi_halam_2`, `wadi_halam_4`, `ein_qasab_2`, `ein_qasab_3`, `deir_amun_2` | | | | 350 to 1,472 | 9% to 18% |

## 3. Three facts that shape every option

**F1. Only five KDF units can be a required purchase.** The build menu offers a unit only if the campaign has opened it
(`main.ts`: "a gate-closed one cannot be built this mission, and 26 of the 31 KDF units are gated"). The five with no
`unlock` block are **`inf_squad` (292 logistics, 15 s), `at_team` (236, 18 s), `mortar_team` (209, 18 s), `apc_eitan` (520, 28 s)
and `jeep_shoded` (317, 12 s)**. Every other unit sits behind a Conduct floor (70 to 90, on the campaign-average Conduct, which a
careful player clears early but a loose one may not) or a star floor. An objective that **needs** a gated unit can be unwinnable
for a legitimate player. So **a required purchase is one of the five, and `validate:data` refuses a plan or objective that names
another** (check C5). This rules out "make the player buy a demolition squad" for the raze and collapse missions, whose
work is done by the gated `demo_squad` and `yahalom_squad`, which is why section 5 binds them differently or leaves three.

**F2. The purse is large against the units, and the arithmetic is simple.** A plan holds `P` (500 to 1,420) and the gate asks
it to spend 70% of `P`: **350 to 994**. At 209 to 520 a unit, that is **two to three of the five**. The campaign has **no
population cap** (`pop_cap` is refused on every campaign mission), so the purse is the only limit. The clearances have small `P`
(500 to 790): two cheap units do it. The footholds and build-ups have `P` of 900 to 1,420 (the base income of 120 to 150 a
minute over four to six minutes): they need an `apc_eitan` plus one more unit. Section 5 shows each.

**F3. A built unit costs nothing in credits; a thinned loan does.** `creditsFor` reads the starting force only (ruling R4:
"a unit built from logistics mid-mission is neither fielded nor lost here"), at 10 credits a unit brought home. So buying moves
no credit and no ladder pin, but **removing a unit from the loaned force removes its 10**: the `LADDER_CREDITS` pin (6,923
today) moves by minus 10 per unit removed per mission, which is a named, countable change (section 6). `LADDER_STARS` (68) and
`ROSTER_MAX` (26) do not move.

## 4. The levers (existing objective types and data fields only)

| # | lever | what it does | reach | cost and risk |
|---|---|---|---|---|
| **L1** | **Thin the loan, add a site.** Remove the unit(s) the objective set needs from `starting_force` (by `count`, never a tagged unit) and add a second **primary** `hold_for` or `capture` in a second zone, its window overlapping the first | the loaned force can no longer hold both sites; a second body must be built. The existing `hold_for`/`capture` types, an existing map zone, no new field | the 12 hold/capture missions in section 5 | credits minus 10 a removed unit (F3); the second zone must exist in the map and be held by a sensible plan, which the probe proves |
| **L2** | **Ask more of the same work.** Raise an existing count (an `evacuate_before` count, a `capture`/`hold_for` seconds) so one loaned carrier or squad cannot do it inside the deadline | a deadline the loaned force misses alone | missions with an evacuation or a long hold | `seconds` is bounded below by the validator (`validate_time_limit`); the winning plan's margin (120 s, 20%) must hold |
| **L3** | **An enemy camp** (the lead's Q5): a side-1 camp structure plus `enemy.production` (menu, purse, rally, group), and a primary `raze` of the camp zone with its `seconds` | the enemy keeps buying while its purse lasts (`spendDown`, round-robin, never banks), so the player must out-produce it or end the camp inside the clock: a race the purse is part of | 3 clearances | **code and contract, not only data**: see section 7 |
| **L4** | **Size the purse to the need** (`resources.logistics_start`, data) | lowers `P` so the required buy is a larger share | optional | mission data, but economy data: left to D4. The recommended plan does **not** need it (every buy in section 5 clears 30% at today's purses) |
| **L5** | **Intel binds** (fire support): a primary `eliminate_hvt` whose target direct fire cannot reach inside the clock, so a barrage or a strike is needed, paid in intel from recon | fire-support intel spent in most winning plans | later slice | not designed here (D7) |

What is **not** a lever: any unit stat, any wave size tuned to hurt (a bigger wave is the balance work that is parked),
the purse's base rate (the phase anchors 120, 150, 80 a minute belong to the phase-5 retune), a gated unit as a required buy
(F1), or a hard population cap (campaigns have none).

## 5. Which missions, and what they must buy

A **required buy** is the cheapest pair or set of the five that takes the plan's spend to 70% or more of today's `P`. Each row
was checked for affordability against `P` (the purse at the end; the buy must also be affordable **in time**, which the
probe checks, C8) and for the resulting bank.

| mission | lever | required buy | spend | bank after |
|---|---|---|---|---|
| `khan_rafid_3_clearance` | L1 | `at_team` + `mortar_team` | 445 | 19% |
| `umm_zeitoun_3_clearance` | L1 | `at_team` + `mortar_team` | 445 | 11% |
| `tel_marum_3_clearance` | L1 (+ L3 candidate) | `at_team` + `mortar_team` | 445 | 24% |
| `qarn_hadid_3_clearance` | L1 (+ L3 candidate) | `inf_squad` + `at_team` | 528 | 22% |
| `beit_sahwan_3_clearance` | L1 | 2 x `inf_squad` | 584 | 26% |
| `wadi_halam_5_depot` | L1 | 2 x `inf_squad` | 584 | 29% (tight: see D3) |
| `khan_rafid_2_foothold` | L1 + L2 (the evacuation) | `apc_eitan` + `at_team` | 756 | 19% |
| `tel_marum_2_foothold` | L1 | `apc_eitan` + `at_team` | 756 | 16% |
| `qarn_hadid_2_foothold` | L1 | `apc_eitan` + `at_team` | 756 | 21% |
| `wadi_halam_3_counterraid` | L1 + L2 | `apc_eitan` + `at_team` (+350 spent already) | 1,106 | 11% |
| `beit_sahwan_2_foothold` | L1 (after PR 1483) | `apc_eitan` (+292 spent already) | 812 | 19% |
| `umm_zeitoun_2_buildup` | L1 | `apc_eitan` + `at_team` (+350 spent already) | 1,106 | 22% |

**Twelve flips of the fifteen.** The three left, **`beit_sahwan_4_subterranean`, `deir_amun_3_subterranean` and
`umm_zeitoun_4_clearance`**, are tunnel, collapse and raze missions whose work is done by gated specialists (F1); binding them
needs L3 or L5 and is not promised. That leaves **3 of 20 over 30%**, inside the issue's 5, with two of margin.

**What "required" means here.** The row names the **capability** the thinned loan lacks (a second body for the second site, a
carrier, an anti-armour team against the armoured wave, indirect fire against a position direct fire cannot hit). The exact
zone, the exact removals and the exact timing are per-mission authoring, done in the slice with the probe as the arbiter: if the
no-spend variant still wins, the mission is not bound yet. The table is the target and the arithmetic, not the finished
mission.

## 6. How the economy supports it

- **Credits (F3).** Buying pays no credit; thinning the loan removes 10 per unit per mission. Removing the units in section 5
  (about 1.5 per mission over 12 missions) moves `LADDER_CREDITS` down by about **120 to 240**, named in each slice's PR and
  re-pinned in the slice that moves it, never silently. The credits a mission pays, and the star and coin tables, are otherwise
  untouched (`creditsFor` is not edited).
- **Held-ground income (PR 1486, GH-1386).** That plan raises `P` on 10 missions (40% of the phase anchor). The census says plainly
  that in 7 of the 10 the plan spends nothing, so "the new income lands in an already-banked purse". **This design is the other
  half:** where a mission gets both, the required buy is recomputed on the new `P` (the section 2 table is regenerated by the
  probe after each GH-1386 batch, and `need70 = 0.7 P` moves with it). Three of the twelve above are also in the GH-1386 batches
  (`khan_rafid_3`, `qarn_hadid_2`, `tel_marum_2` are candidates there); their required buy rises by at most 40% of the zone rate
  over the plan's minutes, still two units. Order: land the binding slice **before** the income batch for any mission in both,
  so the income arrives in a purse the plan spends.
- **The ladder pins.** `BANKING_OVER_30_MAX` ratchets down by slice (15, then 12, then 6, then 3 or 5), each step in the PR that
  earns it; `LADDER_CREDITS` moves as above; `ZONE_PASSIVE_INCOME` stays 0 (no zone covers a starting placement).
- **Purses stay as they are** (L4 off) so no economy datum moves except where a mission's own PR says so.

## 7. The enemy-camp lever (Q5): what lifting D7 costs

D7 says no shipped campaign mission gives side 1 a camp, and `validate:data` refuses `enemy.production` on one while D7 stands
(`CLAUDE.md`, "Production"). The lead's Q5 lifts it **per mission that declares it**. What that needs, read from
`production-numbers.md` and the schema:

1. **Contract:** `validate:data` stops refusing `enemy.production` where the mission declares an opt-in (a named field, for
   example `enemy.production.campaign: true`, so the refusal still holds everywhere else) and keeps its other rules (a side-1 camp
   in `structures`; a menu of `data/units/enemy` units that cost no intel). The contract test changes with it.
2. **The side-1 answer (R-F4-5):** `MissionContext.unitInfo(unitId, side)` takes the side, but "the shipped lambdas answer KDF only,
   so side 1 is refused everywhere until a caller answers for it". The app and the playtest harness must answer for side 1 in a
   campaign mission. Enemy production is **already proved on fixtures and a harness probe** (`enemy-production-probe.ts`); what is
   untested is **in campaign**, which is the slice's test.
3. **A raze primary on the camp**, with its `seconds` (a primary raze needs one), so the camp is a clock and not a hope.
4. **The enemy's purse is data** (`logistics_start`, `logistics_rate_per_min`, a menu); no unit stat and no tuning constant.
   `spendDown` never banks, so the enemy spends every purse it has: **the camp's size is the purse**, and a small one is the lever.
5. **Determinism and the hash:** the sim's production code is already tested for side 1; this adds no sim code. `test:determinism`
   must not move, and a mission that does not declare the opt-in is byte-identical.

Candidates: `tel_marum_3`, `qarn_hadid_3` and `umm_zeitoun_3`, all clearances where a camp behind the line is the story ("the
column keeps coming") and all in the section 5 list, so L3 adds to L1 and does not replace it. The probe must show the
**no-spend plan loses** (the camp out-produces a player who buys nothing) and the **winning plan wins 30 of 30** inside the clock.

## 8. How `pnpm playtest` proves each mission

A committed, report-only probe, **`tools/src/backtest/spend-probe.ts`**, beside `income-probe.ts` and written the same way
(it wraps `MissionRuntime` and reads public getters; Appendix A is its core). Per bound mission, over the **30 plan-sweep seeds**
(`SWEEP_SEEDS`: 424242 and 1..29):

1. **The oracle.** The winning plan with `requestBuild` and `requestSupport` refused **does not win on any seed** (it loses, or
   it ends with a primary incomplete). This is the issue's first criterion made executable.
2. **The winning plan wins 30 of 30**, inside `time_limit_s` with the house margin (120 s and 20%), and **builds exactly the
   required units** (read from the `built` events, not from the plan's text).
3. **The passive control loses** and banks 100%; the mission's `min_win_seconds` floor is unchanged or re-pinned in the slice.
4. **The bank:** the winning plan's `bankedOver(banking, 30)` is false; `BANKING_OVER_30_MAX` is lowered to the count the slice
   leaves, so the gate fails if a later change un-binds a mission.
5. **The five-unit rule:** every unit the plan builds to win is in the ungated five (C5).
6. **The report:** a table like section 2, regenerated, so the next slice reads its own baseline.

The probe is promoted from report-only to a gate for the **bound set** (a `SPEND_BOUND` list in the harness, in the
`LADDER_CREDITS` idiom) in the slice that binds its first mission. **A scripted plan has perfect information** (the issue's own
warning): none of this tunes against a plan's time ratio; the oracle asks only whether spending was needed.

## 9. Falsifiable checks

Per `CLAUDE.md`, each check arrives with a constructed failing input. **None has been run** (this is a design); the implementer
runs each mutation, watches it go red, and puts it back.

| # | check | mutation that must turn it red |
|---|---|---|
| C1 | **the oracle:** the no-spend variant of each bound mission's plan wins on **zero** of 30 seeds | delete the second-site primary from one bound mission, or restore the removed loan units |
| C2 | the winning plan wins 30 of 30 with margin and the `built` events are exactly the required units | drop one `requestBuild` from the plan; build a different unit |
| C3 | the passive control loses and banks 100% on every bound mission | make a zone pay a starting placement |
| C4 | `BANKING_OVER_30_MAX` equals the measured count after each slice (a bound, never an equality) | leave one bound mission unbound: the count exceeds the bound |
| C5 | every required purchase is one of the five ungated units (`validate:data`) | name `demo_squad` or `dozer_d9` as a required buy |
| C6 | `LADDER_CREDITS` moves by exactly minus 10 times the units removed from the loans, golden recorded on `main` first | remove a unit without re-pinning; add a unit to a loan |
| C7 | `test:determinism` and every unbound mission's hash and digest are unchanged | an op that reads the clock or a random |
| C8 | **in time:** the required buy is affordable at the tick the plan needs it (the purse at that tick covers it) | raise the removed units' price by editing the plan's timing, or shrink `logistics_start` |
| C9 | the enemy-camp opt-in: `enemy.production` is accepted only where declared, still refused elsewhere; enemy production runs in campaign | drop the opt-in test |
| C10 | the `spend-probe` table equals a hand recomputation of `P`, `spent` and `bank` for two missions (oracles take literals, not the probe's own arithmetic) | change `bankedOver`'s percent |
| C11 | the section 2 baseline is reproducible: with the probe's refusal switched on, the 20 plans still win today (a control that proves the probe refuses) | make the refusal a no-op: the control reads "wins" where the probe says "refused 0 calls" |

## 10. Slices

1. **S0, the probe and the gate scaffolding** (no mission change): `spend-probe.ts`, the report, `SPEND_BOUND` empty, C10 and C11.
2. **S1, the pilot, four clearances:** `khan_rafid_3`, `umm_zeitoun_3`, `beit_sahwan_3`, `wadi_halam_5` (L1; small `P`, two units
   each). `BANKING_OVER_30_MAX` 15 to 11. Proves the pipeline and the playtest cost.
3. **S2, the other eight** (L1 and L2), in the order that keeps each ahead of its GH-1386 income batch. 11 to 3.
4. **S3, enemy camps** on three clearances (L3), with the contract and `unitInfo` work. No count change; it deepens the binding.
5. **S4, fire-support intel** (L5), designed separately when S1 to S3 have measured what the purse does.

## 11. Decisions for the lead

| # | Decision | Recommended default |
|---|---|---|
| D1 | The pilot | **S1: `khan_rafid_3`, `umm_zeitoun_3`, `beit_sahwan_3`, `wadi_halam_5`.** Clearances, small `P`, the lowest risk |
| D2 | Required buys limited to the five ungated units | **Yes**, enforced by `validate:data` (C5). The alternative (a gated buy where the campaign average Conduct is guaranteed) cannot be guaranteed |
| D3 | Thin the loan (credits minus 10 a unit, `LADDER_CREDITS` moves) | **Yes**, each slice re-pins and names the amount. `wadi_halam_5` lands at 29% banked, one squad's worth under the line: if a slice finds it fragile, it takes a cheaper third unit rather than a smaller purse |
| D4 | Touch `logistics_start` or the base rate | **No.** The phase anchors are the phase-5 retune; every buy in section 5 clears 30% at today's purses |
| D5 | Enemy camps | **Three clearances (S3):** `tel_marum_3`, `qarn_hadid_3`, `umm_zeitoun_3`, with the per-mission opt-in and the `unitInfo(side 1)` work |
| D6 | The three missions left unbound (`beit_sahwan_4`, `deir_amun_3`, `umm_zeitoun_4`) | **Accept**: 3 of 20 over 30% meets the issue's 5. Revisit with L3 or L5 |
| D7 | Fire-support intel | **A later slice (S4)**, designed after the purse has been measured binding |
| D8 | The probe | **Report-only first (S0), a gate for the bound set from S1** |
| D9 | Sequencing with GH-1386 (PR 1486) and PR 1483 (Beit Sahwan II) | **Bind a mission before its income batch lands**, and land PR 1483 before binding `beit_sahwan_2` |

## 12. What I did not verify

- **One seed, not thirty.** Section 2 is the harness's seed-424242 run per plan; the 30-seed sweep was not reached by the scratch
  probe. 20 of 20 winning with every spend refused on one seed is strong evidence, not the 30-seed proof the oracle (C1) will give.
- **No mission was authored or edited, even in memory.** Section 5 is arithmetic on measured purses and published unit prices
  plus the capability each mission would have to lack. Whether a given second zone exists on a map, whether a sensible plan can
  hold both sites inside the clock, and how long the purchases take are the slices' to measure.
- **The 10 credits per unit** and the pin movement are from `creditsFor`'s weights, not a run. The `LADDER_CREDITS` range
  (120 to 240) assumes about 1.5 units removed per mission over 12 missions.
- **Whether `at_team` and `mortar_team` are what each mission needs.** They are the cheap ungated units that fit the arithmetic;
  the enemy composition of each mission decides the real capability gap.
- **The enemy-camp contract change** (section 7) is read from the schema and the production notes; the field name is a proposal.
- **GH-1386's batches** were read from PR 1486's description, not re-run.

## Appendix A: the scratch probe (not committed)

Saved as a 12-line file and loaded before the harness; the harness's own plan code runs unchanged, so a refused build or support
call is the only difference:

```ts
// tools/src/backtest/zz-nospend-scratch.ts (scratch)
import { MissionRuntime } from '@lions/sim';
const proto = MissionRuntime.prototype as unknown as Record<string, unknown>;
let refused = 0;
for (const name of ['requestBuild', 'requestSupport']) {
  if (typeof proto[name] === 'function') proto[name] = function (): boolean { refused++; return false; };
}
process.on('exit', () => console.log(`NOSPEND refused ${refused} spend calls`));
```

```bash
cd tools && pnpm exec tsx --import ./src/backtest/zz-nospend-scratch.ts src/backtest/playtest.ts > /tmp/playtest_nospend.txt
```

It runs in several minutes, prints each `FAILED` the harness raises when a plan's own assertions expect a spend (those lines are
the plan noticing it could not spend, and are the expected noise), and ends with `EXIT=1` for the same reason. The comparison used
the per-mission `VICTORY ... in N min, ROE R, stars S` lines of the first seed.

---

*Written by Claude Code for the lead's decision. Nothing here is implemented; the probe in Appendix A is scratch and was removed
from the tree.*
