import { describe, expect, it } from 'vitest';
import { earnsSweep, intelAt, intelPairs, intelTotal, passiveBeatsWinner, passiveEndExceedsWinner, seedsNotSpent, winningPlans } from './intel-gate';
import type { IntelRun, RunRecord } from './playtest-run';

const run = (endTick: number, intel: [number, number][], spent = 0): IntelRun => ({ endTick, intel, spent });
const win = (id: string, label: string, r: IntelRun, expectation: RunRecord['expect'] = 'victory'): RunRecord => ({
  id,
  label,
  expect: expectation,
  result: 'victory',
  stuck: false,
  minutes: r.endTick / 1200,
  stars: 2,
  roe: 100,
  ...r,
});

describe('intelAt', () => {
  it('sums the events stamped at or before the tick, and no later one', () => {
    const r = run(500, [[10, 10], [100, 30], [101, 30]]);
    expect(intelAt(r, 9)).toBe(0);
    expect(intelAt(r, 10)).toBe(10);
    expect(intelAt(r, 100)).toBe(40);
    expect(intelAt(r, 101)).toBe(70);
    expect(intelTotal(r)).toBe(70);
  });
});

describe('intelPairs (F-Q12: the earlier of the two end ticks)', () => {
  // A 30-second win against a passive run that sits out four minutes and trickles up past the winner.
  const winner = run(600, [[100, 150]]);
  const passive = run(4800, [[100, 10], [2000, 100], [4000, 100]]);
  const bySeed = new Map([[1, [win('m', 'm', winner)]]]);
  const controls = [{ id: 'm', intel: new Map([[1, passive]]) }];

  it("reads both at the winner's end, not at the passive run's whole four minutes", () => {
    const [p] = intelPairs(controls, bySeed, [1]);
    expect(p.tick).toBe(600);
    expect(p.winnerAt).toBe(150);
    expect(p.passiveAt).toBe(10);
    expect(p.passiveEnd).toBe(210);
    expect(passiveBeatsWinner([p])).toHaveLength(0);
    // ...and read end to end, the same pair is the one the aligned reading exists to set aside.
    expect(passiveEndExceedsWinner([p])).toHaveLength(1);
  });

  it('counts a pair where the passive side is ahead at that tick', () => {
    const slow = new Map([[1, [win('m', 'm', run(600, [[100, 10]]))]]]);
    const [p] = intelPairs(controls, slow, [1]);
    expect(p.winnerAt).toBe(10);
    expect(p.passiveAt).toBe(10);
    expect(passiveBeatsWinner([p])).toHaveLength(0); // level is not ahead
    const ahead = new Map([[1, [win('m', 'm', run(600, []))]]]);
    const [q] = intelPairs(controls, ahead, [1]);
    expect(passiveBeatsWinner([q])).toHaveLength(1);
  });

  it('does not count equal end totals as the passive side exceeding', () => {
    const level = new Map([[1, [win('m', 'm', run(600, [[100, 210]]))]]]);
    const [p] = intelPairs(controls, level, [1]);
    expect(p.winnerEnd).toBe(p.passiveEnd);
    expect(passiveEndExceedsWinner([p])).toHaveLength(0);
  });

  it('counts the seeds the passive side is ahead on, from the winner labelled with the mission id only', () => {
    const seeds = [1, 2, 3, 4];
    const by = new Map<number, RunRecord[]>([
      [1, [win('m', 'm', run(600, []))]],
      [2, [win('m', 'm (gate open)', run(600, [])), win('m', 'm', run(600, [[100, 150]]))]],
      [3, [win('m', 'm', run(600, []))]],
      [4, [win('m', 'm', run(600, [[100, 10]]))]], // level with the passive side: not ahead
    ]);
    const c = [{ id: 'm', intel: new Map(seeds.map((s) => [s, passive])) }];
    const [p] = intelPairs(c, by, seeds);
    expect(p.compared).toBe(4);
    expect(p.ahead).toBe(2);
  });

  it('leaves out a control with no winning plan and a seed missing a side', () => {
    expect(intelPairs([{ id: 'nobody', intel: new Map([[1, passive]]) }], bySeed, [1])).toHaveLength(0);
    const [p] = intelPairs(controls, bySeed, [1, 2]);
    expect(p.compared).toBe(1);
  });
});

describe('earnsSweep', () => {
  const runs = [
    win('a', 'a', run(1, [[1, 150]])),
    win('b', 'b', run(1, [[1, 140]])),
    win('c', 'c (gate open)', run(1, [[1, 100], [2, 50]])),
    win('a', 'a (max tier)', run(1, [[1, 500]])),
    win('d', 'd (passive control)', run(1, [[1, 900]]), 'defeat'),
  ];
  it('counts every winning plan at or over the price, never a max-tier replay or a control', () => {
    expect(winningPlans(runs).map((r) => r.label)).toEqual(['a', 'b', 'c (gate open)']);
    expect(earnsSweep(runs).map((r) => r.label)).toEqual(['a', 'c (gate open)']);
  });
  it('counts earnings, not what is held: a plan that spent its sweep still earned it', () => {
    expect(earnsSweep([win('a', 'a', run(1, [[1, 150]], 150))])).toHaveLength(1);
  });
});

describe('seedsNotSpent', () => {
  it('names the seeds on which the plan spent less than its price, a missing run included', () => {
    const by = new Map<number, RunRecord[]>([
      [1, [win('m', 'm', run(1, [], 120))]],
      [2, [win('m', 'm', run(1, [], 0))]],
    ]);
    expect(seedsNotSpent(by, [1, 2, 3], 'm', 120)).toEqual([2, 3]);
  });
});
