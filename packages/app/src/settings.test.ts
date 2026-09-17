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
      language: 'he',
      extra: 'dropped',
    }));
    expect(s.video).toEqual({ fullscreen: true, uiScale: 'auto', textSize: 1.15, quality: 'high' });
    expect(s.audio).toEqual({ master: 0.5, music: 1, sfx: 1 });
    expect(s.accessibility).toEqual({ motion: 'reduce', colorVision: 'default' });
    expect(s.language).toBe('he');
    expect('extra' in s).toBe(false);
  });
  it('round-trips through save and load', () => {
    const store = memStore();
    const s = { ...DEFAULT_SETTINGS, audio: { master: 0.3, music: 0.2, sfx: 0.1 } };
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
});

describe('applySettings', () => {
  it('writes the scale tokens inline only when they differ from auto, and the data attributes always', () => {
    const root = document.createElement('div');
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('');
    expect(root.style.getPropertyValue('--text-size')).toBe('1');
    expect(root.dataset.motion).toBe('system');
    expect(root.dataset.cvd).toBe('default');
    applySettings({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, uiScale: 1.4, textSize: 1.3 }, accessibility: { motion: 'reduce', colorVision: 'tritanopia' } }, root);
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
