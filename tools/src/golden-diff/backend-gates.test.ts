import { describe, expect, it } from 'vitest';
import { bitIdenticalVerdict, unportedVerdict } from './backend-gates';

describe('bitIdenticalVerdict', () => {
  it('passes five identical hashes', () => {
    expect(bitIdenticalVerdict(Array(5).fill('a'.repeat(64)), 5).ok).toBe(true);
  });
  it('fails one different hash in five, naming the split', () => {
    const v = bitIdenticalVerdict(['a', 'a', 'a', 'a', 'b'], 5);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/2 distinct pictures/);
  });
  it('fails when fewer captures ran than required (vacuous agreement is not agreement)', () => {
    expect(bitIdenticalVerdict(['a', 'a'], 5).ok).toBe(false);
    expect(bitIdenticalVerdict([], 5).ok).toBe(false);
  });
});

describe('unportedVerdict', () => {
  const rows = [{ kind: 'on-before-compile', key: 'rl-ground', objects: 3 }];
  it('is report-only in P0: prints the full list and does not vote', () => {
    const v = unportedVerdict(rows, true);
    expect(v.ok).toBe(true);
    expect(v.lines.join('\n')).toContain('rl-ground');
    expect(v.lines[0]).toContain('REPORT-ONLY');
  });
  it('votes red on any hook once report-only is off, and green on none', () => {
    expect(unportedVerdict(rows, false).ok).toBe(false);
    expect(unportedVerdict([], false).ok).toBe(true);
  });
});
