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
  RAIN_WIND_MAX,
  bakeHeightTexels,
  colourClearsBloom,
  dropKeepSeed,
  dropLanding,
  dropPhase,
  dropPosition,
  dropSeed,
  footprintAreaInView,
  footprintAreaInWindow,
  footprintBox,
  footprintExtent,
  latticePeriod,
  mapEdgeFade,
  posMod,
  rainColour,
  RainKeepCache,
  rainKeep,
  rainReach,
  rainWindScale,
  rainWindow,
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
  it('slants 14 degrees down-wind in a breeze: at height h the head is h * tan 14 UPWIND of its landing', () => {
    expect(RAIN_SLANT_TAN).toBeCloseTo(0.249328, 6);
    const p = dropPosition([0.3, 0.5, 0.7], { x: 0, z: 0 }, 32, 0, 0);
    // wind (0.70711, -0.70711): upwind is -x, +z.
    expect(p.landX - p.x).toBeCloseTo(p.height * 0.249328 * 0.70711, 5);
    expect(p.z - p.landZ).toBeCloseTo(p.height * 0.249328 * 0.70711, 5);
  });
  it('sits on the ground it lands on: y = groundY + height', () => {
    const p = dropPosition([0.3, 0.5, 0.7], { x: 0, z: 0 }, 32, 2, 1.75);
    expect(p.y - 1.75).toBeCloseTo(p.height, 9);
  });
});

describe('the splash', () => {
  it('grows 0.05 -> 0.20 wu over 260 ms (GH-940: it was 0.04 -> 0.10 over 150 ms)', () => {
    expect(splashRadius(0)).toBeCloseTo(0.05, 9);
    expect(splashRadius(130)).toBeCloseTo(0.125, 9);
    expect(splashRadius(260)).toBeCloseTo(0.2, 9);
    expect(splashRadius(900)).toBeCloseTo(0.2, 9);
    expect(splashRadius(-5)).toBeCloseTo(0.05, 9);
  });
  it('fades 0.5 -> 0 and is nothing outside its 260 ms', () => {
    expect(splashAlpha(0)).toBeCloseTo(0.5, 9);
    expect(splashAlpha(130)).toBeCloseTo(0.25, 9);
    expect(splashAlpha(259.9)).toBeGreaterThan(0);
    expect(splashAlpha(260)).toBe(0);
    expect(splashAlpha(-1)).toBe(0);
    expect(splashAlpha(2000)).toBe(0);
  });
  it('its age is the fall phase over the speed: 1.04 wu past the landing is 260 ms', () => {
    expect(splashAgeMs(0)).toBe(0);
    expect(splashAgeMs(1.04)).toBeCloseTo(260, 9);
  });
});

/** The ground points a screen sees, by NDC grid and drop height: the true camera does the projecting. */
function visibleLandings(v: RainView, ground = 0, wind = 1): { x: number; z: number; ndcx: number; ndcy: number; h: number }[] {
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
        // The drop is `h` above ground that stands `ground` up: its head is at y = ground + h.
        const t = (ground + h - p.y) / dir.y; // along the view ray to that plane
        const head = p.addScaledVector(dir, t);
        // The drop's landing point: its head, un-slanted (the head sits h * tan 14 deg * wind upwind of it;
        // tan 14 deg = 0.249328, a literal, not the constant under test).
        out.push({ x: head.x + 0.249328 * wind * h * 0.70710678, z: head.z - 0.249328 * wind * h * 0.70710678, ndcx, ndcy, h });
      }
    }
  }
  return out;
}

describe('coverage: the window holds every landing point the screen can see, off the map included (GH-940)', () => {
  for (const [fx, fz] of [[24, 24], [4, 4], [44, 44], [4, 44], [24, 45], [-6, 54]] as const) {
    it.each(ZOOMS)(`focus (${fx},${fz}) zoom %s: every visible drop's landing lies inside the window, in a lull, a breeze and the strongest gust`, (zoom) => {
      const v = view(fx, fz, zoom);
      const { period: P, low: lo } = rainWindow(v);
      let checked = 0;
      let offMap = 0;
      for (const wind of [0.8, 1, 2.1]) {
        for (const L of visibleLandings(v, 0, wind)) {
          checked++;
          if (L.x < 0 || L.x > 48 || L.z < 0 || L.z > 48) offMap++;
          expect(L.x, `x at ndc ${L.ndcx},${L.ndcy} h ${L.h} wind ${wind}`).toBeGreaterThanOrEqual(lo.x - 1e-6);
          expect(L.x).toBeLessThanOrEqual(lo.x + P + 1e-6);
          expect(L.z).toBeGreaterThanOrEqual(lo.z - 1e-6);
          expect(L.z).toBeLessThanOrEqual(lo.z + P + 1e-6);
        }
      }
      expect(checked, 'a vacuous check proves nothing').toBeGreaterThan(400);
      // Not vacuous the other way: at game zoom the screen DOES see off-map ground (the diamond's corners).
      if (zoom <= 1) expect(offMap, 'the old window was clipped to the map +-8: these are what it left dry').toBeGreaterThan(0);
    });
  }

  it('the box holds the whole unclipped footprint at zoom 1 (period 59.57, the box itself)', () => {
    const v = view(24, 24, 1);
    const box = footprintBox(v);
    const P = latticePeriod(box);
    // Half side (15.468 + 19.887) / sqrt2 = 25.0; the box is 2 x 25.0 + reach 7.349 + the gust's slant offset on
    // the one side it reaches toward, 6 x 0.249328 x 2.1 x sqrt(1/2) = 2.2214: 59.57 (hand-worked in the
    // oracle script, not read from the code).
    expect(P).toBeCloseTo(59.57, 2);
    const lo = windowLow(box, P);
    for (const L of visibleLandings(v, 0, 2.1)) {
      expect(L.x).toBeGreaterThanOrEqual(lo.x - 1e-6);
      expect(L.x).toBeLessThanOrEqual(lo.x + P + 1e-6);
      expect(L.z).toBeGreaterThanOrEqual(lo.z - 1e-6);
      expect(L.z).toBeLessThanOrEqual(lo.z + P + 1e-6);
    }
  });

  it('the period per zoom, mid-map, 1400x900 (literals worked by hand): the box itself, 152.43 at the 0.35 floor down to 29.57 at 2.5', () => {
    // side = 50.0 / zoom + 7.349 (reach 10.392 / sqrt2) + 2.221 (the gust offset): 152.43, 109.57, 59.57, 40.82, 29.57.
    const periods = ZOOMS.map((z) => rainWindow(view(24, 24, z)).period);
    for (const [got, want] of periods.map((g, i) => [g, [152.427, 109.57, 59.57, 40.82, 29.57][i]] as const)) expect(got).toBeCloseTo(want, 2);
  });

  it('the reach is the fall height seen up the screen: 6 / tan(30 deg) = 10.39', () => {
    expect(RAIN_REACH).toBeCloseTo(10.3923, 3);
  });

  it('a screen wider than the largest period thins at its far corners instead of failing (a 4K screen at the 0.35 floor)', () => {
    const wide = footprintBox({ x: 40, y: 40, zoom: 0.35, width: 3840, height: 2160 });
    expect(latticePeriod(wide)).toBe(320);
  });

  it('takes the box itself, clamped to [8, 320]: boxes of side 7, 9, 31, 33, 64, 100 and 400', () => {
    const sq = (w: number): GroundBox => ({ minX: 0, maxX: w, minZ: 0, maxZ: w });
    expect([7, 9, 31, 33, 64, 100, 400].map((w) => latticePeriod(sq(w)))).toEqual([8, 9, 31, 33, 64, 100, 320]);
  });
  it('is the larger side: a box 20 wide and 40 tall takes 40', () => {
    expect(latticePeriod({ minX: 0, maxX: 20, minZ: 0, maxZ: 40 })).toBe(40);
  });
});

describe('the period is a property of the zoom and the viewport, never of the pan (fix round 1)', () => {
  // The reviewer's finding: the period was chosen from the box CLIPPED to the map, so near a map edge the
  // box shrank and P dropped a step with no zoom change (zoom 1.6: 64 at the centre, 32 at (44,44)).
  const FOCI: ReadonlyArray<readonly [number, number]> = [[24, 24], [0, 0], [44, 44], [0, 44], [44, 0], [47, 47], [47, 0]];
  for (const zoom of [1.6, 1.9, 2.0, 2.2, 1, 0.5, 2.5]) {
    it(`zoom ${zoom}: the same period at the centre and at every corner, 1400x900 on a 48 map`, () => {
      const centre = rainWindow(view(24, 24, zoom)).period;
      for (const [x, y] of FOCI) expect(rainWindow(view(x, y, zoom)).period, `focus ${x},${y}`).toBe(centre);
    });
    it(`zoom ${zoom}: a one-tile pan sweep from the centre to the corner never changes it`, () => {
      const centre = rainWindow(view(24, 24, zoom)).period;
      for (let t = 0; t <= 48; t++) {
        expect(rainWindow(view(24 - t / 2, 24 - t / 2, zoom)).period, `t=${t}`).toBe(centre);
        expect(rainWindow(view(24 + t / 2, 24 + t / 2, zoom)).period, `t=${t}`).toBe(centre);
      }
    });
  }
  it('the periods themselves (literals worked by hand): the box side, 40.82 at zoom 1.6 down to 29.57 at 2.5', () => {
    const got = [1.6, 1.9, 2.0, 2.2, 2.5].map((z) => rainWindow(view(24, 24, z)).period);
    [40.82, 35.886, 34.57, 32.297, 29.57].forEach((want, i) => expect(got[i]).toBeCloseTo(want, 2));
  });
  it('the window still covers every visible landing point at the corners (pan sweep, zooms 1.6 to 2.5)', () => {
    for (const zoom of [1.6, 2.0, 2.5]) {
      for (const [fx, fz] of FOCI) {
        const { period: P, low: lo } = rainWindow(view(fx, fz, zoom));
        for (const L of visibleLandings(view(fx, fz, zoom), 0, 2.1)) {
          expect(L.x).toBeGreaterThanOrEqual(lo.x - 1e-6);
          expect(L.x).toBeLessThanOrEqual(lo.x + P + 1e-6);
          expect(L.z).toBeGreaterThanOrEqual(lo.z - 1e-6);
          expect(L.z).toBeLessThanOrEqual(lo.z + P + 1e-6);
        }
      }
    }
  });
});

describe('the reach grows with the ground (fix round 1, minor 2)', () => {
  it('is (6 + g) / tan 30 deg: 10.39 on flat ground, 14.37 over the highest drawn ground (2.3 wu)', () => {
    expect(rainReach(0)).toBeCloseTo(10.3923, 3);
    expect(rainReach(2.3)).toBeCloseTo(14.3760, 3);
    expect(rainReach(-5)).toBeCloseTo(10.3923, 3);
  });
  it('a landing point on high ground, seen up the screen, lies inside the box built with that ground', () => {
    const g = 2.3;
    for (const zoom of ZOOMS) {
      const v = view(24, 24, zoom);
      const box = footprintBox(v, g);
      for (const L of visibleLandings(v, g, 2.1)) {
        expect(L.x).toBeLessThanOrEqual(box.maxX + 1e-6);
        expect(L.z).toBeLessThanOrEqual(box.maxZ + 1e-6);
        expect(L.x).toBeGreaterThanOrEqual(box.minX - 1e-6);
        expect(L.z).toBeGreaterThanOrEqual(box.minZ - 1e-6);
      }
    }
  });
  it('and the flat-ground box would NOT hold them (the check is not vacuous)', () => {
    const v = view(24, 24, 1);
    const flat = footprintBox(v);
    expect(visibleLandings(v, 2.3, 2.1).some((L) => L.x > flat.maxX + 1e-6 || L.z > flat.maxZ + 1e-6)).toBe(true);
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

describe('the map-edge fade (GH-871 P4 T12 fix): rain stops at the edge of the world', () => {
  it('is 1 inside, 0 on the edge and beyond, a smoothstep over the half tile between (literals)', () => {
    expect(mapEdgeFade(24, 24, 48, 48)).toBe(1);
    expect(mapEdgeFade(0.5, 24, 48, 48)).toBe(1);
    expect(mapEdgeFade(0, 24, 48, 48)).toBe(0);
    expect(mapEdgeFade(48, 24, 48, 48)).toBe(0);
    expect(mapEdgeFade(24, 0, 48, 48)).toBe(0);
    expect(mapEdgeFade(24, 48, 48, 48)).toBe(0);
    expect(mapEdgeFade(-3, 24, 48, 48)).toBe(0);
    expect(mapEdgeFade(24, 51, 48, 48)).toBe(0);
    // 0.25 tile in: t = 0.5, smoothstep = 0.5. 0.125 in: t = 0.25 -> 0.15625. 0.375 in: 0.84375.
    expect(mapEdgeFade(0.25, 24, 48, 48)).toBeCloseTo(0.5, 12);
    expect(mapEdgeFade(0.125, 24, 48, 48)).toBeCloseTo(0.15625, 12);
    expect(mapEdgeFade(47.625, 24, 48, 48)).toBeCloseTo(0.84375, 12);
  });

  it('reads the NEAREST edge, on both axes, and a non-square map keeps W and H straight', () => {
    expect(mapEdgeFade(24, 0.25, 48, 48)).toBeCloseTo(0.5, 12);
    expect(mapEdgeFade(47.75, 24, 48, 48)).toBeCloseTo(0.5, 12);
    expect(mapEdgeFade(24, 47.75, 48, 48)).toBeCloseTo(0.5, 12);
    // 64 wide, 32 tall: x = 40 is deep inside, z = 31.75 is 0.25 from the far z edge.
    expect(mapEdgeFade(40, 31.75, 64, 32)).toBeCloseTo(0.5, 12);
    expect(mapEdgeFade(40, 20, 64, 32)).toBe(1);
    expect(mapEdgeFade(63.75, 16, 64, 32)).toBeCloseTo(0.5, 12);
  });
});

describe('the keep seeds (S-L2 ruling 2)', () => {
  const N = 6000;
  const keeps = Array.from({ length: N }, (_, i) => dropKeepSeed(i));
  it('are in [0,1), the same every time, spread flat (a quarter in each quartile +-10%)', () => {
    for (const k of keeps) expect(k >= 0 && k < 1).toBe(true);
    expect(dropKeepSeed(17)).toBe(dropKeepSeed(17));
    for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]] as const) {
      const q = keeps.filter((k) => k >= lo && k < hi).length / N;
      expect(q, `[${lo}, ${hi})`).toBeGreaterThan(0.225);
      expect(q, `[${lo}, ${hi})`).toBeLessThan(0.275);
    }
  });
  it('are independent of where a drop lands and how high it falls (correlation with the three position seeds under 0.05)', () => {
    const seeds = Array.from({ length: N }, (_, i) => dropSeed(i));
    const corr = (a: readonly number[], b: readonly number[]): number => {
      const ma = a.reduce((t, v) => t + v, 0) / a.length;
      const mb = b.reduce((t, v) => t + v, 0) / b.length;
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i < a.length; i++) {
        ab += (a[i] - ma) * (b[i] - mb);
        aa += (a[i] - ma) ** 2;
        bb += (b[i] - mb) ** 2;
      }
      return ab / Math.sqrt(aa * bb);
    };
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(corr(keeps, seeds.map((s) => s[axis]))), `axis ${axis}`).toBeLessThan(0.05);
    }
  });
  it('a kept set is nested: raising the keep fraction only ever adds instances', () => {
    const at = (k: number): Set<number> => new Set(keeps.flatMap((s, i) => (s < k ? [i] : [])));
    const a = at(0.3);
    const b = at(0.6);
    for (const i of a) expect(b.has(i)).toBe(true);
    expect(b.size).toBeGreaterThan(a.size);
  });
});

describe('the footprint in the lattice window (footprintAreaInWindow), hand-worked', () => {
  it('a screen the window holds is its own footprint 4ab: zoom 2.5 = 4 x 6.187 x 7.955 = 196.9', () => {
    // a = 1400 / (64 x 2.5 x sqrt2) = 6.187; b = 900 / (32 x 2.5 x sqrt2) = 7.955.
    expect(footprintAreaInWindow({ zoom: 2.5, width: 1400, height: 900 }, 320)).toBeCloseTo(196.9, 0);
  });
  it('the 0.35 floor in a window that holds it is 4 x 44.194 x 56.821 = 10,044.6', () => {
    expect(footprintAreaInWindow({ zoom: 0.35, width: 1400, height: 900 }, 320)).toBeCloseTo(10044.6, 0);
  });
  it('a smaller window clips it: the turned rectangle against a 64 square keeps 4,000 of the 4,096 (its corners are cut)', () => {
    const a = footprintAreaInWindow({ zoom: 0.35, width: 1400, height: 900 }, 64);
    expect(a).toBeLessThanOrEqual(4096);
    expect(a).toBeGreaterThan(3900);
  });
  it('a footprint moved wholly out of the window is 0, and moved half way out keeps about half', () => {
    const v = { zoom: 2.5, width: 1400, height: 900 };
    expect(footprintAreaInWindow(v, 64, 100, 100)).toBe(0);
    expect(footprintAreaInWindow(v, 64, -100, 0)).toBe(0);
    const slid = footprintAreaInWindow(v, 64, 32, 0);
    expect(slid).toBeLessThan(196.9);
    expect(slid).toBeGreaterThan(60);
  });
  it('is 0 for a view of no size', () => {
    expect(footprintAreaInWindow({ zoom: 2.5, width: 0, height: 0 }, 64)).toBe(0);
  });
});

describe('the area whose drops are in view (footprintAreaInView), against a brute-force walk', () => {
  /**
   * The same definition, written the other way round: each 0.25-tile cell of a 400-tile plane, at 32
   * heights through the fall, is a landing point; it is in view when its head's ground point, un-moved
   * by the height's shift, lies inside the rectangle |along (1,-1)/sqrt2| <= a, |along (-1,-1)/sqrt2| <= b.
   */
  function bruteArea(zoom: number, period: number): number {
    const a = 1400 / (64 * zoom * Math.SQRT2);
    const b = 900 / (32 * zoom * Math.SQRT2);
    const towards = 1 / (Math.SQRT2 * Math.tan(Math.PI / 6));
    const tan14 = 0.249328;
    let inView = 0;
    const K = 32;
    const cells = Math.round(period * 4);
    for (let k = 0; k < K; k++) {
      const h = ((k + 0.5) / K) * 6;
      const sx = h * (towards + tan14 * Math.SQRT1_2);
      const sz = h * (towards - tan14 * Math.SQRT1_2);
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          // the window is the period square about the origin; the footprint is centred on the origin
          const wx = (i + 0.5) / 4 - period / 2;
          const wz = (j + 0.5) / 4 - period / 2;
          const along = (wx - sx - (wz - sz)) * Math.SQRT1_2;
          const up = (-(wx - sx) - (wz - sz)) * Math.SQRT1_2;
          if (Math.abs(along) <= a && Math.abs(up) <= b) inView++;
        }
      }
    }
    return inView / K / 16;
  }
  it.each([0.35, 0.5, 1, 1.6, 2.5])('zoom %s: within 1.5% of the walk, in the window the zoom picks', (zoom) => {
    const period = rainWindow(view(24, 24, zoom)).period;
    const got = footprintAreaInView({ zoom, width: 1400, height: 900 }, period);
    const want = bruteArea(zoom, period);
    expect(Math.abs(got / want - 1), `${got.toFixed(1)} against ${want.toFixed(1)}`).toBeLessThan(0.015);
  });
  it('with no map to clip to the shift changes nothing until the window clips: zoom 1 in a wide window is the plain 4ab = 1,230.5', () => {
    expect(footprintAreaInView({ zoom: 1, width: 1400, height: 900 }, 320)).toBeCloseTo(1230.5, 0);
  });
  it('and the window DOES bite at the cap: the same screen at the 0.35 floor in a 64 window is under a half of its 10,044', () => {
    expect(footprintAreaInView({ zoom: 0.35, width: 1400, height: 900 }, 64)).toBeLessThan(5000);
  });
});

describe('the keep memo', () => {
  it('two updates at equal inputs compute the keep once; a zoom, a viewport or a period change computes it again; the value is the uncached one', () => {
    const cache = new RainKeepCache();
    const v = { zoom: 1.6, width: 1400, height: 900 };
    const a = rainKeep(v, 40.82, cache);
    const b = rainKeep(v, 40.82, cache);
    expect([cache.misses, cache.hits]).toEqual([1, 1]);
    expect(b).toBe(a);
    expect(a).toBe(rainKeep(v, 40.82));
    rainKeep({ ...v, zoom: 1.7 }, 40.82, cache);
    rainKeep({ ...v, width: 1500 }, 40.82, cache);
    rainKeep(v, 44, cache);
    expect([cache.misses, cache.hits]).toEqual([4, 1]);
  });
  it('rainWindow with a cache across a pan: one miss, the rest hits, and the same window as uncached', () => {
    const cache = new RainKeepCache();
    for (let t = 0; t <= 20; t++) {
      const v = view(24 - t, 24 + t / 2, 1.3);
      expect(rainWindow(v, 0, cache)).toEqual(rainWindow(v, 0));
    }
    expect([cache.misses, cache.hits]).toEqual([1, 20]);
  });
});

describe('the keep fraction (S-L2 ruling 2): literals worked by hand', () => {
  // keep = min(1, 0.22 x P^2 / A), A the whole footprint (no map to clip to, GH-940).
  it('zoom 0.35 (P 152.43): 0.22 x 152.427^2 / 10,044.6 = 0.5089', () => {
    expect(rainKeep({ zoom: 0.35, width: 1400, height: 900 }, 152.427)).toBeCloseTo(0.5089, 3);
  });
  it('zoom 1.6 (P 40.82): 0.22 x 40.82^2 / 480.7 = 0.7627', () => {
    expect(rainKeep({ zoom: 1.6, width: 1400, height: 900 }, 40.82)).toBeCloseTo(0.7627, 2);
  });
  it('zoom 2.5 over the highest ground (P 32.39, A 197): 0.22 x 32.39^2 / 197 = 1.17, so 1: a screen that cannot hold the count keeps all it has', () => {
    expect(rainKeep({ zoom: 2.5, width: 1400, height: 900 }, 32.387)).toBe(1);
  });
  it('is never above 1 and never below 0 over every zoom, either ground', () => {
    for (const g of [0, 2.3]) {
      for (let z = 0.35; z <= 2.5001; z += 0.05) {
        const v = view(24, 24, z);
        const k = rainWindow(v, g).keep;
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThanOrEqual(1);
      }
    }
  });
  it('is a function of the zoom and the viewport, never the focus (nor the map: there is no map argument): rainWindow returns the same keep from every corner', () => {
    for (const z of ZOOMS) {
      const centre = rainWindow(view(24, 24, z)).keep;
      for (const [x, y] of [[0, 0], [44, 44], [0, 44], [44, 0], [47, 47], [10.37, 31.9], [-9, 60]] as const) {
        expect(rainWindow(view(x, y, z)).keep, `z${z} focus ${x},${y}`).toBe(centre);
      }
    }
  });
  it('the extent is the box side to the last digit, whatever the focus (the period must not follow the pan at the 15th digit)', () => {
    for (const z of ZOOMS) {
      const e = footprintExtent(view(24, 24, z), 0);
      for (const [x, y] of [[0, 0], [44, 44], [10.37, 31.9], [47.1, 3.3]] as const) {
        const b = footprintBox(view(x, y, z));
        expect(b.maxX - b.minX).toBeCloseTo(e, 9);
        expect(rainWindow(view(x, y, z)).period).toBe(rainWindow(view(24, 24, z)).period);
        // ...and over the highest drawn ground (2.3 wu), whose reach widens the box
        const eg = footprintExtent(view(24, 24, z), 2.3);
        const bg = footprintBox(view(x, y, z), 2.3);
        expect(bg.maxX - bg.minX).toBeCloseTo(eg, 9);
        expect(bg.maxZ - bg.minZ).toBeCloseTo(eg, 9);
        expect(eg - e).toBeCloseTo(2.3 / Math.tan(Math.PI / 6) / Math.SQRT2, 9);
        expect(rainWindow(view(x, y, z), 2.3).period).toBe(rainWindow(view(24, 24, z), 2.3).period);
      }
    }
  });
});

describe('the wind (GH-940): slanted rain and gusts on the sim clock', () => {
  it('is 1 + a slow meander of 0.2 over 8.3 s, plus 0.9 at a gust`s peak (literals)', () => {
    // t = 0: gust phase 0 (the bump starts at 0), meander sin 0 = 0 -> exactly 1.
    expect(rainWindScale(0)).toBeCloseTo(1, 12);
    // t = 1.25 s: the middle of the first gust (width 2.5 s), sin^2(pi/2) = 1 -> bump 1; meander sin(2 pi 1.25 / 8.3) = 0.8135.
    expect(rainWindScale(1.25)).toBeCloseTo(1 + 0.2 * Math.sin((2 * Math.PI * 1.25) / 8.3) + 0.9, 12);
    expect(rainWindScale(1.25)).toBeCloseTo(2.0627, 3);
    // t = 5 s: between gusts (the next is at 11 s), so the scale is the meander alone: 1 + 0.2 sin(2 pi 5 / 8.3) = 0.9...
    expect(rainWindScale(5)).toBeCloseTo(1 + 0.2 * Math.sin((2 * Math.PI * 5) / 8.3), 12);
  });
  it('stays in [0.8, 2.1] over a long walk of the clock, reaching both ends nearly (not a constant)', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 600; t += 0.05) {
      const w = rainWindScale(t);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    expect(lo).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(hi).toBeLessThanOrEqual(2.1 + 1e-9);
    expect(lo).toBeLessThan(0.85);
    expect(hi).toBeGreaterThan(2.0);
    expect(RAIN_WIND_MAX).toBeCloseTo(2.1, 12);
  });
  it('the gust is the foliage`s own: the scale peaks where the sway`s gust does, every 11 s', () => {
    const at = (t: number) => rainWindScale(t) - 1 - 0.2 * Math.sin((2 * Math.PI * t) / 8.3);
    expect(at(1.25)).toBeCloseTo(0.9, 12);
    expect(at(12.25)).toBeCloseTo(0.9, 12);
    expect(at(23.25)).toBeCloseTo(0.9, 12);
    expect(at(6)).toBeCloseTo(0, 12);
  });
  it('a head is further up-wind the stronger the wind: at height 6 the offset is 6 x tan 14 deg x scale', () => {
    const seed: [number, number, number] = [0.5, 0.0, 0.5];
    const lo = { x: 0, z: 0 };
    const calm = dropPosition(seed, lo, 8, 0, 0, 1);
    const gust = dropPosition(seed, lo, 8, 0, 0, 2.1);
    // The head is `height` up-wind of the landing: at phase 0 the height is 6 (the top of the fall).
    const dx = (p: { x: number; landX: number }) => p.landX - p.x;
    expect(dx(calm)).toBeCloseTo(6 * 0.249328 * Math.SQRT1_2, 5);
    expect(dx(gust)).toBeCloseTo(6 * 0.249328 * 2.1 * Math.SQRT1_2, 5);
    expect(RAIN_SLANT_TAN).toBeCloseTo(0.249328, 6);
  });
});
