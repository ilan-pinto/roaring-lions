// GH-1389: the computer ladder's ordering gate on LITERAL win counts -- never on a ladder run, so the gate's own verdict is
// what is under test. Each fixture is one ordered ladder with one cell changed.
import { describe, expect, it } from 'vitest';
import { LADDER_MARGINS, orderingViolations, pooled, winRate, type LadderCells, type Tally } from './backtest/computer-ladder-gate';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import { cellKey, computerFactionOf, ladderCells, ladderRequest, tally } from './backtest/computer-ladder-match';

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

describe('the ladder cells (GH-1389, Sarim withholds)', () => {
  it('by default are the ladder as it always ran: the mirror in annihilation on every open map, keyed by the map alone', () => {
    const cells = ladderCells({});
    expect(cells).toEqual(VERSUS_FAIR_MAPS.map((map) => ({ map, matchup: 'mirror', winMode: null })));
    expect(cells.map(cellKey)).toEqual([...VERSUS_FAIR_MAPS]);
    expect(ladderCells({ maps: 'tel_marum,milh_flats' })).toEqual([{ map: 'tel_marum', matchup: 'mirror', winMode: null }, { map: 'milh_flats', matchup: 'mirror', winMode: null }]);
    expect(cells.map(computerFactionOf)).toEqual(VERSUS_FAIR_MAPS.map(() => 'kdf'));
  });

  it('the default request is the one playMatch always armed, key for key (no winMode key, no matchup but the mirror)', () => {
    // The literal is the request playMatch built before cells existed (origin/dev at 30cca0749).
    expect(JSON.stringify(ladderRequest('tel_marum', 'easy', 89000))).toBe(JSON.stringify({ map: 'tel_marum', matchup: 'mirror', callsign: 'Plan', computerName: 'Computer', build: 'ladder+0', seed: 89000, level: 'easy' }));
    expect(Object.keys(ladderRequest('tel_marum', 'easy', 89000))).toEqual(['map', 'matchup', 'callsign', 'computerName', 'build', 'seed', 'level']);
    expect(JSON.stringify(ladderRequest('tel_marum', null, 7))).toBe(JSON.stringify({ map: 'tel_marum', matchup: 'mirror', callsign: 'Plan', computerName: 'Computer', build: 'ladder+0', seed: 7 }));
  });

  it('--cells names a pairing and a win mode, seats the computer on the other faction, and keys the tally apart', () => {
    const cells = ladderCells({ cells: 'wadi_tarfan:kdf:camp,wadi_tarfan_l:kdf:camp' });
    expect(cells).toEqual([{ map: 'wadi_tarfan', matchup: 'kdf', winMode: 'camp' }, { map: 'wadi_tarfan_l', matchup: 'kdf', winMode: 'camp' }]);
    expect(cells.map(computerFactionOf)).toEqual(['sarim', 'sarim']);
    expect(computerFactionOf({ matchup: 'sarim' })).toBe('kdf');
    expect(ladderRequest('wadi_tarfan', 'easy', 1, cells[0])).toMatchObject({ matchup: 'kdf', winMode: 'camp', level: 'easy' });
    expect(cellKey(cells[0])).toBe('wadi_tarfan kdf camp');
    const t2 = tally([
      { map: 'wadi_tarfan', level: 'easy', plan: 'rush', seed: 1, verdict: 'player', by: 'camp', ticks: 10 },
      { map: 'wadi_tarfan', matchup: 'kdf', winMode: 'camp', level: 'easy', plan: 'rush', seed: 1, verdict: 'computer', by: 'camp', ticks: 10 },
    ]);
    expect(Object.keys(t2)).toEqual(['wadi_tarfan', 'wadi_tarfan kdf camp']);
    expect(() => ladderCells({ maps: 'a', cells: 'a:kdf' })).toThrow(/not both/);
    expect(() => ladderCells({ cells: 'a:kfd:camp' })).toThrow(/bad matchup/);
    expect(() => ladderCells({ cells: 'a:kdf:camps' })).toThrow(/bad win mode/);
  });
});
