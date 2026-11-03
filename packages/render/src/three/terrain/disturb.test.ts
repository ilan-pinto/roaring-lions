/**
 * Vehicles bend the vegetation (GH-984 N2): the disturbance maths, the proof that the GLSL which draws it is the same
 * maths, the tick ring that makes the wake a function of the sim and not of the frames, and the slot budget.
 * Oracles are literals (the lead's 0.8 and 0.35, the design's 24/16/8, 1.5 s, 8 x 5 ticks), retyped here, not imported.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../quality';
import { buildDecorMesh, swayingFoliageMaterial } from './decor-mesh';
import {
  DISTURB_CLASSES,
  DISTURB_CORE,
  DISTURB_KIND_FOOT,
  DISTURB_KIND_HULL,
  DISTURB_KIND_NONE,
  DISTURB_LADDER,
  DISTURB_MAX,
  DISTURB_REACH,
  DISTURB_RING_SAMPLES,
  DISTURB_RING_SPACING_TICKS,
  DISTURB_SPRING_FLOOR,
  DISTURB_SPRING_HZ,
  DISTURB_SPRING_ZETA,
  DISTURB_WAKE_MIN_LEN,
  DISTURB_WAKE_S,
  DISTURB_WAKE_TICKS,
  DisturbField,
  WakeRing,
  disturbAlong,
  disturbAmount,
  disturbAngle,
  disturbDisplacement,
  disturbFloat,
  disturbMathGlsl,
  disturbProfile,
  disturbT,
  disturbThetaMax,
  disturbUp,
  disturbVertexChunk,
  natureQualityOf,
  type DisturbFrame,
  type DisturbSource,
} from './disturb';
import { inertDisturbUniforms, makeDisturbUniforms } from './disturb-uniforms';
import { makeWindUniforms } from './wind-uniforms';
import { WIND_CLASS_GRASS, WIND_CLASS_REED, WIND_CLASS_SHRUB, WIND_CLASS_TREE } from './wind';

// --- the GLSL, run --------------------------------------------------------------------------

interface GlslTwin {
  rlDisturbT(ox: number, oz: number, ax: number, az: number, bx: number, bz: number): number;
  rlDisturbProfile(t: number, spring: number): number;
  rlDisturbAmount(d: number, t: number, len: number, radius: number, strength: number, spring: number): number;
  rlDisturbAngle(cls: number, hN: number, mag: number): number;
  rlDisturbAlong(along: number, h: number, theta: number): number;
  rlDisturbUp(along: number, h: number, theta: number): number;
}

/** Transpile the scalar GLSL subset `disturbMathGlsl` is written in (the wind test's method), and run it. */
function twin(): GlslTwin {
  const body = disturbMathGlsl()
    .replace(/const float (\w+)\[4\] = float\[4\]\(([^)]*)\);/g, 'const $1 = [$2];')
    .replace(/^(float|int) (\w+)\(([^)]*)\) \{/gm, (_m, _t: string, name: string, params: string) =>
      `function ${name}(${params.replace(/\b(float|int)\s+/g, '')}) {`)
    .replace(/^(\s*)float (\w+) =/gm, '$1let $2 =');
  const make = new Function(
    'cos', 'sin', 'exp', 'clamp', 'smoothstep', 'max', 'min', 'pow',
    `${body}\nreturn { rlDisturbT, rlDisturbProfile, rlDisturbAmount, rlDisturbAngle, rlDisturbAlong, rlDisturbUp };`
  ) as (...a: unknown[]) => GlslTwin;
  return make(
    Math.cos, Math.sin, Math.exp,
    (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
    (lo: number, hi: number, x: number) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); },
    Math.max, Math.min, Math.pow
  );
}

describe('the lead and the design, as literals', () => {
  it('pins the budget ladder, the wake and the ring', () => {
    expect([...DISTURB_LADDER]).toEqual([24, 16, 8, 0]);
    expect(DISTURB_MAX).toBe(24);
    expect(DISTURB_WAKE_TICKS).toBe(30); // 1.5 s at 20 Hz
    expect(DISTURB_WAKE_S).toBe(1.5);
    expect(DISTURB_RING_SAMPLES).toBe(8);
    expect(DISTURB_RING_SPACING_TICKS).toBe(5);
    expect(DISTURB_WAKE_TICKS).toBeLessThanOrEqual((DISTURB_RING_SAMPLES - 1) * DISTURB_RING_SPACING_TICKS);
  });
  it('pins the presets: high 24 with foot, medium 16 with wakes and no foot, low 8 discs and no wakes', () => {
    expect(QUALITY_PRESETS.high.nature).toEqual({ slots: 24, wakes: true, foot: true });
    expect(QUALITY_PRESETS.medium.nature).toEqual({ slots: 16, wakes: true, foot: false });
    expect(QUALITY_PRESETS.low.nature).toEqual({ slots: 8, wakes: false, foot: false });
    // A caller with no opinion reads high's.
    expect(natureQualityOf(undefined)).toEqual({ slots: 24, wakes: true, foot: true });
    expect(natureQualityOf({ ...QUALITY_PRESETS.low, nature: undefined })).toEqual({ slots: 24, wakes: true, foot: true });
  });
  it('pins the class caps: grass flattens to 0.8 of its height, a shrub bends 0.35', () => {
    expect(DISTURB_CLASSES[WIND_CLASS_GRASS].cap).toBe(0.8);
    expect(DISTURB_CLASSES[WIND_CLASS_SHRUB].cap).toBe(0.35);
    expect(DISTURB_CLASSES[WIND_CLASS_REED].name).toBe('reed');
    expect(DISTURB_CLASSES[WIND_CLASS_TREE].name).toBe('tree');
    // The tip of a blade at full push stands 1 - cap of its height: cos(theta) = 1 - cap.
    expect(Math.cos(disturbThetaMax(WIND_CLASS_GRASS))).toBeCloseTo(0.2, 12);
    expect(Math.cos(disturbThetaMax(WIND_CLASS_SHRUB))).toBeCloseTo(0.65, 12);
  });
});

describe('the GLSL, run, equals the TS mirror', () => {
  const g = twin();
  it('t, profile, amount, angle and the rotation, sample by sample', () => {
    let moved = 0;
    for (let k = 0; k < 200; k++) {
      const ox = ((k * 29) % 97) / 7 - 6;
      const oz = ((k * 41) % 89) / 7 - 6;
      const ax = ((k * 13) % 17) / 3;
      const az = ((k * 7) % 19) / 3;
      const bx = ax + (((k * 5) % 23) - 11) / 4;
      const bz = az + (((k * 3) % 29) - 14) / 4;
      expect(g.rlDisturbT(ox, oz, ax, az, bx, bz)).toBeCloseTo(disturbT(ox, oz, ax, az, bx, bz), 12);
      const t = (k % 21) / 20;
      for (const spring of [0, 1]) {
        // GLSL literals carry eight digits: the spring's constants differ from the TS ones by ~1e-9.
        expect(g.rlDisturbProfile(t, spring)).toBeCloseTo(disturbProfile(t, spring), 7);
        const d = (k % 13) / 3;
        const len = (k % 9) / 8;
        const radius = 0.4 + (k % 7) / 4;
        const amt = disturbAmount(d, t, len, radius, 0.25 + (k % 4) / 4, spring);
        expect(g.rlDisturbAmount(d, t, len, radius, 0.25 + (k % 4) / 4, spring)).toBeCloseTo(amt, 7);
        if (Math.abs(amt) > 0.05) moved++;
      }
      const mag = (k % 11) / 8;
      const hN = (k % 10) / 9;
      for (const cls of [0, 1, 2, 3]) {
        expect(g.rlDisturbAngle(cls, hN, mag)).toBeCloseTo(disturbAngle(cls, hN, mag), 7);
      }
      const along = ((k % 15) - 7) / 10;
      const h = (k % 12) / 10;
      const theta = (k % 16) / 10;
      expect(g.rlDisturbAlong(along, h, theta)).toBeCloseTo(disturbAlong(along, h, theta), 12);
      expect(g.rlDisturbUp(along, h, theta)).toBeCloseTo(disturbUp(along, h, theta), 12);
    }
    // Anti-vacuity: the comparison is not 0 == 0.
    expect(moved).toBeGreaterThan(60);
  });
  it('carries every constant as its delimited eight-digit literal', () => {
    const src = disturbMathGlsl();
    for (const k of [DISTURB_CORE, DISTURB_REACH, DISTURB_WAKE_MIN_LEN, DISTURB_WAKE_S, DISTURB_SPRING_FLOOR]) {
      expect(src, String(k)).toContain(disturbFloat(k));
    }
    // The class tables, in id order.
    expect(src).toContain(`float[4](${DISTURB_CLASSES.map((c) => disturbFloat(c.stiffness)).join(', ')})`);
    expect(src).toContain(`float[4](${DISTURB_CLASSES.map((_c, i) => disturbFloat(disturbThetaMax(i))).join(', ')})`);
  });
});

describe('what a vertex does', () => {
  const HULL = { ax: 0, az: 0, bx: 0, bz: 0, radius: 1.35, strength: 1 };
  const tip = { x: 0, h: 1, z: 0 };
  it('grass at the tip, full push: it lies down to 0.2 of its height (flattens by 0.8) and leans away', () => {
    const d = disturbDisplacement([HULL], WIND_CLASS_GRASS, 1, 0.3, 0, tip, 1);
    expect(1 + d.dy).toBeCloseTo(0.2, 6);
    expect(d.dx).toBeGreaterThan(0.9); // pushed along +x, away from a hull at the origin
    expect(Math.abs(d.dz)).toBeLessThan(1e-9);
  });
  it('a shrub never flattens by more than 0.35 of its height, however hard it is pushed', () => {
    const many = Array.from({ length: 6 }, () => HULL);
    const d = disturbDisplacement(many, WIND_CLASS_SHRUB, 1, 0.3, 0, tip, 1);
    expect(-d.dy).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(-d.dy).toBeGreaterThan(0.3);
  });
  it('bends from the foot: the root does not move, the tip moves most', () => {
    const at = (hN: number): number => Math.hypot(...Object.values(disturbDisplacement([HULL], WIND_CLASS_GRASS, hN, 0.3, 0, { x: 0, h: hN, z: 0 }, 1)));
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeGreaterThan(0);
    expect(at(1)).toBeGreaterThan(at(0.5));
  });
  it('outside the reach nothing moves; inside the core it is full', () => {
    const far = disturbDisplacement([HULL], WIND_CLASS_GRASS, 1, DISTURB_REACH * HULL.radius + 0.01, 0, tip, 1);
    expect(far).toEqual({ dx: 0, dy: 0, dz: 0 });
    expect(disturbAmount(DISTURB_CORE * HULL.radius, 0, 0, HULL.radius, 1, 1)).toBe(1);
    expect(disturbAmount(DISTURB_REACH * HULL.radius, 0, 0, HULL.radius, 1, 1)).toBe(0);
  });
  it('two hulls either side cancel (the pushes add as vectors)', () => {
    const left = { ...HULL, ax: -0.8, bx: -0.8 };
    const right = { ...HULL, ax: 0.8, bx: 0.8 };
    const d = disturbDisplacement([left, right], WIND_CLASS_GRASS, 1, 0, 0, tip, 1);
    expect(Math.hypot(d.dx, d.dy, d.dz)).toBeLessThan(1e-9);
  });
  it('infantry push at a quarter of a hull', () => {
    const foot = { ...HULL, radius: 0.6, strength: 0.25 };
    expect(disturbAmount(0, 0, 0, 0.6, 0.25, 1)).toBe(0.25);
    const a = disturbDisplacement([foot], WIND_CLASS_GRASS, 1, 0.2, 0, tip, 1);
    const b = disturbDisplacement([{ ...foot, strength: 1 }], WIND_CLASS_GRASS, 1, 0.2, 0, tip, 1);
    expect(-a.dy).toBeLessThan(-b.dy / 2);
  });
});

describe('the wake: a spring behind a hull, a static fall under reduced motion', () => {
  it('is full at the head and gone at the tail', () => {
    for (const spring of [0, 1]) {
      expect(disturbProfile(0, spring)).toBeCloseTo(1, 12);
      expect(Math.abs(disturbProfile(1, spring))).toBeLessThan(0.02);
    }
  });
  it('the spring overshoots (pulls toward the track) by about 20%, within its floor; the static fall never does', () => {
    let min = 1;
    let minStatic = 1;
    for (let k = 0; k <= 200; k++) {
      min = Math.min(min, disturbProfile(k / 200, 1));
      minStatic = Math.min(minStatic, disturbProfile(k / 200, 0));
    }
    const overshoot = Math.exp((-Math.PI * DISTURB_SPRING_ZETA) / Math.sqrt(1 - DISTURB_SPRING_ZETA ** 2));
    expect(min).toBeCloseTo(-overshoot, 1);
    expect(min).toBeGreaterThanOrEqual(DISTURB_SPRING_FLOOR);
    expect(DISTURB_SPRING_HZ).toBe(1.1);
    expect(minStatic).toBeGreaterThanOrEqual(0);
  });
  it('a static fall is monotone', () => {
    let last = 1;
    for (let k = 1; k <= 100; k++) {
      const v = disturbProfile(k / 100, 0);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
  });
  it('a hull that has just stopped is a disc, not a streak: a wake shorter than the minimum blends to flat', () => {
    // The same point, the same t at the tail: a 0-long wake pushes at the disc's 1, a long one at the tail's profile.
    expect(disturbAmount(0.5, 1, 0, 1.35, 1, 1)).toBeCloseTo(disturbAmount(0.5, 0, 0, 1.35, 1, 1), 12);
    expect(disturbAmount(0.5, 1, DISTURB_WAKE_MIN_LEN, 1.35, 1, 1)).toBeCloseTo(disturbProfile(1, 1) * disturbAmount(0.5, 0, 0, 1.35, 1, 1), 12);
  });
});

describe('the tick ring', () => {
  it('interpolates between samples taken every 5 ticks, and reads the newest alone', () => {
    const ring = new WakeRing(2);
    ring.seed(0, 0, 0, 0);
    for (let t = 1; t <= 40; t++) ring.record(0, t, t * 0.1, 2 * t * 0.1); // ticks 5, 10 ... are the samples
    const out = { x: 0, z: 0 };
    ring.at(0, 40, out);
    expect(out.x).toBeCloseTo(4, 12);
    ring.at(0, 25, out);
    expect(out.x).toBeCloseTo(2.5, 12);
    expect(out.z).toBeCloseTo(5, 12);
    ring.at(0, 27.5, out); // between the samples at 25 and 30
    expect(out.x).toBeCloseTo(2.75, 12);
    // Older than the ring holds clamps to the oldest sample (tick 5 = 40 - 35).
    ring.at(0, -100, out);
    expect(out.x).toBeCloseTo(0.5, 12);
    // Newer than the newest clamps to it.
    ring.at(0, 99, out);
    expect(out.x).toBeCloseTo(4, 12);
  });
  it('ignores a tick that is not a sample, and a newcomer is seeded where it stands (no streak)', () => {
    const ring = new WakeRing(1);
    expect(ring.seeded(0)).toBe(false);
    ring.seed(0, 17, 3, 4);
    expect(ring.seeded(0)).toBe(true);
    ring.record(0, 18, 99, 99);
    const out = { x: 0, z: 0 };
    ring.at(0, 17 - 30, out);
    expect([out.x, out.z]).toEqual([3, 4]);
    ring.at(0, 17, out);
    expect([out.x, out.z]).toEqual([3, 4]);
  });
});

// --- the field ----------------------------------------------------------------------------------

function world(): {
  src: DisturbSource;
  frame: DisturbFrame;
  px: Float64Array; pz: Float64Array; cx: Float64Array; cz: Float64Array;
  typeIdx: Uint8Array; alive: Uint8Array;
} {
  const n = 40;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const typeIdx = new Uint8Array(n);
  const alive = new Uint8Array(n).fill(1);
  const src: DisturbSource = {
    alive,
    typeIdx,
    prevX: px, prevZ: pz, curX: cx, curZ: cz,
    kindOfType: [DISTURB_KIND_NONE, DISTURB_KIND_HULL, DISTURB_KIND_FOOT],
    radiusOfType: [0, 1.35, 0.6],
    skip: () => false,
  };
  const frame: DisturbFrame = { count: n, tick: 100, alpha: 0.5, focusX: 20, focusZ: 20, viewRadius: 30, slots: 24, wakes: true, foot: true };
  return { src, frame, px, pz, cx, cz, typeIdx, alive };
}

describe('choosing the slots', () => {
  it('takes hulls before infantry, nearest to the focus first, and never more than the preset allows', () => {
    const w = world();
    for (let i = 0; i < 40; i++) {
      w.typeIdx[i] = i < 30 ? 1 : 2; // 30 hulls, 10 men
      w.px[i] = w.cx[i] = 20 + ((i * 7) % 13) - 6; // spread over x
      w.pz[i] = w.cz[i] = 20 + ((i * 3) % 11) - 5;
    }
    const field = new DisturbField(40);
    for (const slots of [24, 16, 8, 0]) {
      field.build(w.src, { ...w.frame, slots });
      expect(field.count).toBe(slots);
      const radii = Array.from({ length: field.count }, (_, k) => field.b[2 * k]);
      expect(radii.every((r) => Math.abs(r - 1.35) < 1e-6), `${slots}: only hulls while there are 24 hulls to take`).toBe(true);
      const d = Array.from({ length: field.count }, (_, k) => Math.hypot(field.a[4 * k] - 20, field.a[4 * k + 1] - 20));
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
    // With only 5 hulls the men fill what is left, weakly, and only if the preset allows foot.
    for (let i = 5; i < 30; i++) w.alive[i] = 0;
    field.build(w.src, w.frame);
    expect(field.count).toBe(15);
    expect(Array.from({ length: 15 }, (_, k) => field.b[2 * k + 1])).toEqual([...Array(5).fill(1), ...Array(10).fill(0.25)]);
    field.build(w.src, { ...w.frame, foot: false });
    expect(field.count).toBe(5);
  });
  it('skips what is hidden, dead, out of view or not a hull or man, and leaves an empty box when nothing is chosen', () => {
    const w = world();
    w.typeIdx.fill(1);
    for (let i = 0; i < 40; i++) w.px[i] = w.cx[i] = i < 20 ? 20 : 200; // 20 near, 20 far out of view
    w.alive[0] = 0;
    const field = new DisturbField(40);
    const hidden = new Set([1, 2]);
    field.build({ ...w.src, skip: (i) => hidden.has(i) }, w.frame);
    expect(field.count).toBe(17);
    w.typeIdx.fill(0);
    field.build(w.src, w.frame);
    expect(field.count).toBe(0);
    expect(Array.from(field.box)).toEqual([0, 0, 0, 0]);
  });
  it('builds the box from every slot head and tail, grown by the reach', () => {
    const w = world();
    w.typeIdx[0] = 1;
    w.px[0] = w.cx[0] = 10;
    w.pz[0] = w.cz[0] = 12;
    w.typeIdx.fill(0, 1);
    const field = new DisturbField(40);
    field.build(w.src, { ...w.frame, slots: 8 });
    expect(field.count).toBe(1);
    const r = 1.35 * DISTURB_REACH;
    expect(field.box[0]).toBeCloseTo(10 - r, 4);
    expect(field.box[3]).toBeCloseTo(12 + r, 4);
  });
  it('low draws discs only (no wake): head and tail are one point', () => {
    const w = world();
    w.typeIdx[0] = 1;
    w.px[0] = 10;
    w.cx[0] = 11;
    w.pz[0] = w.cz[0] = 12;
    w.typeIdx.fill(0, 1);
    const field = new DisturbField(40);
    field.ring.seed(0, 100, 11, 12);
    field.ring.record(0, 100, 11, 12);
    field.build(w.src, { ...w.frame, wakes: false });
    expect([field.a[0], field.a[1]]).toEqual([field.a[2], field.a[3]]);
  });
});

describe('the wake is built from the tick ring, not from frames', () => {
  /** A hull driving +x at 0.1 tile/tick; the ring is fed the way `snapshot()` does, once per tick. */
  function drive(framesPerTick: readonly number[]): Float32Array {
    const w = world();
    w.typeIdx.fill(0);
    w.typeIdx[0] = 1;
    const field = new DisturbField(40);
    field.ring.seed(0, 0, 0, 20);
    let tick = 0;
    const pose = (t: number): number => 0.1 * t;
    // Ticks 1..80; between ticks a frame cadence of its own calls build() at its own alphas.
    for (let t = 1; t <= 80; t++) {
      tick = t;
      w.px[0] = pose(t - 1);
      w.cx[0] = pose(t);
      w.pz[0] = w.cz[0] = 20;
      field.ring.record(0, t, pose(t), 20);
      for (const a of framesPerTick) field.build(w.src, { ...w.frame, tick, alpha: a });
    }
    // The same tick, the same alpha, reached by whichever history.
    field.build(w.src, { ...w.frame, tick, alpha: 0.5 });
    return Float32Array.from(field.a.subarray(0, 4));
  }
  it('two frame cadences that reach the same tick draw the same wake, to the bit', () => {
    const sixty = drive([0.3, 0.6, 0.9]);
    const one = drive([]);
    const jittery = drive([0.05, 0.41, 0.42, 0.99]);
    expect(Array.from(sixty)).toEqual(Array.from(one));
    expect(Array.from(jittery)).toEqual(Array.from(one));
    // Anti-vacuity: it is a real wake, 1.5 s (3 tiles at 0.1 tile a tick) long.
    expect(Math.abs(one[0] - one[2])).toBeCloseTo(0.1 * DISTURB_WAKE_TICKS, 3);
  });
});

// --- the shader --------------------------------------------------------------------------------

describe('the chunk', () => {
  const FAKE_VERTEX = '#include <common>\n#include <project_vertex>\n';
  function compile(trunk: boolean, wet = false): { fragment: string; uniforms: Record<string, unknown> } {
    const set = makeDisturbUniforms();
    const m = swayingFoliageMaterial(['#808080'], { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms(), disturb: set }, wet, trunk);
    const shader = { vertexShader: FAKE_VERTEX, uniforms: {} as Record<string, unknown> };
    (m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
    return { fragment: shader.vertexShader, uniforms: shader.uniforms };
  }
  for (const trunk of [false, true]) {
    for (const wet of [false, true]) {
      it(`the ${trunk ? 'trunk' : 'foliage'}${wet ? ' (wet)' : ''} program carries the disturbance, after the wind, and binds the shared uniforms`, () => {
        const { fragment, uniforms } = compile(trunk, wet);
        expect(fragment).toContain(disturbVertexChunk());
        expect(fragment.indexOf('rlWindLean(')).toBeLessThan(fragment.indexOf('rlDisturbT(rlDOrigin'));
        for (const name of ['uDisturbA', 'uDisturbB', 'uDisturbBox', 'uDisturbN', 'uDisturbAmp', 'uDisturbSpring']) {
          expect(uniforms[name], name).toBeDefined();
        }
      });
    }
  }
  it('shares the uniform objects BY REFERENCE, so a terrace rebuild never needs to be told', () => {
    const set = makeDisturbUniforms();
    const m = swayingFoliageMaterial(['#808080'], { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms(), disturb: set });
    const shader = { vertexShader: FAKE_VERTEX, uniforms: {} as Record<string, unknown> };
    (m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
    expect(shader.uniforms.uDisturbN).toBe(set.n);
    expect(shader.uniforms.uDisturbAmp).toBe(set.amp);
    expect(shader.uniforms.uDisturbA).toBe(set.a);
  });
  it('a caller that never heard of the disturbance gets an inert set (count 0, shipped amplitude)', () => {
    const inert = inertDisturbUniforms();
    expect(inert.n.value).toBe(0);
    expect(inert.amp.value).toBe(1);
    expect(inert.spring.value).toBe(1);
    const m = swayingFoliageMaterial(['#808080'], { time: { value: 0 }, amp: { value: 1 } });
    expect(m.onBeforeCompile).toBeTypeOf('function');
  });
  it('skips the loop by a uniform bounding box, before any per-disturber work', () => {
    const src = disturbVertexChunk();
    expect(src.indexOf('uDisturbBox')).toBeLessThan(src.indexOf('for (int rlDi'));
    expect(src).toContain(`rlDi < ${DISTURB_MAX}`);
    expect(src).toContain('uDisturbN * uDisturbAmp > 0.5');
  });
  it('a built decor mesh still builds with a disturbance set (no batch attribute changed)', () => {
    const group = buildDecorMesh([], { parts: new Map() }, { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms(), disturb: makeDisturbUniforms() });
    expect(group).toBeInstanceOf(THREE.Group);
  });
});

describe('the sim clock: no frame time anywhere in the disturbance', () => {
  for (const file of ['terrain/disturb.ts', 'terrain/disturb-uniforms.ts', 'units/ground-churn.ts']) {
    it(`${file} reads no dtMs, performance.now, Date.now or Math.random`, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const bad of ['dtMs', 'performance.now', 'Date.now', 'Math.random', 'requestAnimationFrame']) {
        expect(src.includes(bad), `${file} mentions ${bad}`).toBe(false);
      }
    });
  }
});
