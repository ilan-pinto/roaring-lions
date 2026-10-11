import { describe, it, expect } from 'vitest';
import { fold, matchDigest, DIGEST_SEED } from './digest';

describe('matchDigest', () => {
  it('folds the three words in order and is sensitive to each', () => {
    const a = matchDigest(1, 2, 3);
    expect(a).toBe(fold(fold(fold(DIGEST_SEED, 1), 2), 3));
    expect(matchDigest(2, 2, 3)).not.toBe(a);
    expect(matchDigest(1, 3, 3)).not.toBe(a);
    expect(matchDigest(1, 2, 4)).not.toBe(a);
    expect(matchDigest(2, 1, 3)).not.toBe(a);
  });
  it('fold matches the sim hash primitive bit for bit', () => {
    // Literals computed once from packages/sim/src/hash.ts (hashWord, HASH_SEED), not restated from fold.
    expect(fold(0x811c9dc5 | 0, 7)).toBe(34363494);
    expect(matchDigest(1, 2, 3)).toBe(1456420779);
    expect(matchDigest(0x12345678, -5, 20)).toBe(-388990880);
  });
});
