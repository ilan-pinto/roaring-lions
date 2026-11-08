/**
 * GH-943 P2 (T1): the material seam. `adoptNodeMaterials` swaps a legacy material for its node twin (`RenderBackend.materials`) on a
 * node boot, before the first census, and again at every rebuild that makes a ground, chunk or decor mesh; a legacy boot never
 * reaches the kit. The production kit is all `null` in T1, so these specs hand the renderer a STUB kit, through a mocked
 * `./backend/node-backend` (node arm) or the renderer's own `nodeMaterialKit` field (legacy arm); production defaults are untouched.
 *
 * Each spec has a one-line falsification, run by hand and listed in the commit message:
 *  - legacy never touches the kit: delete `adoptNodeMaterials`' `if (this.nodeBackend === null) return 0;`;
 *  - the first census sees twins only: move `init`'s `this.adoptNodeMaterials(this.scene)` after `prepare()`;
 *  - adoption survives a rebuild: adopt the ground in `rebuildTerrain` only on a FULL build (skip the splice path).
 *
 * Harness: `ThreeRenderer.chunks.test.ts`'s faked `WebGLRenderer` and real `Sim`, plus a stubbed legacy post chain (so a legacy
 * `init` runs headless) and a fake node backend whose census is the real `censusUnported`, run at `prepare` and every `render`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { censusUnported, type UnportedHook } from './backend/unported';
import { ThreeRenderer } from './ThreeRenderer';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    shadowMap = { enabled: false, type: actual.PCFShadowMap };
    info = { reset(): void {}, render: { calls: 0, triangles: 0 }, autoReset: true };
    setClearColor(): void {}
    setPixelRatio(): void {}
    getPixelRatio(): number {
      return 1;
    }
    setSize(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

// The legacy chain needs a live GL context; this suite is about materials, so a legacy init gets a stand-in with the members
// `init` and `frame` touch.
vi.mock('./post-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post-chain')>();
  return {
    ...actual,
    createPostChain: () => ({
      setFogPass(): void {},
      setAoPass(): void {},
      setBloomPass(): void {},
      setSize(): void {},
      render(): void {},
      dispose(): void {},
      vignette: { enabled: false },
      grade: { apply(): void {}, enabled: false },
    }),
  };
});

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null, created: 0 }));

vi.mock('./backend/node-backend', async () => {
  const { censusUnported: census } = await vi.importActual<typeof import('./backend/unported')>('./backend/unported');
  return {
    createNodeBackend: async (): Promise<{ backend: RenderBackend }> => {
      seam.created++;
      const kit = seam.kit;
      if (kit === null) throw new Error('spec: no stub kit');
      const hooks = new Map<string, UnportedHook>();
      const run = (scene: THREE.Object3D): void => {
        for (const h of census(scene)) hooks.set(`${h.kind}|${h.key}`, h);
      };
      const backend = {
        kind: 'node-webgl2',
        adapter: 'webgl2',
        domElement: {} as HTMLCanvasElement,
        setPixelRatio(): void {},
        getPixelRatio: () => 1,
        setSize(): void {},
        kit: { fog: null, ao: null, bloom: null },
        materials: kit,
        setFog(): void {},
        setOutputMaths(): void {},
        bloom: { setEnabled: () => false, setFade(): void {}, strength: 0, built: false, readPreBloom: async () => null },
        pmrem: {},
        ao: null,
        configure(): void {},
        post: null,
        async prepare(scene: THREE.Scene): Promise<void> {
          run(scene);
        },
        render(scene: THREE.Scene): void {
          run(scene);
        },
        photographGround: async () => null,
        captureView: async () => null,
        whenSubmitted: async () => {},
        unported: () => [...hooks.values()],
        stats: () => ({ calls: 0, triangles: 0 }),
        dispose(): void {},
      };
      return { backend: backend as unknown as RenderBackend };
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

function makeOpts(gpu: RendererOptions['gpu']): RendererOptions {
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
    quality: QUALITY_PRESETS.low,
    environmentLight: false,
    ...(gpu !== undefined ? { gpu } : {}),
  };
}

interface Private {
  scene: THREE.Scene;
  groundMat: THREE.Material & { uniforms: Record<string, { value: unknown }> };
  nodeMaterialKit: MaterialKit | null;
  terrainMesh: THREE.Object3D | null;
  decorGroup: THREE.Group | null;
  selectionRing: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  teamRing: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  woundRing: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  decorSet: { parts: Map<string, { role: string; geometry: THREE.BufferGeometry }[]> };
}

interface StubKit extends MaterialKit {
  readonly calls: { ground: number; foliage: number; ring: number };
}

/** A stub kit: each factory returns a fresh stock material named after its slot, and counts its calls. */
function stubKit(): StubKit {
  const calls = { ground: 0, foliage: 0, ring: 0 };
  const make = (slot: keyof typeof calls) => (): THREE.Material => {
    calls[slot]++;
    return new THREE.MeshBasicMaterial({ name: `stub-twin-${slot}` });
  };
  return { ground: make('ground'), foliage: make('foliage'), ring: make('ring'), calls };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

/** The legacy keys a twin replaces, as the census names them. */
const ADOPTED_KEYS = /^(rl-ground|rl-foliage-sway|rl-trunk-sway|rl-selection-ring)/;
const adoptedHooks = (hooks: readonly UnportedHook[]): string[] => hooks.filter((h) => ADOPTED_KEYS.test(h.key)).map((h) => `${h.kind}:${h.key}`);

const meshes = (root: THREE.Object3D | null): THREE.Mesh[] =>
  root === null ? [] : (root as THREE.Mesh).isMesh ? [root as THREE.Mesh] : root.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

/** A size x size map with a one-tile hut at (20, 20), scattered cover, and a stand-in decor set with foliage and trunks. */
function build(size: number, gpu: RendererOptions['gpu']): { r: ThreeRenderer; priv: Private; sim: Sim } {
  const sim = new Sim({ seed: 1, width: size, height: size, capacity: 4 });
  const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  sim.addStructure(hut, [20 * size + 20]);
  for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 3) if (x !== 20 || y !== 20) sim.cover[y * size + x] = 1;
  const r = new ThreeRenderer(sim, makeOpts(gpu));
  const priv = r as unknown as Private;
  const tri = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'bush', 'tree', 'desert_tree']) {
    for (let v = 0; v < 3; v++) {
      priv.decorSet.parts.set(`${family}_${v}`, [
        { role: 'foliage', geometry: tri() },
        { role: 'trunk', geometry: tri() },
      ]);
    }
  }
  return { r, priv, sim };
}

const rings = (priv: Private): Array<{ mesh: THREE.Mesh; material: THREE.ShaderMaterial }> => [priv.selectionRing, priv.teamRing, priv.woundRing];

beforeEach(() => {
  seam.kit = null;
  seam.created = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a legacy boot never touches the kit', () => {
  it('init, the first build, a collapse splice: no factory is called, every material stays legacy', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { r, priv, sim } = build(80, undefined);
    // The stub kit handed to a LEGACY renderer: only adoptNodeMaterials' node-only guard keeps it out.
    priv.nodeMaterialKit = kit;
    await r.init(HOST);
    r.frame(1, 0);
    sim.debugDestroyStructure(0);
    r.applyStructureDestroyed(0);
    r.frame(1, 0);
    expect(r.debugTerrainRebuild().full).toBe(false);
    expect(seam.created).toBe(0);
    expect(kit.calls).toEqual({ ground: 0, foliage: 0, ring: 0 });
    const ground = meshes(priv.terrainMesh);
    expect(ground.length).toBe(9);
    for (const m of ground) expect(m.material).toBe(priv.groundMat);
    for (const ring of rings(priv)) expect(ring.mesh.material).toBe(ring.material);
    r.dispose();
  });
});

describe('a node boot adopts before the first census', () => {
  it('right after init: the rings are twins, none is hidden, and the census names no adopted legacy key', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { r, priv } = build(48, 'webgl2');
    // Rings start hidden (nothing selected); shown here so a census that hid them would be seen doing it.
    for (const ring of rings(priv)) ring.mesh.visible = true;
    await r.init(HOST);
    expect(seam.created).toBe(1);
    expect(r.backendInfo().kind).toBe('node-webgl2');
    expect(adoptedHooks(r.unportedHooks())).toEqual([]);
    for (const ring of rings(priv)) {
      expect(ring.mesh.material).not.toBe(ring.material);
      expect((ring.mesh.material as THREE.Material).name).toBe('stub-twin-ring');
      expect(ring.mesh.visible).toBe(true);
    }
    // One twin per legacy object: three batches, three ring materials.
    expect(kit.calls.ring).toBe(3);
    r.dispose();
  });

  it('the first frame builds the ground and decor and adopts them before its census: one ground twin for every chunk', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { r, priv } = build(80, 'webgl2');
    await r.init(HOST);
    r.frame(1, 0);
    expect(adoptedHooks(r.unportedHooks())).toEqual([]);
    const ground = meshes(priv.terrainMesh);
    expect(ground.length).toBe(9);
    const twin = ground[0]?.material as THREE.Material;
    expect(twin.name).toBe('stub-twin-ground');
    for (const m of ground) expect(m.material).toBe(twin);
    expect(kit.calls.ground).toBe(1);
    const decor = (priv.decorGroup as THREE.Group).children as THREE.Mesh[];
    expect(decor.map((b) => b.name).sort()).toEqual(['decor-foliage', 'decor-trunk']);
    for (const b of decor) expect((b.material as THREE.Material).name).toBe('stub-twin-foliage');
    // The legacy material keeps owning its uniforms: the debug setters still write the legacy object.
    const legacy = priv.groundMat;
    legacy.uniforms.uRoadOn.value = 1;
    expect(r.setDebugLayerVisible('roads', false)).toBe(1);
    expect(legacy.uniforms.uRoadOn.value).toBe(0);
    // Already hidden: the setter reports no change and the value stays 0.
    expect(r.setDebugLayerVisible('roads', false)).toBe(0);
    expect(legacy.uniforms.uRoadOn.value).toBe(0);
    r.dispose();
  });
});

describe('adoption survives a rebuild', () => {
  it('a collapse splice on a chunked map re-slices chunks and rebuilds the decor, and the census still reads no adopted legacy key', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { r, priv, sim } = build(80, 'webgl2');
    await r.init(HOST);
    r.frame(1, 0);
    const before = new Set(meshes(priv.terrainMesh));
    sim.debugDestroyStructure(0);
    r.applyStructureDestroyed(0);
    r.frame(1, 0);
    expect(r.debugTerrainRebuild().full).toBe(false);
    const after = meshes(priv.terrainMesh);
    // The splice really made new chunk meshes (from the legacy material)...
    expect(after.filter((m) => !before.has(m)).length).toBeGreaterThan(0);
    // ...and every one of them draws the twin, which is still the one twin.
    for (const m of after) expect((m.material as THREE.Material).name).toBe('stub-twin-ground');
    expect(kit.calls.ground).toBe(1);
    expect(adoptedHooks(r.unportedHooks())).toEqual([]);
    expect(adoptedHooks(censusUnported(priv.scene))).toEqual([]);
    for (const b of (priv.decorGroup as THREE.Group).children as THREE.Mesh[]) expect((b.material as THREE.Material).name).toBe('stub-twin-foliage');
    r.dispose();
  });
});
