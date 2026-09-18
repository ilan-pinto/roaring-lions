// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { LOCALES } from '../i18n/locales';
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
      locales: LOCALES,
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
    expect(el.textContent).toContain('Applies when the next mission starts');
  });

  // I6 (final review): the control column was `auto`, so a `<select>`'s
  // intrinsic width is its longest OPTION -- "High \u2014 everything, 4K shadows"
  // squeezed "Render quality" onto two lines in English at 1920 and, under the
  // pseudo-locale, drew the select straight over the first line of its own
  // label. Half the fix is CSS (theme.css, and only a capture can judge it);
  // the half a test CAN hold is that the option text is now the preset name and
  // the description lives in the row's hint, where it wraps instead of pushing.
  it('the quality options are bare preset names, with the descriptions in the row hint', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    const sel = el.querySelector<HTMLSelectElement>('select[name="quality"]');
    if (!sel) throw new Error('no quality control');
    const labels = [...sel.options].map((o) => o.textContent ?? '');
    expect(labels).toEqual(['Low', 'Medium', 'High']);
    // The binding constraint, stated as the thing it is: no option may be long
    // enough to dictate the column's width again. The longest name here is
    // "Medium" at 6; under the pseudo-locale's ~40% padding plus its brackets
    // that is still comfortably inside a control column the label can survive.
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(12);
    const hint = [...el.querySelectorAll('.rl-settings__row')]
      .find((r) => r.querySelector('select[name="quality"]'))
      ?.querySelector('.rl-settings__hint')?.textContent;
    expect(hint).toContain('4K shadows');
    expect(hint).toContain('no ambient occlusion');
  });

  // Minor 14: the row id used to fall back to `Math.random()`, which was dead
  // (every control sets a `name`) and made the label/control pairing
  // unassertable. The type requires the name now; this pins the consequence.
  it('every row label points at its own named control, with a stable id', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    const rows = [...el.querySelectorAll('.rl-settings__row')];
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      const label = r.querySelector('label');
      const control = r.querySelector<HTMLElement>('select, input');
      if (!label || !control) continue;
      expect(control.id).toBe(`set-${control.getAttribute('name') ?? ''}`);
      expect(label.getAttribute('for')).toBe(control.id);
    }
  });

  // Minor 1: the fullscreen checkbox was painted once from `fs.active()` and
  // never again, so F11 or Escape -- neither of which goes through `deps.set`
  // -- left it ticked over a window that was no longer fullscreen. It listens
  // to the browser's own `fullscreenchange` now, and stops when the panel does.
  it('repaints the fullscreen checkbox when the browser leaves fullscreen behind its back, and unsubscribes on dispose', () => {
    let active = true;
    const { d } = deps({
      fullscreen: { supported: () => true, active: () => active, set: async () => {} },
    });
    const { el, dispose } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="fullscreen"]');
    if (!cb) throw new Error('no fullscreen control');
    expect(cb.checked).toBe(true);

    active = false;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(cb.checked).toBe(false);

    dispose();
    active = true;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(cb.checked).toBe(false); // the listener is gone, not merely idle
  });
  it('reverts the fullscreen checkbox and does not persist when the browser refuses', async () => {
    const fsSet = vi.fn((): Promise<void> => Promise.reject(new Error('denied')));
    const { d, set } = deps({
      fullscreen: { supported: () => true, active: () => false, set: fsSet },
    });
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="fullscreen"]');
    if (!cb) throw new Error('no fullscreen control');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(fsSet).toHaveBeenCalledWith(true);
    expect(cb.checked).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
  it('persists fullscreen once the browser grants it', async () => {
    let active = false;
    const fsSet = vi.fn((on: boolean): Promise<void> => {
      active = on;
      return Promise.resolve();
    });
    const { d, set } = deps({
      fullscreen: { supported: () => true, active: () => active, set: fsSet },
    });
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="fullscreen"]');
    if (!cb) throw new Error('no fullscreen control');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].video.fullscreen).toBe(true);
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
