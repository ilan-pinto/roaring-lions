/**
 * Terrain tones, composited the way Pixi composites them, then quantised to
 * the palette.
 *
 * Pixi tints the ground by layering alpha fills over its own clear colour:
 * open ground at `0.92 + rnd * 0.08` (or `0.96 + rnd * 0.04` on sward), a road
 * tone at `0.85` over that, `underBuilding` at `0.22` over that. The composite
 * of two palette entries is NOT a palette entry -- reproducing that blending
 * faithfully would put off-palette colour across most of the screen, exactly
 * what Phase 0 measured and Phase B1 installed a pipeline to prevent.
 *
 * So: composite in plain sRGB byte space, the way Pixi's alpha fill does --
 * no linear conversion here, that is the GPU-side pipeline's job -- then snap
 * the result to the nearest `data/palette.json` entry. The look survives, and
 * the palette guarantee survives with it.
 */
import { tileHash } from '../../tile-hash';
import type { TerrainTones } from '../../api';
import type { TerrainInput } from './types';

// `data/palette.json` imported directly, not through `@lions/data`: CLAUDE.md
// and renderer.ts:116-120/640 both establish that `@lions/render` must not
// depend on `@lions/data` (TERRAIN_DECOR is redeclared there for the same
// reason). This is the same JSON file `@lions/data`'s `palette` export reads
// -- no second parser, no transcribed copy -- just read directly rather than
// through the package boundary render is not allowed to cross.
import paletteJson from '../../../../../data/palette.json';
import { DECOR_ROAD, DECOR_RIDGE } from './shared';

/** Every colour in `data/palette.json`, flattened. Derived, not transcribed:
 *  a hand-copied list goes stale silently the first time the palette changes,
 *  and `quantise` would start snapping to a partial palette without a single
 *  failing test pointing at why. */
const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
const reserved = paletteJson.reserved as Record<string, { colors: Record<string, string> }>;

export const PALETTE_HEXES: readonly string[] = [
  ...Object.values(ramps).flatMap((ramp) => ramp.colors),
  ...Object.values(reserved).flatMap((band) => Object.values(band.colors)),
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

/**
 * sRGB-space alpha composite, hex in, hex out -- the same arithmetic Pixi's
 * `Graphics.fill({ color, alpha })` performs against whatever is already on
 * screen. Deliberately not linear: the goal is to reproduce the byte value
 * Pixi produces, then quantise it, not to relight it.
 */
export function composite(base: string, over: string, alpha: number): string {
  const [br, bg, bb] = hexToRgb(base);
  const [or, og, ob] = hexToRgb(over);
  return rgbToHex(br * (1 - alpha) + or * alpha, bg * (1 - alpha) + og * alpha, bb * (1 - alpha) + ob * alpha);
}

/**
 * Nearest palette entry to `hex`, by squared Euclidean distance in RGB. Not
 * perceptually ideal, and it does not need to be: every input reaching this
 * function is a near-miss of a palette entry by construction (a composite of
 * palette colours), so the nearest entry is unambiguous.
 *
 * Total over its input: `palette` is never empty in practice (it is always
 * `PALETTE_HEXES`, which the last test in tones.test.ts asserts has more than
 * 40 entries), so this always returns one of `palette`'s own entries -- no
 * hex, known or not, can produce an off-palette output.
 */
export function quantise(hex: string, palette: readonly string[]): string {
  const [r, g, b] = hexToRgb(hex);
  let best = palette[0];
  let bestDist = Infinity;
  for (const candidate of palette) {
    const [cr, cg, cb] = hexToRgb(candidate);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * The lighter neighbour of `hex` within ITS OWN named ramp, `steps` entries
 * toward index 0 (the lightest step -- this module's own imports read
 * straight from `data/palette.json`'s `ramps`, where that convention lives).
 * Used to build a "lit" variant of a terrain TONE (`buildGround`'s own
 * `litColors` output) for the muzzle-flash ramp-shift effect
 * (`../palette-material.ts`'s "The muzzle-flash 'light'" doc comment) --
 * terrain has no normal and no per-vertex ramp/index bookkeeping the way
 * `toonRampMaterial` does (this module's own top comment: terrain is
 * "composited... then quantised", a single already-resolved hex with no
 * ramp identity preserved past that point), so the lighter step has to be
 * computed from the TONE itself, once, before compositing -- not from the
 * final quantised vertex colour, which may not even be a member of `hex`'s
 * own ramp (a composite of two different ramps' entries quantises to
 * whichever of ALL ~65 colours is nearest, not necessarily one from either
 * source ramp).
 *
 * Falls back to returning `hex` UNCHANGED when it is not found in any named
 * ramp -- a graceful no-op (the flash simply has nothing to shift toward at
 * that tile) rather than a throw, since a caller may pass a `background` or
 * tone value this function was never guaranteed to recognise (a `reserved`-
 * band colour, for instance, which `ramps` here deliberately excludes -- see
 * `PALETTE_HEXES`'s own two-source concatenation above).
 */
export function rampNeighbor(hex: string, steps: number): string {
  const upper = hex.toUpperCase();
  for (const ramp of Object.values(ramps)) {
    const idx = ramp.colors.findIndex((c) => c.toUpperCase() === upper);
    if (idx !== -1) {
      return ramp.colors[Math.max(0, idx - steps)];
    }
  }
  return hex;
}

/**
 * Pixi's per-tile ground-tone decision (`drawTerrain`), reproduced in the
 * same order and quantised once at the end:
 *
 * | tile                        | Pixi source          | composite |
 * |------------------------------|----------------------|-----------|
 * | open ground (either scatter) | renderer.ts:1514-1518| `open` at a fixed alpha -- see below |
 * | road                         | renderer.ts:1522-1525| open wash, then `road` at `0.85` |
 * | under a (sprited) structure  | renderer.ts:1489-1491| `open` at `0.92 + rnd * 0.08`, then `underBuilding` at `0.22` |
 * | blocked, ridge decor         | renderer.ts:1439-1452| `rock` at `0.92` |
 *
 * `rnd` is `tileHash(x, y)` -- the same per-tile hash Pixi's `h2` produces,
 * extracted verbatim in Task B2.1. `background` is the base beneath the
 * first fill on every tile: Pixi never clears `terrainG` to anything else,
 * so the canvas's own clear colour (`RendererOptions.background`) is what a
 * `< 1` alpha reveals underneath. It is a parameter here rather than an
 * import so this module stays a pure function of its inputs.
 *
 * The open-ground wash uses a FIXED alpha, not Pixi's per-tile hash jitter
 * (`0.92 + rnd * 0.08`, or `0.96 + rnd * 0.04` on sward) -- a Task B2.5
 * review ruling. Quantised, that jitter's raw range does not survive as
 * texture: sweeping `rnd` over the `arid` theme's own tones lands on exactly
 * two palette entries, assigned by tile hash, which is a checkerboard by
 * construction rather than the smooth per-tile variation Pixi's continuous
 * alpha produces. Quantisation makes it worse, not just flatter: the
 * darker of the two entries sits outside the jitter's own continuous range,
 * so the step between adjacent tiles ends up LARGER than the entire range
 * Pixi's jitter ever spanned. Any alpha from 0.96 to 1.0 quantises to the
 * same single entry for `arid`, so 1.0 is used -- the simplest value that
 * settles the choice, not a tuned one. `buildScatter`'s grain now supplies
 * the per-tile texture the jitter was standing in for, which is what makes
 * dropping it free rather than a loss. The under-building wash (the other
 * `openWash` below) keeps its jitter -- it was not what this ruling measured
 * or asked to change, and a building's footprint is small enough that its
 * checkerboard, if any, was never the complaint.
 */
export function groundTone(
  input: TerrainInput,
  tones: TerrainTones,
  ti: number,
  palette: readonly string[],
  background: string
): string {
  const x = ti % input.width;
  const y = Math.floor(ti / input.width);
  const rnd = tileHash(x, y);
  const decorHere = input.decor ? input.decor[ti] : 0;

  if (input.blocked[ti] !== 0) {
    if (decorHere === DECOR_RIDGE) {
      return quantise(composite(background, tones.rock, 0.92), palette);
    }
    const openWash = composite(background, tones.open, 0.92 + rnd * 0.08);
    return quantise(composite(openWash, tones.underBuilding, 0.22), palette);
  }

  const openWash = composite(background, tones.open, 1);

  if (decorHere === DECOR_ROAD) {
    return quantise(composite(openWash, tones.road, 0.85), palette);
  }

  return quantise(openWash, palette);
}
