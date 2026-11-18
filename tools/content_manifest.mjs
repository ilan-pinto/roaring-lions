// B6-6: the synchronous content manifest, generated from the data.
//
//   pnpm content:manifest              report drift, exit 1 on any (what `pnpm validate:data` also runs)
//   pnpm content:manifest -- --write   rewrite packages/data/src/content-manifest.ts
//
// The app's entry chunk sits under a byte ceiling (`pnpm --filter @lions/tools webgpu:bundle`, MAIN_CHUNK_MAX_BYTES), and
// every map and mission JSON used to ride in it through `@lions/data`'s `maps` and `missions`. The entry now loads a map or a
// mission BY ID (`@lions/data/content-lazy`) and keeps only this manifest synchronously: per map its name, per mission the
// fields the shell reads before one is chosen -- the campaign board (names, the objectives' type and primary flag for the
// villain line), the stars and carry lines (`ledger.requires`/`produces`, and every placement that carries a recon `tag`:
// `carryReaderOf`'s walk finds the same `{ unit, tag }` objects in the summary that it finds in the whole mission), and the
// mission's `map.file`, so a boot can fetch the map beside the mission.
//
// The ids and their ORDER come from the eager registry, `packages/data/src/content.ts` (the order is the Free Play picker's
// and the versus map list's); the registry must name exactly the files in data/maps and data/missions. Each summary copies
// only fields the file has, never a default, so a reader sees what it saw on the whole JSON.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = 'packages/data/src/content-manifest.ts';
const REGISTRY_PATH = 'packages/data/src/content.ts';

/** `{ id: file }` in registry order for one `export const <name> = { ... } as const;` block of content.ts. */
function registryOf(src, name, dir) {
  const files = new Map();
  for (const m of src.matchAll(/^import (\w+) from '\.\.\/\.\.\/\.\.\/data\/(maps|missions)\/([\w-]+)\.json';$/gm)) {
    if (m[2] === dir) files.set(m[1], m[3]);
  }
  const block = new RegExp(`^export const ${name} = \\{\\n([\\s\\S]*?)\\n\\} as const;$`, 'm').exec(src);
  if (block === null) throw new Error(`${REGISTRY_PATH}: no \`export const ${name} = { ... } as const;\` block`);
  const out = [];
  for (const line of block[1].split('\n')) {
    const e = /^\s*(\w+): (\w+),$/.exec(line);
    if (e === null) {
      if (/^\s*(\/\/.*)?$/.test(line)) continue;
      throw new Error(`${REGISTRY_PATH}: unreadable ${name} entry: ${line}`);
    }
    const file = files.get(e[2]);
    if (file === undefined) throw new Error(`${REGISTRY_PATH}: ${name}.${e[1]} is ${e[2]}, which no data/${dir} import names`);
    out.push({ id: e[1], file });
  }
  return out;
}

/** Every `{ unit, tag }` placement in a mission, first-seen order, each pair once (the walk `carryReaderOf` makes). */
function taggedPlacements(mission) {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (node === null || typeof node !== 'object') return;
    if (typeof node.unit === 'string' && typeof node.tag === 'string') {
      const key = `${node.unit}\u0000${node.tag}`;
      if (!seen.has(key)) { seen.add(key); out.push({ unit: node.unit, tag: node.tag }); }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(mission);
  return out;
}

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o !== null && typeof o === 'object' && Object.hasOwn(o, k)) out[k] = o[k];
  return out;
};

export function mapSummary(map) {
  return pick(map, ['name']);
}

export function missionSummary(mission) {
  const out = pick(mission, ['name']);
  if (mission.map !== undefined) out.map = pick(mission.map, ['file']);
  if (Array.isArray(mission.objectives)) out.objectives = mission.objectives.map((o) => pick(o, ['type', 'primary']));
  if (mission.ledger !== undefined) out.ledger = pick(mission.ledger, ['requires', 'produces']);
  out.tagged = taggedPlacements(mission);
  return out;
}

/** The manifest's text, from the data under `root`. Throws on a registry that does not name exactly the directory's files. */
export function renderContentManifest(root) {
  const src = readFileSync(join(root, REGISTRY_PATH), 'utf8');
  const kinds = [
    { name: 'maps', dir: 'maps', summary: mapSummary },
    { name: 'missions', dir: 'missions', summary: missionSummary },
  ];
  const tables = {};
  for (const k of kinds) {
    const reg = registryOf(src, k.name, k.dir);
    const onDisk = readdirSync(join(root, 'data', k.dir)).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')).sort();
    const named = reg.map((e) => e.file).sort();
    const missing = onDisk.filter((f) => !named.includes(f));
    const stray = named.filter((f) => !onDisk.includes(f));
    if (missing.length > 0 || stray.length > 0) {
      throw new Error(`${REGISTRY_PATH}: ${k.name} must name every data/${k.dir} file once: unregistered ${JSON.stringify(missing)}, missing on disk ${JSON.stringify(stray)}`);
    }
    if (new Set(reg.map((e) => e.id)).size !== reg.length) throw new Error(`${REGISTRY_PATH}: a duplicate ${k.name} id`);
    tables[k.name] = reg.map((e) => ({ ...e, summary: k.summary(JSON.parse(readFileSync(join(root, 'data', k.dir, `${e.file}.json`), 'utf8'))) }));
  }
  const lines = [
    '// GENERATED by tools/content_manifest.mjs (`pnpm content:manifest -- --write`) from the registry order of',
    '// packages/data/src/content.ts and the data/maps and data/missions files it names. Do not edit by hand: `pnpm validate:data`',
    '// regenerates it and fails on any difference (B6-6).',
    '//',
    "// The synchronous half of the content the app's entry chunk may hold: a name per map, and per mission the few fields the shell",
    '// reads before a mission is chosen. The JSON itself loads by id through the loaders below (`@lions/data/content-lazy`); in',
    '// Node, `@lions/data/content` imports all of it eagerly.',
    '',
    '/** What the shell knows of a map before it is loaded. */',
    'export interface MapSummary {',
    '  readonly name: string;',
    '}',
    '',
    '/** What the shell knows of a mission before it is loaded: fields copied from its JSON, never defaulted. */',
    'export interface MissionSummary {',
    '  readonly name: string;',
    '  readonly map: { readonly file: string };',
    '  readonly objectives: readonly { readonly type: string; readonly primary: boolean }[];',
    '  readonly ledger: { readonly requires: readonly string[]; readonly produces: readonly string[] };',
    '  /** Every placement anywhere in the mission that carries a `tag`, as `{ unit, tag }`, each pair once. */',
    '  readonly tagged: readonly { readonly unit: string; readonly tag: string }[];',
    '}',
    '',
    '/** Every shipped map, keyed by id, in registry order. */',
    'export const mapManifest = {',
    ...tables.maps.map((e) => `  ${e.id}: ${JSON.stringify(e.summary)},`),
    '} as const satisfies Readonly<Record<string, MapSummary>>;',
    '',
    'export type MapId = keyof typeof mapManifest;',
    '',
    '/** Every shipped mission, keyed by id, in registry order. */',
    'export const missionManifest = {',
    ...tables.missions.map((e) => `  ${e.id}: ${JSON.stringify(e.summary)},`),
    '} as const satisfies Readonly<Record<string, MissionSummary>>;',
    '',
    'export type MissionId = keyof typeof missionManifest;',
    '',
    '/** One dynamic import per map: a chunk of its own in the app build, never on the entry. */',
    'export const mapLoaders: Readonly<Record<MapId, () => Promise<{ readonly default: unknown }>>> = {',
    ...tables.maps.map((e) => `  ${e.id}: () => import('../../../data/maps/${e.file}.json'),`),
    '};',
    '',
    '/** One dynamic import per mission. */',
    'export const missionLoaders: Readonly<Record<MissionId, () => Promise<{ readonly default: unknown }>>> = {',
    ...tables.missions.map((e) => `  ${e.id}: () => import('../../../data/missions/${e.file}.json'),`),
    '};',
    '',
  ];
  return lines.join('\n');
}

/** validate:data's check: [] when the checked-in manifest is what the data generates, else one line saying how to fix it.
 *  `onDisk` defaults to the file itself; a test passes a hand-edited copy to watch it go red. */
export function contentManifestFailures(root, onDisk = readFileSync(join(root, MANIFEST_PATH), 'utf8')) {
  let want;
  try {
    want = renderContentManifest(root);
  } catch (err) {
    return [`${MANIFEST_PATH}: ${err.message}`];
  }
  if (want === onDisk) return [];
  const a = want.split('\n');
  const b = onDisk.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [`${MANIFEST_PATH}: stale against the data (first difference at line ${i + 1}); run \`pnpm content:manifest -- --write\``];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.includes('--write')) {
    writeFileSync(join(root, MANIFEST_PATH), renderContentManifest(root));
    console.log(`wrote ${MANIFEST_PATH}`);
  } else {
    const f = contentManifestFailures(root);
    for (const line of f) console.error(line);
    if (f.length === 0) console.log(`${MANIFEST_PATH}: up to date`);
    process.exit(f.length === 0 ? 0 : 1);
  }
}
