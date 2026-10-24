import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

  // GH-782: audio.ts reaches the support voices, the plan maths and the two
  // constants files under it. Every one of them is served type-stripped to the
  // stub page, so each must survive node's strip-only mode and import only what
  // the map serves. Loaded for real here (no browser): a module the page could
  // not fetch, or a TS-only construct the strip cannot erase, fails in node.
  it('serves the whole support graph: every module strips, resolves its imports and loads', async () => {
    const files: Record<string, string> = {
      'audio.js': 'audio.ts',
      'radio.js': 'radio.ts',
      'relation.js': 'relation.ts',
      'engines.js': 'engines.ts',
      'support-voices.js': 'support-voices.ts',
      'support-air.js': 'three/support-air.ts',
      'project.js': 'project.ts',
      'frame-state.js': 'three/units/frame-state.ts',
    };
    const dir = mkdtempSync(join(tmpdir(), 'mix-graph-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      for (const [served, src] of Object.entries(files)) {
        const js = rewriteAudioImports(stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/render/src', src), 'utf8')));
        for (const spec of specifiers(js)) expect([...Object.keys(files), 'sim.js'], `${src} imports ${spec}`).toContain(spec.replace('./', ''));
        writeFileSync(join(dir, served), js);
      }
      writeFileSync(
        join(dir, 'sim.js'),
        'export const WEAPON_CLASS = {}; export const FS_AIR_STRIKE = 0; export const FS_MORTAR_BARRAGE = 1; ' +
          'export const FIRE_SUPPORT = [{rounds:1,spacingTicks:0,delayTicks:60},{rounds:6,spacingTicks:36,delayTicks:120},{}];',
      );
      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'audio.js')).href)) as { BattleAudio: unknown; AUDIO_SUPPORT_PROFILES: Record<string, number> };
      expect(typeof mod.BattleAudio).toBe('function');
      expect(mod.AUDIO_SUPPORT_PROFILES).toEqual({ air_strike: 0, mortar_barrage: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
