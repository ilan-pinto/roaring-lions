# Fire support: the numbers, before the code (F1 Task 2, G-NUM)

**Date:** 2026-10-14. **Scope:** GH-183 F1, plan `docs/superpowers/plans/2026-10-04-gf1-fire-support-intel.md`,
Task 2. The earn rule (D1, D3, D4, D5) and the four-item menu (D2), measured before any code reads
them. **Base:** branch `feat/gf1-fire-support` at `0f78359d` (main `cd407953`, the garrison overhaul
#606, plus docs and Task 1's economy pin), so every count is on the post-#606 plans (F-R1, F-R13).
**Nothing tracked changed:** every probe ran in a throwaway detached worktree that has been removed;
the probe sources are kept in the session scratchpad (`t2/probe-src/`, with a README to re-run).
Every number below is **(M)** measured unless marked **(R)** reasoned.

## The proposal, in one place

**Provisional: adopted by the F1 controller 14 Oct to unblock Tasks 3-9; awaiting the lead's
confirmation on the PR.** (Ruling C-R1: nothing was posted on #183; this table replaces Step 3's
"the lead answers".)

| term | today | proposed | why |
|---|---|---|---|
| per enemy first identified, with an observer (D3) | 8/min a drone, 5/min a still scout (the trickle) | **10** | unchanged from D1 |
| per objective completed, primary or secondary (D5) | — | **30** (D1 said 25) | 10 + 25 (+30) no longer passes; 30 is the least objective term at which every plain winner that can reach 150 does, with D1's 10 and 30 held (§1.3) |
| per high-ground rise held 10 s (D4) | — | **30** | unchanged from D1 (R); the census does not constrain it (§1.4) |

| item | price | profile (Q16.16 where it is a constant) |
|---|---|---|
| smoke screen | **60** | 3 rounds, `spacingTicks` 40 (2 s), `delayTicks` 80 (4 s), scatter 98304 (1.5 tiles), payload smoke: a `SMOKE_RADIUS` disc at `SMOKE_MAX` per round, no damage, no suppression |
| mortar barrage | **120** | 6 rounds, `spacingTicks` 36 (1.8 s: rounds land 6.0-15.0 s after the call), `delayTicks` 120 (6 s), scatter 98304 (1.5 tiles), damage 7864320 (120), splash 65536 (1.0 tile), suppression 39322 (0.6), `coverProtects` **true** (F-Q13) |
| drone sweep | **150** | today's `reveal`, `SWEEP_RADIUS_SQ` 3932160, same tick |
| air strike | **250** | today's `callStrike`: 600 damage, 2.0-tile splash, 1.2 suppression, 3 s, scatter 0.3, `coverProtects` false |

Prices are D2's starting points, kept: §2 shows what each buys, and none needs a §5.7 target to move.
Two things the R profile left open are filled in above and are mine, flagged for the lead: the smoke
screen's scatter (1.5 tiles, the barrage's own; §2.2 shows it hardly matters) and the reading of "6
rounds over 9 s" / "3 rounds over 4 s" as first-to-last round (spacing 36 and 40 ticks).

**One thing Task 6 must know (M, by arithmetic on `sim.ts`).** Today's scatter draw is
`(rng.nextU32(caller) >>> 16) % (STRIKE_SCATTER + 1)`. A 16-bit draw tops out at 65535, one tile, so
for the barrage's 98304 (1.5 tiles) the same formula silently caps the scatter at 1.0 tile. The
probe drew `rng.nextU32(caller) % (scatter + 1)` for the two new profiles (still two draws a round,
the caller's stream) and left the air strike's formula byte for byte. The radius is uniform, not
area-uniform, so rounds bunch toward the aim point (R): the median round lands 0.75 tiles out.

---

## 1. The earn table (Step 1)

### 1.1 Method

A copy of `run()` (`tools/src/backtest/playtest-run.ts`) in the throwaway worktree, with read-only
hooks after `rt.step(evs)`; the plans, seeds and ledgers are the harness's own, and every printed
`pnpm playtest` line came out identical to the base (diffed). From what the sim and runtime already
emit, per run, it records:

- **identified:** a `contact` event with `side` 0, `level` `identified`, a side-1 `target` and
  `observer >= 0`, the first such event per enemy entity (D3). `observer: -1` (a `reveal`, a
  pre-marked carry-over spawn) never pays. A later real-observer identification of an enemy first
  seen at `-1` **is** paid here (Task 3 is to decide that case in a test); the count is shown below
  so the decision can be priced. Whether the observer stood in a building at that tick is its own
  column (F-Q14: paid).
- **objectives:** every `objective` mission event with status `complete`, primary or secondary,
  never a failure (D5).
- **rises (D4):** open tiles (`sim.blocked === 0`) at or above the map's median open-tile level
  + 2, 4-connected (median = the LOWER median of the open tiles' levels on an even count, `sorted[(n - 1) >> 1]`, as Task 4's `medianOpenLevel` is specified). The census was first taken with the upper median and re-run with the lower one (fix round 1): on every economy map the median, the rise count and every paid rise in all 1,856 runs are identical, so the counts below are valid for Tasks 4 and 5. A rise pays once, on the
  200th consecutive tick (10 s) that at least one qualifying side-0 unit stands on it; the counter
  resets on any tick with none. Qualifying: alive, `garrisonedIn < 0`, `carriedBy < 0`,
  `tunnelIn < 0`, not `isAir`, no living side-1 unit outside a tunnel within `CONTEST_RADIUS_SQ` (6 tiles)
  of it (air units included, as the runtime's own `contestedIn` counts them; no control earned a
  rise either way, so the choice moves no number here), and not standing on the rise it was first seen on (a unit seen first on a rise is cleared
  for it once it stands anywhere else: the 6 Oct spawn ruling). Units built or spawned later are
  first seen the tick after they appear.

Totals are priced offline from the event ticks, so any row can be read at any tick.

**Denominators (counted on the base).** `plan-sweep.ts` holds **36 winning plans**: 26 whose label is
the mission id ("plain") plus 10 probes: `(gate open)` ×6 (WH IV, WH V, KR III, DA II, QH III,
UZ III), `(bought)` ×3 (KR III, BS IV, UZ IV) and `(price-only closed)` ×1 (KR III). `passive-sweep.ts` holds **25 controls** (23 `defeat`, 2 `withdrawn`:
`beit_sahwan_1_recon` and `beit_sahwan_3_clearance`). Each ran on the 30 `SWEEP_SEEDS` (424242,
1..29): 1,080 winning runs and 750 control runs; the 26 max-tier replays are excluded. **25 pairs**
(`beit_sahwan_2_foothold` has no control). **Seed handling:** pass/fail is read on the **424242
ledger seed**, as Task 9's `INTEL_*` gates and `LADDER_CREDITS` read it (#542); the 30-seed median,
minimum and count sit beside every number.

### 1.2 Per winning plan

Columns: counts on 424242; the total under the old row and the proposed one; when the 150th earned
point arrives (`intel_start` excluded; the two missions that grant one are marked, and can afford a
sweep from t = 0 anyway); the victory tick; the mission's `time_limit_s`; then 30 seeds.

| winning plan | identified (by a garrison) | objectives | rises | 10/25/30 | **10/30/30** | 150th point at 10/30/30, s | victory, s | `time_limit_s` | 30 seeds: median / min (10/30/30) | seeds ≥ 150 | median 150th at 10/30/30, s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `beit_sahwan_breach` | 34 (0) | 2 | 0 | 390 | **400** | 133 | 300 | 600 | 380 / 350 | 30/30 | 134 |
| `beit_sahwan_1_recon` | 6 (0) | 3 | 0 | 135 | **150** | 31 | 31 | 840 | 150 / 150 | 30/30 | 31 |
| `beit_sahwan_2_foothold` | 9 (0) | 1 | 0 | 115 | **120** | — | 310 | 840 | 120 / 120 | 0/30 | — |
| `beit_sahwan_3_clearance` | 10 (0) | 3 | 0 | 175 | **190** | 98 | 107 | 840 | 190 / 190 | 30/30 | 98 |
| `wadi_halam_1_fords` | 14 (0) | 4 | 0 | 240 | **260** | 182 | 276 | 720 | 260 / 250 | 30/30 | 182 |
| `wadi_halam_2_laager` | 30 (0) | 3 | 4 | 495 | **510** | 79 | 403 | 840 | 510 / 450 | 30/30 | 82 |
| `wadi_halam_3_counterraid` | 15 (0) | 4 | 0 | 250 | **270** | 55 | 322 | 720 | 270 / 270 | 30/30 | 55 |
| `wadi_halam_4_village` | 7 (0) | 3 | 1 | 175 | **190** | 218 | 239 | 840 | 190 / 190 | 30/30 | 206 |
| `wadi_halam_4_village (gate open)` | 7 (0) | 3 | 1 | 175 | **190** | 218 | 239 | 840 | 190 / 190 | 30/30 | 206 |
| `wadi_halam_5_depot` | 24 (0) | 4 | 1 | 370 | **390** | 80 | 322 | 840 | 390 / 340 | 30/30 | 77 |
| `wadi_halam_5_depot (gate open)` | 24 (0) | 4 | 1 | 370 | **390** | 85 | 323 | 840 | 390 / 370 | 30/30 | 78 |
| `beit_sahwan_4_subterranean` | 14 (0) | 5 | 0 | 265 | **290** | 96 | 374 | 720 | 270 / 270 | 30/30 | 96 |
| `khan_rafid_1_recon` | 8 (0) | 5 | 0 | 205 | **230** | 22 | 30 | 720 | 230 / 230 | 30/30 | 22 |
| `khan_rafid_2_foothold` | 13 (0) | 2 | 1 | 210 | **220** | 139 | 266 | 840 | 220 / 210 | 30/30 | 139 |
| `khan_rafid_3_clearance` | 9 (0) | 3 | 0 | 165 | **180** | 128 | 143 | 840 | 190 / 180 | 30/30 | 124 |
| `khan_rafid_3_clearance (gate open)` | 9 (0) | 3 | 0 | 165 | **180** | 133 | 148 | 840 | 190 / 160 | 30/30 | 130 |
| `khan_rafid_3_clearance (bought)` | 9 (0) | 3 | 0 | 165 | **180** | 133 | 148 | 840 | 190 / 160 | 30/30 | 130 |
| `khan_rafid_3_clearance (price-only closed)` | 9 (0) | 3 | 0 | 165 | **180** | 128 | 143 | 840 | 190 / 180 | 30/30 | 124 |
| `deir_amun_1_recon` | 8 (0) | 4 | 0 | 180 | **200** | 52 | 53 | 720 | 200 / 200 | 30/30 | 52 |
| `deir_amun_2_foothold` | 12 (0) | 2 | 1 | 200 | **210** | 273 | 373 | 840 | 210 / 170 | 30/30 | 288 |
| `deir_amun_2_foothold (gate open)` | 12 (0) | 2 | 1 | 200 | **210** | 288 | 375 | 840 | 210 / 170 | 30/30 | 288 |
| `deir_amun_3_subterranean` | 17 (0) | 2 | 0 | 220 | **230** | 46 | 93 | 840 | 230 / 210 | 30/30 | 48 |
| `tel_marum_1_recon` | 6 (0) | 5 | 0 | 185 | **210** | 46 | 67 | 840 | 210 / 210 | 30/30 | 46 |
| `tel_marum_2_foothold` | 8 (0) | 3 | 1 | 185 | **200** | 153 | 251 | 720 | 200 / 200 | 30/30 | 153 |
| `tel_marum_3_clearance` | 7 (0) | 3 | 0 | 145 | **160** | 141 | 141 | 840 | 160 / 160 | 30/30 | 141 |
| `qarn_hadid_1_recon` | 6 (0) | 6 | 1 | 240 | **270** | 14 | 76 | 720 | 270 / 270 | 30/30 | 14 |
| `qarn_hadid_2_foothold` | 6 (0) | 4 | 1 | 190 | **210** | 154 | 202 | 840 | 210 / 180 | 30/30 | 154 |
| `qarn_hadid_3_clearance` | 10 (0) | 4 | 2 | 260 | **280** | 129 | 203 | 840 | 250 / 210 | 30/30 | 171 |
| `qarn_hadid_3_clearance (gate open)` | 10 (0) | 3 | 2 | 235 | **250** | 173 | 203 | 840 | 270 / 220 | 30/30 | 144 |
| `umm_zeitoun_1_recon` | 7 (0) | 6 | 1 | 250 | **280** | 35 | 172 | 720 | 280 / 250 | 30/30 | 35 |
| `umm_zeitoun_2_buildup` (+150 `intel_start`) | 5 (0) | 4 | 2 | 210 | **230** | 49 | 312 | 840 | 230 / 230 | 30/30 | 47 |
| `umm_zeitoun_3_clearance` | 9 (0) | 5 | 2 | 275 | **300** | 27 | 63 | 840 | 310 / 250 | 30/30 | 30 |
| `umm_zeitoun_3_clearance (gate open)` | 9 (0) | 5 | 2 | 275 | **300** | 27 | 63 | 840 | 310 / 250 | 30/30 | 30 |
| `umm_zeitoun_4_clearance` (+250 `intel_start`) | 18 (0) | 4 | 2 | 340 | **360** | 107 | 220 | 840 | 350 / 320 | 30/30 | 117 |
| `beit_sahwan_4_subterranean (bought)` | 14 (0) | 5 | 0 | 265 | **290** | 96 | 172 | 720 | 285 / 270 | 30/30 | 96 |
| `umm_zeitoun_4_clearance (bought)` (+250 `intel_start`) | 18 (0) | 4 | 2 | 340 | **360** | 87 | 211 | 840 | 360 / 300 | 30/30 | 111 |

Read across it:

- **35 of 36 winning plans reach 150 on all 30 seeds** at 10/30/30; the one that never does is
  `beit_sahwan_2_foothold` (9 identified, 1 objective: 120). It completes one primary and leaves its
  `collapse_tunnel` secondary, so it cannot reach 150 below 15 per identification.
- **When it arrives.** The earliest with no grant: `qarn_hadid_1_recon` 14 s (victory 76),
  `khan_rafid_1_recon` 22 s (30), `umm_zeitoun_3_clearance` 27 s (63), `umm_zeitoun_1_recon` 35 s
  (172), `deir_amun_3_subterranean` and `tel_marum_1_recon` 46 s. **Five plans earn the 150th point at
  or within 10 s of their own victory banner** and so buy nothing with it: `beit_sahwan_1_recon`
  (31/31), `beit_sahwan_3_clearance` (98/107), `khan_rafid_1_recon` (22/30), `deir_amun_1_recon`
  (52/53) and `tel_marum_3_clearance` (141/141). This is the G3 sheet's warning, now measured: on
  those five the last objective is the point that pays. Every plan's 150th point arrives far inside
  its `time_limit_s` (the latest is `deir_amun_2_foothold (gate open)`, 288 s against 840).
- **Garrison identifications (F-Q14): 0 in every run.** No `starting_force` places a side-0 unit in a
  building and no plan orders `garrison`, so the column the ruling keeps is empty today. Task 9's
  passive gate has nothing of this kind to bite on until a mission or plan garrisons a player unit.
- **Identified after a sweep or a pre-mark** (first seen at `observer: -1`, paid at a later real
  sighting), on 424242: `beit_sahwan_3_clearance` 3, `umm_zeitoun_3_clearance` 3,
  `umm_zeitoun_4_clearance` 3, `wadi_halam_3_counterraid` 2, `beit_sahwan_4_subterranean` 2,
  `qarn_hadid_3_clearance` 1. If Task 3 decides they do not pay, 10/30/30 still gives 25 of 26 plain
  winners a sweep (35 of 36); 10/25/30 would drop to 22 of 26.

### 1.3 Controls, pairs, and the row

| control | identified (by a garrison) | objectives | rises | 10/25/30 | **10/30/30** | end, s | how it ended | 30 seeds: max (10/30/30) | seeds ≥ 150 |
|---|---|---|---|---|---|---|---|---|---|
| `beit_sahwan_breach (passive control)` | 34 (0) | 0 | 0 | 340 | **340** | 270 | objective:evac_settlements | 340 | 30/30 |
| `beit_sahwan_1_recon (no orders)` | 3 (0) | 0 | 0 | 30 | **30** | 840 | withdrawn | 30 | 0/30 |
| `beit_sahwan_3_clearance (no orders)` | 1 (0) | 0 | 0 | 10 | **10** | 840 | withdrawn | 10 | 0/30 |
| `wadi_halam_1_fords (no orders)` | 13 (0) | 2 | 0 | 180 | **190** | 300 | objective:get_the_carriers_out | 190 | 30/30 |
| `wadi_halam_2_laager (no orders)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:burn_store | 0 | 0/30 |
| `wadi_halam_3_counterraid (no orders)` | 0 (0) | 1 | 0 | 25 | **30** | 300 | objective:get_the_herders_out | 30 | 0/30 |
| `wadi_halam_4_village (no orders)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:evac_families | 0 | 0/30 |
| `wadi_halam_5_depot (no orders)` | 0 (0) | 1 | 0 | 25 | **30** | 300 | objective:raze_depot | 30 | 0/30 |
| `beit_sahwan_4_subterranean (no orders)` | 5 (0) | 0 | 0 | 50 | **50** | 240 | objective:get_them_out | 50 | 0/30 |
| `khan_rafid_1_recon (passive control)` | 0 (0) | 0 | 0 | 0 | **0** | 240 | objective:get_two_in | 0 | 0/30 |
| `khan_rafid_2_foothold (passive control)` | 3 (0) | 0 | 0 | 30 | **30** | 300 | objective:get_four_in | 30 | 0/30 |
| `khan_rafid_3_clearance (passive control)` | 1 (0) | 0 | 0 | 10 | **10** | 300 | objective:get_six_in | 10 | 0/30 |
| `deir_amun_1_recon (passive control)` | 0 (0) | 0 | 0 | 0 | **0** | 240 | objective:bring_down_the_west | 0 | 0/30 |
| `deir_amun_2_foothold (passive control)` | 3 (0) | 0 | 0 | 30 | **30** | 240 | objective:shut_the_door | 30 | 0/30 |
| `deir_amun_3_subterranean (passive control)` | 0 (0) | 1 | 0 | 25 | **30** | 300 | objective:all_four | 30 | 0/30 |
| `tel_marum_1_recon (passive control)` | 3 (0) | 1 | 0 | 55 | **60** | 300 | objective:clear_the_valley_floor | 60 | 0/30 |
| `tel_marum_2_foothold (passive control)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:burn_the_ammo_point | 0 | 0/30 |
| `tel_marum_3_clearance (passive control)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:get_the_block_out | 0 | 0/30 |
| `qarn_hadid_1_recon (passive control)` | 0 (0) | 0 | 0 | 0 | **0** | 240 | objective:get_the_road_party_clear | 0 | 0/30 |
| `qarn_hadid_2_foothold (passive control)` | 2 (0) | 0 | 0 | 20 | **20** | 300 | objective:open_the_shoulder | 20 | 0/30 |
| `qarn_hadid_3_clearance (passive control)` | 3 (0) | 0 | 0 | 30 | **30** | 300 | objective:get_the_families_clear | 30 | 0/30 |
| `umm_zeitoun_1_recon (no orders)` | 0 (0) | 1 | 0 | 25 | **30** | 240 | objective:get_the_wells_clear | 30 | 0/30 |
| `umm_zeitoun_2_buildup (no orders)` | 4 (0) | 0 | 0 | 40 | **40** | 300 | objective:level_the_stone_post | 40 | 0/30 |
| `umm_zeitoun_3_clearance (no orders)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:get_the_hamlet_out | 0 | 0/30 |
| `umm_zeitoun_4_clearance (no orders)` | 0 (0) | 0 | 0 | 0 | **0** | 300 | objective:raze_the_stockpile | 0 | 0/30 |

Pairs (F-Q12, ruled 14 Oct: compared at the earlier of the two end ticks):

| pair | compared at, s | winner / passive at that tick (10/30/30) | end totals winner / passive | seeds of 30 where passive > winner (10/25/30, 10/30/30) |
|---|---|---|---|---|
| `beit_sahwan_breach` | 270 | 370 / 340 | 400 / 340 | 16, 16 |
| `beit_sahwan_1_recon` | 31 | 150 / 20 | 150 / 30 | 0, 0 |
| `beit_sahwan_3_clearance` | 107 | 190 / 10 | 190 / 10 | 0, 0 |
| `wadi_halam_1_fords` | 276 | 260 / 170 | 260 / 190 | 0, 0 |
| `wadi_halam_2_laager` | 300 | 400 / 0 | 510 / 0 | 0, 0 |
| `wadi_halam_3_counterraid` | 300 | 230 / 30 | 270 / 30 | 0, 0 |
| `wadi_halam_4_village` | 239 | 190 / 0 | 190 / 0 | 0, 0 |
| `wadi_halam_5_depot` | 300 | 340 / 30 | 390 / 30 | 0, 0 |
| `beit_sahwan_4_subterranean` | 240 | 260 / 50 | 290 / 50 | 0, 0 |
| `khan_rafid_1_recon` | 30 | 230 / 0 | 230 / 0 | 0, 0 |
| `khan_rafid_2_foothold` | 266 | 220 / 30 | 220 / 30 | 0, 0 |
| `khan_rafid_3_clearance` | 143 | 180 / 0 | 180 / 10 | 0, 0 |
| `deir_amun_1_recon` | 53 | 200 / 0 | 200 / 0 | 0, 0 |
| `deir_amun_2_foothold` | 240 | 120 / 30 | 210 / 30 | 0, 0 |
| `deir_amun_3_subterranean` | 93 | 230 / 0 | 230 / 30 | 0, 0 |
| `tel_marum_1_recon` | 67 | 210 / 0 | 210 / 60 | 0, 0 |
| `tel_marum_2_foothold` | 251 | 200 / 0 | 200 / 0 | 0, 0 |
| `tel_marum_3_clearance` | 141 | 160 / 0 | 160 / 0 | 0, 0 |
| `qarn_hadid_1_recon` | 76 | 270 / 0 | 270 / 0 | 0, 0 |
| `qarn_hadid_2_foothold` | 202 | 210 / 20 | 210 / 20 | 0, 0 |
| `qarn_hadid_3_clearance` | 203 | 280 / 20 | 280 / 30 | 0, 0 |
| `umm_zeitoun_1_recon` | 172 | 280 / 0 | 280 / 30 | 0, 0 |
| `umm_zeitoun_2_buildup` | 300 | 200 / 40 | 230 / 40 | 0, 0 |
| `umm_zeitoun_3_clearance` | 63 | 300 / 0 | 300 / 0 | 0, 0 |
| `umm_zeitoun_4_clearance` | 220 | 360 / 0 | 360 / 0 | 0, 0 |

Candidate rows, all on the same 1,830 runs (the last column is the cost measure used below):

| row (identified / objective / rise) | plain winners ≥ 150 (of 26) | all winners ≥ 150 (of 36) | controls ≥ 150 (of 25) | pairs passive > winner, 424242 (of 25) | seed-pairs passive > winner (of 750) | of which `beit_sahwan_breach` (of 30) | intel paid to the 26 plain winners, 424242 |
|---|---|---|---|---|---|---|---|
| 10 / 25 / 30 | 23 | 33 | 2 | 0 | 16 | 16 | 6070 |
| 10 / 25 / 0 | 22 | 31 | 2 | 0 | 16 | 16 | 5470 |
| 12 / 25 / 30 | 24 | 34 | 2 | 0 | 16 | 16 | 6694 |
| 10 / 30 / 0 | 25 | 35 | 2 | 0 | 16 | 16 | 5940 |
| 10 / 30 / 20 | 25 | 35 | 2 | 0 | 16 | 16 | 6340 |
| 10 / 30 / 30 | 25 | 35 | 2 | 0 | 16 | 16 | 6540 |
| 10 / 35 / 30 | 25 | 35 | 2 | 0 | 16 | 16 | 7010 |
| 10 / 40 / 30 | 25 | 35 | 2 | 0 | 12 | 12 | 7480 |
| 15 / 25 / 30 | 26 | 36 | 2 | 0 | 19 | 19 | 7630 |
| 15 / 30 / 30 | 26 | 36 | 2 | 0 | 16 | 16 | 8100 |
| 8 / 35 / 30 | 25 | 35 | 2 | 0 | 12 | 12 | 6386 |
| 8 / 40 / 30 | 25 | 35 | 2 | 0 | 1 | 1 | 6856 |
| 8 / 50 / 30 | 25 | 35 | 2 | 0 | 0 | 0 | 7796 |

**The criterion (controller ruling C-R4, 14 Oct), stated once and used throughout:** every plain
winning plan that can reach 150 does (25 of 26; `beit_sahwan_2_foothold` cannot below 15 per
identification), with the identification term held at D1's 10 and the rise term at D1's 30, at the
least total paid; and no pair in which the passive control out-earns the winner at the earlier end
tick, judged on the 424242 ledger seed, as Task 9's `INTEL_PASSIVE_BEATS_WINNER` runs it (F-Q12).
Passive controls at or over 150 are reported, not gated (below). The G3 sheet's bar was 24 of 26
"nearly every"; this one is stricter, and it is the controller's.

**10 / 30 / 30 is the row that meets it.** With 10 and 30 held, the objective term must be at least
30: `beit_sahwan_1_recon` (6 identified, 3 objectives) needs 30 and `tel_marum_3_clearance` (7, 3)
needs 27, so 30 is the least integer that lets both through. It gives 25 of 26 plain winners a sweep
(35 of 36 with the probes), 0 of 25 pairs on 424242, and pays the 26 plain winners 6,540 on 424242.

**The candidates, and why each is not proposed:**

| row | what it does | why not proposed |
|---|---|---|
| 10 / 25 / 30 (D1) | 23 of 26; 0 pairs | `beit_sahwan_1_recon` (135) and `tel_marum_3_clearance` (145) can reach 150 and do not; neither holds a rise, so the rise term cannot help |
| 12 / 25 / 30 | 24 of 26 (G3's own bar); 0 pairs; 6,694 | dearer than 10/30/30 and leaves `beit_sahwan_1_recon` (147) short; moves the identification term off D1's 10 |
| 10 / 30 / 20 | 25 of 26; 0 pairs; 6,340 | cheaper only by paying the rise less; D1's 30 is held because the census cannot price it (§1.4: no plan short of 150 holds a rise, no control earns one) |
| 10 / 30 / 0 | 25 of 26; 0 pairs; 5,940 | deletes the high-ground term the lead ruled in (D4 stands, 6 Oct) |
| 8 / 35 / 30 | 25 of 26; 0 pairs; 6,386 | cheaper in total, by paying spotting less; moves D1's identification term; breach still 12 of 30 |
| **8 / 40 / 30** | 25 of 26; 0 pairs; 6,856; **breach 1 of 30 seeds** | **the seed-robust alternative, for the lead**: 316 more than 10/30/30 (+4.8%), pays spotting 20% less and objectives a third more; on 424242 it pays `beit_sahwan_1_recon` 168 |
| 8 / 50 / 30 | 25 of 26; 0 pairs; 7,796; breach 0 of 30 | the only row in this table at 0 of 750 seed-pairs (5/40/30, below, is the other); 19% dearer than 10/30/30 |

One thing the lead should see: if "least total paid" were the whole criterion, with no term held,
it would push the identification term down, not the objective term up. Searching every integer row
with the rise at 30 (identification 5-15, objective 20-60), the cheapest that gives 25 of 26 with 0
pairs is **5 / 40 / 30** (5,920 on 424242), and it is also seed-robust (breach 0 of 30). Spotting
would then pay half of D1. That is a design choice about what "earned by doing" rewards, not a
measurement, so it is listed and not proposed.

**Step 4: `khan_rafid_3_clearance`'s passive control reads 10, not 0, on all 30 seeds.** Cause: one
`moto_rpg`, a side-1 attack-mover, rides into the sight of the parked `recon_drone` at 267 s and is
identified (`observer` the drone). The mission is flat (no rise term) and no objective completes.
That is exactly the 6 Oct note's case, "an enemy walking into a passive force's sight pays 10", and
it is not the trickle: on the old trickle this control earned 189 (M at `751b6742`). Under the
14 Oct ruling it does not fail the row: compared at the winner's victory tick (143 s) the passive
force has **0** against the winner's 180, and its end total is 10. Stated plainly so the lead can
overrule it: the earn rule does pay a passive force for enemies that come to it, and on this mission
that is worth 10.

**Two seed-level facts the 424242 gate cannot see.**

- **`beit_sahwan_breach`: the passive control out-earns the winner on 16 of 30 seeds** under
  10/30/30. At 270 s (the control's own defeat) it has identified all 34 attackers (340); the
  winning plan, whose jeep and APC are out fetching families, has identified 28-30 and completed one
  objective (310-330). On 424242 the winner leads 370 to 340, a margin of 30, so
  `INTEL_PASSIVE_BEATS_WINNER` passes there. The count by row (table above): **16 of 30** at 10/25/30,
  10/25/0, 12/25/30, 10/30/0, 10/30/20, 10/30/30, 10/35/30 and 15/30/30; 19 at 15/25/30; 12 at
  10/40/30 and 8/35/30; **1 at 8/40/30**; 0 at 8/50/30 and 5/40/30. Every seed-pair in the 750 that
  goes the passive force's way is a breach pair. This is the G3 sheet's breach outlier ("the enemy
  walks into the compound; that is correct for a breach"), but under the proposed row it is a
  majority of seeds, so I recommend Task 9 print the seed count beside the 424242 line.
- **`wadi_halam_1_fords` (no orders) earns 190 on all 30 seeds**: its parked `recon_drone`
  identifies 13 enemies (11 `moto_rpg`) riding past, and two objectives complete with no orders,
  `picture` at 120 s and the `screen_out` secondary at 200 s. A passive force can afford a sweep
  there. It never out-earns the winner (170 vs 260 at 276 s). This is mission content
  (`mission-author`), not the earn rule: a `locate`/`screen_out` pair that completes for a player who
  does nothing.

Also content, for `mission-author`: `wadi_halam_3_counterraid`'s `mark_hides` secondary completes on
**tick 0** for both arms, so it pays 30 for nothing; and every `screen_out` secondary (DA III,
TM I, UZ I, WH V's `no_bleed`) completes passively at its clock, which is why several controls read
30 with no identification at all.

### 1.4 The rise term

- 18 of the 26 missions' maps carry at least one rise under D4's rule (1-18 a map, 107 in all); 8
  carry none: the breach, Beit Sahwan I-IV, Wadi Halam I, Khan Rafid I and III (BS II and IV are on
  relief, median level 2, but nothing open stands two above it).
- **Plain winners were paid for 1-4 rises on 13 of 26 plans**, earliest 12 s (UZ III), mostly
  20-100 s; payees are infantry, `at_team` and also vehicles (`apc_eitan`, `mbt_lavi`,
  `jeep_shoded`), since D4 pays any non-air surface unit.
- **Passive controls: 0 rises paid in all 750 runs.** The spawn ruling holds on every map.
- 25 of the 107 components are a single tile (QH II: 12 of its 18). A unit standing on a
  one-tile pimple for 10 s is paid like one holding a ridge. Task 4 may want a minimum size; it does
  not change any row above (R: removing them can only lower winners' totals, and no failing plan
  holds a rise).
- No plan short of 150 holds a rise and no control earns one, so the census cannot tell 20 from 30
  from 40. 30 stays as D1's reasoned value.

---

## 2. The menu table (Step 2)

### 2.1 What each item is

| item | price | call to first impact | footprint | damage | suppression | ROE exposure (R) | the counter it answers |
|---|---|---|---|---|---|---|---|
| smoke screen | 60 | 4 s; rounds at 4, 6, 8 s | three `SMOKE_RADIUS` (3-tile) discs, each up to 1.5 tiles off the aim point; each lasts ~13 s from its own landing | 0 | 0 (it blinds; `SMOKE_BLOCKS_AT`, `SMOKE_HIT_MULT`) | none: no damage. It can walk a focused unit (T-D3) and does not blind an upper floor that sees over the plume (Task 7 pins it) | a defender with sight lines: an overwatch, an ATGM post, a rifle line behind a street |
| mortar barrage | 120 | 6 s; rounds at 6.0-15.0 s | 6 rounds, each scattered up to 1.5 tiles and splashing 1.0 tile: danger to 2.5 tiles from the aim point | 120 a round at the centre, linear falloff; structures take 240 a round within 1 tile of a tile centre (`damage × 2`, no falloff, as the strike) | 0.6 a round at the centre, falloff, **through cover and `garrison_cover`** (F-Q13) | wide: 2.5 tiles of uncertainty means a clinic or a family inside that is a decision. Charged through `by` (the caller), and nothing on a `raze` target (#431) | a defended building, or ground to deny: levels a house (and its garrison) in one call |
| drone sweep | 150 | same tick | 7.7-tile radius | 0 | 0 | none | not knowing where they are; identifies with `observer: -1` and so pays no intel (D3) |
| air strike | 250 | 3 s | 0.3-tile scatter, 2.0-tile splash: 2.3 tiles | 600 at the centre, falloff; structures 1,200 | 1.2 at the centre, falloff, **ignoring cover** | 2.3 tiles of a 600-point bomb: heavy ordnance near people | a point target that must die now: a gun, a vehicle, the man in the window |

### 2.2 What each price buys on `urbanAssault`

A scratch copy of `targets.ts`'s `urbanAssault` (same town, same six `militia_cell` defenders in the
cover-2 ring, same three-group clearing plan, the gate's seeds 60000 + ratio·1000 + s, s < 60, base
roster). `pnpm balance` was not re-run for this doc (nothing tracked changed); the comparison is
with `scratchpad/s4-f1/balance-base.txt`, printed at `da74f887`, whose sim is the same: "win rates by
attacker:defender — 1:1=0% 2:1=22% 3:1=100% 4:1=100%" and "1:1=0% 2:1=98% · 3.00 screens/run". The
probe's no-support arm reads the same four numbers and its laid-smoke arm the same two. Why base
2:1 reads 22% where the plan's 6 Oct note had 37%: cause not established by bisect. The first
commit that records 22% is #584 (`d7bb5f1d`, 14 Oct: hit, bounce and splash suppression now apply,
`SUPP_STAT_DIVISOR` 730), and #537's message says `pnpm balance` stayed byte-identical, so #584 is
the likely cause (R). A support call is placed on a group's block front (the same
`URBAN_FRONTS` the smoke gate screens) the first moment that group's lead squad is within 9 tiles of
it, the smoke gate's own trigger; the caller is the group's first living squad. "Middle" is the
centre block's front.

| arm (intel) | 1:1 | 2:1 | 3:1 | 4:1 | support damage to defenders / run (2:1) | defenders killed by support / run (2:1) | suppression it added to defenders / run (2:1) | support damage to attackers / run (4:1) |
|---|---|---|---|---|---|---|---|---|
| none (0) | 0% | 22% | 100% | 100% | — | — | — | — |
| laid smoke ×3, carrier (`urbanSmokeStep`, free) | 0% | 98% | 100% | 100% | — | — | — | — |
| **smoke screen ×1, middle (60)** | 0% | **97%** | 100% | 100% | 0 | 0 | 0 | 0 |
| smoke screen ×2, north + south (120) | 15% | 97% | 100% | 100% | 0 | 0 | 0 | 0 |
| smoke screen ×3 (180) | 20% | 100% | 100% | 100% | 0 | 0 | 0 | 0 |
| **mortar barrage ×1, middle (120)** | 0% | **33%** | 100% | 100% | 248 | 0.17 | 0.14 | 0 |
| mortar barrage ×3 (360) | 0% | 98% | 100% | 100% | 610 | 0.55 | 0.35 | 0.15 |
| mortar barrage ×3, called at 14 tiles (360) | 5% | 98% | 100% | 100% | 633 | 0.42 | 0.35 | 0 |
| **air strike ×1, middle (250)** | 0% | **100%** | 100% | 100% | 357 | 1.00 | 0.89 | 0 |
| air strike ×3 (750) | **97%** | 100% | 100% | 100% | 1,042 | 3.00 | 2.50 | 0 |

Smoke with no scatter (all three rounds on the aim point, one disc refreshed for 4 s): ×1 middle
0% / 95% / 100% / 100%, ×3 10% / 100% / 100% / 100%. The scatter value is not what makes the smoke
screen strong.

**Read as the lead's ratio steps:**

- **The smoke screen buys one step, and only one.** One call (60) carries 2:1 to 97%; three calls
  (180) leave 1:1 at 20%, inside the smoke-step gate's own "1:1 + smoke ≤ 25%" clause (lead ruling
  D1, 29 Sep). It is the same step the free, carried ability buys; what the 60 pays for is no
  carrier. Per point it is the strongest item on the menu by far (one step for 60 against 250 for
  the strike), and that is the one price I would ask the lead to look at. I have not changed it:
  the step it buys is exactly the step the lead ruled smoke may buy.
- **One barrage call moves 2:1 by 11 points (22% to 33%); three calls (360) buy the full step**
  (98%) while leaving 1:1 at 0-5%: doctrine intact. Most of what it does here is damage spread over the block (about 40 a
  round to defenders), not kills (0.17 a call) and not suppression, because the defenders sit in
  cover 2 and the barrage honours cover.
- **The strike buys a step per call** (it kills the one defender on the middle front, 1.00 a call),
  and three strikes (750) carry an even fight, 1:1 at 97%: two steps past §5.7's "1:1 fails". No
  winning plan earns 750 (the most is 510, WH II); a strike is 250 and stays 250 (D2).

**A barrage built like the unit mortar's round overbuys.** The same probe with each barrage round at
`mortar_60`'s 180 damage and 1.8-tile splash (suppression unchanged): ×1 2:1 **92%**, ×3 1:1 **78%**,
and 19 points of its own damage on the attackers at 4:1. That is two steps for 360, and it breaks
"1:1 fails". The R profile's 120 / 1.0 tile is the defensible one.

### 2.3 One call, one target: the barrage's 0.6 against a `mortar_team` round today (#584)

Per call (or per `mortar_team` round), 200 seeds, one rifle team at the aim point; caller far away.

| target, where | item | rounds | damage | killed | peak suppression | seconds pinned (≥ 0.70, alive) | suppression delivered |
|---|---|---|---|---|---|---|---|
| `militia_cell`, open | air strike | 1 | 360 (all) | 1.00 | — | — | — |
| | barrage | 6 | 232 | 0.12 | **0.647** | 0.47 | 1.24 |
| | `mortar_team`, 60 s of its own fire | 2 | 166 | 0 | 0.29 | 0 | 0.49 (0.25 a round) |
| `militia_cell`, cover 2 | barrage | 6 | 232 | 0.12 | **0.088** | 0 | 0.16 |
| | barrage, cover ignored | 6 | 232 | 0.12 | 0.647 | 0.47 | 1.24 |
| | `mortar_team` | 2 | 123 | 0 | 0.042 | 0 | 0.07 |
| `sarim_rifles`, open | barrage | 6 | 234 | 0.04 | 0.518 | 0.12 | 0.85 |
| | `mortar_team` | 1 | 94 | 0 | 0.197 | 0 | 0.20 |
| `sarim_rifles`, cover 2 | barrage | 6 | 234 | 0.04 | 0.071 | 0 | 0.11 |

From the code (R, `sim.ts` `groundImpact`/`splashAt`, `SUPP_STAT_DIVISOR` 730, `BOUNCE_SUPP_MULT` 2):
a `mortar_60` round puts 0.12 on everyone within 1.1 tiles (near miss) **plus** 0.25 on everyone
within 1.8 tiles (splash, no falloff), so 0.37 at the centre and 0.25 out to 1.8 tiles; a barrage
round puts 0.6 at the centre falling to 0 at 1.0 tile. Integrated over area, one `mortar_60` round
is about 2.97 suppression·tile², one barrage round 0.63, the whole six-round barrage 3.8: **the
barrage is about 1.3 mortar-team rounds of suppression and about 1.2 of damage, delivered as a
sharper peak** (0.6 against 0.37) over a wider uncertainty. It still never pins a man on its own
in cover (peak 0.09) and rarely in the open (0.65 against `PIN_AT` 0.70; rounds 1.8 s apart decay
24% between them).

Against the strike, per intel point, over area (R, same integrals): damage 6.3 per point against
10.1, suppression 0.031 against 0.020. **The design claim ("less damage per point than the strike,
more suppression per point") holds on open ground and inverts in cover**, where the barrage is
muffled to 13.75% (cover 2) or 9% (`garrison_cover` 3) and the strike is not muffled at all. That
is the 14 Oct ruling (F-Q13) working as ruled, and it leaves the barrage a demolition and
area-damage tool against a defended building, which is the design's stated answer to a garrison.

### 2.4 The barrage on a garrisoned building, both ways (F-Q13)

One call on the building's centroid, 200 seeds, one rifle team inside (`garrison_cover` 3).

| building | item | building damage | building down | man inside | peak suppression on him | seconds pinned |
|---|---|---|---|---|---|---|
| house 2×2 (1,040) | barrage, cover honoured (**ruled**) | 1,040 | **200 of 200 seeds**, ~13 s after the call | killed when it falls | 0.05 | 0 |
| | barrage, cover ignored (record) | 1,040 | 200 of 200 | killed when it falls | 0.58 | 0.24 |
| | air strike | 1,040 | 200 of 200, 3 s | killed when it falls | — | — |
| concrete 2×2 (2,800) | barrage, cover honoured (**ruled**) | 1,428 | 0 of 200 | unhurt (`applyDamage` returns for a garrison) | **0.058** | 0 |
| | barrage, cover ignored (record) | 1,428 | 0 of 200 | unhurt | 0.647 | 0.75 |
| | air strike | 1,200 | 0 of 200 | unhurt | 0.887 | 1.59 |

`sarim_rifles` inside read the same shape (0.046 honoured, 0.518 ignored, strike 0.709). With cover
honoured, a barrage does nothing to the men in a building it does not bring down, and brings down
anything with about 1,430 hit points or fewer (all six rounds land within reach) (a house, a shanty, a pump house, a clinic, a 2×2 warehouse
at 1,360) in one call.

### 2.5 A barrage on a `raze` target (F-Q9)

One barrage on the raze target (the living raze structure with the most hit points), in the winning
plan, on all 30 seeds; the call is free in the probe. Two timings: at 1 s (the upper bound) and at
the tick the plan has earned 120 under 10/30/30 (what a player could really do).

| mission | target | called at | raze completes (median, 30 seeds) | victory (median) | mission length removed |
|---|---|---|---|---|---|
| `wadi_halam_5_depot` | 2,800-HP building of the 7-building depot | 1 s | 138 s → 138 s | 315 s → 317 s | **0** |
| | | 66 s (120 earned) | 138 s → 138 s | 315 s → 315 s | **0** |
| `tel_marum_2_foothold` | the 480-HP cache | 1 s | 153 s → **9 s** | 251 s → 251 s | **0** |
| | | 124 s (120 earned) | 153 s → 132 s | 251 s → 251 s | **0** |

All 120 runs won, ROE unchanged (100 and 98: #431, nothing charged on a raze target). Neither mission
gets shorter: each ends on a `hold_for` clock (`hold_depot`, `hold_approach`) that the raze does not
set. On Wadi Halam V one barrage cannot level the strongest depot building at all; on Tel Marum II it
does the plan's demolition job 21.7 s earlier at a realistic call (median 153.4 s → 131.75 s), or 2.4 minutes earlier at the
earliest possible one, and the cache is a 2-round target. **F-Q9 needs nothing from the lead: no
mission's length collapses.**

---

## 3. §5.7 and the gates

- **No §5.7 target moves under anything proposed here.** `targets.ts` issues no support call and
  builds no `MissionRuntime`; every §5.7 line is measured without fire support (the file's own
  header). `pnpm balance` was not re-run because nothing tracked changed; the scratch copy's
  un-supported arm reads the same four urban numbers `balance-base.txt` printed at `da74f887`.
- What the menu can do *inside a mission* beyond §5.7's doctrine is in §2.2: three strikes (750)
  carry 1:1. That is not a target move; it is a price the lead set (D2) and no plan earns it.
- `pnpm playtest`: the probe's outcome lines matched the base byte for byte (it reads, it does not
  act). The two raze runs, which do act, won every seed and printed no FAILED line.

## 4. What the lead is asked to confirm (on the PR)

1. The earn row **10 / 30 / 30** (identified / objective / rise) in place of 10 / 25 / 30, or the
   seed-robust alternative **8 / 40 / 30** (breach pair 1 of 30 seeds instead of 16; 6,856 paid to the
   26 plain winners on 424242 against 6,540).
2. The four prices **60 / 120 / 150 / 250**, with the smoke screen's per-point strength (§2.2) seen.
3. The two filled-in readings: smoke-screen scatter 1.5 tiles; "over N s" as first-to-last round.
4. That a passive force paid for enemies walking into its sight (KR III: 10; WH I: 190) is
   accepted, and that `beit_sahwan_breach`'s 16-of-30-seed pair is the breach outlier, not a defect
   in the rule.
