/**
 * `rain-maths.ts` (GH-871 P4 T8; R-7): the lattice, the fall, the splash, the streak
 * width, the height bake and the colour bound. Oracles take LITERALS (the plan's
 * numbers, hand-worked values), never the constants under test; the camera
 * facts (coverage, the constant pixel width) are measured through the REAL
 * `updateDimetricCamera`, not through a second projection written here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { updateDimetricCamera } from '../camera';
import { BEAM_PX_PER_WORLD_UNIT } from './beam-look';
import { SILHOUETTE_PX_PER_WORLD_UNIT } from './silhouette';
import {
  RAIN_PX_PER_WORLD_UNIT,
  RAIN_REACH,
  RAIN_SLANT_TAN,
  bakeHeightTexels,
  colourClearsBloom,
  dropLanding,
  dropPhase,
  dropPosition,
  dropSeed,
  footprintBox,
  latticePeriod,
  posMod,
  rainColour,
  splashAgeMs,
  splashAlpha,
  splashRadius,
  streakWidthWorld,
  toHalfFloat,
  windowLow,
  type GroundBox,
  type RainView,
} from './rain-maths';

const VIEW = { width: 1400, height: 900 };
const MAP = { width: 48, height: 48 };
const ZOOMS = [0.35, 0.5, 1, 1.6, 2.5];

const view = (x: number, y: number, zoom: number): RainView => ({ x, y, zoom, ...VIEW });

describe('rain-maths.ts imports (pure, three-free, pinned)', () => {
  it('imports exactly the projection, the tile hash, the sway wind and the weather constants', () => {
    const src = readFileSync(join(__dirname, 'rain-maths.ts'), 'utf8');
    const specs = [...src.matchAll(/^import [^;]*? from '([^']+)';/gms)].map((m) => m[1]).sort();
    expect(specs).toEqual(['../../project', '../../tile-hash', '../terrain/sway', '../weather']);
    expect(src).not.toMatch(/from 'three/);
  });
});

describe('the pixel scale', () => {
  it('is the silhouette`s and the beam`s, the same derivation (TILE_W sqrt2 / 2 = 45.2548)', () => {
    expect(RAIN_PX_PER_WORLD_UNIT).toBeCloseTo(45.2548, 4);
    expect(RAIN_PX_PER_WORLD_UNIT).toBe(SILHOUETTE_PX_PER_WORLD_UNIT);
    expect(RAIN_PX_PER_WORLD_UNIT).toBe(BEAM_PX_PER_WORLD_UNIT);
  });
});

describe('the seeds', () => {
  const N = 6000;
  const seeds = Array.from({ length: N }, (_, i) => dropSeed(i));
  it('are in [0,1), well spread, and the same every time', () => {
    for (const s of seeds) for (const v of s) expect(v >= 0 && v < 1).toBe(true);
    for (let a = 0; a < 3; a++) {
      const mean = seeds.reduce((t, s) => t + s[a], 0) / N;
      expect(mean, `axis ${a}`).toBeGreaterThan(0.48);
      expect(mean, `axis ${a}`).toBeLessThan(0.52);
    }
    // A quartile of each axis holds a quarter of the drops (+-10%): no clumping.
    for (let a = 0; a < 3; a++) {
      const q = seeds.filter((s) => s[a] < 0.25).length / N;
      expect(q, `axis ${a}`).toBeGreaterThan(0.225);
      expect(q, `axis ${a}`).toBeLessThan(0.275);
    }
    expect(dropSeed(17)).toEqual(dropSeed(17));
  });
  it('differ between drops (the three axes are not one number)', () => {
    expect(dropSeed(0)).not.toEqual(dropSeed(1));
    expect(dropSeed(5)[0]).not.toBe(dropSeed(5)[1]);
  });
});

describe('posMod', () => {
  it('stays in [0, m) for a negative argument', () => {
    expect(posMod(-1, 8)).toBe(7);
    expect(posMod(17, 8)).toBe(1);
    expect(posMod(-16, 8)).toBe(0);
  });
});

describe('pan invariance: the lattice is world-anchored', () => {
  const P = 32;
  const seeds = Array.from({ length: 3000 }, (_, i) => dropSeed(i));
  /** The window of a `P` square about a focus, the way R-7 states it (a pan test needs no camera). */
  const lowAt = (fx: number, fz: number) => ({ x: fx - P / 2, z: fz - P / 2 });

  it('a 3-tile pan moves no drop: each lands where it did, or exactly one P away at the window edge', () => {
    for (const [dx, dz] of [[3, 0], [0, 3], [3, -3]] as const) {
      const a = lowAt(20, 20);
      const b = lowAt(20 + dx, 20 + dz);
      let same = 0;
      for (const s of seeds) {
        const p = dropLanding(s, a, P);
        const q = dropLanding(s, b, P);
        // Modulo P the landing point is the seed's own, whatever the window.
        expect(posMod(q.x - p.x, P) === 0 || Math.abs(posMod(q.x - p.x, P) - P) < 1e-9).toBe(true);
        expect(posMod(q.z - p.z, P) === 0 || Math.abs(posMod(q.z - p.z, P) - P) < 1e-9).toBe(true);
        if (Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.z - p.z) < 1e-9) same++;
      }
      // Only the drops in the strip the window slid past wrapped: about 3/32 per axis.
      const moved = 1 - same / seeds.length;
      const expected = 1 - (1 - (Math.abs(dx) > 0 ? 3 / P : 0)) * (1 - (Math.abs(dz) > 0 ? 3 / P : 0));
      expect(moved).toBeGreaterThan(expected - 0.03);
      expect(moved).toBeLessThan(expected + 0.03);
      // And every one that wrapped sat in the 3-tile strip at the old window's trailing edge.
      for (const s of seeds) {
        const p = dropLanding(s, a, P);
        const q = dropLanding(s, b, P);
        if (Math.abs(q.x - p.x) > 1e-9) {
          expect(Math.abs(q.x - p.x)).toBeCloseTo(P, 6);
          expect(dx > 0 ? p.x - a.x < 3 + 1e-9 : p.x - a.x > P - 3 - 1e-9).toBe(true);
        }
      }
    }
  });

  it('the heads agree too: same time, same ground, a pan changes no head that stayed in the window', () => {
    const a = lowAt(20, 20);
    const b = lowAt(23, 20);
    let compared = 0;
    for (const s of seeds) {
      const p = dropPosition(s, a, P, 7.31, 0.5);
      const q = dropPosition(s, b, P, 7.31, 0.5);
      if (Math.abs(q.landX - p.landX) < 1e-9) {
        expect(q.x).toBeCloseTo(p.x, 9);
        expect(q.y).toBeCloseTo(p.y, 9);
        expect(q.z).toBeCloseTo(p.z, 9);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(2500);
  });
});

describe('the fall (sim clock only)', () => {
  it('a drop falls 4 wu/s: a quarter second later it is 1 wu lower, until it lands and starts again', () => {
    const seed: [number, number, number] = [0.5, 0.25, 0.5];
    const lo = { x: 0, z: 0 };
    const a = dropPosition(seed, lo, 32, 0, 0);
    const b = dropPosition(seed, lo, 32, 0.25, 0);
    expect(a.height).toBeCloseTo(4.5, 9); // 6 - mod(0.25 * 6, 6) = 4.5
    expect(a.y - b.y).toBeCloseTo(1, 9);
    // 1.5 s is one whole fall (6 wu at 4 wu/s): the drop is where it was.
    const c = dropPosition(seed, lo, 32, 1.5, 0);
    expect(c.y).toBeCloseTo(a.y, 9);
  });
  it('lands at the ground and then restarts at the top: the phase wraps at H', () => {
    expect(dropPhase(0, 0)).toBe(0);
    expect(dropPhase(0.99, 0)).toBeCloseTo(5.94, 9);
    expect(dropPhase(0.99, 0.0175)).toBeCloseTo(0.01, 6); // +0.07 wu: 5.94 -> 6.01 wraps to 0.01
  });
  it('slants 12 degrees down-wind: at height h the head is h * tan 12 UPWIND of its landing', () => {
    expect(RAIN_SLANT_TAN).toBeCloseTo(0.212557, 6);
    const p = dropPosition([0.3, 0.5, 0.7], { x: 0, z: 0 }, 32, 0, 0);
    // wind (0.70711, -0.70711): upwind is -x, +z.
    expect(p.landX - p.x).toBeCloseTo(p.height * 0.212557 * 0.70711, 5);
    expect(p.z - p.landZ).toBeCloseTo(p.height * 0.212557 * 0.70711, 5);
  });
  it('sits on the ground it lands on: y = groundY + height', () => {
    const p = dropPosition([0.3, 0.5, 0.7], { x: 0, z: 0 }, 32, 2, 1.75);
    expect(p.y - 1.75).toBeCloseTo(p.height, 9);
  });
});

describe('the splash', () => {
  it('grows 0.04 -> 0.10 wu over 150 ms', () => {
    expect(splashRadius(0)).toBeCloseTo(0.04, 9);
    expect(splashRadius(75)).toBeCloseTo(0.07, 9);
    expect(splashRadius(150)).toBeCloseTo(0.1, 9);
    expect(splashRadius(900)).toBeCloseTo(0.1, 9);
    expect(splashRadius(-5)).toBeCloseTo(0.04, 9);
  });
  it('fades 0.35 -> 0 and is nothing outside its 150 ms', () => {
    expect(splashAlpha(0)).toBeCloseTo(0.35, 9);
    expect(splashAlpha(75)).toBeCloseTo(0.175, 9);
    expect(splashAlpha(149.9)).toBeGreaterThan(0);
    expect(splashAlpha(150)).toBe(0);
    expect(splashAlpha(-1)).toBe(0);
    expect(splashAlpha(2000)).toBe(0);
  });
  it('its age is the fall phase over the speed: 0.6 wu past the landing is 150 ms', () => {
    expect(splashAgeMs(0)).toBe(0);
    expect(splashAgeMs(0.6)).toBeCloseTo(150, 9);
  });
});

/** The ground points a screen sees, by NDC grid and drop height: the true camera does the projecting. */
function visibleLandings(v: RainView): { x: number; z: number; ndcx: number; ndcy: number; h: number }[] {
  const cam = updateDimetricCamera({ x: v.x, y: v.y, zoom: v.zoom }, { width: v.width, height: v.height }, new THREE.OrthographicCamera());
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const out: { x: number; z: number; ndcx: number; ndcy: number; h: number }[] = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const ndcx = -1 + i / 4;
      const ndcy = -1 + j / 4;
      for (const h of [0, 1.5, 3, 4.5, 6]) {
        const p = new THREE.Vector3(ndcx, ndcy, -1).unproject(cam);
        const t = (h - p.y) / dir.y; // along the view ray to the plane y = h
        const head = p.addScaledVector(dir, t);
        // The drop's landing point: its head, un-slanted (the head sits h * tan 12 upwind of it).
        out.push({ x: head.x + 0.212557 * h * 0.70710678, z: head.z - 0.212557 * h * 0.70710678, ndcx, ndcy, h });
      }
    }
  }
  return out;
}

describe('coverage: the window holds every landing point the screen can see', () => {
  for (const [fx, fz] of [[24, 24], [4, 4], [44, 44], [4, 44]] as const) {
    it.each(ZOOMS)(`focus (${fx},${fz}) zoom %s: every visible drop's landing lies inside the window`, (zoom) => {
      const v = view(fx, fz, zoom);
      const box = footprintBox(v, MAP);
      const P = latticePeriod(box);
      const lo = windowLow(box, P);
      let checked = 0;
      for (const L of visibleLandings(v)) {
        // Rain over the map and its 8-tile skirt only (the ground ends there).
        if (L.x < -8 || L.x > 56 || L.z < -8 || L.z > 56) continue;
        checked++;
        expect(L.x, `x at ndc ${L.ndcx},${L.ndcy} h ${L.h}`).toBeGreaterThanOrEqual(lo.x - 1e-6);
        expect(L.x).toBeLessThanOrEqual(lo.x + P + 1e-6);
        expect(L.z).toBeGreaterThanOrEqual(lo.z - 1e-6);
        expect(L.z).toBeLessThanOrEqual(lo.z + P + 1e-6);
      }
      expect(checked, 'a vacuous check proves nothing').toBeGreaterThan(40);
    });
  }

  it('without the map clip the box still holds the whole unclipped footprint at zoom 1 (period 64)', () => {
    const v = view(24, 24, 1);
    const box = footprintBox(v);
    expect(latticePeriod(box)).toBe(64);
    const lo = windowLow(box, 64);
    for (const L of visibleLandings(v)) {
      expect(L.x).toBeGreaterThanOrEqual(lo.x - 1e-6);
      expect(L.x).toBeLessThanOrEqual(lo.x + 64 + 1e-6);
      expect(L.z).toBeGreaterThanOrEqual(lo.z - 1e-6);
      expect(L.z).toBeLessThanOrEqual(lo.z + 64 + 1e-6);
    }
  });

  it('the period per zoom on a 48 map, mid-map, 1400x900 (literals worked by hand)', () => {
    // 0.35 and 0.5: the footprint outgrows the map, so the box is the map plus 8 each side: 64.
    // 1: half-side (15.47 + 19.89) / sqrt2 = 25.0, plus reach 7.35 and slant 1.27 each: 61.2.
    // 1.6: 42.0.  2.5: 30.9.
    expect(ZOOMS.map((z) => latticePeriod(footprintBox(view(24, 24, z), MAP)))).toEqual([64, 64, 64, 64, 32]);
  });

  it('the reach is the fall height seen up the screen: 6 / tan(30 deg) = 10.39', () => {
    expect(RAIN_REACH).toBeCloseTo(10.3923, 3);
  });

  it('falls back to the largest period when no window covers the box (a map wider than 48 at zoom 0.35)', () => {
    const wide = footprintBox(view(40, 40, 0.35), { width: 96, height: 96 });
    expect(latticePeriod(wide)).toBe(64);
  });

  it('chooses the smallest period that covers: boxes of side 7, 9, 31, 33 and 64', () => {
    const sq = (w: number): GroundBox => ({ minX: 0, maxX: w, minZ: 0, maxZ: w });
    expect([7, 9, 31, 33, 64].map((w) => latticePeriod(sq(w)))).toEqual([8, 16, 32, 64, 64]);
  });
});

describe('constant pixel width: 1.5 CSS px at every zoom and at DPR 1 and 2', () => {
  /** A streak's two edges, projected through the real camera, as CSS pixels apart. */
  function measuredCssPx(zoom: number, dpr: number): number {
    const cam = updateDimetricCamera({ x: 24, y: 24, zoom }, { width: 1400, height: 900 }, new THREE.OrthographicCamera());
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    // A slanted path (12 deg, down-wind): the streak's own direction.
    const dirMove = new THREE.Vector3(Math.sin(0.2094395) * 0.70710678, -Math.cos(0.2094395), Math.sin(0.2094395) * -0.70710678);
    const side = new THREE.Vector3().crossVectors(dirMove, forward).normalize();
    const half = streakWidthWorld(zoom, dpr) / 2;
    const centre = new THREE.Vector3(24, 0.5, 24);
    const a = centre.clone().addScaledVector(side, -half).project(cam);
    const b = centre.clone().addScaledVector(side, half).project(cam);
    // NDC to DEVICE pixels of a canvas dpr times the CSS viewport, then back to CSS pixels.
    const dx = ((b.x - a.x) / 2) * 1400 * dpr;
    const dy = ((b.y - a.y) / 2) * 900 * dpr;
    return Math.hypot(dx, dy) / dpr;
  }
  for (const dpr of [1, 2]) {
    it.each(ZOOMS)(`DPR ${dpr}, zoom %s: 1.5 CSS px +- 0.05`, (zoom) => {
      expect(measuredCssPx(zoom, dpr)).toBeGreaterThan(1.45);
      expect(measuredCssPx(zoom, dpr)).toBeLessThan(1.55);
    });
  }
  it('is wider in world units the further out the zoom (0.35 vs 2.5), a ratio of 2.5 / 0.35', () => {
    expect(streakWidthWorld(0.35, 1) / streakWidthWorld(2.5, 1)).toBeCloseTo(2.5 / 0.35, 9);
    // 1.5 px / (45.2548 px/wu * zoom 1) = 0.033146 wu.
    expect(streakWidthWorld(1, 1)).toBeCloseTo(0.033146, 5);
    expect(streakWidthWorld(1, 2)).toBeCloseTo(0.033146, 5);
  });
});

describe('the height bake', () => {
  it('samples each texel at its CENTRE, four texels a tile, row j at world z (j + 0.5) / 4', () => {
    const f = bakeHeightTexels((x, z) => 0.5 * x + 0.25 * z, 3, 2);
    expect(f.length).toBe(12 * 8);
    // texel (0,0): x = z = 0.125; texel (5,3): x = 1.375, z = 0.875; the last texel (11,7).
    expect(f[0]).toBeCloseTo(0.5 * 0.125 + 0.25 * 0.125, 6);
    expect(f[3 * 12 + 5]).toBeCloseTo(0.5 * 1.375 + 0.25 * 0.875, 6);
    expect(f[7 * 12 + 11]).toBeCloseTo(0.5 * 2.875 + 0.25 * 1.875, 6);
  });
  it('a non-square map keeps width and height straight (rows are z, columns x)', () => {
    const f = bakeHeightTexels((x) => x, 5, 1);
    expect(f.length).toBe(20 * 4);
    expect(f[19]).toBeCloseTo(4.875, 6);
    expect(f[3 * 20 + 0]).toBeCloseTo(0.125, 6);
  });
});

describe('the colour bound: rain never blooms', () => {
  it('scales a linear colour by the radiance', () => {
    expect(rainColour([0.5, 0.25, 1], 0.5)).toEqual([0.25, 0.125, 0.5]);
  });
  it('clears 0.9 strictly: 0.89 does, 0.9 does not, a gain of 3 on day`s streak does not', () => {
    expect(colourClearsBloom([0.89, 0.2, 0.2])).toBe(true);
    expect(colourClearsBloom([0.2, 0.9, 0.2])).toBe(false);
    // overcast.0 (#C4C8C9) linear is (0.552, 0.578, 0.584); day under rain is x 0.7415 = 0.433 at most.
    const day = rainColour([0.5522, 0.5776, 0.5841], 0.7415);
    expect(colourClearsBloom(day)).toBe(true);
    expect(colourClearsBloom([day[0] * 3, day[1] * 3, day[2] * 3])).toBe(false);
  });
});

describe('toHalfFloat rounds to nearest (the R16F texel)', () => {
  const back = (v: number): number => THREE.DataUtils.fromHalfFloat(toHalfFloat(v));
  it('is exact on values a half holds, with the literal bit patterns', () => {
    expect(toHalfFloat(0)).toBe(0x0000);
    expect(toHalfFloat(1)).toBe(0x3c00);
    expect(toHalfFloat(2)).toBe(0x4000);
    expect(toHalfFloat(0.5)).toBe(0x3800);
    expect(toHalfFloat(-1)).toBe(0xbc00);
    expect(toHalfFloat(65504)).toBe(0x7bff);
    expect(toHalfFloat(1e9)).toBe(0x7c00);
  });
  it('rounds a tie to even and anything past the middle up', () => {
    // Spacing in [1,2) is 2^-10: 1 + 0.5 ulp ties to even (1.0); 1 + 0.75 ulp rounds up.
    expect(toHalfFloat(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalfFloat(1 + 0.75 * 2 ** -10)).toBe(0x3c01);
    expect(toHalfFloat(1 + 3 * 2 ** -11)).toBe(0x3c02);
  });
  it('is within half a unit in the last place over the drawn range: 0.00049 in [1,2), 0.00098 in [2,4)', () => {
    let worst1 = 0;
    let worst2 = 0;
    for (let i = 0; i <= 40000; i++) {
      const v = (i / 40000) * 4;
      const e = Math.abs(back(v) - v);
      if (v >= 1 && v < 2) worst1 = Math.max(worst1, e);
      if (v >= 2) worst2 = Math.max(worst2, e);
    }
    expect(worst1).toBeLessThan(0.0005);
    expect(worst2).toBeLessThan(0.001);
    // And three's truncating conversion would not be: the reason this exists.
    const trunc = Math.abs(THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(1.4325)) - 1.4325);
    expect(trunc).toBeGreaterThan(0.0008);
  });
  it('handles subnormals and tiny values', () => {
    expect(back(2 ** -24)).toBe(2 ** -24);
    expect(toHalfFloat(2 ** -26)).toBe(0);
    expect(back(0.0001)).toBeCloseTo(0.0001, 7);
  });
});
