# Held-ground income: the zones and the rates (F2 Task 2, G-NUM)

> **APPROVED by the lead (15 Oct 2026) and shipped in F2 Task 8.** The table under "The proposal"
> is the shipped `resources.income_zones` of the four D7 missions, verbatim, and the UZ II convoy
> entry is the west rim (3,31) (`data/maps/umm_zeitoun_2.json`, marker `supply_entry`; pinned in
> `tools/src/umm_zeitoun_ground.test.ts`, which records that the 15 Oct ruling superseded the 6 Oct
> argmin rule on UZ II). **Ruling C-R23: `umm_zeitoun_4` keeps (24,47)**: the measured candidate the
> lead approved was UZ II's west rim, and on UZ IV no flank entry was ever cut. Below this block the
> text is the proposal as it was measured, before the answer: every number was measured with the
> zones authored IN MEMORY on the parsed mission, through the real `MissionRuntime` (Task 7) and
> the real `pnpm playtest` ladder, plan sweep and passive sweep, and the shipped data reproduces
> them (UZ II passive convoy cut 30/30, base earned 580 [524-605]). `tools/src/income_census.test.ts`
> now holds every authored zone and convoy to a wheeled route at t=0.

**Date:** 2026-10-15. **Scope:** GH-183 F2, plan `docs/superpowers/plans/2026-10-04-gf2-held-ground-income.md`,
Task 2 (rulings C-R1, C-R2: Task 2 runs after Task 7 and is measured on the runtime). **Base:**
branch `feat/gf2-held-ground` at `8791ded5`. Every number is **(M)** measured unless marked **(R)**
reasoned. "30 seeds" is `SWEEP_SEEDS` (424242 and 1..29), the set `pnpm playtest` holds every plan
and every passive control to.

## The proposal

| Mission (map) | Phase, GDD anchor | Zones that pay, logistics a minute | Full hold | Convoy entry |
|---|---|---|---|---|
| `umm_zeitoun_2_buildup` (`umm_zeitoun_2`) | build-up, ~200 | `crest_line` 50, `post_stone` 30 | 80 | `supply_entry` (24,47) |
| `umm_zeitoun_4_clearance` (`umm_zeitoun_4`) | clearance, ~80 | `stockpile` 16, `crest_top` 8, `hamlet` 8 | 32 | `supply_entry` (24,47) |
| `deir_amun_2_foothold` (`deir_amun_2`) | foothold, ~120 | `pump_yard` 28, `the_wadi` 20 | 48 | none (no `supply_corridor`) |
| `wadi_halam_2_laager` (`wadi_halam_2`) | foothold, ~120 | `pasture` 32, `ford_watch` 16 | 48 | none (no `supply_corridor`) |

As mission JSON (the lead's data commit, Task 8, would add exactly this under `resources`, and empty
`CORRIDOR_ENTRY_EXEMPT` in `tools/validate_income.mjs`, with its demotion test in
`tools/src/validate_income.test.ts`, for the two UZ missions):

```json
"umm_zeitoun_2_buildup":   "income_zones": [{"zone": "crest_line", "rate_per_min": 50}, {"zone": "post_stone", "rate_per_min": 30}], "supply_entry": "supply_entry"
"umm_zeitoun_4_clearance": "income_zones": [{"zone": "stockpile", "rate_per_min": 16}, {"zone": "crest_top", "rate_per_min": 8}, {"zone": "hamlet", "rate_per_min": 8}], "supply_entry": "supply_entry"
"deir_amun_2_foothold":    "income_zones": [{"zone": "pump_yard", "rate_per_min": 28}, {"zone": "the_wadi", "rate_per_min": 20}]
"wadi_halam_2_laager":     "income_zones": [{"zone": "pasture", "rate_per_min": 32}, {"zone": "ford_watch", "rate_per_min": 16}]
```

`beit_sahwan_2_foothold` left D7 on 6 Oct and is not proposed. For the record: its map declares two
zones, `west_approach` [0,12,16,24] (the whole starting force, the camp, `player_start`, and the
`hold_for` primary) and `tunnel_mouth_west` [30,23,3,3] (the `collapse` target). Paying the first pays
its passive control by construction; paying only the second pays a 3x3 tile the plan visits to charge
a tunnel. Neither is held ground in the sense of this document, which is why it left.

The table is code as well as prose: `tools/src/backtest/income-proposal.ts` (`INCOME_TABLES.proposal`),
held by `income-proposal.test.ts` (zones declared, rates integers >= 1, each full hold exactly the
40% anchor, no proposed zone over a starting placement).

## Step 1: which zones, and why

Three rules from the plan: ground the plan crosses, ground the enemy also wants, and at least one zone
per mission whose corridor runs over ground the enemy can reach. A fourth was added here and is the
one the lead most needs to rule on: **no zone that holds the starting force pays**, because a zone a
force is placed in pays a passive control by construction (below, ZONE_PASSIVE_INCOME). That rules
out `staging` on UZ II and DA II. The alternative that pays them is measured too.

Every zone below was first surveyed at 1 a minute on every declared zone of the four maps (the
`survey` table) to see who stands in it and when. Percentages are of the plan's ticks, over 30 seeds.

**UZ II, `crest_line` [18,30,13,3] and `post_stone` [21,22,4,3].** The crest is the `hold_for`
primary: the plan holds it 77% of the mission (empty the rest, never contested) (M). **(R)** The
180 s and 300 s waves are expected to march into it (`rim_crest` is inside it): the probe prints no
wave path or per-wave contact, so this is read off the mission file, not measured. The post is the `raze`/`capture` target, the
Sarim picket's ground: Sarim holds it from the start (100% in the passive control), the plan takes it
24% of the time and leaves it for the crest at 100 s. Forward ground is the smaller rate because the
plan does not stay; the crest is where the player is asked to stand. Both corridors run back over the
vineyard terraces east of the crest to the camp (routes below).
Not proposed: `staging` [18,42,12,3] (the start; passive income 80 under the alternative).

**UZ IV, `stockpile` [28,2,10,9], `crest_top` [13,5,5,4], `hamlet` [18,25,14,11].** The stockpile is
the `raze` primary and the depot's yard: Sarim 46%, contested 24%, KDF 30% (the armour drives in from
100 s). The crest is Adhal's: Sarim holds it 71%, KDF 14% after the stockpile falls. The hamlet is the
ground every party crosses on the way north (KDF 22%, never Sarim). The two forward corridors are the
longest in the proposal (41 and 44 tiles, up x=33-34 and up the west road). Clearance is the phase
whose anchor is a trickle, so the three rates are small and the stockpile carries half.
Not proposed: `north_shelf` [31,1,4,3], a 4x3 shelf inside the stockpile's footprint that the plan
never stands on (empty 100% of every run in the survey).

**DA II, `pump_yard` [11,24,10,9] and `the_wadi` [0,36,48,3].** The yard is the `hold_for` primary
and the tunnel mouth: Sarim holds it from tick 0 (100% in the passive control), the plan takes it
64%, contested 32%. The wadi is the crossing between the start and the yard, a full-width band the
plan holds 61% (the Yahalom and the mortar stand south of it, the hold force north). Its corridor is
the one that reaches back across the whole staging ground.
Not proposed: `staging` (the start; passive income 32 under the alternative), `hamlet` and
`north_bank` (Sarim's for the whole of every run; the plan never enters the hamlet, which is its
flagged ROE ground), and `store_yard` (the `capture` secondary: empty for the whole of every plan run
in the survey, so a paying zone there would read as mis-authored on the walk until a plan takes it).

**WH II, `pasture` [13,15,14,17] and `ford_watch` [4,4,10,7].** The pasture is the `hold_for`
primary and the `raze` target: KDF 69%, contested 29%; Sarim holds it for the whole passive run. The
ford watch is the `capture` secondary, Sarim's raiders' crossing: the plan's AT team takes it at once
and then joins the hold when `keep_ford` completes, so the plan holds it only 9% of the time (about
37 s). That is the plan's choice, not the zone's fault: a player paid to stay there could stay.
Not proposed: `refuge` [2,37,7,6] (the civilians' refuge; empty all run) and `east_road` [40,22,8,4]
(the Sarim spawn `rif_east`; Sarim's all run).

## Step 2: the rates

The anchor (plan Step 2, controller addendum): **a full hold of every paying zone adds about 40% of
the phase's GDD anchor** (docs/GDD.md, "Economy anchors"): foothold 120 -> 48, build-up 200 -> 80,
clearance 80 -> 32. Each mission is priced against its own `phase` field: UZ II `buildup`, UZ IV
`clearance`, DA II and WH II `foothold`. Every rate is an integer >= 1 (the schema's rule, Task 3).

Two things the lead may want to know before ruling. **(R)** The anchor is the GDD's, not each
mission's own base rate: UZ II's base is 150 (40% of that is 60, not 80) and UZ IV's is 100 (40, not
32). Anchoring on the base would raise UZ IV by 8 and lower UZ II by 20. And a full hold is never what
a plan earns: the measured zone income per plan run is below, and it is 7-23% of what the run earned
in total, because no plan holds every zone for the whole mission.

Radii and cadence are Task 6/7's, unchanged: interdiction 2 tiles (`CORRIDOR_INTERDICT_SQ` 262144),
vent 3 tiles (`CORRIDOR_VENT_SQ` 589824), contest 6 tiles (`CONTEST_RADIUS_SQ` 2359296), recheck
every 20 ticks (`CORRIDOR_RECHECK_TICKS`).

## Step 3: the yardstick

The GDD's rule (docs/GDD.md, "Economy anchors"): **banking more than 30% unspent at a win means
income is too high or objectives too cheap.** Banking here is `held / (logistics_start + earned)` at
the run's last tick, read off the runtime (`logistics`, `logisticsEarned(0)`); Task 9 adds the same
line to `pnpm playtest` for every economy mission. The 16-of-18 reading the plan quotes was taken at
`751b6742`, before GH-382 and #402, and is not re-measured here (it needs Task 9's line).

**F2 alone is expected to make banking worse** (more income, nothing new to buy) until F4 gives the
player something to spend on. So **do not tune F2's rates against F2's banking number.** The
measurement agrees, and shows why the number is not even monotone in the rate: on the four D7 plans,
the two that never spend (UZ II, UZ IV) bank 100% before and after; WH II goes 4.9% -> 15.0%; and DA
II goes **down**, 23.0% -> 11.6%, because the extra income crosses the price of one more `inf_squad`
(292) and the plan's fixed build schedule buys it.

## The measurement

**How (M):** `tools/src/backtest/income-probe.ts` is a preload for `playtest.ts` that replaces the four
missions in the parsed `missions` object with copies carrying `income_zones` (and `supply_entry`), and
records each run of those missions by wrapping `MissionRuntime`'s `start`/`step`/`requestBuild` and
reading only its public getters. The ladder, the plan sweep and the passive sweep run unchanged (the
sweeps fork with `process.execArgv`, so they load the preload too). With the empty table (`none`) the
probed run's output is **identical to the `8791ded5` baseline** (`playtest-base2.txt`) bar line order
of the worker output and the wall-clock line: the preload itself moves nothing. Each table costs one
full `playtest` run, 66-69 s on this machine.

```bash
cd tools
PT_INCOME=proposal PT_INCOME_OUT=<dir> npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts
npx tsx src/backtest/income-probe-report.ts <dir> proposal
```

Tables: `none`, `survey` (every declared zone at 1), `proposal`, `proposal+staging`, `alt-entry-west`,
`alt-entry-east`, `red`. Report-only, no gate, not in CI.

### Outcomes: every plan still wins, every passive control still loses

| Mission | Plan, 30 seeds (none -> proposal) | Passive control, 30 seeds |
|---|---|---|
| UZ II | VICTORY 30/30 -> 30/30 | DEFEAT 30/30 -> 30/30 |
| UZ IV | VICTORY 30/30 -> 30/30 | DEFEAT 30/30 -> 30/30 |
| DA II | VICTORY 30/30 -> 30/30 | DEFEAT 30/30 -> 30/30 |
| WH II | VICTORY 30/30 -> 30/30 | DEFEAT 30/30 -> 30/30 |

The whole `pnpm playtest` exits 0 under the proposal (and under `proposal+staging`): every other
plan and control in the ladder holds too, `LADDER_CREDITS` and `ROSTER_MAX` hold, and the max-tier,
gate-open and bought replays of the four missions all win.

### Credits, stars, ROE, clock: before vs after (plan, 30 seeds, mean [min-max])

| Mission | Minutes | Stars | ROE | Credits |
|---|---|---|---|---|
| UZ II | 5.22 [4.97-5.33] -> same | 2 -> 2 | 100 -> 100 | 225 [210-230] -> same |
| UZ IV | 4.16 [3.65-4.65] -> same | 2 -> 2 | 95.0 [76-100] -> same | 234 [203-265] -> same |
| DA II | 6.15 [5.88-6.56] -> same | 2 -> 2 | 97 -> 97 | 224 [207-247] -> same |
| WH II | 6.82 [6.44-7.39] -> 6.80 [6.49-7.44] | 2 -> 2 | 100 -> 100 | 174 [150-190] -> 177 [160-190] |

Per seed: UZ II and UZ IV read the same clock, stars, ROE and credits on all 30 (they never spend, so income reaches no
decision). DA II's clock, stars, ROE and credits are identical on all 30; only its builds move. WH II's
clock moves on all 30 seeds (by -0.78 min on seed 1, 7.38 -> 6.60; +0.20 on seed 21; -0.22 on 424242;
the rest within ±0.13) and its credits on 16 (by ±10, twice +20), both ways: the earlier fourth squad
changes the fight, not the grade. On seed 424242, `pnpm playtest`'s own lines
move exactly as follows: DA II `roster out` 9 -> 10 (plain, max tier) and 8 -> 9 (gate open), its
end population 13 -> 14, the Deir Amun chain's max roster 9 -> 10; WH II 6.7 -> 6.5 min (max tier 6.8 ->
6.6), its peak/end population 12 -> 11, its intel at 300 s 376 -> 354 (end total 480 unchanged);
WH II's time-limit line, slowest win 444 -> 446 s (headroom 396 -> 394 s); downstream, WH III's 30-seed
slowest win 5.5 -> 5.6 min (headroom 388 -> 386 s); and the
campaign's credits an hour 2781 -> 2786. Nothing else in the 489 lines moves.

### Build timing (the two building plans)

| Mission | Builds accepted, 30 seeds | Seed 424242, accepted at |
|---|---|---|
| DA II (schedule: every 40 s, 60-420 s) | 3 on 30/30 -> **4 on 30/30** | 60, 100, 260 s -> 60, 100, **220, 340** s |
| WH II (schedule: every 60 s, 90-700 s) | 4 on 29/30, 3 on 1 -> **4 on 30/30** | 90, 150, 270, 390 s -> 90, 150, **210, 330** s |

Mean third and fourth build, 30 seeds: DA II 260 s -> 220 s, and a fourth at 340 s where there was
none; WH II 270 -> 210 s and 390 -> 330 s. A plan does not gain orders in F2 (plan Task 9 Step 2):
this is the same schedule finding the purse full sooner.

### Banking (end of run; earned excludes `logistics_start`; banked = held / (start + earned))

| Mission | Plan: earned (zones), held, banked — none -> proposal | Passive: earned (zones), banked |
|---|---|---|
| UZ II (start 500) | 783 (0), 1283, 100% -> 1020 (237), 1520, 100% | 750 (0), 100% -> 750 (0), 100% |
| UZ IV (start 600) | 416 (0), 1016, 100% -> 448 (32), 1048, 100% | 500 (0), 100% -> 500 (0), 100% |
| DA II (start 400) | 737 (0), 261, 23.0% -> 922 (184), 154, 11.6% | 480 (0), 100% -> 480 (0), 100% |
| WH II (start 400) | 819 (0), 60, 4.9% -> 975 (159), 207, 15.0% | 600 (0), 100% -> 600 (0), 100% |

Means over 30 seeds; ranges in the report (task-2-report.md). Winners over 30% among the four:
2 of 4 before (UZ II, UZ IV) and 2 of 4 after (the same two). They bank everything because their
plans buy nothing, which is F4's question, not F2's.

**Sarim earns too (D6), and it is not small.** Side 1's zone income under the proposal, per run: in
the passive controls UZ II 170, UZ IV 120, DA II 112, WH II 160 (it holds `post_stone`, the
stockpile and crest, the yard, the pasture); against the plans 15, 54, 8, 4. Nothing spends side 1's
purse until F4, so it changes no outcome today; it is the budget F4's production will draw on.

### ZONE_PASSIVE_INCOME

Zone income earned by the four passive controls (Task 9's pin):

| Table | Seed 424242 | All 30 seeds (120 runs) |
|---|---|---|
| none | 0 | 0 |
| **proposal** | **0** | **0** |
| proposal+staging (UZ II `staging` 16 / `crest_line` 40 / `post_stone` 24; DA II `staging` 8 / `pump_yard` 24 / `the_wadi` 16; same full holds) | 112 (UZ II 80, DA II 32) | 3360 |

**Recommendation: the proposal, which pays no starting zone, so ZONE_PASSIVE_INCOME pins at 0.** A
force that never moves earns nothing from ground, which is the GDD's "logistics accrues, and banking it
is the losing move" in its sharpest form. Paying `staging` also buys the plans nothing: under the
alternative the plans leave the UZ II start at once (KDF 2% of the run) and DA II's mortar stands in
`staging` all mission, so the alternative moves no plan outcome either (identical lines), and only the
passive controls gain. If the lead wants the start to pay (a "home" income), the alternative row is
measured and safe: every plan still wins and every control still loses.

### Corridors: never cut, on any plan, on any seed

Over 30 seeds, **no proposed zone's corridor was cut on any plan or passive run, and neither UZ convoy
was cut** (the walk reads `open` throughout). D4(b) needs a Sarim unit within 2 tiles of a route tile
with no KDF unit within 6 tiles of that tile. **(R)** Every zone's route starts inside the zone, where
its holders stand, and runs back into the player's own rear, where no wave on these four missions goes
against the scripted plans; a holder lost makes the zone pay nobody before any cut could matter. The
vent cause (c) is out of reach on DA II: its vents are (13,21) and (33,12), and the nearest proposed
route tile, `pump_yard`'s (16,28), is 7.6 tiles from the first (the cut radius is 3).

The counter is not blind: with `CORRIDOR_INTERDICT_SQ` widened to 12 tiles in a scratch run (reverted,
never committed), the same probe reads `crest_line`, `post_stone` and `crest_top` cut for 100% of their
held ticks, `the_wadi` 33%, `pump_yard` 21%, `pasture` 9%, and UZ II's passive convoy cut on 30/30
seeds.

So the halving half of F2 is inert on the four plans as scripted. That is a finding for the lead, not
something F2's numbers should fix: making a corridor bite is mission content (a raid that goes for the
line: `mission-author`), or a model choice (the radii, ruled 6 Oct: contest stays 6), not a rate.

### The walk (plan, seed 424242, every 30 s; state = who holds it; income a minute = base + zones)

`kdf`, `sarim`, `empty`, `contested`; a cut would print as `kdf/interdicted` etc. and none occurs.

**UZ II** (`crest_line`, `post_stone`, convoy):

```
   30s  kdf    sarim  open   592  150+50
   60s  empty  kdf    open   689  150+30
   90s  empty  kdf    open   779  150+30
  120s  kdf    kdf    open   883  150+80
  150s  kdf    empty  open   987  150+50
  ... kdf / empty / open to the end ...
  312s  kdf    empty  open  1528  150+50
```

**UZ IV** (`stockpile`, `crest_top`, `hamlet`, convoy):

```
   30s  sarim      sarim  empty  open  650  100+0
   60s  sarim      sarim  empty  open  700  100+0
   90s  sarim      sarim  empty  open  750  100+0
  120s  contested  sarim  kdf    open  803  100+8
  150s  contested  empty  empty  open  855  100+0
  180s  kdf        kdf    empty  open  915  100+24
  210s  kdf        kdf    kdf    open  978  100+32
  220s  kdf        kdf    empty  open  999  100+24
```

**DA II** (`pump_yard`, `the_wadi`):

```
   30s  contested  empty      465  120+0
   60s  contested  kdf        525  120+20
   90s  contested  empty      295  120+0
  120s  contested  kdf         68  120+20
  150s  kdf        kdf        148  120+48
  180s  kdf        kdf        232  120+48
  210s  kdf        kdf        316  120+48
  240s  kdf        kdf        108  120+48
  270s  contested  kdf        190  120+20
  300s  kdf        kdf        270  120+48
  330s  kdf        kdf        354  120+48
  360s  kdf        contested  139  120+28
  373s  kdf        contested  171  120+28
```

**WH II** (`pasture`, `ford_watch`):

```
   30s  kdf        kdf    473  120+48
   60s  contested  empty  546  120+0
   90s  contested  empty  616  120+0
  120s  kdf        empty  396  120+32
  150s  contested  empty  470  120+0
  180s  contested  empty  252  120+0
  210s  kdf        empty  324  120+32
  240s  kdf        empty  105  120+32
  270s  kdf        empty  177  120+32
  300s  contested  empty  251  120+0
  330s  contested  empty  317  120+0
  360s  kdf        empty  100  120+32
  390s  kdf        empty  171  120+32
```

**No proposed zone reads empty-or-contested for the whole of any plan run, on any of 30 seeds.** The
lowest: `ford_watch` held 9% of WH II (the picket leaves once `keep_ford` completes, above), and
`crest_top` never held by the KDF on 1 of 30 UZ IV seeds (M). **(R)** Whether Sarim held it or it stood
empty on that seed is not recorded: the probe prints each owner's share across the 30 seeds (kdf 14%,
sarim 71%, empty 15%), not per run.

**The red (plan Task 8 Step 4), shown once:** the `red` table points `ford_watch` at [0,44,3,3], open
ground in WH II's south-west corner that the plan never enters. Its walk reads `empty` at every row,
100% of the run, never held, on the plan (seed 424242) and on all 30 passive seeds, while `pasture`
reads exactly as above. That is what a mis-authored zone looks like on the walk.

### Corridor routes (from the runtime's `route`, tiles `x,y`, zone -> holder's rear)

The rear is the camp's exit where the mission builds one (UZ II (19,42), DA II (20,34)), else
`player_start` (UZ IV (24,45), WH II (3,24)) (C-R17).

- **UZ II `crest_line` (35):** 24,31 25,31 26,31 27,31 27,32 28,33 29,33 30,33 31,33 32,33 33,33 34,33 35,34 35,35 35,36 35,37 34,38 33,38 32,38 31,38 30,38 29,38 28,38 27,38 26,38 25,38 24,39 24,40 24,41 24,42 23,42 22,42 21,42 20,42 19,42
- **UZ II `post_stone` (42):** 23,23 24,24 24,25 25,25 26,25 27,26 27,27 27,28 27,29 27,30 27,31 27,32 28,33 then as `crest_line` from 29,33 to 19,42
- **UZ II convoy (11):** 24,47 24,46 24,45 24,44 24,43 24,42 23,42 22,42 21,42 20,42 19,42
- **UZ IV `stockpile` (41):** 33,6 33,7 33,8 33,9 33,10 33,11 33,12 33,13 34,14 34,15 34,16 34,17 34,18 34,19 34,20 34,21 34,22 34,23 34,24 34,25 34,26 34,27 34,28 33,29 33,30 32,31 31,32 31,33 30,34 29,35 28,36 27,36 26,37 25,38 24,39 24,40 24,41 24,42 24,43 24,44 24,45
- **UZ IV `crest_top` (44):** 15,7 16,8 17,8 18,8 19,8 20,8 21,8 21,9 21,10 20,11 20,12 20,13 20,14 19,15 19,16 19,17 18,18 18,19 18,20 18,21 18,22 18,23 17,24 17,25 17,26 17,27 18,28 18,29 18,30 19,31 19,32 20,33 20,34 21,35 22,36 23,37 24,38 24,39 24,40 24,41 24,42 24,43 24,44 24,45
- **UZ IV `hamlet` (19):** 25,30 26,31 26,32 26,33 27,34 28,34 29,34 29,35 28,36 27,36 26,37 25,38 24,39 24,40 24,41 24,42 24,43 24,44 24,45
- **UZ IV convoy (3):** 24,47 24,46 24,45
- **DA II `pump_yard` (11):** 16,28 15,29 15,30 15,31 15,32 15,33 16,33 17,33 18,34 19,34 20,34
- **DA II `the_wadi` (18):** 23,37 23,38 23,39 23,40 23,41 22,41 21,41 20,41 19,41 18,40 18,39 18,38 18,37 18,36 18,35 18,34 19,34 20,34
- **WH II `pasture` (19):** 20,23 20,24 19,24 18,24 17,24 16,24 15,24 14,24 13,24 12,24 11,24 10,24 9,24 8,24 7,24 6,24 5,24 4,24 3,24
- **WH II `ford_watch` (18):** 9,7 9,8 9,9 9,10 9,11 9,12 8,13 7,14 6,15 5,16 4,17 3,18 3,19 3,20 3,21 3,22 3,23 3,24

## For the lead: the UZ convoy entry

The 6 Oct rule put `supply_entry` at (24,47) on both UZ maps, two tiles behind `player_start` (24,45)
(Task 3). Measured: the convoy route is **11 tiles on UZ II** (to the camp's exit at (19,42)) and **3 on
UZ IV** (to `player_start`), and it was **cut on 0 of 30 seeds, plan and passive, on both**. D2's
halving of the base rate is therefore inert on the two missions that declare `supply_corridor: true`.

What an entry on contested ground does, measured with a marker added IN MEMORY (a real one is a map
edit, the lead's call; no road reaches a map edge on either map, so there is no road-led choice):

| Entry (in memory) | Convoy route | Plan: convoy cut | Passive: convoy cut, base earned |
|---|---|---|---|
| UZ II (24,47), shipped | 11 tiles | 0/30 | 0/30, 750 |
| UZ II west rim (3,31) | 68 tiles (along y=30, the knoll road, the crest's corridor) | 1/30 | **30/30**, 580 [524-605] |
| UZ II east rim (44,31) | 33 tiles | 0/30 | **29/30**, 735 [724-750] |
| UZ IV (24,47), shipped | 3 tiles | 0/30 | 0/30, 500 |
| UZ IV west edge (0,30) | 36 tiles | 0/30 | 0/30, 500 |
| UZ IV east edge (47,40) | 33 tiles | 0/30 | 0/30, 500 |

Every plan still wins 30/30 and every control still loses 30/30 with either alternative entry. On UZ
II a flank entry does make the convoy bite, and it bites the player who does nothing (the Sarim waves
walk across an undefended line) while the plan, which holds the ground the line runs under, keeps it
open. On UZ IV no flank entry is cut even then. (R) If the lead wants the convoy to matter, the UZ II
west rim is the measured candidate; it needs a `supply_entry` marker moved on `umm_zeitoun_2` and the
pin in `umm_zeitoun_ground.test.ts` changed with it.

## What the lead is asked

1. The zone choice and rates in the table above (or a different row; the probe re-measures a table in
   about 70 s).
2. Whether a starting zone may pay (recommended: no; ZONE_PASSIVE_INCOME 0 vs 112).
3. Whether the GDD anchor or each mission's own base rate is the 40% reference (UZ II 80 vs 60, UZ IV
   32 vs 40).
4. Whether the UZ convoy entry stays at (24,47) (inert) or moves to a flank (UZ II west rim measured).
5. Noted, not asked: corridors are never cut on these four plans as scripted; making one bite is
   content (a raid on the line), not a rate.
