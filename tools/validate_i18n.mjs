// tools/validate_i18n.mjs
// A chrome string that reaches the DOM as a literal is a string the catalogue
// cannot translate. This scans every walked file for a text sink being
// assigned a literal with words in it. Reference-free and cheap; falsified
// in validate_i18n.test.ts and by the mutation in the commit that added it.
//
// Task 9 and Task 10 grew a hand-kept `MIGRATED` list, one path per file as
// it was converted -- deliberately, so the gate could not fail on a file
// nobody had touched yet. Task 11 finishes the tree, so the list is gone:
// `walkChromeFiles` below walks every `.ts` file under `packages/app/src`
// instead, and a NEW chrome file is caught by construction rather than by
// remembering to add it to a list a second time. Two exclusions, both
// deliberate and both falsifiable (see the walk's own doc comment): a
// `*.test.ts` file's asserted-English literals are not chrome, and
// `sandbox-help.ts`'s blurbs are dev-tool console text by that file's own
// header (R-3 of the shell-upgrade spec).
//
// What this gate CANNOT see, because it is a line-level regex over raw
// source and not a parser -- worth naming explicitly for whoever extends the
// walk, since Task 9's own conversion leans on every one of these and passed
// only because a human read the diff, not because this gate would have
// caught a regression in it:
//
//   1. A literal passed to a HELPER that assigns it to a sink somewhere
//      ELSE, one level removed from the call site. `panel({ rank, title:
//      'Settings' })`, `section(table, 'Video')` and `row(table,
//      'Fullscreen', cb)` (all three shipped in settings-panel.ts before
//      Task 9) never match SINKS/ATTR in THIS file's source text -- the
//      actual `title.textContent = opts.title` / `h.textContent = title`
//      assignment lives inside panel.ts's/this-file's own helper, on a
//      variable, not a quoted literal next to `=`. A bare English string
//      handed to any such helper is invisible here.
//   2. A template literal (or any string) assigned to a LOCAL first, then
//      the local assigned to the sink: `const label = \`Foo\`; el.title =
//      label;`. SINKS/ATTR require a quote character immediately after `=`;
//      one hop of indirection defeats the match entirely.
//   3. A TABLE-driven literal -- an array of `[key, 'Some Label']` tuples (or
//      an object literal keyed by variant, `{ low: 'Low — …', … }`, the exact
//      shape settings-panel.ts used for quality/colour-vision text before
//      Task 9) fed through a loop or lookup that sets `.textContent` from the
//      resolved value. The literal sits inside a data structure, never
//      adjacent to the sink assignment the regex is anchored on.
//
// In short: this gate proves the OBVIOUS case -- a literal typed directly
// into `el.textContent = '…'` -- stays caught across the whole tree. It is
// not a substitute for reading a diff that adds new chrome text, and a clean
// `validate:i18n` run is not proof that nothing was missed.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SINKS = /(?:\.textContent|\.innerText|\.innerHTML|\.title|\.placeholder|\.ariaLabel)\s*=\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
const ATTR = /setAttribute\(\s*['"](?:aria-label|title|placeholder)['"]\s*,\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
const WORDS = /[A-Za-z]{3,}/;
const OK = /i18n-ok/;

export function bareStringFailures(file, source) {
  const out = [];
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (OK.test(line)) return;
    for (const re of [SINKS, ATTR]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const lit = m[2];
        const text = lit.replace(/\$\{[^}]*\}/g, '').replace(/<[^>]+>/g, '');
        if (WORDS.test(text)) out.push(`${file}:${i + 1}: bare chrome string ${JSON.stringify(lit.slice(0, 40))} -- use t('…') or tag the line /* i18n-ok: reason */`);
      }
    }
  });
  return out;
}

/** `EXEMPT_FILES`' own doc comment covers the "why"; this is the "what". A
 *  `Set` rather than a second regex so a name match is exact -- a future
 *  `sandbox-help-panel.ts` must not silently inherit the exemption by
 *  substring. */
const EXEMPT_FILES = new Set(['sandbox-help.ts']);

/**
 * Every `.ts` file this gate walks: `packages/app/src`, recursively, minus a
 * `*.test.ts` file's own asserted-English literals and `sandbox-help.ts`'s
 * dev-tool blurbs (see this file's header). Replaces the Task 9/10
 * hand-kept `MIGRATED` list -- a new chrome file is caught by construction
 * now, not by remembering to add its path a second time.
 *
 * Exported so a test can prove both exclusions are load-bearing rather than
 * decorative: dropping the `.test.ts` filter must turn up a real test
 * file's literal (`validate_i18n.test.ts` and its own asserted English
 * strings are IN this tree), and dropping the `sandbox-help.ts` filter must
 * turn up its blurbs. `validate_i18n.test.ts` falsifies both.
 */
export function walkChromeFiles(root) {
  const appSrc = join(root, 'packages/app/src');
  const out = [];
  for (const entry of readdirSync(appSrc, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    if (EXEMPT_FILES.has(entry.name)) continue;
    out.push(relative(root, join(entry.parentPath, entry.name)));
  }
  return out.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url).pathname;
  const files = walkChromeFiles(root);
  const failures = files.flatMap((f) => bareStringFailures(f, readFileSync(join(root, f), 'utf8')));
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`validate:i18n OK -- ${files.length} file(s), no bare chrome strings`);
}
