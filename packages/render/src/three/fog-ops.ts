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
