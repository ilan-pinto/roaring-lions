# Mission amendments and a challenge mark (GH-1395) — design for the lead

**Date:** 2026-11-15 · **Status:** a proposal for the lead to approve before any build. Docs only: no code, no data,
no sim change. A mock is beside it: `2026-11-15-challenge-star-mock.html` and its screenshot `2026-11-15-challenge-star-mock.png`.
**Issue:** GH-1395, "Add replay value: mission modifiers and a challenge star" (audit dimension D5, now 64, target 80).
**Done means (from the issue):** each won mission offers at least two optional modifiers as data and a third star for a
named challenge; `pnpm playtest` holds a winning plan for each challenge; the campaign board shows what is left to earn.
**Constraints (from the issue):** credits pay only for improvement within this campaign and only for an open mission, so
no farm; design first, a short spec and a mock for the lead before any build.

**What I read to write this** (this session, `main` at `2da9ba78a`): `packages/sim/src/grade.ts` (`starsFor`,
`MissionResult`, `betterResult`), `credits.ts` (`CREDIT_WEIGHTS`, `creditsFor`, `creditInputFrom`), `unlock.ts`
(`starsEarned`), `mission.ts` (the objective pass, `checkEnd`, the ledger write), `packages/app/src/campaign-pay.ts`
(`payScope`, `payVictory`), `roar-earn.ts` (the coin table and its G-E2 pin), `ui/after-action.ts` (the ladder),
`ui/worldmap.ts` (`townStars`), `packages/economy/src/ledger-shape.ts`, `data/schemas/mission.schema.json`,
`tools/validate_time_limit.mjs`, and the cosmetics-shelf design (GH-1416, PR 1442) for the never-power guard.
**Nothing was run and nothing was built.** Every behaviour below is read from those files; every check in §8 is a proposal
whose mutation the implementer runs.

---

## 0. The one-paragraph answer

Give every won mission a short list of **amendments** (the in-fiction word for a modifier: the brigade amends the
orders) and one named **challenge**. An amendment is a **data overlay on the mission JSON**, applied by a pure function
before the runtime is built, exactly the way `applyUpgrades` already is: **the sim never learns amendments exist.** A
challenge is a fixed set of amendments plus a **predicate over the result row the ledger already stores**
(`MissionResult`: `roe`, `ticks`, `lost`, and "every carrying secondary done"). Earning it records a **fourth mark, a
silver diamond, not a fourth star**, in a new ledger key. It **pays nothing**: no credits, no coins, and it does **not**
count toward `starsEarned`, so it can neither open a unit nor be bought. The payoff is the board's "what is left to earn"
and, later and by separate decision, an earned-only cosmetic.

## 1. Why a diamond and not a "third star"

The issue says "a third star for a named challenge", but the third star already exists: the Ari'im citation, a win with
Conduct above the floor and every `carries` secondary done (`starsFor`). A second "third" would be two things with one
name. Worse, **stars are a currency**: `starsEarned` sums every mission's best grade and gates the three star-locked
units, and the coin table pays 5 per new star against a pinned lifetime total of 830 (`roar-earn.ts`, gate G-E2). A
challenge counted as a star would move both, and a harder replay would become the route to units. So the mark is
separate, and §5 lists every place it must not leak.

## 2. What exists as data today, and what it costs the sim

The census of levers a mission file already carries. Every row is a **restriction**: an amendment may make a mission
harder or leave it alone, never easier (rule A1, §4).

| lever | field (verified) | amendment it makes | sim change? |
|---|---|---|---|
| the clock | `time_limit_s` (`mission.ts` `timedOut`); the house floor is `validate_time_limit.mjs` | **Tight clock**: scale the limit down | none, but bounded: at least `2 × target_minutes` and 60 s past every primary deadline, or `validate:data` refuses it |
| Conduct | `roe.fail_below`; the star-2 floor is `failBelow + 20` (`starRoeFloor`) | **Clean hands**: raise `fail_below` | none |
| a ceiling | a `no_collateral_above` objective (needs ROE on and another primary) | **Clean hands, hard**: lower its `threshold`, or add one | none |
| the force | `starting_force[].count`, `from_ledger` | **Light order**: remove a squad. **Fresh crews**: `from_ledger: false` throughout (veterancy lost) | none |
| the purse | `resources.logistics_start`, `logistics_rate_per_min`, `intel_start` | **Thin purse**; **No eyes** (`intel_start: 0`, no strikes or sweep) | none |
| the enemy | `enemy.garrison`, `enemy.waves`, `triggers` with `spawn` | **Reinforced**: one more placement or wave (per mission) | none, but each added placement must pass the spawn-clear rule on that map |
| the work | `objectives` (a secondary, a larger `count`) | **A longer ask**: raise an evacuation count, add a non-carrying secondary | none |
| the light | `map.time_of_day` | not an amendment: it is **presentation only** (app-read), so it changes nothing to beat | n/a |

**The result predicates already exist.** `MissionResult` stores `stars`, `roe`, `ticks` (sim ticks, 20 a second) and
`lost` for every mission's best run, and `grade.ts` already says losses and time are "shown on the debrief and never
graded". A challenge is the first thing to grade them, and it does so **without changing `grade.ts`**: it reads the same
row. "Everyone home" is `lost == 0`; "inside the target" is `ticks <= target`; "Conduct 70" is `roe >= n`. One caveat read from `mission.ts` (the `thisResult` row): `lost` counts **every player unit that died, built ones included**, while credits count the starting force only. On an economy mission "nobody lost" is therefore stricter than "everyone home" in the credit sense; the deploy line should say *no unit lost*, not *the starting force home*.

## 3. The data

### 3.1 One library, one file per mission

`data/challenges/amendments.json` (schema `amendments.schema.json`) defines the **generic** amendments once, as closed
operations computed from the mission's own numbers, so authoring is not 29 × 2 hand-written patches:

```json
{ "id": "tight_clock", "label_key": "amend.tight_clock.label", "blurb_key": "amend.tight_clock.blurb",
  "ops": [{ "op": "scale_time_limit", "num": 3, "den": 4 }] }
{ "id": "clean_hands", "label_key": "amend.clean_hands.label", "blurb_key": "amend.clean_hands.blurb",
  "ops": [{ "op": "raise_fail_below", "by": 10 }] }
{ "id": "light_order", "label_key": "amend.light_order.label", "blurb_key": "amend.light_order.blurb",
  "ops": [{ "op": "remove_starting", "role": "infantry", "count": 1 }] }
{ "id": "fresh_crews", "label_key": "amend.fresh_crews.label", "blurb_key": "amend.fresh_crews.blurb",
  "ops": [{ "op": "fresh_crews" }] }
{ "id": "thin_purse", "label_key": "amend.thin_purse.label", "blurb_key": "amend.thin_purse.blurb",
  "ops": [{ "op": "scale_resources", "num": 1, "den": 2 }] }
{ "id": "no_eyes", "label_key": "amend.no_eyes.label", "blurb_key": "amend.no_eyes.blurb",
  "ops": [{ "op": "set_intel_start", "value": 0 }] }
```

`data/challenges/<mission_id>.json` (schema `challenge.schema.json`) says which apply there and names the challenge:

```json
{ "mission": "beit_sahwan_2_foothold",
  "offers": ["tight_clock", "clean_hands", "light_order"],
  "own": [],
  "challenge": { "id": "quiet_souk", "label_key": "challenge.beit_sahwan_2.label",
                 "blurb_key": "challenge.beit_sahwan_2.blurb",
                 "amendments": ["tight_clock", "clean_hands"],
                 "win": { "lost_at_most": 0, "ticks_at_most_target": true } } }
```

`own` holds the few **per-mission** amendments (an extra wave, a longer evacuation ask) as `add_garrison`, `add_wave`,
`add_trigger` and `add_objective` ops, authored against that mission's map. Everything is **integers and keys**: no
float, no text (labels and blurbs are `en.json` keys, like every chrome string).

### 3.2 The operations are a closed set, and the paths an allowlist

`scale_time_limit`, `raise_fail_below`, `lower_ceiling`, `remove_starting`, `fresh_crews`, `scale_resources`,
`set_intel_start`, and the four `add_*`. Nothing else. There is no generic "set any path": the point of a closed set is
that every operation has a monotone effect the checks in §8 can prove (rule A1). A new operation is a schema change made
once, never a free patch.

### 3.3 The applier

`applyAmendments(mission, ids, catalogue)` lives in `@lions/data` beside `applyUpgrades`, **pure and deterministic**
(same inputs, same output, no clock, no RNG). It is called from the same three places `applyUpgrades` is: the app
before `addUnitType`/`new MissionRuntime`, the playtest harness, and the backtest. `@lions/sim` imports nothing new.
With an empty id list it returns the mission **untouched, by reference** (the gate for check C1).

A modified run is a **different mission JSON**, so its hash differs from the unamended run's. That is correct, and it
means a recorded replay must carry the amendment ids (§7, D10).

## 4. The rules that keep amendments honest

| rule | statement | enforced by |
|---|---|---|
| **A1** | **An amendment never makes a mission easier.** Time shrinks, floors rise, forces and purses shrink, enemies and asks grow | the closed operation set; the playtest check C6 (sensible win rate with an amendment on is no higher than without, over 30 seeds) |
| **A2** | **No amendment raises what the credit formula reads.** It adds no starting unit, no `carries: true` secondary, and never lowers `fail_below` | check C3, a bound over `creditsFor`'s inputs |
| **A3** | An amendment never touches an objective's id, type or target (`level-scripter`'s and `mission-author`'s fields), and never a tagged unit | `remove_starting` refuses a placement carrying a `tag` (the escort's `blades`, an `eliminate_hvt`'s target) |
| **A4** | Every modified mission still passes `validate:data`, including the clock floor and every spawn-clear rule | check C4 and C5 |
| **A5** | An amendment is chosen before deploy and never changes mid-mission | the deploy screen is the only place it is set |

## 5. Scoring and showing the challenge

### 5.1 How the mark is earned

The challenge is earned on a **victory** run in which **every amendment the challenge names is on** (extra amendments on
top are allowed) and the **predicate holds on that run's own result row**. The predicate fields are a closed set:
`conduct_at_least`, `lost_at_most`, `ticks_at_most_target` (the mission's own `target_minutes`, which the debrief already
shows), and `carries_all`. It reads exactly what `MissionResult` and `creditInputFrom` read, so the three places that
judge a run (the runtime's end, the app's debrief, the playtest harness) cannot disagree.

### 5.2 Where it is stored

A new ledger key, **`campaign.challenge_results`**: `Record<missionId, { id, roe, ticks, lost }>`, best-of per mission
(`betterResult`'s order: faster, then higher Conduct). It lives in the **campaign ledger**, so "New campaign" clears it
and a replay earns it again, which is the replay value. The runtime's outgoing ledger is filtered to each mission's
`ledger.produces`, so the **app** writes this key in the victory handler it already has (`settleVictory`'s all-or-none
write), not the sim, and `packages/economy/src/ledger-shape.ts` gains one `RULES` entry. Unknown keys already pass through
that sanitiser, so an older build reading a newer save loses nothing. **To verify before build:** the Worker's
`account/claim` and `invariants` tests must learn the key (I did not read the claim path), and the save slots
(`lions.saves`) snapshot the ledger whole and need nothing.

### 5.3 How it is shown

All three are in the mock.

1. **Deploy screen, below the briefing:** the offered amendments as toggles, each with its effect in numbers
   (*12:00 → 9:00*), the challenge named under them, and the line *"Credits for the win are worked out exactly as without
   amendments. The challenge pays no credits and no coins."*
2. **After-action ladder** (`ui/after-action.ts`): a fourth rung after the three stars, `◆ Quiet Souk · 0 lost, 7:42 of
   9:00`, met or not, drawn only when the player played amended. `LadderRung`'s `stars: 1 | 2 | 3` is untouched: the rung is
   a new variant, not a fourth star value.
3. **Campaign board** (`ui/worldmap.ts`): the town line gains `1/4◆` beside `9/12★`, and a mission card lists what is left:
   the star rungs and the challenge, struck through once done. This is the issue's "what is left to earn".

**Colour.** The diamond is a cool silver (a proposed `--challenge`, mapped to `gunmetal.0` in `theme.css`), chosen so that a
mark of skill never reads as money: credits are the dust gold (`--commend`) and coins the terracotta (`--roar`).

## 6. Credits, coins, and never pay-to-win

| thing | rule | why |
|---|---|---|
| **Credits** | an amended win is paid by `creditsFor`, **unchanged**; the challenge pays **0** | `creditsFor` reads the win, the carrying secondaries, the units home, and Conduct over the floor. Under A2 every input is no higher with an amendment on, so an amendment cannot pay more than the same mission without it. No farm: a harder run never pays more |
| **Scope** | the challenge is recorded only for a mission **open at boot** in this campaign | the same guard `payScope` uses: a locked mission played by address records nothing, so "New campaign" plus `/mission/<id>` cannot farm a mark |
| **Coins** | the challenge pays **0** | the table (`roar-earn.ts`) pays 10 for a first win and 5 per new star against a pinned lifetime cap of 830 (G-E2). A challenge coin would break the pin and add a farm with a lifetime scope. Recommended default: none |
| **Stars** | an amended win **grades normally** into stars 1 to 3 and best-of | amendments are restrictions (A1), so a win under them is no easier than a plain one |
| **`starsEarned`** | **the challenge key is never read by it** | the three star-locked units must stay earnable on the plain campaign. Check C8 pins this |
| **Selling** | nothing here is for sale, and no amendment or skip is purchasable | the ST8 guard, "cosmetics horizontal": coins buy no power, and neither does a diamond |
| **Reward** | none in this feature. A later, separate decision: an **earned-only** crest from the cosmetics shelf (GH-1416), never sold | keeps the first build to the mark itself |

## 7. What needs engine work, and what does not

| amendment | needs | note |
|---|---|---|
| everything in §2's table | **nothing in `@lions/sim`**: `@lions/data` (the applier and two schemas), the app (deploy toggles, ladder rung, board, one ledger write), `@lions/economy` (one shape rule) | the work is app and data |
| **Veteran enemy** | a placement `veterancy` field: `spawnPlacement` passes a veterancy only for a drawn player, so an enemy's is always 0 | a small `mission.ts` and schema change, `sim-guard`'s. Not in the first build |
| **Enemy hits harder or has more hp** | a tuning change | **refused**: sim balance is parked, and a per-run multiplier on `tuning.ts` is a determinism hazard |
| **Short sight, fog** | sim | not in scope |
| **Ironman, no restart** | app (the save path) | a possible later amendment; interacts with the mid-mission save design (PR 1443) |
| **A seeded twist per run** | a seed policy for the run | not in scope; a hidden random modifier is also not a decision the player makes |

## 8. Falsifiable checks

Per CLAUDE.md, a gate arrives with its falsification. **I have run none of these**: each row is a check the implementer
writes, with the one-line mutation of the implementation that must turn it red. Three need care, because the casebook
names the shapes: C3's bound must be computed from `creditsFor`'s **weights**, not a number the check recomputes itself;
C8 must assert a **golden** `starsEarned` recorded on `main` first; C6's passive probe must be a plan that **cannot
win**, or "the challenge is harder" holds vacuously.

| # | check | mutation that must turn it red |
|---|---|---|
| C1 | `applyAmendments(m, [], cat)` returns `m` itself (same reference), for all shipped missions | make an op apply when the list is empty |
| C2 | every op in the catalogue is in the closed set, and a path outside the allowlist is refused | add an op `set_objective_type` |
| C3 | **credit bound:** for every shipped mission and every subset of its offers, the credit inputs (`fielded`, carrying count, `fail_below`) are no better than the unamended ones, so the bound `100 + 40·carry + 10·fielded` is no higher | add `inf_squad` to `starting_force` in an op; or mark an added secondary `carries: true` |
| C4 | every (mission, amendment set) builds a `MissionRuntime` without throwing (spawn-clear, unknown group, unknown marker) | place an `add_garrison` body on a wall |
| C5 | every modified mission passes `mission.schema.json` and `validate_objectives`, `validate_time_limit` | `scale_time_limit` 1/2 |
| C6 | **never easier:** over 30 seeds the sensible plan's win rate with each amendment on is no higher than without; a **passive plan loses** the challenge | an amendment that adds `logistics_start` |
| C7 | the predicate equals a hand computation on the stored row: `lost_at_most 0` is met by `lost = 0` and not by `lost = 1`; `ticks_at_most_target` at the boundary tick | `<` for `<=`; off-by-one on `target_minutes × 1200` |
| C8 | **independence:** `starsEarned` of a ledger with and without the challenge key is the same literal; `roarEarn` pays 0 for a challenge win; `creditsFor` is called with the same inputs | have `starsEarned` sum the key; add an `EARN` row |
| C9 | the ledger key round-trips through `sanitiseLedger`, the save slots and the account claim; a wrong shape is dropped, an older build keeps the rest | remove the `RULES` entry |
| C10 | determinism: the unamended golden hashes in `determinism.test.ts` **do not move**; two runs of one amended mission give one hash | have the applier read the clock or a random |
| C11 | **no farm:** a victory in a mission not open at boot records no challenge; "New campaign" clears the key | drop the open-at-boot guard |
| C12 | the deploy toggles, the rung and the board line go through `t()` (an unbracketed word in a `?pseudo=1` capture is a bug); `validate:ui` stays clean; the diamond token is in `theme.css` only | a literal string in the rung |

**The playtest witness** (the issue's second criterion). `playtest-run.ts` applies `applyAmendments` where it applies
`applyUpgrades`, and each challenge ships a plan: the mission's existing sensible plan plus the deltas the amendments
force (fewer units, a shorter clock). It must win the challenge on the 30-seed ladder with the house margin (120 s and 20%
to `time_limit_s`; for Tight clock, to the *scaled* limit, which is exactly why it is bounded by the floor), and the
passive plan must lose it. `pnpm playtest` fails if a challenge has no winning plan.

## 9. Rollout

1. **The pilot, six missions, one per phase** (breach, recon, foothold, buildup, clearance, subterranean), with the six
   generic amendments and one named challenge each. The generic library makes mission 7 onward cheap; the six prove the
   pipeline and the playtest cost.
2. **Order inside the pilot:** schema and applier with C1 to C5 and C10 first (no UI); then the playtest plans and C6/C7;
   then the ledger key, C8, C9, C11; then the three UI surfaces and C12.
3. **Docs:** `docs/campaign/README.md` gains the amendments and challenge in the objective and ledger tables.
4. **Telemetry:** amendment ids on the `mission/start` event, so a tester session can say whether a replay felt different
   (the issue's Session 3 question). A field on an event the Worker already clamps; opt out as always.

## 10. Open decisions for the lead, each with a recommended default

| # | decision | recommended default | alternative |
|---|---|---|---|
| **D1** | name and glyph | **"Challenge", a silver ◆**, separate from the stars | a fourth ★ (rejected in §1) |
| **D2** | does it count in `starsEarned` (unit gates) | **No** | yes, which makes a replay the route to units |
| **D3** | does it pay credits | **No** (C3 bounds the amended win's credits instead) | a flat first-time bonus, which needs the `payMission` improvement rule extended and is a farm risk |
| **D4** | does it pay coins | **No**, keeping the G-E2 pin of 830 | 5 coins the first time, which moves `MAX_STARS` and the pin |
| **D5** | where it is stored | **The campaign ledger**, cleared by "New campaign", recorded only for a mission open at boot | the lifetime wallet, which then needs the §6 scope guard to be airtight |
| **D6** | what an amended win does to stars | **Grades normally** (A1 makes it no easier) | amended runs record no stars, which costs the player a legitimate record |
| **D7** | which amendments a challenge needs | **Its named set must be on; extras allowed** | exactly the named set |
| **D8** | how many amendments per mission | **Three offered** (the issue asks at least two), picked from the six generic ones, plus the per-mission `own` where it earns its place | two fixed |
| **D9** | the pilot | **Six missions**, then the rest by phase | all 29 at once |
| **D10** | a save or a replay of an amended run | **It stores the amendment ids** (a mid-mission save, PR 1443, and a recorded replay both need them, or they reload the plain mission) | refuse to save an amended run |
| **D11** | the in-fiction word | **"Amendments to the orders"** (brigade paperwork, matching "Entered in the log" and "Named in brigade orders") | "modifiers", "mutators" |
| **D12** | an earned reward | **None in this feature**; a later earned-only crest from the cosmetics shelf (GH-1416) | a unit skin, which is power-adjacent and so needs the ST8 test |

## 11. What this document does not claim

- **No number here is measured.** The weights in §6 are `CREDIT_WEIGHTS` as read; the pins are `roar-earn.ts`'s own
  comments. The checks in §8 have not been run.
- **The Worker's account claim path was not read**, so §5.2's last sentence is a to-verify.
- **The mock is illustrative:** the mission, the numbers and the names are placeholders, and the screenshot's fonts are
  the browser's fallbacks, not the game's.
