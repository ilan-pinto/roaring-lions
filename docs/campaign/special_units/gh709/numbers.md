# GH-709 special units: the numbers (Phase 1 probes)

Record of what `pnpm --filter @lions/tools su:probes` measured on **22 Oct 2026** against the nine
staged drafts in this directory, the claims made, and the frozen bands. Design:
`docs/superpowers/specs/2026-10-22-special-units-design.md` (§1, §3 "Probes", lead rulings).
Pinned by `tools/src/backtest/special-units-probes.test.ts` (60 specs, ~1.9 s). The probes are
report-only: a claim that misses leaves the CLI at exit 1 and is a unit to retune (the lead's call),
never a band to widen. **No staged number was edited to make a claim pass.** No engine code exists
or was written; `packages/sim`, `data/`, the determinism hash, `playtest`, `LADDER_CREDITS`,
`ROSTER_MAX` and the versus pins are untouched.

## Summary

| unit | probe | claim | result |
|---|---|---|---|
| 1 `mbt_lavi_camo` | first-identified tick vs `sarim_rifles` / `atgm_cell` / `rpg_team` at 4/6/8 tiles, ambush / moving / firing, vs `mbt_lavi` | found later than the Lavi in every claimable cell | **MET** (24 claimable cells, 24 of 24; camo is 1.6-2.0x later across them). **"Found only by firing" does NOT hold** (below) |
| 2 `spg_long_range` | duel vs `rocket_battery`, 20-28 tiles, a `recon_drone` spotting for each side | report win rate; Q11 | **Wins 30/30 at every range 20-28 with no hp lost. Q11 TRIGGERED** (reported, not retuned) |
| 9 `inf_grenadier` | 2 squads vs 3 `militia_cell`, open vs cover 2, vs `inf_squad` | advantage over `inf_squad` larger against cover | **MISSED** on the net-margin reading (cover2 0.052 vs open 0.548); the damage-dealt ratio goes the other way (printed, not a claim) |
| 10 `ugv_recon_dog` | first tick a `pre_dug` route is identified, synthetic map | after `recon_drone`, before `yahalom_squad` | **MET**: drone 92, dog 217, yahalom 425 ticks |
| 4 `at_nlos_team` | | | deferred to Phase 7 (needs E2, the `indirect` weapon flag) |
| 5 `veh_ambulance` | | | deferred to Phase 5 (needs E1, the unit aura) |
| 6 `air_medevac_heli` | | | deferred to Phase 5 (needs E1) |
| 7 `inf_medic_squad` | | | deferred to Phase 5 (needs E1) |
| 11 `spg_cluster` | | | deferred to Phase 7 (needs E3, submunitions) |

The phase numbers on the deferred rows are the CLI's labels for the engine concept (E1 / E2 / E3); the
order in which the engine phases land is the spec's, not this file's.

## Probe 1 -- the camouflaged Lavi (unit 1)

**Set-up.** One observer (`sarim_rifles` sight 9, `atgm_cell` 10, `rpg_team` 7) faces the tank across
open ground at 4, 6 and 8 tiles. Reading: first tick the observer's side holds the tank identified
(`contactLevel === 2`). The observer is made **unarmed with 30000 hp**, identically for the Lavi and the
camo Lavi: an armed observer is shot dead by a firing tank before it can identify it, and the reading
would be "who dies first". Modes: `ambush` = parked, the shipped `setStance{ambush}` (radius 3, so it
holds fire at 4+ tiles); `moving` = driving across the observer's front; `firing` = parked, default
stance, fires at the observer. 40 s cap. Detection draws no random number, so every seed reads the same
tick (min = max in the CLI); 5 seeds run to keep that visible.

**Measured** (ticks at 20/s; Lavi / camo):

| observer / mode | 4 tiles | 6 tiles | 8 tiles |
|---|---|---|---|
| `sarim_rifles` ambush | 34 / 62 | 76 / 142 | 137 / 248 |
| `sarim_rifles` moving | 12 / 21 | 26 / 49 | 47 / never |
| `sarim_rifles` firing | 17 / 31 | 38 / 70 | 69 / 124 |
| `atgm_cell` ambush | 36 / 65 | 80 / 147 | 142 / 265 |
| `atgm_cell` moving | 12 / 22 | 27 / 51 | 49 / 96 |
| `atgm_cell` firing | 18 / 33 | 40 / 72 | 71 / 132 |
| `rpg_team` ambush | 46 / 85 | 104 / 189 | non-claim |
| `rpg_team` moving | 16 / 29 | 36 / 69 | non-claim |
| `rpg_team` firing | 23 / 37 | 52 / 84 | non-claim |

**Non-claims** (E5's reasoning): `rpg_team` at 8 tiles is outside its sight 7, so neither tank is found
in any mode and "later than" would be Infinity > Infinity; those three cells are printed with `*` and
not claimed. `sarim_rifles` moving at 8 is a claim cell: the Lavi is found at tick 47 and the camo Lavi
**never** (it is outside the 40 s window, not just late).

**Honest reading of "found only by firing": it does not hold.** Parked in the ambush stance the camo
Lavi is still identified in **every** in-sight cell, 5/5 seeds, at 62-265 ticks (3.1-13 s) -- later than
the Lavi, never hidden. The net buys roughly a 1.8x delay, which is the signature ratio 0.55 doing what
the table in spec §1.1 said (0.275 parked vs 0.50). A tank that must not be found at 4-8 tiles by
infantry standing still needs far more than this unit has. Whether 1.8x is what the unit is for is the
lead's call; the claim as written ("found later") is met.

**Bands** (±15% of the camo median, floor/ceil; the Lavi control is banded the same way; table in the
test file): e.g. `sarim_rifles` ambush 4t [52, 72], 6t [120, 164], 8t [210, 286]. `sarim_rifles`
moving 8t: found 0/5.

## Probe 2 -- the long-range gun (unit 2)

**Set-up.** `spg_long_range` at x=4.5, `rocket_battery` d tiles east, the KDF `recon_drone` 3 tiles
from the Grad and the Sarim drone 3 tiles from the SPG so each gun is identified at once. No orders.
The duel ends when either gun falls (the drones are unarmed and never die, so `runBattle` would run to
the 120 s cap). 30 seeds per range.

| distance | SPG wins | Grad wins | draws | SPG hp left | mean seconds to first gun down |
|---|---|---|---|---|---|
| 20 | 30 | 0 | 0 | 1.00 | 24.7 |
| 22 | 30 | 0 | 0 | 1.00 | 24.1 |
| 24 | 30 | 0 | 0 | 1.00 | 23.9 |
| 26 | 30 | 0 | 0 | 1.00 | 25.8 |
| 28 | 30 | 0 | 0 | 1.00 | 28.9 |

**Q11 is TRIGGERED**: the gun wins outright (30/30) at 28 tiles. The spec's Q11 recommendation (taken as
written by the lead's ruling) is to drop the range to 24. **Not retuned here.** Note the result is
stronger than reach: at 20 tiles, where the Grad can fire back, the SPG still loses nothing -- one
`howitzer_155` round (320 damage, splash 2.4) equals the Grad's 320 hp, and the Grad was seen to loose a
single salvo at 20 before falling. Dropping the range to 24 would not change the outcome of this duel;
what would is a lower damage or hp, not range. The staged drafts are unchanged.

**Bands**: SPG wins 30/30 and Grad wins 0 at every range, SPG hp left >= 0.95; mean time to first gun
down ±15% of the table above.

## Probe 9 -- the grenadier (unit 9)

**Set-up.** Two KDF squads at x=5.5 face three `militia_cell` 6 tiles away, one tile apart (so splash 1.2
can matter). Cover 2 on the militia tiles and a one-tile ring, or none. No orders, 25 s, 30 seeds. The
reading is the **net hp margin** (fraction of militia hp destroyed minus fraction of own hp lost), and
the claim reads `advantage = margin(grenadier) - margin(inf_squad)` in each ground. This reading was
fixed before the numbers were seen.

| unit | margin open | margin cover 2 | militia hp destroyed, open | cover 2 |
|---|---|---|---|---|
| `inf_grenadier` | 0.475 | -0.451 | 0.569 | 0.057 |
| `inf_squad` | -0.073 | -0.503 | 0.199 | 0.006 |
| advantage (the claim) | **0.548** | **0.052** | | |
| damage ratio grenadier/inf_squad (not a claim) | | | 2.86x | 8.79x |

**The claim MISSES** on the margin reading: the grenadier's advantage is 0.548 in the open and only
0.052 against cover 2. Reading why: cover 2 cuts both squads' damage to almost nothing (a 25 s fight
destroys 5.7% / 0.6% of the militia) while the militia in cover kill both squads (about half their hp
gone), so the margin saturates near -0.5 and the advantage collapses. In *relative* damage the grenadier
does multiply further against cover (8.8x vs 2.9x), but from 5.7% of the militia's hp, which is not an
advantage the player can use. The ground is not unfair to the grenadier alone (`inf_squad` is crushed
too); the unit simply does not beat cover 2 at this force ratio. Left failing in the CLI and pinned as a
known miss in the test (it goes red when the unit is retuned, forcing a re-freeze). Retuning is the
lead's call. A softer scenario (more squads, fewer defenders) was deliberately not built after seeing the
miss, since choosing a scenario to make the claim pass is the same as widening a band.

**Bands** (±15% of the measured value): the six margins and advantages above; the damage ratio open in
[2.4, 3.3] and cover 2 in [7.4, 10.1].

## Probe 10 -- the robot dog (unit 10)

**Set-up.** Synthetic: a 48x48 open map, one `pre_dug` route along y=30 (x 2..46, no spoil), the
carrier starts at (24.5, 4.5) and is ordered to drive south to (24.5, 40.5). Reading: first tick side 0
holds the route identified. `mark_tunnel` with a clear sight line identifies a route in one look (no
dwell), so the reading is sight and speed only. Three seeds, all identical. Not run on
`beit_sahwan_4_subterranean`: that would add the mission's own enemies and a scripted dig, and the
question here is the carrier's reach; the mission-level probe is the playtest phase's.

| carrier | sight | speed | first tick (s) |
|---|---|---|---|
| `recon_drone` | 16 | 2.2 | 92 (4.6) |
| `ugv_recon_dog` | 12 | 1.3 | 217 (10.9) |
| `yahalom_squad` | 8 | 0.9 | 425 (21.3) |

**Claim MET**: the dog finds the route after the drone and before the yahalom squad. This tests reach
and walking pace only: the dog's low signature (0.35) and the fact that it carries no weapon are not in
this probe (no enemy is present).

**Bands**: ±15% of 92 / 217 / 425, and dog strictly between the other two.

## Deferred

| unit | needs | why no probe now |
|---|---|---|
| `at_nlos_team` (4) | E2, the `indirect` weapon flag | an `atgm` still needs its own line of sight; authoring it as `rocket` would measure a Grad |
| `veh_ambulance` (5) | E1, the unit aura | no heal aura on a unit type exists |
| `air_medevac_heli` (6) | E1 | same |
| `inf_medic_squad` (7) | E1 | same |
| `spg_cluster` (11) | E3, submunitions | no cluster round exists; the lead's four claims need it |

Each prints one `deferred to Phase N (needs E#)` line in the CLI and has no pinned band yet; its bands
are frozen when its engine phase lands. Unit 3 is held for E6 and unit 8 is not built (Lead rulings Q3, Q9).

## Falsifications (22 Oct)

Each by a temporary one-line mutation of a staged number (applied inside `stagedUnit` in memory, so the
JSON files were never touched), the probe file restored byte-for-byte afterwards:

- camo `signature` 0.55 -> 1.0 (and firing mult 6 -> 4): 25 specs red, including "found later than the
  Lavi in every claimable cell".
- spg range 28/22 -> 18/14: the Q11 report, the win-rate band and the kill-time band go red.
- grenadier splash 1.2 -> 4 and damage 60 -> 200: the margin bands and the damage-ratio spec go red.
- grenadier damage 400, accuracy 0.95: the margin and ratio specs go red.
- dog `sight_tiles` 12 -> 6: the tunnel band goes red.
- dog speed 1.3 -> 0.3: the tunnel claim ("before yahalom_squad") and its band go red.
- one banded number edited in the test (`atgm_cell` ambush 8t 265 -> 400): that spec goes red.
