/**
 * `ThreeRenderer.reseed()` -- `Renderer.reseed` (`../api.ts`) on this backend.
 *
 * The order it exists for is the mission path's since shell Phase 3 (PR
 * #212): the map's structures are added, `init()` seeds the renderer from a
 * sim with NO units in it, the structure sheets load and size their
 * instancers, and only then does `runtime.start()` spawn the starting force
 * and raise the mission's own structures. This file replays that order on a
 * real `Sim` and a real `ThreeRenderer` and asserts what the first frame
 * after the reseed would read.
 *
 * Two stand-ins, both for things that need a GPU or a network:
 *  - `init()` itself cannot run here (post chain, fog pass and canvas all
 *    need a live WebGL context -- `ThreeRenderer.test.ts`'s top comment), so
 *    the test calls `seedFromSim()`, which is the whole of what `init()`
 *    derives from the sim and the one call it makes to do so.
 *  - `loadStructureSprite` fetches and decodes a sheet, so the test builds
 *    the instancer the way that method does after its fetch: a
 *    `StructureInstancer` sized by `structureTypeCapacity`, added to the
 *    scene, stored in `structureIdle`.
 *
 * Every test below but the premise was watched going red with
 * `renderer.reseed()` deleted from it, and each of `seedFromSim`'s steps has
 * a test that goes red without it (all recorded in the commit body).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { StructureInstancer, structureBillboardGeometry } from './units/structures';

// Identical stand-in to `ThreeRenderer.test.ts`'s own -- see that file's top
// comment for why `new THREE.WebGLRenderer(...)` cannot construct under this
// suite's headless `environment: 'node'`.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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

/** A tracked vehicle, so the reseed also walks `snapshot()`'s track-seed
 *  branch (`trackKindFor('mbt_lavi')`), and a real sight range for the fog. */
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 6, signature: 1 },
};

const W = 24;
const H = 24;
/** Where the starting force stands -- well away from world (0, 0), so an
 *  unseeded copy cannot pass for a seeded one. */
const SPAWN_X = 15.5;
const SPAWN_Y = 17.5;

/** The private surface this file reads -- no public seam exposes any of it,
 *  and widening `Renderer` for a test is what `api.ts`'s top comment argues
 *  against. `isVisible` is public and is used as such below. */
interface Private {
  seedFromSim(): void;
  structureTypeCapacity(structureId: string): number;
  structureIdle: Map<string, StructureInstancer>;
  structureWreck: Map<string, StructureInstancer>;
  updateStructures(): void;
  scene: THREE.Scene;
  prevX: Float64Array;
  prevY: Float64Array;
  curX: Float64Array;
  curY: Float64Array;
  entitySpeed: Float64Array;
  terrainDirty: boolean;
}

/**
 * The mission path, up to (not including) the reseed: returns the renderer,
 * the spawned unit and the two instancers the sheet load built (idle, and
 * wreck -- the shanty sheet declares a `wreckFile`, as `BLD_SHANTY` does).
 */
function missionPathBeforeReseed(): {
  sim: Sim;
  renderer: ThreeRenderer;
  priv: Private;
  unit: number;
  loaded: StructureInstancer;
  loadedWreck: StructureInstancer;
} {
  const sim = new Sim({ seed: 1, width: W, height: H, capacity: 8 });
  const tank = sim.addUnitType(TANK);
  const shanty = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  // `main.ts`: the MAP's structures are added before the renderer exists.
  sim.addStructure(shanty, [2 * W + 2]);

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Private;
  // `init()`, on a sim with no units in it yet.
  priv.seedFromSim();

  // `loadStructureSprite`, after its fetch: both instancers sized to the
  // shanties there are NOW.
  const capacity = priv.structureTypeCapacity('shanty');
  const loaded = new StructureInstancer(new THREE.Texture(), structureBillboardGeometry(1, 64, 64), capacity);
  priv.scene.add(loaded.mesh);
  priv.structureIdle.set('shanty', loaded);
  const loadedWreck = new StructureInstancer(new THREE.Texture(), structureBillboardGeometry(1, 64, 64), capacity);
  priv.scene.add(loadedWreck.mesh);
  priv.structureWreck.set('shanty', loadedWreck);

  // `runtime.start()`: the starting force spawns and the mission raises its
  // own building (`raiseMissionStructures` -- `wadi_halam_2_laager`'s shanty).
  const unit = sim.spawn(tank, 0, fx.from(SPAWN_X), fx.from(SPAWN_Y));
  sim.addStructure(shanty, [4 * W + 6]);

  return { sim, renderer, priv, unit, loaded, loadedWreck };
}

describe('ThreeRenderer.reseed after the mission spawns into a sim init() already seeded', () => {
  it('premise: without a reseed the first frame reads the empty sim init() saw', () => {
    const { sim, renderer, priv, unit } = missionPathBeforeReseed();
    // Interpolation at alpha 0 is `prev`: still the zero-fill.
    expect([priv.prevX[unit], priv.prevY[unit]]).toEqual([0, 0]);
    // Fog was computed from no units at all.
    expect(renderer.isVisible(SPAWN_X, SPAWN_Y)).toBe(false);
    // The sheet was sized before the mission's shanty existed, so the
    // overflow clamp drops it. (The clamp also warns, but only once per
    // module -- `warnedStructureOverflow` -- so whether THIS test sees the
    // warning depends on test order. Silenced here, never asserted.)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    priv.updateStructures();
    warn.mockRestore();
    const idle = priv.structureIdle.get('shanty');
    expect(idle?.mesh.count).toBe(1);
    expect(sim.structureCount).toBe(2);
  });

  it('draws the force where it spawned, still, with no lerp in from world (0, 0)', () => {
    const { renderer, priv, unit } = missionPathBeforeReseed();
    renderer.reseed();

    const alpha = 0;
    const x = priv.prevX[unit] + (priv.curX[unit] - priv.prevX[unit]) * alpha;
    const y = priv.prevY[unit] + (priv.curY[unit] - priv.prevY[unit]) * alpha;
    expect([x, y]).toEqual([SPAWN_X, SPAWN_Y]);
    // prev == cur: no alpha moves it, and no speed is read off a jump --
    // `entitySpeed` is what the dust cadence and the weight model's first
    // seed both read.
    expect([priv.curX[unit], priv.curY[unit]]).toEqual([SPAWN_X, SPAWN_Y]);
    expect(priv.entitySpeed[unit]).toBe(0);
  });

  it('computes the fog from the force now, not on the next 5 Hz refresh', () => {
    const { renderer } = missionPathBeforeReseed();
    renderer.reseed();
    expect(renderer.isVisible(SPAWN_X, SPAWN_Y)).toBe(true);
  });

  it('gives the structure instancer room for every structure the sim holds, and swaps it into the scene', () => {
    const { sim, priv, renderer, loaded } = missionPathBeforeReseed();
    renderer.reseed();
    priv.updateStructures();

    const idle = priv.structureIdle.get('shanty');
    if (!idle) throw new Error('the reseed dropped the shanty instancer');
    // Both shanties alive, one type: every structure the sim holds is drawn.
    expect(idle.mesh.count).toBe(sim.structureCount);
    expect(idle.capacity).toBe(sim.structureCount);
    // The replacement draws; the one it replaced is out of the scene, and
    // the decoded sheet moved across rather than being re-created.
    expect(idle).not.toBe(loaded);
    expect(priv.scene.children).toContain(idle.mesh);
    expect(priv.scene.children).not.toContain(loaded.mesh);
    expect(idle.spriteTexture).toBe(loaded.spriteTexture);
  });

  it('grows the WRECK instancer too, so a mission structure that falls leaves its wreck drawn', () => {
    const { sim, priv, renderer, loadedWreck } = missionPathBeforeReseed();
    renderer.reseed();

    const wreck = priv.structureWreck.get('shanty');
    if (!wreck) throw new Error('the reseed dropped the shanty wreck instancer');
    expect(wreck).not.toBe(loadedWreck);
    expect(wreck.capacity).toBe(sim.structureCount);
    expect(priv.scene.children).toContain(wreck.mesh);
    expect(priv.scene.children).not.toContain(loadedWreck.mesh);
    // Both shanties destroyed -- the map's and the mission's: both wrecks draw.
    for (let s = 0; s < sim.structureCount; s++) sim.structures.alive[s] = 0;
    priv.updateStructures();
    expect(wreck.mesh.count).toBe(sim.structureCount);
  });

  it('marks the terrain for a rebuild, so ground built before the spawn does not outlive it', () => {
    // `rebuildTerrain` reads the sim's structures (footprints, the blocked
    // mask). On the mission path the flag is still set from construction, so
    // stand in for a frame having already built the ground by clearing it.
    const { priv, renderer } = missionPathBeforeReseed();
    priv.terrainDirty = false;
    renderer.reseed();
    expect(priv.terrainDirty).toBe(true);
  });

  it('keeps a debug-hidden buildings layer hidden across the swap', () => {
    // `grow` builds a NEW mesh; a layer the visual gate switched off
    // must not come back on because the object behind it was replaced.
    const { priv, renderer, loaded } = missionPathBeforeReseed();
    renderer.setDebugLayerVisible('buildings', false);
    expect(loaded.mesh.visible).toBe(false);
    renderer.reseed();
    const idle = priv.structureIdle.get('shanty');
    expect(idle).not.toBe(loaded);
    expect(idle?.mesh.visible).toBe(false);
  });

  it('leaves an instancer that already has room exactly as it was', () => {
    const { priv, renderer, loaded } = missionPathBeforeReseed();
    renderer.reseed();
    const grown = priv.structureIdle.get('shanty');
    // A second reseed with nothing new in the sim: same object, same mesh.
    renderer.reseed();
    expect(priv.structureIdle.get('shanty')).toBe(grown);
    expect(grown).not.toBe(loaded);
    expect(priv.scene.children.filter((c) => c === grown?.mesh)).toHaveLength(1);
  });
});
