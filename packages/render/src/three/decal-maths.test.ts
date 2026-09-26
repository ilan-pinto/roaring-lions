/**
 * F-27: `decal-maths.ts` is the three-free half of the shared decal pool.
 * That is tidiness, not a requirement -- `three` loads under node, and tools
 * resolves it -- but it keeps the pure maths apart from the GPU code, and a
 * boundary nobody checks does not stay put. The behavioural tests for every export here already live
 * in `decal-pool.test.ts` (which imports them through `decal-pool.ts`'s own
 * re-export); this file only pins the import boundary itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('decal-maths.ts stays three-free', () => {
  it('imports nothing from three', () => {
    const path = fileURLToPath(new URL('./decal-maths.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/['"]three['"]/);
      expect(line.toLowerCase()).not.toContain('three');
    }
  });
});
