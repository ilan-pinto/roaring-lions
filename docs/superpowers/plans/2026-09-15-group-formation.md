# Group Formations and Destination Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Units ordered to the same point stop on distinct tiles in a formation: vehicles and aircraft in spaced front ranks on the clicked row, infantry one team per tile behind, a column in a street and a block in the open, with two separate orders never landing on one tile.

**Architecture:** A pure slot function in `packages/sim/src/formation.ts` turns (masks, click tile, centroid, reservations, units) into one tile per id. `Sim.applyCommands`' move / attack-move branch calls it once per command, derives the reservation set by scanning same-side units at that moment, and writes per-unit goals and per-slot flow fields. The flow-field cache is bounded first, because slots multiply fields. The app, the renderer and the command format are untouched.

**Tech Stack:** TypeScript strict, `@lions/sim` fixed-point (`fx`), vitest, the existing `tools/src` walk and Playwright capture patterns.

**Spec:** `docs/superpowers/specs/2026-09-15-group-formation-design.md` — the binding authority; every number below is copied from it.

## Global Constraints

- `packages/sim` is Q16.16 fixed-point: no `Math.*` except on plain integers (tile indices, counts) — `Math.abs` on tile deltas is an integer op and is allowed by lint; no `Math.random`, no `Date`. Verify with `pnpm lint`.
- No `any`; no non-null assertions in sim code.
- Every algorithm is deterministic: ids processed sorted ascending; neighbours visited N, E, S, W; no RNG stream touched.
- Constants and their values (spec §4.1): `MAX_LATERAL = 3`, `VEHICLE_SPACING = 2`, `INFANTRY_SPACING = 1`, `VEHICLE_TO_INFANTRY_GAP = 1`, `SEARCH_RADIUS = 8`.
- Front ranks = units whose type `isAir` or whose `moveDomain === DOMAIN_VEHICLE`; everyone else is infantry (rear).
- Air units path and take slots on the foot mask (`DOMAIN_FOOT`), spaced like vehicles.
- The command shape `{ kind: 'move' | 'attackMove', ids, x, y, append? }` does not change; `packages/app` and `packages/render` are not edited.
- The golden hashes in `packages/sim/src/determinism.test.ts` (lines 381 and 628) are re-pinned only in the commit that changes goal assignment, with the reason in the test's own comment.
- `pnpm playtest` must stay green (every mission its expected verdict) and `pnpm balance` targets must stay inside their bands; a target outside its band STOPS the task and is reported, never retuned.
- Commit trailer, verbatim, last line of every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Use `/usr/bin/git` by absolute path, one plain git command per Bash call, explicit pathspecs; never `git add -A`; never `git checkout -- <file>` to undo an edit.

---

## File structure

- Create `packages/sim/src/formation.ts` — the pure slot function and its five constants. One responsibility: geometry and reachability; no `Sim` import.
- Create `packages/sim/src/formation.test.ts` — the geometry tests on hand-built masks.
- Modify `packages/sim/src/flowfield.ts` — the two heap arrays become shared compute scratch (Task 1).
- Modify `packages/sim/src/sim.ts` — `fieldFor` gains a bound with reuse (Task 1); the move / attack-move branch calls `assignFormation` (Task 3).
- Modify `packages/sim/src/sim.test.ts` — integration tests for arrival tiles (Task 3).
- Modify `packages/sim/src/determinism.test.ts` — the two re-pinned hashes with reasons (Task 3).
- Create `tools/src/formation_walk.test.ts` — the world-state walk on a shipped mission (Task 4).
- Create `tools/src/perf/formation-captures.ts` — the screenshot sheet script (Task 4).
- Modify `CLAUDE.md`, `docs/GDD.md`, the spec's Deviations section (Task 4).

---

### Task 1: Bound the flow-field cache and share the compute scratch

**Files:**
- Modify: `packages/sim/src/flowfield.ts:29-68` (constructor allocations, `compute`)
- Modify: `packages/sim/src/sim.ts:1046-1057` (`fields`, `fieldByGoal`), `sim.ts:1722-1734` (`fieldFor`), `sim.ts:1262-1270` (`recomputeFields`), `sim.ts:1248-1252` (`flowFieldCount`)
- Test: `packages/sim/src/flowfield.test.ts` (existing — must stay green unchanged), `packages/sim/src/sim.test.ts` (new `describe('flow-field cache')`)

**Interfaces:**
- Consumes: `FlowField.compute(blocked, elevation, gx, gy)`, `Sim.fieldFor(gx, gy, domain): number`, `Sim.flowFieldCount`.
- Produces: `MAX_FLOW_FIELDS` (exported from `sim.ts`, value 128), `Sim.fieldFor` unchanged in signature and in the index it returns for a cached goal; a field index held by a living unit's `fieldRef` is never reused.

Why first: a FlowField today allocates `dirs` (1 byte/cell), `cost` (4 bytes/cell) and two heap arrays of 8 × 4 bytes/cell each — on a 48×48 map that is about 160 KB per field, of which 147 KB is scratch used only inside `compute`. The pool never evicts (`sim.ts:1050-1056` says so). Slots turn one field per click into one per unit, so both halves are fixed here: the scratch is shared, and the pool reuses its least-recently-issued unreferenced field once it holds `MAX_FLOW_FIELDS`.

- [ ] **Step 1: Write the failing cache test**

Append to `packages/sim/src/sim.test.ts`:

```ts
import { MAX_FLOW_FIELDS } from './sim';

describe('flow-field cache', () => {
  it('never holds more than MAX_FLOW_FIELDS fields when goals are one-shot', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(1), fx.fromInt(1));
    // Each order lands on a fresh tile; the unit never arrives, so the
    // previous goal's field is unreferenced the moment the next lands.
    for (let k = 0; k < MAX_FLOW_FIELDS + 40; k++) {
      const gx = 2 + (k % 28);
      const gy = 2 + Math.floor(k / 28);
      sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(gx), y: fx.fromInt(gy) });
      sim.tick();
    }
    expect(sim.flowFieldCount).toBeLessThanOrEqual(MAX_FLOW_FIELDS);
  });

  it('never reuses a field a living unit still follows', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const ids: number[] = [];
    for (let i = 0; i < MAX_FLOW_FIELDS + 8; i++) ids.push(sim.spawn(t, 0, fx.fromInt(1), fx.fromInt(1 + (i % 30))));
    // Every unit gets its own goal tile, so every field is referenced.
    for (let i = 0; i < ids.length; i++) {
      sim.queueCommand({ kind: 'move', ids: [ids[i]], x: fx.fromInt(2 + (i % 28)), y: fx.fromInt(2 + Math.floor(i / 28)) });
    }
    sim.tick();
    // The pool had to grow past the cap rather than steal a live field.
    expect(sim.flowFieldCount).toBe(ids.length);
    // And every unit is still walking toward ITS goal, not somebody else's.
    for (let k = 0; k < 5; k++) sim.tick();
    for (let i = 0; i < ids.length; i++) expect(sim.state.moving[ids[i]]).toBe(1);
  });
});
```

`makeSim` is 32×32 with capacity 64; the second test needs more: change `makeSim` to `function makeSim(seed = 42, capacity = 64): Sim { return new Sim({ seed, width: 32, height: 32, capacity }); }` and call `makeSim(42, 256)` in that test.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/sim/src/sim.test.ts -t "flow-field cache"`
Expected: FAIL — `MAX_FLOW_FIELDS` is not exported (compile error), or the count test reads `MAX_FLOW_FIELDS + 40`.

- [ ] **Step 3: Share the compute scratch in `flowfield.ts`**

Replace the two per-instance heap arrays with a module-level scratch grown to the largest map seen:

```ts
/**
 * Scratch for `compute`'s heap, shared by every field. A field used to own
 * two Int32Arrays of 8 cells each — 147 KB of the 160 KB a 48×48 field cost —
 * for a heap that is empty between calls. `compute` is synchronous and the sim
 * is single-threaded, so one scratch serves every field in every Sim.
 */
let scratchTile = new Int32Array(0);
let scratchCost = new Int32Array(0);
function scratchFor(cells: number): void {
  const need = cells * 8;
  if (scratchTile.length < need) {
    scratchTile = new Int32Array(need);
    scratchCost = new Int32Array(need);
  }
}
```

In the constructor delete `this.heapTile = ...` and `this.heapCost = ...` and their field declarations; at the top of `compute`, call `scratchFor(this.width * this.height)` and use `scratchTile` / `scratchCost` where the method used `this.heapTile` / `this.heapCost`. Nothing about the algorithm changes: the heap is cleared/rewritten from index 0 on every `compute` today (read the method to confirm the heap size counter starts at 0; if it does not, set it).

- [ ] **Step 4: Bound the pool in `sim.ts`**

Add the constant beside `MAX_WAYPOINTS` (`sim.ts:687`):

```ts
/** Flow fields kept alive at once. Slots give every unit in an order its own
 *  goal tile (formation.ts), so a twelve-unit order can want twelve fields
 *  where it used to want one. Beyond this many, `fieldFor` reuses the
 *  least-recently-issued field that no living unit still follows; it only
 *  grows past this when every field is live, which takes more distinct
 *  goals than there are units. 128 × ~11.5 KB on a 48×48 map is 1.5 MB. */
export const MAX_FLOW_FIELDS = 128;
```

Add two private arrays beside `fields` (`sim.ts:1046`):

```ts
  /** Tick each field was last handed out by `fieldFor`; the eviction key. */
  private readonly fieldLastIssued: number[] = [];
  /** Goal key of each field, so eviction can drop it from `fieldByGoal`. */
  private readonly fieldGoalKey: number[] = [];
  private readonly fieldDomain: number[] = [];
```

Replace `fieldFor` (`sim.ts:1722-1734`) with:

```ts
  private fieldFor(gx: number, gy: number, domain: number): number {
    const d = this.hasBoulders ? domain : DOMAIN_FOOT;
    const byGoal = this.fieldByGoal[d];
    const key = gy * this.width + gx;
    const existing = byGoal.get(key);
    if (existing !== undefined) {
      this.fieldLastIssued[existing] = this.tickCount;
      return existing;
    }
    let idx = this.fields.length >= MAX_FLOW_FIELDS ? this.evictableField() : -1;
    if (idx < 0) {
      idx = this.fields.length;
      this.fields.push(new FlowField(this.width, this.height));
    } else {
      this.fieldByGoal[this.fieldDomain[idx]].delete(this.fieldGoalKey[idx]);
    }
    this.fields[idx].compute(this.maskFor(d), this.elevation, gx, gy);
    this.fieldLastIssued[idx] = this.tickCount;
    this.fieldGoalKey[idx] = key;
    this.fieldDomain[idx] = d;
    byGoal.set(key, idx);
    return idx;
  }

  /** The least-recently-issued field no living unit follows, or -1 when
   *  every field is live. O(units + fields) per call, and a call happens at
   *  most once per order once the pool is full. */
  private evictableField(): number {
    const live = new Uint8Array(this.fields.length);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const f = this.fieldRef[i];
      if (f >= 0) live[f] = 1;
    }
    let best = -1;
    for (let f = 0; f < this.fields.length; f++) {
      if (live[f] === 1) continue;
      if (best < 0 || this.fieldLastIssued[f] < this.fieldLastIssued[best]) best = f;
    }
    return best;
  }
```

`recomputeFields` (`sim.ts:1262-1270`) is unchanged: it iterates `fieldByGoal`, which eviction keeps consistent. Update the two doc comments that say the pool never evicts (`sim.ts:1050-1056` and the `flowFieldCount` getter at `1248-1252`) to say what it does now.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/sim/src/sim.test.ts packages/sim/src/flowfield.test.ts`
Expected: PASS, including every pre-existing flow-field test (the dirs are bit-identical; only where the heap lives changed).

- [ ] **Step 6: Run the determinism canary and lint**

Run: `pnpm test:determinism && pnpm lint && pnpm typecheck`
Expected: PASS with the hashes UNCHANGED — `fields` and `fieldRef` are not hashed, and no goal moved. If the hash moved, the scratch change altered a field's dirs: stop and find out why before going on.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/sim/src/flowfield.ts packages/sim/src/sim.ts packages/sim/src/sim.test.ts
/usr/bin/git commit -m "perf(sim): bound the flow-field pool at 128 with live-safe reuse, and share compute's heap scratch" -m "A FlowField on a 48x48 map cost about 160 KB, of which 147 KB was two heap arrays used only inside compute() and empty between calls; they are one shared scratch now. The pool never evicted (one field per distinct goal tile for the mission's life); group formations (the next commits) give every unit in an order its own goal tile, so fieldFor now reuses the least-recently-issued field no living unit follows once the pool holds MAX_FLOW_FIELDS, and grows only when every field is live. Dirs are bit-identical; the golden hash did not move." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The slot function

**Files:**
- Create: `packages/sim/src/formation.ts`
- Test: `packages/sim/src/formation.test.ts`

**Interfaces:**
- Consumes: nothing from `Sim`. `DOMAIN_FOOT`/`DOMAIN_VEHICLE` are imported from `./sim` as numbers only (0 and 1); if that import creates a cycle that vitest complains about, define `const FOOT = 0, VEHICLE = 1` locally and pin them equal to the sim's constants in the test.
- Produces (used verbatim by Task 3):

```ts
export interface FormationUnit { id: number; domain: number; front: boolean }
export interface FormationInput {
  width: number;
  height: number;
  /** Passability per domain, indexed by domain number; 0 = open. */
  masks: readonly Uint8Array[];
  /** Per domain: the tile the reachability walk starts from — the click tile
   *  snapped to open ground for that domain (`Sim.nearestOpenTile`). */
  origins: readonly (readonly [number, number])[];
  /** The foot-snapped click tile: lateral offset 0 of the front rank. */
  clickX: number;
  clickY: number;
  /** The tile the group is coming from (an integer centroid). */
  fromX: number;
  fromY: number;
  units: readonly FormationUnit[];
  /** 1 where a same-side unit outside this order stands or is bound. */
  reserved: Uint8Array;
}
export interface Slot { id: number; x: number; y: number }
export function assignFormation(input: FormationInput): Slot[]
```

- [ ] **Step 1: Write the failing tests**

`packages/sim/src/formation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assignFormation,
  INFANTRY_SPACING,
  MAX_LATERAL,
  SEARCH_RADIUS,
  VEHICLE_SPACING,
  VEHICLE_TO_INFANTRY_GAP,
  type FormationInput,
  type FormationUnit,
  type Slot,
} from './formation';

const FOOT = 0;
const VEHICLE = 1;
const W = 24;
const H = 24;

function open(): Uint8Array {
  return new Uint8Array(W * H);
}
/** A vertical street two tiles wide at x = 10..11, walls either side. */
function street(): Uint8Array {
  const m = open();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 10 || x > 11) m[y * W + x] = 1;
  return m;
}
function units(vehicles: number, infantry: number, firstId = 0): FormationUnit[] {
  const out: FormationUnit[] = [];
  let id = firstId;
  for (let i = 0; i < vehicles; i++) out.push({ id: id++, domain: VEHICLE, front: true });
  for (let i = 0; i < infantry; i++) out.push({ id: id++, domain: FOOT, front: false });
  return out;
}
function input(over: Partial<FormationInput>): FormationInput {
  const foot = open();
  return {
    width: W,
    height: H,
    masks: [foot, foot],
    origins: [
      [12, 12],
      [12, 12],
    ],
    clickX: 12,
    clickY: 12,
    fromX: 12,
    fromY: 20, // approaching from the south: forward is -y, ranks form toward +y
    units: units(4, 11),
    reserved: new Uint8Array(W * H),
    ...over,
  };
}
const key = (s: Slot): string => `${s.x},${s.y}`;
const byId = (slots: Slot[]): Map<number, Slot> => new Map(slots.map((s) => [s.id, s]));

describe('assignFormation on open ground', () => {
  it('puts three spaced vehicles on the clicked row, one two rows back, infantry behind', () => {
    const slots = assignFormation(input({}));
    expect(slots).toHaveLength(15);
    expect(new Set(slots.map(key)).size).toBe(15);
    const m = byId(slots);
    // Front rank: the click tile and ±VEHICLE_SPACING beside it, on the clicked row.
    expect([m.get(0), m.get(1), m.get(2)].map((s) => `${s?.x},${s?.y}`).sort()).toEqual(
      ['10,12', '12,12', '14,12'].sort()
    );
    // The fourth vehicle sits VEHICLE_SPACING rows behind (toward the group), at offset 0.
    expect(m.get(3)).toMatchObject({ x: 12, y: 12 + VEHICLE_SPACING });
    // Infantry starts one row behind the last vehicle rank and fills 7 wide, then 4.
    const infantryY = 12 + VEHICLE_SPACING + VEHICLE_TO_INFANTRY_GAP;
    const row1 = slots.filter((s) => s.id >= 4 && s.y === infantryY);
    const row2 = slots.filter((s) => s.id >= 4 && s.y === infantryY + INFANTRY_SPACING);
    expect(row1).toHaveLength(2 * MAX_LATERAL + 1);
    expect(row2).toHaveLength(4);
    expect(row1.map((s) => s.x).sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it('is the click tile for a single unit, and the nearest free tile when the click is reserved', () => {
    const one = assignFormation(input({ units: units(0, 1) }));
    expect(one).toEqual([{ id: 0, x: 12, y: 12 }]);
    const reserved = new Uint8Array(W * H);
    reserved[12 * W + 12] = 1;
    const beside = assignFormation(input({ units: units(0, 1), reserved }));
    expect(beside).toHaveLength(1);
    expect(key(beside[0])).not.toBe('12,12');
    expect(Math.abs(beside[0].x - 12) + Math.abs(beside[0].y - 12)).toBe(1);
  });

  it('rotates the grid for each approach direction, front rank on the click', () => {
    const fromWest = byId(assignFormation(input({ fromX: 2, fromY: 12 })));
    // Forward is +x, so the fourth vehicle sits VEHICLE_SPACING tiles WEST of the click.
    expect(fromWest.get(3)).toMatchObject({ x: 12 - VEHICLE_SPACING, y: 12 });
    const fromEast = byId(assignFormation(input({ fromX: 22, fromY: 12 })));
    expect(fromEast.get(3)).toMatchObject({ x: 12 + VEHICLE_SPACING, y: 12 });
    const fromNorth = byId(assignFormation(input({ fromX: 12, fromY: 2 })));
    expect(fromNorth.get(3)).toMatchObject({ x: 12, y: 12 - VEHICLE_SPACING });
    // The clicked tile is always offset 0 of the front rank.
    for (const m of [fromWest, fromEast, fromNorth]) expect(m.get(0)).toMatchObject({ x: 12, y: 12 });
  });

  it('gives the same tiles when the ids arrive shuffled', () => {
    const a = assignFormation(input({}));
    const shuffled = [...units(4, 11)].reverse();
    const b = assignFormation(input({ units: shuffled }));
    expect(byId(b)).toEqual(byId(a));
  });
});

describe('assignFormation in a street', () => {
  it('forms a column: vehicles at the head, infantry behind, nothing on a wall', () => {
    const s = street();
    const slots = assignFormation(
      input({ masks: [s, s], clickX: 10, clickY: 4, fromX: 10, fromY: 20, origins: [[10, 4], [10, 4]] })
    );
    expect(new Set(slots.map(key)).size).toBe(15);
    for (const sl of slots) expect(s[sl.y * W + sl.x]).toBe(0);
    const m = byId(slots);
    // The four vehicles hold the head of the column, one every two rows.
    expect([0, 1, 2, 3].map((id) => `${m.get(id)?.x},${m.get(id)?.y}`)).toEqual(['10,4', '10,6', '10,8', '10,10']);
    // Infantry fills the ranks behind and the gaps between the vehicles, and
    // overflow is behind-first: nothing stands ahead of the click, and nothing
    // wider than the street.
    for (const sl of slots) {
      expect(sl.y).toBeGreaterThanOrEqual(4);
      expect(sl.x === 10 || sl.x === 11).toBe(true);
    }
  });
});

describe('assignFormation with a boulder corridor', () => {
  it('puts infantry inside the field and vehicles at its mouth', () => {
    const foot = open();
    const vehicle = open();
    // Boulders on x = 8..15, y = 4..11: open to feet, a wall to vehicles.
    for (let y = 4; y <= 11; y++) for (let x = 8; x <= 15; x++) vehicle[y * W + x] = 1;
    const slots = assignFormation(
      input({
        masks: [foot, vehicle],
        clickX: 12,
        clickY: 8,
        fromX: 12,
        fromY: 20,
        origins: [
          [12, 8],
          [12, 12], // the vehicle click snapped south of the field
        ],
      })
    );
    const m = byId(slots);
    for (const id of [0, 1, 2, 3]) {
      const s = m.get(id);
      expect(s && vehicle[s.y * W + s.x]).toBe(0);
    }
    const inside = slots.filter((sl) => sl.id >= 4 && sl.y >= 4 && sl.y <= 11 && sl.x >= 8 && sl.x <= 15);
    expect(inside.length).toBeGreaterThan(0);
  });
});

describe('assignFormation reservation, air and overflow', () => {
  it('skips reserved tiles so two groups on one click get disjoint tiles', () => {
    const first = assignFormation(input({}));
    const reserved = new Uint8Array(W * H);
    for (const s of first) reserved[s.y * W + s.x] = 1;
    const second = assignFormation(input({ units: units(4, 11, 100), reserved }));
    const firstKeys = new Set(first.map(key));
    for (const s of second) expect(firstKeys.has(key(s))).toBe(false);
    expect(new Set(second.map(key)).size).toBe(15);
  });

  it('spaces an air unit like a vehicle in the front rank, on the foot mask', () => {
    const s = street();
    const vehicleMask = new Uint8Array(W * H).fill(1); // no vehicle can stand anywhere
    const air: FormationUnit = { id: 0, domain: FOOT, front: true };
    const slots = assignFormation(
      input({ masks: [s, vehicleMask], clickX: 10, clickY: 4, fromX: 10, fromY: 20, origins: [[10, 4], [10, 4]], units: [air, { id: 1, domain: FOOT, front: false }] })
    );
    const m = byId(slots);
    expect(m.get(0)).toMatchObject({ x: 10, y: 4 });
    // Infantry starts VEHICLE_TO_INFANTRY_GAP behind the front rank.
    expect(m.get(1)?.y).toBe(4 + VEHICLE_TO_INFANTRY_GAP);
  });

  it('overflows to the nearest free reachable tiles, then to the origin', () => {
    // Box the click into a 3×3 pocket: 9 free tiles for 12 infantry.
    const foot = open().fill(1);
    for (let y = 11; y <= 13; y++) for (let x = 11; x <= 13; x++) foot[y * W + x] = 0;
    const slots = assignFormation(input({ masks: [foot, foot], units: units(0, 12) }));
    const distinct = new Set(slots.map(key));
    expect(distinct.size).toBe(9);
    // The three that found nothing keep the origin.
    expect(slots.filter((s) => key(s) === '12,12')).toHaveLength(4);
  });

  it('never places a slot farther than SEARCH_RADIUS + MAX_LATERAL walking steps from the origin', () => {
    const slots = assignFormation(input({ units: units(6, 40) }));
    for (const s of slots) expect(Math.abs(s.x - 12) + Math.abs(s.y - 12)).toBeLessThanOrEqual(SEARCH_RADIUS + MAX_LATERAL);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/sim/src/formation.test.ts`
Expected: FAIL — module `./formation` not found.

- [ ] **Step 3: Write `formation.ts`**

```ts
/**
 * Destination slots for a group order — spec
 * docs/superpowers/specs/2026-09-15-group-formation-design.md §4.1–4.2.
 *
 * Pure: masks and tiles in, one tile per id out. No Sim, no RNG, ids sorted,
 * neighbours visited N, E, S, W, so two runs from the same state pick the
 * same tiles (invariant 3, without touching any stream).
 *
 * The frame: the approach direction is the centroid→click vector quantised to
 * an axis; the front rank is the row through the click tile, perpendicular
 * to it; ranks step back toward the group. Vehicles and aircraft ("front")
 * fill the leading ranks with VEHICLE_SPACING between them in both axes;
 * infantry ("rear") fills the ranks behind one per tile. A slot is valid when
 * its tile is open for the unit's domain AND reachable from that domain's
 * origin within the walk bound, so a street walls the lateral offsets off and
 * the grid degenerates into a column with no street detector at all.
 */

/** Widest a rank gets: offsets 0, ±1 … ±MAX_LATERAL — 7 tiles, 7 infantry or 3 vehicles. */
export const MAX_LATERAL = 3;
/** Between vehicles sideways and between vehicle ranks: a tank is about a tile long. */
export const VEHICLE_SPACING = 2;
/** One team per tile, ranks one tile apart. */
export const INFANTRY_SPACING = 1;
/** The first infantry rank sits this many rows behind the last vehicle rank. */
export const VEHICLE_TO_INFANTRY_GAP = 1;
/** Ranks are tried this far behind the click; beyond it the unit overflows. */
export const SEARCH_RADIUS = 8;
/** The reachability walk's depth: a rank at SEARCH_RADIUS plus a full lateral offset. */
const WALK_DEPTH = SEARCH_RADIUS + MAX_LATERAL;

export interface FormationUnit {
  id: number;
  domain: number;
  /** A vehicle or an aircraft: takes the front ranks with vehicle spacing. */
  front: boolean;
}

export interface FormationInput {
  width: number;
  height: number;
  /** Passability per domain, indexed by domain number; 0 = open. */
  masks: readonly Uint8Array[];
  /** Per domain: the tile the reachability walk starts from — the click tile
   *  snapped to open ground for that domain. */
  origins: readonly (readonly [number, number])[];
  /** The foot-snapped click tile: lateral offset 0 of the front rank. */
  clickX: number;
  clickY: number;
  /** The tile the group is coming from (an integer centroid). */
  fromX: number;
  fromY: number;
  units: readonly FormationUnit[];
  /** 1 where a same-side unit outside this order stands or is bound. */
  reserved: Uint8Array;
}

export interface Slot {
  id: number;
  x: number;
  y: number;
}

/** Tiles reachable from `origin` over open tiles within WALK_DEPTH steps, in
 *  the order they were reached — the overflow order — plus a per-tile flag. */
interface Reach {
  order: number[];
  hit: Uint8Array;
}

function walk(mask: Uint8Array, w: number, h: number, origin: readonly [number, number]): Reach {
  const hit = new Uint8Array(w * h);
  const order: number[] = [];
  const [ox, oy] = origin;
  if (ox < 0 || oy < 0 || ox >= w || oy >= h || mask[oy * w + ox] !== 0) return { order, hit };
  const queue: number[] = [oy * w + ox];
  const depth: number[] = [0];
  hit[oy * w + ox] = 1;
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q];
    order.push(t);
    const d = depth[q];
    if (d === WALK_DEPTH) continue;
    const x = t % w;
    const y = (t - x) / w;
    // N, E, S, W — fixed, so the overflow order is the same on every run.
    const nx = [x, x + 1, x, x - 1];
    const ny = [y - 1, y, y + 1, y];
    for (let k = 0; k < 4; k++) {
      if (nx[k] < 0 || ny[k] < 0 || nx[k] >= w || ny[k] >= h) continue;
      const n = ny[k] * w + nx[k];
      if (hit[n] === 1 || mask[n] !== 0) continue;
      hit[n] = 1;
      queue.push(n);
      depth.push(d + 1);
    }
  }
  return { order, hit };
}

/** 0, +s, −s, +2s, −2s … while the offset fits inside MAX_LATERAL. */
function lateralOffsets(spacing: number): number[] {
  const out = [0];
  for (let k = spacing; k <= MAX_LATERAL; k += spacing) out.push(k, -k);
  return out;
}

export function assignFormation(input: FormationInput): Slot[] {
  const w = input.width;
  const h = input.height;
  // The frame: forward (fx, fy) is the axis-quantised approach; lateral
  // (rx, ry) is forward turned a quarter turn, fixed so the fill order is.
  const dx = input.clickX - input.fromX;
  const dy = input.clickY - input.fromY;
  let fwdX = 0;
  let fwdY = 0;
  if (Math.abs(dx) >= Math.abs(dy)) fwdX = dx < 0 ? -1 : 1;
  else fwdY = dy < 0 ? -1 : 1;
  const latX = -fwdY;
  const latY = fwdX;

  const reach: Reach[] = input.masks.map((mask, d) => walk(mask, w, h, input.origins[d]));
  const taken = new Uint8Array(w * h);
  const out: Slot[] = [];
  const sorted = [...input.units].sort((a, b) => a.id - b.id);
  const front = sorted.filter((u) => u.front);
  const rear = sorted.filter((u) => !u.front);

  const usable = (u: FormationUnit, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const t = y * w + x;
    return reach[u.domain].hit[t] === 1 && input.reserved[t] === 0 && taken[t] === 0;
  };
  const place = (u: FormationUnit, x: number, y: number): void => {
    taken[y * w + x] = 1;
    out.push({ id: u.id, x, y });
  };

  // Phase 1: the grid. Rank r sits r tiles behind its anchor; a slot is the
  // anchor plus the lateral offset along (latX, latY) minus r along forward.
  // A FRONT unit anchors at its own domain's origin — the click tile snapped
  // to ground a vehicle can hold, which is the click itself whenever the
  // click is vehicle-open — so a click inside a boulder field puts the
  // vehicles on the nearest ground they can stand on and leaves the click to
  // the infantry (spec §4.2's corridor). Infantry always anchors at the click,
  // and starts behind the last front rank only when that rank was anchored
  // at the click too; otherwise the two grids are apart and it starts at 0.
  let lastFrontRankAtClick = -1;
  let fi = 0;
  const frontLateral = lateralOffsets(VEHICLE_SPACING);
  for (let r = 0; r <= SEARCH_RADIUS && fi < front.length; r += VEHICLE_SPACING) {
    for (let k = 0; k < frontLateral.length && fi < front.length; k++) {
      const u = front[fi];
      const [ax, ay] = input.origins[u.domain];
      const l = frontLateral[k];
      const x = ax + l * latX - r * fwdX;
      const y = ay + l * latY - r * fwdY;
      if (!usable(u, x, y)) continue;
      place(u, x, y);
      fi++;
      if (ax === input.clickX && ay === input.clickY) lastFrontRankAtClick = r;
    }
  }
  const rearStart = lastFrontRankAtClick < 0 ? 0 : lastFrontRankAtClick + VEHICLE_TO_INFANTRY_GAP;
  let ri = 0;
  const rearLateral = lateralOffsets(INFANTRY_SPACING);
  for (let r = rearStart; r <= SEARCH_RADIUS && ri < rear.length; r += INFANTRY_SPACING) {
    for (let k = 0; k < rearLateral.length && ri < rear.length; k++) {
      const l = rearLateral[k];
      const x = input.clickX + l * latX - r * fwdX;
      const y = input.clickY + l * latY - r * fwdY;
      if (!usable(rear[ri], x, y)) continue;
      place(rear[ri], x, y);
      ri++;
    }
  }

  // Phase 2: overflow. The nearest free reachable tile in walk order, spacing
  // dropped — behind-first: a tile AHEAD of the front rank (a positive
  // projection onto the approach direction from the click) is taken only
  // when nothing at or behind the click is free, so a column's tail fills
  // the gaps between the spaced vehicles before it spills past the head.
  // A unit that finds none keeps its origin — the one way two units can
  // still share a tile, and it takes more units than free ground.
  const ahead = (t: number): boolean => {
    const x = t % w;
    const y = (t - x) / w;
    return (x - input.clickX) * fwdX + (y - input.clickY) * fwdY > 0;
  };
  const rest = front.slice(fi).concat(rear.slice(ri));
  for (let i = 0; i < rest.length; i++) {
    const u = rest[i];
    const order = reach[u.domain].order;
    let placed = false;
    for (let pass = 0; pass < 2 && !placed; pass++) {
      for (let k = 0; k < order.length; k++) {
        const t = order[k];
        if (input.reserved[t] !== 0 || taken[t] !== 0) continue;
        if (pass === 0 && ahead(t)) continue;
        const x = t % w;
        place(u, x, (t - x) / w);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const [ox, oy] = input.origins[u.domain];
      out.push({ id: u.id, x: ox, y: oy });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/sim/src/formation.test.ts`
Expected: PASS. If the open-ground row test fails on the infantry x set, check the lateral sign convention: with `from` south of the click, forward is (0, −1) and lateral is (1, 0), so offset +1 is x + 1.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. `Math.abs` on integer tile deltas is the one `Math.*` call; if the sim lint rule rejects it, replace with `dx < 0 ? -dx : dx` (the pattern `nearestOpenTile` uses) — do not disable the rule.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/sim/src/formation.ts packages/sim/src/formation.test.ts
/usr/bin/git commit -m "feat(sim): destination slots -- vehicles spaced in front, infantry one per tile behind, a column wherever walls allow no width" -m "The pure half of spec 2026-09-15-group-formation-design.md: masks, the click tile, the group's centroid and the reserved tiles in, one tile per id out. The approach direction is quantised to an axis, the front rank is the clicked row, vehicles and aircraft fill it with a tile between them, infantry fills the rows behind one per tile, and a slot must be open for the unit's domain AND reachable from that domain's origin -- which is the whole width rule: a street walls the lateral offsets off and the grid becomes a column. Overflow takes the nearest free reachable tile in walk order; a unit that finds none keeps the origin. Nothing calls it yet." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire the slots into the move / attack-move branch and re-pin the hashes

**Files:**
- Modify: `packages/sim/src/sim.ts:1831-1953` (the move / attack-move branch)
- Test: `packages/sim/src/sim.test.ts` (new `describe('formation on arrival')`), `packages/sim/src/determinism.test.ts:381` and `:628`

**Interfaces:**
- Consumes: `assignFormation`, `FormationInput`, `FormationUnit` (Task 2); `Sim.nearestOpenTile`, `maskFor`, `fieldFor`, `HALF`, `DOMAIN_FOOT`, `DOMAIN_VEHICLE`, the per-unit arrays `posX/posY/goalX/goalY/moving/wpX/wpY/wpCount/garrisonedIn/carriedBy/tunnelIn/alive/side/routed`.
- Produces: per-unit goals at slot tile centres; the reservation derived by `reservedTilesFor(side, ids)`; no new persistent state, so `hash()` gains no column.

Two things the implementer must know. First, the spec's "reservation map" (§4.3) is implemented as a scan at command time, not persistent state: reserved tiles are every living same-side unit outside the order that is on the surface (`garrisonedIn < 0 && carriedBy < 0 && tunnelIn < 0`), at its goal tile if `moving === 1`, else at its position tile. A scan is O(units) per order, orders are rare, and it needs no bookkeeping at the twelve sites that set `goalX` today. Record this as Deviation 1 in the spec (Task 4). Second, `spawn` does NOT set `goalX/goalY` (they stay 0), which is exactly why an idle unit reserves its POSITION tile, never its goal tile.

- [ ] **Step 1: Write the failing integration tests**

Append to `packages/sim/src/sim.test.ts`. **Trap:** the file's `RIFLES` and `TANK` carry no `role`, and `unitTypeFromJson` (`sim.ts:467`) derives `wheeled = json.mobility.wheeled ?? !FOOT_ROLES.has(json.role ?? '')`, so a role-less type is a VEHICLE. Both test types below carry an explicit role (`UnitTypeJson.role?: string`, `sim.ts:156`); `'infantry'` is in `FOOT_ROLES`, `'tank'` is not.

```ts
const F_INF: UnitTypeJson = { ...RIFLES, id: 'f_inf', role: 'infantry' };
const F_TANK: UnitTypeJson = { ...TANK, id: 'f_tank', role: 'tank' };
const tileOf = (sim: Sim, id: number): string => `${fx.toInt(sim.state.posX[id])},${fx.toInt(sim.state.posY[id])}`;
function settle(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.tick();
}

describe('formation on arrival', () => {
  it('spreads a group over distinct tiles with the vehicles on the clicked row', () => {
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const tank = sim.addUnitType(F_TANK);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(sim.spawn(tank, 0, fx.fromInt(4 + i), fx.fromInt(28)));
    for (let i = 0; i < 6; i++) ids.push(sim.spawn(inf, 0, fx.fromInt(3 + i), fx.fromInt(29)));
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 40);
    const tiles = ids.map((id) => tileOf(sim, id));
    expect(new Set(tiles).size).toBe(ids.length);
    for (const id of ids) expect(sim.state.moving[id]).toBe(0);
    // Approaching from the south: the three tanks stand on row 12, the infantry below it.
    for (let i = 0; i < 3; i++) expect(fx.toInt(sim.state.posY[ids[i]])).toBe(12);
    for (let i = 3; i < 9; i++) expect(fx.toInt(sim.state.posY[ids[i]])).toBeGreaterThan(12);
  });

  it('sends a single unit beside an idle friend instead of onto it', () => {
    const sim = makeSim();
    const inf = sim.addUnitType(F_INF);
    const idle = sim.spawn(inf, 0, fx.add(fx.fromInt(12), fx.fromInt(1) >> 1), fx.add(fx.fromInt(12), fx.fromInt(1) >> 1));
    const mover = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(12));
    sim.queueCommand({ kind: 'move', ids: [mover], x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 20);
    expect(tileOf(sim, idle)).toBe('12,12');
    expect(tileOf(sim, mover)).not.toBe('12,12');
    expect(sim.state.moving[mover]).toBe(0);
  });

  it('frees a dead unit\'s tile', () => {
    const sim = makeSim();
    const inf = sim.addUnitType(F_INF);
    const dead = sim.spawn(inf, 0, fx.add(fx.fromInt(12), fx.fromInt(1) >> 1), fx.add(fx.fromInt(12), fx.fromInt(1) >> 1));
    const mover = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(12));
    sim.debugKill(dead);
    sim.tick();
    sim.queueCommand({ kind: 'move', ids: [mover], x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 20);
    expect(tileOf(sim, mover)).toBe('12,12');
  });

  it('keeps two groups ordered to one click on disjoint tiles', () => {
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 5; i++) a.push(sim.spawn(inf, 0, fx.fromInt(2 + i), fx.fromInt(28)));
    for (let i = 0; i < 5; i++) b.push(sim.spawn(inf, 0, fx.fromInt(2 + i), fx.fromInt(2)));
    sim.queueCommand({ kind: 'move', ids: a, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 2);
    sim.queueCommand({ kind: 'move', ids: b, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 40);
    const tiles = [...a, ...b].map((id) => tileOf(sim, id));
    expect(new Set(tiles).size).toBe(10);
  });

  it('gives a queued waypoint its own slot per unit', () => {
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push(sim.spawn(inf, 0, fx.fromInt(2 + i), fx.fromInt(2)));
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(2) });
    sim.tick();
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(12), append: true });
    settle(sim, 40);
    expect(new Set(ids.map((id) => tileOf(sim, id))).size).toBe(4);
    for (const id of ids) expect(fx.toInt(sim.state.posY[id])).toBeGreaterThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run packages/sim/src/sim.test.ts -t "formation on arrival"`
Expected: FAIL — every unit ends on `12,12` (the distinct-tile counts read 1).

- [ ] **Step 3: Replace the per-domain goal resolution in the move branch**

In `applyCommands` (`sim.ts:1831-1953`), keep the head that computes `gx, gy, tx, ty, fgx, fgy` and the `attack` flag; delete the `sgx/sgy/fieldIdx/vgx/vgy/vField/vResolved/airField` block and the per-id `ux/uy/uf` resolution, and replace with:

```ts
        // One slot per unit (formation.ts). Air takes the foot mask and the
        // vehicle ranks; a vehicle walks from the click snapped to ITS mask.
        const [vgx, vgy] = this.nearestOpenTile(tx, ty, this.blockedVehicleMask);
        const members: FormationUnit[] = [];
        let sumX = 0;
        let sumY = 0;
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1 || this.carriedBy[id] >= 0) continue;
          const utype = this.unitTypes[this.typeIdx[id]];
          const front = utype.isAir || utype.moveDomain === DOMAIN_VEHICLE;
          members.push({ id, domain: utype.isAir ? DOMAIN_FOOT : utype.moveDomain, front });
          // Where this unit will be coming FROM: its last queued point when
          // the order appends to a route, otherwise where it stands.
          const queued = cmd.append === true && this.moving[id] === 1;
          const n = this.wpCount[id];
          const fromX = queued ? (n > 0 ? this.wpX[id * MAX_WAYPOINTS + n - 1] : this.goalX[id]) : this.posX[id];
          const fromY = queued ? (n > 0 ? this.wpY[id * MAX_WAYPOINTS + n - 1] : this.goalY[id]) : this.posY[id];
          sumX += fx.toInt(fromX);
          sumY += fx.toInt(fromY);
        }
        const slots = new Map<number, [number, number]>();
        if (members.length > 0) {
          const n = members.length;
          const assigned = assignFormation({
            width: this.width,
            height: this.height,
            masks: [this.blocked, this.blockedVehicleMask],
            origins: [
              [fgx, fgy],
              [vgx, vgy],
            ],
            clickX: fgx,
            clickY: fgy,
            fromX: Math.trunc(sumX / n),
            fromY: Math.trunc(sumY / n),
            units: members,
            reserved: this.reservedTilesFor(this.side[members[0].id], cmd.ids),
          });
          for (const s of assigned) slots.set(s.id, [s.x, s.y]);
        }
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue; // broken troops aren't listening
          const slot = slots.get(id);
          if (slot === undefined) continue; // carried: the carrier decides where it goes
          const utype = this.unitTypes[this.typeIdx[id]];
          const ux = fx.add(fx.fromInt(slot[0]), HALF);
          const uy = fx.add(fx.fromInt(slot[1]), HALF);
          const uf = this.fieldFor(slot[0], slot[1], utype.isAir ? DOMAIN_FOOT : utype.moveDomain);
```

…and keep the rest of the loop body exactly as it is from the `if (cmd.append === true && this.moving[id] === 1)` block on (it already writes `ux/uy` to the waypoint queue or to `goalX/goalY/fieldRef`). Delete the now-dead `if (this.carriedBy[id] >= 0) continue;` inside the loop only if the `slot === undefined` guard above covers it (it does: carried units are skipped when `members` is built); keep the comment that explains why a passenger ignores movement orders, moved up to that guard.

`Math.trunc` on two integers is an integer op; if the sim lint rejects `Math.trunc`, use `(sumX / n) | 0` — both operands are non-negative tile sums.

The air case changes deliberately: today an air unit ordered onto a blocked tile keeps the raw point (`sim.ts:1873-1881`'s comment). With slots it takes the foot-snapped click tile like everyone else, because a slot must be a tile no two units share. Update that comment to say so.

Add the reservation scan as a private method beside `nearestOpenTile`:

```ts
  /**
   * Tiles a new order may not put a slot on: every living same-side unit
   * outside the order that is on the surface, at its goal tile while moving
   * and at its own tile otherwise (spawn never sets a goal, so "otherwise"
   * is where it stands). Derived per order rather than kept as state: a scan
   * is O(units), orders are rare, and it needs no bookkeeping at any of the
   * sites that set `goalX` — spec §4.3's "reservation map", Deviation 1.
   */
  private reservedTilesFor(side: number, ids: readonly number[]): Uint8Array {
    const reserved = new Uint8Array(this.width * this.height);
    const inOrder = new Set(ids);
    for (let j = 0; j < this.count; j++) {
      if (this.alive[j] === 0 || this.side[j] !== side || inOrder.has(j)) continue;
      if (this.garrisonedIn[j] >= 0 || this.carriedBy[j] >= 0 || this.tunnelIn[j] >= 0) continue;
      const x = fx.toInt(this.moving[j] === 1 ? this.goalX[j] : this.posX[j]);
      const y = fx.toInt(this.moving[j] === 1 ? this.goalY[j] : this.posY[j]);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      reserved[y * this.width + x] = 1;
    }
    return reserved;
  }
```

Import at the top of `sim.ts`: `import { assignFormation, type FormationUnit } from './formation';`. If `formation.ts` imports `DOMAIN_FOOT` from `./sim`, that is a cycle; keep `formation.ts` free of sim imports (Task 2's note).

- [ ] **Step 4: Run the new tests and the whole sim suite**

Run: `pnpm exec vitest run packages/sim`
Expected: the four formation tests PASS; `determinism.test.ts` FAILS on both pinned hashes (goals moved by design); every other test PASSES. If any OTHER test fails, read it: a test that ordered several units to one point and asserted on one unit's exact position is now asserting a slot, and needs its expectation moved to the tile the slot gives — never loosen a tolerance to cover it.

- [ ] **Step 5: Re-pin the two hashes with their reasons**

Run `pnpm test:determinism` and read the two actual values. Replace `3160666129` (`determinism.test.ts:381`) and `2641065416` (`:628`) with them, and add, above the first, a comment in the file's own voice:

```ts
    // 2026-09-15: group formations (formation.ts). A multi-unit move now
    // gives every unit its own slot tile — the vehicles on the clicked row,
    // infantry behind — instead of one shared point, so goalX/goalY, posX/
    // posY and everything downstream of where units stand moved. The
    // determinism PROPERTY is untouched: two runs from the same seed still
    // agree (the test above this one), and the slot function draws no
    // random number. Re-pinned in the commit that wired formation.ts into
    // the move branch, and the relief replay below moved for the same reason.
```

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm test:determinism && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/sim/src/sim.ts packages/sim/src/sim.test.ts packages/sim/src/determinism.test.ts
/usr/bin/git commit -m "feat(sim): a group order lands in formation -- one slot tile per unit, vehicles first, and never on a friend" -m "applyCommands' move/attack-move branch hands every unit in the order a slot from assignFormation instead of one shared point: the click snapped per domain is each domain's origin, the group's centroid (or, for an appended waypoint, the centroid of the units' previous points) fixes the approach direction, and the reserved set is derived by scanning same-side units outside the order -- a unit's goal tile while moving, its own tile otherwise, so an idle friend keeps its tile and a lone unit stops beside it. No new state, so hash() gains no column; goalX/goalY moved for every multi-unit order, so the two golden hashes are re-pinned here with the reason in the test (old 3160666129 and 2641065416)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Harness re-runs, the world-state walk, the screenshot sheet, and the docs

**Files:**
- Create: `tools/src/formation_walk.test.ts`
- Create: `tools/src/perf/formation-captures.ts`
- Modify: `CLAUDE.md` ("Known scaling debts": the flow-field pool; the mesh-units section is untouched), `docs/GDD.md:279-281` (§7 Pathfinding), `docs/superpowers/specs/2026-09-15-group-formation-design.md` (a "Deviations" section)
- Test: `pnpm playtest`, `pnpm balance`, `pnpm golden-baseline`

**Interfaces:**
- Consumes: `makeWorld(missionId)` and `idsOf(sim, side)` from `tools/src/walk_world.ts`; `__lions.sim.queueCommand`, `__lions.units()`, `__lions.sel`, `__lions.step` in the browser; the capture pattern in `tools/src/perf/art-captures.ts`.
- Produces: the sheet at `.superpowers/formation-captures/` (git-ignored), sent to the lead by the controller.

- [ ] **Step 1: Run the playtest chain**

Run: `pnpm playtest`
Expected: exit 0, every mission its expected verdict. Record each mission's minutes beside the pre-change table (`git show main:docs/...` is not needed — the harness prints the table; paste both into the task report). A mission that flips is a STOP: report it with the plan line and the objective that failed.

- [ ] **Step 2: Run the balance targets**

Run: `pnpm balance`
Expected: every §5.7 target inside its band. Paste the before (from `main`) and after tables into the report. A target outside its band is a STOP.

- [ ] **Step 3: Write the world-state walk as a test**

`tools/src/formation_walk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fx } from '../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../packages/sim/src/sim';
import { idsOf, makeWorld } from './walk_world';

/**
 * A real map and a real roster, which no unit test has: tel_marum_2_foothold
 * fields 3 inf_squad, at_team, mortar_team, demo_squad, 2 apc_eitan and an
 * mbt_lavi from [21..27, 44..46] (its starting_force), on the one map with a
 * two-wide walled corridor (`b` at x=10-11, y=12-17, ridge either side).
 */
function settle(
  missionId: string,
  pick: (sim: Sim, id: number) => boolean,
  x: number,
  y: number,
  seconds: number
) {
  const { sim, nameOf } = makeWorld(missionId);
  const ids = idsOf(sim, 0).filter(
    (i) => sim.state.carriedBy[i] < 0 && sim.state.garrisonedIn[i] < 0 && pick(sim, i)
  );
  sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(x), y: fx.fromInt(y) });
  for (let t = 0; t < seconds * TICKS_PER_SECOND; t++) sim.tick();
  const tiles = new Map<string, string[]>();
  for (const id of ids) {
    if (sim.state.alive[id] === 0) continue;
    const k = `${fx.toInt(sim.state.posX[id])},${fx.toInt(sim.state.posY[id])}`;
    tiles.set(k, [...(tiles.get(k) ?? []), nameOf.get(sim.state.typeIdx[id]) ?? '?']);
  }
  // The printed world: what a reviewer reads when this goes red.
  for (const [k, names] of tiles) console.log(`${k}: ${names.join(', ')}`);
  const stacked = [...tiles].filter(([, names]) => names.length > 1);
  return { tiles, ids, sim, stacked };
}
const everyone = (): boolean => true;
const onFoot = (sim: Sim, id: number): boolean => {
  const t = sim.unitTypes[sim.state.typeIdx[id]];
  return !t.isAir && t.moveDomain === DOMAIN_FOOT;
};

describe('a real roster lands on distinct tiles (tel_marum_2_foothold)', () => {
  it('the whole force into the open basin at (24,30)', () => {
    const { stacked, tiles, ids, sim } = settle('tel_marum_2_foothold', everyone, 24, 30, 90);
    expect(stacked, `stacked: ${JSON.stringify(stacked)}`).toHaveLength(0);
    expect(tiles.size).toBe(ids.length);
    // Vehicles on the clicked row (approach from the south), infantry south of it.
    for (const id of ids) {
      const y = fx.toInt(sim.state.posY[id]);
      if (onFoot(sim, id)) expect(y).toBeGreaterThan(30);
      else expect(y).toBe(30);
    }
  });
  it('the foot units into the boulder corridor at (10,13) form a column', () => {
    const { stacked, ids, sim } = settle('tel_marum_2_foothold', onFoot, 10, 13, 120);
    expect(stacked, `stacked: ${JSON.stringify(stacked)}`).toHaveLength(0);
    // Every team is inside the corridor (x 10..11, y 12..17) or on the scree
    // south of its mouth — nowhere else is reachable within the walk bound.
    for (const id of ids) {
      const x = fx.toInt(sim.state.posX[id]);
      const y = fx.toInt(sim.state.posY[id]);
      expect(x >= 8 && x <= 13 && y >= 12 && y <= 20, `${x},${y}`).toBe(true);
    }
  });
});
```

`sim.unitTypes` and `isAir`/`moveDomain` are public on `Sim`/`UnitType` (main.ts reads them at `packages/app/src/main.ts:2360`); import `DOMAIN_FOOT` and `type Sim` from `../../packages/sim/src/sim`. Confirm the roster from `data/missions/tel_marum_2_foothold.json`'s `starting_force` before trusting the comment; if a placement changed, update the comment, not the assertions.

Run: `pnpm exec vitest run tools/src/formation_walk.test.ts`
Expected: PASS, with the printed tile list in the output.

- [ ] **Step 4: The screenshot sheet**

`tools/src/perf/formation-captures.ts`, modelled on `art-captures.ts` (same launch args, viewport, `boot`, `cam`, `shot` helpers copied verbatim):

```ts
/**
 * Three captures for the lead on ?sandbox=tel_marum, zoom 1.6, after the
 * group has settled: the whole force into the open basin, the whole force
 * into the five-wide pass through the ridge, and the foot units alone into
 * the two-wide boulder corridor (a column).
 *   npx tsx tools/src/perf/formation-captures.ts http://127.0.0.1:5178 .superpowers/formation-captures
 */
// … boot/cam/shot as in art-captures.ts …
async function order(x: number, y: number, footOnly: boolean): Promise<void> {
  await page.evaluate(
    ([tx, ty, foot]) => {
      const L = (
        window as unknown as {
          __lions: {
            units(): { id: number }[];
            sel(ids: number[]): void;
            sim: {
              state: { typeIdx: Uint16Array };
              unitTypes: { isAir: boolean; moveDomain: number }[];
              queueCommand(c: { kind: 'move'; ids: number[]; x: number; y: number }): void;
            };
            step(n: number): void;
          };
        }
      ).__lions;
      const ids = L.units()
        .map((u) => u.id)
        .filter((id) => {
          if (!foot) return true;
          const t = L.sim.unitTypes[L.sim.state.typeIdx[id]];
          return !t.isAir && t.moveDomain === 0;
        });
      L.sel(ids);
      // Q16.16: a tile centre is (tile << 16) + 32768.
      L.sim.queueCommand({ kind: 'move', ids, x: (tx << 16) + 32768, y: (ty << 16) + 32768 });
      L.step(90 * 20);
    },
    [x, y, footOnly] as [number, number, boolean]
  );
  await page.waitForTimeout(800);
}
await boot('/?sandbox=tel_marum');
await order(24, 30, false);
await cam(24, 30, 1.6);
await shot('01-open-basin');
await boot('/?sandbox=tel_marum');
await order(24, 13, false);
await cam(24, 13, 1.6);
await shot('02-five-wide-pass');
await boot('/?sandbox=tel_marum');
await order(10, 13, true);
await cam(10, 15, 1.6);
await shot('03-corridor-column');
await browser.close();
```

Rebooting between orders starts each capture from the spawned force rather than from the previous formation. Start the dev server yourself from this worktree (`pnpm --filter @lions/app exec vite --port 5178 --strictPort --host 127.0.0.1`, in the background; 5179 if busy), never with `preview_start`, and never kill a process you did not start; stop yours when done. Run the script; look at all three PNGs (Read the image files) and confirm by eye: no two units on one tile, vehicles on the clicked row with a tile between them, infantry behind, the pass case at most five wide, the corridor case a column two wide. Put the three paths in the report.

- [ ] **Step 5: The visual gate**

Run: `pnpm golden-baseline`
Expected: exit 0 with no baseline moved. If a gated scenario moved, read the numbers: the only sanctioned cause is a scenario's single-unit order landing on a tile centre instead of an exact point (§4.2's half-tile shift) — report the numbers and do NOT bless locally; blessing is from CI numbers per CLAUDE.md.

- [ ] **Step 6: The docs**

- `CLAUDE.md`, "Known scaling debts": add one bullet after the rigged-mesh-units bullet: the flow-field pool is bounded at `MAX_FLOW_FIELDS` (128) with live-safe LRU reuse since 2026-09-15 and the heap scratch is shared, with the per-field byte counts from Task 1's commit; and one sentence in the "Dev instruments" bullet on `?sandbox`: a group order lands in formation now (`formation.ts`), so "units stack on a tile" is a bug again, not the default.
- `docs/GDD.md` §7 Pathfinding: after "One field per destination group, shared by all members", add: "Since 2026-09-15 a group order gives every unit its own slot tile (spec `2026-09-15-group-formation-design.md`), so a group holds one field per slot; the pool is bounded and reuses unreferenced fields."
- The spec: add a `## 8. Deviations` section: (1) the reservation map is derived per order by a scan, not persistent state, with the reason; (2) an air unit ordered onto a blocked tile now takes the foot-snapped click tile rather than the raw point, because a slot must be a tile; (3) the compute-heap scratch is shared, with the byte counts; (4) the measured cost lines: fields per order in the walk test, `pnpm playtest` minutes before and after, the balance table before and after.
- Update the queue entry in the task-queue memory is the CONTROLLER's job, not this task's.

- [ ] **Step 7: Full gate and commit**

Run: `pnpm test && pnpm test:determinism && pnpm typecheck && pnpm lint && pnpm validate:ui && pnpm playtest && pnpm balance`
Expected: all green.

```bash
/usr/bin/git add tools/src/formation_walk.test.ts tools/src/perf/formation-captures.ts CLAUDE.md docs/GDD.md docs/superpowers/specs/2026-09-15-group-formation-design.md
/usr/bin/git commit -m "test,docs: a real roster lands on distinct tiles; the formation sheet; the field-pool bound recorded" -m "tel_marum_2_foothold's force ordered into the basin and its foot units into the boulder corridor land on distinct tiles, printed tile by tile so a red run reads as a world; the three-capture sheet script for the lead; CLAUDE.md, GDD section 7 and the spec's Deviations carry the field-pool bound, the derived reservation, the air snap and the measured cost. Playtest: <every mission's minutes before -> after, from the two harness tables>. Balance: <the four targets before -> after>." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The two angle-bracket lines are the ONLY values this plan cannot know: fill them from the harness output of Steps 1 and 2 before committing.
