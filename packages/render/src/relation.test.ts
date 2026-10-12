import { describe, it, expect } from 'vitest';
import { relationOf, isOwnSide, isHostileSide, colorSlot } from './relation';

describe('relationOf', () => {
  it('viewer 0 reproduces today: 0 own, 1 hostile, 2 neutral', () => {
    expect([0, 1, 2].map((s) => relationOf(s, 0))).toEqual(['own', 'hostile', 'neutral']);
    expect([0, 1, 2].map((s) => colorSlot(s, 0))).toEqual([0, 1, 2]);
  });
  it('viewer 1 swaps the combatants and keeps civilians neutral', () => {
    expect([0, 1, 2].map((s) => relationOf(s, 1))).toEqual(['hostile', 'own', 'neutral']);
    expect([0, 1, 2].map((s) => colorSlot(s, 1))).toEqual([1, 0, 2]);
  });
  it('the predicates agree with relationOf', () => {
    for (const v of [0, 1]) for (const s of [0, 1, 2]) {
      expect(isOwnSide(s, v)).toBe(relationOf(s, v) === 'own');
      expect(isHostileSide(s, v)).toBe(relationOf(s, v) === 'hostile');
    }
  });
});
