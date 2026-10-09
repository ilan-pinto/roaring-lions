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
 * there (verified: `three`, declared only in
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
  // The reverse direction, added when pixi.js left the dependencies (WP-A3.3)
  // and its credit would otherwise have stayed on the credits screen: a
  // credited library must still be a shipped runtime dependency.
  it('credits no library that is no longer a runtime dependency', () => {
    const shipped = new Set<string>();
    for (const p of ['packages/app/package.json', 'packages/render/package.json', 'packages/data/package.json', 'packages/sim/package.json']) {
      for (const [name, range] of Object.entries(pkg(p).dependencies ?? {})) if (!range.startsWith('workspace:')) shipped.add(name);
    }
    for (const l of CREDITS.libraries) expect(shipped.has(l.name), `${l.name} is credited and not shipped`).toBe(true);
  });
  it('names every font file under assets/fonts with a licence file that exists', () => {
    const files = readdirSync(`${ROOT}assets/fonts`);
    for (const f of CREDITS.fonts) expect(files, f.licenceFile).toContain(f.licenceFile);
    const families = files.filter((f) => f.endsWith('.woff2')).map((f) => f.split('-')[0]);
    for (const fam of new Set(families)) expect(CREDITS.fonts.some((f) => f.licenceFile.toLowerCase().includes(fam.replace(/[^a-z]/gi, '').toLowerCase().slice(0, 5))), `${fam} has no credit`).toBe(true);
  });
  it("carries each credited work's title, author and use line, and credits no work that no longer ships", () => {
    const en = JSON.parse(readFileSync(`${ROOT}packages/app/src/i18n/en.json`, 'utf8')) as Record<string, string>;
    for (const a of CREDITS.assets) expect(en[a.useKey], a.useKey).toBeTruthy();
    // PA-29 (the lead's ruling, audit L4): the Namer credit (Mutte, CC BY 3.0)
    // was for sprite sheets deleted in A3.3; the Namer is a Meshy model now.
    // It must not come back by accident, in the data or in the catalogue.
    expect(CREDITS.assets.some((a) => /Mutte|BlendSwap|IFV DMM08/i.test(`${a.author} ${a.source} ${a.title}`))).toBe(false);
    for (const [key, text] of Object.entries(en)) {
      if (key.startsWith('credits.')) expect(text, key).not.toMatch(/sprite sheet|NAMER_|Mutte|since replaced/i);
    }
    expect(Object.keys(en)).not.toContain('credits.asset.namer.use');
  });
  it('discloses the AI-generated audio by name, through the catalogue, and keeps the placeholder voices out of a commercial release (AU-10)', () => {
    const en = JSON.parse(readFileSync(`${ROOT}packages/app/src/i18n/en.json`, 'utf8')) as Record<string, string>;
    const keys: readonly string[] = CREDITS.aiDisclosure;
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(en[k], k).toBeTruthy();
    const text = keys.map((k) => en[k]).join(' ');
    // The music: the theme is generated, and the mission beds are cut from it (#493).
    expect(text).toMatch(/Meshy/);
    expect(text).toMatch(/theme/i);
    expect(text).toMatch(/cut from it/i);
    // The voices: who made them, and that a commercial build leaves them out (D5, A3).
    expect(text).toMatch(/ElevenLabs/);
    expect(text).toMatch(/commercial/i);
    // ...and the lines the lead recorded himself (9 Oct 2026) are said to be his.
    expect(text).toMatch(/recorded by Ilan Pinto/);
    // The cues and effects: made in code, no model -- so the class is bounded.
    expect(text).toMatch(/made in code, with no generative model/i);
    // The art gates it used to cite were retired with validate:assets (#374).
    expect(text).not.toMatch(/four art gates/i);
  });
  it('states the licences the repository states', () => {
    const licence = readFileSync(`${ROOT}LICENSE`, 'utf8');
    expect(licence.startsWith('# PolyForm Noncommercial License 1.0.0')).toBe(true);
    expect(CREDITS.codeLicence).toContain('PolyForm Noncommercial 1.0.0');
    expect(licence).toContain('Required Notice: Copyright Ilan Pinto');
    expect(licence).toContain('CLA.md');
    expect(licence).toContain(CREDITS.artLicence);
  });
});
