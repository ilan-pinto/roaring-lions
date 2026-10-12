import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIO_IMPORT_MAP, rewriteAudioImports } from './mix-modules';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const audioSrc = (): string => stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/render/src/audio.ts'), 'utf8'));

/** Every module specifier left in a piece of JS, as the browser would resolve it. */
function specifiers(js: string): string[] {
  return [...js.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\1/g)].map((m) => m[2] ?? '');
}

describe('the mix check module graph', () => {
  it('rewrites every import of the real audio.ts to a served path', () => {
    const out = rewriteAudioImports(audioSrc());
    const left = specifiers(out);
    expect(left.length).toBeGreaterThan(0);
    for (const spec of left) expect(Object.values(AUDIO_IMPORT_MAP)).toContain(spec);
    expect(left).toContain('./relation.js');
  });

  it('throws naming an import it has no path for', () => {
    expect(() => rewriteAudioImports(`${audioSrc()}\nexport { x } from './nope';\n`)).toThrow(/'\.\/nope'/);
  });

  it('throws on a bare side-effect import too', () => {
    expect(() => rewriteAudioImports(`import './side-effect';\n`)).toThrow(/'\.\/side-effect'/);
  });
});
