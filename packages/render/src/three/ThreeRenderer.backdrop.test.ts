/**
 * The valley backdrop's wiring into the renderer (GH-161), and the promise
 * that matters most about it: a map with no `backdrop` block draws today's
 * frame, to the bit.
 *
 * Three things no pure test can see:
 *
 *  1. **Another map's frame cannot change.** Without a block the scene holds no
 *     backdrop object, the skirt is visible, the fog pass's off-map term is 0 (so
 *     its added `uOffMapSeen * ...` is an exact `+ 0.0`), the `backdrop` layer is
 *     a no-op, and `loadBackdropKit` touches nothing. The same is true of a map
 *     WITH a block whose kit has not loaded or failed to: that is the fallback.
 *  2. **A kit that fails to load names its file.** `console.error` carries the
 *     URL, the skirt stays, and the boot is not failed (the promise resolves).
 *  3. **With a kit, the swap is whole**: the backdrop in the scene, the skirt
 *     hidden, the fog's off-map term at the "explored" level; the layer switch
 *     puts today's frame back and forth; `dispose()` releases the geometry.
 *
 * Harness copied from `ThreeRenderer.ground-control.test.ts`: a faked
 * `WebGLRenderer`, a real `Sim`, `frame()` driving the rebuild.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { BackdropSpec, LoadedBackdropKit } from './terrain/backdrop';
import { BACKDROP_OFFMAP_SEEN } from './terrain/backdrop';
import { KIT_GLB, readKitFixture, repoPath } from './terrain/backdrop-kit-fixture';

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

const SPEC: BackdropSpec = {
  valley: 'ns',
  crest: 48,
  seed: 7,
  kit: 'wadi_halam_kit',
  pieces: [
    { id: 'bd_wall_far_a', at: [0, 8], rot: 0 },
    { id: 'bd_terrace_a', at: [-0.52, 8], rot: 0 },
    { id: 'bd_slope_near_a', at: [16, 8], rot: 180 },
  ],
};

function makeOpts(backdrop?: BackdropSpec): RendererOptions {
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
    ...(backdrop ? { backdrop } : {}),
  };
}

interface Private {
  scene: THREE.Scene;
  skirtMesh: THREE.Mesh;
  backdrop: { group: THREE.Group } | null;
  backdropKit: LoadedBackdropKit | null;
  backdropLevels: unknown;
  backdropDirty: boolean;
  terrainDirty: boolean;
  fogPass: { uniforms: { uOffMapSeen: { value: number } }; dispose(): void } | null;
}

const MAP = 16;

function make(backdrop?: BackdropSpec): { r: ThreeRenderer; p: Private } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const r = new ThreeRenderer(sim, makeOpts(backdrop));
  const p = r as unknown as Private;
  // The fog pass is built by `init()`, which needs a GL context this harness does not have; the one uniform the
  // backdrop writes is stood in for, at the value the real pass starts with.
  // Every other method (setHaze, setFocus, dispose...) is a no-op.
  const uniforms = { uOffMapSeen: { value: 0 } };
  p.fogPass = new Proxy({ uniforms } as unknown as NonNullable<Private['fogPass']>, {
    get: (t, k) => (k in t ? (t as unknown as Record<PropertyKey, unknown>)[k] : (): void => {}),
  });
  r.frame(1, 0);
  return { r, p };
}

/** Everything about the scene a frame's pixels depend on and a backdrop would touch. */
function frameFacts(p: Private): { names: string[]; skirtVisible: boolean; fog: number | undefined } {
  return {
    names: p.scene.children.map((c) => c.name).sort(),
    skirtVisible: p.skirtMesh.visible,
    fog: p.fogPass?.uniforms.uOffMapSeen.value,
  };
}

const kitSource = readKitFixture();
function loadedKit(): LoadedBackdropKit {
  const olive = new THREE.BufferGeometry();
  const o = kitSource.pieces.get('bd_olive');
  if (o === undefined) throw new Error('fixture has no olive');
  olive.setAttribute('position', new THREE.BufferAttribute(o.positions, 3));
  olive.setAttribute('normal', new THREE.BufferAttribute(o.normals, 3));
  olive.setAttribute('uv', new THREE.BufferAttribute(o.uvs, 2));
  olive.setIndex(new THREE.BufferAttribute(Uint32Array.from(o.index), 1));
  return { source: kitSource, map: new THREE.Texture(), olive };
}

describe('a map with no backdrop block draws today\'s frame', () => {
  it('has no backdrop, the skirt visible, and an off-map fog term of exactly 0', () => {
    const { r, p } = make();
    expect(p.backdrop).toBeNull();
    expect(r.backdropStats).toBeNull();
    expect(p.skirtMesh.visible).toBe(true);
    expect(p.scene.children.some((c) => c.name === 'backdrop')).toBe(false);
    expect(p.fogPass?.uniforms.uOffMapSeen.value).toBe(0);
    r.dispose();
  });

  it('ignores the backdrop layer and loadBackdropKit, and a rebuild changes nothing', async () => {
    const { r, p } = make();
    const before = frameFacts(p);
    expect(r.setDebugLayerVisible('backdrop', false)).toBe(0);
    expect(r.setDebugLayerVisible('backdrop', true)).toBe(0);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await r.loadBackdropKit('meshes/backdrop/wadi_halam_kit.glb'); // no block: a no-op, not even a fetch
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
    p.terrainDirty = true;
    r.frame(1, 0);
    expect(frameFacts(p)).toEqual(before);
    r.dispose();
  });
});

describe('a map WITH a block but no kit is also today\'s frame (the fallback)', () => {
  it('is identical to a map with no block until the kit lands', () => {
    const plain = make();
    const waiting = make(SPEC);
    expect(frameFacts(waiting.p)).toEqual(frameFacts(plain.p));
    expect(waiting.r.backdropStats).toBeNull();
    // Nothing to switch yet: neither direction of the layer may hide the skirt or raise the fog with no valley drawn.
    expect(waiting.r.setDebugLayerVisible('backdrop', false)).toBe(0);
    expect(waiting.r.setDebugLayerVisible('backdrop', true)).toBe(0);
    expect(frameFacts(waiting.p)).toEqual(frameFacts(plain.p));
    plain.r.dispose();
    waiting.r.dispose();
  });

  it('names the file when the kit fails to load, keeps the skirt, and does not reject', async () => {
    const { r, p } = make(SPEC);
    const before = frameFacts(p);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(r.loadBackdropKit('no-such-dir/wadi_halam_kit.glb')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('no-such-dir/wadi_halam_kit.glb');
    err.mockRestore();
    r.frame(1, 0);
    expect(p.backdrop).toBeNull();
    expect(frameFacts(p)).toEqual(before);
    r.dispose();
  });
});

describe('with a kit loaded', () => {
  function withKit(): { r: ThreeRenderer; p: Private; kit: LoadedBackdropKit } {
    const { r, p } = make(SPEC);
    const kit = loadedKit();
    p.backdropKit = kit; // what `loadBackdropKit` stores on success...
    p.backdropLevels = undefined;
    p.backdropDirty = true; // ...and the flag it raises
    r.frame(1, 0);
    return { r, p, kit };
  }

  it('puts the backdrop in the scene, hides the skirt and fades off-map ground to "explored"', () => {
    const { r, p } = withKit();
    expect(p.backdrop).not.toBeNull();
    expect(p.scene.children).toContain((p.backdrop as { group: THREE.Group }).group);
    expect(p.skirtMesh.visible).toBe(false);
    expect(p.fogPass?.uniforms.uOffMapSeen.value).toBe(BACKDROP_OFFMAP_SEEN);
    expect(r.backdropStats?.pieces).toBe(3);
    r.dispose();
  });

  it('the backdrop layer puts today\'s frame back, and the valley again', () => {
    const { r, p } = withKit();
    expect(r.setDebugLayerVisible('backdrop', false)).toBe(1);
    expect(p.skirtMesh.visible).toBe(true);
    expect(p.fogPass?.uniforms.uOffMapSeen.value).toBe(0);
    expect((p.backdrop as { group: THREE.Group }).group.visible).toBe(false);
    expect(r.setDebugLayerVisible('backdrop', true)).toBe(1);
    expect(p.skirtMesh.visible).toBe(false);
    expect(p.fogPass?.uniforms.uOffMapSeen.value).toBe(BACKDROP_OFFMAP_SEEN);
    r.dispose();
  });

  it('builds the backdrop on its own when the kit lands late: no terrain rebuild', () => {
    const { r, p } = make(SPEC);
    let rebuilds = 0;
    const real = (r as unknown as { rebuildTerrain(): void }).rebuildTerrain.bind(r);
    (r as unknown as { rebuildTerrain(): void }).rebuildTerrain = (): void => {
      rebuilds++;
      real();
    };
    p.backdropKit = loadedKit();
    p.backdropLevels = undefined;
    p.backdropDirty = true;
    r.frame(1, 0);
    expect(p.backdrop).not.toBeNull();
    expect(rebuilds).toBe(0);
    r.dispose();
  });

  it('keeps the skirt, and keeps building the terrain, when the placement list names a piece the kit lacks', () => {
    const { r, p } = make({ ...SPEC, pieces: [...SPEC.pieces, { id: 'bd_typo', at: [0, 0], rot: 0 }] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    p.backdropKit = loadedKit();
    p.backdropDirty = true;
    expect(() => r.frame(1, 0)).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('wadi_halam_kit');
    err.mockRestore();
    expect(p.backdrop).toBeNull();
    expect(p.skirtMesh.visible).toBe(true);
    // and the terrain still rebuilds afterwards
    p.terrainDirty = true;
    expect(() => r.frame(1, 0)).not.toThrow();
    expect(p.terrainDirty).toBe(false);
    r.dispose();
  });

  it('rebuilds when the rim changes (an edge pad collapsing into hillside), and only then', () => {
    const { r, p } = withKit();
    const sim = (r as unknown as { sim: Sim }).sim;
    const group = (p.backdrop as { group: THREE.Group }).group;
    p.terrainDirty = true;
    r.frame(1, 0);
    expect((p.backdrop as { group: THREE.Group }).group).toBe(group);
    // raise an edge tile's elevation the way a rim change reaches the renderer
    const levels = new Uint8Array(MAP * MAP);
    levels[3] = 3; // row 0, column 3: on the north edge
    r.setElevation(levels);
    r.frame(1, 0);
    expect((p.backdrop as { group: THREE.Group }).group).not.toBe(group);
    expect(sim.width).toBe(MAP);
    r.dispose();
  });

  it('frees a kit that lands after the renderer was disposed, and a live one is kept', async () => {
    const buf = readFileSync(repoPath(KIT_GLB));
    const parse = async (): Promise<THREE.Group> => {
      const loader = new GLTFLoader();
      loader.register(() => ({ name: 'rl_test_atlas', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return (await loader.parseAsync(ab, '')).scene;
    };
    for (const disposeFirst of [true, false]) {
      const scene = await parse();
      let atlas: THREE.Texture | null = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) atlas = (m.material as THREE.MeshStandardMaterial).map;
      });
      let freed = false;
      (atlas as unknown as THREE.Texture).addEventListener('dispose', () => (freed = true));
      const spy = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({ scene } as never);
      const { r, p } = make(SPEC);
      if (disposeFirst) r.dispose();
      await r.loadBackdropKit('meshes/backdrop/wadi_halam_kit.glb');
      spy.mockRestore();
      expect(freed, disposeFirst ? 'landed after dispose: freed' : 'landed on a live renderer: kept').toBe(disposeFirst);
      expect(p.backdropKit !== null).toBe(!disposeFirst);
      if (!disposeFirst) r.dispose();
    }
  });

  it('swaps the kit to its LOD1 twin with the camera zoom, every frame', () => {
    const { r, p } = withKit();
    const [, , full, low] = (p.backdrop as { group: THREE.Group }).group.children;
    (r as unknown as { camera: { zoom: number } }).camera.zoom = 0.35;
    r.frame(1, 0);
    expect([full.visible, low.visible]).toEqual([false, true]);
    (r as unknown as { camera: { zoom: number } }).camera.zoom = 1;
    r.frame(1, 0);
    expect([full.visible, low.visible]).toEqual([true, false]);
    r.dispose();
  });

  it('does not rebuild for a rebuild that leaves the rim alone (a collapse)', () => {
    const { r, p } = withKit();
    const group = (p.backdrop as { group: THREE.Group }).group;
    p.terrainDirty = true;
    r.frame(1, 0);
    expect((p.backdrop as { group: THREE.Group }).group).toBe(group);
    r.dispose();
  });

  it('releases the backdrop and the kit on dispose', () => {
    const { r, p, kit } = withKit();
    let atlas = false;
    kit.map.addEventListener('dispose', () => (atlas = true));
    const ground = ((p.backdrop as { group: THREE.Group }).group.children[0] as THREE.Mesh).geometry;
    let freed = false;
    ground.addEventListener('dispose', () => (freed = true));
    r.dispose();
    expect(freed).toBe(true);
    expect(atlas).toBe(true);
    expect(p.backdrop).toBeNull();
    expect(p.backdropKit).toBeNull();
  });
});
