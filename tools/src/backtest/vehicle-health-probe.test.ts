import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { UnitTypeJson } from '@lions/sim';
import { argOf, engagement, quantile, summarise, type Tally } from './vehicle-health-probe';

const U = units as unknown as Record<string, UnitTypeJson>;

/**
 * The ONE gate on a report-only probe (GH-560): when a Lavi duels a Lavi, no hull dies with its bar
 * at half or better, and the bar a dead hull showed is low. Under the HP model only hit points
 * destroy a hull, and a penetration costs at most 0.51 of the bar, so a tank that was more than half
 * healthy does not die to one lucky roll. The literals are the design's reading (run C9: 0% luck,
 * median bar 0.07 at 200 seeds), not values imported from the probe.
 *
 * 20 seeds, READING (this branch): 11 deaths, 0 luck deaths, median bar at death 0.03 (the 200-seed
 * median is 0.07). Measured runtime 0.07 s for the duel (0.5 s for the file), so the 30 s timeout
 * below is headroom for a loaded CI box, not a need.
 * The death count is asserted too: a duel that killed nobody would read "0 luck" for nothing.
 * The median bar is implied by luck 0 (every death under 0.5 puts the median under 0.5); it is kept
 * because the plan asks for it, and it is the number that moves first if the model drifts.
 *
 * Falsified by a one-line mutation of rollComponent (see the commit message): a constant 8-weight
 * catastrophic branch that destroys the hull makes luck deaths non-zero and this test red.
 */
describe('vehicle-health probe: the Lavi v Lavi duel', () => {
  it('has no luck deaths and a low bar at death (20 seeds)', () => {
    const t = engagement(U, [{ id: 'mbt_lavi', n: 1, range: 9 }], 20);
    const s = summarise(t);
    expect(s.deaths).toBeGreaterThanOrEqual(5); // 11 read
    expect(s.luckDeaths).toBe(0);
    expect(s.medianBar).toBeLessThan(0.5);
  }, 30_000);
});

describe('the instrument', () => {
  const death = (hpShown: number): Tally['deaths'][number] => ({ hpShown, pens: 3, t: 10 });
  const tallyOf = (bars: number[]): Tally => ({
    runs: 1,
    deaths: bars.map(death),
    pens: 0,
    hpEndAlive: [],
    atkLost: 0,
    atkCount: 0,
    extra: {},
  });

  it('counts a death whose bar read 0.5 or more as luck, and 0.49 as not', () => {
    expect(summarise(tallyOf([0.5, 0.49, 0.07])).luckDeaths).toBe(1);
    expect(summarise(tallyOf([0.49, 0.07])).luckDeaths).toBe(0);
  });

  it('reads the median of the bars', () => {
    expect(summarise(tallyOf([0.9, 0.1, 0.2])).medianBar).toBe(0.2);
  });

  it('an empty tally has no median, so the gate cannot pass on it', () => {
    expect(summarise(tallyOf([])).deaths).toBe(0);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });

  it('reads --name=value flags', () => {
    expect(argOf(['--seeds=20', '--tier=max'], 'seeds')).toBe('20');
    expect(argOf(['--seeds=20'], 'tier')).toBeUndefined();
  });
});
