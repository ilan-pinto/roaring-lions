/**
 * Defilade T4, Task 6 fix round 1: the flipbook's atlas billow must cover what
 * the approved MOCK's procedural billow covers ("build as mocked").
 *
 * The oracle is the mock's own fragment-shader density -- its fbm, edge,
 * erosion and gain -- transcribed with LITERALS from `mock/defilade-t4`
 * (1bd2814b, `units/flipbook-fx.ts` FRAG), imported from nothing it judges.
 * The thing judged is `FLIPBOOK_FIT` plus the shipped atlases, read through
 * the same arithmetic the shipping FRAG does (zoomed, rotated, frames
 * `k0..k1` over life, `gain * R - 0.99 t^2`), bilinear like the sampler.
 *
 * Before the fix (the quad 1/0.85, frame t*63, density = R) a fire instance
 * read 0.24 mean density inside its disc at t = 0.1 against the mock's 0.64,
 * and smoke 0.17 against 0.63 -- the "visibly smaller, thinner" fireball and
 * missing fire mass the lead saw. The band below is +-15% of the mock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { FLIPBOOK_FIT } from '../../packages/render/src/three/units/flipbook-fx';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const FRAME = 128;
const GRID = 8;
const N = 96; // samples across the quad
const SEEDS = 16;

const fract = (x: number): number => x - Math.floor(x);
const hash = (x: number, y: number): number => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
function fbm(x: number, y: number): number {
  let v = 0, a = 0.5;
  for (let k = 0; k < 4; k++) { v += a * vnoise(x, y); x = x * 2.03 + 11.7; y = y * 2.03 + 11.7; a *= 0.5; }
  return v;
}
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** The mock's density at quad uv (r <= 1), life t, seed, fire or not. */
function mockDensity(u: number, v: number, t: number, seed: number, fire: boolean): number {
  const r = Math.hypot(u, v);
  const ang = seed * 6.2831;
  const c = Math.cos(ang), s = Math.sin(ang);
  // GLSL mat2(c, -s, s, c) * v: column-major.
  const rx = c * u + s * v, ry = -s * u + c * v;
  const freq = fire ? 2.6 : 1.7;
  const age = t * 0.7;
  const qx = rx * freq + seed * 31, qy = ry * freq + seed * 31 - age * 0.45;
  const billow = fbm(qx, qy) * 0.7 + fbm(qx * 2.3 + 5.1, qy * 2.3 + 5.1) * 0.3;
  const edge = 1 - smoothstep(0.3, 1.0, r + (billow - 0.5) * (fire ? 1.1 : 0.7));
  const d = clamp01((edge * (0.55 + billow) - 0.55 * t * t) * 1.8);
  return d < 0.01 ? 0 : d;
}

function loadR(name: string): { at(k: number, x: number, y: number): number } {
  const png = PNG.sync.read(readFileSync(root(`assets/textures/vfx/flipbook_${name}.png`)));
  const px = (k: number, x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= FRAME || y >= FRAME) return 0;
    const ox = (k % GRID) * FRAME, oy = Math.floor(k / GRID) * FRAME;
    return png.data[((oy + y) * png.width + ox + x) * 4] / 255;
  };
  // Bilinear at texel-centre convention, in frame pixels.
  return {
    at(k, x, y) {
      const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
      const wx = x - 0.5 - x0, wy = y - 0.5 - y0;
      return (px(k, x0, y0) * (1 - wx) + px(k, x0 + 1, y0) * wx) * (1 - wy) +
        (px(k, x0, y0 + 1) * (1 - wx) + px(k, x0 + 1, y0 + 1) * wx) * wy;
    },
  };
}

/** The shipping FRAG's density at quad uv, as `FLIPBOOK_FIT` reads the atlas. */
function buildDensity(atlas: ReturnType<typeof loadR>, fit: { zoom: number; gain: number; k0: number; k1: number; freq: number; disp: number; amp: number }, u: number, v: number, t: number, seed: number): number {
  const ang = seed * 6.2831853;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const ax = cs * u - sn * v, ay = sn * u + cs * v;
  // Fix round 2: the mock's billow noise breaks the rim (radius) and the
  // density up; the same age the oracle drifts its noise by.
  const qx = ax * fit.freq + seed * 31, qy = ay * fit.freq + seed * 31 - t * 0.7 * 0.45;
  const b = (fbm(qx, qy) * 0.7 + fbm(qx * 2.3 + 5.1, qy * 2.3 + 5.1) * 0.3) / 0.9375;
  const sc = 1 + (b - 0.5) * fit.disp;
  // local in [0,1], v up; frame rows run down from the top.
  const lx = ax * sc * 0.5 * fit.zoom + 0.5, ly = ay * sc * 0.5 * fit.zoom + 0.5;
  const f = fit.k0 + t * (fit.k1 - fit.k0);
  const k0 = Math.floor(f), k1 = Math.min(k0 + 1, 63), w = f - k0;
  const R = atlas.at(k0, lx * FRAME, (1 - ly) * FRAME) * (1 - w) + atlas.at(k1, lx * FRAME, (1 - ly) * FRAME) * w;
  const d = clamp01(fit.gain * R * (1 + (b - 0.5) * fit.amp) - 0.99 * t * t);
  return d < 0.01 ? 0 : d;
}

/**
 * How ragged a billow's rim is: over 72 angular bins, the outermost radius
 * at which density reaches 0.5, and the std of that radius round the
 * circle, averaged over seeds. A radially smooth billow (fix round 1) reads
 * about half the mock's, and is what drew clean contour rings.
 */
function raggedness(fn: (u: number, v: number, seed: number) => number): number {
  const BINS = 72;
  let total = 0;
  const seeds = 8;
  for (let si = 0; si < seeds; si++) {
    const seed = 0.05 + (0.9 * si) / (seeds - 1);
    const outer = new Float64Array(BINS);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1, v = ((j + 0.5) / N) * 2 - 1;
        const r = Math.hypot(u, v);
        if (r > 1 || fn(u, v, seed) < 0.5) continue;
        const bin = Math.min(BINS - 1, Math.floor(((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * BINS));
        if (r > outer[bin]) outer[bin] = r;
      }
    }
    const mean = outer.reduce((a, x) => a + x, 0) / BINS;
    total += Math.sqrt(outer.reduce((a, x) => a + (x - mean) ** 2, 0) / BINS);
  }
  return total / seeds;
}

function meanOverDisc(fn: (u: number, v: number, seed: number) => number): number {
  let sum = 0, n = 0;
  for (let si = 0; si < SEEDS; si++) {
    const seed = 0.03 + (0.94 * si) / (SEEDS - 1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1, v = ((j + 0.5) / N) * 2 - 1;
        if (u * u + v * v > 1) continue;
        sum += fn(u, v, seed);
        n++;
      }
    }
  }
  return sum / n;
}

describe('the flipbook billow covers what the mock covers', () => {
  for (const [type, atlasName, fire] of [['fire', 'fire', true], ['smoke', 'smoke', false]] as const) {
    const atlas = loadR(atlasName);
    for (const t of [0.1, 0.3, 0.6]) {
      it(`${type} at t=${t}: mean density inside the disc within 15% of the mock's`, () => {
        const mock = meanOverDisc((u, v, seed) => mockDensity(u, v, t, seed, fire));
        const build = meanOverDisc((u, v, seed) => buildDensity(atlas, FLIPBOOK_FIT[type], u, v, t, seed));
        expect(mock).toBeGreaterThan(0.3);
        expect(build / mock).toBeGreaterThan(0.85);
        expect(build / mock).toBeLessThan(1.15);
      });
    }
    for (const t of [0.1, 0.3]) {
      it(`${type} at t=${t}: the rim is as ragged as the mock's (no clean contour circle)`, () => {
        const mock = raggedness((u, v, seed) => mockDensity(u, v, t, seed, fire));
        const build = raggedness((u, v, seed) => buildDensity(atlas, FLIPBOOK_FIT[type], u, v, t, seed));
        expect(build / mock).toBeGreaterThan(0.75);
        expect(build / mock).toBeLessThan(1.5);
      });
    }
  }
});
