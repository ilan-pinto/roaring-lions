import { describe, it, expect } from 'vitest';
import { fireVisible } from './fire-visible';

describe('fireVisible', () => {
  it('own fire always draws', () => {
    expect(fireVisible(1, 1, false, false)).toBe(true);
  });
  it('hostile fire draws when the shooter or the impact is in sight, never otherwise', () => {
    expect(fireVisible(0, 1, true, false)).toBe(true);
    expect(fireVisible(0, 1, false, true)).toBe(true);
    expect(fireVisible(0, 1, false, false)).toBe(false);
  });
  it('viewer 0 keeps today\'s own-fire behaviour', () => {
    expect(fireVisible(0, 0, false, false)).toBe(true);
  });
});
