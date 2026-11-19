// The branch-cut tag (lead, 19 Nov 2026): every promotion tags the dev commit it promoted as `cut/vX.Y.Z`.
//
// The `version` job in .github/workflows/ci.yml runs it after it has cut and published vX.Y.Z:
//
//   node tools/ci/cut-tag.mjs --release=v<X.Y.Z> --merge=<the pushed merge commit, $GITHUB_SHA> [--dev=origin/dev]
//                             [--remote=origin]
//
// The promotion merge's SECOND parent is the dev commit that was promoted (main is the first). The tag goes there,
// annotated, and is pushed by name. It is skipped, with a log line and exit 0, when:
//   - the pushed commit has no second parent (not a merge, so not a promotion);
//   - the second parent is not on `--dev` (a merge from some other branch is not a dev cut);
//   - `cut/vX.Y.Z` already exists, here or on the remote (the PM's hand-made one for v0.135.0): never moved, never
//     deleted, never forced.
//
// The name never matches `v*`, the glob tools/decide_version.mjs hands `git describe --match` to find the last
// RELEASE: a cut tag on a newer commit than vX would otherwise be read as the last release. This module never
// creates, moves or deletes a `v*` tag. Pinned, with a scratch repository, in tools/src/ci/cut-tag.test.ts.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Every cut tag starts with this. NOT `v`: see the header. */
export const CUT_PREFIX = 'cut/';

const RELEASE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * `v0.135.0` -> `cut/v0.135.0`. Throws on anything that is not a `vX.Y.Z` release tag.
 *
 * @param {string} release
 * @returns {string}
 */
export function cutTagName(release) {
  if (!RELEASE.test(release)) throw new Error(`cut-tag: "${release}" is not a vX.Y.Z release tag`);
  return `${CUT_PREFIX}${release}`;
}

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} GitResult
 * @typedef {(args: string[]) => GitResult} GitRunner
 * @typedef {{ action: 'created', name: string, target: string }
 *   | { action: 'skipped', reason: 'no-second-parent' | 'not-on-dev' | 'exists', name: string, detail: string }} Outcome
 */

/**
 * A git runner over `spawnSync`, in `cwd`. It never throws on a non-zero exit: the caller reads `status`.
 *
 * @param {string} [cwd]
 * @returns {GitRunner}
 */
export function gitIn(cwd = process.cwd()) {
  return (args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.error) throw r.error;
    return { status: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
  };
}

/**
 * Tag the promoted dev commit (`merge^2`) as `cut/<release>` and push it by name, or say why not.
 *
 * @param {{ release: string, merge: string, git: GitRunner, dev?: string | null, remote?: string | null,
 *   log?: (line: string) => void }} opts
 * @returns {Outcome}
 */
export function cutTag({ release, merge, git, dev = null, remote = null, log = () => {} }) {
  const name = cutTagName(release);
  /** @param {string[]} args */
  const must = (args) => {
    const r = git(args);
    if (r.status !== 0) throw new Error(`cut-tag: git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
    return r.stdout;
  };

  const mergeSha = must(['rev-parse', '--verify', `${merge}^{commit}`]);
  const second = git(['rev-parse', '--verify', '--quiet', `${mergeSha}^2^{commit}`]);
  if (second.status !== 0 || !second.stdout) {
    const detail = `${mergeSha.slice(0, 9)} has no second parent: not a promotion merge, so no ${name}`;
    log(`cut-tag: skipped, ${detail}`);
    return { action: 'skipped', reason: 'no-second-parent', name, detail };
  }
  const target = second.stdout;

  if (dev) {
    const onDev = git(['merge-base', '--is-ancestor', target, dev]);
    if (onDev.status !== 0) {
      const detail = `${target.slice(0, 9)} (second parent of ${mergeSha.slice(0, 9)}) is not on ${dev}: no ${name}`;
      log(`cut-tag: skipped, ${detail}`);
      return { action: 'skipped', reason: 'not-on-dev', name, detail };
    }
  }

  const local = git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}`]);
  const remoteRef = remote ? must(['ls-remote', '--tags', remote, `refs/tags/${name}`]) : '';
  if (local.status === 0 || remoteRef) {
    const where = local.status === 0 ? 'here' : `on ${remote}`;
    const detail = `${name} already exists ${where}; left as it is (never moved)`;
    log(`cut-tag: skipped, ${detail}`);
    return { action: 'skipped', reason: 'exists', name, detail };
  }

  const message =
    `Branch cut for ${release}: the dev commit promoted to main by merge ${mergeSha.slice(0, 9)}. ` +
    'Tagged by the ci workflow\'s version job.';
  must(['tag', '-a', name, '-m', message, target]);
  if (remote) must(['push', remote, `refs/tags/${name}`]);
  log(`cut-tag: created ${name} on ${target.slice(0, 9)} (second parent of ${mergeSha.slice(0, 9)})` +
    (remote ? `, pushed to ${remote}` : ''));
  return { action: 'created', name, target };
}

/** @param {string[]} argv */
function main(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) throw new Error(`cut-tag: unknown argument ${a}`);
    args[m[1]] = m[2];
  }
  if (!args.release || !args.merge) throw new Error('cut-tag: --release=v<X.Y.Z> and --merge=<sha> are required');
  cutTag({
    release: args.release,
    merge: args.merge,
    dev: args.dev || null,
    remote: args.remote ?? 'origin',
    git: gitIn(),
    log: (line) => console.error(line),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
