# Production at the field camp: the numbers and the D-list (F4 Task 1)

**Date:** 2026-10-16. **Scope:** GH-183 F4 (GH-136, LD6), plan `docs/superpowers/plans/2026-10-04-gf4-camp-production.md`,
Task 1. **Base:** branch `feat/gf4-camp-production`, cut from `8c18f590` (N2 #686). Every figure is **(M)** measured
by `pnpm playtest` or the probe unless marked **(R)** reasoned.

> **How this differs from the plan's Task 1.** C-R1 (controller, 16 Oct): the D-list does not halt the branch and is not
> posted on #183 as a comment. D1 to D8 stand as the plan's taken defaults, each with its alternative below, for the
> lead to overrule on the PR. C-R2: Step 1's serial-timing prediction (a scratch re-implementation measured before the
> code existed) was replaced by measuring the real implementation, so §2 reports what Tasks 3 and 10 measured.

## 1. The D-list, with each alternative

D1 and D5 are **lead-ruled**. D2-D4 and D6-D8 are the plan's taken defaults (the lead's G3 Q3, 4 Oct, set the shape:
camp production plus a player rally point). R-F4-1 to R-F4-9 and C-R1 to C-R7 are **coordinator/controller-ruled**, in
the lead-delegated window of 15-16 Oct, and stand until the lead overrules them.

| # | Rule as built | Alternative if overruled | Status |
|---|---|---|---|
| D1 | **Contested** = a living, surface, ground unit of side `1 - line.side` within `CONTEST_RADIUS_SQ` (6 tiles, `tuning.ts`) of the line's exit. Aircraft and units underground do not contest (#279 (a)). A contested line pauses its clock. Objectives' `contestedIn` untouched | a camp never pauses (no contest), or aircraft contest too | **Lead-ruled** (6 Oct: Deir Amun II's gate fight inside the radius is intended) |
| D2 | A mission with no camp keeps ONE side-0 line at `player_start`; the contest applies there too. Neither camp nor start: builds nothing. Side 1 never falls back to `player_start` | no fallback (a campless mission cannot buy) | taken default |
| D3 | Pay at queue time. Cancelling a queued item, or the one in progress, refunds in full to the line's own side; the F3 population reservation goes with it | pay on completion; cancel refunds a share | taken default |
| D4 | A camp that dies loses its line: the item in progress is lost, queued items are refunded, the rally goes. "field camp destroyed" stands once the side's last camp is gone. The line keeps its index | the whole queue is refunded; or the queue moves to another camp | taken default |
| D5 | The rally order is a no-sweep `attackMove`. A rally on a blocked tile is refused, never snapped. Per line; survives until cleared or the camp dies; none = the unit stays at the exit | a plain move; snap to the nearest open tile | **Lead-ruled** (2026-10-11) |
| D6 | A build goes to the line the caller names (an index into `productionLines(side)`); none named = that side's line with the fewest items, ties to the lowest index. Index order is structure order and stable | always line 0; or first idle line | taken default |
| D7 | No shipped campaign mission gives side 1 a camp in Stage 4; the enemy half is proved on fixtures and a harness probe (§4) | author one enemy camp AND make the app/playtest unitInfo answer side 1 (code + data, held for the lead); `validate:data` refuses `enemy.production` on a shipped mission meanwhile | taken default |
| D8 | Spend-down: whenever side 1's line is idle and its purse covers the cheapest menu item that fits its population room, it buys the next affordable item in menu order (round-robin from the last bought). Never banks for a dearer item. No `rng` | buy the dearest affordable; or bank for the best item | taken default |

| # | Controller/coordinator ruling | Cost if overruled |
|---|---|---|
| R-F4-1 | `built` fires for side-1 purchases and carries `side: 0 \| 1`; the app filters to the viewer's side (no alert, announcer line or cue for an enemy buy) | one `if` in the deploy path; Task 9's test flips |
| R-F4-2 | `MissionContext.economy = { logisticsStart, logisticsRatePerMin }`, whole logistics, by side; a construction constant, not hashed | a rename in Task 2b and in N3's rules loader |
| R-F4-3 | `productionOf(side)` is F4's; `get production()` returns `productionOf(0)` | one unused public method until N3 |
| R-F4-4 | `MAX_PRODUCTION_LINES = 4` per side, `MAX_LINE_QUEUE = 16` waiting per line, in `tuning.ts`, enforced by the runtime as well as the wire; the 17th waiting build is refused | a constant and one refusal string |
| R-F4-5 | `MissionContext.unitInfo(unitId, side)` takes the side; the shipped lambdas answer KDF only, so side 1 is refused everywhere until a caller answers for it | a second context member instead |
| R-F4-6 | `enqueue` returns false at `MAX_LINE_QUEUE`; an item enqueued on an idle line becomes `current` at once; one that finishes on tick t promotes the next with its full build time from t + 1 | Task 2 retest |
| R-F4-7 | `enemy.production.group` (not `tag`) is given to every built unit, so a trigger's `commit` can address it | a schema rename |
| R-F4-8 | Tasks 3-5b fold side 0's items exactly as the old `buildQueue` fold did, so the economy pins moved once, in Task 6 | pins would move early |
| R-F4-9 | `Sim.structureProducesFor(s)` (the per-placement override, else the type's) is the one reader for lines, `productionAnchor`, `stepDemolition`'s own-camp skip and `ThreeRenderer.structureIsOwn` | five readers revert |

| # | Task ruling (progress ledger) |
|---|---|
| C-R1 | The D-list is recorded here and in the PR body, not posted on #183; nothing halts |
| C-R2 | Task 1's serial-timing prediction is replaced by measurement of the real implementation (Tasks 3 and 10) |
| C-R3 | Dispatch batching (2+2b, 4+5, 8+9; Task 1 folded into 11) |
| C-R4 | `declaresProduction` was deleted in `629afef9` (the camp clause reads the lines), so Task 7 has no reader of it to switch |
| C-R5 | A formation-placed multi-unit item is unreachable through a line (one unit per item); "halts to fire on the way" is the sim's existing no-sweep attack-move (#402) |
| C-R6 | F2's flat-fixture zone/purse words move with the rally (side 1's final purse 48 -> 43), accepted: the rally is the feature under test; the second camp alone moves none |
| C-R7 | `spendDown` does not refuse at popRoom 0 when a population-0 item exists (F3 C-R8: a population-0 unit is never refused by the cap) |

## 2. Measured effects on the building plans (Task 10, `e8a86d79`; Task 3, `52c472d3`)

Serial lines (one item in progress per camp, the next starting when it deploys) and the contested pause, over the 30-seed
set (`SWEEP_SEEDS`: 424242, then 1..29), compared with the pre-F4 playtest baseline at `8c18f590`. Every plan still wins on
30 of 30 seeds, inside its `time_limit_s`; every passive control still loses; no outcome flipped.

| Plan (mission) | Moved? | Slowest win, headroom (before -> after) | Largest queue |
|---|---|---|---|
| BS II (`beit_sahwan_2_foothold`) | no, byte-identical | 317 s, 523 s | 1 |
| WH II (`wadi_halam_2_laager`) | no, byte-identical | 446 s, 394 s | 1 |
| WH IV (`wadi_halam_4_village`) | no, byte-identical | 253 s, 587 s | 1 |
| DA II (`deir_amun_2_foothold`, camp (21,35)) | **yes, by the rally alone** (see below) | 395 -> 394 s, 445 -> 446 s | 1 |
| UZ III (`umm_zeitoun_3_clearance`) | **yes, by serial timing** | 210 -> 234 s (3.5 -> 3.9 min), 630 -> 606 s | 2 |
| `boughtProbe` `beit_sahwan_4_subterranean` | no, unchanged | 380 s, 340 s | n/a |
| `boughtProbe` `umm_zeitoun_4_clearance` | no, unchanged | 279 s, 561 s | n/a |

- **UZ III** is the one plan whose serial timing moved, as S-17 reasoned: its 160 s `inf_squad` now waits for the 150 s
  `mortar_team`'s 18 s on the single line. Tightest headroom it keeps is 606 s of 840 s. The "largest queue 2" is the max
  over the 30 seeds; on seed 424242 the plan wins before its first build and reads 0.
- **DA II** gained a rally at (15,31) issued at t=0 (`setRally`, the pump gate). It is still 30/30, slowest 6.6 min;
  banking 939 earned / 171 banked -> 938 / 170 (13%); side 1's end population 7 -> 8. Removing the rally returns the
  no-rally figures exactly.
- **BS II and DA II** were the two the contest could move (their wave targets lie within 6 tiles of the camp exit); it did
  not change a purchase on either. The two `boughtProbe` lines (one build each at `player_start`) read byte-identical.
- **Largest queue 1 (2 for UZ III) against a bound of 16**: the plans never come near `MAX_LINE_QUEUE`.
- Gates held: `BANKING_OVER_30_WINNERS` 15 (of 18), `ZONE_PASSIVE_INCOME` 0, `LADDER_CREDITS` = `CAMPAIGN_CREDITS` 5930,
  `ROSTER_MAX` 29. `pnpm balance` is identical bar the timing line. Sim pins (flat 935671699, relief 2842924511, orders
  3272041047) did not move.

## 3. Build times (`cost.build_time_s`, read from `data/units/**/*.json`)

The line is serial, so a unit's `build_time_s` is its pace: a line delivers at most `floor(mission seconds / build time)`.
In a 7-minute (420 s) mission that is the column "max per line in 420 s" (an upper bound; the purse binds first).

| Unit | Faction | Build (s) | Logistics | Max per line in 420 s |
|---|---|---|---|---|
| `recon_drone` | KDF | 12 | 210 | 35 |
| `jeep_shoded` | KDF | 12 | 317 | 35 |
| `attack_drone` | KDF | 14 | 300 | 30 |
| `inf_squad` | KDF | 15 | 292 | 28 |
| `at_team` | KDF | 18 | 236 | 23 |
| `mortar_team` | KDF | 18 | 209 | 23 |
| `breach_team` | KDF | 20 | 306 | 21 |
| `demo_squad` | KDF | 20 | 300 | 21 |
| `sniper_team` | KDF | 20 | 260 | 21 |
| `yahalom_squad` | KDF | 20 | 260 | 21 |
| `recon_zikit` | KDF | 22 | 290 | 19 |
| `scout_shachaf` | KDF | 24 | 410 | 17 |
| `dozer_d9` | KDF | 26 | 586 | 16 |
| `apc_eitan` | KDF | 28 | 520 | 15 |
| `apc_kipod` | KDF | 30 | 562 | 14 |
| `ifv_namer` | KDF | 35 | 630 | 12 |
| `heli_peten` | KDF | 42 | 402 | 10 |
| `mbt_lavi` | KDF | 45 | 906 | 9 |
| `heli_peten_gunship` | KDF | 50 | 450 | 8 |
| `sarim_rifles` | Sarim | 26 | 340 | 16 |
| `atgm_cell` | Sarim | 20 | 235 | 21 |
| `manpad_team` | Sarim | 18 | 210 | 23 |
| `rocket_battery` | Sarim | 40 | 201 | 10 |
| `recoilless_team` | Sarim | 16 | 205 | 26 |
| `loiter_drone` | Sarim | 9 | 292 | 46 |
| `gun_truck` | Rif (not Sarim) | 13 | 324 | 32 |

(The other enemy-roster units carry a build time as well, from `charge_squad` 6 s to `digger_crew` and `mortar_crew` 15 s
(`moto_rpg` 7, `militia_cell` and `technical` 10, `paramotor` 11, `rpg_team` 12), and are not tabled. Tabled are the five
Sarim menu units N3 sells, the Sarim `loiter_drone`, and the Rif `gun_truck`. Every figure above was re-read from
`cost.build_time_s` in `data/units/**/*.json`.)

**Flags.**
- **Instant-feeling (<= 14 s): `recon_drone` 12, `jeep_shoded` 12, `attack_drone` 14**, and on the enemy side
  `loiter_drone` 9 (Sarim) and `gun_truck` 13 (Rif) if either joins a menu. At these times the line is not a pacing device: the purse alone limits the player (a drone is 210 logistics). That is intended for drones (they carry population 0
  and a mission's recon plan uses them), but it means "the dock is a queue" is felt on infantry and up, not on the
  drone-class.
- **Heavy (>= 42 s): `heli_peten` 42, `mbt_lavi` 45, `heli_peten_gunship` 50.** A single `mbt_lavi` is 45 s of a 300-420 s
  mission (11-15%), and the line is blocked behind it. This is the intended cost of armour on one line; a second camp (up
  to four per side) is the relief, and no shipped mission has one.
- **Nothing makes a five-to-seven-minute mission's dock pointless:** the slowest unit (50 s) still delivers 6 in a 300 s
  mission. The campaign plans' own use (largest queue 1-2, §2) shows the dock is a rare decision in the campaign, not a
  throughput bottleneck. **The Sarim `rocket_battery` at 40 s and 201 logistics is the one mismatch** (cheap but slow):
  its line is time-bound, not purse-bound, so (R) a spend-down that buys it first holds the line for 40 s with cash left over.

## 4. Enemy-production probe headline (Tasks 8-9, `eef42ea8`, `e6bef37d`; report only)

`pnpm --filter @lions/tools enemy-production:probe`: `tel_marum_3_clearance` plus a side-1 camp at tile (27,7) (beside
`battery_position` (25,6)), purse 640, menu `sarim_rifles` / `atgm_cell`, over the 30-seed set. In memory only; no
`data/missions` file changed (D7).

| Arm | Bought | Unspent | Outcome |
|---|---|---|---|
| shipped winning plan + camp | **2 every seed** | **10% (65 logistics, less than the cheapest item 235)** | victory 29/30; **seed 26 lost** on `get_the_block_out` |
| passive + camp | 2 every seed | 10% | defeat 30/30 |
| **camp-less control** (shipped plan, no side-1 camp) | 0 | n/a | **victory 30/30** (so seed 26's loss is the camp's) |

The 10% is the rule's floor with a rate of 0, not waiting: a 640 purse buys 340 + 235 and strands 65. D8 never banks.

## 5. What this document does not decide

D7 (no enemy camp in a shipped mission) is the open design call for the campaign: the probe shows one camp on Tel Marum III
costs a plan one seed of thirty. Whether a shipped mission should author one is the lead's, with `data/missions` held for
the lead's own edit.
