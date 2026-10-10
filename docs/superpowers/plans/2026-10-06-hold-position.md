# Hold position: a player order that keeps units where they are. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit told to hold stays put and kneels. It fires at anything in range. It never
advances, chases or closes.

**Why (lead ruling, 6 Oct).** Since #402 an arrived attack-mover walks toward an identified enemy
it cannot reach, and toward a covered target in its band (the closing rule, `stepSweep`). Every
player right-click is an attack-move. `halt` does not stop the closing rule: it clears `moving`
but leaves `attackMove` set, so the unit is swept again on the next tick. The player therefore has
no order that keeps a unit in place.

The 6 Oct refresh of the Stage 4 plans raised four questions that share this root:
- F1, item 5: high ground;
- F2, item 11: held zones;
- F4, item 19: the rally point;
- F4, item 20: the enemy's rally.

The lead answered all four with one order:
- **Add a "Hold position" order:** hotkey H plus a HUD button.
- It is a sim command with a new flag, and it lands in Stage 4.
- The rally point (F4 D5) issues Hold on arrival, and so do the enemy's bought units.
- Held zones (F2) are kept by Hold.

**Architecture:**
- **One command and one per-unit column in `@lions/sim`.** `{ kind: 'hold'; ids }` sets a new
  `holdPos` flag and clears `attackMove`. Clearing `attackMove` is what takes the unit out of
  `stepSweep`. The flag makes the state readable (HUD, runtime). It is also the line every future
  auto-move system checks.
- **Nothing else in the sim changes.** A held unit is a stationary unit, so `stepBrace` already
  kneels it, and `stepCombat` already selects and fires at targets in weapon range.
- **The flag is hashed.** Both sim pins move once, for the new column only, as #291's do.
- **Consumers:**
  - F2: held zones;
  - F4: Hold on arrival at a rally point, and the enemy's bought units;
  - F1: a unit kept on a rise.
- **The UI half is Lane A** (WP-S-F #184): the H binding, the button, and the "holding" mark on
  the unit card and selection chip.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- The lead's ruling of 6 Oct, recorded in the four plans' "For the lead" lists (PR #413).
- `docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md` §2–§3: the brace machine and the
  closing rule.
- `docs/superpowers/plans/2026-09-29-stage4-sim-fixes.md`, Task 4: the hashed-column re-pin
  pattern this plan copies.
- `docs/superpowers/plans/2026-10-04-stage4-order.md`: where this lands.

**Base:**
- Written 6 Oct against `main` `b44df7aa`.
- Branch `feat/hold-position`, cut from `main` after #291 (and #247, if that re-pins) has landed.
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift.
- Nothing here is measured. Every (R) is reasoned, and its task says how to measure it.

---

## Pre-flight, 11 Oct (against main f2d5d9e8)

Read and grepped, not run. Corrections are made in place below. Rows marked "question" wait on the
list under the table.

**Landed since `b44df7aa` that touches this plan:**
- **Sim pins unchanged:** flat `922714084`, relief `3200430224` (`determinism.test.ts`, read 11 Oct).
  `packages/sim` changed only in `mission.ts` (#431, `razeExempt`); `sim.ts` is untouched.
- **`LADDER_CREDITS` and `CAMPAIGN_CREDITS` are 5870** (#431: 5830 to 5868; #444: 5868 to 5870).
- **#427 / #428 / #445:** the cursor reads `advance-*`, feed lines are tiered, and the chip and card
  carry combat-state words. Two of those words are "holding" (row 8).
- **#454 chrome register:** lime `--on` is for a live mission state only (armed button, speed chip).
- **#426 cues and #497/#499 voice:** `ui/cues.ts` is exhaustive over `MissionEvent`. A new order verb
  needs voice keys or a stated silence.
- **#488 tutorial beats:** `data/tutorial/beit_sahwan_0.json` names H and awaits a `halt` intent in
  three places (row 12). The ruling breaks it unless Task 3 edits it.
- **GH-254 telemetry and GH-464 replay:** `dispatch` fans out to `telemetry/events.ts`'s exhaustive
  `orderVerbOf` and to `replayLog.record`.

| task | what changed | fixed in place / question |
|---|---|---|
| 3, Step 1 | The `halt` row is at `keymap.ts` ~L43, not L36. Its three "whole of what was taken" comments are on `jumpToAlert`, `keysOverlay` and `idleNext`; each already lists space, f1 and i. | fixed |
| 3, Step 1 | Tests that pin H to `halt` and re-pin: `keymap.test.ts` (the shipped-letters test, `resolveKey` 'H', the `bindingsFrom` fall-back cases with `halt: 'f'` / `'3'`, and `rebind(…'jumpToAlert','h')` taken by `halt`); `settings-keymap.test.ts` (the "Halt" row reads 'H' and `.halt` is 'h', ~L150–195); `keys-overlay.test.ts` is rebind-based and stays green. | fixed |
| 3, Step 1 | A saved override collides in **both** directions. `smoke: 'x'` now loses to `halt`'s default X. `smoke: 'h'` (possible only for a player who had moved `halt` off H) now loses to Hold's default H. `bindingsFrom` drops either to the default; the player is not told. | fixed (test both) |
| 1, Step 2 | `halt` is the final bare `else` of the `applyCommands` chain (after `chargeTunnel`), not a `kind === 'halt'` branch. A new `hold` kind falls into it unless `else if (cmd.kind === 'hold')` is placed **before** it. `reveal` and `callStrike` carry no `ids`: H-D2's clear needs `'ids' in cmd` (the buried-unit scan above uses the same guard). | fixed |
| 1, Step 2 | `halt` clears `garrisonGoal` but not `boardGoal`, `demolishOrder` or `chargeOrder`. `stepTransport`, `stepDemolition` and `stepTunnelCharge` re-set `moving` from those latches (the comment at the tunnel-burial block says so). A held demolisher or boarder would walk on. | question 8 |
| 1 | `mission.ts` `stepPatrols` queues a `halt` for a patroller that halts to fire (~L1558). Under H-D2 that clears `holdPos`. Patrollers are never held today; F4's enemy rally units are not patrollers. No change. | noted |
| 3, Step 2 | `main.ts`: `orders.halt` is at ~L2559 and the key switch `case 'halt'` at ~L3864 (the plan said ~L2311). `OrderHandlers` is `Record<OrderId, () => void>` (`ui/hud.ts` ~L250), so a new `OrderId` forces `orders.hold`. | fixed |
| 3, Step 2 | Exhaustive switches on `PlayerIntent['kind']` that a new `hold` kind breaks at `tsc`: `input/cursor.ts` `idsOf` (the `halt` case, ~L280), `telemetry/events.ts` `orderVerbOf`, and `INTENT_KINDS` with its three pins (`intents.test.ts`, `tutorial/steps.test.ts`, `telemetry/events.test.ts` `sample()` and the verb map). | fixed |
| 3, Step 3 | The button is not in `hud.ts` alone. `OrderId` and `ORDERS` are in `ui/selection-model.ts`; `SelectionFacts` needs a `holding` count and Hold is inert when every selected unit already holds. A new order sight touches `order-sight.ts` (`SightOrderId`, `ORDER_SIGHT`, `SURROUND`, `ORDER_MARK_BOUNDS`), `ui/symbol.ts` (`ORDER_IDS`) and `symbol.test.ts`'s count of 35. | fixed; art is question 3 |
| 3, Step 4 | The word "holding" is taken three times. `selection.chip.holding` is the chip's idle fall-through (`chipStatus` in `selection-model.ts`). `hud.card.holdingPosition` is the card's idle line (`hud.ts` ~L2357). `hud.fire.holdingFire` is a pinned shooter. A Hold-ordered unit would read the same as a unit nobody ordered. | question 4 |
| 3, Step 4 | Status tone. `ChipTone` is `bad`, `hot` or null; lime is a live mission state (#454). Hold is a unit state, so it takes null (plain `--ink-dim`), like "moving" and "aboard". It sits after `moving` in `chipStatus`'s precedence. | fixed |
| 3, Step 5 | The tutorial names H today and the ruling breaks it. `beit_sahwan_0.json`: the `advance` beat says "H halts them"; `identify_then_shoot` awaits `intent: halt` (all_of) and its text and nudge say "Press H"; `what_a_shot_costs` awaits `any_of [halt, order]`, text and nudge say "press H". After Task 3, H queues `hold`, so those beats never complete. | fixed (Step 5 rewritten) |
| 3, Step 5 | Tools that press H and expect a halt: `tools/src/ui-review/routes-check.ts` ~L1582 (`voices (a)` asserts `trigger === 'halt'`; `pnpm ui:routes` runs in CI) and `tools/src/perf/fire-link-captures.ts` ~L175. | fixed (new step 6) |
| 3 | Voice. `OrderVerb`, `ORDER_VERBS` and `COMMON_VERBS` (`voice/lines.ts`) and `gestureVerb`'s last rung (`voice/director.ts`, `pick('halt','halt')`). `he.common.halt` and `ar.common.halt` exist in `data/audio.json` with empty `variants`: silent until recorded. Hold takes the same path. | fixed (new step 7) |
| 3 | `ui/idle.ts` `isIdle`: a held unit is stationary with no target, so `idleNext` (I) would walk the player through every held unit. | question 5 |
| 3 | Telemetry. `orderVerbOf` must map `hold`. `TELEMETRY_ORDER_VERBS` (`packages/data/src/telemetry.ts`) and the `orderVerb` enum in `data/schemas/telemetry_event.schema.json` carry eleven verbs; the Worker's stats page is generated from the list. | question 6 |
| 3 | Cues (#426). A refused order plays `ui.deny` (`CRITICAL_CUES.uiDeny`); `confirm` is for primary actions only. Today `orders.halt` with nothing selected shows `haltNote` and plays nothing. | question 7 |
| Decisions, H-D7 | The `"hold_position"` stance enum is at `mission.schema.json` ~L791, not ~L781. Nine mission files use it (counted). Still read by no runtime code. | fixed |
| Global | `LADDER_CREDITS` 5830 is 5870. | fixed |
| Global | The L1 open decision (move-only Move chip on V, `commercial-polish-audit.md`) shares the row. If it lands, the row reads Attack-move, Move (V), Hold (H), Halt (X). `selection-model.test.ts` pins the row ids and order. | noted |

### For the lead (continues "For the lead" below)

3. **Hold's order mark.** An order's picture is the lead-approved sheet (G1 round 5, 35 symbols). Hold
   needs one. **Recommended:** a new `hold` sight in the `control` family beside `halt`, mocked at the
   chip size and the cursor size before Task 3 Step 3 starts, on the lead's picture gate. The fallback
   is the `halt` mark on both buttons, which two adjacent buttons make unreadable.
4. **The state words.** **Recommended:** a Hold-ordered unit reads "{n} on hold" on the chip and
   "on hold" on the card. The two idle fall-throughs are renamed to "standing" (chip) and "standing"
   (card), because they also cover a stationary unit that is shooting. `hud.fire.holdingFire` stays.
5. **Idle finder.** **Recommended:** a held unit is not idle (`IdleFacts` gains `holding`), the same
   rule that excludes a garrisoned or carried unit.
6. **Telemetry.** **Recommended:** add `hold` as a twelfth verb (the data package, the schema enum,
   `orderVerbOf`, the stats columns). It is the only evidence of whether players use the order. The
   Worker and the app deploy together, so no client sends a verb the Worker rejects.
7. **Deny cue.** **Recommended:** Hold with nothing selected shows a note and plays `ui.deny`, and
   `halt` gets the same one-line change, so the two keys agree.
8. **H-D1 amended.** **Recommended:** `hold` also clears `boardGoal`, `demolishOrder` and `chargeOrder`
   (the latches the tunnel-burial block clears), with a test for a held demolisher. H-D1 as ruled
   says "`halt` plus two writes", which leaves those three standing.

---

## Decisions

- **By the lead, 6 Oct:** as in "Why".
- **Taken defaults, accepted as written (PM, 6 Oct):** a rout releases Hold (H-D4), and the runtime
  decides when a rallied unit has arrived (H-D5).
  - **H-D1. Hold is `halt` plus two writes.** The `hold` branch does everything the `halt` branch
    does (`sim.ts`, `applyCommands`, where `halt` is the final bare `else`), except leave a structure
    (see H-D3). It also sets `attackMove = 0` and `holdPos = 1`. Pre-flight question 8 proposes a
    third write: clear `boardGoal`, `demolishOrder` and `chargeOrder`.
  - **H-D2. Any other order that names the unit clears `holdPos`**, whatever the order: `move`,
    `attackMove`, `halt`, `garrison`, `load`, `unload`, `demolish`, `chargeTunnel` or `smoke`. A
    held unit is released by the next order, never by time.
  - **H-D3. Hold keeps a garrisoned unit inside.** It does not call `leaveStructure`, and the unit
    holds from its window. On a carried or buried unit, Hold is a no-op: it is in no position to
    hold.
  - **H-D4. A held unit still routs (GDD §5.5a), and the rout clears `holdPos`.** Morale outranks
    the order. A unit that rallies 6 tiles from its post is no longer holding it, and the player
    re-issues Hold.
  - **H-D5. "Arrival" for F4's rally is the runtime's reading, not a sim flag.** F4's runtime keeps
    the ids it sent to a rally point. On the first tick that one reads `moving === 0`, the runtime
    queues `hold` for it. The alternative is a `move` flag `holdOnArrival` that the sim applies in its
    arrival branch: a second sim surface for the same result.
  - **H-D6. Hold applies to every unit type, vehicles included.** The closing rule sweeps vehicles
    too (`stepSweep` is not foot-only).
  - **H-D7. Names.** The column is `holdPos`, not `holding`: the sim already has a `holdingFire`
    shot result (pinned shooters), and the two must not be confused. The mission schema already
    has a placement stance `"hold_position"` (`mission.schema.json` ~L791, used by nine missions).
    No runtime code reads it: a spawned unit is idle with `attackMove` 0 anyway. It is left as is.
    Wiring it to `holdPos` is a later content decision, behaviour-neutral today (R).

---

## Global Constraints

- **The four invariants hold.**
  - `holdPos` is a `Uint8Array`, zeroed in `spawn`.
  - No floating point, no `rng`, no `eslint-disable`.
  - The runtime issues `hold` through `queueCommand`; nothing outside the sim writes `holdPos`. It
    is read-only on `sim.state`, like `brace`.
- **The sim pins move once**, in Task 1, for the new hashed column only. At `b44df7aa` they read
  flat `922714084` and relief `3200430224`; #291 moves them first. Prove the re-pin is only the
  column (Task 1, Step 4).
- **`pnpm balance`** is byte-identical (R): `targets.ts` issues no `hold`.
- **`pnpm playtest`** is byte-identical (R): no plan issues `hold` until F2 or F4 makes one.
- **`LADDER_CREDITS` (5870), `CAMPAIGN_CREDITS` (5870), `ROSTER_MAX` (31) and `GATES` are unchanged.**
- **Every check is seen red** by a one-line mutation, quoted in the commit.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm balance` and `pnpm playtest`. Add `pnpm validate:ui` for Task 3.
- **Git:** `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`,
  never `pkill` vite. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  The lead merges.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | `{ kind: 'hold' }` in the `Command` union; the `holdPos` column; an `else if (cmd.kind === 'hold')` branch placed before `halt`'s final `else`; H-D2's clear (guarded by `'ids' in cmd`); H-D4's clear in `startRout`; `stepSweep`'s explicit skip; `state.holdPos`; `hash()` | 1 |
| `packages/sim/src/hold.test.ts` | **New.** The Hold tests | 1 |
| `packages/sim/src/determinism.test.ts` | The re-pin and the hash-coverage test | 1 |
| `docs/superpowers/plans/2026-10-04-gf2-held-ground-income.md`, `…-gf4-camp-production.md`, `…-gf1-fire-support-intel.md` | Already reference Hold (6 Oct rulings); nothing to edit here | — |
| `packages/app/src/input/keymap.ts`, `input/intents.ts`, `input/cursor.ts` (`idsOf`), `main.ts`, `ui/selection-model.ts` (`ORDERS`, `OrderId`, `SelectionFacts`, `chipStatus`), `ui/hud.ts` (`renderOrders`, the card's condition line), `ui/order-sight.ts` and `ui/symbol.ts` (the sight, if question 3 is yes), `ui/idle.ts`, `voice/lines.ts`, `voice/director.ts`, `telemetry/events.ts`, `i18n/en.json` (+ tests) | Lane A: the binding, the intent, the button, the mark, the voice verb | 3 |
| `data/audio.json`, `data/tutorial/beit_sahwan_0.json`, `packages/data/src/telemetry.ts` and `data/schemas/telemetry_event.schema.json` (if question 6 is yes) | `he.common.hold` and `ar.common.hold` declared empty; the tutorial beats; the twelfth telemetry verb | 3 |
| `tools/src/ui-review/routes-check.ts` (~L1582), `tools/src/perf/fire-link-captures.ts` (~L175) | The H keypress that expected a halt | 3 |
| `docs/HANDOVER.md`, `CLAUDE.md` (Dev instruments: the order) | Ledger | 4 |

---

## Task 1: the `hold` command (**a sim re-pin**)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** #291 on `main`.

**Interfaces (produced):**

```ts
// sim.ts
| { kind: 'hold'; ids: number[] }            // Command union
private readonly holdPos: Uint8Array;        // 1 while the unit holds position (H-D1..H-D4)
// state view: readonly holdPos (read-only, like brace)
// hash(): hashArray(h, this.holdPos), next to the brace columns
```

- [ ] **Step 1: Write the failing tests** in the new `hold.test.ts`. Use in-test fixtures with
  `role: 'infantry'`: a type with no `role` derives as wheeled and never braces. Add one vehicle
  fixture for H-D6. Tests:
  - **"a held unit kneels and fires at an enemy in range"**: after `KNEEL_DROP_TICKS` it reads
    `BRACE_KNEELING`, and a `fire` event follows.
  - **"a held unit does not walk toward an identified enemy it cannot reach"**. This is the
    `sweep-out-of-reach.test.ts` layout with `hold` in place of the arrived attack-move. Position is
    unchanged after 20 s. That file's own test is the control and must stay green.
  - **"a held unit does not close on a covered target in its band"**.
  - **"a held unit does not walk to a last-seen position"** (the pre-#402 sweep).
  - **"a held vehicle does not chase either"** (H-D6).
  - **"any other order releases it"** (H-D2): `move`, then `attackMove`, then `halt`; each reads
    `holdPos` 0.
  - **"a held unit still routs, and the rout releases it"** (H-D4).
  - **"hold keeps a garrisoned unit inside"** (H-D3).
- [ ] **Step 2: Implement.**
  - Add the `hold` branch **before** `halt`'s final bare `else` in `applyCommands`; placed after it, or
    left out of the chain, a `hold` command silently runs as a halt.
  - At the head of the command loop, clear `holdPos[id]` for every id an order names, except
    `hold` itself (H-D2). Guard with `'ids' in cmd`: `reveal` and `callStrike` carry no ids.
  - Clear it in `startRout` (H-D4).
  - Add an explicit `if (this.holdPos[i] === 1) continue;` to `stepSweep`. With `attackMove` 0 the
    unit is already skipped; the check says why, and guards a later edit.
  - Fold the column into `hash()`.
- [ ] **Step 3: Hash coverage.** In `determinism.test.ts`, add **"hash covers holdPos"**: flip one
  element through `sim.state` and expect a different `hash()`.
- [ ] **Step 4: Prove the re-pin is only the column.** Delete the `hashArray` line temporarily. Both
  pins must read the branch base's values (`main` after #291). Restore the line. **Undo the edit,
  never `git checkout` the file.**
- [ ] **Step 5: Re-pin both sim pins** in this commit. Each gets a dated comment: "Hold position (lead,
  6 Oct): one per-unit column, `holdPos`, joins the hash. No behaviour moved: with its `hashArray`
  line removed, both replays reproduce the old value. Was N."
- [ ] **Step 6: Gates.** `balance` and `playtest` byte-identical (R). Quote both in the commit.
- [ ] **Step 7: See it red.**
  - Leave `attackMove` set in the `hold` branch: "does not walk toward an identified enemy" fails.
  - Skip H-D2's clear: "any other order releases it" fails.
  - Skip `startRout`'s clear: the rout test fails.
  - Delete the `hashArray` line: "hash covers holdPos" fails.

---

## Task 2: the consumers, by reference

No code in this plan. Each consumer lands with its own plan and cites this one:
- **F1 (high ground, D4):** a unit kept on a rise by Hold stays and is paid. F1 Task 5 pins both the
  attack-mover that walks off and the held unit that stays. F1 lands after this plan, so the held
  case is testable.
- **F2 (D3):** held zones are kept by Hold. F2's fixtures and its Task 8 world walk use `hold` for
  holders.
- **F4 (D5, Task 9):** the runtime queues `hold` for a rallied unit when it arrives (H-D5). The
  enemy's bought units do the same at their `rally` marker. A trigger's `commit` (an attack-move)
  releases them (H-D2).

---

## Task 3: Lane A, the order in the UI (WP-S-F #184)

**Agent:** lane A. **Depends:** Task 1 on `main`. S-F trails Lane C by one landing.

- [ ] **Step 1: The binding (ruled 6 Oct).**
  - **Hold takes H, and `halt` moves to X.** H is `halt`'s key today:
    `packages/app/src/input/keymap.ts`, `{ id: 'halt', label: 'keymap.halt', key: 'h', rebindable: true }`
    (~L43, first row of `ACTIONS`).
    - In `ACTIONS`, add `{ id: 'hold', label: 'keymap.hold', key: 'h', rebindable: true }`
      and change `halt`'s `key` to `'x'`. Add `'hold'` to the `Action` union.
    - X is free. The taken keys are h f g u o b m, ctrl+a, tab, space, f1, i, w s a d and escape;
      S is pan-down. V is free and is where L1's Move chip would go (`docs/polish/commercial-polish-audit.md`,
      "Lead decisions", still open).
  - **`halt` stays.** It is a one-tick stop: it still cancels a move and drops queued waypoints.
    - It keeps its label: the strings are `keymap.halt` and `order.halt`, which read "Halt" in
      `en.json` on `f2d5d9e8`.
    - The ruling calls it "Stop"; no string changes either way.
  - **What re-pins with the defaults:**
    - `keymap.test.ts` pins the shipped letters ("ships the bindings main.ts had hard-coded, in
      the same letters"), `resolveKey` 'H' to `halt`, the `bindingsFrom` fall-back cases written with
      `halt: 'f'` / `'3'`, `rebind(…, 'jumpToAlert', 'h')` taken by `halt`, and the distinct-defaults test.
    - The settings rebind UI and its spec (`ui/settings-keymap.ts`, `settings-keymap.test.ts`: the
      "Halt" row reads 'H' and `.halt` is 'h' at ~L150–195) list every action.
    - `ACTIONS`' own comments enumerate "the whole of what was taken" three times (on `jumpToAlert`,
      `keysOverlay` and `idleNext`); add x to each. F1's card and the Controls rows are built from
      `PLAYER_ACTIONS`, so `hold` appears in both with a `keymap.hold` string and nothing else.
  - **Saved overrides.** `lions.settings` stores only overrides of the defaults
    (`overridesOf`/`bindingsFrom`), so a player who rebound `halt` keeps that key. `bindingsFrom`
    drops a colliding override, so that action falls back to its default key. Two collisions are new:
    a saved override that put another action on X now collides with `halt`'s default, and one that put
    another action on H (possible only for a player who had moved `halt` off H) now collides with
    Hold's. Test both and say so in the commit.
  - The keymap's conflict rules (`resolveKey`, `passesThroughModal`) apply unchanged.
- [ ] **Step 2: The intent.**
  - `input/intents.ts` gains `{ kind: 'hold'; ids }` in `PlayerIntent` and in `INTENT_KINDS`, and
    queues the sim command as `halt` does today (`applyIntent`, ~L31, ~L80). `intents.test.ts` pins
    `INTENT_KINDS` against the union.
  - Every exhaustive switch on the kind needs a `hold` case or `tsc` fails: `input/cursor.ts` `idsOf`
    (the `halt` case, ~L280), `telemetry/events.ts` `orderVerbOf` (see question 6), and the `sample()`
    and verb map in `telemetry/events.test.ts`. `tutorial/steps.test.ts` cross-checks the tutorial's
    intent names against `INTENT_KINDS`.
  - `main.ts`: `orders.halt` is at ~L2559 and the key switch `case 'halt'` at ~L3864. Add `orders.hold`
    (`OrderHandlers` is `Record<OrderId, () => void>`, so it is required) and `case 'hold'`. Select
    `side === 0` units as `orders.halt` does. With nothing selected, show the note and play `ui.deny`
    (question 7); the confirm cue is for primary actions only.
- [ ] **Step 3: The button.**
  - **The order row.** `OrderId` and `ORDERS` live in `ui/selection-model.ts`. Add `hold` beside
    `halt`: `{ id: 'hold', label: 'order.hold', key: 'hold' }`. `SelectionFacts` gains a `holding`
    count (read from `sim.state.holdPos` in `ui/hud.ts`'s `renderOrders`). Hold is always shown, and
    inert when every selected unit already holds (`inertReason` `hud.order.inert.hold`).
    `selection-model.test.ts` pins the row ids and order; re-pin it.
  - **The mark.** An order's picture is the lead-approved sheet, so a `hold` sight needs the lead's
    approval first (question 3). If yes: add it to `SightOrderId`, `ORDER_SIGHT` (`control` family),
    `SURROUND`, `ORDER_MARK_BOUNDS` (`ui/order-sight.ts`), `ORDER_IDS` (`ui/symbol.ts`), and re-pin
    `symbol.test.ts` (35 ids) and `order-sight.test.ts`.
  - Its tooltip goes through `t('hud.order.tip.hold')`: "Stay here and fire at anything in range.
    Never advance." The label goes through `t('keymap.hold')`.
- [ ] **Step 4: The state words.**
  - A held unit reads "on hold" on its chip and its HUD unit card (question 4), as DOM beside the kit
    sign (`kitIconSignHtml`, `ui/kit-sign.ts`). It reads `sim.state.holdPos`.
  - **The chip.** `chipStatus` (`ui/selection-model.ts`) takes a `holding` count. It sits after
    `moving` in the precedence and before the idle fall-through; tone null (plain `--ink-dim`). Lime
    `--on` is for a live mission state only (#454, `chrome-register.test.ts`), and a unit state is not
    one. `UnitFacts` gains `holding`.
  - **The card.** `hud.ts` ~L2357 prints `hud.card.holdingPosition` ("holding position") for any unit
    with no flags. That is the idle line today. A held unit gets its own line; the idle line is renamed
    (question 4).
  - **No mark in the world** (lead: no status marks in the world).
  - Semantic tokens only (`pnpm validate:ui`). Strings go through `t()`, and a pseudo capture
    shows no unbracketed word.
- [ ] **Step 5: The tutorial.** `data/tutorial/beit_sahwan_0.json` names H and awaits a `halt` intent,
  and after Step 1 the H key queues `hold`.
  - `advance` ("H halts them"): "H holds them where they stand."
  - `identify_then_shoot`: replace `{ intent: "halt" }` inside the `all_of` with an `any_of` of
    `hold` and `halt`. The text and nudge ("Press H") stay true, and H now does the thing the beat
    asks for, which the polish audit's PA-12 found `halt` could not do under the closing rule.
  - `what_a_shot_costs`: the existing `any_of [halt, order]` gains `hold`.
  - `tutorial/lessons.test.ts` and `tools/src/tutorial_lessons_world.test.ts` drive these beats with
    `halt` intents and stay green; add a `hold` case to each and see it red by removing `hold` from the
    `any_of`.
  - The economy step names Hold where it teaches holding ground (F2) and rallying (F4).
- [ ] **Step 6: Tools that press the key.** `tools/src/ui-review/routes-check.ts` (~L1582, `voices (a)`
  presses `h` and asserts `trigger === 'halt'`; it runs in CI via `pnpm ui:routes`, so do not run it
  locally) and `tools/src/perf/fire-link-captures.ts` (~L175, "Halt it through the real hotkey"). Both
  press `x` after Step 1. Do not run either locally.
- [ ] **Step 7: The voice.**
  - `voice/lines.ts`: add `hold` to `OrderVerb`, `ORDER_VERBS` and `COMMON_VERBS`; `allLineKeys` then
    asks for `he.common.hold` and `ar.common.hold`. `voice/director.ts` `gestureVerb`'s last rung
    gains `pick('hold', 'hold')`.
  - `data/audio.json`: declare both keys with empty `variants`. That is "silent until recorded", the
    state `he.common.halt` is in today; `lines.test.ts` holds the file to the key set and
    `pnpm validate:audio` checks the shape. The lead records the Hebrew line (#499); no placeholder
    audio ships.
- [ ] **Step 8: See it red.** Put `halt` back on H: the distinct-defaults test fails, because two
  actions share H. Unbind Hold: the test that pins H to `hold` fails. Drop `hold` from the tutorial's
  `any_of`: the new lessons case fails.

---

## Task 4: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1 and §3: the ruling, H-D1–H-D7 as accepted (6 Oct), the keys, and the new pin values.
- [ ] `CLAUDE.md` "Dev instruments": one line on Hold and what it does to the closing rule.
- [ ] Record the keys where the keymap is described: Hold on H, `halt` on X (ruled 6 Oct).

---

## Re-pins

| pin | expected | reason |
|---|---|---|
| sim pins, flat and relief | **moved once**, Task 1 | one hashed per-unit column, `holdPos` |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical (R) | — |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` / `ROSTER_MAX` / `GATES` | unchanged | — |

## For the lead

Items 3 to 8 are in "Pre-flight, 11 Oct" above.

1. **H is `halt`'s key today.** The ruling gives H to Hold. Should `halt` move to another key or be
   retired? Under the closing rule it holds an attack-mover for one tick, so it does little the
   player can see.
   **Ruled 6 Oct:** Hold takes H, and `halt` moves to X with its label unchanged. `halt` is kept as
   a one-tick stop that still cancels a move. The settings rebind UI and the keymap test re-pin
   (Task 3, Step 1).
2. **Confirm H-D1–H-D7**, chiefly:
   - H-D4: a rout releases Hold;
   - H-D5: the runtime, not the sim, decides "arrived".

   **Ruled 6 Oct:** H-D1 to H-D7 accepted as written. A rout releases Hold, and the runtime decides
   when a rally has arrived.
