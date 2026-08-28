/**
 * Wiring test for `mesh-death.ts` INTO `ThreeRenderer`'s prune loop
 * (`updateMeshUnits`) and `dispose()` -- `mesh-death.test.ts` already proves
 * every function in that module correct in isolation; this file proves
 * `ThreeRenderer` actually calls them at the right moment, on a REAL (if
 * WebGLRenderer-stubbed) `ThreeRenderer` instance, the same technique
 * `ThreeRenderer.test.ts` established for its own `dispose()` guard (that
 * file's own top comment explains why the stub is needed and what it does
 * NOT prove -- read it before extending this one).
 *
 * `.init()` is never called here, matching `ThreeRenderer.test.ts`: it
 * touches `document`/`ResizeObserver`, unavailable under this suite's
 * `environment: 'node'`. `snapshot()` alone (called directly, exactly what
 * `init()` itself does twice at the top of its own body) is enough to seed
 * `prevX`/`curX` from `Sim`'s own spawn position, which is all
 * `updateMeshUnits` needs.
 *
 * A `MeshUnitTemplate` is built from `./units/mesh-fixture.ts`'s hand-
 * authored GLB and installed directly into the private `meshUnitTemplates`
 * map -- bypassing `loadMeshUnit`'s real `GLTFLoader().loadAsync(glbUrl)`
 * network fetch, which has nothing to fetch from under `environment:
 * 'node'`. `sim.state.alive[id] = 0` stands in for a real kill: this is a
 * RENDERER test, which does not care HOW an entity died, only THAT it did
 * -- unlike a combat-maths test, there is no RNG stream here for a bypassed
 * kill to corrupt (CLAUDE.md's "isolating a unit... corrupts every later
 * unit's RNG stream" caution is about `Sim`'s own combat resolution, not
 * about anything this file touches).
 *
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in
 * `ThreeRenderer.ts` by hand and confirming the SPECIFIC test named goes
 * red, then reverting.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildMeshUnitTemplate } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';
import type { DyingMeshUnit, MeshWreck } from './units/mesh-death';
import type { MeshUnitTemplate, MeshUnitEntity } from './units/mesh-unit';

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
  crownRatio: 0.52, scatter: 'stone',
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
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

const INF: UnitTypeJson = {
  id: 'mesh_test_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

/** Reaches every private field/method this file needs -- there is no public
 *  accessor for any of them, and adding one purely for a test would widen
 *  `Renderer`'s surface for no runtime reason, the identical reasoning
 *  `ThreeRenderer.test.ts` already gives for its own `fogMesh` reach. */
interface ThreeRendererPrivates {
  scene: THREE.Scene;
  meshUnitTemplates: Map<string, MeshUnitTemplate>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  meshDying: DyingMeshUnit[];
  meshWrecks: MeshWreck[];
  updateMeshUnits(alpha: number, dtMs: number): void;
}

async function setUp(clips: string | string[]) {
  const sim = new Sim({ seed: 1, width: 10, height: 10, capacity: 4 });
  const typeIdx = sim.addUnitType(INF);
  const id = sim.spawn(typeIdx, 0, fx.from(4.5), fx.from(6.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseFixture({ roleName: 'uniform', clipName: clips });
  const template = buildMeshUnitTemplate(gltf, 'kdf');
  priv.meshUnitTemplates.set(INF.id, template);

  renderer.snapshot();
  renderer.snapshot();

  return { sim, renderer, priv, id };
}

describe('ThreeRenderer mesh-death wiring', () => {
  it('instantiates a MeshUnitEntity for a living entity of a mesh-enabled type', async () => {
    const { priv, id } = await setUp('idle');
    priv.updateMeshUnits(1, 16);
    expect(priv.meshUnitEntities.has(id)).toBe(true);
    expect(priv.scene.children).toContain(priv.meshUnitEntities.get(id)!.root);
  });

  it('hands a newly-dead entity to meshDying instead of disposing it on the spot', async () => {
    const { sim, priv, id } = await setUp('idle');
    priv.updateMeshUnits(1, 16); // entity instantiated while alive
    const root = priv.meshUnitEntities.get(id)!.root;

    sim.state.alive[id] = 0;
    priv.updateMeshUnits(1, 16);

    // Break check (verified by hand, then reverted): in `updateMeshUnits`'s
    // prune loop, put back the OLD immediate `disposeMeshUnitEntity` +
    // `scene.remove` instead of `beginMeshDeath`/`meshDying.push`. This
    // assertion then reads `false` (nothing in `meshUnitEntities` OR
    // `meshDying`) and goes red.
    expect(priv.meshUnitEntities.has(id)).toBe(false);
    expect(priv.meshDying).toHaveLength(1);
    // Not torn down -- still fading, still in the scene.
    expect(priv.scene.children).toContain(root);
  });

  it('advances an already-dying entity every frame via stepMeshDeaths -- fully round-trips to a persisted MeshWreck', async () => {
    const { sim, priv, id } = await setUp(['idle', 'down', 'wreck']);
    priv.updateMeshUnits(1, 16);
    const root = priv.meshUnitEntities.get(id)!.root;

    sim.state.alive[id] = 0;
    priv.updateMeshUnits(1, 16); // death starts, t=0

    // Advance past the whole fade window AND the wreck one-shot's own
    // settle phase, across many frames -- proves `meshDying` entries are
    // actually STEPPED (not merely queued) by repeated `updateMeshUnits`
    // calls, the shape the real 60 Hz `frame()` loop drives it with.
    // `frameDtSeconds` caps each call at 100ms of sim time regardless of
    // the `dtMs` passed in, so 20 iterations is ~2s of real settle time --
    // comfortably past `MESH_DEATH_SECONDS` (0.4s) plus this fixture's own
    // 1-second `wreck` clip duration, with margin.
    for (let i = 0; i < 20; i++) priv.updateMeshUnits(1, 200);

    expect(priv.meshDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(1);
    expect(priv.meshWrecks[0].root).toBe(root);
    expect(priv.scene.children).toContain(root);
  });

  it('removes a dying entity with no wreck clip once the fade window closes, leaving nothing behind', async () => {
    const { sim, priv, id } = await setUp('idle'); // no down, no wreck
    priv.updateMeshUnits(1, 16);
    const root = priv.meshUnitEntities.get(id)!.root;

    sim.state.alive[id] = 0;
    priv.updateMeshUnits(1, 16);
    for (let i = 0; i < 5; i++) priv.updateMeshUnits(1, 200);

    expect(priv.meshDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(0);
    expect(priv.scene.children).not.toContain(root);
  });

  it('dispose() tears down every dying entity and every persisted wreck', async () => {
    const { sim, renderer, priv, id } = await setUp(['idle', 'down', 'wreck']);
    priv.updateMeshUnits(1, 16);
    sim.state.alive[id] = 0;
    priv.updateMeshUnits(1, 16); // now mid-fade, in meshDying

    // Break check (verified by hand, then reverted): comment out the
    // `meshDying`/`meshWrecks` teardown block this task added to
    // `dispose()`. This assertion then reads `1` (still queued) instead of
    // `0` and goes red.
    renderer.dispose();
    expect(priv.meshDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(0);
  });
});
