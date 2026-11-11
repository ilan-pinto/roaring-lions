/**
 * GH-943 WebGPU P3 (T12): the billow noise and the atlas read the flipbook (`flipbook-fx.ts`) and the smoke screen (`../smoke-mesh.ts`)
 * share, written ONCE against `Ops<T>`. The two legacy shaders each carry their own copy of the same GLSL (the mock's sin-hash value
 * noise, its 4-octave fbm, the 8x8 atlas cell and the sun-side shade); the legacy text stays as it is (pinned by the specs), and the
 * node twins build their graphs from THIS module, so on the node side the copy-paste is one body.
 *
 *   hash(p)    fract(sin(dot(p, (127.1, 311.7))) * 43758.5453)
 *   vnoise(p)  bilinear over the four lattice hashes, smoothstep-eased (`f * f * (3 - 2f)`)
 *   fbm(p)     4 octaves, amplitude 0.5 halving, `p = p * 2.03 + 11.7` between them
 *   billow(q)  detail 2: (fbm(q) * 0.7 + fbm(q * 2.3 + 5.1) * 0.3) / 0.9375; detail 1: fbm(q) / 0.9375; detail 0: 0.5
 *   frameUv    frame k's cell, row 0 at the TOP of the image (`flipY` puts the top row at v = 1): ((k mod G, G-1-floor(k/G)) + local) / G
 *   sunShade   clamp(0.85 - 0.12 * dot(g, sun) + 0.30 * dot(uv, sun), 0.45, 1.3)
 *
 * The sin-hash is driver-precise only (a GPU `sin` of a large argument is not IEEE), so the GPU side is judged on a sheet, never by a
 * threshold drawn from it. On numbers (`NUMBER_OPS`) the bodies equal a literal reading of the legacy GLSL (`vfx-noise.test.ts`).
 *
 * THREE-FREE and import-free (one type import): the legacy files and the node twins can both reach it, the twins as VALUES through
 * `material-maths.ts` (a value import here would pull the legacy chunk into the node chunk).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { Ops } from '../fog-ops';

/** The sin-hash: `fract(sin(x * dotX + y * dotY) * scale)`. */
export const VFX_HASH = Object.freeze({ dotX: 127.1, dotY: 311.7, scale: 43758.5453 });
/** The fbm: `octaves` value-noise octaves from amplitude `amp0`, each `gain` of the last; `p = p * lacunarity + shift` between them. */
export const VFX_FBM = Object.freeze({ octaves: 4, amp0: 0.5, gain: 0.5, lacunarity: 2.03, shift: 11.7 });
/** The billow: two fbm chains, the second at `freq2` and offset `shift2`, weighted and normalised by `norm` (4 octaves sum to at most 0.9375). */
export const VFX_BILLOW = Object.freeze({ w1: 0.7, w2: 0.3, freq2: 2.3, shift2: 5.1, norm: 0.9375 });
/** The sun-side shade of a billow: `clamp(base - grad * dot(g, sun) + rim * dot(uv, sun), lo, hi)`. */
export const VFX_SHADE = Object.freeze({ base: 0.85, grad: 0.12, rim: 0.3, lo: 0.45, hi: 1.3 });

/** `FX_DETAIL`, the quality preset's `fxDetail`: 2 both fbm chains, 1 the first only, 0 none (a flat 0.5). */
export type VfxDetail = 0 | 1 | 2;

/** A 2-vector as two scalars (`Ops<T>` is scalar). */
export interface V2<T> {
  readonly x: T;
  readonly y: T;
}

/** GLSL `hash(vec2 p)`. */
export function vfxHashOps<T>(o: Ops<T>, x: T, y: T): T {
  const d = o.add(o.mul(x, o.lit(VFX_HASH.dotX)), o.mul(y, o.lit(VFX_HASH.dotY)));
  return o.fract(o.mul(o.sin(d), o.lit(VFX_HASH.scale)));
}

/** GLSL `vnoise(vec2 p)`: the four lattice hashes, mixed by the smoothstep-eased fraction. */
export function vfxValueNoiseOps<T>(o: Ops<T>, x: T, y: T): T {
  const ix = o.floor(x);
  const iy = o.floor(y);
  const fx = o.fract(x);
  const fy = o.fract(y);
  const ease = (f: T): T => o.mul(o.mul(f, f), o.sub(o.lit(3), o.mul(o.lit(2), f)));
  const ux = ease(fx);
  const uy = ease(fy);
  const one = o.lit(1);
  const h00 = vfxHashOps(o, ix, iy);
  const h10 = vfxHashOps(o, o.add(ix, one), iy);
  const h01 = vfxHashOps(o, ix, o.add(iy, one));
  const h11 = vfxHashOps(o, o.add(ix, one), o.add(iy, one));
  return o.mix(o.mix(h00, h10, ux), o.mix(h01, h11, ux), uy);
}

/** GLSL `fbm(vec2 p)`, the loop unrolled. */
export function vfxFbmOps<T>(o: Ops<T>, x: T, y: T): T {
  let v = o.lit(0);
  let amp = VFX_FBM.amp0;
  let px = x;
  let py = y;
  for (let k = 0; k < VFX_FBM.octaves; k++) {
    v = o.add(v, o.mul(o.lit(amp), vfxValueNoiseOps(o, px, py)));
    px = o.add(o.mul(px, o.lit(VFX_FBM.lacunarity)), o.lit(VFX_FBM.shift));
    py = o.add(o.mul(py, o.lit(VFX_FBM.lacunarity)), o.lit(VFX_FBM.shift));
    amp *= VFX_FBM.gain;
  }
  return v;
}

/** The billow `b` in 0..1 at `q`, at `detail` (a JS choice: detail 0 builds no noise at all, detail 1 one chain). */
export function vfxBillowOps<T>(o: Ops<T>, q: V2<T>, detail: VfxDetail): T {
  if (detail === 0) return o.lit(0.5);
  const first = vfxFbmOps(o, q.x, q.y);
  if (detail === 1) return o.div(first, o.lit(VFX_BILLOW.norm));
  const f2 = o.lit(VFX_BILLOW.freq2);
  const s2 = o.lit(VFX_BILLOW.shift2);
  const second = vfxFbmOps(o, o.add(o.mul(q.x, f2), s2), o.add(o.mul(q.y, f2), s2));
  return o.div(o.add(o.mul(first, o.lit(VFX_BILLOW.w1)), o.mul(second, o.lit(VFX_BILLOW.w2))), o.lit(VFX_BILLOW.norm));
}

/** The atlas coordinate of frame `k` (an integer-valued float) at `local` (0..1 inside the frame), on a `grid` x `grid` atlas. */
export function vfxFrameUvOps<T>(o: Ops<T>, k: T, local: V2<T>, grid: number): V2<T> {
  const g = o.lit(grid);
  const row = o.floor(o.div(k, g));
  // GLSL `mod(k, G)`: `k - floor(k / G) * G` (`Ops<T>` has no `mod`).
  const col = o.sub(k, o.mul(row, g));
  return {
    x: o.div(o.add(col, local.x), g),
    y: o.div(o.add(o.sub(o.lit(grid - 1), row), local.y), g),
  };
}

/** A rotation by the angle whose cosine and sine are `cs`, `sn`: `(cs x - sn y, sn x + cs y)`. */
export function vfxRotateOps<T>(o: Ops<T>, cs: T, sn: T, v: V2<T>): V2<T> {
  return { x: o.sub(o.mul(cs, v.x), o.mul(sn, v.y)), y: o.add(o.mul(sn, v.x), o.mul(cs, v.y)) };
}

/** The inverse rotation (the screen-space gradient of an atlas gradient read in the rotated frame): `(cs x + sn y, -sn x + cs y)`. */
export function vfxUnrotateOps<T>(o: Ops<T>, cs: T, sn: T, v: V2<T>): V2<T> {
  return { x: o.add(o.mul(cs, v.x), o.mul(sn, v.y)), y: o.add(o.mul(o.sub(o.lit(0), sn), v.x), o.mul(cs, v.y)) };
}

/** Denser toward the sun is self-shadowed; the rim facing it is lit. `g` the density gradient, `uv` the quad position, `sun` on screen. */
export function vfxSunShadeOps<T>(o: Ops<T>, g: V2<T>, uv: V2<T>, sun: V2<T>): T {
  const gs = o.add(o.mul(g.x, sun.x), o.mul(g.y, sun.y));
  const us = o.add(o.mul(uv.x, sun.x), o.mul(uv.y, sun.y));
  const s = o.add(o.sub(o.lit(VFX_SHADE.base), o.mul(o.lit(VFX_SHADE.grad), gs)), o.mul(o.lit(VFX_SHADE.rim), us));
  return o.clamp(s, VFX_SHADE.lo, VFX_SHADE.hi);
}

/** A 3-vector as three scalars. */
export interface V3s<T> {
  readonly x: T;
  readonly y: T;
  readonly z: T;
}

/**
 * The camera-facing quad both VFX vertex stages draw: `centre + (right * c.x + up * c.y) * size * quad + up * size * lift`, with
 * `right` and `up` the view matrix's first two ROWS (`vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0])` and the `[.][1]`
 * column of each), `c` the quad corner. The flipbook lifts by 0.32 at `uQuadScale`; the smoke screen draws `quad` 1, `lift` 0.
 */
export function vfxBillboardOps<T>(o: Ops<T>, centre: V3s<T>, right: V3s<T>, up: V3s<T>, c: V2<T>, size: T, quad: T, lift: number): V3s<T> {
  const k = o.mul(size, quad);
  const l = o.mul(size, o.lit(lift));
  const axis = (cen: T, r: T, u: T): T => o.add(o.add(cen, o.mul(o.add(o.mul(r, c.x), o.mul(u, c.y)), k)), o.mul(u, l));
  return { x: axis(centre.x, right.x, up.x), y: axis(centre.y, right.y, up.y), z: axis(centre.z, right.z, up.z) };
}
