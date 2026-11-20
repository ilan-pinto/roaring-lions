// The release decision against real git (lead, 19 Nov 2026): the notes being released (data/release-notes/next.json at
// HEAD) and the commits since the last `v*` tag, the stronger wins. The pure rule is pinned in next_version.test.ts;
// this file builds scratch repositories shaped like a promotion and runs the real `decide` (and once the real CLI).
//
// Each scratch repository: package.json at 0.134.0, the release commit tagged v0.134.0, a dev branch whose commits are
// squash titles shaped like ours (`app:`, `data:`, `ci:`, never `feat:`) plus the drafted next.json, and main's merge of
// dev on top: HEAD is the promotion merge, as it is when the version job runs `decide`.
//
// The expected versions are literals, never recomputed through nextVersion.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { decide, NOTES_PATH, readNotes, RELEASE_TAG_MATCH } from '../decide_version.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const DECIDE_CLI = path.join(repoRoot, 'tools/decide_version.mjs');

/** A byte copy of data/release-notes/next.json at main's merge 599d38012 (0 units, 16 rules, 2 fixes), the
 *  promotion the commit rule alone cut as v0.134.1. See fixtures/README.txt. */
const NOTES_599D = readFileSync(path.join(here, 'fixtures/release-notes-599d38012.json'), 'utf8');

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let n = 0;
function commit(dir: string, subject: string, files: Record<string, string> = {}): void {
  const all = { [`f${n++}.txt`]: `${subject}\n`, ...files };
  for (const [file, body] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
    run(dir, 'add', file);
  }
  run(dir, 'commit', '-q', '-m', subject);
}

/** The squash titles of a promotion with no `feat:` anywhere: every one a patch type or none. */
const OUR_TITLES = ['app: the What\'s new panel (PR 1624)', 'data: Qasr Liwan II (PR 1600)', 'ci: dev cancels (PR 1630)'];

/**
 * A promotion: v0.134.0 on main, dev carrying `titles` and (unless `notes` is null) a next.json with `notes`, and
 * main's --no-ff merge of dev as HEAD.
 */
function promotion(notes: string | null, titles: readonly string[] = OUR_TITLES): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'decide-version-'));
  scratch.push(dir);
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.name', 'decide test');
  run(dir, 'config', 'user.email', 'decide@example.invalid');
  run(dir, 'config', 'commit.gpgsign', 'false');
  run(dir, 'config', 'tag.gpgsign', 'false');
  commit(dir, 'chore(release): v0.134.0 [skip ci]', {
    'package.json': '{\n  "name": "scratch",\n  "version": "0.134.0"\n}\n',
    [NOTES_PATH]: '{ "version": "next", "units": [], "rules": [], "fixes": [] }\n',
  });
  run(dir, 'tag', '-a', 'v0.134.0', '-m', 'v0.134.0');
  run(dir, 'checkout', '-q', '-b', 'dev');
  titles.forEach((t, i) => {
    // The notes ride the last dev commit, as the drafting PR does.
    const last = i === titles.length - 1;
    if (last && notes !== null) commit(dir, t, { [NOTES_PATH]: notes });
    else commit(dir, t);
  });
  if (notes === null) {
    run(dir, 'rm', '-q', NOTES_PATH);
    run(dir, 'commit', '-q', '-m', 'docs: no notes file');
  }
  run(dir, 'checkout', '-q', 'main');
  run(dir, 'merge', '-q', '--no-ff', '-m', 'Merge pull request 1634 from dev', 'dev');
  return dir;
}

const notesJson = (units: string[], rules: string[], fixes: string[]): string =>
  `${JSON.stringify({ version: 'next', units, rules, fixes }, null, 2)}\n`;
const EMPTY = notesJson([], [], []);

describe('decide: the notes being released choose the bump', () => {
  it('the 599d38012 notes (16 rules, 2 fixes) cut 0.135.0, where the commits alone cut 0.134.1', () => {
    const fixture = JSON.parse(NOTES_599D) as { units: unknown[]; rules: unknown[]; fixes: unknown[] };
    expect([fixture.units.length, fixture.rules.length, fixture.fixes.length]).toEqual([0, 16, 2]);
    const dir = promotion(NOTES_599D);
    const out = decide(dir);
    expect(out.next).toBe('0.135.0');
    expect(out.line).toContain('notes: 0 units, 16 rules, 2 fixes (minor)');
    expect(out.line).toContain('boundary: tag v0.134.0');
  });

  it('a unit alone cuts a minor', () => {
    expect(decide(promotion(notesJson(['The Namer carrier joins the KDF camp menu.'], [], []))).next).toBe('0.135.0');
  });

  it('a rule alone cuts a minor', () => {
    expect(decide(promotion(notesJson([], ['Smoke now blocks sight for 30 seconds.'], []))).next).toBe('0.135.0');
  });

  it('fixes alone cut a patch', () => {
    const dir = promotion(notesJson([], [], ['Tanks no longer spin on the spot.', 'The pause menu opens again.']));
    expect(decide(dir).next).toBe('0.134.1');
  });

  it('the CLI prints the GITHUB_OUTPUT line, run from the repository as the version job runs it', () => {
    const dir = promotion(NOTES_599D);
    const stdout = execFileSync(process.execPath, [DECIDE_CLI], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(stdout).toBe('next=0.135.0\n');
  });
});

describe('decide: notes that say nothing hand the decision to the commit rule, unchanged', () => {
  it('empty notes over our patch-type titles: 0.134.1, what the commit rule prints', () => {
    const out = decide(promotion(EMPTY));
    expect(out.next).toBe('0.134.1');
    expect(out.line).toContain('notes: 0 units, 0 rules, 0 fixes (none)');
  });

  it('empty notes over docs and ci titles alone: no release, what the commit rule prints', () => {
    expect(decide(promotion(EMPTY, ['docs: a spec', 'ci: a gate', 'tools+ci: a check'])).next).toBeNull();
  });

  it('empty notes over a feat: a minor, what the commit rule prints', () => {
    expect(decide(promotion(EMPTY, ['feat(app): a thing', 'docs: a plan'])).next).toBe('0.135.0');
  });

  it('no notes file at all: the commit rule', () => {
    const dir = promotion(null);
    expect(readNotes(dir)).toBeNull();
    const out = decide(dir);
    expect(out.next).toBe('0.134.1');
    expect(out.line).toContain(`${NOTES_PATH}: none`);
  });

  it('a notes file that is not JSON: the commit rule', () => {
    const dir = promotion('{ "units": [ "half a file');
    expect(readNotes(dir)).toBeNull();
    expect(decide(dir).next).toBe('0.134.1');
  });
});

describe('decide: the stronger signal wins', () => {
  it('a feat commit still cuts a minor over fixes-only notes', () => {
    expect(decide(promotion(notesJson([], [], ['A fix.']), ['feat(app): a thing', 'app: b'])).next).toBe('0.135.0');
  });

  it('fixes-only notes still cut a patch over docs-only commits', () => {
    expect(decide(promotion(notesJson([], [], ['A fix.']), ['docs: a', 'ci: b'])).next).toBe('0.134.1');
  });
});

describe('decide reads the notes AT HEAD, the promotion merge', () => {
  it('a working tree that has already renamed or emptied next.json does not change the answer', () => {
    const dir = promotion(NOTES_599D);
    // What "Write, commit and tag" does next, left uncommitted: the drafted file moved away, a fresh empty one.
    run(dir, 'mv', NOTES_PATH, 'data/release-notes/v0.135.0.json');
    writeFileSync(path.join(dir, NOTES_PATH), EMPTY);
    expect(decide(dir).next).toBe('0.135.0');
  });

  it('and does read HEAD: the same repository with the empty notes committed cuts the commit rule\'s patch', () => {
    const dir = promotion(NOTES_599D);
    writeFileSync(path.join(dir, NOTES_PATH), EMPTY);
    run(dir, 'commit', '-q', '-am', 'docs: emptied');
    expect(decide(dir).next).toBe('0.134.1');
  });

  it('a cut/vX tag on the promoted dev commit is never the boundary (the v* glob is unchanged)', () => {
    expect(RELEASE_TAG_MATCH).toBe('v*');
    const dir = promotion(EMPTY);
    run(dir, 'tag', '-a', 'cut/v0.134.1', '-m', 'cut', 'HEAD^2');
    const out = decide(dir);
    expect(out.line).toContain('boundary: tag v0.134.0');
    expect(out.next).toBe('0.134.1');
  });
});

describe('ci.yml: decide runs before next.json is renamed', () => {
  it('in the version job, the decide step comes before the step that moves next.json', () => {
    const yml = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const job = yml.slice(yml.indexOf('\n  version:\n'));
    expect(job.length).toBeLessThan(yml.length);
    const decideAt = job.indexOf('run: node tools/decide_version.mjs >> "$GITHUB_OUTPUT"');
    const moveAt = job.indexOf('git mv data/release-notes/next.json');
    expect(decideAt).toBeGreaterThan(0);
    expect(moveAt).toBeGreaterThan(0);
    expect(decideAt).toBeLessThan(moveAt);
    // Nothing between the checkout and decide writes next.json.
    expect(job.slice(0, decideAt)).not.toMatch(/release-notes\/next\.json|release-notes-md\.mjs/);
  });
});
