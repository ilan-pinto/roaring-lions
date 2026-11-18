// GH-1406: which languages are SHIPPED and which are only STAGED. A shipped language is one in `LOCALES` (packages/app/src/i18n/locales.ts):
// a player can choose it, so its catalogue must be complete and current, and `validate:data` holds it to that. A staged language is a
// translation being prepared (data/locales/<id>/ and packages/app/src/i18n/<id>.json exist, `LOCALES` does not list it): it may LAG the English
// (a key main added, a line main edited) without failing anything, and the lag is REPORTED (`pnpm locales:pending -- <id>`). The strict gate
// applies when a language ships; that is the lead's text-freeze rule in practice. `en` is the source and is never staged.
//
// A staged language still fails on what is WRONG rather than stale: a key en does not have, a wrong placeholder or ICU shape, a value that is
// not a string, a malformed source hash, a hash for a key the catalogue does not translate, a label over its cap, an unknown mission or unit.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The ids in `LOCALES`, read from the source file (the tools cannot import TypeScript). `['en']` today. */
export function shippedLocaleIds(root) {
  const file = join(root, 'packages/app/src/i18n/locales.ts');
  if (!existsSync(file)) return ['en'];
  const src = readFileSync(file, 'utf8');
  const body = /export const LOCALES[^=]*=\s*\[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
  const ids = [...body.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  return ids.length > 0 ? ids : ['en'];
}

/** Whether `id` is staged: not `en`, and not in `LOCALES`. */
export const isStaged = (id, shipped) => id !== 'en' && !shipped.includes(id);

/** The options every validator takes for language `lang`: `staged`, and the `lag` array that language's lag is collected in (made on first use). */
export function stagingOpts(lang, shipped, lagByLang) {
  if (!lagByLang.has(lang)) lagByLang.set(lang, []);
  return { staged: isStaged(lang, shipped), lag: lagByLang.get(lang) };
}
