/**
 * @vitest-environment jsdom
 *
 * GH-1226 S6, gate G6 for the node decal twin's height blend (design 2026-11-12-gh1226-height-blend-design.md sections 3.2, 3.4 and 6):
 * with a record on the decal material the twin divides by `heightBlendTone(aGround, field(worldXZ), record)`, the SAME function the ground's
 * stage is built from, over the same field and record, bound by reference; with none the graph is today's (the legacy program is pin L4,
 * `terrain/height-blend-pins.test.ts`). Compiled by three's own `GLSLNodeBuilder` and `WGSLNodeBuilder`. Each check's one-line
 * falsification is in the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIAL_MATHS } from './material-maths';
import { NUMBER_OPS } from './fog-ops';
import { createDecalMaterial, DecalPool, setDecalLights, type DecalGroundUniforms, type DecalPalette } from './decal-pool';
import { buildNodeDecal, type DecalMaths, type NodeDecal } from './decal-pool.node';
import { DECAL_PERSISTENT_RENDER_ORDER } from './units/render-order';
import { defaultControlB } from './terrain/mesh';
import { heightBlendTone } from './terrain/height-blend';
import { HEIGHT_BLEND_BUILT_KEY, HEIGHT_BLEND_KEY, heightBlendPlaceholder, installHeightBlend, setHeightBlendVisible, type HeightBlendRecord } from './terrain/height-blend-record';
import { assertNoImplicitSampleInConditional } from './sample-uniformity';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const PALETTE: DecalPalette = {
  craterBowl: '#14150F', craterLip: '#E6D8BE', scorch: '#14150F', oil: '#23241F', rubbleA: '#A28C6E', rubbleB: '#75624A', tread: '#8F9464', tyre: '#C8B494',
};

function legacy(): THREE.ShaderMaterial {
  const ground: DecalGroundUniforms = {
    uControlB: { value: defaultControlB() },
    uMapSize: { value: new THREE.Vector2(48, 48) },
    uRoadTone: { value: new THREE.Vector3(0.6, 0.55, 0.5) },
    uShoulderTone: { value: new THREE.Vector3(0.7, 0.65, 0.6) },
    uRoadOn: { value: 1 },
  };
  const m = createDecalMaterial(PALETTE, ground);
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.5, 0.25), 2);
  sun.castShadow = true;
  setDecalLights(m, { sun, hemisphere: null, ambient: [] });
  return m;
}

function makeRecord(over: Partial<HeightBlendRecord> = {}): HeightBlendRecord {
  return {
    field: heightBlendPlaceholder(),
    rockTone: new THREE.Color(0.1, 0.2, 0.3),
    jointTone: new THREE.Color(0.4, 0.5, 0.6),
    hollowTone: new THREE.Color(0.7, 0.8, 0.9),
    aR: 0.75, aJ: 0.6, aH: 0.45, kH: 0.4, amp: 1,
    options: { textureEdge: true, joints: true },
    ...over,
  };
}

function realField(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([40, 100, 200, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

type Kind = 'glsl' | 'wgsl';
interface Uniform { readonly name: string; readonly node: { value: unknown } }
interface Built { readonly frag: string; readonly used: readonly Uniform[]; readonly renderUpdate: () => void }

async function nodes(owner: THREE.ShaderMaterial, maths: DecalMaths = MATERIAL_MATHS.decal): Promise<NodeDecal> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return buildNodeDecal({ W, TSL, maths }, owner);
}

async function compile(kind: Kind, n: NodeDecal): Promise<Built> {
  const W = await import('three/webgpu');
  const pool = new DecalPool({ capacity: 4, grid: 2, renderOrder: DECAL_PERSISTENT_RENDER_ORDER, material: legacy() });
  const mesh = new THREE.Mesh(pool.mesh.geometry, n.material);
  const r = new W.WebGPURenderer({ forceWebGL: kind === 'glsl' });
  r.shadowMap.enabled = true;
  const stubbed = r as unknown as { hasFeature(): boolean; hasCompatibility(): boolean; backend: Record<string, unknown> };
  stubbed.hasCompatibility = () => false;
  if (kind === 'wgsl') {
    stubbed.hasFeature = () => false;
    stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
    stubbed.backend.device = { features: new Set<string>() };
  }
  const Builder = (kind === 'glsl' ? W.GLSLNodeBuilder : (W as unknown as { WGSLNodeBuilder: unknown }).WGSLNodeBuilder) as new (m: THREE.Mesh, r: unknown) => unknown;
  const builder = new Builder(mesh, r) as unknown as {
    scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void;
    uniforms: { fragment: Uniform[] }; updateNodes: Array<{ update(frame: unknown): void }>; fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = n.material;
  builder.build();
  const frame = { camera: builder.camera, scene: builder.scene, renderer: r, object: mesh, material: n.material };
  return { frag: builder.fragmentShader, used: builder.uniforms.fragment, renderUpdate: () => { for (const u of builder.updateNodes) u.update(frame); } };
}

const samplerCount = (b: Built): number => new Set(b.used.filter((x) => (x.node.value as THREE.Texture | null)?.isTexture === true).map((x) => x.name)).size;

describe.each<Kind>(['glsl', 'wgsl'])('the node decal twin with a height-blend record, on %s', (kind) => {
  it('adds exactly one filtered sampler: two as a literal (control B alone without a record), and no implicit sample in a conditional', async () => {
    expect(samplerCount(await compile(kind, await nodes(legacy())))).toBe(1);
    const owner = legacy();
    const rec = makeRecord();
    installHeightBlend(owner, rec);
    const built = await compile(kind, await nodes(owner));
    expect(samplerCount(built)).toBe(2);
    expect(built.used.some((u) => u.node.value === rec.field), 'a sampler holds the field').toBe(true);
    if (kind === 'wgsl') {
      const declared = new Set([...built.frag.matchAll(/var (\w+_sampler) : sampler;/g)].map((m) => m[1]));
      const read = new Set([...built.frag.matchAll(/\btexture\w*\( \w+, (\w+_sampler),/g)].map((m) => m[1]));
      expect([...read].filter((x) => !declared.has(x)), 'a sampler read but never declared').toEqual([]);
      expect(read.size).toBe(2);
      expect(built.frag, 'an unfiltered load: the placeholder was unfilterable at the first build').not.toMatch(/\btextureLoad\(/);
    }
    expect(() => assertNoImplicitSampleInConditional(built.frag)).not.toThrow();
  });

  it('a field that lands after the build is the texture the twin samples (the carrier survives setup on this builder)', async () => {
    const owner = legacy();
    const rec = makeRecord();
    installHeightBlend(owner, rec);
    const n = await nodes(owner);
    const { used, renderUpdate } = await compile(kind, n);
    const placeholder = rec.field;
    expect(used.some((u) => u.node.value === placeholder), 'the placeholder is bound at build (non-vacuous)').toBe(true);
    const landed = realField();
    rec.field = landed;
    renderUpdate();
    expect((n.heightField as unknown as { value: unknown }).value).toBe(landed);
    expect(used.some((u) => u.node.value === landed), 'a sampler holds the landed field').toBe(true);
    expect(used.some((u) => u.node.value === placeholder), 'no sampler still holds the placeholder').toBe(false);
  });

  it('binds the record by reference and re-reads it after two render cadences; the layer toggle reaches the decals', async () => {
    const owner = legacy();
    const rec = makeRecord();
    installHeightBlend(owner, rec);
    const n = await nodes(owner);
    const { renderUpdate } = await compile(kind, n);
    expect(n.numbers.uHeightBlendRockTone?.value, 'bound, not copied').toBe(rec.rockTone);
    expect(n.numbers.uHeightBlendHollowTone?.value).toBe(rec.hollowTone);
    // The tone half reads neither the joint nor the softening input: no uniform is made, so none can go stale.
    expect(Object.keys(n.numbers).filter((k) => /Joint|KH|AJ/.test(k))).toEqual([]);
    rec.rockTone.setRGB(0.11, 0.12, 0.13);
    rec.hollowTone = new THREE.Color(0.21, 0.22, 0.23);
    Object.assign(rec, { aR: 0.31, aH: 0.33, amp: 0.35 });
    renderUpdate();
    expect(n.numbers.uHeightBlendRockTone?.value).toBe(rec.rockTone);
    expect(n.numbers.uHeightBlendHollowTone?.value).toBe(rec.hollowTone);
    expect([n.numbers.uHeightBlendAR?.value, n.numbers.uHeightBlendAH?.value, n.numbers.uHeightBlendAmp?.value]).toEqual([0.31, 0.33, 0.35]);
    rec.aR = 0.66;
    renderUpdate();
    expect(n.numbers.uHeightBlendAR?.value).toBe(0.66);
    expect(setHeightBlendVisible(owner, false)).toBe(1);
    renderUpdate();
    expect(n.numbers.uHeightBlendAmp?.value).toBe(0);
  });

  it('the field is tapped before the first discard, with control B (uniform control flow)', async () => {
    if (kind === 'wgsl') return;
    const owner = legacy();
    installHeightBlend(owner, makeRecord());
    const { frag } = await compile(kind, await nodes(owner));
    const main = frag.slice(frag.indexOf('void main()'));
    const taps = [...main.matchAll(/texture\( nodeUniform\d+, /g)].map((m) => m.index ?? -1);
    expect(taps, 'control B and the field').toHaveLength(2);
    expect(Math.max(...taps)).toBeLessThan(main.indexOf('discard'));
  });
});

describe('the divisor (G6): the twin hands the ground\'s own tone function aGround, the field texel, soil 1 and the record\'s nodes', () => {
  it('with a record, heightBlendTone is called once, on the flat aGround varying, the field\'s r g b, a literal soil of 1 and the bound knobs', async () => {
    const owner = legacy();
    const rec = makeRecord();
    installHeightBlend(owner, rec);
    const box: { seen: { base: unknown; field: unknown[]; soil: unknown; knobs: Record<string, unknown> } | null } = { seen: null };
    let calls = 0;
    const spy: DecalMaths = {
      ...MATERIAL_MATHS.decal,
      heightBlend: {
        ...MATERIAL_MATHS.decal.heightBlend,
        tone: ((o, base, field, soil, knobs) => {
          calls++;
          box.seen = { base, field: [...field], soil, knobs: knobs as never };
          return heightBlendTone(o, base, field, soil, knobs);
        }) as DecalMaths['heightBlend']['tone'],
      },
    };
    const n = await nodes(owner, spy);
    await compile('glsl', n);
    expect(calls).toBe(1);
    const s = box.seen as NonNullable<typeof box.seen>;
    expect((s.base as { name?: string }).name, 'aGround, the flat varying').toBe('vRlGround');
    expect(s.field.map((c) => (c as { components?: string }).components)).toEqual(['x', 'y', 'z']);
    // One statement-level var (the tap is taken before any discard) read three times, and it is assigned from the field tap.
    const vars = new Set(s.field.map((c) => (c as { node?: unknown }).node));
    expect(vars.size).toBe(1);
    expect(n.heightField, 'the tap exists and holds the record\'s field').not.toBeNull();
    expect((n.heightField as unknown as { value: unknown }).value).toBe(rec.field);
    expect((s.soil as { node?: { value?: unknown } }).node?.value, 'the soil literal').toBe(1);
    const knob: Record<string, string> = { rockTone: 'uHeightBlendRockTone', hollowTone: 'uHeightBlendHollowTone', rockAmp: 'uHeightBlendAR', hollowAmp: 'uHeightBlendAH', amp: 'uHeightBlendAmp' };
    for (const [k, u] of Object.entries(knob)) expect(s.knobs[k] === n.numbers[u], `${k} is ${u}`).toBe(true);
  });

  it('with no record the tone function is never called, no field tap exists, and no height-blend uniform is made', async () => {
    let calls = 0;
    const spy: DecalMaths = { ...MATERIAL_MATHS.decal, heightBlend: { ...MATERIAL_MATHS.decal.heightBlend, tone: (() => { calls++; throw new Error('called'); }) as never } };
    const n = await nodes(legacy(), spy);
    await compile('glsl', n);
    expect(calls).toBe(0);
    expect(n.heightField).toBeNull();
    expect(Object.keys(n.numbers).filter((k) => k.startsWith('uHeightBlend'))).toEqual([]);
  });

  it('on literals the divisor on a 22-degree bank is the rock mix of aGround, and on flat ground aGround itself (hand-worked)', () => {
    const k = (amp: number) => ({
      rockTone: [0.1, 0.2, 0.3], jointTone: [1, 1, 1], hollowTone: [0.7, 0.8, 0.9], rockAmp: [0.75], jointAmp: [0], hollowAmp: [0.45], soften: [0], amp: [amp],
    });
    const VEC = {
      lit: (x: number) => [x], add: (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? b[0] as number)),
    };
    void VEC;
    // Per channel on the scalar ops: s = 22.4 degrees (R 0.35 x 64), t = 0, n = 0.5 -> e = 1; mix(0.5, rock, 0.75).
    const ch = (base: number, rock: number): number =>
      heightBlendTone(NUMBER_OPS, base, [0.35, 128 / 255, 0.5], 1, { ...k(1), rockTone: rock, jointTone: 1, hollowTone: 0.7, rockAmp: 0.75, jointAmp: 0, hollowAmp: 0.45, soften: 0, amp: 1 } as never);
    expect(ch(0.5, 0.1)).toBeCloseTo(0.2, 12);
    expect(ch(0.5, 0.2)).toBeCloseTo(0.275, 12);
    expect(ch(0.5, 0.3)).toBeCloseTo(0.35, 12);
    const flat = heightBlendTone(NUMBER_OPS, 0.5, [0, 128 / 255, 0.5], 1, { rockTone: 0.1, jointTone: 1, hollowTone: 0.7, rockAmp: 0.75, jointAmp: 0, hollowAmp: 0.45, soften: 0, amp: 1 } as never);
    expect(flat).toBe(0.5);
  });
});

describe('the seal and the record key', () => {
  it('a record installed after the decal twin is built throws (it would be silently ignored); the keys are the ground\'s own', async () => {
    expect(MATERIAL_MATHS.decal.heightBlend.recordKey).toBe(HEIGHT_BLEND_KEY);
    expect(MATERIAL_MATHS.decal.heightBlend.builtKey).toBe(HEIGHT_BLEND_BUILT_KEY);
    const owner = legacy();
    await nodes(owner);
    expect(() => installHeightBlend(owner, makeRecord())).toThrow(/already built/);
  });
});
