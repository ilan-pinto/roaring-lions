// GH-1406: the source-hash sidecar of a chrome catalogue, data/locales/<lang>/chrome.src.json.
//   node tools/locales_chrome_src.mjs <lang>                     -> lists what is missing or stale, exits 1 if anything is
//   node tools/locales_chrome_src.mjs <lang> --write             -> adds hashes for keys that have none (a new locale: all of them)
//   node tools/locales_chrome_src.mjs <lang> --write --rebless=a.b,c.d
//                                                                -> ALSO sets those keys to the current English hash
// Only run --rebless AFTER re-translating those strings: a stale entry stays red on purpose, and re-blessing one without translating
// it hides exactly the edit the guard exists to show. A translator of a NEW language runs `--write` once, from the English they read.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeSource, chromeSourceFailures } from './validate_chrome_catalogue.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv[2];
if (lang === undefined || lang.startsWith('-') || lang === 'en') {
  console.error('usage: node tools/locales_chrome_src.mjs <lang> [--write] [--rebless=key,key]');
  process.exit(2);
}
const catalogue = join(ROOT, 'packages/app/src/i18n', `${lang}.json`);
const sidecar = join(ROOT, 'data/locales', lang, 'chrome.src.json');
if (!existsSync(catalogue)) {
  console.error(`no chrome catalogue at packages/app/src/i18n/${lang}.json`);
  process.exit(2);
}
const en = JSON.parse(readFileSync(join(ROOT, 'packages/app/src/i18n/en.json'), 'utf8'));
const tr = JSON.parse(readFileSync(catalogue, 'utf8'));
const existing = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : {};
const rebless = (process.argv.find((a) => a.startsWith('--rebless=')) ?? '--rebless=').slice('--rebless='.length).split(',').filter((k) => k !== '');
for (const k of rebless) if (!(k in tr)) { console.error(`--rebless: "${k}" is not a key of ${lang}.json`); process.exit(2); }
if (process.argv.includes('--write')) {
  const next = buildChromeSource(en, tr, existing, rebless);
  mkdirSync(dirname(sidecar), { recursive: true });
  writeFileSync(sidecar, JSON.stringify(next, null, 2) + '\n');
  console.log(`wrote data/locales/${lang}/chrome.src.json (${Object.keys(next).length} keys)`);
  process.exit(0);
}
const fails = chromeSourceFailures(`data/locales/${lang}/chrome.src.json`, en, tr, existing);
if (fails.length > 0) {
  for (const f of fails.slice(0, 50)) console.error(f);
  if (fails.length > 50) console.error(`... and ${fails.length - 50} more`);
  process.exit(1);
}
console.log(`data/locales/${lang}/chrome.src.json is current (${Object.keys(existing).length} keys)`);
