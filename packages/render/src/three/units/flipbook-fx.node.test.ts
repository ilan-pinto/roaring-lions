/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T12) gates for `flipbook-fx.node.ts`, the flipbook's smoke and fire passes. The maths runs on numbers against LITERALS
 * (a hand transcription of the legacy VERT/FRAG, `_coord/webgpu-p3/tmp-t12/frag_literals.py`, generated once and committed); the
 * wiring runs on the generated program text and the graph's own inputs (three's `GLSLNodeBuilder` / `WGSLNodeBuilder`, no GPU), each
 * input by input. Each spec names the one-line mutation that turns it red in the commit message.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { censusUnported } from '../backend/unported';
import { adoptMaterials, createTwinCache } from '../node-material-adoption';
import { isTwin, legacyMaterialOf } from '../twin-identity';
import { assertNoImplicitSampleInConditional } from '../sample-uniformity';
import { HDR_GAINS } from './hdr-gains';
import {
  FLIPBOOK_FIT,
  FLIPBOOK_OIL_CROWN,
  FLIPBOOK_SMOKE_ALPHA,
  FlipbookFx,
  flipbookAliveOps,
  flipbookCoverOps,
  flipbookMotionOps,
  flipbookShadeOps,
  type Tap4,
} from './flipbook-fx';
import { createNodeFlipbookMaterial, FLIPBOOK_FIRE_LEGACY_NAME, VFX_TEXTURES_KEY, type FlipbookMaths, type LateTexture } from './flipbook-fx.node';
import { FX_BOUND_KEY, type FxTwinBound, type HasUniforms } from './fx.node';
import { adoptFx, compileFx, compileWgsl, fxKit, maths, webgpuModules, type Updatable } from './fx-twin-test-kit';
import { copyRenderState } from '../twin-identity';
import type { vfxBillboardOps } from './vfx-noise';

// jsdom has no ImageBitmap; three's texture-node update tests `image instanceof ImageBitmap`.
(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const o = NUMBER_OPS;
const boundOf = (m: THREE.Material): FxTwinBound => m.userData[FX_BOUND_KEY] as FxTwinBound;
const texturesOf = (m: THREE.Material): Record<string, LateTexture> => m.userData[VFX_TEXTURES_KEY] as Record<string, LateTexture>;
const upd = (n: unknown): Updatable => n as Updatable;

/** [vUv.x, vUv.y, vT, vType, vSeed, vAge, vTint, vWhite, [r, g, b, alpha] or null (discarded)]. */
const FRAG_CASES: ReadonlyArray<readonly [number, number, number, number, number, number, number, number, readonly number[] | null]> = [
  [0.1, -0.2, 0.05, 0.0, 0.31, 0.06, 0.0, 0.0, [3.918569850240, 1.809297285161, 0.556409922778, 0.741689893873]],
  [0.3, 0.25, 0.3, 0.0, 0.77, 0.36, 0.0, 0.0, [0.694418805723, 0.144895248370, 0.040574230479, 0.684968875335]],
  [-0.4, 0.1, 0.7, 0.0, 0.12, 0.84, 0.0, 0.0, null],
  [0.2, 0.2, 0.2, 1.0, 0.43, 0.8, 0.0, 0.0, [0.041844361064, 0.036332368010, 0.030454858175, 0.404024448152]],
  [-0.1, -0.3, 0.05, 1.0, 0.58, 0.2, -0.8, 0.0, [0.371229310196, 0.087121741639, 0.031098506173, 0.875925925926]],
  [0.35, -0.1, 0.6, 1.0, 0.9, 2.4, -1.0, 0.0, [0.013608333333, 0.011590277778, 0.009509722222, 0.970000000000]],
  [0.0, 0.3, 0.4, 1.0, 0.25, 1.6, 0.0, 0.9, [0.777700004586, 0.758330668960, 0.719977073963, 0.309639294809]],
  [0.25, 0.05, 0.3, 1.0, 0.66, 1.2, 0.7, 0.0, [0.271321856000, 0.222675478519, 0.163784346074, 0.850000000000]],
  [-0.2, 0.15, 0.25, 2.0, 0.05, 0.25, 0.0, 0.0, [0.158206964606, 0.128758319608, 0.092747583679, 0.950000000000]],
  [0.15, 0.1, 0.5, 2.0, 0.81, 0.5, 0.0, 0.0, [0.521640126389, 0.436963474938, 0.312345006766, 0.927873779113]],
  [0.3, -0.4, 0.2, 3.0, 0.5, 0.1, 0.0, 0.0, [4.000000000000, 2.508454810496, 1.344606413994, 0.864815657715]],
  [-0.5, 0.6, 0.85, 3.0, 0.2, 0.4, 0.0, 0.0, [2.400000000000, 0.480000000000, 0.120000000000, 0.132003445427]],
  [0.8, 0.7, 0.3, 1.0, 0.4, 0.3, 0.0, 0.0, null],
  [0.7, 0.6, 0.98, 0.0, 0.33, 1.0, 0.0, 0.0, [0.208156038535, 0.201204482431, 0.187317647081, 0.001358502308]],
  [0.6, -0.6, 0.95, 1.0, 0.71, 7.0, 0.0, 0.0, [0.252454067013, 0.244008675825, 0.227155712975, 0.001245230558]],
  [0.0, 0.0, 0.5, 0.0, 0.5, 0.5, 0.0, 0.0, [0.022293899978, 0.018578249981, 0.014862599985, 0.353031399087]],
  [0.1, -0.1, 0.8, 1.0, 0.45, 3.2, -1.0, 0.0, [0.147220370370, 0.140361419753, 0.129083024691, 0.523254118676]],
  [-0.15, 0.2, 0.7, 1.0, 0.29, 2.8, -0.5, 0.0, [0.174500086099, 0.166517053235, 0.153258941666, 0.084772365101]],
];
/** [t, ageS, type, scale, ox, oy, oz, vx, vy, vz, x, y, z, size]. */
const MOTION: ReadonlyArray<readonly number[]> = [
  [0.1, 0.12, 0.0, 1.4, 3.0, 1.0, 5.0, 0.8, 2.0, -0.4, 3.076243321639, 1.244608304097, 4.961878339181, 1.568560000000],
  [0.6, 0.9, 0.0, 2.0, -1.0, 0.5, 2.0, 0.0, 1.0, 0.3, -1.000000000000, 1.148169069388, 2.072950720816, 3.000000000000],
  [0.3, 1.5, 1.0, 1.1, 4.0, 0.2, 6.0, 0.5, 0.6, -0.2, 4.497792129908, 0.947350555889, 5.920883148037, 1.388243257232],
  [0.9, 8.1, 1.0, 1.7, 0.0, 0.0, 0.0, -0.3, 0.1, 0.4, 0.560015017500, 1.865328327500, 0.657313310000, 3.031590088692],
  [0.2, 0.3, 2.0, 0.6, 2.0, 1.0, 3.0, 1.2, 3.0, 0.7, 2.360000000000, 1.459000000000, 3.210000000000, 0.511495341570],
  [0.8, 1.2, 2.0, 0.6, 2.0, 1.0, 3.0, 1.2, 3.0, 0.7, 3.440000000000, 1.000000000000, 3.840000000000, 0.752990683140],
  [0.4, 0.2, 3.0, 0.15, 1.0, 2.0, 1.0, 2.0, 4.0, -1.0, 1.400000000000, 2.672000000000, 0.800000000000, 0.150000000000],
  [0.95, 1.9, 3.0, 0.15, 1.0, 2.0, 1.0, 2.0, 4.0, -1.0, 4.800000000000, 2.000000000000, -0.900000000000, 0.150000000000],
];
/** [t, type, firePass, drawn]. */
const ALIVE: ReadonlyArray<readonly number[]> = [
  [-0.1, 0.0, 0.0, 0],
  [-0.1, 0.0, 1.0, 0],
  [-0.1, 1.0, 0.0, 0],
  [-0.1, 1.0, 1.0, 0],
  [-0.1, 2.0, 0.0, 0],
  [-0.1, 2.0, 1.0, 0],
  [-0.1, 3.0, 0.0, 0],
  [-0.1, 3.0, 1.0, 0],
  [0.0, 0.0, 0.0, 0],
  [0.0, 0.0, 1.0, 1],
  [0.0, 1.0, 0.0, 1],
  [0.0, 1.0, 1.0, 0],
  [0.0, 2.0, 0.0, 1],
  [0.0, 2.0, 1.0, 0],
  [0.0, 3.0, 0.0, 0],
  [0.0, 3.0, 1.0, 1],
  [0.5, 0.0, 0.0, 0],
  [0.5, 0.0, 1.0, 1],
  [0.5, 1.0, 0.0, 1],
  [0.5, 1.0, 1.0, 0],
  [0.5, 2.0, 0.0, 1],
  [0.5, 2.0, 1.0, 0],
  [0.5, 3.0, 0.0, 0],
  [0.5, 3.0, 1.0, 1],
  [1.0, 0.0, 0.0, 0],
  [1.0, 0.0, 1.0, 1],
  [1.0, 1.0, 0.0, 1],
  [1.0, 1.0, 1.0, 0],
  [1.0, 2.0, 0.0, 1],
  [1.0, 2.0, 1.0, 0],
  [1.0, 3.0, 0.0, 0],
  [1.0, 3.0, 1.0, 1],
  [1.2, 0.0, 0.0, 0],
  [1.2, 0.0, 1.0, 0],
  [1.2, 1.0, 0.0, 0],
  [1.2, 1.0, 1.0, 0],
  [1.2, 2.0, 0.0, 0],
  [1.2, 2.0, 1.0, 0],
  [1.2, 3.0, 0.0, 0],
  [1.2, 3.0, 1.0, 0],
];

/** The uniform values the literals were read at (the transcription's `U`), spelled out. */
const U = {
  hot: [1.0, 0.9, 0.7], fire: [1.0, 0.45, 0.1], ember: [0.6, 0.12, 0.03], soot: [0.03, 0.025, 0.02], smoke: [0.3, 0.29, 0.27],
  dirt: [0.5, 0.42, 0.3], dirtDark: [0.28, 0.22, 0.16], white: [0.82, 0.8, 0.76], whiteShade: [0.31, 0.3, 0.29],
  fireGain: 6.0, sparkGain: 4.0, light: 0.9, smokeAlpha: 0.85, oilCrown: 0.15, sun: [-0.6, 0.8],
  fireFit: [0.675, 1.5, 12.0, 28.0], smokeFit: [0.625, 2.2, 10.0, 20.0], fireNoise: [2.6, 1.1, 1.0], smokeNoise: [1.7, 0.7, 1.0],
} as const;
const fract = (x: number): number => x - Math.floor(x);
/** The stand-in atlases the literals were read through (the transcription's `fire_atlas` / `smoke_atlas`). */
const fireAtlas = (u: number, v: number): Tap4<number> => ({ r: fract(u * 5.3 + v * 2.1), g: fract(u * 1.7 + v * 4.9), b: fract(u * 3.3 + v * 0.7), a: fract(u * 0.9 + v * 6.1) });
const smokeAtlas = (u: number, v: number): Tap4<number> => ({ r: fract(u * 4.1 + v * 3.7), g: fract(u * 2.9 + v * 1.3), b: fract(u * 0.6 + v * 5.5), a: fract(u * 6.7 + v * 0.4) });

/** The fragment on numbers: cover, then the four taps, then shade per colour channel. null where it discards. */
function frag(c: ReadonlyArray<number | readonly number[] | null>): number[] | null {
  const [ux, uy, t, type, seed, age, tint, white] = c as [number, number, number, number, number, number, number, number];
  const fit = (f: readonly number[]) => ({ zoom: f[0] as number, gain: f[1] as number, k0: f[2] as number, k1: f[3] as number });
  const nz = (f: readonly number[]) => ({ freq: f[0] as number, disp: f[1] as number, amp: f[2] as number });
  const uv = { x: ux, y: uy };
  const cover = flipbookCoverOps(o, { uv, seed, age, t, type, fireFit: fit(U.fireFit), smokeFit: fit(U.smokeFit), fireNoise: nz(U.fireNoise), smokeNoise: nz(U.smokeNoise) });
  const out: number[] = [];
  let keep = 1;
  let alpha = 0;
  for (let ch = 0; ch < 3; ch++) {
    const col = (k: keyof typeof U): number => (U[k] as readonly number[])[ch] as number;
    const s = flipbookShadeOps(o, {
      cover,
      fire0: fireAtlas(cover.uv0.x, cover.uv0.y), fire1: fireAtlas(cover.uv1.x, cover.uv1.y),
      smoke0: smokeAtlas(cover.uv0.x, cover.uv0.y), smoke1: smokeAtlas(cover.uv1.x, cover.uv1.y),
      uv, t, type, tint, whiteAmount: white, age, seed,
      colors: { hot: col('hot'), fire: col('fire'), ember: col('ember'), soot: col('soot'), smoke: col('smoke'), dirt: col('dirt'), dirtDark: col('dirtDark'), white: col('white'), whiteShade: col('whiteShade') },
      fireGain: U.fireGain, sparkGain: U.sparkGain, light: U.light, smokeAlpha: U.smokeAlpha, oilCrown: U.oilCrown, sun: { x: U.sun[0], y: U.sun[1] },
    });
    out.push(s.col);
    keep = s.keep;
    alpha = s.alpha;
  }
  return keep === 0 ? null : [...out, alpha];
}

describe('the flipbook maths on numbers (literal readings of the legacy GLSL)', () => {
  it('the fragment: fire, soot, oil, white HE, dust, dirt, spark, and both discards', () => {
    expect(FRAG_CASES.filter((c) => c[8] === null).length, 'both discards are read').toBeGreaterThanOrEqual(2);
    for (const c of FRAG_CASES) {
      const want = c[8];
      const got = frag(c);
      if (want === null) {
        expect(got, `case ${c.slice(0, 8).join(',')} discards`).toBeNull();
        continue;
      }
      expect(got, `case ${c.slice(0, 8).join(',')} draws`).not.toBeNull();
      for (let i = 0; i < 4; i++) expect((got as number[])[i], `case ${c.slice(0, 8).join(',')} channel ${i}`).toBeCloseTo(want[i] as number, 9);
    }
  });

  it('the vertex stage: the four motion models (centre and size)', () => {
    for (const m of MOTION) {
      const [t, age, type, scale, ox, oy, oz, vx, vy, vz, x, y, z, size] = m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      const p = flipbookMotionOps(o, { t, age, type, scale, origin: { x: ox, y: oy, z: oz }, vel: { x: vx, y: vy, z: vz } });
      expect(p.x, `x ${m.slice(0, 4)}`).toBeCloseTo(x, 12);
      expect(p.y, `y ${m.slice(0, 4)}`).toBeCloseTo(y, 12);
      expect(p.z, `z ${m.slice(0, 4)}`).toBeCloseTo(z, 12);
      expect(p.size, `size ${m.slice(0, 4)}`).toBeCloseTo(size, 12);
    }
  });

  it('the collapse: dead, or the other pass\'s type', () => {
    for (const [t, type, firePass, drawn] of ALIVE as Array<[number, number, number, number]>) {
      expect(flipbookAliveOps(o, t, type, firePass), `t ${t} type ${type} pass ${firePass}`).toBe(drawn);
    }
  });
});

/** A flipbook with its two legacy materials, and a twin of `pass` built on a SPY of the maths (calls through). */
async function spied(pass: 'smoke' | 'fire') {
  const { W, TSL } = await webgpuModules();
  const fx = new FlipbookFx(16);
  const mesh = pass === 'fire' ? fx.fireMesh : fx.mesh;
  const legacy = mesh.material as unknown as HasUniforms;
  const seen: {
    motion?: Parameters<typeof flipbookMotionOps>[1];
    alive?: unknown[];
    cover?: Parameters<typeof flipbookCoverOps>[1];
    shade?: Parameters<typeof flipbookShadeOps>[1];
    billboard?: Parameters<typeof vfxBillboardOps>;
  } = {};
  const spy: FlipbookMaths = {
    motionOps: ((op, i) => ((seen.motion = i as never), maths.flipbook.motionOps(op, i))) as typeof flipbookMotionOps,
    aliveOps: ((op, t, ty, fp) => ((seen.alive = [t, ty, fp]), maths.flipbook.aliveOps(op, t, ty, fp))) as typeof flipbookAliveOps,
    coverOps: ((op, i) => ((seen.cover = i as never), maths.flipbook.coverOps(op, i))) as typeof flipbookCoverOps,
    shadeOps: ((op, i) => ((seen.shade = i as never), maths.flipbook.shadeOps(op, i))) as typeof flipbookShadeOps,
    billboardOps: ((...a: Parameters<typeof vfxBillboardOps>) => ((seen.billboard = a as never), maths.flipbook.billboardOps(...a))) as typeof vfxBillboardOps,
    softOps: maths.flipbook.softOps,
  };
  const twin = createNodeFlipbookMaterial({ W, TSL, maths: spy }, legacy, pass);
  copyRenderState(legacy, twin);
  mesh.material = twin as never;
  return { fx, mesh, legacy, twin, seen };
}

type Split = { node?: unknown; components?: string };
const split = (n: unknown): Split => n as Split;

describe('G3: each input is wired to its legacy record (the graph\'s own inputs, input by input)', () => {
  it('every uniform the fragment reads is the node bound to that legacy uniform, in the slot the shader reads it in', async () => {
    const { mesh, twin, seen } = await spied('smoke');
    await compileFx(mesh);
    const b = boundOf(twin);
    const s = seen.shade;
    expect(s, 'the fragment maths ran').toBeDefined();
    if (s === undefined) return;
    const slots: Array<[unknown, string]> = [
      [s.fireGain, 'uFireGain'], [s.sparkGain, 'uSparkGain'], [s.light, 'uLight'], [s.smokeAlpha, 'uSmokeAlpha'], [s.oilCrown, 'uOilCrown'],
      [s.colors.hot, 'uHot'], [s.colors.fire, 'uFire'], [s.colors.ember, 'uEmber'], [s.colors.soot, 'uSoot'], [s.colors.smoke, 'uSmoke'],
      [s.colors.dirt, 'uDirt'], [s.colors.dirtDark, 'uDirtDark'], [s.colors.white, 'uWhite'], [s.colors.whiteShade, 'uWhiteShade'],
    ];
    for (const [node, key] of slots) expect(node, key).toBe(b[key]);
    expect(split(s.sun.x).node, 'uSun.x').toBe(b.uSun);
    expect(split(s.sun.x).components).toBe('x');
    expect(split(s.sun.y).node, 'uSun.y').toBe(b.uSun);
    expect(split(s.sun.y).components).toBe('y');
  });

  it('the fits and the billow noise reach the cover in their own components (uFireFit, uSmokeFit, uFireNoise, uSmokeNoise)', async () => {
    const { mesh, twin, seen } = await spied('fire');
    await compileFx(mesh);
    const b = boundOf(twin);
    const c = seen.cover;
    expect(c).toBeDefined();
    if (c === undefined) return;
    const want: Array<[unknown, string, string]> = [
      [c.fireFit.zoom, 'uFireFit', 'x'], [c.fireFit.gain, 'uFireFit', 'y'], [c.fireFit.k0, 'uFireFit', 'z'], [c.fireFit.k1, 'uFireFit', 'w'],
      [c.smokeFit.zoom, 'uSmokeFit', 'x'], [c.smokeFit.gain, 'uSmokeFit', 'y'], [c.smokeFit.k0, 'uSmokeFit', 'z'], [c.smokeFit.k1, 'uSmokeFit', 'w'],
      [c.fireNoise.freq, 'uFireNoise', 'x'], [c.fireNoise.disp, 'uFireNoise', 'y'], [c.fireNoise.amp, 'uFireNoise', 'z'],
      [c.smokeNoise.freq, 'uSmokeNoise', 'x'], [c.smokeNoise.disp, 'uSmokeNoise', 'y'], [c.smokeNoise.amp, 'uSmokeNoise', 'z'],
    ];
    for (const [n, key, comp] of want) {
      expect(split(n).node, `${key}.${comp}`).toBe(b[key]);
      expect(split(n).components, `${key}.${comp}`).toBe(comp);
    }
  });

  it('the atlases: the fire taps read uFireAtlas and the smoke taps uSmokeAtlas, each at both frames (as statements, `toVar`)', async () => {
    const { mesh, twin, seen } = await spied('fire');
    await compileFx(mesh);
    const tex = texturesOf(twin);
    const s = seen.shade;
    expect(s).toBeDefined();
    if (s === undefined) return;
    const tapOf = (t: Tap4<unknown>): unknown => (split(t.r).node as { node?: unknown }).node;
    expect(tex.uFireAtlas?.taps).toHaveLength(2);
    expect(tex.uSmokeAtlas?.taps).toHaveLength(2);
    expect(tapOf(s.fire0 as Tap4<unknown>)).toBe(tex.uFireAtlas?.taps[0]);
    expect(tapOf(s.fire1 as Tap4<unknown>)).toBe(tex.uFireAtlas?.taps[1]);
    expect(tapOf(s.smoke0 as Tap4<unknown>)).toBe(tex.uSmokeAtlas?.taps[0]);
    expect(tapOf(s.smoke1 as Tap4<unknown>)).toBe(tex.uSmokeAtlas?.taps[1]);
    for (const [ch, comp] of [['r', 'x'], ['g', 'y'], ['b', 'z'], ['a', 'w']] as const) expect(split((s.fire0 as Tap4<unknown>)[ch]).components).toBe(comp);
  });

  it('the vertex stage: uTime, uQuadScale and uFirePass are the record\'s, read in the vertex program; the attributes all wired', async () => {
    const { mesh, twin, seen } = await spied('fire');
    const c = await compileFx(mesh);
    const b = boundOf(twin);
    for (const key of ['uTime', 'uQuadScale', 'uFirePass']) expect(c.uniforms.has(b[key]), key).toBe(true);
    expect(seen.alive?.[2], 'aliveOps reads uFirePass').toBe(b.uFirePass);
    for (const a of ['aOrigin', 'aVel', 'aParams', 'aSeed', 'aTint', 'aWhite']) expect(c.vertex, a).toContain(a);
    // The motion model reads the attribute components it is handed: aParams.z the scale, aParams.w the type.
    expect(split(seen.motion?.scale).components).toBe('z');
    expect(split(seen.motion?.type).components).toBe('w');
    expect(split(seen.motion?.origin.y).components).toBe('y');
    expect(split(seen.motion?.vel.z).components).toBe('z');
    // The billboard: right and up are the view matrix's ROWS (element i's x, then its y), the quad scale the record's, lift 0.32.
    const bb = seen.billboard;
    expect(bb).toBeDefined();
    if (bb === undefined) return;
    const [, , right, up, corner, , quad, lift] = bb;
    const rowOf = (n: unknown): [number | undefined, string | undefined] => {
      const sp = split(n);
      const el = sp.node as { indexNode?: { value?: number } } | undefined;
      return [el?.indexNode?.value, sp.components];
    };
    expect([right.x, right.y, right.z].map(rowOf)).toEqual([[0, 'x'], [1, 'x'], [2, 'x']]);
    expect([up.x, up.y, up.z].map(rowOf)).toEqual([[0, 'y'], [1, 'y'], [2, 'y']]);
    expect([split(corner.x).components, split(corner.y).components], 'the quad corner is position.xy').toEqual(['x', 'y']);
    expect(quad).toBe(b.uQuadScale);
    expect(lift).toBe(0.32);
  });

  it('every bound uniform re-reads its legacy record each render (numbers replaced, vectors by reference)', async () => {
    const { legacy, twin } = await spied('fire');
    const b = boundOf(twin);
    const keys = ['uTime', 'uFirePass', 'uQuadScale', 'uFireFit', 'uSmokeFit', 'uFireNoise', 'uSmokeNoise', 'uLight', 'uSun', 'uFireGain', 'uSparkGain', 'uSmokeAlpha', 'uOilCrown',
      'uHot', 'uFire', 'uEmber', 'uSoot', 'uSmoke', 'uDirt', 'uDirtDark', 'uWhite', 'uWhiteShade'];
    for (const k of keys) {
      upd(b[k]).update();
      expect(upd(b[k]).value, k).toBe(legacy.uniforms[k]?.value);
    }
    // The shipped values: the fire pass, the HDR gains from the one table, the fits from FLIPBOOK_FIT.
    expect(legacy.name).toBe(FLIPBOOK_FIRE_LEGACY_NAME);
    expect(upd(b.uFirePass).value).toBe(1);
    expect(upd(b.uFireGain).value).toBe(HDR_GAINS.fireball);
    expect(upd(b.uSparkGain).value).toBe(HDR_GAINS.sparks);
    expect(upd(b.uSmokeAlpha).value).toBe(FLIPBOOK_SMOKE_ALPHA);
    expect(upd(b.uOilCrown).value).toBe(FLIPBOOK_OIL_CROWN);
    expect((upd(b.uFireFit).value as THREE.Vector4).toArray()).toEqual([FLIPBOOK_FIT.fire.zoom, FLIPBOOK_FIT.fire.gain, FLIPBOOK_FIT.fire.k0, FLIPBOOK_FIT.fire.k1]);
    // A number REPLACED on the record reaches the node on the next render.
    for (const k of ['uTime', 'uQuadScale', 'uFireGain', 'uSparkGain', 'uLight', 'uSmokeAlpha', 'uOilCrown']) {
      (legacy.uniforms[k] as { value: number }).value = 7.25;
      upd(b[k]).update();
      expect(upd(b[k]).value, k).toBe(7.25);
    }
  });

  it('the clock: none of its own (the frame clock is the record\'s uTime, re-read above)', async () => {
    for (const pass of ['smoke', 'fire'] as const) expect((await compileFx((await spied(pass)).mesh)).frameClocked, pass).toEqual([]);
  });
});

describe('the writers hold their legacy materials apart: after adoption every write reaches the twin', () => {
  it('step, setLighting, setColors and setAtlases write the legacy records; the twin reads them', async () => {
    const fx = new FlipbookFx(16);
    const scene = new THREE.Scene();
    scene.add(...fx.meshes);
    expect(adoptMaterials(scene, await fxKit(), createTwinCache())).toBe(2);
    for (const m of fx.meshes) expect(isTwin(m.material as unknown as THREE.Material)).toBe(true);
    fx.step(40);
    fx.setLighting(0.6, new THREE.Vector2(0.3, -0.4));
    fx.setColors(() => new THREE.Color(0.2, 0.4, 0.6));
    const fire = new THREE.Texture();
    const smoke = new THREE.Texture();
    fx.setAtlases(fire, smoke);
    for (const m of fx.meshes) {
      const twin = m.material as unknown as THREE.Material;
      const b = boundOf(twin);
      const legacy = legacyMaterialOf(m as unknown as { userData: Record<string, unknown>; material: THREE.Material }) as unknown as HasUniforms;
      expect(legacy).not.toBe(twin);
      for (const k of ['uTime', 'uLight', 'uSun', 'uHot']) upd(b[k]).update();
      expect(upd(b.uTime).value).toBe(40);
      expect(upd(b.uLight).value).toBe(0.6);
      expect((upd(b.uSun).value as THREE.Vector2).toArray()).toEqual([0.3, -0.4]);
      expect((upd(b.uHot).value as THREE.Color).toArray()).toEqual([0.2, 0.4, 0.6]);
      expect(texturesOf(twin).uFireAtlas?.taps[0]?.value).toBe(fire);
      expect(texturesOf(twin).uSmokeAtlas?.taps[1]?.value).toBe(smoke);
    }
  });
});

describe('G4: a late atlas is sampled', () => {
  it('built before the atlases land, the taps read a placeholder per atlas; after `setAtlases` the next render reads the atlases', async () => {
    const fx = new FlipbookFx(16);
    const twin = await adoptFx(fx.mesh);
    const tex = texturesOf(twin);
    const fireTaps = tex.uFireAtlas?.taps ?? [];
    const smokeTaps = tex.uSmokeAtlas?.taps ?? [];
    // Each list on its own: a sum could hide an atlas with no tap, and the loops below would then run zero times.
    expect(fireTaps).toHaveLength(2);
    expect(smokeTaps).toHaveLength(2);
    // Two DIFFERENT placeholders: three shares one binding between taps of the same texture, so one placeholder for both atlases
    // would compile them into one sampler.
    expect(fireTaps[0]?.value).toBe(tex.uFireAtlas?.placeholder);
    expect(smokeTaps[0]?.value).toBe(tex.uSmokeAtlas?.placeholder);
    expect(tex.uFireAtlas?.placeholder).not.toBe(tex.uSmokeAtlas?.placeholder);
    const p = tex.uFireAtlas?.placeholder as THREE.Texture;
    expect([p.minFilter, p.magFilter], 'filterable (a nearest placeholder compiles a textureLoad)').toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    const fire = new THREE.Texture();
    const smoke = new THREE.Texture();
    fx.setAtlases(fire, smoke);
    upd(boundOf(twin).uLight).update();
    for (const t of fireTaps) expect(t.value).toBe(fire);
    for (const t of smokeTaps) expect(t.value).toBe(smoke);
    // The atlas is the legacy record's: NoColorSpace, no premultiply, flipY (prepared by the legacy object).
    expect([fire.colorSpace, fire.premultiplyAlpha, fire.flipY]).toEqual([THREE.NoColorSpace, false, true]);
  });

  it('the program compiles two samplers, one per atlas', async () => {
    const fx = new FlipbookFx(16);
    await adoptFx(fx.fireMesh);
    const c = await compileFx(fx.fireMesh);
    const samplers = new Set([...c.fragment.matchAll(/\btexture\( (\w+),/g)].map((m) => m[1]));
    expect(samplers.size).toBe(2);
  });
});

describe('GH-1197: the per-instance alpha multiplier reaches the fragment', () => {
  it('both passes, GLSL and WGSL: `aAlpha` is read through a varying (the multiply by vAlpha is in the graph)', async () => {
    for (const pass of ['smoke', 'fire'] as const) {
      const fx = new FlipbookFx(16);
      const mesh = pass === 'fire' ? fx.fireMesh : fx.mesh;
      await adoptFx(mesh);
      expect((await compileFx(mesh)).vertex, `${pass} GLSL`).toContain('aAlpha');
      expect((await compileWgsl(mesh)).vertex, `${pass} WGSL`).toContain('aAlpha');
    }
  });
});

describe('G2: no implicit-gradient tap inside a branch (both atlases sampled unconditionally)', () => {
  it('GLSL and WGSL, both passes: the four taps are top-level statements', async () => {
    for (const pass of ['smoke', 'fire'] as const) {
      const fx = new FlipbookFx(16);
      const mesh = pass === 'fire' ? fx.fireMesh : fx.mesh;
      await adoptFx(mesh);
      const glsl = await compileFx(mesh);
      expect(glsl.fragment.match(/\btexture\(/g), `${pass}: four taps (non-vacuous)`).toHaveLength(4);
      expect(() => assertNoImplicitSampleInConditional(glsl.fragment), pass).not.toThrow();
      const wgsl = await compileWgsl(mesh);
      expect(wgsl.fragment.match(/\btextureSample\(/g), `${pass}: four WGSL taps`).toHaveLength(4);
      expect(wgsl.fragment, 'an unfiltered load: a placeholder bound at build was unfilterable').not.toMatch(/\btextureLoad\(/);
      expect(() => assertNoImplicitSampleInConditional(wgsl.fragment), `${pass} WGSL`).not.toThrow();
    }
  });
});

describe('the census: adopted, the flipbook draws through its twin on every frame', () => {
  it('idle, a spawn and its life: never census-hidden, never the legacy material', async () => {
    const fx = new FlipbookFx(16);
    const scene = new THREE.Scene();
    scene.add(...fx.meshes);
    adoptMaterials(scene, await fxKit(), createTwinCache());
    fx.setAtlases(new THREE.Texture(), new THREE.Texture());
    const frames: Array<() => void> = [
      () => fx.step(16),
      () => {
        fx.spawn({ x: 1, y: 0, z: 1, durationMs: 400, scale: 1, type: 0 });
        fx.spawn({ x: 1, y: 0, z: 1, durationMs: 900, scale: 1, type: 1 });
        fx.step(16);
      },
      () => fx.step(200),
      () => fx.step(0),
    ];
    const drawn: number[] = [];
    for (const f of frames) {
      f();
      expect(censusUnported(scene)).toEqual([]);
      drawn.push(fx.meshes.filter((m) => m.visible).length);
      for (const m of fx.meshes) expect(isTwin(m.material as unknown as THREE.Material)).toBe(true);
    }
    expect(drawn).toEqual([0, 2, 2, 2]);
  });
});
