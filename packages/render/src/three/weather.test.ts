/**
 * GH-871 P4 Task 2: `rainLight`, the shadow step and the rain haze. Every
 * expectation below is a LITERAL (hexes, intensities, counts), none read back
 * from `weather.ts`'s own constants.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MARSH_REFLECT,
  PUDDLE_REFLECT,
  RAIN_LADDER,
  RAIN_DENSITY_FRACTION,
  RAIN_PERIOD_MAX,
  RAIN_PERIOD_MIN,
  rainLadderDrops,
  rainLight,
  rainQualityOf,
  rainShadowMapSize,
} from './weather';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { TIME_OF_DAY_PRESETS } from './time-of-day';
import { paletteHex } from './palette-hex';

/** A resolved light, written out by hand: day's constants, dawn's and dusk's rows. */
const DAY = {
  direction: { x: -0.406, y: 0.819, z: 0.406 },
  sunHex: '#F2E8D5',
  sunIntensity: 2.6,
  skyHex: '#8DA2B3',
  bounceHex: '#A89A7E',
  hemiIntensity: 0.9,
};
const DAWN = {
  direction: { x: -0.41, y: 0.3746, z: 0.83 },
  sunHex: '#D7C7A3',
  sunIntensity: 2.0,
  skyHex: '#8DA2B3',
  bounceHex: '#A89A7E',
  hemiIntensity: 0.75,
};
const DUSK = { ...DAWN, sunIntensity: 1.8, hemiIntensity: 0.7 };
const resolve = (key: string): string => paletteHex(key);
const irradiance = (l: { sunIntensity: number; hemiIntensity: number; direction: readonly number[] }): number => {
  const [x, y, z] = l.direction;
  return (l.sunIntensity * (y / Math.hypot(x, y, z)) + l.hemiIntensity) / Math.PI;
};

describe('rainLight', () => {
  it('day under rain: the overcast sun and sky, the scaled intensities', () => {
    const r = rainLight(DAY, TIME_OF_DAY_PRESETS.day, resolve);
    expect(r.lights.sunIntensity).toBeCloseTo(1.196, 12);
    expect(r.lights.sunHex.toUpperCase()).toBe('#C4C8C9');
    expect(r.lights.hemiIntensity).toBeCloseTo(1.35, 12);
    expect(r.lights.skyHex.toUpperCase()).toBe('#9FA9B5');
    expect(r.lights.bounceHex).toBe(DAY.bounceHex);
    expect(Math.abs(irradiance(r.lights) - 0.741)).toBeLessThan(0.001);
    const clear = { ...DAY, direction: [DAY.direction.x, DAY.direction.y, DAY.direction.z] };
    expect(Math.abs(irradiance(clear) - 0.964)).toBeLessThan(0.001);
    expect(r.shadowIntensity).toBe(0.45);
    expect(r.shadowStep).toBe(1);
    expect(r.hazeKey).toBe('overcast.1');
  });

  it("dawn under rain keeps dawn's direction and scales its intensities", () => {
    const r = rainLight(DAWN, TIME_OF_DAY_PRESETS.dawn, resolve);
    expect(Math.abs(r.lights.direction[0] - -0.41)).toBeLessThan(1e-12);
    expect(Math.abs(r.lights.direction[1] - 0.3746)).toBeLessThan(1e-12);
    expect(Math.abs(r.lights.direction[2] - 0.83)).toBeLessThan(1e-12);
    expect(r.lights.sunIntensity).toBeCloseTo(0.92, 12);
    expect(r.lights.hemiIntensity).toBeCloseTo(1.125, 12);
  });

  it("dusk under rain takes the rain's haze key, not dust.1", () => {
    // The preset row names dust.1 (a literal check that this IS the case the
    // override has to beat), and the result must not.
    expect(TIME_OF_DAY_PRESETS.dusk.hazeKey).toBe('dust.1');
    const r = rainLight(DUSK, TIME_OF_DAY_PRESETS.dusk, resolve);
    expect(r.hazeKey).toBe('overcast.1');
    expect(r.hazeKey).not.toBe('dust.1');
    expect(r.lights.sunIntensity).toBeCloseTo(0.828, 12);
    expect(r.lights.hemiIntensity).toBeCloseTo(1.05, 12);
  });

  it('hazeFar is 0.26 on all three presets, and nothing exceeds the 0.26 / 0.10 caps', () => {
    for (const [lights, row] of [
      [DAWN, TIME_OF_DAY_PRESETS.dawn],
      [DAY, TIME_OF_DAY_PRESETS.day],
      [DUSK, TIME_OF_DAY_PRESETS.dusk],
    ] as const) {
      const r = rainLight(lights, row, resolve);
      expect(r.hazeFar).toBe(0.26);
      expect(r.hazeFar).toBeLessThanOrEqual(0.26);
      expect(r.hazeLow).toBe(0.1);
      expect(r.hazeLow).toBeLessThanOrEqual(0.1);
    }
    // A preset already at the cap is not pushed past it.
    expect(rainLight(DAY, { hazeFar: 0.26 }, resolve).hazeFar).toBe(0.26);
    expect(rainLight(DAY, { hazeFar: 0.5 }, resolve).hazeFar).toBe(0.26);
  });

  it('steps the shadow map down once and floors it at 1024', () => {
    expect(rainShadowMapSize(4096, 1)).toBe(2048);
    expect(rainShadowMapSize(2048, 1)).toBe(1024);
    expect(rainShadowMapSize(1024, 1)).toBe(1024);
  });
});

describe('the water reflectances (R-5, GH-871 P4 T4)', () => {
  it('are the lead`s S-L1 picks: road puddles 0.35, marsh water 0.25', () => {
    expect(PUDDLE_REFLECT).toBe(0.35);
    expect(MARSH_REFLECT).toBe(0.25);
  });
});

describe('weather.ts stays three-free', () => {
  it('imports nothing from three: the quality table (itself three-free) and the type of time-of-day', () => {
    const path = fileURLToPath(new URL('./weather.ts', import.meta.url));
    const importLines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));
    expect(importLines).toEqual([
      "import { QUALITY_PRESETS, type RenderQuality } from '../quality';",
      "import type { LightPreset } from './time-of-day';",
    ]);
  });
});

describe('the rain count ladder (R-8, GH-871 P4 T8)', () => {
  it('is x1, x0.6, x0.35, then no falling rain', () => {
    expect(RAIN_LADDER).toEqual([1, 0.6, 0.35, 0]);
  });
  it('steps high 6000 -> 3600 -> 2100 -> 0, and low 1500 -> 900 as its first step', () => {
    expect([0, 1, 2, 3].map((s) => rainLadderDrops(6000, s))).toEqual([6000, 3600, 2100, 0]);
    expect([0, 1, 2, 3].map((s) => rainLadderDrops(1500, s))).toEqual([1500, 900, 525, 0]);
    expect(rainLadderDrops(3500, 1)).toBe(2100);
    // Clamped at both ends.
    expect(rainLadderDrops(6000, -2)).toBe(6000);
    expect(rainLadderDrops(6000, 9)).toBe(0);
  });
});

describe('rainQualityOf: absent means no opinion, and high`s', () => {
  it('reads each preset`s own rain fields', () => {
    expect(rainQualityOf(QUALITY_PRESETS.low)).toEqual({ drops: 900, ripples: false });
    expect(rainQualityOf(QUALITY_PRESETS.medium)).toEqual({ drops: 3500, ripples: true });
  });
  it('gives high`s to an absent quality and to a quality with no rain field (a test fake)', () => {
    expect(rainQualityOf(undefined)).toEqual({ drops: 6000, ripples: true });
    const noRain: Partial<RenderQuality> = { ...QUALITY_PRESETS.low };
    delete noRain.rain;
    expect(rainQualityOf(noRain as RenderQuality)).toEqual({ drops: 6000, ripples: true });
  });
});

describe('the lattice periods and the density hold', () => {
  it('the period runs continuously from 8 to 64 tiles (R-7 snapped it to 8, 16, 32, 64; S-L2 ruling 2)', () => {
    expect([RAIN_PERIOD_MIN, RAIN_PERIOD_MAX]).toEqual([8, 64]);
  });
  it('the density fraction is 0.22 of a preset`s drops: 1,320 of 6,000, 770 of 3,500, 198 of 900', () => {
    expect(RAIN_DENSITY_FRACTION).toBe(0.22);
    [6000, 3500, 900].forEach((n, i) => expect(n * RAIN_DENSITY_FRACTION).toBeCloseTo([1320, 770, 198][i], 9));
  });
});
