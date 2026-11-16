import { describe, expect, it } from 'vitest';
import { monotoneFailure, parsePosture, passiveLost, postureClockFailures, postureLimit, postureSeedCount } from './posture-ladder';

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
});
