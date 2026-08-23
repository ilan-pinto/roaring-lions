# The Sarim roster — design

**Date:** 2026-08-23
**Slice:** 2 of 5 in [the Sur front](./2026-08-22-sur-front-design.md)
**Closes:** [#15](https://github.com/ilan-pinto/roaring-lions/issues/15)
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
| `rocket_battery` | `artillery` | ~20 tiles, `splash_tiles` ~3, `rof_per_min` ~2, slow, fragile, the roster's most expensive | `mortar_team` (18 tiles, splash 1.8, rof 4, 209) and `mortar_crew` (16, 2.0, rof 3, 198) |
| `sarim_rifles` | `infantry` | ~8 tiles, `suppression_resistance` ~0.7, accuracy ~0.68, expensive | `inf_squad` (0.5 / 0.6 / 292) and `militia_cell` (0.4 / 0.5 / 280) |
| `manpad_team` | `aa` | `atgm` missile, `can_target: ["air"]` only, ~13 tiles | `gun_truck` (autocannon, 11 tiles, ground+air, 324) |
| `recoilless_team` | `at_team` | `rpg` type, ~7 tiles, penetration ~650, clearly under the Kornet cell | `rpg_team` (5 tiles, pen 550, 210) and `atgm_cell` (10, 900, 235) |

Three notes on the shapes:

**The battery is the longest weapon in the game** — past `mortar_team`'s 18. That is deliberate and it is the front's signature. It is also fragile and slow, so reaching it is a mission rather than a duel.

**`sarim_rifles` is "best-trained" made mechanical.** Where Ashwar's militia melts under fire, these hold, so ground must be *taken* rather than shocked. Suppression resistance is the stat that says so.

**`manpad_team` carries no ground weapon.** It is helpless against infantry, exactly like `recon_drone` is. That is the doctrine, not an oversight: a Sarim position is a combined-arms problem, and the MANPAD is the piece that must be escorted. The cost curve prices pure specialists correctly — its scoring is additive precisely so that "recon drones, EOD teams and engineers" are not valued at zero.

## What makes them Sarim is not range

Sarim cannot out-range anybody, and this design does not pretend otherwise. The player's own `mortar_team` (18) and `sniper_team` (15) both out-reach the Kornet's 10, and `mbt_lavi`'s gun (12) outranges it too. Doctrine comes from three things instead, two of which already exist:

1. **Ambush sprung at ten tiles** — the existing stance, authored in *mission* data at the Kornet's full reach rather than Ashwar's three.
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

The four new units are therefore priced to sit near the fitted curve so the refit barely moves. If `attack_drone` breaks anyway, that is **surfaced as a finding, not silently fixed** by retuning someone else's unit to make this slice's gate green.

## The sixth §5.7 target

`pnpm balance` runs five targets today (`atgmPk`, `apsIntercept`, `urbanRatio`, `lanchester`, `airContested`). #15 requires a sixth, and it is not there.

#15 states it as *"an ATGM cell firing from ≥8 tiles wins the cost exchange against an APS-equipped MBT over a three-missile engagement."* **As a one-versus-one that cannot pass**, and the arithmetic says so plainly: one Kornet's three missiles against `mbt_lavi`'s APS (`base_pk` 0.75, and `atgm` is *not* in its `ineffective_vs`) land about 0.75 missiles for ~300 of 3000 HP — while the Lavi's 12-tile gun outranges the cell's 10 and shoots first.

**`standoffExchange()` expresses it as an equal-spend exchange**, which is what a cost exchange means: roughly four `atgm_cell` (940 logistics) against one `mbt_lavi` (906), opening at ≥8 tiles. Twelve missiles against an APS magazine of three — **saturation is the mechanism**, and saturation is the doctrine. It tests the front rather than a single unit's stat line, and it requires no shipped unit to be retuned.

## Verification

- `python3 tools/validate_balance.py --units data/units` at ±18%, with the deviation of every **pre-existing** unit reported, not just pass/fail.
- `pnpm balance`: the original five figures **unmoved**, and the sixth passing.
- `pnpm validate:data` against `unit.schema.json`.
- `pnpm test:determinism` **unmoved** — this slice touches no sim code, so movement is a bug in the work.

## Scope

**In:** four unit JSON files, the sixth backtest target, and the docs naming them.

**Out, deliberately:**

- **Any engine change.** Including implementing weapon `magazine`/`reload_s`, which stays dead.
- **`hidden_setup` (#9).** Still carried by the `ambush` stance.
- **Retuning `atgm_cell` or any other shipped unit** — unless the curve refit forces it, in which case it is surfaced first.
- **Art.** All four render as procedural boxes, joining `digger_crew` and `yahalom_squad` (#92). This takes the project to six unart'd units, and it compounds a debt already visible elsewhere: `mbt_lavi`'s sprites are a Tiger I stand-in whose 240 MB source cannot be committed at all.
- **Any mission fielding them.** Tel Marum (slice 3) is the first consumer. The roster ships unused, and the backtest target is what proves the doctrine before a map exists — the same reasoning that made slice 1 tests-only.
