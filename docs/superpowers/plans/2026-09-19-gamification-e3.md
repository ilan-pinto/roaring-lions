# Gamification E3 — "content fixes: recon ★★★, `captured`, Beit Sahwan III" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three content holes Phase A left open. Five recon plans that cap at ★★ reach ★★★, so the third star is a thing a player can actually earn on a recon mission and not only on `qarn_hadid_1_recon`. Beit Sahwan III's `picture` becomes a carrying secondary — which means Beit Sahwan IV's plan has to survive the intel III would then hand it, so IV is hardened first. And the `captured` villain state stops being dead text: the board says Nadir Sahim was taken at the shaft head, because the mission that took him is the one the design says ends him.

**Architecture:** This package is **content and one app function**. Six of the seven touched files are `data/` or `tools/src/backtest/playtest.ts`; the seventh is `packages/app/src/campaign.ts`, allowed by ruling R-1 and recorded there as a boundary exception. **Nothing under `packages/sim/` is touched by any task**, so the combat model, the golden determinism hash and `pnpm balance` are all out of the blast radius by construction — and each commit proves it with `git diff --stat -- packages/sim` coming back empty rather than by assertion. The work is measured, never argued: `pnpm playtest` is the instrument, it runs in **~5 s** with no browser, no GPU and no Blender, it is wired into CI's `gates` job (`c05de3c`), and it is both the test and the pin.

**Tech stack:** TypeScript strict (the harness and `campaign.ts`), vitest (`campaign.test.ts` only), JSON + JSON Schema (`data/missions`, `data/campaign`, `data/schemas`). No new dependencies, no new tooling, no dev server.

**Spec:** GitHub issue **#175** (WP-G-E3), and the gamification page's **Phase E · Close the loop** bullet it comes from:

> Content fixes from Phase A. Re-flag Beit Sahwan III once IV's plan is fixed; give the five capped recon plans a reachable ★★★; make `captured` reachable with one `capture` primary on a region-final mission, or cut the three lines.

The definitions this plan works to, from the same page (M1, and the tracking table's `carries: true` row):

- **★** victory. **★★** victory and Conduct ≥ the mission's own `fail_below` + 20, or 70 where none is declared. **★★★** ★★ and every `carries: true` secondary complete. A mission with **no** carrying secondary has a hard ★★ ceiling — `starsFor` returns 2 outright (`packages/sim/src/grade.ts:40-41`).
- **A carrying secondary** is "a secondary whose result a later mission reads" (`mission.schema.json`'s own `carries` description). It is **never** on a primary, and it is schema-described but **not** schema-enforced: nothing in `tools/validate_data.mjs` ties `carries: true` to a `ledger.produces` key, so a flag can be set on a secondary nothing downstream reads. That would be a claim with nothing behind it, and III is the mission where the claim has to be made true before the flag goes on. This is the whole reason for the IV-before-III order.
- **The `captured` villain state** is one of three lines per villain in `data/campaign/commander.json`, required by `commander.schema.json`, and chosen by `villainState` (`packages/app/src/campaign.ts:576-586`).

Related docs: `docs/campaign/README.md` (the pipeline contract — `mission-author` alone writes `data/missions/`, `playtest` alone says whether it is a mission), `docs/campaign/economy/prices.md`, `docs/campaign/special_units/design.md`, `docs/campaign/khan_rafid/design.md` (decision O-KR2).

---

## Baseline — measured this session, not quoted

`pnpm playtest`, run twice in this worktree on `feat/gamification-e3` at `origin/main`, 2026-09-19, **exit 0 both times**. Every number below is from the harness's own printed lines. Where the research brief and this run disagree, this run wins and the difference is called out.

**The pins as they stand:**

```
gate breach_team:   OPEN after mission 6 at 12 stars  / CLOSED after mission 5 at 10 stars
gate scout_shachaf: OPEN after mission 15 at 31 stars / CLOSED after mission 14 at 28 stars
gate apc_kipod:     OPEN after mission 22 at 45 stars / CLOSED after mission 21 at 43 stars
credit ladder: 5531 over 26 missions
max tier: 26 of 26 plain victories hold
```

**The seven missions this package touches, plain `label === id` winning runs:**

| mission | order | result | target_min | ratio | stars | the objective in the way | credits |
|---|---|---|---|---|---|---|---|
| `beit_sahwan_1_recon` | 2 | VICTORY 0.6 min, Conduct 100, roster out 19 | 7 | 0.09 | 2 | `hvt_seen=a` | 260 |
| `beit_sahwan_3_clearance` | 4 | VICTORY 1.1 min, Conduct 100, roster out 24 | 7 | 0.16 | 2 | none — `picture=c` but unflagged | 240 |
| `beit_sahwan_4_subterranean` | 5 | VICTORY 2.1 min, Conduct 98, roster out 25 | 6 | 0.35 | 2 | all five `c`; no carrying secondary at all | 188 |
| `khan_rafid_1_recon` | 6 | VICTORY 0.5 min, Conduct 100, roster out 5 | 6 | 0.08 | 2 | `find_the_west_lane=a` | 260 |
| `deir_amun_1_recon` | 9 | VICTORY 0.6 min, Conduct 100, roster out 5 | 6 | 0.10 | 2 | `find_the_chief=a` **and** `find_the_gap_gun=a` | 180 |
| `umm_zeitoun_1_recon` | 18 | VICTORY 2.6 min, Conduct 100, roster out 13 | 6 | 0.43 | 2 | `find_the_missile_team=a` | 200 |
| `umm_zeitoun_3_clearance` | 20 | VICTORY 2.0 min, Conduct 89, roster out 20 | 7 | 0.29 | 2 | `find_adhal=a` | 194 |

`qarn_hadid_1_recon` (order 15) already reads **stars 3** and is the shipped precedent for everything below, including the exact `run(...)` call shape that pins it.

**Three corrections to the research brief, measured:**

1. **There are 23 passive controls, not 26.** `beit_sahwan_1_recon`, `beit_sahwan_2_foothold` and `beit_sahwan_3_clearance` have none. They cannot have a `'defeat'` one — see ruling R-9.
2. **`beit_sahwan_4_subterranean`'s plain run leaves 25 units home, not 26.** 26 is the `(max tier)` replay's figure.
3. **`deir_amun_1_recon`'s max-tier replay already completes `find_the_chief`** (`find_the_chief=c find_the_gap_gun=a`) where the base run does not. One of the six target objectives already flips on unit tier alone, which is both a lever (it is reachable, not structurally blocked) and a hazard (ruling R-8).

---

## Global Constraints

Binding on every task.

- **`packages/sim` is untouched.** No task edits a file under `packages/sim/`. Every commit runs `/usr/bin/git diff --stat <base>..HEAD -- packages/sim` and it must come back **empty**. The golden determinism hash therefore cannot move; `pnpm test:determinism` is run once, in Task 6's gate line, as the evidence rather than the claim. `pnpm balance` is likewise out of scope — no tuning constant, no unit JSON stat and no map is touched by any task; run it only if a plan change is suspected of altering combat behaviour, and say so in the task report if you do.
- **Missions are declarative data.** A mission that needs a behaviour the schema cannot express means the schema is missing a concept (`CLAUDE.md`, "Adding content"). No task here adds an objective type, a trigger verb or an engine branch. Two JSON edits exist in this whole plan: `intel.marked_positions` into one `ledger.produces` array, and `carries: true` on one secondary.
- **`target_minutes` is 5–7 and the schema enforces it.** No task changes one. No task may reach a star by lengthening a mission: the harness's only duration failure is "did not finish inside 20 minutes", and CLAUDE.md records a mission degrading **7x** — 2.5 min to 17.2 min — with `pnpm playtest` still green at exit 0. Every task therefore records the printed minute figure before and after, per ruling R-11.
- **A scripted plan proves a mission WINNABLE. It does not measure how long a real player takes.** All five recon plans fly or drive straight to each marker holding perfect information. ★★★ in this harness means *reachable*, never that a player finds it. These seven missions all belong to CLAUDE.md's "the plan hardcodes the answer" population (ratios 0.08–0.43 above), **not** to the seven endure-clock missions' 0.70–1.00 band — so a low ratio here is not evidence of anything and must not be tuned against, before or after this package.
- **Never widen a gate or a threshold to clear a red run.** A red `GATES` line means a star moved (the gamification page's own "What not to do", and CLAUDE.md's standing rule). Re-pin deliberately, in the same commit as the change that moved it, and say why in the commit message — the convention `LADDER_CREDITS` already follows in its own comment block (`playtest.ts:2513-2529`).
- **Every pin comes from the harness's printed line, never from a document and never from arithmetic in this plan.** Section "The pins, predicted" below gives a prediction for each task. It is there so that a number far from it is a flag to investigate, not a value to copy. Set `GATES.opensAfter` and `LADDER_CREDITS` by reading `gate <unit>: OPEN/CLOSED after mission N at M stars` and `credit ladder: N over 26 missions` out of a fresh run.
- **Every check gets an input that makes it fail — constructed, and run** (CLAUDE.md). Each task names its falsification, runs it, sees the named line go red, restores, and says in the commit message that it was seen red.
- **`pnpm playtest` must exit 0 at every commit.** It is in CI's `gates` job on every push. A task that moves a star and does not re-pin in the same commit ships a red CI. This is the concrete, provable risk of this whole package: **the five recon plans alone break two of the three `GATES` assertions before III, IV or `captured` is touched at all.**
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest`. `typecheck` is not in CLAUDE.md's command list and is in CI — include it. Add `pnpm test:determinism` on Task 6. Nothing here needs `validate:assets`, `validate:meshes`, `validate:ui` or `validate:audio`.
- **Git hygiene:** commit with explicit pathspecs (`/usr/bin/git -C <worktree> add <paths>` then `commit -s -- <paths>`), **never `-A`** — other sessions share this checkout and one agent's `git add` lands in another's commit. Never `git checkout -- <file>`; undo the edit, not the file. Call `/usr/bin/git` by absolute path in a worktree. DCO `-s`, and a `Co-Authored-By:` trailer naming the model that actually did the work (the Phase 2 plan pinned `Claude Fable 5.1`; name whichever model runs the task).
- **Do not kill the dev server.** No task here needs one. `pkill -f vite` has taken down the lead's server four times in one session; nothing in this package goes near it.

---

## Rulings

Six are the controller's, binding, recorded verbatim in substance with the evidence this session found for each. Five more (R-7…R-11) were taken while planning.

### R-1 — `captured`: **option B**. `villainState`'s algorithm is wrong, and the defect is visible on screen today.

The issue offered two sanctioned resolutions — (A) a `capture` primary on a region-final mission, or (C) cut the three authored lines. The brief added (B): the algorithm in `campaign.ts` is wrong. **A is never taken**: it contradicts recorded design decisions for all three fronts. B is taken, because on reading `campaign.ts` the defect is real, and the fix is one function plus its spec plus the one declarative fact the function needs.

**The algorithm** (`campaign.ts:576-586`):

```
last = the region's chronologically LAST town's LAST mission, from world.json
if last is not completed -> 'at_large'
else -> 'captured' if last's objectives include a primary of type 'capture', else 'killed'
```

**The evidence it is wrong, in four measured pieces:**

1. `data/campaign/commander.json`'s Marj villain, **Nadir Sahim**, carries `captured`: *"Taken at the shaft head with his hands empty."* and `killed`: *"Killed at the shaft head."* Both name **the shaft head**.
2. The shaft head is `beit_sahwan_4_subterranean`'s objective `take_the_shaft_head`, **`type: "capture"`, `primary: true`**, on zone `shaft_head`, whose own text is *"Hold the shaft head until Sahim is out of it"* and whose `say` line is *"…Four years of digging and he is above ground."* The mission also carries `find_spade` — *"Find Nadir Sahim at the shaft head"*. That mission takes him alive, and it is mission **5** of 26.
3. `villainState` reads `deir_amun_3_subterranean` instead, because Khan Rafid and Deir Amun were added to Marj **after** Sahim's ending shipped. Its primaries are `all_four` (collapse) and `kill_the_chief` (`eliminate_hvt`, target `da_hvt_engineer` — a different character, "the digging chief"). Neither is a `capture`, so Sahim resolves `'killed'` forever.
4. `docs/campaign/khan_rafid/design.md` decision **O-KR2** asks exactly this question — *"Does Nadir Sahim's end move? He is captured at `beit_sahwan_4_subterranean` today, which is now mid-act"* — and answers ***"No — keep D-KR1's reading… ending the front on the ground is better than ending it on him twice."***

So the board does not merely fail to reach `captured`: it prints **"Killed at the shaft head"** about a man the player took alive at the shaft head, and strikes his name through under `data-state='killed'` (`theme.css:580-581`). That is a false statement on screen, not an unreachable enum.

For `sur` and `naharin` the algorithm is accidentally right — their villains' lines name *the crest* (`umm_zeitoun_4_clearance`, `kill_adhal`) and *the gate* (`wadi_halam_5_depot`, `kill_gate_rpg`), both region-final, both `eliminate_hvt` by explicit design commitment (`tel_marum/design.md:21`, `wadi_halam/design.md:24`). That is why the defect hid: it is wrong on exactly one of three fronts, and only since Khan Rafid and Deir Amun landed.

**Why no data-free algorithm is honest.** Every rule over primary types alone was checked against the shipped JSON and each one fails: "last mission with a `capture` or `eliminate_hvt` primary" gives Deir Amun III for Marj (wrong); "any completed `capture` primary anywhere in the region" gives `captured` for Marj **for the wrong reason** (`beit_sahwan_3_clearance`'s `take_town` is a town capture, not a man) and would flip Sur and Naharin to `captured` as well, against their own design docs. The villain's ending mission is a fact no primary type carries, so the function needs one pointer. Task 6 adds an **optional** `ends_at` to the villain block; absent, the function behaves exactly as today, so `sur` and `naharin` need no data at all and only `marj` gains one line.

**The boundary exception, recorded:** this ruling permits Task 6 to edit `packages/app/src/campaign.ts` and `packages/app/src/campaign.test.ts` — outside the WP's stated `data/missions` + `playtest.ts` boundary — plus the two one-argument call sites at `main.ts:3644` and `ui/worldmap.ts:285`, `data/schemas/commander.schema.json` and `data/campaign/commander.json`. Nothing else. No renderer, no sim, no other app module.

### R-2 — The star pins are re-pinned to **measured** numbers, in the same task that moves them; the three docs that quote the naive figure are corrected.

Confirmed live: the baseline is `6 / 15 / 22`. Three documents give a different figure for a ★★★ ladder — `docs/campaign/special_units/design.md` §2's table, `docs/campaign/economy/prices.md` §3.1's table, and the gamification page's Finding 3 ("the star gates open 2, 5 and 7 missions earlier", i.e. after missions 4, 10 and 15). **That figure is a naive bound, not a re-derivation.** `design.md:37-56`'s own column is labelled "★★★ reaches it (3/mission)" and its arithmetic is `stars_min ÷ 3` — 12÷3=4, 30÷3=10, 44÷3≈15 — which assumes *every* mission scores three stars from mission one. This package promotes **six specific missions** from 2 to 3, which is a different ladder and a different answer. `prices.md` §7 (line 383) repeats the same figure a second time as "2-7 missions earlier"; correct that sentence too.

No task copies "4/10/15", and no task copies the predictions in this plan either. Each sets `GATES.opensAfter` from the printed line.

### R-3 — Every passive control must still lose, measured.

Each task that touches a mission JSON or a plan ends with a full `pnpm playtest` and reads back the `(passive control)` / `(no orders)` rows for the missions it touched: still `DEFEAT`, still `stars 0`, still `credits 0`. Measured this session, all 23 controls read exactly that. This is a regression guard, not a formality: a JSON change can move a control's outcome even though a plan-only change should not.

The two label conventions — `(passive control)` and `(no orders)` — assert the identical thing; the split is historical and nothing in code distinguishes them. The falsification is the named one: **delete the control's `run(...)` line and the harness stops asserting that the mission is losable at all** — the run stays green and says nothing, which is exactly the silence this guard exists to break.

### R-4 — `packages/sim` untouched; determinism unmoved; and **yes, `LADDER_CREDITS` moves.**

`creditsFor` pays `CREDIT_WEIGHTS.carryingSecondary = 40` per secondary that is **flagged `carries: true` AND `status === 'complete'`** (`packages/sim/src/credits.ts:16-20, 66`). This package completes six such secondaries that are flagged and incomplete today, and flags a seventh (`beit_sahwan_3_clearance`'s `picture`) that is already complete. **Seven × 40 = +280 before any drift**, against the pinned 5531 — so the naive landing figure is ~5811, and `prices.md` §3's 5531 moves with it. On top of that sits real drift: a changed route changes which units come home (`unitHome` 10 each) and what Conduct the run scores (`conductPoint` 1 each), and Task 1 can move III's and IV's own credits with no star change at all. Re-pin from the printed `credit ladder:` line in every commit that moves it, with the reason in the commit message, and update `prices.md` §3's figure in Task 5 with the final number.

### R-5 — Beit Sahwan IV first, then III's re-flag, and IV must not be fixed with knowledge it is not allowed to have.

The issue's order is load-bearing, not style: `playtest.ts:483-493` records the experiment — adding `intel.marked_positions` to III's `produces` took IV from `VICTORY in 2.1 min, ROE 98` to `ONGOING in 20.0 min`, `roster out 0`, on 2026-09-11.

`intel.marked_positions` **cannot pre-reveal a tunnel route** (CLAUDE.md; `mission.ts:942` reveals units by tag and tunnel visibility is live — a route is identified only while a `mark_tunnel` carrier holds a sight line). IV's plan therefore may not be hardened by driving a Yahalom team straight at a route it is not supposed to know: it must find each route by walking onto it, which is what the shipped plan already does ("Both Yahalom carry the ability themselves at sight 8, so a team that walks onto a route finds it and holds it for its own charge"). **If the hardening reaches for pre-knowledge of a route, that is the fragility, and the fix is the route order, not the waypoint.**

### R-6 — Four to six tasks, one mission or one plan family each, and every one carries the harness command and the number that proves it.

Six tasks. Tasks 1 and 6 run at **opus**; the rest at **sonnet** (the agents' own default).

### R-7 — Each task re-pins only what it moved; the three docs are corrected **once**, in Task 5.

Every star-moving task must re-pin `GATES` and `LADDER_CREDITS` in its own commit, or CI is red at that commit. But the gate numbers move **four times** across this package, so writing an intermediate figure into `special_units/design.md` and `prices.md` and then correcting it again would be three wrong documents instead of one. The docs are corrected in Task 5, the last task that moves a star, when the numbers are final. Task 6 moves none.

The third of R-2's three documents — the gamification page's Finding 3 — is a **published Artifact, not a repo file**, so no commit here can touch it. Task 5 records the corrected figure in its report so the page carries it at its next republish; that is the one item of this plan that does not land as a commit.

### R-8 — A mission promoted to ★★★ must reach ★★★ in the **max-tier replay** too, in the same run.

Non-obvious and it will bite. `run(...)` records a `MaxTierProbe` carrying the base run's `expectStar` and `baseStars` (`playtest.ts:78, 290`), and the replay asserts **twice**: `rt.stars < expectStar` → `<id> (max tier): FAILED — expected 3 star(s), got 2`, and `measured.stars >= probe.baseStars` → `<id> (max tier): FAILED — base VICTORY/3★, max VICTORY/2★`. Tiering really does change these outcomes: measured today, `deir_amun_1_recon`'s max-tier replay completes `find_the_chief` where the base run does not. So each ★★★ task reads **both** its plain line and its `(max tier)` line before committing, and a plan step that works at base tier and not at maximum is not finished.

### R-9 — The three Beit Sahwan missions with no passive control must not be given a `'defeat'` one.

Measured: `beit_sahwan_1_recon`'s only primary is `picture` (`locate`, count 6, **no deadline**); `beit_sahwan_3_clearance`'s are `kill_atgm` (`eliminate_hvt`, no deadline) and `take_town` (`capture`, 20 s hold); `beit_sahwan_2_foothold`'s is `hold_for` 300 s. A passive run of any of them neither completes nor fails a primary, so the runtime returns **ONGOING** at the harness's 20-minute ceiling, not DEFEAT — `run(..., 'defeat', ...)` would go red. That is why they have no control, and it is not an oversight to fix inside this package. An `expect: 'ongoing'` control asserting "a passive player does not win" is a real and cheap improvement; it is recorded under "Deliberately not done here" rather than smuggled into a task.

### R-10 — Task 1 changes a ledger contract and **no star**; the star is Task 2. That is the commit boundary that keeps CI green.

Adding `intel.marked_positions` to III's `produces` is a carry-over wiring change; adding `carries: true` to `picture` is the star. They are separable, and separating them means Task 1 commits with `GATES` unmoved and Task 2 owns the one gate shift the flag causes. Committing the `produces` key without IV's hardening, or the flag without the pins, is a red CI at that commit either way.

### R-11 — Record the clock, every time.

The harness cannot fail on duration (CLAUDE.md's measured 7x blowout that stayed green). Every task's report therefore prints the mission's `VICTORY in N.N min` before and after its change, and its ratio to `target_minutes`. A step that adds more than a minute to one of these plans is a finding to raise, not a number to bank.

---

## The pins, predicted

Derived from the same arithmetic the harness runs (`missionOrder` position × 2 stars, plus one for each promoted mission at or before that position, plus one for `qarn_hadid_1_recon` at position 15). **Predictions, to be checked against the printed line — never copied into `playtest.ts`.** A number that lands somewhere else means a star moved that this plan did not intend, and that is the thing to go and find.

| after task | promoted so far (order) | `breach_team` (12★) | `scout_shachaf` (30★) | `apc_kipod` (44★) | `LADDER_CREDITS` |
|---|---|---|---|---|---|
| baseline | — | **6** | **15** | **22** | **5531** |
| 1 — BS IV | none | 6 | 15 | 22 | 5531 ± drift |
| 2 — BS III | 4 | 6 | 15 | **21** | +40 ± drift |
| 3 — BS I + KR I | 2, 4, 6 | **5** | **14** | **20** | +80 ± drift |
| 4 — DA I | 2, 4, 6, 9 | 5 | **13** | 20 | +80 ± drift |
| 5 — UZ I + UZ III | 2, 4, 6, 9, 18, 20 | 5 | 13 | **19** | +80 ± drift |

Final predicted: **5 / 13 / 19**, credit ladder **~5811**. Note that Task 3 alone moves all three, and Task 2 alone moves one — the package cannot be scoped as "content only" without a re-pin in every star-moving commit.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `data/missions/beit_sahwan_3_clearance.json` | `ledger.produces` gains `intel.marked_positions` (1); `picture` gains `carries: true` (2) | 1, 2 |
| `tools/src/backtest/playtest.ts` — III's `run` ledger arg (~551), `led4In` (927), IV's plan (991-1077) | The carry-over chain and IV's hardening | 1 |
| `tools/src/backtest/playtest.ts` — `GATES` (2406-2410), `LADDER_CREDITS` (2529) | The pins, re-set from the printed line in every commit that moves them | 1, 2, 3, 4, 5 |
| `tools/src/backtest/playtest.ts` — the `run(...)` calls for the six promoted missions | `expectStar: 3`, and the plan steps that earn it | 2, 3, 4, 5 |
| `docs/campaign/special_units/design.md` §2, `docs/campaign/economy/prices.md` §3.1 and §7 | The naive "4/10/15" ★★★ column, corrected to the measured ladder | 5 |
| `packages/app/src/campaign.ts` (`villainState`, the villain type) | The villain's ending is the mission the design puts it at | 6 |
| `packages/app/src/campaign.test.ts` | Its spec | 6 |
| `data/schemas/commander.schema.json`, `data/campaign/commander.json` | The optional `ends_at` pointer, and Marj's one line | 6 |
| `packages/app/src/main.ts` (3644), `packages/app/src/ui/worldmap.ts` (285) | The two call sites, one argument each | 6 |

---

### Task 1: Beit Sahwan IV holds when III's intel arrives

**Agent: `playtest`, at opus.** The hardest task in the package and the one with a recorded prior failure; it needs judgement about which of two independent changes caused what.

III declares `requires: ['roster.surviving_units', 'intel.marked_positions']` and produces the key to nobody. Making `picture`'s flag honest means III must produce it — and the last time that was tried, on 2026-09-11, IV went from `VICTORY in 2.1 min, ROE 98` to `ONGOING in 20.0 min` with the whole roster dead. This task does the wiring and hardens IV against it. **It moves no star**, so `GATES` should not move; if it does, something else changed and that is the finding.

**What the 2026-09-11 result cannot be trusted about, and why this task must re-measure rather than reproduce.** Three things have changed under it since. Measured from the two mission JSONs: **III's tags ∩ IV's tags is exactly two** — `bs_ambush_market_lane` (an `rpg_team` at [27.5,24.5] in IV) and `bs_cell_north_block` (a `militia_cell` at [27.5,12.5]) — and **IV already inherits both today**, plus `bs_track_north`, from `led1`; the harness's own comment at `playtest.ts:921-927` names the first two, and the comment at 938-945 names the third and records that IV's plan was rebuilt for it. And the delivery mechanism has a trap in it: `led4In = { ...led1, ...led2, ...led3 }` is an object spread, so once `led3` carries `intel.marked_positions` it **replaces** `led1`'s value rather than merging with it. III is currently run with `led2`, which does not carry the key at all, so III's own `this.marked` is empty and its produced union (`mission.ts:1961`) would be **III's own sightings alone** — which would silently *un-mark* `bs_track_north` for IV. The plausible outcome is therefore the opposite of 2026-09-11's: less pre-marking, not more. Measure it; do not assume either way.

**The wiring has two halves and the second is a fidelity fix.** (i) III's `ledger.produces` gains `intel.marked_positions`. (ii) III is run with `{ ...led1, ...led2 }` instead of `led2`, exactly as `led4In` already does for IV and for the reason `playtest.ts:921` already gives — the app merges every mission's output into one persistent ledger (`main.ts:1022`), so in a real campaign III *receives* I's marks and the sim's own union preserves them. Today the harness hands a mission that declares `requires: intel.marked_positions` an empty set, which is both unfaithful to the app and the thing that makes the spread destructive.

Then (iii): whatever IV's plan needs, **found by measurement and named**. R-5 binds it — no pre-knowledge of a tunnel route; the Yahalom teams find routes by walking onto them.

**Files:**
- Modify: `data/missions/beit_sahwan_3_clearance.json` (`ledger.produces`)
- Modify: `tools/src/backtest/playtest.ts` — III's `run(...)` ledger argument (~551), the comment block at 483-493 that records the 2026-09-11 experiment, `led4In` (927) and IV's plan body (991-1077) if hardening is needed, plus `LADDER_CREDITS` (2529) if it moved

**Interfaces:**
- Produces, for Task 2 to flag: `beit_sahwan_3_clearance.ledger.produces` includes `'intel.marked_positions'`.
- Produces, for every later task: `pnpm playtest` exits 0 with `GATES` still `6 / 15 / 22`.
- Consumed unchanged: `mission.ts:1961`'s union semantics; `spawnPlacement`'s `preMarked` branch.

- [ ] **Step 1: Write the failing assertion — and measure the real delta before touching IV**

The harness assertion is the existing `run(...)` for IV, which already reads:

```
beit_sahwan_4_subterranean: VICTORY in 2.1 min, ROE 98, stars 2,
  objectives bring_it_down=c read_the_ground=c get_them_out=c take_the_shaft_head=c find_spade=c,
  roster out 25
```

Make it red first, on purpose, with half (i) alone:

```jsonc
// data/missions/beit_sahwan_3_clearance.json
"ledger": {
  "requires": ["roster.surviving_units", "intel.marked_positions"],
  "produces": [
    "roster.surviving_units",
    "roe.mission_ratings",
    "campaign.completed_missions",
    "campaign.mission_results",
    "intel.marked_positions"
  ]
}
```

Run `pnpm playtest` and **write down the whole IV line**, not just the verdict: the result, the minute figure, every objective's status letter, `roster out N`, and the control's line too. Then add a temporary `console.log` of `led3['intel.marked_positions']` and of the intersection with IV's tag list, run once, and record which placements actually spawn pre-marked in IV and which stopped doing so. **Delete the log before committing.** If IV still passes, say so plainly and do not invent a fix — the task then reduces to (i) + (ii) + the pins, and that is a legitimate outcome.

- [ ] **Step 2: Implement**

(ii) III's ledger argument becomes `{ ...led1, ...led2 }`, with a comment saying why — the app's persistent merge, III's own `requires`, and the fact that the sim unions rather than replaces. Re-run and record III's own line: its result, minutes, Conduct, objectives and `roster out` may all move, because III's own placements now spawn pre-marked from I's intel.

(iii) Harden IV only against a failure you have printed. The shipped plan's two structural weaknesses are already documented in its own comment block (`playtest.ts:946-990`) and are the first places to look: an irreplaceable vehicle parked inside an ambush's kill radius, and one Yahalom team starting a charge before its escort can draw fire. Neither remedy needs route pre-knowledge. **Do not** add a waypoint that walks a `mark_tunnel` carrier onto a route the plan has no reason to know about (R-5); **do not** reach the star by extending the plan's clock past `target_minutes` 6 (R-11).

Rewrite the comment block at `playtest.ts:483-493`: it currently says the carry-over "stays closed and the claim comes off the flag". That is about to be false. Replace it with what this task measured — the date, the delta in pre-marked tags, IV's before and after lines.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

Read back and paste into the task report:
- `beit_sahwan_4_subterranean:` — VICTORY, `stars 2`, **`roster out` > 0**, all five objectives `c`, minutes against `target_minutes` 6.
- `beit_sahwan_4_subterranean (no orders):` — still `DEFEAT … stars 0 … credits 0` (R-3).
- `beit_sahwan_3_clearance:` — still VICTORY, still `stars 2` (the flag is Task 2), minutes against 7.
- `gate breach_team / scout_shachaf / apc_kipod` — still **6 / 15 / 22**. If one moved, a star moved; stop and find it.
- `credit ladder: N` — re-pin `LADDER_CREDITS` if `N ≠ 5531`, with the reason in the comment block above it.
- `max tier: 26 of 26 plain victories hold`.

**Falsify, two separate ways, each seen red:**
1. Revert half (iii) — IV's hardening — keeping (i) and (ii). The IV line must go red at a named objective; quote the line. If it does not, (iii) was not needed and should not be in the commit.
2. Delete `run('beit_sahwan_4_subterranean', () => {}, {}, 'defeat', 'beit_sahwan_4_subterranean (no orders)')` (playtest.ts:917). The run stays green and the harness stops asserting that IV is losable at all — which is R-3's point. Restore it.

```bash
/usr/bin/git -C <worktree> add data/missions/beit_sahwan_3_clearance.json tools/src/backtest/playtest.ts
/usr/bin/git -C <worktree> commit -s -- data/missions/beit_sahwan_3_clearance.json tools/src/backtest/playtest.ts
```

Message:

```
fix(campaign): Beit Sahwan III produces the intel IV reads, and IV holds

III declared requires: intel.marked_positions and produced it to nobody, so its
`picture` secondary could not honestly carry. It produces it now, and the harness
hands III the same merged ledger the app does ({...led1, ...led2}) rather than led2
alone -- without which led4In's spread REPLACES I's marks instead of unioning them.
IV re-measured against the real delta rather than against the 2026-09-11 experiment,
which predates I's bs_track_north companion placement and IV's own plan rebuild.
No star moves here; the flag is the next commit. Seen red: <the named falsification>.
```

---

### Task 2: Beit Sahwan III — `picture` becomes a carrying secondary

**Agent: `mission-author`, at sonnet.** One JSON field and its pins. `mission-author` owns objectives and ledger contracts (`docs/campaign/README.md`).

`picture` is `{ "type": "locate", "primary": false, "count": 4 }` — already `complete` in every recorded run, and deliberately unflagged since 2026-09-11 because the carry-over it implied did not exist. Task 1 made it exist. Flagging it takes III from ★★ to ★★★ with **no plan change at all**, which is why this is the smallest task in the package and also the one that moves a gate.

Note what `carries: true` does and does not do. It feeds exactly two things: `starsFor`'s third star (`grade.ts`) and `creditsFor`'s `carryingComplete` (+40). It does **not** change what III produces — `markedThisMission` accumulates every tag III's force identifies, objective or no objective (`mission.ts:995-1003`), which is Task 1's business and already done. And nothing in `tools/validate_data.mjs` enforces the relationship between the two, so the honesty of this flag rests on Task 1 having landed, not on a validator.

**Files:**
- Modify: `data/missions/beit_sahwan_3_clearance.json` (the `picture` objective)
- Modify: `tools/src/backtest/playtest.ts` — III's `run(...)` call gains `expectStar: 3`; `GATES` (2406-2410); `LADDER_CREDITS` (2529)

**Interfaces:**
- Produces: `beit_sahwan_3_clearance` grades 3 in both the plain run and the `(max tier)` replay.
- Produces: `GATES.opensAfter` for `apc_kipod`, re-measured (predicted 22 → 21).

- [ ] **Step 1: Write the failing assertion**

The assertion is `expectStar`, and it is a **floor** (`rt.stars < expectStar`, playtest.ts:267), so it can only catch a star falling back. Add it first, before the flag, and watch it fail — that is this task's "red":

```ts
// tools/src/backtest/playtest.ts — III's run(...), following qarn_hadid_1_recon's shipped shape
const led3 = run(
  'beit_sahwan_3_clearance',
  (sim, _rt, ids, at) => { /* unchanged */ },
  { ...led1, ...led2 },
  'victory',
  'beit_sahwan_3_clearance',
  3
);
```

`pnpm playtest` must print `beit_sahwan_3_clearance: FAILED — expected 3 star(s), got 2` and exit 1. If it does not, the flag has already landed or the call was edited at the wrong argument position — `expectStar` is the **sixth** positional argument and `expect` and `label` must both be passed to reach it.

- [ ] **Step 2: Implement**

```jsonc
{
  "id": "picture",
  "type": "locate",
  "primary": false,
  "carries": true,
  "count": 4,
  "text": "Build the picture: identify four garrison positions"
}
```

Then re-run and re-pin, in this order: read `gate <unit>: OPEN/CLOSED after mission N at M stars` for all three units and set `GATES.opensAfter` from them; read `credit ladder: N over 26 missions` and set `LADDER_CREDITS`. Both re-pins carry a comment saying which mission's star moved and why, in the style the `LADDER_CREDITS` block already uses.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

Read back: `beit_sahwan_3_clearance: … stars 3` **and** `beit_sahwan_3_clearance (max tier): … stars 3` (R-8 — the replay asserts twice and this mission has no `(passive control)` row, per R-9, so the max-tier line is the second guard here); the three `gate` lines; `credit ladder`; `max tier: 26 of 26`. III's minute figure against `target_minutes` 7.

**Falsify:** remove `"carries": true` and keep `expectStar: 3`. `pnpm playtest` must print `beit_sahwan_3_clearance: FAILED — expected 3 star(s), got 2` and exit 1, and the gate line must go back to reporting `apc_kipod` at its old number. Restore.

```bash
/usr/bin/git -C <worktree> add data/missions/beit_sahwan_3_clearance.json tools/src/backtest/playtest.ts
/usr/bin/git -C <worktree> commit -s -- data/missions/beit_sahwan_3_clearance.json tools/src/backtest/playtest.ts
```

Message:

```
feat(campaign): Beit Sahwan III's picture carries, and III grades three stars

The flag now stands on something: III produces intel.marked_positions as of the
previous commit, so a secondary "whose result a later mission reads" is literally
true of this one. expectStar 3 pinned, apc_kipod's gate re-measured from the
printed line (<old> -> <new>) and LADDER_CREDITS re-pinned (<old> -> <new>, +40
for the newly-carrying secondary plus <drift>). Seen red: the flag removed with
expectStar 3 left in place.
```

---

### Task 3: The Marj's two one-objective recon plans — `beit_sahwan_1_recon` and `khan_rafid_1_recon`

**Agent: `playtest`, at sonnet.** One plan family: two recon plans, one unfinished carrying secondary each, the same shape of fix.

| mission | objective | target tag | what it is, and where |
|---|---|---|---|
| `beit_sahwan_1_recon` | `hvt_seen` | `bs_hvt_atgm` | `atgm_cell` ×1 at **[38.5, 22.5]** — the far east edge; the plan's drone tour today runs (21,8) → (21,30) → (26,40) → (30,18) and the screen attack-moves to (27,20) |
| `khan_rafid_1_recon` | `find_the_west_lane` | `kr_lane_west` | `rpg_team` ×1 at **[13, 20]**, `stance: {kind: 'ambush', tiles: 3}` — an ambusher that holds fire to 3 tiles, so it must be *approached*, not merely overflown at range |

Both plans already complete every other objective. Neither mission has a passive control (R-9): `beit_sahwan_1_recon`'s only primary is a deadline-free `locate`, so a passive run is ONGOING and a `'defeat'` control would be red. `khan_rafid_1_recon (passive control)` does exist and must stay `DEFEAT`.

**Files:**
- Modify: `tools/src/backtest/playtest.ts` — `beit_sahwan_1_recon`'s plan (421-443) and its `run(...)` call; `khan_rafid_1_recon`'s plan (1129-1147); `GATES`; `LADDER_CREDITS`

**Interfaces:**
- Produces: both missions grade 3 plain and 3 at max tier.
- Produces: `GATES.opensAfter` re-measured for all three units (predicted 5 / 14 / 20).

- [ ] **Step 1: Write the failing assertion**

Add `expectStar: 3` to both calls first and watch each go red. `beit_sahwan_1_recon`'s call is a trailing-argument form and needs `'victory'` and its own label added to reach the sixth position; `khan_rafid_1_recon`'s already passes both:

```ts
run(
  'khan_rafid_1_recon',
  (sim, _rt, ids, at) => { /* unchanged */ },
  {},
  'victory',
  'khan_rafid_1_recon',
  3
);
```

Expected, verbatim, before the plan changes:

```
beit_sahwan_1_recon: FAILED — expected 3 star(s), got 2
khan_rafid_1_recon: FAILED — expected 3 star(s), got 2
```

- [ ] **Step 2: Implement**

One plan change each. Add a leg, do not rewrite a plan.

For `hvt_seen`: the ATGM cell sits at the map's east edge and the drone's existing tour already reaches (30,18); the cheapest honest change is one more waypoint that brings an observer inside sight of [38.5,22.5], timed after the existing legs so the rest of the picture is unaffected. For `find_the_west_lane`: an ambusher at `tiles: 3` is identified by being closed with, so the lever is the jeep's or the drone's route past [13,20] rather than a longer standoff — and closing with an `rpg_team` risks the vehicle, so read `roster out` afterwards, not only the objective letter.

After each, re-run and read the **whole** line. A route change can shift combat non-locally through the per-entity RNG stream — the mechanism `playtest.ts:946-957` documents for IV — so check every objective's status letter, both controls, `roster out`, Conduct and the minute figure, not just the one targeted. Then re-pin `GATES` and `LADDER_CREDITS` from the printed lines.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

Read back: both plain lines at `stars 3`; both `(max tier)` lines at `stars 3` (R-8); `khan_rafid_1_recon (passive control): DEFEAT … stars 0 … credits 0` (R-3); the three `gate` lines; `credit ladder`; `max tier: 26 of 26`. Minutes against `target_minutes` 7 and 6 (R-11) — today 0.6 and 0.5.

**Falsify, both named:**
1. Revert one plan's added leg with its `expectStar: 3` left in place — `<id>: FAILED — expected 3 star(s), got 2`, exit 1, and the objective letter back to `a`. Restore. Repeat for the other.
2. Delete `khan_rafid_1_recon (passive control)`'s `run(...)` line (playtest.ts:1094) — the run stays green and stops asserting that mission is losable. Restore.

```bash
/usr/bin/git -C <worktree> add tools/src/backtest/playtest.ts
/usr/bin/git -C <worktree> commit -s -- tools/src/backtest/playtest.ts
```

Message:

```
feat(playtest): the Marj's first two recon plans reach three stars

hvt_seen (bs_hvt_atgm, the ATGM cell at the east edge) and find_the_west_lane
(kr_lane_west, an ambusher at three tiles) were the only carrying secondaries
these two plans left incomplete. One leg each; every other objective, both
controls and both clocks unchanged. All three star gates re-measured from the
printed lines (6/15/22 -> <new>) and LADDER_CREDITS re-pinned. Seen red: each
leg reverted with expectStar 3 left in place.
```

---

### Task 4: `deir_amun_1_recon` — the only plan that owes two

**Agent: `playtest`, at sonnet.** One mission, two carrying secondaries incomplete, and one of them is already known to be reachable.

| objective | target tag | what it is, and where |
|---|---|---|
| `find_the_chief` | `da_hvt_engineer` | `digger_crew` ×1 at **[28, 17]** — no ambush stance, standing on his own spoil |
| `find_the_gap_gun` | `da_watch_gap` | `rpg_team` ×1 at **[18, 11]**, `stance: {kind: 'ambush', tiles: 4}` |

**The lever this task starts from, measured:** the `(max tier)` replay of this same plan already reads `find_the_chief=c find_the_gap_gun=a`, where the plain run reads both `a`. So the chief is reachable by this plan's own route with stronger units — the plan is short of him by a margin, not blocked by geometry. Start there: find what the max-tier run does differently (it survives further, or arrives sooner) and buy the same margin with a route or a timing change rather than with a new phase of the plan. **R-8 cuts the other way here:** whatever earns the chief at base tier must not cost him at maximum.

**One thing to leave alone.** Deir Amun I declares `requires: ['roster.surviving_units', 'intel.marked_positions']` and the harness runs it with `{}` — the same fidelity gap Task 1 closed for Beit Sahwan III. Do **not** close it here as well: it would change which of DA I's own placements spawn pre-marked, which is a second variable inside a task that already has two, and it belongs in its own change with its own measurement. This task changes the plan body only.

**Files:**
- Modify: `tools/src/backtest/playtest.ts` — `deir_amun_1_recon`'s plan (1343-1366) and its `run(...)` call; `GATES`; `LADDER_CREDITS`

**Interfaces:**
- Produces: `deir_amun_1_recon` grades 3 plain and 3 at max tier.
- Produces: `GATES.opensAfter` re-measured (predicted 5 / 13 / 20 — `scout_shachaf` is the one this task moves).

- [ ] **Step 1: Write the failing assertion**

```ts
run(
  'deir_amun_1_recon',
  (sim, _rt, ids, at) => { /* unchanged */ },
  {},                   // the existing ledger argument, unchanged -- see the note below
  'victory',
  'deir_amun_1_recon',
  3
);
```

Expected before the plan changes:

```
deir_amun_1_recon: FAILED — expected 3 star(s), got 2
```

with `objectives … find_the_chief=a find_the_gap_gun=a`.

- [ ] **Step 2: Implement**

Take the two separately and re-run between them, so the report can say which change bought which letter. The chief first — the max-tier evidence says he is the cheaper of the two. Then the gap gun, which is the same `tiles: 4` ambusher shape as Task 3's west lane and wants closing with rather than watching from range.

Watch `roster out` (5 today, the thinnest of the seven missions in this package) and Conduct 100. A recon plan that finishes with a smaller roster has paid for the star in the next mission's force, which is the trade the design prices deliberately — record it either way.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

Read back: `deir_amun_1_recon: … stars 3` with **both** `find_the_chief=c` and `find_the_gap_gun=c`; `deir_amun_1_recon (max tier): … stars 3`; `deir_amun_1_recon (passive control): DEFEAT … stars 0 … credits 0`; the three `gate` lines; `credit ladder`; `max tier: 26 of 26`. Minutes against `target_minutes` 6 — today 0.6.

**Falsify, both named:**
1. Revert the `find_the_gap_gun` change alone, keeping the chief's and `expectStar: 3` — `deir_amun_1_recon: FAILED — expected 3 star(s), got 2` with `find_the_chief=c find_the_gap_gun=a`. This is the falsification that proves the two changes are independent and that neither is carrying the other by accident. Restore.
2. Delete `deir_amun_1_recon (passive control)`'s `run(...)` line (playtest.ts:1329) — the run stays green and stops asserting the mission is losable. Restore.

```bash
/usr/bin/git -C <worktree> add tools/src/backtest/playtest.ts
/usr/bin/git -C <worktree> commit -s -- tools/src/backtest/playtest.ts
```

Message:

```
feat(playtest): Deir Amun I finds both the chief and the gap gun

The only plan in the package owing two carrying secondaries. The chief was
already reachable on this route -- the max-tier replay of the same plan completes
find_the_chief where the base run does not -- so the fix buys that margin at base
tier rather than adding a phase. The gap gun is a four-tile ambusher and is closed
with. scout_shachaf's gate re-measured from the printed line and LADDER_CREDITS
re-pinned. Seen red: the gap-gun change reverted alone, with the chief's kept.
```

---

### Task 5: Umm Zeitoun's two — and the three documents that quote the wrong gate figure

**Agent: `playtest`, at sonnet.** One town, two missions, plausibly one scouting-route insight; and the doc correction, which lands here because this is the last task that moves a star and the numbers are final at its end (R-7).

| mission | objective | target tag | what it is, and where |
|---|---|---|---|
| `umm_zeitoun_1_recon` | `find_the_missile_team` | `uz_manpad_basin` | `manpad_team` ×1 at **[30.5, 22.5]** — its own briefing line says *"Air only, thirteen tiles — the drone crosses that line once"* |
| `umm_zeitoun_3_clearance` | `find_adhal` | `uz_hvt_lantern` | `sarim_rifles` ×1 at **[13.5, 6.5]** — *"on the northern crest, thirty-four tiles out"*; the mission that also names Karim Adhal, Sur's villain |

**The one that is not like the others.** `find_the_missile_team` is a manpad: the drone identifies it by entering its engagement envelope, and the mission's own narration says the drone gets **one** crossing. So the honest fix is a route where the drone earns the identification and the mission survives the loss of the drone if it comes — or a ground observer that sees the shelf without the drone. Read `roster out` (13 today) and every other objective letter; losing the drone is a legitimate price, losing the mission is not.

`find_adhal` is 34 tiles from the start line on a clearance mission whose plan already wins in 2.0 minutes with Conduct 89 — the tightest Conduct margin of the seven here (`playtest.ts:119` records `umm_zeitoun_3_clearance` as one of the two tightest ★★ margins in the whole ladder, +11 against a floor of 65). **Do not trade Conduct for the star**: a route that takes the crest by shooting into the town can drop the ★★ margin and lose the mission two stars to gain one.

**Files:**
- Modify: `tools/src/backtest/playtest.ts` — `umm_zeitoun_1_recon`'s plan (2008-2051), `umm_zeitoun_3_clearance`'s plan (2169-2174) and both `run(...)` calls; `GATES`; `LADDER_CREDITS`
- Modify: `docs/campaign/special_units/design.md` §2 (the table at 45-48 and the sentence "The ★★★ lead widens 2 → 5 → 7")
- Modify: `docs/campaign/economy/prices.md` §3.1 (the table at 117-121) and §7 (line 383's "2-7 missions earlier"), and §3's `LADDER_CREDITS` figure

**Interfaces:**
- Produces: the final `GATES.opensAfter` triple and the final `LADDER_CREDITS`, both measured.
- Produces: two corrected repo docs, and the corrected figure in the task report for the gamification page's Finding 3 (R-7 — that page is a published Artifact and cannot be committed here).

- [ ] **Step 1: Write the failing assertion**

```ts
run(
  'umm_zeitoun_1_recon',
  (sim, _rt, ids, at) => { /* unchanged */ },
  ledTelMarum3,         // the existing chained ledger argument, unchanged
  'victory',
  'umm_zeitoun_1_recon',
  3
);
```

and the same sixth argument on `umm_zeitoun_3_clearance`'s call (`const ledUZ3 = run('umm_zeitoun_3_clearance', ummZeitoun3Plan, ledUZ2In, 'victory', 'umm_zeitoun_3_clearance', 3)`).

**Two traps in that one call.** Its plan body is a **named const, `ummZeitoun3Plan`, shared with the `(gate open)` probe** twenty lines below — so every change to it re-runs that probe too. Leave the probe's own `expectStar: 2` and its `'scout_shachaf'` fielded check exactly as they are: it is excluded from `missionStars`/`missionCredits`/the gate walk by the `label === id` guard and it asserts a different thing (that the placement resolves to the upgraded type). And `ledUZ3` is consumed downstream by `umm_zeitoun_4_clearance`, so a change here can move mission 21's line as well — read it.

Expected before the plan changes:

```
umm_zeitoun_1_recon: FAILED — expected 3 star(s), got 2
umm_zeitoun_3_clearance: FAILED — expected 3 star(s), got 2
```

- [ ] **Step 2: Implement**

The two plan changes, measured one at a time. Then, once `pnpm playtest` is green, read the final numbers and correct the docs **from the printed lines**:

`docs/campaign/special_units/design.md` §2 — the "★★★ reaches it (3/mission)" column reads 4 / 10 / 15 and is a naive bound (`stars_min ÷ 3`, assuming every mission scores three from mission one). Replace it with the measured ladder this package produces, keep the naive column if it is useful but **label it as the bound it is**, and correct the sentence "The ★★★ lead widens 2 → 5 → 7" to the measured lead. Also correct the section's own baseline sentence — it says "25 at two stars and `qarn_hadid_1_recon` at three", which is no longer true.

`docs/campaign/economy/prices.md` §3.1 — the same table, same correction, plus §7's "a ★★★ player's star gates open 2-7 missions earlier (§3.1)". And §3's ladder figure, per R-4.

Say in both, in one sentence, **why** the old figure was wrong: it divided the star requirement by three, which describes a campaign where every mission is ★★★, not this one.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

Read back: both plain lines at `stars 3`; both `(max tier)` lines at `stars 3`; `umm_zeitoun_1_recon (no orders)` and `umm_zeitoun_3_clearance (no orders)` both `DEFEAT … stars 0 … credits 0`; the three `gate` lines — **this is the final triple, predicted 5 / 13 / 19**; `credit ladder` — the final figure, predicted ~5811; `max tier: 26 of 26`. Minutes against `target_minutes` 6 and 7 — today 2.6 and 2.0. And `umm_zeitoun_3_clearance`'s Conduct, which was 89 and must not fall near its floor of 65 + 20.

**Falsify, both named:**
1. Revert `umm_zeitoun_1_recon`'s added leg with `expectStar: 3` left in place — `FAILED — expected 3 star(s), got 2`, `find_the_missile_team=a`, and the `gate apc_kipod` line back to the previous number. Restore.
2. Delete `umm_zeitoun_3_clearance (no orders)`'s `run(...)` line (playtest.ts:2125) — green, and silent about a mission nobody proved is losable. Restore.

```bash
/usr/bin/git -C <worktree> add tools/src/backtest/playtest.ts docs/campaign/special_units/design.md docs/campaign/economy/prices.md
/usr/bin/git -C <worktree> commit -s -- tools/src/backtest/playtest.ts docs/campaign/special_units/design.md docs/campaign/economy/prices.md
```

Message:

```
feat(playtest): Umm Zeitoun's two reach three stars, and the gate docs say the measured number

find_the_missile_team is a manpad the drone crosses once, and find_adhal is
thirty-four tiles out on the ladder's second-tightest Conduct margin -- neither
star is bought with Conduct. Final star gates measured at <a>/<b>/<c> (from 6/15/22)
and LADDER_CREDITS at <n> (from 5531). special_units/design.md §2 and prices.md
§3.1/§7 quoted 4/10/15, which is stars_min divided by three -- a bound describing a
campaign where every mission is three stars, not this one. Corrected from the printed
lines. Seen red: Umm Zeitoun I's leg reverted with expectStar 3 left in place.
```

---

### Task 6: `captured` — the villain's ending is the mission the design puts it at

**Agent: `mission-author`, at opus.** The decision task. The data half is `data/campaign/`, the question is a campaign-content question — which mission ends a villain — and ruling R-1 widens this one task into `packages/app/src/campaign.ts`. Read R-1 in full before starting: the choice between A, B and C is **already made** and the evidence is recorded there. This task implements B and must not re-open it.

The board today prints *"Killed at the shaft head"* about Nadir Sahim and strikes his name through, in a campaign where the shaft head is taken by a `capture` primary that the mission's own text says takes him alive. `villainState` reads the region's chronologically last mission, which for Marj is `deir_amun_3_subterranean` — a mission about a different man — because Khan Rafid and Deir Amun were added after Sahim's ending shipped and O-KR2 decided his ending would **not** move to follow them.

**The fix.** `villainState` gains an optional pointer at the mission that ends the villain, and falls back to today's behaviour when none is given. The rule at the end is unchanged: the state is `captured` if that mission's primaries include a `capture`, else `killed`, and `at_large` until it is complete. Nothing is authored twice — a future re-staging of Beit Sahwan IV that replaced the capture with a kill would flip the card by itself, which a hand-authored state would not.

**Files:**
- Modify: `packages/app/src/campaign.ts` — `villainState` (576-586) and the villain type carried through `parseCommander` (378-381)
- Modify: `packages/app/src/campaign.test.ts` — the `villainState` describe block (489-499)
- Modify: `data/schemas/commander.schema.json` — the `villain` object (109-138; note `additionalProperties: false`, so the property must be declared)
- Modify: `data/campaign/commander.json` — one line under `villains.marj`
- Modify: `packages/app/src/main.ts` (3644) and `packages/app/src/ui/worldmap.ts` (285) — one argument each

**Interfaces:**
- Produces: `villainState(region, ledger, missionOf, endsAt?: string): VillainState`, where `endsAt` is the villain's `ends_at` and `undefined` reproduces today's behaviour exactly.
- Produces: `commander.schema.json`'s `villain.ends_at` — optional string, snake_case to match the file's own `until_mission` / `promotion_line`.
- Consumed unchanged: `completed(ledger)`, `VillainState`, `.rl-world__villain[data-state]` and its three CSS rules.

- [ ] **Step 1: Write the failing tests**

Extend the existing block rather than replacing it — the two shipped cases become the "no pointer" spec, which is what `sur` and `naharin` rely on:

```ts
// packages/app/src/campaign.test.ts
describe('villainState', () => {
  const marj = world.regions[0]!;
  const last = marj.towns[marj.towns.length - 1]!.missions.at(-1)!;

  it('is at large until the front\'s last mission is done', () => {
    expect(villainState(marj, {}, () => undefined)).toBe('at_large');
  });

  it('is captured when that mission\'s primaries include a capture, else killed', () => {
    const done = { 'campaign.completed_missions': [last] };
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'capture', primary: true }] }))).toBe('captured');
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'eliminate_hvt', primary: true }] }))).toBe('killed');
  });

  // The defect. Marj's villain ends at Beit Sahwan IV -- mission 5 of 26 -- because
  // Khan Rafid and Deir Amun were added to the front after his ending shipped, and
  // khan_rafid/design.md O-KR2 decided his ending would not move to follow them.
  // Without the pointer the board reads the wrong mission's primaries entirely.
  it('reads the mission the villain ends at, not the region\'s last, when one is named', () => {
    const ends = 'beit_sahwan_4_subterranean';
    const objectivesOf = (id: string) =>
      id === ends
        ? { objectives: [{ type: 'capture', primary: true }, { type: 'collapse', primary: true }] }
        : { objectives: [{ type: 'eliminate_hvt', primary: true }] };
    const doneEnds = { 'campaign.completed_missions': [ends] };
    expect(villainState(marj, doneEnds, objectivesOf, ends)).toBe('captured');
    // ...and the region's own last mission being done is neither necessary nor sufficient.
    expect(villainState(marj, { 'campaign.completed_missions': [last] }, objectivesOf, ends)).toBe('at_large');
  });

  it('names a mission that exists', () => {
    // An ends_at nobody can complete would read at_large forever, silently. Every
    // authored pointer must be a mission world.json actually lists.
    const listed = new Set(world.regions.flatMap((r) => r.towns.flatMap((t) => t.missions)));
    for (const [regionId, v] of Object.entries(commander.villains ?? {})) {
      if (v.ends_at !== undefined) expect(listed.has(v.ends_at), `${regionId}.ends_at`).toBe(true);
    }
  });

  it('is what the shipped data says: Sahim is taken at the shaft head', () => {
    const done = { 'campaign.completed_missions': ['beit_sahwan_4_subterranean'] };
    const missionOf = (id: string) => (missions as Record<string, MissionJson | undefined>)[id];
    expect(villainState(marj, done, missionOf, commander.villains!.marj!.ends_at)).toBe('captured');
  });
});
```

`pnpm vitest run packages/app/src/campaign.test.ts -t villainState` — the last three must fail before the implementation, the first two must pass throughout.

- [ ] **Step 2: Implement**

`campaign.ts`: add the fourth parameter and the one-line change, keeping the doc comment honest about why the pointer exists rather than describing the mechanism only:

```ts
/** A front's villain is at large until the mission that ENDS him is complete, then
 *  captured if that mission's primaries include a `capture`, otherwise killed.
 *
 *  `endsAt` is the villain's own `ends_at` (data/campaign/commander.json). Without it
 *  this falls back to the region's chronologically last mission, which is right for
 *  Sur and Naharin -- their villains die at the crest and at the gate, both region-final
 *  -- and wrong for the Marj: Nadir Sahim is taken at `beit_sahwan_4_subterranean`,
 *  mission 5 of 26, and Khan Rafid and Deir Amun were added to the front afterwards.
 *  khan_rafid/design.md O-KR2 decided his ending does not move to follow them, so the
 *  algorithm has to. A pointer rather than an authored state, so that re-staging that
 *  mission re-decides the card instead of leaving two answers in two files. */
export function villainState(
  region: WorldRegion,
  ledger: LedgerData | undefined,
  missionOf: (id: string) => { objectives: readonly { type: string; primary: boolean }[] } | undefined,
  endsAt?: string
): VillainState {
  const towns = region.towns.filter((t) => t.missions.length > 0);
  const regionLast = towns.length > 0 ? towns[towns.length - 1].missions[towns[towns.length - 1].missions.length - 1] : undefined;
  const last = endsAt ?? regionLast;
  if (last === undefined || !completed(ledger).has(last)) return 'at_large';
  const m = missionOf(last);
  return m?.objectives.some((o) => o.primary && o.type === 'capture') ? 'captured' : 'killed';
}
```

The villain type carried through `parseCommander` (378-381) gains the optional `ends_at`; the parse itself is a `{ ...v }` spread and needs no change beyond the type.

`commander.schema.json`, inside the `villain` object's `properties` (not its `required` list):

```json
"ends_at": {
  "type": "string",
  "minLength": 1,
  "description": "The mission that ends this villain, when it is not the region's chronologically last one. Its primaries decide the card: a `capture` primary reads `captured`, anything else reads `killed`, and the villain is `at_large` until it is complete. Omit where the region's last mission IS the ending -- Sur's and Naharin's are."
}
```

`commander.json`, under `villains.marj`: `"ends_at": "beit_sahwan_4_subterranean"`. Nothing under `sur` or `naharin`.

The two call sites each already hold the villain object (`main.ts:3569` binds `villain`; `worldmap.ts:283` binds it too), so each gains `, villain.ends_at` as a fourth argument.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm playtest && pnpm test:determinism
/usr/bin/git -C <worktree> diff --stat -- packages/sim     # must be empty
```

`pnpm playtest` must be **unchanged** from Task 5's output — same three gate lines, same `credit ladder`, same 23 controls at DEFEAT, `max tier: 26 of 26`. This task moves no star and pays no credit; if any of those moved, something else did. `pnpm test:determinism` is here as the package's closing evidence for R-4, not because this task goes near the sim.

**Falsify, two named:**
1. Remove `"ends_at": "beit_sahwan_4_subterranean"` from `commander.json`. The two new data-driven tests go red, and the board reverts to reading `deir_amun_3_subterranean` — i.e. it prints "Killed at the shaft head" about a man taken alive. Restore.
2. Point `ends_at` at a mission id `world.json` does not list. The "names a mission that exists" test goes red — without it, that typo is a villain permanently `at_large` and no other check anywhere would say so. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/app/src/main.ts packages/app/src/ui/worldmap.ts data/schemas/commander.schema.json data/campaign/commander.json
/usr/bin/git -C <worktree> commit -s -- packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/app/src/main.ts packages/app/src/ui/worldmap.ts data/schemas/commander.schema.json data/campaign/commander.json
```

Message:

```
fix(campaign): the villain card reads the mission that ends the villain

`captured` was not unreachable by accident -- villainState read each region's
chronologically last mission, and Khan Rafid and Deir Amun were added to the Marj
after Nadir Sahim's ending shipped. O-KR2 decided his ending stays at
beit_sahwan_4_subterranean, whose take_the_shaft_head IS a capture primary, so the
board has been printing "Killed at the shaft head" about a man its own mission text
takes alive. An optional ends_at pointer on the villain; absent, the old behaviour,
which is correct for Sur and Naharin (the crest and the gate are region-final). The
option to add a capture primary to a region-final mission was refused: it re-litigates
O-KR2 for Marj and invents an ending for two fronts whose design docs commit to
eliminate_hvt by name. playtest and the determinism hash both unmoved.

Seen red: ends_at removed, and ends_at pointed at a mission world.json does not list.
```

---

## Deliberately not done here

- **An `expect: 'ongoing'` control for the three Beit Sahwan missions that have none.** R-9 explains why a `'defeat'` one cannot exist for them. An "a passive player does not win" control is a real improvement and a two-line change per mission, but it is a fourth kind of guard in a package that already moves four pins, and it belongs in its own change with its own falsification.
- **The gamification page's Finding 3.** It is a published Artifact, not a repo file; Task 5 carries the corrected figure into its report so the page gets it at the next republish (R-7).
- **Beit Sahwan IV's own ★★ ceiling.** It has no carrying secondary at all, so `starsFor` returns 2 outright. `find_spade` — *"Find Nadir Sahim at the shaft head"* — is the obvious candidate and is completed in every recorded run, but flagging it is a new claim about what a later mission reads, and IV is the Marj's last Beit Sahwan mission. Out of scope; recorded because a reader of Task 1 will wonder.
- **The naive-bound column in `special_units/design.md`.** Task 5 corrects the figure. It does not re-derive the *gate values* themselves (12 / 30 / 44) — those are fitted and shipped, and R-2's rule is that a red gate means a star moved, never that the gate was wrong.
