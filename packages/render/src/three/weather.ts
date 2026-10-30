/**
 * The rain's light and air (GH-871 P4, Task 2; R-1, R-2, R-3).
 *
 * Pure, and three-free on purpose (the `decal-maths.ts` pattern, pinned by
 * `weather.test.ts`): `rainLight` returns the sun's direction as numbers and
 * `ThreeRenderer`'s constructor builds the `Vector3`. Everything here keys on
 * ONE switch, `RendererOptions.weather === 'rain'`; a map that does not rain
 * never calls into this file, so its light, haze and shadow map are today's.
 *
 * `rainLight` cannot act on a `LightPreset` row alone. `day` is not built from
 * the preset table: `ThreeRenderer` passes `DAY_LIGHTS` (`lighting.ts`'s own
 * constants), and dawn and dusk come from `presetLights(row)`. So it takes
 * those RESOLVED lights plus the preset's haze fields, keeps the sun's
 * DIRECTION (rain at dawn is still dawn), and returns new lights with the haze
 * and shadow settings. A mission's `lightOverride` is applied AFTER it (the
 * mission wins); the open-ground irradiance `(sunI * sun.y + hemiI) / pi` goes
 * 0.964 -> 0.741 on `day`.
 */
import type { LightPreset } from './time-of-day';

/** The sun's power under rain: x0.46, on any preset (day 2.6 -> 1.196). */
export const RAIN_SUN_SCALE = 0.46;
/** The sky fill under rain: x1.5, on any preset (ruling Q2; day 0.9 -> 1.35). */
export const RAIN_FILL_SCALE = 1.5;
/** `sun.shadow.intensity` under rain (a mission's own `shadow` still wins). */
export const RAIN_SHADOW = 0.45;
/** Haze at +20 tiles under rain, on every preset. The cap (G-5) is this value. */
export const RAIN_HAZE_FAR = 0.26;
/** The low-lying haze under rain; compiled into the fog pass. The cap (G-5). */
export const RAIN_HAZE_LOW = 0.1;
/** Palette keys: the sun's colour, the sky's colour and the haze's tone. */
export const RAIN_SUN_KEY = 'overcast.0';
export const RAIN_SKY_KEY = 'overcast.1';
export const RAIN_HAZE_KEY = 'overcast.1';
/** The shadow map's floor, in texels per side. */
export const RAIN_SHADOW_FLOOR = 1024;

/** What `rainLight` reads of a resolved light (`lighting.ts`'s `ResolvedLights`
 *  satisfies it; its `direction` is a `Vector3`, which has x, y and z). */
export interface RainLightsIn {
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
  readonly sunHex: string;
  readonly sunIntensity: number;
  readonly skyHex: string;
  readonly bounceHex: string;
  readonly hemiIntensity: number;
}

/** The same lights with the direction as plain numbers. */
export interface RainLightsOut {
  readonly direction: readonly [number, number, number];
  readonly sunHex: string;
  readonly sunIntensity: number;
  readonly skyHex: string;
  readonly bounceHex: string;
  readonly hemiIntensity: number;
}

export interface RainLight {
  readonly lights: RainLightsOut;
  readonly hazeFar: number;
  /** A palette key, resolved by the caller (overrides a preset's own, dusk's `dust.1`). */
  readonly hazeKey: string;
  readonly hazeLow: number;
  /** `sun.shadow.intensity`. */
  readonly shadowIntensity: number;
  /** How many steps down the shadow map goes (`rainShadowMapSize`). */
  readonly shadowStep: number;
}

export function rainLight(
  lights: RainLightsIn,
  preset: Pick<LightPreset, 'hazeFar'>,
  resolve: (key: string) => string
): RainLight {
  return {
    lights: {
      direction: [lights.direction.x, lights.direction.y, lights.direction.z],
      sunHex: resolve(RAIN_SUN_KEY),
      sunIntensity: lights.sunIntensity * RAIN_SUN_SCALE,
      skyHex: resolve(RAIN_SKY_KEY),
      bounceHex: lights.bounceHex,
      hemiIntensity: lights.hemiIntensity * RAIN_FILL_SCALE,
    },
    // max(preset, 0.26), never above 0.26: every preset is at most 0.18.
    hazeFar: Math.min(RAIN_HAZE_FAR, Math.max(preset.hazeFar, RAIN_HAZE_FAR)),
    hazeKey: RAIN_HAZE_KEY,
    hazeLow: RAIN_HAZE_LOW,
    shadowIntensity: RAIN_SHADOW,
    shadowStep: 1,
  };
}

/** The shadow map's side after `steps` halvings, floored at `RAIN_SHADOW_FLOOR`
 *  (4096 -> 2048, 2048 -> 1024, 1024 -> 1024). */
export function rainShadowMapSize(size: number, steps: number): number {
  return Math.max(RAIN_SHADOW_FLOOR, size / 2 ** steps);
}
