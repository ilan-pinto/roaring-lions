// Reads the repo, applies the rule, and prints a GITHUB_OUTPUT line.
//
// Split from next_version.mjs on purpose: that file is pure and tested, this
// one is the part that touches git and the filesystem and cannot be. Keeping
// the rule out of here is what lets the rule have tests at all.
//
// Prints `next=<version>` when a release is warranted and `next=` when it is
// not. The workflow gates every subsequent step on that being non-empty, so
// "no release" is a normal outcome rather than a failure.
//
// It reads two things at HEAD: the commit subjects since the last release, and
// the release notes being released, data/release-notes/next.json (the rule:
// next_version.mjs). In the version job HEAD is the pushed promotion merge,
// and this runs BEFORE "Write, commit and tag" renames next.json to
// v<X.Y.Z>.json, so it reads the drafted notes. They are read from the commit
// (`git show HEAD:<path>`), not the working tree, so nothing a step does to the
// checkout can change the answer. Pinned against scratch repositories in
// tools/src/decide_version.test.ts.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { notesBump, nextVersion } from './next_version.mjs';

/** The drafted notes of the release being cut, relative to the repository root (GH-1622). */
export const NOTES_PATH = 'data/release-notes/next.json';

/** The glob a release tag matches (`git describe --match`). A tag outside it, such as a branch-cut tag
 *  `cut/vX.Y.Z` (tools/ci/cut-tag.mjs), is never read as a release. */
export const RELEASE_TAG_MATCH = 'v*';

/** The most recent release tag, or null on a repo that has never cut one.
 *
 *  git writes "No names found" to stderr in that case, which reads as an
 *  error in a run log when it is the ordinary first-run state — so the child's
 *  stderr is dropped and the absence is reported by the caller instead. */
export function lastTag(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', RELEASE_TAG_MATCH], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The last release commit, as a fallback boundary when no tag is reachable.
 *
 * The first live run of this job pushed the bump commit and silently dropped
 * the tag — `--follow-tags` ignores lightweight tags. That left the repo in a
 * state where "commits since the last tag" meant the whole history, so every
 * subsequent merge would rescan it, find a feat, and bump the minor again.
 *
 * The bump commit is a boundary the job creates itself and cannot lose, so
 * reading it makes the rule self-healing: a tag push that fails costs a tag,
 * not a runaway version. The tag is still preferred when present.
 */
function lastReleaseCommit(cwd) {
  try {
    const sha = execFileSync(
      'git',
      ['log', '-1', '--format=%H', '--grep', '^chore(release): v'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * The release notes at `rev` (`NOTES_PATH`), parsed, or null when the commit has no such file or it is not JSON.
 * Null hands the decision to the commit rule. Read from the commit, never the working tree.
 *
 * @param {string} [cwd]
 * @param {string} [rev]
 * @returns {unknown}
 */
export function readNotes(cwd = process.cwd(), rev = 'HEAD') {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${rev}:${NOTES_PATH}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {unknown} notes */
function describeNotes(notes) {
  if (notes === null) return `${NOTES_PATH}: none`;
  /** @param {string} key */
  const n = (key) => {
    const v = notes && typeof notes === 'object' ? /** @type {Record<string, unknown>} */ (notes)[key] : undefined;
    return Array.isArray(v) ? v.length : 0;
  };
  return `notes: ${n('units')} units, ${n('rules')} rules, ${n('fixes')} fixes (${notesBump(notes)})`;
}

/**
 * The decision for the repository in `cwd` at its HEAD: `next` (a version, or null for no release) and the run-log
 * line saying why.
 *
 * @param {string} [cwd]
 * @returns {{ next: string | null, line: string }}
 */
export function decide(cwd = process.cwd()) {
  const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const tag = lastTag(cwd);
  const boundary = tag ?? lastReleaseCommit(cwd);
  // With neither a tag nor a release commit the range is the whole history —
  // which is correct exactly once, on a repo that has never cut a release.
  const range = boundary ? `${boundary}..HEAD` : 'HEAD';
  const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);
  const notes = readNotes(cwd, 'HEAD');

  const current = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).version;
  const next = nextVersion(current, subjects, notes);

  const line =
    `boundary: ${tag ? `tag ${tag}` : boundary ? `release commit ${boundary.slice(0, 7)}` : '(whole history)'}` +
    ` · commits in range: ${subjects.length} · ${describeNotes(notes)}` +
    ` · current: ${current} · next: ${next ?? '(no release)'}`;
  return { next, line };
}

function main() {
  const { next, line } = decide();
  // Stderr so it lands in the run log without polluting GITHUB_OUTPUT.
  console.error(line);
  process.stdout.write(`next=${next ?? ''}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
