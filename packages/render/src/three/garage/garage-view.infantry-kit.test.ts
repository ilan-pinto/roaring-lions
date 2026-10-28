/**
 * The garage turntable wears a team's bought kit (GH-826), through the REAL
 * `mountGarageView` on the SHIPPED `art/meshes/inf_squad.glb`.
 *
 * As in `garage-view.kit.test.ts` the two things a node test cannot have are
 * stood in: `THREE.WebGLRenderer` (no GPU), which records what it was asked
 * to draw, and the GLB loader, which counts its calls. The GLB itself is
 * parsed from the real bytes, so the packed `kit_uniform` / `kit_weapon`
 * nodes, the `_rl_kit` attribute and the team's skin are the ones a mission
 * loads.
 *
 * Triangle counts are LITERALS measured from the shipped file on 28 Oct 2026
 * (the same numbers `units/infantry-kit-shipped.test.ts` pins for the mission
 * path): the oracle never recomputes them from the part table it checks.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { parseGlbHeadless } from '../units/headless-gltf';

const loader = vi.hoisted(() => ({
  calls: 0,
  make: null as null | (() => Promise<unknown>),
  /** Called inside every `render`, so a test can read what was drawn. */
  onRender: null as null | (() => void),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    static last: FakeWebGLRenderer | null = null;
    outputColorSpace = actual.SRGBColorSpace;
    toneMapping = actual.NoToneMapping;
    toneMappingExposure = 1;
    shadowMap = { enabled: false, type: actual.PCFShadowMap };
    info = { render: { calls: 0, triangles: 0 } };
    domElement = {
      style: {} as Record<string, string>,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      remove: (): void => {},
    };
    renders: { scene: import('three').Scene; camera: import('three').Vector3 }[] = [];
    constructor() {
      FakeWebGLRenderer.last = this;
    }
    setPixelRatio(): void {}
    setClearAlpha(): void {}
    setSize(): void {}
    render(scene: import('three').Scene, camera: import('three').Camera): void {
      this.renders.push({ scene, camera: camera.position.clone() });
      loader.onRender?.();
    }
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('../units/gltf-loader', () => ({
  setDracoDecoderPath: (): void => {},
  gltfLoader: () => ({
    loadAsync: (): Promise<unknown> => {
      loader.calls += 1;
      return loader.make?.() ?? Promise.resolve(undefined);
    },
  }),
}));

const { mountGarageView } = await import('./garage-view');

interface FakeRendererStatic {
  last: { renders: { scene: THREE.Scene; camera: THREE.Vector3 }[] } | null;
}
const FakeRenderer = THREE.WebGLRenderer as unknown as FakeRendererStatic;

const SQUAD = readFileSync(new URL('../../../../../art/meshes/inf_squad.glb', import.meta.url));
// A shipped team that declares no kit: the garage must show it as it always did.
const GRENADIER = readFileSync(new URL('../../../../../art/meshes/inf_grenadier.glb', import.meta.url));

/** The shipped figure before the kit: boot, face, uniform, weapon. */
const BASE = { boot: 546, face: 81, uniform: 7032, weapon: 945 };
const FULL = { armour: 3, sensors: 3, firepower: 3 };

const COLORS = { key: '#ffffff', fill: '#ffffff', sky: '#ffffff', bounce: '#ffffff', ground: '#c8b494' };
const host = { clientWidth: 600, clientHeight: 400, appendChild: (): void => {} } as unknown as HTMLElement;

let parsed: THREE.Object3D[] = [];

async function mount(bytes: Buffer, typeId: string, kitTiers?: Readonly<Record<string, number>>) {
  loader.make = async () => {
    const gltf = await parseGlbHeadless(bytes);
    parsed.push(gltf.scene);
    return gltf;
  };
  const view = await mountGarageView(host, {
    typeId,
    kind: 'rigged',
    meshUrl: `/meshes/${typeId}.glb`,
    dracoDecoderPath: '/draco/',
    colors: COLORS,
    ...(kitTiers ? { kitTiers } : {}),
  });
  const renderer = FakeRenderer.last;
  if (!renderer) throw new Error('no renderer was made');
  const lastScene = (): THREE.Scene => renderer.renders[renderer.renders.length - 1].scene;
  /** Triangles per role mesh, as the LAST frame drew them. */
  const drawn = (): Record<string, number> => {
    const out: Record<string, number> = {};
    lastScene().traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.index) out[m.name] = m.geometry.index.count / 3;
    });
    delete out[''];
    return out;
  };
  const meshes = (): THREE.SkinnedMesh[] => {
    const out: THREE.SkinnedMesh[] = [];
    lastScene().traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
    });
    return out;
  };
  const lastCamera = (): THREE.Vector3 => renderer.renders[renderer.renders.length - 1].camera;
  return { view, renderer, lastScene, drawn, meshes, lastCamera };
}

let disposedGeometries: THREE.BufferGeometry[] = [];
let disposedMaterials: THREE.Material[] = [];
let disposedSkeletons: THREE.Skeleton[] = [];

beforeEach(() => {
  loader.calls = 0;
  loader.onRender = null;
  parsed = [];
  disposedGeometries = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose').mock.contexts as THREE.BufferGeometry[];
  disposedMaterials = vi.spyOn(THREE.Material.prototype, 'dispose').mock.contexts as THREE.Material[];
  disposedSkeletons = vi.spyOn(THREE.Skeleton.prototype, 'dispose').mock.contexts as THREE.Skeleton[];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountGarageView: the bought kit on a team on the turntable (GH-826)', () => {
  it('draws the shipped figure with no tiers, and the bought parts with tiers', async () => {
    const bare = await mount(SQUAD, 'inf_squad');
    expect(bare.drawn()).toEqual(BASE);
    bare.view.dispose();

    const full = await mount(SQUAD, 'inf_squad', FULL);
    expect(full.drawn()).toEqual({ ...BASE, uniform: 8882, weapon: 2513 });
    full.view.dispose();

    // Mounted with a track at tier 0 is the plain figure too.
    const zero = await mount(SQUAD, 'inf_squad', { armour: 0, sensors: 0, firepower: 0 });
    expect(zero.drawn()).toEqual(BASE);
    zero.view.dispose();
  });

  it('re-merges on setKit, up, sideways and down, from the one load, one frame each', async () => {
    const m = await mount(SQUAD, 'inf_squad', {});
    expect(loader.calls).toBe(1);
    const frames = m.view.stats().frames;

    m.view.setKit(FULL);
    expect(m.drawn()).toEqual({ ...BASE, uniform: 8882, weapon: 2513 });
    expect(m.view.stats().frames).toBe(frames + 1);
    m.view.setKit({ armour: 1 });
    expect(m.drawn()).toEqual({ ...BASE, uniform: 7602 });
    m.view.setKit({ sensors: 1 });
    expect(m.drawn()).toEqual({ ...BASE, weapon: 1317 });
    m.view.setKit({});
    expect(m.drawn()).toEqual(BASE);
    expect(m.view.stats().frames).toBe(frames + 4);
    expect(loader.calls).toBe(1);

    // The pristine source keeps its packed nodes: nothing built from it.
    const names: string[] = [];
    parsed[0].traverse((o) => names.push(o.name));
    expect(names).toContain('kit_uniform');
    expect(names).toContain('kit_weapon');
    m.view.dispose();
  });

  it('does nothing for tiers that draw the parts already shown', async () => {
    const m = await mount(SQUAD, 'inf_squad', { armour: 3 });
    const frames = m.view.stats().frames;
    const before = m.meshes();
    // Tier 3 is this GLB's ceiling on every track, so 9 is the same figure.
    m.view.setKit({ armour: 9, bogus: 2 });
    expect(m.view.stats().frames).toBe(frames);
    expect(m.meshes().every((x, i) => x === before[i])).toBe(true);
    m.view.dispose();
  });

  it('frames tiers 0 and 3 alike and keeps the squad where it stands through a purchase', async () => {
    const bare = await mount(SQUAD, 'inf_squad', {});
    const camera = bare.lastCamera().toArray();
    const info = bare.view.info;
    /** Where each figure stands (its root bone in the world) and where each
     *  mesh sits: the line of three riflemen is moved by bones, not meshes. */
    const stand = (m: Awaited<ReturnType<typeof mount>>): number[][] => {
      const out: number[][] = [];
      m.lastScene().traverse((o) => {
        if ((o as THREE.Bone).isBone && info.figureRoots.includes(o.name)) {
          o.updateWorldMatrix(true, false);
          out.push([...o.getWorldPosition(new THREE.Vector3()).toArray(), o.name.length]);
        }
      });
      for (const mesh of m.meshes()) {
        mesh.updateWorldMatrix(true, false);
        out.push(mesh.matrixWorld.toArray());
      }
      return out;
    };
    const bareStand = stand(bare);
    bare.view.dispose();

    const full = await mount(SQUAD, 'inf_squad', FULL);
    expect(full.lastCamera().toArray()).toEqual(camera);
    expect(full.view.info.camera).toEqual(info.camera);
    expect(full.view.info.sweepRadius).toBe(info.sweepRadius);
    expect(full.view.info.spacing).toBe(info.spacing);
    expect(full.view.info.figureRoots).toEqual(info.figureRoots);

    // And a purchase moves neither the camera nor the line of figures.
    const standing = stand(full);
    // Three figures were found standing, so a line that failed to carry over would show.
    expect(standing.filter((r) => r.length === 4)).toHaveLength(3);
    full.view.setKit({});
    expect(full.lastCamera().toArray()).toEqual(camera);
    expect(stand(full)).toEqual(standing);
    expect(stand(full)).toEqual(bareStand);
    full.view.dispose();
  });

  it('draws the new model BEFORE it releases the old one', async () => {
    const m = await mount(SQUAD, 'inf_squad', {});
    const old = m.meshes().find((x) => x.name === 'uniform');
    if (!old) throw new Error('no uniform mesh');
    const oldGeometry = old.geometry;
    const oldSkeleton = old.skeleton;
    const atDraw: { geometry: boolean; skeleton: boolean }[] = [];
    loader.onRender = () =>
      atDraw.push({ geometry: disposedGeometries.includes(oldGeometry), skeleton: disposedSkeletons.includes(oldSkeleton) });

    m.view.setKit(FULL);

    expect(atDraw).toEqual([{ geometry: false, skeleton: false }]);
    // ...and it WAS released afterwards: a view that leaks would pass the line above.
    expect(disposedGeometries.includes(oldGeometry)).toBe(true);
    expect(disposedSkeletons.includes(oldSkeleton)).toBe(true);
    m.view.dispose();
  });

  it('leaves nothing behind: every geometry, material and skeleton it ever drew is disposed, once', async () => {
    const seen = {
      geometries: new Set<THREE.BufferGeometry>(),
      materials: new Set<THREE.Material>(),
      skeletons: new Set<THREE.Skeleton>(),
    };
    const m = await mount(SQUAD, 'inf_squad', {});
    loader.onRender = () => {
      m.lastScene().traverse((o) => {
        // The team's own meshes: the sand patch is the view's, not a build's.
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        seen.geometries.add(mesh.geometry);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) seen.materials.add(mat);
        seen.skeletons.add(mesh.skeleton);
      });
    };
    // Three swaps, each drawn (and so seen).
    m.view.setKit(FULL);
    m.view.setKit({ armour: 2 });
    m.view.setKit({});
    expect(seen.geometries.size).toBeGreaterThanOrEqual(12);
    // Before the view goes, only the LIVE model is still undisposed.
    const live = m.meshes();
    const stillUp = [...seen.geometries].filter((g) => !disposedGeometries.includes(g));
    expect(stillUp.length).toBe(live.length);
    expect(stillUp.every((g) => live.some((x) => x.geometry === g))).toBe(true);

    m.view.dispose();
    // Counts, not objects: a failing `toContain` prints a whole geometry.
    expect([...seen.geometries].filter((g) => !disposedGeometries.includes(g)).length).toBe(0);
    expect([...seen.materials].filter((x) => !disposedMaterials.includes(x)).length).toBe(0);
    expect([...seen.skeletons].filter((k) => !disposedSkeletons.includes(k)).length).toBe(0);
    expect(new Set(disposedGeometries).size).toBe(disposedGeometries.length);
    expect(new Set(disposedMaterials).size).toBe(disposedMaterials.length);
    // A call after dispose is inert.
    const n = disposedGeometries.length;
    m.view.setKit(FULL);
    m.view.dispose();
    expect(disposedGeometries.length).toBe(n);
  });
});

describe('mountGarageView: a team whose GLB declares no kit', () => {
  it('is drawn straight from the loaded scene, whatever tiers it is handed, and setKit does nothing', async () => {
    const plain = await mount(GRENADIER, 'inf_grenadier');
    const handed = await mount(GRENADIER, 'inf_grenadier', FULL);

    // Not a clone: the very scene the loader returned, as before this change.
    const drawnRoot = (m: typeof plain): THREE.Object3D | undefined => {
      let root: THREE.Object3D | undefined;
      m.lastScene().traverse((o) => {
        if (parsed.includes(o)) root = o;
      });
      return root;
    };
    expect(drawnRoot(plain) === parsed[0]).toBe(true);
    expect(drawnRoot(handed) === parsed[1]).toBe(true);

    // The same picture whatever it was handed.
    expect(handed.lastCamera().toArray()).toEqual(plain.lastCamera().toArray());
    expect(JSON.stringify(handed.view.info)).toBe(JSON.stringify(plain.view.info));
    expect(handed.drawn()).toEqual(plain.drawn());

    const frames = handed.view.stats().frames;
    const before = handed.meshes();
    handed.view.setKit({ armour: 3 });
    expect(handed.view.stats().frames).toBe(frames);
    expect(handed.meshes().every((x, i) => x === before[i] && x.geometry === before[i].geometry)).toBe(true);
    plain.view.dispose();
    handed.view.dispose();
  });

  it('draws the shipped figure byte for byte: the buffers a mission template would hold', async () => {
    const { buildMeshUnitTemplate } = await import('../units/mesh-unit');
    const ref = buildMeshUnitTemplate(await parseGlbHeadless(GRENADIER), 'kdf', 'inf_grenadier.glb', false);
    const want: Record<string, number[]> = {};
    ref.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) want[mesh.name] = [...(mesh.geometry.getAttribute('position').array as Float32Array)];
    });

    const m = await mount(GRENADIER, 'inf_grenadier');
    const got: Record<string, number[]> = {};
    m.lastScene().traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && want[mesh.name]) got[mesh.name] = [...(mesh.geometry.getAttribute('position').array as Float32Array)];
    });
    expect(Object.keys(want).length).toBeGreaterThan(0);
    expect(got).toEqual(want);
    m.view.dispose();
  });
});
