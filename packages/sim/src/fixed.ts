// Q16.16 fixed-point arithmetic — the numeric foundation of the sim
// (invariant 2). Every operation below uses only integer arithmetic and
// IEEE-754 basic ops (+ - * / % on exact integers), which ARE bit-identical
// across platforms. Transcendentals come from the committed LUTs in
// ./gen/tables.ts, never from Math.
//
// Conventions:
//   - An `Fx` is a plain int32. 65536 = 1.0. Range ±32767.9999847.
//   - add/sub/mul wrap on overflow exactly like int32 (tested); div truncates
//     toward zero; mul floors toward negative infinity at the 2^-16 bit.
//   - Angles are Q16.16 *turns*: ONE = full circle, so wrap is a free & 0xFFFF.
//     Facing arcs, headings, and atan2 all live in this space.
//   - from()/toNumber() are the ONLY float boundary, for data loading and the
//     render/debug side. Nothing inside the sim round-trips through them.

import { SIN_Q, ATAN_T, POW2NEG, NORM_CDF } from './gen/tables';

/** A Q16.16 fixed-point value stored in an int32. */
export type Fx = number;

export const ONE = 65536;
export const HALF = 32768;
export const FX_MAX = 2147483647;
export const FX_MIN = -2147483648;

/** Angle constants — Q16.16 turns. ONE is a full circle. */
export const HALF_TURN = 32768;
export const QUARTER_TURN = 16384;
export const THREE_QUARTER_TURN = 49152;

/** log2(e) in Q16.16 — used by expNeg's base-2 range reduction. */
const LOG2E = 94548;
/** expNeg cutoff: e^-12 is below half an ulp, so everything past it is 0. */
const EXP_NEG_FLOOR = 786432;
/** 4.0 — the normCdf LUT spans [-4, 4]. */
const NORM_SPAN = 262144;

function fxFrom(n: number): Fx {
  // Round half away from zero. `1 / 2` keeps the source float-literal free;
  // this and toNumber are the sanctioned float boundary.
  return ~~(n * ONE + (n < 0 ? -1 : 1) / 2);
}

function fxToNumber(a: Fx): number {
  return a / ONE;
}

function fxFromInt(n: number): Fx {
  return (n * ONE) | 0;
}

/** Integer part, toward negative infinity. */
function fxToInt(a: Fx): number {
  return a >> 16;
}

function fxFloor(a: Fx): Fx {
  return a & -65536;
}

function fxCeil(a: Fx): Fx {
  return ((a + 65535) | 0) & -65536;
}

function fxRound(a: Fx): Fx {
  if (a >= 0) return ((a + HALF) | 0) & -65536;
  return -((((-a | 0) + HALF) | 0) & -65536) | 0;
}

function fxAdd(a: Fx, b: Fx): Fx {
  return (a + b) | 0;
}

function fxSub(a: Fx, b: Fx): Fx {
  return (a - b) | 0;
}

function fxNeg(a: Fx): Fx {
  return -a | 0;
}

function fxAbs(a: Fx): Fx {
  return a < 0 ? -a | 0 : a;
}

function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * floor((a * b) / 2^16), wrapping like int32. 16-bit limb decomposition keeps
 * every intermediate product exactly representable in a double (< 2^53); the
 * naive a*b would lose bits above 2^53 for large operands.
 */
function fxMul(a: Fx, b: Fx): Fx {
  const ah = a >> 16;
  const al = a & 0xffff;
  const bh = b >> 16;
  const bl = b & 0xffff;
  return (((ah * bh) << 16) + ah * bl + al * bh + ((al * bl) >>> 16)) | 0;
}

/**
 * trunc((a * 2^16) / b), wrapping like int32. Throws on b = 0 — a zero
 * divisor in the sim is always a bug and must fail loudly and identically
 * on every machine. Exact: remainder arithmetic keeps every intermediate
 * an integer below 2^48.
 */
function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) throw new Error('fx.div by zero');
  const q = (a - (a % b)) / b;
  const rs = (a % b) * ONE;
  const f = (rs - (rs % b)) / b;
  return (q * ONE + f) | 0;
}

/**
 * floor(sqrt(a)) on the Q16.16 grid via digit-by-digit integer square root
 * of a * 2^16 (< 2^47, exact in doubles). Throws on negative input.
 */
function fxSqrt(a: Fx): Fx {
  if (a < 0) throw new Error('fx.sqrt of negative');
  let n = a * ONE;
  let res = 0;
  let bit = 70368744177664; // 4^23, largest power of 4 below 2^47
  while (bit > n) bit = bit / 4;
  while (bit >= 1) {
    const t = res + bit;
    if (n >= t) {
      n = n - t;
      res = (res - (res % 2)) / 2 + bit;
    } else {
      res = (res - (res % 2)) / 2;
    }
    bit = bit / 4;
  }
  return res | 0;
}

/**
 * sin of an angle in Q16.16 turns. Quadrant reduction onto the quarter-wave
 * LUT makes every symmetry identity (sin(-a) = -sin(a), periodicity) hold
 * bit-exactly, not just approximately.
 */
function fxSin(a: Fx): Fx {
  let t = a & 0xffff;
  let sign = 1;
  if (t >= HALF_TURN) {
    sign = -1;
    t = t - HALF_TURN;
  }
  if (t > QUARTER_TURN) t = HALF_TURN - t;
  const idx = t >> 6;
  if (idx === 256) return (sign * ONE) | 0;
  const frac = t & 63;
  const base = SIN_Q[idx];
  const v = base + (((SIN_Q[idx + 1] - base) * frac) >> 6);
  return (sign * v) | 0; // | 0 canonicalizes -0: Q16.16 has no negative zero
}

function fxCos(a: Fx): Fx {
  return fxSin((a + QUARTER_TURN) | 0);
}

/**
 * atan2 in Q16.16 turns, range [0, ONE). Octant reduction over the ratio
 * min/max, so the operands' scale cancels — raw ints and Fx both work.
 */
function fxAtan2(y: Fx, x: Fx): Fx {
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? QUARTER_TURN : THREE_QUARTER_TURN;
  if (y === 0) return x > 0 ? 0 : HALF_TURN;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const mn = ax < ay ? ax : ay;
  const mx = ax < ay ? ay : ax;
  const rs = mn * ONE;
  const r = (rs - (rs % mx)) / mx; // 0..65536, exact
  let a: number;
  if (r === ONE) {
    a = 8192; // exactly 45 degrees
  } else {
    const idx = r >>> 8;
    const frac = r & 255;
    const base = ATAN_T[idx];
    a = base + (((ATAN_T[idx + 1] - base) * frac) >> 8);
  }
  if (ay > ax) a = QUARTER_TURN - a;
  if (x < 0) a = HALF_TURN - a;
  if (y < 0) a = (ONE - a) & 0xffff;
  return a;
}

/**
 * Signed shortest-way difference between two angles (turns), in
 * [-HALF_TURN, HALF_TURN). angleDiff(to, from) > 0 means turn CCW.
 */
function fxAngleDiff(to: Fx, from: Fx): Fx {
  const d = (to - from) & 0xffff;
  return (d << 16) >> 16;
}

/**
 * e^(-x) for x >= 0, via 2^(-x*log2e) — an integer shift plus one POW2NEG
 * lookup. x < 0 is clamped to 1 (the sim only ever decays). Below e^-12
 * the result is under half an ulp and snaps to 0.
 */
function fxExpNeg(x: Fx): Fx {
  if (x <= 0) return ONE;
  if (x >= EXP_NEG_FLOOR) return 0;
  const z = fxMul(x, LOG2E);
  const i = z >> 16;
  if (i >= 17) return 0;
  const f = z & 0xffff;
  const idx = f >>> 8;
  const frac = f & 255;
  const base = POW2NEG[idx];
  const v = base + (((POW2NEG[idx + 1] - base) * frac) >> 8);
  return v >> i;
}

/**
 * Standard normal CDF — the penetration curve (GDD 5.3). LUT over [-4, 4];
 * beyond that the tails saturate to 0 / ONE. Symmetric by table construction:
 * normCdf(x) + normCdf(-x) is within 1 ulp of ONE.
 */
function fxNormCdf(x: Fx): Fx {
  if (x >= NORM_SPAN) return ONE;
  if (x <= -NORM_SPAN) return 0;
  const u = x + NORM_SPAN; // 0..524287
  const idx = u >>> 11;
  const frac = u & 2047;
  const base = NORM_CDF[idx];
  return base + (((NORM_CDF[idx + 1] - base) * frac) >> 11);
}

/** Linear interpolation a + (b-a)*t for t in [0, ONE]. */
function fxLerp(a: Fx, b: Fx, t: Fx): Fx {
  return (a + fxMul((b - a) | 0, t)) | 0;
}

export const fx = {
  from: fxFrom,
  toNumber: fxToNumber,
  fromInt: fxFromInt,
  toInt: fxToInt,
  floor: fxFloor,
  ceil: fxCeil,
  round: fxRound,
  add: fxAdd,
  sub: fxSub,
  neg: fxNeg,
  abs: fxAbs,
  min: fxMin,
  max: fxMax,
  clamp: fxClamp,
  mul: fxMul,
  div: fxDiv,
  sqrt: fxSqrt,
  sin: fxSin,
  cos: fxCos,
  atan2: fxAtan2,
  angleDiff: fxAngleDiff,
  expNeg: fxExpNeg,
  normCdf: fxNormCdf,
  lerp: fxLerp,
} as const;
