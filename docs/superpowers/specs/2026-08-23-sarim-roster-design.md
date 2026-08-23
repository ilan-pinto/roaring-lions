# The Sarim roster — design

**Date:** 2026-08-23
**Slice:** 2 of 5 in [the Sur front](./2026-08-22-sur-front-design.md)
**Advances:** [#15](https://github.com/ilan-pinto/roaring-lions/issues/15) — does not close it. Two of #15's three acceptance boxes are met: the roster (four units, replacing "an ATGM cell and a loitering drone") and "doctrine profile expressed through the §6 behaviour vocabulary, not new engine code." The third — *"the standoff backtest target passes"* — is not: the target was written, measured twice, and failed both times (see "What the standoff target measured," below). It was reverted rather than shipped failing, so #15 stays open on that box alone.
**Status:** approved, pending implementation plan.

## The problem

Sarim has **two units**. Ashwar has six, Rif three, KDF thirteen. A faction that is a third of the war cannot be fought with an ATGM cell and a loitering drone, and Tel Marum (slice 3) cannot be authored against a roster that does not exist.

## Everything is already in the schema

Checked against the tree, not assumed. `faction: "sarim"`, roles `artillery` and `aa`, weapon type `rocket`, `can_target: ["air"]`, `splash_tiles`, `min_range_tiles` — all present, and all **live in the sim**: `minRangeSq` is enforced at three call sites, `canTargetAir` at `sim.ts:2404`.

So this slice is four JSON files, one backtest target, and no engine code — which is exactly what #15 requires: *"Doctrine profile expressed through the §6 behaviour vocabulary, not new engine code."*

## Three findings that shape the roster

### `rocket` fires indirect, and that is the whole front

`INDIRECT_MASK = (1 << mortar) | (1 << rocket)` (`sim.ts:222`): *"Classes that fire indirect — no line of sight needed, only a side contact."*

**Rock blocks sight. It does not block rockets.** The battery shells you from behind the mountain wall — which is GDD §2's description of Sur, arriving free from mechanics that already exist rather than being bolted on.

It also settles the relationship between the two slices. Slice 1's ridges give Sarim its concealment and its dead ground; the battery is what makes hiding behind them insufficient. You cannot wait the rockets out under cover, because cover is not what stops them. You have to reach the tubes.

### `atgm` barely decays with range, which is what a MANPAD needs

`FALLOFF_SCALE` gives `atgm` 0.25 against every other class's 1.0 (`tuning.ts:36`), commented *"Guided weapons (ATGM) barely decay inside their envelope — accuracy is launch-condition-dominated."*

So the MANPAD's missile is authored as type `atgm` with `can_target: ["air"]`. The schema's `interceptor` type is **not** used: it is vestigial — zero structure damage, a filler 1.0 falloff, and no shipped weapon declares it.

### Weapon `magazine` and `reload_s` are dead

Declared in `unit.schema.json`, used by **no shipped weapon**, and read by the sim only for APS (`aps?.magazine`, `sim.ts:434`). The nearby `volley` machinery is tunnel-surfacing, not weapon magazines.

This is a fourth instance of the pattern the front design named — joining `hidden_setup`, `tunnel_travel` and `breach` — and it is the one that bites here. The front design gave `rocket_battery` a "very slow reload"; that cannot be authored.

**Decided: the battery fires on `rof_per_min` alone**, evenly rather than in salvoes. Its identity comes from reach and weight, not rhythm. Implementing the two dead fields would be sim work inside the firing loop, would move the determinism pin, and would contradict #15's own acceptance criterion. Revisit only if Tel Marum measures the battery as ambient noise rather than as pressure that forces movement.

## The four units

Shapes, not final numbers. Exact costs are fitted to the curve during implementation — **the curve is the authority, not the table below.**

| unit | role | shape | anchored against |
|---|---|---|---|
| `rocket_battery` | `artillery` | ~20 tiles, `splash_tiles` ~3, `rof_per_min` ~2, slow, fragile, fitted at 201 — the *cheapest* of the four, not the most expensive | `mortar_team` (18 tiles, splash 1.8, rof 4, 209) and `mortar_crew` (16, 2.0, rof 3, 198) |
| `sarim_rifles` | `infantry` | ~8 tiles, `suppression_resistance` ~0.7, accuracy ~0.68, expensive | `inf_squad` (0.5 / 0.6 / 292) and `militia_cell` (0.4 / 0.5 / 280) |
| `manpad_team` | `aa` | `atgm` missile, `can_target: ["air"]` only, ~13 tiles | `gun_truck` (autocannon, 11 tiles, ground+air, 324) |
| `recoilless_team` | `at_team` | `rpg` type, ~7 tiles, penetration ~650, clearly under the Kornet cell on penetration and range — though not on every axis; see below | `rpg_team` (5 tiles, pen 550, 210) and `atgm_cell` (10, 900, 235) |

Three notes on the shapes:

**The battery is the longest weapon in the game** — past `mortar_team`'s 18. That is deliberate and it is the front's signature. It is also fragile and slow, so reaching it is a mission rather than a duel.

This document originally described `rocket_battery` as "the roster's most expensive," written against a pre-fit estimate of 290. After the cost curve fitted the shipped unit, it came out at **201** — the *cheapest* of the four, and cheaper than both existing artillery pieces it was anchored against (`mortar_team` 209, `mortar_crew` 198). Why: `tools/validate_balance.py`'s offense score never credits `splash_tiles` — there is no area-of-effect term in its cost model at all — so the battery's `rof_per_min: 2` is crushed against `mortar_team`'s 4 despite the battery's higher damage, bigger splash and longer range. It matters less than it looks, though: `cost.logistics` gates only `requestBuild`, i.e. player production. Enemy placement (`spawnPlacement`, serving `starting_force`, `garrison`, `spawn` and `reinforce`) never consults cost at all. So the battery's identity in a mission is carried by its stats and by how many a mission places, not by its price tag.

`rocket_battery` also has `sight_tiles: 6` against `range_tiles: 20`. `selectTarget` requires side-wide target identification (`sim.ts:2400`), so a battery with no spotter is inert past its own sight — measured solo: 6 tiles → 1 shot, 12 tiles → 0, 19 tiles → 0. This is not a defect: `mortar_crew` (6/16) and `mortar_team` (7/18) establish the same sight/range gap as the existing artillery convention. But "shells you from behind the mountain wall," above, never mentions that the battery needs a spotter to do it, and Tel Marum (slice 3) will need to place one with a sight line to the target, not just the battery behind the ridge.

**`sarim_rifles` is "best-trained" made mechanical.** Where Ashwar's militia melts under fire, these hold, so ground must be *taken* rather than shocked. Suppression resistance is the stat that says so.

**`manpad_team` carries no ground weapon, but it is not helpless against ground the way `recon_drone` is.** Its `atgm` missile cannot target infantry or vehicles in the open — `can_target: ["air"]` is what the sim's target-selection stage (`canTargetAir`) enforces. But the firing loop's structure-damage branch gates on `STRUCT_DAMAGE[w.cls]` alone, **never on `can_target`**, and `STRUCT_DAMAGE[atgm]` is 0.6: a MANPAD 7.5 tiles from a garrisoned house fired three missiles in 60 seconds and took it from 1040 HP to 680. `recon_drone`'s helplessness is real for a different reason — it has no weapons at all, so `type.weapons.length === 0` short-circuits the firing loop at `sim.ts:2696` before the structure branch is ever reached. `manpad_team` has a weapon, so it does not short-circuit, and does reach that branch. The scope is narrow: it was also tested against walls, and fired zero shots at them — it damages garrisoned buildings specifically, not fortifications generally. The design intent still holds — the MANPAD cannot shoot infantry or vehicles caught in the open, and still needs an escort for that reason, so it remains the piece that makes a Sarim position a combined-arms problem — but a mission author sizing an AA or garrison threat from the old sentence would be wrong: park a MANPAD near a garrisoned building and it is an anti-structure weapon too. The cost curve prices pure specialists correctly — its scoring is additive precisely so that "recon drones, EOD teams and engineers" are not valued at zero.

**`recoilless_team` is "clearly under the Kornet cell" on penetration and range, not on every axis.** Its `rof_per_min` (4 vs 3), `suppression` (25 vs 10), `speed_tiles_s` (0.85 vs 0.7) and `signature` (0.45 vs 0.5, i.e. stealthier) are all better than `atgm_cell`'s. "Under" describes the anti-armour punch that defines the role, not a strict domination — the recoilless team is faster, quieter, and fires more often; it just cannot punch as hard or as far as the Kornet.

## What makes them Sarim is not range

Sarim cannot out-range anybody, and this design does not pretend otherwise. The player's own `mortar_team` (18) and `sniper_team` (15) both out-reach the Kornet's 10, and `mbt_lavi`'s gun (12) outranges it too. Doctrine comes from three things instead, two of which already exist:

1. **Ambush sprung at ten tiles** — the existing stance, authored in *mission* data at the Kornet's full reach rather than Ashwar's three.

   This is also the most expensive range at which to spring it, and nothing said so before this correction. `atgm_cell` has `range_tiles: 10` but `effective_range_tiles: 8`, and `FALLOFF_SCALE[atgm]` is 0.25 (`tuning.ts:33`), so hit probability at 10 tiles carries `exp(-0.25·(10/8)²) = 0.677` against the accuracy available at 8 — a **32% accuracy loss** for springing at maximum range instead of effective range. Measured with range as the only variable: **@8 won 20%, @10 won 3%**. And `setAmbush` (`sim.ts:1305-1310`) only springs when a target closes inside the radius **with line of sight** — on a rock map, which is slice 1's entire contribution and the front's stated premise, an ambush authored at 10 will frequently not spring at 10 at all. A slice-3 author reading this pillar alone and calling `setAmbush(id, 10)` across Tel Marum would get a pushover, for reasons no earlier version of this document explained.
2. **Rock that blocks sight** — slice 1, merged.
3. **A roster that can only fight at range** — these four.

## No dead abilities on the new units

`atgm_cell` declares `hidden_setup`, and nothing reads it. **None of the four new units will declare it.** Authoring four more instances would deepen the exact pattern this document has now catalogued four times over. Concealment comes from the `ambush` stance, which is live.

## The cost curve is the real risk

`validate_balance.py` **refits the curve from the whole roster on every run** — *"a single bad merge shifts the curve slightly"* — so adding four units moves it for everyone. Current spread across the 25 shipped units:

```
rpg_team      -4.4%
attack_drone  +16.7%     ← the band is ±18%
```

`attack_drone` sits **1.3 points from failing a gate it does not know it is in**.

The four new units were meant to be priced to sit near the fitted curve so the refit barely moves — that turns out to be true of one of them. Actual deviations once fitted: `rocket_battery` +3.0%, `manpad_team` −6.2%, `recoilless_team` −9.1%, `sarim_rifles` **+12.9%**. The roster spread widened, from `[+16.7%, −4.4%]` to **`[+16.9%, −9.1%]`**.

The outcome claim still holds — nothing left the ±18% band, and `attack_drone` moved only from +16.7% to +16.9%, still inside it — but the mechanism claim ("priced to sit near the curve") does not, and should not be repeated as the reason the gate stayed green.

`sarim_rifles` is the outlier, and deliberately so. Repricing it to its on-curve value (301) makes `attack_drone` *worse*, not better — +17.4%, against the shipped +16.9% — so 340 is the safer number for the gate, not merely a convenient one. It is also defensible on its own merits: `defense_score` credits `suppression_resistance` at only `×(1 + res·0.2)` — about 4% of the curve's weight at this unit's resistance value — against a real ~15% reduction in incoming suppression via `suppResFactor = 1 − res/2`. The curve underprices the exact stat that is `sarim_rifles`'s identity, so pricing above the naive fit is a correction, not a fudge. If `attack_drone` breaks in a future refit, that is **surfaced as a finding, not silently fixed** by retuning someone else's unit to make this slice's gate green.

## The sixth §5.7 target (attempted, not shipped)

`pnpm balance` runs five targets today (`atgmPk`, `apsIntercept`, `urbanRatio`, `lanchester`, `airContested`). #15 requires a sixth, and it is not there.

#15 states it as *"an ATGM cell firing from ≥8 tiles wins the cost exchange against an APS-equipped MBT over a three-missile engagement."* **As a one-versus-one that cannot pass**, and the arithmetic says so plainly: one Kornet's three missiles against `mbt_lavi`'s APS (`base_pk` 0.75, and `atgm` is *not* in its `ineffective_vs`) land about 0.75 missiles for ~300 of 3000 HP — while the Lavi's 12-tile gun outranges the cell's 10 and shoots first.

**`standoffExchange()` was written to express it as an equal-spend exchange**, which is what a cost exchange means: roughly four `atgm_cell` (940 logistics) against one `mbt_lavi` (906), opening at ≥8 tiles. Twelve missiles against an APS magazine of three — **saturation was the intended mechanism**, and saturation is the doctrine. It was designed to test the front rather than a single unit's stat line, and to require no shipped unit be retuned. As the next section covers, it did not clear the bar, and it is not part of the shipped gate: `standoffExchange` does not appear anywhere in the repository today.

## What the standoff target measured

`standoffExchange()` was written, wired into `pnpm balance`, and measured twice. Both measurements failed the bar, and it was not committed.

**Stand-up fight** — 4x `atgm_cell` (940 logistics) vs 1x `mbt_lavi` (906), opening at 8 tiles, both sides visible from tick 0 (inside both the Lavi's 12-tile gun range and the Kornet's 10-tile range):

- **23%** of engagements won on cost.
- Mean **2.6 of 4** cells lost.
- The tank died in **7 of 30** engagements (23%) — and in every one of those 7, the cost-win condition also held. There was no case of the tank dying at excess cost; the failure mode is that the tank usually doesn't die at all.

**Concealed ambush** — the doctrinally correct expression: the same 4x `atgm_cell` vs 1x `mbt_lavi`, cells in `ambush` stance and sprung at 10 tiles (the Kornet's full reach), tank starting beyond that radius and advancing in on a plain `move` order rather than starting pre-engaged:

- **13%** of engagements won on cost — *worse* than the stand-up fight, not better.
- Mean **3.5 of 4** cells lost — also worse.

The bar was **≥60%** of engagements won on cost. The win condition was **tank dead AND at most 3 cells lost** — 4 cells lost is 940 logistics spent to destroy 906, a loss on cost however the fight looked on the field. Neither `atgm_cell` nor `mbt_lavi` was retuned at any point across either measurement, and neither the threshold nor the roster (4 cells / 1 tank) was touched.

The ambush version mattered because it is the one the front's own doctrine claims should work — concealed, sprung at the Kornet's full range, exactly the "ambush sprung at ten tiles" stance this document names above as one of the three things that make Sarim's doctrine range-independent. It measured worse, not better — but the conclusion originally drawn from that alone does not hold up.

**Both recorded runs above were fought on bare open ground with no cover at all**, in a front whose entire premise (GDD §2, slice 1) is rock and dead ground. And between the two runs, **three variables changed at once** — stance (visible → ambush), spring range (8 → 10, i.e. effective → maximum), and the tank's behaviour (static at 8 tiles → advancing from 22 tiles onto the cells) — so the 13% cannot be pinned on any one of them, concealment included.

A reviewer reimplemented the harness and decomposed it, 30 seeds each:

```
A  stand-up @8   open     static      won 20%   cells lost 2.90   (the reported 23% / 2.6)
B  ambush   @10  open     advances    won  7%   cells lost 3.80   (the reported 13% / 3.5)
C  ambush   @8   open     advances    won  7%   cells lost 3.67
D  ambush   @10  cover-2  advances    won 23%   cells lost 3.07
E  ambush   @8   cover-2  advances    won 27%   cells lost 2.87
F  stand-up @8   cover-2  static      won 40%   cells lost 0.87
G  stand-up @10  open     static      won  3%   cells lost 3.17
```

(A and B reproduce the two runs recorded above, within seed noise; C–G isolate each variable in turn.)

What this shows, and what supersedes the conclusion originally drawn from A and B alone:

- **Concealment is not what moved the number.** Letting the tank close to contact is what moved it (A→B/C: 20%→7%): the Lavi's coax machine gun, at 420 rounds/min and 60 suppression, suppresses a launcher that fires 3 rounds/min, whether the cells were ever hidden or not.
- **Cover alone doubles the win rate and cuts cell losses by 70%** (A→F: 20%→40%, 2.90→0.87 cells lost). Cover is the front's stated premise, and it was absent from both recorded runs.
- With cover and a sane spring radius, the same exchange runs **27–40%** (E, F) rather than the reported 13%.

So the claim that "concealment plus saturation does not recover the cells' cost efficiency" is not supported by what was actually run — concealment was never isolated in either recorded run, and the variable that clearly hurt the number was letting the tank advance to contact, not concealment. The substantive finding survives regardless: **even at its best measured configuration (F, 40%), the doctrine falls short of the ≥60% bar, so #15's standoff acceptance box stays open — but not for the reason this document previously gave.**

What has **not** been measured, and what slice 3 actually needs before Tel Marum leans on this doctrine, is the exchange **on rock, with the cells at effective range (8, not 10), and the tank held at standoff rather than advancing to contact**. None of those three conditions — the front's actual premise, the cells' actual best range, and a tank that doesn't simply walk up and suppress the launchers — was tested together in any run recorded here.

The target was **not committed**. `.github/workflows/ci.yml:36` and `pages.yml:42` both run `pnpm balance`, so a red target there blocks CI and the Pages deploy for every future change, including work with nothing to do with Sarim. This repository already had one red gate — `pnpm playtest`, failing on `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` — rot unnoticed for two days while the rest of the suite stayed green; a second permanently red gate was judged worse than an honestly open acceptance box. `standoffExchange()` was written and measured, then removed from `targets.ts` and `cli.ts` rather than left wired in but excluded from the results array, which would have been dead code of exactly the kind this project keeps getting bitten by (`hidden_setup`, `tunnel_travel`, `breach`, weapon `magazine`/`reload_s`).

**#15's standoff acceptance box therefore stays open.** The doctrine was tested at the stand-up-fight configuration #15 states literally and at the ambush configuration the front design recommends, and neither configuration as originally run reached the bar — the best configuration found by decomposing those two runs (cover, effective range, static tank) still only reaches 40%. That is the finding this slice produced, not a gap in the work — but the specific mechanism blamed for the shortfall (concealment) is not the one the decomposition points to.

## Verification

- `python3 tools/validate_balance.py --units data/units` at ±18%, with the deviation of every **pre-existing** unit reported, not just pass/fail.
- `pnpm balance`: five targets, all passing. The sixth (`standoffExchange`) was written, measured, and reverted — see "What the standoff target measured," above — so it is not part of the shipped gate.
- `pnpm validate:data` against `unit.schema.json`.
- `pnpm test:determinism` **unmoved** — this slice touches no sim code, so movement is a bug in the work.

## Scope

**In:** four unit JSON files and the docs naming them. The sixth backtest target was attempted — see "What the standoff target measured," above — but not shipped: it failed its bar twice and was reverted rather than committed failing.

**Out, deliberately:**

- **Any engine change.** Including implementing weapon `magazine`/`reload_s`, which stays dead.
- **`hidden_setup` (#9).** Still carried by the `ambush` stance.
- **Retuning `atgm_cell` or any other shipped unit** — unless the curve refit forces it, in which case it is surfaced first.
- **Art.** All four render as procedural boxes, joining `digger_crew` and `yahalom_squad` (#92). This takes the project to six unart'd units, and it compounds a debt already visible elsewhere: `mbt_lavi`'s sprites are a Tiger I stand-in whose 240 MB source cannot be committed at all.
- **Any mission fielding them.** Tel Marum (slice 3) is the first consumer. The roster ships unused, and the backtest target is what proves the doctrine before a map exists — the same reasoning that made slice 1 tests-only.
