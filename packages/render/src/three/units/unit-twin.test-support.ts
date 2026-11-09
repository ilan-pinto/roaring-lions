/**
 * GH-943 P3 (T3): what the unit twin specs share. The twins are built by the backend's own factory body (`createNodeUnitMaterial`
 * with `MATERIAL_MATHS.unit`), from REAL legacy materials (the team variant, the running-gear clone, the scar, the fade, the soot
 * wreck), and compiled by three's own `GLSLNodeBuilder` (no GPU), so the specs read generated programs, not a mock.
 *
 * Test-only: imported by `*.node.test.ts` files and nothing else.
 */
import * as THREE from 'three';
import type { MaterialKit } from '../backend/backend';
import { MATERIAL_MATHS } from '../material-maths';
import { adoptMaterials, createTwinCache, NULL_P3_SLOTS, type TwinCache } from '../node-material-adoption';
import { createNodeUnitMaterial, nodeUnitBindings, type UnitBindings, type UN } from './unit-material.node';
import { markTwin } from '../twin-identity';

type W = typeof import('three/webgpu');

export interface UnitDeps {
  readonly W: W;
  readonly TSL: typeof import('three/tsl');
}

export async function unitDeps(): Promise<UnitDeps> {
  return { W: await import('three/webgpu'), TSL: await import('three/tsl') };
}

/** The Lavi's mark, as `mark-pass.ts` writes it (`team-mask.test.ts`'s fixture). */
export const MARK = {
  version: 1,
  roof: { x: [-1.7, -0.4], z_half: 0.7, y: [2.28, 2.56], min_ny: 0.6 },
  band: { x: [-1.7, -0.4], y: [2.12, 2.3], min_nz: 0.6 },
  exclude_uv: [[0.28149, 0.21069], [0.26978, 0.26538], [0.86938, 0.82397]],
  exclude_radius: 0.0002,
  luma: 0.17655,
  team_fraction: 0.021,
};

export const tex = (): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** What `GLTFLoader` hands over for the Lavi: a bake, its mean luma, and the mark in the material's extras. */
export function laviMaterial(map: THREE.Texture = tex()): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
  m.userData = { rl_bake_luma: 0.09, rl_team_mark: MARK };
  return m;
}

/** A box whose every vertex is on wheel 1 and off the track (the running-gear pass's attributes). */
export function taggedGeometry(wheel = 1, track = -1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry();
  const n = g.getAttribute('position').count;
  g.setAttribute('_rl_wheel', new THREE.BufferAttribute(new Uint8Array(n).fill(wheel), 1));
  g.setAttribute('_rl_track', new THREE.BufferAttribute(new Float32Array(n).fill(track), 1));
  return g;
}

/** The backend's `unit` factory, as `node-backend.ts` builds it. */
export function unitFactory(d: UnitDeps): (legacy: THREE.MeshStandardMaterial) => THREE.Material {
  return (legacy) => {
    const twin = createNodeUnitMaterial({ W: d.W, TSL: d.TSL, maths: MATERIAL_MATHS.unit }, legacy);
    markTwin(twin, legacy);
    return twin;
  };
}

/** A kit with only the unit slot filled. */
export function unitKit(d: UnitDeps): MaterialKit {
  return { ground: null, foliage: null, ring: null, ...NULL_P3_SLOTS, unit: unitFactory(d) };
}

/** Adopts `root` with a unit-only kit; returns the cache. */
export function adoptUnits(d: UnitDeps, root: THREE.Object3D, cache: TwinCache = createTwinCache()): TwinCache {
  adoptMaterials(root, unitKit(d), cache);
  return cache;
}

export function bindingsOf(twin: THREE.Material): UnitBindings {
  const b = nodeUnitBindings(twin);
  if (b === null) throw new Error('spec: not a unit twin');
  return b;
}

export function uniformOf(twin: THREE.Material, name: string): UN {
  const n = bindingsOf(twin).uniforms.get(name);
  if (n === undefined) throw new Error(`spec: the twin binds no ${name}`);
  return n;
}

/** Runs a uniform's own update the way three's `NodeFrame` does for it (render: no object; object: the drawn object). */
export function runUpdate(n: UN, object: THREE.Object3D | null = null): void {
  (n as unknown as { update(frame: unknown): void }).update({ object, material: null });
}

export interface Built {
  readonly vertex: string;
  readonly fragment: string;
  readonly usedVertex: ReadonlySet<unknown>;
  readonly usedFragment: ReadonlySet<unknown>;
  readonly updateBefore: readonly unknown[];
}

let renderer: InstanceType<W['WebGPURenderer']> | null = null;

/** A renderer for the builder (no GPU: `getDrawIndex` reads the backend's extension list, so it gets an empty one). */
export function builderRenderer(d: UnitDeps): InstanceType<W['WebGPURenderer']> {
  if (renderer === null) {
    renderer = new d.W.WebGPURenderer({ forceWebGL: true });
    (renderer as unknown as { backend: { extensions: { has(): boolean } } }).backend.extensions = { has: () => false };
  }
  return renderer;
}

/** The programs three builds for `material` drawing `mesh`. */
export function compile(d: UnitDeps, mesh: THREE.Object3D, material: THREE.Material): Built {
  const builder = new d.W.GLSLNodeBuilder(mesh, builderRenderer(d)) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
    uniforms: { vertex: Array<{ node: unknown }>; fragment: Array<{ node: unknown }> };
    updateBeforeNodes: unknown[];
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  const nodesOf = (list: Array<{ node: unknown }>): Set<unknown> => {
    const out = new Set<unknown>();
    for (const u of list) {
      const n = u.node as { node?: unknown; array?: unknown };
      out.add(u.node);
      // A uniform array's element is read through its buffer node.
      if (n.node !== undefined) out.add(n.node);
    }
    return out;
  };
  return {
    vertex: builder.vertexShader,
    fragment: builder.fragmentShader,
    usedVertex: nodesOf(builder.uniforms.vertex),
    usedFragment: nodesOf(builder.uniforms.fragment),
    updateBefore: builder.updateBeforeNodes,
  };
}

let wgslRenderer: InstanceType<W['WebGPURenderer']> | null = null;

/**
 * The WGSL three builds for `material` drawing `mesh` (the G arm's program text), on an UNINITIALISED WebGPU renderer whose backend is
 * handed the three facts the builder asks the device for (no features, the default uniform-buffer limit, not compatibility mode).
 */
export function compileWgsl(d: UnitDeps, mesh: THREE.Object3D, material: THREE.Material): { vertex: string; fragment: string } {
  if (wgslRenderer === null) {
    wgslRenderer = new d.W.WebGPURenderer();
    const r = wgslRenderer as unknown as { hasFeature(): boolean; backend: { device: unknown; compatibilityMode: boolean } };
    r.hasFeature = () => false;
    r.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    r.backend.compatibilityMode = false;
  }
  const builder = new d.W.WGSLNodeBuilder(mesh, wgslRenderer) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

export const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));
