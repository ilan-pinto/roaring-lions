// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { livingHostiles } from './withdrew';

describe('livingHostiles', () => {
  it('counts living side-1 units only, not our own, civilians or the dead', () => {
    const state = { side: [0, 1, 1, 2, 1], alive: [1, 1, 0, 1, 1] };
    expect(livingHostiles(state, 5)).toBe(2);
    expect(livingHostiles(state, 2)).toBe(1); // bounded by the count it is given
  });
});
