// The branch-cut tag (lead, 19 Nov 2026): every promotion tags the promoted dev commit `cut/vX.Y.Z`.
//
// (a) the name, on literals; (b) that decide_version's REAL last-release lookup (`lastTag`, `git describe --match v*`)
// never returns a cut tag, in a scratch repository; (c) the tagger's create and skip paths, in a scratch repository
// with a bare `origin`, and once with an injected runner that records every git call.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cutTag, cutTagName, gitIn, warning, type GitResult } from '../../ci/cut-tag.mjs';
import { lastTag } from '../../decide_version.mjs';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A fresh repository on `main` with a local identity and no signing, so the developer's own config cannot leak in. */
function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cut-tag-'));
  scratch.push(dir);
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.name', 'cut-tag test');
  run(dir, 'config', 'user.email', 'cut-tag@example.invalid');
  run(dir, 'config', 'commit.gpgsign', 'false');
  run(dir, 'config', 'tag.gpgsign', 'false');
  run(dir, 'config', 'push.negotiate', 'false');
  return dir;
}

let n = 0;
function commit(dir: string, subject: string): string {
  // A file per commit, so a merge of two lines of work never conflicts.
  const file = `f${n++}.txt`;
  writeFileSync(path.join(dir, file), `${subject}\n`);
  run(dir, 'add', file);
  run(dir, 'commit', '-q', '-m', subject);
  return run(dir, 'rev-parse', 'HEAD');
}

/** `git describe --match v*` reads a pattern as a wildmatch glob with no special meaning for `/`: `*` matches any
 *  rest, slashes included, and the literal `v` must be the first character. So a name matches `v*` exactly when it
 *  starts with `v`. The scratch-repo cases below put the same question to git's own matcher. */
const matchesVStar = (name: string): boolean => name.startsWith('v');

describe('cutTagName (a)', () => {
  it('names the cut after the release', () => {
    expect(cutTagName('v0.135.0')).toBe('cut/v0.135.0');
    expect(cutTagName('v1.0.0')).toBe('cut/v1.0.0');
    expect(cutTagName('v0.133.13')).toBe('cut/v0.133.13');
  });

  it('never produces a name the release glob v* matches', () => {
    for (const r of ['v0.135.0', 'v0.1.0', 'v1.0.0', 'v10.20.30']) expect(matchesVStar(cutTagName(r))).toBe(false);
    // The matcher itself can say yes: a release tag, and the falsification's mutant name.
    expect(matchesVStar('v0.135.0')).toBe(true);
    expect(matchesVStar('v-cut/v0.135.0')).toBe(true);
  });

  it('refuses anything that is not a vX.Y.Z release tag', () => {
    for (const bad of ['0.135.0', 'v1.2', 'cut/v0.1.0', 'v01.2.3', '', 'v0.135.0-rc1']) {
      expect(() => cutTagName(bad)).toThrow(/is not a vX\.Y\.Z release tag/);
    }
  });
});

describe("decide_version's last-release lookup ignores cut tags (b)", () => {
  it('returns v0.1.0 on the older commit, not the cut tag on the newer one', () => {
    const dir = repo();
    commit(dir, 'feat: first');
    run(dir, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
    commit(dir, 'fix: second');
    commit(dir, 'fix: third');
    run(dir, 'tag', '-a', cutTagName('v0.2.0'), '-m', 'cut');
    expect(run(dir, 'tag', '-l')).toContain('cut/v0.2.0');
    expect(lastTag(dir)).toBe('v0.1.0');
  });

  it('a repository whose only tag is a cut tag has no last release at all', () => {
    const dir = repo();
    commit(dir, 'feat: only');
    run(dir, 'tag', '-a', cutTagName('v0.2.0'), '-m', 'cut');
    expect(lastTag(dir)).toBeNull();
  });

  it('and the lookup does read a v* tag that is newer (the scratch repo is not blind)', () => {
    const dir = repo();
    commit(dir, 'feat: first');
    run(dir, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
    commit(dir, 'fix: second');
    run(dir, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
    expect(lastTag(dir)).toBe('v0.2.0');
  });
});

/** main (c0) -> release commit r1; dev (c0 -> d1 -> d2); main merges dev with a merge commit M; the job then commits a
 *  release bump on top of M. A bare `origin` holds it all. */
function promotion(): { work: string; origin: string; c0: string; d2: string; merge: string; bump: string } {
  const origin = mkdtempSync(path.join(os.tmpdir(), 'cut-tag-origin-'));
  scratch.push(origin);
  run(origin, 'init', '-q', '--bare', '-b', 'main');
  const work = repo();
  run(work, 'remote', 'add', 'origin', origin);
  const c0 = commit(work, 'feat: base');
  run(work, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  run(work, 'checkout', '-q', '-b', 'dev');
  commit(work, 'fix: on dev');
  const d2 = commit(work, 'feat: more on dev');
  run(work, 'checkout', '-q', 'main');
  commit(work, 'chore(release): v0.1.1 [skip ci]');
  run(work, 'merge', '-q', '--no-ff', '-m', 'Merge pull request from dev', 'dev');
  const merge = run(work, 'rev-parse', 'HEAD');
  const bump = commit(work, 'chore(release): v0.2.0 [skip ci]');
  run(work, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
  run(work, 'push', '-q', 'origin', 'main', 'dev', '--tags');
  return { work, origin, c0, d2, merge, bump };
}

const vTags = (dir: string): string => run(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags/v*');
const peeled = (dir: string, tag: string): string => run(dir, 'rev-parse', `refs/tags/${tag}^{commit}`);
const hasTag = (dir: string, tag: string): boolean => run(dir, 'tag', '-l', tag) === tag;
const short = (sha: string): string => sha.slice(0, 9);

describe('warning', () => {
  it('is a GitHub Actions ::warning:: workflow command, escaped', () => {
    expect(warning('cut/v0.2.0 exists here on abc, not on the promoted def; left alone'))
      .toBe('::warning::cut/v0.2.0 exists here on abc, not on the promoted def; left alone');
    expect(warning('100%\nnext')).toBe('::warning::100%25%0Anext');
  });
});

describe('cutTag (c)', () => {
  it('tags the merge commit\'s SECOND parent, annotated, and pushes it; no v* tag moves', () => {
    const p = promotion();
    const before = vTags(p.origin);
    const lines: string[] = [];
    const out = cutTag({
      release: 'v0.2.0', merge: p.merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work), log: (l) => lines.push(l),
    });
    expect(out).toEqual({ action: 'created', name: 'cut/v0.2.0', target: p.d2 });
    expect(run(p.work, 'cat-file', '-t', 'refs/tags/cut/v0.2.0')).toBe('tag');
    expect(peeled(p.origin, 'cut/v0.2.0')).toBe(p.d2);
    expect(vTags(p.origin)).toBe(before);
    expect(lastTag(p.work)).toBe('v0.2.0');
    expect(lines.join('\n')).toMatch(/created cut\/v0\.2\.0/);
  });

  it('a create raises no warning annotation', () => {
    const p = promotion();
    const notes: string[] = [];
    cutTag({ release: 'v0.2.0', merge: p.merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work),
      annotate: (l) => notes.push(l) });
    expect(notes).toEqual([]);
  });

  it('skips with a log line when the commit has no second parent (the release bump on top of the merge)', () => {
    const p = promotion();
    const lines: string[] = [];
    const notes: string[] = [];
    const out = cutTag({
      release: 'v0.2.0', merge: p.bump, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work), log: (l) => lines.push(l),
      annotate: (l) => notes.push(l),
    });
    expect(out).toMatchObject({ action: 'skipped', reason: 'no-second-parent' });
    expect(lines.join('\n')).toMatch(/skipped, .* has no second parent/);
    expect(notes).toEqual([
      `::warning::${short(p.bump)} has no second parent: not a promotion merge, so no cut/v0.2.0`,
    ]);
    expect(hasTag(p.work, 'cut/v0.2.0')).toBe(false);
    expect(hasTag(p.origin, 'cut/v0.2.0')).toBe(false);
  });

  it('skips when the second parent is not on dev', () => {
    const p = promotion();
    run(p.work, 'checkout', '-q', '-b', 'side', p.c0);
    commit(p.work, 'fix: off dev');
    run(p.work, 'checkout', '-q', 'main');
    run(p.work, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    const merge = run(p.work, 'rev-parse', 'HEAD');
    const side = run(p.work, 'rev-parse', 'side');
    const lines: string[] = [];
    const notes: string[] = [];
    const out = cutTag({
      release: 'v0.2.0', merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work),
      log: (l) => lines.push(l), annotate: (l) => notes.push(l),
    });
    expect(out).toMatchObject({ action: 'skipped', reason: 'not-on-dev' });
    const detail = `${short(side)} (second parent of ${short(merge)}) is not on origin/dev: no cut/v0.2.0`;
    expect(lines).toEqual([`cut-tag: skipped, ${detail}`]);
    expect(notes).toEqual([`::warning::${detail}`]);
    expect(hasTag(p.origin, 'cut/v0.2.0')).toBe(false);
  });

  it('leaves a hand-made tag alone when it exists here, even on another commit', () => {
    const p = promotion();
    run(p.work, 'tag', '-a', 'cut/v0.2.0', '-m', 'by hand', p.c0);
    run(p.work, 'push', '-q', 'origin', 'refs/tags/cut/v0.2.0');
    const lines: string[] = [];
    const notes: string[] = [];
    const out = cutTag({
      release: 'v0.2.0', merge: p.merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work), log: (l) => lines.push(l),
      annotate: (l) => notes.push(l),
    });
    expect(out).toMatchObject({ action: 'skipped', reason: 'exists' });
    // The mismatch is named: the hand-made tag is on c0, the promoted commit is d2.
    const detail = `cut/v0.2.0 exists here on ${short(p.c0)}, not on the promoted ${short(p.d2)}; left alone (never moved)`;
    expect(lines).toEqual([`cut-tag: skipped, ${detail}`]);
    expect(notes).toEqual([`::warning::${detail}`]);
    expect(peeled(p.work, 'cut/v0.2.0')).toBe(p.c0);
    expect(peeled(p.origin, 'cut/v0.2.0')).toBe(p.c0);
  });

  it('leaves it alone when it exists only on the remote', () => {
    const p = promotion();
    run(p.work, 'tag', '-a', 'cut/v0.2.0', '-m', 'by hand', p.c0);
    run(p.work, 'push', '-q', 'origin', 'refs/tags/cut/v0.2.0');
    run(p.work, 'tag', '-d', 'cut/v0.2.0');
    const notes: string[] = [];
    const out = cutTag({ release: 'v0.2.0', merge: p.merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work),
      annotate: (l) => notes.push(l) });
    expect(out).toMatchObject({ action: 'skipped', reason: 'exists' });
    // The remote tag is annotated: its peeled commit (ls-remote's ^{} line) is c0, not the tag object.
    expect(notes).toEqual([
      `::warning::cut/v0.2.0 exists on origin on ${short(p.c0)}, not on the promoted ${short(p.d2)}; left alone (never moved)`,
    ]);
    expect(hasTag(p.work, 'cut/v0.2.0')).toBe(false);
    expect(peeled(p.origin, 'cut/v0.2.0')).toBe(p.c0);
  });

  it('an existing tag already on the promoted commit warns that it is skipped, without a mismatch', () => {
    const p = promotion();
    run(p.work, 'tag', '-a', 'cut/v0.2.0', '-m', 'by hand', p.d2);
    run(p.work, 'push', '-q', 'origin', 'refs/tags/cut/v0.2.0');
    const notes: string[] = [];
    const out = cutTag({ release: 'v0.2.0', merge: p.merge, dev: 'origin/dev', remote: 'origin', git: gitIn(p.work),
      annotate: (l) => notes.push(l) });
    expect(out).toMatchObject({ action: 'skipped', reason: 'exists' });
    expect(notes).toEqual([
      `::warning::cut/v0.2.0 already exists here on ${short(p.d2)}, the promoted commit; left as it is (never moved)`,
    ]);
    expect(notes.join('\n')).not.toMatch(/not on the promoted/);
  });

  it('with an injected runner: a skip writes nothing, and a create never forces, deletes or names a v* tag', () => {
    const ok = (stdout = ''): GitResult => ({ status: 0, stdout, stderr: '' });
    const fail: GitResult = { status: 1, stdout: '', stderr: '' };
    const record = (exists: boolean, second: string | null) => {
      const calls: string[][] = [];
      const git = (args: string[]): GitResult => {
        calls.push(args);
        if (args[0] === 'rev-parse' && args.includes('M^{commit}')) return ok('m'.repeat(40));
        if (args[0] === 'rev-parse' && args.some((a) => a.endsWith('^2^{commit}'))) return second ? ok(second) : fail;
        if (args[0] === 'rev-parse' && args.some((a) => a.startsWith('refs/tags/'))) return exists ? ok('t') : fail;
        return ok();
      };
      return { calls, git };
    };
    const writes = (calls: string[][]) => calls.filter((c) => c[0] === 'tag' || c[0] === 'push');

    const none = record(false, null);
    expect(cutTag({ release: 'v0.135.0', merge: 'M', remote: 'origin', git: none.git }).action).toBe('skipped');
    expect(writes(none.calls)).toEqual([]);

    const there = record(true, 'd'.repeat(40));
    expect(cutTag({ release: 'v0.135.0', merge: 'M', remote: 'origin', git: there.git }).action).toBe('skipped');
    expect(writes(there.calls)).toEqual([]);

    const fresh = record(false, 'd'.repeat(40));
    expect(cutTag({ release: 'v0.135.0', merge: 'M', remote: 'origin', git: fresh.git }).action).toBe('created');
    const w = writes(fresh.calls);
    expect(w.map((c) => c[0])).toEqual(['tag', 'push']);
    for (const c of w) {
      for (const flag of ['-f', '--force', '-d', '--delete', '--mirror', '--tags']) expect(c).not.toContain(flag);
      expect(c.some((a) => a.replace(/^refs\/tags\//, '').startsWith('v'))).toBe(false);
    }
    expect(w[0]).toContain('cut/v0.135.0');
    expect(w[1]).toEqual(['push', 'origin', 'refs/tags/cut/v0.135.0']);
  });
});
