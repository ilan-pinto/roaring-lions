# Three campaign difficulty settings, as mission data (GH-1394) — design for the lead

**Date:** 2026-11-15 · **Status:** a proposal for the lead to approve before any build. Docs only: no code, no data, no
sim change, no tuning change. A mock is beside it: `2026-11-15-difficulty-settings-mock.html` and its screenshot
`2026-11-15-difficulty-settings-mock.png`.
**Issue:** GH-1394, "Add three campaign difficulty settings" (audit dimension D5, now 64, target 80; D9's first-timer
findings will need an easier entry).
**Done means (from the issue, in full):**
- three settings, expressed as data (force size, time-limit margin, wave strength in the mission overlay), chosen per
  campaign and changeable between missions;
- `pnpm playtest` proves every mission winnable at each setting, and the `passive` plan loses at each;
- brigade credits and grades state how the setting affects them.

**Constraints (from the issue):** no tuning constant in `packages/sim/src/tuning.ts` changes; a setting is mission data; a
dev flag must never change how a real mission scores; design first.
**Builds on:** the GH-1395 design (PR 1459, `2026-11-15-challenge-star-design.md`, **not yet merged**). That design's
overlay mechanism (`applyAmendments`, a pure function in `@lions/data` run before the runtime, with a closed set of
operations that only ever restrict) is the pipeline this one uses. The two share **one applier, one catalogue schema and
one set of checks**; §4 says how they compose.

**What I read to write this** (this session, `main` at `d28f286c0`): `data/missions/*.json` (a census of all 30),
`packages/sim/src/grade.ts`, `credits.ts`, `unlock.ts`, `mission.ts` (`spawnPlacement`, the wave and trigger passes,
`checkEnd`, `startingIds`), `packages/app/src/campaign-pay.ts`, `roar-earn.ts`, `packages/economy/src/ledger-shape.ts`,
`tools/validate_time_limit.mjs`, `data/campaign/world.json`, and the GH-1395 design. **Nothing was run and nothing was
built.** Every number is a census count or a line read from those files; every check in §9 is a proposal whose mutation the
implementer runs.

---

## 0. The one-paragraph answer

Three **postures**, **Easier**, **Standard** and **Harder**, each a short list of the same closed overlay operations the
GH-1395 amendments use, applied to the mission JSON before the runtime is built. **Standard is the identity: the mission as
written, byte for byte.** Easier gives a fifth more time, thins and delays the enemy's waves, brings one rifle squad and one
medic squad in at 1:30, **and removes the third star, the carried-secondary pay and the challenge diamond**, so an easier
posture can never pay more. Harder thickens and advances the waves and **pays exactly what Standard pays**. A posture
**never touches Conduct, the second star or the rules of engagement**: restraint is the game's thesis, and a setting that
loosened it would be selling it. The choice is one ledger key, `campaign.difficulty`, set when the campaign starts and
changeable between missions on the campaign board; the sim never learns a posture exists.

## 1. Four findings the census forced

These change the shape of the design, so they come first.

| # | finding | evidence | what it changes |
|---|---|---|---|
| **F-1** | **Every shipped mission's `time_limit_s` is exactly twice its `target_minutes`: 30 of 30.** That is the floor in `validate_time_limit.mjs` (`LIMIT_PER_TARGET_MINUTE_S` 120) | census of `data/missions/*.json`: limit over target, minimum 2.0, maximum 2.0 | **No overlay can shorten a limit and still validate.** Harder cannot tighten the clock. **This also breaks my GH-1395 design**: its *Tight clock* (limit × 3/4) is below the floor on every mission and would fail its own check C5. See §4.3 and §10 |
| **F-2** | **The limit is a backstop; the real clocks are the primary objectives' own `seconds`** (`evacuate_before`, `raze`, `collapse`, `hold_for`) | `stepObjectivePass`; `checkEnd`'s `timedOut` is the loss of last resort, named `withdrawn` | the issue's "time-limit margin" lever eases only the `withdrawn` loss. **A posture must not scale a primary's `seconds`**: the objective text states it ("Hold the gate for four minutes"), so the text would lie |
| **F-3** | **Waves exist in 26 of 30 missions** (2 to 27 bodies each); **the four without are** `beit_sahwan_0_tutorial`, `beit_sahwan_1_recon`, `wadi_halam_2_laager`, `wadi_halam_4_village`. **Three missions carry tagged wave units** (`wadi_halam_3_counterraid`, `ein_qasab_2_foothold`, `umm_zeitoun_2_buildup`). **No wave is objective-keyed.** The earliest wave is at 18 s | census | a wave lever is real on 26 missions and a no-op on 4; scaling must skip a tagged unit (an `eliminate_hvt` target must not change count); a `-15 s` shift is safe (18 s minimum) |
| **F-4** | **Credits and stars are what a setting could "pay".** `creditsFor` is win 100, a carried secondary 40, 10 per starting unit home, and Conduct over the star-2 floor; `starsEarned` sums stars and gates three units (12, 30 and 44 stars); the coin table pays 5 a star under a pinned 830 | `credits.ts`, `unlock.ts`, `roar-earn.ts`, `data/units/kdf/*.json` `stars_min` | an easier setting that adds **starting** units pays more (`unitHome`), and one that loosens the Conduct floor pays more. Hence the rules in §5 |

## 2. What a posture does, lever by lever

Every operation is from the closed set (§3.2). **No lever touches `tuning.ts`, a hit-point or accuracy multiplier, a
primary's `seconds`, Conduct, `fail_below`, a ceiling, an objective's id, type or target, or any `tag`.**

| lever | field | Easier | Standard | Harder | what it does to a mission |
|---|---|---|---|---|---|
| **the backstop** | `time_limit_s` | × 5/4 (ceil) | as written | as written | only the `withdrawn` loss moves (F-2). Harder cannot shorten it (F-1) |
| **wave strength** | `enemy.waves[].units[].count` | × 3/4, ceil, minimum 1 | as written | × 5/4, ceil | on 26 missions; **a tagged unit is never scaled** (F-3) |
| **wave timing** | `enemy.waves[].at_seconds` | + 30 | as written | − 15, minimum 0 | the earliest wave is at 18 s, so −15 is safe |
| **relief** | a `reinforce` trigger at `timer_s` 90 | one `inf_squad` and one `inf_medic_squad` at `map.player_start` | none | none | the issue's "force size". **Credit-neutral by an existing rule** (§5.1) |
| **the grade** | `objectives[].carries` | cleared on every secondary (the third star becomes unreachable, F-4) | as written | as written | 10 of 30 missions have a carrying secondary |

**What Harder leaves alone, on purpose.** It does not shrink the player's force (that is the GH-1395 amendment *Light
order*), tighten Conduct (*Clean hands*), or shorten the clock (impossible, F-1). One lever, the waves, is the whole of
Harder, so that a player who wants more can stack amendments on top and the two never fight over a field.

**What Harder does on the four no-wave missions: nothing.** On those four, Harder equals Standard. That is stated, pinned
by a check (S12) and shown in the picker's blurb ("some missions have nothing for it to push"), not hidden.

**Why the relief arrives by `reinforce`, not in `starting_force`.** `creditsFor` reads `startingCount`, the starting
force alone. `mission.ts` snapshots it once (`startingIds = [...playerIds]`) and its end-of-mission comment says "a
reinforced body was never in `startingIds`". A unit that arrives by `reinforce` after the snapshot therefore moves no credit
(the same R4 ruling that keeps production out of the payout). A squad added to `starting_force` would raise `unitHome` by
10 a body: easier paying more. **`spawnPlacement` with no position falls back to `map.player_start`**, which all 30 missions
declare, and whose first tile is open ground on every map (16 `.` and 14 road; census). It runs `assertGroundClear`, so the
spread bodies must also be clear: check S7 builds every mission with the overlay.

## 3. The data

### 3.1 One catalogue, shared with the amendments

`data/difficulty/settings.json` (schema `settings.schema.json`) uses **the same operation vocabulary as
`data/challenges/amendments.json`** (GH-1395 §3.1). A setting is an id and an op list:

```json
{ "id": "easier", "label_key": "difficulty.easier.label", "blurb_key": "difficulty.easier.blurb",
  "ops": [
    { "op": "scale_time_limit", "num": 5, "den": 4 },
    { "op": "scale_waves", "num": 3, "den": 4, "skip_tagged": true },
    { "op": "shift_waves", "seconds": 30 },
    { "op": "reinforce_player", "at_seconds": 90, "units": [
        { "unit": "inf_squad", "count": 1 }, { "unit": "inf_medic_squad", "count": 1 } ] },
    { "op": "uncarry" } ] }
{ "id": "standard", "label_key": "difficulty.standard.label", "blurb_key": "difficulty.standard.blurb", "ops": [] }
{ "id": "harder", "label_key": "difficulty.harder.label", "blurb_key": "difficulty.harder.blurb",
  "ops": [
    { "op": "scale_waves", "num": 5, "den": 4, "skip_tagged": true },
    { "op": "shift_waves", "seconds": -15 } ] }
```

Integers and keys only: no float, no text (labels and blurbs are `en.json` keys, like every chrome string). The operations
new to the shared catalogue are `scale_waves`, `shift_waves`, `reinforce_player` and `uncarry`; `scale_time_limit` is
GH-1395's. Each is a **restriction or a neutral** on the player's side except where the table says, and each is closed:
there is no "set any path".

### 3.2 The applier is one function

`applyOverlays(mission, { setting, amendments }, catalogue)` in `@lions/data`, beside `applyUpgrades`: pure and
deterministic (no clock, no RNG), called from the same three places `applyUpgrades` is (the app before the runtime, the
playtest harness, the backtest). **`@lions/sim` imports nothing new, and the sim never learns a posture exists.** With
`standard` and no amendments it returns the mission itself, by reference (the gate for check S1).

## 4. How a posture and a challenge amendment compose

### 4.1 Order

```
mission_final = applyAmendments( applySetting( mission_authored, setting ), amendments )
```

**The posture first, the amendments after.** The posture defines the ground the player is playing; an amendment is an
extra restriction on top of it. Both are the same function over the same catalogue, so the order is fixed in one place
(`applyOverlays`), not at each call site.

### 4.2 Conflicts

| field | touched by | rule |
|---|---|---|
| `time_limit_s` | Easier (× 5/4) and the amendment *Tight clock* | commute up to rounding; fixed order; **the result must still pass `timeLimitFailures`** (§4.3) |
| `enemy.waves` | Easier, Harder, and a per-mission amendment `add_wave` | the posture scales what the author wrote; an amendment-added wave is scaled **by the posture only if the posture runs after**, and it does not (amendments run last), so an added wave is never thinned by Easier. Stated, and pinned by S13 |
| `objectives[].carries` | Easier (`uncarry`) | nothing in the amendments touches it |
| `starting_force` | the amendment *Light order*, *Fresh crews* | the posture never touches it |
| `reinforce` triggers | Easier | the amendments add none |

**Which wins on a true conflict: the amendment, because it runs last and is a pure restriction.** There is no field both
may *raise*.

### 4.3 The clock floor, and a correction to GH-1395

F-1: all 30 missions sit exactly on the floor. For a posture this costs nothing (Easier only lengthens). For GH-1395 it is
a defect: *Tight clock* (limit × 3/4) is below the floor everywhere, and composed with Easier (× 5/4 × 3/4 = 15/16) it is
still below it. **The floor exists for two reasons**: a *sizing* rule (2 × the target) and a *clearance* rule (60 s past every
primary's deadline, so "a mission that is losing on its own clock loses on that clock"). Only the clearance rule is
load-bearing. Recommended: **for an overlaid mission the validator applies the clearance rule and a floor of 1 × the
target, not 2 ×**, and *Tight clock* scales to no lower than that. This is **open decision D6**; the GH-1395 design needs
a matching correction (§10).

## 5. What a posture does to credits, stars, coins and the diamond

| thing | Easier | Standard | Harder | why |
|---|---|---|---|---|
| **Credits** | **at most Standard**: no 40 per carried secondary; otherwise the same | as written | **exactly Standard** | §5.1 |
| **Stars** | **at most ★★** (no third star) | as written | as written | `starsFor` gives a third star only if a secondary has `carries: true`; `uncarry` clears them, so the cap is **data**, not a new rule |
| **`starsEarned`** (the unit gates) | counts the capped stars | as written | as written | Easier reaches at most 2 × 29 = 58 stars, above the highest gate (44), so a unit stays earnable on Easier but never faster than on Standard |
| **Coins** | **at most Standard** (≤ 10 + 5 × 2 a mission) | as written | **exactly Standard** | `roarEarn` pays by the run's stars; the pinned cap of 830 (G-E2) is a Standard ladder and cannot rise |
| **Challenge diamond** (GH-1395) | **not recorded** | recorded | recorded | an easier posture must not be the easy road to a mark of skill |
| **Conduct, the second star, a ceiling** | unchanged | as written | unchanged | restraint is not for sale |

### 5.1 Why Easier pays no more, shown and not asserted

`creditsFor` is `100 + 40 × carrying + 10 × (fielded − lost) + max(0, roe − floor)`.

- **`fielded`** is `startingCount`. Easier adds **no** starting unit: its relief arrives by `reinforce`, after the snapshot.
- **carrying** is the count of `carries: true` secondaries completed. `uncarry` makes it 0: Easier pays 40 less per carrying
  secondary, on 10 of 30 missions.
- **`floor`** is `fail_below + 20`, which no posture touches.

Each input is no better than Standard's, so the sum is no higher: a **bound over `creditsFor`'s inputs**, the same one
GH-1395's check C3 uses (S3 here). **Harder** changes none of the four, so it is equal (S4). The statement on screen says
exactly this (§7).

### 5.2 Why the diamond and the star cap are not a punishment

Both come straight from "an easier setting must not pay more". The diamond is the mark of skill, and the third star is the
mark of completeness; an easier posture can still finish the mission, earn ★★, and keep every credit except the carry pay.
The cap is the smallest rule that holds the line, and it is **data**.

## 6. Storage, and "changeable between missions"

- **One campaign-ledger key, `campaign.difficulty`**: the string `easier`, `standard` or `harder`. Absent, an unknown string
  and a wrong type all read as `standard` (an old save has no key), through one `RULES` entry in
  `packages/economy/src/ledger-shape.ts`. Unknown keys already pass through that sanitiser, so an older build reading a
  newer save loses nothing.
- **Chosen per campaign.** It lives in the **campaign ledger**, so "New campaign" resets it to `standard` and the picker
  runs again; the three save slots (`lions.saves`) snapshot the ledger whole and need nothing.
- **Changeable between missions, never inside one.** The board's chip and the deploy line are the only writers; the
  overlay is part of the mission JSON the runtime was built from, so a change applies **from the next deploy**. A mid-mission
  save (PR 1443) stores the posture the run started under, as GH-1395's D10 does for amendments.
- **No dev flag changes a score.** The setting is read **from the ledger only**. A `?difficulty=` query is a sandbox and
  free-play flag (where nothing is recorded); a campaign mission never reads it (check S11). Versus rooms never apply a posture: a
  lockstep room is not a campaign.
- **The tutorial is untouched**: `beit_sahwan_0_tutorial` has no waves, pays nothing and has no carries, so every posture is
  the identity there.
- **No per-result field.** The star cap is intrinsic to the overlaid mission, so a stored best does not need to say what posture earned
  it; the diamond key is written by the app only when the run's posture was not Easier.

## 7. Showing it (the mock)

1. **New campaign, after the name:** the three rows, each with a *Mission* line and a *Grade and pay* line (the issue's
   "credits and grades state how the setting affects them"), and one line under them: *Credits are never sold, and no posture
   pays more than Standard.*
2. **Campaign board, header chip** `Posture: Standard ▾`, opening the same three rows with *Applies from the next deploy*;
   **deploy screen**, one line under the briefing: `Posture: Standard · as written. Change`.
3. **After-action report, one statement**: on Easier, *Easier: credits +150 (Standard would pay 190: carried secondaries are
   not paid on Easier). Challenge diamond: not recorded on Easier.* and the ladder's third rung reads *not awarded on Easier*.
   Harder reads *Harder: the same marks and credits as Standard.*

Not in `settings.ts` (`lions.settings` is device-wide and one reader and writer owns it): a posture is per campaign.
Colour uses existing tokens (the mock proposes none). Every string goes through `t()`.

## 8. How `pnpm playtest` proves it

`playtest-run.ts` applies `applyOverlays` where it applies `applyUpgrades`, and the ladder runs each mission at the three
postures.

1. **Winnable at each.** The mission's existing sensible plan wins on the 30-seed ladder **at Standard (as today) and at
   Easier**; at Harder it must also win, with the same 120 s and 20% margin to `time_limit_s`. **Expected cost:** Harder's
   heavier waves on 26 missions may need plan deltas on some, which the first run measures.
2. **Passive loses at each.** `passiveAcrossSeeds` runs per posture. Easier's relief and thinner waves are exactly what could
   let a plan that does nothing survive, so this is the check most likely to go red first, and it is why Easier's numbers
   are bounded.
3. **Monotone.** Over the 30 seeds the sensible plan's win rate at Easier is no lower than at Standard, and Standard's no
   lower than Harder's (S9): a posture that points the wrong way is a defect.
4. **The clock validator at each.** `timeLimitFailures(overlaid mission)` is empty for every (mission, posture) and every
   (mission, posture, amendment subset) (S8), under the D6 rule once ruled.
5. **Cost.** Three ladders is three times the run. Recommended: **Standard stays the full 30 seeds in CI, as now; Easier and
   Harder run 30 seeds in the nightly and 8 in CI**, so a regression shows in the PR and a margin shows overnight. The
   implementer measures the actual wall time before fixing the split.

## 9. Falsifiable checks

Per CLAUDE.md a gate arrives with its falsification. **I have run none of these**: each row is a check the implementer
writes, with the one-line mutation of the implementation that must turn it red. The casebook shapes to avoid: S3's bound
must come from `creditsFor`'s **weights**, not a number the check recomputes; S12's list of no-op pairs must be
**literals recorded on `main` first**; S10's passive probe must be a plan that **cannot win** by construction.

| # | check | mutation that must turn it red |
|---|---|---|
| S1 | `applyOverlays(m, {setting:'standard'}, cat)` returns `m` itself, for all 30 missions | give Standard an op |
| S2 | every op in `settings.json` is in the shared closed set; no op names `tuning`, a `seconds` on an objective, `fail_below`, a ceiling, an objective's id or type, or a tag | add an op `set_fail_below` |
| S3 | **credit bound:** for every mission, Easier's credit inputs (`fielded`, carrying count, floor) are no better than Standard's | have Easier put the squad in `starting_force`; or lower `fail_below` |
| S4 | **Harder's credit inputs equal Standard's** | have Harder `uncarry` |
| S5 | under Easier no objective is `carries: true`, and `starsFor` on an all-complete, high-Conduct win returns 2, never 3 | drop `uncarry` from Easier |
| S6 | an Easier win records no challenge key; `roarEarn` for an Easier run is no more than Standard's for the same objectives | drop the posture guard on the diamond |
| S7 | every (mission, Easier) builds a `MissionRuntime` and runs past 95 s without throwing (the relief's spawn-clear at `player_start`) | set the relief at a blocked tile |
| S8 | `timeLimitFailures` is empty for every (mission, posture) and (mission, posture, amendments) | Easier × 3/4 |
| S9 | **monotone:** Easier win rate ≥ Standard ≥ Harder over 30 seeds on the sensible plan | have Harder thin the waves |
| S10 | **passive loses at each posture, every mission** | give Easier a third squad |
| S11 | the key round-trips `sanitiseLedger`, saves and the account claim; absent or unknown reads `standard`; **`?difficulty=easier` on a campaign mission changes no score** | read the query in the campaign path; default the key to `easier` |
| S12 | the (mission, posture) pairs where the overlay is the identity equal the literal list: `{Harder: the four no-wave missions}`, and Standard everywhere | make `scale_waves` skip every mission |
| S13 | composition: `applyOverlays` equals `applyAmendments(applySetting(m))`; an amendment-added wave is **not** thinned by Easier; no tagged unit's `count` changes under any posture | apply the posture last; scale a tagged unit |
| S14 | the determinism goldens in `determinism.test.ts` **do not move**; two runs of one overlaid mission give one hash | have the applier read the clock |
| S15 | the picker, chip, deploy line and statement go through `t()` (an unbracketed word in `?pseudo=1` is a bug); `validate:ui` clean | a literal string in the chip |

## 10. Engine and schema gaps

| gap | smallest proposal | owner | blocks |
|---|---|---|---|
| **None in `@lions/sim`** | the work is `@lions/data` (the applier, two schemas), the app (picker, chip, deploy line, statement, one ledger write), `@lions/economy` (one shape rule), `tools/` (the ladder) | — | — |
| the clock floor (F-1, §4.3) | the validator applies the clearance rule and a 1 × target floor to an overlaid mission (D6) | `balance-analyst` (the house rule's owner) with `mission-author` | GH-1395's *Tight clock* |
| **a correction to GH-1395** | its lever table, §3.1 example and check C5 name a ×3/4 limit that no shipped mission can pass; follow-up commit on PR 1459's branch, or the lead reads D6 first | `campaign-designer` | PR 1459 |
| `player_start` for the relief | S7 proves each mission; a mission whose spread bodies are blocked gets an authored `at` | `mission-author` | — |
| a lever for the four no-wave missions | none: scaling garrisons moves the `casualties_pct` denominators, tags and buried stock. Harder is the identity there | — | — |
| enemy veterancy, hit points, accuracy | **out**: a placement `veterancy` field is a sim change and a multiplier is a tuning change (balance is parked) | `sim-guard` | — |

## 11. Open decisions for the lead, each with a recommended default

| # | decision | recommended default | alternative |
|---|---|---|---|
| **D1** | the names | **Easier / Standard / Harder**, under a heading *Posture* (brigade paperwork; not *Veteran*, which is a unit's veterancy) | Recruit, Regular, Veteran |
| **D2** | the default posture | **Standard**, for a new campaign and for any save with no key | ask on first launch |
| **D3** | does Easier cap the stars at ★★ | **Yes**, by clearing `carries` (data) | no cap, which makes Easier the cheaper road to the star-gated units |
| **D4** | does Easier pay carried-secondary credits | **No** (the bound in §5.1) | yes, which needs the credit input read against the unmodified mission |
| **D5** | does Harder pay more | **No: exactly Standard** | a flat bonus, which moves the credits balance (the balance analyst's, parked) |
| **D6** | the clock floor for an overlaid mission | **Clearance rule plus a floor of 1 × target** (§4.3) | keep 2 × target, which forbids any tighter amendment and so drops *Tight clock* |
| **D7** | the relief | **One `inf_squad` and one `inf_medic_squad` at 1:30** | a larger relief, or none (then Easier is a clock and waves only) |
| **D8** | the wave numbers | **Easier ×3/4 and +30 s; Harder ×5/4 and −15 s** | other ratios; these are placeholders until the first ladder runs |
| **D9** | the diamond on Easier | **Not recorded** | recorded, and rated down |
| **D10** | where to change it | **The board's chip and the deploy line; not `/settings`** | the pause menu (rejected: a mid-mission change cannot apply) |
| **D11** | a nudge after a defeat | **One line on the defeat screen: *Try Easier from the next deploy*, never automatic** | none |
| **D12** | the tutorial | **Untouched** (it is the identity) | n/a |
| **D13** | playtest cost | **Standard 30 seeds in CI; Easier and Harder 8 in CI and 30 in the nightly** | all three at 30 in CI |

## 12. What this document does not claim

- **No number is measured.** The ratios in §2 are placeholders pending the first ladder; the census counts are exact, the
  credit arithmetic is `creditsFor` as read, and the S-checks have not been run.
- **The Worker's account claim path was not read**; S11's last clause is a to-verify, as in GH-1395.
- **The relief's spread bodies at `player_start` were not checked on any map**, only the first tile of each (all open).
  S7 is what proves it.
- **The mock is illustrative:** names, numbers and the +150/190 credit figures are placeholders; the screenshot's fonts are
  the browser's fallbacks.
