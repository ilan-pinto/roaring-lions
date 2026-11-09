// A0-2 (GH-1075): the coin rules have ONE copy, in @lions/economy. The app and the Worker re-export or import
// them; a second declaration would let the server and the client price or pay differently.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const PATTERNS: readonly RegExp[] = [
  /export const EARN\s*=/,
  /\bwelcome:\s*100\b/,
  /function coinPrice\b/,
  /CREDITS_PER_COIN\s*=/,
  /function roarBackfill\b/,
];

describe('A0-2: one copy of the earn table and the Stores prices', () => {
  const files = [...walk(join(ROOT, 'packages/app/src')), ...walk(join(ROOT, 'packages/worker/src'))];

  it('walks a real tree (the scan cannot pass by finding no files)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no app or worker source declares them', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of PATTERNS) if (re.test(text)) hits.push(`${f.slice(ROOT.length + 1)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it('the economy package holds them', () => {
    const earn = readFileSync(join(ROOT, 'packages/economy/src/earn.ts'), 'utf8');
    const stores = readFileSync(join(ROOT, 'packages/economy/src/stores.ts'), 'utf8');
    expect(earn).toMatch(PATTERNS[0] as RegExp);
    expect(earn).toMatch(PATTERNS[1] as RegExp);
    expect(earn).toMatch(PATTERNS[4] as RegExp);
    expect(stores).toMatch(PATTERNS[2] as RegExp);
    expect(stores).toMatch(PATTERNS[3] as RegExp);
  });
});
