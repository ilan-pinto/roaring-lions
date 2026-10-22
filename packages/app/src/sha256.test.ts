import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const ref = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('sha256Hex', () => {
  // Lengths straddle the 55/56/64-byte padding boundaries; the multi-byte string
  // checks UTF-8 handling. Falsified: dropping the 0x80 terminator turns all red.
  it.each(['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(200), 'שלום ✓'])(
    'matches node:crypto for %j',
    (s) => {
      expect(sha256Hex(s)).toBe(ref(s));
    }
  );
});
