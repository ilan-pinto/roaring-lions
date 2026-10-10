# G3 decision sheet: the economy's shape, and the skirmish criteria (GH-167)

Gate **G3** · due 2026-10-30 · must be answered before Stage 4 (WP-G-F #183) opens on 2 Nov.
The answers go into `docs/HANDOVER.md` §3 with the date, and then #167 is closed.

This sheet has one page per question. Each page gives the question, the default, the evidence,
what each answer costs, and a recommendation. Every number is labelled **(M)** measured this
session or **(R)** reasoned. Measurements came from read-only runs of `pnpm playtest` and
`pnpm balance` on `main` at `751b6742`, and from throwaway probes kept outside the repo (see
"Method" at the end). No repo code, sim, data or tuning was changed.

## The questions at a glance

| # | Question | Default | Recommendation | Re-pins if taken |
|---|---|---|---|---|
| 1 | Fire-support intel: earned by doing (spotting, high ground, captures), with no trickle | Yes | **Yes.** Today's trickle pays the passive player more intel than the winner in 22 of 23 missions. Start from 10 intel per enemy first identified plus 25 per objective completed. | None expected: no plan spends intel, and credits do not read it |
| 2 | Income from held ground: zones on existing maps; a corridor cut by roads, ditches and tunnels | Yes | **Yes, layered.** The authored rate stays as the convoy, which the corridor cut halves. Income zones add to it, and a contested zone pays nobody. A skirmish is zones only. | Only the missions that get zones |
| 3 | Production with structure: the camp as the production site, reinforcements at a held point, one of cap / cooldown / batch | Camp plus cooldown | **Camp plus cooldown, built as one serial production line per camp.** A camp deploys only while it is not contested. The AI also gets a spend-down rule. | The 3 plans that build; the 8 missions with a camp |
| 4 | Population cap: enforce the field every unit carries, or delete it | Enforce | **Enforce, as an optional per-side cap.** No campaign mission sets one in Stage 4. It is set per doctrine in a skirmish, not as an equal number. | None if no campaign mission sets a cap |
| 5 | `starting_force` never consults `unlock`: feature or hole | Feature, documented | **Feature, documented.** Issued kit is the brigade's, and `upgrades_to` / `gate_only` stay the way restraint changes it | None |
| 6 | The skirmish fun criteria for G4 | Five games by the lead | **C1–C3 fixed, with numbers, on 30 seeds, plus C4 (game length), C5 (report-only spending) and the lead's five games** | None (criteria only) |
| 7 | The Sarim skirmish budget ratio the spike asked G3 to set | (spike: ~1.6×) | **1.6× the KDF's logistics, stored in the doctrine data and re-swept at G4 over 1.45–1.8×** | None (skirmish only; the campaign enemy is authored, not budgeted) |

### One correction to the gate's premise

The gate text says these answers "move the determinism hash and every playtest pin". That is
truer of the playtest pins than of the hash. `packages/sim/src/determinism.test.ts` never
constructs a `MissionRuntime` (M, grep). Intel accrual, income, the build queue and a population
gate all live in `MissionRuntime`. So Q1–Q4 as recommended move **no golden hash**. The hash
moves where WP-G-F adds *sim* state, for example a structure placed mid-mission (field works,
Stage 5) or a commander phase inside the tick (spike gap G-10). The playtest ladder and
`LADDER_CREDITS` move wherever an outcome, a duration or a grade moves. They are re-run after
every plan regardless.

---

## Q1 · Fire-support intel: earned by doing

**Question.** Should intel come from what the player does (spotting, holding high ground,
capturing), with no trickle?

**Default.** Yes. A trickle inside a 5–7 minute mission never pays off.

**What runs today** (M, `packages/sim/src/mission.ts:412-417, 1045-1063`). Intel accrues at
8/min for each living drone, and at 5/min for each `mark_target` unit that **is not moving**.
That second group includes every `inf_squad` (M, `data/units/kdf/inf_squad.json`). A sweep costs
150 and a strike costs 250. Two missions grant `intel_start` (`umm_zeitoun_2_buildup` 150,
`umm_zeitoun_4_clearance` 250). No `playtest.ts` plan calls `requestSweep` or `requestStrike`
(M, grep). Only `packages/app/src/main.ts` does.

**Evidence: the trickle pays standing still.** Every playtest run was instrumented to read
`rt.intel` at the end (M, 26 winning plans, 23 passive or no-orders controls):

| | net intel earned (end minus start) |
|---|---|
| passive control earned more than the winning plan | **22 of 23 pairs** |
| best winning plan | 107 (`umm_zeitoun_2_buildup`) |
| passive `khan_rafid_3_clearance` | 189, more than a sweep, from doing nothing |
| winning `khan_rafid_3_clearance` | 20 |
| passive `umm_zeitoun_3_clearance` / winning | 139 / 27 |
| passive `tel_marum_3_clearance` / winning | 114 / 94 |

Without `intel_start`, no winning plan ever reaches the 150 a sweep costs (M). A passive force
reaches it in 2 missions. The intel rule as it stands rewards the very play every passive probe
exists to punish.

**Evidence: what "by doing" would pay.** The same runs counted the enemies first identified by
side 0 and the objectives completed (M):

| rule (calibration candidates) | winning plans: min / median / max | winners ≥ 150 (one sweep) | passive: median | passive ≥ 150 |
|---|---|---|---|---|
| 10 per identified enemy + 25 per objective | 135 / 193 / 390 | 24 of 26 | 0 | 1 of 23 |
| 12 + 25 | 147 / 214 / 458 | 24 of 26 | 0 | 2 of 23 |
| 15 + 30 | 180 / 263 / 570 | 26 of 26 | 0 | 2 of 23 |

The passive outlier is `beit_sahwan_breach`, where the enemy walks into the compound and gets
identified (34 enemies). That is correct for a breach. High ground is not measured here: a
"hold an observation post on a level ≥ 2 rise" term is (R) and belongs to G-F's plan. These are
end-of-mission totals. *When* in the mission the intel arrives is G-F's to tune, because intel
that arrives at the victory banner buys nothing.

**What each answer costs.**
- **Yes (by doing).** Runtime only: no golden hash change. No playtest outcome should move,
  because no plan spends intel, and `creditInputFrom` (`packages/sim/src/credits.ts:59`) reads no
  intel, so `LADDER_CREDITS` should not move. The ladder is still re-run to prove both (R). Content
  that must be checked: `umm_zeitoun_2/4`'s `intel_start`, and every briefing line that promises a
  sweep. The schema field `intel_rate_per_min` (#183 F1) stays optional for missions that want an
  informant feed.
- **No (keep the trickle).** Nothing to change. Sweep and strike stay effectively dead content,
  and the rule keeps paying passivity.
- **Hybrid** (drone loiter kept, the stationary-scout term deleted). This halves the passive
  payout (R). The drone still pays 56 per 7-minute mission for parking.

**Recommendation.** **Yes.** Delete both per-minute terms and pay for first identification and
for completed objectives. Start at 10 + 25, the cheapest row that gives nearly every winning plan
one sweep and gives a passive player none. Keep an authored `intel_rate_per_min` for the
informant or SIGINT feed the GDD names.

---

## Q2 · Income from held ground

**Question.** Should logistics come from held zones on the existing maps, with a corridor that
roads, ditches and tunnels cut?

**Default.** Yes.

**What runs today** (M). Logistics is a flat `logistics_rate_per_min` (`mission.ts:1047`).
`supply_corridor` is declared by `umm_zeitoun_2_buildup` and `umm_zeitoun_4_clearance` and **read
by nothing**: the code comment says "interdiction (supply_corridor) is a later slice". 17 of the 26
campaign missions have an economy, at 80–150/min (M, census). The GDD anchors are foothold ~120,
build-up ~200, clearance ~80, halved by interdiction (`docs/GDD.md` §3).

**Evidence: today's economy is not a decision.** Logistics was read at the end of every winning
plan (M):

| | count |
|---|---|
| winning plans on an economy mission | 18 |
| banked **100%** of what they earned | **15** |
| spent anything | 3: `deir_amun_2_foothold` (banked 10%), `wadi_halam_2_laager` (17%), `beit_sahwan_2_foothold` (77%) |

The GDD's own sanity rule is "banking >30% unspent at a win means income is too high or
objectives too cheap". 16 of 18 plans break it. Passive controls bank everything as well. Income
from held ground fixes *who earns*. It does not by itself give anyone a reason to *spend*. That
is Q3's job, and the two must land together (R).

**Evidence: contested ground pays nobody, and that drives the fight** (M, the G-G0 spike, 10 and
30 seeds). With four zones that each pay only while one side holds them exclusively, the commander
took ground it did not start on in 10/10 games (C1a), and disputed 77–95% of player captures
within 30 s (C1b). The spike says "Contested-pays-nobody is the rule that made both sides fight
for the approach. Keep it." Its rate of 2 per zone-second (480/min for four zones) was chosen to
make waves happen and is well above the anchors.

**Evidence: the maps can carry it** (M). Every economy mission's map already declares 6–11
zones. Road tiles stand on 17 of the 18 economy missions (`tel_marum_2_foothold` has none).
Tunnels stand on Beit Sahwan and Deir Amun.

**What each answer costs.**
- **Yes, pure zones** (the default read literally). Every one of the 17 economy missions gets
  zones and loses its flat rate. A player who is losing ground earns less, which snowballs inside
  seven minutes (R). Every plan that builds (3) needs re-proving, and every mission's banking
  number moves.
- **Yes, layered** (recommended). The authored rate stays as the convoy. `supply_corridor: true`
  makes it interdictable: halved while the corridor is cut, per the GDD. A mission may add
  `income` zones, paying only while held uncontested, priced from the same anchors. Missions that
  declare no zones are unchanged, so there are no forced re-pins. The two corridor missions become
  live, and those two are re-pinned. Runtime only: no golden hash, unless G-F puts zone ownership
  into sim state.
- **No.** The flat rate stays, the skirmish has no income model (spike gap G-8), and #183 F2 is
  dropped.

**Recommendation.** **Yes, layered.** Convoy plus held-ground zones in the campaign, zones only
in a skirmish, and contested pays nobody. Rates come from the GDD anchors (a full hold ≈ the
phase's anchor), not from the spike's 480/min. What cuts the corridor (a road tile held by the
enemy, a ditch, a tunnel mouth within N tiles) is G-F's to define. The yardstick is the GDD's
banking rule, measured with this sheet's probe.

---

## Q3 · Production with structure

**Question.** Should the field camp be the production site, with reinforcements arriving at a
held point, and with one of cap, cooldown or batch? No base building, no harvesters, no mirrored
tech trees (GH-109, GH-115). Field works (#277) re-opened building at the lead's request.

**Default.** Camp plus cooldown.

**What runs today** (M, `mission.ts:595-690`). `requestBuild` checks the unlock gate, the
camp, logistics and intel, then queues the unit with `readyTick = now + build_time_s`. **The
queue is parallel**: five orders in one tick deploy together after one build time. The only
governor is logistics. A unit deploys beside a living camp; a mission that never had a camp falls
back to `player_start`, and one whose camp died gets "field camp destroyed — no production". 8
missions stand a camp: 6 through mission `structures`, and `umm_zeitoun_3/4` through the map
symbol `c` (M). Field works (#277, spec 2026-09-29) are paid from **mission logistics** (§1, "Cost currency: logistics only"; the medic station example in §4 costs 250), as
a unit is, so from Stage 5 they compete with units for the same
purse.

**Evidence.**
- (M) 15 of 18 winning plans never build (Q2's table), so the campaign does not yet stress any
  governor. Cap, cooldown and batch all read identically on today's ladder.
- (M, spike §8.4) For the AI, a 30 s cooldown with a gap-driven spender bought 2–3 waves when
  pressed and banked everything when not: 3,816 unspent against a passive player, at every force
  size. In the 30-seed sweep at 1.63× (Q7), the commander still ends `naive` games holding
  670–1,630 unspent (M). A cooldown governs the player, and the AI also needs a spend-down rule.
- (R) A parallel queue with no governor turns a big purse into a single instant wave. Once income
  rises toward the build-up anchor of 200/min, that is the "mass at the end" failure the GDD's
  banking rule exists to catch.

**What each answer costs.**
- **Cooldown as one serial production line per camp** (recommended). Each camp builds one unit at
  a time, using the `build_time_s` every unit already authors. That *is* the cooldown, with
  per-unit numbers that already exist and already sit on the cost curve. A second camp, a field
  work in Stage 5 if the lead adds it to the buildable list, is a second line. That puts a decision
  where GH-136 wanted one. Deploying requires the camp not to be contested, reusing the hold rule's
  `CONTEST_RADIUS_SQ` (6 tiles): reinforcements arrive at a point the player *holds*. Runtime only.
  Re-prove the 3 building plans. `LADDER_CREDITS` moves only if a grade moves.
- **Global cooldown** (one unit per N seconds, whatever the camp). Simpler, but a new number per
  mission, and a second camp means nothing.
- **Cap** (at most N queued). Does nothing that a serial line does not already do.
- **Batch** (buy in lots). Fights the "replacement" reading that the one plan that does spend
  (`deir_amun_2_foothold`) relies on.
- The officers' `cost.logistics` (Maya 200, Sagi 210, Dalia 205, Ronen 906, #356) are "never
  charged" curve-fit numbers. If officers ever deploy through the line, they become prices and need
  their own G-NUM. Recommended: officers stay a deploy slot.

**Recommendation.** **Camp plus cooldown, built as one serial line per camp, deploying only from
an uncontested camp.** Pair it with Q2 so there is something to spend on. Give the AI a
spend-down rule. Keep a mission-placed camp in Stage 4. Whether the player may *build* a camp is a
field-works question for Stage 5, and it stays inside GH-115's limit: no construction yard, no
power, no sell.

---

## Q4 · Population cap

**Question.** Enforce the `cost.population` field every unit carries, or delete it?

**Default.** Enforce.

**What runs today** (M). `unit.schema.json:82` declares `population` (integer, default 1). Every
unit JSON sets it: drones 0, most teams 1, `apc_eitan`/`ifv_namer`/`apc_kipod`/`heli_peten`/
`sarim_rifles` 2, `mbt_lavi`/`rocket_battery`/`heli_peten_gunship` 3. **No code in
`packages/sim` reads it** (grep). No mission declares a cap. `ROSTER_CAP` (150) is the campaign
pool, a different thing.

**Evidence** (M, census of all 27 missions):

| | range |
|---|---|
| KDF starting population | 6–20 (`umm_zeitoun_4_clearance` 20) |
| extra population buildable in `target_minutes` at the cheapest unit (209) | 0–7 |
| KDF ceiling any mission can reach | ~26 |
| enemy placed population | 0–19, plus 0–27 from waves and triggers |
| spike, KDF skirmish force | 10 pop (2,957 logistics) |
| spike, Sarim at ×1 / ×2 | 20 / 27 pop (3,461 / 4,816 logistics) |

The two doctrines are not population-symmetric. At the ratio Q7 recommends, Sarim fields 2.7× the
KDF's population, because cheap teams are Sarim's shape (GDD §2, "asymmetry is structural"). An
*equal* cap per side would quietly undo Q7.

**What each answer costs.**
- **Enforce, optional per side** (recommended). Add `resources.pop_cap` (per mission) and a
  doctrine `pop_cap` (per skirmish). `requestBuild` and the AI's wave spend refuse past the cap.
  Absent means uncapped, so no shipped mission changes and nothing is re-pinned. Runtime only. A
  cap is then a dial for a later build-up mission ("you may field 18"), and a guard against an AI
  that banks and dumps.
- **Enforce, global** (one number for everyone). Bites `umm_zeitoun_4_clearance` (20 placed)
  below 20 and breaks skirmish asymmetry. Not recommended.
- **Delete.** Remove the field from 34 unit JSONs and the schema. That loses the cheapest guard
  the skirmish has, and `validate:data` would need the edit in the same commit.

**Recommendation.** **Enforce, as an optional cap per mission and per doctrine.** Leave it unset on
every campaign mission in Stage 4. It earns its keep in the skirmish and in any future build-up
mission that wants a ceiling.

---

## Q5 · `starting_force` never consults `unlock`

**Question.** Is it a feature or a hole that a placed unit ignores its unlock gate?

**Default.** Feature, documented. Resolving it the obvious way strips Wadi Halam V of both
demolishers.

**Evidence** (M, census and `pnpm playtest`).
- **68 gated placement lines in 26 of the 27 mission files.** Only `beit_sahwan_breach` has none.
  9 of them are `from_ledger`. By unit: `recon_drone` 20, `ifv_namer` 17, `mbt_lavi` 11,
  `demo_squad` 8, `yahalom_squad` 7, `sniper_team` 4, `dozer_d9` 1.
- `wadi_halam_5_depot` fields `dozer_d9` (Conduct 87) and `demo_squad` (77) unconditionally.
  Its `raze` primary has a deadline, so stripping both would turn the mission into a lost one (it
  stays winnable on paper and loses on the clock).
- On the optimal ladder every Conduct gate is open after mission 1 (`gate … OPEN after mission
  1`). The obvious fix would therefore bite only a player whose Conduct sits below a floor:
  below 90 loses the Lavi from 11 placements. That is the one real argument for the "hole" reading:
  restraint would shape the issued force.
- The sanctioned way for restraint to shape a placement already exists and ships: `upgrades_to`
  (6 missions) and `gate_only` (`qarn_hadid_3_clearance`'s jeep), resolved once by `resolveUpgrades`.
  `requestBuild` does consult the gate, so the build list and the reserve are already gated.

**What each answer costs.**
- **Feature, documented** (recommended). One paragraph in the GDD and the schema description:
  "the issued force is the brigade's; the gate governs what you buy and what you may upgrade to".
  Zero re-pins.
- **Hole, fixed obviously.** Every one of the 26 missions needs a fallback (`upgrades_to` reversed,
  or an ungated substitute) and a world walk. Every chain in `pnpm playtest` is re-run with closed
  gates. Wadi Halam V needs a new demolisher answer. This is about a Stage 4 plan of its own, for a
  rule only a below-floor player would ever notice.

**Recommendation.** **Feature, documented.** New content should express "restraint earns the better
kit" through `upgrades_to`, as it already does, rather than through the spawner.

---

## Q6 · The skirmish fun criteria for G4

**Question.** What fixed, measurable criteria judge the skirmish at G4?

**Default.** Five games by the lead: contest income ground, answer a flank, lose to a good plan
without a script.

**Evidence** (M, spike report and this session's 30-seed sweep). The spike's C1–C3 were written
before any code existed, which is right. Three things it learned change how they should be
written:
1. **Ten seeds is not enough.** The same configuration read `good` 5/10 on the fixed seeds and
   19/20 on fresh ones. At a 30-seed sample and win rates around 0.5–0.8, the 95% two-proportion
   threshold between two plans is ~7 wins (R, binomial: 1.96 × √(0.8·0.2/30 + 0.47·0.53/30) × 30 ≈
   6.9).
2. **C2a and C2b, as committed, cannot pass for the right reason.** A lone flank already dies to the
   static garrison (98% of its HP), so the 2× ceiling is 1.02×. A commander that kills the flank
   *south* of the wall never sees "contact north of the wall". The spike's re-scored C2b (inside
   `good`) and its supplementary C2a′ are the honest versions.
3. **Games end in 2–4 minutes at ×1**, under the 5–7 minute unit of content. At 1.63× the median
   is 7.0 min against `naive`, 4.5 against `good` and 3.0 against `concentrated` (M, 30 seeds).

**Proposed criteria.** All are gating unless marked. Judged on **30 seeds** (the spike's fixed ten
`424242 … 8888` plus its alternate twenty `11 … 777`, kept as a named list), at Q7's ratio, with
the same five plans (`passive`, `naive`, `flank`, `good`, `concentrated`) and the static control:

| id | criterion | threshold | spike reading at 1.63× (×2) |
|---|---|---|---|
| C1a | take uncontested ground: vs `passive`, ≥ 3 of 4 zones incl. one south of the wall by 120 s | ≥ 27/30 | 10/10 (R2) |
| C1b | dispute captures: a `commit` at, or a logged `withdraw` from, each player capture within 30 s | ≥ 75% pooled | 77% (R2) |
| C1c | out-earn a bad player: commander's share of points > 50% vs `naive` | ≥ 16/30 | 6/10 (R2) |
| C2a′ | react to a flank: any contact on a doctrine-named route answered within 30 s | ≥ 24/30 | 10/10 |
| C2b′ | make it cost: corridor party HP lost **inside `good`**, commander vs static | ≥ 2.0× | 2.07× (R2) |
| C2c | the flank alone is not the answer | `flank` ≤ 3/30 and < `good` | 0/30 < 24/30 (M) |
| C3a | beatable: `good` wins | ≥ 21/30 | 24/30 (M) |
| C3b | a skill gradient: `passive` 0/30; `naive` loses most; the gap is beyond noise | passive 0; naive ≤ 14/30; good − naive ≥ 8 | 0; **14/30**; 10 (M) |
| C3c | no script: 0 timed waves, 0 triggers on the commander side; decision traces distinct | ≥ 27/30 good seeds distinct | 10/10 (R2) |
| C3d | no frame to memorise: `good` with every order ±15 s | ≥ 18/30 each | 9/10, 6/10 (R2, 10 seeds) |
| C4 | length: median game vs `naive` and vs `good` | ≥ 4.0 min each | 7.0 / 4.5 (M) |
| C5 | spending (**report-only**; the lead may promote it): commander unspent budget at game end, mean over `naive` and `good` | ≤ 30% (the GDD's banking rule) | fails: round 2 banks by design until a main effort |
| E1 | determinism: two runs of each plan on one seed match hash, score and trace; commander state inside `sim.hash()` (gap G-10) | identical | identical (outside the hash) |
| E2 | cost at 300 living units | amortised ≤ 0.1 ms/tick; worst think ≤ 10 ms | 0.022–0.039 ms; 5.2 ms (R2) |
| L | **the lead's five games** through the `?sandbox=…&commander` flag: one of them a deliberate attack-move with everything | the attack-move game is lost, and ≥ 4 of 5 marked "would play again"; per game the lead also notes "contested ground y/n" and "answered my flank y/n" | not yet playable (flag not built) |

C3b at 14/30 passes today with **zero margin**. That is why the gap term (≥ 8) sits beside it:
a plan that edges naive under 15 by luck still has to show a real gradient. "Good" is named by its
shape (pin plus manoeuvre); `concentrated` is reported beside the criteria, never inside them, as
the spike did.

**Cost.** None to the repo. These are criteria. The sandbox flag is a few hours in
`packages/app` before G4 (spike §7).

**Recommendation.** Adopt the table as written and the 30-seed list. Rule now on whether C5 gates
at G4 or at the G-G landing. This sheet recommends at the landing, because the round-2 doctrine
banks on purpose.

---

## Q7 · The Sarim skirmish budget ratio

**Question** (added by the spike). What budget, as a multiple of the KDF's logistics, does a
Sarim doctrine get in a skirmish?

**Default.** None in the plan. The spike's condition was "about 1.6×, set in G3".

**Evidence** (M, this session). The spike harness was re-run (`spike/skirmish-g0` at
`2cd77e4a`, round-2 doctrine, unchanged) across nine force sizes on the full 30 seeds. KDF wins
out of 30:

| SK_EXTRA | Sarim logistics | ratio to KDF 2,957 | passive | flank | naive | good | concentrated | good − naive |
|---|---|---|---|---|---|---|---|---|
| 1 | 3,461 | 1.17× | 0 | 0 | 27 | 28 | 30 | 1 |
| 1.4 | 3,931 | 1.33× | 0 | 0 | 27 | 27 | 29 | 0 |
| 1.6 | 4,271 | 1.44× | 0 | 0 | 21 | 27 | 29 | 6 |
| 1.8 | 4,611 | 1.56× | 0 | 0 | 19 | 29 | 24 | 10 |
| **2** | **4,816** | **1.63×** | **0** | **0** | **14** | **24** | **28** | **10** |
| 2.2 | 5,051 | 1.71× | 0 | 0 | 16 | 24 | 22 | 8 |
| 2.4 | 5,286 | 1.79× | 0 | 0 | 9 | 23 | 19 | 14 |
| 2.6 | 5,626 | 1.90× | 0 | 0 | 15 | 26 | 16 | 11 |
| 3 | 6,171 | 2.09× | 0 | 0 | 13 | 22 | 12 | 9 |

The ×1 and ×2 rows reproduce the spike's own 30-seed figures exactly (27/28/30 and 14/24/28). The
rows are bands, not a curve: ±3 wins is one standard error (R). Read as bands:
- Below ~1.45× there is no gradient: `naive` wins as often as `good`.
- From 1.56× to 1.79×, `naive` falls under or near half while `good` holds at 23–29.
- Above ~1.8×, `concentrated`, the strongest plan, starts losing more than `good` (19 → 12). The
  skirmish stops rewarding a fist.
- At 1.63×, all of C2c, C3a, C3b and C4 pass (Q6), and `concentrated` still wins 28.

Caveats (R). One map (`tel_marum_3`), one doctrine, one KDF force. The extra block adds ATGMs
first, so the ratio and the composition move together. `pnpm balance` reports no cross-doctrine
exchange rate (M, it prints only the §5.7 targets, all PASS). The spike's root cause still holds:
a Kornet lands 1–5 rounds a game against a Lavi behind Trophy, so Sarim needs mass.

**What each answer costs.** None in the campaign. Campaign enemies are authored placements, not
budgets, so no mission, no playtest pin, no credit and no hash moves. The ratio is a field in a
doctrine file (`data/doctrines/*.json`, spike gap G-9), applied to the skirmish budget and to the
commander's wave menu. It is never purchasable: a skirmish budget is per-match logistics, never
credits or Roar coins, so the coin rule (network play uses earned only, #317) is untouched.

**Recommendation.** **1.6×**, stored as doctrine data. G4 re-sweeps 1.45×, 1.56×, 1.63×, 1.71×
and 1.79× on the 30 seeds against Q6's table, and ships the lowest ratio that passes all of it.
G-G adds a cross-doctrine exchange-rate report to `pnpm balance`, as the spike asked, so a second
doctrine is not priced by hand. If no ratio in that band passes, the spike's stated no-go applies:
Sarim needs directed fire (gap G-7), not more mass.

---

## Cross-cutting: credits, coins, heroes, the first session

- **Brigade credits and Roar coins are campaign currencies. G3 decides mission currencies**
  (logistics, intel). The only coupling is that `LADDER_CREDITS` moves when a grade moves.
  `LADDER_CREDITS` reads **5,736** on `main` (M, `pnpm playtest`: "credit ladder: 5736 over 26
  missions"). It was 5,849 before the first-session redesign removed First Light's build loop.
  #330 (a fresh campaign pays again) touches `credits.ts` and the same pin. Land it as its own
  re-pin, first or last in the Stage 4 order, never folded into a G-F plan, so each re-pin keeps
  one reason.
- **Coins replace credits 1:10, and network play uses earned only** (lead, 1 Oct). A skirmish win
  could pay *earned* credits (the coin spec's R2). That is a G-G/ST question, not G3's. Nothing in
  this sheet sells a skirmish advantage.
- **The hero numbers (#356)** priced officers in logistics that is "never charged". Under Q3 they
  stay a deploy slot. If the lead wants officers bought from the line, they need their own G-NUM.
- **The first tester /stats reading** (WP-TC #302, due before 30 Oct) does not exist yet. If it
  lands before the answer, check two things first: whether real players call a sweep or a strike at
  all (Q1), and whether they press Build (Q3).

## Method (all throwaway, outside the repo)

- `pnpm playtest` and `pnpm balance` on `751b6742`, unmodified: both exit 0. Ladder 5,736, roster
  maximum 30, all §5.7 targets PASS at base and at max tier.
- **Economy probe.** A copy of `tools/src/backtest/playtest.ts` in the session scratchpad, with
  two lines added to `run()`. It prints, after each run, `rt.intel`, `rt.logistics`, the logistics
  earned (start + rate × elapsed), the number of distinct side-1 units first identified by side 0
  (from the sim's `contact` events), and the objectives complete. The plans and seeds are
  byte-identical to the gate. Every outcome line matched `pnpm playtest`'s own.
- **Census.** A Node script over `data/missions`, `data/units` and `data/maps`: population, unlock
  gates on `starting_force`, economy fields, camps, zones, road tiles.
- **Ratio sweep.** A detached worktree of `origin/spike/skirmish-g0` (round 2), with
  `SK_EXTRA=<x> [SK_SEEDS=alt] npx tsx src/skirmish/skirmish.ts --only=passive,naive,flank,good,concentrated`
  for nine values of x and both seed sets. Game lengths were read off the per-seed `W:/L:` tags.
