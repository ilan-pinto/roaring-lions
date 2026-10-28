# Standoff (Sarim): doctrine and data, not vehicle health (GH-865) — measured note

**Date:** 2026-10-29 · **Status:** REPORT ONLY. Nothing under `packages/`, `data/` or `tools/` changes on
this branch; no tuning and no data were committed anywhere. Every number below comes from scratch edits in
detached worktrees at `origin/main` b3307ab2 (v0.129.6, MANPAD 420 and the single-warhead kamikaze
included), undone by deleting the worktrees. **Builds on:** `2026-10-27-vehicle-health-design.md` §6
(GH-560 ruling 4: Standoff is report-only) and `docs/agent-notes/sim-and-orders.md` ("Vehicle health").
**For:** the lead; `mission-author` (section 7, decision 3) and `sim-guard` (decision 5).

---

## 0. Recommendation first

1. **Retire the single-cell wording of the target.** "An ATGM cell firing from >= 8 tiles wins the cost
   exchange against an APS MBT over a 3-missile engagement" cannot be met by doctrine or by data. Under
   ruling 1 a Kornet through the Lavi's front costs 39% of the bar, so a Lavi dies only if all three
   missiles penetrate, and the Trophy (0.75, inside the gated 0.6-0.9 band) stops each one alone.
   Measured ceiling: one cell destroys the Lavi in 0.1% of 1,000 engagements; with the Trophy switched
   off entirely, 3.5% (and 5.5% from a position the Lavi cannot reach). Section 2.
2. **Replace it with the section form, and gate that.** *Three ATGM cells, firing together from a
   prepared position (cover 2 or better) at >= 8 tiles, win the cost exchange against an APS MBT over a
   3-missile engagement each.* With **no data, tuning or sim change**:

   | 3 cells, cover 2, 8.5 tiles | exchange/run | Lavi destroyed | destroyed or disabled | cells lost before their 3rd launch |
   |---|---|---|---|---|
   | base, 200 seeds | **+271** | 33.5% | 74.5% | 4.7% |
   | base, 1,000 seeds (worst 200-seed block) | +219 (+169) | 29.1% | 71.8% | 6.3% |
   | max tier, 200 seeds | **+137** | 21.0% | 68.5% | 7.5% |
   | max tier, 1,000 seeds (worst block) | +115 (+99) | 19.8% | 67.6% | 9.2% |
   | the same three cells on open ground (today's probe row) | -270 / -359 max | 13.5% / 10.0% | 51% / 49% | 56% / 64% |

   It holds across the whole APS band (pk 0.6: +433 base / +245 max; pk 0.9: +155 / +26) and it fails
   on open ground, so a gate on it can go red. **Standoff can become a gated §5.7 target in this form**
   (section 6 has the text, the bars and the falsification).
3. **No shipped data change.** Three data levers went through every gate (section 5). Kornet sight
   10 -> 14 takes the versus bar from 16/16 to 9/16 and moves four pins; Trophy reload 8 -> 30 s takes it
   to 4/16; firing signature x5 -> x2.5 keeps 16/16 but moves `LADDER_CREDITS` and leaves the single
   cell exactly where it was. None is needed: the doctrine does the work.
4. **The content is where Standoff is lost.** The 19 shipped `atgm_cell` placements (14 missions) are
   all a single cell (`count` 1), 18 of them on cover-0 ground and one in an olive grove (cover 1). The
   nearest thing to a section is Tel Marum III's two cells 4 tiles apart, in the open. That is the losing
   row of every table here. It is `mission-author`'s, not the model's.
5. **Two sensor fields do nothing.** `sensors.thermal` is parsed (`sim.ts` line 1076) and read by
   nothing, so "the Lavi sees 12 with thermal" is 12 tiles and optics 1.2; and `hidden_setup` (on
   `atgm_cell` and `rpg_team`) is a schema enum and a dock tag ("sets up hidden") with no sim reader. Neither is a cause
   here (section 3); both are claims the game makes to a player and does not keep. For `sim-guard`.

---

## 1. What the code does (read at b3307ab2)

- **Detection** (`detectionFrom`): `signature x AMBUSH_SIG (0.5, ambush only) x MOTION_SIG (1.5, moving)
  x firing_signature_mult (for FIRING_SIG_TICKS = 3 s after a shot) x COVER_SIG[cover] (1, .75, .5, .35)`,
  over range squared and occlusion; nothing beyond `sight_tiles` is ever seen. Contact is per SIDE: once
  any unit of a side identifies a target, every unit of that side in range may fire at it.
- **Cell and tank:** `atgm_cell` sight 10, optics 1.1, signature 0.5, firing x5, 360 hp, Kornet range 14
  (effective 8), accuracy 0.75, pen 900, 3 rounds/min (one per 20 s). `mbt_lavi` sight 12, optics 1.2,
  gun range 12, 3,000 hp (3,750 at max tier, sight 15 with the sensor tiers).
- **Trophy** (`resolveImpact`): `pI = base_pk (0.75) x APS_VEL_F[atgm] (1.0)`, times `1 - 0.25 x recent`
  (capped at 0.75) when the previous engagement was under 2 s ago. Magazine 3; when it empties it
  refills whole after `reload_s` 8 s. So against one cell at one round per 20 s the magazine never
  matters and every missile meets 0.75; against three missiles in one tick the second and third meet
  0.5625 and 0.375, and the magazine is back before the next salvo.
- **Vehicle health:** a Kornet through the front (shift 8) costs 1,156 hp, 39%; regeneration (0.49%/s,
  after 10 s quiet, up to 70%) gives back about 5% between 20-second launches. So the bar runs
  100 -> 61 -> ~66 -> 27 -> ~32 -> dead: **exactly three penetrations**, never two.
- **Salvo is already emergent.** Because contact is shared, co-located cells launch on the same tick:
  the first-launch spread is 0.0 s in every multi-cell arm measured, and 56.5% of the Trophy's
  engagements in today's 3-cell row are already saturated. "A salvo doctrine" needs no code.

## 2. Why the single-cell form cannot pass

Per missile at 8.5 tiles: P(through the Trophy) 0.25 x P(hit and penetrate) ~0.50 (measured with the
Trophy off: 0.74 penetrations from 1.47 missiles) = ~0.13. Three of three: ~0.2%. Measured:

| one cell (200 seeds unless noted) | destroyed | destr. or disabled | cell dead | exchange/run |
|---|---|---|---|---|
| today, 8.5 tiles (1,000 seeds) | 0.1% | 10.0% | 90.5% | -212 |
| Trophy off, 8.5 tiles (ceiling) | 3.5% | 31.5% | 82.0% | -161 |
| Trophy off, 12.5 tiles, out of the gun's reach (ceiling) | 5.5% | 57.0% | 0% | +50 |
| sight 14, 12.5 tiles, Trophy on (1,000 seeds) | 0.1% | 17.9% | 0% | +1 |

The cell needs P(kill) of about 23% at today's 90% death rate (235 against 906). It has 0.1%, and 5.5%
with no Trophy at all. The only single-cell "win" is the last row: a cell the Lavi cannot shoot, killing
nothing, scoring about zero. A gate of `exchange >= 0` would pass that row vacuously (a check that
cannot fail in that geometry; see the casebook), so the single-cell form should not be gated in any
geometry. Making one Kornet kill a Lavi means breaking ruling 1 or the APS target, which this note does
not propose.

## 3. What actually ends the cell (and what the issue's premises get wrong)

Timeline, one cell at 8.5 tiles, medians over 200 seeds (`zz-standoff-levers.ts`): the **cell** identifies
the Lavi first (4.0 s) and launches that tick; the Lavi identifies the cell at 4.7 s; the cell is dead at
11.3 s, long before its second launch at 24 s. Both are well inside both sights at 8.5 tiles, and the
Lavi's signature (1.0) is twice the cell's (0.5), so the cell sees first.

| one cell, 8.5 tiles, 200 seeds | cell dead | t(Lavi identifies cell) | t(cell dies) |
|---|---|---|---|
| today (firing x5) | 91.0% | 4.7 s | 11.3 s |
| firing x2.5 | 91.0% | 5.3 s | 11.9 s |
| firing x1.0 (no launch signature at all) | 87.0% | 7.3 s | 13.9 s |
| signature 0.25 and firing x1.0 | 83.0% | 15.2 s | 21.8 s |
| sight 14, or a side-wide cue every tick | 91.0% | 4.7 s / 1.6 s | 11.3 s / 8.3 s |
| **cover 2** | **22.0%** | 6.2 s | 26.1 s |
| **cover 3** | **13.5%** | 9.5 s | 22.8 s |

- *"The cell is spotted first because it sees 10 and the Lavi 12 with thermal"*: no. At 8.5 tiles both
  are inside both sights; `thermal` does nothing; the cell sees first.
- *"The x5 first-launch multiplier is what ends the cell"*: no. With no launch signature at all the cell
  still dies 87% of the time; halving its base signature as well, 83%. What ends it is a 120 mm gun
  shooting at a team in the open at 8.5 tiles. What saves it is **cover**, which cuts both its signature
  and the Lavi's chance to hit (cover 2: dead 22%; a signature cut alone, the signature-0.25 row, 83%).
- *"The Kornet's 14-tile range is unusable unspotted"*: true, and it is the second doctrine that works
  (section 4b): beyond 12 tiles the Lavi can neither see nor shoot the cell.

## 4. The levers, measured (200 seeds; base tier, max tier in brackets where it was run)

Exchange per run is the committed probe's: the Lavi's 906 if destroyed, minus 235 per cell killed before
its third launch (minus a spotter's own cost where one is fielded). Disabled = firepower, mobility or
combat-ineffective.

**(a) Sight and concealment**

| arm | destroyed | destr./disabled | cells dead | exchange |
|---|---|---|---|---|
| 1 cell, today | 0% | 8.5% | 91.0% | -214 |
| 1 cell, sight 14 | 0% | 8.5% | 91.0% | -214 |
| 1 cell, signature 0.35 | 0% | 8.5% | 91.0% | -214 |
| 1 cell, cover 2 / cover 3 | 0% / 0% | 24.0% / 23.0% | 22.0% / 13.5% | -52 / -32 |
| 3 cells, cover 1 | 27.0% (17.0%) | 63.0% (61.0%) | 22.7% (25.5%) | +85 (-26) |
| **3 cells, cover 2** | **33.5% (21.0%)** | **74.5% (68.5%)** | **4.7% (7.5%)** | **+271 (+137)** |
| 3 cells, cover 3 | 34.5% (22.0%) | 73.0% (72.5%) | 2.7% (3.2%) | +294 (+177) |
| 2 cells, cover 2 | 11.0% (7.0%) | 54.5% (49.0%) | 8.8% (14.3%) | +59 (-4) |

A new "hide" or "emplaced" stance would duplicate what a cover tile already does, and `ambush` already
halves the signature until it springs. Neither needs building.

**(b) Range and displacement**

| arm | destroyed | destr./disabled | cells dead | exchange |
|---|---|---|---|---|
| 1 cell, sight 14, 11 tiles | 0% | 11.5% | 77.0% | -181 |
| 1 cell, sight 14, 12.5 / 13.5 tiles | 0% / 0% | 19.5% / 17.0% | 0% / 0% | 0 / 0 |
| 1 cell, 8.5, displaces 2 tiles sideways after each round lands | 0% | 9.0% | 90.5% | -213 |
| 1 cell, 8.5, ducks behind a wall after each round lands, back 3 s before reload | 0% | 11.5% | 69.5% | -163 |
| the same in cover 2 | 0.5% | 23.5% | 7.0% | -12 |
| 3 cells, 12.5, sight 14 (or a side-wide cue: identical) | 21.5% (17.0%) | 70.0% (66.0%) | 0% (0%) | +195 (+154) |
| **3 cells, 12.5, a `sarim_rifles` spotter holding fire in cover 3 at 7 tiles** | **21.5% (12.0%)** | **70.0% (59.5%)** | **0% (0%)** | **+193 (+90)** |
| the same, 1,000 seeds (worst 200-seed block) | 18.0% (9.3%) | 62.1% (53.2%) | 0% | +158 (+59; max-tier worst +23) |
| 3 cells, 12.5, a `manpad_team` spotter in cover 3 at 11 tiles | 21.5% (17.0%) | 70.0% (66.0%) | 0% | +195 (+154) |

Displacing does not work in the open (the Lavi keeps its contact through a 2-tile move); ducking into
defilade is worth about 20 points of survival and kills nothing. (Displacement waits for the round to
land: the Kornet is beam-riding, the operator holds the sight until impact.) Outranging the gun works,
and a spotter that holds fire makes it work **without the 14-tile sight**: the spotter dies in 0.5-2.5%
of runs at base tier and 5.5-7.5% at max tier. Caveat: in this static probe the max-tier Lavi (sight 15)
sees the cells at 12.5 and still cannot shoot them (gun range 12); a real Lavi would close or smoke.
That is why this form is reported, not proposed for the gate.

**(c) Salvo and saturation**

| arm | destroyed | destr./disabled | cells dead | Trophy engagements saturated | exchange |
|---|---|---|---|---|---|
| 2 cells, open, today | 3.0% | 31.0% | 71.0% | 34.4% | -307 |
| 2 cells, open, held until the side identifies, released together | same outcomes | | | | |
| 3 cells, open, today | 13.5% | 51.0% | 55.7% | 56.5% | -270 |
| 3 cells, open, held and released together | same outcomes | | | | |
| 4 cells, open, together | 39.0% | 67.5% | 37.0% | 62.0% | +6 |
| 3 cells, cover 2 | 33.5% | 74.5% | 4.7% | 64.6% | +271 |

The hold-and-release doctrine produces the same outcomes as today, seed for seed, because the cells
already fire on the same tick (section 1). Saturation is real (the 3-cell row gets 1.31 penetrations per run through the Trophy against
0.14 for one cell) but saturation in the open still loses the cells; it is saturation from cover that
wins.

**(d) Trophy data**

| arm | destroyed | destr./disabled | cells dead | exchange |
|---|---|---|---|---|
| 3 cells, open, reload 30 s | 33.0% | 67.5% | 50.7% | -58 |
| 3 cells, open, magazine 2 | 25.0% | 58.5% | 50.0% | -126 |
| 1 cell / 3 cells, open, pk 0.6 | 0% / 27.0% | 13.0% / 65.5% | 89.0% / 51.3% | -209 / -117 |
| 3 cells, cover 2, reload 30 s | 61.0% (54.0%) | 89.0% (88.0%) | 3.8% | +526 (+438) |
| 3 cells, cover 2, pk 0.6 / 0.9 | 51.0% / 21.0% | 82.5% / 63.0% | 4.2% / 5.0% | +433 / +155 (max +245 / +26) |

Is the Trophy data optimistic? The one optimistic thing is structural, not a number: `reload_s` refills
the whole magazine every 8 s for ever, an unlimited stock behind a three-round ready rack. A real
system carries a finite load. A finite stock is a new concept (a `stock` field and a counter), so it is
`sim-guard`'s, not a data edit; `reload_s` 30 is only a stand-in for it, and it is the strongest single
lever measured (3-cell row 13.5% -> 33% destroyed). I could not find a public figure for the Trophy's
load or reload that would justify a number, so I do not recommend one. `base_pk` 0.75 sits mid-band of
a gated target and is left alone.

## 5. The data levers through every gate

Each lever was one edit in its own detached worktree. The four versus arms are the bar at 96 seeds
(mirror on the four fair maps, KDF v Sarim placed, `--economy`, `--tunnels` cell 3): 16 cells.

| | base (b3307ab2) | G1 Kornet sight 10 -> 14 | G2 firing x5 -> x2.5 | G3 Trophy reload 8 -> 30 s |
|---|---|---|---|---|
| Standoff 1 cell: destroyed / dis. / dead / exch | 0 / 8.5 / 91.0 / -214 | identical | identical | identical |
| Standoff 3 cells | 13.5 / 51.0 / 55.7 / -270 | identical | 20.5 / 54.0 / 50.7 / -171 | 33.0 / 67.5 / 50.7 / -58 |
| Standoff 3 cells, max tier | 10.0 / 49.0 / 63.8 / -359 | identical | 10.0 / 49.0 / 64.2 / -362 | 24.5 / 62.0 / 59.0 / -194 |
| `pnpm balance` (§5.7, both tiers) | all PASS | byte-identical | byte-identical | byte-identical |
| `pnpm playtest` | 37/37 plans 30/30, exit 0 | 37/37, **exit 1**: `LADDER_CREDITS` 5961 -> 5951 | 37/37, **exit 1**: `LADDER_CREDITS` 5961 -> 5966 | 37/37, exit 0, credits unchanged |
| versus, 16 offered cells within 60/40 | **16/16** (worst Sarim 59.4%) | **9/16** (worst KDF 68.8%) | 16/16 (placed arms byte-identical; tunnels re-rolled, worst Sarim 59.4%) | **4/16**: only the mirror holds; all 12 KDF v Sarim cells go Sarim (worst 70.8%) |
| `pnpm test:determinism` | 107/107 | 107/107 | 107/107 | 107/107 |
| `pnpm test` | all pass | 3 fail: `VERSUS_ECONOMY_PINS`, SU probe 4b band, versus-probe seat-table witness | all pass (one arena SIGINT flake under load, green alone) | 1 fails: versus-probe seat-table witness |

**Pins that would move.** The doctrine arms and the proposed gate: none (no data, no tuning, no sim
code; `pnpm balance` gains one line). G1: `LADDER_CREDITS` 5961 -> 5951 (`pnpm playtest`),
`VERSUS_ECONOMY_PINS` (`packages/app/src/net/match-world.test.ts`), the SU probe 4b band
(`tools/src/backtest/special-units-probes.test.ts`, Conduct lost killing an `atgm_cell`) and the seat-table
witness (`tools/src/backtest/versus-probe.test.ts`). G2: `LADDER_CREDITS` 5961 -> 5966 only. G3: the
seat-table witness only. In all three the golden hash and the other 106 determinism pins hold.

`pnpm balance` cannot see the cell: no §5.7 scenario fields `atgm_cell` (the ATGM and APS targets use
the KDF `at_team`). So a cell-data change is invisible to the backtest and visible everywhere else,
which is how G1 passes balance and fails the versus bar in both directions (Sarim 62.5% on Tel Marum
KDF-friendly, KDF 68.8% on Wadi Tarfan KDF-friendly). The Trophy reload is invisible to balance for the
other reason: `apsIntercept` measures the first engagement of a fresh magazine. G3 shows how much of the
KDF v Sarim versus balance rests on the Trophy refilling every 8 s: every one of the 12 faction, economy
and tunnel cells swings to Sarim (60.4-70.8%), while the KDF mirror does not move out of band.

## 6. Standoff as a gated §5.7 target

**Proposed text** (replacing the current line):

> **Standoff (Sarim):** three ATGM cells firing together from a prepared position (cover 2) at >= 8
> tiles win the cost exchange against an APS-equipped MBT over a 3-missile engagement each: exchange
> above zero and the MBT destroyed or disabled in >= 60% of engagements, both tiers (200 seeds). A
> single cell cannot win it, by construction (ruling 1 needs three penetrations), and is not measured.

**Bars and margins** (200 seeds, the committed probe's seeds 60000 + 11 s, the Lavi 8.5 tiles east):
exchange +271 base / +137 max (bar > 0; worst 200-seed block of 1,000 +169 / +99); destroyed or disabled
74.5% / 68.5% (bar >= 60%; worst block 67.5% / 64.0%).

**How it goes red** (each run, not imagined): the cover removed -> -270 / -359, 51% / 49% (both bars
fail); 2 cells instead of 3 -> base +59 / 54.5% (disabled bar fails), max -4 / 49% (both fail); cover 1
-> max tier -26 (fails). Trophy pk 0.9 (top of the gated band) -> max tier +26 / 53%: the exchange bar holds by a hair and the
disabled bar fails, so a Trophy pushed to the top of its band would red this gate. That is the coupling
the lead should accept knowingly: this gate and the APS target now bound `base_pk` from both sides.

**Where it lives:** a `standoff()` target in `tools/src/backtest/targets.ts` beside `apsIntercept`, run
by `pnpm balance` in both tables, reusing the committed probe's geometry with `setCover(x, y, 2)` under
each cell. It is a harness change under `tools/`, not sim code: no tuning, no golden hash, and no sim
pin can move. `vehicle-health-probe.ts` keeps its open-ground rows as the report-only context.

## 7. Lead decisions

1. **Retire the single-cell Standoff wording.** Recommend: yes. It is unreachable under ruling 1 and the
   APS target together (0.1% against ~23% needed; 3.5% with no Trophy at all).
2. **Gate the section form in §5.7** (section 6 text, both tiers, exchange > 0 and destroyed-or-disabled
   >= 60%). Recommend: yes. Cost: one target function and its test; nothing in the sim moves.
3. **Hand Sarim ATGM placement to `mission-author`.** 18 of the 19 shipped cell placements stand alone on
   cover 0 (the 19th in cover 1). Recommend:
   pairs or threes in cover 2-3 at 8-10 tiles from the approach where the story wants Sarim standoff
   (cells ship in `tel_marum_*`, `qarn_hadid_*`, `umm_zeitoun_*`, `beit_sahwan_1/3`, `khan_rafid_1/3`,
   `deir_amun_3`), each measured by `pnpm playtest`, because it will make those missions
   harder (that is the point of Sarim) and the plans may need re-routing. Not measured here.
4. **No data change from this issue.** Recommend: keep the Kornet's sight at 10 (sight 14 fails the versus
   bar 9/16 and moves four pins), keep firing x5 (a launch is loud; section 3 shows it is not the cause;
   x2.5 moves `LADDER_CREDITS` for nothing), keep the Trophy numbers (no public figure to set them by,
   and reload 30 s takes the versus bar to 4/16).
5. **Open a `sim-guard` issue for the two dead fields.** `sensors.thermal` (read by nothing) and
   `hidden_setup` (shown on the dock, no mechanic). Recommend: decide per field whether to give it a
   meaning (thermal: e.g. ignores smoke obscuration or a sight bonus at night, both model changes) or
   delete it from the data and the dock. And, separately, whether the Trophy should carry a finite stock
   (section 4d). Each is a model change and each would move this note's numbers; a finite stock would
   also re-open KDF v Sarim versus, which G3 shows leans on the 8 s refill (12 of 12 faction cells move).

## 8. What this did not measure

- The Lavi is alone, static and silent: no escort, no smoke, no reversing out of the beaten zone. The
  probe asks the target's question (a duel), not how a KDF player answers it.
- No mission was re-authored, so decision 3's effect on the campaign is unmeasured.
- The spotter arms use the shipped `sarim_rifles` and `manpad_team`; Sarim has no dedicated observer and
  this note does not propose one.
- Exchange values a destroyed Lavi only. A disabled Lavi (68-75% in the gated form) scores nothing,
  which flatters the KDF.

## 9. Reproduce

Scripts (outside the repo): `/Users/ilpinto/dev/roaring-lions-ep/_coord/standoff/` -
`zz-standoff-levers.ts` (drop into `tools/src/backtest/`, run
`npx tsx src/backtest/zz-standoff-levers.ts --seeds=200 [--tier=max] [--from=N] [--arms=prefix,...]`;
arm `A0` reproduces `pnpm vehicle-health:probe -- --only=s3` exactly), `run.sh` (the gate set per
variant) and `out/<variant>/` (every output quoted above).
