// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { livingHostiles } from './withdrew';

describe('livingHostiles', () => {
  it('counts living side-1 units only, not our own, civilians or the dead', () => {
    const state = { side: [0, 1, 1, 2, 1], alive: [1, 1, 0, 1, 1] };
    expect(livingHostiles(state, 5)).toBe(2);
    expect(livingHostiles(state, 2)).toBe(1); // bounded by the count it is given
  });

  it('counts the side hostile to the viewer: side 0 for a seat on side 1 (N1a task 6)', () => {
    const state = { side: [0, 1, 1, 2, 0], alive: [1, 1, 0, 1, 1] };
    expect(livingHostiles(state, 5, 1)).toBe(2);
    expect(livingHostiles(state, 5, 0)).toBe(1);
  });
});
