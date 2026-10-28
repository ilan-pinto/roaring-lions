import { describe, expect, it } from 'vitest';
import { units as shipped } from '@lions/data';
import type { UnitTypeJson } from '@lions/sim';
import { unitsAtMaxTier, withRoster } from './harness';
import { standoff, standoffPasses, standoffReading, type StandoffArm } from './targets';
import { standoff as probeStandoff } from './vehicle-health-probe';

/**
 * The Standoff (Sarim) section gate (GH-865 ruling 2): three `atgm_cell`s in cover 2 at 8.5 tiles
 * against an APS Lavi, exchange > 0 AND destroyed-or-disabled >= 60%, both tiers, 200 seeds.
 *
 * Every literal below is a reading from the measurement note
 * (docs/superpowers/specs/2026-10-29-standoff-doctrine.md, section 6), re-read on this branch:
 * the gate arm and the red arms were each RUN, not imagined.
 *
 *   arm                      base               max tier
 *   3 cells, cover 2 (gate)  +271 / 74.5%       +137 / 68.5%
 *   3 cells, no cover        -270 / 51.0%       -359 / 49.0%   (both bars fail)
 *   2 cells, cover 2          +59 / 54.5%         -4 / 49.0%   (max: both fail; base: disabled bar)
 *   3 cells, cover 1          +85 / 63.0%         -26 / 61.0%  (max: exchange bar ONLY)
 *   Trophy pk 0.9, cover 2   +155 / 63.0%         +26 / 53.0%  (max: disabled bar ONLY)
 *   1 cell, cover 2           -52 / 24.0%         -65 / 20.0%
 *
 * The two bars are each independently necessary: cover 1 at max tier reads 61% disabled (bar met) and
 * a negative exchange; pk 0.9 at max tier reads +26 (bar met) and 53% disabled. Deleting either bar
 * from `standoffPasses` turns the matching test below red (see the commit message).
 *
 * The probe parity test is the independent oracle: `vehicle-health-probe.ts` implements the same
 * duel separately (its own loop and tally), and at cover 0 the two must agree on every number.
 */
const U = shipped as unknown as Record<string, UnitTypeJson>;
const SEEDS = 200;
const GATE: StandoffArm = { cells: 3, cover: 2 };

function both(arm: StandoffArm) {
  return {
    base: standoffReading(arm, SEEDS),
    max: withRoster(unitsAtMaxTier, () => standoffReading(arm, SEEDS)),
  };
}

describe('Standoff section gate (GH-865)', () => {
  it('passes at both tiers with margin on each bar', () => {
    const { base, max } = both(GATE);
    expect(base.exchange).toBeGreaterThan(200); // +271 read
    expect(base.destroyedOrDisabledPct).toBeGreaterThanOrEqual(70); // 74.5 read
    expect(max.exchange).toBeGreaterThan(100); // +137 read
    expect(max.destroyedOrDisabledPct).toBeGreaterThanOrEqual(65); // 68.5 read
    // Not vacuous: the cells really fired about three missiles each.
    expect(base.missilesPerRun).toBeGreaterThan(7); // 8.2 read
    expect(max.missilesPerRun).toBeGreaterThan(7); // 8.2 read
    expect(standoffPasses(base)).toBe(true);
    expect(standoffPasses(max)).toBe(true);
  }, 60_000);

  it('the shipped target row reads PASS at both tiers', () => {
    expect(standoff(SEEDS).pass).toBe(true);
    expect(withRoster(unitsAtMaxTier, () => standoff(SEEDS)).pass).toBe(true);
  }, 60_000);

  it('goes red with the cover removed (both tiers, both bars)', () => {
    const { base, max } = both({ cells: 3, cover: 0 });
    expect(standoffPasses(base)).toBe(false);
    expect(standoffPasses(max)).toBe(false);
    expect(base.exchange).toBeLessThan(0); // -270 read
    expect(max.exchange).toBeLessThan(0); // -359 read
    expect(base.destroyedOrDisabledPct).toBeLessThan(60); // 51.0 read
    expect(max.destroyedOrDisabledPct).toBeLessThan(60); // 49.0 read
  }, 60_000);

  it('goes red with two cells instead of three (max tier: both bars)', () => {
    const { base, max } = both({ cells: 2, cover: 2 });
    expect(standoffPasses(base)).toBe(false); // disabled 54.5
    expect(standoffPasses(max)).toBe(false);
    expect(max.exchange).toBeLessThan(0); // -4 read
    expect(max.destroyedOrDisabledPct).toBeLessThan(60); // 49.0 read
  }, 60_000);

  it('goes red at cover 1 at max tier, on the exchange bar alone', () => {
    const { max } = both({ cells: 3, cover: 1 });
    expect(max.destroyedOrDisabledPct).toBeGreaterThanOrEqual(60); // 61.0 read: that bar is met
    expect(max.exchange).toBeLessThanOrEqual(0); // -26 read
    expect(standoffPasses(max)).toBe(false);
  }, 60_000);

  it('goes red with the Trophy at pk 0.9 at max tier, on the disabled bar alone', () => {
    const { max } = both({ ...GATE, apsBasePk: 0.9 });
    expect(max.exchange).toBeGreaterThan(0); // +26 read: that bar is met
    expect(max.destroyedOrDisabledPct).toBeLessThan(60); // 53.0 read
    expect(standoffPasses(max)).toBe(false);
  }, 60_000);

  it('a lone cell in cover 2 does not pass either (the single-cell form is not a target)', () => {
    const { base, max } = both({ cells: 1, cover: 2 });
    expect(standoffPasses(base)).toBe(false);
    expect(standoffPasses(max)).toBe(false);
  }, 60_000);

  it('at cover 0 it reproduces the report-only probe row exactly (independent oracle)', () => {
    const mine = standoffReading({ cells: 3, cover: 0 }, SEEDS);
    const theirs = probeStandoff(U, 3, SEEDS).extra;
    expect(mine.exchange).toBeCloseTo(theirs.exchangePerRun, 6); // -270.4 read
    expect(mine.destroyedPct).toBeCloseTo(theirs.mbtKilledPct, 6); // 13.5 read
    expect(mine.destroyedOrDisabledPct).toBeCloseTo(theirs.mbtKilledOrDisabledPct, 6); // 51.0 read
    expect(mine.cellsLostPct).toBeCloseTo(theirs.cellDeadPct, 6);
    expect(mine.missilesPerRun).toBeCloseTo(theirs.missilesPerRun, 6);
  }, 60_000);
});
