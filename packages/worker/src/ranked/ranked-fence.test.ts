/** GH-1399 Q19: ranked opens to players only after the relay cut, so nothing in K1 may be reachable from a route. This walks
 *  every source file outside `packages/worker/src/ranked/` (the Worker's own tree, whose entry is `index.ts`, and every other
 *  package and tool) and refuses any import, re-export or dynamic import whose specifier names `ranked/` or `glicko2`.
 *  When a later slice wires ranked in, it changes this test on purpose, in the PR the lead reads. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const RANKED_DIR = join(REPO, 'packages/worker/src/ranked');
const ROOTS = ['packages', 'tools/src'];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('dist') || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (p === RANKED_DIR) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g;
const NAMES_RANKED = (spec: string): boolean => /(^|\/)ranked(\/|$)/.test(spec) || spec.includes('glicko2');

function rankedImports(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? '').filter(NAMES_RANKED);
}

describe('ranked K1 is unreachable (Q19)', () => {
  it('the matcher sees every import form (a specimen of each)', () => {
    expect(rankedImports(`import { rateGame } from './ranked/glicko2';`)).toEqual(['./ranked/glicko2']);
    expect(rankedImports(`export * from "../ranked/glicko2.ts";`)).toEqual(['../ranked/glicko2.ts']);
    expect(rankedImports(`const m = await import('../ranked');`)).toEqual(['../ranked']);
    expect(rankedImports(`import './ranked/glicko2';`)).toEqual(['./ranked/glicko2']);
    expect(rankedImports(`import { x } from './match/room-core';`)).toEqual([]);
  });

  it('no file outside packages/worker/src/ranked/ imports it', () => {
    const files = ROOTS.flatMap((r) => walk(join(REPO, r), []));
    const rel = files.map((f) => relative(REPO, f));
    // Not vacuous: the walk reached the Worker's entry, its match routes and its account routes.
    expect(rel).toContain('packages/worker/src/index.ts');
    expect(rel).toContain('packages/worker/src/match/routes.ts');
    expect(rel).toContain('packages/worker/src/account/routes.ts');
    expect(files.length).toBeGreaterThan(500);
    const hits = files.flatMap((f) => rankedImports(readFileSync(f, 'utf8')).map((s) => `${relative(REPO, f)}: ${s}`));
    expect(hits).toEqual([]);
  });
});
