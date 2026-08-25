// Reads the repo, applies the rule, and prints a GITHUB_OUTPUT line.
//
// Split from next_version.mjs on purpose: that file is pure and tested, this
// one is the part that touches git and the filesystem and cannot be. Keeping
// the rule out of here is what lets the rule have tests at all.
//
// Prints `next=<version>` when a release is warranted and `next=` when it is
// not. The workflow gates every subsequent step on that being non-empty, so
// "no release" is a normal outcome rather than a failure.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { nextVersion } from './next_version.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** The most recent release tag, or null on a repo that has never cut one.
 *
 *  git writes "No names found" to stderr in that case, which reads as an
 *  error in a run log when it is the ordinary first-run state — so the child's
 *  stderr is dropped and the absence is reported by the caller instead. */
function lastTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
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
function lastReleaseCommit() {
  try {
    const sha = execFileSync(
      'git',
      ['log', '-1', '--format=%H', '--grep', '^chore(release): v'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return sha || null;
  } catch {
    return null;
  }
}

const tag = lastTag();
const boundary = tag ?? lastReleaseCommit();
// With neither a tag nor a release commit the range is the whole history —
// which is correct exactly once, on a repo that has never cut a release.
const range = boundary ? `${boundary}..HEAD` : 'HEAD';
const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const next = nextVersion(current, subjects);

// Stderr so it lands in the run log without polluting GITHUB_OUTPUT.
console.error(
  `boundary: ${tag ? `tag ${tag}` : boundary ? `release commit ${boundary.slice(0, 7)}` : '(whole history)'}` +
    ` · commits in range: ${subjects.length} · current: ${current} · next: ${next ?? '(no release)'}`
);

process.stdout.write(`next=${next ?? ''}\n`);
