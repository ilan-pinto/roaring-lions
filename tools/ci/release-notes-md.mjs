// GH-1622: the release step's half of the release notes. The `version` job in .github/workflows/ci.yml runs it twice:
//
//   node tools/ci/release-notes-md.mjs cut --version=<X.Y.Z>
//       In the release bump commit, AFTER the workflow's `git mv data/release-notes/next.json data/release-notes/vX.json`:
//       rewrites that file's `"version": "next"` line to X (that one line: the lead approved the rest word for word)
//       and writes a fresh empty next.json. A missing vX.json (no next.json was there to move) is written empty, so a
//       release never waits on its notes.
//
//   node tools/ci/release-notes-md.mjs render --version=<X.Y.Z> --out=<file>
//       After the tag is pushed: the markdown body for `gh release create vX --notes-file <file>`.
//
// The pure half (everything exported) is tested on literal fixtures in tools/src/ci/release-notes-md.test.ts; only
// `main` touches the filesystem. The entries were already held to the schema and the filter gate
// (tools/validate_release_notes.mjs) by `validate:data` in the `gates` job this job needs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The directory, relative to the repository root. */
export const DIR = 'data/release-notes';

/** The headings, in order, by section. An empty section is left out. */
export const HEADINGS = /** @type {const} */ ([
  ['units', 'New units'],
  ['rules', 'Rules and features'],
  ['fixes', 'Fixes'],
]);

/** The body of a release whose three sections are all empty. */
export const NOTHING = 'No player-facing changes';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The text of a fresh notes file, in the shape next.json is committed in.
 *
 * @param {string} version "next", or X.Y.Z
 * @returns {string}
 */
export function emptyNotes(version) {
  return `${JSON.stringify({ version, units: [], rules: [], fixes: [] }, null, 2)}\n`;
}

/**
 * next.json's text with its version rewritten to X. When the file has exactly one `"version": "next"` line (the
 * committed shape), only that line changes: the lead approved the file's text in the promotion PR, and a reserialise
 * would reformat it. Any other layout is parsed and written back in the committed shape. Throws when the text is
 * not JSON or its version is not "next".
 *
 * @param {string} raw
 * @param {string} version
 * @returns {string}
 */
export function releasedText(raw, version) {
  if (!SEMVER.test(version)) throw new Error(`release-notes: "${version}" is not X.Y.Z`);
  const doc = JSON.parse(raw);
  if (typeof doc !== 'object' || doc === null || doc.version !== 'next') {
    throw new Error(`release-notes: the file to release says "version": ${JSON.stringify(doc?.version)}, not "next"`);
  }
  const re = /^([ \t]*"version"[ \t]*:[ \t]*)"next"([ \t]*,?[ \t]*)$/gm;
  if ((raw.match(re) ?? []).length === 1) return raw.replace(re, `$1${JSON.stringify(version)}$2`);
  return `${JSON.stringify({ ...doc, version }, null, 2)}\n`;
}

/**
 * Backslash-escapes the markdown punctuation that would change how an entry reads on the release page. The filter
 * gate has already refused an underscore, a hash and digits, and an @.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeMd(s) {
  return s.replace(/[\\`*_[\]<>|~#]/g, '\\$&');
}

/**
 * The release body: a heading per non-empty section, one bullet per entry, or NOTHING when all three are empty.
 *
 * @param {unknown} doc the parsed notes file
 * @returns {string}
 */
export function renderMarkdown(doc) {
  if (typeof doc !== 'object' || doc === null) throw new Error('release-notes: the notes file is not an object');
  const rec = /** @type {Record<string, unknown>} */ (doc);
  /** @type {string[]} */
  const out = [];
  for (const [key, heading] of HEADINGS) {
    const list = rec[key];
    if (!Array.isArray(list) || !list.every((e) => typeof e === 'string')) {
      throw new Error(`release-notes: "${key}" is not an array of strings`);
    }
    if (list.length === 0) continue;
    if (out.length > 0) out.push('');
    out.push(`## ${heading}`, '', ...list.map((e) => `- ${escapeMd(e.trim())}`));
  }
  return `${out.length > 0 ? out.join('\n') : NOTHING}\n`;
}

/** @param {string[]} argv */
function main(argv) {
  const [mode, ...rest] = argv;
  /** @type {Record<string, string>} */
  const args = {};
  for (const a of rest) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) throw new Error(`release-notes: unknown argument ${a}`);
    args[m[1]] = m[2];
  }
  const version = args.version ?? '';
  if (!SEMVER.test(version)) throw new Error(`release-notes: --version=<X.Y.Z> is required (got "${version}")`);
  const dir = args.dir ?? DIR;
  const released = join(dir, `v${version}.json`);
  const next = join(dir, 'next.json');

  if (mode === 'cut') {
    if (existsSync(next)) throw new Error(`release-notes: ${next} is still there; git mv it to ${released} first`);
    if (existsSync(released)) {
      writeFileSync(released, releasedText(readFileSync(released, 'utf8'), version));
    } else {
      console.error(`release-notes: no notes for v${version} (there was no next.json to move); writing an empty ${released}`);
      writeFileSync(released, emptyNotes(version));
    }
    writeFileSync(next, emptyNotes('next'));
    console.error(`release-notes: cut ${released}, wrote an empty ${next}`);
    return;
  }
  if (mode === 'render') {
    if (!args.out) throw new Error('release-notes: --out=<file> is required');
    writeFileSync(args.out, renderMarkdown(JSON.parse(readFileSync(released, 'utf8'))));
    console.error(`release-notes: rendered ${released} to ${args.out}`);
    return;
  }
  throw new Error(`release-notes: the mode is cut or render (got "${mode ?? ''}")`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
