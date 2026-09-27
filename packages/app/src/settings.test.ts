// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, applySettings, loadSettings, parseSettings, saveSettings, settingsBus } from './settings';

function memStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('parseSettings', () => {
  it('returns the defaults for nothing, garbage, and the wrong shape', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"version":99}')).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps every valid field and replaces each invalid one with its default, never the whole object', () => {
    const s = parseSettings(JSON.stringify({
      version: 1,
      video: { fullscreen: true, uiScale: 7, textSize: 1.15, quality: 'ultra' },
      audio: { master: 0.5, music: 2, sfx: 'loud' },
      accessibility: { motion: 'reduce', colorVision: 'nope' },
      // Task 9: `language` is now validated against `LOCALES` (only `en`
      // ships today) rather than a bare BCP-47-shaped regex, so 'he' -- a
      // syntactically valid tag nobody has shipped a catalogue for -- is
      // exactly as invalid here as 'nope' is for colorVision above.
      language: 'en',
      extra: 'dropped',
    }));
    expect(s.video).toEqual({ fullscreen: true, uiScale: 'auto', textSize: 1.15, quality: 'high' });
    expect(s.audio).toEqual({ master: 0.5, music: 1, sfx: 1, voice: 1 });
    expect(s.accessibility).toEqual({ motion: 'reduce', colorVision: 'default', captions: false });
    expect(s.language).toBe('en');
    expect('extra' in s).toBe(false);
  });
  it('round-trips through save and load', () => {
    const store = memStore();
    const s = { ...DEFAULT_SETTINGS, audio: { master: 0.3, music: 0.2, sfx: 0.1, voice: 0.4 } };
    saveSettings(store, s);
    expect(store.map.get(SETTINGS_KEY)).toBe(JSON.stringify(s));
    expect(loadSettings(store)).toEqual(s);
  });
  it('survives a store that throws or is absent', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(bad, DEFAULT_SETTINGS)).not.toThrow();
  });
  it('controls carries edgePan and zoomToCursor, with tolerant parsing', () => {
    expect(DEFAULT_SETTINGS.controls.edgePan).toBe(false);
    expect(DEFAULT_SETTINGS.controls.zoomToCursor).toBe(true);
    const s = parseSettings(JSON.stringify({ version: 1, controls: { edgePan: 'yes', zoomToCursor: false } }));
    expect(s.controls.edgePan).toBe(false);      // a bad value falls back, field by field
    expect(s.controls.zoomToCursor).toBe(false);
    expect(s.controls.cameraSpeed).toBe(1);      // and its neighbour survives
  });
  it('audio carries a voice level, default 1, parsed field by field like its neighbours (N11)', () => {
    expect(DEFAULT_SETTINGS.audio.voice).toBe(1);
    // A save from before voices keeps its three levels and gains the fourth.
    expect(parseSettings(JSON.stringify({ version: 1, audio: { master: 0.5, music: 0.2, sfx: 0.3 } })).audio).toEqual({
      master: 0.5, music: 0.2, sfx: 0.3, voice: 1,
    });
    expect(parseSettings(JSON.stringify({ version: 1, audio: { voice: 0 } })).audio.voice).toBe(0);
    expect(parseSettings(JSON.stringify({ version: 1, audio: { voice: 1.5, sfx: 0.4 } })).audio).toEqual({
      master: 1, music: 1, sfx: 0.4, voice: 1,
    });
  });
  it('captions are off by default, and a bad value reads as off (D8)', () => {
    expect(DEFAULT_SETTINGS.accessibility.captions).toBe(false);
    expect(parseSettings(JSON.stringify({ version: 1, accessibility: { captions: true } })).accessibility.captions).toBe(true);
    expect(parseSettings(JSON.stringify({ version: 1, accessibility: { captions: 'yes', motion: 'reduce' } })).accessibility).toEqual({
      motion: 'reduce', colorVision: 'default', captions: false,
    });
  });
});

describe('applySettings', () => {
  it('writes the scale tokens inline only when they differ from auto, and the data attributes always', () => {
    const root = document.createElement('div');
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('');
    expect(root.style.getPropertyValue('--text-size')).toBe('1');
    expect(root.dataset.motion).toBe('system');
    expect(root.dataset.cvd).toBe('default');
    applySettings({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, uiScale: 1.4, textSize: 1.3 }, accessibility: { motion: 'reduce', colorVision: 'tritanopia', captions: false } }, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.4');
    expect(root.style.getPropertyValue('--text-size')).toBe('1.3');
    expect(root.dataset.motion).toBe('reduce');
    expect(root.dataset.cvd).toBe('tritanopia');
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('');
  });
});

describe('settingsBus', () => {
  it('fires a subscribed listener after notify', () => {
    const bus = settingsBus();
    const seen: unknown[] = [];
    bus.onChange((s) => seen.push(s));
    bus.notify(DEFAULT_SETTINGS);
    expect(seen).toEqual([DEFAULT_SETTINGS]);
  });
  it('a throwing listener does not stop a later one, and the error is logged', () => {
    const bus = settingsBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let secondRan = false;
    bus.onChange(() => {
      throw new Error('boom');
    });
    bus.onChange(() => {
      secondRan = true;
    });
    bus.notify(DEFAULT_SETTINGS);
    expect(secondRan).toBe(true);
    expect(spy).toHaveBeenCalledWith('settings listener:', expect.any(Error));
    spy.mockRestore();
  });
  it('the disposer unsubscribes', () => {
    const bus = settingsBus();
    let calls = 0;
    const off = bus.onChange(() => {
      calls++;
    });
    bus.notify(DEFAULT_SETTINGS);
    off();
    bus.notify(DEFAULT_SETTINGS);
    expect(calls).toBe(1);
  });
});
