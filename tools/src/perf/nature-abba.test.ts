/**
 * GH-984 N3: the cost phase's arm order. A synthetic machine whose reading rises linearly with every measurement
 * (load drifting upward) and whose true on-vs-off effect is ZERO. The fixed order reads a positive paired median
 * (the off arm is always measured first, so on is always later and higher); ABBA reads about 0.
 */
import { describe, expect, it } from 'vitest';
import { armOrder, fixedArmOrder, median, pairedLine, pairedStats, runRounds } from './nature-abba';

const BASE = 30;
const SLOPE = 0.5; // ms per measurement
const ROUNDS = 6;

async function drifted(order: typeof armOrder) {
  let k = 0;
  const { off, on } = await runRounds(ROUNDS, order, async () => BASE + SLOPE * k++);
  return pairedStats(off, on);
}

describe('ABBA arm order', () => {
  it('alternates per round', () => {
    expect([0, 1, 2, 3].map((r) => armOrder(r).join(','))).toEqual(['off,on', 'on,off', 'off,on', 'on,off']);
  });
  it('reads ~0 on a linear drift with zero true effect', async () => {
    const p = await drifted(armOrder);
    expect(Math.abs(p.median)).toBeLessThan(SLOPE * 0.1);
    expect(p.positive).toBe(ROUNDS / 2);
  });
  it('the fixed order reads positive on the same input (the falsification)', async () => {
    const p = await drifted(fixedArmOrder);
    expect(p.median).toBeCloseTo(SLOPE, 6);
    expect(p.positive).toBe(ROUNDS);
  });
  it('measures every arm once per round', async () => {
    const seen: string[] = [];
    await runRounds(2, armOrder, async (arm, r) => void seen.push(`${r}${arm}`));
    expect(seen).toEqual(['0off', '0on', '1on', '1off']);
  });
});

describe('paired stats', () => {
  it('median averages the middle two and counts strictly positive rounds', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const p = pairedStats([10, 10, 10, 10], [11, 9, 10, 13]);
    expect(p.deltas).toEqual([1, -1, 0, 3]);
    expect(p.median).toBe(0.5);
    expect(p.positive).toBe(2);
    expect(pairedLine(p)).toBe('paired median (on - off) +0.50 ms, 2/4 rounds positive');
  });
  it('refuses mismatched arms', () => {
    expect(() => pairedStats([1], [1, 2])).toThrow();
  });
});
