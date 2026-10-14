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
  right-click leaves today. **Pre-flight 2 (2026-10-11):** and `sweepOrder = 0`, so it holds there
  (#537); it is not swept on.
- **The column is hashed.** Both sim pins move once, for the column only, as #291's do (all three since #537; Hold re-pins nothing, ruling 2026-10-11). No balance
  plan and no playtest plan issues `attack`, so both stay byte-identical (R).
- **The UI half is Lane A** (WP-S-F #184): the right-click branch, the `attack` cursor name coming
  back, the fire panel line, the unit card line, the tutorial beats.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-420; `docs/polish/commercial-polish-audit.md` PA-08, PA-12; ~~L1 decided (lead, early Oct): no move-only order~~ L1 reopened 11 Oct, shipped as #535 (Pre-flight 2).
- #537 (`sweep` on `attackMove`), #535 (the N move), #534 (`Renderer.unitAtScreen`): Pre-flight 2.
- PR #427 (WP-P4): the `advance` cursor, `hud.fire.clickAdvances`, `input/pointer.ts` `pointerPoint`.
- `docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md` §2–§3: the brace machine and the
  closing rule (`stepSweep`).
- ~~`docs/superpowers/plans/2026-10-06-hold-position.md`: the hashed-column re-pin pattern, H-D2.~~ Hold's sim command is retired (ruling (lead, 2026-10-11)); the re-pin pattern is #291's (`2026-09-29-stage4-sim-fixes.md`, Task 4).
- `docs/superpowers/plans/2026-10-04-stage4-order.md`: where this lands.

**Base:**
- Written 11 Oct against `main` `f2d5d9e8`.
- Branch `feat/targeted-fire`, cut from `main` after ~~Hold position~~ #291 (and #247, if it re-pins) and #540 have landed (ruling (lead, 2026-10-11)).
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift (`selectTarget` ~L3299, `stepCombat` ~L3611, `stepSweep`
  ~L5174, `tick()` ~L1846, `applyCommands` ~L2029 in `sim.ts` at `f2d5d9e8`; Pre-flight 2: ~L3339,
  ~L3652, ~L5215, ~L1864, ~L2047 at `49715ff9`).
- Nothing here is measured. Every (R) is reasoned, and its task says how to measure it.

## Pre-flight 2 (2026-10-11), evening, against main 49715ff9

Read and grepped, not run. Written this morning against `f2d5d9e8`; since then #537, #535 and #534
landed, each on a seam this plan uses.

- **#537:** a player's attack-move stops where it was sent; only an order with `sweep: true` (waves,
  `commit`s, `targets.ts`) is walked on by `stepSweep`. `halt` clears `attackMove`, `sweepOrder` and
  `boardGoal`. T-D4's "follows the closing rule like any right-clicked unit" now means "holds where it
  stands". The pins are three.
- **#535:** N arms a plain `move` (`armedOrder === 'move'`, `resolveMoveOrder` in `input/intents.ts`).
  With Move armed, a click over an enemy stays `move` and the cursor stays `moveOnly`. "L1 is decided:
  no move-only order" (Refs, Task 5, the closing line) is reversed.
- **#534:** `Renderer.unitAtScreen(px, py)` picks by body. The right-click and hover still find "the
  enemy under the pointer" with `hostileUnder` (`input/pointer.ts`), the nearest enemy to the ground
  point within 0.5 tile: the rule #534 replaced for the left click because, in a group, the ground
  behind a body belongs to the next unit. A targeted-fire click resolved that way fires on the wrong
  man.

| where | what changed | fixed in place / decision |
|---|---|---|
| Base | Line refs at `49715ff9`: `tick()` ~L1864, `applyCommands` ~L2047, `selectTarget` ~L3339, `stepCombat` ~L3652, `stepSweep` ~L5215 | fixed in place |
| Architecture, T-D4, Task 2 test | The hand-back sets `attackMove = 1, moving = 0` and must also set **`sweepOrder = 0`**; the unit then holds where it stands. The test "a dead focus hands the unit back" adds `sweepOrder` 0 and "position unchanged 10 s later with a remembered contact", seen red by setting `sweepOrder = 1` at the hand-back | fixed in place |
| Task 1, Step 2 | The `attack` branch clears `sweepOrder` with `attackMove` (every non-attack-move branch does since #537) | fixed in place |
| Task 2, test "the closing rule does not move a focused unit" and Step 4's "drop `stepSweep`'s skip" | **Cannot go red.** A focused unit has `attackMove` 0 and `sweepOrder` 0, and the AI never issues `attack` (T-D10), so `stepSweep` skips it with or without the new line. Keep the skip as a comment-guard if wanted, but delete the test and the mutation claim | fixed in place |
| Task 3, Step 1 | `resolvePointer` has **no hostile branch**: an enemy click falls through to the final `attackMove` (`intents.ts` ~L255-338). Add a hostile rung before that fall-through, fed by an enemy id the caller resolves with `Renderer.unitAtScreen` filtered to visible side-1 units (not `hostileUnder`). The hover cursor reads the same id, so cursor and click cannot disagree | fixed in place |
| Task 3, Step 2 | Armed Move (N) wins over an enemy: the click stays a `move`, the cursor `moveOnly` (#535's pinned behaviour, `move-order.test.ts`) | fixed in place |
| Global, Re-pins | Sim pins **three**: flat `1202444260`, relief `3354895120`, orders `2737216487`; all three move in Task 1. `LADDER_CREDITS`/`CAMPAIGN_CREDITS` **5917**, `ROSTER_MAX` **30**. Playtest is 30 seeds (~57 s), still byte-identical (R) | fixed in place |
| Refs, Task 5, closing line | L1 reopened (lead, 11 Oct; #535): disengaging is the N move, `halt`, or another order | fixed in place |

### Rulings (lead, 2026-10-11)

1. **Ruling (lead, 2026-10-11): T-D8 is dropped.** Hold's sim command is retired, so there is no held
   state: `attack` on a halted unit is an ordinary order and the unit closes to range. Every T-D8 line
   below is struck, with its tests, its `stepFocus` branch, its app predicate and its string.
2. **Ruling (lead, 2026-10-11): T-D3 is kept.** A lost focus walks to its last-seen tile for up to 5 s,
   then ends; the player named the target.
3. **Ruling (lead, 2026-10-11): the branch is cut after #291 (and #247, if it re-pins) and #540**, on
   Thu 5 Nov; it no longer waits for Hold.

## Pre-flight 3 (2026-10-14, against be8fa2b1)

Read, grepped and measured against the tree the branch was cut from (`be8fa2b1`, after #570, #577, #580, #584
and #585). Facts: `.superpowers/sdd/2026-10-11-targeted-fire/preflight-facts.md`. The tasks below are
unchanged; where one disagrees with a ruling here, the ruling wins. Tasks 1-4 and a small 2b landed on
`feat/targeted-fire` (Task 5 is the ledger); the PR is pending.

| where | plan said | today (`be8fa2b1`) | consequence |
|---|---|---|---|
| Sim pins | flat 1202444260, relief 3354895120, orders 2737216487 | 916087385, 373999871, 1736634855 (`determinism.test.ts`) | Task 1 re-pins from today's values: 4215479769, 2842924511, 3272041047 |
| Credits | `LADDER_CREDITS`/`CAMPAIGN_CREDITS` 5917, `ROSTER_MAX` 30 | 6025 and 31 | must stay 6025/31; they did |
| Line refs | `tick()` ~L1864, `selectTarget` ~L3339, ... | `tick()` 1907, `applyCommands` 2090, `selectTarget` 3431, `stepCombat` 3794, `stepSweep` 5409, `startRout` 3698, `couldEngage` 5518, `hash` 5765 | locate by symbol |
| T-D5 | a `hurts` heuristic | `weaponHurts(w, t, px, py)` (#570): P(pen) against the face shown >= `PEN_HURTS_MIN`; soft always true; depends on facing | focus goes through it (R-1, R-2, R-3) |
| Command union | sim only | `packages/net` `protocol.ts` (`COMMAND_KINDS`, `cleanCommand`) and `ownership.ts` (`validateCommand`, exhaustive) | Task 1 adds `attack` there (R-7) |
| `applyCommands` | | the final bare `else` is `halt` | the `attack` branch goes BEFORE it |
| "Identified" | `contactState` | `selectTarget` tests contact confidence >= `IDENTIFIED_AT`, not `contactState` | focus uses confidence |
| Engaging latch | "slot 0 decides" | the latch is an OR over both slots' effective ranges; selection uses `rangeSq` | R-3 |
| Lost counter | "if T-D3 needs one" | needed (T-D3 kept) | `focusLost` added and hashed in Task 1, so Task 2 is hash-neutral (R-11) |
| Garrisoned shooter | unspecified | every order branch calls `leaveStructure`; #577: H never empties a building | R-5 |
| Pinned / mobility-killed focus | unspecified | pinned units skip combat | `stepFocus` skips them (R-6) |
| `intents.ts` | "a hostile branch" | no hostile rung; `IntentWorld` has no engage query; `PointerView` has no `unitAtScreen`; hover uses `hostileUnder` | R-8, R-12, R-13 |
| New `CursorName` | `cursor.ts` only | also `SIGHT_OF`, the animation tables, `vite-plugin-cursors.ts` (+ its test), `idsOf`/`intentVerb`, `voice/director.ts` `gestureVerb`, telemetry `orderVerbOf`, `hud.ts` | Task 3 scope widened (R-9) |
| Telemetry rows | | generated from `TELEMETRY_ORDER_VERBS` | schema + `telemetry.ts` only |
| Tutorial await | `fire` on the named enemy | not expressible; `{intent:'attack'}` is, once `INTENT_KINDS` has it; beat 6 is pinned by `lessons.test.ts` and `tutorial_lessons_world.test.ts` | R-10 |
| #580 routed hold, #584, #585 | | rally restores no order; neither #584 nor #585 touches the tick, `applyCommands` or `selectTarget` | focus cleared at rout, not restored; no other change |

Task-pair scan: T1 must add BOTH columns or T2 re-pins (R-11); T3 needs `canFocus` (T1) and `focusHurts` (T2) as
public read-only queries (R-8); T3's refusal and T2's focus preference share `weaponHurts` (R-1, R-2); T4 awaits
`{intent:'attack'}`, which T3 must add to `INTENT_KINDS`.

### Rulings (controller, 2026-10-14)

R-1 to R-13 were taken at pre-flight; R-3b and R-14 to R-22 came out of implementation, review and the fix rounds. Each line
ends with what it costs if the lead wants it the other way.

- **R-1 (can't penetrate).** The APP refuses it: a unit none of whose slots `weaponHurts` the target gets no `attack`, only today's attack-move to the tile (T-D7); if NO selected unit can hurt it the click is refused with `intent.cantPenetrate` and the deny cue. The sim accepts `attack` on geometry-free grounds only. *Wrong:* a player who wants to pin a tank with rifles uses the Attack-move chip; reversing is app-only.
- **R-2 (focus preference).** `selectTarget` returns the focus for a slot only if it passes the scan's filters AND `weaponHurts`, both slots; otherwise it scans as before. *Wrong:* an ordered unit can shoot something else for a while; one line ungates slot 0.
- **R-3 (reach).** "In reach" = inside `effectiveRange` of ANY slot that can currently fire on the focus; with none, slot 0's. *Wrong:* ATGM teams still close from 13 to 7.2 tiles; standoff at maximum range is a later tuning call.
- **R-3b (amends R-3, from review).** With no slot able to fire, the unit HOLDS only if a domain-capable slot is inside its effective and maximum range with a sight line (or is indirect) and fails on `weaponHurts` or minimum range alone; otherwise it keeps closing. *Wrong:* a unit may close further than wanted; the rule is one function.
- **R-4 (T-D3 timing).** `FOCUS_LOST_TICKS` = 100 counts ticks the issuer side's confidence is below `IDENTIFIED_AT`; the walk goes to the side's `lastSeenX/Y`; `lastSeenValid` 0 ends the focus at once. *Wrong:* grace from the last sighting is ~8.6 s (3.6 s decay + 5 s), not 5; change the constant.
- **R-5 (garrisoned shooter).** `attack` does NOT leave the structure; a garrisoned focused unit fires from the building when in reach, is never moved, and waits out of reach. *Wrong:* an ordered garrison out of reach does nothing visible; the app could send it an attack-move instead.
- **R-6 (refusals).** `stepFocus` skips pinned (focus kept), mobility-killed, garrisoned and carried units; the branch refuses dead, routed and carried shooters; `startRout` clears the focus at its top. *Wrong:* none known.
- **R-7 (net).** Task 1 adds `attack` to `COMMAND_KINDS`, `cleanCommand` and `validateCommand` (own ids, target on the other side), with tests. *Wrong:* versus cannot carry the order.
- **R-8 (app queries).** Two public read-only sim queries, `canFocus` (Task 1; the branch uses the same function) and `focusHurts` (Task 2), reached through `IntentWorld`. *Wrong:* only if `presentedArmor`'s scratch write mattered across calls (checked in Task 2).
- **R-9 (cursor).** A real `attack` `CursorName` reusing the advance art, every table updated; the armed Attack-move chip's left-click on an identified enemy issues `attack`; armed Move still wins. *Wrong:* a distinct sight is a later art call.
- **R-10 (tutorial).** Beat 6 teaches the right-click; its await is `all_of[ any_of[attack, halt], the hover any_of, fire at side 1 ]`, so the old path still completes; beat 9 gets one optional sentence. *Wrong:* none.
- **R-11 (pins).** Task 1 adds and hashes BOTH columns (`focusTarget` Int32, `focusLost` Uint16) in one re-pin commit; Task 2 is hash-neutral. *Wrong:* a second re-pin.
- **R-12 (rung order).** The hostile rung sits after armed support and the empty selection, BEFORE the structure rung and K-08. *Wrong:* none (garrisoned enemies are not targets, T-D2).
- **R-13 (one enemy id).** `pointerPoint` takes it from `Renderer.unitAtScreen`, filtered to living, visible, hostile units; `hostileUnder` is retired from the hover and click path. *Wrong:* the hover panel picks by body (intended).
- **R-14 (chase goal, from review).** The chase goal is always the issuer side's `lastSeenX/Y`, never the hidden true position. *Wrong:* none.
- **R-15 (no memory).** An identified target with `lastSeenValid` 0: the unit waits, focus kept, for ~3.6 s until confidence decays. *Wrong:* a brief mid-chase stop.
- **R-16 (fixtures).** The `move-order.test.ts` edit is kept: it adds the two new `IntentWorld`/`PointerView` members to its fixtures and changes no assertion. *Wrong:* none.
- **R-17 (refusal cursor).** A can't-penetrate refusal shows the `blocked` cursor (its own resolution flag), not `protected`. *Wrong:* a dedicated cursor is a later art call.
- **R-18 (ground point).** `x/y` stays the click's ground point unless the hostile rung resolves a focus; the T-D7 remainder's attack-move goes to the target's tile. *Wrong:* none.
- **R-19 (beat 9).** Beat 9's order `any_of` also accepts `{intent:'attack'}`, since its new sentence invites the click. *Wrong:* none.
- **R-20 (garrison audit).** Every attack-move a click on a picked enemy produces excludes garrisoned ids: silently in the T-D7 remainder, and in the paths with no focus one `intent.garrisonHolds` note per click (all-garrisoned: the deny cue). *Wrong:* a garrison cannot be sent at a suspected enemy by right-click (the chip follows the same rule).
- **R-21 (residual).** The structure and tunnel rungs' own attack-move remainders stay unfiltered: ground-point clicks, today's behaviour. *Wrong:* a garrison clicking a building still leaves it, as before the branch.
- **R-22 (hysteresis, Task 2b).** A STOPPED focused unit stays in reach until the target is beyond reach + `FOCUS_REACH_SLACK` (0.5 tile); a moving one stops at the plain range. Stateless, hash-neutral. *Wrong:* a unit holds up to half a tile beyond its effective range; one constant.

### Coordinator rulings (provisional, open to the lead, listed in the PR body)

- (a) Another order, smoke included, drops the fire order.
- (b) A halt-to-fire chaser holds its fire while closing from maximum to effective range (attack-move would bound-and-fire).
- (c) ATGM teams closing to their effective range is accepted (R-3's cost).
- (d) A small deterministic hysteresis band at the effective-range edge, if cheap: it was, and landed as R-22.

### Outcome

Landed on `feat/targeted-fire` (`babb44e4` .. `311c00f3`). Pins moved once, in Task 1 (the two columns):
flat 916087385 -> 4215479769, relief 373999871 -> 2842924511, orders 1736634855 -> 3272041047. `pnpm balance` and
`pnpm playtest` are byte-identical to `be8fa2b1`; `LADDER_CREDITS` 6025 and `ROSTER_MAX` 31 unchanged. Not run
here: `pnpm ui:routes` and `pnpm golden-baseline` (CI runs them; no gated scenario issues an order).

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
  the closing rule like any right-clicked unit. *(Pre-flight 2, 2026-10-11: since #537 that means it
  holds there; the hand-back writes `sweepOrder = 0`.)* ~~**Except a held unit (T-D8): its focus ends and it is
  still held, standing where it was.**~~ *(Ruling (lead, 2026-10-11): T-D8 dropped.)*
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
- ~~**T-D8. Hold and targeted fire (RULED by the lead, 11 Oct; reverses the recommendation).**~~
  **Ruling (lead, 2026-10-11): dropped with Hold's sim command; the sub-bullets below are void.** A unit on
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
    read-only on `sim.state`, like `brace`.
- **The sim pins move once**, in Task 1, for the new hashed column(s) only. At `f2d5d9e8` they read
  flat `922714084` and relief `3200430224`; **Pre-flight 2 (2026-10-11): at `49715ff9` they are three,
  flat `1202444260`, relief `3354895120`, orders `2737216487`, and all three move.** #291 moves them
  first; Hold re-pins nothing (ruling (lead, 2026-10-11)). Prove the re-pin
  is only the column (Task 1, Step 5).
- **`pnpm balance`** is byte-identical (R): `targets.ts` issues no `attack`.
- **`pnpm playtest`** is byte-identical (R): no plan issues `attack`.
- **`LADDER_CREDITS` (5917), `CAMPAIGN_CREDITS` (5917), `ROSTER_MAX` (30) and `GATES` are unchanged.**
  (Pre-flight 2, 2026-10-11: were 5870, 5870, 31.)
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

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** #291 and #540 on `main` (ruling (lead, 2026-10-11); no Hold).

**Interfaces (produced):**

```ts
// sim.ts
| { kind: 'attack'; ids: number[]; target: number }   // Command union
private readonly focusTarget: Int32Array;             // -1, or the entity this unit was ordered to fire on
// state view: readonly focusTarget (read-only, like brace)
// hash(): hashArray(h, this.focusTarget), next to the brace columns
```

- [ ] **Step 1: Write the failing tests** in the new `focus.test.ts`. In-test fixtures with
  `role: 'infantry'` (a type with no `role` derives as wheeled and never braces), plus one vehicle
  fixture with two weapon slots. Contact is seeded with the sim's own reveal path, never by writing
  `contact`.
  - **"attack sets the focus and clears attackMove"**: `focusTarget` reads the target, `attackMove`
    0 and `sweepOrder` 0.
  - ~~the two held-unit tests (T-D8)~~ *(Ruling (lead, 2026-10-11): T-D8 dropped.)*
  - **"attack on a suspected enemy is refused"** (T-D2): below `IDENTIFIED_AT`, `focusTarget` stays -1.
  - **"attack on a civilian, a friendly, a garrisoned or a carried unit is refused"** (T-D2).
  - **"any other order releases the focus"**: `move`, `attackMove`, `halt`; each reads -1.
  - **"a rout releases the focus"**.
- [ ] **Step 2: Implement** the command branch and the column only: the focus is set and cleared,
  nothing reads it yet. At the head of the command loop, clear `focusTarget[id]` for every id an order
  names, except `attack` itself (one loop, guarded by `'ids' in cmd`: `reveal` and `callStrike` carry none). Clear it in `startRout`.
  *(Pre-flight 2, 2026-10-11: the `attack` branch also clears `sweepOrder` with `attackMove`.)*
  ~~`attack` is exempt from H-D2's `holdPos` clear (T-D8)…~~ *(Ruling (lead, 2026-10-11): no `holdPos`.)*
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
    `attackMove` 1, `moving` 0, on the tick after the `destroyed` event. *(Pre-flight 2, 2026-10-11:
    and `sweepOrder` 0, with a second enemy identified far off and the unit's position unchanged 10 s
    later. Seen red by writing `sweepOrder = 1` at the hand-back.)*
  - **"a focus that garrisons ends the order"** (T-D3).
  - **"a lost focus walks to its last-seen position, then ends"** (T-D3): identification drops; the
    unit moves to `lastSeenX/Y`; after `FOCUS_LOST_TICKS` with no re-identification the focus is -1.
  - **"a re-identified focus keeps the order"**: contact back inside the window, the focus survives.
  - **"a chase refreshes the field by tile"** (T-D6): a target walking 6 tiles costs at most 7
    `flowFieldCount` increments, not one per tick.
  - ~~**"the closing rule does not move a focused unit"**: `stepSweep` skips it while the focus is valid.~~
    *(Pre-flight 2, 2026-10-11: deleted. It cannot fail: a focused unit has `attackMove` 0 and
    `sweepOrder` 0, so `stepSweep` skips it with or without the skip.)*
  - ~~**"a held, focused unit never moves"** (T-D8)~~ *(Ruling (lead, 2026-10-11): T-D8 dropped.)*
- [ ] **Step 2: Implement.**
  - `selectTarget`: before the scan, if `focusTarget[shooter] >= 0` and the focus passes the same
    filters the scan applies (side, containment, identification, air/ground, range, minimum range,
    sight line or indirect) and, for slot 1, `hurts`, return it. Otherwise scan as today. One helper
    (`focusEngageable(shooter, w, t)`) so the scan's filter and the focus's filter cannot drift.
  - `stepFocus`, called in `tick()` after `stepKamikaze` and before `stepSweep`: end an invalid focus
    (T-D3, T-D4); out of reach, set the goal to the target's tile (or last-seen while lost) and
    `moving = 1`, refreshing `fieldRef` only on a tile change (T-D6); in reach, `moving = 0`.
  - `stepSweep`: `if (this.focusTarget[i] >= 0) continue;` *(optional comment-guard; it cannot be seen red, Pre-flight 2)*.
  - `FOCUS_LOST_TICKS` in `tuning.ts` with a comment saying where 100 came from (5 s, the same order as
    the contact decay; R).
- [ ] **Step 3: Gates.** Both pins unchanged; `balance` and `playtest` byte-identical. Quote them.
- [ ] **Step 4: See it red.** Drop the focus preference: "shoots its focus" fails. ~~Drop `stepSweep`'s
  skip: "the closing rule does not move a focused unit" fails.~~ (Pre-flight 2, 2026-10-11: removed,
  see the deleted test.) Refresh the field every tick: the
  field-count test fails. Skip the lost-counter: "a lost focus … then ends" fails.

---

## Task 3: Lane A, the order in the UI (WP-S-F #184)

**Agent:** lane A. **Depends:** Task 2 on `main`. S-F trails Lane C by one landing.

- [ ] **Step 1: The intent.** `input/intents.ts` gains `{ kind: 'attack'; ids; target }`;
  `applyIntent` queues the sim command. *(Pre-flight 2, 2026-10-11: there is no hostile branch today;
  an enemy click falls through to `resolvePointer`'s final `attackMove`. Add the rung before that
  fall-through, taking an enemy id the caller resolves with `Renderer.unitAtScreen` (#534) filtered to
  visible side-1 units, not `hostileUnder`'s ground-point rule; the hover cursor reads the same id.)*
  `resolvePointer`'s hostile branch (the one that returns an
  `attackMove` to an identified enemy's tile today) returns `attack` for every selected id with a
  weapon that can engage that target, and the `attackMove` it returns today for the rest (T-D7), in
  one resolution. A suspected (not identified) contact keeps today's attack-move: the fire panel
  already says why it cannot be shot. ~~**Held units (T-D8)** … `intent.holdOutOfRange` …~~
  *(Ruling (lead, 2026-10-11): T-D8 dropped; no held-unit branch and no `intent.holdOutOfRange`
  string.)* `intents.test.ts` pins the hostile rung and a mixed selection (T-D7).
- [ ] **Step 2: Modifiers.** *(Pre-flight 2, 2026-10-11: armed Move (N, #535) outranks the enemy: the
  click stays a plain `move` and the cursor `moveOnly`; `move-order.test.ts` pins it and stays green.)*
  Shift keeps today's appended attack-move (T-D9). Alt is unchanged (it only
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
- [ ] ~~Beats 3, 6 and 9 also name H; after Hold they name Hold, not halt.~~ *(Ruling (lead,
  2026-10-11): H stays `halt`; those beats keep their H wording and their `halt` awaits.)*
- [ ] Tutorial text locale: if `data/tutorial/` has a locale overlay, update it; `pnpm validate:data`.

---

## Task 5: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1 and §4: GH-420 landed, the new pin values.
- [ ] `docs/polish/commercial-polish-audit.md`: PA-08 to DONE. (Pre-flight 2, 2026-10-11: L1 was
  reopened on 11 Oct and shipped as the N move, #535; do not re-state the old ruling.)
- [ ] `CLAUDE.md` "Dev instruments": one line on `attack`, what it does to the closing rule, and that
  `cursorKey()` reads `attack-*` again over an identified enemy.

---

## Re-pins

| pin | expected | reason |
|---|---|---|
| sim pins, flat, relief and orders (three since #537; Pre-flight 2, 2026-10-11) | **moved once**, Task 1 | one hashed per-unit column, `focusTarget` (plus its lost counter if T-D3 needs one: one commit for both) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical (R) | — |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5917) / `ROSTER_MAX` (30) / `GATES` | unchanged | — |
| golden baseline | unchanged (R) | no gated scenario issues an order |

## For the lead

1. **Confirm T-D1–T-D7 and T-D9–T-D10** (T-D8 ruled, item 2; dropped by ruling (lead, 2026-10-11); T-D3 kept by the same ruling), chiefly T-D3 (a lost focus walks to the last-seen position for 5 s, then
   ends), T-D4 (afterwards the unit is an arrived attack-mover) and T-D5 (slot 1 keeps its own target
   unless it can hurt the focus). **Recommended:** as written.
2. **Hold and targeted fire (T-D8).** **Superseded, ruling (lead, 2026-10-11): T-D8 dropped with Hold's sim command.** **RULED 11 Oct (lead), against the recommendation below:** a held
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

~~L1 (move-only) is not a question: the lead ruled "no move-only order" in early October. Disengaging
stays via Hold, `halt` and orders.~~ **Pre-flight 2 (2026-10-11):** L1 was reopened by the lead and
shipped as #535 (N, then click: a plain `move`). Disengaging is that move, `halt`, or another order.
