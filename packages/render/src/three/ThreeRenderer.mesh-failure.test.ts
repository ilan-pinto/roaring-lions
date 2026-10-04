/**
 * WP-A3.3, the lead's ruling 2: a GLB that fails to load must never draw an
 * invisible unit silently. With the billboard path retired there is no sprite
 * to fall back to, so a failed type draws a palette-coloured proxy box at the
 * unit's footprint (`units/proxy-box.ts`) and the renderer says so with a
 * `console.error` naming the GLB.
 *
 * The fetch is stubbed to answer 404 -- the real failure shape: a file that
 * is not there. Harness (the fake `WebGLRenderer`) copied from
 * `ThreeRenderer.vehicle-mesh-death.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { ProxyBoxBatch } from './units/proxy-box';
import { buildRigidFixtureGlb } from './units/rigid-mesh-fixture';
import { ELLIPSE_BY_TYPE } from './units/readability';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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
    teamColors: ['#2F6FD9', '#D93A2B', '#8E9491'],
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

const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};
const RIFLES: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 2, sight_tiles: 9, signature: 0.6 },
};

interface Privates {
  proxyBoxes: ProxyBoxBatch | null;
  updateProxyBoxes(alpha: number): void;
}

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const lavi = sim.addUnitType(LAVI);
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.spawn(lavi, 0, fx.from(9.5), fx.from(11.5));
  const squad = sim.spawn(rifles, 0, fx.from(4.5), fx.from(4.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.snapshot();
  renderer.snapshot();
  return { sim, renderer, priv: renderer as unknown as Privates, tank, squad };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a unit whose GLB failed to load', () => {
  it('rejects, names the GLB in a console.error, and draws a proxy box where the unit stands', async () => {
    const fetch404 = vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetch404);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, priv } = setUp();

    await expect(renderer.loadVehicleMesh('mbt_lavi', 'http://localhost/meshes/vehicles/mbt_lavi.glb')).rejects.toBeDefined();
    // The 404 is what failed it, not something before the request.
    expect(fetch404).toHaveBeenCalledTimes(1);

    // Loud: one error, naming the type and the file.
    expect(error).toHaveBeenCalledTimes(1);
    const msg = String(error.mock.calls[0]?.[0]);
    expect(msg).toContain('mbt_lavi');
    expect(msg).toContain('/meshes/vehicles/mbt_lavi.glb');
    expect(renderer.failedMeshTypes().has('mbt_lavi')).toBe(true);

    // Not invisible: the tank draws as one box. The rifle squad, whose mesh
    // simply was never asked for, draws nothing -- not-loaded is not failed.
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count).toBe(1);
    const m = new THREE.Matrix4();
    priv.proxyBoxes?.mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    // On the hull's centre: the unit's tile, moved along its heading (facing
    // 0, +X) by the hull's own measured offset.
    expect(p.x).toBeCloseTo(9.5 + ELLIPSE_BY_TYPE.mbt_lavi.offsetAlong, 5);
    expect(p.z).toBeCloseTo(11.5, 5);
  });

  it('a rigged team fails the same way through loadMeshUnit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, priv } = setUp();

    await expect(renderer.loadMeshUnit('inf_squad', 'http://localhost/meshes/inf_squad.glb', 'kdf')).rejects.toBeDefined();
    expect(String(error.mock.calls[0]?.[0])).toContain('/meshes/inf_squad.glb');
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count).toBe(1);
  });

  it('a dead unit of a failed type draws no box', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sim, renderer, priv, tank } = setUp();
    await expect(renderer.loadVehicleMesh('mbt_lavi', 'http://localhost/x.glb')).rejects.toBeDefined();
    sim.debugKill(tank);
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count ?? 0).toBe(0);
  });

  it('with nothing failed there is no proxy batch at all', () => {
    const { priv } = setUp();
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count ?? 0).toBe(0);
  });
});

// WP-A3.3 Task 7: a vehicle GLB with no `wreck` clip used to fall back to its
// sheet's 2D wreck sprite. There is no sprite now, so it is refused at load,
// by name, and draws a proxy box like any other failed mesh.
describe('a vehicle GLB with no wreck clip', () => {
  const glbResponse = (clipNames: string[], deathRoot: boolean) => {
    const bytes = buildRigidFixtureGlb({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames,
      ...(deathRoot ? { deathRoot: { parts: ['hull_hull'] } } : {}),
    });
    // three's FileLoader reports progress with `new ProgressEvent(...)` while
    // it streams the body; Node has no ProgressEvent, and the throw inside
    // the stream pump is swallowed into a hang. A minimal stand-in.
    vi.stubGlobal(
      'ProgressEvent',
      class {
        constructor(
          readonly type: string,
          init: Record<string, unknown> = {}
        ) {
          Object.assign(this, init);
        }
      }
    );
    return vi.fn(async () => new Response(bytes, { status: 200 }));
  };

  it('is refused at load, naming the GLB and the missing clip, and drawn as a proxy box', async () => {
    vi.stubGlobal('fetch', glbResponse(['idle'], false));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, priv } = setUp();
    await expect(renderer.loadVehicleMesh('mbt_lavi', 'http://localhost/meshes/vehicles/mbt_lavi.glb')).rejects.toThrow(/wreck/);
    const msg = String(error.mock.calls[0]?.[0]);
    expect(msg).toContain('/meshes/vehicles/mbt_lavi.glb');
    expect(renderer.failedMeshTypes().has('mbt_lavi')).toBe(true);
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count).toBe(1);
  });

  it('loads cleanly when the wreck pass has run (idle + wreck + death root)', async () => {
    vi.stubGlobal('fetch', glbResponse(['idle', 'wreck'], true));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, priv } = setUp();
    await renderer.loadVehicleMesh('mbt_lavi', 'http://localhost/meshes/vehicles/mbt_lavi.glb');
    expect(error).not.toHaveBeenCalled();
    expect(renderer.failedMeshTypes().size).toBe(0);
    priv.updateProxyBoxes(1);
    expect(priv.proxyBoxes?.count ?? 0).toBe(0);
  });
});
