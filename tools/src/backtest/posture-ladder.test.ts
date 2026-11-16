import { describe, expect, it } from 'vitest';
import { LADDER_VARIANTS, monotoneFailure, parsePosture, passiveLost, postureClockFailures, postureLimit, postureSeedCount, readingOf, wrongWay } from './posture-ladder';

describe('the posture ladder judgements (GH-1394)', () => {
  const r = (e: [number, number], s: [number, number], h: [number, number]) => ({
    easier: { wins: e[0], seeds: e[1] },
    standard: { wins: s[0], seeds: s[1] },
    harder: { wins: h[0], seeds: h[1] },
  });

  it('monotone holds when every posture wins everywhere, and on equal fractions over different seed counts', () => {
    expect(monotoneFailure('p', r([8, 8], [30, 30], [8, 8]))).toBeUndefined();
    expect(monotoneFailure('p', r([4, 8], [15, 30], [2, 8]))).toBeUndefined();
  });
  it('monotone fails when Easier wins less than Standard, or Harder more', () => {
    expect(monotoneFailure('p', r([7, 8], [30, 30], [8, 8]))).toMatch(/not monotone/);
    expect(monotoneFailure('p', r([8, 8], [29, 30], [8, 8]))).toMatch(/not monotone/);
  });
  it('a posture with no seeds is not compared', () => {
    expect(monotoneFailure('p', r([0, 0], [30, 30], [0, 0]))).toBeUndefined();
  });

  it('a passive control loses by either cause, and nothing else counts', () => {
    expect(passiveLost('defeat')).toBe(true);
    expect(passiveLost('withdrawn')).toBe(true);
    expect(passiveLost('victory')).toBe(false);
    expect(passiveLost('ongoing')).toBe(false);
    expect(passiveLost(undefined)).toBe(false);
  });

  it('PT_POSTURE and PT_POSTURE_SEEDS are read strictly', () => {
    expect(parsePosture(undefined)).toBe('standard');
    expect(parsePosture('easier')).toBe('easier');
    expect(() => parsePosture('hard')).toThrow();
    expect(postureSeedCount(undefined, 30)).toBe(8);
    expect(postureSeedCount('30', 30)).toBe(30);
    expect(postureSeedCount('0', 30)).toBe(0);
    expect(() => postureSeedCount('31', 30)).toThrow();
    expect(() => postureSeedCount('x', 30)).toThrow();
  });

  it('the overlaid limit is what the posture plays', () => {
    expect(postureLimit('beit_sahwan_2_foothold', 'standard')).toBe(840);
    expect(postureLimit('beit_sahwan_2_foothold', 'easier')).toBe(1050);
    expect(postureLimit('beit_sahwan_2_foothold', 'harder')).toBe(840);
    expect(postureLimit('beit_sahwan_0_tutorial', 'easier')).toBe(1440);
  });

  it('the clock validator is clean at every posture (S8)', () => {
    expect(postureClockFailures()).toEqual([]);
  });

  it('the ladder reads Easier with and without the relief, and Harder', () => {
    expect(LADDER_VARIANTS.map((v) => v.key)).toEqual(['easier', 'easier+relief', 'harder']);
  });

  it('readingOf: wins, median winning time, mean starting losses', () => {
    const r = readingOf(
      [
        { result: 'victory', minutes: 4, lost: 1 },
        { result: 'victory', minutes: 2, lost: 0 },
        { result: 'defeat', minutes: 5, lost: 5 },
        { result: 'victory', minutes: 3, lost: 2 },
      ],
      4
    );
    expect(r).toEqual({ wins: 3, seeds: 4, medianMin: 3, meanLost: 2 });
    expect(readingOf([{ result: 'victory', minutes: 2, lost: 0 }, { result: 'victory', minutes: 4, lost: 0 }], 2).medianMin).toBe(3);
    expect(Number.isNaN(readingOf([], 8).medianMin)).toBe(true);
  });

  it('wrongWay flags an Easier reading that is harder than Standard, and a Harder one that is easier, and nothing else', () => {
    const std = { wins: 8, seeds: 8, medianMin: 4, meanLost: 1 };
    expect(wrongWay('easier', std, std)).toBeUndefined();
    expect(wrongWay('easier', { ...std, meanLost: 0.5, medianMin: 3.5 }, std)).toBeUndefined();
    expect(wrongWay('easier', { ...std, wins: 7 }, std)).toMatch(/wins 7\/8/);
    expect(wrongWay('easier', { ...std, medianMin: 4.3 }, std)).toMatch(/median win/);
    expect(wrongWay('easier', { ...std, medianMin: 4.1 }, std)).toBeUndefined(); // inside 5%
    expect(wrongWay('easier', { ...std, meanLost: 2 }, std)).toMatch(/starting losses 2.0 against 1.0/);
    expect(wrongWay('harder', { ...std, meanLost: 0.5 }, std)).toMatch(/starting losses/);
    expect(wrongWay('harder', { ...std, meanLost: 2, medianMin: 5 }, std)).toBeUndefined();
  });
});
