/**
 * The garage turntable wears the bought kit (GH-238, plan 3, Task 7).
 *
 * Driven through the REAL `mountGarageView`, end to end, with the two things
 * a node test cannot have stood in: `THREE.WebGLRenderer` (no GPU), which
 * records what it was asked to draw, and the GLB loader, which counts its
 * calls and hands back a hand-built kitted vehicle in the shape
 * `GLTFLoader` produces -- a textured host and `kit_*` siblings sharing its
 * parent, transform and material (`mesh-unit-contract.md`, "Kit parts").
 *
 * The kit parts stand OUTSIDE the hull on purpose (a skirt off one side, a
 * mast above it), so the maximum-kit model's bounds differ from the bare
 * hull's in width, in height and in footprint centre: a fit or a centring
 * taken from the bought model instead would show up here as a moved camera
 * or a moved hull.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const loader = vi.hoisted(() => ({
  calls: 0,
  make: null as null | (() => unknown),
  /** Called inside every `render`, so a test can read what the world looked
   *  like at the moment a frame was drawn. */
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
      return Promise.resolve(loader.make?.());
    },
  }),
}));

const { mountGarageView } = await import('./garage-view');

interface FakeRendererStatic {
  last: { renders: { scene: THREE.Scene; camera: THREE.Vector3 }[] } | null;
}
const FakeRenderer = THREE.WebGLRenderer as unknown as FakeRendererStatic;

const HULL_VERTS = 24; // a BoxGeometry

function box(w: number, h: number, d: number, at: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.clearGroups();
  g.translate(at.x, at.y, at.z);
  return g;
}

/** A kitted vehicle as `GLTFLoader` hands one back, plus handles on the
 *  objects a test watches. */
function kittedVehicle(sourceOnlyTexture = false) {
  const bake = new THREE.Texture();
  bake.name = 'bake';
  // An unlit (KHR_materials_unlit) source: the build re-wraps it as a
  // standard material carrying ONLY `map`, so an `alphaMap` is a texture the
  // pristine scene holds and nothing the view draws does.
  const sourceOnly = new THREE.Texture();
  sourceOnly.name = 'source-only';
  const material = sourceOnlyTexture
    ? new THREE.MeshBasicMaterial({ map: bake, alphaMap: sourceOnly })
    : new THREE.MeshStandardMaterial({ map: bake });
  const scene = new THREE.Group();
  scene.name = 'Scene';
  const hull = new THREE.Mesh(box(2, 1, 4, new THREE.Vector3(0, 0.5, 0)), material);
  hull.name = 'hull_hull';
  hull.userData = { rl_role: 'hull' };
  scene.add(hull);
  const kit = (track: string, tier: number, g: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(g, material);
    m.name = `kit_${track}_${tier}_hull_hull`;
    m.userData = { rl_role: 'hull', rl_kit: { track, tier, host: 'hull_hull' } };
    scene.add(m);
    return m;
  };
  // Armour runs out along +x tier by tier; the sensor mast stands above.
  kit('armour', 1, box(0.4, 0.6, 3, new THREE.Vector3(1.2, 0.4, 0)));
  kit('armour', 2, box(0.4, 0.6, 3, new THREE.Vector3(1.6, 0.4, 0)));
  kit('armour', 3, box(0.6, 0.8, 3.6, new THREE.Vector3(2.1, 0.4, 0)));
  kit('sensors', 1, box(0.2, 1.5, 0.2, new THREE.Vector3(-0.5, 1.75, 0.5)));
  return { gltf: { scene, animations: [] as THREE.AnimationClip[] }, scene, bake, material, sourceOnly };
}

const COLORS = { key: '#ffffff', fill: '#ffffff', sky: '#ffffff', bounce: '#ffffff', ground: '#c8b494' };
const host = { clientWidth: 600, clientHeight: 400, appendChild: (): void => {} } as unknown as HTMLElement;

async function mount(kitTiers?: Readonly<Record<string, number>>, sourceOnlyTexture = false) {
  const v = kittedVehicle(sourceOnlyTexture);
  loader.make = () => v.gltf;
  const view = await mountGarageView(host, {
    typeId: 'mbt_lavi',
    kind: 'vehicle',
    meshUrl: '/meshes/vehicles/mbt_lavi.glb',
    dracoDecoderPath: '/draco/',
    colors: COLORS,
    ...(kitTiers ? { kitTiers } : {}),
  });
  const renderer = FakeRenderer.last;
  if (!renderer) throw new Error('no renderer was made');
  /** The live hull as the LAST frame drew it. */
  const drawnHull = (): THREE.Mesh => {
    const scene = renderer.renders[renderer.renders.length - 1].scene;
    let found: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (o.name === 'hull_hull' && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('no hull_hull in the drawn scene');
    return found;
  };
  const lastCamera = (): THREE.Vector3 => renderer.renders[renderer.renders.length - 1].camera;
  return { view, v, renderer, drawnHull, lastCamera };
}

let disposedGeometries: THREE.BufferGeometry[] = [];
let disposedMaterials: THREE.Material[] = [];
let disposedTextures: THREE.Texture[] = [];

beforeEach(() => {
  loader.calls = 0;
  loader.onRender = null;
  const g = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
  const m = vi.spyOn(THREE.Material.prototype, 'dispose');
  const t = vi.spyOn(THREE.Texture.prototype, 'dispose');
  disposedGeometries = g.mock.contexts as THREE.BufferGeometry[];
  disposedMaterials = m.mock.contexts as THREE.Material[];
  disposedTextures = t.mock.contexts as THREE.Texture[];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountGarageView: the bought kit on the turntable', () => {
  it('draws the bare hull with no tiers, and merges the kit into it with tiers', async () => {
    const bare = await mount();
    expect(bare.drawnHull().geometry.getAttribute('position').count).toBe(HULL_VERTS);
    bare.view.dispose();

    const kitted = await mount({ armour: 3, sensors: 1 });
    // Host plus every armour tier and the mast: 24 + 4 x 24.
    expect(kitted.drawnHull().geometry.getAttribute('position').count).toBe(HULL_VERTS * 5);
    kitted.view.dispose();
  });

  it('re-merges on setKit, up and down, from the one load, and never disposes the shared bake until the view goes', async () => {
    const m = await mount({});
    expect(loader.calls).toBe(1);
    const framesBefore = m.view.stats().frames;

    m.view.setKit({ armour: 3, sensors: 1 });
    expect(m.drawnHull().geometry.getAttribute('position').count).toBe(HULL_VERTS * 5);
    expect(m.view.stats().frames).toBe(framesBefore + 1);
    m.view.setKit({ armour: 1 });
    expect(m.drawnHull().geometry.getAttribute('position').count).toBe(HULL_VERTS * 2);
    m.view.setKit({});
    expect(m.drawnHull().geometry.getAttribute('position').count).toBe(HULL_VERTS);
    expect(loader.calls).toBe(1);

    // The bake survived three re-merges, and the pristine source is untouched.
    expect(disposedTextures.filter((t) => t === m.v.bake)).toHaveLength(0);
    expect(m.v.scene.children.filter((c) => c.name.startsWith('kit_'))).toHaveLength(4);
    expect(disposedMaterials).not.toContain(m.v.material);

    m.view.dispose();
    expect(disposedTextures.filter((t) => t === m.v.bake)).toHaveLength(1);
    // Nothing anywhere in the lifecycle was disposed twice.
    expect(new Set(disposedGeometries).size).toBe(disposedGeometries.length);
    expect(new Set(disposedMaterials).size).toBe(disposedMaterials.length);
    expect(new Set(disposedTextures).size).toBe(disposedTextures.length);
  });

  it('does nothing for tiers that draw the parts already shown', async () => {
    const m = await mount({ armour: 2 });
    const frames = m.view.stats().frames;
    const hull = m.drawnHull().geometry;
    m.view.setKit({ armour: 2, firepower: 3 }); // no firepower kit on this GLB
    expect(m.view.stats().frames).toBe(frames);
    expect(m.drawnHull().geometry).toBe(hull);
    m.view.dispose();
  });

  it('fits the camera and centres the footprint on the MAXIMUM kit, so tiers 0 and 3 frame alike', async () => {
    const bare = await mount({});
    const bareCam = bare.lastCamera().clone();
    const bareHull = bare.drawnHull().matrixWorld.clone();
    const bareInfo = bare.view.info;
    bare.view.dispose();

    const full = await mount({ armour: 3, sensors: 1 });
    expect(full.lastCamera().toArray()).toEqual(bareCam.toArray());
    expect(full.drawnHull().matrixWorld.elements).toEqual(bareHull.elements);
    expect(full.view.info.camera).toEqual(bareInfo.camera);
    expect(full.view.info.sweepRadius).toBe(bareInfo.sweepRadius);

    // And a purchase moves neither: the swapped-in hull stands where the
    // last one did, under the same camera.
    full.view.setKit({});
    expect(full.lastCamera().toArray()).toEqual(bareCam.toArray());
    expect(full.drawnHull().matrixWorld.elements).toEqual(bareHull.elements);
    full.view.dispose();
  });

  it('draws the new model BEFORE it releases the old one (a swap must not drop the shared program early)', async () => {
    const m = await mount({});
    // What the OLD template owns: its hull's merged geometry and material.
    // (Counting disposals would not do -- building the new template disposes
    // its own pre-merge clones, legitimately, before the draw.)
    const oldHull = m.drawnHull();
    const oldGeometry = oldHull.geometry;
    const oldMaterial = oldHull.material as THREE.Material;
    const atDraw: { geometry: boolean; material: boolean }[] = [];
    loader.onRender = () =>
      atDraw.push({ geometry: disposedGeometries.includes(oldGeometry), material: disposedMaterials.includes(oldMaterial) });

    m.view.setKit({ armour: 3, sensors: 1 });

    // Exactly one frame drew the swap, and at that moment the old template
    // was still whole...
    expect(atDraw).toEqual([{ geometry: false, material: false }]);
    // ...and it WAS released afterwards: a test that never saw a release
    // would pass the line above on a view that leaks.
    expect(disposedGeometries).toContain(oldGeometry);
    expect(disposedMaterials).toContain(oldMaterial);
    m.view.dispose();
  });

  it('disposes a texture only the pristine source holds, once, at dispose', async () => {
    const m = await mount({}, true);
    // The build dropped it, so it is on no drawn object -- only the pristine
    // scene reaches it.
    let drawn = false;
    m.renderer.renders[m.renderer.renders.length - 1].scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && Object.values(mat).includes(m.v.sourceOnly)) drawn = true;
    });
    expect(drawn).toBe(false);
    expect(disposedTextures).not.toContain(m.v.sourceOnly);

    m.view.dispose();
    expect(disposedTextures.filter((t) => t === m.v.sourceOnly)).toHaveLength(1);
    expect(disposedTextures.filter((t) => t === m.v.bake)).toHaveLength(1);
  });
});
