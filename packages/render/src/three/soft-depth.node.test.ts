/**
 * @vitest-environment jsdom
 *
 * jsdom: the node SMAA builds its lookup textures from `new Image()` (as `post-chain.node.test.ts`).
 *
 * GH-1227 slice 3: the node (WebGPU) backend's soft-particle depth copy, the design's section 5, option W1
 * (`docs/superpowers/specs/2026-11-11-soft-particles-design.md`). Node only, no GPU. Gates (each has a one-line mutation, run red
 * once and listed in the commit message):
 *  - C1: the copy is built only when the flag is on AND the device can copy the depth (`nodeSoftDepthOn`);
 *  - C2: off, the node chain is main's, to the literal: scene pass depth type and format, pass list, and the chain's compiled WGSL
 *    (every fragment program, the fog stage's depth read included), hashed on origin/main 67657d89b before this change;
 *  - C3: on, the scene pass renders the copy's own format (depth32float-stencil8), and nothing else in the chain moves;
 *  - C4: the copy reads only the CURRENT scene pass target, of the copyable type, and copies into the texture the twin samples;
 *  - C5: the flipbook smoke twin samples the filled texture (`texture_depth_2d`);
 *  - C6: in three's own render-list order the copy runs after every opaque draw and before the smoke pass, in the same frame.
 */
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNodePostChain, nodeSceneDepthType, nodeSoftDepthOn, SOFT_DEPTH_FEATURE, type NodePostChain, type NodePostDeps } from './post-chain.node';
import { createFogStageFactory } from './fog-pass.node';
import { FogUniforms, FOG_OFFMAP_FADE_TILES } from './fog-spec';
import { WORLD_PER_LEVEL } from './terrain/shared';
import { fogDim } from './fog-ops';
import { HAZE_FORWARD, HAZE_LOW, hazeAmountOps } from './haze';
import { shimmerOffsetOps, SHIMMER_MAX_SITES } from './shimmer';
import { OUTPUT_MATHS } from './output-maths';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import type { PostKit } from './backend/backend';
import { NodeSoftDepthCopy, type NodeSoftDepthRenderer } from './soft-depth';
import { SOFT_DEPTH_SNAPSHOT_RENDER_ORDER } from './units/render-order';
import { FlipbookFx } from './units/flipbook-fx';
import { VFX_TEXTURES_KEY, type LateTexture } from './units/flipbook-fx.node';
import { adoptFx, compileWgsl } from './units/fx-twin-test-kit';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
/**
 * A program up to what three numbers by process-global counters: the `NodeBuffer_<id>` name and the order of a uniform struct's
 * members both depend on how many nodes the process built before (measured: the same chain built twice in one process differs in
 * exactly those two ways and no other). Everything else, every expression and binding type, is compared as text.
 */
function canonical(wgsl: string): string {
  return wgsl
    .replace(/NodeBuffer_\d+/g, 'NodeBuffer_N')
    .replace(/(struct \w+ \{\n)([\s\S]*?)(\n\})/g, (_m, open: string, body: string, close: string) => open + body.split('\n').sort().join('\n') + close);
}
type Preset = 'high' | 'medium' | 'low';
const PRESETS: readonly Preset[] = ['high', 'medium', 'low'];

/**
 * Main's node chain, by LITERAL (origin/main 67657d89b, before this slice). Depth: 1020 is `UnsignedInt248Type` and 1027 is
 * `DepthStencilFormat`, which three's WebGPU backend maps to `depth24plus-stencil8`. `wgsl` hashes the chain's fragment programs
 * (the pipeline's output node, then SMAA's input when there is one) compiled by three's `WGSLNodeBuilder`, `canonical`, with the
 * real fog stage and identity AO and bloom stages (so high and medium compile alike): the fog reads the scene pass depth, so a
 * depth binding that moved would move this. Taken by running this file's `chainWgsl` in a worktree of origin/main.
 */
const MAIN = Object.freeze({
  depthType: 1020,
  depthFormat: 1027,
  colourType: 1016,
  passes: {
    high: ['RenderPass', 'FogOfWarPass', 'GTAOPass', 'QuarterBloomPass', 'OutputPass', 'SMAAPass'],
    medium: ['RenderPass', 'FogOfWarPass', 'OutputPass', 'SMAAPass'],
    low: ['RenderPass', 'FogOfWarPass', 'OutputPass'],
  } as Record<Preset, string[]>,
  wgsl: { high: 'bbb391153ec46a00', medium: 'bbb391153ec46a00', low: '0c0368fa44a10c05' } as Record<Preset, string>,
});
/** `FloatType`: with `DepthStencilFormat`, three's WebGPU backend's `depth32float-stencil8`. */
const FLOAT_TYPE = 1015;

async function deps(): Promise<NodePostDeps> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  return { W, TSL, smaa: smaa as never, outputMaths: OUTPUT_MATHS };
}

function kit(): PostKit {
  const fog = new FogUniforms(new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat), 8, 8);
  return {
    fog: createFogStageFactory(fog.uniforms, HAZE_LOW, { hazeForward: HAZE_FORWARD, hazeAmountOps, shimmerOffsetOps, fogDim, offMapFadeTiles: FOG_OFFMAP_FADE_TILES, shimmerMaxSites: SHIMMER_MAX_SITES, worldPerLevel: WORLD_PER_LEVEL }),
    ao: (c) => ({ node: c.input }),
    bloom: (c) => ({ node: c.input }),
  };
}

async function chainFor(quality: RenderQuality, copyable: boolean): Promise<NodePostChain> {
  return createNodePostChain(await deps(), {} as never, new THREE.Scene(), new THREE.OrthographicCamera(), quality, kit(), copyable);
}

/** The chain's fragment programs, compiled to WGSL with no GPU (the stubs `fx-twin-test-kit.ts`'s `compileWgsl` uses). */
async function chainWgsl(chain: NodePostChain): Promise<string> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: false });
  const stubbed = r as unknown as { hasFeature(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } };
  stubbed.backend.capabilities = { getUniformBufferLimit: () => 65536 };
  const nodes: unknown[] = [chain.pipeline.outputNode, ...(chain.smaaInput ? [(chain.smaaInput as unknown as { node: unknown }).node] : [])];
  let all = '';
  for (const n of nodes) {
    const mat = new W.NodeMaterial();
    mat.fragmentNode = n as never;
    const Builder = (W as unknown as { WGSLNodeBuilder: new (m: unknown, r: unknown) => unknown }).WGSLNodeBuilder;
    const b = new Builder(new W.QuadMesh(mat), r) as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; fragmentShader: string };
    b.scene = new THREE.Scene();
    b.camera = new THREE.OrthographicCamera();
    b.material = mat;
    b.build();
    all += b.fragmentShader + '\n----\n';
  }
  return canonical(all);
}

interface RenderListLike {
  begin(): void;
  push(o: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, groupOrder: number, z: number, group: null, clipping: null): void;
  sort(a: null, b: null): void;
  readonly opaque: ReadonlyArray<{ object: THREE.Object3D }>;
  readonly transparent: ReadonlyArray<{ object: THREE.Object3D }>;
}
type RenderListCtor = new (lighting: unknown, scene: THREE.Scene, camera: THREE.Camera) => RenderListLike;

const on = (preset: Preset): RenderQuality => ({ ...QUALITY_PRESETS[preset], softParticles: true });

/** A recorder for the slice of `WebGPURenderer` the copy touches. */
function recorder(bound: THREE.RenderTarget | null, log: string[] = []): NodeSoftDepthRenderer & { copied: THREE.Texture[] } {
  const copied: THREE.Texture[] = [];
  return {
    copied,
    getRenderTarget: () => bound,
    copyFramebufferToTexture(t) {
      copied.push(t);
      log.push('copy');
    },
  };
}

function sceneTarget(w: number, h: number, type: THREE.TextureDataType = THREE.FloatType): THREE.RenderTarget {
  const d = new THREE.DepthTexture(w, h, type);
  d.format = THREE.DepthStencilFormat;
  return new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, depthTexture: d });
}

describe('C1: the node copy is built only when the flag is on and the device can copy the depth', () => {
  it('no preset turns it on, whatever the device; the flag alone does not either; both together do', () => {
    for (const p of PRESETS) {
      expect(nodeSoftDepthOn(QUALITY_PRESETS[p], true), `${p}, copyable`).toBe(false);
      expect(nodeSoftDepthOn(QUALITY_PRESETS[p], false), `${p}, not copyable`).toBe(false);
      expect(nodeSoftDepthOn({ ...QUALITY_PRESETS[p], softParticles: false }, true), `${p}, flag false`).toBe(false);
      expect(nodeSoftDepthOn(on(p), false), `${p}, flag on, no feature`).toBe(false);
      expect(nodeSoftDepthOn(on(p), true), `${p}, flag on, feature`).toBe(true);
    }
    expect(SOFT_DEPTH_FEATURE).toBe('depth32float-stencil8');
  });
});

describe("C2: off, the node chain is main's, to the literal", () => {
  for (const p of PRESETS) {
    for (const [label, quality, copyable] of [
      ['preset, copyable device', QUALITY_PRESETS[p], true],
      ['preset, no feature', QUALITY_PRESETS[p], false],
      ['flag on, no feature', on(p), false],
    ] as const) {
      it(`${p} (${label}): depth24plus-stencil8, the same passes, the same programs`, async () => {
        const chain = await chainFor(quality, copyable);
        const rt = chain.scenePass.renderTarget;
        expect(rt.depthTexture?.type).toBe(MAIN.depthType);
        expect(rt.depthTexture?.format).toBe(MAIN.depthFormat);
        expect(rt.texture.type).toBe(MAIN.colourType);
        expect(chain.passNames).toEqual(MAIN.passes[p]);
        const wgsl = await chainWgsl(chain);
        expect(wgsl).toContain('texture_depth_2d');
        expect(hash(wgsl)).toBe(MAIN.wgsl[p]);
        chain.dispose();
      });
    }
  }
});

describe('C3: on, the scene pass renders the copy format, and nothing else in the chain moves', () => {
  for (const p of PRESETS) {
    it(`${p}: depth32float-stencil8 matching the copy's texture; same passes; the same compiled programs`, async () => {
      const chain = await chainFor(on(p), true);
      const depth = chain.scenePass.renderTarget.depthTexture;
      const copy = new NodeSoftDepthCopy(() => chain.scenePass.renderTarget);
      expect(depth?.type).toBe(FLOAT_TYPE);
      expect(depth?.format).toBe(MAIN.depthFormat);
      expect(copy.depthTexture.type).toBe(depth?.type);
      expect(copy.depthTexture.format).toBe(depth?.format);
      // The copy is not a post stage: the pass list is main's, and the format is not in any program text.
      expect(chain.passNames).toEqual(MAIN.passes[p]);
      expect(hash(await chainWgsl(chain))).toBe(MAIN.wgsl[p]);
      expect(nodeSceneDepthType(true)).toBe(FLOAT_TYPE);
      expect(nodeSceneDepthType(false)).toBe(MAIN.depthType);
      copy.dispose();
      chain.dispose();
    });
  }
});

describe('C4: the copy reads only the current scene pass target, into the texture the twin samples', () => {
  it('copies the bound scene target, sized to it, into its own depth32float-stencil8 texture', () => {
    const rt = sceneTarget(64, 32);
    const copy = new NodeSoftDepthCopy(() => rt);
    const r = recorder(rt);
    const before = copy.depthTexture.version;
    expect(copy.capture(r)).toBe(true);
    expect(r.copied).toEqual([copy.depthTexture]);
    expect(copy.depthTexture.image).toMatchObject({ width: 64, height: 32 });
    expect(copy.depthTexture.version).toBeGreaterThan(before);
    expect(copy.captures).toBe(1);
    // The same size again does not recreate the GPU texture.
    const v = copy.depthTexture.version;
    copy.capture(r);
    expect(copy.depthTexture.version).toBe(v);
    copy.dispose();
  });

  it('never copies from another target (AO pre-pass, shadow map, photographGround, capture view) or the canvas', () => {
    const rt = sceneTarget(64, 32);
    const copy = new NodeSoftDepthCopy(() => rt);
    for (const other of [null, sceneTarget(64, 32), sceneTarget(16, 16)]) {
      const r = recorder(other);
      expect(copy.capture(r)).toBe(false);
      expect(r.copied).toEqual([]);
    }
    expect(copy.depthTexture.image).toMatchObject({ width: 1, height: 1 });
    copy.dispose();
  });

  it('follows a rebuilt chain: the scene target is re-read at every capture', () => {
    let rt = sceneTarget(8, 8);
    const copy = new NodeSoftDepthCopy(() => rt);
    const old = rt;
    rt = sceneTarget(24, 12);
    expect(copy.capture(recorder(old))).toBe(false);
    expect(copy.capture(recorder(rt))).toBe(true);
    expect(copy.depthTexture.image).toMatchObject({ width: 24, height: 12 });
    copy.dispose();
  });

  it("refuses a scene target whose depth is not the copy's type (today's depth24plus-stencil8): a mismatch is a backend error", () => {
    const rt = sceneTarget(8, 8, THREE.UnsignedInt248Type);
    const copy = new NodeSoftDepthCopy(() => rt);
    const r = recorder(rt);
    expect(copy.capture(r)).toBe(false);
    expect(r.copied).toEqual([]);
    copy.dispose();
  });

  it('the sentinel is the legacy one: first transparent draw, zero vertices, writes nothing, out of AO and shadows, hidden when idle', () => {
    const copy = new NodeSoftDepthCopy(() => null);
    const s = copy.sentinel;
    expect(s.renderOrder).toBe(SOFT_DEPTH_SNAPSHOT_RENDER_ORDER);
    expect(s.material.transparent).toBe(true);
    expect(s.material.colorWrite).toBe(false);
    expect(s.material.depthWrite).toBe(false);
    expect(s.material.depthTest).toBe(false);
    expect(s.geometry.drawRange.count).toBe(0);
    expect(s.geometry.getAttribute('normal')).toBeUndefined();
    expect(s.castShadow).toBe(false);
    expect(s.visible).toBe(false);
    const consumer = new THREE.Object3D();
    consumer.visible = false;
    copy.sync([consumer]);
    expect(s.visible).toBe(false);
    consumer.visible = true;
    copy.sync([consumer]);
    expect(s.visible).toBe(true);
    copy.dispose();
  });

  it("idle: an InstancedMesh consumer at count 0 is visible and draws nothing, so the sentinel stays hidden (the legacy rule)", () => {
    const copy = new NodeSoftDepthCopy(() => null);
    const tier = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 4);
    tier.count = 0;
    expect(tier.visible).toBe(true);
    copy.sync([tier]);
    expect(copy.sentinel.visible).toBe(false);
    tier.count = 2;
    copy.sync([tier]);
    expect(copy.sentinel.visible).toBe(true);
    tier.visible = false;
    copy.sync([tier]);
    expect(copy.sentinel.visible).toBe(false);
    copy.dispose();
  });
});

describe('C5: the flipbook smoke twin samples the filled texture', () => {
  it('the twin taps the copy depth texture (the one capture fills), compiled as texture_depth_2d', async () => {
    const rt = sceneTarget(16, 16);
    const copy = new NodeSoftDepthCopy(() => rt);
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(copy);
    const twin = await adoptFx(fx.mesh);
    const textures = twin.userData[VFX_TEXTURES_KEY] as Record<string, LateTexture>;
    const tap = textures.uSoftDepth?.taps[0] as unknown as { value: unknown } | undefined;
    const r = recorder(rt);
    copy.capture(r);
    expect(tap?.value).toBe(copy.depthTexture);
    expect(r.copied[0]).toBe(tap?.value);
    expect((await compileWgsl(fx.mesh)).fragment).toContain('texture_depth_2d');
    copy.dispose();
  });
});

describe("C6: in three's render-list order the copy runs after every opaque draw and before the smoke pass, in the same frame", () => {
  it('opaque world, then the copy, then the smoke twin, wherever the billow sits in depth', async () => {
    // three's own RenderList (not exported from `three/webgpu`; its source module is, under `three/src/*`).
    const listModule = 'three/src/renderers/common/RenderList.js';
    const { default: RenderList } = (await import(/* @vite-ignore */ listModule)) as { default: RenderListCtor };
    const rt = sceneTarget(16, 16);
    const copy = new NodeSoftDepthCopy(() => rt);
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(copy);
    await adoptFx(fx.mesh);
    fx.mesh.name = 'smoke';
    const ground = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    ground.name = 'ground';
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    wall.name = 'wall';
    wall.renderOrder = 7; // an opaque draw with a high band still draws before every transparent one
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(ground, wall, fx.mesh, copy.sentinel);
    for (const smokeZ of [-1, 0.5, 1]) {
      // The frame: the renderer's per-frame sync, then three's own list (`RenderList.push` routes opaque/transparent; `sort` is
      // the painter sorts) walked opaque first, then transparent, as `Renderer._renderScene` does.
      fx.mesh.visible = true;
      copy.sync([fx.mesh]);
      const log: string[] = [];
      const r = recorder(rt, log);
      const list = new RenderList({ getNode: () => ({ setLights() {} }) }, scene, camera);
      list.begin();
      const z = new Map<THREE.Object3D, number>([[ground, 0.9], [wall, 0.2], [fx.mesh, smokeZ], [copy.sentinel, 0]]);
      scene.traverseVisible((o) => {
        if (o instanceof THREE.Mesh) list.push(o, o.geometry, o.material as THREE.Material, 0, z.get(o) ?? 0, null, null);
      });
      list.sort(null, null);
      for (const item of [...list.opaque, ...list.transparent]) {
        const o = item.object as THREE.Mesh;
        o.onBeforeRender(r as never, scene, camera, o.geometry, o.material as THREE.Material, null as never);
        if (o !== copy.sentinel) log.push(o.name);
      }
      expect(log, `smoke z ${smokeZ}`).toEqual(['ground', 'wall', 'copy', 'smoke']);
    }
    // An idle frame (no smoke on screen) takes no copy.
    fx.mesh.visible = false;
    copy.sync([fx.mesh]);
    expect(copy.sentinel.visible).toBe(false);
    copy.dispose();
  });
});
