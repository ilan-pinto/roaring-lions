/**
 * GH-943 WebGPU-primary P1 (T4, widened by T3): the arithmetic the fog pass's, and the output stage's, maths is written ONCE against. `haze.ts` (`hazeAmountOps`),
 * `shimmer.ts` (`shimmerOffsetOps`) and `fogDim` below take an `Ops<T>`; `NUMBER_OPS` runs them as plain doubles (the vitest maths
 * and the legacy exports `hazeAmount` / `shimmerOffsetPx`), and `fog-pass.node.ts` supplies a TSL `Ops<Node>` that builds the same
 * expression as a graph. The legacy GLSL (`fog-pass.ts`) keeps its own text, pinned to these constants by `fog-pass.test.ts`.
 *
 * ADDON-FREE and import-free: it is loaded by the shared chunk and by the node twin alike.
 */
export interface Ops<T> {
  lit(n: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  sin(a: T): T;
  /** clamp(a, 0, 1) */
  clamp01(a: T): T;
  /** sqrt(x*x + y*y) */
  length2(x: T, y: T): T;
  /** a + (b - a) * t */
  mix(a: T, b: T, t: T): T;
  /** a < b ? x : y */
  selectLt(a: T, b: T, x: T, y: T): T;
  /** a - floor(a) (GLSL `fract`; T3: the grade dither's hash) */
  fract(a: T): T;
  /** clamp(a, lo, hi) with literal bounds (T3: the grade LUT coordinate) */
  clamp(a: T, lo: number, hi: number): T;
  /** GLSL `smoothstep(e0, e1, x)` (T3: the vignette) */
  smoothstep(e0: T, e1: T, x: T): T;
  // GH-943 P2 (T1): the material twins' arithmetic (ground, relief, ring, wind, disturb), added once so T3-T7 never edit this
  // file. Deliberately absent: `tan` (derive sin/cos), `atan` (use `atan2(x, 1)`), `mod` (derive from `floor`), and every
  // derivative (`fwidth`, `dFdx`): a screen-space rate is graph-only, so a twin computes it in TSL and passes it IN.
  min(a: T, b: T): T;
  max(a: T, b: T): T;
  abs(a: T): T;
  floor(a: T): T;
  /** GLSL `step(edge, x)`: `x < edge ? 0 : 1` */
  step(edge: T, x: T): T;
  pow(a: T, b: T): T;
  cos(a: T): T;
  /** GLSL `atan(y, x)`, the two-argument arc tangent, in (-pi, pi] */
  atan2(y: T, x: T): T;
  sqrt(a: T): T;
  /** e^a (the disturb spring's decay) */
  exp(a: T): T;
  /** -1, 0 or 1 (the road's side) */
  sign(a: T): T;
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const NUMBER_OPS: Ops<number> = {
  lit: (n) => n,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  sin: Math.sin,
  clamp01: (a) => (a < 0 ? 0 : a > 1 ? 1 : a),
  length2: (x, y) => Math.hypot(x, y),
  mix: (a, b, t) => a + (b - a) * t,
  selectLt: (a, b, x, y) => (a < b ? x : y),
  fract: (a) => a - Math.floor(a),
  clamp: clampN,
  smoothstep: (e0, e1, x) => {
    const t = clampN((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  },
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  step: (edge, x) => (x < edge ? 0 : 1),
  pow: Math.pow,
  cos: Math.cos,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  exp: Math.exp,
  // `Math.sign(-0)` is -0; GLSL's `sign(0.0)` is 0. They compare equal, so nothing downstream can tell.
  sign: Math.sign,
};

/**
 * GH-943 P2 (T1): unsigned 32-bit integer arithmetic, for the gust lattice hash (`tileHash`, `tile-hash.ts`; `tileHashOps` there
 * is the body written against this). Every value is a uint32 bit pattern: `NUMBER_INT_OPS` holds it as a double in [0, 2^32), the
 * TSL twin (`tslIntOps`, `fog-pass.node.ts`) as a `uint` node, whose `*`, `+` and `>>` wrap and shift exactly as below.
 */
export interface IntOps<T> {
  /** An unsigned literal (taken mod 2^32). */
  lit(n: number): T;
  /** An integer-valued float as its 32-bit two's-complement pattern: GLSL `uint(int(a))` (a negative lattice index wraps). */
  fromFloat(a: T): T;
  /** a + b mod 2^32 */
  add(a: T, b: T): T;
  /** a * b mod 2^32 (`Math.imul`, GLSL `uint * uint`) */
  imul(a: T, b: T): T;
  xor(a: T, b: T): T;
  /** An UNSIGNED (logical) shift right: the vacated top bits are 0, whatever the top bit was (JS `>>>`, GLSL `uint >> n`). */
  shr(a: T, bits: number): T;
  /** The top 24 bits as a float in [0, 1): `float(a >> 8) / 2^24`, exact in a 32-bit float. */
  toFloat01(a: T): T;
}

export const NUMBER_INT_OPS: IntOps<number> = {
  lit: (n) => n >>> 0,
  fromFloat: (a) => (a | 0) >>> 0,
  add: (a, b) => (a + b) >>> 0,
  imul: (a, b) => Math.imul(a, b) >>> 0,
  xor: (a, b) => (a ^ b) >>> 0,
  shr: (a, bits) => a >>> bits,
  toFloat01: (a) => (a >>> 8) / 16777216,
};

/**
 * The shroud's dim mix: the shroud value `v` (0 never seen, 0.5 explored, 1 in sight) to how far the pixel is pulled toward the
 * tint. `v < 0.5 ? mix(neverSeen, explored, v * 2) : mix(explored, 0, (v - 0.5) * 2)`; the shader's line, written once.
 */
export function fogDim<T>(o: Ops<T>, v: T, neverSeen: T, explored: T): T {
  const half = o.lit(0.5);
  const two = o.lit(2);
  return o.selectLt(
    v,
    half,
    o.mix(neverSeen, explored, o.mul(v, two)),
    o.mix(explored, o.lit(0), o.mul(o.sub(v, half), two))
  );
}
