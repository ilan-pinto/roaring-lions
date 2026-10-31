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
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
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
/**
 * The two water reflectances (R-5, GH-871 P4 T4), authored, not Fresnel: the
 * share of the sky (`overcast.0`) the water surface mixes in, as the lead
 * picked them from the 0.20 / 0.25 / 0.35 A/B at S-L1 (30 Oct): road puddles
 * 0.35, marsh water 0.25. `PUDDLE_REFLECT` is the road ruts' puddles (and the
 * crater water, which shares the uniform); `MARSH_REFLECT` is the marsh water.
 * The values are on the drawn scale: the sky term is lit once more by the
 * ~0.74 irradiance. The ground material's `uPuddleReflect` / `uMarshReflect`
 * start here, and `ThreeRenderer.debugSetWetTuning` (the A/B's only door)
 * writes them.
 */
export const PUDDLE_REFLECT = 0.35;
export const MARSH_REFLECT = 0.25;

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

// ---------------------------------------------------------------------------
// The falling rain (GH-871 P4 T8; R-7, R-8). `units/rain-maths.ts` is the pure
// maths over these, `units/rain-batch.ts` the one draw.
// ---------------------------------------------------------------------------

/** Fall speed, world units (tiles) a second: 12 m/s. */
export const RAIN_FALL_SPEED = 4.0;
/** The slab the rain falls through, above the ground: 6 world units. */
export const RAIN_FALL_HEIGHT = 6;
/** The slant of a drop's path from the vertical, degrees, down-wind. */
export const RAIN_SLANT_DEG = 12;
/** A streak's length along its path, world units. */
export const RAIN_STREAK_LENGTH = 0.42;
/** A streak's width on screen, CSS pixels, at every zoom (the constant-pixel rule). */
export const RAIN_STREAK_CSS_PX = 1.5;
/** A streak's alpha. */
export const RAIN_STREAK_ALPHA = 0.28;
/** The splash ring: radius 0.04 -> 0.10 world units over 150 ms after the drop lands. */
export const RAIN_SPLASH_R0 = 0.04;
export const RAIN_SPLASH_R1 = 0.1;
export const RAIN_SPLASH_MS = 150;
/** The splash's alpha, 0.35 -> 0 over its life. */
export const RAIN_SPLASH_ALPHA = 0.35;
/** How far a splash ring floats over the ground it lands on, world units: a ring
 *  is flat and a slope would bury one side of it. */
export const RAIN_SPLASH_LIFT = 0.04;
/** Palette keys: the streak's colour and the splash's. */
export const RAIN_STREAK_KEY = 'overcast.0';
export const RAIN_SPLASH_KEY = 'overcast.1';
/** The smallest and the largest lattice period, tiles (R-7, as amended by S-L2 ruling 2): the
 *  period is no longer snapped to {8, 16, 32, 64} but continuous in between, the box of landing
 *  points the screen can see itself (`latticePeriod`), so the drops a screen holds change smoothly
 *  with the zoom and a keep fraction (`rainKeep`) can hold their number. The largest still binds:
 *  a map wider than 48 tiles at the lowest zoom thins at its far corners. */
export const RAIN_PERIOD_MIN = 8;
export const RAIN_PERIOD_MAX = 64;
/** The on-screen drop count the rain holds at every zoom, as a share of a preset's `drops` (S-L2
 *  ruling 2): 0.22, so 1,320 of high's 6,000, 770 of medium's 3,500 and 115.5 of low's 525 (the
 *  lead's 1,400 scaled by the preset total is 0.233; +-20% of that is the band the tests assert).
 *  It is about the most every zoom can reach: with the period at the box (`latticePeriod`) the
 *  lattice holds `area / P^2` of its drops on screen, 0.22 at the highest zoom on flat ground,
 *  0.204 over ein_qasab's ~1 wu and 0.184 over the highest drawn ground (2.3 wu), so 0.22 is exact
 *  (keep < 1) wherever the screen is wider and reached to 93% over 1 wu, 84% over 2.3 wu. */
export const RAIN_DENSITY_FRACTION = 0.22;
/** The share a period must exceed the box by. R-7 says "footprint padded 10%"; the
 *  box (`rain-maths.ts` `footprintBox`) already carries the exact margins a pad stands
 *  in for -- the height of the fall seen up the screen (`H / tan(elevation)`, 10.4
 *  tiles) and the slant (1.3), 14% to 40% of a footprint -- so no second pad. */
export const RAIN_PERIOD_PAD = 1;
// Tried at 1.02 (S-L2 fix round 1): the coverage and pan tests pass, but over the 2.3 wu extreme the
// highest zoom then holds 1,028 on screen at high against the 1,050 floor (1,087 at 1.00), so it stays 1.
/** The ground-height texture's resolution: texels a tile. */
export const RAIN_HEIGHT_TEXELS_PER_TILE = 4;
/** The bloom bar (CLAUDE.md, "Bloom"; `bloom.ts` thresholds at 1.0): the largest
 *  scene-referred channel of a rain colour must stay under it, so rain never
 *  blooms and `hdr-gains.ts` gets no entry. */
export const RAIN_COLOUR_CEILING = 0.9;

/**
 * The count ladder (R-8): the fractions of a preset's `drops` the cost run
 * steps through when the preset is over budget -- x1.0, x0.6, x0.35, then no
 * falling rain at all (the wet ground stays). A step is a one-line edit to that
 * preset's `drops`, committed with its measurement. On `low`, whose first step
 * used to be the open-puddle flag, the first step is now drops 1500 -> 900: the
 * lead removed the open-ground puddle terms at S-L1.
 */
export const RAIN_LADDER: readonly number[] = [1, 0.6, 0.35, 0];

/** `drops` after `step` steps down `RAIN_LADDER` (0 is today's count). */
export function rainLadderDrops(drops: number, step: number): number {
  const f = RAIN_LADDER[Math.min(Math.max(step, 0), RAIN_LADDER.length - 1)];
  return Math.round(drops * f);
}

/**
 * The rain fields of a quality preset, `high`'s when it has none: an absent
 * `quality` or an absent `quality.rain` is "no opinion" (a test fake builds no
 * rain fields), and `high` is the frame every shipped caller has seen.
 */
export function rainQualityOf(quality: RenderQuality | undefined): { drops: number; ripples: boolean } {
  return quality?.rain ?? QUALITY_PRESETS.high.rain ?? { drops: 6000, ripples: true };
}
