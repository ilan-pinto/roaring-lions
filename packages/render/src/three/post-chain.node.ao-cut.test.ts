/**
 * @vitest-environment jsdom
 *
 * GH-1248 gates: the node AO pre-pass draws a cut building through the SAME hole-or-cut mask as its TSL twin's colour pass
 * (`createNodeAoStage`'s `cutAoFor`, applied by `withAoOccludersOnly`), as the legacy pass swaps `userData.rlCutAo` on. The twin
 * is built over REAL legacy clones (`BuildingCutMaterials`, `BuildingHoleMaterials`) and the AO program is compiled by three's own
 * `GLSLNodeBuilder` and `WGSLNodeBuilder` (no GPU). Each spec's one-line mutation is in the commit message.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createNodeAoStage, NODE_AO_CUT_MATERIAL_NAME, withAoOccludersOnly, type NodeAoDeps } from './post-chain.node';
import { createOrthoAwareGtao } from './gtao-ortho.node';
import { AO_MATHS } from './output-maths';
import { MATERIAL_MATHS } from './material-maths';
import { BuildingCutMaterials, createCutUniforms, createCutMaskMaterials } from './units/cut-material';
import { BuildingHoleMaterials } from './units/holed-material';
import { buildingMask, buildingSkin } from './units/building-skin';
import { BUILDING_BOUND_KEY, createNodeBuildingMaterial, type BuildingTwinBound } from './units/building-cut.node';

async function aoDeps(): Promise<NodeAoDeps> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const gtaoModule = await import('three/addons/tsl/display/GTAONode.js');
  const ao = createOrthoAwareGtao({ TSL, GTAONode: gtaoModule.default as never });
  const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js');
  return { W, TSL, ao: ao as never, denoise: denoise as never, maths: AO_MATHS };
}

const col = (r: number, g: number, b: number): THREE.Color => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

/** A building as `applyBuildingSkin` leaves it on the node backend: the twin drawn, the legacy AO mask on `userData.rlCutAo`. */
async function cutBuilding(opts: { holes: boolean }) {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const shared = createCutUniforms();
  // One live volume: centre (0, 0, 0), R 3, so the unit box below sits inside the cut's reach.
  shared.uRlCutV.value.set([0, 0, 0, 3, 0.5, 0.2, 0, 0]);
  shared.uRlCutN.value = 1;
  const band = new THREE.MeshStandardMaterial({ color: 0xc8b494, roughness: 0.8 });
  const cut = new BuildingCutMaterials(shared, { cap: col(0.8, 0.7, 0.6), interior: col(0.1, 0.1, 0.1) });
  const holes = opts.holes ? new BuildingHoleMaterials({ lip: col(0.5, 0.4, 0.3), halo: col(0.2, 0.2, 0.2), crack: col(0.1, 0.1, 0.1), interior: col(0.05, 0.05, 0.05) }) : null;
  holes?.setHoles([{ c: [0, 0.5, 0.5], radius: 0.3, axis: [0, 0, 1], seed: 3, classRadius: 0.3 }]);
  const legacy = buildingSkin(band, holes, cut) as THREE.MeshStandardMaterial;
  const twin = createNodeBuildingMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.building }, legacy);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), twin);
  const mask = buildingMask(holes, cut, createCutMaskMaterials(shared));
  mesh.userData.rlCutAo = mask.ao;
  return { mesh, twin, bound: twin.userData[BUILDING_BOUND_KEY] as BuildingTwinBound };
}

const ctxFor = (deps: NodeAoDeps, scene: THREE.Scene) => ({
  input: deps.TSL.vec4(0.5, 0.5, 0.5, 1) as never,
  scenePass: {} as never,
  TSL: deps.TSL,
  scene,
  camera: new THREE.OrthographicCamera(),
  quality: { ao: true, smaa: true, bloom: 'quarter' as const },
});

interface Compiled {
  readonly frag: string;
  readonly vert: string;
  readonly used: ReadonlySet<unknown>;
}

async function compileGlsl(mesh: THREE.Mesh, material: THREE.Material): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  (r as unknown as { hasCompatibility(): boolean }).hasCompatibility = () => false;
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Array<{ node: unknown }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return { frag: builder.fragmentShader, vert: builder.vertexShader, used: new Set<unknown>(builder.uniforms.fragment.map((u) => u.node)) };
}

async function compileWgsl(mesh: THREE.Mesh, material: THREE.Material): Promise<string> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: false });
  const stubbed = r as unknown as { hasFeature(): boolean; hasCompatibility(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.hasCompatibility = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>() };
  const Builder = (W as unknown as { WGSLNodeBuilder: new (m: THREE.Mesh, r: unknown) => unknown }).WGSLNodeBuilder;
  const builder = new Builder(mesh, r) as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; fragmentShader: string };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return builder.fragmentShader;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

afterEach(() => vi.restoreAllMocks());

describe('GH-1248: the node AO pre-pass draws a cut building through its twin\'s mask', () => {
  /** What each mesh draws in the pre-pass, read the way r186's `Renderer._renderObjectDirect` reads it (`allowOverride`). */
  const drawnBy = (mesh: THREE.Mesh, override: THREE.Material): THREE.Material | null => {
    if (!mesh.visible) return null;
    const m = mesh.material as THREE.Material;
    return m.allowOverride === true ? override : m;
  };

  it('a cut mesh draws through its own mask material (not the override, not left out); the terrain through the override', async () => {
    const deps = await aoDeps();
    const scene = new THREE.Scene();
    const terrain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const b = await cutBuilding({ holes: false });
    scene.add(terrain, b.mesh);
    const stage = createNodeAoStage(deps);
    stage.factory(ctxFor(deps, scene));
    const parts = stage.parts();
    if (!parts) throw new Error('no parts');
    const override = parts.prePass.overrideMaterial as THREE.Material;
    let seen: Array<THREE.Material | null> = [];
    vi.spyOn(deps.W.PassNode.prototype, 'updateBefore').mockImplementation(() => {
      seen = [drawnBy(terrain, override), drawnBy(b.mesh, override)];
      return undefined;
    });
    parts.prePass.updateBefore({} as never);
    // Falsify: drop `, cutAoFor` from `AoPrePass.updateBefore`'s `withAoOccludersOnly` call: the cut mesh is left out (null), as on main.
    expect(seen[0]).toBe(override);
    expect(seen[1]).not.toBeNull();
    expect(seen[1]).not.toBe(override);
    expect(seen[1]?.name).toBe(NODE_AO_CUT_MATERIAL_NAME);
    expect(seen[1]).toBe(stage.cutAoFor(b.mesh));
    // Put back: the twin draws the colour again. Falsify: delete the `swapped` restore line in `withAoOccludersOnly`.
    expect(b.mesh.material).toBe(b.twin);
    expect(b.mesh.visible).toBe(true);
  });

  it('the mask material mirrors the legacy one: double-sided, no blending, allowOverride false, no fog, no tone map', async () => {
    const stage = createNodeAoStage(await aoDeps());
    const b = await cutBuilding({ holes: false });
    const m = stage.cutAoFor(b.mesh) as THREE.Material & { fog: boolean };
    const legacy = b.mesh.userData.rlCutAo as THREE.Material;
    // Falsify: delete `m.allowOverride = false` in `cutAoFor`: the override wins and the mask is never drawn.
    // Falsify: delete `m.side = THREE.DoubleSide`: the side reads FrontSide.
    expect([m.side, m.blending, m.allowOverride]).toEqual([legacy.side, legacy.blending, legacy.allowOverride]);
    expect([m.side, m.blending, m.allowOverride, m.fog, m.toneMapped]).toEqual([THREE.DoubleSide, THREE.NoBlending, false, false, false]);
  });

  for (const holes of [false, true]) {
    const label = holes ? 'holed and cut' : 'cut';
    it(`${label}: the AO program discards on the twin's mask, reading the twin's own cut${holes ? ' and hole' : ''} uniforms, on GLSL and WGSL`, async () => {
      const stage = createNodeAoStage(await aoDeps());
      const b = await cutBuilding({ holes });
      const m = stage.cutAoFor(b.mesh) as THREE.Material;
      const g = await compileGlsl(b.mesh, m);
      // A conditional discard on a computed value, never a constant.
      // Falsify: replace `TSL.bool(keep as never)` with `TSL.bool(TSL.float(1) as never)` in `cutAoFor`: no conditional discard is left.
      const cond = /if \( ([^\n]*) \) \{\s*discard;/.exec(g.frag);
      expect(cond, 'no conditional discard in the AO program').not.toBeNull();
      expect((cond as RegExpExecArray)[1]).toMatch(/nodeVar\d+/);
      // The SAME mask: the AO program reads the twin's bound nodes (the legacy records, by reference), every one of them.
      const names: Array<[string, unknown]> = [
        ['uRlCutV', b.bound.uRlCutV],
        ['uRlCutN', b.bound.uRlCutN],
      ];
      if (holes) names.push(['uRlHoleN', b.bound.uRlHoleN], ...(b.bound.uRlHoleC ?? []).map((c, i): [string, unknown] => [`uRlHoleC[${i}]`, c]));
      for (const [name, u] of names) expect(g.used.has(u), `the AO mask never reads ${name}`).toBe(true);
      expect(await compileWgsl(b.mesh, m)).toContain('discard');
    });
  }

  it('the AO discard IS the twin\'s maskNode: swap a sentinel in, and the AO program discards on the sentinel alone', async () => {
    // The colour twin discards on `maskNode` (`fragmentOps` through `MATERIAL_MATHS.building`; G1 of `building-cut.node.test.ts` pins
    // its fragments to the legacy GLSL on numbers, inside the cut included). The AO mask must take THAT node, not a copy of the maths.
    const TSL = await import('three/tsl');
    const stage = createNodeAoStage(await aoDeps());
    const b = await cutBuilding({ holes: false });
    const sentinel = TSL.uniform(0.75);
    (b.twin as unknown as { maskNode: unknown }).maskNode = sentinel.greaterThan(0.5);
    const g = await compileGlsl(b.mesh, stage.cutAoFor(b.mesh) as THREE.Material);
    // Falsify: the same `TSL.bool(TSL.float(1) as never)` in `cutAoFor`: the sentinel is never read.
    expect(g.used.has(sentinel), 'the AO discard does not read the twin\'s maskNode').toBe(true);
    expect(g.used.has(b.bound.uRlCutV), 'the AO mask reads the cut block past the twin\'s maskNode').toBe(false);
    // The direction matters: discard when the mask says NOT kept (falsify: `.discard()` for `.not().discard()` in post-chain.node.ts).
    expect(g.frag).toMatch(/if \( \( ! \( nodeUniform\d+ > 0\.5 \) \) \) \{\s*discard;/);
  });

  it('one mask material per twin, shared by its meshes, and disposed with it', async () => {
    const stage = createNodeAoStage(await aoDeps());
    const b = await cutBuilding({ holes: true });
    const other = new THREE.Mesh(b.mesh.geometry, b.twin);
    const m = stage.cutAoFor(b.mesh) as THREE.Material;
    expect(stage.cutAoFor(other)).toBe(m);
    const disposed = vi.fn();
    m.addEventListener('dispose', disposed);
    b.twin.dispose();
    // Falsify: delete the `twin.addEventListener('dispose', ...)` line in `cutAoFor`: the mask outlives its twin.
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('a mesh carrying the legacy mask but no node mask yet (twin not adopted) is still left out; so is a multi-material mesh', async () => {
    const stage = createNodeAoStage(await aoDeps());
    const scene = new THREE.Scene();
    const legacy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    legacy.userData.rlCutAo = new THREE.MeshNormalMaterial();
    const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [new THREE.MeshStandardMaterial()]);
    multi.userData.rlCutAo = new THREE.MeshNormalMaterial();
    scene.add(legacy, multi);
    let seen: boolean[] = [];
    withAoOccludersOnly(scene, AO_MATHS.isOccluder, () => (seen = [legacy.visible, multi.visible]), stage.cutAoFor);
    // Falsify: drop `cutAo ||` from the hide branch of `withAoOccludersOnly`: both read true, drawn whole through the override.
    expect(seen).toEqual([false, false]);
    expect([legacy.visible, multi.visible]).toEqual([true, true]);
  });
});

describe('GH-1248: no cut, no change (literals from main)', () => {
  it('with no mesh carrying rlCutAo, the pre-pass asks for no mask and swaps no material', async () => {
    const stage = createNodeAoStage(await aoDeps());
    const scene = new THREE.Scene();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const b = await cutBuilding({ holes: true });
    delete b.mesh.userData.rlCutAo; // a holed-only building carries no AO mask (P4): the AO sees its wall whole, as legacy
    scene.add(a, b.mesh);
    const ask = vi.fn(stage.cutAoFor);
    let during: THREE.Material[] = [];
    withAoOccludersOnly(scene, AO_MATHS.isOccluder, () => (during = [a.material as THREE.Material, b.mesh.material as THREE.Material]), ask);
    // Falsify: drop `cutAo && ` from `withAoOccludersOnly`'s mask line: the twin is asked and swapped.
    expect(ask).not.toHaveBeenCalled();
    expect(during).toEqual([a.material, b.twin]);
  });

  it('the AO normal material compiles to the program it compiled to on main', async () => {
    const deps = await aoDeps();
    const stage = createNodeAoStage(deps);
    stage.factory(ctxFor(deps, new THREE.Scene()));
    const parts = stage.parts();
    if (!parts) throw new Error('no parts');
    const normal = parts.prePass.overrideMaterial as THREE.Material;
    const g = await compileGlsl(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), normal), normal);
    // Read on origin/main's `post-chain.node.ts`, the same two. Falsify: `TSL.vec4(TSL.normalView, 0.5)` for `normalOut`.
    expect([normal.name, sha(g.vert), sha(g.frag)]).toEqual(['rl-node-ao-normal', '8127835137095656', 'd7f7f1b9665baba1']);
  });
});
