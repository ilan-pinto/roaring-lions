import { describe, expect, it } from 'vitest';
import { overmatchShift, penetrationHpCost } from './vehicle-health';

// GH-560. Every expectation below is a literal, worked by hand from
//   cost = max(damage, floor(maxHp * 22282 / 65536) * (60 + shift) / 60)
// on raw Q16.16 values (hp 3000 = 196608000, damage 520 = 34078720). None is
// imported from the code under test.

const Q = 65536;

describe('penetrationHpCost (GH-560, design 5.2)', () => {
  // [case, hp, shift, damage, cost raw, hits to kill]
  const rows: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
    ['120 mm v Lavi front', 3000, 28, 520, 98040800, 3],
    ['120 mm v Namer front', 2200, 30, 520, 73530600, 2],
    ['120 mm v Eitan front', 1600, 30, 520, 53476800, 2],
    ['Kornet v Lavi front', 3000, 8, 400, 75758800, 3],
    ['Kornet v Lavi side', 3000, 30, 400, 100269000, 2],
    ['RPG-7 v Lavi side', 3000, 27, 300, 96926700, 3],
    ['RPG-7 v Eitan front', 1600, 30, 300, 53476800, 2],
    ['ZU-23 v Peten front', 640, 0, 85, 14260480, 3],
    ['the weapon dominates (cost is the damage)', 640, 0, 300, 19660800, 3],
  ];

  for (const [name, hp, shift, damage, cost, hits] of rows) {
    it(`${name}: ${cost} raw, ${hits} hits`, () => {
      expect(penetrationHpCost(hp * Q, damage * Q, shift)).toBe(cost);
      expect(Math.ceil((hp * Q) / cost)).toBe(hits);
    });
  }

  it('no single hit kills a sound hull, even at the heaviest overmatch', () => {
    const cost = penetrationHpCost(196608000, 34078720, 30);
    expect(cost).toBe(100269000);
    expect(cost).toBeLessThan(196608000);
  });

  it('the product stays an int32 for the largest Fx hull (32767 hp) at shift 30', () => {
    // 32767 hp = 2147418112 raw. floor = 730114294; x 90 / 60 = 1095171441, below 2^31.
    // Moving the `| 0` before the division wraps the 6.5e10 product and reads a different number.
    expect(penetrationHpCost(2147418112, 0, 30)).toBe(1095171441);
  });
});

describe('overmatchShift (GH-560)', () => {
  // z in Q16.16 turned into raw by hand: 1.5 = 98304, 3.5 = 229376, 4 = 262144, 9 = 589824.
  const cases: ReadonlyArray<readonly [string, number, number]> = [
    ['z = 0.5 (under 1: no shift)', 32768, 0],
    ['z = 1.0', 65536, 0],
    ['z = 1.5', 98304, 5],
    ['z = 1.95 (floors, not rounds)', 127795, 9],
    ['z = 3.5', 229376, 25],
    ['z = 4 (the cap)', 262144, 30],
    ['z = 9 (clamped)', 589824, 30],
  ];
  for (const [name, z, shift] of cases) {
    it(`${name} -> ${shift}`, () => {
      expect(overmatchShift(z)).toBe(shift);
    });
  }
});
