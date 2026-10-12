import { describe, it, expect } from 'vitest';
import { catchUpTicks, tickCostEma, roomTickCap, MAX_CATCHUP_TICKS } from './catch-up';

describe('catchUpTicks', () => {
  it('nothing behind runs nothing', () => {
    expect(catchUpTicks(0, 1)).toBe(0);
    expect(catchUpTicks(-3, 1)).toBe(0);
  });
  it('nearly caught up keeps the normal cap, and never more than is behind', () => {
    expect(catchUpTicks(3, 1)).toBe(3);
    expect(catchUpTicks(5, 1)).toBe(4);
  });
  it('far behind runs as many ticks as fit in the budget', () => {
    expect(catchUpTicks(5000, 1, 12)).toBe(12);
    expect(catchUpTicks(5000, 0.25, 12)).toBe(48);
  });
  it('never below 1 while behind, never above behind', () => {
    for (const behind of [1, 2, 7, 9, 40, 500, 12000]) {
      for (const cost of [0, 0.01, 0.3, 1, 5, 50, 1000]) {
        const n = catchUpTicks(behind, cost);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(behind);
      }
    }
  });
});

describe('tickCostEma', () => {
  it('moves part of the way toward each sample', () => {
    expect(tickCostEma(2, 1)).toBeCloseTo(1.8);
    expect(tickCostEma(1, 3, 0.5)).toBeCloseTo(2);
  });
  it('ignores a sample that is not a finite, non-negative cost', () => {
    expect(tickCostEma(2, Number.NaN)).toBe(2);
    expect(tickCostEma(2, Number.POSITIVE_INFINITY)).toBe(2);
    expect(tickCostEma(2, -1)).toBe(2);
  });
});

describe('roomTickCap', () => {
  it('live and far behind raises the cap to what fits the frame; live and near keeps the floor', () => {
    expect(roomTickCap({ kind: 'live', behind: 5000 }, 0.25)).toBe(48);
    expect(roomTickCap({ kind: 'live', behind: 3 }, 1)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'live', behind: 0 }, 1)).toBe(MAX_CATCHUP_TICKS);
  });
  it('a stall keeps the floor however far behind it says it is: its own seat must run the frames it holds to ack (R31)', () => {
    expect(roomTickCap({ kind: 'stalled', reason: 'behind', seat: 1 }, 0.25)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'stalled', reason: 'connecting', seat: null }, 0.25)).toBe(MAX_CATCHUP_TICKS);
  });
  it('a pause and every other status keep the floor', () => {
    expect(roomTickCap({ kind: 'paused', seat: 0, untilMs: 90000 }, 0.25)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'waiting' }, 0.25)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'local' }, 0.25)).toBe(MAX_CATCHUP_TICKS);
  });
});
