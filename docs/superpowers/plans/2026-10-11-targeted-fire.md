# Targeted fire: a right-click on an enemy shoots that enemy (GH-420, PA-08). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit ordered to fire on an enemy shoots that enemy whenever its main weapon can, closes to
range if it cannot, and falls back to its own choice of target when the enemy is gone.

**Why (lead, 6 Oct; GH-420).** The polish audit's PA-08: every right-click is an `attackMove` to a
tile (`input/intents.ts` `resolvePointer`), and the sim's `selectTarget` picks what each unit shoots.
A clicked AA gun truck read "Engaging: Militia Cell". #427 (WP-P4) made the presentation honest: the
cursor over an enemy reads `advance-*`, and the fire panel ends with `hud.fire.clickAdvances` ("each
unit picks its own target"). The lead approved a real order on 6 Oct. It is a sim command, so it lands
in Stage 4.

**Architecture:**
- **One command and one per-unit column in `@lions/sim`.** `{ kind: 'attack'; ids; target }` sets a
  new `focusTarget` (`Int32Array`, -1 = none) and clears `attackMove`.
- **`selectTarget` prefers the focus.** For each weapon slot, a focus the weapon can engage (range,
  minimum range, sight line or indirect, air/ground, identified) is returned before the scan. Otherwise
  the scan runs exactly as today.
- **A new `stepFocus` owns the focused unit's movement.** It runs before `stepSweep` in `tick()`. While
  the focus is valid and out of reach of slot 0, the unit's goal is the target's tile. In reach, the unit
  stops, and `stepBrace` kneels it as for any stationary shooter. When the focus ends, the unit becomes
  an arrived attack-mover where it stands (`attackMove = 1`, `moving = 0`), which is what every
  right-click leaves today.
- **The column is hashed.** Both sim pins move once, for the column only, as Hold's do. No balance
  plan and no playtest plan issues `attack`, so both stay byte-identical (R).
- **The UI half is Lane A** (WP-S-F #184): the right-click branch, the `attack` cursor name coming
  back, the fire panel line, the unit card line, the tutorial beats.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-420; `docs/polish/commercial-polish-audit.md` PA-08, PA-12; L1 decided (lead, early Oct): no move-only order.
- PR #427 (WP-P4): the `advance` cursor, `hud.fire.clickAdvances`, `input/pointer.ts` `pointerPoint`.
- `docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md` §2–§3: the brace machine and the
  closing rule (`stepSweep`).
- `docs/superpowers/plans/2026-10-06-hold-position.md`: the hashed-column re-pin pattern, H-D2.
- `docs/superpowers/plans/2026-10-04-stage4-order.md`: where this lands.

**Base:**
- Written 11 Oct against `main` `f2d5d9e8`.
- Branch `feat/targeted-fire`, cut from `main` after Hold position has landed.
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift (`selectTarget` ~L3299, `stepCombat` ~L3611, `stepSweep`
  ~L5174, `tick()` ~L1846, `applyCommands` ~L2029 in `sim.ts` at `f2d5d9e8`).
- Nothing here is measured. Every (R) is reasoned, and its task says how to measure it.

---

## Decisions

Taken defaults, for the lead to confirm (For the lead, item 1):

- **T-D1. Units only, not structures.** A click on a building already resolves to garrison, demolish
  or an attack-move onto it (`resolvePointer`'s structure branch, #427's `pointerPoint`). Firing on a
  protected site still needs Alt. Structures are out of scope.
- **T-D2. Only an identified enemy can be the focus.** The command is refused per id (no-op) when the
  target is dead, on the issuer's side, a civilian (side 2), garrisoned, carried or buried, or below
  `IDENTIFIED_AT` for the issuer's side. `selectTarget` applies the same filter every tick, so a
  target that goes into a building or a tunnel stops being shot at once.
- **T-D3. The focus ends when it can no longer be valid**: the target dies, boards, garrisons or goes
  under; or its side's contact on it stays below `IDENTIFIED_AT` for `FOCUS_LOST_TICKS` (tuning.ts,
  proposed 100 = 5 s). While lost, the unit walks to the target's last-seen position, as the sweep
  does. A target that is identified again inside the window keeps the order.
- **T-D4. When the focus ends, the unit is an arrived attack-mover where it stands.** It then follows
  the closing rule like any right-clicked unit. **Except a held unit (T-D8): its focus ends and it is
  still held, standing where it was.**
- **T-D5. Slot 0 decides reach; slot 1 shares the focus only if it can hurt it.** "In reach" is slot
  0's effective range and sight line (indirect classes need no sight line), the same rule the
  `engaging` latch uses. Slot 1 takes the focus when `hurts` (`selectTarget`'s own heuristic) holds,
  and otherwise selects its own target. A tank's coax keeps shooting infantry while its gun is on the
  ordered APC.
- **T-D6. Goal refresh by tile, not by tick.** `stepFocus` recomputes the field only when the
  target's tile differs from the stored goal tile, so a chase costs one `fieldFor` per tile the target
  crosses. Fields come from the bounded pool (`MAX_FLOW_FIELDS`, LRU). No per-unit A*.
- **T-D7. A unit no weapon of which can engage the target gets the attack-move it gets today.** The
  sim refuses `attack` for it (T-D2's filter plus `couldEngage`); the app sends the rest of the
  selection an `attackMove` to the target's tile in the same click (Task 3). A rifle squad does not
  chase a helicopter.
- **T-D8. Hold and targeted fire (RULED by the lead, 11 Oct; reverses the recommendation).** A unit on
  Hold that is given `attack` **stays on Hold**. `attack` is the one order H-D2 does not release on.
  - If the target is already in reach of slot 0 (range and sight line; indirect needs no sight line),
    `focusTarget` is set, `holdPos` stays 1, and the unit fires on it. It never moves.
  - If not, the order is **refused** for that unit: `focusTarget` stays -1, `holdPos` stays 1, the unit
    stays put, and the app shows a reason line, `intent.holdOutOfRange` ("On hold — target out of
    range"), with the deny cue.
  - While held and focused, `stepFocus` never sets `moving`. If the focus leaves reach, is lost or dies,
    the focus ends (-1) and the unit is still held (T-D4's exception).
- **T-D9. Not queueable in v1.** Shift+right-click on an enemy keeps today's behaviour, an appended
  attack-move to its tile. The waypoint queue (`wpX`/`wpY`/`wpAttack`) is not extended.
- **T-D10. The AI never issues `attack` in v1.** No mission trigger, no enemy director, no balance plan.

---

## Global Constraints

- **The four invariants hold.**
  - `focusTarget` is an `Int32Array` set to -1 in `spawn`; `focusLostTicks` (if a counter is needed
    for T-D3) is a `Uint8Array`/`Uint16Array` zeroed in `spawn`.
  - No floating point, no `rng`, no `eslint-disable`. `FOCUS_LOST_TICKS` lives in `tuning.ts`.
  - The app issues `attack` through `queueCommand`; nothing outside the sim writes `focusTarget`. It is
    read-only on `sim.state`, like `brace` and `holdPos`.
- **The sim pins move once**, in Task 1, for the new hashed column(s) only. At `f2d5d9e8` they read
  flat `922714084` and relief `3200430224`; #291 and Hold position move them first. Prove the re-pin
  is only the column (Task 1, Step 5).
- **`pnpm balance`** is byte-identical (R): `targets.ts` issues no `attack`.
- **`pnpm playtest`** is byte-identical (R): no plan issues `attack`.
- **`LADDER_CREDITS` (5870), `CAMPAIGN_CREDITS` (5870), `ROSTER_MAX` (31) and `GATES` are unchanged.**
- **Every check is seen red** by a one-line mutation, quoted in the commit.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm balance` and `pnpm playtest`. Add `pnpm validate:ui` and `pnpm validate:data` for Task 3
  and Task 4.
- **Never run `pnpm ui:routes`, `golden-baseline` or `ui:shots` locally**; CI runs them. Browsers start
  with music off (`musicOffInitScript()`); never port 5177; never `pkill`.
- **Git:** `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`.
  Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The lead merges.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | `{ kind: 'attack' }` in the `Command` union; `focusTarget` (and the lost counter); the `attack` branch in `applyCommands`; the focus preference in `selectTarget`; `stepFocus` in `tick()`; `stepSweep`'s skip; `state.focusTarget`; `hash()` | 1, 2 |
| `packages/sim/src/tuning.ts` | `FOCUS_LOST_TICKS` | 2 |
| `packages/sim/src/focus.test.ts` | **New.** The targeted-fire tests | 1, 2 |
| `packages/sim/src/determinism.test.ts` | The re-pin and the hash-coverage test | 1 |
| `packages/app/src/input/intents.ts` | `{ kind: 'attack' }` intent; `resolvePointer`'s hostile branch; `applyIntent` | 3 |
| `packages/app/src/input/cursor.ts` | `attack` cursor name comes back for the order (its sight: For the lead, item 4) | 3 |
| `packages/app/src/ui/hud.ts`, `i18n/en.json` | the fire panel's footer line; the unit card line | 3 |
| `packages/app/src/voice/director.ts` | the `attack` verb already exists (`voice/lines.ts` `OrderVerb`): no new line | 3 |
| `data/schemas/telemetry_event.schema.json`, `packages/data/src/telemetry.ts`, `packages/worker/` stats rows | `attack` joins the `orderVerb` enum | 3 |
| `data/tutorial/beit_sahwan_0.json` (+ its locale overlay, if any) | beats 6 and 9 name the target again | 4 |
| `docs/HANDOVER.md`, `CLAUDE.md`, `docs/polish/commercial-polish-audit.md` | Ledger; PA-08 to DONE | 5 |

---

## Task 1: the `attack` command and the column (**a sim re-pin**)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Hold position on `main`.

**Interfaces (produced):**

```ts
// sim.ts
| { kind: 'attack'; ids: number[]; target: number }   // Command union
private readonly focusTarget: Int32Array;             // -1, or the entity this unit was ordered to fire on
// state view: readonly focusTarget (read-only, like brace and holdPos)
// hash(): hashArray(h, this.focusTarget), next to holdPos
```

- [ ] **Step 1: Write the failing tests** in the new `focus.test.ts`. In-test fixtures with
  `role: 'infantry'` (a type with no `role` derives as wheeled and never braces), plus one vehicle
  fixture with two weapon slots. Contact is seeded with the sim's own reveal path, never by writing
  `contact`.
  - **"attack sets the focus and clears attackMove"**: `focusTarget` reads the target, `attackMove`
    0 (an unheld unit).
  - **"a held unit given attack on an in-range target stays held and fires"** (T-D8): `holdPos` 1,
    `focusTarget` set, a `fire` event names the target, position unchanged for 20 s.
  - **"a held unit given attack on an out-of-range target is refused and stays put"** (T-D8):
    `focusTarget` -1, `holdPos` 1, position unchanged for 20 s.
  - **"attack on a suspected enemy is refused"** (T-D2): below `IDENTIFIED_AT`, `focusTarget` stays -1.
  - **"attack on a civilian, a friendly, a garrisoned or a carried unit is refused"** (T-D2).
  - **"any other order releases the focus"**: `move`, `attackMove`, `halt`, `hold`; each reads -1.
  - **"a rout releases the focus"** (as H-D4 does for Hold).
- [ ] **Step 2: Implement** the command branch and the column only: the focus is set and cleared,
  nothing reads it yet. At the head of the command loop, clear `focusTarget[id]` for every id an order
  names, except `attack` itself (the H-D2 pattern; one loop for both columns). Clear it in `startRout`.
  `attack` is exempt from H-D2's `holdPos` clear (T-D8): on a held unit it is accepted only when the
  target is already in reach, and refused otherwise.
- [ ] **Step 3: Hash coverage.** In `determinism.test.ts`, add **"hash covers focusTarget"**: flip one
  element through `sim.state` and expect a different `hash()`.
- [ ] **Step 4: Re-pin both sim pins** in this commit. Each gets a dated comment: "Targeted fire
  (GH-420, lead 6 Oct): one per-unit column, `focusTarget`, joins the hash. No behaviour moved: with
  its `hashArray` line removed, both replays reproduce the old value. Was N."
- [ ] **Step 5: Prove the re-pin is only the column.** Delete the `hashArray` line temporarily. Both
  pins must read the branch base's values. Restore the line. **Undo the edit, never `git checkout` the
  file.**
- [ ] **Step 6: Gates.** `balance` and `playtest` byte-identical (R). Quote both in the commit.
- [ ] **Step 7: See it red.** Skip the release clear: "any other order releases the focus" fails.
  Delete the `hashArray` line: "hash covers focusTarget" fails.

---

## Task 2: the behaviour (no re-pin)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 1.

No golden replay issues `attack`, so this task is hash-neutral (R). Prove it: both pins unchanged.

- [ ] **Step 1: Write the failing tests** in `focus.test.ts`:
  - **"a focused unit shoots its focus, not the nearer enemy"**: two identified enemies in range, the
    ordered one farther away. Every `fire` event from the shooter names the ordered one. The same
    layout without `attack` is the control: it fires on the nearer one.
  - **"a focused unit out of range closes, then stops and kneels"**: it moves toward the target, stops
    inside slot 0's effective range, reads `BRACE_KNEELING` after `KNEEL_DROP_TICKS`, and fires.
  - **"slot 1 keeps its own target when it cannot hurt the focus"** (T-D5): the vehicle fixture's gun
    fires on the ordered APC while its MG fires on infantry.
  - **"an indirect weapon fires on its focus without a sight line"**: a mortar fixture behind a wall.
  - **"a dead focus hands the unit back as an arrived attack-mover"** (T-D4): `focusTarget` -1,
    `attackMove` 1, `moving` 0, on the tick after the `destroyed` event.
  - **"a focus that garrisons ends the order"** (T-D3).
  - **"a lost focus walks to its last-seen position, then ends"** (T-D3): identification drops; the
    unit moves to `lastSeenX/Y`; after `FOCUS_LOST_TICKS` with no re-identification the focus is -1.
  - **"a re-identified focus keeps the order"**: contact back inside the window, the focus survives.
  - **"a chase refreshes the field by tile"** (T-D6): a target walking 6 tiles costs at most 7
    `flowFieldCount` increments, not one per tick.
  - **"the closing rule does not move a focused unit"**: `stepSweep` skips it while the focus is valid.
  - **"a held, focused unit never moves"** (T-D8): the target walks out of reach; the focus ends, the
    unit is still held and has not moved.
- [ ] **Step 2: Implement.**
  - `selectTarget`: before the scan, if `focusTarget[shooter] >= 0` and the focus passes the same
    filters the scan applies (side, containment, identification, air/ground, range, minimum range,
    sight line or indirect) and, for slot 1, `hurts`, return it. Otherwise scan as today. One helper
    (`focusEngageable(shooter, w, t)`) so the scan's filter and the focus's filter cannot drift.
  - `stepFocus`, called in `tick()` after `stepKamikaze` and before `stepSweep`: end an invalid focus
    (T-D3, T-D4); for a held unit, end the focus as soon as it leaves reach and never set `moving`
    (T-D8); else, out of reach, set the goal to the target's tile (or last-seen while lost) and
    `moving = 1`, refreshing `fieldRef` only on a tile change (T-D6); in reach, `moving = 0`.
  - `stepSweep`: `if (this.focusTarget[i] >= 0) continue;` beside Hold's skip.
  - `FOCUS_LOST_TICKS` in `tuning.ts` with a comment saying where 100 came from (5 s, the same order as
    the contact decay; R).
- [ ] **Step 3: Gates.** Both pins unchanged; `balance` and `playtest` byte-identical. Quote them.
- [ ] **Step 4: See it red.** Drop the focus preference: "shoots its focus" fails. Drop `stepSweep`'s
  skip: "the closing rule does not move a focused unit" fails. Refresh the field every tick: the
  field-count test fails. Skip the lost-counter: "a lost focus … then ends" fails.

---

## Task 3: Lane A, the order in the UI (WP-S-F #184)

**Agent:** lane A. **Depends:** Task 2 on `main`. S-F trails Lane C by one landing.

- [ ] **Step 1: The intent.** `input/intents.ts` gains `{ kind: 'attack'; ids; target }`;
  `applyIntent` queues the sim command. `resolvePointer`'s hostile branch (the one that returns an
  `attackMove` to an identified enemy's tile today) returns `attack` for every selected id with a
  weapon that can engage that target, and the `attackMove` it returns today for the rest (T-D7), in
  one resolution. A suspected (not identified) contact keeps today's attack-move: the fire panel
  already says why it cannot be shot. **Held units (T-D8):** a held unit with the target already in
  reach gets `attack`; a held unit out of reach gets nothing, and the click shows
  `t('intent.holdOutOfRange')` ("On hold — target out of range", tone `warn`) with the deny cue. The
  predicate reads `sim.state.holdPos` and the same reach rule through the intent world adapter;
  `intents.test.ts` pins both cases and a mixed selection.
- [ ] **Step 2: Modifiers.** Shift keeps today's appended attack-move (T-D9). Alt is unchanged (it only
  matters on a protected structure). The armed Attack-move chip's left-click on an identified enemy
  issues `attack` too (For the lead, item 3).
- [ ] **Step 3: The cursor.** `input/cursor.ts`: over an identified enemy that at least one selected
  unit can engage, the name is `attack-*` again (the comment at `CursorName` says it comes back with
  this order). Over a suspected contact it stays `advance-*`. `cursorKey()` reads it back
  (`__lions.cursorKey()`), and `pointer.test.ts` pins both.
- [ ] **Step 4: The panel and the card.**
  - The fire panel's footer: a new `hud.fire.clickTargets` ("Right-click: fire on this target") when
    the cursor says `attack`; `hud.fire.clickAdvances` stays for `advance`.
  - The unit card: while `focusTarget` is set, `hud.card.ordered` ("Ordered: {target}") replaces
    `hud.card.engaging`.
  - Every string through `t()`; a `?pseudo=1` capture shows no unbracketed word; semantic tokens only
    (`pnpm validate:ui`). No new colour: the ordered line takes the card's existing type register.
- [ ] **Step 5: Feedback in the world, with no new mark.** The existing fire-link pulse
  (`render/.../units/fire-link.ts`) already contracts onto a selected unit's target; it shows the focus
  because the focus is what the unit shoots. No new world overlay (lead: no status marks in the world).
- [ ] **Step 6: Audio and voice.** The voice ack uses the existing `attack` verb (`voice/lines.ts`
  `OrderVerb`), no new recording. The confirm cue is unchanged (a field order is not a primary action,
  #426 A8). A refused `attack` (nobody can engage) plays the deny cue through the existing refused-order
  path. No new `MissionEvent` kind, so `ui/cues.ts` needs no row (R; `cues.test.ts` confirms).
- [ ] **Step 7: Telemetry.** The order-verb counter refuses verbs outside
  `data/schemas/telemetry_event.schema.json`'s `orderVerb` enum (11 verbs at `f2d5d9e8`, no `attack`).
  Add `attack` there, in `packages/data/src/telemetry.ts` and in the Worker's `/stats` rows together
  (WP-T1), or the new verb is dropped silently.
- [ ] **Step 8: See it red.** Return `attackMove` from the hostile branch: the `pointer.test.ts` case
  "an identified enemy reads `attack-soft` and predicts one `attack`" fails. Drop T-D7's split: the
  "rifle squad and AA team on a helicopter" case fails.

---

## Task 4: the tutorial beats (data)

**Agent:** lane A (or `mission-author`). **Depends:** Task 3.

PA-12 is DONE on an interim (beats 6 and 9 end on the lesson, `polish/first-timer`, #488). With a real
order, beat 6 can teach it.
- [ ] Beat 6 (`identify_then_shoot`): "Hold the cursor over an enemy until it is identified, then
  right-click it: your squad fires on that man." Its `await` adds a `fire` on the named enemy if the
  tutorial's step vocabulary can express it; otherwise the wording changes and the `await` stays.
- [ ] Beat 9 (`what_a_shot_costs`): leave the mortar's lesson as it is (the mortar picks the nearest
  enemy it knows of, and you pay for where the round lands). Optionally add one sentence that a
  right-click on an enemy picks the target for it.
- [ ] Beats 3, 6 and 9 also name H; after Hold they name Hold, not halt (Hold plan, Task 3, Step 5).
  Edit the beat text once, in whichever of the two plans lands second.
- [ ] Tutorial text locale: if `data/tutorial/` has a locale overlay, update it; `pnpm validate:data`.

---

## Task 5: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1 and §4: GH-420 landed, the new pin values.
- [ ] `docs/polish/commercial-polish-audit.md`: PA-08 to DONE (L1 was decided early Oct: no move-only order).
- [ ] `CLAUDE.md` "Dev instruments": one line on `attack`, what it does to the closing rule, and that
  `cursorKey()` reads `attack-*` again over an identified enemy.

---

## Re-pins

| pin | expected | reason |
|---|---|---|
| sim pins, flat and relief | **moved once**, Task 1 | one hashed per-unit column, `focusTarget` (plus its lost counter if T-D3 needs one: one commit for both) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical (R) | — |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5870) / `ROSTER_MAX` (31) / `GATES` | unchanged | — |
| golden baseline | unchanged (R) | no gated scenario issues an order |

## For the lead

1. **Confirm T-D1–T-D7 and T-D9–T-D10** (T-D8 ruled, item 2), chiefly T-D3 (a lost focus walks to the last-seen position for 5 s, then
   ends), T-D4 (afterwards the unit is an arrived attack-mover) and T-D5 (slot 1 keeps its own target
   unless it can hurt the focus). **Recommended:** as written.
2. **Hold and targeted fire (T-D8).** **RULED 11 Oct (lead), against the recommendation below:** a held
   unit stays on Hold; it fires on an in-range target and refuses an out-of-range one with a reason
   line; it never moves. The original question: does an `attack` on a held unit release Hold (H-D2 as written),
   or does a held unit fire on its focus only while in reach and never move?
   **Recommended:** release Hold, as H-D2 says. One rule for every order, and a held unit with a better
   target in reach already shoots the nearest threat; the case is rare.
3. **The armed Attack-move chip's left-click on an enemy.** Should it issue `attack` (same as a
   right-click), or stay an attack-move to the tile? **Recommended:** `attack`. The chip exists for
   players who left-click; the same target should give the same order.
4. **The cursor's sight for `attack`.** #427 kept the attack-move graphic under the `advance` name.
   Reuse the attack-move sight for `attack` too, or draw a distinct sight? **Recommended:** reuse it in
   Stage 4; a distinct sight is an art call with its own mock (G1 order sights).

L1 (move-only) is not a question: the lead ruled "no move-only order" in early October. Disengaging
stays via Hold, `halt` and orders.
