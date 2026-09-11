import { describe, expect, it } from 'vitest';
import { betterResult, starRoeFloor, starsFor, type GradedObjective } from './grade';

const prim = (status: GradedObjective['status']): GradedObjective => ({ primary: true, status });
const sec = (status: GradedObjective['status'], carries?: boolean): GradedObjective => ({
  primary: false,
  status,
  ...(carries === undefined ? {} : { carries }),
});

describe('starRoeFloor', () => {
  it('is the mission floor plus twenty, or seventy with no floor', () => {
    expect(starRoeFloor(40)).toBe(60);
    expect(starRoeFloor(45)).toBe(65);
    expect(starRoeFloor(undefined)).toBe(70);
  });
});

describe('starsFor', () => {
  it('gives nothing to anything but a victory', () => {
    expect(starsFor('defeat', 100, undefined, [prim('complete')])).toBe(0);
    expect(starsFor('ongoing', 100, undefined, [prim('complete')])).toBe(0);
  });

  it('enters a victory in the log', () => {
    expect(starsFor('victory', 50, undefined, [prim('complete')])).toBe(1);
  });

  it('names the company in orders when Conduct clears the floor plus twenty', () => {
    expect(starsFor('victory', 60, 40, [prim('complete')])).toBe(2);
    expect(starsFor('victory', 59, 40, [prim('complete')])).toBe(1);
    expect(starsFor('victory', 70, undefined, [prim('complete')])).toBe(2);
  });

  it('cites the company only when every carrying secondary is complete', () => {
    const objs = [prim('complete'), sec('complete', true), sec('active', true)];
    expect(starsFor('victory', 100, undefined, objs)).toBe(2);
    objs[2] = sec('complete', true);
    expect(starsFor('victory', 100, undefined, objs)).toBe(3);
  });

  it('caps at two stars when no secondary carries, however many are complete', () => {
    expect(starsFor('victory', 100, undefined, [prim('complete'), sec('complete')])).toBe(2);
  });

  it('never reaches three stars without two: Conduct is a threshold, not a component', () => {
    expect(starsFor('victory', 60, undefined, [prim('complete'), sec('complete', true)])).toBe(1);
  });
});

describe('betterResult', () => {
  it('prefers more stars, then higher Conduct, then fewer ticks', () => {
    const base = { stars: 2 as const, roe: 80, ticks: 6000, lost: 2 };
    expect(betterResult({ ...base, stars: 3 }, base)).toBe(true);
    expect(betterResult({ ...base, roe: 81 }, base)).toBe(true);
    expect(betterResult({ ...base, ticks: 5999 }, base)).toBe(true);
    expect(betterResult({ ...base, lost: 0 }, base)).toBe(false); // losses never decide
    expect(betterResult(base, base)).toBe(false);
  });
});
