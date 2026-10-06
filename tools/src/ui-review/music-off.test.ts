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

describe('every browser a tool opens starts with music off', () => {
  const root = join(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });
  const tools = files(root).filter((f) => !f.endsWith('music-off.ts'));

  it('every write of the key goes through music-off.ts', () => {
    const offenders = tools
      .filter((f) => /setItem\(\s*['"`]lions\.settings['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  // A creator is a browser.newPage()/browser.newContext() call. It passes when
  // musicOffInitScript( follows within SEED_WINDOW lines (the seed goes on
  // right after, before the page navigates), or the call is marked
  // `music-off: exempt -- <why>` (a probe that is not the game), or its file
  // seeds every context at one wrapper, marked `music-off: every context`.
  const SEED_WINDOW = 25;
  const CREATOR = /\bbrowser!?\.(newPage|newContext)\(/;
  const LAUNCHER = /chromium\.launch\(|launchCaptureBrowser\(\)/;

  it('every page or context creator seeds music off, or says why not', () => {
    const offenders: string[] = [];
    for (const f of tools) {
      const lines = readFileSync(f, 'utf8').split('\n');
      const everyContext = lines.some((l) => l.includes('music-off: every context'));
      lines.forEach((l, i) => {
        if (!CREATOR.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
        const seeded = lines.slice(i, i + SEED_WINDOW).some((x) => x.includes('musicOffInitScript('));
        const exempt = lines.slice(Math.max(0, i - 3), i + 1).some((x) => x.includes('music-off: exempt'));
        if (!seeded && !exempt && !everyContext) offenders.push(`${relative(root, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every file that launches a browser imports the helper or is wholly exempt', () => {
    const offenders = tools
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        // golden-diff/browser.ts DEFINES the launcher; its callers are checked above.
        return LAUNCHER.test(code) && !f.endsWith('golden-diff/browser.ts') && !src.includes('musicOffInitScript(') && !src.includes('music-off: exempt');
      })
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('the seed changes nothing the page draws: parsed, it equals the defaults but for audio.music', () => {
    // main.ts reads settings only for the video/quality/accessibility/language
    // hooks and the audio gains; music is read by audio.ts alone. So a frame
    // (the golden gate included) is identical when parse(seed) and parse(null)
    // agree everywhere except audio.music.
    const seeded = parseSettings(musicOffJson());
    const bare = parseSettings(null);
    expect({ ...seeded, audio: { ...seeded.audio, music: 1 } }).toEqual(bare);
    expect(seeded.audio.music).not.toBe(bare.audio.music);
  });
});
