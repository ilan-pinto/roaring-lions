/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T12) gates for `smoke-mesh.node.ts`, the smoke screen. The maths runs on numbers against LITERALS (a hand transcription
 * of the legacy fragment, `_coord/webgpu-p3/tmp-t12/frag_literals.py`, generated once and committed); the wiring runs on the
 * generated program text and the graph's own inputs, input by input. Each spec names its one-line mutation in the commit message.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from './fog-ops';
import { censusUnported } from './backend/unported';
import { assertNoImplicitSampleInConditional } from './sample-uniformity';
import { isTwin } from './twin-identity';
import { SmokeMesh, smokeScreenCoverOps, smokeScreenPuffOps, smokeScreenShadeOps } from './smoke-mesh';
import { createNodeSmokeScreenMaterial, smokeInstanceView, type SmokeScreenMaths } from './smoke-mesh.node';
import { fxDetailOf } from './units/fx-twins.node';
import { FX_BOUND_KEY, type FxTwinBound, type HasUniforms } from './units/fx.node';
import { VFX_TEXTURES_KEY, type LateTexture } from './units/flipbook-fx.node';
import { adoptFx, buildGlsl, compileFx, compileWgsl, maths, webgpuModules, type Updatable } from './units/fx-twin-test-kit';
import { copyRenderState } from './twin-identity';
import { VFX_HASH, vfxBillboardOps, type VfxDetail } from './units/vfx-noise';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const o = NUMBER_OPS;
const boundOf = (m: THREE.Material): FxTwinBound => m.userData[FX_BOUND_KEY] as FxTwinBound;
const texturesOf = (m: THREE.Material): Record<string, LateTexture> => m.userData[VFX_TEXTURES_KEY] as Record<string, LateTexture>;
const upd = (n: unknown): Updatable => n as Updatable;
const flat = new Uint8Array(8 * 8);
const smoked = (): Uint8Array => {
  const s = new Uint8Array(8 * 8);
  s[3 * 8 + 3] = 200;
  s[3 * 8 + 4] = 120;
  return s;
};

/** [vUv.x, vUv.y, vSeed, vAng, vAlpha, uClock, uReady, detail, [r, g, b, alpha] or null (discarded)]. */
const SMOKE_CASES: ReadonlyArray<readonly [number, number, number, number, number, number, number, number, readonly number[] | null]> = [
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 0.0, 0, [0.149015112726, 0.144332275831, 0.138907699294, 0.528000000000]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 0.0, 0, [0.261275823129, 0.253529029416, 0.243271625987, 0.459157482551]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 0.0, 0, [0.750677468550, 0.732588854850, 0.696411627450, 0.157771343923]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 0.0, 0, [0.118081546322, 0.114145494778, 0.110209443234, 0.023131543013]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 0.0, 0, null],
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 1.0, 0, [0.124443998417, 0.120295865136, 0.116147731856, 0.410442143650]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 1.0, 0, [0.108867150000, 0.105238245000, 0.101609340000, 0.920000000000]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 1.0, 0, [0.789116283043, 0.770101432849, 0.732071732461, 0.060950329637]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 1.0, 0, [0.118377065949, 0.114431163751, 0.110485261552, 0.051172208639]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 1.0, 0, null],
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 0.0, 1, [0.137225957102, 0.132913597348, 0.127918179813, 0.600277545944]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 0.0, 1, [0.260800535773, 0.253067834267, 0.242829090101, 0.476030307339]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 0.0, 1, [0.750677468550, 0.732588854850, 0.696411627450, 0.149183251895]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 0.0, 1, [0.118081546322, 0.114145494778, 0.110209443234, 0.024363527948]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 0.0, 1, null],
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 1.0, 1, [0.095708284895, 0.092518008732, 0.089327732569, 0.609893319669]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 1.0, 1, [0.108867150000, 0.105238245000, 0.101609340000, 0.920000000000]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 1.0, 1, [0.792746683411, 0.773644353690, 0.735439694248, 0.049103268351]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 1.0, 1, [0.119380542459, 0.115401191043, 0.111421839628, 0.059858101445]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 1.0, 1, null],
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 0.0, 2, [0.141251457000, 0.136812594913, 0.131670637662, 0.571207141421]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 0.0, 2, [0.260683588058, 0.252954354036, 0.242720201109, 0.478947250355]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 0.0, 2, [0.750677468550, 0.732588854850, 0.696411627450, 0.155009582923]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 0.0, 2, [0.118081546322, 0.114145494778, 0.110209443234, 0.024651884956]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 0.0, 2, null],
  [0.1, -0.3, 0.37, 0.8, 0.6, 1200.0, 1.0, 2, [0.105522851869, 0.102005423474, 0.098487995078, 0.529054738401]],
  [-0.5, 0.4, 0.82, -2.1, 0.9, 54321.0, 1.0, 2, [0.108867150000, 0.105238245000, 0.101609340000, 0.920000000000]],
  [0.2, 0.6, 0.05, 2.9, 0.3, 0.0, 1.0, 2, [0.790283748193, 0.771240766309, 0.733154802541, 0.057366546607]],
  [0.0, -0.85, 0.66, 0.1, 0.75, 9000.0, 1.0, 2, [0.119615415041, 0.115628234540, 0.111641054038, 0.061737572312]],
  [0.9, 0.5, 0.5, 1.0, 0.5, 100.0, 1.0, 2, null],
];

/** The record the literals were read at (the transcription's `SU`), spelled out, and its stand-in smoke atlas. */
const SU = { lit: [0.83, 0.81, 0.77], shade: [0.3, 0.29, 0.28], light: 0.95, sun: [0.7, 0.71] } as const;
const fract = (x: number): number => x - Math.floor(x);
const smokeAtlas = (u: number, v: number) => ({ r: fract(u * 4.1 + v * 3.7), g: fract(u * 2.9 + v * 1.3), b: fract(u * 0.6 + v * 5.5) });

function frag(c: ReadonlyArray<number | readonly number[] | null>): number[] | null {
  const [ux, uy, seed, ang, alpha, clock, ready, detail] = c as [number, number, number, number, number, number, number, VfxDetail];
  const uv = { x: ux, y: uy };
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const cover = smokeScreenCoverOps(o, { uv, cs, sn, seed, clock }, detail);
  const s = smokeAtlas(cover.uv.x, cover.uv.y);
  const out: number[] = [];
  let keep = 1;
  let a = 0;
  for (let ch = 0; ch < 3; ch++) {
    const r = smokeScreenShadeOps(o, { uv, cs, sn, b: cover.b, s, ready, alpha, lit: SU.lit[ch] as number, shade: SU.shade[ch] as number, light: SU.light, sun: { x: SU.sun[0], y: SU.sun[1] } });
    out.push(r.col);
    keep = r.keep;
    a = r.alpha;
  }
  return keep === 0 ? null : [...out, a];
}

describe('the smoke screen maths on numbers (literal readings of the legacy GLSL)', () => {
  it('the fragment at every FX_DETAIL, the atlas read and the procedural puff, and the discards', () => {
    expect(SMOKE_CASES.filter((c) => c[8] === null).length).toBeGreaterThan(0);
    for (const c of SMOKE_CASES) {
      const want = c[8];
      const got = frag(c);
      const tag = c.slice(0, 8).join(',');
      if (want === null) {
        expect(got, tag).toBeNull();
        continue;
      }
      expect(got, tag).not.toBeNull();
      for (let i = 0; i < 4; i++) expect((got as number[])[i], `${tag} channel ${i}`).toBeCloseTo(want[i] as number, 9);
    }
  });

  it('the puff from its instance matrix: half the mean of the two axes, the angle of the x axis', () => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(3, 1, 5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6), new THREE.Vector3(1.3 * 0.7, 1, 0.7));
    const e = m.elements;
    const p = smokeScreenPuffOps(o, { x: e[0] as number, y: e[1] as number, z: e[2] as number }, { x: e[8] as number, y: e[9] as number, z: e[10] as number });
    // `0.5 * (length(instanceMatrix[0].xyz) + length(instanceMatrix[2].xyz))`, `atan(ax.z, ax.x)`: a yaw of 0.6 puts x at -0.6.
    expect(p.size).toBeCloseTo(0.5 * (1.3 * 0.7 + 0.7), 12);
    expect(p.ang).toBeCloseTo(-0.6, 12);
    const w = vfxBillboardOps(o, { x: 3, y: 1, z: 5 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0.8, z: -0.6 }, { x: 0.5, y: -1 }, 2, 1, 0);
    expect([w.x, w.y, w.z]).toEqual([3 + 0.5 * 2, 1 - 0.8 * 2, 5 + 0.6 * 2]);
  });
});

async function spied(fxDetail: VfxDetail = 2) {
  const { W, TSL } = await webgpuModules();
  const sm = new SmokeMesh(8, 8, fxDetail);
  const legacy = sm.mesh.material as unknown as HasUniforms;
  const seen: { cover?: Parameters<typeof smokeScreenCoverOps>; shade?: Parameters<typeof smokeScreenShadeOps>[1]; puff?: Parameters<typeof smokeScreenPuffOps>; billboard?: Parameters<typeof vfxBillboardOps> } = {};
  const m = maths.smokeScreen;
  const spy: SmokeScreenMaths = {
    coverOps: ((...a: Parameters<typeof smokeScreenCoverOps>) => ((seen.cover = a as never), m.coverOps(...a))) as typeof smokeScreenCoverOps,
    shadeOps: ((op, i) => ((seen.shade = i as never), m.shadeOps(op, i))) as typeof smokeScreenShadeOps,
    puffOps: ((...a: Parameters<typeof smokeScreenPuffOps>) => ((seen.puff = a as never), m.puffOps(...a))) as typeof smokeScreenPuffOps,
    billboardOps: ((...a: Parameters<typeof vfxBillboardOps>) => ((seen.billboard = a as never), m.billboardOps(...a))) as typeof vfxBillboardOps,
  };
  const twin = createNodeSmokeScreenMaterial({ W, TSL, maths: spy }, legacy, fxDetail);
  copyRenderState(legacy, twin);
  sm.mesh.material = twin as never;
  return { sm, legacy, twin, seen };
}
type Split = { node?: unknown; components?: string };
const split = (n: unknown): Split => n as Split;
const indexOf = (n: unknown): number | undefined => (split(n).node as { indexNode?: { value?: number } } | undefined)?.indexNode?.value;

describe('G3: each input is wired to its legacy record', () => {
  it('uClock, uAtlas, uReady, uLit, uShade, uLight and uSun reach the maths in the slot the shader reads them in', async () => {
    const { sm, twin, seen } = await spied();
    await compileFx(sm.mesh);
    const b = boundOf(twin);
    const s = seen.shade;
    const cover = seen.cover?.[1];
    expect(s).toBeDefined();
    expect(cover).toBeDefined();
    if (s === undefined || cover === undefined) return;
    expect(cover.clock, 'uClock').toBe(b.uClock);
    expect(seen.cover?.[2], 'FX_DETAIL').toBe(2);
    expect(s.ready, 'uReady').toBe(b.uReady);
    expect(s.lit, 'uLit').toBe(b.uLit);
    expect(s.shade, 'uShade').toBe(b.uShade);
    expect(s.light, 'uLight').toBe(b.uLight);
    expect([split(s.sun.x).node, split(s.sun.x).components, split(s.sun.y).node, split(s.sun.y).components]).toEqual([b.uSun, 'x', b.uSun, 'y']);
    // The tap reads uAtlas, its r/g/b the density and the gradient.
    const tap = texturesOf(twin).uAtlas?.taps[0];
    expect(texturesOf(twin).uAtlas?.taps).toHaveLength(1);
    expect((split(s.s.r).node as { node?: unknown }).node).toBe(tap);
    expect([split(s.s.r).components, split(s.s.g).components, split(s.s.b).components]).toEqual(['x', 'y', 'z']);
  });

  it('the vertex stage: the matrix columns (0 and 2 the axes, 3 the centre), the view rows, position.xz, aAlpha and aSeed', async () => {
    const { sm, seen } = await spied();
    const c = await compileFx(sm.mesh);
    const puff = seen.puff;
    const bb = seen.billboard;
    expect(puff).toBeDefined();
    expect(bb).toBeDefined();
    if (puff === undefined || bb === undefined) return;
    expect([indexOf(puff[1].x), split(puff[1].x).components, indexOf(puff[1].z), split(puff[1].z).components]).toEqual([0, 'x', 0, 'z']);
    expect([indexOf(puff[2].x), indexOf(puff[2].y), indexOf(puff[2].z)]).toEqual([2, 2, 2]);
    const [, centre, right, up, corner, , quad, lift] = bb;
    expect([indexOf(centre.x), indexOf(centre.y), indexOf(centre.z)]).toEqual([3, 3, 3]);
    expect([right.x, right.y, right.z].map((n) => [indexOf(n), split(n).components])).toEqual([[0, 'x'], [1, 'x'], [2, 'x']]);
    expect([up.x, up.y, up.z].map((n) => [indexOf(n), split(n).components])).toEqual([[0, 'y'], [1, 'y'], [2, 'y']]);
    expect([split(corner.x).components, split(corner.y).components], 'the corner is position.xz').toEqual(['x', 'z']);
    expect(lift).toBe(0);
    const q = quad as { value?: number; node?: { value?: number } };
    expect(q.value ?? q.node?.value, 'quad 1, a literal').toBe(1);
    for (const a of ['aAlpha', 'aSeed']) expect(c.vertex, a).toContain(a);
  });

  it('every bound uniform re-reads its legacy record each render', async () => {
    const { legacy, twin } = await spied();
    const b = boundOf(twin);
    for (const k of ['uClock', 'uReady', 'uLit', 'uShade', 'uLight', 'uSun']) {
      upd(b[k]).update();
      expect(upd(b[k]).value, k).toBe(legacy.uniforms[k]?.value);
    }
    for (const k of ['uClock', 'uReady', 'uLight']) {
      (legacy.uniforms[k] as { value: number }).value = 3.5;
      upd(b[k]).update();
      expect(upd(b[k]).value, k).toBe(3.5);
    }
  });

  it('the clock: none of its own (the frame clock is the record\'s uClock)', async () => {
    expect((await compileFx((await spied()).sm.mesh)).frameClocked).toEqual([]);
  });
});

describe('the writer holds its legacy material apart: update and setLook reach the twin after adoption', () => {
  it('uClock from update, the atlas, uReady, uLight and uSun from setLook', async () => {
    const sm = new SmokeMesh(8, 8, 2);
    const twin = await adoptFx(sm.mesh);
    expect(isTwin(twin)).toBe(true);
    sm.update(smoked(), new Uint8Array(64), 8, 8, 1234);
    const atlas = new THREE.Texture();
    sm.setLook(atlas, 0.7, new THREE.Vector2(0.2, 0.9));
    const b = boundOf(twin);
    for (const k of ['uClock', 'uReady', 'uLight', 'uSun']) upd(b[k]).update();
    expect(upd(b.uClock).value).toBe(1234);
    expect(upd(b.uReady).value).toBe(1);
    expect(upd(b.uLight).value).toBe(0.7);
    expect((upd(b.uSun).value as THREE.Vector2).toArray()).toEqual([0.2, 0.9]);
    expect(texturesOf(twin).uAtlas?.taps[0]?.value).toBe(atlas);
  });
});

describe('G4: a late atlas is sampled', () => {
  it('built before the atlas lands, the tap reads a placeholder; after setLook the next render reads the atlas', async () => {
    const sm = new SmokeMesh(8, 8, 2);
    const twin = await adoptFx(sm.mesh);
    const late = texturesOf(twin).uAtlas;
    expect(late?.taps[0]?.value).toBe(late?.placeholder);
    const atlas = new THREE.Texture();
    sm.setLook(atlas, 1, new THREE.Vector2(0, 1));
    upd(boundOf(twin).uReady).update();
    expect(late?.taps[0]?.value).toBe(atlas);
  });
});

describe('G5: every detail level compiles, and detail 0 has no fbm in its program', () => {
  const hashes = (src: string): number => src.split(String(VFX_HASH.scale)).length - 1;
  it('FX_DETAIL 0, 1 and 2 each compile (GLSL and WGSL); the sin-hash count is 0, 16 and 32 (4 lattice corners x 4 octaves per chain)', async () => {
    const counts: number[] = [];
    for (const d of [0, 1, 2] as const) {
      const sm = new SmokeMesh(8, 8, d);
      expect(fxDetailOf(sm.mesh.material as THREE.Material), `the factory reads FX_DETAIL ${d} off the legacy define`).toBe(d);
      await adoptFx(sm.mesh);
      const glsl = await compileFx(sm.mesh);
      const wgsl = await compileWgsl(sm.mesh);
      counts.push(hashes(glsl.fragment));
      expect(hashes(wgsl.fragment), `WGSL ${d}`).toBe(hashes(glsl.fragment));
    }
    expect(counts).toEqual([0, 16, 32]);
  });
});

describe('G2: no implicit-gradient tap inside a branch', () => {
  it('GLSL and WGSL: one tap, a top-level statement, filtered', async () => {
    const sm = new SmokeMesh(8, 8, 2);
    await adoptFx(sm.mesh);
    const glsl = await compileFx(sm.mesh);
    expect(glsl.fragment.match(/\btexture\(/g), 'one tap (non-vacuous)').toHaveLength(1);
    expect(() => assertNoImplicitSampleInConditional(glsl.fragment)).not.toThrow();
    const wgsl = await compileWgsl(sm.mesh);
    expect(wgsl.fragment.match(/\btextureSample\(/g)).toHaveLength(1);
    expect(wgsl.fragment).not.toMatch(/\btextureLoad\(/);
    expect(() => assertNoImplicitSampleInConditional(wgsl.fragment)).not.toThrow();
  });
});

describe('the instance matrix the vertex stage reads', () => {
  it('is a view of the mesh\'s own array that follows its version before every draw', async () => {
    const sm = new SmokeMesh(8, 8, 2);
    await adoptFx(sm.mesh);
    const built = await buildGlsl(sm.mesh);
    const view = smokeInstanceView(sm.mesh.instanceMatrix);
    expect(view, 'the vertex stage built a view').toBeDefined();
    expect(view?.array).toBe(sm.mesh.instanceMatrix.array);
    // Four vec4 columns, instanced.
    expect(built.vertex.match(/\bin vec4 nodeAttribute\d+;/g)?.length ?? 0).toBe(4);
    sm.update(smoked(), new Uint8Array(64), 8, 8, 0);
    expect(view?.version).not.toBe(sm.mesh.instanceMatrix.version);
    for (const n of built.updateBeforeNodes) n.updateBefore({ object: sm.mesh });
    expect(view?.version).toBe(sm.mesh.instanceMatrix.version);
  });
});

describe('the census: adopted, the smoke screen is never hidden or named', () => {
  it('across an empty and a smoked frame', async () => {
    const sm = new SmokeMesh(8, 8, 2);
    const scene = new THREE.Scene();
    scene.add(sm.mesh);
    await adoptFx(sm.mesh);
    scene.add(sm.mesh);
    for (const s of [flat, smoked()]) {
      sm.update(s, new Uint8Array(64), 8, 8, 100);
      expect(censusUnported(scene)).toEqual([]);
      expect(sm.mesh.visible).toBe(true);
    }
  });
});
