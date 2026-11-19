// The filter gate on data/release-notes/*.json (GH-1622): the rules release_notes.schema.json cannot see.
//
// The notes are shown to players (the in-game panel) and published as the GitHub release, so every entry must be plain
// player English. This refuses, per entry:
//
//   - a DENYLIST word: what a player never needs to read about (administration, legal, telemetry, the build and the
//     people who run it). Case-insensitive and WHOLE-WORD, with simple plurals ("agents", "workers", "tokens"): a
//     word is a run of letters and digits, so "CI" does not hit "civilians", "legal" does not hit "illegal", and
//     "stats" does not hit "status". An apostrophe or a hyphen ends a word, so "agent's" and "CI-only" are hits.
//   - a PR or issue reference: "PR 123", "GH-123", or a hash sign followed by digits;
//   - a git hash: 7 to 40 hex characters holding at least one digit, as one word ("defaced" is hex and passes; so a
//     long plain number must be written with separators: "1,500,000", never "1500000");
//   - an internal id: a word with an underscore in it ("mbt_lavi", "time_limit_s");
//   - an @ (a handle would notify someone from the GitHub release; an address is never player English);
//   - a URL (http:// or https://) and a path-like token (a slash between letters or digits: "data/units/x.json",
//     and so also "CI/CD" and "and/or": write "and or" or reword);
//   - a FORMAT character (Unicode Cf: a zero-width space, a soft hyphen, a direction mark), which a reader cannot see.
//
// Before matching, the entry is NFKC-normalised and its format characters are removed, so fullwidth "ＣＩ", "D１",
// "C<zero-width space>loudflare" and "Dep<soft hyphen>loy" are read as the words they display as. KNOWN GAP: a
// look-alike letter from another script (a Cyrillic "С" for the Latin "C") is not folded; there is no script check.
//
// And per file: the name is next.json (version "next") or v<X.Y.Z>.json (version "X.Y.Z"), and next.json exists.
//
// Its own module, like tools/validate_arena_results.mjs: validate_data.mjs runs its whole sweep at import time, and
// tools/src/validate_release_notes.test.ts imports these rules directly. Drafting guide: docs/agent-notes/release-notes.md.

/** The three sections, in the order the panel and the release show them. */
export const SECTIONS = /** @type {const} */ (['units', 'rules', 'fixes']);

/**
 * Words no entry may hold (the lead's list, GH-1622; "license", the US spelling of "licence", is the one addition).
 * Matched whole-word, case-insensitive, plus an "s" or "es" plural. Pinned by a literal copy in the test.
 */
export const DENYLIST = [
  'worker',
  'telemetry',
  'D1',
  'privacy',
  'legal',
  'licence',
  'license',
  'CLA',
  'secret',
  'password',
  'token',
  'stats',
  'CI',
  'workflow',
  'deploy',
  'wrangler',
  'Cloudflare',
  'migration',
  'admin',
  'steward',
  'agent',
];

// A word boundary is anything that is not a letter or a digit (Unicode-aware), so an underscore is a boundary here
// too; the snake_case rule below catches the underscore itself.
const W = '[\\p{L}\\p{N}]';
const DENY_RES = DENYLIST.map((w) => /** @type {const} */ ([w, new RegExp(`(?<!${W})(${w}(?:e?s)?)(?!${W})`, 'iu')]));

/** The rules that are not the denylist, by the name a failure prints. Each returns the offending text, or null. */
export const PATTERNS = /** @type {const} */ ([
  ['a PR reference', /(?<![\p{L}\p{N}])PR\s*-?\s*#?\s*\d+/iu],
  ['an issue reference', /(?<![\p{L}\p{N}])GH\s*-?\s*\d+/iu],
  ['a hash sign followed by digits', /#\s*\d+/u],
  ['a git hash', /(?<![\p{L}\p{N}])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}(?![\p{L}\p{N}])/iu],
  ['an internal id (snake_case)', /[\p{L}\p{N}]*_[\p{L}\p{N}_]*/u],
  ['an @ (a handle or an address)', /\S*@\S*/u],
  ['a URL', /https?:\/\/\S*/iu],
  ['a path', /\S*[\p{L}\p{N}]\/[\p{L}\p{N}]\S*/u],
]);

const FORMAT = /\p{Cf}/gu;

/**
 * The text the rules read: NFKC-normalised (fullwidth and compatibility forms folded to plain ones), with every format
 * character removed.
 *
 * @param {string} entry
 * @returns {string}
 */
export function foldEntry(entry) {
  return entry.normalize('NFKC').replace(FORMAT, '');
}

/**
 * Every reason one entry is refused, as `what "text"` strings, in a fixed order (a format character, then the denylist,
 * then PATTERNS), the denylist and PATTERNS read over foldEntry's text.
 *
 * @param {string} entry
 * @returns {string[]}
 */
export function entryHits(entry) {
  const out = [];
  const format = entry.match(FORMAT);
  if (format) {
    const codes = [...new Set(format.map((c) => `U+${c.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`))];
    out.push(`a format character (zero-width, soft hyphen or similar) ${codes.join(', ')}`);
  }
  const text = foldEntry(entry);
  for (const [word, re] of DENY_RES) {
    const m = re.exec(text);
    if (m) out.push(`the denylisted word "${m[1]}" (${word})`);
  }
  for (const [what, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) out.push(`${what} "${m[0]}"`);
  }
  return out;
}

const RELEASED = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.json$/;

/**
 * Failures over the release-notes directory. `files` are `{ file, doc }` with `file` the repo-relative path; `doc` is
 * the parsed JSON (null when it did not parse: validate_data.mjs has already reported that). The schema has run on each
 * already; this tolerates a document it refused and checks what it can.
 *
 * @param {readonly { file: string, doc: unknown }[]} files
 * @returns {string[]}
 */
export function releaseNotesFailures(files) {
  const out = [];
  if (!files.some((f) => basename(f.file) === 'next.json')) {
    out.push('data/release-notes/next.json: missing; the release step and the promotion PR read it (an empty one is fine)');
  }
  for (const { file, doc } of files) {
    const name = basename(file);
    const released = RELEASED.exec(name);
    if (name !== 'next.json' && !released) {
      out.push(`${file}: the name must be next.json or v<X.Y.Z>.json`);
    }
    if (typeof doc !== 'object' || doc === null) continue;
    const rec = /** @type {Record<string, unknown>} */ (doc);
    const want = name === 'next.json' ? 'next' : released ? released[1] : null;
    if (want !== null && rec.version !== want) {
      out.push(`${file}: "version" is ${JSON.stringify(rec.version)}, and this file's name says "${want}"`);
    }
    for (const section of SECTIONS) {
      const list = rec[section];
      if (!Array.isArray(list)) continue;
      list.forEach((entry, i) => {
        if (typeof entry !== 'string') return;
        for (const hit of entryHits(entry)) out.push(`${file}: ${section}[${i}] holds ${hit}: ${JSON.stringify(entry)}`);
      });
    }
  }
  return out;
}

/** @param {string} p */
function basename(p) {
  return p.split(/[\\/]/).pop() ?? p;
}
