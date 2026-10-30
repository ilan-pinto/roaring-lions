/**
 * GH-871 P4 Task 2: `rainLight`, the shadow step and the rain haze. Every
 * expectation below is a LITERAL (hexes, intensities, counts), none read back
 * from `weather.ts`'s own constants.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rainLight, rainShadowMapSize } from './weather';
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

describe('weather.ts stays three-free', () => {
  it('imports nothing from three, and only the type of time-of-day', () => {
    const path = fileURLToPath(new URL('./weather.ts', import.meta.url));
    const importLines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));
    expect(importLines).toEqual(["import type { LightPreset } from './time-of-day';"]);
  });
});
