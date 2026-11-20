// The next version, from the commits since the last release tag AND the release notes being released.
//
// Two signals, and the stronger wins (lead, 19 Nov 2026):
//
//   the notes (data/release-notes/next.json at the commit being released, GH-1622; notesBump below):
//     any `units` or `rules` entry -> minor;  only `fixes` -> patch;  all empty, missing or unreadable -> nothing
//   the commits (BUMP_BY_TYPE below): any feat -> minor;  any other player-facing type -> patch;  otherwise nothing
//
// The notes were added because the commit rule alone never cut a minor here: squash titles are `app:`, `data:`,
// `ci:` and the like, almost never `feat:`, so the 87 commits from v0.134.0 to main's merge 599d38012, whose notes
// carried 16 rules and 2 fixes, were cut as v0.134.1. The notes are the lead-approved account of what a player gets,
// so they say whether it is new (minor) or mended (patch). When they say nothing (empty, or no file) the commit rule
// decides exactly as before, so a docs-only or a hotfix push behaves as it always did; and since the stronger signal
// wins, a `feat:` commit still cuts a minor whatever the notes say. No signal here ever cuts a major: a breaking
// marker (`feat!:`) is read as its type, today as before.
//
// The commit rule:
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
// Pure and sink-free: it takes the current version, the commit subjects and
// the parsed notes (or null), and returns a string or null. The workflow does the git work; a test can
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

/** Bumps from weakest to strongest. */
const BUMP_RANK = Object.freeze({ none: 0, patch: 1, minor: 2 });

/**
 * `minor`, `patch` or `none` from a parsed release-notes file
 * (data/schemas/release_notes.schema.json: `{ version, units[], rules[], fixes[] }`).
 *
 * A `units` or `rules` entry is something new for a player: minor. Only `fixes`: patch. Everything else is `none`,
 * which hands the decision to the commit rule: all three empty, `null` (no file, or a file that is not JSON), and a
 * value that is not the schema's shape (a section that is not an array is read as empty, never as a bump).
 *
 * @param {unknown} notes
 * @returns {'minor' | 'patch' | 'none'}
 */
export function notesBump(notes) {
  if (notes === null || typeof notes !== 'object' || Array.isArray(notes)) return 'none';
  /** @param {string} key */
  const count = (key) => {
    const v = /** @type {Record<string, unknown>} */ (notes)[key];
    return Array.isArray(v) ? v.length : 0;
  };
  if (count('units') > 0 || count('rules') > 0) return 'minor';
  if (count('fixes') > 0) return 'patch';
  return 'none';
}

/**
 * The next version, or null when neither the commits nor the notes warrant one.
 *
 * `current` is the version in package.json; `subjects` are the commit
 * subject lines since the last tag, newest or oldest first — order does not
 * matter, because the rule is "does any commit do X", not "what did the last
 * commit do". `notes` is the parsed next.json being released, or null (no
 * file): the stronger of its bump (`notesBump`) and the commits' wins.
 */
export function nextVersion(current, subjects, notes = null) {
  const parts = current.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`unparseable current version: ${current}`);
  }
  const [major, minor, patch] = parts;
  const bumps = subjects.map(commitType).filter((t) => t !== null).map(bumpOf);
  bumps.push(notesBump(notes));
  const strongest = bumps.reduce((a, b) => (BUMP_RANK[b] > BUMP_RANK[a] ? b : a), 'none');
  if (strongest === 'minor') return `${major}.${minor + 1}.0`;
  if (strongest === 'patch') return `${major}.${minor}.${patch + 1}`;
  return null;
}
