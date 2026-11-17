// GH-1406 parts 2 and 5: writes (or checks) the generated English catalogues every translator starts from,
// data/locales/en/missions.json and data/locales/en/units.json.
//   node tools/locales_en.mjs            -> exits 1 and lists what differs when either file is stale
//   node tools/locales_en.mjs --write    -> regenerates both from data/missions/*.json and data/units/**
// The mission catalogue covers every field the overlay can replace (name, briefing, sections, dispatch, aftermath, hostages_place, debrief, every radio line); the unit one covers name and blurb. Each entry also carries `src`, the hash of its English (`sourceHash`), which a translation carries over so validate:data can tell it has gone stale. The builders are `buildEnglishCatalogue` and `buildEnglishUnits` in validate_narrative.mjs (pure functions a test can call); this is only the file I/O.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnglishCatalogue, englishCatalogueFailures, buildEnglishUnits, englishUnitFailures } from './validate_narrative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonIn = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return jsonIn(p);
    return f.endsWith('.json') ? [p] : [];
  });
const missions = jsonIn(join(ROOT, 'data/missions')).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const units = jsonIn(join(ROOT, 'data/units')).map((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((u) => typeof u.id === 'string');

const targets = [
  { rel: 'data/locales/en/missions.json', what: `${missions.length} missions`, text: JSON.stringify(buildEnglishCatalogue(missions), null, 2) + '\n', failures: (c) => englishCatalogueFailures('data/locales/en/missions.json', c, missions) },
  { rel: 'data/locales/en/units.json', what: `${units.length} units`, text: JSON.stringify(buildEnglishUnits(units), null, 2) + '\n', failures: (c) => englishUnitFailures('data/locales/en/units.json', c, units) },
];

if (process.argv.includes('--write')) {
  for (const t of targets) {
    mkdirSync(dirname(join(ROOT, t.rel)), { recursive: true });
    writeFileSync(join(ROOT, t.rel), t.text);
    console.log(`wrote ${t.rel} (${t.what})`);
  }
  process.exit(0);
}
const fails = [];
for (const t of targets) {
  const path = join(ROOT, t.rel);
  const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const found = t.failures(have === null ? null : JSON.parse(have));
  if (have !== t.text && found.length === 0) found.push(`${t.rel} differs from a fresh build in layout (run \`pnpm locales:en -- --write\`)`);
  fails.push(...found);
}
if (fails.length > 0) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('data/locales/en/missions.json and units.json are current');
