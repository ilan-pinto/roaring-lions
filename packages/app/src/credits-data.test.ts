// packages/app/src/credits-data.test.ts
//
// The one gate that cannot go stale by omission: a shipped runtime dependency,
// an installed version that has drifted from what is credited, a font with no
// licence file on disk, or a LICENSE that says something this file does not
// repeat, all fail here rather than silently reaching the credits screen wrong.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDITS } from './credits-data';

const ROOT = new URL('../../../', import.meta.url).pathname;
const pkg = (p: string): { dependencies?: Record<string, string> } => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8'));

/**
 * pnpm does not hoist a workspace package's own dependency to the repo root
 * `node_modules` -- only the ROOT package.json's own devDependencies land
 * there (verified: `three`/`pixi.js`, declared only in
 * `packages/render/package.json`, have no `node_modules/three` at the repo
 * root at all, only a symlink at `packages/render/node_modules/three` into
 * the pnpm store). So a dependency's installed `package.json` is looked up
 * through each workspace package's own `node_modules` in turn, rather than
 * assumed to sit at `${ROOT}node_modules/<name>`.
 */
const WORKSPACE_DIRS = ['', 'packages/app/', 'packages/render/', 'packages/data/', 'packages/sim/'];
function installedPkg(name: string): { version: string; license?: string } {
  for (const dir of WORKSPACE_DIRS) {
    const path = `${ROOT}${dir}node_modules/${name}/package.json`;
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as { version: string; license?: string };
  }
  throw new Error(`${name}: not installed under any workspace package's node_modules`);
}

describe('CREDITS', () => {
  it('names every third-party runtime dependency of the shipping packages, at the installed major.minor', () => {
    const deps = new Map<string, string>();
    for (const p of ['packages/app/package.json', 'packages/render/package.json', 'packages/data/package.json', 'packages/sim/package.json']) {
      for (const [name, range] of Object.entries(pkg(p).dependencies ?? {})) if (!range.startsWith('workspace:')) deps.set(name, range);
    }
    expect(deps.size).toBeGreaterThan(0);
    for (const [name] of deps) {
      const c = CREDITS.libraries.find((l) => l.name === name);
      expect(c, `${name} is shipped and not credited`).toBeDefined();
      const installed = installedPkg(name);
      expect(installed.version.startsWith(c?.version ?? '?'), `${name}: credited ${c?.version}, installed ${installed.version}`).toBe(true);
      expect(c?.licence).toBe(installed.license);
    }
  });
  it('names every font file under assets/fonts with a licence file that exists', () => {
    const files = readdirSync(`${ROOT}assets/fonts`);
    for (const f of CREDITS.fonts) expect(files, f.licenceFile).toContain(f.licenceFile);
    const families = files.filter((f) => f.endsWith('.woff2')).map((f) => f.split('-')[0]);
    for (const fam of new Set(families)) expect(CREDITS.fonts.some((f) => f.licenceFile.toLowerCase().includes(fam.replace(/[^a-z]/gi, '').toLowerCase().slice(0, 5))), `${fam} has no credit`).toBe(true);
  });
  it('states the licences the repository states', () => {
    const licence = readFileSync(`${ROOT}LICENSE`, 'utf8');
    expect(licence.startsWith('MIT License')).toBe(true);
    expect(CREDITS.codeLicence).toContain('MIT');
    expect(licence).toContain(CREDITS.artLicence);
  });
});
