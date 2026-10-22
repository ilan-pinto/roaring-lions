import { describe, expect, it } from 'vitest';
import { GRENADE_LADDER_MS, firstFlight, flightRungs, grenadeLadder, landingSkewMs } from './grenade-captures';

describe('the grenade ladder', () => {
  it('is 51 rungs of 50 ms from 0 to 2500', () => {
    expect(GRENADE_LADDER_MS).toEqual(grenadeLadder());
    expect(GRENADE_LADDER_MS).toHaveLength(51);
    expect(GRENADE_LADDER_MS[0]).toBe(0);
    expect(GRENADE_LADDER_MS[50]).toBe(2500);
    for (let i = 1; i < GRENADE_LADDER_MS.length; i++) expect(GRENADE_LADDER_MS[i] - GRENADE_LADDER_MS[i - 1]).toBe(50);
  });
});

describe('flightRungs', () => {
  it('counts rungs with a round up and names the first and last', () => {
    const cells = [0, 50, 100, 150, 200].map((tMs, i) => ({ tMs, inFlight: i === 1 || i === 2 || i === 3 ? 1 : 0 }));
    expect(flightRungs(cells)).toEqual({ count: 3, firstMs: 50, lastMs: 150 });
  });
  it('reports nulls when nothing flew, rather than a zero that reads as a time', () => {
    expect(flightRungs([{ tMs: 0, inFlight: 0 }])).toEqual({ count: 0, firstMs: null, lastMs: null });
  });
});

describe('landingSkewMs', () => {
  it('is drawn minus sim, positive when the picture lands late', () => {
    expect(landingSkewMs(650, 600)).toBe(50);
    expect(landingSkewMs(550, 600)).toBe(-50);
  });
  it('is null when either side never happened', () => {
    expect(landingSkewMs(null, 600)).toBeNull();
    expect(landingSkewMs(600, null)).toBeNull();
  });
});

describe('firstFlight', () => {
  const tl = (flags: string): [number, number][] => [...flags].map((c, i) => [i * 16, Number(c)]);
  it('measures the first run only, not a later volley', () => {
    expect(firstFlight(tl('0011100011'))).toEqual({ frames: 3, startMs: 32, endMs: 80 });
  });
  it('is null when nothing flew or the round never landed inside the window', () => {
    expect(firstFlight(tl('0000'))).toBeNull();
    expect(firstFlight(tl('0011'))).toBeNull();
  });
});
