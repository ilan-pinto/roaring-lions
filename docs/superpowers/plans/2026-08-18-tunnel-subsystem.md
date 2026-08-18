# Tunnel Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tunnel subsystem — an Ashwar digger that excavates an authored route leaving a surface spoil trail, units that surface at the vent to fire and duck back, and a KDF Yahalom squad that finds the trail and collapses the route.

**Architecture:** A tunnel is a third kind of *container*, alongside garrison and carrier. `selectTarget` already skips contained units; a route adds a third index to that skip and a module of its own (`tunnels.ts`) beside `structures.ts`. Route geometry is authored in the map; missions activate and stock routes. Nothing here draws randomness — dig progress is Fx addition, trail decay is integer subtraction, surfacing is a threshold comparison.

**Tech Stack:** TypeScript strict, Q16.16 fixed-point (`@lions/sim/fixed`), struct-of-arrays over typed arrays, vitest, JSON Schema via ajv.

**Spec:** `docs/superpowers/specs/2026-08-18-tunnel-subsystem-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **20 Hz fixed sim tick.** `TICKS_PER_SECOND = 20`. Data is authored in seconds and converted at load; never store ticks in JSON.
- **Q16.16 fixed-point in `@lions/sim`. No floating point.** `Math.*` and `Date.*` are banned by lint. Use `fx.mul`, `fx.div`, `fx.sqrt`, `fx.add`, `fx.sub`.
- **All randomness from `rng(entityId)`.** This feature draws none. If you reach for a random number, stop — the design is deterministic by construction and an RNG draw here changes the determinism hash for every future replay.
- **One-way data flow.** Commands in → sim → state + events out. The renderer reads; it never writes.
- **Struct-of-arrays, no per-entity allocation in the hot loop.**
- **TypeScript strict. No `any`. No non-null assertions in sim code.**
- **Tests colocate as `*.test.ts`.** Combat maths requires tests.
- **`pnpm typecheck` must pass.** It is in CI but omitted from CLAUDE.md's command list. It is the *only* gate that catches literal-union fields in sim JSON types breaking JSON-module call sites — and this plan adds two unit JSON files. Run it after every task that touches JSON or types.
- **`pnpm test:determinism` must pass before any commit touching `@lions/sim`.** Task 14 is the only task permitted to change the golden hash.
- **Content is JSON validated against `packages/data/schemas/`.** Adding a unit means adding JSON, never engine code.

---

### Task 1: Tunnel routes in the map format

**Files:**
- Modify: `data/schemas/map.schema.json`
- Modify: `packages/data/src/map.ts`
- Test: `packages/data/src/map.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `ParsedTunnel { id: string; points: [number, number][]; digTilesPerS: number }` exported from `@lions/data`, and `ParsedMap.tunnels: ParsedTunnel[]`. `points` is the flattened polyline — mouth first, waypoints in order, vent last — so consumers walk one array instead of three fields.

- [ ] **Step 1: Write the failing test**

In `packages/data/src/map.test.ts`, alongside the existing marker/zone tests:

```typescript
describe('tunnels', () => {
  const WITH_TUNNEL = {
    ...TINY,
    tunnels: [
      { id: 'tn_a', mouth: [0, 0], waypoints: [[1, 1]], vent: [2, 2], dig_tiles_per_s: 0.2 },
    ],
  };

  it('flattens mouth, waypoints and vent into one polyline', () => {
    const m = parseMap(WITH_TUNNEL);
    expect(m.tunnels).toHaveLength(1);
    expect(m.tunnels[0].id).toBe('tn_a');
    expect(m.tunnels[0].points).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(m.tunnels[0].digTilesPerS).toBe(0.2);
  });

  it('defaults to no tunnels', () => {
    expect(parseMap(TINY).tunnels).toEqual([]);
  });

  it('allows a route with no waypoints', () => {
    const m = parseMap({ ...TINY, tunnels: [{ id: 'tn_b', mouth: [0, 0], vent: [2, 2] }] });
    expect(m.tunnels[0].points).toEqual([[0, 0], [2, 2]]);
  });

  it('rejects an out-of-bounds point, naming which one', () => {
    expect(() =>
      parseMap({ ...TINY, tunnels: [{ id: 'tn_c', mouth: [0, 0], vent: [99, 0] }] })
    ).toThrow(/tn_c/);
  });

  it('rejects a duplicate route id', () => {
    const dup = { id: 'tn_a', mouth: [0, 0], vent: [1, 1] };
    expect(() => parseMap({ ...TINY, tunnels: [dup, dup] })).toThrow(/tn_a/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/data/src/map.test.ts -t tunnels`
Expected: FAIL — `m.tunnels` is undefined.

- [ ] **Step 3: Extend the map schema**

In `data/schemas/map.schema.json`, add to `properties`:

```json
"tunnels": {
  "type": "array",
  "description": "Underground routes. Geometry lives here because it is terrain; a mission activates a route and stocks it, and a route no mission references does not exist that mission.",
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["id", "mouth", "vent"],
    "properties": {
      "id": { "type": "string" },
      "mouth": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 },
      "waypoints": {
        "type": "array",
        "items": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 }
      },
      "vent": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 },
      "dig_tiles_per_s": { "type": "number", "exclusiveMinimum": 0, "default": 0.15 }
    }
  }
}
```

- [ ] **Step 4: Implement the parse**

In `packages/data/src/map.ts`, add to `MapJson`:

```typescript
  tunnels?: readonly TunnelJson[];
```

and above it:

```typescript
export interface TunnelJson {
  id: string;
  mouth: readonly number[];
  waypoints?: readonly (readonly number[])[];
  vent: readonly number[];
  dig_tiles_per_s?: number;
}

/**
 * An authored underground route, flattened to a single polyline.
 *
 * Mouth and vent are separate fields in JSON because that is how an author
 * thinks about a tunnel — it starts somewhere and comes up somewhere — but
 * every consumer walks the whole line, so keeping three fields would mean
 * every consumer re-concatenating them.
 */
export interface ParsedTunnel {
  id: string;
  /** Mouth first, waypoints in order, vent last. Always at least 2 points. */
  points: [number, number][];
  digTilesPerS: number;
}
```

Add `tunnels: ParsedTunnel[];` to `ParsedMap`, and inside `parseMap`, after the `zones` block:

```typescript
  const tunnels: ParsedTunnel[] = [];
  const tunnelIds = new Set<string>();
  for (const t of json.tunnels ?? []) {
    if (tunnelIds.has(t.id)) {
      throw new Error(`map ${json.id}: duplicate tunnel id "${t.id}"`);
    }
    tunnelIds.add(t.id);
    const raw = [t.mouth, ...(t.waypoints ?? []), t.vent];
    const points: [number, number][] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const [x, y] = p;
      if (p.length !== 2 || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(
          `map ${json.id}: tunnel "${t.id}" point ${i} (${p.join(',')}) is out of bounds`
        );
      }
      points.push([x, y]);
    }
    tunnels.push({ id: t.id, points, digTilesPerS: t.dig_tiles_per_s ?? 0.15 });
  }
```

Add `tunnels` to the returned object.

- [ ] **Step 5: Run the tests and the gates**

Run: `npx vitest run packages/data/src/map.test.ts && pnpm typecheck && pnpm validate:data`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/map.schema.json packages/data/src/map.ts packages/data/src/map.test.ts
git commit -m "feat(data): a map may declare underground routes"
```

---

### Task 2: The tunnels module — constants and route maths

**Files:**
- Create: `packages/sim/src/tunnels.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `ParsedTunnel` shape from Task 1 (by structure, not by import — `@lions/sim` imports nothing).
- Produces: `TunnelRouteJson`, `routeLength(points): Fx`, `pointAtDistance(points, d): [Fx, Fx]`, and the tunnel tuning constants.

**Why the shape is duplicated:** `@lions/sim` imports nothing, by invariant. The app converts a `ParsedTunnel` into the sim's own input type at wiring time (Task 13), exactly as it already does for structures.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/tunnels.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength } from './tunnels';

const STRAIGHT: [number, number][] = [[0, 0], [3, 0]];
const ELBOW: [number, number][] = [[0, 0], [3, 0], [3, 4]];

describe('route geometry', () => {
  it('measures a straight run', () => {
    expect(fx.toNumber(routeLength(STRAIGHT))).toBeCloseTo(3, 2);
  });

  it('measures a polyline as the sum of its legs', () => {
    // 3 across then 4 down — the classic, so an error in leg summation is obvious.
    expect(fx.toNumber(routeLength(ELBOW))).toBeCloseTo(7, 2);
  });

  it('walks to a point partway along the first leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(1.5));
    expect(fx.toNumber(x)).toBeCloseTo(1.5, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });

  it('walks past the elbow into the second leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(5));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(2, 2);
  });

  it('clamps past the end to the final point rather than extrapolating', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(999));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(4, 2);
  });

  it('clamps before the start to the first point', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(-5));
    expect(fx.toNumber(x)).toBeCloseTo(0, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts`
Expected: FAIL — cannot resolve `./tunnels`.

- [ ] **Step 3: Write the module**

Create `packages/sim/src/tunnels.ts`:

```typescript
// Tunnels as first-class sim objects (GDD §2 Ashwar doctrine, §4 phase 6).
//
// A tunnel is a third kind of container, after the building and the carrier.
// A unit inside one cannot be reached by fire — the earth is in the way — and
// the counterplay is destroying the container, exactly as it is for a garrison.
// What makes a tunnel different from a building is its shape: it is a route
// with a moving dig head and a vent, not a footprint, which is why it gets its
// own module rather than a flag on StructureType.

import { fx, type Fx } from './fixed';

/** A route as the sim receives it. The app converts `ParsedTunnel` into this;
 *  `@lions/sim` imports nothing, so the shape is restated rather than shared. */
export interface TunnelRouteJson {
  id: string;
  /** Mouth first, vent last, in tiles. At least two points. */
  points: readonly (readonly [number, number])[];
  dig_tiles_per_s: number;
}

/** Trail density stamped on a tile the moment the dig head passes under it. */
export const TRAIL_MAX = 255;
/** Per-tick decay of surface spoil. 255 at 1 per 4 ticks is ~51 s of trail —
 *  long enough to be found and acted on, short enough that a route dug early
 *  and abandoned does not brand the map for the whole mission. */
export const TRAIL_DECAY = 1;
export const TRAIL_DECAY_EVERY = 4;
/** Base signature of spoil on the surface. Well below a unit's: it is a scar
 *  in the dirt, not a man. This is the number that makes recon worth having. */
export const TRAIL_SIGNATURE = 13107; // 0.2
/** How close the dig head must be to the vent for it to open: squared tiles. */
export const VENT_OPEN_SQ = 6554; // 0.1 tile²
/** Seconds a Yahalom team works before the charge blows, when unit data omits
 *  `tunnel_charge_time_s`. Longer than a building demolition: they are digging
 *  down to the void first. */
export const CHARGE_SECONDS = 8;
/** How close the team must be to a revealed trail tile: squared tiles, Q16.16. */
export const CHARGE_RANGE_SQ = 262144; // 4.0 tile² = 2 tiles
/** Minimum seconds a unit stays exposed once it surfaces, on top of its volley.
 *  This is the player's guaranteed reaction slot — see spec, "stepSurfacing". */
export const SURFACE_SECONDS = 3;
/** Shots committed per surfacing. A unit comes up to do something specific
 *  and goes back down; it does not fight a battle from the hole. */
export const SURFACE_VOLLEY = 2;
/** Suppression dealt to everyone near a collapsing route, and its radius². */
export const TUNNEL_COLLAPSE_SHOCK = 39322; // 0.6 — named apart from structures.ts's
// COLLAPSE_SHOCK (0.7), which sim.ts already imports unaliased.
export const TUNNEL_COLLAPSE_RADIUS = 131072; // 2 tiles — splashDirect squares it

/** Total length of a polyline, in Q16.16 tiles. */
export function routeLength(points: readonly (readonly [number, number])[]): Fx {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total = fx.add(total, legLength(points[i - 1], points[i]));
  }
  return total;
}

function legLength(a: readonly [number, number], b: readonly [number, number]): Fx {
  const dx = fx.from(b[0] - a[0]);
  const dy = fx.from(b[1] - a[1]);
  return fx.sqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
}

/**
 * The point `d` tiles along the polyline, clamped to both ends.
 *
 * Clamped rather than extrapolated because the caller is a dig head whose
 * progress is compared against the route length elsewhere: letting it run off
 * the end here would put the vent somewhere off the map on the tick before the
 * progress check notices.
 */
export function pointAtDistance(
  points: readonly (readonly [number, number])[],
  d: Fx
): [Fx, Fx] {
  const first = points[0];
  if (d <= 0) return [fx.from(first[0]), fx.from(first[1])];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const leg = legLength(a, b);
    if (leg === 0) continue;
    const next = fx.add(walked, leg);
    if (d <= next) {
      const t = fx.div(fx.sub(d, walked), leg);
      const ax = fx.from(a[0]);
      const ay = fx.from(a[1]);
      return [
        fx.add(ax, fx.mul(fx.sub(fx.from(b[0]), ax), t)),
        fx.add(ay, fx.mul(fx.sub(fx.from(b[1]), ay), t)),
      ];
    }
    walked = next;
  }
  const last = points[points.length - 1];
  return [fx.from(last[0]), fx.from(last[1])];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/tunnels.test.ts && pnpm lint && pnpm typecheck`
Expected: all PASS. Lint matters here — it is what enforces the no-`Math.*` rule in this package.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/tunnels.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): route geometry for tunnels, in fixed point"
```

---

### Task 3: Tunnel state in the Sim

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `TunnelRouteJson`, `routeLength` (Task 2).
- Produces: `sim.addTunnel(route: TunnelRouteJson): number` returning the route index; `sim.tunnelCount`; `sim.putInTunnel(unitId, routeIdx): void`; readable columns `tnAlive`, `tnProgress`, `tnLength`, `tnVentOpen`; per-unit `tunnelIn` exposed on `sim.state`.

`putInTunnel` is defined here rather than with the surfacing loop that also uses it, because Task 7's containment tests need to put a unit underground before Task 8 exists.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/src/tunnels.test.ts`:

```typescript
import { Sim } from './sim';

const ROUTE = { id: 'tn_a', points: [[2, 2], [8, 2]] as const, dig_tiles_per_s: 1 };

function simWithRoute() {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const idx = sim.addTunnel(ROUTE);
  return { sim, idx };
}

describe('tunnel state', () => {
  it('registers a route with its measured length and no progress', () => {
    const { sim, idx } = simWithRoute();
    expect(idx).toBe(0);
    expect(sim.tunnelCount).toBe(1);
    expect(sim.tnAlive[idx]).toBe(1);
    expect(sim.tnProgress[idx]).toBe(0);
    expect(fx.toNumber(sim.tnLength[idx])).toBeCloseTo(6, 2);
    expect(sim.tnVentOpen[idx]).toBe(0);
  });

  it('starts every unit on the surface', () => {
    const { sim } = simWithRoute();
    expect(sim.state.tunnelIn[0]).toBe(-1);
  });

  it('refuses a route with fewer than two points', () => {
    const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
    expect(() => sim.addTunnel({ id: 'bad', points: [[1, 1]], dig_tiles_per_s: 1 })).toThrow(
      /at least two points/
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t "tunnel state"`
Expected: FAIL — `sim.addTunnel is not a function`.

- [ ] **Step 3: Add the state**

In `packages/sim/src/sim.ts`, import from `./tunnels`:

```typescript
import { pointAtDistance, routeLength, TRAIL_MAX, type TunnelRouteJson } from './tunnels';
```

Add a cap beside `MAX_STRUCTURES`:

```typescript
/** Routes per mission. Small on purpose: a mission with more than a handful of
 *  tunnels is a mission whose player cannot reason about any of them. */
const MAX_TUNNELS = 16;
```

In the structure SoA region, add a tunnel SoA block:

```typescript
  // --- tunnel SoA ---
  readonly tnAlive = new Uint8Array(MAX_TUNNELS);
  /** Tiles dug along the route, Q16.16. */
  readonly tnProgress = new Int32Array(MAX_TUNNELS);
  readonly tnLength = new Int32Array(MAX_TUNNELS);
  readonly tnVentOpen = new Uint8Array(MAX_TUNNELS);
  readonly tnOccupants = new Int32Array(MAX_TUNNELS);
  /** Route polylines, indexed by route. Read-only after addTunnel. */
  private readonly tnPoints: (readonly (readonly [number, number])[])[] = [];
  /** Tile centre of each route's vent, precomputed. */
  private readonly tnVentX = new Int32Array(MAX_TUNNELS);
  private readonly tnVentY = new Int32Array(MAX_TUNNELS);
  /** Tiles each route passes under. Built once in addTunnel — a Set here is a
   *  load-time allocation, not a per-tick one, so the hot-loop rule holds. */
  private readonly tnTiles: Set<number>[] = [];
  private tunnelCount_ = 0;
  /** Surface spoil density per tile, 0-255. Presentation reads it; detection
   *  uses it to place the tunnel's signature. Same shape as the smoke grid. */
  readonly trail: Uint8Array;
```

Allocate `trail` in the constructor beside `smoke`:

```typescript
    this.trail = new Uint8Array(config.width * config.height);
```

Add the per-unit column beside `garrisonedIn` and `carriedBy`, and initialise it to −1 wherever those are initialised in `spawn`:

```typescript
  /** Route this unit is inside, or -1 on the surface. The third containment
   *  index, after garrisonedIn and carriedBy. */
  readonly tunnelIn: Int32Array;
```

```typescript
    this.tunnelIn[id] = -1;
```

Add the accessors:

```typescript
  get tunnelCount(): number {
    return this.tunnelCount_;
  }

  /** Register an authored route. Returns its index. */
  addTunnel(route: TunnelRouteJson): number {
    if (this.tunnelCount_ >= MAX_TUNNELS) throw new Error('too many tunnels');
    if (route.points.length < 2) {
      throw new Error(`tunnel ${route.id}: a route needs at least two points`);
    }
    const id = this.tunnelCount_++;
    this.tnPoints.push(route.points);
    this.tnAlive[id] = 1;
    this.tnProgress[id] = 0;
    this.tnLength[id] = routeLength(route.points);
    this.tnVentOpen[id] = 0;
    this.tnOccupants[id] = 0;
    this.tnDigRate[id] = fx.mul(fx.from(route.dig_tiles_per_s), DT);
    const vent = route.points[route.points.length - 1];
    this.tnVentX[id] = fx.add(fx.from(vent[0]), HALF);
    this.tnVentY[id] = fx.add(fx.from(vent[1]), HALF);
    // Tile set for the route, walked at the same half-tile step stampTrail
    // uses. Allocated once at load, never in the tick loop.
    const tiles = new Set<number>();
    for (let d = 0; d <= this.tnLength[id]; d = fx.add(d, HALF)) {
      const [px, py] = pointAtDistance(route.points, d);
      const tx = px >> 16;
      const ty = py >> 16;
      if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height) tiles.add(ty * this.width + tx);
    }
    this.tnTiles.push(tiles);
    return id;
  }

  /** Tile centre of a route's vent. Precomputed in `addTunnel` rather than
   *  walked from the polyline each call: `stepSurfacing` asks for it every
   *  tick for every unit below ground. */
  private ventPos(r: number): [Fx, Fx] {
    return [this.tnVentX[r], this.tnVentY[r]];
  }

  /** Place a unit inside a route. Used by mission placements that start a
   *  garrison underground, and by `submerge` when a fighter goes back down. */
  putInTunnel(unitId: number, routeIdx: number): void {
    if (routeIdx < 0 || routeIdx >= this.tunnelCount_) {
      throw new Error(`no tunnel ${routeIdx}`);
    }
    if (this.tunnelIn[unitId] === routeIdx) return;
    this.tunnelIn[unitId] = routeIdx;
    this.tnOccupants[routeIdx]++;
  }
```

Add `tnDigRate` to the SoA block (`readonly tnDigRate = new Int32Array(MAX_TUNNELS);`) — per-tick advance, precomputed so the step function does no conversion.

Export `tunnelIn` on the state object the same way `garrisonedIn` is exposed, and re-export the tunnel constants from `packages/sim/src/index.ts`:

```typescript
export {
  routeLength,
  pointAtDistance,
  TRAIL_MAX,
  type TunnelRouteJson,
} from './tunnels';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/tunnels.test.ts && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 5: Verify the determinism hash has NOT moved**

Run: `pnpm test:determinism`
Expected: PASS, unchanged. Adding columns that no unit touches must not perturb the hash — the replay contains no tunnels yet. If this fails, a new column has been folded into `hash()` prematurely; only Task 14 changes the pin.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/index.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): tunnel routes are sim state"
```

---

### Task 4: `stepDigging` — the route advances and the vent opens

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: Task 3's SoA, `pointAtDistance` (Task 2).
- Produces: `stepDigging` called from `tick`; `sim.assignDigger(routeIdx, unitId)`; event `{ kind: 'ventOpened', tick, tunnel }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('digging', () => {
  it('advances progress only while a living digger is assigned', () => {
    const { sim, idx } = simWithRoute();
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(0); // no digger, no dig

    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(fx.toNumber(sim.tnProgress[idx])).toBeCloseTo(1, 1); // 1 tile/s for 1 s
  });

  it('opens the vent and emits once when the head reaches the end', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    const opened = [];
    for (let t = 0; t < 200; t++) {
      for (const e of sim.tick()) if (e.kind === 'ventOpened') opened.push(e);
    }
    expect(sim.tnVentOpen[idx]).toBe(1);
    expect(opened).toHaveLength(1);
    expect(opened[0].tunnel).toBe(idx);
  });

  it('stops advancing when the digger dies but leaves the route standing', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    const halted = sim.tnProgress[idx];
    sim.debugKill(id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(halted);
    expect(sim.tnAlive[idx]).toBe(1); // the tunnel that exists still exists
  });
});
```

Define `DIGGER_TYPE` at the top of the file as a minimal unarmed unit — copy the shape of an existing `units.*` fixture in `combat.test.ts` and give it `abilities: ['dig_tunnel']`, `weapons: []`.

If `sim.kill` does not exist, use the existing test helper for removing a unit; check `combat.test.ts` for how it kills a unit and mirror that.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t digging`
Expected: FAIL — `sim.assignDigger is not a function`.

- [ ] **Step 3: Implement**

```typescript
  /** Put a digger on a route. One digger per route; assigning replaces. */
  assignDigger(routeIdx: number, unitId: number): void {
    this.tnDigger[routeIdx] = unitId;
  }

  private stepDigging(): void {
    for (let r = 0; r < this.tunnelCount_; r++) {
      if (this.tnAlive[r] === 0 || this.tnVentOpen[r] === 1) continue;
      const digger = this.tnDigger[r];
      if (digger < 0 || this.alive[digger] === 0) continue;
      const before = this.tnProgress[r];
      const after = fx.min(fx.add(before, this.tnDigRate[r]), this.tnLength[r]);
      this.tnProgress[r] = after;
      this.stampTrail(r, before, after);
      if (after >= this.tnLength[r]) {
        this.tnVentOpen[r] = 1;
        this.pendingEvents.push({ kind: 'ventOpened', tick: this.tickCount, tunnel: r });
      }
    }
  }

  /** Mark every tile the head passed under between two progress values.
   *  Sampled at half-tile steps: coarser skips tiles on a diagonal leg and
   *  leaves a dotted trail the player reads as two tunnels. */
  private stampTrail(r: number, from: Fx, to: Fx): void {
    const points = this.tnPoints[r];
    for (let d = from; d < to; d = fx.add(d, HALF)) {
      const [x, y] = pointAtDistance(points, d);
      const tx = x >> 16;
      const ty = y >> 16;
      if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height) {
        this.trail[ty * this.width + tx] = TRAIL_MAX;
      }
    }
    const [ex, ey] = pointAtDistance(points, to);
    const etx = ex >> 16;
    const ety = ey >> 16;
    if (etx >= 0 && ety >= 0 && etx < this.width && ety < this.height) {
      this.trail[ety * this.width + etx] = TRAIL_MAX;
    }
  }
```

Add `tnDigger` to the SoA (`readonly tnDigger = new Int32Array(MAX_TUNNELS).fill(-1);`) and reset it to −1 in `addTunnel`. Add `ventOpened` to the `SimEvent` union and to `SIM_EVENT_KINDS` — the exhaustiveness type will fail the build if you forget the second.

Call `stepDigging()` from `tick()`, before `stepDetection()`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/tunnels.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): a digger advances its route and opens a vent"
```

---

### Task 5: Trail decay

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `trail` grid, `TRAIL_DECAY`, `TRAIL_DECAY_EVERY` (Tasks 2–3).
- Produces: trail weathering folded into `stepSmoke`, which becomes `stepFields`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('trail decay', () => {
  it('weathers spoil toward zero without going negative', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    for (let t = 0; t < 40; t++) sim.tick();
    const tile = 2 * 16 + 2;
    const fresh = sim.trail[tile];
    expect(fresh).toBeGreaterThan(0);

    sim.debugKill(sim.tnDigger[idx]); // stop new spoil
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.trail[tile]).toBeLessThan(fresh);

    for (let t = 0; t < 4000; t++) sim.tick();
    expect(sim.trail[tile]).toBe(0); // floors, never wraps
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t "trail decay"`
Expected: FAIL — trail stays at 255.

- [ ] **Step 3: Implement**

Rename `stepSmoke` to `stepFields` (it now weathers two grids) and add:

```typescript
    // Spoil weathers more slowly than smoke lifts, so it is only touched every
    // TRAIL_DECAY_EVERY ticks. Integer, like smoke — a fractional decay here
    // would be the "just this one calculation" the fixed-point invariant exists
    // to refuse.
    if (this.tickCount % TRAIL_DECAY_EVERY === 0) {
      const trail = this.trail;
      for (let i = 0; i < trail.length; i++) {
        const v = trail[i];
        if (v !== 0) trail[i] = v > TRAIL_DECAY ? v - TRAIL_DECAY : 0;
      }
    }
```

Update the single call site in `tick()`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint`
Expected: PASS — the whole sim suite, since `stepSmoke` was renamed.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): surface spoil weathers away"
```

---

### Task 6: Detecting a route through its trail

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `trail`, `TRAIL_SIGNATURE`, the existing `losRay` and the `SUSPECTED_AT`/`IDENTIFIED_AT`/`LOST_AT` ladder.
- Produces: `tnContact` (per side × route, Q16.16), `sim.tunnelContactLevel(side, routeIdx): 0 | 1 | 2`, `sim.identifyTunnelTo(side, routeIdx)`, event `{ kind: 'tunnelContact', tick, side, tunnel, level }`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('finding a route', () => {
  it('a unit with line of sight to fresh spoil eventually identifies the route', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    const scout = sim.addUnitType(SCOUT_TYPE);
    sim.spawn(scout, 0, fx.from(4.5), fx.from(4.5));
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tunnelContactLevel(0, idx)).toBe(2);
  });

  it('stays unknown to a side with nobody near it', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tunnelContactLevel(0, idx)).toBe(0);
  });

  it('mark_tunnel identifies it outright', () => {
    const { sim, idx } = simWithRoute();
    sim.identifyTunnelTo(0, idx);
    expect(sim.tunnelContactLevel(0, idx)).toBe(2);
    expect(sim.tunnelContactLevel(1, idx)).toBe(0); // one side only
  });
});
```

`SCOUT_TYPE` is a plain infantry fixture with `sight_tiles: 8`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t "finding a route"`
Expected: FAIL — `sim.tunnelContactLevel is not a function`.

- [ ] **Step 3: Implement**

Add `tnContact = new Int32Array(2 * MAX_TUNNELS)` and `tnContactState = new Uint8Array(2 * MAX_TUNNELS)`. Then, at the end of `stepDetection`:

```typescript
    // A route is found through the spoil it leaves, not by seeing the tunnel.
    // Confidence accrues against the ROUTE rather than per trail tile: a second
    // per-tile contact array would cost width*height*2 for a fact the player
    // reads as one binary ("do I know where this tunnel is").
    for (let r = 0; r < this.tunnelCount_; r++) {
      if (this.tnAlive[r] === 0) continue;
      for (let s = 0; s < 2; s++) {
        const k = s * MAX_TUNNELS + r;
        const strength = this.trailStrengthFor(s, r);
        if (strength > 0) {
          const p = fx.sub(ONE, fx.expNeg(fx.mul(K_DETECT, fx.mul(strength, DT))));
          const c = this.tnContact[k];
          this.tnContact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), p));
        } else {
          this.tnContact[k] = fx.mul(this.tnContact[k], CONTACT_DECAY);
        }
        const c = this.tnContact[k];
        const st = this.tnContactState[k];
        if (st < 2 && c >= IDENTIFIED_AT) {
          this.tnContactState[k] = 2;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'identified' });
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.tnContactState[k] = 1;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'suspected' });
        } else if (st > 0 && c < LOST_AT) {
          this.tnContactState[k] = 0;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'lost' });
        }
      }
    }
```

```typescript
  /** Best observation any unit of `side` has on route `r` this tick: the
   *  strongest single trail tile it can see. Zero when nobody sees any spoil. */
  private trailStrengthFor(side: number, r: number): Fx {
    let best = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.side[i] !== side || this.tunnelIn[i] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      const px = this.posX[i] >> 16;
      const py = this.posY[i] >> 16;
      // `sight` is Fx tiles on UnitType (there is no integer form); the scan
      // window wants whole tiles, so round up to avoid clipping the last ring.
      const reach = fx.toInt(fx.ceil(type.sight));
      for (let ty = py - reach; ty <= py + reach; ty++) {
        for (let tx = px - reach; tx <= px + reach; tx++) {
          if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
          const density = this.trail[ty * this.width + tx];
          if (density === 0) continue;
          if (this.tunnelOfTile(r, tx, ty) === 0) continue;
          const dSq = distSqFx(
            fx.sub(fx.from(tx + 0.5), this.posX[i]),
            fx.sub(fx.from(ty + 0.5), this.posY[i])
          );
          if (dSq < MIN_DETECT_DIST_SQ) continue;
          if (this.losRay(px, py, tx, ty) < 0) continue;
          const sig = fx.mul(TRAIL_SIGNATURE, fx.div(fx.fromInt(density), fx.fromInt(TRAIL_MAX)));
          const strength = fx.div(fx.mul(type.optics, sig), dSq);
          if (strength > best) best = strength;
        }
      }
    }
    return best;
  }
```

`tunnelOfTile` reads the `tnTiles` set built in Task 3:

```typescript
  /** Does route `r` pass under this tile? */
  private tunnelOfTile(r: number, tx: number, ty: number): number {
    return this.tnTiles[r].has(ty * this.width + tx) ? 1 : 0;
  }
```

```typescript
  /** Which of the three contact states `side` holds on route `r`. */
  tunnelContactLevel(side: number, r: number): 0 | 1 | 2 {
    return this.tnContactState[side * MAX_TUNNELS + r] as 0 | 1 | 2;
  }

  /** `mark_tunnel`: recon hands a route over identified, no dwell required. */
  identifyTunnelTo(side: number, r: number): void {
    const k = side * MAX_TUNNELS + r;
    this.tnContact[k] = ONE;
    if (this.tnContactState[k] !== 2) {
      this.tnContactState[k] = 2;
      this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side, tunnel: r, level: 'identified' });
    }
  }
```

Add `tunnelContact` to `SimEvent` and `SIM_EVENT_KINDS`.

- [ ] **Step 4: Run the tests and confirm the detection targets did not move**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint && pnpm balance`
Expected: all PASS, and all five §5.7 targets unchanged. `stepDetection` was extended; if ATGM Pk or the urban ratio moved, unit-vs-unit detection was disturbed and the new loop is reaching units it should not.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): a route is found through the spoil it leaves"
```

---

### Task 7: Containment — all three leak points

**Files:**
- Modify: `packages/sim/src/sim.ts:1672` (`selectTarget`), `splashAt`, `applySuppression`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `tunnelIn` (Task 3).
- Produces: nothing new. This task closes holes.

**This is the highest-risk task in the plan.** Each leak fails silently — the feature appears to work and is quietly pointless. Write all three tests before any implementation.

- [ ] **Step 1: Write the three failing tests**

```typescript
describe('a unit underground is contained', () => {
  function belowGround() {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const rifle = sim.addUnitType(RIFLE_TYPE);
    const hidden = sim.spawn(rifle, 1, fx.from(4.5), fx.from(6.5));
    const shooter = sim.spawn(rifle, 0, fx.from(6.5), fx.from(6.5));
    sim.putInTunnel(hidden, idx);
    return { sim, hidden, shooter, idx };
  }

  it('cannot be selected as a target', () => {
    const { sim, hidden, shooter } = belowGround();
    for (let t = 0; t < 200; t++) sim.tick();
    expect(sim.state.alive[hidden]).toBe(1);
    expect(sim.state.curTarget[shooter]).not.toBe(hidden);
  });

  it('cannot be reached by splash', () => {
    const { sim, hidden } = belowGround();
    const hpBefore = sim.state.hp[hidden];
    // A shell landing directly on top of the tunnel.
    sim.debugSplash(fx.from(4.5), fx.from(6.5), fx.from(4), fx.from(500), fx.from(1), -1, -1);
    expect(sim.state.hp[hidden]).toBe(hpBefore);
  });

  it('cannot be suppressed', () => {
    const { sim, hidden } = belowGround();
    sim.debugSuppress(hidden, fx.from(1.5));
    expect(sim.state.suppression[hidden]).toBe(0);
  });
});
```

`putInTunnel(id, routeIdx)` already exists (Task 3). `splashDirect` and `applySuppression` are private; the tests reach them through two new test hooks named to match the existing `debugKill` / `debugDestroyStructure` / `debugDisableFirepower` family:

```typescript
  /** Suppress a unit directly. Tests and the sandbox only. */
  debugSuppress(id: number, amount: Fx): void {
    this.applySuppression(id, amount, false);
  }

  /** Detonate a bare splash at a point. Tests and the sandbox only. */
  debugSplash(x: Fx, y: Fx, radius: Fx, dmg: Fx, supp: Fx, by: number, exclude: number): void {
    this.splashDirect(x, y, radius, dmg, supp, by, exclude);
  }
```

Place them beside `debugKill`. Do not widen the public API beyond these two hooks.

- [ ] **Step 2: Run them and watch all three fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t contained`
Expected: 3 FAIL. If any one passes before implementation, the test is not proving anything — fix the test first.

- [ ] **Step 3: Close the three holes**

In `selectTarget`, extend the existing skip:

```typescript
      // Men inside a building cannot be shot at: the building is in the way,
      // and taking it down is the only way to reach them. A tunnel is the same
      // idea a third time — the earth is in the way, and Yahalom is the way in.
      if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) continue;
```

In `splashAt` and `splashDirect`, skip contained units in the victim loop:

```typescript
      if (this.tunnelIn[v] >= 0) continue; // three metres of earth
```

At the top of `applySuppression`:

```typescript
    // You cannot pin someone who is underground. Without this, a mortar
    // barrage over a trail routs the occupants and the counter-unit is
    // decorative.
    if (this.tunnelIn[target] >= 0) return;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint && pnpm balance`
Expected: all PASS, §5.7 unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "fix(sim): the earth is in the way — fire, splash and suppression all stop at it"
```

---

### Task 8: `stepSurfacing` — up, volley, down

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `tunnelIn`, `tnVentOpen`, `SURFACE_SECONDS`, `SURFACE_VOLLEY` (Tasks 2–3).
- Produces: `surfaceTicks`, `volleyLeft` columns; events `{ kind: 'surfaced' | 'submerged', tick, entity, tunnel }`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('surfacing', () => {
  it('does not surface while the vent is still closed', () => {
    const { sim, hidden } = readyToVent({ dug: false });
    for (let t = 0; t < 200; t++) sim.tick();
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });

  it('surfaces at the vent when a target is in range and in sight of it', () => {
    const { sim, hidden, ventX, ventY } = readyToVent({ dug: true });
    let surfaced = false;
    for (let t = 0; t < 200 && !surfaced; t++) {
      for (const e of sim.tick()) if (e.kind === 'surfaced' && e.entity === hidden) surfaced = true;
    }
    expect(surfaced).toBe(true);
    expect(sim.state.tunnelIn[hidden]).toBe(-1);
    expect(fx.toNumber(sim.state.posX[hidden])).toBeCloseTo(ventX + 0.5, 1);
    expect(fx.toNumber(sim.state.posY[hidden])).toBeCloseTo(ventY + 0.5, 1);
  });

  it('stays up for the full window even under fire that would pin it', () => {
    const { sim, hidden } = readyToVent({ dug: true });
    let surfacedAt = -1;
    for (let t = 0; t < 400; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'surfaced' && e.entity === hidden) surfacedAt = t;
      }
      if (surfacedAt >= 0 && t === surfacedAt + 1) {
        sim.debugSuppress(hidden, fx.from(2)); // well past PIN_AT
      }
      if (surfacedAt >= 0 && t < surfacedAt + SURFACE_SECONDS * TICKS_PER_SECOND) {
        expect(sim.state.tunnelIn[hidden]).toBe(-1); // still exposed
      }
    }
    expect(surfacedAt).toBeGreaterThanOrEqual(0);
  });

  it('submerges once the volley is spent and the window has elapsed', () => {
    const { sim, hidden } = readyToVent({ dug: true });
    let submerged = false;
    for (let t = 0; t < 600 && !submerged; t++) {
      for (const e of sim.tick()) if (e.kind === 'submerged' && e.entity === hidden) submerged = true;
    }
    expect(submerged).toBe(true);
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });

  it('does not surface into a wall it cannot shoot past', () => {
    const { sim, hidden } = readyToVent({ dug: true, wallAcrossVent: true });
    for (let t = 0; t < 300; t++) sim.tick();
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });
});
```

Write `readyToVent(opts)` as a local helper that builds a sim, adds a short route, spawns an enemy rifle squad within 4 tiles of the vent, puts a hostile rifle team in the tunnel, and — when `opts.dug` — fast-forwards the dig by setting `tnProgress` to `tnLength` and `tnVentOpen` to 1 directly. When `opts.wallAcrossVent`, call `sim.setBlocked` on the tiles between vent and target.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t surfacing`
Expected: 5 FAIL.

- [ ] **Step 3: Implement**

```typescript
  private stepSurfacing(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;

      // Already up: run the exposure clock down, then go back under. The
      // volley AND the window both have to be spent — suppression does not
      // shorten it. A unit caught in the open is caught in the open, and that
      // guaranteed window is the player's whole answer to this mechanic.
      if (this.surfaceTicks[i] > 0) {
        this.surfaceTicks[i]--;
        if (this.surfaceTicks[i] === 0 && this.volleyLeft[i] <= 0) {
          this.submerge(i);
        }
        continue;
      }
      if (this.volleyLeft[i] > 0 && this.homeTunnel[i] >= 0) {
        // Window elapsed but the burst is unfinished: hold until it is.
        continue;
      }

      const r = this.tunnelIn[i];
      if (r < 0 || this.tnAlive[r] === 0 || this.tnVentOpen[r] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const [vx, vy] = this.ventPos(r);
      if (!this.hasTargetFrom(i, vx, vy)) continue;

      this.tunnelIn[i] = -1;
      this.homeTunnel[i] = r;
      this.tnOccupants[r]--;
      this.posX[i] = vx;
      this.posY[i] = vy;
      this.surfaceTicks[i] = SURFACE_SECONDS * TICKS_PER_SECOND;
      this.volleyLeft[i] = SURFACE_VOLLEY;
      this.pendingEvents.push({ kind: 'surfaced', tick: this.tickCount, entity: i, tunnel: r });
    }
  }

  private submerge(i: number): void {
    const r = this.homeTunnel[i];
    if (r < 0 || this.tnAlive[r] === 0) {
      // The route died while they were up. They are simply on the surface now.
      this.homeTunnel[i] = -1;
      return;
    }
    this.tunnelIn[i] = r;
    this.homeTunnel[i] = -1;
    this.tnOccupants[r]++;
    this.suppression[i] = 0; // out of the fire
    this.pendingEvents.push({ kind: 'submerged', tick: this.tickCount, entity: i, tunnel: r });
  }

  /** Is there a hostile this unit could engage FROM the vent tile? Evaluated
   *  from the vent rather than the unit's current position, because that is
   *  where it will be standing. Without the sight-line half, a unit surfaces
   *  facing a wall and burns its whole window achieving nothing. */
  private hasTargetFrom(i: number, vx: Fx, vy: Fx): boolean {
    const type = this.unitTypes[this.typeIdx[i]];
    const w = type.weapons[0];
    const sSide = this.side[i];
    const gx = vx >> 16;
    const gy = vy >> 16;
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) continue;
      if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], vx), fx.sub(this.posY[t], vy));
      if (dSq > w.effectiveRangeSq) continue;
      if (this.losRay(gx, gy, this.posX[t] >> 16, this.posY[t] >> 16) < 0) continue;
      return true;
    }
    return false;
  }
```

Add `surfaceTicks`, `volleyLeft`, `homeTunnel` to the SoA (all `Int32Array(capacity)`, `homeTunnel` filled with −1). Decrement `volleyLeft` in `fireAt` when `homeTunnel[shooter] >= 0`. Add `putInTunnel(id, r)` which sets `tunnelIn` and increments `tnOccupants`. Add `surfaced`/`submerged` to `SimEvent` and `SIM_EVENT_KINDS`. Call `stepSurfacing()` from `tick()` before `stepCombat()`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint && pnpm balance`
Expected: all PASS, §5.7 unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): a tunnel fighter surfaces, fires its burst, and goes back down"
```

---

### Task 9: The two units

**Files:**
- Modify: `data/schemas/unit.schema.json`
- Create: `data/units/enemy/digger_crew.json`
- Create: `data/units/kdf/yahalom_squad.json`
- Modify: `packages/sim/src/sim.ts` (`unitTypeFromJson`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `UnitType.canDig`, `UnitType.canTunnelCharge`, `UnitType.tunnelChargeTicks`.

- [ ] **Step 1: Extend the ability enum**

In `data/schemas/unit.schema.json`, add `"dig_tunnel"` and `"tunnel_charge"` to the abilities enum (which today ends `..., "demolish", "kamikaze"`). Add an optional `tunnel_charge_time_s` number property beside `demolition_time_s`.

- [ ] **Step 2: Author the digger**

Create `data/units/enemy/digger_crew.json`. Model the stat block on `mortar_crew.json` — same faction shape, same sensor style — with: `"role": "engineer"`, `"abilities": ["dig_tunnel", "tunnel_travel"]`, `"weapons": []`, a slow `speed_tiles_s` around `0.5`, and a low `signature` around `0.5`. It is not a combat unit; its threat is entirely what the route delivers.

- [ ] **Step 3: Author Yahalom**

Create `data/units/kdf/yahalom_squad.json` by starting from `demo_squad.json` and changing: `"id": "yahalom_squad"`, `"name": "Yahalom Engineers"`, `"abilities": ["tunnel_charge", "mark_tunnel", "garrison", "smoke"]`, `"tunnel_charge_time_s": 8`, and keeping the `carbines` weapon while dropping the `charges` weapon (it charges tunnels, not buildings). Set `"unlock": { "roe_rating_min": 55 }`.

- [ ] **Step 4: Parse the abilities**

In `unitTypeFromJson`, beside `canDemolish`:

```typescript
    canDig: abilities.includes('dig_tunnel'),
    canTunnelCharge: abilities.includes('tunnel_charge'),
    tunnelChargeTicks: fx.toInt(
      fx.mul(fx.from(json.tunnel_charge_time_s ?? CHARGE_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
```

Add the three fields to `UnitType` and `UnitTypeJson`.

- [ ] **Step 5: Run every content gate together**

Run: `pnpm validate:data && pnpm typecheck && python3 tools/validate_balance.py --units data/units`
Expected: all PASS, and the balance gate reports 25 units within ±18%.

The cost curve refits from the current roster on every run, so both units must be present when you run it — adding one, checking, then adding the other measures a curve that will not exist after the second lands. If either falls outside the band, adjust `cost.logistics`, not the stats: the stats are the design and the price is the free variable.

`pnpm typecheck` is load-bearing here specifically. Adding unit JSON with literal-union fields is exactly the case where the JSON-module call sites break and no other gate notices.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/unit.schema.json data/units/enemy/digger_crew.json data/units/kdf/yahalom_squad.json packages/sim/src/sim.ts
git commit -m "feat(data): a digger to sink the shaft and Yahalom to fill it"
```

---

### Task 10: `stepTunnelCharge` and the collapse

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Test: `packages/sim/src/tunnels.test.ts`

**Interfaces:**
- Consumes: `canTunnelCharge`, `tunnelChargeTicks` (Task 9); `tunnelContactLevel` (Task 6); `CHARGE_RANGE_SQ`, `CHARGE_SECONDS` (Task 2).
- Produces: `sim.queueCommand({ kind: 'chargeTunnel', ids, tunnel })`; event `{ kind: 'tunnelCollapsed', tick, tunnel, by }`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('collapsing a route', () => {
  it('will not charge a route the side has not identified', () => {
    const { sim, idx, yahalom } = chargeScenario({ revealed: false });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tnAlive[idx]).toBe(1);
  });

  it('collapses after the full charge time and kills the occupants', () => {
    const { sim, idx, yahalom, occupant } = chargeScenario({ revealed: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    let collapsed = null;
    for (let t = 0; t < 400 && !collapsed; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsed = e;
    }
    expect(collapsed).not.toBeNull();
    expect(collapsed.tunnel).toBe(idx);
    expect(collapsed.by).toBe(yahalom);
    expect(sim.tnAlive[idx]).toBe(0);
    expect(sim.state.alive[occupant]).toBe(0);
  });

  it('resets progress when the team is pinned', () => {
    const { sim, idx, yahalom } = chargeScenario({ revealed: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 40; t++) sim.tick();
    expect(sim.chargeTicks[yahalom]).toBeGreaterThan(0);
    sim.debugSuppress(yahalom, fx.from(2)); // over PIN_AT
    sim.tick();
    expect(sim.chargeTicks[yahalom]).toBe(0);
  });

  it('a unit surfaced from a route that collapses under it survives on the surface', () => {
    const { sim, idx, yahalom, occupant } = chargeScenario({ revealed: true, surfaced: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tnAlive[idx]).toBe(0);
    expect(sim.state.alive[occupant]).toBe(1); // it was above ground
    expect(sim.state.tunnelIn[occupant]).toBe(-1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/sim/src/tunnels.test.ts -t "collapsing a route"`
Expected: 4 FAIL.

- [ ] **Step 3: Implement**

```typescript
  private stepTunnelCharge(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.canTunnelCharge) continue;
      const r = this.chargeOrder[i];
      if (r < 0 || this.tnAlive[r] === 0) {
        this.chargeOrder[i] = -1;
        this.chargeTicks[i] = 0;
        continue;
      }
      // A route nobody has found cannot be charged: they would be digging at
      // random ground. Suspected is a blip, not a firing solution.
      if (this.tunnelContactLevel(this.side[i], r) !== 2) {
        this.chargeTicks[i] = 0;
        continue;
      }
      // Same conditions as a demolition charge: stationary, unshaken, in reach.
      if (this.displaced[i] === 1 || this.pinned[i] === 1 || this.tunnelIn[i] >= 0) {
        this.chargeTicks[i] = 0;
        continue;
      }
      if (this.nearestTrailDistSq(r, i) > CHARGE_RANGE_SQ) {
        this.chargeTicks[i] = 0;
        continue;
      }
      // Arrival is being in range, for the reason stepDemolition documents: an
      // order aimed at a route has no single tile to stand on, so `moving`
      // would never clear on its own.
      if (this.moving[i] === 1) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
      }
      if (++this.chargeTicks[i] >= type.tunnelChargeTicks) {
        this.collapseTunnel(r, i);
        this.chargeOrder[i] = -1;
        this.chargeTicks[i] = 0;
      }
    }
  }

  private collapseTunnel(r: number, by: number): void {
    this.tnAlive[r] = 0;
    this.tnVentOpen[r] = 0;
    // Everyone below dies. A bailing crew has somewhere to bail to; this does
    // not. Attributed to `by` so kill credit and ROE resolve the normal way.
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 1 && this.tunnelIn[i] === r) {
        this.tunnelIn[i] = -1;
        this.destroy(i, by);
      }
      // Anyone currently up from this route simply loses their hole.
      if (this.homeTunnel[i] === r) this.homeTunnel[i] = -1;
    }
    this.tnOccupants[r] = 0;
    const [cx, cy] = this.ventPos(r);
    this.splashDirect(cx, cy, TUNNEL_COLLAPSE_RADIUS, 0, TUNNEL_COLLAPSE_SHOCK, by, -1);
    this.pendingEvents.push({ kind: 'tunnelCollapsed', tick: this.tickCount, tunnel: r, by });
  }
```

`nearestTrailDistSq` walks the route's tile set for spoil that is still visible:

```typescript
  /** Squared distance from unit `i` to the closest tile of route `r` that
   *  still shows spoil. Infinity-ish when the trail has fully weathered —
   *  a route whose surface sign is gone cannot be worked on. */
  private nearestTrailDistSq(r: number, i: number): Fx {
    let best = FX_MAX;
    for (const t of this.tnTiles[r]) {
      if (this.trail[t] === 0) continue;
      const tx = t % this.width;
      const ty = (t - tx) / this.width;
      const d = distSqFx(
        fx.sub(fx.add(fx.from(tx), HALF), this.posX[i]),
        fx.sub(fx.add(fx.from(ty), HALF), this.posY[i])
      );
      if (d < best) best = d;
    }
    return best;
  }
```

Add the test hook beside the existing `debugDestroyStructure`, which exists for the same reason — letting a test assert an objective without staging the whole engagement that would satisfy it:

```typescript
  /** Bring a route down without a charge. Tests and the sandbox only. */
  debugCollapseTunnel(r: number): void {
    if (this.tnAlive[r] === 1) this.collapseTunnel(r, -1);
  }
```

Note `collapseTunnel` must therefore tolerate `by === -1`: `destroy(i, -1)` is the existing "killed by nobody" convention, and `splashDirect` already takes `-1` for an unattributed source.

Add `chargeOrder` and `chargeTicks` columns; handle the `chargeTunnel` command in `applyCommands` by setting `chargeOrder` and issuing a move toward the nearest revealed trail tile; add `tunnelCollapsed` to `SimEvent` and `SIM_EVENT_KINDS`; call `stepTunnelCharge()` from `tick()` after `stepDemolition()`. `nearestTrailDistSq(r, i)` walks the route's tile set and returns the squared distance to the closest tile with `trail > 0`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint && pnpm balance`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/tunnels.test.ts
git commit -m "feat(sim): Yahalom digs down and brings the route in on top of it"
```

---

### Task 11: The `collapse` objective

**Files:**
- Modify: `packages/sim/src/mission.ts:219` (`SUPPORTED`), the objective evaluation block, and `spawnPlacement`
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: `tnAlive`, `tunnelCollapsed` (Task 10).
- Produces: `collapse` objective; `in_tunnel` on placements.

- [ ] **Step 1: Write the failing tests**

In `packages/sim/src/mission.test.ts`, following the shape the `raze` tests already use:

```typescript
describe('collapse objective', () => {
  // Two routes with mouths inside `district`, one outside it. The zone rule is
  // the whole point of the objective, so the fixture has to be able to tell a
  // route in the zone from one that merely exists.
  const MAP = {
    id: 'tn_test', width: 24, height: 16,
    rows: Array.from({ length: 16 }, () => '.'.repeat(24)),
    zones: { district: [2, 2, 8, 8], player_start: [20, 12, 2, 2] },
    markers: { kdf: [21, 13] },
    tunnels: [
      { id: 'tn_a', mouth: [3, 3], vent: [12, 3] },
      { id: 'tn_b', mouth: [4, 6], vent: [12, 6] },
      { id: 'tn_far', mouth: [18, 3], vent: [20, 3] },
    ],
  };

  const mission = (over = {}) => ({
    id: 'm_collapse', town: 'beit_sahwan', phase: 'subterranean',
    map: { file: 'tn_test', player_start: 'kdf' },
    ledger: { requires: [], produces: [] },
    starting_force: [{ unit: 'yahalom_squad', count: 1, at: [21, 13] }],
    objectives: [
      { id: 'o_collapse', type: 'collapse', primary: true, target: 'district', seconds: 300 },
    ],
    ...over,
  });

  it('completes when every route whose mouth is in the zone is down', () => {
    const { sim, runtime } = startMission(mission(), MAP);
    sim.debugCollapseTunnel(0); // tn_a
    sim.debugCollapseTunnel(1); // tn_b
    const events = stepUntilObjective(sim, runtime, 'o_collapse');
    expect(events.at(-1)?.status).toBe('complete');
  });

  it('does not complete while one route in the zone still stands', () => {
    const { sim, runtime } = startMission(mission(), MAP);
    sim.debugCollapseTunnel(0); // only tn_a
    for (let t = 0; t < 200; t++) { sim.tick(); runtime.step([]); }
    expect(runtime.objectiveStatus('o_collapse')).toBe('active');
  });

  it('ignores a route whose mouth is outside the zone', () => {
    const { sim, runtime } = startMission(mission(), MAP);
    sim.debugCollapseTunnel(0);
    sim.debugCollapseTunnel(1);
    // tn_far is untouched and must not hold the objective open.
    expect(sim.tnAlive[2]).toBe(1);
    const events = stepUntilObjective(sim, runtime, 'o_collapse');
    expect(events.at(-1)?.status).toBe('complete');
  });

  it('fails at its deadline when no unit can carry a charge', () => {
    const { sim, runtime } = startMission(
      mission({ objectives: [
        { id: 'o_collapse', type: 'collapse', primary: true, target: 'district', seconds: 5 },
      ] }),
      MAP
    );
    sim.debugKill(0); // the only Yahalom
    let failed = false;
    for (let t = 0; t < 5 * TICKS_PER_SECOND + 20; t++) {
      sim.tick();
      for (const e of runtime.step([])) {
        if (e.kind === 'objective' && e.id === 'o_collapse' && e.status === 'failed') failed = true;
      }
    }
    expect(failed).toBe(true);
  });

  it('never completes for a zone with no mouths, rather than completing instantly', () => {
    const empty = { ...MAP, zones: { ...MAP.zones, bare: [14, 10, 2, 2] } };
    const { sim, runtime } = startMission(
      mission({ objectives: [
        { id: 'o_collapse', type: 'collapse', primary: true, target: 'bare', seconds: 300 },
      ] }),
      empty
    );
    for (let t = 0; t < 200; t++) { sim.tick(); runtime.step([]); }
    expect(runtime.objectiveStatus('o_collapse')).toBe('active');
  });
});
```

Three helpers this leans on: `startMission(missionJson, mapJson)` and `stepUntilObjective` already exist in `mission.test.ts` under whatever names that file uses — match them rather than adding new ones. `sim.debugCollapseTunnel(r)` is new: add it beside the existing `debugDestroyStructure`, which exists for exactly this reason (asserting an objective without staging the whole engagement that would satisfy it).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t collapse`
Expected: FAIL — `objective type "collapse" is not supported by the runtime yet`.

- [ ] **Step 3: Implement**

Add `'collapse'` to `SUPPORTED`. Snapshot the target set at construction, beside where `razeTargets` is built, collecting route indices whose **mouth point** falls inside the named zone. Then in the objective evaluation:

```typescript
      } else if (d.type === 'collapse') {
        const targets = this.collapseTargets.get(d.id) ?? [];
        // `targets.length > 0` for the same reason raze has it: an empty zone
        // must not read as an instant win. Unlike raze, validate_data also
        // rejects the empty zone at authoring time (see tools/validate_data.mjs),
        // so this guard is the backstop rather than the only line of defence.
        complete = targets.length > 0 && targets.every((r) => this.sim.tnAlive[r] === 0);
        failed = !complete && d.seconds !== undefined && tick >= d.seconds * TICKS_PER_SECOND;
      }
```

In `spawnPlacement`, honour `in_tunnel`: resolve the route id to its index and call `sim.putInTunnel(id, r)` for each spawned body. A placement naming an unknown route throws with the route id in the message, matching how `assertGroundClear` reports a bad placement.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
git commit -m "feat(sim): collapse is an objective, and a placement may start underground"
```

---

### Task 12: Author-time validation

**Files:**
- Modify: `data/schemas/mission.schema.json`
- Modify: `tools/validate_data.mjs`

**Interfaces:**
- Consumes: Task 11's `collapse` and `in_tunnel`.
- Produces: three CI checks.

- [ ] **Step 1: Extend the mission schema**

Add `"in_tunnel": { "type": "string" }` to the placement `$def`. The `collapse` objective type is already in the enum; extend the `type` description to state the zone rule, mirroring how `raze`'s rule is documented there.

- [ ] **Step 2: Add the three checks**

In `tools/validate_data.mjs`, in the mission cross-check block beside the `raze` checks:

```javascript
      if (o.type === 'collapse') {
        // A primary collapse needs a deadline for the same reason a primary raze
        // does: losing every unit that can carry a charge makes it permanently
        // impossible, and with no way to fail it the mission is unwinnable and
        // unlosable at once.
        if (o.primary && o.seconds === undefined) {
          failures.push(
            `${rel(file)}: collapse "${o.id}" is primary but declares no "seconds" deadline.`
          );
        }
        const rect = map.zones?.[o.target];
        if (!rect) {
          failures.push(
            `${rel(file)}: collapse "${o.id}" names zone "${o.target}", which map "${mi.map.file}" does not declare`
          );
        } else {
          const [zx, zy, zw, zh] = rect;
          const inZone = (map.tunnels ?? []).filter(
            (t) => t.mouth[0] >= zx && t.mouth[0] < zx + zw && t.mouth[1] >= zy && t.mouth[1] < zy + zh
          );
          if (inZone.length === 0) {
            failures.push(
              `${rel(file)}: collapse "${o.id}" zone "${o.target}" contains no tunnel mouths, ` +
                `so it can never complete. Note raze has the same hole and does not check for it.`
            );
          }
        }
      }
```

And, in the placement walk:

```javascript
      if (p.in_tunnel !== undefined && !(map.tunnels ?? []).some((t) => t.id === p.in_tunnel)) {
        failures.push(
          `${rel(file)}: placement "${p.unit}" declares in_tunnel "${p.in_tunnel}", ` +
            `which map "${mi.map.file}" does not declare`
        );
      }
```

- [ ] **Step 3: Prove each check fires**

Write a scratch mission JSON in the scratchpad that trips each of the four failures in turn, run `pnpm validate:data` against each, and confirm the message names the offending id. Delete the scratch files afterward — they must not be committed.

Run: `pnpm validate:data`
Expected: PASS on the real content, and each scratch case produced its specific message.

- [ ] **Step 4: Commit**

```bash
git add data/schemas/mission.schema.json tools/validate_data.mjs
git commit -m "feat(tools): a collapse objective is checked before it reaches a playtest"
```

---

### Task 13: Wiring — app, renderer, and the walker

**Files:**
- Modify: `packages/app/src/main.ts:232-254`
- Modify: `packages/render/src/renderer.ts`
- Modify: `tools/src/walk_mission.ts`

**Interfaces:**
- Consumes: `ParsedMap.tunnels` (Task 1), `sim.addTunnel` (Task 3), `sim.trail` (Task 5), `sim.tunnelContactLevel` (Task 6).
- Produces: a playable, visible feature.

**Note — this task goes slightly beyond the spec.** The spec covers the sim and the content but never says how the trail is drawn, and an invisible trail makes the whole feature unplayable. A minimal tile tint is the smallest thing that discharges that, and it is deliberately not VFX polish, which M1 excludes.

- [ ] **Step 1: Wire routes into the sim**

In `packages/app/src/main.ts`, after the structures loop:

```typescript
  const tunnelIdx = new Map<string, number>();
  for (const t of map.tunnels) {
    tunnelIdx.set(t.id, sim.addTunnel({ id: t.id, points: t.points, dig_tiles_per_s: t.digTilesPerS }));
  }
```

Pass `tunnelIdx` into the mission runtime context so `in_tunnel` can resolve.

- [ ] **Step 2: Draw the trail**

In the renderer's terrain pass, tint any tile whose `sim.trail[t] > 0` **and** whose route the player side has at least *suspected*, scaling alpha by density. Use a palette key through the existing terrain-tones bundle — never a colour literal, which `pnpm validate:ui` rejects with no allowlist.

- [ ] **Step 3: Print tunnels in the walker**

In `tools/src/walk_mission.ts`, add a tunnel block to the world dump: route id, progress as a percentage of length, vent open, occupant count, and the player side's contact state. This is the only instrument that sees an authored world; a trigger that never fires or a route nothing digs is invisible without it.

- [ ] **Step 4: Verify by driving the UI, not the console**

Run `pnpm dev`, load a mission with a tunnel, and confirm by watching: the trail appears as the digger advances, it is invisible until a unit gets line of sight, Yahalom's charge takes its full time, and the route dies with its occupants.

Console shortcuts skip the code that breaks. Drive the actual UI.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main.ts packages/render/src/renderer.ts tools/src/walk_mission.ts
git commit -m "feat(app): tunnels reach the map, the screen and the walker"
```

---

### Task 14: The determinism replay

**Files:**
- Modify: `packages/sim/src/determinism.test.ts`

**This is the only task permitted to change the golden hash.**

- [ ] **Step 1: Put a tunnel in the replay world**

Extend the replay world with a route, a digger assigned to it, and one occupant that surfaces during the 1000 ticks. Follow how [cb494c2](https://github.com/ilan-pinto/roaring-lions/commit/cb494c2) added structures: the columns must be *exercised*, not merely present, or the pin covers nothing.

- [ ] **Step 2: Add a test proving the tunnel paths are exercised**

Mirror the existing `'the replay actually exercises the structure paths'` test:

```typescript
  it('the replay actually exercises the tunnel paths', () => {
    const sim = buildReplayWorld();
    let surfaced = false;
    let dug = false;
    for (let t = 0; t < 1000; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'surfaced') surfaced = true;
      }
      if (sim.tnProgress[0] > 0) dug = true;
    }
    expect(dug).toBe(true);
    expect(surfaced).toBe(true);
  });
```

- [ ] **Step 3: Fold the tunnel columns into the hash**

Add `tnAlive`, `tnProgress`, `tnVentOpen`, `tnOccupants` and the per-unit `tunnelIn` to `hash()`. Do not add the `trail` grid: it is `width * height` bytes of derived state that `tnProgress` already determines, and hashing it would make every trail-decay tuning change a hash change for no added coverage.

- [ ] **Step 4: Re-pin**

Run: `pnpm test:determinism`
Read the actual hash from the failure, update the expected value, and write the reason in a comment above it — following the existing comment style, which explains *what* moved and *why* the pin moved with it.

- [ ] **Step 5: Full gate sweep**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && python3 tools/validate_balance.py --units data/units && pnpm balance`
Expected: every one PASS. The §5.7 numbers must be unchanged from the values in the README — this subsystem touches no combat maths, so any movement is a bug in this work.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/determinism.test.ts
git commit -m "test(sim): put a tunnel in the determinism replay, and re-pin"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: *Declaring a tunnel* → 1; *State* → 3; *Systems* → 4, 8, 10; *Being untargetable* → 7; *Detecting the trail* → 6; *The two units* → 9; *The `collapse` objective* → 11; *Determinism* → 14; *Validation* → 12, 13, 14.

**One addition beyond the spec:** trail rendering (Task 13, Step 2). The spec never says how the trail is drawn, and without it the feature cannot be played. Flagged rather than smuggled.

**One risk the plan cannot remove.** Task 6 adds a per-observer tile scan for trail detection, which is O(units × sight²) per tick on top of detection that CLAUDE.md already records as O(N²) needing staggering before ~150 units. At the authored mission scale (65 units at the largest) this is fine. It should not ship to a 300-unit mission without staggering, and the note belongs in *Known scaling debts* when this lands.

---

### Task 15: The `tunnel_collapse` VFX emitter

**Files:**
- Create: `data/vfx/tunnel_collapse.json`
- Modify: `packages/data/src/index.ts` (register it in `vfxEmitters`)
- Modify: `packages/render/src/renderer.ts` (bind the `tunnelCollapsed` sim event to the emitter)

**Interfaces:**
- Consumes: the `tunnelCollapsed` event (Task 10) and the renderer's event subscription (Task 13).
- Produces: nothing later tasks depend on.

**Why this task exists:** the spec's content surface lists this emitter, and the original 14-task plan omitted it — a spec-coverage miss caught late. `vfx_emitter.schema.json` has carried a `tunnel_collapse` trigger with no JSON behind it since before this work began; this is its first author.

**Scope discipline:** this is *data*, not art. No Blender, no sprites, no `.blend` — M1 excludes art-pipeline activation, and this task must not become its thin end. Particle sprites come from the schema's existing set (`soft_dot`, `hard_dot`, `streak`, `smoke_puff`, `spark`, `shard`, `ring`); colours are palette keys only, never hex.

- [ ] **Step 1: Author the emitter**

Model it on `data/vfx/structure_collapse.json`, which is the closest existing sibling — but the event is different and the emitter should read differently. A building collapsing throws masonry outward and upward; a tunnel collapsing is the ground *falling in*. So:

- a `shard` burst with **low** `speed_tiles_s` and positive `gravity_tiles_s2` — spoil dropping, not flung
- a `smoke_puff` layer in the `dust` ramp, `cone_deg: 360`, slight negative gravity so the dust column lifts after the drop
- `layer: "ground_decal"` or `"below_units"` — the collapse happens at ground level, and drawing it over units would read as an airburst

Note the palette convention: **ramp index 0 is the lightest**, so a `color_over_life` that darkens counts *up* (`["dust.1", "dust.5"]`), not down. Getting this backwards inverts the effect.

- [ ] **Step 2: Validate the JSON**

Run: `pnpm validate:data`
Expected: PASS, with the file count up by one. The schema gate checks the trigger name, the sprite names, and that every colour resolves to a real palette key — a hex literal or an unknown ramp index fails here.

- [ ] **Step 3: Register and bind**

Add the import and array entry in `packages/data/src/index.ts` beside `structureCollapse`. In the renderer, bind `tunnelCollapsed` to the emitter the same way `structureDestroyed` binds to `structure_collapse` — by name, off the event, with the sim unaware any of it happened (invariant 4).

- [ ] **Step 4: Verify in the browser, not the console**

With a mission containing a tunnel, collapse a route and watch it. Console shortcuts skip the code that breaks.

Run: `pnpm test && pnpm validate:data && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/vfx/tunnel_collapse.json packages/data/src/index.ts packages/render/src/renderer.ts
git commit -m "feat(data): the ground falls in, and it looks like it"
```

---

### Task 16: Containment, structurally

**Files:**
- Modify: `packages/sim/src/sim.ts` (`applyCommands`, `putInTunnel`, and the non-command leaks)
- Modify: `packages/sim/src/mission.ts` (the runtime predicates)
- Test: `packages/sim/src/tunnels.test.ts`, `packages/sim/src/mission.test.ts`

**Interfaces:** consumes everything Tasks 3–11 built; produces no new API.

**Why this task exists:** the containment rule — *earth is in the way, in both directions* — has needed new enforcement in four separate tasks, each time found by a reviewer rather than by design, each time "one more place". Tasks 7 and 8 sealed fire, splash, suppression, damage, drones, sight, shells in flight, and the outbound halves. Task 11 sealed movement orders and zone-holding. A sweep then found 31 more candidate sites. Guard-by-guard has demonstrably not converged; this task replaces enumeration with structure.

**The two structural fixes** (a reviewer's recommendation, and the sweep's own evidence supports it):

1. **One eligibility check where `applyCommands` expands `cmd.ids`**, so every surface command refuses buried units *by construction*. Per-command enumeration fails silently on the next command kind someone adds — and the sweep found eight branches already missing it (`load`, `garrison`, `demolish`, `chargeTunnel`, `smoke`, `callStrike`, `unload`, `halt`, plus the move/attackMove *append fast-path* which returns before the existing guard).
2. **`putInTunnel` clears the full order bundle** the move branch enumerates — `attackMove`, `boardGoal`, `garrisonGoal`, `demolishOrder`, `chargeOrder` — not just `moving`/`wpCount`/goals/`fieldRef`. `stepSweep`, `stepTransport` and kamikaze steering set `moving = 1` with **no command at all**, so a command-layer guard alone cannot contain them. This is the hole that reopened after Task 11's first fix.

**The candidate list** lives at `.superpowers/sdd/2026-08-18-tunnel-subsystem/containment-findings.md` — 31 entries with claimed reachability and consequence. They are **unverified**: three of six sweep lenses completed and no adversarial verification ran. Verify each against the real code before fixing. Expect some to be already guarded one level down, and some to be the design.

**The distinction that will trip you up:** `tunnelIn >= 0` means *underground, contained*. `homeTunnel >= 0` with `tunnelIn === -1` means *currently surfaced from a route* — an ordinary surface unit that must **not** be contained. A fix that confuses them breaks the whole combat loop while every containment test still passes.

**Reachable today, without any schema change** (these three are not theoretical — `stepSurfacing`/`submerge` bury units at runtime):
- the satellite sweep (`reveal`) identifies a submerged fighter through earth, via the shipped HUD path
- APS intercepts a round while its carrier is underground — and **draws from the per-entity RNG stream** doing it, which is determinism-relevant
- `checkAmbushSpring` springs a surface ambusher on a buried enemy

Everything else is gated behind the `in_tunnel` schema key, which **Task 12 adds** — so Task 12 opens the door on the remainder at once. This task must land before or with Task 12.

- [ ] **Step 1: Triage the candidate list**

Read `containment-findings.md`. For each entry, read the real code and classify: REAL / ALREADY-GUARDED / BY-DESIGN. Write the triage into your report before changing anything — a fix list that skips triage will "fix" things that are already correct and miss the ones that are not.

- [ ] **Step 2: Write the failing tests**

Start with the three reachable-today cases, which need no authored `in_tunnel`: surface a fighter, submerge it, then (a) call a sweep over it and assert it is not identified, (b) resolve a shaped-charge round at it and assert no `aps` event and no RNG draw, (c) place an ambusher in radius and assert it does not spring. Then a test per REAL finding from the triage.

Run them and confirm each fails for its own reason.

- [ ] **Step 3: Implement the two structural fixes, then the residue**

Structural fixes first; re-run the tests and see how many now pass without further work. That number belongs in your report — it is the measure of whether the structure was the right call. Then fix whatever remains individually.

- [ ] **Step 4: Verify**

```bash
npx vitest run packages/sim/src/ && pnpm lint && pnpm typecheck && pnpm validate:data && pnpm test:determinism && pnpm balance
```

The determinism hash must be unchanged and `pnpm balance` must hold all five §5.7 figures. The APS fix in particular removes an RNG draw from a path that could previously reach it — confirm the replay world never reached that path, or the hash moves and the change is not what you think it is.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/mission.ts packages/sim/src/tunnels.test.ts packages/sim/src/mission.test.ts
git commit -m "fix(sim): containment is a rule, not a list of places that remembered it"
```
