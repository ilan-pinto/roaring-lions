/**
 * The time-of-day presets: one sun, three hours of it (ground plan 2, Task 8;
 * N-20, N-21, spec §3.6 "Presets").
 *
 * Pure: no `three`. `lighting.ts` turns a preset into lights and
 * `ThreeRenderer` resolves its palette keys through `overlayColor`, so this
 * file holds only numbers and palette KEYS, plus each key's hex, read from
 * `data/palette.json`, for a caller with no `resolveColor` (every test fake).
 *
 * **`day` is today, and today is the constants, not this table.** Its
 * `elevationDeg` is `null`, meaning "`lighting.ts`'s literal, normalised the
 * way `Vector3.normalize` normalises it", and `ThreeRenderer` does not build
 * day's lights from these rows at all: it passes `DAY_LIGHTS`, which names
 * `lighting.ts`'s own constants. A day rebuilt from the table would come
 * within an ulp of today, and "within an ulp" is not "byte-identical" -- the
 * sun at the rig's nominal 55 degrees is NOT today's sun, because
 * `(-0.406, 0.819, 0.406)` is a rounded literal that sits at 54.97. The
 * `day` row exists so the three presets read as one table and so a test can
 * pin that its keys still name today's hexes.
 *
 * Dawn and dusk turn today's sun about the vertical and then re-pitch it
 * (N-21): `x' = x cos(phi) + z sin(phi)`, `z' = -x sin(phi) + z cos(phi)`,
 * so a positive angle turns `+X` toward `-Z`, and the horizontal part is
 * rescaled to the preset's elevation. Every sun stays at 18 degrees or more,
 * which is the elevation the map-wide shadow box is proved for
 * (`lighting.test.ts`).
 *
 * `night` is not a light (D10): it resolves to `dusk`.
 */
import { paletteHex } from './palette-hex';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type LitTimeOfDay = 'dawn' | 'day' | 'dusk';

/**
 * PA-24 (lead ruling L3): one mission's lift on top of its preset, from the
 * mission JSON's optional `map.light`. `fill` replaces the hemisphere
 * intensity; `shadow` is the sun's `shadow.intensity` (1 = full strength,
 * three r170). Each field absent leaves the preset's own value.
 */
export interface LightOverride {
  readonly fill?: number;
  readonly shadow?: number;
}

export interface LightPreset {
  /** null = today's SUN_DIRECTION exactly (day); else the elevation in degrees. */
  readonly elevationDeg: number | null;
  readonly azimuthOffsetDeg: number;
  readonly sunKey: string;
  readonly sunFallback: string;
  readonly sunIntensity: number;
  readonly skyKey: string;
  readonly skyFallback: string;
  readonly hemiIntensity: number;
  /** Haze at +20 tiles (N-18, N-20). */
  readonly hazeFar: number;
  /** null = the theme's own haze tone (`TerrainTones.haze`); else a palette key. */
  readonly hazeKey: string | null;
}

/** The ground bounce on every preset (N-21): the spec gives no dawn or dusk
 *  bounce, so all three keep today's. */
export const BOUNCE_KEY = 'dust.4';

export const TIME_OF_DAY_PRESETS: Readonly<Record<LitTimeOfDay, LightPreset>> = {
  dawn: {
    elevationDeg: 22,
    azimuthOffsetDeg: -35,
    sunKey: 'limestone.1',
    sunFallback: paletteHex('limestone.1'),
    sunIntensity: 2.0,
    skyKey: 'water.0',
    skyFallback: paletteHex('water.0'),
    hemiIntensity: 0.75,
    hazeFar: 0.16,
    hazeKey: null,
  },
  day: {
    elevationDeg: null,
    azimuthOffsetDeg: 0,
    sunKey: 'limestone.0',
    sunFallback: paletteHex('limestone.0'),
    sunIntensity: 2.6,
    skyKey: 'water.0',
    skyFallback: paletteHex('water.0'),
    hemiIntensity: 0.9,
    hazeFar: 0.12,
    hazeKey: null,
  },
  dusk: {
    elevationDeg: 18,
    azimuthOffsetDeg: 35,
    sunKey: 'dust.0',
    sunFallback: paletteHex('dust.0'),
    sunIntensity: 1.8,
    skyKey: 'gunmetal.1',
    skyFallback: paletteHex('gunmetal.1'),
    hemiIntensity: 0.7,
    hazeFar: 0.18,
    hazeKey: 'dust.1',
  },
};

/** `lighting.ts`'s literal, unnormalised: the rig's 135/55 side light
 *  (`lighting.ts` header has the derivation). */
export const DAY_SUN_DIRECTION: readonly [number, number, number] = [-0.406, 0.819, 0.406];

/** `undefined` -> day, `night` -> dusk (D10). */
export function resolveTimeOfDay(t: TimeOfDay | undefined): LitTimeOfDay {
  if (t === undefined) return 'day';
  if (t === 'night') return 'dusk';
  return t;
}

/** N-21: a positive angle turns `+X` toward `-Z`. */
export function rotateAzimuth(x: number, z: number, deg: number): [number, number] {
  const phi = (deg * Math.PI) / 180;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * The to-sun direction a preset names. For `day` (`elevationDeg === null`)
 * this is the literal normalised with three r170's `Vector3.normalize`
 * arithmetic, in its order -- `divideScalar(length() || 1)`, which is
 * `multiplyScalar(1 / Math.sqrt(x * x + y * y + z * z))` -- so it equals
 * `SUN_DIRECTION` to the bit. Dawn and dusk are unit length.
 */
export function sunDirectionFor(p: LightPreset): readonly [number, number, number] {
  const [x, y, z] = DAY_SUN_DIRECTION;
  if (p.elevationDeg === null) {
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    return [x * inv, y * inv, z * inv];
  }
  const [rx, rz] = rotateAzimuth(x, z, p.azimuthOffsetDeg);
  const h = Math.hypot(rx, rz);
  const el = (p.elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [(rx / h) * cosEl, Math.sin(el), (rz / h) * cosEl];
}
