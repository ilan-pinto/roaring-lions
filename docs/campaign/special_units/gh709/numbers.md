# GH-709 special units: the numbers (Phase 1 probes)

Record of what `pnpm --filter @lions/tools su:probes` measured on **22 Oct 2026** against the nine
staged drafts in this directory, the claims made, and the frozen bands. Design:
`docs/superpowers/specs/2026-10-22-special-units-design.md` (§1, §3 "Probes", lead rulings).
Pinned by `tools/src/backtest/special-units-probes.test.ts` (73 specs since Phase 7; the CLI runs in ~1.5-3 s). The probes are
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
| 4 `at_nlos_team` | 4a: kills `rocket_battery` / `atgm_cell` 20 tiles off behind a 2-tile wall, a `recon_drone` spotting; control with `indirect` stripped. 4b: Conduct lost killing an `atgm_cell` in a flagged zone, vs `mortar_team` | kills most seeds, control never fires; fewer Conduct lost than `mortar_team` | **MET** (22 Oct, Phase 7, E2). 4a: 19/20 kills each, 21.4 / 21.5 s, 1.65 rounds; control 0 rounds, 0 kills. 4b: Conduct lost **0.00** (0 of 20 seeds charged) vs `mortar_team` **16.50** (20 of 20) |
| 5 `veh_ambulance` | | | deferred to Phase 5 (needs E1, the unit aura) |
| 6 `air_medevac_heli` | | | deferred to Phase 5 (needs E1) |
| 7 `inf_medic_squad` | | | deferred to Phase 5 (needs E1) |
| 11 `spg_cluster` | 18 tiles, 90 s (3 rounds): open infantry, a technical, a garrisoned house, an armoured column; vs the unitary draft; Conduct per round near civilians | the lead's four claims; more per round than the unitary draft; Conduct per round >= unitary | **MIXED** (22 Oct, Phase 7, E3). **MET**: house men 0 hp lost and the house 0, men suppressed (peak 0.045); armour 0 hp lost; 2.0x the unitary draft per round (0.116 vs 0.058); Conduct 5.60 vs 3.00 per round. **MISSED** (the pre-registered "destroys more than half in 90 s"): open infantry 0.347, technical 0.248 |

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

## Probe 4 -- the NLOS missile team (unit 4, Phase 7, on E2)

Design fixed before any number was seen. Staged `at_nlos_team` (`spike_nlos`: atgm, `indirect`, range
24 / effective 18, accuracy 0.8, damage 450, rof 2, min 4, collateral 0.2).

**4a, reach without a sight line.** Set-up: team at x=4.5, target 20 tiles east at x=24.5 (y=12.5), a
2-tile-thick wall of an indestructible structure (x 12-13, the whole map height of 24) between them,
a KDF `recon_drone` at (21.5, 10.5) as the spotter. **No `identifyTo`**: the drone is the claim's
spotter. Control: the same JSON with `indirect` set false in memory (`withoutIndirect`). 20 seeds,
120 s cap.

| target | variant | kills | drone identified it | mean s to kill | rounds fired |
|---|---|---|---|---|---|
| `rocket_battery` | NLOS | 19/20 | 20/20 | 21.4 | 1.65 |
| `rocket_battery` | `indirect` stripped | 0/20 | 20/20 | never | 0.00 |
| `atgm_cell` | NLOS | 19/20 | 20/20 | 21.5 | 1.65 |
| `atgm_cell` | `indirect` stripped | 0/20 | 20/20 | never | 0.00 |

**MET.** The drone (an air unit, so not stopped by the wall) identifies the target in every seed, the
NLOS team kills it behind the wall in 19 of 20, and the control, which sees exactly the same
identification, never fires: the wall stops the shot and `indirect` is what lets it through. The one
miss in 20 is a run of misses at accuracy 0.8 and range 20 (past the 18-tile effective range) inside the
120 s cap; the mean is 1.65 rounds a seed. The fallback to `identifyTo` was not needed.

**4b, the precision claim.** Set-up: a `MissionRuntime` scene, the KDF shooter and one Sarim
`atgm_cell` on open ground, a flagged zone "clinic" (5x5 tiles) round the `atgm_cell`,
`flagged_structure_penalty` 5, `disproportionate_ordnance_penalty` 3. The shooter is the NLOS team at 18
tiles (its effective range) or, separately, the shipped KDF `mortar_team` at 13 tiles (inside its
effective 14, outside the `atgm_cell`'s sight 10, so it is not shot back at). Both get the target by
`identifyTo` every tick (the same way for both: the spotter is 4a's question). Until the target dies,
120 s cap, 20 seeds. Reading: `100 - roeScore`.

| shooter | distance | kills | rounds | Conduct lost (mean) | seeds charged |
|---|---|---|---|---|---|
| `at_nlos_team` | 18 | 20/20 | 1.60 | **0.00** | 0/20 |
| `mortar_team` | 13 | 20/20 | 4.35 | **16.50** | 20/20 |

**MET.** The mortar's strays (collateral 0.7, above the 0.3 structural threshold) land in the clinic in
every seed and cost 16.5 Conduct on average; the NLOS team (collateral 0.2, below it) charges nothing,
and kills in fewer rounds. The reading is also exactly the rule rather than a margin: NLOS 0 in all 20
seeds, so the claim does not depend on a close mean. A direct hit is not judged (only `nearMiss` is).

**Bands.** 4a: kills >= 16 of 20 each, drone identification 20/20, mean seconds and rounds within
±15% (21.4 / 21.5 s, 1.65); control exactly 0 rounds and 0 kills, 20/20 identified. 4b: NLOS Conduct lost
**exactly 0** and 0 seeds charged, 20/20 kills, rounds within ±15% of 1.60; mortar 16.50 ±15%, 20/20 seeds
charged, 4.35 rounds ±15%.

## Probe 11 -- the cluster howitzer (unit 11, Phase 7, on E3)

Staged `spg_cluster` (`dpicm_155`: 12 bomblets x 90 damage, scatter 2.5, splash 0.8, suppression 60;
no parent damage; accuracy 0.45, rof 2, min 6, collateral 0.95, can_target ground). Lead rulings
applied: no duds; bomblets do no damage to garrisoned men but may suppress them (Q7); Conduct per Q6.

**Set-up.** Gun at (4.5, 12.5), targets side 1 at x=22.5 (18 tiles, its effective range), no orders. The
gun's sight is 7, so the target is handed over by `identifyTo` every tick, as
`packages/sim/src/special-weapons.test.ts` does (the spotter's rules are probe 4's). 90 s cap, 10 seeds
(3 rounds in every scene, rof 2). Scenes: **infantry** = 3 `sarim_rifles` one tile apart; **technical**
= one (front 15 mm, soft by the 30 mm rule); **house** = 2 `sarim_rifles` garrisoned in a 1-tile house
(slots 2, hp 900); **armour** = 3 `mbt_lavi` on side 1 (no Sarim armour exists). **Control for what E3
buys** (`unitaryRound`, in memory): the same JSON with the bomblets stripped and the Phase-1 unitary
round restored (damage 120, splash 1.2), against the same infantry. **Conduct**: a `MissionRuntime`
with the three `sarim_rifles` and **2 civilians 2 tiles off**, `disproportionate_ordnance_penalty` 3 and
`civilian_casualty_penalty` 0, so the reading is the ordnance rules of Q6 and not who died (0 civilians
died in any seed regardless).

| scene | gun | hp lost (mean) | worst seed | rounds | hp lost / round | peak suppression | house hp lost |
|---|---|---|---|---|---|---|---|
| infantry | cluster | 0.347 | 0.573 | 3.00 | 0.116 | 0.252 | - |
| technical | cluster | 0.248 | 0.511 | 3.00 | 0.083 | 0.381 | - |
| house (2 men garrisoned, 2.0 of 2) | cluster | **0.000** | **0.000** | 3.00 | 0 | 0.045 | **0.000** |
| armour (3 `mbt_lavi`) | cluster | **0.000** | **0.000** | 3.00 | 0 | 0.236 | - |
| infantry | unitary | 0.175 | 0.301 | 3.00 | 0.058 | 0.280 | - |

| Conduct (3 rounds, 2 civilians 2 tiles off) | rounds | Conduct lost | per round |
|---|---|---|---|
| cluster | 3.00 | 16.80 | **5.60** |
| unitary draft | 3.00 | 9.00 | **3.00** |

**Honest reading, claim by claim.**

- **In the open: MISSED, as pre-registered.** The claim "shreds men and trucks in the open" was fixed
  before the numbers as "destroys more than half of the target's hp in 90 s". It destroys **0.347** of three
  riflemen (worst seed 0.573) and **0.248** of a technical (worst 0.511). Reading why: 90 s is three
  rounds at rof 2, and accuracy 0.45 at 18 tiles puts most aimpoints a tile or two off the men, so a
  scattered 12-bomblet pattern of 90 hp (splash 0.8) catches one or two of them. Per round, the cluster
  does **2.0x** the unitary draft (0.116 vs 0.058; 0.347 vs 0.175 over the run), so E3 buys what it was
  for, and the "more than half" bar is a statement about the rate of fire, not the round. No softer
  scenario (longer cap, more rounds) was built after seeing the miss; that is the lead's retune.
- **Garrisoned house: MET (Q7 and the ruling).** 2 of 2 men garrisoned in every seed, the gun fired 3
  rounds at them, the men lost **0 hp** in every seed and the house **0**, and they were **suppressed**
  (peak mean 0.045, small: the garrison cover cuts incoming suppression). The scene can detect harm: see the
  falsification below.
- **Armoured column: MET.** 3 `mbt_lavi` lose 0 hp in every seed (and are suppressed, peak 0.236, which
  the ruling allows). Same falsification.
- **Conduct per round near civilians: claim MET (cluster >= unitary), the "about 2x" nearly.** 5.60 vs
  3.00 per round, 1.87x: a cluster round is charged once at twice the penalty (6) when a bomblet lands
  within 2 tiles of a civilian, which 2.8 of the 3 rounds did on average (16.80 / 6); a
  unitary shot is charged the penalty (3) per shot at its aimpoint. The cluster's Conduct bill is higher
  per round and it kills a bit more than twice as much per round, so per hp destroyed the two are about even.

**Bands.** Open infantry hp lost 0.347, per round 0.116; technical 0.248 / 0.083; unitary control
0.175 / 0.058 (all ±15%); rounds 3.00 in every scene (±15%); the cluster exceeds 1.7x the unitary per
round. House: 2 garrisoned, **exactly 0** hp lost in every seed (worst seed), **exactly 0** house hp lost,
peak suppression 0.045 ±15%. Armour: **exactly 0** hp lost, peak suppression 0.236 ±15%. Conduct: 5.60 /
3.00 per round and 16.80 / 9.00 lost (±15%), cluster >= unitary, 0 civilians dead. The two misses are
pinned as a miss (the test asserts exactly those two failures).

## Deferred

| unit | needs | why no probe now |
|---|---|---|
| `veh_ambulance` (5) | E1, the unit aura | no heal aura on a unit type exists |
| `air_medevac_heli` (6) | E1 | same |
| `inf_medic_squad` (7) | E1 | same |

Units 4 and 11 were deferred here until Phase 7 (E2 and E3, GH-733) and are measured above. The three
remaining each print one `deferred to Phase N (needs E#)` line in the CLI and have no pinned band yet;
their bands are frozen when E1 lands. Unit 3 is held for E6 and unit 8 is not built (Lead rulings Q3, Q9).

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

Phase 7 (22 Oct), same method (a temporary hook in `stagedUnit`, in memory; the staged JSON and the probe
file were restored byte-for-byte, `diff` clean):

- `indirect` stripped from the NLOS weapon: 3 specs red (the 4a claim, and both targets' kill bands:
  0 kills). The control is the same mutation applied by the probe itself.
- NLOS collateral 0.2 -> 0.8: the 4b band goes red (Conduct lost 3, not 0; its strays now charge the
  zone). **The claim spec stays green**, because 3 is still below the mortar's 16.5: the claim is
  relative and the exact-zero band is what holds the "below the structural threshold" reading.
- bomblet count 12 -> 1: 6 specs red (infantry and technical hp, per-round vs unitary, house and armour
  suppression bands, the Conduct per round; the known-miss spec gains a third failure).
- bomblet damage 90 -> 0: 3 specs red (open infantry reads 0, the bands, the E3-buys spec).
- cluster collateral 0.95 -> 0.2: the Conduct spec goes red (0 per round).
- **The house and armour claims are falsified by changing the ROUND, not the reading**: the cluster
  replaced by a unitary 120-damage round with penetration 2000 loses garrisoned men **0.112** of their
  hp and armour **0.347** of theirs, and the 0-hp specs go red (6 specs). So the 0 in the table is the
  bomblets' refusal to hurt them and not a scene that cannot register damage. There is no honest
  mutation of the E3 sim rule itself from the tools side; changing the bomblet rule needs the sim.

## Notes for the lead and the landing phases

- **The grenadier's blurb is provisional.** "Grenades reach men behind a wall" is the spec's splash
  argument, and probe 9 misses its cover claim on the net-margin reading. Re-read the blurb when the
  lead rules on the retune.
- **`ugv_recon_dog` sets `hull.can_embark: true`**, a choice beyond the spec's §1.10 field list: a
  crew-0, population-0 robot may ride a carrier like a team. Phase 8 confirms or drops it with the
  transport rules in front of it.
- **The camo Lavi is found later, not only by firing.** Parked in ambush it is still identified in
  every in-sight cell, about 1.6-2.0x later than the Lavi. The spec's "is it found at all, and only by
  firing?" is answered: yes, and no.
- **Q11 is triggered**: `spg_long_range` wins 30/30 at every range 20-28 with no hp lost. Range is not
  the lever (one 320-damage round equals the Grad's 320 hp); the lead decides.

## Phase 7: the cost curve reads E2 and E3 (22 Oct 2026)

GH-733 left `validate_balance.py` blind to both fields. It now reads them:
- **indirect reach**: an indirect weapon (mortar/rocket class, or `indirect: true`) prices its
  standoff on `range_tiles`; a direct weapon keeps `effective_range_tiles`.
- **bomblets**: a `submunitions` weapon is priced on its bomblets, soft targets only (the sim's
  30 mm limit), the burst on the target on a hit and `SCATTER_BASE` + U[0,1) off it on a miss, each
  bomblet at radius U[0, scatter) with linear falloff, integrated numerically. The parent's damage
  and splash (unread by the sim) are dropped from the staged JSON.

| run | curve | at_nlos_team | spg_cluster | tightest |
|---|---|---|---|---|
| data/units + e5 + gh709, before | 283.978 * power^0.481 (n=45) | +12.3% | +9.2% | attack_drone +13.7% |
| the same, after | 283.814 * power^0.481 (n=45) | **+11.8%** | **+8.5%** | attack_drone +13.8% |
| max tier, after | 304.471 * power^0.481 (n=45) | +11.6% | +11.5% | heli_yanshuf +15.0% |
| data/units alone, after | 287.734 * power^0.469 (n=35) | - | - | attack_drone +16.2% (unchanged) |

Shipped units the indirect reading moves: `mortar_team` -2.4 -> -2.6%, `mortar_crew` -2.4 -> -2.6%,
`rocket_battery` +2.9 -> +2.7%. Every unit stays inside +/-18% in all four CI passes. The curve sees
the two abilities only weakly (half a point each): the premiums stay the judgement the probes test.
Pinned and falsified in `tools/src/gh709_staged.test.ts` (six one-line mutations of the Python, each red).
