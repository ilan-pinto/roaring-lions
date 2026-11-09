/**
 * The TS mirror of the `THEME_WET` ground GLSL (GH-871 P4 Task 4), driven with
 * LITERALS: every expected number below was worked by hand or by an
 * independent script (a Python port of `tileHash` and the ring maths), never
 * read back from the code under test. `mesh.test.ts` pins the other half --
 * that the compiled GLSL carries these constants.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tileHash } from '../../tile-hash';
import {
  capOffset,
  edgeDistanceTiles,
  rimWeight,
  rippleAt,
  rippleRaw,
  rippleReflect,
  tiltDegrees,
  waterAlbedo,
  waterCoverage,
  wetRoughness,
  RIPPLE_PHASE_STREAM,
  RIPPLE_TILT_DEG,
  RIPPLE_TILT_TAN,
  RIPPLE_X_STREAM,
  RIPPLE_Z_STREAM,
} from './wet-shading';

describe('wet-shading.ts stays pure', () => {
  it('imports the tile hash and the rim width, and nothing else', () => {
    const path = fileURLToPath(new URL('./wet-shading.ts', import.meta.url));
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => /^\s*import\b/.test(l));
    expect(lines).toEqual(["import { tileHash } from '../../tile-hash';", "import { WATER_RIM_TILES } from './wet-masks';"]);
  });
});

describe('the water surface', () => {
  it('mixes 0.55 x the floor toward the sky by the reflectance, per channel', () => {
    // (1 - 0.25) * 0.55 * floor + 0.25 * sky, by hand.
    const got = waterAlbedo([0.2, 0.1, 0.05], 0.25, [0.4, 0.5, 0.6]);
    expect(got[0]).toBeCloseTo(0.1825, 12);
    expect(got[1]).toBeCloseTo(0.16625, 12);
    expect(got[2]).toBeCloseTo(0.170625, 12);
  });
  it('is the dark floor at reflectance 0 and the sky at reflectance 1', () => {
    expect(waterAlbedo([0.2, 0.1, 0.05], 0, [0.4, 0.5, 0.6])).toEqual([0.2 * 0.55, 0.1 * 0.55, 0.05 * 0.55]);
    expect(waterAlbedo([0.2, 0.1, 0.05], 1, [0.4, 0.5, 0.6])).toEqual([0.4, 0.5, 0.6]);
  });
  it('covers by a smoothstep of the soft mask around its 0.5 crossing', () => {
    expect(waterCoverage(0.4)).toBe(0);
    expect(waterCoverage(0.3)).toBe(0);
    expect(waterCoverage(0.5)).toBe(0.5);
    expect(waterCoverage(0.6)).toBe(1);
    expect(waterCoverage(0.9)).toBe(1);
    // t = 0.25: 3 t^2 - 2 t^3 = 0.15625.
    expect(waterCoverage(0.45)).toBeCloseTo(0.15625, 12);
  });
  it('swings the reflectance by up to 15%, and keeps it a reflectance', () => {
    expect(rippleReflect(0.25, 0)).toBe(0.25);
    expect(rippleReflect(0.25, 1)).toBeCloseTo(0.2875, 12);
    expect(rippleReflect(0.25, -1)).toBeCloseTo(0.2125, 12);
    expect(rippleReflect(0.95, 1)).toBe(1);
    expect(rippleReflect(0, 1)).toBe(0);
  });
});

describe('the rim', () => {
  it('reads the distance to the 0.5 crossing off the mask gradient, land side only', () => {
    expect(edgeDistanceTiles(0.3, 4)).toBeCloseTo(0.05, 12);
    expect(edgeDistanceTiles(0.1, 8)).toBeCloseTo(0.05, 12);
    // Inside the water there is no land-side distance.
    expect(edgeDistanceTiles(0.6, 4)).toBe(0);
    // A flat mask has no edge: the gradient is floored at 0.001, so m = 0 is 500 tiles away.
    expect(edgeDistanceTiles(0, 0)).toBeCloseTo(500, 9);
  });
  it('is 1 at the edge, 0.5 at 0.03 tile, and 0 at and beyond 0.06 tile', () => {
    expect(rimWeight(0)).toBe(1);
    expect(rimWeight(0.03)).toBeCloseTo(0.5, 12);
    // t = 0.25 -> smoothstep 0.15625.
    expect(rimWeight(0.015)).toBeCloseTo(0.84375, 12);
    expect(rimWeight(0.06)).toBe(0);
    expect(rimWeight(0.5)).toBe(0);
  });
});

describe('the roughness', () => {
  it('is open 0.62, road mud 0.45, basalt 0.55, water 0.08 at full weight', () => {
    expect(wetRoughness({ road: 0, rock: 0, water: 0 })).toBe(0.62);
    expect(wetRoughness({ road: 1, rock: 0, water: 0 })).toBeCloseTo(0.45, 12);
    expect(wetRoughness({ road: 0, rock: 1, water: 0 })).toBeCloseTo(0.55, 12);
    expect(wetRoughness({ road: 0, rock: 0, water: 1 })).toBeCloseTo(0.08, 12);
  });
  it('blends each surface by its own weight, in the order road, basalt, water', () => {
    expect(wetRoughness({ road: 0.5, rock: 0, water: 0 })).toBeCloseTo(0.535, 12);
    // road 1 -> 0.45; half water -> halfway to 0.08.
    expect(wetRoughness({ road: 1, rock: 0, water: 0.5 })).toBeCloseTo(0.265, 12);
    // water covers whatever is under it.
    expect(wetRoughness({ road: 1, rock: 1, water: 1 })).toBeCloseTo(0.08, 12);
  });
});

describe('the ripples', () => {
  it('pins the constants the shader is built from', () => {
    expect(RIPPLE_TILT_DEG).toBe(8);
    // tan(8 degrees), worked independently.
    expect(RIPPLE_TILT_TAN).toBeCloseTo(0.14054083470239145, 12);
    expect(RIPPLE_X_STREAM).toEqual([14621, 14731]);
    expect(RIPPLE_Z_STREAM).toEqual([14843, 14957]);
    expect(RIPPLE_PHASE_STREAM).toEqual([15061, 15173]);
  });

  it('hashes with tileHash: two literals worked in an independent port', () => {
    expect(tileHash(1 + 14621, 2 + 14731)).toBeCloseTo(0.1808835871051997, 14);
    expect(tileHash(5, 7)).toBeCloseTo(0.9253859769087285, 14);
  });

  it('draws two rings a cell: literal samples (Python port of the same maths)', () => {
    const a = rippleAt(1.6, 2.27, 0.3);
    expect(a.offsetX).toBeCloseTo(0.03131604, 8);
    expect(a.offsetZ).toBeCloseTo(0.005774613, 8);
    expect(a.swing).toBeCloseTo(-0.217017493, 8);
    const b = rippleAt(1.6, 2.33, 0.3);
    expect(b.offsetX).toBeCloseTo(-0.085050002, 8);
    expect(b.offsetZ).toBeCloseTo(0.056199895, 8);
    expect(b.swing).toBeCloseTo(0.729615032, 8);
  });

  it('is flat where no ring is: a cell corner, and the origin at time 0', () => {
    expect(rippleAt(1.5, 2.0, 0.3)).toEqual({ offsetX: 0, offsetZ: 0, swing: 0 });
    expect(rippleAt(0, 0, 0)).toEqual({ offsetX: 0, offsetZ: 0, swing: 0 });
  });

  it('runs on the clock it is given: the same time reads the same, a life later reads the same, a tick later does not', () => {
    const t = 0.08;
    const a = rippleAt(1.64, 2.32, t);
    expect(rippleAt(1.64, 2.32, t)).toEqual(a);
    const later = rippleAt(1.64, 2.32, t + 0.9);
    expect(later.offsetX).toBeCloseTo(a.offsetX, 9);
    expect(later.offsetZ).toBeCloseTo(a.offsetZ, 9);
    const tick = rippleAt(1.64, 2.32, t + 0.05);
    expect(Math.abs(tick.offsetX - a.offsetX) + Math.abs(tick.offsetZ - a.offsetZ)).toBeGreaterThan(0.01);
  });

  it('caps the summed tilt at 8 degrees: a literal point where two rings add past it', () => {
    const raw = rippleRaw(1.64, 2.32, 0.08);
    // Uncapped, the two rings tilt this point to atan(0.2013) = 11.38 degrees.
    expect(raw.offsetX).toBeCloseTo(-0.084032387, 8);
    expect(raw.offsetZ).toBeCloseTo(0.182908095, 8);
    expect(tiltDegrees(raw.offsetX, raw.offsetZ)).toBeGreaterThan(11.3);
    const capped = rippleAt(1.64, 2.32, 0.08);
    expect(capped.offsetX).toBeCloseTo(-0.058672094, 8);
    expect(capped.offsetZ).toBeCloseTo(0.127707915, 8);
    expect(tiltDegrees(capped.offsetX, capped.offsetZ)).toBeCloseTo(8, 9);
    expect(capped.swing).toBe(1);
  });

  it('capOffset scales an over-long offset down to tan 8 degrees and leaves a short one alone', () => {
    // (0.3, 0.4) has length 0.5; 0.140541 / 0.5 = 0.281082.
    const [x, z] = capOffset(0.3, 0.4);
    expect(x).toBeCloseTo(0.0843245, 6);
    expect(z).toBeCloseTo(0.1124327, 6);
    expect(capOffset(0.05, -0.02)).toEqual([0.05, -0.02]);
  });

  it('never tilts past 8 degrees anywhere, and the cap is binding somewhere (not vacuous)', () => {
    let over = 0;
    let maxDeg = 0;
    let rings = 0;
    let disagree = 0;
    let maxSwing = 0;
    for (let cx = 1; cx < 5; cx++) {
      for (let cz = 3; cz < 6; cz++) {
        for (let ti = 0; ti < 45; ti++) {
          for (let ix = 0; ix < 20; ix++) {
            for (let iz = 0; iz < 20; iz++) {
              const px = cx * 0.5 + (ix * 0.5) / 20;
              const pz = cz * 0.5 + (iz * 0.5) / 20;
              const t = ti * 0.02;
              const raw = rippleRaw(px, pz, t);
              const [ox, oz] = capOffset(raw.offsetX, raw.offsetZ);
              // `rippleAt` is `rippleRaw` capped: it must agree with the cap applied here.
              const cap = rippleAt(px, pz, t);
              disagree = Math.max(disagree, Math.abs(cap.offsetX - ox), Math.abs(cap.offsetZ - oz));
              const deg = tiltDegrees(cap.offsetX, cap.offsetZ);
              maxDeg = Math.max(maxDeg, deg);
              if (deg > 1e-9) rings++;
              if (tiltDegrees(raw.offsetX, raw.offsetZ) > RIPPLE_TILT_DEG + 1e-6) over++;
              maxSwing = Math.max(maxSwing, Math.abs(cap.swing));
            }
          }
        }
      }
    }
    // The ring pixels exist, the cap bound on some of them (18 of 216,000 here;
    // 64 of 810,000 in the wider scan of the independent port), nothing is past
    // the cap and the maximum is the cap. Asserted once, after the loop: an
    // `expect` per sample costs more than the maths does.
    expect(rings).toBeGreaterThan(2000);
    expect(over).toBeGreaterThanOrEqual(10);
    expect(maxDeg).toBeLessThanOrEqual(RIPPLE_TILT_DEG + 1e-9);
    expect(maxDeg).toBeCloseTo(8, 6);
    expect(maxSwing).toBeLessThanOrEqual(1);
    expect(disagree).toBeLessThan(1e-12);
  });

  it('is continuous across a cell edge: a ring never crosses into the next cell, band included', () => {
    // `rippleRaw` reads ONE cell, so a ring that reached past its cell's edge
    // would step there. The centre margin (radius + half the band) is what
    // keeps every ring whole; this walks every edge of a 4x4 block at 45 times.
    let worst = 0;
    for (let k = 1; k < 4; k++) {
      for (let ti = 0; ti < 45; ti++) {
        for (let i = 0; i < 40; i++) {
          const along = 0.5 + (i * 3) / 40 + 0.0123;
          const t = ti * 0.02;
          const e = k * 0.5;
          for (const [a, b] of [
            [rippleRaw(e - 1e-9, along, t), rippleRaw(e + 1e-9, along, t)],
            [rippleRaw(along, e - 1e-9, t), rippleRaw(along, e + 1e-9, t)],
          ]) {
            worst = Math.max(worst, Math.abs(a.offsetX - b.offsetX) + Math.abs(a.offsetZ - b.offsetZ) + Math.abs(a.swing - b.swing));
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('uses stream offsets no other source uses (fresh), six distinct numbers', () => {
    const nums = [14621, 14731, 14843, 14957, 15061, 15173];
    expect(new Set(nums).size).toBe(6);
    const here = fileURLToPath(new URL('./wet-shading.ts', import.meta.url));
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); // packages/
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && p !== here) {
          const text = readFileSync(p, 'utf8');
          for (const n of nums) if (new RegExp(`\\b${n}\\b`).test(text)) hits.push(`${p}: ${n}`);
        }
      }
    };
    for (const pkg of ['render', 'app', 'sim', 'data']) walk(join(root, pkg, 'src'));
    // `mesh.ts` interpolates them from this file; none retypes one.
    expect(hits).toEqual([]);
  });
});
