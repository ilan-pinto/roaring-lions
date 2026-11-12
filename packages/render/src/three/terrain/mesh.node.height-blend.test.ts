/**
 * @vitest-environment jsdom
 *
 * GH-1226 S4, gate G5 for the node ground's height blend (design 2026-11-12-gh1226-height-blend-design.md sections 3.3 and 6): the record
 * is bound by reference and re-read every render, the field tap is filterable and survives a late load on BOTH node builders (three's
 * `GLSLNodeBuilder`, the WebGL2 fallback, and `WGSLNodeBuilder`, WebGPU), `low` compiles a smaller graph, and a record installed after the
 * twin is built throws. Pin N1 (no record, main's program) lives in `height-blend-pins.test.ts`. Each check's one-line falsification is in
 * the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GroundMaterial } from './mesh';
import { MATERIAL_MATHS } from '../material-maths';
import { buildNodeGround, type NodeGround } from './mesh.node';
import { HEIGHT_BLEND_FULL, type HeightBlendOptions } from './height-blend';
import {
  HEIGHT_BLEND_BUILT_KEY,
  HEIGHT_BLEND_KEY,
  heightBlendPlaceholder,
  heightBlendOf,
  installHeightBlend,
  setHeightBlendVisible,
  type HeightBlendRecord,
} from './height-blend-record';
import { assertNoImplicitSampleInConditional } from '../sample-uniformity';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

interface Uniform {
  readonly name: string;
  readonly node: { value: unknown };
}
type Kind = 'glsl' | 'wgsl';
interface Built {
  readonly frag: string;
  readonly ground: NodeGround;
  readonly used: readonly Uniform[];
  readonly renderUpdate: () => void;
}

function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3));
  g.setAttribute('wallAlbedo', new THREE.BufferAttribute(new Float32Array([-1, -1, -1]), 1));
  g.setAttribute('groundUv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
}

type Maths = typeof MATERIAL_MATHS.ground;

/** The twin compiled by the real builder of `kind` (no GPU: the WGSL builder's renderer facts are stubbed to a plain single-sampled device). */
async function compile(kind: Kind, owner: GroundMaterial, maths: Maths = MATERIAL_MATHS.ground): Promise<Built> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = buildNodeGround({ W, TSL, maths }, owner);
  const mesh = new THREE.Mesh(groundGeometry(), ground.material);
  const r = new W.WebGPURenderer({ forceWebGL: kind === 'glsl' });
  if (kind === 'wgsl') {
    const stubbed = r as unknown as { hasFeature(): boolean; backend: Record<string, unknown> };
    stubbed.hasFeature = () => false;
    stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
    stubbed.backend.device = { features: new Set<string>() };
  }
  const Builder = (kind === 'glsl' ? W.GLSLNodeBuilder : (W as unknown as { WGSLNodeBuilder: unknown }).WGSLNodeBuilder) as new (m: THREE.Mesh, r: unknown) => unknown;
  const builder = new Builder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Uniform[] };
    updateNodes: Array<{ update(frame: unknown): void }>;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  builder.build();
  const frame = { camera: builder.camera, scene: builder.scene, renderer: r, object: mesh, material: ground.material };
  const renderUpdate = (): void => {
    for (const n of builder.updateNodes) n.update(frame);
  };
  return { frag: builder.fragmentShader, ground, used: builder.uniforms.fragment, renderUpdate };
}

function realField(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([40, 100, 200, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeRecord(over: Partial<HeightBlendRecord> = {}): HeightBlendRecord {
  return {
    field: heightBlendPlaceholder(),
    rockTone: new THREE.Color(0.1, 0.2, 0.3),
    jointTone: new THREE.Color(0.4, 0.5, 0.6),
    hollowTone: new THREE.Color(0.7, 0.8, 0.9),
    aR: 0.75,
    aJ: 0.6,
    aH: 0.45,
    kH: 0.4,
    amp: 1,
    options: HEIGHT_BLEND_FULL,
    ...over,
  };
}

function withRecord(rec: HeightBlendRecord = makeRecord()): { owner: GroundMaterial; rec: HeightBlendRecord } {
  const owner = new GroundMaterial();
  installHeightBlend(owner, rec);
  return { owner, rec };
}

const KINDS: Kind[] = ['glsl', 'wgsl'];
const samplerCount = (b: Built): number => new Set(b.used.filter((x) => (x.node.value as THREE.Texture | null)?.isTexture === true).map((x) => x.name)).size;

describe.each(KINDS)('the node ground with a height-blend record, on %s', (kind) => {
  it('draws a different program from the same owner with no record, and a twin of its own', async () => {
    const plain = await compile(kind, new GroundMaterial());
    const { owner } = withRecord();
    const blended = await compile(kind, owner);
    expect(blended.frag).not.toBe(plain.frag);
    expect(blended.ground.material).not.toBe(plain.ground.material);
  });

  it('adds exactly one filtered sampler: nine, as a literal (eight without a record)', async () => {
    expect(samplerCount(await compile(kind, new GroundMaterial()))).toBe(8);
    const { owner, rec } = withRecord();
    const built = await compile(kind, owner);
    expect(samplerCount(built)).toBe(9);
    expect(built.used.some((u) => u.node.value === rec.field), 'a sampler holds the field').toBe(true);
    if (kind === 'wgsl') {
      const declared = new Set([...built.frag.matchAll(/var (\w+_sampler) : sampler;/g)].map((m) => m[1]));
      const read = new Set([...built.frag.matchAll(/\btexture\w*\( \w+, (\w+_sampler),/g)].map((m) => m[1]));
      expect([...read].filter((n) => !declared.has(n)), 'a sampler read but never declared').toEqual([]);
      expect(read.size, 'nine filtered samplers').toBe(9);
      expect(built.frag, 'an unfiltered load: the field placeholder was unfilterable at the first build').not.toMatch(/\btextureLoad\(/);
    }
    expect(() => assertNoImplicitSampleInConditional(built.frag)).not.toThrow();
  });

  it('a field that lands after the build is the texture the twin samples (the carrier survives setup on this builder)', async () => {
    const { owner, rec } = withRecord();
    const placeholder = rec.field;
    const { ground, used, renderUpdate } = await compile(kind, owner);
    expect(used.some((u) => u.node.value === placeholder), 'the placeholder is bound at build (non-vacuous)').toBe(true);
    const landed = realField();
    rec.field = landed;
    renderUpdate();
    for (const t of ground.textures.uHeightBlendField ?? []) expect(t.value).toBe(landed);
    expect(used.some((u) => u.node.value === landed), 'a sampler holds the landed field').toBe(true);
    expect(used.some((u) => u.node.value === placeholder), 'no sampler still holds the placeholder').toBe(false);
  });

  it('binds every record value by reference and re-reads it after two render cadences', async () => {
    const { owner, rec } = withRecord();
    const { ground, renderUpdate } = await compile(kind, owner);
    const n = ground.numbers;
    expect([n.uHeightBlendRockTone?.value, n.uHeightBlendJointTone?.value, n.uHeightBlendHollowTone?.value]).toEqual([rec.rockTone, rec.jointTone, rec.hollowTone]);
    expect(n.uHeightBlendRockTone?.value, 'bound, not copied').toBe(rec.rockTone);
    // Cadence 1: mutate a tone in place, replace another, change every number.
    rec.rockTone.setRGB(0.11, 0.12, 0.13);
    const swapped = new THREE.Color(0.21, 0.22, 0.23);
    rec.jointTone = swapped;
    Object.assign(rec, { aR: 0.31, aJ: 0.32, aH: 0.33, kH: 0.34, amp: 0.35 });
    renderUpdate();
    const expectAll = (): void => {
      expect(n.uHeightBlendRockTone?.value).toBe(rec.rockTone);
      expect((n.uHeightBlendRockTone?.value as THREE.Color).toArray()).toEqual([0.11, 0.12, 0.13].map((x) => expect.closeTo(x, 6)));
      expect(n.uHeightBlendJointTone?.value).toBe(swapped);
      expect(n.uHeightBlendHollowTone?.value).toBe(rec.hollowTone);
      expect([n.uHeightBlendAR?.value, n.uHeightBlendAJ?.value, n.uHeightBlendAH?.value, n.uHeightBlendKH?.value, n.uHeightBlendAmp?.value]).toEqual([0.31, 0.32, 0.33, 0.34, 0.35]);
    };
    expectAll();
    // Cadence 2: a second write, then the layer toggle (the debug layer writes `amp`).
    rec.aH = 0.66;
    renderUpdate();
    expect(n.uHeightBlendAH?.value).toBe(0.66);
    expect(setHeightBlendVisible(owner, false)).toBe(1);
    renderUpdate();
    expect(n.uHeightBlendAmp?.value).toBe(0);
    expect(setHeightBlendVisible(owner, true)).toBe(1);
    renderUpdate();
    expect(n.uHeightBlendAmp?.value).toBe(0.35);
  });
});

describe('the stage wiring and the graph choice (a spy stage, so the options and the inputs are read as values)', () => {
  type Seen = { field: unknown[]; knobs: Record<string, unknown>; options: HeightBlendOptions | undefined };
  function spied(): { maths: Maths; seen: () => Seen } {
    let seen: Seen | null = null;
    const maths: Maths = {
      ...MATERIAL_MATHS.ground,
      heightBlend: {
        ...MATERIAL_MATHS.ground.heightBlend,
        stage: ((o, v, field, knobs, options) => {
          seen = { field: [...field], knobs: knobs as never, options };
          return MATERIAL_MATHS.ground.heightBlend.stage(o, v, field, knobs, options);
        }) as Maths['heightBlend']['stage'],
      },
    };
    return {
      maths,
      seen: () => {
        if (seen === null) throw new Error('the stage was never built');
        return seen;
      },
    };
  }

  it('hands the stage the field texture\'s r, g, b and the record\'s nodes in every knob', async () => {
    const { owner, rec } = withRecord();
    const { maths, seen } = spied();
    const { ground } = await compile('glsl', owner, maths);
    const s = seen();
    expect(s.field.map((x) => (x as { components?: string }).components?.replace('x', 'r').replace('y', 'g').replace('z', 'b'))).toEqual(['r', 'g', 'b']);
    for (const c of s.field) expect((c as { node?: { value?: unknown } }).node?.value).toBe(rec.field);
    const knob: Record<string, string> = {
      rockTone: 'uHeightBlendRockTone', jointTone: 'uHeightBlendJointTone', hollowTone: 'uHeightBlendHollowTone',
      rockAmp: 'uHeightBlendAR', jointAmp: 'uHeightBlendAJ', hollowAmp: 'uHeightBlendAH', soften: 'uHeightBlendKH', amp: 'uHeightBlendAmp',
    };
    for (const [k, u] of Object.entries(knob)) expect(s.knobs[k] === ground.numbers[u], `${k} is ${u}`).toBe(true);
  });

  it('with no record the stage is never built', async () => {
    let built = false;
    const watch: Maths = { ...MATERIAL_MATHS.ground, heightBlend: { ...MATERIAL_MATHS.ground.heightBlend, stage: (() => { built = true; throw new Error('built'); }) as never } };
    await compile('glsl', new GroundMaterial(), watch);
    expect(built).toBe(false);
  });

  it.each([
    ['high / medium: the full graph', HEIGHT_BLEND_FULL],
    ['low: no texture edge and no joints', { textureEdge: false, joints: false }],
    ['arid: no joints', { textureEdge: true, joints: false }],
  ] as const)('%s', async (_n, options) => {
    const { owner } = withRecord(makeRecord({ options }));
    const { maths, seen } = spied();
    await compile('glsl', owner, maths);
    expect(seen().options).toEqual(options);
  });

  it('low and arid compile smaller programs than the full graph, on both builders', async () => {
    for (const kind of KINDS) {
      const full = (await compile(kind, withRecord().owner)).frag;
      const low = (await compile(kind, withRecord(makeRecord({ options: { textureEdge: false, joints: false } })).owner)).frag;
      const noJoint = (await compile(kind, withRecord(makeRecord({ options: { textureEdge: true, joints: false } })).owner)).frag;
      expect(low.length, `${kind}: low`).toBeLessThan(noJoint.length);
      expect(noJoint.length, `${kind}: no joints`).toBeLessThan(full.length);
    }
  });
});

describe('the record on its owner', () => {
  it('is read from a non-enumerable key, and a record installed after the twin is built throws', async () => {
    const owner = new GroundMaterial();
    const rec = makeRecord();
    installHeightBlend(owner, rec);
    expect(heightBlendOf(owner)).toBe(rec);
    expect(Object.keys(owner.userData)).not.toContain(HEIGHT_BLEND_KEY);
    await compile('glsl', owner);
    expect(() => installHeightBlend(owner, makeRecord())).toThrow(/already built/);
    expect(heightBlendOf(owner)).toBe(rec);
  });

  it('a twin built with NO record seals its owner too: a later install would never be drawn', async () => {
    const owner = new GroundMaterial();
    await compile('glsl', owner);
    expect(owner.userData[HEIGHT_BLEND_BUILT_KEY]).toBe(true);
    expect(() => installHeightBlend(owner, makeRecord())).toThrow(/already built/);
  });

  it('the placeholder is the field\'s own shape: RGBA8, Linear both ways (never Nearest), clamp, no mips, data not colour, bytes 0 / 128 / 128 / 255', () => {
    const t = heightBlendPlaceholder();
    expect([t.format, t.type, t.minFilter, t.magFilter, t.wrapS, t.wrapT, t.generateMipmaps, t.colorSpace]).toEqual([
      THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter, THREE.LinearFilter, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, false, THREE.NoColorSpace,
    ]);
    expect([...(t.image.data as Uint8Array)]).toEqual([0, 128, 128, 255]);
  });
});

describe('the height-blend debug layer', () => {
  it('hide, hide again, show: 1, 0, 1, and amp follows', () => {
    const { owner, rec } = withRecord(makeRecord({ amp: 0.8 }));
    expect([setHeightBlendVisible(owner, false), setHeightBlendVisible(owner, false), setHeightBlendVisible(owner, true), setHeightBlendVisible(owner, true)]).toEqual([1, 0, 1, 0]);
    expect(rec.amp).toBe(0.8);
    setHeightBlendVisible(owner, false);
    expect(rec.amp).toBe(0);
  });

  it('is a no-op on an owner with no record (legacy): 0, and it creates none', () => {
    const owner = new GroundMaterial();
    expect([setHeightBlendVisible(owner, false), setHeightBlendVisible(owner, true)]).toEqual([0, 0]);
    expect(Reflect.ownKeys(owner.userData)).toEqual([]);
  });
});
