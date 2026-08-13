# D9 Building Crumble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a D9 physically hit the building it is levelling, so the building drains structural HP and visibly crumbles as the blade works, instead of standing pristine for two seconds and then vanishing.

**Architecture:** A new `demolition_method` field in unit data splits `blade` (grinds: drains HP every tick through the existing `damageStructure` path) from `charges` (today's behaviour: invisible timer, then sudden collapse). The timer still fires on the last tick, which absorbs fixed-point truncation and pins the existing 40-tick contract exactly. The renderer's existing integrity alpha ramp then crumbles the building for free; it only needs throttling, because `structureHit` at 20 Hz would otherwise force a full map redraw every tick.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, PixiJS. Q16.16 fixed-point (`@lions/sim/fixed`).

**Spec:** `docs/superpowers/specs/2026-08-13-d9-building-crumble-design.md`

## Global Constraints

- **`packages/sim` is fixed-point only.** No `Math.*`, no `Date.*`, no floats. Use `fx.mul`, `fx.div`, `fx.from`, `fx.fromInt`, `fx.toInt` from `packages/sim/src/fixed.ts`. Lint enforces this.
- **Sim runs at a fixed 20 Hz tick** (`TICKS_PER_SECOND`). Never derive sim behaviour from frame time.
- **Data flows one direction: commands in → sim → state + events out.** The renderer may read `sim.state` / `sim.structures` arrays but must never mutate sim state. Presentation policy (throttling, banding, log formatting) lives in `@lions/render`, never in the sim.
- **Dependency direction is `app → render → sim`.** `packages/sim` imports nothing from the workspace.
- **TypeScript strict. No `any`. No non-null assertions in sim code.**
- **`pnpm test:determinism` must pass with the golden hash UNCHANGED.** No existing unit resolves to `blade`, so any hash movement means something leaked into the `charges` path. That is a bug to fix, not a hash to update.
- **Tests colocate as `*.test.ts`.** Combat maths requires tests; rendering does not — renderer and overlay work is verified by driving the running app.
- Adding a unit capability means adding data plus schema, never a hardcoded engine branch on role or unit id.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `data/schemas/unit.schema.json` | Modify | Declare `demolition_method`. The schema is `additionalProperties: false`, so an undeclared key fails `pnpm validate:data`. |
| `data/units/kdf/dozer_d9.json` | Modify | The one unit that grinds. |
| `packages/sim/src/sim.ts` | Modify | `UnitTypeJson` / `UnitType` field, `unitTypeFromJson`, the `stepDemolition` tail, `demolitionProgress`, and exposing `demoTarget` on the read-only `state` view. |
| `packages/sim/src/demolition.test.ts` | Modify | All new sim tests land here beside the existing demolition tests. |
| `packages/render/src/renderer.ts` | Modify | Banded terrain redraw and blade dust. |
| `packages/render/src/overlay.ts` | Modify | Coalesced combat-log lines for grinding. |

---

### Task 1: The `demolition_method` field

Data plumbing only. After this task nothing behaves differently — the field is parsed and stored, and no code reads it yet. That is deliberate: it keeps the schema/validation change separately reviewable from the behaviour change.

**Files:**
- Modify: `data/schemas/unit.schema.json` (after the `demolition_time_s` block, around line 395)
- Modify: `packages/sim/src/sim.ts` (`UnitTypeJson` ~line 137, `UnitType` ~line 263, `unitTypeFromJson` ~line 361)
- Modify: `data/units/kdf/dozer_d9.json`
- Test: `packages/sim/src/demolition.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UnitType.bladeDemolition: boolean` — `true` when the unit's JSON says `"demolition_method": "blade"`, `false` otherwise (including when the key is absent). Read via the public `sim.unitTypes[typeIdx]`. Tasks 2, 3 and 4 branch on it.

**Why a boolean in the engine and an enum in the data:** the engine stores the decision, not the vocabulary — exactly as `abilities: ["demolish"]` becomes `canDemolish: boolean`. If a third method ever appears, the enum widens and the engine gains a second boolean or a small enum then, not now.

- [ ] **Step 1: Write the failing test**

Add to `packages/sim/src/demolition.test.ts`. Put it directly after the `SHRINE` const, before `ticksToLevel`:

```ts
/** The D9: same 2 s timer as DOZER, but it grinds rather than setting charges. */
const BLADE: UnitTypeJson = { ...SAPPER, id: 'test_blade', demolition_time_s: 2.0, demolition_method: 'blade' };

describe('demolition_method', () => {
  it('defaults to charges when the field is absent', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(SAPPER);
    expect(sim.unitTypes[t].bladeDemolition).toBe(false);
  });

  it('reads blade from the unit data', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(BLADE);
    expect(sim.unitTypes[t].bladeDemolition).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts -t "demolition_method"
```

Expected: FAIL. TypeScript rejects `demolition_method` as not present in `UnitTypeJson`, and `bladeDemolition` does not exist on `UnitType`.

- [ ] **Step 3: Declare the field on the JSON input type**

In `packages/sim/src/sim.ts`, in `interface UnitTypeJson`, directly below the existing `demolition_time_s?: number;` line:

```ts
  demolition_time_s?: number;
  /** How this unit takes a building apart. Absent means `charges`. */
  demolition_method?: 'charges' | 'blade';
```

- [ ] **Step 4: Declare the field on the resolved type**

In `interface UnitType`, directly below the existing `demolitionTicks` field:

```ts
  /** Ticks of held station to bring a building down. Per unit since the D9. */
  demolitionTicks: number;
  /**
   * Grinds rather than setting charges: drains the building's structural HP
   * every tick it works, so the building crumbles as it goes and damage it has
   * already taken counts toward bringing it down. A satchel charge does not
   * work that way, which is why this is a property of the unit and not of the
   * ability.
   */
  bladeDemolition: boolean;
```

- [ ] **Step 5: Resolve it in `unitTypeFromJson`**

In `unitTypeFromJson`, directly below the `demolitionTicks:` entry:

```ts
    demolitionTicks: fx.toInt(
      fx.mul(fx.from(json.demolition_time_s ?? DEMO_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
    bladeDemolition: json.demolition_method === 'blade',
```

- [ ] **Step 6: Declare the field in the schema**

In `data/schemas/unit.schema.json`, directly after the `"demolition_time_s"` block:

```json
    "demolition_method": {
      "enum": ["charges", "blade"],
      "default": "charges",
      "description": "How this unit takes a building apart. `charges` sets satchels and the building goes down at once when the timer expires. `blade` grinds: it drains structural HP every tick, so the building crumbles as it works and damage it has already taken counts. Absent means `charges`, which is what every demolisher did before the field existed."
    },
```

- [ ] **Step 7: Give the D9 a blade**

In `data/units/kdf/dozer_d9.json`, after the `demolition_time_s` line:

```json
  "abilities": ["demolish"],
  "demolition_time_s": 2.0,
  "demolition_method": "blade"
```

- [ ] **Step 8: Run the tests and the data validator**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts && pnpm validate:data && pnpm test:determinism
```

Expected: demolition tests PASS (both new ones and all eight existing ones), `validate:data` PASS, `test:determinism` PASS **with the golden hash unchanged** — nothing reads the new field yet, so any hash movement here is a mistake.

- [ ] **Step 9: Commit**

```bash
git add data/schemas/unit.schema.json data/units/kdf/dozer_d9.json packages/sim/src/sim.ts packages/sim/src/demolition.test.ts
git commit -m "feat(sim): demolition_method distinguishes a blade from charges"
```

---

### Task 2: The blade takes a bite every tick

The behaviour change. A blade demolisher damages its target through the existing `damageStructure` path instead of leaving it untouched until the timer expires.

**Files:**
- Modify: `packages/sim/src/sim.ts` (`stepDemolition` tail, ~lines 2654-2662)
- Test: `packages/sim/src/demolition.test.ts`

**Interfaces:**
- Consumes: `UnitType.bladeDemolition` from Task 1.
- Produces: no new API. Blade demolishers now emit `structureHit` events (`{ kind: 'structureHit'; tick; structure; by; damage; hpLeft }`, already declared at `sim.ts:479`) every working tick, and `sim.structures.hp[s]` drains while they work. Tasks 5 and 6 consume those events.

**The truncation subtlety — read before implementing.** `fx.div` truncates toward zero, so `bite = maxHp / demolitionTicks` is at most exactly `maxHp/40` and usually a hair under. Thirty-nine bites therefore always sum to *less* than `maxHp`, and a fresh building always survives to tick 40 where the existing `destroyStructure` call levels it. That is why the timer must stay: without it the building would linger an extra tick or two and the pinned 40-tick contract would drift. The bite goes in an `else` branch precisely so tick 40 destroys rather than bites.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `packages/sim/src/demolition.test.ts`, inside the file's top level (a sibling of the existing `describe('per-unit demolition time', ...)`):

```ts
describe('the blade crumbles a building as it works', () => {
  /** A one-tile shack at (10,10) with a demolisher of `unit` parked beside it. */
  function world(unit: UnitTypeJson) {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    const s = sim.addStructure(st, [10 * 32 + 10]);
    const t = sim.addUnitType(unit);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    return { sim, s, id };
  }

  it('still levels a fresh building in exactly 40 ticks', () => {
    expect(ticksToLevel(BLADE)).toBe(40);
  });

  it('drains structural HP monotonically while it works', () => {
    const { sim, s } = world(BLADE);
    let prev = sim.structures.hp[s];
    expect(prev).toBe(sim.structures.maxHp[s]);
    for (let n = 1; n <= 39; n++) {
      sim.tick();
      expect(sim.structures.hp[s]).toBeLessThan(prev);
      prev = sim.structures.hp[s];
    }
    // 39 bites of maxHp/40 leave the building standing but nearly gone.
    expect(sim.structures.alive[s]).toBe(1);
    expect(prev).toBeLessThan(sim.structures.maxHp[s] / 10);
  });

  it('reports each bite as a structureHit attributed to the dozer', () => {
    const { sim, s, id } = world(BLADE);
    const events = sim.tick();
    const hit = events.find((e) => e.kind === 'structureHit' && e.structure === s);
    expect(hit).toBeDefined();
    if (hit?.kind === 'structureHit') {
      expect(hit.by).toBe(id);
      expect(hit.damage).toBeGreaterThan(0);
      expect(hit.hpLeft).toBe(sim.structures.hp[s]);
    }
  });

  // The regression guard on the split. Without it, a later refactor that
  // unified the two paths would pass every other test in this file.
  it('charges leave the building at full HP until the moment it collapses', () => {
    const { sim, s } = world(DOZER);
    for (let n = 0; n < 39; n++) {
      sim.tick();
      expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s]);
    }
    sim.tick();
    expect(sim.structures.alive[s]).toBe(0);
  });

  // The blade inherits every guard that sits above target selection.
  it('does not grind a protected site on its own initiative', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const s = sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(BLADE);
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structures.alive[s]).toBe(1);
    expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts -t "the blade crumbles"
```

Expected: FAIL. "still levels a fresh building in exactly 40 ticks" and the two guard tests PASS already (the blade currently behaves exactly like charges); "drains structural HP monotonically" and "reports each bite" FAIL, because HP never moves and no `structureHit` is emitted.

- [ ] **Step 3: Take a bite in `stepDemolition`**

In `packages/sim/src/sim.ts`, at the tail of `stepDemolition`, replace:

```ts
      if (++this.demoTicks[i] >= type.demolitionTicks) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        this.destroyStructure(best, i);
      }
```

with:

```ts
      if (++this.demoTicks[i] >= type.demolitionTicks) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        this.destroyStructure(best, i);
      } else if (type.bladeDemolition) {
        // A blade takes a bite of the building every tick it works, so the
        // thing visibly comes apart and damage it has already taken counts.
        // Scaled to maxHp rather than remaining HP: a fresh building still
        // falls in exactly demolition_time_s, and one already shot to 40%
        // falls at tick 16 of 40 through damageStructure's own zero check.
        //
        // The bite deliberately does NOT run on the final tick. fx.div
        // truncates, so 39 bites always sum to less than maxHp and the
        // building always survives to the timer — which is what pins the
        // tick count exactly rather than letting rounding drift it.
        this.damageStructure(
          best,
          fx.div(this.stMaxHp[best], fx.fromInt(type.demolitionTicks)),
          i,
        );
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts && pnpm test:determinism && pnpm lint
```

Expected: all demolition tests PASS, including the eight pre-existing ones. `test:determinism` PASS **with the golden hash unchanged** — no existing unit is `blade`, so the charges path must be byte-identical. `lint` PASS (the fixed-point rule sees only `fx.*`).

- [ ] **Step 5: Run the rest of the sim suite**

```bash
pnpm test
```

Expected: PASS. `structures.test.ts` has its own demolition-squad tests; those units are `charges` and must be untouched.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/demolition.test.ts
git commit -m "feat(sim): the blade drains structural HP as it grinds"
```

---

### Task 3: Partial work persists

The consequence of the damage being real: a dozer that gives up leaves a damaged building, and coming back finishes faster. This falls out of Task 2 with no new production code — the task exists to pin the behaviour, because it is the property most likely to be silently broken by a later "tidy-up" that resets HP alongside `demoTicks`.

**Files:**
- Test only: `packages/sim/src/demolition.test.ts`

**Interfaces:**
- Consumes: the blade path from Task 2.
- Produces: nothing.

**The arithmetic, so the assertions are not guesses.** `SHACK` is `hp_per_tile: 100` over one tile, so `maxHp = fx.from(100)`. `BLADE` is 2.0 s = 40 ticks. `bite = fx.div(fx.from(100), fx.fromInt(40))` = exactly `fx.from(2.5)` — 2.5 is representable in Q16.16, so there is no truncation residue in this fixture. Twenty ticks therefore leave exactly half the HP, and the return visit takes exactly twenty more.

- [ ] **Step 1: Write the failing test**

This test needs the `SimEvent` type. Widen the existing import at the top of `packages/sim/src/demolition.test.ts`:

```ts
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
```

Then add inside the `describe('the blade crumbles a building as it works', ...)` block from Task 2:

```ts
  it('leaves the damage behind when it drives off, and finishes faster on return', () => {
    const { sim, s, id } = world(BLADE);
    for (let n = 0; n < 20; n++) sim.tick();
    const half = sim.structures.hp[s];
    expect(half).toBe(sim.structures.maxHp[s] / 2);

    // Ordered away: out of DEMO_RANGE_SQ (2 tiles) so the timer resets.
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(20.5), y: fx.from(10.5) });
    for (let n = 0; n < 60; n++) sim.tick();
    expect(sim.structures.alive[s]).toBe(1);
    expect(sim.structures.hp[s]).toBe(half); // the work is not undone
    expect(sim.demolitionProgress(id)).toBe(0); // but the timer is

    // Sent back. Half a building takes half the time.
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    let ticksBack = 0;
    let down: SimEvent | undefined;
    for (let n = 1; n <= 400; n++) {
      const events = sim.tick();
      down = events.find((e) => e.kind === 'structureDestroyed' && e.structure === s);
      if (down) {
        ticksBack = n;
        break;
      }
    }
    expect(ticksBack).toBeGreaterThan(0);
    // The walk back plus 20 ticks of grinding — never a fresh 40 of grinding.
    const walkTicks = ticksBack - 20;
    expect(walkTicks).toBeGreaterThan(0);
    expect(sim.structures.alive[s]).toBe(0);
    // The early collapse comes through damageStructure rather than the timer,
    // so it must still be billed to the dozer — the ROE penalty depends on it.
    if (down?.kind === 'structureDestroyed') expect(down.by).toBe(id);
  });
```

- [ ] **Step 2: Run the test**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts -t "leaves the damage behind"
```

Expected: PASS, with no production change. If it FAILS on `expect(sim.demolitionProgress(id)).toBe(0)`, note that `demolitionProgress` still divides the *timer*; Task 4 changes that and this assertion will need revisiting there — flag it rather than papering over it.

If it fails on the `half` assertion, the bite is being applied on a tick it should not be. Re-read the `else if` placement in Task 2 Step 3 before changing the test.

- [ ] **Step 3: Commit**

```bash
git add packages/sim/src/demolition.test.ts
git commit -m "test(sim): partial blade work survives the dozer driving off"
```

---

### Task 4: `demolitionProgress` tells the truth for a blade

**Files:**
- Modify: `packages/sim/src/sim.ts` (`demolitionProgress`, ~line 979)
- Test: `packages/sim/src/demolition.test.ts`

**Interfaces:**
- Consumes: `UnitType.bladeDemolition` (Task 1), `demoTarget` (private, already exists).
- Produces: `demolitionProgress(id: number): number` — unchanged signature, returns 0..1. For a `charges` unit it is the timer ratio, exactly as today. For a `blade` unit it is `1 - hp/maxHp` of its current target, and 0 when it has no target.

**Why it must branch.** For a fresh building the two are identical, so nothing visibly changes. On a pre-damaged one the timer would promise two more seconds of work that will not happen — the HUD bar would sit at 50% as the building fell. The bar exists to predict collapse, so for a blade it should read the thing that actually causes collapse.

Note this returns a plain `number` and divides — that is already true of the existing implementation. `demolitionProgress` is a HUD accessor outside the tick path, not sim state, so it is not bound by the fixed-point rule; it must never be fed back into the sim.

- [ ] **Step 1: Write the failing test**

**The obvious test does not work.** On a fresh building the timer ratio and the integrity ratio are equal by construction — ten of forty ticks is also a quarter of the HP — so `expect(progress).toBeCloseTo(0.25)` passes against both implementations and proves nothing. The test has to separate the two, which means a building that is already damaged when the timer starts.

Add inside the `describe('the blade crumbles a building as it works', ...)` block:

```ts
  it('reports progress against the building, not the timer', () => {
    const { sim, s, id } = world(BLADE);
    // Grind to half, drive off, come back: the timer restarts at zero while
    // the building is already half gone. This is the only state in which the
    // two candidate implementations disagree.
    for (let n = 0; n < 20; n++) sim.tick();
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(20.5), y: fx.from(10.5) });
    for (let n = 0; n < 60; n++) sim.tick();
    expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s] / 2);

    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    // Tick until it is back in range and has landed at least one bite.
    for (let n = 0; n < 80 && sim.structures.hp[s] === sim.structures.maxHp[s] / 2; n++) {
      sim.tick();
    }
    expect(sim.structures.alive[s]).toBe(1);
    // The timer says roughly 1/40. The building says just over half.
    expect(sim.demolitionProgress(id)).toBeGreaterThan(0.5);
  });

  it('reports zero for a blade that is not working on anything', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(BLADE);
    const id = sim.spawn(t, 0, fx.from(2.5), fx.from(2.5)); // no building near
    for (let n = 0; n < 10; n++) sim.tick();
    expect(sim.demolitionProgress(id)).toBe(0);
  });
```

The existing test `'reports progress against the unit-s own timer, not the global'` uses `DOZER`, which is `charges`, and must keep passing untouched — that is the guard that the branch did not swallow the timer path.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts -t "reports"
```

Expected: "reports progress against the building, not the timer" FAILS, returning roughly 0.025 — the timer ratio — instead of a value above 0.5. "reports zero for a blade that is not working" passes already (the timer is zero), and stays passing after the change.

- [ ] **Step 3: Branch `demolitionProgress`**

Replace the method in `packages/sim/src/sim.ts`:

```ts
  /** Demolition charge progress 0..1 for the HUD. */
  demolitionProgress(id: number): number {
    const type = this.unitTypes[this.typeIdx[id]];
    if (type.bladeDemolition) {
      // A blade's bar predicts collapse, and what causes collapse is the
      // building running out of HP — not this unit's timer, which knows
      // nothing about damage the building took before the dozer arrived.
      const s = this.demoTarget[id];
      if (s < 0 || this.stAlive[s] === 0) return 0;
      const max = this.stMaxHp[s];
      if (max <= 0) return 0;
      return 1 - this.stHp[s] / max;
    }
    return this.demoTicks[id] / type.demolitionTicks;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/sim/src/demolition.test.ts && pnpm test:determinism
```

Expected: all PASS, including `'reports progress against the unit-s own timer, not the global'` and the Task 3 assertion `expect(sim.demolitionProgress(id)).toBe(0)` — a blade parked away from any building has `demoTarget === -1` and returns 0. Golden hash unchanged: `demolitionProgress` is an accessor and touches no state.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/demolition.test.ts
git commit -m "feat(sim): a blade's HUD bar tracks the building, not its timer"
```

---

### Task 5: The building crumbles on screen

Renderer work. No unit tests per CLAUDE.md — verified by driving the running app in Task 7.

**Files:**
- Modify: `packages/sim/src/sim.ts` (the `state` view type ~line 699 and its construction ~line 836)
- Modify: `packages/render/src/renderer.ts` (private fields ~line 318, the `structureHit` and `structureDestroyed` branches ~lines 622-645)

**Interfaces:**
- Consumes: `structureHit` events from Task 2.
- Produces: `sim.state.demoTarget: Int32Array` — read-only view of the structure each unit is currently demolishing, `-1` when none. Task 6 also consumes it.

**Why the renderer needs `demoTarget`.** It must tell blade work from shellfire so the dust comes off the blade rather than the roof, and it must do so without the sim putting presentation hints in its events. The renderer already reads `sim.state` arrays read-only (`curTarget`, `garrisonedIn`, `curStructure`), so this follows the established pattern and adds no coupling. `demoTarget` is already in the determinism hash (`sim.ts:3058`), so exposing it changes nothing.

- [ ] **Step 1: Expose `demoTarget` on the state view**

In `packages/sim/src/sim.ts`, in the `readonly state: {...}` type declaration, after `curStructure`:

```ts
    /** Structure the unit is currently shooting at, -1 when none. */
    readonly curStructure: Int32Array;
    /** Structure the unit is currently demolishing, -1 when none. */
    readonly demoTarget: Int32Array;
```

and in the object literal that builds it, after `curStructure: this.curStructure,`:

```ts
      curStructure: this.curStructure,
      demoTarget: this.demoTarget,
```

- [ ] **Step 2: Verify the sim still passes**

```bash
pnpm test:determinism && pnpm vitest run packages/sim
```

Expected: PASS, hash unchanged. Exposing an existing array read-only changes no behaviour.

- [ ] **Step 3: Add the renderer's per-structure tracking fields**

In `packages/render/src/renderer.ts`, beside `private terrainDirty = false;` (~line 318):

```ts
  private terrainDirty = false;
  /**
   * Last integrity band (eighths) drawn per structure. drawTerrain rebuilds
   * every tile in the map plus every building and decor sprite, so a hit that
   * does not visibly change the alpha ramp must not trigger it -- a D9 blade
   * emits a structureHit at 20 Hz and would otherwise rebuild the world every
   * tick for the whole demolition.
   */
  private readonly structBand = new Map<number, number>();
  /** Tick of the last dust puff per structure, so two dozers on one building
   *  do not double the dust. */
  private readonly structPuffTick = new Map<number, number>();
```

- [ ] **Step 4: Band the redraw and move the dust to the blade**

Replace the `structureHit` branch (~line 622):

```ts
      } else if (e.kind === 'structureHit') {
        this.terrainDirty = true;
        const s = e.structure;
        this.puffs.push({
          x: fx.toNumber(this.sim.structures.cx[s]),
          y: fx.toNumber(this.sim.structures.cy[s]),
          ttl: 12,
          color: this.opts.nearMissColor,
          r: 9,
        });
      } else if (e.kind === 'structureDestroyed') {
```

with:

```ts
      } else if (e.kind === 'structureHit') {
        const s = e.structure;
        const max = fx.toNumber(this.sim.structures.maxHp[s]);
        // Redraw only when the crumble is actually visible. The building's
        // alpha is 0.55 + 0.45 * hp/maxHp, so eighths is finer than the eye
        // resolves and far cheaper than a rebuild per tick.
        const band = max > 0 ? Math.floor((fx.toNumber(e.hpLeft) / max) * 8) : 0;
        if (this.structBand.get(s) !== band) {
          this.structBand.set(s, band);
          this.terrainDirty = true;
        }
        // A blade throws dust where it is cutting; a shell throws it off the
        // roof. The sim says which without knowing anything about dust.
        const grinding = e.by >= 0 && this.sim.state.demoTarget[e.by] === s;
        if (!grinding) {
          this.puffs.push({
            x: fx.toNumber(this.sim.structures.cx[s]),
            y: fx.toNumber(this.sim.structures.cy[s]),
            ttl: 12,
            color: this.opts.nearMissColor,
            r: 9,
          });
        } else if (e.tick - (this.structPuffTick.get(s) ?? -99) >= 4) {
          this.structPuffTick.set(s, e.tick);
          const a = PixiRenderer.h2(e.tick, s);
          this.puffs.push({
            x: this.curX[e.by] + (a - 0.5) * 6,
            y: this.curY[e.by] + (a - 0.5) * 3,
            ttl: 14,
            color: this.opts.nearMissColor,
            r: 7,
          });
        }
      } else if (e.kind === 'structureDestroyed') {
```

- [ ] **Step 5: Drop the tracking when the building goes down**

In the `structureDestroyed` branch, directly after `const s = e.structure;`:

```ts
        const s = e.structure;
        this.structBand.delete(s);
        this.structPuffTick.delete(s);
```

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm lint && pnpm test
```

Expected: PASS. `pnpm validate:ui` is not needed — no colour literal is introduced; the puffs reuse `this.opts.nearMissColor`.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/sim.ts packages/render/src/renderer.ts
git commit -m "feat(render): band the crumble redraw and throw dust off the blade"
```

---

### Task 6: The combat log stops shouting

**Files:**
- Modify: `packages/render/src/overlay.ts` (private fields ~line 36, the `structureHit` case ~line 166)

**Interfaces:**
- Consumes: `sim.state.demoTarget` from Task 5; `structureHit` events from Task 2.
- Produces: nothing.

**A refinement on the spec, called out for review.** The spec says to coalesce `structureHit` onto band crossings. Applied to *every* structure hit, that would silence a mortar shell that takes 5% off a warehouse — and this file's own header calls it "the primary development instrument", where every roll is shown. So coalesce only grinding hits, identified the same way the renderer identifies them. Shellfire keeps its line-per-hit exactly as today.

- [ ] **Step 1: Add the accumulator field**

In `packages/render/src/overlay.ts`, with the other private fields of `DebugOverlay` (after `private visible = false;`):

```ts
  /**
   * Damage summed since the last feed line, per structure, with the integrity
   * band we were in when we last spoke. A blade lands a hit every tick; one
   * line per eighth of the building is enough to follow, and forty lines in
   * two seconds is not.
   */
  private readonly grind = new Map<number, { dmg: number; band: number }>();
```

- [ ] **Step 2: Coalesce grinding hits**

Replace the `structureHit` case (~line 166):

```ts
      case 'structureHit':
        this.line(
          t + `${this.structName(e.structure)} takes ${fmt(e.damage, 0)} — ${fmt(e.hpLeft, 0)} left`,
          'var(--ink-mute)'
        );
        break;
```

with:

```ts
      case 'structureHit': {
        // Shellfire keeps a line per hit: this panel exists to show every
        // roll. Only a blade, which hits at tick rate, gets coalesced.
        const grinding = e.by >= 0 && this.sim.state.demoTarget[e.by] === e.structure;
        if (!grinding) {
          this.line(
            t + `${this.structName(e.structure)} takes ${fmt(e.damage, 0)} — ${fmt(e.hpLeft, 0)} left`,
            'var(--ink-mute)'
          );
          break;
        }
        const max = fx.toNumber(this.sim.structures.maxHp[e.structure]);
        const band = max > 0 ? Math.floor((fx.toNumber(e.hpLeft) / max) * 8) : 0;
        const acc = this.grind.get(e.structure) ?? { dmg: 0, band: 8 };
        acc.dmg += fx.toNumber(e.damage);
        if (band !== acc.band) {
          this.line(
            t + `${this.structName(e.structure)} ground down ${acc.dmg.toFixed(0)} — ${fmt(e.hpLeft, 0)} left`,
            'var(--ink-mute)'
          );
          acc.dmg = 0;
          acc.band = band;
        }
        this.grind.set(e.structure, acc);
        break;
      }
```

- [ ] **Step 3: Drop the accumulator on collapse**

In the `structureDestroyed` case, before the existing `this.line(...)`:

```ts
      case 'structureDestroyed':
        this.grind.delete(e.structure);
        this.line(t + `${this.structName(e.structure)} <b>COLLAPSES</b>`, 'var(--hot)');
        break;
```

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm lint && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/overlay.ts
git commit -m "feat(render): coalesce a blade's grinding into one line per band"
```

---

### Task 7: Verify it in the running app

The renderer and overlay changes have no unit tests, so this is where they are actually confirmed. Drive the real UI — spawn a D9 and watch it work. Console shortcuts such as `window.__lions.step(n)` skip the input and selection code that is most likely to be broken, so use them only to *advance* time after driving the actual controls, never in place of them.

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing.

- [ ] **Step 1: Run the full gate**

```bash
pnpm lint && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui
```

Expected: all PASS, golden determinism hash **unchanged**. If the hash moved, stop and find what leaked into the `charges` path — do not update the hash.

- [ ] **Step 2: Confirm the balance backtest is unaffected**

```bash
pnpm balance
```

Expected: the §5.7 targets still pass. The D9 carries no weapons and demolition is not part of the backtest, so this should be unchanged — but the spec says confirm rather than assume. If win rates moved, something in the shared damage path changed for units that are not dozers.

- [ ] **Step 3: Start the app**

```bash
pnpm dev
```

Open the preview. **Start it from the primary working directory** — a dev server launched from elsewhere serves a different tree and the feature will look broken for reasons that have nothing to do with this change.

- [ ] **Step 4: Drive a D9 onto a building**

Using the mouse and keyboard, not the console: load a mission that fields a `dozer_d9`, select the dozer, and order it against a building — a plain house first, not a protected site. Watch through one full demolition.

Confirm, in this order:
1. The building visibly darkens in steps as the dozer works, rather than staying pristine and vanishing.
2. Dust rises from the dozer, not from the middle of the roof.
3. The HUD demolition bar fills over the two seconds and the building falls as it completes.
4. The building collapses to rubble and the garrison, if any, dies with it.

- [ ] **Step 5: Confirm the log with the debug overlay**

Press `o` to open the debug overlay and repeat a demolition. Expect a handful of `ground down N — M left` lines across the demolition, not one per tick. Shoot a building with a tank in the same session and confirm those hits still log one line each.

- [ ] **Step 6: Confirm the interesting case**

Shoot a building down to roughly half with a tank, then send the D9 at it. It must fall noticeably sooner than a fresh one, and the HUD bar must start partway along rather than at zero.

- [ ] **Step 7: Confirm the guard still holds**

Park the D9 beside a mosque with no order given. It must not grind it. Then explicitly right-click/designate the mosque for demolition — it must come down, and the ROE penalty must land.

- [ ] **Step 8: Commit anything the drive-through turned up**

If steps 4-7 were clean, there is nothing to commit and the feature is done. If a defect surfaced, fix it, re-run Step 1, and commit with a message naming what the app run caught.

---

## Notes for the implementer

- **The one thing most likely to go wrong** is putting the bite outside the `else` branch in Task 2. If it runs on the final tick too, `fx.div` truncation stops mattering, the fresh-building test still passes, and nothing visibly breaks — but a building that happens to land exactly on zero one tick early falls at 39 instead of 40, and the failure surfaces later as a flaky-looking timing test.
- **Do not "fix" a determinism hash change.** Every gate in this plan asserts the hash is unchanged, because no shipped unit is `blade`. A change means the `charges` path moved.
- **Out of scope, deliberately:** no new art or mid-damage sprite frames; no per-tile collapse of a footprint; no audio; garrison occupants still die on collapse with no chance to bail. If any of these feel necessary while implementing, raise it rather than adding it.
