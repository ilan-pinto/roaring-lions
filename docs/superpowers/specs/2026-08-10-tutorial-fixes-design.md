# Tutorial fixes — box-select + shift-queue lesson, completion ends the mission

**Date:** 2026-08-10
**Status:** Approved

## Goal

Three fixes to the Beit Sahwan 0 tutorial:

1. A new lesson that *requires* the player to box-select multiple units and
   issue a shift-queued move — today both are taught in text but never gated.
2. Occupying a building stays as-is: step "get_inside" already gates on the
   sim's `garrison` event, which the sim emits and tests. No change.
3. Completing the last lesson ends the mission as a victory immediately,
   instead of leaving the player to wait out the 10-minute `survive_until`
   timer.

## 1. New step — "Move as one"

Inserted after `move_by_bounds` (becomes step 3 of 13) in
`data/tutorial/beit_sahwan_0.json`.

- **Gate:** `all_of` two intents:
  - `{ kind: "intent", intent: "select", via: "box" }`
  - `{ kind: "intent", intent: "order", append: true }`

  Shift+right-click already emits `order` with `append: true`
  (`packages/app/src/main.ts`), and drag-box selection emits `select` with
  `via: "box"`. `all_of` accumulates across inputs, so the two actions may
  happen in either order.
- **Availability:** the starting force is one infantry squad and one APC, so a
  multi-unit box-select is possible from tick one — the lesson never asserts
  units that have not arrived yet.
- **Teach text:** moves the "hold shift to queue" sentence out of
  `move_by_bounds` into this step, so each lesson teaches the thing its own
  gate requires. `move_by_bounds` keeps right-click-to-move and `h` to halt.
- **Focus:** the `field` marker, same as `move_by_bounds`.

### Mechanism: `append` on tutorial predicates

The predicate schema has `via` (select) and `verb` (order) but no way to test
`append`. Add an optional `append: boolean` field, "intent/order only",
mirroring `via`/`verb` exactly:

- `data/schemas/tutorial.schema.json` — add `append` to both `predicate` and
  `nestedPredicate`.
- `packages/app/src/tutorial/runtime.ts` — add `append?: boolean` to
  `PredicateJson`; in `matches()`, in the `intent` branch:
  `if (pred.append !== undefined && (i.kind !== 'order' || i.append !== pred.append)) return false;`
- `packages/app/src/tutorial/runtime.test.ts` — cases: `append: true` matches a
  shift-queued order, rejects a plain order, and rejects a non-order intent.

The existing `steps.test.ts` validators (intent kinds, event kinds, required
fields) pick the new step up automatically.

## 2. Occupy a building — no change

`get_inside` (gated on sim event `garrison`) already does this and the sim
subsystem is implemented and tested. It becomes step 6 of 13 by renumbering
only.

## 3. Tutorial completion ends the mission

- **`MissionRuntime.completeObjective(id: string)`** — new public method in
  `packages/sim/src/mission.ts`. Marks the named objective complete iff it is
  currently `active` and the mission has not ended; queues the
  `objective`-complete `MissionEvent` for the next `step()`. The existing
  `checkEnd` then produces `missionEnd` with the full ledger / ROE / survivor
  payload — the normal victory end screen and campaign-ledger update happen
  through the existing path, no parallel end code. Precedent for app→runtime
  calls: `requestStrike` / `requestSweep`.
- **Declarative link:** tutorial JSON gains an optional top-level
  `"completes": "<objective id>"` field (schema + `beit_sahwan_0.json`, value
  `"work_up"`). `steps.test.ts` cross-checks that `completes`, when present,
  names an objective declared by the tutorial's mission.
- **Wiring:** in `main.ts`, the existing `tut.done` block additionally calls
  `runtime.completeObjective(stepList.completes)` when the field is present.
  The done-flag write and panel teardown stay as they are; `missionEnd`
  arrives on the following tick and its handler is already safe to run after
  the panel is gone.
- **Fallback kept:** the mission's `survive_until 600` primary objective is
  unchanged. A player who skips the tutorial (or replays with the done-flag
  set) has no steps running; without the timer the mission could never end for
  them. Anyone playing the tutorial ends it at the last lesson and never sees
  the timer expire.

Determinism note: `completeObjective` mutates mission-runtime state from a UI
fact, like a support call does. It queues no sim commands itself; this mission
has no waves keyed on `work_up`, and `checkEnd` only emits events.

## Out of scope

- No minimum-unit-count predicate for box-select (`via: "box"` is close
  enough; the schema stays small).
- No changes to garrison behavior, no new end-screen variant, no changes to
  other missions.

## Testing

- `runtime.test.ts`: `append` matching (see above).
- `steps.test.ts`: existing validators cover the new step; new check for
  `completes` naming a real objective.
- `mission.test.ts`: `completeObjective` completes an active objective and
  `step()` then ends the mission with the ledger payload; ignores unknown ids,
  non-active objectives, and calls after the mission ended.
- `pnpm validate:data` for both JSON edits; `pnpm test:determinism` (sim
  package is touched).
- Manual: drive the tutorial in the browser (per project memory: verify UI
  features by driving the UI, and walk the gate sequence in world state).
