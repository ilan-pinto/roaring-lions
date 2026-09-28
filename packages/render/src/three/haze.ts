/**
 * The dust haze (ground plan 2, Task 9; N-18, N-19, R-13, R-14): the curve,
 * as pure numbers. `fog-pass.ts` carries the same expression in GLSL, with
 * every constant below interpolated into its source, and `fog-pass.test.ts`
 * pins that it does -- `hazeAmount` and the shader are a mirror pair.
 *
 * Pure: no `three`. The camera's view direction is restated here rather than
 * imported from `camera.ts` (which imports `three`); `haze.test.ts` pins the
 * two against each other.
 *
 * **What it is.** Dust, not fog: a mix toward the theme's haze tone that is
 * 0 at the focus plane -- the camera's look-at point -- and rises linearly to
 * the preset's `hazeFar` at `HAZE_RAMP_TILES` further AWAY from the camera,
 * measured along the horizontal view direction. On flat ground "further
 * ahead" is exactly "higher on screen" (the test that checks it against
 * `isoY` is the claim Task 0's mock rested on), so the top of the frame
 * wears the most dust and the ground in front of the camera none. Nothing
 * nearer than the focus plane is hazed at all.
 *
 * **The low-lying term** adds up to `HAZE_LOW` on ground below the map's
 * median open-ground level, reaching it `HAZE_LOW_LEVELS` levels down -- dust
 * pools in the low ground. It is measured from the MEDIAN, not from level 0
 * (N-19): on absolute level 2, every flat map would wear a uniform 6% veil,
 * where measured from its own median a flat map gets no low-lying term at
 * all. Ground above the reference gets none either; the term only adds.
 */

/** Tiles ahead of the focus plane at which the far haze reaches `hazeFar`. */
export const HAZE_RAMP_TILES = 20;
/** The most the low-lying term adds (N-18: "+6% below 2 levels"). */
export const HAZE_LOW = 0.06;
/** Levels below the reference at which the low-lying term is full. */
export const HAZE_LOW_LEVELS = 2;

/**
 * Away from the camera, horizontally: -(VIEW_DIRECTION.x, VIEW_DIRECTION.z),
 * normalised. `camera.ts` puts the camera at `+x`/`+z` of its target with
 * equal components (`AZIMUTH = SQRT1_2` on both), so this is (-1, -1)/sqrt 2,
 * the N-19 direction.
 */
export const HAZE_FORWARD: readonly [number, number] = [-Math.SQRT1_2, -Math.SQRT1_2];

/** Tiles from the focus plane to world point (px, pz), positive AWAY from the camera. */
export function aheadOf(px: number, pz: number, focusX: number, focusZ: number): number {
  return (px - focusX) * HAZE_FORWARD[0] + (pz - focusZ) * HAZE_FORWARD[1];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The haze mix at a point `aheadTiles` beyond the focus plane and
 *  `levelsBelowRef` levels below the reference. The shader's expression. */
export function hazeAmount(aheadTiles: number, levelsBelowRef: number, far: number): number {
  return far * clamp01(aheadTiles / HAZE_RAMP_TILES) + HAZE_LOW * clamp01(levelsBelowRef / HAZE_LOW_LEVELS);
}

/**
 * Median elevation level over unblocked tiles; 0 with no elevation grid
 * (N-19). The LOWER median on an even count, so the reference is always a
 * level some open tile actually stands on. A map with no open tile at all
 * (never shipped) answers 0.
 */
export function hazeReferenceLevel(input: {
  width: number;
  height: number;
  elevation: Uint8Array | null;
  blocked: Uint8Array;
}): number {
  const { elevation, blocked } = input;
  if (elevation === null) return 0;
  // Elevation is one digit per tile (0-9): a counting median, no sort.
  const counts = new Array<number>(256).fill(0);
  let open = 0;
  const n = input.width * input.height;
  for (let i = 0; i < n; i++) {
    if (blocked[i] !== 0) continue;
    counts[elevation[i] ?? 0]++;
    open++;
  }
  if (open === 0) return 0;
  const rank = (open - 1) >> 1;
  let seen = 0;
  for (let level = 0; level < counts.length; level++) {
    seen += counts[level] ?? 0;
    if (seen > rank) return level;
  }
  return 0;
}

/**
 * (sunIntensity * sunY + hemiIntensity) / PI: lit open ground's
 * scene-referred scale (R-13). The fog pass runs on the composer's HalfFloat
 * target BEFORE tone mapping, where lit ground reads near
 * `albedo * this`; a tint left at its bare linear value would darken bright
 * ground and read as a grey film. Scaled by the same factor, the haze tone
 * sits where that tone would sit as lit ground, and dusk's haze is dimmer by
 * exactly the ratio its light is.
 */
export function hazeRadiance(sunIntensity: number, sunY: number, hemiIntensity: number): number {
  return (sunIntensity * sunY + hemiIntensity) / Math.PI;
}
