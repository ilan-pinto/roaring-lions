// packages/render/src/three/time-of-day.test.ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
// `packages/render` may not import `@lions/data` (the package rule in
// eslint.config), so the palette is read by path, exactly as
// `ThreeRenderer.test.ts` pins its own swatches.
import paletteJson from '../../../../data/palette.json';
import {
  DAY_SUN_DIRECTION,
  TIME_OF_DAY_PRESETS,
  resolveTimeOfDay,
  rotateAzimuth,
  sunDirectionFor,
} from './time-of-day';
import { GROUND_BOUNCE_COLOR_HEX, SKY_COLOR_HEX, SUN_COLOR_HEX, SUN_DIRECTION } from './lighting';

const ramps = paletteJson.ramps as Record<string, { colors: string[] } | undefined>;
function paletteColor(key: string): string {
  const [band, index] = key.split('.');
  const hex = ramps[band ?? '']?.colors[Number(index)];
  if (hex === undefined) throw new Error(`no palette entry ${key}`);
  return hex;
}

const deg = (r: number): number => (r * 180) / Math.PI;
const elevation = (v: readonly number[]): number => deg(Math.asin((v[1] ?? 0) / Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)));
const azimuth = (v: readonly number[]): number => deg(Math.atan2(-(v[2] ?? 0), v[0] ?? 0));

describe('time of day (N-20, N-21, D10)', () => {
  it('resolves night to dusk and nothing to day', () => {
    expect(resolveTimeOfDay('night')).toBe('dusk');
    expect(resolveTimeOfDay(undefined)).toBe('day');
    expect(resolveTimeOfDay('dawn')).toBe('dawn');
    expect(resolveTimeOfDay('day')).toBe('day');
    expect(resolveTimeOfDay('dusk')).toBe('dusk');
  });

  it('rotates +X toward -Z for a positive angle (N-21)', () => {
    const [x, z] = rotateAzimuth(1, 0, 90);
    expect(x).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(-1, 12);
  });

  // toEqual compares with Object.is, so this is a bit comparison, not a tolerance.
  it("gives day today's sun, to the bit", () => {
    const d = sunDirectionFor(TIME_OF_DAY_PRESETS.day);
    const today = new THREE.Vector3(-0.406, 0.819, 0.406).normalize(); // lighting.ts's original literal
    expect([d[0], d[1], d[2]]).toEqual([today.x, today.y, today.z]);
    expect([SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z]).toEqual([today.x, today.y, today.z]);
  });

  it.each([
    ['dawn', 22, -35],
    ['dusk', 18, 35],
  ] as const)('%s: %i degrees up, %i degrees round from today', (t, el, az) => {
    const v = sunDirectionFor(TIME_OF_DAY_PRESETS[t]);
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
    expect(elevation(v)).toBeCloseTo(el, 9);
    expect(azimuth(v) - azimuth(DAY_SUN_DIRECTION)).toBeCloseTo(az, 9);
  });

  it('keeps every sun at 18 degrees or more (the fitted shadow box)', () => {
    for (const p of Object.values(TIME_OF_DAY_PRESETS)) {
      expect(elevation(sunDirectionFor(p))).toBeGreaterThanOrEqual(18 - 1e-9);
    }
  });

  // `day` byte-identical rests on the palette still holding today's hexes.
  it("names palette keys whose hexes are today's day constants", () => {
    const day = TIME_OF_DAY_PRESETS.day;
    expect(paletteColor(day.sunKey).toUpperCase()).toBe(SUN_COLOR_HEX);
    expect(paletteColor(day.skyKey).toUpperCase()).toBe(SKY_COLOR_HEX);
    expect(paletteColor('dust.4').toUpperCase()).toBe(GROUND_BOUNCE_COLOR_HEX);
    expect(day.sunFallback).toBe(SUN_COLOR_HEX);
    expect(day.skyFallback).toBe(SKY_COLOR_HEX);
    expect(day.sunIntensity).toBe(2.6);
    expect(day.hemiIntensity).toBe(0.9);
    expect(day.hazeFar).toBe(0.12);
  });

  it('carries the approved dawn and dusk rows', () => {
    expect(TIME_OF_DAY_PRESETS.dawn).toMatchObject({
      sunKey: 'limestone.1',
      sunIntensity: 2.0,
      skyKey: 'water.0',
      hemiIntensity: 0.75,
      hazeFar: 0.16,
      hazeKey: null,
    });
    expect(TIME_OF_DAY_PRESETS.dusk).toMatchObject({
      sunKey: 'dust.0',
      sunIntensity: 1.8,
      skyKey: 'gunmetal.1',
      hemiIntensity: 0.7,
      hazeFar: 0.18,
      hazeKey: 'dust.1',
    });
  });

  // Every fallback is the hex its own key names today, so a renderer with no
  // `resolveColor` (every test fake) lights a preset exactly as the app does.
  it('gives every preset fallbacks that are its own keys, as the palette holds them', () => {
    for (const p of Object.values(TIME_OF_DAY_PRESETS)) {
      expect(paletteColor(p.sunKey).toUpperCase()).toBe(p.sunFallback.toUpperCase());
      expect(paletteColor(p.skyKey).toUpperCase()).toBe(p.skyFallback.toUpperCase());
    }
  });
});
