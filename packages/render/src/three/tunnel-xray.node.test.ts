/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T9) gates for `tunnel-xray.node.ts`: the tunnel x-ray's node twin (tube, collar, figure, beam), and the `Ops<T>` maths it
 * shares with the legacy file. The graphs are compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU) on the REAL x-ray meshes; the
 * pipeline state is read from three's own `WebGPUPipelineUtils` with a recording device. Each spec names its one-line falsification,
 * run by hand and listed in the commit message.
 *
 *  - G1 the reveal and the scan on numbers, at literals. Falsify: `mod` as `x - ceil(x / y) * y` in `xrayScanOps`.
 *  - G2 the four route arrays are the clock's own. Falsify: copy the arrays at build (`Float32Array.from`).
 *  - G3 the sim clock. Falsify: `uTime` from the wall clock.
 *  - G4 the tube and figure pipelines carry `GreaterDepth` and the stencil. Falsify: drop `depthFunc` from `RENDER_STATE_KEYS`.
 *  - R12 every other input, and the writers: `TunnelXray.update` writes the LEGACY record the twin reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
// @ts-expect-error -- three ships no declarations for its WebGPU backend's src/ utilities; the one method used is typed below.
import WebGPUPipelineUtilsUntyped from 'three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js';
import { NUMBER_OPS } from './fog-ops';
import { MATERIAL_MATHS } from './material-maths';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from './node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from './backend/unported';
import { compileMesh } from './batch-twin-compile.test-support';
import { SILHOUETTE_STENCIL_REF } from './units/silhouette';
import { legacyMaterialOf } from './twin-identity';
import {
  TunnelXray,
  XRAY_STEP,
  xrayBeamOps,
  xrayCollarOps,
  xrayFigureOps,
  xrayRevealOps,
  xrayScanOps,
  xrayTubeOps,
} from './tunnel-xray';
import { createNodeXrayMaterial, XRAY_BOUND_KEY, XRAY_STYLE_BY_NAME, type XrayTwinBound } from './tunnel-xray.node';

const N = NUMBER_OPS;
const COLORS = { rim: '#6FE0FF', core: '#14150F', hot: '#FFF6D0', figure: '#D93A2B' };

// ---------------------------------------------------------------------------------------------------------------------------------
// G1: the maths on numbers. LITERALS written from the GLSL text, never imported from the code under test.

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

describe('G1: the reveal and the scan, on numbers at literals', () => {
  it('reveal: the front fades over +-0.4 tiles around the sweep distance, from either side of the origin', () => {
    // s = 5 from origin 3 is d = 2; the front at 2 is mid-fade (smoothstep t = 0.5 -> 0.5), at 1.6 it has not reached, at 2.4 it has.
    expect(xrayRevealOps(N, 5, 3, 2, 0).revealed).toBeCloseTo(0.5, 12);
    expect(xrayRevealOps(N, 5, 3, 1.6, 0).revealed).toBeCloseTo(0, 12);
    expect(xrayRevealOps(N, 5, 3, 2.4, 0).revealed).toBeCloseTo(1, 12);
    // |s - o|: s below the origin by the same distance reads the same.
    expect(xrayRevealOps(N, 1, 3, 2, 0).revealed).toBeCloseTo(0.5, 12);
    expect(xrayRevealOps(N, 1, 3, 2, 0).d).toBe(2);
    // The GLSL's own `smoothstep(f + 0.4, f - 0.4, d)` evaluated by the definition (reversed edges: t = (d - e0) / (e1 - e0)).
    for (const [f, d] of [[3, 2.7], [3, 3.2], [1, 0.8], [5, 5.39]] as const) {
      expect(xrayRevealOps(N, d, 0, f, 0).revealed, `f ${f} d ${d}`).toBeCloseTo(smooth(f + 0.4, f - 0.4, d), 12);
    }
  });

  it('reveal: the gaussian edge is exp(-((f - d) * 2.2)^2) times the flash, 1 on the front and falling off either side', () => {
    expect(xrayRevealOps(N, 2, 0, 2, 0.5).edge).toBeCloseTo(0.5, 12);
    expect(xrayRevealOps(N, 2, 0, 1.6, 1).edge).toBeCloseTo(Math.exp(-(((1.6 - 2) * 2.2) ** 2)), 12);
    // A signed square: behind the front (f < d) and ahead of it (f > d) read the same.
    expect(xrayRevealOps(N, 2, 0, 2.4, 1).edge).toBeCloseTo(xrayRevealOps(N, 2, 0, 1.6, 1).edge, 12);
    // A fully swept route (front 1e6): fully revealed, no edge.
    expect(xrayRevealOps(N, 7, 0, 1e6, 1).revealed).toBe(1);
    expect(xrayRevealOps(N, 7, 0, 1e6, 1).edge).toBe(0);
  });

  it('scan: one band sweeping 6 tiles per sim second, wrapping every 30, at s = band the gaussian is 1 and the shaft (kind 1) is off', () => {
    // t = 7: x = 42, mod 30 = 12, band 9.
    expect(xrayScanOps(N, 9, 7, 0)).toBeCloseTo(1, 12);
    expect(xrayScanOps(N, 9, 7, 1)).toBe(0);
    // t = 0: x = 0, band -3.
    expect(xrayScanOps(N, -3, 0, 0)).toBeCloseTo(1, 12);
    // Past the wrap (t = 6: x = 36 -> 6, band 3), and not the unwrapped band 33.
    expect(xrayScanOps(N, 3, 6, 0)).toBeCloseTo(1, 12);
    expect(xrayScanOps(N, 33, 6, 0)).toBeCloseTo(0, 12);
    // A tile off the band: exp(-(0.5 * 1.6)^2).
    expect(xrayScanOps(N, 9.5, 7, 0)).toBeCloseTo(Math.exp(-((0.5 * 1.6) ** 2)), 12);
  });

  it('tube: the faint fragment is discarded unless the edge shows; strength gates alpha; the rim brightens at a grazing view', () => {
    const base = { st: 1, revealed: 1, edge: 0, flash: 0, grazing: 0.5, scan: 0, rim: 10, core: 0, hot: 100 };
    // 0.003 is the strength*reveal floor, 0.01 the edge floor (strict `<` discards).
    expect(xrayTubeOps(N, { ...base, st: 0.002 }).keep).toBe(0);
    expect(xrayTubeOps(N, { ...base, st: 0.003 }).keep).toBe(1);
    expect(xrayTubeOps(N, { ...base, st: 0.002, edge: 0.01 }).keep).toBe(1);
    expect(xrayTubeOps(N, { ...base, st: 0.002, edge: 0.009 }).keep).toBe(0);
    // alpha = st * revealed * (0.62 + 0.3 * g^3 + 0.35 * g^4 + 0.3 * scan), then clamped to 0.9.
    const g = 0.5;
    expect(xrayTubeOps(N, base).a).toBeCloseTo(0.62 + 0.3 * g ** 3 + 0.35 * g ** 4, 12);
    expect(xrayTubeOps(N, { ...base, st: 0.5 }).a).toBeCloseTo(0.5 * (0.62 + 0.3 * g ** 3 + 0.35 * g ** 4), 12);
    expect(xrayTubeOps(N, { ...base, grazing: 1, scan: 1 }).a).toBe(0.9);
    // colour: mix(core, rim, clamp(0.9 g^3 + g^4 + 0.7 scan)); with no edge and no flash the gain is 1.
    expect(xrayTubeOps(N, base).rgb).toBeCloseTo(10 * (0.9 * g ** 3 + g ** 4), 12);
    // The edge pulls toward hot and gains 1.4 * edge; the flash lifts alpha by 1 + 0.5 * flash.
    const e = xrayTubeOps(N, { ...base, edge: 1, flash: 1 });
    expect(e.rgb).toBeCloseTo(100 * (1 + 1.4 + 0.4), 12);
    expect(e.a).toBe(0.9);
    // A rounding hair past a unit dot product must not hand `pow` a negative base.
    expect(Number.isNaN(xrayTubeOps(N, { ...base, grazing: -1e-7 }).a)).toBe(false);
  });

  it('collar: lit only inside the front, the vent (kind 1) breathes on sin(t * 3.4), the surface collar holds 0.8', () => {
    const c = (kind: number, time: number, d = 1, front = 2) => xrayCollarOps(N, 1, d, front, kind, time, 0, 5, 7);
    expect(c(0, 0).a).toBeCloseTo(0.8, 12);
    expect(c(0, 123).a).toBeCloseTo(0.8, 12);
    // t chosen so 3.4 t = pi / 2: sin = 1 -> 0.65 + 0.35.
    expect(c(1, Math.PI / 2 / 3.4).a).toBeCloseTo(1, 12);
    expect(c(1, 0).a).toBeCloseTo(0.65, 12);
    // Outside the front (front < d): revealed 0 -> discarded. On it (front == d): `step(d, f)` is 1.
    expect(c(0, 0, 3, 2).keep).toBe(0);
    expect(c(0, 0, 2, 2).keep).toBe(1);
    // mix(rim, hot, flash * 0.6)
    expect(xrayCollarOps(N, 1, 0, 1, 0, 0, 1, 5, 7).rgb).toBeCloseTo(5 + (7 - 5) * 0.6, 12);
  });

  it('figure: fresnel mix of the team colour, alpha from the instance, off under 0.01', () => {
    // g = 0: mix(fig * 0.55, fig * 1.35, 0) = 0.55 fig; alpha * 0.62.
    expect(xrayFigureOps(N, 0, 10, 1).rgb).toBeCloseTo(5.5, 12);
    expect(xrayFigureOps(N, 0, 10, 1).a).toBeCloseTo(0.62, 12);
    // g = 1: 1.35 fig; alpha * 1.
    expect(xrayFigureOps(N, 1, 10, 0.5).rgb).toBeCloseTo(13.5, 12);
    expect(xrayFigureOps(N, 1, 10, 0.5).a).toBeCloseTo(0.5, 12);
    // pow(g, 1.3)
    expect(xrayFigureOps(N, 0.5, 10, 1).rgb).toBeCloseTo(10 * (0.55 + (1.35 - 0.55) * 0.5 ** 1.3), 12);
    expect(xrayFigureOps(N, 0.5, 10, 0.0099).keep).toBe(0);
    expect(xrayFigureOps(N, 0.5, 10, 0.01).keep).toBe(1);
  });

  it('beam: a gradient on position.y from hot (y 0) to rim (y 1), alpha uA * (0.35 + 0.65 y)', () => {
    expect(xrayBeamOps(N, 0, 100, 10, 0.8).rgb).toBe(100);
    expect(xrayBeamOps(N, 1, 100, 10, 0.8).rgb).toBe(10);
    expect(xrayBeamOps(N, 0, 100, 10, 0.8).a).toBeCloseTo(0.8 * 0.35, 12);
    expect(xrayBeamOps(N, 1, 100, 10, 0.8).a).toBeCloseTo(0.8, 12);
    expect(xrayBeamOps(N, 0.5, 100, 10, 1).rgb).toBeCloseTo(55, 12);
  });

  it('the legacy fragment text still carries the constants the maths reads (the two cannot drift)', () => {
    const x = built();
    const tube = (x.tube.material as THREE.ShaderMaterial).fragmentShader;
    const collar = (x.collars.material as THREE.ShaderMaterial).fragmentShader;
    const figure = (x.xray.figures.material as THREE.ShaderMaterial).fragmentShader;
    const beam = (x.xray.beam.material as THREE.ShaderMaterial).fragmentShader;
    for (const piece of [
      'smoothstep(f + 0.4, f - 0.4, d)', 'exp(-pow((f - d) * 2.2, 2.0)) * fl', 'pow(grazing, 4.0)', 'pow(grazing, 3.0)',
      'mod(uTime * 6.0, 30.0) - 3.0', 'exp(-pow((vS - band) * 1.6, 2.0)) * (1.0 - vKind)', 'edgeIn * 0.9 + rim + scan * 0.7',
      '0.62 + 0.3 * edgeIn + 0.35 * rim + 0.3 * scan', 'st * revealed < 0.003 && edge < 0.01', '1.0 + 1.4 * edge + 0.4 * fl * revealed',
      'a * (1.0 + 0.5 * fl)', 'edge * 0.9', 'clamp(a, 0.0, 0.9)',
    ]) expect(tube, piece).toContain(piece);
    for (const piece of ['step(abs(vS - o), f)', '0.65 + 0.35 * sin(uTime * 3.4)', ': 0.8', 'a < 0.01', 'fl * 0.6']) expect(collar, piece).toContain(piece);
    for (const piece of ['pow(1.0 - abs(dot(vN, uToCam)), 1.3)', 'uFig * 0.55, uFig * 1.35', '0.62 + 0.38 * fres', 'vAlpha < 0.01']) expect(figure, piece).toContain(piece);
    for (const piece of ['mix(uHot, uRim, vY)', 'uA * (0.35 + 0.65 * vY)']) expect(beam, piece).toContain(piece);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The harness: the REAL x-ray, its meshes adopted by the REAL factory.

function route(len: number): { points: [number, number][]; length: number } {
  const points: [number, number][] = [];
  for (let d = 0; d <= len + 1e-9; d += XRAY_STEP) points.push([d + 0.5, 0.5]);
  return { points, length: len };
}

type Pair = { legacy: THREE.ShaderMaterial; mesh: THREE.Mesh };

async function kitOf(): Promise<Parameters<typeof adoptMaterials>[1]> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    xray: (l: THREE.ShaderMaterial) => createNodeXrayMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.xray }, l, XRAY_STYLE_BY_NAME[l.name]),
  };
}

function built() {
  const xray = new TunnelXray(COLORS);
  xray.build([route(10)], () => 0);
  const kids = xray.group.children as THREE.Mesh[];
  const tube = kids.find((m) => (m.material as THREE.Material).name === 'rl-xray-tube') as THREE.Mesh;
  const collars = kids.find((m) => (m.material as THREE.Material).name === 'rl-xray-collar') as THREE.Mesh;
  return { xray, tube, collars };
}

async function adopted() {
  const b = built();
  const meshes: Record<'tube' | 'collar' | 'figure' | 'beam', Pair> = {
    tube: { mesh: b.tube, legacy: b.tube.material as THREE.ShaderMaterial },
    collar: { mesh: b.collars, legacy: b.collars.material as THREE.ShaderMaterial },
    figure: { mesh: b.xray.figures, legacy: b.xray.figures.material as THREE.ShaderMaterial },
    beam: { mesh: b.xray.beam, legacy: b.xray.beam.material as THREE.ShaderMaterial },
  };
  const n = adoptMaterials(b.xray.group, await kitOf(), createTwinCache());
  expect(n).toBe(4);
  const twin = (k: keyof typeof meshes): THREE.Material => meshes[k].mesh.material as THREE.Material;
  const bound = (k: keyof typeof meshes): XrayTwinBound => twin(k).userData[XRAY_BOUND_KEY] as XrayTwinBound;
  return { ...b, meshes, twin, bound };
}

type Updatable = { update(): void; value: unknown; array?: unknown };
const tick = (n: unknown): void => (n as Updatable).update();

// ---------------------------------------------------------------------------------------------------------------------------------
// G2: the route arrays are the clock's own.

describe('G2: the route arrays are bound by reference to XrayRouteClock', () => {
  it('each array node reads the clock\'s own Float32Array, and a write for route 3 reaches the buffer after one update', async () => {
    const { xray, tube, bound } = await adopted();
    const b = bound('tube');
    const clock = xray.clock;
    // The graph must be built before the buffer exists.
    await compileMesh(tube);
    const arrays: Array<[keyof XrayTwinBound, Float32Array]> = [
      ['uStrength', clock.strength], ['uOrigin', clock.origin], ['uFront', clock.front], ['uFlash', clock.flash],
    ];
    for (const [key, source] of arrays) {
      const node = b[key] as unknown as Updatable;
      expect(node.array, `${key} is a copy, not the clock's array`).toBe(source);
      source[3] = 0.25 + arrays.findIndex(([k]) => k === key);
      tick(node);
      // A float array is packed one element to a vec4 slot: route 3 is at 12.
      expect((node.value as Float32Array)[12], `${key}[3]`).toBeCloseTo(0.25 + arrays.findIndex(([k]) => k === key), 6);
      // And a second write, with no rebuild in between.
      source[3] = 0.9;
      tick(node);
      expect((node.value as Float32Array)[12]).toBeCloseTo(0.9, 6);
    }
  });

  it('the collar reads the same four arrays, and the program indexes them by the vertex\'s route: buffer[int(aRoute + 0.5)]', async () => {
    const { xray, collars, tube, bound } = await adopted();
    for (const mesh of [tube, collars]) {
      const b = bound(mesh === tube ? 'tube' : 'collar');
      const { glsl, vertex } = await compileMesh(mesh);
      const route = /(nodeVarying\d+) = aRoute;/.exec(vertex);
      expect(route, 'aRoute never reaches a varying').not.toBeNull();
      const r = (route as RegExpExecArray)[1];
      // Four distinct buffers of 16 slots, each read at the rounded route index.
      const reads = new Set([...glsl.matchAll(new RegExp(`(buffer\\d+)\\[ int\\( \\( ${r} \\+ 0\\.5 \\) \\) \\]\\.x`, 'g'))].map((m) => m[1]));
      expect(reads.size, `${mesh === tube ? 'tube' : 'collar'} reads ${[...reads]}`).toBe(mesh === tube ? 4 : 4);
      expect([...glsl.matchAll(/vec4 buffer\d+\[16\];/g)]).toHaveLength(4);
      for (const key of ['uStrength', 'uOrigin', 'uFront', 'uFlash'] as const) {
        expect((b[key] as unknown as Updatable).array).toBe({ uStrength: xray.clock.strength, uOrigin: xray.clock.origin, uFront: xray.clock.front, uFlash: xray.clock.flash }[key]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// G3: the sim clock.

describe('G3: uTime and uA follow the legacy record, which the sim clock writes; the wall clock never reaches the graph', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a zero-time repaint moves nothing: wall time passes, the twin\'s uTime holds the sim time, and a new sim time moves it', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout'] });
    const { xray, bound } = await adopted();
    xray.update(5, []);
    const times = [bound('tube').uTime, bound('collar').uTime];
    for (const t of times) {
      tick(t);
      expect((t as unknown as Updatable).value).toBe(5);
    }
    // A repaint a second of wall time later, the sim not having moved: the same value, even though the page's clock did.
    vi.advanceTimersByTime(1000);
    for (const t of times) {
      tick(t);
      expect((t as unknown as Updatable).value, 'the wall clock reached uTime').toBe(5);
    }
    xray.update(5.5, []);
    for (const t of times) {
      tick(t);
      expect((t as unknown as Updatable).value).toBe(5.5);
    }
  });

  it('the program carries no frame-clock term: uTime is a plain uniform, and the scan and the breath read it', async () => {
    const { tube, collars, bound } = await adopted();
    const t = await compileMesh(tube);
    expect(t.used.has(bound('tube').uTime), 'uTime is bound but the tube never reads it').toBe(true);
    expect(t.glsl).not.toMatch(/\btime\b|\bdeltaTime\b|\bframeId\b/);
    const c = await compileMesh(collars);
    expect(c.used.has(bound('collar').uTime), 'uTime is bound but the collar never reads it').toBe(true);
    expect(c.glsl).not.toMatch(/\btime\b|\bdeltaTime\b|\bframeId\b/);
  });

  it('the beam alpha uA follows the legacy record the same way', async () => {
    const { xray, bound } = await adopted();
    xray.discover(0, 0, { x: 3, y: 2, liftY: 2 });
    xray.clock.setRoute(0, 2, true, 0);
    xray.update(0.3, []);
    const a = bound('beam').uA as unknown as Updatable;
    tick(a);
    expect(a.value).toBeCloseTo(xray.clock.beamAlpha(0.3), 9);
    expect(a.value as number).toBeGreaterThan(0.5);
    xray.update(1.1, []);
    tick(a);
    expect(a.value).toBeCloseTo(xray.clock.beamAlpha(1.1), 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// G4: the WebGPU pipeline descriptor, built by three's own `WebGPUPipelineUtils` against a recording device.

interface DepthStencil {
  depthCompare?: string;
  depthWriteEnabled?: boolean;
  stencilFront?: { compare?: string; failOp?: string; depthFailOp?: string; passOp?: string };
  stencilReadMask?: number;
}

function pipelineOf(material: THREE.Material, mesh: THREE.Mesh): { depthStencil: DepthStencil; cullMode: string; frontFace: string; blend: unknown } {
  let captured: { depthStencil: DepthStencil; cullMode: string; frontFace: string; blend: unknown } | null = null;
  const backend = {
    device: {
      createPipelineLayout: () => ({}),
      pushErrorScope: () => {},
      popErrorScope: () => Promise.resolve(null),
      createRenderPipeline: (d: { depthStencil: DepthStencil; primitive: { cullMode: string; frontFace: string }; fragment: { targets: Array<{ blend?: unknown }> } }) => {
        captured = {
          depthStencil: structuredClone(d.depthStencil),
          cullMode: d.primitive.cullMode,
          frontFace: d.primitive.frontFace,
          blend: structuredClone(d.fragment.targets[0].blend),
        };
        return {};
      },
    },
    get: () => ({ module: {} }),
    utils: {
      getSampleCountRenderContext: () => 1,
      getCurrentColorFormat: () => 'rgba16float',
      getCurrentDepthStencilFormat: () => 'depth24plus-stencil8',
      getPrimitiveTopology: () => 'triangle-list',
    },
    attributeUtils: { createShaderVertexBuffers: () => [] },
    parameters: { reversedDepthBuffer: false },
    compatibilityMode: false,
  };
  const renderObject = {
    object: mesh,
    material,
    geometry: mesh.geometry,
    pipeline: { vertexProgram: {}, fragmentProgram: {} },
    getBindings: () => [],
    // The node scene pass: depth and stencil (`post-chain.node.ts`, depth24plus-stencil8).
    context: { textures: null, depth: true, stencil: true, mrt: null },
  };
  const Utils = WebGPUPipelineUtilsUntyped as new (b: unknown) => { createRenderPipeline(ro: unknown, promises: null): void };
  new Utils(backend).createRenderPipeline(renderObject, null);
  if (captured === null) throw new Error('no pipeline was created');
  return captured;
}

describe('G4: the node pipelines carry the x-ray\'s mechanism', () => {
  it('tube: greater depth, no depth write, back faces, stencil not-equal with every op keep. Figure: the same, front faces', async () => {
    const { meshes, twin } = await adopted();
    for (const k of ['tube', 'figure'] as const) {
      expect(twin(k).name).toBe(`rl-node-material-xray-${k}`);
      expect(twin(k)).not.toBe(meshes[k].legacy);
      const p = pipelineOf(twin(k), meshes[k].mesh);
      expect(p.depthStencil.depthCompare, `${k} depth`).toBe('greater');
      expect(p.depthStencil.depthWriteEnabled, `${k} depth write`).toBe(false);
      expect(p.depthStencil.stencilFront, `${k} stencil`).toEqual({ compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' });
      expect(p.depthStencil.stencilReadMask, `${k} stencil mask`).toBe(0xff);
      expect((twin(k) as THREE.Material).stencilRef, `${k} stencil ref`).toBe(SILHOUETTE_STENCIL_REF);
      expect(p.blend, `${k} blends`).toBeDefined();
    }
    expect(pipelineOf(twin('tube'), meshes.tube.mesh).cullMode).toBe('back');
    expect(pipelineOf(twin('tube'), meshes.tube.mesh).frontFace).toBe('cw'); // BackSide flips the winding
    expect(pipelineOf(twin('figure'), meshes.figure.mesh).frontFace).toBe('ccw');
  });

  it('collar and beam keep their own state: the collar depth-tested and not writing, the beam always passing, neither with a stencil test', async () => {
    const { meshes, twin } = await adopted();
    const c = pipelineOf(twin('collar'), meshes.collar.mesh);
    expect(c.depthStencil.depthCompare).toBe('less-equal');
    expect(c.depthStencil.depthWriteEnabled).toBe(false);
    expect(c.depthStencil.stencilFront?.compare ?? 'always').toBe('always');
    const b = pipelineOf(twin('beam'), meshes.beam.mesh);
    expect(b.depthStencil.depthCompare).toBe('always');
    expect(b.depthStencil.depthWriteEnabled).toBe(false);
    expect(b.depthStencil.stencilFront?.compare ?? 'always').toBe('always');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// R12: every other input, one gate each; the writers; the seam.

describe('R12: each attribute, uniform and legacy field is wired', () => {
  it('tube: aS, aRoute and aKind reach varyings; every colour uniform is read; the grazing term uses the world normal and uToCam', async () => {
    const { tube, bound } = await adopted();
    const { vertex, glsl, used } = await compileMesh(tube);
    for (const a of ['aS', 'aRoute', 'aKind']) expect(vertex, `${a} never reaches a varying`).toMatch(new RegExp(`nodeVarying\\d+ = ${a};`));
    const b = bound('tube');
    for (const k of ['uRim', 'uCore', 'uHot', 'uToCam', 'uTime'] as const) expect(used.has(b[k]), `${k} is bound but the graph never reads it`).toBe(true);
    expect(glsl).toMatch(/abs\( dot\( normalWorldGeometry, nodeUniform\d+ \) \)/);
    // The faint fragment is discarded: strength*reveal under 0.003 AND the edge under 0.01.
    expect(glsl).toMatch(/if \( \( ! \( max\( step\( 0\.003, nodeVar\d+ \), step\( 0\.01, nodeVar\d+ \) \) > 0\.5 \) \) \) \{\s*discard;/);
    // The four colour/direction uniforms are four distinct nodes.
    expect(new Set([b.uRim, b.uCore, b.uHot, b.uToCam]).size).toBe(4);
  });

  it('the colours are the legacy vectors BY REFERENCE: a write in place reaches the node', async () => {
    const { meshes, bound } = await adopted();
    const l = meshes.tube.legacy.uniforms;
    const b = bound('tube');
    for (const k of ['uRim', 'uCore', 'uHot', 'uToCam'] as const) {
      expect((b[k] as unknown as Updatable).value, k).toBe(l[k].value);
    }
    expect((bound('figure').uFig as unknown as Updatable).value).toBe(meshes.figure.legacy.uniforms.uFig.value);
    expect((bound('beam').uRim as unknown as Updatable).value).toBe(meshes.beam.legacy.uniforms.uRim.value);
    expect((bound('beam').uHot as unknown as Updatable).value).toBe(meshes.beam.legacy.uniforms.uHot.value);
  });

  it('collar: aS, aRoute and aKind reach varyings; uRim, uHot and uTime are read; the breath is sin(uTime * 3.4) behind aKind > 0.5', async () => {
    const { collars, bound } = await adopted();
    const { vertex, glsl, used } = await compileMesh(collars);
    for (const a of ['aS', 'aRoute', 'aKind']) expect(vertex, `${a} never reaches a varying`).toMatch(new RegExp(`nodeVarying\\d+ = ${a};`));
    const b = bound('collar');
    for (const k of ['uRim', 'uHot', 'uTime'] as const) expect(used.has(b[k]), `${k} is bound but the graph never reads it`).toBe(true);
    const kind = /(nodeVarying\d+) = aKind;/.exec(vertex) as RegExpExecArray;
    expect(glsl).toContain(`if ( ( 0.5 < ${kind[1]} ) )`);
    expect(glsl).toMatch(/0\.65 \+ \( 0\.35 \* sin\( \( nodeUniform\d+ \* 3\.4 \) \) \)/);
    expect(glsl).toContain('discard;');
  });

  it('figure: aAlpha gates (discard under 0.01) and scales alpha; uFig and uToCam are read; the instance matrix reaches the normal', async () => {
    const { meshes, bound } = await adopted();
    const { vertex, glsl, used } = await compileMesh(meshes.figure.mesh);
    const alpha = /(nodeVarying\d+) = aAlpha;/.exec(vertex);
    expect(alpha, 'aAlpha never reaches a varying').not.toBeNull();
    expect(glsl).toContain(`step( 0.01, ${(alpha as RegExpExecArray)[1]} )`);
    expect(glsl).toContain('DiffuseColor.w = ( DiffuseColor.w * ( ' + (alpha as RegExpExecArray)[1] + ' * ( 0.62 + ( 0.38 * ');
    const b = bound('figure');
    for (const k of ['uFig', 'uToCam'] as const) expect(used.has(b[k]), `${k} is bound but the graph never reads it`).toBe(true);
    // An InstancedMesh: the position AND the normal go through the instance transform.
    expect(vertex).toMatch(/positionLocal = \( buffer\d+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
    expect(vertex).toMatch(/normalLocal = normalize\( \( transpose\( inverse\( mat3\( buffer\d+\[ uint\( gl_InstanceID \) \]\[ 0 \]/);
  });

  it('beam: the gradient is the cylinder\'s own position.y; uRim, uHot and uA are read; it never discards', async () => {
    const { meshes, bound } = await adopted();
    const { glsl, used } = await compileMesh(meshes.beam.mesh);
    expect(glsl).toMatch(/mix\( nodeUniform\d+, nodeUniform\d+, positionLocal\.y \)/);
    expect(glsl).toMatch(/\( 0\.35 \+ \( 0\.65 \* positionLocal\.y \) \)/);
    const b = bound('beam');
    for (const k of ['uRim', 'uHot', 'uA'] as const) expect(used.has(b[k]), `${k} is bound but the graph never reads it`).toBe(true);
    expect(glsl).not.toContain('discard');
    // hot at the finder (y 0), rim at the route (y 1): the order of the two mix arguments.
    const names = (await compileMesh(meshes.beam.mesh)).names;
    expect(glsl).toContain(`mix( ${names.get(b.uHot)}, ${names.get(b.uRim)}, positionLocal.y )`);
  });

  it('the factory refuses a legacy material that lacks the uniform its style reads, and names the style', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const deps = { W, TSL: TSL as never, maths: MATERIAL_MATHS.xray };
    expect(() => createNodeXrayMaterial(deps, new THREE.ShaderMaterial({ uniforms: {} }), 'beam')).toThrow(/beam.*uRim/);
    expect(() => createNodeXrayMaterial(deps, new THREE.ShaderMaterial({ uniforms: {} }), 'tube')).toThrow(/tube/);
  });
});

describe('the writers act on the LEGACY record the twin reads, and on the mesh', () => {
  it('after adoption mesh.material is the twin, and legacyMaterialOf(mesh) is the record TunnelXray.update writes', async () => {
    const { xray, meshes, twin } = await adopted();
    for (const k of ['tube', 'collar', 'figure', 'beam'] as const) {
      expect(twin(k)).not.toBe(meshes[k].legacy);
      expect(legacyMaterialOf(meshes[k].mesh as THREE.Mesh & { material: THREE.ShaderMaterial })).toBe(meshes[k].legacy);
    }
    xray.update(3.25, []);
    expect(meshes.tube.legacy.uniforms.uTime.value).toBe(3.25);
    expect(meshes.collar.legacy.uniforms.uTime.value).toBe(3.25);
  });

  it('uTime written by update() reaches BOTH twins (tube and collar share one record)', async () => {
    const { xray, bound } = await adopted();
    xray.update(1.5, []);
    for (const k of ['tube', 'collar'] as const) {
      const n = bound(k).uTime as unknown as Updatable;
      tick(n);
      expect(n.value, k).toBe(1.5);
    }
  });

  it('the visibility writers act on the MESHES: hidden by the debug layer and shown by update, with the twin\'s own flag left alone', async () => {
    const { xray, meshes, twin } = await adopted();
    xray.clock.setRoute(0, 2, true, 0);
    xray.discover(0, 0, null);
    for (let t = 0; t <= 2; t += 0.1) {
      xray.clock.setRoute(0, 2, true, t);
      xray.update(t, [[0, 5]]);
    }
    for (const k of ['tube', 'collar', 'figure'] as const) expect(meshes[k].mesh.visible, `${k} shown`).toBe(true);
    expect(xray.setDebugHidden(true)).toBe(4);
    xray.update(2.1, [[0, 5]]);
    for (const k of ['tube', 'collar', 'figure', 'beam'] as const) {
      expect(meshes[k].mesh.visible, `${k} hidden by the layer`).toBe(false);
      // The writer never touched the material: the twin stays visible for the mirror to carry, and the legacy record too.
      expect(twin(k).visible, `${k} twin`).toBe(true);
      expect(meshes[k].legacy.visible, `${k} legacy`).toBe(true);
    }
    xray.setDebugHidden(false);
    xray.update(2.2, [[0, 5]]);
    for (const k of ['tube', 'collar', 'figure'] as const) expect(meshes[k].mesh.visible, `${k} shown again`).toBe(true);
  });
});

describe('the seam: names, slots, census', () => {
  it('the four legacy materials are named rl-xray-*, on the xray slot, and listed as ported', () => {
    const { xray } = built();
    const mats = [xray.figures.material, xray.beam.material, ...(xray.group.children as THREE.Mesh[]).map((m) => m.material)] as THREE.ShaderMaterial[];
    const names = new Set(mats.map((m) => m.name));
    expect(names).toEqual(new Set(['rl-xray-tube', 'rl-xray-collar', 'rl-xray-figure', 'rl-xray-beam']));
    for (const m of mats) {
      expect(legacyTwinSlot(m), m.name).toBe('xray');
      expect(PORTED_MATERIAL_KEYS.has(m.name), m.name).toBe(true);
      expect(XRAY_STYLE_BY_NAME[m.name], m.name).toBeDefined();
    }
  });

  it('an adopted x-ray leaves the node census nothing to hide; an unadopted one names all four (the L-matched read keeps them drawn)', async () => {
    const plain = built();
    const scene = new THREE.Scene();
    scene.add(plain.xray.group);
    expect(censusUnported(scene).map((h) => h.key).sort()).toEqual(['rl-xray-beam', 'rl-xray-collar', 'rl-xray-figure', 'rl-xray-tube']);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    const a = await adopted();
    const s2 = new THREE.Scene();
    s2.add(a.xray.group);
    expect(censusUnported(s2)).toEqual([]);
  });

  it('a rebuilt route set adopts onto the same twin: the legacy material is reused, so the twin cache hits', async () => {
    const xray = new TunnelXray(COLORS);
    const kit = await kitOf();
    const cache = createTwinCache();
    xray.build([route(10)], () => 0);
    adoptMaterials(xray.group, kit, cache);
    const tubeOf = (): THREE.Mesh => (xray.group.children as THREE.Mesh[]).find((m) => m.geometry.getAttribute('aS') !== undefined && m.geometry.getAttribute('aKind') !== undefined && (legacyMaterialOf(m as THREE.Mesh & { material: THREE.ShaderMaterial }).name === 'rl-xray-tube')) as THREE.Mesh;
    const first = tubeOf();
    const twin = first.material;
    xray.build([route(10), route(6)], () => 0);
    const second = tubeOf();
    expect(second).not.toBe(first);
    // The new mesh holds the legacy material until adoption, then the very same twin.
    expect((second.material as THREE.Material).name).toBe('rl-xray-tube');
    adoptMaterials(xray.group, kit, cache);
    expect(second.material).toBe(twin);
  });
});
