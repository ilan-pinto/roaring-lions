# Held-ground income on at least 15 of 30 missions: the census and the plan (GH-1386)

**Date:** 2026-11-16. **Scope:** GH-1386 (audit dimension D3), under the lead's rulings on GH-1378: Q4 "held-ground income on at least
15 of 30 missions", and Q3 "objective design that makes the purse bind is outside the balance park". **Status:** step 1, a census and a plan
for the lead to read. **Docs and report-only tooling only: no mission JSON, no `tuning.ts`, no unit stat.** Step 2 authors the first batch.
Every number below is **(M)** measured, through the real `MissionRuntime` and `pnpm playtest`'s own plans and controls over its 30 seeds
(`SWEEP_SEEDS`: 424242 and 1 to 29), unless marked **(R)** reasoned.

Read with `income-numbers.md` (the F2 rules this reuses: approved 15 Oct, shipped on the four D7 missions) and `production-numbers.md`.

## 0. The answers up front

1. **Today 5 of 30 missions author `resources.income_zones`**: `deir_amun_2_foothold`, `ein_qasab_3_buildup`, `umm_zeitoun_2_buildup`,
   `umm_zeitoun_4_clearance`, `wadi_halam_2_laager`. The census line is
   `jq -s '[.[]|select((.resources.income_zones//[])|length>0)]|length' data/missions/*.json`, which prints **5**.
2. **Ten more can carry honest zones, which makes exactly 15.** Nine of the 30 have no purse at all (eight recons and the
   breach); of the 21 with one, five already author zones and the tutorial pays nothing, which leaves 15 eligible, and the rules of §2 cut the number
   that can pay a zone the plan really holds to ten (`beit_sahwan_4`, `qarn_hadid_3` and `wadi_halam_4` have none; `beit_sahwan_2` waits; `khan_rafid_3` is a reserve). It
   is the **minimum, not a margin**: if one batch cannot land, the count is 14. §5 names two reserves and says what each costs.
3. **All ten were run through the real playtest at the proposed rates (§4).** On every one the plan still wins 30 of 30 seeds, and its clock,
   stars, ROE and credits are **identical on 299 of the 300 plan runs** (the one that moves is `umm_zeitoun_3` seed 21, the only seed on
   which that plan builds: its squad is accepted 50 s sooner and the win comes 0.4 s later, with the same stars, ROE and credits). The no-orders control still loses 30 of 30 and earns **0** from
   zones. `LADDER_CREDITS` (6923), `LADDER_STARS` (68) and `ROSTER_MAX` (26) do not move. Time-limit margins do not move, because no
   plan's clock moves.
4. **Three pins do move, all for named reasons (§4.3), none of them a tuning constant:** `BANKING_OVER_30_MAX` 15 to 16 if
   `ein_qasab_2_foothold` is authored (its plan has a purse of 400 and no base rate; zones make it bank 48%);
   `wadi_halam_3_counterraid`'s `min_win_seconds` floor 80 to 79 and its "bought heli_peten" probe (a gate, §10), whose purchase moves from 141 s to
   95 s and then loses the helicopter before it scores (its plan, stars and credits are unmoved). Both of those missions go in the
   **last** batch, so the first two batches move no pin.
5. **The honest limit (§6): income that the plan does not spend is scored and does not bind.** In 7 of these 10 missions the winning plan
   buys nothing at all, so the zone income lands in a purse that is already 100% banked. This plan meets the lead's Q4 count; making the
   purse bind is Q3(a), a different piece of objective design, and nothing here claims to do it.
6. **Landing order, 3 to 4 missions a batch (§5):** batch 1 three footholds (no pin moves), batch 2 four clearances (no pin moves), batch 3
   the three that move a pin.
7. **A defect in the existing probe, found and fixed on the way (§3):** `income-probe.ts` forwarded only `unitId` to `requestBuild`, so
   the forward-camp plans built on line 0 under the probe and not without it, and its `none` table was no longer the same run as
   `pnpm playtest`. With the fix `none` is byte-identical to `pnpm playtest` (`diff` of the sorted outputs is empty).

## 1. The census: 30 missions

"Purse" is `resources.logistics_start + logistics_rate_per_min`. "Plan" is the winning plan's mean clock in minutes over 30 seeds before
any change. The verdicts are the plan of §4 and §5.

| Mission | Phase | Purse: start + base a minute | Plan (min) | Camp | Zones today | Verdict |
|---|---|---|---|---|---|---|
| `beit_sahwan_0_tutorial` | recon | 650 + 60 | - | camp | - | **out**: the tutorial pays nothing and produces no ledger |
| `beit_sahwan_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `beit_sahwan_2_foothold` | foothold | 400 + 120 | - | camp | - | **later**: waits for PR 1483 (the hold moves onto a crest zone nobody starts on) |
| `beit_sahwan_3_clearance` | clearance | 600 + 100 | 2.2 | - | - | **batch 2**: `clinic` 32 |
| `beit_sahwan_4_subterranean` | subterranean | 500 + 90 | 2.9 | - | - | **out**: an underground escort; the surface zones are the enemy's or empty |
| `beit_sahwan_breach` | breach | none | - | - | - | **out**: the breach has no purse |
| `deir_amun_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `deir_amun_2_foothold` | foothold | 400 + 120 | 6.1 | camp | `pump_yard` 28, `the_wadi` 20 | **shipped** |
| `deir_amun_3_subterranean` | subterranean | 500 + 90 | 1.6 | - | - | **batch 3**: `hamlet` 20, `spoil_field` 12 (borrows the clearance 32) |
| `ein_qasab_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `ein_qasab_2_foothold` | foothold | 400 + 0 | 6.8 | - | - | **batch 3**: `hollow` 28, `farmhouse` 20 (no base rate: zones are its only income) |
| `ein_qasab_3_buildup` | buildup | 400 + 150 | - | camp | `mill_islet` 80 | **shipped** |
| `khan_rafid_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `khan_rafid_2_foothold` | foothold | 400 + 120 | 4.3 | camp | - | **batch 1**: `ward` 48 |
| `khan_rafid_3_clearance` | clearance | 400 + 80 | 1.8 | - | - | **reserve**: only the orchards are held (22%), and nobody contests them |
| `qarn_hadid_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `qarn_hadid_2_foothold` | foothold | 500 + 130 | 3.5 | camp | - | **batch 1**: `the_gates` 32, `hollow` 16 |
| `qarn_hadid_3_clearance` | clearance | 400 + 80 | 3.6 | - | - | **out**: the plan holds no zone (the village 2%, the terraces 9%) |
| `tel_marum_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `tel_marum_2_foothold` | foothold | 400 + 120 | 4.2 | - | - | **batch 1**: `approach` 32, `overwatch_west` 16 |
| `tel_marum_3_clearance` | clearance | 400 + 80 | 2.4 | - | - | **batch 2**: `pass` 20, `overwatch_east` 12 |
| `umm_zeitoun_1_recon` | recon | none | - | - | - | **out**: recon has no purse |
| `umm_zeitoun_2_buildup` | buildup | 500 + 150 | 4.3 | camp | `crest_line` 50, `post_stone` 30 | **shipped** |
| `umm_zeitoun_3_clearance` | clearance | 400 + 80 | 2.1 | - | - | **batch 2**: `hamlet` 32 (never `horn_west`: C-R22) |
| `umm_zeitoun_4_clearance` | clearance | 600 + 100 | 5.4 | - | `stockpile` 16, `crest_top` 8, `hamlet` 8 | **shipped** |
| `wadi_halam_1_fords` | recon | none | - | - | - | **out**: recon has no purse |
| `wadi_halam_2_laager` | foothold | 400 + 120 | 7.1 | - | `pasture` 32, `ford_watch` 16 | **shipped** |
| `wadi_halam_3_counterraid` | buildup | 400 + 150 | 5.6 | camp | - | **batch 3**: `pasture` 80 (two pins move, §4.3) |
| `wadi_halam_4_village` | clearance | 400 + 80 | 3.6 | - | - | **out**: the plan holds no zone (the village is contested 90%); the one it does hold is the refuge it starts on |
| `wadi_halam_5_depot` | clearance | 400 + 80 | 5.8 | - | - | **batch 2**: `depot` 20, `village` 12 |

**The production line is not the constraint.** GH-1386 asks for "income zones and a production line". D2 (`production-numbers.md`)
gives every mission with a purse **one side-0 line at `player_start`** when it has no camp, so all 21 purse missions have a line today. Of
the five shipped zone missions, three have a physical camp (`deir_amun_2`, `ein_qasab_3`, `umm_zeitoun_2`) and two run on the
fallback line (`umm_zeitoun_4`, `wadi_halam_2`). Of the ten candidates, `khan_rafid_2`, `qarn_hadid_2` and `wadi_halam_3` have camps. **This plan adds no
camp**: a camp is a `structures[]` placement plus an exit marker, a map-adjacent content choice, and §6 says why it belongs with the
purse-binds work and not with this count. (`qasr_liwan_2_foothold` on the unmerged `cl/qasr-liwan-content` branch is the precedent the
brief names: a camp with `coast_road` 28 and `the_cut` 20. It is not on `main`, so it is not in this census.)

## 2. The rules that choose a zone

Reused from `income-numbers.md` (lead-approved 15 Oct): **ground the plan crosses, ground the enemy also wants, a full hold of every
paying zone is 40% of the phase's GDD anchor** (foothold 120 gives 48, build-up 200 gives 80, clearance 80 gives 32), integer rates,
and **no zone that holds a starting force** (it would pay a force that never moves). Three rules are new, each earned by a measurement
in §3:

- **A zone is paid only if the plan holds it.** The plan must stand in it (KDF-held) for at least 5% of the run on average and on at least
  20 of 30 seeds (`umm_zeitoun_3`'s `hamlet`, held on 23 of 30, is the borderline case that passes; its `horn_east`, held on 16, does not). A paying zone that reads empty for the whole run is what a mis-authored zone looks like on the walk
  (`income-numbers.md`, "the red").
- **"Starts there" is measured, not read off the placements.** `wadi_halam_4_village`'s `refuge` is the rectangle `[0,20,7,9]` (x 0 to 6)
  and its starting units are placed at x=7, one tile outside it, yet the still passive control **held it 100% of the run**: a force
  spreads onto the edge the moment it starts. The gate is the passive control's zone income, which must be **0** (`ZONE_PASSIVE_INCOME`),
  and the static test of §4.4 checks within two tiles of the rectangle, not inside it. The survey found five starting grounds this way:
  `khan_rafid_2` and `khan_rafid_3` `staging`, `qarn_hadid_2` `south_staging`, `tel_marum_3` `muster_ground`, `wadi_halam_4` and
  `wadi_halam_5` `refuge` (plus `deir_amun_3`'s `staging` and `plateau`).
- **A zone no wheeled vehicle reaches does not pay** (`tools/src/income_census.test.ts`, C-R22): `umm_zeitoun_3_clearance`'s `horn_west`
  reads `unreachable` for 100% of its held ticks in the survey. It is excluded by name and by a test.

Rates inside a mission: a single paying zone takes the full target; two share it between 60/40 and two thirds to one third, the primary
objective's zone first.

## 3. How it was measured (and one defect in the instrument)

`tools/src/backtest/income-probe.ts` is a preload for `playtest.ts` (`income-numbers.md`, "The measurement"). It was typed to the four D7
missions. This change adds `CENSUS_TABLES` and `CENSUS_MISSIONS` to `income-proposal.ts`, lets `tableProblems` take an allowed set, and lets
the probe and its report cover them. Still report-only: not in CI, not read by the game.

```bash
cd tools
PT_INCOME=none PT_INCOME_OUT=<dir> npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts          # the before
PT_INCOME=census-survey PT_INCOME_OUT=<dir> npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts   # every declared zone at 1 a minute
PT_INCOME=census-candidate PT_INCOME_OUT=<dir> npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts # the plan of §4
npx tsx src/backtest/income-probe-report.ts <dir> <table>
```

Each run takes about 6.5 minutes on this machine (the playtest now holds 30 missions and many variants).

**The defect.** The first `none` run (an empty table, which must be the same run as plain `pnpm playtest`) **failed**: `umm_zeitoun_4_clearance
(forward camp)` produced 0 bodies from its camp's line on every seed (`gate 11`), and its win came at 5.2 min and not 5.0, with credits 255
and not 235. The probe's wrapper over `MissionRuntime.prototype.requestBuild` forwarded `unitId` alone. Since F4 the method is
`requestBuild(unitId, line?, side = 0)`, so every plan that names a production line (the forward-camp plans) built on line 0 under the
probe. The wrapper now forwards all of its arguments. Falsification: with the fix, `diff <(sort plain.out) <(sort none.out)` is empty
(plain `pnpm playtest` exits 0, and so does the probe's `none`); before it, the diff was eight lines, all on that one plan. The earlier F2 numbers in
`income-numbers.md` predate F4 and are not affected: none of the four D7 plans names a line.

## 4. The plan, and what it does (computed)

### 4.1 The table

Full hold = 40% of the phase anchor. The subterranean mission has a base rate (90) and the GDD names no anchor for it: it borrows the
clearance trickle (32) and is flagged for the lead in §7.

| Mission | Phase, full hold | Zone, rate | What it holds, in the plan's run (KDF / Sarim / contested, % of the run) | Why this is ground that matters |
|---|---|---|---|---|
| `khan_rafid_2_foothold` | foothold, 48 | `ward` 48 | 90 / 1 / 4 | The ward is the compound the whole mission is about: `hold_for` four minutes **and** the families' `evacuate_before`. A passive player's Sarim holds half of it |
| `qarn_hadid_2_foothold` | foothold, 48 | `the_gates` 32, `hollow` 16 | gates 72 / 14 / 13; hollow 26 / 30 / 26 | The two gates are the raze and the hold; the hollow behind the start line is the `capture` secondary the enemy fights over |
| `tel_marum_2_foothold` | foothold, 48 | `approach` 32, `overwatch_west` 16 | approach 96 / 0 / 0; west shelf 16 / 20 / 0 | The approach is the four-minute hold; the west shelf is the observers' ground. **The weakest of the ten**: nobody contests the approach, so the zone rewards standing there, which is the mission's own order |
| `beit_sahwan_3_clearance` | clearance, 32 | `clinic` 32 | 83 / 13 / 0 | The clinic is the block the clearance has to take to turn the east road; the town itself is contested for 92% of a 2-minute run and no plan holds it |
| `tel_marum_3_clearance` | clearance, 32 | `pass` 20, `overwatch_east` 12 | pass 54 / 43 / 0; east shelf 51 / 32 / 0 | The pass is the `capture` primary; the east shelf is the observers' perch over it |
| `umm_zeitoun_3_clearance` | clearance, 32 | `hamlet` 32 | 48 / 8 / 45 | The hamlet is what the four families are carried out of. Never `horn_west` (C-R22); `horn_east` is held on 16 of 30 seeds only, so it is left out |
| `wadi_halam_5_depot` | clearance, 32 | `depot` 20, `village` 12 | depot 62 / 19 / 19; village 38 / 5 / 1 | The depot is the raze **and** the four-minute hold; the village is the ground the gate fight crosses |
| `ein_qasab_2_foothold` | foothold, 48 | `hollow` 28, `farmhouse` 20 | hollow 77 / 2 / 20; farmhouse 93 / 0 / 0 | The farm hollow is the five-minute hold. **No base rate**, so these zones are the mission's only income; see §4.3 and §7 |
| `wadi_halam_3_counterraid` | build-up, 80 | `pasture` 80 | 82 / 1 / 17 | The bunds are the five-minute hold while the counter-raid arrives. A single zone at the build-up anchor, 53% of its base rate |
| `deir_amun_3_subterranean` | subterranean, 32 | `hamlet` 20, `spoil_field` 12 | hamlet 59 / 21 / 20; spoil field 38 / 51 / 10 | The four routes collapse under the hamlet; the digging chief is on the spoil field |

### 4.2 Before and after (plan, 30 seeds; passive control, 30 seeds)

"Zone" is zone income earned by the winning plan, mean over 30 seeds. "Banked" is the purse unspent at the win as a share of start plus
earned (the GDD's 30% sanity rule). "Sarim zone" is what side 1 earned in the passive control from the ground the player never contests
(nothing spends it: D7, §6). Plan clock, stars, ROE and credits were compared seed by seed and are **identical** in every row except one seed of `umm_zeitoun_3` (§0.3).

| Mission | Plan wins | Clock, stars, ROE, credits | Zone | Earned before to after | Banked before to after | Passive control | Sarim zone |
|---|---|---|---|---|---|---|---|
| `khan_rafid_2_foothold` | 30/30 | same | 175 | 522 to 697 | 100% to 100% | loses 30/30, zones 0 | 119 |
| `qarn_hadid_2_foothold` | 30/30 | same | 91 | 455 to 547 | 100% to 100% | loses 30/30, zones 0 | 240 |
| `tel_marum_2_foothold` | 30/30 | same | 138 | 500 to 639 | 100% to 100% | loses 30/30, zones 0 | 80 |
| `beit_sahwan_3_clearance` | 30/30 | same | 58 | 220 to 278 | 100% to 100% | loses 30/30, zones 0 | 448 |
| `tel_marum_3_clearance` | 30/30 | same | 40 | 189 to 229 | 100% to 100% | loses 30/30, zones 0 | 160 |
| `umm_zeitoun_3_clearance` | 30/30 | same | 32 | 169 to 202 | 78% to 77% | loses 30/30, zones 0 | 160 |
| `wadi_halam_5_depot` | 30/30 | same | 89 | 464 to 554 | 100% to 100% | loses 30/30, zones 0 | 127 |
| `ein_qasab_2_foothold` | 30/30 | same | 271 | 0 to 271 | **12% to 48%** | loses 30/30, zones 0 | 208 |
| `wadi_halam_3_counterraid` | 30/30 | same | 369 | 842 to 1211 | 72% to 78% | loses 30/30, zones 0 | 378 |
| `deir_amun_3_subterranean` | 30/30 | same | 25 | 142 to 168 | 100% to 100% | loses 30/30, zones 0 | 160 |

Credits, clock and stars per mission before and after, for the record (mean, min to max): `khan_rafid_2` 4.35 min, credits 241 [230-250];
`qarn_hadid_2` 3.50, 200 [180-220]; `tel_marum_2` 4.17, 225 [198-228]; `beit_sahwan_3` 2.20 [1.64-3.58], 280 [259-290], 3 stars;
`tel_marum_3` 2.37, 285 [265-295], 3 stars; `umm_zeitoun_3` 2.12 [1.08-4.14], 262 [225-290], 3 stars; `wadi_halam_5` 5.81 [5.16-6.53],
193 [170-220]; `ein_qasab_2` 6.76 [6.48-7.10], 250 [230-255], 3 stars; `wadi_halam_3` 5.61 [5.44-5.81], 182 [160-200];
`deir_amun_3` 1.58 [1.54-1.94], 252 [250-255]. These are the same before and after.

### 4.3 Pins, constants and probes that move

The probe's output with the candidate table was diffed, line by line, against the output with none (sorted, banking lines aside). The
whole difference is below.

| What | Before | With the ten | Moved by | Action in step 2 |
|---|---|---|---|---|
| `LADDER_CREDITS` | 6923 | 6923 | nothing | none. Zone income reaches credits only through a plan's decisions, and no plan decides differently |
| `LADDER_STARS` | 68 | 68 | nothing | none |
| `ROSTER_MAX` | 26 | 26 | nothing | none |
| Time limits (`validate:data`, `time-limit`) | e.g. `umm_zeitoun_3` 840 s, slowest win 248 s | 249 s on one variant | 1 s on `umm_zeitoun_3` | none; every plan clock but that one seed is identical, so all margins (the 120 s and 20% rule) hold as measured |
| `ZONE_PASSIVE_INCOME` | 0 over the four D7 controls | 0 over all fourteen controls | nothing | **widen the check**: it reads a hard-coded list of four missions, so a new zone on a starting ground would pay a force that never moves and pass. Derive the list from the missions that author zones |
| `BANKING_OVER_30_MAX` | 15 of 20 plans bank over 30% | **16 of 20** | `ein_qasab_2_foothold` 12% to 48% | the pin is an upper bound at its ceiling. Either `ein_qasab_2` waits, or the bound goes 15 to 16 in that batch with the reason. The other nine do not move the count (eight already bank 100%; `wadi_halam_3` goes 72% to 78%) |
| `min_win_seconds` floor, `wadi_halam_3_counterraid` | 80 s, fastest win above 320 s | fastest win 317 s | floor 80 s is above a quarter of it | regenerate the floor (`plan-sweep.ts` write mode) to 79 s, with the reason; the plan's own clock is unmoved, so this is one variant's win coming earlier |
| `wadi_halam_3` "bought heli_peten vs technicals" (a gated probe, §10) | helicopter bought at 141 s, 3 technicals killed | bought at 95 s, killed 0, **dead at 199 s**, probe **FAILED** | the extra 369 logistics buy the helicopter 46 s sooner | re-solve that probe's purchase (the plan is unchanged), or leave `wadi_halam_3` out. The reason it is last |

### 4.4 The tests this adds (report-only tooling, `income-proposal.test.ts`)

Six cases pin the census tables as `income-proposal.test.ts` pins the D7 one: declared zones at integer rates on census missions only; a
D7 mission or an unknown zone refused; the candidate's full hold is 40% of each mission's own phase anchor (read from the mission file);
no candidate zone within two tiles of a starting placement, and the check trips on the five starting grounds of §2; `horn_west` is
never paid; and the candidate plus the five shipped is exactly fifteen, none twice. **Each was run red with a one-line mutation of the
implementation table, then restored:** a rate 48 to 50 (full-hold case red), a `ward` swapped for `staging` (start-ground case red), a `hamlet`
swapped for `horn_west` (C-R22 case red), a mission deleted (count case and full-hold case red), a zone renamed to one the map lacks (declared-zone
case red), and `wadi_halam_4`'s `refuge` added (three cases red). Six mutations, six red.

## 5. The order to land them: batches of 3 to 4

Each batch is one content PR with the mission JSON edit (`resources.income_zones`), the playtest before-and-after table, and the census
line. The `ZONE_PASSIVE_INCOME` derivation (§4.3) lands with **batch 1**, with its own mutation (a zone moved onto a starting ground must turn
`pnpm playtest` red).

| Batch | Missions | Census line | Pins that move | Why this order |
|---|---|---|---|---|
| 1 | `khan_rafid_2`, `qarn_hadid_2`, `tel_marum_2` | 5 to 8 | none | footholds, the shape of the shipped `deir_amun_2` and `wadi_halam_2`; all three plans bank 100% already; two have camps |
| 2 | `beit_sahwan_3`, `tel_marum_3`, `umm_zeitoun_3`, `wadi_halam_5` | 8 to 12 | none (`umm_zeitoun_3` shifts one variant's headroom by 1 s) | clearances; short plans, so small sums, but real holds. `umm_zeitoun_3` has a building plan, which the playtest measures |
| 3 (as planned; **as built differs, section 10**) | `ein_qasab_2`, `wadi_halam_3`, `deir_amun_3` | 12 to 15 | `BANKING_OVER_30_MAX` 15 to 16; `wadi_halam_3`'s floor and heli probe | the three that touch a pin or need a lead call (§7) |

**Reserves, in the order to reach for them if a mission drops out:** `beit_sahwan_2_foothold` once PR 1483 settles where its hold stands (the F2
note rejected `west_approach`, which holds the starting force, and `tunnel_mouth_west`, a 3 by 3 collapse target); then
`khan_rafid_3_clearance`, whose only held ground is three orchards (`orchard_west`, `orchard_south` 22% each, nobody contests them; a 1.8 minute plan).
`wadi_halam_4` and `qarn_hadid_3` have no honest zone: a zone for them means adding one to the map, which the map notes allow as additive
(rows untouched) and which this plan does not do.

### How `pnpm playtest` proves each stays winnable

Every batch is judged by the same four, in this order:

1. **Authored and validated:** `pnpm validate:data` (`tools/validate_income.mjs`: zone declared, none repeated) and
   `tools/src/income_census.test.ts`, which stands a side-0 squad in each authored zone on a fresh world and requires a wheeled route to
   the rear at t=0. It is automatic for every mission that authors a zone, and it already names `horn_west`.
2. **Winnable:** the full `pnpm playtest` ladder plus the 30-seed plan sweep, which holds every plan at 30 of 30 inside its time limit with a 120 s
   and 20% margin and fails on the first seed that loses.
3. **A passive player still loses and earns nothing from ground:** the 30-seed no-orders control per mission must lose on every seed, and
   `ZONE_PASSIVE_INCOME` must read 0 over every zone mission's control.
4. **Before and after, in the PR:** the §4.2 table for the batch, from `PT_INCOME=none` against the authored data, with the diff of the
   sorted output against `main`'s playtest kept as the only difference (the check that exposed §3's defect).

Per-batch mutations, named in each PR: move one zone onto the starting ground (`ZONE_PASSIVE_INCOME` red), point one at a tile the plan never
enters (the walk reads `empty` for the whole run), and drop one plan's hold below the 5% floor.

## 6. What this does not do

- **It does not make the purse bind.** In the base playtest, 15 of 20 winning plans bank over 30% (`BANKING_OVER_30_MAX`), and seven of these ten
  missions bank 100% because the plan **buys nothing** (`khan_rafid_2`, `qarn_hadid_2`, `tel_marum_2`, `beit_sahwan_3`, `tel_marum_3`, `wadi_halam_5`,
  `deir_amun_3`). A zone that pays a purse nobody spends is a scored feature, not a decision. Q3(a) is
  the work that changes it (an objective or a camp whose menu the plan wants), and a camp is the cheapest lever: `khan_rafid_2` and
  `qarn_hadid_2` already have one and their plans spend 0.
- **It does not lengthen any mission.** The plan clock is unchanged on all ten. The clearance plans win in 1.6 to 3.6 minutes, a full hold of 32 a
  minute is about 50 to 115 logistics at best, and the table above shows 25 to 89. `pnpm playtest` proves a mission winnable, not how long a human takes;
  a plan has perfect information (`scaling-debts.md`), so those short clocks must not be tuned against.
- **Side 1 earns too, and nothing spends it.** Under the zones the Sarim purse in a passive run grows by 80 to 448 per mission. D7 (no enemy camp in
  a shipped mission) still stands; the lead's Q5 ruling lifts it for missions that declare an enemy camp, at which point this income is the budget
  that production draws on. That is worth reading before the first enemy camp is authored.
- **A corridor halving is mostly inert**, as `income-numbers.md` found: the survey logs `interdicted` on `khan_rafid_2`'s `ward` for 15% of its held
  ticks and `wadi_halam_5`'s `depot` for 22%, so the halving does bite there. No mission here adds `supply_corridor`.

## 7. For the lead

1. **Is 15 exactly enough?** The plan reaches 15 with ten new missions and no slack. Reserves exist (`beit_sahwan_2` after PR 1483, `khan_rafid_3`), and each is
   weaker. The alternative is an additive map zone for `wadi_halam_4` and `qarn_hadid_3`.
2. **`deir_amun_3_subterranean` borrows the clearance 32.** The GDD gives the subterranean phase no anchor (its base is 90). Authored at 32 it
   earns 25 logistics in a 1.6 minute run. Say if it should be left out instead.
3. **`ein_qasab_2_foothold` has no base rate** (start 400, rate 0). Zones turn its only income from nothing into 271 on a 400 purse and move the
   banking pin by one. Was the absent base rate a deliberate flood-week choice? If so it is the one to leave out.
4. **`BANKING_OVER_30_MAX`** is an upper bound that already sits at its measured ceiling. Re-pinning 15 to 16 in the batch that needs it is a pin
   change with a reason, not tuning.
5. **No camps are added** (§1). If the lead wants "zones and a camp" literally on every counted mission, that is a separate content PR per mission.

## 8. Batch 1 landed (step 2, 16 Nov 2026)

`khan_rafid_2_foothold`, `qarn_hadid_2_foothold` and `tel_marum_2_foothold` now author the zones of §4.1 in `resources.income_zones`, through
existing data fields only: no `tuning.ts`, no unit stat, no sim change, no camp. The census line reads **8 of 30** (was 5):
`jq -s '[.[]|select((.resources.income_zones//[])|length>0)]|length' data/missions/*.json`.

| Mission | Zones, rate a minute | Plan wins | Slowest win, headroom | Stars | ROE | Credits | Zone income (plan mean) | Banked | Passive control | Sarim zone (passive) |
|---|---|---|---|---|---|---|---|---|---|---|
| `khan_rafid_2_foothold` | `ward` 48 | 30/30 to 30/30 | 269 s, 571 s (same) | 2 to 2 | 96.3 to 96.3 | 241 [230-250] (same) | 0 to 175 | 100% to 100% | loses 30/30, zones 0 | 119 |
| `qarn_hadid_2_foothold` | `the_gates` 32, `hollow` 16 | 30/30 to 30/30 | 210 s, 630 s (same) | 2 to 2 | 100 to 100 | 200 [180-220] (same) | 0 to 91 | 100% to 100% | loses 30/30, zones 0 | 240 |
| `tel_marum_2_foothold` | `approach` 32, `overwatch_west` 16 | 30/30 to 30/30 | 250 s, 470 s (same) | 2 to 2 | 98 to 98 | 225 [198-228] (same) | 0 to 138 | 100% to 100% | loses 30/30, zones 0 | 80 |

Compared seed by seed, **0 of 30** plan runs differ in result, clock, stars, ROE or credits on each of the three. The only lines of the whole
`pnpm playtest` output that differ from `main` are the three missions' `banking` lines (the zone income itself), two renamed banking lines
and the new census line; the credit ladder, star ladder, roster maximum, every time-limit line, every `min_win_seconds` check and every
other plan and control are byte-identical. `pnpm playtest` exits 0.

**The pins, with their Was values.**

| Pin | Was | Now | Where |
|---|---|---|---|
| `LADDER_CREDITS` | 6923 | unchanged (the plans decide identically) | `playtest.ts`, dated comment added |
| `LADDER_STARS` (and the coin table `roar_earn.test.ts` reads) | 68 | 68 | unchanged |
| `ROSTER_MAX` | 26 | 26 | unchanged |
| `BANKING_OVER_30_MAX` | 15 | 15 (all three plans already banked 100%) | unchanged |
| `ZONE_PASSIVE_INCOME` over the zone missions' passive controls | 0 over a hard-coded four | 0 over **eight**, derived from the data ("zone-mission controls found 8/8") | `playtest.ts`: the list was `['umm_zeitoun_2_buildup', 'umm_zeitoun_4_clearance', 'deir_amun_2_foothold', 'wadi_halam_2_laager']`, so `ein_qasab_3` and a new batch were not covered |
| `ZONE_MISSIONS` (new) | (5 implied) | 8 | `playtest.ts`: a floor that only rises, one batch at a time |
| `income_census.test.ts` | 5 missions, 10 zones, 3 convoys | 8 missions, 15 zones, 3 convoys | the t=0 wheeled-route census; it passed for all five new zones |
| `income-shipped.test.ts` (new) | none | the exact zones of all eight, and no stray mission | `tools/src/backtest/` |

**Falsification (run, then restored).** (1) In one `pnpm playtest`, `khan_rafid_2`'s `ward` was moved onto `staging` (a starting ground) and
`tel_marum_2`'s zones were deleted: it exited 1 with `income census: FAILED — zones on 7 missions, expected at least 8` and `banking:
FAILED — the zone missions' passive controls earned 234 from zones, expected 0`. (2) In `income-shipped.test.ts`: one zone deleted from
`qarn_hadid_2` (red), a rate 32 to 33 (red), and a stray mission given a zone (`wadi_halam_4`, red). (3) The original four-mission list
could not have seen (1): that is why it is derived now.

Batch 2 follows below.

## 9. Batch 2 landed (step 2, 16 Nov 2026)

`beit_sahwan_3_clearance` (`clinic` 32), `tel_marum_3_clearance` (`pass` 20, `overwatch_east` 12), `umm_zeitoun_3_clearance` (`hamlet` 32, never
`horn_west`) and `wadi_halam_5_depot` (`depot` 20, `village` 12) author the zones of §4.1. Existing data fields only: no `tuning.ts`, unit stat,
sim change or camp. The census line reads **12 of 30** (Was 8). Four clearances, so a full hold is 32 a minute each, on plans that win in 2.1 to 5.8
minutes.

| Mission | Zones, rate a minute | Plan wins | Slowest win, headroom | Stars | ROE | Credits | Zone income (plan mean) | Banked | Passive control | Sarim zone (passive) |
|---|---|---|---|---|---|---|---|---|---|---|
| `beit_sahwan_3_clearance` | `clinic` 32 | 30/30 to 30/30 | 215 s, 625 s (same) | 3 to 3 | 92.9 (same) | 280 [259-290] (same) | 0 to 58 | 100% to 100% | loses 30/30, zones 0 | 448 |
| `tel_marum_3_clearance` | `pass` 20, `overwatch_east` 12 | 30/30 to 30/30 | 142 s, 698 s (same) | 3 to 3 | 100 (same) | 285 [265-295] (same) | 0 to 40 | 100% to 100% | loses 30/30, zones 0 | 160 |
| `umm_zeitoun_3_clearance` | `hamlet` 32 | 30/30 to 30/30 | 248 s to 249 s, 592 s to 591 s | 3 to 3 | 92.8 (same) | 262 [225-290] (same) | 0 to 32 | 78% to 77% | loses 30/30, zones 0 | 160 |
| `wadi_halam_5_depot` | `depot` 20, `village` 12 | 30/30 to 30/30 | 392 s, 448 s (same) | 2 to 2 | 100 (same) | 193 [170-220] (same) | 0 to 89 | 100% to 100% | loses 30/30, zones 0 | 127 |

Compared seed by seed, 0 of 30 plan runs differ on `beit_sahwan_3`, `tel_marum_3` and `wadi_halam_5`. **One of 30 differs on `umm_zeitoun_3`** (seed
21, the slowest, the only seed on which that plan builds): its `inf_squad` is accepted at 190 s and not 240 s because the zone income has
reached the price, and the win comes 0.4 s later; stars, ROE and credits are the same. That is the same effect `income-numbers.md` found on
`wadi_halam_2` and `deir_amun_2`. Across the whole `pnpm playtest` output the only lines that differ from batch 1 are the four missions' banking lines, the
renamed pins (now 12 of 12 zone-mission controls, census 12 of 30) and that one time-limit line (`umm_zeitoun_3` headroom 592 s to 591 s). `pnpm playtest`
exits 0.

**The pins, with their Was values.**

| Pin | Was | Now |
|---|---|---|
| `LADDER_CREDITS` | 6923 | unchanged (dated comment: byte-identical per-mission credits) |
| `LADDER_STARS`, `ROSTER_MAX`, `BANKING_OVER_30_MAX` | 68, 26, 15 | unchanged |
| `ZONE_PASSIVE_INCOME` | 0 over 8 controls | 0 over **12** ("zone-mission controls found 12/12") |
| `ZONE_MISSIONS` | 8 | 12 |
| `income_census.test.ts` | 8 missions, 15 zones, 3 convoys | 12 missions, **21** zones, 3 convoys; a wheeled route to all six new zones at t=0 |
| `income_census.test.ts`, "horn_west is not authored" | `income_zones` empty | exactly `['hamlet']`, and never `horn_west` (Was: the test asserted no zones at all, which batch 2 had to change) |
| `income-shipped.test.ts` | the 8 rows | the 12 rows |

**Falsification (run, then restored).** One `pnpm playtest` with `tel_marum_3`'s `pass` moved onto `muster_ground` (a starting ground) and
`wadi_halam_5`'s zones deleted exited 1 on both pins: `zones on 11 missions, expected at least 12` and `passive controls earned 100 from zones, expected 0`. A `hamlet` swapped for
`horn_west` turns the census test red, and a deleted zone, a nudged rate or a stray mission turns `income-shipped.test.ts` red as in batch 1.

Batch 3 (`ein_qasab_2`, `wadi_halam_3`, `deir_amun_3`) is the one that moves pins: §4.3.

## 10. Batch 3 landed (step 2, 16 Nov 2026): the census reaches 15 of 30

`beit_sahwan_2_foothold` (`terrace_crest` 48), `wadi_halam_3_counterraid` (`pasture` 80) and `deir_amun_3_subterranean` (`hamlet` 20, `spoil_field` 12) author
the zones. Existing data fields only: no `tuning.ts`, unit stat, sim change or camp. The census line reads **15 of 30** (Was 12), the Q4 count.

**One change from the plan of §5: `beit_sahwan_2` replaces `ein_qasab_2`.** Two reasons, the second decisive. (1) PR 1483 (GH-1378 Q12) put Beit
Sahwan II's hold on a new `terrace_crest` zone that nobody starts on, which is exactly what §5 listed as the reserve's missing piece: the zone is the
`hold_for` primary, the still passive control earns **0** from it on all 30 seeds (it loses by the clock, 14 min, as 1483 intends), and the plan holds it.
(2) `ein_qasab_2`'s briefing says "You have the logistics for one outpost": the missing base rate is the mission's stated scarcity, not an
omission, and 271 logistics of zone income would contradict the line the player reads. Leaving it out also keeps `BANKING_OVER_30_MAX` at 15
(§4.3 predicted 16 with it). `ein_qasab_2` and `khan_rafid_3` are now the reserves. The two PR 1483-era numbers in this section (`beit_sahwan_2`'s plan and
control) are measured on a tree that includes it; the before and after below are both on that tree.

| Mission | Zones, rate a minute | Plan wins | Slowest win, headroom | Stars / ROE | Credits | Zone income (plan mean) | Banked | Passive control | Sarim zone (passive) |
|---|---|---|---|---|---|---|---|---|---|
| `beit_sahwan_2_foothold` | `terrace_crest` 48 | 30/30 to 30/30 | 315 s, 525 s (same) | 2, 100 (same) | 220 [220-220] (same) | 0 to 210 | 71% to 76% | loses 30/30 (by the clock), zones 0 | 32 |
| `wadi_halam_3_counterraid` | `pasture` 80 | 30/30 to 30/30 | 349 s, 371 s (same) | 2, 100 (same) | 182 [160-200] (same) | 0 to 369 | 72% to 78% | loses 30/30, zones 0 | 378 |
| `deir_amun_3_subterranean` | `hamlet` 20, `spoil_field` 12 | 30/30 to 30/30 | 116 s, 724 s (same) | 2, 86.8 (same) | 252 [250-255] (same) | 0 to 25 | 100% to 100% | loses 30/30, zones 0 | 160 |

Compared seed by seed, **0 of 30** plan runs differ in result, clock, stars, ROE or credits on all three. Across the whole `pnpm playtest` output the
only lines that differ from the tree before this batch are the three missions' banking lines, the renamed pin lines (15 of 15 zone-mission controls, census 15 of 30)
and nothing else; the credit ladder (6923), star ladder (68) and roster maximum (26) are identical. `pnpm playtest` exits 0.

**The two pins §4.3 predicted for `wadi_halam_3`, and what became of them.**

| Pin | With the zone, unfixed | Fix | Now |
|---|---|---|---|
| `wadi_halam_3` "bought heli_peten vs technicals" (a **gated** probe: a failed pin exits 1) | purchase at 95 s, six penetrations, Peten dead at 199 s with 0 kills: FAILED | the gate buys at 141 s, the second its purse first covered the Peten before the zone existed (`technicalProbe`'s `buyNotBeforeS`, a harness parameter, not a game rule) | line identical to `main`'s: accepted at 141 s, 1 penetration, 3 technicals killed, credits 180 |
| `min_win_seconds` floor 80 s | "above a quarter of the fastest win (317 s)" | none needed: that 317 s was the heli probe's own win; with its timing fixed the fastest win is back above 320 s | 29 of 29 floors clean; `data/accounts/min_win_seconds.json` is **not** rewritten |

**What the heli gate proves, why 141 s, and what that pinning hides.** The gate proves one thing (GH-868): a bought Peten sent at the technicals' road takes at least 5 penetrations before it
dies, none costing more than 25% of its hull, scores a kill, and the mission is still a victory at no fewer stars. That is a statement about the Peten meeting a technical, not about the economy, and "as
soon as the purse allows" tied it to the purse: with the zone the first affordable second is 95 s, not 141 s, so the gate would have moved with income. It is pinned to the second it was written around so it keeps testing
what it tests.

**The real result, which the pinning would otherwise hide:** bought the moment the purse allows (95 s with `pasture` 80), the Peten is on the field at 137 s, 46 s sooner, meets the technicals at 189 s, takes six
penetrations (worst single cost 17.6% of its hull, five samples) and is **lost at 199 s with no kill**; the mission is still a VICTORY at 2 stars, ROE 100 (credits 190, clock 5.6 min). A player who
rushes the helicopter on this mission now loses it, where before the same player bought it 46 s later and it killed three technicals. That is a consequence of the income, not a defect of the gate, and nothing was tuned for it: sim
balance is parked. To print it: `PT_PETEN_BUY_AT=0 npx tsx src/backtest/playtest.ts` from `tools/` (any second works); the gate goes red on it, as it should, and the `min_win_seconds` line goes red with it for the reason above.

**Other pins.** `ZONE_MISSIONS` 15 (Was 12); `ZONE_PASSIVE_INCOME` 0 over **15** controls ("found 15/15"); `BANKING_OVER_30_MAX` 15 (unchanged); `income_census.test.ts` reads 15 missions, **25** zones, 3 convoys
(Was 12, 21, 3), with a wheeled route to `terrace_crest`, `pasture`, `hamlet` and `spoil_field` at t=0; `income-shipped.test.ts` carries the 15 rows. The static
start-ground check in `income-proposal.test.ts` stays at **two** tiles for every mission. `terrace_crest` begins two tiles from a placement (x=8 against a placement at x=6) and the measurement says it does not pay a still
force, so it is a **named exemption** (`START_GROUND_EXEMPT`) that cites the measurement, covers the one-to-two-tile band only (a zone within one tile can never be exempted: that is `wadi_halam_4`'s `refuge`, which paid) and carries a demotion
assertion that fails when the placement or the zone moves, so the entry gets deleted. The measured gate, `ZONE_PASSIVE_INCOME`, is the authority; the static check is the early warning.

**Falsification (run, then restored).** One `pnpm playtest` with `beit_sahwan_2`'s `terrace_crest` moved onto `west_approach` (the starting ground) and `deir_amun_3`'s zones deleted
exited 1: `zones on 14 missions, expected at least 15` and `passive controls earned 637 from zones, expected 0`. Mutations of the implementation are listed in the batch 3 PR.

**What 15 of 30 does not claim** is §6: eight of the fifteen plans that now author zones still buy nothing (`khan_rafid_2`, `qarn_hadid_2`, `tel_marum_2`, `beit_sahwan_3`, `tel_marum_3`, `wadi_halam_5`, `deir_amun_3`, `umm_zeitoun_4`), so the income is real and unspent until the purse-binding work (Q3a) gives the player a reason to spend it.

## Reproducing

The numbers above come from a clean checkout of `main` at `55e5595d3` with the probe fix and the two tables of this change:

```bash
cd tools
npx tsx src/backtest/playtest.ts                                    # the baseline, exit 0, unchanged by this change
PT_INCOME=none            PT_INCOME_OUT=/tmp/p npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts   # identical to the line above
PT_INCOME=census-survey   PT_INCOME_OUT=/tmp/p npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts   # who holds what
PT_INCOME=census-candidate PT_INCOME_OUT=/tmp/p npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts  # §4; exit 1 on the two pins of §4.3
cd .. && pnpm vitest run tools/src/backtest/income-proposal.test.ts
```
