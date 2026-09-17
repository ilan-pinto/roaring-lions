// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { settingsPanel, showSettings } from './settings-panel';

function deps(overrides: Partial<Parameters<typeof settingsPanel>[1]> = {}) {
  let s: Settings = structuredClone(DEFAULT_SETTINGS);
  const set = vi.fn((next: Settings) => { s = next; });
  const gains = vi.fn();
  return {
    d: {
      get: () => s,
      set,
      fullscreen: null,
      audio: { setGains: gains },
      locales: [{ id: 'en', name: 'English' }],
      keymap: null,
      build: '0.68.0',
      onChange: () => () => {},
      ...overrides,
    },
    set,
    gains,
  };
}

describe('settingsPanel', () => {
  it('renders one table with the four sections and the build id', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    const heads = [...el.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Video', 'Audio', 'Accessibility', 'Language']);
    expect(el.textContent).toContain('0.68.0');
  });
  it('changing the UI scale persists through set() and applies at once', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const sel = el.querySelector<HTMLSelectElement>('select[name="uiScale"]');
    if (!sel) throw new Error('no uiScale control');
    sel.value = '1.4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].video.uiScale).toBe(1.4);
  });
  it('an audio slider reaches the mixer while it is dragged and persists on release', () => {
    const { d, set, gains } = deps();
    const { el } = settingsPanel(document.body, d);
    const r = el.querySelector<HTMLInputElement>('input[name="music"]');
    if (!r) throw new Error('no music slider');
    r.value = '0.25';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains).toHaveBeenCalledWith({ master: 1, music: 0.25, sfx: 1 });
    expect(set).not.toHaveBeenCalled();
    r.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
  });
  it('hides the fullscreen row when the browser cannot do it, and shows the quality note', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    expect(el.querySelector('input[name="fullscreen"]')).toBeNull();
    expect(el.textContent).toContain('applies when the next mission starts');
  });
  it('showSettings mounts on the stage with a back link and its disposer empties the stage', () => {
    const { d } = deps();
    const stage = document.createElement('div');
    const off = showSettings(stage, { ...d, back: '/' });
    expect(stage.querySelector('a[href="/"]')).not.toBeNull();
    off();
    expect(stage.children.length).toBe(0);
  });
});
