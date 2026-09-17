// tools/validate_i18n.mjs
// A chrome string that reaches the DOM as a literal is a string the catalogue
// cannot translate. This scans the MIGRATED files for a text sink being
// assigned a literal with words in it. Reference-free and cheap; falsified
// in validate_i18n.test.ts and by the mutation in the commit that added it.
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
