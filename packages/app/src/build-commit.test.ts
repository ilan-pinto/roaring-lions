import { describe, expect, it } from 'vitest';
import { shortCommit } from './build-commit';

describe('shortCommit', () => {
  it('is the first seven hex digits of a full commit, as git rev-parse --short prints', () => {
    expect(shortCommit('16248797e0123456789abcdef0123456789abcde')).toBe('1624879');
  });
  it('keeps a commit that is already short', () => {
    expect(shortCommit('1624879')).toBe('1624879');
  });
  it('falls back to "dev" for no commit or anything that is not 7-40 hex digits', () => {
    for (const bad of ['', 'dev', '123456', 'GHIJKLMNO', '16248797E', 'x'.repeat(40), '1'.repeat(41)]) {
      expect(shortCommit(bad)).toBe('dev');
    }
  });
});
