// The release rule, as assertions.
//
// A version derived from commit subjects is only as good as the parsing, and
// the case that matters most is the one that does NOTHING: this repo lands
// documentation-only merges regularly, and a bump there would cut a tag
// marking no change to the game.
import { describe, expect, it } from 'vitest';
import { commitType, nextVersion } from '../next_version.mjs';

describe('commitType', () => {
  it('reads a bare prefix and a scoped one', () => {
    expect(commitType('feat: thing')).toBe('feat');
    expect(commitType('fix(sim): thing')).toBe('fix');
  });

  it('reads a breaking-change marker without losing the type', () => {
    expect(commitType('feat(app)!: thing')).toBe('feat');
  });

  it('returns null for a subject with no recognisable prefix', () => {
    // Not "assume a patch": an unparseable subject is not evidence of a
    // change worth releasing, and guessing would cut tags off merge commits.
    expect(commitType('Merge branch main')).toBeNull();
    expect(commitType('WIP')).toBeNull();
  });
});

describe('nextVersion', () => {
  it('bumps the minor for a feat, and zeroes the patch', () => {
    expect(nextVersion('0.1.4', ['feat(app): thing'])).toBe('0.2.0');
  });

  it('bumps the patch for a fix', () => {
    expect(nextVersion('0.1.4', ['fix(sim): thing'])).toBe('0.1.5');
  });

  it('lets a feat outrank a fix however they are ordered', () => {
    expect(nextVersion('0.1.0', ['fix: a', 'feat: b'])).toBe('0.2.0');
    expect(nextVersion('0.1.0', ['feat: b', 'fix: a'])).toBe('0.2.0');
  });

  it('does NOTHING for docs, test and refactor alone', () => {
    // The case this rule exists for. A spec, a plan and a ledger correction
    // are a normal merge here and they change nothing a player can see.
    expect(nextVersion('0.1.0', ['docs(spec): thing', 'test(tools): thing', 'refactor(sim): thing']))
      .toBeNull();
  });

  it('does nothing for an empty range', () => {
    expect(nextVersion('0.1.0', [])).toBeNull();
  });

  it('ignores unparseable subjects rather than counting them', () => {
    expect(nextVersion('0.1.0', ['Merge pull request #12', 'docs: thing'])).toBeNull();
  });

  it('carries a two-digit minor rather than treating it as text', () => {
    expect(nextVersion('1.9.0', ['feat: thing'])).toBe('1.10.0');
  });

  it('refuses a version it cannot parse instead of guessing', () => {
    expect(() => nextVersion('0.1', ['feat: thing'])).toThrow();
    expect(() => nextVersion('v0.1.0', ['feat: thing'])).toThrow();
  });
});
