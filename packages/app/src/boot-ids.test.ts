// Security review #559, F5: a boot id read from the URL (`?mission=`,
// `?sandbox=`) is looked up in a plain object, so `constructor` or `__proto__`
// found an inherited member and crashed the boot. `main.ts` is not importable
// under test (it boots the world), so this reads its source -- the same
// compromise `retired-keys` style specs make -- and fails if either lookup
// goes back to an inherited-key form.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');
// B6-6: the lookups are against the synchronous manifest, and a sandbox map id goes through `isMapId`, whose own-key test
// lives in `@lions/data/content-lazy`.
const lazy = readFileSync(resolve(__dirname, '../../data/src/content-lazy.ts'), 'utf8');

describe('boot id lookups use own keys only (#559 F5)', () => {
  it('never asks `in maps` about the sandbox id', () => {
    expect(main).not.toMatch(/sandboxMap\s+in\s+(maps|mapManifest)/);
  });
  it('guards the mission lookup with Object.hasOwn', () => {
    expect(main).toMatch(/Object\.hasOwn\(missionManifest,\s*missionId\)/);
  });
  it('guards both sandbox map lookups with Object.hasOwn (through isMapId)', () => {
    expect(main.match(/isMapId\(sandboxMap\)/g)?.length).toBe(2);
    expect(lazy).toMatch(/export function isMapId\(id: string\): id is MapId \{\s*return Object\.hasOwn\(mapManifest, id\);\s*\}/);
  });
});
