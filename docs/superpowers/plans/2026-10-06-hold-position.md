# Hold position: H never empties a building. Implementation plan (reduced, app only)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ruling (lead, 2026-10-11): Hold's sim command is retired.** There is no `hold` command, no
`holdPos` column, no sim re-pin and no H/X key swap. H stays `halt`. The only work left is in the app:
H skips garrisoned units, so it never empties a building.

**Why the plan shrank.** The 6 Oct ruling asked for an order that keeps a unit in place, because
`halt` did not stop the closing rule (`stepSweep`). #537 (lead ruling, 11 Oct) changed that. `halt`
now clears `attackMove`, `sweepOrder` and `boardGoal`, and `stepSweep` walks on only an attack-move
that set `sweep: true` (mission waves, trigger `commit`s, the balance backtest). A halted unit, and an
arrived player attack-mover, now stays put, kneels, fires at anything in range, and never advances,
chases or closes: the 6 Oct definition of Hold. A `hold` command would still have added a status
word and H-D3 ("Hold keeps a garrisoned unit inside"). This plan keeps H-D3 and does it in the app.

**History.** The full plan is in git: as refreshed by the 11 Oct morning pre-flight,
`git show 9501978a:docs/superpowers/plans/2026-10-06-hold-position.md`; with the evening pre-flight's
corrections, the first commit of PR #544 (`fb25a54f`). Its decisions H-D1 to H-D7 and its 11 Oct
questions 3 to 8 are retired with the command. The consequences elsewhere are carried by each plan's
own "Ruling (lead, 2026-10-11)" line: F1's rise and F2's holders use stop-where-sent or `halt`, F4's
rally is a no-sweep attack-move, and targeted fire's T-D8 is dropped.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Base:**
- Read against `main` `49715ff9` (11 Oct evening).
- Branch `polish/halt-keeps-garrison`, Lane A (WP-S-F #184). It needs nothing from Lane C; the order
  plan lists it from Thu 5 Nov, and it may land earlier if the lane is free.
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift.

---

## Global Constraints

- **No `packages/sim` change.** The halt branch of `applyCommands` keeps calling `leaveStructure` for
  any garrisoned id it is handed; the app stops handing it one through H. The sim pins (flat
  `1202444260`, relief `3354895120`, orders `2737216487`), `pnpm balance`, `pnpm playtest`,
  `LADDER_CREDITS` (5917), `CAMPAIGN_CREDITS` (5917), `ROSTER_MAX` (30) and `GATES` are untouched.
- **Leaving a building stays possible.** A `move` or an attack-move on a garrisoned unit still calls
  `leaveStructure` (`sim.ts`, the order branches of `applyCommands`), so the player still walks a squad
  out with a right-click or the N move (#535). Only H stops doing it.
- **Every check is seen red** by a one-line mutation, quoted in the commit.
- **Gates:** `pnpm test`, `typecheck`, `lint`, `validate:ui` (strings through `t()`, no colour
  literals), `validate:data`. Never run `pnpm ui:routes`, `golden-baseline` or `ui:shots` locally;
  CI runs them. Browsers start with music off (`musicOffInitScript()`); never port 5177; never `pkill`.
- **Git:** `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`.
  Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The lead merges.

---

## File structure

| File | Role |
|---|---|
| `packages/app/src/main.ts` | `orders.halt` (~L2622) filters garrisoned ids out before `dispatch` |
| `packages/app/src/input/intents.ts` | `haltTargets` (new, pure) beside `haltNote` (~L552), which gains the "everyone selected is inside" case |
| `packages/app/src/i18n/en.json` | one new string, `intent.halt.garrisoned` |
| `packages/app/src/input/intents.test.ts` | the tests |
| `docs/HANDOVER.md`, `CLAUDE.md` | ledger |

---

## Task 1: H skips garrisoned units (Lane A)

**Model:** sonnet. **Agent:** lane A.

**Taken defaults (following the lead's ruling; no new question):**
- A mixed selection halts the units outside and leaves the units inside where they are, with no
  note: the ones inside were already holding.
- A selection that is entirely garrisoned dispatches nothing and shows a note,
  `t('intent.halt.garrisoned')` ("already holding from inside — right-click to leave the building"),
  tone `mute`, like `intent.halt.none`. No deny cue: `halt` with nothing selected plays none today,
  and the two stay alike.
- The HUD's Halt button calls the same `orders.halt`, so the key and the button cannot disagree
  (GH-153).

- [ ] **Step 1: Write the failing tests.** Extract the filter as a pure helper beside `haltNote`,
  `haltTargets(ids, isGarrisoned): number[]`, so it is testable without `main.ts`:
  - **"H halts the units outside and skips the garrisoned ones"**: three ids, one garrisoned; the
    result holds the other two.
  - **"an all-garrisoned selection halts nobody and says why"**: the result is empty, and `haltNote`
    returns the `intent.halt.garrisoned` note.
  - **"nothing selected still reads `intent.halt.none`"** (unchanged).
  - **A guard on the premise**, so it cannot rot unseen: build a `Sim`, garrison a squad, queue a
    `halt` for the ids `haltTargets` returns, tick once, and assert `garrisonedIn` is unchanged. The
    control queues a raw `halt` for the same id and sees it leave.
- [ ] **Step 2: Implement.** `orders.halt` builds `mine` as today, then
  `haltTargets(mine, (i) => sim.state.garrisonedIn[i] >= 0)`; it dispatches only when the result is
  non-empty, and notes through `haltNote`. The tutorial's `halt` awaits
  (`data/tutorial/beit_sahwan_0.json`) are unchanged: no beat garrisons the unit it halts.
- [ ] **Step 3: See it red.** Return `ids` unfiltered from `haltTargets`: the first two tests fail,
  and the guard sees the squad leave. Drop the garrisoned branch from `haltNote`: the second test
  fails.
- [ ] **Step 4: Gates**, as above. Quote `pnpm test`'s count in the commit.

---

## Task 2: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1: the ruling (Hold's sim command retired, 2026-10-11) and this change.
- [ ] `CLAUDE.md`, where the keymap and `halt` are described: H halts and never empties a building;
  leaving one is a move order.

---

## Re-pins

| pin | expected |
|---|---|
| sim pins (flat, relief, orders) | unchanged: no sim file |
| `pnpm balance`, `pnpm playtest` | unchanged: no harness presses an app key |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5917), `ROSTER_MAX` (30), `GATES` | unchanged |
| golden baseline | unchanged (R): no gated scenario presses H |
