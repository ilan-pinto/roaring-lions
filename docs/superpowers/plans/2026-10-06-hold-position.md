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

## Decisions

- **By the lead, 6 Oct:** as in "Why".
- **Taken defaults, accepted as written (PM, 6 Oct):** a rout releases Hold (H-D4), and the runtime
  decides when a rallied unit has arrived (H-D5).
  - **H-D1. Hold is `halt` plus two writes.** The `hold` branch does everything the `halt` branch
    does (`sim.ts`, the command loop), except leave a structure (see H-D3). It also sets
    `attackMove = 0` and `holdPos = 1`.
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
    has a placement stance `"hold_position"` (`mission.schema.json` ~L781, used by nine missions).
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
- **`LADDER_CREDITS` (5830), `CAMPAIGN_CREDITS`, `ROSTER_MAX` (31) and `GATES` are unchanged.**
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
| `packages/sim/src/sim.ts` | `{ kind: 'hold' }` in the `Command` union; the `holdPos` column; the `hold` branch; H-D2's clear; H-D4's clear in `startRout`; `stepSweep`'s explicit skip; `state.holdPos`; `hash()` | 1 |
| `packages/sim/src/hold.test.ts` | **New.** The Hold tests | 1 |
| `packages/sim/src/determinism.test.ts` | The re-pin and the hash-coverage test | 1 |
| `docs/superpowers/plans/2026-10-04-gf2-held-ground-income.md`, `…-gf4-camp-production.md`, `…-gf1-fire-support-intel.md` | Already reference Hold (6 Oct rulings); nothing to edit here | — |
| `packages/app/src/input/keymap.ts`, `input/intents.ts`, `main.ts`, `ui/hud.ts`, `ui/order-sight.ts`, `i18n/en.json` (+ tests) | Lane A: the binding, the intent, the button, the mark | 3 |
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
  - Add the `hold` branch beside `halt`.
  - At the head of the command loop, clear `holdPos[id]` for every id an order names, except
    `hold` itself (H-D2).
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
    `packages/app/src/input/keymap.ts` L36,
    `{ id: 'halt', label: 'keymap.halt', key: 'h', rebindable: true }`.
    - In `ACTIONS`, add `{ id: 'hold', label: 'keymap.hold', key: 'h', rebindable: true }`
      and change `halt`'s `key` to `'x'`.
    - X is free. The taken keys are h f g u o b m, ctrl+a, tab, space, f1, i, w s a d and escape;
      S is pan-down.
  - **`halt` stays.** It is a one-tick stop: it still cancels a move and drops queued waypoints.
    - It keeps its label: the strings are `keymap.halt` and `order.halt`, which read "Halt" in
      `en.json` on `b44df7aa`.
    - The ruling calls it "Stop"; no string changes either way.
  - **What re-pins with the defaults:**
    - `keymap.test.ts` pins the shipped letters ("ships the bindings main.ts had hard-coded, in
      the same letters") and the distinct-defaults test.
    - The settings rebind UI and its spec (`ui/settings-keymap.ts`, `settings-keymap.test.ts`) list
      every action.
    - `ACTIONS`' own comments enumerate "the whole of what was taken" three times; add x to each.
  - **Saved overrides.** `lions.settings` stores only overrides of the defaults
    (`overridesOf`/`bindingsFrom`), so a player who rebound `halt` keeps that key. A saved override
    that already put another action on X now collides with `halt`'s new default. `bindingsFrom`
    drops a colliding override, so that action falls back to its default key. Test that case and
    say so in the commit.
  - The keymap's conflict rules (`resolveKey`, `passesThroughModal`) apply unchanged.
- [ ] **Step 2: The intent.** `input/intents.ts` gains `{ kind: 'hold'; ids }` and queues the sim
  command, as `halt` does today (intents.ts ~L31, ~L80). `main.ts` dispatches it from the key and
  the button (today's `halt` dispatch is ~L2311).
- [ ] **Step 3: The button.**
  - A HUD order beside Halt in the order strip (`ui/hud.ts`, `ui/order-sight.ts`'s
    `ORDER_SIGHT`).
  - Its tooltip goes through `t('hud.order.tip.hold')`: "Stay here and fire at anything in range.
    Never advance."
  - The label goes through `t('keymap.hold')`.
- [ ] **Step 4: The mark.**
  - A held unit shows "holding" on its HUD unit card and its selection chip, as DOM beside the kit
    sign (`kitIconSignHtml`, `ui/kit-sign.ts`). It reads `sim.state.holdPos`.
  - **No mark in the world** (lead: no status marks in the world).
  - Semantic tokens only (`pnpm validate:ui`). Strings go through `t()`, and a pseudo capture
    shows no unbracketed word.
- [ ] **Step 5: The tutorial.** The economy step names Hold where it teaches holding ground (F2)
  and rallying (F4).
- [ ] **Step 6: See it red.** Put `halt` back on H: the distinct-defaults test fails, because two
  actions share H. Unbind Hold: the test that pins H → `hold` fails.

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
