import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings, DEFAULT_SETTINGS } from '../../../packages/app/src/settings';
import { SILENT_AUDIO, musicOffInitScript, musicOffJson, musicOffSettings } from './music-off';

/** Run an init script against a one-key fake store and hand back what it wrote. */
function runInitScript(script: string): Map<string, string> {
  const map = new Map<string, string>();
  const localStorage = { setItem: (k: string, v: string) => void map.set(k, v) };
  new Function('localStorage', script)(localStorage);
  return map;
}

describe('music-off settings seed', () => {
  it('survives the real parser with music at 0', () => {
    expect(parseSettings(musicOffJson()).audio.music).toBe(0);
    // The default really is audible -- otherwise the assertion above proves nothing.
    expect(DEFAULT_SETTINGS.audio.music).toBeGreaterThan(0);
  });

  it('is accepted whole, not replaced by defaults', () => {
    // A rejected seed comes back as the defaults, which carry quality 'high';
    // a distinctive neighbour field proves the object itself was read.
    const s = parseSettings(JSON.stringify({ ...musicOffSettings(), video: { ...DEFAULT_SETTINGS.video, quality: 'low' } }));
    expect(s.video.quality).toBe('low');
    expect(s.audio.music).toBe(0);
  });

  it('keeps music at 0 even when an override asks otherwise', () => {
    expect(parseSettings(musicOffJson({ music: 1 })).audio.music).toBe(0);
  });

  it('SILENT_AUDIO silences every channel through the real parser', () => {
    expect(parseSettings(musicOffJson(SILENT_AUDIO)).audio).toEqual({ master: 1, music: 0, sfx: 0, voice: 0, radio: false });
  });

  it('the init script writes the same value under the key the app reads', () => {
    const written = runInitScript(musicOffInitScript());
    expect([...written.keys()]).toEqual(['lions.settings']);
    expect(parseSettings(written.get('lions.settings') ?? null).audio.music).toBe(0);
  });

  it('the init script swallows a blocked store', () => {
    const blocked = { setItem: () => { throw new Error('SecurityError'); } };
    expect(() => new Function('localStorage', musicOffInitScript())(blocked)).not.toThrow();
  });

  it('a seed without `version` is rejected by the parser (why the old tools failed)', () => {
    const noVersion: Record<string, unknown> = { ...musicOffSettings() };
    delete noVersion.version;
    expect(parseSettings(JSON.stringify(noVersion)).audio.music).toBe(1);
  });
});

describe('no tool seeds lions.settings by hand', () => {
  const root = join(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });

  it('every write of the key goes through music-off.ts', () => {
    const offenders = files(root)
      .filter((f) => !f.endsWith('music-off.ts'))
      .filter((f) => /setItem\(\s*['"`]lions\.settings['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
