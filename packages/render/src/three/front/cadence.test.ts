// packages/render/src/three/front/cadence.test.ts
import { describe, expect, it } from 'vitest';
import { HOLD_FACTOR, HOLD_SAMPLES, HOST_FPS_CAP, drawDue, motionVerdict } from './cadence';

describe('drawDue', () => {
  it('draws the first frame whatever the clock says', () => {
    expect(drawDue(0, Number.NEGATIVE_INFINITY, 30)).toBe(true);
  });
  // rAF ticks land a hair either side of the period; 1 ms of slack keeps a
  // 60 Hz display on every second tick instead of every third.
  it('waits one period at the cap, less 1 ms of rAF jitter', () => {
    expect(drawDue(1031, 1000, 30)).toBe(false);
    expect(drawDue(1032.4, 1000, 30)).toBe(true);
  });
  it('a cap of 0 draws on every call', () => {
    expect(drawDue(1000.1, 1000, 0)).toBe(true);
  });
});

describe('motionVerdict', () => {
  const period = 1000 / 30;
  it('is undecided until it has HOLD_SAMPLES intervals', () => {
    expect(motionVerdict([33, 34], 30)).toBe('undecided');
  });
  // Spec M11: Metal at cap 30 draws every 33 ms.
  it('animates at the cadence Metal measured', () => {
    expect(motionVerdict([33.3, 33.4, 50], 30)).toBe('animate');
  });
  // Spec M12: SwiftShader, CI's rasteriser, takes ~920 ms a frame.
  it('holds at the cadence SwiftShader measured', () => {
    expect(motionVerdict([920, 880, 950], 30)).toBe('hold');
  });
  it('decides on the median, so one long frame does not hold', () => {
    expect(motionVerdict([33, 900, 34], 30)).toBe('animate');
  });
  it('the threshold is HOLD_FACTOR periods', () => {
    const under = period * HOLD_FACTOR - 1;
    const over = period * HOLD_FACTOR + 1;
    expect(motionVerdict([under, under, under], 30)).toBe('animate');
    expect(motionVerdict([over, over, over], 30)).toBe('hold');
  });
  it('reads only the first HOLD_SAMPLES intervals', () => {
    expect(motionVerdict([33, 33, 33, 900, 900, 900], 30)).toBe('animate');
  });
});

it('the constants are spec §10’s numbers', () => {
  expect(HOST_FPS_CAP).toBe(30);
  expect(HOLD_SAMPLES).toBe(3);
  expect(HOLD_FACTOR).toBe(2.5);
});
