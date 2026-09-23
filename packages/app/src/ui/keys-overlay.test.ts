// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, bindingsFrom, keyLabel } from '../input/keymap';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { setCatalogue } from '../i18n/t';
import { UNBOUND_KEYS, showKeysOverlay } from './keys-overlay';

const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const closed: number[] = [];
  const dispose = showKeysOverlay(host, { bindings: () => bindingsFrom({}), onClose: () => closed.push(1) });
  return { host, closed, dispose };
};

afterEach(() => {
  setCatalogue('en', en);
});

describe('showKeysOverlay', () => {
  // The whole point: not "a list of keys" but "THE list", derived.
  it('lists every action in ACTIONS and nothing invented', () => {
    const { host, dispose } = mount();
    const ids = [...host.querySelectorAll('.rl-keys__row')].map((el) => el.getAttribute('data-action'));
    expect(ids).toEqual(ACTIONS.map((a) => a.id));
    dispose();
  });

  it('prints the LIVE binding, so a rebind shows here', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showKeysOverlay(host, { bindings: () => bindingsFrom({ halt: 'k' }), onClose: () => undefined });
    const cap = host.querySelector('.rl-keys__row[data-action="halt"] .rl-keys__cap')?.textContent;
    expect(cap).toBe(keyLabel('k'));
    dispose();
  });

  it('shows the modifier a modified action needs', () => {
    const { host, dispose } = mount();
    expect(host.querySelector('.rl-keys__row[data-action="selectAll"] .rl-keys__cap')?.textContent)
      .toMatch(/Ctrl/);
    dispose();
  });

  // Task 8 (M14): the concatenation this replaces was
  // `${t('keymap.modifier.ctrl')}${key}` -- the modifier fragment goes
  // through `t()` on its own and the bare key never does, so under the
  // pseudo-locale the modifier comes back bracketed and accented and the key
  // does not, and the two read as separate words glued together (a `⟧`
  // immediately followed by a bare, unaccented letter). `keymap.cap.ctrl`
  // ("Ctrl + {key}") takes the key as its own param, so the WHOLE keycap is
  // formatted first and pseudo-transformed once, as a single unit -- one
  // opening bracket, one closing bracket, both ends accented.
  it('composes a Ctrl keycap as one catalogue entry, not by concatenation, under the pseudo-locale', () => {
    setCatalogue('pseudo', en, pseudo);
    const { host, dispose } = mount();
    try {
      const cap = host.querySelector('.rl-keys__row[data-action="selectAll"] .rl-keys__cap')?.textContent ?? null;
      expect(cap).not.toBeNull();
      // The failure this pins: a bracket glued directly to a word character
      // -- ⟧ immediately followed by a letter or digit -- which is what
      // concatenating a separately-translated fragment with an untranslated
      // key produces. The fixed composition brackets the whole string once,
      // so the closing bracket is always the LAST character.
      expect(cap).toMatch(/^⟦.*⟧$/);
      expect((cap?.match(/⟦/g) ?? []).length).toBe(1);
      expect((cap?.match(/⟧/g) ?? []).length).toBe(1);
    } finally {
      dispose();
    }
  });

  // Task 8 (M4): a synthetic Tab never moves focus in jsdom by itself. The
  // overlay's row list has no focusable content at all (`row()` builds plain
  // spans), so Close is the panel's ONLY focusable control -- "wraps from the
  // last to the first" here means wrapping back onto itself, which is
  // exactly what a real trap does with a single-element root. What actually
  // falls without a trap is `defaultPrevented`: nothing here would claim the
  // key at all, so it would read false rather than true.
  it('traps Tab: the sole focusable (Close) keeps focus, claimed by the trap rather than left to the browser', () => {
    const { host, dispose } = mount();
    try {
      const close = host.querySelector<HTMLButtonElement>('.rl-keys__close')!;
      expect(document.activeElement).toBe(close); // focused at mount
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.body.dispatchEvent(tab);
      expect(document.activeElement).toBe(close);
      expect(tab.defaultPrevented).toBe(true);
    } finally {
      dispose();
    }
  });

  // The control groups and the two mouse buttons are real bindings that
  // deliberately are not in ACTIONS (keymap.ts's own header says why for the
  // digits). An overlay that omitted them would be complete and useless.
  it('lists what is bound outside the table too', () => {
    const { host, dispose } = mount();
    const extra = [...host.querySelectorAll('.rl-keys__row--fixed')];
    expect(extra).toHaveLength(UNBOUND_KEYS.length);
    expect(UNBOUND_KEYS.length).toBeGreaterThanOrEqual(3);
    dispose();
  });

  it('Escape and a click on the scrim both close it', () => {
    const a = mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(a.closed).toEqual([1]);
    a.dispose();
    const b = mount();
    b.host.querySelector<HTMLElement>('.rl-keys')?.click();
    expect(b.closed).toEqual([1]);
    b.dispose();
  });

  it('dispose leaves the document as it found it', () => {
    const { host, dispose } = mount();
    dispose();
    expect(host.childElementCount).toBe(0);
  });

  // Task 8 fix round 1 (C1): the overlay is a real dialog now. Its own
  // capture-phase guard (mirroring `pause.ts`'s `onCaptureKey`) has to
  // swallow every game verb before `main.ts`'s own bubble listener on
  // `window` ever sees it -- a spy standing in for that listener is the
  // instrument, since it is registered exactly the same way (a bare bubble
  // `keydown` listener on `window`).
  it('swallows every other key while open via a capture-phase guard, and releases them on dispose', () => {
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    try {
      const first = mount();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
      expect(spy).not.toHaveBeenCalled();
      spy.mockClear(); // Escape and the overlay's own binding are deliberately NOT stopped (see below), so each stage clears the log rather than accumulating across them.

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(first.closed).toEqual([1]);
      first.dispose();
      spy.mockClear();

      // Re-mount: the overlay's own binding -- read LIVE from `bindings()`,
      // not hardcoded -- also closes it, and is the one key this module
      // itself calls `preventDefault()` for (F1 is the browser's own help
      // key, and `main.ts`'s `case 'keysOverlay':` no longer runs while this
      // is open, so nothing else will).
      const second = mount();
      const ev = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      expect(second.closed).toEqual([1]);
      expect(ev.defaultPrevented).toBe(true);
      second.dispose();
      spy.mockClear();

      // The guard went with the overlay: the same key that was swallowed
      // above now reaches the spy again.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });
});
