// The next version, from the commits since the last release tag.
//
// Every commit in this repo carries a conventional prefix, so the version can
// be derived rather than remembered. The rule is a table (BUMP_BY_TYPE below),
// read as:
//
//   any feat                       -> minor
//   else any player-facing type    -> patch
//   otherwise                      -> nothing
//
// The first version of this rule knew only feat and fix. Nearly every PR here
// is titled net:, worker:, polish:, art:, data:, vfx: and so on, so about fifty
// shipped commits (11-12 Oct 2026, v0.123.2 on) produced no release at all.
// The table lists every type the history actually uses (git log over all
// non-merge subjects), each classified explicitly.
//
// Nothing-to-release is still the case worth keeping. Documentation-only
// merges are common here (a spec, a plan, a ledger correction), and so are
// tooling and CI changes: they must not churn the version or cut a tag that
// marks no change to the game.
//
// A combined type, `tools+ci:` or `net+app:`, is each part in turn, and it
// bumps if any part does. A type the table does not name contributes nothing,
// like an unparseable subject: an unknown word is not evidence of a change.
//
// Only major.minor reaches the player: packages/app/vite.config.ts truncates
// the patch before handing it to the menu and the HUD. So a patch bump moves
// the recorded version and not the displayed one, on purpose -- the patch is
// bookkeeping for whoever is reading tags later.
//
// Pure and sink-free: it takes the current version and the commit subjects,
// and returns a string or null. The workflow does the git work; a test can
// describe a release without one.

/** What each commit type does to the version. `minor`, `patch` or `none`.
 *  Classified from the types in use across the whole history. */
export const BUMP_BY_TYPE = Object.freeze({
  // New capability a player can see.
  feat: 'minor',
  // Player-facing: the game, its content, its look and sound, its network,
  // its server, its speed.
  fix: 'patch',
  sim: 'patch',
  app: 'patch',
  ui: 'patch',
  render: 'patch',
  net: 'patch',
  worker: 'patch',
  polish: 'patch',
  art: 'patch',
  data: 'patch',
  content: 'patch',
  balance: 'patch',
  vfx: 'patch',
  audio: 'patch',
  perf: 'patch',
  // A revert undoes a shipped change, which is itself a change to the game.
  revert: 'patch',
  // Nothing a player can see: documents, mocks, tooling, CI, tests, and work
  // that is unfinished or only measured.
  docs: 'none',
  design: 'none',
  chore: 'none',
  test: 'none',
  refactor: 'none',
  tools: 'none',
  ci: 'none',
  build: 'none',
  wip: 'none',
  fixup: 'none',
  spike: 'none',
  measure: 'none',
});

/** `feat(app): thing` -> `feat`; `fix!: thing` -> `fix`; `tools+ci: thing` ->
 *  `tools+ci`. Anything without a recognisable prefix contributes nothing
 *  rather than defaulting to a bump — an unparseable subject is not evidence
 *  of a change worth releasing. */
export function commitType(subject) {
  const m = /^([a-z]+(?:\+[a-z]+)*)(\([^)]*\))?!?:/.exec(subject.trim());
  return m ? m[1] : null;
}

/** `minor`, `patch` or `none` for a type from `commitType`. A combined type
 *  takes the strongest of its parts; a part the table does not name is none. */
export function bumpOf(type) {
  let strongest = 'none';
  for (const part of type.split('+')) {
    const bump = Object.hasOwn(BUMP_BY_TYPE, part) ? BUMP_BY_TYPE[part] : 'none';
    if (bump === 'minor') return 'minor';
    if (bump === 'patch') strongest = 'patch';
  }
  return strongest;
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
  const bumps = subjects.map(commitType).filter((t) => t !== null).map(bumpOf);
  if (bumps.includes('minor')) return `${major}.${minor + 1}.0`;
  if (bumps.includes('patch')) return `${major}.${minor}.${patch + 1}`;
  return null;
}
