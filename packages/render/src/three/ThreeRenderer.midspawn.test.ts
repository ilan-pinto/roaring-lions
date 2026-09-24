/**
 * A unit spawned MID-mission, between two snapshots.
 *
 * `main.ts`'s `runTick` runs `sim.tick()`, then `renderer.snapshot()`, then
 * `runtime.step()` -- and every mid-mission spawn happens inside that last
 * call: the build queue, `spawn`/`reinforce` triggers, waves. So the newcomer
 * is inside `sim.entityCount` for up to a whole tick before this renderer has
 * a position copy for it. Found by the review of the `reseed` work, with a
 * probe that read `prev = cur = (0, 0)` between the ticks and then
 * `prev = (0, 0)`, `cur = spawn`, `entitySpeed` 467.5 after the next one.
 *
 * Two halves, both in `ThreeRenderer`:
 *  (a) `snapshot()` seeds an entity it has never seen -- `prev = cur`, speed
 *      0 -- so its first tick does not lerp it in from world (0, 0);
 *  (b) every per-frame entity loop (and `pickUnit`) stops at the count the
 *      last snapshot saw (`snapshottedCount`), so until then it is not drawn
 *      at all rather than drawn at the origin.
 *
 * Three newcomers land in the same `runtime.step`, one per draw path, so
 * each of (b)'s bounds has an observer of its own: a tank through a real
 * mesh-vehicle template built from the rigid fixture (the shape
 * `ThreeRenderer.vehicle-weight.test.ts` uses), a rifle squad through a
 * real skinned mesh-unit template, and a second rifle type through a real
 * `UnitInstancer` over the shipped INF_SQUAD sheet (the billboard path,
 * the shape `ThreeRenderer.fire-latch.test.ts` uses). The real dust and
 * exhaust emitters are wired through the public `useEmitters` seam.
 * Watched going red (recorded in the commit bodies of 4d6d2ede and the
 * round-2 fix): with (a) removed, (ii) and the pause test; with (b)
 * removed, (i) and the pause test; and with each of (b)'s bounds removed
 * ALONE, the one assertion in (i) that observes it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { buildMeshUnitTemplate, type MeshUnitEntity, type MeshUnitTemplate } from './units/mesh-unit';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { parseFixture } from './units/mesh-fixture';
import { packSheet } from './units/atlas';
import { UnitInstancer } from './units/instances';
import type { EntityFrame } from './units/frame-state';
import type { OverlayBatch } from './units/overlays';
import { parseManifest } from '../sheet';
import infSquadManifest from '../../../../assets/sprites/INF_SQUAD/manifest.json';
import type { EmitterSpec } from '../vfx/emitters';
import vehicleDust from '../../../../data/vfx/vehicle_dust.json';
import vehicleExhaust from '../../../../data/vfx/vehicle_exhaust.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

/** The shipped unit JSON, so the weight model and the dust cadence read the
 *  real cruise speed rather than a stand-in. */
function unitJson(id: string): UnitTypeJson {
  for (const dir of ['kdf', 'enemy']) {
    const p = path.join(REPO, 'data/units', dir, `${id}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as UnitTypeJson;
  }
  throw new Error(`no data/units/*/${id}.json`);
}

interface Priv {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  unitInstancers: Map<string, UnitInstancer>;
  framesByType: Map<string, EntityFrame[]>;
  overlayBatch: OverlayBatch;
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  particleSystem: { spawn(...args: unknown[]): void } | null;
  prevX: Float64Array;
  prevY: Float64Array;
  curX: Float64Array;
  curY: Float64Array;
  entitySpeed: Float64Array;
  drawsEnvelope(i: number): boolean;
  cssWidth: number;
  cssHeight: number;
}

const FRAME_MS = 1000 / 60;
/** The force already on the map: off the line from the origin to the
 *  newcomer, so nothing it emits can be mistaken for a trail from (0, 0). */
const RESIDENT_AT: [number, number] = [20.5, 3.5];
/** Where the mid-mission unit spawns -- far from world (0, 0). */
const SPAWN_AT: [number, number] = [15.5, 17.5];
/** The infantry newcomers, also far from the origin and from each other. */
const INFANTRY_AT: [number, number] = [12.5, 20.5];
const BILLBOARD_AT: [number, number] = [18.5, 14.5];

/** A rifle squad drawn through the skinned mesh-unit path. */
const MESH_INF: UnitTypeJson = {
  id: 'midspawn_mesh_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};
/** The same squad under another id, which gets a billboard sheet and never a
 *  mesh -- `updateUnits` skips any type with a mesh template. */
const SPRITE_INF: UnitTypeJson = { ...MESH_INF, id: 'midspawn_sprite_inf' };

interface World {
  sim: Sim;
  renderer: ThreeRenderer;
  priv: Priv;
  /** The tank `runtime.step` spawned after this tick's snapshot. */
  newcomer: number;
  /** Spawned in the same step: a mesh-drawn squad and a billboard squad. */
  infantry: number;
  billboard: number;
  /** Every particle spawn since the newcomer arrived: where, and whether it
   *  was a dust layer. */
  particles: { x: number; y: number; dust: boolean }[];
}

/**
 * Boot with one resident tank, run one tick the way `runTick` does, and
 * spawn a second tank AFTER that tick's snapshot -- a reinforcement landing
 * in `runtime.step`.
 */
async function midMissionSpawn(): Promise<World> {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const tank = sim.addUnitType(unitJson('mbt_lavi'));
  const meshInf = sim.addUnitType(MESH_INF);
  const spriteInf = sim.addUnitType(SPRITE_INF);
  sim.spawn(tank, 0, fx.from(RESIDENT_AT[0]), fx.from(RESIDENT_AT[1]));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  priv.cssWidth = 1400;
  priv.cssHeight = 900;
  const dust = vehicleDust as unknown as EmitterSpec;
  renderer.useEmitters([dust, vehicleExhaust as unknown as EmitterSpec], () => '#8E9491');
  const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  priv.vehicleMeshTemplates.set('mbt_lavi', buildVehicleMeshTemplate(gltf, 'mbt_lavi'));
  priv.vehicleMeshBounds.set('mbt_lavi', new THREE.Vector3(2, 0.8, 1.2));
  const skinned = await parseFixture({ roleName: 'uniform', clipName: ['idle'] });
  priv.meshUnitTemplates.set(MESH_INF.id, [buildMeshUnitTemplate(skinned, 'kdf')]);
  // A real instancer over the shipped sheet; only the texture is a stand-in.
  const sheet = parseManifest(infSquadManifest);
  const texture = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  priv.unitInstancers.set(SPRITE_INF.id, new UnitInstancer(sheet, texture, packSheet(sheet), sim.capacity));

  // `init()`'s seeding, then a first frame.
  renderer.reseed();
  renderer.frame(1, FRAME_MS);

  // `runTick`: tick, snapshot, then `runtime.step` spawns the reinforcement.
  sim.tick();
  renderer.snapshot();
  const newcomer = sim.spawn(tank, 0, fx.from(SPAWN_AT[0]), fx.from(SPAWN_AT[1]));
  const infantry = sim.spawn(meshInf, 0, fx.from(INFANTRY_AT[0]), fx.from(INFANTRY_AT[1]));
  const billboard = sim.spawn(spriteInf, 0, fx.from(BILLBOARD_AT[0]), fx.from(BILLBOARD_AT[1]));

  const particles: World['particles'] = [];
  const system = priv.particleSystem;
  if (system === null) throw new Error('useEmitters did not build a ParticleSystem');
  const dustLayers = new Set<unknown>(dust.particles);
  const inner = system.spawn.bind(system);
  system.spawn = (...args: unknown[]): void => {
    particles.push({ x: Number(args[1]), y: Number(args[2]), dust: dustLayers.has(args[0]) });
    inner(...args);
  };
  return { sim, renderer, priv, newcomer, infantry, billboard, particles };
}

/** The three 60 fps frames the app draws across one tick, alpha walking it,
 *  each returning where the newcomer's hull was drawn, or null if it was not. */
function drawTick(w: World): ([number, number] | null)[] {
  const drawn: ([number, number] | null)[] = [];
  for (const alpha of [1 / 3, 2 / 3, 1]) {
    w.renderer.frame(alpha, FRAME_MS);
    const root = w.priv.vehicleMeshEntities.get(w.newcomer)?.root.position;
    drawn.push(root ? [root.x, root.z] : null);
  }
  return drawn;
}

/**
 * Records the world anchor (x, y-on-map) of every overlay primitive drawn
 * from here on. Each `OverlayBatch` primitive takes its world anchor first,
 * as `[x, height, y]`; the HP bar, selection ring, air shadow and group
 * badge all go through these.
 */
function spyOverlayAnchors(batch: OverlayBatch): [number, number][] {
  const anchors: [number, number][] = [];
  const names = ['rect', 'rectStroke', 'line', 'triangle', 'ellipseFan', 'ellipseRing', 'ellipseAnnulusFill'] as const;
  for (const name of names) {
    const original = batch[name].bind(batch) as (...args: unknown[]) => void;
    (batch as unknown as Record<string, unknown>)[name] = (...args: unknown[]): void => {
      const a = args[0];
      if (Array.isArray(a) && a.length === 3) anchors.push([Number(a[0]), Number(a[2])]);
      original(...args);
    };
  }
  return anchors;
}

const nearOrigin = (p: [number, number] | null): boolean => p !== null && Math.hypot(p[0], p[1]) < 2;

describe('a unit spawned after this tick snapshot', () => {
  it('premise: the newcomers are inside the live entity count before the renderer has a copy of them', async () => {
    const w = await midMissionSpawn();
    expect([w.newcomer, w.infantry, w.billboard]).toEqual([1, 2, 3]);
    expect(w.sim.entityCount).toBe(4);
    for (const id of [w.newcomer, w.infantry, w.billboard]) {
      expect([w.priv.curX[id], w.priv.curY[id]]).toEqual([0, 0]);
    }
  });

  it('(i) the mesh vehicle is not drawn at world (0, 0) before the next snapshot', async () => {
    const w = await midMissionSpawn();
    const frames = drawTick(w);
    expect(frames.filter(nearOrigin), `drawn at the origin: ${JSON.stringify(frames)}`).toEqual([]);
    // Not drawn at all, rather than drawn somewhere guessed: this renderer
    // draws what it has snapshotted.
    expect(frames).toEqual([null, null, null]);
  });

  it('(i) the mesh infantry is not drawn before the next snapshot (updateMeshUnits)', async () => {
    const w = await midMissionSpawn();
    const drawn: boolean[] = [];
    for (const alpha of [1 / 3, 2 / 3, 1]) {
      w.renderer.frame(alpha, FRAME_MS);
      drawn.push(w.priv.meshUnitEntities.has(w.infantry));
    }
    expect(drawn).toEqual([false, false, false]);
  });

  it('(i) the billboard infantry gets no instance frame before the next snapshot (updateUnits)', async () => {
    const w = await midMissionSpawn();
    const perFrame: number[][][] = [];
    for (const alpha of [1 / 3, 2 / 3, 1]) {
      w.renderer.frame(alpha, FRAME_MS);
      perFrame.push((w.priv.framesByType.get(SPRITE_INF.id) ?? []).map((f) => [f.wx, f.wy]));
    }
    // The billboard newcomer is the only unit of its type, so any frame at
    // all for this type is a frame for it -- and it would sit at (0, 0).
    expect(perFrame, `billboard frames: ${JSON.stringify(perFrame)}`).toEqual([[], [], []]);
  });

  it('(i) no overlay (HP bar, ring, badge) is anchored at world (0, 0) before the next snapshot (updateOverlays)', async () => {
    const w = await midMissionSpawn();
    const anchors = spyOverlayAnchors(w.priv.overlayBatch);
    drawTick(w);
    const atOrigin = anchors.filter(([x, z]) => Math.hypot(x, z) < 2);
    expect(atOrigin, `overlay anchors near the origin: ${JSON.stringify(atOrigin)}`).toEqual([]);
    // Anti-vacuity: the resident tank's HP bar WAS drawn.
    expect(anchors.some(([x, z]) => Math.hypot(x - RESIDENT_AT[0], z - RESIDENT_AT[1]) < 2)).toBe(true);
  });

  it('(i) box-select over the origin does not return a newcomer (unitsInScreenRect)', async () => {
    const w = await midMissionSpawn();
    drawTick(w);
    w.renderer.camera.x = 0;
    w.renderer.camera.y = 0;
    const boxed = w.renderer.unitsInScreenRect(0, 0, w.renderer.width, w.renderer.height);
    expect(boxed.filter((id) => id === w.newcomer || id === w.infantry || id === w.billboard)).toEqual([]);
  });

  it('(i) cannot be picked at world (0, 0), and a selected newcomer draws no range envelope', async () => {
    const w = await midMissionSpawn();
    drawTick(w);
    expect(w.renderer.pickUnit(0.5, 0.5)).toBe(-1);
    // Select-all walks the live `sim.entityCount`, so the app CAN select it
    // in this window; its range envelope must not be drawn at the origin.
    w.renderer.selection = [w.newcomer];
    expect(w.priv.drawsEnvelope(w.newcomer)).toBe(false);
  });

  it('control: once snapshotted, every one of those paths draws the newcomers where they stand', async () => {
    // Without this, each (i) above could pass because its observer sees
    // nothing in this fixture at all.
    const w = await midMissionSpawn();
    drawTick(w);
    w.sim.tick();
    w.renderer.snapshot();
    const anchors = spyOverlayAnchors(w.priv.overlayBatch);
    w.renderer.frame(1, FRAME_MS);

    const near = (p: readonly number[], at: readonly number[]): boolean => Math.hypot(p[0] - at[0], p[1] - at[1]) < 0.05;
    const tank = w.priv.vehicleMeshEntities.get(w.newcomer)?.root.position;
    expect(tank && near([tank.x, tank.z], SPAWN_AT)).toBe(true);
    const squad = w.priv.meshUnitEntities.get(w.infantry)?.root.position;
    expect(squad && near([squad.x, squad.z], INFANTRY_AT)).toBe(true);
    const billboards = (w.priv.framesByType.get(SPRITE_INF.id) ?? []).map((f) => [f.wx, f.wy]);
    expect(billboards).toHaveLength(1);
    expect(near(billboards[0], BILLBOARD_AT)).toBe(true);
    for (const at of [SPAWN_AT, INFANTRY_AT, BILLBOARD_AT]) {
      expect(anchors.some((a) => Math.hypot(a[0] - at[0], a[1] - at[1]) < 2), `no overlay at ${at}`).toBe(true);
    }
    w.renderer.camera.x = BILLBOARD_AT[0];
    w.renderer.camera.y = BILLBOARD_AT[1];
    expect(w.renderer.unitsInScreenRect(0, 0, w.renderer.width, w.renderer.height)).toContain(w.billboard);
    expect(w.renderer.pickUnit(SPAWN_AT[0], SPAWN_AT[1])).toBe(w.newcomer);
  });

  it('(ii) after the next snapshot starts still, where it stands, with no speed read off a jump', async () => {
    const w = await midMissionSpawn();
    drawTick(w);
    w.sim.tick();
    w.renderer.snapshot();

    const id = w.newcomer;
    expect([w.priv.prevX[id], w.priv.prevY[id]]).toEqual([w.priv.curX[id], w.priv.curY[id]]);
    expect([w.priv.curX[id], w.priv.curY[id]]).toEqual(SPAWN_AT);
    expect(w.priv.entitySpeed[id]).toBe(0);
    // And every frame of that tick draws it at its spawn, never along a
    // line in from the origin.
    for (const p of drawTick(w)) {
      expect(p).not.toBeNull();
      expect(Math.hypot((p?.[0] ?? 0) - SPAWN_AT[0], (p?.[1] ?? 0) - SPAWN_AT[1])).toBeLessThan(0.05);
    }
  });

  /**
   * Dust needs 150 ms of motion (`VEHICLE_DUST_MIN_INTERVAL_MS`, the floor
   * of `vehicleDustIntervalMs`) and exhaust 500 ms of idling
   * (`VEHICLE_EXHAUST_INTERVAL_MS`). While the game runs, at ANY frame rate
   * and either speed, neither the zero-fill window nor the speed spike
   * after it lasts that long: `main.ts` runs a frame's due ticks before it
   * draws, a frame's elapsed time is capped at `FRAME_DT_CEILING_MS`
   * (100 ms), and a tick falls due every 50 ms of accumulated time -- so the
   * frames drawn between a newcomer's first snapshot and the next tick add
   * up to less than 150 ms. Only a pause holds the window open: game speed 0
   * (the HUD's pause chip) or the pause menu, during which `main.ts` keeps
   * calling `frame()` with real frame time at a frozen interpolation point.
   * That is what this test models, a second on each side of the newcomer's
   * first snapshot. Without the fix, the first pause emits exhaust from the
   * hull drawn at (0, 0), and the second emits dust from the hull frozen
   * partway along the line in from it.
   */
  it('throws no dust or exhaust from the origin, or from the line in from it, even held in a pause', async () => {
    const w = await midMissionSpawn();
    const pause = (): void => {
      for (let f = 0; f < 60; f++) w.renderer.frame(0.5, FRAME_MS);
    };
    pause();
    w.sim.tick();
    w.renderer.snapshot();
    pause();
    for (let t = 0; t < 3; t++) {
      w.sim.tick();
      w.renderer.snapshot();
      drawTick(w);
    }
    // A stationary vehicle idles: no dust at all, anywhere.
    expect(w.particles.filter((p) => p.dust)).toEqual([]);
    // And nothing it did emit (exhaust) sits away from the two vehicles --
    // i.e. at the origin or on the line in from it.
    const stray = w.particles.filter(
      (p) =>
        Math.hypot(p.x - SPAWN_AT[0], p.y - SPAWN_AT[1]) > 2 && Math.hypot(p.x - RESIDENT_AT[0], p.y - RESIDENT_AT[1]) > 2
    );
    expect(stray).toEqual([]);
    // Anti-vacuity: the newcomer DID idle long enough to emit, at its spawn.
    expect(w.particles.some((p) => Math.hypot(p.x - SPAWN_AT[0], p.y - SPAWN_AT[1]) <= 2)).toBe(true);
  });
});
