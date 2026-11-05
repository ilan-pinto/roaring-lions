/**
 * @vitest-environment jsdom
 *
 * GH-943 P1 (T7) gates: the node AO. Each has a one-line falsification, run by hand and listed in the commit message.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  createNodeAoStage,
  createNodePostChain,
  withAoOccludersOnly,
  NODE_AO_PREPASS_NAME,
  type NodeAoDeps,
} from './post-chain.node';
import { seededAoNoiseTexture } from './ao-occluder';
import { QUALITY_PRESETS } from '../quality';

async function aoDeps(): Promise<NodeAoDeps> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { ao } = await import('three/addons/tsl/display/GTAONode.js');
  const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js');
  return { W, TSL, ao: ao as never, denoise: denoise as never };
}

/** A scene with one of each kind of thing the AO must and must not see. */
function world() {
  const geo = (normal: boolean): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    if (normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    return g;
  };
  const scene = new THREE.Scene();
  const terrain = new THREE.Mesh(geo(true), new THREE.MeshBasicMaterial());
  const backdrop = new THREE.Mesh(geo(true), new THREE.MeshBasicMaterial());
  backdrop.userData.rlAoExempt = true;
  const smoke = new THREE.Mesh(geo(true), new THREE.MeshBasicMaterial({ transparent: true }));
  const rain = new THREE.Mesh(geo(false), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  const outline = new THREE.Mesh(geo(false), new THREE.MeshBasicMaterial());
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  scene.add(terrain, backdrop, smoke, rain, outline, sun);
  return { scene, terrain, backdrop, smoke, rain, outline, sun };
}

afterEach(() => vi.restoreAllMocks());

describe('withAoOccludersOnly: the AO-exempt filter', () => {
  it('hides the backdrop, smoke, rain and the normal-less hull for the draw only, and freezes the sun shadow', () => {
    const w = world();
    let seen: Record<string, boolean> = {};
    withAoOccludersOnly(w.scene, () => {
      seen = { terrain: w.terrain.visible, backdrop: w.backdrop.visible, smoke: w.smoke.visible, rain: w.rain.visible, outline: w.outline.visible };
      expect(w.sun.shadow.autoUpdate).toBe(false);
    });
    // Falsify: make `isAoOccluder` return true (or drop the `hidden.push`) in `withAoOccludersOnly`: the backdrop, smoke and rain read true.
    expect(seen).toEqual({ terrain: true, backdrop: false, smoke: false, rain: false, outline: false });
    expect(w.backdrop.visible && w.smoke.visible && w.rain.visible && w.outline.visible).toBe(true);
    expect(w.sun.shadow.autoUpdate).toBe(true);
  });

  it('restores on a throw, and leaves an object that was already hidden hidden', () => {
    const w = world();
    w.smoke.visible = false;
    expect(() =>
      withAoOccludersOnly(w.scene, () => {
        throw new Error('shader compile');
      })
    ).toThrow('shader compile');
    expect(w.backdrop.visible).toBe(true);
    expect(w.smoke.visible).toBe(false);
    expect(w.sun.shadow.autoUpdate).toBe(true);
  });
});

describe('the node AO stage', () => {
  const ctxFor = async (deps: NodeAoDeps, scene: THREE.Scene, aoScale?: number) => ({
    input: deps.TSL.vec4(0.5, 0.5, 0.5, 1) as never,
    scenePass: {} as never,
    TSL: deps.TSL,
    scene,
    camera: new THREE.OrthographicCamera(),
    quality: { ao: true, smaa: true, bloom: 'quarter' as const, ...(aoScale === undefined ? {} : { aoScale }) },
  });

  it('draws through the filter: the pre-pass sees only occluders, and is skipped when the AO contributes nothing', async () => {
    const deps = await aoDeps();
    const w = world();
    const stage = createNodeAoStage(deps);
    stage.factory(await ctxFor(deps, w.scene));
    const parts = stage.parts();
    if (!parts) throw new Error('no parts');
    const seen: boolean[][] = [];
    // The base `PassNode.updateBefore` renders; here it records what was visible when it would have.
    const spy = vi.spyOn(deps.W.PassNode.prototype, 'updateBefore').mockImplementation(() => {
      seen.push([w.terrain.visible, w.backdrop.visible, w.smoke.visible, w.rain.visible]);
      return undefined;
    });
    const frame = {} as never;
    parts.prePass.updateBefore(frame);
    // Falsify: call `super.updateBefore(frame)` directly in `AoPrePass.updateBefore`, without the wrapper: the second row is all true.
    expect(seen).toEqual([[true, false, false, false]]);
    stage.control.setEnabled(false);
    parts.prePass.updateBefore(frame);
    stage.control.setEnabled(true);
    stage.control.setBlend(0);
    parts.prePass.updateBefore(frame);
    // Falsify: make `prePass.gate` return true. The count is 3, not 1.
    expect(spy).toHaveBeenCalledTimes(1);
    stage.control.setBlend(1);
    parts.prePass.updateBefore(frame);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(w.backdrop.visible).toBe(true);
  });

  it('mirrors WorldGTAOPass: radius, scale, thickness, falloff, denoise phis, the pre-pass at aoScale, temporal off', async () => {
    const deps = await aoDeps();
    const stage = createNodeAoStage(deps);
    stage.factory(await ctxFor(deps, new THREE.Scene(), QUALITY_PRESETS.high.aoScale));
    const p = stage.parts();
    if (!p) throw new Error('no parts');
    // Falsify: change AO_RADIUS_TILES, AO_SCALE or the 0.25 in quality.ts; each reads red here.
    expect(QUALITY_PRESETS.high.aoScale).toBe(0.25);
    expect(p.gtao.radius.value).toBe(0.6);
    expect(p.gtao.scale.value).toBe(1.2);
    expect(p.gtao.thickness.value).toBe(1);
    expect(p.gtao.distanceExponent.value).toBe(1);
    expect(p.gtao.distanceFallOff.value).toBe(1);
    expect(p.gtao.useTemporalFiltering).toBe(false);
    expect(p.gtao.resolutionScale).toBe(0.25);
    expect(p.prePass.getResolutionScale()).toBe(0.25);
    expect(p.prePass.name).toBe(NODE_AO_PREPASS_NAME);
    expect(p.prePass.transparent).toBe(false);
    expect(p.prePass.overrideMaterial).not.toBeNull();
    expect([p.denoise.lumaPhi.value, p.denoise.depthPhi.value, p.denoise.normalPhi.value, p.denoise.radius.value]).toEqual([10, 2, 3, 8]);
    // Without an `aoScale` (medium and low never reach here) it falls to the shared constant, 0.5.
    const other = createNodeAoStage(deps);
    other.factory(await ctxFor(deps, new THREE.Scene()));
    expect(other.parts()?.gtao.resolutionScale).toBe(0.5);
  });

  it('is slotted between fog and bloom in the chain, and a quality without ao has no AO stage', async () => {
    const deps = await aoDeps();
    const stage = createNodeAoStage(deps);
    const W = deps.W;
    const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
    const chain = createNodePostChain(
      { W, TSL: deps.TSL, smaa: smaa as never },
      {} as never,
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      QUALITY_PRESETS.high,
      { fog: (c) => ({ node: c.input }), ao: stage.factory, bloom: (c) => ({ node: c.input }) }
    );
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'GTAOPass', 'QuarterBloomPass', 'OutputPass', 'SMAAPass']);
    chain.dispose();
    const medium = createNodePostChain(
      { W, TSL: deps.TSL, smaa: smaa as never },
      {} as never,
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      QUALITY_PRESETS.medium,
      { fog: null, ao: stage.factory, bloom: null }
    );
    expect(medium.passNames).not.toContain('GTAOPass');
    medium.dispose();
  });

  it('the control zeroes the blend uniform: off and a zero fade both read 0, on restores the weight', async () => {
    const deps = await aoDeps();
    const stage = createNodeAoStage(deps);
    const c = stage.control;
    c.setBlend(0.4);
    expect([c.blend, c.enabled]).toEqual([0.4, true]);
    expect(stage.blendUniform.value).toBe(0.4);
    c.setEnabled(false);
    // Falsify: drop `blendUniform.value = ...` from `push`; the layer then moves nothing and this reads 0.4.
    expect(stage.blendUniform.value).toBe(0);
    expect(c.enabled).toBe(false);
    expect(c.blend).toBe(0.4);
    c.setEnabled(true);
    c.setBlend(0);
    expect(stage.blendUniform.value).toBe(0);
    c.setBlend(1);
    expect(stage.blendUniform.value).toBe(1);
  });
});

describe('the private fields the AO relies on, pinned against three 0.186.1', () => {
  it('GTAONode has _noiseNode / _noiseTexture, built the same in every process; DenoiseNode builds a Math.random one', async () => {
    // Falsify: bump three; this goes red the day r187 renames either field.
    expect(THREE.REVISION).toBe('186');
    const deps = await aoDeps();
    const tex = (): never => deps.TSL.texture(new THREE.DataTexture(new Uint8Array(4), 1, 1)) as never;
    const a = deps.ao(tex(), tex(), new THREE.OrthographicCamera()) as unknown as {
      _noiseNode: { isTextureNode: boolean; value: THREE.DataTexture };
      _noiseTexture: THREE.DataTexture;
    };
    const b = deps.ao(tex(), tex(), new THREE.OrthographicCamera()) as unknown as typeof a;
    expect(a._noiseNode.isTextureNode).toBe(true);
    expect(a._noiseNode.value).toBe(a._noiseTexture);
    expect(Array.from(a._noiseTexture.image.data as Uint8Array)).toEqual(Array.from(b._noiseTexture.image.data as Uint8Array));
    const d1 = deps.denoise(tex(), tex(), tex(), new THREE.OrthographicCamera());
    const d2 = deps.denoise(tex(), tex(), tex(), new THREE.OrthographicCamera());
    const bytes = (t: THREE.Texture): number[] => Array.from((t as THREE.DataTexture).image.data as Uint8Array);
    expect(bytes(d1.noiseNode.value)).not.toEqual(bytes(d2.noiseNode.value));
  });

  it('the stage replaces the denoise noise with the seeded texture, identical on every build', async () => {
    const deps = await aoDeps();
    const bytes = (t: THREE.Texture): number[] => Array.from((t as THREE.DataTexture).image.data as Uint8Array);
    const build = async (): Promise<number[]> => {
      const stage = createNodeAoStage(deps);
      stage.factory({
        input: deps.TSL.vec4(0, 0, 0, 1) as never,
        scenePass: {} as never,
        TSL: deps.TSL,
        scene: new THREE.Scene(),
        camera: new THREE.OrthographicCamera(),
        quality: QUALITY_PRESETS.high,
      });
      return bytes(stage.parts()?.denoise.noiseNode.value as THREE.Texture);
    };
    const first = await build();
    // Falsify: delete the `den.noiseNode.value = seeded` line in `createNodeAoStage`; the two builds then differ.
    expect(await build()).toEqual(first);
    expect(first).toEqual(bytes(seededAoNoiseTexture()));
  });
});
