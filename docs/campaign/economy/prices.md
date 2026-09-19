# Unlock prices — the Buy step

**Date:** 2026-09-16. **Scope:** spec `2026-09-15-brigade-economy-design.md` §8 step 2
("Buy"). `unlock.price` for the twelve KDF units that carry an earned gate. No engine
code touched; no unit JSON edited. Everything below is measured against this worktree's
`pnpm playtest` output and `data/units/kdf/*.json`, both read on 2026-09-16.

**Addendum, WP-G-E1, 2026-09-18 (GH-173):** the lead acted on finding 1 below and raised
the nine Conduct floors from 35-65 to 70-90 (§3.3) and decided finding 2 -- `breach_team`
keeps its 850 price, the §4.2 cap exception is accepted rather than fixed (§3.4). Prices
themselves are unchanged; nothing in §2, §4-§8 or §10 moved. `LADDER_CREDITS` (5531,
re-pinned 2026-09-17 for an unrelated reason -- see `tools/src/backtest/playtest.ts`'s own
comment) is unchanged by this addendum too: no scripted plan in the ladder builds or buys
any of these nine units, they are all fielded through `starting_force`, which does not
consult `unlock` at all.

## 1. Method

```
pnpm playtest > playtest_full.txt
```

captured all 119 lines, including every `<mission>: credits N` line, the three star-gate
open/closed lines, and the pinned `credit ladder: 5544 over 26 missions`. The 26-mission
`world.json` region -> town -> mission order (`marj`: beit_sahwan x5, khan_rafid x3,
deir_amun x3; `sur`: tel_marum x3, qarn_hadid x3, umm_zeitoun x4; `naharin`: wadi_halam
x5) was read from `data/campaign/world.json` and cross-checked against
`tools/src/backtest/playtest.ts`'s own `missionOrder` construction (region -> town ->
mission, the loop at its Task 7 section) and the `GATES` table pinning the three star
gates at missions 6/15/22.

For each mission's plain `label === id` victory line (never a `(passive control)`,
`(no orders)` or `(gate open)` variant — those are controls or force-change probes and
are not summed into the ladder, per `playtest.ts`'s own guard), the credits value and the
ROE score were read directly off the printed line. These 26 numbers were re-summed with a
small script (`/private/tmp/.../scratchpad/brigade-buy/ladder.py`) and reproduce
`5544` exactly, confirming the transcription.

The ★★★ ladder is not something the harness prints (only one mission,
`qarn_hadid_1_recon`, is actually run at 3 stars by its winning plan). Per the task's
instruction, it was **re-derived** from `creditsFor`'s own weights
(`packages/sim/src/credits.ts`): the only term that changes between a ★★ and a ★★★
finish of the same mission is `carryingComplete * 40` (`CREDIT_WEIGHTS.carryingSecondary`).
`grade.ts`'s `starsFor` says a mission with **zero** `carries` objectives has a ★★ ceiling
(`carrying.length === 0` returns `2` outright) — so most of the ladder cannot reach three
stars at all, and its ★★★ value equals its ★★ value. Six missions declare at least one
`carries: true` objective (`data/missions/*.json`, confirmed by grep):
`beit_sahwan_1_recon`, `khan_rafid_1_recon`, `deir_amun_1_recon`, `qarn_hadid_1_recon`,
`umm_zeitoun_1_recon`, `umm_zeitoun_3_clearance`. For each, the plain victory line's own
objective-status letters (`c` = complete) were read against its carries list to count how
many carries objectives that ★★ plan leaves incomplete, and `+40` was added per
incomplete one:

| mission | carries objectives | status in the ★★ plan | incomplete | ★★★ adds |
|---|---|---|---|---|
| beit_sahwan_1_recon | hvt_seen, find_the_column | a, c | 1 | +40 |
| khan_rafid_1_recon | find_the_west_lane, find_the_east_lane, find_the_block_commander | a, c, c | 1 | +40 |
| deir_amun_1_recon | find_the_chief, find_the_gap_gun | a, a | 2 | +80 |
| qarn_hadid_1_recon | find_the_tube, find_the_bench_post, find_the_ditch_gun | c, c, c | 0 | +0 |
| umm_zeitoun_1_recon | find_the_missile_team | a | 1 | +40 |
| umm_zeitoun_3_clearance | find_adhal | a | 1 | +40 |

`qarn_hadid_1_recon` already completes every carries objective in its ★★-labelled run
(it is in fact the one mission the harness itself grades at 3 stars), so it is unchanged.
Every other mission's ★★★ value equals its ★★ value. **This holds `fielded`/`lost`/`roe`
fixed at the ★★ plan's own measured values** — a real 3-star attempt might take more risk
to reach a farther-out `locate` marker and lose more units or spend more time under fire
lowering ROE. That is a simplification stated up front (see §7).

## 2. The two cumulative curves

`world.json` order, ★★ = the harness's own pinned per-mission credits; ★★★ = re-derived
per §1. `roe` is the plain victory line's Conduct score, used in §3.

| # | mission | ★★ | cum ★★ | ★★★ | cum ★★★ | roe |
|---|---|---|---|---|---|---|
| 1 | beit_sahwan_breach | 217 | 217 | 217 | 217 | 97 |
| 2 | beit_sahwan_1_recon | 260 | 477 | 300 | 517 | 100 |
| 3 | beit_sahwan_2_foothold | 180 | 657 | 180 | 697 | 100 |
| 4 | beit_sahwan_3_clearance | 240 | 897 | 240 | 937 | 100 |
| 5 | beit_sahwan_4_subterranean | 188 | 1085 | 188 | 1125 | 98 |
| 6 | khan_rafid_1_recon | 260 | 1345 | 300 | 1425 | 100 |
| 7 | khan_rafid_2_foothold | 225 | 1570 | 225 | 1650 | 100 |
| 8 | khan_rafid_3_clearance | 216 | 1786 | 216 | 1866 | 76 |
| 9 | deir_amun_1_recon | 180 | 1966 | 260 | 2126 | 100 |
| 10 | deir_amun_2_foothold | 225 | 2191 | 225 | 2351 | 75 |
| 11 | deir_amun_3_subterranean | 240 | 2431 | 240 | 2591 | 85 |
| 12 | tel_marum_1_recon | 200 | 2631 | 200 | 2791 | 100 |
| 13 | tel_marum_2_foothold | 198 | 2829 | 198 | 2989 | 98 |
| 14 | tel_marum_3_clearance | 230 | 3059 | 230 | 3219 | 95 |
| 15 | qarn_hadid_1_recon | 310 | 3369 | 310 | 3529 | 100 |
| 16 | qarn_hadid_2_foothold | 227 | 3596 | 227 | 3756 | 97 |
| 17 | qarn_hadid_3_clearance | 225 | 3821 | 225 | 3981 | 80 |
| 18 | umm_zeitoun_1_recon | 200 | 4021 | 240 | 4221 | 100 |
| 19 | umm_zeitoun_2_buildup | 198 | 4219 | 198 | 4419 | 98 |
| 20 | umm_zeitoun_3_clearance | 194 | 4413 | 234 | 4653 | 89 |
| 21 | umm_zeitoun_4_clearance | 237 | 4650 | 237 | 4890 | 92 |
| 22 | wadi_halam_1_fords | 170 | 4820 | 170 | 5060 | 100 |
| 23 | wadi_halam_2_laager | 188 | 5008 | 188 | 5248 | 98 |
| 24 | wadi_halam_3_counterraid | 190 | 5198 | 190 | 5438 | 100 |
| 25 | wadi_halam_4_village | 187 | 5385 | 187 | 5625 | 77 |
| 26 | wadi_halam_5_depot | 159 | 5544 | 159 | 5784 | 79 |

**Totals: ★★ = 5544 (matches the pinned `LADDER_CREDITS`), ★★★ = 5784.** The uplift from
completing every carrying secondary is only **+240, +4.3%** — small, and load-bearing for
§5's finding. **Highest single-mission line: 310** (`qarn_hadid_1_recon`, both curves —
it is already the harness's one 3-star mission, so nothing pushes it higher on the ★★★
curve).

## 3. The gates, measured

### 3.1 Star gates (breach_team, scout_shachaf, apc_kipod)

Pinned by `playtest.ts`'s own `GATES` assertion and cross-checked against
`docs/campaign/special_units/design.md` §2's measured-ladder column.

**Corrected, WP-G-E3 (2026-09-19).** The "★★★ opens after mission" column below used to
read 4/10/15 — `stars_min ÷ 3`, which describes a campaign where every mission is ★★★
from mission one. It is a naive bound, not a re-derivation: at the time it was written
only `qarn_hadid_1_recon` was actually run at three stars, so no real ladder crossing had
ever been measured. WP-G-E3 promoted six more recon and clearance plans to ★★★
(`beit_sahwan_1_recon`, `beit_sahwan_3_clearance`, `khan_rafid_1_recon`,
`deir_amun_1_recon`, `umm_zeitoun_1_recon`, `umm_zeitoun_3_clearance`), and the column
now carries the measured crossing point instead — `GATES.opensAfter` read off
`playtest.ts`'s own printed `gate <unit>: OPEN after mission N at M stars` line, the
final pin for this package:

| unit | `stars_min` | ★★ opens after mission | ★★★ opens after mission (measured, WP-G-E3) |
|---|---|---|---|
| breach_team | 12 | 6 | 5 (12 stars) |
| scout_shachaf | 30 | 15 | 13 (30 stars) |
| apc_kipod | 44 | 22 | 19 (44 stars) |

These are genuinely staggered through the campaign — the star-gate mechanism is the one
place in this catalogue where "buy early" has real room to work, because the free path
takes many missions of ★★ or ★★★ play to reach.

**§3's `LADDER_CREDITS` figure, per R-4.** `playtest.ts`'s pinned optimal-ladder total is
**5849** as of this package (was 5751 at the end of WP-G-E3's Task 4, and 5544 when §2's
cumulative table below was written on 2026-09-16). The six star promotions above each pay
`creditsFor`'s `carryingSecondary` weight (40) for completing a secondary that used to
sit incomplete, plus real carry-over drift into missions that share a chained ledger
(`umm_zeitoun_2_buildup` inherits a differently-composed survivor set from
`umm_zeitoun_1_recon`'s new route) — the full accounting is in `playtest.ts`'s own
`LADDER_CREDITS` comment. §2's cumulative table, §3.4's cumulative affordability figures
and §5–§8's price analysis below were derived against the 2026-09-16 ladder (5544 ★★ /
5784 ★★★) and are **not re-walked here** — reconciling them against the post-WP-G-E3
ladder is a separate, larger undertaking than this task's scope (a `playtest`-only content
fix), and is left as a finding rather than silently patched number by number.

### 3.2 Conduct gates (the other nine units) — a load-bearing finding

`unlockReason`'s `roeMin` check (`packages/sim/src/unlock.ts`, `conductAtLeast`) is not a
per-mission score, it is the **campaign-average Conduct across every mission rated so
far** (`sum >= floor * count`, integer only). Walking the ladder's own ROE column
(§2) through that exact predicate:

```
mission 1: sum=97  avg=97.00  clears every floor in {35,40,45,50,55,60,65}
mission 2: sum=197 avg=98.50  clears every floor
mission 3: sum=297 avg=99.00  clears every floor
...
mission 26: sum=2434 avg=93.6  clears every floor
```

(reproduced by the same script, `ladder.py`). **Every one of the nine `roe_rating_min`
floors — 35, 40, 45, 50, 55 (x2), 60 (x2), 65 — is already satisfied after the campaign's
very first mission**, because `beit_sahwan_breach`'s own ROE (97) alone clears even the
highest floor (65), and the running average never drops anywhere near 65 for the rest of
the ladder (its lowest point across all 26 missions is ~93.6 at mission 26). This is not
an accident of one mission: every winning plan in the ladder scores ROE >= 75, and the
default two-star floor is already 70 (`STAR_ROE_DEFAULT`) or the mission's own
`fail_below + 20` — both comfortably above every unit's `roe_rating_min`. **A ★★-caliber
win, by construction, already tends to satisfy every one of these nine gates in a single
mission.** They are not staggered progression content on this ladder the way the star
gates are; they are near-instant for anyone actually clearing the ★★ bar.

This directly bears on requirement 1 ("a real shortcut... meaningfully before its earned
gate"): for these nine units, **there is no earlier checkpoint than "after mission 1" to
be a shortcut against** — mission 1 is the first point at which any credits exist at all
(217, after `beit_sahwan_breach`), and the gate is already open by then. So for every one
of these nine, "gate opens" is recorded as **mission 2** (the first mission for which the
unit is free to build), uniformly, in the table below — and no positive price can ever be
"before" that on this ladder. See §7 for what this means for pricing and for a realistic
(non-optimal) player, who does not ride a 93-100 Conduct average and for whom these gates
would spread out exactly the way the design intended.

### 3.3 The floors, raised 70-90 (WP-G-E1, 2026-09-18) — the same finding at the new ceiling

The lead's decision on finding 1 above: raise the nine floors so they read as a real
progression for a well-played campaign rather than a grace period that clears itself on
mission 1. New floors, ordered by price (`data/units/kdf/*.json` `cost.logistics`'s own
ordering, and the three most expensive — `ifv_namer`, `dozer_d9`, `mbt_lavi` — placed at
the top of the band, per the lead's brief, so their earned gate is no longer trivially
ahead of a price a player might otherwise consider paying for):

| unit | old floor | new floor | price |
|---|---|---|---|
| recon_drone | 35 | 70 | 220 |
| attack_drone | 45 | 72 | 320 |
| yahalom_squad | 55 | 75 | 340 |
| demo_squad | 50 | 77 | 360 |
| sniper_team | 60 | 80 | 380 |
| heli_peten | 65 | 82 | 460 |
| ifv_namer | 40 | 85 | 520 |
| dozer_d9 | 60 | 87 | 560 |
| mbt_lavi | 55 | 90 | 720 |

Re-walked against the CURRENT ladder (`pnpm playtest`, 2026-09-18 — the per-mission
Conduct sequence has shifted slightly since §3.2 was written, from map and plan fixes
merged since 2026-09-16, though not by much):

```
 1 beit_sahwan_breach          roe= 97  avg= 97.00
 2 beit_sahwan_1_recon         roe=100  avg= 98.50
 3 beit_sahwan_2_foothold      roe=100  avg= 99.00
 4 beit_sahwan_3_clearance     roe=100  avg= 99.25
 5 beit_sahwan_4_subterranean  roe= 98  avg= 99.00
 6 khan_rafid_1_recon          roe=100  avg= 99.17
 7 khan_rafid_2_foothold       roe=100  avg= 99.29
 8 khan_rafid_3_clearance      roe= 76  avg= 96.38
 9 deir_amun_1_recon           roe=100  avg= 96.78
10 deir_amun_2_foothold        roe= 75  avg= 94.60
11 deir_amun_3_subterranean    roe= 85  avg= 93.73   <- campaign low so far
...                                                     (avg never drops below 93.5
26 wadi_halam_5_depot          roe= 79  avg= 93.50   <-  again, the campaign's overall low)
```

**Raising the ceiling to 90 does not move a single gate's opening mission, and this is a
measured fact, not a tuning choice left on the table.** `beit_sahwan_breach` is mission 1,
unconditionally (`world.json`'s fixed order), and its own Conduct score (97) IS the
campaign average after one mission — a single data point equals its own mean. Since 97
clears every floor up to 90, and the campaign average never dips below 93.5 for the
remaining 25 missions either, **all nine gates open after mission 1 at every floor in the
mandated 70-90 band**, exactly as they did at the old 35-65 band (`pnpm playtest`'s new
`CONDUCT_GATES` probes assert this directly — see that file's Task 7b comment). Producing
the "opens around mission 3, spreads to about mission 22" spread the brief describes would
need a floor above 97 (mission 1's own score), which is outside the mandated range, or a
change to mission 1's own Conduct trajectory, which is mission content and out of this
work package's scope (unit JSON, this document, and test pins only — no `packages/sim`,
no mission JSON).

**The floors were raised anyway, and they are not wasted**, for the reason §3.2 and §7
already gave for the old ones: this optimal-play harness proves missions winnable, it does
not model a realistic player's Conduct, and every plan on this ladder scores 75-100
because the plans are written to. A floor of 90 is a materially higher bar than 65 for
a player whose actual Conduct trajectory sags — one who takes collateral-risk shots, loses
the two-star grade a few times, or plays roughly rather than cleanly — even though the
scripted optimal ladder this repository can measure cannot exhibit that difference. The
change is honestly reported as "raises the bar for an imperfect player" rather than
"spreads the gates on the optimal ladder", because the second claim is false and the first
is what actually moved.

### 3.4 `breach_team`'s price exception — decided, 2026-09-18

§6 measured that `breach_team`'s 850 price fails the §4.2 cap (which would require >= 1550,
five times the ladder's highest single-mission line) and that no price can satisfy the cap
without making the purchase strictly worse than waiting: `breach_team`'s own `stars_min: 12`
gate opens at mission 6 (cumulative 1345 credits on ★★), before a cap-compliant price
(>= 1550) would even be affordable (mission 7, cumulative 1570). §6 recommended keeping the
850 shortcut over literal cap compliance and flagged the conflict for the lead rather than
resolving it unilaterally.

**Decided 2026-09-18: keep 850.** The cap is a design guideline for keeping a bought-only
purchase from ever eclipsing the star-gated tier's cheapest entry by too little headroom; it
is not a hard invariant, and `breach_team` is the one unit on the whole catalogue for which
the guideline and requirement 1 ("a real shortcut before its earned gate") are mutually
exclusive, by the numbers above. Holding the cap here would ship a 1550+ price nobody would
ever rationally pay — the ladder's OWN measured worst case — which is a worse defect than a
documented, understood cap exception. No other price on the catalogue is affected: every
other unit's cap check in §6 already clears with margin.

Since §3.2 rules out "shortcut before the gate" as a meaningful design lever for these
nine on the optimal ladder, they are priced on **power and gate strength** (requirement
4) instead, using logistics cost (`data/units/kdf/*.json` `cost.logistics`, a direct
input to the shipped cost curve `cost = 282.317 * power^0.465`,
`docs/campaign/special_units/design.md` §6) as the power proxy, and `roe_rating_min` as a
secondary weight (a higher floor marks a unit the designers already treat as a bigger
deal). Composite score = `logistics + 5 * roe_min` (the `5x` puts the 35-65 range on a
comparable scale to the 210-906 logistics range), then price = round(score * 0.6) to a
clean number:

| unit | logistics | roe_min | score | price |
|---|---|---|---|---|
| recon_drone | 210 | 35 | 385 | 220 |
| attack_drone | 300 | 45 | 525 | 320 |
| yahalom_squad | 260 | 55 | 535 | 340 |
| demo_squad | 300 | 50 | 550 | 360 |
| sniper_team | 260 | 60 | 560 | 380 |
| heli_peten | 402 | 65 | 727 | 460 |
| ifv_namer | 630 | 40 | 830 | 520 |
| dozer_d9 | 586 | 60 | 886 | 560 |
| mbt_lavi | 906 | 55 | 1181 | 720 |

The star-gated three are priced above all nine of these (requirement 4: "the star units
dearest"), using the affordability-window reasoning in §3.1 rather than the composite
score (their gate strength, not raw logistics cost, is what the price is fitted against —
§5's cap and §6 explain the exact numbers).

| unit | `stars_min` | price |
|---|---|---|
| breach_team | 12 | 850 |
| scout_shachaf | 30 | 1800 |
| apc_kipod | 44 | 3200 |

`mbt_lavi` (720) < `breach_team` (850): the weakest star-gated unit still outprices the
dearest Conduct-gated one, holding requirement 4's "never cheaper than a strictly weaker
unit" for the whole twelve.

## 5. The price table

Affordable-at mission = the earliest mission whose cumulative ★★ (or ★★★) column in §2
is >= price (`ladder.py` computed this by scanning the cumulative arrays; verified by
hand for the boundary cases). Gate-opens mission is from §3.

Floor column updated 2026-09-18 (WP-G-E1, §3.3) to the raised 70-90 range; the "gate
opens" and "affordable at" columns are the same numbers as before the raise, because
every floor in that range still opens after mission 1 on this ladder (§3.3) -- exactly
as every floor in the old 35-65 range did (§3.2).

| unit | gate | gate opens (★★ / ★★★) | price | affordable at (★★ / ★★★) | margin (★★ / ★★★) |
|---|---|---|---|---|---|
| recon_drone | roe >= 70 | 2 / 2 | 220 | 2 / 2 | 0 / 0 |
| attack_drone | roe >= 72 | 2 / 2 | 320 | 2 / 2 | 0 / 0 |
| yahalom_squad | roe >= 75 | 2 / 2 | 340 | 2 / 2 | 0 / 0 |
| demo_squad | roe >= 77 | 2 / 2 | 360 | 2 / 2 | 0 / 0 |
| sniper_team | roe >= 80 | 2 / 2 | 380 | 2 / 2 | 0 / 0 |
| heli_peten | roe >= 82 | 2 / 2 | 460 | 2 / 2 | 0 / 0 |
| ifv_namer | roe >= 85 | 2 / 2 | 520 | 3 / 3 | **-1 / -1** |
| dozer_d9 | roe >= 87 | 2 / 2 | 560 | 3 / 3 | **-1 / -1** |
| mbt_lavi | roe >= 90 | 2 / 2 | 720 | 4 / 4 | **-2 / -2** |
| breach_team | stars >= 12 | 6 / 4 | 850 | 4 / 4 | +2 / 0 |
| scout_shachaf | stars >= 30 | 15 / 10 | 1800 | 9 / 8 | +6 / +2 |
| apc_kipod | stars >= 44 | 22 / 15 | 3200 | 15 / 14 | +7 / +1 |

**Margin** = gate-opens mission minus affordable-at mission; positive means buying beats
the free path by that many missions. Notes:

- The six cheapest Conduct-gated units (recon_drone through heli_peten, <= 460) tie the
  gate exactly (margin 0) — the best any positive price can do given §3.2's finding that
  the gate is already open after mission 1. They are not a shortcut on this ladder; see
  §7 for who they are actually for.
- `ifv_namer`, `dozer_d9`, `mbt_lavi` price **above** the second mission's cumulative
  credit line (477 on ★★, 517 on ★★★), so on the optimal ladder buying them is a
  strict **loss** against waiting for the free gate — unavoidable if they are to be
  priced above the six cheaper units at all (requirement 4), given how early the free
  gate already sits (§3.2, §7).
- `breach_team`/`scout_shachaf`/`apc_kipod` are real, growing shortcuts: 2-7 missions
  early on ★★, a smaller but still positive 0-2 missions early on ★★★ (a stronger
  player earns stars faster, so the free path catches up faster too — `breach_team`
  actually ties its own ★★★ gate exactly, buying it earns nothing for a 3-star player).
  **The ★★★ half of this bullet is stale, WP-G-E3 (2026-09-19) — the same claim §7
  corrects below.** It reads this table's `gate opens (★★★)` column at the OLD
  `stars_min ÷ 3` figures (4 / 10 / 15); §3.1 now measures the real crossing at
  5 / 13 / 19 (`gate breach_team: OPEN after mission 5`, `scout_shachaf: … 13`,
  `apc_kipod: … 19`). Against the unchanged `affordable at (★★★)` column (4 / 8 / 14)
  that widens the ★★★ margin to roughly +1 to +5, not 0-2, and `breach_team` no
  longer ties its own gate exactly (5 - 4 = +1). The ★★ half is unaffected — it
  already reads §3.1's own ★★ column (6 / 15 / 22) unchanged. A full re-derivation of
  this table's `gate opens`/`margin` columns against the post-WP-G-E3 ladder is the
  same larger undertaking §3.1 defers (this section was derived against the
  2026-09-16 ladder and is not re-walked here).

## 6. The cap check (§4.2: no mission pays more than a fifth of the cheapest star-gated
unit's price)

Highest single-mission line, both curves: **310** (`qarn_hadid_1_recon`, §2). The cap
requires the cheapest of the three star-gated units to be **>= 5 x 310 = 1550**.

**`breach_team` at 850 fails this cap, and no price can satisfy it without breaking
requirement 1 outright.** `breach_team`'s own gate opens after mission 6 (★★, cumulative
1345) / mission 4 (★★★, cumulative 937) — both below 1550. Any price that clears the
1550 floor is unaffordable until mission 7 at the earliest on ★★ (cumulative 1570) — a
mission *after* its own free gate has already opened. Pricing `breach_team` at or above
1550 does not create a shortcut; it creates a purchase that is strictly dominated by
waiting, on both curves, which defeats the purpose of D1's buy option for this unit
specifically. §7 records this as a conflict between the §4.2 cap and requirement 1 that
the measured numbers cannot resolve, and recommends keeping the shortcut (850) over
literal cap compliance.

`scout_shachaf` (1800) and `apc_kipod` (3200) both clear the cap comfortably — their
gates open late enough (mission 15 / 22 on ★★) that a price above 1550 is still a real,
multi-mission shortcut (§5).

## 7. The budget split

Reserving half of each ladder total for the (unbuilt) upgrade step leaves an **unlock
budget** of 2772 (★★, half of 5544) and 2892 (★★★, half of 5784). Sorting the twelve
prices ascending and taking a running sum (`prices.py`):

```
sorted:  220 320 340 360 380 460 520 560 720 850 1800 3200
cumsum:  220 540 880 1240 1620 2080 2600 3160 3880 4730 6530 9730
```

| budget | value | units affordable |
|---|---|---|
| ★★ half (unlock reserve) | 2772 | 7 of 12 (cumsum 2600 <= 2772 < 3160) |
| ★★★ half (unlock reserve) | 2892 | 7 of 12 (cumsum 2600 <= 2892 < 3160) |
| ★★ full ladder | 5544 | 10 of 12 (cumsum 4730 <= 5544 < 6530) |
| ★★★ full ladder | 5784 | 10 of 12 (cumsum 4730 <= 5784 < 6530) |

Task target: "a ★★ campaign that buys nothing else could open about half the twelve" —
**7 of 12 on the half-budget, close enough to "about half" (6) to call this a fit.**
"A ★★★ ladder... most of them" — reading this against the **full** ladder (a campaign
that spends everything it earns on unlocks, having nothing else to spend it on yet)
gives **10 of 12, a genuine "most"**. Both counts hold up whichever grade actually funds
the spending, though — see the finding below.

**A finding that argues against reading "half vs. most" as a function of the star
grade itself.** The ★★ and ★★★ ladder totals differ by only 4.3% (5544 vs. 5784, §2),
so a fixed price list affords **exactly the same count of units at either grade** under
both the half-budget and full-budget readings (7/12 and 10/12 both ways, above). The
"half vs. most" contrast the task asks for is not something a 4.3% larger pool can
produce on its own — it comes from **which of the two readings (half-budget vs.
full-budget) applies**, not from which star grade the player achieved. The star grade
does matter, but through a different channel: a ★★★ player's star gates open 1-3
missions earlier, measured (§3.1; this reading used to say "2-7", which divided the star
requirement by three and describes a campaign where every mission is ★★★ from mission
one, not the real ladder), so by a given point in the campaign more of the catalogue is
already open for free, which is a real "most of the twelve, one way or another" story —
just not one this budget arithmetic captures on its own. Recorded here rather than
folded into the numbers, since inventing a second free variable to make the count track
the star grade would be fitting a story to a target rather than measuring one.

## 8. Special forces (bought-only) price band

D1's bought-only units have no earned path at all, so a price here is the *only* gate —
it must never be effectively free (a mission's own payout should not come close) and
never be so dear it is unreachable inside a realistic number of campaigns, given D4 (the
account "survives a fresh campaign").

- **Floor: ~13x the highest single-mission line, 4000 credits.** This sits above every
  star-gated price (apc_kipod at 3200, §4) — a bought-only unit should never be cheaper
  than the dearest thing obtainable through play at all, since paying skips a gate that
  never opens by any other means, which is worth strictly more than skipping a gate that
  eventually opens for free. 4000 is also comfortably more than a single mission's
  payout could approach even doubled (620), so no lucky run makes it feel free.
- **Ceiling: ~26x the highest single-mission line, 8000 credits.** That is roughly 1.45x
  one full optimal ★★ ladder (5544) and 1.38x a full ★★★ one (5784) — a single
  campaign's earnings, spent on nothing else, cannot quite reach it. That is the
  intended shape for the top of this band: the account "outlives a campaign" (D4), so
  the dearest bought-only unit is deliberately a **multi-campaign** purchase, the
  clearest non-monetary answer this design has to "should everything be reachable in
  one playthrough" without touching D6's paid path.
- **Recommended spread:** several bought-only units across the band rather than one
  price, the same way the three star units spread 850-3200 rather than clustering — e.g.
  4000-4500 for a first, cheaper special-forces unit and 6500-8000 for a second, dearer
  one, leaving room between them for the lead's own judgement of relative power once the
  units are designed (§9.2 of `docs/campaign/special_units/design.md` sets the precedent:
  price is fitted to the shipped unit's stats after the fact, not decided first).

## 9. Findings against the spec's assumptions

1. **The nine `roe_rating_min` gates are not staggered content on the optimal ladder —
   they are all open after mission 1** (§3.2). `unlockReason`'s Conduct gate is a
   *campaign-average* threshold, and every winning plan in the pinned ladder scores ROE
   >= 75, well above even the highest unit floor (65). The design's implicit picture of
   nine gates opening one by one across the campaign, the way the three star gates
   measurably do, does not hold for a player who is actually clearing the ★★ bar the
   gates are nominally scoped against. These nine gates are effectively a **new-campaign
   grace period** (locked only until you finish your first mission at all) rather than a
   mid-campaign unlock ladder, for anyone playing to the standard the ladder assumes.
   Buying them only has room to matter for a realistic player whose Conduct trajectory is
   materially worse than 75-100 — which the harness cannot produce (its plans are
   optimal-play proofs, `CLAUDE.md`'s "Known scaling debts" already says as much for
   duration; the same limitation applies here to Conduct). This is worth flagging to
   `balance-analyst`/the lead: either the nine floors should be raised so they spread out
   even for a well-played campaign, or the buy price for this tier should be understood
   and documented as convenience-for-average-players rather than shortcut-for-optimal-players.
   **Addressed 2026-09-18 (WP-G-E1, §3.3): the floors were raised, 35-65 -> 70-90.** The
   raise does NOT produce the "spreads across the campaign" half of this finding — measured
   fresh against the current ladder, mission 1's own Conduct (97) still clears every floor up
   to 90, so all nine gates still open after mission 1, exactly as before. What the raise
   does deliver is the second option this finding named: these nine are now documented,
   deliberately, as **convenience-for-a-realistic-player**, not shortcut-for-optimal-play —
   a materially higher bar (90 vs 65) for a player whose actual Conduct trajectory is not
   93-100, which this harness cannot model or falsify either way.
2. **The §4.2 cap and requirement 1 cannot both hold for `breach_team`** (§6). The cap
   floor (1550) sits above the mission at which `breach_team`'s own free gate opens
   (cumulative 1345 at mission 6). No price can be both >= 1550 and a genuine shortcut for
   this unit on this ladder — literal cap compliance makes buying strictly worse than
   waiting. This document prices it as a shortcut (850) and flags the cap violation
   rather than the reverse, on the reasoning that a price nobody would ever rationally pay
   is a worse defect than a documented cap exception. If the lead wants the cap held
   literally, the fix is upstream of pricing: either move `breach_team`'s gate later (a
   design change to the special-forces doc) or lower `CREDIT_WEIGHTS` so the ladder's peak
   mission (currently 310) drops enough that 5x it clears comfortably before mission 6 —
   both out of this document's scope.
   **Decided 2026-09-18 (§3.4): keep 850, the cap exception is accepted rather than fixed.**
3. **"Half the catalogue at ★★, most of it at ★★★" is not producible from the ladder
   totals alone** (§7) — they differ by only 4.3%. The task's own reinterpretation
   (half-budget vs. full-budget spending, rather than ★★-vs-★★★ totals) is what produces
   the two counts (7/12, 10/12); the star grade's real effect on "how open the catalogue
   is" runs through the star gates opening earlier, a separate mechanism from the credit
   total.

## 10. Summary — one line per unit

| unit | price | gate opens (★★/★★★) | affordable at (★★/★★★) |
|---|---|---|---|
| recon_drone | 220 | 2 / 2 | 2 / 2 |
| attack_drone | 320 | 2 / 2 | 2 / 2 |
| yahalom_squad | 340 | 2 / 2 | 2 / 2 |
| demo_squad | 360 | 2 / 2 | 2 / 2 |
| sniper_team | 380 | 2 / 2 | 2 / 2 |
| heli_peten | 460 | 2 / 2 | 2 / 2 |
| ifv_namer | 520 | 2 / 2 | 3 / 3 |
| dozer_d9 | 560 | 2 / 2 | 3 / 3 |
| mbt_lavi | 720 | 2 / 2 | 4 / 4 |
| breach_team | 850 | 6 / 4 | 4 / 4 |
| scout_shachaf | 1800 | 15 / 10 | 9 / 8 |
| apc_kipod | 3200 | 22 / 15 | 15 / 14 |
