/**
 * B6-6 (lead ruling: the entry ceiling, `MAIN_CHUNK_MAX_BYTES` 1,850,000, STAYS): no map or mission JSON rides on the entry
 * chunk. `pnpm --filter @lions/tools webgpu:bundle` is the byte gate; this is the cheap one that names the cause. It walks
 * the entry's STATIC import graph (value imports only, from `main.ts`) through relative specifiers AND the workspace
 * packages' own `exports` (so `@lions/data` is followed into its index, and a `.json` import is a node of the graph), and
 * requires that it reach no `data/maps/*.json`, no `data/missions/*.json` and not the eager registry `@lions/data/content`.
 * Dynamic imports are not followed: they are the lazy boundary. Modelled on `versus-kit-wiring.test.ts`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;
const REPO = resolve(SRC, '../../..');
const read = (p: string): string => readFileSync(p, 'utf8');
const main = read(join(SRC, 'main.ts'));

const PACKAGES: Readonly<Record<string, string>> = {
  '@lions/data': 'packages/data',
  '@lions/sim': 'packages/sim',
  '@lions/render': 'packages/render',
  '@lions/net': 'packages/net',
  '@lions/economy': 'packages/economy',
};

/** A specifier to a file on disk: a relative `.ts`/`.json`, or a workspace package's `exports` entry. Null for anything else
 *  (a stylesheet, `three`, a node builtin). */
function resolveSpec(from: string, spec: string): string | null {
  if (spec.startsWith('.')) {
    const base = resolve(dirname(from), spec);
    for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) if (/\.(ts|json)$/.test(c) && existsSync(c)) return c;
    return null;
  }
  const m = /^(@lions\/[a-z-]+)(\/.+)?$/.exec(spec);
  if (m === null || !Object.hasOwn(PACKAGES, m[1])) return null;
  const dir = join(REPO, PACKAGES[m[1]]);
  const exportsMap = (JSON.parse(read(join(dir, 'package.json'))) as { exports: Record<string, unknown> }).exports;
  const target = exportsMap[m[2] === undefined ? '.' : `.${m[2]}`];
  if (typeof target !== 'string') throw new Error(`${from}: ${spec} is not a string export of ${m[1]}`);
  return join(dir, target);
}

/** The specifiers a file imports or re-exports for VALUE (not `import type`, not a brace list of `type` members only). */
function staticValueImports(file: string): string[] {
  if (file.endsWith('.json')) return [];
  const src = read(file);
  const out: string[] = [];
  const re = /^(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s+'([^']*)'|^import\s+'([^']*)'/gm;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const clause = m[1];
    if (clause !== undefined) {
      const braces = /^\{([^}]*)\}$/.exec(clause.trim());
      if (braces !== null) {
        const members = braces[1].split(',').map((x) => x.trim()).filter((x) => x !== '');
        if (members.length > 0 && members.every((x) => x.startsWith('type '))) continue;
      }
    }
    out.push(m[2] ?? m[3]);
  }
  return out;
}

/** Every file reachable from `entry` by static value imports, repo-relative. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (f: string): void => {
    const key = relative(REPO, f);
    if (seen.has(key)) return;
    seen.add(key);
    for (const spec of staticValueImports(f)) {
      const next = resolveSpec(f, spec);
      if (next !== null && !next.endsWith('.test.ts')) walk(next);
    }
  };
  walk(entry);
  return seen;
}

const CONTENT = (f: string): boolean => /^data\/(maps|missions)\/[^/]+\.json$/.test(f) || f === 'packages/data/src/content.ts';
const jsonCount = (dir: string): number => readdirSync(join(REPO, 'data', dir)).filter((f) => f.endsWith('.json')).length;

describe('no map or mission JSON on the entry chunk (B6-6)', () => {
  const reached = closure(join(SRC, 'main.ts'));

  it("the entry's static import graph reaches no map or mission JSON, nor the eager registry", () => {
    expect([...reached].filter(CONTENT)).toEqual([]);
  });

  it('the walk is not vacuous: it goes through @lions/data into JSON, and reaches the manifest and the loaders', () => {
    for (const f of ['packages/data/src/index.ts', 'packages/data/src/content-manifest.ts', 'packages/data/src/content-lazy.ts', 'data/palette.json', 'data/campaign/world.json', 'packages/sim/src/index.ts', 'packages/render/src/index.ts']) {
      expect(reached.has(f), f).toBe(true);
    }
    expect(reached.size).toBeGreaterThan(300);
  });

  it('the same walk finds every map and mission from the eager registry, and finds the registry from a lazy room module', () => {
    const eager = closure(join(REPO, 'packages/data/src/content.ts'));
    expect([...eager].filter((f) => f.startsWith('data/maps/')).length).toBe(jsonCount('maps'));
    expect([...eager].filter((f) => f.startsWith('data/missions/')).length).toBe(jsonCount('missions'));
    expect(closure(join(SRC, 'net/match-world.ts')).has('packages/data/src/content.ts')).toBe(true);
  });

  it('main.ts takes no map or mission registry from @lions/data, and nothing from @lions/data/content', () => {
    expect(main).not.toMatch(/from '@lions\/data\/content'/);
    const dataImport = /^import \{([^}]*)\} from '@lions\/data';/m.exec(main)?.[1] ?? '';
    expect(dataImport).toContain('missionManifest');
    expect(dataImport.split(',').map((x) => x.trim())).not.toContain('maps');
    expect(dataImport.split(',').map((x) => x.trim())).not.toContain('missions');
  });
});

describe("the battlefield and the shell load content by id, the house way (main.ts can't be booted by a unit test)", () => {
  it('a mission: importWithRetry, the abort checked after the await, and a failed load thrown as a ChunkLoadError (the download card)', () => {
    expect(main).toMatch(
      /const loaded = await importWithRetry\(\(\) => loadMission<MissionJson>\(missionId\)\)\.catch\(\(err: unknown\) => \(err instanceof ChunkLoadError \? err : new ChunkLoadError\(err\)\)\);\s*if \(req\.signal\.aborted\) return teardown;\s*if \(loaded instanceof ChunkLoadError\) \{\s*teardown\(\);\s*throw loaded;\s*\}/,
    );
  });

  it('a map: the same, before the transport is resolved, with the default ground for an id no map has', () => {
    const load = main.search(/const mapLoaded = await importWithRetry\(\(\) => loadMap\(isMapId\(mapId\) \? mapId : 'beit_sahwan_outskirts'\)\)\.catch\(/);
    expect(load).toBeGreaterThan(0);
    expect(main.slice(load)).toMatch(/^[^\n]*\n\s*if \(req\.signal\.aborted\) return teardown;\s*if \(mapLoaded instanceof ChunkLoadError\) \{\s*teardown\(\);\s*throw mapLoaded;\s*\}/);
    expect(load).toBeLessThan(main.search(/let match: Connected;/));
    expect(main).toMatch(/const baseMapJson: MapJson = mapLoaded;/);
  });

  it('free play: the card pictures load first; a failed load opens the picker without them, never a blank screen', () => {
    expect(main).toMatch(/\{ name: 'free-play', pattern: '\/free-play', mount: \(host, req\) => mountFreePlay\(host, req\) \}/);
    expect(main).toMatch(
      /const previews = await importWithRetry\(\(\) => loadMaps\(freePlayMapIds\(\)\)\)\.catch\(\(err: unknown\) => \{\s*console\.error\([^)]*\);\s*return \{\};\s*\}\);\s*if \(req\.signal\.aborted\) return \(\) => undefined;\s*return showSandbox\(host, previews\);/,
    );
  });

  it("the menu diorama's map loads by id inside the scene host's world, whose rejection is the plate", () => {
    expect(main).toMatch(/world: \(\) => \{\s*const now = settingsDeps\.get\(\);\s*return loadDioramaSceneOptions\(/);
  });

  it("a room's digest comes from the kit, and the console's is loaded on demand", () => {
    expect(main).toMatch(/\.\.\.\(netConfig !== null \? \{ dataDigest: rk\(\)\.shippedContentDigest\(\) \} : \{\}\)/);
    expect(main).toMatch(/contentDigest: \(\): Promise<number> => importWithRetry\(\(\) => import\('\.\/net\/content-digest'\)\)/);
    expect(main).not.toMatch(/^import [^;]*from '\.\/net\/(content-digest|frame-step)';/m);
  });
});

describe('GH-1381: the Sarim side of Free play loads on demand', () => {
  const reached = closure(join(SRC, 'main.ts'));

  it("the entry's static graph reaches neither the Sarim Free play module nor the versus forces it places", () => {
    expect(reached.has('packages/app/src/sandbox-sarim.ts')).toBe(false);
    expect(reached.has('packages/app/src/net/versus-force.ts')).toBe(false);
    // Not vacuous: the module itself reaches the versus forces, and the KDF sandbox's spawner is on the entry.
    expect(closure(join(SRC, 'sandbox-sarim.ts')).has('packages/app/src/net/versus-force.ts')).toBe(true);
    expect(reached.has('packages/app/src/sandbox-spawn.ts')).toBe(true);
  });

  it('main.ts takes its types only, and the module through importWithRetry, awaited only for a Sarim pick, the abort checked after', () => {
    expect(main).toMatch(/^import type \* as SandboxSarim from '\.\/sandbox-sarim';$/m);
    expect(main).not.toMatch(/^import (?!type)[^;]*from '\.\/sandbox-sarim';/m);
    expect(main).toMatch(/return importWithRetry\(\(\) => import\('\.\/sandbox-sarim'\)\);/);
    expect(main).toMatch(
      /const sarim: typeof SandboxSarim \| null = playSide === 'sarim' \? await sandboxSarim\(\) : null;\s*if \(req\.signal\.aborted\) return \(\) => undefined;/,
    );
  });

  it('a Sarim pick spawns, rosters and kits through the module, and the KDF opposition fields the base ladder', () => {
    expect(main).toMatch(/\} else if \(sarim !== null\) \{[^}]*sandboxForce = sarim\.sarimSandboxSpawns\(sim, typeOf, anchors, \{ civ: wantCiv \}\);\s*\} else \{\s*sandboxForce = sandboxSpawns\(/);
    expect(main).toMatch(/: sarim !== null\s*\? withWoundedTypes\(sarim\.sarimSandboxUnitTypes\(\{ civ: wantCiv \}\), woundsOf\)/);
    expect(main).toMatch(/const bootKit = inRoom \|\| playSide === 'sarim' \? \{\} : bootTiers\(/);
    expect(main).toMatch(/const seatWorld = seatWorldFor\(netConfig, sim, undefined, playSide\);/);
    // The side and the extras come from the ONE pipeline `boot-flags.test.ts` runs, every dropped line printed
    // (GH-1381 review notes 1 and 2): a mission or a room is told apart by the boot's own two facts.
    expect(main).toMatch(/const \{ side: playSide, flags \} = bootFlags\(params, \{ missionId: req\.missionId, inRoom \}, \(line\) => console\.warn\(line\)\);/);
    expect(main).not.toMatch(/\b(sandboxSideOf|sideFlags|roomFlags|readFlags)\(/);
    // Note 3: a Sarim Free play's radio net speaks the side's language, not a literal KDF one.
    expect(main).toMatch(/announceLang: voiceLangs\[playSide\] \?\? 'he',/);
  });
});

describe("the save kit carries no map or mission JSON: it loads at every mission boot and on the board, and a module stays for the realm's life", () => {
  // CI's `perf:memory` read it as heap: every map and mission (about 1 MiB of the "menu after a mission" reading, growing with each one
  // added) stayed after the first mission or the board, through `mission-save.ts` -> `net/content-digest.ts` -> `@lions/data/content`.
  const kit = closure(join(SRC, 'mission-save-kit.ts'));

  it("the kit's static import graph reaches no map or mission JSON, nor the eager registry, nor the content digest", () => {
    expect([...kit].filter(CONTENT)).toEqual([]);
    expect(kit.has('packages/app/src/net/content-digest.ts')).toBe(false);
  });

  it('the walk is not vacuous: it reaches the save library, the canonical form and @lions/data, and the digest does reach the registry', () => {
    for (const f of ['packages/app/src/mission-save.ts', 'packages/app/src/mission-resume.ts', 'packages/app/src/net/canonical-json.ts', 'packages/data/src/index.ts']) {
      expect(kit.has(f), f).toBe(true);
    }
    expect(closure(join(SRC, 'net/content-digest.ts')).has('packages/data/src/content.ts')).toBe(true);
  });

  it('the digest is loaded on demand, through importWithRetry, at a save and at a resume', () => {
    const save = read(join(SRC, 'mission-save.ts'));
    expect(save).toMatch(/export async function loadContentDigest\(\): Promise<number> \{\s*const m = await importWithRetry\(\(\) => import\('\.\/net\/content-digest'\)\);/);
    expect(read(join(SRC, 'mission-resume.ts'))).toMatch(/const contentDigest = await loadContentDigest\(\)\.catch\(\(\) => null\);\s*const prepared = contentDigest === null \? null : await prepareResume\(record, \{ contentDigest \}\);/);
    const body = main.slice(main.indexOf('const saveAndQuit = async'));
    expect(body.indexOf('await loadContentDigest()')).toBeGreaterThan(0);
    expect(body.indexOf('await loadContentDigest()')).toBeLessThan(body.indexOf('cutMission('));
  });
});
