/** GH-1399 K1: the rating maths' checks (spec `2026-11-17-ranked-queue-design.md` §8, K1-a to K1-d, and the rulings Q2, Q3).
 *  Every expected number is a LITERAL. The oracles are (1) Glickman's own worked example ("Example of the Glicko-2 system":
 *  r' 1464.06 from his rounded mu' -0.2069, RD' 151.52, sigma' 0.05999), and (2) a scratch Python Glicko-2 written from his note,
 *  not from this file, solving step 5 by bisection rather than the Illinois method (not committed; its numbers are pasted here,
 *  and they reproduce the doc's §1.3 table). Nothing below computes an expected value with the code under test. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  advantageFor,
  bandOf,
  clampRd,
  idleRd,
  rankView,
  rateAt,
  rateGame,
  ratePeriod,
  repeatWeight,
  shownRating,
  type Game,
  type Rating,
} from './glicko2';

const near = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThan(tol);
const game = (r: number, rd: number, score: 0 | 0.5 | 1, weight = 1, adv = 0): Game => ({ opp: { r, rd }, score, weight, adv });
const GLICKMAN_PLAYER: Rating = { r: 1500, rd: 200, sigma: 0.06 };
const DAY = 86_400_000;
const NOW = 1_790_000_000_000;

describe('K1-a: Glickman\'s worked example', () => {
  it('1500/200/0.06 beats 1400/30, loses to 1550/100 and 1700/300 in one period, tau 0.5: 1464.05 / 151.52 / 0.05999', () => {
    const out = ratePeriod(GLICKMAN_PLAYER, [game(1400, 30, 1), game(1550, 100, 0), game(1700, 300, 0)]);
    // Glickman's printed values. His r' 1464.06 is 173.7178 x his ROUNDED mu' (-0.2069) + 1500; unrounded it is 1464.0507,
    // which is the doc's 1464.05. So mu' is pinned to his four places, and r' to the unrounded value.
    near((out.r - 1500) / 173.7178, -0.2069, 0.00005);
    near(out.r, 1464.05, 0.005);
    near(out.rd, 151.52, 0.005);
    near(out.sigma, 0.05999, 0.00001);
    // The scratch oracle's longer digits: tight enough that tau 0.3 (sigma' 0.0599986) or 1.2 (0.0599769) fails.
    near(out.r, 1464.0507, 0.0001);
    near(out.rd, 151.5165, 0.0001);
    near(out.sigma, 0.059996, 0.0000005);
  });

  it('the one-game-a-period rule (§1.2): rateGame is a period of one game; Glickman\'s first game alone gives 1563.56 / 175.40', () => {
    const one = rateGame(GLICKMAN_PLAYER, game(1400, 30, 1));
    expect(one).toEqual(ratePeriod(GLICKMAN_PLAYER, [game(1400, 30, 1)]));
    near(one.r, 1563.5642, 0.0001);
    near(one.rd, 175.4027, 0.0001);
    near(one.sigma, 0.0599987, 0.0000005);
  });

  it('the same three games as three one-game periods differ from one three-game period (1463.79 / 151.87, not 1464.05 / 151.52)', () => {
    let s: Rating = GLICKMAN_PLAYER;
    for (const gm of [game(1400, 30, 1), game(1550, 100, 0), game(1700, 300, 0)]) s = rateGame(s, gm);
    near(s.r, 1463.7884, 0.0001);
    near(s.rd, 151.8732, 0.0001);
  });

  it('reproduces the doc\'s §1.3 single-game table', () => {
    const newcomer: Rating = { r: 1500, rd: 350, sigma: 0.06 };
    const est: Rating = { r: 1500, rd: 60, sigma: 0.06 };
    const win = rateGame(newcomer, game(1500, 60, 1));
    near(win.r, 1675.0688, 0.0001); // doc: 1675
    near(win.rd, 248.8335, 0.0001); // doc: RD 249
    near(rateGame(newcomer, game(1500, 60, 0)).r, 1324.9312, 0.0001); // doc: a loss, 1325
    near(rateGame(est, game(1500, 350, 0)).r, 1492.955, 0.0001); // doc: 1493
    near(rateGame(est, game(1500, 350, 1)).r, 1507.045, 0.0001); // doc: 1507
    near(rateGame(est, game(1500, 350, 1)).rd, 60.4841, 0.0001); // doc: RD 60
    const ten = rateGame({ r: 1600, rd: 108, sigma: 0.06 }, game(1600, 60, 1));
    near(ten.r, 1630.423, 0.0001); // doc: 1630
    near(ten.rd, 103.7303, 0.0001); // doc: RD 104
    near(rateGame(est, game(1500, 60, 1)).r, 1510.184, 0.0001); // doc: +10.1
    near(rateGame(est, game(1300, 60, 0)).r, 1484.4843, 0.0001); // doc: 1484
  });
});

describe('K1-b: the game weight', () => {
  it('a game of weight 0 changes nothing', () => {
    const before: Rating = { r: 1612.5, rd: 81.25, sigma: 0.0612 };
    expect(rateGame(before, game(1400, 30, 1, 0))).toEqual(before);
    expect(rateGame(before, game(1900, 300, 0, 0, 70))).toEqual(before);
  });

  it('weight 0.5 moves less than weight 1 and more than 0: 1535.97 / 186.61 against 1563.56 / 175.40', () => {
    const half = rateGame(GLICKMAN_PLAYER, game(1400, 30, 1, 0.5));
    near(half.r, 1535.9715, 0.0001);
    near(half.rd, 186.6055, 0.0001);
    const full = rateGame(GLICKMAN_PLAYER, game(1400, 30, 1, 1));
    expect(half.r).toBeGreaterThan(1500);
    expect(half.r).toBeLessThan(full.r);
    expect(half.rd).toBeLessThan(200);
    expect(half.rd).toBeGreaterThan(full.rd);
  });

  it('repeat damping (§5.1): the n-th game between one pair in 7 days weighs 1, 0.5, 0.25, 0.125', () => {
    expect([1, 2, 3, 4].map(repeatWeight)).toEqual([1, 0.5, 0.25, 0.125]);
    expect(() => repeatWeight(0)).toThrow(RangeError);
    expect(() => repeatWeight(1.5)).toThrow(RangeError);
  });

  it('refuses a weight outside [0, 1] and a score that is not 0, 0.5 or 1', () => {
    expect(() => rateGame(GLICKMAN_PLAYER, game(1500, 60, 1, 1.01))).toThrow(RangeError);
    expect(() => rateGame(GLICKMAN_PLAYER, game(1500, 60, 1, -0.01))).toThrow(RangeError);
    expect(() => rateGame(GLICKMAN_PLAYER, game(1500, 60, 1, Number.NaN))).toThrow(RangeError);
    expect(() => rateGame(GLICKMAN_PLAYER, { opp: { r: 1500, rd: 60 }, score: 0.7 as 0.5, weight: 1, adv: 0 })).toThrow(RangeError);
  });
});

describe('K1-c: the advantage term', () => {
  it('a mirror cell gives both seats 0; a faction cell gives +a to the favoured seat and -a to the other', () => {
    expect(advantageFor({ kind: 'mirror' }, 0)).toBe(0);
    expect(advantageFor({ kind: 'mirror' }, 1)).toBe(0);
    const cell = { kind: 'faction', adv: 42, favours: 1 } as const;
    expect(advantageFor(cell, 1)).toBe(42);
    expect(advantageFor(cell, 0)).toBe(-42);
  });

  it('with a > 0 the favoured side gains less for a win than with a = 0, and the other side more', () => {
    const p: Rating = { r: 1500, rd: 200, sigma: 0.06 };
    const mirror = rateGame(p, game(1500, 200, 1, 1, 0));
    const favoured = rateGame(p, game(1500, 200, 1, 1, 50));
    const against = rateGame(p, game(1500, 200, 1, 1, -50));
    near(mirror.r, 1578.8017, 0.0001);
    near(favoured.r, 1569.4685, 0.0001);
    near(against.r, 1588.5774, 0.0001);
    expect(favoured.r).toBeLessThan(mirror.r);
    expect(against.r).toBeGreaterThan(mirror.r);
  });
});

describe('K1-d: the idle term', () => {
  it('RD 50 idle 7 / 30 / 90 / 180 days gives 63 / 93 / 145 / 200 (§1.2)', () => {
    near(idleRd(50, NOW - 7 * DAY, NOW), 62.8611, 0.0001);
    near(idleRd(50, NOW - 30 * DAY, NOW), 93.3852, 0.0001);
    expect(Math.round(idleRd(50, NOW - 30 * DAY, NOW))).toBe(93);
    near(idleRd(50, NOW - 90 * DAY, NOW), 145.473, 0.0001);
    near(idleRd(50, NOW - 180 * DAY, NOW), 199.5615, 0.0001);
  });

  it('never above 350, never below 45; no growth before the first game or for a clock that runs backwards', () => {
    expect(idleRd(340, NOW - 1000 * DAY, NOW)).toBe(350);
    expect(idleRd(30, NOW, NOW)).toBe(45);
    expect(idleRd(80, null, NOW)).toBe(80);
    expect(idleRd(80, NOW + DAY, NOW)).toBe(80);
    expect(clampRd(400)).toBe(350);
    expect(clampRd(10)).toBe(45);
  });

  it('rateAt inflates both RDs by idle time before the update (the journal\'s rd_before and opp_rd)', () => {
    const out = rateAt(
      { r: 1500, rd: 50, sigma: 0.06, gamesTotal: 40, lastGameAt: NOW - 30 * DAY },
      { r: 1500, rd: 50, lastGameAt: NOW - 7 * DAY },
      { score: 1, weight: 1, adv: 0 },
      NOW,
    );
    near(out.before.rd, 93.3852, 0.0001);
    near(out.opp.rd, 62.8611, 0.0001);
    expect(out.after).toEqual(rateGame(out.before, { opp: out.opp, score: 1, weight: 1, adv: 0 }));
  });
});

describe('the RD clamp [45, 350] after an update', () => {
  it('floors at 45: 1500/45/0.01 beating 1500/45 would leave RD 44.67', () => {
    const out = rateGame({ r: 1500, rd: 45, sigma: 0.01 }, game(1500, 45, 1));
    expect(out.rd).toBe(45);
    near(out.r, 1505.6849, 0.0001);
  });

  it('caps at 350: 1500/350 in a game of weight 0.00001 against 1500/350 would leave RD 350.15', () => {
    expect(rateGame({ r: 1500, rd: 350, sigma: 0.06 }, game(1500, 350, 1, 0.00001)).rd).toBe(350);
  });
});

describe('the visible rank (§1.5, Q3)', () => {
  const at = (r: number, rd: number, gamesTotal: number, lastGameAt: number | null = NOW) => ({ r, rd, sigma: 0.06, gamesTotal, lastGameAt });

  it('no visible rank before 10 rated games: "Placement n of 10"', () => {
    for (let n = 0; n < 10; n += 1) {
      expect(rankView(at(1900, 45, n), NOW)).toEqual({ kind: 'placement', played: n, of: 10 });
      expect(shownRating(at(1900, 45, n), NOW)).toBeNull();
    }
    expect(rankView(at(1900, 45, 10), NOW)).toEqual({ kind: 'band', band: 'b6' });
  });

  it('is r - 2*RD in whole points, floored: 1700/108 shows 1484 (b4), not 1592 (b5)', () => {
    expect(shownRating(at(1700, 108, 10), NOW)).toBe(1484);
    expect(rankView(at(1700, 108, 10), NOW)).toEqual({ kind: 'band', band: 'b4' });
    expect(shownRating(at(1300.9, 100.5, 12), NOW)).toBe(1099);
    expect(rankView(at(1300.9, 100.5, 12), NOW)).toEqual({ kind: 'band', band: 'b1' });
  });

  it('idling lowers it at read time: 1600/50 shows b4 (1500), and b3 (1309) after 90 idle days', () => {
    expect(rankView(at(1600, 50, 30, NOW), NOW)).toEqual({ kind: 'band', band: 'b4' });
    expect(shownRating(at(1600, 50, 30, NOW - 90 * DAY), NOW)).toBe(1309);
    expect(rankView(at(1600, 50, 30, NOW - 90 * DAY), NOW)).toEqual({ kind: 'band', band: 'b3' });
  });

  it('the view carries a band id and never the number', () => {
    expect(Object.keys(rankView(at(1700, 108, 10), NOW)).sort()).toEqual(['band', 'kind']);
    expect(Object.keys(rankView(at(1700, 108, 3), NOW)).sort()).toEqual(['kind', 'of', 'played']);
  });

  it('band edges: a value at an edge belongs to the band above', () => {
    const cases: Array<[number, string]> = [
      [-500, 'b1'], [1099, 'b1'], [1100, 'b2'], [1249, 'b2'], [1250, 'b3'], [1399, 'b3'], [1400, 'b4'],
      [1549, 'b4'], [1550, 'b5'], [1699, 'b5'], [1700, 'b6'], [4000, 'b6'],
    ];
    for (const [shown, band] of cases) expect(bandOf(shown)).toBe(band);
  });
});

describe('purity', () => {
  it('glicko2.ts reads no clock, no randomness and imports nothing', () => {
    const src = readFileSync(new URL('./glicko2.ts', import.meta.url), 'utf8');
    for (const banned of [/\bDate\b/, /Math\.random/, /\bfetch\s*\(/, /\bcrypto\b/, /^\s*import\s/m, /\bimport\s*\(/, /\bawait\b/]) {
      expect(src).not.toMatch(banned);
    }
  });
});
