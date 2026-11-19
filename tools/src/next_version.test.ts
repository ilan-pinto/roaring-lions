// The release rule, as assertions.
//
// A version derived from commit subjects is only as good as the parsing, and
// the case that matters most is the one that does NOTHING: this repo lands
// documentation-only merges regularly, and a bump there would cut a tag
// marking no change to the game.
import { describe, expect, it } from 'vitest';
import { BUMP_BY_TYPE, bumpOf, commitType, nextVersion, notesBump } from '../next_version.mjs';

describe('commitType', () => {
  it('reads a bare prefix and a scoped one', () => {
    expect(commitType('feat: thing')).toBe('feat');
    expect(commitType('fix(sim): thing')).toBe('fix');
  });

  it('reads a breaking-change marker without losing the type', () => {
    expect(commitType('feat(app)!: thing')).toBe('feat');
  });

  it('reads a combined type whole', () => {
    expect(commitType('tools+ci: three-engine check')).toBe('tools+ci');
    expect(commitType('net+app(room)!: thing')).toBe('net+app');
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

  const PATCH_TYPES = [
    'fix', 'sim', 'app', 'ui', 'render', 'net', 'worker', 'polish', 'art', 'data',
    'content', 'balance', 'vfx', 'audio', 'perf', 'revert',
  ];
  const NO_BUMP_TYPES = [
    'docs', 'design', 'chore', 'test', 'refactor', 'tools', 'ci', 'build', 'wip',
    'fixup', 'spike', 'measure',
  ];

  it.each(PATCH_TYPES)('bumps the patch for %s, bare and scoped', (type) => {
    expect(nextVersion('0.123.2', [`${type}: thing`])).toBe('0.123.3');
    expect(nextVersion('0.123.2', [`${type}(scope): thing`])).toBe('0.123.3');
  });

  it.each(NO_BUMP_TYPES)('does nothing for %s alone', (type) => {
    expect(nextVersion('0.123.2', [`${type}: thing`])).toBeNull();
    expect(nextVersion('0.123.2', [`${type}(scope)!: thing`])).toBeNull();
  });

  it('classifies every type in the table, and the lists above are the table', () => {
    // A type added to the table without a test line here is a type nobody
    // watched go red.
    const listed = [...PATCH_TYPES, ...NO_BUMP_TYPES, 'feat'].sort();
    expect(Object.keys(BUMP_BY_TYPE).sort()).toEqual(listed);
  });

  it('bumps a combined type if any part bumps', () => {
    expect(nextVersion('0.1.4', ['net+app: thing'])).toBe('0.1.5');
    expect(nextVersion('0.1.4', ['app+worker: thing'])).toBe('0.1.5');
    expect(nextVersion('0.1.4', ['tools+feat: thing'])).toBe('0.2.0');
    expect(nextVersion('0.1.4', ['docs+art: thing'])).toBe('0.1.5');
  });

  it('does nothing for a combined type with no bumping part', () => {
    expect(nextVersion('0.1.4', ['tools+ci: three-engine check'])).toBeNull();
    expect(nextVersion('0.1.4', ['docs+capture: thing'])).toBeNull();
  });

  it('does nothing for a type the table does not name', () => {
    expect(bumpOf('wibble')).toBe('none');
    expect(bumpOf('constructor')).toBe('none');
    expect(nextVersion('0.1.4', ['wibble: thing', 'toString: thing'])).toBeNull();
  });

  it('keeps a breaking marker from changing the bump', () => {
    expect(nextVersion('0.1.4', ['net!: thing'])).toBe('0.1.5');
    expect(nextVersion('0.1.4', ['feat(app)!: thing'])).toBe('0.2.0');
    expect(nextVersion('0.1.4', ['docs!: thing'])).toBeNull();
  });

  it('lets a feat outrank a patch type', () => {
    expect(nextVersion('0.1.0', ['net: a', 'polish: b', 'feat: c'])).toBe('0.2.0');
  });

  it('does NOTHING for docs, test and refactor alone', () => {
    // The case this rule exists for. A spec, a plan and a ledger correction
    // are a normal merge here and they change nothing a player can see.
    expect(nextVersion('0.1.0', ['docs(spec): thing', 'test(tools): thing', 'refactor(sim): thing']))
      .toBeNull();
    expect(nextVersion('0.1.0', ['chore: a', 'ci: b', 'tools+ci: c'])).toBeNull();
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

// The release notes being released (lead, 19 Nov 2026). Real-shaped: data/schemas/release_notes.schema.json.
const notes = (units: string[], rules: string[], fixes: string[]) => ({ version: 'next', units, rules, fixes });
const EMPTY_NOTES = notes([], [], []);

describe('notesBump', () => {
  it('a unit or a rule is a minor', () => {
    expect(notesBump(notes(['A new carrier.'], [], []))).toBe('minor');
    expect(notesBump(notes([], ['A new rule.'], []))).toBe('minor');
    expect(notesBump(notes(['A unit.'], ['A rule.'], ['A fix.']))).toBe('minor');
  });

  it('fixes alone are a patch', () => {
    expect(notesBump(notes([], [], ['A fix.', 'Another fix.']))).toBe('patch');
  });

  it('empty, missing or malformed notes are none, so the commits decide', () => {
    expect(notesBump(EMPTY_NOTES)).toBe('none');
    expect(notesBump(null)).toBe('none');
    expect(notesBump(undefined)).toBe('none');
    expect(notesBump('rules')).toBe('none');
    expect(notesBump([['a rule']])).toBe('none');
    // A section that is not an array is read as empty, never as a bump.
    expect(notesBump({ version: 'next', units: 'one', rules: { a: 1 }, fixes: 3 })).toBe('none');
    expect(notesBump({ version: 'next', units: [], rules: 'one', fixes: ['A fix.'] })).toBe('patch');
  });
});

describe('nextVersion with notes: the stronger of the notes and the commits', () => {
  // Our squash titles: never feat, so the commit rule alone is a patch.
  const OURS = ['app: a panel', 'data: a mission', 'ci: a gate'];

  it('rules over our titles cut a minor (the 599d38012 promotion: 0 units, 16 rules, 2 fixes)', () => {
    const rules = Array.from({ length: 16 }, (_, i) => `Rule ${i + 1}.`);
    expect(nextVersion('0.134.0', OURS, notes([], rules, ['Fix 1.', 'Fix 2.']))).toBe('0.135.0');
  });

  it('fixes alone over our titles cut a patch', () => {
    expect(nextVersion('0.134.0', OURS, notes([], [], ['A fix.']))).toBe('0.134.1');
  });

  it('notes that say nothing leave the commit rule exactly as it was', () => {
    for (const n of [EMPTY_NOTES, null, undefined]) {
      expect(nextVersion('0.134.0', OURS, n)).toBe('0.134.1');
      expect(nextVersion('0.134.0', ['docs: a', 'ci: b'], n)).toBeNull();
      expect(nextVersion('0.134.0', ['feat: a'], n)).toBe('0.135.0');
      expect(nextVersion('0.134.0', [], n)).toBeNull();
    }
    expect(nextVersion('0.134.0', OURS)).toBe('0.134.1');
  });

  it('a feat commit still cuts a minor over fixes-only notes', () => {
    expect(nextVersion('0.134.0', ['feat(app): a thing'], notes([], [], ['A fix.']))).toBe('0.135.0');
  });

  it('notes alone release: rules over docs-only commits cut a minor, fixes a patch', () => {
    expect(nextVersion('0.134.0', ['docs: a'], notes([], ['A rule.'], []))).toBe('0.135.0');
    expect(nextVersion('0.134.0', [], notes([], [], ['A fix.']))).toBe('0.134.1');
  });

  it('nothing cuts a major: not the notes, not a breaking marker', () => {
    expect(nextVersion('0.134.0', ['feat(app)!: breaking'], notes(['A unit.'], ['A rule.'], []))).toBe('0.135.0');
    expect(nextVersion('1.9.3', [], notes(['A unit.'], [], []))).toBe('1.10.0');
  });
});
