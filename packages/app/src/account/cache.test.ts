import { describe, expect, it } from 'vitest';
import { ACCOUNT_CACHE_KEY, readCache, writeCache } from './cache';
import { cacheOf, memStorage, slotOf } from './fixtures';

describe('cache', () => {
  it('round trips, malformed reads as null', () => {
    const s = memStorage();
    const c = cacheOf(undefined, { s1: slotOf('s1') });
    expect(writeCache(s, c)).toBe(true);
    expect(readCache(s)).toEqual(c);
    for (const bad of ['nope', 'null', '{"version":2}', '{"version":1,"publicId":"p","confirmed":{},"bodies":{}}']) {
      s.map.set(ACCOUNT_CACHE_KEY, bad);
      expect(readCache(s)).toBeNull();
    }
  });
  it('a refused write is reported, a blocked store reads null and never throws', () => {
    const boom = (): never => {
      throw new Error('q');
    };
    expect(writeCache({ getItem: boom, setItem: boom, removeItem: boom }, cacheOf())).toBe(false);
    expect(readCache({ getItem: boom, setItem: boom, removeItem: boom })).toBeNull();
    expect(writeCache(null, cacheOf())).toBe(false);
    expect(readCache(null)).toBeNull();
  });
});
