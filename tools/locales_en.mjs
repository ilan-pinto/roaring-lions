// GH-1406 part 2: writes (or checks) data/locales/en/missions.json, the generated English catalogue every translator starts from.
//   node tools/locales_en.mjs            -> exits 1 and lists what differs when the file is stale
//   node tools/locales_en.mjs --write    -> regenerates it from data/missions/*.json
// The catalogue covers every field the overlay can replace (name, briefing, sections, dispatch, aftermath, hostages_place, debrief, every radio line). The builder is `buildEnglishCatalogue` in validate_narrative.mjs (a pure function a test can call); this is only the file I/O.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnglishCatalogue, englishCatalogueFailures } from './validate_narrative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/locales/en/missions.json');
const missions = readdirSync(join(ROOT, 'data/missions'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')));
const text = JSON.stringify(buildEnglishCatalogue(missions), null, 2) + '\n';

if (process.argv.includes('--write')) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote data/locales/en/missions.json (${missions.length} missions)`);
  process.exit(0);
}
const have = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
const fails = englishCatalogueFailures('data/locales/en/missions.json', have === null ? null : JSON.parse(have), missions);
if (have !== text && fails.length === 0) fails.push('data/locales/en/missions.json differs from a fresh build in layout (run `pnpm locales:en -- --write`)');
if (fails.length > 0) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('data/locales/en/missions.json is current');
