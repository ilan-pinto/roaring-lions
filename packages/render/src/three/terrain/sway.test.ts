import { describe, expect, it } from 'vitest';
import {
  SWAY_AMPLITUDE, SWAY_DIR_X, SWAY_DIR_Z, SWAY_GUST_EVERY_S, SWAY_GUST_GAIN, SWAY_GUST_WIDTH_S,
  SWAY_PERIOD_S, SWAY_PHASE_X, SWAY_PHASE_Z, SWAY_TOP,
  RAIN_SWAY_AMP, RAIN_SWAY_GUST,
  gustFactor, swayOffset, swayVertexChunk, swayWeight,
} from './sway';

describe('sway maths (N-16, N-17)', () => {
  it('weighs by (h / top)^2, clamped', () => {
    expect(swayWeight(0)).toBe(0);
    expect(swayWeight(-1)).toBe(0);
    expect(swayWeight(SWAY_TOP / 2)).toBeCloseTo(0.25, 12);
    expect(swayWeight(SWAY_TOP)).toBe(1);
    expect(swayWeight(3 * SWAY_TOP)).toBe(1);
  });
  it('leaves grass still: 0.12 wu tall moves under 0.001 wu at the strongest gust', () => {
    let worst = 0;
    for (let t = 0; t < 22; t += 0.01) {
      const o = swayOffset(0.12, t, 3, 7);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeLessThan(0.001);
  });
  it('gusts x1.4 at the peak, once every 11 s, and is calm between', () => {
    expect(gustFactor(SWAY_GUST_WIDTH_S / 2)).toBeCloseTo(SWAY_GUST_GAIN, 12);
    expect(gustFactor(SWAY_GUST_EVERY_S + SWAY_GUST_WIDTH_S / 2)).toBeCloseTo(SWAY_GUST_GAIN, 12);
    expect(gustFactor(5)).toBe(1);
    expect(gustFactor(0)).toBe(1);
  });
  it('never exceeds amplitude x gust at the crown top, and reaches 95% of it', () => {
    let worst = 0;
    for (let t = 0; t < 2 * SWAY_GUST_EVERY_S; t += 0.005) {
      const o = swayOffset(SWAY_TOP, t, 0, 0);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeLessThanOrEqual(SWAY_AMPLITUDE * SWAY_GUST_GAIN + 1e-12);
    expect(worst).toBeGreaterThan(0.95 * SWAY_AMPLITUDE * SWAY_GUST_GAIN);
  });
  it('is periodic in 3.8 s outside a gust, and moves along the screen-horizontal axis', () => {
    const a = swayOffset(SWAY_TOP, 3.0, 4, 9);
    const b = swayOffset(SWAY_TOP, 3.0 + SWAY_PERIOD_S, 4, 9);
    expect(b.dx).toBeCloseTo(a.dx, 12);
    expect(a.dz).toBeCloseTo((a.dx * SWAY_DIR_Z) / SWAY_DIR_X, 12);
  });
  it('travels: two trees a tile apart are out of phase', () => {
    expect(swayOffset(SWAY_TOP, 3, 0, 0).dx).not.toBeCloseTo(swayOffset(SWAY_TOP, 3, 1, 0).dx, 3);
  });
  it('the GLSL carries the tested constants, not a transcription of them', () => {
    const src = swayVertexChunk();
    // A bare `toContain(k.toFixed(4))` is a substring search: SWAY_TOP's
    // "1.0000" is also a substring of an unrelated "21.00000000" or
    // "1.00001234" literal, so it can pass without the constant actually
    // being the one embedded. `glsl()` (sway.ts) always emits `toFixed(8)`,
    // so pin that exact literal, delimited on both sides so it cannot match
    // as a fragment of a longer number. SWAY_DIR_X/SWAY_DIR_Z (the sway
    // axis) were not pinned at all before -- add them here too.
    for (const k of [
      SWAY_AMPLITUDE, SWAY_PERIOD_S, SWAY_GUST_GAIN, SWAY_GUST_EVERY_S, SWAY_GUST_WIDTH_S,
      SWAY_TOP, SWAY_PHASE_X, SWAY_PHASE_Z, SWAY_DIR_X, SWAY_DIR_Z,
    ]) {
      const literal = k.toFixed(8).replace(/\./g, '\\.');
      const pattern = new RegExp(`(?<![0-9.])${literal}(?![0-9])`);
      expect(src).toMatch(pattern);
    }
    expect(src).toContain('uSwayTime');
    expect(src).toContain('uSwayAmp');
    expect(src).toContain('USE_BATCHING');
  });
});

describe('the wet sway (GH-871 P4 T5, R-3)', () => {
  // Oracles are literals: the plan's 1.5 and 1.8, and the shipped 0.035 and 1.4.
  it('is amplitude x1.5 and gust 1.8, and the shipped numbers are untouched', () => {
    expect(RAIN_SWAY_AMP).toBe(1.5);
    expect(RAIN_SWAY_GUST).toBe(1.8);
    expect(SWAY_AMPLITUDE).toBe(0.035);
    expect(SWAY_GUST_GAIN).toBe(1.4);
  });

  it('gusts to 1.8 at the peak when wet, and to 1.4 when dry', () => {
    expect(gustFactor(1.25, true)).toBeCloseTo(1.8, 12);
    expect(gustFactor(1.25)).toBeCloseTo(1.4, 12);
    expect(gustFactor(5, true)).toBe(1);
  });

  it('never exceeds 0.035 x 1.5 x 1.8 = 0.0945 at a crown top, and reaches 95% of it', () => {
    let worst = 0;
    for (let t = 0; t < 22; t += 0.005) {
      const o = swayOffset(1, t, 0, 0, true);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeLessThanOrEqual(0.0945 + 1e-12);
    expect(worst).toBeGreaterThan(0.95 * 0.0945);
  });

  it('a dry offset is exactly what it was (the wet flag defaults off)', () => {
    expect(swayOffset(1, 3, 4, 9)).toEqual(swayOffset(1, 3, 4, 9, false));
  });

  it('the wet chunk differs from the dry one in exactly the amplitude and the gust literal', () => {
    const dry = swayVertexChunk();
    const wet = swayVertexChunk(true);
    expect(wet).not.toBe(dry);
    // The literals the shipped chunk carries, and the wet ones it does not.
    expect(dry).toContain('uSwayAmp * 0.03500000 *');
    expect(dry).toContain('(1.40000000 - 1.0)');
    expect(dry).not.toContain('0.05250000');
    expect(dry).not.toContain('1.80000000');
    expect(wet).toContain('uSwayAmp * 0.05250000 *');
    expect(wet).toContain('(1.80000000 - 1.0)');
    expect(wet).not.toContain('0.03500000');
    expect(wet).not.toContain('1.40000000');
    // Swap exactly those two back and the wet chunk IS the dry one, byte for byte:
    // nothing else (period, gust cadence, axis, phase) moved.
    const swapped = wet.replace('0.05250000', '0.03500000').replace('1.80000000', '1.40000000');
    expect(swapped).toBe(dry);
  });
});
