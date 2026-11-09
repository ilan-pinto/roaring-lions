import { describe, expect, it } from 'vitest';
import { tabIdOf } from './tab-id';
import { memStorage } from './fixtures';

describe('tabIdOf', () => {
  it('returns the same id twice on one storage, and different ids on two', () => {
    const a = memStorage();
    const first = tabIdOf(a);
    expect(first).not.toBe('');
    expect(tabIdOf(a)).toBe(first);
    expect(tabIdOf(memStorage())).not.toBe(first);
  });

  it('a throwing storage still returns a stable id for the page load', () => {
    const boom = (): never => {
      throw new Error('blocked');
    };
    const s = { getItem: boom, setItem: boom, removeItem: boom };
    const id = tabIdOf(s);
    expect(id).not.toBe('');
    expect(tabIdOf(s)).toBe(id);
  });
});
