// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { LOCALES } from '../i18n/locales';
import { setCatalogue, t } from '../i18n/t';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { bindingsFrom } from '../input/keymap';
import { settingsPanel, showSettings } from './settings-panel';
import { keymapRows } from './settings-keymap';

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
      commit: '0123456789abcdef0123456789abcdef01234567',
      onChange: () => () => {},
      ...overrides,
    },
    set,
    gains,
  };
}

describe('settingsPanel', () => {
  it('draws its back link with the GH-261 arrow, words beside it', () => {
    const { d } = deps();
    const stage = document.createElement('div');
    showSettings(stage, { ...d, back: '/' });
    const back = stage.querySelector('.rl-settings__back');
    expect(back?.querySelector('svg')?.getAttribute('data-symbol')).toBe('back');
    expect(back?.textContent?.trim()).toBe('Main menu');
  });

  // GH-498: the way back is the one footer row, the panel's own last child --
  // outside the body, sticky in the panel's scroller -- so it is on screen at
  // any window height instead of after the last setting. Falsified by hand:
  // appending the foot to the panel's body turns this red.
  it('keeps the way back in a sticky footer row outside the body', () => {
    const { d } = deps();
    const stage = document.createElement('div');
    showSettings(stage, { ...d, back: '/' });
    const panel = stage.querySelector('.rl-settings')!;
    const foot = panel.querySelector('.rl-foot')!;
    expect(panel.lastElementChild).toBe(foot);
    expect(foot.closest('.rl-panel__body')).toBeNull();
    expect(foot.classList.contains('rl-foot--sticky')).toBe(true);
    expect(foot.querySelector('.rl-foot__start')?.firstElementChild).toBe(stage.querySelector('[data-kind="back"]'));
  });

  it('renders one table with the five sections and the build id', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    // GH-1510: a section is a card of the account page now, titled by its strip.
    const heads = [...el.querySelectorAll('.rl-page-card__title')].map((h) => h.textContent);
    expect(heads).toEqual(['Video', 'Audio', 'Accessibility', 'Chat', 'Language']);
    expect(el.textContent).toContain('0.68.0');
  });
  // The foot names the build AND its short commit, so a `pnpm bot` checkout can
  // be matched to the room's build. Falsified by hand: a foot that prints only
  // `common.build` (no sha) turns the first two cases red.
  it('prints the build and the short commit in the foot', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    const foot = [...el.querySelectorAll('p.rl-settings__hint')].at(-1)?.textContent;
    expect(foot).toBe('Build 0.68.0 \u00b7 0123456');
    expect(foot).not.toContain('0123456789');
  });
  it('prints "dev" when the build carries no commit', () => {
    const { d } = deps({ commit: '' });
    const { el } = settingsPanel(document.body, d);
    expect(el.textContent).toContain('Build 0.68.0 \u00b7 dev');
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
    expect(gains).toHaveBeenCalledWith({ master: 1, music: 0.25, sfx: 1, voice: 1 });
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
  // `deps()` (settings-panel.test.ts:7) passes `keymap: null` by default and the
  // Controls section only renders when it is truthy (settings-panel.ts:324) --
  // so this test supplies a real one through the same `keymapRows` factory
  // `pause.test.ts` already imports. That also means the file's existing
  // "four sections" assertion is untouched: with `keymap: null` there is still
  // no Controls section at all.
  it('the Controls section offers both new toggles and writes them through set()', () => {
    const { d, set } = deps({ keymap: keymapRows({ bindings: () => bindingsFrom({}), set: () => {} }) });
    const { el } = settingsPanel(document.body, d);
    const edge = el.querySelector<HTMLInputElement>('input[name="edgePan"]');
    if (!edge) throw new Error('no edgePan control');
    expect(edge.type).toBe('checkbox');
    edge.checked = true;
    edge.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls.at(-1)?.[0].controls.edgePan).toBe(true);
    expect(el.querySelector('input[name="zoomToCursor"]')).not.toBeNull();
  });
  it('the Voices slider reaches the mixer while dragged and persists on release (WP-AU1 §7)', () => {
    const { d, set, gains } = deps();
    const { el } = settingsPanel(document.body, d);
    const r = el.querySelector<HTMLInputElement>('input[name="voice"]');
    if (!r) throw new Error('no voice slider');
    expect(el.textContent).toContain('Voices');
    r.value = '0';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains).toHaveBeenLastCalledWith({ master: 1, music: 1, sfx: 1, voice: 0 });
    expect(set).not.toHaveBeenCalled();
    r.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].audio.voice).toBe(0);
  });
  it('Radio effect sits in Audio, is on by default, persists off, and is not a gain (N17)', () => {
    const { d, set, gains } = deps();
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="radio"]');
    if (!cb) throw new Error('no radio box');
    expect(cb.type).toBe('checkbox');
    expect(cb.checked).toBe(true);
    expect(el.textContent).toContain('Radio effect');
    // Its row comes after the Voices slider and before Accessibility.
    const text = el.textContent ?? '';
    expect(text.indexOf('Voices')).toBeLessThan(text.indexOf('Radio effect'));
    expect(text.indexOf('Radio effect')).toBeLessThan(text.indexOf('Accessibility'));
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].audio.radio).toBe(false);
    expect(set.mock.calls[0][0].audio.voice).toBe(1);
    // Dragging a slider afterwards hands the mixer levels only.
    const r = el.querySelector<HTMLInputElement>('input[name="sfx"]');
    if (!r) throw new Error('no sfx slider');
    r.value = '0.5';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains).toHaveBeenLastCalledWith({ master: 1, music: 1, sfx: 0.5, voice: 1 });
  });
  it('Voice captions are ON by default (PA-23), persist on change, and say what they show (D8)', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="captions"]');
    if (!cb) throw new Error('no captions box');
    expect(cb.checked).toBe(true);
    expect(el.textContent).toContain('Voice captions');
    expect(el.textContent).toContain('in English');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].accessibility.captions).toBe(false);
  });
  it('Chat is ON by default (GH-1417 S1), has its own section, and turning it off goes through the one setter', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="chat"]');
    if (!cb) throw new Error('no chat box');
    expect(cb.checked).toBe(true);
    expect(el.textContent).toContain('Show chat from other players');
    expect(el.textContent).toContain('The other player is not told');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].chat.enabled).toBe(false);
  });
  it('the mask row is ON by default (GH-1417 S2), turning it off goes through the one setter, and nothing offers to turn the hide tier off', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="chatMask"]');
    if (!cb) throw new Error('no mask box');
    expect(cb.checked).toBe(true);
    expect(el.textContent).toContain('Mask swear words');
    expect(el.textContent).toContain('always hidden');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].chat.mask).toBe(false);
    expect(set.mock.calls[0][0].chat.enabled).toBe(true);
    expect(el.querySelectorAll('input[name^="chat"]').length).toBe(2);
  });
  describe('Replay intro', () => {
    it('draws no row when no intro ships (today): the panel is as it was', () => {
      const { d } = deps();
      const { el } = settingsPanel(document.body, d);
      expect(el.querySelector('button[name="replayIntro"]')).toBeNull();
      expect(el.textContent).not.toContain('Replay intro');
    });
    it('draws a Replay intro button that plays the intro, and disposing the panel takes the overlay down', () => {
      const overlayOff = vi.fn();
      const replay = vi.fn(() => overlayOff);
      const { d, set } = deps({ intro: { replay } });
      const { el, dispose } = settingsPanel(document.body, d);
      const btn = el.querySelector<HTMLButtonElement>('button[name="replayIntro"]');
      expect(btn?.textContent).toBe('Replay intro');
      expect(btn?.closest('.rl-settings__row')?.querySelector('label')?.textContent).toBe('Opening cinematic');
      btn?.click();
      expect(replay).toHaveBeenCalledTimes(1);
      // Replaying never writes a setting: the seen flag is not the panel's to move.
      expect(set).not.toHaveBeenCalled();
      expect(overlayOff).not.toHaveBeenCalled();
      dispose();
      expect(overlayOff).toHaveBeenCalledTimes(1);
    });
    it('a second press takes the first overlay down before mounting the next', () => {
      const offs = [vi.fn(), vi.fn()];
      let n = 0;
      const { d } = deps({ intro: { replay: () => offs[n++] } });
      const { el } = settingsPanel(document.body, d);
      const btn = el.querySelector<HTMLButtonElement>('button[name="replayIntro"]');
      btn?.click();
      btn?.click();
      expect(offs[0]).toHaveBeenCalledTimes(1);
      expect(offs[1]).not.toHaveBeenCalled();
    });
  });
  it('showSettings mounts on the stage with a back link and its disposer empties the stage', () => {
    const { d } = deps();
    const stage = document.createElement('div');
    const off = showSettings(stage, { ...d, back: '/' });
    expect(stage.querySelector('a[href="/"]')).not.toBeNull();
    off();
    expect(stage.children.length).toBe(0);
  });

  // GH-1410: the reports switch.
  it('has no Privacy section when the deps carry no reports switch', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    expect(el.querySelector('input[name="reports"]')).toBeNull();
    expect(el.textContent).not.toContain('Anonymous usage and crash reports');
  });

  it('shows the reports switch ON while reports are sent, OFF when the player opted out, and writes the choice through reports.set', () => {
    const set = vi.fn();
    let sending = true;
    const { d } = deps({ reports: { get: () => sending, set: (on: boolean) => { sending = on; set(on); } } });
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="reports"]');
    if (!cb) throw new Error('no reports control');
    expect(cb.type).toBe('checkbox');
    expect(cb.checked).toBe(true);
    expect(el.textContent).toContain('Anonymous usage and crash reports');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenLastCalledWith(false);
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenLastCalledWith(true);
  });

  it('a player who opted out sees the switch OFF', () => {
    const { d } = deps({ reports: { get: () => false, set: () => {} } });
    const { el } = settingsPanel(document.body, d);
    expect(el.querySelector<HTMLInputElement>('input[name="reports"]')?.checked).toBe(false);
  });

  it('the reports hint tells the truth the privacy review asked for: a tester label is sent, there is no "no name" claim, and Off means nothing is sent', () => {
    const { d } = deps({ reports: { get: () => true, set: () => {} } });
    const { el } = settingsPanel(document.body, d);
    const hint = el.querySelector('input[name="reports"]')?.closest('.rl-settings__row')?.querySelector('.rl-settings__hint')?.textContent ?? '';
    expect(hint).toContain('your tester label if you were given one');
    expect(hint).toContain('no email, IP address or browser user agent');
    expect(hint).toContain('Off, nothing is sent');
    expect(hint).not.toMatch(/no name/i);
  });
});


// ---- GH-1510: the account page's design --------------------------------------------------------------------------
// The screen follows `/profile` (GH-1075 P7): each section is one of the profile's cards (`page-card.ts`), the cards sit
// in the profile's wide and narrow columns, and Controls runs full width under both. Presentation only: every control,
// its name, its label and its write are what they were. Falsified by one-line mutations of settings-panel.ts (see the
// PR): Privacy moved to the wide column; Controls moved into the narrow one; a card title spelled without t(); a label's
// `for` dropped; Edge pan writing zoomToCursor; and, in page-card.ts, the title an h3. Each turned its case red, and
// each was put back by re-editing.
describe('the account page layout (GH-1510)', () => {
  afterEach(() => setCatalogue('en', en));

  /** Every optional row present: a fullscreen-capable browser, the key table, the reports switch, an intro, two locales. */
  const full = () =>
    deps({
      fullscreen: { supported: () => true, active: () => false, set: async () => {} },
      keymap: keymapRows({ bindings: () => bindingsFrom({}), set: () => {} }),
      reports: { get: () => true, set: () => {} },
      intro: { replay: () => () => {} },
      locales: [...LOCALES, { id: 'xx', name: 'Second', dir: 'ltr' }],
    });
  const keyOf = (card: Element): string => [...card.classList].find((c) => c.startsWith('rl-settings__card--'))?.slice('rl-settings__card--'.length) ?? '';
  const TITLE_KEY: Record<string, string> = {
    video: 'settings.video',
    audio: 'settings.audio',
    accessibility: 'settings.accessibility',
    privacy: 'settings.privacy',
    chat: 'settings.chat',
    language: 'settings.language',
    controls: 'settings.controls',
  };

  it('draws each section as a profile card in two columns, with Controls full width under both', () => {
    const { d } = full();
    const { el } = settingsPanel(document.body, d);
    const content = el.querySelector('.rl-panel__body > .rl-settings__content');
    if (!content) throw new Error('no content');
    const cols = content.querySelector(':scope > .rl-page-cols.rl-settings__cols');
    if (!cols) throw new Error('no columns');
    const keys = (sel: string): string[] => [...(cols.querySelector(sel)?.children ?? [])].map(keyOf);
    expect(keys(':scope > .rl-page-cols__col--main')).toEqual(['video', 'audio']);
    expect(keys(':scope > .rl-page-cols__col--side')).toEqual(['accessibility', 'privacy', 'chat', 'language']);
    expect([...content.children].map((c) => (c === cols ? 'cols' : keyOf(c)))).toEqual(['cols', 'controls']);
    // Every card is the profile's own: a <section>, its title strip an <h2> through t(), then the body with the rows.
    const cards = [...el.querySelectorAll('.rl-settings__card')];
    expect(cards.map(keyOf).sort()).toEqual(Object.keys(TITLE_KEY).sort());
    for (const c of cards) {
      expect(c.tagName).toBe('SECTION');
      expect(c.classList.contains('rl-page-card')).toBe(true);
      const [h, body] = [...c.children];
      expect(h?.tagName).toBe('H2');
      expect(h?.className).toBe('rl-page-card__title');
      expect(h?.textContent).toBe(t(TITLE_KEY[keyOf(c)] ?? ''));
      expect(body?.className).toBe('rl-page-card__body');
      expect(body?.querySelector('.rl-settings__row')).not.toBeNull();
    }
    // The old flat table is gone, and nothing else heads a section.
    expect(el.querySelector('h3, .rl-settings__section, .rl-settings__table')).toBeNull();
    // The build line stays the body's last word, under the cards.
    expect(el.querySelector('.rl-panel__body')?.lastElementChild?.textContent).toContain('0.68.0');
  });

  /** [control name, its label's catalogue key, the card it sits in]. */
  const ROWS: readonly (readonly [string, string, string])[] = [
    ['fullscreen', 'settings.fullscreen', 'video'],
    ['uiScale', 'settings.uiScale', 'video'],
    ['textSize', 'settings.textSize', 'video'],
    ['quality', 'settings.quality', 'video'],
    ['replayIntro', 'settings.intro', 'video'],
    ['master', 'settings.audio.master', 'audio'],
    ['music', 'settings.audio.music', 'audio'],
    ['sfx', 'settings.audio.sfx', 'audio'],
    ['voice', 'settings.audio.voice', 'audio'],
    ['radio', 'settings.audio.radio', 'audio'],
    ['motion', 'settings.motion', 'accessibility'],
    ['colorVision', 'settings.colorVision', 'accessibility'],
    ['captions', 'settings.captions', 'accessibility'],
    ['cameraSpeed', 'settings.cameraSpeed', 'controls'],
    ['edgePan', 'settings.edgePan', 'controls'],
    ['zoomToCursor', 'settings.zoomToCursor', 'controls'],
    ['reports', 'settings.reports', 'privacy'],
    ['chat', 'settings.chat.enabled', 'chat'],
    ['chatMask', 'settings.chat.mask', 'chat'],
    ['language', 'settings.language', 'language'],
  ];
  it.each(ROWS)('%s renders its control with its t() label, in the %s card', (name, key, card) => {
    const { d } = full();
    const { el } = settingsPanel(document.body, d);
    const controls = el.querySelectorAll(`[name="${name}"]`);
    expect(controls).toHaveLength(1);
    const control = controls[0] as HTMLElement;
    const label = el.querySelector(`label[for="set-${name}"]`);
    expect(control.id).toBe(`set-${name}`);
    expect(label?.textContent).toBe(t(key));
    const row = control.closest('.rl-settings__row');
    expect(row).not.toBeNull();
    expect(label?.closest('.rl-settings__row')).toBe(row);
    expect(row?.closest('.rl-settings__card')?.classList.contains(`rl-settings__card--${card}`)).toBe(true);
  });
  it('the row table covers every named control the panel draws', () => {
    const { d } = full();
    const { el } = settingsPanel(document.body, d);
    const drawn = [...el.querySelectorAll('[name]')].map((x) => x.getAttribute('name')).sort();
    expect(drawn).toEqual(ROWS.map(([n]) => n).sort());
  });

  /** [control name, the value set on it, the one field that write must move]. Fullscreen (async, the browser's say) and reports (its own setter) have their own cases above. */
  const WRITES: readonly (readonly [string, string | boolean, (n: Settings) => void])[] = [
    ['uiScale', '0.85', (n) => { n.video.uiScale = 0.85; }],
    ['textSize', '1.3', (n) => { n.video.textSize = 1.3; }],
    ['quality', 'low', (n) => { n.video.quality = 'low'; }],
    ['master', '0.4', (n) => { n.audio.master = 0.4; }],
    ['music', '0.3', (n) => { n.audio.music = 0.3; }],
    ['sfx', '0.2', (n) => { n.audio.sfx = 0.2; }],
    ['voice', '0.1', (n) => { n.audio.voice = 0.1; }],
    ['radio', false, (n) => { n.audio.radio = false; }],
    ['motion', 'reduce', (n) => { n.accessibility.motion = 'reduce'; }],
    ['colorVision', 'protanopia', (n) => { n.accessibility.colorVision = 'protanopia'; }],
    ['captions', false, (n) => { n.accessibility.captions = false; }],
    ['cameraSpeed', '2', (n) => { n.controls.cameraSpeed = 2; }],
    ['edgePan', true, (n) => { n.controls.edgePan = true; }],
    ['zoomToCursor', false, (n) => { n.controls.zoomToCursor = false; }],
    ['chat', false, (n) => { n.chat.enabled = false; }],
    ['chatMask', false, (n) => { n.chat.mask = false; }],
    ['language', 'xx', (n) => { n.language = 'xx'; }],
  ];
  it.each(WRITES)('%s still writes through set(), moving its own field and no other', (name, value, move) => {
    const { d, set } = full();
    const before = structuredClone(d.get());
    const { el } = settingsPanel(document.body, d);
    const c = el.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    if (!c) throw new Error(`no ${name}`);
    if (typeof value === 'boolean' && c instanceof HTMLInputElement) c.checked = value;
    else c.value = String(value);
    c.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
    const want = structuredClone(before);
    move(want);
    expect(want).not.toEqual(before);
    expect(set.mock.calls[0]?.[0]).toEqual(want);
  });

  it('under ?pseudo=1 every card title, label, option and button is bracketed', () => {
    setCatalogue('pseudo', en, pseudo);
    const { d } = full();
    // A locale's name is data (its own endonym), never through t(), so those options are left out.
    const { el } = settingsPanel(document.body, d);
    const chrome = [...el.querySelectorAll('.rl-page-card__title, label, button, .rl-settings__control option')]
      .filter((x) => x.closest('select[name="language"]') === null)
      .map((x) => x.textContent ?? '');
    expect(chrome.length).toBeGreaterThan(30);
    for (const text of chrome) expect(text, text).toMatch(/^⟦.*⟧$/);
  });
});
