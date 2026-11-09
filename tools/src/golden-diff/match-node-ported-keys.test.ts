/**
 * GH-943 P2 (T1): `censusUnported`'s `portedKeys` option is passed by `matchNodeStatements` (the legacy-matched arm, on the LEGACY
 * scene) and by NOTHING else. The node backend's own census must never pass it: on node an un-adopted legacy material is hidden and
 * named whatever list it is on, so an adoption bug stays loud. A source test, because the matched call runs in a browser page.
 *
 * Falsify: pass `{ portedKeys: PORTED_MATERIAL_KEYS }` from `node-backend.ts`'s `runCensus`; the first spec goes red naming it.
 *
 * GH-943 P3 (T1), G7, extended to the segment-wise key: `censusKey` (the per-segment key the exemption reads) is called by the
 * census module alone, so no second caller can derive a key the exemption would match differently; and the node backend's backstop
 * (`censusUnadopted`) is the node backend's alone and never exempts. Falsify: the same `portedKeys` line in `node-backend.ts`
 * turns the last spec red too; a `censusKey(` call in any other production file turns the fourth red.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchNodeCensusScript, matchNodeStatements } from './capture-protocol';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.superpowers', 'assets', 'art', 'data', 'docs']);

/** Every production source file (`.ts`/`.mjs`, no specs, no build output) under `packages/` and `tools/`. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('dist')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

interface Call {
  readonly file: string;
  readonly args: string;
}

/** The argument text of every `censusUnported(...)` CALL (not the declaration), comments stripped first. */
function calls(): Call[] {
  const out: Call[] = [];
  for (const file of [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'tools'))]) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/(function\s+)?censusUnported\s*\(/g)) {
      if (m[1] !== undefined) continue;
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      out.push({ file: path.relative(REPO, file), args: src.slice(start, i - 1).trim() });
    }
  }
  return out;
}

describe('the ported-key option has exactly one caller', () => {
  it('only matchNodeStatements passes a second argument to censusUnported; every other caller passes the root alone', () => {
    const all = calls();
    // Non-vacuous: the node backend's own census and the matched arm are both found.
    expect(all.some((c) => c.file === 'packages/render/src/three/backend/node-backend.ts')).toBe(true);
    expect(all.some((c) => c.file === 'tools/src/golden-diff/capture-protocol.ts')).toBe(true);
    const withOption = all.filter((c) => c.args.includes(',') || /portedKeys/.test(c.args));
    expect(withOption.map((c) => c.file)).toEqual(['tools/src/golden-diff/capture-protocol.ts']);
    expect(withOption[0]?.args).toBe('_r.scene, { portedKeys: _u.PORTED_MATERIAL_KEYS }');
  });

  it('no production file but the census itself and the matched arm reads PORTED_MATERIAL_KEYS', () => {
    const readers = [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'tools'))]
      .filter((f) => readFileSync(f, 'utf8').includes('PORTED_MATERIAL_KEYS'))
      .map((f) => path.relative(REPO, f))
      .sort();
    expect(readers).toEqual(['packages/render/src/three/backend/unported.ts', 'tools/src/golden-diff/capture-protocol.ts']);
  });

  it('the matched statement the page evaluates carries the option', () => {
    expect(matchNodeStatements('/repo')).toContain('_u.censusUnported(_r.scene, { portedKeys: _u.PORTED_MATERIAL_KEYS })');
  });

  it('the P2 sheet\'s census script is the same statement, returning the list and not repainting', () => {
    const script = matchNodeCensusScript('/repo');
    expect(script).toContain('_u.censusUnported(_r.scene, { portedKeys: _u.PORTED_MATERIAL_KEYS })');
    expect(script).toContain('return JSON.stringify(_found);');
    expect(script).not.toContain('_r.frame(');
  });
});

/** Every production `name(` CALL site (comments stripped; the declaration excluded), by file. */
function callers(name: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`(function\\s+)?\\b${name}\\s*\\(`, 'g');
  for (const file of [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'tools'))]) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(re)) if (m[1] === undefined) out.add(path.relative(REPO, file));
  }
  return [...out].sort();
}

describe('GH-943 P3 (T1), G7: the segment-wise key has one owner, and the node census never exempts', () => {
  it('censusKey is called only inside the census module', () => {
    expect(callers('censusKey')).toEqual(['packages/render/src/three/backend/unported.ts']);
  });

  it('the unadopted backstop is the node backend\'s alone, and the node backend source names no ported key', () => {
    expect(callers('censusUnadopted')).toEqual(['packages/render/src/three/backend/node-backend.ts']);
    const nb = readFileSync(path.join(REPO, 'packages/render/src/three/backend/node-backend.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(nb).not.toMatch(/portedKeys|PORTED_MATERIAL_KEYS/);
  });
});
