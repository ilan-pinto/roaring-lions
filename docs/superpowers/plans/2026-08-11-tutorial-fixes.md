# Tutorial Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gated "box-select + shift-queue" tutorial lesson, and make completing the last lesson end the tutorial mission as a victory immediately.

**Architecture:** Two small mechanism extensions, both data-driven: (1) an optional `append` field on tutorial predicates so a lesson can require a shift-queued order; (2) a `MissionRuntime.completeObjective(id)` app→runtime call (same channel as `requestStrike`) plus a declarative `"completes"` field in the tutorial JSON linking tutorial completion to a mission objective. All lesson content stays in `data/tutorial/beit_sahwan_0.json`.

**Tech Stack:** TypeScript strict, vitest, JSON Schema (draft 2020-12), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-10-tutorial-fixes-design.md`

## Global Constraints

- `@lions/sim` is Q16.16 fixed-point; no `Math.*`/`Date.*` in the sim package (Task 3 touches it — no arithmetic is added, only control flow).
- `pnpm test:determinism` must pass before any commit touching `@lions/sim` (Task 3). No tuning changes here, so the golden hash must NOT change.
- Missions and tutorials are declarative JSON validated by `pnpm validate:data`; never hardcode a mission-specific id in engine/app code (hence the `"completes"` field).
- Tutorial `teach` ≤ 240 chars, `nudge` ≤ 160 chars, `title` ≤ 60 chars (schema-enforced).
- This working tree is shared with other sessions: `git add` explicit paths only, never `git add -A`.
- Run commands from the repo root: `/Users/ilpinto/dev/roaring-lions`.

---

### Task 1: `append` predicate support (matcher + schema)

**Files:**
- Modify: `packages/app/src/tutorial/runtime.ts` (PredicateJson ~line 19–30, `matches()` intent branch ~line 82–90)
- Modify: `data/schemas/tutorial.schema.json` (`$defs.predicate.properties` and `$defs.nestedPredicate.properties`)
- Test: `packages/app/src/tutorial/runtime.test.ts`

**Interfaces:**
- Consumes: `PlayerIntent` order intents already carry `append: boolean` (`packages/app/src/input/intents.ts:23`).
- Produces: `PredicateJson.append?: boolean` — matched only against `order` intents. Task 2's JSON step relies on `{ "kind": "intent", "intent": "order", "append": true }` being a valid, matchable predicate in both `predicate` and `nestedPredicate` (it is used inside an `all_of`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/tutorial/runtime.test.ts` (top level, after the existing describes):

```ts
describe('append narrowing', () => {
  const QUEUE_STEPS: StepJson[] = [
    {
      id: 'move_as_one',
      title: 'Move as one',
      teach: 'Queue waypoints with shift.',
      await: { kind: 'intent', intent: 'order', append: true },
    },
  ];

  it('matches only a shift-queued order', () => {
    let s = initTutorial(QUEUE_STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: false } }, 10);
    expect(s.index).toBe(0); // a plain order must not clear the lesson
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: true } }, 20);
    expect(s.index).toBe(1);
    expect(s.done).toBe(true);
  });

  it('rejects a non-order intent even when append is asked for', () => {
    let s = initTutorial(QUEUE_STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1, 2], via: 'box' } }, 10);
    expect(s.index).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: the two new tests FAIL — TypeScript rejects `append` on `PredicateJson` (compile error) or, once typed, the first test fails at `expect(s.index).toBe(1)` because `matches()` ignores `append: true` and the `append: false` order already advanced the step.

- [ ] **Step 3: Implement the matcher**

In `packages/app/src/tutorial/runtime.ts`, add to `PredicateJson` (after `via`):

```ts
  append?: boolean;
```

In `matches()`, `case 'intent'`, after the `pred.via` line and before the `pred.action` line:

```ts
      if (pred.append !== undefined && (i.kind !== 'order' || i.append !== pred.append)) return false;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, including all pre-existing runtime/steps tests.

- [ ] **Step 5: Extend the schema**

In `data/schemas/tutorial.schema.json`, add to **both** `$defs.predicate.properties` and `$defs.nestedPredicate.properties` (after `"via"` in each):

```json
        "append": { "type": "boolean", "description": "intent/order only: matches only orders with this queued (shift) flag." },
```

Run: `pnpm validate:data`
Expected: PASS (no content uses the field yet; this just admits it).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/tutorial/runtime.ts packages/app/src/tutorial/runtime.test.ts data/schemas/tutorial.schema.json
git commit -m "feat(tutorial): predicates can require a shift-queued order"
```

---

### Task 2: New lesson — "Move as one"

**Files:**
- Modify: `data/tutorial/beit_sahwan_0.json` (insert after the `move_by_bounds` step; reword `move_by_bounds.teach`)

**Interfaces:**
- Consumes: `append` predicate field from Task 1; `via: "box"` select narrowing (already implemented); the `field` marker in `data/maps/tutorial_ground.json` (already referenced by `move_by_bounds`).
- Produces: the tutorial becomes 13 steps; the existing `steps.test.ts` validators and the panel's `n / total` tag pick this up automatically.

- [ ] **Step 1: Reword `move_by_bounds`**

In `data/tutorial/beit_sahwan_0.json`, change the `move_by_bounds` step's `teach` from:

```
Right-click ground to send them. Hold shift to queue a route around cover instead of straight across open ground. Press h to stop them where they stand.
```

to:

```
Right-click ground to send them. Press h to stop them where they stand.
```

(The shift sentence moves into the new lesson, which actually gates on it.)

- [ ] **Step 2: Insert the new step**

Immediately after the `move_by_bounds` step object (it becomes step 3, before `cover_is_terrain`), insert:

```json
    {
      "id": "move_as_one",
      "title": "Move as one",
      "teach": "Drag a box around the squad and the APC, then hold shift and right-click two points. They walk the route together, around the open ground instead of straight across it.",
      "await": {
        "kind": "all_of",
        "of": [
          { "kind": "intent", "intent": "select", "via": "box" },
          { "kind": "intent", "intent": "order", "append": true }
        ]
      },
      "focus": { "kind": "marker", "marker": "field" },
      "nudge_after_s": 15,
      "nudge": "Drag a box around both units, then shift-right-click two waypoints."
    },
```

Rationale recorded in the spec: the starting force is one `inf_squad` + one `apc_eitan`, so a multi-unit box-select is possible from tick one; `all_of` accumulates, so select and shift-order may come in either order.

- [ ] **Step 3: Validate and test**

Run: `pnpm validate:data && pnpm test`
Expected: both PASS — `steps.test.ts` validates the new step's intent kinds and required fields; the `all_of` children are `nestedPredicate`s, which now admit `append`.

- [ ] **Step 4: Commit**

```bash
git add data/tutorial/beit_sahwan_0.json
git commit -m "feat(tutorial): a lesson that requires box-select and a shift-queued route"
```

---

### Task 3: `MissionRuntime.completeObjective`

**Files:**
- Modify: `packages/sim/src/mission.ts` (new private field near line 264, new public method after `requestBuild` ~line 375, drain in `step()` immediately before `this.stepObjectives(tick, out)` at line 527)
- Test: `packages/sim/src/mission.test.ts` (uses the file's existing `makeWorld`/`baseMission` helpers)

**Interfaces:**
- Consumes: existing private state — `this.ended`, `this.objectives: ObjectiveState[]` (`{ def, status, holdTicks, paused }`), `checkEnd`'s "all primaries complete → victory" rule.
- Produces: `completeObjective(id: string): boolean` — public, returns `true` iff the id names a currently `active` objective and the mission has not ended. The `objective`-complete `MissionEvent` and any `missionEnd` come out of the **next** `step()`. Task 4's `main.ts` wiring calls exactly this signature.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/mission.test.ts` (top level):

```ts
describe('external objective completion', () => {
  it('completes an active objective and ends the mission through the normal path', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'work_up', type: 'survive_until', primary: true, seconds: 600 }],
      })
    );
    expect(w.runtime.completeObjective('work_up')).toBe(true);
    const out = w.step(1);
    expect(
      out.mission.some((e) => e.kind === 'objective' && e.id === 'work_up' && e.status === 'complete')
    ).toBe(true);
    const ends = out.mission.filter(
      (e): e is Extract<MissionEvent, { kind: 'missionEnd' }> => e.kind === 'missionEnd'
    );
    expect(ends).toHaveLength(1);
    expect(ends[0].result).toBe('victory');
    expect(ends[0].survivors).toEqual(['m_squad']);
  });

  it('rejects unknown ids, already-complete objectives, and calls after the end', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'work_up', type: 'survive_until', primary: true, seconds: 600 }],
      })
    );
    expect(w.runtime.completeObjective('no_such_objective')).toBe(false);
    expect(w.runtime.completeObjective('work_up')).toBe(true);
    expect(w.runtime.completeObjective('work_up')).toBe(false); // no longer active
    w.step(1); // mission ends
    expect(w.runtime.result).toBe('victory');
    expect(w.runtime.completeObjective('work_up')).toBe(false); // ended
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `completeObjective` does not exist (TypeScript error on `w.runtime.completeObjective`).

- [ ] **Step 3: Implement**

In `packages/sim/src/mission.ts`, add a field next to `private ended = false;` (~line 264):

```ts
  /** Objectives completed from outside since the last step(), so their
   *  events are emitted on the tick the completion takes effect. */
  private readonly externallyCompleted: string[] = [];
```

Add the method directly after `requestBuild` (~line 375):

```ts
  /**
   * Complete a declared objective from outside the runtime. The tutorial's
   * "every lesson cleared" is a fact about player input, which the runtime
   * deliberately cannot observe (see tutorial.schema.json) — this is the
   * same app→runtime channel as requestStrike. The completion event and
   * any mission end come out of the next step(), through the normal path.
   */
  completeObjective(id: string): boolean {
    if (this.ended) return false;
    const o = this.objectives.find((x) => x.def.id === id);
    if (!o || o.status !== 'active') return false;
    o.status = 'complete';
    this.externallyCompleted.push(id);
    return true;
  }
```

In `step()`, immediately before `this.stepObjectives(tick, out);` (line 527):

```ts
    for (const id of this.externallyCompleted.splice(0)) {
      out.push({ kind: 'objective', tick, id, status: 'complete' });
    }
```

(`stepObjectives` skips the objective because its status is no longer `active`; `checkEnd` on the same tick sees every primary complete and emits `missionEnd` with the full ledger/survivor payload.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, including all pre-existing mission tests.

- [ ] **Step 5: Determinism gate (sim package touched)**

Run: `pnpm test:determinism`
Expected: PASS with the pinned golden hash unchanged — this change adds control flow only, no arithmetic, no RNG, and nothing calls `completeObjective` during the replay.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
git commit -m "feat(sim): missions can have an objective completed from outside"
```

---

### Task 4: `completes` field — schema, data, cross-check, app wiring

**Files:**
- Modify: `data/schemas/tutorial.schema.json` (top-level `properties`)
- Modify: `data/tutorial/beit_sahwan_0.json` (top-level field)
- Modify: `packages/app/src/tutorial/steps.test.ts` (imports, `all` cast, new test)
- Modify: `packages/app/src/main.ts` (`stepList` cast ~line 473–475; `tut.done` block ~line 799–806)

**Interfaces:**
- Consumes: `MissionRuntime.completeObjective(id: string): boolean` from Task 3; `missions` and `tutorials` exports of `@lions/data`.
- Produces: tutorial JSON may declare top-level `"completes": "<objective id>"`; the app calls `runtime.completeObjective(...)` once when the last step clears.

- [ ] **Step 1: Write the failing cross-check test**

In `packages/app/src/tutorial/steps.test.ts`, change the `@lions/data` import to include `missions`:

```ts
import { missions, tutorials } from '@lions/data';
```

Widen the `all` cast to carry the new field:

```ts
const all = Object.values(tutorials) as { id: string; mission: string; steps: StepJson[]; completes?: string }[];
```

Add inside the existing `describe('shipped tutorial steps', ...)`:

```ts
  it('completes only an objective its mission declares', () => {
    for (const t of all) {
      expect(t.completes, `${t.id} should declare which objective finishing it completes`).toBeDefined();
      const m = (missions as Record<string, { objectives: { id: string }[] } | undefined>)[t.mission];
      expect(m, `${t.id} teaches unknown mission "${t.mission}"`).toBeDefined();
      expect(
        m?.objectives.map((o) => o.id),
        `${t.id} completes "${t.completes}"`
      ).toContain(t.completes);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: the new test FAILS at the `toBeDefined()` assertion — `beit_sahwan_0.json` has no `completes` yet.

- [ ] **Step 3: Add the field to schema and data**

In `data/schemas/tutorial.schema.json`, add to the **top-level** `properties` (after `"mission"`):

```json
    "completes": {
      "type": "string",
      "description": "Objective id in this tutorial's mission, marked complete when the last step clears — finishing the lessons is the exercise. Cross-checked against the mission's objectives in steps.test.ts."
    },
```

In `data/tutorial/beit_sahwan_0.json`, after the `"mission"` line:

```json
  "completes": "work_up",
```

Run: `pnpm validate:data && pnpm test`
Expected: both PASS (the cross-check test now finds `work_up` among `beit_sahwan_0_tutorial`'s objectives).

- [ ] **Step 4: Wire the app**

In `packages/app/src/main.ts`, widen the `stepList` cast (~line 473):

```ts
  const stepList = Object.values(
    tutorials as Record<string, { mission: string; steps: StepJson[]; completes?: string } | undefined>
  ).find((t) => t?.mission === missionId);
```

In the `tut.done` block (~line 799), add the call right after the HUD note:

```ts
        if (tut.done) {
          window.localStorage.setItem(TUTORIAL_DONE_KEY, '1');
          hud.note('<b>working up complete</b> — the town is next', 'good');
          if (stepList?.completes !== undefined) runtime.completeObjective(stepList.completes);
          tut = null;
```

(`runtime` is non-null here — the block sits inside `if (runtime && mission)`. The `missionEnd` arrives on the next tick; its handler already tolerates the panel being gone.)

- [ ] **Step 5: Full gate**

Run: `pnpm test && pnpm lint && pnpm validate:data`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/tutorial.schema.json data/tutorial/beit_sahwan_0.json packages/app/src/tutorial/steps.test.ts packages/app/src/main.ts
git commit -m "feat(tutorial): finishing the last lesson ends the exercise as a victory"
```

---

### Task 5: Verify in the browser (drive the real UI)

**Files:** none committed. A temporary, uncommitted truncation of `data/tutorial/beit_sahwan_0.json` is used and then restored.

Project memory that binds here: verify UI features by driving the UI (console shortcuts have produced false "it works" claims), and walk gate sequences against real world state. `preview_start` serves the directory it was launched from — this work is in the main tree, so that is fine.

- [ ] **Step 1: Start the dev server and open the tutorial**

Use the browser preview tools (`preview_start` with the dev-server entry from `.claude/launch.json`, creating one for `pnpm dev` if missing). In the browser: clear the done flag so the tutorial runs — `localStorage.removeItem('lions.tutorial.done')` via the JS tool — reload, and start "Beit Sahwan 0 — Working Up" from the menu.

- [ ] **Step 2: Play lessons 1–3 with real input**

1. Click the squad → step 1 "Take command" clears.
2. Right-click ground → step 2 "Move by bounds" clears; its text no longer mentions shift.
3. Step 3 is "Move as one" (tag reads `3 / 13`): drag a box around the squad and APC, then shift-right-click two points → step clears. Also confirm a *plain* right-click plus a click-select does NOT clear it first.

Verify via screenshot + `read_page`, not console flags.

- [ ] **Step 3: Verify the completion → victory wiring end-to-end**

Playing all 13 lessons manually is not practical here, so truncate the *working tree* copy: temporarily edit `data/tutorial/beit_sahwan_0.json` down to its first three steps (keeping `"completes": "work_up"`), reload, clear the done flag again, play the three lessons, and confirm: the "working up complete" HUD note, then the **victory end screen** appears within a tick — no 10-minute wait — and the ledger note fires. Then restore the file:

```bash
git checkout -- data/tutorial/beit_sahwan_0.json
```

and remove the `lions.tutorial.done` localStorage key state as found (the test set it; leave it set only if it was set before).

- [ ] **Step 4: Skip-path sanity**

With the file restored and the done flag cleared, reload, start the tutorial, press "skip tutorial": the panel goes away and the mission keeps running on its `survive_until` timer (objective still shown active). No commit from this task.

---

## Self-review notes

- Spec coverage: §1 → Tasks 1–2; §2 → no task by design; §3 → Tasks 3–4; testing section → embedded per task + Task 5.
- The cross-check test in Task 4 asserts `completes` is defined on *every* shipped tutorial — there is exactly one today; if a later tutorial legitimately shouldn't end its mission, that assertion is the one to relax.
- Type names verified against source: `PredicateJson`, `StepJson`, `TutorialInput` (runtime.ts), `ObjectiveState.status` (mission.ts:221–227), `makeWorld`/`baseMission` (mission.test.ts:98–137), `TUTORIAL_DONE_KEY` (main.ts:60).
