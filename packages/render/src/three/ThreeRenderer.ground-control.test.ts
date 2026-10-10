/**
 * Fix wave (ground plan 1, final review): two wirings of the ground into the
 * renderer that no pure test can see.
 *
 * I-1. `rebuildTerrain` builds the control map (and the road graph) only when
 * what they read has changed. A boot fires 3-5 `terrainDirty` rebuilds -- a
 * building template landing, a decor set loading, `setElevation` -- and none
 * of them changes the decor, the draw mask or the cover, yet each paid 48-80
 * ms for a byte-identical map. Pinned by spying on the REAL `buildControlMap`
 * through the module the renderer imports it from, so the assertion is about
 * the call the renderer makes, not a copy of its condition.
 *
 * I-3 (and the parked "renderer wiring of `decalGroundTone`"). A stamp writes
 * the TILE tone under the decal into `aGround` -- not the map's open tone,
 * and not the road mixed in at its centre -- and the decal material reads the
 * road from the ground material's OWN uniform objects, so a rebuilt control
 * map and the `roads` toggle reach it with no second write.
 *
 * Harness copied from `ThreeRenderer.blast.test.ts`: a faked `WebGLRenderer`,
 * a real `Sim`, and `frame()` driving the rebuild the way the app does.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { DecalStamp } from './decal-pool';
import type { GroundMaterial } from './terrain/mesh';
import { DECOR_ROAD, hexToLinear } from './terrain/shared';
import { tileBaseToneHex } from './terrain/ground';
import { buildControlMap } from './terrain/control-map';
import type { TerrainInput } from './terrain/types';
import type { DecalGroundSource } from './terrain/decal-ground-tone';

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

const builds = vi.hoisted(() => ({ control: 0, graph: 0 }));
vi.mock('./terrain/control-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/control-map')>();
  return {
    ...actual,
    buildControlMap: (...args: Parameters<typeof actual.buildControlMap>) => {
      builds.control++;
      return actual.buildControlMap(...args);
    },
  };
});
vi.mock('./terrain/road-graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/road-graph')>();
  return {
    ...actual,
    buildRoadGraph: (...args: Parameters<typeof actual.buildRoadGraph>) => {
      builds.graph++;
      return actual.buildRoadGraph(...args);
    },
  };
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

interface Private {
  terrainDirty: boolean;
  groundMat: GroundMaterial;
  decalMaterial: THREE.ShaderMaterial;
  decalsPersistent: { mesh: THREE.Mesh };
  decalGround: DecalGroundSource | null;
  stampGroundDecal(s: DecalStamp): boolean;
}

const MAP = 16;

function setUp(): { r: ThreeRenderer; priv: Private; sim: Sim } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  // A structure's pad at (5, 5): its tile tone (the open wash under
  // `underBuilding`) is not the open tone, which is what makes a stamp there
  // tell the two apart. A flat map has no terrace, so R-19 lets it stamp.
  const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  sim.addStructure(hut, [5 * MAP + 5]);
  const r = new ThreeRenderer(sim, makeOpts());
  const priv = r as unknown as Private;
  r.frame(1, 0);
  return { r, priv, sim };
}

/** A rebuild the way a boot's template or decor load asks for one. */
function rebuild(r: ThreeRenderer, priv: Private): void {
  priv.terrainDirty = true;
  r.frame(1, 0);
}

describe('the control map is rebuilt only when its inputs change (fix wave I-1)', () => {
  it('builds once for the first terrain, and not again for a rebuild that changes none of its inputs', () => {
    builds.control = 0;
    builds.graph = 0;
    const { r, priv } = setUp();
    expect(builds.control).toBe(1);
    // One graph inside `buildControlMap`, one for the decal tone's source.
    const graphs = builds.graph;
    expect(graphs).toBeGreaterThan(0);
    const bound = priv.groundMat.uniforms.uControlB.value;
    rebuild(r, priv);
    rebuild(r, priv);
    expect(builds.control).toBe(1);
    expect(builds.graph).toBe(graphs);
    // ...and the textures it built are still the ones bound.
    expect(priv.groundMat.uniforms.uControlB.value).toBe(bound);
    r.dispose();
  });
  // Scope exception (ground plan 2 review, Task 1 fix round 1): this map
  // HAS a road, unlike every other case in this file, which is exactly why
  // it belongs here rather than in decor-place.test.ts. `decorPlacements`
  // (ground plan 2, G8) now also calls `buildRoadGraph` when a map carries
  // any `r` tile, for its own clump/singleton road-clearance check -- a
  // fast path that skips the call entirely on a decor-FREE map (this file's
  // other cases, and most unit-test fixtures) would leave a real map's
  // redundant-rebuild cost unmeasured and could mask a regression on every
  // map that actually ships with roads.
  it('memoises the road graph on a redundant rebuild when the map HAS a road', () => {
    builds.graph = 0;
    const { r, priv } = setUp();
    const decor = new Uint8Array(MAP * MAP);
    decor[8 * MAP + 8] = DECOR_ROAD;
    r.setDecor(decor);
    r.frame(1, 0);
    const graphs = builds.graph;
    expect(graphs).toBeGreaterThan(0);
    rebuild(r, priv);
    rebuild(r, priv);
    expect(builds.graph).toBe(graphs);
    r.dispose();
  });
  it('updates the map when the cover changes IN PLACE -- the sim writes its own array when a structure dies', () => {
    builds.control = 0;
    const { r, priv, sim } = setUp();
    expect(builds.control).toBe(1);
    const boundA = priv.groundMat.uniforms.uControlA.value;
    const versionA = boundA.version;
    sim.cover[9 * MAP + 9] = 2; // the same array, new content
    rebuild(r, priv);
    // Seen, and answered by rewriting the texels around that one tile in the
    // texture already bound -- not by a second full build.
    expect(builds.control).toBe(1);
    expect(priv.groundMat.uniforms.uControlA.value).toBe(boundA);
    expect(boundA.version).toBeGreaterThan(versionA);
    const { texels, full } = r.debugTerrainRebuild();
    expect(full).toBe(false);
    expect(texels).toBeGreaterThan(0);
    expect(texels).toBeLessThan(MAP * MAP * 64);
    // And what it wrote is what a full build of the new world says.
    const fresh = buildControlMap(priv.decalGround?.input as TerrainInput);
    expect(Array.from(boundA.image.data as Uint8Array)).toEqual(Array.from(fresh.a));
    const versionAfter = boundA.version;
    rebuild(r, priv);
    expect(boundA.version).toBe(versionAfter);
    r.dispose();
  });
});

describe('a collapse re-makes only the terrain around its footprint', () => {
  it('splices the ground and rewrites the control map around a fallen structure, nowhere else', () => {
    builds.control = 0;
    const { r, sim } = setUp();
    expect(r.debugTerrainRebuild().full).toBe(true);
    sim.debugDestroyStructure(0);
    r.applyStructureDestroyed(0);
    r.frame(1, 0);
    const { tiles, texels, full } = r.debugTerrainRebuild();
    expect(full).toBe(false);
    // One tile reopened on a flat 16x16 map: its 5x5 splice square, and its
    // own 8x8 texels plus a 4-texel margin all round.
    expect(tiles).toBe(25);
    expect(texels).toBe(16 * 16);
    expect(builds.control).toBe(1);
    r.dispose();
  });

  it('disposes the decor batch it replaced only after the next frame has drawn', () => {
    // Disposing first released the batch's shader program while nothing else
    // held it, and the replacement paid a fresh compile on its first draw.
    const { r, priv, sim } = setUp();
    const p = priv as unknown as { decorGroup: THREE.Group | null; rebuildTerrain(): void };
    const material = new THREE.MeshStandardMaterial();
    let disposed = 0;
    material.addEventListener('dispose', () => disposed++);
    const old = p.decorGroup as THREE.Group;
    old.add(new THREE.BatchedMesh(1, 3, 3, material));
    sim.debugDestroyStructure(0);
    p.rebuildTerrain();
    expect(p.decorGroup).not.toBe(old);
    expect(disposed).toBe(0);
    r.frame(1, 0);
    expect(disposed).toBe(1);
    r.dispose();
  });
});

describe('a decal divides by its own tile tone and reads the road from the ground (fix wave I-3)', () => {
  it('writes the tile tone under the decal into aGround, not the open tone', () => {
    const { r, priv } = setUp();
    const stamp: DecalStamp = { kind: 'crater', x: 5.5, z: 5.5, halfLength: 0.5, halfWidth: 0.5, facingRad: 0, seed: 0, simMs: 0 };
    expect(priv.stampGroundDecal(stamp)).toBe(true);
    const g = priv.decalsPersistent.mesh.geometry.getAttribute('aGround');
    const input = priv.decalGround?.input;
    expect(input).toBeDefined();
    if (!input) return;
    const tone = (x: number, z: number): number[] => hexToLinear(tileBaseToneHex(input, TONES, z * MAP + x, '#14150F'));
    const pad = tone(5, 5);
    const open = tone(11, 11);
    expect(Math.abs(pad[0] - open[0]) + Math.abs(pad[1] - open[1])).toBeGreaterThan(0.05);
    for (let c = 0; c < 3; c++) expect(g.getComponent(0, c), `pad ${c}`).toBeCloseTo(pad[c], 6);
    // ...and an open tile gets the open tile's tone.
    expect(priv.stampGroundDecal({ ...stamp, x: 11.5, z: 11.5 })).toBe(true);
    for (let c = 0; c < 3; c++) expect(g.getComponent(16, c), `open ${c}`).toBeCloseTo(open[c], 6);
    r.dispose();
  });
  it("shares the ground material's road uniforms by reference", () => {
    const { r, priv } = setUp();
    for (const k of ['uControlB', 'uMapSize', 'uRoadTone', 'uShoulderTone', 'uRoadOn']) {
      expect(priv.decalMaterial.uniforms[k], k).toBe(priv.groundMat.uniforms[k]);
    }
    // So the roads toggle reaches the decals with the ground's one write.
    priv.groundMat.setRoadsVisible(false);
    expect(priv.decalMaterial.uniforms.uRoadOn.value).toBe(0);
    r.dispose();
  });
});
