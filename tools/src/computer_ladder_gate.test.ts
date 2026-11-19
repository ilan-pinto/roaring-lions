// GH-1389: the computer ladder's ordering gate on LITERAL win counts -- never on a ladder run, so the gate's own verdict is
// what is under test. Each fixture is one ordered ladder with one cell changed.
import { describe, expect, it } from 'vitest';
import { LADDER_MARGINS, orderingViolations, pooled, winRate, type LadderCells, type Tally } from './backtest/computer-ladder-gate';
import { tally } from './backtest/computer-ladder-match';

const t = (computer: number, player: number, draw = 0): Tally => ({ computer, player, draw });

/** Two maps, three plans, 30 games a level: easy 3, medium 12, hard 21 computer wins in every cell. */
function ordered(): LadderCells {
  const cell = () => ({ easy: t(3, 27), medium: t(12, 18), hard: t(21, 9) });
  return {
    a: { passive: cell(), rush: cell(), sensible: cell() },
    b: { passive: cell(), rush: cell(), sensible: cell() },
  };
}

describe('the ordering gate', () => {
  it('passes a ladder that rises on every plan', () => {
    expect(orderingViolations(ordered())).toEqual([]);
  });

  it('fails a pooled tie: medium equal to hard on one plan', () => {
    const c = ordered();
    c.a.rush.hard = t(12, 18);
    c.b.rush.hard = t(12, 18);
    const v = orderingViolations(c);
    expect(v.map((x) => [x.scope, x.plan, x.lower, x.higher])).toEqual([['pooled', 'rush', 'medium', 'hard']]);
  });

  it('fails a pooled step no larger than the margin, and passes one just above it', () => {
    // 60 games a level pooled: medium 12+12 = 24 (40.0%). Hard 27 (45.0%) is a 5.0-point step: not MORE than 5, so it fails.
    const at = ordered();
    at.a.sensible.hard = t(14, 16);
    at.b.sensible.hard = t(13, 17);
    expect(winRate(pooled(at).sensible.hard) - winRate(pooled(at).sensible.medium)).toBeCloseTo(LADDER_MARGINS.pooledStep, 10);
    expect(orderingViolations(at).map((x) => [x.scope, x.plan, x.lower])).toEqual([['pooled', 'sensible', 'medium']]);
    const above = ordered();
    above.a.sensible.hard = t(14, 16);
    above.b.sensible.hard = t(14, 16);
    expect(orderingViolations(above)).toEqual([]);
  });

  it('fails one map where a lower level beats a higher one by more than the cell margin, and passes one inside it', () => {
    const big = ordered();
    big.b.passive = { easy: t(3, 27), medium: t(28, 2), hard: t(21, 9) }; // medium 93.3% over hard 70.0%: 23.3 points
    big.a.passive.hard = t(30, 0); // keeps the pooled passive step clear (85.0% over 66.7%), so only the cell rule speaks
    expect(orderingViolations(big).map((x) => [x.scope, x.map, x.plan, x.lower, x.higher])).toEqual([['cell', 'b', 'passive', 'medium', 'hard']]);
    const small = ordered();
    small.b.passive = { easy: t(3, 27), medium: t(26, 4), hard: t(21, 9) }; // 16.7 points: noise at 30 games
    expect(orderingViolations(small)).toEqual([]);
  });

  it('checks easy against hard in a cell as well as the adjacent pairs', () => {
    const c = ordered();
    // easy 50% over hard 20% (30 points), with medium between neither by more than 20.
    c.a.rush = { easy: t(15, 15), medium: t(10, 20), hard: t(6, 24) };
    // Keep the pooled steps clear on map b so only the cell rule speaks.
    c.b.rush = { easy: t(0, 30), medium: t(20, 10), hard: t(30, 0) };
    expect(orderingViolations(c).map((x) => [x.scope, x.map, x.lower, x.higher])).toEqual([['cell', 'a', 'easy', 'hard']]);
  });

  it('a draw is not a win: a level that only draws more is not stronger', () => {
    const c = ordered();
    for (const m of ['a', 'b'] as const) c[m].passive.hard = t(12, 0, 18);
    expect(orderingViolations(c).map((x) => [x.scope, x.plan, x.lower, x.higher])).toEqual([['pooled', 'passive', 'medium', 'hard']]);
  });

  it('fails when nothing was played, and when a level has no games', () => {
    expect(orderingViolations({})).toHaveLength(1);
    const c = ordered();
    c.a.rush.medium = t(0, 0);
    c.b.rush.medium = t(0, 0);
    expect(orderingViolations(c).some((x) => x.scope === 'pooled' && x.plan === 'rush' && /no games at medium/.test(x.why))).toBe(true);
  });
});

describe('the tally', () => {
  it('counts each verdict in its map, plan and level', () => {
    const cells = tally([
      { map: 'm', level: 'easy', plan: 'rush', seed: 1, verdict: 'player', by: 'annihilation', ticks: 10 },
      { map: 'm', level: 'easy', plan: 'rush', seed: 2, verdict: 'computer', by: 'annihilation', ticks: 10 },
      { map: 'm', level: 'hard', plan: 'rush', seed: 1, verdict: 'draw', by: 'cap', ticks: 10 },
    ]);
    expect(cells.m.rush).toEqual({ easy: t(1, 1), medium: t(0, 0), hard: t(0, 0, 1) });
  });
});
