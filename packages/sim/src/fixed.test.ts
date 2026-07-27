import { describe, expect, it } from 'vitest';
import { fx, ONE, HALF_TURN, QUARTER_TURN, FX_MAX, FX_MIN } from './fixed';

// Tests may use Math/floats freely: Math here is the floating-point *oracle*
// the fixed-point implementation is checked against. The sim itself never
// touches it (enforced by lint).

/** Reference int32 wrap of an arbitrary-precision integer expression. */
function wrap32(n: bigint): number {
  return Number(BigInt.asIntN(32, n));
}

describe('constants', () => {
  it('ONE is 2^16 and the angle constants subdivide the turn', () => {
    expect(ONE).toBe(65536);
    expect(HALF_TURN).toBe(32768);
    expect(QUARTER_TURN).toBe(16384);
    expect(FX_MAX).toBe(2147483647);
    expect(FX_MIN).toBe(-2147483648);
  });
});

describe('from / toNumber boundary', () => {
  it('converts exact binary fractions losslessly', () => {
    expect(fx.from(1.5)).toBe(98304);
    expect(fx.from(-0.25)).toBe(-16384);
    expect(fx.toNumber(98304)).toBe(1.5);
    expect(fx.toNumber(-16384)).toBe(-0.25);
  });

  it('rounds to the nearest representable value', () => {
    expect(fx.from(1 / 3)).toBe(21845); // 21845.33 rounds down
    expect(fx.from(2 / 3)).toBe(43691); // 43690.67 rounds up
    expect(fx.from(-1 / 3)).toBe(-21845);
  });

  it('handles integers exactly through fromInt/toInt', () => {
    expect(fx.fromInt(42)).toBe(42 * 65536);
    expect(fx.fromInt(-7)).toBe(-7 * 65536);
    expect(fx.toInt(fx.fromInt(42))).toBe(42);
    expect(fx.toInt(fx.from(2.75))).toBe(2); // floor
    expect(fx.toInt(fx.from(-2.75))).toBe(-3); // floor, toward -inf
  });
});

describe('rounding helpers', () => {
  it('floor / ceil / round behave like their real counterparts', () => {
    const v = fx.from(2.75);
    const n = fx.from(-2.75);
    expect(fx.floor(v)).toBe(fx.fromInt(2));
    expect(fx.floor(n)).toBe(fx.fromInt(-3));
    expect(fx.ceil(v)).toBe(fx.fromInt(3));
    expect(fx.ceil(n)).toBe(fx.fromInt(-2));
    expect(fx.round(v)).toBe(fx.fromInt(3));
    expect(fx.round(n)).toBe(fx.fromInt(-3));
    expect(fx.round(fx.from(2.5))).toBe(fx.fromInt(3)); // half away from zero
    expect(fx.round(fx.from(-2.5))).toBe(fx.fromInt(-3));
  });

  it('abs / neg / min / max / clamp', () => {
    expect(fx.abs(fx.from(-3.5))).toBe(fx.from(3.5));
    expect(fx.neg(fx.from(2))).toBe(fx.from(-2));
    expect(fx.min(1, 2)).toBe(1);
    expect(fx.max(1, 2)).toBe(2);
    expect(fx.clamp(fx.from(5), 0, ONE)).toBe(ONE);
    expect(fx.clamp(fx.from(-5), 0, ONE)).toBe(0);
    expect(fx.clamp(HALF_TURN, 0, ONE)).toBe(HALF_TURN);
  });
});

describe('add / sub — int32 wrap semantics', () => {
  it('adds and subtracts exactly in range', () => {
    expect(fx.add(fx.from(1.25), fx.from(2.5))).toBe(fx.from(3.75));
    expect(fx.sub(fx.from(1.25), fx.from(2.5))).toBe(fx.from(-1.25));
  });

  it('wraps on overflow exactly like int32', () => {
    expect(fx.add(FX_MAX, 1)).toBe(FX_MIN);
    expect(fx.sub(FX_MIN, 1)).toBe(FX_MAX);
    expect(fx.add(FX_MAX, FX_MAX)).toBe(wrap32(2n * 2147483647n));
  });
});

describe('mul — floor((a*b)/2^16), wrapping like int32', () => {
  it('multiplies exact values', () => {
    expect(fx.mul(fx.from(1.5), fx.from(2))).toBe(fx.from(3));
    expect(fx.mul(fx.from(-1.5), fx.from(2))).toBe(fx.from(-3));
    expect(fx.mul(fx.from(0.5), fx.from(0.5))).toBe(fx.from(0.25));
    expect(fx.mul(fx.from(-0.5), fx.from(-0.5))).toBe(fx.from(0.25));
  });

  it('truncates toward negative infinity at the 2^-16 boundary', () => {
    expect(fx.mul(1, 1)).toBe(0); // (2^-16)^2 floors to 0
    expect(fx.mul(-1, 1)).toBe(-1); // floor(-2^-32) = -1 ulp
  });

  it('matches BigInt reference across a sweep including sign mixes', () => {
    const samples = [
      0, 1, -1, 65536, -65536, 98304, 12345, -54321, 2147481234, -2147481234, 8675309, -8675309,
    ];
    for (const a of samples) {
      for (const b of samples) {
        const ref = wrap32((BigInt(a) * BigInt(b)) >> 16n);
        expect(fx.mul(a, b), `mul(${a}, ${b})`).toBe(ref);
      }
    }
  });

  it('wraps on overflow exactly like int32', () => {
    const a = fx.from(300);
    expect(fx.mul(a, a)).toBe(wrap32((BigInt(a) * BigInt(a)) >> 16n));
  });
});

describe('div — truncation toward zero', () => {
  it('divides exact values', () => {
    expect(fx.div(fx.from(3), fx.from(2))).toBe(fx.from(1.5));
    expect(fx.div(fx.from(-3), fx.from(2))).toBe(fx.from(-1.5));
    expect(fx.div(fx.from(1), fx.from(3))).toBe(21845); // trunc(21845.33)
    expect(fx.div(fx.from(-1), fx.from(3))).toBe(-21845); // toward zero
    expect(fx.div(0, fx.from(9))).toBe(0);
  });

  it('matches BigInt truncating reference across a sweep', () => {
    const nums = [0, 1, -1, 65536, -98304, 123456789, -123456789, 2147480000];
    const dens = [1, -1, 2, 3, -3, 65536, 98304, -1234567];
    for (const a of nums) {
      for (const b of dens) {
        const ref = wrap32((BigInt(a) << 16n) / BigInt(b)); // BigInt / truncates toward zero
        expect(fx.div(a, b), `div(${a}, ${b})`).toBe(ref);
      }
    }
  });

  it('throws on division by zero', () => {
    expect(() => fx.div(ONE, 0)).toThrow();
  });
});

describe('sqrt', () => {
  it('is exact on perfect squares', () => {
    expect(fx.sqrt(fx.fromInt(4))).toBe(fx.fromInt(2));
    expect(fx.sqrt(fx.fromInt(9))).toBe(fx.fromInt(3));
    expect(fx.sqrt(fx.from(0.25))).toBe(fx.from(0.5));
    expect(fx.sqrt(0)).toBe(0);
    expect(fx.sqrt(ONE)).toBe(ONE);
  });

  it('floors irrational roots to the representable grid', () => {
    expect(fx.sqrt(fx.fromInt(2))).toBe(92681); // sqrt(2)*65536 = 92681.9
  });

  it('stays within 1 ulp of the float oracle across a sweep', () => {
    for (let i = 1; i <= 1000; i++) {
      const raw = i * 2147483; // spreads across the positive int32 range
      const got = fx.sqrt(raw);
      const ref = Math.floor(Math.sqrt(raw / 65536) * 65536);
      expect(Math.abs(got - ref), `sqrt(${raw})`).toBeLessThanOrEqual(1);
    }
  });

  it('throws on negative input', () => {
    expect(() => fx.sqrt(-1)).toThrow();
  });
});

describe('sin / cos over binary turns (ONE = full turn)', () => {
  it('hits the cardinal points exactly', () => {
    expect(fx.sin(0)).toBe(0);
    expect(fx.sin(QUARTER_TURN)).toBe(ONE);
    expect(fx.sin(HALF_TURN)).toBe(0);
    expect(fx.sin(HALF_TURN + QUARTER_TURN)).toBe(-ONE);
    expect(fx.cos(0)).toBe(ONE);
    expect(fx.cos(QUARTER_TURN)).toBe(0);
    expect(fx.cos(HALF_TURN)).toBe(-ONE);
  });

  it('is periodic and defined for negative angles', () => {
    for (const a of [0, 1234, 8192, 40000, 65535]) {
      expect(fx.sin(a + ONE)).toBe(fx.sin(a));
      expect(fx.sin(a - ONE)).toBe(fx.sin(a));
      expect(fx.sin(-a)).toBe(-fx.sin(a) | 0); // | 0: int32 has no -0
    }
  });

  it('tracks the float oracle within 3 ulp across a dense sweep', () => {
    for (let t = 0; t < 65536; t += 37) {
      const rad = (t / 65536) * 2 * Math.PI;
      const refSin = Math.round(Math.sin(rad) * 65536);
      const refCos = Math.round(Math.cos(rad) * 65536);
      expect(Math.abs(fx.sin(t) - refSin), `sin(${t})`).toBeLessThanOrEqual(3);
      expect(Math.abs(fx.cos(t) - refCos), `cos(${t})`).toBeLessThanOrEqual(3);
    }
  });
});

describe('atan2 — returns turns in [0, ONE)', () => {
  it('hits the cardinal directions exactly', () => {
    expect(fx.atan2(0, ONE)).toBe(0);
    expect(fx.atan2(ONE, 0)).toBe(QUARTER_TURN);
    expect(fx.atan2(0, -ONE)).toBe(HALF_TURN);
    expect(fx.atan2(-ONE, 0)).toBe(HALF_TURN + QUARTER_TURN);
    expect(fx.atan2(0, 0)).toBe(0);
  });

  it('hits the diagonals within 2 ulp', () => {
    expect(Math.abs(fx.atan2(ONE, ONE) - 8192)).toBeLessThanOrEqual(2);
    expect(Math.abs(fx.atan2(ONE, -ONE) - 24576)).toBeLessThanOrEqual(2);
    expect(Math.abs(fx.atan2(-ONE, -ONE) - 40960)).toBeLessThanOrEqual(2);
    expect(Math.abs(fx.atan2(-ONE, ONE) - 57344)).toBeLessThanOrEqual(2);
  });

  it('tracks the float oracle within 6 turn-ulp on a circle sweep', () => {
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      const y = Math.round(Math.sin(rad) * 40000);
      const x = Math.round(Math.cos(rad) * 40000);
      let ref = Math.round((Math.atan2(y, x) / (2 * Math.PI)) * 65536);
      if (ref < 0) ref += 65536;
      const got = fx.atan2(y, x);
      const d = Math.min(Math.abs(got - ref), 65536 - Math.abs(got - ref));
      expect(d, `atan2 at ${deg}deg`).toBeLessThanOrEqual(6);
    }
  });
});

describe('angleDiff — signed shortest way', () => {
  it('wraps across the seam', () => {
    expect(fx.angleDiff(500, 65000)).toBe(1036); // just over the seam, small positive
    expect(fx.angleDiff(65000, 500)).toBe(-1036);
    expect(fx.angleDiff(40000, 40000)).toBe(0);
    expect(fx.angleDiff(HALF_TURN, 0)).toBe(-HALF_TURN); // exactly opposite maps to -half
  });

  it('never exceeds a half turn in magnitude', () => {
    for (let i = 0; i < 65536; i += 977) {
      for (let j = 0; j < 65536; j += 1031) {
        const d = fx.angleDiff(i, j);
        expect(d).toBeGreaterThanOrEqual(-HALF_TURN);
        expect(d).toBeLessThan(HALF_TURN);
      }
    }
  });
});

describe('expNeg — e^(-x) for x >= 0', () => {
  it('anchors at 0 and decays toward 0', () => {
    expect(fx.expNeg(0)).toBe(ONE);
    expect(fx.expNeg(fx.fromInt(20))).toBe(0);
    expect(fx.expNeg(FX_MAX)).toBe(0);
  });

  it('tracks the float oracle within 4 ulp across [0, 12]', () => {
    for (let i = 0; i <= 1200; i++) {
      const x = (i / 100) * 65536;
      const got = fx.expNeg(Math.round(x));
      const ref = Math.round(Math.exp(-i / 100) * 65536);
      expect(Math.abs(got - ref), `expNeg(${i / 100})`).toBeLessThanOrEqual(4);
    }
  });

  it('clamps negative input to 1 (documented: x < 0 treated as 0)', () => {
    expect(fx.expNeg(-100)).toBe(ONE);
  });
});

describe('normCdf — standard normal CDF', () => {
  it('anchors at the center and saturates at the tails', () => {
    expect(fx.normCdf(0)).toBe(HALF_TURN); // 0.5
    expect(fx.normCdf(fx.fromInt(5))).toBe(ONE);
    expect(fx.normCdf(fx.fromInt(-5))).toBe(0);
  });

  it('is symmetric: Phi(x) + Phi(-x) == 1 within 2 ulp', () => {
    for (let i = 0; i <= 400; i += 7) {
      const x = Math.round((i / 100) * 65536);
      const sum = fx.normCdf(x) + fx.normCdf(-x);
      expect(Math.abs(sum - ONE), `symmetry at ${i / 100}`).toBeLessThanOrEqual(2);
    }
  });

  it('tracks an erf oracle within 16 ulp (0.00025) across [-4, 4]', () => {
    // float oracle via Abramowitz-Stegun 7.1.26 (|err| < 1.5e-7, far below tolerance)
    function erf(z: number): number {
      const s = z < 0 ? -1 : 1;
      const x = Math.abs(z);
      const t = 1 / (1 + 0.3275911 * x);
      const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
          t *
          Math.exp(-x * x);
      return s * y;
    }
    for (let i = -400; i <= 400; i += 3) {
      const z = i / 100;
      const ref = Math.round(0.5 * (1 + erf(z / Math.SQRT2)) * 65536);
      const got = fx.normCdf(Math.round(z * 65536));
      expect(Math.abs(got - ref), `normCdf(${z})`).toBeLessThanOrEqual(16);
    }
  });
});
