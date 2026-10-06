// The lead's standing rule: every test server and browser starts with MUSIC
// OFF (`lions.settings` -> `audio.music = 0`). This is the ONE place a capture
// or test tool builds that seed.
//
// Why a helper and not a literal in each tool: `parseSettings`
// (`packages/app/src/settings.ts`) throws away any object whose `version` is
// not exactly 1 and returns the defaults, so `{ audio: { music: 0 } }` -- which
// three tools wrote -- was a no-op and the music played. The object is built
// here FROM `DEFAULT_SETTINGS`, so it carries whatever `version` the parser
// currently demands, and `music-off.test.ts` feeds it to the real parser.
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '../../../packages/app/src/settings';

/** The seeded settings: every default, music at 0. `audio` overrides merge
 *  over the audio defaults (a capture that wants ALL sound off passes
 *  `SILENT_AUDIO`); `music` is forced to 0 whatever they say. */
export function musicOffSettings(audio: Partial<Settings['audio']> = {}): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.audio = { ...s.audio, ...audio, music: 0 };
  return s;
}

/** Every channel silent, for captures that must also have no SFX or radio. */
export const SILENT_AUDIO: Partial<Settings['audio']> = { master: 1, sfx: 0, voice: 0, radio: false };

/** The serialised value, as `localStorage` holds it. */
export function musicOffJson(audio: Partial<Settings['audio']> = {}): string {
  return JSON.stringify(musicOffSettings(audio));
}

/** A script for Playwright's `addInitScript(string)` (page or context): runs
 *  before any page script, and a blocked store leaves the page booting with
 *  its defaults instead of throwing. */
export function musicOffInitScript(audio: Partial<Settings['audio']> = {}): string {
  return `try { localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, ${JSON.stringify(musicOffJson(audio))}); } catch (e) {}`;
}
