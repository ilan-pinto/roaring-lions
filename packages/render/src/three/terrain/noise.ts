/**
 * Seeded value noise for the ground's tone variation and road wander --
 * Task 3 of `docs/superpowers/sdd/2026-09-25-ground-plan-1`.
 *
 * Deterministic and three-free, like every other builder in this directory:
 * the same `(x, z, seed)` must produce the same field on every run and in
 * every backend, so `latticeValue` goes through the shared `tileHash` rather
 * than a per-process RNG. This is plain 2D value noise (bilinear over the
 * four surrounding lattice points, quintic-faded), not Perlin/gradient
 * noise -- the ground only needs a smooth scalar field, not a directional
 * derivative, and value noise is one hash lookup per corner instead of one
 * hash plus a dot product.
 */
import { tileHash } from '../../tile-hash';

/**
 * The noise field's value at integer lattice point `(i, j)` under `seed`, in
 * `[-1, 1)`.
 *
 * The two large odd multipliers push `seed` into a completely different part
 * of `tileHash`'s input space per axis (rather than, say, adding `seed` to
 * both `i` and `j` identically, which would just translate the same field
 * diagonally) so that two different seeds read as two unrelated fields
 * rather than one field shifted.
 */
export function latticeValue(i: number, j: number, seed: number): number {
  return tileHash(i + seed * 7919, j - seed * 6151) * 2 - 1;
}

/** Perlin's improved quintic fade, `t^3 * (t * (6t - 15) + 10)` -- `C1`
 *  continuous (zero slope at both `t = 0` and `t = 1`), unlike the linear
 *  fade `t` a naive bilinear lerp would use. That is what keeps
 *  `valueNoise2` free of slope breaks across lattice lines: a linear fade
 *  matches VALUE at each lattice line (both neighbouring cells agree on the
 *  edge value) but not slope, so the surface kinks there. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 2D value noise: bilinear interpolation over the four lattice values
 * surrounding `(x * cyclesPerTile, z * cyclesPerTile)`, faded with `fade`
 * on each axis. Result stays in `[-1, 1)`, the same range as
 * `latticeValue`, because a fade-weighted average of values in that range
 * cannot leave it.
 *
 * `cyclesPerTile` is literally that -- how many full noise cycles span one
 * world tile. At an exact lattice point (`x * cyclesPerTile` an integer)
 * this returns `latticeValue` exactly, since both fade weights are 0 there.
 */
export function valueNoise2(x: number, z: number, cyclesPerTile: number, seed: number): number {
  const sx = x * cyclesPerTile;
  const sz = z * cyclesPerTile;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const tx = fade(sx - ix);
  const tz = fade(sz - iz);

  const v00 = latticeValue(ix, iz, seed);
  const v10 = latticeValue(ix + 1, iz, seed);
  const v01 = latticeValue(ix, iz + 1, seed);
  const v11 = latticeValue(ix + 1, iz + 1, seed);

  const vx0 = v00 + (v10 - v00) * tx;
  const vx1 = v01 + (v11 - v01) * tx;
  return vx0 + (vx1 - vx0) * tz;
}

/**
 * Fractional Brownian motion: `octaves` layers of `valueNoise2`, starting at
 * frequency `1 / periodTiles` and doubling each octave while its amplitude
 * halves, each octave drawing from its own lattice (`seed + o`) so the
 * layers are independent fields rather than the same one resampled. The sum
 * is normalised by the sum of amplitudes actually used, so the result stays
 * in `[-1, 1)` regardless of `octaves` -- without the normalisation, more
 * octaves would push the range outward even though each layer alone stays
 * bounded.
 */
export function fbm2(x: number, z: number, periodTiles: number, octaves: number, seed: number): number {
  let frequency = 1 / periodTiles;
  let amplitude = 1;
  let sum = 0;
  let amplitudeSum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise2(x, z, frequency, seed + o);
    amplitudeSum += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return amplitudeSum > 0 ? sum / amplitudeSum : 0;
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Separable box blur: a horizontal running-mean pass over `2 * radius + 1`
 * samples, then the same pass vertically over the result. Samples past the
 * edge of the field clamp to the edge row/column rather than wrapping or
 * zero-padding, so a blurred constant field stays exactly that constant
 * (zero-padding would darken every border cell toward 0).
 *
 * `radius <= 0` is the identity -- returned as a fresh copy, since every
 * other caller in this module treats its inputs as immutable.
 */
export function boxBlur(field: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return Float32Array.from(field);

  const norm = 1 / (2 * radius + 1);
  const horizontal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += field[y * w + clampIndex(x + k, w)];
      horizontal[y * w + x] = sum * norm;
    }
  }

  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += horizontal[clampIndex(y + k, h) * w + x];
      out[y * w + x] = sum * norm;
    }
  }
  return out;
}
