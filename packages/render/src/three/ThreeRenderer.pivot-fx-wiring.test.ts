/**
 * The GH-1207 pivot effects through the renderer's own two clocks, end to end.
 *
 * ## Why this file exists
 *
 * PR 1211's review found that the two WIRING lines for the pivot dust and the
 * pivot scuff had no integration test: `units/vehicle-fx.test.ts` pins
 * `pivotDustMagnitude` and `units/ground-churn.test.ts` pins `stepPivotScuff`,
 * so either wiring line could be deleted from `ThreeRenderer.ts` and every
 * suite stayed green. A pure function nobody calls is a green check about
 * nothing.
 *
 * What is pinned here, in the order the two clocks run:
 *  - the SNAPSHOT side: `stepVehicleNature` -> `stepPivotScuff` -> one
 *    `scuff` decal through `stampGroundDecal`, exactly once per pivot
 *    episode, and nothing at all for a parked hull;
 *  - the FRAME side: `updateVehicleAmbientFx` -> `pivotDustMagnitude` reading
 *    the weight model's `smoothedYawRate` -> `particleSystem.spawn` at both
 *    track ends, every frame, and nothing at all for a parked hull.
 *
 * ## Harness
 *
 * `ThreeRenderer.vehicle-weight.test.ts`'s: a faked `WebGLRenderer`, a real
 * `Sim`, and a real GLTF fixture installed into the private template map --
 * so `updateVehicleMeshes` really steps the weight model and
 * `smoothedYawRate` is the renderer's own number, not a fixture written into
 * the array. Only `vehicle_dust` is wired through `useEmitters` (no exhaust,
 * no mud, no rotor wash), so every `spawn` call recorded here is the pivot
 * path's; a parked hull therefore has to record exactly zero, which is what
 * makes "the parked one emits nothing" a real assertion rather than a
 * comparison against a second effect.
 *
 * The pivot is steered the way `ThreeRenderer.disturb-clock.test.ts` steers
 * the churn's: a stationary hull's heading advanced 0.01 turn (0.2 turn/s,
 * the `mbt_lavi`'s own rate) per SIM TICK, with the three 60 fps frames the
 * app draws across each tick. That is above `PIVOT_DUST_MIN_YAW_TURNS_S` and
 * `CHURN_PIVOT_MIN_YAW_TURNS_S` (0.05) and over both holds, and it leaves
 * `entitySpeed` at exactly 0, so the ordinary translation-dust ramp cannot
 * explain anything this file sees -- the moving branch's `nextVehicleMoving`
 * never even runs.
 *
 * ## Falsifications, each run and watched red, then reverted
 *
 *  - `updateVehicleAmbientFx`: deleted the frame-side pivot block (the
 *    `const pivot = pivotDustMagnitude(...)` line through its closing brace)
 *    -> "throws dust from both track ends" fails with 0 spawns recorded.
 *  - `stepVehicleNature`: deleted the `const scuffed = stepPivotScuff(...)`
 *    line and let the `if (scuffed ...)` read `undefined` (so the stamp is
 *    skipped) -> "leaves exactly one scuff" fails with 0 scuffs stamped.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import type { VehicleWeightArrays } from './units/vehicle-weight';
import type { EmitterSpec } from '../vfx/emitters';
import vehicleDust from '../../../../data/vfx/vehicle_dust.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/** A tracked hull with the shipped Lavi's rates: 1.1 tiles/s cruise, and the
 *  sim's own turn rate (`turn_per_tick`) is what `CHURN_PIVOT_*` measures the
 *  steered 0.2 turn/s against. `armor.front` clears `SOFT_ARMOR_LIMIT`, so
 *  `updateVehicleAmbientFx`'s infantry gate lets it through. */
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

const FRAME_MS = 1000 / 60;
/** Where the only hull in the world stands. Literal, so the dust geometry
 *  assertions do not recompute what the renderer computes. */
const HOME = { x: 6.5, y: 6.5 };
/** `TRACK_FOOTPRINT.tracked.gaugeTiles`, as a literal: the distance from the
 *  hull's centreline to each track's centre, tiles. */
const TRACK_GAUGE_TILES = 0.22;
/** `SCUFF_RADIUS_TILES`: the pivot scuff's half extents, tiles. */
const SCUFF_RADIUS_TILES = 1;

interface Decal {
  kind: string;
  x: number;
  z: number;
  halfLength: number;
  halfWidth: number;
  simMs: number;
}

interface Spawn {
  x: number;
  y: number;
  magnitude: number;
}

/** The private surface these specs drive and read. No public seam exists for
 *  any of it, and adding one would widen `Renderer` (`../api.ts`) for a test
 *  -- the same reach the other `ThreeRenderer.*.test.ts` files make. */
interface Priv {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  vehicleWeight: VehicleWeightArrays;
  entitySpeed: Float64Array;
  particleSystem: { spawn(...a: unknown[]): void } | null;
  stampGroundDecal(s: Decal): boolean;
}

interface World {
  sim: Sim;
  renderer: ThreeRenderer;
  priv: Priv;
  id: number;
  /** Every decal the renderer stamped, in order. */
  decals: Decal[];
  /** Every `particleSystem.spawn` call, grouped by the frame that made it. */
  frames: Spawn[][];
  /** Starts a new frame bucket; call once before each `frame()`. */
  beginFrame(): void;
  /** One sim tick and the three 60 fps frames the app draws across it. */
  drawTick(): void;
  /** One tick of a pivot: the heading advances, then a snapshot and three
   *  frames see it. `turns` is absolute (0..1). */
  pivotTick(turns: number): void;
  /** Ticks with no heading change at all. */
  parkTicks(n: number): void;
  spawns(): Spawn[];
}

async function world(): Promise<World> {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 4 });
  const id = sim.spawn(sim.addUnitType(TANK), 0, fx.from(HOME.x), fx.from(HOME.y));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  // A viewport, as `init()` would have measured one (`ThreeRenderer.blast.test.ts`
  // has the comment on why 0x0 is not harmless).
  (priv as unknown as { cssWidth: number }).cssWidth = 1400;
  (priv as unknown as { cssHeight: number }).cssHeight = 900;

  const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  priv.vehicleMeshTemplates.set(TANK.id, buildVehicleMeshTemplate(gltf, TANK.id));
  priv.vehicleMeshBounds.set(TANK.id, new THREE.Vector3(2, 0.8, 1.2));

  renderer.useEmitters([vehicleDust as unknown as EmitterSpec], () => '#8E9491');
  const system = priv.particleSystem;
  if (system === null) throw new Error('useEmitters did not build a ParticleSystem');

  const decals: Decal[] = [];
  const stamped = priv.stampGroundDecal.bind(renderer);
  priv.stampGroundDecal = (s: Decal): boolean => {
    decals.push({ ...s });
    return stamped(s);
  };

  const frames: Spawn[][] = [];
  const inner = system.spawn.bind(system);
  system.spawn = (...a: unknown[]): void => {
    const bucket = frames[frames.length - 1];
    const spawn = { x: a[1] as number, y: a[2] as number, magnitude: a[4] as number };
    if (bucket !== undefined) bucket.push(spawn);
    inner(...a);
  };

  // Twice: the first snapshot only seeds `prevX`/`curX` from zero-filled slots.
  renderer.snapshot();
  renderer.snapshot();
  // One frame at rest, the way a spawned vehicle is first drawn in the game.
  frames.push([]);
  renderer.frame(1, FRAME_MS);

  const w: World = {
    sim,
    renderer,
    priv,
    id,
    decals,
    frames,
    beginFrame(): void {
      frames.push([]);
    },
    drawTick(): void {
      sim.tick();
      renderer.snapshot();
      for (let f = 1; f <= 3; f++) {
        frames.push([]);
        renderer.frame(f / 3, FRAME_MS);
      }
    },
    pivotTick(turns: number): void {
      // The heading the snapshot reads, then the tick, then restored: with no
      // order the sim leaves a stopped hull's heading alone, but this test
      // never depends on that.
      sim.state.facing[id] = fx.from(turns % 1);
      renderer.snapshot();
      for (let f = 1; f <= 3; f++) {
        frames.push([]);
        renderer.frame(f / 3, FRAME_MS);
      }
      sim.tick();
      sim.state.facing[id] = fx.from(turns % 1);
    },
    parkTicks(n: number): void {
      for (let i = 0; i < n; i++) w.drawTick();
    },
    spawns(): Spawn[] {
      return frames.flat();
    },
  };
  return w;
}

/** Spawns in one bucket at distinct positions, to the millimetre. */
function positions(frame: Spawn[]): string[] {
  return [...new Set(frame.map((s) => `${s.x.toFixed(3)},${s.y.toFixed(3)}`))];
}

const scuffs = (w: World): Decal[] => w.decals.filter((d) => d.kind === 'scuff');

describe('pivot dust through the frame-side wiring (GH-1207)', () => {
  it('a tracked hull turning on the spot throws dust from both track ends, every frame', async () => {
    const w = await world();
    w.parkTicks(8);
    expect(w.spawns(), 'parked: the emitter is wired but fires for nothing').toHaveLength(0);

    for (let t = 1; t <= 24; t++) w.pivotTick(t * 0.01);

    const spawns = w.spawns();
    expect(spawns.length, 'a pivot frame spawns dust').toBeGreaterThan(0);
    // Translation is exactly zero, so the moving-dust branch cannot be the
    // source of any of it.
    expect(w.priv.entitySpeed[w.id]).toBe(0);
    const turning = w.frames.filter((f) => f.length > 0);
    expect(turning.length, 'the dust is emitted on many frames, not one burst').toBeGreaterThanOrEqual(10);
    // "Every frame": once the yaw-rate ramp has crossed its threshold (the first emitting frame, after the 8 parked ticks' 24 frames and
    // at most 4 warm-up ticks), NO frame is skipped. A count of emitting frames alone passes an emitter that fires on one frame in six.
    const firstEmitting = w.frames.findIndex((f) => f.length > 0);
    expect(firstEmitting, 'dust starts after the parked frames and within the warm-up').toBeGreaterThanOrEqual(24);
    expect(firstEmitting).toBeLessThanOrEqual(36);
    const afterWarmUp = w.frames.slice(firstEmitting);
    expect(afterWarmUp.length, 'a long run of pivot frames to check').toBeGreaterThanOrEqual(60);
    expect(afterWarmUp.filter((f) => f.length === 0).length, 'a frame after the warm-up that threw no dust').toBe(0);

    // Both track ends, a gauge apart on either side of the hull's centreline:
    // the geometry the issue asks for, as literals rather than a recomputation.
    const bothEnds = turning.filter((f) => positions(f).length === 2);
    expect(bothEnds.length, 'each emitting frame spawns at both track ends').toBe(turning.length);
    for (const spawn of spawns) {
      expect(Math.hypot(spawn.x - HOME.x, spawn.y - HOME.y)).toBeCloseTo(TRACK_GAUGE_TILES, 3);
      // `PIVOT_DUST_MAGNITUDE` caps the pivot plume below a launch's.
      expect(spawn.magnitude).toBeGreaterThan(0);
      expect(spawn.magnitude).toBeLessThanOrEqual(0.8);
    }
    // And the two ends really are opposite each other about the centre.
    for (const frame of bothEnds) {
      expect(frame[0].x + frame[1].x).toBeCloseTo(HOME.x * 2, 6);
      expect(frame[0].y + frame[1].y).toBeCloseTo(HOME.y * 2, 6);
    }
    w.renderer.dispose();
  });

  it('a parked tracked hull throws no pivot dust at all', async () => {
    const w = await world();
    w.parkTicks(100);
    expect(w.spawns()).toHaveLength(0);
    // Anti-vacuity: the same world's same wiring fires the moment it turns.
    for (let t = 1; t <= 12; t++) w.pivotTick(t * 0.01);
    expect(w.spawns().length).toBeGreaterThan(0);
    w.renderer.dispose();
  });
});

describe('pivot scuff through the snapshot-side wiring (GH-1207)', () => {
  it('a tracked hull turning on the spot leaves exactly one scuff, then one more per new episode', async () => {
    const w = await world();
    w.parkTicks(8);
    expect(scuffs(w), 'parked: no scuff').toHaveLength(0);

    // CHURN_PIVOT_HOLD_TICKS is 4; 30 ticks is far past it and past two
    // CHURN_PIVOT_PERIOD_TICKS restamps, so the churn really is re-stamping
    // while the scuff must not.
    for (let t = 1; t <= 30; t++) w.pivotTick(t * 0.01);
    expect(w.decals.filter((d) => d.kind === 'churn').length, 'the churn restamps').toBeGreaterThan(1);

    const first = scuffs(w);
    expect(first).toHaveLength(1);
    expect(first[0].halfLength).toBe(SCUFF_RADIUS_TILES);
    expect(first[0].halfWidth).toBe(SCUFF_RADIUS_TILES);
    expect(first[0].x).toBeCloseTo(HOME.x, 6);
    expect(first[0].z).toBeCloseTo(HOME.y, 6);
    // Dated at its tick, in the sim's own 50 ms units.
    expect(first[0].simMs % 50).toBe(0);

    // Still pivoting: a long episode is still ONE scuff.
    for (let t = 31; t <= 70; t++) w.pivotTick(t * 0.01);
    expect(scuffs(w)).toHaveLength(1);

    // Stop, then pivot again: a new episode, a new scuff.
    w.parkTicks(20);
    for (let t = 1; t <= 12; t++) w.pivotTick(t * 0.01);
    expect(scuffs(w)).toHaveLength(2);
    w.renderer.dispose();
  });

  it('a parked tracked hull stamps no scuff', async () => {
    const w = await world();
    w.parkTicks(100);
    expect(scuffs(w)).toHaveLength(0);
    w.renderer.dispose();
  });
});
