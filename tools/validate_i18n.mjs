// tools/validate_i18n.mjs
// A chrome string that reaches the DOM as a literal is a string the catalogue
// cannot translate. This scans the MIGRATED files for a text sink being
// assigned a literal with words in it. Reference-free and cheap; falsified
// in validate_i18n.test.ts and by the mutation in the commit that added it.
//
// What this gate CANNOT see, because it is a line-level regex over raw
// source and not a parser -- worth naming explicitly for whoever grows
// MIGRATED in Tasks 10-11, since Task 9's own conversion leans on every one
// of these and passed only because a human read the diff, not because this
// gate would have caught a regression in it:
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
// into `el.textContent = '…'` -- stays caught after a MIGRATED file is
// edited. It is not a substitute for reading a diff that adds new chrome
// text, and Tasks 10-11 should not treat a clean `validate:i18n` run as proof
// that nothing was missed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** Grows in Tasks 10-11; Task 11's last commit replaces it with a directory walk. */
export const MIGRATED = [
  'packages/app/src/ui/settings-panel.ts',
  'packages/app/src/ui/settings-keymap.ts',
  'packages/app/src/ui/pause.ts',
  'packages/app/src/ui/saves.ts',
  'packages/app/src/ui/credits.ts',
  'packages/app/src/ui/menu.ts',
  'packages/app/src/ui/brigade.ts',
  'packages/app/src/ui/debrief.ts',
  'packages/app/src/ui/loading.ts',
  'packages/app/src/ui/worldmap.ts',
  'packages/app/src/ui/worldmap3d.ts',
  'packages/app/src/ui/grade-copy.ts',
  'packages/app/src/ui/role.ts',
  'packages/app/src/ui/mark.ts',
  'packages/app/src/tutorial/panel.ts',
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url).pathname;
  const failures = MIGRATED.flatMap((f) => bareStringFailures(f, readFileSync(join(root, f), 'utf8')));
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`validate:i18n OK -- ${MIGRATED.length} file(s), no bare chrome strings`);
}
