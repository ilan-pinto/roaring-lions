import { describe, expect, it } from 'vitest';
import { isIdle, nextIdle } from './idle';

const busy = { alive: true, side: 0, moving: false, waypoints: 0, curTarget: -1, curStructure: -1, demoTarget: -1, carriedBy: -1, garrisonedIn: -1 };

describe('isIdle', () => {
  it('a living player unit doing nothing is idle', () => {
    expect(isIdle(busy)).toBe(true);
  });
  it('every one of these is work', () => {
    expect(isIdle({ ...busy, moving: true })).toBe(false);
    expect(isIdle({ ...busy, waypoints: 2 })).toBe(false);
    expect(isIdle({ ...busy, curTarget: 4 })).toBe(false);
    expect(isIdle({ ...busy, curStructure: 4 })).toBe(false);
    expect(isIdle({ ...busy, demoTarget: 4 })).toBe(false);
  });
  // A unit in a vehicle or in a building is not "idle and forgotten" -- it is
  // where the player put it, and offering to jump to it would walk the player
  // through the same three passengers every time they pressed the key.
  it('a passenger and a garrison are posted, not idle', () => {
    expect(isIdle({ ...busy, carriedBy: 3 })).toBe(false);
    expect(isIdle({ ...busy, garrisonedIn: 3 })).toBe(false);
  });
  it('the dead and the enemy are never idle', () => {
    expect(isIdle({ ...busy, alive: false })).toBe(false);
    expect(isIdle({ ...busy, side: 1 })).toBe(false);
  });
});

describe('nextIdle', () => {
  const idle = (id: number) => id % 2 === 0;
  it('walks forward from the last one and wraps', () => {
    expect(nextIdle([0, 1, 2, 3, 4], -1, idle)).toBe(0);
    expect(nextIdle([0, 1, 2, 3, 4], 0, idle)).toBe(2);
    expect(nextIdle([0, 1, 2, 3, 4], 4, idle)).toBe(0);
  });
  it('is -1 when nobody is idle, rather than looping forever', () => {
    expect(nextIdle([1, 3], -1, idle)).toBe(-1);
  });
  it('starts from the front when the remembered unit is gone from the list', () => {
    expect(nextIdle([0, 2], 99, idle)).toBe(0);
  });
});
