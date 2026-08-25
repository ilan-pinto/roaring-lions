// The next version, from the commits since the last release tag.
//
// Every commit in this repo carries a conventional prefix -- feat, fix, docs,
// test, refactor -- so the version can be derived rather than remembered. The
// rule is deliberately coarse:
//
//   any feat   -> minor
//   else any fix -> patch
//   otherwise  -> nothing
//
// That last line is the one worth keeping. Documentation-only merges are
// common here (a spec, a plan, a ledger correction), and they must not churn
// the version or cut a tag that marks no change to the game.
//
// Only major.minor reaches the player: packages/app/vite.config.ts truncates
// the patch before handing it to the menu and the HUD. So a fix-only merge
// moves the recorded version and not the displayed one, on purpose -- the
// patch is bookkeeping for whoever is reading tags later.
//
// Pure and sink-free: it takes the current version and the commit subjects,
// and returns a string or null. The workflow does the git work; a test can
// describe a release without one.

/** `feat(app): thing` -> `feat`; `fix!: thing` -> `fix`. Anything without a
 *  recognisable prefix contributes nothing rather than defaulting to a bump —
 *  an unparseable subject is not evidence of a change worth releasing. */
export function commitType(subject) {
  const m = /^([a-z]+)(\([^)]*\))?!?:/.exec(subject.trim());
  return m ? m[1] : null;
}

/**
 * The next version, or null when nothing in these commits warrants one.
 *
 * `current` is the version in package.json; `subjects` are the commit
 * subject lines since the last tag, newest or oldest first — order does not
 * matter, because the rule is "does any commit do X", not "what did the last
 * commit do".
 */
export function nextVersion(current, subjects) {
  const parts = current.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`unparseable current version: ${current}`);
  }
  const [major, minor, patch] = parts;
  const types = subjects.map(commitType).filter((t) => t !== null);
  if (types.includes('feat')) return `${major}.${minor + 1}.0`;
  if (types.includes('fix')) return `${major}.${minor}.${patch + 1}`;
  return null;
}
